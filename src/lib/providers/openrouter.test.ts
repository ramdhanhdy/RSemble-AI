import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { openrouterProvider } from "./openrouter";
import { ProviderError, type ContentPart } from "./types";
import { clearModelCapabilities, getModelCapabilities } from "./capabilities";
import { capabilitiesForModel, clearModelReasoningCapabilities, setModelReasoningCapabilities } from "./reasoning";
import { resetCredentialStoreForTests } from "../credentials/credential-store";

function stubKey(): void {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "rsemble.key.openrouter.v2" ? "sk-test" : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCredentialStoreForTests();
});

beforeEach(() => {
  clearModelCapabilities();
  clearModelReasoningCapabilities();
  // Deterministic: never let the developer's .env leak into test requests.
  vi.stubEnv("VITE_OPENROUTER_KEY", "");
});

// ---------------------------------------------------------------------------
// 7.3.6 — golden snapshot: string content must be byte-identical to pre-change
// ---------------------------------------------------------------------------

describe("openrouter — string content (golden snapshot)", () => {
  it("sends a body byte-identical to the pre-attachments shape", async () => {
    stubKey();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "hi" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await openrouterProvider.chatCompletion({
      model: "some-model",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hello" },
      ],
      temperature: 0.2,
      maxTokens: 64,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({
      model: "some-model",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hello" },
      ],
      temperature: 0.2,
      max_tokens: 64,
    });
    // No content part objects, no extra keys.
    expect(body.messages[0].content).toBe("You are helpful.");
    expect(typeof body.messages[1].content).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// 7.3.3 — content part mapping
// ---------------------------------------------------------------------------

describe("openrouter — content parts", () => {
  const png: ContentPart = { type: "image", mimeType: "image/png", data: "AAAAB" };
  const pdf: ContentPart = {
    type: "file",
    mimeType: "application/pdf",
    data: "JVBERi0",
    filename: "paper.pdf",
  };

  async function captureBody(parts: ContentPart[]): Promise<Record<string, unknown>> {
    stubKey();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: "ok" } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    await openrouterProvider.chatCompletion({
      model: "vision-model",
      messages: [{ role: "user", content: parts }],
    });
    return JSON.parse(fetchMock.mock.calls[0][1].body as string);
  }

  it("maps an image-only message to image_url with a data URL", async () => {
    const body = await captureBody([png]);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAAB" } }],
      },
    ]);
  });

  it("maps a pdf-only message to a file part", async () => {
    const body = await captureBody([pdf]);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "file",
            file: { filename: "paper.pdf", file_data: "data:application/pdf;base64,JVBERi0" },
          },
        ],
      },
    ]);
  });

  it("maps a mixed text+image message preserving part order", async () => {
    const body = await captureBody([{ type: "text", text: "what is this?" }, png]);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAAAB" } },
        ],
      },
    ]);
  });

  it("maps parts identically on the streaming path", async () => {
    stubKey();
    const sseBody =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const gen = openrouterProvider.chatCompletionStream({
      model: "vision-model",
      messages: [{ role: "user", content: [png] }],
    });
    for await (const _ of gen) {
      // drain
    }
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAAB" } },
    ]);
    expect(body.stream).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7.3.4 — capability parsing from listModels
// ---------------------------------------------------------------------------

describe("openrouter — capability parsing", () => {
  it("records image/pdf capabilities from architecture.input_modalities", async () => {
    stubKey();
    const payload = {
      data: [
        {
          id: "vision-only",
          name: "Vision Only",
          architecture: { input_modalities: ["text", "image"] },
        },
        {
          id: "vision-pdf",
          name: "Vision PDF",
          architecture: { input_modalities: ["text", "image", "file"] },
        },
        {
          id: "text-only",
          name: "Text Only",
          architecture: { input_modalities: ["text"] },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await openrouterProvider.listModels!();

    expect(getModelCapabilities("openrouter", "vision-only")).toEqual({ image: true, pdf: false });
    expect(getModelCapabilities("openrouter", "vision-pdf")).toEqual({ image: true, pdf: true });
    expect(getModelCapabilities("openrouter", "text-only")).toEqual({ image: false, pdf: false });
  });

  it("returns the conservative default for a model never seen in the catalog", () => {
    expect(getModelCapabilities("openrouter", "never-listed")).toEqual({
      image: false,
      pdf: false,
    });
  });

  it("treats a missing architecture field as text-only without throwing", async () => {
    stubKey();
    const payload = { data: [{ id: "no-arch", name: "No Arch" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    await openrouterProvider.listModels!();
    expect(getModelCapabilities("openrouter", "no-arch")).toEqual({ image: false, pdf: false });
  });

  it("forwards an explicitly catalog-supported effort and omits it for provider-default", async () => {
    stubKey();
    setModelReasoningCapabilities("openrouter", "reasoning-model", {
      supportedEfforts: ["provider-default", "low", "high"],
      source: "catalog",
      transport: "openrouter",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    await openrouterProvider.chatCompletion({
      model: "reasoning-model",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "high",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reasoning).toEqual({ effort: "high" });
    await openrouterProvider.chatCompletion({
      model: "reasoning-model",
      messages: [{ role: "user", content: "hi" }],
      reasoningEffort: "provider-default",
    });
    const defaultBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(defaultBody.reasoning).toBeUndefined();
  });

  it("treats an explicit supported_efforts array as the capability set", async () => {
    stubKey();
    const payload = {
      data: [
        {
          id: "restricted",
          name: "Restricted",
          reasoning: { mandatory: false, supported_efforts: ["xhigh", "high"], default_effort: "high" },
        },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    const models = await openrouterProvider.listModels!();
    expect(models[0].reasoning?.supportedEfforts).toEqual(["provider-default", "xhigh", "high"]);
    expect(capabilitiesForModel("openrouter", "restricted").supportedEfforts).toEqual([
      "provider-default",
      "xhigh",
      "high",
    ]);
  });

  it("treats a reasoning object without supported_efforts as all levels allowed", async () => {
    stubKey();
    // 127 of 338 live catalog models declare reasoning without
    // supported_efforts (verified 2026-08-06); OpenRouter docs say null or
    // absent means every effort value is allowed.
    const payload = {
      data: [
        { id: "open-ended", name: "Open Ended", reasoning: { mandatory: false, default_enabled: true } },
        { id: "null-efforts", name: "Null Efforts", reasoning: { supported_efforts: null } },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    const models = await openrouterProvider.listModels!();
    for (const model of models) {
      expect(model.reasoning?.source).toBe("catalog");
      expect(model.reasoning?.supportedEfforts).toContain("xhigh");
      expect(model.reasoning?.supportedEfforts).toContain("minimal");
    }
  });

  it("keeps models without a reasoning object at unknown capabilities", async () => {
    stubKey();
    const payload = { data: [{ id: "no-reasoning", name: "No Reasoning" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload)));
    const models = await openrouterProvider.listModels!();
    expect(models[0].reasoning).toBeUndefined();
    expect(capabilitiesForModel("openrouter", "no-reasoning").source).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// 7.3.5 — 413 / 415 surface verbatim through ProviderError
// ---------------------------------------------------------------------------

describe("openrouter — payload error surfacing", () => {
  it("surfaces an HTTP 413 detail verbatim with status", async () => {
    stubKey();
    const detail = "Payload too large: reduce total attachment bytes below 10 MB.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: detail } }, 413))
    );
    const err = await openrouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe(detail);
    expect((err as ProviderError).status).toBe(413);
  });

  it("surfaces an HTTP 415 detail verbatim with status", async () => {
    stubKey();
    const detail = "Unsupported media type: this model does not accept file inputs.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: detail } }, 415))
    );
    const err = await openrouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe(detail);
    expect((err as ProviderError).status).toBe(415);
  });
});

// ---------------------------------------------------------------------------
// Provider-error policy — review fix 3
// ---------------------------------------------------------------------------

describe("openrouter — raw provider bodies never surface (review fix 3)", () => {
  it("redacts a configured key inside a recognized structured message", async () => {
    stubKey();
    vi.stubEnv("VITE_OPENROUTER_KEY", "sk-configured-or-key-123456");
    resetCredentialStoreForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { message: "401 invalid key sk-configured-or-key-123456" } }, 401),
      ),
    );
    const err = await openrouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).not.toContain("sk-configured-or-key-123456");
  });

  it("maps an HTML error body to a generic status error without raw content", async () => {
    stubKey();
    vi.stubEnv("VITE_OPENROUTER_KEY", "");
    resetCredentialStoreForTests();
    const html = `<html><body>Bearer sk-leaked-777 prompt "top secret task"</body></html>`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(html, { status: 502, headers: { "Content-Type": "text/html" } }),
      ),
    );
    const err = await openrouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect((err as ProviderError).message).toBe("OpenRouter request failed (HTTP 502).");
  });

  it("maps arbitrary JSON prompt fragments to a generic status error", async () => {
    stubKey();
    vi.stubEnv("VITE_OPENROUTER_KEY", "");
    resetCredentialStoreForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ details: [{ body: "the user asked for a plan" }] }, 500),
      ),
    );
    const err = await openrouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect((err as ProviderError).message).toBe("OpenRouter request failed (HTTP 500).");
  });
});
