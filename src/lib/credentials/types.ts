// =============================================================================
// CredentialStore contract — Plan 003 workstream A
//
// One provider-neutral credential resolution point (Plan 002 decision D1,
// PROVIDERS.md §9.2.1, PRODUCT.md §4.1). Precedence is:
//
//   environment > session > remembered
//
// Environment values are read-only in the UI and are never written by the
// store. Session values live in module memory for the tab. Remembered values
// are an explicit per-key opt-in stored under versioned keys. Legacy
// `rsemble.key.<provider>` values are migrated deliberately and idempotently.
// =============================================================================

import type { ProviderId } from "../providers/types";

/** Where a UI-entered credential lives. */
export type CredentialPersistence = "session" | "remembered";

export interface CredentialStore {
  /**
   * Resolved value for a provider: environment > session > remembered.
   * Returns "" when nothing is configured.
   */
  get(providerId: ProviderId): string;

  /**
   * Store a UI-entered value. `session` keeps it in module memory only;
   * `remembered` additionally persists it under a versioned key (explicit
   * opt-in). A remembered write that fails (storage unavailable) degrades to
   * session-only; `persistence()` reports the truthful outcome.
   */
  set(providerId: ProviderId, value: string, persistence: CredentialPersistence): void;

  /** Remove both session and remembered values for a provider (never env). */
  clear(providerId: ProviderId): void;

  /**
   * Where the currently visible value comes from:
   *   - null        — environment-managed or nothing configured;
   *   - "session"   — module memory (this tab);
   *   - "remembered" — versioned persistent browser storage.
   */
  persistence(providerId: ProviderId): CredentialPersistence | null;

  /**
   * Every configured credential value (environment, session, remembered, plus
   * legacy environment aliases). Supplied to the error redactor; must never be
   * logged or persisted itself.
   */
  configuredValues(): string[];
}
