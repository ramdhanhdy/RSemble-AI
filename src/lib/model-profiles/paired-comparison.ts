// =============================================================================
// RSemble AI — paired-comparison.ts (Child 07 Task 6, GREEN)
//
// Pure paired shared-task comparison over two explicitly selected exact
// configurations. Shared Tasks only (intersection of task identity);
// compatible assessment cohorts only; wins/ties/losses with an epsilon/tie
// rule; paired Task-level deltas; missing cells handled and disclosed; no
// shared Tasks -> explicit empty state. Changed task versions are shared by
// task identity and disclosed, never treated as independent resampling units.
// Known-related Tasks (same family / declared relation) are grouped into one
// dependency-aware resampling unit, never independent. Bootstraps paired
// deltas with the same disclosed dependency-aware resampling units as the
// uncertainty resolver (T5). Never compares unrelated task mixes.
//
// Cohort isolation (R4): more than one compatible assessment cohort inside a
// Task is never combined into one scalar. Comparable paired deltas are
// cohort-stratified: one PairedTaskDelta per (Task, shared cohort). The
// top-level mean / bootstrap / W-T-L are reported only when a single cohort
// is involved; otherwise they are reported per cohort in `cohortResults` and
// the top-level scalar fields stay null / zero so no cross-cohort synthetic
// scalar is ever produced.
//
// Contract (Child 07 spec §6.5, plan Task 6):
//  - intersection only: a task participates only when both selections have
//    at least one active observation eligible for paired_model_comparison.
//  - compatible assessment cohorts only: same rubric group (judged_score) or
//    verifier group (pass_rate) + same protocol + same evaluator. Incompatible
//    cohorts are disclosed and never pooled.
//  - wins/ties/losses per shared (Task, cohort) against an epsilon/tie rule.
//  - paired Task-level deltas: A metric - B metric, with hierarchical equal
//    weighting (instance -> version -> task) within each configuration, per
//    cohort.
//  - missing cells handled and disclosed: instance asymmetry within a shared
//    task, tasks present only in A (missing_in_b), only in B (missing_in_a).
//  - no shared Tasks -> explicit empty state with a reason.
//  - changed task versions: same task identity is shared; the version mismatch
//    is disclosed; the task contributes one delta per cohort and one
//    resampling unit per cohort.
//  - known-related Tasks grouped into one dependency-aware resampling unit
//    (family membership + declared relations); task_identity fallback when no
//    higher-order metadata exists, disclosed.
//  - bootstrap of paired deltas uses the disclosed dependency-aware units;
//    below five units -> insufficient coverage, no fake interval.
//  - deterministic, permutation-invariant; never mutates inputs.
//
// This module does not implement aggregation, claims, cache, UI, or a rollup
// store. It composes the existing uncertainty resolver unit shape and the
// cluster bootstrap; it does not re-pool observations across configurations.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type { EvaluatorSnapshot, Observation, VerifierSnapshot } from "../evidence/evidence-types";
import type { TaskFamilyAssignment, TaskFamilyRelation, VersionRef } from "../tasks/task-types";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
} from "./model-evidence-query";
import type { ProfileExactSelection, ProfileSelectedCell } from "./profile-observation-selection";
import type { CommensurateRubricMapping, CompatibleVerifierDefinition } from "./family-aggregation";
import {
  UNCERTAINTY_RULE_VERSION,
  type UncertaintyUnit,
  type UncertaintyUnitResolution,
} from "./uncertainty-unit-resolver";
import { bootstrapTaskClusters, type BootstrapResult } from "./cluster-bootstrap";

// --- Rule version --------------------------------------------------------------

export const PAIRED_COMPARISON_RULE_VERSION = QUERY_AGGREGATION_RULE_VERSION;

// --- Metric / outcome / state --------------------------------------------------

export type PairedMetricKind = "judged_score" | "pass_rate";

export type PairedOutcome = "win" | "tie" | "loss";

export type PairedTaskState =
  "comparable" | "incompatible_cohort" | "missing_in_a" | "missing_in_b";

// --- Task delta ----------------------------------------------------------------

export interface PairedTaskDelta {
  readonly taskId: string;
  readonly state: PairedTaskState;
  readonly metric: PairedMetricKind;
  /** Shared compatible assessment cohort id, or null when incompatible/missing. */
  readonly cohortId: string | null;
  /** Per-task metric for A (hierarchical mean within the cohort), or null when missing. */
  readonly valueA: number | null;
  /** Per-task metric for B (hierarchical mean within the cohort), or null when missing. */
  readonly valueB: number | null;
  /** valueA - valueB, or null when not comparable. */
  readonly delta: number | null;
  /** win / tie / loss, or null when not comparable. */
  readonly outcome: PairedOutcome | null;
  readonly versionsA: readonly number[];
  readonly versionsB: readonly number[];
  /** True when A and B observed different sets of task versions within this cohort. */
  readonly changedTaskVersion: boolean;
  readonly observationIdsA: readonly string[];
  readonly observationIdsB: readonly string[];
  readonly instancesA: readonly string[];
  readonly instancesB: readonly string[];
  /** Instances A has but B does not (within this shared task / cohort). */
  readonly missingInstancesA: readonly string[];
  /** Instances B has but A does not (within this shared task / cohort). */
  readonly missingInstancesB: readonly string[];
  readonly disclosure: string | null;
}

// --- Cohort-stratified result (R4) ---------------------------------------------

export interface PairedCohortResult {
  readonly cohortId: string;
  readonly comparableTaskCount: number;
  readonly wins: number;
  readonly ties: number;
  readonly losses: number;
  /** Mean of comparable deltas within this cohort, or null when there are none. */
  readonly meanDelta: number | null;
  readonly bootstrap: BootstrapResult | null;
  readonly uncertaintyResolution: UncertaintyUnitResolution | null;
}

// --- Coverage / result ---------------------------------------------------------

export interface PairedComparisonCoverage {
  readonly sharedTaskCount: number;
  readonly comparableTaskCount: number;
  readonly incompatibleTaskCount: number;
  readonly wins: number;
  readonly ties: number;
  readonly losses: number;
  readonly missingInA: number;
  readonly missingInB: number;
}

export interface PairedComparisonResult {
  readonly ruleVersion: number;
  readonly configurationAId: string;
  readonly configurationBId: string;
  readonly metric: PairedMetricKind;
  readonly epsilon: number;
  readonly empty: boolean;
  readonly emptyReason: string | null;
  readonly coverage: PairedComparisonCoverage;
  readonly taskDeltas: readonly PairedTaskDelta[];
  /**
   * Mean of comparable deltas. Populated only when exactly one compatible
   * cohort is involved; otherwise null (see cohortResults) so no cross-cohort
   * synthetic scalar is ever produced (R4).
   */
  readonly meanDelta: number | null;
  /**
   * Bootstrap of comparable deltas. Populated only when exactly one compatible
   * cohort is involved; otherwise null (see cohortResults).
   */
  readonly bootstrap: BootstrapResult | null;
  readonly uncertaintyResolution: UncertaintyUnitResolution | null;
  /** Per-cohort stratified results (R4). One entry per compatible cohort. */
  readonly cohortResults: readonly PairedCohortResult[];
  readonly disclosures: readonly string[];
}

// --- Input ---------------------------------------------------------------------

export interface PairedComparisonOptions {
  readonly metric: PairedMetricKind;
  /** Tie threshold; |delta| <= epsilon is a tie. Default 0. */
  readonly epsilon?: number;
  readonly commensurateRubricMappings?: readonly CommensurateRubricMapping[];
  readonly compatibleVerifierDefinitions?: readonly CompatibleVerifierDefinition[];
}

export interface PairedComparisonInput {
  readonly selectionA: ProfileExactSelection;
  readonly selectionB: ProfileExactSelection;
  readonly options: PairedComparisonOptions;
  readonly uncertainty: {
    readonly taskFamilyRelations: readonly TaskFamilyRelation[];
    readonly taskFamilyAssignments: readonly TaskFamilyAssignment[];
    readonly queryFingerprint: string;
    readonly intervalLevel?: number;
    readonly resamples?: number;
  };
}

// --- Internal helpers ----------------------------------------------------------

const DEFAULT_EPSILON = 0;

function sameRef(a: VersionRef | null, b: VersionRef | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
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

/**
 * Assessment-only cohort id for paired comparison: rubric group (judged_score)
 * or verifier group (pass_rate) + protocol fingerprint + pinned evaluator.
 * Configuration identity (provider/model/version/reasoning/tools) is excluded
 * by design — A and B are different respondents by definition.
 */
function pairedCohortId(
  observation: Observation,
  metric: PairedMetricKind,
  rubricMappings: readonly CommensurateRubricMapping[],
  verifierMappings: readonly CompatibleVerifierDefinition[],
): string {
  const payload =
    metric === "judged_score"
      ? {
          kind: "paired_judged_score",
          rubricGroup: rubricGroupId(observation.rubricRef, rubricMappings),
          protocolFingerprint: observation.protocolFingerprint,
          evaluator: pinEvaluator(observation.evaluatorSnapshot),
        }
      : {
          kind: "paired_pass_rate",
          verifierGroup: verifierGroupId(observation.verifierSnapshot, verifierMappings),
          protocolFingerprint: observation.protocolFingerprint,
          evaluator: pinEvaluator(observation.evaluatorSnapshot),
        };
  return hashArtifactContent(canonicalJsonString(payload));
}

function groupBy<K, T>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = map.get(key);
    if (group) group.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function arithmeticMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Hierarchical equal-weighting task metric (spec §6.2): replicate scores mean
 * within a Task Instance, instance means mean within a Task Version, version
 * means mean within the Task. Returns null when no usable observations exist.
 */
function taskMetric(
  cells: readonly ProfileSelectedCell[],
  metric: PairedMetricKind,
): number | null {
  if (cells.length === 0) return null;

  // version -> instance -> replicate values
  const byVersion = groupBy(cells, (c) => c.taskVersion);
  const versionMeans: number[] = [];

  for (const [, versionCells] of byVersion) {
    const byInstance = groupBy(versionCells, (c) => c.taskInstanceId);
    const instanceMeans: number[] = [];
    for (const [, instanceCells] of byInstance) {
      const replicateValues: number[] = [];
      for (const cell of instanceCells) {
        const obs = cell.active.observation;
        if (metric === "judged_score") {
          const score = obs.outcome.overallScore;
          if (score !== null) replicateValues.push(score);
        } else {
          const passed = obs.outcome.verifierPassed;
          if (passed !== null) replicateValues.push(passed ? 1 : 0);
        }
      }
      if (replicateValues.length > 0) {
        instanceMeans.push(arithmeticMean(replicateValues));
      }
    }
    if (instanceMeans.length > 0) {
      versionMeans.push(arithmeticMean(instanceMeans));
    }
  }

  if (versionMeans.length === 0) return null;
  return arithmeticMean(versionMeans);
}

function classifyOutcome(delta: number, epsilon: number): PairedOutcome {
  if (delta > epsilon) return "win";
  if (delta < -epsilon) return "loss";
  return "tie";
}

// --- Dependency-aware paired unit assignment -----------------------------------

function buildFamilyIndex(assignments: readonly TaskFamilyAssignment[]): Map<string, string[]> {
  const taskFamily = new Map<string, string>();
  for (const assign of assignments) {
    if (!assign.isPrimary) continue;
    taskFamily.set(assign.taskId, assign.familyId);
  }
  const index = new Map<string, string[]>();
  for (const [taskId, familyId] of taskFamily) {
    const tasks = index.get(familyId);
    if (tasks) tasks.push(taskId);
    else index.set(familyId, [taskId]);
  }
  return index;
}

/**
 * Group comparable shared tasks into dependency-aware resampling units using
 * the same family-membership + declared-relation union-find as the uncertainty
 * resolver (T5). Tasks linked by family membership or a declared relation form
 * one task_family_relation unit; unlinked tasks become task_identity units.
 * Known-related Tasks are therefore never treated as independent.
 */
function resolvePairedUnits(
  comparableTaskIds: readonly string[],
  taskFamilyAssignments: readonly TaskFamilyAssignment[],
  taskFamilyRelations: readonly TaskFamilyRelation[],
  taskToObservationIds: ReadonlyMap<string, string[]>,
): UncertaintyUnitResolution {
  const disclosures: string[] = [];

  if (comparableTaskIds.length === 0) {
    return {
      uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
      assignmentDigest: computeAssignmentDigest([]),
      units: [],
      unitCount: 0,
      fallbackAssumption: null,
      disclosures: ["No comparable shared tasks — no paired resampling units."],
    };
  }

  const familyIndex = buildFamilyIndex(taskFamilyAssignments);

  const taskToRoot = new Map<string, string>();
  const rootToTasks = new Map<string, string[]>();

  function findRoot(taskId: string): string {
    const existing = taskToRoot.get(taskId);
    if (!existing) {
      taskToRoot.set(taskId, taskId);
      rootToTasks.set(taskId, [taskId]);
      return taskId;
    }
    if (existing !== taskId) {
      const root = findRoot(existing);
      taskToRoot.set(taskId, root);
      return root;
    }
    return taskId;
  }

  function union(a: string, b: string): void {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA === rootB) return;
    const tasksA = rootToTasks.get(rootA) ?? [];
    const tasksB = rootToTasks.get(rootB) ?? [];
    if (tasksA.length >= tasksB.length) {
      for (const t of tasksB) taskToRoot.set(t, rootA);
      rootToTasks.set(rootA, [...tasksA, ...tasksB]);
      rootToTasks.delete(rootB);
    } else {
      for (const t of tasksA) taskToRoot.set(t, rootB);
      rootToTasks.set(rootB, [...tasksB, ...tasksA]);
      rootToTasks.delete(rootA);
    }
  }

  // Union tasks in the same family (only over comparable tasks present).
  const present = new Set(comparableTaskIds);
  for (const [, taskIds] of familyIndex) {
    const presentInFamily = taskIds.filter((t) => present.has(t));
    if (presentInFamily.length > 1) {
      const first = presentInFamily[0]!;
      for (let i = 1; i < presentInFamily.length; i++) {
        union(first, presentInFamily[i]!);
      }
    }
  }

  // Union tasks linked by declared family relations.
  for (const rel of taskFamilyRelations) {
    const familyATasks = (familyIndex.get(rel.fromFamilyId) ?? []).filter((t) => present.has(t));
    const familyBTasks = (familyIndex.get(rel.toFamilyId) ?? []).filter((t) => present.has(t));
    if (familyATasks.length > 0 && familyBTasks.length > 0) {
      union(familyATasks[0]!, familyBTasks[0]!);
    }
  }

  const units: UncertaintyUnit[] = [];
  const grouped = new Set<string>();

  // Units with >1 task -> task_family_relation.
  for (const [, tasks] of rootToTasks) {
    if (tasks.length > 1) {
      const sorted = [...tasks].sort();
      const observationIds = sorted.flatMap((t) => taskToObservationIds.get(t) ?? []).sort();
      units.push({
        unitId: `unit:task_family_relation:${sorted.join(",")}`,
        kind: "task_family_relation",
        taskIds: sorted,
        observationIds,
        cellKeys: [],
        splitReason: "Tasks are linked by family membership or declared relation",
      });
      for (const t of sorted) grouped.add(t);
    }
  }

  // Remaining ungrouped tasks -> task_identity units.
  let hasFallback = false;
  for (const taskId of comparableTaskIds) {
    if (grouped.has(taskId)) continue;
    hasFallback = true;
    const observationIds = (taskToObservationIds.get(taskId) ?? []).slice().sort();
    units.push({
      unitId: `unit:task_identity:${taskId}`,
      kind: "task_identity",
      taskIds: [taskId],
      observationIds,
      cellKeys: [],
      splitReason: "No higher-order dependency metadata — task identity fallback",
    });
  }

  units.sort((a, b) => a.unitId.localeCompare(b.unitId));

  const fallbackAssumption = hasFallback
    ? "Task identity is the explicit fallback assumption for ungrouped shared tasks"
    : null;
  if (hasFallback) {
    disclosures.push(
      "Some shared tasks have no higher-order dependency metadata — using task identity fallback for paired resampling units.",
    );
  }
  if (units.some((u) => u.kind === "task_family_relation")) {
    disclosures.push(
      "Known-related shared tasks grouped into one dependency-aware resampling unit — never treated as independent.",
    );
  }

  return {
    uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
    assignmentDigest: computeAssignmentDigest(units),
    units,
    unitCount: units.length,
    fallbackAssumption,
    disclosures,
  };
}

function computeAssignmentDigest(units: readonly UncertaintyUnit[]): string {
  const payload = units.map((u) => ({
    unitId: u.unitId,
    kind: u.kind,
    taskIds: [...u.taskIds].sort(),
    observationIds: [...u.observationIds].sort(),
  }));
  return hashArtifactContent(canonicalJsonString(payload));
}

// --- Cohort aggregation (R4) ---------------------------------------------------

interface CohortAggregation {
  readonly cohortId: string;
  readonly taskDeltas: { taskId: string; delta: number }[];
  readonly taskIds: string[];
  readonly taskToObservationIds: Map<string, string[]>;
  wins: number;
  ties: number;
  losses: number;
}

function bootstrapCohort(
  agg: CohortAggregation,
  input: PairedComparisonInput,
): { bootstrap: BootstrapResult | null; resolution: UncertaintyUnitResolution | null } {
  if (agg.taskIds.length === 0) {
    return { bootstrap: null, resolution: null };
  }
  const resolution = resolvePairedUnits(
    agg.taskIds,
    input.uncertainty.taskFamilyAssignments,
    input.uncertainty.taskFamilyRelations,
    agg.taskToObservationIds,
  );
  const taskDeltaMap = new Map<string, number>(agg.taskDeltas.map((d) => [d.taskId, d.delta]));
  const unitValues = new Map<string, number>();
  for (const unit of resolution.units) {
    const unitDeltas = unit.taskIds
      .map((t) => taskDeltaMap.get(t))
      .filter((v): v is number => v !== undefined);
    if (unitDeltas.length > 0) {
      unitValues.set(unit.unitId, arithmeticMean(unitDeltas));
    }
  }
  const bootstrap = bootstrapTaskClusters({
    resolution,
    config: {
      queryFingerprint: input.uncertainty.queryFingerprint,
      aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
      uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
      assignmentDigest: resolution.assignmentDigest,
      intervalLevel: input.uncertainty.intervalLevel,
      resamples: input.uncertainty.resamples,
    },
    unitValues,
  });
  return { bootstrap, resolution };
}

// --- Main entry point ----------------------------------------------------------

/**
 * Compute a paired shared-task comparison between two exact-configuration
 * selections. Pure: never mutates the inputs. Deterministic and
 * permutation-invariant. Comparable deltas are cohort-stratified (R4).
 */
export function computePairedEvidence(input: PairedComparisonInput): PairedComparisonResult {
  const { selectionA, selectionB, options, uncertainty } = input;
  const metric = options.metric;
  const epsilon = options.epsilon ?? DEFAULT_EPSILON;
  const rubricMappings = options.commensurateRubricMappings ?? [];
  const verifierMappings = options.compatibleVerifierDefinitions ?? [];

  // 1. Filter to paired_model_comparison-eligible cells.
  const pairedCellsA = selectionA.cells.filter((c) =>
    c.active.decision.allowedUses.includes("paired_model_comparison"),
  );
  const pairedCellsB = selectionB.cells.filter((c) =>
    c.active.decision.allowedUses.includes("paired_model_comparison"),
  );

  const byTaskA = groupBy(pairedCellsA, (c) => c.taskId);
  const byTaskB = groupBy(pairedCellsB, (c) => c.taskId);

  const tasksA = new Set(byTaskA.keys());
  const tasksB = new Set(byTaskB.keys());
  const allTasks = uniqueSortedStrings([...tasksA, ...tasksB]);
  const sharedTasks = allTasks.filter((t) => tasksA.has(t) && tasksB.has(t));

  const disclosures: string[] = [];
  const taskDeltas: PairedTaskDelta[] = [];

  // 2. Empty state: no shared tasks.
  if (sharedTasks.length === 0) {
    for (const taskId of allTasks) {
      const inA = tasksA.has(taskId);
      const inB = tasksB.has(taskId);
      const cells = inA ? byTaskA.get(taskId)! : byTaskB.get(taskId)!;
      taskDeltas.push({
        taskId,
        state: inA ? "missing_in_b" : "missing_in_a",
        metric,
        cohortId: null,
        valueA: inA ? taskMetric(byTaskA.get(taskId) ?? [], metric) : null,
        valueB: inB ? taskMetric(byTaskB.get(taskId) ?? [], metric) : null,
        delta: null,
        outcome: null,
        versionsA: inA ? uniqueSortedNumbers(cells.map((c) => c.taskVersion)) : [],
        versionsB: inB ? uniqueSortedNumbers(cells.map((c) => c.taskVersion)) : [],
        changedTaskVersion: false,
        observationIdsA: inA ? cells.map((c) => c.active.observation.id).sort() : [],
        observationIdsB: inB ? cells.map((c) => c.active.observation.id).sort() : [],
        instancesA: inA ? uniqueSortedStrings(cells.map((c) => c.taskInstanceId)) : [],
        instancesB: inB ? uniqueSortedStrings(cells.map((c) => c.taskInstanceId)) : [],
        missingInstancesA: [],
        missingInstancesB: [],
        disclosure: inA
          ? `Task "${taskId}" has paired evidence for configuration A only — not shared.`
          : `Task "${taskId}" has paired evidence for configuration B only — not shared.`,
      });
    }
    taskDeltas.sort((a, b) => a.taskId.localeCompare(b.taskId));
    return {
      ruleVersion: PAIRED_COMPARISON_RULE_VERSION,
      configurationAId: selectionA.modelConfiguration.id,
      configurationBId: selectionB.modelConfiguration.id,
      metric,
      epsilon,
      empty: true,
      emptyReason:
        "No shared Tasks eligible for paired_model_comparison between the two configurations.",
      coverage: {
        sharedTaskCount: 0,
        comparableTaskCount: 0,
        incompatibleTaskCount: 0,
        wins: 0,
        ties: 0,
        losses: 0,
        missingInA: allTasks.filter((t) => tasksB.has(t) && !tasksA.has(t)).length,
        missingInB: allTasks.filter((t) => tasksA.has(t) && !tasksB.has(t)).length,
      },
      taskDeltas,
      meanDelta: null,
      bootstrap: null,
      uncertaintyResolution: null,
      cohortResults: [],
      disclosures: [
        "No shared Tasks eligible for paired_model_comparison — paired comparison is empty.",
      ],
    };
  }

  // 3. Per-task deltas (cohort-stratified for comparable tasks).
  let incompatibleCount = 0;
  const cohortAggs = new Map<string, CohortAggregation>();

  for (const taskId of allTasks) {
    const inA = tasksA.has(taskId);
    const inB = tasksB.has(taskId);
    const cellsA = inA ? byTaskA.get(taskId)! : [];
    const cellsB = inB ? byTaskB.get(taskId)! : [];

    if (!inA || !inB) {
      // Missing on one side.
      const versionsA = inA ? uniqueSortedNumbers(cellsA.map((c) => c.taskVersion)) : [];
      const versionsB = inB ? uniqueSortedNumbers(cellsB.map((c) => c.taskVersion)) : [];
      taskDeltas.push({
        taskId,
        state: inA ? "missing_in_b" : "missing_in_a",
        metric,
        cohortId: null,
        valueA: inA ? taskMetric(cellsA, metric) : null,
        valueB: inB ? taskMetric(cellsB, metric) : null,
        delta: null,
        outcome: null,
        versionsA,
        versionsB,
        changedTaskVersion: false,
        observationIdsA: inA ? cellsA.map((c) => c.active.observation.id).sort() : [],
        observationIdsB: inB ? cellsB.map((c) => c.active.observation.id).sort() : [],
        instancesA: inA ? uniqueSortedStrings(cellsA.map((c) => c.taskInstanceId)) : [],
        instancesB: inB ? uniqueSortedStrings(cellsB.map((c) => c.taskInstanceId)) : [],
        missingInstancesA: [],
        missingInstancesB: [],
        disclosure: inA
          ? `Task "${taskId}" has paired evidence for configuration A only — not shared.`
          : `Task "${taskId}" has paired evidence for configuration B only — not shared.`,
      });
      continue;
    }

    // Shared task. Check cohort compatibility across all A and B observations.
    const cohortIdsA = new Set(
      cellsA.map((c) =>
        pairedCohortId(c.active.observation, metric, rubricMappings, verifierMappings),
      ),
    );
    const cohortIdsB = new Set(
      cellsB.map((c) =>
        pairedCohortId(c.active.observation, metric, rubricMappings, verifierMappings),
      ),
    );
    const sharedCohorts = [...cohortIdsA].filter((id) => cohortIdsB.has(id)).sort();

    if (sharedCohorts.length === 0) {
      incompatibleCount += 1;
      const versionsA = uniqueSortedNumbers(cellsA.map((c) => c.taskVersion));
      const versionsB = uniqueSortedNumbers(cellsB.map((c) => c.taskVersion));
      taskDeltas.push({
        taskId,
        state: "incompatible_cohort",
        metric,
        cohortId: null,
        valueA: taskMetric(cellsA, metric),
        valueB: taskMetric(cellsB, metric),
        delta: null,
        outcome: null,
        versionsA,
        versionsB,
        changedTaskVersion:
          versionsA.length !== versionsB.length || versionsA.some((v, i) => v !== versionsB[i]),
        observationIdsA: cellsA.map((c) => c.active.observation.id).sort(),
        observationIdsB: cellsB.map((c) => c.active.observation.id).sort(),
        instancesA: uniqueSortedStrings(cellsA.map((c) => c.taskInstanceId)),
        instancesB: uniqueSortedStrings(cellsB.map((c) => c.taskInstanceId)),
        missingInstancesA: [],
        missingInstancesB: [],
        disclosure: `Task "${taskId}" is shared but the two configurations were assessed under incompatible ${metric === "judged_score" ? "rubric" : "verifier"} cohorts — not pooled.`,
      });
      continue;
    }

    // Cohort-stratified comparable deltas: one per shared cohort. NEVER combine
    // multiple compatible cohorts inside a Task into one scalar (R4).
    let comparableForTask = 0;
    for (const cohortId of sharedCohorts) {
      const compatibleA = cellsA.filter((c) =>
        cohortId ===
        pairedCohortId(c.active.observation, metric, rubricMappings, verifierMappings),
      );
      const compatibleB = cellsB.filter((c) =>
        cohortId ===
        pairedCohortId(c.active.observation, metric, rubricMappings, verifierMappings),
      );

      const versionsA = uniqueSortedNumbers(compatibleA.map((c) => c.taskVersion));
      const versionsB = uniqueSortedNumbers(compatibleB.map((c) => c.taskVersion));
      const changedTaskVersion =
        versionsA.length !== versionsB.length || versionsA.some((v, i) => v !== versionsB[i]);
      const instancesA = uniqueSortedStrings(compatibleA.map((c) => c.taskInstanceId));
      const instancesB = uniqueSortedStrings(compatibleB.map((c) => c.taskInstanceId));
      const missingInstancesA = instancesB.filter((i) => !instancesA.includes(i));
      const missingInstancesB = instancesA.filter((i) => !instancesB.includes(i));
      const obsIdsA = compatibleA.map((c) => c.active.observation.id).sort();
      const obsIdsB = compatibleB.map((c) => c.active.observation.id).sort();

      const valueA = taskMetric(compatibleA, metric);
      const valueB = taskMetric(compatibleB, metric);

      if (valueA === null || valueB === null) {
        // Shared cohort but no usable metric values on one side within it.
        taskDeltas.push({
          taskId,
          state: "incompatible_cohort",
          metric,
          cohortId,
          valueA,
          valueB,
          delta: null,
          outcome: null,
          versionsA,
          versionsB,
          changedTaskVersion,
          observationIdsA: obsIdsA,
          observationIdsB: obsIdsB,
          instancesA,
          instancesB,
          missingInstancesA,
          missingInstancesB,
          disclosure: `Task "${taskId}" has no usable ${metric} values on one configuration within the shared cohort — not compared.`,
        });
        continue;
      }

      const delta = valueA - valueB;
      const outcome = classifyOutcome(delta, epsilon);
      comparableForTask += 1;

      const parts: string[] = [];
      if (changedTaskVersion) {
        parts.push(
          `Task "${taskId}" was observed under different task versions (A: ${versionsA.join(",")}; B: ${versionsB.join(",")}) within the shared cohort — same task identity, disclosed.`,
        );
      }
      if (missingInstancesA.length > 0 || missingInstancesB.length > 0) {
        parts.push(
          `Instance coverage differs (missing in A: ${missingInstancesA.join(",") || "none"}; missing in B: ${missingInstancesB.join(",") || "none"}).`,
        );
      }

      taskDeltas.push({
        taskId,
        state: "comparable",
        metric,
        cohortId,
        valueA,
        valueB,
        delta,
        outcome,
        versionsA,
        versionsB,
        changedTaskVersion,
        observationIdsA: obsIdsA,
        observationIdsB: obsIdsB,
        instancesA,
        instancesB,
        missingInstancesA,
        missingInstancesB,
        disclosure: parts.length > 0 ? parts.join(" ") : null,
      });

      // Accumulate per-cohort aggregation.
      let agg = cohortAggs.get(cohortId);
      if (!agg) {
        agg = {
          cohortId,
          taskDeltas: [],
          taskIds: [],
          taskToObservationIds: new Map<string, string[]>(),
          wins: 0,
          ties: 0,
          losses: 0,
        };
        cohortAggs.set(cohortId, agg);
      }
      agg.taskDeltas.push({ taskId, delta });
      agg.taskIds.push(taskId);
      agg.taskToObservationIds.set(taskId, [...obsIdsA, ...obsIdsB]);
      if (outcome === "win") agg.wins += 1;
      else if (outcome === "tie") agg.ties += 1;
      else agg.losses += 1;
    }

    if (comparableForTask === 0) {
      incompatibleCount += 1;
    }
  }

  taskDeltas.sort((a, b) => {
    if (a.taskId !== b.taskId) return a.taskId.localeCompare(b.taskId);
    // Stable, deterministic ordering of cohort-stratified deltas for one task.
    const ca = a.cohortId ?? "";
    const cb = b.cohortId ?? "";
    return ca.localeCompare(cb);
  });

  // 4. Cohort-stratified results (R4).
  const sortedCohortIds = [...cohortAggs.keys()].sort();
  const cohortResults: PairedCohortResult[] = [];
  for (const cohortId of sortedCohortIds) {
    const agg = cohortAggs.get(cohortId)!;
    const meanDelta =
      agg.taskDeltas.length > 0 ? arithmeticMean(agg.taskDeltas.map((d) => d.delta)) : null;
    const { bootstrap, resolution } = bootstrapCohort(agg, input);
    if (resolution) {
      disclosures.push(...resolution.disclosures);
    }
    if (bootstrap && bootstrap.coverageState.state === "insufficient") {
      disclosures.push(
        `Insufficient independent coverage for a paired-delta interval in cohort ${cohortId.slice(0, 12)}… (${bootstrap.unitCount} resolved unit(s)).`,
      );
    }
    cohortResults.push({
      cohortId,
      comparableTaskCount: agg.taskIds.length,
      wins: agg.wins,
      ties: agg.ties,
      losses: agg.losses,
      meanDelta,
      bootstrap,
      uncertaintyResolution: resolution,
    });
  }

  // 5. Top-level scalars: only when a single cohort is involved. With
  //    multiple cohorts the top-level mean / bootstrap / W-T-L stay null / 0
  //    so no cross-cohort synthetic scalar is ever produced (R4).
  const singleCohort =
    cohortResults.length === 1 ? cohortResults[0]! : null;

  const meanDelta = singleCohort ? singleCohort.meanDelta : null;
  const bootstrap = singleCohort ? singleCohort.bootstrap : null;
  const uncertaintyResolution = singleCohort ? singleCohort.uncertaintyResolution : null;
  const wins = singleCohort ? singleCohort.wins : 0;
  const ties = singleCohort ? singleCohort.ties : 0;
  const losses = singleCohort ? singleCohort.losses : 0;
  const comparableTaskCount = cohortResults.reduce((sum, c) => sum + c.comparableTaskCount, 0);

  // 6. Disclosures.
  if (incompatibleCount > 0) {
    disclosures.push(
      `${incompatibleCount} shared task(s) had incompatible assessment cohorts and were not pooled into paired deltas.`,
    );
  }
  const missingA = allTasks.filter((t) => tasksB.has(t) && !tasksA.has(t)).length;
  const missingB = allTasks.filter((t) => tasksA.has(t) && !tasksB.has(t)).length;
  if (missingA > 0) {
    disclosures.push(`${missingA} task(s) have paired evidence for B only (missing in A).`);
  }
  if (missingB > 0) {
    disclosures.push(`${missingB} task(s) have paired evidence for A only (missing in B).`);
  }
  const changedVersionsTasks = new Set(
    taskDeltas.filter((d) => d.changedTaskVersion).map((d) => d.taskId),
  );
  if (changedVersionsTasks.size > 0) {
    disclosures.push(
      `${changedVersionsTasks.size} shared task(s) were observed under different task versions — same task identity, disclosed, never treated as independent.`,
    );
  }
  const instanceGapTasks = new Set(
    taskDeltas
      .filter(
        (d) =>
          d.state === "comparable" &&
          (d.missingInstancesA.length > 0 || d.missingInstancesB.length > 0),
      )
      .map((d) => d.taskId),
  );
  if (instanceGapTasks.size > 0) {
    disclosures.push(
      `${instanceGapTasks.size} comparable shared task(s) have missing instances on one configuration — disclosed.`,
    );
  }
  if (cohortResults.length > 1) {
    disclosures.push(
      `${cohortResults.length} compatible assessment cohorts are involved; wins/ties/losses, mean delta, and the bootstrap interval are reported per cohort in cohortResults and are not combined across cohorts.`,
    );
  }

  return {
    ruleVersion: PAIRED_COMPARISON_RULE_VERSION,
    configurationAId: selectionA.modelConfiguration.id,
    configurationBId: selectionB.modelConfiguration.id,
    metric,
    epsilon,
    empty: false,
    emptyReason: null,
    coverage: {
      sharedTaskCount: sharedTasks.length,
      comparableTaskCount,
      incompatibleTaskCount: incompatibleCount,
      wins,
      ties,
      losses,
      missingInA: missingA,
      missingInB: missingB,
    },
    taskDeltas,
    meanDelta,
    bootstrap,
    uncertaintyResolution,
    cohortResults,
    disclosures,
  };
}
