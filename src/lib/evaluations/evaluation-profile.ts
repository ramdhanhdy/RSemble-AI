// =============================================================================
// RSemble AI — Evaluation profile formatting and canonical scoring
//
// Spec §9: evaluation profiles replace the old goal|metric|gap rubric.
// Criteria are evaluator-only — candidate generation never receives them.
// The Judge receives criteria + anchors (graded) or TRUE/FALSE conditions
// (binary); the canonical score is the normalized weighted mean of the
// complete criterion vector, adjusted by compliance influence.
//
// Hybrid scoring contract:
//   Q         = Σ(w_i·s_i) / Σw_i              (graded weighted mean, 1–5)
//   c_g       = min(member boolean values)     (ALL-mode group satisfaction)
//   C         = Σ(v_g·c_g) / Σv_g              (weighted compliance, 0–1)
//   rankValue = Q − λ·(1 − C)                  (authoritative ranking value)
//   rankScore = max(1, rankValue)              (bounded 1–5 presentation)
//   floored   = rankValue < 1                  (disclosure flag)
// =============================================================================

import type {
  EvaluationCriterion,
  EvaluationProfileSnapshot,
  GradedEvaluationCriterion,
  BinaryEvaluationCriterion,
  LegacyGradedEvaluationCriterion,
} from "./evaluation-types";

/** Maximum epsilon for floating-point winner comparison. */
export const WINNER_EPSILON = 1e-9;

/** Default compliance influence (λ) when not specified on the profile. */
export const DEFAULT_COMPLIANCE_INFLUENCE = 1.0;

// --- Kind helpers -------------------------------------------------------------

/** Returns true for criteria with a numeric weight (graded or legacy). */
export function isWeightedCriterion(
  c: EvaluationCriterion,
): c is GradedEvaluationCriterion | LegacyGradedEvaluationCriterion {
  return c.kind === "graded" || c.kind === undefined;
}

/** Returns true for binary criteria (kind "binary"). */
export function isBinaryCriterion(c: EvaluationCriterion): c is BinaryEvaluationCriterion {
  return c.kind === "binary";
}

// --- Judge prompt rendering ---------------------------------------------------

/**
 * Render evaluation criteria as a judge-facing instruction block.
 * Each criterion shows its stable ID, name, description, and anchors (graded)
 * or TRUE/FALSE conditions (binary). Used ONLY for the Judge prompt — never
 * sent to candidate generation.
 */
export function evaluationCriteriaText(
  profile: EvaluationProfileSnapshot,
  opts?: { withIds?: boolean },
): string {
  if (profile.criteria.length === 0) {
    return "(no explicit criteria provided — use your best holistic judgment)";
  }
  return profile.criteria
    .map((c) => {
      const idPrefix = opts?.withIds ? `[id: ${c.id}] ` : "";
      if (c.kind === "binary") {
        const group = profile.requirementGroups?.find((g) => g.checkIds.includes(c.id));
        const groupTag = group ? ` [group: ${group.id}]` : "";
        return (
          `- ${idPrefix}${groupTag} ${c.name} (binary)\n` +
          `Description: ${c.description}\n` +
          `TRUE when: ${c.trueWhen}\n` +
          `FALSE when: ${c.falseWhen}\n` +
          `Return a JSON boolean for this criterion.`
        );
      }
      // Graded (explicit or legacy)
      const weightStr = isWeightedCriterion(c) ? ` (weight ${c.weight.toFixed(2)})` : "";
      const anchorLines =
        c.kind === "graded"
          ? `  Score 1: ${c.anchors.one}\n` +
            `  Score 2: ${c.anchors.two}\n` +
            `  Score 3: ${c.anchors.three}\n` +
            `  Score 4: ${c.anchors.four}\n` +
            `  Score 5: ${c.anchors.five}`
          : `  Score 1: ${c.anchors.one}\n` +
            `  Score 3: ${c.anchors.three}\n` +
            `  Score 5: ${c.anchors.five}`;
      return `- ${idPrefix}${c.name}${weightStr}: ${c.description}\n${anchorLines}`;
    })
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
  const hasBinary = profile.criteria.some((c) => c.kind === "binary");
  const hasGraded = profile.criteria.some((c) => c.kind !== "binary");
  const scaleHint = hasBinary
    ? hasGraded
      ? "Evaluate graded criteria on a 1–5 integer scale and binary criteria as true/false."
      : "Evaluate each binary criterion as true or false."
    : "Evaluate each candidate against the following criteria (1–5 integer scale):";
  const parts = [scaleHint, criteria];
  if (base) parts.unshift(base);
  const override = judgeInstructionOverride?.trim();
  if (override) parts.push(`Additional instruction: ${override}`);
  return parts.join("\n\n");
}

// --- Canonical scoring --------------------------------------------------------

/**
 * Compute Quality (Q) — weighted mean of graded criterion scores.
 * Weights are normalized for calculation (positive only).
 * Returns null when no graded criteria have positive weight.
 */
export function qualityScore(
  criterionScores: Record<string, number>,
  profile: EvaluationProfileSnapshot,
): number | null {
  const positive = profile.criteria.filter(
    (c): c is GradedEvaluationCriterion | LegacyGradedEvaluationCriterion =>
      isWeightedCriterion(c) && c.weight > 0,
  );
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
 * Compute Compliance (C) — weighted pass share of requirement groups.
 * c_g = min(member booleans) for ALL mode.
 * Returns null when no binary groups exist; returns 1 when no binary checks.
 */
export function complianceScore(
  booleanResults: Record<string, boolean>,
  profile: EvaluationProfileSnapshot,
): { C: number; groupsPresent: number } | null {
  const groups = profile.requirementGroups;
  if (!groups || groups.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  let groupsPresent = 0;
  for (const g of groups) {
    // Only count groups whose checks all have present results.
    const memberResults = g.checkIds.map((id) => booleanResults[id]);
    if (memberResults.some((r) => r === undefined)) continue;
    groupsPresent++;
    const c_g = memberResults.every((r) => r === true);
    weightedSum += (c_g ? 1 : 0) * g.weight;
    weightTotal += g.weight;
  }
  if (weightTotal === 0) return null;
  return { C: weightedSum / weightTotal, groupsPresent };
}

/** Get the compliance influence (λ), defaulting to 1.0. */
export function getComplianceInfluence(profile: EvaluationProfileSnapshot): number {
  return profile.complianceInfluence ?? DEFAULT_COMPLIANCE_INFLUENCE;
}

/** Compute the authoritative rank value: Q − λ·(1 − C).
 *  Returns null when Q is absent (compliance-only profile — such profiles rank
 *  on C, not rankValue, per spec §16.3) or when both channels are absent. */
export function rankValueOf(Q: number | null, C: number | null, lambda: number): number | null {
  if (Q === null) return null;
  const c = C ?? 1; // no binary checks → C := 1
  return Q - lambda * (1 - c);
}

/** Compute the bounded presentation score: max(1, rankValue). */
export function rankScoreOf(rv: number | null): number | null {
  if (rv === null) return null;
  return Math.max(1, rv);
}

/** Check whether the rank value is below the display floor. */
export function isFloored(rv: number | null): boolean {
  return rv !== null && rv < 1;
}

/** Format a rank value for bounded display: `rankScore` with a `*` floor
 *  marker when the raw rank value is below 1 (presentation only — ordering
 *  must always use the raw `rankValue`). */
export function formatRankScoreDisplay(rv: number | null): string {
  if (rv === null) return "—";
  const floored = isFloored(rv);
  return `${rankScoreOf(rv)!.toFixed(1)}${floored ? "*" : ""}`;
}

// --- Full rank computation from JudgeCriterionScore[] -------------------------

/** Compute the authoritative rank value from a candidate's criterion results
 *  and a profile snapshot. Handles graded (numeric score) and binary (boolean
 *  value) criterion results. Returns null when no scoring data is available. */
export function rankValueFromResults(
  criterionScores: Array<{
    criterionId: string;
    score?: number;
    value?: boolean;
    kind?: "graded" | "binary" | undefined;
  }>,
  profile: EvaluationProfileSnapshot,
): number | null {
  const numericScores: Record<string, number> = {};
  const booleanResults: Record<string, boolean> = {};
  for (const cs of criterionScores) {
    if (cs.kind === "binary" && cs.value !== undefined) {
      booleanResults[cs.criterionId] = cs.value;
    } else if (cs.score !== undefined) {
      numericScores[cs.criterionId] = cs.score;
    }
  }
  const Q = qualityScore(numericScores, profile);
  const comp = complianceScore(booleanResults, profile);
  const lambda = getComplianceInfluence(profile);
  const C = comp?.C ?? null;
  return rankValueOf(Q, C, lambda);
}

// --- Legacy compatibility: canonicalScore (pure-graded → Q) -------------------

/**
 * Compute the canonical weighted score from criterion scores.
 * Legacy entry point — for pure-graded profiles this is identical to Q.
 * Returns null when no criteria have positive weight.
 * @deprecated Use qualityScore + complianceScore + rankValueOf for hybrid profiles.
 */
export function canonicalScore(
  criterionScores: Record<string, number>,
  profile: EvaluationProfileSnapshot,
): number | null {
  return qualityScore(criterionScores, profile);
}

/**
 * Determine the winner model keys from scores.
 * All models within WINNER_EPSILON of the maximum appear in winnerKeys.
 */
export function computeWinnerKeys(scoresByModelKey: Record<string, number>): string[] {
  const entries = Object.entries(scoresByModelKey);
  if (entries.length === 0) return [];
  const maxScore = Math.max(...entries.map(([, s]) => s));
  return entries.filter(([, s]) => Math.abs(s - maxScore) < WINNER_EPSILON).map(([key]) => key);
}

// --- Validation ---------------------------------------------------------------

/**
 * Validate an evaluation profile snapshot for use in a run.
 * Returns an array of field-specific error messages (empty = valid).
 */
export function validateProfile(profile: EvaluationProfileSnapshot): string[] {
  const errors: string[] = [];

  if (!profile.name.trim()) {
    errors.push("Profile name is required.");
  }

  if (profile.criteria.length === 0) {
    // Holistic is valid (no criteria).
    return errors;
  }

  // Check for reserved "gate" kind
  for (const c of profile.criteria) {
    if ((c as unknown as Record<string, unknown>).kind === "gate") {
      errors.push(
        `Criterion ${c.id}: hard-gate semantics are not supported in this version; author this as a binary check or wait for gate support.`,
      );
    }
  }

  // Validate graded/legacy criteria
  const gradedCriteria = profile.criteria.filter(isWeightedCriterion);
  const totalGradedWeight = gradedCriteria.reduce((sum, c) => sum + c.weight, 0);
  if (gradedCriteria.length > 0 && totalGradedWeight <= 0) {
    errors.push("At least one graded criterion must have a positive weight.");
  }

  for (const c of profile.criteria) {
    if (!c.name.trim()) {
      errors.push(`Criterion ${c.id}: name is required.`);
    }
    if (!c.description.trim()) {
      errors.push(`Criterion ${c.id}: description is required.`);
    }
    if (c.kind === "graded") {
      if (
        !c.anchors.one.trim() ||
        !c.anchors.two.trim() ||
        !c.anchors.three.trim() ||
        !c.anchors.four.trim() ||
        !c.anchors.five.trim()
      ) {
        errors.push(`Criterion ${c.id}: all five anchors (1–5) are required.`);
      }
      if (c.weight < 0) {
        errors.push(`Criterion ${c.id}: weight must be non-negative.`);
      }
    } else if (c.kind === undefined) {
      // Legacy 1/3/5
      if (!c.anchors.one.trim() || !c.anchors.three.trim() || !c.anchors.five.trim()) {
        errors.push(`Criterion ${c.id}: all anchors (1, 3, 5) are required.`);
      }
      if (c.weight < 0) {
        errors.push(`Criterion ${c.id}: weight must be non-negative.`);
      }
    } else if (c.kind === "binary") {
      if (!c.trueWhen.trim()) {
        errors.push(`Criterion ${c.id}: trueWhen condition is required.`);
      }
      if (!c.falseWhen.trim()) {
        errors.push(`Criterion ${c.id}: falseWhen condition is required.`);
      }
    }
  }

  // Validate requirement groups
  if (profile.requirementGroups) {
    const binaryIds = new Set(profile.criteria.filter(isBinaryCriterion).map((c) => c.id));
    const assignedChecks = new Set<string>();
    for (const g of profile.requirementGroups) {
      if (!g.name.trim()) {
        errors.push(`Group ${g.id}: name is required.`);
      }
      if (g.weight <= 0) {
        errors.push(`Group ${g.id}: weight must be positive.`);
      }
      if (g.mode !== "ALL") {
        errors.push(`Group ${g.id}: only ALL mode is supported in v1.`);
      }
      if (g.checkIds.length === 0) {
        errors.push(`Group ${g.id}: must contain at least one check.`);
      }
      for (const checkId of g.checkIds) {
        if (!binaryIds.has(checkId)) {
          errors.push(`Group ${g.id}: check ${checkId} is not a binary criterion.`);
        }
        if (assignedChecks.has(checkId)) {
          errors.push(`Group ${g.id}: check ${checkId} is already assigned to another group.`);
        }
        assignedChecks.add(checkId);
      }
    }
    // Check for ungrouped binary checks
    for (const c of profile.criteria) {
      if (c.kind === "binary" && !assignedChecks.has(c.id)) {
        errors.push(`Binary criterion ${c.id} is not assigned to any requirement group.`);
      }
    }
  } else {
    // No groups defined — check for ungrouped binary checks
    for (const c of profile.criteria) {
      if (c.kind === "binary") {
        errors.push(`Binary criterion ${c.id} is not assigned to any requirement group.`);
      }
    }
  }

  // Validate complianceInfluence
  if (profile.complianceInfluence !== undefined) {
    const lambda = profile.complianceInfluence;
    if (typeof lambda !== "number" || !Number.isFinite(lambda) || lambda < 0 || lambda > 1) {
      errors.push("complianceInfluence must be a finite number in [0, 1].");
    }
  }

  return errors;
}

// --- Display helpers ----------------------------------------------------------

/**
 * Compute normalized weights for display (graded criteria only).
 * Returns a map of criterion ID → percentage (0–100).
 */
export function normalizedWeights(criteria: EvaluationCriterion[]): Record<string, number> {
  const graded = criteria.filter(isWeightedCriterion);
  const total = graded.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  const result: Record<string, number> = {};
  for (const c of criteria) {
    if (isWeightedCriterion(c)) {
      result[c.id] = total > 0 ? (Math.max(0, c.weight) / total) * 100 : 0;
    } else {
      result[c.id] = 0; // binary checks have no criterion-level weight
    }
  }
  return result;
}

/** Total raw weight of all graded criteria (non-negative portion). */
export function totalWeight(criteria: EvaluationCriterion[]): number {
  return criteria.filter(isWeightedCriterion).reduce((sum, c) => sum + Math.max(0, c.weight), 0);
}
