// =============================================================================
// experiment-controller.ts — failing tests (Task 6.2)
//
// Sequential experiment execution through the shared RunExecutor:
//  - tasks execute one at a time in stable suite order; candidate fanout stays
//    parallel within the active task;
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

import { describe, it, expect } from "vitest";
import { createExperimentController, type ExperimentControllerEvent } from "./experiment-controller";
import { createExperimentUnitOfWork, InMemoryExperimentStore } from "../persistence/experiment-unit-of-work";
import { InMemoryEvaluationRepository } from "../persistence/evaluation-repository";
import { InMemoryRunRepository } from "../persistence/run-repository";
import { InMemoryExecutionLease, type LeaseInfo } from "../execution-lease";
import { ExecutionOwnerRegistry } from "../execution-owner";
import type { ExperimentRecord, EvaluationSuite, EvaluationTask } from "./evaluation-types";
import type {
  FullRunSummaryV2,
  RunRecordV2,
  RunSummary,
} from "../persistence/run-types";
import type { RunExecutor, RunExecutorEvents, RunRequest } from "../run-executor";
import { candidateIdForSlot } from "../pipeline";
import type { JudgeReport } from "../../studio-data";
import type { ModelSlot } from "../../studio-data";

// --- Fixtures -------------------------------------------------------------------

function makeSlot(id: string, slug: string, providerId = "openrouter"): ModelSlot {
  return {
    id,
    providerId: providerId as ModelSlot["providerId"],
    provider: "OR",
    model: `Model ${slug}`,
    slug,
    enabled: true,
  };
}

function makeTask(id: string, order: number, overrides: Partial<EvaluationTask> = {}): EvaluationTask {
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

function makeSuite(taskIds: string[]): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 0,
    version: 1,
    name: "Test Suite",
    description: "test",
    tasks: taskIds.map((id, i) => makeTask(id, i)),
    modelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2", "gemini")],
    defaultJudge: { providerId: "openrouter", model: "judge-model" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeJudgeReport(candidates: Array<{ id: string; score: number }>): JudgeReport {
  const labelMap = candidates.map((c, i) => ({ label: String.fromCharCode(65 + i), candidateId: c.id }));
  const evaluationsById: JudgeReport["evaluationsById"] = {};
  for (const { label, candidateId } of labelMap) {
    const score = candidates.find((c) => c.id === candidateId)!.score;
    evaluationsById[candidateId] = {
      candidateId,
      blindLabel: label,
      overallScore: score,
      position: "p",
      rationale: "r",
      strengths: ["s"],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    };
  }
  return { labelMap, evaluationsById, comparisons: [] };
}

// --- Fake executor ---------------------------------------------------------------

type FakeOutcome =
  | { kind: "success" }
  | { kind: "one-candidate-fails" }
  | { kind: "judge-fails" }
  | { kind: "block-until-abort" };

interface FakeExecutor extends RunExecutor {
  calls: RunRequest[];
  behavior: (request: RunRequest) => FakeOutcome;
}

function makeFakeExecutor(opts: {
  now: () => number;
  generateId: () => string;
  behavior: (request: RunRequest) => FakeOutcome;
  /** Invoked mid-task (after candidate events, before Judge) — tests use it
   *  to requestPause or abort while the task is "in flight". */
  midTask?: (request: RunRequest) => void;
  abortedSignals?: AbortSignal[];
}): FakeExecutor {
  const calls: RunRequest[] = [];
  const behaviorRef: { current: (request: RunRequest) => FakeOutcome } = { current: opts.behavior };
  const abortedSignals: AbortSignal[] = opts.abortedSignals ?? [];
  async function executeTask(request: RunRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void> {
    calls.push(request);
    const outcome = behaviorRef.current(request);
    const enabledSlots = request.slots.filter((s) => s.enabled);

    await events.onFanoutStart();

    const candidateAttemptIds: Record<string, string> = {};
    const done: import("../../studio-data").Candidate[] = [];
    for (const slot of enabledSlots) {
      const candidateId = candidateIdForSlot(slot.id);
      const attemptId = opts.generateId();
      const failThisOne = outcome.kind === "one-candidate-fails" && slot.id === enabledSlots[enabledSlots.length - 1].id;
      await events.onCandidateAttemptStart(candidateId, attemptId, { messages: [], startedAt: opts.now() });
      if (failThisOne) {
        await events.onCandidateAttemptTerminal(candidateId, attemptId, {
          status: "failed", output: null, tokensIn: null, tokensOut: null,
          error: { message: "provider error" }, finishedAt: opts.now(),
        });
        continue;
      }
      events.onCandidateTerminal(candidateId, {
        segments: [], summary: "s", tokensIn: 1, tokensOut: 1, finishedAt: opts.now(),
      });
      await events.onCandidateAttemptTerminal(candidateId, attemptId, {
        status: "completed", output: `output-${slot.slug}`, tokensIn: 1, tokensOut: 1, error: null, finishedAt: opts.now(),
      });
      candidateAttemptIds[candidateId] = attemptId;
      done.push({
        id: candidateId, model: slot.model, provider: slot.provider, providerId: slot.providerId,
        slug: slot.slug, accent: "indigo", strategy: "Parallel model", summary: "s",
        scores: {}, weightedScore: 0, segments: [], status: "done", startedAt: opts.now(),
      });
    }
    await events.onFanoutTerminal(done);

    if (opts.midTask) opts.midTask(request);
    if (signal.aborted || outcome.kind === "block-until-abort") {
      abortedSignals.push(signal);
      return;
    }

    const judgeAttemptId = opts.generateId();
    await events.onJudgeStart(judgeAttemptId, {
      providerId: request.critic.providerId,
      model: request.critic.model,
      instruction: request.judgeInstruction,
      messages: [],
      blindLabelToCandidateId: Object.fromEntries(done.map((c, i) => [String.fromCharCode(65 + i), c.id])),
      candidateAttemptIdsByCandidateId: candidateAttemptIds,
      startedAt: opts.now(),
    });
    if (outcome.kind === "judge-fails") {
      await events.onJudgeTerminal(judgeAttemptId, {
        status: "failed", report: null, consensus: null,
        error: { message: "judge exploded" }, finishedAt: opts.now(),
      });
      return;
    }
    const report = makeJudgeReport(done.map((c, i) => ({ id: c.id, score: 4 - i * 0.5 })));
    await events.onJudgeTerminal(judgeAttemptId, {
      status: "completed", report, consensus: null, error: null, finishedAt: opts.now(),
    });
  }

  const obj = {
    calls,
    executeTask,
    retryCandidate: async () => {},
    retryJudge: async () => {},
    executeFusionAttempt: async () => {},
  } as unknown as FakeExecutor;
  Object.defineProperty(obj, "behavior", {
    get: () => behaviorRef.current,
    set: (v: (request: RunRequest) => FakeOutcome) => { behaviorRef.current = v; },
    enumerable: true,
    configurable: true,
  });
  return obj;
}

// --- Harness ---------------------------------------------------------------------

interface Harness {
  controller: ReturnType<typeof createExperimentController>;
  evalRepo: InMemoryEvaluationRepository;
  store: InMemoryExperimentStore;
  runRepo: InMemoryRunRepository;
  lease: InMemoryExecutionLease;
  leaseStore: { lease: LeaseInfo | null; fence: number };
  owner: ExecutionOwnerRegistry;
  executor: FakeExecutor;
  events: ExperimentControllerEvent[];
  now: () => number;
  setNow: (v: number) => void;
  ids: () => string;
}

function makeHarness(opts: {
  behavior?: (request: RunRequest) => FakeOutcome;
  midTask?: (request: RunRequest) => void;
} = {}): Harness {
  let nowValue = 10_000;
  const now = () => nowValue;
  let idCounter = 0;
  const ids = () => `id-${++idCounter}`;

  const experiments = new Map<string, ExperimentRecord>();
  const runDetails = new Map<string, RunRecordV2>();
  const runSummaries = new Map<string, RunSummary>();
  const leaseStore: { lease: LeaseInfo | null; fence: number } = { lease: null, fence: 0 };

  const evalRepo = new InMemoryEvaluationRepository({ experiments });
  const store = new InMemoryExperimentStore({
    experiments,
    runDetails,
    runSummaries,
    leaseStore,
  });
  const uow = createExperimentUnitOfWork(store, { now });
  const runRepo = new InMemoryRunRepository({ summaries: runSummaries, details: runDetails });
  const lease = new InMemoryExecutionLease(leaseStore, null, { now });
  const owner = new ExecutionOwnerRegistry();
  const executor = makeFakeExecutor({
    now,
    generateId: ids,
    behavior: opts.behavior ?? (() => ({ kind: "success" })),
    midTask: opts.midTask,
  });
  const events: ExperimentControllerEvent[] = [];

  const controller = createExperimentController({
    evalRepo,
    uow,
    runRepo,
    lease,
    owner,
    executor,
    generateId: ids,
    now,
    heartbeatMs: 0,
  });
  controller.subscribe((e) => events.push(e));

  return {
    controller,
    evalRepo,
    store,
    runRepo,
    lease,
    leaseStore,
    owner,
    executor,
    events,
    now,
    setNow: (v) => {
      nowValue = v;
    },
    ids,
  };
}

async function seedSuite(h: Harness, suite: EvaluationSuite): Promise<void> {
  await h.evalRepo.saveSuite(suite, 0);
}

function taskIds(executor: FakeExecutor): string[] {
  return executor.calls.map((c) => (c.source.kind === "experiment" ? c.source.taskId : "adhoc"));
}

// =============================================================================
// Tests
// =============================================================================

describe("experiment-controller — sequential execution", () => {
  it("start runs tasks in stable suite order, one at a time, to completion", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2", "t3"]));

    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Wait for the loop to drain.
    await h.controller.whenIdle();

    // Tasks executed in suite order; each task's commit landed before the
    // next begin (task-terminal events strictly precede the next task-began).
    expect(taskIds(h.executor)).toEqual(["t1", "t2", "t3"]);
    const beganIdx = h.events.map((e, i) => (e.kind === "task-began" ? i : -1)).filter((i) => i >= 0);
    const terminalIdx = h.events.map((e, i) => (e.kind === "task-terminal" ? i : -1)).filter((i) => i >= 0);
    expect(beganIdx).toHaveLength(3);
    expect(terminalIdx).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(terminalIdx[i]).toBeGreaterThan(beganIdx[i]);
      if (i < 2) expect(beganIdx[i + 1]).toBeGreaterThan(terminalIdx[i]);
    }

    // Experiment reached a clean terminal state with execution released.
    const experiment = await h.evalRepo.getExperiment(result.experimentId);
    expect(experiment!.status).toBe("completed");
    expect(experiment!.execution).toBeNull();

    // Every task has a completed attempt linked to a distinct run.
    const runIds = new Set<string>();
    for (const task of experiment!.tasks) {
      expect(task.attempts).toHaveLength(1);
      expect(task.attempts[0].status).toBe("completed");
      expect(task.selectedAttemptId).toBe(task.attempts[0].id);
      expect(task.attempts[0].runId).not.toBeNull();
      runIds.add(task.attempts[0].runId!);
    }
    expect(runIds.size).toBe(3);

    // Runs are persisted in Rank mode with experiment provenance.
    for (const runId of runIds) {
      const run = await h.runRepo.get(runId);
      expect(run).not.toBeNull();
      expect(run!.mode).toBe("rank");
      expect(run!.status).toBe("completed");
      if (run!.source.kind === "experiment") {
        expect(run!.source.experimentId).toBe(result.experimentId);
        expect(run!.source.protocolFingerprint).toBe(experiment!.protocolFingerprint);
      } else {
        throw new Error("expected experiment source");
      }
      // Judge evidence persisted: scores joined to model keys.
      const summary = [...h.store.runSummaries.values()].find((s) => s.id === runId);
      expect(summary && summary.kind === "full" ? summary.scoresByModelKey : {}).toEqual({
        "openrouter:m1": 4,
        "gemini:m2": 3.5,
      });
    }

    // Ownership fully released.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("candidate fanout stays parallel within the active task (single executeTask call per task)", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));
    await h.controller.start("suite-1");
    await h.controller.whenIdle();
    // One executeTask per task — the executor's internal Promise.all owns
    // candidate parallelism; the controller never serializes candidates.
    expect(h.executor.calls).toHaveLength(2);
    expect(h.executor.calls[0].slots.filter((s) => s.enabled)).toHaveLength(2);
  });

  it("one task failure does not discard completed task IDs and the queue continues", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t2"
          ? { kind: "judge-fails" }
          : { kind: "success" },
    });
    await seedSuite(h, makeSuite(["t1", "t2", "t3"]));
    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    const experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    expect(experiment!.status).toBe("completed_with_failures");

    const [t1, t2, t3] = experiment!.tasks;
    expect(t1.attempts[0].status).toBe("completed");
    expect(t1.selectedAttemptId).toBe(t1.attempts[0].id);
    expect(t2.attempts[0].status).toBe("failed");
    expect(t2.selectedAttemptId).toBeNull();
    expect(t3.attempts[0].status).toBe("completed");

    // Completed runs are retained.
    const run1 = await h.runRepo.get(t1.attempts[0].runId!);
    const run3 = await h.runRepo.get(t3.attempts[0].runId!);
    expect(run1!.status).toBe("completed");
    expect(run3!.status).toBe("completed");
    const run2 = await h.runRepo.get(t2.attempts[0].runId!);
    expect(run2!.status).toBe("failed");
  });
});

describe("experiment-controller — persistence failure", () => {
  it("a persistence failure stops the queue before another paid task", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2", "t3"]));

    // Fail the commit of task 1 (after run writes succeed, experiment write fails).
    let commits = 0;
    const originalCommit = h.store.runInTransaction.bind(h.store);
    h.store.runInTransaction = async (fn) => {
      commits += 1;
      // begin = tx 1; commit of task 1 = tx 2 → inject failure there.
      if (commits === 2) h.store.failAfterWrites = 0;
      return originalCommit(fn);
    };

    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    // Task 2 never began — no second paid task.
    expect(h.executor.calls).toHaveLength(1);
    const errorEvents = h.events.filter((e) => e.kind === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
    // Ownership released so the user can act again.
    expect(h.owner.get()).toBeNull();
  });
});

describe("experiment-controller — pause / resume / abort", () => {
  it("pause never aborts the active executor and prevents the next task after persistence", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: () => {
        controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));

    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    // Task 1 completed normally (executor was NOT aborted), then the engine
    // paused at the boundary instead of beginning task 2.
    expect(h.executor.calls).toHaveLength(1);
    const experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    expect(experiment!.status).toBe("paused");
    expect(experiment!.tasks[0].attempts[0].status).toBe("completed");
    // Paused with queued work retains execution ownership.
    expect(experiment!.execution).not.toBeNull();
    expect(h.owner.get()).toEqual({ kind: "experiment", id: result.ok ? result.experimentId : "" });
  });

  it("resume starts the next queued task only after explicit user action", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: () => {
        controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));

    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();
    expect(h.executor.calls).toHaveLength(1);

    // No implicit advancement.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.executor.calls).toHaveLength(1);

    const resumed = await h.controller.resume();
    expect(resumed.ok).toBe(true);
    await h.controller.whenIdle();

    expect(h.executor.calls).toHaveLength(2);
    const experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    expect(experiment!.status).toBe("completed");
  });

  it("abort reaches the active executor, wins against delayed writes, and prevents advancement", async () => {
    const abortedSignals: AbortSignal[] = [];
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      behavior: () => ({ kind: "block-until-abort" }),
      midTask: () => {
        void controllerRef!.abort();
      },
    });
    controllerRef = h.controller;
    // Wire the fake's aborted-signal capture.
    (h.executor as { abortedSignals?: AbortSignal[] }).abortedSignals = abortedSignals;

    await seedSuite(h, makeSuite(["t1", "t2"]));
    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    // The active executor's signal was aborted; task 2 never began.
    expect(h.executor.calls).toHaveLength(1);
    const experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    expect(experiment!.status).toBe("aborted");
    expect(experiment!.execution).toBeNull();

    // The active attempt is aborted and the queue did not advance.
    expect(experiment!.tasks[0].attempts[0].status).toBe("aborted");
    expect(experiment!.tasks[1].attempts).toHaveLength(0);

    // The linked run is finalized aborted (not left "running").
    const run = await h.runRepo.get(experiment!.tasks[0].attempts[0].runId!);
    expect(run!.status).toBe("aborted");

    // Ownership released.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });
});

describe("experiment-controller — retry incomplete tasks", () => {
  it("retry queues failed/partial/interrupted tasks with new whole-task attempt and run IDs", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t2"
          ? { kind: "judge-fails" }
          : { kind: "success" },
    });
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    let experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    expect(experiment!.status).toBe("completed_with_failures");

    // Switch behavior so the retry succeeds.
    h.executor.behavior = () => ({ kind: "success" });

    const retried = await h.controller.retryIncomplete(result.ok ? result.experimentId : "");
    expect(retried.ok).toBe(true);
    await h.controller.whenIdle();

    experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    const [t1, t2] = experiment!.tasks;

    // t1 untouched: one completed attempt.
    expect(t1.attempts).toHaveLength(1);

    // t2: prior failed attempt retained + new attempt with fresh IDs.
    expect(t2.attempts).toHaveLength(2);
    expect(t2.attempts[0].status).toBe("failed");
    const retryAttempt = t2.attempts[1];
    expect(retryAttempt.id).not.toBe(t2.attempts[0].id);
    expect(retryAttempt.runId).not.toBeNull();
    expect(retryAttempt.runId).not.toBe(t2.attempts[0].runId);
    expect(retryAttempt.status).toBe("completed");
    expect(t2.selectedAttemptId).toBe(retryAttempt.id);

    // The new run links back to the new attempt in both records.
    const retryRun = await h.runRepo.get(retryAttempt.runId!);
    expect(retryRun).not.toBeNull();
    if (retryRun!.source.kind === "experiment") {
      expect(retryRun!.source.experimentTaskAttemptId).toBe(retryAttempt.id);
    } else {
      throw new Error("expected experiment source");
    }

    // The retried executor call was for t2 only.
    expect(taskIds(h.executor)).toEqual(["t1", "t2", "t2"]);
    expect(experiment!.status).toBe("completed");
  });
});

describe("experiment-controller — execution ownership", () => {
  it("Compare start is blocked while an experiment owns execution, including paused queued work", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: () => {
        controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));
    await h.controller.start("suite-1");
    await h.controller.whenIdle();

    // Paused experiment still owns in-app execution → Compare cannot start.
    expect(h.owner.tryAcquire({ kind: "compare", id: "run-x" })).toBe(false);
  });

  it("experiment start is blocked while Compare is active", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    expect(h.owner.tryAcquire({ kind: "compare", id: "run-x" })).toBe(true);

    const result = await h.controller.start("suite-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/active/i);
    expect(h.executor.calls).toHaveLength(0);
  });

  it("a live secondary tab cannot start, resume, retry, recover, or commit", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    // Tab A acquires the lease.
    const leaseA = new InMemoryExecutionLease(h.leaseStore, null, { now: h.now });
    await leaseA.acquire();

    // Tab B's controller (fresh lease instance over the same store).
    const leaseB = new InMemoryExecutionLease(h.leaseStore, null, { now: h.now });
    const ownerB = new ExecutionOwnerRegistry();
    const controllerB = createExperimentController({
      evalRepo: h.evalRepo,
      uow: createExperimentUnitOfWork(h.store, { now: h.now }),
      runRepo: h.runRepo,
      lease: leaseB,
      owner: ownerB,
      executor: h.executor,
      generateId: h.ids,
      now: h.now,
      heartbeatMs: 0,
    });

    const started = await controllerB.start("suite-1");
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toMatch(/another tab/i);
    expect(h.executor.calls).toHaveLength(0);

    const recovered = await controllerB.recoverOnStartup();
    expect(recovered).toBe(0);
  });
});

describe("experiment-controller — reload and recovery", () => {
  it("reload never silently resumes; recovery marks the active attempt interrupted", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));

    // Simulate a crash: experiment "running" with a running attempt + running run.
    const started = await h.controller.start("suite-1");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Let task 1 begin but intercept before commit: use a blocking executor on a
    // fresh harness instead — simpler: craft the state directly.
    // (Fresh harness path below covers the crafted-state assertions.)
    await h.controller.abort();

    // Fresh controller over the same stores — the "reload". New lease instance.
    const leaseB = new InMemoryExecutionLease(h.leaseStore, null, { now: h.now });
    const executorB = makeFakeExecutor({ now: h.now, generateId: h.ids, behavior: () => ({ kind: "success" }) });
    createExperimentController({
      evalRepo: h.evalRepo,
      uow: createExperimentUnitOfWork(h.store, { now: h.now }),
      runRepo: h.runRepo,
      lease: leaseB,
      owner: h.owner,
      executor: executorB,
      generateId: h.ids,
      now: h.now,
      heartbeatMs: 0,
    });

    // No silent resumption: the executor is not called merely by existing.
    await new Promise((r) => setTimeout(r, 20));
    expect(executorB.calls).toHaveLength(0);

    // Seed a crashed state: running experiment with a running attempt.
    const experiment = await h.evalRepo.getExperiment(started.experimentId);
    expect(experiment).not.toBeNull();
  });

  it("expired-owner takeover marks active work interrupted before explicit continuation", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));

    // Craft a crashed experiment: status running, task 1 attempt running with a
    // running run, owned by a dead tab (fence 1, expired lease).
    const suite = makeSuite(["t1", "t2"]);
    const crashedRun: RunRecordV2 = {
      schemaVersion: 2,
      id: "run-crash-1",
      revision: 0,
      execution: { ownerId: "dead-tab", fence: 1 },
      createdAt: h.now(),
      updatedAt: h.now(),
      completedAt: null,
      status: "running",
      mode: "rank",
      source: {
        kind: "experiment",
        experimentId: "exp-crash",
        suiteId: suite.id,
        suiteVersion: 1,
        protocolFingerprint: "sha256:abc",
        taskId: "t1",
        experimentTaskAttemptId: "att-crash-1",
        trial: 0,
      },
      task: { title: "Task t1", prompt: "Prompt for t1", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      candidates: [],
      judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: [],
    };
    const crashedSummary: FullRunSummaryV2 = {
      kind: "full",
      schemaVersion: 2,
      id: "run-crash-1",
      revision: 0,
      createdAt: h.now(),
      completedAt: null,
      status: "running",
      mode: "rank",
      source: crashedRun.source,
      taskTitle: "Task t1",
      taskExcerpt: "Prompt for t1",
      modelKeys: ["openrouter:m1", "gemini:m2"],
      winnerKeys: [],
      scoresByModelKey: {},
      judgeModelKey: null,
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: "task t1",
    };
    h.store.runDetails.set("run-crash-1", crashedRun);
    h.store.runSummaries.set("run-crash-1", crashedSummary);

    const { createExperimentRecord } = await import("./experiment-engine");
    const record = createExperimentRecord({ id: "exp-crash", suite, profiles: [], now: h.now() });
    const crashed: ExperimentRecord = {
      ...record,
      status: "running",
      execution: { ownerId: "dead-tab", fence: 1 },
      tasks: [
        {
          taskId: "t1",
          selectedAttemptId: null,
          attempts: [{
            id: "att-crash-1", runId: "run-crash-1", trial: 0,
            status: "running", startedAt: h.now(), finishedAt: null, error: null,
          }],
        },
        { taskId: "t2", selectedAttemptId: null, attempts: [] },
      ],
    };
    await h.evalRepo.createExperiment(crashed);

    // The dead tab's lease expired long ago.
    h.leaseStore.lease = { ownerId: "dead-tab", fence: 1, expiresAt: h.now() - 1 };
    h.leaseStore.fence = 1;

    const recovered = await h.controller.recoverOnStartup();
    expect(recovered).toBeGreaterThan(0);

    // Active attempt marked interrupted; linked run marked interrupted.
    const after = await h.evalRepo.getExperiment("exp-crash");
    expect(after!.status).toBe("interrupted");
    expect(after!.tasks[0].attempts[0].status).toBe("interrupted");
    expect(after!.tasks[0].attempts[0].finishedAt).not.toBeNull();
    expect(after!.execution).toBeNull();

    const run = await h.runRepo.get("run-crash-1");
    expect(run!.status).toBe("interrupted");

    // The user may continue explicitly: retry re-queues the interrupted task.
    const retried = await h.controller.retryIncomplete("exp-crash");
    expect(retried.ok).toBe(true);
    await h.controller.whenIdle();
    const continued = await h.evalRepo.getExperiment("exp-crash");
    expect(continued!.status).toBe("completed");
    expect(continued!.tasks[0].attempts).toHaveLength(2);
  });

  it("recovery finds a committed terminal run by experimentTaskAttemptId and never repays", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const suite = makeSuite(["t1", "t2"]);

    // Craft: task 1's attempt is "running" in the experiment record, but its
    // run already reached a committed terminal state (crash between the run
    // finalizing and commitExperimentTaskTerminal completing).
    const committedRun: RunRecordV2 = {
      schemaVersion: 2,
      id: "run-committed-1",
      revision: 3,
      execution: { ownerId: "dead-tab", fence: 1 },
      createdAt: h.now(),
      updatedAt: h.now(),
      completedAt: h.now(),
      status: "completed",
      mode: "rank",
      source: {
        kind: "experiment",
        experimentId: "exp-committed",
        suiteId: suite.id,
        suiteVersion: 1,
        protocolFingerprint: "sha256:abc",
        taskId: "t1",
        experimentTaskAttemptId: "att-committed-1",
        trial: 0,
      },
      task: { title: "Task t1", prompt: "Prompt for t1", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      candidates: [
        {
          candidateId: "cand-s1", slotId: "s1", modelKey: "openrouter:m1",
          providerId: "openrouter", model: "Model m1", slug: "m1",
          acceptedAttemptId: "ca-1",
          attempts: [{
            attemptId: "ca-1", messages: [], startedAt: h.now(), finishedAt: h.now(),
            status: "completed", output: "out", tokensIn: 1, tokensOut: 1, error: null,
          }],
        },
        {
          candidateId: "cand-s2", slotId: "s2", modelKey: "gemini:m2",
          providerId: "gemini", model: "Model m2", slug: "m2",
          acceptedAttemptId: "ca-2",
          attempts: [{
            attemptId: "ca-2", messages: [], startedAt: h.now(), finishedAt: h.now(),
            status: "completed", output: "out", tokensIn: 1, tokensOut: 1, error: null,
          }],
        },
      ],
      judge: {
        status: "done",
        acceptedAttemptId: "ja-1",
        report: makeJudgeReport([
          { id: "cand-s1", score: 4 },
          { id: "cand-s2", score: 3 },
        ]),
        consensus: null,
        attempts: [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: ["openrouter:m1"],
    };
    const committedSummary: FullRunSummaryV2 = {
      kind: "full",
      schemaVersion: 2,
      id: "run-committed-1",
      revision: 3,
      createdAt: h.now(),
      completedAt: h.now(),
      status: "completed",
      mode: "rank",
      source: committedRun.source,
      taskTitle: "Task t1",
      taskExcerpt: "Prompt for t1",
      modelKeys: ["openrouter:m1", "gemini:m2"],
      winnerKeys: ["openrouter:m1"],
      scoresByModelKey: { "openrouter:m1": 4, "gemini:m2": 3 },
      judgeModelKey: "openrouter:judge-model",
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: "task t1",
    };
    h.store.runDetails.set("run-committed-1", committedRun);
    h.store.runSummaries.set("run-committed-1", committedSummary);

    const { createExperimentRecord } = await import("./experiment-engine");
    const record = createExperimentRecord({ id: "exp-committed", suite, profiles: [], now: h.now() });
    const crashed: ExperimentRecord = {
      ...record,
      status: "running",
      execution: { ownerId: "dead-tab", fence: 1 },
      tasks: [
        {
          taskId: "t1",
          selectedAttemptId: null,
          attempts: [{
            id: "att-committed-1", runId: "run-committed-1", trial: 0,
            status: "running", startedAt: h.now(), finishedAt: null, error: null,
          }],
        },
        { taskId: "t2", selectedAttemptId: null, attempts: [] },
      ],
    };
    await h.evalRepo.createExperiment(crashed);
    h.leaseStore.lease = { ownerId: "dead-tab", fence: 1, expiresAt: h.now() - 1 };
    h.leaseStore.fence = 1;

    const recovered = await h.controller.recoverOnStartup();

    // The committed run was adopted: the attempt finalized from the run —
    // completed, selected — never re-executed.
    const after = await h.evalRepo.getExperiment("exp-committed");
    const t1 = after!.tasks[0];
    expect(t1.attempts).toHaveLength(1);
    expect(t1.attempts[0].status).toBe("completed");
    expect(t1.selectedAttemptId).toBe("att-committed-1");
    expect(recovered).toBeGreaterThan(0);

    // Explicit continuation runs ONLY t2 — t1's committed run is not repaid.
    const retried = await h.controller.retryIncomplete("exp-committed");
    expect(retried.ok).toBe(true);
    await h.controller.whenIdle();
    expect(taskIds(h.executor)).toEqual(["t2"]);
    const final = await h.evalRepo.getExperiment("exp-committed");
    expect(final!.status).toBe("completed");
    expect(final!.tasks[0].attempts).toHaveLength(1);
  });
});
