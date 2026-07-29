import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionsModal } from "./ConnectionsModal";

describe("ConnectionsModal", () => {
  it("offers a test connection action for API-key providers", () => {
    const html = renderToStaticMarkup(
      <ConnectionsModal isOpen onClose={() => undefined} onRefresh={() => undefined} />,
    );

    expect(html).toContain('aria-label="Test ClinePass connection"');
    expect(html).toContain('aria-label="Test OpenRouter connection"');
  });

  it("offers a test connection action for 9Router", () => {
    const html = renderToStaticMarkup(
      <ConnectionsModal isOpen onClose={() => undefined} onRefresh={() => undefined} />,
    );
    expect(html).toContain('aria-label="Test 9Router connection"');
  });

  it("shows 9Router with optional-key guidance", () => {
    const html = renderToStaticMarkup(
      <ConnectionsModal isOpen onClose={() => undefined} onRefresh={() => undefined} />,
    );
    expect(html).toContain("9Router");
    expect(html).toContain("optional");
  });
});
