// =============================================================================
// ModelProbeContext — shared ephemeral probe state with provider-keyed
// invalidation and bounded-concurrency batch testing (spec §8.4, plan §4.4–4.5).
//
// Owns a map of ModelProbeState keyed by `${providerId}:${model}`. Both
// individual ModelProbeControl instances and the "Test selected models" batch
// runner read and write through this context. Credential saves increment a
// per-provider invalidation token so affected probe results reset to Untested.
//
// Probe state is ephemeral session state — never persisted or exported.
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getProvider } from "../lib/providers/registry";
import { probeModelRoute, type ModelProbeState } from "../lib/providers/model-probe";
import type { ProviderId } from "../lib/providers/types";

const PROBE_KEY_DELIM = ":";

function probeKey(providerId: ProviderId, model: string): string {
  return `${providerId}${PROBE_KEY_DELIM}${model}`;
}

function providerFromKey(key: string): string {
  return key.slice(0, key.indexOf(PROBE_KEY_DELIM));
}

export interface ModelProbeContextValue {
  /** Probe state by `${providerId}:${model}`. */
  states: Record<string, ModelProbeState>;
  /** Per-provider invalidation token — increments on credential save/clear. */
  providerTokens: Partial<Record<ProviderId, number>>;
  /** Test one model route. */
  testOne(providerId: ProviderId, model: string): Promise<void>;
  /** Test multiple model routes with bounded concurrency (plan §4.4). */
  testBatch(
    entries: Array<{ providerId: ProviderId; model: string }>,
    concurrency?: number,
  ): Promise<void>;
  /** Invalidate all probe results for a provider (plan §4.5). */
  invalidateProvider(providerId: ProviderId): void;
}

const ModelProbeContext = createContext<ModelProbeContextValue | null>(null);

/** Default batch concurrency (spec §14). */
const DEFAULT_BATCH_CONCURRENCY = 3;

export function ModelProbeProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, ModelProbeState>>({});
  const [providerTokens, setProviderTokens] = useState<Partial<Record<ProviderId, number>>>({});

  const testOne = useCallback(async (providerId: ProviderId, model: string) => {
    const key = probeKey(providerId, model);
    setStates((prev) => ({ ...prev, [key]: { kind: "testing", startedAt: Date.now() } }));
    const provider = getProvider(providerId);
    const result = await probeModelRoute({ provider, providerId, model });
    setStates((prev) => ({ ...prev, [key]: result }));
  }, []);

  const testBatch = useCallback(
    async (
      entries: Array<{ providerId: ProviderId; model: string }>,
      concurrency: number = DEFAULT_BATCH_CONCURRENCY,
    ) => {
      // Mark all as testing first.
      setStates((prev) => {
        const next = { ...prev };
        for (const e of entries) {
          next[probeKey(e.providerId, e.model)] = { kind: "testing", startedAt: Date.now() };
        }
        return next;
      });

      // Bounded concurrency: run `concurrency` probes at a time.
      const queue = [...entries];
      const runNext = async (): Promise<void> => {
        const entry = queue.shift();
        if (!entry) return;
        const provider = getProvider(entry.providerId);
        const result = await probeModelRoute({
          provider,
          providerId: entry.providerId,
          model: entry.model,
        });
        setStates((prev) => ({ ...prev, [probeKey(entry.providerId, entry.model)]: result }));
        // Recurse to keep the pool full. Do not stop after first failure.
        await runNext();
      };
      const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => runNext());
      await Promise.all(workers);
    },
    [],
  );

  const invalidateProvider = useCallback((providerId: ProviderId) => {
    setProviderTokens((prev) => ({
      ...prev,
      [providerId]: (prev[providerId] ?? 0) + 1,
    }));
    setStates((prev) => {
      const next: Record<string, ModelProbeState> = {};
      for (const [key, state] of Object.entries(prev)) {
        if (providerFromKey(key) === providerId) {
          next[key] = { kind: "untested" };
        } else {
          next[key] = state;
        }
      }
      return next;
    });
  }, []);

  const value = useMemo<ModelProbeContextValue>(
    () => ({ states, providerTokens, testOne, testBatch, invalidateProvider }),
    [states, providerTokens, testOne, testBatch, invalidateProvider],
  );

  return <ModelProbeContext.Provider value={value}>{children}</ModelProbeContext.Provider>;
}

export function useModelProbe(): ModelProbeContextValue {
  const ctx = useContext(ModelProbeContext);
  if (!ctx) {
    throw new Error("useModelProbe must be used within a ModelProbeProvider");
  }
  return ctx;
}

/** Get the probe state for a specific model, defaulting to Untested. */
export function useProbeState(providerId: ProviderId, model: string): ModelProbeState {
  const { states } = useModelProbe();
  return states[probeKey(providerId, model)] ?? { kind: "untested" };
}

/** Get the invalidation token for a provider (for reset-on-credential-change). */
export function useProviderToken(providerId: ProviderId): number {
  const { providerTokens } = useModelProbe();
  return providerTokens[providerId] ?? 0;
}
