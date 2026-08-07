// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Pagination } from "./Pagination";

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

describe("Pagination", () => {
  it("renders Previous/Next buttons plus a range announcement", () => {
    const h = render(<Pagination page={1} pageCount={5} onPageChange={() => {}} />);
    expect(h.$$("button")).toHaveLength(2);
    expect(h.container.textContent ?? "").toContain("1–50");
    const labels = h.$$("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Previous page");
    expect(labels).toContain("Next page");
    cleanup(h);
  });

  it("disables Previous on page one and Next on the last page", () => {
    const h = render(<Pagination page={1} pageCount={1} onPageChange={() => {}} />);
    const buttons = h.$$("button");
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    cleanup(h);
  });

  it("calls onPageChange with the adjacent page number", () => {
    const changes: number[] = [];
    const h = render(<Pagination page={2} pageCount={5} onPageChange={(p) => changes.push(p)} />);
    const [prev, next] = h.$$("button");
    act(() => prev.click());
    act(() => next.click());
    expect(changes).toEqual([1, 3]);
    cleanup(h);
  });

  it("announces the exact range on the last partial page", () => {
    const h = render(
      <Pagination page={5} pageCount={5} totalItems={230} onPageChange={() => {}} />,
    );
    expect(h.container.textContent ?? "").toContain("201–230");
    cleanup(h);
  });

  it("keeps buttons at 44px touch targets", () => {
    const h = render(<Pagination page={1} pageCount={2} onPageChange={() => {}} />);
    for (const btn of h.$$("button")) {
      expect(btn.getAttribute("class") ?? "").toContain("min-h-[44px]");
    }
    cleanup(h);
  });
});
