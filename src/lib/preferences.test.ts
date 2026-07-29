import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSlot } from "../studio-data";
import type { CriticRef } from "./providers/types";
import {
  loadStoredCritic,
  loadStoredSlots,
  saveCommandPreferences,
} from "./preferences";

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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SLOTS: ModelSlot[] = [
  {
    id: "slot-a",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "A",
    slug: "org/a",
    enabled: true,
  },
  {
    id: "slot-b",
    providerId: "gemini",
    provider: "Gemini",
    model: "B",
    slug: "gemini-2.5-pro",
    enabled: false,
  },
];

const CRITIC: CriticRef = { providerId: "umans", model: "judge-x" };

describe("command preferences", () => {
  it("returns null when nothing is stored", () => {
    expect(loadStoredSlots()).toBeNull();
    expect(loadStoredCritic()).toBeNull();
  });

  it("round-trips slots and critic", () => {
    saveCommandPreferences({ slots: SLOTS, critic: CRITIC });
    expect(loadStoredSlots()).toEqual(SLOTS);
    expect(loadStoredCritic()).toEqual(CRITIC);
  });

  it("honors an intentionally empty roster", () => {
    saveCommandPreferences({ slots: [], critic: CRITIC });
    expect(loadStoredSlots()).toEqual([]);
    expect(loadStoredCritic()).toEqual(CRITIC);
  });

  it("rejects malformed slots and falls back to null", () => {
    store["rsemble.preferences.v1"] = JSON.stringify({
      slots: [{ id: "x", slug: "nope" }],
      critic: CRITIC,
    });
    expect(loadStoredSlots()).toBeNull();
    expect(loadStoredCritic()).toEqual(CRITIC);
  });

  it("rejects unknown provider ids", () => {
    store["rsemble.preferences.v1"] = JSON.stringify({
      slots: [{ ...SLOTS[0], providerId: "not-a-provider" }],
      critic: { providerId: "nope", model: "x" },
    });
    expect(loadStoredSlots()).toBeNull();
    expect(loadStoredCritic()).toBeNull();
  });

  it("tolerates corrupt JSON", () => {
    store["rsemble.preferences.v1"] = "{not-json";
    expect(loadStoredSlots()).toBeNull();
    expect(loadStoredCritic()).toBeNull();
  });
});

describe("command preferences — 9router round-trip", () => {
  it("preserves providerId 9router and exact router-native slug", () => {
    const routerSlots: ModelSlot[] = [
      {
        id: "slot-9r",
        providerId: "9router",
        provider: "9Router",
        model: "Gemini 3.1 Pro Low",
        slug: "ag/gemini-3.1-pro-low",
        enabled: true,
      },
    ];
    const routerCritic: CriticRef = { providerId: "9router", model: "combo:fast+cheap" };
    saveCommandPreferences({ slots: routerSlots, critic: routerCritic });
    expect(loadStoredSlots()).toEqual(routerSlots);
    expect(loadStoredCritic()).toEqual(routerCritic);
  });
});
