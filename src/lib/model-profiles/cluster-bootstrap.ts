// =============================================================================
// RSemble AI — cluster-bootstrap.ts (Child 07 Task 5)
//
// Deterministic seeded cluster bootstrap over resolved uncertainty units.
// Resamples units (never attempts), preserves nested values, produces stable
// 95% bounds, and returns insufficient-coverage state below five units.
//
// Contract (Child 07 spec §6.4, plan Task 5):
//  - deterministic seed from query fingerprint + rule versions + assignment digest
//  - identical input → identical output
//  - permutation invariance of unit ordering
//  - below 5 resolved units → insufficient-coverage, no fake interval
//  - constant/extreme/empty data handled
//  - nested values (Task → versions → instances → replicates) preserved
//  - 95% default interval level
//  - resample count honored
//  - seed changes when any component changes
//
// This module does not implement paired comparison, claims, cache, UI, or
// a rollup store.
// =============================================================================

import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type { UncertaintyUnitResolution } from "./uncertainty-unit-resolver";

// --- Configuration --------------------------------------------------------------

export interface BootstrapConfig {
  readonly queryFingerprint: string;
  readonly aggregationRuleVersion: number;
  readonly uncertaintyRuleVersion: number;
  readonly assignmentDigest: string;
  readonly intervalLevel?: number; // default 0.95
  readonly resamples?: number; // default 2000
}

// --- Interval -------------------------------------------------------------------

export interface BootstrapInterval {
  readonly lower: number;
  readonly upper: number;
  readonly level: number;
}

// --- Coverage state -------------------------------------------------------------

export type BootstrapCoverageState =
  | { readonly state: "sufficient"; readonly unitCount: number }
  | { readonly state: "insufficient"; readonly unitCount: number; readonly reason: string };

// --- Result ---------------------------------------------------------------------

export interface BootstrapResult {
  readonly interval: BootstrapInterval | null;
  readonly coverageState: BootstrapCoverageState;
  readonly seed: string;
  readonly unitCount: number;
  readonly resamples: number;
  readonly uncertaintyRuleVersion: number;
  readonly aggregationRuleVersion: number;
  readonly assignmentDigest: string;
}

// --- Input ----------------------------------------------------------------------

export interface BootstrapInput {
  readonly resolution: UncertaintyUnitResolution;
  readonly config: BootstrapConfig;
  readonly unitValues: ReadonlyMap<string, number>;
}

// --- Bootstrap ------------------------------------------------------------------

/**
 * Perform a deterministic seeded cluster bootstrap over resolved uncertainty
 * units. Resamples units with replacement (never individual observations or
 * attempts), computes the mean per resample, and returns a percentile interval.
 *
 * The seed is derived from:
 *   queryFingerprint + aggregationRuleVersion + uncertaintyRuleVersion + assignmentDigest
 *
 * Below 5 resolved units, returns insufficient-coverage state with no interval.
 * The same input always produces identical output.
 */
export function bootstrapTaskClusters(
  _input: BootstrapInput,
): BootstrapResult {
  // STUB — will be implemented in GREEN commit
  return {
    interval: null,
    coverageState: {
      state: "insufficient",
      unitCount: 0,
      reason: "Not implemented",
    },
    seed: hashArtifactContent("stub"),
    unitCount: 0,
    resamples: 0,
    uncertaintyRuleVersion: 0,
    aggregationRuleVersion: 0,
    assignmentDigest: "",
  };
}
