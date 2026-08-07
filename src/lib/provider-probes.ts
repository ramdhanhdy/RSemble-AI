// =============================================================================
// Provider probes — parallel readiness + catalog discovery with bounded timeouts.
// Preserves per-provider failure states so the UI can show diagnosable errors.
// =============================================================================

import { listProviders } from "./providers/registry";
import type { CatalogModel, ProviderId, ProviderReadiness } from "./providers/types";

export interface ProviderProbeResult {
  id: ProviderId;
  readiness: ProviderReadiness;
  catalog: CatalogModel[];
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 5_000;

class ProbeTimeoutError extends Error {
  constructor() {
    super("Provider probe timed out");
    this.name = "ProbeTimeoutError";
  }
}

function runAbortableStage<T>(
  operation: () => T | Promise<T>,
  ctrl: AbortController,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timedOut = false;

    // The timer is created first so `finish` can close over a const binding;
    // its callback only flips local flags and aborts, which synchronously
    // dispatches to onAbort registered below (never called before definition).
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctrl.signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      finish(() =>
        reject(
          timedOut
            ? new ProbeTimeoutError()
            : new DOMException("Provider probe aborted", "AbortError"),
        ),
      );
    };

    ctrl.signal.addEventListener("abort", onAbort, { once: true });
    if (ctrl.signal.aborted) {
      onAbort();
      return;
    }

    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
  });
}

async function probeProvider(
  provider: ReturnType<typeof listProviders>[number],
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ProviderProbeResult> {
  const ctrl = new AbortController();
  const forwardAbort = () => ctrl.abort();
  parentSignal?.addEventListener("abort", forwardAbort, { once: true });
  if (parentSignal?.aborted) ctrl.abort();

  try {
    const readiness = await runAbortableStage(
      () => provider.readiness(ctrl.signal),
      ctrl,
      timeoutMs,
    );
    if (!readiness.ok) {
      return { id: provider.id, readiness, catalog: [] };
    }
    if (!provider.listModels) {
      return { id: provider.id, readiness, catalog: [] };
    }
    try {
      const catalog = await runAbortableStage(
        () => provider.listModels!(ctrl.signal),
        ctrl,
        timeoutMs,
      );
      return { id: provider.id, readiness, catalog };
    } catch (err) {
      // Catalog stage failed after readiness already succeeded. Keep the
      // readiness bit so an unused/slow catalog does not flip the provider
      // offline mid-run; still surface the catalog error for the banner.
      const reason =
        err instanceof ProbeTimeoutError
          ? "Provider probe timed out"
          : err instanceof DOMException && err.name === "AbortError"
            ? "Provider probe aborted"
            : err instanceof Error
              ? err.message
              : String(err);
      return {
        id: provider.id,
        readiness,
        catalog: [],
        error: reason,
      };
    }
  } catch (err) {
    const reason =
      err instanceof ProbeTimeoutError
        ? "Provider probe timed out"
        : err instanceof DOMException && err.name === "AbortError"
          ? "Provider probe aborted"
          : err instanceof Error
            ? err.message
            : String(err);
    return {
      id: provider.id,
      readiness: { ok: false, reason },
      catalog: [],
      error: reason,
    };
  } finally {
    parentSignal?.removeEventListener("abort", forwardAbort);
  }
}

/** Probe all providers in parallel with independent abortable deadlines. */
export async function probeAllProviders(
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProviderProbeResult[]> {
  const providers = listProviders();
  const results = await Promise.allSettled(
    providers.map((provider) => probeProvider(provider, signal, timeoutMs)),
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      id: providers[index].id,
      readiness: { ok: false, reason },
      catalog: [],
      error: reason,
    };
  });
}

export type ProbeCycleResult =
  { status: "completed"; results: ProviderProbeResult[] } | { status: "cancelled" };

export interface ProviderProbeCoordinator {
  run(signal?: AbortSignal, timeoutMs?: number): Promise<ProbeCycleResult>;
  abort(): void;
}

/** Single-flight wrapper so a slow polling cycle cannot overlap the next tick. */
export function createProviderProbeCoordinator(): ProviderProbeCoordinator {
  let inFlight: Promise<ProbeCycleResult> | null = null;
  let activeCtrl: AbortController | null = null;
  /** True once abort() is called for the active cycle — wins over partial results. */
  let cycleCancelled = false;

  return {
    run(signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
      if (inFlight) return inFlight;

      const ctrl = new AbortController();
      activeCtrl = ctrl;
      cycleCancelled = false;
      const forwardAbort = () => {
        cycleCancelled = true;
        ctrl.abort();
      };
      signal?.addEventListener("abort", forwardAbort, { once: true });
      if (signal?.aborted) {
        cycleCancelled = true;
        ctrl.abort();
      }

      inFlight = (async (): Promise<ProbeCycleResult> => {
        try {
          const results = await probeAllProviders(ctrl.signal, timeoutMs);
          if (cycleCancelled || ctrl.signal.aborted) {
            return { status: "cancelled" };
          }
          return { status: "completed", results };
        } catch {
          if (cycleCancelled || ctrl.signal.aborted) {
            return { status: "cancelled" };
          }
          throw new Error("Provider probe cycle failed unexpectedly");
        } finally {
          signal?.removeEventListener("abort", forwardAbort);
          if (activeCtrl === ctrl) activeCtrl = null;
          inFlight = null;
          cycleCancelled = false;
        }
      })();
      return inFlight;
    },
    abort() {
      cycleCancelled = true;
      activeCtrl?.abort();
    },
  };
}
