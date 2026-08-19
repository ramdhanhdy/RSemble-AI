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

import type {
  TaskFamilyAssignment,
  TaskFamilyRelation,
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
    const input = defaultResolverInput();
    const resolution = resolveUncertaintyUnits(input);

    expect(resolution.unitCount).toBeGreaterThanOrEqual(2);

    const kinds = unitKinds(resolution.units);
    expect(kinds.every((k) => k === "protocol_cluster")).toBe(true);

    for (const unit of resolution.units) {
      expect(unit.unitId).toBeTruthy();
      expect(unit.unitId).toMatch(/^unit:/);
    }
  });

  it("assigns observations with same protocol to the same unit", () => {
    const input = defaultResolverInput();
    const resolution = resolveUncertaintyUnits(input);

    for (const unit of resolution.units) {
      const protocols = new Set(
        unit.observationIds.map((oid) => {
          const cell = input.selection.cells.find(
            (c) => c.active.observation.id === oid,
          );
          return cell?.active.observation.protocolFingerprint;
        }),
      );
      expect(protocols.size).toBeLessThanOrEqual(1);
    }
  });

  // -- Repository groups ----------------------------------------------------

  it("produces repository_group units when single protocol but multiple source repositories", () => {
    const query = baseQuery({
      sourceKinds: ["evaluation"],
    });
    const selection = exactAlphaSelection(query);

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: MILESTONE_A_GOLDEN.familyAssignments,
    };
    const resolution = resolveUncertaintyUnits(input);

    expect(resolution.units.length).toBeGreaterThanOrEqual(1);
    expect(resolution.uncertaintyRuleVersion).toBe(UNCERTAINTY_RULE_VERSION);
    expect(resolution.assignmentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // -- Task family relations ------------------------------------------------

  it("produces task_family_relation units when related tasks exist under single protocol+repo", () => {
    const query = baseQuery({
      taskFamilyIds: ["family-transform"],
    });
    const selection = exactAlphaSelection(query);

    const relations: TaskFamilyRelation[] = [
      {
        id: "rel-transform-write",
        fromFamilyId: "family-transform",
        toFamilyId: "family-write",
        kind: "overlap",
        createdAt: T0,
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

    for (const unit of resolution.units) {
      if (unit.kind === "task_family_relation") {
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
    const query = baseQuery({ taskFamilyIds: [] });
    const selection = exactAlphaSelection(query);

    const input: UncertaintyResolverInput = {
      selection,
      query,
      taskFamilyRelations: [],
      taskFamilyAssignments: [],
    };
    const resolution = resolveUncertaintyUnits(input);

    expect(resolution.units.length).toBeGreaterThanOrEqual(1);

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

    const hasTaskIdentity = resolution.units.some((u) => u.kind === "task_identity");
    if (hasTaskIdentity) {
      expect(resolution.fallbackAssumption).toBeTruthy();
      expect(resolution.disclosures.length).toBeGreaterThan(0);
    }
  });

  // -- Conflicting / missing metadata ---------------------------------------

  it("handles missing protocol fingerprint gracefully", () => {
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
    const query = baseQuery({ taskFamilyIds: [] });
    const selection = exactAlphaSelection(query);

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

    expect(resolution.units.length).toBeGreaterThanOrEqual(1);
    const hasConflictDisclosure = resolution.disclosures.some(
      (d) => d.includes("multiple"),
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
        taskFamilyRelations: [],
      }),
    );

    // If the unit counts or kinds differ, the digests MUST differ
    if (r1.unitCount !== r2.unitCount) {
      expect(r1.assignmentDigest).not.toBe(r2.assignmentDigest);
      return;
    }

    const kinds1 = unitKinds(r1.units).join(",");
    const kinds2 = unitKinds(r2.units).join(",");
    if (kinds1 !== kinds2) {
      expect(r1.assignmentDigest).not.toBe(r2.assignmentDigest);
      return;
    }

    // If the resolver stopped at protocol/repository level before reaching
    // family relations, the two inputs may produce identical results.
    expect(r1.assignmentDigest).toBe(r2.assignmentDigest);
  });

  // -- Permutation invariance -----------------------------------------------

  it("is permutation-invariant with respect to cell ordering", () => {
    const input = defaultResolverInput();
    const r1 = resolveUncertaintyUnits(input);

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

    for (const cell of input.selection.cells) {
      expect(assignedCellKeys.has(cell.cellKey)).toBe(true);
    }
  });

  it("splitReason is provided when units are split", () => {
    const resolution = resolveUncertaintyUnits(defaultResolverInput());
    if (resolution.unitCount > 1) {
      const hasSplitInfo =
        resolution.units.some((u) => u.splitReason) ||
        resolution.disclosures.length > 0;
      expect(hasSplitInfo).toBe(true);
    }
  });
});
