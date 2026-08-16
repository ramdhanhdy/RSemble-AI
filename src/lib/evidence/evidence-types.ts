// =============================================================================
// RSemble AI — Evidence domain types (observations-and-evidence spec §3, §8)
//
// Child 04 (Observations, Eligibility, and Evidence Provenance) Milestone A.
// Pure domain surface for canonical Task Observations: ModelConfigurationSnapshot,
// Observation, AssessmentRef, EligibilityDecision, and the fixed vocabularies
// (evidence classes, allowed uses, reason codes, completeness kinds).
//
// Invariants:
//  - Observation is a reference/index over evidence — it NEVER copies raw
//    candidate output, candidate messages, or full judge rationale. Guards in
//    ./evidence-validation.ts reject any payload carrying such fields.
//  - Eligibility-rule versions are deliberately absent from Observation
//    identity; decisions are derived indexes keyed by
//    [observationId + ruleVersion] (spec §3.2).
//  - The child-02 Fusion Study `EvaluationObservation` (fusion-study-types.ts)
//    is a distinct study-owned entity and is never an input to canonical
//    derivation (spec §4). This module does not import it.
// =============================================================================

import type { VerificationKind } from "../evaluations/evaluation-types";
import type { VersionRef } from "../tasks/task-types";

/** Current canonical Observation schema version (spec §3.2). */
export const OBSERVATION_SCHEMA_VERSION = 1;

/** Restricted scalar domain allowed inside snapshots and indexed fields. */
export type JsonScalar = string | number | boolean | null;

// --- Model configuration snapshot (spec §3.1) -----------------------------------

export type IdentityCompleteness = "exact" | "rolling_alias" | "partial";

export const IDENTITY_COMPLETENESS_KINDS: readonly IdentityCompleteness[] = [
  "exact",
  "rolling_alias",
  "partial",
];

/**
 * Canonicalized provider/model identity for one observed execution window.
 *
 * Credentials, headers, provider tokens, and raw secret-bearing config never
 * enter this snapshot. The ID is derived through a canonical serializer and a
 * collision-checked content fingerprint, but the fingerprint is never presented
 * as provider truth. Unknown resolved versions remain unknown.
 */
export interface ModelConfigurationSnapshot {
  id: string;
  providerId: string;
  requestedModel: string;
  resolvedModel: string | null;
  resolvedVersion: string | null;
  reasoningRequested: string | null;
  reasoningEffective: string | null;
  toolScaffoldSignature: string | null;
  runtimeSettings: Record<string, JsonScalar>;
  observedFrom: number;
  observedTo: number;
  identityCompleteness: IdentityCompleteness;
}

// --- Observation (spec §3.2) -----------------------------------------------------

export type ObservationSourceKind = "comparison" | "evaluation";

export const OBSERVATION_SOURCE_KINDS: readonly ObservationSourceKind[] = [
  "comparison",
  "evaluation",
];

/** Normalized executed verifier result for one task × model cell. */
export interface VerifierOutcomeRef {
  taskId: string;
  modelKey: string;
  passed: boolean;
  executedAt: number;
}

/**
 * Assessment reference (spec §3.4): identifies the accepted judge attempt,
 * verifier result, blind label mapping, rubric/version, and (via the enclosing
 * Observation) the selected task attempt. Multiple assessment events may
 * reference the same candidate output; one active assessment is selected per
 * execution lineage/task/model cell for default analysis.
 */
export interface AssessmentRef {
  judgeAttemptId: string;
  judgeProviderId: string;
  judgeModel: string;
  /** Judge-time blind label → candidate id mapping. */
  blindLabelMapping: Record<string, string>;
  /** Accepted candidate attempt id per candidate id. */
  candidateAttemptIdsByCandidateId: Record<string, string>;
  rubricRef: VersionRef | null;
  /** Frozen verifier contract version, when the task has a versioned verifier. */
  verifierRef: VersionRef | null;
  verifierOutcome: VerifierOutcomeRef | null;
}

/** One normalized criterion value. References the original, never rationale text. */
export interface ObservationCriterionValue {
  criterionId: string;
  /** Numeric for graded/legacy criteria, boolean for binary criteria. */
  value: number | boolean;
}

/**
 * Normalized assessment values and verifier outcome required for analysis.
 * References original criterion values; never duplicates candidate text or
 * full judge rationale (spec §3.2).
 */
export interface ObservationOutcome {
  judgeAccepted: boolean;
  overallScore: number | null;
  criterionValues: ObservationCriterionValue[];
  verifierPassed: boolean | null;
}

export type EvaluatorKind = "model_judge" | "human_authorized";

/**
 * Evaluator identity snapshot (spec §9): kind/model/version/configuration.
 * The instruction digest is a canonical serialization hash — never the raw
 * judge instruction text.
 */
export interface EvaluatorSnapshot {
  kind: EvaluatorKind;
  providerId: string;
  model: string;
  resolvedVersion: string | null;
  instructionDigest: string;
  reasoningEffort: string | null;
  toolScaffoldSignature: string | null;
}

/** Frozen verifier contract snapshot (spec §9). */
export interface VerifierSnapshot {
  verifierRef: VersionRef | null;
  kind: VerificationKind;
  /** Canonical serialization hash of the verifier configuration. */
  configurationDigest: string;
}

/**
 * Canonical Task Observation (spec §3.2): an immutable reference/index over
 * exact run and experiment records. Field-for-field with the specification.
 */
export interface Observation {
  id: string;
  sourceKind: ObservationSourceKind;
  sourceResultId: string;
  executionLineageId: string;
  runId: string;
  sourceTaskCellId: string;
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  taskFamilyId: string | null;
  modelConfigurationId: string;
  candidateAttemptId: string;
  assessmentRef: AssessmentRef;
  protocolFingerprint: string;
  rubricRef: VersionRef | null;
  evaluatorSnapshot: EvaluatorSnapshot;
  verifierSnapshot: VerifierSnapshot | null;
  outcome: ObservationOutcome;
  observedAt: number;
  observationSchemaVersion: number;
}

// --- Eligibility decision (spec §3.3, §8) ----------------------------------------

export type EvidenceClass = "exploratory" | "comparable" | "verified" | "benchmark_anchor";

export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "exploratory",
  "comparable",
  "verified",
  "benchmark_anchor",
];

export type EvidenceUse =
  | "task_descriptive"
  | "within_model_profile"
  | "paired_model_comparison"
  | "task_set_standing"
  | "benchmark_anchor_analysis";

export const EVIDENCE_USES: readonly EvidenceUse[] = [
  "task_descriptive",
  "within_model_profile",
  "paired_model_comparison",
  "task_set_standing",
  "benchmark_anchor_analysis",
];

export type EligibilityStatus = "eligible" | "provisional" | "excluded";

export const ELIGIBILITY_STATUSES: readonly EligibilityStatus[] = [
  "eligible",
  "provisional",
  "excluded",
];

/**
 * Initial reason-code vocabulary (spec §8), in alphabetical canonical order.
 * Classification output is always sorted against this list.
 */
export type EvidenceReasonCode =
  | "anchor_designated"
  | "assessment_missing_or_failed"
  | "assessment_selected_completed"
  | "candidate_missing_or_failed"
  | "candidate_selected_completed"
  | "canonical_task_resolved"
  | "canonical_task_unresolved"
  | "full_pair_coverage"
  | "full_task_set_coverage"
  | "incomplete_task_set_coverage"
  | "instance_input_incomplete"
  | "instance_reconstructed"
  | "model_configuration_exact"
  | "model_configuration_incomplete"
  | "model_version_unreported"
  | "paired_cell_missing"
  | "protocol_complete"
  | "protocol_incomplete"
  | "reused_candidate_assessment"
  | "rubric_resolved"
  | "rubric_unresolved"
  | "source_corrupt"
  | "source_legacy_limited"
  | "undeclared_repeat"
  | "verifier_failed"
  | "verifier_not_declared"
  | "verifier_passed";

export const EVIDENCE_REASON_CODES: readonly EvidenceReasonCode[] = [
  "anchor_designated",
  "assessment_missing_or_failed",
  "assessment_selected_completed",
  "candidate_missing_or_failed",
  "candidate_selected_completed",
  "canonical_task_resolved",
  "canonical_task_unresolved",
  "full_pair_coverage",
  "full_task_set_coverage",
  "incomplete_task_set_coverage",
  "instance_input_incomplete",
  "instance_reconstructed",
  "model_configuration_exact",
  "model_configuration_incomplete",
  "model_version_unreported",
  "paired_cell_missing",
  "protocol_complete",
  "protocol_incomplete",
  "reused_candidate_assessment",
  "rubric_resolved",
  "rubric_unresolved",
  "source_corrupt",
  "source_legacy_limited",
  "undeclared_repeat",
  "verifier_failed",
  "verifier_not_declared",
  "verifier_passed",
];

/**
 * A versioned, deterministic eligibility decision for one Observation.
 * Decision revisions are append-only or reproducibly replaceable derived
 * indexes; historical rule versions remain inspectable (spec §3.3).
 */
export interface EligibilityDecision {
  observationId: string;
  ruleVersion: number;
  status: EligibilityStatus;
  evidenceClass: EvidenceClass;
  allowedUses: EvidenceUse[];
  reasonCodes: EvidenceReasonCode[];
  comparabilityCohortId: string;
  decidedAt: number;
}
