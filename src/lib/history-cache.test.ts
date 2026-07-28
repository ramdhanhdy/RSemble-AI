import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getRunsCached,
  getRunCountCached,
  getModelTelemetryCached,
  invalidateHistoryCache,
  modelKey,
} from "./history-cache";
import { addRun, clearHistory } from "./run-history";

// Mock localStorage for node environment (same pattern as run-history.test.ts).
const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  });
  clearHistory();
  invalidateHistoryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("history-cache", () => {
  it("caches getRuns until invalidated", () => {
    addRun({
      taskExcerpt: "t1",
      models: ["openrouter:a/b"],
      stats: { "openrouter:a/b": { score: 4, latencyMs: 1000, costUsd: null } },
      winner: "openrouter:a/b",
      timestamp: 1,
    });
    invalidateHistoryCache();
    const first = getRunsCached();
    expect(first).toHaveLength(1);

    addRun({
      taskExcerpt: "t2",
      models: ["openrouter:c/d"],
      stats: { "openrouter:c/d": { score: 3, latencyMs: 2000, costUsd: null } },
      winner: "openrouter:c/d",
      timestamp: 2,
    });
    // Still cached — only one run visible
    expect(getRunsCached()).toHaveLength(1);
    invalidateHistoryCache();
    expect(getRunsCached()).toHaveLength(2);
  });

  it("caches getRunCount until invalidated", () => {
    expect(getRunCountCached()).toBe(0);
    addRun({
      taskExcerpt: "t",
      models: ["m"],
      stats: { m: { score: 5, latencyMs: 1, costUsd: null } },
      winner: "m",
      timestamp: 1,
    });
    expect(getRunCountCached()).toBe(0);
    invalidateHistoryCache();
    expect(getRunCountCached()).toBe(1);
  });

  it("caches telemetry per model key", () => {
    const key = modelKey("openrouter", "a/b");
    addRun({
      taskExcerpt: "t",
      models: [key],
      stats: { [key]: { score: 4, latencyMs: 1000, costUsd: null } },
      winner: key,
      timestamp: 1,
    });
    invalidateHistoryCache();
    const t1 = getModelTelemetryCached(key);
    expect(t1?.runCount).toBe(1);

    addRun({
      taskExcerpt: "t2",
      models: [key],
      stats: { [key]: { score: 5, latencyMs: 500, costUsd: null } },
      winner: key,
      timestamp: 2,
    });
    // Cached — still one run
    expect(getModelTelemetryCached(key)?.runCount).toBe(1);
    invalidateHistoryCache();
    expect(getModelTelemetryCached(key)?.runCount).toBe(2);
  });

  it("re-exports modelKey", () => {
    expect(modelKey("p", "s")).toBe("p:s");
  });
});
