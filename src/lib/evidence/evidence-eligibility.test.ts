// =============================================================================
// evidence-eligibility.test.ts — deterministic evidence classification
// (observations-and-evidence spec §7, §8, §17).
//
// Every scenario asserts class, status, allowed uses, and the exact sorted
// reason-code list, including unknown-version disclosure, incomplete roster
// coverage, verifier pass/fail, legacy/corrupt/input-incomplete sources,
// undeclared repeats, reused assessments, and benchmark-anchor designation.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { Observation } from "./evidence-types";
import { observationIdFor } from "./evidence-validation";
import {
  EVIDENCE_RULE_VERSION,
  classifyEligibility,
  type EligibilityInput,
} from "./evidence-eligibility";

const COHORT = `sha256:${"c".repeat(64)}`;

function makeObservation(): Observation {
  const o: Observation = {
    id: "",
    sourceKind: "evaluation",
    sourceResultId: "exp-1",
    executionLineageId: "eval:exp-1:task-1",
    runId: "run-1",
    sourceTaskCellId: "exp-1:task-1:openrouter:org/m1",
    taskId: "task-1",
    taskVersion: 2,
    taskInstanceId: "inst-1",
    taskFamilyId: null,
    modelConfigurationId: `mc:sha256:${"1".repeat(64)}`,
    candidateAttemptId: "att-1",
    assessmentRef: {
      judgeAttemptId: "j-1",
      judgeProviderId: "openrouter",
      judgeModel: "org/judge",
      blindLabelMapping: { A: "cand-1" },
      candidateAttemptIdsByCandidateId: { "cand-1": "att-1" },
      rubricRef: { id: "rub-1", version: 3 },
      verifierRef: null,
      verifierOutcome: null,
    },
    protocolFingerprint: `sha256:${"2".repeat(64)}`,
    rubricRef: { id: "rub-1", version: 3 },
    evaluatorSnapshot: {
      kind: "model_judge",
      providerId: "openrouter",
      model: "org/judge",
      resolvedVersion: null,
      instructionDigest: `sha256:${"3".repeat(64)}`,
      reasoningEffort: "high",
      toolScaffoldSignature: null,
    },
    verifierSnapshot: null,
    outcome: { judgeAccepted: true, overallScore: 4, criterionValues: [], verifierPassed: null },
    observedAt: 1000,
    observationSchemaVersion: 1,
  };
  o.id = observationIdFor(o);
  return o;
}

function baseInput(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    observation: makeObservation(),
    canonicalTaskResolved: true,
    candidateInputComplete: true,
    candidateSelectedCompleted: true,
    assessmentSelectedCompleted: true,
    verifierState: "not_declared",
    frozenVerifierVersion: false,
    humanVerificationAuthorized: false,
    rubricResolved: true,
    protocolComplete: true,
    configurationState: "exact",
    fullPairCoverage: true,
    fullTaskSetCoverage: true,
    reusedCandidateAssessment: false,
    undeclaredRepeat: false,
    sourceCorrupt: false,
    sourceLegacyLimited: false,
    anchorDesignated: false,
    comparabilityCohortId: COHORT,
    decidedAt: 2000,
    ...overrides,
  };
}

const FULL_COMPARABLE_USES = [
  "task_descriptive",
  "within_model_profile",
  "paired_model_comparison",
  "task_set_standing",
] as const;

describe("rule version", () => {
  it("locks the versioned rule constant", () => {
    expect(EVIDENCE_RULE_VERSION).toBe(1);
  });
});

describe("healthy cells", () => {
  it("classifies a judge-only comparable cell as eligible with all four uses", () => {
    const d = classifyEligibility(baseInput());
    expect(d.observationId).toBe(baseInput().observation.id);
    expect(d.ruleVersion).toBe(EVIDENCE_RULE_VERSION);
    expect(d.evidenceClass).toBe("comparable");
    expect(d.status).toBe("eligible");
    expect(d.allowedUses).toEqual([...FULL_COMPARABLE_USES]);
    expect(d.reasonCodes).toEqual([
      "assessment_selected_completed",
      "candidate_selected_completed",
      "canonical_task_resolved",
      "full_pair_coverage",
      "full_task_set_coverage",
      "instance_reconstructed",
      "model_configuration_exact",
      "protocol_complete",
      "rubric_resolved",
      "verifier_not_declared",
    ]);
    expect(d.comparabilityCohortId).toBe(COHORT);
    expect(d.decidedAt).toBe(2000);
  });

  it("a passing frozen verifier produces verified class", () => {
    const d = classifyEligibility(baseInput({ verifierState: "passed", frozenVerifierVersion: true }));
    expect(d.evidenceClass).toBe("verified");
    expect(d.status).toBe("eligible");
    expect(d.reasonCodes).toContain("verifier_passed");
    expect(d.reasonCodes).not.toContain("verifier_not_declared");
  });

  it("a verifier failure stays comparable and valid (negative evidence), but provisional", () => {
    const d = classifyEligibility(baseInput({ verifierState: "failed" }));
    expect(d.evidenceClass).toBe("comparable");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual([...FULL_COMPARABLE_USES]);
    expect(d.reasonCodes).toContain("verifier_failed");
  });

  it("a passing verifier without a frozen version is not verified", () => {
    const d = classifyEligibility(baseInput({ verifierState: "passed", frozenVerifierVersion: false }));
    expect(d.evidenceClass).toBe("comparable");
    expect(d.reasonCodes).toContain("verifier_passed");
  });

  it("authorized human verification produces verified class", () => {
    const d = classifyEligibility(baseInput({ humanVerificationAuthorized: true }));
    expect(d.evidenceClass).toBe("verified");
    expect(d.status).toBe("eligible");
  });

  it("a model judge score alone never produces verified status", () => {
    const d = classifyEligibility(baseInput());
    expect(d.evidenceClass).not.toBe("verified");
  });
});

describe("unknown model version", () => {
  it("is a disclosure and use qualifier, not a full exclusion", () => {
    const d = classifyEligibility(baseInput({ configurationState: "rolling_alias" }));
    expect(d.evidenceClass).toBe("comparable");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive", "within_model_profile"]);
    expect(d.reasonCodes).toContain("model_version_unreported");
    expect(d.reasonCodes).not.toContain("model_configuration_exact");
  });
});

describe("incomplete coverage", () => {
  it("a missing paired cell removes paired and standing uses", () => {
    const d = classifyEligibility(baseInput({ fullPairCoverage: false, fullTaskSetCoverage: false }));
    expect(d.evidenceClass).toBe("comparable");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive", "within_model_profile"]);
    expect(d.reasonCodes).toContain("paired_cell_missing");
    expect(d.reasonCodes).toContain("incomplete_task_set_coverage");
  });

  it("missing pair but complete task set standing is impossible to claim", () => {
    const d = classifyEligibility(baseInput({ fullPairCoverage: false, fullTaskSetCoverage: true }));
    expect(d.allowedUses).toEqual(["task_descriptive", "within_model_profile"]);
    expect(d.reasonCodes).toContain("paired_cell_missing");
  });
});

describe("exploratory fallbacks", () => {
  it("an unresolved canonical task is exploratory", () => {
    const d = classifyEligibility(baseInput({ canonicalTaskResolved: false }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive"]);
    expect(d.reasonCodes).toContain("canonical_task_unresolved");
  });

  it("an incomplete protocol is exploratory", () => {
    const d = classifyEligibility(baseInput({ protocolComplete: false }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.reasonCodes).toContain("protocol_incomplete");
  });

  it("a partial model configuration is exploratory and provisional", () => {
    const d = classifyEligibility(baseInput({ configurationState: "partial" }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive"]);
    expect(d.reasonCodes).toContain("model_configuration_incomplete");
  });

  it("a failed candidate has no uses at all", () => {
    const d = classifyEligibility(baseInput({ candidateSelectedCompleted: false }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("excluded");
    expect(d.allowedUses).toEqual([]);
    expect(d.reasonCodes).toContain("candidate_missing_or_failed");
  });

  it("unreconstructable candidate input excludes profile use", () => {
    const d = classifyEligibility(baseInput({ candidateInputComplete: false }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive"]);
    expect(d.reasonCodes).toContain("instance_input_incomplete");
  });

  it("a missing assessment with no verifier limits the cell", () => {
    const d = classifyEligibility(baseInput({ assessmentSelectedCompleted: false }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive"]);
    expect(d.reasonCodes).toContain("assessment_missing_or_failed");
  });

  it("a verifier-only cell is comparable via its verifier outcome", () => {
    const d = classifyEligibility(
      baseInput({ assessmentSelectedCompleted: false, verifierState: "passed", frozenVerifierVersion: true }),
    );
    expect(d.evidenceClass).toBe("verified");
    expect(d.status).toBe("eligible");
    expect(d.allowedUses).toEqual([...FULL_COMPARABLE_USES]);
    expect(d.reasonCodes).toContain("verifier_passed");
    expect(d.reasonCodes).toContain("assessment_missing_or_failed");
  });

  it("an unresolved rubric is exploratory", () => {
    const d = classifyEligibility(baseInput({ rubricResolved: false }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.reasonCodes).toContain("rubric_unresolved");
  });
});

describe("legacy and corrupt sources", () => {
  it("legacy evidence never receives invented provenance", () => {
    const d = classifyEligibility(
      baseInput({ canonicalTaskResolved: false, sourceLegacyLimited: true }),
    );
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("provisional");
    expect(d.allowedUses).toEqual(["task_descriptive"]);
    expect(d.reasonCodes).toContain("source_legacy_limited");
    expect(d.reasonCodes).toContain("canonical_task_unresolved");
  });

  it("a corrupt source supports no use", () => {
    const d = classifyEligibility(baseInput({ sourceCorrupt: true }));
    expect(d.evidenceClass).toBe("exploratory");
    expect(d.status).toBe("excluded");
    expect(d.allowedUses).toEqual([]);
    expect(d.reasonCodes).toContain("source_corrupt");
  });
});

describe("repeats and reuse disclosures", () => {
  it("an undeclared repeat stays a full eligible observation with a disclosure", () => {
    const d = classifyEligibility(baseInput({ undeclaredRepeat: true }));
    expect(d.evidenceClass).toBe("comparable");
    expect(d.status).toBe("eligible");
    expect(d.allowedUses).toEqual([...FULL_COMPARABLE_USES]);
    expect(d.reasonCodes).toContain("undeclared_repeat");
  });

  it("a reused candidate assessment stays eligible with a disclosure", () => {
    const d = classifyEligibility(baseInput({ reusedCandidateAssessment: true }));
    expect(d.evidenceClass).toBe("comparable");
    expect(d.status).toBe("eligible");
    expect(d.reasonCodes).toContain("reused_candidate_assessment");
  });
});

describe("benchmark anchor", () => {
  it("requires explicit designation plus full controlled coverage", () => {
    const d = classifyEligibility(
      baseInput({ anchorDesignated: true, verifierState: "passed", frozenVerifierVersion: true }),
    );
    expect(d.evidenceClass).toBe("benchmark_anchor");
    expect(d.status).toBe("eligible");
    expect(d.allowedUses).toEqual([
      "task_descriptive",
      "within_model_profile",
      "paired_model_comparison",
      "task_set_standing",
      "benchmark_anchor_analysis",
    ]);
    expect(d.reasonCodes).toContain("anchor_designated");
  });

  it("is never inferred from incomplete coverage", () => {
    const d = classifyEligibility(
      baseInput({ anchorDesignated: true, fullPairCoverage: false, fullTaskSetCoverage: false }),
    );
    expect(d.evidenceClass).toBe("comparable");
    expect(d.allowedUses).toEqual(["task_descriptive", "within_model_profile"]);
    expect(d.allowedUses).not.toContain("benchmark_anchor_analysis");
  });
});

describe("determinism and contract", () => {
  it("sorts reason codes and keeps the canonical use order", () => {
    const d = classifyEligibility(baseInput({ fullPairCoverage: false, fullTaskSetCoverage: false }));
    expect(d.reasonCodes).toEqual([...d.reasonCodes].sort());
    expect(d.allowedUses).toEqual(["task_descriptive", "within_model_profile"]);
  });

  it("produces identical decisions for identical inputs", () => {
    const a = classifyEligibility(baseInput({ undeclaredRepeat: true }));
    const b = classifyEligibility(baseInput({ undeclaredRepeat: true }));
    expect(b).toEqual(a);
  });

  it("rejects a malformed cohort fingerprint", () => {
    expect(() => classifyEligibility(baseInput({ comparabilityCohortId: "nope" }))).toThrow(
      /cohort/i,
    );
  });

  it("rejects a non-finite decidedAt", () => {
    expect(() => classifyEligibility(baseInput({ decidedAt: Number.NaN }))).toThrow(/decidedAt/i);
  });
});
