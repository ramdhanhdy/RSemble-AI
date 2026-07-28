import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenAICompatProvider } from "./openai-compat";
import { ProviderError } from "./types";

const config = {
  id: "umans" as const,
  label: "Umans",
  baseUrl: "https://api.code.umans.ai",
  envKey: "VITE_UMANS_API_KEY",
  storageKey: "rsemble.umans.key",
  modelsPath: "/v1/models",
  completionsPath: "/v1/chat/completions",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubKey() {
  vi.stubGlobal("localStorage", {
    getItem: () => "test-key",
    setItem: () => {},
    removeItem: () => {},
  });
}

describe("createOpenAICompatProvider — error preservation", () => {
  it("preserves plain-text (non-JSON) upstream error bodies as the ProviderError message", async () => {
    stubKey();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("502 Bad Gateway: upstream timed out", {
          status: 502,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );
    const provider = createOpenAICompatProvider(config);
    const err = await provider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe("502 Bad Gateway: upstream timed out");
    expect((err as ProviderError).status).toBe(502);
    expect((err as ProviderError).providerId).toBe("umans");
  });

  it("extracts JSON error.message bodies when present", async () => {
    stubKey();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const provider = createOpenAICompatProvider(config);
    const err = await provider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe("invalid api key");
    expect((err as ProviderError).status).toBe(401);
  });

  it("falls back to a diagnosable HTTP status message when the body is unreadable", async () => {
    stubKey();
    const bodyLess = new Response(null, { status: 500 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(bodyLess));
    const provider = createOpenAICompatProvider(config);
    const err = await provider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toContain("500");
  });
});

describe("createOpenAICompatProvider — connection verification", () => {
  it("tests an unsaved key against the authenticated model endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "model-1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(config);

    await expect(provider.testConnection!("candidate-key")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.code.umans.ai/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("candidate-key") }),
      }),
    );
  });

  it("returns the provider error when the key is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const provider = createOpenAICompatProvider(config);

    await expect(provider.testConnection!("bad-key")).resolves.toEqual({
      ok: false,
      reason: "invalid api key",
    });
  });
});
