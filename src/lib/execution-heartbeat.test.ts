import { describe, it, expect } from "vitest";
import {
  createDeterministicHeartbeatScheduler,
  createExecutionHeartbeat,
  createHeartbeatScheduler,
  type HeartbeatWorker,
} from "./execution-heartbeat";

function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("execution heartbeat", () => {
  it("renews on deterministic ticks and stops scheduling on stop", async () => {
    const scheduler = createDeterministicHeartbeatScheduler();
    let renewals = 0;
    const heartbeat = createExecutionHeartbeat({
      renew: () => {
        renewals += 1;
      },
      scheduler,
      intervalMs: 25,
    });

    heartbeat.start();
    expect(heartbeat.isRunning()).toBe(true);
    expect(scheduler.scheduledCount()).toBe(1);
    scheduler.tick();
    await flush();
    expect(renewals).toBe(1);

    heartbeat.stop();
    expect(heartbeat.isRunning()).toBe(false);
    expect(scheduler.scheduledCount()).toBe(0);
    scheduler.tick();
    await flush();
    expect(renewals).toBe(1);
  });

  it("fences a late renewal rejection from a restarted heartbeat", async () => {
    const scheduler = createDeterministicHeartbeatScheduler();
    const rejectRenewals: Array<(error: unknown) => void> = [];
    const errors: unknown[] = [];
    const heartbeat = createExecutionHeartbeat({
      renew: () =>
        new Promise<void>((_resolve, reject) => {
          rejectRenewals.push(reject);
        }),
      scheduler,
      onError: (error) => errors.push(error),
    });

    heartbeat.start();
    scheduler.tick();
    heartbeat.stop();
    heartbeat.start();
    scheduler.tick();
    // The restarted generation gets its own renewal even while the previous
    // IndexedDB operation is still pending.
    expect(rejectRenewals).toHaveLength(2);
    rejectRenewals[0](new Error("stale renewal"));
    await flush();
    expect(errors).toHaveLength(0);
    expect(heartbeat.isRunning()).toBe(true);
    heartbeat.stop();
  });

  it("reports a lost lease once and tears down the scheduler", async () => {
    const scheduler = createDeterministicHeartbeatScheduler();
    const failure = new Error("lease lost");
    const errors: unknown[] = [];
    const heartbeat = createExecutionHeartbeat({
      renew: () => Promise.reject(failure),
      scheduler,
      onError: (error) => errors.push(error),
    });

    heartbeat.start();
    scheduler.tick();
    await flush();
    expect(errors).toEqual([failure]);
    expect(heartbeat.isRunning()).toBe(false);
    expect(scheduler.scheduledCount()).toBe(0);

    scheduler.tick();
    await flush();
    expect(errors).toHaveLength(1);
  });

  it("renews immediately when the document becomes visible", async () => {
    const scheduler = createDeterministicHeartbeatScheduler();
    let state: DocumentVisibilityState = "hidden";
    const listeners = new Set<() => void>();
    const target = {
      get visibilityState(): DocumentVisibilityState {
        return state;
      },
      addEventListener: (
        _type: "visibilitychange",
        listener: EventListenerOrEventListenerObject,
      ) => {
        listeners.add(listener as () => void);
      },
      removeEventListener: (
        _type: "visibilitychange",
        listener: EventListenerOrEventListenerObject,
      ) => {
        listeners.delete(listener as () => void);
      },
    } as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
    let renewals = 0;
    const heartbeat = createExecutionHeartbeat({
      renew: () => {
        renewals += 1;
      },
      scheduler,
      visibilityTarget: target,
    });

    heartbeat.start();
    state = "visible";
    for (const listener of listeners) listener();
    await flush();
    expect(renewals).toBe(1);
    heartbeat.stop();
    expect(listeners).toHaveLength(0);
  });

  it("uses a Worker and cleans it up, falling back to a timer on worker failure", () => {
    let worker: FakeWorker | null = null;
    let timerStarts = 0;
    let timerStops = 0;
    const scheduler = createHeartbeatScheduler({
      workerFactory: () => {
        worker = new FakeWorker();
        return worker;
      },
      setInterval: () => {
        timerStarts += 1;
        return 1;
      },
      clearInterval: () => {
        timerStops += 1;
      },
    });
    let calls = 0;
    const first = scheduler.schedule(() => {
      calls += 1;
    }, 100);
    worker!.emitMessage();
    expect(calls).toBe(1);
    first.stop();
    expect(worker!.terminated).toBe(true);
    expect(timerStarts).toBe(0);
    expect(timerStops).toBe(0);

    const fallbackWorker = new FakeWorker();
    const fallback = createHeartbeatScheduler({
      workerFactory: () => fallbackWorker,
      setInterval: () => {
        timerStarts += 1;
        return 2;
      },
      clearInterval: () => {
        timerStops += 1;
      },
    });
    fallback.schedule(() => {
      calls += 1;
    }, 100);
    fallbackWorker.emitError();
    expect(timerStarts).toBe(1);
  });
});

class FakeWorker implements HeartbeatWorker {
  onmessage: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  emitMessage(): void {
    this.onmessage?.(0);
  }
  emitError(): void {
    this.onerror?.(new Error("worker failed"));
  }
  terminate(): void {
    this.terminated = true;
  }
}
