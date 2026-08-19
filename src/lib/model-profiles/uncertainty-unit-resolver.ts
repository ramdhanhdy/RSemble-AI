// =============================================================================
// RSemble AI — uncertainty-unit-resolver.ts (Child 07 Task 5, GREEN)
//
// Versioned pure uncertainty-unit resolver: declared protocol clusters,
// repository/source grouping, typed Task relations; when no higher-order
// metadata exists, Task identity is the explicit fallback assumption and the
// UI says so (disclosed). Conflicting/missing metadata handled. Assignment
// digest + rule version pinned in the result receipt.
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
import { QUERY_UNCERTAINTY_RULE_VERSION } from "./model-evidence-query";
import type { ModelEvidenceQuery } from "./model-evidence-query";
import type { ProfileExactSelection, ProfileSelectedCell } from "./profile-observation-selection";

// --- Rule version ---------------------------------------------------------------

export const UNCERTAINTY_RULE_VERSION = QUERY_UNCERTAINTY_RULE_VERSION;

// --- Unit kinds -----------------------------------------------------------------

export type UncertaintyUnitKind =
  | "protocol_cluster"
  | "repository_group"
  | "task_family_relation"
  | "task_identity";

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

// --- Input ----------------------------------------------------------------------

export interface UncertaintyResolverInput {
  readonly selection: ProfileExactSelection;
  readonly query: ModelEvidenceQuery;
  readonly taskFamilyRelations: readonly TaskFamilyRelation[];
  readonly taskFamilyAssignments: readonly TaskFamilyAssignment[];
}

// --- Internal helpers -----------------------------------------------------------

interface CellInfo {
  cell: ProfileSelectedCell;
  protocolFingerprint: string;
  sourceResultId: string;
  taskId: string;
}

function extractCellInfo(cell: ProfileSelectedCell): CellInfo {
  return {
    cell,
    protocolFingerprint: cell.active.observation.protocolFingerprint,
    sourceResultId: cell.active.observation.sourceResultId,
    taskId: cell.taskId,
  };
}

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

function buildUnitId(kind: UncertaintyUnitKind, taskIds: readonly string[]): string {
  const sorted = [...taskIds].sort();
  return `unit:${kind}:${sorted.join(",")}`;
}

function detectFamilyConflicts(
  assignments: readonly TaskFamilyAssignment[],
): string[] {
  const conflicts: string[] = [];
  const taskFamily = new Map<string, string>();

  for (const assign of assignments) {
    if (!assign.isPrimary) continue;
    const existing = taskFamily.get(assign.taskId);
    if (existing && existing !== assign.familyId) {
      conflicts.push(
        `Task "${assign.taskId}" has multiple primary family assignments: "${existing}" and "${assign.familyId}"`,
      );
    }
    taskFamily.set(assign.taskId, assign.familyId);
  }

  return conflicts;
}

function buildFamilyIndex(
  assignments: readonly TaskFamilyAssignment[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const taskFamily = new Map<string, string>();

  for (const assign of assignments) {
    if (!assign.isPrimary) continue;
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
  cells: readonly CellInfo[],
  assignments: readonly TaskFamilyAssignment[],
  relations: readonly TaskFamilyRelation[],
): Map<string, CellInfo[]> {
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

  // Build groups: assign cells to their task's root group
  const groups = new Map<string, CellInfo[]>();

  for (const info of cells) {
    const root = findRoot(info.taskId);
    const siblings = rootToTasks.get(root) ?? [];
    if (siblings.length > 1) {
      const group = groups.get(root);
      if (group) {
        group.push(info);
      } else {
        groups.set(root, [info]);
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

// --- Resolver -------------------------------------------------------------------

export function resolveUncertaintyUnits(
  input: UncertaintyResolverInput,
): UncertaintyUnitResolution {
  const { selection, taskFamilyRelations, taskFamilyAssignments } = input;
  const cells = selection.cells;

  if (cells.length === 0) {
    return {
      uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
      assignmentDigest: computeAssignmentDigest([]),
      units: [],
      unitCount: 0,
      fallbackAssumption: null,
      disclosures: ["No observations selected — no uncertainty units to resolve."],
    };
  }

  const infos = cells.map(extractCellInfo);
  const disclosures: string[] = [];

  // Always check for family assignment conflicts
  const familyConflicts = detectFamilyConflicts(taskFamilyAssignments);
  disclosures.push(...familyConflicts);

  // --- Step 1: Protocol clusters ---
  const protocolGroups = groupBy(infos, (c) => c.protocolFingerprint);

  if (protocolGroups.size > 1) {
    const units: UncertaintyUnit[] = [];
    for (const [protocol, groupInfos] of protocolGroups) {
      const taskIds = [...new Set(groupInfos.map((c) => c.taskId))].sort();
      units.push({
        unitId: buildUnitId("protocol_cluster", taskIds),
        kind: "protocol_cluster",
        taskIds,
        observationIds: groupInfos.map((c) => c.cell.active.observation.id),
        cellKeys: groupInfos.map((c) => c.cell.cellKey),
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
  const repositoryGroups = groupBy(infos, (c) => c.sourceResultId);

  if (repositoryGroups.size > 1) {
    const units: UncertaintyUnit[] = [];
    for (const [source, groupInfos] of repositoryGroups) {
      const taskIds = [...new Set(groupInfos.map((c) => c.taskId))].sort();
      units.push({
        unitId: buildUnitId("repository_group", taskIds),
        kind: "repository_group",
        taskIds,
        observationIds: groupInfos.map((c) => c.cell.active.observation.id),
        cellKeys: groupInfos.map((c) => c.cell.cellKey),
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
  const familyGroups = buildFamilyRelationGroups(infos, taskFamilyAssignments, taskFamilyRelations);

  if (familyGroups.size > 0) {
    const units: UncertaintyUnit[] = [];

    for (const [, groupInfos] of familyGroups) {
      const taskIds = [...new Set(groupInfos.map((c) => c.taskId))].sort();
      units.push({
        unitId: buildUnitId("task_family_relation", taskIds),
        kind: "task_family_relation",
        taskIds,
        observationIds: groupInfos.map((c) => c.cell.active.observation.id),
        cellKeys: groupInfos.map((c) => c.cell.cellKey),
        splitReason: "Tasks are linked by family membership or declared relation",
      });
    }

    // Remaining ungrouped cells become task_identity units
    const groupedCellKeys = new Set(
      units.flatMap((u) => u.cellKeys),
    );
    const ungrouped = infos.filter((c) => !groupedCellKeys.has(c.cell.cellKey));

    if (ungrouped.length > 0) {
      const taskGroups = groupBy(ungrouped, (c) => c.taskId);
      for (const [taskId, groupInfos] of taskGroups) {
        units.push({
          unitId: buildUnitId("task_identity", [taskId]),
          kind: "task_identity",
          taskIds: [taskId],
          observationIds: groupInfos.map((c) => c.cell.active.observation.id),
          cellKeys: groupInfos.map((c) => c.cell.cellKey),
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
  const taskGroups = groupBy(infos, (c) => c.taskId);
  const units: UncertaintyUnit[] = [];

  for (const [taskId, groupInfos] of taskGroups) {
    units.push({
      unitId: buildUnitId("task_identity", [taskId]),
      kind: "task_identity",
      taskIds: [taskId],
      observationIds: groupInfos.map((c) => c.cell.active.observation.id),
      cellKeys: groupInfos.map((c) => c.cell.cellKey),
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
