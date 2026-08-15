// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { EvaluationsWorkspace } from "./EvaluationsWorkspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function renderAt(path: string): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/evaluations" element={<EvaluationsWorkspace />}>
            <Route index element={<div data-testid="task-set-content" />} />
            <Route path="sets" element={<div data-testid="task-set-content" />} />
            <Route path="rubrics" element={<div data-testid="rubric-content" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ),
  );
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

describe("EvaluationsWorkspace — segmented nav identity (spec §5.4)", () => {
  it("shows both workspace links with aria-current on the active one", () => {
    const h = renderAt("/evaluations");
    const links = h.$$("nav[aria-label='Evaluations'] a");
    expect(links.length).toBe(2);
    const active = links.filter((l) => l.getAttribute("aria-current") === "page");
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain("Task sets");
    cleanup(h);
  });

  it("shows 'workloads you run' under active Task sets, hidden under Rubrics", () => {
    const h = renderAt("/evaluations");
    const links = h.$$("nav[aria-label='Evaluations'] a");
    const taskSets = links.find((l) => l.textContent?.includes("Task sets"));
    const rubrics = links.find((l) => l.textContent?.includes("Rubrics"));
    expect(taskSets?.textContent).toContain("workloads you run");
    expect(rubrics?.textContent).toContain("rubrics that score");
    // ...but only the active one's sublabel is exposed to assistive tech.
    const taskSetsSub = taskSets?.querySelector("[data-nav-sublabel]");
    const rubricsSub = rubrics?.querySelector("[data-nav-sublabel]");
    expect(taskSetsSub?.getAttribute("aria-hidden")).not.toBe("true");
    expect(rubricsSub?.getAttribute("aria-hidden")).toBe("true");
    cleanup(h);
  });

  it("flips the visible sublabel when Rubrics is active", () => {
    const h = renderAt("/evaluations/rubrics");
    const links = h.$$("nav[aria-label='Evaluations'] a");
    const taskSets = links.find((l) => l.textContent?.includes("Task sets"));
    const rubrics = links.find((l) => l.textContent?.includes("Rubrics"));
    expect(rubrics?.getAttribute("aria-current")).toBe("page");
    const taskSetsSub = taskSets?.querySelector("[data-nav-sublabel]");
    const rubricsSub = rubrics?.querySelector("[data-nav-sublabel]");
    expect(taskSetsSub?.getAttribute("aria-hidden")).toBe("true");
    expect(rubricsSub?.getAttribute("aria-hidden")).not.toBe("true");
    cleanup(h);
  });
});
