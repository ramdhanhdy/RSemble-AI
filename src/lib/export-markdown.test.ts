import { describe, expect, it } from "vitest";
import { buildExportMarkdown } from "./export-markdown";
import type { StudioState } from "../studio-engine";

const baseState: StudioState = {
  mode: "rank",
  prompt: "Write a haiku",
  exampleIndex: -1,
  rubric: [],
  slots: [],
  temperature: 0.4,
  systemPrompt: "",
  critic: { providerId: "openrouter", model: "x" },
  judgeInstruction: "",
  candidates: [],
  running: false,
  models: [],
  judgeStatus: "idle",
  judgeError: null,
  consensus: null,
  fusionStatus: "idle",
  fusionError: null,
  fusedText: null,
  insufficient: null,
  aborted: false,
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
