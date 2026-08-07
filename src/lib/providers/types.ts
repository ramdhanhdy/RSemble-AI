// =============================================================================
// Provider contracts and shared interfaces
// =============================================================================

export type ProviderId =
  | "openrouter"
  | "chatgpt-codex"
  | "gemini"
  | "deepseek"
  | "commandcode"
  | "clinepass"
  | "umans"
  | "9router";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * One part of a multi-part message (spec §4, attachments plan 7.3.1).
 * - text: plain text segment
 * - image: base64 (no data-URL prefix) + mimeType
 * - file: base64 (no data-URL prefix) + mimeType + filename (PDFs and other binary docs)
 */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "file"; mimeType: string; data: string; filename: string };

export type ReasoningEffort =
  "provider-default" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "provider-default",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface ReasoningPolicy {
  candidates: ReasoningEffort;
  judge: ReasoningEffort;
}

export const DEFAULT_REASONING_POLICY: ReasoningPolicy = Object.freeze({
  candidates: "provider-default",
  judge: "provider-default",
});
export interface ReasoningSettingProvenance {
  requested: ReasoningEffort;
  effective: ReasoningEffort;
  source: ReasoningCapabilitySource;
}

export interface RunReasoningProvenance {
  candidates: Record<string, ReasoningSettingProvenance>;
  judge: ReasoningSettingProvenance;
}
export interface UsageBreakdown {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

/** Additive provenance for fallback input-usage accounting. */
export interface InputUsageEstimate {
  totalTokens: number | null;
  textTokens: number | null;
  method: "provider-reported" | "text-heuristic" | "provider-specific" | "unknown";
  partial: boolean;
  note?: string;
}

export type CostSource = "provider-reported" | "catalog-estimate" | "unknown";

export interface ModelPricingSnapshot {
  providerId: ProviderId;
  modelId: string;
  fetchedAt: number;
  inputPerToken: number | null;
  outputPerToken: number | null;
  reasoningPerToken: number | null;
  cacheReadPerToken: number | null;
  cacheWritePerToken: number | null;
  requestCostUsd: number | null;
  imagePerToken: number | null;
}

export interface CostRecord {
  usd: number | null;
  source: CostSource;
  pricingSnapshot?: ModelPricingSnapshot;
}

export interface ProviderCompletionResult {
  content: string;
  usage: UsageBreakdown | null;
  cost: CostRecord | null;
}

export interface ProviderStreamEvent {
  delta?: string;
  usage?: UsageBreakdown;
  cost?: CostRecord;
}
export type ReasoningCapabilitySource = "catalog" | "provider-docs" | "unknown";
export type ReasoningTransport = "openrouter" | "deepseek" | "gemini3" | "none";

export interface ModelReasoningCapabilities {
  supportedEfforts: readonly ReasoningEffort[];
  source: ReasoningCapabilitySource;
  transport: ReasoningTransport;
  aliases?: Partial<Record<ReasoningEffort, ReasoningEffort>>;
}

export type ReasoningResolution =
  | {
      ok: true;
      requested: ReasoningEffort;
      effective: ReasoningEffort;
      transport: ReasoningTransport;
      capabilities: ModelReasoningCapabilities;
    }
  | {
      ok: false;
      requested: ReasoningEffort;
      reason: string;
      capabilities: ModelReasoningCapabilities;
    };

export interface ChatOptions {
  /** Provider-native model id (not namespaced). */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Normalized effort; provider-default omits native reasoning fields. */
  reasoningEffort?: ReasoningEffort;
  /** Strict suite preflight rejects documented aliases/remaps. */
  reasoningStrict?: boolean;
  /** Paid-request clocks applied at the provider fetch boundary. */
  connectMs?: number;
  inactivityMs?: number;
  overallMs?: number;
  signal?: AbortSignal;
}

export interface CatalogModel {
  id: string;
  name: string;
  providerId: ProviderId;
  /** Exact provider-reported reasoning support, when the catalog exposes it. */
  reasoning?: ModelReasoningCapabilities;
  /** Exact provider pricing snapshot captured at catalog fetch time. */
  pricing?: ModelPricingSnapshot;
}

export type ProviderReadiness = { ok: true } | { ok: false; reason: string };

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** True when the adapter owns response-header and stream clocks at fetch. */
  readonly executionDeadlines?: boolean;

  /** Sync/async check: credentials + (for Codex) bridge reachability. */
  readiness(signal?: AbortSignal): ProviderReadiness | Promise<ProviderReadiness>;

  /** Verify an unsaved credential against a harmless authenticated endpoint. */
  testConnection?(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness>;

  chatCompletion(opts: ChatOptions): Promise<string>;

  /** Required for fanout live UI. Yields text deltas as they arrive. */
  chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown>;
  /** Optional native usage/cost path; legacy string API remains compatible. */
  chatCompletionDetailed?(opts: ChatOptions): Promise<ProviderCompletionResult>;
  /** Optional stream events carrying final usage/cost metadata. */
  chatCompletionStreamDetailed?(
    opts: ChatOptions,
  ): AsyncGenerator<ProviderStreamEvent, void, unknown>;

  listModels?(signal?: AbortSignal): Promise<CatalogModel[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: ProviderId,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Judge / synthesizer target ref. */
export interface CriticRef {
  providerId: ProviderId;
  model: string;
}
