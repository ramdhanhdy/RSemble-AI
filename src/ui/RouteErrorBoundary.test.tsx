// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { Component, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Throws on render while its external `armed` flag is true. */
class Bomber extends Component<{ armedRef: { armed: boolean }; children: ReactNode }> {
  render(): ReactNode {
    if (this.props.armedRef.armed) {
      throw new Error("boom: routed chunk render failed");
    }
    return this.props.children;
  }
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    root,
    $: (s: string) => document.querySelector<HTMLElement>(s),
    $$: (s: string) => [...document.querySelectorAll<HTMLElement>(s)],
    text: () => container.textContent ?? "",
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function suppressBoundaryConsole() {
  // React logs a console.error when an error boundary catches a child error.
  // The Plan 006 console guard treats that as a defect; here the throw is the
  // intentional subject under test, so silence it for the throwing phase.
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("RouteErrorBoundary", () => {
  it("renders children when no error is thrown and keeps the root chrome mounted", () => {
    const h = render(
      <div>
        <header>app-chrome</header>
        <RouteErrorBoundary>
          <div>compare-still-alive</div>
        </RouteErrorBoundary>
      </div>,
    );
    expect(h.text()).toContain("compare-still-alive");
    expect(h.text()).toContain("app-chrome");
    expect(h.text()).not.toContain("could not be loaded");
    h.cleanup();
  });

  it("catches a child render error: shows a recovery heading instead of unmounting the boundary or the chrome above it", () => {
    const spy = suppressBoundaryConsole();
    const h = render(
      <div>
        <header>app-chrome</header>
        <RouteErrorBoundary>
          <Bomber armedRef={{ armed: true }}>inner</Bomber>
        </RouteErrorBoundary>
      </div>,
    );
    spy.mockRestore();
    expect(h.text()).toContain("app-chrome");
    expect(h.text()).toContain("could not be loaded");
    expect(h.text()).toContain("Reload app");
    expect(h.text()).toContain("Dismiss");
    h.cleanup();
  });

  it("Dismiss clears the error and re-renders the routed content once the child is healthy again", () => {
    const spy = suppressBoundaryConsole();
    const armedRef = { armed: true };
    const h = render(
      <RouteErrorBoundary>
        <Bomber armedRef={armedRef}>recovered-content</Bomber>
      </RouteErrorBoundary>,
    );
    spy.mockRestore();
    expect(h.text()).toContain("could not be loaded");

    act(() => {
      armedRef.armed = false;
      h.$$("button")
        .find((b) => b.textContent === "Dismiss")
        ?.click();
    });

    expect(h.text()).toContain("recovered-content");
    expect(h.text()).not.toContain("could not be loaded");
    h.cleanup();
  });

  it("Reload app triggers a full reload and the copy states it may interrupt execution", () => {
    const spy = suppressBoundaryConsole();
    const h = render(
      <RouteErrorBoundary>
        <Bomber armedRef={{ armed: true }}>inner</Bomber>
      </RouteErrorBoundary>,
    );
    spy.mockRestore();
    expect(h.text()).toContain("could not be loaded");

    // Truthful recovery copy: root state stays mounted on this page, but a
    // reload restarts the app and may interrupt an active run/experiment.
    expect(h.text()).toContain("Compare state stays");
    expect(h.text()).toContain("may interrupt an active run or");
    expect(h.text()).toContain("Reload app");

    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      writable: true,
    });

    act(() => {
      h.$$("button")
        .find((b) => b.textContent === "Reload app")
        ?.click();
    });
    expect(reload).toHaveBeenCalled();
    h.cleanup();
  });
});
