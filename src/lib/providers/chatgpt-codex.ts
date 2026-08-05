// =============================================================================
// ChatGPT (Codex) Provider Adapter (web → local bridge)
// =============================================================================

import {
  type CatalogModel,
  type ChatOptions,
  type LLMProvider,
  type ProviderReadiness,
  ProviderError,
} from "./types";
import { readSseChatStream } from "./sse-stream";
import { setProviderCapabilities } from "./capabilities";
import { nativeReasoningPayload } from "./reasoning";

function getBridgeUrl(): string {
  return ((import.meta.env.VITE_CODEX_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:8787").replace(
    /\/$/,
    ""
  );
}

function validateReasoning(opts: ChatOptions): void {
  try {
    nativeReasoningPayload("chatgpt-codex", opts.model, opts.reasoningEffort, opts.reasoningStrict);
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : String(error), "chatgpt-codex");
  }
}

export const chatgptCodexProvider: LLMProvider = {
  id: "chatgpt-codex",
  label: "ChatGPT (Codex)",

  async readiness(signal?: AbortSignal): Promise<ProviderReadiness> {
    const baseUrl = getBridgeUrl();
    try {
      const [authRes, healthRes] = await Promise.all([
        fetch(`${baseUrl}/auth/status`, { signal }),
        fetch(`${baseUrl}/health`, { signal }),
      ]);
      if (!authRes.ok) {
        return {
          ok: false,
          reason: `Codex bridge returned HTTP ${authRes.status}. Check bridge server.`,
        };
      }
      const data = (await authRes.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        // Record bridge attachment capabilities (spec §7, plan 7.4.4): the
        // Codex backend has one capability set for every model it serves, so
        // it is recorded as a provider-wide default. Per-model records, if any
        // ever appear, still take precedence in the capability cache.
        if (healthRes.ok) {
          const health = (await healthRes.json().catch(() => null)) as {
            capabilities?: { image?: boolean; pdf?: boolean };
          } | null;
          if (health?.capabilities) {
            setProviderCapabilities("chatgpt-codex", {
              image: health.capabilities.image === true,
              pdf: health.capabilities.pdf === true,
            });
          }
        }
        return { ok: true };
      }
      return {
        ok: false,
        reason: data.error || "ChatGPT (Codex) not logged in. Run 'codex login'.",
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      return {
        ok: false,
        reason: "Codex bridge unreachable on 127.0.0.1:8787. Start the bridge (npm run dev:bridge).",
      };
    }
  },

  async chatCompletion(opts: ChatOptions): Promise<string> {
    const baseUrl = getBridgeUrl();
    validateReasoning(opts);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      throw new ProviderError(
        "Network error reaching Codex bridge on 127.0.0.1. Ensure bridge is running.",
        "chatgpt-codex"
      );
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
        detail || `ChatGPT (Codex) request failed (HTTP ${res.status}).`,
        "chatgpt-codex",
        res.status
      );
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new ProviderError("ChatGPT (Codex) returned an empty response.", "chatgpt-codex");
    }
    return content;
  },

  async *chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
    const baseUrl = getBridgeUrl();
    validateReasoning(opts);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      throw new ProviderError(
        "Network error reaching Codex bridge on 127.0.0.1. Ensure bridge is running.",
        "chatgpt-codex"
      );
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
        detail || `ChatGPT (Codex) streaming request failed (HTTP ${res.status}).`,
        "chatgpt-codex",
        res.status
      );
    }

    yield* readSseChatStream(res.body, "chatgpt-codex", "ChatGPT (Codex)", opts.signal);
  },

  async listModels(signal?: AbortSignal): Promise<CatalogModel[]> {
    const baseUrl = getBridgeUrl();
    try {
      const res = await fetch(`${baseUrl}/v1/models`, { signal });
      if (!res.ok) {
        throw new ProviderError(
          `Could not load Codex model catalog (HTTP ${res.status}).`,
          "chatgpt-codex",
          res.status
        );
      }
      const data = await res.json();
      const arr: unknown[] = Array.isArray(data?.data) ? data.data : [];
      return arr.map((m) => {
        const model = m as { id?: string; name?: string };
        return {
          id: model.id ?? "",
          name: model.name ?? model.id ?? "",
          providerId: "chatgpt-codex" as const,
        };
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (err instanceof ProviderError) throw err;
      return [];
    }
  },
};
