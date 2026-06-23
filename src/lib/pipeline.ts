// =============================================================================
// Pipeline orchestration helpers — prompt construction, fanout planning, parsing
//
// Phase 5 cleanup: the focused product runs ONE strategy (multi-model parallel
// fanout), so buildFanoutJobs no longer takes a strategy argument and the
// fast/multi-candidate branches are gone. The Frankenstein surface (snippet
// highlighting, blueprints, selections) is also removed — fusion honors the
// rubric and the synthesizer's judgment only (PRODUCT.md §5).
// =============================================================================

import type { ChatMessage } from "./openrouter";
import { extractJson } from "./openrouter";
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
  candidates: Candidate[]
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
    `Use the candidate letter labels (A, B, C, ...) for "source" and "label".`;
  const user =
    `User task:\n${prompt}\n\nRubric:\n${rubricText(rubric)}\n\nCandidates:\n${labelled}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
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

/** Top-K candidates to feed the fuser (matches LLM-Blender's recommendation). */
const FUSION_TOP_K = 3;

/** Minimum score spread required to add a priority instruction to the fuser.
 *  When scores are clustered within this threshold, the candidates are treated
 *  as comparable quality and no ordering bias is applied. */
const FUSION_SPREAD_THRESHOLD = 0.5;

export function fusionMessages(opts: {
  prompt: string;
  rubric: RubricCriterion[];
  candidates: Candidate[];
  /** Judge scores by candidate id. When present, only the top-K candidates
   *  are sent to the fuser, ordered by descending score. The fuser never sees
   *  the raw numbers — only the ordering and a qualitative priority instruction
   *  (reward-hacking defense). */
  scores?: Record<string, number>;
}): ChatMessage[] {
  let ranked: Candidate[];

  if (opts.scores && Object.keys(opts.scores).length > 0) {
    // Sort by score descending, take top-K.
    ranked = [...opts.candidates]
      .sort((a, b) => (opts.scores![b.id] ?? 0) - (opts.scores![a.id] ?? 0))
      .slice(0, FUSION_TOP_K);
  } else {
    ranked = opts.candidates;
  }

  // Minimum-spread guard: if scores are clustered, don't mislead the fuser
  // with a "Candidate A is strongest" instruction — they're comparable.
  let hasSpread = false;
  if (opts.scores) {
    const scores = ranked.map((c) => opts.scores![c.id] ?? 0);
    const spread = Math.max(...scores) - Math.min(...scores);
    hasSpread = spread >= FUSION_SPREAD_THRESHOLD;
  }

  // Present candidates in descending-score order as "Candidate A / B / C"
  // WITHOUT raw weights (reward-hacking defense).
  const sources = ranked
    .map(
      (c, i) =>
        `### Candidate ${LETTERS[i]} — ${c.model}\n${candidateFullText(c)}`
    )
    .join("\n\n");

  const priorityInstruction = hasSpread
    ? `The candidates above are ordered by quality (Candidate A is strongest). ` +
      `Build your answer primarily from Candidate A. Incorporate material from ` +
      `later candidates only when it adds something Candidate A lacks.\n\n`
    : `The candidates above are of comparable quality. ` +
      `Synthesize freely across all of them.\n\n`;

  const system =
    `You are a senior synthesizer. Merge the strongest material from multiple ` +
    `candidate answers into a single, coherent, production-grade final answer. ` +
    `Remove redundancy and resolve contradictions sensibly. ` +
    `Honor the user's rubric. Return the final answer in clean Markdown.`;
  const user =
    `User task:\n${opts.prompt}\n\nRubric:\n${rubricText(opts.rubric)}\n\n` +
    priorityInstruction +
    `Candidate answers:\n${sources}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
