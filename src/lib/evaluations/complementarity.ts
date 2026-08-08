// =============================================================================
// RSemble AI — Complementarity analytics (fusion-study spec §5.4, §5.5, §5.6)
//
// Two continuous-score headroom metrics computed from STORED judge evidence —
// no new judge calls:
//
//   H_select — selection headroom: "can choosing A vs B per task help?"
//     H_select(A,B) = E_t[ max(S_A,t, S_B,t) ] − max( E[S_A], E[S_B] )
//
//   H_synth — within-task synthesis headroom: "within the same answer, do A
//   and B hold different criterion strengths?"
//     O_AB,t  = Σ_c w_c · max(S_A,t,c, S_B,t,c)  (weight-normalized)
//     H_synth = E_t[ O_AB,t − max(S_A,t, S_B,t) ]
//
// Per-task overalls are criterion-weighted means whenever criterion scores
// exist, falling back to the stored holistic overall otherwise — this keeps
// the ladder (best fixed → best member per task → best criterion per task)
// coherent and H_synth ≥ 0. Per-criterion headroom is a first-class
// shortlisting signal, not a secondary diagnostic.
//
// Binary co-failure metrics are computed ONLY from executed verifier output on
// tasks with verification.kind ≠ "none" — never from rubric scores. Empirically
// bimodal rubric distributions surface a diagnostic warning only.
// =============================================================================

import type { JudgeReport } from "../../studio-data";
import type { TaskVerification } from "./evaluation-types";
import type { CriterionHeadroom, VerifierOutcome } from "./fusion-study-types";

// --- Inputs ---------------------------------------------------------------------

export interface CriterionScoreVector {
  criterionId: string;
  score: number;
}

/** One model's stored scores on one task (repeats already averaged by caller). */
export interface ModelTaskScore {
  /** Stored holistic overall — used only when criterion scores are absent. */
  overall: number | null;
  criteria: CriterionScoreVector[];
}

export interface PairedTaskScores {
  taskId: string;
  a: ModelTaskScore;
  b: ModelTaskScore;
}

/** Criterion weights keyed by criterion id (EvaluationCriterion.weight). */
export type CriterionWeights = ReadonlyMap<string, number>;

// --- Extraction from stored judge evidence ------------------------------------------

/**
 * Pull one model's task scores from a stored JudgeReport — the ONLY data
 * source for headroom. No new judge calls (spec §5.4).
 */
export function modelTaskScoreFromReport(
  report: JudgeReport,
  candidateId: string,
): ModelTaskScore | null {
  const ev = report.evaluationsById[candidateId];
  if (!ev) return null;
  return {
    overall: ev.overallScore,
    criteria: ev.criterionScores
      .filter((cs) => cs.score !== undefined)
      .map((cs) => ({ criterionId: cs.criterionId, score: cs.score! })),
  };
}

// --- Headroom -----------------------------------------------------------------------

export interface HeadroomMetrics {
  selectionHeadroom: number;
  /** Null when no task carries criterion scores for both models. */
  synthesisHeadroom: number | null;
  perCriterion: CriterionHeadroom[];
  tasksUsed: number;
  tasksWithCriteria: number;
}

/**
 * Criterion-weighted per-task overall. With criterion scores: weight-normalized
 * mean over criteria with positive weight (unweighted fallback when no weights
 * resolve). Without: the stored holistic overall.
 */
export function taskOverall(score: ModelTaskScore, weights: CriterionWeights): number | null {
  if (score.criteria.length > 0) {
    let weightedSum = 0;
    let weightTotal = 0;
    let unweightedSum = 0;
    for (const cs of score.criteria) {
      unweightedSum += cs.score;
      const w = weights.get(cs.criterionId) ?? 0;
      if (w > 0) {
        weightedSum += w * cs.score;
        weightTotal += w;
      }
    }
    if (weightTotal > 0) return weightedSum / weightTotal;
    return unweightedSum / score.criteria.length;
  }
  return score.overall;
}

/**
 * Compute H_select, H_synth, and per-criterion headroom for one model pair
 * over paired per-task scores. Tasks missing an overall on either side are
 * skipped; H_synth uses only tasks where BOTH models have criterion scores.
 */
export function computeHeadroom(
  tasks: PairedTaskScores[],
  weights: CriterionWeights,
): HeadroomMetrics {
  const usable: Array<{ taskId: string; sa: number; sb: number }> = [];
  for (const t of tasks) {
    const sa = taskOverall(t.a, weights);
    const sb = taskOverall(t.b, weights);
    if (sa === null || sb === null) continue;
    usable.push({ taskId: t.taskId, sa, sb });
  }

  let selectionHeadroom = 0;
  if (usable.length > 0) {
    const meanMax = mean(usable.map((u) => Math.max(u.sa, u.sb)));
    const meanA = mean(usable.map((u) => u.sa));
    const meanB = mean(usable.map((u) => u.sb));
    selectionHeadroom = meanMax - Math.max(meanA, meanB);
  }

  // Synthesis headroom — tasks where both models carry criterion scores.
  const criteriaTasks = tasks.filter((t) => t.a.criteria.length > 0 && t.b.criteria.length > 0);
  let synthesisHeadroom: number | null = null;
  if (criteriaTasks.length > 0) {
    const gaps = criteriaTasks.map((t) => {
      const oracle = criterionOracle(t.a.criteria, t.b.criteria, weights);
      const sa = taskOverall(t.a, weights)!;
      const sb = taskOverall(t.b, weights)!;
      return oracle - Math.max(sa, sb);
    });
    synthesisHeadroom = mean(gaps);
  }

  return {
    selectionHeadroom,
    synthesisHeadroom,
    perCriterion: computePerCriterionHeadroom(tasks, weights),
    tasksUsed: usable.length,
    tasksWithCriteria: criteriaTasks.length,
  };
}

/** Weight-normalized best-criterion-from-either-model oracle for one task. */
function criterionOracle(
  a: CriterionScoreVector[],
  b: CriterionScoreVector[],
  weights: CriterionWeights,
): number {
  const byId = new Map<string, { sa: number; sb: number }>();
  for (const cs of a) byId.set(cs.criterionId, { sa: cs.score, sb: Number.NaN });
  for (const cs of b) {
    const entry = byId.get(cs.criterionId);
    if (entry) entry.sb = cs.score;
    else byId.set(cs.criterionId, { sa: Number.NaN, sb: cs.score });
  }
  let weightedSum = 0;
  let weightTotal = 0;
  let unweightedSum = 0;
  let count = 0;
  for (const [criterionId, { sa, sb }] of byId) {
    // A criterion scored for only one model cannot be rescued pairwise — skip.
    if (Number.isNaN(sa) || Number.isNaN(sb)) continue;
    const best = Math.max(sa, sb);
    unweightedSum += best;
    count += 1;
    const w = weights.get(criterionId) ?? 0;
    if (w > 0) {
      weightedSum += w * best;
      weightTotal += w;
    }
  }
  if (weightTotal > 0) return weightedSum / weightTotal;
  return count > 0 ? unweightedSum / count : 0;
}

/**
 * Per-criterion headroom (selection-style, per criterion):
 *   H_c = E_t[ max(S_A,t,c, S_B,t,c) ] − max( E[S_A,c], E[S_B,c] )
 * Which specific criteria each model rescues — the core shortlisting signal.
 */
export function computePerCriterionHeadroom(
  tasks: PairedTaskScores[],
  _weights: CriterionWeights,
): CriterionHeadroom[] {
  const byCriterion = new Map<string, Array<{ sa: number; sb: number }>>();
  for (const t of tasks) {
    const bById = new Map(t.b.criteria.map((cs) => [cs.criterionId, cs.score]));
    for (const ca of t.a.criteria) {
      const sb = bById.get(ca.criterionId);
      if (sb === undefined) continue;
      const list = byCriterion.get(ca.criterionId) ?? [];
      list.push({ sa: ca.score, sb });
      byCriterion.set(ca.criterionId, list);
    }
  }
  const result: CriterionHeadroom[] = [];
  for (const [criterionId, rows] of byCriterion) {
    if (rows.length === 0) continue;
    const meanMax = mean(rows.map((r) => Math.max(r.sa, r.sb)));
    const headroom = meanMax - Math.max(mean(rows.map((r) => r.sa)), mean(rows.map((r) => r.sb)));
    result.push({ criterionId, headroom });
  }
  result.sort((x, y) => x.criterionId.localeCompare(y.criterionId));
  return result;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

// --- Binary co-failure metrics (verifier-gated, spec §5.5) ------------------------------

export interface BinaryMetricTask {
  taskId: string;
  verification?: TaskVerification;
}

export type BinaryMetricGate =
  | { ok: true; taskIds: string[]; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

/**
 * Gate binary co-failure metrics: only tasks with verification.kind ≠ "none"
 * AND executed verifier output for BOTH models qualify. A configured-but-not-
 * executed verifier produces a warning and rubric fallback — binary metrics
 * are never synthesized from rubric scores.
 */
export function gateBinaryMetrics(
  tasks: BinaryMetricTask[],
  outcomes: VerifierOutcome[],
  pair: [string, string],
): BinaryMetricGate {
  const warnings: string[] = [];
  const outcomesByTask = new Map<string, Set<string>>();
  for (const o of outcomes) {
    if (o.modelKey !== pair[0] && o.modelKey !== pair[1]) continue;
    const set = outcomesByTask.get(o.taskId) ?? new Set<string>();
    set.add(o.modelKey);
    outcomesByTask.set(o.taskId, set);
  }

  const eligible: string[] = [];
  let sawVerifierTask = false;
  for (const task of tasks) {
    const kind = task.verification?.kind ?? "none";
    if (kind === "none") continue;
    sawVerifierTask = true;
    const models = outcomesByTask.get(task.taskId);
    if (models && models.has(pair[0]) && models.has(pair[1])) {
      eligible.push(task.taskId);
    } else {
      warnings.push(
        `Task ${task.taskId} has verification.kind "${kind}" but no executed verifier ` +
          `output for the pair — falling back to rubric headroom for this task.`,
      );
    }
  }

  if (!sawVerifierTask) {
    return {
      ok: false,
      reason:
        "No task in this suite declares an external verifier — binary co-failure " +
        "metrics require executed verifier output and are never derived from rubric scores.",
      warnings,
    };
  }
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: "Verifier tasks exist but none has executed verifier output for both models.",
      warnings,
    };
  }
  return { ok: true, taskIds: eligible, warnings };
}

export interface CoFailureMetrics {
  /** Jaccard overlap of the two models' failure sets. */
  jaccard: number;
  /** Laplace-smoothed φ coefficient over the 2×2 pass/fail table. */
  phiAdjusted: number;
  tasksUsed: number;
}

/**
 * Jaccard error overlap + adjusted φ over executed verifier outcomes.
 * Callers MUST pass the gate first (gateBinaryMetrics) — this function trusts
 * that every supplied outcome is executed verifier output.
 */
export function computeCoFailure(
  outcomes: VerifierOutcome[],
  pair: [string, string],
  taskIds: string[],
): CoFailureMetrics {
  let bothFail = 0;
  let aOnlyFail = 0;
  let bOnlyFail = 0;
  let bothPass = 0;
  for (const taskId of taskIds) {
    const a = outcomes.find((o) => o.taskId === taskId && o.modelKey === pair[0]);
    const b = outcomes.find((o) => o.taskId === taskId && o.modelKey === pair[1]);
    if (!a || !b) continue;
    if (!a.passed && !b.passed) bothFail += 1;
    else if (!a.passed) aOnlyFail += 1;
    else if (!b.passed) bOnlyFail += 1;
    else bothPass += 1;
  }
  const tasksUsed = bothFail + aOnlyFail + bOnlyFail + bothPass;
  const unionFail = bothFail + aOnlyFail + bOnlyFail;
  const jaccard = unionFail === 0 ? 0 : bothFail / unionFail;

  // Laplace-smoothed φ over the 2×2 (fail=1) contingency table.
  const n11 = bothFail + 0.5;
  const n10 = aOnlyFail + 0.5;
  const n01 = bOnlyFail + 0.5;
  const n00 = bothPass + 0.5;
  const numerator = n11 * n00 - n10 * n01;
  const denominator = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  const phiAdjusted = denominator === 0 ? 0 : numerator / denominator;

  return { jaccard, phiAdjusted, tasksUsed };
}

// --- Bimodal-score diagnostic (warning only, spec §5.5) --------------------------------

/**
 * Empirically bimodal rubric distributions (a judge that loves 1s and 5s) are
 * a diagnostic warning — they do NOT convert a rubric into a verifier and
 * never switch the metric path. Returns a warning string or null.
 */
export function detectBimodalScores(
  scores: number[],
  opts: { minSamples?: number; extremeFraction?: number } = {},
): string | null {
  const minSamples = opts.minSamples ?? 8;
  const extremeFraction = opts.extremeFraction ?? 0.6;
  if (scores.length < minSamples) return null;
  const extremes = scores.filter((s) => s <= 1.5 || s >= 4.5).length;
  if (extremes / scores.length < extremeFraction) return null;
  const lows = scores.filter((s) => s <= 1.5).length;
  const highs = scores.filter((s) => s >= 4.5).length;
  // Bimodal requires mass at BOTH ends, not a one-sided skew.
  if (lows === 0 || highs === 0) return null;
  return (
    `Bimodal score distribution: ${extremes}/${scores.length} scores sit at the ` +
    `extremes (${lows} low, ${highs} high). This is a judge-behavior diagnostic only — ` +
    `rubric scores never become deterministic labels.`
  );
}

// --- Pool adequacy probe (spec §5.6) ------------------------------------------------------

export interface PoolAdequacyThresholds {
  /** "Meaningfully below ceiling": ceiling − bestModelMean at or above this. */
  belowCeilingMargin: number;
  /** Pool-level oracle headroom below this counts as near-zero. */
  oracleEpsilon: number;
  /** Pair headroom below this counts as immaterial. */
  pairHeadroomEpsilon: number;
}

export const DEFAULT_POOL_ADEQUACY_THRESHOLDS: PoolAdequacyThresholds = {
  belowCeilingMargin: 0.5,
  oracleEpsilon: 0.05,
  pairHeadroomEpsilon: 0.1,
};

export interface PoolAdequacyProbeInput {
  /** Mean overall of the best single pool model across tasks. */
  bestModelMean: number;
  /** The practical score ceiling (e.g. 5.0 on the rubric scale). */
  ceiling: number;
  /** Pool-level oracle: E_t[max_m S_m,t] − max_m E[S_m,t]. */
  poolOracleHeadroom: number;
  /** Largest pairwise headroom observed in the pool. */
  maxPairHeadroom: number;
  thresholds?: Partial<PoolAdequacyThresholds>;
}

export interface PoolAdequacyProbe {
  /** True when the probe conditions fire and outside-pool challengers should run. */
  triggerChallengers: boolean;
  reasons: string[];
}

/**
 * "No complementary pair" is ambiguous between shared failure modes and a
 * redundant pool — observationally indistinguishable from inside. When the
 * best model sits meaningfully below ceiling, pool-level oracle headroom is
 * near zero, and no pair has material headroom, run outside-pool challengers
 * before concluding (spec §5.6).
 */
export function probePoolAdequacy(input: PoolAdequacyProbeInput): PoolAdequacyProbe {
  const thresholds: PoolAdequacyThresholds = {
    ...DEFAULT_POOL_ADEQUACY_THRESHOLDS,
    ...input.thresholds,
  };
  const reasons: string[] = [];

  const belowCeiling = input.ceiling - input.bestModelMean >= thresholds.belowCeilingMargin;
  if (belowCeiling) {
    reasons.push(
      `Best pool model mean ${input.bestModelMean.toFixed(2)} is meaningfully below ` +
        `ceiling ${input.ceiling.toFixed(2)}.`,
    );
  }
  const oracleNearZero = input.poolOracleHeadroom < thresholds.oracleEpsilon;
  if (oracleNearZero) {
    reasons.push(`Pool-level oracle headroom ${input.poolOracleHeadroom.toFixed(3)} is near zero.`);
  }
  const noPairHeadroom = input.maxPairHeadroom < thresholds.pairHeadroomEpsilon;
  if (noPairHeadroom) {
    reasons.push(`No pool pair has material headroom (max ${input.maxPairHeadroom.toFixed(3)}).`);
  }

  return { triggerChallengers: belowCeiling && oracleNearZero && noPairHeadroom, reasons };
}

/**
 * Assess challenger outcomes after the probe fires: if any challenger opens
 * material headroom against the pool, the pool was inadequate (unconfirmed);
 * if challengers fail on the same instances, the no-fusion conclusion is much
 * more credible (confirmed).
 */
export function assessChallengerOutcome(
  challengerResults: Array<{ modelKey: string; maxPairHeadroomWithPool: number }>,
  thresholds: Partial<PoolAdequacyThresholds> = {},
): "confirmed" | "unconfirmed" {
  const epsilon =
    thresholds.pairHeadroomEpsilon ?? DEFAULT_POOL_ADEQUACY_THRESHOLDS.pairHeadroomEpsilon;
  return challengerResults.some((r) => r.maxPairHeadroomWithPool >= epsilon)
    ? "unconfirmed"
    : "confirmed";
}
