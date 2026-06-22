// =============================================================================
// OpenRouter API client (browser-side, build-time key via VITE_OPENROUTER_KEY)
// =============================================================================

const BASE_URL = "https://openrouter.ai/api/v1";

export function getApiKey(): string {
  return ((import.meta.env.VITE_OPENROUTER_KEY as string | undefined) ?? "").trim();
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class OpenRouterError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

/** Send a chat completion request and return the assistant text content. */
export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const key = getApiKey();
  if (!key) {
    throw new OpenRouterError(
      "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server."
    );
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // HTTP-Referer is set automatically by the browser; only X-Title is settable here.
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
    throw new OpenRouterError("Network error reaching OpenRouter. Check your connection.");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new OpenRouterError(detail || `OpenRouter request failed (HTTP ${res.status}).`, res.status);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new OpenRouterError("OpenRouter returned an empty response.");
  }
  return content;
}

/**
 * Streaming chat completion. Yields incremental text deltas as they arrive,
 * via an async iterable. Used for the fanout (candidate generation) so the UI
 * can show prose arriving model-by-model. Not used for the judge/fusion calls —
 * those return JSON, which is unreadable mid-stream.
 *
 * Implementation: OpenRouter speaks OpenAI-compatible SSE. Each `data:` line is
 * either a JSON chunk with `choices[0].delta.content` or the terminal `[DONE]`.
 */
export async function* chatCompletionStream(
  opts: ChatOptions
): AsyncGenerator<string, void, unknown> {
  const key = getApiKey();
  if (!key) {
    throw new OpenRouterError(
      "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server."
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
    throw new OpenRouterError("Network error reaching OpenRouter. Check your connection.");
  }

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error?.message ?? JSON.stringify(body);
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new OpenRouterError(detail || `OpenRouter request failed (HTTP ${res.status}).`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines; process complete ones.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0 || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Partial JSON across chunk boundaries — keep buffering, skip for now.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export interface OpenRouterModel {
  id: string;
  name: string;
}

/** List available models so the UI can offer real, current slugs. */
export async function listModels(signal?: AbortSignal): Promise<OpenRouterModel[]> {
  const key = getApiKey();
  const res = await fetch(`${BASE_URL}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    signal,
  });
  if (!res.ok) throw new OpenRouterError(`Could not load model catalog (HTTP ${res.status}).`, res.status);
  const data = await res.json();
  const arr: unknown[] = Array.isArray(data?.data) ? data.data : [];
  return arr
    .map((m) => {
      const model = m as { id?: string; name?: string };
      return { id: model.id ?? "", name: model.name ?? model.id ?? "" };
    })
    .filter((m) => m.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Best-effort extraction of a JSON object from a model response (handles ```json fences). */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new OpenRouterError("Could not parse structured JSON from the model response.");
  }
  return JSON.parse(body.slice(start, end + 1)) as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof OpenRouterError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
