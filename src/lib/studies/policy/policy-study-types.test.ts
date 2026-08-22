// =============================================================================
// RSemble AI — Policy Study specialization tests (spec §5)
//
// RED: specifies the PolicyStudyDefinition, trial/measurement/report payloads,
// the fixed four policies, do_not_fuse as a valid finding, and the exact model
// configuration ref shape.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  POLICY_DEFINITION_SCHEMA_VERSION,
  POLICY_KINDS,
  POLICY_MEASUREMENT_SCHEMA_VERSION,
  POLICY_REPORT_SCHEMA_VERSION,
  POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
  isExactModelConfigurationRef,
  isPolicyKind,
  isPolicyMeasurementPayload,
  isPolicyPlaybookRow,
  isPolicyTrialPayload,
  isPolicyRecommendation,
  isPolicyReportPayload,
  isPolicyStudyDefinition,
  isPolicyStudyObservation,
  isPolicyStudyRecord,
  isPolicyStudyTrial,
  policyStudyRegistration,
  type ExactModelConfigurationRef,
  type PolicyMeasurementPayload,
  type PolicyPlaybookRow,
  type PolicyReportPayload,
  type PolicyStudyDefinition,
  type PolicyStudyRecord,
  type PolicyTrialPayload,
} from "./policy-study-types";
import { fingerprintStudyValue } from "../study-fingerprint";

const MC = "mc:sha256:" + "0".repeat(64);
const MC2 = "mc:sha256:" + "1".repeat(64);
const DIGEST = "sha256:" + "a".repeat(64);
const PROTOCOL_FP = "sha256:" + "b".repeat(64);

function mcRef(id: string = MC): ExactModelConfigurationRef {
  return { id };
}

function makeDefinition(overrides: Partial<PolicyStudyDefinition> = {}): PolicyStudyDefinition {
  return {
    workload: { taskSetId: "ts1", version: 6, manifestDigest: DIGEST },
    modelPool: { poolId: "p1", version: 3, digest: DIGEST },
    fusionRecipes: [{ recipeId: "r1", version: 1, digest: DIGEST }],
    judge1: mcRef(),
    judge2: mcRef(MC2),
    rubric: { rubricId: "rub1", version: 2 },
    protocolFingerprint: PROTOCOL_FP,
    policies: ["best_fixed", "rank", "fuse", "refine"],
    stageProtocolVersion: 1,
    claimPlan: "exploration",
    ...overrides,
  };
}

function makeTrialPayload(overrides: Partial<PolicyTrialPayload> = {}): PolicyTrialPayload {
  return {
    policy: "fuse",
    stage: "B",
    candidateConfig: { members: [mcRef(), mcRef(MC2)] },
    recipeRef: { recipeId: "r1", version: 1, digest: DIGEST },
    synthesizer: mcRef(),
    ...overrides,
  };
}

function makeMeasurementPayload(
  overrides: Partial<PolicyMeasurementPayload> = {},
): PolicyMeasurementPayload {
  return {
    judge: mcRef(MC2),
    overallScore: 4.25,
    tokensIn: 300,
    tokensOut: 120,
    error: null,
    ...overrides,
  };
}

function makePlaybookRow(overrides: Partial<PolicyPlaybookRow> = {}): PolicyPlaybookRow {
  return {
    policy: "fuse",
    configuration: "B + C → Synth X",
    meanOutcome: 4.52,
    lift: 0.34,
    costMultiplier: 3.2,
    confidence: "medium",
    ...overrides,
  };
}

function makeReport(overrides: Partial<PolicyReportPayload> = {}): PolicyReportPayload {
  return {
    studyId: "study-1",
    definitionFingerprint: fingerprintStudyValue(makeDefinition()),
    rows: [makePlaybookRow()],
    recommendation: {
      kind: "do_not_fuse",
      rationale: "Rank matches Fuse within MPID at lower cost.",
    },
    poolAdequacy: { probed: true, outcome: "confirmed", note: "Challenger failed." },
    recipeSensitivity: { checked: true, note: "Stable across prompt variants." },
    claimLevel: "exploratory",
    conclusion: "Rank A+C when cost matters; do not use fusion for routine runs.",
    supportingTrialIds: ["trial-1"],
    supportingObservationIds: ["obs-1"],
    reportSchemaVersion: POLICY_REPORT_SCHEMA_VERSION,
    createdAt: 1000,
    ...overrides,
  };
}

function makeStudyRecord(overrides: Partial<PolicyStudyRecord> = {}): PolicyStudyRecord {
  const def = makeDefinition();
  return {
    id: "study-1",
    revision: 0,
    kind: "policy",
    title: "Pair screening on holdout",
    status: "in_progress",
    claimLevel: "exploratory",
    definitionSchemaVersion: POLICY_DEFINITION_SCHEMA_VERSION,
    definitionFingerprint: fingerprintStudyValue(def),
    definition: def,
    reportRef: null,
    confirmationOf: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

// --- ExactModelConfigurationRef -----------------------------------------------

describe("ExactModelConfigurationRef", () => {
  it("accepts mc:sha256:<64 hex> ids", () => {
    expect(isExactModelConfigurationRef(mcRef())).toBe(true);
    expect(isExactModelConfigurationRef(mcRef(MC2))).toBe(true);
  });
  it("rejects malformed ids", () => {
    expect(isExactModelConfigurationRef({ id: "mc:sha256:abc" })).toBe(false);
    expect(isExactModelConfigurationRef({ id: "sha256:" + "0".repeat(64) })).toBe(false);
    expect(isExactModelConfigurationRef({ id: "" })).toBe(false);
    expect(isExactModelConfigurationRef({})).toBe(false);
    expect(isExactModelConfigurationRef(null)).toBe(false);
  });
});

// --- Fixed four policies ------------------------------------------------------

describe("fixed four policies", () => {
  it("the policy set is exactly best_fixed, rank, fuse, refine", () => {
    expect(POLICY_KINDS).toEqual(["best_fixed", "rank", "fuse", "refine"]);
  });

  it("recognizes every policy and rejects unknown ones", () => {
    expect(isPolicyKind("best_fixed")).toBe(true);
    expect(isPolicyKind("rank")).toBe(true);
    expect(isPolicyKind("fuse")).toBe(true);
    expect(isPolicyKind("refine")).toBe(true);
    expect(isPolicyKind("do_not_fuse")).toBe(false);
    expect(isPolicyKind("routing")).toBe(false);
    expect(isPolicyKind("")).toBe(false);
  });

  it("a definition must carry at least one policy from the fixed four", () => {
    expect(isPolicyStudyDefinition(makeDefinition({ policies: [] }))).toBe(false);
    expect(isPolicyStudyDefinition(makeDefinition({ policies: ["best_fixed"] }))).toBe(true);
    expect(isPolicyStudyDefinition(makeDefinition({ policies: ["do_not_fuse" as never] }))).toBe(
      false,
    );
    expect(
      isPolicyStudyDefinition(
        makeDefinition({ policies: ["best_fixed", "rank", "fuse", "refine"] }),
      ),
    ).toBe(true);
  });
});

// --- PolicyStudyDefinition ----------------------------------------------------

describe("PolicyStudyDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(isPolicyStudyDefinition(makeDefinition())).toBe(true);
    expect(isPolicyStudyDefinition(JSON.parse(JSON.stringify(makeDefinition())))).toBe(true);
  });

  it("rejects missing or malformed workload", () => {
    expect(isPolicyStudyDefinition({ ...makeDefinition(), workload: {} })).toBe(false);
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        workload: { taskSetId: "", version: 6, manifestDigest: DIGEST },
      }),
    ).toBe(false);
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        workload: { taskSetId: "ts1", version: 0, manifestDigest: DIGEST },
      }),
    ).toBe(false);
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        workload: { taskSetId: "ts1", version: 6, manifestDigest: "bad" },
      }),
    ).toBe(false);
  });

  it("rejects malformed model pool and recipe refs", () => {
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        modelPool: { poolId: "p1", version: 0, digest: DIGEST },
      }),
    ).toBe(false);
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        fusionRecipes: [{ recipeId: "r1", version: 1, digest: "bad" }],
      }),
    ).toBe(false);
  });

  it("rejects malformed judge refs", () => {
    expect(isPolicyStudyDefinition({ ...makeDefinition(), judge1: { id: "bad" } })).toBe(false);
    expect(isPolicyStudyDefinition({ ...makeDefinition(), judge2: null })).toBe(false);
  });

  it("rejects malformed rubric and protocol fingerprint", () => {
    expect(
      isPolicyStudyDefinition({ ...makeDefinition(), rubric: { rubricId: "", version: 2 } }),
    ).toBe(false);
    expect(isPolicyStudyDefinition({ ...makeDefinition(), protocolFingerprint: "bad" })).toBe(
      false,
    );
  });

  it("rejects unknown claimPlan", () => {
    expect(isPolicyStudyDefinition({ ...makeDefinition(), claimPlan: "confirmed" })).toBe(false);
    expect(isPolicyStudyDefinition({ ...makeDefinition(), claimPlan: "exploratory" })).toBe(false);
  });

  it("rejects prohibited keys at any depth", () => {
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        judge1: { id: MC, apiKey: "sk-…" },
      }),
    ).toBe(false);
    expect(
      isPolicyStudyDefinition({
        ...makeDefinition(),
        workload: { taskSetId: "ts1", version: 6, manifestDigest: DIGEST, secret: "x" },
      }),
    ).toBe(false);
  });
});

// --- PolicyTrialPayload -------------------------------------------------------

describe("PolicyTrialPayload", () => {
  it("accepts a well-formed fuse trial payload", () => {
    expect(isPolicyTrialPayload(makeTrialPayload())).toBe(true);
  });

  it("fuse requires recipe + synthesizer; refine requires synthesizer; rank/best_fixed carry neither", () => {
    // fuse: both required
    expect(isPolicyTrialPayload(makeTrialPayload({ policy: "fuse", recipeRef: null }))).toBe(false);
    expect(isPolicyTrialPayload(makeTrialPayload({ policy: "fuse", synthesizer: null }))).toBe(
      false,
    );
    // refine: synthesizer required, recipe optional
    expect(
      isPolicyTrialPayload(
        makeTrialPayload({ policy: "refine", recipeRef: null, synthesizer: mcRef() }),
      ),
    ).toBe(true);
    expect(isPolicyTrialPayload(makeTrialPayload({ policy: "refine", synthesizer: null }))).toBe(
      false,
    );
    // rank: neither
    expect(
      isPolicyTrialPayload(
        makeTrialPayload({ policy: "rank", recipeRef: null, synthesizer: null }),
      ),
    ).toBe(true);
    expect(
      isPolicyTrialPayload(
        makeTrialPayload({
          policy: "rank",
          recipeRef: { recipeId: "r1", version: 1, digest: DIGEST },
          synthesizer: null,
        }),
      ),
    ).toBe(false);
    // best_fixed: neither
    expect(
      isPolicyTrialPayload(
        makeTrialPayload({ policy: "best_fixed", recipeRef: null, synthesizer: null }),
      ),
    ).toBe(true);
    expect(
      isPolicyTrialPayload(makeTrialPayload({ policy: "best_fixed", synthesizer: mcRef() })),
    ).toBe(false);
  });

  it("rejects unknown stage", () => {
    expect(isPolicyTrialPayload(makeTrialPayload({ stage: "D" as never }))).toBe(false);
    expect(isPolicyTrialPayload(makeTrialPayload({ stage: "B" }))).toBe(true);
  });
});

// --- PolicyMeasurementPayload -------------------------------------------------

describe("PolicyMeasurementPayload", () => {
  it("accepts completed and failed measurements", () => {
    expect(isPolicyMeasurementPayload(makeMeasurementPayload())).toBe(true);
    expect(
      isPolicyMeasurementPayload(
        makeMeasurementPayload({
          overallScore: null,
          tokensIn: null,
          tokensOut: null,
          error: { message: "boom" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects malformed judge ref", () => {
    expect(isPolicyMeasurementPayload({ ...makeMeasurementPayload(), judge: { id: "bad" } })).toBe(
      false,
    );
  });

  it("rejects prohibited keys", () => {
    expect(isPolicyMeasurementPayload({ ...makeMeasurementPayload(), token: "t" })).toBe(false);
  });
});

// --- PolicyReportPayload (playbook) -------------------------------------------

describe("PolicyReportPayload", () => {
  it("accepts a well-formed playbook", () => {
    expect(isPolicyReportPayload(makeReport())).toBe(true);
    expect(isPolicyReportPayload(JSON.parse(JSON.stringify(makeReport())))).toBe(true);
  });

  it("do_not_fuse is a valid recommendation, not a failure status", () => {
    expect(isPolicyRecommendation({ kind: "do_not_fuse", rationale: "Not worth it." })).toBe(true);
    expect(
      isPolicyRecommendation({
        kind: "adopt",
        policy: "rank",
        configuration: "A+C",
        rationale: "Cheaper.",
      }),
    ).toBe(true);
    expect(isPolicyRecommendation({ kind: "fail", rationale: "x" })).toBe(false);
    expect(isPolicyRecommendation({ kind: "do_not_fuse" })).toBe(false);
  });

  it("a playbook row must reference one of the fixed four policies", () => {
    expect(isPolicyPlaybookRow(makePlaybookRow({ policy: "best_fixed" }))).toBe(true);
    expect(isPolicyPlaybookRow(makePlaybookRow({ policy: "do_not_fuse" as never }))).toBe(false);
    expect(isPolicyPlaybookRow(makePlaybookRow({ policy: "routing" as never }))).toBe(false);
  });

  it("rejects a report with a mismatched definition fingerprint", () => {
    expect(
      isPolicyReportPayload(makeReport({ definitionFingerprint: "sha256:" + "z".repeat(64) })),
    ).toBe(false);
  });

  it("rejects a report with unknown claim level", () => {
    expect(isPolicyReportPayload(makeReport({ claimLevel: "exploration" as never }))).toBe(false);
  });
});

// --- Composite record / trial / observation -----------------------------------

describe("composite policy study records", () => {
  it("a well-formed policy study record round-trips", () => {
    const rec = makeStudyRecord();
    expect(isPolicyStudyRecord(rec)).toBe(true);
    expect(isPolicyStudyRecord(JSON.parse(JSON.stringify(rec)))).toBe(true);
  });

  it("rejects a record whose definition fingerprint does not match the definition", () => {
    const rec = makeStudyRecord({ definitionFingerprint: "sha256:" + "z".repeat(64) });
    expect(isPolicyStudyRecord(rec)).toBe(false);
  });

  it("rejects a record with the wrong definition schema version", () => {
    const rec = makeStudyRecord({
      definitionSchemaVersion: POLICY_DEFINITION_SCHEMA_VERSION + 1,
    });
    expect(isPolicyStudyRecord(rec)).toBe(false);
  });

  it("confirmation linkage: confirmed record must carry confirmationOf and matching claimPlan", () => {
    const def = makeDefinition({ claimPlan: "confirmation" });
    expect(
      isPolicyStudyRecord(
        makeStudyRecord({
          definition: def,
          claimLevel: "confirmed",
          confirmationOf: "study-0",
          status: "completed",
          reportRef: "report-1",
          definitionFingerprint: fingerprintStudyValue(def),
        }),
      ),
    ).toBe(true);
    // confirmed claim without confirmationOf is rejected
    expect(
      isPolicyStudyRecord(
        makeStudyRecord({
          definition: def,
          claimLevel: "confirmed",
          confirmationOf: null,
          status: "completed",
          reportRef: "report-1",
          definitionFingerprint: fingerprintStudyValue(def),
        }),
      ),
    ).toBe(false);
    // claimPlan confirmation with exploratory claimLevel is rejected
    expect(
      isPolicyStudyRecord(
        makeStudyRecord({
          definition: def,
          claimLevel: "exploratory",
          definitionFingerprint: fingerprintStudyValue(def),
        }),
      ),
    ).toBe(false);
  });

  it("a well-formed policy trial round-trips with matching payload fingerprint", () => {
    const payload = makeTrialPayload();
    const trial = {
      id: "trial-1",
      studyId: "study-1",
      payloadKind: "policy" as const,
      payloadSchemaVersion: POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
      payloadFingerprint: fingerprintStudyValue(payload),
      payload,
      status: "in_progress" as const,
      sampleIndex: 0,
      artifactRefs: [],
      observationIds: [],
      policyCost: { tokensIn: 1000, tokensOut: 500 },
      experimentalCost: { tokensIn: 1400, tokensOut: 650 },
      createdAt: 1000,
      sealedAt: null,
    };
    expect(isPolicyStudyTrial(trial)).toBe(true);
    expect(isPolicyStudyTrial(JSON.parse(JSON.stringify(trial)))).toBe(true);
  });

  it("rejects a trial whose payload fingerprint does not match", () => {
    const payload = makeTrialPayload();
    const trial = {
      id: "trial-1",
      studyId: "study-1",
      payloadKind: "policy" as const,
      payloadSchemaVersion: POLICY_TRIAL_PAYLOAD_SCHEMA_VERSION,
      payloadFingerprint: "sha256:" + "z".repeat(64),
      payload,
      status: "in_progress" as const,
      sampleIndex: 0,
      artifactRefs: [],
      observationIds: [],
      policyCost: { tokensIn: 1000, tokensOut: 500 },
      experimentalCost: { tokensIn: 1400, tokensOut: 650 },
      createdAt: 1000,
      sealedAt: null,
    };
    expect(isPolicyStudyTrial(trial)).toBe(false);
  });

  it("a well-formed policy observation round-trips", () => {
    const obs = {
      id: "obs-1",
      studyId: "study-1",
      trialId: "trial-1",
      payloadKind: "policy_measurement" as const,
      payloadSchemaVersion: POLICY_MEASUREMENT_SCHEMA_VERSION,
      payload: makeMeasurementPayload(),
      status: "completed" as const,
      sourceRunId: "run-1",
      createdAt: 1000,
      finishedAt: 1100,
    };
    expect(isPolicyStudyObservation(obs)).toBe(true);
    expect(isPolicyStudyObservation(JSON.parse(JSON.stringify(obs)))).toBe(true);
  });
});

// --- Registration wiring ------------------------------------------------------

describe("policy study registration", () => {
  it("exposes the policy kind and schema version", () => {
    expect(policyStudyRegistration.kind).toBe("policy");
    expect(policyStudyRegistration.schemaVersion).toBe(POLICY_DEFINITION_SCHEMA_VERSION);
  });

  it("validateDefinition delegates to isPolicyStudyDefinition", () => {
    expect(policyStudyRegistration.validateDefinition(makeDefinition())).toBe(true);
    expect(policyStudyRegistration.validateDefinition({})).toBe(false);
  });

  it("fingerprintDefinition produces a stable sha256 fingerprint", () => {
    const def = makeDefinition();
    expect(policyStudyRegistration.fingerprintDefinition(def)).toBe(fingerprintStudyValue(def));
  });
});
