// =============================================================================
// RSemble AI — Evidence explanation (spec §12.1, §13)
//
// Fixed, safe, plain-language copy for every reason code, allowed use,
// evidence class, and eligibility status. Explanations are assembled
// exclusively from constants — never from source content — so raw candidate
// output, secrets, and rationale text cannot leak into any explanation or
// indexed field. Unknown future codes degrade to a fixed safe line.
// =============================================================================

import type {
  EligibilityDecision,
  EligibilityStatus,
  EvidenceClass,
  EvidenceReasonCode,
  EvidenceUse,
} from "./evidence-types";
import { LIMITATION_REASON_CODES } from "./evidence-eligibility";

export const EVIDENCE_REASON_EXPLANATIONS: Readonly<Record<EvidenceReasonCode, string>> = {
  anchor_designated: "This cell is an explicitly designated benchmark anchor for its Task Set.",
  assessment_missing_or_failed: "No accepted judge or verifier assessment exists for this output.",
  assessment_selected_completed: "An accepted assessment exists for this output.",
  candidate_missing_or_failed: "No completed accepted candidate output exists for this cell.",
  candidate_selected_completed: "An accepted completed candidate output exists for this cell.",
  canonical_task_resolved: "This record resolves to a canonical Task identity.",
  canonical_task_unresolved:
    "This record has no canonical Task identity yet — it is shown for inspection only.",
  full_pair_coverage: "All declared paired cells have evidence.",
  full_task_set_coverage: "Every declared roster cell of the Task Set has evidence.",
  incomplete_task_set_coverage: "Some declared roster cells are missing evidence.",
  instance_input_incomplete:
    "The exact Task Instance input is not fully reconstructable, so this cannot support profile use.",
  instance_reconstructed: "The concrete Task Instance input is reconstructable.",
  model_configuration_exact: "The model identity and version are exactly known.",
  model_configuration_incomplete: "The resolved model identity is unknown for this run.",
  model_version_unreported:
    "The resolved model version was not reported — comparisons split cohorts on this.",
  paired_cell_missing:
    "A declared paired cell is missing, so paired and standing comparisons are unavailable.",
  protocol_complete: "The execution protocol is fully recorded.",
  protocol_incomplete: "The execution protocol is incomplete, so this evidence is exploratory.",
  reused_candidate_assessment:
    "This assessment reused an earlier candidate output — it is not a new response sample.",
  rubric_resolved: "The scoring rubric and version are resolved.",
  rubric_unresolved: "The scoring rubric or its version could not be resolved.",
  source_corrupt: "This source record failed integrity checks and cannot support any use.",
  source_legacy_limited:
    "Legacy provenance is recorded as-is; no inferred identity or version was added.",
  undeclared_repeat:
    "This is a repeated execution that was not planned as a replicate before running.",
  verifier_failed:
    "The deterministic verifier failed — valid negative evidence, not a Verified result.",
  verifier_not_declared: "No deterministic verifier is declared for this task.",
  verifier_passed: "The deterministic verifier passed.",
};

export const EVIDENCE_USE_EXPLANATIONS: Readonly<Record<EvidenceUse, string>> = {
  task_descriptive: "Describe outcomes for this Task, Version, and Instance.",
  within_model_profile: "Contribute to this model configuration's profile.",
  paired_model_comparison: "Compare paired models within one protocol cohort.",
  task_set_standing: "Establish standing across the complete Task Set.",
  benchmark_anchor_analysis: "Serve as a benchmark anchor for cross-model analysis.",
};

export const EVIDENCE_CLASS_EXPLANATIONS: Readonly<Record<EvidenceClass, string>> = {
  exploratory:
    "Exploratory evidence — visible and drillable, excluded from default model profiles.",
  comparable: "Comparable evidence — controlled foundations are in place.",
  verified:
    "Verified evidence — a frozen deterministic verifier passed (or authorized human verification was recorded).",
  benchmark_anchor:
    "Benchmark anchor — explicitly designated, fully covered, frozen-protocol evidence.",
};

export const EVIDENCE_CLASS_LABELS: Readonly<Record<EvidenceClass, string>> = {
  exploratory: "Exploratory",
  comparable: "Comparable",
  verified: "Verified",
  benchmark_anchor: "Benchmark anchor",
};

export const EVIDENCE_STATUS_EXPLANATIONS: Readonly<Record<EligibilityStatus, string>> = {
  eligible: "Eligible for all declared uses of its class.",
  provisional: "Provisional — eligible only for qualified uses with disclosed limitations.",
  excluded: "Excluded — cannot support any evidence use.",
};

export const EVIDENCE_STATUS_LABELS: Readonly<Record<EligibilityStatus, string>> = {
  eligible: "Eligible",
  provisional: "Provisional",
  excluded: "Excluded",
};

export interface ExplanationLine {
  code: string;
  text: string;
}

export interface EvidenceExplanation {
  observationId: string;
  ruleVersion: number;
  classLabel: string;
  classDescription: string;
  statusLabel: string;
  statusDescription: string;
  summary: string;
  allowedUses: ExplanationLine[];
  reasonLines: ExplanationLine[];
  limitationLines: ExplanationLine[];
}

/**
 * Build the fixed plain-language explanation for a decision. Deterministic and
 * constant-copy only; unknown codes degrade to a fixed safe line.
 */
export function explainDecision(decision: EligibilityDecision): EvidenceExplanation {
  const reasonLines: ExplanationLine[] = decision.reasonCodes.map((code) => ({
    code,
    text: EVIDENCE_REASON_EXPLANATIONS[code] ?? "Unknown evidence reason code.",
  }));
  const limitationLines = reasonLines.filter(
    (line) => LIMITATION_REASON_CODES[line.code as EvidenceReasonCode] === true,
  );
  // Contextual limitation (spec §8): an output with neither an accepted
  // assessment nor a declared verifier has no validity evidence, so the
  // provisional status driven by that conjunction must carry a
  // plain-language limitation even though neither code is a standalone
  // limitation (a verifier-only cell is not limited by a missing judge; a
  // judge-only cell is not limited by a missing verifier).
  if (
    reasonLines.some((line) => line.code === "assessment_missing_or_failed") &&
    reasonLines.some((line) => line.code === "verifier_not_declared")
  ) {
    for (const code of ["assessment_missing_or_failed", "verifier_not_declared"] as const) {
      if (!limitationLines.some((line) => line.code === code)) {
        limitationLines.push({ code, text: EVIDENCE_REASON_EXPLANATIONS[code] });
      }
    }
  }
  return {
    observationId: decision.observationId,
    ruleVersion: decision.ruleVersion,
    classLabel: EVIDENCE_CLASS_LABELS[decision.evidenceClass],
    classDescription: EVIDENCE_CLASS_EXPLANATIONS[decision.evidenceClass],
    statusLabel: EVIDENCE_STATUS_LABELS[decision.status],
    statusDescription: EVIDENCE_STATUS_EXPLANATIONS[decision.status],
    summary: `${EVIDENCE_STATUS_LABELS[decision.status]} — ${EVIDENCE_CLASS_LABELS[decision.evidenceClass]}`,
    allowedUses: decision.allowedUses.map((use) => ({
      code: use,
      text: EVIDENCE_USE_EXPLANATIONS[use],
    })),
    reasonLines,
    limitationLines,
  };
}
