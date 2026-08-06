// =============================================================================
// RSemble AI — execution heartbeat
//
// A lease heartbeat has slightly different requirements from a generic timer:
// it must keep running when a document is hidden, renew immediately when the
// document becomes visible again, and stop cleanly when ownership ends.  This
// module owns those browser details so Compare and experiment controllers use
// the same lifecycle and tests can drive time without relying on a real clock.
// =============================================================================

/** The default cadence used by Compare and experiments. */
export const DEFAULT_HEARTBEAT_INTERVAL = 3_000;

export interface HeartbeatSchedule {
  stop(): void;
}

/** A scheduler invokes the callback at approximately the requested cadence. */
export interface HeartbeatScheduler {
  schedule(callback: () => void, intervalMs: number): HeartbeatSchedule;
}

/** The small subset of Worker used by the scheduler (also easy to fake in tests). */
export interface HeartbeatWorker {
  onmessage: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate(): void;
}

export type HeartbeatWorkerFactory = (intervalMs: number) =>
  | HeartbeatWorker
  | { worker: HeartbeatWorker; revoke?: () => void }
  | null;

export interface BrowserHeartbeatSchedulerOptions {
  /** Override Worker construction. Returning null selects setInterval. */
  workerFactory?: HeartbeatWorkerFactory;
  /** Injectable timer functions make scheduler behavior deterministic in tests. */
  setInterval?: (callback: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

interface WorkerHandle {
  worker: HeartbeatWorker;
  revoke?: () => void;
}

function defaultWorkerFactory(intervalMs: number): WorkerHandle | null {
  // Do not touch browser globals during SSR or in Node-based controller tests.
  if (
    typeof globalThis.Worker !== "function" ||
    typeof globalThis.Blob !== "function" ||
    typeof globalThis.URL === "undefined" ||
    typeof globalThis.URL.createObjectURL !== "function"
  ) {
    return null;
  }

  const source = `setInterval(() => postMessage(0), ${Math.max(1, Math.floor(intervalMs))});`;
  const objectUrl = globalThis.URL.createObjectURL(
    new globalThis.Blob([source], { type: "application/javascript" }),
  );
  try {
    const worker = new globalThis.Worker(objectUrl) as unknown as HeartbeatWorker;
    return {
      worker,
      revoke: () => globalThis.URL.revokeObjectURL?.(objectUrl),
    };
  } catch {
    // A restrictive CSP can permit Blob but reject its Worker.  Revoke the
    // URL before falling back to a regular timer.
    globalThis.URL.revokeObjectURL?.(objectUrl);
    return null;
  }
}

/**
 * Browser scheduler: prefer a dedicated Worker (which is not subject to the
 * aggressive hidden-page timer throttling seen by setInterval), then fall back
 * to setInterval whenever Worker/Blob/CSP support is unavailable.
 */
export function createHeartbeatScheduler(
  options: BrowserHeartbeatSchedulerOptions = {},
): HeartbeatScheduler {
  const setIntervalFn = options.setInterval ?? ((callback: () => void, intervalMs: number) =>
    globalThis.setInterval(callback, intervalMs));
  const clearIntervalFn = options.clearInterval ?? ((handle: unknown) =>
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;

  return {
    schedule(callback, intervalMs): HeartbeatSchedule {
      let stopped = false;
      let timerActive = false;
      let timerHandle: unknown;
      let workerHandle: WorkerHandle | null = null;

      const scheduleTimer = (): void => {
        if (stopped || timerActive) return;
        timerActive = true;
        timerHandle = setIntervalFn(callback, Math.max(1, Math.floor(intervalMs)));
      };

      try {
        const result = workerFactory(Math.max(1, Math.floor(intervalMs)));
        if (result) {
          workerHandle = "worker" in result ? result : { worker: result };
          const worker = workerHandle.worker;
          worker.onmessage = () => {
            if (!stopped) callback();
          };
          // A runtime worker error should not strand a live lease.  Tear down
          // the broken worker and continue on the timer path instead.
          worker.onerror = () => {
            if (stopped) return;
            worker.onmessage = null;
            worker.onerror = null;
            try {
              worker.terminate();
            } catch {
              // Best effort; the timer fallback is still safe.
            }
            workerHandle?.revoke?.();
            workerHandle = null;
            scheduleTimer();
          };
        } else {
          scheduleTimer();
        }
      } catch {
        // Construction can fail under CSP or in partially implemented browser
        // test environments.  The timer fallback is deliberately conservative.
        workerHandle = null;
        scheduleTimer();
      }

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          if (timerActive) {
            timerActive = false;
            try {
              clearIntervalFn(timerHandle);
            } catch {
              // Continue to worker cleanup even if an injected timer fails.
            }
            timerHandle = undefined;
          }
          if (workerHandle) {
            const current = workerHandle;
            workerHandle = null;
            current.worker.onmessage = null;
            current.worker.onerror = null;
            try {
              current.worker.terminate();
            } catch {
              // Best effort cleanup.
            }
            try {
              current.revoke?.();
            } catch {
              // URL revocation is best effort.
            }
          }
        },
      };
    },
  };
}

/**
 * Deterministic scheduler for unit tests and non-browser hosts.  A caller
 * advances it explicitly with `tick()`; no wall clock or fake timer globals
 * are needed.
 */
export interface DeterministicHeartbeatScheduler extends HeartbeatScheduler {
  tick(): void;
  scheduledCount(): number;
}

export function createDeterministicHeartbeatScheduler(): DeterministicHeartbeatScheduler {
  const callbacks = new Set<() => void>();
  return {
    schedule(callback): HeartbeatSchedule {
      callbacks.add(callback);
      let active = true;
      return {
        stop: () => {
          if (!active) return;
          active = false;
          callbacks.delete(callback);
        },
      };
    },
    tick: () => {
      // Snapshot so a callback may stop itself without mutating this iteration.
      for (const callback of [...callbacks]) callback();
    },
    scheduledCount: () => callbacks.size,
  };
}

export interface ExecutionHeartbeatOptions {
  renew: () => Promise<unknown> | unknown;
  intervalMs?: number;
  scheduler?: HeartbeatScheduler;
  /** Document-like target; omitted means the ambient document, if present. */
  visibilityTarget?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  onError?: (error: unknown) => void;
}

export interface ExecutionHeartbeat {
  start(): void;
  stop(): void;
  /** Trigger one renewal immediately (used by visibility and deterministic tests). */
  renewNow(): Promise<void>;
  isRunning(): boolean;
}

/**
 * Create a lifecycle-safe lease heartbeat.  Failed renewal is terminal for
 * this heartbeat: `onError` is called once and scheduling is stopped.  The
 * controller can then abort its work and release (or let expire) the lease.
 */
export function createExecutionHeartbeat(
  options: ExecutionHeartbeatOptions,
): ExecutionHeartbeat {
  const intervalMs = Math.max(1, Math.floor(options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL));
  const scheduler = options.scheduler ?? createHeartbeatScheduler();
  const visibilityTarget = options.visibilityTarget ??
    (typeof globalThis.document !== "undefined" ? globalThis.document : undefined);

  let running = false;
  let schedule: HeartbeatSchedule | null = null;
  let visibilityHandler: (() => void) | null = null;
  let renewalGenerationInFlight: number | null = null;
  let errorReported = false;
  // A renewal may outlive stop() (for example, IndexedDB can resolve after a
  // route change).  Generation fencing keeps that stale promise from stopping
  // a heartbeat that was subsequently started for a new lease/stage.
  let generation = 0;

  const renewNow = async (): Promise<void> => {
    if (!running || renewalGenerationInFlight === generation) return;
    const renewalGeneration = generation;
    renewalGenerationInFlight = renewalGeneration;
    try {
      await options.renew();
    } catch (error) {
      if (running && renewalGeneration === generation && !errorReported) {
        errorReported = true;
        // Stop before notifying the controller.  This prevents a synchronous
        // onError/abort path from racing another scheduled renewal.
        stop();
        try {
          options.onError?.(error);
        } catch {
          // Observability/abort callbacks must not produce an unhandled error.
        }
      }
    } finally {
      if (renewalGenerationInFlight === renewalGeneration) {
        renewalGenerationInFlight = null;
      }
    }
  };

  function stop(): void {
    if (!running && schedule === null && visibilityHandler === null) return;
    running = false;
    generation += 1;
    const activeSchedule = schedule;
    schedule = null;
    try {
      activeSchedule?.stop();
    } catch {
      // Cleanup remains best effort if an injected scheduler misbehaves.
    }
    const activeVisibilityHandler = visibilityHandler;
    visibilityHandler = null;
    if (activeVisibilityHandler && visibilityTarget) {
      try {
        visibilityTarget.removeEventListener("visibilitychange", activeVisibilityHandler);
      } catch {
        // A torn-down document can reject listener removal; no lease renewal
        // can occur because the handler reference is already discarded.
      }
    }
  }

  function start(): void {
    if (running) return;
    errorReported = false;
    generation += 1;
    running = true;
    try {
      schedule = scheduler.schedule(() => {
        void renewNow();
      }, intervalMs);
      if (visibilityTarget) {
        visibilityHandler = () => {
          if (visibilityTarget.visibilityState === "visible") void renewNow();
        };
        visibilityTarget.addEventListener("visibilitychange", visibilityHandler);
      }
    } catch (error) {
      // A custom scheduler is part of the execution boundary too; surface a
      // failed setup through the same one-shot path and leave no listeners.
      stop();
      if (!errorReported) {
        errorReported = true;
        try {
          options.onError?.(error);
        } catch {
          // Keep start() from throwing through controller lifecycle code.
        }
      }
    }
  }

  return {
    start,
    stop,
    renewNow,
    isRunning: () => running,
  };
}
