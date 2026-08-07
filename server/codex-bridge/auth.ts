// =============================================================================
// Codex Bridge — Authentication module
//
// Reads credentials from %USERPROFILE%\.codex\auth.json or ~/.codex/auth.json
// or $CODEX_HOME/auth.json. Never logs tokens or exposes raw secrets.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface AuthStatus {
  ok: boolean;
  authMode?: string;
  accountLabel?: string;
  plan?: string;
  lastRefresh?: string;
  error?: string;
}

export interface CodexAuthData {
  OPENAI_API_KEY?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
    expires_at?: number;
  };
  last_refresh?: string;
}

export function getAuthFilePath(): string {
  if (process.env.CODEX_HOME) {
    return path.join(process.env.CODEX_HOME, "auth.json");
  }
  const home = os.homedir();
  return path.join(home, ".codex", "auth.json");
}

export function readAuthFile(): { data: CodexAuthData | null; error?: string } {
  const filePath = getAuthFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      data: null,
      error: `Auth file missing at ${filePath}. Run 'codex login' to authenticate.`,
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as CodexAuthData;
    return { data };
  } catch (err) {
    return {
      data: null,
      error: `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function getAuthStatus(): AuthStatus {
  const { data, error } = readAuthFile();
  if (!data) {
    return { ok: false, error: error || "Not logged in" };
  }

  const hasApiKey = Boolean(data.OPENAI_API_KEY && data.OPENAI_API_KEY.trim().length > 0);
  const hasAccessToken = Boolean(
    data.tokens?.access_token && data.tokens.access_token.trim().length > 0,
  );

  if (!hasApiKey && !hasAccessToken) {
    return {
      ok: false,
      error: "No valid tokens or API keys found in auth.json. Run 'codex login'.",
    };
  }

  return {
    ok: true,
    authMode: hasAccessToken ? "chatgpt-codex" : "api-key",
    accountLabel: data.tokens?.account_id
      ? `Account ${data.tokens.account_id.slice(0, 8)}...`
      : "ChatGPT Subscription",
    plan: "ChatGPT Plan",
    lastRefresh: data.last_refresh || undefined,
  };
}

export async function refreshTokens(): Promise<boolean> {
  const { data } = readAuthFile();
  if (!data?.tokens?.refresh_token) return false;

  const refreshToken = data.tokens.refresh_token;
  // Codex OAuth client_id
  const clientId = "app_EMoZ7jN3k6L7sD2m";

  try {
    const res = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) return false;

    const newTokens = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };

    if (!newTokens.access_token) return false;

    const filePath = getAuthFilePath();
    const updatedData: CodexAuthData = {
      ...data,
      tokens: {
        ...data.tokens,
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token || refreshToken,
        id_token: newTokens.id_token || data.tokens.id_token,
        expires_at: Math.floor(Date.now() / 1000) + (newTokens.expires_in || 3600),
      },
      last_refresh: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** Get the valid bearer token (access_token or API key) for upstream requests. */
export async function getValidToken(): Promise<{ token: string; accountId?: string }> {
  const { data, error } = readAuthFile();
  if (!data) {
    throw new Error(error || "Not authenticated");
  }

  const tokens = data.tokens;
  if (tokens && typeof tokens.access_token === "string" && tokens.access_token.length > 0) {
    const accessToken: string = tokens.access_token;
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expires_at && now >= tokens.expires_at - 60) {
      const refreshed = await refreshTokens();
      if (refreshed) {
        const fresh = readAuthFile().data;
        if (fresh?.tokens?.access_token) {
          return {
            token: fresh.tokens.access_token,
            accountId: fresh.tokens.account_id,
          };
        }
      }
    }
    return {
      token: accessToken,
      accountId: tokens.account_id,
    };
  }

  if (data.OPENAI_API_KEY) {
    return { token: data.OPENAI_API_KEY };
  }

  throw new Error("No token available in auth.json");
}
