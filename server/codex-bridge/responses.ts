// =============================================================================
// Codex Bridge — Responses & Completions proxy with proven SSE translation
// =============================================================================

import http from "node:http";
import { once } from "node:events";
import { getValidToken } from "./auth.js";
import { sanitizeProviderErrorMessage } from "../../shared/error-policy.js";
import { readBoundedResponseText } from "../../shared/http.js";
import {
  codexResponsesUrl,
  translateToCodexRequestBody,
  buildUpstreamHeaders,
  parseCodexSseEvent,
  classifyCodexOutcome,
} from "./protocol.js";

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string | BridgeContentPart[];
}

/**
 * OpenAI-shaped content parts accepted from the web adapter (spec §7).
 * `{type:"file"}` is recognized but rejected with HTTP 415 — v1 has no Codex
 * PDF path (spec §7, plan 7.4.3).
 */
export type BridgeContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export interface CompletionRequestBody {
  model: string;
  messages: ChatMessageInput[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/** Default inactivity timeout for the upstream Codex request. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface CompletionDeps {
  /** Injectable token provider (defaults to auth.json based getValidToken). */
  getToken?: () => Promise<{ token: string; accountId?: string }>;
  /** Upstream connection/stream inactivity timeout in milliseconds. */
  upstreamTimeoutMs?: number;
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** Write a chunk, respecting backpressure: wait for drain when the buffer is full. */
async function writeChunk(res: http.ServerResponse, chunk: string): Promise<void> {
  const ok = res.write(chunk);
  if (!ok) {
    await once(res, "drain");
  }
}

export async function handleCompletions(
  reqBody: CompletionRequestBody,
  res: http.ServerResponse,
  deps: CompletionDeps = {},
): Promise<void> {
  const getToken = deps.getToken ?? getValidToken;
  const timeoutMs = deps.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;

  // Attachment-aware content translation (spec §7, plan 7.4.3). Two paths:
  // - All-string content: the legacy flattened input, byte-identical to what
  //   this bridge sent before attachments existed.
  // - Any ContentPart[]: per-message Responses API input items.
  // File parts have no Codex transport in v1 — reject with 415 (a message the
  // web adapter surfaces verbatim) before any upstream or auth work, so the
  // response does not depend on login state.
  const hasParts = reqBody.messages.some((m) => Array.isArray(m.content));

  if (hasParts) {
    for (const m of reqBody.messages) {
      if (!Array.isArray(m.content)) continue;
      const filePart = m.content.find((p) => p.type === "file");
      if (filePart) {
        sendJson(res, 415, {
          error: {
            message: `File attachments are not supported by the Codex bridge (v1): "${filePart.file.filename}". Convert the file to text or use a provider with PDF support.`,
            type: "unsupported_media_type",
          },
        });
        return;
      }
    }
  }

  let tokenData: { token: string; accountId?: string };
  try {
    tokenData = await getToken();
  } catch (err) {
    sendJson(res, 401, {
      error: {
        message: err instanceof Error ? err.message : "Not authenticated. Run 'codex login'.",
        type: "auth_error",
      },
    });
    return;
  }

  const { token, accountId } = tokenData;
  const targetUrl = codexResponsesUrl();
  const headers: Record<string, string> = buildUpstreamHeaders({ token, accountId });

  const clientWantsStream = Boolean(reqBody.stream);

  // Translate the bridge request into the upstream Codex Responses-API shape
  // (Plan 008 W/D: single protocol-translation authority).
  const { model: modelSlug, instructions, input } = translateToCodexRequestBody(reqBody);

  const upstreamBody = {
    model: modelSlug,
    instructions,
    input,
    store: false,
    stream: true,
  };

  const ctrl = new AbortController();
  let timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const resetUpstreamTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  };
  // If the client disconnects, stop the upstream request too.
  const handleClientClose = () => ctrl.abort();
  res.on("close", handleClientClose);

  try {
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamBody),
        signal: ctrl.signal,
      });
      // The request connected successfully. From here on, the timeout measures
      // upstream inactivity rather than total generation time.
      resetUpstreamTimeout();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (res.writableEnded) return; // client went away
        if (!res.headersSent) {
          sendJson(res, 504, {
            error: {
              message: `Upstream Codex request timed out after ${timeoutMs}ms.`,
              type: "upstream_timeout",
            },
          });
        }
        return;
      }
      throw err;
    }

    if (!upstreamRes.ok) {
      // Shared provider-error policy (review fix 3): recognized structured
      // messages are bounded and redacted; unknown JSON, plain text, and HTML
      // bodies become a generic status error. The raw upstream body never
      // reaches the response or logs.
      const raw = await readBoundedResponseText(upstreamRes).catch(() => "");
      const errorText = sanitizeProviderErrorMessage(raw, "Codex", upstreamRes.status);

      // Plan 008 W/D: classify protocol drift separately from a generic network
      // failure, using only the bounded-redacted body text as evidence. The
      // raw body never travels; only the classification label does, and only
      // when concrete evidence justifies a category.
      const diagnosis = classifyCodexOutcome({
        httpStatus: upstreamRes.status,
        upstreamErrorBody: raw,
      });

      sendJson(res, upstreamRes.status, {
        error: {
          message: errorText || `Codex request failed (HTTP ${upstreamRes.status}).`,
          type: "codex_error",
          ...(diagnosis.category ? { compatibility: diagnosis.category } : {}),
          status: upstreamRes.status,
        },
      });
      return;
    }

    if (clientWantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      if (upstreamRes.body) {
        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Plan 008 W/D: a raw upstream EOF without a recognized terminal
        // event is truncation, NOT a successful completion — do not forge a
        // [DONE] sentinel. Track terminal state explicitly.
        let sawAnyDelta = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            resetUpstreamTimeout();
            buffer += decoder.decode(value, { stream: true });

            let nl: number;
            while ((nl = buffer.indexOf("\n")) !== -1) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line || !line.startsWith("data:")) continue;

              const payloadStr = line.slice(5).trim();
              const evt = parseCodexSseEvent(payloadStr);
              if (evt.type === "done") {
                // [DONE] sentinel — recognized terminal.
                await writeChunk(res, "data: [DONE]\n\n");
                res.end();
                return;
              }
              if (evt.type === "text_done") {
                // response.output_text.done — recognized terminal that also
                // carries final text. Without a preceding delta, forward the
                // text so a done-only response does not lose content.
                if (!sawAnyDelta && typeof evt.text === "string" && evt.text.length > 0) {
                  const doneChunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelSlug,
                    choices: [{ index: 0, delta: { content: evt.text }, finish_reason: null }],
                  };
                  await writeChunk(res, `data: ${JSON.stringify(doneChunk)}\n\n`);
                }
                await writeChunk(res, "data: [DONE]\n\n");
                res.end();
                return;
              }
              if (evt.type === "text_delta") {
                sawAnyDelta = true;
                const sseChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model: modelSlug,
                  choices: [
                    {
                      index: 0,
                      delta: { content: evt.delta },
                      finish_reason: null,
                    },
                  ],
                };
                await writeChunk(res, `data: ${JSON.stringify(sseChunk)}\n\n`);
              }
            }
          }
        } catch (err) {
          // Headers already sent: cannot switch to a JSON error. End the
          // stream without a [DONE] so the web SSE reader surfaces truncation.
          if (err instanceof Error && err.name === "AbortError") {
            // Client disconnected or timeout — nothing useful left to send.
          }
          res.end();
          return;
        } finally {
          reader.releaseLock();
        }

        // Upstream EOF with NO recognized terminal event: truncation. End
        // without a [DONE] so the web-side SSE reader surfaces it.
        res.end();
        return;
      }
    }
    // Client requested non-streaming completion: accumulate text from stream.
    // Track whether a recognized terminal event (done sentinel or
    // response.output_text.done) was observed. Raw EOF without one is
    // truncation: return a sanitized stream_terminated_unexpectedly error,
    // never a fabricated successful completion.
    let fullText = "";
    let sawTerminal = false;
    let sawAnyContent = false;
    if (upstreamRes.body) {
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetUpstreamTimeout();
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line || !line.startsWith("data:")) continue;

            const payloadStr = line.slice(5).trim();
            const evt = parseCodexSseEvent(payloadStr);
            if (evt.type === "done") {
              sawTerminal = true;
              break;
            }
            if (evt.type === "text_delta") {
              sawAnyContent = true;
              fullText += evt.delta;
            } else if (evt.type === "text_done") {
              sawTerminal = true;
              // response.output_text.done carries final text; prefer it
              // when no delta preceded it so a done-only response keeps it.
              if (!sawAnyContent) {
                fullText = evt.text ?? "";
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    if (!sawTerminal) {
      // No recognized terminal event: the upstream stream was truncated.
      // Surface a sanitized compatibility error, not a successful body.
      const diagnosis = classifyCodexOutcome({
        httpStatus: 200,
        streamTerminatedUnexpectedly: true,
      });
      sendJson(res, 502, {
        error: {
          message: `${diagnosis.reason} The response may be incomplete.`,
          type: "codex_error",
          compatibility: "stream_terminated_unexpectedly",
          status: 502,
        },
      });
      return;
    }

    sendJson(res, 200, {
      id: `codex-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelSlug,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: fullText,
          },
          finish_reason: "stop",
        },
      ],
    });
  } catch (err) {
    // A bridge-internal failure is NOT an upstream compatibility diagnosis, so
    // it must not be mislabeled as bridge_unavailable (the bridge is reachable
    // but threw internally). Omit the compatibility field entirely.
    sendJson(res, 500, {
      error: {
        message: `Bridge error: ${err instanceof Error ? err.message : String(err)}`,
        type: "bridge_internal_error",
      },
    });
  } finally {
    clearTimeout(timeout);
    res.off("close", handleClientClose);
  }
}
