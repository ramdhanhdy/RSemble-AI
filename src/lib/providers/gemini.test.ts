import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { geminiProvider } from "./gemini";
import { ProviderError } from "./types";
import { resetCredentialStoreForTests } from "../credentials/credential-store";

// Placeholder key only — never a real credential. Asserted not to leak.
const TEST_KEY = "test-gemini-key-placeholder";

function geminiModel(
  name: string,
  displayName: string,
  methods: string[] = ["generateContent"],
): { name: string; displayName: string; supportedGenerationMethods: string[] } {
  return { name: `models/${name}`, displayName, supportedGenerationMethods: methods };
}

/** The mixed-order live fixture from the spec (§8): old-first, an embedding-only
 *  record, a -latest alias, and newer 3.x models below an artificial cutoff. */
function mixedFixture() {
  return {
    models: [
      geminiModel("gemini-2.0-flash", "Gemini 2.0 Flash"),
      geminiModel("gemini-3.1-pro-preview", "Gemini 3.1 Pro (Preview)"),
      geminiModel("text-embedding-004", "Text Embedding 004", ["embedContent"]),
      geminiModel("gemini-flash-latest", "Gemini Flash (Latest)"),
      geminiModel("gemini-2.5-pro", "Gemini 2.5 Pro"),
      geminiModel("gemini-3.6-flash", "Gemini 3.6 Flash"),
    ],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_GEMINI_KEY", TEST_KEY);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetCredentialStoreForTests();
});

describe("gemini listModels — generation filtering and recency ordering", () => {
  it("places -latest aliases before explicit numeric versions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(mixedFixture())));
    const list = await geminiProvider.listModels!();
    expect(list[0].id).toBe("gemini-flash-latest");
  });

  it("sorts Gemini 3.x before Gemini 2.x regardless of stability suffix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(mixedFixture())));
    const list = await geminiProvider.listModels!();
    const ids = list.map((m) => m.id);
    // 3.6 and 3.1 must come before 2.5 and 2.0 (the -latest alias is first).
    expect(ids.indexOf("gemini-3.6-flash")).toBeLessThan(ids.indexOf("gemini-2.5-pro"));
    expect(ids.indexOf("gemini-3.1-pro-preview")).toBeLessThan(ids.indexOf("gemini-2.5-pro"));
    expect(ids.indexOf("gemini-2.5-pro")).toBeLessThan(ids.indexOf("gemini-2.0-flash"));
  });

  it("excludes non-generation (embedding-only) records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(mixedFixture())));
    const list = await geminiProvider.listModels!();
    expect(list.map((m) => m.id)).not.toContain("text-embedding-004");
    // Every returned id is a gemini* generation model.
    for (const m of list) expect(m.id.startsWith("gemini")).toBe(true);
  });

  it("preserves exact provider-native ids without the models/ prefix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(mixedFixture())));
    const list = await geminiProvider.listModels!();
    for (const m of list) expect(m.id.startsWith("models/")).toBe(false);
    expect(list.map((m) => m.id)).toContain("gemini-3.1-pro-preview");
  });

  it("deduplicates exact ids, keeping the first metadata occurrence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          models: [
            geminiModel("gemini-3.6-flash", "Gemini 3.6 Flash"),
            geminiModel("gemini-3.6-flash", "Gemini 3.6 Flash (duplicate)"),
          ],
        }),
      ),
    );
    const list = await geminiProvider.listModels!();
    expect(list.filter((m) => m.id === "gemini-3.6-flash")).toHaveLength(1);
    expect(list[0].name).toBe("Gemini 3.6 Flash");
  });

  it("breaks version ties deterministically (case-insensitive id order)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          models: [
            geminiModel("gemini-3.1-pro", "Gemini 3.1 Pro"),
            geminiModel("gemini-3.1-flash", "Gemini 3.1 Flash"),
          ],
        }),
      ),
    );
    const list = await geminiProvider.listModels!();
    // Same generation (3.1) → deterministic case-insensitive id order:
    // gemini-3.1-flash before gemini-3.1-pro.
    expect(list.map((m) => m.id)).toEqual(["gemini-3.1-flash", "gemini-3.1-pro"]);
  });

  it("rejects a present malformed supportedGenerationMethods value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          models: [
            {
              name: "models/gemini-3.6-malformed",
              displayName: "Malformed Gemini",
              supportedGenerationMethods: "generateContent",
            },
            geminiModel("gemini-3.6-flash", "Gemini 3.6 Flash"),
          ],
        }),
      ),
    );
    const list = await geminiProvider.listModels!();
    expect(list.map((m) => m.id)).not.toContain("gemini-3.6-malformed");
  });

  it("uses an exact-string fallback when case-insensitive ids compare equal", async () => {
    const records = [
      geminiModel("gemini-3.1-Pro", "Uppercase Pro"),
      geminiModel("gemini-3.1-pro", "Lowercase Pro"),
    ];
    const load = async (models: ReturnType<typeof geminiModel>[]) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ models })));
      return (await geminiProvider.listModels!()).map((m) => m.id);
    };
    const forward = await load(records);
    const reverse = await load([...records].reverse());
    expect(forward).toEqual(reverse);
  });
});

describe("gemini listModels — fallback paths", () => {
  const expectedFallbackStart = [
    "gemini-3.6-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite",
  ];

  it("returns the current fallback when no key is configured", async () => {
    vi.stubEnv("VITE_GEMINI_KEY", "");
    const list = await geminiProvider.listModels!();
    expect(list.map((m) => m.id)).toEqual(expectedFallbackStart);
  });

  it("returns the current fallback when the live list is empty", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ models: [] })));
    const list = await geminiProvider.listModels!();
    expect(list.map((m) => m.id)).toEqual(expectedFallbackStart);
  });

  it("returns the current fallback on a recoverable (non-abort) failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")));
    const list = await geminiProvider.listModels!();
    expect(list.map((m) => m.id)).toEqual(expectedFallbackStart);
  });

  it("does not mutate the module fallback constant (callers get fresh copies)", async () => {
    vi.stubEnv("VITE_GEMINI_KEY", "");
    const a = await geminiProvider.listModels!();
    const b = await geminiProvider.listModels!();
    expect(a).not.toBe(b);
    a[0].id = "mutated";
    expect(b[0].id).toBe("gemini-3.6-flash");
  });
});

describe("gemini listModels — abort semantics", () => {
  it("propagates an abort rather than silently returning the fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "AbortError")),
    );
    await expect(geminiProvider.listModels!()).rejects.toThrow();
  });

  it("propagates an abort raised via the request signal", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(geminiProvider.listModels!(ctrl.signal)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// chatCompletion content mapping — attachments plan 7.4.1
// ---------------------------------------------------------------------------

function okGeminiChat(): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gemini chatCompletion — content parts mapping (7.4.1)", () => {
  it("keeps the string-content request body byte-identical to pre-attachments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGeminiChat());
    vi.stubGlobal("fetch", fetchMock);

    await geminiProvider.chatCompletion({
      model: "gemini-3.6-flash",
      messages: [
        { role: "system", content: "You are a judge." },
        { role: "user", content: "hello" },
      ],
      temperature: 0.2,
      maxTokens: 512,
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(
      JSON.stringify({
        systemInstruction: { parts: [{ text: "You are a judge." }] },
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
      }),
    );
  });

  it("forwards a documented Gemini 3 thinking level", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGeminiChat());
    vi.stubGlobal("fetch", fetchMock);
    await geminiProvider.chatCompletion({
      model: "gemini-3.6-flash",
      messages: [{ role: "user", content: "hello" }],
      reasoningEffort: "low",
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("maps text, image, and file parts to text/inlineData parts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okGeminiChat());
    vi.stubGlobal("fetch", fetchMock);

    await geminiProvider.chatCompletion({
      model: "gemini-3.6-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "prompt" },
            { type: "image", mimeType: "image/png", data: "iVBORw0KGgo" },
            {
              type: "file",
              mimeType: "application/pdf",
              data: "JVBERi0xLjQ",
              filename: "report.pdf",
            },
          ],
        },
      ],
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "prompt" },
          { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo" } },
          { inlineData: { mimeType: "application/pdf", data: "JVBERi0xLjQ" } },
        ],
      },
    ]);
    expect(body.systemInstruction).toBeUndefined();
  });

  it("uses the same parts mapping on the streaming endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks: string[] = [];
    for await (const chunk of geminiProvider.chatCompletionStream({
      model: "gemini-3.6-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "prompt" },
            { type: "image", mimeType: "image/webp", data: "UklGR" },
          ],
        },
      ],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["hi"]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.contents[0].parts).toEqual([
      { text: "prompt" },
      { inlineData: { mimeType: "image/webp", data: "UklGR" } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Provider-error policy — review fix 3
// ---------------------------------------------------------------------------

describe("gemini — raw provider bodies never surface (review fix 3)", () => {
  it("redacts a configured key inside a recognized structured message", async () => {
    vi.stubEnv("VITE_GEMINI_KEY", "sk-configured-gemini-key-123");
    resetCredentialStoreForTests();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "invalid key sk-configured-gemini-key-123" } }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );
    const err = await geminiProvider
      .chatCompletion({ model: "gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).not.toContain("sk-configured-gemini-key-123");
  });

  it("maps an HTML error body to a generic status error without raw content", async () => {
    vi.stubEnv("VITE_GEMINI_KEY", "AIza-key-123");
    resetCredentialStoreForTests();
    const html = `<html>Bearer AIza-leaked-999 task "classify this document"</html>`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(html, { status: 502, headers: { "Content-Type": "text/html" } }),
        ),
    );
    const err = await geminiProvider
      .chatCompletion({ model: "gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect((err as ProviderError).message).toBe("Gemini request failed (HTTP 502).");
  });

  it("maps arbitrary JSON prompt fragments to a generic status error", async () => {
    vi.stubEnv("VITE_GEMINI_KEY", "AIza-key-123");
    resetCredentialStoreForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ trace: "the user asked about pricing" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const err = await geminiProvider
      .chatCompletion({ model: "gemini-3.6-flash", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect((err as ProviderError).message).toBe("Gemini request failed (HTTP 500).");
  });
});
