import { describe, expect, it } from "vitest";
import { initialState, reducer, type StudioState } from "./studio-engine";
import { HOLISTIC_EVALUATION } from "./lib/evaluations/evaluation-rubric-adhoc";
import type { RubricSnapshot } from "./lib/evaluations/evaluation-types";

const preload = {
  mode: "fuse" as const,
  prompt: "historical prompt",
  systemPrompt: "historical system",
  temperature: 0.7,
  evaluation: HOLISTIC_EVALUATION,
  slots: initialState.slots.map((slot) => ({ ...slot })),
};

const rubric = (): RubricSnapshot => ({
  id: "p1",
  version: 3,
  name: "Loadable",
  description: "",
  judgeInstruction: "",
  criteria: [],
  createdAt: 1,
  updatedAt: 1,
});

describe("FANOUT_START run id lifecycle", () => {
  const context = {
    prompt: "task",
    evaluation: HOLISTIC_EVALUATION,
    attachments: [],
    attachmentsToJudge: true,
  };

  it("stores a supplied persisted run id and replaces it on a later fanout", () => {
    const first = reducer(initialState, {
      type: "FANOUT_START",
      runId: "run-one",
      candidates: [],
      context,
    });
    expect(first.runId).toBe("run-one");

    const second = reducer(first, {
      type: "FANOUT_START",
      runId: "run-two",
      candidates: [],
      context,
    });
    expect(second.runId).toBe("run-two");
  });

  it("degrades an older caller without a run id to a non-linkable run", () => {
    const next = reducer(initialState, {
      type: "FANOUT_START",
      candidates: [],
      context,
    });
    expect(next.runId).toBeNull();
  });

  it("RESET_SESSION clears the surfaced run id", () => {
    const started = reducer(initialState, {
      type: "FANOUT_START",
      runId: "run-one",
      candidates: [],
      context,
    });
    expect(reducer(started, { type: "RESET_SESSION" }).runId).toBeNull();
  });
});

describe("LOAD_RUN_CONFIG fresh-draft boundary", () => {
  it("clears stale execution identity, results, attachments, and non-restorable judge text", () => {
    const dirty: StudioState = {
      ...initialState,
      running: false,
      runId: "run-old",
      candidates: [{ id: "old-candidate", status: "done" } as StudioState["candidates"][number]],
      judgeStatus: "done",
      judgeError: "stale judge error",
      judgeReport: { evaluationsById: {} } as StudioState["judgeReport"],
      consensus: { consensus: ["old"], contradictions: [], uniqueInsights: [] },
      fusionStatus: "done",
      fusionError: "stale fusion error",
      fusedText: "old fused result",
      insufficient: { done: 1, failed: 1 },
      aborted: true,
      executionConflict: "old lease conflict",
      runContext: {
        prompt: "old prompt",
        evaluation: HOLISTIC_EVALUATION,
        attachments: [],
        attachmentsToJudge: true,
      },
      attachments: [
        {
          id: "att-old",
          name: "old.txt",
          kind: "text",
          mimeType: "text/plain",
          bytes: 3,
          status: "ready",
          text: "old",
        },
      ],
      attachmentsToJudge: false,
      judgeInstruction: "unrelated current-session judge instruction",
    };

    const next = reducer(dirty, { type: "LOAD_RUN_CONFIG", config: preload });

    expect(next.mode).toBe("fuse");
    expect(next.prompt).toBe("historical prompt");
    expect(next.systemPrompt).toBe("historical system");
    expect(next.temperature).toBe(0.7);
    expect(next.runId).toBeNull();
    expect(next.runContext).toBeNull();
    expect(next.candidates).toEqual([]);
    expect(next.judgeStatus).toBe("idle");
    expect(next.judgeError).toBeNull();
    expect(next.judgeReport).toBeNull();
    expect(next.consensus).toBeNull();
    expect(next.fusionStatus).toBe("idle");
    expect(next.fusionError).toBeNull();
    expect(next.fusedText).toBeNull();
    expect(next.insufficient).toBeNull();
    expect(next.aborted).toBe(false);
    expect(next.executionConflict).toBeNull();
    expect(next.attachments).toEqual([]);
    expect(next.attachmentsToJudge).toBe(true);
    expect(next.judgeInstruction).toBe("");
    expect(next.audit[0]?.message).toContain("fresh Compare draft");
  });

  it("restores persisted config and deep-copies the evaluation rubric", () => {
    const evaluation = {
      kind: "profile" as const,
      ref: { id: "p1", version: 3 },
      profile: rubric(),
    };
    const next = reducer(initialState, {
      type: "LOAD_RUN_CONFIG",
      config: {
        ...preload,
        evaluation,
        slots: [
          {
            id: "s9",
            providerId: "openrouter",
            provider: "openrouter",
            model: "m",
            slug: "m",
            enabled: true,
          },
        ],
        critic: { providerId: "openrouter", model: "judge" },
        reasoningPolicy: { candidates: "medium", judge: "high" },
      },
    });

    expect(next.evaluation).toEqual(evaluation);
    expect(next.evaluation).not.toBe(evaluation);
    if (next.evaluation.kind !== "holistic") {
      expect(next.evaluation.profile).not.toBe(evaluation.profile);
    }
    expect(next.slots).toHaveLength(1);
    expect(next.slots[0]?.slug).toBe("m");
    expect(next.critic).toEqual({ providerId: "openrouter", model: "judge" });
    expect(next.reasoningPolicy).toEqual({ candidates: "medium", judge: "high" });
  });

  it("uses clean initialState defaults for critic/reasoning when absent and clears unpersisted judge instruction", () => {
    // A historical record that lacks a reconstructible critic or reasoning
    // policy (e.g. aborted pre-judge) must NOT leak the mutable current
    // Compare session's critic/reasoning into the fresh draft. The fresh
    // draft starts from the clean initialState baseline (copied defensively)
    // so no session configuration crosses the historical load boundary.
    const base: StudioState = {
      ...initialState,
      critic: { providerId: "umans", model: "current-judge" },
      judgeInstruction: "do not leak me",
      reasoningPolicy: { candidates: "high", judge: "high" },
    };
    const next = reducer(base, {
      type: "LOAD_RUN_CONFIG",
      config: {
        mode: "rank",
        prompt: "p",
        systemPrompt: "",
        temperature: 0.4,
        evaluation: HOLISTIC_EVALUATION,
        slots: [],
      },
    });

    expect(next.critic).toEqual(initialState.critic);
    // Defensive copies — never the mutable session ref or the shared
    // initialState ref, so later edits cannot mutate either source.
    expect(next.critic).not.toBe(base.critic);
    expect(next.critic).not.toBe(initialState.critic);
    expect(next.reasoningPolicy).toEqual(initialState.reasoningPolicy);
    expect(next.reasoningPolicy).not.toBe(base.reasoningPolicy);
    expect(next.reasoningPolicy).not.toBe(initialState.reasoningPolicy);
    // The user's ad-hoc judge instruction is never persisted on the record;
    // the fresh draft starts blank regardless of the session's current text.
    expect(next.judgeInstruction).toBe("");
  });

  it("retains historical critic/reasoning when present and still clears unpersisted judge instruction", () => {
    const base: StudioState = {
      ...initialState,
      critic: { providerId: "umans", model: "current-judge" },
      judgeInstruction: "do not leak me",
      reasoningPolicy: { candidates: "high", judge: "high" },
    };
    const next = reducer(base, {
      type: "LOAD_RUN_CONFIG",
      config: {
        mode: "rank",
        prompt: "p",
        systemPrompt: "",
        temperature: 0.4,
        evaluation: HOLISTIC_EVALUATION,
        slots: [],
        critic: { providerId: "openrouter", model: "historical-judge" },
        reasoningPolicy: { candidates: "low", judge: "medium" },
      },
    });

    expect(next.critic).toEqual({ providerId: "openrouter", model: "historical-judge" });
    expect(next.critic).not.toBe(base.critic);
    expect(next.reasoningPolicy).toEqual({ candidates: "low", judge: "medium" });
    expect(next.reasoningPolicy).not.toBe(base.reasoningPolicy);
    expect(next.judgeInstruction).toBe("");
  });

  it("does not mutate command or execution state while Compare is actively running", () => {
    const running: StudioState = {
      ...initialState,
      running: true,
      runId: "run-live",
      prompt: "live paid execution",
    };

    const next = reducer(running, { type: "LOAD_RUN_CONFIG", config: preload });

    expect(next).toBe(running);
    expect(next.runId).toBe("run-live");
    expect(next.prompt).toBe("live paid execution");
  });
});
