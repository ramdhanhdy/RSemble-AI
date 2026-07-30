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
import type {
  JudgeReport,
  ConsensusBreakdown,
  ModelSlot,
} from "../../studio-data";
import type { ChatMessage } from "../providers/types";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  RunStatus,
  RunSource,
  AttemptStatus,
  PersistedError,
  PersistedCandidate,
  CandidateAttemptRecord,
  JudgeAttemptRecord,
  FusionAttemptRecord,
  ExecutionFence,
} from "./run-types";
import type { EvaluationProfileSnapshot } from "../evaluations/evaluation-types";

// --- Input shapes (mirror executor event payloads) ---------------------------

export interface FanoutStartInput {
  runId: string;
  source: RunSource;
  mode: "rank" | "fuse";
  task: { title: string; prompt: string; systemPrompt: string; temperature: number };
  evaluation: { profile: EvaluationProfileSnapshot | null; candidateMessages: ChatMessage[] };
  slots: ModelSlot[];
  fence: ExecutionFence;
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
  error: PersistedError | null;
  finishedAt: number;
}

// --- Builder state -----------------------------------------------------------

export interface RunRecordBuilderState {
  record: RunRecordV2 | null;
}

// --- Dependencies ------------------------------------------------------------

export interface BuilderDeps {
  generateId: () => string;
  now: () => number;
}

// --- Factory -----------------------------------------------------------------

export function createRunRecordBuilder(deps: BuilderDeps) {
  const { generateId, now } = deps;

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
      .map((slot) => {
        const attemptId = generateId();
        const attempt: CandidateAttemptRecord = {
          attemptId,
          messages: input.evaluation.candidateMessages,
          startedAt: ts,
          finishedAt: null,
          status: "running",
          output: null,
          tokensIn: null,
          tokensOut: null,
          error: null,
        };
        return {
          candidateId: slot.id,
          slotId: slot.id,
          modelKey: modelKey(slot),
          providerId: slot.providerId,
          model: slot.model,
          slug: slot.slug,
          acceptedAttemptId: null,
          attempts: [attempt],
        };
      });

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
      evaluation: { profile: input.evaluation.profile, candidateMessages: input.evaluation.candidateMessages },
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

  function findCandidate(record: RunRecordV2, candidateId: string): PersistedCandidate | undefined {
    return record.candidates.find((c) => c.candidateId === candidateId);
  }

  function findCandidateAttempt(candidate: PersistedCandidate, attemptId: string): CandidateAttemptRecord | undefined {
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
    attempt.error = input.error;
    attempt.finishedAt = input.finishedAt;
    // Move accepted pointer only on success
    if (input.status === "completed") {
      candidate.acceptedAttemptId = attemptId;
    }
    record.updatedAt = now();
  }

  function applyFanoutTerminal(
    _state: RunRecordBuilderState,
    record: RunRecordV2,
    _done: unknown[],
  ): void {
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
    attempt.error = input.error;
    attempt.finishedAt = input.finishedAt;
    // Move accepted pointer only on success
    if (input.status === "completed" && input.result !== null) {
      record.fusion.acceptedAttemptId = attemptId;
      record.fusion.status = "done";
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
      return att !== undefined && att.output !== null && att.output !== undefined && att.output.trim().length > 0;
    }).length;
  }

  function hasAllCandidatesUsable(record: RunRecordV2): boolean {
    return record.candidates.every((c) => {
      if (!c.acceptedAttemptId) return false;
      const att = c.attempts.find((a) => a.attemptId === c.acceptedAttemptId);
      return att !== undefined && att.output !== null && att.output !== undefined && att.output.trim().length > 0;
    });
  }

  function hasAcceptedFusion(record: RunRecordV2): boolean {
    return record.fusion.acceptedAttemptId !== null;
  }

  function deriveStatus(record: RunRecordV2): RunStatus {
    // Explicit terminal states take precedence
    if (record.status === "aborted") return "aborted";
    if (record.status === "interrupted") return "interrupted";

    // Check if any candidate attempts are still running (fanout not settled)
    const fanoutActive = record.candidates.some((c) =>
      c.attempts.some((a) => a.status === "running"),
    );
    if (fanoutActive) return "running";

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

    // Judge has not run yet or is running → running (if ≥2 usable) or failed
    if (usableCount < 2) {
      // Fanout settled with <2 usable and no Judge → failed
      if (record.judge.status === "idle") return "failed";
      return "failed";
    }
    return "running";
  }

  function deriveWinnerKeys(record: RunRecordV2): string[] {
    if (!record.judge.report) return [];
    const { evaluationsById } = record.judge.report;
    const scores: Array<{ modelKey: string; score: number }> = [];
    for (const c of record.candidates) {
      const ev = evaluationsById[c.candidateId];
      if (ev) {
        scores.push({ modelKey: c.modelKey, score: ev.overallScore });
      }
    }
    if (scores.length === 0) return [];
    const maxScore = Math.max(...scores.map((s) => s.score));
    return scores
      .filter((s) => Math.abs(s.score - maxScore) < 1e-9)
      .map((s) => s.modelKey);
  }

  // --- Summary derivation -----------------------------------------------------

  function deriveSummary(record: RunRecordV2): FullRunSummaryV2 {
    const status = deriveStatus(record);
    const modelKeys = record.candidates.map((c) => c.modelKey);
    const winnerKeys = deriveWinnerKeys(record);

    // scoresByModelKey from accepted Judge report
    const scoresByModelKey: Record<string, number> = {};
    if (record.judge.report) {
      for (const c of record.candidates) {
        const ev = record.judge.report.evaluationsById[c.candidateId];
        if (ev) {
          scoresByModelKey[c.modelKey] = ev.overallScore;
        }
      }
    }

    const taskExcerpt = record.task.prompt.slice(0, 200);
    const searchText = [
      record.task.title,
      taskExcerpt,
      ...record.candidates.map((c) => `${c.model} ${c.slug}`),
    ].join(" ");

    const judgeModelKey = record.judge.attempts.length > 0
      ? `${record.judge.attempts[0].providerId}:${record.judge.attempts[0].model}`
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
      detailAvailable: true,
      searchText,
    };
  }

  return {
    createInitialState,
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
