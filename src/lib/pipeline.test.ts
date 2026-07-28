import { describe, it, expect } from "vitest";
import { parseJudge, judgeMessages, splitSegments, buildFanoutJobs } from "./pipeline";
import type { Candidate } from "../studio-data";
import type { ProviderId } from "./providers/types";

function makeCandidate(id: string, model: string, providerId: ProviderId, slug: string): Candidate {
  return {
    id,
    model,
    provider: providerId,
    providerId,
    slug,
    accent: "A",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments: [{ id: `${id}-s0`, text: `Answer from ${model}` }],
    status: "done",
  };
}

describe("parseJudge — score matching", () => {
  it("matches scores by bare letter labels", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const judgeText = JSON.stringify({
      consensus: ["point 1"],
      contradictions: [],
      uniqueInsights: [{ source: "A", insight: "insight A" }],
      scores: [
        { label: "A", score: 4.5, rationale: "good" },
        { label: "B", score: 3.2, rationale: "ok" },
      ],
    });
    const result = parseJudge(judgeText, candidates);
    expect(result.scoresById["c1"]).toBe(4.5);
    expect(result.scoresById["c2"]).toBe(3.2);
    expect(result.unmatchedScores).toHaveLength(0);
  });

  it("matches scores by wrapped labels like 'Candidate B', 'B)', 'B.'", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const judgeText = JSON.stringify({
      consensus: [],
      contradictions: [],
      uniqueInsights: [],
      scores: [
        { label: "Candidate A", score: 4.0 },
        { label: "B)", score: 3.5 },
      ],
    });
    const result = parseJudge(judgeText, candidates);
    expect(result.scoresById["c1"]).toBe(4.0);
    expect(result.scoresById["c2"]).toBe(3.5);
  });

  it("matches scores by model name when letters are absent", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const judgeText = JSON.stringify({
      consensus: [],
      contradictions: [],
      uniqueInsights: [],
      scores: [
        { label: "ModelA", score: 4.8 },
        { label: "ModelB", score: 3.1 },
      ],
    });
    const result = parseJudge(judgeText, candidates);
    expect(result.scoresById["c1"]).toBe(4.8);
    expect(result.scoresById["c2"]).toBe(3.1);
  });

  it("records unmatched scores instead of silently dropping them", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
    ];
    const judgeText = JSON.stringify({
      consensus: [],
      contradictions: [],
      uniqueInsights: [],
      scores: [
        { label: "A", score: 4.0 },
        { label: "Z", score: 2.0 },
      ],
    });
    const result = parseJudge(judgeText, candidates);
    expect(result.scoresById["c1"]).toBe(4.0);
    expect(result.unmatchedScores).toHaveLength(1);
    expect(result.unmatchedScores[0].label).toBe("Z");
    expect(result.unmatchedScores[0].score).toBe(2.0);
  });

  it("clamps scores to 0-5 range", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
    ];
    const judgeText = JSON.stringify({
      consensus: [],
      contradictions: [],
      uniqueInsights: [],
      scores: [
        { label: "A", score: 10 },
      ],
    });
    const result = parseJudge(judgeText, candidates);
    expect(result.scoresById["c1"]).toBe(5);
  });

  it("throws on malformed JSON (caller catches and dispatches JUDGE_FAILED)", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
    ];
    expect(() => parseJudge("not valid json at all", candidates)).toThrow(SyntaxError);
  });
});

describe("parseJudge — breakdown parsing", () => {
  it("extracts consensus, contradictions, and uniqueInsights", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const judgeText = JSON.stringify({
      consensus: ["shared point"],
      contradictions: ["disagreement"],
      uniqueInsights: [
        { source: "A", insight: "unique to A" },
        { source: "B", insight: "unique to B" },
      ],
      scores: [
        { label: "A", score: 4.0 },
        { label: "B", score: 3.5 },
      ],
    });
    const result = parseJudge(judgeText, candidates);
    expect(result.breakdown.consensus).toEqual(["shared point"]);
    expect(result.breakdown.contradictions).toEqual(["disagreement"]);
    expect(result.breakdown.uniqueInsights).toHaveLength(2);
    expect(result.breakdown.uniqueInsights[0].source).toBe("ModelA");
    expect(result.breakdown.uniqueInsights[1].source).toBe("ModelB");
  });
});

describe("buildFanoutJobs — provider-scoped identity", () => {
  it("assigns providerId from slot, enabling identical slugs across providers", () => {
    const jobs = buildFanoutJobs([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "GLM", slug: "glm-5.2", enabled: true },
      { id: "s2", providerId: "umans", provider: "Umans", model: "GLM", slug: "glm-5.2", enabled: true },
    ]);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].providerId).toBe("openrouter");
    expect(jobs[1].providerId).toBe("umans");
    // Both have the same slug but different providerId
    expect(jobs[0].slug).toBe("glm-5.2");
    expect(jobs[1].slug).toBe("glm-5.2");
  });

  it("skips disabled slots", () => {
    const jobs = buildFanoutJobs([
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "a", enabled: true },
      { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "b", enabled: false },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe("cand-s1");
  });
});

describe("splitSegments", () => {
  it("splits on double newlines into paragraphs", () => {
    const segments = splitSegments("para1\n\npara2\n\npara3", "c1");
    expect(segments).toHaveLength(3);
    expect(segments[0].text).toBe("para1");
    expect(segments[2].text).toBe("para3");
  });

  it("returns whole content as single segment when no double newlines", () => {
    const segments = splitSegments("single paragraph", "c1");
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("single paragraph");
  });
});

describe("judgeMessages — provider-scoped labels", () => {
  it("includes candidate model names in judge prompt", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const msgs = judgeMessages("test prompt", [], candidates);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toContain("ModelA");
    expect(msgs[1].content).toContain("ModelB");
  });
});
