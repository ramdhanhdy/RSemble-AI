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
