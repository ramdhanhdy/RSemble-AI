// =============================================================================
// evidence-types.test.ts — vocabulary lock for the canonical evidence domain
// (observations-and-evidence spec §3, §8).
//
// These tests pin the fixed vocabularies (classes, uses, reason codes,
// completeness kinds, schema version) so an accidental edit that renames or
// drops a code fails loudly instead of silently changing classification output.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_REASON_CODES,
  EVIDENCE_USES,
  IDENTITY_COMPLETENESS_KINDS,
  OBSERVATION_SCHEMA_VERSION,
} from "./evidence-types";

describe("evidence domain vocabulary", () => {
  it("locks the observation schema version", () => {
    expect(OBSERVATION_SCHEMA_VERSION).toBe(1);
  });

  it("locks evidence classes in canonical order", () => {
    expect(EVIDENCE_CLASSES).toEqual([
      "exploratory",
      "comparable",
      "verified",
      "benchmark_anchor",
    ]);
  });

  it("locks allowed evidence uses in canonical order", () => {
    expect(EVIDENCE_USES).toEqual([
      "task_descriptive",
      "within_model_profile",
      "paired_model_comparison",
      "task_set_standing",
      "benchmark_anchor_analysis",
    ]);
  });

  it("locks identity completeness kinds", () => {
    expect(IDENTITY_COMPLETENESS_KINDS).toEqual(["exact", "rolling_alias", "partial"]);
  });

  it("locks the reason-code vocabulary (alphabetical canonical order)", () => {
    expect(EVIDENCE_REASON_CODES).toEqual([
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
    ]);
  });

  it("reason codes are unique and already sorted", () => {
    const sorted = [...EVIDENCE_REASON_CODES].sort();
    expect(EVIDENCE_REASON_CODES).toEqual(sorted);
    expect(new Set(EVIDENCE_REASON_CODES).size).toBe(EVIDENCE_REASON_CODES.length);
  });
});
