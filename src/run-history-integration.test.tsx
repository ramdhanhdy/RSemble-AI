// =============================================================================
// Integration regression — Phase 2 Task 2.6: one stable run ID lifecycle.
//
// Exercises the real run controller + real run recorder + in-memory repository
// through a full Rank → Fuse → Re-fuse → fail-Re-fuse lifecycle. Verifies:
//   1. One summary ID spans the entire lifecycle (no duplicate addRun).
//   2. Re-fuse creates a second immutable attempt and moves the accepted pointer.
//   3. A failed later Re-fuse preserves the prior accepted Fusion result.
//   4. Accepted candidate and Judge snapshots are byte-equivalent before and
//      after every Fusion attempt (append-only, never mutated).
//
// Uses the real reducer so dispatch mutations mirror production behavior.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type React from "react";
import { createRunController, type RunControllerDeps } from "./lib/run-controller";
import { initialState, reducer, type Action, type StudioState } from "./studio-engine";
import type { StreamDeltaBuffer } from "./lib/stream-buffer";
import { InMemoryRunRepository } from "./lib/persistence/run-repository";
import { createRunRecorder } from "./lib/persistence/run-recorder";
import type { RunRecordV2 } from "./lib/persistence/run-types";
import { addRun } from "./lib/run-history";

// ---------------------------------------------------------------------------
// Provider mocks — same shape as run-controller.test.ts
// ---------------------------------------------------------------------------

const chatStreamMock = vi.fn();
const chatCompletionMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("./lib/providers/registry", () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

vi.mock("./lib/run-history", () => ({
  addRun: vi.fn(),
  modelKey: (p: string, s: string) => `${p}:${s}`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TWO_SLOTS: StudioState["slots"] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "A",
    slug: "model-a",
    enabled: true,
  },
  { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
];

const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;

/** Wait for the controller's async IIFE to settle. */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeStreamBuffer(): StreamDeltaBuffer {
  return {
    push: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  } as unknown as StreamDeltaBuffer;
}

async function* streamOf(text: string): AsyncGenerator<string, void, unknown> {
  yield text;
}

function judgeResponse(scores: Array<readonly [string, number]>): string {
  return JSON.stringify({
    consensus: [],
    contradictions: [],
    uniqueInsights: [],
    evaluations: scores.map(([label, score]) => ({
      label,
      score,
      position: `Position ${label}`,
      rationale: `Evidence ${label}`,
      strengths: [`Strength ${label}`],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    })),
    comparisons: [],
  });
}

function makeDeps(
  state: StudioState,
  recorder: ReturnType<typeof createRunRecorder> | null,
): {
  deps: RunControllerDeps;
  stateRef: React.MutableRefObject<StudioState>;
} {
  const stateRef = { current: state } as React.MutableRefObject<StudioState>;
  const runEpochRef = { current: 0 } as React.MutableRefObject<number>;
  const abortControllersRef = { current: new Set<AbortController>() } as React.MutableRefObject<
    Set<AbortController>
  >;
  const dispatch: React.Dispatch<Action> = (a) => {
    stateRef.current = reducer(stateRef.current, a);
  };
  const deps: RunControllerDeps = {
    stateRef,
    dispatch,
    runEpochRef,
    abortControllersRef,
    streamBuffer: makeStreamBuffer(),
    random: () => 0.999, // identity shuffle: A→A, B→B
    now: () => Date.now(),
    recorder: recorder ?? undefined,
  };
  return { deps, stateRef };
}

function stateWithSlots(slots: StudioState["slots"], mode: "rank" | "fuse" = "rank"): StudioState {
  return {
    ...initialState,
    mode,
    prompt: "integration test prompt",
    slots,
    critic: { providerId: "openrouter", model: "judge-model" },
  };
}

beforeEach(() => {
  chatStreamMock.mockReset();
  chatCompletionMock.mockReset();
  getProviderMock.mockReset();
  getProviderMock.mockImplementation(() => ({
    id: "openrouter",
    label: "OpenRouter",
    chatCompletionStream: chatStreamMock,
    chatCompletion: chatCompletionMock,
  }));
});

describe("run-history integration: one stable run ID lifecycle", () => {
  it("Rank → Fuse → Re-fuse → fail-Re-fuse preserves one run ID and accepted evidence", async () => {
    const repo = new InMemoryRunRepository();
    const recorder = createRunRecorder(repo, {
      now: () => Date.now(),
    });

    const state = stateWithSlots(TWO_SLOTS, "rank");
    const { deps, stateRef } = makeDeps(state, recorder);
    const controller = createRunController(deps);

    // --- Step 1: Execute a successful Rank run ---
    chatStreamMock.mockImplementation(() => streamOf("answer A"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4.0],
        ["B", 3.0],
      ]),
    );
    await controller.runFanout();

    // --- Step 2: Assert one summary ID ---
    const summariesAfterRank = await repo.list({ limit: 100 });
    expect(summariesAfterRank).toHaveLength(1);
    const runId = summariesAfterRank[0]!.id;
    expect(summariesAfterRank[0]!.kind).toBe("full");

    // No duplicate addRun calls — persistence is through the recorder
    expect(addRunMock).not.toHaveBeenCalled();

    // Snapshot accepted candidate + Judge evidence before Fusion
    const recordAfterRank = await repo.get(runId);
    expect(recordAfterRank).not.toBeNull();
    const candidatesBeforeFusion = recordAfterRank!.candidates.map((c) => ({
      acceptedAttemptId: c.acceptedAttemptId,
      attempts: c.attempts.map((a) => ({ ...a, messages: a.messages })),
    }));
    const judgeBeforeFusion = recordAfterRank!.judge.acceptedAttemptId;

    // --- Step 3: Switch to Fuse mode ---
    stateRef.current = { ...stateRef.current, mode: "fuse", fusionStatus: "idle" };

    // --- Step 4: Complete Fusion ---
    chatCompletionMock.mockResolvedValueOnce("fused answer 1");
    controller.triggerFusion(true);
    // triggerFusion runs async via IIFE — wait for completion
    await delay(50);

    const recordAfterFusion = await repo.get(runId);
    expect(recordAfterFusion).not.toBeNull();

    // --- Step 5: Same summary ID, one detail record, one accepted Fusion ---
    const summariesAfterFusion = await repo.list({ limit: 100 });
    expect(summariesAfterFusion).toHaveLength(1);
    expect(summariesAfterFusion[0]!.id).toBe(runId);

    expect(recordAfterFusion!.fusion.attempts).toHaveLength(1);
    expect(recordAfterFusion!.fusion.attempts[0]!.status).toBe("completed");
    expect(recordAfterFusion!.fusion.attempts[0]!.result).toBe("fused answer 1");
    expect(recordAfterFusion!.fusion.acceptedAttemptId).toBe(
      recordAfterFusion!.fusion.attempts[0]!.attemptId,
    );

    // Accepted candidate + Judge snapshots are byte-equivalent (append-only)
    const candidatesAfterFusion = recordAfterFusion!.candidates.map((c) => ({
      acceptedAttemptId: c.acceptedAttemptId,
      attempts: c.attempts.map((a) => ({ ...a, messages: a.messages })),
    }));
    expect(candidatesAfterFusion).toEqual(candidatesBeforeFusion);
    expect(recordAfterFusion!.judge.acceptedAttemptId).toBe(judgeBeforeFusion);

    // --- Step 6: Re-fuse successfully → second immutable attempt, moved pointer ---
    stateRef.current = { ...stateRef.current, fusionStatus: "idle" };
    chatCompletionMock.mockResolvedValueOnce("fused answer 2");
    controller.triggerFusion(true);
    await delay(50);

    const recordAfterRefuse = await repo.get(runId);
    expect(recordAfterRefuse).not.toBeNull();
    expect(recordAfterRefuse!.fusion.attempts).toHaveLength(2);

    // First attempt is immutable — same result, same status
    expect(recordAfterRefuse!.fusion.attempts[0]!.result).toBe("fused answer 1");
    expect(recordAfterRefuse!.fusion.attempts[0]!.status).toBe("completed");

    // Accepted pointer moved to the second attempt
    expect(recordAfterRefuse!.fusion.acceptedAttemptId).toBe(
      recordAfterRefuse!.fusion.attempts[1]!.attemptId,
    );
    expect(recordAfterRefuse!.fusion.attempts[1]!.result).toBe("fused answer 2");
    expect(recordAfterRefuse!.fusion.attempts[1]!.status).toBe("completed");

    // Candidate + Judge snapshots still byte-equivalent
    const candidatesAfterRefuse = recordAfterRefuse!.candidates.map((c) => ({
      acceptedAttemptId: c.acceptedAttemptId,
      attempts: c.attempts.map((a) => ({ ...a, messages: a.messages })),
    }));
    expect(candidatesAfterRefuse).toEqual(candidatesBeforeFusion);
    expect(recordAfterRefuse!.judge.acceptedAttemptId).toBe(judgeBeforeFusion);

    // --- Step 7: Fail a later Re-fuse → accepted pointer/result unchanged ---
    stateRef.current = { ...stateRef.current, fusionStatus: "idle" };
    chatCompletionMock.mockRejectedValueOnce(new Error("Provider 500"));
    controller.triggerFusion(true);
    await delay(50);

    const recordAfterFail: RunRecordV2 | null = await repo.get(runId);
    expect(recordAfterFail).not.toBeNull();
    expect(recordAfterFail!.fusion.attempts).toHaveLength(3);

    // Third attempt is failed
    expect(recordAfterFail!.fusion.attempts[2]!.status).toBe("failed");
    expect(recordAfterFail!.fusion.attempts[2]!.result).toBeNull();

    // Accepted pointer still points to the second (successful) attempt
    expect(recordAfterFail!.fusion.acceptedAttemptId).toBe(
      recordAfterRefuse!.fusion.acceptedAttemptId,
    );

    // Candidate + Judge snapshots still byte-equivalent
    const candidatesAfterFail = recordAfterFail!.candidates.map((c) => ({
      acceptedAttemptId: c.acceptedAttemptId,
      attempts: c.attempts.map((a) => ({ ...a, messages: a.messages })),
    }));
    expect(candidatesAfterFail).toEqual(candidatesBeforeFusion);
    expect(recordAfterFail!.judge.acceptedAttemptId).toBe(judgeBeforeFusion);

    // --- Final: still exactly one summary ---
    const finalSummaries = await repo.list({ limit: 100 });
    expect(finalSummaries).toHaveLength(1);
    expect(finalSummaries[0]!.id).toBe(runId);
    expect(addRunMock).not.toHaveBeenCalled();
  });

  it("Rank run with no recorder keeps evidence in memory only — no addRun fallback", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    const { deps } = makeDeps(state, null);
    const controller = createRunController(deps);

    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4.0],
        ["B", 3.0],
      ]),
    );
    await controller.runFanout();

    // No recorder → no addRun fallback, evidence stays in memory only
    expect(addRunMock).not.toHaveBeenCalled();
  });
});
