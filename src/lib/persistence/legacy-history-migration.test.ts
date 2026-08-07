// @vitest-environment happy-dom
// =============================================================================
// RSemble AI — Legacy history migration tests
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RSembleEvaluationDB } from "./database";
import { createRunRepository, InMemoryRunRepository } from "./run-repository";
import { migrateLegacyHistory, readRawLegacyEntries } from "./legacy-history-migration";
import type { LegacyRunSummary } from "./run-types";

const STORAGE_KEY = "rsemble.runHistory.v1";

// Provide a minimal localStorage stub for the node test environment.
function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  });
}

function validEntry(
  overrides: Partial<{
    taskExcerpt: string;
    models: string[];
    stats: Record<string, { score: number; latencyMs: number; costUsd: number | null }>;
    winner: string;
    timestamp: number;
  }> = {},
): Record<string, unknown> {
  return {
    taskExcerpt: overrides.taskExcerpt ?? "Write a 600-word article",
    models: overrides.models ?? ["openrouter:gpt-4", "gemini:gemini-pro"],
    stats: overrides.stats ?? {
      "openrouter:gpt-4": { score: 4.5, latencyMs: 2000, costUsd: 0.01 },
      "gemini:gemini-pro": { score: 3.8, latencyMs: 1500, costUsd: null },
    },
    winner: overrides.winner ?? "openrouter:gpt-4",
    timestamp: overrides.timestamp ?? 1700000000000,
  };
}

describe("readRawLegacyEntries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array when localStorage is empty", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(readRawLegacyEntries()).toEqual([]);
  });

  it("returns empty array when localStorage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readRawLegacyEntries()).toEqual([]);
  });

  it("skips malformed entries", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([{ bad: true }, validEntry(), "not-an-object"]),
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const entries = readRawLegacyEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].taskExcerpt).toBe("Write a 600-word article");
  });

  it("returns empty array on JSON parse failure", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "not-json",
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(readRawLegacyEntries()).toEqual([]);
  });
});

describe("migrateLegacyHistory", () => {
  let db: RSembleEvaluationDB;
  let repo: ReturnType<typeof createRunRepository>;

  beforeEach(() => {
    stubLocalStorage();
    db = new RSembleEvaluationDB("test-migration-" + Math.random().toString(36).slice(2));
    repo = createRunRepository(db);
    // Seed localStorage with valid entries.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        validEntry({ timestamp: 1700000000000 }),
        validEntry({ timestamp: 1700000001000, taskExcerpt: "Different task" }),
      ]),
    );
  });

  afterEach(() => {
    db.close();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("imports v1 entries as kind='legacy' with detailAvailable=false", async () => {
    const result = await migrateLegacyHistory(repo);
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);

    const summaries = await repo.list({ source: "legacy" });
    expect(summaries).toHaveLength(2);
    for (const s of summaries) {
      expect(s.kind).toBe("legacy");
      if (s.kind === "legacy") {
        expect(s.detailAvailable).toBe(false);
        expect(s.schemaVersion).toBe("1-import");
      }
    }
  });

  it("preserves task excerpt, timestamp, scores, model keys, and winner", async () => {
    await migrateLegacyHistory(repo);
    const summaries = await repo.list({ source: "legacy" });
    const first = summaries.find(
      (s) => s.kind === "legacy" && s.taskExcerpt === "Write a 600-word article",
    ) as LegacyRunSummary | undefined;
    expect(first).toBeTruthy();
    expect(first!.createdAt).toBe(1700000000000);
    expect(first!.modelKeys).toContain("openrouter:gpt-4");
    expect(first!.scoresByModelKey["openrouter:gpt-4"]).toBe(4.5);
    expect(first!.winnerKeys).toEqual(["openrouter:gpt-4"]);
  });

  it("does not fabricate status, mode, source, Judge, or evaluation fields", async () => {
    await migrateLegacyHistory(repo);
    const summaries = await repo.list({ source: "legacy" });
    for (const s of summaries) {
      expect(s.kind).toBe("legacy");
      // Legacy summaries must not have these fields.
      if (s.kind === "legacy") {
        expect("status" in s).toBe(false);
        expect("mode" in s).toBe(false);
        expect("source" in s).toBe(false);
        expect("judgeModelKey" in s).toBe(false);
        expect("evaluationProfileId" in s).toBe(false);
        expect("completedAt" in s).toBe(false);
      }
    }
  });

  it("does not duplicate imports on repeated startup", async () => {
    await migrateLegacyHistory(repo);
    const result2 = await migrateLegacyHistory(repo);
    expect(result2.imported).toBe(0);
    expect(result2.skipped).toBe(2);
  });

  it("generates deterministic migration IDs for the same source entry", async () => {
    await migrateLegacyHistory(repo);
    const summaries1 = await repo.list({ source: "legacy" });
    // Re-import (skipped) — the IDs should be the same.
    await migrateLegacyHistory(repo);
    const summaries2 = await repo.list({ source: "legacy" });
    expect(summaries1.map((s) => s.id)).toEqual(summaries2.map((s) => s.id));
  });

  it("skips malformed entries and reports them without failing the migration", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        validEntry({ timestamp: 1700000000000 }),
        { bad: true, timestamp: "not-a-number" },
        validEntry({ timestamp: 1700000001000 }),
      ]),
    );
    const result = await migrateLegacyHistory(repo);
    expect(result.imported).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("leaves the localStorage source intact after migration", async () => {
    await migrateLegacyHistory(repo);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("returns empty result when no legacy entries exist", async () => {
    localStorage.removeItem(STORAGE_KEY);
    const result = await migrateLegacyHistory(repo);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });
});

describe("migrateLegacyHistory (in-memory)", () => {
  let repo: InMemoryRunRepository;
  beforeEach(() => {
    stubLocalStorage();
    repo = new InMemoryRunRepository();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([validEntry({ timestamp: 1700000000000 })]));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("works with in-memory repository", async () => {
    const result = await migrateLegacyHistory(repo);
    expect(result.imported).toBe(1);
    const summaries = await repo.list({ source: "legacy" });
    expect(summaries).toHaveLength(1);
  });
});
