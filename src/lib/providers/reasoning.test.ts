import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSlot } from "../../studio-data";
import {
  capabilitiesForModel,
  clearModelReasoningCapabilities,
  commonReasoningEfforts,
  resolveReasoningEffort,
  setModelReasoningCapabilities,
} from "./reasoning";

const slot = (providerId: ModelSlot["providerId"], slug: string, enabled = true): ModelSlot => ({
  id: `${providerId}-${slug}`,
  providerId,
  provider: providerId,
  model: slug,
  slug,
  enabled,
});

afterEach(() => clearModelReasoningCapabilities());

describe("reasoning effort resolution", () => {
  it("keeps unknown gateways at provider-default and rejects explicit effort", () => {
    expect(resolveReasoningEffort("umans", "umans-glm-5.2", "provider-default")).toMatchObject({
      ok: true,
      effective: "provider-default",
    });
    const result = resolveReasoningEffort("umans", "umans-glm-5.2", "medium");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("does not report support");
  });

  it("records DeepSeek documented aliases without hiding the effective value", () => {
    const mapped = resolveReasoningEffort("deepseek", "deepseek-v4-flash", "medium");
    expect(mapped).toMatchObject({ ok: true, requested: "medium", effective: "high" });
    const strict = resolveReasoningEffort("deepseek", "deepseek-v4-flash", "medium", true);
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.reason).toContain("strict suite parity");
  });

  it("distinguishes Gemini Pro and Flash documented levels", () => {
    expect(resolveReasoningEffort("gemini", "gemini-3.1-pro-preview", "minimal").ok).toBe(false);
    expect(resolveReasoningEffort("gemini", "gemini-3.6-flash", "minimal")).toMatchObject({
      ok: true,
      effective: "minimal",
    });
  });

  it("uses exact OpenRouter catalog capabilities rather than slug guesses", () => {
    setModelReasoningCapabilities("openrouter", "provider/model", {
      supportedEfforts: ["provider-default", "low", "high"],
      source: "catalog",
      transport: "openrouter",
    });
    expect(capabilitiesForModel("openrouter", "provider/model").source).toBe("catalog");
    expect(resolveReasoningEffort("openrouter", "provider/model", "high").ok).toBe(true);
    expect(resolveReasoningEffort("openrouter", "provider/model", "medium").ok).toBe(false);
  });

  it("computes the strict common candidate intersection", () => {
    const efforts = commonReasoningEfforts([
      slot("deepseek", "deepseek-v4-flash"),
      slot("gemini", "gemini-3.6-flash"),
      slot("umans", "umans-glm-5.2"),
    ]);
    expect(efforts).toEqual(["provider-default"]);
    expect(commonReasoningEfforts([
      slot("deepseek", "deepseek-v4-flash"),
      slot("gemini", "gemini-3.6-flash"),
    ])).toEqual(["provider-default", "low", "high"]);
  });
});

describe("reasoning capability persistence across reloads", () => {
  function stubStorage(store: Record<string, string>): void {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
  }

  /** Persistence is scheduled with queueMicrotask; flush it deterministically
   *  (no wall-clock timers). */
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("persists catalog capabilities so a reload keeps the picker options", async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    setModelReasoningCapabilities("openrouter", "z-ai/glm-5.2", {
      supportedEfforts: ["provider-default", "xhigh", "high"],
      source: "catalog",
      transport: "openrouter",
    });
    await flush();

    // Fresh page load: empty registry, storage hydrated on first lookup.
    clearModelReasoningCapabilities();
    store["rsemble.catalog.reasoning.v1"] = JSON.stringify({
      "openrouter:z-ai/glm-5.2": {
        supportedEfforts: ["provider-default", "xhigh", "high"],
        source: "catalog",
        transport: "openrouter",
      },
    });
    expect(capabilitiesForModel("openrouter", "z-ai/glm-5.2")).toMatchObject({
      supportedEfforts: ["provider-default", "xhigh", "high"],
      source: "catalog",
    });
  });

  it("drops corrupt stored entries and falls back to unknown", () => {
    stubStorage({ "rsemble.catalog.reasoning.v1": "{not-json" });
    expect(capabilitiesForModel("openrouter", "m").source).toBe("unknown");
  });

  it("drops entries with invalid effort values instead of trusting them", () => {
    stubStorage({
      "rsemble.catalog.reasoning.v1": JSON.stringify({
        "openrouter:m": { supportedEfforts: ["provider-default", "ultra"], source: "catalog", transport: "openrouter" },
      }),
    });
    expect(capabilitiesForModel("openrouter", "m").source).toBe("unknown");
  });

  it("clear removes the persisted copy so an explicit reset never resurrects it", async () => {
    const store: Record<string, string> = {};
    stubStorage(store);
    setModelReasoningCapabilities("openrouter", "m", {
      supportedEfforts: ["provider-default", "high"],
      source: "catalog",
      transport: "openrouter",
    });
    await flush();
    expect(store["rsemble.catalog.reasoning.v1"]).toBeDefined();
    clearModelReasoningCapabilities();
    expect(store["rsemble.catalog.reasoning.v1"]).toBeUndefined();
    expect(capabilitiesForModel("openrouter", "m").source).toBe("unknown");
  });
});
