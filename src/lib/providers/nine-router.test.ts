import { describe, it, expect, vi, afterEach } from "vitest";
import { nineRouterProvider } from "./nine-router";
import { ProviderError } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function stubLocalStorage(key: string): void {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "rsemble.key.9router" ? key : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

describe("nineRouterProvider — identity", () => {
  it("has id 9router and label 9Router", () => {
    expect(nineRouterProvider.id).toBe("9router");
    expect(nineRouterProvider.label).toBe("9Router");
  });
});

describe("nineRouterProvider — bridge paths", () => {
  it("requests models through the bridge path /9router/v1/models, not port 20128", async () => {
    stubLocalStorage("");
    vi.stubEnv("VITE_9ROUTER_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "m1" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await nineRouterProvider.listModels!();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/9router/v1/models");
    expect(url).not.toContain("20128");
  });

  it("requests completions through the bridge path /9router/v1/chat/completions", async () => {
    stubLocalStorage("");
    vi.stubEnv("VITE_9ROUTER_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 }),
      ),
    );
    await nineRouterProvider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/9router/v1/chat/completions");
    expect(url).not.toContain("20128");
  });
});

describe("nineRouterProvider — optional key", () => {
  it("works with a blank key (no Authorization header)", async () => {
    stubLocalStorage("");
    vi.stubEnv("VITE_9ROUTER_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await nineRouterProvider.testConnection!("");
    expect(result).toEqual({ ok: true });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("reads the key from VITE_9ROUTER_KEY first", async () => {
    stubLocalStorage("from-storage");
    vi.stubEnv("VITE_9ROUTER_KEY", "from-env");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
      ),
    );
    await nineRouterProvider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer from-env");
  });

  it("falls back to rsemble.key.9router in localStorage", async () => {
    stubLocalStorage("from-storage");
    vi.stubEnv("VITE_9ROUTER_KEY", "");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
      ),
    );
    await nineRouterProvider.chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] });
    const init = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer from-storage");
  });
});

describe("nineRouterProvider — catalog", () => {
  it("preserves namespaced and combo IDs unchanged", async () => {
    stubLocalStorage("key");
    vi.stubEnv("VITE_9ROUTER_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "ag/gemini-3.1-pro-low", name: "Gemini 3.1 Pro Low" },
              { id: "combo:fast+cheap", name: "Fast+Cheap Combo" },
              { id: "alias-model", name: "Alias" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const models = await nineRouterProvider.listModels!();
    const ids = models.map((m) => m.id);
    expect(ids).toContain("ag/gemini-3.1-pro-low");
    expect(ids).toContain("combo:fast+cheap");
    expect(ids).toContain("alias-model");
    // All tagged with providerId 9router
    expect(models.every((m) => m.providerId === "9router")).toBe(true);
  });

  it("deduplicates by exact ID (first occurrence wins)", async () => {
    stubLocalStorage("key");
    vi.stubEnv("VITE_9ROUTER_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "dup", name: "First" },
              { id: "dup", name: "Second" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const models = await nineRouterProvider.listModels!();
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe("First");
  });

  it("sorts catalog by case-insensitive ID", async () => {
    stubLocalStorage("key");
    vi.stubEnv("VITE_9ROUTER_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              { id: "zebra" },
              { id: "Apple" },
              { id: "banana" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const models = await nineRouterProvider.listModels!();
    expect(models.map((m) => m.id)).toEqual(["Apple", "banana", "zebra"]);
  });
});

describe("nineRouterProvider — error mapping", () => {
  it("maps 401 to ProviderError with providerId 9router", async () => {
    stubLocalStorage("bad-key");
    vi.stubEnv("VITE_9ROUTER_KEY", "bad-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 }),
      ),
    );
    const err = await nineRouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).providerId).toBe("9router");
    expect((err as ProviderError).status).toBe(401);
    expect((err as ProviderError).message).toBe("invalid api key");
  });

  it("maps 503 to ProviderError with providerId 9router", async () => {
    stubLocalStorage("key");
    vi.stubEnv("VITE_9ROUTER_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "all routes unavailable" } }), { status: 503 }),
      ),
    );
    const err = await nineRouterProvider
      .chatCompletion({ model: "m", messages: [{ role: "user", content: "hi" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).providerId).toBe("9router");
    expect((err as ProviderError).status).toBe(503);
  });
});

describe("nineRouterProvider — abort propagation", () => {
  it("passes the abort signal to fetch", async () => {
    stubLocalStorage("key");
    vi.stubEnv("VITE_9ROUTER_KEY", "key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    await nineRouterProvider.chatCompletion({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      signal: ctrl.signal,
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });
});
