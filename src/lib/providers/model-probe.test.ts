// =============================================================================
// model-probe.test.ts — contract tests for exact model-route probes (Task 1.4)
//
// The wished-for API:
//   probeModelRoute({ provider, providerId, model, now, timeoutMs })
// sends one short user message through the real streaming adapter using the
// exact model slug, temperature 0, maxTokens 8, and returns a structured,
// sanitized ModelProbeState.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeModelRoute } from "./model-probe";
import { type LLMProvider, type ProviderId, ProviderError } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: "9router" as ProviderId,
    label: "9Router",
    readiness: () => ({ ok: true }),
    chatCompletion: vi.fn(async () => "OK"),
    chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
      yield "OK";
    }),
    ...overrides,
  };
}

describe("probeModelRoute — contract", () => {
  it("uses the exact model slug through the streaming adapter", async () => {
    const stream = vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
      yield "OK";
    });
    const provider = makeProvider({ chatCompletionStream: stream });

    await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(stream).toHaveBeenCalledTimes(1);
    const call = stream.mock.calls[0] as unknown as [
      { model: string; temperature?: number; maxTokens?: number },
    ];
    expect(call[0].model).toBe("cmc/model");
  });

  it("requests temperature 0 and enough output budget for reasoning routes to reach final content", async () => {
    const stream = vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
      yield "OK";
    });
    const provider = makeProvider({ chatCompletionStream: stream });

    await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    const call = stream.mock.calls[0] as unknown as [
      { model: string; temperature?: number; maxTokens?: number },
    ];
    expect(call[0].temperature).toBe(0);
    expect(call[0].maxTokens).toBe(128);
  });

  it("consumes the streaming iterator to completion", async () => {
    let yieldCount = 0;
    const stream = vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
      yield "O";
      yield "K";
      yieldCount++;
    });
    const provider = makeProvider({ chatCompletionStream: stream });

    await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(yieldCount).toBeGreaterThan(0);
  });

  it("returns ready state with latency on success", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        yield "OK";
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.testedAt).toBe(100);
    }
  });

  it("returns failed state with category on ProviderError", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        throw new ProviderError("invalid api key", "9router", 401);
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.category).toBe("unauthorized");
      expect(result.testedAt).toBe(100);
    }
  });

  it("returns failed with timeout category when the deadline expires", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        yield new Promise<string>(() => {}); // never resolves
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 50,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.category).toBe("timeout");
    }
  });

  it("returns failed with empty-stream category when no content is yielded", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        // yields nothing
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.category).toBe("empty-stream");
    }
  });

  it("returns failed with protocol-incompatible when stream ends without [DONE]", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        throw new ProviderError(
          "9Router stream ended unexpectedly (no [DONE] sentinel). The response may be incomplete.",
          "9router",
        );
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.category).toBe("protocol-incompatible");
    }
  });

  it("returns failed with network category on generic fetch error", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        throw new ProviderError(
          "Network error reaching 9Router. Check your connection.",
          "9router",
        );
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.category).toBe("network");
    }
  });

  it("sanitizes errors — no raw keys, authorization headers, or full prompts in the message", async () => {
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        throw new ProviderError(
          "Bearer sk-9router-secret-key-123456 failed with prompt 'Say OK'",
          "9router",
          401,
        );
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      expect(result.message).not.toContain("sk-9router-secret-key");
      expect(result.message).not.toContain("Bearer ");
      expect(result.message).not.toContain("Say OK");
    }
  });

  it("never discloses raw upstream response body content in the message", async () => {
    // An upstream body with an unusual token format that the old regex-based
    // sanitizer would have passed through verbatim.
    const rawBody =
      '{"error":{"code":"model_overloaded","message":"The server is overloaded with requests. Please retry. Trace ID: xyz-abc-123"}}';
    const provider = makeProvider({
      chatCompletionStream: vi.fn(async function* (): AsyncGenerator<string, void, unknown> {
        throw new ProviderError(rawBody, "9router", 503);
      }),
    });

    const result = await probeModelRoute({
      provider,
      providerId: "9router",
      model: "cmc/model",
      now: () => 100,
      timeoutMs: 5_000,
    });

    expect(result.kind).toBe("failed");
    if (result.kind === "failed") {
      // The raw upstream body must never appear in the message.
      expect(result.message).not.toContain("model_overloaded");
      expect(result.message).not.toContain("Trace ID");
      expect(result.message).not.toContain("xyz-abc-123");
      expect(result.message).not.toContain("Please retry");
      // Only the generated safe message should appear.
      expect(result.message).toContain("9Router");
      expect(result.message).toContain("cmc/model");
      expect(result.message).toContain("unavailable");
      expect(result.message).toContain("HTTP 503");
    }
  });
});
