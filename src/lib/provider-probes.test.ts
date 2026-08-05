import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogModel, LLMProvider, ProviderReadiness } from "./providers/types";

const providers: LLMProvider[] = [];

vi.mock("./providers/registry", () => ({
  listProviders: () => providers,
}));

import { createProviderProbeCoordinator, probeAllProviders } from "./provider-probes";

function provider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: "openrouter",
    label: "Test",
    readiness: () => ({ ok: true }),
    chatCompletion: vi.fn(),
    chatCompletionStream: vi.fn() as never,
    listModels: vi.fn(async () => []),
    ...overrides,
  };
}

beforeEach(() => {
  providers.splice(0, providers.length);
  vi.useRealTimers();
});

describe("provider probe cancellation", () => {
  it("aborts the provider signal when the deadline expires", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    providers.push(
      provider({
        listModels: vi.fn((signal?: AbortSignal) => {
          observedSignal = signal;
          return new Promise<CatalogModel[]>(() => {});
        }),
      }),
    );

    const pending = probeAllProviders(undefined, 25);
    await vi.advanceTimersByTimeAsync(25);
    const [result] = await pending;

    expect(observedSignal?.aborted).toBe(true);
    // Readiness already succeeded; catalog timeout must not flip the provider offline.
    expect(result.readiness.ok).toBe(true);
    expect(result.error).toContain("timed out");
  });

  it("keeps readiness ok when only the catalog stage times out", async () => {
    vi.useFakeTimers();
    providers.push(
      provider({
        readiness: vi.fn(async () => ({ ok: true as const })),
        listModels: vi.fn((signal?: AbortSignal) => {
          return new Promise<CatalogModel[]>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }),
      }),
    );

    const pending = probeAllProviders(undefined, 25);
    await vi.advanceTimersByTimeAsync(25);
    const [result] = await pending;

    expect(result.readiness).toEqual({ ok: true });
    expect(result.catalog).toEqual([]);
    expect(result.error).toContain("timed out");
  });

  it("passes an external abort through to readiness and catalog work", async () => {
    const external = new AbortController();
    let readinessSignal: AbortSignal | undefined;
    providers.push(
      provider({
        readiness: vi.fn((signal?: AbortSignal) => {
          readinessSignal = signal;
          return new Promise<ProviderReadiness>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          });
        }),
      }),
    );

    const pending = probeAllProviders(external.signal, 5_000);
    external.abort();
    const [result] = await pending;

    expect(readinessSignal?.aborted).toBe(true);
    expect(result.readiness.ok).toBe(false);
    expect(result.error).toContain("aborted");
  });
});

  it("returns a cycle-level cancellation after mixed provider progress", async () => {
    let observedOpenRouterSignal: AbortSignal | undefined;
    providers.push(
      provider({
        id: "gemini",
        listModels: vi.fn(async () => []),
      }),
      provider({
        id: "openrouter",
        listModels: vi.fn((signal?: AbortSignal) => {
          observedOpenRouterSignal = signal;
          return new Promise<CatalogModel[]>((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }),
      }),
    );
    const coordinator = createProviderProbeCoordinator();
    const cycle = coordinator.run(undefined, 5_000);
    await vi.waitFor(() => expect(providers[0].listModels).toHaveBeenCalledTimes(1));
    coordinator.abort();
    await expect(cycle).resolves.toEqual({ status: "cancelled" });
    expect(observedOpenRouterSignal?.aborted).toBe(true);
  });

  it("keeps an idle timeout as a completed diagnosable cycle", async () => {
    vi.useFakeTimers();
    providers.push(
      provider({
        listModels: vi.fn(() => new Promise<CatalogModel[]>(() => {})),
      }),
    );
    const coordinator = createProviderProbeCoordinator();
    const cycle = coordinator.run(undefined, 25);
    await vi.advanceTimersByTimeAsync(25);
    await expect(cycle).resolves.toMatchObject({ status: "completed" });
    const result = await cycle;
    if (result.status !== "completed") throw new Error("expected completed probe cycle");
    expect(result.results[0]?.error).toContain("timed out");
  });

describe("provider probe coordinator", () => {
  it("reuses one in-flight polling cycle instead of overlapping requests", async () => {
    let resolveModels!: (models: []) => void;
    let callCount = 0;
    const listModels = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<[]>((resolve) => { resolveModels = resolve; });
      }
      return Promise.resolve([] as []);
    });
    providers.push(provider({ listModels }));
    const coordinator = createProviderProbeCoordinator();

    const first = coordinator.run(undefined, 5_000);
    const second = coordinator.run(undefined, 5_000);

    await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(1));
    expect(second).toBe(first);
    resolveModels([]);
    await first;

    const third = coordinator.run(undefined, 5_000);
    await third;
    expect(listModels).toHaveBeenCalledTimes(2);
  });
});
