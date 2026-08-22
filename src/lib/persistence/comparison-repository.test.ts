// =============================================================================
// RSemble AI — Comparison Result repository contract tests (spec §11)
//
// Child 05 (Contextual Compare Results) Milestone A — Task 2.
//
// Specifies the read-model repository contract before implementation exists:
//
//  - listComparisonResults filters the COMPLETE result set before pagination
//    (spec §11), including the model join over the source run summaries;
//  - getComparisonResult returns the summary-only index plus the exact source
//    record; source/index revision drift yields a repairable warning — never
//    a fabricated merged state; a missing exact run is an explicit state;
//  - createComparisonEnvelope derives the index from the source record
//    (comparisonId == runId) and never copies candidate outputs or judge
//    rationale — RunRecordV2 remains the exact result authority;
//  - bindComparisonToTask / recordComparisonLineage update atomically with
//    revision CAS (stale revisions abort before any write);
//  - rebuildComparisonIndex is idempotent: re-running produces no duplicate
//    indexes and refreshes derived summary fields only;
//  - storage failures surface as classified StorageError.
//
// Both the Dexie-backed repository and the in-memory parity implementation
// run the same contract.
// =============================================================================

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RSembleEvaluationDB, StorageError } from "./database";
import { InMemoryRunRepository, createRunRepository, type RunRepository } from "./run-repository";
import type { FullRunSummaryV2, RunRecordV2, RunStatus } from "./run-types";
import {
  createComparisonRepository,
  type ComparisonListQuery,
  type ComparisonRepository,
} from "./comparison-repository";
import type { ComparisonTaskBinding } from "../compare/comparison-result-types";
import { InMemoryComparisonRepository } from "./in-memory-comparison-repository";

// ---------------------------------------------------------------------------
// Valid baselines (mirrors run-repository.test.ts so records pass validators)
// ---------------------------------------------------------------------------

const SNAPSHOT_REF = `snap:sha256:${"a".repeat(64)}`;

function makeRunRecord(id: string, overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1,
    updatedAt: 2,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Task " + id, prompt: "p", systemPrompt: "s", temperature: 0 },
    evaluation: {
      profile: null,
      candidateMessages: [{ role: "user", content: "hi" }],
    },
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
    ...overrides,
  };
}

function makeFullSummary(
  id: string,
  createdAt: number,
  overrides: Partial<FullRunSummaryV2> = {},
): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: "Task " + id,
    taskExcerpt: "excerpt-" + id,
    modelKeys: ["openrouter:foo"],
    winnerKeys: ["openrouter:foo"],
    scoresByModelKey: { "openrouter:foo": 5 },
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "excerpt-" + id,
    ...overrides,
  };
}

function adHocBinding(ref = SNAPSHOT_REF): ComparisonTaskBinding {
  return { kind: "ad_hoc", inputSnapshotRef: ref };
}

interface SeedSourceOptions {
  status?: RunStatus;
  mode?: "rank" | "fuse";
  modelKeys?: string[];
  title?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** Persist a source run (record + summary atomically) into the run repository. */
async function seedSourceRun(
  runs: RunRepository,
  id: string,
  options: SeedSourceOptions = {},
): Promise<{ record: RunRecordV2; summary: FullRunSummaryV2 }> {
  const createdAt = options.createdAt ?? 1000;
  const updatedAt = options.updatedAt ?? createdAt + 1;
  const status = options.status ?? "running";
  const mode = options.mode ?? "rank";
  const title = options.title ?? `Task ${id}`;
  const record = makeRunRecord(id, { status, mode, createdAt, updatedAt });
  record.task = { ...record.task, title };
  const summaryOverrides: Partial<FullRunSummaryV2> = {
    status,
    mode,
    taskTitle: title,
  };
  if (options.modelKeys) summaryOverrides.modelKeys = options.modelKeys;
  const summary = makeFullSummary(id, createdAt, summaryOverrides);
  await runs.create(record, summary);
  return { record, summary };
}

// --- harness -----------------------------------------------------------------

interface ComparisonHarness {
  repo: ComparisonRepository;
  runs: RunRepository;
  close?: () => Promise<void>;
  simulateUnavailable?: () => void;
}

type ComparisonFactory = () => Promise<ComparisonHarness>;

const dexieFactory: ComparisonFactory = async () => {
  const db = new RSembleEvaluationDB(`comparison-repo-test-${Math.random().toString(36).slice(2)}`);
  await db.open();
  const runs = createRunRepository(db);
  return {
    repo: createComparisonRepository(db, runs, { now: () => 5000 }),
    runs,
    close: async () => db.close(),
    simulateUnavailable: () => db.setState("unavailable"),
  };
};

const memoryFactory: ComparisonFactory = async () => {
  const runs = new InMemoryRunRepository();
  return { repo: new InMemoryComparisonRepository(runs, { now: () => 5000 }), runs };
};

// --- contract suite ----------------------------------------------------------

function runContract(name: string, makeHarness: ComparisonFactory) {
  describe(`ComparisonRepository contract (${name})`, () => {
    let harness: ComparisonHarness;
    beforeEach(async () => {
      harness = await makeHarness();
    });

    describe("createComparisonEnvelope", () => {
      it("derives the index from the source record with comparisonId == runId", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", {
          status: "running",
          title: "Baseline rubric check",
          createdAt: 100,
          updatedAt: 150,
        });
        const index = await repo.createComparisonEnvelope(record, adHocBinding(), {
          activeObservationIds: ["obs:one"],
          evidenceReceiptRevision: 2,
          repeatedFrom: "run-0",
        });
        expect(index.id).toBe("run-1");
        expect(index.runId).toBe("run-1");
        expect(index.status).toBe("running");
        expect(index.mode).toBe("rank");
        expect(index.title).toBe("Baseline rubric check");
        expect(index.createdAt).toBe(100);
        expect(index.updatedAt).toBe(150);
        expect(index.revision).toBe(0);
        expect(index.taskBinding).toEqual(adHocBinding());
        expect(index.taskInstanceId).toBeNull();
        expect(index.activeObservationIds).toEqual(["obs:one"]);
        expect(index.evidenceReceiptRevision).toBe(2);
        expect(index.lineage).toEqual({ repeatedFrom: "run-0" });

        const envelope = await repo.getComparisonResult("run-1");
        expect(envelope).not.toBeNull();
        expect(envelope?.record?.id).toBe("run-1");
        expect(envelope?.warning).toBeNull();
        expect(envelope?.index).toEqual(index);
      });

      it("rejects a duplicate comparison id without overwriting the original", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", { createdAt: 100 });
        await repo.createComparisonEnvelope(record, adHocBinding());
        await expect(
          repo.createComparisonEnvelope(record, {
            kind: "canonical",
            taskId: "task-1",
            taskVersion: 1,
          }),
        ).rejects.toMatchObject({ kind: "conflict" });
        const envelope = await repo.getComparisonResult("run-1");
        expect(envelope?.index.taskBinding).toEqual(adHocBinding());
      });

      it("rejects an invalid task binding", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        await expect(
          repo.createComparisonEnvelope(record, {
            kind: "fancy",
            inputSnapshotRef: "x",
          } as unknown as ComparisonTaskBinding),
        ).rejects.toMatchObject({ kind: "validation" });
      });

      it("rejects an ad-hoc envelope carrying a task instance id", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        await expect(
          repo.createComparisonEnvelope(record, adHocBinding(), {
            taskInstanceId: "task-inst-1",
          }),
        ).rejects.toMatchObject({ kind: "validation" });
      });

      it("rejects an invalid source record", async () => {
        const { repo } = harness;
        const record = makeRunRecord("run-1");
        record.id = "";
        await expect(repo.createComparisonEnvelope(record, adHocBinding())).rejects.toMatchObject({
          kind: "validation",
        });
      });
    });

    describe("getComparisonResult", () => {
      it("returns null for an unknown comparison id", async () => {
        const { repo } = harness;
        expect(await repo.getComparisonResult("nope")).toBeNull();
      });

      it("reports a missing exact run as an explicit warning state", async () => {
        const { repo } = harness;
        // The envelope is created from a valid record that was never persisted
        // into the run repository (import/corruption scenario).
        const record = makeRunRecord("run-orphan", { createdAt: 100, updatedAt: 101 });
        await repo.createComparisonEnvelope(record, adHocBinding());
        const envelope = await repo.getComparisonResult("run-orphan");
        expect(envelope).not.toBeNull();
        expect(envelope?.record).toBeNull();
        expect(envelope?.warning?.kind).toBe("missing_source_record");
      });

      it("warns on source/index drift instead of fabricating a merged state", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", {
          createdAt: 100,
          updatedAt: 101,
        });
        await repo.createComparisonEnvelope(record, adHocBinding());
        await runs.update(
          makeRunRecord("run-1", { status: "completed", revision: 0, updatedAt: 200 }),
          makeFullSummary("run-1", 100, { status: "completed" }),
          0,
        );
        const envelope = await repo.getComparisonResult("run-1");
        const warning = envelope?.warning;
        expect(warning?.kind).toBe("source_index_revision_mismatch");
        if (warning?.kind !== "source_index_revision_mismatch") return;
        expect(warning.repair).toBe("rebuildComparisonIndex");
        expect(warning.source.status).toBe("completed");
        expect(warning.index.status).toBe("running");
        // The envelope is honest: the stale index and the exact record are
        // returned as-is; no merged summary is invented.
        expect(envelope?.index.status).toBe("running");
        expect(envelope?.record?.status).toBe("completed");
      });

      it("does not warn after a binding update (index mutation is not drift)", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", {
          createdAt: 100,
          updatedAt: 101,
        });
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        await repo.bindComparisonToTask(
          "run-1",
          { kind: "canonical", taskId: "task-1", taskVersion: 1 },
          "task-inst-1",
          created.revision,
        );
        const envelope = await repo.getComparisonResult("run-1");
        expect(envelope?.warning).toBeNull();
      });
    });

    describe("listComparisonResults", () => {
      async function seedListSet() {
        const { repo, runs } = harness;
        const specs: Array<{
          id: string;
          createdAt: number;
          title: string;
          status?: RunStatus;
          mode?: "rank" | "fuse";
          modelKeys?: string[];
          binding?: ComparisonTaskBinding;
        }> = [
          { id: "run-a", createdAt: 100, title: "Alpha protocol" },
          {
            id: "run-b",
            createdAt: 200,
            title: "Special two",
            status: "completed",
            mode: "fuse",
            modelKeys: ["openrouter:model-b"],
          },
          { id: "run-c", createdAt: 300, title: "Gamma protocol", status: "completed" },
          {
            id: "run-d",
            createdAt: 400,
            title: "Special four",
            modelKeys: ["openrouter:model-a", "openrouter:model-b"],
            binding: { kind: "canonical", taskId: "task-2", taskVersion: 2 },
          },
          {
            id: "run-e",
            createdAt: 500,
            title: "Special five",
            binding: { kind: "canonical", taskId: "task-1", taskVersion: 1 },
          },
        ];
        for (const spec of specs) {
          const { record } = await seedSourceRun(runs, spec.id, {
            createdAt: spec.createdAt,
            updatedAt: spec.createdAt + 1,
            title: spec.title,
            status: spec.status,
            mode: spec.mode,
            modelKeys: spec.modelKeys,
          });
          await repo.createComparisonEnvelope(record, spec.binding ?? adHocBinding());
        }
        return specs;
      }

      it("orders results newest first", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({});
        expect(rows.map((r) => r.id)).toEqual(["run-e", "run-d", "run-c", "run-b", "run-a"]);
      });

      it("filters by case-insensitive title substring", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({ text: "SPECIAL" });
        expect(rows.map((r) => r.id)).toEqual(["run-e", "run-d", "run-b"]);
      });

      it("filters by status", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({ status: "completed" });
        expect(rows.map((r) => r.id)).toEqual(["run-c", "run-b"]);
      });

      it("filters by mode", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({ mode: "fuse" });
        expect(rows.map((r) => r.id)).toEqual(["run-b"]);
      });

      it("filters by task binding kind", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({ bindingKind: "canonical" });
        expect(rows.map((r) => r.id)).toEqual(["run-e", "run-d"]);
      });

      it("filters by canonical task id and excludes ad hoc rows", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({ taskId: "task-2" });
        expect(rows.map((r) => r.id)).toEqual(["run-d"]);
      });

      it("filters by model key through the source run summaries", async () => {
        const { repo } = harness;
        await seedListSet();
        const rows = await repo.listComparisonResults({ modelKey: "openrouter:model-b" });
        expect(rows.map((r) => r.id)).toEqual(["run-d", "run-b"]);
      });

      it("filters by created-from/created-to bounds", async () => {
        const { repo } = harness;
        await seedListSet();
        const upper: ComparisonListQuery = { createdTo: 150 };
        const lower: ComparisonListQuery = { createdFrom: 350 };
        expect((await repo.listComparisonResults(upper)).map((r) => r.id)).toEqual(["run-a"]);
        expect((await repo.listComparisonResults(lower)).map((r) => r.id)).toEqual([
          "run-e",
          "run-d",
        ]);
      });

      it("applies every filter to the complete set before pagination", async () => {
        const { repo } = harness;
        await seedListSet();
        // "Special" matches run-e (500), run-d (400), run-b (200). A paginate-
        // then-filter implementation would slice the newest row (run-e default
        // title) away and return nothing.
        const page0 = await repo.listComparisonResults({ text: "special", limit: 2, offset: 0 });
        expect(page0.map((r) => r.id)).toEqual(["run-e", "run-d"]);
        const page1 = await repo.listComparisonResults({ text: "special", limit: 2, offset: 2 });
        expect(page1.map((r) => r.id)).toEqual(["run-b"]);
      });

      it("returns an empty list when nothing matches", async () => {
        const { repo } = harness;
        await seedListSet();
        expect(await repo.listComparisonResults({ text: "no such title" })).toEqual([]);
      });
    });

    describe("bindComparisonToTask (CAS)", () => {
      it("atomically binds a canonical task version with its instance", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", { createdAt: 100 });
        const created = await repo.createComparisonEnvelope(record, adHocBinding(), {
          activeObservationIds: ["obs:one"],
        });
        const bound = await repo.bindComparisonToTask(
          "run-1",
          { kind: "canonical", taskId: "task-42", taskVersion: 3 },
          "task-inst-7",
          created.revision,
        );
        expect(bound.taskBinding).toEqual({ kind: "canonical", taskId: "task-42", taskVersion: 3 });
        expect(bound.taskInstanceId).toBe("task-inst-7");
        expect(bound.revision).toBe(created.revision + 1);
        expect(bound.updatedAt).toBe(5000);
        // Everything else is preserved exactly.
        expect(bound.status).toBe(created.status);
        expect(bound.mode).toBe(created.mode);
        expect(bound.title).toBe(created.title);
        expect(bound.activeObservationIds).toEqual(["obs:one"]);
        expect(bound.lineage).toEqual(created.lineage);
        expect(bound.createdAt).toBe(created.createdAt);
      });

      it("aborts a stale expected revision without writing", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        await repo.bindComparisonToTask(
          "run-1",
          { kind: "canonical", taskId: "task-1", taskVersion: 1 },
          null,
          created.revision,
        );
        await expect(
          repo.bindComparisonToTask(
            "run-1",
            { kind: "canonical", taskId: "task-2", taskVersion: 1 },
            null,
            created.revision,
          ),
        ).rejects.toMatchObject({ kind: "conflict" });
        const envelope = await repo.getComparisonResult("run-1");
        expect(envelope?.index.taskBinding).toEqual({
          kind: "canonical",
          taskId: "task-1",
          taskVersion: 1,
        });
      });

      it("rejects a missing comparison id", async () => {
        const { repo } = harness;
        await expect(
          repo.bindComparisonToTask(
            "nope",
            { kind: "canonical", taskId: "task-1", taskVersion: 1 },
            null,
            0,
          ),
        ).rejects.toMatchObject({ kind: "conflict" });
      });

      it("clears the task instance when binding back to ad hoc", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        const bound = await repo.bindComparisonToTask(
          "run-1",
          { kind: "canonical", taskId: "task-1", taskVersion: 1 },
          "task-inst-1",
          created.revision,
        );
        const adHoc = await repo.bindComparisonToTask(
          "run-1",
          adHocBinding(),
          null,
          bound.revision,
        );
        expect(adHoc.taskBinding.kind).toBe("ad_hoc");
        expect(adHoc.taskInstanceId).toBeNull();
      });

      it("rejects an ad-hoc bind that carries a task instance id", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        await expect(
          repo.bindComparisonToTask("run-1", adHocBinding(), "task-inst-1", created.revision),
        ).rejects.toMatchObject({ kind: "validation" });
      });
    });

    describe("recordComparisonLineage (CAS)", () => {
      it("records a repeatedFrom link and bumps the index revision", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        const updated = await repo.recordComparisonLineage(
          "run-1",
          { repeatedFrom: "run-0" },
          created.revision,
        );
        expect(updated.lineage).toEqual({ repeatedFrom: "run-0" });
        expect(updated.revision).toBe(created.revision + 1);
        expect(updated.status).toBe(created.status);
      });

      it("aborts a stale expected revision without writing", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        await repo.recordComparisonLineage("run-1", { repeatedFrom: "run-0" }, created.revision);
        await expect(
          repo.recordComparisonLineage("run-1", { repeatedFrom: "run-x" }, created.revision),
        ).rejects.toMatchObject({ kind: "conflict" });
        const envelope = await repo.getComparisonResult("run-1");
        expect(envelope?.index.lineage).toEqual({ repeatedFrom: "run-0" });
      });

      it("rejects a self-referencing lineage", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        const created = await repo.createComparisonEnvelope(record, adHocBinding());
        await expect(
          repo.recordComparisonLineage("run-1", { repeatedFrom: "run-1" }, created.revision),
        ).rejects.toMatchObject({ kind: "validation" });
      });
    });

    describe("rebuildComparisonIndex", () => {
      it("refreshes derived fields from the updated source record", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", {
          createdAt: 100,
          updatedAt: 101,
        });
        const created = await repo.createComparisonEnvelope(record, adHocBinding(), {
          activeObservationIds: ["obs:one"],
        });
        await runs.update(
          makeRunRecord("run-1", { status: "completed", revision: 0, updatedAt: 200 }),
          makeFullSummary("run-1", 100, { status: "completed" }),
          0,
        );
        const rebuilt = await repo.rebuildComparisonIndex("run-1");
        expect(rebuilt).not.toBeNull();
        expect(rebuilt?.status).toBe("completed");
        expect(rebuilt?.updatedAt).toBe(200);
        expect(rebuilt?.revision).toBe(created.revision + 1);
        // Binding, lineage, observations, and receipt state are preserved.
        expect(rebuilt?.taskBinding).toEqual(created.taskBinding);
        expect(rebuilt?.lineage).toEqual(created.lineage);
        expect(rebuilt?.activeObservationIds).toEqual(["obs:one"]);
        expect(rebuilt?.createdAt).toBe(100);
        // The repaired index now reads clean.
        const envelope = await repo.getComparisonResult("run-1");
        expect(envelope?.warning).toBeNull();
      });

      it("is idempotent: re-running produces no duplicate indexes and no revision churn", async () => {
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1", {
          createdAt: 100,
          updatedAt: 101,
        });
        await repo.createComparisonEnvelope(record, adHocBinding());
        await runs.update(
          makeRunRecord("run-1", { status: "completed", revision: 0, updatedAt: 200 }),
          makeFullSummary("run-1", 100, { status: "completed" }),
          0,
        );
        const first = await repo.rebuildComparisonIndex("run-1");
        const second = await repo.rebuildComparisonIndex("run-1");
        expect(second).toEqual(first);
        expect((await repo.listComparisonResults({})).map((r) => r.id)).toEqual(["run-1"]);
      });

      it("returns null when the source run is missing", async () => {
        const { repo } = harness;
        const record = makeRunRecord("run-orphan", { createdAt: 100, updatedAt: 101 });
        await repo.createComparisonEnvelope(record, adHocBinding());
        expect(await repo.rebuildComparisonIndex("run-orphan")).toBeNull();
      });

      it("returns null when no index exists for the run", async () => {
        const { repo, runs } = harness;
        await seedSourceRun(runs, "run-1");
        expect(await repo.rebuildComparisonIndex("run-1")).toBeNull();
      });
    });

    describe("storage failure and lifecycle", () => {
      it("rejects mutations with a classified StorageError when storage is unavailable", async () => {
        if (!harness.simulateUnavailable) return; // in-memory parity has no storage failures
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        harness.simulateUnavailable();
        await expect(repo.createComparisonEnvelope(record, adHocBinding())).rejects.toMatchObject({
          kind: "unavailable",
        });
        await expect(
          repo.bindComparisonToTask(
            "run-1",
            { kind: "canonical", taskId: "task-1", taskVersion: 1 },
            null,
            0,
          ),
        ).rejects.toMatchObject({ kind: "unavailable" });
        await expect(repo.rebuildComparisonIndex("run-1")).rejects.toMatchObject({
          kind: "unavailable",
        });
      });

      it("classifies closed-database failures as unavailable", async () => {
        if (!harness.close) return; // in-memory parity has no storage failures
        const { repo, runs } = harness;
        const { record } = await seedSourceRun(runs, "run-1");
        await repo.createComparisonEnvelope(record, adHocBinding());
        await harness.close();
        const err = await repo.listComparisonResults({}).catch((e) => e);
        expect(err).toBeInstanceOf(StorageError);
        expect((err as StorageError).kind).toBe("unavailable");
      });

      it("notifies subscribers after successful mutations", async () => {
        const { repo, runs } = harness;
        const listener = vi.fn();
        const unsubscribe = repo.subscribe(listener);
        const { record } = await seedSourceRun(runs, "run-1");
        await repo.createComparisonEnvelope(record, adHocBinding());
        expect(listener).toHaveBeenCalledTimes(1);
        unsubscribe();
        await repo.recordComparisonLineage("run-1", { repeatedFrom: "run-0" }, 0);
        expect(listener).toHaveBeenCalledTimes(1);
      });
    });
  });
}

runContract("dexie", dexieFactory);
runContract("in-memory", memoryFactory);
