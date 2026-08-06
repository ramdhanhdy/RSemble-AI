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
import { bridgeAuthHeaders } from "./bridge-auth";
import { buildBridgeRequestBody } from "./bridge-body";
import { providerErrorDetail } from "./error-message";
import { readBoundedResponseText } from "../../../shared/http";
import {
  PROVIDER_DEADLINES,
  createHeadersReady,
  runProviderRequest,
  wrapProviderStream,
} from "./provider-deadline";
import { composeAbortSignals, isExecutionTimeoutError, providerAbortError } from "../execution-deadline";

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

/** Serialize once and enforce the encoded bridge ceiling before fetch
 *  (Plan 002 D4 / Plan 003 workstream E). */
function buildBody(payload: Record<string, unknown>, hasParts: boolean): string {
  return buildBridgeRequestBody(payload, "chatgpt-codex", hasParts);
}

/** Bounded error parse under the shared provider-error policy (review fix 3):
 *  recognized structured messages are bounded and credential-redacted; unknown
 *  JSON, plain text, and HTML bodies become a generic status error. The raw
 *  body never reaches ProviderError.message. */
async function parseBridgeError(res: Response, label: string): Promise<ProviderError> {
  const raw = await readBoundedResponseText(res).catch(() => "");
  return new ProviderError(providerErrorDetail(raw, label, res.status), "chatgpt-codex", res.status);
}

function deadlinePolicy(opts: ChatOptions): typeof PROVIDER_DEADLINES {
  const policy = {
    connectMs: opts.connectMs ?? PROVIDER_DEADLINES.connectMs,
    inactivityMs: opts.inactivityMs ?? PROVIDER_DEADLINES.inactivityMs,
    ...(opts.overallMs === undefined ? {} : { overallMs: opts.overallMs }),
  };
  return policy;
}

async function runCodexRequest<T>(
  opts: ChatOptions,
  operation: (signal: AbortSignal, onHeadersReady: () => void) => Promise<T>,
): Promise<T> {
  return runProviderRequest(operation, {
    provider: "chatgpt-codex",
    model: opts.model,
    stage: "provider",
    signal: opts.signal,
    policy: deadlinePolicy(opts),
  });
}

export const chatgptCodexProvider: LLMProvider = {
  id: "chatgpt-codex",
  label: "ChatGPT (Codex)",
  executionDeadlines: true,

  async readiness(signal?: AbortSignal): Promise<ProviderReadiness> {
    const baseUrl = getBridgeUrl();
    try {
      const [authRes, healthRes] = await Promise.all([
        fetch(`${baseUrl}/auth/status`, { signal, headers: bridgeAuthHeaders() }),
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
      const abort = providerAbortError(err, signal);
      if (abort !== null) throw abort;
      return {
        ok: false,
        reason: "Codex bridge unreachable on 127.0.0.1:8787. Start the bridge (npm run dev:bridge).",
      };
    }
  },

  async chatCompletion(opts: ChatOptions): Promise<string> {
    const baseUrl = getBridgeUrl();
    validateReasoning(opts);
    try {
      return await runCodexRequest(opts, async (signal, onHeadersReady) => {
        const body = buildBody(
          {
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
          },
          opts.messages.some((m) => Array.isArray(m.content)),
        );
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
          body,
          signal,
        });
        onHeadersReady();
        if (!res.ok) throw await parseBridgeError(res, "ChatGPT (Codex)");

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
          throw new ProviderError("ChatGPT (Codex) returned an empty response.", "chatgpt-codex");
        }
        return content;
      });
    } catch (err) {
      if (isExecutionTimeoutError(err)) throw err;
      const abort = providerAbortError(err, opts.signal);
      if (abort !== null) throw abort;
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        "Network error reaching Codex bridge on 127.0.0.1. Ensure bridge is running.",
        "chatgpt-codex",
      );
    }
  },

  chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
    const baseUrl = getBridgeUrl();
    const headers = createHeadersReady();
    const streamAbort = new AbortController();
    const composed = composeAbortSignals(opts.signal, streamAbort.signal);
    const streamOpts = { ...opts, signal: composed.signal };
    const source = (async function*(): AsyncGenerator<string, void, unknown> {
      try {
        validateReasoning(opts);
        const body = buildBody(
          {
            model: opts.model,
            messages: opts.messages,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            stream: true,
          },
          opts.messages.some((m) => Array.isArray(m.content)),
        );
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...bridgeAuthHeaders() },
          body,
          signal: composed.signal,
        });
        headers.resolve();
        if (!res.ok || !res.body) throw await parseBridgeError(res, "ChatGPT (Codex)");
        yield* readSseChatStream(res.body, "chatgpt-codex", "ChatGPT (Codex)", composed.signal);
      } catch (err) {
        headers.resolve();
        if (isExecutionTimeoutError(err)) throw err;
        const abort = providerAbortError(err, composed.signal);
        if (abort !== null) throw abort;
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(
          "Network error reaching Codex bridge on 127.0.0.1. Ensure bridge is running.",
          "chatgpt-codex",
        );
      } finally {
        composed.cleanup();
      }
    })();
    return wrapProviderStream(source, headers.promise, {
      provider: "chatgpt-codex",
      model: opts.model,
      stage: "provider",
      signal: composed.signal,
      abortController: streamAbort,
      policy: deadlinePolicy(streamOpts),
    });
  },

  async listModels(signal?: AbortSignal): Promise<CatalogModel[]> {
    const baseUrl = getBridgeUrl();
    try {
      const res = await fetch(`${baseUrl}/v1/models`, { signal, headers: bridgeAuthHeaders() });
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
      const abort = providerAbortError(err, signal);
      if (abort !== null) throw abort;
      if (err instanceof ProviderError) throw err;
      return [];
    }
  },
};
