// @vitest-environment node
// =============================================================================
// RSemble AI — T13b adversarial QA: REV-9 zero provider egress
//
// Independent of the T13a author. Probes, not product code.
//
// REV-9 claim (plan Task 13): archive v3 export/import AND the Fusion→Lab
// migration operations cause zero provider egress (also covers REV-4).
//
// This probe instruments every registered provider method (readiness,
// testConnection, chatCompletion, chatCompletionStream), global fetch, and
// XMLHttpRequest, then runs:
//   1. migration preview (previewFusionToResearchLab over the frozen corpus),
//   2. the full v12 → v13 cutover upgrade,
//   3. archive v3 export, preview, commit, and auto-import of a populated
//      corpus,
// and asserts an absolute zero-call count for every instrumented surface.
// The probe cannot pass on empty/recovery states: every operation is run on
// a realistically populated corpus and the spies assert zero calls.
// =============================================================================

import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { listProviders } from "../providers/registry";
import { previewFusionToResearchLab } from "../migrations/fusion-to-research-lab";
import { FUSION_CORPUS_FIXTURE } from "../migrations/fusion-corpus-fixture";
import { RSembleEvaluationDB } from "./database";
import {
  commitPreviewWorkbenchArchiveV3,
  exportWorkbenchArchiveV3,
  importWorkbenchArchiveAuto,
  previewWorkbenchArchive,
} from "./archive";
import { seedCompleteV3Corpus } from "./archive-v3-fixtures";

const testDbs: (Dexie | RSembleEvaluationDB)[] = [];
afterEach(async () => {
  while (testDbs.length > 0) {
    const d = testDbs.pop();
    try {
      d?.close();
    } catch {
      // best-effort close
    }
  }
  vi.restoreAllMocks();
});

function freshDb(name: string): RSembleEvaluationDB {
  const db = new RSembleEvaluationDB(
    `rev9-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  testDbs.push(db);
  return db;
}

interface EgressInstruments {
  spies: MockInstance[];
  fetchSpy: MockInstance;
  xhrSpy: MockInstance;
}

/** Instrument every provider method plus global fetch and XMLHttpRequest.open. */
function instrumentEgress(): EgressInstruments {
  const spies: MockInstance[] = [];
  for (const provider of listProviders()) {
    for (const method of ["readiness", "chatCompletion", "chatCompletionStream"] as const) {
      const target = provider as unknown as Record<string, unknown>;
      if (typeof target[method] === "function") {
        spies.push(vi.spyOn(target, method as never));
      }
    }
    if (typeof (provider as { testConnection?: unknown }).testConnection === "function") {
      spies.push(vi.spyOn(provider as never, "testConnection" as never));
    }
  }
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  // Node's test environment has no XMLHttpRequest; install a recording stub so
  // any XHR attempt is still counted (and asserted to be zero).
  const existingXhr = (globalThis as Record<string, unknown>).XMLHttpRequest;
  let XhrCtor: new () => { open: () => void; send: () => void };
  if (typeof existingXhr === "function") {
    XhrCtor = existingXhr as new () => { open: () => void; send: () => void };
  } else {
    XhrCtor = class RecordingXhr {
      open(): void {}
      send(): void {}
    };
  }
  (globalThis as Record<string, unknown>).XMLHttpRequest = XhrCtor;
  const xhrSpy = vi.spyOn(XhrCtor.prototype, "open");
  return { spies, fetchSpy, xhrSpy };
}

function assertZeroEgress(inst: EgressInstruments): void {
  for (const spy of inst.spies) {
    expect(spy, `provider method ${String(spy.getMockName())} was invoked`).not.toHaveBeenCalled();
  }
  expect(inst.fetchSpy, "global fetch was invoked").not.toHaveBeenCalled();
  expect(inst.xhrSpy, "XMLHttpRequest was opened").not.toHaveBeenCalled();
}

describe("REV-9 — migration operations cause zero provider egress", () => {
  it("migration preview over the frozen corpus makes zero provider/fetch/XHR calls", async () => {
    const inst = instrumentEgress();
    const preview = previewFusionToResearchLab(FUSION_CORPUS_FIXTURE, { now: 1_700_000_000_000 });
    // The preview must actually classify the frozen corpus (not pass on an
    // empty state): it must produce a receipt with discard decisions.
    expect(preview.receipt.totalDiscardedRecords).toBeGreaterThan(0);
    assertZeroEgress(inst);
  });

  it("the v12 → v13 cutover upgrade makes zero provider/fetch/XHR calls", async () => {
    const dbName = `rev9-upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const v12 = new Dexie(dbName);
    v12.version(1).stores({
      storageMeta: "key",
      runSummaries: "id",
      runDetails: "id",
      profiles: "id",
      profileVersions: "[id+version]",
      suites: "id",
      experiments: "id",
    });
    v12.version(2).stores({
      fusionRecipes: "[id+version], id, version",
      poolManifests: "[id+version], id, version",
      fusionStudies: "id, revision, suiteId, suiteVersion, status, updatedAt",
      fusionTrials: "id, revision, studyId, stage, status, createdAt",
      fusionAttempts: "id, studyId, createdAt",
      fusionObservations: "id, trialId, createdAt",
      fusionPlaybooks: "id, studyId, createdAt",
    });
    v12.version(3).stores({
      tasks: "id",
      taskVersions: "[taskId+version]",
      taskArtifacts: "id",
      taskArtifactBytes: "id",
      taskInstances: "id",
      taskFamilies: "id",
      taskFamilyAssignments: "id",
      taskFacetAnnotations: "id",
      taskMigrationCrosswalk: "legacyScopeKey",
    });
    v12.version(4).stores({ taskFamilyRelations: "id" });
    v12.version(5).stores({ taskSets: "id", taskSetVersions: "[taskSetId+version]" });
    v12.version(6).stores({ taskSetOwnershipCrosswalk: "key, kind, taskSetId" });
    v12.version(7).stores({ taskSetMaterializations: "id" });
    v12.version(8).stores({
      modelConfigurations: "id",
      observations: "id",
      evidenceDecisions: "id",
      evidenceIndexJobs: "sourceResultId",
    });
    v12.version(9).stores({ observations: "id, &sourceKey" });
    v12.version(10).stores({ verifierOutcomes: "id" });
    v12.version(11).stores({ comparisonResults: "id" });
    v12.version(12).stores({
      labRecipeRecords: "id, kind, latestVersion, archivedAt, updatedAt",
      labRecipeVersions: "[recipeId+version], recipeId, digest, createdAt",
      modelPoolRecords: "id, latestVersion, archivedAt, updatedAt",
      modelPoolVersions: "[poolId+version], poolId, digest, createdAt",
      studies: "id, kind, status, claimLevel, confirmationOf, updatedAt, archivedAt",
      studyTrials: "id, studyId, status, sampleIndex, createdAt",
      studyAttempts: "id, studyId, fromTrialId, toTrialId, createdAt",
      studyObservations: "id, studyId, trialId, status, createdAt",
      policyPlaybooks: "id, studyId, definitionFingerprint, createdAt",
    });
    await v12.open();
    for (const s of FUSION_CORPUS_FIXTURE.studies) {
      await v12.table("fusionStudies").put({
        id: s.id,
        study: s,
        revision: s.revision,
        suiteId: "suite-default",
        suiteVersion: 1,
        status: s.status,
        updatedAt: s.updatedAt,
      });
    }
    v12.close();

    const inst = instrumentEgress();
    // Reuse the same physical DB name so the upgrade actually runs.
    const migrated = new RSembleEvaluationDB(dbName);
    testDbs.push(migrated);
    await migrated.open();
    expect(migrated.verno).toBe(13);
    // The migration must have written the receipt (non-empty work).
    expect(await migrated.storageMeta.count()).toBeGreaterThan(0);
    assertZeroEgress(inst);
  });
});

describe("REV-9 — archive v3 operations cause zero provider egress (also covers REV-4)", () => {
  it("v3 export, preview, commit, and auto-import of a populated corpus make zero provider/fetch/XHR calls", async () => {
    const source = freshDb("egress-source");
    await source.open();
    await seedCompleteV3Corpus(source);

    const inst = instrumentEgress();

    // 1. Export v3 (populated corpus — assert real payload, not empty).
    const exported = await exportWorkbenchArchiveV3(source, { now: 1_700_000_000_000 });
    expect(exported.manifest.counts.studies).toBeGreaterThan(0);
    expect(exported.manifest.counts.labRecipeRecords).toBeGreaterThan(0);

    // 2. Preview v3.
    const target = freshDb("egress-target");
    await target.open();
    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.format).toBe("v3");
    expect(preview.create.length).toBeGreaterThan(0);

    // 3. Commit v3.
    const committed = await commitPreviewWorkbenchArchiveV3(target, preview);
    expect(committed.created.length).toBeGreaterThan(0);

    // 4. Auto-import v3 into a third database.
    const autoTarget = freshDb("egress-auto");
    await autoTarget.open();
    const auto = await importWorkbenchArchiveAuto(autoTarget, exported);
    expect(auto.format).toBe("v3");
    if (auto.format !== "v3") throw new Error("expected v3 auto-import");
    expect(auto.v3.created.length).toBeGreaterThan(0);

    assertZeroEgress(inst);
  });

  it("legacy Fusion-shaped archive rejection (REV-3 receipt) makes zero provider calls", async () => {
    const target = freshDb("egress-rev3");
    await target.open();
    const inst = instrumentEgress();
    const legacyFusionShape = {
      formatVersion: 2,
      storageVersion: 1,
      exportedAt: 1000,
      fusion: {
        studies: [{ id: "study-1" }],
        trials: [{ id: "trial-1" }],
        recipes: [{ id: "recipe-1", version: 1 }],
      },
    };
    const preview = await previewWorkbenchArchive(target, legacyFusionShape);
    expect(preview.format).toBe("unsupported_fusion_archive_shape");
    expect(preview.unsupportedReceipt?.rejectedCollections.length).toBeGreaterThan(0);
    await expect(importWorkbenchArchiveAuto(target, legacyFusionShape)).rejects.toThrow(
      /unsupported_fusion_archive_shape/,
    );
    assertZeroEgress(inst);
  });
});
