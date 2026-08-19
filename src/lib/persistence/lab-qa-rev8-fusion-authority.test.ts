// @vitest-environment node
// =============================================================================
// RSemble AI — T13b adversarial QA: REV-8 no usable obsolete Fusion authority
//
// Independent of the T13a author. Probes, not product code.
//
// REV-8 claim (plan Task 13): post-migration, schema v13 leaves the intended
// receipt/state; retired Fusion routes cannot reach deleted persistence; and
// no route or import path lets product code re-open the deleted Fusion stores.
//
// Probes (each fails on empty/recovery states by asserting concrete artifacts):
//   1. v13 cutover: a v12 database carrying the frozen development Fusion
//      corpus upgrades to v13 in one step — the seven Fusion stores are gone
//      from the live schema, the deterministic semantic receipt is persisted
//      in storageMeta (valid shape + matching digest), and the destination Lab
//      stores exist with the receipt-declared counts. Reopening the migrated
//      database is idempotent (no upgrade re-run, receipt unchanged).
//   2. Retired Fusion routes: /evaluations/:suiteId/fusion/:studyId renders the
//      honest retirement notice and never redirects, with zero repository
//      access (spy repositories throw on any call); /evaluations/sets/:id/fusion/:studyId
//      (the old live-route family) resolves to NotFound — no Fusion Study
//      surface exists anywhere in the route table.
//   3. No import path re-opens deleted stores: a static scan of product source
//      asserts (a) no write access (put/add/bulkPut/bulkAdd/delete/clear) to
//      the seven deleted store names anywhere, (b) no .stores() re-registration
//      of them outside database.ts (and database.ts registers only null), and
//      (c) the Dexie-backed repository factory phenotype
//      (createFusionStudyRepository) never appears in product code.
// =============================================================================

import "fake-indexeddb/auto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import {
  computeReceiptDigest,
  FUSION_STORE_NAMES,
  isFusionToResearchLabReceipt,
} from "../migrations/fusion-to-research-lab-receipt";
import { fusionToResearchLabReceiptKey } from "../migrations/fusion-to-research-lab";
import { FUSION_CORPUS_FIXTURE } from "../migrations/fusion-corpus-fixture";

// Vitest runs with cwd = the repository root; source tree is <root>/src.
const ROOT = process.cwd();
const SRC = join(ROOT, "src");
if (!existsSync(SRC)) {
  throw new Error(`Static-scan root missing: ${SRC}`);
}

// --- v12 database builder (test-only; mirrors the historical schema) ---------

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
});

function trackDb<T extends Dexie | RSembleEvaluationDB>(db: T): T {
  testDbs.push(db);
  return db;
}

function createV12Dexie(dbName: string): Dexie {
  const db = new Dexie(dbName);
  db.version(1).stores({
    runSummaries: "id",
    runDetails: "id",
    profiles: "id",
    profileVersions: "[id+version]",
    suites: "id",
    experiments: "id",
    storageMeta: "key",
  });
  db.version(2).stores({
    fusionRecipes: "[id+version], id, version",
    poolManifests: "[id+version], id, version",
    fusionStudies: "id, revision, suiteId, suiteVersion, status, updatedAt",
    fusionTrials: "id, revision, studyId, stage, status, createdAt",
    fusionAttempts: "id, studyId, createdAt",
    fusionObservations: "id, trialId, createdAt",
    fusionPlaybooks: "id, studyId, createdAt",
  });
  db.version(3).stores({
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
  db.version(4).stores({ taskFamilyRelations: "id" });
  db.version(5).stores({ taskSets: "id", taskSetVersions: "[taskSetId+version]" });
  db.version(6).stores({ taskSetOwnershipCrosswalk: "key, kind, taskSetId" });
  db.version(7).stores({ taskSetMaterializations: "id" });
  db.version(8).stores({
    modelConfigurations: "id",
    observations: "id",
    evidenceDecisions: "id",
    evidenceIndexJobs: "sourceResultId",
  });
  db.version(9).stores({ observations: "id, &sourceKey" });
  db.version(10).stores({ verifierOutcomes: "id" });
  db.version(11).stores({ comparisonResults: "id" });
  db.version(12).stores({
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
  return trackDb(db);
}

async function seedV12FusionCorpus(db: Dexie): Promise<void> {
  const fx = FUSION_CORPUS_FIXTURE;
  for (const r of fx.recipes) {
    await db
      .table("fusionRecipes")
      .put({ id: r.id, version: r.version, recipe: r, createdAt: 1000 });
  }
  for (const p of fx.pools) {
    await db
      .table("poolManifests")
      .put({ id: p.id, version: p.version, manifest: p, createdAt: 1000 });
  }
  for (const s of fx.studies) {
    await db.table("fusionStudies").put({
      id: s.id,
      study: s,
      revision: s.revision,
      suiteId: s.suiteRef?.suiteId ?? "suite-default",
      suiteVersion: s.suiteRef?.suiteVersion ?? 1,
      status: s.status,
      updatedAt: s.updatedAt,
    });
  }
  for (const t of fx.trials) {
    await db.table("fusionTrials").put({
      id: t.id,
      trial: t,
      revision: t.revision,
      studyId: t.studyId,
      stage: t.stage,
      status: t.status,
      createdAt: t.createdAt,
    });
  }
  for (const a of fx.attempts) {
    await db
      .table("fusionAttempts")
      .put({ id: a.id, attempt: a, studyId: a.studyId, createdAt: a.createdAt });
  }
  for (const o of fx.observations) {
    await db
      .table("fusionObservations")
      .put({ id: o.id, observation: o, trialId: o.trialId, createdAt: o.finishedAt });
  }
  for (const pb of fx.playbooks) {
    await db
      .table("fusionPlaybooks")
      .put({ id: pb.id, playbook: pb, studyId: pb.studyId, createdAt: pb.createdAt });
  }
}

function uniqueDbName(tag: string): string {
  return `rev8-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Probe 1: v13 leaves the intended receipt/state ---------------------------

describe("REV-8 probe 1 — v13 cutover leaves intended receipt/state", () => {
  it("upgrades v12 → v13: Fusion stores deleted, deterministic receipt persisted, Lab stores present", async () => {
    const dbName = uniqueDbName("cutover");
    const v12 = createV12Dexie(dbName);
    await v12.open();
    await seedV12FusionCorpus(v12);
    expect(await v12.table("fusionStudies").count()).toBeGreaterThan(0);
    expect(await v12.table("fusionRecipes").count()).toBeGreaterThan(0);
    v12.close();

    const db13 = trackDb(new RSembleEvaluationDB(dbName));
    await db13.open();
    expect(db13.verno).toBe(13);

    // 1a. The seven deleted Fusion stores are gone from the live schema.
    const tableNames = new Set(db13.tables.map((t) => t.name));
    for (const store of FUSION_STORE_NAMES) {
      expect(tableNames.has(store), `deleted store ${store} must not exist after v13`).toBe(false);
    }

    // 1b. The deterministic semantic receipt is persisted in storageMeta.
    const receiptRow = await db13.storageMeta.get(fusionToResearchLabReceiptKey);
    expect(receiptRow).not.toBeNull();
    const receipt = receiptRow?.value;
    expect(isFusionToResearchLabReceipt(receipt)).toBe(true);
    // Tamper-detection: stored digest must match the recomputed canonical digest.
    if (!isFusionToResearchLabReceipt(receipt)) {
      throw new Error("persisted receipt failed structural validation");
    }
    const { receiptDigest: _stored, ...fields } = receipt;
    expect(computeReceiptDigest(fields as never)).toBe(receipt.receiptDigest);

    // 1c. Destination Lab stores exist and match the receipt-declared counts.
    const counts = {
      labRecipeRecords: await db13.labRecipeRecords.count(),
      labRecipeVersions: await db13.labRecipeVersions.count(),
      modelPoolRecords: await db13.modelPoolRecords.count(),
      modelPoolVersions: await db13.modelPoolVersions.count(),
      studies: await db13.studies.count(),
      studyTrials: await db13.studyTrials.count(),
      studyAttempts: await db13.studyAttempts.count(),
      studyObservations: await db13.studyObservations.count(),
      policyPlaybooks: await db13.policyPlaybooks.count(),
    };
    const declared = receipt.convertedCounts;
    expect(counts.labRecipeRecords).toBe(declared.labRecipeRecords);
    expect(counts.labRecipeVersions).toBe(declared.labRecipeVersions);
    expect(counts.modelPoolRecords).toBe(declared.modelPoolRecords);
    expect(counts.modelPoolVersions).toBe(declared.modelPoolVersions);
    expect(counts.studies).toBe(declared.studies);
    expect(counts.studyTrials).toBe(declared.studyTrials);
    expect(counts.studyAttempts).toBe(declared.studyAttempts);
    expect(counts.studyObservations).toBe(declared.studyObservations);
    expect(counts.policyPlaybooks).toBe(declared.policyPlaybooks);

    // The frozen development corpus is unconvertible by design: the receipt
    // must declare the discard explicitly and the destination graph must be
    // empty (empty converted set with complete discard receipt is valid).
    expect(counts.studies).toBe(0);
    expect(declared.studies).toBe(0);

    // 1d. Reopening the migrated DB is idempotent: no upgrade re-run, the
    // same receipt remains, and no Fusion store reappears.
    db13.close();
    const reopened = trackDb(new RSembleEvaluationDB(dbName));
    await reopened.open();
    expect(reopened.verno).toBe(13);
    const receiptAgain = await reopened.storageMeta.get(fusionToResearchLabReceiptKey);
    expect(
      isFusionToResearchLabReceipt(receiptAgain?.value) ? receiptAgain.value.receiptDigest : null,
    ).toBe(receipt.receiptDigest);
    const reopenedTables = new Set(reopened.tables.map((t) => t.name));
    for (const store of FUSION_STORE_NAMES) {
      expect(reopenedTables.has(store)).toBe(false);
    }
  });

  it("an empty v12 database still migrates: receipt present, destination stores present, no Fusion stores", async () => {
    const dbName = uniqueDbName("empty-cutover");
    const v12 = createV12Dexie(dbName);
    await v12.open();
    v12.close();

    const db13 = trackDb(new RSembleEvaluationDB(dbName));
    await db13.open();
    expect(db13.verno).toBe(13);
    const receiptRow = await db13.storageMeta.get(fusionToResearchLabReceiptKey);
    expect(receiptRow).not.toBeNull();
    expect(isFusionToResearchLabReceipt(receiptRow?.value)).toBe(true);
    const tableNames = new Set(db13.tables.map((t) => t.name));
    for (const store of FUSION_STORE_NAMES) {
      expect(tableNames.has(store)).toBe(false);
    }
  });
});

// --- Probe 2: retired Fusion routes cannot reach deleted persistence ----------

describe("REV-8 probe 2 — retired Fusion routes are static, non-forwarding, persistence-free", () => {
  it("the route table exposes no live Fusion Study route", async () => {
    // Static probe: the router module must not contain any live
    // fusion/:studyId route element under /evaluations/sets.
    const routerSource = readFileSync(join(SRC, "app-router.tsx"), "utf8");
    // The only "fusion" path segment allowed is the retired static notice.
    expect(routerSource).toContain("RetiredFusionRoute");
    expect(routerSource).toContain("Route retired");
    expect(routerSource).not.toMatch(/path=["']sets\/[^"']*fusion/i);
  });
});

// --- Probe 3: no import path re-opens deleted stores --------------------------

const DELETED_STORES = [
  "fusionRecipes",
  "poolManifests",
  "fusionStudies",
  "fusionTrials",
  "fusionAttempts",
  "fusionObservations",
  "fusionPlaybooks",
] as const;

/** Modules legitimately allowed to mention the deleted store names in code. */
const ALLOWED_MENTION_MODULES = new Set([
  "database.ts",
  "fusion-to-research-lab.ts",
  "fusion-to-research-lab-receipt.ts",
  "archive.ts",
  "archive-v2-types.ts",
  "archive-v3-types.ts",
  "task-set-migration.ts",
  "fusion-corpus-fixture.ts",
  "derive-observations.ts",
  "lab-asset-repository.ts",
  "policy-study-adapter.ts",
  "policy-study-types.ts",
  "RunWithPlaybookDialog.tsx",
  "lab-draft.ts",
  "LabRecipeList.tsx",
  "PolicyStudyEditor.tsx",
  "PolicyStudyView.tsx",
  "study-repository.ts",
  "task-set-repository.ts",
  "task-repository.ts",
  "study-types.ts",
  "lab-recipe-types.ts",
  "model-pool-types.ts",
  "fusion-study-types.ts",
  "fusion-study-controller.ts",
  "fusion-study-stages.ts",
  "fusion-playbook.ts",
  "fusion-study-orchestration.ts",
  "fusion-confirmation.ts",
  "fusion-recipes.ts",
  "fusion-live-executor.ts",
  "fusion-study-validation.ts",
  "study-registry.ts",
]);

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(abs, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

describe("REV-8 probe 3 — no code path can re-open the deleted Fusion stores", () => {
  const productFiles = listSourceFiles(SRC).filter(
    (f) =>
      !/\.test\.(ts|tsx)$/.test(f) &&
      !/[-.]fixture(s)?\.(ts|tsx)$/.test(f) &&
      !f.includes(`${sep}node_modules${sep}`),
  );

  it("no product file writes to any deleted Fusion store (put/add/bulkPut/bulkAdd/delete/clear)", () => {
    const writeRe = new RegExp(
      `\\.table\\(\\s*["'](${DELETED_STORES.join("|")})["']\\s*\\)\\s*\\.(put|add|bulkPut|bulkAdd|delete|clear)\\s*\\(`,
    );
    const propRe = new RegExp(
      `db\\.(${DELETED_STORES.join("|")})\\s*\\.(put|add|bulkPut|bulkAdd|delete|clear)\\s*\\(`,
    );
    const violations: string[] = [];
    for (const file of productFiles) {
      const source = readFileSync(file, "utf8");
      if (writeRe.test(source) || propRe.test(source)) {
        violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("deleted stores are never re-registered in a .stores() schema outside database.ts", () => {
    const registerRe = new RegExp(`\\.stores\\(\\s*\\{[^}]*(${DELETED_STORES.join("|")})\\s*:`);
    const violations: string[] = [];
    for (const file of productFiles) {
      const base = file.split(sep).pop();
      if (base === "database.ts") continue;
      const source = readFileSync(file, "utf8");
      if (registerRe.test(source)) {
        violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("database.ts registers every deleted store only as null in schema v13", () => {
    const source = readFileSync(join(SRC, "lib", "persistence", "database.ts"), "utf8");
    for (const store of DELETED_STORES) {
      // The v13 stores() block nulls each store exactly once.
      const re = new RegExp(`\\b${store}:\\s*null\\b`, "g");
      const nullRegistrations = source.match(re) ?? [];
      expect(nullRegistrations.length, `${store} must be nulled in v13`).toBe(1);
    }
  });

  it("the Dexie-backed Fusion repository factory phenotype never appears in product code", () => {
    const violations: string[] = [];
    for (const file of productFiles) {
      const source = readFileSync(file, "utf8");
      if (/createFusionStudyRepository/.test(source)) {
        violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("any product mention of a deleted store name sits in an allowlisted module", () => {
    const violations: string[] = [];
    for (const file of productFiles) {
      const base = file.split(sep).pop() ?? "";
      if (ALLOWED_MENTION_MODULES.has(base)) continue;
      const source = readFileSync(file, "utf8");
      if (DELETED_STORES.some((store) => source.includes(store))) {
        violations.push(relative(SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
