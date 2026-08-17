// =============================================================================
// RSemble AI — Archive v2 integration & migration corpus (Child 02, Task 11A)
//
// Deterministic, end-to-end proof that the complete Run/Experiment/Fusion/
// Rubric/Task corpus round-trips through the v2 envelope with byte-identical
// semantic equality, that repeated import and repeated seeded legacy
// startup/reload preserve counts, exact crosswalks, source Suite/Experiment
// evidence, unresolved state, and artifact bytes, and that the full case
// matrix (clean, v1, corrupt digest/reference, missing artifact, prohibited
// content, identical reuse, non-identical collision, cancellation, injected
// failure/quota, storage-blocked) is classified correctly without ever
// weakening production behavior or partially importing.
//
// This file is the integration corpus: it composes the real export adapter,
// the preview-first v1/v2 import path, the atomic v2 commit, and the
// conservative legacy migration against fresh fake-indexeddb databases. It
// does NOT re-assert unit-level guards already pinned in archive.test.ts; it
// proves the seams compose into a deterministic, idempotent closure.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RSembleEvaluationDB, StorageError } from "./database";
import {
  ArchiveImportCancelledError,
  commitPreviewWorkbenchArchiveV2,
  exportWorkbenchArchive,
  exportWorkbenchArchiveV2,
  importWorkbenchArchiveAuto,
  previewWorkbenchArchive,
} from "./archive";
import {
  computeArchiveV2PayloadDigest,
  validateArchiveV2,
  type WorkbenchArchiveV2,
} from "./archive-v2-types";
import * as fx from "./archive-v2-fixtures";
import {
  canonicalTaskMigrationMarkerKey,
  migrateEmbeddedLegacyTasks,
} from "./canonical-task-migration";
import type { EvaluationSuite, ExperimentRecord } from "../evaluations/evaluation-types";

const dbs: RSembleEvaluationDB[] = [];

async function freshDb(label: string): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(`archive-v2-integration-${label}-${crypto.randomUUID()}`);
  dbs.push(db);
  await db.open();
  return db;
}

afterEach(async () => {
  while (dbs.length) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

// --- Corpus seeding (mirrors the repository row mapping via shared fixtures) ---

/** Seed every canonical Dexie store with one representative entity each, plus
 *  a second Run pair so deterministic-order assertions are meaningful. This is
 *  the complete Run/Experiment/Fusion/Rubric/Task corpus. */
async function seedCompleteCorpus(db: RSembleEvaluationDB): Promise<void> {
  const bytes = new TextEncoder().encode("candidate-visible artifact text");

  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-1")));
  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-2")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-1")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-2")));
  await db.profiles.put(fx.profileRow(fx.makeRubricRecord("rubric-1")));
  await db.profileVersions.put(fx.profileVersionRow(fx.makeRubricVersion("rubric-1", 1)));
  await db.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
  await db.experiments.put(fx.experimentRow(fx.makeExperiment("exp-1", "suite-1")));

  await db.fusionRecipes.put(fx.fusionRecipeRow(fx.makeRecipe("recipe-1", 1)));
  await db.poolManifests.put(fx.poolManifestRow(fx.makePoolManifest("pool-1", 1)));
  await db.fusionStudies.put(fx.fusionStudyRow(fx.makeStudy("study-1")));
  await db.fusionTrials.put(fx.fusionTrialRow(fx.makeTrial("trial-1", "study-1")));
  await db.fusionAttempts.put(fx.fusionAttemptRow(fx.makeAttempt("attempt-1", "study-1")));
  await db.fusionObservations.put(fx.fusionObservationRow(fx.makeObservation("obs-1", "trial-1")));
  await db.fusionPlaybooks.put(fx.fusionPlaybookRow(fx.makePlaybook("playbook-1", "study-1")));

  await db.tasks.put(fx.taskRecordRow(fx.makeTaskRecord("task-1")));
  await db.taskVersions.put(fx.taskVersionRow(fx.makeTaskVersion("task-1", 1, "art-1")));
  await db.taskArtifacts.put(fx.taskArtifactRow(fx.makeTaskArtifact("art-1", bytes)));
  await db.taskArtifactBytes.put(fx.taskArtifactBytesRow("art-1", bytes));
  await db.taskInstances.put(
    fx.taskInstanceRow(fx.makeTaskInstance("inst-1", "task-1", 1, "art-1")),
  );
  await db.taskFamilies.put(fx.taskFamilyRow(fx.makeTaskFamily("fam-1")));
  await db.taskFamilyAssignments.put(
    fx.taskFamilyAssignmentRow(fx.makeTaskFamilyAssignment("fa-1", "task-1", 1, "fam-1")),
  );
  await db.taskFamilyRelations.put(
    fx.taskFamilyRelationRow(fx.makeTaskFamilyRelation("rel-1", "fam-1", "fam-1")),
  );
  await db.taskFacetAnnotations.put(
    fx.taskFacetAnnotationRow(fx.makeTaskFacetAnnotation("ann-1", "task-1")),
  );
  await db.taskMigrationCrosswalk.put(fx.taskMigrationCrosswalkRow(fx.makeCrosswalk("task-1", 1)));

  // Task Set identity (Child 03 Task 11): records/versions/materializations and
  // the single ownership-crosswalk collection (suite-manifest / experiment-owner
  // / fusion-owner). The Task Set record id mirrors the legacy suite id so the
  // suite-manifest crosswalk references a real suite.
  await db.taskSets.put(fx.taskSetRecordRow(fx.makeTaskSetRecord("suite-1")));
  await db.taskSetVersions.put(fx.taskSetVersionRow(fx.makeTaskSetVersion("suite-1", 1)));
  await db.taskSetMaterializations.put(
    fx.taskSetMaterializationRow(fx.makeTaskSetMaterialization("mat-1", "suite-1", 1)),
  );
  await db.taskSetOwnershipCrosswalk.put(fx.makeSuiteManifestCrosswalk("suite-1"));
  await db.taskSetOwnershipCrosswalk.put(fx.makeExperimentOwnerCrosswalk("exp-1", "suite-1"));
  await db.taskSetOwnershipCrosswalk.put(fx.makeFusionOwnerCrosswalk("study-1", "suite-1"));
  // Evidence collections (Child 04 Task 12).
  const mc = fx.makeModelConfiguration();
  const obs = fx.makeEvidenceObservation(mc.id);
  const dec = fx.makeEligibilityDecision(obs.id, 1);
  const job = fx.makeEvidenceIndexJob("run-1");
  const vo = fx.makeExecutedVerifierOutcome("run-1", "task-1", "openrouter:m1", 1400);

  await db.modelConfigurations.put(fx.modelConfigurationRow(mc));
  await db.observations.put(fx.evidenceObservationRow(obs));
  await db.evidenceDecisions.put(fx.evidenceDecisionRow(dec));
  await db.evidenceIndexJobs.put(fx.evidenceIndexJobRow(job));
  await db.verifierOutcomes.put(fx.verifierOutcomeRow(vo));
}

const DETERMINISTIC_NOW = () => 5000;

function recomputeDigest(archive: WorkbenchArchiveV2): WorkbenchArchiveV2 {
  archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);
  return archive;
}

// =============================================================================
// 1. Complete corpus: export → fresh-DB import → semantic equality
// =============================================================================

describe("archive v2 integration — complete corpus round trip", () => {
  it("export → fresh-DB import → re-export is byte-identical (semantic equality) with exact counts, crosswalks, source evidence, and artifact bytes", async () => {
    const source = await freshDb("source");
    await seedCompleteCorpus(source);

    const exported = await exportWorkbenchArchiveV2(source, { now: DETERMINISTIC_NOW });
    expect(validateArchiveV2(JSON.parse(JSON.stringify(exported))).valid).toBe(true);

    // Import into a FRESH database (no prior state) via the preview+commit path.
    const target = await freshDb("target");
    const preview = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
    expect(preview.format).toBe("v2");
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);
    const commit = await commitPreviewWorkbenchArchiveV2(target, preview);
    expect(commit.collisions).toEqual([]);

    // Re-export the target with the same deterministic clock and prove the
    // envelope is byte-identical to the original export — semantic equality
    // across a fresh-DB import. The only field that could drift is
    // exportedAt; the deterministic clock pins it.
    const reexported = await exportWorkbenchArchiveV2(target, { now: DETERMINISTIC_NOW });
    expect(JSON.stringify(reexported)).toBe(JSON.stringify(exported));
    expect(reexported.manifest.payloadDigest).toBe(exported.manifest.payloadDigest);

    // Per-collection counts preserved exactly.
    expect(reexported.manifest.counts).toEqual(exported.manifest.counts);
    expect(reexported.manifest.counts.runSummaries).toBe(2);
    expect(reexported.manifest.counts.runDetails).toBe(2);
    expect(reexported.manifest.counts.fusionStudies).toBe(1);
    expect(reexported.manifest.counts.taskMigrationCrosswalks).toBe(1);

    // Exact crosswalks preserved.
    expect(reexported.tasks.taskMigrationCrosswalks).toEqual(
      exported.tasks.taskMigrationCrosswalks,
    );
    expect(reexported.tasks.taskMigrationCrosswalks.map((c) => c.legacyScopeKey)).toEqual([
      "legacy:task-1",
    ]);

    // Task Set identity round-trips with exact counts and crosswalks.
    expect(reexported.manifest.counts.taskSets).toBe(1);
    expect(reexported.manifest.counts.taskSetVersions).toBe(1);
    expect(reexported.manifest.counts.taskSetMaterializations).toBe(1);
    expect(reexported.manifest.counts.taskSetOwnershipCrosswalks).toBe(3);
    expect(reexported.taskSets?.records.map((r) => r.id)).toEqual(["suite-1"]);
    expect(reexported.taskSets?.versions.map((v) => v.version)).toEqual([1]);
    expect(reexported.taskSets?.materializations.map((m) => m.id)).toEqual(["mat-1"]);
    expect(reexported.taskSets?.ownershipCrosswalks.map((c) => c.key).sort()).toEqual(
      exported.taskSets?.ownershipCrosswalks.map((c) => c.key).sort(),
    );
    // Evidence payload round-trips with exact counts and equality.
    expect(reexported.manifest.counts.modelConfigurations).toBe(1);
    expect(reexported.manifest.counts.observations).toBe(1);
    expect(reexported.manifest.counts.evidenceDecisions).toBe(1);
    expect(reexported.manifest.counts.evidenceIndexJobs).toBe(1);
    expect(reexported.manifest.counts.verifierOutcomes).toBe(1);
    expect(reexported.evidence?.modelConfigurations).toEqual(
      exported.evidence?.modelConfigurations,
    );
    expect(reexported.evidence?.observations).toEqual(exported.evidence?.observations);
    expect(reexported.evidence?.evidenceDecisions).toEqual(exported.evidence?.evidenceDecisions);
    expect(reexported.evidence?.evidenceIndexJobs).toEqual(exported.evidence?.evidenceIndexJobs);
    expect(reexported.evidence?.verifierOutcomes).toEqual(exported.evidence?.verifierOutcomes);

    // The seven Fusion collections round-trip byte-stable (semantic equality is
    // already asserted via JSON.stringify above); the Fusion owner crosswalk
    // references the study without altering any Fusion payload.
    expect(reexported.fusion.studies).toEqual(exported.fusion.studies);
    expect(reexported.fusion.observations).toEqual(exported.fusion.observations);
    const fusionOwner = reexported.taskSets?.ownershipCrosswalks.find(
      (c) => c.kind === "fusion-owner",
    );
    expect(fusionOwner?.key).toBe("ts-xwalk:fusion:study-1");
    expect(fusionOwner?.taskSetId).toBe("suite-1");

    // Source Suite/Experiment evidence is semantically unchanged: the
    // target's read-back rows deep-equal the seeded domain records.
    const suiteRow = await target.suites.get("suite-1");
    const experimentRow = await target.experiments.get("exp-1");
    expect(suiteRow?.suite).toEqual(fx.makeSuite("suite-1") as EvaluationSuite);
    expect(experimentRow?.experiment).toEqual(
      fx.makeExperiment("exp-1", "suite-1") as ExperimentRecord,
    );

    // Artifact bytes survive the round trip byte-equal.
    const bytesRow = await target.taskArtifactBytes.get("art-1");
    expect(bytesRow).toBeDefined();
    expect(Array.from(bytesRow!.bytes)).toEqual(
      Array.from(new TextEncoder().encode("candidate-visible artifact text")),
    );
    const artifactSummary = await target.taskArtifacts.get("art-1");
    expect(artifactSummary?.contentDigest).toBe(exported.tasks.taskArtifacts[0].contentDigest);
  });

  it("the v2 envelope is deterministic across two independent exports of the same corpus", async () => {
    const a = await freshDb("det-a");
    const b = await freshDb("det-b");
    await seedCompleteCorpus(a);
    await seedCompleteCorpus(b);

    const ea = await exportWorkbenchArchiveV2(a, { now: DETERMINISTIC_NOW });
    const eb = await exportWorkbenchArchiveV2(b, { now: DETERMINISTIC_NOW });
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(ea.manifest.payloadDigest).toBe(eb.manifest.payloadDigest);
  });
});

// =============================================================================
// 2. Repeated import preserves counts and reuses everything (idempotent)
// =============================================================================

describe("archive v2 integration — repeated import idempotency", () => {
  it("a second and third import of the same archive reuses every entity, writes nothing, and preserves all counts", async () => {
    const source = await freshDb("repeat-src");
    await seedCompleteCorpus(source);
    const archive = await exportWorkbenchArchiveV2(source, { now: DETERMINISTIC_NOW });

    const target = await freshDb("repeat-tgt");
    const preview1 = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    const commit1 = await commitPreviewWorkbenchArchiveV2(target, preview1);
    expect(commit1.created.length).toBeGreaterThan(0);
    expect(commit1.collisions).toEqual([]);

    const countsAfterFirst = await snapshotCounts(target);

    const preview2 = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    expect(preview2.create).toEqual([]);
    expect(preview2.collisions).toEqual([]);
    expect(preview2.invalid).toEqual([]);
    const commit2 = await commitPreviewWorkbenchArchiveV2(target, preview2);
    expect(commit2.created).toEqual([]);
    expect(commit2.reused.length).toBeGreaterThan(0);

    const preview3 = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    const commit3 = await commitPreviewWorkbenchArchiveV2(target, preview3);
    expect(commit3.created).toEqual([]);

    // Counts are stable across repeated imports.
    expect(await snapshotCounts(target)).toEqual(countsAfterFirst);

    // The re-exported envelope is still byte-identical to the original.
    const reexported = await exportWorkbenchArchiveV2(target, { now: DETERMINISTIC_NOW });
    expect(JSON.stringify(reexported)).toBe(JSON.stringify(archive));
  });
});

// =============================================================================
// 3. Repeated seeded legacy startup/reload preserves counts, crosswalks,
//    source evidence, unresolved state, and artifact bytes
// =============================================================================

describe("archive v2 integration — repeated seeded legacy startup/reload", () => {
  it("migrate → reload → migrate is idempotent: counts, crosswalks, source evidence, and marker are stable; no duplicates", async () => {
    const db = await freshDb("legacy-startup");
    await seedLegacySuiteAndExperiment(db);

    const first = await migrateEmbeddedLegacyTasks(db);
    expect(first.complete).toBe(true);
    expect(first).toMatchObject({ migratedScopes: 1, unresolvedDefinitions: 0 });

    const countsAfterFirst = await snapshotCounts(db);
    const crosswalksAfterFirst = (await db.taskMigrationCrosswalk.toArray()).sort((a, b) =>
      a.legacyScopeKey.localeCompare(b.legacyScopeKey),
    );
    const markerAfterFirst = await db.storageMeta.get(canonicalTaskMigrationMarkerKey);
    expect(markerAfterFirst).toBeDefined();
    const sourceSuiteAfterFirst = (await db.suites.get("suite-1"))?.suite;
    const sourceExperimentAfterFirst = (await db.experiments.get("exp-1"))?.experiment;

    // Simulated reload: a second and third startup over the same seeded DB.
    const second = await migrateEmbeddedLegacyTasks(db);
    const third = await migrateEmbeddedLegacyTasks(db);
    expect(second.complete).toBe(true);
    expect(third.complete).toBe(true);
    expect(second).toMatchObject({ createdVersions: 0, crosswalksWritten: 0 });
    expect(third).toMatchObject({ createdVersions: 0, crosswalksWritten: 0 });

    expect(await snapshotCounts(db)).toEqual(countsAfterFirst);
    expect(
      (await db.taskMigrationCrosswalk.toArray()).sort((a, b) =>
        a.legacyScopeKey.localeCompare(b.legacyScopeKey),
      ),
    ).toEqual(crosswalksAfterFirst);
    expect(await db.storageMeta.get(canonicalTaskMigrationMarkerKey)).toBeDefined();

    // Source Suite/Experiment evidence is never rewritten by migration.
    expect((await db.suites.get("suite-1"))?.suite).toEqual(sourceSuiteAfterFirst);
    expect((await db.experiments.get("exp-1"))?.experiment).toEqual(sourceExperimentAfterFirst);

    // Migration never fabricates artifacts/instances for legacy attachments.
    expect(await db.taskArtifacts.count()).toBe(0);
    expect(await db.taskArtifactBytes.count()).toBe(0);
    expect(await db.taskInstances.count()).toBe(0);
  });

  it("unresolved legacy definitions stay explicit and are preserved across repeated startup", async () => {
    const db = await freshDb("legacy-unresolved");
    // A rubric-score-kind evaluation cannot reconstruct an executable
    // definition; migration must leave it unresolved rather than fabricate
    // content.
    const incomplete = {
      id: "broken",
      title: "Broken",
      prompt: "Do something",
      systemPrompt: "",
      evaluation: { kind: "profile" },
      judgeInstructionOverride: "",
      order: 0,
    };
    await db.suites.put({
      id: "suite-c",
      suite: makeLegacySuite("suite-c", [incomplete]),
      revision: 1,
      version: 2,
      updatedAt: 20,
      archivedAt: null,
    });

    const first = await migrateEmbeddedLegacyTasks(db);
    const second = await migrateEmbeddedLegacyTasks(db);
    expect(first).toMatchObject({ migratedScopes: 0, unresolvedDefinitions: 1, complete: true });
    expect(second).toMatchObject({ unresolvedDefinitions: 1, complete: true });
    expect(await db.tasks.count()).toBe(0);
    expect(await db.taskMigrationCrosswalk.count()).toBe(0);

    const marker = await db.storageMeta.get(canonicalTaskMigrationMarkerKey);
    expect(marker).toBeDefined();
    // The marker records the unresolved key explicitly.
    const value = marker!.value as { unresolvedKeys: string[] };
    expect(value.unresolvedKeys.length).toBe(1);
  });
});

// =============================================================================
// 4. Case matrix — clean, v1, corrupt digest/reference, missing artifact,
//    prohibited content, identical reuse, non-identical collision, cancellation,
//    injected failure/quota, storage-blocked
// =============================================================================

describe("archive v2 integration — case matrix", () => {
  // --- clean ------------------------------------------------------------------
  it("clean: a valid fixture previews with zero collisions/invalid and commits atomically", async () => {
    const target = await freshDb("case-clean");
    const archive = recomputeDigest(fx.buildValidArchiveV2Fixture());
    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    expect(preview.format).toBe("v2");
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);
    const commit = await commitPreviewWorkbenchArchiveV2(target, preview);
    expect(commit.collisions).toEqual([]);
    expect(commit.created.length).toBeGreaterThan(0);
  });

  // --- v1 ---------------------------------------------------------------------
  it("v1: a schemaVersion-1 archive dispatches through the preserved v1 adapter via importWorkbenchArchiveAuto", async () => {
    const source = await freshDb("case-v1-src");
    await dbSeedV1Corpus(source);
    const v1 = await exportWorkbenchArchive(source);

    const target = await freshDb("case-v1-tgt");
    const result = await importWorkbenchArchiveAuto(target, v1 as unknown as never);
    expect(result.format).toBe("v1");
    if (result.format === "v1") {
      expect(result.v1.created.length).toBeGreaterThan(0);
    }
    // The v1 import wrote the seeded suite/experiment.
    expect(await target.suites.count()).toBe(1);
    expect(await target.experiments.count()).toBe(1);
  });

  // --- corrupt digest ---------------------------------------------------------
  it("corrupt digest: a tampered artifact contentDigest is rejected at envelope validation before any write", async () => {
    const target = await freshDb("case-digest");
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.tasks.taskArtifacts[0] = {
      ...archive.tasks.taskArtifacts[0],
      contentDigest: "sha256:" + "0".repeat(64),
    };
    recomputeDigest(archive);
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => /content digest mismatch/.test(e.message))).toBe(true);
    await expect(previewWorkbenchArchive(target, archive)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    expect(await snapshotCounts(target)).toEqual(emptyCounts());
  });

  // --- corrupt reference ------------------------------------------------------
  it("corrupt reference: a crosswalk pointing at an unknown task version is rejected before any write", async () => {
    const target = await freshDb("case-ref");
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.tasks.taskMigrationCrosswalks[0] = {
      ...archive.tasks.taskMigrationCrosswalks[0],
      taskVersion: 99,
    };
    recomputeDigest(archive);
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.valid).toBe(false);
    expect(
      check.errors.some((e) => /crosswalk references unknown task version/.test(e.message)),
    ).toBe(true);
    await expect(previewWorkbenchArchive(target, archive)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    expect(await snapshotCounts(target)).toEqual(emptyCounts());
  });

  // --- missing artifact -------------------------------------------------------
  it("missing artifact: an artifact summary with no bytes payload is rejected before any write", async () => {
    const target = await freshDb("case-missing");
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.tasks.taskArtifactBytes = [];
    recomputeDigest(archive);
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => /missing bytes payload/.test(e.message))).toBe(true);
    await expect(previewWorkbenchArchive(target, archive)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    expect(await snapshotCounts(target)).toEqual(emptyCounts());
  });

  // --- prohibited content -----------------------------------------------------
  it("prohibited content: an archive carrying a prohibited credential key is rejected before any write", async () => {
    const target = await freshDb("case-prohibited");
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    // Inject a prohibited key into a structured field (not a real credential).
    const smuggled = archive.fusion.studies[0] as unknown as Record<string, unknown>;
    smuggled.apiKey = "not-a-real-credential";
    recomputeDigest(archive);
    const check = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
    expect(check.valid).toBe(false);
    await expect(previewWorkbenchArchive(target, archive)).rejects.toMatchObject({
      name: "StorageError",
      kind: "validation",
    });
    expect(await snapshotCounts(target)).toEqual(emptyCounts());
  });

  // --- identical reuse --------------------------------------------------------
  it("identical reuse: a canonically identical pre-seeded entity is classified as reuse, not create", async () => {
    const target = await freshDb("case-reuse");
    // Pre-seed one canonically identical suite.
    await target.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
    const archive = recomputeDigest(fx.buildValidArchiveV2Fixture());
    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    const suiteCreate = preview.create.filter((c) => c.collection === "suites");
    const suiteReuse = preview.reuse.filter((c) => c.collection === "suites");
    expect(suiteCreate).toEqual([]);
    expect(suiteReuse.map((r) => r.key)).toEqual(["suite-1"]);
    const commit = await commitPreviewWorkbenchArchiveV2(target, preview);
    // The pre-seeded suite row is reused, not created. (The same key "suite-1"
    // is legitimately CREATED in taskSets.records — a different store — so the
    // suites store must still hold exactly the one pre-seeded row.)
    expect(await target.suites.count()).toBe(1);
    expect(commit.reused).toContain("suite-1");
    // The pre-seeded suite content is unchanged (no overwrite).
    expect((await target.suites.get("suite-1"))?.suite).toEqual(fx.makeSuite("suite-1"));
  });

  // --- non-identical collision ------------------------------------------------
  it("non-identical collision: a same-ID different-content suite aborts the commit BEFORE any write", async () => {
    const target = await freshDb("case-collision");
    await target.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
    // Mutate the incoming suite so the same ID is NOT canonically identical.
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.suites[0] = { ...archive.suites[0], name: "different name" };
    recomputeDigest(archive);

    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    expect(preview.collisions.some((c) => c.collection === "suites" && c.key === "suite-1")).toBe(
      true,
    );
    await expect(commitPreviewWorkbenchArchiveV2(target, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "conflict",
    });
    // The pre-seeded suite is left unchanged — no overwrite, no partial import.
    expect((await target.suites.get("suite-1"))?.suite).toEqual(fx.makeSuite("suite-1"));
    // Nothing else was written.
    expect(await target.runSummaries.count()).toBe(0);
    expect(await target.tasks.count()).toBe(0);
  });

  // --- cancellation -----------------------------------------------------------
  it("cancellation: an abort signal before commit leaves source and target unchanged and throws the cancellation error", async () => {
    const target = await freshDb("case-cancel");
    const archive = recomputeDigest(fx.buildValidArchiveV2Fixture());
    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      commitPreviewWorkbenchArchiveV2(target, preview, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ArchiveImportCancelledError);
    expect(await snapshotCounts(target)).toEqual(emptyCounts());
  });

  // --- injected failure/quota --------------------------------------------------
  it("injected failure: a mid-commit put rejection rolls the whole transaction back — nothing is written", async () => {
    const target = await freshDb("case-failure");
    const archive = recomputeDigest(fx.buildValidArchiveV2Fixture());
    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    // Inject a failure during the experiments phase, which is early in the
    // commit transaction; the entire 23-store transaction must roll back.
    vi.spyOn(target.experiments, "put").mockRejectedValueOnce(new Error("boom"));
    await expect(commitPreviewWorkbenchArchiveV2(target, preview)).rejects.toBeTruthy();
    // Nothing was committed.
    expect(await target.runSummaries.count()).toBe(0);
    expect(await target.suites.count()).toBe(0);
    expect(await target.tasks.count()).toBe(0);
    expect(await target.taskMigrationCrosswalk.count()).toBe(0);
  });

  it("injected quota: a quota-classified failure rolls back and is reported as a StorageError", async () => {
    const target = await freshDb("case-quota");
    const archive = recomputeDigest(fx.buildValidArchiveV2Fixture());
    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    const quota = new Error("QuotaExceededError");
    (quota as Error & { name: string }).name = "QuotaExceededError";
    vi.spyOn(target.fusionStudies, "put").mockRejectedValueOnce(quota);
    const err = await commitPreviewWorkbenchArchiveV2(target, preview).catch((e) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(await target.fusionStudies.count()).toBe(0);
    expect(await target.tasks.count()).toBe(0);
  });

  // --- storage-blocked --------------------------------------------------------
  it("storage-blocked: a blocked DB aborts the commit before any write with a blocked StorageError", async () => {
    const target = await freshDb("case-blocked");
    const archive = recomputeDigest(fx.buildValidArchiveV2Fixture());
    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    target.setState("blocked");
    await expect(commitPreviewWorkbenchArchiveV2(target, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "blocked",
    });
    expect(await snapshotCounts(target)).toEqual(emptyCounts());
  });
});

// =============================================================================
// 5. Task Set identity (Child 03 Task 11)
// =============================================================================

describe("archive v2 integration — Task Set identity", () => {
  it("earlier-v2 envelope without the taskSets key still imports with zero new-collection writes", async () => {
    const source = await freshDb("ts-earlier-src");
    await seedCompleteCorpus(source);
    const exported = await exportWorkbenchArchiveV2(source, { now: DETERMINISTIC_NOW });
    // Simulate an earlier-v2 producer that never emitted taskSets.
    delete (exported as unknown as Record<string, unknown>).taskSets;
    exported.manifest.counts.taskSets = 0;
    exported.manifest.counts.taskSetVersions = 0;
    exported.manifest.counts.taskSetMaterializations = 0;
    exported.manifest.counts.taskSetOwnershipCrosswalks = 0;
    exported.manifest.payloadDigest = computeArchiveV2PayloadDigest(exported);

    const target = await freshDb("ts-earlier-tgt");
    const preview = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
    expect(preview.format).toBe("v2");
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);
    await commitPreviewWorkbenchArchiveV2(target, preview);
    // No Task Set rows were written.
    expect(await target.taskSets.count()).toBe(0);
    expect(await target.taskSetVersions.count()).toBe(0);
    expect(await target.taskSetMaterializations.count()).toBe(0);
    expect(await target.taskSetOwnershipCrosswalk.count()).toBe(0);
  });

  it("v1 import writes no Task Set rows", async () => {
    const source = await freshDb("ts-v1-src");
    await dbSeedV1Corpus(source);
    const v1 = await exportWorkbenchArchive(source);
    const target = await freshDb("ts-v1-tgt");
    await importWorkbenchArchiveAuto(target, v1 as unknown as never);
    expect(await target.taskSets.count()).toBe(0);
    expect(await target.taskSetVersions.count()).toBe(0);
    expect(await target.taskSetMaterializations.count()).toBe(0);
    expect(await target.taskSetOwnershipCrosswalk.count()).toBe(0);
  });

  it("non-identical same-key Task Set record aborts the commit BEFORE any write", async () => {
    const target = await freshDb("ts-collision");
    await target.taskSets.put(fx.taskSetRecordRow(fx.makeTaskSetRecord("suite-1")));
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.taskSets!.records[0] = {
      ...archive.taskSets!.records[0],
      name: "different task set name",
    };
    recomputeDigest(archive);

    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    expect(
      preview.collisions.some((c) => c.collection === "taskSets.records" && c.key === "suite-1"),
    ).toBe(true);
    await expect(commitPreviewWorkbenchArchiveV2(target, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "conflict",
    });
    // The pre-seeded Task Set record is unchanged; nothing else was written.
    expect((await target.taskSets.get("suite-1"))?.record).toEqual(fx.makeTaskSetRecord("suite-1"));
    expect(await target.runSummaries.count()).toBe(0);
  });
});
// =============================================================================
// 6. Evidence payload (Child 04 Task 12)
// =============================================================================

describe("archive v2 integration — Evidence payload", () => {
  it("earlier-v2 envelope without the evidence key still imports with zero new-collection writes", async () => {
    const source = await freshDb("ev-earlier-src");
    await seedCompleteCorpus(source);
    const exported = await exportWorkbenchArchiveV2(source, { now: DETERMINISTIC_NOW });
    // Simulate an earlier-v2 producer that never emitted evidence.
    delete (exported as unknown as Record<string, unknown>).evidence;
    exported.manifest.counts.modelConfigurations = 0;
    exported.manifest.counts.observations = 0;
    exported.manifest.counts.evidenceDecisions = 0;
    exported.manifest.counts.evidenceIndexJobs = 0;
    exported.manifest.counts.verifierOutcomes = 0;
    exported.manifest.payloadDigest = computeArchiveV2PayloadDigest(exported);

    const target = await freshDb("ev-earlier-tgt");
    const preview = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
    expect(preview.format).toBe("v2");
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);
    await commitPreviewWorkbenchArchiveV2(target, preview);
    // No Evidence rows were written.
    expect(await target.modelConfigurations.count()).toBe(0);
    expect(await target.observations.count()).toBe(0);
    expect(await target.evidenceDecisions.count()).toBe(0);
    expect(await target.evidenceIndexJobs.count()).toBe(0);
    expect(await target.verifierOutcomes.count()).toBe(0);
  });

  it("v1 import writes no Evidence rows", async () => {
    const source = await freshDb("ev-v1-src");
    await dbSeedV1Corpus(source);
    const v1 = await exportWorkbenchArchive(source);
    const target = await freshDb("ev-v1-tgt");
    await importWorkbenchArchiveAuto(target, v1 as unknown as never);
    expect(await target.modelConfigurations.count()).toBe(0);
    expect(await target.observations.count()).toBe(0);
    expect(await target.evidenceDecisions.count()).toBe(0);
    expect(await target.evidenceIndexJobs.count()).toBe(0);
    expect(await target.verifierOutcomes.count()).toBe(0);
  });

  it("non-identical same-key ModelConfiguration record aborts the commit BEFORE any write", async () => {
    const target = await freshDb("ev-mc-collision");
    const mc = fx.makeModelConfiguration();
    await target.modelConfigurations.put(fx.modelConfigurationRow(mc));
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.evidence!.modelConfigurations[0] = {
      ...archive.evidence!.modelConfigurations[0],
      requestedModel: "anthropic/claude-3-opus", // different content at same ID
    };
    recomputeDigest(archive);

    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    expect(
      preview.collisions.some(
        (c) => c.collection === "evidence.modelConfigurations" && c.key === mc.id,
      ),
    ).toBe(true);
    await expect(commitPreviewWorkbenchArchiveV2(target, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "conflict",
    });
    // The pre-seeded record is unchanged; nothing else was written.
    expect((await target.modelConfigurations.get(mc.id))?.snapshot).toEqual(mc);
    expect(await target.runSummaries.count()).toBe(0);
  });

  it("non-identical same-key Observation record aborts the commit BEFORE any write", async () => {
    const target = await freshDb("ev-obs-collision");
    const mc = fx.makeModelConfiguration();
    const obs = fx.makeEvidenceObservation(mc.id);
    await target.observations.put(fx.evidenceObservationRow(obs));
    const archive = fx.cloneArchiveV2(fx.buildValidArchiveV2Fixture());
    archive.evidence!.observations[0] = {
      ...archive.evidence!.observations[0],
      outcome: {
        ...archive.evidence!.observations[0].outcome,
        overallScore: 2.0, // different content with same source key and same ID
      },
    };
    recomputeDigest(archive);

    const preview = await previewWorkbenchArchive(target, archive, { sourceLabel: "memory" });
    expect(
      preview.collisions.some((c) => c.collection === "evidence.observations" && c.key === obs.id),
    ).toBe(true);
    await expect(commitPreviewWorkbenchArchiveV2(target, preview)).rejects.toMatchObject({
      name: "StorageError",
      kind: "conflict",
    });
    expect(await target.runSummaries.count()).toBe(0);
  });

  it("Fusion fusionObservations round-trip byte-stable without conversion or ID collision with canonical observations", async () => {
    const source = await freshDb("ev-fusion-iso-src");
    await seedCompleteCorpus(source);
    const exported = await exportWorkbenchArchiveV2(source, { now: DETERMINISTIC_NOW });

    // Verify disjoint ID namespaces and separate payload collections.
    expect(exported.fusion.observations[0].id).toBe("obs-1");
    expect(exported.evidence?.observations[0].id).toMatch(/^obs:sha256:[0-9a-f]{64}$/);
    expect(exported.fusion.observations[0].id).not.toEqual(exported.evidence?.observations[0].id);

    const target = await freshDb("ev-fusion-iso-tgt");
    const preview = await previewWorkbenchArchive(target, exported, { sourceLabel: "memory" });
    await commitPreviewWorkbenchArchiveV2(target, preview);

    // Verify stored tables are completely isolated.
    const fusionObs = await target.fusionObservations.toArray();
    const canonicalObs = await target.observations.toArray();
    expect(fusionObs.length).toBe(1);
    expect(canonicalObs.length).toBe(1);
    expect(fusionObs[0].id).toBe("obs-1");
    expect(canonicalObs[0].id).toMatch(/^obs:sha256:[0-9a-f]{64}$/);
  });
});

// =============================================================================
// Helpers — legacy seeding, v1 corpus, count snapshots
// =============================================================================

function makeLegacySuite(id: string, tasks: Array<Record<string, unknown>>): EvaluationSuite {
  return {
    id,
    revision: 1,
    version: 2,
    name: `Suite ${id}`,
    description: "",
    tasks: tasks as unknown as EvaluationSuite["tasks"],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 10,
    updatedAt: 20,
    archivedAt: null,
  };
}

function makeLegacyExperiment(suiteId: string): ExperimentRecord {
  const suite = makeLegacySuite(suiteId, [
    {
      id: "task-1",
      title: "Summarize",
      prompt: "Summarize the passage.",
      systemPrompt: "Use three bullets.",
      evaluation: { kind: "inherit" },
      judgeInstructionOverride: "Judge clarity.",
      order: 0,
    },
  ]);
  return {
    id: "exp-1",
    revision: 1,
    suiteId,
    suiteVersion: 1,
    protocolFingerprint: "sha256:fp",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId,
      suiteVersion: 1,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:fp",
      createdAt: 15,
    },
    tasks: [],
    createdAt: 15,
    updatedAt: 15,
  };
}

async function seedLegacySuiteAndExperiment(db: RSembleEvaluationDB): Promise<void> {
  const suite = makeLegacySuite("suite-1", [
    {
      id: "task-1",
      title: "Summarize",
      prompt: "Summarize the passage.",
      systemPrompt: "Use three bullets.",
      evaluation: { kind: "inherit" },
      judgeInstructionOverride: "Judge clarity.",
      order: 0,
    },
  ]);
  await db.suites.put({
    id: suite.id,
    suite,
    revision: 1,
    version: suite.version,
    updatedAt: 20,
    archivedAt: null,
  });
  const experiment = makeLegacyExperiment("suite-1");
  await db.experiments.put({
    id: experiment.id,
    experiment,
    revision: 1,
    suiteId: experiment.suiteId,
    suiteVersion: experiment.suiteVersion,
    protocolFingerprint: experiment.protocolFingerprint,
    createdAt: experiment.createdAt,
    status: experiment.status,
  });
}

async function dbSeedV1Corpus(db: RSembleEvaluationDB): Promise<void> {
  await db.runSummaries.put(fx.runSummaryRow(fx.makeRunSummary("run-1")));
  await db.runDetails.put(fx.runDetailRow(fx.makeRunDetail("run-1")));
  await db.profiles.put(fx.profileRow(fx.makeRubricRecord("rubric-1")));
  await db.profileVersions.put(fx.profileVersionRow(fx.makeRubricVersion("rubric-1", 1)));
  await db.suites.put(fx.suiteRow(fx.makeSuite("suite-1")));
  await db.experiments.put(fx.experimentRow(fx.makeExperiment("exp-1", "suite-1")));
}

interface CountSnapshot {
  runSummaries: number;
  runDetails: number;
  suites: number;
  experiments: number;
  fusionStudies: number;
  tasks: number;
  taskVersions: number;
  taskArtifacts: number;
  taskArtifactBytes: number;
  taskInstances: number;
  taskMigrationCrosswalk: number;
  modelConfigurations: number;
  observations: number;
  evidenceDecisions: number;
  evidenceIndexJobs: number;
  verifierOutcomes: number;
}

async function snapshotCounts(db: RSembleEvaluationDB): Promise<CountSnapshot> {
  return {
    runSummaries: await db.runSummaries.count(),
    runDetails: await db.runDetails.count(),
    suites: await db.suites.count(),
    experiments: await db.experiments.count(),
    fusionStudies: await db.fusionStudies.count(),
    tasks: await db.tasks.count(),
    taskVersions: await db.taskVersions.count(),
    taskArtifacts: await db.taskArtifacts.count(),
    taskArtifactBytes: await db.taskArtifactBytes.count(),
    taskInstances: await db.taskInstances.count(),
    taskMigrationCrosswalk: await db.taskMigrationCrosswalk.count(),
    modelConfigurations: await db.modelConfigurations.count(),
    observations: await db.observations.count(),
    evidenceDecisions: await db.evidenceDecisions.count(),
    evidenceIndexJobs: await db.evidenceIndexJobs.count(),
    verifierOutcomes: await db.verifierOutcomes.count(),
  };
}

function emptyCounts(): CountSnapshot {
  return {
    runSummaries: 0,
    runDetails: 0,
    suites: 0,
    experiments: 0,
    fusionStudies: 0,
    tasks: 0,
    taskVersions: 0,
    taskArtifacts: 0,
    taskArtifactBytes: 0,
    taskInstances: 0,
    taskMigrationCrosswalk: 0,
    modelConfigurations: 0,
    observations: 0,
    evidenceDecisions: 0,
    evidenceIndexJobs: 0,
    verifierOutcomes: 0,
  };
}
