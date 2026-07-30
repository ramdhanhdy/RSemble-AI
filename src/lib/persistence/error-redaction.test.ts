// =============================================================================
// RSemble AI — Error redaction tests (spec §18)
//
// Persisted errors carry only an allowlisted shape; the human message is
// redacted against exact configured credential values (>= 6 chars) and
// authorization fragments, then capped at 4 KiB UTF-8 without splitting a
// surrogate pair.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  capUtf8,
  configuredCredentialValues,
  ERROR_TEXT_CAP_BYTES,
  REDACTED,
  redactErrorText,
  sanitizePersistedError,
} from "./error-redaction";

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

describe("configuredCredentialValues", () => {
  it("collects, filters, and dedupes values from injected readers", () => {
    const storage = new Map<string, string>([
      ["rsemble.key.openrouter", "or-key-abcdef"],
      ["rsemble.key.gemini", "gem-999"],
      ["rsemble.key.umans", "short"],
    ]);
    const env: Record<string, string> = {
      VITE_UMANS_KEY: "or-key-abcdef", // duplicate of a storage value
      VITE_GEMINI_KEY: "env-only-key-1",
    };
    const values = configuredCredentialValues(
      (key) => storage.get(key) ?? null,
      (key) => env[key],
    );
    expect(values).toContain("or-key-abcdef");
    expect(values).toContain("gem-999");
    expect(values).toContain("env-only-key-1");
    expect(values).not.toContain("short"); // < 6 chars filtered
    expect(values.filter((v) => v === "or-key-abcdef")).toHaveLength(1); // deduped
    expect(values).toHaveLength(3);
  });

  it("ignores null and undefined reads", () => {
    expect(configuredCredentialValues(() => null, () => undefined)).toEqual([]);
  });

  it("survives a throwing storage reader", () => {
    const values = configuredCredentialValues(
      () => {
        throw new Error("denied");
      },
      (key) => (key === "VITE_UMANS_KEY" ? "env-key-123" : undefined),
    );
    expect(values).toEqual(["env-key-123"]);
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
