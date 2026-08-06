// =============================================================================
// Shared bounded HTTP helpers — Plan 003 workstream D
//
// Provider error bodies are read with a hard byte cap so that oversized or
// hostile upstream bodies can never enter provider errors, logs, or persisted
// evidence. Dependency-free so both the web bundle and the localhost bridge
// can import it.
// =============================================================================

export const DEFAULT_ERROR_BODY_CAP_BYTES = 8192;

/** Shape common to web and Node fetch Responses. */
export interface BoundedReadableResponse {
  body: ReadableStream<Uint8Array> | null;
}

/**
 * Read at most `maxBytes` bytes of a response body as text. Truncation happens
 * at a UTF-8 character boundary. Returns "" when the body is missing.
 */
export async function readBoundedResponseText(
  response: BoundedReadableResponse,
  maxBytes = DEFAULT_ERROR_BODY_CAP_BYTES,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - bytes;
      if (remaining <= 0) break;
      const slice = value.length > remaining ? value.slice(0, remaining) : value;
      out += decoder.decode(slice, { stream: true });
      bytes += slice.length;
      if (value.length > remaining) break;
    }
    out += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return out;
}
