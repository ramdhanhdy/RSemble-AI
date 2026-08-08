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
import { credentialStore } from "../credentials/credential-store";
import { bridgeAuthHeaders } from "./bridge-auth";
import { buildBridgeRequestBody } from "./bridge-body";
import { providerErrorDetail } from "./error-message";
import { readBoundedResponseText } from "../../../shared/http";
import { BRIDGE_MAX_BODY_BYTES } from "../../../shared/limits";
import {
  DEFAULT_PROVIDER_DEADLINE_POLICY,
  composeAbortSignals,
  createStreamActivity,
  isExecutionTimeoutError,
  markStreamHeadersReady,
  providerAbortError,
  runWithExecutionDeadlines,
  streamWithExecutionDeadlines,
  type ProviderDeadlinePolicy,
} from "../execution-deadline";

export interface OpenAICompatConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  envKey: string;
  /** Legacy option retained for configuration compatibility; the store now
   *  resolves credentials under the provider id and this value is unused. */
  storageKey?: string;
  modelsPath: string;
  completionsPath: string;
  extraHeaders?: Record<string, string>;
  /**
   * Route requests through the localhost bridge with `X-RSemble-Bridge-Secret`
   * when `VITE_RSEMBLE_BRIDGE_SECRET` is configured (Plan 002 D3).
   */
  bridgeSecret?: boolean;
  /**
   * Enforce the encoded-body ceiling before fetch for bridge-routed providers
   * (Plan 002 D4 / Plan 003 workstream E). Default: undefined (no preflight).
   */
  bridgeBodyLimitBytes?: number;
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
  /** Optional paid-request deadline policy. Catalog probes remain caller
   * bounded; production adapters opt into the shared conservative defaults. */
  deadlines?: Partial<ProviderDeadlinePolicy>;
}

/** Resolve credentials through the shared CredentialStore (Plan 003 A). */
function getKey(id: ProviderId): string {
  return credentialStore.get(id);
}

/** Read an explicit per-model vision declaration without guessing from a slug. */
function explicitImageCapability(model: unknown): boolean | null {
  if (typeof model !== "object" || model === null || Array.isArray(model)) return null;
  const record = model as Record<string, unknown>;
  const sources = [record, record.architecture, record.capabilities, record.metadata].filter(
    (value): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value),
  );

  for (const source of sources) {
    const modalityFields = [source.input_modalities, source.modalities, source.inputModalities];
    for (const field of modalityFields) {
      if (!Array.isArray(field)) continue;
      return field.some(
        (value) => typeof value === "string" && /^(?:image|vision)$/i.test(value.trim()),
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
    id,
    label,
    baseUrl,
    envKey,
    modelsPath,
    completionsPath,
    extraHeaders,
    apiKeyRequired = true,
    readinessProbe = "credential",
    supportsImages = false,
    bridgeSecret = false,
    bridgeBodyLimitBytes = undefined,
  } = config;
  const deadlinePolicy = config.deadlines;
  const requestDeadlinePolicy: ProviderDeadlinePolicy | null = deadlinePolicy
    ? {
        ...DEFAULT_PROVIDER_DEADLINE_POLICY,
        ...deadlinePolicy,
      }
    : null;

  function getApiKey(): string {
    return getKey(id);
  }

  function buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Title": "RSemble AI",
      ...(extraHeaders ?? {}),
      // Bridge authentication (Plan 002 D3): attached only when the web-side
      // secret is configured; the bridge enforces it when its own secret is set.
      ...(bridgeSecret ? bridgeAuthHeaders() : {}),
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
            id,
          );
        }
      }
    }
  }

  async function parseError(res: Response, providerId: ProviderId): Promise<ProviderError> {
    // Bound the body read, then apply the shared provider-error policy: only
    // recognized structured messages survive (bounded and credential-redacted);
    // unknown JSON, plain text, and HTML bodies become a generic status error.
    // The raw body never reaches ProviderError.message (review fix 3).
    const rawBody = await readBoundedResponseText(res).catch(() => "");
    return new ProviderError(
      providerErrorDetail(rawBody, label, res.status),
      providerId,
      res.status,
    );
  }

  /** Shared model-catalog probe — used by testConnection, async readiness, and listModels. */
  async function probeModels(key: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${baseUrl}${modelsPath}`, {
      headers: buildHeaders(key),
      signal,
    });
  }

  /** Serialize a request body once, enforcing the encoded bridge ceiling
   *  before any fetch when configured (Plan 002 D4 / Plan 003 E). */
  function buildBody(payload: Record<string, unknown>, hasParts: boolean): string {
    return buildBridgeRequestBody(
      payload,
      id,
      hasParts,
      bridgeBodyLimitBytes ?? BRIDGE_MAX_BODY_BYTES,
    );
  }

  async function runRequest<T>(
    opts: ChatOptions,
    operation: (signal: AbortSignal, onHeadersReady: () => void) => Promise<T>,
    forceDeadline = false,
  ): Promise<T> {
    // The executor already owns a composed signal for paid runs. Preserve the
    // caller signal identity in that path (some bridge integrations inspect it)
    // while direct calls without a caller signal still get adapter deadlines.
    const hasExplicitOverride =
      opts.connectMs !== undefined ||
      opts.inactivityMs !== undefined ||
      opts.overallMs !== undefined;
    if (!requestDeadlinePolicy || (opts.signal && !hasExplicitOverride && !forceDeadline)) {
      return operation(opts.signal ?? new AbortController().signal, () => {});
    }
    return runWithExecutionDeadlines(operation, {
      ...requestDeadlinePolicy,
      connectMs: opts.connectMs ?? requestDeadlinePolicy.connectMs,
      overallMs: opts.overallMs ?? requestDeadlinePolicy.overallMs,
      provider: id,
      model: opts.model,
      stage: "provider",
      signal: opts.signal,
    });
  }

  function createHeadersReady(): { promise: Promise<void>; resolve: () => void } {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
  }

  return {
    id,
    label,
    executionDeadlines: requestDeadlinePolicy !== null,

    async testConnection(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness> {
      const candidateKey = apiKey.trim();
      if (!candidateKey && apiKeyRequired)
        return { ok: false, reason: `Enter a ${label} API key first.` };
      let res: Response;
      try {
        res = await probeModels(candidateKey, signal);
      } catch (err) {
        const abort = providerAbortError(err, signal);
        if (abort !== null) throw abort;
        return {
          ok: false,
          reason: `Network error reaching ${label}. Check the endpoint or local bridge.`,
        };
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
            return {
              ok: false,
              reason: `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
            };
          }
          let res: Response;
          try {
            res = await probeModels(key);
          } catch {
            return {
              ok: false,
              reason: `Could not reach ${label}. Check the endpoint or local bridge.`,
            };
          }
          if (!res.ok) {
            if (res.status === 401)
              return { ok: false, reason: `${label} authentication rejected (HTTP 401).` };
            return { ok: false, reason: `${label} returned HTTP ${res.status}.` };
          }
          try {
            const data = await res.json();
            const hasArray = Array.isArray(data?.data) || Array.isArray(data?.models);
            if (!hasArray)
              return { ok: false, reason: `${label} returned a malformed catalog response.` };
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
          id,
        );
      }
      assertTransportable(opts.messages);
      let reasoning: Record<string, unknown>;
      try {
        reasoning = nativeReasoningPayload(
          id,
          opts.model,
          opts.reasoningEffort,
          opts.reasoningStrict,
        ).payload;
      } catch (error) {
        throw new ProviderError(error instanceof Error ? error.message : String(error), id);
      }

      try {
        return await runRequest(opts, async (signal, onHeadersReady) => {
          const body = buildBody(
            {
              model: opts.model,
              messages: toOpenAIMessages(opts.messages),
              temperature: opts.temperature,
              max_tokens: opts.maxTokens,
              stream: false,
              ...reasoning,
            },
            opts.messages.some((m) => Array.isArray(m.content)),
          );
          const res = await fetch(`${baseUrl}${completionsPath}`, {
            method: "POST",
            headers: buildHeaders(key),
            body,
            signal,
          });
          onHeadersReady();
          if (!res.ok) throw await parseError(res, id);
          const data = await res.json();
          const content = data?.choices?.[0]?.message?.content;
          if (typeof content !== "string" || content.trim().length === 0) {
            throw new ProviderError(`${label} returned an empty response.`, id);
          }
          return content;
        });
      } catch (err) {
        if (isExecutionTimeoutError(err)) throw err;
        const abort = providerAbortError(err, opts.signal);
        if (abort !== null) throw abort;
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(`Network error reaching ${label}. Check your connection.`, id);
      }
    },

    chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown> {
      const headers = createHeadersReady();
      const streamAbort = new AbortController();
      const composed = composeAbortSignals(opts.signal, streamAbort.signal);
      const activity = createStreamActivity();
      const source = (async function* (): AsyncGenerator<string, void, unknown> {
        const key = getApiKey();
        if (!key && apiKeyRequired) {
          composed.cleanup();
          throw new ProviderError(
            `Missing ${envKey}. Add it to a .env file or the Connections panel.`,
            id,
          );
        }
        try {
          assertTransportable(opts.messages);
        } catch (error) {
          composed.cleanup();
          throw error;
        }
        let reasoning: Record<string, unknown>;
        try {
          reasoning = nativeReasoningPayload(
            id,
            opts.model,
            opts.reasoningEffort,
            opts.reasoningStrict,
          ).payload;
        } catch (error) {
          composed.cleanup();
          throw new ProviderError(error instanceof Error ? error.message : String(error), id);
        }

        try {
          // The outer streamWithExecutionDeadlines owns the single connect and
          // inactivity clock. This fetch resolves the header marker directly;
          // wrapping it again here would create duplicate clocks.
          const body = buildBody(
            {
              model: opts.model,
              messages: toOpenAIMessages(opts.messages),
              temperature: opts.temperature,
              max_tokens: opts.maxTokens,
              stream: true,
              ...reasoning,
            },
            opts.messages.some((m) => Array.isArray(m.content)),
          );
          const response = await fetch(`${baseUrl}${completionsPath}`, {
            method: "POST",
            headers: buildHeaders(key),
            body,
            signal: composed.signal,
          });
          headers.resolve();
          const res = response;
          if (!res.ok || !res.body) throw await parseError(res, id);
          yield* readSseChatStream(res.body, id, label, composed.signal, undefined, activity);
        } catch (err) {
          headers.resolve();
          if (isExecutionTimeoutError(err)) throw err;
          const abort = providerAbortError(err, composed.signal);
          if (abort !== null) throw abort;
          if (err instanceof ProviderError) throw err;
          throw new ProviderError(`Network error reaching ${label}. Check your connection.`, id);
        } finally {
          composed.cleanup();
        }
      })();
      const marked = markStreamHeadersReady(source, headers.promise);
      if (!requestDeadlinePolicy) return marked as AsyncGenerator<string, void, unknown>;
      return streamWithExecutionDeadlines(marked, {
        ...requestDeadlinePolicy,
        connectMs: opts.connectMs ?? requestDeadlinePolicy.connectMs,
        inactivityMs: opts.inactivityMs ?? requestDeadlinePolicy.inactivityMs,
        overallMs: opts.overallMs ?? requestDeadlinePolicy.overallMs,
        provider: id,
        model: opts.model,
        stage: "provider",
        signal: composed.signal,
        abortController: streamAbort,
        headersReady: headers.promise,
        activity,
      });
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
            res.status,
          );
        }
        const data = await res.json();
        const arr: unknown[] = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.models)
            ? data.models
            : [];
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
              setModelCapabilities(id, modelId, {
                image: supportsImages && imageCapability,
                pdf: false,
              });
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
        const abort = providerAbortError(err, signal);
        if (abort !== null) throw abort;
        return [];
      }
    },
  };
}
