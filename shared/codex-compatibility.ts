// =============================================================================
// Shared Codex compatibility taxonomy (Plan 008 W/D, CodeRabbit CR-18)
//
// Dependency-free so both the web bundle and the localhost bridge can import it
// (same pattern as shared/error-policy.ts and shared/http.ts). Single source of
// truth for the accepted Codex compatibility failure categories. The web side
// validates bridge-supplied `error.compatibility` strings against this set so
// an unknown/malformed bridge string cannot be surfaced as a diagnosis.
// =============================================================================

/** The accepted Codex compatibility failure categories. */
export const CODEX_COMPATIBILITY_CATEGORIES = [
  "bridge_unavailable",
  "auth_unavailable",
  "model_unavailable",
  "protocol_shape_changed",
  "client_metadata_rejected",
  "stream_terminated_unexpectedly",
] as const;

export type CodexCompatibilityFailure = (typeof CODEX_COMPATIBILITY_CATEGORIES)[number];

/** Type guard: is `value` one of the accepted compatibility categories? */
export function isCodexCompatibilityFailure(value: unknown): value is CodexCompatibilityFailure {
  return (
    typeof value === "string" &&
    (CODEX_COMPATIBILITY_CATEGORIES as readonly string[]).includes(value)
  );
}
