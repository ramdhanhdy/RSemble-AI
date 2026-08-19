// =============================================================================
// RSemble AI — model-evidence-query.test.ts (Child 07 Task 1, RED → GREEN)
//
// Query-contract tests for the discriminated ModelEvidenceQuery: runtime
// validation, canonical ordering, deterministic canonical serialization,
// deterministic query fingerprint, resolved-respondent receipt/manifest, and
// the URL-state codec.
//
// Contract under test (Child 07 spec §3, plan Task 1):
//  - Discriminated respondent: exact model configuration OR pinned Model Rollup
//    version with `stratified_only`. No nullable model/rollup ambiguity.
//  - Runtime validation, canonical ordering, deterministic canonical
//    serialization, deterministic query fingerprint.
//  - Resolved respondent receipt/manifest; deterministic URL-state codec.
//  - Required rule/version pins; unsupported/unknown rule versions fail safe.
//  - Equivalent permutations fingerprint identically; materially different
//    semantic queries fingerprint differently.
//  - No credential/auth/environment material; no implicit exact-configuration
//    merging; no unversioned rollup respondent.
// =============================================================================

import { describe, expect, it } from "vitest";

import { MILESTONE_A_GOLDEN } from "./__fixtures__/milestone-a-golden";

import {
  QUERY_AGGREGATION_RULE_VERSION,
  QUERY_ELIGIBILITY_RULE_VERSION,
  QUERY_UNCERTAINTY_RULE_VERSION,
  SUPPORTED_QUERY_RULE_VERSIONS,
  canonicalModelEvidenceQueryJson,
  canonicalizeModelEvidenceQuery,
  decodeModelEvidenceQueryFromUrl,
  encodeModelEvidenceQueryToUrl,
  fingerprintModelEvidenceQuery,
  isModelEvidenceQuery,
  isProfileRespondent,
  serializeModelEvidenceQuery,
  validateModelEvidenceQuery,
  type EvaluatorFilter,
  type FacetFilter,
  type ModelEvidenceQuery,
  type ProfileRespondent,
  type ResolvedRollupManifest,
  type RollupVersionResolver,
} from "./model-evidence-query";

// --- Fixtures ------------------------------------------------------------------

const EXACT_ALPHA_ID = MILESTONE_A_GOLDEN.configurations.exactAlpha.id;
const EXACT_BETA_ID = MILESTONE_A_GOLDEN.configurations.exactBeta.id;
const ROLLING_ALPHA_ID = MILESTONE_A_GOLDEN.configurations.rollingAlpha.id;

const COHORT_A = `sha256:${"a".repeat(64)}`;
const COHORT_B = `sha256:${"b".repeat(64)}`;
const RUBRIC_QUALITY = { id: "rub-quality", version: 3 };
const RUBRIC_STYLE = { id: "rub-style", version: 1 };

const FACET_LANG: FacetFilter = { facetId: "facet-lang", valueIds: ["lang-py", "lang-ts"] };
const FACET_DOMAIN: FacetFilter = { facetId: "facet-domain", valueIds: ["dom-code"] };

const EVAL_JUDGE: EvaluatorFilter = {
  evaluatorKind: "model_judge",
  providerId: "openrouter",
  model: "org/judge",
  instructionDigest: null,
};
const EVAL_HUMAN: EvaluatorFilter = {
  evaluatorKind: "human_authorized",
  providerId: "local",
  model: "human-reviewer",
  instructionDigest: null,
};

function baseQuery(overrides: Partial<ModelEvidenceQuery> = {}): ModelEvidenceQuery {
  return {
    respondent: { kind: "model_configuration", modelConfigurationId: EXACT_ALPHA_ID },
    observedFrom: null,
    observedTo: null,
    taskFamilyIds: [],
    facetFilters: [],
    evidenceClasses: ["comparable", "exploratory"],
    allowedUses: ["within_model_profile", "task_descriptive"],
    comparabilityCohortIds: [],
    sourceKinds: ["comparison", "evaluation"],
    rubricRefs: [],
    evaluatorFilters: [],
    includeUnknownVersion: false,
    eligibilityRuleVersion: QUERY_ELIGIBILITY_RULE_VERSION,
    aggregationRuleVersion: QUERY_AGGREGATION_RULE_VERSION,
    uncertaintyRuleVersion: QUERY_UNCERTAINTY_RULE_VERSION,
    ...overrides,
  };
}

const ROLLUP_MANIFEST_A: ResolvedRollupManifest = {
  rollupId: "rollup-alpha-beta",
  version: 2,
  aggregationPolicy: "stratified_only",
  name: "Alpha + Beta stratified",
  memberConfigurationIds: [EXACT_ALPHA_ID, EXACT_BETA_ID],
  createdAt: 1_704_067_200_000,
};

const rollupResolver: RollupVersionResolver = (rollupId, version) => {
  if (rollupId === ROLLUP_MANIFEST_A.rollupId && version === ROLLUP_MANIFEST_A.version) {
    return {
      ...ROLLUP_MANIFEST_A,
      memberConfigurationIds: [...ROLLUP_MANIFEST_A.memberConfigurationIds],
    };
  }
  return null;
};

// --- Discriminated respondent --------------------------------------------------

describe("ProfileRespondent — discriminated respondent", () => {
  it("accepts an exact model-configuration respondent", () => {
    const r: ProfileRespondent = { kind: "model_configuration", modelConfigurationId: EXACT_ALPHA_ID };
    expect(isProfileRespondent(r)).toBe(true);
  });

  it("accepts a pinned stratified_only rollup respondent", () => {
    const r: ProfileRespondent = {
      kind: "model_rollup",
      rollupId: "rollup-alpha-beta",
      version: 2,
      aggregationPolicy: "stratified_only",
    };
    expect(isProfileRespondent(r)).toBe(true);
  });

  it("rejects a respondent carrying both model and rollup fields (ambiguous)", () => {
    const ambiguous = {
      kind: "model_configuration",
      modelConfigurationId: EXACT_ALPHA_ID,
      rollupId: "rollup-x",
      version: 1,
      aggregationPolicy: "stratified_only",
    };
    expect(isProfileRespondent(ambiguous)).toBe(false);
  });

  it("rejects a respondent with neither model nor rollup identity", () => {
    const empty = { kind: "model_configuration" };
    expect(isProfileRespondent(empty)).toBe(false);
  });

  it("rejects a rollup respondent missing the version pin (unversioned)", () => {
    expect(isProfileRespondent({ kind: "model_rollup", rollupId: "r", aggregationPolicy: "stratified_only" })).toBe(false);
  });

  it("rejects a rollup respondent with a non-stratified_only policy", () => {
    expect(
      isProfileRespondent({
        kind: "model_rollup",
        rollupId: "r",
        version: 1,
        aggregationPolicy: "pooled",
      }),
    ).toBe(false);
  });

  it("rejects a rollup respondent with a zero or non-integer version", () => {
    expect(
      isProfileRespondent({ kind: "model_rollup", rollupId: "r", version: 0, aggregationPolicy: "stratified_only" }),
    ).toBe(false);
    expect(
      isProfileRespondent({
        kind: "model_rollup",
        rollupId: "r",
        version: 1.5,
        aggregationPolicy: "stratified_only",
      }),
    ).toBe(false);
  });

  it("rejects an unknown respondent kind", () => {
    expect(isProfileRespondent({ kind: "workflow", workflowId: "w" })).toBe(false);
  });
});

// --- Runtime validation --------------------------------------------------------

describe("validateModelEvidenceQuery — runtime validation", () => {
  it("accepts a well-formed exact-configuration query", () => {
    const result = validateModelEvidenceQuery(baseQuery());
    expect(result.ok).toBe(true);
  });

  it("accepts a well-formed rollup query when the resolver resolves the manifest", () => {
    const query = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST_A.rollupId,
        version: ROLLUP_MANIFEST_A.version,
        aggregationPolicy: "stratified_only",
      },
    });
    const result = validateModelEvidenceQuery(query, rollupResolver);
    expect(result.ok).toBe(true);
  });

  it("rejects a rollup query when no resolver is supplied", () => {
    const query = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST_A.rollupId,
        version: ROLLUP_MANIFEST_A.version,
        aggregationPolicy: "stratified_only",
      },
    });
    const result = validateModelEvidenceQuery(query);
    expect(result.ok).toBe(false);
  });

  it("rejects a rollup query whose version does not resolve", () => {
    const query = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST_A.rollupId,
        version: 999,
        aggregationPolicy: "stratified_only",
      },
    });
    const result = validateModelEvidenceQuery(query, rollupResolver);
    expect(result.ok).toBe(false);
  });

  it("rejects an exact-configuration id that is not a canonical mc id", () => {
    const result = validateModelEvidenceQuery(
      baseQuery({
        respondent: { kind: "model_configuration", modelConfigurationId: "not-a-mc-id" },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an inverted observation window (from > to)", () => {
    const result = validateModelEvidenceQuery(
      baseQuery({ observedFrom: 200, observedTo: 100 }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects negative observation windows", () => {
    expect(validateModelEvidenceQuery(baseQuery({ observedFrom: -1 })).ok).toBe(false);
    expect(validateModelEvidenceQuery(baseQuery({ observedTo: -1 })).ok).toBe(false);
  });

  it("rejects unknown evidence classes and uses", () => {
    expect(
      validateModelEvidenceQuery(
        baseQuery({ evidenceClasses: ["comparable", "bogus" as never] }),
      ).ok,
    ).toBe(false);
    expect(
      validateModelEvidenceQuery(baseQuery({ allowedUses: ["bogus" as never] })).ok,
    ).toBe(false);
  });

  it("rejects unknown source kinds", () => {
    expect(
      validateModelEvidenceQuery(baseQuery({ sourceKinds: ["bogus" as never] })).ok,
    ).toBe(false);
  });

  it("rejects malformed comparability cohort ids", () => {
    expect(
      validateModelEvidenceQuery(baseQuery({ comparabilityCohortIds: ["not-a-sha"] })).ok,
    ).toBe(false);
  });

  it("rejects malformed rubric refs", () => {
    expect(
      validateModelEvidenceQuery(
        baseQuery({ rubricRefs: [{ id: "rub-1", version: 0 }] }),
      ).ok,
    ).toBe(false);
    expect(
      validateModelEvidenceQuery(baseQuery({ rubricRefs: [{ id: "", version: 1 }] })).ok,
    ).toBe(false);
  });

  it("rejects malformed facet filters", () => {
    expect(
      validateModelEvidenceQuery(
        baseQuery({ facetFilters: [{ facetId: "", valueIds: ["v1"] }] }),
      ).ok,
    ).toBe(false);
    expect(
      validateModelEvidenceQuery(
        baseQuery({ facetFilters: [{ facetId: "f1", valueIds: [""] }] }),
      ).ok,
    ).toBe(false);
  });

  it("rejects malformed evaluator filters", () => {
    expect(
      validateModelEvidenceQuery(
        baseQuery({
          evaluatorFilters: [
            { evaluatorKind: "bogus" as never, providerId: null, model: null, instructionDigest: null },
          ],
        }),
      ).ok,
    ).toBe(false);
  });

  it("rejects a non-boolean includeUnknownVersion", () => {
    expect(
      validateModelEvidenceQuery(baseQuery({ includeUnknownVersion: "yes" as unknown as boolean })).ok,
    ).toBe(false);
  });

  it("rejects missing rule-version pins", () => {
    const { eligibilityRuleVersion: _drop, ...missingElig } = baseQuery();
    expect(validateModelEvidenceQuery(missingElig as ModelEvidenceQuery).ok).toBe(false);
  });

  it("rejects zero / non-integer rule versions", () => {
    expect(
      validateModelEvidenceQuery(baseQuery({ eligibilityRuleVersion: 0 })).ok,
    ).toBe(false);
    expect(
      validateModelEvidenceQuery(baseQuery({ aggregationRuleVersion: 1.5 })).ok,
    ).toBe(false);
  });

  it("rejects unsupported (unknown) rule versions safely", () => {
    const futureElig = QUERY_ELIGIBILITY_RULE_VERSION + 999;
    const result = validateModelEvidenceQuery(baseQuery({ eligibilityRuleVersion: futureElig }));
    expect(result.ok).toBe(false);
  });

  it("rejects credential / auth / environment material anywhere in the query", () => {
    const withSecret = {
      ...baseQuery(),
      apiKey: "sk-leak",
    };
    expect(validateModelEvidenceQuery(withSecret as unknown as ModelEvidenceQuery).ok).toBe(false);
  });

  it("isModelEvidenceQuery agrees with validateModelEvidenceQuery for a valid query", () => {
    expect(isModelEvidenceQuery(baseQuery())).toBe(true);
    expect(
      isModelEvidenceQuery({ ...baseQuery(), eligibilityRuleVersion: 0 }),
    ).toBe(false);
  });
});

// --- Canonical ordering & deterministic fingerprint ----------------------------

describe("canonical serialization & fingerprint", () => {
  it("produces identical canonical JSON for equivalent permutations of set-like filters", () => {
    const a = baseQuery({
      taskFamilyIds: ["fam-b", "fam-a"],
      evidenceClasses: ["exploratory", "comparable"],
      allowedUses: ["task_descriptive", "within_model_profile"],
      comparabilityCohortIds: [COHORT_B, COHORT_A],
      sourceKinds: ["evaluation", "comparison"],
      rubricRefs: [RUBRIC_STYLE, RUBRIC_QUALITY],
      facetFilters: [FACET_DOMAIN, FACET_LANG],
      evaluatorFilters: [EVAL_HUMAN, EVAL_JUDGE],
    });
    const b = baseQuery({
      taskFamilyIds: ["fam-a", "fam-b"],
      evidenceClasses: ["comparable", "exploratory"],
      allowedUses: ["within_model_profile", "task_descriptive"],
      comparabilityCohortIds: [COHORT_A, COHORT_B],
      sourceKinds: ["comparison", "evaluation"],
      rubricRefs: [RUBRIC_QUALITY, RUBRIC_STYLE],
      facetFilters: [FACET_LANG, FACET_DOMAIN],
      evaluatorFilters: [EVAL_JUDGE, EVAL_HUMAN],
    });
    expect(canonicalModelEvidenceQueryJson(a)).toBe(canonicalModelEvidenceQueryJson(b));
    expect(fingerprintModelEvidenceQuery(a)).toBe(fingerprintModelEvidenceQuery(b));
  });

  it("produces a sha256:<hex> fingerprint of canonical shape", () => {
    const fp = fingerprintModelEvidenceQuery(baseQuery());
    expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("fingerprints materially different semantic queries differently", () => {
    const q1 = baseQuery({ respondent: { kind: "model_configuration", modelConfigurationId: EXACT_ALPHA_ID } });
    const q2 = baseQuery({ respondent: { kind: "model_configuration", modelConfigurationId: EXACT_BETA_ID } });
    expect(fingerprintModelEvidenceQuery(q1)).not.toBe(fingerprintModelEvidenceQuery(q2));

    const q3 = baseQuery({ observedFrom: 100, observedTo: 200 });
    const q4 = baseQuery({ observedFrom: 100, observedTo: 300 });
    expect(fingerprintModelEvidenceQuery(q3)).not.toBe(fingerprintModelEvidenceQuery(q4));

    const q5 = baseQuery({ includeUnknownVersion: false });
    const q6 = baseQuery({ includeUnknownVersion: true });
    expect(fingerprintModelEvidenceQuery(q5)).not.toBe(fingerprintModelEvidenceQuery(q6));

    // Rule-version pins are part of the canonical fingerprint input. Only
 // version 1 of each rule is supported today, so two valid queries cannot
 // differ on a rule version alone (an unsupported version is rejected —
 // covered below). Assert the pins are encoded in the canonical JSON so a
 // future supported bump is guaranteed to change the fingerprint.
 const q7 = baseQuery();
 const json = canonicalModelEvidenceQueryJson(q7);
 expect(json).toContain('"aggregationRuleVersion":1');
 expect(json).toContain('"eligibilityRuleVersion":1');
 expect(json).toContain('"uncertaintyRuleVersion":1');
  });

  it("fingerprints an exact-configuration and a rollup respondent differently", () => {
    const exact = baseQuery();
    const rollup = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST_A.rollupId,
        version: ROLLUP_MANIFEST_A.version,
        aggregationPolicy: "stratified_only",
      },
    });
    expect(fingerprintModelEvidenceQuery(exact)).not.toBe(
      fingerprintModelEvidenceQuery(rollup, rollupResolver),
    );
  });

  it("canonicalizeModelEvidenceQuery returns a query with canonically ordered arrays", () => {
    const canon = canonicalizeModelEvidenceQuery(
      baseQuery({
        taskFamilyIds: ["fam-b", "fam-a"],
        evidenceClasses: ["exploratory", "comparable"],
        rubricRefs: [RUBRIC_STYLE, RUBRIC_QUALITY],
      }),
    );
    expect(canon.taskFamilyIds).toEqual(["fam-a", "fam-b"]);
    expect(canon.evidenceClasses).toEqual(["comparable", "exploratory"]);
    expect(canon.rubricRefs).toEqual([RUBRIC_QUALITY, RUBRIC_STYLE]);
  });

  it("throws on invalid input when serializing/fingerprinting", () => {
    expect(() => canonicalModelEvidenceQueryJson({ ...baseQuery(), eligibilityRuleVersion: 0 })).toThrow();
    expect(() => fingerprintModelEvidenceQuery({ ...baseQuery(), eligibilityRuleVersion: 0 })).toThrow();
  });
});

// --- Resolved respondent receipt / manifest ------------------------------------

describe("serializeModelEvidenceQuery — receipt & resolved manifest", () => {
  it("produces a receipt with fingerprint, abbreviation, manifest, and active filters for an exact respondent", () => {
    const now = 1_710_000_000_000;
    const receipt = serializeModelEvidenceQuery(baseQuery(), undefined, now);
    expect(receipt.fingerprint).toBe(fingerprintModelEvidenceQuery(baseQuery()));
    expect(receipt.fingerprintAbbreviation).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(receipt.generatedAt).toBe(now);
    expect(receipt.observedFrom).toBeNull();
    expect(receipt.observedTo).toBeNull();
    expect(receipt.resolvedRespondent).toEqual({
      kind: "model_configuration",
      modelConfigurationId: EXACT_ALPHA_ID,
    });
    expect(receipt.canonicalSerialization).toBe(canonicalModelEvidenceQueryJson(baseQuery()));
  });

  it("resolves a rollup respondent to its immutable member manifest in the receipt", () => {
    const query = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST_A.rollupId,
        version: ROLLUP_MANIFEST_A.version,
        aggregationPolicy: "stratified_only",
      },
    });
    const receipt = serializeModelEvidenceQuery(query, rollupResolver, 123);
    expect(receipt.resolvedRespondent.kind).toBe("model_rollup");
    if (receipt.resolvedRespondent.kind !== "model_rollup") throw new Error("unreachable");
    expect(receipt.resolvedRespondent.manifest.memberConfigurationIds).toEqual(
      [EXACT_ALPHA_ID, EXACT_BETA_ID],
    );
    expect(receipt.resolvedRespondent.manifest.aggregationPolicy).toBe("stratified_only");
    expect(receipt.resolvedRespondent.manifest.version).toBe(ROLLUP_MANIFEST_A.version);
  });

  it("does not fold generatedAt into the fingerprint (reproducible across time)", () => {
    const q = baseQuery();
    const r1 = serializeModelEvidenceQuery(q, undefined, 100);
    const r2 = serializeModelEvidenceQuery(q, undefined, 9_999);
    expect(r1.fingerprint).toBe(r2.fingerprint);
    expect(r1.generatedAt).not.toBe(r2.generatedAt);
  });

  it("activeFilters summarizes non-empty filters", () => {
    const q = baseQuery({
      taskFamilyIds: ["fam-a"],
      evidenceClasses: ["comparable"],
      comparabilityCohortIds: [COHORT_A],
      includeUnknownVersion: true,
    });
    const receipt = serializeModelEvidenceQuery(q);
    expect(receipt.activeFilters.taskFamilyIds).toEqual(["fam-a"]);
    expect(receipt.activeFilters.evidenceClasses).toEqual(["comparable"]);
    expect(receipt.activeFilters.comparabilityCohortIds).toEqual([COHORT_A]);
    expect(receipt.activeFilters.includeUnknownVersion).toBe(true);
  });

  it("throws when a rollup respondent cannot be resolved", () => {
    const query = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: "rollup-missing",
        version: 1,
        aggregationPolicy: "stratified_only",
      },
    });
    expect(() => serializeModelEvidenceQuery(query, rollupResolver, 1)).toThrow();
  });
});

// --- URL-state codec -----------------------------------------------------------

describe("URL-state codec", () => {
  it("round-trips an exact-configuration query with full filters", () => {
    const q = baseQuery({
      observedFrom: 100,
      observedTo: 200,
      taskFamilyIds: ["fam-a", "fam-b"],
      facetFilters: [FACET_LANG, FACET_DOMAIN],
      evidenceClasses: ["comparable", "verified"],
      allowedUses: ["within_model_profile", "paired_model_comparison"],
      comparabilityCohortIds: [COHORT_A, COHORT_B],
      sourceKinds: ["comparison"],
      rubricRefs: [RUBRIC_QUALITY, RUBRIC_STYLE],
      evaluatorFilters: [EVAL_JUDGE, EVAL_HUMAN],
      includeUnknownVersion: true,
    });
    const params = encodeModelEvidenceQueryToUrl(q);
    const decoded = decodeModelEvidenceQueryFromUrl(params);
    expect(decoded).toEqual(canonicalizeModelEvidenceQuery(q));
  });

  it("round-trips a rollup respondent", () => {
    const q = baseQuery({
      respondent: {
        kind: "model_rollup",
        rollupId: ROLLUP_MANIFEST_A.rollupId,
        version: ROLLUP_MANIFEST_A.version,
        aggregationPolicy: "stratified_only",
      },
    });
    const decoded = decodeModelEvidenceQueryFromUrl(encodeModelEvidenceQueryToUrl(q));
    expect(decoded).toEqual(canonicalizeModelEvidenceQuery(q));
  });

  it("round-trips a rolling-alias respondent with empty filters", () => {
    const q = baseQuery({
      respondent: { kind: "model_configuration", modelConfigurationId: ROLLING_ALPHA_ID },
      evidenceClasses: [],
      allowedUses: [],
      sourceKinds: [],
    });
    const decoded = decodeModelEvidenceQueryFromUrl(encodeModelEvidenceQueryToUrl(q));
    expect(decoded).toEqual(canonicalizeModelEvidenceQuery(q));
  });

  it("produces a deterministic param string (sorted keys) for equivalent permutations", () => {
    const a = baseQuery({ taskFamilyIds: ["fam-b", "fam-a"], comparabilityCohortIds: [COHORT_B, COHORT_A] });
    const b = baseQuery({ taskFamilyIds: ["fam-a", "fam-b"], comparabilityCohortIds: [COHORT_A, COHORT_B] });
    expect(encodeModelEvidenceQueryToUrl(a).toString()).toBe(encodeModelEvidenceQueryToUrl(b).toString());
  });

  it("rejects an unsupported rule version on decode", () => {
    const params = encodeModelEvidenceQueryToUrl(baseQuery());
    params.set("q.eligibilityRuleVersion", String(QUERY_ELIGIBILITY_RULE_VERSION + 999));
    expect(() => decodeModelEvidenceQueryFromUrl(params)).toThrow();
  });

  it("rejects an ambiguous respondent on decode", () => {
    const params = encodeModelEvidenceQueryToUrl(baseQuery());
    params.set("q.respondent.rollupId", "rollup-x");
    params.set("q.respondent.version", "1");
    params.set("q.respondent.aggregationPolicy", "stratified_only");
    expect(() => decodeModelEvidenceQueryFromUrl(params)).toThrow();
  });
});

// --- No implicit exact-configuration merging ----------------------------------

describe("single-respondent invariant", () => {
  it("a query has exactly one respondent (no array / merge of configurations)", () => {
    const q = baseQuery();
    expect(typeof q.respondent).toBe("object");
    expect(Array.isArray(q.respondent)).toBe(false);
  });

  it("two distinct exact configurations produce distinct fingerprints (no silent merge)", () => {
    const a = baseQuery({ respondent: { kind: "model_configuration", modelConfigurationId: EXACT_ALPHA_ID } });
    const b = baseQuery({ respondent: { kind: "model_configuration", modelConfigurationId: EXACT_BETA_ID } });
    expect(fingerprintModelEvidenceQuery(a)).not.toBe(fingerprintModelEvidenceQuery(b));
  });
});

// --- Supported rule versions ---------------------------------------------------

describe("SUPPORTED_QUERY_RULE_VERSIONS", () => {
  it("exposes the three pinned current rule versions", () => {
    expect(SUPPORTED_QUERY_RULE_VERSIONS.eligibility).toContain(QUERY_ELIGIBILITY_RULE_VERSION);
    expect(SUPPORTED_QUERY_RULE_VERSIONS.aggregation).toContain(QUERY_AGGREGATION_RULE_VERSION);
    expect(SUPPORTED_QUERY_RULE_VERSIONS.uncertainty).toContain(QUERY_UNCERTAINTY_RULE_VERSION);
  });
});
