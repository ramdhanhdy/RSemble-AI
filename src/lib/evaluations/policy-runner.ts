// =============================================================================
// RSemble AI — Blocked-policy runner
//
// Policies are compared BLOCKED (fusion-study spec §5.1): for a given task and
// sample index, Rank, Fuse, and Refine share the same candidate generations
// and the same development-judge evidence; only the finishing step varies.
// This module plans the four policy outputs from that shared evidence — it
// performs no provider calls and no persistence. Every output echoes the
// shared lineage (candidate attempt ids + Judge-1 attempt id) so downstream
// persistence can assert the blocking invariant.
//
// Before any planned message leaves the process, the runner scans it for
// identity leaks (findBlindnessViolations). A non-empty violation list must
// block execution — the synthesizer never sees model identity.
// =============================================================================

import type { ChatMessage } from "../providers/types";
import type { BlindCandidate, ConsensusBreakdown, JudgeReport } from "../../studio-data";
import type { EvaluationProfileSnapshot } from "./evaluation-types";
import { rankValueFromResults } from "./evaluation-rubric";
import type { FusionRecipeRef, FusionRecipeVersion } from "./fusion-study-types";
import {
  findBlindnessViolations,
  fusionRecipeRef,
  renderRecipeMessages,
  renderRefineWinnerMessages,
  type CandidateIdentity,
} from "./fusion-recipes";

/** Frozen attempt lineage shared by every policy in the block. */
export interface BlockedPolicyEvidence {
  candidateAttemptIdsByCandidateId: Record<string, string>;
  judgeAttemptId: string;
}

export interface BlockedPolicyInput {
  prompt: string;
  profile: EvaluationProfileSnapshot | null;
  /** Anonymized candidates in the Judge-1 label order (shared). */
  blindCandidates: BlindCandidate[];
  /** Judge-1 evidence (shared). */
  judgeReport: JudgeReport;
  consensus: ConsensusBreakdown;
  evidence: BlockedPolicyEvidence;
  /** Candidate identities used ONLY for the blindness scan — never rendered. */
  identities: CandidateIdentity[];
  judgeInstruction?: string;
}

export interface RankPolicyOutput {
  kind: "rank";
  winnerCandidateId: string;
  winnerBlindLabel: string;
  winnerScore: number;
  evidence: BlockedPolicyEvidence;
}

export interface FusePolicyOutput {
  kind: "fuse";
  recipe: FusionRecipeRef;
  messages: ChatMessage[];
  evidence: BlockedPolicyEvidence;
}

export interface RefinePolicyOutput {
  kind: "refine";
  winnerCandidateId: string;
  winnerBlindLabel: string;
  messages: ChatMessage[];
  evidence: BlockedPolicyEvidence;
}

export interface BlockedPolicyPlan {
  rank: RankPolicyOutput;
  fuse: FusePolicyOutput;
  refine: RefinePolicyOutput;
  /**
   * Identity leaks found in synthesizer-bound messages. MUST be empty before
   * execution — the orchestrator refuses to send when this is non-empty.
   */
  blindnessViolations: string[];
}

/**
 * The Rank finish is pure selection over shared Judge-1 evidence: highest
 * overall score wins; ties break deterministically by blind-label order.
 */
export function deriveRankWinner(
  blindCandidates: BlindCandidate[],
  judgeReport: JudgeReport,
  profile?: EvaluationProfileSnapshot | null,
): { winnerCandidateId: string; winnerBlindLabel: string; winnerScore: number } {
  let best: { candidateId: string; label: string; score: number } | null = null;
  for (const candidate of blindCandidates) {
    const ev = judgeReport.evaluationsById[candidate.candidateId];
    if (!ev) continue;
    // With a pinned profile, the authoritative ranking value is the derived
    // rankValue (Q − λ(1−C)); otherwise the Judge's holistic overallScore.
    const rv = profile ? rankValueFromResults(ev.criterionScores, profile) : null;
    const score = rv ?? ev.overallScore;
    if (best === null || score > best.score) {
      best = { candidateId: candidate.candidateId, label: candidate.label, score };
    }
  }
  if (best === null) {
    throw new Error(
      "Cannot derive a rank winner: no judge evaluations match the blind candidates.",
    );
  }
  return {
    winnerCandidateId: best.candidateId,
    winnerBlindLabel: best.label,
    winnerScore: best.score,
  };
}

/**
 * Plan Rank / Fuse / Refine from shared candidate generations and Judge-1
 * evidence. The refine control inherits the fusion recipe's rubricAccess and
 * verification flags so the rubric confound is controlled (spec §7.1).
 */
export function planBlockedPolicies(
  input: BlockedPolicyInput,
  recipe: FusionRecipeVersion,
): BlockedPolicyPlan {
  // Forward the pinned profile so the blocked Rank baseline uses the same
  // authoritative rankValue contract (Q − λ(1−C)) as fuse/refine and the
  // experiment matrix — otherwise Rank measures the Judge's holistic
  // overallScore while the compared baselines use rankValue.
  const winner = deriveRankWinner(input.blindCandidates, input.judgeReport, input.profile);
  const winnerContent =
    input.blindCandidates.find((c) => c.candidateId === winner.winnerCandidateId)?.content ?? "";

  const fuseMessages = renderRecipeMessages(recipe, {
    prompt: input.prompt,
    profile: input.profile,
    blindCandidates: input.blindCandidates,
    judgeReport: input.judgeReport,
    consensus: input.consensus,
    judgeInstruction: input.judgeInstruction,
  });

  const refineMessages = renderRefineWinnerMessages({
    prompt: input.prompt,
    profile: input.profile,
    winnerLabel: winner.winnerBlindLabel,
    winnerContent,
    blindCandidates: input.blindCandidates,
    rubricAccess: recipe.rubricAccess,
    verification: recipe.verification,
    judgeInstruction: input.judgeInstruction,
  });

  const blindnessViolations = [
    ...findBlindnessViolations(fuseMessages, input.identities),
    ...findBlindnessViolations(refineMessages, input.identities),
  ];

  return {
    rank: {
      kind: "rank",
      winnerCandidateId: winner.winnerCandidateId,
      winnerBlindLabel: winner.winnerBlindLabel,
      winnerScore: winner.winnerScore,
      evidence: input.evidence,
    },
    fuse: {
      kind: "fuse",
      recipe: fusionRecipeRef(recipe),
      messages: fuseMessages,
      evidence: input.evidence,
    },
    refine: {
      kind: "refine",
      winnerCandidateId: winner.winnerCandidateId,
      winnerBlindLabel: winner.winnerBlindLabel,
      messages: refineMessages,
      evidence: input.evidence,
    },
    blindnessViolations,
  };
}
