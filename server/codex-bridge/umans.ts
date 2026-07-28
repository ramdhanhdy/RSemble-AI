// =============================================================================
// Umans upstream proxy
// api.code.umans.ai sends no CORS headers, so the web app cannot call it
// directly. Routes /umans/* → https://api.code.umans.ai/*, forwarding the
// caller's Authorization header and streaming SSE responses back.
// =============================================================================
import { once } from "node:events";
import type http from "node:http";

const UPSTREAM = "https://api.code.umans.ai";

/** Default timeout for upstream Umans requests. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface UmansProxyDeps {
  /** Upstream request timeout in milliseconds. */
  upstreamTimeoutMs?: number;
  /** Maximum bytes accepted before rejecting the proxy request. */
  maxBodyBytes?: number;
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

export async function handleUmansProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathName: string,
  deps: UmansProxyDeps = {},
): Promise<void> {
  const timeoutMs = deps.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const maxBodyBytes = deps.maxBodyBytes ?? 1 * 1024 * 1024;
  const upstreamUrl = `${UPSTREAM}${pathName.replace(/^\/umans/, "")}`;
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
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  res.on("close", () => ctrl.abort());

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization ?? "",
        "Content-Type": req.headers["content-type"] ?? "application/json",
        Accept: req.headers.accept ?? "application/json",
      },
      body,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      if (res.writableEnded) return; // client went away
      sendJson(res, 504, {
        error: {
          message: `Upstream Umans request timed out after ${timeoutMs}ms.`,
          type: "upstream_timeout",
        },
      });
      return;
    }
    sendJson(res, 502, { error: { message: "Could not reach api.code.umans.ai." } });
    return;
  }

  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
  });

  if (!upstream.body) {
    clearTimeout(timeout);
    res.end();
    return;
  }

  try {
    for await (const chunk of upstream.body) {
      const ok = res.write(chunk);
      if (!ok) {
        await once(res, "drain");
      }
    }
  } catch {
    // Client disconnected mid-stream or upstream aborted after headers sent —
    // cannot change the response now; just end it.
  } finally {
    clearTimeout(timeout);
    res.end();
  }
}
