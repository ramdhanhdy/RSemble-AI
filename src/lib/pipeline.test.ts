import { describe, it, expect } from "vitest";
import { parseJudge, judgeMessages, fusionMessages, splitSegments, buildFanoutJobs, isUsableCandidate, checkFusionEligibility } from "./pipeline";
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

describe("judgeMessages — judge instruction", () => {
  it("embeds a non-empty judge instruction into the judge prompt", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const instruction = "Prefer concise answers and penalize hedging.";
    const msgs = judgeMessages("test prompt", [], candidates, instruction);
    expect(msgs).toHaveLength(2);
    // The instruction must reach the judge. It should appear in either system
    // or user content — we assert on the joined text so the test is robust to
    // placement, but require it to be present.
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain(instruction);
  });

  it("empty judge instruction produces a byte-identical prompt to the no-arg call", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const baseline = judgeMessages("test prompt", [], candidates);
    const empty = judgeMessages("test prompt", [], candidates, "");
    const whitespace = judgeMessages("test prompt", [], candidates, "   \n\t  ");
    const omitted = judgeMessages("test prompt", [], candidates, undefined);
    expect(empty).toEqual(baseline);
    expect(whitespace).toEqual(baseline);
    expect(omitted).toEqual(baseline);
  });
});

describe("isUsableCandidate — content eligibility", () => {
  it("accepts a done candidate with non-empty segments", () => {
    const c = makeCandidate("c1", "ModelA", "openrouter", "model-a");
    expect(isUsableCandidate(c)).toBe(true);
  });

  it("rejects a candidate with status error", () => {
    const c: Candidate = { ...makeCandidate("c1", "ModelA", "openrouter", "model-a"), status: "error" };
    expect(isUsableCandidate(c)).toBe(false);
  });

  it("rejects a candidate with status pending", () => {
    const c: Candidate = { ...makeCandidate("c1", "ModelA", "openrouter", "model-a"), status: "pending" };
    expect(isUsableCandidate(c)).toBe(false);
  });

  it("rejects a done candidate with no segments", () => {
    const c: Candidate = { ...makeCandidate("c1", "ModelA", "openrouter", "model-a"), segments: [] };
    expect(isUsableCandidate(c)).toBe(false);
  });

  it("rejects a done candidate whose only segment is empty/whitespace", () => {
    const c: Candidate = {
      ...makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      segments: [{ id: "s0", text: "   \n\t " }],
    };
    expect(isUsableCandidate(c)).toBe(false);
  });
});

describe("checkFusionEligibility — fusion guard", () => {
  it("returns ok with usable candidates when ≥2 have content", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const result = checkFusionEligibility(candidates);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usable).toHaveLength(2);
      expect(result.usable.map((c) => c.id)).toEqual(["c1", "c2"]);
    }
  });

  it("returns not-ok with done/failed counts when only 1 candidate has content", () => {
    const candidates: Candidate[] = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      { ...makeCandidate("c2", "ModelB", "umans", "model-b"), status: "error", errorMessage: "boom" },
    ];
    const result = checkFusionEligibility(candidates);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.done).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.reason).toContain("2");
    }
  });

  it("counts empty-content done candidates as failed, not done", () => {
    const candidates: Candidate[] = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      { ...makeCandidate("c2", "ModelB", "umans", "model-b"), segments: [] },
    ];
    const result = checkFusionEligibility(candidates);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.done).toBe(1);
      expect(result.failed).toBe(1);
    }
  });

  it("returns not-ok when all candidates failed", () => {
    const candidates: Candidate[] = [
      { ...makeCandidate("c1", "ModelA", "openrouter", "model-a"), status: "error", segments: [] },
      { ...makeCandidate("c2", "ModelB", "umans", "model-b"), status: "error", segments: [] },
    ];
    const result = checkFusionEligibility(candidates);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.done).toBe(0);
      expect(result.failed).toBe(2);
    }
  });

  it("returns ok with 2 usable when 3 configured and 1 failed (3→2 partial)", () => {
    const candidates: Candidate[] = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
      { ...makeCandidate("c3", "ModelC", "gemini", "model-c"), status: "error", segments: [], errorMessage: "down" },
    ];
    const result = checkFusionEligibility(candidates);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usable).toHaveLength(2);
    }
  });
});

describe("fusionMessages — judge instruction", () => {
  it("embeds a non-empty judge instruction into the fusion prompt", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const instruction = "Lean toward concrete examples and short sentences.";
    const msgs = fusionMessages({
      prompt: "test prompt",
      rubric: [],
      candidates,
      judgeInstruction: instruction,
    });
    expect(msgs).toHaveLength(2);
    const joined = msgs.map((m) => m.content).join("\n");
    expect(joined).toContain(instruction);
  });

  it("empty/whitespace judge instruction produces a byte-identical fusion prompt to omitting it", () => {
    const candidates = [
      makeCandidate("c1", "ModelA", "openrouter", "model-a"),
      makeCandidate("c2", "ModelB", "umans", "model-b"),
    ];
    const baseline = fusionMessages({
      prompt: "test prompt",
      rubric: [],
      candidates,
    });
    const empty = fusionMessages({
      prompt: "test prompt",
      rubric: [],
      candidates,
      judgeInstruction: "",
    });
    const whitespace = fusionMessages({
      prompt: "test prompt",
      rubric: [],
      candidates,
      judgeInstruction: "  \n ",
    });
    expect(empty).toEqual(baseline);
    expect(whitespace).toEqual(baseline);
  });
});
