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

  it("epsilon-chain values are transitive: permutation-invariant standings", () => {
    // Regression (CodeRabbit 3741038014 / Executive decision 2026-08-08):
    // values 4.0, 4.0+5e-10, 4.0+1e-9 are pairwise-within-ε chained, so the
    // comparator must treat them as epsilon-equal (id asc tie-break) and the
    // sort output must NOT depend on input order.
    const a = model("a", 4.0, true, 0, { q: 4.0, c: 0.9 });
    const b = model("b", 4.0 + 5e-10, true, 1, { q: 4.0 + 5e-10, c: 0.9 });
    const c = model("c", 4.0 + 1e-9, true, 2, { q: 4.0 + 1e-9, c: 0.9 });
    const expected = ["a", "b", "c"];
    // All six input permutations must produce the same standings.
    const permutations: ModelAggregate[][] = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    for (const p of permutations) {
      const result = deriveDisplayRanking(p, order("a", "b", "c"));
      expect(result.eligible.map((m) => m.modelKey)).toEqual(expected);
    }
  });

  it("values beyond an epsilon chain still order by raw mean", () => {
    // 4.0 and 4.0+3e-9 differ by 3ε: no chain connects them, so the higher
    // mean strictly outranks regardless of the id tie-break.
    const a = model("a", 4.0, true, 0, { q: 4.0, c: 0.9 });
    const b = model("b", 4.0 + 3e-9, true, 1, { q: 4.0 + 3e-9, c: 0.9 });
    const result = deriveDisplayRanking([a, b], order("a", "b"));
    expect(result.eligible.map((m) => m.modelKey)).toEqual(["b", "a"]);
  });

  it("long epsilon chains close transitively (independent review finding 1)", () => {
    // Regression for the reviewer's counterexample: 0, 0.9ε, 1.8ε, 2.7ε are
    // chain-connected (each adjacent pair within ε) even though the endpoints
    // differ by 2.7ε > 2ε. A fixed 2ε band (the earlier midpoint heuristic)
    // failed to merge the endpoints; the union-find closure must.
    const a = model("a", 0, true, 0, { q: 0, c: 0.9 });
    const b = model("b", 0.9e-9, true, 1, { q: 0.9e-9, c: 0.9 });
    const c = model("c", 1.8e-9, true, 2, { q: 1.8e-9, c: 0.9 });
    const d = model("d", 2.7e-9, true, 3, { q: 2.7e-9, c: 0.9 });
    const expected = ["a", "b", "c", "d"];
    const permutations: ModelAggregate[][] = [
      [a, b, c, d],
      [d, c, b, a],
      [b, d, a, c],
      [c, a, d, b],
    ];
    for (const p of permutations) {
      const result = deriveDisplayRanking(p, order("a", "b", "c", "d"));
      expect(result.eligible.map((m) => m.modelKey)).toEqual(expected);
    }
  });

  it("straddle values at exactly ε apart stay epsilon-equal through a bridge", () => {
    // 4.0 and 4.0+1e-9 differ by exactly ε (not < ε, so not directly equal),
    // but a bridge value 4.0+5e-10 connects them: the closure must merge them
    // into one class and the id tie-break applies.
    const a = model("a", 4.0, true, 0, { q: 4.0, c: 0.9 });
    const b = model("b", 4.0 + 5e-10, true, 1, { q: 4.0 + 5e-10, c: 0.9 });
    const c = model("c", 4.0 + 1e-9, true, 2, { q: 4.0 + 1e-9, c: 0.9 });
    const result = deriveDisplayRanking([c, a, b], order("a", "b", "c"));
    expect(result.eligible.map((m) => m.modelKey)).toEqual(["a", "b", "c"]);
  });
});
