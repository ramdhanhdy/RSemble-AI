import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type React from "react";
import { createRunController, type RunControllerDeps } from "./run-controller";
import { initialState, reducer, type Action, type StudioState } from "../studio-engine";
import { buildExportMarkdown } from "./export-markdown";
import type { StreamDeltaBuffer } from "./stream-buffer";

// Integration: the business-direction case from the spec — two candidates reach
// the same conclusion ("choose option X") but with materially different scores,
// and a same-conclusion comparison explains the gap.

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
  return { push: vi.fn(), flush: vi.fn(), cancel: vi.fn() } as unknown as StreamDeltaBuffer;
}

function makeDeps(state: StudioState) {
  const dispatched: Action[] = [];
  const waiters: Array<{ type: Action["type"]; resolve: () => void }> = [];
  const stateRef = { current: state } as React.MutableRefObject<StudioState>;
  const runEpochRef = { current: 0 } as React.MutableRefObject<number>;
  const abortControllersRef = { current: new Set<AbortController>() } as React.MutableRefObject<Set<AbortController>>;
  const dispatch: React.Dispatch<Action> = (a) => {
    dispatched.push(a);
    stateRef.current = reducer(stateRef.current, a);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].type === a.type) {
        waiters[i].resolve();
        waiters.splice(i, 1);
      }
    }
  };
  /** Await the real event: resolves when an action of the given type is dispatched. */
  const waitFor = (type: Action["type"]) =>
    new Promise<void>((resolve) => waiters.push({ type, resolve }));
  const deps: RunControllerDeps = {
    stateRef,
    dispatch,
    runEpochRef,
    abortControllersRef,
    streamBuffer: makeStreamBuffer(),
    random: () => 0.999,
  };
  return { deps, dispatched, stateRef, waitFor };
}

const SLOTS: StudioState["slots"] = [
  { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "Alpha", slug: "vendor/alpha-1", enabled: true },
  { id: "s2", providerId: "umans", provider: "Umans", model: "Beta", slug: "vendor/beta-2", enabled: true },
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

describe("judge explainability — integration", () => {
  it("same-conclusion comparison explains the score gap end-to-end", async () => {
    const state: StudioState = {
      ...initialState,
      mode: "rank",
      prompt: "Should we expand into the EU market?",
      slots: SLOTS,
      critic: { providerId: "openrouter", model: "judge" },
    };
    chatStreamMock
      .mockImplementationOnce(() => streamOf("Expand into the EU — demand is strong."))
      .mockImplementationOnce(() => streamOf("Expand into the EU — regulatory risk is manageable."));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({
        consensus: ["Both recommend expansion"],
        contradictions: [],
        uniqueInsights: [],
        evaluations: [
          {
            label: "A",
            score: 4.8,
            position: "Expand into the EU market",
            rationale: "Quantifies the addressable market and defines clear entry gates.",
            strengths: ["Strong TAM analysis"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [],
          },
          {
            label: "B",
            score: 3.2,
            position: "Expand into the EU market",
            rationale: "Reaches the same conclusion without quantifying the market.",
            strengths: ["Notes regulatory risk"],
            deductions: [{ severity: "major", reason: "No sizing evidence" }],
            missedRequirements: [],
            criterionScores: [],
          },
        ],
        comparisons: [
          {
            labels: ["A", "B"],
            reason: "Both recommend expansion, but A quantifies the downside and defines earlier falsification gates.",
          },
        ],
      }),
    );
    const { deps, stateRef } = makeDeps(state);
    await createRunController(deps).runFanout();

    const report = stateRef.current.judgeReport;
    expect(report).not.toBeNull();
    expect(report!.comparisons).toHaveLength(1);
    expect(report!.comparisons[0].reason).toContain("quantifies the downside");
    // Scores preserved through the report and the weighted candidate score.
    const a = stateRef.current.candidates.find((c) => c.id === "cand-s1")!;
    const b = stateRef.current.candidates.find((c) => c.id === "cand-s2")!;
    expect(a.weightedScore).toBe(4.8);
    expect(b.weightedScore).toBe(3.2);

    // Export carries the audit trail.
    const md = buildExportMarkdown(stateRef.current)!;
    expect(md).toContain("## Blind Evaluation Key");
    expect(md).toContain("## Score Explanations");
    expect(md).toContain("## Same-Conclusion Comparisons");
    expect(md).toContain("Candidate A: Alpha");
    expect(md).toContain("Candidate B: Beta");
    expect(md).toContain("Candidate A (Alpha) vs Candidate B (Beta)");
  });

  it("outgoing judge request contains no model/provider metadata", async () => {
    const state: StudioState = {
      ...initialState,
      mode: "rank",
      prompt: "Compare two candidate answers.",
      slots: SLOTS,
      critic: { providerId: "openrouter", model: "judge" },
    };
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock.mockResolvedValue(
      JSON.stringify({
        consensus: [],
        contradictions: [],
        uniqueInsights: [],
        evaluations: [
          { label: "A", score: 4.0, position: "p", rationale: "r", strengths: ["s"], deductions: [], missedRequirements: [], criterionScores: [] },
          { label: "B", score: 3.0, position: "p", rationale: "r", strengths: ["s"], deductions: [], missedRequirements: [], criterionScores: [] },
        ],
        comparisons: [],
      }),
    );
    const { deps } = makeDeps(state);
    await createRunController(deps).runFanout();

    const judgeCall = chatCompletionMock.mock.calls[0][0];
    const text = JSON.stringify(judgeCall.messages);
    expect(text).not.toContain("Alpha");
    expect(text).not.toContain("Beta");
    expect(text).not.toContain("vendor/alpha-1");
    expect(text).not.toContain("vendor/beta-2");
    expect(text).not.toContain("OpenRouter");
    expect(text).not.toContain("Umans");
  });

  it("Rank → Fuse → Rank toggle preserves the report without another judge call", async () => {
    const state: StudioState = {
      ...initialState,
      mode: "rank",
      prompt: "Rank then fuse then rank.",
      slots: SLOTS,
      critic: { providerId: "openrouter", model: "judge" },
    };
    chatStreamMock.mockImplementation(() => streamOf("some answer"));
    chatCompletionMock
      .mockResolvedValueOnce(
        JSON.stringify({
          consensus: [],
          contradictions: [],
          uniqueInsights: [],
          evaluations: [
            { label: "A", score: 4.0, position: "p", rationale: "r", strengths: ["s"], deductions: [], missedRequirements: [], criterionScores: [] },
            { label: "B", score: 3.0, position: "p", rationale: "r", strengths: ["s"], deductions: [], missedRequirements: [], criterionScores: [] },
          ],
          comparisons: [],
        }),
      )
      .mockResolvedValueOnce("fused");
    const { deps, dispatched, stateRef, waitFor } = makeDeps(state);
    const controller = createRunController(deps);
    await controller.runFanout();

    const reportAfterRank = stateRef.current.judgeReport;
    expect(reportAfterRank).not.toBeNull();

    // Switch to fuse, run fusion — await the real FUSION_RESULT dispatch event.
    stateRef.current = reducer(stateRef.current, { type: "SET_MODE", mode: "fuse" });
    const fused = waitFor("FUSION_RESULT");
    controller.triggerFusion(true);
    await fused;

    // Back to rank — report still intact, no new judge call made.
    stateRef.current = reducer(stateRef.current, { type: "SET_MODE", mode: "rank" });
    expect(stateRef.current.judgeReport).toBe(reportAfterRank);
    // Only two judge-ish completions happened: the judge call and the fusion call.
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    expect(dispatched.filter((a) => a.type === "JUDGE_START")).toHaveLength(1);
  });
});
