// =============================================================================
// RSemble AI — profile-claims.test.ts (Child 07 Task 7, RED)
//
// Deterministic evidence-grounded labels and narrative from fixed templates.
// Labels (strongest / weakest / mixed / descriptive-only / missing) are
// resolved by resolved independent unit count and a PRE-EXISTING verifier or
// Rubric semantic boundary reference + version. A raw 0–100 scale is not
// itself a threshold; no threshold is inferred from observed data or supplied
// post hoc. Fixed templates only — no model call. Every sentence binds to a
// source metric key; forbidden universal phrases/scalars never occur.
//
// Contract under test (Child 07 spec §5.4–5.5, §10, plan Task 7):
//  - strongest_supported: >=5 resolved units, eligible interval entirely
//    inside the declared supported region, no undisclosed missingness
//  - weakest_supported: >=5 resolved units, eligible interval entirely
//    inside the declared unsupported region
//  - mixed: interval crosses the semantic boundary, cohort disagreement, or
//    material failure/score heterogeneity
//  - descriptive_only: a normalized score exists but no pre-existing semantic
//    boundary is authoritative
//  - missing: fewer than the minimum resolved independent units or no eligible
//    evidence
//  - exact pre-existing verifier/Rubric boundary ref + version encoded in the
//    receipt
//  - raw 0–100 without a boundary is NOT a threshold (descriptive_only)
//  - post-hoc / data-derived thresholds are rejected (boundary must carry a
//    valid pre-existing ref + source; postHocThreshold field is ignored)
//  - small-n, cohort disagreement, verified failures, support/limitation refs
//  - forbidden universal phrases/scalars never occur in any generated sentence
//  - every generated sentence has a non-empty source metric key
//  - snapshot of the fixed-template narrative is stable
// =============================================================================

import { describe, expect, it } from "vitest";

import type { VersionRef } from "../tasks/task-types";
import {
  CLAIM_RULE_VERSION,
  FORBIDDEN_CLAIM_PHRASES,
  MIN_CLAIM_RESOLVED_UNITS,
  buildProfileClaim,
  formatBoundaryRef,
  type ClaimCohortInput,
  type ClaimEligibleInterval,
  type ClaimResult,
  type ClaimSentence,
  type SemanticBoundary,
} from "./profile-claims";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERIFIER_REF: VersionRef = { id: "ver-exact-match", version: 2 };
const RUBRIC_REF: VersionRef = { id: "rub-quality", version: 3 };

// Pass-rate boundary: supported = {1} (passed), unsupported = {0} (failed).
const PASS_BOUNDARY: SemanticBoundary = {
  source: "verifier_contract",
  ref: VERIFIER_REF,
  supportedRegion: { lower: 1, upper: 1 },
  unsupportedRegion: { lower: 0, upper: 0 },
};

// Judged-score boundary on a 0–100 scale: supported [70,100], unsupported
// [0,60]. This is a PRE-EXISTING Rubric-declared boundary, not data-derived.
const SCORE_BOUNDARY: SemanticBoundary = {
  source: "rubric_version",
  ref: RUBRIC_REF,
  supportedRegion: { lower: 70, upper: 100 },
  unsupportedRegion: { lower: 0, upper: 60 },
};

const COHORT = "verifier:exact_match:sha256:7";
const AREA = "code-transformation";

function interval(lower: number, upper: number): ClaimEligibleInterval {
  return { lower, upper };
}

function baseInput(overrides: Partial<ClaimCohortInput> = {}): ClaimCohortInput {
  return {
    metric: "pass_rate",
    cohortId: COHORT,
    areaLabel: AREA,
    pointValue: 1,
    eligibleInterval: interval(1, 1),
    resolvedUnitCount: 5,
    boundary: PASS_BOUNDARY,
    hasUndisclosedMissingness: false,
    cohortDisagreement: false,
    incompatibleCohortCount: 1,
    verifiedFailures: 0,
    verifiedTotal: 10,
    ...overrides,
  };
}

function allLabelInputs(): ClaimCohortInput[] {
  return [
    baseInput(), // strongest_supported
    baseInput({
      pointValue: 0,
      eligibleInterval: interval(0, 0),
      verifiedFailures: 10,
    }), // weakest_supported
    baseInput({ eligibleInterval: interval(0, 1) }), // mixed (crosses)
    baseInput({ cohortDisagreement: true, incompatibleCohortCount: 3 }), // mixed (disagreement)
    baseInput({ boundary: null, metric: "judged_score", pointValue: 78 }), // descriptive_only
    baseInput({ resolvedUnitCount: 4 }), // missing (small-n)
    baseInput({ pointValue: null, eligibleInterval: null, resolvedUnitCount: 0 }), // missing (no evidence)
  ];
}

// ---------------------------------------------------------------------------
// Label thresholds by resolved independent unit count
// ---------------------------------------------------------------------------

describe("buildProfileClaim — label thresholds by resolved independent units", () => {
  it("labels strongest_supported when >=5 units, interval inside supported, no missingness", () => {
    const result = buildProfileClaim(baseInput());
    expect(result.label).toBe("strongest_supported");
  });

  it("labels weakest_supported when >=5 units and interval inside unsupported", () => {
    const result = buildProfileClaim(
      baseInput({ pointValue: 0, eligibleInterval: interval(0, 0), verifiedFailures: 10 }),
    );
    expect(result.label).toBe("weakest_supported");
  });

  it("labels mixed when the eligible interval crosses the semantic boundary", () => {
    const result = buildProfileClaim(baseInput({ eligibleInterval: interval(0, 1) }));
    expect(result.label).toBe("mixed");
  });

  it("labels mixed on cohort disagreement even when the interval is inside supported", () => {
    const result = buildProfileClaim(
      baseInput({ cohortDisagreement: true, incompatibleCohortCount: 3 }),
    );
    expect(result.label).toBe("mixed");
  });

  it("labels descriptive_only when a score exists but no boundary is authoritative", () => {
    const result = buildProfileClaim(
      baseInput({ boundary: null, metric: "judged_score", pointValue: 78 }),
    );
    expect(result.label).toBe("descriptive_only");
  });

  it("labels missing below the minimum resolved independent unit count", () => {
    expect(MIN_CLAIM_RESOLVED_UNITS).toBe(5);
    const result = buildProfileClaim(baseInput({ resolvedUnitCount: 4 }));
    expect(result.label).toBe("missing");
  });

  it("labels missing when there is no eligible evidence", () => {
    const result = buildProfileClaim(
      baseInput({ pointValue: null, eligibleInterval: null, resolvedUnitCount: 0 }),
    );
    expect(result.label).toBe("missing");
  });

  it("does not label strongest when undisclosed missingness is present", () => {
    const result = buildProfileClaim(baseInput({ hasUndisclosedMissingness: true }));
    expect(result.label).not.toBe("strongest_supported");
    expect(result.label).toBe("mixed");
  });

  it("treats five units as the cutoff (4 -> missing, 5 -> eligible)", () => {
    expect(buildProfileClaim(baseInput({ resolvedUnitCount: 4 })).label).toBe("missing");
    expect(buildProfileClaim(baseInput({ resolvedUnitCount: 5 })).label).toBe("strongest_supported");
  });
});

// ---------------------------------------------------------------------------
// Pre-existing verifier / Rubric semantic boundary reference + version
// ---------------------------------------------------------------------------

describe("buildProfileClaim — pre-existing boundary reference + version", () => {
  it("encodes the verifier contract ref + version in the receipt", () => {
    const result = buildProfileClaim(baseInput({ boundary: PASS_BOUNDARY }));
    expect(result.receipt.boundaryRef).toBe("ver-exact-match@2");
    expect(result.receipt.boundarySource).toBe("verifier_contract");
  });

  it("encodes the Rubric version ref + version in the receipt", () => {
    const result = buildProfileClaim(
      baseInput({
        metric: "judged_score",
        boundary: SCORE_BOUNDARY,
        pointValue: 82,
        eligibleInterval: interval(74, 90),
      }),
    );
    expect(result.receipt.boundaryRef).toBe("rub-quality@3");
    expect(result.receipt.boundarySource).toBe("rubric_version");
    expect(result.label).toBe("strongest_supported");
  });

  it("receipt carries null boundary ref for descriptive_only", () => {
    const result = buildProfileClaim(baseInput({ boundary: null, pointValue: 78 }));
    expect(result.label).toBe("descriptive_only");
    expect(result.receipt.boundaryRef).toBeNull();
    expect(result.receipt.boundarySource).toBeNull();
  });

  it("receipt pins the claim rule version, metric, cohort, units, and interval", () => {
    const result = buildProfileClaim(baseInput({ resolvedUnitCount: 7 }));
    expect(result.receipt.claimRuleVersion).toBe(CLAIM_RULE_VERSION);
    expect(result.receipt.metric).toBe("pass_rate");
    expect(result.receipt.cohortId).toBe(COHORT);
    expect(result.receipt.resolvedUnitCount).toBe(7);
    expect(result.receipt.eligibleInterval).toEqual(interval(1, 1));
  });

  it("formatBoundaryRef renders id@version", () => {
    expect(formatBoundaryRef(VERIFIER_REF)).toBe("ver-exact-match@2");
    expect(formatBoundaryRef(RUBRIC_REF)).toBe("rub-quality@3");
  });
});

// ---------------------------------------------------------------------------
// Raw 0–100 scale is not itself a threshold
// ---------------------------------------------------------------------------

describe("buildProfileClaim — raw 0–100 without a boundary is not a threshold", () => {
  it("a high judged score with no boundary is descriptive_only, never strongest", () => {
    const result = buildProfileClaim(
      baseInput({
        metric: "judged_score",
        boundary: null,
        pointValue: 95,
        eligibleInterval: interval(90, 100),
        resolvedUnitCount: 8,
      }),
    );
    expect(result.label).toBe("descriptive_only");
    expect(result.label).not.toBe("strongest_supported");
  });

  it("a low judged score with no boundary is descriptive_only, never weakest", () => {
    const result = buildProfileClaim(
      baseInput({
        metric: "judged_score",
        boundary: null,
        pointValue: 12,
        eligibleInterval: interval(5, 20),
        resolvedUnitCount: 8,
      }),
    );
    expect(result.label).toBe("descriptive_only");
    expect(result.label).not.toBe("weakest_supported");
  });
});

// ---------------------------------------------------------------------------
// Reject post-hoc / data-derived thresholds
// ---------------------------------------------------------------------------

describe("buildProfileClaim — rejects post-hoc / data-derived thresholds", () => {
  it("ignores a postHocThreshold field and does not manufacture a label", () => {
    const without = buildProfileClaim(
      baseInput({ metric: "judged_score", boundary: null, pointValue: 78 }),
    );
    const withPostHoc = buildProfileClaim(
      baseInput({
        metric: "judged_score",
        boundary: null,
        pointValue: 78,
        postHocThreshold: 70,
      } as ClaimCohortInput),
    );
    expect(withPostHoc.label).toBe("descriptive_only");
    expect(withPostHoc.label).toBe(without.label);
  });

  it("throws when a boundary is supplied without a valid ref id", () => {
    const bad: ClaimCohortInput = baseInput({
      boundary: {
        source: "verifier_contract",
        ref: { id: "", version: 2 },
        supportedRegion: { lower: 1, upper: 1 },
        unsupportedRegion: { lower: 0, upper: 0 },
      },
    });
    expect(() => buildProfileClaim(bad)).toThrow();
  });

  it("throws when a boundary is supplied with a non-positive ref version", () => {
    const bad: ClaimCohortInput = baseInput({
      boundary: {
        source: "rubric_version",
        ref: { id: "rub-quality", version: 0 },
        supportedRegion: { lower: 70, upper: 100 },
        unsupportedRegion: { lower: 0, upper: 60 },
      },
    });
    expect(() => buildProfileClaim(bad)).toThrow();
  });

  it("throws when a boundary region is inverted (lower > upper)", () => {
    const bad: ClaimCohortInput = baseInput({
      boundary: {
        source: "verifier_contract",
        ref: VERIFIER_REF,
        supportedRegion: { lower: 1, upper: 0 },
        unsupportedRegion: { lower: 0, upper: 0 },
      },
    });
    expect(() => buildProfileClaim(bad)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Small-n, cohort disagreement, verified failures, support/limitation refs
// ---------------------------------------------------------------------------

describe("buildProfileClaim — small-n, disagreement, failures, support/limitation refs", () => {
  it("discloses insufficient coverage for small-n missing", () => {
    const result = buildProfileClaim(baseInput({ resolvedUnitCount: 3 }));
    expect(result.disclosures).toContain("small_n:3");
    const small = result.sentences.find((s) =>
      s.text.includes("Insufficient independent coverage"),
    );
    expect(small).toBeDefined();
    expect(small!.sourceMetricKey).toBe(`coverage:resolved_units:${COHORT}`);
  });

  it("discloses cohort disagreement for mixed", () => {
    const result = buildProfileClaim(
      baseInput({ cohortDisagreement: true, incompatibleCohortCount: 3 }),
    );
    expect(result.disclosures).toContain("cohort_disagreement:3");
    const mixed = result.sentences.find((s) => s.text.includes("not pooled"));
    expect(mixed).toBeDefined();
  });

  it("includes a verified-failures limitation ref for weakest_supported", () => {
    const result = buildProfileClaim(
      baseInput({
        pointValue: 0,
        eligibleInterval: interval(0, 0),
        verifiedFailures: 4,
        verifiedTotal: 10,
      }),
    );
    expect(result.label).toBe("weakest_supported");
    expect(result.disclosures).toContain("verified_failures:4/10");
    const fail = result.sentences.find((s) => s.text.includes("Failed verification"));
    expect(fail).toBeDefined();
    expect(fail!.sourceMetricKey).toBe(`pass_rate:failures:${COHORT}`);
  });

  it("includes a verified-pass support ref for strongest_supported pass_rate", () => {
    const result = buildProfileClaim(
      baseInput({ verifiedFailures: 2, verifiedTotal: 10 }),
    );
    expect(result.label).toBe("strongest_supported");
    const pass = result.sentences.find((s) => s.text.includes("Verified on 8 of 10"));
    expect(pass).toBeDefined();
    expect(pass!.sourceMetricKey).toBe(`pass_rate:verified:${COHORT}`);
  });

  it("support ref names the pre-existing boundary authority", () => {
    const result = buildProfileClaim(baseInput());
    const support = result.sentences.find((s) =>
      s.text.includes("declared by ver-exact-match@2"),
    );
    expect(support).toBeDefined();
    expect(support!.sourceMetricKey).toBe("boundary:ver-exact-match@2");
  });

  it("missing with no eligible evidence discloses no_eligible_evidence", () => {
    const result = buildProfileClaim(
      baseInput({ pointValue: null, eligibleInterval: null, resolvedUnitCount: 0 }),
    );
    expect(result.disclosures).toContain("no_eligible_evidence");
  });
});

// ---------------------------------------------------------------------------
// Forbidden universal phrases / scalars never occur
// ---------------------------------------------------------------------------

describe("buildProfileClaim — forbidden universal phrases never occur", () => {
  it("FORBIDDEN_CLAIM_PHRASES is non-empty and covers the spec §10 list", () => {
    expect(FORBIDDEN_CLAIM_PHRASES.length).toBeGreaterThan(0);
    const joined = FORBIDDEN_CLAIM_PHRASES.join("|").toLowerCase();
    for (const required of ["overall score", "best model", "good at", "n=", "reliable"]) {
      expect(joined).toContain(required);
    }
  });

  it("no generated sentence contains a forbidden phrase across every label", () => {
    for (const input of allLabelInputs()) {
      const result = buildProfileClaim(input);
      for (const sentence of result.sentences) {
        const lower = sentence.text.toLowerCase();
        for (const phrase of FORBIDDEN_CLAIM_PHRASES) {
          if (lower.includes(phrase.toLowerCase())) {
            throw new Error(
              `forbidden phrase "${phrase}" in label ${result.label}: "${sentence.text}"`,
            );
          }
        }
      }
    }
  });

  it("never emits a bare scalar headline like 'Overall score: 78'", () => {
    for (const input of allLabelInputs()) {
      const result = buildProfileClaim(input);
      for (const sentence of result.sentences) {
        expect(sentence.text).not.toMatch(/overall score\s*[:=]/i);
        expect(sentence.text).not.toMatch(/^\d+(\.\d+)?$/);
      }
    }
  });

  it("never uses attempt count as sample size (no 'n=' copy)", () => {
    for (const input of allLabelInputs()) {
      const result = buildProfileClaim(input);
      for (const sentence of result.sentences) {
        expect(sentence.text).not.toMatch(/\bn\s*=\s*\d/i);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Every sentence has a source metric key
// ---------------------------------------------------------------------------

describe("buildProfileClaim — every sentence binds to a source metric key", () => {
  it("every sentence has a non-empty sourceMetricKey matching the key grammar", () => {
    for (const input of allLabelInputs()) {
      const result = buildProfileClaim(input);
      expect(result.sentences.length).toBeGreaterThan(0);
      for (const sentence of result.sentences) {
        expect(sentence.sourceMetricKey.length).toBeGreaterThan(0);
        // key grammar: <namespace>:<...>  (e.g. boundary:ver-exact-match@2)
        expect(sentence.sourceMetricKey).toMatch(/^[a-z_]+:/);
      }
    }
  });

  it("every sentence text is non-empty and carries the cohort or boundary anchor", () => {
    for (const input of allLabelInputs()) {
      const result = buildProfileClaim(input);
      for (const sentence of result.sentences) {
        expect(sentence.text.length).toBeGreaterThan(0);
        // Each sentence references either its cohort, its boundary, or a
        // coverage/limitation anchor — never a free-floating claim.
        const anchored =
          sentence.text.includes(input.cohortId) ||
          sentence.sourceMetricKey.includes(input.cohortId) ||
          (result.receipt.boundaryRef !== null &&
            sentence.text.includes(result.receipt.boundaryRef)) ||
          sentence.sourceMetricKey.startsWith("coverage:") ||
          sentence.sourceMetricKey.startsWith("boundary:");
        expect(anchored).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism and purity
// ---------------------------------------------------------------------------

describe("buildProfileClaim — determinism and purity", () => {
  it("identical input yields identical output", () => {
    const a = buildProfileClaim(baseInput());
    const b = buildProfileClaim(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate the input", () => {
    const input = baseInput();
    const snapshot = JSON.parse(JSON.stringify(input)) as ClaimCohortInput;
    buildProfileClaim(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Snapshot of the fixed-template narrative
// ---------------------------------------------------------------------------

describe("buildProfileClaim — fixed-template narrative snapshot", () => {
  function snapshot(result: ClaimResult) {
    return {
      label: result.label,
      receipt: result.receipt,
      sentences: result.sentences.map((s: ClaimSentence) => ({
        text: s.text,
        sourceMetricKey: s.sourceMetricKey,
      })),
      disclosures: [...result.disclosures],
    };
  }

  it("strongest_supported snapshot is stable", () => {
    const result = buildProfileClaim(
      baseInput({ verifiedFailures: 2, verifiedTotal: 10 }),
    );
    expect(snapshot(result)).toMatchInlineSnapshot(`
      {
        "disclosures": [
          "verified_failures:2/10",
        ],
        "label": "strongest_supported",
        "receipt": {
          "boundaryRef": "ver-exact-match@2",
          "boundarySource": "verifier_contract",
          "claimRuleVersion": 1,
          "cohortId": "verifier:exact_match:sha256:7",
          "eligibleInterval": {
            "lower": 1,
            "upper": 1,
          },
          "metric": "pass_rate",
          "resolvedUnitCount": 5,
        },
        "sentences": [
          {
            "sourceMetricKey": "boundary:ver-exact-match@2",
            "text": "Strongest supported: the eligible pass rate interval [1, 1] lies entirely inside the supported region declared by ver-exact-match@2.",
          },
          {
            "sourceMetricKey": "pass_rate:verified:verifier:exact_match:sha256:7",
            "text": "Verified on 8 of 10 code-transformation tasks under verifier contract ver-exact-match@2.",
          },
          {
            "sourceMetricKey": "pass_rate:failures:verifier:exact_match:sha256:7",
            "text": "Limitation: 2 of 10 tasks failed verification under verifier contract ver-exact-match@2.",
          },
        ],
      }
    `);
  });

  it("weakest_supported snapshot is stable", () => {
    const result = buildProfileClaim(
      baseInput({
        pointValue: 0,
        eligibleInterval: interval(0, 0),
        verifiedFailures: 10,
        verifiedTotal: 10,
      }),
    );
    expect(result.label).toBe("weakest_supported");
    expect(result.sentences[0]!.sourceMetricKey).toBe("boundary:ver-exact-match@2");
    expect(result.disclosures).toContain("verified_failures:10/10");
  });

  it("mixed (crosses boundary) snapshot is stable", () => {
    const result = buildProfileClaim(baseInput({ eligibleInterval: interval(0, 1) }));
    expect(snapshot(result)).toMatchInlineSnapshot(`
      {
        "disclosures": [
          "boundary_crossed:0..1",
        ],
        "label": "mixed",
        "receipt": {
          "boundaryRef": "ver-exact-match@2",
          "boundarySource": "verifier_contract",
          "claimRuleVersion": 1,
          "cohortId": "verifier:exact_match:sha256:7",
          "eligibleInterval": {
            "lower": 0,
            "upper": 1,
          },
          "metric": "pass_rate",
          "resolvedUnitCount": 5,
        },
        "sentences": [
          {
            "sourceMetricKey": "boundary:ver-exact-match@2",
            "text": "Evidence is mixed: the eligible pass rate interval [0, 1] crosses the semantic boundary declared by ver-exact-match@2.",
          },
          {
            "sourceMetricKey": "boundary:ver-exact-match@2",
            "text": "Values are not pooled across the boundary.",
          },
          {
            "sourceMetricKey": "coverage:resolved_units:verifier:exact_match:sha256:7",
            "text": "Observed on 5 resolved independent units in cohort verifier:exact_match:sha256:7.",
          },
        ],
      }
    `);
  });

  it("mixed (cohort disagreement) snapshot is stable", () => {
    const result = buildProfileClaim(
      baseInput({ cohortDisagreement: true, incompatibleCohortCount: 3 }),
    );
    expect(result.label).toBe("mixed");
    expect(result.disclosures).toContain("cohort_disagreement:3");
    const notPooled = result.sentences.find((s) => s.text.includes("not pooled"));
    expect(notPooled).toBeDefined();
  });

  it("descriptive_only snapshot is stable", () => {
    const result = buildProfileClaim(
      baseInput({
        metric: "judged_score",
        boundary: null,
        pointValue: 78,
        eligibleInterval: interval(70, 86),
        resolvedUnitCount: 6,
      }),
    );
    expect(snapshot(result)).toMatchInlineSnapshot(`
      {
        "disclosures": [
          "no_pre_existing_boundary",
        ],
        "label": "descriptive_only",
        "receipt": {
          "boundaryRef": null,
          "boundarySource": null,
          "claimRuleVersion": 1,
          "cohortId": "verifier:exact_match:sha256:7",
          "eligibleInterval": {
            "lower": 70,
            "upper": 86,
          },
          "metric": "judged_score",
          "resolvedUnitCount": 6,
        },
        "sentences": [
          {
            "sourceMetricKey": "metric:judged_score:verifier:exact_match:sha256:7",
            "text": "Descriptive only: a normalized judged score of 78 exists in cohort verifier:exact_match:sha256:7, but no pre-existing semantic boundary is authoritative.",
          },
          {
            "sourceMetricKey": "boundary:none:verifier:exact_match:sha256:7",
            "text": "No threshold is inferred from observed data or supplied after observation.",
          },
          {
            "sourceMetricKey": "coverage:resolved_units:verifier:exact_match:sha256:7",
            "text": "Observed on 6 resolved independent units in cohort verifier:exact_match:sha256:7.",
          },
        ],
      }
    `);
  });

  it("missing (small-n) snapshot is stable", () => {
    const result = buildProfileClaim(baseInput({ resolvedUnitCount: 3 }));
    expect(result.label).toBe("missing");
    expect(result.disclosures).toContain("small_n:3");
    const small = result.sentences.find((s) => s.text.includes("Insufficient independent coverage"));
    expect(small).toBeDefined();
  });

  it("missing (no eligible evidence) snapshot is stable", () => {
    const result = buildProfileClaim(
      baseInput({ pointValue: null, eligibleInterval: null, resolvedUnitCount: 0 }),
    );
    expect(result.label).toBe("missing");
    expect(result.disclosures).toContain("no_eligible_evidence");
    const none = result.sentences.find((s) => s.text.includes("No eligible"));
    expect(none).toBeDefined();
  });
});
