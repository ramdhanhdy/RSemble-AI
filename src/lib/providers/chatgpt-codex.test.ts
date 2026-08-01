import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatgptCodexProvider } from "./chatgpt-codex";
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
