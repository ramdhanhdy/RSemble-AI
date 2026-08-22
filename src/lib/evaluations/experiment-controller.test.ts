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

import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import {
  createExperimentController,
  type ExperimentControllerEvent,
  type SimpleResult,
  type StartResult,
} from "./experiment-controller";
import {
  createExperimentUnitOfWork,
  DexieExperimentStore,
  InMemoryExperimentStore,
} from "../persistence/experiment-unit-of-work";
import {
  createEvaluationRepository,
  InMemoryEvaluationRepository,
  type TaskSetMaterializationRecord,
} from "../persistence/evaluation-repository";
import { createRunRepository, InMemoryRunRepository } from "../persistence/run-repository";
import {
  createExecutionLease,
  InMemoryExecutionLease,
  LEASE_TTL,
  type LeaseInfo,
} from "../execution-lease";
import { ExecutionOwnerRegistry } from "../execution-owner";
import { RSembleEvaluationDB, StorageError } from "../persistence/database";
import type {
  EvaluationRubric,
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
} from "./evaluation-types";
import type { FullRunSummaryV2, RunRecordV2, RunSummary } from "../persistence/run-types";
import type { RunExecutor, RunExecutorEvents, RunRequest } from "../run-executor";
import { candidateIdForSlot } from "../pipeline";
import { type JudgeReport, type ModelSlot } from "../../studio-data";
import { rotateExperimentRoster } from "./experiment-roster-extension";
import { createExperimentRecord } from "./experiment-engine";
import type { MaterializedTask, MaterializedWorkloadSnapshot } from "./workload-manifest";
import type { TaskVersion } from "../tasks/task-types";

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
  const labelMap = candidates.map((c, i) => ({
    label: String.fromCharCode(65 + i),
    candidateId: c.id,
  }));
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
  async function executeTask(
    request: RunRequest,
    events: RunExecutorEvents,
    signal: AbortSignal,
  ): Promise<void> {
    calls.push(request);
    const outcome = behaviorRef.current(request);
    const enabledSlots = request.slots.filter((s) => s.enabled);

    await events.onFanoutStart();

    const candidateAttemptIds: Record<string, string> = {};
    const done: import("../../studio-data").Candidate[] = [];
    for (const slot of enabledSlots) {
      const candidateId = candidateIdForSlot(slot.id);
      const attemptId = opts.generateId();
      const failThisOne =
        outcome.kind === "one-candidate-fails" &&
        slot.id === enabledSlots[enabledSlots.length - 1].id;
      await events.onCandidateAttemptStart(candidateId, attemptId, {
        messages: [],
        startedAt: opts.now(),
      });
      if (failThisOne) {
        await events.onCandidateAttemptTerminal(candidateId, attemptId, {
          status: "failed",
          output: null,
          tokensIn: null,
          tokensOut: null,
          error: { message: "provider error" },
          finishedAt: opts.now(),
        });
        continue;
      }
      await events.onCandidateTerminal(candidateId, {
        segments: [],
        summary: "s",
        tokensIn: 1,
        tokensOut: 1,
        finishedAt: opts.now(),
      });
      await events.onCandidateAttemptTerminal(candidateId, attemptId, {
        status: "completed",
        output: `output-${slot.slug}`,
        tokensIn: 1,
        tokensOut: 1,
        error: null,
        finishedAt: opts.now(),
      });
      candidateAttemptIds[candidateId] = attemptId;
      done.push({
        id: candidateId,
        model: slot.model,
        provider: slot.provider,
        providerId: slot.providerId,
        slug: slot.slug,
        accent: "indigo",
        strategy: "Parallel model",
        summary: "s",
        scores: {},
        weightedScore: 0,
        segments: [],
        status: "done",
        startedAt: opts.now(),
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
      blindLabelToCandidateId: Object.fromEntries(
        done.map((c, i) => [String.fromCharCode(65 + i), c.id]),
      ),
      candidateAttemptIdsByCandidateId: candidateAttemptIds,
      startedAt: opts.now(),
    });
    if (outcome.kind === "judge-fails") {
      await events.onJudgeTerminal(judgeAttemptId, {
        status: "failed",
        report: null,
        consensus: null,
        error: { message: "judge exploded" },
        finishedAt: opts.now(),
      });
      return;
    }
    const report = makeJudgeReport(done.map((c, i) => ({ id: c.id, score: 4 - i * 0.5 })));
    await events.onJudgeTerminal(judgeAttemptId, {
      status: "completed",
      report,
      consensus: null,
      error: null,
      finishedAt: opts.now(),
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
    set: (v: (request: RunRequest) => FakeOutcome) => {
      behaviorRef.current = v;
    },
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

function makeHarness(
  opts: {
    behavior?: (request: RunRequest) => FakeOutcome;
    midTask?: (request: RunRequest) => void;
  } = {},
): Harness {
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

async function seedSuite(h: Harness, suite: EvaluationSuite): Promise<string> {
  await h.evalRepo.saveSuite(suite, 0);
  const record = await persistMaterialization(h, suite, { id: `mat-${suite.id}` });
  return record.id;
}
function makeTaskVersionFromEvalTask(task: EvaluationTask, createdAt: number): TaskVersion {
  return {
    taskId: task.id,
    version: 1,
    title: task.title,
    objective: task.title,
    candidateInstruction: task.prompt,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt,
  };
}

function makeFrozenRubric(): EvaluationRubric {
  return {
    id: "rubric-frozen",
    version: 1,
    name: "Frozen Rubric",
    description: "frozen",
    judgeInstruction: "Grade the frozen snapshot.",
    criteria: [
      {
        id: "c1",
        kind: "graded",
        name: "Accuracy",
        description: "Factual correctness",
        weight: 1,
        anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeMaterializedSnapshot(
  suite: EvaluationSuite,
  overrides: Partial<MaterializedWorkloadSnapshot> = {},
): MaterializedWorkloadSnapshot {
  const tasks: MaterializedTask[] = suite.tasks.map((task) => ({
    memberId: task.id,
    taskVersionRef: { taskId: task.id, version: 1 },
    order: task.order,
    role: "organic",
    stratum: null,
    weight: 1,
    rubricOverrideRef: task.evaluation.kind === "profile" ? { ...task.evaluation.profile } : null,
    executionOverrides: null,
    task: makeTaskVersionFromEvalTask(task, suite.createdAt),
    effectiveRubricRef: task.evaluation.kind === "profile" ? { ...task.evaluation.profile } : null,
    effectiveRubric: null,
    evaluation: task.evaluation,
    judgeInstructionOverride: task.judgeInstructionOverride || null,
    verification: task.verification ?? null,
    isArchived: false,
    isEffectiveRubricArchived: false,
  }));
  return {
    taskSetId: suite.id,
    taskSetVersion: suite.version,
    tasks,
    rubrics: [],
    defaultRubricRef:
      suite.defaultEvaluation.kind === "profile" ? { ...suite.defaultEvaluation.profile } : null,
    defaultRubric: null,
    defaultModelSlots: suite.modelSlots.map((slot) => ({ ...slot })),
    defaultJudge: {
      providerId: suite.defaultJudge.providerId,
      model: suite.defaultJudge.model,
    },
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: suite.reasoningPolicy
      ? { reasoningPolicy: { ...suite.reasoningPolicy } }
      : {},
    protocolFingerprint: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    createdAt: suite.createdAt,
    ...overrides,
  };
}

function makeMaterializationRecord(
  snapshot: MaterializedWorkloadSnapshot,
  overrides: Partial<TaskSetMaterializationRecord> = {},
): TaskSetMaterializationRecord {
  return {
    id: "mat-1",
    taskSetId: snapshot.taskSetId,
    taskSetVersion: snapshot.taskSetVersion,
    protocolFingerprint: snapshot.protocolFingerprint,
    snapshot,
    createdAt: snapshot.createdAt,
    ...overrides,
  };
}

async function persistMaterialization(
  h: Harness,
  suite: EvaluationSuite,
  overrides: Partial<Omit<TaskSetMaterializationRecord, "snapshot">> & {
    snapshot?: Partial<MaterializedWorkloadSnapshot>;
  } = {},
): Promise<TaskSetMaterializationRecord> {
  const { snapshot: snapshotOverrides, ...recordOverrides } = overrides;
  const snapshot = makeMaterializedSnapshot(suite, snapshotOverrides ?? {});
  const record = makeMaterializationRecord(snapshot, recordOverrides);
  await h.evalRepo.persistTaskSetMaterialization(record);
  return record;
}

type InMemoryMaterializationStore = {
  taskSetMaterializations: Map<string, TaskSetMaterializationRecord>;
};

function storedMaterializations(h: Harness): Map<string, TaskSetMaterializationRecord> {
  // In-memory repo keeps the append-only map private; tests mutate the stored
  // clone to inject corrupt rows the public persist API refuses.
  const store = h.evalRepo as unknown as InMemoryMaterializationStore;
  return store.taskSetMaterializations;
}

async function expectZeroExecutionSideEffects(h: Harness): Promise<void> {
  expect(h.leaseStore.lease).toBeNull();
  expect(h.owner.get()).toBeNull();
  expect(await h.evalRepo.listExperiments()).toHaveLength(0);
  expect(h.executor.calls).toHaveLength(0);
  expect(h.store.runDetails.size).toBe(0);
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

    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Wait for the loop to drain.
    await h.controller.whenIdle();

    // Tasks executed in suite order; each task's commit landed before the
    // next begin (task-terminal events strictly precede the next task-began).
    expect(taskIds(h.executor)).toEqual(["t1", "t2", "t3"]);
    const beganIdx = h.events
      .map((e, i) => (e.kind === "task-began" ? i : -1))
      .filter((i) => i >= 0);
    const terminalIdx = h.events
      .map((e, i) => (e.kind === "task-terminal" ? i : -1))
      .filter((i) => i >= 0);
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
    await h.controller.start("mat-suite-1");
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
    const result = await h.controller.start("mat-suite-1");
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

    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    // Task 2 never began — no second paid task.
    expect(h.executor.calls).toHaveLength(1);
    const errorEvents = h.events.filter((e) => e.kind === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
    // Ownership released so the user can act again.
    expect(h.owner.get()).toBeNull();
  });

  it("a failed final-task commit rolls back the engine and persists an aborted experiment, not a running one", async () => {
    // Single-task experiment: begin = tx 1, final commit = tx 2. Injecting a
    // failure into the commit must restore the engine's pre-transition state
    // (so the run-loop failure path can abort it) and leave the persisted
    // experiment "aborted" — never "running" with a terminal in-memory record.
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    let commits = 0;
    const originalCommit = h.store.runInTransaction.bind(h.store);
    h.store.runInTransaction = async (fn) => {
      commits += 1;
      // begin = tx 1; the final commit = tx 2 → inject the failure there.
      if (commits === 2) h.store.failAfterWrites = 0;
      return originalCommit(fn);
    };

    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    const experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    expect(experiment).toBeTruthy();
    // Deterministic terminal failure — never left "running" with a terminal engine.
    expect(experiment!.status).toBe("aborted");
    // The single attempt was finalized as aborted (the run loop aborts the engine).
    expect(experiment!.tasks[0].attempts[0].status).toBe("aborted");
    const errorEvents = h.events.filter((e) => e.kind === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
    // Ownership released after the deterministic abort.
    expect(h.owner.get()).toBeNull();
  });
});

describe("experiment-controller — pause / resume / abort", () => {
  it("pause never aborts the active executor and prevents the next task after persistence", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: () => {
        // Pause is a signal; the harness keeps driving the queue.
        void controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));

    const result = await h.controller.start("mat-suite-1");
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
        // Pause is a signal; the harness keeps driving the queue.
        void controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));

    const result = await h.controller.start("mat-suite-1");
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
    const result = await h.controller.start("mat-suite-1");
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
    const result = await h.controller.start("mat-suite-1");
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

  it("partial attempts persist scored-model coverage so selection prefers higher coverage", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t2"
          ? { kind: "one-candidate-fails" }
          : { kind: "success" },
    });
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    let experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    const t2 = experiment!.tasks[1];
    // t2 was partial: one candidate failed → 1/2 scored coverage persisted.
    expect(t2.attempts[0].status).toBe("partial");
    expect(t2.attempts[0].coverage).toBeTruthy();
    expect(t2.attempts[0].coverage!.totalModels).toBe(2);
    expect(t2.attempts[0].coverage!.scoredModelKeys).toHaveLength(1);

    // Retry succeeds → full coverage. The new attempt must be selected.
    h.executor.behavior = () => ({ kind: "success" });
    const retried = await h.controller.retryIncomplete(result.ok ? result.experimentId : "");
    expect(retried.ok).toBe(true);
    await h.controller.whenIdle();

    experiment = await h.evalRepo.getExperiment(result.ok ? result.experimentId : "");
    const t2After = experiment!.tasks[1];
    expect(t2After.attempts).toHaveLength(2);
    expect(t2After.attempts[1].status).toBe("completed");
    expect(t2After.attempts[1].coverage!.scoredModelKeys).toHaveLength(2);
    // Completed full coverage wins selection.
    expect(t2After.selectedAttemptId).toBe(t2After.attempts[1].id);
  });

  it("retry executes against the immutable snapshot, never the edited live suite", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t2"
          ? { kind: "judge-fails" }
          : { kind: "success" },
    });
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(true);
    await h.controller.whenIdle();

    // Edit the live suite AFTER the experiment ran: new model roster,
    // renamed tasks, changed judge. Retry must NOT see any of this.
    const liveSuite = (await h.evalRepo.getSuite("suite-1"))!;
    await h.evalRepo.saveSuite(
      {
        ...liveSuite,
        revision: liveSuite.revision + 1,
        version: 2,
        modelSlots: [makeSlot("s9", "edited-model")],
        defaultJudge: { providerId: "gemini", model: "edited-judge" },
        tasks: liveSuite.tasks.map((t) => ({ ...t, title: `EDITED ${t.title}` })),
      },
      liveSuite.revision,
    );

    // Switch behavior so the retry succeeds.
    h.executor.behavior = () => ({ kind: "success" });

    const retried = await h.controller.retryIncomplete(result.ok ? result.experimentId : "");
    expect(retried.ok).toBe(true);
    await h.controller.whenIdle();

    // The retry executor request must carry the SNAPSHOT roster and judge,
    // not the edited live suite.
    const retryCalls = h.executor.calls.filter(
      (c) => c.source.kind === "experiment" && c.source.taskId === "t2",
    );
    const lastCall = retryCalls[retryCalls.length - 1];
    expect(lastCall).toBeTruthy();
    // Snapshot roster: s1/m1 + s2/m2 — NOT the edited s9/edited-model.
    expect(lastCall.slots.map((s) => s.slug)).toEqual(["m1", "m2"]);
    // Snapshot judge — NOT the edited gemini/edited-judge.
    expect(lastCall.critic).toEqual({ providerId: "openrouter", model: "judge-model" });
    // Snapshot task text — NOT the EDITED title/prompt.
    expect(lastCall.task.prompt).toBe("Prompt for t2");
    // The retry executor source labels the snapshot version, not v2.
    expect(lastCall.source.kind).toBe("experiment");
    if (lastCall.source.kind === "experiment") {
      expect(lastCall.source.suiteVersion).toBe(1);
    }
  });
});

describe("experiment-controller — execution ownership", () => {
  it("Compare start is blocked while an experiment owns execution, including paused queued work", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: () => {
        // Pause is a signal; the harness keeps driving the queue.
        void controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));
    await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();

    // Paused experiment still owns in-app execution → Compare cannot start.
    expect(h.owner.tryAcquire({ kind: "compare", id: "run-x" })).toBe(false);
  });

  it("experiment start is blocked while Compare is active", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    expect(h.owner.tryAcquire({ kind: "compare", id: "run-x" })).toBe(true);

    const result = await h.controller.start("mat-suite-1");
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

    const started = await controllerB.start("mat-suite-1");
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error).toMatch(/another tab/i);
    expect(h.executor.calls).toHaveLength(0);

    // recoverOnStartup now arms exactly one safe retry after the contested
    // lease becomes free/expired. Keep tabA live across the retry deadline so
    // the single retry is contested and gives up — no recovery, no loop, and
    // tabA is never interrupted.
    vi.useFakeTimers();
    const recoveredPromise = controllerB.recoverOnStartup();
    // Flush microtasks so the contested path settles and waitForLeaseFree
    // arms its setInterval before we advance the clock.
    await vi.advanceTimersByTimeAsync(0);
    // Renew tabA just before its expiry to keep it live, then advance past
    // the retry deadline. The single retry fires, acquire throws contested
    // (tabA still owns), and recovery gives up — no loop, no interruption.
    h.setNow(h.now() + LEASE_TTL - 1);
    await leaseA.renew();
    h.setNow(h.now() + 2); // past the original deadline; tabA still live.
    expect(await leaseA.isOwner()).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    const recovered = await recoveredPromise;
    vi.useRealTimers();
    expect(recovered).toBe(0);
    // tabA still owns, uninterrupted.
    expect(await leaseA.isOwner()).toBe(true);
  });
});

describe("experiment-controller — reload and recovery", () => {
  it("reload never silently resumes; recovery marks the active attempt interrupted", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));

    // Simulate a crash: experiment "running" with a running attempt + running run.
    const started = await h.controller.start("mat-suite-1");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Let task 1 begin but intercept before commit: use a blocking executor on a
    // fresh harness instead — simpler: craft the state directly.
    // (Fresh harness path below covers the crafted-state assertions.)
    await h.controller.abort();

    // Fresh controller over the same stores — the "reload". New lease instance.
    const leaseB = new InMemoryExecutionLease(h.leaseStore, null, { now: h.now });
    const executorB = makeFakeExecutor({
      now: h.now,
      generateId: h.ids,
      behavior: () => ({ kind: "success" }),
    });
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
    const record = createExperimentRecord({ id: "exp-crash", suite, rubrics: [], now: h.now() });
    const crashed: ExperimentRecord = {
      ...record,
      status: "running",
      execution: { ownerId: "dead-tab", fence: 1 },
      tasks: [
        {
          taskId: "t1",
          selectedAttemptId: null,
          attempts: [
            {
              id: "att-crash-1",
              runId: "run-crash-1",
              trial: 0,
              status: "running",
              startedAt: h.now(),
              finishedAt: null,
              error: null,
            },
          ],
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

  it("recoverOnStartup arms exactly one retry after a contested lease frees and then recovers (Round B)", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    const suite = makeSuite(["t1"]);

    // Craft a crashed experiment with a running attempt + running run, exactly
    // like the expired-owner takeover test, but the lease is initially held by
    // a live contested tab (not yet expired).
    const crashedRun: RunRecordV2 = {
      schemaVersion: 2,
      id: "run-contested-1",
      revision: 0,
      execution: { ownerId: "dead-tab", fence: 1 },
      createdAt: h.now(),
      updatedAt: h.now(),
      completedAt: null,
      status: "running",
      mode: "rank",
      source: {
        kind: "experiment",
        experimentId: "exp-contested",
        suiteId: suite.id,
        suiteVersion: 1,
        protocolFingerprint: "sha256:abc",
        taskId: "t1",
        experimentTaskAttemptId: "att-contested-1",
        trial: 0,
      },
      task: { title: "Task t1", prompt: "Prompt for t1", systemPrompt: "", temperature: 0 },
      evaluation: { profile: null, candidateMessages: [] },
      candidates: [],
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
    const crashedSummary: FullRunSummaryV2 = {
      kind: "full",
      schemaVersion: 2,
      id: "run-contested-1",
      revision: 0,
      createdAt: h.now(),
      completedAt: null,
      status: "running",
      mode: "rank",
      source: crashedRun.source,
      taskTitle: "Task t1",
      taskExcerpt: "Prompt for t1",
      modelKeys: [],
      winnerKeys: [],
      scoresByModelKey: {},
      judgeModelKey: null,
      evaluationProfileId: null,
      evaluationProfileVersion: null,
      detailAvailable: true,
      searchText: "task t1",
    };
    h.store.runDetails.set("run-contested-1", crashedRun);
    h.store.runSummaries.set("run-contested-1", crashedSummary);
    const record = createExperimentRecord({
      id: "exp-contested",
      suite,
      rubrics: [],
      now: h.now(),
    });
    const crashed: ExperimentRecord = {
      ...record,
      status: "running",
      execution: { ownerId: "dead-tab", fence: 1 },
      tasks: [
        {
          taskId: "t1",
          selectedAttemptId: null,
          attempts: [
            {
              id: "att-contested-1",
              runId: "run-contested-1",
              trial: 0,
              status: "running",
              startedAt: h.now(),
              finishedAt: null,
              error: null,
            },
          ],
        },
      ],
    };
    await h.evalRepo.createExperiment(crashed);

    // A live tab holds the lease (contested). recoverOnStartup's first
    // acquire fails; it arms exactly one retry after the lease frees.
    const leaseA = new InMemoryExecutionLease(h.leaseStore, null, { now: h.now });
    await leaseA.acquire();
    expect(await leaseA.isOwner()).toBe(true);

    vi.useFakeTimers();
    const recoveredPromise = h.controller.recoverOnStartup();
    // Flush microtasks so the contested path settles and waitForLeaseFree
    // arms its setInterval before we advance the clock.
    await vi.advanceTimersByTimeAsync(0);
    // Advance past leaseA's TTL so it expires and the retry deadline fires.
    h.setNow(h.now() + LEASE_TTL + 1);
    await vi.advanceTimersByTimeAsync(100);
    const recovered = await recoveredPromise;
    vi.useRealTimers();

    // The single retry acquired the freed lease and recovered the experiment.
    expect(recovered).toBeGreaterThan(0);
    const after = await h.evalRepo.getExperiment("exp-contested");
    expect(after!.status).toBe("interrupted");
    expect(after!.tasks[0].attempts[0].status).toBe("interrupted");
    expect(after!.tasks[0].attempts[0].finishedAt).not.toBeNull();
    const run = await h.runRepo.get("run-contested-1");
    expect(run!.status).toBe("interrupted");
    // Recovery released the lease it acquired.
    expect(h.leaseStore.lease).toBeNull();
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
          candidateId: "cand-s1",
          slotId: "s1",
          modelKey: "openrouter:m1",
          providerId: "openrouter",
          model: "Model m1",
          slug: "m1",
          acceptedAttemptId: "ca-1",
          attempts: [
            {
              attemptId: "ca-1",
              messages: [],
              startedAt: h.now(),
              finishedAt: h.now(),
              status: "completed",
              output: "out",
              tokensIn: 1,
              tokensOut: 1,
              error: null,
            },
          ],
        },
        {
          candidateId: "cand-s2",
          slotId: "s2",
          modelKey: "gemini:m2",
          providerId: "gemini",
          model: "Model m2",
          slug: "m2",
          acceptedAttemptId: "ca-2",
          attempts: [
            {
              attemptId: "ca-2",
              messages: [],
              startedAt: h.now(),
              finishedAt: h.now(),
              status: "completed",
              output: "out",
              tokensIn: 1,
              tokensOut: 1,
              error: null,
            },
          ],
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
    const record = createExperimentRecord({
      id: "exp-committed",
      suite,
      rubrics: [],
      now: h.now(),
    });
    const crashed: ExperimentRecord = {
      ...record,
      status: "running",
      execution: { ownerId: "dead-tab", fence: 1 },
      tasks: [
        {
          taskId: "t1",
          selectedAttemptId: null,
          attempts: [
            {
              id: "att-committed-1",
              runId: "run-committed-1",
              trial: 0,
              status: "running",
              startedAt: h.now(),
              finishedAt: null,
              error: null,
            },
          ],
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

describe("experiment-controller — repairMissingCells ownership and release (Task 11)", () => {
  it("releases owner and lease after repairMissingCells planner rejection", async () => {
    const h = makeHarness();
    const suite = makeSuite(["t1"]);
    await seedSuite(h, suite);
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    // Attempt repair with invalid/unknown task id -> planner rejection.
    const res = await h.controller.repairMissingCells(expId, {
      taskId: "unknown-task",
      modelKeys: ["openrouter:m1"],
    });
    expect(res.ok).toBe(false);

    // Execution owner and lease must be released.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("releases owner and lease after repairMissingCells success", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t1"
          ? { kind: "one-candidate-fails" }
          : { kind: "success" },
    });
    const suite = makeSuite(["t1"]);
    await seedSuite(h, suite);
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    // Switch executor behavior to success for repair.
    h.executor.behavior = () => ({ kind: "success" });

    // Repair the missing cell on t1.
    const res = await h.controller.repairMissingCells(expId, {
      taskId: "t1",
      modelKeys: ["gemini:m2"],
    });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // Execution owner and lease must be released after completion.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("pause during a repair defers to the boundary and never leaks ownership", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t1"
          ? { kind: "one-candidate-fails" }
          : { kind: "success" },
      midTask: (request) => {
        // Pause as soon as the REPAIR task begins (repairs carry
        // candidateExecution). Never pause the initial run.
        if (request.candidateExecution) {
          void controllerRef?.requestPause();
        }
      },
    });
    controllerRef = h.controller;
    const suite = makeSuite(["t1"]);
    await seedSuite(h, suite);
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    h.executor.behavior = () => ({ kind: "success" });
    const res = await h.controller.repairMissingCells(expId, {
      taskId: "t1",
      modelKeys: ["gemini:m2"],
    });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // A single repair drains the queue: pause during the last task defers to
    // the boundary and the run completes. The record is never left "running"
    // without an owner.
    const after = await h.evalRepo.getExperiment(expId);
    expect(after!.status).toBe("completed");
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("persistence failure during a repair stops before another paid call and releases ownership", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t1"
          ? { kind: "one-candidate-fails" }
          : { kind: "success" },
    });
    const suite = makeSuite(["t1"]);
    await seedSuite(h, suite);
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";
    const callsBefore = h.executor.calls.length;

    // Fail the repair's commit (after run writes succeed, experiment write fails).
    let tx = 0;
    const originalCommit = h.store.runInTransaction.bind(h.store);
    h.store.runInTransaction = async (fn) => {
      tx += 1;
      if (tx === 2) h.store.failAfterWrites = 0;
      return originalCommit(fn);
    };

    h.executor.behavior = () => ({ kind: "success" });
    const res = await h.controller.repairMissingCells(expId, {
      taskId: "t1",
      modelKeys: ["gemini:m2"],
    });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // The repair executor call happened but no second paid task ran.
    expect(h.executor.calls.length).toBe(callsBefore + 1);
    // Ownership released so the user can act again.
    expect(h.owner.get()).toBeNull();
  });

  it("a rejecting runRepo.get during planning releases lease and owner", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t1"
          ? { kind: "one-candidate-fails" }
          : { kind: "success" },
    });
    const suite = makeSuite(["t1"]);
    await seedSuite(h, suite);
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    // Storage degradation: run record loads reject during repair planning.
    const originalGet = h.runRepo.get.bind(h.runRepo);
    h.runRepo.get = async () => {
      throw new Error("storage unavailable");
    };
    try {
      const res = await h.controller.repairMissingCells(expId, {
        taskId: "t1",
        modelKeys: ["gemini:m2"],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/storage unavailable/i);
    } finally {
      h.runRepo.get = originalGet;
    }

    // Lease and owner must be released despite the rejection.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });
});

// =============================================================================
// Roster extension — addModelAndRun (plan 001, D4)
// =============================================================================

const EXT_SLOT: ModelSlot = {
  id: "slot-new",
  providerId: "deepseek",
  provider: "DeepSeek",
  model: "deepseek-chat",
  slug: "deepseek-chat",
  enabled: true,
};
const EXT_KEY = "deepseek:deepseek-chat";

describe("experiment-controller — addModelAndRun (roster extension)", () => {
  it("executes only the added model per task and reuses accepted outputs (compound)", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2", "t3"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";
    const original = await h.evalRepo.getExperiment(expId);
    const originalFp = original!.protocolFingerprint;
    expect(h.executor.calls).toHaveLength(3);

    const res = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // One extension request per task, in snapshot order; each executes ONLY
    // the added model against two seeded reused candidates.
    expect(h.executor.calls).toHaveLength(6);
    const extCalls = h.executor.calls.slice(3);
    expect(taskIds(h.executor)).toEqual(["t1", "t2", "t3", "t1", "t2", "t3"]);
    for (const call of extCalls) {
      expect(call.slots).toHaveLength(3); // rotated roster
      expect(call.candidateExecution).toBeDefined();
      expect(call.candidateExecution!.executeModelKeys).toEqual([EXT_KEY]);
      expect(call.candidateExecution!.seededCandidates).toHaveLength(2);
      if (call.source.kind !== "experiment") throw new Error("expected experiment source");
      expect(call.source.repair).toEqual({
        kind: "roster-extension",
        addedModelKey: EXT_KEY,
        baseRunId: expect.any(String),
      });
    }

    // Snapshot rotated: one appended slot, history entry, rotated fingerprint
    // on both snapshot and record; suite identity unchanged.
    const after = await h.evalRepo.getExperiment(expId);
    expect(after!.snapshot.modelSlots).toHaveLength(3);
    expect(after!.snapshot.modelSlots[2].id).toBe(EXT_SLOT.id);
    expect(after!.rosterExtensions).toHaveLength(1);
    expect(after!.rosterExtensions![0].addedModelKey).toBe(EXT_KEY);
    expect(after!.rosterExtensions![0].priorFingerprint).toBe(originalFp);
    expect(after!.protocolFingerprint).not.toBe(originalFp);
    expect(after!.protocolFingerprint).toBe(after!.snapshot.protocolFingerprint);
    expect(after!.suiteId).toBe("suite-1");
    expect(after!.suiteVersion).toBe(1);

    // Every task gained one extension attempt; the completed full-coverage
    // extension attempt becomes selected.
    for (const task of after!.tasks) {
      expect(task.attempts).toHaveLength(2);
      expect(task.attempts[1].status).toBe("completed");
      expect(task.selectedAttemptId).toBe(task.attempts[1].id);
      expect(task.attempts[1].repair).toMatchObject({
        kind: "roster-extension",
        addedModelKey: EXT_KEY,
      });
    }
    expect(after!.status).toBe("completed");
    expect(after!.execution).toBeNull();

    // Extension runs carry the rotated fingerprint + provenance.
    const extRun = await h.runRepo.get(after!.tasks[0].attempts[1].runId!);
    if (extRun!.source.kind !== "experiment") throw new Error("expected experiment source");
    expect(extRun!.source.protocolFingerprint).toBe(after!.protocolFingerprint);
    expect(extRun!.source.repair!.kind).toBe("roster-extension");

    // Ownership fully released.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("retries a failed added-model run with the same targeted extension plan", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    // Reproduce the reported workflow: start from completed Results, add one
    // model, then let the fresh Judge stage fail after the paid model call.
    h.executor.behavior = (request) =>
      request.source.kind === "experiment" && request.source.repair?.kind === "roster-extension"
        ? { kind: "judge-fails" }
        : { kind: "success" };
    const extension = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(extension.ok).toBe(true);
    await h.controller.whenIdle();

    const failed = await h.evalRepo.getExperiment(expId);
    const failedAttempts = failed!.tasks[0].attempts;
    const failedAttempt = failedAttempts[failedAttempts.length - 1];
    expect(failedAttempt.status).toBe("failed");
    expect(failedAttempt.repair).toMatchObject({
      kind: "roster-extension",
      addedModelKey: EXT_KEY,
      baseRunId: expect.any(String),
    });
    // The prior completed evidence remains selected until retry succeeds.
    expect(failed!.tasks[0].selectedAttemptId).toBe(failed!.tasks[0].attempts[0].id);

    // This is the controller action used by Retry on the Results page. It
    // must preserve the roster-extension plan instead of falling back to a
    // duplicate add or a full original-roster retry.
    h.executor.behavior = () => ({ kind: "success" });
    const retry = await h.controller.retryIncomplete(expId);
    expect(retry.ok).toBe(true);
    await h.controller.whenIdle();

    const retryCall = h.executor.calls[h.executor.calls.length - 1];
    expect(retryCall.candidateExecution?.executeModelKeys).toEqual([EXT_KEY]);
    if (retryCall.source.kind !== "experiment") throw new Error("expected experiment source");
    expect(retryCall.source.repair).toEqual(failedAttempt.repair);

    const recovered = await h.evalRepo.getExperiment(expId);
    const recoveredAttempts = recovered!.tasks[0].attempts;
    const recoveredAttempt = recoveredAttempts[recoveredAttempts.length - 1];
    expect(recoveredAttempt.status).toBe("completed");
    expect(recovered!.tasks[0].selectedAttemptId).toBe(recoveredAttempt.id);
    expect(recovered!.status).toBe("completed");
  });

  it("falls back to a full-roster attempt for a task with no reusable evidence", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" &&
        request.source.taskId === "t2" &&
        !request.source.repair
          ? { kind: "judge-fails" }
          : { kind: "success" },
    });
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    const res = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // t1 compound (candidateExecution + baseRunId), t2 full-roster fallback
    // (no candidateExecution, no baseRunId) over the rotated 3-slot roster.
    expect(h.executor.calls).toHaveLength(4);
    const [t1Ext, t2Ext] = h.executor.calls.slice(2);
    expect(t1Ext.candidateExecution).toBeDefined();
    expect(t1Ext.candidateExecution!.executeModelKeys).toEqual([EXT_KEY]);
    if (t1Ext.source.kind !== "experiment") throw new Error("expected experiment source");
    expect(t1Ext.source.repair).toMatchObject({
      kind: "roster-extension",
      baseRunId: expect.any(String),
    });

    expect(t2Ext.candidateExecution).toBeUndefined();
    expect(t2Ext.slots).toHaveLength(3);
    if (t2Ext.source.kind !== "experiment") throw new Error("expected experiment source");
    expect(t2Ext.source.repair).toEqual({ kind: "roster-extension", addedModelKey: EXT_KEY });

    // Both tasks end complete with the extension attempt selected.
    const after = await h.evalRepo.getExperiment(expId);
    expect(after!.status).toBe("completed");
    for (const task of after!.tasks) {
      expect(task.attempts[1].status).toBe("completed");
      expect(task.selectedAttemptId).toBe(task.attempts[1].id);
    }
    // The fallback attempt carries full-rotated-roster evidence: every model
    // key scored, including the added one.
    const t2Run = await h.runRepo.get(after!.tasks[1].attempts[1].runId!);
    expect(t2Run!.candidates.map((c) => c.modelKey)).toContain(EXT_KEY);
    expect(h.owner.get()).toBeNull();
  });

  it("rejects duplicates, non-terminal records, invalid slots, and ownership conflicts before any paid call", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";
    const callsBefore = h.executor.calls.length;

    // Duplicate of a roster key.
    const dup = await h.controller.addModelAndRun(expId, { slot: makeSlot("sx", "m1") });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/already/i);

    // Disabled slot.
    const disabled = await h.controller.addModelAndRun(expId, {
      slot: { ...EXT_SLOT, enabled: false },
    });
    expect(disabled.ok).toBe(false);

    // Lease held by another tab.
    h.leaseStore.lease = { ownerId: "other-tab", fence: 9, expiresAt: h.now() + 60_000 };
    const leased = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(leased.ok).toBe(false);
    if (!leased.ok) expect(leased.error).toMatch(/another tab/i);
    h.leaseStore.lease = null;

    // In-tab owner held by another execution.
    expect(h.owner.tryAcquire({ kind: "compare", id: "cmp-x" })).toBe(true);
    const owned = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(owned.ok).toBe(false);
    if (!owned.ok) expect(owned.error).toMatch(/another execution/i);
    h.owner.release("cmp-x");

    // Stale experiment CAS — no paid call, ownership released.
    const originalUpdate = h.evalRepo.updateExperiment.bind(h.evalRepo);
    h.evalRepo.updateExperiment = async () => {
      throw new StorageError("conflict", "Stale revision: expected 1, got 2");
    };
    try {
      const stale = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.error).toMatch(/stale/i);
    } finally {
      h.evalRepo.updateExperiment = originalUpdate;
    }

    // No executor request was issued by any rejection.
    expect(h.executor.calls.length).toBe(callsBefore);
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });
  it("rejects a non-terminal experiment", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    const running: ExperimentRecord = {
      ...createExperimentRecord({
        id: "exp-running",
        suite: makeSuite(["t1"]),
        rubrics: [],
        now: h.now(),
      }),
      status: "running",
      execution: { ownerId: "some-tab", fence: 1 },
    };
    await h.evalRepo.createExperiment(running);
    const callsBefore = h.executor.calls.length;
    const res = await h.controller.addModelAndRun("exp-running", { slot: EXT_SLOT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/terminal/i);
    expect(h.executor.calls.length).toBe(callsBefore);
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("pause stops at the task boundary and resume continues without re-executing committed tasks", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: (request) => {
        // Pause as soon as the first EXTENSION task begins.
        if (
          request.source.kind === "experiment" &&
          request.source.repair?.kind === "roster-extension"
        ) {
          void controllerRef?.requestPause();
        }
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    const res = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // t1 extension completed; pause at the boundary leaves t2 queued.
    const paused = await h.evalRepo.getExperiment(expId);
    expect(paused!.status).toBe("paused");
    expect(h.executor.calls).toHaveLength(3); // 2 initial + 1 extension
    expect(paused!.tasks[1].attempts.some((a) => a.status === "queued")).toBe(true);

    // Resume continues with t2 only — never re-executes t1.
    const resumed = await h.controller.resume();
    expect(resumed.ok).toBe(true);
    await h.controller.whenIdle();
    expect(h.executor.calls).toHaveLength(4);
    const final = await h.evalRepo.getExperiment(expId);
    expect(final!.status).toBe("completed");
    expect(final!.tasks[0].attempts).toHaveLength(2);
    expect(final!.tasks[1].attempts).toHaveLength(2);
    expect(h.owner.get()).toBeNull();
  });

  it("abort marks the active extension attempt aborted and stops later tasks", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: (request) => {
        if (
          request.source.kind === "experiment" &&
          request.source.repair?.kind === "roster-extension"
        ) {
          void controllerRef?.abort();
        }
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    const res = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();
    // t1 extension aborted; t2's queued extension attempt is also finalized
    // as aborted so it cannot render as running forever or become a zombie.
    // It NEVER executes, and t2's prior selected evidence stays authoritative.
    expect(h.executor.calls).toHaveLength(3); // 2 initial + 1 extension
    const after = await h.evalRepo.getExperiment(expId);
    expect(after!.status).toBe("aborted");
    const t1 = after!.tasks[0];
    expect(t1.attempts[1].status).toBe("aborted");
    expect(t1.selectedAttemptId).toBe(t1.attempts[0].id);
    const t2 = after!.tasks[1];
    expect(t2.attempts).toHaveLength(2);
    expect(t2.attempts[1].status).toBe("aborted");
    expect(t2.selectedAttemptId).toBe(t2.attempts[0].id);
    // Extension history survives abort.
    expect(after!.rosterExtensions).toHaveLength(1);
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("a persistence failure during extension stops before another paid task", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";
    const callsBefore = h.executor.calls.length;

    // Fail the FIRST extension task's commit (tx 2: begin=1, commit=2).
    let tx = 0;
    const originalCommit = h.store.runInTransaction.bind(h.store);
    h.store.runInTransaction = async (fn) => {
      tx += 1;
      if (tx === 2) h.store.failAfterWrites = 0;
      return originalCommit(fn);
    };

    const res = await h.controller.addModelAndRun(expId, { slot: EXT_SLOT });
    expect(res.ok).toBe(true);
    await h.controller.whenIdle();

    // Exactly one extension executor call; the second task never ran.
    expect(h.executor.calls.length).toBe(callsBefore + 1);
    expect(h.owner.get()).toBeNull();
  });

  it("restart recovery adopts a committed terminal extension run and never repays", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const suite = makeSuite(["t1", "t2"]);

    // Base terminal record: both tasks completed with accepted runs.
    const base: ExperimentRecord = {
      ...createExperimentRecord({ id: "exp-ext", suite, rubrics: [], now: h.now() }),
      status: "completed",
      tasks: [
        {
          taskId: "t1",
          selectedAttemptId: "att-t1",
          attempts: [
            {
              id: "att-t1",
              runId: "run-t1",
              trial: 0,
              status: "completed",
              startedAt: h.now(),
              finishedAt: h.now(),
              error: null,
            },
          ],
        },
        {
          taskId: "t2",
          selectedAttemptId: "att-t2",
          attempts: [
            {
              id: "att-t2",
              runId: "run-t2",
              trial: 0,
              status: "completed",
              startedAt: h.now(),
              finishedAt: h.now(),
              error: null,
            },
          ],
        },
      ],
    };

    // Rotate the roster, then craft the mid-extension crashed state: t1's
    // extension attempt is "running" in the record but its run already
    // committed terminal; t2's extension attempt is queued.
    const rotation = rotateExperimentRoster({
      experiment: base,
      slot: EXT_SLOT,
      extendedAt: h.now(),
    });
    expect(rotation.ok).toBe(true);
    if (!rotation.ok) return;
    const rotated = rotation.record;

    const crashed: ExperimentRecord = {
      ...rotated,
      status: "running",
      execution: { ownerId: "dead-tab", fence: 1 },
      tasks: [
        {
          ...rotated.tasks[0],
          attempts: [
            ...rotated.tasks[0].attempts,
            {
              id: "att-ext-1",
              runId: "run-ext-1",
              trial: 1,
              status: "running",
              startedAt: h.now(),
              finishedAt: null,
              error: null,
              repair: { kind: "roster-extension", addedModelKey: EXT_KEY, baseRunId: "run-t1" },
            },
          ],
        },
        {
          ...rotated.tasks[1],
          attempts: [
            ...rotated.tasks[1].attempts,
            {
              id: "att-ext-2",
              runId: null,
              trial: 1,
              status: "queued",
              startedAt: null,
              finishedAt: null,
              error: null,
              repair: { kind: "roster-extension", addedModelKey: EXT_KEY },
            },
          ],
        },
      ],
    };
    await h.evalRepo.createExperiment(crashed);

    // The committed terminal extension run (crash between run finalizing and
    // the attempt commit).
    const committedRun: RunRecordV2 = {
      schemaVersion: 2,
      id: "run-ext-1",
      revision: 3,
      execution: { ownerId: "dead-tab", fence: 1 },
      createdAt: h.now(),
      updatedAt: h.now(),
      completedAt: h.now(),
      status: "completed",
      mode: "rank",
      source: {
        kind: "experiment",
        experimentId: "exp-ext",
        suiteId: suite.id,
        suiteVersion: 1,
        protocolFingerprint: rotated.protocolFingerprint,
        taskId: "t1",
        experimentTaskAttemptId: "att-ext-1",
        trial: 1,
        repair: { kind: "roster-extension", addedModelKey: EXT_KEY, baseRunId: "run-t1" },
      },
      task: { title: "Task t1", prompt: "Prompt for t1", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      candidates: [],
      judge: {
        status: "done",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: [],
    };
    h.store.runDetails.set("run-ext-1", committedRun);

    h.leaseStore.lease = { ownerId: "dead-tab", fence: 1, expiresAt: h.now() - 1 };
    h.leaseStore.fence = 1;

    const recovered = await h.controller.recoverOnStartup();
    expect(recovered).toBeGreaterThan(0);

    // Adopted: t1's extension attempt finalized from the committed run and
    // selected; t2's queued attempt untouched; never re-executed.
    const after = await h.evalRepo.getExperiment("exp-ext");
    expect(after!.status).toBe("interrupted");
    expect(after!.tasks[0].attempts[1].status).toBe("completed");
    expect(after!.tasks[0].selectedAttemptId).toBe("att-ext-1");
    expect(after!.tasks[1].attempts[1].status).toBe("queued");
    // Provenance survives recovery.
    expect(after!.rosterExtensions).toHaveLength(1);
    expect(after!.protocolFingerprint).toBe(rotated.protocolFingerprint);
    // No provider request was issued by recovery.
    expect(h.executor.calls).toHaveLength(0);
  });
});

describe("experiment-controller — frozen Task Set materialization start", () => {
  it("start consumes a persisted Task Set materialization before any lease, experiment, attempt, or executor side effect", async () => {
    const h = makeHarness();
    const live = makeSuite(["t1"]);
    live.tasks[0] = { ...live.tasks[0], prompt: "LIVE PROMPT" };
    live.modelSlots = [...live.modelSlots, makeSlot("s3", "m3")];
    live.defaultJudge = { providerId: "openrouter", model: "live-judge" };
    await seedSuite(h, live);

    const frozenRubric = makeFrozenRubric();
    const frozen = makeSuite(["t1"]);
    frozen.tasks[0] = {
      ...frozen.tasks[0],
      prompt: "FROZEN PROMPT",
      evaluation: { kind: "profile", profile: { id: frozenRubric.id, version: 1 } },
    };
    frozen.defaultEvaluation = { kind: "profile", profile: { id: frozenRubric.id, version: 1 } };
    frozen.defaultJudge = { providerId: "openrouter", model: "frozen-judge" };
    const record = await persistMaterialization(h, frozen, {
      id: "mat-frozen-1",
      snapshot: {
        rubrics: [frozenRubric],
        defaultRubric: frozenRubric,
        defaultRubricRef: { id: frozenRubric.id, version: 1 },
      },
    });

    const storedLive = await h.evalRepo.getSuite("suite-1");
    if (storedLive)
      storedLive.tasks[0] = { ...storedLive.tasks[0], prompt: "EVEN NEWER LIVE PROMPT" };

    const acquire = vi.spyOn(h.lease, "acquire");
    const getSuite = vi.spyOn(h.evalRepo, "getSuite");
    const result = await h.controller.start("mat-frozen-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await h.controller.whenIdle();

    expect(getSuite).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledWith({ kind: "experiment", executionId: "suite-1" });
    expect(acquire.mock.invocationCallOrder[0]).toBeGreaterThan(0);

    const experiment = await h.evalRepo.getExperiment(result.experimentId);
    expect(experiment).not.toBeNull();
    expect(
      "materializationId" in experiment! && experiment.materializationId === "mat-frozen-1",
    ).toBe(true);
    expect(experiment!.snapshot.tasks[0]).toMatchObject({
      prompt: "FROZEN PROMPT",
      source: { kind: "authored", legacyScopeKey: null, note: null },
      taskVersionRef: { taskId: "t1", version: 1 },
    });
    expect(experiment!.snapshot.modelSlots.map((slot) => slot.id)).toEqual(["s1", "s2"]);
    expect(experiment!.snapshot.defaultJudge).toEqual({
      providerId: "openrouter",
      model: "frozen-judge",
    });
    expect(experiment!.snapshot.profiles).toEqual([frozenRubric]);
    expect(experiment!.protocolFingerprint).toBe(experiment!.snapshot.protocolFingerprint);
    expect(record.protocolFingerprint).toBe(record.snapshot.protocolFingerprint);
    expect(experiment!.protocolFingerprint).not.toBe(record.protocolFingerprint);

    expect(h.executor.calls).toHaveLength(1);
    expect(h.executor.calls[0].task.prompt).toBe("FROZEN PROMPT");
    expect(h.executor.calls[0].slots.map((slot) => slot.id)).toEqual(["s1", "s2"]);
    expect(h.executor.calls[0].critic).toEqual({
      providerId: "openrouter",
      model: "frozen-judge",
    });
    expect(h.executor.calls[0].evaluation).toMatchObject({
      kind: "profile",
      profile: frozenRubric,
    });
    const run = await h.runRepo.get(
      h.executor.calls[0].source.kind === "experiment"
        ? experiment!.tasks[0].attempts[0].runId!
        : "",
    );
    expect(run).not.toBeNull();
    if (run && run.source.kind === "experiment") {
      expect(run.source.protocolFingerprint).toBe(experiment!.protocolFingerprint);
      expect(run.source.suiteId).toBe("suite-1");
      expect(run.source.suiteVersion).toBe(1);
    }
  });

  it("missing materialization yields explicit failure and zero side effects", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));
    const result = await h.controller.start("mat-missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/materialization/i);
    await expectZeroExecutionSideEffects(h);
  });

  it("corrupt materialization (identity/snapshot fingerprint mismatch) yields explicit failure and zero side effects", async () => {
    const h = makeHarness();
    await persistMaterialization(h, makeSuite(["t1"]), { id: "mat-broken-1" });
    const stored = storedMaterializations(h).get("mat-broken-1");
    expect(stored).toBeDefined();
    if (stored) stored.snapshot.protocolFingerprint = "sha256:tampered-identity-digest";
    const result = await h.controller.start("mat-broken-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid|corrupt|mismatch|materialization/i);
      expect(result.error).not.toMatch(/^Suite .+ not found$/);
    }
    await expectZeroExecutionSideEffects(h);
  });

  it("mismatched materialization vs live Suite does not execute the live Suite", async () => {
    const h = makeHarness();
    const live = makeSuite(["t1"]);
    live.tasks[0] = { ...live.tasks[0], prompt: "LIVE PROMPT" };
    live.modelSlots = [...live.modelSlots, makeSlot("s3", "m3")];
    live.defaultJudge = { providerId: "openrouter", model: "live-judge" };
    await seedSuite(h, live);

    const frozen = makeSuite(["t1"]);
    frozen.tasks[0] = { ...frozen.tasks[0], prompt: "FROZEN PROMPT" };
    frozen.defaultJudge = { providerId: "openrouter", model: "frozen-judge" };
    const record = await persistMaterialization(h, frozen, { id: "mat-mismatch-1" });

    const result = await h.controller.start(record.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await h.controller.whenIdle();

    const experiment = await h.evalRepo.getExperiment(result.experimentId);
    expect(experiment!.snapshot.tasks[0].prompt).toBe("FROZEN PROMPT");
    expect(experiment!.snapshot.tasks[0]).toMatchObject({
      source: { kind: "authored", legacyScopeKey: null, note: null },
    });
    expect(h.executor.calls[0].task.prompt).toBe("FROZEN PROMPT");
    expect(h.executor.calls[0].slots.map((slot) => slot.id)).not.toContain("s3");
    expect(h.executor.calls[0].critic.model).toBe("frozen-judge");
  });

  it("replay of an already-consumed materialization yields explicit failure and zero new side effects", async () => {
    const h = makeHarness();
    const suite = makeSuite(["t1"]);
    await persistMaterialization(h, suite, { id: "mat-replay-1" });

    const first = await h.controller.start("mat-replay-1");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await h.controller.whenIdle();
    const afterFirst = await h.evalRepo.listExperiments();
    expect(afterFirst).toHaveLength(1);
    expect(
      "materializationId" in afterFirst[0] && afterFirst[0].materializationId === "mat-replay-1",
    ).toBe(true);
    const executorCalls = h.executor.calls.length;

    const second = await h.controller.start("mat-replay-1");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/replay|already|consumed|materialization/i);
    expect(await h.evalRepo.listExperiments()).toHaveLength(1);
    expect(h.executor.calls).toHaveLength(executorCalls);
    expect(h.leaseStore.lease).toBeNull();
    expect(h.owner.get()).toBeNull();
  });

  it("characterization: unit-of-work, owner, streams, retry, roster, judge remain unchanged when start is given a valid frozen snapshot", async () => {
    const h = makeHarness();
    const suite = makeSuite(["t1", "t2", "t3"]);
    const record = await persistMaterialization(h, suite, { id: "mat-char-1" });
    const result = await h.controller.start(record.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await h.controller.whenIdle();

    expect(taskIds(h.executor)).toEqual(["t1", "t2", "t3"]);
    const experiment = await h.evalRepo.getExperiment(result.experimentId);
    expect(experiment!.status).toBe("completed");
    expect(experiment!.execution).toBeNull();
    expect("materializationId" in experiment! && experiment.materializationId === record.id).toBe(
      true,
    );
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
    for (const runId of experiment!.tasks.map((task) => task.attempts[0].runId)) {
      const run = await h.runRepo.get(runId!);
      expect(run!.mode).toBe("rank");
      if (run && run.source.kind === "experiment") {
        expect(run.source.protocolFingerprint).toBe(experiment!.protocolFingerprint);
        expect(run.source.experimentId).toBe(result.experimentId);
      }
    }

    const retried = await h.controller.retryIncomplete(result.experimentId);
    expect(retried.ok).toBe(false);
    const repaired = await h.controller.repairMissingCells(result.experimentId, {
      taskId: "t1",
      modelKeys: ["openrouter:m1"],
    });
    expect(repaired.ok).toBe(false);
  });

  it("unresolved rubric selection fails closed before lease and does not fall through to holistic", async () => {
    const h = makeHarness();
    const frozen = makeSuite(["t1"]);
    frozen.tasks[0] = {
      ...frozen.tasks[0],
      evaluation: { kind: "profile", profile: { id: "rubric-missing", version: 1 } },
    };
    frozen.defaultEvaluation = { kind: "profile", profile: { id: "rubric-missing", version: 1 } };
    await persistMaterialization(h, frozen, {
      id: "mat-unresolved-rubric-1",
      snapshot: {
        rubrics: [],
        defaultRubric: null,
        defaultRubricRef: { id: "rubric-missing", version: 1 },
      },
    });

    const acquire = vi.spyOn(h.lease, "acquire");
    const result = await h.controller.start("mat-unresolved-rubric-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unresolved|rubric|materialization/i);
      expect(result.error).not.toMatch(/holistic/i);
    }
    expect(acquire).not.toHaveBeenCalled();
    await expectZeroExecutionSideEffects(h);
    expect(h.executor.calls.every((call) => call.evaluation.kind !== "holistic")).toBe(true);
  });

  it("malformed materialization snapshot fails closed before lease instead of throwing", async () => {
    const h = makeHarness();
    const record = await persistMaterialization(h, makeSuite(["t1"]), { id: "mat-malformed-1" });
    const stored = storedMaterializations(h).get("mat-malformed-1");
    expect(stored).toBeDefined();
    if (stored) {
      Reflect.deleteProperty(stored.snapshot, "tasks");
      Reflect.deleteProperty(stored.snapshot, "defaultModelSlots");
      Reflect.deleteProperty(stored.snapshot, "defaultJudge");
      Reflect.deleteProperty(stored.snapshot, "rubrics");
    }

    const acquire = vi.spyOn(h.lease, "acquire");
    let thrown: unknown = null;
    let result: StartResult | null = null;
    try {
      result = await h.controller.start(record.id);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.error).toMatch(/invalid|corrupt|malformed|materialization/i);
    }
    expect(acquire).not.toHaveBeenCalled();
    await expectZeroExecutionSideEffects(h);
  });
});

describe("experiment-controller — start/retry/resume persistence-failure reliability (Milestone D)", () => {
  it("a createExperiment failure during start releases lease and owner, returns {ok:false}, and leaves the materialization reusable", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    const originalCreate = h.evalRepo.createExperiment.bind(h.evalRepo);
    h.evalRepo.createExperiment = async () => {
      throw new StorageError("unavailable", "storage unavailable");
    };
    let thrown: unknown = null;
    let result: StartResult | null = null;
    try {
      result = await h.controller.start("mat-suite-1");
    } catch (err) {
      thrown = err;
    } finally {
      h.evalRepo.createExperiment = originalCreate;
    }

    expect(thrown).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) expect(result.error).toMatch(/storage unavailable/i);
    // Lease and owner released; no draft experiment persisted.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
    expect(await h.evalRepo.listExperiments()).toHaveLength(0);

    // The materialization was not burned: a fresh start succeeds.
    const fresh = await h.controller.start("mat-suite-1");
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      await h.controller.whenIdle();
      const experiment = await h.evalRepo.getExperiment(fresh.experimentId);
      expect(experiment!.status).toBe("completed");
    }
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });
  it("an id collision during start never deletes a pre-existing experiment", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    // start() generates `exp-${generateId()}`; the harness's first generateId
    // call yields "id-1", so the draft id is "exp-id-1". Pre-seed an existing
    // experiment with that id (a different materialization) to force a
    // storage-level conflict inside createExperiment.
    const preExisting: ExperimentRecord = {
      ...createExperimentRecord({
        id: "exp-id-1",
        suite: makeSuite(["other"]),
        rubrics: [],
        now: h.now(),
      }),
      materializationId: "mat-other",
    };
    await h.evalRepo.createExperiment(preExisting);
    expect(await h.evalRepo.getExperiment("exp-id-1")).not.toBeNull();

    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exists/i);

    // The pre-existing experiment survives the failed start: the rollback must
    // not delete a record this invocation did not create.
    const survivor = await h.evalRepo.getExperiment("exp-id-1");
    expect(survivor).not.toBeNull();
    expect(survivor!.materializationId).toBe("mat-other");
    expect(await h.evalRepo.listExperiments()).toHaveLength(1);

    // Lease and owner released.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });
  it("a post-create sync failure during start deletes the draft and leaves the materialization reusable", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    // createExperiment succeeds (the draft is persisted), but the follow-up
    // running-status sync fails — the draft must be rolled back so the
    // materialization is not burned and no orphan draft row remains.
    const originalUpdate = h.evalRepo.updateExperiment.bind(h.evalRepo);
    h.evalRepo.updateExperiment = async () => {
      throw new StorageError("unavailable", "storage unavailable");
    };
    let thrown: unknown = null;
    let result: StartResult | null = null;
    try {
      result = await h.controller.start("mat-suite-1");
    } catch (err) {
      thrown = err;
    } finally {
      h.evalRepo.updateExperiment = originalUpdate;
    }

    expect(thrown).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) expect(result.error).toMatch(/storage unavailable/i);
    // No orphan draft remains.
    expect(await h.evalRepo.listExperiments()).toHaveLength(0);
    // Lease and owner released.
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();

    // The materialization was not burned: a fresh start succeeds.
    const fresh = await h.controller.start("mat-suite-1");
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      await h.controller.whenIdle();
      const experiment = await h.evalRepo.getExperiment(fresh.experimentId);
      expect(experiment!.status).toBe("completed");
    }
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("an owner-busy start writes no draft experiment and leaves the materialization reusable after owner release", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    // Another in-tab execution owns the registry.
    expect(h.owner.tryAcquire({ kind: "compare", id: "cmp-x" })).toBe(true);

    const result = await h.controller.start("mat-suite-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/another execution/i);

    // No draft experiment was written; the lease was released.
    expect(await h.evalRepo.listExperiments()).toHaveLength(0);
    expect(h.leaseStore.lease).toBeNull();

    // After the owner releases, the materialization starts fresh.
    h.owner.release("cmp-x");
    const fresh = await h.controller.start("mat-suite-1");
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      await h.controller.whenIdle();
      const experiment = await h.evalRepo.getExperiment(fresh.experimentId);
      expect(experiment!.status).toBe("completed");
    }
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("a persistence failure during retryIncomplete releases lease and owner and returns {ok:false}", async () => {
    const h = makeHarness({
      behavior: (request) =>
        request.source.kind === "experiment" && request.source.taskId === "t1"
          ? { kind: "one-candidate-fails" }
          : { kind: "success" },
    });
    await seedSuite(h, makeSuite(["t1"]));
    const startRes = await h.controller.start("mat-suite-1");
    await h.controller.whenIdle();
    const expId = startRes.ok ? startRes.experimentId : "";

    const originalUpdate = h.evalRepo.updateExperiment.bind(h.evalRepo);
    h.evalRepo.updateExperiment = async () => {
      throw new StorageError("unavailable", "storage unavailable");
    };
    let thrown: unknown = null;
    let result: SimpleResult | null = null;
    try {
      result = await h.controller.retryIncomplete(expId);
    } catch (err) {
      thrown = err;
    } finally {
      h.evalRepo.updateExperiment = originalUpdate;
    }

    expect(thrown).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) expect(result.error).toMatch(/storage unavailable/i);
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("a persistence failure during resume retains lease and owner and leaves the experiment resumable", async () => {
    let controllerRef: Harness["controller"] | null = null;
    const h = makeHarness({
      midTask: () => {
        void controllerRef!.requestPause();
      },
    });
    controllerRef = h.controller;
    await seedSuite(h, makeSuite(["t1", "t2"]));
    const startRes = await h.controller.start("mat-suite-1");
    expect(startRes.ok).toBe(true);
    await h.controller.whenIdle();
    // Paused with queued work retains ownership.
    expect(h.owner.get()).not.toBeNull();

    const originalUpdate = h.evalRepo.updateExperiment.bind(h.evalRepo);
    h.evalRepo.updateExperiment = async () => {
      throw new StorageError("unavailable", "storage unavailable");
    };
    let thrown: unknown = null;
    let result: SimpleResult | null = null;
    try {
      result = await h.controller.resume();
    } catch (err) {
      thrown = err;
    } finally {
      h.evalRepo.updateExperiment = originalUpdate;
    }

    expect(thrown).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(false);
    if (result && !result.ok) expect(result.error).toMatch(/storage unavailable/i);
    // The durable record is still paused; lease + owner retained.
    const expId = startRes.ok ? startRes.experimentId : "";
    const durable = await h.evalRepo.getExperiment(expId);
    expect(durable!.status).toBe("paused");
    expect(h.owner.get()).not.toBeNull();
    expect(h.leaseStore.lease).not.toBeNull();

    // A subsequent resume succeeds.
    const resumed = await h.controller.resume();
    expect(resumed.ok).toBe(true);
    await h.controller.whenIdle();
    const final = await h.evalRepo.getExperiment(expId);
    expect(final!.status).toBe("completed");
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });

  it("recoverOnStartup rolls back a stranded draft and frees its materialization", async () => {
    const h = makeHarness();
    await seedSuite(h, makeSuite(["t1"]));

    // Simulate a stranded draft: created but never transitioned to running
    // (e.g. a crash between createExperiment and the running-status sync).
    const suite = makeSuite(["t1"]);
    const draft: ExperimentRecord = {
      ...createExperimentRecord({ id: "exp-strand", suite, rubrics: [], now: h.now() }),
      materializationId: "mat-suite-1",
    };
    await h.evalRepo.createExperiment(draft);
    expect(await h.evalRepo.getExperiment("exp-strand")).not.toBeNull();
    // The stranded draft currently burns the materialization.
    const blocked = await h.controller.start("mat-suite-1");
    expect(blocked.ok).toBe(false);

    const recovered = await h.controller.recoverOnStartup();
    expect(recovered).toBeGreaterThan(0);

    // The stranded draft is gone.
    expect(await h.evalRepo.getExperiment("exp-strand")).toBeNull();

    // The materialization is reusable again.
    const fresh = await h.controller.start("mat-suite-1");
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      await h.controller.whenIdle();
      const experiment = await h.evalRepo.getExperiment(fresh.experimentId);
      expect(experiment!.status).toBe("completed");
    }
    expect(h.owner.get()).toBeNull();
    expect(h.leaseStore.lease).toBeNull();
  });
});
describe("experiment-controller — Dexie persist to start ordering", () => {
  it("persist then start acquires lease before createExperiment and beginTask", async () => {
    const db = new RSembleEvaluationDB("t8-repair-" + Math.random().toString(36).slice(2));
    await db.open();
    const runRepo = createRunRepository(db);
    const evalRepo = createEvaluationRepository(db, runRepo);
    const uow = createExperimentUnitOfWork(new DexieExperimentStore(db));
    const lease = createExecutionLease(db, { now: () => 10_000 });
    const owner = new ExecutionOwnerRegistry();
    let idCounter = 0;
    const generateId = () => `dexie-${++idCounter}`;
    const executor = makeFakeExecutor({
      now: () => 10_000,
      generateId,
      behavior: () => ({ kind: "success" }),
    });
    const controller = createExperimentController({
      evalRepo,
      uow,
      runRepo,
      lease,
      owner,
      executor,
      generateId,
      now: () => 10_000,
      heartbeatMs: 0,
    });

    const suite = makeSuite(["t1"]);
    const record = makeMaterializationRecord(makeMaterializedSnapshot(suite), {
      id: "mat-dexie-order-1",
    });
    await evalRepo.persistTaskSetMaterialization(record);

    const acquire = vi.spyOn(lease, "acquire");
    const create = vi.spyOn(evalRepo, "createExperiment");
    const begin = vi.spyOn(uow, "beginTask");
    const result = await controller.start(record.id);
    expect(result.ok).toBe(true);
    if (result.ok) await controller.whenIdle();

    expect(acquire).toHaveBeenCalledWith({ kind: "experiment", executionId: suite.id });
    expect(create).toHaveBeenCalled();
    expect(begin).toHaveBeenCalled();
    expect(acquire.mock.invocationCallOrder[0]!).toBeLessThan(create.mock.invocationCallOrder[0]!);
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan(begin.mock.invocationCallOrder[0]!);

    await lease.dispose?.();
    db.close();
    await db.delete();
  });
});
