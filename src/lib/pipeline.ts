// =============================================================================
// Pipeline orchestration helpers — prompt construction, fanout planning, parsing
//
// Phase 5 cleanup: the focused product runs ONE strategy (multi-model parallel
// fanout), so buildFanoutJobs no longer takes a strategy argument and the
// fast/multi-candidate branches are gone. The Frankenstein surface (snippet
// highlighting, blueprints, selections) is also removed — fusion honors the
// rubric and the synthesizer's judgment only (PRODUCT.md §5).
// =============================================================================

import type { ChatMessage, ContentPart, ProviderId } from "./providers/types";
import { extractJson } from "./llm-utils";
import { getModelCapabilities, type ModelCapabilities } from "./providers/capabilities";
import {
  attachmentSystemSentence,
  hasNativeMedia,
  renderAttachmentBlocks,
  selectNativeParts,
  withheldMediaSentence,
} from "./attachments/render";
import type { Attachment } from "./attachments/types";
import {
  CANDIDATE_ACCENTS,
  type BlindCandidate,
  type Candidate,
  type CandidateEvaluation,
  type CandidateSegment,
  type ConsensusBreakdown,
  type JudgeComparison,
  type JudgeCriterionScore,
  type JudgeDeduction,
  type JudgeReport,
  type ModelSlot,
} from "../studio-data";
import type {
  EvaluationCriterion,
  EvaluationProfileSnapshot,
} from "./evaluations/evaluation-types";
import { evaluationCriteriaText } from "./evaluations/evaluation-profile";
import { FUSION_RECIPE_BLIND_RAW_V1, renderRecipeMessages } from "./evaluations/fusion-recipes";

/** Generate an unbounded spreadsheet-style blind label: A..Z, AA..AZ, BA... */
function blindLabelForIndex(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export interface FanoutJob {
  id: string;
  providerId: ProviderId;
  slug: string;
  displayName: string;
  provider: string;
  accent: string;
  strategyLabel: string;
}

/**
 * Render the evaluation criteria for the judge-facing block. `withIds` prefixes
 * each line with the stable criterion ID so the judge can key criterionScores
 * by criterion ID (spec §9.3).
 */
export function evaluationText(
  profile: EvaluationProfileSnapshot | null,
  opts?: { withIds?: boolean },
): string {
  if (!profile || profile.criteria.length === 0) {
    return "(no explicit criteria provided — use your best holistic judgment)";
  }
  return evaluationCriteriaText(profile, opts);
}

/**
 * Immutable candidate ID for a model slot. This is the SINGLE source of truth
 * for run-level candidate identity — executor jobs, React candidate state,
 * Judge blind-label resolution, and persisted run records all derive the ID
 * here so evidence always joins on the same key.
 */
export function candidateIdForSlot(slotId: string): string {
  return `cand-${slotId}`;
}

/**
 * Plan the fanout: one candidate per enabled slot (multi-model parallel). The
 * focused product always uses this strategy; there is no fast/multi-candidate
 * path anymore.
 */
export function buildFanoutJobs(slots: ModelSlot[]): FanoutJob[] {
  const enabled = slots.filter((s) => s.enabled);
  return enabled.map((s, i) => ({
    id: candidateIdForSlot(s.id),
    providerId: s.providerId ?? "openrouter",
    slug: s.slug,
    displayName: s.model,
    provider: s.provider,
    accent: CANDIDATE_ACCENTS[i % CANDIDATE_ACCENTS.length],
    strategyLabel: "Parallel model",
  }));
}

/**
 * Candidate-generation messages (spec §6.1, plan 7.6.2).
 *
 * Zero attachments ⇒ byte-identical to the pre-attachments output. With
 * attachments, the user message becomes a ContentPart[]: the prompt, one
 * delimited text block per extracted-text attachment (§6.3), then native
 * image/file parts in UI order — gated per slot by `capabilities`.
 *
 * An image a slot cannot consume is a gate failure, never a silent drop
 * (spec §5.1): the eligibility check disables such slots before the run.
 */
export function draftMessages(opts: {
  systemPrompt: string;
  prompt: string;
  attachments?: Attachment[];
  capabilities?: ModelCapabilities;
}): ChatMessage[] {
  const attachments = opts.attachments ?? [];
  if (attachments.length === 0) {
    return [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.prompt },
    ];
  }

  const caps = opts.capabilities ?? { image: false, pdf: false };
  if (attachments.some((a) => a.kind === "image" && !caps.image)) {
    throw new Error(
      "draftMessages: an image attachment cannot reach a slot without image capability — the eligibility gate must prevent this.",
    );
  }

  const textBlocks = renderAttachmentBlocks(
    // One channel per attachment for candidates: a pdf delivered natively
    // does not also carry its extracted text (spec §6.1, §5.1 degradation).
    attachments.filter((a) => !(a.kind === "pdf" && caps.pdf && typeof a.data === "string")),
  );
  const native = selectNativeParts(attachments, caps);
  const user: ContentPart[] = [{ type: "text", text: opts.prompt }];
  if (textBlocks.length > 0) user.push({ type: "text", text: textBlocks });
  for (const part of native) {
    user.push(
      part.type === "image"
        ? { type: "image", mimeType: part.mimeType, data: part.data }
        : { type: "file", mimeType: part.mimeType, data: part.data, filename: part.filename },
    );
  }

  return [
    {
      role: "system",
      content: `${opts.systemPrompt}\n\n${attachmentSystemSentence(attachments.length)}`,
    },
    { role: "user", content: user },
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
  const firstSentence =
    content
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? "";
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
  { ok: true; usable: Candidate[] } | { ok: false; done: number; failed: number; reason: string };

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

// ---- Attachment eligibility (spec §5.1, plan 7.6.5) -------------------------

export type AttachmentEligibility =
  { ok: true } | { blocked: string } | { autoDisable: string[]; reason: string };

/**
 * Gate a fanout against the task's attachments (spec §5.1). Only IMAGE
 * attachments can block a run — PDFs, docs, and text degrade to the
 * extracted-text channel. When ≥2 enabled slots can read images, the
 * incapable slots are auto-disabled and the run proceeds; with <2 capable
 * slots the run is blocked with the exact §5.1 message (never a comparison
 * where a model answered blind).
 */
export function checkAttachmentEligibility(
  slots: ModelSlot[],
  attachments: Attachment[],
): AttachmentEligibility {
  if (!attachments.some((a) => a.kind === "image")) return { ok: true };

  const enabled = slots.filter((s) => s.enabled);
  const capable = enabled.filter((s) => getModelCapabilities(s.providerId, s.slug).image);
  if (capable.length >= 2) {
    const disable = enabled
      .filter((s) => !getModelCapabilities(s.providerId, s.slug).image)
      .map((s) => s.id);
    if (disable.length === 0) return { ok: true };
    return {
      autoDisable: disable,
      reason: `${capable.length} of ${enabled.length} selected models can read images; the rest are disabled for this run.`,
    };
  }
  return {
    blocked: `Attach-incompatible: only ${capable.length} of ${enabled.length} selected models can read images. Swap a model or remove the image.`,
  };
}

// ---- Blind evaluation --------------------------------------------------------

export interface BlindCandidateSet {
  /** Judge-facing candidates in label order: label + id + content only. */
  candidates: BlindCandidate[];
  /** Judge-time label → internal candidate ID, in label order. */
  labelMap: Array<{ label: string; candidateId: string }>;
}

/**
 * Build the blind packet for one judge run: eligible candidates are shuffled
 * with the injected random source, then assigned labels A, B, C, … in shuffled
 * order. Shuffling BEFORE labelling reduces positional bias (DECISIONS.md #6).
 *
 * The packet carries only { label, candidateId, content } — no model names,
 * providers, slugs, order, latency, tokens, or cost. The input candidates are
 * never mutated, and the label map is constructed exactly once per run so
 * labels stay stable regardless of any later score sorting.
 *
 * Spreadsheet-style labels are generated for the full roster, so a label is
 * never silently reused and there is no fixed candidate-count ceiling.
 */
export function createBlindCandidateSet(
  candidates: Candidate[],
  random: () => number = Math.random,
): BlindCandidateSet {
  if (candidates.length === 0) {
    throw new Error("Cannot judge blindly: no eligible candidates to label.");
  }
  // Fisher–Yates over indices — original array untouched.
  const order = candidates.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const blind: BlindCandidate[] = order.map((candIdx, labelIdx) => ({
    label: blindLabelForIndex(labelIdx),
    candidateId: candidates[candIdx].id,
    content: candidateFullText(candidates[candIdx]),
  }));
  return {
    candidates: blind,
    labelMap: blind.map(({ label, candidateId }) => ({ label, candidateId })),
  };
}

// ---- Judge -------------------------------------------------------------------

interface RawJudgeResponse {
  consensus?: unknown;
  contradictions?: unknown;
  uniqueInsights?: unknown;
  evaluations?: unknown;
  comparisons?: unknown;
}

export interface JudgeResult {
  breakdown: ConsensusBreakdown;
  scoresById: Record<string, number>;
  /** The resolved blind report: label map, per-candidate explanations, and
   *  same-conclusion comparisons. Every accepted score has its explanation. */
  report: JudgeReport;
}

/**
 * Normalize a judge-produced label (A, B, …, Z, AA, AB, …). Tolerates the
 * bare label and common wrappers ("Candidate AA", "AA)", "AA.", "(AA)").
 * There is deliberately NO model-name fallback: a properly blinded judge does
 * not know model identities, so a model name is never a valid score identifier
 * (spec §7). Returns null when nothing matches.
 */
function normalizeBlindLabel(raw: string, letters: string[]): string | null {
  const cleaned = raw.trim();
  if (cleaned.length === 0) return null;

  // 1) Bare letter (exact, case-insensitive).
  const upper = cleaned.toUpperCase();
  if (letters.includes(upper)) return upper;

  // 2) Label embedded in common wrappers such as "Candidate AA" or "(AA)".
  const m = cleaned.match(/^(?:candidate\s+)?[([]?([A-Z]+)[\])\s.:-]*$/i);
  if (m && letters.includes(m[1].toUpperCase())) return m[1].toUpperCase();

  return null;
}

export function judgeMessages(
  prompt: string,
  profile: EvaluationProfileSnapshot | null,
  blindCandidates: BlindCandidate[],
  judgeInstruction?: string,
  attachments?: Attachment[],
  includeNativeMedia?: boolean,
  criticCapabilities?: ModelCapabilities,
): ChatMessage[] {
  const atts = attachments ?? [];
  // Bare blind headings — no model names, providers, slugs, or run metadata
  // (DECISIONS.md #6). Candidate answer text passes through unchanged.
  const labelled = blindCandidates
    .map((c) => `### Candidate ${c.label}\n${c.content}`)
    .join("\n\n");
  const hasCriteria = profile !== null && profile.criteria.length > 0;

  // The custom instruction is UNTRUSTED DATA. It is placed BEFORE the
  // non-negotiable JSON output contract and explicitly delimited, so a
  // prompt-injection attempt embedded in it cannot append itself after
  // the contract and override the output format. The JSON schema and
  // JSON-only requirement always come last and are unconditional.
  const instructionBlock = renderJudgeInstruction(judgeInstruction);

  // Spec §6.2: when native media is withheld from the critic, say so — the
  // judge must not penalize answers it cannot verify. Extracted-text blocks
  // are always sent, so only withheld IMAGE delivery (no text substitute)
  // triggers the line; a PDF without native delivery still arrives as text.
  const withheld =
    hasNativeMedia(atts) &&
    (includeNativeMedia !== true ||
      !criticCapabilities ||
      atts.some((a) => a.kind === "image" && !criticCapabilities.image));
  const withheldLine = withheld ? `\n${withheldMediaSentence(atts.length)}` : "";

  const system =
    `You are an impartial evaluation judge. Compare the candidate answers against the user's task and evaluation criteria. ` +
    `The candidates are anonymized: you see only blind labels (Candidate A, Candidate B, ...) and their answer text. ` +
    `You do not know which model produced which answer — do not speculate about candidate identities.\n` +
    `Identify shared consensus points, direct contradictions between candidates, and insights unique to a single candidate.\n` +
    `For EVERY candidate, return one structured evaluation:\n` +
    `- score: overall evaluation satisfaction from 1.0 to 5.0.\n` +
    `- position: one sentence naming the candidate's main recommendation or answer.\n` +
    `- rationale: one concise sentence of decision evidence — the decisive qualities and omissions that determined the score. ` +
    `This is an evaluation summary, never chain-of-thought; do not narrate step-by-step reasoning.\n` +
    `- strengths: one or two concise strengths.\n` +
    `- deductions: weaknesses that materially lowered the score, each tagged "minor" or "major" (empty array when none).\n` +
    `- missedRequirements: task or evaluation requirements the candidate failed to address (empty array when none).\n` +
    (hasCriteria
      ? `- criterionScores: exactly one entry per evaluation criterion listed below, keyed by its criterion ID, each scored 1.0–5.0 with a concise rationale.\n`
      : `- criterionScores: an empty array — no explicit criteria are provided, so do not invent scoring dimensions.\n`) +
    `When two candidates reach materially similar conclusions or recommendations but their overall scores differ by at least 0.5, ` +
    `return one comparison per such pair explaining what created the difference (for example quantification, evidence quality, ` +
    `constraint awareness, falsifiability, feasibility, or task compliance). If no pair qualifies, return an empty comparisons array.` +
    withheldLine +
    instructionBlock +
    `\n\nRespond with ONLY a JSON object of this exact shape:\n` +
    `{"consensus": string[], "contradictions": string[], "uniqueInsights": [{"source": "A", "insight": "..."}], ` +
    `"evaluations": [{"label": "A", "score": 4.5, "position": "...", "rationale": "...", "strengths": ["..."], ` +
    `"deductions": [{"severity": "minor", "reason": "..."}], "missedRequirements": [], ` +
    `"criterionScores": [{"criterionId": "...", "score": 4.5, "rationale": "..."}]}], ` +
    `"comparisons": [{"labels": ["A", "B"], "reason": "..."}]}\n` +
    `Use the candidate blind labels (A, B, C, ...) for "source", "label", and comparison "labels". ` +
    `Output JSON and nothing else — no prose, no code fences, no commentary.`;

  // Attachment blocks sit after the task, before the criteria (spec §6.3).
  // Attachment-bearing judge messages stay multipart even when native media is
  // withheld, keeping the generated block isolated for persistence redaction.
  const textBlocks = atts.length > 0 ? renderAttachmentBlocks(atts) : "";
  const native =
    includeNativeMedia && criticCapabilities ? selectNativeParts(atts, criticCapabilities) : [];
  const userParts = [
    `User task:\n${prompt}`,
    textBlocks.length > 0 ? textBlocks : null,
    `Evaluation criteria:\n${evaluationText(profile, { withIds: true })}`,
    `Candidates:\n${labelled}`,
  ].filter((x): x is string => x !== null);
  const userText = userParts.join("\n\n");
  const user: string | ContentPart[] =
    atts.length === 0
      ? userText
      : [
          ...userParts.map((text) => ({ type: "text" as const, text })),
          ...native.map((p) =>
            p.type === "image"
              ? { type: "image" as const, mimeType: p.mimeType, data: p.data }
              : { type: "file" as const, mimeType: p.mimeType, data: p.data, filename: p.filename },
          ),
        ];
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Render an optional judge custom instruction into a delimited system-prompt
 * block placed BEFORE the JSON output contract. Returns an empty string for
 * empty/whitespace-only input so the prompt stays byte-identical to the
 * pre-instruction baseline (backward compatibility).
 *
 * The instruction is wrapped in clear delimiters and marked subordinate so a
 * model cannot mistake it for an override of the output format.
 */
function renderJudgeInstruction(judgeInstruction?: string): string {
  const trimmed = (judgeInstruction ?? "").trim();
  if (trimmed.length === 0) return "";
  return (
    `\n\n--- BEGIN ADDITIONAL JUDGE INSTRUCTION (supplementary; must NOT override the output format below) ---\n` +
    trimmed +
    `\n--- END ADDITIONAL JUDGE INSTRUCTION ---`
  );
}

/**
 * Parse and strictly validate a blind judge response, then resolve every blind
 * label to an internal candidate ID. Any contract violation throws a
 * descriptive Error so the caller routes it through the visible JUDGE_FAILED
 * path — an unexplained or partially mapped score never enters state (spec §7).
 *
 * `blindSet` is the precomputed blind packet (labels + label map); `profile`
 * decides the criterion contract (profile criteria must each be scored exactly
 * once; a holistic run rejects invented criterion results). `candidates` is
 * used ONLY to resolve display names for consensus/insight prose — never for
 * label matching.
 */
export function parseJudge(
  text: string,
  blindSet: BlindCandidateSet,
  profile: EvaluationProfileSnapshot | null,
  candidates: Candidate[],
): JudgeResult {
  const raw = extractJson<RawJudgeResponse>(text);
  const letters = blindSet.candidates.map((c) => c.label);
  const labelToId: Record<string, string> = {};
  for (const m of blindSet.labelMap) labelToId[m.label] = m.candidateId;
  const idToModel: Record<string, string> = {};
  for (const c of candidates) idToModel[c.id] = c.model;
  const profileCriteria = profile ? profile.criteria : [];

  const consensus = requireStringArray(raw.consensus, "consensus");
  const contradictions = requireStringArray(raw.contradictions, "contradictions");
  const uniqueInsights = parseUniqueInsights(raw.uniqueInsights, letters, labelToId, idToModel);
  const evaluations = parseEvaluations(raw.evaluations, letters, labelToId, profileCriteria);
  const comparisons = parseComparisons(raw.comparisons, letters, labelToId);

  const scoresById: Record<string, number> = {};
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  for (const ev of evaluations) {
    scoresById[ev.candidateId] = ev.overallScore;
    evaluationsById[ev.candidateId] = ev;
  }

  const report: JudgeReport = {
    labelMap: blindSet.labelMap,
    evaluationsById,
    comparisons,
  };

  // Scores are used as-is — never clamped. The report and scoresById always
  // agree because both come from the same validated evaluations.
  return { breakdown: { consensus, contradictions, uniqueInsights }, scoresById, report };
}

/**
 * Validate one top-level array-of-strings field. All top-level arrays are
 * required by the contract (spec §7); empty strings are dropped, non-string
 * elements are a contract violation.
 */
function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Judge output invalid: '${field}' must be an array.`);
  }
  return value
    .map((v, i) => {
      if (typeof v !== "string") {
        throw new Error(`Judge output invalid: '${field}[${i}]' must be a string.`);
      }
      return v;
    })
    .filter((v) => v.trim().length > 0);
}

/** One optional array-of-strings field: absent → [], present → validated. */
function optionalStringArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  return requireStringArray(value, field);
}

/** A score must be a finite number within the documented 1.0–5.0 range. Never clamped. */
function requireScore(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `Judge output invalid: ${where} is missing a finite numeric score (got ${JSON.stringify(value)}).`,
    );
  }
  if (value < 1.0 || value > 5.0) {
    throw new Error(
      `Judge output invalid: ${where} score ${value} is outside the documented 1.0–5.0 range.`,
    );
  }
  return value;
}

function requireNonEmptyString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Judge output invalid: ${where} must be a non-empty string.`);
  }
  return value.trim();
}

function parseUniqueInsights(
  value: unknown,
  letters: string[],
  labelToId: Record<string, string>,
  idToModel: Record<string, string>,
): ConsensusBreakdown["uniqueInsights"] {
  if (!Array.isArray(value)) {
    throw new Error("Judge output invalid: 'uniqueInsights' must be an array.");
  }
  return value.map((u, i) => {
    if (u == null || typeof u !== "object") {
      throw new Error(`Judge output invalid: 'uniqueInsights[${i}]' must be an object.`);
    }
    const entry = u as { source?: unknown; insight?: unknown };
    const insight = requireNonEmptyString(entry.insight, `uniqueInsights[${i}].insight`);
    const sourceRaw = requireNonEmptyString(entry.source, `uniqueInsights[${i}].source`);
    const letter = normalizeBlindLabel(sourceRaw, letters);
    if (!letter) {
      // A blind judge cannot cite model names or unknown labels as sources.
      throw new Error(
        `Judge output invalid: uniqueInsights[${i}] source ${JSON.stringify(entry.source)} is not a blind label (expected one of ${letters.join(", ")}).`,
      );
    }
    const id = labelToId[letter];
    return { source: idToModel[id] ?? `Candidate ${letter}`, insight };
  });
}

function parseDeductions(value: unknown, where: string): JudgeDeduction[] {
  const items = value == null ? [] : value;
  if (!Array.isArray(items)) {
    throw new Error(`Judge output invalid: ${where}.deductions must be an array.`);
  }
  return items.map((d, i) => {
    if (d == null || typeof d !== "object") {
      throw new Error(`Judge output invalid: ${where}.deductions[${i}] must be an object.`);
    }
    const entry = d as { severity?: unknown; reason?: unknown };
    if (entry.severity !== "minor" && entry.severity !== "major") {
      throw new Error(
        `Judge output invalid: ${where}.deductions[${i}].severity must be "minor" or "major" (got ${JSON.stringify(entry.severity)}).`,
      );
    }
    return {
      severity: entry.severity,
      reason: requireNonEmptyString(entry.reason, `${where}.deductions[${i}].reason`),
    };
  });
}

function parseCriterionScores(
  value: unknown,
  where: string,
  profileCriteria: EvaluationCriterion[],
): JudgeCriterionScore[] {
  const items = value == null ? [] : value;
  if (!Array.isArray(items)) {
    throw new Error(`Judge output invalid: ${where}.criterionScores must be an array.`);
  }
  const parsed = items.map((cs, i) => {
    if (cs == null || typeof cs !== "object") {
      throw new Error(`Judge output invalid: ${where}.criterionScores[${i}] must be an object.`);
    }
    const entry = cs as { criterionId?: unknown; score?: unknown; rationale?: unknown };
    const criterionId = requireNonEmptyString(
      entry.criterionId,
      `${where}.criterionScores[${i}].criterionId`,
    );
    return {
      criterionId,
      score: requireScore(entry.score, `${where}.criterionScores[${i}]`),
      rationale: requireNonEmptyString(entry.rationale, `${where}.criterionScores[${i}].rationale`),
    };
  });

  if (profileCriteria.length === 0) {
    // Holistic run: the judge must not invent hidden scoring dimensions.
    if (parsed.length > 0) {
      throw new Error(
        `Judge output invalid: ${where}.criterionScores must be empty — no criteria are defined, but ${parsed.length} criterion result(s) were returned.`,
      );
    }
    return [];
  }

  // Profile run: exactly one result per profile criterion ID.
  const seen = new Set<string>();
  const resolved: JudgeCriterionScore[] = [];
  for (const cs of parsed) {
    const criterion = profileCriteria.find((c) => c.id === cs.criterionId);
    if (!criterion) {
      throw new Error(
        `Judge output invalid: ${where}.criterionScores references unknown criterion ${JSON.stringify(cs.criterionId)}.`,
      );
    }
    if (seen.has(cs.criterionId)) {
      throw new Error(
        `Judge output invalid: ${where}.criterionScores has a duplicate result for criterion ${JSON.stringify(cs.criterionId)}.`,
      );
    }
    seen.add(cs.criterionId);
    resolved.push({
      criterionId: criterion.id,
      label: criterion.name,
      score: cs.score,
      rationale: cs.rationale,
    });
  }
  for (const criterion of profileCriteria) {
    if (!seen.has(criterion.id)) {
      throw new Error(
        `Judge output invalid: ${where}.criterionScores is missing a result for criterion ${JSON.stringify(criterion.id)}.`,
      );
    }
  }
  return resolved;
}

/**
 * Validate the evaluations array: exactly one fully explained evaluation per
 * blind candidate — no missing, duplicate, extra, or model-name labels, and
 * every score carries its structured explanation.
 */
function parseEvaluations(
  value: unknown,
  letters: string[],
  labelToId: Record<string, string>,
  profileCriteria: EvaluationCriterion[],
): CandidateEvaluation[] {
  if (!Array.isArray(value)) {
    throw new Error("Judge output invalid: 'evaluations' must be an array.");
  }
  if (value.length === 0) {
    throw new Error("Judge output invalid: 'evaluations' is empty — no candidate was scored.");
  }

  const seen = new Set<string>();
  const evaluations: CandidateEvaluation[] = [];
  for (let i = 0; i < value.length; i++) {
    const ev = value[i];
    const where = `evaluations[${i}]`;
    if (ev == null || typeof ev !== "object") {
      throw new Error(`Judge output invalid: ${where} must be an object.`);
    }
    const entry = ev as {
      label?: unknown;
      score?: unknown;
      position?: unknown;
      rationale?: unknown;
      strengths?: unknown;
      deductions?: unknown;
      missedRequirements?: unknown;
      criterionScores?: unknown;
    };
    const labelRaw = requireNonEmptyString(entry.label, `${where}.label`);
    const letter = normalizeBlindLabel(labelRaw, letters);
    if (!letter) {
      throw new Error(
        `Judge output invalid: ${where} label ${JSON.stringify(entry.label)} does not match any candidate (expected one of ${letters.join(", ")}).`,
      );
    }
    if (seen.has(letter)) {
      throw new Error(`Judge output invalid: duplicate evaluation for candidate ${letter}.`);
    }
    seen.add(letter);

    const strengths = optionalStringArray(entry.strengths, `${where}.strengths`);
    if (strengths.length === 0) {
      // Every accepted score must carry decision evidence (spec §5.3, §13.5).
      throw new Error(`Judge output invalid: ${where}.strengths must list at least one strength.`);
    }

    evaluations.push({
      candidateId: labelToId[letter],
      blindLabel: letter,
      overallScore: requireScore(entry.score, where),
      position: requireNonEmptyString(entry.position, `${where}.position`),
      rationale: requireNonEmptyString(entry.rationale, `${where}.rationale`),
      strengths,
      deductions: parseDeductions(entry.deductions, where),
      missedRequirements: optionalStringArray(
        entry.missedRequirements,
        `${where}.missedRequirements`,
      ),
      criterionScores: parseCriterionScores(entry.criterionScores, where, profileCriteria),
    });
  }

  // Every eligible candidate must have exactly one evaluation (no missing).
  for (const letter of letters) {
    if (!seen.has(letter)) {
      throw new Error(`Judge output invalid: candidate ${letter} has no evaluation.`);
    }
  }
  return evaluations;
}

function parseComparisons(
  value: unknown,
  letters: string[],
  labelToId: Record<string, string>,
): JudgeComparison[] {
  if (!Array.isArray(value)) {
    throw new Error("Judge output invalid: 'comparisons' must be an array.");
  }
  return value.map((cmp, i) => {
    const where = `comparisons[${i}]`;
    if (cmp == null || typeof cmp !== "object") {
      throw new Error(`Judge output invalid: ${where} must be an object.`);
    }
    const entry = cmp as { labels?: unknown; reason?: unknown };
    if (!Array.isArray(entry.labels) || entry.labels.length !== 2) {
      throw new Error(
        `Judge output invalid: ${where}.labels must be an array of exactly two blind labels.`,
      );
    }
    const pair = entry.labels.map((l, j) => {
      const raw = requireNonEmptyString(l, `${where}.labels[${j}]`);
      const letter = normalizeBlindLabel(raw, letters);
      if (!letter) {
        throw new Error(
          `Judge output invalid: ${where}.labels[${j}] ${JSON.stringify(l)} is not a blind label (expected one of ${letters.join(", ")}).`,
        );
      }
      return letter;
    }) as [string, string];
    if (pair[0] === pair[1]) {
      throw new Error(
        `Judge output invalid: ${where} must compare two distinct candidates (got ${pair[0]} twice).`,
      );
    }
    return {
      candidateIds: [labelToId[pair[0]], labelToId[pair[1]]],
      blindLabels: pair,
      reason: requireNonEmptyString(entry.reason, `${where}.reason`),
    };
  });
}

// ---- Fusion ------------------------------------------------------------------

/**
 * Compare's Fuse mode — runs the versioned `BlindRaw` v1 recipe (fusion-study
 * plan §8). Candidates reach the synthesizer ONLY as anonymized blind labels
 * reused from the judge stage; the old non-blind, real-model-name prompt is
 * deliberately not preserved (it is the known-weak configuration).
 */
export function fusionMessages(opts: {
  prompt: string;
  profile: EvaluationProfileSnapshot | null;
  blindCandidates: BlindCandidate[];
  judgeInstruction?: string;
  /** Task attachments for the synthesis pass (plan 7.6.4). */
  attachments?: Attachment[];
  /** Native media to the synthesizer (spec §6.2). */
  includeNativeMedia?: boolean;
  criticCapabilities?: ModelCapabilities;
}): ChatMessage[] {
  return renderRecipeMessages(FUSION_RECIPE_BLIND_RAW_V1, {
    prompt: opts.prompt,
    profile: opts.profile,
    blindCandidates: opts.blindCandidates,
    judgeReport: null,
    consensus: null,
    judgeInstruction: opts.judgeInstruction,
    attachments: opts.attachments,
    includeNativeMedia: opts.includeNativeMedia,
    criticCapabilities: opts.criticCapabilities,
  });
}
