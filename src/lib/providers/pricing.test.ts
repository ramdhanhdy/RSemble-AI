import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearModelPricing,
  getModelPricing,
  parseOpenRouterPricing,
  setModelPricing,
} from "./pricing";

// Map-backed localStorage stub so persistence survives within a test.
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

/** Persistence is scheduled with queueMicrotask; flush it deterministically. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  stubStorage();
});
afterEach(() => {
  clearModelPricing();
  vi.unstubAllGlobals();
});

describe("parseOpenRouterPricing", () => {
  it("parses exact per-token pricing components from the models catalog", () => {
    const snapshot = parseOpenRouterPricing(
      "openrouter",
      "vendor/model",
      {
        prompt: "0.0000015",
        completion: "0.000006",
        reasoning: "0.000006",
        input_cache_read: "0.00000015",
        input_cache_write: "0.0000015",
        request: "0.0005",
        image: "0.003",
      },
      1000,
    );
    expect(snapshot).toEqual({
      providerId: "openrouter",
      modelId: "vendor/model",
      fetchedAt: 1000,
      inputPerToken: 0.0000015,
      outputPerToken: 0.000006,
      reasoningPerToken: 0.000006,
      cacheReadPerToken: 0.00000015,
      cacheWritePerToken: 0.0000015,
      requestCostUsd: 0.0005,
      imagePerToken: 0.003,
    });
  });

  it("rejects negative or non-finite pricing components as null", () => {
    const snapshot = parseOpenRouterPricing("openrouter", "m", {
      prompt: "-1",
      completion: "NaN",
    });
    expect(snapshot).toBeUndefined();
  });

  it("returns undefined when no pricing component exists", () => {
    expect(parseOpenRouterPricing("openrouter", "m", {})).toBeUndefined();
    expect(parseOpenRouterPricing("openrouter", "m", null)).toBeUndefined();
  });
});

describe("pricing persistence across reloads", () => {
  it("persists catalog pricing so a reload keeps Estimated costs instead of Unknown", async () => {
    const store = stubStorage();
    const snapshot = parseOpenRouterPricing(
      "openrouter",
      "z-ai/glm-5.2",
      {
        prompt: "0.0000006",
        completion: "0.0000022",
        reasoning: "0.0000006",
      },
      42,
    )!;
    setModelPricing(snapshot);
    await flush();
    expect(store.get("rsemble.catalog.pricing.v1")).toBeDefined();

    // Simulated reload: capture what the previous session persisted, wipe the
    // in-memory registry, restore storage — the next lookup hydrates it.
    const persisted = store.get("rsemble.catalog.pricing.v1");
    clearModelPricing();
    store.set("rsemble.catalog.pricing.v1", persisted!);
    expect(getModelPricing("openrouter", "z-ai/glm-5.2")).toEqual(snapshot);
  });

  it("drops corrupt stored pricing and returns null", () => {
    const store = stubStorage();
    store.set("rsemble.catalog.pricing.v1", "{not-json");
    expect(getModelPricing("openrouter", "m")).toBeNull();
  });

  it("drops entries with negative or non-numeric components", () => {
    const store = stubStorage();
    store.set(
      "rsemble.catalog.pricing.v1",
      JSON.stringify({
        "openrouter:m": {
          providerId: "openrouter",
          modelId: "m",
          fetchedAt: 1,
          inputPerToken: -1,
          outputPerToken: 0.1,
          reasoningPerToken: null,
          cacheReadPerToken: null,
          cacheWritePerToken: null,
          requestCostUsd: null,
          imagePerToken: null,
        },
      }),
    );
    expect(getModelPricing("openrouter", "m")).toBeNull();
  });

  it("clear removes the persisted copy so an explicit reset never resurrects it", async () => {
    const store = stubStorage();
    setModelPricing(parseOpenRouterPricing("openrouter", "m", { prompt: "0.1" }, 5)!);
    await flush();
    expect(store.get("rsemble.catalog.pricing.v1")).toBeDefined();
    clearModelPricing();
    expect(store.get("rsemble.catalog.pricing.v1")).toBeUndefined();
    expect(getModelPricing("openrouter", "m")).toBeNull();
  });
});

describe("model pricing registry", () => {
  it("round-trips exact provider-scoped snapshots", () => {
    const snapshot = parseOpenRouterPricing(
      "openrouter",
      "org/model",
      { prompt: "0.5", completion: "1.5" },
      7,
    )!;
    expect(snapshot).toBeDefined();
    setModelPricing(snapshot);
    expect(getModelPricing("openrouter", "org/model")).toEqual(snapshot);
    // Provider/model identity is part of the key.
    expect(getModelPricing("openrouter", "other")).toBeNull();
    expect(getModelPricing("gemini", "org/model")).toBeNull();
  });
});
