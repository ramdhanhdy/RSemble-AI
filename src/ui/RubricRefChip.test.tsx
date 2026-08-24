// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RubricRefChip } from "./RubricRefChip";

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
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
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

describe("RubricRefChip", () => {
  it("renders name and version as a link to the canonical rubric route", () => {
    const h = render(<RubricRefChip name="Clarity rubric" rubricId="p1" version={3} />);
    const link = h.$("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("/evaluations/rubrics/p1");
    expect(link?.textContent).toContain("Clarity rubric v3");
    // Accessible name includes the kind word so chips are self-describing.
    expect(link?.getAttribute("aria-label")).toContain("Rubric");
    cleanup(h);
  });

  it("renders holistic judging as a non-link muted chip", () => {
    const h = render(<RubricRefChip holistic />);
    expect(h.$("a")).toBeNull();
    expect(h.container.textContent).toContain("Holistic judging");
    cleanup(h);
  });

  it("renders a bounded rubric-missing chip when the pinned rubric no longer exists", () => {
    const h = render(<RubricRefChip missing />);
    expect(h.$("a")).toBeNull();
    expect(h.container.textContent).toContain("Rubric missing");
    cleanup(h);
  });
});
