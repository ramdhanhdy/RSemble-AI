export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
}

export const PRICING: Record<string, ModelPricing> = {
  "glm-5.2": { inputPerM: 0.6, outputPerM: 2.2 },
  deepseek: { inputPerM: 0.27, outputPerM: 1.1 },
  minimax: { inputPerM: 0.7, outputPerM: 2.8 },
  "gpt-5.6": { inputPerM: 1.25, outputPerM: 5.0 },
  gemini: { inputPerM: 0.3, outputPerM: 1.2 },
};

export function pricingFor(modelSlug: string): ModelPricing | null {
  const slug = modelSlug.toLowerCase();
  for (const key of Object.keys(PRICING)) {
    if (slug.includes(key.toLowerCase())) return PRICING[key];
  }
  return null;
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

export function estimateCost(
  tokensIn: number,
  tokensOut: number,
  modelSlug: string
): number | null {
  const p = pricingFor(modelSlug);
  if (!p) return null;
  const costIn = (tokensIn / 1_000_000) * p.inputPerM;
  const costOut = (tokensOut / 1_000_000) * p.outputPerM;
  return costIn + costOut;
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
}

export function estimateRunCost(
  prompt: string,
  slugs: string[],
  attachmentTokens = 0,
): RunCostEstimate {
  const tokensIn = estimateTokens(prompt) + attachmentTokens;
  const perModel: PerModelCost[] = slugs.map((slug) => {
    const tokensOut = Math.round(tokensIn * 1.5);
    const tokens = tokensIn + tokensOut;
    const costUsd = estimateCost(tokensIn, tokensOut, slug);
    return { slug, tokens, costUsd };
  });
  const totalTokens = perModel.reduce((sum, m) => sum + m.tokens, 0);
  const hasNull = perModel.some((m) => m.costUsd === null);
  const totalCostUsd = hasNull
    ? null
    : perModel.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
  return { totalTokens, totalCostUsd, perModel };
}

export function estimateRunTime(slugs: string[]): number {
  if (slugs.length === 0) return 0;
  return 8 + 6;
}
