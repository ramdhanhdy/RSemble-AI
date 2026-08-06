import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatgptCodexProvider } from "./chatgpt-codex";
import { ProviderError } from "./types";
import {
  clearModelCapabilities,
  getModelCapabilities,
  setModelCapabilities,
} from "./capabilities";

const BRIDGE = "http://127.0.0.1:8787";

function healthResponse(capabilities?: { image: boolean; pdf: boolean }): Response {
  return new Response(
    JSON.stringify({ status: "ok", service: "rsemble-codex-bridge", ...(capabilities ? { capabilities } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  clearModelCapabilities();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearModelCapabilities();
});

describe("chatgptCodexProvider readiness — capability feed (7.4.4)", () => {
  it("records the /health capabilities as a provider-wide default on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(healthResponse({ image: true, pdf: false }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatgptCodexProvider.readiness();
    expect(result).toEqual({ ok: true });

    // Every Codex model (listed or not) inherits the bridge capability set.
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.6-sol")).toEqual({ image: true, pdf: false });
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.4-mini")).toEqual({ image: true, pdf: false });
    // Both endpoints probed; the provider never hardcodes a bridge version.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${BRIDGE}/auth/status`,
      `${BRIDGE}/health`,
    ]);
  });

  it("records image: false when the bridge declares it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(healthResponse({ image: false, pdf: false }));
    vi.stubGlobal("fetch", fetchMock);

    await chatgptCodexProvider.readiness();
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.6-sol")).toEqual({ image: false, pdf: false });
  });

  it("stays unknown when /health omits capabilities (conservative default)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(healthResponse());
    vi.stubGlobal("fetch", fetchMock);

    await chatgptCodexProvider.readiness();
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.6-sol")).toEqual({ image: false, pdf: false });
  });

  it("does not record capabilities when the bridge is not logged in", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "not logged in" }), { status: 200 }))
      .mockResolvedValueOnce(healthResponse({ image: true, pdf: false }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatgptCodexProvider.readiness();
    expect(result.ok).toBe(false);
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.6-sol")).toEqual({ image: false, pdf: false });
  });

  it("lets a per-model record override the provider-wide default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(healthResponse({ image: true, pdf: false }));
    vi.stubGlobal("fetch", fetchMock);
    setModelCapabilities("chatgpt-codex", "gpt-5.4-mini", { image: false, pdf: false });

    await chatgptCodexProvider.readiness();
    // Overridden model: per-model entry wins.
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.4-mini")).toEqual({ image: false, pdf: false });
    // Unlisted model: provider default applies.
    expect(getModelCapabilities("chatgpt-codex", "gpt-5.6-sol")).toEqual({ image: true, pdf: false });
  });
});

describe("chatgptCodexProvider — bridge secret header (Plan 003 C)", () => {
  function okChatResponse(): Response {
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("attaches X-RSemble-Bridge-Secret when VITE_RSEMBLE_BRIDGE_SECRET is configured", async () => {
    vi.stubEnv("VITE_RSEMBLE_BRIDGE_SECRET", "test-bridge-secret");
    const fetchMock = vi.fn().mockResolvedValue(okChatResponse());
    vi.stubGlobal("fetch", fetchMock);
    await chatgptCodexProvider.chatCompletion({
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "hi" }],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-RSemble-Bridge-Secret"]).toBe("test-bridge-secret");
  });

  it("omits the header when no secret is configured", async () => {
    vi.stubEnv("VITE_RSEMBLE_BRIDGE_SECRET", "");
    const fetchMock = vi.fn().mockResolvedValue(okChatResponse());
    vi.stubGlobal("fetch", fetchMock);
    await chatgptCodexProvider.chatCompletion({
      model: "gpt-5.6-sol",
      messages: [{ role: "user", content: "hi" }],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-RSemble-Bridge-Secret"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Paid request deadlines — response-header boundary and abort semantics
// ---------------------------------------------------------------------------

describe("chatgptCodexProvider — abort preservation", () => {
  it("propagates runtime AbortError-like failures from readiness", async () => {
    const abort = Object.assign(new Error("request aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(chatgptCodexProvider.readiness()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("propagates runtime AbortError-like failures from model probes", async () => {
    const abort = Object.assign(new Error("request aborted"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(chatgptCodexProvider.listModels!()).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("chatgptCodexProvider — execution deadlines", () => {
  it("uses ChatOptions.connectMs and preserves the structured timeout", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation(
        (_input: unknown, _init: RequestInit) => new Promise<Response>(() => {}),
      );
      vi.stubGlobal("fetch", fetchMock);

      const pending = chatgptCodexProvider.chatCompletion({
        model: "gpt-5.6-sol",
        messages: [{ role: "user", content: "hi" }],
        connectMs: 25,
      });
      const timeoutAssertion = expect(pending).rejects.toMatchObject({
        name: "ExecutionTimeoutError",
        kind: "connect_timeout",
        provider: "chatgpt-codex",
        model: "gpt-5.6-sol",
      });
      await vi.advanceTimersByTimeAsync(25);
      await timeoutAssertion;
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops connect timing when stream response headers arrive", async () => {
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      let release: (() => void) | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          release = () => {
            controller.enqueue(encoder.encode(
              'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
            ));
            controller.close();
          };
        },
      });
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const iterator = chatgptCodexProvider.chatCompletionStream({
        model: "gpt-5.6-sol",
        messages: [{ role: "user", content: "hi" }],
        connectMs: 10,
        inactivityMs: 1_000,
      })[Symbol.asyncIterator]();
      const first = iterator.next();
      await vi.advanceTimersByTimeAsync(20);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(release).toBeTypeOf("function");

      release!();
      await expect(first).resolves.toEqual({ done: false, value: "hi" });
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Provider-error policy — review fix 3
// ---------------------------------------------------------------------------

describe("chatgptCodexProvider — raw provider bodies never surface (review fix 3)", () => {
  it("redacts bearer fragments inside a recognized structured message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: "401 Bearer sk-codex-leaked-123 rejected" } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const err = await chatgptCodexProvider
      .chatCompletion({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).not.toContain("sk-codex-leaked-123");
    expect((err as ProviderError).message).not.toMatch(/Bearer\s+[^\s,;]+/i);
  });

  it("maps an HTML bridge error body to a generic status error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`<html>Bridge error for task "top secret"</html>`, {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );
    const err = await chatgptCodexProvider
      .chatCompletion({ model: "gpt-5.6-sol", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe("ChatGPT (Codex) request failed (HTTP 502).");
  });
});
