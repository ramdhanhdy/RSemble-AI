// =============================================================================
// RSemble AI — Complementarity known-answer tests
//
// Spec test 4 (headroom math): identical-strengths pair → both metrics zero;
// the 5/3/4-vs-3/5/4 pair → H_select ≈ 0 and strongly positive H_synth.
// Spec test 5 (optimism bias): headroom shrinks with repeated samples.
// Spec test 6 (verifier gate): binary metrics only from executed verifier
// output; bimodal warning fires without switching the metric path.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { VerifierOutcome } from "./fusion-study-types";
import type { JudgeReport } from "../../studio-data";
import {
  assessChallengerOutcome,
  computeCoFailure,
  computeHeadroom,
  detectBimodalScores,
  gateBinaryMetrics,
  modelTaskScoreFromReport,
  probePoolAdequacy,
  taskOverall,
  type PairedTaskScores,
} from "./complementarity";

const EQUAL_WEIGHTS = new Map([
  ["acc", 1],
  ["comp", 1],
]);

/** The spec's worked example: every task A=(5,3), B=(3,5), overall 4 each. */
function complementaryPair(taskCount: number): PairedTaskScores[] {
  return Array.from({ length: taskCount }, (_, i) => ({
    taskId: `t${i}`,
    a: {
      overall: 4,
      criteria: [
        { criterionId: "acc", score: 5 },
        { criterionId: "comp", score: 3 },
      ],
    },
    b: {
      overall: 4,
      criteria: [
        { criterionId: "acc", score: 3 },
        { criterionId: "comp", score: 5 },
      ],
    },
  }));
}

function identicalPair(taskCount: number): PairedTaskScores[] {
  return Array.from({ length: taskCount }, (_, i) => ({
    taskId: `t${i}`,
    a: {
      overall: 4,
      criteria: [
        { criterionId: "acc", score: 4 },
        { criterionId: "comp", score: 4 },
      ],
    },
    b: {
      overall: 4,
      criteria: [
        { criterionId: "acc", score: 4 },
        { criterionId: "comp", score: 4 },
      ],
    },
  }));
}

describe("headroom math (spec test 4)", () => {
  it("identical-strengths pair yields zero of both metrics", () => {
    const result = computeHeadroom(identicalPair(6), EQUAL_WEIGHTS);
    expect(result.selectionHeadroom).toBeCloseTo(0, 10);
    expect(result.synthesisHeadroom).toBeCloseTo(0, 10);
  });

  it("5/3/4 vs 3/5/4 yields H_select ≈ 0 and strongly positive H_synth", () => {
    const result = computeHeadroom(complementaryPair(6), EQUAL_WEIGHTS);
    expect(result.selectionHeadroom).toBeCloseTo(0, 10);
    // Oracle: (max(5,3) + max(3,5)) / 2 = 5; baseline 4 → H_synth = +1.
    expect(result.synthesisHeadroom).not.toBeNull();
    expect(result.synthesisHeadroom!).toBeCloseTo(1, 10);
    expect(result.synthesisHeadroom!).toBeGreaterThan(0.5);
  });

  it("a pure selection pair (A and B win alternate tasks outright) yields positive H_select and zero H_synth", () => {
    const tasks: PairedTaskScores[] = [
      {
        taskId: "t1",
        a: {
          overall: 5,
          criteria: [
            { criterionId: "acc", score: 5 },
            { criterionId: "comp", score: 5 },
          ],
        },
        b: {
          overall: 3,
          criteria: [
            { criterionId: "acc", score: 3 },
            { criterionId: "comp", score: 3 },
          ],
        },
      },
      {
        taskId: "t2",
        a: {
          overall: 3,
          criteria: [
            { criterionId: "acc", score: 3 },
            { criterionId: "comp", score: 3 },
          ],
        },
        b: {
          overall: 5,
          criteria: [
            { criterionId: "acc", score: 5 },
            { criterionId: "comp", score: 5 },
          ],
        },
      },
    ];
    const result = computeHeadroom(tasks, EQUAL_WEIGHTS);
    // mean(max)=5, max(mean)=4 → H_select = 1.
    expect(result.selectionHeadroom).toBeCloseTo(1, 10);
    // Oracle per task = 5 and 5 (winner dominates every criterion) → no gap.
    expect(result.synthesisHeadroom).toBeCloseTo(0, 10);
  });

  it("per-criterion headroom identifies which criteria each model rescues", () => {
    const tasks: PairedTaskScores[] = [
      {
        taskId: "t1",
        a: {
          overall: null,
          criteria: [
            { criterionId: "acc", score: 5 },
            { criterionId: "comp", score: 3 },
          ],
        },
        b: {
          overall: null,
          criteria: [
            { criterionId: "acc", score: 3 },
            { criterionId: "comp", score: 3 },
          ],
        },
      },
      {
        taskId: "t2",
        a: {
          overall: null,
          criteria: [
            { criterionId: "acc", score: 3 },
            { criterionId: "comp", score: 3 },
          ],
        },
        b: {
          overall: null,
          criteria: [
            { criterionId: "acc", score: 5 },
            { criterionId: "comp", score: 3 },
          ],
        },
      },
    ];
    const result = computeHeadroom(tasks, EQUAL_WEIGHTS);
    const acc = result.perCriterion.find((c) => c.criterionId === "acc");
    const comp = result.perCriterion.find((c) => c.criterionId === "comp");
    // acc: mean(max)=5, max(mean)=4 → +1 (per-task choice helps on accuracy).
    expect(acc?.headroom).toBeCloseTo(1, 10);
    // comp: constant 3 both sides → 0.
    expect(comp?.headroom).toBeCloseTo(0, 10);
  });

  it("criterion weights steer the synthesis oracle", () => {
    const heavy = new Map([
      ["acc", 3],
      ["comp", 1],
    ]);
    const weighted = computeHeadroom(complementaryPair(4), heavy);
    // Oracle: (3·5 + 1·5)/4 = 5; weighted overall: (3·5+1·3)/4 = 4.5 (A),
    // (3·3+1·5)/4 = 3.5 (B) → H_synth = 5 − 4.5 = 0.5.
    expect(weighted.synthesisHeadroom!).toBeCloseTo(0.5, 10);
  });

  it("holistic tasks (no criterion scores) feed H_select only, never H_synth", () => {
    const holistic: PairedTaskScores[] = [
      { taskId: "t1", a: { overall: 5, criteria: [] }, b: { overall: 3, criteria: [] } },
      { taskId: "t2", a: { overall: 3, criteria: [] }, b: { overall: 5, criteria: [] } },
    ];
    const result = computeHeadroom(holistic, EQUAL_WEIGHTS);
    expect(result.selectionHeadroom).toBeCloseTo(1, 10);
    expect(result.synthesisHeadroom).toBeNull();
    expect(result.tasksWithCriteria).toBe(0);
  });
});

describe("optimism bias (spec test 5)", () => {
  // Deterministic LCG so the fixture is stable.
  function lcg(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state / 2 ** 31;
    };
  }

  it("both headroom metrics shrink as repeated samples are averaged", () => {
    const rng = lcg(42);
    const noise = () => (rng() - 0.5) * 2; // ±1 uniform noise
    const tasks = 24;
    const repeats = 5;

    // True model strength is identical (4,4) — true headroom is zero. Single
    // generations show phantom headroom from the max over noise.
    const singleSample: PairedTaskScores[] = [];
    const averaged: PairedTaskScores[] = [];
    const mk = (acc: number, comp: number) => ({
      overall: (acc + comp) / 2,
      criteria: [
        { criterionId: "acc", score: acc },
        { criterionId: "comp", score: comp },
      ],
    });
    for (let t = 0; t < tasks; t++) {
      // Independent noise per criterion — the synthesis oracle maxes over
      // noise per criterion, which is exactly the optimism bias under test.
      const samplesA: Array<[number, number]> = [];
      const samplesB: Array<[number, number]> = [];
      for (let r = 0; r < repeats; r++) {
        samplesA.push([4 + noise(), 4 + noise()]);
        samplesB.push([4 + noise(), 4 + noise()]);
      }
      singleSample.push({
        taskId: `t${t}`,
        a: mk(samplesA[0][0], samplesA[0][1]),
        b: mk(samplesB[0][0], samplesB[0][1]),
      });
      const meanOf = (samples: Array<[number, number]>, idx: 0 | 1) =>
        samples.reduce((x, v) => x + v[idx], 0) / repeats;
      averaged.push({
        taskId: `t${t}`,
        a: mk(meanOf(samplesA, 0), meanOf(samplesA, 1)),
        b: mk(meanOf(samplesB, 0), meanOf(samplesB, 1)),
      });
    }

    const single = computeHeadroom(singleSample, EQUAL_WEIGHTS);
    const repeated = computeHeadroom(averaged, EQUAL_WEIGHTS);

    expect(single.selectionHeadroom).toBeGreaterThan(repeated.selectionHeadroom);
    expect(single.synthesisHeadroom!).toBeGreaterThan(repeated.synthesisHeadroom!);
    expect(repeated.selectionHeadroom).toBeLessThan(0.15);
  });
});

describe("verifier gate (spec test 6)", () => {
  const outcomes: VerifierOutcome[] = [
    { taskId: "t1", modelKey: "a/m1", passed: false, executedAt: 1 },
    { taskId: "t1", modelKey: "b/m2", passed: false, executedAt: 1 },
    { taskId: "t2", modelKey: "a/m1", passed: true, executedAt: 1 },
    { taskId: "t2", modelKey: "b/m2", passed: false, executedAt: 1 },
  ];

  it("refuses binary metrics on rubric-only tasks", () => {
    const gate = gateBinaryMetrics(
      [{ taskId: "t1", verification: { kind: "none" } }, { taskId: "t2" }],
      outcomes,
      ["a/m1", "b/m2"],
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("never derived from rubric scores");
  });

  it("computes co-failure only where executed verifier output exists", () => {
    const gate = gateBinaryMetrics(
      [
        { taskId: "t1", verification: { kind: "unit_tests" } },
        { taskId: "t2", verification: { kind: "exact_match" } },
      ],
      outcomes,
      ["a/m1", "b/m2"],
    );
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    const metrics = computeCoFailure(outcomes, ["a/m1", "b/m2"], gate.taskIds);
    // F_A = {t1}, F_B = {t1, t2} → J = 1/2.
    expect(metrics.jaccard).toBeCloseTo(0.5, 10);
    expect(metrics.tasksUsed).toBe(2);
  });

  it("warns and falls back when a verifier is configured but not executed", () => {
    const gate = gateBinaryMetrics(
      [
        { taskId: "t1", verification: { kind: "unit_tests" } },
        { taskId: "t3", verification: { kind: "schema" } },
      ],
      outcomes,
      ["a/m1", "b/m2"],
    );
    expect(gate.ok).toBe(true);
    expect(gate.warnings.some((w) => w.includes("t3"))).toBe(true);
    if (gate.ok) expect(gate.taskIds).toEqual(["t1"]);
  });

  it("bimodal rubric distributions trigger a warning, not a metric switch", () => {
    const bimodal = [1, 1, 1, 1, 5, 5, 5, 5, 1, 5];
    const warning = detectBimodalScores(bimodal);
    expect(warning).toContain("Bimodal");
    expect(warning).toContain("never become deterministic labels");
    // One-sided or flat distributions do not warn.
    expect(detectBimodalScores([5, 5, 5, 5, 5, 5, 5, 5])).toBeNull();
    expect(detectBimodalScores([3, 3, 4, 2, 3, 4, 2, 3])).toBeNull();
  });
});

describe("pool adequacy probe (spec §5.6)", () => {
  it("triggers challengers when best is below ceiling, oracle is near zero, and no pair has headroom", () => {
    const probe = probePoolAdequacy({
      bestModelMean: 3.9,
      ceiling: 5,
      poolOracleHeadroom: 0.02,
      maxPairHeadroom: 0.04,
    });
    expect(probe.triggerChallengers).toBe(true);
    expect(probe.reasons).toHaveLength(3);
  });

  it("does not trigger when any single condition fails", () => {
    expect(
      probePoolAdequacy({
        bestModelMean: 4.8,
        ceiling: 5,
        poolOracleHeadroom: 0.02,
        maxPairHeadroom: 0.04,
      }).triggerChallengers,
    ).toBe(false);
    expect(
      probePoolAdequacy({
        bestModelMean: 3.9,
        ceiling: 5,
        poolOracleHeadroom: 0.2,
        maxPairHeadroom: 0.04,
      }).triggerChallengers,
    ).toBe(false);
    expect(
      probePoolAdequacy({
        bestModelMean: 3.9,
        ceiling: 5,
        poolOracleHeadroom: 0.02,
        maxPairHeadroom: 0.3,
      }).triggerChallengers,
    ).toBe(false);
  });

  it("challenger outcome: headroom opened → unconfirmed; same failures → confirmed", () => {
    expect(assessChallengerOutcome([{ modelKey: "x/m9", maxPairHeadroomWithPool: 0.4 }])).toBe(
      "unconfirmed",
    );
    expect(assessChallengerOutcome([{ modelKey: "x/m9", maxPairHeadroomWithPool: 0.02 }])).toBe(
      "confirmed",
    );
  });
});

describe("taskOverall", () => {
  it("prefers criterion-weighted means and falls back to holistic overalls", () => {
    expect(
      taskOverall(
        {
          overall: 1,
          criteria: [
            { criterionId: "acc", score: 5 },
            { criterionId: "comp", score: 3 },
          ],
        },
        EQUAL_WEIGHTS,
      ),
    ).toBeCloseTo(4, 10);
    expect(taskOverall({ overall: 4.2, criteria: [] }, EQUAL_WEIGHTS)).toBeCloseTo(4.2, 10);
    expect(taskOverall({ overall: null, criteria: [] }, EQUAL_WEIGHTS)).toBeNull();
  });
});

describe("modelTaskScoreFromReport — binary criteria excluded from numeric vectors", () => {
  it("skips binary criterion results so they never become fake 1/5 headroom scores", () => {
    const report: JudgeReport = {
      labelMap: [
        { label: "A", candidateId: "c1" },
        { label: "B", candidateId: "c2" },
      ],
      evaluationsById: {
        c1: {
          candidateId: "c1",
          blindLabel: "A",
          overallScore: 4.0,
          position: "p",
          rationale: "r",
          strengths: ["s"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "quality", label: "Quality", kind: "graded", score: 4, rationale: "r" },
            { criterionId: "b1", label: "Check", kind: "binary", value: true, rationale: "r" },
            { criterionId: "b2", label: "Check2", kind: "binary", value: false, rationale: "r" },
          ],
        },
        c2: {
          candidateId: "c2",
          blindLabel: "B",
          overallScore: 4.0,
          position: "p",
          rationale: "r",
          strengths: ["s"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [],
        },
      },
      comparisons: [],
    };
    const score = modelTaskScoreFromReport(report, "c1");
    expect(score).not.toBeNull();
    // Only the graded criterion survives — binary booleans must NOT be coerced
    // into 0/1 numeric scores in the CriterionScoreVector.
    expect(score!.criteria).toHaveLength(1);
    expect(score!.criteria[0]).toEqual({ criterionId: "quality", score: 4 });
  });
});
