// =============================================================================
// Provider-neutral LLM utilities & error handling
// =============================================================================

import { ProviderError } from "./providers/types";

/** Best-effort extraction of a JSON object from a model response (handles ```json fences). */
export function extractJson<T>(text: string): T {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const jsonStr = match ? match[1].trim() : text.trim();
  return JSON.parse(jsonStr) as T;
}

/** Extract a human-readable message from any error shape. */
export function errorMessage(err: unknown): string {
  if (err instanceof ProviderError) {
    return err.message;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Request was cancelled.";
    }
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "An unexpected error occurred.";
}
