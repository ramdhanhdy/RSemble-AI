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
// candidate_id (modelKey) asc — NOT by snapshot roster order. Epsilon-equal
// values are grouped transitively (union-find over the full model set) so the
// comparator is a strict weak ordering and standings are permutation-invariant
// (Executive decision t_be1828d9, option C).
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
  // Transitive-closure epsilon bucketing (Executive decision t_be1828d9,
  // option C, implemented per independent review finding 1): pairwise |x−y| < ε
  // is intransitive (4.0 ≈ 4.0+5e-10 ≈ 4.0+1e-9 breaks the relation at the
  // ends). A pairwise comparator alone cannot restore transitivity — equality
  // classes must be computed globally over the full model set (union-find),
  // then the comparator orders by class representatives. This makes the sort a
  // strict weak ordering: permutation-invariant regardless of input order.
  const buckets = buildEpsilonBuckets(models);
  const eligible = models
    .filter((m) => m.complete)
    .sort((a, b) => compareByMeanThenOrder(a, b, buckets));
  const provisional = models
    .filter((m) => !m.complete)
    .sort((a, b) => compareByMeanThenOrder(a, b, buckets));

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

/** Per-channel transitive epsilon-equivalence classes (union-find).
 *
 * For each channel (mean, Q̄, C̄) every model value is a node; two values are
 * unioned iff |a − b| < WINNER_EPSILON, and the union-find closure makes the
 * relation transitive across chains. Each model then maps to its component's
 * representative (the component's minimum value), so two models are
 * epsilon-equal iff they share a representative. Ordering by representatives
 * is a strict weak ordering: deterministic and permutation-invariant.
 */
interface EpsilonBuckets {
  mean: Map<string, number>;
  qMean: Map<string, number>;
  cMean: Map<string, number>;
}

function buildEpsilonBuckets(models: ModelAggregate[]): EpsilonBuckets {
  const build = (pick: (m: ModelAggregate) => number | null | undefined): Map<string, number> => {
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      let root = k;
      while (parent.get(root) !== root) {
        root = parent.get(root) ?? root;
      }
      // Path compression.
      let cur = k;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur) ?? root;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    // Value per model; null/undefined models participate with -Infinity (they
    // sort last and only tie-break by later keys, mirroring previous behavior).
    const valueOf = (m: ModelAggregate): number => pick(m) ?? -Infinity;
    for (const m of models) parent.set(m.modelKey, m.modelKey);
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const a = valueOf(models[i]);
        const b = valueOf(models[j]);
        if (Math.abs(a - b) < WINNER_EPSILON) {
          union(models[i].modelKey, models[j].modelKey);
        }
      }
    }
    // Representative per component: the minimum value in the class.
    const repValue = new Map<string, number>();
    for (const m of models) {
      const root = find(m.modelKey);
      const v = valueOf(m);
      const cur = repValue.get(root);
      repValue.set(root, cur === undefined ? v : Math.min(cur, v));
    }
    const out = new Map<string, number>();
    for (const m of models) out.set(m.modelKey, repValue.get(find(m.modelKey))!);
    return out;
  };

  return {
    mean: build((m) => m.mean),
    qMean: build((m) => m.qMean),
    cMean: build((m) => m.cMean),
  };
}

function compareByMeanThenOrder(
  a: ModelAggregate,
  b: ModelAggregate,
  buckets: EpsilonBuckets,
): number {
  // Spec §16.1 ranking key: mean(rankValue) desc → Q̄ desc → C̄ desc → candidate_id asc.
  // Values are compared via their transitive epsilon-equivalence class
  // representative (Executive decision t_be1828d9 option C; review finding 1).
  const am = buckets.mean.get(a.modelKey) ?? -Infinity;
  const bm = buckets.mean.get(b.modelKey) ?? -Infinity;
  if (am !== bm) return bm - am;
  // Equal mean(rankValue) class: higher Q̄ class ranks above.
  const aq = buckets.qMean.get(a.modelKey) ?? -Infinity;
  const bq = buckets.qMean.get(b.modelKey) ?? -Infinity;
  if (aq !== bq) return bq - aq;
  // Equal mean + Q̄ classes: higher C̄ class ranks above.
  const ac = buckets.cMean.get(a.modelKey) ?? -Infinity;
  const bc = buckets.cMean.get(b.modelKey) ?? -Infinity;
  if (ac !== bc) return bc - ac;
  // Final deterministic tie-break (spec §16.1): candidate_id ascending.
  // (Snapshot roster order is NOT part of the ranking key.)
  return a.modelKey < b.modelKey ? -1 : a.modelKey > b.modelKey ? 1 : 0;
}
