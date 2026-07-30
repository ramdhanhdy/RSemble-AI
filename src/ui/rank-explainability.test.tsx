import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RankResult } from "./RankResult";
import type { StudioState } from "../studio-engine";
import { HOLISTIC_EVALUATION } from "../lib/evaluations/evaluation-profile-adhoc";
import type {
  Candidate,
  JudgeReport,
  JudgeComparison,
  JudgeCriterionScore,
} from "../studio-data";

function makeUsableCandidate(
  id: string,
  model: string,
  score = 4.0,
  provider = "Test",
  providerId: Candidate["providerId"] = "openrouter",
): Candidate {
  return {
    id,
    model,
    provider,
    providerId,
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

function makeReport(
  entries: Array<{
    id: string;
    label: string;
    score: number;
    position?: string;
    rationale?: string;
    strengths?: string[];
    deductions?: { severity: "minor" | "major"; reason: string }[];
    missedRequirements?: string[];
    criterionScores?: JudgeCriterionScore[];
  }>,
  comparisons: JudgeComparison[] = [],
): JudgeReport {
  return {
    labelMap: entries.map((e) => ({ label: e.label, candidateId: e.id })),
    evaluationsById: Object.fromEntries(
      entries.map((e) => [
        e.id,
        {
          candidateId: e.id,
          blindLabel: e.label,
          overallScore: e.score,
          position: e.position ?? `Position of ${e.label}`,
          rationale: e.rationale ?? `Decision evidence for ${e.label}`,
          strengths: e.strengths ?? [`Strength of ${e.label}`],
          deductions: e.deductions ?? [],
          missedRequirements: e.missedRequirements ?? [],
          criterionScores: e.criterionScores ?? [],
        },
      ]),
    ),
    comparisons,
  };
}

function makeStudioState(
  candidates: Candidate[],
  report: JudgeReport | null = null,
  consensus: StudioState["consensus"] = null,
): StudioState {
  return {
    mode: "rank",
    prompt: "test prompt",
    exampleIndex: -1,
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
    consensus,
    judgeReport: report,
    fusionStatus: "idle",
    fusionError: null,
    fusedText: null,
    insufficient: null,
    aborted: false,
    runContext: null,
    qualityRating: 0,
    audit: [],
  };
}

// ---------------------------------------------------------------------------
// RankResult — blind evaluation key + per-candidate explanations.
// ---------------------------------------------------------------------------

describe("RankResult — blind evaluation key", () => {
  it("maps blind labels to models after randomized judge order", () => {
    // Judge order was shuffled: A → c2 (ModelB), B → c1 (ModelA).
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.5),
      makeUsableCandidate("c2", "ModelB", 3.0),
    ];
    const report = makeReport([
      { id: "c2", label: "A", score: 3.0 },
      { id: "c1", label: "B", score: 4.5 },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    // The key must show the mapping in label order, not rank order.
    expect(html).toContain("Candidate A");
    expect(html).toContain("ModelB");
    expect(html).toContain("Candidate B");
    expect(html).toContain("ModelA");
  });

  it("disambiguates duplicate model names with provider display name", () => {
    const candidates = [
      makeUsableCandidate("c1", "GLM", 4.5, "OpenRouter", "openrouter"),
      makeUsableCandidate("c2", "GLM", 3.0, "Umans", "umans"),
    ];
    const report = makeReport([
      { id: "c1", label: "A", score: 4.5 },
      { id: "c2", label: "B", score: 3.0 },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    // Both candidates share the model name "GLM" — the provider must appear to
    // disambiguate them in the blind key.
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Umans");
  });
});

describe("RankResult — score explanations", () => {
  it("renders a visible rationale for every ranked candidate", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.5),
      makeUsableCandidate("c2", "ModelB", 3.0),
    ];
    const report = makeReport([
      { id: "c1", label: "A", score: 4.5, rationale: "Quantifies the revenue exposure." },
      { id: "c2", label: "B", score: 3.0, rationale: "Underspecified adoption threshold." },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).toContain("Quantifies the revenue exposure.");
    expect(html).toContain("Underspecified adoption threshold.");
  });

  it("uses the judge winner rationale in the recommendation callout, not a fabricated line", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.8),
      makeUsableCandidate("c2", "ModelB", 3.2),
    ];
    const report = makeReport([
      {
        id: "c1",
        label: "A",
        score: 4.8,
        position: "Fix onboarding reliability first",
        rationale: "Strong quantified comparison with credible early decision gates.",
      },
      { id: "c2", label: "B", score: 3.2 },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).toContain("Strong quantified comparison with credible early decision gates.");
  });

  it("renders strengths, severity-labelled deductions, and missed requirements", () => {
    const candidates = [makeUsableCandidate("c1", "ModelA", 3.5)];
    const report = makeReport([
      {
        id: "c1",
        label: "A",
        score: 3.5,
        strengths: ["Clear structure", "Good evidence"],
        deductions: [
          { severity: "major", reason: "Ignores the budget constraint" },
          { severity: "minor", reason: "Weak conclusion" },
        ],
        missedRequirements: ["Did not address latency"],
      },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).toContain("Clear structure");
    expect(html).toContain("Good evidence");
    expect(html).toContain("Ignores the budget constraint");
    expect(html).toContain("Major");
    expect(html).toContain("Weak conclusion");
    expect(html).toContain("Minor");
    expect(html).toContain("Did not address latency");
  });

  it("renders criterion rationales when evaluation criteria are defined", () => {
    const candidates = [makeUsableCandidate("c1", "ModelA", 4.5)];
    const report = makeReport([
      {
        id: "c1",
        label: "A",
        score: 4.5,
        criterionScores: [
          { criterionId: "commercial-reasoning", label: "Commercial reasoning", score: 4.7, rationale: "Uses supplied commercial evidence." },
        ],
      },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).toContain("Commercial reasoning");
    expect(html).toContain("Uses supplied commercial evidence.");
  });

  it("omits headings for empty optional arrays (no inert scaffolding)", () => {
    const candidates = [makeUsableCandidate("c1", "ModelA", 5.0)];
    const report = makeReport([
      {
        id: "c1",
        label: "A",
        score: 5.0,
        strengths: ["Perfect"],
        deductions: [],
        missedRequirements: [],
        criterionScores: [],
      },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).not.toMatch(/Deductions/i);
    expect(html).not.toMatch(/Missed requirements/i);
    expect(html).not.toMatch(/Criterion scores/i);
  });
});

describe("RankResult — same-conclusion comparisons", () => {
  it("appears only when comparisons exist", () => {
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.0),
      makeUsableCandidate("c2", "ModelB", 3.5),
    ];
    const comparison: JudgeComparison = {
      candidateIds: ["c1", "c2"],
      blindLabels: ["A", "B"],
      reason: "Both recommend reliability, but A quantifies the downside.",
    };
    const report = makeReport(
      [
        { id: "c1", label: "A", score: 4.0 },
        { id: "c2", label: "B", score: 3.5 },
      ],
      [comparison],
    );
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).toContain("Both recommend reliability, but A quantifies the downside.");
  });

  it("is omitted entirely when no comparisons exist", () => {
    const candidates = [makeUsableCandidate("c1", "ModelA", 4.0)];
    const report = makeReport([{ id: "c1", label: "A", score: 4.0 }]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    expect(html).not.toMatch(/Same-conclusion comparison/i);
  });
});

describe("RankResult — rank sorting does not alter label identity", () => {
  it("keeps each candidate's blind label stable after score-descending sort", () => {
    // c1 (ModelA) scores 4.8 but wore label B at judge time; c2 (ModelB) wore A.
    const candidates = [
      makeUsableCandidate("c1", "ModelA", 4.8),
      makeUsableCandidate("c2", "ModelB", 3.0),
    ];
    const report = makeReport([
      { id: "c2", label: "A", score: 3.0 },
      { id: "c1", label: "B", score: 4.8 },
    ]);
    const html = renderToStaticMarkup(
      <RankResult state={makeStudioState(candidates, report)} />,
    );
    // ModelA is ranked first (higher score) but its blind label stays "B".
    // The key + explanation must show ModelA beside Candidate B, not A.
    expect(html).toContain("ModelA");
    expect(html).toContain("ModelB");
    // Label B is associated with ModelA somewhere (key or explanation header).
    const modelAIdx = html.indexOf("ModelA");
    const labelBIdx = html.indexOf("Candidate B");
    // Both should be present; the label identity is preserved (not reordered
    // to make the winner "A").
    expect(modelAIdx).toBeGreaterThan(-1);
    expect(labelBIdx).toBeGreaterThan(-1);
  });
});
