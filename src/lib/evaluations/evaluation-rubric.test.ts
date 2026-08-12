// =============================================================================
// evaluation-rubric.ts — tests for anchored-rubric formatting and scoring
//
// Moved from evaluation-rubric.test.ts. Scoring behavior is unchanged; the
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
  qualityScore,
  rankValueFromResults,
} from "./evaluation-rubric";
import {
  isEvaluationRubric,
  isCriterionFacetMapping,
  isRubricRecord,
  isRubricVersionRef,
  type EvaluationRubric,
  type RubricRecord,
  type RubricVersionRef,
  type RubricSnapshot,
  type EvaluationCriterion,
  type CriterionFacetMapping,
} from "./evaluation-types";
import {
  validateProfile as validateRubricLegacy,
  isComplianceOnlyProfile as isComplianceOnlyRubricLegacy,
  type EvaluationProfile as EvaluationRubricLegacy,
  type EvaluationProfileSnapshot as RubricSnapshotLegacy,
  type ProfileRecord as RubricRecordLegacy,
  type EvaluationProfileRef as RubricVersionRefLegacy,
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

function makeRubric(overrides: Partial<EvaluationRubric> = {}): EvaluationRubric {
  return {
    id: "p1",
    version: 1,
    name: "Test Rubric",
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
    const rubric = makeRubric();
    const text = evaluationCriteriaText(rubric, { withIds: true });
    expect(text).toContain("[id: c1]");
    expect(text).toContain("Criterion c1");
    expect(text).toContain("Description for c1");
    expect(text).toContain("Score 1: Poor");
    expect(text).toContain("Score 3: Adequate");
    expect(text).toContain("Score 5: Excellent");
  });

  it("returns holistic message when criteria is empty", () => {
    const rubric = makeRubric({ criteria: [] });
    const text = evaluationCriteriaText(rubric);
    expect(text).toContain("no explicit criteria");
  });
});

describe("judgeEvaluationBlock", () => {
  it("includes base judge instruction from rubric", () => {
    const rubric = makeRubric({ judgeInstruction: "Be strict about evidence." });
    const block = judgeEvaluationBlock(rubric);
    expect(block).toContain("Be strict about evidence.");
    expect(block).toContain("Evaluate each candidate");
  });

  it("returns override instruction for holistic (null rubric)", () => {
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
    const rubric = makeRubric({
      criteria: [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 2 })],
    });
    const scores = { c1: 4, c2: 5 };
    // (4*1 + 5*2) / (1+2) = 14/3 ≈ 4.6667
    expect(canonicalScore(scores, rubric)).toBeCloseTo(14 / 3, 10);
  });

  it("returns null when all weights are zero", () => {
    const rubric = makeRubric({
      criteria: [makeCriterion("c1", { weight: 0 }), makeCriterion("c2", { weight: 0 })],
    });
    expect(canonicalScore({ c1: 4, c2: 5 }, rubric)).toBeNull();
  });

  it("ignores criteria with zero weight in computation", () => {
    const rubric = makeRubric({
      criteria: [makeCriterion("c1", { weight: 1 }), makeCriterion("c2", { weight: 0 })],
    });
    const scores = { c1: 3, c2: 5 };
    expect(canonicalScore(scores, rubric)).toBe(3);
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
  it("passes for a valid rubric with criteria", () => {
    expect(validateRubric(makeRubric())).toEqual([]);
  });

  it("passes for a holistic rubric (no criteria)", () => {
    expect(validateRubric(makeRubric({ criteria: [] }))).toEqual([]);
  });

  it("rejects zero total weight", () => {
    const rubric = makeRubric({ criteria: [makeCriterion("c1", { weight: 0 })] });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("positive weight"))).toBe(true);
  });

  it("rejects missing anchor text", () => {
    const rubric = makeRubric({
      criteria: [makeCriterion("c1", { anchors: { one: "", three: "ok", five: "great" } })],
    });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("anchors"))).toBe(true);
  });

  it("rejects negative weight", () => {
    const rubric = makeRubric({ criteria: [makeCriterion("c1", { weight: -1 })] });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("non-negative"))).toBe(true);
  });

  it("rejects missing name", () => {
    const rubric = makeRubric({ criteria: [makeCriterion("c1", { name: "" })] });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects missing description", () => {
    const rubric = makeRubric({ criteria: [makeCriterion("c1", { description: "" })] });
    const errors = validateRubric(rubric);
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
  const gradedRubric: EvaluationRubric = {
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
  const complianceRubric: EvaluationRubric = {
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
    expect(formatRankValueDisplay(0.5, complianceRubric)).toBe("50%");
    expect(formatRankValueDisplay(0.5, complianceRubric)).not.toContain("*");
    expect(formatRankValueDisplay(0.5, complianceRubric)).not.toContain("/5");
    expect(formatRankValueDisplay(1.0, complianceRubric)).toBe("100%");
  });

  it("keeps the 1–5 /5 representation for graded and holistic values", () => {
    expect(formatRankValueDisplay(4.5, gradedRubric)).toBe("4.5/5");
    expect(formatRankValueDisplay(4.5, null)).toBe("4.5/5");
    expect(formatRankValueDisplay(0.5, gradedRubric)).toBe("1.0*/5"); // floored but graded domain
  });

  it("detects compliance-only rubrics only when no graded criteria exist", () => {
    expect(isComplianceOnlyRubric(complianceRubric)).toBe(true);
    expect(isComplianceOnlyRubric(gradedRubric)).toBe(false);
    expect(isComplianceOnlyRubric(null)).toBe(false);
    expect(isComplianceOnlyRubric(undefined)).toBe(false);
  });
});

// --- Canonical names + legacy compatibility at frozen serialized boundaries ---

describe("canonical rubric names and legacy compatibility", () => {
  // An exact existing valid scoring object (legacy serialized shape). The
  // persisted field names (`id`, `version`, `criteria`, `requirementGroups`,
  // `complianceInfluence`, `createdAt`, `updatedAt`) are unchanged.
  const legacySerializedRubric: EvaluationRubric = {
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

  const legacySerializedRecord: RubricRecord = {
    id: "legacy-1",
    revision: 2,
    latestVersion: 3,
    createdAt: 1234,
    updatedAt: 5678,
    archivedAt: null,
  };

  const legacySerializedRef: RubricVersionRef = { id: "legacy-1", version: 3 };

  it("canonical guards accept the exact existing valid objects", () => {
    expect(isEvaluationRubric(legacySerializedRubric)).toBe(true);
    expect(isRubricRecord(legacySerializedRecord)).toBe(true);
    expect(isRubricVersionRef(legacySerializedRef)).toBe(true);
  });

  it("canonical validator accepts the exact existing valid object", () => {
    expect(validateRubric(legacySerializedRubric)).toEqual([]);
  });

  it("canonical and legacy type aliases are the same identity (deep-equal at frozen boundary)", () => {
    // Type aliases share structure; the same object is assignable to both and
    // deep-equals itself. This pins that no field was renamed/added/removed.
    const asCanonical: EvaluationRubric = legacySerializedRubric;
    const asSnapshot: RubricSnapshot = legacySerializedRubric;
    expect(asCanonical).toEqual(legacySerializedRubric);
    expect(asSnapshot).toEqual(legacySerializedRubric);
    const asRubricRecord: RubricRecord = legacySerializedRecord;
    expect(asRubricRecord).toEqual(legacySerializedRecord);
    const asRubricRef: RubricVersionRef = legacySerializedRef;
    expect(asRubricRef).toEqual(legacySerializedRef);
    const asRubricSnapshotAlias: RubricSnapshot = legacySerializedRubric;
    expect(asRubricSnapshotAlias).toEqual(legacySerializedRubric);
  });

  it("legacy deprecated aliases from rubric-compat resolve identically to canonical", () => {
    // The rubric-compat module re-exports legacy names as aliases for the
    // canonical Rubric surface. Verify they compile and deep-equal at the
    // frozen boundary so removing the compat module later is safe.
    const asLegacyProfile: EvaluationRubricLegacy = legacySerializedRubric;
    const asLegacySnapshot: RubricSnapshotLegacy = legacySerializedRubric;
    expect(asLegacyProfile).toEqual(legacySerializedRubric);
    expect(asLegacySnapshot).toEqual(legacySerializedRubric);
    const asLegacyRecord: RubricRecordLegacy = legacySerializedRecord;
    expect(asLegacyRecord).toEqual(legacySerializedRecord);
    const asLegacyRef: RubricVersionRefLegacy = legacySerializedRef;
    expect(asLegacyRef).toEqual(legacySerializedRef);
    expect(validateRubricLegacy).toBe(validateRubric);
    expect(isComplianceOnlyRubricLegacy).toBe(isComplianceOnlyRubric);
    expect(validateRubricLegacy(legacySerializedRubric)).toEqual([]);
    expect(isComplianceOnlyRubricLegacy(legacySerializedRubric)).toBe(false);
  });

  it("legacy deprecated function aliases are the same callable as canonical", () => {
    // Aliases must be the identical function reference so behavior is identical.
    expect(validateRubricLegacy).toBe(validateRubric);
    expect(isComplianceOnlyRubricLegacy).toBe(isComplianceOnlyRubric);
    expect(validateRubricLegacy(legacySerializedRubric)).toEqual([]);
    expect(isComplianceOnlyRubricLegacy(legacySerializedRubric)).toBe(false);
  });

  it("rejects invalid objects with unchanged semantics", () => {
    // validateRubric catches authoring errors (empty name) that the structural
    // guard intentionally does not — the guard only checks shape, not content.
    const invalidNoName = { ...legacySerializedRubric, name: "" };
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

// --- Criterion-to-facet mapping seam (spec §5.3) ----------------------------

describe("isCriterionFacetMapping — structural guard", () => {
  it("accepts a well-formed mapping", () => {
    expect(
      isCriterionFacetMapping({
        criterionId: "c1",
        facetId: "reasoning",
        mappingKind: "direct",
        source: "authored",
      }),
    ).toBe(true);
  });

  it("accepts both mappingKind and source variants", () => {
    for (const mappingKind of ["direct", "supporting"] as const) {
      for (const source of ["authored", "imported"] as const) {
        expect(
          isCriterionFacetMapping({ criterionId: "c1", facetId: "f", mappingKind, source }),
        ).toBe(true);
      }
    }
  });

  it("rejects missing or empty criterionId/facetId", () => {
    expect(isCriterionFacetMapping({ criterionId: "", facetId: "f", mappingKind: "direct", source: "authored" })).toBe(false);
    expect(isCriterionFacetMapping({ criterionId: "c1", facetId: "", mappingKind: "direct", source: "authored" })).toBe(false);
    expect(isCriterionFacetMapping({ facetId: "f", mappingKind: "direct", source: "authored" })).toBe(false);
  });

  it("rejects unknown mappingKind/source", () => {
    expect(isCriterionFacetMapping({ criterionId: "c1", facetId: "f", mappingKind: "gate", source: "authored" })).toBe(false);
    expect(isCriterionFacetMapping({ criterionId: "c1", facetId: "f", mappingKind: "direct", source: "inferred" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isCriterionFacetMapping(null)).toBe(false);
    expect(isCriterionFacetMapping("c1/f")).toBe(false);
    expect(isCriterionFacetMapping([])).toBe(false);
  });
});

describe("isEvaluationRubric — facetMappings validation", () => {
  const base = makeRubric();

  it("accepts a rubric with no facetMappings (unchanged)", () => {
    expect(isEvaluationRubric(base)).toBe(true);
  });

  it("accepts a rubric with valid authored facet mappings", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "reasoning", mappingKind: "direct", source: "authored" },
        { criterionId: "c2", facetId: "clarity", mappingKind: "supporting", source: "imported" },
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(true);
  });

  it("rejects a mapping whose criterionId is not in the rubric", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "nope", facetId: "f", mappingKind: "direct", source: "authored" },
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(false);
  });

  it("rejects an empty facetId", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "", mappingKind: "direct", source: "authored" },
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(false);
  });

  it("rejects duplicate (criterionId, facetId, mappingKind) tuples", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "f", mappingKind: "direct", source: "authored" },
        { criterionId: "c1", facetId: "f", mappingKind: "direct", source: "imported" },
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(false);
  });

  it("allows the same criterion+facet with different mappingKind (not a duplicate)", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "f", mappingKind: "direct", source: "authored" },
        { criterionId: "c1", facetId: "f", mappingKind: "supporting", source: "authored" },
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(true);
  });

  it("rejects secret-shaped criterionId/facetId values", () => {
    const skCriterion = makeRubric({
      facetMappings: [
        { criterionId: "sk-live123", facetId: "f", mappingKind: "direct", source: "authored" },
      ],
    });
    expect(isEvaluationRubric(skCriterion)).toBe(false);
    const bearerFacet = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "Bearer xyz", mappingKind: "direct", source: "authored" },
      ],
    });
    expect(isEvaluationRubric(bearerFacet)).toBe(false);
  });

  it("rejects prohibited keys carried on a mapping (hasProhibitedKeys recursion)", () => {
    const rubric = makeRubric({
      facetMappings: [
        {
          criterionId: "c1",
          facetId: "f",
          mappingKind: "direct",
          source: "authored",
          apiKey: "sk-...",
        } as unknown as CriterionFacetMapping,
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(false);
  });

  it("rejects non-array facetMappings", () => {
    const rubric = makeRubric({ facetMappings: {} as unknown as CriterionFacetMapping[] });
    expect(isEvaluationRubric(rubric)).toBe(false);
  });

  it("rejects a structurally malformed mapping entry", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "f", mappingKind: "gate", source: "authored" } as unknown as CriterionFacetMapping,
      ],
    });
    expect(isEvaluationRubric(rubric)).toBe(false);
  });
});

describe("validateRubric — facetMappings authoring errors", () => {
  it("adds no errors for valid mappings", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "reasoning", mappingKind: "direct", source: "authored" },
      ],
    });
    expect(validateRubric(rubric)).toEqual([]);
  });

  it("reports a missing criterion", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "nope", facetId: "f", mappingKind: "direct", source: "authored" },
      ],
    });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("not in this rubric"))).toBe(true);
  });

  it("reports an empty facetId", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "", mappingKind: "direct", source: "authored" },
      ],
    });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("non-empty"))).toBe(true);
  });

  it("reports a duplicate mapping", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "c1", facetId: "f", mappingKind: "direct", source: "authored" },
        { criterionId: "c1", facetId: "f", mappingKind: "direct", source: "imported" },
      ],
    });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("duplicate mapping"))).toBe(true);
  });

  it("reports secret-shaped identifiers", () => {
    const rubric = makeRubric({
      facetMappings: [
        { criterionId: "sk-live123", facetId: "f", mappingKind: "direct", source: "authored" },
      ],
    });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("credentials"))).toBe(true);
  });

  it("reports a non-array facetMappings", () => {
    const rubric = makeRubric({ facetMappings: {} as unknown as CriterionFacetMapping[] });
    const errors = validateRubric(rubric);
    expect(errors.some((e) => e.includes("must be an array"))).toBe(true);
  });

  it("preserves current validation semantics (no facetMappings ⇒ no new errors)", () => {
    const rubric = makeRubric();
    expect(validateRubric(rubric)).toEqual([]);
  });
});

describe("facetMappings do not change scoring outputs (spec §5.3)", () => {
  // The mapping seam is disclosed evidence metadata only. Scoring math must
  // be byte-for-byte identical with and without facetMappings on the same
  // criteria/anchors/groups.
  const criterionScores: Record<string, number> = { c1: 4, c2: 2 };

  const withoutMappings = makeRubric();
  const withMappings = makeRubric({
    facetMappings: [
      { criterionId: "c1", facetId: "reasoning", mappingKind: "direct", source: "authored" },
      { criterionId: "c2", facetId: "clarity", mappingKind: "supporting", source: "imported" },
    ],
  });

  it("qualityScore is identical with and without mappings", () => {
    expect(qualityScore(criterionScores, withMappings)).toEqual(
      qualityScore(criterionScores, withoutMappings),
    );
  });

  it("canonicalScore is identical with and without mappings", () => {
    expect(canonicalScore(criterionScores, withMappings)).toEqual(
      canonicalScore(criterionScores, withoutMappings),
    );
  });

  it("rankValueFromResults is identical with and without mappings", () => {
    const results = [
      { criterionId: "c1", score: 4 },
      { criterionId: "c2", score: 2 },
    ];
    expect(rankValueFromResults(results, withMappings)).toEqual(
      rankValueFromResults(results, withoutMappings),
    );
  });

  it("judgeEvaluationBlock is identical with and without mappings (criteria text unaffected)", () => {
    expect(judgeEvaluationBlock(withMappings)).toBe(judgeEvaluationBlock(withoutMappings));
  });
});
