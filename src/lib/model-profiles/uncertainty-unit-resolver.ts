// =============================================================================
// RSemble AI — uncertainty-unit-resolver.ts (Child 07 Task 5)
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

import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type { TaskFamilyAssignment, TaskFamilyRelation } from "../tasks/task-types";
import { QUERY_UNCERTAINTY_RULE_VERSION } from "./model-evidence-query";
import type { ModelEvidenceQuery } from "./model-evidence-query";
import type { ProfileExactSelection } from "./profile-observation-selection";

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

// --- Resolver -------------------------------------------------------------------

/**
 * Resolve uncertainty units from a profile selection. Groups observations
 * by the highest-order available dependency metadata:
 *
 *  1. Protocol clusters (protocolFingerprint)
 *  2. Repository groups (sourceResultId)
 *  3. Task family relations (TaskFamilyRelation + TaskFamilyAssignment)
 *  4. Task identity (fallback — each unique taskId is its own unit)
 *
 * The assignment digest is a deterministic hash of the unit assignment,
 * ensuring reproducibility. The resolution pins the uncertainty rule version
 * and discloses any fallback assumptions or metadata conflicts.
 */
export function resolveUncertaintyUnits(
  _input: UncertaintyResolverInput,
): UncertaintyUnitResolution {
  // STUB — will be implemented in GREEN commit
  return {
    uncertaintyRuleVersion: UNCERTAINTY_RULE_VERSION,
    assignmentDigest: hashArtifactContent("stub"),
    units: [],
    unitCount: 0,
    fallbackAssumption: null,
    disclosures: [],
  };
}
