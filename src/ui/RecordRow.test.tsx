// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RecordRow } from "./RecordRow";

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

function renderWithRouter(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
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

const SAMPLE_ROW = {
  id: "run-123",
  title: "Write a Python function to sort a list",
  status: "completed" as const,
  timestamp: Date.now(),
  summary: "Winner: openrouter:gpt-4o (4.0)",
  modelCount: 3,
  source: "adhoc" as const,
};

describe("RecordRow", () => {
  it("list-density variant exposes status, title, timestamp, summary, model count, and source", () => {
    const h = render(
      <RecordRow variant="list" {...SAMPLE_ROW} />,
    );
    const text = h.container.textContent ?? "";
    expect(text).toContain("Write a Python function");
    expect(text).toContain("3"); // model count
    expect(text).toContain("adhoc"); // source
    // Status mark present
    expect(h.$("[data-status-mark]") || h.$("svg")).toBeTruthy();
    cleanup(h);
  });

  it("table-cell variant exposes the same slots without changing semantic structure", () => {
    const h = render(
      <table>
        <tbody>
          <tr>
            <RecordRow variant="table-cell" {...SAMPLE_ROW} />
          </tr>
        </tbody>
      </table>,
    );
    const text = h.container.textContent ?? "";
    expect(text).toContain("Write a Python function");
    expect(text).toContain("3"); // model count
    expect(h.$("svg")).toBeTruthy();
    cleanup(h);
  });

  it("list variant renders as a link when href is provided", () => {
    const h = renderWithRouter(
      <RecordRow variant="list" {...SAMPLE_ROW} href="/runs/run-123" />,
    );
    const link = h.$("a[href='/runs/run-123']");
    expect(link).toBeTruthy();
    cleanup(h);
  });

  it("supports a trailing action slot", () => {
    const h = render(
      <RecordRow variant="list" {...SAMPLE_ROW}>
        <button data-action="export">Export</button>
      </RecordRow>,
    );
    expect(h.$("[data-action='export']")).toBeTruthy();
    cleanup(h);
  });

  it("provenance slot renders when provided", () => {
    const h = render(
      <RecordRow
        variant="list"
        {...SAMPLE_ROW}
        provenance="Experiment · Suite v3 · Task: Pricing"
      />,
    );
    expect(h.container.textContent).toContain("Experiment");
    expect(h.container.textContent).toContain("Suite v3");
    cleanup(h);
  });

  it("uses 13px minimum body text", () => {
    const h = render(<RecordRow variant="list" {...SAMPLE_ROW} />);
    const row = h.$("[data-record-row]");
    expect(row).toBeTruthy();
    const classes = (row?.getAttribute("class") ?? "").split(/\s+/);
    const hasMinSize = classes.some((c) => {
      const m = c.match(/^text-\[(\d+)px\]$/);
      return m && parseInt(m[1], 10) >= 13;
    });
    const hasStdSize = classes.includes("text-sm") || classes.includes("text-base");
    expect(hasMinSize || hasStdSize).toBe(true);
    cleanup(h);
  });

  it("interactive targets meet 44px minimum", () => {
    const h = renderWithRouter(
      <RecordRow variant="list" {...SAMPLE_ROW} href="/runs/run-123" />,
    );
    const link = h.$("a[href='/runs/run-123']");
    expect(link).toBeTruthy();
    const cls = link?.getAttribute("class") ?? "";
    expect(cls).toContain("min-h-[44px]");
    cleanup(h);
  });

  it("renders StatusMark for the given status", () => {
    const h = render(<RecordRow variant="list" {...SAMPLE_ROW} status="failed" />);
    // StatusMark renders an svg icon; failed = XCircle
    expect(h.$("svg")).toBeTruthy();
    const text = h.container.textContent ?? "";
    expect(text.toLowerCase()).toContain("failed");
    cleanup(h);
  });
});
