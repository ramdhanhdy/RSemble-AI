// =============================================================================
// RSemble AI — cluster-bootstrap.ts (Child 07 Task 5, GREEN)
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
  /** Number of USABLE units that entered the bootstrap (units with a metric value). */
  readonly unitCount: number;
  /** Resolved units omitted because no metric value was supplied, disclosed
   *  and never imputed as 0. Sorted by unitId. */
  readonly omittedUnitIds: readonly string[];
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

// --- PRNG: Mulberry32 -----------------------------------------------------------

/**
 * A deterministic 32-bit PRNG (Mulberry32). Seeded from a 32-bit integer
 * derived from the bootstrap seed hash. Produces a reproducible sequence
 * of pseudorandom numbers in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a 32-bit integer seed from a sha256 fingerprint string.
 * Uses the first 8 hex characters of the hex digest.
 */
function seedFromFingerprint(fp: string): number {
  // fp is "sha256:<64 hex chars>"
  const hex = fp.slice("sha256:".length);
  // Take first 8 hex chars → 32-bit integer
  return parseInt(hex.slice(0, 8), 16) | 0;
}

// --- Bootstrap ------------------------------------------------------------------

const MIN_UNITS_FOR_INTERVAL = 5;
const DEFAULT_INTERVAL_LEVEL = 0.95;
const DEFAULT_RESAMPLES = 2000;

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
 *
 * Permutation invariance: units are sorted by unitId before resampling,
 * ensuring that reordering the input units does not change the result.
 */
export function bootstrapTaskClusters(input: BootstrapInput): BootstrapResult {
  const { resolution, config, unitValues } = input;
  const resamples = config.resamples ?? DEFAULT_RESAMPLES;
  const intervalLevel = config.intervalLevel ?? DEFAULT_INTERVAL_LEVEL;

  // --- Build seed -----------------------------------------------------------
  const seedMaterial = [
    config.queryFingerprint,
    String(config.aggregationRuleVersion),
    String(config.uncertaintyRuleVersion),
    config.assignmentDigest,
  ].join(":");
  const seed = hashArtifactContent(seedMaterial);

  // --- Prepare unit entries (deterministic order) ---------------------------
  // Sort by unitId for permutation invariance. Missing unit metrics are
  // NEVER imputed as 0: a unit without a supplied value is omitted from the
  // resampling pool and disclosed. Sufficiency is based on USABLE units.
  const sortedUnits = [...resolution.units].sort((a, b) => a.unitId.localeCompare(b.unitId));

  const entries: { id: string; value: number }[] = [];
  const omittedUnitIds: string[] = [];
  for (const u of sortedUnits) {
    const value = unitValues.get(u.unitId);
    if (value === undefined) {
      omittedUnitIds.push(u.unitId);
    } else {
      entries.push({ id: u.unitId, value });
    }
  }
  const usableCount = entries.length;

  // --- Insufficient coverage ------------------------------------------------
  if (usableCount < MIN_UNITS_FOR_INTERVAL) {
    return {
      interval: null,
      coverageState: {
        state: "insufficient",
        unitCount: usableCount,
        reason:
          omittedUnitIds.length > 0
            ? `Fewer than ${MIN_UNITS_FOR_INTERVAL} usable uncertainty units (${usableCount} usable, ${omittedUnitIds.length} omitted with missing metric values). Missing units are omitted, not imputed as 0.`
            : `Fewer than ${MIN_UNITS_FOR_INTERVAL} resolved independent uncertainty units (${usableCount} available). Cannot compute a stable bootstrap interval.`,
      },
      seed,
      unitCount: usableCount,
      omittedUnitIds,
      resamples,
      uncertaintyRuleVersion: resolution.uncertaintyRuleVersion,
      aggregationRuleVersion: config.aggregationRuleVersion,
      assignmentDigest: config.assignmentDigest,
    };
  }

  // --- Initialize PRNG ------------------------------------------------------
  const prngSeed = seedFromFingerprint(seed);
  const random = mulberry32(prngSeed);

  // --- Resample -------------------------------------------------------------
  const n = entries.length;
  const means: number[] = new Array(resamples);

  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = (random() * n) | 0;
      sum += entries[idx]!.value;
    }
    means[i] = sum / n;
  }

  // --- Sort means and compute percentiles -----------------------------------
  means.sort((a, b) => a - b);

  const alpha = (1 - intervalLevel) / 2;
  const lowerIdx = Math.max(0, Math.floor(alpha * resamples));
  const upperIdx = Math.min(resamples - 1, Math.floor((1 - alpha) * resamples));

  return {
    interval: {
      lower: means[lowerIdx]!,
      upper: means[upperIdx]!,
      level: intervalLevel,
    },
    coverageState: {
      state: "sufficient",
      unitCount: usableCount,
    },
    seed,
    unitCount: usableCount,
    omittedUnitIds,
    resamples,
    uncertaintyRuleVersion: resolution.uncertaintyRuleVersion,
    aggregationRuleVersion: config.aggregationRuleVersion,
    assignmentDigest: config.assignmentDigest,
  };
}
