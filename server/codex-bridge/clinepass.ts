import type http from "node:http";
import { handleOpenAICompatibleProxy, type UmansProxyDeps } from "./umans.js";

const CLINEPASS_UPSTREAM = "https://api.cline.bot";

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
