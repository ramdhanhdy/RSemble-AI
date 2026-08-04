// =============================================================================
// Experiment roster extension — persisted schema contracts (plan 001, A1).
//
// New optional fields stay backward compatible: records without
// rosterExtensions / roster-extension plans must keep validating.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  isExperimentRecord,
  isExperimentTaskAttempt,
  type EvaluationSuite,
  type EvaluationTask,
  type ExperimentRecord,
  type ExperimentTaskAttempt,
  type ExperimentRosterExtension,
} from "./evaluation-types";

// --- Fixtures ------------------------------------------------------------------

function makeTask(id: string): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: "prompt",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
  };
}

function makeSuite(): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 1,
    version: 1,
    name: "Suite",
    description: "",
    tasks: [makeTask("t1")],
    modelSlots: [
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "m1", slug: "org/m1", enabled: true },
      { id: "s2", providerId: "openrouter", provider: "OpenRouter", model: "m2", slug: "org/m2", enabled: true },
    ],
    defaultJudge: { providerId: "openrouter", model: "org/judge" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeAttempt(overrides: Partial<ExperimentTaskAttempt> = {}): ExperimentTaskAttempt {
  return {
    id: "att-1",
    runId: "run-1",
    trial: 0,
    status: "completed",
    startedAt: 1,
    finishedAt: 2,
    error: null,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  const suite = makeSuite();
  return {
    id: "exp-1",
    revision: 1,
    suiteId: suite.id,
    suiteVersion: suite.version,
    protocolFingerprint: "sha256:abc",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: suite.id,
      suiteVersion: suite.version,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    },
    tasks: [{ taskId: "t1", selectedAttemptId: "att-1", attempts: [makeAttempt()] }],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeExtension(overrides: Partial<ExperimentRosterExtension> = {}): ExperimentRosterExtension {
  return {
    addedModelKey: "gemini:gemini-3.6-flash",
    addedSlot: {
      id: "slot-ext-1",
      providerId: "gemini",
      provider: "Gemini",
      model: "gemini-3.6-flash",
      slug: "gemini-3.6-flash",
      enabled: true,
    },
    priorFingerprint: "sha256:abc",
    extendedAt: 2000,
    ...overrides,
  };
}

// --- Task attempts -------------------------------------------------------------

describe("isExperimentTaskAttempt — roster-extension provenance", () => {
  it("still validates records with no repair/coverage metadata", () => {
    expect(isExperimentTaskAttempt(makeAttempt())).toBe(true);
  });

  it("still validates missing-cells repair plans", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({
          repair: { kind: "missing-cells", baseRunId: "run-base", requestedModelKeys: ["openrouter:org/m2"] },
        }),
      ),
    ).toBe(true);
  });

  it("validates compound roster-extension plans (with baseRunId)", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({
          repair: { kind: "roster-extension", addedModelKey: "gemini:gemini-3.6-flash", baseRunId: "run-base" },
        }),
      ),
    ).toBe(true);
  });

  it("validates full-roster fallback roster-extension plans (no baseRunId)", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({ repair: { kind: "roster-extension", addedModelKey: "gemini:gemini-3.6-flash" } }),
      ),
    ).toBe(true);
  });

  it("rejects blank addedModelKey", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({ repair: { kind: "roster-extension", addedModelKey: "" } }),
      ),
    ).toBe(false);
  });

  it("rejects blank baseRunId", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({ repair: { kind: "roster-extension", addedModelKey: "gemini:m", baseRunId: "" } }),
      ),
    ).toBe(false);
  });

  it("rejects credential-shaped addedModelKey and baseRunId", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({ repair: { kind: "roster-extension", addedModelKey: "sk-abc123:model" } }),
      ),
    ).toBe(false);
    expect(
      isExperimentTaskAttempt(
        makeAttempt({ repair: { kind: "roster-extension", addedModelKey: "gemini:m", baseRunId: "Bearer x" } }),
      ),
    ).toBe(false);
  });

  it("rejects missing-cells plans with duplicate requested keys", () => {
    expect(
      isExperimentTaskAttempt(
        makeAttempt({
          repair: { kind: "missing-cells", baseRunId: "run-base", requestedModelKeys: ["a:b", "a:b"] },
        }),
      ),
    ).toBe(false);
  });
});

// --- Experiment record -----------------------------------------------------------

describe("isExperimentRecord — rosterExtensions history", () => {
  it("still validates records without rosterExtensions", () => {
    expect(isExperimentRecord(makeRecord())).toBe(true);
  });

  it("still validates records with an empty rosterExtensions array", () => {
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [] }))).toBe(true);
  });

  it("validates a record with one extension history entry", () => {
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension()] }))).toBe(true);
  });

  it("validates multiple entries with distinct keys and slot ids", () => {
    const second: ExperimentRosterExtension = {
      addedModelKey: "deepseek:deepseek-chat",
      addedSlot: {
        id: "slot-ext-2",
        providerId: "deepseek",
        provider: "DeepSeek",
        model: "deepseek-chat",
        slug: "deepseek-chat",
        enabled: true,
      },
      priorFingerprint: "sha256:def",
      extendedAt: 3000,
    };
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension(), second] }))).toBe(true);
  });

  it("rejects duplicate addedModelKey in history", () => {
    const dup = makeExtension({ addedSlot: { ...makeExtension().addedSlot, id: "slot-ext-2" } });
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension(), dup] }))).toBe(false);
  });

  it("rejects duplicate slot ids in history", () => {
    const dup = makeExtension({ addedModelKey: "deepseek:deepseek-chat" });
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension(), dup] }))).toBe(false);
  });

  it("rejects addedModelKey mismatching the addedSlot identity", () => {
    expect(
      isExperimentRecord(
        makeRecord({
          rosterExtensions: [makeExtension({ addedModelKey: "umans:something-else" })],
        }),
      ),
    ).toBe(false);
  });

  it("rejects blank priorFingerprint", () => {
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension({ priorFingerprint: "" })] }))).toBe(false);
  });

  it("rejects invalid extendedAt values", () => {
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension({ extendedAt: Number.NaN })] }))).toBe(false);
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension({ extendedAt: -5 })] }))).toBe(false);
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension({ extendedAt: Number.POSITIVE_INFINITY })] }))).toBe(false);
  });

  it("rejects credential-shaped addedModelKey", () => {
    expect(isExperimentRecord(makeRecord({ rosterExtensions: [makeExtension({ addedModelKey: "sk-live123:x" })] }))).toBe(false);
  });

  it("rejects non-array rosterExtensions", () => {
    expect(
      isExperimentRecord(makeRecord({ rosterExtensions: {} as unknown as ExperimentRosterExtension[] })),
    ).toBe(false);
  });
});
