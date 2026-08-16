// =============================================================================
// evidence-validation.test.ts — runtime guards, canonical serializers, and
// prohibited-content enforcement for the canonical evidence domain
// (observations-and-evidence spec §3, §5, §13).
//
// Covers: ModelConfigurationSnapshot / Observation / AssessmentRef /
// EligibilityDecision guards, allowed uses / classes / reason codes, prohibited
// keys and secret-shaped values, malformed source references, and the "no raw
// candidate output / full judge rationale in Observation" invariant.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  OBSERVATION_SCHEMA_VERSION,
  type AssessmentRef,
  type EligibilityDecision,
  type Observation,
} from "./evidence-types";
import {
  assessmentIdentityOf,
  canonicalObservationJson,
  isCohortFingerprint,
  isEligibilityDecision,
  isObservation,
  observationIdFor,
  observationSourceKey,
  validateEligibilityDecision,
  validateObservation,
} from "./evidence-validation";

// --- Fixtures -------------------------------------------------------------------

const HEX64 = "0".repeat(64);

function makeAssessmentRef(overrides: Partial<AssessmentRef> = {}): AssessmentRef {
  return {
    judgeAttemptId: "judge-att-1",
    judgeProviderId: "openrouter",
    judgeModel: "org/judge",
    blindLabelMapping: { A: "cand-1" },
    candidateAttemptIdsByCandidateId: { "cand-1": "att-1" },
    rubricRef: { id: "rub-1", version: 3 },
    verifierRef: null,
    verifierOutcome: null,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  const base: Observation = {
    id: "",
    sourceKind: "evaluation",
    sourceResultId: "exp-1",
    executionLineageId: "eval:exp-1:task-1",
    runId: "run-1",
    sourceTaskCellId: "exp-1:task-1:openrouter:gpt-x",
    taskId: "task-1",
    taskVersion: 2,
    taskInstanceId: "inst-1",
    taskFamilyId: "fam-1",
    modelConfigurationId: `mc:sha256:${"1".repeat(64)}`,
    candidateAttemptId: "att-1",
    assessmentRef: makeAssessmentRef(),
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
    outcome: {
      judgeAccepted: true,
      overallScore: 4,
      criterionValues: [{ criterionId: "c1", value: 4 }],
      verifierPassed: null,
    },
    observedAt: 1000,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    ...overrides,
  };
  // The id is derived from the source key; derive it only when the caller did
  // not supply an explicit id (some tests override it to assert rejection).
  if (base.id === "") base.id = observationIdFor(base);
  return base;
}

function makeDecision(overrides: Partial<EligibilityDecision> = {}): EligibilityDecision {
  return {
    observationId: `obs:sha256:${HEX64}`,
    ruleVersion: 1,
    status: "eligible",
    evidenceClass: "comparable",
    allowedUses: ["task_descriptive", "within_model_profile"],
    reasonCodes: ["canonical_task_resolved", "protocol_complete"],
    comparabilityCohortId: `sha256:${HEX64}`,
    decidedAt: 2000,
    ...overrides,
  };
}

// --- Tests ----------------------------------------------------------------------

describe("isObservation / validateObservation", () => {
  it("accepts a well-formed observation", () => {
    const o = makeObservation();
    expect(isObservation(o)).toBe(true);
    expect(validateObservation(o)).toEqual({ ok: true, value: o });
  });

  it("accepts a judge-free verifier-only outcome", () => {
    const o = makeObservation({
      assessmentRef: makeAssessmentRef({
        verifierOutcome: {
          taskId: "task-1",
          modelKey: "openrouter:gpt-x",
          passed: true,
          executedAt: 500,
        },
      }),
      outcome: {
        judgeAccepted: false,
        overallScore: null,
        criterionValues: [],
        verifierPassed: true,
      },
    });
    expect(validateObservation(o).ok).toBe(true);
  });

  it("rejects non-object payloads", () => {
    const r = validateObservation("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });

  it.each([
    "sourceResultId",
    "sourceTaskCellId",
    "candidateAttemptId",
    "runId",
    "taskId",
    "taskInstanceId",
    "executionLineageId",
  ] as const)("rejects a blank %s source reference", (field) => {
    const o = makeObservation({ [field]: "  " } as Partial<Observation>);
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects an unknown source kind", () => {
    const o = makeObservation({ sourceKind: "fusion" as Observation["sourceKind"] });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects a non-integer task version", () => {
    expect(validateObservation(makeObservation({ taskVersion: 1.5 })).ok).toBe(false);
    expect(validateObservation(makeObservation({ taskVersion: -1 })).ok).toBe(false);
  });

  it("rejects non-finite observedAt", () => {
    expect(validateObservation(makeObservation({ observedAt: Number.NaN })).ok).toBe(false);
    expect(validateObservation(makeObservation({ observedAt: -5 })).ok).toBe(false);
  });

  it("rejects a malformed protocol fingerprint", () => {
    const o = makeObservation({ protocolFingerprint: "not-a-hash" });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects an id that does not match the derived source key", () => {
    const o = makeObservation({ id: `obs:sha256:${HEX64}` });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects an observation from a future schema version", () => {
    const o = makeObservation({ observationSchemaVersion: 99 });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects judgeAccepted=false with scores present", () => {
    const o = makeObservation({
      outcome: { judgeAccepted: false, overallScore: 4, criterionValues: [], verifierPassed: null },
    });
    const r = validateObservation(o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("overallScore"))).toBe(true);
  });

  it("rejects a non-finite overall score", () => {
    const o = makeObservation({
      outcome: {
        judgeAccepted: true,
        overallScore: Number.POSITIVE_INFINITY,
        criterionValues: [],
        verifierPassed: null,
      },
    });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects duplicate criterion values", () => {
    const o = makeObservation({
      outcome: {
        judgeAccepted: true,
        overallScore: 4,
        criterionValues: [
          { criterionId: "c1", value: 4 },
          { criterionId: "c1", value: 5 },
        ],
        verifierPassed: null,
      },
    });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects a verifier outcome that disagrees with verifierPassed", () => {
    const o = makeObservation({
      assessmentRef: makeAssessmentRef({
        verifierOutcome: {
          taskId: "task-1",
          modelKey: "openrouter:gpt-x",
          passed: false,
          executedAt: 500,
        },
      }),
      outcome: {
        judgeAccepted: true,
        overallScore: 4,
        criterionValues: [],
        verifierPassed: true,
      },
    });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects verifierPassed without a verifier outcome (and vice versa)", () => {
    expect(
      validateObservation(
        makeObservation({
          outcome: { judgeAccepted: true, overallScore: 4, criterionValues: [], verifierPassed: true },
        }),
      ).ok,
    ).toBe(false);
    const o = makeObservation({
      assessmentRef: makeAssessmentRef({
        verifierOutcome: {
          taskId: "task-1",
          modelKey: "openrouter:gpt-x",
          passed: true,
          executedAt: 500,
        },
      }),
    });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects a malformed rubric ref", () => {
    const o = makeObservation({ rubricRef: { id: "", version: 3 } });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects a malformed evaluator snapshot", () => {
    const o = makeObservation({
      evaluatorSnapshot: {
        kind: "model_judge",
        providerId: "",
        model: "org/judge",
        resolvedVersion: null,
        instructionDigest: "plain",
        reasoningEffort: "high",
        toolScaffoldSignature: null,
      },
    });
    expect(validateObservation(o).ok).toBe(false);
  });

  it("rejects a verifier snapshot with kind none", () => {
    const o = makeObservation({
      verifierSnapshot: { verifierRef: null, kind: "none", configurationDigest: `sha256:${HEX64}` },
    });
    expect(validateObservation(o).ok).toBe(false);
  });
});

describe("prohibited keys and raw content fields", () => {
  it.each(["apiKey", "authorization", "token", "secret", "password", "env", "headers"])(
    "rejects a top-level prohibited key %s",
    (key) => {
      const o = makeObservation({ [key]: "sk-secret" } as Partial<Observation>);
      const r = validateObservation(o);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.includes(key))).toBe(true);
    },
  );

  it("rejects prohibited keys nested inside assessment refs", () => {
    const o = makeObservation();
    (o.assessmentRef as unknown as Record<string, unknown>).token = "sk-abc";
    expect(validateObservation(o).ok).toBe(false);
  });

  it.each([
    "output",
    "rawOutput",
    "candidateOutput",
    "candidateText",
    "candidateMessages",
    "messages",
    "content",
    "text",
    "segments",
    "streamingText",
    "rationale",
    "fullRationale",
    "judgeRationale",
    "strengths",
    "deductions",
    "missedRequirements",
    "report",
    "comparisons",
  ])("rejects the raw content field %s anywhere in an Observation", (field) => {
    const o = makeObservation({ [field]: "verbatim candidate output" } as Partial<Observation>);
    const r = validateObservation(o);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes(field))).toBe(true);
  });

  it("rejects raw content fields nested deep inside the payload", () => {
    const o = makeObservation();
    (o.outcome as unknown as Record<string, unknown>).rationale =
      "the candidate clearly failed every requirement";
    expect(validateObservation(o).ok).toBe(false);
  });
});

describe("canonical serializers and source key", () => {
  it("derives a stable id from the six-part source key", () => {
    const o = makeObservation();
    expect(observationIdFor(o)).toMatch(/^obs:sha256:[0-9a-f]{64}$/);
    expect(observationIdFor(o)).toBe(o.id);
  });

  it("changes the source key when any of the six parts changes", () => {
    const o = makeObservation();
    const key = observationSourceKey(o);
    expect(observationSourceKey({ ...o, sourceResultId: "exp-2" })).not.toBe(key);
    expect(observationSourceKey({ ...o, sourceTaskCellId: "other" })).not.toBe(key);
    expect(
      observationSourceKey({ ...o, modelConfigurationId: `mc:sha256:${"9".repeat(64)}` }),
    ).not.toBe(key);
    expect(observationSourceKey({ ...o, candidateAttemptId: "att-2" })).not.toBe(key);
    expect(
      observationSourceKey({
        ...o,
        assessmentRef: { ...o.assessmentRef, judgeAttemptId: "judge-att-2" },
      }),
    ).not.toBe(key);
    expect(observationSourceKey({ ...o, sourceKind: "comparison" })).not.toBe(key);
  });

  it("is independent of object key insertion order", () => {
    const a = makeObservation();
    // Rebuild the same logical value with shuffled key order.
    const shuffled: Observation = {
      outcome: a.outcome,
      assessmentRef: a.assessmentRef,
      observationSchemaVersion: a.observationSchemaVersion,
      verifierSnapshot: a.verifierSnapshot,
      candidateAttemptId: a.candidateAttemptId,
      evaluatorSnapshot: a.evaluatorSnapshot,
      modelConfigurationId: a.modelConfigurationId,
      rubricRef: a.rubricRef,
      protocolFingerprint: a.protocolFingerprint,
      taskFamilyId: a.taskFamilyId,
      sourceTaskCellId: a.sourceTaskCellId,
      observedAt: a.observedAt,
      taskInstanceId: a.taskInstanceId,
      taskVersion: a.taskVersion,
      taskId: a.taskId,
      runId: a.runId,
      executionLineageId: a.executionLineageId,
      sourceResultId: a.sourceResultId,
      sourceKind: a.sourceKind,
      id: a.id,
    };
    expect(observationSourceKey(shuffled)).toBe(observationSourceKey(a));
    expect(canonicalObservationJson(shuffled)).toBe(canonicalObservationJson(a));
  });

  it("changes canonical content when any field changes", () => {
    const a = makeObservation();
    expect(canonicalObservationJson({ ...a, taskVersion: 3 })).not.toBe(canonicalObservationJson(a));
    expect(canonicalObservationJson({ ...a, observedAt: 2000 })).not.toBe(canonicalObservationJson(a));
  });

  it("builds assessment identities over judge attempt and verifier outcome", () => {
    const base = makeAssessmentRef();
    const withVerifier = makeAssessmentRef({
      verifierOutcome: {
        taskId: "task-1",
        modelKey: "openrouter:gpt-x",
        passed: true,
        executedAt: 500,
      },
    });
    expect(assessmentIdentityOf(base)).not.toBe(assessmentIdentityOf(withVerifier));
    expect(assessmentIdentityOf({ ...base, judgeAttemptId: "other" })).not.toBe(
      assessmentIdentityOf(base),
    );
  });
});

describe("cohort fingerprint shape", () => {
  it("accepts canonical sha256 fingerprints only", () => {
    expect(isCohortFingerprint(`sha256:${HEX64}`)).toBe(true);
    expect(isCohortFingerprint("sha256:abc")).toBe(false);
    expect(isCohortFingerprint("plain")).toBe(false);
    expect(isCohortFingerprint("")).toBe(false);
  });
});

describe("EligibilityDecision validation", () => {
  it("accepts a well-formed decision", () => {
    const d = makeDecision();
    expect(isEligibilityDecision(d)).toBe(true);
    expect(validateEligibilityDecision(d)).toEqual({ ok: true, value: d });
  });

  it("accepts an excluded decision with no allowed uses", () => {
    const d = makeDecision({
      status: "excluded",
      evidenceClass: "exploratory",
      allowedUses: [],
      reasonCodes: ["source_corrupt"],
    });
    expect(validateEligibilityDecision(d).ok).toBe(true);
  });

  it("rejects an unknown reason code", () => {
    const d = makeDecision({ reasonCodes: ["totally_made_up" as never] });
    expect(validateEligibilityDecision(d).ok).toBe(false);
  });

  it("rejects duplicate allowed uses", () => {
    const d = makeDecision({ allowedUses: ["task_descriptive", "task_descriptive"] });
    expect(validateEligibilityDecision(d).ok).toBe(false);
  });

  it("rejects a malformed cohort fingerprint", () => {
    const d = makeDecision({ comparabilityCohortId: "nope" });
    expect(validateEligibilityDecision(d).ok).toBe(false);
  });

  it("rejects a non-positive rule version and non-finite decidedAt", () => {
    expect(validateEligibilityDecision(makeDecision({ ruleVersion: 0 })).ok).toBe(false);
    expect(validateEligibilityDecision(makeDecision({ decidedAt: Number.NaN })).ok).toBe(false);
  });

  it("rejects an unknown evidence class or status", () => {
    expect(
      validateEligibilityDecision(makeDecision({ evidenceClass: "gold" as never })).ok,
    ).toBe(false);
    expect(validateEligibilityDecision(makeDecision({ status: "maybe" as never })).ok).toBe(false);
  });
});
