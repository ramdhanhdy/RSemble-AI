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
import { readSseChatStream, type SseMeta } from "./sse-stream";
import { toOpenAIMessages } from "./content";
import { setModelCapabilities } from "./capabilities";
import { nativeReasoningPayload, setModelReasoningCapabilities } from "./reasoning";
import { REASONING_EFFORTS, type ModelReasoningCapabilities, type ReasoningEffort } from "./types";
import { parseOpenRouterPricing, setModelPricing } from "./pricing";

import type { ProviderCompletionResult, ProviderStreamEvent, UsageBreakdown } from "./types";
import { parseOpenAICompatibleUsage, parseProviderReportedCost } from "./usage";

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

function buildReasoningPayload(model: string, effort: ChatOptions["reasoningEffort"], strict = false): Record<string, unknown> {
  try {
    return nativeReasoningPayload("openrouter", model, effort, strict).payload;
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : String(error), "openrouter");
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

    const reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
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
          messages: toOpenAIMessages(opts.messages),
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          ...reasoning,
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


  async chatCompletionDetailed(opts: ChatOptions): Promise<ProviderCompletionResult> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
        "openrouter"
      );
    }

    const reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
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
          messages: toOpenAIMessages(opts.messages),
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          ...reasoning,
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
    return {
      content,
      usage: parseOpenAICompatibleUsage(data?.usage) as UsageBreakdown | null,
      cost: parseProviderReportedCost(data?.cost),
    };
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
    const reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
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

  async *chatCompletionStreamDetailed(opts: ChatOptions): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
        "openrouter"
      );
    }

    let res: Response;
    const reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
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

    const meta: SseMeta = { usage: null, cost: null };
    for await (const delta of readSseChatStream(res.body, "openrouter", "OpenRouter", opts.signal, meta)) {
      yield { delta };
    }
    yield { usage: meta.usage ?? undefined, cost: meta.cost ?? undefined };
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
        const model = m as {
          id?: string;
          name?: string;
          architecture?: { input_modalities?: unknown };
          reasoning?: { supported_efforts?: unknown };
          pricing?: unknown;
        };
        const id = model.id ?? "";
        // Record capabilities from architecture.input_modalities (verified 2026-07-31:
        // all catalog models expose this field). Modalities beyond text/image (e.g.
        // "file") are treated as pdf-capable; audio/video are ignored for now.
        if (id.length > 0) {
          const modalities = Array.isArray(model.architecture?.input_modalities)
            ? (model.architecture!.input_modalities as string[])
            : [];
          setModelCapabilities("openrouter", id, {
            image: modalities.includes("image"),
            pdf: modalities.includes("file") || modalities.includes("pdf"),
          });
        }
        let reasoning: ModelReasoningCapabilities | undefined;
        if (model.reasoning !== null && typeof model.reasoning === "object") {
          // OpenRouter Models API: `supported_efforts` null or absent on a
          // reasoning-declared model means every effort level is allowed; an
          // explicit array restricts the set. Unknown shapes stay unknown.
          const rawEfforts = model.reasoning.supported_efforts;
          const efforts =
            rawEfforts === null || rawEfforts === undefined
              ? REASONING_EFFORTS.filter((effort) => effort !== "provider-default")
              : Array.isArray(rawEfforts)
                ? rawEfforts.filter(
                    (effort): effort is ReasoningEffort =>
                      typeof effort === "string" &&
                      REASONING_EFFORTS.includes(effort as ReasoningEffort) &&
                      effort !== "provider-default",
                  )
                : null;
          if (efforts !== null) {
            reasoning = {
              supportedEfforts: ["provider-default", ...new Set(efforts)],
              source: "catalog",
              transport: "openrouter",
            };
            setModelReasoningCapabilities("openrouter", id, reasoning);
          }
        }
        const pricing = parseOpenRouterPricing("openrouter", id, model.pricing);
        if (pricing) setModelPricing(pricing);
        return {
          id,
          name: model.name ?? model.id ?? "",
          providerId: "openrouter" as const,
          reasoning,
        };
      })
      .filter((m) => m.id.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  },
};
