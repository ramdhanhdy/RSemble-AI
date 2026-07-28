import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  modelKey,
  addRun,
  getRuns,
  getRunsForModel,
  getModelTelemetry,
  clearHistory,
  getRunCount,
  getScoreHistory,
  type RunHistoryEntry,
} from "./run-history";

// Mock localStorage for node environment
const store: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEntry(
  models: string[],
  stats: Record<string, { score: number; latencyMs: number; costUsd: number | null }>,
  winner: string,
): RunHistoryEntry {
  return {
    taskExcerpt: "test task",
    models,
    stats,
    winner,
    timestamp: Date.now(),
  };
}

describe("modelKey", () => {
  it("builds a provider-scoped composite key", () => {
    expect(modelKey("openrouter", "z-ai/glm-5.2")).toBe("openrouter:z-ai/glm-5.2");
    expect(modelKey("umans", "glm-5.2")).toBe("umans:glm-5.2");
  });
});

describe("addRun / getRuns — provider-scoped identity", () => {
  it("stores entries with composite keys and retrieves them", () => {
    const key1 = modelKey("openrouter", "z-ai/glm-5.2");
    const key2 = modelKey("umans", "glm-5.2");
    addRun(makeEntry(
      [key1, key2],
      { [key1]: { score: 4.5, latencyMs: 1000, costUsd: null }, [key2]: { score: 3.8, latencyMs: 800, costUsd: null } },
      key1,
    ));
    const runs = getRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].winner).toBe("openrouter:z-ai/glm-5.2");
    expect(runs[0].stats["openrouter:z-ai/glm-5.2"].score).toBe(4.5);
    expect(runs[0].stats["umans:glm-5.2"].score).toBe(3.8);
  });

  it("identical slugs from different providers coexist without collision", () => {
    const keyOR = modelKey("openrouter", "shared-model");
    const keyUmans = modelKey("umans", "shared-model");
    addRun(makeEntry(
      [keyOR, keyUmans],
      {
        [keyOR]: { score: 4.0, latencyMs: 1000, costUsd: null },
        [keyUmans]: { score: 3.5, latencyMs: 900, costUsd: null },
      },
      keyOR,
    ));
    const runs = getRuns();
    expect(runs[0].stats["openrouter:shared-model"].score).toBe(4.0);
    expect(runs[0].stats["umans:shared-model"].score).toBe(3.5);
    // Both keys present, no collision
    expect(Object.keys(runs[0].stats)).toHaveLength(2);
  });
});

describe("getRunsForModel — provider-scoped lookup", () => {
  it("finds runs by composite key", () => {
    const key = modelKey("openrouter", "z-ai/glm-5.2");
    addRun(makeEntry([key], { [key]: { score: 4.5, latencyMs: 1000, costUsd: null } }, key));
    const runs = getRunsForModel(key);
    expect(runs).toHaveLength(1);
  });

  it("does not cross-match identical slugs across providers", () => {
    const keyOR = modelKey("openrouter", "shared-model");
    const keyUmans = modelKey("umans", "shared-model");
    addRun(makeEntry([keyOR], { [keyOR]: { score: 4.0, latencyMs: 1000, costUsd: null } }, keyOR));
    addRun(makeEntry([keyUmans], { [keyUmans]: { score: 3.0, latencyMs: 800, costUsd: null } }, keyUmans));
    const orRuns = getRunsForModel(keyOR);
    const umansRuns = getRunsForModel(keyUmans);
    expect(orRuns).toHaveLength(1);
    expect(umansRuns).toHaveLength(1);
    expect(orRuns[0].stats[keyOR].score).toBe(4.0);
    expect(umansRuns[0].stats[keyUmans].score).toBe(3.0);
  });
});

describe("legacy history migration", () => {
  it("tolerates legacy bare-slug keys without crashing", () => {
    // Simulate a legacy entry with bare slug keys
    store["rsemble.runHistory.v1"] = JSON.stringify([{
      taskExcerpt: "old task",
      models: ["z-ai/glm-5.2"],
      stats: { "z-ai/glm-5.2": { score: 4.0, latencyMs: 1000, costUsd: null } },
      winner: "z-ai/glm-5.2",
      timestamp: Date.now() - 10000,
    }]);
    const runs = getRuns();
    expect(runs).toHaveLength(1);
    // The bare key should be migrated or preserved, not crash
    const statsKeys = Object.keys(runs[0].stats);
    expect(statsKeys.length).toBeGreaterThanOrEqual(1);
  });

  it("infers provider from known slug patterns during migration", () => {
    store["rsemble.runHistory.v1"] = JSON.stringify([{
      taskExcerpt: "old task",
      models: ["gpt-4o"],
      stats: { "gpt-4o": { score: 4.2, latencyMs: 1200, costUsd: null } },
      winner: "gpt-4o",
      timestamp: Date.now() - 10000,
    }]);
    const runs = getRuns();
    // gpt- prefix should infer chatgpt-codex provider
    expect(Object.keys(runs[0].stats)).toContain("chatgpt-codex:gpt-4o");
    expect(runs[0].winner).toBe("chatgpt-codex:gpt-4o");
  });

  it("preserves unknown bare keys that cannot be migrated", () => {
    store["rsemble.runHistory.v1"] = JSON.stringify([{
      taskExcerpt: "old task",
      models: ["unknown-model"],
      stats: { "unknown-model": { score: 3.5, latencyMs: 900, costUsd: null } },
      winner: "unknown-model",
      timestamp: Date.now() - 10000,
    }]);
    const runs = getRuns();
    // Unknown slug can't be inferred, but it's preserved, not dropped
    expect(Object.keys(runs[0].stats)).toContain("unknown-model");
  });
});

describe("getModelTelemetry", () => {
  it("computes win rate and average score from provider-scoped history", () => {
    const key = modelKey("openrouter", "z-ai/glm-5.2");
    const otherKey = modelKey("umans", "glm-5.2");
    addRun(makeEntry([key, otherKey], {
      [key]: { score: 4.5, latencyMs: 1000, costUsd: null },
      [otherKey]: { score: 3.0, latencyMs: 800, costUsd: null },
    }, key));
    addRun(makeEntry([key, otherKey], {
      [key]: { score: 4.0, latencyMs: 1100, costUsd: null },
      [otherKey]: { score: 4.2, latencyMs: 700, costUsd: null },
    }, otherKey));
    const t = getModelTelemetry(key);
    expect(t).not.toBeNull();
    expect(t!.runCount).toBe(2);
    expect(t!.winRate).toBe(0.5);
    expect(t!.avgScore).toBeCloseTo(4.25, 2);
  });
});

describe("getScoreHistory", () => {
  it("returns scores from recent runs for a model", () => {
    const key = modelKey("openrouter", "z-ai/glm-5.2");
    for (let i = 0; i < 3; i++) {
      addRun(makeEntry([key], { [key]: { score: 4.0 + i * 0.5, latencyMs: 1000, costUsd: null } }, key));
    }
    const scores = getScoreHistory(key, 10);
    expect(scores).toHaveLength(3);
  });
});

describe("clearHistory", () => {
  it("removes all entries", () => {
    const key = modelKey("openrouter", "z-ai/glm-5.2");
    addRun(makeEntry([key], { [key]: { score: 4.0, latencyMs: 1000, costUsd: null } }, key));
    expect(getRunCount()).toBe(1);
    clearHistory();
    expect(getRunCount()).toBe(0);
  });
});
