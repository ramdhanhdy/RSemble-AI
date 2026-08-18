// =============================================================================
// RSemble AI — Policy Study specialization (spec §5)
//
// Pure validators and serializers for the single registered study kind. The
// Policy Study preserves the proven staged methodology: it pins an exact Task
// Set Version, Model Pool, Fusion Recipes, judges, Rubric, and protocol, then
// compares the fixed four policies — best_fixed, rank, fuse, refine — and
// produces an immutable Policy Playbook. `do_not_fuse` is a first-class
// recommendation, not a failure status.
//
// No persistence, provider, or UI lives here. No Routing/Judge/Workflow
// payloads or enum placeholders are encoded.
// =============================================================================

import {
  hasProhibitedStudyKeys,
  isStudyObservationEnvelope,
  isStudyRecordEnvelope,
  isStudyTrialEnvelope,
  type StudyClaimLevel,
  type StudyObservation,
  type StudyRecord,
  type StudyTrial,
} from "../study-types";

import {
  type PersistedError,
  isNonBlankString,
  isPersistedError,
  isRecord,
} from "../../persistence/run-types";
import { fingerprintStudyValue, isStudyFingerprint } from "../study-fingerprint";
import type { StudyTypeRegistration } from "../study-registry";

// --- Fixed four policies ------------------------------------------------------

export type PolicyKind = "best_fixed" | "rank" | "fuse" | "refine";

export const POLICY_KINDS: readonly PolicyKind[] = ["best_fixed", "rank", "fuse", "refine"];

export function isPolicyKind(v: unknown): v is PolicyKind {
  return typeof v === "string" && (POLICY_KINDS as readonly string[]).includes(v);
}

// --- Claim plan ---------------------------------------------------------------

export type PolicyClaimPlan = "exploration" | "confirmation";

export const POLICY_CLAIM_PLANS: readonly PolicyClaimPlan[] = ["exploration", "confirmation"];

function isPolicyClaimPlan(v: unknown): v is PolicyClaimPlan {
  return typeof v === "string" && (POLICY_CLAIM_PLANS as readonly string[]).includes(v);
}

// --- Exact model configuration ref --------------------------------------------

const MC_ID_RE = /^mc:sha256:[0-9a-f]{64}$/;

/**
 * Reference to an exact, content-addressed model configuration. The id is the
 * canonical `mc:sha256:<64 lowercase hex>` shape — the configuration's
 * identity is its content hash, never a display name.
 */
export interface ExactModelConfigurationRef {
  id: string;
}

export function isExactModelConfigurationRef(v: unknown): v is ExactModelConfigurationRef {
  return isRecord(v) && typeof v.id === "string" && MC_ID_RE.test(v.id);
}

// --- Schema versions ----------------------------------------------------------

export const POLICY_STUDY_KIND = "policy" as const;
export const POLICY_DEFINITION_SCHEMA_VERSION = 1;
export const POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION = 1;
export const POLICY_MEASUREMENT_SCHEMA_VERSION = 1;
export const POLICY_REPORT_SCHEMA_VERSION = 1;

// --- PolicyStudyDefinition (spec §5) ------------------------------------------

export interface PolicyStudyDefinition {
  workload: { taskSetId: string; version: number; manifestDigest: string };
  modelPool: { poolId: string; version: number; digest: string };
  fusionRecipes: Array<{ recipeId: string; version: number; digest: string }>;
  judge1: ExactModelConfigurationRef;
  judge2: ExactModelConfigurationRef;
  rubric: { rubricId: string; version: number };
  protocolFingerprint: string;
  policies: PolicyKind[];
  stageProtocolVersion: number;
  claimPlan: PolicyClaimPlan;
}

function isVersionedRef(v: unknown, idKey: string): v is { [k: string]: unknown } {
  return (
    isRecord(v) &&
    isNonBlankString(v[idKey]) &&
    typeof v.version === "number" &&
    Number.isFinite(v.version) &&
    Number.isInteger(v.version) &&
    v.version > 0
  );
}

function isDigestRef(v: unknown, idKey: string): v is Record<string, unknown> {
  return isRecord(v) && isNonBlankString(v[idKey]) && isStudyFingerprint(v.digest);
}

export function isPolicyStudyDefinition(v: unknown): v is PolicyStudyDefinition {
  if (!isRecord(v)) return false;
  // workload
  if (!isRecord(v.workload)) return false;
  if (!isNonBlankString(v.workload.taskSetId)) return false;
  if (
    typeof v.workload.version !== "number" ||
    !Number.isFinite(v.workload.version) ||
    !Number.isInteger(v.workload.version) ||
    v.workload.version <= 0
  )
    return false;
  if (!isStudyFingerprint(v.workload.manifestDigest)) return false;
  // modelPool
  if (!isDigestRef(v.modelPool, "poolId")) return false;
  if (
    typeof v.modelPool.version !== "number" ||
    !Number.isFinite(v.modelPool.version) ||
    !Number.isInteger(v.modelPool.version) ||
    v.modelPool.version <= 0
  )
    return false;
  // fusionRecipes
  if (!Array.isArray(v.fusionRecipes) || v.fusionRecipes.length === 0) return false;
  for (const r of v.fusionRecipes) {
    if (!isDigestRef(r, "recipeId")) return false;
    if (
      typeof r.version !== "number" ||
      !Number.isFinite(r.version) ||
      !Number.isInteger(r.version) ||
      r.version <= 0
    )
      return false;
  }
  // judges
  if (!isExactModelConfigurationRef(v.judge1)) return false;
  if (!isExactModelConfigurationRef(v.judge2)) return false;
  // rubric
  if (!isVersionedRef(v.rubric, "rubricId")) return false;
  // protocolFingerprint
  if (!isStudyFingerprint(v.protocolFingerprint)) return false;
  // policies — at least one from the fixed four
  if (!Array.isArray(v.policies) || v.policies.length === 0) return false;
  if (!v.policies.every(isPolicyKind)) return false;
  // stageProtocolVersion
  if (
    typeof v.stageProtocolVersion !== "number" ||
    !Number.isFinite(v.stageProtocolVersion) ||
    !Number.isInteger(v.stageProtocolVersion) ||
    v.stageProtocolVersion <= 0
  )
    return false;
  // claimPlan
  if (!isPolicyClaimPlan(v.claimPlan)) return false;
  // prohibited keys at any depth
  if (hasProhibitedKeysDeep(v)) return false;
  return true;
}

// --- PolicyTrialPayload -------------------------------------------------------

export interface PolicyTrialPayload {
  policy: PolicyKind;
  stage: "A" | "B" | "C";
  candidateConfig: { members: ExactModelConfigurationRef[] };
  recipeRef: { recipeId: string; version: number; digest: string } | null;
  synthesizer: ExactModelConfigurationRef | null;
}

const POLICY_STAGES = ["A", "B", "C"] as const;

export function isPolicyTrialPayload(v: unknown): v is PolicyTrialPayload {
  if (!isRecord(v) || hasProhibitedKeysDeep(v)) return false;
  if (!isPolicyKind(v.policy)) return false;
  if (typeof v.stage !== "string" || !POLICY_STAGES.includes(v.stage as never)) return false;
  if (!isRecord(v.candidateConfig) || !Array.isArray(v.candidateConfig.members)) return false;
  if (!v.candidateConfig.members.every(isExactModelConfigurationRef)) return false;
  if (v.candidateConfig.members.length === 0) return false;
  // recipeRef
  if (v.recipeRef !== null) {
    if (!isDigestRef(v.recipeRef, "recipeId")) return false;
    if (
      typeof v.recipeRef.version !== "number" ||
      !Number.isFinite(v.recipeRef.version) ||
      !Number.isInteger(v.recipeRef.version) ||
      v.recipeRef.version <= 0
    )
      return false;
  }
  // synthesizer
  if (v.synthesizer !== null && !isExactModelConfigurationRef(v.synthesizer)) return false;
  // Policy/ref consistency: fuse requires recipe + synthesizer; refine requires
  // synthesizer (recipe optional for confound provenance); rank and best_fixed
  // carry neither.
  switch (v.policy) {
    case "fuse":
      if (v.recipeRef === null || v.synthesizer === null) return false;
      break;
    case "refine":
      if (v.synthesizer === null) return false;
      break;
    case "rank":
    case "best_fixed":
      if (v.recipeRef !== null || v.synthesizer !== null) return false;
      break;
  }
  return true;
}

// --- PolicyMeasurementPayload -------------------------------------------------

export interface PolicyMeasurementPayload {
  judge: ExactModelConfigurationRef;
  overallScore: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: PersistedError | null;
}

export function isPolicyMeasurementPayload(v: unknown): v is PolicyMeasurementPayload {
  if (!isRecord(v) || hasProhibitedKeysDeep(v)) return false;
  if (!isExactModelConfigurationRef(v.judge)) return false;
  if (v.overallScore !== null) {
    if (typeof v.overallScore !== "number" || !Number.isFinite(v.overallScore)) return false;
  }
  if (v.tokensIn !== null) {
    if (typeof v.tokensIn !== "number" || !Number.isFinite(v.tokensIn) || v.tokensIn < 0)
      return false;
  }
  if (v.tokensOut !== null) {
    if (typeof v.tokensOut !== "number" || !Number.isFinite(v.tokensOut) || v.tokensOut < 0)
      return false;
  }
  if (v.error !== null && !isPersistedError(v.error)) return false;
  return true;
}

// --- PolicyReportPayload (the Policy Playbook, spec §5) -----------------------

export interface PolicyPlaybookRow {
  policy: PolicyKind;
  configuration: string;
  meanOutcome: number;
  lift: number;
  costMultiplier: number;
  confidence: "high" | "medium" | "low";
}

const POLICY_CONFIDENCES = ["high", "medium", "low"] as const;

export function isPolicyPlaybookRow(v: unknown): v is PolicyPlaybookRow {
  if (!isRecord(v) || hasProhibitedKeysDeep(v)) return false;
  if (!isPolicyKind(v.policy)) return false;
  if (!isNonBlankString(v.configuration)) return false;
  if (typeof v.meanOutcome !== "number" || !Number.isFinite(v.meanOutcome)) return false;
  if (typeof v.lift !== "number" || !Number.isFinite(v.lift)) return false;
  if (typeof v.costMultiplier !== "number" || !Number.isFinite(v.costMultiplier)) return false;
  if (typeof v.confidence !== "string" || !POLICY_CONFIDENCES.includes(v.confidence as never))
    return false;
  return true;
}

export type PolicyRecommendation =
  | { kind: "adopt"; policy: PolicyKind; configuration: string; rationale: string }
  | { kind: "do_not_fuse"; rationale: string };

export function isPolicyRecommendation(v: unknown): v is PolicyRecommendation {
  if (!isRecord(v) || hasProhibitedKeysDeep(v)) return false;
  if (v.kind === "adopt") {
    if (!isPolicyKind(v.policy)) return false;
    if (!isNonBlankString(v.configuration)) return false;
    if (!isNonBlankString(v.rationale)) return false;
    return true;
  }
  if (v.kind === "do_not_fuse") {
    if (!isNonBlankString(v.rationale)) return false;
    return true;
  }
  return false;
}

export interface PolicyReportPayload {
  studyId: string;
  definitionFingerprint: string;
  rows: PolicyPlaybookRow[];
  recommendation: PolicyRecommendation;
  poolAdequacy: {
    probed: boolean;
    outcome: "confirmed" | "unconfirmed" | "rejected";
    note: string;
  };
  recipeSensitivity: { checked: boolean; note: string };
  claimLevel: StudyClaimLevel;
  conclusion: string;
  supportingTrialIds: string[];
  supportingObservationIds: string[];
  reportSchemaVersion: number;
  createdAt: number;
}

export function isPolicyReportPayload(v: unknown): v is PolicyReportPayload {
  if (!isRecord(v) || hasProhibitedKeysDeep(v)) return false;
  if (!isNonBlankString(v.studyId)) return false;
  if (!isStudyFingerprint(v.definitionFingerprint)) return false;
  if (!Array.isArray(v.rows) || !v.rows.every(isPolicyPlaybookRow)) return false;
  if (v.rows.length === 0) return false;
  if (!isPolicyRecommendation(v.recommendation)) return false;
  // poolAdequacy
  if (!isRecord(v.poolAdequacy)) return false;
  if (typeof v.poolAdequacy.probed !== "boolean") return false;
  if (
    v.poolAdequacy.outcome !== "confirmed" &&
    v.poolAdequacy.outcome !== "unconfirmed" &&
    v.poolAdequacy.outcome !== "rejected"
  )
    return false;
  if (!isNonBlankString(v.poolAdequacy.note)) return false;
  // recipeSensitivity
  if (!isRecord(v.recipeSensitivity)) return false;
  if (typeof v.recipeSensitivity.checked !== "boolean") return false;
  if (!isNonBlankString(v.recipeSensitivity.note)) return false;
  // claimLevel
  if (
    typeof v.claimLevel !== "string" ||
    (v.claimLevel !== "exploratory" && v.claimLevel !== "confirmed")
  )
    return false;
  if (!isNonBlankString(v.conclusion)) return false;
  if (!Array.isArray(v.supportingTrialIds) || !v.supportingTrialIds.every(isNonBlankString))
    return false;
  if (
    !Array.isArray(v.supportingObservationIds) ||
    !v.supportingObservationIds.every(isNonBlankString)
  )
    return false;
  if (
    typeof v.reportSchemaVersion !== "number" ||
    !Number.isFinite(v.reportSchemaVersion) ||
    !Number.isInteger(v.reportSchemaVersion) ||
    v.reportSchemaVersion <= 0
  )
    return false;
  if (v.reportSchemaVersion !== POLICY_REPORT_SCHEMA_VERSION) return false;
  if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt) || v.createdAt < 0)
    return false;
  return true;
}

// --- Composite policy study records -------------------------------------------

export type PolicyStudyRecord = StudyRecord<PolicyStudyDefinition>;
export type PolicyStudyTrial = StudyTrial<PolicyTrialPayload>;
export type PolicyStudyObservation = StudyObservation<PolicyMeasurementPayload>;

export function isPolicyStudyRecord(v: unknown): v is PolicyStudyRecord {
  if (!isStudyRecordEnvelope(v)) return false;
  if (v.definitionSchemaVersion !== POLICY_DEFINITION_SCHEMA_VERSION) return false;
  if (!isPolicyStudyDefinition(v.definition)) return false;
  if (v.definitionFingerprint !== fingerprintStudyValue(v.definition)) return false;
  // exploration/confirmation linkage + no claim promotion by mutation
  const def = v.definition as PolicyStudyDefinition;
  if (def.claimPlan === "confirmation" && v.claimLevel !== "confirmed") return false;
  if (def.claimPlan === "exploration" && v.claimLevel !== "exploratory") return false;
  return true;
}

export function isPolicyStudyTrial(v: unknown): v is PolicyStudyTrial {
  if (!isStudyTrialEnvelope(v)) return false;
  if (v.payloadSchemaVersion !== POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION) return false;
  if (!isPolicyTrialPayload(v.payload)) return false;
  if (v.payloadFingerprint !== fingerprintStudyValue(v.payload)) return false;
  return true;
}

export function isPolicyStudyObservation(v: unknown): v is PolicyStudyObservation {
  if (!isStudyObservationEnvelope(v)) return false;
  if (v.payloadSchemaVersion !== POLICY_MEASUREMENT_SCHEMA_VERSION) return false;
  if (!isPolicyMeasurementPayload(v.payload)) return false;
  return true;
}

// --- Registration (spec §4.1) -------------------------------------------------

export const policyStudyRegistration: StudyTypeRegistration<
  PolicyStudyDefinition,
  PolicyTrialPayload,
  PolicyMeasurementPayload,
  PolicyReportPayload
> = {
  kind: POLICY_STUDY_KIND,
  schemaVersion: POLICY_DEFINITION_SCHEMA_VERSION,
  validateDefinition: isPolicyStudyDefinition,
  validateTrialPayload: isPolicyTrialPayload,
  validateObservationPayload: isPolicyMeasurementPayload,
  validateReportPayload: isPolicyReportPayload,
  fingerprintDefinition: (def) => fingerprintStudyValue(def),
};

// --- Prohibited-key deep scan (shared with the common envelope) ---------------

function hasProhibitedKeysDeep(v: unknown): boolean {
  return hasProhibitedStudyKeys(v);
}
