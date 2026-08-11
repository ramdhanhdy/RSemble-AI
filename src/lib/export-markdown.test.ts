import { describe, expect, it } from "vitest";
import { buildExportMarkdown } from "./export-markdown";
import type { StudioState } from "../studio-engine";
import { HOLISTIC_EVALUATION } from "./evaluations/evaluation-profile-adhoc";

const baseState: StudioState = {
  mode: "rank",
  prompt: "Write a haiku",
  exampleIndex: -1,
  evaluation: HOLISTIC_EVALUATION,
  slots: [],
  temperature: 0.4,
  systemPrompt: "",
  critic: { providerId: "openrouter", model: "x" },
  judgeInstruction: "",
  reasoningPolicy: { candidates: "provider-default", judge: "provider-default" },
  attachments: [],
  attachmentsToJudge: true,
  candidates: [],
  running: false,
  models: [],
  judgeStatus: "idle",
  judgeError: null,
  consensus: null,
  judgeReport: null,
  fusionStatus: "idle",
  fusionError: null,
  fusedText: null,
  insufficient: null,
  aborted: false,
  runContext: null,
  runId: null,
  qualityRating: 0,
  audit: [],
};

describe("buildExportMarkdown", () => {
  it("returns null when no done candidates and no fused text", () => {
    expect(buildExportMarkdown(baseState)).toBeNull();
  });

  it("exports ranked candidates in rank mode", () => {
    const s: StudioState = {
      ...baseState,
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 4.5,
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s);
    expect(md).toContain("# RSemble AI — Export");
    expect(md).toContain("## Task");
    expect(md).toContain("Write a haiku");
    expect(md).toContain("## Ranked Candidates");
    expect(md).toContain("M1 — 4.5/5");
    expect(md).toContain("answer one");
  });

  it("exports fused answer in fuse mode", () => {
    const s: StudioState = {
      ...baseState,
      mode: "fuse",
      fusedText: "merged answer",
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 4.5,
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s);
    expect(md).toContain("## Fused Answer");
    expect(md).toContain("merged answer");
    expect(md).not.toContain("## Ranked Candidates");
  });

  it("includes judge consensus when present", () => {
    const s: StudioState = {
      ...baseState,
      consensus: {
        consensus: ["agree on X"],
        contradictions: ["disagree on Y"],
        uniqueInsights: [],
      },
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 4.5,
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s);
    expect(md).toContain("## Judge Consensus");
    expect(md).toContain("**Agreement:**");
    expect(md).toContain("- agree on X");
    expect(md).toContain("**Contradictions:**");
    expect(md).toContain("- disagree on Y");
  });

  it("records the judge custom instruction when present", () => {
    const s: StudioState = {
      ...baseState,
      judgeInstruction: "Prefer concise answers and penalize hedging.",
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 4.5,
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s);
    expect(md).toContain("Judge Instruction");
    expect(md).toContain("Prefer concise answers and penalize hedging.");
  });

  it("omits the judge instruction section when the instruction is empty", () => {
    const s: StudioState = {
      ...baseState,
      judgeInstruction: "",
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 4.5,
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s);
    expect(md).not.toContain("Judge Instruction");
  });
});

// ---------------------------------------------------------------------------
// Blind judge audit trail — exports include the blind key, score explanations,
// criterion details, and comparisons. Mappings are auditable (label → model).
// ---------------------------------------------------------------------------

function makeCandidate(id: string, model: string, provider: string, score: number) {
  return {
    id,
    model,
    provider,
    providerId: "openrouter" as const,
    slug: `${provider}/${model}`,
    accent: "indigo",
    strategy: "s",
    summary: "sum",
    scores: {},
    weightedScore: score,
    segments: [{ id: `${id}-s0`, text: `answer for ${model}` }],
    status: "done" as const,
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
    criterionScores?: { criterionId: string; label: string; score: number; rationale: string }[];
  }>,
  comparisons: {
    candidateIds: [string, string];
    blindLabels: [string, string];
    reason: string;
  }[] = [],
) {
  return {
    labelMap: entries.map((e) => ({ label: e.label, candidateId: e.id })),
    evaluationsById: Object.fromEntries(
      entries.map((e) => [
        e.id,
        {
          candidateId: e.id,
          blindLabel: e.label,
          overallScore: e.score,
          position: e.position ?? `pos ${e.label}`,
          rationale: e.rationale ?? `why ${e.label}`,
          strengths: e.strengths ?? ["s"],
          deductions: e.deductions ?? [],
          missedRequirements: e.missedRequirements ?? [],
          criterionScores: e.criterionScores ?? [],
        },
      ]),
    ),
    comparisons,
  };
}

describe("buildExportMarkdown — blind judge audit trail", () => {
  it("exports blind evaluation key, explanations, and comparisons", () => {
    const s: StudioState = {
      ...baseState,
      mode: "rank",
      candidates: [
        makeCandidate("c1", "Kimi K3", "MoonshotAI", 5.0),
        makeCandidate("c2", "Qwen 3.7 Flash", "Qwen", 3.5),
      ],
      judgeReport: makeReport(
        [
          {
            id: "c1",
            label: "B",
            score: 5.0,
            position: "Fix onboarding reliability first",
            rationale: "Strong quantified comparison with credible early decision gates.",
            strengths: ["Quantifies the revenue exposure"],
            deductions: [{ severity: "minor", reason: "The adoption threshold is underspecified" }],
            missedRequirements: [],
            criterionScores: [
              {
                criterionId: "commercial-reasoning",
                label: "Commercial reasoning",
                score: 4.8,
                rationale: "Uses supplied commercial evidence.",
              },
            ],
          },
          { id: "c2", label: "A", score: 3.5 },
        ],
        [
          {
            candidateIds: ["c1", "c2"],
            blindLabels: ["B", "A"],
            reason: "Both recommend reliability, but B quantifies the downside.",
          },
        ],
      ),
    };
    const md = buildExportMarkdown(s)!;
    expect(md).toContain("## Blind Evaluation Key");
    expect(md).toContain("Candidate B: Kimi K3 (MoonshotAI)");
    expect(md).toContain("Candidate A: Qwen 3.7 Flash (Qwen)");
    expect(md).toContain("## Score Explanations");
    expect(md).toContain("### Kimi K3 (Candidate B) — 5.0/5");
    expect(md).toContain("Position: Fix onboarding reliability first");
    expect(md).toContain("Why this score: Strong quantified comparison");
    expect(md).toContain("- Quantifies the revenue exposure");
    expect(md).toContain("Minor: The adoption threshold is underspecified");
    expect(md).toContain("Commercial reasoning: 4.8/5 — Uses supplied commercial evidence.");
    expect(md).toContain("## Same-Conclusion Comparisons");
    expect(md).toContain(
      "Candidate B (Kimi K3) vs Candidate A (Qwen 3.7 Flash): Both recommend reliability, but B quantifies the downside.",
    );
  });

  it("omits empty optional sections (no inert headings)", () => {
    const s: StudioState = {
      ...baseState,
      mode: "rank",
      candidates: [makeCandidate("c1", "M1", "P1", 4.0)],
      judgeReport: makeReport([
        {
          id: "c1",
          label: "A",
          score: 4.0,
          strengths: ["good"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [],
        },
      ]),
    };
    const md = buildExportMarkdown(s)!;
    expect(md).not.toContain("Missed requirements:");
    expect(md).not.toContain("Deductions:");
    expect(md).not.toContain("Criterion scores:");
    expect(md).not.toContain("## Same-Conclusion Comparisons");
  });

  it("escapes markdown-sensitive text in judge rationale", () => {
    const s: StudioState = {
      ...baseState,
      mode: "rank",
      candidates: [makeCandidate("c1", "M1", "P1", 4.0)],
      judgeReport: makeReport([
        {
          id: "c1",
          label: "A",
          score: 4.0,
          rationale: "First line.\n## Injected heading\nLast line.",
        },
      ]),
    };
    const md = buildExportMarkdown(s)!;
    // A line-leading "## " inside judge text is escaped so it cannot inject a
    // real Markdown heading into the exported document.
    expect(md).not.toContain("\n## Injected heading\n");
    expect(md).toContain("\\## Injected heading");
  });

  it("exports legacy/current states without a report safely during transition", () => {
    const s: StudioState = {
      ...baseState,
      mode: "rank",
      candidates: [makeCandidate("c1", "M1", "P1", 4.5)],
      judgeReport: null,
    };
    const md = buildExportMarkdown(s)!;
    expect(md).toContain("## Ranked Candidates");
    expect(md).toContain("M1 — 4.5/5");
  });
});

// ---------------------------------------------------------------------------
// Attachments section — plan 7.7.3
// ---------------------------------------------------------------------------

describe("buildExportMarkdown — attachments section (7.7.3)", () => {
  it("renders an ## Attachments list with kind, size, and truncated flag", () => {
    const s: StudioState = {
      ...baseState,
      candidates: [
        {
          id: "c1",
          model: "Model A",
          provider: "OpenRouter",
          providerId: "openrouter",
          slug: "model-a",
          accent: "A",
          strategy: "Parallel model",
          summary: "x",
          scores: {},
          weightedScore: 4,
          segments: [{ id: "c1-s0", text: "answer" }],
          status: "done",
        },
      ],
      attachments: [
        {
          id: "att-1",
          name: "shot.png",
          kind: "image",
          mimeType: "image/png",
          bytes: 2 * 1024 * 1024,
          status: "ready",
        },
        {
          id: "att-2",
          name: "notes.md",
          kind: "text",
          mimeType: "text/markdown",
          bytes: 1500,
          status: "ready",
          text: "x",
          truncated: true,
        },
      ],
    };
    const md = buildExportMarkdown(s)!;
    expect(md).toContain("## Attachments");
    expect(md).toContain("- shot.png — image, 2.0 MB");
    expect(md).toContain("- notes.md — text, 1.5 KB (truncated)");
  });

  it("omits the section when no attachments exist", () => {
    const s: StudioState = {
      ...baseState,
      candidates: [
        {
          id: "c1",
          model: "Model A",
          provider: "OpenRouter",
          providerId: "openrouter",
          slug: "model-a",
          accent: "A",
          strategy: "Parallel model",
          summary: "x",
          scores: {},
          weightedScore: 4,
          segments: [{ id: "c1-s0", text: "answer" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s)!;
    expect(md).not.toContain("## Attachments");
  });
});

describe("buildExportMarkdown — hybrid floor disclosure & binary evidence", () => {
  it("renders a floored rankValue with the '*' floor marker", () => {
    const s: StudioState = {
      ...baseState,
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 0.8, // floored: rankScore 1.0, rankValue 0.8
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s)!;
    expect(md).toContain("M1 — 1.0*/5");
  });

  it("renders the non-floored rankValue normally", () => {
    const s: StudioState = {
      ...baseState,
      candidates: [
        {
          id: "c1",
          model: "M1",
          provider: "P1",
          providerId: "openrouter",
          slug: "a/b",
          accent: "indigo",
          strategy: "s",
          summary: "sum",
          scores: {},
          weightedScore: 4.5,
          segments: [{ id: "s1", text: "answer one" }],
          status: "done",
        },
      ],
    };
    const md = buildExportMarkdown(s)!;
    expect(md).toContain("M1 — 4.5/5");
  });
});
