// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { parseAttentionItem, type AttentionItem } from "../../lib/attention/attention-types";
import { mergeDeduplicateAndSortAttention } from "../../lib/attention/attention-query";
import { AttentionWorkspace } from "./AttentionWorkspace";

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
    occurredAt: 100 + n,
    supersessionKey: `evaluation:exp-${n}`,
    ...extras,
  });
}

interface Harness {
  container: HTMLDivElement;
  root: { unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function renderWorkspace(props: Parameters<typeof AttentionWorkspace>[0]): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <AttentionWorkspace {...props} />
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

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AttentionWorkspace", () => {
  it("renders an explanatory empty state", () => {
    const h = renderWorkspace({ snapshot: mergeDeduplicateAndSortAttention([]) });
    expect(h.container.textContent).toMatch(/nothing needs attention/i);
    expect(h.$("[data-attention-item]")).toBeNull();
    act(() => h.root.unmount());
  });

  it("lists the same ordered set as the query and links to Records", () => {
    const snapshot = mergeDeduplicateAndSortAttention([item(2), item(1)]);
    const h = renderWorkspace({ snapshot });
    const links = h.$$("[data-attention-item]");
    expect(links.map((el) => el.getAttribute("href"))).toEqual([
      "/evaluations/results/exp-2#attention",
      "/evaluations/results/exp-1#attention",
    ]);
    expect(h.$("[data-attention-records]")?.getAttribute("href")).toBe("/records");
    expect(
      h.$$("button, a").some((el) => /^(Retry|Resume|Add model)$/i.test((el.textContent ?? "").trim())),
    ).toBe(false);
    act(() => h.root.unmount());
  });

  it("shows loading and error states without inventing items", () => {
    const loading = renderWorkspace({ loading: true });
    expect(loading.container.textContent).toMatch(/loading/i);
    expect(loading.$("[data-attention-item]")).toBeNull();
    act(() => loading.root.unmount());

    const failed = renderWorkspace({ error: "Records index unavailable." });
    expect(failed.$("[role='alert']")?.textContent).toMatch(/unavailable/i);
    expect(failed.$("[data-attention-item]")).toBeNull();
    act(() => failed.root.unmount());
  });
});
