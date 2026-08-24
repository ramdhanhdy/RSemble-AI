// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SuitePreflightDialog, type SuitePreflightEntry } from "./SuitePreflightDialog";
import type { ModelProbeState } from "../../lib/providers/model-probe";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderWithRouter(node: ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  // Base UI Dialog renders into a portal on document.body.
  return {
    container,
    root,
    $: (s) => document.body.querySelector<HTMLElement>(s),
    $$: (s) => [...document.body.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle() {
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const ready: ModelProbeState = { kind: "ready", latencyMs: 120, testedAt: 100 };
const failed: ModelProbeState = {
  kind: "failed",
  category: "unauthorized",
  message: "9Router · cmc/model: unauthorized (HTTP 401)",
  testedAt: 100,
};
const untested: ModelProbeState = { kind: "untested" };

function makeEntries(): { candidates: SuitePreflightEntry[]; judge: SuitePreflightEntry } {
  return {
    candidates: [
      { modelKey: "9router:route-a", label: "9Router · route-a", state: ready },
      { modelKey: "9router:route-b", label: "9Router · route-b", state: failed },
      { modelKey: "umans:model", label: "Umans · model", state: untested },
    ],
    judge: { modelKey: "openrouter:judge", label: "OpenRouter · judge", state: ready },
  };
}

describe("SuitePreflightDialog", () => {
  it("shows ready, failed, and untested counts", async () => {
    const { candidates, judge } = makeEntries();
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        judge={judge}
        onRunAnyway={() => {}}
      />,
    );
    await settle();
    const text = document.body.textContent ?? "";
    expect(text).toContain("2 Ready");
    expect(text).toContain("1 Failed");
    expect(text).toContain("1 Untested");
    cleanup(h);
  });

  it("lists failed models with sanitized reasons", async () => {
    const { candidates, judge } = makeEntries();
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        judge={judge}
        onRunAnyway={() => {}}
      />,
    );
    await settle();
    const text = document.body.textContent ?? "";
    expect(text).toContain("9Router · route-b");
    expect(text).toContain("unauthorized");
    cleanup(h);
  });

  it("shows Review model tests as primary when failures exist", async () => {
    const { candidates, judge } = makeEntries();
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        judge={judge}
        onRunAnyway={() => {}}
      />,
    );
    await settle();
    const labels = h.$$("button").map((b) => b.textContent?.trim());
    expect(labels).toContain("Review model tests");
    expect(labels).toContain("Run anyway");
    cleanup(h);
  });

  it("shows Run suite as primary when no failures exist", async () => {
    const { candidates, judge } = makeEntries();
    const allReady = {
      candidates: candidates.map((c) => ({
        ...c,
        state: c.state.kind === "failed" ? ready : c.state,
      })),
      judge,
    };
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={allReady.candidates}
        judge={allReady.judge}
        onRunAnyway={() => {}}
      />,
    );
    await settle();
    const labels = h.$$("button").map((b) => b.textContent?.trim());
    expect(labels).toContain("Run task set");
    expect(labels).not.toContain("Run anyway");
    cleanup(h);
  });

  it("recommends tests for untested-only state but permits execution", async () => {
    const { candidates, judge } = makeEntries();
    const allUntested = {
      candidates: candidates.map((c) => ({ ...c, state: untested })),
      judge: { ...judge, state: untested },
    };
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={allUntested.candidates}
        judge={allUntested.judge}
        onRunAnyway={() => {}}
      />,
    );
    await settle();
    const text = document.body.textContent ?? "";
    expect(text).toContain("untested");
    expect(text).toContain("recommended");
    const labels = h.$$("button").map((b) => b.textContent?.trim());
    expect(labels).toContain("Run task set");
    cleanup(h);
  });

  it("calls onRunAnyway when Run anyway is clicked", async () => {
    const { candidates, judge } = makeEntries();
    const onRunAnyway = vi.fn();
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        judge={judge}
        onRunAnyway={onRunAnyway}
      />,
    );
    await settle();
    const runAnyway = h.$$("button").find((b) => b.textContent?.trim() === "Run anyway");
    expect(runAnyway).toBeTruthy();
    act(() => runAnyway!.click());
    await settle();
    expect(onRunAnyway).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("does not offer a Run ready models only option", async () => {
    const { candidates, judge } = makeEntries();
    const h = renderWithRouter(
      <SuitePreflightDialog
        open={true}
        onOpenChange={() => {}}
        candidates={candidates}
        judge={judge}
        onRunAnyway={() => {}}
      />,
    );
    await settle();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/run ready models only/i);
    cleanup(h);
  });
});
