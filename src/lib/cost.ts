import { getModelPricing } from "./providers/pricing";
import { contentToText } from "./providers/content";
import type { ChatMessage, ContentPart, CostRecord, InputUsageEstimate, ModelPricingSnapshot, ProviderId, UsageBreakdown } from "./providers/types";

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

export interface UsageEstimate {
  inputTokens: number | null;
  outputTokens: number | null;
  method: "text-heuristic" | "provider-specific" | "unknown";
  note?: string;
}

export interface MessageInputEstimate extends UsageEstimate {
  /** Text tokens are useful partial evidence, but native media is not text. */
  textTokens: number;
  hasNativeMedia: boolean;
}

/**
 * Normalize provider-neutral message content for accounting. ContentPart
 * arrays are traversed explicitly: text parts are counted, image/file bytes are
 * never stringified or treated as prompt text. When native media is present and
 * no provider-reported usage exists, the textual portion is only partial
 * evidence and the total input token count remains unknown.
 */
export function estimateMessageInput(messages: ChatMessage[]): MessageInputEstimate {
  const text = messages.map((message) => contentToText(message.content)).join("\n");
  const hasNativeMedia = messages.some((message) =>
    Array.isArray(message.content) && message.content.some(
      (part: ContentPart) => part.type === "image" || part.type === "file",
    ),
  );
  const textTokens = estimateTokens(text);
  return {
    inputTokens: hasNativeMedia ? null : textTokens,
    outputTokens: null,
    textTokens,
    hasNativeMedia,
    method: "text-heuristic",
    ...(hasNativeMedia
      ? { note: "Text-only partial estimate; native media contribution is unknown." }
      : {}),
  };
}


/** Resolve one authoritative input-usage provenance record. */
export function inputUsageEstimate(
  messages: ChatMessage[],
  usage?: UsageBreakdown | null,
): InputUsageEstimate {
  const estimate = estimateMessageInput(messages);
  const textTokens = estimate.textTokens;
  if (usage && usage.inputTokens !== null) {
    return {
      totalTokens: usage.inputTokens,
      textTokens,
      method: "provider-reported",
      partial: false,
      note: estimate.hasNativeMedia ? "Provider-reported total includes native media." : undefined,
    };
  }
  if (estimate.hasNativeMedia) {
    return {
      totalTokens: null,
      textTokens,
      method: usage ? "unknown" : "text-heuristic",
      partial: true,
      note: "Text-only estimate; native media usage is unknown.",
    };
  }
  if (usage) {
    return {
      totalTokens: null,
      textTokens,
      method: "unknown",
      partial: estimate.hasNativeMedia,
      note: estimate.hasNativeMedia
        ? "Text-only estimate; native media usage is unknown."
        : "Provider did not report input usage.",
    };
  }
  return { totalTokens: textTokens, textTokens, method: "text-heuristic", partial: false, note: "Estimated from textual content." };
}

/** Render authoritative/fallback input usage without implying unknown media is zero. */
export function inputUsageLabel(
  estimate: InputUsageEstimate | undefined,
  legacyTokensIn?: number | null,
): string {
  if (estimate) {
    const tokens = estimate.totalTokens ?? estimate.textTokens;
    const formatted = tokens == null ? null : Math.round(tokens).toLocaleString("en-US");
    if (estimate.method === "provider-reported" && estimate.totalTokens != null) {
      return `Input: ${formatted} tokens — provider reported`;
    }
    if (estimate.method === "text-heuristic" && estimate.partial) {
      return formatted
        ? `Text estimate: ~${formatted} tokens — partial; media usage unknown`
        : "Input usage: Unknown";
    }
    if (estimate.method === "text-heuristic") {
      return formatted ? `Input estimate: ~${formatted} tokens — text heuristic` : "Input usage: Unknown";
    }
    if (estimate.method === "provider-specific") {
      return formatted ? `Input estimate: ~${formatted} tokens — provider-specific` : "Input usage: Unknown";
    }
    return "Input usage: Unknown";
  }
  if (legacyTokensIn != null) return `Input: ${Math.round(legacyTokensIn).toLocaleString("en-US")} tokens`;
  return "Input usage: Unknown";
}

/**
 * Estimate only extracted textual attachment content. Native image/file input
 * has no provider-neutral token formula and therefore contributes Unknown, not
 * a fabricated tile/page or byte count. A natively delivered PDF's extracted
 * text is not counted again.
 */
export function estimateAttachmentTokens(
  attachments: { kind: string; text?: string; data?: string }[],
): number {
  return attachments.reduce((total, attachment) => {
    if (attachment.kind === "image") return total;
    // Extracted PDF text is useful partial evidence for text-capable routes;
    // native file contribution remains Unknown and execution-time messages
    // decide whether text is actually withheld to avoid double counting.
    return total + (attachment.text ? estimateTokens(attachment.text) : 0);
  }, 0);
}

export interface AttachmentInputEstimate {
  textTokens: number;
  hasUnknownMedia: boolean;
  note?: string;
}

export function estimateAttachmentInput(
  attachments: { kind: string; text?: string; data?: string }[],
): AttachmentInputEstimate {
  const textTokens = estimateAttachmentTokens(attachments);
  const hasUnknownMedia = attachments.some((a) =>
    (a.kind === "image" || a.kind === "pdf") && typeof a.data === "string",
  );
  return {
    textTokens,
    hasUnknownMedia,
    ...(hasUnknownMedia
      ? { note: "Native media pricing/usage is unknown until the provider reports it." }
      : {}),
  };
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
  // A missing token component is Unknown, never an implicit zero. Even when a
  // request fee is known, the complete total cannot be represented precisely.
  if (usage.inputTokens === null || usage.outputTokens === null) {
    return { usd: null, source: "unknown", pricingSnapshot: { ...snapshot } };
  }
  const input = usage.inputTokens;
  const output = usage.outputTokens;
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
    /** True when native media is present without a provider-specific estimator. */
    mediaUnknown?: boolean;
  } = {},
): RunCostEstimate {
  const tokensIn = estimateTokens(prompt) + attachmentTokens;
  const perModel: PerModelCost[] = slugs.map((slug) => {
    const tokensOut = Math.round(tokensIn * 1.5);
    const tokens = tokensIn + tokensOut;
    const costUsd = options.mediaUnknown
      ? null
      : options.providerIds
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
  let partial = hasNull || judgeCostUsd === null || options.mediaUnknown === true;
  if (options.mediaUnknown === true) totalCostUsd = null;
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
