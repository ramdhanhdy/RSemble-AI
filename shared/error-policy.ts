// =============================================================================
// Shared provider-error parsing policy — review fix 3
//
// One consistent policy for upstream provider error bodies:
//   - recognized structured message (`{ error: { message } }`) → bounded and
//     auth-fragment-redacted;
//   - unknown JSON shape → generic provider/status error;
//   - non-JSON / plain-text / HTML body → generic provider/status error;
//   - the raw body is NEVER placed into the returned message.
// Dependency-free so both the web bundle and the localhost bridge use it.
// =============================================================================

const AUTH_FRAGMENT_PATTERNS: readonly RegExp[] = [
  /bearer\s+[^\s,;]+/gi,
  /basic\s+[^\s,;]+/gi,
  /authorization\s*[:=]\s*[^\s,;]+/gi,
];

/** Redact common authorization fragments (Bearer/Basic/Authorization header). */
export function redactAuthFragments(text: string): string {
  let out = text;
  for (const pattern of AUTH_FRAGMENT_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  return out;
}

/** Cap text at a UTF-8 byte bound without splitting a surrogate pair. */
export function capTextBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const len = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + len > maxBytes) break;
    bytes += len;
    units += ch.length;
  }
  return units === text.length ? text : text.slice(0, units);
}

/**
 * Build the message for a provider error from a bounded raw body.
 * Returns a redacted, bounded message that never contains the raw body.
 */
export function sanitizeProviderErrorMessage(
  raw: string,
  providerLabel: string,
  status: number,
  maxMessageBytes = 4096,
): string {
  let detail = "";
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > 0) {
    try {
      const body = JSON.parse(trimmed) as { error?: { message?: string } };
      if (typeof body?.error?.message === "string" && body.error.message.trim().length > 0) {
        detail = body.error.message.trim();
      }
    } catch {
      // Non-JSON / plain-text / HTML bodies → generic error, never raw.
    }
  }
  const message =
    detail.length > 0 ? detail : `${providerLabel} request failed (HTTP ${status}).`;
  return capTextBytes(redactAuthFragments(message), maxMessageBytes);
}
