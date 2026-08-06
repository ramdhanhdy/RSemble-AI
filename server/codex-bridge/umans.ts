// =============================================================================
// Hardened OpenAI-compatible upstream proxy
// Used for APIs that do not permit credentialed browser CORS requests.
// =============================================================================
import { once } from "node:events";
import type http from "node:http";
import {
  initialSseTerminationState,
  inspectOpenAiSseChunk,
  finalizeOpenAiSseState,
  shouldAppendDone,
  DONE_SENTINEL,
} from "./sse-termination.js";

const UMANS_UPSTREAM = "https://api.code.umans.ai";

/** Default timeout for proxied upstream requests. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface UmansProxyDeps {
  /** Upstream request timeout in milliseconds. */
  upstreamTimeoutMs?: number;
  /** Maximum bytes accepted before rejecting the proxy request. */
  maxBodyBytes?: number;
}

export interface OpenAIProxyDeps extends UmansProxyDeps {
  upstream: string;
  routePrefix: string;
  providerLabel: string;
  /** When true, append `data: [DONE]` after a clean content-bearing SSE EOF
   *  that lacks the sentinel. Enabled only for 9Router (spec §9). */
  normalizeCleanSseEof?: boolean;
}

function readBody(req: http.IncomingMessage, res: http.ServerResponse, maxBytes: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > maxBytes) {
        settled = true;
        sendJson(res, 413, {
          error: { message: `Request body exceeds the ${maxBytes}-byte limit.`, type: "request_too_large" },
        });
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

export async function handleOpenAICompatibleProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathName: string,
  deps: OpenAIProxyDeps,
): Promise<void> {
  const timeoutMs = deps.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const maxBodyBytes = deps.maxBodyBytes ?? 1 * 1024 * 1024;
  const upstreamUrl = `${deps.upstream}${pathName.replace(new RegExp(`^/${deps.routePrefix}`), "")}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let body: string | undefined;
  try {
    const bodyResult = hasBody ? await readBody(req, res, maxBodyBytes) : undefined;
    if (bodyResult === null) return;
    body = bodyResult;
  } catch (err) {
    sendJson(res, 400, {
      error: { message: `Request body error: ${err instanceof Error ? err.message : String(err)}`, type: "invalid_request" },
    });
    return;
  }

  const ctrl = new AbortController();
  let responseClosed = false;
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => ctrl.abort(), timeoutMs);
  const clearUpstreamTimeout = () => {
    if (timeout === null) return;
    clearTimeout(timeout);
    timeout = null;
  };
  const resetTimeout = () => {
    if (responseClosed || ctrl.signal.aborted) {
      clearUpstreamTimeout();
      return;
    }
    if (timeout !== null) clearTimeout(timeout);
    timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  };
  // A browser navigating away must not leave a watchdog alive until the full
  // timeout. Abort the upstream and clear the timer immediately; cleanup in
  // finally also removes this listener on every normal/error path.
  const onResponseClose = () => {
    responseClosed = true;
    clearUpstreamTimeout();
    ctrl.abort();
  };
  res.once("close", onResponseClose);
  const cleanup = () => {
    clearUpstreamTimeout();
    res.removeListener("close", onResponseClose);
  };

  // Build upstream headers — omit Authorization entirely when blank so we
  // never send "Authorization: Bearer " to an optional-auth upstream.
  const upstreamHeaders: Record<string, string> = {
    "Content-Type": req.headers["content-type"] ?? "application/json",
    Accept: req.headers.accept ?? "application/json",
    "X-Title": "RSemble AI",
  };
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  if (auth) upstreamHeaders.Authorization = auth;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body,
      signal: ctrl.signal,
      redirect: "manual",
    });
    if (responseClosed) {
      cleanup();
      return;
    }
    // After headers, the same request clock becomes a stream-inactivity
    // watchdog and resets only when upstream bytes arrive. Healthy long SSE
    // responses therefore survive indefinitely while a stalled stream ends.
    resetTimeout();
  } catch (err) {
    cleanup();
    if (err instanceof Error && err.name === "AbortError") {
      if (res.writableEnded) return;
      sendJson(res, 504, {
        error: {
          message: `Upstream ${deps.providerLabel} request timed out after ${timeoutMs}ms.`,
          type: "upstream_timeout",
        },
      });
      return;
    }
    const host = new URL(deps.upstream).host;
    sendJson(res, 502, { error: { message: `Could not reach ${host}.` } });
    return;
  }

  // Reject upstream redirects — never follow with credentials to a different origin.
  if (upstream.status >= 300 && upstream.status < 400) {
    cleanup();
    sendJson(res, 502, {
      error: {
        message: `Upstream ${deps.providerLabel} returned a redirect — refusing to follow.`,
        type: "upstream_redirect",
      },
    });
    return;
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const isSse = contentType.includes("text/event-stream");
  const normalize = deps.normalizeCleanSseEof === true && isSse;
  let sseState = normalize ? initialSseTerminationState() : null;
  let needsSseSeparator = false;
  let completedNormally = false;

  res.writeHead(upstream.status, { "Content-Type": contentType });

  if (!upstream.body) {
    cleanup();
    res.end();
    return;
  }

  try {
    for await (const chunk of upstream.body) {
      resetTimeout();
      if (sseState) {
        sseState = inspectOpenAiSseChunk(sseState, chunk as Uint8Array);
      }
      const ok = res.write(chunk);
      if (!ok) await once(res, "drain");
    }
    if (sseState && sseState.pending.length > 0) {
      needsSseSeparator = true;
      sseState = finalizeOpenAiSseState(sseState);
    }
    completedNormally = true;
  } catch {
    // Client disconnected or upstream aborted after headers were sent.
    completedNormally = false;
  } finally {
    cleanup();
    if (sseState && completedNormally && !res.writableEnded) {
      if (needsSseSeparator) res.write("\n\n");
      if (shouldAppendDone(sseState, true)) res.write(DONE_SENTINEL);
    }
    res.end();
  }
}

export function handleUmansProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathName: string,
  deps: UmansProxyDeps = {},
): Promise<void> {
  return handleOpenAICompatibleProxy(req, res, pathName, {
    ...deps,
    upstream: UMANS_UPSTREAM,
    routePrefix: "umans",
    providerLabel: "Umans",
  });
}
