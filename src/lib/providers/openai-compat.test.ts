import { describe, it, expect, vi, afterEach } from "vitest";
import { createOpenAICompatProvider } from "./openai-compat";
import { clearModelCapabilities, getModelCapabilities } from "./capabilities";
import { resetCredentialStoreForTests } from "../credentials/credential-store";
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
  clearModelCapabilities();
  resetCredentialStoreForTests();
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

// ---------------------------------------------------------------------------
// Optional-key mode (apiKeyRequired: false) and models-probe readiness
// ---------------------------------------------------------------------------

const optionalKeyConfig = {
  ...config,
  apiKeyRequired: false,
  readinessProbe: "models" as const,
};

describe("createOpenAICompatProvider — optional-key mode", () => {
  it("calls /models with no Authorization header when key is blank", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(optionalKeyConfig);

    await provider.listModels!();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("testConnection(\"\") probes /models and may succeed", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
      ),
    );
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    await expect(provider.testConnection!("")).resolves.toEqual({ ok: true });
  });

  it("a nonblank key produces exactly Authorization: Bearer <key>", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ));
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    await provider.testConnection!("sk-[REDACTED]");
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-[REDACTED]");
  });

  it("completion works without a key in optional-key mode", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 }),
      ),
    );
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    const result = await provider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(result).toBe("hello");
  });
});

describe("createOpenAICompatProvider — models-probe readiness", () => {
  it("returns ok when /models succeeds with a valid data array", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ));
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    await expect(provider.readiness()).resolves.toEqual({ ok: true });
  });

  it("returns a 401 reason when authentication is rejected", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "rejected-key",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 }),
    ));
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    const result = await provider.readiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("401");
  });

  it("returns a network reason when fetch throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    const result = await provider.readiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/reach|network|connection/i);
  });

  it("returns a malformed-catalog reason when response has no data/models array", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    ));
    const provider = createOpenAICompatProvider(optionalKeyConfig);
    const result = await provider.readiness();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/malformed|catalog/i);
  });
});

describe("createOpenAICompatProvider — default remains key-required", () => {
  it("readiness is sync and returns not-ok when no key is set", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    const provider = createOpenAICompatProvider(config);
    const result = provider.readiness();
    expect(result).not.toBeInstanceOf(Promise);
    const resolved = await result;
    expect(resolved.ok).toBe(false);
  });

  it("chatCompletion throws when no key is set (default mode)", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "",
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubEnv("VITE_UMANS_API_KEY", "");
    const provider = createOpenAICompatProvider(config);
    await expect(provider.chatCompletion({ model: "m", messages: [] })).rejects.toBeInstanceOf(ProviderError);
  });
});

// ---------------------------------------------------------------------------
// Attachment transport gate — plan 7.4.2
// ---------------------------------------------------------------------------

const mediaMessages = [
  {
    role: "user" as const,
    content: [
      { type: "text" as const, text: "prompt" },
      { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo" },
    ],
  },
];

function stubKeyAndOkChat() {
  vi.stubGlobal("localStorage", {
    getItem: () => "sk-test",
    setItem: () => {},
    removeItem: () => {},
  });
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 }),
  );
}

describe("createOpenAICompatProvider — supportsImages gate (7.4.2)", () => {
  it.each(["image", "file"])("rejects a %s part before any fetch when supportsImages is off", async (partType) => {
    const fetchMock = stubKeyAndOkChat();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(config);

    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "prompt" },
          ...(partType === "image"
            ? [{ type: "image" as const, mimeType: "image/png", data: "iVBOR" }]
            : [{ type: "file" as const, mimeType: "application/pdf", data: "JVBER", filename: "r.pdf" }]),
        ],
      },
    ];

    const err = await provider
      .chatCompletion({ model: "m", messages })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toContain("supportsImages");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects media parts on the streaming path too", async () => {
    const fetchMock = stubKeyAndOkChat();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(config);

    const stream = provider.chatCompletionStream({ model: "m", messages: mediaMessages });
    await expect(stream.next()).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets stream=true on the streaming request body", async () => {
    stubKey();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(config);
    const stream = provider.chatCompletionStream({ model: "m", messages: [{ role: "user", content: "hi" }] });
    await expect(stream.next()).resolves.toMatchObject({ value: "ok" });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.stream).toBe(true);
  });

  it("passes string content through untouched even with the gate on", async () => {
    const fetchMock = stubKeyAndOkChat();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(config);

    await provider.chatCompletion({
      model: "m",
      messages: [{ role: "user", content: "plain text" }],
      temperature: 0.1,
      maxTokens: 42,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    // Byte-identical regression: string content is not wrapped or rewritten.
    expect(body.messages).toEqual([{ role: "user", content: "plain text" }]);
  });

  it("maps image parts to image_url data URLs when supportsImages is true", async () => {
    const fetchMock = stubKeyAndOkChat();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider({ ...config, supportsImages: true });

    await provider.chatCompletion({ model: "m", messages: mediaMessages });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "prompt" },
          { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo" } },
        ],
      },
    ]);
  });
});

describe("createOpenAICompatProvider — per-model capability metadata", () => {
  it("records explicit vision metadata and leaves undocumented models unknown", async () => {
    stubKey();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        data: [
          { id: "vision", architecture: { input_modalities: ["text", "image"] } },
          { id: "text-only", architecture: { input_modalities: ["text"] } },
          { id: "undocumented" },
        ],
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenAICompatProvider({ ...config, supportsImages: true });
    await provider.listModels!();

    expect(getModelCapabilities("umans", "vision")).toEqual({ image: true, pdf: false });
    expect(getModelCapabilities("umans", "text-only")).toEqual({ image: false, pdf: false });
    expect(getModelCapabilities("umans", "undocumented")).toEqual({ image: false, pdf: false });
  });
});

// ---------------------------------------------------------------------------
// Bounded error bodies and bridge authentication — Plan 003 C/D
// ---------------------------------------------------------------------------

describe("createOpenAICompatProvider — bounded error bodies (Plan 003 D)", () => {
  it("caps an oversized plain-text error body to the byte bound", async () => {
    stubKey();
    const big = "E".repeat(20_000);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(big, { status: 502, headers: { "Content-Type": "text/plain" } }),
      ),
    );
    const provider = createOpenAICompatProvider(config);
    const err = await provider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message.length).toBeLessThanOrEqual(8192);
    expect((err as ProviderError).message).not.toContain(big.slice(9000));
  });

  it("does not serialize arbitrary JSON error bodies into the message", async () => {
    stubKey();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ foo: { bar: [1, 2, 3] } }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const provider = createOpenAICompatProvider(config);
    const err = await provider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toContain("502");
    expect((err as ProviderError).message).not.toContain("bar");
  });
});

describe("createOpenAICompatProvider — bridge secret header (Plan 003 C)", () => {
  it("attaches X-RSemble-Bridge-Secret when configured", async () => {
    stubKey();
    vi.stubEnv("VITE_RSEMBLE_BRIDGE_SECRET", "test-bridge-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider({ ...config, bridgeSecret: true });
    await provider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-RSemble-Bridge-Secret"]).toBe("test-bridge-secret");
  });

  it("omits the header when no secret is configured", async () => {
    stubKey();
    vi.stubEnv("VITE_RSEMBLE_BRIDGE_SECRET", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider({ ...config, bridgeSecret: true });
    await provider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-RSemble-Bridge-Secret"]).toBeUndefined();
  });

  it("does not attach the header for providers that are not bridge-routed", async () => {
    stubKey();
    vi.stubEnv("VITE_RSEMBLE_BRIDGE_SECRET", "test-bridge-secret");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider(config); // bridgeSecret: false
    await provider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-RSemble-Bridge-Secret"]).toBeUndefined();
  });
});

describe("createOpenAICompatProvider — encoded body preflight (Plan 003 E)", () => {
  it("blocks an oversized encoded body before fetch with an exact transport-size error", async () => {
    stubKey();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider({ ...config, bridgeBodyLimitBytes: 1024 });
    const messages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "x".repeat(2000) }] },
    ];
    const err = await provider
      .chatCompletion({ model: "m", messages })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toMatch(/bridge limit/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks oversized streaming bodies before fetch too", async () => {
    stubKey();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = createOpenAICompatProvider({ ...config, bridgeBodyLimitBytes: 1024 });
    const messages = [
      { role: "user" as const, content: [{ type: "text" as const, text: "x".repeat(2000) }] },
    ];
    const stream = provider.chatCompletionStream({ model: "m", messages });
    await expect(stream.next()).rejects.toMatchObject({ name: "ProviderError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
