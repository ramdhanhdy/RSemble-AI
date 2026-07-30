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
import { createExperimentEngine, type ExperimentEngine } from "./experiment-engine";
import { createExperimentRecord } from "./experiment-engine";
import { mapRunStatusToAttemptStatus } from "./experiment-engine";
import { selectAttemptId } from "./experiment-engine";
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

/** Build the experiment RunSource for a task attempt. */
function experimentRunSource(
  experiment: ExperimentRecord,
  suite: EvaluationSuite,
  taskId: string,
  attemptId: string,
  trial: number,
): RunSource {
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
    clearInterval(heartbeatTimer);
    const interval = deps.heartbeatMs > 0 ? deps.heartbeatMs : 3000;
    heartbeatTimer = setInterval(() => {
      void lease.renew().catch(() => {
        // Lease lost — abort the active execution.
        void abortInternal("Lease lost");
      });
    }, interval);
  }

  function stopHeartbeat(): void {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
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
   *  run status or throws on persistence failure. */
  async function executeTask(
    taskId: string,
    attemptId: string,
    fence: ExecutionFence,
  ): Promise<RunStatus> {
    if (!engine || !suite) throw new Error("Engine or suite not initialized");
    const record = engine.record;
    const task = suite.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in suite`); 

    const taskState = record.tasks.find((t) => t.taskId === taskId);
    const trial = taskState?.attempts.find((a) => a.id === attemptId)?.trial ?? 0;

    const runId = `run-${generateId()}`;
    const runSource = experimentRunSource(record, suite, taskId, attemptId, trial);
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
      },
      events,
      abortController.signal,
    );
    abortController = null;

    // Read the final run from the repo.
    const finalRun = await runRepo.get(runId);
    if (!finalRun) throw new Error(`Run ${runId} not found after execution`);
    const finalSummary = builder.deriveSummary(finalRun);

    // Engine transition: commitTaskTerminal.
    const commitResult = engine.commitTaskTerminal({
      taskId,
      attemptId,
      runStatus: finalRun.status,
      epoch: engine.taskEpoch,
      error: null,
      now: now(),
    });
    if (!commitResult.ok) throw new Error(commitResult.reason ?? "commitTaskTerminal failed");

    // Persist: atomically finalize run + attempt.
    const commitRev = await uow.commitTaskTerminal({
      experimentId: record.id,
      taskId,
      attemptId,
      run: finalRun,
      summary: finalSummary,
      expectedRunRevision: finalRun.revision,
      expectedExperimentRevision: persistedExperimentRevision,
      fence,
    });
    persistedExperimentRevision = commitRev.experimentRevision;

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
        if (action.kind === "wait") break;

        const taskId = action.taskId;
        // Find a queued attempt (from retryIncomplete) or generate a new ID
        // for the initial run — the engine's beginTask creates the attempt.
        const taskState = engine.record.tasks.find((t) => t.taskId === taskId);
        if (!taskState) break;
        const queuedAttempt = taskState.attempts.find((a) => a.status === "queued");
        const attemptId = queuedAttempt?.id ?? generateId();

        try {
          await executeTask(taskId, attemptId, fence);
        } catch (err) {
          // Persistence failure or execution error: stop the queue.
          const message = err instanceof Error ? err.message : String(err);
          emit({ kind: "error", error: message });
          // Abort the engine if it hasn't reached a terminal state.
          // The engine may have already committed the task terminal in
          // memory while the UoW persistence failed — activeTaskId is null
          // but the status is still "running". Abort regardless.
          if (engine && !isTerminal(engine.record.status)) {
            engine.abort(now());
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

  async function abortInternal(_reason: string): Promise<void> {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    if (engine) {
      // Mark the active run as aborted before aborting the engine, so the
      // run record reaches a terminal state (not left "running").
      const activeTaskId = engine.activeTaskId;
      const activeAttemptId = engine.activeAttemptId;
      if (activeTaskId && activeAttemptId) {
        const taskState = engine.record.tasks.find((t) => t.taskId === activeTaskId);
        const attempt = taskState?.attempts.find((a) => a.id === activeAttemptId);
        if (attempt?.runId) {
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
      }
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

  function requestPause(): void {
    if (engine) {
      engine.requestPause(now());
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

    // Load suite.
    const loadedSuite = await evalRepo.getSuite(record.suiteId);
    if (!loadedSuite) {
      releaseExecution();
      return { ok: false, error: `Suite ${record.suiteId} not found` };
    }

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

  // --- Return public API ------------------------------------------------------

  return {
    start,
    requestPause,
    resume,
    abort,
    retryIncomplete,
    recoverOnStartup,
    subscribe,
    whenIdle,
  };
}

export interface ExperimentController {
  start(suiteId: string): Promise<StartResult>;
  requestPause(): void;
  resume(): Promise<SimpleResult>;
  abort(): Promise<void>;
  retryIncomplete(experimentId: string): Promise<SimpleResult>;
  recoverOnStartup(): Promise<number>;
  subscribe(listener: (e: ExperimentControllerEvent) => void): () => void;
  whenIdle(): Promise<void>;
}
