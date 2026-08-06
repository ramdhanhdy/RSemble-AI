// =============================================================================
// Codex Bridge — HTTP Server (127.0.0.1 only)
//
// Plan 003 workstreams B/C: every route is an exact method/path entry in a
// route table; unknown paths 404 without touching any handler or upstream;
// `RSEMBLE_BRIDGE_SECRET` is enforced on every credential-bearing route when
// configured (Plan 002 decision D3).
// =============================================================================
import http from "node:http";
import { getAuthStatus } from "./auth.js";
import { handleClinePassProxy } from "./clinepass.js";
import { handleNineRouterProxy } from "./nine-router.js";
import { CODEX_MODELS } from "./models.js";
import { handleCompletions, type CompletionRequestBody } from "./responses.js";
import { handleUmansProxy } from "./umans.js";
import { BRIDGE_SERVICE, listenOrReuseBridge } from "./startup.js";
import { BRIDGE_MAX_BODY_BYTES } from "../../shared/limits.js";

const PORT = Number.parseInt(process.env.RSEMBLE_CODEX_BRIDGE_PORT || "8787", 10);
const HOST = "127.0.0.1";

/** Request-authentication header (Plan 002 D3). */
export const BRIDGE_SECRET_HEADER = "X-RSemble-Bridge-Secret";

/** The configured bridge secret, trimmed; "" when unconfigured. */
export function configuredBridgeSecret(): string {
  return (process.env.RSEMBLE_BRIDGE_SECRET ?? "").trim();
}

/**
 * Length-independent string comparison: no early exit on the first differing
 * character, so timing does not reveal prefix matches (Plan 002 D3).
 */
export function safeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Maximum accepted JSON body size for POST endpoints (Plan 002 D4): the bridge
 * ceiling for the encoded (base64 + JSON) attachment payloads the UI may admit.
 */
export const DEFAULT_MAX_BODY_BYTES = BRIDGE_MAX_BODY_BYTES;

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
    ? configured
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
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
  // Advertise the bridge-secret header so browser preflight permits it.
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Title, X-Requested-With, X-RSemble-Bridge-Secret",
  );
  return true;
}

function isApplicationJson(req: http.IncomingMessage): boolean {
  return (
    (req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase() === "application/json"
  );
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
          error: {
            message: `Request body exceeds the ${maxBytes}-byte limit. Attachment payloads are base64-encoded (about 1.37x raw size); reduce the size or number of attached files.`,
            type: "request_too_large",
          },
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

// ---------------------------------------------------------------------------
// Route table — Plan 003 workstream B
// ---------------------------------------------------------------------------

interface BridgeRoute {
  publicPath: string;
  method: "GET" | "POST";
  handler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathWithQuery: string,
    options: BridgeServerOptions,
  ) => void;
  auth: "public" | "bridge-secret";
  contentType?: "application/json";
}

function sendAuthRequired(res: http.ServerResponse, invalid: boolean): void {
  sendJson(res, 401, {
    error: {
      message: invalid ? "Invalid bridge secret." : "Missing X-RSemble-Bridge-Secret header.",
      type: invalid ? "bridge_auth_invalid" : "bridge_auth_required",
    },
  });
}

export function createBridgeServer(options: BridgeServerOptions = {}): http.Server {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const allowedOrigins = new Set(options.allowedOrigins ?? configuredAllowedOrigins());
  const secret = configuredBridgeSecret();

  const routes: BridgeRoute[] = [
    {
      publicPath: "/health",
      method: "GET",
      auth: "public",
      handler: (_req, res) => {
        sendJson(res, 200, {
          status: "ok",
          service: BRIDGE_SERVICE,
          // Attachment capability flag for the web adapter's capability cache
          // (spec §7, plan 7.4.4): the Codex backend takes Responses-API
          // input_image data URLs, but has no PDF (file) path in v1.
          capabilities: { image: true, pdf: false },
        });
      },
    },
    {
      publicPath: "/auth/status",
      method: "GET",
      auth: "public",
      handler: (_req, res) => {
        sendJson(res, 200, getAuthStatus());
      },
    },
    {
      publicPath: "/v1/models",
      method: "GET",
      auth: "bridge-secret",
      handler: (_req, res) => {
        sendJson(res, 200, { data: CODEX_MODELS });
      },
    },
    {
      publicPath: "/v1/chat/completions",
      method: "POST",
      auth: "bridge-secret",
      contentType: "application/json",
      handler: (req, res) => {
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
      },
    },
    {
      publicPath: "/9router/v1/models",
      method: "GET",
      auth: "bridge-secret",
      handler: (req, res, pathWithQuery) => {
        void handleNineRouterProxy(req, res, pathWithQuery, { maxBodyBytes });
      },
    },
    {
      publicPath: "/9router/v1/chat/completions",
      method: "POST",
      auth: "bridge-secret",
      contentType: "application/json",
      handler: (req, res, pathWithQuery) => {
        void handleNineRouterProxy(req, res, pathWithQuery, { maxBodyBytes });
      },
    },
    {
      publicPath: "/umans/v1/models",
      method: "GET",
      auth: "bridge-secret",
      handler: (req, res, pathWithQuery) => {
        void handleUmansProxy(req, res, pathWithQuery, { maxBodyBytes });
      },
    },
    {
      publicPath: "/umans/v1/chat/completions",
      method: "POST",
      auth: "bridge-secret",
      contentType: "application/json",
      handler: (req, res, pathWithQuery) => {
        void handleUmansProxy(req, res, pathWithQuery, { maxBodyBytes });
      },
    },
    {
      publicPath: "/clinepass/v1/models",
      method: "GET",
      auth: "bridge-secret",
      handler: (req, res, pathWithQuery) => {
        void handleClinePassProxy(req, res, pathWithQuery, { maxBodyBytes });
      },
    },
    {
      publicPath: "/clinepass/v1/chat/completions",
      method: "POST",
      auth: "bridge-secret",
      contentType: "application/json",
      handler: (req, res, pathWithQuery) => {
        void handleClinePassProxy(req, res, pathWithQuery, { maxBodyBytes });
      },
    },
  ];

  const routeFor = (pathname: string): BridgeRoute | undefined =>
    routes.find((route) => route.publicPath === pathname);

  return http.createServer((req, res) => {
    if (!setCorsHeaders(req, res, allowedOrigins)) {
      sendJson(res, 403, {
        error: { message: "Browser origin is not allowed.", type: "origin_not_allowed" },
      });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const pathName = url.pathname;
    const route = routeFor(pathName);

    // Unknown paths never reach a handler or upstream (Plan 003 B).
    if (!route) {
      sendJson(res, 404, { error: { message: `Not found: ${req.method} ${pathName}` } });
      return;
    }

    // Known path with wrong method: exact Allow header (Plan 003 B).
    if (req.method !== route.method) {
      res.setHeader("Allow", `${route.method}, OPTIONS`);
      sendJson(res, 405, {
        error: { message: `Method not allowed: ${req.method}`, type: "method_not_allowed" },
      });
      return;
    }

    if (route.contentType && !isApplicationJson(req)) {
      sendJson(res, 415, {
        error: {
          message: "Content-Type must be application/json.",
          type: "unsupported_media_type",
        },
      });
      return;
    }

    // Bridge authentication runs before body reading and before any upstream
    // contact (Plan 002 D3).
    if (route.auth === "bridge-secret" && secret.length > 0) {
      const supplied = req.headers[BRIDGE_SECRET_HEADER.toLowerCase()];
      const value = typeof supplied === "string" ? supplied : "";
      if (value.length === 0) {
        sendAuthRequired(res, false);
        return;
      }
      if (!safeEqual(value, secret)) {
        sendAuthRequired(res, true);
        return;
      }
    }

    route.handler(req, res, `${pathName}${url.search}`, { maxBodyBytes });
  });
}

/* v8 ignore next 7 -- entrypoint guard: only auto-listen when run directly */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalized = entry.replace(/\\/g, "/");
  return (
    normalized.endsWith("server/codex-bridge/index.ts") ||
    normalized.endsWith("server/codex-bridge/index.js")
  );
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
