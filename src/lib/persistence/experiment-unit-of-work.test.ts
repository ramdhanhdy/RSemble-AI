// =============================================================================
// experiment-unit-of-work.ts — failing tests (Task 6.2)
//
// Fence-verified, idempotent, atomic experiment task writes:
//  - beginExperimentTask creates the run and links the attempt in one unit;
//  - commitExperimentTaskTerminal finalizes run + attempt and recomputes
//    selectedAttemptId in one unit;
//  - a lease/fence is verified inside the same unit when supplied;
//  - repeating with identical IDs/payload is a no-op; conflicting reuse of an
//    attempt ID or run ID is rejected;
//  - an injected failure between the run write and the experiment write rolls
//    back both records.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExperimentUnitOfWork,
  DexieExperimentStore,
  InMemoryExperimentStore,
  type ExperimentUnitOfWork,
} from "./experiment-unit-of-work";
import { RSembleEvaluationDB, StorageError } from "./database";
import { LEASE_KEY, FENCE_KEY } from "../execution-lease";
import type { EvaluationSuite, ExperimentRecord } from "../evaluations/evaluation-types";
import type { ExecutionFence, FullRunSummaryV2, RunRecordV2 } from "./run-types";

// --- Fixtures -----------------------------------------------------------------

const FENCE: ExecutionFence = { ownerId: "tab-1", fence: 3 };
const NOW = 10_000;

function makeSuite(id: string): EvaluationSuite {
  return {
    id,
    revision: 0,
    version: 1,
    name: `Suite ${id}`,
    description: "test suite",
    tasks: [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "Do something",
        systemPrompt: "",
        evaluation: { kind: "holistic" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [
      {
        id: "s1",
        providerId: "openrouter",
        provider: "OR",
        model: "m1",
        slug: "m1",
        enabled: true,
      },
      { id: "s2", providerId: "gemini", provider: "GM", model: "m2", slug: "m2", enabled: true },
    ],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeExperiment(id: string, suiteId: string): ExperimentRecord {
  const suite = makeSuite(suiteId);
  return {
    id,
    revision: 0,
    suiteId,
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status: "running",
    execution: FENCE,
    snapshot: {
      suiteId,
      suiteVersion: 1,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    },
    tasks: [{ taskId: "task-1", selectedAttemptId: null, attempts: [] }],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeRun(id: string): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: FENCE,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "e1",
      suiteId: "s1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      taskId: "task-1",
      experimentTaskAttemptId: "att-1",
      trial: 0,
    },
    task: { title: "Task 1", prompt: "Do something", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function makeSummary(id: string): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt: NOW,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "e1",
      suiteId: "s1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      taskId: "task-1",
      experimentTaskAttemptId: "att-1",
      trial: 0,
    },
    taskTitle: "Task 1",
    taskExcerpt: "Do something",
    modelKeys: [],
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "task 1",
  };
}

function beginInput(overrides: Record<string, unknown> = {}) {
  return {
    experimentId: "e1",
    taskId: "task-1",
    attemptId: "att-1",
    run: makeRun("r1"),
    summary: makeSummary("r1"),
    expectedExperimentRevision: 0,
    fence: FENCE,
    ...overrides,
  };
}

function terminalInput(overrides: Record<string, unknown> = {}) {
  const run: RunRecordV2 = {
    ...makeRun("r1"),
    status: "completed",
    completedAt: NOW + 500,
    revision: 0,
  };
  const summary: FullRunSummaryV2 = {
    ...makeSummary("r1"),
    status: "completed",
    completedAt: NOW + 500,
  };
  return {
    experimentId: "e1",
    taskId: "task-1",
    attemptId: "att-1",
    run,
    summary,
    expectedRunRevision: 0,
    expectedExperimentRevision: 1,
    fence: FENCE,
    ...overrides,
  };
}

// =============================================================================
// In-memory store
// =============================================================================

describe("ExperimentUnitOfWork (InMemoryExperimentStore)", () => {
  let store: InMemoryExperimentStore;
  let uow: ExperimentUnitOfWork;

  beforeEach(() => {
    store = new InMemoryExperimentStore();
    store.experiments.set("e1", makeExperiment("e1", "s1"));
    store.lease = { ownerId: FENCE.ownerId, fence: FENCE.fence, expiresAt: NOW + 5000 };
    uow = createExperimentUnitOfWork(store, { now: () => NOW });
  });

  // --- fence verification ---------------------------------------------------

  it("verifies the fence before beginning a task", async () => {
    await expect(
      uow.beginTask(beginInput({ fence: { ownerId: "tab-2", fence: 3 } })),
    ).rejects.toThrow(/lease|fence/i);
    // Nothing was written.
    expect(store.runDetails.size).toBe(0);
    expect(store.experiments.get("e1")!.tasks[0].attempts).toHaveLength(0);
  });

  it("rejects a stale fence token", async () => {
    await expect(
      uow.beginTask(beginInput({ fence: { ownerId: "tab-1", fence: 2 } })),
    ).rejects.toThrow(/lease|fence/i);
  });

  it("rejects an expired lease", async () => {
    store.lease = { ownerId: FENCE.ownerId, fence: FENCE.fence, expiresAt: NOW - 1 };
    await expect(uow.beginTask(beginInput())).rejects.toThrow(/lease|expired/i);
  });

  it("rejects when no lease is held", async () => {
    store.lease = null;
    await expect(uow.beginTask(beginInput())).rejects.toThrow(/lease/i);
  });

  // --- atomic begin -----------------------------------------------------------

  it("begin atomically creates the run and links the attempt before fanout", async () => {
    const result = await uow.beginTask(beginInput());
    expect(result.experimentRevision).toBe(1);

    expect(store.runDetails.get("r1")!.status).toBe("running");
    const summary = store.runSummaries.get("r1")!;
    if (summary.kind !== "full") throw new Error("expected full summary");
    expect(summary.source.kind).toBe("experiment");

    const exp = store.experiments.get("e1")!;
    const attempt = exp.tasks[0].attempts[0];
    expect(attempt.id).toBe("att-1");
    expect(attempt.runId).toBe("r1");
    expect(attempt.status).toBe("running");
  });

  // --- atomic commit ------------------------------------------------------------

  it("commit atomically finalizes the run and attempt and recomputes selectedAttemptId", async () => {
    await uow.beginTask(beginInput());
    const result = await uow.commitTaskTerminal(terminalInput());
    expect(result.runRevision).toBe(1);
    expect(result.experimentRevision).toBe(2);

    expect(store.runDetails.get("r1")!.status).toBe("completed");
    const committed = store.runSummaries.get("r1")!;
    if (committed.kind !== "full") throw new Error("expected full summary");
    expect(committed.status).toBe("completed");

    const exp = store.experiments.get("e1")!;
    expect(exp.tasks[0].attempts[0].status).toBe("completed");
    expect(exp.tasks[0].selectedAttemptId).toBe("att-1");
  });

  // --- rollback -------------------------------------------------------------------

  it("failure after the run write but before the experiment write rolls back both", async () => {
    // Allow runDetail + runSummary writes; fail the experiment write.
    store.failAfterWrites = 2;
    await expect(uow.beginTask(beginInput())).rejects.toThrow();

    // Both records rolled back.
    expect(store.runDetails.size).toBe(0);
    expect(store.runSummaries.size).toBe(0);
    const exp = store.experiments.get("e1")!;
    expect(exp.revision).toBe(0);
    expect(exp.tasks[0].attempts).toHaveLength(0);
  });

  it("failure mid-commit rolls back run and experiment", async () => {
    await uow.beginTask(beginInput());
    store.failAfterWrites = 0; // fail the first commit write
    await expect(uow.commitTaskTerminal(terminalInput())).rejects.toThrow();

    expect(store.runDetails.get("r1")!.status).toBe("running");
    const exp = store.experiments.get("e1")!;
    expect(exp.tasks[0].attempts[0].status).toBe("running");
    expect(exp.revision).toBe(1);
  });

  // --- idempotency ------------------------------------------------------------------

  it("repeating begin with identical IDs and payload is a no-op", async () => {
    const first = await uow.beginTask(beginInput());
    const second = await uow.beginTask(beginInput());
    expect(second).toEqual(first);

    expect(store.runDetails.size).toBe(1);
    const exp = store.experiments.get("e1")!;
    expect(exp.tasks[0].attempts).toHaveLength(1);
    expect(exp.revision).toBe(1);
  });

  it("rejects conflicting attempt-ID reuse (same attempt, different run)", async () => {
    await uow.beginTask(beginInput());
    // Current experiment revision (1) so the conflict — not staleness — is hit.
    await expect(
      uow.beginTask(
        beginInput({
          run: makeRun("r2"),
          summary: makeSummary("r2"),
          expectedExperimentRevision: 1,
        }),
      ),
    ).rejects.toThrow(/conflict|already/i);
  });

  it("rejects conflicting run-ID reuse (same run ID, different payload)", async () => {
    await uow.beginTask(beginInput());
    const different = makeRun("r1");
    different.task = { ...different.task, prompt: "CHANGED" };
    await expect(
      uow.beginTask(
        beginInput({
          attemptId: "att-2",
          run: different,
          summary: makeSummary("r1"),
          expectedExperimentRevision: 1,
        }),
      ),
    ).rejects.toThrow(/conflict|already/i);
  });

  it("repeating commit with identical IDs and payload is a no-op", async () => {
    await uow.beginTask(beginInput());
    const first = await uow.commitTaskTerminal(terminalInput());
    // The controller retries with the exact same input (stale expected revisions).
    const second = await uow.commitTaskTerminal(terminalInput());
    expect(second).toEqual(first);

    const exp = store.experiments.get("e1")!;
    expect(exp.revision).toBe(2);
    expect(store.runDetails.get("r1")!.revision).toBe(1);
  });

  it("rejects conflicting terminal reuse (same attempt, different outcome)", async () => {
    await uow.beginTask(beginInput());
    await uow.commitTaskTerminal(terminalInput());
    const conflicting = terminalInput({
      run: { ...makeRun("r1"), status: "failed", revision: 0 },
      summary: { ...makeSummary("r1"), status: "failed" },
    });
    await expect(uow.commitTaskTerminal(conflicting)).rejects.toThrow(/conflict|terminal|already/i);
  });

  // --- roster-extension provenance --------------------------------------------

  it("copies the exact roster-extension plan to the committed attempt", async () => {
    await uow.beginTask(beginInput());
    const plan = {
      kind: "roster-extension",
      addedModelKey: "gemini:m3",
      baseRunId: "run-base",
    } as const;
    await uow.commitTaskTerminal(terminalInput({ repair: plan }));

    const exp = store.experiments.get("e1")!;
    expect(exp.tasks[0].attempts[0].repair).toEqual({
      kind: "roster-extension",
      addedModelKey: "gemini:m3",
      baseRunId: "run-base",
    });
  });

  it("stays idempotent for an identical roster-extension terminal payload", async () => {
    await uow.beginTask(beginInput());
    const plan = { kind: "roster-extension", addedModelKey: "gemini:m3" } as const;
    const first = await uow.commitTaskTerminal(terminalInput({ repair: plan }));
    const second = await uow.commitTaskTerminal(terminalInput({ repair: plan }));
    expect(second).toEqual(first);
    expect(store.experiments.get("e1")!.revision).toBe(2);
  });

  it("copies a fallback roster-extension plan (no baseRunId)", async () => {
    await uow.beginTask(beginInput());
    await uow.commitTaskTerminal(
      terminalInput({ repair: { kind: "roster-extension", addedModelKey: "gemini:m3" } }),
    );
    const exp = store.experiments.get("e1")!;
    expect(exp.tasks[0].attempts[0].repair).toEqual({
      kind: "roster-extension",
      addedModelKey: "gemini:m3",
    });
  });

  // --- CAS protection -------------------------------------------------------------------

  it("begin rejects a stale experiment revision", async () => {
    await expect(uow.beginTask(beginInput({ expectedExperimentRevision: 99 }))).rejects.toThrow(
      /stale/i,
    );
  });

  it("commit rejects a stale run revision", async () => {
    await uow.beginTask(beginInput());
    await expect(
      uow.commitTaskTerminal(terminalInput({ expectedRunRevision: 99 })),
    ).rejects.toThrow(/stale/i);
  });
});

// =============================================================================
// Dexie-backed store (integration)
// =============================================================================

describe("ExperimentUnitOfWork (DexieExperimentStore)", () => {
  let db: RSembleEvaluationDB;
  let store: DexieExperimentStore;
  let uow: ExperimentUnitOfWork;

  beforeEach(async () => {
    db = new RSembleEvaluationDB(`uow-test-${Math.random()}`);
    await db.open();
    store = new DexieExperimentStore(db);
    uow = createExperimentUnitOfWork(store, { now: () => NOW });
    // Seed the lease rows the fence check reads.
    await db.storageMeta.put({
      key: LEASE_KEY,
      value: { ownerId: FENCE.ownerId, fence: FENCE.fence, expiresAt: NOW + 5000 },
    });
    await db.storageMeta.put({ key: FENCE_KEY, value: { value: FENCE.fence } });
    // Seed the experiment through the raw table.
    const experiment = makeExperiment("e1", "s1");
    await db.experiments.put({
      id: experiment.id,
      experiment,
      revision: experiment.revision,
      suiteId: experiment.suiteId,
      suiteVersion: experiment.suiteVersion,
      protocolFingerprint: experiment.protocolFingerprint,
      createdAt: experiment.createdAt,
      status: experiment.status,
    });
  });

  afterEach(async () => {
    db.close();
    await db.delete();
  });

  it("begin + commit round-trip atomically with fence verification", async () => {
    const begun = await uow.beginTask(beginInput());
    expect(begun.experimentRevision).toBe(1);

    const detail = await db.runDetails.get("r1");
    expect(detail).toBeDefined();
    expect(detail!.status).toBe("running");

    const committed = await uow.commitTaskTerminal(terminalInput());
    expect(committed.runRevision).toBe(1);
    expect(committed.experimentRevision).toBe(2);

    const expRow = await db.experiments.get("e1");
    const task = (expRow!.experiment as ExperimentRecord).tasks[0];
    expect(task.attempts[0].status).toBe("completed");
    expect(task.selectedAttemptId).toBe("att-1");
  });

  it("fence mismatch rejects the write and leaves tables untouched", async () => {
    await expect(
      uow.beginTask(beginInput({ fence: { ownerId: "tab-9", fence: 9 } })),
    ).rejects.toThrow(StorageError);
    expect(await db.runDetails.count()).toBe(0);
  });

  it("idempotent begin repeat succeeds against Dexie", async () => {
    const first = await uow.beginTask(beginInput());
    const second = await uow.beginTask(beginInput());
    expect(second).toEqual(first);
    expect(await db.runDetails.count()).toBe(1);
  });
});
