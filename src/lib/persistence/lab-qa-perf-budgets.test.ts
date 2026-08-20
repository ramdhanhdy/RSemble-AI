// @vitest-environment node
// =============================================================================
// RSemble AI — T13b adversarial QA: performance budgets (declared BEFORE
// measurement, plan Task 13)
//
// Independent of the T13a author. Probes, not product code.
//
// Fixture budgets are declared first, then measured, then asserted. Every
// operation runs against a realistically populated corpus so a probe can
// never pass on an empty state:
//
//   BUDGET_MIGRATION_PREVIEW_MS      migration preview over the frozen corpus
//   BUDGET_MIGRATION_CUTOVER_MS      v12 → v13 cutover upgrade (Dexie + fake-indexeddb)
//   BUDGET_LAB_LIST_MS               Lab list: 200 studies + recipes + pools
//   BUDGET_LARGE_STUDY_DETAIL_MS     large study detail: 24 trials / 120 observations
//   BUDGET_ARCHIVE_V3_EXPORT_MS      archive v3 export of the populated corpus
//   BUDGET_ARCHIVE_V3_IMPORT_MS      archive v3 preview + commit into a fresh DB
//
// Main-thread long tasks are measured in the browser matrix
// (scripts/qa-research-lab.mjs) with BUDGET_LONG_TASK_MS.
// =============================================================================

import "fake-indexeddb/auto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { createStudyRepository } from "./study-repository";
import { createLabAssetRepository } from "./lab-asset-repository";
import {
  previewFusionToResearchLab,
  ensureFusionToResearchLabMigration,
} from "../migrations/fusion-to-research-lab";
import { FUSION_CORPUS_FIXTURE } from "../migrations/fusion-corpus-fixture";
import {
  commitPreviewWorkbenchArchiveV3,
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
} from "./archive";
import {
  makeLabRecipeRecord,
  makeLabRecipeVersion,
  makeModelPoolRecord,
  makeModelPoolVersion,
  makePolicyStudyRecord,
  makePolicyStudyTrial,
  makePolicyStudyObservation,
  makePolicyReportPayload,
} from "./archive-v3-fixtures";

// --- Fixture budgets (declared before any measurement) ------------------------
const BUDGET_MIGRATION_PREVIEW_MS = 2_000;
const BUDGET_MIGRATION_CUTOVER_MS = 20_000;
const BUDGET_LAB_LIST_MS = 5_000;
const BUDGET_LARGE_STUDY_DETAIL_MS = 5_000;
const BUDGET_ARCHIVE_V3_EXPORT_MS = 20_000;
const BUDGET_ARCHIVE_V3_IMPORT_MS = 20_000;

const FIXED_NOW = 1_700_000_000_000;

const testDbs: (Dexie | RSembleEvaluationDB)[] = [];
afterEach(async () => {
  while (testDbs.length > 0) {
    const db = testDbs.pop();
    try {
      db?.close();
    } catch {
      // best-effort close
    }
  }
});

function freshDb(tag: string): RSembleEvaluationDB {
  const db = new RSembleEvaluationDB(
    `revperf-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  testDbs.push(db);
  return db;
}

async function seedLabCorpus(
  db: RSembleEvaluationDB,
  opts: { studies: number; trials: number; observationsPerTrial: number },
) {
  await ensureFusionToResearchLabMigration(db);
  const assets = createLabAssetRepository(db);
  const studies = createStudyRepository(db);
  const T = FIXED_NOW - 10_000;

  const recipeRecord = makeLabRecipeRecord("recipe-1");
  await assets.createRecipeRecord(recipeRecord, makeLabRecipeVersion("recipe-1", 1));
  const poolRecord = makeModelPoolRecord("pool-1");
  await assets.createPoolRecord(poolRecord, makeModelPoolVersion("pool-1", 1));

  for (let s = 0; s < opts.studies; s++) {
    const id = `study-${String(s).padStart(3, "0")}`;
    const record = makePolicyStudyRecord(id);
    record.status = "draft";
    record.reportRef = null;
    await studies.createStudy(record);
    await studies.startStudy(id, 1, T + s);
    await studies.createPlaybook(`pb-${id}`, makePolicyReportPayload(id));

    for (let t = 0; t < opts.trials; t++) {
      const trialId = `${id}-trial-${t}`;
      const trial = makePolicyStudyTrial(trialId, id);
      trial.sampleIndex = t;
      trial.observationIds = [];
      trial.status = "sealed";
      trial.sealedAt = T + t;
      await studies.createTrial(trial);
      for (let o = 0; o < opts.observationsPerTrial; o++) {
        const obs = makePolicyStudyObservation(`${trialId}-obs-${o}`, id, trialId);
        obs.createdAt = T + o;
        obs.finishedAt = T + o + 1;
        await studies.appendObservation(obs);
      }
    }
    await studies.sealStudy(id, 2, `pb-${id}`, T + 2000);
  }
}

/** Opt-in evidence emission: when QA_EVIDENCE_DIR is set (the qa:research-lab
 *  harness), write the measured actuals next to the declared budgets. */
const EVIDENCE: Record<string, { budgetMs: number; actualMs: number }> = {};
function record(suite: string, budgetMs: number, actualMs: number): void {
  EVIDENCE[suite] = { budgetMs, actualMs };
}
afterEach(() => {
  const dir = process.env.QA_EVIDENCE_DIR;
  if (dir && Object.keys(EVIDENCE).length > 0) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "perf-budgets.json"),
      `${JSON.stringify({ budgetsDeclaredBeforeMeasurement: true, measured: EVIDENCE }, null, 2)}\n`,
    );
  }
});

describe("performance — migration ops within declared budgets", () => {
  it(`migration preview over the frozen corpus completes under ${BUDGET_MIGRATION_PREVIEW_MS} ms`, () => {
    const start = performance.now();
    const preview = previewFusionToResearchLab(FUSION_CORPUS_FIXTURE, { now: FIXED_NOW });
    const elapsed = performance.now() - start;
    record("migrationPreview", BUDGET_MIGRATION_PREVIEW_MS, elapsed);
    expect(preview.receipt.totalSourceRecords).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(BUDGET_MIGRATION_PREVIEW_MS);
  });

  it(`v12 → v13 cutover upgrade of a seeded database completes under ${BUDGET_MIGRATION_CUTOVER_MS} ms`, async () => {
    const dbName = `revperf-upgrade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    const start = performance.now();
    const migrated = new RSembleEvaluationDB(dbName);
    testDbs.push(migrated);
    await migrated.open();
    const elapsed = performance.now() - start;
    record("migrationCutover", BUDGET_MIGRATION_CUTOVER_MS, elapsed);
    expect(migrated.verno).toBeGreaterThanOrEqual(13);
    expect(await migrated.storageMeta.count()).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(BUDGET_MIGRATION_CUTOVER_MS);
  });
});

describe("performance — Lab surfaces within declared budgets", () => {
  it(`Lab list (200 studies + recipes + pools) completes under ${BUDGET_LAB_LIST_MS} ms`, async () => {
    const db = freshDb("lab-list");
    await db.open();
    await seedLabCorpus(db, { studies: 200, trials: 0, observationsPerTrial: 0 });

    const start = performance.now();
    const studies = createStudyRepository(db);
    const assets = createLabAssetRepository(db);
    const [rows, recipes, pools] = await Promise.all([
      studies.listStudies(),
      assets.listRecipeRecords(),
      assets.listPoolRecords(),
    ]);
    const elapsed = performance.now() - start;
    record("labList", BUDGET_LAB_LIST_MS, elapsed);
    expect(rows.length).toBe(200);
    expect(recipes.length).toBe(1);
    expect(pools.length).toBe(1);
    expect(elapsed).toBeLessThan(BUDGET_LAB_LIST_MS);
  });

  it(`large study detail (24 trials / 120 observations) completes under ${BUDGET_LARGE_STUDY_DETAIL_MS} ms`, async () => {
    const db = freshDb("large-study");
    await db.open();
    await seedLabCorpus(db, { studies: 1, trials: 24, observationsPerTrial: 5 });

    const start = performance.now();
    const studies = createStudyRepository(db);
    const study = await studies.getStudy("study-000");
    const trials = await studies.listTrials("study-000");
    const attempts = await studies.listAttempts("study-000");
    const observations = await studies.listObservations("study-000");
    const playbook = await studies.getPlaybookForStudy("study-000");
    const elapsed = performance.now() - start;
    record("largeStudyDetail", BUDGET_LARGE_STUDY_DETAIL_MS, elapsed);
    expect(study?.id).toBe("study-000");
    expect(trials.length).toBe(24);
    expect(observations.length).toBe(120);
    expect(attempts.length).toBe(0);
    expect(playbook?.id).toBe("pb-study-000");
    expect(elapsed).toBeLessThan(BUDGET_LARGE_STUDY_DETAIL_MS);
  });
});

describe("performance — archive v3 within declared budgets", () => {
  it(`v3 export of the populated corpus completes under ${BUDGET_ARCHIVE_V3_EXPORT_MS} ms`, async () => {
    const db = freshDb("export-perf");
    await db.open();
    await seedLabCorpus(db, { studies: 40, trials: 4, observationsPerTrial: 3 });

    const start = performance.now();
    const exported = await exportWorkbenchArchiveV3(db, { now: FIXED_NOW });
    const elapsed = performance.now() - start;
    record("archiveV3Export", BUDGET_ARCHIVE_V3_EXPORT_MS, elapsed);
    expect(exported.manifest.counts.studies).toBe(40);
    expect(exported.manifest.counts.studyTrials).toBe(160);
    expect(exported.manifest.counts.studyObservations).toBe(480);
    expect(elapsed).toBeLessThan(BUDGET_ARCHIVE_V3_EXPORT_MS);
  });

  it(`v3 preview + commit import of the populated corpus completes under ${BUDGET_ARCHIVE_V3_IMPORT_MS} ms`, async () => {
    const source = freshDb("import-perf-source");
    await source.open();
    await seedLabCorpus(source, { studies: 40, trials: 4, observationsPerTrial: 3 });
    const exported = await exportWorkbenchArchiveV3(source, { now: FIXED_NOW });

    const target = freshDb("import-perf-target");
    await target.open();
    const start = performance.now();
    const preview = await previewWorkbenchArchive(target, exported);
    const committed = await commitPreviewWorkbenchArchiveV3(target, preview);
    const elapsed = performance.now() - start;
    record("archiveV3Import", BUDGET_ARCHIVE_V3_IMPORT_MS, elapsed);
    expect(committed.created.length).toBeGreaterThan(0);
    expect(await target.studies.count()).toBe(40);
    expect(elapsed).toBeLessThan(BUDGET_ARCHIVE_V3_IMPORT_MS);
  });
});
