import { describe, expect, it } from "vitest";
import { initialState, reducer, type StudioState } from "./studio-engine";
import { HOLISTIC_EVALUATION } from "./lib/evaluations/evaluation-profile-adhoc";

const preload = {
  mode: "fuse" as const,
  prompt: "historical prompt",
  systemPrompt: "historical system",
  temperature: 0.7,
  evaluation: HOLISTIC_EVALUATION,
  slots: initialState.slots.map((slot) => ({ ...slot })),
};

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
    expect(next.judgeReport).toBeNull();
    expect(next.consensus).toBeNull();
    expect(next.fusionStatus).toBe("idle");
    expect(next.fusedText).toBeNull();
    expect(next.insufficient).toBeNull();
    expect(next.aborted).toBe(false);
    expect(next.executionConflict).toBeNull();
    expect(next.attachments).toEqual([]);
    expect(next.attachmentsToJudge).toBe(true);
    expect(next.judgeInstruction).toBe("");
    expect(next.audit[0]?.message).toContain("fresh Compare draft");
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
