import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RankResult } from "./RankResult";
import { FuseResult } from "./FuseResult";
import { CompareView } from "./CompareView";
import type { StudioState } from "../studio-engine";
import type { Candidate } from "../studio-data";
import type { EvaluationCriterion } from "../lib/evaluations/evaluation-types";
import { HOLISTIC_EVALUATION } from "../lib/evaluations/evaluation-profile-adhoc";

function makeUsableCandidate(id: string, model: string, score = 4.0): Candidate {
  return {
    id,
    model,
    provider: "Test",
    providerId: "openrouter",
    slug: `slug-${id}`,
    accent: "emerald",
    strategy: "Parallel model",
    summary: `summary for ${model}`,
    scores: {},
    weightedScore: score,
    segments: [{ id: `${id}-s0`, text: `Real answer content from ${model}` }],
    status: "done",
    startedAt: 100,
    finishedAt: 200,
  };
}

function makeEmptyDoneCandidate(id: string, model: string): Candidate {
  return {
    ...makeUsableCandidate(id, model),
    segments: [],
    summary: "",
  };
}

function makeFailedCandidate(id: string, model: string, error = "provider error"): Candidate {
  return {
    ...makeUsableCandidate(id, model),
    segments: [],
    summary: "",
    status: "error",
    errorMessage: error,
  };
}

function makeStudioState(candidates: Candidate[], mode: "rank" | "fuse" = "rank"): StudioState {
  return {
    ...({} as StudioState),
    mode,
    evaluation: HOLISTIC_EVALUATION,
    slots: [],
    temperature: 0.4,
    systemPrompt: "",
    critic: { providerId: "openrouter", model: "judge" },
    judgeInstruction: "",
    candidates,
    running: false,
    models: [],
    judgeStatus: "done",
    judgeError: null,
    consensus: null,
    fusionStatus: "done",
    fusionError: null,
    fusedText: "Fused answer text here.",
    insufficient: null,
    aborted: false,
    qualityRating: 0,
    audit: [],
    exampleIndex: -1,
  } as StudioState;
}

// ---------------------------------------------------------------------------
// RankResult — empty/unusable done candidates must NOT appear in the
// leaderboard, full answers, or fuse eligibility count.
// ---------------------------------------------------------------------------

describe("RankResult — usable candidate filtering", () => {
  it("excludes empty-content done candidates from the leaderboard", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.5),
      makeEmptyDoneCandidate("c2", "ModelB"),
    ];
    const html = renderToStaticMarkup(<RankResult state={makeStudioState(candidates, "rank")} />);
    expect(html).toContain("ModelA");
    // ModelB is done but empty — it must NOT appear in the leaderboard.
    expect(html).not.toContain("ModelB");
  });

  it("excludes empty-content done candidates from the full answers section", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.0),
      makeEmptyDoneCandidate("c2", "ModelB"),
    ];
    const html = renderToStaticMarkup(<RankResult state={makeStudioState(candidates, "rank")} />);
    // The full answers section should only contain ModelA.
    expect(html).toContain("Real answer content from ModelA");
    expect(html).not.toContain("ModelB");
  });
});

// ---------------------------------------------------------------------------
// FuseResult — SourceAnswers must only show usable candidates, not empty done ones.
// ---------------------------------------------------------------------------

describe("FuseResult — SourceAnswers usable filtering", () => {
  it("excludes empty-content done candidates from 'What fed this fusion'", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.0),
      makeEmptyDoneCandidate("c2", "ModelB"),
      makeFailedCandidate("c3", "ModelC"),
    ];
    const html = renderToStaticMarkup(<FuseResult state={makeStudioState(candidates, "fuse")} />);
    // The source answers section must only list ModelA (the only usable one).
    expect(html).toContain("ModelA");
    // ModelB (empty done) must NOT be listed as a source.
    expect(html).not.toContain("ModelB");
  });
});

// ---------------------------------------------------------------------------
// CompareView — must only show usable candidates, not empty done ones.
// ---------------------------------------------------------------------------

describe("CompareView — usable candidate filtering", () => {
  const criteria: EvaluationCriterion[] = [];

  it("excludes empty-content done candidates from the comparison grid", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.0),
      makeUsableCandidate("c2", "ModelB", 3.5),
      makeEmptyDoneCandidate("c3", "ModelC"),
    ];
    const html = renderToStaticMarkup(
      <CompareView candidates={candidates} criteria={criteria} onClose={() => {}} />,
    );
    expect(html).toContain("ModelA");
    expect(html).toContain("ModelB");
    // ModelC is done but empty — must NOT appear in the comparison.
    expect(html).not.toContain("ModelC");
  });
});
