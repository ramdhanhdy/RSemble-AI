// =============================================================================
// RSemble AI — uncertainty-unit-resolver.ts (Child 07 Task 5, GREEN)
//
// Versioned pure uncertainty-unit resolver: declared protocol clusters,
// repository/source grouping, typed Task relations; when no higher-order
// metadata exists, Task identity is the explicit fallback assumption and the
// UI says so (disclosed). Conflicting/missing metadata handled. Assignment
// digest + rule version pinned in the result receipt.
//
// The dependency-partitioning policy is exposed as a pure core
// (`partitionUncertaintyUnits`) operating on `PartitionInput` rows, so the
// paired comparison (T6) reuses the SAME core instead of a reduced
// T6-specific resolver (R5). Policy order:
//   protocol cluster -> source/repository group -> typed Task relation ->
//   disclosed Task identity fallback.
//
// Contract (Child 07 spec §6.4, plan Task 5):
//  - protocol clusters when multiple protocol fingerprints exist
//  - repository/source groups when single protocol but multiple sources
//  - task family relation groups when related tasks exist
//  - task identity fallback when no higher-order dependency metadata
//  - conflicting/missing metadata → disclosed, not silent
//  - assignment digest stable and rule-version pinned
//  - permutation-invariant
//  - empty/single-cell edge cases
//  - below five resolved units detectable
//
// This module does not implement bootstrap, paired comparison, claims,
// cache, UI, or a rollup store.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type { TaskFamilyAssignment, TaskFamilyRelation } from "../tasks/task-types";
import { QUERY_UNCERTAINTY_RULE_VERSION, type ModelEvidenceQuery } from "./model-evidence-query";
import type { ProfileExactSelection, ProfileSelectedCell } from "./profile-observation-selection";

// --- Rule version ---------------------------------------------------------------

export const UNCERTAINTY_RULE_VERSION = QUERY_UNCERTAINTY_RULE_VERSION;

// --- Unit kinds -----------------------------------------------------------------

export type UncertaintyUnitKind =
  "protocol_cluster" | "repository_group" | "task_family_relation" | "task_identity";

// --- Unit -----------------------------------------------------------------------

export interface UncertaintyUnit {
  readonly unitId: string;
  readonly kind: UncertaintyUnitKind;
  readonly taskIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly cellKeys: readonly string[];
  readonly splitReason: string | null;
}

// --- Resolution -----------------------------------------------------------------

export interface UncertaintyUnitResolution {
  readonly uncertaintyRuleVersion: number;
  readonly assignmentDigest: string;
  readonly units: readonly UncertaintyUnit[];
  readonly unitCount: number;
  readonly fallbackAssumption: string | null;
  readonly disclosures: readonly string[];
}

// --- Partition input (common core) ---------------------------------------------

/**
 * A single observation row reduced to the fields the dependency-partitioning
 * core needs. Both the T5 resolver and the T6 paired comparison feed rows of
 * this shape into `partitionUncertaintyUnits` so they share one policy
 * implementation (R5).
 */
export interface PartitionInput {
  readonly protocolFingerprint: string;
  readonly sourceResultId: string;
  readonly taskId: string;
  readonly observationId: string;
  readonly cellKey: string;
}

// --- Resolver input (T5 wrapper) ------------------------------------------------

export interface UncertaintyResolverInput {
  readonly selection: ProfileExactSelection;
  readonly query: ModelEvidenceQuery;
  readonly taskFamilyRelations: readonly TaskFamilyRelation[];
  readonly taskFamilyAssignments: readonly TaskFamilyAssignment[];
}

// --- Internal helpers -----------------------------------------------------------

function groupBy<K, T>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}

function buildUnitId(
  kind: UncertaintyUnitKind,
  taskIds: readonly string[],
  partitionKey?: string,
): string {
  const sorted = [...taskIds].sort();
  // The partition key (protocol fingerprint / source repository id) MUST be
  // part of the unit id: two clusters that happen to share Task IDs but live
  // in different protocols/sources are distinct resampling partitions and
  // must never collapse to the same id (R2).
  if (partitionKey !== undefined) {
    return `unit:${kind}:${partitionKey}:${sorted.join(",")}`;
  }
  return `unit:${kind}:${sorted.join(",")}`;
}

/**
 * Collect the set of primary family ids declared for each task. A task with
 * more than one distinct primary family is conflicted. Computation is
 * order-independent (uses sets), so the conflicted set is permutation-invariant
 * over the assignments array (R3).
 */
function primaryFamiliesByTask(
  assignments: readonly TaskFamilyAssignment[],
): Map<string, Set<string>> {
  const familiesByTask = new Map<string, Set<string>>();
  for (const assign of assignments) {
    if (!assign.isPrimary) continue;
    const set = familiesByTask.get(assign.taskId);
    if (set) {
      set.add(assign.familyId);
    } else {
      familiesByTask.set(assign.taskId, new Set<string>([assign.familyId]));
    }
  }
  return familiesByTask;
}

function conflictedTaskIds(assignments: readonly TaskFamilyAssignment[]): Set<string> {
  const familiesByTask = primaryFamiliesByTask(assignments);
  const conflicted = new Set<string>();
  for (const [taskId, families] of familiesByTask) {
    if (families.size > 1) conflicted.add(taskId);
  }
  return conflicted;
}

function detectFamilyConflicts(assignments: readonly TaskFamilyAssignment[]): string[] {
  const familiesByTask = primaryFamiliesByTask(assignments);
  const conflicts: string[] = [];
  for (const [taskId, families] of familiesByTask) {
    if (families.size > 1) {
      const sorted = [...families].sort();
      conflicts.push(
        `Task "${taskId}" has multiple conflicting primary family assignments: ${sorted.map((f) => `"${f}"`).join(", ")} — resolved conservatively (not grouped into any family).`,
      );
    }
  }
  // Deterministic disclosure order, independent of assignment input order.
  conflicts.sort((a, b) => a.localeCompare(b));
  return conflicts;
}

function buildFamilyIndex(assignments: readonly TaskFamilyAssignment[]): Map<string, string[]> {
  // Conflicted tasks are excluded conservatively: a task with contradictory
  // primary family metadata is never silently assigned to one of the
  // conflicting families (R3). It falls through to task_identity fallback.
  const conflicted = conflictedTaskIds(assignments);
  const index = new Map<string, string[]>();
  const taskFamily = new Map<string, string>();

  for (const assign of assignments) {
    if (!assign.isPrimary) continue;
    if (conflicted.has(assign.taskId)) continue;
    taskFamily.set(assign.taskId, assign.familyId);
  }

  for (const [taskId, familyId] of taskFamily) {
    const tasks = index.get(familyId);
    if (tasks) {
      tasks.push(taskId);
    } else {
      index.set(familyId, [taskId]);
    }
  }

  return index;
}

function buildFamilyRelationGroups(
  rows: readonly PartitionInput[],
  assignments: readonly TaskFamilyAssignment[],
  relations: readonly TaskFamilyRelation[],
): Map<string, PartitionInput[]> {
  const familyIndex = buildFamilyIndex(assignments);

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

  // Union tasks in the same family
  for (const [, taskIds] of familyIndex) {
    if (taskIds.length > 1) {
      const first = taskIds[0]!;
      for (let i = 1; i < taskIds.length; i++) {
        union(first, taskIds[i]!);
      }
    }
  }

  // Union tasks with declared family relations
  for (const rel of relations) {
    const familyATasks = familyIndex.get(rel.fromFamilyId) ?? [];
    const familyBTasks = familyIndex.get(rel.toFamilyId) ?? [];
    if (familyATasks.length > 0 && familyBTasks.length > 0) {
      union(familyATasks[0]!, familyBTasks[0]!);
    }
  }

  // Build groups: assign rows to their task's root group
  const groups = new Map<string, PartitionInput[]>();

  for (const row of rows) {
    const root = findRoot(row.taskId);
    const siblings = rootToTasks.get(root) ?? [];
    if (siblings.length > 1) {
      const group = groups.get(root);
      if (group) {
        group.push(row);
      } else {
        groups.set(root, [row]);
      }
    }
  }

  return groups;
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

// --- Common partitioning core (R5) ---------------------------------------------

/**
 * Pure dependency-partitioning core shared by the T5 uncertainty resolver
 * and the T6 paired comparison. Partitions observation rows into resampling
 * units following the policy:
 *   1. protocol clusters   (multiple protocol fingerprints)
 *   2. repository groups   (single protocol, multiple source repositories)
 *   3. task family relation (family membership + declared relations)
 *   4. task identity fallback (no higher-order metadata, disclosed)
 *
 * Conflicting primary family assignments are disclosed and resolved
 * conservatively (the conflicted task is not grouped into any family). The
 * result is deterministic and permutation-invariant over rows, assignments,
 * and relations.
 */
export function partitionUncertaintyUnits(
  rows: readonly PartitionInput[],
  relations: readonly TaskFamilyRelation[],
  assignments: readonly TaskFamilyAssignment[],
): UncertaintyUnitResolution {
  if (rows.length === 0) {
    return {
      uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
      assignmentDigest: computeAssignmentDigest([]),
      units: [],
      unitCount: 0,
      fallbackAssumption: null,
      disclosures: ["No observations selected — no uncertainty units to resolve."],
    };
  }

  const disclosures: string[] = [...detectFamilyConflicts(assignments)];

  // --- Step 1: Protocol clusters ---
  const protocolGroups = groupBy(rows, (r) => r.protocolFingerprint);

  if (protocolGroups.size > 1) {
    const units: UncertaintyUnit[] = [];
    for (const [protocol, groupRows] of protocolGroups) {
      const taskIds = [...new Set(groupRows.map((r) => r.taskId))].sort();
      units.push({
        unitId: buildUnitId("protocol_cluster", taskIds, protocol),
        kind: "protocol_cluster",
        taskIds,
        observationIds: groupRows.map((r) => r.observationId),
        cellKeys: groupRows.map((r) => r.cellKey),
        splitReason: `Protocol fingerprint "${protocol.slice(0, 16)}..." differs from other protocols`,
      });
    }

    units.sort((a, b) => a.unitId.localeCompare(b.unitId));

    return {
      uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
      assignmentDigest: computeAssignmentDigest(units),
      units,
      unitCount: units.length,
      fallbackAssumption: null,
      disclosures: [
        `${protocolGroups.size} distinct protocol fingerprints detected — resampling units are protocol clusters.`,
        ...disclosures,
      ],
    };
  }

  // --- Step 2: Repository groups ---
  const repositoryGroups = groupBy(rows, (r) => r.sourceResultId);

  if (repositoryGroups.size > 1) {
    const units: UncertaintyUnit[] = [];
    for (const [source, groupRows] of repositoryGroups) {
      const taskIds = [...new Set(groupRows.map((r) => r.taskId))].sort();
      units.push({
        unitId: buildUnitId("repository_group", taskIds, source),
        kind: "repository_group",
        taskIds,
        observationIds: groupRows.map((r) => r.observationId),
        cellKeys: groupRows.map((r) => r.cellKey),
        splitReason: `Source repository "${source}" is distinct from other repositories`,
      });
    }

    units.sort((a, b) => a.unitId.localeCompare(b.unitId));

    return {
      uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
      assignmentDigest: computeAssignmentDigest(units),
      units,
      unitCount: units.length,
      fallbackAssumption: null,
      disclosures: [
        `${repositoryGroups.size} distinct source repositories detected — resampling units are repository groups.`,
        ...disclosures,
      ],
    };
  }

  // --- Step 3: Task family relations ---
  const familyGroups = buildFamilyRelationGroups(rows, assignments, relations);

  if (familyGroups.size > 0) {
    const units: UncertaintyUnit[] = [];

    for (const [, groupRows] of familyGroups) {
      const taskIds = [...new Set(groupRows.map((r) => r.taskId))].sort();
      units.push({
        unitId: buildUnitId("task_family_relation", taskIds),
        kind: "task_family_relation",
        taskIds,
        observationIds: groupRows.map((r) => r.observationId),
        cellKeys: groupRows.map((r) => r.cellKey),
        splitReason: "Tasks are linked by family membership or declared relation",
      });
    }

    // Remaining ungrouped rows become task_identity units
    const groupedCellKeys = new Set(units.flatMap((u) => u.cellKeys));
    const ungrouped = rows.filter((r) => !groupedCellKeys.has(r.cellKey));

    if (ungrouped.length > 0) {
      const taskGroups = groupBy(ungrouped, (r) => r.taskId);
      for (const [taskId, groupRows] of taskGroups) {
        units.push({
          unitId: buildUnitId("task_identity", [taskId]),
          kind: "task_identity",
          taskIds: [taskId],
          observationIds: groupRows.map((r) => r.observationId),
          cellKeys: groupRows.map((r) => r.cellKey),
          splitReason: "No higher-order dependency metadata — task identity fallback",
        });
      }
    }

    units.sort((a, b) => a.unitId.localeCompare(b.unitId));

    const hasFallback = units.some((u) => u.kind === "task_identity");
    return {
      uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
      assignmentDigest: computeAssignmentDigest(units),
      units,
      unitCount: units.length,
      fallbackAssumption: hasFallback
        ? "Task identity is the explicit fallback assumption for ungrouped tasks"
        : null,
      disclosures: [
        ...disclosures,
        ...(hasFallback
          ? ["Some tasks have no higher-order dependency metadata — using task identity fallback."]
          : []),
      ],
    };
  }

  // --- Step 4: Task identity fallback ---
  const taskGroups = groupBy(rows, (r) => r.taskId);
  const units: UncertaintyUnit[] = [];

  for (const [taskId, groupRows] of taskGroups) {
    units.push({
      unitId: buildUnitId("task_identity", [taskId]),
      kind: "task_identity",
      taskIds: [taskId],
      observationIds: groupRows.map((r) => r.observationId),
      cellKeys: groupRows.map((r) => r.cellKey),
      splitReason: "No higher-order dependency metadata — task identity fallback",
    });
  }

  units.sort((a, b) => a.unitId.localeCompare(b.unitId));

  return {
    uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
    assignmentDigest: computeAssignmentDigest(units),
    units,
    unitCount: units.length,
    fallbackAssumption:
      "Task identity is the explicit fallback assumption. No protocol clusters, repository groups, or task family relations were encoded for these observations.",
    disclosures: [
      ...disclosures,
      "No higher-order dependency metadata found — each Task is treated as an independent resampling unit.",
    ],
  };
}

// --- T5 resolver (thin wrapper over the common core) ---------------------------

function rowFromCell(cell: ProfileSelectedCell): PartitionInput {
  return {
    protocolFingerprint: cell.active.observation.protocolFingerprint,
    sourceResultId: cell.active.observation.sourceResultId,
    taskId: cell.taskId,
    observationId: cell.active.observation.id,
    cellKey: cell.cellKey,
  };
}

export function resolveUncertaintyUnits(
  input: UncertaintyResolverInput,
): UncertaintyUnitResolution {
  return partitionUncertaintyUnits(
    input.selection.cells.map(rowFromCell),
    input.taskFamilyRelations,
    input.taskFamilyAssignments,
  );
}
