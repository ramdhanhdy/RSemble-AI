// =============================================================================
// RSemble AI — Fusion recipe prompt templates
//
// The fusion step is a versioned, blind, rubric-flagged recipe (fusion-study
// spec §5.2, §7.1). One template per recipe family forms the ablation over what
// the synthesizer receives from the development judge:
//
//   BlindRaw        — anonymized candidate answers only
//   AnalysisFed     — + qualitative development-judge analysis
//   AnalysisScores  — + analysis + numeric per-criterion scores
//
// Invariants enforced here:
//  - BLINDNESS: candidates reach the synthesizer only as blind labels reused
//    from the judge stage; identity resolution happens after synthesis. No
//    model name, provider, or slug is ever rendered (spec §5.2 — blindness is
//    an invariant, not a variable).
//  - RUBRIC ACCESS is gated by the recipe's explicit `rubricAccess` flag, and
//    the refine-the-winner control receives rubric content IDENTICAL to the
//    fusion recipe under test (confound control, spec §7.1).
//  - VERIFICATION toggles the verify-arithmetic/flag-unconfirmable instruction.
// =============================================================================

import type { ChatMessage } from "../providers/types";
import { contentToText } from "../providers/content";
import {
  DEFAULT_CRITIC_REF,
  type BlindCandidate,
  type ConsensusBreakdown,
  type JudgeReport,
} from "../../studio-data";
import type { EvaluationProfileSnapshot } from "./evaluation-types";
import { evaluationCriteriaText } from "./evaluation-profile";
import type { FusionRecipeRef, FusionRecipeVersion } from "./fusion-study-types";

// --- Built-in versioned recipes --------------------------------------------------

/**
 * The three canonical v1 recipes. Compare's Fuse mode runs `BlindRaw` v1
 * (fusion-study plan §8: the old non-blind hardcoded prompt is deliberately
 * NOT preserved — it is the known-weak configuration).
 */
export const FUSION_RECIPE_BLIND_RAW_V1: FusionRecipeVersion = {
  id: "builtin-blind-raw",
  version: 1,
  recipeFamily: "BlindRaw",
  promptVersion: "blind-raw-v1",
  judgeAnalysisMode: "none",
  rubricAccess: true,
  verification: false,
  synthesizer: DEFAULT_CRITIC_REF,
};

export const FUSION_RECIPE_ANALYSIS_FED_V1: FusionRecipeVersion = {
  id: "builtin-analysis-fed",
  version: 1,
  recipeFamily: "AnalysisFed",
  promptVersion: "analysis-fed-v1",
  judgeAnalysisMode: "qualitative",
  rubricAccess: true,
  verification: false,
  synthesizer: DEFAULT_CRITIC_REF,
};

export const FUSION_RECIPE_ANALYSIS_SCORES_V1: FusionRecipeVersion = {
  id: "builtin-analysis-scores",
  version: 1,
  recipeFamily: "AnalysisScores",
  promptVersion: "analysis-scores-v1",
  judgeAnalysisMode: "scores",
  rubricAccess: true,
  verification: false,
  synthesizer: DEFAULT_CRITIC_REF,
};

export const BUILTIN_FUSION_RECIPES: readonly FusionRecipeVersion[] = [
  FUSION_RECIPE_BLIND_RAW_V1,
  FUSION_RECIPE_ANALYSIS_FED_V1,
  FUSION_RECIPE_ANALYSIS_SCORES_V1,
];

export function fusionRecipeRef(recipe: FusionRecipeVersion): FusionRecipeRef {
  return { id: recipe.id, version: recipe.version };
}

// --- Recipe inputs ------------------------------------------------------------------

export interface FusionSynthesisInput {
  /** The user task prompt. */
  prompt: string;
  /** Evaluation profile — rendered only when the recipe grants rubric access. */
  profile: EvaluationProfileSnapshot | null;
  /**
   * Anonymized candidates in the JUDGE'S label order. The same labels the
   * development judge used must be reused so analysis references line up.
   */
  blindCandidates: BlindCandidate[];
  /** Development-judge evidence for analysis-fed families (ignored by BlindRaw). */
  judgeReport: JudgeReport | null;
  consensus: ConsensusBreakdown | null;
  judgeInstruction?: string;
}

// --- Blindness invariant --------------------------------------------------------------

/** Identity material that must never reach the synthesizer. */
export interface CandidateIdentity {
  model: string;
  provider: string;
  slug: string;
  providerId: string;
}

/**
 * Scan synthesizer-bound messages for identity leaks. Returns every identity
 * string found — an empty result is the invariant. Asserted in tests and
 * checked by the policy runner before any provider call.
 */
export function findBlindnessViolations(
  messages: ChatMessage[],
  identities: CandidateIdentity[],
): string[] {
  const violations: string[] = [];
  const haystacks = messages.map((m) => contentToText(m.content));
  for (const identity of identities) {
    for (const [field, value] of Object.entries(identity) as Array<[keyof CandidateIdentity, string]>) {
      const needle = value.trim();
      // Slugs/provider ids are distinctive; display names shorter than 3 chars
      // would false-positive on prose and are not identifying anyway.
      if (needle.length < 3) continue;
      for (const haystack of haystacks) {
        if (haystack.includes(needle)) {
          violations.push(`${field}:${needle}`);
          break;
        }
      }
    }
  }
  return violations;
}

// --- Shared prompt sections -------------------------------------------------------------

/** The rubric section — byte-identical between fusion and the refine control. */
export function rubricSection(
  profile: EvaluationProfileSnapshot | null,
  rubricAccess: boolean,
): string {
  if (!rubricAccess) return "";
  const text =
    profile && profile.criteria.length > 0
      ? evaluationCriteriaText(profile)
      : "(no explicit criteria provided — use your best holistic judgment)";
  return `Evaluation criteria:\n${text}`;
}

function taskSection(prompt: string): string {
  return `User task:\n${prompt}`;
}

/**
 * Render an optional custom instruction into a delimited block placed before
 * the output contract. Empty input renders nothing so prompts stay
 * byte-identical to the no-instruction baseline.
 */
function renderSupplementaryInstruction(judgeInstruction?: string): string {
  const trimmed = (judgeInstruction ?? "").trim();
  if (trimmed.length === 0) return "";
  return (
    `\n\n--- BEGIN ADDITIONAL SYNTHESIZER INSTRUCTION (supplementary) ---\n` +
    trimmed +
    `\n--- END ADDITIONAL SYNTHESIZER INSTRUCTION ---`
  );
}

function blindCandidateSection(blindCandidates: BlindCandidate[]): string {
  return blindCandidates.map((c) => `### Candidate ${c.label}\n${c.content}`).join("\n\n");
}

const BLINDNESS_PREAMBLE =
  `The candidates are anonymized: you see only blind labels (Candidate A, Candidate B, ...) and their answer text. ` +
  `You do not know which model produced which answer — do not speculate about candidate identities, ` +
  `and never refer to model names or providers in your output.`;

const VERIFICATION_INSTRUCTION =
  ` Verify any arithmetic and check any factual claims you carry over from the candidates; ` +
  `flag anything you cannot confirm instead of asserting it.`;

// --- Judge-analysis sections (qualitative / scores) -------------------------------------

/**
 * Qualitative development-judge analysis keyed by blind label: consensus,
 * contradictions, and per-candidate position/strengths/deductions/blind spots.
 * Identity-resolved prose (e.g. unique-insight source model names) is never
 * rendered — only label-keyed material.
 */
export function qualitativeAnalysisSection(
  blindCandidates: BlindCandidate[],
  judgeReport: JudgeReport | null,
  consensus: ConsensusBreakdown | null,
): string {
  const lines: string[] = [];
  if (consensus && consensus.consensus.length > 0) {
    lines.push("Consensus points:");
    for (const point of consensus.consensus) lines.push(`- ${point}`);
  }
  if (consensus && consensus.contradictions.length > 0) {
    lines.push("Contradictions between candidates:");
    for (const item of consensus.contradictions) lines.push(`- ${item}`);
  }
  if (judgeReport) {
    lines.push("Per-candidate assessment:");
    for (const candidate of blindCandidates) {
      const ev = judgeReport.evaluationsById[candidate.candidateId];
      if (!ev) continue;
      const parts = [`position: ${ev.position}`, `evidence: ${ev.rationale}`];
      if (ev.strengths.length > 0) parts.push(`strengths: ${ev.strengths.join("; ")}`);
      if (ev.deductions.length > 0) {
        parts.push(
          `deductions: ${ev.deductions.map((d) => `${d.severity}: ${d.reason}`).join("; ")}`,
        );
      }
      if (ev.missedRequirements.length > 0) {
        parts.push(`blind spots: ${ev.missedRequirements.join("; ")}`);
      }
      lines.push(`- Candidate ${candidate.label}: ${parts.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

/** Numeric per-criterion scores keyed by blind label (AnalysisScores only). */
export function criterionScoresSection(
  blindCandidates: BlindCandidate[],
  judgeReport: JudgeReport,
): string {
  const lines: string[] = ["Per-candidate scores (1.0–5.0):"];
  for (const candidate of blindCandidates) {
    const ev = judgeReport.evaluationsById[candidate.candidateId];
    if (!ev) continue;
    const criteria = ev.criterionScores
      .map((cs) => `${cs.label} ${cs.score.toFixed(1)}`)
      .join(", ");
    lines.push(
      `- Candidate ${candidate.label}: overall ${ev.overallScore.toFixed(1)}` +
        (criteria.length > 0 ? `; ${criteria}` : ""),
    );
  }
  return lines.join("\n");
}

// --- Recipe renderer -----------------------------------------------------------------

/**
 * Render the synthesizer messages for a fusion recipe. The template is
 * determined by the recipe family; `rubricAccess` gates the criteria section;
 * `verification` toggles the verify/flag instruction.
 */
export function renderRecipeMessages(
  recipe: FusionRecipeVersion,
  input: FusionSynthesisInput,
): ChatMessage[] {
  const rubric = rubricSection(input.profile, recipe.rubricAccess);

  let analysisBlock = "";
  if (recipe.judgeAnalysisMode === "qualitative" || recipe.judgeAnalysisMode === "scores") {
    const qualitative = qualitativeAnalysisSection(
      input.blindCandidates,
      input.judgeReport,
      input.consensus,
    );
    if (qualitative.length > 0) {
      analysisBlock = `Development-judge analysis (anonymized):\n${qualitative}`;
    }
    if (recipe.judgeAnalysisMode === "scores" && input.judgeReport) {
      const scores = criterionScoresSection(input.blindCandidates, input.judgeReport);
      analysisBlock = analysisBlock.length > 0 ? `${analysisBlock}\n\n${scores}` : scores;
    }
  }

  const system =
    `You are a senior synthesizer. Merge the strongest material from multiple anonymized candidate answers into a single, ` +
    `coherent, production-grade final answer. ${BLINDNESS_PREAMBLE} ` +
    `Remove redundancy and resolve contradictions sensibly.` +
    (recipe.rubricAccess ? ` Honor the user's evaluation criteria.` : "") +
    (recipe.verification ? VERIFICATION_INSTRUCTION : "") +
    ` Return the final answer in clean Markdown.` +
    renderSupplementaryInstruction(input.judgeInstruction);

  const userParts = [taskSection(input.prompt)];
  if (rubric.length > 0) userParts.push(rubric);
  if (analysisBlock.length > 0) userParts.push(analysisBlock);
  userParts.push(`Candidate answers (anonymized):\n${blindCandidateSection(input.blindCandidates)}`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// --- Refine-the-winner control ---------------------------------------------------------

export interface RefineWinnerInput {
  prompt: string;
  profile: EvaluationProfileSnapshot | null;
  /** Blind label of the Judge-1 winner being revised. */
  winnerLabel: string;
  winnerContent: string;
  /** All anonymized candidates (the winner included) as reference material. */
  blindCandidates: BlindCandidate[];
  /**
   * MUST equal the rubricAccess of the fusion recipe under test — the control
   * receives rubric content identical to fusion so "refine beats fuse" can
   * only mean the second model bought nothing (spec §7.1).
   */
  rubricAccess: boolean;
  /** Toggles the same verify/flag instruction as the fusion recipe. */
  verification: boolean;
  judgeInstruction?: string;
}

/**
 * Render the refine-the-winner finish: revise the Judge-1 winner against the
 * rubric using the other candidates as reference. The rubric section is the
 * shared `rubricSection` — byte-identical to the fusion recipe under test.
 */
export function renderRefineWinnerMessages(input: RefineWinnerInput): ChatMessage[] {
  const rubric = rubricSection(input.profile, input.rubricAccess);

  const system =
    `You are a senior reviser. Improve the winning draft below into the best possible final answer. ` +
    BLINDNESS_PREAMBLE +
    ` Use the other anonymized candidate answers only as reference material — fix weaknesses, ` +
    `incorporate what they do better, and remove what does not serve the user's task.` +
    (input.rubricAccess ? ` Honor the user's evaluation criteria.` : "") +
    (input.verification ? VERIFICATION_INSTRUCTION : "") +
    ` Return the revised answer in clean Markdown.` +
    renderSupplementaryInstruction(input.judgeInstruction);

  const userParts = [taskSection(input.prompt)];
  if (rubric.length > 0) userParts.push(rubric);
  userParts.push(`Winning draft (Candidate ${input.winnerLabel}):\n${input.winnerContent}`);
  userParts.push(`Reference candidate answers (anonymized):\n${blindCandidateSection(input.blindCandidates)}`);

  return [
    { role: "system", content: system },
    { role: "user", content: userParts.join("\n\n") },
  ];
}
