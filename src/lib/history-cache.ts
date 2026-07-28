// =============================================================================
// Run history cache — memoizes one localStorage snapshot and all derived views.
// One read + one aggregation pass per invalidation, regardless of model count.
// =============================================================================

import {
  getRuns,
  type RunHistoryEntry,
  type ModelTelemetry,
  type ModelRunStats,
} from "./run-history";

export type { RunHistoryEntry, ModelTelemetry };
export { modelKey } from "./run-history";

interface TelemetryAccumulator {
  wins: number;
  scoreSum: number;
  latencySum: number;
  costSum: number;
  costCount: number;
  scoredCount: number;
  runCount: number;
}

interface Cache {
  runs: RunHistoryEntry[] | null;
  runsByModel: Map<string, RunHistoryEntry[]> | null;
  telemetry: Map<string, ModelTelemetry> | null;
}

const cache: Cache = {
  runs: null,
  runsByModel: null,
  telemetry: null,
};

function bareSlug(key: string): string | null {
  const separator = key.indexOf(":");
  return separator >= 0 ? key.slice(separator + 1) : null;
}

function addTarget(targets: Map<string, string[]>, target: string, sourceKey: string): void {
  const sources = targets.get(target);
  if (sources) {
    if (!sources.includes(sourceKey)) sources.push(sourceKey);
  } else {
    targets.set(target, [sourceKey]);
  }
}

function addStats(acc: TelemetryAccumulator, stats: ModelRunStats | undefined): void {
  if (!stats) return;
  acc.scoreSum += stats.score;
  acc.latencySum += stats.latencyMs;
  if (stats.costUsd !== null) {
    acc.costSum += stats.costUsd;
    acc.costCount += 1;
  }
  acc.scoredCount += 1;
}

function ensureSnapshot(): void {
  if (cache.runs !== null && cache.runsByModel !== null && cache.telemetry !== null) return;

  const runs = getRuns();
  const runsByModel = new Map<string, RunHistoryEntry[]>();
  const accumulators = new Map<string, TelemetryAccumulator>();

  for (const run of runs) {
    const targets = new Map<string, string[]>();
    const exactKeys = new Set([...run.models, ...Object.keys(run.stats)]);
    for (const key of exactKeys) {
      addTarget(targets, key, key);
      const alias = bareSlug(key);
      if (alias) addTarget(targets, alias, key);
    }

    for (const [target, sourceKeys] of targets) {
      const modelRuns = runsByModel.get(target);
      if (modelRuns) modelRuns.push(run);
      else runsByModel.set(target, [run]);

      let acc = accumulators.get(target);
      if (!acc) {
        acc = {
          wins: 0,
          scoreSum: 0,
          latencySum: 0,
          costSum: 0,
          costCount: 0,
          scoredCount: 0,
          runCount: 0,
        };
        accumulators.set(target, acc);
      }
      acc.runCount += 1;
      if (run.winner === target || sourceKeys.includes(run.winner)) acc.wins += 1;
      for (const sourceKey of sourceKeys) addStats(acc, run.stats[sourceKey]);
    }
  }

  const telemetry = new Map<string, ModelTelemetry>();
  for (const [key, acc] of accumulators) {
    const scoreDenom = acc.scoredCount > 0 ? acc.scoredCount : 1;
    telemetry.set(key, {
      winRate: acc.runCount > 0 ? acc.wins / acc.runCount : 0,
      avgScore: acc.scoreSum / scoreDenom,
      runCount: acc.runCount,
      avgLatencyMs: acc.latencySum / scoreDenom,
      avgCostUsd: acc.costCount > 0 ? acc.costSum / acc.costCount : null,
    });
  }

  cache.runs = runs;
  cache.runsByModel = runsByModel;
  cache.telemetry = telemetry;
}

/** Invalidate all cached history data. Call after addRun / clearHistory. */
export function invalidateHistoryCache(): void {
  cache.runs = null;
  cache.runsByModel = null;
  cache.telemetry = null;
}

/** Cached getRuns — sorts and aggregates once, then returns the same array reference. */
export function getRunsCached(limit?: number): RunHistoryEntry[] {
  ensureSnapshot();
  const runs = cache.runs!;
  return typeof limit === "number" ? runs.slice(0, limit) : runs;
}

export function getRunCountCached(): number {
  ensureSnapshot();
  return cache.runs!.length;
}

export function getRunsForModelCached(key: string): RunHistoryEntry[] {
  ensureSnapshot();
  return cache.runsByModel!.get(key) ?? [];
}

export function getModelTelemetryCached(key: string): ModelTelemetry | null {
  ensureSnapshot();
  return cache.telemetry!.get(key) ?? null;
}

// Re-export the raw mutation functions so callers can invalidate after write.
export { addRun, clearHistory } from "./run-history";
