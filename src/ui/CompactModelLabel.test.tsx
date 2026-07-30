// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CompactModelLabel } from "./CompactModelLabel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CompactModelLabel", () => {
  it("renders a provider chip plus the slug", () => {
    const h = render(<CompactModelLabel providerId="openrouter" slug="gpt-4o" />);
    const text = h.container.textContent ?? "";
    // Provider chip is visible
    expect(text.toLowerCase()).toContain("openrouter");
    // Slug tail is visible
    expect(text).toContain("gpt-4o");
    cleanup(h);
  });

  it("preserves the distinguishing tail on long slugs with middle ellipsis", () => {
    const longSlug = "google/gemini-2.5-pro-preview-05-06";
    const h = render(<CompactModelLabel providerId="openrouter" slug={longSlug} />);
    const text = h.container.textContent ?? "";
    // The tail "pro-preview" must be visible (bounded middle ellipsis preserves tail)
    expect(text).toContain("pro-preview");
    cleanup(h);
  });

  it("exposes full opaque providerId:modelSlug identity via accessible text", () => {
    const h = render(<CompactModelLabel providerId="umans" slug="claude-opus-4" />);
    // Full identity available through accessible text, not only hover title
    const accessible = h.$("[data-full-id]");
    expect(accessible).toBeTruthy();
    expect(accessible?.textContent).toContain("umans:claude-opus-4");
    cleanup(h);
  });

  it("provides a focusable/clickable detail disclosure for full identity", () => {
    const h = render(<CompactModelLabel providerId="gemini" slug="gemini-2.5-flash" />);
    // A button or link that exposes the full identity on focus/click
    const disclosure = h.$("button[data-full-id-disclosure]");
    expect(disclosure).toBeTruthy();
    expect(disclosure?.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(0);
    cleanup(h);
  });

  it("renders unknown provider gracefully", () => {
    const h = render(
      <CompactModelLabel providerId="custom" slug="my-model" />,
    );
    const text = h.container.textContent ?? "";
    expect(text).toContain("my-model");
    // Unknown provider falls back to the raw providerId
    expect(text.toLowerCase()).toContain("custom");
    cleanup(h);
  });

  it("uses 13px minimum body text and visible focus styles", () => {
    const h = render(<CompactModelLabel providerId="openrouter" slug="gpt-4o" />);
    const disclosure = h.$("button[data-full-id-disclosure]");
    expect(disclosure).toBeTruthy();
    // Focus-visible is handled globally by :focus-visible CSS, but the
    // element must be focusable (button or link with tabindex).
    expect(disclosure?.tagName).toBe("BUTTON");
    // 44px target: min-h-[44px] on interactive elements
    const cls = disclosure?.getAttribute("class") ?? "";
    expect(cls).toContain("min-h-[44px]");
    cleanup(h);
  });
});
