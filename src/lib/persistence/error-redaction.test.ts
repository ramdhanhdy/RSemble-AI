// =============================================================================
// RSemble AI — Error redaction tests (spec §18)
//
// Persisted errors carry only an allowlisted shape; the human message is
// redacted against exact configured credential values (>= 6 chars) and
// authorization fragments, then capped at 4 KiB UTF-8 without splitting a
// surrogate pair.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCredentialStoreForTests } from "../credentials/credential-store";
import { providerErrorDetail } from "../providers/error-message";
import { ProviderError } from "../providers/types";
import {
  capUtf8,
  configuredCredentialValues,
  ERROR_TEXT_CAP_BYTES,
  REDACTED,
  redactErrorText,
  sanitizePersistedError,
} from "./error-redaction";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCredentialStoreForTests();
});

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

// --- capUtf8 ------------------------------------------------------------------

describe("capUtf8", () => {
  it("returns short ASCII text unchanged", () => {
    expect(capUtf8("hello", 100)).toBe("hello");
  });

  it("caps ASCII text at the byte limit", () => {
    expect(capUtf8("abcdef", 3)).toBe("abc");
  });

  it("never splits a multi-byte character at the boundary", () => {
    // "€" is 3 UTF-8 bytes.
    expect(capUtf8("€€€", 4)).toBe("€");
    expect(capUtf8("€€€", 6)).toBe("€€");
  });

  it("never splits a surrogate pair at the boundary", () => {
    // "😀" is 4 UTF-8 bytes, 2 UTF-16 code units.
    expect(capUtf8("ab😀cd", 3)).toBe("ab");
    expect(capUtf8("ab😀cd", 6)).toBe("ab😀");
    const capped = capUtf8("x".repeat(4095) + "😀", 4096);
    expect(capped.length).toBe(4095);
    const last = capped.charCodeAt(capped.length - 1);
    expect(last < 0xd800 || last > 0xdfff).toBe(true);
  });

  it("caps a long string at the byte limit exactly", () => {
    const capped = capUtf8("y".repeat(10_000), ERROR_TEXT_CAP_BYTES);
    expect(utf8Length(capped)).toBeLessThanOrEqual(ERROR_TEXT_CAP_BYTES);
    expect(capped.length).toBe(ERROR_TEXT_CAP_BYTES);
  });
});

// --- redactErrorText ----------------------------------------------------------

describe("redactErrorText — exact credential values", () => {
  it("replaces an exact configured credential value", () => {
    const out = redactErrorText("401 unauthorized for key sk-live-123456", ["sk-live-123456"]);
    expect(out).toBe(`401 unauthorized for key ${REDACTED}`);
  });

  it("replaces every occurrence of multiple configured values", () => {
    const out = redactErrorText(
      "or-key-abcdef failed; umans-key-xyz789 failed; or-key-abcdef again",
      ["or-key-abcdef", "umans-key-xyz789"],
    );
    expect(out).not.toContain("or-key-abcdef");
    expect(out).not.toContain("umans-key-xyz789");
    expect(out).toBe(`${REDACTED} failed; ${REDACTED} failed; ${REDACTED} again`);
  });

  it("does NOT redact values shorter than 6 characters", () => {
    const out = redactErrorText("the abc12 code was rejected", ["abc12"]);
    expect(out).toBe("the abc12 code was rejected");
  });

  it("leaves ordinary prose containing the words token/secret unchanged", () => {
    const prose =
      "The token bucket algorithm is a secret sauce; this prompt mentions password policy.";
    expect(redactErrorText(prose, [])).toBe(prose);
    expect(redactErrorText(prose, ["not-present-key"])).toBe(prose);
  });
});

describe("redactErrorText — authorization fragments", () => {
  it("redacts Bearer fragments while keeping surrounding words", () => {
    expect(redactErrorText("Request failed: Bearer abc123xyz expired", [])).toBe(
      `Request failed: ${REDACTED} expired`,
    );
  });

  it("redacts Bearer case-insensitively", () => {
    expect(redactErrorText("BEARER zzz999", [])).toBe(REDACTED);
  });

  it("redacts Basic fragments", () => {
    expect(redactErrorText("used Basic dXNlcjpwYXNz here", [])).toBe(`used ${REDACTED} here`);
  });

  it("redacts Authorization header values with colon or equals", () => {
    expect(redactErrorText("header Authorization: sk-abc123 was sent", [])).toBe(
      `header ${REDACTED} was sent`,
    );
    expect(redactErrorText("authorization=sk-abc123, retry", [])).toBe(`${REDACTED}, retry`);
  });

  it("redacts both credential values and fragments in one message", () => {
    const out = redactErrorText("Bearer umans-secret-123 rejected", ["umans-secret-123"]);
    expect(out).toBe(`${REDACTED} rejected`);
    expect(out).not.toContain("umans-secret-123");
  });
});

describe("redactErrorText — byte cap", () => {
  it("caps redacted output at ERROR_TEXT_CAP_BYTES", () => {
    const out = redactErrorText("q".repeat(9000), []);
    expect(utf8Length(out)).toBeLessThanOrEqual(ERROR_TEXT_CAP_BYTES);
  });
});

// --- configuredCredentialValues ------------------------------------------------

describe("configuredCredentialValues — store-backed", () => {
  beforeEach(() => {
    // Neutral environment: the developer's .env must never enter assertions.
    for (const key of [
      "VITE_OPENROUTER_KEY",
      "VITE_GEMINI_KEY",
      "VITE_DEEPSEEK_KEY",
      "VITE_COMMANDCODE_KEY",
      "VITE_CLINEPASS_KEY",
      "VITE_UMANS_KEY",
      "VITE_9ROUTER_KEY",
    ]) {
      vi.stubEnv(key, "");
    }
  });

  it("collects, filters, and dedupes values from the shared store", () => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === "rsemble.key.openrouter.v2" ? "or-key-abcdef" : null),
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_GEMINI_KEY", "env-only-key-1");
    resetCredentialStoreForTests();
    const values = configuredCredentialValues();
    expect(values).toContain("or-key-abcdef");
    expect(values).toContain("env-only-key-1");
    expect(values).not.toContain("short"); // < 6 chars filtered
    expect(values.filter((v) => v === "or-key-abcdef")).toHaveLength(1); // deduped
  });

  it("ignores undefined reads and reports empty when nothing is configured", () => {
    resetCredentialStoreForTests();
    vi.stubEnv("VITE_OPENROUTER_KEY", "");
    expect(configuredCredentialValues(() => undefined)).toEqual([]);
  });

  it("keeps legacy environment aliases in scope via the injected reader", () => {
    const values = configuredCredentialValues(
      (key) => (key === "VITE_UMANS_API_KEY" ? "legacy-env-key-123" : undefined),
    );
    expect(values).toEqual(["legacy-env-key-123"]);
  });
});

// --- sanitizePersistedError ----------------------------------------------------

describe("sanitizePersistedError", () => {
  it("builds the allowlisted shape with redaction applied", () => {
    const out = sanitizePersistedError(
      new Error("401 unauthorized: Bearer umans-secret-123"),
      { category: "provider", stage: "candidate", model: "model-b" },
      () => 4242,
      ["umans-secret-123"],
    );
    expect(out.message).toContain(REDACTED);
    expect(out.message).not.toContain("umans-secret-123");
    expect(out.category).toBe("provider");
    expect(out.stage).toBe("candidate");
    expect(out.model).toBe("model-b");
    expect(out.at).toBe(4242);
  });

  it("omits the model field when the context has none", () => {
    const out = sanitizePersistedError(
      "plain failure",
      { category: "validation", stage: "fusion" },
      () => 7,
      [],
    );
    expect(out).toEqual({
      message: "plain failure",
      category: "validation",
      stage: "fusion",
      at: 7,
    });
  });

  it("caps very long messages at the byte limit", () => {
    const out = sanitizePersistedError(
      new Error("z".repeat(9000)),
      { category: "provider", stage: "judge" },
      () => 1,
      [],
    );
    expect(utf8Length(out.message)).toBeLessThanOrEqual(ERROR_TEXT_CAP_BYTES);
  });
});

describe("redactErrorText — adversarial bodies (Plan 003 D)", () => {
  it("redacts bearer tokens inside an oversized HTML error body and caps it", () => {
    const html = `<html><body>Bearer sk-live-abcdefghijklm ${"x".repeat(9000)}</body></html>`;
    const out = redactErrorText(html, ["sk-live-abcdefghijklm"]);
    expect(out).not.toContain("sk-live-abcdefghijklm");
    expect(out).not.toMatch(/Bearer\s+[^\s,;]+/i);
    expect(utf8Length(out)).toBeLessThanOrEqual(ERROR_TEXT_CAP_BYTES);
  });

  it("redacts configured keys that appear inside prompt fragments", () => {
    const promptFragment = "system: use key sk-prompt-embedded-123 to call the API";
    const out = redactErrorText(promptFragment, ["sk-prompt-embedded-123"]);
    expect(out).not.toContain("sk-prompt-embedded-123");
  });

  it("handles multi-line error bodies without leaking credentials", () => {
    const body = "line one\nAuthorization: Bearer multi-line-key-456\nline three";
    const out = redactErrorText(body, ["multi-line-key-456"]);
    expect(out).not.toContain("multi-line-key-456");
    expect(out).not.toMatch(/Authorization\s*[:=]\s*[^\s,;]+/i);
  });
});

// ---------------------------------------------------------------------------
// Bridge-secret redaction — final review fix
// ---------------------------------------------------------------------------

describe("bridge-secret redaction (final review fix)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RSEMBLE_BRIDGE_SECRET", "test-bridge-secret-123456");
    for (const key of [
      "VITE_OPENROUTER_KEY",
      "VITE_GEMINI_KEY",
      "VITE_DEEPSEEK_KEY",
      "VITE_COMMANDCODE_KEY",
      "VITE_CLINEPASS_KEY",
      "VITE_UMANS_KEY",
      "VITE_9ROUTER_KEY",
    ]) {
      vi.stubEnv(key, "");
    }
    resetCredentialStoreForTests();
  });

  it("collects VITE_RSEMBLE_BRIDGE_SECRET into the sensitive value set", () => {
    expect(configuredCredentialValues()).toContain("test-bridge-secret-123456");
  });

  it("redacts the bare exact secret value from arbitrary text", () => {
    const out = redactErrorText(
      "401 rejected: test-bridge-secret-123456 is invalid",
      configuredCredentialValues(),
    );
    expect(out).not.toContain("test-bridge-secret-123456");
  });

  it("redacts the X-RSemble-Bridge-Secret header form from arbitrary text", () => {
    const out = redactErrorText(
      "bridge rejected X-RSemble-Bridge-Secret: test-bridge-secret-123456",
      configuredCredentialValues(),
    );
    expect(out).not.toContain("test-bridge-secret-123456");
  });

  it("keeps the bridge secret out of a recognized structured provider error message", () => {
    const detail = providerErrorDetail(
      JSON.stringify({ error: { message: "401 X-RSemble-Bridge-Secret: test-bridge-secret-123456 invalid" } }),
      "Umans",
      401,
    );
    expect(detail).not.toContain("test-bridge-secret-123456");
    expect(detail).toContain("401");
  });

  it("keeps the bridge secret out of a ProviderError passed through persistence sanitization", () => {
    const err = new ProviderError(
      "401 X-RSemble-Bridge-Secret: test-bridge-secret-123456 rejected",
      "umans",
      401,
    );
    const out = sanitizePersistedError(
      err,
      { category: "provider", stage: "candidate", model: "m" },
      () => 1,
    );
    expect(out.message).not.toContain("test-bridge-secret-123456");
    expect(out.message).not.toMatch(/X-RSemble-Bridge-Secret\s*[:=]\s*[^\s,;]+/i);
  });
});
