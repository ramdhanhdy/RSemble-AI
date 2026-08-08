// =============================================================================
// experiment-ranking.test.ts — display ranking group rules (spec §10.3).
// =============================================================================
import { describe, expect, it } from "vitest";
import { deriveDisplayRanking } from "./experiment-ranking";
import type { ModelAggregate } from "./experiment-aggregation";

function model(
  modelKey: string,
  mean: number | null,
  complete: boolean,
  _index: number,
  opts: { q?: number | null; c?: number | null; floored?: number } = {},
): ModelAggregate {
  return {
    modelKey,
    mean,
    qMean: opts.q ?? null,
    cMean: opts.c ?? null,
    flooredTaskCount: opts.floored ?? 0,
    scoredTasks: complete ? 15 : 14,
    totalTasks: 15,
    complete,
  };
}

function order(...keys: string[]): ReadonlyMap<string, number> {
  return new Map(keys.map((k, i) => [k, i]));
}

describe("deriveDisplayRanking", () => {
  it("groups complete models as eligible and incomplete as provisional", () => {
    const complete = model("umans:model", 4.38, true, 0);
    const provisional = model("9router:model", 4.54, false, 1);
    const result = deriveDisplayRanking(
      [complete, provisional],
      order("umans:model", "9router:model"),
    );

    expect(result.eligible).toEqual([complete]);
    expect(result.provisional).toEqual([provisional]);
  });

  it("returns the provisional leader only when its mean exceeds the eligible winner", () => {
    const complete = model("umans:model", 4.38, true, 0);
    const provisional = model("9router:model", 4.54, false, 1);
    const result = deriveDisplayRanking(
      [complete, provisional],
      order("umans:model", "9router:model"),
    );

    expect(result.provisionalLeader?.modelKey).toBe("9router:model");
  });

  it("returns no provisional leader when the incomplete mean is lower", () => {
    const complete = model("umans:model", 4.38, true, 0);
    const lower = model("9router:model", 4.2, false, 1);
    const result = deriveDisplayRanking([complete, lower], order("umans:model", "9router:model"));

    expect(result.provisionalLeader).toBeNull();
  });

  it("returns a provisional leader when no complete model exists", () => {
    const a = model("9router:a", 4.1, false, 0);
    const b = model("9router:b", 4.5, false, 1);
    const result = deriveDisplayRanking([a, b], order("9router:a", "9router:b"));

    expect(result.eligible).toEqual([]);
    expect(result.provisionalLeader?.modelKey).toBe("9router:b");
  });

  it("sorts eligible standings by raw mean descending", () => {
    const low = model("openrouter:low", 4.0, true, 0);
    const high = model("openrouter:high", 4.8, true, 1);
    const mid = model("openrouter:mid", 4.4, true, 2);
    const result = deriveDisplayRanking(
      [low, high, mid],
      order("openrouter:low", "openrouter:high", "openrouter:mid"),
    );

    expect(result.eligible.map((m) => m.modelKey)).toEqual([
      "openrouter:high",
      "openrouter:mid",
      "openrouter:low",
    ]);
  });

  it("preserves snapshot roster order on equal means", () => {
    const a = model("openrouter:a", 4.0, true, 0);
    const b = model("openrouter:b", 4.0, true, 1);
    const result = deriveDisplayRanking([b, a], order("openrouter:a", "openrouter:b"));

    expect(result.eligible.map((m) => m.modelKey)).toEqual(["openrouter:a", "openrouter:b"]);
  });

  it("sorts provisional results by raw mean descending without numeric ranks", () => {
    const low = model("9router:low", 3.9, false, 0);
    const high = model("9router:high", 4.6, false, 1);
    const result = deriveDisplayRanking([low, high], order("9router:low", "9router:high"));

    expect(result.provisional.map((m) => m.modelKey)).toEqual(["9router:high", "9router:low"]);
  });

  it("sorts null-mean models last within their group", () => {
    const noScores = model("9router:none", null, false, 0);
    const scored = model("9router:scored", 3.5, false, 1);
    const result = deriveDisplayRanking(
      [noScores, scored],
      order("9router:none", "9router:scored"),
    );

    expect(result.provisional.map((m) => m.modelKey)).toEqual(["9router:scored", "9router:none"]);
  });
});

describe("deriveDisplayRanking — spec §16.1 tie-break key", () => {
  it("equal mean(rankValue) breaks by higher Q̄", () => {
    // Same rankValue mean, different Q̄ → higher Q̄ ranks first.
    const a = model("a", 4.0, true, 0, { q: 4.5 });
    const b = model("b", 4.0, true, 1, { q: 3.5 });
    const result = deriveDisplayRanking([a, b], order("a", "b"));
    expect(result.eligible.map((m) => m.modelKey)).toEqual(["a", "b"]);
  });

  it("equal mean(rankValue) and Q̄ breaks by higher C̄", () => {
    // Same rankValue + Q̄, different C̄ → higher C̄ ranks first.
    const a = model("a", 4.0, true, 0, { q: 4.0, c: 0.9 });
    const b = model("b", 4.0, true, 1, { q: 4.0, c: 0.5 });
    const result = deriveDisplayRanking([a, b], order("a", "b"));
    expect(result.eligible.map((m) => m.modelKey)).toEqual(["a", "b"]);
  });

  it("equality through Q̄ and C̄ resolves by candidate_id ascending", () => {
    // Fully equal mean + Q̄ + C̄ → candidate_id asc (not roster order).
    const z = model("z", 4.0, true, 0, { q: 4.0, c: 0.9 });
    const a = model("a", 4.0, true, 1, { q: 4.0, c: 0.9 });
    const result = deriveDisplayRanking([z, a], order("z", "a"));
    // roster order says z first, but candidate_id asc says a first.
    expect(result.eligible.map((m) => m.modelKey)).toEqual(["a", "z"]);
  });

  it("epsilon-equivalent mean/Q̄/C̄ values share the same ordering step", () => {
    // Values within WINNER_EPSILON are equivalent, so the id tiebreak applies.
    const a = model("a", 4.0, true, 0, { q: 4.0, c: 0.9 });
    const b = model("b", 4.0 + 1e-12, true, 1, { q: 4.0 + 1e-12, c: 0.9 });
    const result = deriveDisplayRanking([b, a], order("b", "a"));
    // Roster order says b first, but id asc says a first (values are epsilon-equal).
    expect(result.eligible.map((m) => m.modelKey)).toEqual(["a", "b"]);
  });

  it("provisional models use the same tie-break key", () => {
    const a = model("a", 3.0, false, 0, { q: 4.0, c: 0.8 });
    const b = model("b", 3.0, false, 1, { q: 2.0, c: 0.8 });
    const result = deriveDisplayRanking([a, b], order("a", "b"));
    expect(result.provisional.map((m) => m.modelKey)).toEqual(["a", "b"]);
  });
});
