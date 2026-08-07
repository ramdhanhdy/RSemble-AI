// =============================================================================
// RSemble AI — Execution cost resolution (provider-agnostic)
//
// Resolves the reported/estimated/unknown cost provenance for a single provider
// stage (candidate, judge, or fusion). Extracted from run-executor (Plan 007
// Workstream B) so the fallback rule is a single, unit-testable pure function:
// catalog-estimate only when an exact execution-time price is known; otherwise
// an Unknown record — never a fabricated total (spec 06 §4).
// =============================================================================

import { costFromSnapshot } from "./cost";
import { getModelPricing } from "./providers/pricing";
import type { CostRecord, ProviderId } from "./providers/types";

/**
 * Honest fallback when a provider omits native usage/cost (spec 06 §4):
 * catalog-estimate only when an exact execution-time price is known, otherwise
 * an Unknown record — never a fabricated total.
 */
export function estimateFallbackCost(
  providerId: string,
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
): CostRecord {
  const snapshot = getModelPricing(providerId as ProviderId, model);
  const estimated = costFromSnapshot(snapshot ?? undefined, {
    inputTokens: tokensIn,
    outputTokens: tokensOut,
  });
  return estimated ?? { usd: null, source: "unknown" };
}
