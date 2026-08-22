// =============================================================================
// RSemble AI — profile-claims.ts (Child 07 Task 7, GREEN)
//
// Deterministic evidence-grounded labels and narrative from fixed templates.
// Consumes the per-cohort facts that T4 (aggregation), T5 (uncertainty units
// + bootstrap interval), and T3 (coverage) already produced — it performs no
// new aggregation, no new math, and no model call. Labels are resolved purely
// from the resolved independent unit count and a PRE-EXISTING verifier or
// Rubric semantic boundary reference + version supplied as input.
//
// Contract (Child 07 spec §5.4–5.5, §10, plan Task 7):
//  - strongest_supported: >=5 resolved independent units, eligible interval
//    entirely inside the declared supported region, no undisclosed missingness.
//  - weakest_supported: >=5 resolved independent units, eligible interval
//    entirely inside the declared unsupported region.
//  - mixed: interval crosses the semantic boundary, cohort disagreement, or
//    material failure/score heterogeneity (incl. undisclosed missingness).
//  - descriptive_only: a normalized score exists but no pre-existing semantic
//    boundary is authoritative.
//  - missing: fewer than the minimum resolved independent units or no eligible
//    evidence.
//  - The exact verifier/Rubric boundary reference + version are displayed and
//    encoded in the receipt. A raw 0–100 scale is not itself a threshold; no
//    threshold is inferred from observed data or supplied post hoc.
//  - Fixed templates only. Every sentence binds to a source metric key.
//  - Forbidden universal phrases/scalars (spec §10) never occur.
//
// This module is pure and side-effect free. It does not implement aggregation,
// bootstrap, paired comparison, cache, UI, or a rollup store.
// =============================================================================

import type { VersionRef } from "../tasks/task-types";

// --- Rule version ---------------------------------------------------------------

/**
 * Claim/narrative rule version. Bump only with a new authorized template or
 * labeling rule set. Pinned into every claim receipt so a generated label is
 * reproducible alongside the aggregation/uncertainty rule versions.
 */
export const CLAIM_RULE_VERSION = 1;

/**
 * Minimum resolved independent uncertainty units required before a supported /
 * unsupported label is permitted (spec §5.4). Below this the label is
 * `missing` regardless of the observed interval.
 */
export const MIN_CLAIM_RESOLVED_UNITS = 5;

// --- Labels ---------------------------------------------------------------------

export type ClaimLabel =
  "strongest_supported" | "weakest_supported" | "mixed" | "descriptive_only" | "missing";

export type ClaimMetricKind = "judged_score" | "pass_rate";

export type BoundarySource = "verifier_contract" | "rubric_version";

// --- Pre-existing semantic boundary --------------------------------------------

/**
 * A semantic supported/unsupported boundary declared by an authoritative
 * verifier contract or Rubric version BEFORE observing these results. The
 * regions are expressed on the metric's native scale (pass_rate on [0,1];
 * judged_score on [0,100]). This MUST be supplied as input — it is never
 * derived from observed data and never invented here.
 */
export interface SemanticBoundary {
  readonly source: BoundarySource;
  readonly ref: VersionRef;
  readonly supportedRegion: { readonly lower: number; readonly upper: number };
  readonly unsupportedRegion: { readonly lower: number; readonly upper: number };
}

// --- Eligible interval ----------------------------------------------------------

export interface ClaimEligibleInterval {
  readonly lower: number;
  readonly upper: number;
}

// --- Input ----------------------------------------------------------------------

/**
 * Per-cohort facts consumed by the claim generator. All quantities are
 * produced upstream (T3/T4/T5); this module performs no new math.
 *
 * `postHocThreshold` is accepted but NEVER read — supplying a data-derived or
 * after-the-fact threshold cannot manufacture a label.
 */
export interface ClaimCohortInput {
  readonly metric: ClaimMetricKind;
  readonly cohortId: string;
  /** Human-readable area label (e.g. "code-transformation") for copy. */
  readonly areaLabel: string;
  /** Aggregated point value on the metric's native scale, or null when no
   *  eligible evidence exists. */
  readonly pointValue: number | null;
  /** Bootstrap eligible interval, or null when below the minimum unit count. */
  readonly eligibleInterval: ClaimEligibleInterval | null;
  /** Resolved independent uncertainty unit count for this cohort (T5). */
  readonly resolvedUnitCount: number;
  /** Pre-existing semantic boundary, or null when none is authoritative. */
  readonly boundary: SemanticBoundary | null;
  /** True when material missingness was not disclosed upstream. */
  readonly hasUndisclosedMissingness: boolean;
  /** True when incompatible cohorts disagree and must not be pooled. */
  readonly cohortDisagreement: boolean;
  /** Number of incompatible cohorts present (used in mixed copy). */
  readonly incompatibleCohortCount: number;
  /** Verified-failure count (pass_rate failures, or tasks in the unsupported
   *  region for judged_score) for limitation refs. */
  readonly verifiedFailures: number;
  /** Total verified tasks in this cohort for "Verified on X of Y" copy. */
  readonly verifiedTotal: number;
  /** Data-derived / post-hoc threshold — IGNORED. Cannot manufacture a label. */
  readonly postHocThreshold?: number;
}

// --- Output ---------------------------------------------------------------------

export interface ClaimSentence {
  /** Fixed-template sentence text. */
  readonly text: string;
  /** Source metric key this sentence is bound to (e.g. `boundary:ver-x@2`). */
  readonly sourceMetricKey: string;
}

export interface ClaimReceipt {
  readonly claimRuleVersion: number;
  readonly metric: ClaimMetricKind;
  readonly cohortId: string;
  /** `${id}@${version}` for the authoritative boundary, or null. */
  readonly boundaryRef: string | null;
  readonly boundarySource: BoundarySource | null;
  readonly resolvedUnitCount: number;
  readonly eligibleInterval: ClaimEligibleInterval | null;
}

export interface ClaimResult {
  readonly label: ClaimLabel;
  readonly receipt: ClaimReceipt;
  readonly sentences: readonly ClaimSentence[];
  readonly disclosures: readonly string[];
}

// --- Forbidden copy (spec §10) --------------------------------------------------

/**
 * Universal phrases and scalars that must never appear in a generated claim
 * sentence (spec §10 forbidden examples). The list is intentionally
 * conservative and case-insensitive when checked.
 */
export const FORBIDDEN_CLAIM_PHRASES: readonly string[] = [
  "Overall score",
  "Best model",
  "good at",
  "n=",
  "Reliable",
  "reliable",
  "causal",
  "causes",
  "caused by",
  "therefore",
  "proves",
];

// --- Helpers --------------------------------------------------------------------

/**
 * Render a {@link VersionRef} as `id@version` — the canonical boundary
 * reference string encoded in the receipt and referenced in narrative copy.
 */
export function formatBoundaryRef(ref: VersionRef): string {
  return `${ref.id}@${ref.version}`;
}

function metricLabel(metric: ClaimMetricKind): string {
  return metric === "pass_rate" ? "pass rate" : "judged score";
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function formatInterval(iv: ClaimEligibleInterval): string {
  return `[${formatNumber(iv.lower)}, ${formatNumber(iv.upper)}]`;
}

function inside(
  iv: ClaimEligibleInterval,
  region: { readonly lower: number; readonly upper: number },
): boolean {
  return iv.lower >= region.lower && iv.upper <= region.upper;
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validRegion(region: { readonly lower: number; readonly upper: number }): boolean {
  return (
    isFiniteNumber(region.lower) && isFiniteNumber(region.upper) && region.lower <= region.upper
  );
}

/**
 * A boundary must carry a valid pre-existing ref + source and well-formed
 * regions. A data-derived or after-the-fact threshold (no authoritative ref)
 * is rejected — it cannot manufacture a label.
 */
function validateBoundary(boundary: SemanticBoundary): void {
  if (boundary.source !== "verifier_contract" && boundary.source !== "rubric_version") {
    throw new Error("SemanticBoundary.source must be verifier_contract or rubric_version");
  }
  if (!boundary.ref || typeof boundary.ref.id !== "string" || boundary.ref.id.length === 0) {
    throw new Error("SemanticBoundary.ref.id must be a non-empty string");
  }
  if (!isPositiveInteger(boundary.ref.version)) {
    throw new Error("SemanticBoundary.ref.version must be a positive integer");
  }
  if (!validRegion(boundary.supportedRegion)) {
    throw new Error("SemanticBoundary.supportedRegion must satisfy lower <= upper");
  }
  if (!validRegion(boundary.unsupportedRegion)) {
    throw new Error("SemanticBoundary.unsupportedRegion must satisfy lower <= upper");
  }
}

// --- Decision -------------------------------------------------------------------

type ClaimReason =
  | "small_n"
  | "no_evidence"
  | "no_boundary"
  | "cohort_disagreement"
  | "inside_supported"
  | "inside_unsupported"
  | "crosses"
  | "missingness"
  | "no_interval";

interface ClaimDecision {
  readonly label: ClaimLabel;
  readonly reason: ClaimReason;
}

function resolveDecision(input: ClaimCohortInput): ClaimDecision {
  if (input.resolvedUnitCount < MIN_CLAIM_RESOLVED_UNITS || input.pointValue === null) {
    return {
      label: "missing",
      reason: input.pointValue === null ? "no_evidence" : "small_n",
    };
  }
  if (input.boundary === null) {
    return { label: "descriptive_only", reason: "no_boundary" };
  }
  if (input.cohortDisagreement) {
    return { label: "mixed", reason: "cohort_disagreement" };
  }
  if (input.eligibleInterval === null) {
    return { label: "mixed", reason: "no_interval" };
  }
  if (inside(input.eligibleInterval, input.boundary.supportedRegion)) {
    if (input.hasUndisclosedMissingness) {
      return { label: "mixed", reason: "missingness" };
    }
    return { label: "strongest_supported", reason: "inside_supported" };
  }
  if (inside(input.eligibleInterval, input.boundary.unsupportedRegion)) {
    return { label: "weakest_supported", reason: "inside_unsupported" };
  }
  return { label: "mixed", reason: "crosses" };
}

// --- Narrative templates (fixed; no model call) --------------------------------

function strongestSentences(input: ClaimCohortInput, boundary: SemanticBoundary): ClaimSentence[] {
  const ref = formatBoundaryRef(boundary.ref);
  const mlabel = metricLabel(input.metric);
  const sentences: ClaimSentence[] = [
    {
      text: `Strongest supported: the eligible ${mlabel} interval ${formatInterval(
        input.eligibleInterval!,
      )} lies entirely inside the supported region declared by ${ref}.`,
      sourceMetricKey: `boundary:${ref}`,
    },
  ];
  if (input.metric === "pass_rate") {
    const passed = Math.max(0, input.verifiedTotal - input.verifiedFailures);
    sentences.push({
      text: `Verified on ${formatNumber(passed)} of ${formatNumber(
        input.verifiedTotal,
      )} ${input.areaLabel} tasks under verifier contract ${ref}.`,
      sourceMetricKey: `pass_rate:verified:${input.cohortId}`,
    });
  } else {
    sentences.push({
      text: `Supported on ${formatNumber(input.resolvedUnitCount)} resolved independent units in cohort ${input.cohortId}.`,
      sourceMetricKey: `coverage:resolved_units:${input.cohortId}`,
    });
  }
  if (input.verifiedFailures > 0) {
    sentences.push(limitationSentence(input, boundary));
  }
  return sentences;
}

function weakestSentences(input: ClaimCohortInput, boundary: SemanticBoundary): ClaimSentence[] {
  const ref = formatBoundaryRef(boundary.ref);
  const mlabel = metricLabel(input.metric);
  const sentences: ClaimSentence[] = [
    {
      text: `Weakest supported: the eligible ${mlabel} interval ${formatInterval(
        input.eligibleInterval!,
      )} lies entirely inside the unsupported region declared by ${ref}.`,
      sourceMetricKey: `boundary:${ref}`,
    },
  ];
  sentences.push(failureSentence(input, boundary));
  sentences.push({
    text: `Observed on ${formatNumber(input.resolvedUnitCount)} resolved independent units in cohort ${input.cohortId}.`,
    sourceMetricKey: `coverage:resolved_units:${input.cohortId}`,
  });
  return sentences;
}

function failureSentence(input: ClaimCohortInput, boundary: SemanticBoundary): ClaimSentence {
  const ref = formatBoundaryRef(boundary.ref);
  if (input.metric === "pass_rate") {
    return {
      text: `Failed verification on ${formatNumber(input.verifiedFailures)} of ${formatNumber(
        input.verifiedTotal,
      )} ${input.areaLabel} tasks under verifier contract ${ref}.`,
      sourceMetricKey: `pass_rate:failures:${input.cohortId}`,
    };
  }
  return {
    text: `Limitation: ${formatNumber(input.verifiedFailures)} of ${formatNumber(
      input.verifiedTotal,
    )} ${input.areaLabel} tasks scored inside the unsupported region under rubric ${ref}.`,
    sourceMetricKey: `judged_score:failures:${input.cohortId}`,
  };
}

function limitationSentence(input: ClaimCohortInput, boundary: SemanticBoundary): ClaimSentence {
  const ref = formatBoundaryRef(boundary.ref);
  if (input.metric === "pass_rate") {
    return {
      text: `Limitation: ${formatNumber(input.verifiedFailures)} of ${formatNumber(
        input.verifiedTotal,
      )} tasks failed verification under verifier contract ${ref}.`,
      sourceMetricKey: `pass_rate:failures:${input.cohortId}`,
    };
  }
  return {
    text: `Limitation: ${formatNumber(input.verifiedFailures)} of ${formatNumber(
      input.verifiedTotal,
    )} tasks scored inside the unsupported region under rubric ${ref}.`,
    sourceMetricKey: `judged_score:failures:${input.cohortId}`,
  };
}

function mixedSentences(input: ClaimCohortInput, reason: ClaimReason): ClaimSentence[] {
  const boundary = input.boundary!;
  const ref = formatBoundaryRef(boundary.ref);
  const mlabel = metricLabel(input.metric);
  const observed: ClaimSentence = {
    text: `Observed on ${formatNumber(input.resolvedUnitCount)} resolved independent units in cohort ${input.cohortId}.`,
    sourceMetricKey: `coverage:resolved_units:${input.cohortId}`,
  };
  if (reason === "cohort_disagreement") {
    return [
      {
        text: `Evidence is mixed across ${formatNumber(
          input.incompatibleCohortCount,
        )} incompatible cohorts; values are not pooled.`,
        sourceMetricKey: `cohort:${input.cohortId}`,
      },
      observed,
    ];
  }
  if (reason === "no_interval") {
    return [
      {
        text: `Evidence is mixed: no eligible interval is available for cohort ${input.cohortId} despite ${formatNumber(
          input.resolvedUnitCount,
        )} resolved independent units.`,
        sourceMetricKey: `coverage:resolved_units:${input.cohortId}`,
      },
      {
        text: `Values are not pooled across the boundary.`,
        sourceMetricKey: `boundary:${ref}`,
      },
    ];
  }
  if (reason === "missingness") {
    return [
      {
        text: `Evidence is mixed: undisclosed missingness is present even though the eligible ${mlabel} interval ${formatInterval(
          input.eligibleInterval!,
        )} lies inside the supported region declared by ${ref}.`,
        sourceMetricKey: `boundary:${ref}`,
      },
      {
        text: `Values are not pooled across the boundary.`,
        sourceMetricKey: `boundary:${ref}`,
      },
      observed,
    ];
  }
  // crosses
  return [
    {
      text: `Evidence is mixed: the eligible ${mlabel} interval ${formatInterval(
        input.eligibleInterval!,
      )} crosses the semantic boundary declared by ${ref}.`,
      sourceMetricKey: `boundary:${ref}`,
    },
    {
      text: `Values are not pooled across the boundary.`,
      sourceMetricKey: `boundary:${ref}`,
    },
    observed,
  ];
}

function descriptiveSentences(input: ClaimCohortInput): ClaimSentence[] {
  const mlabel = metricLabel(input.metric);
  return [
    {
      text: `Descriptive only: a normalized ${mlabel} of ${formatNumber(
        input.pointValue!,
      )} exists in cohort ${input.cohortId}, but no pre-existing semantic boundary is authoritative.`,
      sourceMetricKey: `metric:${input.metric}:${input.cohortId}`,
    },
    {
      text: `No threshold is inferred from observed data or supplied after observation.`,
      sourceMetricKey: `boundary:none:${input.cohortId}`,
    },
    {
      text: `Observed on ${formatNumber(input.resolvedUnitCount)} resolved independent units in cohort ${input.cohortId}.`,
      sourceMetricKey: `coverage:resolved_units:${input.cohortId}`,
    },
  ];
}

function missingSentences(input: ClaimCohortInput, reason: ClaimReason): ClaimSentence[] {
  if (reason === "no_evidence") {
    return [
      {
        text: `No eligible ${metricLabel(input.metric)} evidence in cohort ${input.cohortId}.`,
        sourceMetricKey: `coverage:eligible_evidence:${input.cohortId}`,
      },
    ];
  }
  // small_n
  const sentences: ClaimSentence[] = [
    {
      text: `Insufficient independent coverage for a label: ${formatNumber(
        input.resolvedUnitCount,
      )} resolved independent unit(s) in cohort ${input.cohortId} (minimum ${MIN_CLAIM_RESOLVED_UNITS} required).`,
      sourceMetricKey: `coverage:resolved_units:${input.cohortId}`,
    },
  ];
  if (input.pointValue !== null) {
    sentences.push({
      text: `A ${metricLabel(input.metric)} point estimate of ${formatNumber(
        input.pointValue,
      )} is shown descriptively; no supported/unsupported label is assigned.`,
      sourceMetricKey: `metric:${input.metric}:${input.cohortId}`,
    });
  }
  return sentences;
}

function disclosuresFor(input: ClaimCohortInput, decision: ClaimDecision): string[] {
  const out: string[] = [];
  switch (decision.label) {
    case "strongest_supported":
      if (input.verifiedFailures > 0) {
        out.push(`verified_failures:${input.verifiedFailures}/${input.verifiedTotal}`);
      }
      break;
    case "weakest_supported":
      out.push(`verified_failures:${input.verifiedFailures}/${input.verifiedTotal}`);
      break;
    case "mixed":
      if (decision.reason === "cohort_disagreement") {
        out.push(`cohort_disagreement:${input.incompatibleCohortCount}`);
      } else if (decision.reason === "crosses" && input.eligibleInterval) {
        out.push(
          `boundary_crossed:${formatNumber(input.eligibleInterval.lower)}..${formatNumber(
            input.eligibleInterval.upper,
          )}`,
        );
      } else if (decision.reason === "missingness") {
        out.push("undisclosed_missingness");
      } else if (decision.reason === "no_interval") {
        out.push("no_eligible_interval");
      }
      break;
    case "descriptive_only":
      out.push("no_pre_existing_boundary");
      break;
    case "missing":
      if (decision.reason === "no_evidence") {
        out.push("no_eligible_evidence");
      } else {
        out.push(`small_n:${input.resolvedUnitCount}`);
      }
      break;
  }
  return out;
}

// --- Main entry point -----------------------------------------------------------

/**
 * Build a deterministic evidence-grounded claim (label + fixed-template
 * narrative + receipt) for one metric cohort. Pure: never mutates the input
 * and performs no model call. Throws when a boundary is supplied without a
 * valid pre-existing ref/source (a post-hoc / data-derived threshold cannot
 * manufacture a label).
 */
export function buildProfileClaim(input: ClaimCohortInput): ClaimResult {
  if (input.boundary !== null) {
    validateBoundary(input.boundary);
  }
  // postHocThreshold is intentionally never read.

  const decision = resolveDecision(input);
  const boundaryRef = input.boundary ? formatBoundaryRef(input.boundary.ref) : null;
  const boundarySource = input.boundary ? input.boundary.source : null;

  let sentences: ClaimSentence[];
  switch (decision.label) {
    case "strongest_supported":
      sentences = strongestSentences(input, input.boundary!);
      break;
    case "weakest_supported":
      sentences = weakestSentences(input, input.boundary!);
      break;
    case "mixed":
      sentences = mixedSentences(input, decision.reason);
      break;
    case "descriptive_only":
      sentences = descriptiveSentences(input);
      break;
    case "missing":
      sentences = missingSentences(input, decision.reason);
      break;
  }

  const disclosures = disclosuresFor(input, decision);

  const receipt: ClaimReceipt = {
    claimRuleVersion: CLAIM_RULE_VERSION,
    metric: input.metric,
    cohortId: input.cohortId,
    boundaryRef,
    boundarySource,
    resolvedUnitCount: input.resolvedUnitCount,
    eligibleInterval: input.eligibleInterval,
  };

  return {
    label: decision.label,
    receipt,
    sentences,
    disclosures,
  };
}
