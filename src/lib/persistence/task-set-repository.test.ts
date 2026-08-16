// =============================================================================
// RSemble AI — Task Set repository contract tests (Dexie + in-memory)
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 3 (RED first).
//
// Shared public contract for createTaskSetRepository (Dexie, schema v5) and
// InMemoryTaskSetRepository: atomic record+v1, contiguous immutable append
// with revision CAS, archive/restore, get/list/query/version history, exact
// manifest materialization, unresolved-member rejection, and deterministic
// pagination. Dexie-only coverage lives below the shared suite.
// =============================================================================

import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelSlot } from "../../studio-data";
import type { EvaluationRubric, EvaluationSuite } from "../evaluations/evaluation-types";
import type {
  JudgeSnapshot,
  TaskSetMember,
  TaskSetRecord,
  TaskSetVersion,
} from "../evaluations/task-set-types";
import type { TaskVersion } from "../tasks/task-types";
import {
  UnresolvedWorkloadRefError,
  type WorkloadCatalogResolvers,
} from "../evaluations/workload-manifest";
import { RSembleEvaluationDB, StorageError } from "./database";
import { InMemoryTaskSetRepository } from "./in-memory-task-set-repository";
import { createTaskSetRepository, type TaskSetRepository } from "./task-set-repository";
import { createEvaluationRepository } from "./evaluation-repository";
import { InMemoryRunRepository } from "./run-repository";

// --- fixtures ----------------------------------------------------------------

const NOW = 1_000;

function makeSlot(
  id: string,
  slug: string,
  providerId: ModelSlot["providerId"] = "openrouter",
  enabled = true,
): ModelSlot {
  return {
    id,
    providerId,
    provider: providerId,
    model: `org/${slug}`,
    slug,
    enabled,
  };
}

function makeJudge(): JudgeSnapshot {
  return { providerId: "openrouter", model: "org/judge" };
}

function makeMember(overrides: Partial<TaskSetMember> = {}): TaskSetMember {
  return {
    id: "mem-1",
    taskVersionRef: { taskId: "task-1", version: 1 },
    order: 0,
    role: "organic",
    stratum: null,
    weight: 1,
    rubricOverrideRef: null,
    executionOverrides: null,
    unresolved: null,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<TaskSetRecord> = {}): TaskSetRecord {
  return {
    id: "set-1",
    latestVersion: 1,
    name: "My Task Set",
    description: "A canonical task set.",
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    revision: 0,
    origin: "authored",
    ...overrides,
  };
}

function makeVersion(overrides: Partial<TaskSetVersion> = {}): TaskSetVersion {
  return {
    taskSetId: "set-1",
    version: 1,
    members: [makeMember()],
    defaultRubricRef: { id: "rubric-1", version: 1 },
    defaultModelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2")],
    defaultJudge: makeJudge(),
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: {},
    createdAt: NOW,
    ...overrides,
  };
}

function makeTaskVersion(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "task-1",
    version: 1,
    title: "Task One Title",
    objective: "Task One Objective",
    candidateInstruction: "Solve problem X using method Y.",
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: NOW,
    ...overrides,
  };
}

function makeRubric(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
  return {
    id: "rubric-1",
    version: 1,
    name: "Standard Rubric",
    description: "Evaluates standard criteria",
    judgeInstruction: "Grade according to the criteria below.",
    criteria: [
      {
        id: "c1",
        kind: "graded",
        name: "Accuracy",
        description: "Factual correctness",
        weight: 1,
        anchors: {
          one: "Inaccurate",
          two: "Mostly inaccurate",
          three: "Partially accurate",
          four: "Mostly accurate",
          five: "Fully accurate",
        },
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeAtomicSuite(overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  return {
    id: "set-1",
    revision: 0,
    version: 1,
    name: "My Task Set",
    description: "A canonical task set.",
    tasks: [
      {
        id: "mem-1",
        title: "Task One",
        prompt: "Solve problem X using method Y.",
        systemPrompt: "",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "",
        order: 0,
        taskVersionRef: { taskId: "task-1", version: 1 },
      } as EvaluationSuite["tasks"][number] & {
        taskVersionRef: { taskId: string; version: number };
      },
    ],
    modelSlots: [makeSlot("s1", "m1"), makeSlot("s2", "m2")],
    defaultJudge: makeJudge(),
    defaultEvaluation: {
      kind: "profile",
      profile: { id: "rubric-1", version: 1 },
    },
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function makeCatalogResolvers(
  tasks: TaskVersion[] = [makeTaskVersion()],
  rubrics: EvaluationRubric[] = [makeRubric()],
  archivedTaskIds: Set<string> = new Set(),
  archivedRubricIds: Set<string> = new Set(),
): WorkloadCatalogResolvers {
  const taskMap = new Map<string, TaskVersion>();
  for (const t of tasks) {
    taskMap.set(`${t.taskId}::v${t.version}`, t);
  }
  const rubricMap = new Map<string, EvaluationRubric>();
  for (const r of rubrics) {
    rubricMap.set(`${r.id}::v${r.version}`, r);
  }
  return {
    getTaskVersion: (ref) => taskMap.get(`${ref.taskId}::v${ref.version}`) ?? null,
    getRubricVersion: (ref) => rubricMap.get(`${ref.id}::v${ref.version}`) ?? null,
    isTaskArchived: (taskId) => archivedTaskIds.has(taskId),
    isRubricArchived: (rubricId) => archivedRubricIds.has(rubricId),
  };
}

async function storageError(
  promise: Promise<unknown>,
): Promise<{ name: string; kind: string; message: string }> {
  try {
    await promise;
  } catch (err) {
    return err as { name: string; kind: string; message: string };
  }
  throw new Error("expected storage rejection");
}

// --- shared contract suite ---------------------------------------------------

export function repositorySuite(name: string, makeRepo: () => TaskSetRepository) {
  describe(name, () => {
    // --- atomic Task Set + v1 creation --------------------------------------

    it("creates Task Set + version 1 atomically and reads them back", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const got = await repo.getTaskSetRecord("set-1");
      expect(got).toMatchObject({ id: "set-1", latestVersion: 1, revision: 0 });
      const v1 = await repo.getTaskSetVersion("set-1", 1);
      expect(v1).toMatchObject({ taskSetId: "set-1", version: 1 });
      expect(v1?.members).toHaveLength(1);
    });

    it("rejects creating a Task Set whose id already exists (no partial overwrite)", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const err = await storageError(
        repo.createTaskSet(makeRecord({ name: "Other" }), makeVersion()),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/already exists/);
      const got = await repo.getTaskSetRecord("set-1");
      expect(got?.revision).toBe(0);
      expect(got?.name).toBe("My Task Set");
      expect(await repo.getTaskSetVersion("set-1", 1)).toMatchObject({ version: 1 });
    });

    it("rejects createTaskSet when record.id !== version.taskSetId", async () => {
      const repo = makeRepo();
      const err = await storageError(
        repo.createTaskSet(makeRecord({ id: "set-1" }), makeVersion({ taskSetId: "set-2" })),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
      expect(err.message).toMatch(/mismatch/);
      expect(await repo.getTaskSetRecord("set-1")).toBeNull();
    });

    it("rejects createTaskSet when version.version !== 1", async () => {
      const repo = makeRepo();
      const err = await storageError(repo.createTaskSet(makeRecord(), makeVersion({ version: 2 })));
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
      expect(err.message).toMatch(/version.*1/i);
    });

    it("rejects createTaskSet when latestVersion !== 1", async () => {
      const repo = makeRepo();
      const err = await storageError(
        repo.createTaskSet(makeRecord({ latestVersion: 2 }), makeVersion()),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
      expect(err.message).toMatch(/latestVersion.*1/i);
    });

    it("rejects createTaskSet with an invalid record (validation)", async () => {
      const repo = makeRepo();
      const err = await storageError(
        repo.createTaskSet({ ...makeRecord(), id: "" }, makeVersion()),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
    });

    it("rejects createTaskSet carrying prohibited credential keys without echoing the value", async () => {
      const repo = makeRepo();
      const bad = { ...makeRecord(), apiKey: "sk-leak" } as unknown as TaskSetRecord;
      const err = await storageError(repo.createTaskSet(bad, makeVersion()));
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
      expect(err.message).toMatch(/prohibited/i);
      expect(err.message).not.toContain("sk-leak");
    });

    it("does not share object identity with caller inputs after create", async () => {
      const repo = makeRepo();
      const record = makeRecord({ name: "Original" });
      const version = makeVersion();
      const member = version.members[0]!;
      await repo.createTaskSet(record, version);
      record.name = "Mutated after create";
      member.weight = 99;
      const got = await repo.getTaskSetRecord("set-1");
      const v1 = await repo.getTaskSetVersion("set-1", 1);
      expect(got?.name).toBe("Original");
      expect(v1?.members[0]?.weight).toBe(1);
      if (got) got.name = "Mutated after get";
      if (v1) v1.members[0]!.weight = 42;
      expect((await repo.getTaskSetRecord("set-1"))?.name).toBe("Original");
      expect((await repo.getTaskSetVersion("set-1", 1))?.members[0]?.weight).toBe(1);
    });

    // --- contiguous append with CAS -----------------------------------------

    it("appends the next contiguous version under revision CAS", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const record = (await repo.getTaskSetRecord("set-1"))!;
      const next = makeVersion({
        version: 2,
        createdAt: 2_000,
        members: [
          makeMember({
            id: "mem-2",
            order: 0,
            taskVersionRef: { taskId: "task-2", version: 1 },
          }),
        ],
      });
      const rev = await repo.appendTaskSetVersion(record, next, record.revision);
      expect(rev).toBe(1);
      const updated = (await repo.getTaskSetRecord("set-1"))!;
      expect(updated.latestVersion).toBe(2);
      expect(updated.revision).toBe(1);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(record.updatedAt);
      const v2 = await repo.getTaskSetVersion("set-1", 2);
      expect(v2?.members[0]?.id).toBe("mem-2");
      expect(await repo.getTaskSetVersion("set-1", 1)).toMatchObject({ version: 1 });
      expect((await repo.getTaskSetVersion("set-1", 1))?.members[0]?.id).toBe("mem-1");
    });

    it("rejects append with a stale revision (CAS conflict, no version written)", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const record = (await repo.getTaskSetRecord("set-1"))!;
      const next = makeVersion({ version: 2, createdAt: 2_000 });
      const err = await storageError(repo.appendTaskSetVersion(record, next, 999));
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/Stale revision: expected 999/);
      expect(await repo.getTaskSetVersion("set-1", 2)).toBeNull();
      expect((await repo.getTaskSetRecord("set-1"))!.latestVersion).toBe(1);
    });

    it("rejects append with a non-contiguous version number", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const record = (await repo.getTaskSetRecord("set-1"))!;
      const err = await storageError(
        repo.appendTaskSetVersion(record, makeVersion({ version: 3 }), record.revision),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/contiguous/i);
      expect(await repo.getTaskSetVersion("set-1", 3)).toBeNull();
      expect((await repo.getTaskSetRecord("set-1"))!.latestVersion).toBe(1);
    });

    it("rejects append when the Task Set is missing", async () => {
      const repo = makeRepo();
      const err = await storageError(
        repo.appendTaskSetVersion(makeRecord(), makeVersion({ version: 2 }), 0),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/not found/);
    });

    it("rejects append when record.id !== version.taskSetId", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const record = (await repo.getTaskSetRecord("set-1"))!;
      const err = await storageError(
        repo.appendTaskSetVersion(
          record,
          makeVersion({ taskSetId: "set-other", version: 2 }),
          record.revision,
        ),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
      expect(err.message).toMatch(/mismatch/);
    });

    // --- archive / restore with CAS -----------------------------------------

    it("archives and restores a Task Set under revision CAS", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const record = (await repo.getTaskSetRecord("set-1"))!;
      const archivedRev = await repo.archiveTaskSet("set-1", record.revision);
      expect(archivedRev).toBe(1);
      const archived = (await repo.getTaskSetRecord("set-1"))!;
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.revision).toBe(1);
      const restoredRev = await repo.restoreTaskSet("set-1", archived.revision);
      expect(restoredRev).toBe(2);
      const restored = (await repo.getTaskSetRecord("set-1"))!;
      expect(restored.archivedAt).toBeNull();
      expect(restored.revision).toBe(2);
    });

    it("rejects archive with a stale revision", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const err = await storageError(repo.archiveTaskSet("set-1", 999));
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/Stale revision: expected 999/);
    });

    it("rejects archive of a missing Task Set", async () => {
      const repo = makeRepo();
      const err = await storageError(repo.archiveTaskSet("nope", 0));
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/not found/);
    });

    it("rejects restore with a stale revision and of a missing Task Set", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const stale = await storageError(repo.restoreTaskSet("set-1", 999));
      expect(stale.kind).toBe("conflict");
      expect(stale.message).toMatch(/Stale revision/);
      const missing = await storageError(repo.restoreTaskSet("missing", 0));
      expect(missing.kind).toBe("conflict");
      expect(missing.message).toMatch(/not found/);
    });

    it("archived Task Sets remain referenceable (versions intact)", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const record = (await repo.getTaskSetRecord("set-1"))!;
      await repo.archiveTaskSet("set-1", record.revision);
      expect(await repo.getTaskSetVersion("set-1", 1)).toMatchObject({ version: 1 });
    });

    // --- list / query / deterministic pagination ----------------------------

    it("lists Task Sets newest-updated first with id tiebreak and default archive exclusion", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(
        makeRecord({ id: "set-a", updatedAt: 1_000, createdAt: 1_000 }),
        makeVersion({ taskSetId: "set-a" }),
      );
      await repo.createTaskSet(
        makeRecord({ id: "set-b", updatedAt: 1_000, createdAt: 1_000 }),
        makeVersion({ taskSetId: "set-b" }),
      );
      await repo.createTaskSet(
        makeRecord({ id: "set-c", updatedAt: 2_000, createdAt: 2_000 }),
        makeVersion({ taskSetId: "set-c" }),
      );
      const recA = (await repo.getTaskSetRecord("set-a"))!;
      await repo.archiveTaskSet("set-a", recA.revision);
      const page1 = await repo.listTaskSets({ limit: 1, offset: 0 });
      expect(page1.map((r) => r.id)).toEqual(["set-c"]);
      const page2 = await repo.listTaskSets({ limit: 1, offset: 1 });
      expect(page2.map((r) => r.id)).toEqual(["set-b"]);
      const active = await repo.listTaskSets({});
      expect(active.map((r) => r.id)).toEqual(["set-c", "set-b"]);
      const all = await repo.listTaskSets({ includeArchived: true });
      expect(all.map((r) => r.id)).toEqual(["set-a", "set-c", "set-b"]);
    });

    it("filters by origin, archiveState, and case-insensitive name/description search", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(
        makeRecord({
          id: "set-alpha",
          name: "Alpha Workload",
          description: "north star",
          origin: "authored",
          updatedAt: 100,
        }),
        makeVersion({ taskSetId: "set-alpha" }),
      );
      await repo.createTaskSet(
        makeRecord({
          id: "set-beta",
          name: "Beta",
          description: "Imported calibration pack",
          origin: "imported",
          updatedAt: 200,
        }),
        makeVersion({ taskSetId: "set-beta" }),
      );
      await repo.createTaskSet(
        makeRecord({
          id: "set-gamma",
          name: "Gamma",
          description: "legacy",
          origin: "legacy-suite",
          updatedAt: 300,
        }),
        makeVersion({ taskSetId: "set-gamma" }),
      );
      const rec = (await repo.getTaskSetRecord("set-gamma"))!;
      await repo.archiveTaskSet("set-gamma", rec.revision);

      expect((await repo.listTaskSets({ origin: "imported" })).map((r) => r.id)).toEqual([
        "set-beta",
      ]);
      expect((await repo.listTaskSets({ search: "ALPHA" })).map((r) => r.id)).toEqual([
        "set-alpha",
      ]);
      expect((await repo.listTaskSets({ search: "calibration" })).map((r) => r.id)).toEqual([
        "set-beta",
      ]);
      expect((await repo.listTaskSets({ search: "   " })).map((r) => r.id)).toEqual([
        "set-beta",
        "set-alpha",
      ]);
      expect((await repo.listTaskSets({ archiveState: "archived" })).map((r) => r.id)).toEqual([
        "set-gamma",
      ]);
      expect((await repo.listTaskSets({ archiveState: "all" })).map((r) => r.id).sort()).toEqual([
        "set-alpha",
        "set-beta",
        "set-gamma",
      ]);
    });

    // --- version history ----------------------------------------------------

    it("lists version history in ascending version order and reads historical versions", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const r1 = (await repo.getTaskSetRecord("set-1"))!;
      await repo.appendTaskSetVersion(
        r1,
        makeVersion({
          version: 2,
          createdAt: 2_000,
          members: [makeMember({ id: "mem-v2", order: 0 })],
        }),
        r1.revision,
      );
      const history = await repo.listTaskSetVersions("set-1");
      expect(history.map((v) => v.version)).toEqual([1, 2]);
      expect(history[0]?.members[0]?.id).toBe("mem-1");
      expect(history[1]?.members[0]?.id).toBe("mem-v2");
      expect(await repo.getTaskSetVersion("set-1", 1)).toMatchObject({ version: 1 });
      expect(await repo.listTaskSetVersions("missing")).toEqual([]);
      expect(await repo.getTaskSetVersion("set-1", 99)).toBeNull();
    });

    // --- exact materialization ----------------------------------------------

    it("materializes an exact frozen snapshot in deterministic member order", async () => {
      const repo = makeRepo();
      const taskA = makeTaskVersion({
        taskId: "task-A",
        version: 2,
        title: "Task A v2",
      });
      const taskB = makeTaskVersion({
        taskId: "task-B",
        version: 1,
        title: "Task B v1",
      });
      const rubric = makeRubric({ id: "rubric-1", version: 1 });
      await repo.createTaskSet(
        makeRecord(),
        makeVersion({
          members: [
            makeMember({
              id: "m-late",
              order: 2,
              taskVersionRef: { taskId: "task-B", version: 1 },
            }),
            makeMember({
              id: "m-first",
              order: 0,
              taskVersionRef: { taskId: "task-A", version: 2 },
            }),
          ],
        }),
      );
      const before = (await repo.getTaskSetRecord("set-1"))!;
      const snapshot = await repo.materializeTaskSetVersion(
        "set-1",
        1,
        makeCatalogResolvers([taskA, taskB], [rubric]),
        { now: 5_000 },
      );
      expect(snapshot.taskSetId).toBe("set-1");
      expect(snapshot.taskSetVersion).toBe(1);
      expect(snapshot.createdAt).toBe(5_000);
      expect(snapshot.tasks.map((t) => t.memberId)).toEqual(["m-first", "m-late"]);
      expect(snapshot.tasks.map((t) => t.order)).toEqual([0, 2]);
      expect(snapshot.tasks[0]?.task.title).toBe("Task A v2");
      expect(snapshot.tasks[1]?.task.title).toBe("Task B v1");
      expect(snapshot.protocolFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
      taskA.title = "mutated catalog title";
      expect(snapshot.tasks[0]?.task.title).toBe("Task A v2");
      const after = (await repo.getTaskSetRecord("set-1"))!;
      expect(after).toEqual(before);
    });

    it("rejects materialize of an unresolved member without substituting latest Task", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(
        makeRecord(),
        makeVersion({
          members: [
            makeMember({
              unresolved: "legacy task t-x could not map to a canonical Task Version",
            }),
          ],
        }),
      );
      const latestOnly = makeCatalogResolvers(
        [makeTaskVersion({ taskId: "task-1", version: 2, title: "Latest only" })],
        [makeRubric()],
      );
      await expect(repo.materializeTaskSetVersion("set-1", 1, latestOnly)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof UnresolvedWorkloadRefError ||
          (err instanceof StorageError && /unresolved/i.test(err.message)),
      );
      expect((await repo.getTaskSetRecord("set-1"))?.latestVersion).toBe(1);
    });

    it("rejects materialize when a member Task Version is missing from the catalog", async () => {
      const repo = makeRepo();
      await repo.createTaskSet(makeRecord(), makeVersion());
      const catalogHasOnlyV2 = makeCatalogResolvers(
        [makeTaskVersion({ taskId: "task-1", version: 2 })],
        [makeRubric()],
      );
      await expect(repo.materializeTaskSetVersion("set-1", 1, catalogHasOnlyV2)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof UnresolvedWorkloadRefError ||
          (err instanceof StorageError && /unresolved/i.test(err.message)),
      );
    });

    it("rejects materialize when the stored version is missing", async () => {
      const repo = makeRepo();
      const err = await storageError(
        repo.materializeTaskSetVersion("set-1", 1, makeCatalogResolvers()),
      );
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
      expect(err.message).toMatch(/not found/);
    });
  });
}

repositorySuite("InMemoryTaskSetRepository", () => new InMemoryTaskSetRepository());

// --- Dexie suite with clean + legacy open/upgrade coverage -------------------

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    try {
      db.close();
    } catch {
      // best-effort
    }
    try {
      await db.delete();
    } catch {
      // best-effort
    }
  }
});

repositorySuite("Dexie task set repository", () => {
  const db = new RSembleEvaluationDB(`task-set-test-${crypto.randomUUID()}`);
  dbs.push(db);
  return createTaskSetRepository(db);
});

describe("Dexie atomic Suite + Task Set save seam", () => {
  it("commits the compatibility Suite and canonical N+1 together", async () => {
    const db = new RSembleEvaluationDB(`task-set-atomic-success-${crypto.randomUUID()}`);
    await db.open();
    dbs.push(db);
    const taskSetRepo = createTaskSetRepository(db);
    const evalRepo = createEvaluationRepository(db, new InMemoryRunRepository());
    await taskSetRepo.createTaskSet(makeRecord(), makeVersion());
    const initialSuite = makeAtomicSuite();
    await db.suites.put({
      id: initialSuite.id,
      suite: initialSuite,
      revision: initialSuite.revision,
      version: initialSuite.version,
      updatedAt: initialSuite.updatedAt,
      archivedAt: initialSuite.archivedAt,
    });
    const candidate = makeAtomicSuite({ version: 2, name: "Version Two" });
    const nextVersion = makeVersion({ version: 2, createdAt: 2_000 });

    const result = await evalRepo.saveSuiteAndTaskSetVersion({
      suite: candidate,
      expectedSuiteRevision: 0,
      taskSetRecord: makeRecord({ name: "Version Two" }),
      taskSetVersion: nextVersion,
      expectedTaskSetRevision: 0,
      taskSetRepository: taskSetRepo,
    });

    expect(result).toEqual({ suiteRevision: 1, taskSetRevision: 1 });
    expect(await evalRepo.getSuite("set-1")).toMatchObject({
      name: "Version Two",
      version: 2,
      revision: 1,
    });
    expect(await taskSetRepo.getTaskSetRecord("set-1")).toMatchObject({
      name: "Version Two",
      latestVersion: 2,
      revision: 1,
    });
    expect(await taskSetRepo.getTaskSetVersion("set-1", 2)).toMatchObject({ version: 2 });
  });

  it("rolls canonical staging back when the final Suite write fails", async () => {
    const db = new RSembleEvaluationDB(`task-set-atomic-rollback-${crypto.randomUUID()}`);
    await db.open();
    dbs.push(db);
    const taskSetRepo = createTaskSetRepository(db);
    const evalRepo = createEvaluationRepository(db, new InMemoryRunRepository());
    await taskSetRepo.createTaskSet(makeRecord(), makeVersion());
    const initialSuite = makeAtomicSuite();
    await db.suites.put({
      id: initialSuite.id,
      suite: initialSuite,
      revision: initialSuite.revision,
      version: initialSuite.version,
      updatedAt: initialSuite.updatedAt,
      archivedAt: initialSuite.archivedAt,
    });
    vi.spyOn(db.suites, "put").mockRejectedValueOnce(
      new DOMException("Suite compatibility quota failure", "QuotaExceededError"),
    );

    await expect(
      evalRepo.saveSuiteAndTaskSetVersion({
        suite: makeAtomicSuite({ version: 2, name: "Must Roll Back" }),
        expectedSuiteRevision: 0,
        taskSetRecord: makeRecord({ name: "Must Roll Back" }),
        taskSetVersion: makeVersion({ version: 2, createdAt: 2_000 }),
        expectedTaskSetRevision: 0,
        taskSetRepository: taskSetRepo,
      }),
    ).rejects.toMatchObject({ kind: "quota" });

    expect(await evalRepo.getSuite("set-1")).toEqual(initialSuite);
    expect(await taskSetRepo.getTaskSetRecord("set-1")).toMatchObject({
      name: "My Task Set",
      latestVersion: 1,
      revision: 0,
    });
    expect(await taskSetRepo.getTaskSetVersion("set-1", 2)).toBeNull();
  });

  it("persists append-only materialization rows with exact identity and snapshot", async () => {
    const db = new RSembleEvaluationDB(`task-set-materialization-${crypto.randomUUID()}`);
    await db.open();
    dbs.push(db);
    const taskSetRepo = createTaskSetRepository(db);
    const evalRepo = createEvaluationRepository(db, new InMemoryRunRepository());
    await taskSetRepo.createTaskSet(makeRecord(), makeVersion());
    const snapshot = await taskSetRepo.materializeTaskSetVersion(
      "set-1",
      1,
      makeCatalogResolvers(),
    );
    const first = {
      id: "mat-1",
      taskSetId: snapshot.taskSetId,
      taskSetVersion: snapshot.taskSetVersion,
      protocolFingerprint: snapshot.protocolFingerprint,
      snapshot,
      createdAt: 1_000,
    };
    await evalRepo.persistTaskSetMaterialization(first);
    await evalRepo.persistTaskSetMaterialization({ ...first, id: "mat-2", createdAt: 2_000 });

    await expect(evalRepo.persistTaskSetMaterialization(first)).rejects.toMatchObject({
      kind: "conflict",
    });
    const rows = await evalRepo.listTaskSetMaterializations("set-1");
    expect(rows.map((row) => row.id)).toEqual(["mat-1", "mat-2"]);
    expect(rows[0]).toEqual(first);
    expect(rows[1]?.snapshot.protocolFingerprint).toBe(snapshot.protocolFingerprint);
  });
});

// --- clean + legacy database open/upgrade coverage (Dexie-only) --------------

describe("Dexie task set repository schema upgrade", () => {
  it("opens a fresh database with additive v8 evidence tables and every prior table", async () => {
    const db = new RSembleEvaluationDB(`task-set-clean-${crypto.randomUUID()}`);
    dbs.push(db);
    await db.open();
    expect(db.tables.some((t) => t.name === "taskSets")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskSetVersions")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskSetMaterializations")).toBe(true);
    expect(db.tables.some((t) => t.name === "suites")).toBe(true);
    expect(db.tables.some((t) => t.name === "runSummaries")).toBe(true);
    expect(db.tables.some((t) => t.name === "fusionRecipes")).toBe(true);
    expect(db.tables.some((t) => t.name === "tasks")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskFamilyRelations")).toBe(true);
    expect(db.tables.some((t) => t.name === "modelConfigurations")).toBe(true);
    expect(db.tables.some((t) => t.name === "observations")).toBe(true);
    expect(db.tables.some((t) => t.name === "evidenceDecisions")).toBe(true);
    expect(db.tables.some((t) => t.name === "evidenceIndexJobs")).toBe(true);
    expect(db.verno).toBe(9);
  });

  it("upgrades a v4-seeded database through v9 additively without losing prior rows", async () => {
    const dbName = `task-set-v4-legacy-${crypto.randomUUID()}`;
    const v4 = new Dexie(dbName);
    v4.version(1).stores({
      runSummaries: "id",
      runDetails: "id",
      profiles: "id",
      profileVersions: "[id+version]",
      suites: "id",
      experiments: "id",
      storageMeta: "key",
    });
    v4.version(2).stores({
      fusionRecipes: "[id+version]",
      poolManifests: "[id+version]",
      fusionStudies: "id",
      fusionTrials: "id",
      fusionAttempts: "id",
      fusionObservations: "id",
      fusionPlaybooks: "id",
    });
    v4.version(3).stores({
      tasks: "id, updatedAt, archivedAt, origin",
      taskVersions: "[taskId+version], taskId, createdAt",
      taskArtifacts: "id, contentDigest, mediaType, byteCount, createdAt",
      taskArtifactBytes: "id",
      taskInstances: "id, [taskId+taskVersion], inputDigest, inputCompleteness, createdAt",
      taskFamilies: "id, parentFamilyId, updatedAt, archivedAt",
      taskFamilyAssignments: "id, taskId, taskVersion, familyId, isPrimary, createdAt, archivedAt",
      taskFacetAnnotations: "id, taskId, [taskId+taskVersion], facetId, valueId, createdAt",
      taskMigrationCrosswalk: "legacyScopeKey, taskId, taskVersion",
    });
    v4.version(4).stores({
      taskFamilyRelations: "id, fromFamilyId, toFamilyId, kind, createdAt",
    });
    await v4.open();
    await v4.table("suites").put({
      id: "suite-legacy",
      suite: { id: "suite-legacy", version: 1, tasks: [] },
      revision: 1,
      version: 1,
      updatedAt: 1,
      archivedAt: null,
    });
    await v4.table("runSummaries").put({
      id: "run-legacy",
      kind: "full",
      summary: { id: "run-legacy" },
      revision: 0,
      createdAt: 1,
      completedAt: null,
      status: "completed",
      mode: "compare",
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: ["m1"],
    });
    await v4.table("fusionStudies").put({
      id: "study-legacy",
      study: { id: "study-legacy" },
      revision: 0,
      suiteId: "suite-legacy",
      suiteVersion: 1,
      status: "draft",
      updatedAt: 1,
    });
    await v4.table("taskFamilies").put({
      id: "fam-legacy",
      family: { id: "fam-legacy", name: "Legacy" },
      parentFamilyId: null,
      updatedAt: 1,
      archivedAt: null,
      revision: 0,
    });
    v4.close();

    const db = new RSembleEvaluationDB(dbName);
    dbs.push(db);
    await db.open();
    expect((await db.suites.get("suite-legacy"))?.id).toBe("suite-legacy");
    expect((await db.runSummaries.get("run-legacy"))?.id).toBe("run-legacy");
    expect((await db.fusionStudies.get("study-legacy"))?.id).toBe("study-legacy");
    expect((await db.taskFamilies.get("fam-legacy"))?.id).toBe("fam-legacy");
    expect(db.tables.some((t) => t.name === "taskSets")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskSetVersions")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskSetMaterializations")).toBe(true);
    expect(db.tables.some((t) => t.name === "modelConfigurations")).toBe(true);
    expect(db.tables.some((t) => t.name === "observations")).toBe(true);
    expect(db.tables.some((t) => t.name === "evidenceDecisions")).toBe(true);
    expect(db.tables.some((t) => t.name === "evidenceIndexJobs")).toBe(true);
    expect(db.tables.some((t) => t.name === "suites")).toBe(true);
    expect(db.verno).toBe(9);
  });

  it("does not write Task Set rows into the legacy Suite table", async () => {
    const db = new RSembleEvaluationDB(`task-set-suite-${crypto.randomUUID()}`);
    dbs.push(db);
    const repo = createTaskSetRepository(db);
    await db.suites.put({
      id: "suite-keep",
      suite: { id: "suite-keep", version: 1, tasks: [] },
      revision: 3,
      version: 4,
      updatedAt: 9,
      archivedAt: null,
    });
    await repo.createTaskSet(makeRecord(), makeVersion());
    const suite = await db.suites.get("suite-keep");
    expect(suite).toMatchObject({ id: "suite-keep", revision: 3, version: 4 });
    expect(await db.suites.get("set-1")).toBeUndefined();
    expect((await db.taskSets.get("set-1"))?.id).toBe("set-1");
  });
});
