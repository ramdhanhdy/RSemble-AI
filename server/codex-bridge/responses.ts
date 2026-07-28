// =============================================================================
// Codex Bridge — Responses & Completions proxy with proven SSE translation
// =============================================================================

import http from "node:http";
import { once } from "node:events";
import { getValidToken } from "./auth.js";

export interface ChatMessageInput {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequestBody {
  model: string;
  messages: ChatMessageInput[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/** Default timeout for the upstream Codex request. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface CompletionDeps {
  /** Injectable token provider (defaults to auth.json based getValidToken). */
  getToken?: () => Promise<{ token: string; accountId?: string }>;
  /** Upstream request timeout in milliseconds. */
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

  const instructions = systemMsg ? systemMsg.content : "You are a helpful, rigorous assistant.";
  const inputPrompt = nonSystemMsgs
    .map((m) => (m.role === "user" ? m.content : `Assistant: ${m.content}`))
    .join("\n\n");

  const modelSlug = reqBody.model && reqBody.model.length > 0 ? reqBody.model : "gpt-5.6-sol";

  const upstreamBody = {
    model: modelSlug,
    instructions,
    input: [{ role: "user", content: inputPrompt || "hello" }],
    store: false,
    stream: true,
  };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  // If the client disconnects, stop the upstream request too.
  res.on("close", () => ctrl.abort());

  try {
    let upstreamRes: Response;
    try {
      upstreamRes = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamBody),
        signal: ctrl.signal,
      });
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
      let errorText = "";
      try {
        const json = (await upstreamRes.json()) as {
          error?: { message?: string };
          detail?: string;
        };
        errorText = json?.error?.message || json?.detail || JSON.stringify(json);
      } catch {
        errorText = await upstreamRes.text().catch(() => "Upstream error");
      }

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
                if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
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
              if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
                fullText += parsed.delta;
              } else if (parsed.type === "response.output_text.done" && typeof parsed.text === "string" && fullText.length === 0) {
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
  }
}
