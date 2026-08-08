import { describe, expect, it } from "vitest";
import {
  classifyAbortSignal,
  composeAbortSignal,
  composeAbortSignals,
  createExecutionDeadline,
  createStreamActivity,
  createStreamWatchdog,
  ExecutionTimeoutError,
  isExecutionTimeout,
  isUserAbort,
  markStreamActivity,
  streamWithExecutionDeadlines,
  timeoutErrorFromSignal,
  type DeadlineTimers,
  type StreamActivity,
  runWithExecutionDeadlines,
} from "./execution-deadline";

/** Deterministic clock + timer queue; no wall-clock sleeps or fake timer globals. */
class ManualTimers implements DeadlineTimers {
  private current = 0;
  private nextId = 0;
  private queue = new Map<number, { due: number; callback: () => void }>();

  now = (): number => this.current;

  setTimeout(callback: () => void, delayMs: number): number {
    const id = ++this.nextId;
    this.queue.set(id, { due: this.current + Math.max(0, delayMs), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue.delete(handle as number);
  }

  pending(): number {
    return this.queue.size;
  }

  advance(ms: number): void {
    const target = this.current + ms;
    while (true) {
      const due = [...this.queue.entries()]
        .filter(([, item]) => item.due <= target)
        .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!due) break;
      const [id, item] = due;
      this.queue.delete(id);
      this.current = item.due;
      item.callback();
    }
    this.current = target;
  }
}

const metadata = { provider: "provider-a", model: "reasoning-model", stage: "candidate" };

function deadline(
  timers: ManualTimers,
  kind: "connect_timeout" | "stream_inactivity_timeout" | "overall_timeout" = "connect_timeout",
  durationMs = 100,
  signal?: AbortSignal,
) {
  return createExecutionDeadline({
    ...metadata,
    kind,
    durationMs,
    now: timers.now,
    timers,
    signal,
  });
}

describe("createExecutionDeadline", () => {
  it("aborts with a structured connect timeout at the configured boundary", () => {
    const timers = new ManualTimers();
    const d = deadline(timers, "connect_timeout", 100);

    timers.advance(99);
    expect(d.signal.aborted).toBe(false);
    timers.advance(1);

    expect(d.signal.aborted).toBe(true);
    expect(isExecutionTimeout(d.signal)).toBe(true);
    expect(isUserAbort(d.signal)).toBe(false);
    const error = timeoutErrorFromSignal(d.signal);
    expect(error).toBeInstanceOf(ExecutionTimeoutError);
    expect(error).toMatchObject({
      kind: "connect_timeout",
      timeoutKind: "connect_timeout",
      provider: "provider-a",
      providerId: "provider-a",
      model: "reasoning-model",
      stage: "candidate",
      configuredDurationMs: 100,
      durationMs: 100,
      elapsedMs: 100,
      startedAt: 0,
    });
    expect(error?.message).not.toContain("prompt");
    expect(d.timeoutError).toBe(error);
  });

  it("preserves an explicit user abort and never labels it a timeout", () => {
    const timers = new ManualTimers();
    const caller = new AbortController();
    const d = deadline(timers, "connect_timeout", 100, caller.signal);

    caller.abort();
    expect(d.signal.aborted).toBe(true);
    expect(isUserAbort(d.signal)).toBe(true);
    expect(isExecutionTimeout(d.signal)).toBe(false);
    expect(timeoutErrorFromSignal(d.signal)).toBeNull();
    expect(classifyAbortSignal(d.signal)?.kind).toBe("user_abort");
    expect(timers.pending()).toBe(0);

    timers.advance(1000);
    expect(d.timeoutError).toBeNull();
  });

  it("handles an already-aborted caller and cleans its timer immediately", () => {
    const timers = new ManualTimers();
    const caller = new AbortController();
    caller.abort(new DOMException("stop", "AbortError"));

    const d = deadline(timers, "overall_timeout", 100, caller.signal);
    expect(d.signal.aborted).toBe(true);
    expect(isUserAbort(d.signal)).toBe(true);
    expect(timers.pending()).toBe(0);
  });

  it("cleanup is idempotent and prevents a pending deadline from firing", () => {
    const timers = new ManualTimers();
    const d = deadline(timers, "connect_timeout", 100);
    expect(timers.pending()).toBe(1);

    d.cleanup();
    d.cancel();
    expect(timers.pending()).toBe(0);
    timers.advance(1000);
    expect(d.signal.aborted).toBe(false);
  });

  it("composes caller and deadline signals with first-abort-wins classification", () => {
    const timers = new ManualTimers();
    const caller = new AbortController();
    const d = deadline(timers, "connect_timeout", 100, caller.signal);
    const composed = composeAbortSignal(caller.signal, d.signal);
    caller.abort();

    expect(composed.signal.aborted).toBe(true);
    expect(isUserAbort(composed.signal)).toBe(true);
    composed.cleanup();
    d.cleanup();
  });

  it("preserves timeout classification through nested composition", () => {
    const timers = new ManualTimers();
    const d = deadline(timers, "overall_timeout", 50);
    const nested = composeAbortSignals(d.signal);
    timers.advance(50);

    expect(isExecutionTimeout(nested.signal)).toBe(true);
    expect(timeoutErrorFromSignal(nested.signal)?.kind).toBe("overall_timeout");
    nested.cleanup();
    d.cleanup();
  });
});

describe("createStreamWatchdog", () => {
  it("times out when no accepted progress arrives", () => {
    const timers = new ManualTimers();
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      now: timers.now,
      timers,
    });

    timers.advance(99);
    expect(watchdog.signal.aborted).toBe(false);
    timers.advance(1);

    expect(watchdog.signal.aborted).toBe(true);
    expect(timeoutErrorFromSignal(watchdog.signal)).toMatchObject({
      kind: "stream_inactivity_timeout",
      configuredDurationMs: 100,
      elapsedMs: 100,
      lastProgressAt: 0,
    });
  });

  it("resets inactivity only when markProgress is called", () => {
    const timers = new ManualTimers();
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      now: timers.now,
      timers,
    });

    // Merely advancing/looping does not reset the watchdog.
    timers.advance(99);
    watchdog.markProgress();
    timers.advance(99);
    expect(watchdog.signal.aborted).toBe(false);
    expect(watchdog.lastProgressAt).toBe(99);
    timers.advance(1);

    expect(watchdog.signal.aborted).toBe(true);
    expect(timeoutErrorFromSignal(watchdog.signal)?.elapsedMs).toBe(100);
    expect(watchdog.timeoutError?.lastProgressAt).toBe(99);
  });

  it("keeps a healthy long-running stream alive while progress continues", () => {
    const timers = new ManualTimers();
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      overallMs: 1000,
      now: timers.now,
      timers,
    });

    for (let i = 0; i < 9; i += 1) {
      timers.advance(90);
      watchdog.progress();
      expect(watchdog.signal.aborted).toBe(false);
    }
    expect(timers.now()).toBe(810);
    timers.advance(90);
    expect(watchdog.signal.aborted).toBe(false);
    watchdog.cleanup();
  });

  it("does not let progress reset the optional overall ceiling", () => {
    const timers = new ManualTimers();
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      overallMs: 250,
      now: timers.now,
      timers,
    });

    timers.advance(90);
    watchdog.markProgress();
    timers.advance(90);
    watchdog.markProgress();
    timers.advance(70);

    expect(watchdog.signal.aborted).toBe(true);
    expect(timeoutErrorFromSignal(watchdog.signal)).toMatchObject({
      kind: "overall_timeout",
      configuredDurationMs: 250,
      elapsedMs: 250,
    });
  });

  it("user abort wins over stream deadlines and removes both timers", () => {
    const timers = new ManualTimers();
    const caller = new AbortController();
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      overallMs: 1000,
      now: timers.now,
      timers,
      signal: caller.signal,
    });

    caller.abort();
    expect(isUserAbort(watchdog.signal)).toBe(true);
    expect(isExecutionTimeout(watchdog.signal)).toBe(false);
    expect(timers.pending()).toBe(0);
    timers.advance(1000);
    expect(watchdog.timeoutError).toBeNull();
  });

  it("cleanup after success/failure removes inactivity and overall timers", () => {
    const timers = new ManualTimers();
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      overallMs: 1000,
      now: timers.now,
      timers,
    });
    expect(timers.pending()).toBe(2);
    watchdog.cleanup();
    watchdog.cancel();
    expect(timers.pending()).toBe(0);
    timers.advance(2000);
    expect(watchdog.signal.aborted).toBe(false);
  });
});

describe("provider operation boundaries", () => {
  it("times out a request that never reaches response headers", async () => {
    const timers = new ManualTimers();
    let requestSignal: AbortSignal | undefined;
    const pending = runWithExecutionDeadlines(
      (signal) => {
        requestSignal = signal;
        return new Promise<string>(() => {});
      },
      {
        ...metadata,
        connectMs: 100,
        now: timers.now,
        timers,
      },
    );

    timers.advance(99);
    expect(requestSignal?.aborted).toBe(false);
    timers.advance(1);
    await expect(pending).rejects.toMatchObject({
      kind: "connect_timeout",
      configuredDurationMs: 100,
    });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("stops the connect clock at response headers while the overall clock remains active", async () => {
    const timers = new ManualTimers();
    let markHeaders!: () => void;
    let finish!: (value: string) => void;
    const pending = runWithExecutionDeadlines(
      (_signal, onHeadersReady) => {
        markHeaders = onHeadersReady;
        return new Promise<string>((resolve) => {
          finish = resolve;
        });
      },
      {
        ...metadata,
        connectMs: 10,
        overallMs: 100,
        now: timers.now,
        timers,
      },
    );
    markHeaders();
    timers.advance(50);
    expect(timers.pending()).toBe(1); // only overall remains
    finish("headers + body");
    await expect(pending).resolves.toBe("headers + body");
  });

  it("starts inactivity at headers and preserves an independent overall ceiling", async () => {
    const timers = new ManualTimers();
    let resolveHeaders!: () => void;
    const headersReady = new Promise<void>((resolve) => {
      resolveHeaders = resolve;
    });
    const watchdog = createStreamWatchdog({
      ...metadata,
      inactivityMs: 20,
      overallMs: 60,
      headersReady,
      now: timers.now,
      timers,
    });

    timers.advance(30);
    expect(watchdog.signal.aborted).toBe(false);
    resolveHeaders();
    await Promise.resolve();
    timers.advance(19);
    expect(watchdog.signal.aborted).toBe(false);
    timers.advance(1);
    expect(timeoutErrorFromSignal(watchdog.signal)?.kind).toBe("stream_inactivity_timeout");
    watchdog.cleanup();

    const overall = createStreamWatchdog({
      ...metadata,
      inactivityMs: 100,
      overallMs: 60,
      headersReady: new Promise<void>(() => {}),
      now: timers.now,
      timers,
    });
    timers.advance(60);
    expect(timeoutErrorFromSignal(overall.signal)?.kind).toBe("overall_timeout");
    overall.cleanup();
  });
});

/** Build a controllable async iterable whose `next()` only resolves when the
 * harness releases it. Used to simulate a provider stream that is still
 * delivering transport bytes (via activity.notify) without yielding parser
 * events. */
function manualSource<T>(): {
  source: AsyncIterable<T>;
  release: () => void;
} {
  let release: () => void = () => {};
  const source: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T, void>> {
          return new Promise<IteratorResult<T, void>>((resolve) => {
            release = () => resolve({ done: true, value: undefined });
          });
        },
        return: async (): Promise<IteratorResult<T, void>> => ({ done: true, value: undefined }),
      };
    },
  };
  return { source, release: () => release() };
}

/** Pump the microtask queue enough to let the async-generator body of
 * streamWithExecutionDeadlines construct its watchdog (scheduling the
 * inactivity timer) before the test advances the manual clock. */
async function prime(timers: ManualTimers) {
  for (let i = 0; i < 10 && timers.pending() === 0; i += 1) {
    await Promise.resolve();
  }
}

describe("streamWithExecutionDeadlines activity watchdog", () => {
  it("keeps a silent stream alive while transport activity notifies within inactivityMs", async () => {
    const timers = new ManualTimers();
    const activity = createStreamActivity();
    const { source, release } = manualSource<string>();

    const stream = streamWithExecutionDeadlines(source, {
      ...metadata,
      connectMs: 1000,
      inactivityMs: 50,
      now: timers.now,
      timers,
      activity,
    });

    const events: string[] = [];
    const done = (async () => {
      for await (const ev of stream) events.push(ev);
    })();

    await prime(timers);
    expect(timers.pending()).toBeGreaterThan(0);

    // Cumulative silence with zero yielded events far exceeds inactivityMs,
    // but each transport-activity notification resets the inactivity clock.
    for (let step = 0; step < 4; step += 1) {
      timers.advance(40);
      activity.notify();
    }
    expect(timers.pending()).toBeGreaterThan(0);

    release();
    await expect(done).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });

  it("fires stream_inactivity_timeout when a silent stream never notifies", async () => {
    const timers = new ManualTimers();
    const activity = createStreamActivity();
    const { source } = manualSource<string>();

    const stream = streamWithExecutionDeadlines(source, {
      ...metadata,
      connectMs: 1000,
      inactivityMs: 50,
      now: timers.now,
      timers,
      activity,
    });
    const events: string[] = [];
    const done = (async () => {
      for await (const ev of stream) events.push(ev);
    })();

    await prime(timers);
    expect(timers.pending()).toBeGreaterThan(0);

    // No transport activity: a single gap longer than inactivityMs fires.
    timers.advance(51);
    await expect(done).rejects.toMatchObject({ kind: "stream_inactivity_timeout" });
    expect(events).toEqual([]);
  });

  it("resets inactivity via markStreamActivity fallback when options.activity is absent", async () => {
    const timers = new ManualTimers();
    const activity = createStreamActivity();
    const { source, release } = manualSource<string>();
    // No options.activity: the watchdog must discover the activity attached
    // to the source via markStreamActivity (execution-deadline.ts fallback).
    const marked = markStreamActivity(source, activity as StreamActivity);

    const stream = streamWithExecutionDeadlines(marked, {
      ...metadata,
      connectMs: 1000,
      inactivityMs: 50,
      now: timers.now,
      timers,
    });

    const events: string[] = [];
    const done = (async () => {
      for await (const ev of stream) events.push(ev);
    })();

    await prime(timers);
    expect(timers.pending()).toBeGreaterThan(0);

    for (let step = 0; step < 4; step += 1) {
      timers.advance(40);
      activity.notify();
    }
    expect(timers.pending()).toBeGreaterThan(0);

    release();
    await expect(done).resolves.toBeUndefined();
    expect(events).toEqual([]);
  });
});
