// =============================================================================
// Provider contracts and shared interfaces
// =============================================================================

export type ProviderId = "openrouter" | "chatgpt-codex" | "gemini" | "commandcode" | "clinepass" | "umans" | "9router";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Provider-native model id (not namespaced). */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CatalogModel {
  id: string;
  name: string;
  providerId: ProviderId;
}

export type ProviderReadiness =
  | { ok: true }
  | { ok: false; reason: string };

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;

  /** Sync/async check: credentials + (for Codex) bridge reachability. */
  readiness(signal?: AbortSignal): ProviderReadiness | Promise<ProviderReadiness>;

  /** Verify an unsaved credential against a harmless authenticated endpoint. */
  testConnection?(apiKey: string, signal?: AbortSignal): Promise<ProviderReadiness>;

  chatCompletion(opts: ChatOptions): Promise<string>;

  /**
   * Required for fanout live UI. Yields text deltas as they arrive.
   */
  chatCompletionStream(opts: ChatOptions): AsyncGenerator<string, void, unknown>;

  listModels?(signal?: AbortSignal): Promise<CatalogModel[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: ProviderId,
    public readonly status?: number
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
