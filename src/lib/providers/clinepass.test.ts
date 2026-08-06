import { afterEach, describe, expect, it, vi } from "vitest";
import { clinepassProvider } from "./clinepass";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubStoredKey(): void {
  vi.stubGlobal("localStorage", {
    getItem: () => "test-key",
    setItem: () => undefined,
    removeItem: () => undefined,
  });
}

describe("ClinePass browser adapter", () => {
  it("routes chat completions through the local bridge", async () => {
    stubStoredKey();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await clinepassProvider.chatCompletion({
      model: "cline-pass/test-model",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/clinepass/v1/chat/completions",
      expect.any(Object),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: false });
  });
});
