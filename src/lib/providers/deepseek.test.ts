import { afterEach, describe, expect, it, vi } from "vitest";
import { deepseekProvider } from "./deepseek";
import { listProviders } from "./registry";
import { ProviderError } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubLocalStorage(key: string): void {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "rsemble.key.deepseek" ? key : null),
    setItem: () => undefined,
    removeItem: () => undefined,
  });
}

describe("DeepSeek provider registration", () => {
  it("has id deepseek and label DeepSeek", () => {
    expect(deepseekProvider.id).toBe("deepseek");
    expect(deepseekProvider.label).toBe("DeepSeek");
  });

  it("is registered after gemini in the stable provider order", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids.indexOf("deepseek")).toBe(ids.indexOf("gemini") + 1);
  });
});

describe("DeepSeek browser-direct adapter", () => {
  it("posts chat completions to api.deepseek.com with a Bearer key — no bridge", async () => {
    stubLocalStorage("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deepseekProvider.chatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.any(Object),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "deepseek-v4-flash", stream: false });
  });

  it("forwards the documented DeepSeek effort shape", async () => {
    stubLocalStorage("test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await deepseekProvider.chatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      reasoningEffort: "high",
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("high");
  });

  it("readiness is a sync credential check against the stored key", async () => {
    stubLocalStorage("");
    const missing = deepseekProvider.readiness();
    expect(missing).not.toBeInstanceOf(Promise);
    expect(missing).toMatchObject({ ok: false, reason: expect.stringContaining("VITE_DEEPSEEK_KEY") });

    stubLocalStorage("test-key");
    expect(deepseekProvider.readiness()).toEqual({ ok: true });
  });

  it("testConnection surfaces an HTTP 401 from the models probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deepseekProvider.testConnection!("bad-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/models", expect.any(Object));
    expect(result).toEqual({ ok: false, reason: "invalid api key" });
  });

  it("listModels tags catalog entries with the deepseek provider id", async () => {
    stubLocalStorage("test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
              { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const models = await deepseekProvider.listModels!();

    expect(models).toHaveLength(2);
    expect(models.every((m) => m.providerId === "deepseek")).toBe(true);
  });

  it("rejects image parts in preflight — the API is text-only", async () => {
    stubLocalStorage("test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const promise = deepseekProvider.chatCompletion({
      model: "deepseek-v4-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image", mimeType: "image/png", data: "AAAA" },
          ],
        },
      ],
    });

    await expect(promise).rejects.toBeInstanceOf(ProviderError);
    await expect(promise).rejects.toMatchObject({ providerId: "deepseek" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
