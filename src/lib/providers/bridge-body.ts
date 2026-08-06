// =============================================================================
// Bridge request-body preflight — Plan 003 workstream E
//
// Bridge-routed providers serialize their request body once, then enforce the
// encoded bridge ceiling (Plan 002 D4) BEFORE any fetch. The localhost bridge
// enforces the same ceiling with 413; the web-side preflight makes oversized
// requests fail fast with an exact transport-size error instead of a paid or
// confusing transport failure.
// =============================================================================

import type { ProviderId } from "./types";
import { ProviderError } from "./types";
import { BRIDGE_MAX_BODY_BYTES } from "../../../shared/limits";

/**
 * Throw a ProviderError naming the encoded transport size when `body` exceeds
 * `limitBytes` (default: the shared bridge ceiling).
 */
export function assertBridgeBodyWithinLimit(
  body: string,
  providerId: ProviderId,
  limitBytes: number = BRIDGE_MAX_BODY_BYTES,
): void {
  if (new TextEncoder().encode(body).length <= limitBytes) return;
  const mib = (new TextEncoder().encode(body).length / (1024 * 1024)).toFixed(1);
  const limitMib = (limitBytes / (1024 * 1024)).toFixed(1);
  throw new ProviderError(
    `Encoded request body (~${mib} MiB) exceeds the ${limitMib} MiB local bridge limit. Reduce attachment sizes or use a provider that accepts them.`,
    providerId,
  );
}

/** Serialize a bridge request body once, enforcing the encoded ceiling when
 *  the payload contains media/file parts (the only case that approaches it). */
export function buildBridgeRequestBody(
  payload: Record<string, unknown>,
  providerId: ProviderId,
  hasParts: boolean,
  limitBytes: number = BRIDGE_MAX_BODY_BYTES,
): string {
  const body = JSON.stringify(payload);
  if (hasParts) assertBridgeBodyWithinLimit(body, providerId, limitBytes);
  return body;
}
