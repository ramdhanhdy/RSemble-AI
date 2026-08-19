// @vitest-environment node
// =============================================================================
// RSemble AI — T13b adversarial QA: REV-10 archive v3 round-trip corpus
//
// Independent of the T13a author. Probes, not product code.
//
// REV-10 claim (plan Task 13): archive v3 round-trips a realistically
// populated Lab corpus (assets, studies, trials/attempts/observations,
// playbooks, referenced exact evidence) with identity and byte stability.
//
// The corpus is built through the REAL repository APIs (createStudyRepository,
// createLabAssetRepository) on a schema-v13 database — every record passes the
// same validation the product runs — plus the surrounding canonical workbench
// entities (run + referenced exact evidence rows, rubric, suite/experiment,
// task + task set family, comparison index) the study graph references.
//
// Probe assertions:
//   1. Export of the populated corpus validates and carries every Lab
//      collection with non-zero, receipt-matching counts (no empty state).
//   2. Import into a fresh v13 database (preview → commit) reproduces the
//      exact canonical state: every record payload is identical (identity
//      stability), including referenced exact evidence ids.
//   3. A second export from the imported database is byte-for-byte identical
//      to the first export (byte stability), including the payload digest.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { createStudyRepository } from "./study-repository";
import { createLabAssetRepository } from "./lab-asset-repository";
import {
  commitPreviewWorkbenchArchiveV3,
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
} from "./archive";
import { validateArchiveV3, type WorkbenchArchiveV3 } from "./archive-v3-types";
import {
  makeLabRecipeRecord,
  makeLabRecipeVersion,
  makeModelPoolRecord,
  makeModelPoolVersion,
  makePolicyStudyRecord,
  makePolicyStudyTrial,
  makeStudyAttempt,
  makePolicyStudyObservation,
  makePolicyReportPayload,
} from "./archive-v3-fixtures";
import * as v2fx from "./archive-v2-fixtures";
import { fingerprintStudyValue } from "../studies/study-fingerprint";
import { ensureFusionToResearchLabMigration } from "../migrations/fusion-to-research-lab";

const FIXED_NOW = 1_700_000_000_000;

const testDbs: RSembleEvaluationDB[] = [];
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
    `rev10-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  testDbs.push(db);
  return db;
}

// --- Realistic corpus builder (repository APIs only for Lab entities) --------

async function seedRealisticLabCorpus(db: RSembleEvaluationDB): Promise<void> {
  await ensureFusionToResearchLabMigration(db);
  const assets = createLabAssetRepository(db);
  const studies = createStudyRepository(db);
  const T = FIXED_NOW - 10_000;

  // --- Assets: two recipes (one with two versions), two pools ----------------
  const recipe1Record = makeLabRecipeRecord("recipe-1");
  const recipe1V1 = makeLabRecipeVersion("recipe-1", 1);
  const recipe1V2 = makeLabRecipeVersion("recipe-1", 2);
  await assets.createRecipeRecord(recipe1Record, recipe1V1);
  await assets.appendRecipeVersion(recipe1V2, recipe1Record.revision);

  const recipe2Record = makeLabRecipeRecord("recipe-2");
  const recipe2V1 = makeLabRecipeVersion("recipe-2", 1);
  await assets.createRecipeRecord(recipe2Record, recipe2V1);

  const pool1Record = makeModelPoolRecord("pool-1");
  const pool1V1 = makeModelPoolVersion("pool-1", 1);
  const pool1V2 = makeModelPoolVersion("pool-1", 2);
  await assets.createPoolRecord(pool1Record, pool1V1);
  await assets.appendPoolVersion(pool1V2, pool1Record.revision);

  const pool2Record = makeModelPoolRecord("pool-2");
  const pool2V1 = makeModelPoolVersion("pool-2", 1);
  await assets.createPoolRecord(pool2Record, pool2V1);

  // --- Studies across the full lifecycle -------------------------------------
  // Every study enters as a draft (the repository enforces the lifecycle:
  // draft → in_progress → completed/failed/archived), then transitions.
  const draft = makePolicyStudyRecord("study-draft");
  draft.status = "draft";
  draft.reportRef = null; // drafts carry no report
  draft.title = "Draft — inputs not sealed";
  await studies.createStudy(draft);

  const running = makePolicyStudyRecord("study-running");
  running.status = "draft";
  running.reportRef = null;
  running.title = "Running study with an in-progress trial";
  await studies.createStudy(running);
  await studies.startStudy("study-running", 1, T + 10);

  const failed = makePolicyStudyRecord("study-failed");
  failed.status = "draft";
  failed.reportRef = null;
  failed.title = "Failed — see diagnostics";
  await studies.createStudy(failed);
  await studies.startStudy("study-failed", 1, T + 20);

  const exp = makePolicyStudyRecord("study-exp");
  exp.status = "draft";
  exp.reportRef = null;
  exp.claimLevel = "exploratory";
  exp.title = "Completed exploratory policy study";
  await studies.createStudy(exp);
  await studies.startStudy("study-exp", 1, T + 40);

  const conf = makePolicyStudyRecord("study-conf");
  conf.status = "draft";
  conf.reportRef = null;
  conf.claimLevel = "confirmed";
  conf.title = "Confirmed policy study on a fresh holdout";
  conf.confirmationOf = "study-exp";
  // Claim promotion is impossible by mutation: a confirmed study must declare
  // a confirmation claim plan in its definition (spec §4.2).
  conf.definition = { ...conf.definition, claimPlan: "confirmation" as const };
  conf.definitionFingerprint = fingerprintStudyValue(conf.definition);
  await studies.createStudy(conf);
  await studies.startStudy("study-conf", 1, T + 60);

  const arch = makePolicyStudyRecord("study-arch");
  arch.status = "draft";
  arch.reportRef = null;
  arch.title = "Archived — read-only";
  await studies.createStudy(arch);
  await studies.startStudy("study-arch", 1, T + 80);

  // --- Trials / attempts / observations ---------------------------------------
  // Trials are created while the study is in_progress (the repository refuses
  // trials on non-running studies), so the failed study's trials exist before
  // the failure transition.
  async function trialPair(studyId: string, base: number, obsIds: string[]) {
    const t1 = makePolicyStudyTrial(`${studyId}-trial-1`, studyId);
    t1.sampleIndex = 0;
    t1.observationIds = [];
    t1.sealedAt = base;
    await studies.createTrial(t1);

    const attempt = makeStudyAttempt(
      `${studyId}-attempt-1`,
      studyId,
      `${studyId}-trial-1`,
      `${studyId}-trial-2`,
    );
    const t2 = makePolicyStudyTrial(`${studyId}-trial-2`, studyId);
    t2.sampleIndex = 1;
    t2.observationIds = [];
    t2.status = "sealed";
    t2.sealedAt = base + 20;
    await studies.createAttempt(attempt, t2);

    for (const [i, obsId] of obsIds.entries()) {
      // Observations attach only to sealed trials (measurement-only rule).
      const trialId = i === 0 ? `${studyId}-trial-1` : `${studyId}-trial-2`;
      const obs = makePolicyStudyObservation(obsId, studyId, trialId);
      obs.createdAt = base + 30 + i;
      obs.finishedAt = base + 40 + i;
      await studies.appendObservation(obs);
    }
  }

  // The running study carries exactly one in-progress treatment trial: an
  // attempt cannot replace an in-progress treatment, so it has no attempt,
  // no successor trial, and no observations yet.
  const runningTrial = makePolicyStudyTrial("study-running-trial-1", "study-running");
  runningTrial.sampleIndex = 0;
  runningTrial.observationIds = [];
  runningTrial.status = "in_progress";
  runningTrial.sealedAt = null;
  await studies.createTrial(runningTrial);

  await trialPair("study-failed", T + 100, ["obs-failed-1"]);
  await trialPair("study-exp", T + 100, ["obs-exp-1", "obs-exp-2"]);
  await trialPair("study-conf", T + 100, ["obs-conf-1", "obs-conf-2"]);
  await trialPair("study-arch", T + 100, ["obs-arch-1"]);

  // --- Terminal transitions (after trial evidence exists) ---------------------
  await studies.failStudy("study-failed", 2, T + 150);
  await studies.createPlaybook("pb-exp", makePolicyReportPayload("study-exp"));
  await studies.sealStudy("study-exp", 2, "pb-exp", T + 160);
  const confReport = makePolicyReportPayload("study-conf");
  confReport.definitionFingerprint = conf.definitionFingerprint;
  await studies.createPlaybook("pb-conf", confReport);
  await studies.sealStudy("study-conf", 2, "pb-conf", T + 170);
  await studies.createPlaybook("pb-arch", makePolicyReportPayload("study-arch"));
  await studies.sealStudy("study-arch", 2, "pb-arch", T + 180);
  await studies.archiveStudy("study-arch", 3, T + 190);

  // --- Referenced exact evidence + surrounding workbench entities -------------
  const runSummary = v2fx.makeRunSummary("run-1");
  const runDetail = v2fx.makeRunDetail("run-1");
  await db.runSummaries.put(v2fx.runSummaryRow(runSummary));
  await db.runDetails.put(v2fx.runDetailRow(runDetail));

  const rubricRecord = v2fx.makeRubricRecord("rubric-1");
  const rubricVersion = v2fx.makeRubricVersion("rubric-1", 1);
  await db.profiles.put(v2fx.profileRow(rubricRecord));
  await db.profileVersions.put(v2fx.profileVersionRow(rubricVersion));

  const suite = v2fx.makeSuite("suite-1");
  const experiment = v2fx.makeExperiment("exp-1", "suite-1");
  await db.suites.put(v2fx.suiteRow(suite));
  await db.experiments.put(v2fx.experimentRow(experiment));

  const task = v2fx.makeTaskRecord("task-1");
  const taskVer = v2fx.makeTaskVersion("task-1", 1, "art-1");
  const rawBytes = new TextEncoder().encode("Deterministic artifact byte content");
  const taskArt = v2fx.makeTaskArtifact("art-1", rawBytes);
  const taskInst = v2fx.makeTaskInstance("inst-1", "task-1", 1, "art-1");
  const taskFam = v2fx.makeTaskFamily("family-1");
  const taskAssign = v2fx.makeTaskFamilyAssignment("assign-1", "task-1", 1, "family-1");
  const taskRel = v2fx.makeTaskFamilyRelation("rel-1", "family-1", "family-1");
  const taskFacet = v2fx.makeTaskFacetAnnotation("facet-1", "task-1");
  const taskCw = v2fx.makeCrosswalk("task-1", 1);
  await db.tasks.put(v2fx.taskRecordRow(task));
  await db.taskVersions.put(v2fx.taskVersionRow(taskVer));
  await db.taskArtifacts.put(v2fx.taskArtifactRow(taskArt));
  await db.taskArtifactBytes.put(v2fx.taskArtifactBytesRow("art-1", rawBytes));
  await db.taskInstances.put(v2fx.taskInstanceRow(taskInst));
  await db.taskFamilies.put(v2fx.taskFamilyRow(taskFam));
  await db.taskFamilyAssignments.put(v2fx.taskFamilyAssignmentRow(taskAssign));
  await db.taskFamilyRelations.put(v2fx.taskFamilyRelationRow(taskRel));
  await db.taskFacetAnnotations.put(v2fx.taskFacetAnnotationRow(taskFacet));
  await db.taskMigrationCrosswalk.put(v2fx.taskMigrationCrosswalkRow(taskCw));

  const taskSetRec = v2fx.makeTaskSetRecord("taskset-1");
  const taskSetVer = v2fx.makeTaskSetVersion("taskset-1", 1);
  const taskSetMat = v2fx.makeTaskSetMaterialization("mat-1", "taskset-1", 1);
  const taskSetCw = v2fx.makeSuiteManifestCrosswalk("taskset-1");
  await db.taskSets.put(v2fx.taskSetRecordRow(taskSetRec));
  await db.taskSetVersions.put(v2fx.taskSetVersionRow(taskSetVer));
  await db.taskSetMaterializations.put(v2fx.taskSetMaterializationRow(taskSetMat));
  await db.taskSetOwnershipCrosswalk.put(taskSetCw);

  // Exact evidence rows referenced by study observations (sourceRunId run-1).
  const mc = v2fx.makeModelConfiguration(
    "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const evidenceObs = v2fx.makeEvidenceObservation(mc.id);
  const decision = v2fx.makeEligibilityDecision(evidenceObs.id, 1);
  const indexJob = v2fx.makeEvidenceIndexJob("run-1");
  const verifierOutcome = v2fx.makeExecutedVerifierOutcome(
    "run-1",
    "task-1",
    "openrouter:m1",
    T + 200,
  );
  await db.modelConfigurations.put(v2fx.modelConfigurationRow(mc));
  await db.observations.put(v2fx.evidenceObservationRow(evidenceObs));
  await db.evidenceDecisions.put(v2fx.evidenceDecisionRow(decision));
  await db.evidenceIndexJobs.put(v2fx.evidenceIndexJobRow(indexJob));
  await db.verifierOutcomes.put(v2fx.verifierOutcomeRow(verifierOutcome));

  const comparison = v2fx.makeComparisonIndex("run-1");
  const snapshot = v2fx.makeComparisonInputSnapshot();
  const limitation = v2fx.makeComparisonLimitation("run-1");
  await db.comparisonResults.put(comparison);
  // Input snapshots/limitations are archive-level metadata; record the
  // comparison index row only (snapshots live in the export, see below).
  void snapshot;
  void limitation;
}

describe("REV-10 — archive v3 round-trips a realistically populated Lab corpus", () => {
  it("export → preview+commit import → re-export: identity and byte stability", async () => {
    const source = freshDb("source");
    await source.open();
    await seedRealisticLabCorpus(source);

    // 1. Export from the populated corpus (must carry real content).
    const exported = await exportWorkbenchArchiveV3(source, { now: FIXED_NOW });
    expect(validateArchiveV3(exported).valid).toBe(true);
    const counts = exported.manifest.counts;
    expect(counts.studies).toBe(6);
    expect(counts.studyTrials).toBe(9); // 4 completed/failed studies × 2 + running study × 1
    expect(counts.studyAttempts).toBe(4);
    expect(counts.studyObservations).toBe(6);
    expect(counts.policyPlaybooks).toBe(3);
    expect(counts.labRecipeRecords).toBe(2);
    expect(counts.labRecipeVersions).toBe(3);
    expect(counts.modelPoolRecords).toBe(2);
    expect(counts.modelPoolVersions).toBe(3);
    expect(counts.runDetails).toBe(1);
    expect(counts.evidenceObservations).toBe(1);
    expect(counts.comparisonIndexes).toBe(1);

    // The playbooks reference exact evidence through the study graph.
    const playbookIds = exported.lab.playbooks.map((p) => p.playbook.studyId).sort();
    expect(playbookIds).toEqual(["study-arch", "study-conf", "study-exp"]);

    // 2. Import into a fresh database: preview must classify every Lab entity
    //    as a create (fresh target) and commit must land them.
    const target = freshDb("target");
    await target.open();
    const preview = await previewWorkbenchArchive(target, exported);
    expect(preview.format).toBe("v3");
    const committed = await commitPreviewWorkbenchArchiveV3(target, preview);
    expect(committed.created.length).toBeGreaterThan(0);

    // 3. Identity stability: every payload in the imported DB is identical.
    const targetStudies = createStudyRepository(target);
    const targetAssets = createLabAssetRepository(target);
    const importedStudies = (await targetStudies.listStudies(true)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const sourceStudies = (await createStudyRepository(source).listStudies(true)).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(importedStudies.map((s) => s.id)).toEqual(sourceStudies.map((s) => s.id));
    for (const s of sourceStudies) {
      const imported = importedStudies.find((i) => i.id === s.id);
      expect(imported, `study ${s.id} must survive the round trip`).toBeDefined();
      expect(JSON.stringify(imported)).toBe(JSON.stringify(s));
    }
    for (const studyId of sourceStudies.map((s) => s.id)) {
      expect(JSON.stringify(await targetStudies.listTrials(studyId))).toBe(
        JSON.stringify(await createStudyRepository(source).listTrials(studyId)),
      );
      expect(JSON.stringify(await targetStudies.listAttempts(studyId))).toBe(
        JSON.stringify(await createStudyRepository(source).listAttempts(studyId)),
      );
      expect(JSON.stringify(await targetStudies.listObservations(studyId))).toBe(
        JSON.stringify(await createStudyRepository(source).listObservations(studyId)),
      );
      const playbook = await targetStudies.getPlaybookForStudy(studyId);
      const sourcePlaybook = await createStudyRepository(source).getPlaybookForStudy(studyId);
      // The archive model keys playbooks by studyId (payload.studyId); the
      // source row id is the reportRef, so compare the immutable payloads.
      expect(playbook === null ? null : JSON.stringify(playbook.playbook)).toBe(
        sourcePlaybook === null ? null : JSON.stringify(sourcePlaybook.playbook),
      );
    }
    expect(JSON.stringify(await targetAssets.listRecipeRecords(true))).toBe(
      JSON.stringify(await createLabAssetRepository(source).listRecipeRecords(true)),
    );
    expect(JSON.stringify(await targetAssets.listPoolRecords(true))).toBe(
      JSON.stringify(await createLabAssetRepository(source).listPoolRecords(true)),
    );
    for (const recipe of await targetAssets.listRecipeRecords(true)) {
      expect(JSON.stringify(await targetAssets.listRecipeVersions(recipe.id))).toBe(
        JSON.stringify(await createLabAssetRepository(source).listRecipeVersions(recipe.id)),
      );
    }

    // Referenced exact evidence survives with identity. Row-level index
    // fields (sourceKey) are derived on import, so compare the immutable
    // payloads (`row.observation`) — the canonical content must be identical.
    const sourceEvidence = await source.observations.toArray();
    const targetEvidence = await target.observations.toArray();
    expect(targetEvidence.map((r) => r.id).sort()).toEqual(sourceEvidence.map((r) => r.id).sort());
    expect(JSON.stringify(targetEvidence.map((r) => r.observation))).toBe(
      JSON.stringify(sourceEvidence.map((r) => r.observation)),
    );
    const sourceDecisions = await source.evidenceDecisions.toArray();
    const targetDecisions = await target.evidenceDecisions.toArray();
    expect(targetDecisions.map((r) => r.id).sort()).toEqual(
      sourceDecisions.map((r) => r.id).sort(),
    );
    expect(JSON.stringify(targetDecisions.map((r) => r.decision))).toBe(
      JSON.stringify(sourceDecisions.map((r) => r.decision)),
    );

    // 4. Byte stability: re-export from the imported DB is byte-identical.
    const reExported = await exportWorkbenchArchiveV3(target, { now: FIXED_NOW });
    expect(validateArchiveV3(reExported).valid).toBe(true);
    expect(JSON.stringify(reExported)).toBe(JSON.stringify(exported));
    expect(reExported.manifest.payloadDigest).toBe(exported.manifest.payloadDigest);
  });

  it("import is idempotent: re-importing the same archive into the same database reuses identical records", async () => {
    const source = freshDb("source-2");
    await source.open();
    await seedRealisticLabCorpus(source);
    const exported = await exportWorkbenchArchiveV3(source, { now: FIXED_NOW });

    const target = freshDb("target-2");
    await target.open();
    await commitPreviewWorkbenchArchiveV3(target, await previewWorkbenchArchive(target, exported));
    const secondPreview = await previewWorkbenchArchive(target, exported);
    // Every entity is a byte-identical reuse on the second import.
    expect(secondPreview.create.length).toBe(0);
    expect(secondPreview.reuse.length).toBeGreaterThan(0);
    const committed = await commitPreviewWorkbenchArchiveV3(target, secondPreview);
    expect(committed.created.length).toBe(0);
    expect(committed.reused.length).toBeGreaterThan(0);
    expect(committed.skipped.length).toBe(0);
    expect(committed.collisions.length).toBe(0);
  });
});

// --- Typed helper guards ------------------------------------------------------

export type { WorkbenchArchiveV3 };
