// =============================================================================
// ClinePass Provider Adapter
// OpenAI-compatible — https://api.cline.bot/api/v1
// Docs: https://docs.cline.bot/api/models
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";

export const clinepassProvider = createOpenAICompatProvider({
  id: "clinepass",
  label: "ClinePass",
  baseUrl: "https://api.cline.bot",
  envKey: "VITE_CLINEPASS_KEY",
  storageKey: "rsemble.key.clinepass",
  modelsPath: "/api/v1/models",
  completionsPath: "/api/v1/chat/completions",
});
