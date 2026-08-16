// =============================================================================
// RSemble AI — Evidence validation (observations-and-evidence spec §3, §5, §13)
//
// Runtime guards, canonical serializers, and prohibited-content enforcement
// for the canonical evidence domain:
//
//  - exact structural guards for every entity in evidence-types.ts;
//  - the idempotent six-part observation source key (spec §5);
//  - canonical serialization for collision deep-checks;
//  - rejection of secret-bearing keys and of raw candidate output / full judge
//    rationale fields anywhere in an Observation payload (spec §13).
//
// Canonicalization reuses the shared sorted-key JSON serializer and the
// content hash from ./../evaluations/protocol-fingerprint so every hash in the
// workbench comes from one implementation.
// =============================================================================

import { VERIFICATION_KINDS } from "../evaluations/evaluation-types";
import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { isNonBlankString, isRecord } from "../persistence/run-types";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_REASON_CODES,
  EVIDENCE_USES,
  ELIGIBILITY_STATUSES,
  IDENTITY_COMPLETENESS_KINDS,
  OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_SOURCE_KINDS,
  type AssessmentRef,
  type EligibilityDecision,
  type EvaluatorSnapshot,
  type EvidenceClass,
  type EvidenceReasonCode,
  type EvidenceUse,
  type IdentityCompleteness,
  type JsonScalar,
  type ModelConfigurationSnapshot,
  type Observation,
  type ObservationCriterionValue,
  type ObservationOutcome,
  type ObservationSourceKind,
  type VerifierOutcomeRef,
  type VerifierSnapshot,
} from "./evidence-types";
import type { VersionRef } from "../tasks/task-types";

// --- Canonical id formats -------------------------------------------------------

const MC_ID_RE = /^mc:sha256:[0-9a-f]{64}$/;
const OBS_ID_RE = /^obs:sha256:[0-9a-f]{64}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

/** Canonical fingerprint shape: `sha256:<64 lowercase hex>` (spec §9). */
export function isCohortFingerprint(v: unknown): v is string {
  return typeof v === "string" && SHA256_RE.test(v);
}

// --- Prohibited content (spec §3.1, §13) ----------------------------------------

/**
 * Keys that must never appear in evidence snapshots, explanations, or indexed
 * fields. Superset of the fusion-study record prohibition.
 */
export const EVIDENCE_PROHIBITED_KEYS: ReadonlySet<string> = new Set([
  "apiKey",
  "authorization",
  "bearer",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "env",
  "headers",
  "password",
  "proxyUrl",
  "secret",
  "token",
]);

/**
 * Field names that would carry raw candidate output, candidate messages, or
 * full judge rationale. An Observation may reference this material by ID but
 * never embed it (spec §3.2).
 */
export const EVIDENCE_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  "candidateMessages",
  "candidateOutput",
  "candidateText",
  "comparisons",
  "content",
  "deductions",
  "fullRationale",
  "judgeRationale",
  "messages",
  "missedRequirements",
  "output",
  "rationale",
  "rawOutput",
  "report",
  "segments",
  "strengths",
  "streamingText",
  "text",
]);

/** Recursively collect prohibited-key and raw-content-field occurrences. */
export function collectProhibitedFieldPaths(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) {
    v.forEach((item, index) => collectProhibitedFieldPaths(item, `${path}[${index}]`, out));
    return;
  }
  if (!isRecord(v)) return;
  for (const key of Object.keys(v)) {
    const at = path === "" ? "<root>" : path;
    if (EVIDENCE_PROHIBITED_KEYS.has(key)) {
      out.push(`prohibited key "${key}" at ${at}.`);
    }
    if (EVIDENCE_CONTENT_FIELDS.has(key)) {
      out.push(`raw content field "${key}" at ${at}.`);
    }
    collectProhibitedFieldPaths(v[key], `${path}.${key}`, out);
  }
}

// --- Small guards ----------------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isNonNegativeFinite(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}

function isNullishString(v: unknown): boolean {
  return v === null || isString(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isRecord(v)) return false;
  return Object.entries(v).every(([k, val]) => k.length > 0 && isString(val) && val.length > 0);
}

export function isJsonScalar(v: unknown): v is JsonScalar {
  return v === null || isString(v) || isFiniteNumber(v) || isBoolean(v);
}

export function isVersionRef(v: unknown): v is VersionRef {
  return (
    isRecord(v) &&
    isNonBlankString(v.id) &&
    isFiniteNumber(v.version) &&
    Number.isInteger(v.version) &&
    v.version > 0
  );
}

// --- Entity guards ---------------------------------------------------------------

export function isIdentityCompleteness(v: unknown): v is IdentityCompleteness {
  return isString(v) && (IDENTITY_COMPLETENESS_KINDS as readonly string[]).includes(v);
}

export function isModelConfigurationSnapshot(v: unknown): v is ModelConfigurationSnapshot {
  if (!isRecord(v)) return false;
  if (!isString(v.id) || !MC_ID_RE.test(v.id)) return false;
  if (!isNonBlankString(v.providerId) || !isNonBlankString(v.requestedModel)) return false;
  if (!isNullishString(v.resolvedModel) || !isNullishString(v.resolvedVersion)) return false;
  if (!isNullishString(v.reasoningRequested) || !isNullishString(v.reasoningEffective))
    return false;
  if (!isNullishString(v.toolScaffoldSignature)) return false;
  if (!isRecord(v.runtimeSettings)) return false;
  if (!Object.values(v.runtimeSettings as Record<string, unknown>).every(isJsonScalar))
    return false;
  if (!isNonNegativeFinite(v.observedFrom) || !isNonNegativeFinite(v.observedTo)) return false;
  if (v.observedFrom > v.observedTo) return false;
  if (!isIdentityCompleteness(v.identityCompleteness)) return false;
  // Completeness must be consistent with the resolved identity facts.
  const { resolvedModel, resolvedVersion, identityCompleteness } = v;
  if (identityCompleteness === "exact") {
    if (!isNonBlankString(resolvedModel) || !isNonBlankString(resolvedVersion)) return false;
  } else if (identityCompleteness === "rolling_alias") {
    if (!isNonBlankString(resolvedModel) || resolvedVersion !== null) return false;
  } else if (resolvedModel !== null || resolvedVersion !== null) {
    return false;
  }
  return true;
}

export function isVerifierOutcomeRef(v: unknown): v is VerifierOutcomeRef {
  return (
    isRecord(v) &&
    isNonBlankString(v.taskId) &&
    isNonBlankString(v.modelKey) &&
    isBoolean(v.passed) &&
    isNonNegativeFinite(v.executedAt)
  );
}

export function isAssessmentRef(v: unknown): v is AssessmentRef {
  if (!isRecord(v)) return false;
  if (
    !isNonBlankString(v.judgeAttemptId) ||
    !isNonBlankString(v.judgeProviderId) ||
    !isNonBlankString(v.judgeModel)
  ) {
    return false;
  }
  if (!isStringRecord(v.blindLabelMapping)) return false;
  if (!isStringRecord(v.candidateAttemptIdsByCandidateId)) return false;
  if (v.rubricRef !== null && !isVersionRef(v.rubricRef)) return false;
  if (v.verifierRef !== null && !isVersionRef(v.verifierRef)) return false;
  if (v.verifierOutcome !== null && !isVerifierOutcomeRef(v.verifierOutcome)) return false;
  return true;
}

export function isObservationCriterionValue(v: unknown): v is ObservationCriterionValue {
  if (!isRecord(v)) return false;
  if (!isNonBlankString(v.criterionId)) return false;
  return isFiniteNumber(v.value) || isBoolean(v.value);
}

export function isObservationOutcome(v: unknown): v is ObservationOutcome {
  if (!isRecord(v)) return false;
  if (!isBoolean(v.judgeAccepted)) return false;
  if (v.overallScore !== null && !isFiniteNumber(v.overallScore)) return false;
  if (!Array.isArray(v.criterionValues) || !v.criterionValues.every(isObservationCriterionValue)) {
    return false;
  }
  const ids = (v.criterionValues as ObservationCriterionValue[]).map((c) => c.criterionId);
  if (new Set(ids).size !== ids.length) return false;
  if (v.verifierPassed !== null && !isBoolean(v.verifierPassed)) return false;
  // A rejected judge stage cannot carry scores.
  if (
    !v.judgeAccepted &&
    (v.overallScore !== null || (v.criterionValues as unknown[]).length > 0)
  ) {
    return false;
  }
  return true;
}

export function isEvaluatorSnapshot(v: unknown): v is EvaluatorSnapshot {
  if (!isRecord(v)) return false;
  if (v.kind !== "model_judge" && v.kind !== "human_authorized") return false;
  if (!isNonBlankString(v.providerId) || !isNonBlankString(v.model)) return false;
  if (!isNullishString(v.resolvedVersion)) return false;
  if (!isString(v.instructionDigest) || !SHA256_RE.test(v.instructionDigest)) return false;
  if (!isNullishString(v.reasoningEffort) || !isNullishString(v.toolScaffoldSignature))
    return false;
  return true;
}

export function isVerifierSnapshot(v: unknown): v is VerifierSnapshot {
  if (!isRecord(v)) return false;
  if (v.verifierRef !== null && !isVersionRef(v.verifierRef)) return false;
  if (!isString(v.kind) || !(VERIFICATION_KINDS as readonly string[]).includes(v.kind))
    return false;
  if (v.kind === "none") return false;
  return isString(v.configurationDigest) && SHA256_RE.test(v.configurationDigest);
}

export function isObservationSourceKind(v: unknown): v is ObservationSourceKind {
  return isString(v) && (OBSERVATION_SOURCE_KINDS as readonly string[]).includes(v);
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Detailed validator: collects every structural and content violation. */
export function validateObservation(v: unknown): ValidationResult<Observation> {
  const errors: string[] = [];
  if (!isRecord(v)) return { ok: false, errors: ["Observation payload is not an object."] };
  collectProhibitedFieldPaths(v, "", errors);
  if (v.observationSchemaVersion !== OBSERVATION_SCHEMA_VERSION) {
    errors.push(
      `observationSchemaVersion must be ${OBSERVATION_SCHEMA_VERSION}, got ${String(v.observationSchemaVersion)}.`,
    );
  }
  if (!isString(v.id) || !OBS_ID_RE.test(v.id)) {
    errors.push(`id must match the canonical observation id format, got ${JSON.stringify(v.id)}.`);
  }
  if (!isObservationSourceKind(v.sourceKind))
    errors.push("sourceKind must be comparison|evaluation.");
  for (const field of [
    "sourceResultId",
    "executionLineageId",
    "runId",
    "sourceTaskCellId",
    "taskId",
    "taskInstanceId",
    "candidateAttemptId",
  ]) {
    if (!isNonBlankString(v[field])) errors.push(`${field} must be a non-blank string.`);
  }
  if (!isNullishString(v.taskFamilyId)) errors.push("taskFamilyId must be a string or null.");
  if (!isFiniteNumber(v.taskVersion) || !Number.isInteger(v.taskVersion) || v.taskVersion <= 0) {
    errors.push("taskVersion must be a positive integer.");
  }
  if (!isString(v.modelConfigurationId) || !MC_ID_RE.test(v.modelConfigurationId)) {
    errors.push("modelConfigurationId must match the canonical model-configuration id format.");
  }
  if (!isAssessmentRef(v.assessmentRef)) errors.push("assessmentRef is malformed.");
  if (!isString(v.protocolFingerprint) || !SHA256_RE.test(v.protocolFingerprint)) {
    errors.push("protocolFingerprint must be sha256:<hex>.");
  }
  if (v.rubricRef !== null && !isVersionRef(v.rubricRef)) errors.push("rubricRef is malformed.");
  if (!isEvaluatorSnapshot(v.evaluatorSnapshot)) errors.push("evaluatorSnapshot is malformed.");
  if (v.verifierSnapshot !== null && !isVerifierSnapshot(v.verifierSnapshot)) {
    errors.push("verifierSnapshot is malformed.");
  }
  if (!isObservationOutcome(v.outcome)) {
    const o = v.outcome as Record<string, unknown> | undefined;
    if (
      o !== undefined &&
      o.judgeAccepted === false &&
      (o.overallScore !== null ||
        (Array.isArray(o.criterionValues) && o.criterionValues.length > 0))
    ) {
      errors.push(
        "outcome.overallScore and outcome.criterionValues must be empty when judgeAccepted is false.",
      );
    } else {
      errors.push("outcome is malformed.");
    }
  }
  const outcome = v.outcome as ObservationOutcome | undefined;
  const ref = v.assessmentRef as AssessmentRef | undefined;
  if (outcome && ref) {
    if (ref.verifierOutcome === null && outcome.verifierPassed !== null) {
      errors.push("verifierPassed is set but assessmentRef.verifierOutcome is missing.");
    }
    if (ref.verifierOutcome !== null && outcome.verifierPassed === null) {
      errors.push("assessmentRef.verifierOutcome is set but outcome.verifierPassed is missing.");
    }
    if (
      ref.verifierOutcome !== null &&
      outcome.verifierPassed !== null &&
      ref.verifierOutcome.passed !== outcome.verifierPassed
    ) {
      errors.push("verifierPassed disagrees with assessmentRef.verifierOutcome.passed.");
    }
  }
  if (!isNonNegativeFinite(v.observedAt))
    errors.push("observedAt must be a non-negative epoch ms.");
  // Idempotency: the id is derived from the source key; a mismatch is corruption.
  if (errors.length === 0) {
    const derived = observationIdFor(v as unknown as Observation);
    if (derived !== v.id) {
      errors.push(`id "${String(v.id)}" does not match the derived source key id "${derived}".`);
    }
  }
  return errors.length === 0
    ? { ok: true, value: v as unknown as Observation }
    : { ok: false, errors };
}

export function isObservation(v: unknown): v is Observation {
  return validateObservation(v).ok;
}

// --- Eligibility decision guard ---------------------------------------------------

export function isEvidenceClass(v: unknown): v is EvidenceClass {
  return isString(v) && (EVIDENCE_CLASSES as readonly string[]).includes(v);
}

export function isEvidenceUse(v: unknown): v is EvidenceUse {
  return isString(v) && (EVIDENCE_USES as readonly string[]).includes(v);
}

export function isEvidenceReasonCode(v: unknown): v is EvidenceReasonCode {
  return isString(v) && (EVIDENCE_REASON_CODES as readonly string[]).includes(v);
}

/** Exact EligibilityDecision field set (spec §3.3) — no free-form fields. */
const ELIGIBILITY_DECISION_FIELDS: Readonly<Record<string, true>> = {
  observationId: true,
  ruleVersion: true,
  status: true,
  evidenceClass: true,
  allowedUses: true,
  reasonCodes: true,
  comparabilityCohortId: true,
  decidedAt: true,
};

export function validateEligibilityDecision(v: unknown): ValidationResult<EligibilityDecision> {
  const errors: string[] = [];
  if (!isRecord(v)) return { ok: false, errors: ["EligibilityDecision payload is not an object."] };
  collectProhibitedFieldPaths(v, "", errors);
  for (const key of Object.keys(v)) {
    if (ELIGIBILITY_DECISION_FIELDS[key] !== true) {
      errors.push(`unknown field "${key}" on EligibilityDecision.`);
    }
  }
  if (!isString(v.observationId) || !OBS_ID_RE.test(v.observationId)) {
    errors.push("observationId must be a canonical observation id.");
  }
  if (!isFiniteNumber(v.ruleVersion) || !Number.isInteger(v.ruleVersion) || v.ruleVersion <= 0) {
    errors.push("ruleVersion must be a positive integer.");
  }
  if (!isString(v.status) || !(ELIGIBILITY_STATUSES as readonly string[]).includes(v.status)) {
    errors.push("status must be eligible|provisional|excluded.");
  }
  if (!isEvidenceClass(v.evidenceClass)) errors.push("evidenceClass is unknown.");
  if (!Array.isArray(v.allowedUses) || !v.allowedUses.every(isEvidenceUse)) {
    errors.push("allowedUses contains an unknown use.");
  } else if (new Set(v.allowedUses).size !== v.allowedUses.length) {
    errors.push("allowedUses contains duplicates.");
  }
  if (!Array.isArray(v.reasonCodes) || !v.reasonCodes.every(isEvidenceReasonCode)) {
    errors.push("reasonCodes contains an unknown code.");
  } else if (new Set(v.reasonCodes).size !== v.reasonCodes.length) {
    errors.push("reasonCodes contains duplicates.");
  }
  if (!isCohortFingerprint(v.comparabilityCohortId)) {
    errors.push("comparabilityCohortId must be sha256:<hex>.");
  }
  if (!isNonNegativeFinite(v.decidedAt)) errors.push("decidedAt must be a non-negative epoch ms.");
  return errors.length === 0
    ? { ok: true, value: v as unknown as EligibilityDecision }
    : { ok: false, errors };
}

export function isEligibilityDecision(v: unknown): v is EligibilityDecision {
  return validateEligibilityDecision(v).ok;
}

// --- Canonical serializers (spec §5) ----------------------------------------------

/**
 * Canonical identity of one assessment event: the accepted judge attempt plus
 * the executed verifier outcome for this cell, when one exists.
 */
export function assessmentIdentityOf(ref: AssessmentRef): string {
  const verifier = ref.verifierOutcome
    ? [
        ref.verifierOutcome.taskId,
        ref.verifierOutcome.modelKey,
        ref.verifierOutcome.passed,
        ref.verifierOutcome.executedAt,
      ]
    : null;
  return canonicalJsonString([ref.judgeAttemptId, verifier]);
}

/** The six-part idempotent observation source key (spec §5), in order. */
export function observationSourceKeyParts(
  o: Pick<
    Observation,
    | "sourceKind"
    | "sourceResultId"
    | "sourceTaskCellId"
    | "modelConfigurationId"
    | "candidateAttemptId"
    | "assessmentRef"
  >,
): [string, string, string, string, string, string] {
  return [
    o.sourceKind,
    o.sourceResultId,
    o.sourceTaskCellId,
    o.modelConfigurationId,
    o.candidateAttemptId,
    assessmentIdentityOf(o.assessmentRef),
  ];
}

/** Canonical serialization of the six-part source key (spec §5). */
export function observationSourceKey(
  o: Pick<
    Observation,
    | "sourceKind"
    | "sourceResultId"
    | "sourceTaskCellId"
    | "modelConfigurationId"
    | "candidateAttemptId"
    | "assessmentRef"
  >,
): string {
  return canonicalJsonString(observationSourceKeyParts(o));
}

/** Derived Observation id: stable and reproducible from the source key. */
export function observationIdFor(
  o: Pick<
    Observation,
    | "sourceKind"
    | "sourceResultId"
    | "sourceTaskCellId"
    | "modelConfigurationId"
    | "candidateAttemptId"
    | "assessmentRef"
  >,
): string {
  return `obs:${hashArtifactContent(observationSourceKey(o))}`;
}

/**
 * Canonical serialization of a full Observation (sorted keys, ordered arrays).
 * Used for collision deep-checks: identical canonical content must have an
 * identical id; a duplicate key with non-identical content is corruption
 * (spec §5).
 */
export function canonicalObservationJson(o: Observation): string {
  return canonicalJsonString(o);
}
