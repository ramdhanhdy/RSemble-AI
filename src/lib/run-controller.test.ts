import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type React from "react";
import { createRunController, type RunControllerDeps } from "./run-controller";
import { initialState, type Action, type StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import type { StreamDeltaBuffer } from "./stream-buffer";
import { ProviderError, type ProviderId } from "./providers/types";
import type { EvaluationProfileSnapshot } from "./evaluations/evaluation-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const chatStreamMock = vi.fn();
const chatCompletionMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("./providers/registry", () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
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

function makeDeps(state: StudioState, now: () => number = () => Date.now()) {
  const dispatched: Action[] = [];
  const stateRef = { current: state } as React.MutableRefObject<StudioState>;
  const runEpochRef = { current: 0 } as React.MutableRefObject<number>;
  const abortControllersRef = { current: new Set<AbortController>() } as React.MutableRefObject<
    Set<AbortController>
  >;
  const dispatch: React.Dispatch<Action> = (a) => {
    dispatched.push(a);
    // Minimal reducer emulation for the flags the controller checks.
    if (a.type === "FANOUT_START") stateRef.current = { ...stateRef.current, running: true, candidates: a.candidates, runContext: a.context };
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
    // Mirrors the real reducer's standalone active-stage transition (spec §5.4):
    // running + cleared stale terminal artifacts, runContext retained.
    if (a.type === "JUDGE_START") stateRef.current = { ...stateRef.current, running: true, judgeStatus: "running", judgeError: null, judgeReport: null, consensus: null, insufficient: null, fusionStatus: "idle", fusionError: null, fusedText: null };
    if (a.type === "JUDGE_RESULT") stateRef.current = { ...stateRef.current, running: a.mode === "fuse" ? stateRef.current.running : false, judgeStatus: "done", judgeReport: a.report };
    if (a.type === "JUDGE_FAILED") stateRef.current = { ...stateRef.current, running: false, judgeStatus: "error" };
    if (a.type === "FUSION_START") stateRef.current = { ...stateRef.current, running: true, fusionStatus: "running" };
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
    // Deterministic blind shuffle: identity permutation (A → first usable
    // candidate, B → second, …) so tests know which model wears which label.
    random: () => 0.999,
    now,
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

/** A valid judge payload under the blind evaluation contract. */
function judgeResponse(
  scores: Array<readonly [string, number]>,
  overrides: Record<string, unknown> = {},
): string {
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
    ...overrides,
  });
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

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Guarded run paths
// ---------------------------------------------------------------------------

describe("run-controller — guarded paths", () => {
  it("runFanout with no enabled slots is blocked before any provider call", async () => {
    const state = stateWithSlots([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "a", enabled: false },
    ]);
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();
    expect(dispatched).toContainEqual({ type: "FANOUT_BLOCKED", reason: "Enable at least two candidate models." });
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("runFanout with exactly one enabled slot is blocked before any provider call", async () => {
    const state = stateWithSlots([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "a", enabled: true },
      { id: "s2", providerId: "openrouter", provider: "OpenRouter", model: "B", slug: "b", enabled: false },
    ]);
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();
    expect(dispatched).toContainEqual({ type: "FANOUT_BLOCKED", reason: "Add or enable one more candidate to compare." });
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

  it("retryCandidate resolves its slot by candidate→slot id and uses the slot's CURRENT model after a switch", async () => {
    // The slot s2 was switched to a different model (and provider) after the
    // failed candidate was produced. The candidate snapshot still carries the
    // OLD slug/providerId. Retry must resolve the slot by identity (cand-s2 →
    // s2) and stream the slot's current slug — not the candidate's stale slug.
    const state = stateWithSlots([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
      // switched: was model-b/umans, now model-b2/gemini
      { id: "s2", providerId: "gemini", provider: "Gemini", model: "B2", slug: "model-b2", enabled: true },
    ], "rank");
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
    chatStreamMock.mockImplementation(() => streamOf("switched-model answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.retryCandidate(state.candidates[1]);

    // It streamed the slot's CURRENT slug, not the stale candidate slug.
    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(chatStreamMock.mock.calls[0][0].model).toBe("model-b2");
    // The retried candidate now reflects the switched model in state.
    const retryResult = dispatched.find((a) => a.type === "RETRY_CANDIDATE_RESULT");
    expect(retryResult).toBeDefined();
    // And the judge still ran against the recovered pair.
    expect(dispatched.map((a) => a.type)).toContain("JUDGE_START");
  });

  it("retryCandidate is a no-op when its slot no longer exists", async () => {
    const state = stateWithSlots([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
      // s2 was removed after the run.
    ], "rank");
    state.candidates = [
      {
        id: "cand-s2", model: "B", provider: "Umans", providerId: "umans", slug: "model-b",
        accent: "emerald", strategy: "Parallel model", summary: "", scores: {}, weightedScore: 0,
        segments: [], status: "error", errorMessage: "failed",
      },
    ];
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.retryCandidate(state.candidates[0]);
    expect(chatStreamMock).not.toHaveBeenCalled();
    expect(dispatched.map((a) => a.type)).not.toContain("RETRY_CANDIDATE_START");
  });

  it("happy path: fanout → judge → (rank) terminal JUDGE_RESULT with provider-scoped history keys", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));
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
    expect(addRunMock).not.toHaveBeenCalled();
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
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));
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
    let nowCallCount = 0;
    const now = () => {
      nowCallCount++;
      // Calls: 1=runId, 2=placeholder startedAt, 3=cand1 startedAt, 4=cand2 startedAt,
      // 5=cand1 finishedAt, 6=cand2 finishedAt
      if (nowCallCount <= 4) return 1000;
      if (nowCallCount === 5) return 1250;
      return 1500;
    };
    const { deps, dispatched } = makeDeps(state, now);

    await createRunController(deps).runFanout();

    const { addRun } = await import("./run-history");
    expect((addRun as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
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
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));

    await createRunController(deps).runFanout();

    const { addRun } = await import("./run-history");
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(addRun).not.toHaveBeenCalled();
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
  });
});

describe("run-controller — judge instruction threading", () => {
  it("passes state.judgeInstruction into the judge prompt (rank path)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    state.judgeInstruction = "Penalize any answer that hedges.";
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([]),
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
        judgeResponse([["A", 4.0], ["B", 3.0]]),
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
      judgeResponse([["A", 4.0], ["B", 3.0]]),
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
    // Two usable candidates → blind labels A and B (identity permutation).
    chatCompletionMock
      .mockResolvedValueOnce(judgeResponse([["A", 4.0], ["B", 3.5]]))
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
    state.judgeStatus = "done";
    state.judgeReport = { labelMap: [], evaluationsById: {}, comparisons: [] };
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

  it("triggerFusion refuses to bypass a failed Judge even when candidates are usable", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    state.running = false;
    state.judgeStatus = "error";
    state.judgeError = "judge unavailable";
    state.judgeReport = null;
    state.candidates = [
      doneCandidate("cand-s1", "openrouter", "model-a", "answer A"),
      doneCandidate("cand-s2", "umans", "model-b", "answer B"),
    ];
    chatCompletionMock.mockResolvedValueOnce("must not run");
    const { deps, dispatched } = makeDeps(state);

    createRunController(deps).triggerFusion(true);
    await new Promise((r) => setTimeout(r, 10));

    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
    const { addRun } = await import("./run-history");
    expect(addRun).not.toHaveBeenCalled();
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
  it("dispatches JUDGE_FAILED in rank mode when judge returns an empty evaluations array", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([]),
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

  it("dispatches JUDGE_FAILED in rank mode when judge returns evaluations with missing candidates", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([["A", 4.0]]),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(stateRef.current.judgeStatus).toBe("error");
  });

  it("dispatches JUDGE_FAILED and does NOT proceed to fusion when judge returns duplicate evaluations (fuse mode)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([["A", 4.0], ["A", 2.0], ["B", 3.0]]),
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

  it("dispatches JUDGE_FAILED when judge returns non-array evaluations", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      JSON.stringify({ consensus: [], contradictions: [], uniqueInsights: [], evaluations: { A: 4.0, B: 3.0 }, comparisons: [] }),
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
  it("dispatches JUDGE_FAILED in rank mode when judge returns an unmatched/extra evaluation label", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([["A", 4.0], ["B", 3.0], ["Z", 2.0]]),
    );
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_FAILED");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(stateRef.current.judgeStatus).toBe("error");
  });

  it("dispatches JUDGE_FAILED and does NOT proceed to fusion when judge returns an unmatched/extra evaluation label (fuse mode)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([["A", 4.0], ["B", 3.0], ["Z", 2.0]]),
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
      judgeResponse([["A", 10], ["B", 3.0]]),
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
    // Two usable candidates → blind labels A and B (identity permutation).
    chatCompletionMock
      .mockResolvedValueOnce(judgeResponse([["A", 4.0], ["B", 3.5]]))
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

// ---------------------------------------------------------------------------
// 9Router integration — mixed-provider fanout, 503 failure, critic
// ---------------------------------------------------------------------------

describe("run-controller — 9Router integration", () => {
  const MIXED_SLOTS: StudioState["slots"] = [
    { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
    { id: "s2", providerId: "9router", provider: "9Router", model: "B", slug: "ag/gemini-3.1-pro-low", enabled: true },
  ];

  it("completes a mixed openrouter + 9router fanout", async () => {
    chatStreamMock.mockImplementation(() => streamOf("good answer"));
    const state = stateWithSlots(MIXED_SLOTS);
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const results = dispatched.filter((a) => a.type === "CANDIDATE_RESULT");
    expect(results).toHaveLength(2);
  });

  it("a 9router 503 fails only that candidate while the other succeeds", async () => {
    async function* failingStream(): AsyncGenerator<string, void, unknown> {
      throw new ProviderError("all routes unavailable", "9router", 503);
    }
    chatStreamMock.mockImplementation((opts: { model: string }) => {
      if (opts.model === "ag/gemini-3.1-pro-low") return failingStream();
      return streamOf("good answer");
    });
    const state = stateWithSlots(MIXED_SLOTS);
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const failed = dispatched.filter((a) => a.type === "CANDIDATE_FAILED");
    const results = dispatched.filter((a) => a.type === "CANDIDATE_RESULT");
    expect(failed).toHaveLength(1);
    expect(results).toHaveLength(1);
  });

  it("9router can be the critic in Rank mode", async () => {
    chatStreamMock.mockImplementation(() => streamOf("candidate answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));
    const state = stateWithSlots(MIXED_SLOTS, "rank");
    state.critic = { providerId: "9router", model: "ag/gemini-3.1-pro-low" };
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const judgeResult = dispatched.find((a) => a.type === "JUDGE_RESULT");
    expect(judgeResult).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Judge report threading — the resolved report reaches state keyed by
// candidate IDs, the weighted leaderboard score equals the judge overall,
// abort/stale epochs never publish a report, and run history is unchanged.
// ---------------------------------------------------------------------------

describe("run-controller — judge report threading", () => {
  it("dispatches JUDGE_RESULT carrying a report whose evaluations are keyed by candidate IDs", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).runFanout();

    const result = dispatched.find(
      (a): a is Extract<Action, { type: "JUDGE_RESULT" }> => a.type === "JUDGE_RESULT",
    );
    expect(result).toBeDefined();
    // Report present, evaluations keyed by candidate id, not blind label.
    expect(result!.report).toBeDefined();
    const ids = Object.keys(result!.report.evaluationsById).sort();
    expect(ids).toEqual(["cand-s1", "cand-s2"]);
    // The weightedScore stored on each candidate equals the judge overall.
    const ev = result!.report.evaluationsById["cand-s1"];
    expect(ev.overallScore).toBe(4.0);
  });

  it("does not dispatch a report after abort (epoch bumped)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    const { deps, dispatched } = makeDeps(state);

    let resolveStream: (() => void) | undefined;
    chatStreamMock.mockImplementation(
      (opts: { signal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) => {
            resolveStream = resolve;
            opts.signal?.addEventListener("abort", () => resolve());
          });
          if (opts.signal?.aborted) {
            throw new DOMException("aborted", "AbortError");
          }
          yield "late answer";
        })(),
    );
    const controller = createRunController(deps);
    const runPromise = controller.runFanout();
    await new Promise((r) => setTimeout(r, 10));
    controller.abortRun();
    resolveStream?.();
    await runPromise;

    expect(dispatched.some((a) => a.type === "JUDGE_RESULT")).toBe(false);
    expect(dispatched.some((a) => a.type === "JUDGE_FAILED")).toBe(false);
  });

  it("keeps run-history score and winner recording unchanged (provider-scoped keys)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();

    const { addRun } = await import("./run-history");
    const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;
    expect(addRunMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// retryJudge — Judge-only recovery over retained candidates (run-recovery spec §5)
// ---------------------------------------------------------------------------

function doneCandidate(id: string, providerId: ProviderId, slug: string, text: string): Candidate {
  return {
    id,
    model: slug,
    provider: providerId,
    providerId,
    slug,
    accent: "A",
    strategy: "Parallel model",
    summary: `summary of ${slug}`,
    scores: {},
    weightedScore: 0,
    segments: [{ id: `${id}-seg-1`, text }],
    status: "done",
    startedAt: 1_000,
    finishedAt: 2_000,
    tokensIn: 11,
    tokensOut: 22,
  };
}
/** Post-failure state: Judge errored after two candidates completed. The command
 *  pane has since been EDITED (prompt/evaluation) and the Judge model swapped, so
 *  tests can prove the retry uses the frozen context + current critic. */
function editedProfile(): EvaluationProfileSnapshot {
  return {
    id: "edited", version: 1, name: "Edited", description: "edited",
    judgeInstruction: "",
    criteria: [
      { id: "rx", name: "EDITED_RUBRIC_MARKER", description: "edited", weight: 0.9, anchors: { one: "Poor", three: "OK", five: "Great" } },
    ],
    createdAt: 1000, updatedAt: 1000,
  };
}
function retainedProfile(): EvaluationProfileSnapshot {
  return {
    id: "retained", version: 1, name: "Retained", description: "retained",
    judgeInstruction: "",
    criteria: [
      { id: "r1", name: "RETAINED_RUBRIC_MARKER", description: "retained", weight: 0.5, anchors: { one: "Poor", three: "OK", five: "Great" } },
    ],
    createdAt: 1000, updatedAt: 1000,
  };
}
function judgeRetryState(mode: "rank" | "fuse" = "rank"): StudioState {
  return {
    ...initialState,
    mode,
    running: false,
    judgeStatus: "error",
    judgeError: "judge exploded",
    prompt: "EDITED_TASK_MARKER",
    evaluation: { kind: "custom", profile: editedProfile() },
    critic: { providerId: "gemini", model: "gemini-3.1-pro-preview" },
    judgeInstruction: "CURRENT_INSTRUCTION_MARKER",
    runContext: {
      prompt: "ORIGINAL_TASK_MARKER",
      evaluation: { kind: "custom", profile: retainedProfile() },
      attachments: [],
      attachmentsToJudge: true,
    },
    candidates: [
      doneCandidate("cand-1", "openrouter", "model-a", "answer from model A"),
      doneCandidate("cand-2", "umans", "model-b", "answer from model B"),
    ],
  };
}

/** Valid judge payload for retry tests — per-evaluation criterionScores must
 *  exact-match the retained profile's criteria (r1), or the strict
 *  parser rejects the response. */
function retryJudgeResponse(scores: Array<readonly [string, number]>): string {
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
      criterionScores: [{ criterionId: "r1", score, rationale: `Rubric evidence ${label}` }],
    })),
    comparisons: [],
  });
}

describe("run-controller — retryJudge (Judge-only recovery)", () => {
  it("makes exactly one Judge completion call and zero candidate stream calls", async () => {
    const state = judgeRetryState();
    chatCompletionMock.mockResolvedValue(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("judges against the retained run context and current instruction, not edited command values", async () => {
    const state = judgeRetryState();
    chatCompletionMock.mockResolvedValue(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).retryJudge();

    const judgeText = JSON.stringify(chatCompletionMock.mock.calls[0][0].messages);
    expect(judgeText).toContain("ORIGINAL_TASK_MARKER");
    expect(judgeText).toContain("RETAINED_RUBRIC_MARKER");
    expect(judgeText).toContain("CURRENT_INSTRUCTION_MARKER");
    expect(judgeText).not.toContain("EDITED_TASK_MARKER");
    expect(judgeText).not.toContain("EDITED_RUBRIC_MARKER");
  });

  it("uses the current critic provider/model for the new Judge attempt", async () => {
    const state = judgeRetryState();
    chatCompletionMock.mockResolvedValue(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(getProviderMock).toHaveBeenCalledWith("gemini");
    expect(chatCompletionMock.mock.calls[0][0].model).toBe("gemini-3.1-pro-preview");
  });

  it("leaves candidate text and metadata byte-for-byte unchanged", async () => {
    const state = judgeRetryState();
    const before = structuredClone(state.candidates);
    chatCompletionMock.mockResolvedValue(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps, dispatched, stateRef } = makeDeps(state);
    await createRunController(deps).retryJudge();

    const mutatingTypes = new Set([
      "FANOUT_START", "CANDIDATE_RESULT", "CANDIDATE_FAILED", "CANDIDATE_DELTA",
      "RETRY_CANDIDATE_START", "RETRY_CANDIDATE_RESULT", "RETRY_CANDIDATE_FAILED", "RETRY_CANDIDATE_DELTA",
    ]);
    expect(dispatched.some((a) => mutatingTypes.has(a.type))).toBe(false);
    expect(stateRef.current.candidates).toEqual(before);
  });

  it("dispatches JUDGE_START then JUDGE_RESULT on a valid Rank retry", async () => {
    const state = judgeRetryState("rank");
    chatCompletionMock.mockResolvedValue(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(dispatched.map((a) => a.type)).toEqual(["JUDGE_START", "JUDGE_RESULT"]);
  });

  it("writes exactly one run-history entry on success — not zero, not two", async () => {
    const state = judgeRetryState("rank");
    chatCompletionMock.mockResolvedValue(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).retryJudge();

    const { addRun } = await import("./run-history");
    expect(addRun).not.toHaveBeenCalled();
  });

  it("on invalid Judge output: JUDGE_FAILED, candidates preserved, retry stays available", async () => {
    const state = judgeRetryState();
    const before = structuredClone(state.candidates);
    chatCompletionMock.mockResolvedValueOnce("not valid judge output");
    const { deps, dispatched, stateRef } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.retryJudge();

    expect(dispatched.map((a) => a.type)).toEqual(["JUDGE_START", "JUDGE_FAILED"]);
    expect(stateRef.current.candidates).toEqual(before);

    // A second attempt with a valid response succeeds against the same candidates.
    chatCompletionMock.mockResolvedValueOnce(retryJudgeResponse([["A", 4.0], ["B", 3.0]]));
    await controller.retryJudge();
    expect(dispatched.map((a) => a.type)).toEqual(["JUDGE_START", "JUDGE_FAILED", "JUDGE_START", "JUDGE_RESULT"]);
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(stateRef.current.candidates).toEqual(before);
  });

  it("fuse mode continues to Fusion with the new scores after a valid retry", async () => {
    const state = judgeRetryState("fuse");
    chatCompletionMock
      .mockResolvedValueOnce(retryJudgeResponse([["A", 4.5], ["B", 3.0]]))
      .mockResolvedValueOnce("fused answer");
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(dispatched.map((a) => a.type)).toEqual(["JUDGE_START", "JUDGE_RESULT", "FUSION_START", "FUSION_RESULT"]);
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    const fusionText = JSON.stringify(chatCompletionMock.mock.calls[1][0].messages);
    expect(fusionText).toContain("answer from model A");
    expect(fusionText).toContain("answer from model B");
    expect(fusionText).toContain("CURRENT_INSTRUCTION_MARKER");

    // The single history entry (written after fusion) carries the new judge scores.
    const { addRun } = await import("./run-history");
    const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;
    expect(addRunMock).not.toHaveBeenCalled();
  });

  it("dispatches INSUFFICIENT_CANDIDATES and makes no Judge call with fewer than two usable candidates", async () => {
    const state = judgeRetryState();
    state.candidates = [
      doneCandidate("cand-1", "openrouter", "model-a", "answer from model A"),
      { ...doneCandidate("cand-2", "umans", "model-b", ""), status: "error", errorMessage: "boom", segments: [] },
    ];
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(dispatched.map((a) => a.type)).toEqual(["INSUFFICIENT_CANDIDATES"]);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("missing run context makes no Judge call and fails truthfully (full rerun required)", async () => {
    const state = judgeRetryState();
    state.runContext = null;
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(chatCompletionMock).not.toHaveBeenCalled();
    const failure = dispatched.find((a) => a.type === "JUDGE_FAILED");
    expect(failure).toBeDefined();
    if (failure?.type === "JUDGE_FAILED") {
      expect(failure.error).toMatch(/run context|re-run/i);
    }
  });

  it("abort during Judge retry prevents late JUDGE_RESULT and FUSION_START", async () => {
    const state = judgeRetryState("fuse");
    chatCompletionMock.mockImplementation(
      (opts: { signal?: AbortSignal }) =>
        new Promise<string>((_, reject) => {
          opts.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    const retryPromise = controller.retryJudge();
    await new Promise((r) => setTimeout(r, 10));
    controller.abortRun();
    await retryPromise;

    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("ABORT_RUN");
    expect(types).not.toContain("JUDGE_RESULT");
    expect(types).not.toContain("FUSION_START");
  });

  it("is a no-op while another stage is running", async () => {
    const state = judgeRetryState();
    state.running = true;
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(dispatched).toHaveLength(0);
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the run was explicitly aborted", async () => {
    const state = judgeRetryState();
    state.aborted = true;
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(dispatched).toHaveLength(0);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the Judge has not failed", async () => {
    const state = judgeRetryState();
    state.judgeStatus = "done";
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).retryJudge();

    expect(dispatched).toHaveLength(0);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Characterization tests (Task 2.1) — protect existing invariants before
// extracting a shared executor and replacing addRun with lifecycle records.
// These tests pin the CURRENT behavior so extraction doesn't drift.
// ---------------------------------------------------------------------------

describe("run-controller — characterization (pre-extraction invariants)", () => {
  it("Rank success writes exactly one addRun call", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();
    const { addRun } = await import("./run-history");
    const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;
    expect(addRunMock).not.toHaveBeenCalled();
  });

  it("Fuse success writes exactly one addRun call", async () => {
    const state = stateWithSlots(TWO_SLOTS, "fuse");
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([["A", 4], ["B", 3]]),
    ).mockResolvedValueOnce("fused answer");
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();
    const { addRun } = await import("./run-history");
    const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;
    expect(addRunMock).not.toHaveBeenCalled();
  });

  it("Rank→Fuse uses one stable run ID — no duplicate history entry", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock
      .mockResolvedValueOnce(judgeResponse([["A", 4], ["B", 3]]))
      .mockResolvedValueOnce("fused answer");
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();
    // Switch to fuse mode and trigger fusion
    const s = deps.stateRef.current;
    s.mode = "fuse";
    s.fusionStatus = "idle";
    controller.triggerFusion(true);
    // Wait for fusion to complete
    await new Promise((r) => setTimeout(r, 50));
    const { addRun } = await import("./run-history");
    const addRunMock = addRun as unknown as ReturnType<typeof vi.fn>;
    // Phase 2 fix: one stable run ID, no duplicate addRun calls.
    // addRun is removed entirely — persistence goes through RunRecorder.
    expect(addRunMock).not.toHaveBeenCalled();
    // Verify JUDGE_RESULT and FUSION_RESULT were both dispatched
    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_RESULT");
    expect(types).toContain("FUSION_RESULT");
  });

  it("Judge retry makes zero candidate stream calls", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock
      .mockResolvedValueOnce("malformed judge output")
      .mockResolvedValueOnce(judgeResponse([["A", 4], ["B", 3]]));
    const { deps } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();
    chatStreamMock.mockClear();
    await controller.retryJudge();
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("abort suppresses late results (stale epoch check)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    let resolveB: () => void = () => {};
    const deferredB = new Promise<void>((r) => { resolveB = r; });
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(async () => {
        await deferredB;
        return streamOf("answer B");
      });
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);
    const fanoutPromise = controller.runFanout();
    controller.abortRun();
    resolveB();
    await fanoutPromise;
    const types = dispatched.map((a) => a.type);
    expect(types).not.toContain("JUDGE_START");
  });

  it("partial candidate success reaches Judge with at least two usable candidates", async () => {
    const state = stateWithSlots(THREE_SLOTS, "rank");
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => { throw new Error("B failed"); })
      .mockImplementationOnce(() => streamOf("answer C"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).runFanout();
    const types = dispatched.map((a) => a.type);
    expect(types).toContain("JUDGE_START");
    expect(types).toContain("JUDGE_RESULT");
  });

  it("candidate providers execute concurrently (not sequentially)", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    const callOrder: string[] = [];
    chatStreamMock
      .mockImplementationOnce(() => {
        callOrder.push("A-start");
        return streamOf("answer A");
      })
      .mockImplementationOnce(() => {
        callOrder.push("B-start");
        return streamOf("answer B");
      });
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();
    expect(callOrder).toEqual(["A-start", "B-start"]);
  });

  it("event order for Rank: FANOUT_START → CANDIDATE_RESULT × N → FANOUT_END → JUDGE_START → JUDGE_RESULT", async () => {
    const state = stateWithSlots(TWO_SLOTS, "rank");
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const { deps, dispatched } = makeDeps(state);
    await createRunController(deps).runFanout();
    const types = dispatched.map((a) => a.type);
    const startIdx = types.indexOf("FANOUT_START");
    const firstResultIdx = types.indexOf("CANDIDATE_RESULT");
    const fanoutEndIdx = types.indexOf("FANOUT_END");
    const judgeStartIdx = types.indexOf("JUDGE_START");
    const judgeResultIdx = types.indexOf("JUDGE_RESULT");
    expect(startIdx).toBeLessThan(firstResultIdx);
    expect(firstResultIdx).toBeLessThan(fanoutEndIdx);
    expect(fanoutEndIdx).toBeLessThan(judgeStartIdx);
    expect(judgeStartIdx).toBeLessThan(judgeResultIdx);
  });
});

// ---------------------------------------------------------------------------
// Attachment gate + frozen retry inputs — plan 7.6.6
// ---------------------------------------------------------------------------

import { clearModelCapabilities, setModelCapabilities } from "./providers/capabilities";

const IMAGE_ATT = {
  id: "att-1",
  name: "shot.png",
  kind: "image" as const,
  mimeType: "image/png",
  bytes: 10,
  status: "ready" as const,
  data: "iVBORw0KGgo",
};

const TEXT_ATT = {
  id: "att-2",
  name: "notes.md",
  kind: "text" as const,
  mimeType: "text/markdown",
  bytes: 10,
  status: "ready" as const,
  text: "attached notes body",
};

describe("runFanout — attachment eligibility gate (7.6.6)", () => {
  afterEach(() => clearModelCapabilities());

  it("dispatches FANOUT_BLOCKED and never touches a provider when <2 slots can see images", async () => {
    setModelCapabilities("openrouter", "model-a", { image: true, pdf: false });
    const state = { ...stateWithSlots(THREE_SLOTS), attachments: [IMAGE_ATT] };
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.runFanout();

    const blocked = dispatched.find((a) => a.type === "FANOUT_BLOCKED");
    expect(blocked).toBeDefined();
    expect("reason" in blocked! && (blocked as { reason: string }).reason).toContain("only 1 of 3");
    expect(getProviderMock).not.toHaveBeenCalled();
    expect(dispatched.some((a) => a.type === "FANOUT_START")).toBe(false);
  });

  it("auto-disables incapable slots and starts the fanout with only the capable ones", async () => {
    setModelCapabilities("openrouter", "model-a", { image: true, pdf: false });
    setModelCapabilities("umans", "model-b", { image: true, pdf: false });
    chatStreamMock.mockImplementation(async function* () {
      yield "answer";
    });
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const state = { ...stateWithSlots(THREE_SLOTS), attachments: [IMAGE_ATT] };
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.runFanout();

    expect(dispatched.some((a) => a.type === "TOGGLE_SLOT" && a.id === "s3")).toBe(true);
    const start = dispatched.find((a) => a.type === "FANOUT_START") as
      | { candidates: { id: string }[] }
      | undefined;
    expect(start?.candidates.map((c) => c.id)).toEqual(["cand-s1", "cand-s2"]);
    expect(dispatched.some((a) => a.type === "FANOUT_BLOCKED")).toBe(false);
  });

  it("proceeds normally when every enabled slot can see images", async () => {
    setModelCapabilities("openrouter", "model-a", { image: true, pdf: false });
    setModelCapabilities("umans", "model-b", { image: true, pdf: false });
    setModelCapabilities("gemini", "model-c", { image: true, pdf: false });
    chatStreamMock.mockImplementation(async function* () {
      yield "answer";
    });
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const state = { ...stateWithSlots(THREE_SLOTS), attachments: [IMAGE_ATT] };
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.runFanout();

    expect(dispatched.some((a) => a.type === "TOGGLE_SLOT")).toBe(false);
    expect(dispatched.some((a) => a.type === "FANOUT_BLOCKED")).toBe(false);
  });
});

describe("retryCandidate — frozen attachment set from runContext (7.6.6)", () => {
  afterEach(() => clearModelCapabilities());

  it("streams the retry with the ORIGINAL attachments even if the user changed state", async () => {
    chatStreamMock.mockImplementation(async function* () {
      yield "retried answer";
    });
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4], ["B", 3]]));
    const failed = {
      ...doneCandidate("cand-s1", "openrouter", "model-a", "old answer"),
      status: "error" as const,
      errorMessage: "boom",
      segments: [],
    };
    const state: StudioState = {
      ...stateWithSlots(TWO_SLOTS),
      candidates: [
        failed,
        doneCandidate("cand-s2", "umans", "model-b", "answer from model B"),
      ],
      runContext: {
        prompt: "original task",
        evaluation: { kind: "holistic" },
        attachments: [TEXT_ATT],
        attachmentsToJudge: true,
      },
      attachments: [], // user removed the files after the run
    };
    const { deps, dispatched } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.retryCandidate(state.candidates[0]);

    expect(dispatched.some((a) => a.type === "RETRY_CANDIDATE_START")).toBe(true);
    // The retry streamed the FROZEN attachment, not the now-empty live set.
    const messages = (chatStreamMock.mock.calls[0][0] as { messages: { content: string | unknown[] }[] })
      .messages;
    expect(JSON.stringify(messages)).toContain("attached notes body");
  });
});
