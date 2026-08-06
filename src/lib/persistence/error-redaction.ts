// =============================================================================
// RSemble AI — Error redaction (spec §18)
//
// Persisted errors are built through a bounded allowlist: redacted human
// message, normalized category, stage, optional model, and timestamp. The
// message is redacted against exact configured credential values of six or
// more characters and against authorization fragments (Bearer/Basic schemes,
// Authorization header values), then capped at 4 KiB UTF-8 without splitting a
// surrogate pair. Raw provider bodies are never persisted.
// =============================================================================

import { errorMessage } from "../llm-utils";
import { credentialStore } from "../credentials/credential-store";
import type { PersistedError } from "./run-types";

export const REDACTED = "[REDACTED]";
export const ERROR_TEXT_CAP_BYTES = 4096;

/** Shorter configured values are never redacted — avoids mangling prose. */
export const MIN_CREDENTIAL_LENGTH = 6;

/** Authorization-fragment patterns — the scheme/header word plus its value. */
const AUTH_FRAGMENT_PATTERNS: readonly RegExp[] = [
  /bearer\s+[^\s,;]+/gi,
  /basic\s+[^\s,;]+/gi,
  /authorization\s*[:=]\s*[^\s,;]+/gi,
];

/** UTF-8 byte cap that never splits a surrogate pair. */
export function capUtf8(text: string, maxBytes: number): string {
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

function defaultReadEnv(key: string): string | undefined {
  return (import.meta.env as Record<string, unknown>)[key] as string | undefined;
}

/**
 * All configured credential values (≥ MIN_CREDENTIAL_LENGTH chars) resolved
 * through the shared CredentialStore plus legacy environment aliases that
 * predate the store. `readEnv` is injectable for tests; production callers use
 * the default reader.
 */
export function configuredCredentialValues(
  readEnv: (key: string) => string | undefined = defaultReadEnv,
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  const collect = (value: string | null | undefined) => {
    if (typeof value !== "string" || value.length < MIN_CREDENTIAL_LENGTH) return;
    if (seen.has(value)) return;
    seen.add(value);
    values.push(value);
  };
  for (const value of credentialStore.configuredValues()) collect(value);
  // Legacy environment aliases that predate the store (kept for redaction
  // coverage of older .env files).
  for (const key of ["VITE_UMANS_API_KEY"]) collect(readEnv(key));
  return values;
}

/**
 * Replace every exact configured credential value (≥ 6 chars) with [REDACTED],
 * strip authorization fragments (Bearer/Basic schemes, Authorization header
 * values), then cap at ERROR_TEXT_CAP_BYTES.
 */
export function redactErrorText(text: string, credentialValues: readonly string[]): string {
  let out = text;
  const values = [...credentialValues]
    .filter((v) => v.length >= MIN_CREDENTIAL_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }
  for (const pattern of AUTH_FRAGMENT_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return capUtf8(out, ERROR_TEXT_CAP_BYTES);
}

export interface SanitizeErrorContext {
  category: string;
  stage: string;
  model?: string;
}

/**
 * Build an allowlisted PersistedError: { message (redacted+capped), category,
 * stage, model?, at }.
 */
export function sanitizePersistedError(
  err: unknown,
  ctx: SanitizeErrorContext,
  now: () => number,
  credentialValues?: readonly string[],
): PersistedError {
  const message = redactErrorText(errorMessage(err), credentialValues ?? configuredCredentialValues());
  return {
    message,
    category: ctx.category,
    stage: ctx.stage,
    ...(ctx.model !== undefined ? { model: ctx.model } : {}),
    at: now(),
  };
}
