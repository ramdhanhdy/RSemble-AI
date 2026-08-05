import { afterEach, describe, expect, it } from "vitest";
import {
  costFromSnapshot,
  estimateCost,
  estimateRunCost,
  pricingFor,
} from "./cost";
import { clearModelPricing, parseOpenRouterPricing, setModelPricing } from "./providers/pricing";

afterEach(() => clearModelPricing());

describe("pricingFor exact provider-scoped lookup", () => {
  it("returns the exact catalog price for the provider:model pair", () => {
    setModelPricing(parseOpenRouterPricing("openrouter", "org/model", { prompt: "0.5", completion: "1.5" }, 1)!);
    expect(pricingFor("openrouter", "org/model")).toEqual({ inputPerM: 500000, outputPerM: 1500000 });
  });

  it("never falls back to a substring match across providers", () => {
    setModelPricing(parseOpenRouterPricing("openrouter", "z-ai/glm-5.2", { prompt: "0.5", completion: "1.5" }, 1)!);
    // Same slug under a different provider is NOT priced.
    expect(pricingFor("umans", "z-ai/glm-5.2")).toBeNull();
    // Substring of a known id is NOT priced.
    expect(pricingFor("openrouter", "glm-5.2-something")).toBeNull();
  });

  it("returns null when no exact price is known", () => {
    expect(pricingFor("umans", "umans-glm-5.2")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("computes from exact per-token rates", () => {
    setModelPricing(parseOpenRouterPricing("openrouter", "m", { prompt: "0.000001", completion: "0.000002" }, 1)!);
    expect(estimateCost(1_000_000, 500_000, "openrouter", "m")).toBe(2);
  });

  it("returns null for unknown pricing", () => {
    expect(estimateCost(1, 1, "umans", "m")).toBeNull();
  });
});

describe("estimateRunCost forecast", () => {
  function seedPrices(): void {
    setModelPricing(parseOpenRouterPricing("openrouter", "a", { prompt: "1", completion: "2" }, 1)!);
    setModelPricing(parseOpenRouterPricing("openrouter", "b", { prompt: "1", completion: "2" }, 1)!);
    setModelPricing(parseOpenRouterPricing("openrouter", "judge", { prompt: "1", completion: "2" }, 1)!);
  }

  it("includes one Judge and, in Fuse mode, one Fusion call", () => {
    seedPrices();
    const rank = estimateRunCost("prompt", ["a", "b"], 0, {
      providerIds: { a: "openrouter", b: "openrouter" },
      mode: "rank",
      judgeProvider: "openrouter",
      judgeModel: "judge",
    });
    expect(rank.partial).toBe(false);
    expect(rank.totalCostUsd).not.toBeNull();
    const fuse = estimateRunCost("prompt", ["a", "b"], 0, {
      providerIds: { a: "openrouter", b: "openrouter" },
      mode: "fuse",
      judgeProvider: "openrouter",
      judgeModel: "judge",
    });
    expect(fuse.partial).toBe(false);
    expect(fuse.totalCostUsd! > rank.totalCostUsd!).toBe(true);
  });

  it("labels the total partial when any priced stage is missing", () => {
    seedPrices();
    const result = estimateRunCost("prompt", ["a", "unknown-model"], 0, {
      providerIds: { a: "openrouter", "unknown-model": "umans" },
      mode: "rank",
      judgeProvider: "openrouter",
      judgeModel: "judge",
    });
    expect(result.partial).toBe(true);
    expect(result.totalCostUsd).toBeNull();
  });

  it("does not invent a total when no pricing is known", () => {
    const result = estimateRunCost("prompt", ["umans:model"], 0, {
      providerIds: { "umans:model": "umans" },
      mode: "fuse",
      judgeProvider: "umans",
      judgeModel: "j",
    });
    expect(result.totalCostUsd).toBeNull();
    expect(result.partial).toBe(true);
  });
});

describe("costFromSnapshot", () => {
  it("builds a catalog-estimate cost from an execution-time pricing snapshot", () => {
    const snapshot = parseOpenRouterPricing("openrouter", "m", { prompt: "0.000001", completion: "0.000002", request: "0.5" }, 5)!;
    const cost = costFromSnapshot(snapshot, { inputTokens: 1_000_000, outputTokens: 500_000 });
    expect(cost).toEqual({
      usd: 2.5,
      source: "catalog-estimate",
      pricingSnapshot: snapshot,
    });
  });

  it("returns null when usage or snapshot is absent", () => {
    expect(costFromSnapshot(undefined, { inputTokens: 1, outputTokens: 1 })).toBeNull();
    const snapshot = parseOpenRouterPricing("openrouter", "m", { prompt: "1", completion: "2" }, 5)!;
    expect(costFromSnapshot(snapshot, null)).toBeNull();
  });
});
