// =============================================================================
// RSemble AI — Evidence eligibility classification (spec §7, §8)
//
// Deterministic, versioned, automatic classification of an Observation into
// evidence class, eligibility status, allowed uses, and reason codes. Every
// reason combination in the specification vocabulary resolves to exactly one
// output; there are no runtime-configurable rules.
//
// Rules implemented:
//  - Exploratory is the default when a durable source lacks controlled
//    foundations (unresolved canonical task, unreconstructable input,
//    incomplete protocol, incomplete configuration, unresolved rubric).
//  - Comparable requires canonical Task identity, concrete input, accepted
//    completed candidate output, valid assessment/verifier outcome, exact
//    configuration (unknown-version disclosure allowed), complete protocol,
//    and no unresolved corruption.
//  - Verified requires Comparable plus a passing deterministic verifier under
//    a frozen verifier version, or separately authorized human verification.
//    A model judge score never produces Verified.
//  - Benchmark anchor requires explicit designation plus full coverage and an
//    exact configuration — never inferred from scores or sample size.
//  - Unknown model version is a disclosure and use qualifier, never a full
//    exclusion from within-model description; missing paired cells remove
//    paired/standing uses; verifier failure remains valid negative evidence;
//    unreconstructable input excludes profile use; legacy evidence never
//    receives invented provenance.
//
// The decision carries the comparability cohort id computed by
// ./comparability-cohort (cohort building is a separate concern, spec §9).
// Outputs are deterministic: reason codes sorted alphabetically, uses in the
// canonical EVIDENCE_USES order.
// =============================================================================

import {
  EVIDENCE_USES,
  type EligibilityDecision,
  type EvidenceClass,
  type EvidenceReasonCode,
  type EvidenceUse,
  type Observation,
} from "./evidence-types";
import { isCohortFingerprint } from "./evidence-validation";

/** Current eligibility rule version (spec §3.3). Bump only with a new rule set. */
export const EVIDENCE_RULE_VERSION = 1;

export type VerifierState = "passed" | "failed" | "not_declared";
export type ConfigurationState = "exact" | "rolling_alias" | "partial";

export interface EligibilityInput {
  observation: Observation;
  canonicalTaskResolved: boolean;
  /** The concrete Task Instance input is reconstructable. */
  candidateInputComplete: boolean;
  candidateSelectedCompleted: boolean;
  /** An accepted judge assessment exists for this output. */
  assessmentSelectedCompleted: boolean;
  verifierState: VerifierState;
  /** The verifier ran under a frozen verifier version (spec §7.3). */
  frozenVerifierVersion: boolean;
  /** Separately authorized human verification with provenance (spec §7.3). */
  humanVerificationAuthorized: boolean;
  rubricResolved: boolean;
  protocolComplete: boolean;
  configurationState: ConfigurationState;
  fullPairCoverage: boolean;
  fullTaskSetCoverage: boolean;
  reusedCandidateAssessment: boolean;
  undeclaredRepeat: boolean;
  sourceCorrupt: boolean;
  sourceLegacyLimited: boolean;
  anchorDesignated: boolean;
  comparabilityCohortId: string;
  decidedAt: number;
}

/**
 * Reason codes that disclose a limitation or qualification. Used to derive the
 * eligibility status. `assessment_missing_or_failed` is handled contextually
 * (a verifier-only cell is not limited by a missing judge); counting-only
 * disclosures (reused assessment, undeclared repeat) are informational and do
 * not lower eligibility.
 */
export const LIMITATION_REASON_CODES: Readonly<Partial<Record<EvidenceReasonCode, true>>> = {
  candidate_missing_or_failed: true,
  canonical_task_unresolved: true,
  incomplete_task_set_coverage: true,
  instance_input_incomplete: true,
  model_configuration_incomplete: true,
  model_version_unreported: true,
  paired_cell_missing: true,
  protocol_incomplete: true,
  rubric_unresolved: true,
  source_corrupt: true,
  source_legacy_limited: true,
  verifier_failed: true,
};

/** Contract violation when classification inputs are incoherent. */
export class EvidenceClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceClassificationError";
  }
}

const FULL_USES_BY_CLASS: Readonly<Record<EvidenceClass, number>> = {
  exploratory: 1,
  comparable: 4,
  verified: 4,
  benchmark_anchor: 5,
};

export function classifyEligibility(input: EligibilityInput): EligibilityDecision {
  if (!isCohortFingerprint(input.comparabilityCohortId)) {
    throw new EvidenceClassificationError(
      `comparabilityCohortId must be a canonical sha256 fingerprint, got ${JSON.stringify(
        input.comparabilityCohortId,
      )}.`,
    );
  }
  if (typeof input.decidedAt !== "number" || !Number.isFinite(input.decidedAt)) {
    throw new EvidenceClassificationError("decidedAt must be a finite epoch ms.");
  }

  const reasons = new Set<EvidenceReasonCode>();

  // Canonical Task identity.
  reasons.add(input.canonicalTaskResolved ? "canonical_task_resolved" : "canonical_task_unresolved");
  // Input completeness.
  reasons.add(input.candidateInputComplete ? "instance_reconstructed" : "instance_input_incomplete");
  // Candidate output.
  reasons.add(
    input.candidateSelectedCompleted ? "candidate_selected_completed" : "candidate_missing_or_failed",
  );
  // Assessment evidence.
  reasons.add(
    input.assessmentSelectedCompleted ? "assessment_selected_completed" : "assessment_missing_or_failed",
  );
  // Verifier.
  if (input.verifierState === "passed") reasons.add("verifier_passed");
  else if (input.verifierState === "failed") reasons.add("verifier_failed");
  else reasons.add("verifier_not_declared");
  // Rubric.
  reasons.add(input.rubricResolved ? "rubric_resolved" : "rubric_unresolved");
  // Protocol.
  reasons.add(input.protocolComplete ? "protocol_complete" : "protocol_incomplete");
  // Model configuration.
  if (input.configurationState === "exact") reasons.add("model_configuration_exact");
  else if (input.configurationState === "rolling_alias") reasons.add("model_version_unreported");
  else reasons.add("model_configuration_incomplete");
  // Coverage.
  reasons.add(input.fullPairCoverage ? "full_pair_coverage" : "paired_cell_missing");
  reasons.add(input.fullTaskSetCoverage ? "full_task_set_coverage" : "incomplete_task_set_coverage");
  // Disclosures.
  if (input.reusedCandidateAssessment) reasons.add("reused_candidate_assessment");
  if (input.undeclaredRepeat) reasons.add("undeclared_repeat");
  if (input.sourceCorrupt) reasons.add("source_corrupt");
  if (input.sourceLegacyLimited) reasons.add("source_legacy_limited");
  if (input.anchorDesignated) reasons.add("anchor_designated");

  // --- Comparable preconditions (spec §7.2) -------------------------------------
  const comparable =
    input.canonicalTaskResolved &&
    input.candidateInputComplete &&
    input.candidateSelectedCompleted &&
    (input.assessmentSelectedCompleted || input.verifierState !== "not_declared") &&
    input.rubricResolved &&
    input.protocolComplete &&
    input.configurationState !== "partial" &&
    !input.sourceCorrupt;

  // --- Class ---------------------------------------------------------------------
  let evidenceClass: EvidenceClass;
  if (!comparable) {
    evidenceClass = "exploratory";
  } else if (
    input.anchorDesignated &&
    input.fullPairCoverage &&
    input.fullTaskSetCoverage &&
    input.configurationState === "exact"
  ) {
    evidenceClass = "benchmark_anchor";
  } else if (
    input.humanVerificationAuthorized ||
    (input.verifierState === "passed" && input.frozenVerifierVersion)
  ) {
    evidenceClass = "verified";
  } else {
    evidenceClass = "comparable";
  }

  // --- Allowed uses ---------------------------------------------------------------
  const versionReported = input.configurationState === "exact";
  let allowedUses: EvidenceUse[];
  if (evidenceClass === "benchmark_anchor") {
    allowedUses = [...EVIDENCE_USES];
  } else if (evidenceClass === "exploratory") {
    allowedUses =
      input.candidateSelectedCompleted && !input.sourceCorrupt ? ["task_descriptive"] : [];
  } else {
    allowedUses = ["task_descriptive", "within_model_profile"];
    if (versionReported && input.fullPairCoverage) {
      allowedUses.push("paired_model_comparison");
    }
    if (versionReported && input.fullPairCoverage && input.fullTaskSetCoverage) {
      allowedUses.push("task_set_standing");
    }
  }

  // --- Status ---------------------------------------------------------------------
  let status: EligibilityDecision["status"];
  if (allowedUses.length === 0) {
    status = "excluded";
  } else {
    // Limitations lower a decision to provisional. A verifier pass under an
    // unfrozen verifier version limits only the *verified* claim (spec §7.3),
    // never the comparable uses, so it is not a limitation here: a comparable
    // cell with full uses and no other limitations stays eligible. Every
    // provisional decision therefore carries at least one limitation reason
    // code that has fixed plain-language copy (spec §8).
    const hasLimitation =
      [...reasons].some((code) => LIMITATION_REASON_CODES[code] === true) ||
      (!input.assessmentSelectedCompleted && input.verifierState === "not_declared");
    const fullUses = allowedUses.length === FULL_USES_BY_CLASS[evidenceClass];
    status = hasLimitation || !fullUses ? "provisional" : "eligible";
  }

  return {
    observationId: input.observation.id,
    ruleVersion: EVIDENCE_RULE_VERSION,
    status,
    evidenceClass,
    allowedUses,
    reasonCodes: [...reasons].sort(),
    comparabilityCohortId: input.comparabilityCohortId,
    decidedAt: input.decidedAt,
  };
}
