// =============================================================================
// evidence-explanation.test.ts — fixed, safe explanation copy
// (observations-and-evidence spec §12.1, §13).
//
// Every reason code, use, class, and status has fixed plain-language copy.
// Explanations are built exclusively from constants — never from source
// content — and unknown future codes degrade to a fixed line.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_REASON_CODES,
  EVIDENCE_USES,
  ELIGIBILITY_STATUSES,
  type EligibilityDecision,
} from "./evidence-types";
import {
  EVIDENCE_CLASS_EXPLANATIONS,
  EVIDENCE_REASON_EXPLANATIONS,
  EVIDENCE_STATUS_EXPLANATIONS,
  EVIDENCE_USE_EXPLANATIONS,
  explainDecision,
} from "./evidence-explanation";

function makeDecision(overrides: Partial<EligibilityDecision> = {}): EligibilityDecision {
  return {
    observationId: `obs:sha256:${"0".repeat(64)}`,
    ruleVersion: 1,
    status: "eligible",
    evidenceClass: "verified",
    allowedUses: ["task_descriptive", "within_model_profile"],
    reasonCodes: ["canonical_task_resolved", "verifier_passed"],
    comparabilityCohortId: `sha256:${"1".repeat(64)}`,
    decidedAt: 2000,
    ...overrides,
  };
}

describe("copy vocabulary coverage", () => {
  it("has fixed copy for every reason code", () => {
    for (const code of EVIDENCE_REASON_CODES) {
      expect(EVIDENCE_REASON_EXPLANATIONS[code]).toBeTruthy();
    }
  });

  it("has fixed copy for every allowed use", () => {
    for (const use of EVIDENCE_USES) {
      expect(EVIDENCE_USE_EXPLANATIONS[use]).toBeTruthy();
    }
  });

  it("has fixed copy for every class and status", () => {
    for (const cls of EVIDENCE_CLASSES) {
      expect(EVIDENCE_CLASS_EXPLANATIONS[cls]).toBeTruthy();
    }
    for (const status of ELIGIBILITY_STATUSES) {
      expect(EVIDENCE_STATUS_EXPLANATIONS[status]).toBeTruthy();
    }
  });

  it("covers no codes beyond the canonical vocabulary", () => {
    expect(Object.keys(EVIDENCE_REASON_EXPLANATIONS).sort()).toEqual(
      [...EVIDENCE_REASON_CODES].sort(),
    );
  });
});

describe("explainDecision", () => {
  it("explains a verified eligible decision line by line", () => {
    const d = makeDecision();
    const e = explainDecision(d);
    expect(e.observationId).toBe(d.observationId);
    expect(e.ruleVersion).toBe(1);
    expect(e.classLabel).toBe("Verified");
    expect(e.statusLabel).toBe("Eligible");
    expect(e.summary).toBe("Eligible — Verified");
    expect(e.reasonLines).toEqual([
      { code: "canonical_task_resolved", text: EVIDENCE_REASON_EXPLANATIONS.canonical_task_resolved },
      { code: "verifier_passed", text: EVIDENCE_REASON_EXPLANATIONS.verifier_passed },
    ]);
    expect(e.allowedUses).toEqual([
      { code: "task_descriptive", text: EVIDENCE_USE_EXPLANATIONS.task_descriptive },
      { code: "within_model_profile", text: EVIDENCE_USE_EXPLANATIONS.within_model_profile },
    ]);
    expect(e.limitationLines).toEqual([]);
  });

  it("surfaces disclosed limitations for a provisional decision", () => {
    const d = makeDecision({
      status: "provisional",
      evidenceClass: "comparable",
      allowedUses: ["task_descriptive", "within_model_profile"],
      reasonCodes: [
        "canonical_task_resolved",
        "incomplete_task_set_coverage",
        "model_version_unreported",
        "paired_cell_missing",
      ],
    });
    const e = explainDecision(d);
    expect(e.statusLabel).toBe("Provisional");
    expect(e.limitationLines.map((l) => l.code)).toEqual([
      "incomplete_task_set_coverage",
      "model_version_unreported",
      "paired_cell_missing",
    ]);
  });

  it("discloses a missing-assessment exploratory limitation contextually", () => {
    const d = makeDecision({
      status: "provisional",
      evidenceClass: "exploratory",
      allowedUses: ["task_descriptive"],
      reasonCodes: [
        "assessment_missing_or_failed",
        "candidate_selected_completed",
        "canonical_task_resolved",
        "instance_reconstructed",
        "protocol_complete",
        "rubric_resolved",
        "verifier_not_declared",
      ],
    });
    const e = explainDecision(d);
    expect(e.limitationLines.map((l) => l.code)).toEqual([
      "assessment_missing_or_failed",
      "verifier_not_declared",
    ]);
  });

  it("explains an excluded corrupt observation with the corruption limitation", () => {
    const d = makeDecision({
      status: "excluded",
      evidenceClass: "exploratory",
      allowedUses: [],
      reasonCodes: ["candidate_missing_or_failed", "source_corrupt"],
    });
    const e = explainDecision(d);
    expect(e.statusLabel).toBe("Excluded");
    expect(e.limitationLines.map((l) => l.code)).toEqual([
      "candidate_missing_or_failed",
      "source_corrupt",
    ]);
  });

  it("degrades unknown future reason codes to a fixed safe line", () => {
    const d = makeDecision({ reasonCodes: ["verifier_passed", "future_code_xyz" as never] });
    const e = explainDecision(d);
    const unknown = e.reasonLines.find((l) => l.code === "future_code_xyz");
    expect(unknown?.text).toBe("Unknown evidence reason code.");
  });

  it("explains a benchmark anchor decision", () => {
    const d = makeDecision({
      evidenceClass: "benchmark_anchor",
      allowedUses: [
        "task_descriptive",
        "within_model_profile",
        "paired_model_comparison",
        "task_set_standing",
        "benchmark_anchor_analysis",
      ],
      reasonCodes: ["anchor_designated", "canonical_task_resolved", "full_task_set_coverage"],
    });
    const e = explainDecision(d);
    expect(e.classLabel).toBe("Benchmark anchor");
    expect(e.allowedUses).toHaveLength(5);
    expect(e.limitationLines).toEqual([]);
  });
});
