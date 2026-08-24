// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AttentionOwnerHandoff } from "./AttentionOwnerHandoff";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function renderHandoff(hash: string, recoveryAvailable: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[`/evaluations/results/exp-1${hash}`]}>
        <AttentionOwnerHandoff recoveryAvailable={recoveryAvailable} />
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s: string) => container.querySelector<HTMLElement>(s),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("AttentionOwnerHandoff", () => {
  it("is silent without the attention hash", () => {
    const h = renderHandoff("", true);
    expect(h.$("[data-attention-focus]")).toBeNull();
    expect(h.$("[data-attention-stale]")).toBeNull();
    act(() => h.root.unmount());
  });

  it("focuses the recovery section when the action is still available", () => {
    const h = renderHandoff("#attention", true);
    const focus = h.$("[data-attention-focus]");
    expect(focus).toBeTruthy();
    expect(document.activeElement).toBe(focus);
    expect(h.$("[data-attention-stale]")).toBeNull();
    act(() => h.root.unmount());
  });

  it("says the item no longer needs attention when recovery is gone", () => {
    const h = renderHandoff("#attention", false);
    expect(h.$("[data-attention-stale]")?.textContent).toMatch(/no longer needs attention/i);
    expect(h.$("[data-attention-focus]")).toBeNull();
    act(() => h.root.unmount());
  });
});
