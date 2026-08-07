// =============================================================================
// RSemble AI — Execution stage runners (provider-agnostic)
//
// Extracted from run-executor (Plan 007 Workstream B). Each runner owns exactly
// one provider stage of the Compare spine:
//   runCandidateStream — one candidate request/stream, usage, cost, terminal result;
//   runJudge           — blind-set construction, Judge request, parse/validation;
//   runFusion          — synthesis and re-Fuse execution.
// They share a typed `RunStageContext` (DI + helper surface) built by
// `createRunStageContext`; stage ordering, retry orchestration and
// insufficient-candidate decisions remain the caller's responsibility. No React
// state, localStorage, or persistence lives here.
// =============================================================================

import type {
  ChatMessage,
  ChatOptions,
  CostRecord,
  CriticRef,
  InputUsageEstimate,
  ReasoningPolicy,
  UsageBreakdown,
} from "./providers/types";
import type {
  BlindCandidate,
  Candidate,
  CandidateSegment,
  JudgeReport,
  ConsensusBreakdown,
} from "../studio-data";
import { getProvider } from "./providers/registry";
import { getModelCapabilities } from "./providers/capabilities";
import type { Attachment } from "./attachments/types";
import type { RunSource, PersistedError } from "./persistence/run-types";
import { estimateFallbackCost } from "./execution-cost";
import { estimateTokens, inputUsageEstimate } from "./cost";
import {
  createBlindCandidateSet,
  fusionMessages,
  judgeMessages,
  parseJudge,
  splitSegments,
  summarize,
  type BlindCandidateSet,
  type FanoutJob,
} from "./pipeline";
import {
  resolveEvaluationProfile,
  type AdHocEvaluationConfig,
} from "./evaluations/evaluation-profile-adhoc";
import { devTerminalLog, type DevTerminalFields } from "./dev-terminal-log";
import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  isExecutionTimeoutError,
  runWithExecutionDeadlines,
  streamWithExecutionDeadlines,
  type DeadlineDependencies,
} from "./execution-deadline";
import {
  sanitizePersistedError,
  configuredCredentialValues,
  type SanitizeErrorContext,
} from "./persistence/error-redaction";
import type {
  CandidateTaskSnapshot,
  ExecutionDeadlinePolicy,
  RunExecutorDeps,
  RunExecutorEvents,
} from "./run-executor";

// --- Shared stage context ---------------------------------------------------
// The DI + helper surface injected into every stage runner by the executor
// factory. Keeps stage functions pure relative to orchestration: they receive
// clocks, ids, deadline policy, cost resolution and error sanitization as an
// explicit context instead of closing over the executor closure.

export interface RunStageContext {
  random: () => number;
  generateId: () => string;
  now: () => number;
  deadlinePolicy: ExecutionDeadlinePolicy;
  deadlineDeps: DeadlineDependencies;
  estimateFallbackCost: (
    providerId: string,
    model: string,
    tokensIn: number | null,
    tokensOut: number | null,
  ) => CostRecord;
  sanitizeError(err: unknown, ctx: SanitizeErrorContext): PersistedError;
  sourceFields(source: RunSource | undefined): DevTerminalFields;
  isAborted(signal: AbortSignal): boolean;
}

export function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

export function sourceFields(source: RunSource | undefined): DevTerminalFields {
  if (!source || source.kind !== "experiment") return {};
  return {
    experimentId: source.experimentId,
    taskId: source.taskId,
    experimentAttemptId: source.experimentTaskAttemptId,
  };
}

export function createRunStageContext(deps: RunExecutorDeps = {}): RunStageContext {
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

  // Persisted errors carry only the allowlisted shape (spec §18): a redacted,
  // byte-capped message plus category/stage/model/at — never raw provider
  // bodies or configured credential values.
  function sanitizeError(err: unknown, ctx: SanitizeErrorContext): PersistedError {
    const timeout = isExecutionTimeoutError(err) ? err : null;
    return sanitizePersistedError(
      err,
      timeout
        ? {
            ...ctx,
            category: "timeout",
            timeoutKind: timeout.kind,
            configuredDurationMs: timeout.configuredDurationMs,
            elapsedMs: timeout.elapsedMs,
          }
        : ctx,
      now,
      configuredCredentialValues(),
    );
  }

  return {
    random,
    generateId,
    now,
    deadlinePolicy,
    deadlineDeps,
    estimateFallbackCost,
    sanitizeError,
    sourceFields,
    isAborted,
  };
}

export async function runCandidateStream(
  ctx: RunStageContext,
  job: FanoutJob,
  messages: ChatMessage[],
  temperature: number,
  events: RunExecutorEvents,
  signal: AbortSignal,
  diagnostics: {
    source?: RunSource;
    attemptId: string;
    reasoningEffort?: ReasoningPolicy["candidates"];
  },
): Promise<
  | {
      content: string;
      segments: CandidateSegment[];
      summary: string;
      tokensIn: number | null;
      tokensOut: number | null;
      inputEstimate?: InputUsageEstimate;
      usage?: UsageBreakdown | null;
      cost?: CostRecord | null;
      finishedAt: number;
    }
  | { error: PersistedError }
  | null
> {
  const {
    isAborted,
    sourceFields,
    deadlinePolicy,
    deadlineDeps,
    estimateFallbackCost,
    sanitizeError,
    now,
  } = ctx;
  const provider = getProvider(job.providerId);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal.aborted) {
    // Already aborted before the stream started — abort the child controller
    // immediately instead of registering a listener that will never fire.
    ctrl.abort();
  } else {
    signal.addEventListener("abort", onAbort);
  }
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
      const stream = provider.executionDeadlines
        ? source
        : streamWithExecutionDeadlines(source, streamOptions);
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
      const stream = provider.executionDeadlines
        ? source
        : streamWithExecutionDeadlines(source, streamOptions);
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
    devTerminalLog(
      "provider.request.completed",
      {
        ...context,
        status: "completed",
        durationMs: Date.now() - requestStartedAt,
        tokensIn,
        tokensOut,
      },
      "info",
    );
    return {
      content,
      segments,
      summary,
      tokensIn,
      tokensOut,
      inputEstimate,
      usage,
      cost: resolvedCost,
      finishedAt: now(),
    };
  } catch (err) {
    if (isExecutionTimeoutError(err)) {
      const error = sanitizeError(err, {
        category: "timeout",
        stage: "candidate",
        model: job.slug,
      });
      devTerminalLog(
        "provider.request.failed",
        {
          ...context,
          status: "failed",
          durationMs: Date.now() - requestStartedAt,
          error: error.message,
          timeoutKind: err.kind,
        },
        "error",
      );
      return { error };
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      if (isAborted(signal)) {
        devTerminalLog(
          "provider.request.aborted",
          {
            ...context,
            status: "aborted",
            durationMs: Date.now() - requestStartedAt,
          },
          "warn",
        );
      }
      return null;
    }
    if (isAborted(signal)) {
      devTerminalLog(
        "provider.request.aborted",
        {
          ...context,
          status: "aborted",
          durationMs: Date.now() - requestStartedAt,
        },
        "warn",
      );
      return null;
    }
    // Provider errors fail this candidate (not the whole run); return the
    // bounded sanitized error so the caller records it on the attempt.
    const error = sanitizeError(err, {
      category: "provider",
      stage: "candidate",
      model: job.slug,
    });
    devTerminalLog(
      "provider.request.failed",
      {
        ...context,
        status: "failed",
        durationMs: Date.now() - requestStartedAt,
        // Only the already-sanitized message crosses the log boundary; raw
        // stacks may contain provider bodies or credentials (Plan 003 D).
        error: error.message,
      },
      "error",
    );
    return { error };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function runJudge(
  ctx: RunStageContext,
  done: Candidate[],
  request: {
    source?: RunSource;
    task: CandidateTaskSnapshot;
    evaluation: AdHocEvaluationConfig;
    critic: CriticRef;
    judgeInstruction: string;
    attachments: Attachment[];
    attachmentsToJudge: boolean;
    reasoningPolicy?: ReasoningPolicy;
  },
  candidateAttemptIdsByCandidateId: Record<string, string>,
  events: RunExecutorEvents,
  signal: AbortSignal,
): Promise<
  | {
      ok: true;
      attemptId: string;
      report: JudgeReport;
      consensus: ConsensusBreakdown;
      scoresById: Record<string, number>;
      blindSet: BlindCandidateSet;
    }
  | { ok: false }
> {
  const {
    random,
    generateId,
    now,
    deadlinePolicy,
    deadlineDeps,
    estimateFallbackCost,
    sanitizeError,
    sourceFields,
    isAborted,
  } = ctx;
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
            (deadlineSignal) =>
              provider.chatCompletionDetailed!({ ...judgeOpts, signal: deadlineSignal }),
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
      await events
        .onJudgeTerminal(attemptId, {
          status: "aborted",
          report: null,
          consensus: null,
          error: null,
          finishedAt: now(),
        })
        .catch(() => {});
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
      status: "completed",
      report,
      consensus: breakdown,
      usage,
      inputEstimate,
      cost: resolvedCost,
      error: null,
      finishedAt: now(),
    });
    devTerminalLog(
      "judge.request.completed",
      {
        ...judgeContext,
        status: "completed",
        durationMs: Date.now() - judgeLogStartedAt,
      },
      "info",
    );
    return { ok: true, attemptId, report, consensus: breakdown, scoresById, blindSet };
  } catch (err) {
    if (isExecutionTimeoutError(err)) {
      const error = sanitizeError(err, {
        category: "timeout",
        stage: "judge",
        model: request.critic.model,
      });
      await events
        .onJudgeTerminal(attemptId, {
          status: "failed",
          report: null,
          consensus: null,
          error,
          finishedAt: now(),
        })
        .catch(() => {});
      devTerminalLog(
        "judge.request.failed",
        {
          ...judgeContext,
          status: "failed",
          durationMs: Date.now() - judgeLogStartedAt,
          error: error.message,
          timeoutKind: err.kind,
        },
        "error",
      );
      return { ok: false };
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      if (isAborted(signal)) {
        devTerminalLog(
          "judge.request.aborted",
          {
            ...judgeContext,
            status: "aborted",
            durationMs: Date.now() - judgeLogStartedAt,
          },
          "warn",
        );
      }
      await events
        .onJudgeTerminal(attemptId, {
          status: "aborted",
          report: null,
          consensus: null,
          error: null,
          finishedAt: now(),
        })
        .catch(() => {});
      return { ok: false };
    }
    if (isAborted(signal)) {
      devTerminalLog(
        "judge.request.aborted",
        {
          ...judgeContext,
          status: "aborted",
          durationMs: Date.now() - judgeLogStartedAt,
        },
        "warn",
      );
      return { ok: false };
    }
    const error = sanitizeError(err, {
      category: "provider",
      stage: "judge",
      model: request.critic.model,
    });
    await events
      .onJudgeTerminal(attemptId, {
        status: "failed",
        report: null,
        consensus: null,
        error,
        finishedAt: now(),
      })
      .catch(() => {});
    devTerminalLog(
      "judge.request.failed",
      {
        ...judgeContext,
        status: "failed",
        durationMs: Date.now() - judgeLogStartedAt,
        // Only the already-sanitized message crosses the log boundary; raw
        // stacks may contain provider bodies or credentials (Plan 003 D).
        error: error.message,
      },
      "error",
    );
    return { ok: false };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function runFusion(
  ctx: RunStageContext,
  blindCandidates: BlindCandidate[],
  request: {
    source?: RunSource;
    task: CandidateTaskSnapshot;
    evaluation: AdHocEvaluationConfig;
    critic: CriticRef;
    judgeInstruction?: string;
    attachments: Attachment[];
    attachmentsToJudge: boolean;
    reasoningPolicy?: ReasoningPolicy;
  },
  sourceJudgeAttemptId: string,
  candidateAttemptIdsByCandidateId: Record<string, string>,
  events: RunExecutorEvents,
  signal: AbortSignal,
): Promise<{ ok: boolean; result: string | null }> {
  const {
    generateId,
    now,
    deadlinePolicy,
    deadlineDeps,
    estimateFallbackCost,
    sanitizeError,
    sourceFields,
    isAborted,
  } = ctx;
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
  const fusionContext = {
    ...sourceFields(request.source),
    attemptId,
    modelKey: `${request.critic.providerId}:${request.critic.model}`,
    stage: "fusion",
  };

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
  devTerminalLog(
    "fusion.request.started",
    {
      ...fusionContext,
    },
    "info",
  );
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
            (deadlineSignal) =>
              provider.chatCompletionDetailed!({ ...fusionOpts, signal: deadlineSignal }),
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
      await events
        .onFusionTerminal(attemptId, {
          status: "aborted",
          result: null,
          error: null,
          finishedAt: now(),
        })
        .catch(() => {});
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
      status: "completed",
      result: content,
      usage,
      inputEstimate,
      cost: resolvedCost,
      error: null,
      finishedAt: now(),
    });
    devTerminalLog(
      "fusion.request.completed",
      {
        ...fusionContext,
        status: "completed",
        durationMs: Date.now() - fusionLogStartedAt,
      },
      "info",
    );
    return { ok: true, result: content };
  } catch (err) {
    if (isExecutionTimeoutError(err)) {
      const error = sanitizeError(err, {
        category: "timeout",
        stage: "fusion",
        model: request.critic.model,
      });
      await events
        .onFusionTerminal(attemptId, {
          status: "failed",
          result: null,
          error,
          finishedAt: now(),
        })
        .catch(() => {});
      devTerminalLog(
        "fusion.request.failed",
        {
          ...fusionContext,
          status: "failed",
          durationMs: Date.now() - fusionLogStartedAt,
          error: error.message,
          timeoutKind: err.kind,
        },
        "error",
      );
      return { ok: false, result: null };
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      if (isAborted(signal)) {
        devTerminalLog(
          "fusion.request.aborted",
          {
            ...fusionContext,
            status: "aborted",
            durationMs: Date.now() - fusionLogStartedAt,
          },
          "warn",
        );
      }
      await events
        .onFusionTerminal(attemptId, {
          status: "aborted",
          result: null,
          error: null,
          finishedAt: now(),
        })
        .catch(() => {});
      return { ok: false, result: null };
    }
    if (isAborted(signal)) {
      devTerminalLog(
        "fusion.request.aborted",
        {
          ...fusionContext,
          status: "aborted",
          durationMs: Date.now() - fusionLogStartedAt,
        },
        "warn",
      );
      return { ok: false, result: null };
    }
    const error = sanitizeError(err, {
      category: "provider",
      stage: "fusion",
      model: request.critic.model,
    });
    await events
      .onFusionTerminal(attemptId, {
        status: "failed",
        result: null,
        error,
        finishedAt: now(),
      })
      .catch(() => {});
    devTerminalLog(
      "fusion.request.failed",
      {
        ...fusionContext,
        status: "failed",
        durationMs: Date.now() - fusionLogStartedAt,
        error: error.message,
      },
      "error",
    );
    return { ok: false, result: null };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
