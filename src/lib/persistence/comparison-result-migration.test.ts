// =============================================================================
// RSemble AI — Comparison Result legacy migration contract tests (spec §10)
//
// Child 05 (Contextual Compare Results) Milestone A — Task 3.
//
// RED matrix for the one-time, idempotent legacy indexing of every current
// full Compare RunRecordV2 into the summary-only Comparison Result index
// store (schema v11):
//
//  - one index per safe full Compare with comparisonId == runId;
//  - evaluation-source runs excluded (not semantic comparisons);
//  - legacy summary-only records kept as Records-only (no reconstructable
//    result, no index);
//  - completed/partial/interrupted (and every other lifecycle state) indexed
//    with their exact persisted status/mode/title;
//  - repeated startup creates no duplicate indexes (resume-by-crosswalk over
//    the existing index rows);
//  - missing detail rows and corrupt sources are explicit limitations, never
//    crashes and never indexes;
//  - ad hoc binding unless an explicit trustworthy existing link is present;
//  - no Task auto-creation by prompt hash; no semantic auto-merge;
//  - explicit instance_input_incomplete limitation when historical input
//    content (the pre-call input snapshot) is missing;
//  - RunRecordV2 sources are never mutated;
//  - completion marker follows only after verified writes (marker-after-verify).
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import { buildComparisonIndex } from "./comparison-repository";
import {
  comparisonResultMigrationMarkerKey,
  migrateComparisonResults,
  migratedInputSnapshotRef,
  type ComparisonMigrationMarker,
} from "./comparison-result-migration";
import { RSembleEvaluationDB } from "./database";
import { createRunRepository } from "./run-repository";
import type { FullRunSummaryV2, LegacyRunSummary, RunRecordV2, RunStatus } from "./run-types";

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

// ---------------------------------------------------------------------------
// Fixtures (mirrors comparison-repository.test.ts so records pass validators)
// ---------------------------------------------------------------------------

/** A real pre-call snapshot ref (Task 4 era) — never produced by migration. */
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
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "excerpt-" + id,
    ...overrides,
  };
}

function makeLegacySummary(id: string): LegacyRunSummary {
  return {
    kind: "legacy",
    schemaVersion: "1-import",
    id,
    createdAt: 1,
    taskExcerpt: "excerpt-" + id,
    modelKeys: ["openrouter:legacy"],
    winnerKeys: [],
    scoresByModelKey: {},
    detailAvailable: false,
    searchText: "excerpt-" + id,
  };
}

function experimentSource() {
  return {
    kind: "experiment" as const,
    experimentId: "exp-1",
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: `sha256:${"a".repeat(64)}`,
    taskId: "task-1",
    experimentTaskAttemptId: "attempt-1",
    trial: 0,
  };
}

interface SeedOptions {
  status?: RunStatus;
  mode?: "rank" | "fuse";
  title?: string;
  source?: RunRecordV2["source"];
  createdAt?: number;
  updatedAt?: number;
}

/** Persist a full source run (record + summary atomically) via the repository. */
async function seedFullRun(
  db: RSembleEvaluationDB,
  id: string,
  options: SeedOptions = {},
): Promise<{ record: RunRecordV2; summary: FullRunSummaryV2 }> {
  const runs = createRunRepository(db);
  const createdAt = options.createdAt ?? 1000;
  const updatedAt = options.updatedAt ?? createdAt + 1;
  const status = options.status ?? "completed";
  const mode = options.mode ?? "rank";
  const source = options.source ?? { kind: "adhoc" };
  const title = options.title ?? `Task ${id}`;
  const record = makeRunRecord(id, { status, mode, createdAt, updatedAt, source });
  record.task = { ...record.task, title };
  const summary = makeFullSummary(id, createdAt, { status, mode, source, taskTitle: title });
  await runs.create(record, summary);
  return { record, summary };
}

async function makeDb(): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(`comparison-migration-${crypto.randomUUID()}`);
  dbs.push(db);
  await db.open();
  return db;
}

/** Deep snapshot of every RunRecordV2 source store (summaries + details). */
async function snapshotSources(db: RSembleEvaluationDB) {
  return {
    summaries: JSON.parse(JSON.stringify(await db.runSummaries.toArray())),
    details: JSON.parse(JSON.stringify(await db.runDetails.toArray())),
  };
}

async function migrationMarker(db: RSembleEvaluationDB): Promise<ComparisonMigrationMarker | null> {
  const row = await db.storageMeta.get(comparisonResultMigrationMarkerKey);
  return (row?.value as ComparisonMigrationMarker | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

describe("migrateComparisonResults", () => {
  it("indexes one safe full Compare run with comparisonId == runId (summary-only)", async () => {
    const db = await makeDb();
    const { record } = await seedFullRun(db, "run-completed", { status: "completed" });
    const sourcesBefore = await snapshotSources(db);

    const result = await migrateComparisonResults(db, { now: () => 42 });

    expect(result).toEqual({
      indexed: 1,
      repaired: 0,
      skippedExisting: 0,
      excludedEvaluation: 0,
      legacyRecordsOnly: 0,
      limitations: [{ runId: "run-completed", reason: "instance_input_incomplete" }],
      complete: true,
    });
    expect(await db.comparisonResults.count()).toBe(1);
    const index = await db.comparisonResults.get("run-completed");
    expect(index).toEqual({
      id: "run-completed",
      runId: "run-completed",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      status: "completed",
      mode: "rank",
      title: record.task.title,
      taskBinding: {
        kind: "ad_hoc",
        inputSnapshotRef: migratedInputSnapshotRef("run-completed"),
      },
      taskInstanceId: null,
      activeObservationIds: [],
      evidenceReceiptRevision: 0,
      lineage: { repeatedFrom: null },
      revision: 0,
    });
    // comparisonId == runId == the exact source record id (spec §3).
    expect(index?.id).toBe(record.id);
    expect(index?.runId).toBe(record.id);
    // Summary-only: the index never carries candidate outputs or judge
    // rationale (the exact-field validator rejects those shapes outright).
    expect(JSON.stringify(index)).not.toMatch(/candidateOutput|rationale|judgeReport/i);
    // No Task auto-creation by prompt hash (spec §10).
    expect(await db.tasks.count()).toBe(0);
    expect(await db.taskInstances.count()).toBe(0);
    expect(await db.taskMigrationCrosswalk.count()).toBe(0);
    // RunRecordV2 sources are never mutated.
    expect(await snapshotSources(db)).toEqual(sourcesBefore);
    // Marker-after-verify: the marker records the completed pass.
    expect(await migrationMarker(db)).toEqual({
      kind: "comparison-result-migration",
      version: 1,
      completedAt: 42,
      limitations: result.limitations,
    });
  });

  it("excludes evaluation-source runs (not semantic comparisons)", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-exp", { source: experimentSource() });
    await seedFullRun(db, "run-cmp", { status: "partial" });

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ indexed: 1, excludedEvaluation: 1 });
    expect(await db.comparisonResults.get("run-exp")).toBeUndefined();
    expect(await db.comparisonResults.get("run-cmp")).toBeDefined();
  });

  it("keeps legacy summary-only records as Records-only (no reconstructable result)", async () => {
    const db = await makeDb();
    const runs = createRunRepository(db);
    await runs.importLegacySummary(makeLegacySummary("legacy-1"));

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ indexed: 0, legacyRecordsOnly: 1 });
    expect(await db.comparisonResults.count()).toBe(0);
    // The legacy summary row itself is untouched.
    const row = await db.runSummaries.get("legacy-1");
    expect((row?.summary as LegacyRunSummary).kind).toBe("legacy");
    expect(result.limitations).toEqual([]);
  });

  it("indexes completed, partial, and interrupted runs with their exact lifecycle state", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-completed", { status: "completed" });
    await seedFullRun(db, "run-partial", { status: "partial" });
    await seedFullRun(db, "run-interrupted", { status: "interrupted", mode: "fuse" });

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ indexed: 3 });
    expect((await db.comparisonResults.get("run-completed"))?.status).toBe("completed");
    expect((await db.comparisonResults.get("run-partial"))?.status).toBe("partial");
    const interrupted = await db.comparisonResults.get("run-interrupted");
    expect(interrupted?.status).toBe("interrupted");
    expect(interrupted?.mode).toBe("fuse");
  });

  it("indexes every other lifecycle state of a full Compare record too", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-running", { status: "running" });
    await seedFullRun(db, "run-aborted", { status: "aborted" });
    await seedFullRun(db, "run-failed", { status: "failed", mode: "fuse" });

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ indexed: 3 });
    expect((await db.comparisonResults.get("run-running"))?.status).toBe("running");
    expect((await db.comparisonResults.get("run-aborted"))?.status).toBe("aborted");
    const failed = await db.comparisonResults.get("run-failed");
    expect(failed?.status).toBe("failed");
    expect(failed?.mode).toBe("fuse");
  });

  it("repeated startup creates no duplicate indexes (idempotent, resume-by-crosswalk)", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-a", { status: "completed" });
    await seedFullRun(db, "run-b", { status: "partial", mode: "fuse" });

    const first = await migrateComparisonResults(db, { now: () => 100 });
    const rowsAfterFirst = await db.comparisonResults.toArray();

    const second = await migrateComparisonResults(db, { now: () => 200 });
    const third = await migrateComparisonResults(db, { now: () => 300 });

    expect(first).toMatchObject({ indexed: 2 });
    expect(second).toEqual({ ...first, indexed: 0, repaired: 0, skippedExisting: 2 });
    expect(third).toEqual({ ...second, limitations: first.limitations });
    // Exactly one index per run — never duplicates.
    expect(await db.comparisonResults.count()).toBe(2);
    expect(await db.comparisonResults.toArray()).toEqual(rowsAfterFirst);
    // Limitations are deterministic across restarts; the marker advances only
    // its completion timestamp.
    expect(second.limitations).toEqual(first.limitations);
    expect(await migrationMarker(db)).toEqual({
      kind: "comparison-result-migration",
      version: 1,
      completedAt: 300,
      limitations: first.limitations,
    });
  });

  it("records an explicit missing_detail limitation when the detail row is absent", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-missing");
    await db.runDetails.delete("run-missing");

    const result = await migrateComparisonResults(db);

    expect(await db.comparisonResults.count()).toBe(0);
    expect(result).toMatchObject({ complete: true, indexed: 0 });
    expect(result.limitations).toEqual([{ runId: "run-missing", reason: "missing_detail" }]);
    expect((await migrationMarker(db))?.limitations).toEqual(result.limitations);

    // Repeated startup keeps the limitation explicit and still creates nothing.
    const second = await migrateComparisonResults(db);
    expect(second.limitations).toEqual(result.limitations);
    expect(await db.comparisonResults.count()).toBe(0);
  });

  it("handles corrupt sources gracefully: no crash, no index, explicit limitation", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-good", { status: "completed" });
    // Structurally unrecoverable detail record.
    await db.runSummaries.put({
      kind: "full",
      summary: makeFullSummary("run-bad", 2, { status: "completed" }),
      id: "run-bad",
      revision: 0,
      createdAt: 2,
      completedAt: null,
      status: "completed",
      mode: "rank",
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: ["openrouter:foo"],
    });
    await db.runDetails.put({
      id: "run-bad",
      record: { id: "run-bad", schemaVersion: 2 },
      revision: 0,
      createdAt: 2,
      status: "completed",
    });
    // Corrupt summary row (not a valid RunSummary).
    await db.runSummaries.put({
      kind: "full",
      summary: { garbage: true },
      id: "run-corrupt-summary",
      revision: 0,
      createdAt: 3,
      completedAt: null,
      status: "completed",
      mode: "rank",
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: [],
    });
    // Detail row whose embedded record id does not match the source run id.
    await db.runSummaries.put({
      kind: "full",
      summary: makeFullSummary("run-mismatch", 4, { status: "completed" }),
      id: "run-mismatch",
      revision: 0,
      createdAt: 4,
      completedAt: null,
      status: "completed",
      mode: "rank",
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: ["openrouter:foo"],
    });
    await db.runDetails.put({
      id: "run-mismatch",
      record: makeRunRecord("run-other"),
      revision: 0,
      createdAt: 4,
      status: "completed",
    });

    const result = await migrateComparisonResults(db);

    // No crash; only the safe full Compare is indexed.
    expect(result.complete).toBe(true);
    expect(result).toMatchObject({ indexed: 1 });
    expect(await db.comparisonResults.count()).toBe(1);
    expect(await db.comparisonResults.get("run-good")).toBeDefined();
    // Deterministic order (source id ascending).
    expect(result.limitations).toEqual([
      { runId: "run-bad", reason: "corrupt_source" },
      { runId: "run-corrupt-summary", reason: "corrupt_source" },
      { runId: "run-good", reason: "instance_input_incomplete" },
      { runId: "run-mismatch", reason: "corrupt_source" },
    ]);
  });

  it("binds ad hoc without Task auto-creation or semantic merging of similar runs", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-1", { status: "completed", title: "Same task" });
    await seedFullRun(db, "run-2", { status: "completed", title: "Same task" });

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ indexed: 2 });
    const one = await db.comparisonResults.get("run-1");
    const two = await db.comparisonResults.get("run-2");
    expect(one?.taskBinding).toEqual({
      kind: "ad_hoc",
      inputSnapshotRef: migratedInputSnapshotRef("run-1"),
    });
    expect(two?.taskBinding).toEqual({
      kind: "ad_hoc",
      inputSnapshotRef: migratedInputSnapshotRef("run-2"),
    });
    // Similar content never merges: two distinct one-to-one indexes.
    expect(one?.id).toBe("run-1");
    expect(two?.id).toBe("run-2");
    // No Task auto-creation by prompt hash (or any other signal).
    expect(await db.tasks.count()).toBe(0);
    expect(await db.taskVersions.count()).toBe(0);
    expect(await db.taskInstances.count()).toBe(0);
    expect(await db.taskMigrationCrosswalk.count()).toBe(0);
  });

  it("repairs a corrupt existing index row from the exact source record", async () => {
    const db = await makeDb();
    const { record } = await seedFullRun(db, "run-1", { status: "completed" });
    await db.comparisonResults.put({ id: "run-1" } as ComparisonResultIndex);

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ repaired: 1, indexed: 0 });
    const index = await db.comparisonResults.get("run-1");
    expect(index?.status).toBe("completed");
    expect(index?.title).toBe(record.task.title);
    expect(index?.taskBinding).toEqual({
      kind: "ad_hoc",
      inputSnapshotRef: migratedInputSnapshotRef("run-1"),
    });

    // The repaired row is now the resume crosswalk: repeated startup skips it.
    const second = await migrateComparisonResults(db);
    expect(second).toMatchObject({ repaired: 0, indexed: 0, skippedExisting: 1 });
    expect(await db.comparisonResults.count()).toBe(1);
  });

  it("skips existing indexes carrying a real snapshot or canonical binding without inventing limitations", async () => {
    const db = await makeDb();
    const { record: snapRecord } = await seedFullRun(db, "run-snap", { status: "completed" });
    const { record: canonRecord } = await seedFullRun(db, "run-canon", { status: "partial" });

    // A Task-4-era run: real immutable input snapshot persisted pre-call.
    await db.comparisonResults.put(
      buildComparisonIndex(snapRecord, { kind: "ad_hoc", inputSnapshotRef: SNAPSHOT_REF }, {}),
    );
    // A user-promoted run: explicit canonical binding (trustworthy source link).
    await db.comparisonResults.put(
      buildComparisonIndex(
        canonRecord,
        { kind: "canonical", taskId: "task-1", taskVersion: 1 },
        { taskInstanceId: "ti-1" },
      ),
    );

    const result = await migrateComparisonResults(db);

    expect(result).toMatchObject({ skippedExisting: 2, indexed: 0, repaired: 0 });
    expect(result.limitations).toEqual([]);
    const snap = await db.comparisonResults.get("run-snap");
    expect(snap?.taskBinding).toEqual({ kind: "ad_hoc", inputSnapshotRef: SNAPSHOT_REF });
    const canon = await db.comparisonResults.get("run-canon");
    expect(canon?.taskBinding).toEqual({ kind: "canonical", taskId: "task-1", taskVersion: 1 });
    expect(canon?.taskInstanceId).toBe("ti-1");
  });

  it("never mutates RunRecordV2 source records or summaries", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-1", { status: "completed" });
    await seedFullRun(db, "run-2", { status: "interrupted", mode: "fuse" });
    const before = await snapshotSources(db);

    await migrateComparisonResults(db);
    await migrateComparisonResults(db);

    expect(await snapshotSources(db)).toEqual(before);
  });

  it("classifies storage failure and writes nothing (no marker, no indexes)", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-1", { status: "completed" });
    db.setState("unavailable");

    await expect(migrateComparisonResults(db)).rejects.toMatchObject({
      name: "StorageError",
      kind: "unavailable",
    });
    expect(await db.comparisonResults.count()).toBe(0);
    expect(await migrationMarker(db)).toBeNull();

    // Recovery: once storage is writable again the pass completes.
    db.setState("ready");
    const recovered = await migrateComparisonResults(db);
    expect(recovered).toMatchObject({ indexed: 1, complete: true });
  });

  it("writes the completion marker only after verified writes (marker-after-verify)", async () => {
    const db = await makeDb();
    await seedFullRun(db, "run-1", { status: "completed" });

    const first = await migrateComparisonResults(db, { now: () => 500 });
    const marker = await migrationMarker(db);
    expect(marker).toEqual({
      kind: "comparison-result-migration",
      version: 1,
      completedAt: 500,
      limitations: first.limitations,
    });

    // Same injected clock: the repeated pass performs no new work — every
    // index row is skipped by the resume crosswalk (never duplicated) and
    // the stored rows, limitations, and marker stay byte-stable.
    const second = await migrateComparisonResults(db, { now: () => 500 });
    expect(second).toEqual({ ...first, indexed: 0, skippedExisting: 1 });
    expect(await db.comparisonResults.count()).toBe(1);
    expect(await migrationMarker(db)).toEqual(marker);
  });

  it("derives a deterministic, safe migrated input snapshot ref", () => {
    expect(migratedInputSnapshotRef("run-1")).toBe(migratedInputSnapshotRef("run-1"));
    expect(migratedInputSnapshotRef("run-1")).not.toBe(migratedInputSnapshotRef("run-2"));
    expect(migratedInputSnapshotRef("run-1")).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    expect(migratedInputSnapshotRef("run-1").startsWith("migrated:")).toBe(true);
  });
});
