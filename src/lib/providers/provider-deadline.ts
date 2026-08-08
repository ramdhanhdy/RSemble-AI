import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  isExecutionTimeoutError,
  markStreamHeadersReady,
  providerAbortError,
  runWithExecutionDeadlines,
  streamWithExecutionDeadlines,
  type ProviderDeadlinePolicy,
  type StreamActivity,
} from "../execution-deadline";

/** Shared production policy and adapter seams for paid provider requests. */
export const PROVIDER_DEADLINES: Readonly<ProviderDeadlinePolicy> =
  DEFAULT_PROVIDER_DEADLINE_POLICY;

export function createHeadersReady(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export async function runProviderRequest<T>(
  operation: (signal: AbortSignal, onHeadersReady: () => void) => Promise<T>,
  context: {
    provider: string;
    model: string;
    stage?: string;
    signal?: AbortSignal;
    policy?: ProviderDeadlinePolicy;
  },
): Promise<T> {
  return runWithExecutionDeadlines(operation, {
    ...(context.policy ?? PROVIDER_DEADLINES),
    provider: context.provider,
    model: context.model,
    stage: context.stage ?? "provider",
    signal: context.signal,
  });
}

export function wrapProviderStream<T>(
  source: AsyncIterable<T>,
  headersReady: PromiseLike<void>,
  context: {
    provider: string;
    model: string;
    stage?: string;
    signal?: AbortSignal;
    abortController?: AbortController;
    policy?: ProviderDeadlinePolicy;
    activity?: StreamActivity;
  },
): AsyncGenerator<T, void, unknown> {
  const marked = markStreamHeadersReady(source, headersReady);
  return streamWithExecutionDeadlines(marked, {
    ...(context.policy ?? PROVIDER_DEADLINES),
    provider: context.provider,
    model: context.model,
    stage: context.stage ?? "provider",
    signal: context.signal,
    abortController: context.abortController,
    headersReady,
    activity: context.activity,
  });
}

export function rethrowProviderAbort(error: unknown, signal?: AbortSignal): never | null {
  if (isExecutionTimeoutError(error)) throw error;
  const abort = providerAbortError(error, signal);
  if (abort !== null) throw abort;
  return null;
}
