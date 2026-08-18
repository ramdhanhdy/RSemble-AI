// =============================================================================
// RSemble AI — Fusion → Research Lab migration semantic receipt tests (Child 06 T4)
//
// Tests for the deterministic semantic receipt emitted during the Fusion → Lab
// hard-migration preview. Validates schema conformity, tamper detection via
// canonical JSON digest, reason code classification, and all-discard receipt.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  DISCARD_REASON_CODES,
  FUSION_STORE_NAMES,
  RECEIPT_SCHEMA_VERSION,
  canonicalReceiptJson,
  computeReceiptDigest,
  createDeterministicReceipt,
  isFusionToResearchLabReceipt,
  isRecordDecision,
  type DiscardReasonCode,
  type FusionToResearchLabReceipt,
  type RecordDecision,
} from "./fusion-to-research-lab-receipt";

describe("Fusion → Research Lab migration receipt", () => {
  it("exports expected schema version and stores", () => {
    expect(RECEIPT_SCHEMA_VERSION).toBe(1);
    expect(FUSION_STORE_NAMES).toEqual([
      "fusionRecipes",
      "poolManifests",
      "fusionStudies",
      "fusionTrials",
      "fusionAttempts",
      "fusionObservations",
      "fusionPlaybooks",
    ]);
  });

  it("includes all required discard reason codes", () => {
    const requiredCodes: DiscardReasonCode[] = [
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
    ];

    for (const code of requiredCodes) {
      expect(DISCARD_REASON_CODES).toContain(code);
    }
  });

  it("validates record decisions: discard requires a valid reasonCode", () => {
    // Discard without reasonCode must be rejected
    expect(
      isRecordDecision({
        store: "fusionStudies",
        id: "study-1",
        status: "discard",
      }),
    ).toBe(false);

    // Discard with invalid reasonCode must be rejected
    expect(
      isRecordDecision({
        store: "fusionStudies",
        id: "study-1",
        status: "discard",
        reasonCode: "not_a_valid_reason_code",
      }),
    ).toBe(false);

    // Discard with valid reasonCode must be accepted
    expect(
      isRecordDecision({
        store: "fusionStudies",
        id: "study-1",
        status: "discard",
        reasonCode: "missing_recipe_refs",
      }),
    ).toBe(true);

    // Lossless convert without reasonCode is valid
    expect(
      isRecordDecision({
        store: "fusionStudies",
        id: "study-1",
        status: "lossless_convert",
      }),
    ).toBe(true);
  });

  it("creates a valid deterministic receipt for an all-discard preview", () => {
    const decisions: RecordDecision[] = [
      {
        store: "fusionStudies",
        id: "study-unresolved-owner",
        status: "discard",
        reasonCode: "unresolved_task_set_owner",
        details: "Suite→Task Set crosswalk unresolved",
      },
      {
        store: "fusionStudies",
        id: "study-exploration-completed",
        status: "discard",
        reasonCode: "critic_ref_not_mc_sha256",
        details: "Judges are CriticRef rather than mc:sha256 exact model configuration",
      },
    ];

    const sourceCounts = {
      fusionRecipes: 0,
      poolManifests: 0,
      fusionStudies: 2,
      fusionTrials: 0,
      fusionAttempts: 0,
      fusionObservations: 0,
      fusionPlaybooks: 0,
    };

    const convertedCounts = {
      labRecipeRecords: 0,
      labRecipeVersions: 0,
      modelPoolRecords: 0,
      modelPoolVersions: 0,
      studies: 0,
      studyTrials: 0,
      studyAttempts: 0,
      studyObservations: 0,
      policyPlaybooks: 0,
    };

    const discardedCounts = {
      fusionRecipes: 0,
      poolManifests: 0,
      fusionStudies: 2,
      fusionTrials: 0,
      fusionAttempts: 0,
      fusionObservations: 0,
      fusionPlaybooks: 0,
    };

    const receipt = createDeterministicReceipt({
      generatedAt: 1700000000000,
      sourceCounts,
      convertedCounts,
      discardedCounts,
      decisions,
      status: "preview_completed",
      note: "User-authorized discard preview",
    });

    expect(isFusionToResearchLabReceipt(receipt)).toBe(true);
    expect(receipt.receiptSchemaVersion).toBe(1);
    expect(receipt.totalSourceRecords).toBe(2);
    expect(receipt.totalConvertedRecords).toBe(0);
    expect(receipt.totalDiscardedRecords).toBe(2);
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("computes identical receipt digests regardless of property insertion order", () => {
    const decisions: RecordDecision[] = [
      {
        store: "fusionRecipes",
        id: "recipe-1:v1",
        status: "discard",
        reasonCode: "missing_recipe_metadata",
      },
    ];

    const counts = {
      fusionRecipes: 1,
      poolManifests: 0,
      fusionStudies: 0,
      fusionTrials: 0,
      fusionAttempts: 0,
      fusionObservations: 0,
      fusionPlaybooks: 0,
    };

    const converted = {
      labRecipeRecords: 0,
      labRecipeVersions: 0,
      modelPoolRecords: 0,
      modelPoolVersions: 0,
      studies: 0,
      studyTrials: 0,
      studyAttempts: 0,
      studyObservations: 0,
      policyPlaybooks: 0,
    };

    const r1 = createDeterministicReceipt({
      generatedAt: 1000,
      sourceCounts: counts,
      convertedCounts: converted,
      discardedCounts: counts,
      decisions,
      status: "preview_completed",
    });

    // Re-create with different object key ordering in parameters
    const r2 = createDeterministicReceipt({
      status: "preview_completed",
      decisions,
      discardedCounts: counts,
      convertedCounts: converted,
      sourceCounts: counts,
      generatedAt: 1000,
    });

    expect(r1.receiptDigest).toBe(r2.receiptDigest);
    expect(canonicalReceiptJson(r1)).toBe(canonicalReceiptJson(r2));
  });
  it("computes expected digest with computeReceiptDigest", () => {
    const receipt = createDeterministicReceipt({
      generatedAt: 1000,
      sourceCounts: {
        fusionRecipes: 0,
        poolManifests: 0,
        fusionStudies: 0,
        fusionTrials: 0,
        fusionAttempts: 0,
        fusionObservations: 0,
        fusionPlaybooks: 0,
      },
      convertedCounts: {
        labRecipeRecords: 0,
        labRecipeVersions: 0,
        modelPoolRecords: 0,
        modelPoolVersions: 0,
        studies: 0,
        studyTrials: 0,
        studyAttempts: 0,
        studyObservations: 0,
        policyPlaybooks: 0,
      },
      discardedCounts: {
        fusionRecipes: 0,
        poolManifests: 0,
        fusionStudies: 0,
        fusionTrials: 0,
        fusionAttempts: 0,
        fusionObservations: 0,
        fusionPlaybooks: 0,
      },
      decisions: [],
      status: "preview_completed",
    });
    const digest = computeReceiptDigest(receipt);
    expect(digest).toBe(receipt.receiptDigest);
  });

  it("tamper detection: rejects receipt with modified count or decision", () => {
    const receipt = createDeterministicReceipt({
      generatedAt: 1000,
      sourceCounts: {
        fusionRecipes: 1,
        poolManifests: 0,
        fusionStudies: 0,
        fusionTrials: 0,
        fusionAttempts: 0,
        fusionObservations: 0,
        fusionPlaybooks: 0,
      },
      convertedCounts: {
        labRecipeRecords: 0,
        labRecipeVersions: 0,
        modelPoolRecords: 0,
        modelPoolVersions: 0,
        studies: 0,
        studyTrials: 0,
        studyAttempts: 0,
        studyObservations: 0,
        policyPlaybooks: 0,
      },
      discardedCounts: {
        fusionRecipes: 1,
        poolManifests: 0,
        fusionStudies: 0,
        fusionTrials: 0,
        fusionAttempts: 0,
        fusionObservations: 0,
        fusionPlaybooks: 0,
      },
      decisions: [
        {
          store: "fusionRecipes",
          id: "recipe-1",
          status: "discard",
          reasonCode: "missing_recipe_metadata",
        },
      ],
      status: "preview_completed",
    });

    expect(isFusionToResearchLabReceipt(receipt)).toBe(true);

    // Tamper with totalConvertedRecords without recomputing digest
    const tampered1: FusionToResearchLabReceipt = {
      ...receipt,
      totalConvertedRecords: 99,
    };
    expect(isFusionToResearchLabReceipt(tampered1)).toBe(false);

    // Tamper with decision reason
    const tampered2: FusionToResearchLabReceipt = {
      ...receipt,
      decisions: [
        {
          store: "fusionRecipes",
          id: "recipe-1",
          status: "lossless_convert",
        },
      ],
    };
    expect(isFusionToResearchLabReceipt(tampered2)).toBe(false);
  });
});
