// =============================================================================
// RSemble AI — Run executor (provider-agnostic task engine)
//
// Extracts fanout → Judge → optional Fusion orchestration from run-controller.
// The executor calls provider adapters and emits lifecycle events; it owns no
// React state, localStorage, or persistence. The controller (Compare adapter)
// and recorder translate events into state and storage.
//
// Four paid-stage entry points:
//   executeTask        — full fanout → Judge → optional Fusion
//   retryCandidate     — re-run one candidate → re-Judge → optional re-Fuse
//   retryJudge         — re-Judge frozen candidates (no candidate calls)
//   executeFusionAttempt — Fusion/Re-fuse from frozen accepted evidence
// =============================================================================

import type { ChatMessage, CriticRef } from "./providers/types";
import type {
  BlindCandidate,
  Candidate,
  CandidateSegment,
  ModelSlot,
  JudgeReport,
  ConsensusBreakdown,
} from "../studio-data";
import type {
  RunSource,
  AttemptStatus,
  PersistedError,
} from "./persistence/run-types";
import { getProvider } from "./providers/registry";
import { getModelCapabilities } from "./providers/capabilities";
import type { Attachment } from "./attachments/types";
import {
  configuredCredentialValues,
  sanitizePersistedError,
  type SanitizeErrorContext,
} from "./persistence/error-redaction";
import { estimateTokens } from "./cost";
import {
  buildFanoutJobs,
  candidateFullText,
  createBlindCandidateSet,
  draftMessages,
  fusionMessages,
  judgeMessages,
  parseJudge,
  splitSegments,
  summarize,
  isUsableCandidate,
  type BlindCandidateSet,
  type FanoutJob,
} from "./pipeline";
import type { AdHocEvaluationConfig } from "./evaluations/evaluation-profile-adhoc";
import { resolveEvaluationProfile } from "./evaluations/evaluation-profile-adhoc";

// --- Request types -----------------------------------------------------------

export interface CandidateTaskSnapshot {
  prompt: string;
  systemPrompt: string;
  temperature: number;
}

export interface RunRequest {
  source: RunSource;
  mode: "rank" | "fuse";
  task: CandidateTaskSnapshot;
  evaluation: AdHocEvaluationConfig;
  slots: ModelSlot[];
  critic: CriticRef;
  judgeInstruction: string;
  /** Task attachments delivered to every candidate (plan 7.6.6). */
  attachments: Attachment[];
  /** Whether native media is also sent to the judge/fusion critic (§6.2). */
  attachmentsToJudge: boolean;
}

export interface FrozenCandidateRetryRequest {
  source: RunSource;
  mode: "rank" | "fuse";
  task: CandidateTaskSnapshot;
  evaluation: AdHocEvaluationConfig;
  slots: ModelSlot[];
  critic: CriticRef;
  judgeInstruction: string;
  /** Frozen attachment set from the original run (plan 7.6.6). */
  attachments: Attachment[];
  /** Frozen §6.2 flag for the re-judge that follows the retry. */
  attachmentsToJudge: boolean;
  retryCandidateId: string;
  retrySlotId: string;
  peerCandidates: Candidate[];
  /** Frozen exact attempt references for peer candidates. The retried
   *  candidate's entry is replaced by the new attempt ID at runtime. */
  candidateAttemptIdsByCandidateId: Record<string, string>;
}

export interface FrozenJudgeRetryRequest {
  mode: "rank" | "fuse";
  task: CandidateTaskSnapshot;
  evaluation: AdHocEvaluationConfig;
  candidates: Candidate[];
  critic: CriticRef;
  judgeInstruction: string;
  /** Frozen attachment set from the original run (plan 7.6.6). */
  attachments: Attachment[];
  /** Frozen §6.2 flag from the original run. */
  attachmentsToJudge: boolean;
  /** Frozen exact attempt references for every candidate being re-judged. */
  candidateAttemptIdsByCandidateId: Record<string, string>;
}

export interface FrozenFusionRequest {
  mode: "fuse";
  task: CandidateTaskSnapshot;
  evaluation: AdHocEvaluationConfig;
  candidates: Candidate[];
  critic: CriticRef;
  judgeInstruction: string;
  /** Task attachments for the synthesis pass (plan 7.6.6). */
  attachments: Attachment[];
  /** Frozen §6.2 flag. */
  attachmentsToJudge: boolean;
  judgeAttemptId: string;
  /** Frozen blind-label map from the source Judge attempt — the re-fusion
   *  reuses the exact same labels so the blind synthesis is reproducible. */
  blindLabelToCandidateId: Record<string, string>;
  candidateAttemptIdsByCandidateId: Record<string, string>;
}

// --- Event types -------------------------------------------------------------

export interface RunExecutorEvents {
  onFanoutStart(): Promise<void>;
  onCandidateDelta(candidateId: string, delta: string): void;
  onCandidateTerminal(
    candidateId: string,
    result: {
      segments: CandidateSegment[];
      summary: string;
      tokensIn: number;
      tokensOut: number;
      finishedAt: number;
    },
  ): void;
  onFanoutTerminal(done: Candidate[]): Promise<void>;
  onCandidateAttemptStart(
    candidateId: string,
    attemptId: string,
    input: { messages: ChatMessage[]; startedAt: number },
  ): Promise<void>;
  onCandidateAttemptTerminal(
    candidateId: string,
    attemptId: string,
    input: {
      status: AttemptStatus;
      output: string | null;
      tokensIn: number | null;
      tokensOut: number | null;
      error: PersistedError | null;
      finishedAt: number;
    },
  ): Promise<void>;
  onJudgeStart(
    attemptId: string,
    input: {
      providerId: string;
      model: string;
      instruction: string;
      messages: ChatMessage[];
      blindLabelToCandidateId: Record<string, string>;
      candidateAttemptIdsByCandidateId: Record<string, string>;
      startedAt: number;
    },
  ): Promise<void>;
  onJudgeTerminal(
    attemptId: string,
    input: {
      status: AttemptStatus;
      report: JudgeReport | null;
      consensus: ConsensusBreakdown | null;
      error: PersistedError | null;
      finishedAt: number;
    },
  ): Promise<void>;
  onFusionStart(
    attemptId: string,
    input: {
      providerId: string;
      model: string;
      messages: ChatMessage[];
      sourceJudgeAttemptId: string;
      candidateAttemptIdsByCandidateId: Record<string, string>;
      startedAt: number;
    },
  ): Promise<void>;
  onFusionTerminal(
    attemptId: string,
    input: {
      status: AttemptStatus;
      result: string | null;
      error: PersistedError | null;
      finishedAt: number;
    },
  ): Promise<void>;
}

// --- Executor interface ------------------------------------------------------

export interface RunExecutor {
  executeTask(request: RunRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
  retryCandidate(request: FrozenCandidateRetryRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
  retryJudge(request: FrozenJudgeRetryRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
  executeFusionAttempt(request: FrozenFusionRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
}

export interface RunExecutorDeps {
  /** Random source for the blind-label shuffle. Tests inject deterministic. */
  random?: () => number;
  /** ID generator for attempt IDs. Tests inject deterministic. */
  generateId?: () => string;
  /** Clock for timestamps. Tests inject deterministic. Defaults to Date.now. */
  now?: () => number;
}

// --- Factory -----------------------------------------------------------------

export function createRunExecutor(deps: RunExecutorDeps = {}): RunExecutor {
  const random = deps.random ?? Math.random;
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());

  function isAborted(signal: AbortSignal): boolean {
    return signal.aborted;
  }

  // Persisted errors carry only the allowlisted shape (spec §18): a redacted,
  // byte-capped message plus category/stage/model/at — never raw provider
  // bodies or configured credential values.
  function sanitizeError(err: unknown, ctx: SanitizeErrorContext): PersistedError {
    return sanitizePersistedError(err, ctx, now, configuredCredentialValues());
  }

  // --- Candidate fanout (shared by executeTask and retryCandidate) -----------

  async function runCandidateStream(
    job: FanoutJob,
    messages: ChatMessage[],
    temperature: number,
    events: RunExecutorEvents,
    signal: AbortSignal,
  ): Promise<{ content: string; segments: CandidateSegment[]; summary: string; tokensIn: number; tokensOut: number; finishedAt: number } | { error: PersistedError } | null> {
    const provider = getProvider(job.providerId);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    try {
      let content = "";
      for await (const delta of provider.chatCompletionStream({
        model: job.slug,
        messages,
        temperature,
        signal: ctrl.signal,
      })) {
        if (isAborted(signal)) return null;
        content += delta;
        events.onCandidateDelta(job.id, delta);
      }
      if (isAborted(signal)) return null;
      const segments = splitSegments(content, job.id);
      const summary = summarize(content);
      const tokensIn = estimateTokens(messages.map((m) => m.content).join(""));
      const tokensOut = estimateTokens(content);
      return { content, segments, summary, tokensIn, tokensOut, finishedAt: now() };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      if (isAborted(signal)) return null;
      // Provider errors fail this candidate (not the whole run); return the
      // bounded sanitized error so the caller records it on the attempt.
      return { error: sanitizeError(err, { category: "provider", stage: "candidate", model: job.slug }) };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // --- Judge (shared by executeTask, retryCandidate, retryJudge) --------------

  async function runJudge(
    done: Candidate[],
    request: { task: CandidateTaskSnapshot; evaluation: AdHocEvaluationConfig; critic: CriticRef; judgeInstruction: string; attachments: Attachment[]; attachmentsToJudge: boolean },
    candidateAttemptIdsByCandidateId: Record<string, string>,
    events: RunExecutorEvents,
    signal: AbortSignal,
  ): Promise<{ ok: true; attemptId: string; report: JudgeReport; consensus: ConsensusBreakdown; scoresById: Record<string, number>; blindSet: BlindCandidateSet } | { ok: false }> {
    if (done.length < 2) return { ok: false };
    if (isAborted(signal)) return { ok: false };

    const blindSet = createBlindCandidateSet(done, random);
    const profile = resolveEvaluationProfile(request.evaluation);
    const messages = judgeMessages(
      request.task.prompt,
      profile,
      blindSet.candidates,
      request.judgeInstruction,
      request.attachments,
      request.attachmentsToJudge,
      getModelCapabilities(request.critic.providerId, request.critic.model),
    );
    const attemptId = generateId();
    const startedAt = now();

    const blindLabelToCandidateId: Record<string, string> = {};
    for (const { label, candidateId } of blindSet.labelMap) {
      blindLabelToCandidateId[label] = candidateId;
    }

    try {
      await events.onJudgeStart(attemptId, {
        providerId: request.critic.providerId,
        model: request.critic.model,
        instruction: request.judgeInstruction,
        messages,
        blindLabelToCandidateId,
        candidateAttemptIdsByCandidateId,
        startedAt,
      });
    } catch {
      return { ok: false };
    }

    if (isAborted(signal)) return { ok: false };

    const provider = getProvider(request.critic.providerId);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    try {
      const content = await provider.chatCompletion({
        model: request.critic.model,
        messages,
        temperature: 0.1,
        signal: ctrl.signal,
      });
      if (isAborted(signal)) {
        await events.onJudgeTerminal(attemptId, {
          status: "aborted", report: null, consensus: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false };
      }
      const { breakdown, scoresById, report } = parseJudge(content, blindSet, profile, done);
      await events.onJudgeTerminal(attemptId, {
        status: "completed", report, consensus: breakdown, error: null, finishedAt: now(),
      });
      return { ok: true, attemptId, report, consensus: breakdown, scoresById, blindSet };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        await events.onJudgeTerminal(attemptId, {
          status: "aborted", report: null, consensus: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false };
      }
      if (isAborted(signal)) return { ok: false };
      await events.onJudgeTerminal(attemptId, {
        status: "failed", report: null, consensus: null,
        error: sanitizeError(err, { category: "provider", stage: "judge", model: request.critic.model }), finishedAt: now(),
      }).catch(() => {});
      return { ok: false };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // --- Fusion (shared by executeTask, retryCandidate, retryJudge, executeFusionAttempt) ---

  async function runFusion(
    blindCandidates: BlindCandidate[],
    request: { task: CandidateTaskSnapshot; evaluation: AdHocEvaluationConfig; critic: CriticRef; judgeInstruction?: string; attachments: Attachment[]; attachmentsToJudge: boolean },
    sourceJudgeAttemptId: string,
    candidateAttemptIdsByCandidateId: Record<string, string>,
    events: RunExecutorEvents,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; result: string | null }> {
    if (isAborted(signal)) return { ok: false, result: null };

    const fusionProfile = resolveEvaluationProfile(request.evaluation);
    const messages = fusionMessages({
      prompt: request.task.prompt,
      profile: fusionProfile,
      blindCandidates,
      judgeInstruction: request.judgeInstruction ?? "",
      attachments: request.attachments,
      includeNativeMedia: request.attachmentsToJudge,
      criticCapabilities: getModelCapabilities(request.critic.providerId, request.critic.model),
    });
    const attemptId = generateId();
    const startedAt = now();

    try {
      await events.onFusionStart(attemptId, {
        providerId: request.critic.providerId,
        model: request.critic.model,
        messages,
        sourceJudgeAttemptId,
        candidateAttemptIdsByCandidateId,
        startedAt,
      });
    } catch {
      return { ok: false, result: null };
    }

    if (isAborted(signal)) return { ok: false, result: null };

    const provider = getProvider(request.critic.providerId);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    try {
      const content = await provider.chatCompletion({
        model: request.critic.model,
        messages,
        temperature: 0.3,
        signal: ctrl.signal,
      });
      if (isAborted(signal)) {
        await events.onFusionTerminal(attemptId, {
          status: "aborted", result: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false, result: null };
      }
      await events.onFusionTerminal(attemptId, {
        status: "completed", result: content, error: null, finishedAt: now(),
      });
      return { ok: true, result: content };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        await events.onFusionTerminal(attemptId, {
          status: "aborted", result: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false, result: null };
      }
      if (isAborted(signal)) return { ok: false, result: null };
      await events.onFusionTerminal(attemptId, {
        status: "failed", result: null,
        error: sanitizeError(err, { category: "provider", stage: "fusion", model: request.critic.model }), finishedAt: now(),
      }).catch(() => {});
      return { ok: false, result: null };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // --- executeTask ------------------------------------------------------------

  async function executeTask(request: RunRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void> {
    const jobs = buildFanoutJobs(request.slots);
    if (jobs.length === 0) return;

    // Validate unique model keys before any provider call.
    const keys = jobs.map((j) => `${j.providerId}:${j.slug}`);
    if (new Set(keys).size !== keys.length) {
      throw new Error("Duplicate enabled provider:model keys are not allowed");
    }

    try {
      await events.onFanoutStart();
    } catch {
      return; // fanout-start rejection → zero provider calls
    }

    if (isAborted(signal)) return;

    const candidateAttemptIds: Record<string, string> = {};
    const candidateResults: Map<string, { segments: CandidateSegment[]; summary: string; tokensIn: number; tokensOut: number; finishedAt: number; content: string }> = new Map();

    await Promise.all(
      jobs.map(async (job): Promise<void> => {
        const messages = draftMessages({
          systemPrompt: request.task.systemPrompt,
          prompt: request.task.prompt,
          attachments: request.attachments,
          capabilities: getModelCapabilities(job.providerId, job.slug),
        });
        const attemptId = generateId();
        const startedAt = now();

        try {
          await events.onCandidateAttemptStart(job.id, attemptId, { messages, startedAt });
        } catch {
          return; // start rejection → zero provider calls for this candidate
        }

        if (isAborted(signal)) return;

        const result = await runCandidateStream(job, messages, request.task.temperature, events, signal);
        if (!result || "error" in result) {
          if (isAborted(signal) && !result) return;
          await events.onCandidateAttemptTerminal(job.id, attemptId, {
            status: "failed", output: null, tokensIn: null, tokensOut: null,
            error: result && "error" in result
              ? result.error
              : sanitizeError(new Error("Candidate aborted"), { category: "aborted", stage: "candidate", model: job.slug }),
            finishedAt: now(),
          }).catch(() => {});
          return;
        }

        events.onCandidateTerminal(job.id, {
          segments: result.segments,
          summary: result.summary,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          finishedAt: result.finishedAt,
        });

        candidateAttemptIds[job.id] = attemptId;
        candidateResults.set(job.id, result);

        await events.onCandidateAttemptTerminal(job.id, attemptId, {
          status: "completed",
          output: result.content,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          error: null,
          finishedAt: result.finishedAt,
        }).catch(() => {});
      }),
    );

    if (isAborted(signal)) return;

    // Build Candidate objects for Judge/Fusion.
    const done: Candidate[] = jobs
      .filter((j) => candidateResults.has(j.id))
      .map((j) => {
        const r = candidateResults.get(j.id)!;
        return {
          id: j.id,
          model: j.displayName,
          provider: j.provider,
          providerId: j.providerId,
          slug: j.slug,
          accent: j.accent,
          strategy: j.strategyLabel,
          summary: r.summary,
          scores: {},
          weightedScore: 0,
          segments: r.segments,
          status: "done" as const,
          startedAt: now(),
          finishedAt: r.finishedAt,
        };
      })
      .filter(isUsableCandidate);

    try {
      await events.onFanoutTerminal(done);
    } catch {
      return; // fanout-terminal rejection → stop before Judge
    }

    if (isAborted(signal)) return;
    if (done.length < 2) return;

    const judgeResult = await runJudge(
      done,
      { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
      candidateAttemptIds,
      events,
      signal,
    );

    if (!judgeResult.ok) return;
    if (isAborted(signal)) return;

    if (request.mode === "fuse") {
      await runFusion(
        judgeResult.blindSet.candidates,
        { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
        judgeResult.attemptId,
        candidateAttemptIds,
        events,
        signal,
      );
    }
  }

  // --- retryCandidate ---------------------------------------------------------

  async function retryCandidate(request: FrozenCandidateRetryRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void> {
    const slot = request.slots.find((s) => s.id === request.retrySlotId);
    if (!slot) return;

    const job: FanoutJob = {
      id: request.retryCandidateId,
      providerId: slot.providerId,
      slug: slot.slug,
      displayName: slot.model,
      provider: slot.provider,
      accent: "indigo",
      strategyLabel: "Parallel model",
    };

    const messages = draftMessages({
      systemPrompt: request.task.systemPrompt,
      prompt: request.task.prompt,
      attachments: request.attachments,
      capabilities: getModelCapabilities(job.providerId, job.slug),
    });
    const attemptId = generateId();
    const startedAt = now();

    try {
      await events.onCandidateAttemptStart(job.id, attemptId, { messages, startedAt });
    } catch {
      return;
    }

    if (isAborted(signal)) return;

    const result = await runCandidateStream(job, messages, request.task.temperature, events, signal);
    if (!result || "error" in result) {
      if (!isAborted(signal) || (result && "error" in result)) {
        await events.onCandidateAttemptTerminal(job.id, attemptId, {
          status: "failed", output: null, tokensIn: null, tokensOut: null,
          error: result && "error" in result
            ? result.error
            : sanitizeError(new Error("Candidate retry aborted"), { category: "aborted", stage: "candidate", model: job.slug }),
          finishedAt: now(),
        }).catch(() => {});
      }
      return; // failure → no downstream calls
    }

    events.onCandidateTerminal(job.id, {
      segments: result.segments,
      summary: result.summary,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      finishedAt: result.finishedAt,
    });

    await events.onCandidateAttemptTerminal(job.id, attemptId, {
      status: "completed",
      output: result.content,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      error: null,
      finishedAt: result.finishedAt,
    }).catch(() => {});

    if (isAborted(signal)) return;

    // Build the updated candidate set: retry result + frozen peers.
    const retryCandidate: Candidate = {
      id: request.retryCandidateId,
      model: job.displayName,
      provider: job.provider,
      providerId: job.providerId,
      slug: job.slug,
      accent: job.accent,
      strategy: job.strategyLabel,
      summary: result.summary,
      scores: {},
      weightedScore: 0,
      segments: result.segments,
      status: "done",
      startedAt,
      finishedAt: result.finishedAt,
    };
    const allDone = [...request.peerCandidates, retryCandidate].filter(isUsableCandidate);
    if (allDone.length < 2) return;

    // Use the frozen peer attempt IDs from the request, overriding the
    // retried candidate's entry with the new attempt ID.
    const candidateAttemptIds: Record<string, string> = {
      ...request.candidateAttemptIdsByCandidateId,
      [request.retryCandidateId]: attemptId,
    };

    const judgeResult = await runJudge(
      allDone,
      { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
      candidateAttemptIds,
      events,
      signal,
    );

    if (!judgeResult.ok || isAborted(signal)) return;

    if (request.mode === "fuse") {
      await runFusion(
        judgeResult.blindSet.candidates,
        { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
        judgeResult.attemptId,
        candidateAttemptIds,
        events,
        signal,
      );
    }
  }

  // --- retryJudge -------------------------------------------------------------

  async function retryJudge(request: FrozenJudgeRetryRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void> {
    const done = request.candidates.filter(isUsableCandidate);
    if (done.length < 2) return;

    // Use the frozen candidate attempt references from the request directly.
    const candidateAttemptIds = request.candidateAttemptIdsByCandidateId;

    const judgeResult = await runJudge(
      done,
      { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
      candidateAttemptIds,
      events,
      signal,
    );

    if (!judgeResult.ok || isAborted(signal)) return;

    if (request.mode === "fuse") {
      await runFusion(
        judgeResult.blindSet.candidates,
        { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
        judgeResult.attemptId,
        candidateAttemptIds,
        events,
        signal,
      );
    }
  }

  // --- executeFusionAttempt ---------------------------------------------------

  async function executeFusionAttempt(request: FrozenFusionRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void> {
    const done = request.candidates.filter(isUsableCandidate);
    if (done.length < 2) return;

    // Rebuild the blind packet from the frozen label map of the source Judge
    // attempt — a re-fusion reuses the exact original labels (no reshuffle).
    // When no frozen map is available (no persisted record), fall back to a
    // fresh blind labeling of the usable candidates.
    let blindCandidates: BlindCandidate[] = [];
    for (const [label, candidateId] of Object.entries(request.blindLabelToCandidateId)) {
      const candidate = done.find((c) => c.id === candidateId);
      if (!candidate) continue;
      blindCandidates.push({ label, candidateId, content: candidateFullText(candidate) });
    }
    if (blindCandidates.length < 2) {
      blindCandidates = createBlindCandidateSet(done, random).candidates;
    }

    await runFusion(
      blindCandidates,
      { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge },
      request.judgeAttemptId,
      request.candidateAttemptIdsByCandidateId,
      events,
      signal,
    );
  }

  return { executeTask, retryCandidate, retryJudge, executeFusionAttempt };
}
