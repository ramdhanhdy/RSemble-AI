// =============================================================================
// RSemble AI — Archive v2 deterministic fixtures (Child 02, Tasks 10A/10B)
//
// Pure, deterministic builders for the task-first archive v2 envelope. The
// valid fixture round-trips one representative entity of every collection
// available in Child 02: Runs (summary + detail), Rubrics (identity + version),
// Suites, Experiments, all seven Fusion Study stores, and every canonical Task
// collection — including one artifact with real bytes and one legacy migration
// crosswalk. The manifest carries exact counts, a recomputed payload digest,
// and a local-scope disclosure.
//
// Task 10B exports the entity builders and adds deterministic DB row builders:
// the exact indexed row shapes the repositories write, so export tests can
// seed every Dexie store directly with the same persisted data model.
//
// These fixtures are validation/export fixtures only: they exercise the pure
// `validateArchiveV2` contract and the v2 export adapter. No database is
// opened here, no mutation, no provider calls.
// =============================================================================

import {
  ARCHIVE_V2_FORMAT_VERSION,
  ARCHIVE_V2_STORAGE_VERSION,
  computeArchiveV2PayloadDigest,
  type ArchiveV2EntityCounts,
  type ArchiveV2TaskArtifactBytes,
  type WorkbenchArchiveV2,
} from "./archive-v2-types";
import { computeArtifactDigest } from "../tasks/task-instance";
import type { TaskMigrationCrosswalk } from "../tasks/task-references";
import type {
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "../tasks/task-types";
import type {
  EvaluationRubric,
  EvaluationSuite,
  ExperimentRecord,
  RubricRecord,
} from "../evaluations/evaluation-types";
import type {
  EvaluationObservation,
  FusionAttempt,
  FusionPlaybook,
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
  PoolManifestVersion,
} from "../evaluations/fusion-study-types";
import type { FullRunSummaryV2, RunRecordV2 } from "./run-types";
import type { CriticRef } from "../providers/types";
import type { ModelSlot } from "../../studio-data";
import type { TaskSetRecord, TaskSetVersion } from "../evaluations/task-set-types";
import type { TaskSetMaterializationRecord } from "./evaluation-repository";
import type {
  ExperimentRow,
  FusionAttemptRow,
  FusionObservationRow,
  FusionPlaybookRow,
  FusionRecipeRow,
  FusionStudyRow,
  FusionTrialRow,
  PoolManifestRow,
  ProfileRow,
  ProfileVersionRow,
  RunDetailRow,
  RunSummaryRow,
  SuiteRow,
  TaskArtifactBytesRow,
  TaskArtifactRow,
  TaskFacetAnnotationRow,
  TaskFamilyAssignmentRow,
  TaskFamilyRelationRow,
  TaskFamilyRow,
  TaskInstanceRow,
  TaskRecordRow,
  TaskVersionRow,
  TaskSetMaterializationRow,
  TaskSetOwnershipCrosswalkRow,
  TaskSetRecordRow,
  TaskSetVersionRow,
} from "./database";

// --- Shared constants --------------------------------------------------------

/** A prohibited credential/transport key used by tests to inject a violation.
 *  One of the canonical 6-key set; never a real credential value. */
export const PROHIBITED_KEY_SAMPLE = "apiKey";

/** A credential-like string value (matches the `sk-` auth-shape pattern) used
 *  by tests to inject a prohibited-value violation. Synthetic; not a real key. */
export function credentialLikeText(): string {
  return "sk-test-not-a-real-credential";
}

// --- Shared builders ---------------------------------------------------------

const CRITIC: CriticRef = { providerId: "openrouter", model: "judge-1" };
const SLOT: ModelSlot = {
  id: "slot-1",
  providerId: "openrouter",
  provider: "OpenRouter",
  model: "m1",
  slug: "m1",
  enabled: true,
};

export function makeRunSummary(id: string): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt: 1000,
    completedAt: 2000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: "excerpt",
    modelKeys: ["openrouter:m1"],
    winnerKeys: ["openrouter:m1"],
    scoresByModelKey: { "openrouter:m1": 4 },
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "excerpt",
  };
}

export function makeRunDetail(id: string): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 2000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt: "Do something", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c-1",
        slotId: "slot-1",
        modelKey: "openrouter:m1",
        providerId: "openrouter",
        model: "m1",
        slug: "m1",
        acceptedAttemptId: "att-1",
        attempts: [
          {
            attemptId: "att-1",
            messages: [{ role: "user", content: "Do something" }],
            startedAt: 1000,
            finishedAt: 2000,
            status: "completed",
            output: `Answer for ${id}`,
            tokensIn: 10,
            tokensOut: 20,
            error: null,
          },
        ],
      },
    ],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:m1"],
  };
}

export function makeRubricRecord(id: string): RubricRecord {
  return {
    id,
    revision: 1,
    latestVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

export function makeRubricVersion(id: string, version = 1): EvaluationRubric {
  return {
    id,
    version,
    name: `Rubric ${id}`,
    description: "test",
    judgeInstruction: "judge fairly",
    criteria: [
      {
        id: "c1",
        name: "Quality",
        description: "Overall quality",
        weight: 1,
        anchors: { one: "bad", three: "ok", five: "great" },
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

export function makeSuite(id: string): EvaluationSuite {
  return {
    id,
    revision: 1,
    version: 1,
    name: `Suite ${id}`,
    description: "test suite",
    tasks: [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "Do something",
        systemPrompt: "",
        evaluation: { kind: "holistic" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [SLOT],
    defaultJudge: CRITIC,
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

export function makeExperiment(id: string, suiteId: string): ExperimentRecord {
  const suite = makeSuite(suiteId);
  return {
    id,
    revision: 1,
    suiteId,
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status: "queued",
    execution: null,
    snapshot: {
      suiteId,
      suiteVersion: 1,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    },
    tasks: [{ taskId: "task-1", selectedAttemptId: null, attempts: [] }],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

export function makeRecipe(id: string, version = 1): FusionRecipeVersion {
  return {
    id,
    version,
    recipeFamily: "BlindRaw",
    promptVersion: "v1",
    judgeAnalysisMode: "none",
    rubricAccess: false,
    verification: false,
    synthesizer: CRITIC,
  };
}

export function makePoolManifest(id: string, version = 1): PoolManifestVersion {
  return {
    id,
    version,
    core: [SLOT],
    challengers: [],
    diversityChecklist: ["reasoning", "code"],
    rationale: "diverse core",
    supersedesVersion: null,
    createdAt: 1000,
  };
}

export function makeStudy(id: string): FusionStudy {
  return {
    id,
    revision: 1,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 1, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-1", version: 1 },
    judge1: CRITIC,
    judge2: CRITIC,
    recipeRefs: [{ id: "recipe-1", version: 1 }],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

export function makeTrial(id: string, studyId: string): FusionTrial {
  return {
    id,
    revision: 1,
    studyId,
    suiteRef: { suiteId: "suite-1", suiteVersion: 1, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-1", version: 1 },
    candidateConfig: { slots: [SLOT] },
    judge1: CRITIC,
    judge2: CRITIC,
    policy: "fuse",
    recipe: { id: "recipe-1", version: 1 },
    synthesizer: CRITIC,
    stage: "A",
    sampleIndex: 0,
    children: {
      candidateRunId: null,
      devJudgeRunId: null,
      synthesisArtifact: null,
    },
    observationIds: ["obs-1"],
    cost: {
      policy: { tokensIn: 10, tokensOut: 20 },
      experimental: { tokensIn: 10, tokensOut: 20 },
    },
    status: "sealed",
    sealedAt: 2000,
    createdAt: 1000,
    updatedAt: 2000,
  };
}

export function makeAttempt(id: string, studyId: string): FusionAttempt {
  return {
    id,
    studyId,
    fromTrialId: "trial-1",
    toTrialId: "trial-1",
    reason: "synthesis_rerun",
    createdAt: 1500,
  };
}

export function makeObservation(id: string, trialId: string): EvaluationObservation {
  return {
    id,
    trialId,
    judge: CRITIC,
    runId: null,
    status: "completed",
    overallScore: 4,
    tokensIn: 5,
    tokensOut: 8,
    error: null,
    startedAt: 1000,
    finishedAt: 2000,
  };
}

export function makePlaybook(id: string, studyId: string): FusionPlaybook {
  return {
    id,
    studyId,
    suiteRef: { suiteId: "suite-1", suiteVersion: 1, protocolFingerprint: "sha256:abc" },
    rows: [
      {
        policy: "fuse",
        configuration: "B + C → Synth",
        score: 4,
        lift: 0.2,
        costMultiplier: 1.1,
        confidence: "medium",
      },
    ],
    recommendation: {
      kind: "adopt",
      policy: "fuse",
      configuration: "B + C → Synth",
      rationale: "ok",
    },
    poolAdequacy: { probed: true, outcome: "confirmed", challengerKeys: [], note: "ok" },
    claimLevel: "exploratory",
    conclusion: "fuse helps",
    createdAt: 2000,
  };
}

// --- Task entity builders ----------------------------------------------------

export function makeTaskRecord(id: string): TaskRecord {
  return {
    id,
    latestVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    origin: "legacy-task-set",
    revision: 1,
  };
}

export function makeTaskVersion(taskId: string, version: number, artifactId: string): TaskVersion {
  return {
    taskId,
    version,
    title: `Task ${taskId} v${version}`,
    objective: "Do the task",
    candidateInstruction: "Solve it",
    defaultContextManifest: [
      {
        role: "input",
        artifactId,
        externalRef: null,
        metadataDigest: null,
        mediaType: "text/plain",
        byteCount: null,
      },
    ],
    responseContract: { format: "text", constraints: [], maxLength: null },
    taskVerifierRef: null,
    source: { kind: "legacy-task-set", legacyScopeKey: `legacy:${taskId}`, note: null },
    createdAt: 1000,
  };
}

export function makeTaskArtifact(id: string, bytes: Uint8Array): TaskArtifact {
  return {
    id,
    contentDigest: computeArtifactDigest(bytes),
    mediaType: "text/plain",
    byteCount: bytes.length,
    storageRef: `local:${id}`,
    createdAt: 1000,
  };
}

export function makeArtifactBytes(id: string, bytes: Uint8Array): ArchiveV2TaskArtifactBytes {
  return { id, bytesBase64: bytesToBase64(bytes) };
}

export function makeTaskInstance(
  id: string,
  taskId: string,
  version: number,
  artifactId: string,
): TaskInstance {
  return {
    id,
    taskId,
    taskVersion: version,
    normalizedInput: { text: "Solve it", artifactIds: [artifactId], metadata: {} },
    contextManifest: [
      {
        role: "input",
        artifactId,
        externalRef: null,
        metadataDigest: null,
        mediaType: "text/plain",
        byteCount: null,
      },
    ],
    inputDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    inputCompleteness: "complete",
    createdAt: 1000,
    sourceRef: { kind: "legacy-task-set", legacyScopeKey: `legacy:${taskId}`, originId: null },
  };
}

export function makeTaskFamily(id: string): TaskFamily {
  return {
    id,
    name: `Family ${id}`,
    description: "related variants",
    parentFamilyId: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    revision: 1,
  };
}

export function makeTaskFamilyAssignment(
  id: string,
  taskId: string,
  version: number,
  familyId: string,
): TaskFamilyAssignment {
  return {
    id,
    taskId,
    taskVersion: version,
    familyId,
    isPrimary: true,
    createdAt: 1000,
    revision: 1,
    archivedAt: null,
  };
}

export function makeTaskFamilyRelation(
  id: string,
  fromFamilyId: string,
  toFamilyId: string,
): TaskFamilyRelation {
  return {
    id,
    fromFamilyId,
    toFamilyId,
    kind: "overlap",
    createdAt: 1000,
  };
}

export function makeTaskFacetAnnotation(id: string, taskId: string): TaskFacetAnnotation {
  return {
    id,
    taskId,
    taskVersion: null,
    facetId: "domain",
    valueId: "nlp",
    source: "authored",
    authorKind: "user",
    confidence: null,
    taxonomyVersion: 1,
    createdAt: 1000,
    supersedesId: null,
  };
}

export function makeCrosswalk(taskId: string, version: number): TaskMigrationCrosswalk {
  return {
    legacyScopeKey: `legacy:${taskId}`,
    taskId,
    taskVersion: version,
  };
}

// --- Task Set entity builders (Child 03 Task 11) ------------------------------

export function makeTaskSetRecord(id: string): TaskSetRecord {
  return {
    id,
    latestVersion: 1,
    name: `Task Set ${id}`,
    description: "",
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    revision: 1,
    origin: "legacy-suite",
  };
}

export function makeTaskSetVersion(taskSetId: string, version = 1): TaskSetVersion {
  return {
    taskSetId,
    version,
    members: [
      {
        id: "member-1",
        taskVersionRef: { taskId: "task-1", version: 1 },
        order: 0,
        role: "organic",
        stratum: null,
        weight: 1,
        rubricOverrideRef: null,
        executionOverrides: null,
        unresolved: null,
      },
    ],
    defaultRubricRef: null,
    defaultModelSlots: [SLOT],
    defaultJudge: { providerId: "openrouter", model: "judge-1" },
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "strict" },
    protocolDefaults: {},
    createdAt: 1000,
  };
}

export function makeTaskSetMaterialization(
  id: string,
  taskSetId: string,
  taskSetVersion: number,
): TaskSetMaterializationRecord {
  const fingerprint = "sha256:" + "a".repeat(64);
  return {
    id,
    taskSetId,
    taskSetVersion,
    protocolFingerprint: fingerprint,
    snapshot: {
      taskSetId,
      taskSetVersion,
      tasks: [],
      rubrics: [],
      defaultRubricRef: null,
      defaultRubric: null,
      defaultModelSlots: [],
      defaultJudge: { providerId: "openrouter", model: "judge-1" },
      repeatPolicy: { kind: "none" },
      missingnessPolicy: { kind: "strict" },
      protocolDefaults: {},
      protocolFingerprint: fingerprint,
      createdAt: 1000,
    },
    createdAt: 1000,
  };
}

export function makeSuiteManifestCrosswalk(
  taskSetId: string,
  digest = "sha256:" + "b".repeat(64),
): TaskSetOwnershipCrosswalkRow {
  return {
    key: `ts-xwalk:suite:${taskSetId}:${digest}`,
    kind: "suite-manifest",
    taskSetId,
    version: 1,
    digest,
    status: "resolved",
    updatedAt: 1000,
  };
}

export function makeExperimentOwnerCrosswalk(
  experimentId: string,
  taskSetId: string,
): TaskSetOwnershipCrosswalkRow {
  return {
    key: `ts-xwalk:exp:${experimentId}`,
    kind: "experiment-owner",
    taskSetId,
    version: 1,
    digest: "sha256:" + "c".repeat(64),
    status: "resolved",
    experimentId,
    updatedAt: 1000,
  };
}

export function makeFusionOwnerCrosswalk(
  studyId: string,
  taskSetId: string,
): TaskSetOwnershipCrosswalkRow {
  return {
    key: `ts-xwalk:fusion:${studyId}`,
    kind: "fusion-owner",
    taskSetId,
    version: 1,
    digest: null,
    status: "resolved",
    suiteRef: {
      suiteId: taskSetId,
      suiteVersion: 1,
      protocolFingerprint: "sha256:" + "d".repeat(64),
    },
    updatedAt: 1000,
  };
}

// --- Wire encoding helper ------------------------------------------------------

/** Encode bytes as base64 — the v2 artifact-bytes wire encoding, shared by
 *  fixtures and the v2 export adapter. Deterministic; no runtime dependency. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// --- DB row builders (mirror the repository row mapping) ----------------------
//
// Export tests seed Dexie stores directly; these builders produce the exact
// indexed row shape the repositories write, so the v2 export adapter is
// exercised against the real persisted data model.

export function runSummaryRow(summary: FullRunSummaryV2): RunSummaryRow {
  return {
    kind: summary.kind,
    summary,
    id: summary.id,
    revision: summary.revision,
    createdAt: summary.createdAt,
    completedAt: summary.completedAt,
    status: summary.status,
    mode: summary.mode,
    sourceKind: summary.source.kind,
    sourceProtocolFingerprint: null,
    sourceExperimentTaskAttemptId: null,
    modelKeys: summary.modelKeys,
  };
}

export function runDetailRow(record: RunRecordV2): RunDetailRow {
  return {
    id: record.id,
    record,
    revision: record.revision,
    createdAt: record.createdAt,
    status: record.status,
  };
}

export function profileRow(record: RubricRecord): ProfileRow {
  return {
    id: record.id,
    record,
    revision: record.revision,
    latestVersion: record.latestVersion,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
  };
}

export function profileVersionRow(rubric: EvaluationRubric): ProfileVersionRow {
  return { id: rubric.id, version: rubric.version, profile: rubric, updatedAt: rubric.updatedAt };
}

export function suiteRow(suite: EvaluationSuite): SuiteRow {
  return {
    id: suite.id,
    suite,
    revision: suite.revision,
    version: suite.version,
    updatedAt: suite.updatedAt,
    archivedAt: suite.archivedAt,
  };
}

export function experimentRow(experiment: ExperimentRecord): ExperimentRow {
  return {
    id: experiment.id,
    experiment,
    revision: experiment.revision,
    suiteId: experiment.suiteId,
    suiteVersion: experiment.suiteVersion,
    protocolFingerprint: experiment.protocolFingerprint,
    createdAt: experiment.createdAt,
    status: experiment.status,
  };
}

export function fusionRecipeRow(recipe: FusionRecipeVersion): FusionRecipeRow {
  return { id: recipe.id, version: recipe.version, recipe, createdAt: 1000 };
}

export function poolManifestRow(manifest: PoolManifestVersion): PoolManifestRow {
  return { id: manifest.id, version: manifest.version, manifest, createdAt: manifest.createdAt };
}

export function fusionStudyRow(study: FusionStudy): FusionStudyRow {
  return {
    id: study.id,
    study,
    revision: study.revision,
    suiteId: study.suiteRef.suiteId,
    suiteVersion: study.suiteRef.suiteVersion,
    status: study.status,
    updatedAt: study.updatedAt,
  };
}

export function fusionTrialRow(trial: FusionTrial): FusionTrialRow {
  return {
    id: trial.id,
    trial,
    revision: trial.revision,
    studyId: trial.studyId,
    stage: trial.stage,
    status: trial.status,
    createdAt: trial.createdAt,
  };
}

export function fusionAttemptRow(attempt: FusionAttempt): FusionAttemptRow {
  return {
    id: attempt.id,
    attempt,
    studyId: attempt.studyId,
    createdAt: attempt.createdAt,
  };
}

export function fusionObservationRow(observation: EvaluationObservation): FusionObservationRow {
  return {
    id: observation.id,
    observation,
    trialId: observation.trialId,
    createdAt: observation.finishedAt,
  };
}

export function fusionPlaybookRow(playbook: FusionPlaybook): FusionPlaybookRow {
  return {
    id: playbook.id,
    playbook,
    studyId: playbook.studyId,
    createdAt: playbook.createdAt,
  };
}

export function taskRecordRow(record: TaskRecord): TaskRecordRow {
  return {
    id: record.id,
    record,
    latestVersion: record.latestVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
    origin: record.origin,
    revision: record.revision,
  };
}

export function taskVersionRow(version: TaskVersion): TaskVersionRow {
  return {
    taskId: version.taskId,
    version: version.version,
    version_: version,
    createdAt: version.createdAt,
  };
}

export function taskArtifactRow(artifact: TaskArtifact): TaskArtifactRow {
  return {
    id: artifact.id,
    contentDigest: artifact.contentDigest,
    mediaType: artifact.mediaType,
    byteCount: artifact.byteCount,
    storageRef: artifact.storageRef,
    createdAt: artifact.createdAt,
  };
}

export function taskArtifactBytesRow(id: string, bytes: Uint8Array): TaskArtifactBytesRow {
  return { id, bytes };
}

export function taskInstanceRow(instance: TaskInstance): TaskInstanceRow {
  return {
    id: instance.id,
    instance,
    taskId: instance.taskId,
    taskVersion: instance.taskVersion,
    inputDigest: instance.inputDigest,
    inputCompleteness: instance.inputCompleteness,
    createdAt: instance.createdAt,
  };
}

export function taskFamilyRow(family: TaskFamily): TaskFamilyRow {
  return {
    id: family.id,
    family,
    parentFamilyId: family.parentFamilyId,
    updatedAt: family.updatedAt,
    archivedAt: family.archivedAt,
    revision: family.revision,
  };
}

export function taskFamilyAssignmentRow(assignment: TaskFamilyAssignment): TaskFamilyAssignmentRow {
  return {
    id: assignment.id,
    assignment,
    taskId: assignment.taskId,
    taskVersion: assignment.taskVersion,
    familyId: assignment.familyId,
    isPrimary: assignment.isPrimary ? 1 : 0,
    createdAt: assignment.createdAt,
    revision: assignment.revision,
    archivedAt: assignment.archivedAt,
  };
}

export function taskFamilyRelationRow(relation: TaskFamilyRelation): TaskFamilyRelationRow {
  return {
    id: relation.id,
    relation,
    fromFamilyId: relation.fromFamilyId,
    toFamilyId: relation.toFamilyId,
    kind: relation.kind,
    createdAt: relation.createdAt,
  };
}

export function taskFacetAnnotationRow(annotation: TaskFacetAnnotation): TaskFacetAnnotationRow {
  return {
    id: annotation.id,
    annotation,
    taskId: annotation.taskId,
    taskVersion: annotation.taskVersion,
    facetId: annotation.facetId,
    valueId: annotation.valueId,
    createdAt: annotation.createdAt,
  };
}

export function taskMigrationCrosswalkRow(
  crosswalk: TaskMigrationCrosswalk,
): TaskMigrationCrosswalkRow {
  return {
    legacyScopeKey: crosswalk.legacyScopeKey,
    taskId: crosswalk.taskId,
    taskVersion: crosswalk.taskVersion,
  };
}

export function taskSetRecordRow(record: TaskSetRecord): TaskSetRecordRow {
  return {
    id: record.id,
    record,
    latestVersion: record.latestVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
    origin: record.origin,
    revision: record.revision,
  };
}

export function taskSetVersionRow(version: TaskSetVersion): TaskSetVersionRow {
  return {
    taskSetId: version.taskSetId,
    version: version.version,
    version_: version,
    createdAt: version.createdAt,
  };
}

export function taskSetMaterializationRow(
  record: TaskSetMaterializationRecord,
): TaskSetMaterializationRow {
  return {
    id: record.id,
    taskSetId: record.taskSetId,
    taskSetVersion: record.taskSetVersion,
    protocolFingerprint: record.protocolFingerprint,
    snapshot: record.snapshot,
    createdAt: record.createdAt,
  };
}

// --- Valid envelope ----------------------------------------------------------

/** Build a complete, valid archive v2 fixture with one representative entity
 *  per collection. Deterministic: stable IDs, stable timestamps, recomputed
 *  payload digest. Safe to clone and mutate for invalid-variant tests. */
export function buildValidArchiveV2Fixture(): WorkbenchArchiveV2 {
  const artifactBytes = new TextEncoder().encode("candidate-visible artifact text");

  const runs = {
    summaries: [makeRunSummary("run-1")],
    details: [makeRunDetail("run-1")],
  };
  const rubrics = {
    identities: [makeRubricRecord("rubric-1")],
    versions: [makeRubricVersion("rubric-1", 1)],
  };
  const suites = [makeSuite("suite-1")];
  const experiments = [makeExperiment("exp-1", "suite-1")];
  const fusion = {
    recipes: [makeRecipe("recipe-1", 1)],
    poolManifests: [makePoolManifest("pool-1", 1)],
    studies: [makeStudy("study-1")],
    trials: [makeTrial("trial-1", "study-1")],
    attempts: [makeAttempt("attempt-1", "study-1")],
    observations: [makeObservation("obs-1", "trial-1")],
    playbooks: [makePlaybook("playbook-1", "study-1")],
  };
  const tasks = {
    tasks: [makeTaskRecord("task-1")],
    taskVersions: [makeTaskVersion("task-1", 1, "art-1")],
    taskArtifacts: [makeTaskArtifact("art-1", artifactBytes)],
    taskArtifactBytes: [makeArtifactBytes("art-1", artifactBytes)],
    taskInstances: [makeTaskInstance("inst-1", "task-1", 1, "art-1")],
    taskFamilies: [makeTaskFamily("fam-1")],
    taskFamilyAssignments: [makeTaskFamilyAssignment("fa-1", "task-1", 1, "fam-1")],
    taskFamilyRelations: [makeTaskFamilyRelation("rel-1", "fam-1", "fam-1")],
    taskFacetAnnotations: [makeTaskFacetAnnotation("ann-1", "task-1")],
    taskMigrationCrosswalks: [makeCrosswalk("task-1", 1)],
  };
  const taskSets = {
    records: [makeTaskSetRecord("suite-1")],
    versions: [makeTaskSetVersion("suite-1", 1)],
    materializations: [makeTaskSetMaterialization("mat-1", "suite-1", 1)],
    ownershipCrosswalks: [
      makeSuiteManifestCrosswalk("suite-1"),
      makeExperimentOwnerCrosswalk("exp-1", "suite-1"),
      makeFusionOwnerCrosswalk("study-1", "suite-1"),
    ],
  };

  const archive: WorkbenchArchiveV2 = {
    manifest: {
      formatVersion: ARCHIVE_V2_FORMAT_VERSION,
      storageVersion: ARCHIVE_V2_STORAGE_VERSION,
      exportedAt: 5000,
      producer: "rsemble-ai",
      counts: emptyCounts(),
      payloadDigest: "",
      disclosure: { scope: "local", notes: "deterministic test fixture" },
    },
    runs,
    rubrics,
    suites,
    experiments,
    fusion,
    tasks,
    taskSets,
  };

  archive.manifest.counts = countAll(archive);
  archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);
  return archive;
}

/** Deep-clone an archive so test mutations do not bleed across cases. The
 *  envelope is plain data (no functions), so structuredClone is exact. */
export function cloneArchiveV2(archive: WorkbenchArchiveV2): WorkbenchArchiveV2 {
  return structuredClone(archive);
}

// --- Count helpers -----------------------------------------------------------

function emptyCounts(): ArchiveV2EntityCounts {
  return {
    runSummaries: 0,
    runDetails: 0,
    rubricIdentities: 0,
    rubricVersions: 0,
    suites: 0,
    experiments: 0,
    fusionRecipes: 0,
    poolManifests: 0,
    fusionStudies: 0,
    fusionTrials: 0,
    fusionAttempts: 0,
    fusionObservations: 0,
    fusionPlaybooks: 0,
    tasks: 0,
    taskVersions: 0,
    taskArtifacts: 0,
    taskArtifactBytes: 0,
    taskInstances: 0,
    taskFamilies: 0,
    taskFamilyAssignments: 0,
    taskFamilyRelations: 0,
    taskFacetAnnotations: 0,
    taskMigrationCrosswalks: 0,
    taskSets: 0,
    taskSetVersions: 0,
    taskSetMaterializations: 0,
    taskSetOwnershipCrosswalks: 0,
  };
}

function countAll(archive: WorkbenchArchiveV2): ArchiveV2EntityCounts {
  return {
    runSummaries: archive.runs.summaries.length,
    runDetails: archive.runs.details.length,
    rubricIdentities: archive.rubrics.identities.length,
    rubricVersions: archive.rubrics.versions.length,
    suites: archive.suites.length,
    experiments: archive.experiments.length,
    fusionRecipes: archive.fusion.recipes.length,
    poolManifests: archive.fusion.poolManifests.length,
    fusionStudies: archive.fusion.studies.length,
    fusionTrials: archive.fusion.trials.length,
    fusionAttempts: archive.fusion.attempts.length,
    fusionObservations: archive.fusion.observations.length,
    fusionPlaybooks: archive.fusion.playbooks.length,
    tasks: archive.tasks.tasks.length,
    taskVersions: archive.tasks.taskVersions.length,
    taskArtifacts: archive.tasks.taskArtifacts.length,
    taskArtifactBytes: archive.tasks.taskArtifactBytes.length,
    taskInstances: archive.tasks.taskInstances.length,
    taskFamilies: archive.tasks.taskFamilies.length,
    taskFamilyAssignments: archive.tasks.taskFamilyAssignments.length,
    taskFamilyRelations: archive.tasks.taskFamilyRelations.length,
    taskFacetAnnotations: archive.tasks.taskFacetAnnotations.length,
    taskMigrationCrosswalks: archive.tasks.taskMigrationCrosswalks.length,
    taskSets: archive.taskSets?.records.length ?? 0,
    taskSetVersions: archive.taskSets?.versions.length ?? 0,
    taskSetMaterializations: archive.taskSets?.materializations.length ?? 0,
    taskSetOwnershipCrosswalks: archive.taskSets?.ownershipCrosswalks.length ?? 0,
  };
}
