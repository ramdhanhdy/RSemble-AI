import { describe, it, expect } from "vitest";
import { reducer, initialState, type StudioState } from "./studio-engine";
import type { Candidate } from "./studio-data";
import type { ProviderId } from "./lib/providers/types";

function makeCandidate(id: string, providerId: ProviderId, slug: string): Candidate {
  return {
    id,
    model: slug,
    provider: providerId,
    providerId,
    slug,
    accent: "A",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments: [],
    status: "pending",
  };
}

function runningStateWithCandidates(candidates: Candidate[], mode: "rank" | "fuse" = "rank"): StudioState {
  return {
    ...initialState,
    mode,
    running: true,
    candidates,
    judgeStatus: "running",
    fusionStatus: mode === "fuse" ? "idle" : "idle",
  };
}

describe("reducer — JUDGE_FAILED terminates run in all modes", () => {
  it("clears running and sets judgeStatus to error in RANK mode", () => {
    const state = runningStateWithCandidates([
      makeCandidate("c1", "openrouter", "model-a"),
      makeCandidate("c2", "umans", "model-b"),
    ], "rank");
    const next = reducer(state, { type: "JUDGE_FAILED", error: "judge exploded" });
    expect(next.running).toBe(false);
    expect(next.judgeStatus).toBe("error");
    expect(next.judgeError).toBe("judge exploded");
  });

  it("clears running and sets judgeStatus to error in FUSE mode (does not proceed to fusion)", () => {
    const state = runningStateWithCandidates([
      makeCandidate("c1", "openrouter", "model-a"),
      makeCandidate("c2", "umans", "model-b"),
    ], "fuse");
    const next = reducer(state, { type: "JUDGE_FAILED", error: "judge exploded" });
    expect(next.running).toBe(false);
    expect(next.judgeStatus).toBe("error");
    expect(next.judgeError).toBe("judge exploded");
    // Fusion must not have been started
    expect(next.fusionStatus).toBe("idle");
  });
});

describe("reducer — FUSION_FAILED terminates run", () => {
  it("clears running and sets fusionStatus to error", () => {
    const state: StudioState = {
      ...initialState,
      mode: "fuse",
      running: true,
      candidates: [makeCandidate("c1", "openrouter", "model-a")],
      fusionStatus: "running",
      judgeStatus: "done",
    };
    const next = reducer(state, { type: "FUSION_FAILED", error: "fusion exploded" });
    expect(next.running).toBe(false);
    expect(next.fusionStatus).toBe("error");
    expect(next.fusionError).toBe("fusion exploded");
  });
});

describe("reducer — JUDGE_RESULT stores actual judge scores", () => {
  it("updates weightedScore from scoresById, not stale values", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const c2 = makeCandidate("c2", "umans", "model-b");
    const state = runningStateWithCandidates([c1, c2], "rank");
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.5, c2: 3.2 },
    });
    // In rank mode, running clears after judge
    expect(next.running).toBe(false);
    expect(next.judgeStatus).toBe("done");
    // Scores should come from scoresById
    const updated1 = next.candidates.find((c) => c.id === "c1")!;
    const updated2 = next.candidates.find((c) => c.id === "c2")!;
    expect(updated1.weightedScore).toBe(4.5);
    expect(updated2.weightedScore).toBe(3.2);
  });

  it("keeps running=true in FUSE mode after JUDGE_RESULT (continues to fusion)", () => {
    const state = runningStateWithCandidates([
      makeCandidate("c1", "openrouter", "model-a"),
      makeCandidate("c2", "umans", "model-b"),
    ], "fuse");
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "fuse",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.0, c2: 3.5 },
    });
    expect(next.running).toBe(true);
    expect(next.judgeStatus).toBe("done");
  });

  it("uses captured RANK mode when the current UI mode changed to FUSE", () => {
    const state = runningStateWithCandidates([
      makeCandidate("c1", "openrouter", "model-a"),
      makeCandidate("c2", "umans", "model-b"),
    ], "fuse");
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4, c2: 3 },
    });
    expect(next.running).toBe(false);
  });

  it("uses captured FUSE mode when the current UI mode changed to RANK", () => {
    const state = runningStateWithCandidates([
      makeCandidate("c1", "openrouter", "model-a"),
      makeCandidate("c2", "umans", "model-b"),
    ], "rank");
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "fuse",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4, c2: 3 },
    });
    expect(next.running).toBe(true);
  });
});

describe("reducer — INSUFFICIENT_CANDIDATES is terminal", () => {
  it("clears running and records done/failed counts", () => {
    const state = runningStateWithCandidates([
      makeCandidate("c1", "openrouter", "model-a"),
    ]);
    const next = reducer(state, { type: "INSUFFICIENT_CANDIDATES", done: 1, failed: 2 });
    expect(next.running).toBe(false);
    expect(next.insufficient).toEqual({ done: 1, failed: 2 });
  });
});

describe("reducer — RETRY_CANDIDATE_START resets the candidate and sets running", () => {
  it("marks target candidate as pending and clears judge/fusion state", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    c1.status = "error";
    c1.errorMessage = "failed";
    c1.weightedScore = 0;
    const state: StudioState = {
      ...initialState,
      running: false,
      candidates: [c1],
      judgeStatus: "done",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
    };
    const next = reducer(state, { type: "RETRY_CANDIDATE_START", id: "c1" });
    expect(next.running).toBe(true);
    expect(next.judgeStatus).toBe("idle");
    expect(next.judgeError).toBeNull();
    expect(next.consensus).toBeNull();
    expect(next.fusionStatus).toBe("idle");
    expect(next.fusedText).toBeNull();
    const retried = next.candidates.find((c) => c.id === "c1")!;
    expect(retried.status).toBe("pending");
    expect(retried.errorMessage).toBeUndefined();
    expect(retried.segments).toEqual([]);
    expect(retried.weightedScore).toBe(0);
  });
});

describe("reducer — RETRY_CANDIDATE_FAILED is terminal", () => {
  it("clears running and marks candidate as error", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    c1.status = "pending";
    const state: StudioState = {
      ...initialState,
      running: true,
      candidates: [c1],
    };
    const next = reducer(state, { type: "RETRY_CANDIDATE_FAILED", id: "c1", error: "retry failed", finishedAt: 123 });
    expect(next.running).toBe(false);
    const failed = next.candidates.find((c) => c.id === "c1")!;
    expect(failed.status).toBe("error");
    expect(failed.errorMessage).toBe("retry failed");
  });
});

describe("reducer — ABORT_RUN clears running", () => {
  it("sets aborted=true and clears pending candidates", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    c1.status = "pending";
    const state: StudioState = {
      ...initialState,
      running: true,
      candidates: [c1],
      judgeStatus: "running",
    };
    const next = reducer(state, { type: "ABORT_RUN" });
    expect(next.running).toBe(false);
    expect(next.aborted).toBe(true);
    expect(next.judgeStatus).toBe("idle");
    const aborted = next.candidates.find((c) => c.id === "c1")!;
    expect(aborted.status).toBe("error");
    expect(aborted.errorMessage).toBe("Aborted");
  });
});
