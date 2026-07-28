// =============================================================================
// Shared OpenAI-compatible provider adapter factory
//
// Used by providers that speak standard OpenAI chat completions + SSE streaming.
// (CommandCode, ClinePass, Umans, and potentially others.)
// =============================================================================

import {
  type CatalogModel,
  type ChatOptions,
  type LLMProvider,
  type ProviderId,
  type ProviderReadiness,
  ProviderError,
} from "./types";
import { readSseChatStream } from "./sse-stream";

export interface OpenAICompatConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  envKey: string;
  storageKey: string;
  modelsPath: string;
  completionsPath: string;
  extraHeaders?: Record<string, string>;
}

function getKey(envKey: string, storageKey: string): string {
  const envVal = ((import.meta.env[envKey] as string | undefined) ?? "").trim();
  if (envVal) return envVal;
  try {
    return (localStorage.getItem(storageKey) ?? "").trim();
  } catch {
    return "";
  }
}

export function createOpenAICompatProvider(config: OpenAICompatConfig): LLMProvider {
  const { id, label, baseUrl, envKey, storageKey, modelsPath, completionsPath, extraHeaders } = config;

  function getApiKey(): string {
    return getKey(envKey, storageKey);
  }

  function buildHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "RSemble AI",
      ...(extraHeaders ?? {}),
    };
  }

  async function parseError(res: Response, providerId: ProviderId): Promise<ProviderError> {
    let detail = "";
    const rawBody = await res.text().catch(() => "");
    if (rawBody) {
      try {
        const body = JSON.parse(rawBody) as { error?: { message?: string } };
        detail = body?.error?.message ?? rawBody;
      } catch {
        // Plain-text upstream error (e.g. gateway/proxy pages): preserve verbatim.
        detail = rawBody;
      }
    }
    return new ProviderError(
      detail || `${label} request failed (HTTP ${res.status}).`,
      providerId,
      res.status
    );
  }

  return {
    id,
    label,

    readiness(): ProviderReadiness {
      const key = getApiKey();
      if (key.length > 0) return { ok: true };
      return {
        ok: false,
        reason: `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
      };
    },

    async chatCompletion(opts: ChatOptions): Promise<string> {
      const key = getApiKey();
      if (!key) {
        throw new ProviderError(
          `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
          id
        );
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}${completionsPath}`, {
          method: "POST",
          headers: buildHeaders(key),
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
        throw new ProviderError(`Network error reaching ${label}. Check your connection.`, id);
      }

      if (!res.ok) throw await parseError(res, id);

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new ProviderError(`${label} returned an empty response.`, id);
      }
      return content;
    },

    async *chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
      const key = getApiKey();
      if (!key) {
        throw new ProviderError(
          `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
          id
        );
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}${completionsPath}`, {
          method: "POST",
          headers: buildHeaders(key),
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
        throw new ProviderError(`Network error reaching ${label}. Check your connection.`, id);
      }

      if (!res.ok || !res.body) throw await parseError(res, id);

      yield* readSseChatStream(res.body, id, label, opts.signal);
    },

    async listModels(signal?: AbortSignal): Promise<CatalogModel[]> {
      const key = getApiKey();
      if (!key) return [];

      try {
        const res = await fetch(`${baseUrl}${modelsPath}`, {
          headers: buildHeaders(key),
          signal,
        });
        if (!res.ok) {
          throw new ProviderError(
            `Could not load ${label} model catalog (HTTP ${res.status}).`,
            id,
            res.status
          );
        }
        const data = await res.json();
        const arr: unknown[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
        return arr
          .map((m) => {
            const model = m as { id?: string; name?: string };
            return {
              id: model.id ?? "",
              name: model.name ?? model.id ?? "",
              providerId: id,
            };
          })
          .filter((m) => m.id.length > 0)
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch {
        return [];
      }
    },
  };
}
