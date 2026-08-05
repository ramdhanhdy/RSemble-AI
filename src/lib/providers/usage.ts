import type { CostRecord, UsageBreakdown } from "./types";

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse OpenAI-compatible `usage` objects into the normalized breakdown. */
export function parseOpenAICompatibleUsage(raw: unknown): UsageBreakdown | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const usage = raw as Record<string, unknown>;
  const breakdown: UsageBreakdown = {
    inputTokens: finiteNonNegative(usage.prompt_tokens),
    outputTokens: finiteNonNegative(usage.completion_tokens),
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };
  const completionDetails = usage.completion_tokens_details;
  if (typeof completionDetails === "object" && completionDetails !== null) {
    breakdown.reasoningTokens = finiteNonNegative(
      (completionDetails as Record<string, unknown>).reasoning_tokens,
    );
  }
  const promptDetails = usage.prompt_tokens_details;
  if (typeof promptDetails === "object" && promptDetails !== null) {
    breakdown.cacheReadTokens = finiteNonNegative(
      (promptDetails as Record<string, unknown>).cached_tokens,
    );
  }
  const hasAny = Object.values(breakdown).some((value) => value !== null);
  return hasAny ? breakdown : null;
}

/** Parse a provider-reported `cost` field (USD) into a reported cost record. */
export function parseProviderReportedCost(raw: unknown): CostRecord | null {
  const usd = finiteNonNegative(raw);
  if (usd === null) return null;
  return { usd, source: "provider-reported" };
}
