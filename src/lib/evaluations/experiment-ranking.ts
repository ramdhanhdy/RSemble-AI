// =============================================================================
// experiment-ranking.ts — display ranking for experiment results (spec §10).
//
// Standings use two groups:
//   1. Eligible standings: complete models sorted by raw mean, numbered #1..#N.
//   2. Provisional results: incomplete models sorted by raw mean, no numbers.
//
// The provisional score leader is returned only when its mean exceeds the
// highest eligible mean or when no complete model exists. Equal means preserve
// snapshot roster order.
//
// Winner math itself is untouched — this module only derives display groups.
// =============================================================================

import type { ModelAggregate } from "./experiment-aggregation";
import { WINNER_EPSILON } from "./evaluation-profile";

export interface ExperimentDisplayRanking {
  /** Complete models sorted by raw mean descending (roster order on ties). */
  eligible: ModelAggregate[];
  /** Incomplete models sorted by raw mean descending (roster order on ties). */
  provisional: ModelAggregate[];
  /** The incomplete model with the highest mean, when it outranks the
   *  eligible winner or when no complete model exists. Otherwise null. */
  provisionalLeader: ModelAggregate | null;
}

/**
 * Derive display groups from raw aggregates.
 *
 * Rules (spec §10.3):
 * - eligible means complete === true;
 * - both groups sort by raw mean descending; null means sort last;
 * - equal means preserve snapshot roster order (stable sort by original index);
 * - only eligible rows receive numeric ranks (caller's job);
 * - the provisional leader is returned only when its mean exceeds the highest
 *   eligible mean, or when no complete model exists.
 */
export function deriveDisplayRanking(
  models: ModelAggregate[],
  snapshotOrder: ReadonlyMap<string, number>,
): ExperimentDisplayRanking {
  const eligible = models
    .filter((m) => m.complete)
    .sort((a, b) => compareByMeanThenOrder(a, b, snapshotOrder));
  const provisional = models
    .filter((m) => !m.complete)
    .sort((a, b) => compareByMeanThenOrder(a, b, snapshotOrder));

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

function compareByMeanThenOrder(
  a: ModelAggregate,
  b: ModelAggregate,
  order: ReadonlyMap<string, number>,
): number {
  const am = a.mean ?? -Infinity;
  const bm = b.mean ?? -Infinity;
  if (Math.abs(am - bm) >= WINNER_EPSILON) return bm - am;
  return (order.get(a.modelKey) ?? 0) - (order.get(b.modelKey) ?? 0);
}
