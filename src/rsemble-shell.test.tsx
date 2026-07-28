import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RSemble from "./rsemble";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RSemble workspace shell", () => {
  it("does not reserve space for a one-item primary navigation rail", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = renderToStaticMarkup(<RSemble />);
    expect(html).not.toContain('aria-label="Primary"');
    expect(html).not.toContain('aria-label="Command" aria-current="page"');
  });
});
