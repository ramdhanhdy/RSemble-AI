// =============================================================================
// DeepSeek Provider Adapter
// OpenAI-compatible — https://api.deepseek.com
// The API echoes the request Origin in CORS preflight (verified 2026-08), so
// browser-direct credentialed requests work without the local bridge.
// Docs: https://api-docs.deepseek.com/
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";

export const deepseekProvider = createOpenAICompatProvider({
  id: "deepseek",
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  envKey: "VITE_DEEPSEEK_KEY",
  storageKey: "rsemble.key.deepseek",
  modelsPath: "/models",
  completionsPath: "/chat/completions",
  // DeepSeek's chat API is text-only; leave image transport off until the
  // catalog exposes authoritative per-model vision declarations.
  supportsImages: false,
});
