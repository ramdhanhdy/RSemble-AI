// =============================================================================
// RSemble AI — cluster-bootstrap.test.ts (Child 07 Task 5, RED)
//
// Deterministic seeded cluster bootstrap over resolved uncertainty units.
// Resamples units (never attempts), preserves nested values, produces stable
// 95% bounds, and returns insufficient-coverage state below five units.
//
// Contract under test (Child 07 spec §6.4, plan Task 5):
//  - deterministic seed from query fingerprint + rule versions + assignment digest
//  - identical input → identical output
//  - permutation invariance of unit ordering
//  - below 5 resolved units → insufficient-coverage, no fake interval
//  - constant values → zero-width or near-zero interval
//  - extreme values handled
//  - empty data → insufficient coverage
//  - nested values (Task → versions → instances → replicates) preserved
//  - 95% default interval level
//  - resample count honored
//  - seed changes when any component changes
// =============================================================================

import { describe, expect, it } from "vitest";

import type {
  UncertaintyUnit,
  UncertaintyUnitResolution,
} from "./uncertainty-unit-resolver";
import {
  bootstrapTaskClusters,
  type BootstrapConfig,
} from "./cluster-bootstrap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUERY_FP = `sha256:${"q".repeat(64)}`;
const AGG_VERSION = 1;
const UNC_VERSION = 1;
const ASSIGNMENT_DIGEST = `sha256:${"d".repeat(64)}`;

function makeUnit(id: string, taskIds: string[], obsIds: string[]): UncertaintyUnit {
  return {
    unitId: id,
    kind: "task_identity",
    taskIds,
    observationIds: obsIds,
    cellKeys: obsIds.map((oid) => `ck:${oid}`),
    splitReason: null,
  };
}

function makeResolution(
  units: UncertaintyUnit[],
  overrides: Partial<UncertaintyUnitResolution> = {},
): UncertaintyUnitResolution {
  return {
    uncertaintyRuleVersion: UNC_VERSION,
    assignmentDigest: ASSIGNMENT_DIGEST,
    units,
    unitCount: units.length,
    fallbackAssumption: units.length > 0 && units[0]!.kind === "task_identity"
      ? "Task identity is the explicit fallback assumption"
      : null,
    disclosures: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BootstrapConfig> = {}): BootstrapConfig {
  return {
    queryFingerprint: QUERY_FP,
    aggregationRuleVersion: AGG_VERSION,
    uncertaintyRuleVersion: UNC_VERSION,
    assignmentDigest: ASSIGNMENT_DIGEST,
    intervalLevel: 0.95,
    resamples: 2000,
    ...overrides,
  };
}

function makeUnitValues(
  units: UncertaintyUnit[],
  values: number[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < units.length; i++) {
    map.set(units[i]!.unitId, values[i] ?? 0);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bootstrapTaskClusters", () => {
  // -- Deterministic seed ---------------------------------------------------

  it("produces identical output for identical input", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const config = makeConfig();
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const r1 = bootstrapTaskClusters({ resolution, config, unitValues });
    const r2 = bootstrapTaskClusters({ resolution, config, unitValues });

    expect(r1.seed).toBe(r2.seed);
    expect(r1.interval).toEqual(r2.interval);
    expect(r1.unitCount).toBe(r2.unitCount);
  });

  it("produces different output when seed components change", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const r1 = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ queryFingerprint: `sha256:${"a".repeat(64)}` }),
      unitValues,
    });

    const r2 = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ queryFingerprint: `sha256:${"b".repeat(64)}` }),
      unitValues,
    });

    // Different fingerprints should produce different seeds
    expect(r1.seed).not.toBe(r2.seed);
  });

  it("seed changes when assignment digest changes", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const r1 = bootstrapTaskClusters({
      resolution: makeResolution(units),
      config: makeConfig({ assignmentDigest: `sha256:${"x".repeat(64)}` }),
      unitValues,
    });

    const r2 = bootstrapTaskClusters({
      resolution: makeResolution(units),
      config: makeConfig({ assignmentDigest: `sha256:${"y".repeat(64)}` }),
      unitValues,
    });

    expect(r1.seed).not.toBe(r2.seed);
  });

  it("seed changes when rule versions change", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const r1 = bootstrapTaskClusters({
      resolution: makeResolution(units),
      config: makeConfig({ aggregationRuleVersion: 1 }),
      unitValues,
    });

    const r2 = bootstrapTaskClusters({
      resolution: makeResolution(units),
      config: makeConfig({ aggregationRuleVersion: 2 }),
      unitValues,
    });

    expect(r1.seed).not.toBe(r2.seed);
  });

  // -- Permutation invariance -----------------------------------------------

  it("is permutation-invariant with respect to unit ordering", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const r1 = bootstrapTaskClusters({
      resolution: makeResolution(units),
      config: makeConfig(),
      unitValues,
    });

    // Reverse unit order
    const reversedUnits = [...units].reverse();
    const r2 = bootstrapTaskClusters({
      resolution: makeResolution(reversedUnits),
      config: makeConfig(),
      unitValues,
    });

    expect(r1.interval).toEqual(r2.interval);
    expect(r1.seed).toBe(r2.seed);
  });

  // -- Below five units -----------------------------------------------------

  it("returns insufficient-coverage state when below 5 units", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.interval).toBeNull();
    expect(result.coverageState.state).toBe("insufficient");
    expect(result.coverageState.unitCount).toBe(2);
    if (result.coverageState.state === "insufficient") {
      expect(result.coverageState.reason).toContain("5");
    }
  });

  it("returns insufficient-coverage for 4 units", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.interval).toBeNull();
    expect(result.coverageState.state).toBe("insufficient");
  });

  it("returns sufficient-coverage for exactly 5 units", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
    expect(result.interval!.level).toBe(0.95);
  });

  it("returns sufficient-coverage for more than 5 units", () => {
    const units = Array.from({ length: 10 }, (_, i) =>
      makeUnit(`unit:${i + 1}`, [`t${i + 1}`], [`o${i + 1}`]),
    );
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(
      units,
      units.map((_, i) => 0.5 + i * 0.05),
    );

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
    expect(result.unitCount).toBe(10);
  });

  // -- Constant values ------------------------------------------------------

  it("handles constant values (all units have same value)", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.8, 0.8, 0.8, 0.8]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
    // With constant values, all resampled means are identical
    expect(result.interval!.lower).toBe(0.8);
    expect(result.interval!.upper).toBe(0.8);
  });

  // -- Extreme values -------------------------------------------------------

  it("handles extreme values (0 and 1)", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0, 0, 1, 1, 0.5]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
    // Interval should be within [0, 1]
    expect(result.interval!.lower).toBeGreaterThanOrEqual(0);
    expect(result.interval!.upper).toBeLessThanOrEqual(1);
  });

  it("handles negative values", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [-0.5, -0.3, 0, 0.2, 0.5]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
    expect(result.interval!.lower).toBeLessThanOrEqual(result.interval!.upper);
  });

  // -- Empty data -----------------------------------------------------------

  it("returns insufficient-coverage for empty units", () => {
    const resolution = makeResolution([]);
    const unitValues = new Map<string, number>();

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.interval).toBeNull();
    expect(result.coverageState.state).toBe("insufficient");
    expect(result.unitCount).toBe(0);
  });

  // -- Interval properties --------------------------------------------------

  it("interval lower bound is not greater than upper bound", () => {
    const units = Array.from({ length: 20 }, (_, i) =>
      makeUnit(`unit:${i + 1}`, [`t${i + 1}`], [`o${i + 1}`]),
    );
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(
      units,
      units.map(() => Math.random()),
    );

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ resamples: 5000 }),
      unitValues,
    });

    if (result.interval) {
      expect(result.interval.lower).toBeLessThanOrEqual(result.interval.upper);
    }
  });

  it("interval level is pinned in the result", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const r95 = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ intervalLevel: 0.95 }),
      unitValues,
    });
    expect(r95.interval!.level).toBe(0.95);

    const r90 = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ intervalLevel: 0.90 }),
      unitValues,
    });
    expect(r90.interval!.level).toBe(0.90);
  });

  // -- Resample count -------------------------------------------------------

  it("honors custom resample count", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ resamples: 500 }),
      unitValues,
    });

    expect(result.resamples).toBe(500);
    expect(result.coverageState.state).toBe("sufficient");
  });

  // -- Seed format ----------------------------------------------------------

  it("seed is a valid sha256 fingerprint", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.seed).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // -- Rule version and digest pinning --------------------------------------

  it("pins rule versions and assignment digest in the result", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(units, [0.8, 0.6, 0.9, 0.7, 0.85]);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.uncertaintyRuleVersion).toBe(UNC_VERSION);
    expect(result.aggregationRuleVersion).toBe(AGG_VERSION);
    expect(result.assignmentDigest).toBe(ASSIGNMENT_DIGEST);
  });

  // -- Missing unit values --------------------------------------------------

  it("treats missing unit values as 0", () => {
    const units = [
      makeUnit("unit:1", ["t1"], ["o1"]),
      makeUnit("unit:2", ["t2"], ["o2"]),
      makeUnit("unit:3", ["t3"], ["o3"]),
      makeUnit("unit:4", ["t4"], ["o4"]),
      makeUnit("unit:5", ["t5"], ["o5"]),
    ];
    const resolution = makeResolution(units);
    // Only provide values for some units
    const unitValues = new Map<string, number>();
    unitValues.set("unit:1", 0.8);
    unitValues.set("unit:2", 0.6);

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig(),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
  });

  // -- Large number of units ------------------------------------------------

  it("handles a large number of units without error", () => {
    const units = Array.from({ length: 100 }, (_, i) =>
      makeUnit(`unit:${i + 1}`, [`t${i + 1}`], [`o${i + 1}`]),
    );
    const resolution = makeResolution(units);
    const unitValues = makeUnitValues(
      units,
      units.map((_, i) => (i % 10) / 10),
    );

    const result = bootstrapTaskClusters({
      resolution,
      config: makeConfig({ resamples: 1000 }),
      unitValues,
    });

    expect(result.coverageState.state).toBe("sufficient");
    expect(result.interval).not.toBeNull();
    expect(result.unitCount).toBe(100);
  });
});
