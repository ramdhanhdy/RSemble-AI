// =============================================================================
// RSemble AI — Common study envelope validator tests (spec §4)
//
// RED: specifies the registered study substrate — StudyRecord, StudyTrial,
// StudyAttempt, StudyObservation, artifact refs, lifecycle immutability,
// treatment-changing vs measurement-only behavior, exploration/confirmation
// linkage, prohibited-key rejection, and the single registered kind.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  isStudyArtifactRef,
  isStudyAttempt,
  isStudyClaimLevel,
  isStudyObservationEnvelope,
  isStudyRecordEnvelope,
  isStudyStatus,
  isStudyTrialEnvelope,
  isTokenCost,
  isArchiveOnlyStudyRecord,
  isDeletableStudyRecord,
  STUDY_PROHIBITED_KEYS,
  type StudyArtifactRef,
  type StudyAttempt,
  type StudyObservation,
  type StudyRecord,
  type StudyTrial,
  type TokenCost,
} from "./study-types";

const FINGERPRINT = "sha256:" + "a".repeat(64);

function makeRecord(overrides: Partial<StudyRecord<unknown>> = {}): StudyRecord<unknown> {
  return {
    id: "study-1",
    revision: 0,
    kind: "policy",
    title: "Pair screening on holdout",
    status: "draft",
    claimLevel: "exploratory",
    definitionSchemaVersion: 1,
    definitionFingerprint: FINGERPRINT,
    definition: { kind: "policy" },
    reportRef: null,
    confirmationOf: null,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

function makeTrial(overrides: Partial<StudyTrial<unknown>> = {}): StudyTrial<unknown> {
  return {
    id: "trial-1",
    studyId: "study-1",
    payloadKind: "policy",
    payloadSchemaVersion: 1,
    payloadFingerprint: FINGERPRINT,
    payload: { stage: "B" },
    status: "in_progress",
    sampleIndex: 0,
    artifactRefs: [],
    observationIds: [],
    policyCost: { tokensIn: 1000, tokensOut: 500 },
    experimentalCost: { tokensIn: 1400, tokensOut: 650 },
    createdAt: 1000,
    sealedAt: null,
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<StudyAttempt> = {}): StudyAttempt {
  return {
    id: "attempt-1",
    studyId: "study-1",
    fromTrialId: "trial-1",
    toTrialId: "trial-2",
    reason: "synthesis_rerun",
    createdAt: 1000,
    ...overrides,
  };
}

function makeObservation(
  overrides: Partial<StudyObservation<unknown>> = {},
): StudyObservation<unknown> {
  return {
    id: "obs-1",
    studyId: "study-1",
    trialId: "trial-1",
    payloadKind: "policy_measurement",
    payloadSchemaVersion: 1,
    payload: { score: 4.2 },
    status: "completed",
    sourceRunId: "run-1",
    createdAt: 1000,
    finishedAt: 1100,
    ...overrides,
  };
}

// --- Round trips ---------------------------------------------------------------

describe("study envelope round trips", () => {
  it("accepts well-formed records", () => {
    expect(isStudyRecordEnvelope(makeRecord())).toBe(true);
    expect(isStudyTrialEnvelope(makeTrial())).toBe(true);
    expect(isStudyAttempt(makeAttempt())).toBe(true);
    expect(isStudyObservationEnvelope(makeObservation())).toBe(true);
    expect(isTokenCost({ tokensIn: 1, tokensOut: 2 })).toBe(true);
    expect(
      isStudyArtifactRef({ runId: "r1", attemptId: "a1", contentHash: FINGERPRINT }),
    ).toBe(true);
  });

  it("round-trips through JSON serialization", () => {
    expect(isStudyRecordEnvelope(JSON.parse(JSON.stringify(makeRecord())))).toBe(true);
    expect(isStudyTrialEnvelope(JSON.parse(JSON.stringify(makeTrial())))).toBe(true);
    expect(isStudyAttempt(JSON.parse(JSON.stringify(makeAttempt())))).toBe(true);
    expect(isStudyObservationEnvelope(JSON.parse(JSON.stringify(makeObservation())))).toBe(true);
  });
});

// --- Single registered kind / discriminant ------------------------------------

describe("registered kind and discriminant", () => {
  it("accepts only kind = policy on the record", () => {
    expect(isStudyRecordEnvelope(makeRecord({ kind: "policy" }))).toBe(true);
    expect(isStudyRecordEnvelope(makeRecord({ kind: "routing" as never }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ kind: "judge" as never }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ kind: "workflow" as never }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ kind: "" as never }))).toBe(false);
  });

  it("accepts only payloadKind = policy on trials", () => {
    expect(isStudyTrialEnvelope(makeTrial({ payloadKind: "policy" }))).toBe(true);
    expect(isStudyTrialEnvelope(makeTrial({ payloadKind: "routing" as never }))).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ payloadKind: "policy_measurement" as never }))).toBe(false);
  });

  it("accepts only payloadKind = policy_measurement on observations", () => {
    expect(isStudyObservationEnvelope(makeObservation({ payloadKind: "policy_measurement" }))).toBe(
      true,
    );
    expect(isStudyObservationEnvelope(makeObservation({ payloadKind: "policy" as never }))).toBe(false);
    expect(isStudyObservationEnvelope(makeObservation({ payloadKind: "judge" as never }))).toBe(false);
  });

  it("rejects unknown schema versions", () => {
    expect(isStudyRecordEnvelope(makeRecord({ definitionSchemaVersion: 0 }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ definitionSchemaVersion: -1 }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ definitionSchemaVersion: 1.5 }))).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ payloadSchemaVersion: 0 }))).toBe(false);
    expect(isStudyObservationEnvelope(makeObservation({ payloadSchemaVersion: 0 }))).toBe(false);
  });
});

// --- Arbitrary JSON rejection -------------------------------------------------

describe("arbitrary JSON rejection", () => {
  it("rejects non-record values", () => {
    expect(isStudyRecordEnvelope(null)).toBe(false);
    expect(isStudyRecordEnvelope("policy")).toBe(false);
    expect(isStudyRecordEnvelope(42)).toBe(false);
    expect(isStudyRecordEnvelope([])).toBe(false);
    expect(isStudyRecordEnvelope({})).toBe(false);
    expect(isStudyTrialEnvelope(null)).toBe(false);
    expect(isStudyTrialEnvelope([])).toBe(false);
    expect(isStudyAttempt(null)).toBe(false);
    expect(isStudyAttempt([])).toBe(false);
    expect(isStudyObservationEnvelope(null)).toBe(false);
    expect(isStudyObservationEnvelope([])).toBe(false);
  });

  it("rejects malformed fingerprint strings", () => {
    expect(isStudyRecordEnvelope(makeRecord({ definitionFingerprint: "abc" }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ definitionFingerprint: "sha256:xyz" }))).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ payloadFingerprint: "not-a-hash" }))).toBe(false);
  });
});

// --- Prohibited keys (recursive) ----------------------------------------------

describe("prohibited keys — recursive rejection", () => {
  it("rejects credential-shaped keys at any depth", () => {
    expect(isStudyRecordEnvelope(makeRecord({ apiKey: "sk-…" } as never))).toBe(false);
    expect(
      isStudyRecordEnvelope(
        makeRecord({ definition: { nested: { secret: "x" } } } as never),
      ),
    ).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ token: "t" } as never))).toBe(false);
    expect(
      isStudyTrialEnvelope(
        makeTrial({ artifactRefs: [{ runId: "r", attemptId: "a", contentHash: "c", password: "p" }] as never }),
      ),
    ).toBe(false);
    expect(isStudyAttempt(makeAttempt({ authorization: "Bearer …" } as never))).toBe(false);
    expect(isStudyObservationEnvelope(makeObservation({ credential: "c" } as never))).toBe(false);
  });

  it("the prohibited set covers the sibling credential vocabulary", () => {
    for (const key of [
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
    ]) {
      expect(STUDY_PROHIBITED_KEYS.has(key)).toBe(true);
    }
  });
});

// --- Draft CAS, start sealing, completed immutability, archive rules ----------

describe("lifecycle immutability rules", () => {
  it("draft CAS: revision is a non-negative integer", () => {
    expect(isStudyRecordEnvelope(makeRecord({ revision: 0 }))).toBe(true);
    expect(isStudyRecordEnvelope(makeRecord({ revision: 3 }))).toBe(true);
    expect(isStudyRecordEnvelope(makeRecord({ revision: -1 }))).toBe(false);
    expect(isStudyRecordEnvelope(makeRecord({ revision: 1.5 }))).toBe(false);
  });

  it("start sealing: sealed trial carries sealedAt, in-progress does not", () => {
    expect(
      isStudyTrialEnvelope(makeTrial({ status: "sealed", sealedAt: 2000 })),
    ).toBe(true);
    expect(isStudyTrialEnvelope(makeTrial({ status: "sealed", sealedAt: null }))).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ status: "in_progress", sealedAt: 2000 }))).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ status: "in_progress", sealedAt: null }))).toBe(true);
  });

  it("completed immutability: completed record carries a report ref", () => {
    expect(
      isStudyRecordEnvelope(
        makeRecord({ status: "completed", reportRef: "report-1" }),
      ),
    ).toBe(true);
    expect(isStudyRecordEnvelope(makeRecord({ status: "completed", reportRef: null }))).toBe(
      false,
    );
    // drafts never carry a report
    expect(isStudyRecordEnvelope(makeRecord({ status: "draft", reportRef: "r" }))).toBe(false);
  });

  it("archive rules: archived record carries archivedAt", () => {
    expect(
      isStudyRecordEnvelope(makeRecord({ status: "archived", archivedAt: 5000 })),
    ).toBe(true);
    expect(isStudyRecordEnvelope(makeRecord({ status: "archived", archivedAt: null }))).toBe(false);
    // non-archived records do not carry archivedAt
    expect(
      isStudyRecordEnvelope(makeRecord({ status: "completed", archivedAt: 5000, reportRef: "r" })),
    ).toBe(false);
  });

  it("updatedAt never precedes createdAt", () => {
    expect(isStudyRecordEnvelope(makeRecord({ createdAt: 1000, updatedAt: 500 }))).toBe(false);
    expect(isStudyObservationEnvelope(makeObservation({ createdAt: 1100, finishedAt: 1000 }))).toBe(
      false,
    );
  });
});

// --- Delete-only-untouched-draft / archive-only after start -------------------

describe("delete and archive eligibility", () => {
  it("only untouched drafts are deletable", () => {
    expect(isDeletableStudyRecord(makeRecord({ status: "draft" }))).toBe(true);
    expect(isDeletableStudyRecord(makeRecord({ status: "in_progress" }))).toBe(false);
    expect(isDeletableStudyRecord(makeRecord({ status: "completed", reportRef: "r" }))).toBe(false);
    expect(isDeletableStudyRecord(makeRecord({ status: "failed" }))).toBe(false);
    expect(
      isDeletableStudyRecord(makeRecord({ status: "archived", archivedAt: 5000 })),
    ).toBe(false);
  });

  it("started evidence is archive-only", () => {
    expect(isArchiveOnlyStudyRecord(makeRecord({ status: "in_progress" }))).toBe(true);
    expect(isArchiveOnlyStudyRecord(makeRecord({ status: "completed", reportRef: "r" }))).toBe(
      true,
    );
    expect(isArchiveOnlyStudyRecord(makeRecord({ status: "failed" }))).toBe(true);
    expect(isArchiveOnlyStudyRecord(makeRecord({ status: "draft" }))).toBe(false);
    expect(
      isArchiveOnlyStudyRecord(makeRecord({ status: "archived", archivedAt: 5000 })),
    ).toBe(false);
  });
});

// --- Treatment-changing vs measurement-only -----------------------------------

describe("treatment-changing vs measurement-only", () => {
  it("a StudyAttempt links two distinct trials — treatment change creates a new trial", () => {
    expect(isStudyAttempt(makeAttempt({ fromTrialId: "t1", toTrialId: "t2" }))).toBe(true);
    // a treatment change cannot point a trial to itself
    expect(isStudyAttempt(makeAttempt({ fromTrialId: "t1", toTrialId: "t1" }))).toBe(false);
  });

  it("a StudyObservation references the same trial — measurement-only retry", () => {
    expect(isStudyObservationEnvelope(makeObservation({ trialId: "trial-1" }))).toBe(true);
    // failed measurement is a terminal observation, not a mutation
    expect(
      isStudyObservationEnvelope(makeObservation({ status: "failed", payload: { error: "x" } })),
    ).toBe(true);
  });

  it("sampleIndex is a non-negative integer (retry storms do not inflate samples)", () => {
    expect(isStudyTrialEnvelope(makeTrial({ sampleIndex: 0 }))).toBe(true);
    expect(isStudyTrialEnvelope(makeTrial({ sampleIndex: 2 }))).toBe(true);
    expect(isStudyTrialEnvelope(makeTrial({ sampleIndex: -1 }))).toBe(false);
    expect(isStudyTrialEnvelope(makeTrial({ sampleIndex: 1.5 }))).toBe(false);
  });
});

// --- Exploration / confirmation linkage ---------------------------------------

describe("exploration / confirmation linkage", () => {
  it("exploratory records have no confirmationOf", () => {
    expect(
      isStudyRecordEnvelope(
        makeRecord({ claimLevel: "exploratory", confirmationOf: null }),
      ),
    ).toBe(true);
    expect(
      isStudyRecordEnvelope(
        makeRecord({ claimLevel: "exploratory", confirmationOf: "study-0" }),
      ),
    ).toBe(false);
  });

  it("confirmed records carry confirmationOf linkage", () => {
    expect(
      isStudyRecordEnvelope(
        makeRecord({
          status: "completed",
          claimLevel: "confirmed",
          confirmationOf: "study-0",
          reportRef: "report-1",
        }),
      ),
    ).toBe(true);
    expect(
      isStudyRecordEnvelope(
        makeRecord({
          status: "completed",
          claimLevel: "confirmed",
          confirmationOf: null,
          reportRef: "report-1",
        }),
      ),
    ).toBe(false);
  });
});

// --- Status / claim level guards ----------------------------------------------

describe("status and claim level guards", () => {
  it("recognizes every study status", () => {
    for (const s of ["draft", "in_progress", "completed", "failed", "archived"]) {
      expect(isStudyStatus(s)).toBe(true);
    }
    expect(isStudyStatus("sealed")).toBe(false);
    expect(isStudyStatus("running")).toBe(false);
  });

  it("recognizes every claim level", () => {
    expect(isStudyClaimLevel("exploratory")).toBe(true);
    expect(isStudyClaimLevel("confirmed")).toBe(true);
    expect(isStudyClaimLevel("exploration")).toBe(false);
    expect(isStudyClaimLevel("confirmation")).toBe(false);
  });
});

// --- TokenCost / artifact ref guards ------------------------------------------

describe("TokenCost and StudyArtifactRef guards", () => {
  const validCost: TokenCost = { tokensIn: 100, tokensOut: 50 };
  it("accepts finite non-negative token costs", () => {
    expect(isTokenCost(validCost)).toBe(true);
    expect(isTokenCost({ tokensIn: 0, tokensOut: 0 })).toBe(true);
    expect(isTokenCost({ tokensIn: -1, tokensOut: 0 })).toBe(false);
    expect(isTokenCost({ tokensIn: 0, tokensOut: NaN })).toBe(false);
    expect(isTokenCost({ tokensIn: 0 })).toBe(false);
  });

  const validRef: StudyArtifactRef = { runId: "r1", attemptId: "a1", contentHash: FINGERPRINT };
  it("accepts well-formed artifact refs", () => {
    expect(isStudyArtifactRef(validRef)).toBe(true);
    expect(isStudyArtifactRef({ runId: "", attemptId: "a1", contentHash: FINGERPRINT })).toBe(false);
    expect(isStudyArtifactRef({ runId: "r1", attemptId: "a1", contentHash: "bad" })).toBe(false);
  });
});
