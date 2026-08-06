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

const BASE_URL = "https://openrouter.ai/api/v1";

function getApiKey(): string {
  return credentialStore.get("openrouter");
}

function buildReasoningPayload(
  model: string,
  effort: ChatOptions["reasoningEffort"],
  strict = false,
): Record<string, unknown> {
  try {
    return nativeReasoningPayload("openrouter", model, effort, strict).payload;
  } catch (error) {
    throw new ProviderError(error instanceof Error ? error.message : String(error), "openrouter");
  }
}

async function runOpenRouterRequest<T>(
  opts: ChatOptions,
  operation: (signal: AbortSignal, onHeadersReady: () => void) => Promise<T>,
): Promise<T> {
  return runProviderRequest(operation, {
    provider: "openrouter",
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

export const openrouterProvider: LLMProvider = {
  id: "openrouter",
  label: "OpenRouter",
  executionDeadlines: true,

  async testConnection(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness> {
    const candidateKey = apiKey.trim();
    if (!candidateKey) return { ok: false, reason: "Enter an OpenRouter API key first." };
    try {
      const res = await fetch(`${BASE_URL}/key`, {
        headers: { Authorization: ["Bearer", candidateKey].join(" ") },
        signal,
      });
      if (res.ok) return { ok: true };
      const raw = await readBoundedResponseText(res).catch(() => "");
      return { ok: false, reason: providerErrorDetail(raw, "OpenRouter", res.status) };
    } catch (err) {
      const abort = providerAbortError(err, signal);
      if (abort !== null) throw abort;
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
        "openrouter",
      );
    }

    const reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
    try {
      return await runOpenRouterRequest(opts, async (signal, onHeadersReady) => {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
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
          signal,
        });
        onHeadersReady();
        if (!res.ok) {
          const raw = await readBoundedResponseText(res).catch(() => "");
          throw new ProviderError(
            providerErrorDetail(raw, "OpenRouter", res.status),
            "openrouter",
            res.status,
          );
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
          throw new ProviderError("OpenRouter returned an empty response.", "openrouter");
        }
        return content;
      });
    } catch (err) {
      if (isExecutionTimeoutError(err)) throw err;
      const abort = providerAbortError(err, opts.signal);
      if (abort !== null) throw abort;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        "Network error reaching OpenRouter. Check your connection.",
        "openrouter",
      );
    }
  },

  async chatCompletionDetailed(opts: ChatOptions): Promise<ProviderCompletionResult> {
    const key = getApiKey();
    if (!key) {
      throw new ProviderError(
        "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
        "openrouter",
      );
    }

    const reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
    try {
      return await runOpenRouterRequest(opts, async (signal, onHeadersReady) => {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
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
          signal,
        });
        onHeadersReady();
        if (!res.ok) {
          const raw = await readBoundedResponseText(res).catch(() => "");
          throw new ProviderError(
            providerErrorDetail(raw, "OpenRouter", res.status),
            "openrouter",
            res.status,
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
      });
    } catch (err) {
      if (isExecutionTimeoutError(err)) throw err;
      const abort = providerAbortError(err, opts.signal);
      if (abort !== null) throw abort;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        "Network error reaching OpenRouter. Check your connection.",
        "openrouter",
      );
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
          "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
          "openrouter",
        );
      }
      let reasoning: Record<string, unknown>;
      try {
        reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
      } catch (error) {
        composed.cleanup();
        throw error;
      }
      try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
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
          signal: composed.signal,
        });
        headers.resolve();
        if (!res.ok || !res.body) {
          const raw = await readBoundedResponseText(res).catch(() => "");
          throw new ProviderError(
            providerErrorDetail(raw, "OpenRouter", res.status),
            "openrouter",
            res.status,
          );
        }
        yield* readSseChatStream(res.body, "openrouter", "OpenRouter", composed.signal);
      } catch (err) {
        headers.resolve();
        if (isExecutionTimeoutError(err)) throw err;
        const abort = providerAbortError(err, composed.signal);
        if (abort !== null) throw abort;
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(
          "Network error reaching OpenRouter. Check your connection.",
          "openrouter",
        );
      } finally {
        composed.cleanup();
      }
    })();
    return wrapProviderStream(source, headers.promise, {
      provider: "openrouter",
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

  chatCompletionStreamDetailed(
    opts: ChatOptions,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown> {
    const headers = createHeadersReady();
    const streamAbort = new AbortController();
    const composed = composeAbortSignals(opts.signal, streamAbort.signal);
    const source = (async function* (): AsyncGenerator<ProviderStreamEvent, void, unknown> {
      const key = getApiKey();
      if (!key) {
        composed.cleanup();
        throw new ProviderError(
          "Missing VITE_OPENROUTER_KEY. Add it to a .env file at the project root and restart the dev server.",
          "openrouter",
        );
      }
      let reasoning: Record<string, unknown>;
      try {
        reasoning = buildReasoningPayload(opts.model, opts.reasoningEffort, opts.reasoningStrict);
      } catch (error) {
        composed.cleanup();
        throw error;
      }
      try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
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
          signal: composed.signal,
        });
        headers.resolve();
        if (!res.ok || !res.body) {
          const raw = await readBoundedResponseText(res).catch(() => "");
          throw new ProviderError(
            providerErrorDetail(raw, "OpenRouter", res.status),
            "openrouter",
            res.status,
          );
        }
        const meta: SseMeta = { usage: null, cost: null };
        for await (const delta of readSseChatStream(
          res.body,
          "openrouter",
          "OpenRouter",
          composed.signal,
          meta,
        )) {
          yield { delta };
        }
        yield { usage: meta.usage ?? undefined, cost: meta.cost ?? undefined };
      } catch (err) {
        headers.resolve();
        if (isExecutionTimeoutError(err)) throw err;
        const abort = providerAbortError(err, composed.signal);
        if (abort !== null) throw abort;
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(
          "Network error reaching OpenRouter. Check your connection.",
          "openrouter",
        );
      } finally {
        composed.cleanup();
      }
    })();
    return wrapProviderStream(source, headers.promise, {
      provider: "openrouter",
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
    const res = await fetch(`${BASE_URL}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      signal,
    });
    if (!res.ok) {
      throw new ProviderError(
        `Could not load model catalog (HTTP ${res.status}).`,
        "openrouter",
        res.status,
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
