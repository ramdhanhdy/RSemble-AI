// =============================================================================
// RSemble AI — Run record builder (pure functions)
//
// Converts executor lifecycle events into RunRecordV2 mutations and derives
// FullRunSummaryV2. No I/O, no side effects. Status derivation follows
// spec §7.5.
//
// The builder maintains an internal mutable state object that holds the current
// RunRecordV2. Each apply* method mutates the record in place and returns it.
// The recorder (Task 2.4) will wrap these mutations in repository CAS writes.
// =============================================================================
import type { JudgeReport, ConsensusBreakdown, ModelSlot } from "../../studio-data";
import type {
  ChatMessage,
  CostRecord,
  InputUsageEstimate,
  ReasoningPolicy,
  ReasoningSettingProvenance,
  RunReasoningProvenance,
  UsageBreakdown,
} from "../providers/types";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  RunStatus,
  RunSource,
  TaskAttachmentMeta,
  AttemptStatus,
  PersistedError,
  PersistedCandidate,
  CandidateAttemptRecord,
  JudgeAttemptRecord,
  FusionAttemptRecord,
  ExecutionFence,
} from "./run-types";
import type { EvaluationProfileSnapshot } from "../evaluations/evaluation-types";
import {
  rankValueFromResults,
  WINNER_EPSILON,
  isComplianceOnlyProfile,
} from "../evaluations/evaluation-rubric";
import { candidateIdForSlot } from "../pipeline";
import { resolveReasoningEffort } from "../providers/reasoning";

// --- Input shapes (mirror executor event payloads) ---------------------------

export interface FanoutStartInput {
  runId: string;
  source: RunSource;
  mode: "rank" | "fuse";
  task: { title: string; prompt: string; systemPrompt: string; temperature: number };
  evaluation: { profile: EvaluationProfileSnapshot | null; candidateMessages: ChatMessage[] };
  slots: ModelSlot[];
  critic?: { providerId: string; model: string };
  fence: ExecutionFence;
  /** Attachment metadata for the record (plan 7.7.2) — never bytes/text. */
  attachments?: TaskAttachmentMeta[];
  reasoningPolicy?: ReasoningPolicy;
}

export interface RepairRunSeedInput {
  runId: string;
  /** Source of the new run — experiment branch carries repair metadata. */
  source: RunSource;
  task: { title: string; prompt: string; systemPrompt: string; temperature: number };
  evaluation: { profile: EvaluationProfileSnapshot | null; candidateMessages: ChatMessage[] };
  /** Snapshot roster slots (full candidate set for the new Judge pass). */
  critic?: { providerId: string; model: string };
  slots: ModelSlot[];
  fence: ExecutionFence;
  /** The base run whose accepted candidate outputs are reused. */
  baseRun: RunRecordV2;
  /** Model keys to re-execute (requested) vs reuse (everything else). */
  requestedModelKeys: string[];
  reasoningPolicy?: ReasoningPolicy;
  /** Fresh candidate/attempt ID generator (avoids collisions with base run). */
  generateId: () => string;
}

export interface CandidateAttemptStartInput {
  attemptId: string;
  messages: ChatMessage[];
  startedAt: number;
}

export interface CandidateTerminalInput {
  status: AttemptStatus;
  output: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  usage?: UsageBreakdown | null;
  inputEstimate?: InputUsageEstimate;
  cost?: CostRecord | null;
  error: PersistedError | null;
  finishedAt: number;
}

export interface JudgeAttemptStartInput {
  providerId: string;
  model: string;
  instruction: string;
  messages: ChatMessage[];
  blindLabelToCandidateId: Record<string, string>;
  candidateAttemptIdsByCandidateId: Record<string, string>;
  startedAt: number;
}

export interface JudgeTerminalInput {
  status: AttemptStatus;
  report: JudgeReport | null;
  consensus: ConsensusBreakdown | null;
  usage?: UsageBreakdown | null;
  inputEstimate?: InputUsageEstimate;
  cost?: CostRecord | null;
  error: PersistedError | null;
  finishedAt: number;
}

export interface FusionAttemptStartInput {
  providerId: string;
  model: string;
  messages: ChatMessage[];
  sourceJudgeAttemptId: string;
  candidateAttemptIdsByCandidateId: Record<string, string>;
  startedAt: number;
}

export interface FusionTerminalInput {
  status: AttemptStatus;
  result: string | null;
  usage?: UsageBreakdown | null;
  inputEstimate?: InputUsageEstimate;
  cost?: CostRecord | null;
  error: PersistedError | null;
  finishedAt: number;
}

// --- Builder state -----------------------------------------------------------

export interface RunRecordBuilderState {
  record: RunRecordV2 | null;
}

// --- Dependencies ------------------------------------------------------------

export interface BuilderDeps {
  now: () => number;
}

function buildReasoningProvenance(
  policy: ReasoningPolicy,
  slots: ModelSlot[],
  judge: { providerId: string; model: string },
): RunReasoningProvenance {
  const setting = (
    providerId: string,
    model: string,
    requested: ReasoningPolicy["candidates"],
  ): ReasoningSettingProvenance => {
    const resolution = resolveReasoningEffort(
      providerId as ModelSlot["providerId"],
      model,
      requested,
    );
    return resolution.ok
      ? { requested, effective: resolution.effective, source: resolution.capabilities.source }
      : { requested, effective: "provider-default", source: "unknown" };
  };
  const candidates: Record<string, ReasoningSettingProvenance> = {};
  for (const slot of slots) {
    if (slot.enabled)
      candidates[modelKeyOfSlot(slot)] = setting(slot.providerId, slot.slug, policy.candidates);
  }
  const judgeResolution = resolveReasoningEffort(
    judge.providerId as ModelSlot["providerId"],
    judge.model,
    policy.judge,
  );
  return {
    candidates,
    judge: judgeResolution.ok
      ? {
          requested: policy.judge,
          effective: judgeResolution.effective,
          source: judgeResolution.capabilities.source,
        }
      : { requested: policy.judge, effective: "provider-default", source: "unknown" },
  };
}

function modelKeyOfSlot(slot: ModelSlot): string {
  return `${slot.providerId}:${slot.slug}`;
}

// --- Factory -----------------------------------------------------------------

export function createRunRecordBuilder(deps: BuilderDeps) {
  const { now } = deps;

  function createInitialState(): RunRecordBuilderState {
    return { record: null };
  }

  function modelKey(slot: ModelSlot): string {
    return `${slot.providerId}:${slot.slug}`;
  }

  function applyFanoutStart(_state: RunRecordBuilderState, input: FanoutStartInput): RunRecordV2 {
    const ts = now();
    const candidates: PersistedCandidate[] = input.slots
      .filter((s) => s.enabled)
      .map((slot) => ({
        // candidateIdForSlot is the single ID scheme shared with executor
        // jobs and Judge blind-label resolution — evidence always joins.
        candidateId: candidateIdForSlot(slot.id),
        slotId: slot.id,
        modelKey: modelKey(slot),
        providerId: slot.providerId,
        model: slot.model,
        slug: slot.slug,
        acceptedAttemptId: null,
        // Attempts begin empty: the executor's onCandidateAttemptStart appends
        // the real attempt before the provider call. A pre-created running
        // placeholder would never terminate, pinning deriveStatus at "running".
        attempts: [],
      }));

    const record: RunRecordV2 = {
      schemaVersion: 2,
      id: input.runId,
      revision: 1,
      execution: input.fence,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
      status: "running",
      mode: input.mode,
      source: input.source,
      task: { ...input.task },
      // Recorded only when attachments exist, so attachment-free records keep
      // their pre-attachments shape byte-for-byte.
      ...(input.attachments && input.attachments.length > 0
        ? {
            attachments: input.attachments.map((a) => ({
              name: a.name,
              kind: a.kind,
              bytes: a.bytes,
            })),
          }
        : {}),
      evaluation: {
        profile: input.evaluation.profile,
        candidateMessages: input.evaluation.candidateMessages,
      },
      ...(input.reasoningPolicy && input.critic
        ? { reasoning: buildReasoningProvenance(input.reasoningPolicy, input.slots, input.critic) }
        : {}),
      candidates,
      judge: {
        status: "idle",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: {
        status: "idle",
        acceptedAttemptId: null,
        attempts: [],
      },
      winnerKeys: [],
    };
    _state.record = record;
    return record;
  }

  /**
   * Build a fresh compound-repair run seed (spec §11.3–11.4):
   *  - fresh run/candidate/attempt IDs;
   *  - copied accepted outputs + messages for reused candidates with explicit
   *    `reusedFrom` provenance;
   *  - unstarted target candidates (the executor will call them);
   *  - empty Judge and fusion evidence;
   *  - repair metadata in the run source;
   *  - NO copied winner or score report (the new Judge pass is fresh).
   */
  function buildRepairRunSeed(input: RepairRunSeedInput): RunRecordV2 {
    const ts = now();
    const requested = new Set(input.requestedModelKeys);
    const baseByKey = new Map(input.baseRun.candidates.map((c) => [c.modelKey, c]));

    const candidates: PersistedCandidate[] = input.slots
      .filter((s) => s.enabled)
      .map((slot) => {
        const key = `${slot.providerId}:${slot.slug}`;
        const candidateId = candidateIdForSlot(slot.id);
        const base = baseByKey.get(key);

        if (!requested.has(key) && base?.acceptedAttemptId) {
          // Reuse: copy the accepted output + messages with provenance and a
          // FRESH attempt ID (never reuse the base attempt id). The fresh
          // attempt is already completed, set it as the candidate's accepted
          // pointer so a subsequent repair planner can reuse this result.
          const sourceAttempt = base.attempts.find((a) => a.attemptId === base.acceptedAttemptId);
          if (sourceAttempt) {
            const freshAttemptId = input.generateId();
            return {
              candidateId,
              slotId: slot.id,
              modelKey: key,
              providerId: slot.providerId,
              model: slot.model,
              slug: slot.slug,
              acceptedAttemptId: freshAttemptId,
              attempts: [
                {
                  attemptId: freshAttemptId,
                  messages: sourceAttempt.messages,
                  startedAt: sourceAttempt.startedAt,
                  finishedAt: sourceAttempt.finishedAt,
                  status: "completed",
                  output: sourceAttempt.output,
                  tokensIn: sourceAttempt.tokensIn,
                  tokensOut: sourceAttempt.tokensOut,
                  ...(sourceAttempt.usage ? { usage: { ...sourceAttempt.usage } } : {}),
                  ...(sourceAttempt.inputEstimate
                    ? { inputEstimate: { ...sourceAttempt.inputEstimate } }
                    : {}),
                  ...(sourceAttempt.cost ? { cost: { ...sourceAttempt.cost } } : {}),
                  error: null,
                  reusedFrom: {
                    sourceRunId: input.baseRun.id,
                    sourceCandidateId: base.candidateId,
                    sourceAttemptId: sourceAttempt.attemptId,
                  },
                },
              ],
            };
          }
        }

        // Requested (or non-reusable) candidate: unstarted, executor fills it.
        return {
          candidateId,
          slotId: slot.id,
          modelKey: key,
          providerId: slot.providerId,
          model: slot.model,
          slug: slot.slug,
          acceptedAttemptId: null,
          attempts: [],
        };
      });

    return {
      schemaVersion: 2,
      id: input.runId,
      revision: 1,
      execution: input.fence,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
      status: "running",
      mode: "rank",
      source: input.source,
      task: { ...input.task },
      evaluation: {
        profile: input.evaluation.profile,
        candidateMessages: input.evaluation.candidateMessages,
      },
      ...(input.reasoningPolicy && input.critic
        ? { reasoning: buildReasoningProvenance(input.reasoningPolicy, input.slots, input.critic) }
        : input.baseRun.reasoning
          ? { reasoning: input.baseRun.reasoning }
          : {}),
      candidates,
      judge: {
        status: "idle",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: [],
    };
  }

  function findCandidate(record: RunRecordV2, candidateId: string): PersistedCandidate | undefined {
    return record.candidates.find((c) => c.candidateId === candidateId);
  }

  function findCandidateAttempt(
    candidate: PersistedCandidate,
    attemptId: string,
  ): CandidateAttemptRecord | undefined {
    return candidate.attempts.find((a) => a.attemptId === attemptId);
  }

  function applyCandidateAttemptStart(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    candidateId: string,
    input: CandidateAttemptStartInput,
  ): void {
    const candidate = findCandidate(record, candidateId);
    if (!candidate) return;
    const attempt: CandidateAttemptRecord = {
      attemptId: input.attemptId,
      messages: input.messages,
      startedAt: input.startedAt,
      finishedAt: null,
      status: "running",
      output: null,
      tokensIn: null,
      tokensOut: null,
      error: null,
    };
    candidate.attempts.push(attempt);
    record.revision += 1;
    record.status = deriveStatus(record);
    record.updatedAt = now();
  }

  function applyCandidateAttemptTerminal(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    candidateId: string,
    attemptId: string,
    input: CandidateTerminalInput,
  ): void {
    const candidate = findCandidate(record, candidateId);
    if (!candidate) return;
    const attempt = findCandidateAttempt(candidate, attemptId);
    if (!attempt) return;
    attempt.status = input.status;
    attempt.output = input.output;
    attempt.tokensIn = input.tokensIn;
    attempt.tokensOut = input.tokensOut;
    if (input.usage) attempt.usage = { ...input.usage };
    if (input.inputEstimate) attempt.inputEstimate = { ...input.inputEstimate };
    if (input.cost) attempt.cost = { ...input.cost };
    attempt.error = input.error;
    attempt.finishedAt = input.finishedAt;
    if (input.status === "completed") {
      const prevAccepted = candidate.acceptedAttemptId;
      candidate.acceptedAttemptId = attemptId;
      // A successful candidate retry that replaces the previously accepted
      // attempt invalidates the current accepted Judge/Fusion evidence —
      // those results referred to a different candidate attempt set, and
      // combining them with the new candidate output would be stale-evidence
      // (spec §5.6, §11.3). The automatic retry pipeline re-judges/re-fuses
      // immediately, setting fresh accepted pointers. Historical attempts
      // remain persisted in the judge/fusion attempts arrays; only the
      // current accepted pointers, report, consensus, and derived
      // winnerKeys are cleared. The record's terminal status is preserved
      // by deriveStatus's acceptedTerminal rule (no running regression).
      if (prevAccepted !== null && prevAccepted !== attemptId) {
        record.judge.acceptedAttemptId = null;
        record.judge.report = null;
        record.judge.consensus = null;
        record.judge.status = "idle";
        record.fusion.acceptedAttemptId = null;
        record.fusion.status = "idle";
        record.winnerKeys = [];
      }
    }
    record.revision += 1;
    record.status = deriveStatus(record);
    record.updatedAt = now();
  }

  function applyFanoutTerminal(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    _done: unknown[],
  ): void {
    record.revision += 1;
    record.status = deriveStatus(record);
    record.updatedAt = now();
  }

  function applyJudgeStart(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    attemptId: string,
    input: JudgeAttemptStartInput,
  ): void {
    const attempt: JudgeAttemptRecord = {
      attemptId,
      providerId: input.providerId,
      model: input.model,
      instruction: input.instruction,
      messages: input.messages,
      blindLabelToCandidateId: input.blindLabelToCandidateId,
      candidateAttemptIdsByCandidateId: input.candidateAttemptIdsByCandidateId,
      startedAt: input.startedAt,
      finishedAt: null,
      status: "running",
      error: null,
      report: null,
      consensus: null,
    };
    record.judge.attempts.push(attempt);
    record.judge.status = "running";
    record.revision += 1;
    record.status = deriveStatus(record);
    record.updatedAt = now();
  }

  function applyJudgeTerminal(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    attemptId: string,
    input: JudgeTerminalInput,
  ): void {
    const attempt = record.judge.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) return;
    attempt.status = input.status;
    attempt.report = input.report;
    attempt.consensus = input.consensus;
    if (input.usage) attempt.usage = { ...input.usage };
    if (input.inputEstimate) attempt.inputEstimate = { ...input.inputEstimate };
    if (input.cost) attempt.cost = { ...input.cost };
    attempt.error = input.error;
    attempt.finishedAt = input.finishedAt;
    // Move accepted pointer only on success
    if (input.status === "completed" && input.report) {
      record.judge.acceptedAttemptId = attemptId;
      record.judge.report = input.report;
      record.judge.consensus = input.consensus;
      record.judge.status = "done";
      // Derive winnerKeys from the accepted report
      record.winnerKeys = deriveWinnerKeys(record);
    } else if (input.status === "failed") {
      record.judge.status = "error";
    }
    record.revision += 1;
    record.status = deriveStatus(record);
    if (record.status !== "running" && record.completedAt === null) {
      record.completedAt = now();
    }
    record.updatedAt = now();
  }

  function applyFusionStart(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    attemptId: string,
    input: FusionAttemptStartInput,
  ): void {
    const attempt: FusionAttemptRecord = {
      attemptId,
      providerId: input.providerId,
      model: input.model,
      messages: input.messages,
      sourceJudgeAttemptId: input.sourceJudgeAttemptId,
      candidateAttemptIdsByCandidateId: input.candidateAttemptIdsByCandidateId,
      startedAt: input.startedAt,
      finishedAt: null,
      status: "running",
      error: null,
      result: null,
    };
    record.fusion.attempts.push(attempt);
    record.fusion.status = "running";
    record.revision += 1;
    record.status = deriveStatus(record);
    record.updatedAt = now();
  }

  function applyFusionTerminal(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    attemptId: string,
    input: FusionTerminalInput,
  ): void {
    const attempt = record.fusion.attempts.find((a) => a.attemptId === attemptId);
    if (!attempt) return;
    attempt.status = input.status;
    attempt.result = input.result;
    if (input.usage) attempt.usage = { ...input.usage };
    if (input.inputEstimate) attempt.inputEstimate = { ...input.inputEstimate };
    if (input.cost) attempt.cost = { ...input.cost };
    attempt.error = input.error;
    attempt.finishedAt = input.finishedAt;
    // Move accepted pointer only on success
    if (input.status === "completed" && input.result !== null) {
      record.fusion.acceptedAttemptId = attemptId;
      record.fusion.status = "done";
    } else if (input.status === "failed") {
      record.fusion.status = "error";
    }
    record.revision += 1;
    record.status = deriveStatus(record);
    if (record.status !== "running" && record.completedAt === null) {
      record.completedAt = now();
    }
    record.updatedAt = now();
  }

  function applyAborted(_state: RunRecordBuilderState, record: RunRecordV2): void {
    record.status = "aborted";
    record.completedAt = now();
    // Finalize all running attempts as aborted
    for (const c of record.candidates) {
      for (const a of c.attempts) {
        if (a.status === "running") {
          a.status = "aborted";
          a.finishedAt = now();
        }
      }
    }
    for (const a of record.judge.attempts) {
      if (a.status === "running") {
        a.status = "aborted";
        a.finishedAt = now();
      }
    }
    for (const a of record.fusion.attempts) {
      if (a.status === "running") {
        a.status = "aborted";
        a.finishedAt = now();
      }
    }
    record.revision += 1;
    record.updatedAt = now();
  }

  function applyInterrupted(_state: RunRecordBuilderState, record: RunRecordV2): void {
    record.status = "interrupted";
    record.completedAt = now();
    for (const c of record.candidates) {
      for (const a of c.attempts) {
        if (a.status === "running") {
          a.status = "interrupted";
          a.finishedAt = now();
        }
      }
    }
    for (const a of record.judge.attempts) {
      if (a.status === "running") {
        a.status = "interrupted";
        a.finishedAt = now();
      }
    }
    for (const a of record.fusion.attempts) {
      if (a.status === "running") {
        a.status = "interrupted";
        a.finishedAt = now();
      }
    }
    record.revision += 1;
    record.updatedAt = now();
  }

  // --- Status derivation (spec §7.5) -----------------------------------------

  function hasAcceptedJudge(record: RunRecordV2): boolean {
    return record.judge.acceptedAttemptId !== null && record.judge.report !== null;
  }

  function countUsableCandidates(record: RunRecordV2): number {
    return record.candidates.filter((c) => {
      if (!c.acceptedAttemptId) return false;
      const att = c.attempts.find((a) => a.attemptId === c.acceptedAttemptId);
      return (
        att !== undefined &&
        att.output !== null &&
        att.output !== undefined &&
        att.output.trim().length > 0
      );
    }).length;
  }

  function hasAllCandidatesUsable(record: RunRecordV2): boolean {
    return record.candidates.every((c) => {
      if (!c.acceptedAttemptId) return false;
      const att = c.attempts.find((a) => a.attemptId === c.acceptedAttemptId);
      return (
        att !== undefined &&
        att.output !== null &&
        att.output !== undefined &&
        att.output.trim().length > 0
      );
    });
  }

  function hasAcceptedFusion(record: RunRecordV2): boolean {
    return record.fusion.acceptedAttemptId !== null;
  }

  function deriveStatus(record: RunRecordV2): RunStatus {
    // Explicit terminal states take precedence
    if (record.status === "aborted") return "aborted";
    if (record.status === "interrupted") return "interrupted";

    // Spec §5.6: a post-run paid command (Rank→Fuse, Judge retry, candidate
    // retry, re-fuse) records its attempt-start WITHOUT regressing an accepted
    // overall run status to running. The repository CAS guard rejects that
    // regression outright, so once this record has reached a terminal status
    // through accepted evidence, in-flight stages keep the terminal value.
    const acceptedTerminal =
      record.status === "completed" || record.status === "partial" || record.status === "failed";

    // Check if any candidate attempts are still running (fanout not settled)
    const fanoutActive = record.candidates.some((c) =>
      c.attempts.some((a) => a.status === "running"),
    );
    if (fanoutActive) return acceptedTerminal ? record.status : "running";

    if (record.judge.status === "running") return acceptedTerminal ? record.status : "running";
    if (record.fusion.status === "running") return acceptedTerminal ? record.status : "running";

    const acceptedJudge = hasAcceptedJudge(record);
    const usableCount = countUsableCandidates(record);
    const allUsable = hasAllCandidatesUsable(record);
    const fusionRequested = record.mode === "fuse";

    // Accepted Judge exists → derive from Judge + fusion state
    if (acceptedJudge) {
      // Fusion requested but no accepted result
      if (fusionRequested && !hasAcceptedFusion(record)) {
        const fusionActive = record.fusion.attempts.some((a) => a.status === "running");
        if (fusionActive) return "running";
        return "partial";
      }
      // All candidates usable + fusion (if requested) accepted → completed
      if (allUsable) {
        return "completed";
      }
      // Accepted Judge with one or more failed candidates → partial
      return "partial";
    }

    // No accepted Judge — check if Judge ran and failed
    if (record.judge.status === "error") {
      return "failed";
    }

    // A candidate with zero terminal attempts may simply not have started
    // yet — mid-fanout is not a failure. Only a fully settled fanout can
    // ground the <2-usable failure derivation.
    const fanoutSettled =
      record.candidates.length > 0 &&
      record.candidates.every(
        (c) => c.attempts.length > 0 && c.attempts.every((a) => a.finishedAt !== null),
      );

    // Judge has not run yet → running (if ≥2 usable) or failed (settled <2)
    if (usableCount < 2) {
      if (!fanoutSettled) return acceptedTerminal ? record.status : "running";
      return "failed";
    }
    return acceptedTerminal ? record.status : "running";
  }

  function deriveWinnerKeys(record: RunRecordV2): string[] {
    if (!record.judge.report) return [];
    const { evaluationsById } = record.judge.report;
    const profile = record.evaluation.profile;
    const scores: Array<{ modelKey: string; score: number }> = [];
    for (const c of record.candidates) {
      const ev = evaluationsById[c.candidateId];
      if (ev) {
        // When a profile is pinned, rankValue is the authoritative ranking
        // quantity. Otherwise, fall back to the Judge's holistic overallScore.
        const rv = profile ? rankValueFromResults(ev.criterionScores, profile) : null;
        scores.push({ modelKey: c.modelKey, score: rv ?? ev.overallScore });
      }
    }
    if (scores.length === 0) return [];
    const maxScore = Math.max(...scores.map((s) => s.score));
    return scores
      .filter((s) => Math.abs(s.score - maxScore) < WINNER_EPSILON)
      .map((s) => s.modelKey);
  }

  // --- Summary derivation -----------------------------------------------------

  function deriveSummary(record: RunRecordV2): FullRunSummaryV2 {
    const status = deriveStatus(record);
    const modelKeys = record.candidates.map((c) => c.modelKey);
    const winnerKeys = deriveWinnerKeys(record);

    // scoresByModelKey from accepted Judge report.
    // When a profile is pinned, use the authoritative rankValue; otherwise
    // fall back to the Judge's holistic overallScore.
    const scoresByModelKey: Record<string, number> = {};
    if (record.judge.report) {
      const profile = record.evaluation.profile;
      for (const c of record.candidates) {
        const ev = record.judge.report.evaluationsById[c.candidateId];
        if (ev) {
          const rv = profile ? rankValueFromResults(ev.criterionScores, profile) : null;
          scoresByModelKey[c.modelKey] = rv ?? ev.overallScore;
        }
      }
    }

    const taskExcerpt = record.task.prompt.slice(0, 200);
    const searchText = [
      record.task.title,
      taskExcerpt,
      ...record.candidates.map((c) => `${c.model} ${c.slug}`),
    ].join(" ");

    const acceptedJudge = record.judge.acceptedAttemptId
      ? record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId)
      : null;
    const judgeModelKey = acceptedJudge
      ? `${acceptedJudge.providerId}:${acceptedJudge.model}`
      : null;
    return {
      kind: "full",
      schemaVersion: 2,
      id: record.id,
      revision: record.revision,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      status,
      mode: record.mode,
      source: record.source,
      taskTitle: record.task.title,
      taskExcerpt,
      modelKeys,
      winnerKeys,
      scoresByModelKey,
      judgeModelKey,
      evaluationProfileId: record.evaluation.profile?.id ?? null,
      evaluationProfileVersion: record.evaluation.profile?.version ?? null,
      scoreDomain: isComplianceOnlyProfile(record.evaluation.profile ?? null)
        ? "compliance"
        : "rank",
      detailAvailable: true,
      searchText,
    };
  }

  return {
    createInitialState,
    buildRepairRunSeed,
    applyFanoutStart,
    applyCandidateAttemptStart,
    applyCandidateAttemptTerminal,
    applyFanoutTerminal,
    applyJudgeStart,
    applyJudgeTerminal,
    applyFusionStart,
    applyFusionTerminal,
    applyAborted,
    applyInterrupted,
    deriveStatus,
    deriveWinnerKeys,
    deriveSummary,
  };
}
