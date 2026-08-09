// =============================================================================
// Slice 5 — Run → Compare config preload (runConfigFromRecord) unit tests.
//
// Verifies the honest-preload contract: the frozen command-pane config is
// derived EXACTLY from what the record stores (task, resolved profile,
// candidate roster, judge target from the accepted attempt, reasoning
// policy) and never fabricates anything the record does not contain.
// =============================================================================

import { describe, expect, it } from "vitest";
import { runConfigFromRecord } from "./run-config-preload";
import type { RunRecordV2 } from "../persistence/run-types";

function makeRecord(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: "run-1",
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1716048000000,
    updatedAt: 1716048060000,
    completedAt: 1716048060000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Bubble sort",
      prompt: "Write a function that sorts integers using bubble sort.",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
    },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c1",
        slotId: "s1",
        modelKey: "openrouter:gpt-4o",
        providerId: "openrouter",
        model: "GPT-4o",
        slug: "gpt-4o",
        acceptedAttemptId: "att-1",
        attempts: [],
      },
      {
        candidateId: "c2",
        slotId: "s2",
        modelKey: "umans:claude-opus",
        providerId: "umans",
        model: "Claude Opus",
        slug: "claude-opus",
        acceptedAttemptId: null,
        attempts: [],
      },
    ],
    judge: {
      status: "done",
      acceptedAttemptId: "judge-att-1",
      report: null,
      consensus: null,
      attempts: [
        {
          attemptId: "judge-att-1",
          providerId: "openrouter",
          model: "judge-model",
          instruction: "Evaluate",
          messages: [],
          blindLabelToCandidateId: {},
          candidateAttemptIdsByCandidateId: {},
          startedAt: 1716048030000,
          finishedAt: 1716048050000,
          status: "completed",
          error: null,
          report: null,
          consensus: null,
        },
        {
          attemptId: "judge-att-2",
          providerId: "umans",
          model: "judge-model-2",
          instruction: "Evaluate again",
          messages: [],
          blindLabelToCandidateId: {},
          candidateAttemptIdsByCandidateId: {},
          startedAt: 1716048050000,
          finishedAt: null,
          status: "failed",
          error: { message: "boom" },
          report: null,
          consensus: null,
        },
      ],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:gpt-4o"],
    ...overrides,
  };
}

describe("runConfigFromRecord — honest preload (Slice 5 G2)", () => {
  it("restores mode, task, and temperature verbatim from the record", () => {
    const config = runConfigFromRecord(makeRecord());
    expect(config.mode).toBe("rank");
    expect(config.prompt).toBe("Write a function that sorts integers using bubble sort.");
    expect(config.systemPrompt).toBe("You are a helpful assistant.");
    expect(config.temperature).toBe(0.7);
  });

  it("builds an enabled slot per persisted candidate (the roster that actually ran)", () => {
    const config = runConfigFromRecord(makeRecord());
    expect(config.slots).toHaveLength(2);
    expect(config.slots[0]).toMatchObject({
      id: "s1",
      providerId: "openrouter",
      provider: "openrouter",
      model: "GPT-4o",
      slug: "gpt-4o",
      enabled: true,
    });
    expect(config.slots[1]?.slug).toBe("claude-opus");
    // Every restored slot is enabled — the record only stores candidates that ran.
    expect(config.slots.every((s) => s.enabled)).toBe(true);
  });

  it("resolves a profile-kind evaluation with the persisted snapshot when the record used a profile", () => {
    const record = makeRecord({
      evaluation: {
        profile: {
          id: "p1",
          version: 3,
          name: "Loadable",
          description: "",
          judgeInstruction: "",
          criteria: [],
          createdAt: 1,
          updatedAt: 1,
        },
        candidateMessages: [],
      },
    });
    const config = runConfigFromRecord(record);
    expect(config.evaluation).toEqual({
      kind: "profile",
      ref: { id: "p1", version: 3 },
      profile: record.evaluation.profile,
    });
  });

  it("falls back to holistic evaluation when the record has no profile", () => {
    const config = runConfigFromRecord(makeRecord());
    expect(config.evaluation).toEqual({ kind: "holistic" });
  });

  it("takes the judge target from the accepted judge attempt", () => {
    const config = runConfigFromRecord(makeRecord());
    expect(config.critic).toEqual({ providerId: "openrouter", model: "judge-model" });
  });

  it("falls back to the most recent judge attempt when the accepted id is stale", () => {
    const config = runConfigFromRecord(
      makeRecord({ judge: { ...makeRecord().judge, acceptedAttemptId: "does-not-exist" } }),
    );
    // Last attempt (index 1) is judge-att-2 / umans judge-model-2.
    expect(config.critic).toEqual({ providerId: "umans", model: "judge-model-2" });
  });

  it("omits the critic when the run aborted before any judge attempt", () => {
    const config = runConfigFromRecord(
      makeRecord({ judge: { ...makeRecord().judge, attempts: [], acceptedAttemptId: null } }),
    );
    expect(config.critic).toBeUndefined();
  });

  it("restores the reasoning policy from provenance and omits it when absent", () => {
    const withReasoning = runConfigFromRecord(
      makeRecord({
        reasoning: {
          candidates: {
            s1: { requested: "medium", effective: "medium", source: "catalog" },
            s2: { requested: "medium", effective: "high", source: "catalog" },
          },
          judge: { requested: "high", effective: "high", source: "catalog" },
        },
      }),
    );
    expect(withReasoning.reasoningPolicy).toEqual({ candidates: "medium", judge: "high" });

    const withoutReasoning = runConfigFromRecord(makeRecord());
    expect(withoutReasoning.reasoningPolicy).toBeUndefined();
  });

  it("never fabricates: results, attachments, and lineage fields are absent from the preload", () => {
    const config = runConfigFromRecord(makeRecord());
    // The preload shape only carries command-pane inputs.
    const keys = Object.keys(config).sort();
    expect(keys).toEqual(
      [
        "critic",
        "evaluation",
        "mode",
        "prompt",
        "reasoningPolicy",
        "slots",
        "systemPrompt",
        "temperature",
      ].sort(),
    );
    // No record mutation / lineage fabrication fields anywhere in the payload.
    expect(JSON.stringify(config)).not.toContain("rebasedFrom");
  });
});
