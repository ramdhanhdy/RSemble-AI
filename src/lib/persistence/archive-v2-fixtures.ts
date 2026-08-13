// =============================================================================
// RSemble AI — Archive v2 deterministic fixtures (Child 02, Task 10A)
//
// Pure, deterministic builders for the task-first archive v2 envelope. The
// valid fixture round-trips one representative entity of every collection
// available in Child 02: Runs (summary + detail), Rubrics (identity + version),
// Suites, Experiments, all seven Fusion Study stores, and every canonical Task
// collection — including one artifact with real bytes and one legacy migration
// crosswalk. The manifest carries exact counts, a recomputed payload digest,
// and a local-scope disclosure.
//
// These fixtures are validation fixtures only: they exercise the pure
// `validateArchiveV2` contract. No database, no mutation, no provider calls.
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

function makeRunSummary(id: string): FullRunSummaryV2 {
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

function makeRunDetail(id: string): RunRecordV2 {
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

function makeRubricRecord(id: string): RubricRecord {
  return {
    id,
    revision: 1,
    latestVersion: 1,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeRubricVersion(id: string, version = 1): EvaluationRubric {
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

function makeSuite(id: string): EvaluationSuite {
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

function makeExperiment(id: string, suiteId: string): ExperimentRecord {
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

function makeRecipe(id: string, version = 1): FusionRecipeVersion {
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

function makePoolManifest(id: string, version = 1): PoolManifestVersion {
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

function makeStudy(id: string): FusionStudy {
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

function makeTrial(id: string, studyId: string): FusionTrial {
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

function makeAttempt(id: string, studyId: string): FusionAttempt {
  return {
    id,
    studyId,
    fromTrialId: "trial-1",
    toTrialId: "trial-1",
    reason: "synthesis_rerun",
    createdAt: 1500,
  };
}

function makeObservation(id: string, trialId: string): EvaluationObservation {
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

function makePlaybook(id: string, studyId: string): FusionPlaybook {
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
    recommendation: { kind: "adopt", policy: "fuse", configuration: "B + C → Synth", rationale: "ok" },
    poolAdequacy: { probed: true, outcome: "confirmed", challengerKeys: [], note: "ok" },
    claimLevel: "exploratory",
    conclusion: "fuse helps",
    createdAt: 2000,
  };
}

// --- Task entity builders ----------------------------------------------------

function makeTaskRecord(id: string): TaskRecord {
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

function makeTaskVersion(taskId: string, version: number, artifactId: string): TaskVersion {
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

function makeTaskArtifact(id: string, bytes: Uint8Array): TaskArtifact {
  return {
    id,
    contentDigest: computeArtifactDigest(bytes),
    mediaType: "text/plain",
    byteCount: bytes.length,
    storageRef: `local:${id}`,
    createdAt: 1000,
  };
}

function makeArtifactBytes(id: string, bytes: Uint8Array): ArchiveV2TaskArtifactBytes {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { id, bytesBase64: btoa(binary) };
}

function makeTaskInstance(id: string, taskId: string, version: number, artifactId: string): TaskInstance {
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

function makeTaskFamily(id: string): TaskFamily {
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

function makeTaskFamilyAssignment(id: string, taskId: string, version: number, familyId: string): TaskFamilyAssignment {
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

function makeTaskFamilyRelation(id: string, fromFamilyId: string, toFamilyId: string): TaskFamilyRelation {
  return {
    id,
    fromFamilyId,
    toFamilyId,
    kind: "overlap",
    createdAt: 1000,
  };
}

function makeTaskFacetAnnotation(id: string, taskId: string): TaskFacetAnnotation {
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

function makeCrosswalk(taskId: string, version: number): TaskMigrationCrosswalk {
  return {
    legacyScopeKey: `legacy:${taskId}`,
    taskId,
    taskVersion: version,
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
  };
}
