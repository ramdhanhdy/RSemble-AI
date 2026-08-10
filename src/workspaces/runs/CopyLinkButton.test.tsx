// =============================================================================
// Slice 5 — CopyLinkButton behavior (G3, Copy link).
//
// Verifies: the button copies the real browser URL (HashRouter deep link) via
// the clipboard API, labels the local-device scope honestly, shows transient
// "Copied!" feedback, and degrades silently when the clipboard is unavailable
// (copying is a convenience, never a gate).
// =============================================================================

// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { CopyLinkButton } from "./CopyLinkButton";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
}

function renderButton(): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <CopyLinkButton />
      </MemoryRouter>,
    ),
  );
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CopyLinkButton (Slice 5 G3)", () => {
  it("renders a device-scoped copy-link action with the current browser URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    Object.defineProperty(window, "location", {
      value: { ...window.location, href: "http://localhost/#/runs/run-1?candidate=c1" },
      writable: true,
    });

    const h = renderButton();
    const button = h.$('[data-action="copy-link"]');
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain("Copy link — this device");
    expect(button?.getAttribute("aria-label")).toContain("this device");
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith("http://localhost/#/runs/run-1?candidate=c1");
    expect(h.$('[data-action="copy-link"]')?.textContent).toContain("Copied!");
    cleanup(h);
  });

  it("reverts to the label after the feedback timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const h = renderButton();
    const button = h.$('[data-action="copy-link"]')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(button.textContent).toContain("Copied!");
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(button.textContent).toContain("Copy link — this device");
    cleanup(h);
  });

  it("no-ops silently when the clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });

    const h = renderButton();
    const button = h.$('[data-action="copy-link"]')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    // No crash, no fabricated success state.
    expect(button.textContent).toContain("Copy link — this device");
    cleanup(h);
  });

  it("no-ops silently when the clipboard write rejects", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    const h = renderButton();
    const button = h.$('[data-action="copy-link"]')!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(button.textContent).toContain("Copy link — this device");
    expect(button.textContent).not.toContain("Copied!");
    cleanup(h);
  });
});
