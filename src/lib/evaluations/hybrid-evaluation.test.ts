// =============================================================================
// Hybrid evaluation criteria — domain model, scoring, and validation tests
//
// Phase A/E tests: discriminated criterion union, Requirement Groups,
// complianceInfluence, Q/C/rankValue/rankScore/floored, decomposition invariant.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  evaluationCriteriaText,
  judgeEvaluationBlock,
  qualityScore,
  complianceScore,
  rankValueOf,
  rankScoreOf,
  isFloored,
  computeWinnerKeys,
  validateRubric,
  normalizedWeights,
  totalWeight,
  getComplianceInfluence,
  DEFAULT_COMPLIANCE_INFLUENCE,
  WINNER_EPSILON,
  isWeightedCriterion,
  isBinaryCriterion,
  canonicalScore,
} from "./evaluation-rubric";
import {
  isEvaluationCriterion,
  isEvaluationRubric,
  isGradedEvaluationCriterion,
  isBinaryEvaluationCriterion,
  isLegacyGradedEvaluationCriterion,
  isRequirementGroup,
  type EvaluationRubric,
  type EvaluationCriterion,
  type GradedEvaluationCriterion,
  type BinaryEvaluationCriterion,
  type RequirementGroup,
} from "./evaluation-types";

// --- Fixtures ------------------------------------------------------------------

function makeGradedCriterion(
  id: string,
  overrides: Partial<GradedEvaluationCriterion> = {},
): GradedEvaluationCriterion {
  return {
    id,
    kind: "graded",
    name: `Graded ${id}`,
    description: `Description ${id}`,
    weight: 1,
    anchors: {
      one: "1 — poor",
      two: "2 — weak",
      three: "3 — adequate",
      four: "4 — strong",
      five: "5 — excellent",
    },
    ...overrides,
  };
}

function makeBinaryCriterion(
  id: string,
  overrides: Partial<BinaryEvaluationCriterion> = {},
): BinaryEvaluationCriterion {
  return {
    id,
    kind: "binary",
    name: `Binary ${id}`,
    description: `Description ${id}`,
    trueWhen: "Condition for true",
    falseWhen: "Condition for false",
    ...overrides,
  };
}

function makeLegacyCriterion(
  id: string,
  overrides: Record<string, unknown> = {},
): EvaluationCriterion {
  return {
    id,
    name: `Legacy ${id}`,
    description: `Description ${id}`,
    weight: 1,
    anchors: { one: "Poor", three: "OK", five: "Great" },
    kind: undefined,
    ...overrides,
  } as unknown as EvaluationCriterion;
}

function makeGroup(
  id: string,
  checkIds: string[],
  overrides: Partial<RequirementGroup> = {},
): RequirementGroup {
  return {
    id,
    name: `Group ${id}`,
    checkIds,
    weight: 1,
    mode: "ALL",
    ...overrides,
  };
}

function makeRubric(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
  return {
    id: "p1",
    version: 1,
    name: "Test Rubric",
    description: "test",
    judgeInstruction: "",
    criteria: [makeGradedCriterion("c1"), makeGradedCriterion("c2", { weight: 2 })],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeMixedRubric(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
  const checks = [makeBinaryCriterion("b1"), makeBinaryCriterion("b2")];
  return {
    id: "p1",
    version: 1,
    name: "Mixed Rubric",
    description: "test",
    judgeInstruction: "",
    criteria: [makeGradedCriterion("c1", { weight: 2 }), ...checks],
    requirementGroups: [
      makeGroup("g1", ["b1"], { weight: 1 }),
      makeGroup("g2", ["b2"], { weight: 1 }),
    ],
    complianceInfluence: 1.0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

// --- Domain type guards -------------------------------------------------------

describe("isGradedEvaluationCriterion", () => {
  it("accepts explicit graded with five anchors", () => {
    expect(isGradedEvaluationCriterion(makeGradedCriterion("c1"))).toBe(true);
  });
  it("rejects missing Score 2", () => {
    const c = makeGradedCriterion("c1");
    delete (c.anchors as Record<string, string>).two;
    expect(isGradedEvaluationCriterion(c)).toBe(false);
  });
  it("rejects missing Score 4", () => {
    const c = makeGradedCriterion("c1");
    delete (c.anchors as Record<string, string>).four;
    expect(isGradedEvaluationCriterion(c)).toBe(false);
  });
  it("rejects binary", () => {
    expect(isGradedEvaluationCriterion(makeBinaryCriterion("b1"))).toBe(false);
  });
  it("rejects legacy (kind undefined)", () => {
    expect(isGradedEvaluationCriterion(makeLegacyCriterion("c1"))).toBe(false);
  });
});

describe("isBinaryEvaluationCriterion", () => {
  it("accepts binary with trueWhen/falseWhen", () => {
    expect(isBinaryEvaluationCriterion(makeBinaryCriterion("b1"))).toBe(true);
  });
  it("rejects missing trueWhen", () => {
    const c = makeBinaryCriterion("b1");
    delete (c as unknown as Record<string, unknown>).trueWhen;
    expect(isBinaryEvaluationCriterion(c)).toBe(false);
  });
  it("rejects missing falseWhen", () => {
    const c = makeBinaryCriterion("b1");
    delete (c as unknown as Record<string, unknown>).falseWhen;
    expect(isBinaryEvaluationCriterion(c)).toBe(false);
  });
  it("rejects graded", () => {
    expect(isBinaryEvaluationCriterion(makeGradedCriterion("c1"))).toBe(false);
  });
});

describe("isLegacyGradedEvaluationCriterion", () => {
  it("accepts legacy with 1/3/5 anchors and kind undefined", () => {
    expect(isLegacyGradedEvaluationCriterion(makeLegacyCriterion("c1"))).toBe(true);
  });
  it("rejects explicit graded", () => {
    expect(isLegacyGradedEvaluationCriterion(makeGradedCriterion("c1"))).toBe(false);
  });
});

describe("isEvaluationCriterion (union guard)", () => {
  it("accepts graded, binary, and legacy", () => {
    expect(isEvaluationCriterion(makeGradedCriterion("c1"))).toBe(true);
    expect(isEvaluationCriterion(makeBinaryCriterion("b1"))).toBe(true);
    expect(isEvaluationCriterion(makeLegacyCriterion("c1"))).toBe(true);
  });
  it("rejects kind:gate", () => {
    const gate = { id: "g1", kind: "gate", name: "Gate", description: "d" };
    expect(isEvaluationCriterion(gate)).toBe(false);
  });
  it("rejects unknown kind", () => {
    const unknown = { id: "x1", kind: "categorical", name: "X", description: "d" };
    expect(isEvaluationCriterion(unknown)).toBe(false);
  });
});

describe("isRequirementGroup", () => {
  it("accepts valid group with positive weight and ALL mode", () => {
    expect(isRequirementGroup(makeGroup("g1", ["b1"], { weight: 1 }))).toBe(true);
  });
  it("rejects zero weight", () => {
    expect(isRequirementGroup(makeGroup("g1", ["b1"], { weight: 0 }))).toBe(false);
  });
  it("rejects negative weight", () => {
    expect(isRequirementGroup(makeGroup("g1", ["b1"], { weight: -1 }))).toBe(false);
  });
  it("rejects non-ALL mode", () => {
    expect(isRequirementGroup({ ...makeGroup("g1", ["b1"]), mode: "MEAN" } as unknown)).toBe(false);
  });
  it("rejects empty checkIds", () => {
    expect(isRequirementGroup(makeGroup("g1", []))).toBe(false);
  });
  it("rejects duplicate checkIds", () => {
    expect(isRequirementGroup(makeGroup("g1", ["b1", "b1"]))).toBe(true); // guard doesn't check dupes; validateRubric does
  });
});

describe("isEvaluationRubric", () => {
  it("accepts mixed rubric with groups and complianceInfluence", () => {
    expect(isEvaluationRubric(makeMixedRubric())).toBe(true);
  });
  it("accepts graded-only rubric", () => {
    expect(isEvaluationRubric(makeRubric())).toBe(true);
  });
  it("accepts legacy graded-only rubric", () => {
    const p = makeRubric({ criteria: [makeLegacyCriterion("c1")] as EvaluationCriterion[] });
    expect(isEvaluationRubric(p)).toBe(true);
  });
  it("accepts binary-only rubric with groups", () => {
    const p = makeRubric({
      criteria: [makeBinaryCriterion("b1")] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["b1"])],
    });
    expect(isEvaluationRubric(p)).toBe(true);
  });
  it("rejects binary-only rubric without groups", () => {
    const p = makeRubric({
      criteria: [makeBinaryCriterion("b1")] as EvaluationCriterion[],
    });
    expect(isEvaluationRubric(p)).toBe(false);
  });
  it("rejects complianceInfluence > 1", () => {
    const p = makeMixedRubric({ complianceInfluence: 1.5 });
    expect(isEvaluationRubric(p)).toBe(false);
  });
  it("rejects complianceInfluence < 0", () => {
    const p = makeMixedRubric({ complianceInfluence: -0.5 });
    expect(isEvaluationRubric(p)).toBe(false);
  });
});

// --- Kind helpers --------------------------------------------------------------

describe("isWeightedCriterion / isBinaryCriterion", () => {
  it("isWeightedCriterion returns true for graded and legacy", () => {
    expect(isWeightedCriterion(makeGradedCriterion("c1"))).toBe(true);
    expect(isWeightedCriterion(makeLegacyCriterion("c1"))).toBe(true);
  });
  it("isWeightedCriterion returns false for binary", () => {
    expect(isWeightedCriterion(makeBinaryCriterion("b1"))).toBe(false);
  });
  it("isBinaryCriterion returns true for binary only", () => {
    expect(isBinaryCriterion(makeBinaryCriterion("b1"))).toBe(true);
    expect(isBinaryCriterion(makeGradedCriterion("c1"))).toBe(false);
    expect(isBinaryCriterion(makeLegacyCriterion("c1"))).toBe(false);
  });
});

// --- Judge prompt rendering ----------------------------------------------------

describe("evaluationCriteriaText (hybrid)", () => {
  it("renders graded with all five anchors", () => {
    const text = evaluationCriteriaText(makeRubric(), { withIds: true });
    expect(text).toContain("Score 1: 1 — poor");
    expect(text).toContain("Score 2: 2 — weak");
    expect(text).toContain("Score 3: 3 — adequate");
    expect(text).toContain("Score 4: 4 — strong");
    expect(text).toContain("Score 5: 5 — excellent");
  });
  it("renders binary with TRUE/FALSE conditions", () => {
    const text = evaluationCriteriaText(makeMixedRubric(), { withIds: true });
    expect(text).toContain("TRUE when: Condition for true");
    expect(text).toContain("FALSE when: Condition for false");
    expect(text).toContain("(binary)");
  });
  it("does NOT encode binary as numeric score", () => {
    const binaryOnly = makeRubric({
      criteria: [makeBinaryCriterion("b1")] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["b1"])],
    });
    const text = evaluationCriteriaText(binaryOnly);
    expect(text).not.toContain("Score 1");
    expect(text).not.toContain("Score 5");
    expect(text).toContain("Return a JSON boolean");
  });
  it("renders group annotation for binary checks", () => {
    const text = evaluationCriteriaText(makeMixedRubric(), { withIds: true });
    expect(text).toContain("[group: g1]");
    expect(text).toContain("[group: g2]");
  });
  it("renders legacy with 1/3/5 anchors only", () => {
    const p = makeRubric({ criteria: [makeLegacyCriterion("c1")] as EvaluationCriterion[] });
    const text = evaluationCriteriaText(p);
    expect(text).toContain("Score 1: Poor");
    expect(text).toContain("Score 3: OK");
    expect(text).toContain("Score 5: Great");
    expect(text).not.toContain("Score 2:");
    expect(text).not.toContain("Score 4:");
  });
});

describe("judgeEvaluationBlock (hybrid)", () => {
  it("includes mixed-scale instruction for hybrid rubrics", () => {
    const block = judgeEvaluationBlock(makeMixedRubric());
    expect(block).toContain("graded criteria on a 1–5 integer scale");
    expect(block).toContain("binary criteria as true/false");
  });
  it("includes graded-only instruction for graded rubrics", () => {
    const block = judgeEvaluationBlock(makeRubric());
    expect(block).toContain("1–5 integer scale");
  });
});

// --- Scoring: Q, C, rankValue, rankScore, floored -----------------------------

describe("qualityScore", () => {
  it("computes weighted mean of graded criteria", () => {
    const rubric = makeRubric({
      criteria: [
        makeGradedCriterion("c1", { weight: 1 }),
        makeGradedCriterion("c2", { weight: 2 }),
      ],
    });
    expect(qualityScore({ c1: 4, c2: 5 }, rubric)).toBeCloseTo(14 / 3, 10);
  });
  it("returns null when no graded criteria", () => {
    const rubric = makeRubric({
      criteria: [makeBinaryCriterion("b1")] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["b1"])],
    });
    expect(qualityScore({}, rubric)).toBeNull();
  });
  it("ignores binary criteria (no weight)", () => {
    expect(qualityScore({ c1: 4 }, makeMixedRubric())).toBe(4);
  });
});

describe("complianceScore", () => {
  it("computes weighted pass share for all-pass", () => {
    const rubric = makeMixedRubric();
    expect(complianceScore({ b1: true, b2: true }, rubric)?.C).toBe(1);
  });
  it("computes weighted pass share for half-pass", () => {
    const rubric = makeMixedRubric();
    expect(complianceScore({ b1: true, b2: false }, rubric)?.C).toBeCloseTo(0.5, 10);
  });
  it("returns null when no groups", () => {
    expect(complianceScore({}, makeRubric())).toBeNull();
  });
  it("ALL mode: one false subcheck fails the group", () => {
    const rubric = makeMixedRubric({
      requirementGroups: [makeGroup("g1", ["b1", "b2"], { weight: 1 })],
    });
    expect(complianceScore({ b1: true, b2: false }, rubric)?.C).toBe(0);
    expect(complianceScore({ b1: true, b2: true }, rubric)?.C).toBe(1);
  });
  it("unequal group weights", () => {
    const rubric = makeMixedRubric({
      requirementGroups: [
        makeGroup("g1", ["b1"], { weight: 3 }),
        makeGroup("g2", ["b2"], { weight: 1 }),
      ],
    });
    // b1 passes (weight 3), b2 fails (weight 1) → C = 3/4 = 0.75
    expect(complianceScore({ b1: true, b2: false }, rubric)?.C).toBeCloseTo(0.75, 10);
  });
});

describe("rankValueOf", () => {
  it("Q - lambda*(1-C) with lambda=1", () => {
    expect(rankValueOf(4, 0.5, 1)).toBeCloseTo(3.5, 10);
  });
  it("Q - lambda*(1-C) with lambda=0", () => {
    expect(rankValueOf(4, 0, 0)).toBe(4);
  });
  it("can go below 1 (floor region)", () => {
    expect(rankValueOf(1, 0, 1)).toBe(0);
    expect(rankValueOf(1.2, 0.5, 1)).toBeCloseTo(0.7, 10);
  });
  it("returns null when both Q and C are null", () => {
    expect(rankValueOf(null, null, 1)).toBeNull();
  });
  it("C defaults to 1 when null (no binary checks)", () => {
    expect(rankValueOf(4, null, 1)).toBe(4);
  });
  it("compliance-only (no graded) ranks on the weighted compliance share C", () => {
    // Spec §16.3: a compliance-only rubric ranks on C̄ (0–100%).
    expect(rankValueOf(null, 0.5, 1)).toBe(0.5);
    expect(rankValueOf(null, 0.8, 1)).toBe(0.8);
    // Nothing to rank when both channels are absent.
    expect(rankValueOf(null, null, 1)).toBeNull();
  });
});

describe("rankScoreOf", () => {
  it("max(1, rankValue) for floored values", () => {
    expect(rankScoreOf(0.5)).toBe(1);
    expect(rankScoreOf(0)).toBe(1);
  });
  it("identity for non-floored values", () => {
    expect(rankScoreOf(3.5)).toBe(3.5);
    expect(rankScoreOf(5)).toBe(5);
  });
  it("null passthrough", () => {
    expect(rankScoreOf(null)).toBeNull();
  });
});

describe("isFloored", () => {
  it("true when rankValue < 1", () => {
    expect(isFloored(0.5)).toBe(true);
    expect(isFloored(0.99)).toBe(true);
  });
  it("false when rankValue >= 1", () => {
    expect(isFloored(1)).toBe(false);
    expect(isFloored(3.5)).toBe(false);
  });
  it("false for null", () => {
    expect(isFloored(null)).toBe(false);
  });
});

// --- Composition-cap invariant: Q - rankValue <= lambda -----------------------

describe("composition-cap invariant", () => {
  it("Q - rankValue <= lambda for valid mixed rubrics", () => {
    // Randomized sweep
    for (let trial = 0; trial < 100; trial++) {
      const Q = 1 + Math.random() * 4; // 1..5
      const C = Math.random(); // 0..1
      const lambda = Math.random(); // 0..1
      const rv = rankValueOf(Q, C, lambda)!;
      expect(Q - rv).toBeLessThanOrEqual(lambda + WINNER_EPSILON);
    }
  });
  it("fail cost of one group = lambda * v_g / sum(v)", () => {
    const rubric = makeMixedRubric({
      requirementGroups: [
        makeGroup("g1", ["b1"], { weight: 1 }),
        makeGroup("g2", ["b2"], { weight: 3 }),
      ],
      complianceInfluence: 1.0,
    });
    const lambda = getComplianceInfluence(rubric);
    const groups = rubric.requirementGroups!;
    const sumV = groups.reduce((s, g) => s + g.weight, 0);
    // Fail g1 only: rankValue moves by lambda * v_g1 / sumV
    const Q = 4;
    const C_all_pass = complianceScore({ b1: true, b2: true }, rubric)!.C;
    const C_g1_fail = complianceScore({ b1: false, b2: true }, rubric)!.C;
    const rv_all = rankValueOf(Q, C_all_pass, lambda)!;
    const rv_fail = rankValueOf(Q, C_g1_fail, lambda)!;
    const cost = rv_all - rv_fail;
    const expectedCost = (lambda * groups[0].weight) / sumV;
    expect(cost).toBeCloseTo(expectedCost, 10);
  });
});

// --- Decomposition invariance -------------------------------------------------

describe("decomposition invariance", () => {
  it("1 check vs 5 subchecks in one ALL group (same v) yields same C and rankValue", () => {
    // Rubric A: one binary check in one group (weight 1)
    const rubricA = makeRubric({
      criteria: [
        makeGradedCriterion("c1", { weight: 2 }),
        makeBinaryCriterion("b1"),
      ] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["b1"], { weight: 1 })],
      complianceInfluence: 1.0,
    });
    // Rubric B: five binary checks in one ALL group (weight 1)
    const rubricB = makeRubric({
      criteria: [
        makeGradedCriterion("c1", { weight: 2 }),
        ...["b1", "b2", "b3", "b4", "b5"].map((id) => makeBinaryCriterion(id)),
      ] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["b1", "b2", "b3", "b4", "b5"], { weight: 1 })],
      complianceInfluence: 1.0,
    });

    // All pass
    const Ca = complianceScore({ b1: true }, rubricA)!.C;
    const Cb = complianceScore({ b1: true, b2: true, b3: true, b4: true, b5: true }, rubricB)!.C;
    expect(Ca).toBe(Cb);
    expect(rankValueOf(4, Ca, 1)).toBe(rankValueOf(4, Cb, 1));

    // All fail
    const Cfa = complianceScore({ b1: false }, rubricA)!.C;
    const Cfb = complianceScore(
      { b1: false, b2: false, b3: false, b4: false, b5: false },
      rubricB,
    )!.C;
    expect(Cfa).toBe(Cfb);
    expect(rankValueOf(4, Cfa, 1)).toBe(rankValueOf(4, Cfb, 1));
  });
});

// --- Floor behavior: rankValue authority vs rankScore false ties ---------------

describe("floor ranking authority", () => {
  it("candidate A (rv=0.8) must outrank B (rv=0.4) despite both rankScore=1.0", () => {
    const rvA = 0.8;
    const rvB = 0.4;
    expect(rankScoreOf(rvA)).toBe(1.0);
    expect(rankScoreOf(rvB)).toBe(1.0);
    // Winner comparison on rankValue, NOT rankScore
    const winners = computeWinnerKeys({ A: rvA, B: rvB });
    expect(winners).toEqual(["A"]);
    // Winner comparison on rankScore would be WRONG (would tie)
    const wrongWinners = computeWinnerKeys({ A: rankScoreOf(rvA)!, B: rankScoreOf(rvB)! });
    expect(wrongWinners.sort()).toEqual(["A", "B"]); // WRONG — proves why rankScore can't be authority
  });
});

// --- Validation ---------------------------------------------------------------

describe("validateRubric (hybrid)", () => {
  it("passes for valid mixed rubric", () => {
    expect(validateRubric(makeMixedRubric())).toEqual([]);
  });
  it("rejects kind:gate with actionable message", () => {
    const p = makeRubric({
      criteria: [
        {
          id: "g1",
          kind: "gate",
          name: "Gate",
          description: "d",
        } as unknown as EvaluationCriterion,
      ],
    });
    const errors = validateRubric(p);
    expect(errors.some((e) => e.includes("hard-gate"))).toBe(true);
  });
  it("rejects binary check without group", () => {
    const p = makeRubric({
      criteria: [makeGradedCriterion("c1"), makeBinaryCriterion("b1")] as EvaluationCriterion[],
    });
    const errors = validateRubric(p);
    expect(errors.some((e) => e.includes("not assigned to any requirement group"))).toBe(true);
  });
  it("rejects graded criterion missing Score 2", () => {
    const c = makeGradedCriterion("c1", {
      anchors: {
        one: "1",
        two: "",
        three: "3",
        four: "4",
        five: "5",
      },
    });
    const p = makeRubric({ criteria: [c] as EvaluationCriterion[] });
    const errors = validateRubric(p);
    expect(errors.some((e) => e.includes("all five anchors"))).toBe(true);
  });
  it("rejects group with non-binary check", () => {
    const p = makeRubric({
      criteria: [makeGradedCriterion("c1"), makeBinaryCriterion("b1")] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["c1", "b1"])],
    });
    const errors = validateRubric(p);
    expect(errors.some((e) => e.includes("not a binary criterion"))).toBe(true);
  });
  it("rejects duplicate group membership", () => {
    const p = makeRubric({
      criteria: [makeBinaryCriterion("b1")] as EvaluationCriterion[],
      requirementGroups: [makeGroup("g1", ["b1"]), makeGroup("g2", ["b1"])],
    });
    const errors = validateRubric(p);
    expect(errors.some((e) => e.includes("already assigned"))).toBe(true);
  });
  it("rejects invalid complianceInfluence", () => {
    const p = makeMixedRubric({ complianceInfluence: 2 });
    const errors = validateRubric(p);
    expect(errors.some((e) => e.includes("complianceInfluence"))).toBe(true);
  });
});

// --- Display helpers ----------------------------------------------------------

describe("normalizedWeights / totalWeight (hybrid)", () => {
  it("normalizedWeights returns 0 for binary criteria", () => {
    const nw = normalizedWeights(makeMixedRubric().criteria);
    expect(nw.b1).toBe(0);
    expect(nw.b2).toBe(0);
  });
  it("totalWeight only sums graded weights", () => {
    const tw = totalWeight(makeMixedRubric().criteria);
    expect(tw).toBe(2); // only c1 with weight 2
  });
});

// --- Pure-graded bit-identical compatibility ----------------------------------

describe("pure-graded compatibility", () => {
  it("Q = rankValue when no binary checks (C:=1)", () => {
    const rubric = makeRubric();
    const Q = qualityScore({ c1: 4, c2: 5 }, rubric)!;
    const C = complianceScore({}, rubric)?.C ?? null; // null → C:=1
    const rv = rankValueOf(Q, C, 1.0)!;
    expect(rv).toBe(Q);
    expect(rankScoreOf(rv)).toBe(Q);
    expect(isFloored(rv)).toBe(false);
  });
  it("canonicalScore === qualityScore for graded-only", () => {
    const rubric = makeRubric();
    const scores = { c1: 4, c2: 5 };
    expect(canonicalScore(scores, rubric)).toBe(qualityScore(scores, rubric));
  });
});

// --- DEFAULT_COMPLIANCE_INFLUENCE ---------------------------------------------

describe("DEFAULT_COMPLIANCE_INFLUENCE", () => {
  it("is 1.0", () => {
    expect(DEFAULT_COMPLIANCE_INFLUENCE).toBe(1.0);
  });
  it("getComplianceInfluence defaults to 1.0 when absent", () => {
    expect(getComplianceInfluence(makeRubric())).toBe(1.0);
  });
  it("getComplianceInfluence returns explicit value", () => {
    expect(getComplianceInfluence(makeMixedRubric({ complianceInfluence: 0.5 }))).toBe(0.5);
  });
});
