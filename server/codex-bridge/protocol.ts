// =============================================================================
// CodexProtocolAdapter — the narrow Codex protocol-compatibility boundary.
//
// Plan 008 Workstream D: isolate protocol-sensitive Codex assumptions in one
// module so upstream drift is diagnosable. This module owns:
//   - protocol constants (version, user-agent, Originator, upstream endpoint,
//     OAuth client id / token endpoint);
//   - request translation (OpenAI-compat bridge body -> Codex Responses-API
//     input shape);
//   - upstream SSE event parsing (output_text.delta / .done / [DONE]);
//   - failure classification so upstream drift surfaces as a distinct
//     experimental-integration compatibility diagnosis, not a generic network
//     failure.
//
// It is deliberately free of HTTP routing (that stays in index.ts) and of
// bridge lifecycle/auth file handling (that stays in auth.ts). Code in this
// module must never forward credentials to an origin it did not receive them
// from, and must never scrape ChatGPT web surfaces or guess undocumented
// fallback protocol variants.
// =============================================================================

import {
  CODEX_COMPATIBILITY_CATEGORIES,
  isCodexCompatibilityFailure,
  type CodexCompatibilityFailure,
} from "../../shared/codex-compatibility.js";

// ---------------------------------------------------------------------------
// Protocol constants — centralize so they are updated in exactly one place.
// When the upstream Codex Responses API changes these values, bump them here
// and refresh the fixture corpus (see docs/hardening/codex-compatibility.md).
// ---------------------------------------------------------------------------

/** Supported upstream Responses-API protocol version identifier. */
export const CODEX_PROTOCOL_VERSION = "0.144.1";

/** User-Agent presented to the upstream ChatGPT backend. */
export const CODEX_USER_AGENT = `Codex/${CODEX_PROTOCOL_VERSION}`;

/** Originator header value expected by the upstream backend. */
export const CODEX_ORIGINATOR = "codex_exec";

/** Upstream Responses API endpoint (client_version is appended per request). */
export const CODEX_UPSTREAM_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

/** OAuth client identifier for ChatGPT token refresh. */
export const CODEX_OAUTH_CLIENT_ID = "app_EMoZ7jN3k6L7sD2m";

/** OAuth token refresh endpoint. */
export const CODEX_OAUTH_TOKEN_ENDPOINT = "https://auth.openai.com/oauth/token";

/** The default model slug used when the request omits an explicit model. */
export const CODEX_DEFAULT_MODEL = "gpt-5.6-sol";

/** Build the full upstream URL for a given client_version. */
export function codexResponsesUrl(version: string = CODEX_PROTOCOL_VERSION): string {
  return `${CODEX_UPSTREAM_ENDPOINT}?client_version=${version}`;
}

// ---------------------------------------------------------------------------
// Request translation — bridge OpenAI-compat body -> Codex Responses-API.
// ---------------------------------------------------------------------------

export interface CodexChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string | CodexContentPart[];
}

/** OpenAI-shaped content parts accepted from the web adapter (spec §7). */
export type CodexContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

/** Map one OpenAI-style part to the Responses API input-item shape (§7). */
export function toResponseApiPart(part: CodexContentPart): unknown {
  switch (part.type) {
    case "text":
      return { type: "input_text", text: part.text };
    case "image_url":
      return { type: "input_image", image_url: part.image_url.url };
    case "file":
      // Unreachable in practice: file parts are rejected with 415 before
      // translation ever runs (v1 has no Codex PDF path).
      return { type: "input_file", filename: part.file.filename, file_data: part.file.file_data };
  }
}

/**
 * Translate the bridge body into the upstream Responses-API body. Returns the
 * model slug, instructions, and input items. Called twice per request today
 * (streaming and non-streaming share translation but differ in `stream`).
 */
export function translateToCodexRequestBody(body: {
  model: string;
  messages: CodexChatMessageInput[];
}): { model: string; instructions: string; input: unknown[] } {
  // Collect ALL system messages in original order; each is converted with the
  // same content→instruction-text rule and joined. A single system message
  // therefore produces byte-identical instructions to the legacy behavior.
  const systemMsgs = body.messages.filter((m) => m.role === "system");
  const nonSystemMsgs = body.messages.filter((m) => m.role !== "system");

  const instructions =
    systemMsgs.length > 0
      ? systemMsgs
          .map((m) =>
            typeof m.content === "string"
              ? m.content
              : m.content
                  .filter(
                    (p): p is Extract<CodexContentPart, { type: "text" }> => p.type === "text",
                  )
                  .map((p) => p.text)
                  .join("\n"),
          )
          .join("\n\n")
      : "You are a helpful, rigorous assistant.";

  const modelSlug = body.model && body.model.length > 0 ? body.model : CODEX_DEFAULT_MODEL;

  const hasArrayContent = body.messages.some((m) => Array.isArray(m.content));

  let input: unknown[];
  if (hasArrayContent) {
    input = nonSystemMsgs.map((m) => ({
      type: "message",
      role: m.role === "assistant" ? "assistant" : "user",
      content: Array.isArray(m.content)
        ? m.content.map(toResponseApiPart)
        : [{ type: "input_text", text: m.content as string }],
    }));
    if (input.length === 0) {
      input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }];
    }
  } else {
    const inputPrompt = nonSystemMsgs
      .map((m) => {
        const text = typeof m.content === "string" ? m.content : "";
        return m.role === "user" ? text : `Assistant: ${text}`;
      })
      .join("\n\n");
    input = [{ role: "user", content: inputPrompt || "hello" }];
  }

  return { model: modelSlug, instructions, input };
}

// ---------------------------------------------------------------------------
// Upstream headers — centralize client metadata.
// ---------------------------------------------------------------------------

/** Build the upstream Authorization + client-metadata headers. */
export function buildUpstreamHeaders(data: {
  token: string;
  accountId?: string;
  version?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${data.token}`,
    "Content-Type": "application/json",
    "User-Agent": CODEX_USER_AGENT,
    version: data.version ?? CODEX_PROTOCOL_VERSION,
    Originator: CODEX_ORIGINATOR,
  };
  if (data.accountId) {
    headers["ChatGPT-Account-ID"] = data.accountId;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Upstream event parsing — known Codex SSE response-event forms.
// ---------------------------------------------------------------------------

export type CodexUpstreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "text_done"; text: string }
  | { type: "done" }
  | { type: "other"; payload: unknown };

/** Parse one `data:` SSE line payload into a known Codex event form. */
export function parseCodexSseEvent(payloadStr: string): CodexUpstreamEvent {
  if (payloadStr === "[DONE]") return { type: "done" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadStr);
  } catch {
    return { type: "other", payload: payloadStr };
  }
  // JSON primitives (null, string, number) and arrays must not crash the
  // parser: only non-null objects can carry event fields.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { type: "other", payload: parsed };
  }
  const obj = parsed as { type?: string; delta?: string; text?: string };
  if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") {
    return { type: "text_delta", delta: obj.delta };
  }
  if (obj.type === "response.output_text.done" && typeof obj.text === "string") {
    return { type: "text_done", text: obj.text };
  }
  return { type: "other", payload: parsed };
}

/**
 * Recognized Codex upstream terminal events (Plan 008 W/D - fixture contract):
 * the `[DONE]` sentinel and a `response.output_text.done` event both terminate
 * a stream. `response.output_text.done` also carries the final text and must be
 * used (not dropped) when no delta preceded it.
 */
export function isCodexTerminalEvent(evt: CodexUpstreamEvent): boolean {
  return evt.type === "done" || evt.type === "text_done";
}

// ---------------------------------------------------------------------------
// Failure classification — Plan 008 Workstream D step 5.
// ---------------------------------------------------------------------------

// Re-export the shared taxonomy so existing importers keep working; the
// shared module is the single source of truth for the accepted categories.
export type { CodexCompatibilityFailure };
export { CODEX_COMPATIBILITY_CATEGORIES, isCodexCompatibilityFailure };

export interface CodexCompatibilityDiagnosis {
  /** Present only when there is concrete evidence for a specific category. */
  category?: CodexCompatibilityFailure;
  /** Whether this is a definite diagnosis vs an indeterminate/unknown shape. */
  definite: boolean;
  reason: string;
}

function extractErrorText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === null || typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  // Accept {error:{message}} (OpenAI/bridge shape) or a flat {message}.
  const error = obj.error as Record<string, unknown> | undefined;
  const candidate =
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : typeof obj.message === "string"
        ? obj.message
        : "";
  return candidate;
}

/**
 * Evidence-based classification: do not emit a compatibility diagnosis merely
 * because an arbitrary status code occurred. A category is only produced when
 * the bounded upstream body carries evidence for it. Generic 429 (rate limit)
 * and generic 5xx therefore stay indeterminate (no category), instead of being
 * mislabelled as protocol_shape_changed / client_metadata_rejected.
 */
export function classifyCodexOutcome(args: {
  httpStatus: number | null;
  /** Bounded upstream error body text or parsed object (not redacted here;
   *  the classifier only extracts fixed category labels and never propagates
   *  body content). Used only for evidence extraction; never sent back to a
   *  client or logged. */
  upstreamErrorBody?: unknown;
  streamTerminatedUnexpectedly?: boolean;
}): CodexCompatibilityDiagnosis {
  const { httpStatus, upstreamErrorBody, streamTerminatedUnexpectedly = false } = args;

  if (streamTerminatedUnexpectedly) {
    return {
      category: "stream_terminated_unexpectedly",
      definite: true,
      reason: "Upstream stream ended before a recognized terminal event was observed.",
    };
  }

  if (httpStatus === null) {
    return {
      category: "bridge_unavailable",
      definite: true,
      reason: "The Codex bridge could not be reached.",
    };
  }

  const message = extractErrorText(upstreamErrorBody);

  // Concrete body evidence takes precedence. Categories must be evidenced by
  // the message, except 401/403 (auth) and 404 (model not found) which are
  // themselves specific, non-arbitrary statuses.
  if (
    /invalid.*(request|input|schema)|missing.*field|unexpected.*(type|field)|bad.*request/i.test(
      message,
    )
  ) {
    return {
      category: "protocol_shape_changed",
      definite: true,
      reason: "Upstream rejected the request shape; the Codex protocol may have changed.",
    };
  }
  if (
    /model/i.test(message) &&
    /(not found|not support|not supported|invalid|unavailable)/i.test(message)
  ) {
    return {
      category: "model_unavailable",
      definite: true,
      reason: "Upstream indicated the requested model is unavailable.",
    };
  }
  if (httpStatus === 404) {
    return {
      category: "model_unavailable",
      definite: true,
      reason: "The requested model could not be found upstream (HTTP 404).",
    };
  }
  if (/auth|login|token|expired|permission|access|unauthorized|forbidden/i.test(message)) {
    return {
      category: "auth_unavailable",
      definite: true,
      reason: "Upstream indicated an authentication problem.",
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      category: "auth_unavailable",
      definite: true,
      reason: `Upstream rejected the request with HTTP ${httpStatus}.`,
    };
  }
  // Client-metadata rejection must be evidenced by a version/User-Agent/
  // Originator/client-metadata message — not inferred from a 5xx.
  if (
    /client metadata|user.agent|originator|client version|unsupported.*version|version.*not (accepted|supported)|bad.*(client|metadata)/i.test(
      message,
    )
  ) {
    return {
      category: "client_metadata_rejected",
      definite: true,
      reason: "Upstream rejected the presented client metadata.",
    };
  }

  // No specific evidence (e.g. generic 429 or 5xx with a non-signal body):
  // omit the category rather than presenting a speculative diagnosis as fact.
  return {
    definite: false,
    reason: `Upstream returned an unexpected HTTP ${httpStatus} response.`,
  };
}
export const CODEX_FAILURE_LABELS: Record<CodexCompatibilityFailure, string> = {
  bridge_unavailable: "Codex bridge unavailable",
  auth_unavailable: "Codex not authenticated or token expired",
  model_unavailable: "Model unavailable upstream",
  protocol_shape_changed: "Codex protocol response shape changed",
  client_metadata_rejected: "Upstream rejected client metadata",
  stream_terminated_unexpectedly: "Codex stream terminated unexpectedly",
};
