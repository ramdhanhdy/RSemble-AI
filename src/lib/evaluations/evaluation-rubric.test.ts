// =============================================================================
// evaluation-rubric.ts — tests for anchored-rubric formatting and scoring
//
// Moved from evaluation-profile.test.ts. Scoring behavior is unchanged; the
// canonical Rubric names are exercised directly. A compatibility block at the
// end proves the legacy serialized shapes and deprecated aliases remain
// deep-equal to the canonical surface at the frozen boundaries.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  evaluationCriteriaText,
  judgeEvaluationBlock,
  canonicalScore,
  computeWinnerKeys,
  validateRubric,
  normalizedWeights,
  totalWeight,
  WINNER_EPSILON,
  formatRankValueDisplay,
  isComplianceOnlyRubric,
} from "./evaluation-rubric";
import {
  isEvaluationRubric,
  isRubricRecord,
  isRubricVersionRef,
  type EvaluationRubric,
  type RubricRecord,
  type RubricVersionRef,
  type RubricSnapshot,
  type EvaluationCriterion,
} from "./evaluation-types";
import {
  validateProfile,
  isComplianceOnlyProfile,
  type EvaluationProfile,
  type EvaluationProfileSnapshot,
  type ProfileRecord,
  type EvaluationProfileRef,
} from "./rubric-compat";

function makeCriterion(
  id: string,
  overrides: Partial<EvaluationCriterion> = {},
): EvaluationCriterion {
  return {
    id,
    name: `Criterion ${id}`,
    description: `Description for ${id}`,
    weight: 1,
    anchors: { one: "Poor", three: "Adequate", five: "Excellent" },
    kind: undefined,
    ...overrides,
  } as EvaluationCriterion;
}

function makeProfile(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
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
    const profile = makeProfile({
      criteria: [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 2 })],
    });
    const scores = { c1: 4, c2: 5 };
    // (4*1 + 5*2) / (1+2) = 14/3 ≈ 4.6667
    expect(canonicalScore(scores, profile)).toBeCloseTo(14 / 3, 10);
  });

  it("returns null when all weights are zero", () => {
    const profile = makeProfile({
      criteria: [makeCriterion("c1", { weight: 0 }), makeCriterion("c2", { weight: 0 })],
    });
    expect(canonicalScore({ c1: 4, c2: 5 }, profile)).toBeNull();
  });

  it("ignores criteria with zero weight in computation", () => {
    const profile = makeProfile({
      criteria: [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 0 })],
    });
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
    const scores = { a: 4.5, b: 3.0 };
    expect(computeWinnerKeys(scores)).toEqual(["a"]);
  });
});

describe("validateRubric", () => {
  it("passes for a valid profile with criteria", () => {
    expect(validateRubric(makeProfile())).toEqual([]);
  });

  it("passes for a holistic profile (no criteria)", () => {
    expect(validateRubric(makeProfile({ criteria: [] }))).toEqual([]);
  });

  it("rejects zero total weight", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: 0 })] });
    const errors = validateRubric(profile);
    expect(errors.some((e) => e.includes("positive weight"))).toBe(true);
  });

  it("rejects missing anchor text", () => {
    const profile = makeProfile({
      criteria: [makeCriterion("c1", { anchors: { one: "", three: "ok", five: "great" } })],
    });
    const errors = validateRubric(profile);
    expect(errors.some((e) => e.includes("anchors"))).toBe(true);
  });

  it("rejects negative weight", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { weight: -1 })] });
    const errors = validateRubric(profile);
    expect(errors.some((e) => e.includes("non-negative"))).toBe(true);
  });

  it("rejects missing name", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { name: "" })] });
    const errors = validateRubric(profile);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects missing description", () => {
    const profile = makeProfile({ criteria: [makeCriterion("c1", { description: "" })] });
    const errors = validateRubric(profile);
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
    expect(
      totalWeight([makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 2 })]),
    ).toBe(3);
  });

  it("ignores negative weights", () => {
    expect(
      totalWeight([makeCriterion("c1", { weight: -1 }), makeCriterion("c2", { weight: 2 })]),
    ).toBe(2);
  });
});

describe("WINNER_EPSILON", () => {
  it("is 1e-9", () => {
    expect(WINNER_EPSILON).toBe(1e-9);
  });
});

describe("formatRankValueDisplay — compliance-only domain (spec §16.3)", () => {
  const gradedProfile: EvaluationRubric = {
    id: "p-g",
    version: 1,
    name: "Graded",
    description: "",
    judgeInstruction: "",
    criteria: [
      {
        id: "q",
        kind: "graded" as const,
        name: "Q",
        description: "d",
        weight: 1,
        anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
      },
    ],
    requirementGroups: [],
    complianceInfluence: 1.0,
    createdAt: 100,
    updatedAt: 100,
  };
  const complianceProfile: EvaluationRubric = {
    id: "p-c",
    version: 1,
    name: "Compliance only",
    description: "",
    judgeInstruction: "",
    criteria: [
      {
        id: "b1",
        kind: "binary" as const,
        name: "B1",
        description: "d",
        trueWhen: "t",
        falseWhen: "f",
      },
    ],
    requirementGroups: [{ id: "g1", name: "G1", checkIds: ["b1"], weight: 1, mode: "ALL" }],
    complianceInfluence: 1.0,
    createdAt: 100,
    updatedAt: 100,
  };

  it("renders compliance-only C as a percentage, never a floored 1.0*/5", () => {
    // Regression (CodeRabbit 3741038006): C = 0.5 must display as 50%, NOT 1.0*/5.
    expect(formatRankValueDisplay(0.5, complianceProfile)).toBe("50%");
    expect(formatRankValueDisplay(0.5, complianceProfile)).not.toContain("*");
    expect(formatRankValueDisplay(0.5, complianceProfile)).not.toContain("/5");
    expect(formatRankValueDisplay(1.0, complianceProfile)).toBe("100%");
  });

  it("keeps the 1–5 /5 representation for graded and holistic values", () => {
    expect(formatRankValueDisplay(4.5, gradedProfile)).toBe("4.5/5");
    expect(formatRankValueDisplay(4.5, null)).toBe("4.5/5");
    expect(formatRankValueDisplay(0.5, gradedProfile)).toBe("1.0*/5"); // floored but graded domain
  });

  it("detects compliance-only profiles only when no graded criteria exist", () => {
    expect(isComplianceOnlyRubric(complianceProfile)).toBe(true);
    expect(isComplianceOnlyRubric(gradedProfile)).toBe(false);
    expect(isComplianceOnlyRubric(null)).toBe(false);
    expect(isComplianceOnlyRubric(undefined)).toBe(false);
  });
});

// --- Canonical names + legacy compatibility at frozen serialized boundaries ---

describe("canonical rubric names and legacy compatibility", () => {
  // An exact existing valid scoring object (legacy serialized shape). The
  // persisted field names (`id`, `version`, `criteria`, `requirementGroups`,
  // `complianceInfluence`, `createdAt`, `updatedAt`) are unchanged.
  const legacySerializedProfile: EvaluationProfile = {
    id: "legacy-1",
    version: 3,
    name: "Legacy Rubric",
    description: "imported v1 shape",
    judgeInstruction: "Judge fairly.",
    criteria: [
      {
        id: "c1",
        kind: "graded" as const,
        name: "Correctness",
        description: "Is it correct?",
        weight: 2,
        anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
      },
      {
        id: "b1",
        kind: "binary" as const,
        name: "Has tests",
        description: "Tests present?",
        trueWhen: "tests exist",
        falseWhen: "no tests",
      },
    ],
    requirementGroups: [{ id: "g1", name: "G1", checkIds: ["b1"], weight: 1, mode: "ALL" }],
    complianceInfluence: 0.5,
    createdAt: 1234,
    updatedAt: 5678,
  };

  const legacySerializedRecord: ProfileRecord = {
    id: "legacy-1",
    revision: 2,
    latestVersion: 3,
    createdAt: 1234,
    updatedAt: 5678,
    archivedAt: null,
  };

  const legacySerializedRef: EvaluationProfileRef = { id: "legacy-1", version: 3 };

  it("canonical guards accept the exact existing valid objects", () => {
    expect(isEvaluationRubric(legacySerializedProfile)).toBe(true);
    expect(isRubricRecord(legacySerializedRecord)).toBe(true);
    expect(isRubricVersionRef(legacySerializedRef)).toBe(true);
  });

  it("canonical validator accepts the exact existing valid object", () => {
    expect(validateRubric(legacySerializedProfile)).toEqual([]);
  });

  it("canonical and legacy type aliases are the same identity (deep-equal at frozen boundary)", () => {
    // Type aliases share structure; the same object is assignable to both and
    // deep-equals itself. This pins that no field was renamed/added/removed.
    const asCanonical: EvaluationRubric = legacySerializedProfile;
    const asSnapshot: RubricSnapshot = legacySerializedProfile;
    expect(asCanonical).toEqual(legacySerializedProfile);
    expect(asSnapshot).toEqual(legacySerializedProfile);
    const asRubricRecord: RubricRecord = legacySerializedRecord;
    expect(asRubricRecord).toEqual(legacySerializedRecord);
    const asRubricRef: RubricVersionRef = legacySerializedRef;
    expect(asRubricRef).toEqual(legacySerializedRef);
    const asRubricSnapshotAlias: EvaluationProfileSnapshot = legacySerializedProfile;
    expect(asRubricSnapshotAlias).toEqual(legacySerializedProfile);
  });

  it("legacy deprecated function aliases are the same callable as canonical", () => {
    // Aliases must be the identical function reference so behavior is identical.
    expect(validateProfile).toBe(validateRubric);
    expect(isComplianceOnlyProfile).toBe(isComplianceOnlyRubric);
    expect(validateProfile(legacySerializedProfile)).toEqual([]);
    expect(isComplianceOnlyProfile(legacySerializedProfile)).toBe(false);
  });

  it("rejects invalid objects with unchanged semantics", () => {
    // validateRubric catches authoring errors (empty name) that the structural
    // guard intentionally does not — the guard only checks shape, not content.
    const invalidNoName = { ...legacySerializedProfile, name: "" };
    expect(isEvaluationRubric(invalidNoName)).toBe(true); // empty name is still a string
    expect(validateRubric(invalidNoName as EvaluationRubric).some((e) => e.includes("name"))).toBe(
      true,
    );
    // The guard rejects structurally wrong shapes (missing required number field).
    const invalidShape = { id: "legacy-1", name: "x" } as unknown as EvaluationRubric;
    expect(isEvaluationRubric(invalidShape)).toBe(false);
    const invalidRecord = { ...legacySerializedRecord, revision: "x" as unknown as number };
    expect(isRubricRecord(invalidRecord)).toBe(false);
    const invalidRef = { id: "legacy-1" } as unknown as RubricVersionRef;
    expect(isRubricVersionRef(invalidRef)).toBe(false);
  });
});
