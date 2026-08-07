// =============================================================================
// Provider-error message policy (web) — review fix 3
//
// Builds ProviderError messages from upstream bodies under the shared policy
// (shared/error-policy.ts) and additionally redacts every configured
// credential value before the message becomes throw/UI-visible.
// =============================================================================

import { sanitizeProviderErrorMessage } from "../../../shared/error-policy";
import { configuredCredentialValues, redactErrorText } from "../persistence/error-redaction";

/**
 * Convert a bounded raw upstream body into a safe, UI-visible provider error
 * detail: recognized structured messages are bounded and credential-redacted;
 * unknown JSON, plain text, and HTML bodies become a generic status message.
 */
export function providerErrorDetail(
  rawBody: string,
  providerLabel: string,
  status: number,
): string {
  const base = sanitizeProviderErrorMessage(rawBody, providerLabel, status);
  return redactErrorText(base, configuredCredentialValues());
}
