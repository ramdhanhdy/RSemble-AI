// =============================================================================
// RSemble AI — T13b QA harness seed payload generator (test-only helper)
//
// Prints a single JSON document to stdout with every row the browser-matrix
// probes seed into IndexedDB. Rows reuse the canonical test fixtures so the
// app's own validators accept them. No provider calls, no egress.
//
// Consumed by scripts/qa-research-lab.mjs; not part of the product.
// =============================================================================

import "fake-indexeddb/auto";
import { RSembleEvaluationDB } from "../src/lib/persistence/database";
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
} from "../src/lib/persistence/archive-v3-fixtures";
import { fingerprintStudyValue } from "../src/lib/studies/study-fingerprint";
import * as v2fx from "../src/lib/persistence/archive-v2-fixtures";

const T = 1_700_000_000_000;

interface SeedDocument {
  studies: unknown[];
  studyTrials: unknown[];
  studyAttempts: unknown[];
  studyObservations: unknown[];
  policyPlaybooks: unknown[];
  labRecipeRecords: unknown[];
  labRecipeVersions: unknown[];
  modelPoolRecords: unknown[];
  modelPoolVersions: unknown[];
  suites: unknown[];
  taskSets: unknown[];
  taskSetVersions: unknown[];
  runSummaries: unknown[];
  runDetails: unknown[];
  comparisonResults: unknown[];
  tasks: unknown[];
  taskVersions: unknown[];
}

function studyRow(record: ReturnType<typeof makePolicyStudyRecord>): unknown {
  return {
    id: record.id,
    record,
    kind: record.kind,
    status: record.status,
    claimLevel: record.claimLevel,
    confirmationOf: record.confirmationOf,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
  };
}

function trialRow(trial: ReturnType<typeof makePolicyStudyTrial>): unknown {
  return {
    id: trial.id,
    trial,
    studyId: trial.studyId,
    status: trial.status,
    sampleIndex: trial.sampleIndex,
    revision: 1,
    createdAt: trial.createdAt,
    sealedAt: trial.sealedAt,
  };
}

function observationRow(obs: ReturnType<typeof makePolicyStudyObservation>): unknown {
  return {
    id: obs.id,
    observation: obs,
    studyId: obs.studyId,
    trialId: obs.trialId,
    status: obs.status,
    createdAt: obs.createdAt,
    finishedAt: obs.finishedAt,
  };
}

function playbookRow(id: string, studyId: string): unknown {
  const playbook = makePolicyReportPayload(studyId);
  return {
    id,
    playbook,
    studyId,
    definitionFingerprint: playbook.definitionFingerprint,
    digest: fingerprintStudyValue(playbook),
    createdAt: playbook.createdAt,
  };
}

async function buildSeed(): Promise<SeedDocument> {
  const seed: SeedDocument = {
    studies: [],
    studyTrials: [],
    studyAttempts: [],
    studyObservations: [],
    policyPlaybooks: [],
    labRecipeRecords: [],
    labRecipeVersions: [],
    modelPoolRecords: [],
    modelPoolVersions: [],
    suites: [],
    taskSets: [],
    taskSetVersions: [],
    runSummaries: [],
    runDetails: [],
    comparisonResults: [],
    tasks: [],
    taskVersions: [],
  };

  // --- Assets --------------------------------------------------------------
  const recipe1Record = makeLabRecipeRecord("recipe-1");
  const recipe1V1 = makeLabRecipeVersion("recipe-1", 1);
  const recipe1V2 = makeLabRecipeVersion("recipe-1", 2);
  recipe1V2.promptVersion = "prompt-v2";
  recipe1V2.description =
    "Long recipe description: this recipe governs synthesis across a very long pipeline configuration with many settings and a verbose explanation of every knob. "
      .repeat(6)
      .trim();
  seed.labRecipeRecords.push({
    id: recipe1Record.id,
    record: recipe1Record,
    kind: recipe1Record.kind,
    latestVersion: recipe1Record.latestVersion,
    archivedAt: recipe1Record.archivedAt,
    createdAt: recipe1Record.createdAt,
    updatedAt: recipe1Record.updatedAt,
    revision: recipe1Record.revision,
  });
  for (const v of [recipe1V1, recipe1V2]) {
    seed.labRecipeVersions.push({
      recipeId: v.recipeId,
      version: v.version,
      version_: v,
      digest: v.digest,
      createdAt: v.createdAt,
    });
  }
  const recipe2Record = makeLabRecipeRecord("recipe-2");
  seed.labRecipeRecords.push({
    id: recipe2Record.id,
    record: recipe2Record,
    kind: recipe2Record.kind,
    latestVersion: recipe2Record.latestVersion,
    archivedAt: T - 1000,
    createdAt: recipe2Record.createdAt,
    updatedAt: recipe2Record.updatedAt,
    revision: recipe2Record.revision,
  });
  seed.labRecipeVersions.push({
    recipeId: "recipe-2",
    version: 1,
    version_: makeLabRecipeVersion("recipe-2", 1),
    digest: makeLabRecipeVersion("recipe-2", 1).digest,
    createdAt: makeLabRecipeVersion("recipe-2", 1).createdAt,
  });

  const pool1Record = makeModelPoolRecord("pool-1");
  const pool1V1 = makeModelPoolVersion("pool-1", 1);
  const pool1V2 = makeModelPoolVersion("pool-1", 2);
  seed.modelPoolRecords.push({
    id: pool1Record.id,
    record: pool1Record,
    latestVersion: pool1Record.latestVersion,
    archivedAt: pool1Record.archivedAt,
    createdAt: pool1Record.createdAt,
    updatedAt: pool1Record.updatedAt,
    revision: pool1Record.revision,
  });
  for (const v of [pool1V1, pool1V2]) {
    seed.modelPoolVersions.push({
      poolId: v.poolId,
      version: v.version,
      version_: v,
      digest: v.digest,
      createdAt: v.createdAt,
    });
  }
  const pool2Record = makeModelPoolRecord("pool-2");
  seed.modelPoolRecords.push({
    id: pool2Record.id,
    record: pool2Record,
    latestVersion: pool2Record.latestVersion,
    archivedAt: pool2Record.archivedAt,
    createdAt: pool2Record.createdAt,
    updatedAt: pool2Record.updatedAt,
    revision: pool2Record.revision,
  });
  seed.modelPoolVersions.push({
    poolId: "pool-2",
    version: 1,
    version_: makeModelPoolVersion("pool-2", 1),
    digest: makeModelPoolVersion("pool-2", 1).digest,
    createdAt: makeModelPoolVersion("pool-2", 1).createdAt,
  });

  // --- Studies across every lifecycle state ---------------------------------
  const draft = makePolicyStudyRecord("study-draft");
  draft.status = "draft";
  draft.reportRef = null;
  draft.title = "Draft — inputs not sealed";
  seed.studies.push(studyRow(draft));

  const running = makePolicyStudyRecord("study-running");
  running.status = "in_progress";
  running.reportRef = null;
  running.title = "Running study with an in-progress treatment trial";
  seed.studies.push(studyRow(running));
  const runningTrial = makePolicyStudyTrial("study-running-trial-1", "study-running");
  runningTrial.sampleIndex = 0;
  runningTrial.observationIds = [];
  runningTrial.status = "in_progress";
  runningTrial.sealedAt = null;
  seed.studyTrials.push(trialRow(runningTrial));

  const interrupted = makePolicyStudyRecord("study-interrupted");
  interrupted.status = "in_progress";
  interrupted.reportRef = null;
  interrupted.title = "Interrupted study awaiting resume";
  seed.studies.push(studyRow(interrupted));
  const interruptedTrial = makePolicyStudyTrial("study-interrupted-trial-1", "study-interrupted");
  interruptedTrial.sampleIndex = 0;
  interruptedTrial.observationIds = [];
  interruptedTrial.status = "in_progress";
  interruptedTrial.sealedAt = null;
  seed.studyTrials.push(trialRow(interruptedTrial));

  const failed = makePolicyStudyRecord("study-failed");
  failed.status = "failed";
  failed.reportRef = null;
  failed.title = "Failed — see diagnostics";
  seed.studies.push(studyRow(failed));
  const failedTrial = makePolicyStudyTrial("study-failed-trial-1", "study-failed");
  failedTrial.sampleIndex = 0;
  failedTrial.observationIds = ["obs-failed-1"];
  failedTrial.sealedAt = T - 5000;
  seed.studyTrials.push(trialRow(failedTrial));
  const failedObs = makePolicyStudyObservation(
    "obs-failed-1",
    "study-failed",
    "study-failed-trial-1",
  );
  failedObs.status = "failed";
  failedObs.finishedAt = T - 4000;
  failedObs.payload = {
    ...failedObs.payload,
    error:
      "Execution failed after 3 retries: provider stream terminated with an unrecoverable transport error (HTTP 503, upstream timeout). "
        .repeat(4)
        .trim(),
  };
  seed.studyObservations.push(observationRow(failedObs));

  // Completed exploratory study with a full trial pair.
  const exp = makePolicyStudyRecord("study-exp");
  exp.status = "completed";
  exp.claimLevel = "exploratory";
  exp.reportRef = "pb-exp";
  exp.title = "Completed exploratory policy study — fusion vs rank on a pinned task set";
  seed.studies.push(studyRow(exp));
  const expT1 = makePolicyStudyTrial("study-exp-trial-1", "study-exp");
  expT1.sampleIndex = 0;
  expT1.observationIds = ["obs-exp-1"];
  expT1.sealedAt = T - 3000;
  seed.studyTrials.push(trialRow(expT1));
  const expT2 = makePolicyStudyTrial("study-exp-trial-2", "study-exp");
  expT2.sampleIndex = 1;
  expT2.observationIds = ["obs-exp-2"];
  expT2.sealedAt = T - 2000;
  seed.studyTrials.push(trialRow(expT2));
  seed.studyAttempts.push({
    id: "study-exp-attempt-1",
    attempt: makeStudyAttempt(
      "study-exp-attempt-1",
      "study-exp",
      "study-exp-trial-1",
      "study-exp-trial-2",
    ),
    studyId: "study-exp",
    fromTrialId: "study-exp-trial-1",
    toTrialId: "study-exp-trial-2",
    createdAt: T - 2500,
  });
  for (const [i, obsId] of ["obs-exp-1", "obs-exp-2"].entries()) {
    const obs = makePolicyStudyObservation(
      obsId,
      "study-exp",
      i === 0 ? "study-exp-trial-1" : "study-exp-trial-2",
    );
    obs.createdAt = T - 2800 + i * 100;
    obs.finishedAt = T - 2700 + i * 100;
    seed.studyObservations.push(observationRow(obs));
  }
  seed.policyPlaybooks.push(playbookRow("pb-exp", "study-exp"));

  // Completed confirmed study (confirmation claim plan, parent linkage).
  const conf = makePolicyStudyRecord("study-conf");
  conf.status = "completed";
  conf.claimLevel = "confirmed";
  conf.reportRef = "pb-conf";
  conf.confirmationOf = "study-exp";
  conf.title = "Confirmed policy study on a fresh holdout Task Set version";
  conf.definition = { ...conf.definition, claimPlan: "confirmation" as const };
  conf.definitionFingerprint = fingerprintStudyValue(conf.definition);
  seed.studies.push(studyRow(conf));
  const confT1 = makePolicyStudyTrial("study-conf-trial-1", "study-conf");
  confT1.sampleIndex = 0;
  confT1.observationIds = ["obs-conf-1"];
  confT1.sealedAt = T - 3000;
  seed.studyTrials.push(trialRow(confT1));
  const confObs = makePolicyStudyObservation("obs-conf-1", "study-conf", "study-conf-trial-1");
  confObs.createdAt = T - 2800;
  confObs.finishedAt = T - 2700;
  seed.studyObservations.push(observationRow(confObs));
  const confReport = makePolicyReportPayload("study-conf");
  confReport.definitionFingerprint = conf.definitionFingerprint;
  seed.policyPlaybooks.push({
    id: "pb-conf",
    playbook: confReport,
    studyId: "study-conf",
    definitionFingerprint: conf.definitionFingerprint,
    digest: fingerprintStudyValue(confReport),
    createdAt: confReport.createdAt,
  });

  // Archived study.
  const arch = makePolicyStudyRecord("study-arch");
  arch.status = "archived";
  arch.reportRef = "pb-arch";
  arch.title = "Archived — read-only";
  arch.archivedAt = T - 500;
  seed.studies.push(studyRow(arch));
  const archT1 = makePolicyStudyTrial("study-arch-trial-1", "study-arch");
  archT1.sampleIndex = 0;
  archT1.observationIds = ["obs-arch-1"];
  archT1.sealedAt = T - 4000;
  seed.studyTrials.push(trialRow(archT1));
  const archObs = makePolicyStudyObservation("obs-arch-1", "study-arch", "study-arch-trial-1");
  archObs.createdAt = T - 3800;
  archObs.finishedAt = T - 3700;
  seed.studyObservations.push(observationRow(archObs));
  seed.policyPlaybooks.push(playbookRow("pb-arch", "study-arch"));

  // Large study: 40 trials × 3 observations, long labels, long error text.
  const large = makePolicyStudyRecord("study-large");
  large.status = "completed";
  large.reportRef = "pb-large";
  large.title =
    "Very large study with an extremely long descriptive title that keeps going and going to exercise truncation, wrapping, and horizontal overflow behavior across every viewport size including narrow mobile widths. "
      .repeat(3)
      .trim();
  seed.studies.push(studyRow(large));
  for (let t = 0; t < 40; t++) {
    const trial = makePolicyStudyTrial(`study-large-trial-${t}`, "study-large");
    trial.sampleIndex = t;
    trial.observationIds = [`obs-large-${t}-0`, `obs-large-${t}-1`, `obs-large-${t}-2`];
    trial.sealedAt = T - 9000 + t * 10;
    seed.studyTrials.push(trialRow(trial));
    for (let o = 0; o < 3; o++) {
      const obs = makePolicyStudyObservation(
        `obs-large-${t}-${o}`,
        "study-large",
        `study-large-trial-${t}`,
      );
      obs.createdAt = T - 8900 + t * 10 + o;
      obs.finishedAt = T - 8800 + t * 10 + o;
      if (o === 2 && t === 0) {
        obs.status = "failed";
        obs.payload = {
          ...obs.payload,
          error:
            "A very long diagnostic error message describing exactly what failed in the measurement pipeline and what the operator should do about it, repeated for length. "
              .repeat(8)
              .trim(),
        };
      }
      seed.studyObservations.push(observationRow(obs));
    }
  }
  seed.policyPlaybooks.push(playbookRow("pb-large", "study-large"));

  // --- Task Set handoff surface (/evaluations/sets) --------------------------
  const taskSetRec = v2fx.makeTaskSetRecord("taskset-1");
  const taskSetVer = v2fx.makeTaskSetVersion("taskset-1", 1);
  seed.taskSets.push(v2fx.taskSetRecordRow(taskSetRec));
  seed.taskSets.push({
    id: "taskset-2",
    record: v2fx.makeTaskSetRecord("taskset-2"),
    latestVersion: 1,
    updatedAt: T - 100,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  });
  seed.taskSetVersions.push(v2fx.taskSetVersionRow(taskSetVer));
  // Suite row: TaskSetEditor loads via repo.getSuite(id), not taskSets directly.
  const suite = v2fx.makeSuite("taskset-1");
  seed.suites.push({
    id: suite.id,
    suite,
    revision: suite.revision,
    version: suite.version,
    updatedAt: T,
    archivedAt: null,
  });

  // --- Comparison result route (/compare/results/run-1) -----------------------
  const runSummary = v2fx.makeRunSummary("run-1");
  const runDetail = v2fx.makeRunDetail("run-1");
  seed.runSummaries.push(v2fx.runSummaryRow(runSummary));
  seed.runDetails.push(v2fx.runDetailRow(runDetail));
  seed.comparisonResults.push(v2fx.makeComparisonIndex("run-1"));

  // --- Task catalog surface (/tasks, /tasks/task-1) ---------------------------
  const task = v2fx.makeTaskRecord("task-1");
  const taskVer = v2fx.makeTaskVersion("task-1", 1, "art-1");
  seed.tasks.push(v2fx.taskRecordRow(task));
  seed.taskVersions.push(v2fx.taskVersionRow(taskVer));

  return seed;
}

const seed = await buildSeed();
process.stdout.write(`${JSON.stringify(seed)}\n`);
void RSembleEvaluationDB;
