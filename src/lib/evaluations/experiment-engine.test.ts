// =============================================================================
// experiment-engine.ts — failing tests (Task 6.1)
//
// Deterministic experiment state machine. No I/O, no providers, no React.
// State transitions:
//   draft → queued → running ↔ paused → completed | completed_with_failures
//                                           | aborted | interrupted
// Task attempts:
//   queued → running → completed | partial | failed | aborted | interrupted
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  createExperimentRecord,
  createExperimentEngine,
  mapRunStatusToAttemptStatus,
  selectAttemptId,
  type ExperimentEngine,
} from "./experiment-engine";
import type {
  EvaluationSuite,
  EvaluationTask,
  ExperimentRepairPlan,
  ExperimentTaskExecutionPlan,
  ExperimentTaskState,
  ExperimentTaskAttempt,
} from "./evaluation-types";
import { rotateExperimentRoster } from "./experiment-roster-extension";
import type { ModelSlot } from "../../studio-data";
import type { ExecutionFence } from "../persistence/run-types";

// --- Fixtures ----------------------------------------------------------------

function makeSlot(id: string, slug: string, providerId = "openrouter", enabled = true): ModelSlot {
  return {
    id,
    providerId: providerId as ModelSlot["providerId"],
    provider: "OR",
    model: `Model ${slug}`,
    slug,
    enabled,
  };
}

function makeTask(
  id: string,
  order: number,
  overrides: Partial<EvaluationTask> = {},
): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: `Prompt for ${id}`,
    systemPrompt: "",
    evaluation: { kind: "holistic" },
    judgeInstructionOverride: "",
    order,
    ...overrides,
  };
}

function makeSuite(taskIds: string[] = ["t1", "t2", "t3"]): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 3,
    version: 2,
    name: "Test Suite",
    description: "test",
    tasks: taskIds.map((id, i) => makeTask(id, i)),
    modelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2", "gemini")],
    defaultJudge: { providerId: "openrouter", model: "judge-model" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: null,
  };
}

const FENCE: ExecutionFence = { ownerId: "tab-1", fence: 7 };

function makeEngine(taskIds: string[] = ["t1", "t2", "t3"]): ExperimentEngine {
  const record = createExperimentRecord({
    id: "exp-1",
    suite: makeSuite(taskIds),
    profiles: [],
    now: 5000,
  });
  return createExperimentEngine(record);
}

/** Drive the engine: start + begin first task. Returns the attemptId. */
function startAndBegin(engine: ExperimentEngine, now = 6000): string {
  expect(engine.start(FENCE, 5000).ok).toBe(true);
  const action = engine.nextAction();
  if (action.kind !== "begin-task") throw new Error("expected begin-task");
  const attemptId = `att-${action.taskId}-1`;
  expect(engine.beginTask(action.taskId, attemptId, `run-${action.taskId}-1`, now).ok).toBe(true);
  return attemptId;
}

function makeAttempt(
  id: string,
  status: ExperimentTaskAttempt["status"],
  runId = `run-${id}`,
): ExperimentTaskAttempt {
  return {
    id,
    runId,
    trial: 0,
    status,
    startedAt: 100,
    finishedAt: status === "running" || status === "queued" ? null : 200,
    error: null,
  };
}

function makeTaskState(taskId: string, attempts: ExperimentTaskAttempt[]): ExperimentTaskState {
  return { taskId, selectedAttemptId: null, attempts };
}

// --- 1. start selects the first queued task -----------------------------------

describe("start", () => {
  it("selects the first queued task in suite order", () => {
    const engine = makeEngine(["t1", "t2", "t3"]);
    expect(engine.record.status).toBe("draft");

    const result = engine.start(FENCE, 5000);
    expect(result.ok).toBe(true);
    expect(engine.record.status).toBe("running");
    expect(engine.record.execution).toEqual(FENCE);

    const action = engine.nextAction();
    expect(action).toEqual({ kind: "begin-task", taskId: "t1" });
    expect(engine.queuedTaskIds).toEqual(["t1", "t2", "t3"]);
  });

  it("rejects start when not in draft", () => {
    const engine = makeEngine();
    engine.start(FENCE, 5000);
    const again = engine.start(FENCE, 5001);
    expect(again.ok).toBe(false);
  });

  it("orders the queue by task order field, not array position", () => {
    const suite = makeSuite(["a", "b"]);
    suite.tasks = [makeTask("b", 0), makeTask("a", 1)];
    const record = createExperimentRecord({ id: "exp-1", suite, profiles: [], now: 5000 });
    const engine = createExperimentEngine(record);
    engine.start(FENCE, 5000);
    expect(engine.nextAction()).toEqual({ kind: "begin-task", taskId: "b" });
  });
});

// --- 2. terminal task advances exactly once -----------------------------------

describe("task terminal advancement", () => {
  it("terminal task advances exactly once", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    expect(engine.activeTaskId).toBe("t1");

    const commit = engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    expect(commit.ok).toBe(true);
    expect(engine.activeTaskId).toBeNull();
    expect(engine.nextAction()).toEqual({ kind: "begin-task", taskId: "t2" });

    // A second commit with the same IDs must be rejected — no double advance.
    const again = engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7001,
    });
    expect(again.ok).toBe(false);
    expect(engine.nextAction()).toEqual({ kind: "begin-task", taskId: "t2" });
    const t1 = engine.record.tasks.find((t) => t.taskId === "t1")!;
    expect(t1.attempts).toHaveLength(1);
  });
});

// --- 3. failed task is retained and queue continues ---------------------------

describe("task failure isolation", () => {
  it("failed task is retained and queue continues", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);

    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "failed",
      epoch: engine.taskEpoch,
      error: { message: "Judge failed" },
      now: 7000,
    });

    const t1 = engine.record.tasks.find((t) => t.taskId === "t1")!;
    expect(t1.attempts[0].status).toBe("failed");
    expect(t1.attempts[0].error?.message).toBe("Judge failed");
    expect(t1.selectedAttemptId).toBeNull();

    // Queue continues to the next task automatically.
    expect(engine.record.status).toBe("running");
    expect(engine.nextAction()).toEqual({ kind: "begin-task", taskId: "t2" });
  });
});

// --- 4/5. pause + resume ------------------------------------------------------

describe("pause and resume", () => {
  it("pause requested during a task takes effect only after that task persists", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);

    expect(engine.requestPause(6500).ok).toBe(true);
    expect(engine.pauseRequested).toBe(true);
    // Task still active — pause has NOT taken effect yet.
    expect(engine.record.status).toBe("running");
    expect(engine.activeTaskId).toBe("t1");

    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });

    expect(engine.record.status).toBe("paused");
    expect(engine.pauseRequested).toBe(false);
    // Next task not started — queue retains t2.
    expect(engine.queuedTaskIds).toEqual(["t2"]);
    expect(engine.nextAction()).toEqual({ kind: "wait" });
    // Paused experiment with queued work retains execution ownership.
    expect(engine.record.execution).not.toBeNull();
  });

  it("pause between tasks takes effect immediately", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    // No active task now — pause applies at the boundary.
    expect(engine.requestPause(7100).ok).toBe(true);
    expect(engine.record.status).toBe("paused");
  });

  it("pause requested during the final task finalizes instead of pausing", () => {
    const engine = makeEngine(["t1"]);
    const att1 = startAndBegin(engine);
    engine.requestPause(6500);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    // No queued work remains — pause is meaningless; the experiment finishes.
    expect(engine.record.status).toBe("completed");
  });

  it("resume explicitly advances from the paused queue", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    engine.requestPause(6500);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    expect(engine.record.status).toBe("paused");

    const newFence: ExecutionFence = { ownerId: "tab-1", fence: 8 };
    expect(engine.resume(newFence, 8000).ok).toBe(true);
    expect(engine.record.status).toBe("running");
    expect(engine.record.execution).toEqual(newFence);
    expect(engine.nextAction()).toEqual({ kind: "begin-task", taskId: "t2" });
  });

  it("resume is rejected unless paused", () => {
    const engine = makeEngine();
    engine.start(FENCE, 5000);
    expect(engine.resume(FENCE, 5001).ok).toBe(false);
  });
});

// --- 6/7. abort + stale epochs -------------------------------------------------

describe("abort", () => {
  it("abort stops advancement and bumps both epochs", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    const expEpoch = engine.experimentEpoch;
    const taskEpoch = engine.taskEpoch;

    expect(engine.abort(9000).ok).toBe(true);
    expect(engine.record.status).toBe("aborted");
    expect(engine.experimentEpoch).toBeGreaterThan(expEpoch);
    expect(engine.taskEpoch).toBeGreaterThan(taskEpoch);
    expect(engine.nextAction()).toEqual({ kind: "wait" });
    expect(engine.queuedTaskIds).toEqual([]);
    // Abort releases execution ownership.
    expect(engine.record.execution).toBeNull();

    // The active attempt is marked aborted.
    const t1 = engine.record.tasks.find((t) => t.taskId === "t1")!;
    expect(t1.attempts[0].status).toBe("aborted");

    // Delayed completion from the stale task epoch cannot advance.
    const stale = engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: taskEpoch,
      error: null,
      now: 9100,
    });
    expect(stale.ok).toBe(false);
    expect(engine.record.status).toBe("aborted");
  });

  it("stale task epoch cannot complete a newer task", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    const staleEpoch = engine.taskEpoch;

    // Abort bumps epochs; a delayed stale-epoch commit is rejected and the
    // engine state is completely unchanged.
    engine.abort(9000);
    const before = engine.record;
    const rejected = engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: staleEpoch,
      error: null,
      now: 9100,
    });
    expect(rejected.ok).toBe(false);
    expect(engine.record).toBe(before);
  });
});

// --- 8. reload recovery ---------------------------------------------------------

describe("reload recovery", () => {
  it("marks the active attempt interrupted and preserves completed tasks", () => {
    const engine = makeEngine(["t1", "t2", "t3"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    // Begin task 2 — this is the "active" attempt during the simulated reload.
    const action = engine.nextAction();
    if (action.kind !== "begin-task") throw new Error("expected begin-task");
    engine.beginTask("t2", "att-t2-1", "run-t2-1", 7500);

    // Simulated browser reload: rebuild the engine from the persisted record
    // and run explicit recovery.
    const recovered = createExperimentEngine(engine.record);
    const result = recovered.recoverInterrupted(10000);
    expect(result.ok).toBe(true);
    expect(recovered.record.status).toBe("interrupted");
    expect(recovered.record.execution).toBeNull();

    const t1 = recovered.record.tasks.find((t) => t.taskId === "t1")!;
    expect(t1.attempts[0].status).toBe("completed");
    const t2 = recovered.record.tasks.find((t) => t.taskId === "t2")!;
    expect(t2.attempts[0].status).toBe("interrupted");

    // Never resumes invisibly: nextAction waits until the user explicitly
    // continues via retryIncomplete.
    expect(recovered.nextAction()).toEqual({ kind: "wait" });
  });
});

// --- 9/10/12. retry incomplete tasks --------------------------------------------

describe("retryIncomplete", () => {
  function engineWithMixedAttempts(): ExperimentEngine {
    const suite = makeSuite(["t-done", "t-failed", "t-partial", "t-interrupted", "t-fresh"]);
    const record = createExperimentRecord({ id: "exp-1", suite, profiles: [], now: 5000 });
    const engine = createExperimentEngine(record);
    // Drive to a terminal state with mixed outcomes by writing attempts directly
    // through the public machine: run each task and commit with varied statuses.
    engine.start(FENCE, 5000);
    const outcomes: Record<string, "completed" | "failed" | "partial" | "interrupted"> = {
      "t-done": "completed",
      "t-failed": "failed",
      "t-partial": "partial",
      "t-interrupted": "interrupted",
    };
    for (const taskId of ["t-done", "t-failed", "t-partial", "t-interrupted"]) {
      const action = engine.nextAction();
      if (action.kind !== "begin-task") throw new Error(`expected begin-task for ${taskId}`);
      engine.beginTask(taskId, `att-${taskId}-1`, `run-${taskId}-1`, 6000);
      engine.commitTaskTerminal({
        taskId,
        attemptId: `att-${taskId}-1`,
        runStatus: outcomes[taskId] === "interrupted" ? "failed" : outcomes[taskId],
        epoch: engine.taskEpoch,
        error: null,
        now: 7000,
      });
      if (outcomes[taskId] === "interrupted") {
        // Simulate recovery marking the active attempt interrupted instead.
        const t = engine.record.tasks.find((x) => x.taskId === taskId)!;
        t.attempts[t.attempts.length - 1].status = "interrupted";
      }
    }
    // t-fresh never ran. Abort to reach a non-running status with leftovers.
    engine.abort(9000);
    return engine;
  }

  it("queues tasks without an accepted completed attempt only", () => {
    const engine = engineWithMixedAttempts();
    expect(engine.record.status).toBe("aborted");

    let n = 100;
    const result = engine.retryIncomplete(() => `retry-${n++}`, FENCE, 10000);
    expect(result.ok).toBe(true);
    expect(engine.record.status).toBe("running");

    // t-done has a completed attempt → not queued. Everything else is queued
    // in suite order.
    expect(engine.queuedTaskIds).toEqual(["t-failed", "t-partial", "t-interrupted", "t-fresh"]);
  });

  it("appends new attempts with fresh IDs and never mutates prior terminal attempts", () => {
    const engine = engineWithMixedAttempts();
    const before = new Map(
      engine.record.tasks.map((t) => [t.taskId, t.attempts.map((a) => ({ ...a }))]),
    );

    let n = 100;
    engine.retryIncomplete(() => `retry-${n++}`, FENCE, 10000);

    for (const task of engine.record.tasks) {
      const prior = before.get(task.taskId)!;
      // Prior attempts remain inspectable and unmodified.
      for (let i = 0; i < prior.length; i++) {
        expect(task.attempts[i]).toEqual(prior[i]);
      }
      if (task.taskId === "t-done") {
        expect(task.attempts).toHaveLength(prior.length);
      } else {
        expect(task.attempts).toHaveLength(prior.length + 1);
        const appended = task.attempts[task.attempts.length - 1];
        expect(appended.status).toBe("queued");
        expect(appended.runId).toBeNull();
        expect(appended.id).toMatch(/^retry-/);
        expect(appended.trial).toBe(prior.length);
      }
    }
  });

  it("retry assigns a new whole-task run ID at begin", () => {
    const engine = makeEngine(["t1"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "failed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    expect(engine.record.status).toBe("completed_with_failures");

    let n = 0;
    engine.retryIncomplete(() => `att-retry-${n++}`, FENCE, 10000);
    const action = engine.nextAction();
    expect(action).toEqual({ kind: "begin-task", taskId: "t1" });
    const begin = engine.beginTask("t1", "att-retry-0", "run-retry-0", 11000);
    expect(begin.ok).toBe(true);

    const t1 = engine.record.tasks[0];
    expect(t1.attempts).toHaveLength(2);
    expect(t1.attempts[1].id).toBe("att-retry-0");
    expect(t1.attempts[1].runId).toBe("run-retry-0");
    expect(t1.attempts[1].status).toBe("running");
    // The first attempt is untouched.
    expect(t1.attempts[0].runId).toBe("run-t1-1");
    expect(t1.attempts[0].status).toBe("failed");
  });
});

describe("queuePlannedAttempts", () => {
  function terminalEngine(): ExperimentEngine {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "partial",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    const action = engine.nextAction();
    if (action.kind !== "begin-task") throw new Error("expected begin-task");
    engine.beginTask("t2", "att-t2-1", "run-t2-1", 8000);
    engine.commitTaskTerminal({
      taskId: "t2",
      attemptId: "att-t2-1",
      runStatus: "failed",
      epoch: engine.taskEpoch,
      error: null,
      now: 9000,
    });
    return engine; // completed_with_failures (t1 partial, t2 failed)
  }

  const REPAIR: ExperimentRepairPlan = {
    kind: "missing-cells",
    baseRunId: "run-base",
    requestedModelKeys: ["openrouter:m1"],
  };

  it("queues repair attempts with fresh IDs and repair metadata", () => {
    const engine = terminalEngine();
    let n = 0;
    const result = engine.queuePlannedAttempts(
      [
        { taskId: "t1", repair: REPAIR },
        { taskId: "t2", repair: REPAIR },
      ],
      () => `repair-${n++}`,
      FENCE,
      10000,
    );
    expect(result.ok).toBe(true);
    expect(engine.record.status).toBe("running");
    expect(engine.queuedTaskIds).toEqual(["t1", "t2"]);
    const t1 = engine.record.tasks[0];
    expect(t1.attempts).toHaveLength(2);
    expect(t1.attempts[1].status).toBe("queued");
    expect(t1.attempts[1].repair).toEqual(REPAIR);
    expect(t1.attempts[1].id).toBe("repair-0");
    expect(t1.attempts[1].trial).toBe(1);
  });

  it("rejects an unknown task id without mutating the record", () => {
    const engine = terminalEngine();
    const before = engine.record.tasks.map((t) => ({ ...t }));
    const result = engine.queuePlannedAttempts(
      [{ taskId: "t-unknown", repair: REPAIR }],
      () => "repair-x",
      FENCE,
      10000,
    );
    expect(result.ok).toBe(false);
    // Status and tasks unchanged — nothing queued, no running leak.
    expect(engine.record.status).toBe("completed_with_failures");
    expect(engine.queuedTaskIds).toEqual([]);
    expect(engine.record.tasks).toEqual(before);
  });

  it("rejects a duplicate repair for the same task", () => {
    const engine = terminalEngine();
    const result = engine.queuePlannedAttempts(
      [
        { taskId: "t1", repair: REPAIR },
        { taskId: "t1", repair: REPAIR },
      ],
      () => "repair-x",
      FENCE,
      10000,
    );
    expect(result.ok).toBe(false);
    expect(engine.record.status).toBe("completed_with_failures");
    expect(engine.queuedTaskIds).toEqual([]);
  });

  it("rejects an invalid execution plan without mutating the record", () => {
    const engine = terminalEngine();
    const before = engine.record.tasks.map((t) => ({ ...t }));
    const bad = {
      kind: "roster-extension",
      addedModelKey: "",
    } as unknown as ExperimentTaskExecutionPlan;
    const result = engine.queuePlannedAttempts(
      [{ taskId: "t1", repair: bad }],
      () => "repair-x",
      FENCE,
      10000,
    );
    expect(result.ok).toBe(false);
    expect(engine.record.status).toBe("completed_with_failures");
    expect(engine.record.tasks).toEqual(before);
  });

  it("queues compound and full-roster extension plans in one transition", () => {
    const engine = terminalEngine();
    const compound: ExperimentTaskExecutionPlan = {
      kind: "roster-extension",
      addedModelKey: "deepseek:deepseek-chat",
      baseRunId: "run-t1-1",
    };
    const fallback: ExperimentTaskExecutionPlan = {
      kind: "roster-extension",
      addedModelKey: "deepseek:deepseek-chat",
    };
    let n = 0;
    const result = engine.queuePlannedAttempts(
      [
        { taskId: "t1", repair: compound },
        { taskId: "t2", repair: fallback },
      ],
      () => `ext-${n++}`,
      FENCE,
      10000,
    );
    expect(result.ok).toBe(true);
    expect(engine.record.status).toBe("running");
    expect(engine.queuedTaskIds).toEqual(["t1", "t2"]);
    const t1 = engine.record.tasks[0];
    const t2 = engine.record.tasks[1];
    // One queued attempt per task; prior attempts preserved.
    expect(t1.attempts).toHaveLength(2);
    expect(t2.attempts).toHaveLength(2);
    expect(t1.attempts[1].status).toBe("queued");
    expect(t2.attempts[1].status).toBe("queued");
    expect(t1.attempts[1].repair).toEqual(compound);
    expect(t2.attempts[1].repair).toEqual(fallback);
    expect(t1.attempts[1].trial).toBe(1);
    expect(t2.attempts[1].trial).toBe(1);
  });

  it("pause before the first task leaves attempts queued", () => {
    const engine = terminalEngine();
    const plan: ExperimentTaskExecutionPlan = {
      kind: "roster-extension",
      addedModelKey: "deepseek:deepseek-chat",
      baseRunId: "run-t1-1",
    };
    engine.queuePlannedAttempts(
      [
        { taskId: "t1", repair: plan },
        { taskId: "t2", repair: plan },
      ],
      () => "ext-0",
      FENCE,
      10000,
    );
    // Request pause between tasks (none active): the engine applies the
    // pause at the boundary immediately and retains queued attempts.
    const pauseResult = engine.requestPause(10100);
    expect(pauseResult.ok).toBe(true);
    expect(engine.record.status).toBe("paused");
    expect(engine.nextAction()).toEqual({ kind: "wait" });
    expect(engine.record.tasks[0].attempts[1].status).toBe("queued");
    expect(engine.record.tasks[1].attempts[1].status).toBe("queued");
  });

  it("rotation plus queue is one state change: fingerprint, history, attempts, and fence together (plan 001 C2)", () => {
    const engine = terminalEngine();
    const terminalRecord = engine.record;

    // Rotate the roster in memory, then queue one extension attempt per task.
    const newSlot: ModelSlot = {
      id: "slot-new",
      providerId: "deepseek",
      provider: "DeepSeek",
      model: "deepseek-chat",
      slug: "deepseek-chat",
      enabled: true,
    };
    const rotation = rotateExperimentRoster({
      experiment: terminalRecord,
      slot: newSlot,
      extendedAt: 9500,
    });
    expect(rotation.ok).toBe(true);
    if (!rotation.ok) return;

    // The controller would persist `rotation.record` once with the queued
    // attempts — simulate that as a single CAS-visible state change by
    // creating a fresh engine from the rotated record and queueing.
    const rotated = createExperimentEngine(rotation.record);
    const plan: ExperimentTaskExecutionPlan = {
      kind: "roster-extension",
      addedModelKey: "deepseek:deepseek-chat",
      baseRunId: "run-t1-1",
    };
    const queueResult = rotated.queuePlannedAttempts(
      rotated.record.tasks.map((t) => ({ taskId: t.taskId, repair: plan })),
      () => "ext-0",
      FENCE,
      10000,
    );
    expect(queueResult.ok).toBe(true);

    // The resulting record simultaneously carries the new fingerprint, the
    // extension history, queued attempts, running status, and the fence.
    const rec = rotated.record;
    expect(rec.snapshot.protocolFingerprint).not.toBe(terminalRecord.snapshot.protocolFingerprint);
    expect(rec.protocolFingerprint).toBe(rec.snapshot.protocolFingerprint);
    expect(rec.rosterExtensions).toHaveLength(1);
    expect(rec.rosterExtensions![0].priorFingerprint).toBe(terminalRecord.protocolFingerprint);
    expect(rec.status).toBe("running");
    expect(rec.execution).toEqual(FENCE);
    for (const t of rec.tasks) {
      expect(t.attempts.some((a) => a.status === "queued")).toBe(true);
    }

    // Abort clears execution without deleting the extension history or the
    // queued attempts.
    const abortResult = rotated.abort(10200);
    expect(abortResult.ok).toBe(true);
    expect(rotated.record.status).toBe("aborted");
    expect(rotated.record.execution).toBeNull();
    expect(rotated.record.rosterExtensions).toHaveLength(1);
    for (const t of rotated.record.tasks) {
      expect(t.attempts.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// --- 11. selectedAttemptId selector ----------------------------------------------

describe("selectAttemptId", () => {
  it("chooses the newest full-coverage accepted attempt", () => {
    const task = makeTaskState("t1", [
      makeAttempt("a1", "completed"),
      makeAttempt("a2", "partial"),
      makeAttempt("a3", "completed"),
    ]);
    expect(selectAttemptId(task)).toBe("a3");
  });

  it("prefers an older completed attempt over a newer partial attempt", () => {
    const task = makeTaskState("t1", [
      makeAttempt("a1", "completed"),
      makeAttempt("a2", "partial"),
    ]);
    expect(selectAttemptId(task)).toBe("a1");
  });

  it("falls back to the newest accepted partial attempt", () => {
    const task = makeTaskState("t1", [
      makeAttempt("a1", "partial"),
      makeAttempt("a2", "failed"),
      makeAttempt("a3", "partial"),
    ]);
    expect(selectAttemptId(task)).toBe("a3");
  });

  it("returns null when no attempt is accepted", () => {
    expect(selectAttemptId(makeTaskState("t1", [makeAttempt("a1", "failed")]))).toBeNull();
    expect(selectAttemptId(makeTaskState("t1", []))).toBeNull();
    expect(
      selectAttemptId(
        makeTaskState("t1", [makeAttempt("a1", "aborted"), makeAttempt("a2", "interrupted")]),
      ),
    ).toBeNull();
  });

  it("partial with higher scored-model coverage beats a newer partial attempt", () => {
    const task = makeTaskState("t1", [
      {
        ...makeAttempt("a1", "partial"),
        coverage: {
          scoredModelKeys: [
            "openrouter:m1",
            "openrouter:m2",
            "openrouter:m3",
            "openrouter:m4",
            "openrouter:m5",
            "openrouter:m6",
            "openrouter:m7",
          ],
          totalModels: 8,
        },
      },
      {
        ...makeAttempt("a2", "partial"),
        coverage: {
          scoredModelKeys: [
            "openrouter:m1",
            "openrouter:m2",
            "openrouter:m3",
            "openrouter:m4",
            "openrouter:m5",
            "openrouter:m6",
          ],
          totalModels: 8,
        },
      },
    ]);
    // a1 is older but has 7/8 coverage; a2 is newer with 6/8.
    expect(selectAttemptId(task)).toBe("a1");
  });

  it("newer partial wins when coverage ties", () => {
    const task = makeTaskState("t1", [
      {
        ...makeAttempt("a1", "partial"),
        coverage: {
          scoredModelKeys: [
            "openrouter:m1",
            "openrouter:m2",
            "openrouter:m3",
            "openrouter:m4",
            "openrouter:m5",
            "openrouter:m6",
            "openrouter:m7",
          ],
          totalModels: 8,
        },
      },
      {
        ...makeAttempt("a2", "partial"),
        coverage: {
          scoredModelKeys: [
            "openrouter:m1",
            "openrouter:m2",
            "openrouter:m3",
            "openrouter:m4",
            "openrouter:m5",
            "openrouter:m6",
            "openrouter:m7",
          ],
          totalModels: 8,
        },
      },
    ]);
    expect(selectAttemptId(task)).toBe("a2");
  });

  it("attempts without coverage metadata preserve the newest-partial fallback", () => {
    const task = makeTaskState("t1", [makeAttempt("a1", "partial"), makeAttempt("a2", "partial")]);
    expect(selectAttemptId(task)).toBe("a2");
  });

  it("failed attempts never become selected even with high coverage", () => {
    const task = makeTaskState("t1", [
      {
        ...makeAttempt("a1", "failed"),
        coverage: {
          scoredModelKeys: [
            "openrouter:m1",
            "openrouter:m2",
            "openrouter:m3",
            "openrouter:m4",
            "openrouter:m5",
            "openrouter:m6",
            "openrouter:m7",
          ],
          totalModels: 8,
        },
      },
      makeAttempt("a2", "partial"),
    ]);
    expect(selectAttemptId(task)).toBe("a2");
  });

  it("commit recomputes selection under the documented selector", () => {
    const engine = makeEngine(["t1"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "partial",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    expect(engine.record.tasks[0].selectedAttemptId).toBe(att1);

    // Retry → new completed attempt replaces the pointer; prior partial remains.
    let n = 0;
    engine.retryIncomplete(() => `att-retry-${n++}`, FENCE, 10000);
    engine.beginTask("t1", "att-retry-0", "run-retry-0", 11000);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: "att-retry-0",
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 12000,
    });
    const t1 = engine.record.tasks[0];
    expect(t1.selectedAttemptId).toBe("att-retry-0");
    expect(t1.attempts.map((a) => a.id)).toEqual([att1, "att-retry-0"]);
  });
});

// --- 13. snapshot immutability ---------------------------------------------------

describe("snapshot immutability", () => {
  it("createExperimentRecord deep-copies the suite into the snapshot", () => {
    const suite = makeSuite(["t1"]);
    const record = createExperimentRecord({ id: "exp-1", suite, profiles: [], now: 5000 });

    suite.name = "MUTATED";
    suite.tasks[0].prompt = "MUTATED";
    suite.modelSlots[0].model = "MUTATED";

    expect(record.snapshot.tasks[0].prompt).toBe("Prompt for t1");
    expect(record.snapshot.modelSlots[0].model).toBe("Model m1");
  });

  it("engine transitions never replace the snapshot reference", () => {
    const engine = makeEngine(["t1", "t2"]);
    const snapshot = engine.record.snapshot;
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    engine.requestPause(7100);
    engine.abort(7200);
    expect(engine.record.snapshot).toBe(snapshot);
  });
});

// --- 14. run-status mapping --------------------------------------------------------

describe("mapRunStatusToAttemptStatus", () => {
  it("maps every run status deterministically", () => {
    expect(mapRunStatusToAttemptStatus("completed")).toBe("completed");
    expect(mapRunStatusToAttemptStatus("partial")).toBe("partial");
    expect(mapRunStatusToAttemptStatus("failed")).toBe("failed");
    expect(mapRunStatusToAttemptStatus("aborted")).toBe("aborted");
    expect(mapRunStatusToAttemptStatus("interrupted")).toBe("interrupted");
    expect(mapRunStatusToAttemptStatus("running")).toBe("running");
  });
});

// --- terminal status --------------------------------------------------------------

describe("experiment terminal status", () => {
  it("completed when every task ends with accepted evidence", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    const action = engine.nextAction();
    if (action.kind !== "begin-task") throw new Error("expected begin-task");
    engine.beginTask("t2", "att-t2-1", "run-t2-1", 7100);
    engine.commitTaskTerminal({
      taskId: "t2",
      attemptId: "att-t2-1",
      runStatus: "partial",
      epoch: engine.taskEpoch,
      error: null,
      now: 7200,
    });
    expect(engine.record.status).toBe("completed");
    expect(engine.record.execution).toBeNull();
    expect(engine.record.updatedAt).toBe(7200);
  });

  it("completed_with_failures when a task has no accepted attempt", () => {
    const engine = makeEngine(["t1", "t2"]);
    const att1 = startAndBegin(engine);
    engine.commitTaskTerminal({
      taskId: "t1",
      attemptId: att1,
      runStatus: "completed",
      epoch: engine.taskEpoch,
      error: null,
      now: 7000,
    });
    engine.beginTask("t2", "att-t2-1", "run-t2-1", 7100);
    engine.commitTaskTerminal({
      taskId: "t2",
      attemptId: "att-t2-1",
      runStatus: "failed",
      epoch: engine.taskEpoch,
      error: { message: "provider down" },
      now: 7200,
    });
    expect(engine.record.status).toBe("completed_with_failures");
    expect(engine.record.execution).toBeNull();
  });
});

// --- createExperimentRecord ---------------------------------------------------------

describe("createExperimentRecord", () => {
  it("creates a draft with per-task state and a protocol fingerprint", () => {
    const record = createExperimentRecord({
      id: "exp-1",
      suite: makeSuite(["t1", "t2"]),
      profiles: [],
      now: 5000,
    });
    expect(record.id).toBe("exp-1");
    expect(record.revision).toBe(0);
    expect(record.status).toBe("draft");
    expect(record.suiteId).toBe("suite-1");
    expect(record.suiteVersion).toBe(2);
    expect(record.protocolFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record.execution).toBeNull();
    expect(record.createdAt).toBe(5000);
    expect(record.tasks).toHaveLength(2);
    expect(record.tasks[0]).toEqual({ taskId: "t1", selectedAttemptId: null, attempts: [] });
  });
});
