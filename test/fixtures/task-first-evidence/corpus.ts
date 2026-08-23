// =============================================================================
// RSemble AI — Task-first deterministic corpus fixture (Child 10 Task 10)
//
// Constructs a rich, deterministic evaluation and persistence corpus covering
// all 10 specification corpus cases for the 11 program invariants:
//
//  1. new ad hoc and canonical comparisons
//  2. retries, failed judge, re-judge, re-fuse
//  3. Task versions, instances, families, facets
//  4. Task Set versions, incomplete evaluation, repair, recovery, roster extension with reused outputs
//  5. Fusion recipes/pools, exploration and confirmation studies, trials, attempts,
//     experimental observations, playbooks, artifacts, canonical and legacy owner routes,
//     and an unresolved owner crosswalk
//  6. exact, rolling, and partial model identities
//  7. compatible and incompatible protocol/Rubric cohorts
//  8. verified pass/fail and judge-only evidence
//  9. legacy runs, suites, profiles, experiments, v1 archive
// 10. partial migrations and ID collisions
// =============================================================================

import type {
  ComparisonResultIndex,
} from "../../../src/lib/compare/comparison-result-types";
import type {
  EvaluationRubric,
  EvaluationSuite,
  ExperimentRecord,
  RubricRecord,
} from "../../../src/lib/evaluations/evaluation-types";
import type {
  TaskSetRecord,
  TaskSetVersion,
} from "../../../src/lib/evaluations/task-set-types";
import type {
  EligibilityDecision,
  ExecutedVerifierOutcome,
  ModelConfigurationSnapshot,
  Observation,
} from "../../../src/lib/evidence/evidence-types";
import type { EvidenceLedgerRow } from "../../../src/lib/evidence/evidence-counting";
import type {
  RSembleEvaluationDB,
  TaskSetOwnershipCrosswalkRow,
  PolicyPlaybookRow,
} from "../../../src/lib/persistence/database";
import type {
  FullRunSummaryV2,
  LegacyRunSummary,
  RunRecordV2,
} from "../../../src/lib/persistence/run-types";
import type { TaskSetMaterializationRecord } from "../../../src/lib/persistence/evaluation-repository";
import type { WorkbenchArchiveV1 } from "../../../src/lib/persistence/archive";
import type {
  LabRecipeRecord,
  LabRecipeVersion,
} from "../../../src/lib/studies/lab-recipe-types";
import type {
  ModelPoolRecord,
  ModelPoolVersion,
} from "../../../src/lib/studies/model-pool-types";
import type {
  PolicyReportPayload,
  PolicyStudyObservation,
  PolicyStudyRecord,
  PolicyStudyTrial,
} from "../../../src/lib/studies/policy/policy-study-types";
import type { StudyAttempt } from "../../../src/lib/studies/study-types";
import type {
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "../../../src/lib/tasks/task-types";
import * as v2fx from "../../../src/lib/persistence/archive-v2-fixtures";
import * as v3fx from "../../../src/lib/persistence/archive-v3-fixtures";
import { fusionToResearchLabReceiptKey } from "../../../src/lib/migrations/fusion-to-research-lab";
import { createDeterministicReceipt } from "../../../src/lib/migrations/fusion-to-research-lab-receipt";
import { fingerprintStudyValue } from "../../../src/lib/studies/study-fingerprint";

export const CORPUS_DETERMINISTIC_NOW = 1_720_000_000_000;

export const DIGEST_A = "sha256:" + "a".repeat(64);
export const DIGEST_B = "sha256:" + "b".repeat(64);
export const DIGEST_C = "sha256:" + "c".repeat(64);

export const MC_EXACT_ID = `mc:${DIGEST_A}`;
export const MC_ROLLING_ID = `mc:${DIGEST_B}`;
export const MC_PARTIAL_ID = `mc:${DIGEST_C}`;

export interface DeterministicCorpus {
  db: RSembleEvaluationDB;
  runs: {
    run1: RunRecordV2;
    runAdHoc: RunRecordV2;
    runRetry: RunRecordV2;
    runReFuse: RunRecordV2;
    runLegacySummary: FullRunSummaryV2;
    legacySummaryOnly: LegacyRunSummary;
  };
  tasks: {
    task1: TaskRecord;
    task2: TaskRecord;
    task1_v1: TaskVersion;
    task1_v2: TaskVersion;
    task2_v1: TaskVersion;
    taskInstances: TaskInstance[];
    families: TaskFamily[];
    familyAssignments: TaskFamilyAssignment[];
    familyRelations: TaskFamilyRelation[];
    facetAnnotations: TaskFacetAnnotation[];
  };
  rubrics: {
    rubric1: RubricRecord;
    rubric1_v1: EvaluationRubric;
    rubric2: RubricRecord;
    rubric2_v1: EvaluationRubric;
  };
  taskSets: {
    taskSet1: TaskSetRecord;
    taskSet1_v1: TaskSetVersion;
    taskSet1_v2: TaskSetVersion;
    materialization1: TaskSetMaterializationRecord;
  };
  experiments: {
    expComplete: ExperimentRecord;
    expIncomplete: ExperimentRecord;
    expRepaired: ExperimentRecord;
    expRosterExtension: ExperimentRecord;
  };
  comparisons: {
    adhoc: ComparisonResultIndex;
    canonical: ComparisonResultIndex;
    withRetry: ComparisonResultIndex;
    withReFuse: ComparisonResultIndex;
  };
  modelConfigurations: {
    exact: ModelConfigurationSnapshot;
    rolling: ModelConfigurationSnapshot;
    partial: ModelConfigurationSnapshot;
  };
  evidence: {
    observations: Observation[];
    decisions: EligibilityDecision[];
    countingRows: EvidenceLedgerRow[];
    verifierOutcomes: ExecutedVerifierOutcome[];
  };
  studies: {
    exploratory: PolicyStudyRecord;
    confirmed: PolicyStudyRecord;
    recipes: LabRecipeRecord[];
    recipeVersions: LabRecipeVersion[];
    pools: ModelPoolRecord[];
    poolVersions: ModelPoolVersion[];
    trials: PolicyStudyTrial[];
    attempts: StudyAttempt[];
    studyObservations: PolicyStudyObservation[];
    playbooks: PolicyPlaybookRow[];
    crosswalks: TaskSetOwnershipCrosswalkRow[];
  };
  collisionEntities: {
    task: TaskRecord;
    taskSet: TaskSetRecord;
  };
  v1Archive: WorkbenchArchiveV1;
}

export function buildCorpusArchiveV1Fixture(): WorkbenchArchiveV1 {
  return {
    schemaVersion: 1,
    exportedAt: CORPUS_DETERMINISTIC_NOW,
    runs: {
      summaries: [v2fx.makeRunSummary("run-v1-1")],
      details: [v2fx.makeRunDetail("run-v1-1")],
    },
    profiles: {
      identities: [v2fx.makeRubricRecord("rubric-v1-1")],
      versions: [v2fx.makeRubricVersion("rubric-v1-1", 1)],
    },
    suites: [v2fx.makeSuite("suite-v1-1")],
    experiments: [v2fx.makeExperiment("exp-v1-1", "suite-v1-1")],
  };
}

export async function buildDeterministicCorpus(
  db: RSembleEvaluationDB,
): Promise<DeterministicCorpus> {
  // 1. Rubrics
  const rubric1 = v2fx.makeRubricRecord("rubric-1");
  rubric1.name = "Code Quality & Correctness";
  const rubric1_v1 = v2fx.makeRubricVersion("rubric-1", 1);
  rubric1_v1.title = "Code Quality & Correctness v1";

  const rubric2 = v2fx.makeRubricRecord("rubric-2");
  rubric2.name = "Reasoning Depth";
  const rubric2_v1 = v2fx.makeRubricVersion("rubric-2", 1);
  rubric2_v1.title = "Reasoning Depth v1";

  await db.profiles.put(v2fx.profileRow(rubric1));
  await db.profiles.put(v2fx.profileRow(rubric2));
  await db.profileVersions.put(v2fx.profileVersionRow(rubric1_v1));
  await db.profileVersions.put(v2fx.profileVersionRow(rubric2_v1));

  // 2. Tasks, Versions, Artifacts, Instances, Families, Facets
  const task1 = v2fx.makeTaskRecord("task-canon-1");
  task1.latestVersion = 2;
  task1.name = "Refactor State Machine";
  task1.description = "Refactor concurrent lease state machine";

  const task2 = v2fx.makeTaskRecord("task-canon-2");
  task2.latestVersion = 1;
  task2.name = "Deadlock Prevention";
  task2.description = "Analyze two-phase lock ordering";

  const artifactBytes1 = new TextEncoder().encode("export function solveStateMachine() { return true; }");
  const artifactBytes2 = new TextEncoder().encode("export function solveStateMachineV2() { return 42; }");
  const artifactBytes3 = new TextEncoder().encode("export function solveDeadlock() { return 'ok'; }");

  const artifact1 = v2fx.makeTaskArtifact("art-1", artifactBytes1);
  const artifact2 = v2fx.makeTaskArtifact("art-2", artifactBytes2);
  const artifact3 = v2fx.makeTaskArtifact("art-3", artifactBytes3);

  const task1_v1 = v2fx.makeTaskVersion("task-canon-1", 1, "art-1");
  task1_v1.title = "Refactor State Machine v1";
  task1_v1.rubricRef = { id: "rubric-1", version: 1 };

  const task1_v2 = v2fx.makeTaskVersion("task-canon-1", 2, "art-2");
  task1_v2.title = "Refactor State Machine v2";
  task1_v2.rubricRef = { id: "rubric-1", version: 1 };

  const task2_v1 = v2fx.makeTaskVersion("task-canon-2", 1, "art-3");
  task2_v1.title = "Deadlock Prevention v1";
  task2_v1.rubricRef = { id: "rubric-2", version: 1 };

  const inst1_v1 = v2fx.makeTaskInstance("inst-1-v1", "task-canon-1", 1, "seed-1");
  const inst1_v2 = v2fx.makeTaskInstance("inst-1-v2", "task-canon-1", 2, "seed-1");
  const inst2_v1 = v2fx.makeTaskInstance("inst-2-v1", "task-canon-2", 1, "seed-2");

  const fam1 = v2fx.makeTaskFamily("fam-concurrency");
  fam1.name = "Concurrency & State";
  fam1.description = "Tasks evaluating concurrency management";

  const fam2 = v2fx.makeTaskFamily("fam-distributed");
  fam2.name = "Distributed Coordination";
  fam2.description = "Tasks evaluating distributed state";

  const famAssign1 = v2fx.makeTaskFamilyAssignment("fa-1", "task-canon-1", 1, "fam-concurrency");
  const famAssign2 = v2fx.makeTaskFamilyAssignment("fa-2", "task-canon-2", 1, "fam-concurrency");

  const famRel1 = v2fx.makeTaskFamilyRelation("fr-1", "fam-concurrency", "fam-distributed");

  const facet1 = v2fx.makeTaskFacetAnnotation("facet-1", "task-canon-1");
  facet1.facetId = "engineering";
  facet1.value = "debugging";

  await db.tasks.put(v2fx.taskRecordRow(task1));
  await db.tasks.put(v2fx.taskRecordRow(task2));
  await db.taskVersions.put(v2fx.taskVersionRow(task1_v1));
  await db.taskVersions.put(v2fx.taskVersionRow(task1_v2));
  await db.taskVersions.put(v2fx.taskVersionRow(task2_v1));
  await db.taskArtifacts.put(v2fx.taskArtifactRow(artifact1));
  await db.taskArtifacts.put(v2fx.taskArtifactRow(artifact2));
  await db.taskArtifacts.put(v2fx.taskArtifactRow(artifact3));
  await db.taskArtifactBytes.put(v2fx.taskArtifactBytesRow("art-1", artifactBytes1));
  const crosswalk1 = v2fx.makeCrosswalk("task-canon-1", 1);
  crosswalk1.legacyScopeKey = "legacy:suite-1:task-1";
  await db.taskInstances.put(v2fx.taskInstanceRow(inst1_v1));
  await db.taskInstances.put(v2fx.taskInstanceRow(inst1_v2));
  await db.taskInstances.put(v2fx.taskInstanceRow(inst2_v1));
  await db.taskFamilies.put(v2fx.taskFamilyRow(fam1));
  await db.taskFamilies.put(v2fx.taskFamilyRow(fam2));
  await db.taskFamilyAssignments.put(v2fx.taskFamilyAssignmentRow(famAssign1));
  await db.taskFamilyAssignments.put(v2fx.taskFamilyAssignmentRow(famAssign2));
  await db.taskFamilyRelations.put(v2fx.taskFamilyRelationRow(famRel1));
  await db.taskFacetAnnotations.put(v2fx.taskFacetAnnotationRow(facet1));
  await db.taskMigrationCrosswalk.put(v2fx.taskMigrationCrosswalkRow(crosswalk1));

  // ID-collision entity across distinct collections (Task vs TaskSet)
  const collisionTaskId = "collision-entity-1";
  const collisionTask = v2fx.makeTaskRecord(collisionTaskId);
  collisionTask.name = "ID Collision Task Entity";
  const collisionTaskVersion = v2fx.makeTaskVersion(collisionTaskId, 1, "art-1");
  await db.tasks.put(v2fx.taskRecordRow(collisionTask));
  await db.taskVersions.put(v2fx.taskVersionRow(collisionTaskVersion));

  // 3. Task Sets & Versions & Materializations
  const taskSet1 = v2fx.makeTaskSetRecord("taskset-1");
  taskSet1.latestVersion = 2;
  taskSet1.name = "Frontend Reliability Set";
  taskSet1.description = "Core suite for client reliability and state recovery";

  const taskSet1_v1 = v2fx.makeTaskSetVersion("taskset-1", 1);
  taskSet1_v1.name = "Frontend Reliability v1";
  taskSet1_v1.members = [
    {
      id: "member-1",
      taskVersionRef: { taskId: "task-canon-1", version: 1 },
      order: 0,
      role: "organic",
      stratum: "core",
      weight: 1,
      rubricOverrideRef: null,
      executionOverrides: null,
      unresolved: null,
    },
  ];

  const taskSet1_v2 = v2fx.makeTaskSetVersion("taskset-1", 2);
  taskSet1_v2.name = "Frontend Reliability v2";
  taskSet1_v2.members = [
    {
      id: "member-1",
      taskVersionRef: { taskId: "task-canon-1", version: 2 },
      order: 0,
      role: "organic",
      stratum: "core",
      weight: 1,
      rubricOverrideRef: null,
      executionOverrides: null,
      unresolved: null,
    },
    {
      id: "member-2",
      taskVersionRef: { taskId: "task-canon-2", version: 1 },
      order: 1,
      role: "organic",
      stratum: "challenger",
      weight: 1,
      rubricOverrideRef: null,
      executionOverrides: null,
      unresolved: null,
    },
  ];

  const mat1 = v2fx.makeTaskSetMaterialization("mat-1", "taskset-1", 1);

  // Put Task Sets, Versions, and Materialization into Dexie
  await db.taskSets.put(v2fx.taskSetRecordRow(taskSet1));
  await db.taskSetVersions.put(v2fx.taskSetVersionRow(taskSet1_v1));
  await db.taskSetVersions.put(v2fx.taskSetVersionRow(taskSet1_v2));
  await db.taskSetMaterializations.put(v2fx.taskSetMaterializationRow(mat1));

  // Same-ID TaskSet for collision testing across collections
  const collisionTaskSet = v2fx.makeTaskSetRecord(collisionTaskId);
  collisionTaskSet.name = "ID Collision TaskSet Entity";
  const collisionTaskSetVersion = v2fx.makeTaskSetVersion(collisionTaskId, 1);
  collisionTaskSetVersion.members = [
    {
      id: "member-col-1",
      taskVersionRef: { taskId: "task-canon-1", version: 1 },
      order: 0,
      role: "organic",
      stratum: "core",
      weight: 1,
      rubricOverrideRef: null,
      executionOverrides: null,
      unresolved: null,
    },
  ];
  await db.taskSets.put(v2fx.taskSetRecordRow(collisionTaskSet));
  await db.taskSetVersions.put(v2fx.taskSetVersionRow(collisionTaskSetVersion));

  // 4. Model Configurations: exact, rolling, partial
  const mcExact = v2fx.makeModelConfiguration(MC_EXACT_ID);
  mcExact.providerId = "openrouter";
  mcExact.requestedModel = "anthropic/claude-3.5-sonnet";
  mcExact.resolvedModel = "anthropic/claude-3.5-sonnet-20241022";
  mcExact.resolvedVersion = "20241022";
  mcExact.identityCompleteness = "exact";

  const mcRolling = v2fx.makeModelConfiguration(MC_ROLLING_ID);
  mcRolling.providerId = "openai";
  mcRolling.requestedModel = "gpt-4o";
  mcRolling.resolvedModel = "gpt-4o";
  mcRolling.resolvedVersion = null;
  mcRolling.identityCompleteness = "rolling_alias";

  const mcPartial = v2fx.makeModelConfiguration(MC_PARTIAL_ID);
  mcPartial.providerId = "custom";
  mcPartial.requestedModel = "custom-agent";
  mcPartial.resolvedModel = null;
  mcPartial.resolvedVersion = null;
  mcPartial.identityCompleteness = "partial";

  await db.modelConfigurations.put(v2fx.modelConfigurationRow(mcExact));
  await db.modelConfigurations.put(v2fx.modelConfigurationRow(mcRolling));
  await db.modelConfigurations.put(v2fx.modelConfigurationRow(mcPartial));

  // 5. Runs: 1, adhoc, retry, refuse, legacy summary
  const run1 = v2fx.makeRunDetail("run-1");
  run1.source = { kind: "adhoc" };

  const runAdHoc = v2fx.makeRunDetail("run-adhoc");
  runAdHoc.title = "Ad-hoc Comparison Execution";
  runAdHoc.source = { kind: "adhoc" };

  const runRetry = v2fx.makeRunDetail("run-retry");
  runRetry.title = "Retry Execution on State Machine";
  runRetry.source = { kind: "adhoc" };
  runRetry.candidates = [
    {
      candidateId: "c-1",
      slotId: "slot-1",
      modelKey: "openrouter:anthropic/claude-3.5-sonnet",
      providerId: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      slug: "claude-3.5-sonnet",
      acceptedAttemptId: "att-2",
      attempts: [
        {
          attemptId: "att-1",
          messages: [{ role: "user", content: "Solve state machine" }],
          startedAt: 1000,
          finishedAt: 1400,
          status: "failed",
          output: null,
          tokensIn: 10,
          tokensOut: 0,
          error: {
            message: "Rate limit exceeded",
          },
        },
        {
          attemptId: "att-2",
          messages: [{ role: "user", content: "Solve state machine" }],
          startedAt: 1400,
          finishedAt: 2200,
          status: "completed",
          output: "Fixed solution with lease validation",
          tokensIn: 100,
          tokensOut: 50,
          error: null,
        },
      ],
    },
  ];
  runRetry.judge = {
    status: "idle",
    acceptedAttemptId: null,
    report: null,
    consensus: null,
    attempts: [
      {
        attemptId: "judge-att-1",
        providerId: "openrouter",
        model: "openai/gpt-4o",
        instruction: "Evaluate correctness",
        messages: [{ role: "user", content: "Judge attempt 1" }],
        blindLabelToCandidateId: { A: "c-1" },
        candidateAttemptIdsByCandidateId: { "c-1": "att-1" },
        startedAt: 2200,
        finishedAt: 2400,
        status: "failed",
        error: { message: "Candidate output is null" },
        report: null,
        consensus: null,
      },
      {
        attemptId: "judge-att-2",
        providerId: "openrouter",
        model: "openai/gpt-4o",
        instruction: "Evaluate correctness",
        messages: [{ role: "user", content: "Judge attempt 2" }],
        blindLabelToCandidateId: { A: "c-1" },
        candidateAttemptIdsByCandidateId: { "c-1": "att-2" },
        startedAt: 2400,
        finishedAt: 2850,
        status: "completed",
        error: null,
        report: null,
        consensus: null,
      },
    ],
  };
  runRetry.winnerKeys = ["openrouter:anthropic/claude-3.5-sonnet"];

  // Re-fuse run fixture
  const runReFuse = v2fx.makeRunDetail("run-refuse");
  runReFuse.title = "Comparison With Re-Fuse Attempt";
  runReFuse.mode = "fuse";
  runReFuse.source = { kind: "adhoc" };
  runReFuse.candidates = [
    {
      candidateId: "c-1",
      slotId: "slot-1",
      modelKey: "openrouter:anthropic/claude-3.5-sonnet",
      providerId: "openrouter",
      model: "anthropic/claude-3.5-sonnet",
      slug: "claude-3.5-sonnet",
      acceptedAttemptId: "att-refuse-c1",
      attempts: [
        {
          attemptId: "att-refuse-c1",
          messages: [{ role: "user", content: "Solve state machine" }],
          startedAt: 1000,
          finishedAt: 2000,
          status: "completed",
          output: "Candidate solution for fusion",
          tokensIn: 80,
          tokensOut: 40,
          error: null,
        },
      ],
    },
  ];
  runReFuse.judge = {
    status: "done",
    acceptedAttemptId: "judge-att-refuse-1",
    report: {
      labelMap: [{ label: "A", candidateId: "c-1" }],
      evaluationsById: {
        "c-1": {
          candidateId: "c-1",
          blindLabel: "A",
          overallScore: 90,
          position: "rank 1",
          rationale: "Good candidate output",
          strengths: ["clear logic"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [],
        },
      },
      comparisons: [],
    },
    consensus: null,
    attempts: [
      {
        attemptId: "judge-att-refuse-1",
        providerId: "openrouter",
        model: "openai/gpt-4o",
        instruction: "Evaluate correctness",
        messages: [{ role: "user", content: "Judge attempt for fusion" }],
        blindLabelToCandidateId: { A: "c-1" },
        candidateAttemptIdsByCandidateId: { "c-1": "att-refuse-c1" },
        startedAt: 2100,
        finishedAt: 2500,
        status: "completed",
        error: null,
        report: null,
        consensus: null,
      },
    ],
  };
  runReFuse.fusion = {
    status: "done",
    acceptedAttemptId: "fusion-att-2",
    attempts: [
      {
        attemptId: "fusion-att-1",
        providerId: "openrouter",
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Fuse candidates attempt 1" }],
        sourceJudgeAttemptId: "judge-att-refuse-1",
        candidateAttemptIdsByCandidateId: { "c-1": "att-refuse-c1" },
        startedAt: 2600,
        finishedAt: 3000,
        status: "completed",
        result: "Initial fusion output",
        error: null,
      },
      {
        attemptId: "fusion-att-2",
        providerId: "openrouter",
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Fuse candidates attempt 2 (re-fuse)" }],
        sourceJudgeAttemptId: "judge-att-refuse-1",
        candidateAttemptIdsByCandidateId: { "c-1": "att-refuse-c1" },
        startedAt: 3100,
        finishedAt: 3600,
        status: "completed",
        result: "Re-fused consensus output",
        error: null,
      },
    ],
  };
  runReFuse.winnerKeys = ["openrouter:anthropic/claude-3.5-sonnet"];

  const run1Summary = v2fx.makeRunSummary("run-1");
  const runAdHocSummary = v2fx.makeRunSummary("run-adhoc");
  const runRetrySummary = v2fx.makeRunSummary("run-retry");
  const runReFuseSummary = v2fx.makeRunSummary("run-refuse");
  runReFuseSummary.mode = "fuse";

  const legacySummaryOnly: LegacyRunSummary = {
    id: "run-legacy-1",
    kind: "legacy",
    schemaVersion: "1-import",
    createdAt: CORPUS_DETERMINISTIC_NOW - 100_000,
    taskExcerpt: "Historical run prompt summary",
    modelKeys: ["openai:gpt-4"],
    winnerKeys: ["openai:gpt-4"],
    scoresByModelKey: { "openai:gpt-4": 88 },
    detailAvailable: false,
    searchText: "Historical Run 2025 openai:gpt-4",
  };

  await db.runDetails.put(v2fx.runDetailRow(run1));
  await db.runDetails.put(v2fx.runDetailRow(runAdHoc));
  await db.runDetails.put(v2fx.runDetailRow(runRetry));
  await db.runDetails.put(v2fx.runDetailRow(runReFuse));

  await db.runSummaries.put(v2fx.runSummaryRow(run1Summary));
  await db.runSummaries.put(v2fx.runSummaryRow(runAdHocSummary));
  await db.runSummaries.put(v2fx.runSummaryRow(runRetrySummary));
  await db.runSummaries.put(v2fx.runSummaryRow(runReFuseSummary));
  await db.runSummaries.put({
    kind: "legacy",
    summary: legacySummaryOnly,
    id: legacySummaryOnly.id,
    revision: 0,
    createdAt: legacySummaryOnly.createdAt,
    completedAt: null,
    status: null,
    mode: null,
    sourceKind: "adhoc",
    sourceProtocolFingerprint: null,
    sourceExperimentTaskAttemptId: null,
    modelKeys: legacySummaryOnly.modelKeys,
  });

  // 6. Suites & Experiments (Complete, Incomplete, Repaired, Roster Extension)
  const suite1 = v2fx.makeSuite("suite-1");
  suite1.name = "Legacy Suite 1";

  const expComplete = v2fx.makeExperiment("exp-complete", "suite-missing");
  expComplete.createdAt = CORPUS_DETERMINISTIC_NOW;
  expComplete.status = "completed";
  expComplete.tasks = [
    {
      taskId: "task-canon-1",
      selectedAttemptId: "att-exp-1",
      attempts: [
        {
          id: "att-exp-1",
          runId: "run-1",
          trial: 1,
          status: "completed",
          startedAt: 1000,
          finishedAt: 2000,
          error: null,
        },
      ],
    },
  ];

  const expIncomplete = v2fx.makeExperiment("exp-incomplete", "suite-1");
  expIncomplete.status = "interrupted";
  expIncomplete.tasks = [
    {
      taskId: "task-canon-1",
      selectedAttemptId: "att-exp-2",
      attempts: [
        {
          id: "att-exp-2",
          runId: "run-retry",
          trial: 1,
          status: "completed",
          startedAt: 1000,
          finishedAt: 2000,
          error: null,
        },
      ],
    },
    {
      taskId: "task-canon-2",
      selectedAttemptId: null,
      attempts: [],
    },
  ];

  const expRepaired = v2fx.makeExperiment("exp-repaired", "suite-1");
  expRepaired.status = "completed";
  expRepaired.tasks = [
    {
      taskId: "task-canon-1",
      selectedAttemptId: "att-repair-2",
      attempts: [
        {
          id: "att-repair-1",
          runId: "run-1",
          trial: 1,
          status: "failed",
          startedAt: 1000,
          finishedAt: 1500,
          error: { message: "Transient rate limit" },
        },
        {
          id: "att-repair-2",
          runId: "run-retry",
          trial: 1,
          status: "completed",
          startedAt: 1600,
          finishedAt: 2400,
          error: null,
          repair: {
            kind: "missing-cells",
            baseRunId: "run-1",
            requestedModelKeys: ["openrouter:anthropic/claude-3.5-sonnet"],
          },
        },
      ],
    },
  ];

  const expRosterExtension = v2fx.makeExperiment("exp-roster-ext", "suite-1");
  expRosterExtension.status = "completed";

  await db.suites.put(v2fx.suiteRow(suite1));
  await db.experiments.put(v2fx.experimentRow(expComplete));
  await db.experiments.put(v2fx.experimentRow(expIncomplete));
  await db.experiments.put(v2fx.experimentRow(expRepaired));
  await db.experiments.put(v2fx.experimentRow(expRosterExtension));

  // 7. Comparisons: adhoc, canonical, withRetry, withReFuse
  const compSnapRef = "snap:sha256:" + "d".repeat(64);

  const compAdHoc = v2fx.makeComparisonIndex("run-adhoc", {
    taskBinding: { kind: "ad_hoc", inputSnapshotRef: compSnapRef },
    title: "Ad-hoc Comparison 1",
    runId: "run-adhoc",
    status: "completed",
    mode: "rank",
  });

  const compCanonical = v2fx.makeComparisonIndex("run-1", {
    taskBinding: { kind: "canonical", taskId: "task-canon-1", taskVersion: 1 },
    title: "Canonical Task Comparison",
    runId: "run-1",
    status: "completed",
    mode: "rank",
  });

  const compWithRetry = v2fx.makeComparisonIndex("run-retry", {
    taskBinding: { kind: "canonical", taskId: "task-canon-1", taskVersion: 2 },
    title: "Comparison With Retry Lineage",
    runId: "run-retry",
    status: "completed",
    mode: "fuse",
  });

  const compWithReFuse = v2fx.makeComparisonIndex("run-refuse", {
    taskBinding: { kind: "canonical", taskId: "task-canon-1", taskVersion: 1 },
    title: "Comparison With Re-Fuse Lineage",
    runId: "run-refuse",
    status: "completed",
    mode: "fuse",
  });

  await db.comparisonResults.put(compAdHoc);
  await db.comparisonResults.put(compCanonical);
  await db.comparisonResults.put(compWithRetry);
  await db.comparisonResults.put(compWithReFuse);

  // 8. Evidence Observations, Decisions, Verifier Outcomes, Counting Rows
  const obs1 = v2fx.makeEvidenceObservation(MC_EXACT_ID, {
    sourceKind: "evaluation",
    sourceResultId: "run-1",
    taskId: "task-canon-1",
    taskVersion: 1,
    taskInstanceId: "inst-1-v1",
    observedAt: CORPUS_DETERMINISTIC_NOW,
    outcome: {
      judgeAccepted: true,
      overallScore: 92,
      criterionValues: [{ criterionId: "crit-1", value: 92 }],
      verifierPassed: null,
    },
  });

  const obs2 = v2fx.makeEvidenceObservation(MC_ROLLING_ID, {
    sourceKind: "evaluation",
    sourceResultId: "run-retry",
    taskId: "task-canon-1",
    taskVersion: 2,
    taskInstanceId: "inst-1-v2",
    observedAt: CORPUS_DETERMINISTIC_NOW + 1000,
    outcome: {
      judgeAccepted: true,
      overallScore: 88,
      criterionValues: [{ criterionId: "crit-1", value: 88 }],
      verifierPassed: null,
    },
  });

  const obs3 = v2fx.makeEvidenceObservation(MC_EXACT_ID, {
    sourceKind: "comparison",
    sourceResultId: "run-1",
    taskId: "task-canon-1",
    taskVersion: 1,
    taskInstanceId: "inst-1-v1",
    observedAt: CORPUS_DETERMINISTIC_NOW + 2000,
    outcome: {
      judgeAccepted: true,
      overallScore: 95,
      criterionValues: [{ criterionId: "crit-1", value: 95 }],
      verifierPassed: null,
    },
  });

  const dec1 = v2fx.makeEligibilityDecision(obs1.id);
  dec1.status = "eligible";

  const dec2 = v2fx.makeEligibilityDecision(obs2.id);
  dec2.status = "provisional";
  dec2.reasonCodes = ["model_version_unreported"];

  const dec3 = v2fx.makeEligibilityDecision(obs3.id);
  dec3.status = "eligible";

  const vo1 = v2fx.makeExecutedVerifierOutcome("run-1", "task-canon-1", "openrouter:m1");
  vo1.passed = true;

  const vo2 = v2fx.makeExecutedVerifierOutcome("run-retry", "task-canon-1", "openrouter:m1");
  vo2.passed = false;

  await db.observations.put(v2fx.evidenceObservationRow(obs1));
  await db.observations.put(v2fx.evidenceObservationRow(obs2));
  await db.observations.put(v2fx.evidenceObservationRow(obs3));
  await db.evidenceDecisions.put(v2fx.evidenceDecisionRow(dec1));
  await db.evidenceDecisions.put(v2fx.evidenceDecisionRow(dec2));
  await db.evidenceDecisions.put(v2fx.evidenceDecisionRow(dec3));
  await db.verifierOutcomes.put(v2fx.verifierOutcomeRow(vo1));
  await db.verifierOutcomes.put(v2fx.verifierOutcomeRow(vo2));
  const countingRows: EvidenceLedgerRow[] = [
    {
      lineageCellKey: "task-canon-1:1:inst-1-v1:mc:exact",
      taskId: "task-canon-1",
      taskVersion: 1,
      taskInstanceId: "inst-1-v1",
      modelConfigurationId: MC_EXACT_ID,
      sequence: 1,
      candidateAttemptId: "att-1",
      reusedCandidateOutput: false,
      declaredReplicate: false,
      assessmentEventId: "judge-att-1",
      attemptIds: ["att-1", "att-2"],
    },
    {
      lineageCellKey: "task-canon-1:2:inst-1-v2:mc:rolling",
      taskId: "task-canon-1",
      taskVersion: 2,
      taskInstanceId: "inst-1-v2",
      modelConfigurationId: MC_ROLLING_ID,
      sequence: 1,
      candidateAttemptId: "att-3",
      reusedCandidateOutput: true,
      declaredReplicate: false,
      assessmentEventId: "judge-att-2",
      attemptIds: ["att-3"],
    },
  ];

  // 9. Research Lab: Recipes, Pools, Exploration & Confirmation Studies, Trials, Observations, Playbooks
  const recipe1 = v3fx.makeLabRecipeRecord("recipe-1");
  const recipe1_v1 = v3fx.makeLabRecipeVersion("recipe-1", 1);
  const pool1 = v3fx.makeModelPoolRecord("pool-1");
  const pool1_v1 = v3fx.makeModelPoolVersion("pool-1", 1);

  const studyExploratory = v3fx.makePolicyStudyRecord("study-exploratory");
  studyExploratory.title = "Lease Recovery Policy Exploration";
  studyExploratory.claimLevel = "exploratory";
  studyExploratory.reportRef = "study-exploratory";
  studyExploratory.definition.workload = {
    taskSetId: "taskset-1",
    version: 1,
    manifestDigest: DIGEST_A,
  };
  studyExploratory.definitionFingerprint = fingerprintStudyValue(studyExploratory.definition);

  const studyConfirmed = v3fx.makePolicyStudyRecord("study-confirmed");
  studyConfirmed.title = "Lease Recovery Policy Confirmation";
  studyConfirmed.claimLevel = "confirmed";
  studyConfirmed.confirmationOf = "study-exploratory";
  studyConfirmed.reportRef = "study-confirmed";
  studyConfirmed.definition.workload = {
    taskSetId: "taskset-1",
    version: 2,
    manifestDigest: DIGEST_B,
  };
  studyConfirmed.definition.claimPlan = "confirmation";
  studyConfirmed.definitionFingerprint = fingerprintStudyValue(studyConfirmed.definition);

  const trial1 = v3fx.makePolicyStudyTrial("trial-1", "study-exploratory");
  const trial2 = v3fx.makeStudyTrialSuccessor("trial-2", "study-exploratory");

  const attempt1 = v3fx.makeStudyAttempt("attempt-1", "study-exploratory", "trial-1", "trial-2");
  const studyObs1 = v3fx.makePolicyStudyObservation("obs-study-1", "study-exploratory", "trial-1");

  const playbook1 = v3fx.makePolicyReportPayload("study-exploratory");
  const playbookRow1: PolicyPlaybookRow = {
    id: "study-exploratory",
    studyId: "study-exploratory",
    definitionFingerprint: studyExploratory.definitionFingerprint,
    digest: `sha256:pb1`,
    playbook: playbook1,
    createdAt: CORPUS_DETERMINISTIC_NOW,
  };

  const playbook2 = v3fx.makePolicyReportPayload("study-confirmed");
  const playbookRow2: PolicyPlaybookRow = {
    id: "study-confirmed",
    studyId: "study-confirmed",
    definitionFingerprint: studyConfirmed.definitionFingerprint,
    digest: `sha256:pb2`,
    playbook: playbook2,
    createdAt: CORPUS_DETERMINISTIC_NOW,
  };

  await db.labRecipeRecords.put({
    id: recipe1.id,
    record: recipe1,
    kind: recipe1.kind,
    latestVersion: recipe1.latestVersion,
    archivedAt: recipe1.archivedAt,
    createdAt: recipe1.createdAt,
    updatedAt: recipe1.updatedAt,
    revision: recipe1.revision,
  });
  await db.labRecipeVersions.put({
    recipeId: recipe1_v1.recipeId,
    version: recipe1_v1.version,
    version_: recipe1_v1,
    digest: recipe1_v1.digest,
    createdAt: recipe1_v1.createdAt,
  });
  await db.modelPoolRecords.put({
    id: pool1.id,
    record: pool1,
    latestVersion: pool1.latestVersion,
    archivedAt: pool1.archivedAt,
    createdAt: pool1.createdAt,
    updatedAt: pool1.updatedAt,
    revision: pool1.revision,
  });
  await db.modelPoolVersions.put({
    poolId: pool1_v1.poolId,
    version: pool1_v1.version,
    version_: pool1_v1,
    digest: pool1_v1.digest,
    createdAt: pool1_v1.createdAt,
  });
  await db.studies.put({
    id: studyExploratory.id,
    record: studyExploratory,
    kind: studyExploratory.kind,
    status: studyExploratory.status,
    claimLevel: studyExploratory.claimLevel,
    confirmationOf: studyExploratory.confirmationOf,
    revision: studyExploratory.revision,
    createdAt: studyExploratory.createdAt,
    updatedAt: studyExploratory.updatedAt,
    archivedAt: studyExploratory.archivedAt,
  });
  await db.studies.put({
    id: studyConfirmed.id,
    record: studyConfirmed,
    kind: studyConfirmed.kind,
    status: studyConfirmed.status,
    claimLevel: studyConfirmed.claimLevel,
    confirmationOf: studyConfirmed.confirmationOf,
    revision: studyConfirmed.revision,
    createdAt: studyConfirmed.createdAt,
    updatedAt: studyConfirmed.updatedAt,
    archivedAt: studyConfirmed.archivedAt,
  });
  await db.studyTrials.put({
    id: trial1.id,
    trial: trial1,
    studyId: trial1.studyId,
    status: trial1.status,
    sampleIndex: trial1.sampleIndex,
    revision: 1,
    createdAt: trial1.createdAt,
    sealedAt: trial1.sealedAt,
  });
  await db.studyTrials.put({
    id: trial2.id,
    trial: trial2,
    studyId: trial2.studyId,
    status: trial2.status,
    sampleIndex: trial2.sampleIndex,
    revision: 1,
    createdAt: trial2.createdAt,
    sealedAt: trial2.sealedAt,
  });
  await db.studyAttempts.put({
    id: attempt1.id,
    attempt: attempt1,
    studyId: attempt1.studyId,
    fromTrialId: attempt1.fromTrialId,
    toTrialId: attempt1.toTrialId,
    createdAt: attempt1.createdAt,
  });
  await db.studyObservations.put({
    id: studyObs1.id,
    observation: studyObs1,
    studyId: studyObs1.studyId,
    trialId: studyObs1.trialId,
    status: studyObs1.status,
    createdAt: studyObs1.createdAt,
    finishedAt: studyObs1.finishedAt,
  });
  await db.policyPlaybooks.put(playbookRow1);
  await db.policyPlaybooks.put(playbookRow2);

  // 10. Task Set Ownership Crosswalks
  const xwalkSuite = v2fx.makeSuiteManifestCrosswalk("taskset-1", DIGEST_A);
  const xwalkExploratory = v2fx.makeFusionOwnerCrosswalk("study-exploratory", "taskset-1");
  const xwalkConfirmed = v2fx.makeFusionOwnerCrosswalk("study-confirmed", "taskset-1");
  xwalkConfirmed.version = 2;
  if (xwalkConfirmed.suiteRef) xwalkConfirmed.suiteRef.suiteVersion = 2;

  // Unresolved experiment owner crosswalk
  const xwalkExpOwner = v2fx.makeExperimentOwnerCrosswalk("exp-complete", "suite-missing");
  xwalkExpOwner.status = "unresolved";
  xwalkExpOwner.version = null;
  xwalkExpOwner.digest = null;
  xwalkExpOwner.note = "suite-not-found";
  xwalkExpOwner.updatedAt = expComplete.createdAt;

  await db.taskSetOwnershipCrosswalk.put(xwalkSuite);
  await db.taskSetOwnershipCrosswalk.put(xwalkExploratory);
  await db.taskSetOwnershipCrosswalk.put(xwalkConfirmed);
  await db.taskSetOwnershipCrosswalk.put(xwalkExpOwner);

  // Store cutover receipt
  const receipt = createDeterministicReceipt({
    generatedAt: CORPUS_DETERMINISTIC_NOW,
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
      labRecipeRecords: 1,
      labRecipeVersions: 1,
      modelPoolRecords: 1,
      modelPoolVersions: 1,
      studies: 2,
      studyTrials: 2,
      studyAttempts: 1,
      studyObservations: 1,
      policyPlaybooks: 2,
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
  await db.storageMeta.put({
    key: fusionToResearchLabReceiptKey,
    value: receipt,
  });

  const v1Archive = buildCorpusArchiveV1Fixture();

  return {
    db,
    runs: {
      run1,
      runAdHoc,
      runRetry,
      runReFuse,
      runLegacySummary: run1Summary,
      legacySummaryOnly,
    },
    tasks: {
      task1,
      task2,
      task1_v1,
      task1_v2,
      task2_v1,
      taskInstances: [inst1_v1, inst1_v2, inst2_v1],
      families: [fam1, fam2],
      familyAssignments: [famAssign1, famAssign2],
      familyRelations: [famRel1],
      facetAnnotations: [facet1],
    },
    rubrics: {
      rubric1,
      rubric1_v1,
      rubric2,
      rubric2_v1,
    },
    taskSets: {
      taskSet1,
      taskSet1_v1,
      taskSet1_v2,
      materialization1: mat1,
    },
    experiments: {
      expComplete,
      expIncomplete,
      expRepaired,
      expRosterExtension,
    },
    comparisons: {
      adhoc: compAdHoc,
      canonical: compCanonical,
      withRetry: compWithRetry,
      withReFuse: compWithReFuse,
    },
    modelConfigurations: {
      exact: mcExact,
      rolling: mcRolling,
      partial: mcPartial,
    },
    evidence: {
      observations: [obs1, obs2, obs3],
      decisions: [dec1, dec2, dec3],
      countingRows,
      verifierOutcomes: [vo1, vo2],
    },
    studies: {
      exploratory: studyExploratory,
      confirmed: studyConfirmed,
      recipes: [recipe1],
      recipeVersions: [recipe1_v1],
      pools: [pool1],
      poolVersions: [pool1_v1],
      trials: [trial1, trial2],
      attempts: [attempt1],
      studyObservations: [studyObs1],
      playbooks: [playbookRow1, playbookRow2],
      crosswalks: [xwalkSuite, xwalkExploratory, xwalkConfirmed, xwalkExpOwner],
    },
    collisionEntities: {
      task: collisionTask,
      taskSet: collisionTaskSet,
    },
    v1Archive,
  };
}
