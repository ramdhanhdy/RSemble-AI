// =============================================================================
// CommandCode Provider Adapter
// OpenAI-compatible — https://api.commandcode.ai/provider/v1
// Docs: https://commandcode.ai/docs/provider
// =============================================================================

import { createOpenAICompatProvider } from "./openai-compat";
import { DEFAULT_PROVIDER_DEADLINE_POLICY } from "../execution-deadline";

export const commandcodeProvider = createOpenAICompatProvider({
  id: "commandcode",
  label: "CommandCode",
  baseUrl: "https://api.commandcode.ai",
  envKey: "VITE_COMMANDCODE_KEY",
  storageKey: "rsemble.key.commandcode",
  modelsPath: "/provider/v1/models",
  completionsPath: "/provider/v1/chat/completions",
  supportsImages: true,
  deadlines: DEFAULT_PROVIDER_DEADLINE_POLICY,
});
