// =============================================================================
// Shared attachment and transport limits — Plan 003 workstream E
//
// One source of truth for limits that both the web UI and the localhost bridge
// must enforce (Plan 002 decision D4, PROVIDERS.md §9.4):
//   - raw attachment limits are enforced at UI admission;
//   - the encoded bridge body ceiling is enforced by the bridge (413) and by a
//     web-side preflight before any bridge-routed fetch.
// This module must stay dependency-free so both tsconfigs can include it and
// neither runtime pulls in the other's stack.
// =============================================================================

/** Maximum number of attachment files per task (UI admission). */
export const MAX_ATTACHMENT_FILES = 10;

/** Maximum bytes per attachment file (UI admission). */
export const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;

/** Maximum aggregate raw attachment bytes per task (UI admission). */
export const MAX_ATTACHMENT_TOTAL_BYTES = 40 * 1024 * 1024;

/** Maximum encoded JSON request body accepted by the localhost bridge. */
export const BRIDGE_MAX_BODY_BYTES = 64 * 1024 * 1024;

/** Base64 expansion of a raw payload plus a small JSON envelope allowance. */
export const BRIDGE_JSON_ENVELOPE_BYTES = 4096;

/**
 * Project the encoded transport size of a raw attachment payload (base64
 * expansion plus JSON envelope). Used by documentation assertions and by tests
 * proving the UI-admitted raw maximum fits the bridge ceiling. The web adapters
 * perform an exact serialized-size preflight before fetch, not this projection.
 */
export function projectEncodedBridgeBodyBytes(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4 + BRIDGE_JSON_ENVELOPE_BYTES;
}
