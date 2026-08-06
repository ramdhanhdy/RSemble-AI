// =============================================================================
// Gemini (Google AI Studio) Provider Adapter
// =============================================================================

import {
  type CatalogModel,
  type ChatMessage,
  type ChatOptions,
  type ContentPart,
  type LLMProvider,
  type ProviderReadiness,
  ProviderError,
} from "./types";
import { resolveReasoningEffort } from "./reasoning";
import { credentialStore } from "../credentials/credential-store";
import { providerErrorDetail } from "./error-message";
import { readBoundedResponseText } from "../../../shared/http";
import {
  PROVIDER_DEADLINES,
  createHeadersReady,
  runProviderRequest,
  wrapProviderStream,
} from "./provider-deadline";
import {
  composeAbortSignals,
  isExecutionTimeoutError,
  providerAbortError,
} from "../execution-deadline";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey(): string {
  return credentialStore.get("gemini");
}

function buildThinkingConfig(
  model: string,
  effort: ChatOptions["reasoningEffort"],
  strict = false,
): Record<string, unknown> {
  const resolution = resolveReasoningEffort("gemini", model, effort, strict);
  if (!resolution.ok) throw new ProviderError(resolution.reason, "gemini");
  if (resolution.effective === "provider-default") return {};
  return { thinkingConfig: { thinkingLevel: resolution.effective } };
}

/**
 * Map one message's content to Gemini parts (attachments plan 7.4.1).
 * String content maps to `[{ text }]` exactly as before; `ContentPart[]`
 * maps text parts to `{ text }` and image/file parts (base64, no prefix) to
 * `{ inlineData: { mimeType, data } }` — the verified current shape for all
 * `gemini-*` models (spec §5).
 */
function mapContentToGeminiParts(
  content: string | ContentPart[],
): { text?: string; inlineData?: { mimeType: string; data: string } }[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((part) => {
    switch (part.type) {
      case "text":
        return { text: part.text };
      case "image":
      case "file":
        return { inlineData: { mimeType: part.mimeType, data: part.data } };
    }
  });
}

/** Map ChatMessage[] to Gemini systemInstruction + contents shape */
function mapMessagesToGemini(messages: ChatMessage[]) {
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  // System messages are always plain strings (spec §4); if one ever carries
  // parts, project to text rather than emitting an invalid `text` value.
  const systemInstruction = systemMsg
    ? {
        parts: [
          {
            text:
              typeof systemMsg.content === "string"
                ? systemMsg.content
                : systemMsg.content
                    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
                    .map((p) => p.text)
                    .join("\n"),
          },
        ],
      }
    : undefined;

  const contents = nonSystemMsgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: mapContentToGeminiParts(m.content),
  }));

  return { systemInstruction, contents };
}

/** Single fallback catalog for no-key, empty-response, and recoverable-failure
 *  paths (spec §8.3). Starts with current Gemini 3 models. Returned as a fresh
 *  copy per call so callers cannot mutate the module constant. */
const GEMINI_FALLBACK_MODELS: readonly CatalogModel[] = [
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", providerId: "gemini" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", providerId: "gemini" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", providerId: "gemini" },
];

function fallbackGeminiCatalog(): CatalogModel[] {
  return GEMINI_FALLBACK_MODELS.map((m) => ({ ...m }));
}

/** A live record is selectable when supportedGenerationMethods is absent OR
 *  includes generateContent — embedding-only records never enter a picker
 *  (spec §8.1). */
function supportsGenerateContent(item: { supportedGenerationMethods?: unknown }): boolean {
  const methods = item.supportedGenerationMethods;
  return methods === undefined || (Array.isArray(methods) && methods.includes("generateContent"));
}

function compareExactIds(a: string, b: string): number {
  const folded = a.localeCompare(b, undefined, { sensitivity: "base" });
  if (folded !== 0) return folded;
  return a < b ? -1 : a > b ? 1 : 0;
}

function geminiVersion(id: string): { major: number; minor: number } | null {
  const m = id.match(/gemini-(\d+)\.(\d+)/i);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

function isLatestAlias(id: string): boolean {
  return /-latest$/i.test(id);
}

/** Deterministic recency order (spec §8.2): -latest aliases first, then numeric
 *  generations descending (stability suffixes never place 2.x ahead of 3.x),
 *  then unversioned/legacy, with a case-insensitive id tie-break. */
function compareGeminiModelIds(a: string, b: string): number {
  const aLatest = isLatestAlias(a);
  const bLatest = isLatestAlias(b);
  if (aLatest !== bLatest) return aLatest ? -1 : 1;
  const av = geminiVersion(a);
  const bv = geminiVersion(b);
  if (av && bv) {
    if (av.major !== bv.major) return bv.major - av.major;
    if (av.minor !== bv.minor) return bv.minor - av.minor;
    return compareExactIds(a, b);
  }
  if (av && !bv) return -1;
  if (!av && bv) return 1;
  return compareExactIds(a, b);
}

/** Filter to generation-capable gemini* ids, strip the `models/` prefix once,
 *  deduplicate (first metadata occurrence supplies the display name), and sort
 *  by deterministic recency. Exact provider-native ids are preserved — ordering
 *  never rewrites an id (spec §8.2). */
function normalizeGeminiCatalog(items: unknown[]): CatalogModel[] {
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const m of items) {
    const item = m as { name?: string; displayName?: string; supportedGenerationMethods?: unknown };
    const rawId = (item.name ?? "").trim();
    if (!rawId) continue;
    const id = rawId.startsWith("models/") ? rawId.slice(7) : rawId;
    if (!id.startsWith("gemini")) continue;
    if (!supportsGenerateContent(item)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: item.displayName ?? id, providerId: "gemini" });
  }
  out.sort((a, b) => compareGeminiModelIds(a.id, b.id));
  return out;
}

async function runGeminiRequest<T>(
  opts: ChatOptions,
  operation: (signal: AbortSignal, onHeadersReady: () => void) => Promise<T>,
): Promise<T> {
  return runProviderRequest(operation, {
    provider: "gemini",
    model: opts.model,
    stage: "provider",
    signal: opts.signal,
    policy: {
      ...PROVIDER_DEADLINES,
      connectMs: opts.connectMs ?? PROVIDER_DEADLINES.connectMs,
      inactivityMs: opts.inactivityMs ?? PROVIDER_DEADLINES.inactivityMs,
      overallMs: opts.overallMs ?? PROVIDER_DEADLINES.overallMs,
    },
  });
}

export const geminiProvider: LLMProvider = {
  id: "gemini",
  label: "Gemini",
  executionDeadlines: true,

  async testConnection(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness> {
    const candidateKey = apiKey.trim();
    if (!candidateKey) return { ok: false, reason: "Enter a Gemini API key first." };
    try {
      const res = await fetch(`${BASE_URL}/models?key=${encodeURIComponent(candidateKey)}`, {
        signal,
      });
      if (res.ok) return { ok: true };
      const raw = await readBoundedResponseText(res).catch(() => "");
      return { ok: false, reason: providerErrorDetail(raw, "Gemini", res.status) };
    } catch (err) {
      const abort = providerAbortError(err, signal);
      if (abort !== null) throw abort;
      return { ok: false, reason: "Network error reaching Gemini." };
    }
  },

  readiness(): ProviderReadiness {
    const key = getApiKey();
    if (key.length > 0) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: "Missing VITE_GEMINI_KEY. Add it to a .env file at the project root.",
    };
  },

  async chatCompletion(opts: ChatOptions): Promise<string> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_GEMINI_KEY. Add it to a .env file at the project root.",
        "gemini",
      );
    }

    const { systemInstruction, contents } = mapMessagesToGemini(opts.messages);
    const model = opts.model.startsWith("models/") ? opts.model.slice(7) : opts.model;
    const url = `${BASE_URL}/models/${model}:generateContent?key=${key}`;
    const thinkingConfig = buildThinkingConfig(model, opts.reasoningEffort, opts.reasoningStrict);
    try {
      return await runGeminiRequest(opts, async (signal, onHeadersReady) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig: {
              temperature: opts.temperature,
              maxOutputTokens: opts.maxTokens,
              ...thinkingConfig,
            },
          }),
          signal,
        });
        onHeadersReady();
        if (!res.ok) {
          const raw = await readBoundedResponseText(res).catch(() => "");
          throw new ProviderError(
            providerErrorDetail(raw, "Gemini", res.status),
            "gemini",
            res.status,
          );
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string" || text.trim().length === 0) {
          throw new ProviderError("Gemini returned an empty response.", "gemini");
        }
        return text;
      });
    } catch (err) {
      if (isExecutionTimeoutError(err)) throw err;
      const abort = providerAbortError(err, opts.signal);
      if (abort !== null) throw abort;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError("Network error reaching Gemini. Check your connection.", "gemini");
    }
  },

  chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
    const headers = createHeadersReady();
    const streamAbort = new AbortController();
    const composed = composeAbortSignals(opts.signal, streamAbort.signal);
    const source = (async function* (): AsyncGenerator<string, void, unknown> {
      const key = getApiKey();
      if (!key) {
        composed.cleanup();
        throw new ProviderError(
          "Missing VITE_GEMINI_KEY. Add it to a .env file at the project root.",
          "gemini",
        );
      }

      let systemInstruction: unknown;
      let contents: unknown;
      let model: string;
      let url: string;
      let thinkingConfig: Record<string, unknown>;
      try {
        ({ systemInstruction, contents } = mapMessagesToGemini(opts.messages));
        model = opts.model.startsWith("models/") ? opts.model.slice(7) : opts.model;
        url = `${BASE_URL}/models/${model}:streamGenerateContent?key=${key}&alt=sse`;
        thinkingConfig = buildThinkingConfig(model, opts.reasoningEffort, opts.reasoningStrict);
      } catch (error) {
        composed.cleanup();
        throw error;
      }
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction,
            contents,
            generationConfig: {
              temperature: opts.temperature,
              maxOutputTokens: opts.maxTokens,
              ...thinkingConfig,
            },
          }),
          signal: composed.signal,
        });
        headers.resolve();
        if (!res.ok || !res.body) {
          const raw = await readBoundedResponseText(res).catch(() => "");
          throw new ProviderError(
            providerErrorDetail(raw, "Gemini", res.status),
            "gemini",
            res.status,
          );
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let yieldedAny = false;
        try {
          while (true) {
            let done: boolean;
            let value: Uint8Array | undefined;
            try {
              const result = await reader.read();
              done = result.done;
              value = result.value;
            } catch (err) {
              const abort = providerAbortError(err, composed.signal);
              if (abort !== null) throw abort;
              throw new ProviderError(
                "Gemini stream interrupted — upstream read failure. Partial output discarded.",
                "gemini",
              );
            }
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (line.length === 0 || !line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              try {
                const chunk = JSON.parse(payload) as {
                  candidates?: { content?: { parts?: { text?: string }[] } }[];
                };
                const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                  yieldedAny = true;
                  yield text;
                }
              } catch {
                // Buffer incomplete JSON.
              }
            }
          }
          if (!yieldedAny) {
            if (composed.signal.aborted) {
              throw (
                providerAbortError(undefined, composed.signal) ??
                new DOMException("Aborted", "AbortError")
              );
            }
            throw new ProviderError("Gemini returned an empty stream.", "gemini");
          }
        } finally {
          reader.releaseLock();
        }
      } catch (err) {
        headers.resolve();
        if (isExecutionTimeoutError(err)) throw err;
        const abort = providerAbortError(err, composed.signal);
        if (abort !== null) throw abort;
        if (err instanceof ProviderError) throw err;
        throw new ProviderError("Network error reaching Gemini. Check your connection.", "gemini");
      } finally {
        composed.cleanup();
      }
    })();
    return wrapProviderStream(source, headers.promise, {
      provider: "gemini",
      model: opts.model,
      stage: "provider",
      signal: composed.signal,
      abortController: streamAbort,
      policy: {
        ...PROVIDER_DEADLINES,
        connectMs: opts.connectMs ?? PROVIDER_DEADLINES.connectMs,
        inactivityMs: opts.inactivityMs ?? PROVIDER_DEADLINES.inactivityMs,
        overallMs: opts.overallMs ?? PROVIDER_DEADLINES.overallMs,
      },
    });
  },

  async listModels(signal?: AbortSignal): Promise<CatalogModel[]> {
    const key = getApiKey();
    if (!key) return fallbackGeminiCatalog();

    try {
      const res = await fetch(`${BASE_URL}/models?key=${key}`, { signal });
      if (!res.ok) {
        throw new ProviderError(
          `Could not load Gemini models (HTTP ${res.status}).`,
          "gemini",
          res.status,
        );
      }
      const data = await res.json();
      const arr: unknown[] = Array.isArray(data?.models) ? data.models : [];
      const list = normalizeGeminiCatalog(arr);
      return list.length > 0 ? list : fallbackGeminiCatalog();
    } catch (err) {
      // Preserve abort semantics (spec §9): an aborted list request must
      // propagate, not silently resolve to the fallback.
      const abort = providerAbortError(err, signal);
      if (abort !== null) throw abort;
      return fallbackGeminiCatalog();
    }
  },
};
