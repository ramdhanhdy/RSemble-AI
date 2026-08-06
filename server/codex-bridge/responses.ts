// =============================================================================
// Codex Bridge — Responses & Completions proxy with proven SSE translation
// =============================================================================

import http from "node:http";
import { once } from "node:events";
import { getValidToken } from "./auth.js";
import { sanitizeProviderErrorMessage } from "../../shared/error-policy.js";
import { readBoundedResponseText } from "../../shared/http.js";

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

/**
 * Map one OpenAI-style part to the Responses API input-item shape (spec §7):
 * `input_text` for text, `input_image` with a data URL for images. File parts
 * are rejected with 415 before translation ever runs.
 */
function toResponseApiPart(part: BridgeContentPart): unknown {
  switch (part.type) {
    case "text":
      return { type: "input_text", text: part.text };
    case "image_url":
      return { type: "input_image", image_url: part.image_url.url };
    case "file":
      // Unreachable: file parts are rejected with 415 above translation.
      return { type: "input_file", filename: part.file.filename, file_data: part.file.file_data };
  }
}

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
  const targetUrl = "https://chatgpt.com/backend-api/codex/responses?client_version=0.144.1";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Codex/0.144.1",
    version: "0.144.1",
    Originator: "codex_exec",
  };
  if (accountId) {
    headers["ChatGPT-Account-ID"] = accountId;
  }

  const clientWantsStream = Boolean(reqBody.stream);

  // Separate system prompt from non-system messages
  const systemMsg = reqBody.messages.find((m) => m.role === "system");
  const nonSystemMsgs = reqBody.messages.filter((m) => m.role !== "system");

  const instructions = systemMsg
    ? typeof systemMsg.content === "string"
      ? systemMsg.content
      : systemMsg.content
          .filter((p): p is Extract<BridgeContentPart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n")
    : "You are a helpful, rigorous assistant.";

  const modelSlug = reqBody.model && reqBody.model.length > 0 ? reqBody.model : "gpt-5.6-sol";

  let input: unknown[];
  if (hasParts) {
    input = nonSystemMsgs.map((m) => ({
      type: "message",
      role: m.role === "assistant" ? "assistant" : "user",
      content: Array.isArray(m.content)
        ? m.content.map(toResponseApiPart)
        : [{ type: "input_text", text: m.content }],
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

      sendJson(res, upstreamRes.status, {
        error: {
          message: errorText || `Codex request failed (HTTP ${upstreamRes.status}).`,
          type: "codex_error",
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
              if (payloadStr === "[DONE]") {
                await writeChunk(res, "data: [DONE]\n\n");
                res.end();
                return;
              }

              try {
                const parsed = JSON.parse(payloadStr) as {
                  type?: string;
                  delta?: string;
                  text?: string;
                };
                if (
                  parsed.type === "response.output_text.delta" &&
                  typeof parsed.delta === "string"
                ) {
                  const sseChunk = {
                    id: `chatcmpl-${Date.now()}`,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: modelSlug,
                    choices: [
                      {
                        index: 0,
                        delta: { content: parsed.delta },
                        finish_reason: null,
                      },
                    ],
                  };
                  await writeChunk(res, `data: ${JSON.stringify(sseChunk)}\n\n`);
                }
              } catch {
                // Buffer incomplete JSON payload across chunk boundaries
              }
            }
          }
        } catch (err) {
          // Headers already sent: cannot switch to a JSON error. End the stream
          // so the client's SSE reader surfaces the truncation instead of hanging.
          if (err instanceof Error && err.name === "AbortError") {
            // Client disconnected or timeout — nothing useful left to send.
          }
          res.end();
          return;
        } finally {
          reader.releaseLock();
        }
      }
      await writeChunk(res, "data: [DONE]\n\n");
      res.end();
      return;
    }

    // Client requested non-streaming completion: accumulate text from stream
    let fullText = "";
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
            if (payloadStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(payloadStr) as {
                type?: string;
                delta?: string;
                text?: string;
              };
              if (
                parsed.type === "response.output_text.delta" &&
                typeof parsed.delta === "string"
              ) {
                fullText += parsed.delta;
              } else if (
                parsed.type === "response.output_text.done" &&
                typeof parsed.text === "string" &&
                fullText.length === 0
              ) {
                fullText = parsed.text;
              }
            } catch {
              // Ignore partial JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
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
