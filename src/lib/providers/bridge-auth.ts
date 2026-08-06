// =============================================================================
// Bridge authentication helper — Plan 003 workstream C
//
// Browser side of the Plan 002 decision D3 contract: when
// `VITE_RSEMBLE_BRIDGE_SECRET` is configured, every bridge-routed request
// carries `X-RSemble-Bridge-Secret`; the localhost bridge enforces it.
// =============================================================================

export const BRIDGE_SECRET_HEADER = "X-RSemble-Bridge-Secret";

/** The configured web-side bridge secret (Vite-embedded), trimmed, or "". */
export function configuredBridgeSecret(): string {
  const value = (import.meta.env.VITE_RSEMBLE_BRIDGE_SECRET as string | undefined) ?? "";
  return value.trim();
}

/** Headers to attach to bridge requests when a secret is configured. */
export function bridgeAuthHeaders(): Record<string, string> {
  const secret = configuredBridgeSecret();
  return secret.length > 0 ? { [BRIDGE_SECRET_HEADER]: secret } : {};
}
