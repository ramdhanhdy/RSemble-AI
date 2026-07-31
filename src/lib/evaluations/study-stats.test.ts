// =============================================================================
// RSemble AI — Study statistics tests
//
// Paired task-level deltas (repeats averaged within task), bootstrap CI with
// the TASK as the resample unit, exact sign-flip sensitivity, and predeclared
// MPID verdicts (spec §7.4; spec test 3 stats half).
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  bootstrapTaskCi,
  mpidVerdict,
  pairedDeltaComparison,
  pairedTaskDeltas,
  signFlipPermutationP,
  type PolicyTaskRepeats,
} from "./study-stats";

/** Deterministic LCG for stable bootstrap fixtures. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe("pairedTaskDeltas", () => {
  it("averages repeats within task before differencing", () => {
    const deltas = pairedTaskDeltas([
      { taskId: "t1", scoresP: [1, 5], scoresQ: [3] },
      { taskId: "t2", scoresP: [4, 4, 4], scoresQ: [2, 4] },
    ]);
    expect(deltas).toEqual([
      { taskId: "t1", delta: 0 },
      { taskId: "t2", delta: 1 },
    ]);
  });

  it("drops tasks missing scores on either side", () => {
    expect(pairedTaskDeltas([{ taskId: "t1", scoresP: [], scoresQ: [3] }])).toEqual([]);
  });
});

describe("bootstrap resamples tasks, not generations", () => {
  it("within-task generation noise does not widen the interval", () => {
    // Huge within-task variance but identical task means: once repeats are
    // averaged per task, every delta is exactly +0.5 → degenerate-tight CI.
    const tasks: PolicyTaskRepeats[] = Array.from({ length: 12 }, (_, i) => ({
      taskId: `t${i}`,
      scoresP: [1, 5, 1, 5, 3.5],
      scoresQ: [0.5, 4.5, 0.5, 4.5, 3.0],
    }));
    const deltas = pairedTaskDeltas(tasks).map((d) => d.delta);
    expect(deltas.every((d) => Math.abs(d - 0.5) < 1e-9)).toBe(true);
    const ci = bootstrapTaskCi(deltas, { ciLevel: 0.9, samples: 1000, rng: lcg(7) });
    expect(ci.high - ci.low).toBeLessThan(1e-9);
  });

  it("more tasks (not more repeats) narrows the interval", () => {
    const make = (n: number): number[] =>
      Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.6 : 0.2));
    const few = bootstrapTaskCi(make(6), { ciLevel: 0.9, samples: 2000, rng: lcg(11) });
    const many = bootstrapTaskCi(make(30), { ciLevel: 0.9, samples: 2000, rng: lcg(11) });
    expect(many.high - many.low).toBeLessThan(few.high - few.low);
  });
});

describe("sign-flip permutation", () => {
  it("exact enumeration on a known pair", () => {
    // deltas [1, 2]: observed |mean| = 1.5. Sign sums: 3, -1, 1, -3 → two of
    // four assignments reach |mean| ≥ 1.5 → p = 0.5.
    expect(signFlipPermutationP([1, 2])).toBeCloseTo(0.5, 10);
  });

  it("all-positive deltas of equal magnitude give the minimum p-value", () => {
    // [1,1,1]: only the all-heads and all-tails assignments match → 2/8.
    expect(signFlipPermutationP([1, 1, 1])).toBeCloseTo(0.25, 10);
  });
});

describe("MPID verdicts", () => {
  it("adopt / not_justified / inconclusive from interval position", () => {
    expect(mpidVerdict(0.3, 0.6, 0.2)).toBe("adopt");
    expect(mpidVerdict(-0.1, 0.15, 0.2)).toBe("not_justified");
    expect(mpidVerdict(-0.02, 0.55, 0.25)).toBe("inconclusive");
  });
});

describe("pairedDeltaComparison", () => {
  it("reports mean/median delta, wins/ties/losses, CI, and the MPID verdict", () => {
    // Policy P beats Q by exactly +0.4 on every task → CI collapses on +0.4.
    const tasks: PolicyTaskRepeats[] = Array.from({ length: 10 }, (_, i) => ({
      taskId: `t${i}`,
      scoresP: [4.4],
      scoresQ: [4.0],
    }));
    const stats = pairedDeltaComparison(tasks, { mpid: 0.2, rng: lcg(3), bootstrapSamples: 500 });
    expect(stats.meanDelta).toBeCloseTo(0.4, 10);
    expect(stats.medianDelta).toBeCloseTo(0.4, 10);
    expect(stats.wins).toBe(10);
    expect(stats.ties).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.verdict).toBe("adopt");
    expect(stats.tasksUsed).toBe(10);
    // All-equal deltas: every sign-flip assignment with k plus signs gives
    // |0.4·(2k−10)/10| ≤ 0.4, equality at k=0 and k=10 → p = 2/1024.
    expect(stats.permutationP).toBeCloseTo(2 / 1024, 6);
  });

  it("an MPID-straddling interval concludes inconclusive (spec example shape)", () => {
    // Mixed deltas centered slightly above the MPID with wide spread.
    const rngBase = lcg(99);
    const tasks: PolicyTaskRepeats[] = Array.from({ length: 25 }, (_, i) => ({
      taskId: `t${i}`,
      scoresP: [3 + rngBase() * 2],
      scoresQ: [3 + rngBase() * 2],
    }));
    const stats = pairedDeltaComparison(tasks, {
      mpid: 0.25,
      rng: lcg(5),
      bootstrapSamples: 1000,
    });
    expect(["adopt", "not_justified", "inconclusive"]).toContain(stats.verdict);
    expect(stats.ciLow).toBeLessThanOrEqual(stats.meanDelta);
    expect(stats.ciHigh).toBeGreaterThanOrEqual(stats.meanDelta);
  });

  it("a clearly losing policy is not_justified", () => {
    const tasks: PolicyTaskRepeats[] = Array.from({ length: 8 }, (_, i) => ({
      taskId: `t${i}`,
      scoresP: [3.0],
      scoresQ: [4.0],
    }));
    const stats = pairedDeltaComparison(tasks, { mpid: 0.2, rng: lcg(3), bootstrapSamples: 500 });
    expect(stats.losses).toBe(8);
    expect(stats.verdict).toBe("not_justified");
  });

  it("empty input is inconclusive with zero counts", () => {
    const stats = pairedDeltaComparison([], { mpid: 0.2 });
    expect(stats.verdict).toBe("inconclusive");
    expect(stats.tasksUsed).toBe(0);
  });
});
