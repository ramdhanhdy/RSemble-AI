// @vitest-environment node
// =============================================================================
// RSemble AI — Archive v3 integration tests (Child 06 Task 11, REV-1 / REV-2 / REV-3)
//
// Proves that Archive v3 and the post-v13 persistence model demonstrably
// describe the same canonical state (REV-1). Round-trips every surviving Child 06
// entity class:
//   - Lab Recipes (records and immutable versions)
//   - Model Pools (records and immutable versions)
//   - Policy Studies (StudyRecord with typed definition)
//   - Study Trials (StudyTrial with typed payload)
//   - Study Attempts (treatment-changing lineage)
//   - Study Observations (terminal measurements)
//   - Policy Playbooks (PolicyReportPayload)
//   - Canonical Tasks (records, versions, artifacts + bytes, instances, families,
//     assignments, relations, annotations, crosswalks)
//   - Task Sets (records, versions, materializations, ownership crosswalks)
//   - Referenced Exact Evidence (model configurations, observations, decisions,
//     index jobs, verifier outcomes)
//   - Comparisons (summary-only indexes, snapshot metadata, limitations)
//   - Runs (summaries and details), Rubrics, Suites, Experiments.
//
// Also proves:
//   - Byte/digest identity across export → fresh-DB import → re-export
//   - Tested count reconciliation across every Dexie table
//   - REV-2: The seven deleted stores never reappear
//   - REV-3: Deterministic rejection of legacy Fusion shapes before writes
//   - Collision rejection (different content on same key aborts before writes)
//   - Non-Fusion v2 and v1 archives remain cleanly importable
// =============================================================================

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_V3_FORMAT_VERSION,
  computeArchiveV3PayloadDigest,
  validateArchiveV3,
  type WorkbenchArchiveV3,
} from "./archive-v3-types";
import { seedCompleteV3Corpus, makePolicyStudyRecord } from "./archive-v3-fixtures";
import * as fx from "./archive-v2-fixtures";
import {
  commitPreviewWorkbenchArchiveV3,
  exportWorkbenchArchiveV3,
  importWorkbenchArchiveAuto,
  previewWorkbenchArchive,
} from "./archive";
import { RSembleEvaluationDB, createDatabase } from "./database";
import {
  getFusionToResearchLabReceipt,
  fusionToResearchLabReceiptKey,
} from "../migrations/fusion-to-research-lab";
import { createDeterministicReceipt } from "../migrations/fusion-to-research-lab-receipt";

const DETERMINISTIC_NOW = 1_700_000_000_000;

async function freshDb(name: string): Promise<RSembleEvaluationDB> {
  const db = new RSembleEvaluationDB(`v3-test-${name}-${Math.random().toString(36).slice(2)}`);
  await db.open();
  return db;
}

const EMPTY_FUSION_COUNTS = {
  fusionRecipes: 0,
  poolManifests: 0,
  fusionStudies: 0,
  fusionTrials: 0,
  fusionAttempts: 0,
  fusionObservations: 0,
  fusionPlaybooks: 0,
} as const;

const EMPTY_CONVERTED_COUNTS = {
  labRecipeRecords: 0,
  labRecipeVersions: 0,
  modelPoolRecords: 0,
  modelPoolVersions: 0,
  studies: 0,
  studyTrials: 0,
  studyAttempts: 0,
  studyObservations: 0,
  policyPlaybooks: 0,
} as const;

async function productionFreshInstall(tag: string) {
  const handle = createDatabase(`v3-prod-${tag}-${Math.random().toString(36).slice(2)}`);
  await handle.ready;
  return handle;
}

describe("archive v3 integration — complete canonical corpus round trip (REV-1)", () => {
  it("export → fresh-DB import → re-export is byte/digest identical with exact counts and full entity reconciliation", async () => {
    const source = await freshDb("source");
    await seedCompleteV3Corpus(source);

    // Export from populated database
    const exported = await exportWorkbenchArchiveV3(source, { now: DETERMINISTIC_NOW });
    const validation = validateArchiveV3(JSON.parse(JSON.stringify(exported)));
    expect(validation.valid).toBe(true);
    expect(exported.manifest.formatVersion).toBe(ARCHIVE_V3_FORMAT_VERSION);

    // Import into a FRESH database with zero prior state
    const target = await freshDb("target");
    const preview = await previewWorkbenchArchive(target, exported, {
      sourceLabel: "source-v3.json",
    });
    expect(preview.format).toBe("v3");
    expect(preview.collisions).toEqual([]);
    expect(preview.invalid).toEqual([]);
    expect(preview.create.length).toBeGreaterThan(0);

    const commitResult = await commitPreviewWorkbenchArchiveV3(target, preview);
    expect(commitResult.created.length).toBe(preview.create.length);
    expect(commitResult.collisions).toEqual([]);

    // Re-export target with the same deterministic timestamp
    const reexported = await exportWorkbenchArchiveV3(target, { now: DETERMINISTIC_NOW });
    expect(JSON.stringify(reexported)).toBe(JSON.stringify(exported));
    expect(reexported.manifest.payloadDigest).toBe(exported.manifest.payloadDigest);

    // Verify tested reconciliation: exact counts match across all Dexie tables
    expect(reexported.manifest.counts).toEqual(exported.manifest.counts);
    expect(await target.labRecipeRecords.count()).toBe(reexported.manifest.counts.labRecipeRecords);
    expect(await target.labRecipeVersions.count()).toBe(
      reexported.manifest.counts.labRecipeVersions,
    );
    expect(await target.modelPoolRecords.count()).toBe(reexported.manifest.counts.modelPoolRecords);
    expect(await target.modelPoolVersions.count()).toBe(
      reexported.manifest.counts.modelPoolVersions,
    );
    expect(await target.studies.count()).toBe(reexported.manifest.counts.studies);
    expect(await target.studyTrials.count()).toBe(reexported.manifest.counts.studyTrials);
    expect(await target.studyAttempts.count()).toBe(reexported.manifest.counts.studyAttempts);
    expect(await target.studyObservations.count()).toBe(
      reexported.manifest.counts.studyObservations,
    );
    expect(await target.policyPlaybooks.count()).toBe(reexported.manifest.counts.policyPlaybooks);

    // Evidence & task tables
    expect(await target.modelConfigurations.count()).toBe(
      reexported.manifest.counts.modelConfigurations,
    );
    expect(await target.observations.count()).toBe(reexported.manifest.counts.evidenceObservations);
    expect(await target.evidenceDecisions.count()).toBe(
      reexported.manifest.counts.evidenceDecisions,
    );
    expect(await target.evidenceIndexJobs.count()).toBe(
      reexported.manifest.counts.evidenceIndexJobs,
    );
    expect(await target.verifierOutcomes.count()).toBe(reexported.manifest.counts.verifierOutcomes);
    expect(await target.comparisonResults.count()).toBe(
      reexported.manifest.counts.comparisonIndexes,
    );
    expect(await target.tasks.count()).toBe(reexported.manifest.counts.tasks);
    expect(await target.taskVersions.count()).toBe(reexported.manifest.counts.taskVersions);
    expect(await target.taskArtifacts.count()).toBe(reexported.manifest.counts.taskArtifacts);
    expect(await target.taskArtifactBytes.count()).toBe(
      reexported.manifest.counts.taskArtifactBytes,
    );
    expect(await target.taskSets.count()).toBe(reexported.manifest.counts.taskSetRecords);
    expect(await target.taskSetVersions.count()).toBe(reexported.manifest.counts.taskSetVersions);
    expect(await target.runSummaries.count()).toBe(reexported.manifest.counts.runSummaries);
    expect(await target.runDetails.count()).toBe(reexported.manifest.counts.runDetails);

    source.close();
    target.close();
  });
});

describe("archive v3 integration — persisted playbook identity and cutover receipt", () => {
  it("round-trips a content-addressed playbook row id, a completed reportRef, and the v13 cutover receipt", async () => {
    const source = await freshDb("playbook-identity-and-receipt-source");
    const seeded = await seedCompleteV3Corpus(source);
    const playbookId = "pb:sha256:" + "f".repeat(64);
    expect(seeded.lab.playbooks[0]?.id).toBe(playbookId);
    expect(seeded.lab.studies[0]?.reportRef).toBe(playbookId);

    const exported = await exportWorkbenchArchiveV3(source, { now: DETERMINISTIC_NOW });
    expect(exported.lab.playbooks).toContainEqual(
      expect.objectContaining({
        id: playbookId,
        playbook: expect.objectContaining({ studyId: "study-1" }),
      }),
    );
    expect(exported.lab.studies.find((s) => s.id === "study-1")?.reportRef).toBe(playbookId);
    expect(exported.lab.cutoverReceipt).toEqual(seeded.lab.cutoverReceipt);
    expect(exported.manifest.counts.fusionToResearchLabReceipts).toBe(1);

    const target = await freshDb("playbook-identity-and-receipt-target");
    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.invalid).toEqual([]);
    await commitPreviewWorkbenchArchiveV3(target, preview);
    expect((await target.studies.get("study-1"))?.record).toMatchObject({ reportRef: playbookId });
    expect((await target.policyPlaybooks.get(playbookId))?.studyId).toBe("study-1");
    expect(await getFusionToResearchLabReceipt(target)).toEqual(seeded.lab.cutoverReceipt);

    source.close();
    target.close();
  });

  it("refuses to export a v13 database that has no cutover receipt", async () => {
    const db = await freshDb("missing-receipt");
    await expect(exportWorkbenchArchiveV3(db, { now: DETERMINISTIC_NOW })).rejects.toThrow(
      /cutover receipt/,
    );
    db.close();
  });

  it("replaces a production fresh-install bootstrap receipt when the target is otherwise pristine", async () => {
    const source = await freshDb("bootstrap-replace-source");
    const seeded = await seedCompleteV3Corpus(source);
    const live = await source.studies.get("study-1");
    if (!live) throw new Error("seeded study-1 missing");
    const archivedRecord = {
      ...(live.record as Record<string, unknown>),
      status: "archived",
      archivedAt: 2_000,
    };
    await source.studies.put({
      ...live,
      record: archivedRecord,
      status: "archived",
      archivedAt: 2_000,
    });
    const exported = await exportWorkbenchArchiveV3(source, { now: DETERMINISTIC_NOW });
    expect(exported.lab.studies[0]?.status).toBe("archived");
    expect(exported.lab.studies[0]?.reportRef).toBe("pb:sha256:" + "f".repeat(64));

    const handle = await productionFreshInstall("bootstrap-replace-target");
    const target = handle.db;
    const bootstrap = await getFusionToResearchLabReceipt(target);
    expect(bootstrap).not.toBeNull();
    expect(bootstrap).not.toEqual(exported.lab.cutoverReceipt);
    expect(await target.studies.count()).toBe(0);

    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.collisions).toEqual([]);
    expect(
      preview.create.some(
        (c) => c.collection === "lab.cutoverReceipt" && c.key === fusionToResearchLabReceiptKey,
      ),
    ).toBe(true);

    const commit = await commitPreviewWorkbenchArchiveV3(target, preview);
    expect(commit.created).toContain(fusionToResearchLabReceiptKey);
    expect(await getFusionToResearchLabReceipt(target)).toEqual(seeded.lab.cutoverReceipt);
    expect((await target.studies.get("study-1"))?.record).toMatchObject({
      status: "archived",
      archivedAt: 2_000,
      reportRef: "pb:sha256:" + "f".repeat(64),
    });

    const reuse = await previewWorkbenchArchive(target, exported);
    expect(reuse.collisions).toEqual([]);
    expect(
      reuse.reuse.some(
        (c) => c.collection === "lab.cutoverReceipt" && c.key === fusionToResearchLabReceiptKey,
      ),
    ).toBe(true);

    source.close();
    target.close();
  });

  it("rejects a byte-different meaningful cutover receipt even on an empty target", async () => {
    const source = await freshDb("receipt-collision-source");
    await seedCompleteV3Corpus(source);
    const exported = await exportWorkbenchArchiveV3(source, { now: DETERMINISTIC_NOW });

    const target = await freshDb("receipt-collision-target");
    const storedReceipt = createDeterministicReceipt({
      generatedAt: 2000,
      sourceCounts: { ...EMPTY_FUSION_COUNTS, fusionStudies: 1 },
      convertedCounts: { ...EMPTY_CONVERTED_COUNTS, studies: 1 },
      discardedCounts: EMPTY_FUSION_COUNTS,
      decisions: [{ store: "fusionStudies", id: "legacy-study-1", status: "lossless_convert" }],
    });
    await target.storageMeta.put({
      key: fusionToResearchLabReceiptKey,
      value: storedReceipt,
    });

    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.collisions.some((c) => c.collection === "lab.cutoverReceipt")).toBe(true);
    await expect(commitPreviewWorkbenchArchiveV3(target, preview)).rejects.toThrow(/collision/i);
    expect(await getFusionToResearchLabReceipt(target)).toEqual(storedReceipt);

    source.close();
    target.close();
  });

  it("rejects replacing a bootstrap receipt when the production target already has workbench rows", async () => {
    const source = await freshDb("bootstrap-dirty-source");
    await seedCompleteV3Corpus(source);
    const exported = await exportWorkbenchArchiveV3(source, { now: DETERMINISTIC_NOW });

    const handle = await productionFreshInstall("bootstrap-dirty-target");
    const target = handle.db;
    const bootstrap = await getFusionToResearchLabReceipt(target);
    expect(bootstrap).not.toBeNull();
    const local = makePolicyStudyRecord("local-study");
    local.status = "draft";
    local.reportRef = null;
    await target.studies.put({
      id: local.id,
      record: local,
      kind: local.kind,
      status: local.status,
      claimLevel: local.claimLevel,
      confirmationOf: local.confirmationOf,
      revision: local.revision,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
      archivedAt: local.archivedAt,
    });

    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.collisions.some((c) => c.collection === "lab.cutoverReceipt")).toBe(true);
    await expect(commitPreviewWorkbenchArchiveV3(target, preview)).rejects.toThrow(/collision/i);
    expect(await getFusionToResearchLabReceipt(target)).toEqual(bootstrap);

    source.close();
    target.close();
  });
});

describe("archive v3 integration — REV-2 deleted stores stay deleted", () => {
  it("v3 export contains no fusion keys and touches only surviving tables", async () => {
    const db = await freshDb("v3-stores");
    await seedCompleteV3Corpus(db);
    const exported = await exportWorkbenchArchiveV3(db, { now: DETERMINISTIC_NOW });

    const raw = JSON.parse(JSON.stringify(exported)) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("fusion");
    expect(raw).not.toHaveProperty("fusionRecipes");
    expect(raw).not.toHaveProperty("fusionStudies");
    expect(raw).not.toHaveProperty("fusionPlaybooks");

    const manifestCounts = exported.manifest.counts as unknown as Record<string, number>;
    expect(manifestCounts).not.toHaveProperty("fusionRecipes");
    expect(manifestCounts).not.toHaveProperty("fusionStudies");
    expect(manifestCounts).not.toHaveProperty("fusionPlaybooks");

    db.close();
  });
});

describe("archive v3 integration — REV-3 deterministic legacy fusion rejection", () => {
  it("rejects v2 archive with fusion collections before any writes, providing a receipt", async () => {
    const db = await freshDb("legacy-reject");
    const legacyArchive = {
      manifest: {
        formatVersion: 2,
        storageVersion: 1,
        exportedAt: 1000,
        producer: "rsemble-ai",
        counts: {
          runSummaries: 1,
          runDetails: 1,
          rubricIdentities: 0,
          rubricVersions: 0,
          suites: 1,
          experiments: 0,
          fusionRecipes: 1,
          fusionStudies: 1,
          taskRecords: 0,
          taskVersions: 0,
          taskArtifacts: 0,
          taskArtifactBytes: 0,
          taskInstances: 0,
          taskFamilies: 0,
          taskFamilyAssignments: 0,
          taskFamilyRelations: 0,
          taskFacetAnnotations: 0,
          taskMigrationCrosswalks: 0,
        },
        payloadDigest: "sha256:abcd",
        disclosure: { scope: "local", notes: null },
      },
      runs: { summaries: [{ id: "r1", kind: "full" }], details: [{ id: "r1", schemaVersion: 2 }] },
      rubrics: { identities: [], versions: [] },
      suites: [{ id: "s1", revision: 1, version: 1, tasks: [], modelSlots: [] }],
      experiments: [],
      fusion: {
        recipes: [{ id: "rec-1", version: 1 }],
        poolManifests: [],
        studies: [{ id: "study-1", revision: 1 }],
        trials: [],
        attempts: [],
        observations: [],
        playbooks: [],
      },
      tasks: {
        tasks: [],
        taskVersions: [],
        taskArtifacts: [],
        taskArtifactBytes: [],
        taskInstances: [],
        taskFamilies: [],
        taskFamilyAssignments: [],
        taskFamilyRelations: [],
        taskFacetAnnotations: [],
        taskMigrationCrosswalks: [],
      },
    };

    const preview = await previewWorkbenchArchive(db, legacyArchive, {
      sourceLabel: "legacy.json",
    });
    expect(preview.format).toBe("unsupported_fusion_archive_shape");
    expect(preview.unsupportedReceipt).toBeDefined();
    expect(preview.unsupportedReceipt!.rejectedCollections).toContain("fusionRecipes");
    expect(preview.unsupportedReceipt!.rejectedCollections).toContain("fusionStudies");

    // Zero writes occurred
    expect(await db.suites.count()).toBe(0);
    expect(await db.runDetails.count()).toBe(0);

    // Auto import fails before writes
    await expect(importWorkbenchArchiveAuto(db, legacyArchive)).rejects.toThrow(
      /unsupported_fusion_archive_shape|retired Fusion Study collections/i,
    );
    expect(await db.suites.count()).toBe(0);

    db.close();
  });

  it("still imports valid non-fusion v2 archives cleanly", async () => {
    const db = await freshDb("non-fusion-v2");
    const nonFusionV2 = fx.buildValidNonFusionArchiveV2Fixture();
    const preview = await previewWorkbenchArchive(db, nonFusionV2, { sourceLabel: "nf.json" });
    expect(preview.format).toBe("v2");
    expect(preview.create.some((c) => c.key === "suite-1")).toBe(true);

    db.close();
  });
});

describe("archive v3 integration — collision rejection and idempotency", () => {
  it("re-importing the identical v3 archive classifies all entities as reuse with 0 collisions", async () => {
    const db = await freshDb("idempotent");
    await seedCompleteV3Corpus(db);
    const exported = await exportWorkbenchArchiveV3(db, { now: DETERMINISTIC_NOW });

    const preview = await previewWorkbenchArchive(db, exported);
    expect(preview.format).toBe("v3");
    expect(preview.create.length).toBe(0);
    expect(preview.reuse.length).toBeGreaterThan(0);
    expect(preview.collisions.length).toBe(0);

    const commitResult = await commitPreviewWorkbenchArchiveV3(db, preview);
    expect(commitResult.created.length).toBe(0);
    expect(commitResult.reused.length).toBe(preview.reuse.length);

    db.close();
  });

  it("colliding record with different content is classified as collision and not overwritten", async () => {
    const db = await freshDb("collision");
    await seedCompleteV3Corpus(db);
    const exported = await exportWorkbenchArchiveV3(db, { now: DETERMINISTIC_NOW });

    // Modify a study in the archive
    const modified = JSON.parse(JSON.stringify(exported)) as WorkbenchArchiveV3;
    modified.lab.studies[0].title = "Modified Colliding Title";
    modified.manifest.payloadDigest = computeArchiveV3PayloadDigest(modified);

    const preview = await previewWorkbenchArchive(db, modified);
    expect(preview.format).toBe("v3");
    expect(preview.collisions.some((c) => c.key === modified.lab.studies[0].id)).toBe(true);

    await expect(commitPreviewWorkbenchArchiveV3(db, preview)).rejects.toThrow(/collision/i);
    // Existing record unchanged in database
    const stored = await db.studies.get(modified.lab.studies[0].id);
    expect(stored).toBeDefined();
    expect((stored!.record as { title: string }).title).not.toBe("Modified Colliding Title");

    db.close();
  });
});
