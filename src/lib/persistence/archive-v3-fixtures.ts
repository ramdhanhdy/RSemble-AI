// =============================================================================
// RSemble AI — Archive v3 deterministic fixtures (Child 06 Task 11)
//
// Pure, deterministic builders for the complete archive v3 envelope (`WorkbenchArchiveV3`).
// Round-trips every canonical Child 01–06 collection:
//   - Runs (summaries and details)
//   - Rubrics (identities and versions)
//   - Suites and Experiments
//   - Canonical Tasks (tasks, versions, artifacts + bytes, instances, families,
//     assignments, relations, annotations, migration crosswalks)
//   - Task Sets (records, versions, materializations, ownership crosswalks)
//   - Referenced Exact Evidence (model configurations, observations, decisions,
//     index jobs, verifier outcomes)
//   - Comparisons (summary-only indexes, snapshot metadata, limitations)
//   - Lab (recipe records/versions, pool records/versions, studies, trials,
//     attempts, observations, playbooks)
// =============================================================================

import {
  ARCHIVE_V3_FORMAT_VERSION,
  ARCHIVE_V3_STORAGE_VERSION,
  computeArchiveV3PayloadDigest,
  type ArchiveV3ComparisonInputSnapshot,
  type ArchiveV3EntityCounts,
  type ArchiveV3LabPayload,
  type ArchiveV3TaskArtifactBytes,
  type WorkbenchArchiveV3,
} from "./archive-v3-types";
import {
  canonicalRecipePayload,
  recipeDigest,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "../studies/lab-recipe-types";
import {
  canonicalPoolPayload,
  poolDigest,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "../studies/model-pool-types";
import type {
  PolicyReportPayload,
  PolicyStudyObservation,
  PolicyStudyRecord,
  PolicyStudyTrial,
} from "../studies/policy/policy-study-types";
import type { StudyAttempt } from "../studies/study-types";
import type { RSembleEvaluationDB } from "./database";
import type { ProviderId } from "../providers/types";
import { isFullRunSummaryV2 } from "./run-types";
import { fingerprintStudyValue } from "../studies/study-fingerprint";
import { createDeterministicReceipt } from "../migrations/fusion-to-research-lab-receipt";
import { fusionToResearchLabReceiptKey } from "../migrations/fusion-to-research-lab";
import * as v2fx from "./archive-v2-fixtures";

// --- Deterministic builders for Lab entities ---------------------------------

export function makeLabRecipeRecord(id = "recipe-1"): LabRecipeRecord {
  return {
    id,
    kind: "fusion",
    name: "Standard Fusion Recipe",
    description: "Deterministic test recipe",
    latestVersion: 1,
    revision: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

export function makeLabRecipeVersion(recipeId = "recipe-1", version = 1): LabRecipeVersion {
  const content = {
    recipeFamily: "BlindRaw" as const,
    promptVersion: "1.0",
    judgeAnalysisMode: "none" as const,
    rubricAccess: true,
    verification: false,
    synthesizer: { providerId: "openrouter" as ProviderId, model: "anthropic/claude-3.5-sonnet" },
  };
  const canonicalPayload = canonicalRecipePayload(content);
  const digest = recipeDigest(content);
  return {
    recipeId,
    version,
    kind: "fusion",
    recipeFamily: content.recipeFamily,
    promptVersion: content.promptVersion,
    judgeAnalysisMode: content.judgeAnalysisMode,
    rubricAccess: content.rubricAccess,
    verification: content.verification,
    synthesizer: content.synthesizer,
    canonicalPayload,
    digest,
    createdAt: 1000,
  };
}

export function makeModelPoolRecord(id = "pool-1"): ModelPoolRecord {
  return {
    id,
    name: "Core Frontier Pool",
    purpose: "Evaluation candidate roster",
    latestVersion: 1,
    revision: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

export function makeModelPoolVersion(poolId = "pool-1", version = 1): ModelPoolVersion {
  const content = {
    core: [
      {
        id: "slot-1",
        providerId: "openrouter" as ProviderId,
        provider: "OpenRouter",
        model: "gpt-4o",
        slug: "gpt-4o",
        label: "GPT-4o",
        enabled: true,
      },
      {
        id: "slot-2",
        providerId: "openrouter" as ProviderId,
        provider: "OpenRouter",
        model: "claude-3-5-sonnet",
        slug: "claude-3-5-sonnet",
        label: "Claude 3.5",
        enabled: true,
      },
    ],
    challengers: [],
    diversityChecklist: ["family-independent", "reasoning-diverse"],
    rationale: "Frontier tier comparison",
    supersedesVersion: null,
  };
  const canonicalPayload = canonicalPoolPayload(content);
  const digest = poolDigest(content);
  return {
    poolId,
    version,
    core: content.core,
    challengers: content.challengers,
    diversityChecklist: content.diversityChecklist,
    rationale: content.rationale,
    supersedesVersion: content.supersedesVersion,
    canonicalPayload,
    digest,
    createdAt: 1000,
  };
}

export function makePolicyStudyRecord(id = "study-1"): PolicyStudyRecord {
  const recipe = makeLabRecipeVersion("recipe-1", 1);
  const pool = makeModelPoolVersion("pool-1", 1);
  const definition = {
    workload: {
      taskSetId: "taskset-1",
      version: 1,
      manifestDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    },
    modelPool: {
      poolId: pool.poolId,
      version: pool.version,
      digest: pool.digest,
    },
    fusionRecipes: [
      {
        recipeId: recipe.recipeId,
        version: recipe.version,
        digest: recipe.digest,
      },
    ],
    judge1: { id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
    judge2: { id: "mc:sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" },
    rubric: { rubricId: "rubric-1", version: 1 },
    protocolFingerprint: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    policies: ["best_fixed" as const, "rank" as const, "fuse" as const, "refine" as const],
    stageProtocolVersion: 1,
    claimPlan: "exploration" as const,
  };
  const definitionFingerprint = fingerprintStudyValue(definition);
  return {
    id,
    revision: 1,
    kind: "policy",
    title: "Initial Policy Study",
    status: "completed",
    claimLevel: "exploratory",
    definitionSchemaVersion: 1,
    definitionFingerprint,
    definition,
    reportRef: id,
    confirmationOf: null,
    createdAt: 1000,
    updatedAt: 1200,
    archivedAt: null,
  };
}

export function makePolicyStudyTrial(id = "trial-1", studyId = "study-1"): PolicyStudyTrial {
  const recipe = makeLabRecipeVersion("recipe-1", 1);
  const payload = {
    policy: "fuse" as const,
    stage: "A" as const,
    candidateConfig: {
      members: [
        { id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
      ],
    },
    recipeRef: {
      recipeId: recipe.recipeId,
      version: recipe.version,
      digest: recipe.digest,
    },
    synthesizer: {
      id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  };
  const payloadFingerprint = fingerprintStudyValue(payload);
  return {
    id,
    studyId,
    payloadKind: "policy",
    payloadSchemaVersion: 1,
    payloadFingerprint,
    payload,
    status: "sealed",
    sampleIndex: 0,
    artifactRefs: [],
    observationIds: ["obs-1"],
    policyCost: { tokensIn: 100, tokensOut: 50 },
    experimentalCost: { tokensIn: 100, tokensOut: 50 },
    createdAt: 1000,
    sealedAt: 1100,
  };
}

export function makeStudyTrialSuccessor(id = "trial-2", studyId = "study-1"): PolicyStudyTrial {
  const trial = makePolicyStudyTrial(id, studyId);
  trial.sampleIndex = 1;
  trial.observationIds = ["obs-2"];
  return trial;
}

export function makeStudyAttempt(
  id = "attempt-1",
  studyId = "study-1",
  fromTrialId = "trial-1",
  toTrialId = "trial-2",
): StudyAttempt {
  return {
    id,
    studyId,
    fromTrialId,
    toTrialId,
    reason: "Candidate parameter refinement",
    createdAt: 1150,
  };
}

export function makePolicyStudyObservation(
  id = "obs-1",
  studyId = "study-1",
  trialId = "trial-1",
): PolicyStudyObservation {
  return {
    id,
    studyId,
    trialId,
    payloadKind: "policy_measurement",
    payloadSchemaVersion: 1,
    payload: {
      judge: { id: "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" },
      overallScore: 0.85,
      tokensIn: 80,
      tokensOut: 20,
      error: null,
    },
    status: "completed",
    sourceRunId: "run-1",
    createdAt: 1050,
    finishedAt: 1090,
  };
}

export function makePolicyReportPayload(studyId = "study-1"): PolicyReportPayload {
  const study = makePolicyStudyRecord(studyId);
  return {
    studyId,
    definitionFingerprint: study.definitionFingerprint,
    rows: [
      {
        policy: "fuse",
        configuration: "recipe-1@v1",
        meanOutcome: 0.88,
        lift: 0.12,
        costMultiplier: 1.5,
        confidence: "high",
      },
    ],
    recommendation: {
      kind: "adopt",
      policy: "fuse",
      configuration: "recipe-1@v1",
      rationale: "Statistically significant lift with modest cost increase",
    },
    poolAdequacy: {
      probed: true,
      outcome: "confirmed",
      note: "All 2 core configurations viable",
    },
    recipeSensitivity: {
      checked: true,
      note: "Robust to prompt perturbation",
    },
    claimLevel: "exploratory",
    conclusion: "Adopt fusion recipe 1 for production tasks",
    supportingTrialIds: ["trial-1", "trial-2"],
    supportingObservationIds: ["obs-1", "obs-2"],
    reportSchemaVersion: 1,
    createdAt: 1200,
  };
}

export function makeValidLabPayload(): ArchiveV3LabPayload {
  const recipeRec = makeLabRecipeRecord("recipe-1");
  const recipeVer = makeLabRecipeVersion("recipe-1", 1);
  const poolRec = makeModelPoolRecord("pool-1");
  const poolVer = makeModelPoolVersion("pool-1", 1);
  const study = makePolicyStudyRecord("study-1");
  const playbookId = "pb:sha256:" + "f".repeat(64);
  study.reportRef = playbookId;
  const trial1 = makePolicyStudyTrial("trial-1", "study-1");
  const trial2 = makeStudyTrialSuccessor("trial-2", "study-1");
  const attempt = makeStudyAttempt("attempt-1", "study-1", "trial-1", "trial-2");
  const obs1 = makePolicyStudyObservation("obs-1", "study-1", "trial-1");
  const obs2 = makePolicyStudyObservation("obs-2", "study-1", "trial-2");
  const playbook = makePolicyReportPayload("study-1");
  const cutoverReceipt = createDeterministicReceipt({
    generatedAt: 1000,
    sourceCounts: {
      fusionRecipes: 0,
      poolManifests: 0,
      fusionStudies: 0,
      fusionTrials: 0,
      fusionAttempts: 0,
      fusionObservations: 0,
      fusionPlaybooks: 0,
    },
    convertedCounts: {
      labRecipeRecords: 0,
      labRecipeVersions: 0,
      modelPoolRecords: 0,
      modelPoolVersions: 0,
      studies: 0,
      studyTrials: 0,
      studyAttempts: 0,
      studyObservations: 0,
      policyPlaybooks: 0,
    },
    discardedCounts: {
      fusionRecipes: 0,
      poolManifests: 0,
      fusionStudies: 0,
      fusionTrials: 0,
      fusionAttempts: 0,
      fusionObservations: 0,
      fusionPlaybooks: 0,
    },
    decisions: [],
  });

  return {
    recipeRecords: [recipeRec],
    recipeVersions: [recipeVer],
    poolRecords: [poolRec],
    poolVersions: [poolVer],
    studies: [study],
    trials: [trial1, trial2],
    attempts: [attempt],
    observations: [obs1, obs2],
    playbooks: [{ id: playbookId, playbook }],
    cutoverReceipt,
  };
}

// --- Complete valid Archive v3 fixture ---------------------------------------

export function buildValidArchiveV3Fixture(): WorkbenchArchiveV3 {
  const lab = makeValidLabPayload();

  const run1Summary = v2fx.makeRunSummary("run-1");
  const run1Detail = v2fx.makeRunDetail("run-1");
  const rubricRec = v2fx.makeRubricRecord("rubric-1");
  const rubricVer = v2fx.makeRubricVersion("rubric-1", 1);
  const suite = v2fx.makeSuite("suite-1");
  const exp = v2fx.makeExperiment("exp-1", "suite-1");

  const task = v2fx.makeTaskRecord("task-1");
  const taskVer = v2fx.makeTaskVersion("task-1", 1, "art-1");
  const rawBytes = new TextEncoder().encode("Deterministic artifact byte content");
  const taskArt = v2fx.makeTaskArtifact("art-1", rawBytes);
  const taskBytes: ArchiveV3TaskArtifactBytes = v2fx.makeArtifactBytes("art-1", rawBytes);
  const taskInst = v2fx.makeTaskInstance("inst-1", "task-1", 1, "art-1");
  const taskFam = v2fx.makeTaskFamily("family-1");
  const taskAssign = v2fx.makeTaskFamilyAssignment("assign-1", "task-1", 1, "family-1");
  const taskRel = v2fx.makeTaskFamilyRelation("rel-1", "family-1", "family-1");
  const taskFacet = v2fx.makeTaskFacetAnnotation("facet-1", "task-1");
  const taskCw = v2fx.makeCrosswalk("task-1", 1);

  const taskSetRec = v2fx.makeTaskSetRecord("taskset-1");
  const taskSetVer = v2fx.makeTaskSetVersion("taskset-1", 1);
  const taskSetMat = v2fx.makeTaskSetMaterialization("mat-1", "taskset-1", 1);
  const taskSetCw = v2fx.makeSuiteManifestCrosswalk("taskset-1");

  const mc = v2fx.makeModelConfiguration(
    "mc:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const obs = v2fx.makeEvidenceObservation(mc.id);
  const dec = v2fx.makeEligibilityDecision(obs.id, 1);
  const job = v2fx.makeEvidenceIndexJob("run-1");
  const vo = v2fx.makeExecutedVerifierOutcome("run-1", "task-1", "openrouter:m1", 1400);

  const compIndex = v2fx.makeComparisonIndex("run-1");
  const compSnap: ArchiveV3ComparisonInputSnapshot = {
    runId: "run-1",
    snapshotKind: "task_instance",
    snapshotRef: "inst-1",
    taskId: "task-1",
    taskVersion: 1,
    taskInstanceId: "inst-1",
    completeness: "exact",
    capturedAt: 1000,
  };
  const compLim = v2fx.makeComparisonLimitation("run-1");

  const counts: ArchiveV3EntityCounts = {
    runSummaries: 1,
    runDetails: 1,
    rubricIdentities: 1,
    rubricVersions: 1,
    suites: 1,
    experiments: 1,
    tasks: 1,
    taskVersions: 1,
    taskArtifacts: 1,
    taskArtifactBytes: 1,
    taskInstances: 1,
    taskFamilies: 1,
    taskFamilyAssignments: 1,
    taskFamilyRelations: 1,
    taskFacetAnnotations: 1,
    taskMigrationCrosswalks: 1,
    taskSetRecords: 1,
    taskSetVersions: 1,
    taskSetMaterializations: 1,
    taskSetOwnershipCrosswalks: 1,
    modelConfigurations: 1,
    evidenceObservations: 1,
    evidenceDecisions: 1,
    evidenceIndexJobs: 1,
    verifierOutcomes: 1,
    comparisonIndexes: 1,
    comparisonInputSnapshots: 1,
    comparisonLimitations: 1,
    labRecipeRecords: lab.recipeRecords.length,
    labRecipeVersions: lab.recipeVersions.length,
    modelPoolRecords: lab.poolRecords.length,
    modelPoolVersions: lab.poolVersions.length,
    studies: lab.studies.length,
    studyTrials: lab.trials.length,
    studyAttempts: lab.attempts.length,
    studyObservations: lab.observations.length,
    policyPlaybooks: lab.playbooks.length,
    fusionToResearchLabReceipts: 1,
  };

  const archive: WorkbenchArchiveV3 = {
    manifest: {
      formatVersion: ARCHIVE_V3_FORMAT_VERSION,
      storageVersion: ARCHIVE_V3_STORAGE_VERSION,
      exportedAt: 1000,
      producer: "rsemble-ai",
      counts,
      payloadDigest: "",
      disclosure: {
        scope: "local",
        notes: "Local workbench export. No remote transport metadata.",
      },
    },
    runs: { summaries: [run1Summary], details: [run1Detail] },
    rubrics: { identities: [rubricRec], versions: [rubricVer] },
    suites: [suite],
    experiments: [exp],
    tasks: {
      tasks: [task],
      taskVersions: [taskVer],
      taskArtifacts: [taskArt],
      taskArtifactBytes: [taskBytes],
      taskInstances: [taskInst],
      taskFamilies: [taskFam],
      taskFamilyAssignments: [taskAssign],
      taskFamilyRelations: [taskRel],
      taskFacetAnnotations: [taskFacet],
      taskMigrationCrosswalks: [taskCw],
    },
    taskSets: {
      records: [taskSetRec],
      versions: [taskSetVer],
      materializations: [taskSetMat],
      ownershipCrosswalks: [taskSetCw],
    },
    evidence: {
      modelConfigurations: [mc],
      observations: [obs],
      evidenceDecisions: [dec],
      evidenceIndexJobs: [job],
      verifierOutcomes: [vo],
    },
    comparisons: {
      indexes: [compIndex],
      inputSnapshots: [compSnap],
      limitations: [compLim],
    },
    lab,
  };

  archive.manifest.payloadDigest = computeArchiveV3PayloadDigest(archive);
  return archive;
}

export function cloneArchiveV3(archive: WorkbenchArchiveV3): WorkbenchArchiveV3 {
  return JSON.parse(JSON.stringify(archive)) as WorkbenchArchiveV3;
}

// --- Database seeder for v3 --------------------------------------------------

export async function seedCompleteV3Corpus(db: RSembleEvaluationDB): Promise<WorkbenchArchiveV3> {
  const archive = buildValidArchiveV3Fixture();

  // Runs
  for (const s of archive.runs.summaries) {
    if (isFullRunSummaryV2(s)) {
      await db.runSummaries.put(v2fx.runSummaryRow(s));
    } else {
      await db.runSummaries.put(v2fx.runSummaryRow(s as unknown as never));
    }
  }
  for (const d of archive.runs.details) {
    await db.runDetails.put(v2fx.runDetailRow(d));
  }

  // Rubrics
  for (const r of archive.rubrics.identities) {
    await db.profiles.put(v2fx.profileRow(r));
  }
  for (const v of archive.rubrics.versions) {
    await db.profileVersions.put(v2fx.profileVersionRow(v));
  }

  // Suites & Experiments
  for (const s of archive.suites) {
    await db.suites.put(v2fx.suiteRow(s));
  }
  for (const e of archive.experiments) {
    await db.experiments.put(v2fx.experimentRow(e));
  }

  // Tasks
  for (const t of archive.tasks.tasks) {
    await db.tasks.put(v2fx.taskRecordRow(t));
  }
  for (const v of archive.tasks.taskVersions) {
    await db.taskVersions.put(v2fx.taskVersionRow(v));
  }
  for (const a of archive.tasks.taskArtifacts) {
    await db.taskArtifacts.put(v2fx.taskArtifactRow(a));
  }
  for (const b of archive.tasks.taskArtifactBytes) {
    const raw = atob(b.bytesBase64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    await db.taskArtifactBytes.put({ id: b.id, bytes });
  }
  for (const i of archive.tasks.taskInstances) {
    await db.taskInstances.put(v2fx.taskInstanceRow(i));
  }
  for (const f of archive.tasks.taskFamilies) {
    await db.taskFamilies.put(v2fx.taskFamilyRow(f));
  }
  for (const a of archive.tasks.taskFamilyAssignments) {
    await db.taskFamilyAssignments.put(v2fx.taskFamilyAssignmentRow(a));
  }
  for (const r of archive.tasks.taskFamilyRelations) {
    await db.taskFamilyRelations.put(v2fx.taskFamilyRelationRow(r));
  }
  for (const a of archive.tasks.taskFacetAnnotations) {
    await db.taskFacetAnnotations.put(v2fx.taskFacetAnnotationRow(a));
  }
  for (const cw of archive.tasks.taskMigrationCrosswalks) {
    await db.taskMigrationCrosswalk.put(v2fx.taskMigrationCrosswalkRow(cw));
  }

  // Task Sets
  for (const r of archive.taskSets.records) {
    await db.taskSets.put(v2fx.taskSetRecordRow(r));
  }
  for (const v of archive.taskSets.versions) {
    await db.taskSetVersions.put(v2fx.taskSetVersionRow(v));
  }
  for (const m of archive.taskSets.materializations) {
    await db.taskSetMaterializations.put(v2fx.taskSetMaterializationRow(m));
  }
  for (const cw of archive.taskSets.ownershipCrosswalks) {
    await db.taskSetOwnershipCrosswalk.put(cw);
  }

  // Evidence
  for (const mc of archive.evidence.modelConfigurations) {
    await db.modelConfigurations.put(v2fx.modelConfigurationRow(mc));
  }
  for (const o of archive.evidence.observations) {
    await db.observations.put(v2fx.evidenceObservationRow(o));
  }
  for (const d of archive.evidence.evidenceDecisions) {
    await db.evidenceDecisions.put(v2fx.evidenceDecisionRow(d));
  }
  for (const j of archive.evidence.evidenceIndexJobs) {
    await db.evidenceIndexJobs.put(v2fx.evidenceIndexJobRow(j));
  }
  for (const vo of archive.evidence.verifierOutcomes) {
    await db.verifierOutcomes.put(v2fx.verifierOutcomeRow(vo));
  }

  // Comparisons
  for (const i of archive.comparisons.indexes) {
    await db.comparisonResults.put(i);
  }

  // Lab entities
  for (const rr of archive.lab.recipeRecords) {
    await db.labRecipeRecords.put({
      id: rr.id,
      record: rr,
      kind: rr.kind,
      latestVersion: rr.latestVersion,
      archivedAt: rr.archivedAt,
      createdAt: rr.createdAt,
      updatedAt: rr.updatedAt,
      revision: rr.revision,
    });
  }
  for (const rv of archive.lab.recipeVersions) {
    await db.labRecipeVersions.put({
      recipeId: rv.recipeId,
      version: rv.version,
      version_: rv,
      digest: rv.digest,
      createdAt: rv.createdAt,
    });
  }
  for (const pr of archive.lab.poolRecords) {
    await db.modelPoolRecords.put({
      id: pr.id,
      record: pr,
      latestVersion: pr.latestVersion,
      archivedAt: pr.archivedAt,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      revision: pr.revision,
    });
  }
  for (const pv of archive.lab.poolVersions) {
    await db.modelPoolVersions.put({
      poolId: pv.poolId,
      version: pv.version,
      version_: pv,
      digest: pv.digest,
      createdAt: pv.createdAt,
    });
  }
  for (const st of archive.lab.studies) {
    await db.studies.put({
      id: st.id,
      record: st,
      kind: st.kind,
      status: st.status,
      claimLevel: st.claimLevel,
      confirmationOf: st.confirmationOf,
      revision: st.revision,
      createdAt: st.createdAt,
      updatedAt: st.updatedAt,
      archivedAt: st.archivedAt,
    });
  }
  for (const tr of archive.lab.trials) {
    await db.studyTrials.put({
      id: tr.id,
      trial: tr,
      studyId: tr.studyId,
      status: tr.status,
      sampleIndex: tr.sampleIndex,
      revision: 1,
      createdAt: tr.createdAt,
      sealedAt: tr.sealedAt,
    });
  }
  for (const at of archive.lab.attempts) {
    await db.studyAttempts.put({
      id: at.id,
      attempt: at,
      studyId: at.studyId,
      fromTrialId: at.fromTrialId,
      toTrialId: at.toTrialId,
      createdAt: at.createdAt,
    });
  }
  for (const ob of archive.lab.observations) {
    await db.studyObservations.put({
      id: ob.id,
      observation: ob,
      studyId: ob.studyId,
      trialId: ob.trialId,
      status: ob.status,
      createdAt: ob.createdAt,
      finishedAt: ob.finishedAt,
    });
  }
  for (const pb of archive.lab.playbooks) {
    await db.policyPlaybooks.put({
      id: pb.id,
      playbook: pb.playbook,
      studyId: pb.playbook.studyId,
      definitionFingerprint: pb.playbook.definitionFingerprint,
      digest: `sha256:${pb.id}`,
      createdAt: pb.playbook.createdAt,
    });
  }
  await db.storageMeta.put({
    key: fusionToResearchLabReceiptKey,
    value: archive.lab.cutoverReceipt,
  });

  return archive;
}
