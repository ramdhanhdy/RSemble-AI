// =============================================================================
// Model capability registry — attachments plan 7.3.2
//
// Tracks which models can accept image and/or PDF (file) input. Populated
// opportunistically from `listModels` (e.g. OpenRouter `architecture.input_modalities`)
// and from bridge `/health` (Codex). Unknown models default to the conservative
// { image: false, pdf: false } so the UI can gate attachment transport safely.
// =============================================================================

import type { ProviderId } from "./types";

export interface ModelCapabilities {
  image: boolean;
  pdf: boolean;
}

/** Conservative default for any model we have no evidence about. */
export const UNKNOWN_CAPABILITIES: ModelCapabilities = Object.freeze({
  image: false,
  pdf: false,
});

const cache = new Map<string, ModelCapabilities>();

function cacheKey(providerId: ProviderId, slug: string): string {
  return `${providerId}:${slug}`;
}

/** Record (or overwrite) capabilities for one model. */
export function setModelCapabilities(
  providerId: ProviderId,
  slug: string,
  caps: ModelCapabilities
): void {
  cache.set(cacheKey(providerId, slug), { image: caps.image, pdf: caps.pdf });
}

/**
 * Look up capabilities for a model. Returns `UNKNOWN_CAPABILITIES`
 * ({ image: false, pdf: false }) when nothing has been recorded.
 */
export function getModelCapabilities(providerId: ProviderId, slug: string): ModelCapabilities {
  return cache.get(cacheKey(providerId, slug)) ?? UNKNOWN_CAPABILITIES;
}

/** Test hook: wipe the cache between cases. */
export function clearModelCapabilities(): void {
  cache.clear();
}
