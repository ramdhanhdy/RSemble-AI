// =============================================================================
// 9Router Provider Adapter (web → local bridge → 9Router upstream)
//
// 9Router exposes an OpenAI-compatible API. Browser requests route through
// RSemble's localhost bridge to avoid CORS and keep the upstream server-configured.
// The bridge forwards only GET /v1/models and POST /v1/chat/completions.
//
// A blank API key is valid when 9Router's requireApiKey setting is disabled.
// Readiness is established by a model-catalog probe, not key length.
// Model IDs are opaque router-native strings (namespaced, aliases, combos) and
// round-trip unchanged — RSemble does not split, rewrite, or infer providers.
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";
import type { LLMProvider } from "./types";

function getBridgeUrl(): string {
  return ((import.meta.env.VITE_CODEX_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:8787").replace(
    /\/$/,
    "",
  );
}

export const nineRouterProvider: LLMProvider = createOpenAICompatProvider({
  id: "9router",
  label: "9Router",
  baseUrl: getBridgeUrl(),
  envKey: "VITE_9ROUTER_KEY",
  storageKey: "rsemble.key.9router",
  modelsPath: "/9router/v1/models",
  completionsPath: "/9router/v1/chat/completions",
  apiKeyRequired: false,
  readinessProbe: "models",
});
