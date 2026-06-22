// =============================================================================
// RSemble AI — Core domain types and seed state
//
// See PRODUCT.md (source of truth) and UI.md (interaction spec). This module
// holds ONLY the domain model + constants + seeds. The state engine (reducer)
// lives in studio-engine.ts.
// =============================================================================

// --- Finish modes ------------------------------------------------------------
// The sole switch in the whole product. Chosen per run in the header.
export type Mode = "rank" | "fuse";

export type RubricKind = "goal" | "metric" | "gap";

export interface RubricCriterion {
  id: string;
  label: string;
  description: string;
  kind: RubricKind;
  enabled: boolean;
  weight: number;
}

export interface CandidateSegment {
  id: string;
  text: string;
}

export type CandidateStatus = "pending" | "done" | "error";

export interface Candidate {
  id: string;
  model: string;
  provider: string;
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
}

export interface ModelSlot {
  id: string;
  provider: string;
  model: string;
  /** OpenRouter model slug, e.g. "anthropic/claude-3.7-sonnet". */
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

/** Accent keys cycled across live candidates for visual distinction. */
export const CANDIDATE_ACCENTS = ["indigo", "emerald", "violet", "amber", "sky", "rose", "teal"];

/**
 * Default judge / synthesizer model slug. Used for BOTH the Judge stage (Rank)
 * and the Fusion stage (Fuse) — `state.criticModel` is user-configurable in the
 * Command pane, so this is only the starting value on a fresh load.
 */
export const DEFAULT_CRITIC_SLUG = "z-ai/glm-5.2";

export const SYSTEM_PROMPT_DEFAULT =
  "You are a helpful, rigorous assistant. Produce clear, well-structured answers. " +
  "Prefer explicit reasoning, concrete examples, and clearly labeled assumptions " +
  "over vague prose.";

// Candidates are generated live from the model fanout, so there are no seeds.

export const SEED_RUBRIC: RubricCriterion[] = [];

export const SEED_SLOTS: ModelSlot[] = [
  { id: "slot-1", provider: "Z-AI", model: "GLM 5.2", slug: "z-ai/glm-5.2", enabled: true },
  { id: "slot-2", provider: "MiniMax", model: "MiniMax M3", slug: "minimax/minimax-m3", enabled: true },
  { id: "slot-3", provider: "DeepSeek", model: "DeepSeek V4 Pro", slug: "deepseek/deepseek-v4-pro", enabled: true },
];

// Historical scorecard rows accumulate from real runs; empty on a fresh start.
export const SEED_SCORECARD: ScorecardRow[] = [];

export const INITIAL_PROMPT = "";

export const SCORE_STORAGE_KEY = "rsemble.qualityScores.v1";
