// =============================================================================
// experiment-ranking.ts — display ranking for experiment results (spec §10/§16.1).
//
// Standings use two groups:
//   1. Eligible standings: complete models sorted by raw mean, numbered #1..#N.
//   2. Provisional results: incomplete models sorted by raw mean, no numbers.
//
// The provisional score leader is returned only when its mean exceeds the
// highest eligible mean or when no complete model exists. Ties are broken by
// the §16.1 deterministic key: mean(rankValue) desc → Q̄ desc → C̄ desc →
// candidate_id (modelKey) asc — NOT by snapshot roster order.
//
// Winner math itself is untouched — this module only derives display groups.
// =============================================================================

import type { ModelAggregate } from "./experiment-aggregation";
import { WINNER_EPSILON } from "./evaluation-profile";

export interface ExperimentDisplayRanking {
  /** Complete models sorted by §16.1 key: mean desc → Q̄ desc → C̄ desc → id asc. */
  eligible: ModelAggregate[];
  /** Incomplete models sorted by the same §16.1 key. */
  provisional: ModelAggregate[];
  /** The incomplete model with the highest mean, when it outranks the
   *  eligible winner or when no complete model exists. Otherwise null. */
  provisionalLeader: ModelAggregate | null;
}

/**
 * Derive display groups from raw aggregates.
 *
 * Rules (spec §10.3/§16.1):
 * - eligible means complete === true;
 * - both groups sort by the §16.1 key: mean desc → Q̄ desc → C̄ desc → id asc;
 *   null means sort last;
 * - only eligible rows receive numeric ranks (caller's job);
 * - the provisional leader is returned only when its mean exceeds the highest
 *   eligible mean, or when no complete model exists.
 */
export function deriveDisplayRanking(
  models: ModelAggregate[],
  _snapshotOrder: ReadonlyMap<string, number>,
): ExperimentDisplayRanking {
  const eligible = models.filter((m) => m.complete).sort((a, b) => compareByMeanThenOrder(a, b));
  const provisional = models
    .filter((m) => !m.complete)
    .sort((a, b) => compareByMeanThenOrder(a, b));

  const bestEligibleMean = eligible.length > 0 ? eligible[0].mean : null;
  const provisionalLeader =
    provisional.length > 0
      ? provisional[0].mean !== null &&
        (bestEligibleMean === null || provisional[0].mean > bestEligibleMean + WINNER_EPSILON)
        ? provisional[0]
        : null
      : null;

  return { eligible, provisional, provisionalLeader };
}

function compareByMeanThenOrder(a: ModelAggregate, b: ModelAggregate): number {
  // Spec §16.1 ranking key: mean(rankValue) desc → Q̄ desc → C̄ desc → candidate_id asc.
  // Epsilon-equiv values share a step; winners/ties still resolve on rankValue.
  const am = a.mean ?? -Infinity;
  const bm = b.mean ?? -Infinity;
  if (Math.abs(am - bm) >= WINNER_EPSILON) return bm - am;
  // Equal mean(rankValue): higher Q̄ ranks above.
  const aq = a.qMean ?? -Infinity;
  const bq = b.qMean ?? -Infinity;
  if (Math.abs(aq - bq) >= WINNER_EPSILON) return bq - aq;
  // Equal mean + Q̄: higher C̄ ranks above.
  const ac = a.cMean ?? -Infinity;
  const bc = b.cMean ?? -Infinity;
  if (Math.abs(ac - bc) >= WINNER_EPSILON) return bc - ac;
  // Final deterministic tie-break (spec §16.1): candidate_id ascending.
  // (Snapshot roster order is NOT part of the ranking key.)
  return a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : 0;
}
