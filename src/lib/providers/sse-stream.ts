// =============================================================================
// Shared SSE streaming reader for OpenAI-compatible chat completion streams.
//
// All providers that consume SSE `data:` lines (OpenRouter, Umans, ChatGPT via
// the local bridge, CommandCode, ClinePass) share the same parsing loop. This
// module centralizes the loop so the EOF / empty-stream / abort correctness fix
// lives in one place.
//
// Correctness contract:
//   - A stream that sends `data: [DONE]` is a normal completion.
//   - A stream that ends (reader done) WITHOUT `[DONE]` is an unexpected EOF —
//     the response may be truncated. We throw ProviderError so the caller never
//     marks partial output as "done".
//   - A stream that sends `[DONE]` but never yielded any content delta is an
//     empty stream — throw ProviderError.
//   - A reader.read() rejection (network drop) is distinguished from a client
//     abort (AbortError propagates as-is).
// =============================================================================

import { type CostRecord, type UsageBreakdown, ProviderError, type ProviderId } from "./types";
import { parseOpenAICompatibleUsage, parseProviderReportedCost } from "./usage";
import { providerAbortError, type StreamActivityNotifier } from "../execution-deadline";

export interface SseChunk {
  choices?: { delta?: { content?: string } }[];
  usage?: unknown;
  cost?: unknown;
}

/** Mutable sink for final-chunk accounting metadata (OpenAI-compat streams). */
export interface SseMeta {
  usage: UsageBreakdown | null;
  cost: CostRecord | null;
}

/**
 * Consume an SSE chat-completion stream from a Response body, yielding text
 * deltas. Throws ProviderError on unexpected EOF, empty stream, or read
 * failure. Re-throws DOMException AbortError unchanged so callers can
 * distinguish client-initiated cancellation.
 */
export async function* readSseChatStream(
  body: ReadableStream<Uint8Array>,
  providerId: ProviderId,
  label: string,
  signal?: AbortSignal,
  meta?: SseMeta,
  activity?: StreamActivityNotifier,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let yieldedAny = false;

  try {
    while (true) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
      } catch (err) {
        // Preserve structured timeout reasons and user aborts. AbortError may
        // be a plain Error in some fetch implementations.
        const abort = providerAbortError(err, signal);
        if (abort !== null) throw abort;
        // Any other read rejection = upstream connection dropped mid-stream.
        throw new ProviderError(
          `${label} stream interrupted — upstream read failure. Partial output discarded.`,
          providerId,
        );
      }

      if (done) break;

      // Transport-level activity: any raw bytes (including SSE comment
      // keep-alive lines such as OpenRouter's `: OPENROUTER PROCESSING`)
      // count as accepted progress for the inactivity watchdog, so a slow
      // upstream model that keeps the connection chatty is never killed
      // while it is still alive.
      activity?.notify();

      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0 || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          sawDone = true;
          if (!yieldedAny) {
            throw new ProviderError(
              `${label} returned an empty stream ([DONE] with no content).`,
              providerId,
            );
          }
          return;
        }
        try {
          const chunk = JSON.parse(payload) as SseChunk;
          // Final accounting chunk: no content delta, but carries usage/cost.
          if (chunk.usage && meta) meta.usage = parseOpenAICompatibleUsage(chunk.usage);
          if (chunk.cost !== undefined && meta) {
            const reported = parseProviderReportedCost(chunk.cost);
            if (reported) meta.cost = reported;
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            yieldedAny = true;
            yield delta;
          }
        } catch {
          // Partial JSON across chunk boundaries — keep buffering.
        }
      }
    }

    // Stream ended (reader.done) without a [DONE] sentinel → unexpected EOF.
    if (!sawDone) {
      // If the abort signal fired, this "unexpected EOF" is actually a cancel.
      if (signal?.aborted) {
        throw providerAbortError(undefined, signal) ?? new DOMException("Aborted", "AbortError");
      }
      throw new ProviderError(
        `${label} stream ended unexpectedly (no [DONE] sentinel). The response may be incomplete.`,
        providerId,
      );
    }
  } finally {
    reader.releaseLock();
  }
}
