// =============================================================================
// RSemble AI — Fusion recipe tests
//
// Prompt assembly per family (snapshot), the blindness invariant (asserted,
// not eyeballed — spec test 5), and the refine-the-winner confound control
// (rubric content identical to the fusion recipe under test — spec test 7).
// =============================================================================

import { describe, expect, it } from "vitest";
import type { BlindCandidate, JudgeReport, ConsensusBreakdown } from "../../studio-data";
import type { EvaluationProfile } from "./evaluation-types";
import {
  findBlindnessViolations,
  FUSION_RECIPE_ANALYSIS_FED_V1,
  FUSION_RECIPE_ANALYSIS_SCORES_V1,
  FUSION_RECIPE_BLIND_RAW_V1,
  renderRecipeMessages,
  renderRefineWinnerMessages,
  rubricSection,
  type CandidateIdentity,
} from "./fusion-recipes";

const IDENTITIES: CandidateIdentity[] = [
  { model: "GLM 5.2 Ultra", provider: "Z-AI", slug: "z-ai/glm-5.2-ultra", providerId: "openrouter" },
  { model: "DeepSeek V4 Flash", provider: "DeepSeek", slug: "deepseek/deepseek-v4-flash", providerId: "openrouter" },
];

const BLIND: BlindCandidate[] = [
  { label: "A", candidateId: "cand-1", content: "Answer A: use a breadth-first search." },
  { label: "B", candidateId: "cand-2", content: "Answer B: use Dijkstra's algorithm." },
];

const PROFILE: EvaluationProfile = {
  id: "prof-1",
  version: 2,
  name: "Quality",
  description: "test",
  judgeInstruction: "judge fairly",
  criteria: [
    {
      id: "c1",
      name: "Accuracy",
      description: "Factually correct",
      weight: 2,
      anchors: { one: "wrong", three: "mostly right", five: "fully correct" },
    },
    {
      id: "c2",
      name: "Completeness",
      description: "Covers the task",
      weight: 1,
      anchors: { one: "sparse", three: "adequate", five: "complete" },
    },
  ],
  createdAt: 1000,
  updatedAt: 1000,
};

const REPORT: JudgeReport = {
  labelMap: [
    { label: "A", candidateId: "cand-1" },
    { label: "B", candidateId: "cand-2" },
  ],
  evaluationsById: {
    "cand-1": {
      candidateId: "cand-1",
      blindLabel: "A",
      overallScore: 4.0,
      position: "BFS is sufficient",
      rationale: "Correct but misses weighted edges",
      strengths: ["simple", "correct on unweighted graphs"],
      deductions: [{ severity: "major", reason: "ignores weights" }],
      missedRequirements: ["complexity analysis"],
      criterionScores: [
        { criterionId: "c1", label: "Accuracy", score: 5.0, rationale: "correct for unweighted" },
        { criterionId: "c2", label: "Completeness", score: 3.0, rationale: "no complexity" },
      ],
    },
    "cand-2": {
      candidateId: "cand-2",
      blindLabel: "B",
      overallScore: 4.0,
      position: "Dijkstra handles weights",
      rationale: "General but more complex",
      strengths: ["handles weighted graphs", "includes complexity analysis"],
      deductions: [{ severity: "minor", reason: "overkill for unweighted" }],
      missedRequirements: [],
      criterionScores: [
        { criterionId: "c1", label: "Accuracy", score: 3.0, rationale: "heap caveat unmentioned" },
        { criterionId: "c2", label: "Completeness", score: 5.0, rationale: "full treatment" },
      ],
    },
  },
  comparisons: [],
};

const CONSENSUS: ConsensusBreakdown = {
  consensus: ["Both answers pick a graph traversal algorithm"],
  contradictions: ["Whether edge weights matter"],
  uniqueInsights: [{ source: "GLM 5.2 Ultra", insight: "BFS is O(V+E)" }],
};

function inputFor(recipe: "raw" | "fed" | "scores") {
  return {
    prompt: "Which algorithm finds the shortest path?",
    profile: PROFILE,
    blindCandidates: BLIND,
    judgeReport: recipe === "raw" ? null : REPORT,
    consensus: recipe === "raw" ? null : CONSENSUS,
  };
}

describe("recipe prompt assembly (snapshots)", () => {
  it("BlindRaw v1 — anonymized answers only, no analysis", () => {
    const messages = renderRecipeMessages(FUSION_RECIPE_BLIND_RAW_V1, inputFor("raw"));
    expect(messages).toMatchSnapshot();
  });

  it("AnalysisFed v1 — adds qualitative development-judge analysis", () => {
    const messages = renderRecipeMessages(FUSION_RECIPE_ANALYSIS_FED_V1, inputFor("fed"));
    expect(messages).toMatchSnapshot();
  });

  it("AnalysisScores v1 — adds numeric per-criterion scores", () => {
    const messages = renderRecipeMessages(FUSION_RECIPE_ANALYSIS_SCORES_V1, inputFor("scores"));
    expect(messages).toMatchSnapshot();
  });

  it("refine-the-winner — revises the blind winner against the rubric", () => {
    const messages = renderRefineWinnerMessages({
      prompt: "Which algorithm finds the shortest path?",
      profile: PROFILE,
      winnerLabel: "A",
      winnerContent: BLIND[0].content,
      blindCandidates: BLIND,
      rubricAccess: true,
      verification: false,
    });
    expect(messages).toMatchSnapshot();
  });
});

describe("family ablation semantics", () => {
  it("BlindRaw excludes judge analysis; AnalysisFed includes it qualitatively; AnalysisScores adds numbers", () => {
    const raw = renderRecipeMessages(FUSION_RECIPE_BLIND_RAW_V1, inputFor("raw"))[1].content;
    const fed = renderRecipeMessages(FUSION_RECIPE_ANALYSIS_FED_V1, inputFor("fed"))[1].content;
    const scores = renderRecipeMessages(FUSION_RECIPE_ANALYSIS_SCORES_V1, inputFor("scores"))[1].content;

    expect(raw).not.toContain("Development-judge analysis");
    expect(fed).toContain("Development-judge analysis");
    expect(fed).toContain("Candidate A: position: BFS is sufficient");
    expect(fed).not.toContain("overall 4.0");
    expect(scores).toContain("overall 4.0");
    expect(scores).toContain("Accuracy 5.0");
    expect(scores).toContain("Completeness 3.0");
  });

  it("rubricAccess gates the criteria block; verification toggles the verify instruction", () => {
    const noRubric = renderRecipeMessages(
      { ...FUSION_RECIPE_BLIND_RAW_V1, rubricAccess: false },
      inputFor("raw"),
    );
    expect(noRubric[1].content).not.toContain("Evaluation criteria:");

    const verified = renderRecipeMessages(
      { ...FUSION_RECIPE_BLIND_RAW_V1, verification: true },
      inputFor("raw"),
    );
    expect(verified[0].content).toContain("Verify any arithmetic");
    expect(verified[0].content).toContain("flag anything you cannot confirm");
  });
});

describe("blindness invariant (spec test 5)", () => {
  it("no model slug, provider, or display name reaches the synthesizer — any family", () => {
    const recipes = [
      FUSION_RECIPE_BLIND_RAW_V1,
      FUSION_RECIPE_ANALYSIS_FED_V1,
      FUSION_RECIPE_ANALYSIS_SCORES_V1,
    ] as const;
    const inputs = [inputFor("raw"), inputFor("fed"), inputFor("scores")];
    for (let i = 0; i < recipes.length; i++) {
      const messages = renderRecipeMessages(recipes[i], inputs[i]);
      expect(findBlindnessViolations(messages, IDENTITIES)).toEqual([]);
      const joined = messages.map((m) => m.content).join("\n");
      expect(joined).not.toContain("z-ai/glm-5.2-ultra");
      expect(joined).not.toContain("deepseek/deepseek-v4-flash");
      expect(joined).not.toContain("GLM 5.2 Ultra");
      expect(joined).not.toContain("DeepSeek");
      expect(joined).not.toContain("Z-AI");
      expect(joined).not.toContain("openrouter");
    }
  });

  it("identity-resolved unique-insight sources never leak into the analysis block", () => {
    // CONSENSUS.uniqueInsights carries a resolved display name — the analysis
    // renderer must never forward it.
    const fed = renderRecipeMessages(FUSION_RECIPE_ANALYSIS_FED_V1, inputFor("fed"))[1].content;
    expect(fed).not.toContain("GLM 5.2 Ultra");
    expect(fed).toContain("Both answers pick a graph traversal algorithm");
  });

  it("the refine control is equally blind", () => {
    const messages = renderRefineWinnerMessages({
      prompt: "Which algorithm finds the shortest path?",
      profile: PROFILE,
      winnerLabel: "A",
      winnerContent: BLIND[0].content,
      blindCandidates: BLIND,
      rubricAccess: true,
      verification: false,
    });
    expect(findBlindnessViolations(messages, IDENTITIES)).toEqual([]);
  });

  it("findBlindnessViolations flags a rigged leak", () => {
    const leaked = [
      { role: "system" as const, content: "You are a synthesizer." },
      { role: "user" as const, content: "### GLM 5.2 Ultra\nsome answer" },
    ];
    expect(findBlindnessViolations(leaked, IDENTITIES)).toContain("model:GLM 5.2 Ultra");
  });
});

describe("refine-the-winner confound control (spec §7.1)", () => {
  it("refine receives rubric content byte-identical to the fusion recipe under test", () => {
    const recipe = FUSION_RECIPE_ANALYSIS_SCORES_V1;
    const fusion = renderRecipeMessages(recipe, inputFor("scores"));
    const refine = renderRefineWinnerMessages({
      prompt: "Which algorithm finds the shortest path?",
      profile: PROFILE,
      winnerLabel: "A",
      winnerContent: BLIND[0].content,
      blindCandidates: BLIND,
      rubricAccess: recipe.rubricAccess,
      verification: recipe.verification,
    });
    const expectedRubric = rubricSection(PROFILE, recipe.rubricAccess);
    expect(expectedRubric.length).toBeGreaterThan(0);
    expect(fusion[1].content).toContain(expectedRubric);
    expect(refine[1].content).toContain(expectedRubric);
  });

  it("a no-rubric recipe yields a no-rubric refine control", () => {
    const refine = renderRefineWinnerMessages({
      prompt: "p",
      profile: PROFILE,
      winnerLabel: "A",
      winnerContent: BLIND[0].content,
      blindCandidates: BLIND,
      rubricAccess: false,
      verification: false,
    });
    expect(refine[1].content).not.toContain("Evaluation criteria:");
  });
});
