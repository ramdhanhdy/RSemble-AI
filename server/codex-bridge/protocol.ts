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

// ---------------------------------------------------------------------------
// Protocol constants — centralize so they are updated in exactly one place.
// When the upstream Codex Responses API changes these values, bump them here
// and refresh the fixture corpus (see docs/hardening/codex-compatibility.md).
// ---------------------------------------------------------------------------

/** Supported upstream Responses-API protocol version identifier. */
export const CODEX_PROTOCOL_VERSION = "0.144.1";

/** User-Agent presented to the upstream chtags backend. */
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
  const systemMsg = body.messages.find((m) => m.role === "system");
  const nonSystemMsgs = body.messages.filter((m) => m.role !== "system");

  const instructions = systemMsg
    ? typeof systemMsg.content === "string"
      ? systemMsg.content
      : systemMsg.content
          .filter((p): p is Extract<CodexContentPart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n")
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
  const obj = parsed as { type?: string; delta?: string; text?: string };
  if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") {
    return { type: "text_delta", delta: obj.delta };
  }
  if (obj.type === "response.output_text.done" && typeof obj.text === "string") {
    return { type: "text_done", text: obj.text };
  }
  return { type: "other", payload: parsed };
}

// ---------------------------------------------------------------------------
// Failure classification — Plan 008 Workstream D step 5.
// ---------------------------------------------------------------------------

export type CodexCompatibilityFailure =
  | "bridge_unavailable"
  | "auth_unavailable"
  | "model_unavailable"
  | "protocol_shape_changed"
  | "client_metadata_rejected"
  | "stream_terminated_unexpectedly";

export interface CodexCompatibilityDiagnosis {
  category: CodexCompatibilityFailure;
  /** Whether this is a definite diagnosis vs an indeterminate/unknown shape. */
  definite: boolean;
  reason: string;
}

/**
 * Classify a bridge-side error into a Codex compatibility diagnosis. The
 * earliest, most specific match wins; upstream HTTP status is surface evidence
 * only and is combined with the sanitized upstream body shape.
 */
export function classifyCodexOutcome(args: {
  httpStatus: number | null;
  upstreamErrorBody?: unknown;
  streamTerminatedUnexpectedly?: boolean;
}): CodexCompatibilityDiagnosis {
  const { httpStatus, upstreamErrorBody, streamTerminatedUnexpectedly = false } = args;

  if (streamTerminatedUnexpectedly) {
    return {
      category: "stream_terminated_unexpectedly",
      definite: true,
      reason: "Upstream stream ended before a terminal event was observed.",
    };
  }

  if (httpStatus === null) {
    return {
      category: "bridge_unavailable",
      definite: true,
      reason: "The Codex bridge could not be reached.",
    };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      category: "auth_unavailable",
      definite: true,
      reason: `Upstream rejected the request with HTTP ${httpStatus}.`,
    };
  }

  if (httpStatus === 404) {
    return {
      category: "model_unavailable",
      definite: true,
      reason: "The requested model could not be found upstream.",
    };
  }

  if (httpStatus === 400 && looksLikeProtocolShapeChange(upstreamErrorBody)) {
    return {
      category: "protocol_shape_changed",
      definite: true,
      reason: "Upstream rejected the request shape; the Codex protocol may have changed.",
    };
  }

  return {
    category: deriveFromBody(httpStatus, upstreamErrorBody),
    definite: false,
    reason: `Upstream returned an unexpected HTTP ${httpStatus} response.`,
  };
}

function looksLikeProtocolShapeChange(body: unknown): boolean {
  if (body === null || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.error === "object" &&
    obj.error !== null &&
    typeof (obj.error as Record<string, unknown>).message === "string" &&
    /(invalid.*(request|input|schema)|missing.*field|unexpected.*(type|field)|bad.*request)/i.test(
      String((obj.error as Record<string, unknown>).message),
    )
  );
}

function deriveFromBody(httpStatus: number | null, body?: unknown): CodexCompatibilityFailure {
  if (body === null || typeof body !== "object") {
    return httpStatus !== null && httpStatus >= 500
      ? "client_metadata_rejected"
      : "protocol_shape_changed";
  }
  const obj = body as Record<string, unknown>;
  const error = obj.error as Record<string, unknown> | undefined;
  const raw = error && typeof error === "object" ? error : obj;
  const message = String(raw.message ?? "").toLowerCase();
  if (/model/.test(message) && /(not found|not support|invalid|unavailable)/.test(message)) {
    return "model_unavailable";
  }
  if (/auth|login|token|expired|permission|access/.test(message)) {
    return "auth_unavailable";
  }
  if (/client metadata|user.agent|version/.test(message)) {
    return "client_metadata_rejected";
  }
  if (httpStatus !== null && httpStatus >= 500) return "client_metadata_rejected";
  return "protocol_shape_changed";
}

/** A stable, human-readable label for each failure category. */
export const CODEX_FAILURE_LABELS: Record<CodexCompatibilityFailure, string> = {
  bridge_unavailable: "Codex bridge unavailable",
  auth_unavailable: "Codex not authenticated or token expired",
  model_unavailable: "Model unavailable upstream",
  protocol_shape_changed: "Codex protocol response shape changed",
  client_metadata_rejected: "Upstream rejected client metadata",
  stream_terminated_unexpectedly: "Codex stream terminated unexpectedly",
};
