// =============================================================================
// RSemble AI — provider-neutral execution deadlines
//
// This module contains only deadline/abort primitives. Provider adapters and the
// run executor decide which durations to use and which events count as progress.
// A deadline is deliberately not a wall-clock policy for an entire reasoning
// request: connect, stream inactivity, and an optional overall ceiling are
// independent clocks.
// =============================================================================

/** The distinct timeout classes used by paid execution. */
export type ExecutionTimeoutKind =
  "connect_timeout" | "stream_inactivity_timeout" | "overall_timeout";

/** A caller cancellation is intentionally not an ExecutionTimeoutKind. */
export type ExecutionAbortKind = "user_abort";

/** Baseline defaults for paid provider requests. Catalog probes keep their
 * own shorter policy; providers may override these per request or model. */
export interface ProviderDeadlinePolicy {
  connectMs: number;
  inactivityMs: number;
  overallMs?: number;
}

export const DEFAULT_PROVIDER_DEADLINE_POLICY: Readonly<ProviderDeadlinePolicy> = Object.freeze({
  connectMs: 30_000,
  inactivityMs: 45_000,
});

export interface ExecutionTimeoutMetadata {
  /** Provider identifier, never a request body or credential. */
  provider: string;
  /** Provider-native model identifier. */
  model: string;
  /** Pipeline stage, for example candidate, judge, or fusion. */
  stage: string;
}

/**
 * Structured and safe timeout information. This object contains no request
 * messages, attachments, credentials, response bodies, or stack-derived text.
 */
export class ExecutionTimeoutError extends Error {
  readonly kind: ExecutionTimeoutKind;
  readonly timeoutKind: ExecutionTimeoutKind;
  readonly provider: string;
  readonly model: string;
  readonly stage: string;
  readonly configuredDurationMs: number;
  /** Alias retained for consumers that use the shorter duration spelling. */
  readonly durationMs: number;
  /** Alias for provider-oriented callers that use providerId terminology. */
  readonly providerId: string;
  /** Elapsed time on the clock that fired this timeout. */
  readonly elapsedMs: number;
  readonly startedAt: number;
  readonly lastProgressAt: number | null;

  constructor(
    kind: ExecutionTimeoutKind,
    metadata: ExecutionTimeoutMetadata,
    configuredDurationMs: number,
    elapsedMs: number,
    startedAt: number,
    lastProgressAt: number | null = null,
  ) {
    const label = `${metadata.provider}/${metadata.model} ${metadata.stage}`;
    super(
      `${kind} for ${label} after ${Math.max(0, elapsedMs)}ms (limit ${configuredDurationMs}ms)`,
    );
    this.name = "ExecutionTimeoutError";
    this.kind = kind;
    this.timeoutKind = kind;
    this.provider = metadata.provider;
    this.model = metadata.model;
    this.stage = metadata.stage;
    this.configuredDurationMs = configuredDurationMs;
    this.durationMs = configuredDurationMs;
    this.providerId = metadata.provider;
    this.elapsedMs = Math.max(0, elapsedMs);
    this.startedAt = startedAt;
    this.lastProgressAt = lastProgressAt;
  }

  /** A safe plain shape for diagnostics/persistence adapters. */
  toJSON(): {
    name: string;
    kind: ExecutionTimeoutKind;
    provider: string;
    model: string;
    stage: string;
    configuredDurationMs: number;
    elapsedMs: number;
  } {
    return {
      name: this.name,
      kind: this.kind,
      provider: this.provider,
      model: this.model,
      stage: this.stage,
      configuredDurationMs: this.configuredDurationMs,
      elapsedMs: this.elapsedMs,
    };
  }
}

export function isExecutionTimeoutError(value: unknown): value is ExecutionTimeoutError {
  return (
    value instanceof ExecutionTimeoutError ||
    (typeof value === "object" &&
      value !== null &&
      (value as { name?: unknown }).name === "ExecutionTimeoutError" &&
      isTimeoutKind((value as { kind?: unknown }).kind))
  );
}

function isTimeoutKind(value: unknown): value is ExecutionTimeoutKind {
  return (
    value === "connect_timeout" ||
    value === "stream_inactivity_timeout" ||
    value === "overall_timeout"
  );
}

/** Minimal timer surface, injectable for deterministic fake-clock tests. */
export interface DeadlineTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DeadlineClock {
  now(): number;
}

export interface DeadlineDependencies {
  /** Injectable clock. `now` is accepted as a convenient shorthand too. */
  clock?: DeadlineClock;
  now?: () => number;
  timers?: DeadlineTimers;
  /** Alias accepted for callers that call this a timer API. */
  timerApi?: DeadlineTimers;
}

const defaultTimers: DeadlineTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function resolveClock(deps: DeadlineDependencies): () => number {
  return deps.now ?? deps.clock?.now ?? (() => Date.now());
}

function resolveTimers(deps: DeadlineDependencies): DeadlineTimers {
  return deps.timers ?? deps.timerApi ?? defaultTimers;
}

/** Internal classification retained even where AbortSignal.reason is absent. */
export interface UserAbortReason {
  readonly kind: ExecutionAbortKind;
}

export type AbortClassification =
  | { kind: ExecutionAbortKind; reason: unknown }
  | { kind: ExecutionTimeoutKind; error: ExecutionTimeoutError };

const USER_ABORT: UserAbortReason = Object.freeze({ kind: "user_abort" });
const classifications = new WeakMap<AbortSignal, AbortClassification>();

function timeoutClassification(error: ExecutionTimeoutError): AbortClassification {
  return { kind: error.kind, error };
}

function userClassification(reason: unknown = USER_ABORT): AbortClassification {
  return { kind: "user_abort", reason };
}

function abortWithReason(controller: AbortController, reason: unknown): void {
  // AbortController.abort(reason) is missing in older browser runtimes. Keep the
  // WeakMap classification as the authoritative fallback in those environments.
  try {
    controller.abort(reason);
  } catch {
    controller.abort();
  }
}

function sourceClassification(signal: AbortSignal): AbortClassification {
  const remembered = classifications.get(signal);
  if (remembered) return remembered;

  const reason = signal.reason;
  if (isExecutionTimeoutError(reason)) return timeoutClassification(reason);
  if (
    typeof reason === "object" &&
    reason !== null &&
    isTimeoutKind((reason as { kind?: unknown }).kind)
  ) {
    // A structured reason from another realm may not pass instanceof Error. Keep
    // the signal's abort reason as a user-safe timeout-shaped fallback only when
    // all required metadata is present; otherwise classify conservatively.
    const r = reason as Partial<ExecutionTimeoutError>;
    if (
      typeof r.provider === "string" &&
      typeof r.model === "string" &&
      typeof r.stage === "string" &&
      typeof r.configuredDurationMs === "number" &&
      typeof r.elapsedMs === "number" &&
      typeof r.startedAt === "number"
    ) {
      const error = new ExecutionTimeoutError(
        r.kind as ExecutionTimeoutKind,
        { provider: r.provider, model: r.model, stage: r.stage },
        r.configuredDurationMs,
        r.elapsedMs,
        r.startedAt,
        typeof r.lastProgressAt === "number" ? r.lastProgressAt : null,
      );
      return timeoutClassification(error);
    }
  }
  return userClassification(reason);
}

/**
 * Classify an already-aborted signal. Returns null for a live signal. The
 * classification survives environments that expose `signal.aborted` but not
 * `signal.reason`.
 */
export function classifyAbortSignal(
  signal: AbortSignal | null | undefined,
): AbortClassification | null {
  if (!signal?.aborted) return null;
  return sourceClassification(signal);
}

/** True when cancellation was an explicit caller/user abort. */
export function isUserAbort(signal: AbortSignal | null | undefined): boolean {
  return classifyAbortSignal(signal)?.kind === "user_abort";
}

/** True when cancellation was caused by one of this module's deadlines. */
export function isExecutionTimeout(signal: AbortSignal | null | undefined): boolean {
  const classification = classifyAbortSignal(signal);
  return classification !== null && classification.kind !== "user_abort";
}

/** Return the structured timeout error when a signal was deadline-aborted. */
export function timeoutErrorFromSignal(
  signal: AbortSignal | null | undefined,
): ExecutionTimeoutError | null {
  const classification = classifyAbortSignal(signal);
  return classification && classification.kind !== "user_abort" ? classification.error : null;
}

/** Runtime-safe AbortError check. Some fetch implementations throw an Error
 * with `name: "AbortError"` rather than a DOMException. */
export function isAbortErrorLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "AbortError"
  );
}

/** Preserve deadline/user cancellation when an adapter catches fetch/reader
 * errors. Timeout reasons can be Error objects (not DOMExceptions), and older
 * browsers may erase `signal.reason`, so the internal classification is used. */
export function providerAbortError(error: unknown, signal?: AbortSignal): unknown | null {
  const timeout = timeoutErrorFromSignal(signal);
  if (timeout) return timeout;
  if (signal?.aborted && isUserAbort(signal)) {
    return isAbortErrorLike(error) ? error : new DOMException("Aborted", "AbortError");
  }
  return isAbortErrorLike(error) ? error : null;
}

export interface ComposedAbortSignal {
  readonly signal: AbortSignal;
  /** Remove source listeners. Does not abort the returned signal. */
  cleanup(): void;
}

/**
 * Compose a caller signal with one or more deadline signals. The first abort
 * wins. Source classification is copied into the composed signal rather than
 * relying solely on AbortSignal.reason.
 */
export function composeAbortSignals(
  ...sources: Array<AbortSignal | null | undefined>
): ComposedAbortSignal {
  const controller = new AbortController();
  const activeSources = sources.filter(
    (source): source is AbortSignal => source !== null && source !== undefined,
  );
  let cleaned = false;

  const finish = (source: AbortSignal): void => {
    if (cleaned || controller.signal.aborted) return;
    const classification = sourceClassification(source);
    classifications.set(controller.signal, classification);
    const reason =
      classification.kind === "user_abort" ? classification.reason : classification.error;
    abortWithReason(controller, reason);
  };

  const listeners = activeSources.map((source) => {
    const listener = () => finish(source);
    source.addEventListener("abort", listener, { once: true });
    return { source, listener };
  });

  for (const source of activeSources) {
    if (source.aborted) {
      finish(source);
      break;
    }
  }

  return {
    signal: controller.signal,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      for (const { source, listener } of listeners) {
        source.removeEventListener("abort", listener);
      }
    },
  };
}

/** Convenience singular form for caller + deadline composition. */
export function composeAbortSignal(
  callerSignal: AbortSignal | null | undefined,
  deadlineSignal: AbortSignal,
): ComposedAbortSignal {
  return composeAbortSignals(callerSignal, deadlineSignal);
}

export interface ExecutionDeadlineOptions extends DeadlineDependencies, ExecutionTimeoutMetadata {
  kind: ExecutionTimeoutKind;
  durationMs: number;
  /** Explicit caller/user cancellation signal. */
  signal?: AbortSignal;
}

export interface ExecutionDeadline {
  readonly signal: AbortSignal;
  readonly kind: ExecutionTimeoutKind;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly timeoutError: ExecutionTimeoutError | null;
  /** Stop timers/listeners after success, failure, or controlled teardown. */
  cleanup(): void;
  /** Alias for cleanup(), useful at call sites that use cancel terminology. */
  cancel(): void;
}

/**
 * Create one deadline clock. The returned signal aborts with an
 * ExecutionTimeoutError when its timer fires, or with a user classification
 * when the caller signal aborts. `cleanup()` is idempotent and never itself
 * reports a timeout.
 */
export function createExecutionDeadline(options: ExecutionDeadlineOptions): ExecutionDeadline {
  const now = resolveClock(options);
  const timers = resolveTimers(options);
  const startedAt = now();
  const ownController = new AbortController();
  const composed = composeAbortSignals(options.signal, ownController.signal);
  let timerHandle: unknown = null;
  let active = true;
  let timeoutError: ExecutionTimeoutError | null = null;

  classifications.set(ownController.signal, userClassification());

  const onComposedAbort = () => {
    if (!active) return;
    active = false;
    if (timerHandle !== null) {
      timers.clearTimeout(timerHandle);
      timerHandle = null;
    }
    const classification = classifyAbortSignal(composed.signal);
    if (classification && classification.kind !== "user_abort") timeoutError = classification.error;
  };
  composed.signal.addEventListener("abort", onComposedAbort, { once: true });
  // composeAbortSignals can observe an already-aborted caller synchronously
  // before the listener above is installed. Handle that case immediately so
  // the deadline timer never survives a caller abort.
  if (composed.signal.aborted) onComposedAbort();

  const fire = () => {
    if (!active || composed.signal.aborted) return;
    const elapsedMs = Math.max(0, now() - startedAt);
    timeoutError = new ExecutionTimeoutError(
      options.kind,
      { provider: options.provider, model: options.model, stage: options.stage },
      Math.max(0, options.durationMs),
      elapsedMs,
      startedAt,
    );
    classifications.set(ownController.signal, timeoutClassification(timeoutError));
    abortWithReason(ownController, timeoutError);
  };

  const delay = Math.max(0, options.durationMs);
  if (active && !composed.signal.aborted) timerHandle = timers.setTimeout(fire, delay);

  return {
    signal: composed.signal,
    kind: options.kind,
    durationMs: options.durationMs,
    startedAt,
    get timeoutError() {
      return timeoutError;
    },
    cleanup() {
      if (!active) {
        composed.signal.removeEventListener("abort", onComposedAbort);
        composed.cleanup();
        return;
      }
      active = false;
      if (timerHandle !== null) {
        timers.clearTimeout(timerHandle);
        timerHandle = null;
      }
      composed.signal.removeEventListener("abort", onComposedAbort);
      composed.cleanup();
    },
    cancel() {
      this.cleanup();
    },
  };
}

/** Short alias for call sites that prefer `createDeadline`. */
export const createDeadline = createExecutionDeadline;

export interface StreamWatchdogOptions extends DeadlineDependencies, ExecutionTimeoutMetadata {
  /** Time allowed between accepted progress notifications. */
  inactivityMs: number;
  /** Optional total ceiling; progress never resets this timer. */
  overallMs?: number;
  signal?: AbortSignal;
  /** Resolve when response headers have arrived. Inactivity starts then, not
   * at dispatch, while the overall ceiling still starts at dispatch. */
  headersReady?: PromiseLike<void>;
}

export interface StreamWatchdog {
  readonly signal: AbortSignal;
  readonly startedAt: number;
  readonly inactivityMs: number;
  readonly overallMs: number | null;
  readonly lastProgressAt: number;
  readonly timeoutError: ExecutionTimeoutError | null;
  /** Reset only after a valid byte/event has been accepted by the stream parser. */
  markProgress(): void;
  /** Explicit alias for adapters/readers whose vocabulary is `progress`. */
  progress(): void;
  /** Stop timers and listeners. Idempotent; does not abort a healthy stream. */
  cleanup(): void;
  cancel(): void;
}

/**
 * Watch a streaming operation using independent inactivity and overall clocks.
 * The watchdog itself never observes loop iterations: callers must invoke
 * `markProgress()` only after accepting a valid stream byte/event. Every mark
 * resets inactivity, while the optional overall ceiling remains unchanged.
 */
export function createStreamWatchdog(options: StreamWatchdogOptions): StreamWatchdog {
  const now = resolveClock(options);
  const timers = resolveTimers(options);
  const startedAt = now();
  let lastProgressAt = startedAt;
  const ownController = new AbortController();
  const composed = composeAbortSignals(options.signal, ownController.signal);
  let inactivityHandle: unknown = null;
  let overallHandle: unknown = null;
  let active = true;
  let timeoutError: ExecutionTimeoutError | null = null;
  let headersReached = options.headersReady === undefined;

  classifications.set(ownController.signal, userClassification());

  const clearInactivity = () => {
    if (inactivityHandle !== null) {
      timers.clearTimeout(inactivityHandle);
      inactivityHandle = null;
    }
  };
  const clearOverall = () => {
    if (overallHandle !== null) {
      timers.clearTimeout(overallHandle);
      overallHandle = null;
    }
  };
  const clearTimers = () => {
    clearInactivity();
    clearOverall();
  };

  const onComposedAbort = () => {
    if (!active) return;
    active = false;
    clearTimers();
    const classification = classifyAbortSignal(composed.signal);
    if (classification && classification.kind !== "user_abort") timeoutError = classification.error;
  };
  composed.signal.addEventListener("abort", onComposedAbort, { once: true });
  // See the equivalent check in createExecutionDeadline: a caller may already
  // be aborted when composition is created.
  if (composed.signal.aborted) onComposedAbort();

  const fire = (
    kind: ExecutionTimeoutKind,
    durationMs: number,
    relevantStart: number,
    progressAt: number | null,
  ) => {
    if (!active || composed.signal.aborted) return;
    const elapsedMs = Math.max(0, now() - relevantStart);
    timeoutError = new ExecutionTimeoutError(
      kind,
      { provider: options.provider, model: options.model, stage: options.stage },
      Math.max(0, durationMs),
      elapsedMs,
      startedAt,
      progressAt,
    );
    classifications.set(ownController.signal, timeoutClassification(timeoutError));
    abortWithReason(ownController, timeoutError);
  };

  const scheduleInactivity = () => {
    clearInactivity();
    inactivityHandle = timers.setTimeout(
      () => fire("stream_inactivity_timeout", options.inactivityMs, lastProgressAt, lastProgressAt),
      Math.max(0, options.inactivityMs),
    );
  };

  if (
    active &&
    !composed.signal.aborted &&
    options.overallMs !== undefined &&
    options.overallMs !== null
  ) {
    overallHandle = timers.setTimeout(
      () => fire("overall_timeout", options.overallMs ?? 0, startedAt, lastProgressAt),
      Math.max(0, options.overallMs),
    );
  }
  const onHeadersReady = () => {
    if (!active || composed.signal.aborted || headersReached) return;
    headersReached = true;
    lastProgressAt = now();
    scheduleInactivity();
  };
  if (options.headersReady !== undefined) {
    // A rejected readiness promise is handled by the source operation; do not
    // create an unhandled rejection in the watchdog itself.
    void options.headersReady.then(onHeadersReady, () => undefined);
  } else if (active && !composed.signal.aborted) {
    scheduleInactivity();
  }

  const cleanup = () => {
    if (!active) {
      composed.signal.removeEventListener("abort", onComposedAbort);
      composed.cleanup();
      return;
    }
    active = false;
    clearTimers();
    composed.signal.removeEventListener("abort", onComposedAbort);
    composed.cleanup();
  };

  const markProgress = () => {
    if (!active || composed.signal.aborted) return;
    // A source without an explicit headers-ready marker can begin timing at its
    // first accepted event. Marked provider streams start at response headers.
    if (!headersReached) {
      headersReached = true;
      lastProgressAt = now();
    } else {
      lastProgressAt = now();
    }
    scheduleInactivity();
  };

  return {
    signal: composed.signal,
    startedAt,
    inactivityMs: options.inactivityMs,
    overallMs: options.overallMs ?? null,
    get lastProgressAt() {
      return lastProgressAt;
    },
    get timeoutError() {
      return timeoutError;
    },
    markProgress,
    progress: markProgress,
    cleanup,
    cancel: cleanup,
  };
}

/** Short alias for stream-focused call sites. */
export const createStreamDeadline = createStreamWatchdog;

/** Reject a pending provider operation with its structured deadline/user-abort
 * classification. The underlying operation receives the composed signal and
 * callers remain responsible for provider-specific reader cleanup. */
export async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw timeoutErrorFromSignal(signal) ?? new DOMException("Aborted", "AbortError");
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () =>
      finish(() =>
        reject(timeoutErrorFromSignal(signal) ?? new DOMException("Aborted", "AbortError")),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export interface ExecutionOperationOptions extends DeadlineDependencies, ExecutionTimeoutMetadata {
  connectMs: number;
  /** Accepted for a shared policy object; non-stream operations do not use it. */
  inactivityMs?: number;
  overallMs?: number;
  signal?: AbortSignal;
  abortController?: AbortController;
}

/** Apply the connect and optional overall clocks to a non-stream operation.
 * `onHeadersReady` lets fetch adapters stop the connect clock at response
 * headers while keeping body parsing inside the overall ceiling. */
export async function runWithExecutionDeadlines<T>(
  operation: (signal: AbortSignal, onHeadersReady: () => void) => Promise<T>,
  options: ExecutionOperationOptions,
): Promise<T> {
  const connect = createExecutionDeadline({
    ...options,
    kind: "connect_timeout",
    durationMs: options.connectMs,
  });
  const overall =
    options.overallMs === undefined
      ? null
      : createExecutionDeadline({
          ...options,
          kind: "overall_timeout",
          durationMs: options.overallMs,
          signal: options.signal,
        });
  const composed = composeAbortSignals(connect.signal, overall?.signal);
  const forwardAbort = () => {
    if (!options.abortController || options.abortController.signal.aborted) return;
    abortWithReason(
      options.abortController,
      timeoutErrorFromSignal(composed.signal) ?? new DOMException("Aborted", "AbortError"),
    );
  };
  composed.signal.addEventListener("abort", forwardAbort, { once: true });
  let headersReady = false;
  const onHeadersReady = () => {
    if (headersReady) return;
    headersReady = true;
    connect.cleanup();
  };
  try {
    return await raceWithAbort(operation(composed.signal, onHeadersReady), composed.signal);
  } finally {
    composed.signal.removeEventListener("abort", forwardAbort);
    composed.cleanup();
    connect.cleanup();
    overall?.cleanup();
  }
}

export interface ExecutionStreamOptions extends DeadlineDependencies, ExecutionTimeoutMetadata {
  connectMs: number;
  inactivityMs: number;
  overallMs?: number;
  signal?: AbortSignal;
  abortController?: AbortController;
  /** Provider adapters resolve this as soon as response headers arrive. */
  headersReady?: PromiseLike<void>;
}

const STREAM_HEADERS_READY = Symbol("rsemble.streamHeadersReady");
type HeadersReadyStream = { [STREAM_HEADERS_READY]?: PromiseLike<void> };

/** Attach response-header readiness to a provider stream. This metadata is
 * intentionally non-enumerable in spirit (a symbol) and does not affect the
 * yielded protocol. */
export function markStreamHeadersReady<T>(
  source: AsyncIterable<T>,
  headersReady: PromiseLike<void>,
): AsyncIterable<T> {
  (source as AsyncIterable<T> & HeadersReadyStream)[STREAM_HEADERS_READY] = headersReady;
  return source;
}

function streamHeadersReadyOf<T>(source: AsyncIterable<T>): PromiseLike<void> | undefined {
  return (source as AsyncIterable<T> & HeadersReadyStream)[STREAM_HEADERS_READY];
}

/**
 * Consume an async provider stream with independent connect, inactivity, and
 * optional overall clocks. Each yielded item is an accepted parser event; it
 * resets inactivity, while the overall ceiling never resets. The iterator is
 * returned/cancelled on every terminal path.
 */
export function streamWithExecutionDeadlines<T>(
  source: AsyncIterable<T>,
  options: ExecutionStreamOptions,
): AsyncGenerator<T, void, unknown> {
  const headersReady = options.headersReady ?? streamHeadersReadyOf(source);
  const output = (async function* (): AsyncGenerator<T, void, unknown> {
    const connect = createExecutionDeadline({
      ...options,
      kind: "connect_timeout",
      durationMs: options.connectMs,
    });
    const watchdog = createStreamWatchdog({
      ...options,
      signal: connect.signal,
      headersReady,
      inactivityMs: options.inactivityMs,
      overallMs: options.overallMs,
    });
    const iterator = source[Symbol.asyncIterator]();
    const onHeadersReady = () => connect.cleanup();
    if (headersReady !== undefined) void headersReady.then(onHeadersReady, () => undefined);
    const forwardAbort = () => {
      if (!options.abortController || options.abortController.signal.aborted) return;
      abortWithReason(
        options.abortController,
        timeoutErrorFromSignal(watchdog.signal) ?? new DOMException("Aborted", "AbortError"),
      );
    };
    watchdog.signal.addEventListener("abort", forwardAbort, { once: true });
    let firstEvent = false;
    try {
      while (true) {
        const result = await raceWithAbort(iterator.next(), watchdog.signal);
        if (result.done) return;
        if (!firstEvent) {
          firstEvent = true;
          // Unmarked sources retain the historical first-event fallback. A
          // marked provider stream has already stopped connect at headers.
          if (headersReady === undefined) connect.cleanup();
        }
        watchdog.markProgress();
        yield result.value;
      }
    } finally {
      try {
        await iterator.return?.();
      } finally {
        watchdog.signal.removeEventListener("abort", forwardAbort);
        connect.cleanup();
        watchdog.cleanup();
      }
    }
  })();
  if (headersReady !== undefined) markStreamHeadersReady(output, headersReady);
  return output;
}

export interface FetchDeadlineOptions extends DeadlineDependencies, ExecutionTimeoutMetadata {
  connectMs?: number;
  overallMs?: number;
  signal?: AbortSignal;
}

/** Fetch wrapper whose operation boundary is response headers. */
export function fetchWithExecutionDeadline(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: FetchDeadlineOptions,
): Promise<Response> {
  const connectMs = options.connectMs ?? 30_000;
  return runWithExecutionDeadlines(
    (signal, onHeadersReady) =>
      fetch(input, { ...init, signal }).then((response) => {
        onHeadersReady();
        return response;
      }),
    {
      ...options,
      connectMs,
      overallMs: options.overallMs,
      signal: options.signal ?? init?.signal ?? undefined,
    },
  );
}
