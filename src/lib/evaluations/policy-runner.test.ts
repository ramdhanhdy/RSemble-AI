// =============================================================================
// RSemble AI — Blocked-policy runner tests
//
// The blocking invariant: Rank / Fuse / Refine for one task + sample index
// share identical candidate generations and Judge-1 evidence (spec test 7,
// acceptance 6 partial). Only the finishing step varies.
// =============================================================================

import { describe, expect, it } from "vitest";
import type {
  BlindCandidate,
  CandidateEvaluation,
  ConsensusBreakdown,
  JudgeReport,
} from "../../studio-data";
import { FUSION_RECIPE_ANALYSIS_SCORES_V1, type CandidateIdentity } from "./fusion-recipes";
import { deriveRankWinner, planBlockedPolicies, type BlockedPolicyInput } from "./policy-runner";
import type { EvaluationRubric } from "./evaluation-types";

const BLIND: BlindCandidate[] = [
  { label: "A", candidateId: "cand-1", content: "Answer A text" },
  { label: "B", candidateId: "cand-2", content: "Answer B text" },
];

const IDENTITIES: CandidateIdentity[] = [
  {
    model: "GLM 5.2 Ultra",
    provider: "Z-AI",
    slug: "z-ai/glm-5.2-ultra",
    providerId: "openrouter",
  },
  {
    model: "DeepSeek V4 Flash",
    provider: "DeepSeek",
    slug: "deepseek/deepseek-v4-flash",
    providerId: "openrouter",
  },
];

function report(scoreA: number, scoreB: number): JudgeReport {
  return {
    labelMap: [
      { label: "A", candidateId: "cand-1" },
      { label: "B", candidateId: "cand-2" },
    ],
    evaluationsById: {
      "cand-1": {
        candidateId: "cand-1",
        blindLabel: "A",
        overallScore: scoreA,
        position: "A's answer",
        rationale: "A evidence",
        strengths: ["a"],
        deductions: [],
        missedRequirements: [],
        criterionScores: [],
      },
      "cand-2": {
        candidateId: "cand-2",
        blindLabel: "B",
        overallScore: scoreB,
        position: "B's answer",
        rationale: "B evidence",
        strengths: ["b"],
        deductions: [],
        missedRequirements: [],
        criterionScores: [],
      },
    },
    comparisons: [],
  };
}

const CONSENSUS: ConsensusBreakdown = {
  consensus: ["shared"],
  contradictions: [],
  uniqueInsights: [],
};

function input(overrides: Partial<BlockedPolicyInput> = {}): BlockedPolicyInput {
  return {
    prompt: "task",
    rubric: null,
    blindCandidates: BLIND,
    judgeReport: report(3.5, 4.5),
    consensus: CONSENSUS,
    evidence: {
      candidateAttemptIdsByCandidateId: { "cand-1": "catt-1", "cand-2": "catt-2" },
      judgeAttemptId: "jatt-1",
    },
    identities: IDENTITIES,
    ...overrides,
  };
}

describe("deriveRankWinner", () => {
  it("selects the highest-scoring candidate by blind label", () => {
    expect(deriveRankWinner(BLIND, report(3.5, 4.5))).toEqual({
      winnerCandidateId: "cand-2",
      winnerBlindLabel: "B",
      winnerScore: 4.5,
    });
  });

  it("breaks ties deterministically by blind-label order", () => {
    expect(deriveRankWinner(BLIND, report(4.0, 4.0)).winnerCandidateId).toBe("cand-1");
  });
});

describe("planBlockedPolicies — rubric forwarding (CodeRabbit 3741038015)", () => {
  // A pinned rubric must drive the blocked Rank winner through the same
  // authoritative rankValue contract (Q − λ(1−C)) used by fuse/refine and the
  // experiment matrix. Regression: planBlockedPolicies previously called
  // deriveRankWinner without input.profile, silently using the Judge's
  // holistic overallScore as the Rank baseline.
  const rubric: EvaluationRubric = {
    id: "p1",
    version: 1,
    name: "Pinned",
    description: "",
    judgeInstruction: "",
    criteria: [
      {
        id: "quality",
        kind: "graded",
        name: "Quality",
        description: "d",
        weight: 1,
        anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
      },
      {
        id: "b1",
        kind: "binary",
        name: "Check",
        description: "d",
        trueWhen: "t",
        falseWhen: "f",
      },
    ],
    requirementGroups: [{ id: "g1", name: "G1", checkIds: ["b1"], weight: 1, mode: "ALL" }],
    complianceInfluence: 1.0,
    createdAt: 100,
    updatedAt: 100,
  };

  it("ranks by rankValue from the pinned rubric, not holistic overallScore", () => {
    // Judge overallScores say cand-1 (3.5) loses to cand-2 (4.5), but the
    // rubric-derived rankValues invert it: cand-1 has Q=4 (score 4, check
    // passes → C=1, rankValue=4), cand-2 has Q=1 (score 1, check passes →
    // C=1, rankValue=1). The Rank baseline must use rankValue ⇒ cand-1 wins.
    const evals: Record<string, CandidateEvaluation> = {
      "cand-1": {
        candidateId: "cand-1",
        blindLabel: "A",
        overallScore: 3.5,
        position: "p",
        rationale: "r",
        strengths: [],
        deductions: [],
        missedRequirements: [],
        criterionScores: [
          { criterionId: "quality", label: "Quality", kind: "graded", score: 4, rationale: "r" },
          { criterionId: "b1", label: "Check", kind: "binary", value: true, rationale: "r" },
        ],
      },
      "cand-2": {
        candidateId: "cand-2",
        blindLabel: "B",
        overallScore: 4.5,
        position: "p",
        rationale: "r",
        strengths: [],
        deductions: [],
        missedRequirements: [],
        criterionScores: [
          { criterionId: "quality", label: "Quality", kind: "graded", score: 1, rationale: "r" },
          { criterionId: "b1", label: "Check", kind: "binary", value: true, rationale: "r" },
        ],
      },
    };
    const judgeReport: JudgeReport = {
      labelMap: [
        { candidateId: "cand-1", label: "A" },
        { candidateId: "cand-2", label: "B" },
      ],
      evaluationsById: evals,
      comparisons: [],
    };
    const plan = planBlockedPolicies(
      input({ rubric, judgeReport }),
      FUSION_RECIPE_ANALYSIS_SCORES_V1,
    );
    expect(plan.rank.winnerCandidateId).toBe("cand-1");
    expect(plan.refine.winnerCandidateId).toBe("cand-1");
  });
});

describe("planBlockedPolicies — blocking invariant", () => {
  it("Rank, Fuse, and Refine share identical candidate + judge attempt lineage", () => {
    const plan = planBlockedPolicies(input(), FUSION_RECIPE_ANALYSIS_SCORES_V1);
    // The SAME evidence object reaches every policy — shared candidate
    // generations and Judge-1 evidence, only the finish varies.
    expect(plan.rank.evidence).toBe(plan.fuse.evidence);
    expect(plan.fuse.evidence).toBe(plan.refine.evidence);
    expect(plan.rank.evidence).toEqual({
      candidateAttemptIdsByCandidateId: { "cand-1": "catt-1", "cand-2": "catt-2" },
      judgeAttemptId: "jatt-1",
    });
  });

  it("rank winner drives the refine revision target", () => {
    const plan = planBlockedPolicies(input(), FUSION_RECIPE_ANALYSIS_SCORES_V1);
    expect(plan.rank.winnerCandidateId).toBe("cand-2");
    expect(plan.refine.winnerCandidateId).toBe("cand-2");
    expect(plan.refine.messages[1].content).toContain("Winning draft (Candidate B)");
    expect(plan.refine.messages[1].content).toContain("Answer B text");
  });

  it("fuse carries the recipe identity for provenance", () => {
    const plan = planBlockedPolicies(input(), FUSION_RECIPE_ANALYSIS_SCORES_V1);
    expect(plan.fuse.recipe).toEqual({ id: "builtin-analysis-scores", version: 1 });
  });

  it("reports zero blindness violations on well-formed inputs", () => {
    const plan = planBlockedPolicies(input(), FUSION_RECIPE_ANALYSIS_SCORES_V1);
    expect(plan.blindnessViolations).toEqual([]);
  });

  it("flags violations when candidate content itself contains identity material", () => {
    const leaking: BlindCandidate[] = [
      { label: "A", candidateId: "cand-1", content: "As GLM 5.2 Ultra would say…" },
      { label: "B", candidateId: "cand-2", content: "Answer B text" },
    ];
    const plan = planBlockedPolicies(
      input({ blindCandidates: leaking }),
      FUSION_RECIPE_ANALYSIS_SCORES_V1,
    );
    // The leak is inside candidate answer text — detected so the orchestrator
    // can block or redact before the synthesizer call.
    expect(plan.blindnessViolations.length).toBeGreaterThan(0);
  });
});
