// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { parseAttentionItem, type AttentionItem } from "../lib/attention/attention-types";
import {
  mergeDeduplicateAndSortAttention,
  type AttentionQueryResult,
} from "../lib/attention/attention-query";
import { AttentionPopover } from "./AttentionPopover";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function item(n: number, extras: Partial<AttentionItem> = {}): AttentionItem {
  return parseAttentionItem({
    key: `evaluation:exp-${n}:evaluation_interrupted`,
    kind: "evaluation_recovery",
    sourceId: `exp-${n}`,
    ownerHref: `/evaluations/results/exp-${n}`,
    title: "Interrupted evaluation",
    summary: "Retry incomplete tasks on the evaluation result page.",
    reasonCode: "evaluation_interrupted",
    severity: "actionable",
    occurredAt: 1_700_000_000_000 - n * 60_000,
    supersessionKey: `evaluation:exp-${n}`,
    ...extras,
  });
}

function snapshotOf(items: AttentionItem[]): AttentionQueryResult {
  return mergeDeduplicateAndSortAttention(items);
}

function LocationProbe() {
  const location = useLocation();
  return <div data-location={location.pathname} />;
}

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function renderPopover(snapshot: AttentionQueryResult): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/compare"]}>
        <AttentionPopover snapshot={snapshot} now={1_700_000_000_000} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
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

describe("AttentionPopover", () => {
  it("is absent when there is nothing to recover", () => {
    const h = renderPopover(snapshotOf([]));
    expect(h.$("[data-attention-trigger]")).toBeNull();
    cleanup(h);
  });

  it("names the count for assistive technology", () => {
    const h = renderPopover(snapshotOf([item(1)]));
    const trigger = h.$("[data-attention-trigger]");
    expect(trigger?.getAttribute("aria-label")).toMatch(/1/);
    expect(trigger?.textContent).toMatch(/1/);
    cleanup(h);
  });

  it("caps the popover at five items and offers View all", async () => {
    const h = renderPopover(snapshotOf(Array.from({ length: 12 }, (_, i) => item(i))));
    const trigger = h.$("[data-attention-trigger]");
    expect(trigger?.getAttribute("aria-label")).toMatch(/9\+/);
    await act(async () => {
      trigger?.click();
    });
    expect(h.$$("[data-attention-item]")).toHaveLength(5);
    const viewAll = h.$("[data-attention-view-all]");
    expect(viewAll).toBeTruthy();
    expect(viewAll?.getAttribute("href")).toBe("/attention");
    cleanup(h);
  });

  it("navigates to the owner and never exposes Retry, Resume, or Add model", async () => {
    const h = renderPopover(snapshotOf([item(1)]));
    await act(async () => {
      h.$("[data-attention-trigger]")?.click();
    });
    const text = h.container.textContent ?? "";
    expect(text).not.toMatch(/Retry|Resume|Add model/i);
    const link = h.$("[data-attention-item]");
    expect(link?.getAttribute("href")).toBe("/evaluations/results/exp-1#attention");
    await act(async () => {
      link?.click();
    });
    expect(h.$("[data-location]")?.getAttribute("data-location")).toBe(
      "/evaluations/results/exp-1",
    );
    cleanup(h);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const h = renderPopover(snapshotOf([item(1)]));
    const trigger = h.$("[data-attention-trigger]");
    await act(async () => {
      trigger?.focus();
      trigger?.click();
    });
    expect(h.$("[data-attention-dialog]")).toBeTruthy();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(h.$("[data-attention-dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    cleanup(h);
  });
});
