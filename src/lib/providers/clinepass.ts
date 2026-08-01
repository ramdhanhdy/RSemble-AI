// =============================================================================
// ClinePass Provider Adapter (web → local bridge → api.cline.bot)
// Cline's API is OpenAI-compatible, but does not permit credentialed browser
// CORS requests. The local bridge forwards requests to the official API.
// Docs: https://docs.cline.bot/api/overview
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";
import type { LLMProvider, ProviderReadiness } from "./types";

function getBridgeUrl(): string {
  return ((import.meta.env.VITE_CODEX_BRIDGE_URL as string | undefined) ?? "http://127.0.0.1:8787").replace(
    /\/$/,
    "",
  );
}

const base = createOpenAICompatProvider({
  id: "clinepass",
  label: "ClinePass",
  baseUrl: getBridgeUrl(),
  envKey: "VITE_CLINEPASS_KEY",
  storageKey: "rsemble.key.clinepass",
  modelsPath: "/clinepass/api/v1/models",
  completionsPath: "/clinepass/api/v1/chat/completions",
  supportsImages: true,
});

export const clinepassProvider: LLMProvider = {
  ...base,

  async readiness(signal?: AbortSignal): Promise<ProviderReadiness> {
    const keyStatus = await base.readiness(signal);
    if (!keyStatus.ok) return keyStatus;
    try {
      const res = await fetch(`${getBridgeUrl()}/health`, { signal });
      if (res.ok) return { ok: true };
      return {
        ok: false,
        reason: `Bridge returned HTTP ${res.status}. Start or restart npm run dev.`,
      };
    } catch {
      return {
        ok: false,
        reason: "Local bridge unreachable on 127.0.0.1:8787. ClinePass needs it for browser CORS. Start npm run dev.",
      };
    }
  },
};
