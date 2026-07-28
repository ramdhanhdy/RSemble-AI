import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type React from "react";
import { createRunController, type RunControllerDeps } from "./run-controller";
import { initialState, type Action, type StudioState } from "../studio-engine";
import type { StreamDeltaBuffer } from "./stream-buffer";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const chatStreamMock = vi.fn();
const chatCompletionMock = vi.fn();

vi.mock("./providers/registry", () => ({
  getProvider: () => ({
    id: "openrouter",
    label: "OpenRouter",
    chatCompletionStream: chatStreamMock,
    chatCompletion: chatCompletionMock,
  }),
}));

vi.mock("./run-history", () => ({
  addRun: vi.fn(),
  modelKey: (p: string, s: string) => `${p}:${s}`,
}));

vi.mock("./history-cache", () => ({
  invalidateHistoryCache: vi.fn(),
}));

function makeStreamBuffer(): StreamDeltaBuffer {
  return {
    push: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  } as unknown as StreamDeltaBuffer;
}

function makeDeps(state: StudioState) {
  const dispatched: Action[] = [];
  const stateRef = { current: state } as React.MutableRefObject<StudioState>;
  const runEpochRef = { current: 0 } as React.MutableRefObject<number>;
  const abortControllersRef = { current: new Set<AbortController>() } as React.MutableRefObject<
    Set<AbortController>
  >;
  const dispatch: React.Dispatch<Action> = (a) => {
    dispatched.push(a);
    // Minimal reducer emulation for the flags the controller checks.
    if (a.type === "FANOUT_START") stateRef.current = { ...stateRef.current, running: true, candidates: a.candidates };
    if (a.type === "CANDIDATE_RESULT") {
      stateRef.current = {
        ...stateRef.current,
        candidates: stateRef.current.candidates.map((c) =>
          c.id === a.id ? { ...c, status: "done", segments: a.segments, summary: a.summary } : c,
        ),
      };
    }
    if (a.type === "CANDIDATE_FAILED") {
      stateRef.current = {
        ...stateRef.current,
        candidates: stateRef.current.candidates.map((c) =>
          c.id === a.id ? { ...c, status: "error", errorMessage: a.error } : c,
        ),
      };
    }
    if (a.type === "FANOUT_END") stateRef.current = { ...stateRef.current };
    if (a.type === "INSUFFICIENT_CANDIDATES") stateRef.current = { ...stateRef.current, running: false };
    if (a.type === "JUDGE_START") stateRef.current = { ...stateRef.current, judgeStatus: "running" };
    if (a.type === "JUDGE_RESULT") stateRef.current = { ...stateRef.current, judgeStatus: "done" };
    if (a.type === "JUDGE_FAILED") stateRef.current = { ...stateRef.current, running: false, judgeStatus: "error" };
    if (a.type === "ABORT_RUN") stateRef.current = { ...stateRef.current, running: false, aborted: true };
  };
  const deps: RunControllerDeps = {
    stateRef,
    dispatch,
    runEpochRef,
    abortControllersRef,
    streamBuffer: makeStreamBuffer(),
  };
  return { deps, dispatched, stateRef, runEpochRef, abortControllersRef };
}

function stateWithSlots(slots: StudioState["slots"], mode: "rank" | "fuse" = "rank"): StudioState {
  return {
    ...initialState,
    mode,
    prompt: "test prompt",
    slots,
    critic: { providerId: "openrouter", model: "judge-model" },
  };
}

const TWO_SLOTS: StudioState["slots"] = [
  { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
  { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
];

async function* streamOf(text: string): AsyncGenerator<string, void, unknown> {
  yield text;
}

beforeEach(() => {
  chatStreamMock.mockReset();
  chatCompletionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Guarded run paths
// ---------------------------------------------------------------------------

describe("run-controller — guarded paths", () => {
  it("runFanout with no enabled slots does nothing (no dispatch, no provider calls)", async () => {
    const state = stateWithSlots([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "a", enabled: false },
    ]);
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();
    expect(dispatched).toHaveLength(0);
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("dispatches INSUFFICIENT_CANDIDATES and skips the judge when fewer than 2 candidates succeed", async () => {
    const state = stateWithSlots(TWO_SLOTS);
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new Error("provider B exploded");
      });
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("CANDIDATE_FAILED");
    expect(types).toContain("INSUFFICIENT_CANDIDATES");
    expect(types).not.toContain("JUDGE_START");
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("dispatches JUDGE_FAILED and stops when the judge call rejects", async () => {
    const state = stateWithSlots(TWO_SLOTS);
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockRejectedValue(new Error("judge unavailable"));
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("JUDGE_FAILED");
    expect(stateRef.current.running).toBe(false);
  });

  it("stale epoch after abort prevents post-abort dispatches", async () => {
    const state = stateWithSlots(TWO_SLOTS);
    const { deps, dispatched, abortControllersRef } = makeDeps(state);

    let resolveStream: (() => void) | undefined;
    chatStreamMock.mockImplementation(
      (opts: { signal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) => {
            resolveStream = resolve;
            opts.signal?.addEventListener("abort", () => resolve());
          });
          if (opts.signal?.aborted) {
            throw new DOMException("The operation was aborted.", "AbortError");
          }
          yield "late answer";
        })(),
    );

    const controller = createRunController(deps);
    const runPromise = controller.runFanout();

    // Let the streams start, then abort mid-run.
    await new Promise((r) => setTimeout(r, 10));
    controller.abortRun();
    expect(abortControllersRef.current.size).toBe(0);
    resolveStream?.();
    await runPromise;

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("ABORT_RUN");
    // No candidate results, judge, or fusion may be dispatched after abort.
    expect(types).not.toContain("CANDIDATE_RESULT");
    expect(types).not.toContain("JUDGE_START");
    expect(types).not.toContain("FANOUT_END");
  });

  it("abortRun bumps epoch, aborts all controllers, cancels the stream buffer, and dispatches ABORT_RUN", () => {
    const state = stateWithSlots(TWO_SLOTS);
    const { deps, dispatched, runEpochRef } = makeDeps(state);
    const controller = createRunController(deps);
    const before = runEpochRef.current;
    controller.abortRun();
    expect(runEpochRef.current).toBe(before + 1);
    expect(deps.streamBuffer.cancel).toHaveBeenCalled();
    expect(dispatched.map((a) => a.type)).toContain("ABORT_RUN");
  });

  it("triggerFusion is a no-op while a run is in progress", () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    state.running = true;
    const { deps } = makeDeps(state);
    const controller = createRunController(deps);
    controller.triggerFusion(true);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("retryCandidate is a no-op while running", async () => {
    const state = stateWithSlots(TWO_SLOTS);
    state.running = true;
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.retryCandidate({
      id: "cand-s1",
      model: "A",
      provider: "OpenRouter",
      providerId: "openrouter",
      slug: "model-a",
      accent: "A",
      strategy: "Parallel model",
      summary: "",
      scores: {},
      weightedScore: 0,
      segments: [],
      status: "error",
    });
    expect(dispatched).toHaveLength(0);
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("happy path: fanout → judge → (rank) terminal JUDGE_RESULT with provider-scoped history keys", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({
        consensus: [],
        contradictions: [],
        uniqueInsights: [],
        scores: [
          { label: "A", score: 4.0 },
          { label: "B", score: 3.0 },
        ],
      }),
    );
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toEqual([
      "FANOUT_START",
      "CANDIDATE_RESULT",
      "CANDIDATE_RESULT",
      "FANOUT_END",
      "JUDGE_START",
      "JUDGE_RESULT",
    ]);
    const { addRun } = await import("./run-history");
    const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;
    expect(addRunMock).toHaveBeenCalledTimes(1);
    const entry = addRunMock.mock.calls[0][0] as { models: string[]; winner: string };
    expect(entry.models).toEqual(["openrouter:model-a", "umans:model-b"]);
    expect(entry.winner).toBe("openrouter:model-a");
  });

  it("retry judges the locally materialized replacement when dispatch state is not synchronous", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    state.candidates = [
      {
        id: "cand-s1", model: "A", provider: "OpenRouter", providerId: "openrouter", slug: "model-a",
        accent: "indigo", strategy: "Parallel model", summary: "good", scores: {}, weightedScore: 0,
        segments: [{ id: "a", text: "existing answer" }], status: "done", startedAt: 100, finishedAt: 200,
      },
      {
        id: "cand-s2", model: "B", provider: "Umans", providerId: "umans", slug: "model-b",
        accent: "emerald", strategy: "Parallel model", summary: "", scores: {}, weightedScore: 0,
        segments: [], status: "error", errorMessage: "failed",
      },
    ];
    chatStreamMock.mockImplementation(() => streamOf("retried answer"));
    chatCompletionMock.mockResolvedValue(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [] }));
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.retryCandidate(state.candidates[1]);

    expect(dispatched.map((a) => a.type)).toContain("JUDGE_START");
    expect(dispatched.map((a) => a.type)).not.toContain("INSUFFICIENT_CANDIDATES");
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(chatCompletionMock.mock.calls[0][0])).toContain("retried answer");
  });

  it("records deterministic nonzero candidate latency and token metadata from local fanout results", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("four token answer"));
    chatCompletionMock.mockResolvedValue(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [] }));
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_250)
      .mockReturnValueOnce(1_500)
      .mockReturnValue(2_000);
    const { deps, dispatched } = makeDeps(state);

    await createRunController(deps).runFanout();

    const { addRun } = await import("./run-history");
    const entry = (addRun as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      stats: Record<string, { latencyMs: number }>;
    };
    expect(entry.stats["openrouter:model-a"].latencyMs).toBe(250);
    expect(entry.stats["umans:model-b"].latencyMs).toBe(500);
    const results = dispatched.filter((action) => action.type === "CANDIDATE_RESULT");
    expect(results).toEqual([
      expect.objectContaining({ finishedAt: 1_250, tokensIn: expect.any(Number), tokensOut: expect.any(Number) }),
      expect.objectContaining({ finishedAt: 1_500, tokensIn: expect.any(Number), tokensOut: expect.any(Number) }),
    ]);
    for (const result of results) {
      if (result.type === "CANDIDATE_RESULT") {
        expect(result.tokensIn).toBeGreaterThan(0);
        expect(result.tokensOut).toBeGreaterThan(0);
      }
    }
  });

  it("uses the immutable seed mode when mode mutates during a run", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    const { deps, stateRef, dispatched } = makeDeps(state);
    chatStreamMock.mockImplementation(() => (async function* () {
      stateRef.current = { ...stateRef.current, mode: "fuse" };
      yield "answer";
    })());
    chatCompletionMock.mockResolvedValue(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [] }));

    await createRunController(deps).runFanout();

    const { addRun } = await import("./run-history");
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(addRun).toHaveBeenCalledTimes(1);
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
  });
});
