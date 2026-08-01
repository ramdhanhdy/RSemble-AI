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

/** Provider-wide fallback for uniform-capability bridges (e.g. Codex). */
const providerDefaults = new Map<ProviderId, ModelCapabilities>();

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
 * Record a provider-wide capability set used when no per-model entry exists.
 * For bridges that serve one uniform backend (Codex), the `/health` capability
 * flag applies to every model it lists (plan 7.4.4). Per-model entries always
 * take precedence.
 */
export function setProviderCapabilities(providerId: ProviderId, caps: ModelCapabilities): void {
  providerDefaults.set(providerId, { image: caps.image, pdf: caps.pdf });
}

/**
 * Look up capabilities for a model. Per-model records win; otherwise the
 * provider-wide default (if recorded) applies; otherwise
 * `UNKNOWN_CAPABILITIES` ({ image: false, pdf: false }).
 */
export function getModelCapabilities(providerId: ProviderId, slug: string): ModelCapabilities {
  return cache.get(cacheKey(providerId, slug)) ?? providerDefaults.get(providerId) ?? UNKNOWN_CAPABILITIES;
}

/** Test hook: wipe the cache between cases. */
export function clearModelCapabilities(): void {
  cache.clear();
  providerDefaults.clear();
}
