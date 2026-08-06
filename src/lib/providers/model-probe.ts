// =============================================================================
// Model-route probe service (spec §8).
//
// Tests the exact provider and model slug through the real streaming adapter
// with a minimal generation request, returning a structured, sanitized
// ModelProbeState. This is separate from provider readiness: a provider can
// be healthy while a specific model route is unavailable or
// protocol-incompatible.
//
// Request contract (spec §8.2):
//   - one short user message asking for the exact token "OK"
//   - temperature: 0
//   - maxTokens: 128 (enough for reasoning routes to reach final content)
//   - streaming path (chatCompletionStream)
//   - 20-second default timeout
//   - user-initiated only; no automatic retry; no Judge or fusion stage
// =============================================================================

import { type LLMProvider, type ProviderId, ProviderError } from "./types";

export type ModelProbeFailureCategory =
  | "unauthorized"
  | "unavailable"
  | "rate-limited"
  | "timeout"
  | "empty-stream"
  | "protocol-incompatible"
  | "network"
  | "unknown";

export type ModelProbeState =
  | { kind: "untested" }
  | { kind: "testing"; startedAt: number }
  | { kind: "ready"; latencyMs: number; testedAt: number }
  | { kind: "failed"; category: ModelProbeFailureCategory; message: string; testedAt: number };

export interface ProbeModelRouteOptions {
  provider: LLMProvider;
  providerId: ProviderId;
  model: string;
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Default probe timeout (spec §8.2). */
export const DEFAULT_PROBE_TIMEOUT_MS = 20_000;

/**
 * Probe one model route through the real streaming adapter.
 *
 * Sends one short user message, consumes the stream, and returns a sanitized
 * structured result. Never calls readiness() — the point is to exercise the
 * exact model route.
 */
export async function probeModelRoute(opts: ProbeModelRouteOptions): Promise<ModelProbeState> {
  const { provider, providerId, model } = opts;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // Forward caller abort to the timeout controller.
  const callerSignal = opts.signal;
  const onCallerAbort = () => ctrl.abort();
  if (callerSignal) {
    if (callerSignal.aborted) ctrl.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const start = now();
  let yieldedAny = false;

  try {
    const stream = provider.chatCompletionStream({
      model,
      messages: [{ role: "user", content: "Reply with the exact token: OK" }],
      temperature: 0,
      maxTokens: 128,
      signal: ctrl.signal,
    });

    // Race stream consumption against the timeout. Well-behaved adapters
    // abort on the signal, but a stuck generator that never checks it must
    // still hit the probe deadline.
    const consume = async (): Promise<boolean> => {
      for await (const _delta of stream) {
        yieldedAny = true;
      }
      return yieldedAny;
    };

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      ctrl.signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

    let result: boolean;
    try {
      result = await Promise.race([consume(), timeoutPromise]);
    } catch (err) {
      throw err;
    }

    if (!result) {
      return {
        kind: "failed",
        category: "empty-stream",
        message: `${provider.label} · ${model}: stream completed with no content.`,
        testedAt: now(),
      };
    }

    return {
      kind: "ready",
      latencyMs: Math.max(0, now() - start),
      testedAt: now(),
    };
  } catch (err) {
    return classifyError(err, provider.label, model, providerId, now);
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort);
  }
}

function classifyError(
  err: unknown,
  label: string,
  model: string,
  providerId: ProviderId,
  now: () => number,
): ModelProbeState {
  // Client abort → timeout (the probe's own deadline fired).
  if (err instanceof DOMException && err.name === "AbortError") {
    return {
      kind: "failed",
      category: "timeout",
      message: `${label} · ${model}: probe timed out after no response.`,
      testedAt: now(),
    };
  }

  if (err instanceof ProviderError) {
    const status = err.status;
    const category = categorizeByStatus(status, err.message, providerId);
    const message = safeMessage(label, model, category, status);
    return { kind: "failed", category, message, testedAt: now() };
  }

  // Generic Error — classify by message signature, but never disclose raw.
  if (err instanceof Error) {
    const category = categorizeByMessage(err.message);
    const message = safeMessage(label, model, category);
    return { kind: "failed", category, message, testedAt: now() };
  }

  return {
    kind: "failed",
    category: "unknown",
    message: safeMessage(label, model, "unknown"),
    testedAt: now(),
  };
}

function categorizeByStatus(
  status: number | undefined,
  message: string,
  providerId: ProviderId,
): ModelProbeFailureCategory {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "unavailable";
  if (status === 429) return "rate-limited";
  if (status !== undefined && status >= 500) return "unavailable";
  // No status — classify by message.
  return categorizeByMessage(message, providerId);
}

function categorizeByMessage(message: string, _providerId?: ProviderId): ModelProbeFailureCategory {
  const lower = message.toLowerCase();
  if (lower.includes("no [done] sentinel") || lower.includes("ended unexpectedly")) {
    return "protocol-incompatible";
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication")
  ) {
    return "unauthorized";
  }
  if (
    lower.includes("not found") ||
    lower.includes("unavailable") ||
    lower.includes("does not exist")
  ) {
    return "unavailable";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "rate-limited";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch") ||
    lower.includes("reach") ||
    lower.includes("connection")
  ) {
    return "network";
  }
  if (lower.includes("empty stream") || lower.includes("no content")) {
    return "empty-stream";
  }
  return "unknown";
}

/**
 * Build a safe display message from the label, model slug, normalized
 * category, and optionally a validated HTTP status. The raw provider error
 * message is NEVER included — it may contain credentials, authorization
 * headers, raw request bodies, or full prompts that must not be disclosed
 * (spec §8.3, §15).
 */
function safeMessage(
  label: string,
  model: string,
  category: ModelProbeFailureCategory,
  status?: number,
): string {
  const statusPart = typeof status === "number" && status > 0 ? ` (HTTP ${status})` : "";
  return `${label} · ${model}: ${category}${statusPart}`;
}
