import type { CriticRef, ProviderId } from "./lib/providers/types";
// =============================================================================
// RSemble AI — Core domain types and seed state
//
// See PRODUCT.md (source of truth) and UI.md (interaction spec). This module
// holds ONLY the domain model + constants + seeds. The state engine (reducer)
// lives in studio-engine.ts.
// =============================================================================

// --- Finish modes ------------------------------------------------------------
// The sole per-task finish switch. Chosen per run in the header; shown only in
// Compare (spec §5.2).
export type Mode = "rank" | "fuse";

export interface CandidateSegment {
  id: string;
  text: string;
}

export type CandidateStatus = "pending" | "done" | "error";

export interface Candidate {
  id: string;
  model: string;
  provider: string;
  /** Provider identity — needed for provider-scoped telemetry, history, retry. */
  providerId: ProviderId;
  slug: string;
  accent: string;
  strategy: string;
  summary: string;
  scores: Record<string, number>;
  weightedScore: number;
  segments: CandidateSegment[];
  status: CandidateStatus;
  errorMessage?: string;
  /** Accumulated streaming text during generation (fanout). Empty once segments
   *  are set on completion — read this for live display while status === "pending". */
  streamingText?: string;
  startedAt?: number;
  finishedAt?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface ModelSlot {
  id: string;
  providerId: ProviderId;
  provider: string;
  model: string;
  /** Provider-native model id / slug. */
  slug: string;
  enabled: boolean;
}

export interface ScorecardRow {
  model: string;
  avgScore: number;
  avgCost: number;
  avgLatency: number;
  bestUsedAs: string;
  trend: "up" | "down" | "flat";
}

export interface AuditEntry {
  id: string;
  time: string;
  message: string;
}

export interface ConsensusBreakdown {
  consensus: string[];
  contradictions: string[];
  uniqueInsights: { source: string; insight: string }[];
}

// ---- Judge explainability (blind evaluation) ----------------------------------
// See docs/specs/judge-explainability/judge-explainability-spec.md and
// DECISIONS.md #6. The judge never sees RSemble-supplied model/provider identity;
// the blind label map is resolved only after a valid judge result is parsed.

/** A candidate stripped of all RSemble-supplied identity for blind judging. */
export interface BlindCandidate {
  /** Blind label seen by the judge, e.g. "A" (rendered as "Candidate A"). */
  label: string;
  /** Internal candidate ID — retained locally, never sent to the judge. */
  candidateId: string;
  /** The candidate's answer text, passed unchanged. */
  content: string;
}

/** One weakness the judge says materially lowered the score. */
export interface JudgeDeduction {
  severity: "minor" | "major";
  reason: string;
}

/** Per-criterion judge result, resolved to the rubric's display label after parsing. */
export interface JudgeCriterionScore {
  criterionId: string;
  label: string;
  score: number;
  rationale: string;
}

/** Structured score explanation for one candidate. `candidateId` is resolved; */
export interface CandidateEvaluation {
  candidateId: string;
  /** Judge-time blind label — identity at judge time, not rank order. */
  blindLabel: string;
  overallScore: number;
  position: string;
  /** Concise decision evidence — explicitly not chain-of-thought. */
  rationale: string;
  strengths: string[];
  deductions: JudgeDeduction[];
  missedRequirements: string[];
  criterionScores: JudgeCriterionScore[];
}

/** Why two materially similar positions received different scores. */
export interface JudgeComparison {
  candidateIds: [string, string];
  blindLabels: [string, string];
  reason: string;
}

/** The current run's resolved judge report — the audit trail for every score. */
export interface JudgeReport {
  /** Judge-time label → internal candidate ID, in label order. */
  labelMap: Array<{ label: string; candidateId: string }>;
  /** Evaluations keyed by resolved candidate ID. */
  evaluationsById: Record<string, CandidateEvaluation>;
  comparisons: JudgeComparison[];
}

/** Accent keys cycled across live candidates for visual distinction. */
export const CANDIDATE_ACCENTS = ["indigo", "emerald", "violet", "amber", "sky", "rose", "teal"];

export type BrandIconKey = "glm" | "minimax" | "deepseek" | "generic";

export interface BrandAsset {
  brandColor: string;
  icon: BrandIconKey;
}

export const BRAND_MAP: Record<string, BrandAsset> = {
  "z-ai": { brandColor: "#7c5cff", icon: "glm" },
  glm: { brandColor: "#7c5cff", icon: "glm" },
  minimax: { brandColor: "#d946ef", icon: "minimax" },
  deepseek: { brandColor: "#3b82f6", icon: "deepseek" },
  openai: { brandColor: "#0f9d7e", icon: "generic" },
  gpt: { brandColor: "#0f9d7e", icon: "generic" },
  google: { brandColor: "#4f8ef7", icon: "generic" },
  gemini: { brandColor: "#4f8ef7", icon: "generic" },
};

export const BRAND_DEFAULT: BrandAsset = { brandColor: "#46586f", icon: "generic" };

export function brandForSlug(slug: string): BrandAsset {
  const vendor = (slug.includes("/") ? slug.slice(0, slug.indexOf("/")) : slug.split("-")[0]).toLowerCase();
  return BRAND_MAP[vendor] ?? BRAND_DEFAULT;
}

/**
 * Default judge / synthesizer model slug. Used for BOTH the Judge stage (Rank)
 * and the Fusion stage (Fuse) — `state.criticModel` is user-configurable in the
 * Command pane, so this is only the starting value on a fresh load.
 */
export const DEFAULT_CRITIC_SLUG = "z-ai/glm-5.2";
export const DEFAULT_CRITIC_REF: CriticRef = {
  providerId: "openrouter",
  model: "z-ai/glm-5.2",
};

export const SYSTEM_PROMPT_DEFAULT =
  "You are a helpful, rigorous assistant. Produce clear, well-structured answers. " +
  "Prefer explicit reasoning, concrete examples, and clearly labeled assumptions " +
  "over vague prose.";

// Candidates are generated live from the model fanout, so there are no seeds.

export const SEED_SLOTS: ModelSlot[] = [
  { id: "slot-1", providerId: "openrouter", provider: "Z-AI", model: "GLM 5.2", slug: "z-ai/glm-5.2", enabled: true },
  { id: "slot-2", providerId: "chatgpt-codex", provider: "ChatGPT", model: "GPT-5.6 Sol", slug: "gpt-5.6-sol", enabled: false },
  { id: "slot-3", providerId: "openrouter", provider: "DeepSeek", model: "DeepSeek V4 Flash", slug: "deepseek/deepseek-v4-flash", enabled: true },
];

// Historical scorecard rows accumulate from real runs; empty on a fresh start.
export const SEED_SCORECARD: ScorecardRow[] = [];

export const INITIAL_PROMPT = "";

/**
 * Initial example index. `-1` means no curated example has been loaded yet, so
 * the first `LOAD_EXAMPLE` action fills the first example (index 0). See
 * `nextExampleIndex` in lib/test-cases.ts.
 */
export const INITIAL_EXAMPLE_INDEX = -1;

export const SCORE_STORAGE_KEY = "rsemble.qualityScores.v1";
