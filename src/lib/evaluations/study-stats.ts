// =============================================================================
// RSemble AI — Fusion Study statistics (fusion-study spec §7.4)
//
// Paired task-level analysis for blocked policy comparisons:
//   d_t = mean(S_P,t) − mean(S_Q,t)      (repeats averaged within task)
//
// The TASK is the generalization unit — 20 tasks × 3 generations is not
// n = 60. Bootstrap CIs resample task deltas with replacement; a sign-flip
// permutation check gives exact small-N sensitivity. Verdicts are predeclared
// against an MPID (minimum practically important difference):
//
//   adopt          — CI lower bound ≥ MPID (confidently clears the bar)
//   not_justified  — CI upper bound < MPID (confidently fails the bar)
//   inconclusive   — CI straddles the MPID (an honest outcome)
// =============================================================================

export interface PolicyTaskRepeats {
  taskId: string;
  /** Repeated holdout scores for policy P on this task (≥1). */
  scoresP: number[];
  /** Repeated holdout scores for policy Q on this task (≥1). */
  scoresQ: number[];
}

export type MpidVerdict = "adopt" | "not_justified" | "inconclusive";

export interface PairedDeltaStats {
  meanDelta: number;
  medianDelta: number;
  wins: number;
  ties: number;
  losses: number;
  ciLevel: number;
  ciLow: number;
  ciHigh: number;
  /** Exact sign-flip permutation p-value for H0: mean delta = 0. */
  permutationP: number | null;
  tasksUsed: number;
  mpid: number;
  verdict: MpidVerdict;
}

export interface PairedDeltaOptions {
  /** Minimum practically important difference (predeclared product threshold). */
  mpid: number;
  ciLevel?: number;
  bootstrapSamples?: number;
  /** Injectable RNG for deterministic tests. */
  rng?: () => number;
  /** |d| below this counts as a tie. */
  tieEpsilon?: number;
  /** Tasks at or below this count get the exact permutation check. */
  exactPermutationMaxTasks?: number;
}

/**
 * Per-task paired deltas with repeats averaged within task — the defensible
 * v1 (spec §7.4). Tasks missing scores on either side are dropped.
 */
export function pairedTaskDeltas(
  tasks: PolicyTaskRepeats[],
): Array<{ taskId: string; delta: number }> {
  const deltas: Array<{ taskId: string; delta: number }> = [];
  for (const t of tasks) {
    if (t.scoresP.length === 0 || t.scoresQ.length === 0) continue;
    const meanP = t.scoresP.reduce((a, v) => a + v, 0) / t.scoresP.length;
    const meanQ = t.scoresQ.reduce((a, v) => a + v, 0) / t.scoresQ.length;
    deltas.push({ taskId: t.taskId, delta: meanP - meanQ });
  }
  return deltas;
}

/** Bootstrap percentile CI over TASK deltas — tasks are the resample unit. */
export function bootstrapTaskCi(
  deltas: number[],
  opts: { ciLevel: number; samples: number; rng: () => number },
): { low: number; high: number } {
  const n = deltas.length;
  if (n === 0) return { low: 0, high: 0 };
  const means: number[] = [];
  for (let s = 0; s < opts.samples; s++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += deltas[Math.floor(opts.rng() * n)];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const alpha = 1 - opts.ciLevel;
  const loIdx = Math.min(means.length - 1, Math.max(0, Math.floor((alpha / 2) * means.length)));
  const hiIdx = Math.min(
    means.length - 1,
    Math.max(0, Math.ceil((1 - alpha / 2) * means.length) - 1),
  );
  return { low: means[loIdx], high: means[hiIdx] };
}

/**
 * Exact sign-flip permutation p-value (two-sided) for H0: the paired deltas
 * are symmetric about zero. Enumerates all 2^N sign assignments — the exact
 * small-N sensitivity check (spec §7.4).
 */
export function signFlipPermutationP(deltas: number[]): number {
  const n = deltas.length;
  if (n === 0) return 1;
  const observed = Math.abs(deltas.reduce((a, v) => a + v, 0) / n);
  const total = 2 ** n;
  let extreme = 0;
  for (let assignment = 0; assignment < total; assignment++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += (assignment >> i) & 1 ? deltas[i] : -deltas[i];
    }
    if (Math.abs(sum / n) >= observed - 1e-12) extreme += 1;
  }
  return extreme / total;
}

/** MPID verdict: does the interval clear the predeclared bar? */
export function mpidVerdict(ciLow: number, ciHigh: number, mpid: number): MpidVerdict {
  if (ciLow >= mpid) return "adopt";
  if (ciHigh < mpid) return "not_justified";
  return "inconclusive";
}

/**
 * Full finalist comparison: mean/median paired delta, wins/ties/losses,
 * bootstrap CI (task resample unit), exact sign-flip sensitivity for small N,
 * and the predeclared MPID verdict.
 */
export function pairedDeltaComparison(
  tasks: PolicyTaskRepeats[],
  opts: PairedDeltaOptions,
): PairedDeltaStats {
  const rng = opts.rng ?? Math.random;
  const ciLevel = opts.ciLevel ?? 0.9;
  const samples = opts.bootstrapSamples ?? 4000;
  const tieEpsilon = opts.tieEpsilon ?? 1e-9;
  const exactMax = opts.exactPermutationMaxTasks ?? 20;

  const deltaRows = pairedTaskDeltas(tasks);
  const deltas = deltaRows.map((d) => d.delta);
  const n = deltas.length;

  if (n === 0) {
    return {
      meanDelta: 0,
      medianDelta: 0,
      wins: 0,
      ties: 0,
      losses: 0,
      ciLevel,
      ciLow: 0,
      ciHigh: 0,
      permutationP: null,
      tasksUsed: 0,
      mpid: opts.mpid,
      verdict: "inconclusive",
    };
  }

  const sorted = [...deltas].sort((a, b) => a - b);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const meanDelta = deltas.reduce((a, v) => a + v, 0) / n;

  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const d of deltas) {
    if (d > tieEpsilon) wins += 1;
    else if (d < -tieEpsilon) losses += 1;
    else ties += 1;
  }

  const { low, high } = bootstrapTaskCi(deltas, { ciLevel, samples, rng });
  const permutationP = n <= exactMax ? signFlipPermutationP(deltas) : null;

  return {
    meanDelta,
    medianDelta: median,
    wins,
    ties,
    losses,
    ciLevel,
    ciLow: low,
    ciHigh: high,
    permutationP,
    tasksUsed: n,
    mpid: opts.mpid,
    verdict: mpidVerdict(low, high, opts.mpid),
  };
}
