// =============================================================================
// Run history cache — memoizes localStorage reads and telemetry computation.
// One read + one pass per invalidation, not one per model on every render.
// =============================================================================

import {
  getRuns,
  getModelTelemetry,
  getRunCount,
  type RunHistoryEntry,
  type ModelTelemetry,
} from "./run-history";

export type { RunHistoryEntry, ModelTelemetry };
export { modelKey } from "./run-history";

interface Cache {
  runs: RunHistoryEntry[] | null;
  telemetry: Map<string, ModelTelemetry | null>;
  runCount: number | null;
}

const cache: Cache = {
  runs: null,
  telemetry: new Map(),
  runCount: null,
};

/** Invalidate all cached history data. Call after addRun / clearHistory. */
export function invalidateHistoryCache(): void {
  cache.runs = null;
  cache.telemetry.clear();
  cache.runCount = null;
}

/** Cached getRuns — sorts once, returns the same array reference. */
export function getRunsCached(limit?: number): RunHistoryEntry[] {
  if (cache.runs === null) {
    cache.runs = getRuns();
  }
  const sorted = cache.runs;
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

/** Cached getRunCount. */
export function getRunCountCached(): number {
  if (cache.runCount === null) {
    cache.runCount = getRunCount();
  }
  return cache.runCount;
}

/** Cached getRunsForModel. */
export function getRunsForModelCached(key: string): RunHistoryEntry[] {
  // We don't cache per-model runs because the key space is unbounded;
  // instead we cache the full sorted list and filter on demand.
  const runs = getRunsCached();
  const isComposite = key.includes(":");
  return runs.filter((r) => {
    if (isComposite) {
      return key in r.stats || r.models.includes(key);
    }
    const slug = key;
    return (
      Object.keys(r.stats).some((k) => k.endsWith(`:${slug}`) || k === slug) ||
      r.models.some((m) => m === slug || m.endsWith(`:${slug}`))
    );
  });
}

/** Cached getModelTelemetry — one pass per model, then memoized. */
export function getModelTelemetryCached(key: string): ModelTelemetry | null {
  if (cache.telemetry.has(key)) {
    return cache.telemetry.get(key) ?? null;
  }
  const telemetry = getModelTelemetry(key);
  cache.telemetry.set(key, telemetry);
  return telemetry;
}

// Re-export the raw mutation functions so callers can invalidate after write.
export { addRun, clearHistory } from "./run-history";
