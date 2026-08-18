// =============================================================================
// RSemble AI — Fusion → Research Lab semantic receipt (Child 06 T4)
//
// Defines the immutable, tamper-detectable receipt emitted by the hard-migration
// preview and cutover (spec §10, §19).
//
// Invariants:
//  - Deterministic serialization: recursive sorted keys, preserved array order.
//  - Content digest: SHA-256 over canonical JSON of the receipt fields.
//  - Comprehensive reason codes: every discarded entity has an explicit,
//    unambiguous reason code.
//  - Empty converted set with complete discard receipt is valid.
//  - Never invents or guesses field values.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { isNonBlankString, isRecord } from "../persistence/run-types";
import { isStudyFingerprint } from "../studies/study-fingerprint";

export const RECEIPT_SCHEMA_VERSION = 1;

export const FUSION_STORE_NAMES = [
  "fusionRecipes",
  "poolManifests",
  "fusionStudies",
  "fusionTrials",
  "fusionAttempts",
  "fusionObservations",
  "fusionPlaybooks",
] as const;

export type FusionStoreName = (typeof FUSION_STORE_NAMES)[number];

export const DISCARD_REASON_CODES = [
  "unresolved_task_set_owner",
  "missing_task_set_crosswalk",
  "missing_manifest_digest",
  "invalid_protocol_fingerprint",
  "critic_ref_not_mc_sha256",
  "candidate_members_not_mc_sha256",
  "synthesizer_not_mc_sha256",
  "missing_rubric",
  "missing_recipe_refs",
  "missing_pool_digest",
  "missing_recipe_digest",
  "invalid_artifact_hash",
  "missing_study_title",
  "missing_policies",
  "missing_stage_protocol_version",
  "stage_results_untyped",
  "untyped_trial_envelope_fields",
  "missing_study_id",
  "parent_study_discarded",
  "referenced_trial_discarded",
  "pool_adequacy_unconfirmed_not_supported",
  "missing_definition_fingerprint",
  "missing_recipe_sensitivity",
  "missing_supporting_ids",
  "missing_report_schema_version",
  "missing_recipe_metadata",
  "missing_pool_metadata",
  "prohibited_keys_detected",
  "development_corpus_discarded",
  "validation_failure",
] as const;

export type DiscardReasonCode = (typeof DISCARD_REASON_CODES)[number];

export function isDiscardReasonCode(v: unknown): v is DiscardReasonCode {
  return typeof v === "string" && (DISCARD_REASON_CODES as readonly string[]).includes(v);
}

export interface LosslessConvertDecision {
  store: FusionStoreName;
  id: string;
  status: "lossless_convert";
  reasonCode?: undefined;
  details?: string;
}

export interface DiscardDecision {
  store: FusionStoreName;
  id: string;
  status: "discard";
  reasonCode: DiscardReasonCode;
  details?: string;
}

export type RecordDecision = LosslessConvertDecision | DiscardDecision;

export function isRecordDecision(v: unknown): v is RecordDecision {
  if (!isRecord(v)) return false;
  if (
    typeof v.store !== "string" ||
    !(FUSION_STORE_NAMES as readonly string[]).includes(v.store as FusionStoreName)
  )
    return false;
  if (!isNonBlankString(v.id)) return false;
  if (v.status !== "lossless_convert" && v.status !== "discard") return false;
  if (v.status === "discard") {
    if (!isDiscardReasonCode(v.reasonCode)) return false;
  }
  if (v.details !== undefined && typeof v.details !== "string") return false;
  return true;
}

export interface ConvertedEntityCounts {
  labRecipeRecords: number;
  labRecipeVersions: number;
  modelPoolRecords: number;
  modelPoolVersions: number;
  studies: number;
  studyTrials: number;
  studyAttempts: number;
  studyObservations: number;
  policyPlaybooks: number;
}

export interface FusionToResearchLabReceipt {
  receiptSchemaVersion: number;
  generatedAt: number;
  sourceCounts: Record<FusionStoreName, number>;
  convertedCounts: ConvertedEntityCounts;
  discardedCounts: Record<FusionStoreName, number>;
  totalSourceRecords: number;
  totalConvertedRecords: number;
  totalDiscardedRecords: number;
  decisions: RecordDecision[];
  receiptDigest: string;
  status: "preview_completed" | "preview_aborted";
  note?: string;
}

/**
 * Deterministic JSON representation of the receipt fields for content hashing.
 * Excludes `receiptDigest` itself.
 */
export function canonicalReceiptJson(
  receipt: Omit<FusionToResearchLabReceipt, "receiptDigest"> | FusionToResearchLabReceipt,
): string {
  return canonicalJsonString({
    receiptSchemaVersion: receipt.receiptSchemaVersion,
    generatedAt: receipt.generatedAt,
    sourceCounts: receipt.sourceCounts,
    convertedCounts: receipt.convertedCounts,
    discardedCounts: receipt.discardedCounts,
    totalSourceRecords: receipt.totalSourceRecords,
    totalConvertedRecords: receipt.totalConvertedRecords,
    totalDiscardedRecords: receipt.totalDiscardedRecords,
    decisions: receipt.decisions,
    status: receipt.status,
    note: receipt.note ?? null,
  });
}

/** Computes the canonical SHA-256 digest of a receipt. */
export function computeReceiptDigest(
  receipt: Omit<FusionToResearchLabReceipt, "receiptDigest">,
): string {
  return hashArtifactContent(canonicalReceiptJson(receipt));
}

export function isFusionToResearchLabReceipt(v: unknown): v is FusionToResearchLabReceipt {
  if (!isRecord(v)) return false;
  if (v.receiptSchemaVersion !== RECEIPT_SCHEMA_VERSION) return false;
  if (typeof v.generatedAt !== "number" || !Number.isFinite(v.generatedAt) || v.generatedAt < 0)
    return false;
  if (!isRecord(v.sourceCounts) || !isRecord(v.convertedCounts) || !isRecord(v.discardedCounts))
    return false;

  for (const store of FUSION_STORE_NAMES) {
    if (typeof (v.sourceCounts as Record<string, unknown>)[store] !== "number") return false;
    if (typeof (v.discardedCounts as Record<string, unknown>)[store] !== "number") return false;
  }

  const convertedKeys = [
    "labRecipeRecords",
    "labRecipeVersions",
    "modelPoolRecords",
    "modelPoolVersions",
    "studies",
    "studyTrials",
    "studyAttempts",
    "studyObservations",
    "policyPlaybooks",
  ];
  for (const k of convertedKeys) {
    if (typeof (v.convertedCounts as Record<string, unknown>)[k] !== "number") return false;
  }

  if (
    typeof v.totalSourceRecords !== "number" ||
    typeof v.totalConvertedRecords !== "number" ||
    typeof v.totalDiscardedRecords !== "number"
  )
    return false;

  if (!Array.isArray(v.decisions) || !v.decisions.every(isRecordDecision)) return false;
  if (v.status !== "preview_completed" && v.status !== "preview_aborted") return false;
  if (v.note !== undefined && typeof v.note !== "string") return false;
  if (typeof v.receiptDigest !== "string" || !isStudyFingerprint(v.receiptDigest)) return false;

  // Tamper detection: verify that receiptDigest matches canonical payload
  const expectedDigest = computeReceiptDigest(
    v as unknown as Omit<FusionToResearchLabReceipt, "receiptDigest">,
  );
  if (v.receiptDigest !== expectedDigest) return false;

  return true;
}

export interface CreateReceiptParams {
  generatedAt: number;
  sourceCounts: Record<FusionStoreName, number>;
  convertedCounts: ConvertedEntityCounts;
  discardedCounts: Record<FusionStoreName, number>;
  decisions: RecordDecision[];
  status?: "preview_completed" | "preview_aborted";
  note?: string;
}

export function createDeterministicReceipt(
  params: CreateReceiptParams,
): FusionToResearchLabReceipt {
  let totalSource = 0;
  for (const store of FUSION_STORE_NAMES) {
    totalSource += params.sourceCounts[store] ?? 0;
  }

  let totalConverted = 0;
  totalConverted += params.convertedCounts.labRecipeRecords ?? 0;
  totalConverted += params.convertedCounts.labRecipeVersions ?? 0;
  totalConverted += params.convertedCounts.modelPoolRecords ?? 0;
  totalConverted += params.convertedCounts.modelPoolVersions ?? 0;
  totalConverted += params.convertedCounts.studies ?? 0;
  totalConverted += params.convertedCounts.studyTrials ?? 0;
  totalConverted += params.convertedCounts.studyAttempts ?? 0;
  totalConverted += params.convertedCounts.studyObservations ?? 0;
  totalConverted += params.convertedCounts.policyPlaybooks ?? 0;

  let totalDiscarded = 0;
  for (const store of FUSION_STORE_NAMES) {
    totalDiscarded += params.discardedCounts[store] ?? 0;
  }

  // Sort decisions deterministically: store order, then id
  const storeRank: Record<FusionStoreName, number> = {
    fusionRecipes: 0,
    poolManifests: 1,
    fusionStudies: 2,
    fusionTrials: 3,
    fusionAttempts: 4,
    fusionObservations: 5,
    fusionPlaybooks: 6,
  };

  const sortedDecisions = [...params.decisions].sort((a, b) => {
    const sDiff = storeRank[a.store] - storeRank[b.store];
    if (sDiff !== 0) return sDiff;
    return a.id.localeCompare(b.id);
  });

  const base: Omit<FusionToResearchLabReceipt, "receiptDigest"> = {
    receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
    generatedAt: params.generatedAt,
    sourceCounts: {
      fusionRecipes: params.sourceCounts.fusionRecipes ?? 0,
      poolManifests: params.sourceCounts.poolManifests ?? 0,
      fusionStudies: params.sourceCounts.fusionStudies ?? 0,
      fusionTrials: params.sourceCounts.fusionTrials ?? 0,
      fusionAttempts: params.sourceCounts.fusionAttempts ?? 0,
      fusionObservations: params.sourceCounts.fusionObservations ?? 0,
      fusionPlaybooks: params.sourceCounts.fusionPlaybooks ?? 0,
    },
    convertedCounts: {
      labRecipeRecords: params.convertedCounts.labRecipeRecords ?? 0,
      labRecipeVersions: params.convertedCounts.labRecipeVersions ?? 0,
      modelPoolRecords: params.convertedCounts.modelPoolRecords ?? 0,
      modelPoolVersions: params.convertedCounts.modelPoolVersions ?? 0,
      studies: params.convertedCounts.studies ?? 0,
      studyTrials: params.convertedCounts.studyTrials ?? 0,
      studyAttempts: params.convertedCounts.studyAttempts ?? 0,
      studyObservations: params.convertedCounts.studyObservations ?? 0,
      policyPlaybooks: params.convertedCounts.policyPlaybooks ?? 0,
    },
    discardedCounts: {
      fusionRecipes: params.discardedCounts.fusionRecipes ?? 0,
      poolManifests: params.discardedCounts.poolManifests ?? 0,
      fusionStudies: params.discardedCounts.fusionStudies ?? 0,
      fusionTrials: params.discardedCounts.fusionTrials ?? 0,
      fusionAttempts: params.discardedCounts.fusionAttempts ?? 0,
      fusionObservations: params.discardedCounts.fusionObservations ?? 0,
      fusionPlaybooks: params.discardedCounts.fusionPlaybooks ?? 0,
    },
    totalSourceRecords: totalSource,
    totalConvertedRecords: totalConverted,
    totalDiscardedRecords: totalDiscarded,
    decisions: sortedDecisions,
    status: params.status ?? "preview_completed",
    ...(params.note ? { note: params.note } : {}),
  };

  const receiptDigest = computeReceiptDigest(base);

  return {
    ...base,
    receiptDigest,
  };
}
