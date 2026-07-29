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
    if (a.type === "INSUFFICIENT_CANDIDATES") stateRef.current = { ...stateRef.current, running: false, insufficient: { done: a.done, failed: a.failed } };
    if (a.type === "JUDGE_START") stateRef.current = { ...stateRef.current, judgeStatus: "running" };
    if (a.type === "JUDGE_RESULT") stateRef.current = { ...stateRef.current, judgeStatus: "done" };
    if (a.type === "JUDGE_FAILED") stateRef.current = { ...stateRef.current, running: false, judgeStatus: "error" };
    if (a.type === "FUSION_START") stateRef.current = { ...stateRef.current, fusionStatus: "running" };
    if (a.type === "FUSION_RESULT") stateRef.current = { ...stateRef.current, running: false, fusionStatus: "done", fusedText: a.text };
    if (a.type === "FUSION_FAILED") stateRef.current = { ...stateRef.current, running: false, fusionStatus: "error" };
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

const THREE_SLOTS: StudioState["slots"] = [
  { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
  { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
  { id: "s3", providerId: "gemini", provider: "Gemini", model: "C", slug: "model-c", enabled: true },
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
    chatCompletionMock.mockResolvedValue(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
      { label: "A", score: 4.0 }, { label: "B", score: 3.0 },
    ] }));
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
    chatCompletionMock.mockResolvedValue(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
      { label: "A", score: 4.0 }, { label: "B", score: 3.0 },
    ] }));
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
    chatCompletionMock.mockResolvedValue(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
      { label: "A", score: 4.0 }, { label: "B", score: 3.0 },
    ] }));

    await createRunController(deps).runFanout();

    const { addRun } = await import("./run-history");
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(addRun).toHaveBeenCalledTimes(1);
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
  });
});

describe("run-controller — judge instruction threading", () => {
  it("passes state.judgeInstruction into the judge prompt (rank path)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    state.judgeInstruction = "Penalize any answer that hedges.";
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [] }),
    );
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();

    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    const judgeCall = chatCompletionMock.mock.calls[0][0];
    const judgeText = JSON.stringify(judgeCall.messages);
    expect(judgeText).toContain("Penalize any answer that hedges.");
  });

  it("passes state.judgeInstruction into the fusion prompt (fuse path)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    state.judgeInstruction = "Lean toward concrete examples.";
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    // judge call then fusion call
    chatCompletionMock
      .mockResolvedValueOnce(
        JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
          { label: "A", score: 4.0 }, { label: "B", score: 3.0 },
        ] }),
      )
      .mockResolvedValueOnce("fused answer");
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).runFanout();

    expect(dispatched.map((a) => a.type)).toContain("FUSION_RESULT");
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    // The second completion call is the fusion call — its messages must carry
    // the judge instruction.
    const fusionCall = chatCompletionMock.mock.calls[1][0];
    const fusionText = JSON.stringify(fusionCall.messages);
    expect(fusionText).toContain("Lean toward concrete examples.");
  });

  it("omits the judge-instruction suffix from the judge prompt when state.judgeInstruction is empty", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    // judgeInstruction defaults to "" via initialState
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 }, { label: "B", score: 3.0 },
      ] }),
    );
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();

    const judgeCall = chatCompletionMock.mock.calls[0][0];
    const judgeText = JSON.stringify(judgeCall.messages);
    // The instruction suffix marker must NOT appear when the instruction is empty.
    expect(judgeText).not.toContain("ADDITIONAL JUDGE INSTRUCTION");
  });
});

// ---------------------------------------------------------------------------
// Partial-failure fusion — one failed candidate must not poison the run.
// Eligibility depends on how many successful candidates remain.
// ---------------------------------------------------------------------------

describe("run-controller — partial candidate failures", () => {
  it("fuses the 2 successes when 3 configured and 1 failed (3→2 partial fusion)", async () => {
    const state = stateWithSlots(THREE_SLOTS, "fuse");
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => { throw new Error("provider B exploded"); })
      .mockImplementationOnce(() => streamOf("answer C"));
    chatCompletionMock
      .mockResolvedValueOnce(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 }, { label: "C", score: 3.5 },
      ] }))
      .mockResolvedValueOnce("fused A+C");
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    // One candidate failed but the run continued past it.
    expect(types).toContain("CANDIDATE_FAILED");
    // The run did NOT stop with INSUFFICIENT_CANDIDATES — 2 succeeded.
    expect(types).not.toContain("INSUFFICIENT_CANDIDATES");
    // Judge ran on the 2 usable candidates, then fusion ran.
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("FUSION_START");
    expect(types).toContain("FUSION_RESULT");
    // The fusion prompt must NOT include the failed candidate's text.
    const fusionCall = chatCompletionMock.mock.calls[1][0];
    const fusionText = JSON.stringify(fusionCall.messages);
    expect(fusionText).not.toContain("provider B exploded");
    // The fusion prompt must include the two successful candidates' text.
    expect(fusionText).toContain("answer A");
    expect(fusionText).toContain("answer C");
    // The run terminated cleanly (not stuck running).
    expect(deps.stateRef.current.running).toBe(false);
  });

  it("does NOT fuse when 2 configured and 1 failed (2→1 insufficient) and explains why", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => { throw new Error("provider B exploded"); });
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("CANDIDATE_FAILED");
    expect(types).toContain("INSUFFICIENT_CANDIDATES");
    expect(types).not.toContain("JUDGE_START");
    expect(types).not.toContain("FUSION_START");
    // The failed candidate is still visibly reported (not silently dropped).
    expect(deps.stateRef.current.running).toBe(false);
    const insufficient = deps.stateRef.current.insufficient;
    expect(insufficient).toEqual({ done: 1, failed: 1 });
  });

  it("does NOT fuse when all candidates failed (all-fail) and terminates deterministically", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => { throw new Error("all providers down"); });
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("CANDIDATE_FAILED");
    expect(types).toContain("INSUFFICIENT_CANDIDATES");
    expect(types).not.toContain("JUDGE_START");
    expect(types).not.toContain("FUSION_START");
    expect(deps.stateRef.current.running).toBe(false);
    expect(deps.stateRef.current.insufficient).toEqual({ done: 0, failed: 2 });
  });

  it("rank mode degrades gracefully with a single valid candidate (no stuck running)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => { throw new Error("provider B exploded"); });
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("INSUFFICIENT_CANDIDATES");
    expect(types).not.toContain("JUDGE_START");
    expect(deps.stateRef.current.running).toBe(false);
  });

  it("does not include empty-content done candidates in judge/fusion input", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    // One candidate returns empty string (truncated/aborted), the other real content.
    // With only 1 usable candidate, the run must stop with INSUFFICIENT_CANDIDATES.
    chatStreamMock
      .mockImplementationOnce(() => streamOf(""))
      .mockImplementationOnce(() => streamOf("answer B"));
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("INSUFFICIENT_CANDIDATES");
    expect(types).not.toContain("JUDGE_START");
    expect(types).not.toContain("FUSION_START");
    expect(deps.stateRef.current.running).toBe(false);
  });

  it("judge failure in fuse mode does not proceed to fusion and terminates cleanly", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockRejectedValueOnce(new Error("judge unavailable"));
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("FUSION_START");
    expect(deps.stateRef.current.running).toBe(false);
    expect(deps.stateRef.current.judgeStatus).toBe("error");
  });

  it("triggerFusion shows actionable feedback (INSUFFICIENT_CANDIDATES) instead of silent no-op when <2 usable", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    state.running = false;
    state.candidates = [
      {
        id: "cand-s1", model: "A", provider: "OpenRouter", providerId: "openrouter", slug: "model-a",
        accent: "indigo", strategy: "Parallel model", summary: "good", scores: {}, weightedScore: 0,
        segments: [{ id: "a", text: "real answer" }], status: "done",
      },
      {
        id: "cand-s2", model: "B", provider: "Umans", providerId: "umans", slug: "model-b",
        accent: "emerald", strategy: "Parallel model", summary: "", scores: {}, weightedScore: 0,
        segments: [], status: "error", errorMessage: "failed",
      },
    ];
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    controller.triggerFusion(true);

    // Give async dispatch a chance to flush.
    await new Promise((r) => setTimeout(r, 10));

    const types = dispatched.map((a) => a.type);
    // The guard must dispatch INSUFFICIENT_CANDIDATES so the user sees why
    // fusion did not happen — NOT a silent no-op.
    expect(types).toContain("INSUFFICIENT_CANDIDATES");
    expect(types).not.toContain("FUSION_START");
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("triggerFusion fuses when ≥2 usable candidates exist (successful partial fusion via button)", async () => {
    const state = stateWithSlots(THREE_SLOTS, "fuse");
    state.running = false;
    state.candidates = [
      {
        id: "cand-s1", model: "A", provider: "OpenRouter", providerId: "openrouter", slug: "model-a",
        accent: "indigo", strategy: "Parallel model", summary: "good", scores: {}, weightedScore: 0,
        segments: [{ id: "a", text: "answer A" }], status: "done",
      },
      {
        id: "cand-s2", model: "B", provider: "Umans", providerId: "umans", slug: "model-b",
        accent: "emerald", strategy: "Parallel model", summary: "ok", scores: {}, weightedScore: 0,
        segments: [{ id: "b", text: "answer B" }], status: "done",
      },
      {
        id: "cand-s3", model: "C", provider: "Gemini", providerId: "gemini", slug: "model-c",
        accent: "violet", strategy: "Parallel model", summary: "", scores: {}, weightedScore: 0,
        segments: [], status: "error", errorMessage: "gemini provider crashed",
      },
    ];
    chatCompletionMock.mockResolvedValueOnce("fused A+B");
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    controller.triggerFusion(true);

    await new Promise((r) => setTimeout(r, 10));

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("FUSION_START");
    expect(types).toContain("FUSION_RESULT");
    expect(types).not.toContain("INSUFFICIENT_CANDIDATES");
    // The fusion prompt must exclude the failed candidate.
    const fusionCall = chatCompletionMock.mock.calls[0][0];
    const fusionText = JSON.stringify(fusionCall.messages);
    expect(fusionText).not.toContain("gemini provider crashed");
    expect(fusionText).toContain("answer A");
    expect(fusionText).toContain("answer B");
  });

  it("triggerFusion is a no-op while a run is in progress (no provider call, no dispatch)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    state.running = true;
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    controller.triggerFusion(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(chatCompletionMock).not.toHaveBeenCalled();
    // No fusion-related dispatches while running.
    const fusionDispatches = dispatched.filter(
      (a) => a.type === "FUSION_START" || a.type === "INSUFFICIENT_CANDIDATES" || a.type === "FUSION_RESULT",
    );
    expect(fusionDispatches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Judge JSON contract — malformed/partial/duplicate judge output must route
// through the visible JUDGE_FAILED path, never silently produce zero scores.
// ---------------------------------------------------------------------------

describe("run-controller — judge contract failures", () => {
  it("dispatches JUDGE_FAILED in rank mode when judge returns empty scores array", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [] }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(stateRef.current.running).toBe(false);
    expect(stateRef.current.judgeStatus).toBe("error");
  });

  it("dispatches JUDGE_FAILED in rank mode when judge returns scores with missing candidates", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 },
      ] }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(stateRef.current.judgeStatus).toBe("error");
  });

  it("dispatches JUDGE_FAILED and does NOT proceed to fusion when judge returns duplicate scores (fuse mode)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 },
        { label: "A", score: 2.0 },
        { label: "B", score: 3.0 },
      ] }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    // Fusion must NOT proceed when the judge output is contract-invalid.
    expect(types).not.toContain("FUSION_START");
    expect(types).not.toContain("FUSION_RESULT");
    expect(stateRef.current.running).toBe(false);
    expect(stateRef.current.judgeStatus).toBe("error");
    expect(stateRef.current.fusionStatus).not.toBe("done");
  });

  it("dispatches JUDGE_FAILED when judge returns non-array scores", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: { A: 4.0, B: 3.0 } }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("FUSION_START");
    expect(stateRef.current.judgeStatus).toBe("error");
  });

  // Strict-contract regressions: an extra/unmatched score label is a contract
  // violation. It must route through JUDGE_FAILED and must never start Fusion.
  it("dispatches JUDGE_FAILED in rank mode when judge returns an unmatched/extra score label", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 },
        { label: "B", score: 3.0 },
        { label: "Z", score: 2.0 },
      ] }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(stateRef.current.judgeStatus).toBe("error");
  });

  it("dispatches JUDGE_FAILED and does NOT proceed to fusion when judge returns an unmatched/extra score label (fuse mode)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 },
        { label: "B", score: 3.0 },
        { label: "Z", score: 2.0 },
      ] }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(types).not.toContain("FUSION_START");
    expect(types).not.toContain("FUSION_RESULT");
    expect(stateRef.current.running).toBe(false);
    expect(stateRef.current.judgeStatus).toBe("error");
    expect(stateRef.current.fusionStatus).not.toBe("done");
  });

  it("dispatches JUDGE_FAILED when a judge score is outside the documented 1.0–5.0 range (no clamping)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 10 },
        { label: "B", score: 3.0 },
      ] }),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(types).not.toContain("FUSION_START");
    expect(stateRef.current.judgeStatus).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Partial-failure visibility integration — proves the UI surfaces have the
// data they need to show failed model identity/error (2→1) and that empty
// done candidates are visibly unusable (not silently successful).
// ---------------------------------------------------------------------------

describe("run-controller — partial-failure UI visibility", () => {
  it("2→1 insufficient: failed candidate's model and error are available in state for the UI", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => { throw new Error("rate limit exceeded"); });
    const { deps, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    // The pipeline must stop with INSUFFICIENT_CANDIDATES, and the candidate
    // state must retain the failed model's identity and error message so
    // InsufficientState can render them.
    expect(stateRef.current.insufficient).toEqual({ done: 1, failed: 1 });
    const failed = stateRef.current.candidates.find((c) => c.status === "error");
    expect(failed).toBeDefined();
    expect(failed!.model).toBe("B");
    expect(failed!.errorMessage).toContain("rate limit exceeded");
    // The successful candidate is also retained.
    const done = stateRef.current.candidates.find((c) => c.status === "done");
    expect(done).toBeDefined();
    expect(done!.model).toBe("A");
  });

  it("3→2 partial fusion: failed candidate remains visible in state after fusion succeeds", async () => {
    const state = stateWithSlots(THREE_SLOTS, "fuse");
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => { throw new Error("provider B exploded"); })
      .mockImplementationOnce(() => streamOf("answer C"));
    chatCompletionMock
      .mockResolvedValueOnce(JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], scores: [
        { label: "A", score: 4.0 }, { label: "C", score: 3.5 },
      ] }))
      .mockResolvedValueOnce("fused A+C");
    const { deps, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    // Fusion succeeded — the fused text is present.
    expect(stateRef.current.fusedText).toBe("fused A+C");
    expect(stateRef.current.fusionStatus).toBe("done");
    // The failed candidate is still in state (not silently dropped) so the
    // UI's FailedCandidates component can show it.
    const failed = stateRef.current.candidates.find((c) => c.status === "error");
    expect(failed).toBeDefined();
    expect(failed!.model).toBe("B");
    expect(failed!.errorMessage).toContain("provider B exploded");
  });

  it("empty-content done candidate is counted as failed, not done, in INSUFFICIENT_CANDIDATES", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    // One candidate returns empty string (truncated/aborted), the other real content.
    chatStreamMock
      .mockImplementationOnce(() => streamOf(""))
      .mockImplementationOnce(() => streamOf("answer B"));
    const { deps, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    // The empty candidate must be counted as failed (not done) so the UI
    // shows it as unusable, not as a silent success.
    expect(stateRef.current.insufficient).toEqual({ done: 1, failed: 1 });
    // The empty candidate is still in state with status "done" but empty content.
    const empty = stateRef.current.candidates.find(
      (c) => c.status === "done" && c.segments.map((s) => s.text).join("").trim().length === 0,
    );
    expect(empty).toBeDefined();
    expect(empty!.model).toBe("A");
  });
});
