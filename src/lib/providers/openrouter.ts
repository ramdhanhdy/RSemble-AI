// =============================================================================
// OpenRouter Provider Adapter
// =============================================================================

import {
  type CatalogModel,
  type ChatOptions,
  type LLMProvider,
  type ProviderReadiness,
  ProviderError,
} from "./types";
import { readSseChatStream } from "./sse-stream";

const BASE_URL = "https://openrouter.ai/api/v1";

function getApiKey(): string {
  const envKey = ((import.meta.env.VITE_OPENROUTER_KEY as string | undefined) ?? "").trim();
  if (envKey) return envKey;
  try {
    return (localStorage.getItem("rsemble.key.openrouter") ?? "").trim();
  } catch {
    return "";
  }
}

export const openrouterProvider: LLMProvider = {
  id: "openrouter",
  label: "OpenRouter",

  async testConnection(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness> {
    const candidateKey = apiKey.trim();
    if (!candidateKey) return { ok: false, reason: "Enter an OpenRouter API key first." };
    try {
      const res = await fetch(`${BASE_URL}/key`, {
        headers: { Authorization: ["Bearer", candidateKey].join(" ") },
        signal,
      });
      if (res.ok) return { ok: true };
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      return { ok: false, reason: body?.error?.message ?? `OpenRouter returned HTTP ${res.status}.` };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return { ok: false, reason: "Network error reaching OpenRouter." };
    }
  },

  readiness(): ProviderReadiness {
    const key = getApiKey();
    if (key.length > 0) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root.",
    };
  },

  async chatCompletion(opts: ChatOptions): Promise<string> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
        "openrouter"
      );
    }

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "RSemble AI",
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
        }),
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ProviderError("Network error reaching OpenRouter. Check your connection.", "openrouter");
    }

    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error?.message ?? JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new ProviderError(
        detail || `OpenRouter request failed (HTTP ${res.status}).`,
        "openrouter",
        res.status
      );
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new ProviderError("OpenRouter returned an empty response.", "openrouter");
    }
    return content;
  },

  async *chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
        "openrouter"
      );
    }

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "RSemble AI",
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: true,
        }),
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ProviderError("Network error reaching OpenRouter. Check your connection.", "openrouter");
    }

    if (!res.ok || !res.body) {
      let detail = "";
      try {
        const body = await res.json();
        detail = body?.error?.message ?? JSON.stringify(body);
      } catch {
        detail = await res.text().catch(() => "");
      }
      throw new ProviderError(
        detail || `OpenRouter request failed (HTTP ${res.status}).`,
        "openrouter",
        res.status
      );
    }

    yield* readSseChatStream(res.body, "openrouter", "OpenRouter", opts.signal);
  },

  async listModels(signal?: AbortSignal): Promise<CatalogModel[]> {
    const key = getApiKey();
    const res = await fetch(`${BASE_URL}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `Could not load model catalog (HTTP ${res.status}).`,
        "openrouter",
        res.status
      );
    }
    const data = await res.json();
    const arr: unknown[] = Array.isArray(data?.data) ? data.data : [];
    return arr
      .map((m) => {
        const model = m as { id?: string; name?: string };
        return {
          id: model.id ?? "",
          name: model.name ?? model.id ?? "",
          providerId: "openrouter" as const,
        };
      })
      .filter((m) => m.id.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  },
};
