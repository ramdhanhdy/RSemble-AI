// =============================================================================
// 9Router proxy — allowlisted OpenAI-compatible upstream proxy.
//
// Forwards only GET /v1/models and POST /v1/chat/completions to a
// server-configured 9Router upstream (RSEMBLE_9ROUTER_URL). The browser cannot
// override the upstream. Reuses the shared handleOpenAICompatibleProxy for
// streaming/backpressure; this module owns only configuration and validation.
// =============================================================================
import type http from "node:http";
import { handleOpenAICompatibleProxy, type UmansProxyDeps } from "./umans.js";

const DEFAULT_UPSTREAM = "http://127.0.0.1:20128";

export interface NineRouterProxyDeps extends UmansProxyDeps {
  /** Override the upstream URL (testing). When omitted, reads RSEMBLE_9ROUTER_URL. */
  upstream?: string;
}

/**
 * Resolve and validate the 9Router upstream from RSEMBLE_9ROUTER_URL.
 * Throws on invalid scheme (only http/https allowed) or malformed URL.
 * Trailing slashes are stripped.
 */
export function configuredNineRouterUpstream(): string {
  const raw = (process.env.RSEMBLE_9ROUTER_URL ?? DEFAULT_UPSTREAM).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid RSEMBLE_9ROUTER_URL: configuration error (not a valid URL).`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid RSEMBLE_9ROUTER_URL: only http: and https: schemes are accepted.`);
  }
  // Strip trailing slash(es) but keep root path empty.
  const href = parsed.href.replace(/\/+$/, "");
  return href;
}

export function handleNineRouterProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathWithQuery: string,
  deps: NineRouterProxyDeps = {},
): Promise<void> {
  const upstream = deps.upstream ?? configuredNineRouterUpstream();
  return handleOpenAICompatibleProxy(req, res, pathWithQuery, {
    ...deps,
    upstream,
    routePrefix: "9router",
    providerLabel: "9Router",
  });
}
