// =============================================================================
// Umans Provider Adapter (web → local bridge → api.code.umans.ai)
// The Umans API sends no CORS headers, so requests route through the local
// bridge (npm run dev:bridge), same as ChatGPT (Codex).
// Docs: https://app.umans.ai/offers/code/docs
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";
import { DEFAULT_PROVIDER_DEADLINE_POLICY } from "../execution-deadline";
import type { LLMProvider, ProviderReadiness } from "./types";
import { BRIDGE_MAX_BODY_BYTES } from "../../../shared/limits";
import { providerAbortError } from "../execution-deadline";

function getBridgeUrl(): string {
  return ((import.meta.env.VITE_CODEX_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:8787").replace(
    /\/$/,
    ""
  );
}

const base = createOpenAICompatProvider({
  id: "umans",
  label: "Umans",
  baseUrl: getBridgeUrl(),
  envKey: "VITE_UMANS_KEY",
  modelsPath: "/umans/v1/models",
  completionsPath: "/umans/v1/chat/completions",
  supportsImages: true,
  bridgeSecret: true,
  bridgeBodyLimitBytes: BRIDGE_MAX_BODY_BYTES,
  deadlines: DEFAULT_PROVIDER_DEADLINE_POLICY,
});

export const umansProvider: LLMProvider = {
  ...base,

  async readiness(signal?: AbortSignal): Promise<ProviderReadiness> {
    const keyStatus = await base.readiness(signal);
    if (!keyStatus.ok) return keyStatus;
    try {
      const res = await fetch(`${getBridgeUrl()}/health`, { signal });
      if (res.ok) return { ok: true };
      return {
        ok: false,
        reason: `Bridge returned HTTP ${res.status}. Check bridge server (npm run dev:bridge).`,
      };
    } catch (err) {
      const abort = providerAbortError(err, signal);
      if (abort !== null) throw abort;
      return {
        ok: false,
        reason: "Local bridge unreachable on 127.0.0.1:8787. Umans needs it for CORS. Start it (npm run dev:bridge).",
      };
    }
  },
};
