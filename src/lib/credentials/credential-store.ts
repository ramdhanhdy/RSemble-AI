// =============================================================================
// CredentialStore implementation — Plan 003 workstream A
//
// Default singleton plus an injectable factory so tests can exercise
// environment / session / remembered precedence, migration, and
// unavailable-storage behavior deterministically without a real browser.
// =============================================================================

import type { ProviderId } from "../providers/types";
import type { CredentialStore } from "./types";

/** Remembered keys are versioned: `rsemble.key.<provider>.v2`. */
const REMEMBERED_KEY_PREFIX = "rsemble.key.";
const REMEMBERED_KEY_SUFFIX = ".v2";

/** Environment key per provider. Codex uses the bridge, not an API key. */
const ENV_KEYS: Record<ProviderId, string> = {
  openrouter: "VITE_OPENROUTER_KEY",
  "chatgpt-codex": "",
  gemini: "VITE_GEMINI_KEY",
  deepseek: "VITE_DEEPSEEK_KEY",
  commandcode: "VITE_COMMANDCODE_KEY",
  clinepass: "VITE_CLINEPASS_KEY",
  umans: "VITE_UMANS_KEY",
  "9router": "VITE_9ROUTER_KEY",
};

/** Legacy environment aliases kept for redaction coverage. */
const LEGACY_ENV_KEYS: readonly string[] = ["VITE_UMANS_API_KEY"];

export const REMEMBERED_KEY_VERSION = REMEMBERED_KEY_SUFFIX;

export interface CredentialStoreDeps {
  readEnv(key: string): string | undefined;
  readStorage(key: string): string | null;
  writeStorage(key: string, value: string): void;
  removeStorage(key: string): void;
}

const defaultDeps: CredentialStoreDeps = {
  readEnv: (key) => (import.meta.env as Record<string, unknown>)[key] as string | undefined,
  readStorage: (key) => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  writeStorage: (key, value) => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage unavailable — the value stays session-only.
    }
  },
  removeStorage: (key) => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // Storage unavailable — nothing to remove.
    }
  },
};

export function rememberedStorageKey(providerId: ProviderId): string {
  return `${REMEMBERED_KEY_PREFIX}${providerId}${REMEMBERED_KEY_SUFFIX}`;
}

export function legacyStorageKey(providerId: ProviderId): string {
  return `${REMEMBERED_KEY_PREFIX}${providerId}`;
}

function trim(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function createCredentialStore(deps: CredentialStoreDeps = defaultDeps): CredentialStore {
  const session = new Map<ProviderId, string>();
  let migrated = false;

  /** Idempotent, deliberate legacy migration: copy each legacy key into the
   *  versioned remembered store once, then remove the legacy key. Never logs
   *  values. A pre-existing versioned value is never overwritten. */
  function migrateLegacy(): void {
    if (migrated) return;
    migrated = true;
    for (const id of Object.keys(ENV_KEYS) as ProviderId[]) {
      const legacy = trim(deps.readStorage(legacyStorageKey(id)));
      if (legacy.length === 0) continue;
      const v2 = trim(deps.readStorage(rememberedStorageKey(id)));
      if (v2.length === 0) deps.writeStorage(rememberedStorageKey(id), legacy);
      deps.removeStorage(legacyStorageKey(id));
    }
  }

  function envValue(providerId: ProviderId): string {
    const key = ENV_KEYS[providerId];
    return key ? trim(deps.readEnv(key)) : "";
  }

  function rememberedValue(providerId: ProviderId): string {
    return trim(deps.readStorage(rememberedStorageKey(providerId)));
  }

  return {
    get(providerId) {
      migrateLegacy();
      return envValue(providerId) || session.get(providerId) || rememberedValue(providerId);
    },

    set(providerId, value, persistence) {
      migrateLegacy();
      const cleaned = trim(value);
      session.set(providerId, cleaned);
      if (persistence === "remembered") {
        try {
          deps.writeStorage(rememberedStorageKey(providerId), cleaned);
        } catch {
          // Storage unavailable — the value stays session-only.
        }
      }
    },

    clear(providerId) {
      migrateLegacy();
      session.delete(providerId);
      try {
        deps.removeStorage(rememberedStorageKey(providerId));
      } catch {
        // Storage unavailable — nothing to remove.
      }
    },

    persistence(providerId) {
      migrateLegacy();
      if (envValue(providerId).length > 0) return null;
      const remembered = rememberedValue(providerId);
      const sessionValue = session.get(providerId);
      if (sessionValue !== undefined) {
        // The visible value is the session one; report "remembered" only when
        // the exact same value is what is persisted.
        return remembered.length > 0 && remembered === sessionValue ? "remembered" : "session";
      }
      return remembered.length > 0 ? "remembered" : null;
    },

    configuredValues() {
      migrateLegacy();
      const values: string[] = [];
      const seen = new Set<string>();
      const push = (value: string) => {
        const cleaned = trim(value);
        if (cleaned.length === 0 || seen.has(cleaned)) return;
        seen.add(cleaned);
        values.push(cleaned);
      };
      for (const id of Object.keys(ENV_KEYS) as ProviderId[]) push(envValue(id));
      for (const key of LEGACY_ENV_KEYS) push(deps.readEnv(key) ?? "");
      for (const value of session.values()) push(value);
      for (const id of Object.keys(ENV_KEYS) as ProviderId[]) push(rememberedValue(id));
      return values;
    },
  };
}

/** The shared application store used by provider adapters and the UI. */
const shared: { impl: CredentialStore } = { impl: createCredentialStore() };

export const credentialStore: CredentialStore = {
  get: (providerId) => shared.impl.get(providerId),
  set: (providerId, value, persistence) => shared.impl.set(providerId, value, persistence),
  clear: (providerId) => shared.impl.clear(providerId),
  persistence: (providerId) => shared.impl.persistence(providerId),
  configuredValues: () => shared.impl.configuredValues(),
};

/** Test hook: reset the singleton's in-memory session and migration state. */
export function resetCredentialStoreForTests(): void {
  shared.impl = createCredentialStore();
}
