// =============================================================================
// evaluation-profile.ts — tests for anchored-profile formatting and scoring
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  evaluationCriteriaText,
  judgeEvaluationBlock,
  canonicalScore,
  computeWinnerKeys,
  validateProfile,
  normalizedWeights,
  totalWeight,
  WINNER_EPSILON,
} from "./evaluation-profile";
import type { EvaluationProfile, EvaluationCriterion } from "./evaluation-types";

function makeCriterion(id: string, overrides: Partial<EvaluationCriterion> = {}): EvaluationCriterion {
  return {
    id,
    name: `Criterion ${id}`,
    description: `Description for ${id}`,
    weight: 1,
    anchors: { one: "Poor", three: "Adequate", five: "Excellent" },
    ...overrides,
  };
}

function makeProfile(overrides: Partial<EvaluationProfile> = {}): EvaluationProfile {
  return {
    id: "p1",
    version: 1,
    name: "Test Profile",
    description: "test",
    judgeInstruction: "",
    criteria: [makeCriterion("c1"), makeCriterion("c2", { weight: 2 })],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

// --- Task 4.2 failing tests ---

describe("evaluationCriteriaText", () => {
  it("renders stable IDs, names, descriptions, weights, and 1/3/5 anchors", () => {
    const profile = makeProfile();
    const text = evaluationCriteriaText(profile, { withIds: true });
    expect(text).toContain("[id: c1]");
    expect(text).toContain("Criterion c1");
    expect(text).toContain("Description for c1");
    expect(text).toContain("Score 1: Poor");
    expect(text).toContain("Score 3: Adequate");
    expect(text).toContain("Score 5: Excellent");
  });

  it("returns holistic message when criteria is empty", () => {
    const profile = makeProfile({ criteria: [] });
    const text = evaluationCriteriaText(profile);
    expect(text).toContain("no explicit criteria");
  });
});

describe("judgeEvaluationBlock", () => {
  it("includes base judge instruction from profile", () => {
    const profile = makeProfile({ judgeInstruction: "Be strict about evidence." });
    const block = judgeEvaluationBlock(profile);
    expect(block).toContain("Be strict about evidence.");
    expect(block).toContain("Evaluate each candidate");
  });

  it("returns override instruction for holistic (null profile)", () => {
    const block = judgeEvaluationBlock(null, "Focus on clarity.");
    expect(block).toBe("Focus on clarity.");
  });

  it("returns empty string for holistic with no override", () => {
    const block = judgeEvaluationBlock(null);
    expect(block).toBe("");
  });
});

describe("canonicalScore", () => {
  it("computes deterministic weighted mean of the complete criterion vector", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 2 })] });
    const scores = { c1: 4, c2: 5 };
    // (4*1 + 5*2) / (1+2) = 14/3 ≈ 4.6667
    expect(canonicalScore(scores, profile)).toBeCloseTo(14 / 3, 10);
  });

  it("returns null when all weights are zero", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: 0 }), makeCriterion("c2", { weight: 0 })] });
    expect(canonicalScore({ c1: 4, c2: 5 }, profile)).toBeNull();
  });

  it("ignores criteria with zero weight in computation", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 0 })] });
    const scores = { c1: 3, c2: 5 };
    expect(canonicalScore(scores, profile)).toBe(3);
  });
});

describe("computeWinnerKeys", () => {
  it("includes all models within epsilon of the maximum", () => {
    const scores = { "openrouter:a": 4.0, "openrouter:b": 4.0, "openrouter:c": 3.5 };
    expect(computeWinnerKeys(scores).sort()).toEqual(["openrouter:a", "openrouter:b"]);
  });

  it("returns empty for empty scores", () => {
    expect(computeWinnerKeys({})).toEqual([]);
  });

  it("returns single winner when no tie", () => {
    const scores = { "a": 4.5, "b": 3.0 };
    expect(computeWinnerKeys(scores)).toEqual(["a"]);
  });
});

describe("validateProfile", () => {
  it("passes for a valid profile with criteria", () => {
    expect(validateProfile(makeProfile())).toEqual([]);
  });

  it("passes for a holistic profile (no criteria)", () => {
    expect(validateProfile(makeProfile({ criteria: [] }))).toEqual([]);
  });

  it("rejects zero total weight", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: 0 })] });
    const errors = validateProfile(profile);
    expect(errors.some((e) => e.includes("positive weight"))).toBe(true);
  });

  it("rejects missing anchor text", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { anchors: { one: "", three: "ok", five: "great" } })] });
    const errors = validateProfile(profile);
    expect(errors.some((e) => e.includes("anchors"))).toBe(true);
  });

  it("rejects negative weight", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: -1 })] });
    const errors = validateProfile(profile);
    expect(errors.some((e) => e.includes("non-negative"))).toBe(true);
  });

  it("rejects missing name", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { name: "" })] });
    const errors = validateProfile(profile);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects missing description", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { description: "" })] });
    const errors = validateProfile(profile);
    expect(errors.some((e) => e.includes("description"))).toBe(true);
  });
});

describe("normalizedWeights", () => {
  it("computes percentage shares of total weight", () => {
    const criteria = [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 2 })];
    const nw = normalizedWeights(criteria);
    // total = 3, c1 = 33.33%, c2 = 66.67%
    expect(nw.c1).toBeCloseTo(100 / 3, 5);
    expect(nw.c2).toBeCloseTo(200 / 3, 5);
  });

  it("returns 0 for all when total is zero", () => {
    const criteria = [makeCriterion("c1", { weight: 0 })];
    const nw = normalizedWeights(criteria);
    expect(nw.c1).toBe(0);
  });
});

describe("totalWeight", () => {
  it("sums non-negative weights", () => {
    expect(totalWeight([makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 2 })])).toBe(3);
  });

  it("ignores negative weights", () => {
    expect(totalWeight([makeCriterion("c1", { weight: -1 }), makeCriterion("c2", { weight: 2 })])).toBe(2);
  });
});

describe("WINNER_EPSILON", () => {
  it("is 1e-9", () => {
    expect(WINNER_EPSILON).toBe(1e-9);
  });
});
