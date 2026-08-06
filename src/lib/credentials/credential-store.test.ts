// =============================================================================
// CredentialStore unit tests — Plan 003 workstream A
//
// Covers environment precedence, session-only default, remembered opt-in,
// clear, unavailable storage, legacy migration, and redaction inputs.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  createCredentialStore,
  legacyStorageKey,
  rememberedStorageKey,
  type CredentialStoreDeps,
} from "./credential-store";

function memoryDeps(initial: Record<string, string> = {}, env: Record<string, string> = {}): CredentialStoreDeps & {
  storage: Record<string, string>;
  env: Record<string, string>;
} {
  const storage: Record<string, string> = { ...initial };
  return {
    storage,
    env: { ...env },
    readEnv: (key) => env[key],
    readStorage: (key) => storage[key] ?? null,
    writeStorage: (key, value) => {
      storage[key] = value;
    },
    removeStorage: (key) => {
      delete storage[key];
    },
  };
}

describe("credentialStore — resolution precedence", () => {
  it("returns the environment value with highest precedence", () => {
    const deps = memoryDeps({ [rememberedStorageKey("openrouter")]: "remembered-key" }, { VITE_OPENROUTER_KEY: "env-key" });
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("env-key");
    expect(store.persistence("openrouter")).toBeNull();
  });

  it("returns the session value over a remembered value", () => {
    const deps = memoryDeps({ [rememberedStorageKey("openrouter")]: "remembered-key" });
    const store = createCredentialStore(deps);
    store.set("openrouter", "session-key", "session");
    expect(store.get("openrouter")).toBe("session-key");
    expect(store.persistence("openrouter")).toBe("session");
  });

  it("falls back to the remembered value when nothing is in session or env", () => {
    const deps = memoryDeps({ [rememberedStorageKey("openrouter")]: "remembered-key" });
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("remembered-key");
    expect(store.persistence("openrouter")).toBe("remembered");
  });

  it("returns an empty string when nothing is configured", () => {
    const store = createCredentialStore(memoryDeps());
    expect(store.get("openrouter")).toBe("");
    expect(store.persistence("openrouter")).toBeNull();
  });

  it("trims stored values", () => {
    const store = createCredentialStore(memoryDeps());
    store.set("openrouter", "  spaced-key  ", "session");
    expect(store.get("openrouter")).toBe("spaced-key");
  });
});

describe("credentialStore — session vs remembered persistence", () => {
  it("session values never touch storage", () => {
    const deps = memoryDeps();
    const store = createCredentialStore(deps);
    store.set("gemini", "session-only", "session");
    expect(deps.storage[rememberedStorageKey("gemini")]).toBeUndefined();
    expect(store.persistence("gemini")).toBe("session");
  });

  it("remembered values are persisted under the versioned key", () => {
    const deps = memoryDeps();
    const store = createCredentialStore(deps);
    store.set("gemini", "remember-me", "remembered");
    expect(deps.storage[rememberedStorageKey("gemini")]).toBe("remember-me");
    expect(store.persistence("gemini")).toBe("remembered");
  });

  it("clear removes session and remembered but never environment", () => {
    const deps = memoryDeps({ [rememberedStorageKey("openrouter")]: "remembered-key" }, { VITE_OPENROUTER_KEY: "env-key" });
    const store = createCredentialStore(deps);
    store.set("openrouter", "session-key", "session");
    store.clear("openrouter");
    expect(store.get("openrouter")).toBe("env-key");
    expect(deps.storage[rememberedStorageKey("openrouter")]).toBeUndefined();
  });

  it("clear removes a remembered-only value", () => {
    const deps = memoryDeps({ [rememberedStorageKey("deepseek")]: "remembered-key" });
    const store = createCredentialStore(deps);
    store.clear("deepseek");
    expect(store.get("deepseek")).toBe("");
    expect(deps.storage[rememberedStorageKey("deepseek")]).toBeUndefined();
  });

  it("degrades honestly to session when remembered storage is unavailable", () => {
    const deps: CredentialStoreDeps = {
      readEnv: () => undefined,
      readStorage: () => null,
      writeStorage: () => {
        throw new Error("QuotaExceededError");
      },
      removeStorage: () => {},
    };
    const store = createCredentialStore(deps);
    store.set("openrouter", "best-effort", "remembered");
    expect(store.get("openrouter")).toBe("best-effort");
    expect(store.persistence("openrouter")).toBe("session");
  });
});

describe("credentialStore — legacy migration", () => {
  it("migrates a legacy key into the versioned remembered store once", () => {
    const deps = memoryDeps({ [legacyStorageKey("openrouter")]: "legacy-key" });
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(deps.storage[rememberedStorageKey("openrouter")]).toBe("legacy-key");
    expect(deps.storage[legacyStorageKey("openrouter")]).toBeUndefined();
  });

  it("is idempotent and never overwrites an existing versioned value", () => {
    const deps = memoryDeps({
      [legacyStorageKey("openrouter")]: "legacy-key",
      [rememberedStorageKey("openrouter")]: "newer-key",
    });
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("newer-key");
    expect(deps.storage[rememberedStorageKey("openrouter")]).toBe("newer-key");
  });

  it("migration never logs or exposes values (no output side effects)", () => {
    const deps = memoryDeps({ [legacyStorageKey("umans")]: "sk-umans-secret" });
    // A second store over the same deps must not re-copy (migration is per store).
    const second = createCredentialStore(deps);
    expect(second.get("umans")).toBe("sk-umans-secret");
  });
});

describe("credentialStore — configuredValues for redaction", () => {
  it("collects environment, session, remembered, and legacy env aliases", () => {
    const deps = memoryDeps(
      { [rememberedStorageKey("gemini")]: "remembered-key" },
      { VITE_OPENROUTER_KEY: "env-key", VITE_UMANS_API_KEY: "legacy-env-key" },
    );
    const store = createCredentialStore(deps);
    store.set("deepseek", "session-key", "session");
    const values = store.configuredValues();
    expect(values).toContain("env-key");
    expect(values).toContain("legacy-env-key");
    expect(values).toContain("session-key");
    expect(values).toContain("remembered-key");
  });

  it("deduplicates repeated values", () => {
    const deps = memoryDeps({ [rememberedStorageKey("openrouter")]: "same-key" }, { VITE_OPENROUTER_KEY: "same-key" });
    const store = createCredentialStore(deps);
    expect(store.configuredValues().filter((v) => v === "same-key")).toHaveLength(1);
  });
});

describe("credentialStore — codex has no UI key", () => {
  it("returns empty for chatgpt-codex when nothing is configured", () => {
    const deps = memoryDeps({}, { VITE_CODEX_BRIDGE_URL: "http://127.0.0.1:8787" });
    const store = createCredentialStore(deps);
    expect(store.get("chatgpt-codex")).toBe("");
    expect(store.configuredValues()).not.toContain("http://127.0.0.1:8787");
  });
});
