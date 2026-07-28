// =============================================================================
// OpenRouter client shim (re-exports from providers registry & utils)
// =============================================================================

export { openrouterProvider as default } from "./providers/openrouter";
export type { CatalogModel as OpenRouterModel } from "./providers/types";
export { extractJson, errorMessage } from "./llm-utils";
