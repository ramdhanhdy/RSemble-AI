// =============================================================================
// CredentialStore implementation — Plan 003 workstream A
//
// Default singleton plus an injectable factory so tests can exercise
// environment / session / remembered precedence, migration, and
// unavailable-storage behavior deterministically without a real browser.
//
// Review fix 1: production environment resolution uses explicit static
// `import.meta.env.VITE_*` references (never dynamic property access), so Vite
// can statically replace values at build time. The injectable environment
// reader seam remains for unit tests.
//
// Review fix 2: legacy migration is lossless — the legacy key is removed only
// after a verified v2 write (or when a valid v2 already exists). Failed or
// incomplete migration retains the legacy key, keeps resolving it as the
// active remembered credential, and retries on later calls.
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

/**
 * Static environment lookup shared with credential redaction. Uses an explicit
 * switch over `import.meta.env.VITE_*` member accesses — never dynamic
 * `import.meta.env[key]` property access — so Vite statically replaces each
 * reference at build time and tests can still stub values via `vi.stubEnv`.
 */
export function readStaticEnvValue(key: string): string | undefined {
  switch (key) {
    case "VITE_OPENROUTER_KEY":
      return import.meta.env.VITE_OPENROUTER_KEY;
    case "VITE_GEMINI_KEY":
      return import.meta.env.VITE_GEMINI_KEY;
    case "VITE_DEEPSEEK_KEY":
      return import.meta.env.VITE_DEEPSEEK_KEY;
    case "VITE_COMMANDCODE_KEY":
      return import.meta.env.VITE_COMMANDCODE_KEY;
    case "VITE_CLINEPASS_KEY":
      return import.meta.env.VITE_CLINEPASS_KEY;
    case "VITE_UMANS_KEY":
      return import.meta.env.VITE_UMANS_KEY;
    case "VITE_9ROUTER_KEY":
      return import.meta.env.VITE_9ROUTER_KEY;
    case "VITE_UMANS_API_KEY":
      return import.meta.env.VITE_UMANS_API_KEY;
    case "VITE_RSEMBLE_BRIDGE_SECRET":
      // Sensitive configuration for redaction only — deliberately NOT part of
      // the provider-keyed ENV_KEYS map, so it is never resolved as a provider
      // credential, never exposed through Connections, and never stored in
      // session/remembered browser storage.
      return import.meta.env.VITE_RSEMBLE_BRIDGE_SECRET;
    default:
      return undefined;
  }
}

export const REMEMBERED_KEY_VERSION = REMEMBERED_KEY_SUFFIX;

export interface CredentialStoreDeps {
  readEnv(key: string): string | undefined;
  readStorage(key: string): string | null;
  writeStorage(key: string, value: string): void;
  removeStorage(key: string): void;
}

const defaultDeps: CredentialStoreDeps = {
  readEnv: readStaticEnvValue,
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
  /** Providers whose legacy handling is settled (migrated or confirmed absent). */
  const settled = new Set<ProviderId>();

  /**
   * Lossless migration for one provider. The legacy key is removed only after
   * a verified v2 value exists (either written and read back just now, or
   * already present). Any failure keeps the provider unsettled so a later
   * call/session retries; resolution keeps falling back to the legacy value.
   * Values are never logged.
   */
  function migrateProvider(providerId: ProviderId): void {
    if (settled.has(providerId)) return;
    let legacy = "";
    try {
      legacy = trim(deps.readStorage(legacyStorageKey(providerId)));
    } catch {
      return; // cannot inspect storage — retry later
    }
    if (legacy.length === 0) {
      settled.add(providerId);
      return;
    }
    let v2 = "";
    try {
      v2 = trim(deps.readStorage(rememberedStorageKey(providerId)));
    } catch {
      return; // cannot inspect storage — retry later
    }
    if (v2.length > 0) {
      // A valid v2 value already exists; the legacy key is obsolete. Removal is
      // best-effort — resolution already prefers v2.
      try {
        deps.removeStorage(legacyStorageKey(providerId));
      } catch {
        // Stale legacy key remains; harmless and never resolved over v2.
      }
      settled.add(providerId);
      return;
    }
    // Attempt to persist and verify the copy before touching the legacy key.
    try {
      deps.writeStorage(rememberedStorageKey(providerId), legacy);
    } catch {
      return; // write failed — legacy retained, retry later
    }
    let written = "";
    try {
      written = trim(deps.readStorage(rememberedStorageKey(providerId)));
    } catch {
      return; // cannot verify — legacy retained, retry later
    }
    if (written !== legacy) {
      return; // no-op or wrong write — legacy retained, retry later
    }
    try {
      deps.removeStorage(legacyStorageKey(providerId));
    } catch {
      // Removal failed but the v2 copy is verified — resolution uses v2.
    }
    settled.add(providerId);
  }

  function migrateLegacy(): void {
    for (const id of Object.keys(ENV_KEYS) as ProviderId[]) migrateProvider(id);
  }

  function envValue(providerId: ProviderId): string {
    const key = ENV_KEYS[providerId];
    return key ? trim(deps.readEnv(key)) : "";
  }

  function rememberedValue(providerId: ProviderId): string {
    // v2 wins; fall back to the legacy key while migration is incomplete so a
    // failed migration never loses the user's remembered credential.
    try {
      const v2 = trim(deps.readStorage(rememberedStorageKey(providerId)));
      if (v2.length > 0) return v2;
      return trim(deps.readStorage(legacyStorageKey(providerId)));
    } catch {
      return "";
    }
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
      try {
        deps.removeStorage(legacyStorageKey(providerId));
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
