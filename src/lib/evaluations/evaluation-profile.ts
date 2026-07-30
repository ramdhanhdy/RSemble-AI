// =============================================================================
// RSemble AI — Evaluation profile formatting and canonical scoring
//
// Spec §9: evaluation profiles replace the old goal|metric|gap rubric.
// Criteria are evaluator-only — candidate generation never receives them.
// The Judge receives criteria + 1/3/5 anchors; the canonical score is the
// normalized weighted mean of the complete criterion vector.
// =============================================================================

import type {
  EvaluationCriterion,
  EvaluationProfileSnapshot,
} from "./evaluation-types";

/** Maximum epsilon for floating-point winner comparison. */
export const WINNER_EPSILON = 1e-9;

/**
 * Render evaluation criteria as a judge-facing instruction block.
 * Each criterion shows its stable ID, name, weight, description, and anchors.
 * Used ONLY for the Judge prompt — never sent to candidate generation.
 */
export function evaluationCriteriaText(
  profile: EvaluationProfileSnapshot,
  opts?: { withIds?: boolean },
): string {
  if (profile.criteria.length === 0) {
    return "(no explicit criteria provided — use your best holistic judgment)";
  }
  return profile.criteria
    .map(
      (c) =>
        `- ${opts?.withIds ? `[id: ${c.id}] ` : ""}${c.name} ` +
        `(weight ${c.weight.toFixed(2)}): ${c.description}\n` +
        `  Score 1: ${c.anchors.one}\n` +
        `  Score 3: ${c.anchors.three}\n` +
        `  Score 5: ${c.anchors.five}`,
    )
    .join("\n");
}

/**
 * Build the Judge instruction block from a profile snapshot.
 * Includes the profile's base judge instruction and the criteria text.
 */
export function judgeEvaluationBlock(
  profile: EvaluationProfileSnapshot | null,
  judgeInstructionOverride?: string,
): string {
  if (!profile || profile.criteria.length === 0) {
    // Holistic mode: no explicit criteria.
    return judgeInstructionOverride?.trim() || "";
  }
  const base = profile.judgeInstruction?.trim();
  const criteria = evaluationCriteriaText(profile, { withIds: true });
  const parts = [
    "Evaluate each candidate against the following criteria (1.0–5.0 scale):",
    criteria,
  ];
  if (base) parts.unshift(base);
  const override = judgeInstructionOverride?.trim();
  if (override) parts.push(`Additional instruction: ${override}`);
  return parts.join("\n\n");
}

/**
 * Compute the canonical weighted score from criterion scores.
 * Weights are normalized for calculation (non-negative, summed).
 * Returns null when no criteria have positive weight.
 */
export function canonicalScore(
  criterionScores: Record<string, number>,
  profile: EvaluationProfileSnapshot,
): number | null {
  const positive = profile.criteria.filter((c) => c.weight > 0);
  if (positive.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const c of positive) {
    const score = criterionScores[c.id];
    if (score == null) continue;
    weightedSum += score * c.weight;
    weightTotal += c.weight;
  }
  if (weightTotal === 0) return null;
  return weightedSum / weightTotal;
}

/**
 * Determine the winner model keys from scores.
 * All models within WINNER_EPSILON of the maximum appear in winnerKeys.
 */
export function computeWinnerKeys(
  scoresByModelKey: Record<string, number>,
): string[] {
  const entries = Object.entries(scoresByModelKey);
  if (entries.length === 0) return [];
  const maxScore = Math.max(...entries.map(([, s]) => s));
  return entries
    .filter(([, s]) => Math.abs(s - maxScore) < WINNER_EPSILON)
    .map(([key]) => key);
}

/**
 * Validate an evaluation profile snapshot for use in a run.
 * Returns an array of field-specific error messages (empty = valid).
 */
export function validateProfile(
  profile: EvaluationProfileSnapshot,
): string[] {
  const errors: string[] = [];

  if (!profile.name.trim()) {
    errors.push("Profile name is required.");
  }

  if (profile.criteria.length === 0) {
    // Holistic is valid (no criteria).
    return errors;
  }

  const totalWeight = profile.criteria.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) {
    errors.push("At least one criterion must have a positive weight.");
  }

  for (const c of profile.criteria) {
    if (!c.name.trim()) {
      errors.push(`Criterion ${c.id}: name is required.`);
    }
    if (!c.description.trim()) {
      errors.push(`Criterion ${c.id}: description is required.`);
    }
    if (!c.anchors.one.trim() || !c.anchors.three.trim() || !c.anchors.five.trim()) {
      errors.push(`Criterion ${c.id}: all anchors (1, 3, 5) are required.`);
    }
    if (c.weight < 0) {
      errors.push(`Criterion ${c.id}: weight must be non-negative.`);
    }
  }

  return errors;
}

/**
 * Compute normalized weights for display.
 * Returns a map of criterion ID → percentage (0–100).
 */
export function normalizedWeights(
  criteria: EvaluationCriterion[],
): Record<string, number> {
  const total = criteria.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  const result: Record<string, number> = {};
  for (const c of criteria) {
    result[c.id] = total > 0 ? (Math.max(0, c.weight) / total) * 100 : 0;
  }
  return result;
}

/** Total raw weight of all criteria (non-negative portion). */
export function totalWeight(criteria: EvaluationCriterion[]): number {
  return criteria.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
}
