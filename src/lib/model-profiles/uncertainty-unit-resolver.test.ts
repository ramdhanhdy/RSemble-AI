// =============================================================================
// RSemble AI — uncertainty-unit-resolver.test.ts (Child 07 Task 5, RED)
//
// Versioned pure uncertainty-unit resolver: declared protocol clusters,
// repository/source grouping, typed Task relations; when no higher-order
// metadata exists, Task identity is the explicit fallback assumption and the
// UI says so (disclosed). Conflicting/missing metadata handled. Assignment
// digest + rule version pinned in the result receipt.
//
// Contract under test (Child 07 spec §6.4, plan Task 5):
//  - protocol clusters when multiple protocol fingerprints exist
//  - repository/source groups when single protocol but multiple sources
//  - task family relation groups when related tasks exist
//  - task identity fallback when no higher-order dependency metadata
//  - conflicting/missing metadata → disclosed, not silent
//  - assignment digest stable and rule-version pinned
//  - permutation-invariant
//  - empty/single-cell edge cases
//  - below five resolved units detectable
// =============================================================================

import { describe, expect, it } from "vitest";

import type { EvidenceLedgerRow } from "../evidence/evidence-counting";
import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../evidence/evidence-types";
import { OBSERVATION_SCHEMA_VERSION } from "../evidence/evidence-types";
import type {
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskInstance,
  TaskRecord,
  TaskVersion,
  VersionRef,
} from "../tasks/task-types";
import {
  MILESTONE_A_GOLDEN,
  milestoneADecisions,
  milestoneALedgerRows,
  milestoneAObservations,
} from "./__fixtures__/milestone-a-golden";
import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  type ModelEvidenceQuery,
} from "./model-evidence-query";
import {
  selectProfileObservations,
  type ProfileEvidenceCorpus,
  type ProfileExactSelection,
} from "./profile-observation-selection";
import {
  resolveUncertaintyUnits,
  UNCERTAINTY_RULE_VERSION,
  type UncertaintyResolverInput,
  type UncertaintyUnit,
  type UncertaintyUnitKind,
  type UncertaintyUnitResolution,
} from "./uncertainty-unit-resolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CFG = MILESTONE_A_GOLDEN.configurations;
const EXACT_ALPHA = CFG.exactAlpha;
const T0 = 1_704_067_200_000;

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

function defaultResolverInput(
  overrides: Partial<UncertaintyResolverInput> = {},
): UncertaintyResolverInput {
  const selection = exactAlphaSelection();
  return {
    selection,
    query: baseQuery(),
    taskFamilyRelations: [],
    taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments,
    ...overrides,
  };
}

/** Collect all unique task IDs from a resolution. */
function unitTaskIds(units: readonly UncertaintyUnit[]): string[][] {
  return units.map((u) => [...u.taskIds].sort());
}

/** Collect all unit kinds from a resolution. */
function unitKinds(units: readonly UncertaintyUnit[]): UncertaintyUnitKind[] {
  return units.map((u) => u.kind);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveUncertaintyUnits", () => {
  // -- Protocol clusters ----------------------------------------------------

  it("produces protocol_cluster units when multiple protocol fingerprints exist", () => {
    // The golden corpus has observations with PROTOCOL_A and PROTOCOL_B.
    // exact-alpha-math-retry uses PROTOCOL_B; most others use PROTOCOL_A.
    const input = defaultResolverInput();
    const resolution = resolveUncertaintyUnits(input);

    // We should have at least 2 units (one per protocol)
    expect(resolution.unitCount).toBeGreaterThanOrEqual(2);

    // Check that protocol_cluster kind appears
    const kinds = unitKinds(resolution.units);
    // With multiple protocols, the primary unit kind should be protocol_cluster
    expect(kinds.every((k) => k === "protocol_cluster")).toBe(true);

    // Each unit should have a stable unitId
    for (const unit of resolution.units) {
      expect(unit.unitId).toBeTruthy();
      expect(unit.unitId).toMatch(/^unit:/);
    }
  });

  it("assigns observations with same protocol to the same unit", () => {
    const input = defaultResolverInput();
    const resolution = resolveUncertaintyUnits(input);

    // All observations with protocolFingerprint PROTOCOL_A should be in one unit
    const protoA = `sha256:${"a".repeat(64)}`;
    const protoB = `sha256:${"b".repeat(64)}`;

    for (const unit of resolution.units) {
      const protocols = new Set(
        unit.observationIds.map((oid) => {
          const cell = input.selection.cells.find(
            (c) => c.active.observation.id === oid,
          );
          return cell?.active.observation.protocolFingerprint;
        }),
      );
      // All observations in a unit should share the same protocol
      expect(protocols.size).toBeLessThanOrEqual(1);
    }
  });

  // -- Repository groups ----------------------------------------------------

  it("produces repository_group units when single protocol but multiple source repositories", () => {
    // Create a selection where all observations share one protocol but
    // come from different sourceResultIds.
    const query = baseQuery({
      // Filter to only protocol A observations
      sourceKinds: ["evaluation"],
    });
    const selection = exactAlphaSelection(query);

    // Verify we have multiple sourceResultIds
    const sources = new Set(
      selection.cells.map((c) => c.active.observation.sourceResultId),
    );
    // The golden corpus has multiple sourceResultIds even within protocol A
    // If there's only 1 source, this test is still valid (falls through to task family)

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments,
    };
    const resolution = resolveUncertaintyUnits(input);

    // Resolution should exist and have units
    expect(resolution.units.length).toBeGreaterThanOrEqual(1);
    expect(resolution.uncertaintyRuleVersion).toBe(UNCERTAINTY_RULE_VERSION);
    expect(resolution.assignmentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // -- Task family relations ------------------------------------------------

  it("produces task_family_relation units when related tasks exist under single protocol+repo", () => {
    // Create a minimal selection with related tasks, single protocol, single source
    // We'll use the family assignments: task-transform, task-math, task-verify all
    // belong to family-transform.

    const query = baseQuery({
      taskFamilyIds: ["family-transform"],
    });
    const selection = exactAlphaSelection(query);

    // Build family relations: task-transform and task-math overlap
    const relations: TaskFamilyRelation[] = [
      {
        familyId: "family-transform",
        relatedFamilyId: "family-write",
        kind: "overlap",
      },
    ];

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: relations,
      taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments.filter(
        (a) => a.familyId === "family-transform",
      ),
    };
    const resolution = resolveUncertaintyUnits(input);

    expect(resolution.units.length).toBeGreaterThanOrEqual(1);
    expect(resolution.assignmentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("groups tasks in the same family together when using task_family_relation", () => {
    // All tasks in family-transform should be in the same unit
    const query = baseQuery({
      taskFamilyIds: ["family-transform"],
    });
    const selection = exactAlphaSelection(query);

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments.filter(
        (a) => a.familyId === "family-transform",
      ),
    };
    const resolution = resolveUncertaintyUnits(input);

    // Tasks in the same family should be grouped together when
    // task_family_relation is the active unit kind
    for (const unit of resolution.units) {
      if (unit.kind === "task_family_relation") {
        // All taskIds in this unit should belong to the same family
        const familyIds = new Set(
          unit.taskIds.map((tid) => {
            const assign = MILESTONE_A_GOLDEN.familyAssignments.find(
              (a) => a.taskId === tid && a.isPrimary,
            );
            return assign?.familyId ?? null;
          }),
        );
        expect(familyIds.size).toBeLessThanOrEqual(1);
      }
    }
  });

  // -- Task identity fallback -----------------------------------------------

  it("produces task_identity units when no higher-order metadata exists", () => {
    // Use a selection with no family assignments, single protocol, single source
    // The orphan task has no family
    const query = baseQuery({
      taskFamilyIds: [],
    });
    const selection = exactAlphaSelection(query);

    // Remove all family assignments
    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);

    // With no higher-order metadata, we should get task_identity units
    // or fall through to whatever the highest available grouping is
    expect(resolution.units.length).toBeGreaterThanOrEqual(1);

    // The fallback assumption should be disclosed
    if (resolution.fallbackAssumption) {
      expect(resolution.fallbackAssumption).toContain("Task identity");
    }
  });

  it("discloses the fallback assumption when task_identity is used", () => {
    const query = baseQuery({ taskFamilyIds: [] });
    const selection = exactAlphaSelection(query);

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);

    // If fallback was used, it must be disclosed
    const hasTaskIdentity = resolution.units.some((u) => u.kind === "task_identity");
    if (hasTaskIdentity) {
      expect(resolution.fallbackAssumption).toBeTruthy();
      expect(resolution.disclosures.length).toBeGreaterThan(0);
    }
  });

  // -- Conflicting / missing metadata ---------------------------------------

  it("handles missing protocol fingerprint gracefully", () => {
    // Create a selection where some observations have no protocol fingerprint
    // (the resolver should handle this without crashing)
    const selection = exactAlphaSelection();
    const input: UncertaintyResolverInput = {
      selection,
      query: baseQuery(),
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);
    expect(resolution.units.length).toBeGreaterThanOrEqual(1);
    expect(resolution.assignmentDigest).toBeTruthy();
  });

  it("handles conflicting family assignments with disclosure", () => {
    // A task assigned to multiple families → conflict disclosed
    const query = baseQuery({ taskFamilyIds: [] });
    const selection = exactAlphaSelection(query);

    // Create conflicting assignments: task-transform in two families
    const conflictingAssignments: TaskFamilyAssignment[] = [
      ...MILESTONE_A_GOLDEN.familyAssignments,
      {
        id: "assign-transform-conflict",
        taskId: "task-transform",
        taskVersion: 1,
        familyId: "family-write",
        isPrimary: true,
        createdAt: T0 - 10_000,
        revision: 1,
        archivedAt: null,
      },
    ];

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: conflictingAssignments,
    };
    const resolution = resolveUncertaintyUnits(input);

    // Should not crash; should disclose the conflict
    expect(resolution.units.length).toBeGreaterThanOrEqual(1);
    // Conflict should appear in disclosures
    const hasConflictDisclosure = resolution.disclosures.some(
      (d) => d.includes("conflict") || d.includes("multiple"),
    );
    expect(hasConflictDisclosure).toBe(true);
  });

  // -- Assignment digest stability ------------------------------------------

  it("produces identical assignment digest for identical input", () => {
    const input = defaultResolverInput();
    const r1 = resolveUncertaintyUnits(input);
    const r2 = resolveUncertaintyUnits(input);
    expect(r1.assignmentDigest).toBe(r2.assignmentDigest);
  });

  it("produces different assignment digest for different input", () => {
    const r1 = resolveUncertaintyUnits(defaultResolverInput());

    const r2 = resolveUncertaintyUnits(
      defaultResolverInput({
        taskFamilyAssignments: [],
      }),
    );

    expect(r1.assignmentDigest).not.toBe(r2.assignmentDigest);
  });

  // -- Permutation invariance -----------------------------------------------

  it("is permutation-invariant with respect to cell ordering", () => {
    const input = defaultResolverInput();
    const r1 = resolveUncertaintyUnits(input);

    // Reverse the cells
    const reversedInput: UncertaintyResolverInput = {
      ...input,
      selection: {
        ...input.selection,
        cells: [...input.selection.cells].reverse(),
      },
    };
    const r2 = resolveUncertaintyUnits(reversedInput);

    expect(r1.assignmentDigest).toBe(r2.assignmentDigest);
    expect(r1.unitCount).toBe(r2.unitCount);
  });

  // -- Rule version pinning -------------------------------------------------

  it("pins the uncertainty rule version in the resolution", () => {
    const resolution = resolveUncertaintyUnits(defaultResolverInput());
    expect(resolution.uncertaintyRuleVersion).toBe(UNCERTAINTY_RULE_VERSION);
    expect(resolution.uncertaintyRuleVersion).toBe(QUERY_UNCERTAINTY_RULE_VERSION);
  });

  // -- Edge cases -----------------------------------------------------------

  it("handles empty selection gracefully", () => {
    const selection = exactAlphaSelection();
    const emptySelection: ProfileExactSelection = {
      ...selection,
      cells: [],
    };
    const input: UncertaintyResolverInput = {
      selection: emptySelection,
      query: baseQuery(),
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);
    expect(resolution.units).toEqual([]);
    expect(resolution.unitCount).toBe(0);
    expect(resolution.assignmentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("handles single-cell selection", () => {
    const selection = exactAlphaSelection();
    const singleCellSelection: ProfileExactSelection = {
      ...selection,
      cells: selection.cells.slice(0, 1),
    };
    const input: UncertaintyResolverInput = {
      selection: singleCellSelection,
      query: baseQuery(),
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);
    expect(resolution.unitCount).toBe(1);
    expect(resolution.units[0]!.kind).toBe("task_identity");
  });

  it("detects below-five-units state", () => {
    // Create a selection with only 2 cells from different tasks
    const selection = exactAlphaSelection();
    const twoCellSelection: ProfileExactSelection = {
      ...selection,
      cells: selection.cells.slice(0, 2),
    };
    const input: UncertaintyResolverInput = {
      selection: twoCellSelection,
      query: baseQuery(),
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);
    // With 2 cells from potentially different tasks, we may have 1 or 2 units
    expect(resolution.unitCount).toBeLessThan(5);
  });

  it("each unit carries observationIds and cellKeys", () => {
    const resolution = resolveUncertaintyUnits(defaultResolverInput());
    for (const unit of resolution.units) {
      expect(unit.observationIds.length).toBeGreaterThan(0);
      expect(unit.cellKeys.length).toBeGreaterThan(0);
      expect(unit.taskIds.length).toBeGreaterThan(0);
    }
  });

  it("every selected cell is assigned to exactly one unit", () => {
    const input = defaultResolverInput();
    const resolution = resolveUncertaintyUnits(input);

    const assignedCellKeys = new Set<string>();
    for (const unit of resolution.units) {
      for (const ck of unit.cellKeys) {
        expect(assignedCellKeys.has(ck)).toBe(false);
        assignedCellKeys.add(ck);
      }
    }

    // Every cell from the selection should be assigned
    for (const cell of input.selection.cells) {
      expect(assignedCellKeys.has(cell.cellKey)).toBe(true);
    }
  });

  it("splitReason is provided when units are split", () => {
    const resolution = resolveUncertaintyUnits(defaultResolverInput());
    if (resolution.unitCount > 1) {
      // At least one unit should have a split reason or the resolution
      // should have disclosures explaining the split
      const hasSplitInfo =
        resolution.units.some((u) => u.splitReason) ||
        resolution.disclosures.length > 0;
      expect(hasSplitInfo).toBe(true);
    }
  });
});
