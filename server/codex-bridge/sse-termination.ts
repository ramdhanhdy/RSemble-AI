// =============================================================================
// SSE termination normalizer for 9Router clean-EOF compatibility (spec §9).
//
// Several 9Router backends produce valid content and then close their SSE
// response cleanly without the OpenAI `data: [DONE]` sentinel. The browser
// parser cannot distinguish that valid route convention from a truncated
// response and rejects it. This module incrementally inspects SSE event
// boundaries while preserving streamed bytes, and decides at upstream EOF
// whether to append exactly one `data: [DONE]\n\n` sentinel.
//
// Rules (spec §9.2):
//   1. If [DONE] was observed, end unchanged.
//   2. If at least one valid content-bearing OpenAI delta was observed and
//      iteration ended normally, append exactly `data: [DONE]\n\n`.
//   3. If no usable content was observed, end unchanged (empty stream error).
//   4. If reading threw, the client disconnected, or the upstream was aborted,
//      do not append [DONE].
//   5. Never append a duplicate sentinel.
// =============================================================================

export interface SseTerminationState {
  /** Unconsumed partial line buffer (may span chunk boundaries). */
  pending: string;
  /** Whether `data: [DONE]` was observed in any complete event line. */
  sawDone: boolean;
  /** Whether at least one valid content-bearing OpenAI delta was observed. */
  sawUsableContent: boolean;
}

/** Initial state for a new SSE stream inspection. */
export function initialSseTerminationState(): SseTerminationState {
  return { pending: "", sawDone: false, sawUsableContent: false };
}

/**
 * Incrementally inspect one chunk of SSE bytes. Returns updated state.
 * The chunk is decoded as UTF-8 and split on `\n` boundaries; any partial
 * line is retained in `pending` for the next chunk.
 */
export function inspectOpenAiSseChunk(
  state: SseTerminationState,
  chunk: Uint8Array,
): SseTerminationState {
  const text = new TextDecoder().decode(chunk, { stream: true });
  let buffer = state.pending + text;
  let { sawDone, sawUsableContent } = state;

  let nl: number;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);

    // Skip blank lines and comments/heartbeats (: comment).
    if (line.length === 0 || line.startsWith(":")) continue;
    // Only `data:` lines carry OpenAI event payloads.
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      continue;
    }

    // Try to parse as an OpenAI chat completion chunk.
    try {
      const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        sawUsableContent = true;
      }
    } catch {
      // Partial JSON across chunk boundaries — keep buffering; the next
      // chunk may complete the line. Malformed JSON on a complete line is
      // silently ignored (not usable content, not [DONE]).
    }
  }

  return { pending: buffer, sawDone, sawUsableContent };
}

/**
 * Decide whether to append `data: [DONE]\n\n` at upstream EOF.
 *
 * @param state - Final inspection state after all chunks.
 * @param completedNormally - True if the upstream body iteration ended without
 *   throwing and the client did not disconnect.
 * @returns True if exactly one sentinel should be appended.
 */
export function shouldAppendDone(
  state: SseTerminationState,
  completedNormally: boolean,
): boolean {
  // Rule 1 & 5: never duplicate.
  if (state.sawDone) return false;
  // Rule 4: abnormal termination — do not synthesize.
  if (!completedNormally) return false;
  // Rule 3: no usable content — let the browser report an empty stream.
  if (!state.sawUsableContent) return false;
  // Rule 2: clean content-bearing EOF — append exactly one sentinel.
  return true;
}

/** The exact bytes to append when shouldAppendDone returns true. */
export const DONE_SENTINEL = "data: [DONE]\n\n";
