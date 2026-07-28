// =============================================================================
// Gemini (Google AI Studio) Provider Adapter
// =============================================================================

import {
  type CatalogModel,
  type ChatMessage,
  type ChatOptions,
  type LLMProvider,
  type ProviderReadiness,
  ProviderError,
} from "./types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey(): string {
  const envKey = ((import.meta.env.VITE_GEMINI_KEY as string | undefined) ?? "").trim();
  if (envKey) return envKey;
  try {
    return (localStorage.getItem("rsemble.key.gemini") ?? "").trim();
  } catch {
    return "";
  }
}

/** Map ChatMessage[] to Gemini systemInstruction + contents shape */
function mapMessagesToGemini(messages: ChatMessage[]) {
  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystemMsgs = messages.filter((m) => m.role !== "system");

  const systemInstruction = systemMsg
    ? { parts: [{ text: systemMsg.content }] }
    : undefined;

  const contents = nonSystemMsgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  return { systemInstruction, contents };
}

export const geminiProvider: LLMProvider = {
  id: "gemini",
  label: "Gemini",

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
        "gemini"
      );
    }

    const { systemInstruction, contents } = mapMessagesToGemini(opts.messages);
    const model = opts.model.startsWith("models/") ? opts.model.slice(7) : opts.model;
    const url = `${BASE_URL}/models/${model}:generateContent?key=${key}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction,
          contents,
          generationConfig: {
            temperature: opts.temperature,
            maxOutputTokens: opts.maxTokens,
          },
        }),
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ProviderError("Network error reaching Gemini. Check your connection.", "gemini");
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
        detail || `Gemini request failed (HTTP ${res.status}).`,
        "gemini",
        res.status
      );
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new ProviderError("Gemini returned an empty response.", "gemini");
    }
    return text;
  },

  async *chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_GEMINI_KEY. Add it to a .env file at the project root.",
        "gemini"
      );
    }

    const { systemInstruction, contents } = mapMessagesToGemini(opts.messages);
    const model = opts.model.startsWith("models/") ? opts.model.slice(7) : opts.model;
    const url = `${BASE_URL}/models/${model}:streamGenerateContent?key=${key}&alt=sse`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction,
          contents,
          generationConfig: {
            temperature: opts.temperature,
            maxOutputTokens: opts.maxTokens,
          },
        }),
        signal: opts.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ProviderError("Network error reaching Gemini. Check your connection.", "gemini");
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
        detail || `Gemini streaming request failed (HTTP ${res.status}).`,
        "gemini",
        res.status
      );
    }

    // Gemini SSE: data: lines containing { candidates: [{ content: { parts: [{ text }] } }] }
    // No [DONE] sentinel — stream ends when the reader is done. We still guard
    // against empty streams and distinguish read failures from aborts.
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
          if (err instanceof DOMException && err.name === "AbortError") throw err;
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
            // Buffer incomplete JSON
          }
        }
      }
      if (!yieldedAny) {
        if (opts.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        throw new ProviderError("Gemini returned an empty stream.", "gemini");
      }
    } finally {
      reader.releaseLock();
    }
  },

  async listModels(signal?: AbortSignal): Promise<CatalogModel[]> {
    const key = getApiKey();
    if (!key) {
      return [
        { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", providerId: "gemini" },
        { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", providerId: "gemini" },
        { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", providerId: "gemini" },
      ];
    }

    try {
      const res = await fetch(`${BASE_URL}/models?key=${key}`, { signal });
      if (!res.ok) {
        throw new ProviderError(`Could not load Gemini models (HTTP ${res.status}).`, "gemini", res.status);
      }
      const data = await res.json();
      const arr: unknown[] = Array.isArray(data?.models) ? data.models : [];
      const list: CatalogModel[] = arr
        .map((m) => {
          const item = m as { name?: string; displayName?: string; supportedGenerationMethods?: string[] };
          const rawId = item.name ?? "";
          const id = rawId.startsWith("models/") ? rawId.slice(7) : rawId;
          const name = item.displayName ?? id;
          return { id, name, providerId: "gemini" as const };
        })
        .filter((m) => m.id.startsWith("gemini"));

      return list.length > 0
        ? list
        : [
            { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", providerId: "gemini" },
            { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", providerId: "gemini" },
          ];
    } catch {
      return [
        { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", providerId: "gemini" },
        { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", providerId: "gemini" },
      ];
    }
  },
};
