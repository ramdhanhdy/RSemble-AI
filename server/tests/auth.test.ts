// =============================================================================
// Codex bridge auth tests — Plan 006 coverage workstream.
//
// Deterministic and credential-free: CODEX_HOME points at a temp directory
// holding SYNTHETIC auth.json fixtures (no real Codex credentials anywhere),
// and the OAuth refresh call is stubbed via global fetch.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getAuthFilePath,
  getAuthStatus,
  getValidToken,
  readAuthFile,
  refreshTokens,
} from "../codex-bridge/auth.js";

let codexHome: string;

function writeAuth(data: unknown): void {
  fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify(data, null, 2), "utf-8");
}

beforeEach(() => {
  codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "rsemble-auth-test-"));
  vi.stubEnv("CODEX_HOME", codexHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(codexHome, { recursive: true, force: true });
});

describe("getAuthFilePath", () => {
  it("resolves auth.json inside CODEX_HOME when set", () => {
    expect(getAuthFilePath()).toBe(path.join(codexHome, "auth.json"));
  });
});

describe("readAuthFile", () => {
  it("reports a missing auth file with actionable guidance", () => {
    const { data, error } = readAuthFile();
    expect(data).toBeNull();
    expect(error).toContain("Auth file missing");
    expect(error).toContain("codex login");
  });

  it("reports malformed JSON without throwing", () => {
    fs.writeFileSync(path.join(codexHome, "auth.json"), "{ not json", "utf-8");
    const { data, error } = readAuthFile();
    expect(data).toBeNull();
    expect(error).toContain("Failed to parse");
  });

  it("returns parsed data for a valid file", () => {
    writeAuth({ OPENAI_API_KEY: "fake-api-key" });
    const { data, error } = readAuthFile();
    expect(error).toBeUndefined();
    expect(data?.OPENAI_API_KEY).toBe("fake-api-key");
  });
});

describe("getAuthStatus", () => {
  it("is not ok when no credential material exists", () => {
    writeAuth({});
    const status = getAuthStatus();
    expect(status.ok).toBe(false);
    expect(status.error).toContain("No valid tokens");
  });

  it("treats blank tokens as logged out", () => {
    writeAuth({ tokens: { access_token: "   " } });
    expect(getAuthStatus().ok).toBe(false);
  });

  it("reports chatgpt-codex mode for an access token and truncates the account id", () => {
    writeAuth({
      tokens: { access_token: "fake-access-token", account_id: "acct-1234567890" },
      last_refresh: "2026-08-06T00:00:00.000Z",
    });
    const status = getAuthStatus();
    expect(status.ok).toBe(true);
    expect(status.authMode).toBe("chatgpt-codex");
    expect(status.accountLabel).toBe("Account acct-123...");
    expect(status.lastRefresh).toBe("2026-08-06T00:00:00.000Z");
  });

  it("reports api-key mode when only OPENAI_API_KEY is present", () => {
    writeAuth({ OPENAI_API_KEY: "fake-api-key" });
    const status = getAuthStatus();
    expect(status.ok).toBe(true);
    expect(status.authMode).toBe("api-key");
    expect(status.accountLabel).toBe("ChatGPT Subscription");
  });

  it("never exposes raw tokens in the status surface", () => {
    writeAuth({ tokens: { access_token: "fake-access-token" } });
    expect(JSON.stringify(getAuthStatus())).not.toContain("fake-access-token");
  });
});

describe("refreshTokens", () => {
  it("returns false when there is no refresh token", async () => {
    writeAuth({ tokens: { access_token: "fake-access-token" } });
    await expect(refreshTokens()).resolves.toBe(false);
  });

  it("returns false when the OAuth endpoint rejects", async () => {
    writeAuth({ tokens: { refresh_token: "fake-refresh-token" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 401 }))),
    );
    await expect(refreshTokens()).resolves.toBe(false);
  });

  it("returns false when the response carries no access token", async () => {
    writeAuth({ tokens: { refresh_token: "fake-refresh-token" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ refresh_token: "rotated" }))),
    );
    await expect(refreshTokens()).resolves.toBe(false);
  });

  it("returns false when the network call fails", async () => {
    writeAuth({ tokens: { refresh_token: "fake-refresh-token" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await expect(refreshTokens()).resolves.toBe(false);
  });

  it("writes refreshed tokens back to the auth file", async () => {
    writeAuth({
      tokens: { refresh_token: "fake-refresh-token", id_token: "fake-id-token" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            access_token: "fake-new-access-token",
            refresh_token: "fake-rotated-refresh-token",
            expires_in: 7200,
          }),
        ),
      ),
    );

    await expect(refreshTokens()).resolves.toBe(true);

    const stored = JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf-8")) as {
      tokens: { access_token: string; refresh_token: string; id_token: string; expires_at: number };
      last_refresh: string;
    };
    expect(stored.tokens.access_token).toBe("fake-new-access-token");
    expect(stored.tokens.refresh_token).toBe("fake-rotated-refresh-token");
    expect(stored.tokens.id_token).toBe("fake-id-token");
    const now = Math.floor(Date.now() / 1000);
    expect(stored.tokens.expires_at).toBeGreaterThan(now);
    expect(stored.tokens.expires_at).toBeLessThanOrEqual(now + 7200 + 5);
    expect(stored.last_refresh).toBeTruthy();
  });
});

describe("getValidToken", () => {
  it("throws when no auth file exists", async () => {
    await expect(getValidToken()).rejects.toThrow(/Auth file missing/);
  });

  it("throws when the file carries no usable credential", async () => {
    writeAuth({});
    await expect(getValidToken()).rejects.toThrow(/No token available/);
  });

  it("returns the API key when that is the only credential", async () => {
    writeAuth({ OPENAI_API_KEY: "fake-api-key" });
    await expect(getValidToken()).resolves.toEqual({ token: "fake-api-key" });
  });

  it("returns a fresh access token without refreshing", async () => {
    writeAuth({
      tokens: {
        access_token: "fake-access-token",
        account_id: "acct-1",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    });
    await expect(getValidToken()).resolves.toEqual({
      token: "fake-access-token",
      accountId: "acct-1",
    });
  });

  it("refreshes an expired token and serves the rotated value", async () => {
    writeAuth({
      tokens: {
        access_token: "fake-expired-token",
        refresh_token: "fake-refresh-token",
        account_id: "acct-1",
        expires_at: Math.floor(Date.now() / 1000) - 10,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({ access_token: "fake-new-access-token", expires_in: 3600 }),
        ),
      ),
    );

    await expect(getValidToken()).resolves.toEqual({
      token: "fake-new-access-token",
      accountId: "acct-1",
    });
  });

  it("falls back to the stale token when the refresh fails", async () => {
    writeAuth({
      tokens: {
        access_token: "fake-expired-token",
        refresh_token: "fake-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) - 10,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    await expect(getValidToken()).resolves.toEqual({
      token: "fake-expired-token",
      accountId: undefined,
    });
  });
});
