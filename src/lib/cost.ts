import { getModelPricing } from "./providers/pricing";
import type { CostRecord, ModelPricingSnapshot, ProviderId } from "./providers/types";

export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
}

/**
 * Exact provider-scoped pricing from the live catalog snapshot. Returns null
 * when the provider/model pair has no catalog price — never a substring guess.
 * Static forecast fallbacks are NOT historical truth; see `pricingFor`.
 */
export function pricingFor(providerId: ProviderId, modelId: string): ModelPricing | null {
  const snapshot = getModelPricing(providerId, modelId);
  if (!snapshot || snapshot.inputPerToken === null || snapshot.outputPerToken === null) {
    return null;
  }
  return {
    inputPerM: snapshot.inputPerToken * 1_000_000,
    outputPerM: snapshot.outputPerToken * 1_000_000,
  };
}

/** Legacy signature used by RunButton/ModelList; resolves through the registry. */
export function pricingForSlug(providerId: ProviderId, modelId: string): ModelPricing | null {
  return pricingFor(providerId, modelId);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Approximate token contribution of attachments (spec §9, plan 7.5.4).
 * Provider-agnostic: extracted text uses the existing char heuristic, images
 * use the tile formula ceil(w/512)×ceil(h/512)×170 + 85, native PDFs use
 * pages × 1500. A kind with no estimate data contributes 0 (unknown, not a
 * guess).
 */
export function estimateAttachmentTokens(
  attachments: { kind: string; text?: string; width?: number; height?: number; pages?: number }[]
): number {
  let total = 0;
  for (const a of attachments) {
    if (a.kind === "image") {
      const w = a.width ?? 0;
      const h = a.height ?? 0;
      if (w > 0 && h > 0) {
        total += Math.ceil(w / 512) * Math.ceil(h / 512) * 170 + 85;
      }
    } else if (a.kind === "pdf") {
      const pages = a.pages ?? 0;
      total += pages > 0 ? pages * 1500 : a.text ? estimateTokens(a.text) : 0;
    } else if (a.text) {
      total += estimateTokens(a.text);
    }
  }
  return total;
}

/**
 * Estimated cost from exact catalog pricing when known, else null. This is a
 * forecast only; persisted costs are captured at request time via CostRecord.
 */
export function estimateCost(
  tokensIn: number,
  tokensOut: number,
  providerId: ProviderId,
  modelId: string
): number | null {
  const p = pricingFor(providerId, modelId);
  if (!p) return null;
  const costIn = (tokensIn / 1_000_000) * p.inputPerM;
  const costOut = (tokensOut / 1_000_000) * p.outputPerM;
  return costIn + costOut;
}

/** Historical truth: cost from a pricing snapshot captured at request time. */
export function costFromSnapshot(
  snapshot: ModelPricingSnapshot | undefined,
  usage: { inputTokens: number | null; outputTokens: number | null } | null,
): CostRecord | null {
  if (!snapshot || !usage) return null;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const inputCost = snapshot.inputPerToken !== null ? input * snapshot.inputPerToken : null;
  const outputCost = snapshot.outputPerToken !== null ? output * snapshot.outputPerToken : null;
  const requestCost = snapshot.requestCostUsd ?? null;
  const components = [inputCost, outputCost, requestCost];
  if (components.every((c) => c === null)) return null;
  const usd = components.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  return { usd, source: "catalog-estimate", pricingSnapshot: { ...snapshot } };
}

export interface PerModelCost {
  slug: string;
  tokens: number;
  costUsd: number | null;
}

export interface RunCostEstimate {
  totalTokens: number;
  totalCostUsd: number | null;
  perModel: PerModelCost[];
  /** When any priced stage is missing, the total is partial, not complete. */
  partial: boolean;
}

/**
 * Forecast candidates + one Judge + (in Fuse mode) one Fusion call. Missing
 * price components produce a partial/unknown label, never a false total.
 */
export function estimateRunCost(
  prompt: string,
  slugs: string[],
  attachmentTokens = 0,
  options: {
    providerIds?: Record<string, ProviderId>;
    mode?: "rank" | "fuse";
    judgeProvider?: ProviderId;
    judgeModel?: string;
  } = {},
): RunCostEstimate {
  const tokensIn = estimateTokens(prompt) + attachmentTokens;
  const perModel: PerModelCost[] = slugs.map((slug) => {
    const tokensOut = Math.round(tokensIn * 1.5);
    const tokens = tokensIn + tokensOut;
    const costUsd = options.providerIds
      ? estimateCost(tokensIn, tokensOut, options.providerIds[slug] ?? "openrouter", slug)
      : null;
    return { slug, tokens, costUsd };
  });
  let totalTokens = perModel.reduce((sum, m) => sum + m.tokens, 0);
  const hasNull = perModel.some((m) => m.costUsd === null);
  let totalCostUsd = hasNull
    ? null
    : perModel.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);

  // Judge: one call at ~1/3 of a candidate's token weight (conservative).
  const judgeTokens = Math.round(tokensIn * 0.4);
  const judgeCostUsd = options.judgeProvider
    ? estimateCost(judgeTokens, judgeTokens, options.judgeProvider, options.judgeModel ?? "")
    : null;
  let partial = hasNull || judgeCostUsd === null;
  if (totalCostUsd !== null && judgeCostUsd !== null) totalCostUsd += judgeCostUsd;
  totalTokens += judgeTokens;

  if (options.mode === "fuse") {
    const fusionTokens = Math.round(tokensIn * 0.3);
    const fusionCostUsd = options.judgeProvider
      ? estimateCost(fusionTokens, fusionTokens, options.judgeProvider, options.judgeModel ?? "")
      : null;
    if (fusionCostUsd === null) partial = true;
    else if (totalCostUsd !== null) totalCostUsd += fusionCostUsd;
    totalTokens += fusionTokens;
  }

  return { totalTokens, totalCostUsd, perModel, partial };
}

export function estimateRunTime(slugs: string[]): number {
  if (slugs.length === 0) return 0;
  return 8 + 6;
}
