// =============================================================================
// Codex Bridge — HTTP Server (127.0.0.1 only)
// =============================================================================
import http from "node:http";
import { getAuthStatus } from "./auth.js";
import { handleClinePassProxy } from "./clinepass.js";
import { handleNineRouterProxy } from "./nine-router.js";
import { CODEX_MODELS } from "./models.js";
import { handleCompletions, type CompletionRequestBody } from "./responses.js";
import { handleUmansProxy } from "./umans.js";
import { BRIDGE_SERVICE, listenOrReuseBridge } from "./startup.js";

const PORT = Number.parseInt(process.env.RSEMBLE_CODEX_BRIDGE_PORT || "8787", 10);
const HOST = "127.0.0.1";

/**
 * Default maximum accepted JSON body size for POST endpoints (48 MiB).
 * Raised from 1 MiB for attachment payloads (plan 7.4.3): attachment bytes
 * travel as base64 (≈1.37× raw), so the effective raw cap for a 40 MB task
 * is ~54 MB of body — 48 MB keeps a hard ceiling just under that.
 */
export const DEFAULT_MAX_BODY_BYTES = 48 * 1024 * 1024;

export interface BridgeServerOptions {
  /** Maximum bytes accepted for a JSON request body before 413. */
  maxBodyBytes?: number;
  /** Exact browser origins permitted to call the bridge. No-Origin clients remain supported. */
  allowedOrigins?: readonly string[];
}

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

function configuredAllowedOrigins(): readonly string[] {
  const configured = process.env.RSEMBLE_BRIDGE_ALLOWED_ORIGINS;
  return configured
    ? configured.split(",").map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;
}

function setCorsHeaders(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  const origin = req.headers.origin;
  res.setHeader("Vary", "Origin");
  if (origin && !allowedOrigins.has(origin)) return false;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Title, X-Requested-With");
  return true;
}

function isApplicationJson(req: http.IncomingMessage): boolean {
  return (req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Read a request body with a hard byte cap and proper error rejection.
 * Resolves `null` when the body exceeded the limit (response already sent).
 */
function readJsonBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxBytes: number,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let bodyText = "";
    let settled = false;
    req.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      bodyText += chunk;
      if (Buffer.byteLength(bodyText) > maxBytes) {
        settled = true;
        sendJson(res, 413, {
          error: {
            message: `Request body exceeds the ${maxBytes}-byte limit. Attachment payloads are base64-encoded (about 1.37x raw size); reduce the size or number of attached files.`,
            type: "request_too_large",
          },
        });
        req.destroy();
        resolve(null);
      }
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(bodyText);
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

export function createBridgeServer(options: BridgeServerOptions = {}): http.Server {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allowedOrigins = new Set(options.allowedOrigins ?? configuredAllowedOrigins());

  return http.createServer((req, res) => {
    if (!setCorsHeaders(req, res, allowedOrigins)) {
      sendJson(res, 403, { error: { message: "Browser origin is not allowed.", type: "origin_not_allowed" } });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathName = url.pathname;

    // 9Router — exact path allowlist with per-path method enforcement.
    // Unknown /9router/* paths fall through to the 404 at the end.
    if (pathName === "/9router/v1/models") {
      if (req.method !== "GET") {
        res.setHeader("Allow", "GET, OPTIONS");
        sendJson(res, 405, { error: { message: `Method not allowed: ${req.method}`, type: "method_not_allowed" } });
        return;
      }
      void handleNineRouterProxy(req, res, `${pathName}${url.search}`, { maxBodyBytes });
      return;
    }
    if (pathName === "/9router/v1/chat/completions") {
      if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");
        sendJson(res, 405, { error: { message: `Method not allowed: ${req.method}`, type: "method_not_allowed" } });
        return;
      }
      if (!isApplicationJson(req)) {
        sendJson(res, 415, { error: { message: "Content-Type must be application/json.", type: "unsupported_media_type" } });
        return;
      }
      void handleNineRouterProxy(req, res, `${pathName}${url.search}`, { maxBodyBytes });
      return;
    }

    const proxyHandler = pathName.startsWith("/umans/")
      ? handleUmansProxy
      : pathName.startsWith("/clinepass/")
        ? handleClinePassProxy
        : null;
    if (proxyHandler) {
      if (req.method !== "GET" && req.method !== "POST") {
        res.setHeader("Allow", "GET, POST, OPTIONS");
        sendJson(res, 405, { error: { message: `Method not allowed: ${req.method}`, type: "method_not_allowed" } });
        return;
      }
      if (req.method === "POST" && !isApplicationJson(req)) {
        sendJson(res, 415, { error: { message: "Content-Type must be application/json.", type: "unsupported_media_type" } });
        return;
      }
      void proxyHandler(req, res, `${pathName}${url.search}`, { maxBodyBytes });
      return;
    }

    if (req.method === "GET" && pathName === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: BRIDGE_SERVICE,
        // Attachment capability flag for the web adapter's capability cache
        // (spec §7, plan 7.4.4): the Codex backend takes Responses-API
        // input_image data URLs, but has no PDF (file) path in v1.
        capabilities: { image: true, pdf: false },
      });
      return;
    }

    if (req.method === "GET" && pathName === "/auth/status") {
      sendJson(res, 200, getAuthStatus());
      return;
    }

    if (req.method === "GET" && pathName === "/v1/models") {
      sendJson(res, 200, { data: CODEX_MODELS });
      return;
    }

    if (req.method === "POST" && pathName === "/v1/chat/completions") {
      if (!isApplicationJson(req)) {
        sendJson(res, 415, { error: { message: "Content-Type must be application/json.", type: "unsupported_media_type" } });
        return;
      }
      void (async () => {
        let bodyText: string | null;
        try {
          bodyText = await readJsonBody(req, res, maxBodyBytes);
        } catch (err) {
          sendJson(res, 400, {
            error: {
              message: `Request body error: ${err instanceof Error ? err.message : String(err)}`,
              type: "invalid_request",
            },
          });
          return;
        }
        if (bodyText === null) return; // 413 already sent
        try {
          const body = JSON.parse(bodyText) as CompletionRequestBody;
          await handleCompletions(body, res);
        } catch (err) {
          sendJson(res, 400, {
            error: {
              message: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
              type: "invalid_request",
            },
          });
        }
      })();
      return;
    }

    sendJson(res, 404, { error: { message: `Not found: ${req.method} ${pathName}` } });
  });
}

/* v8 ignore next 7 -- entrypoint guard: only auto-listen when run directly */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalized = entry.replace(/\\/g, "/");
  return normalized.endsWith("server/codex-bridge/index.ts") ||
    normalized.endsWith("server/codex-bridge/index.js");
})();

if (invokedDirectly) {
  const server = createBridgeServer();
  void listenOrReuseBridge(server, HOST, PORT)
    .then((result) => {
      if (result === "listening") {
        console.log(`[Codex Bridge] Listening on http://${HOST}:${PORT}`);
      } else {
        console.log(`[Codex Bridge] Reusing existing bridge on http://${HOST}:${PORT}`);
      }
    })
    .catch((error: Error & { code?: string }) => {
      if (error.code === "EADDRINUSE") {
        console.error(
          `[Codex Bridge] Port ${PORT} is occupied by a service that is not a compatible RSemble bridge.`,
        );
      } else {
        console.error(`[Codex Bridge] Failed to listen on http://${HOST}:${PORT}:`, error);
      }
      process.exitCode = 1;
    });
}
