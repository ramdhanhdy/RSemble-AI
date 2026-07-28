// =============================================================================
// Provider Registry
// =============================================================================

import { chatgptCodexProvider } from "./chatgpt-codex";
import { clinepassProvider } from "./clinepass";
import { commandcodeProvider } from "./commandcode";
import { geminiProvider } from "./gemini";
import { openrouterProvider } from "./openrouter";
import { umansProvider } from "./umans";
import type { LLMProvider, ProviderId, ProviderReadiness } from "./types";

const providers: Record<ProviderId, LLMProvider> = {
  openrouter: openrouterProvider,
  "chatgpt-codex": chatgptCodexProvider,
  gemini: geminiProvider,
  commandcode: commandcodeProvider,
  clinepass: clinepassProvider,
  umans: umansProvider,
};

export function getProvider(id: ProviderId): LLMProvider {
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Unknown provider id: ${id}`);
  }
  return provider;
}

export function listProviders(): LLMProvider[] {
  return [
    providers.openrouter,
    providers["chatgpt-codex"],
    providers.gemini,
    providers.commandcode,
    providers.clinepass,
    providers.umans,
  ];
}

export async function getProviderReadiness(id: ProviderId): Promise<ProviderReadiness> {
  const provider = getProvider(id);
  return await provider.readiness();
}

export function isProviderReadySync(id: ProviderId): boolean {
  const provider = getProvider(id);
  const status = provider.readiness();
  if (status instanceof Promise || "then" in status) {
    return false;
  }
  return status.ok;
}
