// =============================================================================
// Pipeline orchestration helpers — prompt construction, fanout planning, parsing
//
// Phase 5 cleanup: the focused product runs ONE strategy (multi-model parallel
// fanout), so buildFanoutJobs no longer takes a strategy argument and the
// fast/multi-candidate branches are gone. The Frankenstein surface (snippet
// highlighting, blueprints, selections) is also removed — fusion honors the
// rubric and the synthesizer's judgment only (PRODUCT.md §5).
// =============================================================================

import type { ChatMessage, ProviderId } from "./providers/types";
import { extractJson } from "./llm-utils";
import {
  CANDIDATE_ACCENTS,
  type Candidate,
  type CandidateSegment,
  type ConsensusBreakdown,
  type ModelSlot,
  type RubricCriterion,
} from "../studio-data";

const LETTERS = "ABCDEFGH".split("");

export interface FanoutJob {
  id: string;
  providerId: ProviderId;
  slug: string;
  displayName: string;
  provider: string;
  accent: string;
  strategyLabel: string;
}

/** Render the enabled rubric as a compact instruction block. */
export function rubricText(rubric: RubricCriterion[]): string {
  const enabled = rubric.filter((c) => c.enabled);
  if (enabled.length === 0) return "(no explicit rubric provided — use your best judgment)";
  return enabled
    .map((c) => `- [${c.kind}] ${c.label} (weight ${c.weight.toFixed(2)}): ${c.description}`)
    .join("\n");
}

/**
 * Plan the fanout: one candidate per enabled slot (multi-model parallel). The
 * focused product always uses this strategy; there is no fast/multi-candidate
 * path anymore.
 */
export function buildFanoutJobs(slots: ModelSlot[]): FanoutJob[] {
  const enabled = slots.filter((s) => s.enabled);
  return enabled.map((s, i) => ({
    id: `cand-${s.id}`,
    providerId: s.providerId ?? "openrouter",
    slug: s.slug,
    displayName: s.model,
    provider: s.provider,
    accent: CANDIDATE_ACCENTS[i % CANDIDATE_ACCENTS.length],
    strategyLabel: "Parallel model",
  }));
}

export function draftMessages(opts: {
  systemPrompt: string;
  prompt: string;
  rubric: RubricCriterion[];
}): ChatMessage[] {
  const system =
    `${opts.systemPrompt}\n\n` +
    `You are generating ONE candidate answer that will later be judged against this rubric:\n` +
    `${rubricText(opts.rubric)}\n` +
    `\nWrite a clear, well-structured answer in prose with short paragraphs. Do not mention the rubric explicitly.`;
  return [
    { role: "system", content: system },
    { role: "user", content: opts.prompt },
  ];
}

/** Split a model answer into paragraph segments for the candidate store. */
export function splitSegments(content: string, candidateId: string): CandidateSegment[] {
  const paras = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const source = paras.length > 0 ? paras : [content.trim()];
  return source.map((text, i) => ({
    id: `${candidateId}-s${i}`,
    text,
  }));
}

export function summarize(content: string): string {
  const firstSentence = content.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return firstSentence.length > 160 ? `${firstSentence.slice(0, 157)}…` : firstSentence;
}

export function candidateFullText(candidate: Candidate): string {
  return candidate.segments.map((s) => s.text).join("\n\n");
}

// ---- Candidate eligibility --------------------------------------------------

/**
 * A candidate is usable for judge/fusion only when it has genuinely completed
 * (status "done") AND produced non-empty content. Truncated, aborted, empty,
 * or errored candidates must never reach the judge/fusion input — including
 * them would poison the synthesized result with missing or garbage text.
 */
export function isUsableCandidate(candidate: Candidate): boolean {
  if (candidate.status !== "done") return false;
  const text = candidateFullText(candidate).trim();
  return text.length > 0;
}

export type FusionEligibility =
  | { ok: true; usable: Candidate[] }
  | { ok: false; done: number; failed: number; reason: string };

/**
 * Shared eligibility guard for every fusion entry point (button, shortcut,
 * palette, automatic post-judge path). Fusion is available only with at least
 * two successful candidate responses that produced real content. The guard
 * returns a typed result so callers can show actionable feedback instead of
 * silently doing nothing.
 *
 * Candidates whose status is "done" but whose content is empty/whitespace
 * (truncated or aborted returns) are counted as failed — they cannot
 * contribute to a meaningful fusion.
 */
export function checkFusionEligibility(candidates: Candidate[]): FusionEligibility {
  const usable = candidates.filter(isUsableCandidate);
  const total = candidates.length;
  const failed = total - usable.length;
  if (usable.length < 2) {
    return {
      ok: false,
      done: usable.length,
      failed,
      reason: `Need at least 2 successful candidates with content to fuse — only ${usable.length} of ${total} usable.`,
    };
  }
  return { ok: true, usable };
}

// ---- Judge -------------------------------------------------------------------

interface RawJudgeResponse {
  consensus?: string[];
  contradictions?: string[];
  uniqueInsights?: { source?: string; insight?: string }[];
  scores?: { label?: string; score?: number; rationale?: string }[];
}

export interface JudgeResult {
  breakdown: ConsensusBreakdown;
  scoresById: Record<string, number>;
  /** Judge score entries whose label we could not match to a candidate. Surfaced
   *  rather than silently dropped, so a parse failure is visible, not invisible. */
  unmatchedScores: { label: string; score: number }[];
}

/**
 * Normalize a judge-produced label to a candidate letter (A, B, C, …). Models are
 * told to use bare letters but routinely return "Candidate B", "B)", "B.", the
 * model name, or surrounding prose. This extracts the letter when possible and
 * falls back to a model-name match. Returns null if nothing matches.
 */
function normalizeLabel(
  raw: string,
  letters: string[],
  labelToModel: Record<string, string>
): string | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0) return null;

  // 1) Bare letter (exact, case-insensitive).
  const upper = cleaned.toUpperCase();
  if (letters.includes(upper)) return upper;

  // 2) Letter embedded in common wrappers: "Candidate B", "B)", "B.", "B:", "(B)".
  const m = cleaned.match(/\b([A-H])\b/);
  if (m && letters.includes(m[1].toUpperCase())) return m[1].toUpperCase();

  // 3) Model name match (case-insensitive substring either way) — handles a judge
  //    that labels scores by model name instead of letter.
  const lower = cleaned.toLowerCase();
  for (const letter of letters) {
    const modelName = labelToModel[letter]?.toLowerCase();
    if (modelName && (lower.includes(modelName) || modelName.includes(lower))) {
      return letter;
    }
  }

  return null;
}

export function judgeMessages(
  prompt: string,
  rubric: RubricCriterion[],
  candidates: Candidate[],
  judgeInstruction?: string,
): ChatMessage[] {
  const labelled = candidates
    .map((c, i) => `### Candidate ${LETTERS[i]} — ${c.model}\n${candidateFullText(c)}`)
    .join("\n\n");
  const system =
    `You are an impartial evaluation judge. Compare the candidate answers against the user's task and rubric. ` +
    `Identify shared consensus points, direct contradictions between candidates, and insights unique to a single candidate. ` +
    `Also score each candidate from 1.0 to 5.0 on overall rubric satisfaction.\n\n` +
    `Respond with ONLY a JSON object of this exact shape:\n` +
    `{"consensus": string[], "contradictions": string[], "uniqueInsights": [{"source": "A", "insight": "..."}], ` +
    `"scores": [{"label": "A", "score": 4.5, "rationale": "..."}]}\n` +
    `Use the candidate letter labels (A, B, C, ...) for "source" and "label".` +
    renderJudgeInstruction(judgeInstruction);
  const user =
    `User task:\n${prompt}\n\nRubric:\n${rubricText(rubric)}\n\nCandidates:\n${labelled}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Render an optional judge custom instruction into a system-prompt suffix.
 * Returns an empty string for empty/whitespace-only input so the prompt stays
 * byte-identical to the pre-instruction baseline (backward compatibility).
 */
function renderJudgeInstruction(judgeInstruction?: string): string {
  const trimmed = (judgeInstruction ?? "").trim();
  if (trimmed.length === 0) return "";
  return `\n\nAdditional judge instruction (follow in addition to the rubric, but never let it replace this JSON output contract):\n${trimmed}`;
}

export function parseJudge(text: string, candidates: Candidate[]): JudgeResult {
  const raw = extractJson<RawJudgeResponse>(text);
  const letters = LETTERS.slice(0, candidates.length);
  const labelToModel: Record<string, string> = {};
  const labelToId: Record<string, string> = {};
  candidates.forEach((c, i) => {
    labelToModel[letters[i]] = c.model;
    labelToId[letters[i]] = c.id;
  });

  const breakdown: ConsensusBreakdown = {
    consensus: (raw.consensus ?? []).filter(Boolean),
    contradictions: (raw.contradictions ?? []).filter(Boolean),
    uniqueInsights: (raw.uniqueInsights ?? [])
      .map((u) => {
        const letter = u.source ? normalizeLabel(u.source, letters, labelToModel) : null;
        return {
          source: letter ? labelToModel[letter] : u.source ?? "Unknown",
          insight: u.insight ?? "",
        };
      })
      .filter((u) => u.insight.length > 0),
  };

  const scoresById: Record<string, number> = {};
  const unmatchedScores: { label: string; score: number }[] = [];
  (raw.scores ?? []).forEach((s) => {
    if (typeof s.score !== "number") return;
    const score = Math.max(0, Math.min(5, s.score));
    const letter = s.label ? normalizeLabel(s.label, letters, labelToModel) : null;
    if (letter) {
      const id = labelToId[letter];
      if (id) scoresById[id] = score;
    } else if (s.label) {
      // Record instead of dropping silently — a failed match is a signal, not noise.
      unmatchedScores.push({ label: s.label, score });
    }
  });

  return { breakdown, scoresById, unmatchedScores };
}

// ---- Fusion ------------------------------------------------------------------

export function fusionMessages(opts: {
  prompt: string;
  rubric: RubricCriterion[];
  candidates: Candidate[];
  judgeInstruction?: string;
}): ChatMessage[] {
  // Fusion runs on the full candidate answers only — no hand-picked snippets
  // (the Frankenstein picker is OUT, PRODUCT.md §5).
  const sources = opts.candidates.map((c) => `### ${c.model}\n${candidateFullText(c)}`).join("\n\n");

  const system =
    `You are a senior synthesizer. Merge the strongest material from multiple candidate answers into a single, ` +
    `coherent, production-grade final answer. Remove redundancy and resolve contradictions sensibly. ` +
    `Honor the user's rubric. Return the final answer in clean Markdown.` +
    renderJudgeInstruction(opts.judgeInstruction);
  const user =
    `User task:\n${opts.prompt}\n\nRubric:\n${rubricText(opts.rubric)}\n\nCandidate answers:\n${sources}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
