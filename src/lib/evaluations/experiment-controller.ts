// =============================================================================
// RSemble AI — Experiment controller (spec §11–13, Phase 6.2)
//
// Orchestrates sequential experiment execution through the shared RunExecutor:
//  - tasks execute one at a time in stable suite order; candidate fanout stays
//    parallel within the active task (the executor's internal Promise.all);
//  - begin/commit are fence-verified, atomic, and idempotent (via the UoW);
//  - one task failure never discards completed task runs; a persistence
//    failure stops the queue before another paid task;
//  - pause never aborts the active executor; resume is explicit;
//  - abort reaches the active executor and wins against delayed writes;
//  - reload never silently resumes; recovery adopts committed terminal runs
//    by experimentTaskAttemptId and never repays for them;
//  - Compare/experiment execution mutually exclude in-app, and a secondary
//    tab cannot start, resume, retry, recover, or commit.
// =============================================================================

import type { EvaluationRepository } from "../persistence/evaluation-repository";
import type { ExperimentUnitOfWork } from "../persistence/experiment-unit-of-work";
import type { RunRepository } from "../persistence/run-repository";
import type { RunRecorder } from "../persistence/run-recorder";
import { createRunRecorder } from "../persistence/run-recorder";
import {
  createRunRecordBuilder,
  type RunRecordBuilderState,
  type BuilderDeps,
} from "../persistence/run-record-builder";
import type { ExecutionLease, LeaseInfo } from "../execution-lease";
import { LeaseError } from "../execution-lease";
import type { ExecutionOwnerRegistry } from "../execution-owner";
import type { RunExecutor, RunExecutorEvents } from "../run-executor";
import type {
  EvaluationSuite,
  EvaluationTask,
  EvaluationProfileSnapshot,
  EvaluationSelection,
  ExperimentRecord,
  ExperimentTaskState,
  ExperimentTaskAttempt,
} from "./evaluation-types";
import {
  createExperimentEngine,
  createExperimentRecord,
  mapRunStatusToAttemptStatus,
  selectAttemptId,
  type ExperimentEngine,
} from "./experiment-engine";
import { planMissingCellRepair } from "./experiment-repair";
import { planRosterExtension, rotateExperimentRoster } from "./experiment-roster-extension";
import { aggregateExperiment } from "./experiment-aggregation";
import type { ExperimentRepairPlan, ExperimentTaskExecutionPlan } from "./evaluation-types";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  RunStatus,
  RunSource,
  ExecutionFence,
} from "../persistence/run-types";
import type { AdHocEvaluationConfig } from "./evaluation-profile-adhoc";
import { HOLISTIC_EVALUATION } from "./evaluation-profile-adhoc";
import type { Candidate } from "../../studio-data";
import type { ModelSlot } from "../../studio-data";
import type { ProviderId } from "../providers/types";
import { devTerminalLog } from "../dev-terminal-log";

// --- Events -------------------------------------------------------------------

export type ExperimentControllerEvent =
  | { kind: "task-began"; taskId: string; attemptId: string; runId: string }
  | { kind: "task-terminal"; taskId: string; attemptId: string; status: RunStatus }
  | { kind: "error"; error: string };

// --- Result types -------------------------------------------------------------

export type StartResult = { ok: true; experimentId: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

// --- Controller deps ----------------------------------------------------------

export interface ExperimentControllerDeps {
  evalRepo: EvaluationRepository;
  uow: ExperimentUnitOfWork;
  runRepo: RunRepository;
  lease: ExecutionLease;
  owner: ExecutionOwnerRegistry;
  executor: RunExecutor;
  generateId: () => string;
  now: () => number;
  heartbeatMs: number;
}

// --- Helpers ------------------------------------------------------------------

/**
 * Derive scored-model coverage from a terminal run's accepted Judge report.
 * The judge's `evaluationsById` maps candidate IDs to evaluations; each
 * evaluated candidate's modelKey is a scored snapshot model key (spec §11.5).
 */
function deriveAttemptCoverage(
  run: RunRecordV2,
  snapshotKeys: ReadonlySet<string>,
): { scoredModelKeys: string[]; totalModels: number } {
  const scoredModelKeys: string[] = [];
  const seen = new Set<string>();
  const evaluatedCandidateIds = new Set(Object.keys(run.judge.report?.evaluationsById ?? {}));
  for (const candidate of run.candidates) {
    if (evaluatedCandidateIds.has(candidate.candidateId) && snapshotKeys.has(candidate.modelKey)) {
      if (!seen.has(candidate.modelKey)) {
        seen.add(candidate.modelKey);
        scoredModelKeys.push(candidate.modelKey);
      }
    }
  }
  return { scoredModelKeys, totalModels: snapshotKeys.size };
}

/**
 * Rebuild an execution suite pinned to the immutable experiment snapshot.
 *
 * Retry and recovery must NEVER execute against the live suite: the user may
 * have edited tasks/models/judge since the experiment started, and executing
 * against the mutable suite would produce evidence that no longer matches
 * `record.snapshot` (and would label it with the current suite version).
 *
 * The returned suite is derived entirely from the snapshot and is used only
 * for execution (task text, model roster, judge, default evaluation).
 */
function pinnedSuiteFromSnapshot(record: ExperimentRecord): EvaluationSuite {
  const s = record.snapshot;
  return {
    id: s.suiteId,
    // Pinned identity — revision/version come from the snapshot, not the live suite.
    revision: -1,
    version: s.suiteVersion,
    name: `Suite v${s.suiteVersion} (pinned)`,
    description: "Pinned execution copy of the immutable experiment snapshot.",
    tasks: s.tasks.map((t) => ({ ...t })),
    modelSlots: s.modelSlots.map((m) => ({ ...m })),
    defaultJudge: { ...s.defaultJudge },
    defaultEvaluation: { ...s.defaultEvaluation },
    reasoningPolicy: s.reasoningPolicy ? { ...s.reasoningPolicy } : undefined,
    createdAt: s.createdAt,
    updatedAt: s.createdAt,
    archivedAt: null,
  };
}

/** Resolve a task's evaluation selection to an AdHocEvaluationConfig for the
 *  executor. Inherits the suite default when the task says "inherit". */
function taskEvaluationConfig(
  task: EvaluationTask,
  suite: EvaluationSuite,
  profiles: EvaluationProfileSnapshot[],
): AdHocEvaluationConfig {
  const sel: EvaluationSelection =
    task.evaluation.kind === "inherit"
      ? suite.defaultEvaluation
      : task.evaluation;
  if (sel.kind === "holistic") return HOLISTIC_EVALUATION;
  // Profile selection: find the pinned snapshot by { id, version }.
  const snapshot = profiles.find(
    (p) => p.id === sel.profile.id && p.version === sel.profile.version,
  );
  if (!snapshot) return HOLISTIC_EVALUATION;
  return { kind: "profile", ref: sel.profile, profile: snapshot };
}

/** The experiment branch of RunSource (for spreading repair metadata). */
type ExperimentSource = Extract<RunSource, { kind: "experiment" }>;

/** Build the experiment RunSource for a task attempt. */
function experimentRunSource(
  experiment: ExperimentRecord,
  suite: EvaluationSuite,
  taskId: string,
  attemptId: string,
  trial: number,
): ExperimentSource {
  return {
    kind: "experiment",
    experimentId: experiment.id,
    suiteId: suite.id,
    suiteVersion: suite.version,
    protocolFingerprint: experiment.protocolFingerprint,
    taskId,
    experimentTaskAttemptId: attemptId,
    trial,
  };
}

// --- Controller ---------------------------------------------------------------

export function createExperimentController(deps: ExperimentControllerDeps) {
  const { evalRepo, uow, runRepo, lease, owner, executor } = deps;
  const now = deps.now;
  const generateId = deps.generateId;
  const builder = createRunRecordBuilder({ now } as BuilderDeps);

  // --- Internal state ---------------------------------------------------------
  let engine: ExperimentEngine | null = null;
  let experimentId: string | null = null;
  let suite: EvaluationSuite | null = null;
  let persistedExperimentRevision = 0;
  let abortController: AbortController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatWorker: Worker | undefined;
  let visibilityHandler: (() => void) | undefined;
  let idleResolve: (() => void) | null = null;
  let idlePromise: Promise<void> = new Promise<void>((resolve) => {
    idleResolve = resolve;
  });

  const listeners = new Set<(e: ExperimentControllerEvent) => void>();

  function emit(event: ExperimentControllerEvent): void {
    for (const l of listeners) {
      try {
        l(event);
      } catch {
        // Listener errors must not break the controller.
      }
    }
  }

  function subscribe(listener: (e: ExperimentControllerEvent) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  // --- Idle tracking ----------------------------------------------------------

  function newIdlePromise(): void {
    idlePromise = new Promise<void>((resolve) => {
      idleResolve = resolve;
    });
  }

  function markIdle(): void {
    // loopRunning removed — idle tracking is via idleResolve only.
    if (idleResolve) {
      idleResolve();
    }
  }

  function whenIdle(): Promise<void> {
    return idlePromise;
  }

  // --- Lease / owner lifecycle ------------------------------------------------

  function startHeartbeat(): void {
    stopHeartbeat();
    const interval = deps.heartbeatMs > 0 ? deps.heartbeatMs : 3000;
    const tick = () => {
      void lease.renew().catch(() => {
        // Lease lost — abort the active execution.
        void abortInternal("Lease lost");
      });
    };
    // Browsers throttle setInterval in hidden tabs to ~1/minute, which
    // expires the 10s execution lease and makes the app abort its OWN
    // running experiment (observed live 2026-08: user left the screen
    // mid-extension, came back to an aborted run). Ticking from a dedicated
    // Worker keeps renewals at full cadence while the tab is hidden (H5).
    try {
      if (
        typeof Worker !== "undefined" &&
        typeof Blob !== "undefined" &&
        typeof URL !== "undefined" &&
        typeof URL.createObjectURL === "function"
      ) {
        const blob = new Blob([`setInterval(() => postMessage(0), ${interval});`], {
          type: "application/javascript",
        });
        heartbeatWorker = new Worker(URL.createObjectURL(blob));
        heartbeatWorker.onmessage = tick;
      } else {
        heartbeatTimer = setInterval(tick, interval);
      }
    } catch {
      heartbeatTimer = setInterval(tick, interval);
    }
    // Belt and braces: renew immediately when the tab becomes visible again.
    if (typeof document !== "undefined") {
      visibilityHandler = () => {
        if (document.visibilityState === "visible") tick();
      };
      document.addEventListener("visibilitychange", visibilityHandler);
    }
  }

  function stopHeartbeat(): void {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    if (heartbeatWorker) {
      heartbeatWorker.terminate();
      heartbeatWorker = undefined;
    }
    if (visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = undefined;
    }
  }

  function releaseExecution(): void {
    stopHeartbeat();
    if (experimentId) {
      owner.release(experimentId);
    }
    void lease.release();
  }

  // --- Experiment persistence sync --------------------------------------------

  /** After the UoW atomically writes the experiment task/attempt, sync the
   *  experiment status (and any queue/boundary state) from the engine to the
   *  store. The UoW only writes task/attempt fields; the engine owns status. */
  async function syncExperimentStatus(expectedRevision: number): Promise<number> {
    if (!engine) return expectedRevision;
    const newRev = await evalRepo.updateExperiment(engine.record, expectedRevision);
    persistedExperimentRevision = newRev;
    return newRev;
  }

  // --- Task execution ---------------------------------------------------------

  /** Build the initial RunRecordV2 + summary for a task attempt, to be passed
   *  to uow.beginTask. */
  function buildInitialRun(
    runId: string,
    runSource: RunSource,
    task: EvaluationTask,
    evalConfig: AdHocEvaluationConfig,
    fence: ExecutionFence,
  ): { run: RunRecordV2; summary: FullRunSummaryV2 } {
    if (!suite) throw new Error("Suite not loaded");
    const state: RunRecordBuilderState = { record: null };
    const run = builder.applyFanoutStart(state, {
      runId,
      source: runSource,
      mode: "rank",
      task: {
        title: task.title,
        prompt: task.prompt,
        systemPrompt: task.systemPrompt,
        temperature: 0.7,
      },
      evaluation: {
        profile: evalConfig.kind === "holistic" ? null : evalConfig.profile,
        candidateMessages: [],
      },
      slots: suite.modelSlots,
      critic: suite.defaultJudge,
      reasoningPolicy: suite.reasoningPolicy,
      fence,
    });
    const summary = builder.deriveSummary(run);
    return { run, summary };
  }

  /** Create the executor events adapter for a task run. The run is already
   *  created by uow.beginTask, so onFanoutStart is a no-op. Intermediate
   *  mutations go through the recorder. */
  function makeEvents(runId: string, recorder: RunRecorder): RunExecutorEvents {
    return {
      onFanoutStart: async () => {
        // Run already created by uow.beginTask — nothing to do.
      },
      onCandidateDelta: () => {
        // No streaming in experiment mode.
      },
      onCandidateTerminal: () => {
        // Candidate output finalization is handled by onCandidateAttemptTerminal.
      },
      onFanoutTerminal: async (done: Candidate[]) => {
        await recorder.saveFanout(runId, { candidates: done });
      },
      onCandidateAttemptStart: async (candidateId, attemptId, input) => {
        await recorder.beginCandidateAttempt(runId, candidateId, attemptId, {
          attemptId,
          messages: input.messages,
          startedAt: input.startedAt,
        });
      },
      onCandidateAttemptTerminal: async (candidateId, attemptId, input) => {
        await recorder.finishCandidateAttempt(runId, candidateId, attemptId, input);
      },
      onJudgeStart: async (attemptId, input) => {
        await recorder.beginJudgeAttempt(runId, attemptId, input);
      },
      onJudgeTerminal: async (attemptId, input) => {
        await recorder.finishJudgeAttempt(runId, attemptId, input);
      },
      onFusionStart: async () => {
        // Experiments use rank mode only — no fusion.
      },
      onFusionTerminal: async () => {
        // Experiments use rank mode only — no fusion.
      },
    };
  }

  /** Execute a single task: begin, run executor, commit. Returns the final
   *  run status or throws on persistence failure. An optional `plan` rides
   *  the run source and the terminal attempt (roster-extension full-roster
   *  fallback — plan 001, D3). */
  async function executeTask(
    taskId: string,
    attemptId: string,
    fence: ExecutionFence,
    plan?: ExperimentTaskExecutionPlan,
  ): Promise<RunStatus> {
    if (!engine || !suite) throw new Error("Engine or suite not initialized");
    const record = engine.record;
    const task = suite.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in suite`); 

    const taskState = record.tasks.find((t) => t.taskId === taskId);
    const trial = taskState?.attempts.find((a) => a.id === attemptId)?.trial ?? 0;

    const runId = `run-${generateId()}`;
    const baseSource = experimentRunSource(record, suite, taskId, attemptId, trial);
    const runSource: RunSource = plan ? { ...baseSource, repair: plan } : baseSource;
    devTerminalLog("experiment.task.created", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      stage: "begin",
      status: "queued",
    }, "info");
    const evalConfig = taskEvaluationConfig(task, suite, record.snapshot.profiles);

    // Build initial run + summary.
    const { run: initialRun, summary: initialSummary } = buildInitialRun(
      runId,
      runSource,
      task,
      evalConfig,
      fence,
    );

    // Engine transition: beginTask.
    const beginResult = engine.beginTask(taskId, attemptId, runId, now());
    if (!beginResult.ok) throw new Error(beginResult.reason ?? "beginTask failed");

    // Persist: atomically create run + link attempt.
    const beginRev = await uow.beginTask({
      experimentId: record.id,
      taskId,
      attemptId,
      run: initialRun,
      summary: initialSummary,
      expectedExperimentRevision: persistedExperimentRevision,
      fence,
    });
    persistedExperimentRevision = beginRev.experimentRevision;

    // Sync experiment status (engine may have updated it).
    await syncExperimentStatus(persistedExperimentRevision);

    emit({ kind: "task-began", taskId, attemptId, runId });

    // Create recorder for intermediate updates.
    const recorder = createRunRecorder(runRepo, { now } as BuilderDeps);
    const events = makeEvents(runId, recorder);

    // Execute via the shared executor.
    abortController = new AbortController();
    devTerminalLog("experiment.task.execution.started", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      stage: plan?.kind === "roster-extension" ? "roster-extension" : "full-run",
      status: "running",
    }, "info");
    await executor.executeTask(
      {
        source: runSource,
        mode: "rank",
        task: {
          prompt: task.prompt,
          systemPrompt: task.systemPrompt,
          temperature: 0.7,
        },
        evaluation: evalConfig,
        slots: suite.modelSlots,
        critic: suite.defaultJudge,
        judgeInstruction: task.judgeInstructionOverride,
        // Suite runs have no task attachments in v1 (attachments are an
        // ad-hoc Compare feature; suites never persist them).
        attachments: [],
        attachmentsToJudge: true,
        reasoningPolicy: suite.reasoningPolicy,
      },
      events,
      abortController.signal,
    );
    abortController = null;

    // Read the final run from the repo.
    const finalRun = await runRepo.get(runId);
    if (!finalRun) throw new Error(`Run ${runId} not found after execution`);
    devTerminalLog("experiment.task.execution.finished", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      stage: "execution",
      status: finalRun.status,
    }, finalRun.status === "completed" ? "info" : "warn");
    const finalSummary = builder.deriveSummary(finalRun);

    // Engine transition: commitTaskTerminal with scored coverage derived from
    // the accepted Judge report (spec §11.5) so the coverage-aware attempt
    // selector has real metadata.
    const snapshotKeys = new Set(record.snapshot.modelSlots.map((s) => `${s.providerId}:${s.slug}`));
    const coverage = deriveAttemptCoverage(finalRun, snapshotKeys);
    const commitResult = engine.commitTaskTerminal({
      taskId,
      attemptId,
      runStatus: finalRun.status,
      epoch: engine.taskEpoch,
      error: null,
      now: now(),
      coverage,
      ...(plan ? { repair: plan } : {}),
    });
    if (!commitResult.ok) throw new Error(commitResult.reason ?? "commitTaskTerminal failed");

    // Persist: atomically finalize run + attempt (coverage rides along).
    const commitRev = await uow.commitTaskTerminal({
      experimentId: record.id,
      taskId,
      attemptId,
      run: finalRun,
      summary: finalSummary,
      expectedRunRevision: finalRun.revision,
      expectedExperimentRevision: persistedExperimentRevision,
      fence,
      coverage,
      ...(plan ? { repair: plan } : {}),
    });
    persistedExperimentRevision = commitRev.experimentRevision;

    devTerminalLog("experiment.task.persisted", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      stage: "persistence",
      status: finalRun.status,
    }, "info");

    // Sync experiment status (completed, completed_with_failures, paused).
    await syncExperimentStatus(persistedExperimentRevision);

    emit({ kind: "task-terminal", taskId, attemptId, status: finalRun.status });
    return finalRun.status;
  }

  // --- Task loop --------------------------------------------------------------

  async function runLoop(fence: ExecutionFence): Promise<void> {
    newIdlePromise();

    try {
      while (engine && engine.record.status === "running") {
        const action = engine.nextAction();
        if (action.kind === "wait") {
          // Pause requested between tasks (or before the first repair task
          // starts): persist the paused status so the record never stays
          // "running" without an owner.
          if (engine.pauseRequested && engine.activeTaskId === null) {
            const pauseRes = engine.requestPause(now());
            if (pauseRes.ok) {
              try {
                await syncExperimentStatus(persistedExperimentRevision);
              } catch {
                // Best-effort — the store may be the cause.
              }
            }
          }
          break;
        }

        const taskId = action.taskId;
        // Find a queued attempt (from retryIncomplete) or generate a new ID
        // for the initial run — the engine's beginTask creates the attempt.
        const taskState = engine.record.tasks.find((t) => t.taskId === taskId);
        if (!taskState) break;
        const queuedAttempt = taskState.attempts.find((a) => a.status === "queued");
        const attemptId = queuedAttempt?.id ?? generateId();

        try {
          // Compound attempts run through the normal loop so pause-at-boundary,
          // abort, heartbeat, error handling, and ownership release all apply.
          if (queuedAttempt?.repair) {
            const plan = queuedAttempt.repair;
            if (plan.kind === "missing-cells" || plan.baseRunId !== undefined) {
              // Compound path: reuse accepted outputs + execute selected keys.
              await executeCompoundTask(taskId, attemptId, plan, fence);
            } else {
              // Roster-extension full-roster fallback (plan 001, D3): execute
              // the rotated roster with no seeding, carrying provenance.
              await executeTask(taskId, attemptId, fence, plan);
            }
          } else {
            await executeTask(taskId, attemptId, fence);
          }
        } catch (err) {
          // Persistence failure or execution error: stop the queue.
          const message = err instanceof Error ? err.message : String(err);
          devTerminalLog("experiment.task.failed", {
            experimentId: engine?.record.id,
            taskId,
            experimentAttemptId: attemptId,
            stage: "controller",
            status: "failed",
            error: message,
            ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
          }, "error");
          emit({ kind: "error", error: message });
          // Abort the engine if it hasn't reached a terminal state.
          // The engine may have already committed the task terminal in
          // memory while the UoW persistence failed — activeTaskId is null
          // but the status is still "running". Abort regardless.
          if (engine && !isTerminal(engine.record.status)) {
            // Finalize the active run record before the engine abort so the
            // Runs page never shows a run as "running" after the experiment
            // died (plan 001 hotfix H2), then persist the error message on
            // the affected attempts so the user sees WHY it stopped (H4).
            await finalizeActiveRunRecord();
            engine.abort(now(), { message, category: "execution" });
            try {
              await syncExperimentStatus(persistedExperimentRevision);
            } catch {
              // Best-effort — the store may be the cause.
            }
          }
          break;
        }
      }
    } finally {
      // Release execution if the experiment is terminal.
      if (engine && isTerminal(engine.record.status)) {
        releaseExecution();
      }
      markIdle();
    }
  }

  function isTerminal(status: ExperimentRecord["status"]): boolean {
    return (
      status === "completed" ||
      status === "completed_with_failures" ||
      status === "aborted" ||
      status === "interrupted"
    );
  }

  // --- Abort ------------------------------------------------------------------

  /** Mark the active attempt's run record terminal (best-effort). Shared by
   *  user abort, lease-loss abort, and the runLoop error path — without it
   *  the Runs page keeps showing "running" for a dead experiment. */
  async function finalizeActiveRunRecord(): Promise<void> {
    if (!engine) return;
    const activeTaskId = engine.activeTaskId;
    const activeAttemptId = engine.activeAttemptId;
    if (!activeTaskId || !activeAttemptId) return;
    const taskState = engine.record.tasks.find((t) => t.taskId === activeTaskId);
    const attempt = taskState?.attempts.find((a) => a.id === activeAttemptId);
    if (!attempt?.runId) return;
    try {
      const run = await runRepo.get(attempt.runId);
      if (run && run.status === "running") {
        const state: RunRecordBuilderState = { record: run };
        const expectedRunRevision = run.revision;
        builder.applyAborted(state, run);
        const summary = builder.deriveSummary(run);
        // CAS against the pre-mutation revision — applyAborted bumps
        // record.revision in memory; the stored row is one behind.
        await runRepo.update(run, summary, expectedRunRevision);
      }
    } catch {
      // Best-effort — the run may not be persistable.
    }
  }

  async function abortInternal(reason: string): Promise<void> {
    devTerminalLog("experiment.execution.aborted", {
      experimentId: engine?.record.id ?? experimentId ?? undefined,
      taskId: engine?.activeTaskId ?? undefined,
      experimentAttemptId: engine?.activeAttemptId ?? undefined,
      stage: reason === "Lease lost" ? "lease" : "controller",
      status: "aborted",
      error: reason,
    }, reason === "Lease lost" ? "error" : "warn");
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (engine) {
      // Mark the active run as aborted before aborting the engine, so the
      // run record reaches a terminal state (not left "running").
      await finalizeActiveRunRecord();
      engine.abort(now());
      try {
        await syncExperimentStatus(persistedExperimentRevision);
      } catch {
        // Best-effort.
      }
    }
    releaseExecution();
    markIdle();
  }

  // --- Public API -------------------------------------------------------------

  async function start(suiteId: string): Promise<StartResult> {
    // Load suite.
    const loadedSuite = await evalRepo.getSuite(suiteId);
    if (!loadedSuite) return { ok: false, error: `Suite ${suiteId} not found` };

    // Acquire cross-tab lease.
    let leaseInfo: LeaseInfo;
    try {
      leaseInfo = await lease.acquire();
    } catch (err) {
      if (err instanceof LeaseError) {
        return { ok: false, error: `Another tab is active (${err.message})` };
      }
      throw err;
    }

    // Create experiment record.
    const id = `exp-${generateId()}`;
    const profiles: EvaluationProfileSnapshot[] = [];
    // Resolve pinned profiles from the suite's tasks.
    for (const task of loadedSuite.tasks) {
      if (task.evaluation.kind === "profile") {
        const p = await evalRepo.getProfile(task.evaluation.profile.id, task.evaluation.profile.version);
        if (p && !profiles.find((x) => x.id === p.id && x.version === p.version)) {
          profiles.push(p);
        }
      }
    }
    // Also resolve the suite default if it's a profile.
    if (loadedSuite.defaultEvaluation.kind === "profile") {
      const ref = loadedSuite.defaultEvaluation.profile;
      const p = await evalRepo.getProfile(ref.id, ref.version);
      if (p && !profiles.find((x) => x.id === p.id && x.version === p.version)) {
        profiles.push(p);
      }
    }

    const record = createExperimentRecord({ id, suite: loadedSuite, profiles, now: now() });
    await evalRepo.createExperiment(record);
    persistedExperimentRevision = record.revision;

    // Acquire in-tab ownership.
    if (!owner.tryAcquire({ kind: "experiment", id })) {
      await lease.release();
      return { ok: false, error: "Another execution is active" };
    }

    // Initialize engine.
    engine = createExperimentEngine(record);
    experimentId = id;
    suite = loadedSuite;

    // Start the engine.
    const fence: ExecutionFence = { ownerId: leaseInfo.ownerId, fence: leaseInfo.fence };
    const startResult = engine.start(fence, now());
    if (!startResult.ok) {
      releaseExecution();
      engine = null;
      experimentId = null;
      suite = null;
      return { ok: false, error: startResult.reason ?? "Failed to start" };
    }

    // Persist the running status.
    await syncExperimentStatus(persistedExperimentRevision);

    // Start heartbeat and task loop.
    startHeartbeat();
    void runLoop(fence);

    return { ok: true, experimentId: id };
  }

  async function requestPause(): Promise<void> {
    if (!engine) return;
    const wasBetweenTasks = engine.activeTaskId === null;
    engine.requestPause(now());
    // Pause between tasks (or before a queued repair starts) takes effect
    // immediately in the engine: persist the paused status so the record
    // never stays "running" without an active task or owner.
    if (wasBetweenTasks && engine.record.status === "paused") {
      try {
        await syncExperimentStatus(persistedExperimentRevision);
      } catch {
        // Best-effort — the store may be the cause; runLoop also reconciles.
      }
    }
  }

  async function resume(): Promise<SimpleResult> {
    if (!engine || !experimentId) {
      return { ok: false, error: "No experiment to resume" };
    }
    if (engine.record.status !== "paused") {
      return { ok: false, error: `Cannot resume from status ${engine.record.status}` };
    }

    // Verify lease.
    const leaseInfo = await lease.verify();
    if (!leaseInfo) {
      return { ok: false, error: "Lease not held" };
    }

    const fence: ExecutionFence = { ownerId: leaseInfo.ownerId, fence: leaseInfo.fence };
    const result = engine.resume(fence, now());
    if (!result.ok) {
      return { ok: false, error: result.reason ?? "Failed to resume" };
    }

    await syncExperimentStatus(persistedExperimentRevision);
    startHeartbeat();
    void runLoop(fence);
    return { ok: true };
  }

  async function abort(): Promise<void> {
    await abortInternal("User aborted");
  }

  async function retryIncomplete(expId: string): Promise<SimpleResult> {
    // Load the experiment.
    const record = await evalRepo.getExperiment(expId);
    if (!record) return { ok: false, error: `Experiment ${expId} not found` };

    // Acquire lease.
    let leaseInfo: LeaseInfo;
    try {
      leaseInfo = await lease.acquire();
    } catch (err) {
      if (err instanceof LeaseError) {
        return { ok: false, error: `Another tab is active (${err.message})` };
      }
      throw err;
    }

    // Acquire owner.
    if (!owner.tryAcquire({ kind: "experiment", id: expId })) {
      await lease.release();
      return { ok: false, error: "Another execution is active" };
    }

    // Execution always runs against the immutable snapshot, never the live
    // suite — the user may have edited the suite since the experiment ran
    // (spec §11.1, Task 7).
    const loadedSuite = pinnedSuiteFromSnapshot(record);

    // Initialize engine from the persisted record.
    engine = createExperimentEngine(record);
    experimentId = expId;
    suite = loadedSuite;
    persistedExperimentRevision = record.revision;

    // Retry incomplete tasks.
    const fence: ExecutionFence = { ownerId: leaseInfo.ownerId, fence: leaseInfo.fence };
    const result = engine.retryIncomplete(generateId, fence, now());
    if (!result.ok) {
      releaseExecution();
      engine = null;
      experimentId = null;
      suite = null;
      return { ok: false, error: result.reason ?? "Failed to retry" };
    }

    await syncExperimentStatus(persistedExperimentRevision);
    startHeartbeat();
    void runLoop(fence);
    return { ok: true };
  }

  // --- Recovery ---------------------------------------------------------------

  async function recoverOnStartup(): Promise<number> {
    // Try to acquire the lease. If another tab holds it, we can't recover.
    try {
      await lease.acquire();
    } catch {
      return 0;
    }

    let recovered = 0;
    try {
      const experiments = await evalRepo.listExperiments();
      for (const exp of experiments) {
        if (exp.status !== "running" && exp.status !== "paused") continue;

        // We acquired the lease, so any running/paused experiment's prior
        // owner is dead (or expired). Proceed with recovery.

        let updatedRecord = exp;

        // Check each task for running attempts.
        for (const taskState of exp.tasks) {
          const runningAttempt = taskState.attempts.find((a) => a.status === "running");
          if (!runningAttempt || !runningAttempt.runId) continue;

          // Check if the run already reached a terminal state.
          const run = await runRepo.get(runningAttempt.runId);
          if (run && isTerminalRunStatus(run.status)) {
            // Adopt the committed terminal run: finalize the attempt from
            // the run's status, never re-execute.
            const finalized: ExperimentTaskAttempt = {
              ...runningAttempt,
              status: mapRunStatusToAttemptStatus(run.status),
              finishedAt: run.completedAt ?? now(),
              error: null,
            };
            const updatedTask: ExperimentTaskState = {
              ...taskState,
              attempts: taskState.attempts.map((a) =>
                a.id === runningAttempt.id ? finalized : a,
              ),
            };
            updatedTask.selectedAttemptId = selectAttemptId(updatedTask);
            updatedRecord = {
              ...updatedRecord,
              tasks: updatedRecord.tasks.map((t) =>
                t.taskId === taskState.taskId ? updatedTask : t,
              ),
            };
          } else {
            // The run is still running or not found — mark interrupted.
            if (run) {
              // Mark the run as interrupted using the builder, then persist.
              const state: RunRecordBuilderState = { record: run };
              const expectedRunRevision = run.revision;
              builder.applyInterrupted(state, run);
              const interruptedSummary = builder.deriveSummary(run);
              // CAS against the pre-mutation revision (same rule as the
              // recorder's loadAndMutate — the builder bumps in memory).
              await runRepo.update(run, interruptedSummary, expectedRunRevision);
            }
            const interrupted: ExperimentTaskAttempt = {
              ...runningAttempt,
              status: "interrupted",
              finishedAt: now(),
              error: null,
            };
            const updatedTask: ExperimentTaskState = {
              ...taskState,
              attempts: taskState.attempts.map((a) =>
                a.id === runningAttempt.id ? interrupted : a,
              ),
            };
            updatedTask.selectedAttemptId = selectAttemptId(updatedTask);
            updatedRecord = {
              ...updatedRecord,
              tasks: updatedRecord.tasks.map((t) =>
                t.taskId === taskState.taskId ? updatedTask : t,
              ),
            };
          }
        }

        // Set the experiment to interrupted (recovery never silently resumes).
        updatedRecord = {
          ...updatedRecord,
          status: "interrupted",
          execution: null,
          updatedAt: now(),
        };

        await evalRepo.updateExperiment(updatedRecord, exp.revision);
        recovered++;
      }
    } finally {
      // Release the lease — recovery doesn't keep it.
      await lease.release();
    }

    return recovered;
  }

  function isTerminalRunStatus(status: RunStatus): boolean {
    return (
      status === "completed" ||
      status === "partial" ||
      status === "failed" ||
      status === "aborted" ||
      status === "interrupted"
    );
  }

  async function repairMissingCells(
    expId: string,
    request: { taskId: string; modelKeys: string[] },
  ): Promise<SimpleResult> {
    const record = await evalRepo.getExperiment(expId);
    if (!record) return { ok: false, error: `Experiment ${expId} not found` };

    // Acquire lease.
    let leaseInfo: LeaseInfo;
    try {
      leaseInfo = await lease.acquire();
    } catch (err) {
      if (err instanceof LeaseError) {
        return { ok: false, error: `Another tab is active (${err.message})` };
      }
      throw err;
    }

    if (!owner.tryAcquire({ kind: "experiment", id: expId })) {
      await lease.release();
      return { ok: false, error: "Another execution is active" };
    }

    experimentId = expId;

    // Post-acquisition setup: every exit before runLoop takes ownership must
    // release the lease and owner. Ownership transfers only after a
    // successful queue + heartbeat start.
    let transferredToRunLoop = false;
    try {
      // Pre-load all selected attempt run records for the planner (it needs
      // synchronous resolution; the repository is async).
      const runCache = new Map<string, RunRecordV2>();
      for (const ts of record.tasks) {
        const selected = ts.selectedAttemptId
          ? ts.attempts.find((a) => a.id === ts.selectedAttemptId)
          : undefined;
        if (selected?.runId) {
          const run = await runRepo.get(selected.runId);
          if (run) runCache.set(selected.runId, run);
        }
      }

      const resolveRunRecord = (runId: string): RunRecordV2 | null => runCache.get(runId) ?? null;

      // Validate through the pure planner.
      const aggregation = aggregateExperiment({
        snapshot: record.snapshot,
        taskStates: record.tasks,
        resolveRunRecord,
      });

      const planResult = planMissingCellRepair({
        experiment: record,
        aggregation,
        request,
        resolveRunRecord,
      });

      if (!planResult.ok) {
        return { ok: false, error: planResult.reason };
      }

      const plan = planResult.plan;
      const loadedSuite = pinnedSuiteFromSnapshot(record);

      // Initialize engine from the persisted record.
      engine = createExperimentEngine(record);
      suite = loadedSuite;
      persistedExperimentRevision = record.revision;

      // Queue the repair attempt; the run loop executes it (pause/abort and
      // ownership semantics all flow through the normal loop).
      const repairPlan: ExperimentRepairPlan = {
        kind: "missing-cells",
        baseRunId: plan.baseRunId,
        requestedModelKeys: plan.requestedModelKeys,
      };
      const fence: ExecutionFence = { ownerId: leaseInfo.ownerId, fence: leaseInfo.fence };
      const queueResult = engine.queuePlannedAttempts([{ taskId: request.taskId, repair: repairPlan }], generateId, fence, now());
      if (!queueResult.ok) {
        return { ok: false, error: queueResult.reason ?? "Failed to queue repair" };
      }

      await syncExperimentStatus(persistedExperimentRevision);
      startHeartbeat();
      transferredToRunLoop = true;
      void runLoop(fence);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (!transferredToRunLoop) {
        releaseExecution();
        engine = null;
        experimentId = null;
        suite = null;
      }
    }
  }

  /** Roster extension (roster spec §9.1, plan 001 D): extend a terminal
   *  experiment's snapshot roster with one new model, then execute only that
   *  model across every task. Reuses the compound execution path for reusable
   *  tasks and falls back to a full-roster attempt per task otherwise. The
   *  rotated snapshot + queued attempts persist in ONE CAS so a failure can
   *  never strand a rotated-but-unqueued record. */
  async function addModelAndRun(
    expId: string,
    input: { slot: ModelSlot },
  ): Promise<StartResult> {
    const record = await evalRepo.getExperiment(expId);
    if (!record) return { ok: false, error: `Experiment ${expId} not found` };
    // Acquire cross-tab lease.
    let leaseInfo: LeaseInfo;
    try {
      leaseInfo = await lease.acquire();
    } catch (err) {
      if (err instanceof LeaseError) {
        return { ok: false, error: `Another tab is active (${err.message})` };
      }
      throw err;
    }

    if (!owner.tryAcquire({ kind: "experiment", id: expId })) {
      await lease.release();
      return { ok: false, error: "Another execution is active" };
    }

    experimentId = expId;

    let transferredToRunLoop = false;
    try {
      // Pre-load every selected attempt run for the planner (synchronous
      // resolution; the repository is async) — same pattern as repair.
      const runCache = new Map<string, RunRecordV2>();
      for (const ts of record.tasks) {
        const selected = ts.selectedAttemptId
          ? ts.attempts.find((a) => a.id === ts.selectedAttemptId)
          : undefined;
        if (selected?.runId) {
          const run = await runRepo.get(selected.runId);
          if (run) runCache.set(selected.runId, run);
        }
      }
      const resolveRunRecord = (runId: string): RunRecordV2 | null => runCache.get(runId) ?? null;

      // Validate + plan through the pure planner (rejects duplicates,
      // non-terminal records, invalid/disabled slots before any paid call).
      const planResult = planRosterExtension({
        experiment: record,
        slot: input.slot,
        resolveRunRecord,
      });
      if (!planResult.ok) {
        return { ok: false, error: planResult.reason };
      }
      const plan = planResult.plan;
      devTerminalLog("experiment.roster-extension.planned", {
        experimentId: record.id,
        modelKey: plan.addedModelKey,
        stage: "planning",
        status: "ready",
        candidateCalls: plan.candidateCalls,
        judgeCalls: plan.judgeCalls,
        reusedOutputs: plan.reusedOutputCount,
      }, "info");

      // Rotate the snapshot in memory: append the slot, recompute the
      // fingerprint, append the history entry. The record stays terminal —
      // the engine queue transition owns `running`.
      const rotation = rotateExperimentRoster({
        experiment: record,
        slot: plan.addedSlot,
        extendedAt: now(),
      });
      if (!rotation.ok) {
        return { ok: false, error: rotation.reason };
      }
      const rotatedRecord = rotation.record;

      // Rebuild the execution suite from the ROTATED snapshot and create the
      // engine from the rotated record.
      const loadedSuite = pinnedSuiteFromSnapshot(rotatedRecord);
      engine = createExperimentEngine(rotatedRecord);
      suite = loadedSuite;
      persistedExperimentRevision = record.revision;

      // Queue one attempt per task through the neutral transition.
      const fence: ExecutionFence = { ownerId: leaseInfo.ownerId, fence: leaseInfo.fence };
      const queued = plan.taskPlans.map((tp) => ({ taskId: tp.taskId, repair: tp.executionPlan }));
      const queueResult = engine.queuePlannedAttempts(queued, generateId, fence, now());
      if (!queueResult.ok) {
        return { ok: false, error: queueResult.reason ?? "Failed to queue extension" };
      }

      // ONE CAS writes the rotated record + queued attempts together against
      // the original revision. A stale CAS releases ownership with no paid call.
      await syncExperimentStatus(persistedExperimentRevision);

      startHeartbeat();
      transferredToRunLoop = true;
      void runLoop(fence);
      return { ok: true, experimentId: expId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (!transferredToRunLoop) {
        releaseExecution();
        engine = null;
        experimentId = null;
        suite = null;
      }
    }
  }

  /** Execute one compound attempt: reuse accepted outputs from a base run,
   *  execute only the requested model keys, and run one fresh blind Judge pass
   *  over the reconstructed candidate set. Handles both the `missing-cells`
   *  repair plan and the `roster-extension` compound plan (plan 001, D3). */
  async function executeCompoundTask(
    taskId: string,
    attemptId: string,
    plan: ExperimentTaskExecutionPlan,
    fence: ExecutionFence,
  ): Promise<void> {
    if (!engine || !suite) throw new Error("Engine or suite not initialized");
    const record = engine.record;
    const task = suite.tasks.find((t) => t.id === taskId)!;
    const taskState = record.tasks.find((t) => t.taskId === taskId)!;

    // Load the base run.
    const baseRunId = plan.kind === "missing-cells" ? plan.baseRunId : plan.baseRunId!;
    const baseRun = await runRepo.get(baseRunId);
    if (!baseRun) throw new Error(`Base run ${baseRunId} not found`);

    // Model keys to execute: the repair's requested keys, or exactly the
    // added model for a roster-extension compound attempt.
    const requestedModelKeys: string[] =
      plan.kind === "missing-cells"
        ? plan.requestedModelKeys
        : [plan.addedModelKey];

    // Build the seeded fresh run.
    const runId = `run-${generateId()}`;
    const runSource: RunSource = {
      kind: "experiment",
      experimentId: record.id,
      suiteId: suite.id,
      suiteVersion: suite.version,
      protocolFingerprint: record.protocolFingerprint,
      taskId,
      experimentTaskAttemptId: attemptId,
      trial: taskState.attempts.find((a) => a.id === attemptId)?.trial ?? 0,
      repair: plan,
    };
    devTerminalLog("experiment.task.created", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      modelKey: plan.kind === "roster-extension" ? plan.addedModelKey : undefined,
      stage: plan.kind,
      status: "queued",
    }, "info");

    const seedRun = builder.buildRepairRunSeed({
      runId,
      source: runSource,
      task: { title: task.title, prompt: task.prompt, systemPrompt: task.systemPrompt, temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: suite.modelSlots,
      critic: suite.defaultJudge,
      reasoningPolicy: suite.reasoningPolicy,
      fence,
      baseRun,
      requestedModelKeys,
      generateId,
    });
    const seedSummary = builder.deriveSummary(seedRun);

    // Pause requested between queueing and begin (e.g. immediately after
    // repairMissingCells returns): leave the queued attempt untouched and
    // return cleanly — the loop sees the paused status and stops; ownership
    // stays with the paused experiment (spec §5.4).
    if (engine.record.status !== "running" || engine.pauseRequested) {
      return;
    }

    // Engine transition: beginTask.
    const beginResult = engine.beginTask(taskId, attemptId, runId, now());
    if (!beginResult.ok) throw new Error(beginResult.reason ?? "beginTask failed");

    // Persist: atomically create run + link attempt.
    const beginRev = await uow.beginTask({
      experimentId: record.id,
      taskId,
      attemptId,
      run: seedRun,
      summary: seedSummary,
      expectedExperimentRevision: persistedExperimentRevision,
      fence,
    });
    persistedExperimentRevision = beginRev.experimentRevision;

    await syncExperimentStatus(persistedExperimentRevision);
    emit({ kind: "task-began", taskId, attemptId, runId });

    // Build seeded candidates and attempt ID map for the executor.
    const requestedKeys = new Set(requestedModelKeys);
    const seededCandidates = seedRun.candidates
      .filter((c) => c.acceptedAttemptId !== null && !requestedKeys.has(c.modelKey))
      .map((c) => {
        const attempt = c.attempts[0];
        return {
          id: c.candidateId,
          model: c.model,
          provider: "",
          providerId: c.providerId as ProviderId,
          slug: c.slug,
          accent: "indigo",
          strategy: "Parallel model",
          summary: attempt?.output ?? "",
          scores: {},
          weightedScore: 0,
          segments: [{ id: `${c.candidateId}-seg`, text: attempt?.output ?? "" }],
          status: "done" as const,
          startedAt: attempt?.startedAt ?? now(),
          finishedAt: attempt?.finishedAt ?? now(),
        };
      });
    const seededAttemptIdsByCandidateId: Record<string, string> = {};
    for (const c of seedRun.candidates) {
      if (c.acceptedAttemptId) {
        seededAttemptIdsByCandidateId[c.candidateId] = c.acceptedAttemptId;
      }
    }

    const evalConfig = taskEvaluationConfig(task, suite, record.snapshot.profiles);
    const recorder = createRunRecorder(runRepo, { now } as BuilderDeps);
    const events = makeEvents(runId, recorder);

    abortController = new AbortController();
    devTerminalLog("experiment.task.execution.started", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      modelKey: plan.kind === "roster-extension" ? plan.addedModelKey : undefined,
      stage: plan.kind,
      status: "running",
    }, "info");
    await executor.executeTask(
      {
        source: runSource,
        mode: "rank",
        task: { prompt: task.prompt, systemPrompt: task.systemPrompt, temperature: 0.7 },
        evaluation: evalConfig,
        slots: suite.modelSlots,
        critic: suite.defaultJudge,
        judgeInstruction: task.judgeInstructionOverride,
        attachments: [],
        attachmentsToJudge: true,
        reasoningPolicy: suite.reasoningPolicy,
        candidateExecution: {
          executeModelKeys: requestedModelKeys,
          seededCandidates,
          seededAttemptIdsByCandidateId,
        },
      },
      events,
      abortController.signal,
    );
    abortController = null;

    // Read the final run.
    const finalRun = await runRepo.get(runId);
    if (!finalRun) throw new Error(`Run ${runId} not found after repair execution`);
    devTerminalLog("experiment.task.execution.finished", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      modelKey: plan.kind === "roster-extension" ? plan.addedModelKey : undefined,
      stage: plan.kind,
      status: finalRun.status,
    }, finalRun.status === "completed" ? "info" : "warn");
    const finalSummary = builder.deriveSummary(finalRun);

    // Derive coverage from the accepted Judge report.
    const snapshotKeys = new Set(record.snapshot.modelSlots.map((s) => `${s.providerId}:${s.slug}`));
    const coverage = deriveAttemptCoverage(finalRun, snapshotKeys);

    const commitResult = engine.commitTaskTerminal({
      taskId,
      attemptId,
      runStatus: finalRun.status,
      epoch: engine.taskEpoch,
      error: null,
      now: now(),
      coverage,
      repair: plan,
    });
    if (!commitResult.ok) throw new Error(commitResult.reason ?? "commitTaskTerminal failed");

    const commitRev = await uow.commitTaskTerminal({
      experimentId: record.id,
      taskId,
      attemptId,
      run: finalRun,
      summary: finalSummary,
      expectedRunRevision: finalRun.revision,
      expectedExperimentRevision: persistedExperimentRevision,
      fence,
      coverage,
      repair: plan,
    });
    persistedExperimentRevision = commitRev.experimentRevision;

    devTerminalLog("experiment.task.persisted", {
      experimentId: record.id,
      runId,
      taskId,
      experimentAttemptId: attemptId,
      modelKey: plan.kind === "roster-extension" ? plan.addedModelKey : undefined,
      stage: "persistence",
      status: finalRun.status,
    }, "info");

    await syncExperimentStatus(persistedExperimentRevision);
    emit({ kind: "task-terminal", taskId, attemptId, status: finalRun.status });
  }
  // --- Return public API ------------------------------------------------------

  return {
    start,
    requestPause,
    resume,
    abort,
    retryIncomplete,
    repairMissingCells,
    addModelAndRun,
    recoverOnStartup,
    subscribe,
    whenIdle,
  };
}

export interface ExperimentController {
  start(suiteId: string): Promise<StartResult>;
  requestPause(): Promise<void>;
  resume(): Promise<SimpleResult>;
  abort(): Promise<void>;
  retryIncomplete(experimentId: string): Promise<SimpleResult>;
  repairMissingCells(
    experimentId: string,
    request: { taskId: string; modelKeys: string[] },
  ): Promise<SimpleResult>;
  /** Roster extension (roster spec §9.1): extend a terminal experiment with
   *  one new model and execute only that model across every task. */
  addModelAndRun(
    experimentId: string,
    input: { slot: ModelSlot },
  ): Promise<StartResult>;
  recoverOnStartup(): Promise<number>;
  subscribe(listener: (e: ExperimentControllerEvent) => void): () => void;
  whenIdle(): Promise<void>;
}
