// =============================================================================
// RSemble AI — family-aggregation.test.ts (Child 07 Task 4, RED)
//
// Hierarchical family aggregation: pure per-cohort aggregates over an exact
// configuration selection. Replicates mean inside a Task Instance; instances
// mean inside a Task Version; versions stay separate unless an explicit Task
// rollup is requested; Tasks have equal weight inside a Task Family. Task Set
// custom weights never enter the global profile. Incompatible metric cohorts
// stay adjacent views. Non-aggregatable states are explicit.
//
// Contract under test (Child 07 spec §6.2–6.3, plan Task 4):
//  - replicates → mean within Task Instance
//  - instances → mean within Task Version
//  - versions → separate by default; explicit Task rollup may average versions
//  - tasks → equal weight inside Task Family
//  - Task Set weights apply only to that Evaluation Result, never the profile
//  - pass/fail only across compatible verifier outcome definitions
//  - judged scores only within declared commensurate Rubric/version mappings
//  - raw criterion values remain available; facets only via authored mappings
//  - incompatible cohorts are adjacent views, never silent pooled inputs
//  - deterministic ordering and explicit tie handling
//  - explicit non-aggregatable states
//  - permutation-invariant; never mutates the selection or source records
// =============================================================================

import { describe, expect, it } from "vitest";

import type { EvidenceLedgerRow } from "../evidence/evidence-counting";
import {
  OBSERVATION_SCHEMA_VERSION,
  type EligibilityDecision,
  type EvaluatorSnapshot,
  type ModelConfigurationSnapshot,
  type Observation,
  type ObservationCriterionValue,
  type ObservationOutcome,
  type VerifierSnapshot,
} from "../evidence/evidence-types";
import type { VersionRef } from "../tasks/task-types";
import {
  MILESTONE_A_GOLDEN,
  milestoneADecisions,
  milestoneALedgerRows,
  milestoneAObservations,
} from "./__fixtures__/milestone-a-golden";
import {
  AGGREGATION_RULE_VERSION,
  aggregateFamilyEvidence,
  buildJudgedScoreCohortId,
  buildPassRateCohortId,
  type AggregatedValue,
  type CohortMetric,
  type CompatibleVerifierDefinition,
  type CommensurateRubricMapping,
  type FamilyAggregate,
  type FamilyAggregationResult,
  type InstanceAggregate,
  type TaskAggregate,
  type VersionedCriterionFacetMapping,
  type VersionAggregate,
} from "./family-aggregation";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  type ModelEvidenceQuery,
  type ResolvedRollupManifest,
  type RollupVersionResolver,
} from "./model-evidence-query";
import {
  profileLineageCellKey,
  selectProfileObservations,
  type ProfileEvidenceCorpus,
  type ProfileExactSelection,
  type ProfileSelectedCell,
  type ProfileSelectedRecord,
} from "./profile-observation-selection";

const CFG = MILESTONE_A_GOLDEN.configurations;
const EXACT_ALPHA = CFG.exactAlpha;
const EXACT_BETA = CFG.exactBeta;
const T0 = 1_704_067_200_000;

const RUBRIC_QUALITY: VersionRef = { id: "rub-quality", version: 3 };
const RUBRIC_QUALITY_V4: VersionRef = { id: "rub-quality", version: 4 };

const PROTOCOL_A = `sha256:${"a".repeat(64)}`;
const PROTOCOL_B = `sha256:${"b".repeat(64)}`;

const JUDGE_A: EvaluatorSnapshot = {
  kind: "model_judge",
  providerId: "openrouter",
  model: "org/judge",
  resolvedVersion: "2026-01-01",
  instructionDigest: `sha256:${"3".repeat(64)}`,
  reasoningEffort: "high",
  toolScaffoldSignature: null,
};

const JUDGE_B: EvaluatorSnapshot = {
  kind: "model_judge",
  providerId: "openrouter",
  model: "org/judge-holdout",
  resolvedVersion: "2026-03-01",
  instructionDigest: `sha256:${"4".repeat(64)}`,
  reasoningEffort: "medium",
  toolScaffoldSignature: "eval-tools:v1",
};

const VERIFIER_A: VerifierSnapshot = {
  verifierRef: { id: "ver-exact-match", version: 2 },
  kind: "exact_match",
  configurationDigest: `sha256:${"7".repeat(64)}`,
};

const VERIFIER_B: VerifierSnapshot = {
  verifierRef: { id: "ver-numeric", version: 1 },
  kind: "numeric",
  configurationDigest: `sha256:${"8".repeat(64)}`,
};

const ROLLUP_MANIFEST: ResolvedRollupManifest = {
  rollupId: "rollup-alpha-beta",
  version: 2,
  aggregationPolicy: "stratified_only",
  name: "Alpha + Beta stratified",
  memberConfigurationIds: [EXACT_ALPHA.id, EXACT_BETA.id],
  createdAt: T0,
};

const rollupResolver: RollupVersionResolver = (rollupId, version) => {
  if (rollupId === ROLLUP_MANIFEST.rollupId && version === ROLLUP_MANIFEST.version) {
    return {
      ...ROLLUP_MANIFEST,
      memberConfigurationIds: [...ROLLUP_MANIFEST.memberConfigurationIds],
    };
  }
  return null;
};

function baseQuery(overrides: Partial<ModelEvidenceQuery> = {}): ModelEvidenceQuery {
  return {
    respondent: { kind: "model_configuration", modelConfigurationId: EXACT_ALPHA.id },
    observedFrom: null,
    observedTo: null,
    taskFamilyIds: [],
    facetFilters: [],
    evidenceClasses: [],
    allowedUses: ["within_model_profile"],
    comparabilityCohortIds: [],
    sourceKinds: [],
    rubricRefs: [],
    evaluatorFilters: [],
    includeUnknownVersion: false,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
    uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
    ...overrides,
  };
}

function goldenCorpus(overrides: Partial<ProfileEvidenceCorpus> = {}): ProfileEvidenceCorpus {
  return {
    configurations: Object.values(MILESTONE_A_GOLDEN.configurations),
    observations: milestoneAObservations(),
    decisions: milestoneADecisions(),
    ledgerRows: milestoneALedgerRows(),
    facets: MILESTONE_A_GOLDEN.facets,
    missingCells: MILESTONE_A_GOLDEN.missingCells,
    ...overrides,
  };
}

function exactAlphaSelection(
  overrides: Partial<ModelEvidenceQuery> = {},
  corpusOverrides: Partial<ProfileEvidenceCorpus> = {},
): ProfileExactSelection {
  const result = selectProfileObservations(baseQuery(overrides), goldenCorpus(corpusOverrides));
  expect(result.kind).toBe("exact");
  if (result.kind !== "exact") throw new Error("expected exact selection");
  return result;
}

function permute<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
  return arr;
}

function availableValue(value: AggregatedValue): number {
  expect(value.state).toBe("available");
  if (value.state !== "available") throw new Error("expected available aggregate");
  return value.value;
}

function onlyMetric(metrics: readonly CohortMetric[]): CohortMetric {
  expect(metrics).toHaveLength(1);
  const metric = metrics[0];
  if (!metric) throw new Error("expected one cohort metric");
  return metric;
}

function findFamily(result: FamilyAggregationResult, familyId: string | null): FamilyAggregate {
  const found = result.families.find((family) => family.familyId === familyId);
  expect(found, `family ${familyId}`).toBeDefined();
  if (!found) throw new Error(`missing family ${familyId}`);
  return found;
}

function findTask(family: FamilyAggregate, taskId: string): TaskAggregate {
  const found = family.tasks.find((task) => task.taskId === taskId);
  expect(found, `task ${taskId}`).toBeDefined();
  if (!found) throw new Error(`missing task ${taskId}`);
  return found;
}

function findVersion(task: TaskAggregate, taskVersion: number): VersionAggregate {
  const found = task.versions.find((version) => version.taskVersion === taskVersion);
  expect(found, `version ${task.taskId}@${taskVersion}`).toBeDefined();
  if (!found) throw new Error(`missing version ${task.taskId}@${taskVersion}`);
  return found;
}

function findInstance(version: VersionAggregate, taskInstanceId: string): InstanceAggregate {
  const found = version.instances.find((instance) => instance.taskInstanceId === taskInstanceId);
  expect(found, `instance ${taskInstanceId}`).toBeDefined();
  if (!found) throw new Error(`missing instance ${taskInstanceId}`);
  return found;
}

function snapshotAggregation(result: FamilyAggregationResult) {
  return {
    aggregationRuleVersion: result.aggregationRuleVersion,
    rollupTaskVersions: result.rollupTaskVersions,
    ignoredTaskSetWeights: result.ignoredTaskSetWeights,
    scoreViews: result.scoreViews,
    passViews: result.passViews,
    ties: result.ties,
    families: result.families.map((family) => ({
      familyId: family.familyId,
      judgedScores: family.judgedScores,
      passRates: family.passRates,
      taskCount: family.taskCount,
      tasks: family.tasks.map((task) => ({
        taskId: task.taskId,
        familyId: task.familyId,
        rolledUp: task.rolledUp,
        judgedScores: task.judgedScores,
        passRates: task.passRates,
        versions: task.versions.map((version) => ({
          taskId: version.taskId,
          taskVersion: version.taskVersion,
          familyId: version.familyId,
          judgedScores: version.judgedScores,
          passRates: version.passRates,
          instanceCount: version.instanceCount,
          instances: version.instances.map((instance) => ({
            taskId: instance.taskId,
            taskVersion: instance.taskVersion,
            taskInstanceId: instance.taskInstanceId,
            familyId: instance.familyId,
            judgedScores: instance.judgedScores,
            passRates: instance.passRates,
            replicateCount: instance.replicateCount,
            observationIds: instance.observationIds,
            rawCriterionValues: instance.rawCriterionValues,
            facetValues: instance.facetValues,
          })),
        })),
      })),
    })),
  };
}

let recordSeq = 0;

interface LeafSpec {
  taskId: string;
  taskVersion?: number;
  taskInstanceId: string;
  familyId: string | null;
  score?: number | null;
  verifierPassed?: boolean | null;
  rubric?: VersionRef | null;
  protocol?: string;
  evaluator?: EvaluatorSnapshot;
  verifier?: VerifierSnapshot | null;
  criteria?: ObservationCriterionValue[];
  declaredReplicate?: boolean;
  observationId?: string;
  lineage?: string;
  configuration?: ModelConfigurationSnapshot;
}

function makeRecord(spec: LeafSpec): ProfileSelectedRecord {
  recordSeq += 1;
  const n = recordSeq;
  const configuration = spec.configuration ?? EXACT_ALPHA;
  const observationId = spec.observationId ?? `obs-${n}`;
  const lineage = spec.lineage ?? `lin-${n}`;
  const rubricRef = spec.rubric === undefined ? RUBRIC_QUALITY : spec.rubric;
  const evaluator = spec.evaluator ?? JUDGE_A;
  const verifier = spec.verifier === undefined ? null : spec.verifier;
  const score = spec.score === undefined ? 4 : spec.score;
  const verifierPassed = spec.verifierPassed === undefined ? null : spec.verifierPassed;
  const outcome: ObservationOutcome = {
    judgeAccepted: true,
    overallScore: score,
    criterionValues: spec.criteria ?? [],
    verifierPassed,
  };
  const observation: Observation = {
    id: observationId,
    sourceKind: "evaluation",
    sourceResultId: `src-${n}`,
    executionLineageId: lineage,
    runId: `run-${n}`,
    sourceTaskCellId: `cell-${n}`,
    taskId: spec.taskId,
    taskVersion: spec.taskVersion ?? 1,
    taskInstanceId: spec.taskInstanceId,
    taskFamilyId: spec.familyId,
    modelConfigurationId: configuration.id,
    candidateAttemptId: `att-${n}`,
    assessmentRef: {
      judgeAttemptId: `j-${n}`,
      judgeProviderId: evaluator.providerId,
      judgeModel: evaluator.model,
      blindLabelMapping: {},
      candidateAttemptIdsByCandidateId: {},
      rubricRef,
      verifierRef: verifier?.verifierRef ?? null,
      verifierOutcome:
        verifierPassed === null
          ? null
          : {
              taskId: spec.taskId,
              modelKey: `${configuration.providerId}:${configuration.requestedModel}`,
              passed: verifierPassed,
              executedAt: T0 + n,
            },
    },
    protocolFingerprint: spec.protocol ?? PROTOCOL_A,
    rubricRef,
    evaluatorSnapshot: evaluator,
    verifierSnapshot: verifier,
    outcome,
    observedAt: T0 + n,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
  };
  const decision: EligibilityDecision = {
    observationId,
    ruleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    status: "eligible",
    evidenceClass: verifierPassed === true ? "verified" : "comparable",
    allowedUses: ["within_model_profile", "task_descriptive"],
    reasonCodes: ["assessment_selected_completed"],
    comparabilityCohortId: `sha256:${n.toString(16).padStart(64, "c")}`,
    decidedAt: T0 + n + 1,
  };
  const ledger: EvidenceLedgerRow = {
    lineageCellKey: `${observation.sourceTaskCellId}::${configuration.id}`,
    taskId: observation.taskId,
    taskVersion: observation.taskVersion,
    taskInstanceId: observation.taskInstanceId,
    modelConfigurationId: configuration.id,
    sequence: 1,
    candidateAttemptId: observation.candidateAttemptId,
    reusedCandidateOutput: false,
    declaredReplicate: spec.declaredReplicate ?? false,
    assessmentEventId: observation.assessmentRef.judgeAttemptId,
    attemptIds: [observation.candidateAttemptId],
  };
  return { observation, decision, ledger };
}

function makeCell(spec: LeafSpec): ProfileSelectedCell {
  const record = makeRecord(spec);
  const configuration = spec.configuration ?? EXACT_ALPHA;
  return {
    cellKey: profileLineageCellKey(
      record.observation.executionLineageId,
      record.observation.taskId,
      configuration.id,
    ),
    executionLineageId: record.observation.executionLineageId,
    taskId: record.observation.taskId,
    taskVersion: record.observation.taskVersion,
    taskInstanceId: record.observation.taskInstanceId,
    modelConfigurationId: configuration.id,
    active: record,
    supersededAssessments: [],
  };
}

function makeSelection(
  cells: ProfileSelectedCell[],
  configuration: ModelConfigurationSnapshot = EXACT_ALPHA,
): ProfileExactSelection {
  const declared = new Map<string, ProfileSelectedRecord[]>();
  for (const cell of cells) {
    if (cell.active.ledger?.declaredReplicate !== true) continue;
    const key = `${cell.taskId}\u0000${cell.taskVersion}\u0000${cell.taskInstanceId}`;
    const group = declared.get(key) ?? [];
    group.push(cell.active);
    declared.set(key, group);
  }
  const declaredReplicateGroups = [...declared.entries()]
    .map(([key, records]) => {
      const [taskId, taskVersion, taskInstanceId] = key.split("\u0000");
      return {
        taskId: taskId ?? "",
        taskVersion: Number(taskVersion),
        taskInstanceId: taskInstanceId ?? "",
        records,
      };
    })
    .sort((a, b) => {
      const task = a.taskId.localeCompare(b.taskId);
      if (task !== 0) return task;
      if (a.taskVersion !== b.taskVersion) return a.taskVersion - b.taskVersion;
      return a.taskInstanceId.localeCompare(b.taskInstanceId);
    });
  return {
    kind: "exact",
    modelConfiguration: configuration,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    cells,
    unauthorized: [],
    declaredReplicateGroups,
    undeclaredRepeats: [],
  };
}

// --- Hierarchy ----------------------------------------------------------------

describe("aggregateFamilyEvidence — hierarchical equal weighting", () => {
  it("means declared replicates inside a Task Instance, not attempt-weighted", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 1,
        declaredReplicate: true,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 3,
        declaredReplicate: true,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 5,
        declaredReplicate: true,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const instance = findInstance(
      findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1),
      "inst-a",
    );
    expect(instance.replicateCount).toBe(3);
    expect(availableValue(onlyMetric(instance.judgedScores).value)).toBe(3);
    expect(instance.observationIds).toHaveLength(3);
  });

  it("means instances equally inside a Task Version despite unequal replicate counts", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-heavy",
        familyId: "family-x",
        score: 0,
        declaredReplicate: true,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-heavy",
        familyId: "family-x",
        score: 0,
        declaredReplicate: true,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-heavy",
        familyId: "family-x",
        score: 0,
        declaredReplicate: true,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-light",
        familyId: "family-x",
        score: 10,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const version = findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1);
    expect(version.instanceCount).toBe(2);
    expect(availableValue(onlyMetric(version.judgedScores).value)).toBe(5);
    expect(availableValue(onlyMetric(findInstance(version, "inst-heavy").judgedScores).value)).toBe(
      0,
    );
    expect(availableValue(onlyMetric(findInstance(version, "inst-light").judgedScores).value)).toBe(
      10,
    );
  });

  it("keeps Task Versions separate by default and does not invent a task rollup", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-v1",
        familyId: "family-x",
        score: 2,
      }),
      makeCell({
        taskId: "task-a",
        taskVersion: 2,
        taskInstanceId: "inst-v2",
        familyId: "family-x",
        score: 8,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.rollupTaskVersions).toBe(false);
    const task = findTask(findFamily(result, "family-x"), "task-a");
    expect(task.rolledUp).toBe(false);
    expect(task.versions.map((version) => version.taskVersion)).toEqual([1, 2]);
    expect(availableValue(onlyMetric(findVersion(task, 1).judgedScores).value)).toBe(2);
    expect(availableValue(onlyMetric(findVersion(task, 2).judgedScores).value)).toBe(8);
    const taskScore = onlyMetric(task.judgedScores).value;
    expect(taskScore.state).toBe("non_aggregatable");
    if (taskScore.state === "non_aggregatable") {
      expect(taskScore.reason).toBe("versions_kept_separate");
    }
    const familyScore = onlyMetric(findFamily(result, "family-x").judgedScores).value;
    expect(familyScore.state).toBe("non_aggregatable");
    if (familyScore.state === "non_aggregatable") {
      expect(familyScore.reason).toBe("versions_kept_separate");
    }
  });

  it("averages versions only when an explicit Task rollup is requested", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-v1",
        familyId: "family-x",
        score: 2,
      }),
      makeCell({
        taskId: "task-a",
        taskVersion: 2,
        taskInstanceId: "inst-v2",
        familyId: "family-x",
        score: 8,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection, { rollupTaskVersions: true });
    expect(result.rollupTaskVersions).toBe(true);
    const task = findTask(findFamily(result, "family-x"), "task-a");
    expect(task.rolledUp).toBe(true);
    expect(availableValue(onlyMetric(task.judgedScores).value)).toBe(5);
    expect(availableValue(onlyMetric(findFamily(result, "family-x").judgedScores).value)).toBe(5);
  });

  it("weights unique Tasks equally inside a family despite unequal instance counts", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-heavy",
        taskInstanceId: "h1",
        familyId: "family-x",
        score: 0,
      }),
      makeCell({
        taskId: "task-heavy",
        taskInstanceId: "h2",
        familyId: "family-x",
        score: 0,
      }),
      makeCell({
        taskId: "task-heavy",
        taskInstanceId: "h3",
        familyId: "family-x",
        score: 0,
      }),
      makeCell({
        taskId: "task-light",
        taskInstanceId: "l1",
        familyId: "family-x",
        score: 10,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const family = findFamily(result, "family-x");
    expect(family.taskCount).toBe(2);
    expect(availableValue(onlyMetric(family.judgedScores).value)).toBe(5);
  });

  it("ignores Task Set custom weights on the global profile", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-heavy",
        taskInstanceId: "h1",
        familyId: "family-x",
        score: 0,
      }),
      makeCell({
        taskId: "task-light",
        taskInstanceId: "l1",
        familyId: "family-x",
        score: 10,
      }),
    ]);
    const weighted = aggregateFamilyEvidence(selection, {
      taskSetWeights: { "task-heavy": 99, "task-light": 1 },
    });
    const unweighted = aggregateFamilyEvidence(selection);
    expect(weighted.ignoredTaskSetWeights).toBe(true);
    expect(unweighted.ignoredTaskSetWeights).toBe(false);
    expect(availableValue(onlyMetric(findFamily(weighted, "family-x").judgedScores).value)).toBe(5);
    expect(availableValue(onlyMetric(findFamily(unweighted, "family-x").judgedScores).value)).toBe(
      5,
    );
    expect(snapshotAggregation(weighted).families).toEqual(
      snapshotAggregation(unweighted).families,
    );
  });

  it("stamps the pinned aggregation rule version", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 4,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.aggregationRuleVersion).toBe(AGGREGATION_RULE_VERSION);
    expect(result.aggregationRuleVersion).toBe(QUERY_AGGREGATION_RULE_VERSION);
  });
});

// --- Metric compatibility -----------------------------------------------------

describe("aggregateFamilyEvidence — metric compatibility", () => {
  it("keeps incommensurate Rubric versions as adjacent score views", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 2,
        rubric: RUBRIC_QUALITY,
      }),
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 8,
        rubric: RUBRIC_QUALITY_V4,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.scoreViews).toHaveLength(2);
    const family = findFamily(result, "family-x");
    expect(family.judgedScores).toHaveLength(2);
    const taskA = onlyMetric(findTask(family, "task-a").judgedScores);
    const taskB = onlyMetric(findTask(family, "task-b").judgedScores);
    expect(taskA.cohortId).not.toBe(taskB.cohortId);
    expect(availableValue(taskA.value)).toBe(2);
    expect(availableValue(taskB.value)).toBe(8);
    const pooled = family.judgedScores.find(
      (metric) => metric.value.state === "available" && metric.value.value === 5,
    );
    expect(pooled).toBeUndefined();
  });

  it("pools judged scores only inside a declared commensurate Rubric mapping", () => {
    const mappings: CommensurateRubricMapping[] = [
      { groupId: "quality-line", rubricRef: RUBRIC_QUALITY },
      { groupId: "quality-line", rubricRef: RUBRIC_QUALITY_V4 },
    ];
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 2,
        rubric: RUBRIC_QUALITY,
      }),
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 8,
        rubric: RUBRIC_QUALITY_V4,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection, {
      commensurateRubricMappings: mappings,
    });
    expect(result.scoreViews).toHaveLength(1);
    const family = findFamily(result, "family-x");
    expect(availableValue(onlyMetric(family.judgedScores).value)).toBe(5);
    const first = selection.cells[0];
    const second = selection.cells[1];
    if (!first || !second) throw new Error("expected two cells");
    expect(buildJudgedScoreCohortId(first.active.observation, EXACT_ALPHA, mappings)).toBe(
      buildJudgedScoreCohortId(second.active.observation, EXACT_ALPHA, mappings),
    );
  });

  it("keeps incompatible verifier outcome definitions as adjacent pass views", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 4,
        verifier: VERIFIER_A,
        verifierPassed: true,
      }),
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 4,
        verifier: VERIFIER_B,
        verifierPassed: false,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.passViews).toHaveLength(2);
    const family = findFamily(result, "family-x");
    const taskA = onlyMetric(findTask(family, "task-a").passRates);
    const taskB = onlyMetric(findTask(family, "task-b").passRates);
    expect(taskA.cohortId).not.toBe(taskB.cohortId);
    expect(availableValue(taskA.value)).toBe(1);
    expect(availableValue(taskB.value)).toBe(0);
    const pooled = family.passRates.find(
      (metric) => metric.value.state === "available" && metric.value.value === 0.5,
    );
    expect(pooled).toBeUndefined();
  });

  it("pools pass/fail only across declared compatible verifier definitions", () => {
    const mappings: CompatibleVerifierDefinition[] = [
      {
        groupId: "matchers",
        verifierRef: VERIFIER_A.verifierRef,
        kind: VERIFIER_A.kind,
        configurationDigest: VERIFIER_A.configurationDigest,
      },
      {
        groupId: "matchers",
        verifierRef: VERIFIER_B.verifierRef,
        kind: VERIFIER_B.kind,
        configurationDigest: VERIFIER_B.configurationDigest,
      },
    ];
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        verifier: VERIFIER_A,
        verifierPassed: true,
      }),
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        verifier: VERIFIER_B,
        verifierPassed: false,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection, {
      compatibleVerifierDefinitions: mappings,
    });
    expect(result.passViews).toHaveLength(1);
    expect(availableValue(onlyMetric(findFamily(result, "family-x").passRates).value)).toBe(0.5);
    const first = selection.cells[0];
    const second = selection.cells[1];
    if (!first || !second) throw new Error("expected two cells");
    expect(buildPassRateCohortId(first.active.observation, EXACT_ALPHA, mappings)).toBe(
      buildPassRateCohortId(second.active.observation, EXACT_ALPHA, mappings),
    );
  });

  it("does not pool distinct protocol or evaluator contracts even with the same Rubric", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 2,
        protocol: PROTOCOL_A,
        evaluator: JUDGE_A,
      }),
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 8,
        protocol: PROTOCOL_B,
        evaluator: JUDGE_B,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.scoreViews).toHaveLength(2);
    const family = findFamily(result, "family-x");
    expect(family.judgedScores).toHaveLength(2);
    expect(
      family.judgedScores.some(
        (metric) => metric.value.state === "available" && metric.value.value === 5,
      ),
    ).toBe(false);
  });

  it("pools instances of one Task Version across distinct comparability-cohort fingerprints", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 2,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 8,
      }),
    ]);
    const first = selection.cells[0];
    const second = selection.cells[1];
    if (!first || !second) throw new Error("expected two cells");
    expect(first.active.decision.comparabilityCohortId).not.toBe(
      second.active.decision.comparabilityCohortId,
    );
    expect(buildJudgedScoreCohortId(first.active.observation, EXACT_ALPHA)).toBe(
      buildJudgedScoreCohortId(second.active.observation, EXACT_ALPHA),
    );
    const result = aggregateFamilyEvidence(selection);
    expect(result.scoreViews).toHaveLength(1);
    expect(
      availableValue(
        onlyMetric(findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1).judgedScores)
          .value,
      ),
    ).toBe(5);
  });
});

// --- Criteria and facets ------------------------------------------------------

describe("aggregateFamilyEvidence — raw criteria and authored facet mappings", () => {
  it("keeps raw criterion values available even when unmapped", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 4,
        criteria: [
          { criterionId: "c-quality", value: 4 },
          { criterionId: "c-style", value: false },
        ],
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const instance = findInstance(
      findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1),
      "inst-a",
    );
    expect(instance.rawCriterionValues).toEqual([
      {
        observationId: instance.observationIds[0],
        criterionId: "c-quality",
        value: 4,
        rubricRef: RUBRIC_QUALITY,
      },
      {
        observationId: instance.observationIds[0],
        criterionId: "c-style",
        value: false,
        rubricRef: RUBRIC_QUALITY,
      },
    ]);
    expect(instance.facetValues).toEqual([]);
  });

  it("maps raw criteria to facets only through authored versioned mappings", () => {
    const mappings: VersionedCriterionFacetMapping[] = [
      {
        mappingVersion: 2,
        rubricRef: RUBRIC_QUALITY,
        criterionId: "c-quality",
        facetId: "quality",
      },
    ];
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 4,
        criteria: [
          { criterionId: "c-quality", value: 4 },
          { criterionId: "c-style", value: 1 },
        ],
      }),
    ]);
    const result = aggregateFamilyEvidence(selection, {
      criterionFacetMappings: mappings,
    });
    const instance = findInstance(
      findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1),
      "inst-a",
    );
    expect(instance.rawCriterionValues.map((row) => row.criterionId).sort()).toEqual([
      "c-quality",
      "c-style",
    ]);
    expect(instance.facetValues).toEqual([
      {
        facetId: "quality",
        mappingVersion: 2,
        criterionId: "c-quality",
        value: 4,
        observationId: instance.observationIds[0],
      },
    ]);
  });

  it("does not invent a facet mapping from a different Rubric version", () => {
    const mappings: VersionedCriterionFacetMapping[] = [
      {
        mappingVersion: 1,
        rubricRef: RUBRIC_QUALITY_V4,
        criterionId: "c-quality",
        facetId: "quality",
      },
    ];
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 4,
        rubric: RUBRIC_QUALITY,
        criteria: [{ criterionId: "c-quality", value: 4 }],
      }),
    ]);
    const result = aggregateFamilyEvidence(selection, {
      criterionFacetMappings: mappings,
    });
    const instance = findInstance(
      findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1),
      "inst-a",
    );
    expect(instance.facetValues).toEqual([]);
    expect(instance.rawCriterionValues).toHaveLength(1);
  });
});

// --- Non-aggregatable states --------------------------------------------------

describe("aggregateFamilyEvidence — explicit non-aggregatable states", () => {
  it("marks an instance without a judged score as missing_score", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: null,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const instanceScore = onlyMetric(
      findInstance(findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1), "inst-a")
        .judgedScores,
    ).value;
    expect(instanceScore.state).toBe("non_aggregatable");
    if (instanceScore.state === "non_aggregatable") {
      expect(instanceScore.reason).toBe("missing_score");
    }
  });

  it("treats overallScore 0 as a real score, not a missing value", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 0,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(
      availableValue(
        onlyMetric(
          findInstance(findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1), "inst-a")
            .judgedScores,
        ).value,
      ),
    ).toBe(0);
  });

  it("omits pass-rate views when no verifier outcome exists", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 4,
        verifierPassed: null,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.passViews).toEqual([]);
    expect(findFamily(result, "family-x").passRates).toEqual([]);
  });

  it("treats verifierPassed false as a 0 pass rate, not a missing outcome", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        verifier: VERIFIER_A,
        verifierPassed: false,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(availableValue(onlyMetric(findFamily(result, "family-x").passRates).value)).toBe(0);
  });

  it("returns an empty result for a selection with no active cells", () => {
    const result = aggregateFamilyEvidence(makeSelection([]));
    expect(result.families).toEqual([]);
    expect(result.scoreViews).toEqual([]);
    expect(result.passViews).toEqual([]);
    expect(result.ties).toEqual([]);
  });

  it("refuses to pool a stratified Model Rollup into one family aggregate", () => {
    const result = selectProfileObservations(
      baseQuery({
        respondent: {
          kind: "model_rollup",
          rollupId: ROLLUP_MANIFEST.rollupId,
          version: ROLLUP_MANIFEST.version,
          aggregationPolicy: "stratified_only",
        },
      }),
      goldenCorpus(),
      rollupResolver,
    );
    expect(result.kind).toBe("stratified_only");
    expect(() => aggregateFamilyEvidence(result as unknown as ProfileExactSelection)).toThrow(
      /exact|stratified|pool/i,
    );
  });
});

// --- Ordering and ties --------------------------------------------------------

describe("aggregateFamilyEvidence — deterministic ordering and ties", () => {
  it("orders families, tasks, versions, and instances deterministically", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-z",
        taskVersion: 2,
        taskInstanceId: "inst-z",
        familyId: "family-b",
        score: 1,
      }),
      makeCell({
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-b",
        familyId: "family-a",
        score: 2,
      }),
      makeCell({
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-a",
        familyId: "family-a",
        score: 3,
      }),
      makeCell({
        taskId: "task-m",
        taskVersion: 1,
        taskInstanceId: "inst-m",
        familyId: null,
        score: 4,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    expect(result.families.map((family) => family.familyId)).toEqual([
      "family-a",
      "family-b",
      null,
    ]);
    const familyA = findFamily(result, "family-a");
    expect(familyA.tasks.map((task) => task.taskId)).toEqual(["task-a"]);
    expect(familyA.tasks[0]?.versions.map((version) => version.taskVersion)).toEqual([1]);
    expect(
      familyA.tasks[0]?.versions[0]?.instances.map((instance) => instance.taskInstanceId),
    ).toEqual(["inst-a", "inst-b"]);
  });

  it("records explicit ties when sibling available scores are equal", () => {
    const selection = makeSelection([
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 7,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 7,
      }),
      makeCell({
        taskId: "task-c",
        taskInstanceId: "inst-c",
        familyId: "family-x",
        score: 1,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const family = findFamily(result, "family-x");
    expect(family.tasks.map((task) => task.taskId)).toEqual(["task-a", "task-b", "task-c"]);
    const taskTie = result.ties.find(
      (tie) => tie.level === "task" && tie.metric === "judged_score",
    );
    expect(taskTie).toMatchObject({
      level: "task",
      metric: "judged_score",
      value: 7,
      memberIds: ["task-a", "task-b"],
    });
  });
});

// --- Purity and permutations --------------------------------------------------

describe("aggregateFamilyEvidence — purity and permutation invariance", () => {
  it("never mutates the selection or source observation records", () => {
    const cells = [
      makeCell({
        taskId: "task-b",
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 2,
      }),
      makeCell({
        taskId: "task-a",
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 8,
      }),
    ];
    const selection = makeSelection(cells);
    const cellIdsBefore = selection.cells.map((cell) => cell.active.observation.id);
    const firstObservation = selection.cells[0]?.active.observation;
    Object.freeze(selection);
    for (const cell of selection.cells) {
      Object.freeze(cell);
      Object.freeze(cell.active);
      Object.freeze(cell.active.observation);
      Object.freeze(cell.active.decision);
    }
    const result = aggregateFamilyEvidence(selection, {
      taskSetWeights: { "task-a": 3, "task-b": 1 },
    });
    expect(availableValue(onlyMetric(findFamily(result, "family-x").judgedScores).value)).toBe(5);
    expect(selection.cells.map((cell) => cell.active.observation.id)).toEqual(cellIdsBefore);
    expect(selection.cells[0]?.active.observation).toBe(firstObservation);
  });

  it("is invariant under permutations of cells, mappings, and Task Set weight key order", () => {
    const cells = [
      makeCell({
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-a",
        familyId: "family-x",
        score: 2,
        rubric: RUBRIC_QUALITY,
      }),
      makeCell({
        taskId: "task-b",
        taskVersion: 1,
        taskInstanceId: "inst-b",
        familyId: "family-x",
        score: 8,
        rubric: RUBRIC_QUALITY_V4,
      }),
      makeCell({
        taskId: "task-a",
        taskVersion: 2,
        taskInstanceId: "inst-a2",
        familyId: "family-x",
        score: 4,
        rubric: RUBRIC_QUALITY,
      }),
    ];
    const mappings: CommensurateRubricMapping[] = [
      { groupId: "quality-line", rubricRef: RUBRIC_QUALITY },
      { groupId: "quality-line", rubricRef: RUBRIC_QUALITY_V4 },
    ];
    const baseline = aggregateFamilyEvidence(makeSelection(cells), {
      rollupTaskVersions: true,
      commensurateRubricMappings: mappings,
      taskSetWeights: { "task-a": 9, "task-b": 1 },
    });
    const expected = snapshotAggregation(baseline);
    const seeds = [1, 2, 3, 99, 12345];
    for (const seed of seeds) {
      const permuted = aggregateFamilyEvidence(makeSelection(permute(cells, seed)), {
        rollupTaskVersions: true,
        commensurateRubricMappings: permute(mappings, seed + 7),
        taskSetWeights:
          seed % 2 === 0 ? { "task-b": 1, "task-a": 9 } : { "task-a": 9, "task-b": 1 },
      });
      expect(snapshotAggregation(permuted), `seed ${seed}`).toEqual(expected);
    }
  });
});

// --- Golden corpus ------------------------------------------------------------

describe("aggregateFamilyEvidence — milestone A golden selection", () => {
  it("aggregates exact-alpha families without pooling mixed Rubric/evaluator cohorts", () => {
    const selection = exactAlphaSelection();
    const result = aggregateFamilyEvidence(selection);

    const transformFamily = findFamily(result, "family-transform");
    const writeFamily = findFamily(result, "family-write");
    const unassigned = findFamily(result, null);

    const transformTask = findTask(transformFamily, "task-transform");
    expect(transformTask.rolledUp).toBe(false);
    expect(transformTask.versions.map((version) => version.taskVersion)).toEqual([1, 2]);
    const transformV1 = findVersion(transformTask, 1);
    expect(transformV1.instanceCount).toBe(2);
    expect(availableValue(onlyMetric(transformV1.judgedScores).value)).toBe(4);
    expect(availableValue(onlyMetric(findVersion(transformTask, 2).judgedScores).value)).toBe(4);
    const transformTaskScore = onlyMetric(transformTask.judgedScores).value;
    expect(transformTaskScore.state).toBe("non_aggregatable");
    if (transformTaskScore.state === "non_aggregatable") {
      expect(transformTaskScore.reason).toBe("versions_kept_separate");
    }

    const writeInstance = findInstance(
      findVersion(findTask(writeFamily, "task-write"), 1),
      "inst-write-a",
    );
    expect(writeInstance.replicateCount).toBe(2);
    expect(availableValue(onlyMetric(writeInstance.judgedScores).value)).toBe(4);

    const mathTask = findTask(transformFamily, "task-math");
    const mathCohort = onlyMetric(mathTask.judgedScores).cohortId;
    const verifyCohort = onlyMetric(findTask(transformFamily, "task-verify").judgedScores).cohortId;
    const transformCohort = onlyMetric(transformV1.judgedScores).cohortId;
    expect(mathCohort).not.toBe(transformCohort);
    expect(verifyCohort).toBe(transformCohort);

    expect(result.scoreViews.length).toBeGreaterThanOrEqual(2);
    expect(
      transformFamily.judgedScores.some(
        (metric) => metric.cohortId === mathCohort && metric.cohortId === transformCohort,
      ),
    ).toBe(false);

    const verifyPass = onlyMetric(findTask(transformFamily, "task-verify").passRates);
    expect(availableValue(verifyPass.value)).toBe(1);
    expect(mathTask.passRates).toEqual([]);
    expect(unassigned.tasks.map((task) => task.taskId)).toEqual(["task-orphan"]);
  });

  it("rolls up transform versions and still weights verify equally, ignoring Task Set weights", () => {
    const selection = exactAlphaSelection();
    const result = aggregateFamilyEvidence(selection, {
      rollupTaskVersions: true,
      taskSetWeights: { "task-transform": 50, "task-verify": 1, "task-math": 1 },
    });
    expect(result.ignoredTaskSetWeights).toBe(true);
    const family = findFamily(result, "family-transform");
    const transformTask = findTask(family, "task-transform");
    expect(transformTask.rolledUp).toBe(true);
    expect(availableValue(onlyMetric(transformTask.judgedScores).value)).toBe(4);
    const verifyScore = onlyMetric(findTask(family, "task-verify").judgedScores);
    expect(availableValue(verifyScore.value)).toBe(5);
    const transformScore = onlyMetric(transformTask.judgedScores);
    expect(transformScore.cohortId).toBe(verifyScore.cohortId);
    const familyMetric = family.judgedScores.find(
      (metric) => metric.cohortId === transformScore.cohortId,
    );
    expect(familyMetric).toBeDefined();
    expect(availableValue(familyMetric!.value)).toBe(4.5);
    const mathMetric = onlyMetric(findTask(family, "task-math").judgedScores);
    expect(mathMetric.cohortId).not.toBe(transformScore.cohortId);
  });

  it("is permutation-invariant over the golden corpus", () => {
    const baseline = aggregateFamilyEvidence(exactAlphaSelection(), {
      rollupTaskVersions: true,
    });
    const expected = snapshotAggregation(baseline);
    for (const seed of [2, 11, 41]) {
      const selection = exactAlphaSelection(
        {},
        {
          observations: permute(milestoneAObservations(), seed),
          decisions: permute(milestoneADecisions(), seed + 3),
          ledgerRows: permute(milestoneALedgerRows(), seed + 5),
        },
      );
      expect(
        snapshotAggregation(aggregateFamilyEvidence(selection, { rollupTaskVersions: true })),
        `seed ${seed}`,
      ).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// R6: limitation / omission evidence propagates instance -> version -> Task
// -> family. A limited child never lets a parent silently become fully
// available.
// ---------------------------------------------------------------------------

describe("aggregateFamilyEvidence — limitation propagation (R6)", () => {
  it("propagates a limited instance up through version, Task, and family", () => {
    // One instance with two declared replicates: one scored, one missing a
    // judged score. The instance is `limited` (some observations have no
    // judged score). That limitation MUST propagate: the version, the Task,
    // and the family are all `limited` — none silently become `available`.
    const selection = makeSelection([
      makeCell({
        familyId: "family-x",
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-a",
        score: 5,
        declaredReplicate: true,
      }),
      makeCell({
        familyId: "family-x",
        taskId: "task-a",
        taskVersion: 1,
        taskInstanceId: "inst-a",
        score: null,
        declaredReplicate: true,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);

    const instance = findInstance(
      findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1),
      "inst-a",
    );
    expect(onlyMetric(instance.judgedScores).value.state).toBe("limited");

    const version = findVersion(findTask(findFamily(result, "family-x"), "task-a"), 1);
    expect(onlyMetric(version.judgedScores).value.state).toBe("limited");

    const task = findTask(findFamily(result, "family-x"), "task-a");
    expect(onlyMetric(task.judgedScores).value.state).toBe("limited");

    const family = findFamily(result, "family-x");
    expect(onlyMetric(family.judgedScores).value.state).toBe("limited");
  });

  it("never lets a fully-limited family become available", () => {
    // Two tasks, each with a limited instance (a missing scored replicate).
    // Every leaf is limited, so the family MUST be limited — never available.
    const selection = makeSelection([
      makeCell({
        familyId: "family-y",
        taskId: "task-1",
        taskInstanceId: "i-1",
        score: 5,
        declaredReplicate: true,
      }),
      makeCell({
        familyId: "family-y",
        taskId: "task-1",
        taskInstanceId: "i-1",
        score: null,
        declaredReplicate: true,
      }),
      makeCell({
        familyId: "family-y",
        taskId: "task-2",
        taskInstanceId: "i-2",
        score: 3,
        declaredReplicate: true,
      }),
      makeCell({
        familyId: "family-y",
        taskId: "task-2",
        taskInstanceId: "i-2",
        score: null,
        declaredReplicate: true,
      }),
    ]);
    const result = aggregateFamilyEvidence(selection);
    const family = findFamily(result, "family-y");
    expect(onlyMetric(family.judgedScores).value.state).toBe("limited");
  });
});
