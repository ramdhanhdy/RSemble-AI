import type http from "node:http";
import { handleOpenAICompatibleProxy, type UmansProxyDeps } from "./umans.js";

// The bridge public path is /clinepass/v1/* (exact allowlist, Plan 003 B);
// the official Cline API surface sits under /api/v1/*, so the upstream base
// includes the /api segment.
const CLINEPASS_UPSTREAM = "https://api.cline.bot/api";

export function handleClinePassProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathName: string,
  deps: UmansProxyDeps = {},
): Promise<void> {
  return handleOpenAICompatibleProxy(req, res, pathName, {
    ...deps,
    upstream: CLINEPASS_UPSTREAM,
    routePrefix: "clinepass",
    providerLabel: "ClinePass",
  });
}
