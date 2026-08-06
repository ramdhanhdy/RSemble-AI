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

import type { ChatMessage, ChatOptions, CostRecord, CriticRef, InputUsageEstimate, ProviderId, ReasoningPolicy, UsageBreakdown } from "./providers/types";
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
import { costFromSnapshot, estimateTokens, inputUsageEstimate } from "./cost";
import { getModelPricing } from "./providers/pricing";
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
import { devTerminalLog, type DevTerminalFields } from "./dev-terminal-log";
import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  isExecutionTimeoutError,
  runWithExecutionDeadlines,
  streamWithExecutionDeadlines,
  type DeadlineDependencies,
} from "./execution-deadline";

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
  /** Requested candidate and Judge effort, frozen with the run. */
  reasoningPolicy?: ReasoningPolicy;
  /** When present, skip generation for reused candidates and execute only
   *  the listed model keys, feeding reused + fresh outputs into one Judge
   *  pass (spec §11.3, Task 10). */
  candidateExecution?: {
    executeModelKeys: string[];
    seededCandidates: Candidate[];
    /** Fresh seed attempt IDs for every reused candidate, keyed by
     *  candidateId — the Judge attempt record needs immutable attempt
     *  references for every judged output (spec §11.3, Task 10). */
    seededAttemptIdsByCandidateId: Record<string, string>;
  };
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
  reasoningPolicy?: ReasoningPolicy;
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
  reasoningPolicy?: ReasoningPolicy;
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
  reasoningPolicy?: ReasoningPolicy;
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
      tokensIn: number | null;
      tokensOut: number | null;
      inputEstimate?: InputUsageEstimate;
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
      usage?: UsageBreakdown | null;
      inputEstimate?: InputUsageEstimate;
      cost?: CostRecord | null;
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
      usage?: UsageBreakdown | null;
      inputEstimate?: InputUsageEstimate;
      cost?: CostRecord | null;
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
      usage?: UsageBreakdown | null;
      inputEstimate?: InputUsageEstimate;
      cost?: CostRecord | null;
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

export interface ExecutionDeadlinePolicy {
  /** Time from dispatch until the first provider response/stream event. */
  connectMs: number;
  /** Maximum gap between accepted stream events. */
  inactivityMs: number;
  /** Optional total ceiling; omitted by default for long reasoning. */
  overallMs?: number;
}

export interface RunExecutorDeps {
  /** Random source for the blind-label shuffle. Tests inject deterministic. */
  random?: () => number;
  /** ID generator for attempt IDs. Tests inject deterministic. */
  generateId?: () => string;
  /** Clock for timestamps. Tests inject deterministic. Defaults to Date.now. */
  now?: () => number;
  /** Provider-neutral deadline overrides; adapters may replace these defaults. */
  deadlines?: Partial<ExecutionDeadlinePolicy>;
  /** Fake clock/timer surface for deterministic deadline tests. */
  deadlineDeps?: DeadlineDependencies;
}

// --- Factory -----------------------------------------------------------------

export function createRunExecutor(deps: RunExecutorDeps = {}): RunExecutor {
  const random = deps.random ?? Math.random;
  const generateId = deps.generateId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  const deadlinePolicy: ExecutionDeadlinePolicy = {
    ...DEFAULT_PROVIDER_DEADLINE_POLICY,
    ...deps.deadlines,
  };
  // Execution timestamps and deadline clocks are separate seams. Do not feed
  // the persistence `now` into deadline timers unless tests explicitly inject
  // `deadlineDeps`; otherwise ordinary lifecycle tests gain extra clock ticks.
  const deadlineDeps: DeadlineDependencies = { ...deps.deadlineDeps };

  /**
   * Honest fallback when a provider omits native usage/cost (spec 06 §4):
   * catalog-estimate only when an exact execution-time price is known,
   * otherwise an Unknown record — never a fabricated total.
   */
  function estimateFallbackCost(providerId: string, model: string, tokensIn: number | null, tokensOut: number | null): CostRecord {
    const snapshot = getModelPricing(providerId as ProviderId, model);
    const estimated = costFromSnapshot(snapshot ?? undefined, { inputTokens: tokensIn, outputTokens: tokensOut });
    return estimated ?? { usd: null, source: "unknown" };
  }

  function isAborted(signal: AbortSignal): boolean {
    return signal.aborted;
  }

  // Persisted errors carry only the allowlisted shape (spec §18): a redacted,
  // byte-capped message plus category/stage/model/at — never raw provider
  // bodies or configured credential values.
  function sanitizeError(err: unknown, ctx: SanitizeErrorContext): PersistedError {
    const timeout = isExecutionTimeoutError(err) ? err : null;
    return sanitizePersistedError(
      err,
      timeout
        ? { ...ctx, category: "timeout", timeoutKind: timeout.kind, configuredDurationMs: timeout.configuredDurationMs, elapsedMs: timeout.elapsedMs }
        : ctx,
      now,
      configuredCredentialValues(),
    );
  }

  function sourceFields(source: RunSource | undefined): DevTerminalFields {
    if (!source || source.kind !== "experiment") return {};
    return {
      experimentId: source.experimentId,
      taskId: source.taskId,
      experimentAttemptId: source.experimentTaskAttemptId,
    };
  }

  // --- Candidate fanout (shared by executeTask and retryCandidate) -----------

  async function runCandidateStream(
    job: FanoutJob,
    messages: ChatMessage[],
    temperature: number,
    events: RunExecutorEvents,
    signal: AbortSignal,
    diagnostics: { source?: RunSource; attemptId: string; reasoningEffort?: ReasoningPolicy["candidates"] },
  ): Promise<{ content: string; segments: CandidateSegment[]; summary: string; tokensIn: number | null; tokensOut: number | null; inputEstimate?: InputUsageEstimate; usage?: UsageBreakdown | null; cost?: CostRecord | null; finishedAt: number } | { error: PersistedError } | null> {
    const provider = getProvider(job.providerId);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    const requestStartedAt = Date.now();
    const context = {
      ...sourceFields(diagnostics.source),
      attemptId: diagnostics.attemptId,
      modelKey: `${job.providerId}:${job.slug}`,
      stage: "candidate",
    };
    devTerminalLog("provider.request.started", context, "info");
    try {
      let content = "";
      let usage: UsageBreakdown | null = null;
      let cost: CostRecord | null = null;
      const opts: ChatOptions = {
        model: job.slug,
        messages,
        temperature,
        reasoningEffort: diagnostics.reasoningEffort,
        connectMs: deadlinePolicy.connectMs,
        inactivityMs: deadlinePolicy.inactivityMs,
        overallMs: deadlinePolicy.overallMs,
        signal: ctrl.signal,
      };
      const streamOptions = {
        ...deadlineDeps,
        ...deadlinePolicy,
        provider: job.providerId,
        model: job.slug,
        stage: "candidate",
        signal: ctrl.signal,
        abortController: ctrl,
      };
      if (provider.chatCompletionStreamDetailed) {
        const source = provider.chatCompletionStreamDetailed(opts);
        const stream = provider.executionDeadlines ? source : streamWithExecutionDeadlines(source, streamOptions);
        for await (const event of stream) {
          if (isAborted(signal)) return null;
          if (event.delta) {
            content += event.delta;
            events.onCandidateDelta(job.id, event.delta);
          }
          if (event.usage) usage = event.usage;
          if (event.cost) cost = event.cost;
        }
      } else {
        const source = provider.chatCompletionStream(opts);
        const stream = provider.executionDeadlines ? source : streamWithExecutionDeadlines(source, streamOptions);
        for await (const delta of stream) {
          if (isAborted(signal)) return null;
          content += delta;
          events.onCandidateDelta(job.id, delta);
        }
      }
      if (isAborted(signal)) return null;
      const segments = splitSegments(content, job.id);
      const summary = summarize(content);
      const inputEstimate = inputUsageEstimate(messages, usage);
      const tokensIn = inputEstimate.totalTokens;
      const tokensOut = usage?.outputTokens ?? estimateTokens(content);
      const resolvedCost =
        cost ?? estimateFallbackCost(job.providerId, job.slug, tokensIn, tokensOut);
      devTerminalLog("provider.request.completed", {
        ...context,
        status: "completed",
        durationMs: Date.now() - requestStartedAt,
        tokensIn,
        tokensOut,
      }, "info");
      return { content, segments, summary, tokensIn, tokensOut, inputEstimate, usage, cost: resolvedCost, finishedAt: now() };
    } catch (err) {
      if (isExecutionTimeoutError(err)) {
        const error = sanitizeError(err, { category: "timeout", stage: "candidate", model: job.slug });
        devTerminalLog("provider.request.failed", { ...context, status: "failed", durationMs: Date.now() - requestStartedAt, error: error.message, timeoutKind: err.kind }, "error");
        return { error };
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        if (isAborted(signal)) {
          devTerminalLog("provider.request.aborted", {
            ...context,
            status: "aborted",
            durationMs: Date.now() - requestStartedAt,
          }, "warn");
        }
        return null;
      }
      if (isAborted(signal)) {
        devTerminalLog("provider.request.aborted", {
          ...context,
          status: "aborted",
          durationMs: Date.now() - requestStartedAt,
        }, "warn");
        return null;
      }
      // Provider errors fail this candidate (not the whole run); return the
      // bounded sanitized error so the caller records it on the attempt.
      const error = sanitizeError(err, { category: "provider", stage: "candidate", model: job.slug });
      devTerminalLog("provider.request.failed", {
        ...context,
        status: "failed",
        durationMs: Date.now() - requestStartedAt,
        // Only the already-sanitized message crosses the log boundary; raw
        // stacks may contain provider bodies or credentials (Plan 003 D).
        error: error.message,
      }, "error");
      return { error };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // --- Judge (shared by executeTask, retryCandidate, retryJudge) --------------

  async function runJudge(
    done: Candidate[],
    request: { source?: RunSource; task: CandidateTaskSnapshot; evaluation: AdHocEvaluationConfig; critic: CriticRef; judgeInstruction: string; attachments: Attachment[]; attachmentsToJudge: boolean; reasoningPolicy?: ReasoningPolicy },
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
    const judgeLogStartedAt = Date.now();
    const judgeContext = {
      ...sourceFields(request.source),
      attemptId,
      modelKey: `${request.critic.providerId}:${request.critic.model}`,
      stage: "judge",
    };

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
    devTerminalLog("judge.request.started", judgeContext, "info");
    try {
      let content: string;
      let usage: UsageBreakdown | null = null;
      let cost: CostRecord | null = null;
      const judgeOpts: ChatOptions = {
        model: request.critic.model,
        messages,
        temperature: 0.1,
        reasoningEffort: request.reasoningPolicy?.judge,
        connectMs: deadlinePolicy.connectMs,
        inactivityMs: deadlinePolicy.inactivityMs,
        overallMs: deadlinePolicy.overallMs,
        signal: ctrl.signal,
      };
      const operationOptions = {
        ...deadlineDeps,
        ...deadlinePolicy,
        provider: request.critic.providerId,
        model: request.critic.model,
        stage: "judge",
        signal: ctrl.signal,
        abortController: ctrl,
      };
      if (provider.chatCompletionDetailed) {
        const detailed = provider.executionDeadlines
          ? await provider.chatCompletionDetailed(judgeOpts)
          : await runWithExecutionDeadlines(
            (deadlineSignal) => provider.chatCompletionDetailed!({ ...judgeOpts, signal: deadlineSignal }),
            operationOptions,
          );
        content = detailed.content;
        usage = detailed.usage;
        cost = detailed.cost;
      } else {
        content = provider.executionDeadlines
          ? await provider.chatCompletion(judgeOpts)
          : await runWithExecutionDeadlines(
            (deadlineSignal) => provider.chatCompletion({ ...judgeOpts, signal: deadlineSignal }),
            operationOptions,
          );
      }
      if (isAborted(signal)) {
        await events.onJudgeTerminal(attemptId, {
          status: "aborted", report: null, consensus: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false };
      }
      const { breakdown, scoresById, report } = parseJudge(content, blindSet, profile, done);
      const inputEstimate = inputUsageEstimate(messages, usage);
      const resolvedCost =
        cost ??
        estimateFallbackCost(
          request.critic.providerId,
          request.critic.model,
          inputEstimate.totalTokens,
          usage?.outputTokens ?? estimateTokens(content),
        );
      await events.onJudgeTerminal(attemptId, {
        status: "completed", report, consensus: breakdown, usage, inputEstimate, cost: resolvedCost, error: null, finishedAt: now(),
      });
      devTerminalLog("judge.request.completed", {
        ...judgeContext,
        status: "completed",
        durationMs: Date.now() - judgeLogStartedAt,
      }, "info");
      return { ok: true, attemptId, report, consensus: breakdown, scoresById, blindSet };
    } catch (err) {
      if (isExecutionTimeoutError(err)) {
        const error = sanitizeError(err, { category: "timeout", stage: "judge", model: request.critic.model });
        await events.onJudgeTerminal(attemptId, {
          status: "failed", report: null, consensus: null,
          error,
          finishedAt: now(),
        }).catch(() => {});
        devTerminalLog("judge.request.failed", {
          ...judgeContext,
          status: "failed",
          durationMs: Date.now() - judgeLogStartedAt,
          error: error.message,
          timeoutKind: err.kind,
        }, "error");
        return { ok: false };
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        if (isAborted(signal)) {
          devTerminalLog("judge.request.aborted", {
            ...judgeContext,
            status: "aborted",
            durationMs: Date.now() - judgeLogStartedAt,
          }, "warn");
        }
        await events.onJudgeTerminal(attemptId, {
          status: "aborted", report: null, consensus: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false };
      }
      if (isAborted(signal)) {
        devTerminalLog("judge.request.aborted", {
          ...judgeContext,
          status: "aborted",
          durationMs: Date.now() - judgeLogStartedAt,
        }, "warn");
        return { ok: false };
      }
      const error = sanitizeError(err, { category: "provider", stage: "judge", model: request.critic.model });
      await events.onJudgeTerminal(attemptId, {
        status: "failed", report: null, consensus: null,
        error, finishedAt: now(),
      }).catch(() => {});
      devTerminalLog("judge.request.failed", {
        ...judgeContext,
        status: "failed",
        durationMs: Date.now() - judgeLogStartedAt,
        // Only the already-sanitized message crosses the log boundary; raw
        // stacks may contain provider bodies or credentials (Plan 003 D).
        error: error.message,
      }, "error");
      return { ok: false };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  // --- Fusion (shared by executeTask, retryCandidate, retryJudge, executeFusionAttempt) ---

  async function runFusion(
    blindCandidates: BlindCandidate[],
    request: { task: CandidateTaskSnapshot; evaluation: AdHocEvaluationConfig; critic: CriticRef; judgeInstruction?: string; attachments: Attachment[]; attachmentsToJudge: boolean; reasoningPolicy?: ReasoningPolicy },
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
    const fusionLogStartedAt = Date.now();

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

    devTerminalLog("fusion.request.started", {
      attemptId,
      modelKey: `${request.critic.providerId}:${request.critic.model}`,
      stage: "fusion",
    }, "info");
    const provider = getProvider(request.critic.providerId);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    try {
      let content: string;
      let usage: UsageBreakdown | null = null;
      let cost: CostRecord | null = null;
      const fusionOpts: ChatOptions = {
        model: request.critic.model,
        messages,
        temperature: 0.3,
        reasoningEffort: request.reasoningPolicy?.judge,
        connectMs: deadlinePolicy.connectMs,
        inactivityMs: deadlinePolicy.inactivityMs,
        overallMs: deadlinePolicy.overallMs,
        signal: ctrl.signal,
      };
      const operationOptions = {
        ...deadlineDeps,
        ...deadlinePolicy,
        provider: request.critic.providerId,
        model: request.critic.model,
        stage: "fusion",
        signal: ctrl.signal,
        abortController: ctrl,
      };
      if (provider.chatCompletionDetailed) {
        const detailed = provider.executionDeadlines
          ? await provider.chatCompletionDetailed(fusionOpts)
          : await runWithExecutionDeadlines(
            (deadlineSignal) => provider.chatCompletionDetailed!({ ...fusionOpts, signal: deadlineSignal }),
            operationOptions,
          );
        content = detailed.content;
        usage = detailed.usage;
        cost = detailed.cost;
      } else {
        content = provider.executionDeadlines
          ? await provider.chatCompletion(fusionOpts)
          : await runWithExecutionDeadlines(
            (deadlineSignal) => provider.chatCompletion({ ...fusionOpts, signal: deadlineSignal }),
            operationOptions,
          );
      }
      if (isAborted(signal)) {
        await events.onFusionTerminal(attemptId, {
          status: "aborted", result: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false, result: null };
      }
      const inputEstimate = inputUsageEstimate(messages, usage);
      const resolvedCost =
        cost ??
        estimateFallbackCost(
          request.critic.providerId,
          request.critic.model,
          inputEstimate.totalTokens,
          usage?.outputTokens ?? estimateTokens(content),
        );
      await events.onFusionTerminal(attemptId, {
        status: "completed", result: content, usage, inputEstimate, cost: resolvedCost, error: null, finishedAt: now(),
      });
      devTerminalLog("fusion.request.completed", {
        attemptId,
        modelKey: `${request.critic.providerId}:${request.critic.model}`,
        stage: "fusion",
        status: "completed",
        durationMs: Date.now() - fusionLogStartedAt,
      }, "info");
      return { ok: true, result: content };
    } catch (err) {
      if (isExecutionTimeoutError(err)) {
        const error = sanitizeError(err, { category: "timeout", stage: "fusion", model: request.critic.model });
        await events.onFusionTerminal(attemptId, {
          status: "failed", result: null,
          error,
          finishedAt: now(),
        }).catch(() => {});
        devTerminalLog("fusion.request.failed", {
          attemptId,
          modelKey: `${request.critic.providerId}:${request.critic.model}`,
          stage: "fusion",
          status: "failed",
          durationMs: Date.now() - fusionLogStartedAt,
          error: error.message,
          timeoutKind: err.kind,
        }, "error");
        return { ok: false, result: null };
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        if (isAborted(signal)) {
          devTerminalLog("fusion.request.aborted", {
            attemptId,
            modelKey: `${request.critic.providerId}:${request.critic.model}`,
            stage: "fusion",
            status: "aborted",
            durationMs: Date.now() - fusionLogStartedAt,
          }, "warn");
        }
        await events.onFusionTerminal(attemptId, {
          status: "aborted", result: null, error: null, finishedAt: now(),
        }).catch(() => {});
        return { ok: false, result: null };
      }
      if (isAborted(signal)) {
        devTerminalLog("fusion.request.aborted", {
          attemptId,
          modelKey: `${request.critic.providerId}:${request.critic.model}`,
          stage: "fusion",
          status: "aborted",
          durationMs: Date.now() - fusionLogStartedAt,
        }, "warn");
        return { ok: false, result: null };
      }
      const error = sanitizeError(err, { category: "provider", stage: "fusion", model: request.critic.model });
      await events.onFusionTerminal(attemptId, {
        status: "failed", result: null,
        error, finishedAt: now(),
      }).catch(() => {});
      devTerminalLog("fusion.request.failed", {
        attemptId,
        modelKey: `${request.critic.providerId}:${request.critic.model}`,
        stage: "fusion",
        status: "failed",
        durationMs: Date.now() - fusionLogStartedAt,
        error: error.message,
      }, "error");
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

    // --- Targeted candidate execution (spec §11.3, Task 10) ---
    // When candidateExecution is present, skip generation for reused (seeded)
    // candidates and execute only the listed model keys, then feed reused +
    // fresh outputs into one fresh Judge pass.
    if (request.candidateExecution) {
      const { executeModelKeys, seededCandidates } = request.candidateExecution;
      const executeSet = new Set(executeModelKeys);
      const jobByKey = new Map(jobs.map((j) => [`${j.providerId}:${j.slug}`, j]));

      // Validate: every execute key belongs to slots.
      for (const key of executeModelKeys) {
        if (!jobByKey.has(key)) {
          throw new Error(`candidateExecution: execute key ${key} not found in slots`);
        }
      }
      // Validate: seeded and execute keys do not overlap.
      const seededKeys = new Set(seededCandidates.map((c) => `${c.providerId}:${c.slug}`));
      for (const key of executeModelKeys) {
        if (seededKeys.has(key)) {
          throw new Error(`candidateExecution: ${key} appears in both seeded and execute lists`);
        }
      }
      // Validate: no duplicate in execute keys.
      if (new Set(executeModelKeys).size !== executeModelKeys.length) {
        throw new Error("candidateExecution: duplicate model keys in executeModelKeys");
      }

      try {
        await events.onFanoutStart();
      } catch {
        return;
      }
      if (isAborted(signal)) return;

      const candidateAttemptIds: Record<string, string> = {};
      // Seed the attempt map with reused candidates' fresh attempt IDs so
      // the Judge attempt record carries immutable references for every
      // judged output (spec §11.3, Task 10).
      const { seededAttemptIdsByCandidateId } = request.candidateExecution;
      for (const c of seededCandidates) {
        if (seededAttemptIdsByCandidateId[c.id]) {
          candidateAttemptIds[c.id] = seededAttemptIdsByCandidateId[c.id];
        } else {
          throw new Error(`candidateExecution: missing seed attempt ID for reused candidate ${c.id}`);
        }
      }
      const candidateResults: Map<string, { segments: CandidateSegment[]; summary: string; tokensIn: number | null; tokensOut: number | null; inputEstimate?: InputUsageEstimate; finishedAt: number; content: string }> = new Map();

      // Execute only the requested model keys.
      const executeJobs = jobs.filter((j) => executeSet.has(`${j.providerId}:${j.slug}`));
      await Promise.all(
        executeJobs.map(async (job): Promise<void> => {
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
          } catch (err) {
            await events.onCandidateAttemptTerminal(job.id, attemptId, {
              status: "failed", output: null, tokensIn: null, tokensOut: null,
              error: sanitizeError(err, { category: "storage", stage: "candidate", model: job.slug }),
              finishedAt: now(),
            }).catch(() => {});
            return;
          }

          if (isAborted(signal)) return;

          const result = await runCandidateStream(job, messages, request.task.temperature, events, signal, {
            source: request.source,
            attemptId,
            reasoningEffort: request.reasoningPolicy?.candidates,
          });
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
            inputEstimate: result.inputEstimate,
            finishedAt: result.finishedAt,
          });

          candidateAttemptIds[job.id] = attemptId;
          candidateResults.set(job.id, result);

          await events.onCandidateAttemptTerminal(job.id, attemptId, {
            status: "completed",
            output: result.content,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            usage: result.usage,
            inputEstimate: result.inputEstimate,
            cost: result.cost,
            error: null,
            finishedAt: result.finishedAt,
          }).catch(() => {});
        }),
      );

      if (isAborted(signal)) return;

      // Build the done set: fresh results + seeded reused candidates.
      const done: Candidate[] = [];
      // Fresh candidates from provider calls.
      for (const j of executeJobs) {
        const r = candidateResults.get(j.id);
        if (!r) continue;
        done.push({
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
        });
      }
      // Seeded reused candidates — their outputs are already complete.
      for (const c of seededCandidates) {
        if (isUsableCandidate(c)) done.push(c);
      }

      try {
        await events.onFanoutTerminal(done);
      } catch {
        return;
      }

      if (isAborted(signal)) return;
      if (done.length < 2) return;

      const judgeResult = await runJudge(
        done,
        { source: request.source, task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
        candidateAttemptIds,
        events,
        signal,
      );

      if (!judgeResult.ok) return;
      if (isAborted(signal)) return;

      if (request.mode === "fuse") {
        await runFusion(
          judgeResult.blindSet.candidates,
          { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
          judgeResult.attemptId,
          candidateAttemptIds,
          events,
          signal,
        );
      }
      return;
    }

    // --- Normal executeTask path (no candidateExecution) ---
    try {
      await events.onFanoutStart();
    } catch {
      return; // fanout-start rejection → zero provider calls
    }

    if (isAborted(signal)) return;

    const candidateAttemptIds: Record<string, string> = {};
    const candidateResults: Map<string, { segments: CandidateSegment[]; summary: string; tokensIn: number | null; tokensOut: number | null; inputEstimate?: InputUsageEstimate; finishedAt: number; content: string }> = new Map();

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
        } catch (err) {
          await events.onCandidateAttemptTerminal(job.id, attemptId, {
            status: "failed",
            output: null,
            tokensIn: null,
            tokensOut: null,
            error: sanitizeError(err, { category: "storage", stage: "candidate", model: job.slug }),
            finishedAt: now(),
          }).catch(() => {});
          return;
        }

        if (isAborted(signal)) return;

        const result = await runCandidateStream(job, messages, request.task.temperature, events, signal, {
          source: request.source,
          attemptId,
          reasoningEffort: request.reasoningPolicy?.candidates,
        });
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
          inputEstimate: result.inputEstimate,
          finishedAt: result.finishedAt,
        });

        candidateAttemptIds[job.id] = attemptId;
        candidateResults.set(job.id, result);

        await events.onCandidateAttemptTerminal(job.id, attemptId, {
          status: "completed",
          output: result.content,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          usage: result.usage,
          inputEstimate: result.inputEstimate,
          cost: result.cost,
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
      { source: request.source, task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
      candidateAttemptIds,
      events,
      signal,
    );

    if (!judgeResult.ok) return;
    if (isAborted(signal)) return;

    if (request.mode === "fuse") {
      await runFusion(
        judgeResult.blindSet.candidates,
        { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
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
    } catch (err) {
      await events.onCandidateAttemptTerminal(job.id, attemptId, {
        status: "failed",
        output: null,
        tokensIn: null,
        tokensOut: null,
        error: sanitizeError(err, { category: "storage", stage: "candidate", model: job.slug }),
        finishedAt: now(),
      }).catch(() => {});
      return;
    }

    if (isAborted(signal)) return;

    const result = await runCandidateStream(job, messages, request.task.temperature, events, signal, {
      source: request.source,
      attemptId,
      reasoningEffort: request.reasoningPolicy?.candidates,
    });
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
      inputEstimate: result.inputEstimate,
      finishedAt: result.finishedAt,
    });

    await events.onCandidateAttemptTerminal(job.id, attemptId, {
      status: "completed",
      output: result.content,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      usage: result.usage,
      inputEstimate: result.inputEstimate,
      cost: result.cost,
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
      { source: request.source, task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
      candidateAttemptIds,
      events,
      signal,
    );

    if (!judgeResult.ok || isAborted(signal)) return;

    if (request.mode === "fuse") {
      await runFusion(
        judgeResult.blindSet.candidates,
        { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
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
      { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
      candidateAttemptIds,
      events,
      signal,
    );

    if (!judgeResult.ok || isAborted(signal)) return;

    if (request.mode === "fuse") {
      await runFusion(
        judgeResult.blindSet.candidates,
        { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
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
      { task: request.task, evaluation: request.evaluation, critic: request.critic, judgeInstruction: request.judgeInstruction, attachments: request.attachments, attachmentsToJudge: request.attachmentsToJudge, reasoningPolicy: request.reasoningPolicy },
      request.judgeAttemptId,
      request.candidateAttemptIdsByCandidateId,
      events,
      signal,
    );
  }

  return { executeTask, retryCandidate, retryJudge, executeFusionAttempt };
}
