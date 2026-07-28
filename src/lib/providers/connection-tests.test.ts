import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiProvider } from "./gemini";
import { openrouterProvider } from "./openrouter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("provider connection verification", () => {
  it("verifies an unsaved OpenRouter key with the model catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"data":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(openrouterProvider.testConnection!("candidate-key")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining("candidate-key") }),
      }),
    );
  });

  it("verifies an unsaved Gemini key with the model catalog", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"models":[]}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geminiProvider.testConnection!("candidate-key")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models?key=candidate-key",
    );
  });
});
