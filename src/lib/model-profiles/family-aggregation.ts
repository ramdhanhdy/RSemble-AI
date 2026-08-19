// =============================================================================
// RSemble AI — family-aggregation.ts (Child 07 Task 4, GREEN)
//
// Pure hierarchical aggregation over one exact-configuration selection.
// Replicates mean inside a Task Instance; instances mean inside a Task
// Version; versions stay separate unless an explicit Task rollup is
// requested; Tasks have equal weight inside a Task Family. Task Set custom
// weights never enter the global profile.
//
// Contract (Child 07 spec §6.2–6.3, plan Task 4):
//  - Per-cohort aggregates only. Incompatible metric cohorts stay adjacent
//    views and are never silent pooled inputs.
//  - Deterministic pass/fail only across compatible verifier definitions.
//  - Judged scores only within declared commensurate Rubric/version mappings.
//  - Raw criterion values remain available; facets only through authored
//    versioned mappings.
//  - Explicit non-aggregatable states. Deterministic ordering and ties.
//  - Never mutates the selection or source records.
//  - Model Rollups stay stratified_only: this module refuses to pool them.
//
// This module does not implement bootstrap, paired comparison, claims,
// cache, UI, or a rollup store.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type { VerificationKind } from "../evaluations/evaluation-types";
import type {
  EvaluatorSnapshot,
  ModelConfigurationSnapshot,
  Observation,
  VerifierSnapshot,
} from "../evidence/evidence-types";
import type { VersionRef } from "../tasks/task-types";
import { QUERY_AGGREGATION_RULE_VERSION } from "./model-evidence-query";
import type { ProfileExactSelection } from "./profile-observation-selection";

export const AGGREGATION_RULE_VERSION = QUERY_AGGREGATION_RULE_VERSION;

export type NonAggregatableReason =
  | "incompatible_verifier_definitions"
  | "incommensurate_rubric_versions"
  | "versions_kept_separate"
  | "missing_score"
  | "missing_verifier_outcome"
  | "no_observations"
  | "unmapped_criterion_facet"
  | "member_not_aggregatable";

export type AggregatedValue =
  | { readonly state: "available"; readonly value: number; readonly unitCount: number }
  | {
      readonly state: "limited";
      readonly value: number;
      readonly unitCount: number;
      readonly omittedCount: number;
      readonly reason: string;
    }
  | {
      readonly state: "non_aggregatable";
      readonly reason: NonAggregatableReason;
      readonly detail?: string;
    }
  | { readonly state: "unavailable"; readonly reason: string };

export interface CommensurateRubricMapping {
  readonly groupId: string;
  readonly rubricRef: VersionRef;
}

export interface CompatibleVerifierDefinition {
  readonly groupId: string;
  readonly verifierRef: VersionRef | null;
  readonly kind: VerificationKind | null;
  readonly configurationDigest: string | null;
}

export interface VersionedCriterionFacetMapping {
  readonly mappingVersion: number;
  readonly rubricRef: VersionRef;
  readonly criterionId: string;
  readonly facetId: string;
}

export interface FamilyAggregationOptions {
  readonly rollupTaskVersions?: boolean;
  readonly commensurateRubricMappings?: readonly CommensurateRubricMapping[];
  readonly compatibleVerifierDefinitions?: readonly CompatibleVerifierDefinition[];
  readonly criterionFacetMappings?: readonly VersionedCriterionFacetMapping[];
  readonly taskSetWeights?: Readonly<Record<string, number>>;
}

export interface RawCriterionValue {
  readonly observationId: string;
  readonly criterionId: string;
  readonly value: number | boolean;
  readonly rubricRef: VersionRef | null;
}

export interface FacetValue {
  readonly facetId: string;
  readonly mappingVersion: number;
  readonly criterionId: string;
  readonly value: number;
  readonly observationId: string;
}

export interface CohortMetric {
  readonly cohortId: string;
  readonly value: AggregatedValue;
}

export interface InstanceAggregate {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly taskInstanceId: string;
  readonly familyId: string | null;
  readonly judgedScores: readonly CohortMetric[];
  readonly passRates: readonly CohortMetric[];
  readonly replicateCount: number;
  readonly observationIds: readonly string[];
  readonly rawCriterionValues: readonly RawCriterionValue[];
  readonly facetValues: readonly FacetValue[];
}

export interface VersionAggregate {
  readonly taskId: string;
  readonly taskVersion: number;
  readonly familyId: string | null;
  readonly judgedScores: readonly CohortMetric[];
  readonly passRates: readonly CohortMetric[];
  readonly instanceCount: number;
  readonly instances: readonly InstanceAggregate[];
}

export interface TaskAggregate {
  readonly taskId: string;
  readonly familyId: string | null;
  readonly versions: readonly VersionAggregate[];
  readonly judgedScores: readonly CohortMetric[];
  readonly passRates: readonly CohortMetric[];
  readonly rolledUp: boolean;
}

export interface FamilyAggregate {
  readonly familyId: string | null;
  readonly judgedScores: readonly CohortMetric[];
  readonly passRates: readonly CohortMetric[];
  readonly taskCount: number;
  readonly tasks: readonly TaskAggregate[];
}

export interface AggregationTie {
  readonly level: "family" | "task" | "version" | "instance";
  readonly metric: "judged_score" | "pass_rate";
  readonly cohortId: string;
  readonly value: number;
  readonly memberIds: readonly string[];
}

export interface MetricCohortView {
  readonly kind: "judged_score" | "pass_rate";
  readonly cohortId: string;
  readonly familyIds: readonly (string | null)[];
}

export interface FamilyAggregationResult {
  readonly aggregationRuleVersion: number;
  readonly rollupTaskVersions: boolean;
  readonly ignoredTaskSetWeights: boolean;
  readonly scoreViews: readonly MetricCohortView[];
  readonly passViews: readonly MetricCohortView[];
  readonly families: readonly FamilyAggregate[];
  readonly ties: readonly AggregationTie[];
}

interface Leaf {
  readonly observation: Observation;
  readonly familyId: string | null;
  readonly scoreCohortId: string;
  readonly passCohortId: string;
}

function sameRef(a: VersionRef | null, b: VersionRef | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.version === b.version;
}

function formatRef(ref: VersionRef | null): string {
  return ref === null ? "none" : `${ref.id}@${ref.version}`;
}

function pinEvaluator(evaluator: EvaluatorSnapshot) {
  return {
    kind: evaluator.kind,
    providerId: evaluator.providerId,
    model: evaluator.model,
    resolvedVersion: evaluator.resolvedVersion,
    instructionDigest: evaluator.instructionDigest,
    reasoningEffort: evaluator.reasoningEffort,
    toolScaffoldSignature: evaluator.toolScaffoldSignature,
  };
}

function rubricGroupId(
  ref: VersionRef | null,
  mappings: readonly CommensurateRubricMapping[],
): string {
  if (ref === null) return "rubric:none";
  for (const mapping of mappings) {
    if (mapping.rubricRef.id === ref.id && mapping.rubricRef.version === ref.version) {
      return mapping.groupId;
    }
  }
  return `rubric:${ref.id}@${ref.version}`;
}

function verifierGroupId(
  snapshot: VerifierSnapshot | null,
  mappings: readonly CompatibleVerifierDefinition[],
): string {
  if (snapshot === null) return "verifier:none";
  for (const mapping of mappings) {
    if (
      sameRef(mapping.verifierRef, snapshot.verifierRef) &&
      mapping.kind === snapshot.kind &&
      mapping.configurationDigest === snapshot.configurationDigest
    ) {
      return mapping.groupId;
    }
  }
  return `verifier:${snapshot.kind}:${snapshot.configurationDigest}:${formatRef(snapshot.verifierRef)}`;
}

function contractFields(observation: Observation, configuration: ModelConfigurationSnapshot) {
  return {
    protocolFingerprint: observation.protocolFingerprint,
    evaluator: pinEvaluator(observation.evaluatorSnapshot),
    reasoningRequested: configuration.reasoningRequested,
    reasoningEffective: configuration.reasoningEffective,
    toolScaffoldSignature: configuration.toolScaffoldSignature,
    providerId: configuration.providerId,
    resolvedModel: configuration.resolvedModel,
    resolvedVersion: configuration.resolvedVersion,
  };
}

export function buildJudgedScoreCohortId(
  observation: Observation,
  configuration: ModelConfigurationSnapshot,
  mappings: readonly CommensurateRubricMapping[] = [],
): string {
  return hashArtifactContent(
    canonicalJsonString({
      kind: "judged_score",
      rubricGroup: rubricGroupId(observation.rubricRef, mappings),
      ...contractFields(observation, configuration),
    }),
  );
}

export function buildPassRateCohortId(
  observation: Observation,
  configuration: ModelConfigurationSnapshot,
  mappings: readonly CompatibleVerifierDefinition[] = [],
): string {
  return hashArtifactContent(
    canonicalJsonString({
      kind: "pass_rate",
      verifierGroup: verifierGroupId(observation.verifierSnapshot, mappings),
      ...contractFields(observation, configuration),
    }),
  );
}

function compareFamilyIds(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function groupBy<K, T>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  return grouped;
}

function arithmeticMean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function aggregateScores(scores: readonly (number | null)[]): AggregatedValue {
  const present: number[] = [];
  for (const score of scores) {
    if (score !== null) present.push(score);
  }
  const omitted = scores.length - present.length;
  if (present.length === 0) {
    return { state: "non_aggregatable", reason: "missing_score" };
  }
  const value = arithmeticMean(present);
  if (omitted > 0) {
    return {
      state: "limited",
      value,
      unitCount: present.length,
      omittedCount: omitted,
      reason: "some observations have no judged score",
    };
  }
  return { state: "available", value, unitCount: present.length };
}

function aggregatePasses(passes: readonly (boolean | null)[]): AggregatedValue | null {
  const present: number[] = [];
  for (const passed of passes) {
    if (passed !== null) present.push(passed ? 1 : 0);
  }
  if (present.length === 0) return null;
  const omitted = passes.length - present.length;
  const value = arithmeticMean(present);
  if (omitted > 0) {
    return {
      state: "limited",
      value,
      unitCount: present.length,
      omittedCount: omitted,
      reason: "some observations have no verifier outcome",
    };
  }
  return { state: "available", value, unitCount: present.length };
}

function combineValues(values: readonly AggregatedValue[]): AggregatedValue {
  if (values.length === 0) {
    return { state: "unavailable", reason: "no_observations" };
  }
  if (
    values.some(
      (value) => value.state === "non_aggregatable" && value.reason === "versions_kept_separate",
    )
  ) {
    return { state: "non_aggregatable", reason: "versions_kept_separate" };
  }
  const blocking = values.filter(
    (value) => value.state === "non_aggregatable" && value.reason !== "missing_score",
  );
  if (blocking.length > 0) {
    const first = blocking[0];
    if (!first || first.state !== "non_aggregatable") {
      return { state: "non_aggregatable", reason: "member_not_aggregatable" };
    }
    return {
      state: "non_aggregatable",
      reason: "member_not_aggregatable",
      detail: first.reason,
    };
  }
  const usable: Array<{ value: number }> = [];
  let omitted = 0;
  for (const value of values) {
    if (value.state === "available" || value.state === "limited") {
      usable.push({ value: value.value });
    } else {
      omitted += 1;
    }
  }
  if (usable.length === 0) {
    return { state: "non_aggregatable", reason: "missing_score" };
  }
  const mean = arithmeticMean(usable.map((row) => row.value));
  if (omitted > 0) {
    return {
      state: "limited",
      value: mean,
      unitCount: usable.length,
      omittedCount: omitted,
      reason: "some child units have no aggregatable value",
    };
  }
  return { state: "available", value: mean, unitCount: usable.length };
}

function rollUpMetrics(
  children: readonly (readonly CohortMetric[])[],
  separateIfMultiple: boolean,
): CohortMetric[] {
  const cohortIds: string[] = [];
  const seen: Record<string, true> = {};
  for (const child of children) {
    for (const metric of child) {
      if (seen[metric.cohortId]) continue;
      seen[metric.cohortId] = true;
      cohortIds.push(metric.cohortId);
    }
  }
  cohortIds.sort(compareStrings);
  const rolled: CohortMetric[] = [];
  for (const cohortId of cohortIds) {
    const values: AggregatedValue[] = [];
    for (const child of children) {
      for (const metric of child) {
        if (metric.cohortId === cohortId) values.push(metric.value);
      }
    }
    if (separateIfMultiple && values.length > 1) {
      rolled.push({
        cohortId,
        value: { state: "non_aggregatable", reason: "versions_kept_separate" },
      });
      continue;
    }
    rolled.push({ cohortId, value: combineValues(values) });
  }
  return rolled;
}

function buildInstance(
  leaves: readonly Leaf[],
  facetMappings: readonly VersionedCriterionFacetMapping[],
): InstanceAggregate {
  const first = leaves[0];
  if (!first) {
    throw new Error("instance aggregate requires at least one observation");
  }
  const observationIds = [...new Set(leaves.map((leaf) => leaf.observation.id))].sort(
    compareStrings,
  );

  const scoreGroups = groupBy(leaves, (leaf) => leaf.scoreCohortId);
  const judgedScores: CohortMetric[] = [...scoreGroups.keys()]
    .sort(compareStrings)
    .map((cohortId) => {
      const group = scoreGroups.get(cohortId) ?? [];
      return {
        cohortId,
        value: aggregateScores(group.map((leaf) => leaf.observation.outcome.overallScore)),
      };
    });

  const passGroups = groupBy(leaves, (leaf) => leaf.passCohortId);
  const passRates: CohortMetric[] = [];
  for (const cohortId of [...passGroups.keys()].sort(compareStrings)) {
    const group = passGroups.get(cohortId) ?? [];
    const value = aggregatePasses(group.map((leaf) => leaf.observation.outcome.verifierPassed));
    if (value) passRates.push({ cohortId, value });
  }

  const rawCriterionValues: RawCriterionValue[] = [];
  const facetValues: FacetValue[] = [];
  for (const leaf of leaves) {
    const observation = leaf.observation;
    for (const criterion of observation.outcome.criterionValues) {
      rawCriterionValues.push({
        observationId: observation.id,
        criterionId: criterion.criterionId,
        value: criterion.value,
        rubricRef: observation.rubricRef,
      });
      if (observation.rubricRef === null) continue;
      for (const mapping of facetMappings) {
        if (
          mapping.rubricRef.id !== observation.rubricRef.id ||
          mapping.rubricRef.version !== observation.rubricRef.version ||
          mapping.criterionId !== criterion.criterionId
        ) {
          continue;
        }
        facetValues.push({
          facetId: mapping.facetId,
          mappingVersion: mapping.mappingVersion,
          criterionId: criterion.criterionId,
          value: typeof criterion.value === "boolean" ? (criterion.value ? 1 : 0) : criterion.value,
          observationId: observation.id,
        });
      }
    }
  }
  rawCriterionValues.sort((a, b) => {
    const byObservation = a.observationId.localeCompare(b.observationId);
    if (byObservation !== 0) return byObservation;
    return a.criterionId.localeCompare(b.criterionId);
  });
  facetValues.sort((a, b) => {
    const byFacet = a.facetId.localeCompare(b.facetId);
    if (byFacet !== 0) return byFacet;
    if (a.mappingVersion !== b.mappingVersion) return a.mappingVersion - b.mappingVersion;
    const byCriterion = a.criterionId.localeCompare(b.criterionId);
    if (byCriterion !== 0) return byCriterion;
    return a.observationId.localeCompare(b.observationId);
  });

  return {
    taskId: first.observation.taskId,
    taskVersion: first.observation.taskVersion,
    taskInstanceId: first.observation.taskInstanceId,
    familyId: first.familyId,
    judgedScores,
    passRates,
    replicateCount: leaves.length,
    observationIds,
    rawCriterionValues,
    facetValues,
  };
}

function collectTies(
  level: AggregationTie["level"],
  metric: AggregationTie["metric"],
  members: readonly { id: string; metrics: readonly CohortMetric[] }[],
): AggregationTie[] {
  const buckets = new Map<string, { cohortId: string; value: number; ids: string[] }>();
  for (const member of members) {
    for (const entry of member.metrics) {
      if (entry.value.state !== "available") continue;
      const key = `${entry.cohortId}\u0000${String(entry.value.value)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.ids.push(member.id);
      else {
        buckets.set(key, {
          cohortId: entry.cohortId,
          value: entry.value.value,
          ids: [member.id],
        });
      }
    }
  }
  const ties: AggregationTie[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.ids.length < 2) continue;
    ties.push({
      level,
      metric,
      cohortId: bucket.cohortId,
      value: bucket.value,
      memberIds: [...bucket.ids].sort(compareStrings),
    });
  }
  return ties;
}

function compareTies(a: AggregationTie, b: AggregationTie): number {
  if (a.level !== b.level) return a.level.localeCompare(b.level);
  if (a.metric !== b.metric) return a.metric.localeCompare(b.metric);
  if (a.cohortId !== b.cohortId) return a.cohortId.localeCompare(b.cohortId);
  if (a.value !== b.value) return a.value - b.value;
  return a.memberIds.join("\u0000").localeCompare(b.memberIds.join("\u0000"));
}

function collectViews(
  families: readonly FamilyAggregate[],
  kind: MetricCohortView["kind"],
): MetricCohortView[] {
  const byCohort = new Map<string, Array<string | null>>();
  for (const family of families) {
    const metrics = kind === "judged_score" ? family.judgedScores : family.passRates;
    for (const metric of metrics) {
      const familyIds = byCohort.get(metric.cohortId);
      if (familyIds) {
        if (!familyIds.some((id) => id === family.familyId)) familyIds.push(family.familyId);
      } else {
        byCohort.set(metric.cohortId, [family.familyId]);
      }
    }
  }
  return [...byCohort.keys()].sort(compareStrings).map((cohortId) => ({
    kind,
    cohortId,
    familyIds: (byCohort.get(cohortId) ?? []).sort(compareFamilyIds),
  }));
}

/**
 * Aggregate one exact-configuration selection into per-cohort family
 * hierarchy. Throws if called with a stratified rollup — member profiles
 * are never pooled.
 */
export function aggregateFamilyEvidence(
  selection: ProfileExactSelection,
  options: FamilyAggregationOptions = {},
): FamilyAggregationResult {
  if (selection.kind !== "exact") {
    throw new Error(
      "Family aggregation accepts an exact configuration selection only; stratified rollups are never pooled.",
    );
  }

  const rollupTaskVersions = options.rollupTaskVersions === true;
  const rubricMappings = options.commensurateRubricMappings ?? [];
  const verifierMappings = options.compatibleVerifierDefinitions ?? [];
  const facetMappings = options.criterionFacetMappings ?? [];
  const ignoredTaskSetWeights = options.taskSetWeights !== undefined;
  const configuration = selection.modelConfiguration;

  const leaves: Leaf[] = [];
  for (const cell of selection.cells) {
    const observation = cell.active.observation;
    leaves.push({
      observation,
      familyId: observation.taskFamilyId,
      scoreCohortId: buildJudgedScoreCohortId(observation, configuration, rubricMappings),
      passCohortId: buildPassRateCohortId(observation, configuration, verifierMappings),
    });
  }

  const families: FamilyAggregate[] = [];
  const ties: AggregationTie[] = [];
  const byFamily = groupBy(leaves, (leaf) => leaf.familyId);
  const familyIds = [...byFamily.keys()].sort(compareFamilyIds);

  for (const familyId of familyIds) {
    const familyLeaves = byFamily.get(familyId) ?? [];
    const byTask = groupBy(familyLeaves, (leaf) => leaf.observation.taskId);
    const taskIds = [...byTask.keys()].sort(compareStrings);
    const tasks: TaskAggregate[] = [];

    for (const taskId of taskIds) {
      const taskLeaves = byTask.get(taskId) ?? [];
      const byVersion = groupBy(taskLeaves, (leaf) => leaf.observation.taskVersion);
      const versionNumbers = [...byVersion.keys()].sort((a, b) => a - b);
      const versions: VersionAggregate[] = [];

      for (const taskVersion of versionNumbers) {
        const versionLeaves = byVersion.get(taskVersion) ?? [];
        const byInstance = groupBy(versionLeaves, (leaf) => leaf.observation.taskInstanceId);
        const instanceIds = [...byInstance.keys()].sort(compareStrings);
        const instances: InstanceAggregate[] = [];
        for (const taskInstanceId of instanceIds) {
          instances.push(buildInstance(byInstance.get(taskInstanceId) ?? [], facetMappings));
        }
        versions.push({
          taskId,
          taskVersion,
          familyId,
          judgedScores: rollUpMetrics(
            instances.map((instance) => instance.judgedScores),
            false,
          ),
          passRates: rollUpMetrics(
            instances.map((instance) => instance.passRates),
            false,
          ),
          instanceCount: instances.length,
          instances,
        });
        ties.push(
          ...collectTies(
            "instance",
            "judged_score",
            instances.map((instance) => ({
              id: `${instance.taskId}:${instance.taskVersion}:${instance.taskInstanceId}`,
              metrics: instance.judgedScores,
            })),
          ),
          ...collectTies(
            "instance",
            "pass_rate",
            instances.map((instance) => ({
              id: `${instance.taskId}:${instance.taskVersion}:${instance.taskInstanceId}`,
              metrics: instance.passRates,
            })),
          ),
        );
      }

      const task: TaskAggregate = {
        taskId,
        familyId,
        versions,
        judgedScores: rollUpMetrics(
          versions.map((version) => version.judgedScores),
          !rollupTaskVersions,
        ),
        passRates: rollUpMetrics(
          versions.map((version) => version.passRates),
          !rollupTaskVersions,
        ),
        rolledUp: rollupTaskVersions,
      };
      tasks.push(task);
      ties.push(
        ...collectTies(
          "version",
          "judged_score",
          versions.map((version) => ({
            id: `${version.taskId}:${version.taskVersion}`,
            metrics: version.judgedScores,
          })),
        ),
        ...collectTies(
          "version",
          "pass_rate",
          versions.map((version) => ({
            id: `${version.taskId}:${version.taskVersion}`,
            metrics: version.passRates,
          })),
        ),
      );
    }

    const family: FamilyAggregate = {
      familyId,
      judgedScores: rollUpMetrics(
        tasks.map((task) => task.judgedScores),
        false,
      ),
      passRates: rollUpMetrics(
        tasks.map((task) => task.passRates),
        false,
      ),
      taskCount: tasks.length,
      tasks,
    };
    families.push(family);
    ties.push(
      ...collectTies(
        "task",
        "judged_score",
        tasks.map((task) => ({ id: task.taskId, metrics: task.judgedScores })),
      ),
      ...collectTies(
        "task",
        "pass_rate",
        tasks.map((task) => ({ id: task.taskId, metrics: task.passRates })),
      ),
    );
  }

  ties.push(
    ...collectTies(
      "family",
      "judged_score",
      families.map((family) => ({
        id: family.familyId ?? "",
        metrics: family.judgedScores,
      })),
    ),
    ...collectTies(
      "family",
      "pass_rate",
      families.map((family) => ({
        id: family.familyId ?? "",
        metrics: family.passRates,
      })),
    ),
  );
  ties.sort(compareTies);

  return {
    aggregationRuleVersion: AGGREGATION_RULE_VERSION,
    rollupTaskVersions,
    ignoredTaskSetWeights,
    scoreViews: collectViews(families, "judged_score"),
    passViews: collectViews(families, "pass_rate"),
    families,
    ties,
  };
}
