// =============================================================================
// Codex Bridge — Model Catalog
// =============================================================================

export interface CodexModel {
  id: string;
  name: string;
  providerId: "chatgpt-codex";
}

export const CODEX_MODELS: CodexModel[] = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (Codex)", providerId: "chatgpt-codex" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra (Codex)", providerId: "chatgpt-codex" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna (Codex)", providerId: "chatgpt-codex" },
  { id: "gpt-5.5", name: "GPT-5.5 (Codex)", providerId: "chatgpt-codex" },
  { id: "gpt-5.4", name: "GPT-5.4 (Codex)", providerId: "chatgpt-codex" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini (Codex)", providerId: "chatgpt-codex" },
];
