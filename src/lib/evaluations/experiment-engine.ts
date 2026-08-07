// =============================================================================
// RSemble AI — Experiment engine (spec §11)
//
// Deterministic, pure state machine for experiment lifecycle. No I/O, no
// providers, no React — the controller (Task 6.2) orchestrates persistence
// and execution around these transitions.
//
// Experiment transitions:
//   draft → running ↔ paused → completed | completed_with_failures
//                            | aborted | interrupted
// (The "queued" experiment status exists in the persisted schema for future
// cross-tab handoff; v1 starts draft → running atomically.)
//
// Task attempt transitions:
//   queued → running → completed | partial | failed | aborted | interrupted
//
// Invariants:
//  - exactly one active task attempt at a time;
//  - pause never aborts an in-flight task — it takes effect at the boundary
//    after the active attempt persists terminal, before the next begins;
//  - abort bumps both epochs so delayed stage writes are rejected;
//  - retries append attempts; prior terminal attempts are never mutated;
//  - the snapshot reference is stable for the life of the record.
// =============================================================================

import {
  type EvaluationSuite,
  type EvaluationProfile,
  type ExperimentAttemptCoverage,
  type ExperimentRecord,
  type ExperimentTaskAttempt,
  type ExperimentTaskExecutionPlan,
  type ExperimentTaskState,
  isExperimentTaskExecutionPlan,
} from "./evaluation-types";
import type { ExecutionFence, PersistedError, RunStatus } from "../persistence/run-types";
import { createExperimentSnapshot } from "./protocol-fingerprint";

// --- Run-status → attempt-status mapping (deterministic) ----------------------

export function mapRunStatusToAttemptStatus(status: RunStatus): ExperimentTaskAttempt["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    case "interrupted":
      return "interrupted";
    case "running":
      return "running";
  }
}

// --- selectedAttemptId selector (spec §11.5) ------------------------------------
//
// Selection policy (spec §11.5):
//   1. Newest completed full-coverage attempt.
//   2. Otherwise, partial attempt with the highest scored-model coverage.
//   3. Newest attempt only as the tie-breaker.
//   4. Otherwise none.
//
// Existing records without stored score coverage use the current
// newest-partial behavior as a migration fallback until a new attempt supplies
// coverage metadata. A failed or lower-coverage repair must never displace
// better accepted evidence.

export function selectAttemptId(task: ExperimentTaskState): string | null {
  let newestCompleted: string | null = null;
  let bestPartial: { id: string; coverage: number } | null = null;
  let newestPartial: string | null = null;

  for (const attempt of task.attempts) {
    if (attempt.status === "completed") {
      newestCompleted = attempt.id;
    } else if (attempt.status === "partial") {
      newestPartial = attempt.id;
      const coverage = attempt.coverage
        ? attempt.coverage.scoredModelKeys.length / Math.max(1, attempt.coverage.totalModels)
        : -1; // No metadata → treat as lowest, preserve newest-partial fallback.
      if (bestPartial === null || coverage > bestPartial.coverage) {
        bestPartial = { id: attempt.id, coverage };
      } else if (coverage === bestPartial.coverage && coverage >= 0) {
        // Tie — newer attempt wins (spec §11.5 rule 3).
        bestPartial = { id: attempt.id, coverage };
      }
    }
  }

  if (newestCompleted !== null) return newestCompleted;
  // No completed attempt: prefer the highest-coverage partial when any attempt
  // carries coverage metadata; otherwise fall back to the newest partial.
  if (bestPartial !== null && bestPartial.coverage >= 0) return bestPartial.id;
  return newestPartial;
}

// --- Record creation -------------------------------------------------------------

export interface CreateExperimentRecordInput {
  id: string;
  suite: EvaluationSuite;
  profiles: EvaluationProfile[];
  now: number;
}

export function createExperimentRecord(input: CreateExperimentRecordInput): ExperimentRecord {
  const { id, suite, profiles, now } = input;
  // createExperimentSnapshot deep-copies the suite's semantic content, so later
  // suite edits never mutate an existing experiment (spec §11.1).
  const snapshot = createExperimentSnapshot(suite, profiles, now);
  const tasks: ExperimentTaskState[] = [...suite.tasks]
    .sort((a, b) => a.order - b.order)
    .map((t) => ({ taskId: t.id, selectedAttemptId: null, attempts: [] }));
  return {
    id,
    revision: 0,
    suiteId: suite.id,
    suiteVersion: suite.version,
    protocolFingerprint: snapshot.protocolFingerprint,
    status: "draft",
    execution: null,
    snapshot,
    tasks,
    createdAt: now,
    updatedAt: now,
  };
}

// --- Engine ------------------------------------------------------------------------

export type EngineAction = { kind: "begin-task"; taskId: string } | { kind: "wait" };

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

const OK: TransitionResult = { ok: true };
function reject(reason: string): TransitionResult {
  return { ok: false, reason };
}

export interface CommitTerminalInput {
  taskId: string;
  attemptId: string;
  runStatus: RunStatus;
  epoch: number;
  error: PersistedError | null;
  now: number;
  /** Scored-model coverage stored on the terminal attempt (spec §11.5). */
  coverage?: ExperimentAttemptCoverage;
  /** Compound execution-plan metadata stored on the terminal attempt
   *  (spec §11.4; widened for roster extension). */
  repair?: ExperimentTaskExecutionPlan;
}

/** Opaque snapshot of the engine's full in-memory state. The controller uses
 *  it to roll back a task-terminal transition that failed to persist, so a
 *  failed durable commit cannot leave the persisted experiment "running" with
 *  a terminal engine record (Plan 008 Workstream D / findings review). */
export interface ExperimentEngineSnapshot {
  record: ExperimentRecord;
  queue: string[];
  activeTaskId: string | null;
  activeAttemptId: string | null;
  experimentEpoch: number;
  taskEpoch: number;
  pauseRequestedFlag: boolean;
}

export interface ExperimentEngine {
  readonly record: ExperimentRecord;
  readonly pauseRequested: boolean;
  readonly experimentEpoch: number;
  readonly taskEpoch: number;
  readonly activeTaskId: string | null;
  readonly activeAttemptId: string | null;
  readonly queuedTaskIds: readonly string[];
  /** Capture a full snapshot of engine state (used to make a task-terminal
   *  commit recoverable when its durable persistence phase fails). */
  snapshot(): ExperimentEngineSnapshot;
  /** Restore a previously captured snapshot exactly. */
  restore(snapshot: ExperimentEngineSnapshot): void;
  /** What the controller should do next. */
  nextAction(): EngineAction;
  start(fence: ExecutionFence, now: number): TransitionResult;
  beginTask(taskId: string, attemptId: string, runId: string, now: number): TransitionResult;
  commitTaskTerminal(input: CommitTerminalInput): TransitionResult;
  requestPause(now: number): TransitionResult;
  resume(fence: ExecutionFence, now: number): TransitionResult;
  abort(now: number, error?: PersistedError | null): TransitionResult;
  recoverInterrupted(now: number): TransitionResult;
  retryIncomplete(generateId: () => string, fence: ExecutionFence, now: number): TransitionResult;
  /** Queue one planned attempt per task (missing-cell repair or roster
   *  extension). Only terminal records; plans are validated by discriminant
   *  before any mutation. */
  queuePlannedAttempts(
    repairs: Array<{ taskId: string; repair: ExperimentTaskExecutionPlan }>,
    generateId: () => string,
    fence: ExecutionFence,
    now: number,
  ): TransitionResult;
}

/** A task is complete for retry purposes only when it holds an accepted
 *  completed (full-coverage) attempt. Never-run, failed, partial, interrupted,
 *  and aborted tasks are all eligible (spec §11.3). */
function taskNeedsRetry(task: ExperimentTaskState): boolean {
  return !task.attempts.some((a) => a.status === "completed");
}

/** A task counts toward clean completion when it produced any accepted
 *  evidence (completed or partial attempt). */
function taskHasAcceptedEvidence(task: ExperimentTaskState): boolean {
  return task.attempts.some((a) => a.status === "completed" || a.status === "partial");
}

export function createExperimentEngine(initial: ExperimentRecord): ExperimentEngine {
  let record = initial;
  let queue: string[] = [];
  let activeTaskId: string | null = null;
  let activeAttemptId: string | null = null;
  let experimentEpoch = 0;
  let taskEpoch = 0;
  let pauseRequestedFlag = false;

  function taskState(taskId: string): ExperimentTaskState | undefined {
    return record.tasks.find((t) => t.taskId === taskId);
  }

  function replaceTaskState(updated: ExperimentTaskState, now: number): void {
    record = {
      ...record,
      tasks: record.tasks.map((t) => (t.taskId === updated.taskId ? updated : t)),
      updatedAt: now,
    };
  }

  function setStatus(status: ExperimentRecord["status"], now: number): void {
    record = { ...record, status, updatedAt: now };
  }

  /** After a task persists terminal: pause, finalize, or continue. */
  function settleBoundary(now: number): void {
    if (queue.length === 0) {
      // No queued work — finalize. Pause is meaningless without a next task.
      pauseRequestedFlag = false;
      const clean = record.tasks.every(taskHasAcceptedEvidence);
      record = {
        ...record,
        status: clean ? "completed" : "completed_with_failures",
        execution: null,
        updatedAt: now,
      };
      return;
    }
    if (pauseRequestedFlag) {
      pauseRequestedFlag = false;
      // Paused with queued work retains execution ownership (spec §5.4).
      setStatus("paused", now);
    }
  }

  const engine: ExperimentEngine = {
    get record() {
      return record;
    },
    get pauseRequested() {
      return pauseRequestedFlag;
    },
    get experimentEpoch() {
      return experimentEpoch;
    },
    get taskEpoch() {
      return taskEpoch;
    },
    get activeTaskId() {
      return activeTaskId;
    },
    get activeAttemptId() {
      return activeAttemptId;
    },
    get queuedTaskIds() {
      return queue;
    },

    snapshot() {
      return {
        record,
        queue: [...queue],
        activeTaskId,
        activeAttemptId,
        experimentEpoch,
        taskEpoch,
        pauseRequestedFlag,
      };
    },

    restore(snapshot) {
      record = snapshot.record;
      queue = [...snapshot.queue];
      activeTaskId = snapshot.activeTaskId;
      activeAttemptId = snapshot.activeAttemptId;
      experimentEpoch = snapshot.experimentEpoch;
      taskEpoch = snapshot.taskEpoch;
      pauseRequestedFlag = snapshot.pauseRequestedFlag;
    },

    nextAction(): EngineAction {
      if (record.status !== "running") return { kind: "wait" };
      if (activeTaskId !== null || pauseRequestedFlag) return { kind: "wait" };
      if (queue.length === 0) return { kind: "wait" };
      return { kind: "begin-task", taskId: queue[0] };
    },

    start(fence, now) {
      if (record.status !== "draft") {
        return reject(`Cannot start from status ${record.status}`);
      }
      queue = record.tasks.map((t) => t.taskId);
      record = { ...record, status: "running", execution: fence, updatedAt: now };
      return OK;
    },

    beginTask(taskId, attemptId, runId, now) {
      if (record.status !== "running") return reject(`Cannot begin task while ${record.status}`);
      if (activeTaskId !== null) return reject(`Task ${activeTaskId} is already active`);
      if (queue[0] !== taskId) return reject(`Task ${taskId} is not at the head of the queue`);
      const task = taskState(taskId);
      if (!task) return reject(`Task ${taskId} not found`);

      const existing = task.attempts.find((a) => a.id === attemptId);
      if (existing && existing.runId !== null) {
        return reject(`Attempt ${attemptId} already has a run`);
      }
      if (existing && existing.status !== "queued") {
        return reject(`Attempt ${attemptId} is not queued`);
      }

      const attempt: ExperimentTaskAttempt = {
        id: attemptId,
        runId,
        trial: existing?.trial ?? task.attempts.length,
        status: "running",
        startedAt: now,
        finishedAt: null,
        error: null,
      };
      const updatedTask: ExperimentTaskState = {
        ...task,
        attempts: existing
          ? task.attempts.map((a) => (a.id === attemptId ? attempt : a))
          : [...task.attempts, attempt],
      };
      replaceTaskState(updatedTask, now);
      queue = queue.slice(1);
      activeTaskId = taskId;
      activeAttemptId = attemptId;
      taskEpoch += 1;
      return OK;
    },

    commitTaskTerminal(input) {
      const { taskId, attemptId, runStatus, epoch, error, now, coverage, repair } = input;
      if (epoch !== taskEpoch) {
        return reject(`Stale task epoch: expected ${taskEpoch}, got ${epoch}`);
      }
      if (activeTaskId !== taskId || activeAttemptId !== attemptId) {
        return reject(`Attempt ${attemptId} is not the active attempt`);
      }
      const task = taskState(taskId);
      if (!task) return reject(`Task ${taskId} not found`);
      const attempt = task.attempts.find((a) => a.id === attemptId);
      if (!attempt) return reject(`Attempt ${attemptId} not found`);
      if (attempt.status !== "running") {
        return reject(`Attempt ${attemptId} is already terminal`);
      }

      const finalized: ExperimentTaskAttempt = {
        ...attempt,
        status: mapRunStatusToAttemptStatus(runStatus),
        finishedAt: now,
        error,
        ...(coverage !== undefined ? { coverage } : {}),
        ...(repair !== undefined ? { repair } : {}),
      };
      const updatedTask: ExperimentTaskState = {
        ...task,
        attempts: task.attempts.map((a) => (a.id === attemptId ? finalized : a)),
      };
      updatedTask.selectedAttemptId = selectAttemptId(updatedTask);
      replaceTaskState(updatedTask, now);
      activeTaskId = null;
      activeAttemptId = null;
      settleBoundary(now);
      return OK;
    },

    requestPause(now) {
      if (record.status !== "running") return reject(`Cannot pause while ${record.status}`);
      if (activeTaskId === null) {
        // Between tasks — apply at the boundary immediately.
        pauseRequestedFlag = false;
        setStatus("paused", now);
        return OK;
      }
      pauseRequestedFlag = true;
      return OK;
    },

    resume(fence, now) {
      if (record.status !== "paused") return reject(`Cannot resume while ${record.status}`);
      record = { ...record, status: "running", execution: fence, updatedAt: now };
      return OK;
    },

    abort(now, error = null) {
      if (record.status !== "running" && record.status !== "paused" && record.status !== "draft") {
        return reject(`Cannot abort while ${record.status}`);
      }
      // Bump both epochs: stale candidate, Judge, or persistence completions
      // cannot advance the queue (spec §11.4).
      experimentEpoch += 1;
      taskEpoch += 1;
      queue = [];
      pauseRequestedFlag = false;

      // Finalize EVERY non-terminal attempt, not just the active one. Queued
      // attempts (roster extensions, retries) that abort leaves as "queued"
      // render as Running forever and can never be retried — a zombie state
      // observed in production (plan 001 hotfix H1). Aborted attempts keep
      // their repair plan so retryIncomplete can re-queue them.
      const tasks = record.tasks.map((task) => {
        let changed = false;
        const attempts = task.attempts.map((a) => {
          if (a.status === "running") {
            changed = true;
            return {
              ...a,
              status: "aborted" as const,
              finishedAt: now,
              ...(error !== null ? { error } : {}),
            };
          }
          if (a.status === "queued") {
            changed = true;
            return { ...a, status: "aborted" as const, finishedAt: now };
          }
          return a;
        });
        if (!changed) return task;
        const updatedTask: ExperimentTaskState = { ...task, attempts };
        updatedTask.selectedAttemptId = selectAttemptId(updatedTask);
        return updatedTask;
      });
      activeTaskId = null;
      activeAttemptId = null;
      record = { ...record, tasks, status: "aborted", execution: null, updatedAt: now };
      return OK;
    },

    recoverInterrupted(now) {
      if (record.status !== "running" && record.status !== "paused") {
        return reject(`Cannot recover while ${record.status}`);
      }
      experimentEpoch += 1;
      taskEpoch += 1;
      queue = [];
      pauseRequestedFlag = false;

      let tasks = record.tasks;
      const running = record.tasks.find((t) => t.attempts.some((a) => a.status === "running"));
      if (running) {
        const updatedTask: ExperimentTaskState = {
          ...running,
          attempts: running.attempts.map((a) =>
            a.status === "running" ? { ...a, status: "interrupted" as const, finishedAt: now } : a,
          ),
        };
        updatedTask.selectedAttemptId = selectAttemptId(updatedTask);
        tasks = record.tasks.map((t) => (t.taskId === updatedTask.taskId ? updatedTask : t));
      }
      activeTaskId = null;
      activeAttemptId = null;
      record = { ...record, tasks, status: "interrupted", execution: null, updatedAt: now };
      return OK;
    },

    retryIncomplete(generateId, fence, now) {
      // Available after the active queue stops (spec §11.3). Per-task
      // eligibility (no accepted completed attempt) decides what re-queues —
      // a "completed" experiment may still hold partial attempts worth
      // retrying.
      if (
        record.status !== "completed" &&
        record.status !== "completed_with_failures" &&
        record.status !== "aborted" &&
        record.status !== "interrupted"
      ) {
        return reject(`Cannot retry while ${record.status}`);
      }
      // A task is eligible when it has no accepted completed attempt, OR its
      // newest attempt carries a repair/extension plan that ended
      // failed/aborted/interrupted — re-running that same plan finishes the
      // interrupted work (plan 001 hotfix H3). Without the second rule a
      // failed roster extension is a dead end: the older completed attempt
      // keeps taskNeedsRetry false while the planner rejects re-adding the
      // model as a duplicate.
      const eligible: Array<{ task: ExperimentTaskState; plan?: ExperimentTaskExecutionPlan }> = [];
      for (const task of record.tasks) {
        if (taskNeedsRetry(task)) {
          eligible.push({ task });
          continue;
        }
        const newest = task.attempts[task.attempts.length - 1];
        if (
          newest?.repair &&
          (newest.status === "failed" ||
            newest.status === "aborted" ||
            newest.status === "interrupted")
        ) {
          eligible.push({ task, plan: newest.repair });
        }
      }
      if (eligible.length === 0) return reject("No incomplete tasks to retry");

      let tasks = record.tasks;
      for (const { task, plan } of eligible) {
        const attempt: ExperimentTaskAttempt = {
          id: generateId(),
          runId: null,
          trial: task.attempts.length,
          status: "queued",
          startedAt: null,
          finishedAt: null,
          error: null,
          ...(plan !== undefined ? { repair: plan } : {}),
        };
        tasks = tasks.map((t) =>
          t.taskId === task.taskId ? { ...t, attempts: [...t.attempts, attempt] } : t,
        );
      }
      queue = eligible.map(({ task }) => task.taskId);
      record = { ...record, tasks, status: "running", execution: fence, updatedAt: now };
      return OK;
    },

    queuePlannedAttempts(repairs, generateId, fence, now) {
      if (
        record.status !== "completed" &&
        record.status !== "completed_with_failures" &&
        record.status !== "aborted" &&
        record.status !== "interrupted"
      ) {
        return reject(`Cannot queue repairs while ${record.status}`);
      }
      if (repairs.length === 0) return reject("No repairs to queue");

      // Validate every repair task exists, no task is queued twice, and every
      // plan passes its discriminant invariants before mutating anything — an
      // unknown id would leave the record "running" with nothing to execute.
      const seen = new Set<string>();
      for (const item of repairs) {
        if (!taskState(item.taskId)) {
          return reject(`Task ${item.taskId} not found`);
        }
        if (seen.has(item.taskId)) {
          return reject(`Duplicate repair for task ${item.taskId}`);
        }
        seen.add(item.taskId);
        if (!isExperimentTaskExecutionPlan(item.repair)) {
          return reject(`Invalid execution plan for task ${item.taskId}`);
        }
      }

      let tasks = record.tasks;
      for (const item of repairs) {
        const attempt: ExperimentTaskAttempt = {
          id: generateId(),
          runId: null,
          trial: tasks.find((t) => t.taskId === item.taskId)?.attempts.length ?? 0,
          status: "queued",
          startedAt: null,
          finishedAt: null,
          error: null,
          repair: item.repair,
        };
        tasks = tasks.map((t) =>
          t.taskId === item.taskId ? { ...t, attempts: [...t.attempts, attempt] } : t,
        );
      }
      queue = repairs.map((r) => r.taskId);
      record = { ...record, tasks, status: "running", execution: fence, updatedAt: now };
      return OK;
    },
  };

  return engine;
}
