// =============================================================================
// RSemble AI — Collision-safe phased v3 import repair tests (Child 10 review)
//
// RED tests for the review-confirmed findings:
//  R1  production paths (importWorkbenchArchiveAuto / DataArchiveActions) must
//      route confirmed v3 imports through the phased importer with planned
//      remaps disclosed at preview time;
//  R2  a remapped entity must carry the new ID in BOTH the Dexie row key and
//      every embedded record field, and same-graph dependents (versions,
//      instances, observations, rollup members) must point at the new ID;
//  R2b equal strings in unrelated collections must never cross-remap — the
//      crosswalk is collection-qualified;
//  R3  the import journal is durable: receipt persisted after success, phases
//      marked complete only after verification, resume skips completed phases,
//      and quota/unavailable/cancel errors are classified;
//  R4  stale search rows are gone after a committed import (rebuild, not just
//      a marker nobody consumes).
// =============================================================================

import "fake-indexeddb/auto";
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import {
  ArchiveImportCancelledError,
  importWorkbenchArchiveAuto,
  importWorkbenchArchiveV3Phased,
  previewWorkbenchArchive,
} from "./archive";
import {
  computeArchiveV3ContentDigests,
  computeArchiveV3PayloadDigest,
  validateArchiveV3,
  type WorkbenchArchiveV3,
} from "./archive-v3-types";
import {
  buildValidArchiveV3Fixture,
  seedCompleteV3Corpus,
} from "./archive-v3-fixtures";
import { RSembleEvaluationDB } from "./database";
import { IMPORT_JOURNAL_KEY } from "./archive";

function freshDb(name: string): RSembleEvaluationDB {
  const db = new RSembleEvaluationDB(`test-phased-${name}-${Math.random()}`);
  return db;
}

function resealed(archive: WorkbenchArchiveV3): WorkbenchArchiveV3 {
  const copy = JSON.parse(JSON.stringify(archive)) as WorkbenchArchiveV3;
  copy.manifest.payloadDigest = computeArchiveV3PayloadDigest(copy);
  copy.manifest.contentDigests = computeArchiveV3ContentDigests(copy);
  return copy;
}

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Deterministic remapped IDs for assertions.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

// -----------------------------------------------------------------------------
// R2 — complete remapping: outer key + embedded ids + same-graph dependents
// -----------------------------------------------------------------------------

describe("phased v3 import — complete collision remapping (R2)", () => {
  it("remaps a colliding Task: row key AND embedded record id change, and every dependent points at the new ID", async () => {
    const db = freshDb("remap-task");
    dbs.push(db);
    await seedCompleteV3Corpus(db);

    // Build an incoming archive whose task-1 RECORD differs from the seeded one.
    const incoming = buildValidArchiveV3Fixture();
    incoming.tasks.tasks[0].updatedAt = 9999;
    const resealedIncoming = resealed(incoming);

    const result = await importWorkbenchArchiveV3Phased(db, resealedIncoming);

    const taskRemap = result.remapped.find((e) => e.collection === "tasks.tasks");
    expect(taskRemap).toBeDefined();
    const newTaskId = taskRemap!.localId;
    expect(newTaskId).not.toBe("task-1");

    // Outer row key and embedded record.id BOTH carry the new ID.
    const remappedRow = await db.tasks.get(newTaskId);
    expect(remappedRow).toBeDefined();
    expect((remappedRow as { record: { id: string } }).record.id).toBe(newTaskId);

    // The pre-existing task row is untouched (no overwrite).
    const originalRow = await db.tasks.get("task-1");
    expect(originalRow).toBeDefined();
    expect((originalRow as { record: { id: string } }).record.id).toBe("task-1");

    // Dependents written in the same import point at the NEW id. The original
    // dependent rows persist untouched; the import's copies land under their
    // own remapped ids (the connected component moves as a unit).
    const taskVersion = await db.taskVersions.get([newTaskId, 1]);
    expect(taskVersion).toBeDefined();
    expect((taskVersion as { version_: { taskId: string } }).version_.taskId).toBe(newTaskId);

    const instanceRemap = result.remapped.find(
      (e) => e.collection === "tasks.taskInstances",
    );
    expect(instanceRemap).toBeDefined();
    const remappedInstance = await db.taskInstances.get(instanceRemap!.localId);
    expect(remappedInstance).toBeDefined();
    expect((remappedInstance as { instance: { taskId: string } }).instance.taskId).toBe(newTaskId);

    // Evidence observation (later phase) also points at the new task.
    const observationRemap = result.remapped.find(
      (e) => e.collection === "evidence.observations",
    );
    expect(observationRemap).toBeDefined();
    const remappedObservation = await db.observations.get(observationRemap!.localId);
    expect(remappedObservation).toBeDefined();
    expect((remappedObservation as { observation: { taskId: string } }).observation.taskId).toBe(newTaskId);

    // Crosswalk is namespaced: task-1 maps only within tasks.tasks.
    expect(result.crosswalk["tasks.tasks\u0000task-1"]).toBe(newTaskId);
    expect(result.crosswalk["task-1"]).toBeUndefined();
  });

  it("remaps a colliding composite-key version and threads it into dependents", async () => {
    const db = freshDb("remap-version");
    dbs.push(db);
    await seedCompleteV3Corpus(db);

    // Collide ONLY the task version row (task-1@1) with different content.
    const incoming = buildValidArchiveV3Fixture();
    incoming.tasks.taskVersions[0].objective = "Different objective";
    const resealedIncoming = resealed(incoming);

    const result = await importWorkbenchArchiveV3Phased(db, resealedIncoming);
    // A version-table collision promotes the remap to the parent identity:
    // the whole task lineage lands under a new id at the SAME version number.
    const versionRemap = result.remapped.find(
      (e) => e.collection === "tasks.taskVersions",
    );
    expect(versionRemap).toBeDefined();
    const [newTaskId, newVersion] = versionRemap!.localId.split("@");
    expect(newTaskId).not.toBe("task-1");
    expect(Number(newVersion)).toBe(1);

    const remappedVersion = await db.taskVersions.get([newTaskId, 1]);
    expect(remappedVersion).toBeDefined();
    expect((remappedVersion as { version_: { taskId: string } }).version_.taskId).toBe(newTaskId);
    expect((remappedVersion as { version_: { objective: string } }).version_.objective).toBe("Different objective");

    // The original task and its original version row persist untouched.
    expect(((await db.tasks.get("task-1")) as { record: { id: string } }).record.id).toBe("task-1");
    const originalVersion = await db.taskVersions.get(["task-1", 1]);
    expect((originalVersion as { version_: { objective: string } }).version_.objective).toBe("Do the task");

    // The legacy migration crosswalk keeps its own key; the incoming row's
    // rewritten mapping (pointing at the new task id) lands under a
    // suffixed key instead of overwriting local truth.
    expect(await db.taskMigrationCrosswalk.get("legacy:task-1")).toBeDefined();
  });

  it("equal strings in unrelated collections never cross-remap (namespaced crosswalk)", async () => {
    const db = freshDb("namespaced");
    dbs.push(db);
    await seedCompleteV3Corpus(db);

    const incoming = resealed(buildValidArchiveV3Fixture());

    // suite-1 exists locally with different content → suites/suite-1 remaps.
    const suiteRow = await db.suites.get("suite-1");
    (suiteRow!.suite as { name: string }).name = "Locally diverged suite name";
    await db.suites.put(suiteRow!);

    // The string "suite-1" appears as an unrelated field on the experiment
    // (suiteId) — it must NOT be rewritten by the suite remap.
    const result = await importWorkbenchArchiveV3Phased(db, incoming);

    const suiteRemap = result.remapped.find((e) => e.collection === "suites");
    expect(suiteRemap).toBeDefined();

    // The crosswalk itself is collection-qualified.
    expect(result.crosswalk["suites\u0000suite-1"]).toBe(suiteRemap!.localId);
    expect(result.crosswalk["suite-1"]).toBeUndefined();

    // The experiment was imported (create) and still references "suite-1".
    const experiment = await db.experiments.get("exp-1");
    expect(experiment).toBeDefined();
    expect((experiment as { experiment: { suiteId: string } }).experiment.suiteId).toBe(
      "suite-1",
    );
  });

  it("does not mutate the caller's archive object", async () => {
    const db = freshDb("immutable-input");
    dbs.push(db);
    await seedCompleteV3Corpus(db);

    const incoming = resealed(buildValidArchiveV3Fixture());
    incoming.tasks.taskVersions[0].title = "Colliding modified title";
    incoming.manifest.payloadDigest = computeArchiveV3PayloadDigest(incoming);
    incoming.manifest.contentDigests = computeArchiveV3ContentDigests(incoming);
    const before = JSON.stringify(incoming);

    await importWorkbenchArchiveV3Phased(db, incoming);

    expect(JSON.stringify(incoming)).toBe(before);
  });
});

// -----------------------------------------------------------------------------
// R1 — production path routes through the phased importer; preview discloses
// -----------------------------------------------------------------------------

describe("phased v3 import — production routing (R1)", () => {
  it("importWorkbenchArchiveAuto resolves v3 collisions by remapping, not aborting", async () => {
    const db = freshDb("auto-remap");
    dbs.push(db);
    await seedCompleteV3Corpus(db);

    const incoming = resealed(buildValidArchiveV3Fixture());
    incoming.tasks.taskVersions[0].title = "Colliding modified title";
    incoming.manifest.payloadDigest = computeArchiveV3PayloadDigest(incoming);
    incoming.manifest.contentDigests = computeArchiveV3ContentDigests(incoming);

    const result = await importWorkbenchArchiveAuto(db, incoming);

    expect(result.format).toBe("v3");
    if (result.format !== "v3") return;
    expect(result.v3.remapped.length).toBeGreaterThan(0);
    // The abort-on-collision contract is gone from the auto path: importing
    // colliding content succeeds with remaps.
    const originalTask = await db.tasks.get("task-1");
    expect(originalTask).toBeDefined();
    expect(await db.tasks.count()).toBe(2);
  });

  it("preview discloses planned remaps for a colliding v3 archive", async () => {
    const db = freshDb("preview-remaps");
    dbs.push(db);
    await seedCompleteV3Corpus(db);

    const incoming = resealed(buildValidArchiveV3Fixture());
    incoming.tasks.taskVersions[0].title = "Colliding modified title";
    incoming.manifest.payloadDigest = computeArchiveV3PayloadDigest(incoming);
    incoming.manifest.contentDigests = computeArchiveV3ContentDigests(incoming);

    const preview = await previewWorkbenchArchive(db, incoming);

    // Planned remaps are disclosed with collection + key.
    expect(preview.plannedRemaps.length).toBeGreaterThan(0);
    const taskRemap = preview.plannedRemaps.find((r) => r.collection === "tasks.tasks");
    expect(taskRemap).toBeDefined();
    expect(taskRemap!.key).toBe("task-1");
  });
});

// -----------------------------------------------------------------------------
// R3 — durable journal, phase isolation, resume, classification
// -----------------------------------------------------------------------------

describe("phased v3 import — durable journal and resume (R3)", () => {
  it("persists a journal receipt after success and marks phases complete only after verification", async () => {
    const db = freshDb("journal-success");
    dbs.push(db);

    const incoming = resealed(buildValidArchiveV3Fixture());
    const result = await importWorkbenchArchiveV3Phased(db, incoming);

    const raw = await db.storageMeta.get(IMPORT_JOURNAL_KEY);
    expect(raw).toBeDefined();
    const journal = raw!.value as {
      importId: string;
      archiveDigest: string;
      phaseState: Record<string, string>;
      verificationReceipt: unknown;
    };
    expect(journal.importId).toBe(result.importId);
    expect(journal.archiveDigest).toBe(computeArchiveV3PayloadDigest(incoming));
    // Every phase is completed AND verified.
    for (const [phase, state] of Object.entries(journal.phaseState)) {
      expect(state).toBe("completed");
      expect(result.failedPhases).not.toContain(phase);
    }
    expect(journal.verificationReceipt).toBeDefined();
  });

  it("a failed phase rolls back only itself: earlier phases persist, failed-phase rows are absent", async () => {
    const db = freshDb("phase-isolation");
    dbs.push(db);

    const incoming = resealed(buildValidArchiveV3Fixture());

    // Inject a failure into the second phase ("tasks") by making the tasks
    // table write fail via a spy on the Dexie transaction.
    const originalTransaction = db.transaction.bind(db);
    let phaseIndex = 0;
    const failing = vi
      .spyOn(db, "transaction")
      .mockImplementation(((mode: string, tables: unknown, scope?: unknown) => {
        phaseIndex += 1;
        if (phaseIndex === 2) {
          return Promise.reject(new Error("Injected phase-2 failure"));
        }
        return originalTransaction(
          mode as never,
          tables as never,
          scope as never,
        ) as never;
      }) as never);

    await expect(importWorkbenchArchiveV3Phased(db, incoming)).rejects.toThrow(
      /Injected phase-2 failure/,
    );
    failing.mockRestore();

    // Phase 1 (runs/rubrics/suites/experiments) persisted.
    expect(await db.runSummaries.count()).toBe(1);
    expect(await db.suites.count()).toBe(1);
    // Phase 2 (tasks) wrote nothing.
    expect(await db.tasks.count()).toBe(0);
    expect(await db.taskVersions.count()).toBe(0);
    // Later phases never ran.
    expect(await db.studies.count()).toBe(0);

    // Journal records phase-2 as failed, phase-1 as completed.
    const raw = await db.storageMeta.get(IMPORT_JOURNAL_KEY);
    expect(raw).toBeDefined();
    const journal = raw!.value as { phaseState: Record<string, string> };
    expect(journal.phaseState["runs-rubrics-suites-experiments"]).toBe("completed");
    expect(journal.phaseState["tasks"]).toBe("failed");
  });

  it("resume from the first unfinished phase replays no completed work", async () => {
    const db = freshDb("resume");
    dbs.push(db);

    const incoming = resealed(buildValidArchiveV3Fixture());

    // Simulate a crash after phase 1: journal says phase 1 completed, rest pending.
    const importId = "import-resume-test";
    await db.storageMeta.put({
      key: IMPORT_JOURNAL_KEY,
      value: {
        importId,
        archiveDigest: computeArchiveV3PayloadDigest(incoming),
        phaseState: {
          "runs-rubrics-suites-experiments": "completed",
          tasks: "pending",
          taskSets: "pending",
          evidence: "pending",
          comparisons: "pending",
          lab: "pending",
          modelRollups: "pending",
        },
        verificationReceipt: null,
      },
    });
    // Phase 1 data already exists (as if the crash happened after commit).
    // Seed just phase-1 data:
    const phaseOne = resealed(buildValidArchiveV3Fixture());
    await db.runSummaries.put({
      id: "run-1",
      summary: phaseOne.runs.summaries[0],
      mode: "compare",
      kind: "full",
      status: "completed",
      revision: 1,
      createdAt: 1000,
      completedAt: 2000,
    } as never);
    await db.suites.put({
      id: "suite-1",
      suite: phaseOne.suites[0],
      revision: 1,
      version: 1,
      updatedAt: 1000,
      archivedAt: null,
    } as never);

    // Resume: the importer must NOT rewrite phase 1 rows.
    const writeSpy = vi.spyOn(db.runSummaries, "put");
    const result = await importWorkbenchArchiveV3Phased(db, incoming, {
      resumeImportId: importId,
    });

    // Phase-1 rows were not re-written.
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();

    // Later phases completed.
    expect(await db.tasks.count()).toBe(1);
    expect(await db.studies.count()).toBe(1);
    expect(result.failedPhases).toEqual([]);
  });

  it("classifies quota, unavailable, and cancel failures", async () => {
    const db = freshDb("classify");
    dbs.push(db);

    const incoming = resealed(buildValidArchiveV3Fixture());

    // Quota: Dexie QuotaExceededError.
    const quotaError = new Error("The current transaction exceeded its quota limitation.");
    (quotaError as { name?: string }).name = "QuotaExceededError";
    const quotaSpy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(quotaError as never);
    await expect(importWorkbenchArchiveV3Phased(db, incoming)).rejects.toMatchObject({
      kind: "quota",
    });
    quotaSpy.mockRestore();

    // Unavailable: connection closed mid-import.
    const unavailableSpy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("Database has been closed") as never);
    await expect(importWorkbenchArchiveV3Phased(db, incoming)).rejects.toMatchObject({
      kind: "unavailable",
    });
    unavailableSpy.mockRestore();

    // Cancel: aborted signal before phase 1.
    const controller = new AbortController();
    controller.abort();
    await expect(
      importWorkbenchArchiveV3Phased(db, incoming, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ArchiveImportCancelledError);
  });
});

// -----------------------------------------------------------------------------
// R4 — search rebuild after commit
// -----------------------------------------------------------------------------

describe("phased v3 import — disposable search rebuild (R4)", () => {
  it("stale search rows are gone after a committed import and fresh documents exist for imported entities", async () => {
    const db = freshDb("search-rebuild");
    dbs.push(db);

    // A stale document referencing an entity that no longer exists.
    await db.searchDocuments.put({
      type: "task",
      id: "stale-task",
      revision: 1,
      title: "Stale task",
      subtitle: "",
      ownerHref: "/tasks/stale-task",
      tokens: ["stale"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    } as never);

    const incoming = resealed(buildValidArchiveV3Fixture());
    await importWorkbenchArchiveV3Phased(db, incoming);

    // Stale row removed by the rebuild.
    expect(await db.searchDocuments.get(["task", "stale-task"])).toBeUndefined();
    // Fresh document for the imported task exists.
    expect(await db.searchDocuments.get(["task", "task-1"])).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// R5 — canonical manifest enforcement after legacy normalization
// -----------------------------------------------------------------------------

describe("phased v3 import — canonical manifest enforcement (R5)", () => {
  it("a v3 archive missing canonical manifest fields is rejected after normalization", async () => {
    const db = freshDb("manifest-strict");
    dbs.push(db);

    const legacy = buildValidArchiveV3Fixture();
    // Strip the canonical fields an older v3 export omitted.
    delete (legacy.manifest as unknown as Record<string, unknown>).appVersion;
    delete (legacy.manifest as unknown as Record<string, unknown>).contentDigests;
    delete (legacy.manifest as unknown as Record<string, unknown>)
      .observationRuleVersions;
    delete (legacy.manifest as unknown as Record<string, unknown>)
      .aggregationRuleVersions;
    delete (legacy.manifest as unknown as Record<string, unknown>)
      .uncertaintyRuleVersions;
    delete (legacy.manifest as unknown as Record<string, unknown>).localScopeNotice;
    legacy.manifest.payloadDigest = computeArchiveV3PayloadDigest(legacy);

    // Direct validation rejects the non-canonical manifest (older v3 archives
    // must go through the explicit adapter).
    const check = validateArchiveV3(legacy);
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.field.startsWith("manifest."))).toBe(true);

    // The phased importer rejects it too.
    await expect(importWorkbenchArchiveV3Phased(db, legacy)).rejects.toMatchObject({
      kind: "validation",
    });
  });
});

// -----------------------------------------------------------------------------
// R6 — comparison migration limitations ported to v3
// -----------------------------------------------------------------------------

describe("v3 export — comparison migration limitations (R6)", () => {
  it("a migrated (partial) comparison snapshot exports its matching limitation and count", async () => {
    const db = freshDb("limitation-export");
    dbs.push(db);

    // Seed a corpus with an ad-hoc (migrated, non-resolving) comparison.
    await seedCompleteV3Corpus(db);
    const reexported = await exportWorkbenchArchiveV3ForRead(db);

    const fixture = buildValidArchiveV3Fixture();
    expect(reexported.comparisons.limitations).toEqual(fixture.comparisons.limitations);
    expect(reexported.manifest.counts.comparisonLimitations).toBe(1);
  });
});

async function exportWorkbenchArchiveV3ForRead(db: RSembleEvaluationDB) {
  const { exportWorkbenchArchiveV3 } = await import("./archive");
  return exportWorkbenchArchiveV3(db, { now: 1000 });
}

describe("v3 validation — unified boundary-aware secret scanner (R5)", () => {
  const SECRET = "sk-live-abcdef1234567890";

  function poisoned(mutate: (a: WorkbenchArchiveV3) => void): WorkbenchArchiveV3 {
    const archive = buildValidArchiveV3Fixture();
    mutate(archive);
    archive.manifest.payloadDigest = computeArchiveV3PayloadDigest(archive);
    archive.manifest.contentDigests = computeArchiveV3ContentDigests(archive);
    return archive;
  }

  function expectRejected(archive: WorkbenchArchiveV3): void {
    const check = validateArchiveV3(archive);
    expect(check.valid).toBe(false);
    const joined = JSON.stringify(check.errors);
    expect(joined).not.toContain(SECRET);
  }

  it("catches a secret at the START of an identity field", () => {
    const archive = poisoned((a) => {
      a.tasks.taskFamilies[0].id = `${SECRET}-fam`;
    });
    expectRejected(archive);
  });

  it("catches a secret in the MIDDLE of free text", () => {
    const archive = poisoned((a) => {
      a.suites[0].description = `contact ${SECRET} thanks`;
    });
    expectRejected(archive);
  });

  it("catches a secret at the END of a config value", () => {
    const archive = poisoned((a) => {
      (
        a.evidence.modelConfigurations[0].runtimeSettings as unknown as Record<
          string,
          unknown
        >
      ).note = `endpoint token ${SECRET}`;
    });
    expectRejected(archive);
  });

  it("catches a secret in an error field", () => {
    const archive = poisoned((a) => {
      a.evidence.evidenceIndexJobs[0].errorMessage = `upload failed: ${SECRET}`;
    });
    expectRejected(archive);
  });

  it("catches a secret hidden in artifact bytes", () => {
    const archive = poisoned((a) => {
      const raw = new TextEncoder().encode(`notes: ${SECRET} end`);
      let binary = "";
      for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);
      a.tasks.taskArtifactBytes[0].bytesBase64 = btoa(binary);
    });
    expectRejected(archive);
  });
});

describe("v3 validation — comparison limitation derivation contract (R6)", () => {
  it("rejects a migrated partial comparison whose limitation record is missing", () => {
    const archive = buildValidArchiveV3Fixture();
    archive.comparisons.limitations = [];
    archive.manifest.payloadDigest = computeArchiveV3PayloadDigest(archive);
    archive.manifest.contentDigests = computeArchiveV3ContentDigests(archive);
    const check = validateArchiveV3(archive);
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.field.includes("comparisons.limitations"))).toBe(
      true,
    );
  });

  it("rejects a limitation record without a matching migrated index", () => {
    const archive = buildValidArchiveV3Fixture();
    archive.comparisons.limitations = [
      { runId: "ghost-run", reason: "instance_input_incomplete" },
    ];
    archive.manifest.payloadDigest = computeArchiveV3PayloadDigest(archive);
    archive.manifest.contentDigests = computeArchiveV3ContentDigests(archive);
    const check = validateArchiveV3(archive);
    expect(check.valid).toBe(false);
  });
});
