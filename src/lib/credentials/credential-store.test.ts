// =============================================================================
// CredentialStore unit tests — Plan 003 workstream A
//
// Covers environment precedence, session-only default, remembered opt-in,
// clear, unavailable storage, legacy migration, and redaction inputs.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createCredentialStore,
  legacyStorageKey,
  readStaticEnvValue,
  rememberedStorageKey,
  type CredentialStoreDeps,
} from "./credential-store";

function memoryDeps(
  initial: Record<string, string> = {},
  env: Record<string, string> = {},
): CredentialStoreDeps & {
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
    const deps = memoryDeps(
      { [rememberedStorageKey("openrouter")]: "remembered-key" },
      { VITE_OPENROUTER_KEY: "env-key" },
    );
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
    const deps = memoryDeps(
      { [rememberedStorageKey("openrouter")]: "remembered-key" },
      { VITE_OPENROUTER_KEY: "env-key" },
    );
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
    const deps = memoryDeps(
      { [rememberedStorageKey("openrouter")]: "same-key" },
      { VITE_OPENROUTER_KEY: "same-key" },
    );
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

// ---------------------------------------------------------------------------
// Lossless legacy migration — review fix 2
// ---------------------------------------------------------------------------

describe("credentialStore — lossless migration under storage failures (review fix 2)", () => {
  it("retains the legacy key and keeps resolving it when the v2 write throws", () => {
    let removeCalled = false;
    const deps: CredentialStoreDeps = {
      readEnv: () => undefined,
      readStorage: (key) => (key === legacyStorageKey("openrouter") ? "legacy-key" : null),
      writeStorage: () => {
        throw new Error("QuotaExceededError");
      },
      removeStorage: () => {
        removeCalled = true;
      },
    };
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(store.persistence("openrouter")).toBe("remembered");
    expect(removeCalled).toBe(false); // never removed without a verified v2
  });

  it("retains the legacy key when the v2 write is a silent no-op", () => {
    let removeCalled = false;
    const deps: CredentialStoreDeps = {
      readEnv: () => undefined,
      readStorage: (key) => (key === legacyStorageKey("openrouter") ? "legacy-key" : null),
      writeStorage: () => {
        // No-op: never actually persists.
      },
      removeStorage: () => {
        removeCalled = true;
      },
    };
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(removeCalled).toBe(false);
    // A later call retries migration; still no loss.
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(removeCalled).toBe(false);
  });

  it("does not lose the legacy value when the v2 read-back cannot verify", () => {
    let reads = 0;
    const deps: CredentialStoreDeps = {
      readEnv: () => undefined,
      readStorage: (key) => {
        if (key === legacyStorageKey("openrouter")) return "legacy-key";
        reads += 1;
        if (reads === 1) throw new Error("storage read failed");
        return null; // v2 write appeared to succeed but cannot be confirmed
      },
      writeStorage: () => {},
      removeStorage: () => {},
    };
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("legacy-key");
  });

  it("retries migration on a later call after a transient write failure", () => {
    let writeAttempts = 0;
    const storage: Record<string, string> = {
      [legacyStorageKey("openrouter")]: "legacy-key",
    };
    const deps: CredentialStoreDeps = {
      readEnv: () => undefined,
      readStorage: (key) => storage[key] ?? null,
      writeStorage: (key, value) => {
        writeAttempts += 1;
        if (writeAttempts === 1) throw new Error("transient");
        storage[key] = value;
      },
      removeStorage: (key) => {
        delete storage[key];
      },
    };
    const store = createCredentialStore(deps);
    // First call: write fails; legacy still resolves.
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(storage[legacyStorageKey("openrouter")]).toBe("legacy-key");
    // Second call: migration retries and completes.
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(storage[rememberedStorageKey("openrouter")]).toBe("legacy-key");
    expect(storage[legacyStorageKey("openrouter")]).toBeUndefined();
  });

  it("keeps resolving via a verified v2 after a failed legacy removal", () => {
    const storage: Record<string, string> = {
      [legacyStorageKey("openrouter")]: "legacy-key",
    };
    const deps: CredentialStoreDeps = {
      readEnv: () => undefined,
      readStorage: (key) => storage[key] ?? null,
      writeStorage: (key, value) => {
        storage[key] = value;
      },
      removeStorage: (key) => {
        if (key === legacyStorageKey("openrouter")) throw new Error("remove denied");
        delete storage[key];
      },
    };
    const store = createCredentialStore(deps);
    expect(store.get("openrouter")).toBe("legacy-key");
    expect(storage[rememberedStorageKey("openrouter")]).toBe("legacy-key");
    // v2 is verified, so resolution prefers it even though legacy removal failed.
    expect(storage[legacyStorageKey("openrouter")]).toBe("legacy-key");
  });
});

// ---------------------------------------------------------------------------
// Static environment resolution — review fix 1
// ---------------------------------------------------------------------------

describe("credentialStore — static environment resolution (review fix 1)", () => {
  /** Strip comments so prose mentioning the pattern cannot false-positive. */
  function codeOnly(source: string): string {
    return source
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith("//") && !t.startsWith("*") && t.length > 0;
      })
      .join("\n");
  }

  it("production credential resolution never uses dynamic import.meta.env property access", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/credentials/credential-store.ts"),
      "utf8",
    );
    const code = codeOnly(source);
    expect(code).not.toMatch(/import\.meta\.env\s*\[/);
    expect(code).not.toMatch(/import\.meta\.env\s+as\s+Record/);
  });

  it("credential redaction never uses dynamic import.meta.env property access", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/persistence/error-redaction.ts"),
      "utf8",
    );
    const code = codeOnly(source);
    expect(code).not.toMatch(/import\.meta\.env\s*\[/);
    expect(code).not.toMatch(/import\.meta\.env\s+as\s+Record/);
  });

  it("readStaticEnvValue resolves each provider key via explicit references", () => {
    vi.stubEnv("VITE_OPENROUTER_KEY", "sk-static-123");
    expect(readStaticEnvValue("VITE_OPENROUTER_KEY")).toBe("sk-static-123");
    expect(readStaticEnvValue("VITE_UMANS_API_KEY")).toBeUndefined();
    expect(readStaticEnvValue("SOME_UNKNOWN_KEY")).toBeUndefined();
  });
});
