// =============================================================================
// CommandCode Provider Adapter
// OpenAI-compatible — https://api.commandcode.ai/provider/v1
// Docs: https://commandcode.ai/docs/provider
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";

export const commandcodeProvider = createOpenAICompatProvider({
  id: "commandcode",
  label: "CommandCode",
  baseUrl: "https://api.commandcode.ai",
  envKey: "VITE_COMMANDCODE_KEY",
  storageKey: "rsemble.key.commandcode",
  modelsPath: "/provider/v1/models",
  completionsPath: "/provider/v1/chat/completions",
});
