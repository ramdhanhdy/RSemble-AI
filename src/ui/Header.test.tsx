// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Header } from "./Header";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  $: (selector: string) => HTMLElement | null;
}

function renderHeader(): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/compare"]}>
        <Header running={false} connectionState="ready" onOpenConnections={() => undefined} />
      </MemoryRouter>,
    );
  });
  return {
    container,
    $: (s) => container.querySelector<HTMLElement>(s),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Header connections pill (44x44 target rule)", () => {
  it("keeps the pill at least 44px in both dimensions when the label is hidden at 768-1023px", () => {
    const h = renderHeader();
    const pill = h.$('button[aria-label="Connection status: Live. Manage connections."]');
    expect(pill).toBeTruthy();
    // Below lg the label collapses to a dot (hidden lg:inline), so the hit
    // area must not depend on label width: the pill itself needs min-w-[44px]
    // alongside min-h-[44px] to meet the project 44x44 target rule.
    const label = pill?.querySelector("span[aria-live]");
    expect(label?.className.includes("hidden lg:inline")).toBe(true);
    expect(pill?.className.includes("min-h-[44px]")).toBe(true);
    expect(pill?.className.includes("min-w-[44px]")).toBe(true);
  });
});
