// =============================================================================
// Runtime validator tests for persistence + evaluation domain types
//
// Each test constructs a known-valid record then mutates a single field to
// assert the validator rejects exactly that defect. Covers the 11 run-record
// validation requirements plus the evaluation profile/task/suite/profile-record
// rules from the workbench plan.
// =============================================================================

import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../../studio-data";
import type {
  EvaluationCriterion,
  EvaluationProfile,
  EvaluationSuite,
  EvaluationTask,
} from "../evaluations/evaluation-types";
import {
  isEvaluationProfile,
  isEvaluationProfileRef,
  isEvaluationSelection,
  isEvaluationSuite,
  isEvaluationTask,
  isExperimentRecord,
  isProfileRecord,
  isTaskEvaluationSelection,
} from "../evaluations/evaluation-types";
import type {
  CandidateAttemptRecord,
  FullRunSummaryV2,
  LegacyRunSummary,
  PersistedCandidate,
  RunArchiveV1,
  RunRecordV2,
  FusionAttemptRecord,
} from "./run-types";
import {
  isAttemptStatus,
  isFullRunSummaryV2,
  isLegacyRunSummary,
  isPersistedCandidate,
  isPersistedError,
  isRunArchiveV1,
  isRunRecordV2,
  isRunSource,
  isRunStatus,
  isRunSummary,
} from "./run-types";

// Deep-clone helper so each mutation starts from an untouched baseline.
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------------------------------------------------------------------------
// Valid baselines
// ---------------------------------------------------------------------------

const validAttempt: CandidateAttemptRecord = {
  attemptId: "att-1",
  messages: [{ role: "user", content: "test prompt" }],
  startedAt: 1,
  finishedAt: 2,
  status: "completed",
  output: "out",
  tokensIn: 10,
  tokensOut: 20,
  error: null,
};

const validCandidate: PersistedCandidate = {
  candidateId: "c-1",
  slotId: "s-1",
  modelKey: "openrouter:foo",
  providerId: "openrouter",
  model: "foo",
  slug: "foo",
  acceptedAttemptId: "att-1",
  attempts: [validAttempt],
};

function validRunRecord(): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: "run-1",
    revision: 1,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 3,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "t", prompt: "p", systemPrompt: "s", temperature: 0 },
    evaluation: {
      profile: null,
      candidateMessages: [{ role: "user", content: "hi" }],
    },
    candidates: [clone(validCandidate)],
    judge: {
      status: "done",
      acceptedAttemptId: null,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:foo"],
  };
}

function validFullSummary(): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id: "run-1",
    revision: 1,
    createdAt: 1,
    completedAt: 2,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: "t",
    taskExcerpt: "e",
    modelKeys: ["openrouter:foo"],
    winnerKeys: ["openrouter:foo"],
    scoresByModelKey: { "openrouter:foo": 5 },
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "e",
  };
}

function validLegacySummary(): LegacyRunSummary {
  return {
    kind: "legacy",
    schemaVersion: "1-import",
    id: "run-2",
    createdAt: 1,
    taskExcerpt: "e",
    modelKeys: ["a"],
    winnerKeys: ["a"],
    scoresByModelKey: { a: 5 },
    detailAvailable: false,
    searchText: "e",
  };
}

const validCriterion: EvaluationCriterion = {
  id: "c-1",
  name: "Correctness",
  description: "d",
  weight: 1,
  anchors: { one: "bad", three: "ok", five: "great" },
};

function validProfile(): EvaluationProfile {
  return {
    id: "p-1",
    version: 1,
    name: "P",
    description: "d",
    judgeInstruction: "ji",
    criteria: [clone(validCriterion)],
    createdAt: 1,
    updatedAt: 2,
  };
}

const validSlot1: ModelSlot = {
  id: "s1",
  providerId: "openrouter",
  provider: "OpenRouter",
  model: "foo",
  slug: "foo",
  enabled: true,
};

const validSlot2: ModelSlot = {
  id: "s2",
  providerId: "gemini",
  provider: "Gemini",
  model: "bar",
  slug: "bar",
  enabled: true,
};

function validTask(): EvaluationTask {
  return {
    id: "t-1",
    title: "T",
    prompt: "p",
    systemPrompt: "s",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
  };
}

function validSuite(): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 1,
    name: "Suite",
    description: "d",
    tasks: [validTask()],
    modelSlots: [validSlot1, validSlot2],
    defaultJudge: { providerId: "openrouter", model: "foo" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1,
    updatedAt: 2,
    archivedAt: null,
  };
}

// ---------------------------------------------------------------------------
// 1. Status enums
// ---------------------------------------------------------------------------

describe("isRunStatus / isAttemptStatus", () => {
  it("accepts every valid RunStatus and rejects unknown values", () => {
    for (const s of [
      "running",
      "completed",
      "partial",
      "failed",
      "aborted",
      "interrupted",
    ] as const) {
      expect(isRunStatus(s)).toBe(true);
    }
    expect(isRunStatus("queued")).toBe(false);
    expect(isRunStatus(42)).toBe(false);
    expect(isRunStatus(null)).toBe(false);
  });

  it("accepts every valid AttemptStatus and rejects unknown values", () => {
    for (const s of ["running", "completed", "failed", "aborted", "interrupted"] as const) {
      expect(isAttemptStatus(s)).toBe(true);
    }
    expect(isAttemptStatus("queued")).toBe(false);
    expect(isAttemptStatus("done")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Schema version rejection
// ---------------------------------------------------------------------------

describe("schema version rejection", () => {
  it("isRunRecordV2 rejects unknown schema versions", () => {
    const r = validRunRecord();
    expect(isRunRecordV2(r)).toBe(true);
    r.schemaVersion = 3 as unknown as 2;
    expect(isRunRecordV2(r)).toBe(false);
    (r as unknown as { schemaVersion: number }).schemaVersion = 1;
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("isFullRunSummaryV2 rejects non-v2 schema versions", () => {
    const s = validFullSummary();
    expect(isFullRunSummaryV2(s)).toBe(true);
    (s as unknown as { schemaVersion: number }).schemaVersion = 1;
    expect(isFullRunSummaryV2(s)).toBe(false);
  });

  it("isFullRunSummaryV2 rejects wrong kind discriminator", () => {
    const s = validFullSummary();
    (s as unknown as { kind: string }).kind = "legacy";
    expect(isFullRunSummaryV2(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Missing / empty IDs
// ---------------------------------------------------------------------------

describe("missing IDs", () => {
  it("isRunRecordV2 rejects a missing id", () => {
    const r = validRunRecord();
    expect(isRunRecordV2(r)).toBe(true);
    r.id = "";
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("isFullRunSummaryV2 rejects an empty id", () => {
    const s = validFullSummary();
    s.id = "";
    expect(isFullRunSummaryV2(s)).toBe(false);
  });

  it("isLegacyRunSummary rejects an empty id", () => {
    const s = validLegacySummary();
    s.id = "";
    expect(isLegacyRunSummary(s)).toBe(false);
  });

  it("isPersistedCandidate rejects empty candidateId/slotId/modelKey", () => {
    expect(isPersistedCandidate(validCandidate)).toBe(true);
    const noCid = clone(validCandidate);
    noCid.candidateId = "";
    expect(isPersistedCandidate(noCid)).toBe(false);
    const noSid = clone(validCandidate);
    noSid.slotId = "";
    expect(isPersistedCandidate(noSid)).toBe(false);
    const noKey = clone(validCandidate);
    noKey.modelKey = "";
    expect(isPersistedCandidate(noKey)).toBe(false);
  });

  it("isPersistedCandidate rejects an attempt with missing messages", () => {
    const c = clone(validCandidate);
    const { messages: _, ...noMsg } = c.attempts[0];
    c.attempts[0] = noMsg as CandidateAttemptRecord;
    expect(isPersistedCandidate(c)).toBe(false);
  });

  it("isPersistedCandidate rejects an attempt with malformed messages", () => {
    const c = clone(validCandidate);
    (c.attempts[0] as unknown as Record<string, unknown>).messages = "not-an-array";
    expect(isPersistedCandidate(c)).toBe(false);
  });

  it("isPersistedCandidate rejects an attempt with messages containing invalid roles", () => {
    const c = clone(validCandidate);
    (c.attempts[0] as unknown as Record<string, unknown>).messages = [
      { role: "developer", content: "bad role" },
    ];
    expect(isPersistedCandidate(c)).toBe(false);
  });
});

describe("fusion usage provenance", () => {
  const fusionAttempt: FusionAttemptRecord = {
    attemptId: "fusion-1",
    providerId: "openrouter",
    model: "judge",
    messages: [{ role: "user", content: "judge" }],
    sourceJudgeAttemptId: "judge-1",
    candidateAttemptIdsByCandidateId: {},
    startedAt: 1,
    finishedAt: 2,
    status: "completed",
    error: null,
    result: "fused",
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    },
    inputEstimate: { totalTokens: 10, textTokens: 10, method: "provider-reported", partial: false },
    cost: { usd: null, source: "unknown" },
  };

  it("accepts additive fusion usage fields and rejects malformed fields", () => {
    const r = validRunRecord();
    r.fusion.attempts = [clone(fusionAttempt)];
    expect(isRunRecordV2(r)).toBe(true);
    const malformed = clone(r) as unknown as Record<string, unknown>;
    const fusion = malformed.fusion as Record<string, unknown>;
    const attempts = fusion.attempts as Array<Record<string, unknown>>;
    attempts[0].inputEstimate = {
      totalTokens: -1,
      textTokens: 1,
      method: "text-heuristic",
      partial: true,
    };
    expect(isRunRecordV2(malformed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Prohibited credential / transport keys
// ---------------------------------------------------------------------------

describe("prohibited credential keys", () => {
  it("isRunRecordV2 rejects an apiKey at the top level", () => {
    const r = validRunRecord() as unknown as Record<string, unknown>;
    r.apiKey = "leak";
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("isRunRecordV2 rejects a prohibited key nested in a candidate attempt", () => {
    const r = validRunRecord();
    (r.candidates[0].attempts[0] as unknown as Record<string, unknown>).token = "leak";
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("isPersistedCandidate rejects a nested secret", () => {
    const c = clone(validCandidate);
    (c as unknown as Record<string, unknown>).password = "leak";
    expect(isPersistedCandidate(c)).toBe(false);
  });

  it("isFullRunSummaryV2 rejects a prohibited env dump", () => {
    const s = validFullSummary() as unknown as Record<string, unknown>;
    s.env = { KEY: "x" };
    expect(isFullRunSummaryV2(s)).toBe(false);
  });

  it("isRunArchiveV1 rejects an archive carrying authorization", () => {
    const archive: RunArchiveV1 = {
      schemaVersion: 1,
      exportedAt: 1,
      runs: [validRunRecord()],
      summaries: [validFullSummary()],
    };
    expect(isRunArchiveV1(archive)).toBe(true);
    (archive as unknown as Record<string, unknown>).authorization = "Bearer x";
    expect(isRunArchiveV1(archive)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Run source — experiment requires immutable experimentTaskAttemptId
// ---------------------------------------------------------------------------

describe("isRunSource", () => {
  it("accepts an adhoc source", () => {
    expect(isRunSource({ kind: "adhoc" })).toBe(true);
  });

  it("accepts a complete experiment source", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp",
        taskId: "t1",
        experimentTaskAttemptId: "att-1",
        trial: 0,
      }),
    ).toBe(true);
  });

  it("rejects an experiment source missing experimentTaskAttemptId", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp",
        taskId: "t1",
        trial: 0,
      }),
    ).toBe(false);
  });

  it("rejects an experiment source with an empty experimentTaskAttemptId", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp",
        taskId: "t1",
        experimentTaskAttemptId: "",
        trial: 0,
      }),
    ).toBe(false);
  });

  it("rejects an unknown source kind", () => {
    expect(isRunSource({ kind: "other" })).toBe(false);
    expect(isRunSource(null)).toBe(false);
  });

  it("accepts a missing-cells repair on an experiment source", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp",
        taskId: "t1",
        experimentTaskAttemptId: "att-1",
        trial: 1,
        repair: {
          kind: "missing-cells",
          baseRunId: "run-base",
          requestedModelKeys: ["openrouter:m1"],
        },
      }),
    ).toBe(true);
  });

  it("accepts a compound roster-extension plan (with baseRunId)", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp2",
        taskId: "t1",
        experimentTaskAttemptId: "att-2",
        trial: 2,
        repair: { kind: "roster-extension", addedModelKey: "gemini:m3", baseRunId: "run-base" },
      }),
    ).toBe(true);
  });

  it("accepts a full-roster fallback roster-extension plan (no baseRunId)", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp2",
        taskId: "t1",
        experimentTaskAttemptId: "att-2",
        trial: 2,
        repair: { kind: "roster-extension", addedModelKey: "gemini:m3" },
      }),
    ).toBe(true);
  });

  it("rejects a roster-extension plan with blank addedModelKey", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp2",
        taskId: "t1",
        experimentTaskAttemptId: "att-2",
        trial: 2,
        repair: { kind: "roster-extension", addedModelKey: "" },
      }),
    ).toBe(false);
  });

  it("rejects a roster-extension plan with a blank baseRunId", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp2",
        taskId: "t1",
        experimentTaskAttemptId: "att-2",
        trial: 2,
        repair: { kind: "roster-extension", addedModelKey: "gemini:m3", baseRunId: "" },
      }),
    ).toBe(false);
  });

  it("rejects a roster-extension plan with credential-shaped identifiers", () => {
    expect(
      isRunSource({
        kind: "experiment",
        experimentId: "e1",
        suiteId: "s1",
        suiteVersion: 1,
        protocolFingerprint: "fp2",
        taskId: "t1",
        experimentTaskAttemptId: "att-2",
        trial: 2,
        repair: { kind: "roster-extension", addedModelKey: "sk-secret-key" },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Legacy summaries cannot fabricate status/mode/Judge/source/evaluation
// ---------------------------------------------------------------------------

describe("isLegacyRunSummary fabrication rejection", () => {
  it("accepts a minimal legacy summary", () => {
    expect(isLegacyRunSummary(validLegacySummary())).toBe(true);
  });

  it.each([
    "status",
    "mode",
    "judgeModelKey",
    "source",
    "evaluationProfileId",
    "evaluationProfileVersion",
  ])("rejects a legacy summary carrying fabricated %s", (field) => {
    const s = validLegacySummary() as unknown as Record<string, unknown>;
    s[field] = "fabricated";
    expect(isLegacyRunSummary(s)).toBe(false);
  });

  it("rejects a wrong schemaVersion tag", () => {
    const s = validLegacySummary();
    (s as unknown as { schemaVersion: string }).schemaVersion = "2-import";
    expect(isLegacyRunSummary(s)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Winner arrays preserve zero, one, or multiple tied winners
// ---------------------------------------------------------------------------

describe("winner arrays", () => {
  it("accepts a single winner", () => {
    const r = validRunRecord();
    expect(isRunRecordV2(r)).toBe(true);
  });

  it("accepts zero winners", () => {
    const r = validRunRecord();
    r.winnerKeys = [];
    expect(isRunRecordV2(r)).toBe(true);
  });

  it("accepts multiple tied winners", () => {
    const r = validRunRecord();
    r.winnerKeys = ["openrouter:foo", "gemini:bar"];
    expect(isRunRecordV2(r)).toBe(true);
  });

  it("rejects a non-string winner entry", () => {
    const r = validRunRecord();
    (r.winnerKeys as unknown[]).push(5);
    expect(isRunRecordV2(r)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Empty Fusion-attempt history is accepted
// ---------------------------------------------------------------------------

describe("fusion history", () => {
  it("accepts an empty fusion attempts array", () => {
    const r = validRunRecord();
    r.fusion.attempts = [];
    expect(isRunRecordV2(r)).toBe(true);
  });

  it("rejects a malformed fusion attempt", () => {
    const r = validRunRecord();
    r.fusion.attempts = [
      {
        attemptId: "f-1",
        providerId: "openrouter",
        model: "foo",
        messages: [],
        // sourceJudgeAttemptId missing
        candidateAttemptIdsByCandidateId: {},
        startedAt: 1,
        finishedAt: null,
        status: "running",
        error: null,
        result: null,
      } as unknown as RunRecordV2["fusion"]["attempts"][number],
    ];
    expect(isRunRecordV2(r)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. RunSummary dispatches on kind (discriminated legacy summary-only records)
// ---------------------------------------------------------------------------

describe("isRunSummary dispatch", () => {
  it("accepts a full summary via dispatch", () => {
    expect(isRunSummary(validFullSummary())).toBe(true);
  });

  it("accepts a legacy summary via dispatch", () => {
    expect(isRunSummary(validLegacySummary())).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(isRunSummary({ kind: "other", id: "x" })).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isRunSummary(null)).toBe(false);
    expect(isRunSummary("full")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. RunArchiveV1
// ---------------------------------------------------------------------------

describe("isRunArchiveV1", () => {
  it("accepts a valid archive of runs and summaries", () => {
    const archive: RunArchiveV1 = {
      schemaVersion: 1,
      exportedAt: 1,
      runs: [validRunRecord()],
      summaries: [validFullSummary(), validLegacySummary()],
    };
    expect(isRunArchiveV1(archive)).toBe(true);
  });

  it("rejects an unknown archive schema version", () => {
    const archive = {
      schemaVersion: 2,
      exportedAt: 1,
      runs: [],
      summaries: [],
    };
    expect(isRunArchiveV1(archive)).toBe(false);
  });

  it("rejects an archive with an invalid run", () => {
    const archive = {
      schemaVersion: 1,
      exportedAt: 1,
      runs: [{ ...validRunRecord(), id: "" }],
      summaries: [],
    };
    expect(isRunArchiveV1(archive)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Full run record — holistic structural checks
// ---------------------------------------------------------------------------

describe("isRunRecordV2 structural guards", () => {
  it("accepts a valid run record", () => {
    expect(isRunRecordV2(validRunRecord())).toBe(true);
  });

  it("rejects an invalid run status", () => {
    const r = validRunRecord();
    (r as unknown as { status: string }).status = "queued";
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("rejects an invalid judge stage status", () => {
    const r = validRunRecord();
    (r.judge as unknown as { status: string }).status = "paused";
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("rejects a missing execution fence", () => {
    const r = validRunRecord() as unknown as Record<string, unknown>;
    r.execution = {};
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("rejects a malformed task block", () => {
    const r = validRunRecord();
    (r.task as unknown as Record<string, unknown>).temperature = "hot";
    expect(isRunRecordV2(r)).toBe(false);
  });

  it("rejects an invalid evaluation profile", () => {
    const r = validRunRecord();
    r.evaluation.profile = { id: "p", version: 1 } as unknown as EvaluationProfile;
    expect(isRunRecordV2(r)).toBe(false);
  });
});

// ===========================================================================
// Evaluation domain validators
// ===========================================================================

describe("isEvaluationCriterion / isEvaluationProfile anchors + weights", () => {
  it("accepts a valid criterion with 1/3/5 anchors", () => {
    const c = clone(validCriterion);
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(true);
  });

  it("rejects a criterion missing the five anchor", () => {
    const c = clone(validCriterion) as unknown as Record<string, unknown>;
    (c.anchors as Record<string, unknown>).five = undefined;
    delete (c.anchors as Record<string, unknown>).five;
    expect(
      isEvaluationProfile({ ...validProfile(), criteria: [c as unknown as EvaluationCriterion] }),
    ).toBe(false);
  });

  it("rejects a criterion missing the one anchor", () => {
    const c = clone(validCriterion);
    delete (c.anchors as unknown as Record<string, unknown>).one;
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });

  it("rejects a profile whose criteria all have non-positive weights", () => {
    const c = clone(validCriterion);
    c.weight = 0;
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });

  it("accepts a profile where at least one criterion has a positive weight", () => {
    const zero = clone(validCriterion);
    zero.id = "c-0";
    zero.weight = 0;
    const positive = clone(validCriterion);
    expect(isEvaluationProfile({ ...validProfile(), criteria: [zero, positive] })).toBe(true);
  });
  it("rejects a negative criterion weight", () => {
    const c = clone(validCriterion);
    c.weight = -1;
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });

  it("rejects a NaN criterion weight", () => {
    const c = clone(validCriterion);
    c.weight = NaN;
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });

  it("rejects an empty anchor-one string", () => {
    const c = clone(validCriterion);
    c.anchors.one = "";
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });

  it("rejects an empty anchor-three string", () => {
    const c = clone(validCriterion);
    c.anchors.three = "";
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });

  it("rejects an empty anchor-five string", () => {
    const c = clone(validCriterion);
    c.anchors.five = "";
    expect(isEvaluationProfile({ ...validProfile(), criteria: [c] })).toBe(false);
  });
});

describe("isTaskEvaluationSelection discrimination", () => {
  it("accepts an inherit selection", () => {
    expect(isTaskEvaluationSelection({ kind: "inherit" })).toBe(true);
  });

  it("accepts a holistic selection", () => {
    expect(isTaskEvaluationSelection({ kind: "holistic" })).toBe(true);
  });

  it("accepts a pinned-profile selection with a valid ref", () => {
    expect(isTaskEvaluationSelection({ kind: "profile", profile: { id: "p", version: 1 } })).toBe(
      true,
    );
  });

  it("rejects a pinned-profile selection with an invalid ref", () => {
    expect(isTaskEvaluationSelection({ kind: "profile", profile: { id: "", version: 1 } })).toBe(
      false,
    );
    expect(isTaskEvaluationSelection({ kind: "profile", profile: null })).toBe(false);
  });

  it("rejects an unknown selection kind", () => {
    expect(isTaskEvaluationSelection({ kind: "other" })).toBe(false);
  });

  it("rejects a non-object selection", () => {
    expect(isTaskEvaluationSelection(null)).toBe(false);
  });

  it("isEvaluationSelection distinguishes holistic from profile", () => {
    expect(isEvaluationSelection({ kind: "holistic" })).toBe(true);
    expect(isEvaluationSelection({ kind: "profile", profile: { id: "p", version: 2 } })).toBe(true);
    expect(isEvaluationSelection({ kind: "inherit" })).toBe(false);
  });

  it("isEvaluationProfileRef rejects a missing version", () => {
    expect(isEvaluationProfileRef({ id: "p" })).toBe(false);
    expect(isEvaluationProfileRef({ id: "p", version: 1 })).toBe(true);
  });
});

describe("isEvaluationSuite structural validity", () => {
  // Execution preconditions (≥1 task, ≥2 enabled unique keys, ready judge)
  // live in validateSuiteForExecution — see suite-validation.test.ts. The
  // record guard intentionally accepts saveable but non-executable drafts.
  it("accepts a valid suite", () => {
    expect(isEvaluationSuite(validSuite())).toBe(true);
  });

  it("rejects an empty name", () => {
    const s = validSuite();
    s.name = "";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("accepts a draft with fewer than two enabled models (execution-gated)", () => {
    const s = validSuite();
    s.modelSlots = [validSlot1, { ...validSlot2, enabled: false }];
    expect(isEvaluationSuite(s)).toBe(true);
  });

  it("accepts a draft with duplicate enabled keys (execution-gated)", () => {
    const s = validSuite();
    s.modelSlots = [
      validSlot1,
      {
        ...validSlot2,
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "foo",
        slug: "foo",
      },
    ];
    expect(isEvaluationSuite(s)).toBe(true);
  });

  it("rejects a suite with an invalid task", () => {
    const s = validSuite();
    (s.tasks[0] as unknown as Record<string, unknown>).order = "zero";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("accepts a draft with zero tasks (execution-gated)", () => {
    const s = validSuite();
    s.tasks = [];
    expect(isEvaluationSuite(s)).toBe(true);
  });

  it("rejects a task with an empty title", () => {
    const s = validSuite();
    s.tasks[0].title = "";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("rejects a task with an empty prompt", () => {
    const s = validSuite();
    s.tasks[0].prompt = "";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("rejects a task with a whitespace-only title", () => {
    const s = validSuite();
    s.tasks[0].title = "   ";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("rejects a task with a whitespace-only prompt", () => {
    const s = validSuite();
    s.tasks[0].prompt = "  ";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("rejects a suite carrying a prohibited key", () => {
    const s = validSuite() as unknown as Record<string, unknown>;
    s.apiKey = "leak";
    expect(isEvaluationSuite(s)).toBe(false);
  });

  it("isEvaluationTask rejects an invalid task evaluation", () => {
    const t = validTask();
    (t as unknown as { evaluation: unknown }).evaluation = { kind: "other" };
    expect(isEvaluationTask(t)).toBe(false);
  });
});

describe("ProfileRecord archive state", () => {
  it("isProfileRecord accepts an unarchived record", () => {
    expect(
      isProfileRecord({
        id: "p",
        revision: 1,
        latestVersion: 3,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: null,
      }),
    ).toBe(true);
  });

  it("isProfileRecord accepts an archived record with a timestamp", () => {
    expect(
      isProfileRecord({
        id: "p",
        revision: 1,
        latestVersion: 3,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: 99,
      }),
    ).toBe(true);
  });

  it("isProfileRecord rejects a non-number archivedAt", () => {
    expect(
      isProfileRecord({
        id: "p",
        revision: 1,
        latestVersion: 3,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: "later",
      }),
    ).toBe(false);
  });

  it("isEvaluationProfile does not require archivedAt (immutable version)", () => {
    const p = validProfile();
    // No archivedAt field present — still valid.
    expect(isEvaluationProfile(p)).toBe(true);
    expect("archivedAt" in p).toBe(false);
  });

  it("isProfileRecord rejects a prohibited key", () => {
    expect(
      isProfileRecord({
        id: "p",
        revision: 1,
        latestVersion: 3,
        createdAt: 1,
        updatedAt: 2,
        archivedAt: null,
        secret: "leak",
      }),
    ).toBe(false);
  });
});

describe("isExperimentRecord", () => {
  function validExperiment() {
    return {
      id: "exp-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "fp",
      status: "draft" as const,
      execution: null as unknown,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 1,
        tasks: [validTask()],
        modelSlots: [validSlot1, validSlot2],
        defaultJudge: { providerId: "openrouter", model: "foo" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [validProfile()],
        protocolFingerprint: "fp",
        createdAt: 1,
      },
      tasks: [
        {
          taskId: "t-1",
          selectedAttemptId: null,
          attempts: [],
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
  }

  it("accepts a valid experiment record", () => {
    expect(isExperimentRecord(validExperiment())).toBe(true);
  });

  it("rejects an unknown experiment status", () => {
    const e = validExperiment() as unknown as { status: string };
    e.status = "unknown";
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects a malformed execution fence when present", () => {
    const e = validExperiment();
    e.execution = { ownerId: "x" };
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects a prohibited key on the experiment", () => {
    const e = validExperiment() as unknown as Record<string, unknown>;
    e.apiKey = "leak";
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects an invalid task attempt in the tasks list", () => {
    const e = validExperiment();
    (e.tasks[0].attempts as unknown[]).push({
      id: "",
      trial: 0,
      status: "queued",
      runId: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    });
    expect(isExperimentRecord(e)).toBe(false);
  });
});

describe("experiment repair provenance schema (Task 8)", () => {
  function validExperiment() {
    return {
      id: "exp-1",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "fp",
      status: "draft" as const,
      execution: null as unknown,
      snapshot: {
        suiteId: "suite-1",
        suiteVersion: 1,
        tasks: [validTask()],
        modelSlots: [validSlot1, validSlot2],
        defaultJudge: { providerId: "openrouter", model: "foo" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [validProfile()],
        protocolFingerprint: "fp",
        createdAt: 1,
      },
      tasks: [
        {
          taskId: "t-1",
          selectedAttemptId: null,
          attempts: [],
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
  }

  function validExperimentWithRepair() {
    const e = validExperiment() as unknown as {
      tasks: Array<{
        taskId: string;
        selectedAttemptId: string | null;
        attempts: Array<Record<string, unknown>>;
      }>;
    };
    e.tasks[0].attempts = [
      {
        id: "att-repair",
        runId: "run-repair",
        trial: 1,
        status: "completed",
        startedAt: 1,
        finishedAt: 2,
        error: null,
        coverage: { scoredModelKeys: ["openrouter:m1", "openrouter:m2"], totalModels: 2 },
        repair: {
          kind: "missing-cells",
          baseRunId: "run-base",
          requestedModelKeys: ["openrouter:m1"],
        },
      },
    ];
    return e;
  }

  it("accepts a task attempt carrying coverage and repair metadata", () => {
    expect(isExperimentRecord(validExperimentWithRepair())).toBe(true);
  });

  it("accepts attempts without the optional fields (backward compatible)", () => {
    expect(isExperimentRecord(validExperiment())).toBe(true);
  });

  it("rejects coverage with duplicate scored model keys", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].coverage as Record<string, unknown>).scoredModelKeys = [
      "openrouter:m1",
      "openrouter:m1",
    ];
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects coverage with a negative totalModels", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].coverage as Record<string, unknown>).totalModels = -1;
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects coverage with a blank scored model key", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].coverage as Record<string, unknown>).scoredModelKeys = [""];
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects a repair plan with a blank baseRunId", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].repair as Record<string, unknown>).baseRunId = "";
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects a repair plan with duplicate requested model keys", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].repair as Record<string, unknown>).requestedModelKeys = [
      "openrouter:m1",
      "openrouter:m1",
    ];
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects a repair plan with a credential-shaped key", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].repair as Record<string, unknown>).requestedModelKeys = [
      "sk-secret-abcdef",
    ];
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects a repair plan with an unknown kind", () => {
    const e = validExperimentWithRepair();
    (e.tasks[0].attempts[0].repair as Record<string, unknown>).kind = "other";
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("accepts a roster-extension attempt plan (compound and fallback)", () => {
    const compound = validExperiment() as unknown as {
      tasks: Array<{
        taskId: string;
        selectedAttemptId: string | null;
        attempts: Array<Record<string, unknown>>;
      }>;
    };
    compound.tasks[0].attempts.push({
      id: "att-ext",
      runId: "run-ext",
      trial: 1,
      status: "completed",
      startedAt: 1,
      finishedAt: 2,
      error: null,
      repair: { kind: "roster-extension", addedModelKey: "gemini:m3", baseRunId: "run-base" },
    });
    expect(isExperimentRecord(compound)).toBe(true);

    const fallback = validExperiment() as unknown as {
      tasks: Array<{
        taskId: string;
        selectedAttemptId: string | null;
        attempts: Array<Record<string, unknown>>;
      }>;
    };
    fallback.tasks[0].attempts.push({
      id: "att-ext-f",
      runId: "run-ext-f",
      trial: 1,
      status: "partial",
      startedAt: 1,
      finishedAt: 2,
      error: null,
      repair: { kind: "roster-extension", addedModelKey: "gemini:m3" },
    });
    expect(isExperimentRecord(fallback)).toBe(true);
  });

  it("accepts a record with rosterExtensions history", () => {
    const e = validExperiment() as Record<string, unknown>;
    e.rosterExtensions = [
      {
        addedModelKey: "gemini:m3",
        addedSlot: {
          id: "slot-ext",
          providerId: "gemini",
          provider: "Gemini",
          model: "m3",
          slug: "m3",
          enabled: true,
        },
        priorFingerprint: "fp",
        extendedAt: 10,
      },
    ];
    expect(isExperimentRecord(e)).toBe(true);
  });

  it("rejects rosterExtensions with duplicate added keys", () => {
    const e = validExperiment() as Record<string, unknown>;
    e.rosterExtensions = [
      {
        addedModelKey: "gemini:m3",
        addedSlot: {
          id: "slot-ext",
          providerId: "gemini",
          provider: "Gemini",
          model: "m3",
          slug: "m3",
          enabled: true,
        },
        priorFingerprint: "fp",
        extendedAt: 10,
      },
      {
        addedModelKey: "gemini:m3",
        addedSlot: {
          id: "slot-ext-2",
          providerId: "gemini",
          provider: "Gemini",
          model: "m3",
          slug: "m3",
          enabled: true,
        },
        priorFingerprint: "fp2",
        extendedAt: 20,
      },
    ];
    expect(isExperimentRecord(e)).toBe(false);
  });

  it("rejects rosterExtensions whose slot identity mismatches the key", () => {
    const e = validExperiment() as Record<string, unknown>;
    e.rosterExtensions = [
      {
        addedModelKey: "umans:other",
        addedSlot: {
          id: "slot-ext",
          providerId: "gemini",
          provider: "Gemini",
          model: "m3",
          slug: "m3",
          enabled: true,
        },
        priorFingerprint: "fp",
        extendedAt: 10,
      },
    ];
    expect(isExperimentRecord(e)).toBe(false);
  });
});

describe("candidate attempt reusedFrom provenance (Task 8)", () => {
  function attemptWithReuse() {
    const c = clone(validCandidate);
    c.attempts[0] = {
      ...c.attempts[0],
      reusedFrom: {
        sourceRunId: "run-base",
        sourceCandidateId: "cand-base",
        sourceAttemptId: "att-base",
      },
    };
    return c;
  }

  it("accepts a candidate attempt with reusedFrom provenance", () => {
    expect(isPersistedCandidate(attemptWithReuse())).toBe(true);
  });

  it("rejects reusedFrom with a blank sourceRunId", () => {
    const c = attemptWithReuse();
    (c.attempts[0] as unknown as Record<string, unknown>).reusedFrom = {
      sourceRunId: "",
      sourceCandidateId: "cand-base",
      sourceAttemptId: "att-base",
    };
    expect(isPersistedCandidate(c)).toBe(false);
  });

  it("rejects reusedFrom with a credential-shaped source id", () => {
    const c = attemptWithReuse();
    (c.attempts[0] as unknown as Record<string, unknown>).reusedFrom = {
      sourceRunId: "sk-secret-abcdef",
      sourceCandidateId: "cand-base",
      sourceAttemptId: "att-base",
    };
    expect(isPersistedCandidate(c)).toBe(false);
  });

  it("rejects reusedFrom missing a field", () => {
    const c = attemptWithReuse();
    const { sourceAttemptId: _, ...partial } = (c.attempts[0] as unknown as Record<string, unknown>)
      .reusedFrom as Record<string, string>;
    (c.attempts[0] as unknown as Record<string, unknown>).reusedFrom = partial;
    expect(isPersistedCandidate(c)).toBe(false);
  });
});

describe("isPersistedError optional allowlist fields", () => {
  it("accepts a minimal message-only error (backward compatible)", () => {
    expect(isPersistedError({ message: "boom" })).toBe(true);
    expect(isPersistedError({ message: "boom", code: "E401" })).toBe(true);
  });

  it("accepts the full allowlisted shape", () => {
    expect(
      isPersistedError({
        message: "boom",
        code: "E401",
        category: "provider",
        stage: "candidate",
        model: "model-b",
        at: 4242,
      }),
    ).toBe(true);
  });

  it("accepts subsets of the optional fields", () => {
    expect(isPersistedError({ message: "m", category: "provider", stage: "judge" })).toBe(true);
    expect(isPersistedError({ message: "m", at: 1 })).toBe(true);
    expect(isPersistedError({ message: "m", model: "fuse-model" })).toBe(true);
  });

  it("rejects wrong types for each optional field", () => {
    expect(isPersistedError({ message: "m", category: 5 })).toBe(false);
    expect(isPersistedError({ message: "m", stage: null })).toBe(false);
    expect(isPersistedError({ message: "m", model: {} })).toBe(false);
    expect(isPersistedError({ message: "m", at: "now" })).toBe(false);
    expect(isPersistedError({ message: "m", at: Number.NaN })).toBe(false);
  });

  it("still rejects a missing or non-string message", () => {
    expect(isPersistedError({})).toBe(false);
    expect(isPersistedError({ message: 5 })).toBe(false);
    expect(isPersistedError(null)).toBe(false);
  });
});
