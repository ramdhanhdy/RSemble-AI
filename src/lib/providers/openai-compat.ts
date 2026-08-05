// =============================================================================
// Shared OpenAI-compatible provider adapter factory
//
// Used by providers that speak standard OpenAI chat completions + SSE streaming.
// (CommandCode, ClinePass, Umans, and potentially others.)
// =============================================================================

import {
  type CatalogModel,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type ProviderId,
  type ProviderReadiness,
  ProviderError,
} from "./types";
import { readSseChatStream } from "./sse-stream";
import { toOpenAIMessages } from "./content";
import { setModelCapabilities } from "./capabilities";
import { nativeReasoningPayload } from "./reasoning";

export interface OpenAICompatConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  envKey: string;
  storageKey: string;
  modelsPath: string;
  completionsPath: string;
  extraHeaders?: Record<string, string>;
  /** When false, a blank API key is accepted (e.g. 9Router with auth disabled). Default: true. */
  apiKeyRequired?: boolean;
  /** How readiness is established: "credential" (sync key check) or "models" (async /models probe). Default: "credential". */
  readinessProbe?: "credential" | "models";
  /**
   * Whether this gateway can transport image parts (OpenAI `image_url` data
   * URLs). This controls wire compatibility only; model vision capability is
   * read from explicit catalog metadata and remains unknown otherwise.
   * Default: false — media parts reaching a non-image config are rejected
   * before any request is sent (spec §5).
   */
  supportsImages?: boolean;
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

/** Read an explicit per-model vision declaration without guessing from a slug. */
function explicitImageCapability(model: unknown): boolean | null {
  if (typeof model !== "object" || model === null || Array.isArray(model)) return null;
  const record = model as Record<string, unknown>;
  const sources = [record, record.architecture, record.capabilities, record.metadata]
    .filter((value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
    );

  for (const source of sources) {
    const modalityFields = [source.input_modalities, source.modalities, source.inputModalities];
    for (const field of modalityFields) {
      if (!Array.isArray(field)) continue;
      return field.some((value) =>
        typeof value === "string" && /^(?:image|vision)$/i.test(value.trim()),
      );
    }
    for (const field of ["image", "vision", "supports_images"]) {
      if (typeof source[field] === "boolean") return source[field];
    }
  }
  return null;
}

export function createOpenAICompatProvider(config: OpenAICompatConfig): LLMProvider {
  const {
    id, label, baseUrl, envKey, storageKey, modelsPath, completionsPath, extraHeaders,
    apiKeyRequired = true,
    readinessProbe = "credential",
    supportsImages = false,
  } = config;

  function getApiKey(): string {
    return getKey(envKey, storageKey);
  }

  function buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Title": "RSemble AI",
      ...(extraHeaders ?? {}),
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  /**
   * Reject media parts before any network I/O when the config does not declare
   * image support (attachments plan 7.4.2). Text parts and plain strings always
   * pass — an attachment-free run must never hit this gate.
   */
  function assertTransportable(messages: ChatMessage[]): void {
    if (supportsImages) return;
    for (const m of messages) {
      if (typeof m.content === "string") continue;
      for (const part of m.content) {
        if (part.type === "image" || part.type === "file") {
          throw new ProviderError(
            `${label} does not support image or file attachments (supportsImages is off for this provider). Remove the attachment or use a vision-capable provider.`,
            id
          );
        }
      }
    }
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

  /** Shared model-catalog probe — used by testConnection, async readiness, and listModels. */
  async function probeModels(key: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${baseUrl}${modelsPath}`, {
      headers: buildHeaders(key),
      signal,
    });
  }

  return {
    id,
    label,

    async testConnection(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness> {
      const candidateKey = apiKey.trim();
      if (!candidateKey && apiKeyRequired) return { ok: false, reason: `Enter a ${label} API key first.` };
      let res: Response;
      try {
        res = await probeModels(candidateKey, signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        return { ok: false, reason: `Network error reaching ${label}. Check the endpoint or local bridge.` };
      }
      if (!res.ok) {
        const error = await parseError(res, id);
        return { ok: false, reason: error.message };
      }
      return { ok: true };
    },

    readiness(): ProviderReadiness | Promise<ProviderReadiness> {
      if (readinessProbe === "models") {
        return (async (): Promise<ProviderReadiness> => {
          const key = getApiKey();
          if (!key && apiKeyRequired) {
            return { ok: false, reason: `Missing ${envKey}. Add it to a .env file or the Connections panel.` };
          }
          let res: Response;
          try {
            res = await probeModels(key);
          } catch {
            return { ok: false, reason: `Could not reach ${label}. Check the endpoint or local bridge.` };
          }
          if (!res.ok) {
            if (res.status === 401) return { ok: false, reason: `${label} authentication rejected (HTTP 401).` };
            return { ok: false, reason: `${label} returned HTTP ${res.status}.` };
          }
          try {
            const data = await res.json();
            const hasArray = Array.isArray(data?.data) || Array.isArray(data?.models);
            if (!hasArray) return { ok: false, reason: `${label} returned a malformed catalog response.` };
            return { ok: true };
          } catch {
            return { ok: false, reason: `${label} returned a malformed catalog response.` };
          }
        })();
      }
      // Default: sync credential check
      const key = getApiKey();
      if (key.length > 0) return { ok: true };
      return {
        ok: false,
        reason: `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
      };
    },

    async chatCompletion(opts: ChatOptions): Promise<string> {
      const key = getApiKey();
      if (!key && apiKeyRequired) {
        throw new ProviderError(
          `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
          id
        );
      }
      assertTransportable(opts.messages);
      let reasoning: Record<string, unknown>;
      try {
        reasoning = nativeReasoningPayload(id, opts.model, opts.reasoningEffort, opts.reasoningStrict).payload;
      } catch (error) {
        throw new ProviderError(error instanceof Error ? error.message : String(error), id);
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}${completionsPath}`, {
          method: "POST",
          headers: buildHeaders(key),
          body: JSON.stringify({
            model: opts.model,
            messages: toOpenAIMessages(opts.messages),
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            stream: false,
            ...reasoning,
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
      if (!key && apiKeyRequired) {
        throw new ProviderError(
          `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
          id
        );
      }
      assertTransportable(opts.messages);
      let reasoning: Record<string, unknown>;
      try {
        reasoning = nativeReasoningPayload(id, opts.model, opts.reasoningEffort, opts.reasoningStrict).payload;
      } catch (error) {
        throw new ProviderError(error instanceof Error ? error.message : String(error), id);
      }

      let res: Response;
      try {
        res = await fetch(`${baseUrl}${completionsPath}`, {
          method: "POST",
          headers: buildHeaders(key),
          body: JSON.stringify({
            model: opts.model,
            messages: toOpenAIMessages(opts.messages),
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            stream: true,
            ...reasoning,
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
      if (!key && apiKeyRequired) return [];

      try {
        const res = await probeModels(key, signal);
        if (!res.ok) {
          throw new ProviderError(
            `Could not load ${label} model catalog (HTTP ${res.status}).`,
            id,
            res.status
          );
        }
        const data = await res.json();
        const arr: unknown[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
        const seen = new Set<string>();
        return arr
          .map((m) => {
            const model = m as { id?: string; name?: string };
            const modelId = model.id ?? "";
            // `supportsImages` describes the gateway wire transport only.
            // Per-model vision stays unknown unless the catalog explicitly
            // declares it; guessing from a slug would send images blindly.
            const imageCapability = explicitImageCapability(m);
            if (modelId.length > 0 && imageCapability !== null) {
              setModelCapabilities(id, modelId, { image: supportsImages && imageCapability, pdf: false });
            }
            return {
              id: modelId,
              name: model.name ?? model.id ?? "",
              providerId: id,
            };
          })
          .filter((m) => m.id.length > 0)
          .filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          })
          .sort((a, b) => a.id.localeCompare(b.id));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        return [];
      }
    },
  };
}
