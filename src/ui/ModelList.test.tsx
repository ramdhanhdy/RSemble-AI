// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AddModelCombobox } from "./ModelList";
import type { CatalogModel } from "../lib/providers/types";
import type { ModelSlot } from "../studio-data";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
  $: (selector: string) => HTMLElement | null;
  $$: (selector: string) => HTMLElement[];
  byText: (text: string) => HTMLElement | undefined;
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    byText: (t) =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent?.trim() === t,
      ),
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

/** Simulate typing into a React-controlled input without testing-library. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const NO_MODELS: CatalogModel[] = [];

describe("AddModelCombobox — provider switch and clear-X semantics", () => {
  it("switching providers clears the query and focuses the input", () => {
    const h = render(
      <AddModelCombobox
        models={NO_MODELS}
        takenKeys={new Set()}
        onCancel={() => {}}
        onAdd={() => {}}
      />,
    );
    try {
      const input = h.$("input#model-search") as HTMLInputElement;
      act(() => input.focus());
      typeInto(input, "openai/gpt-4");
      expect(input.value).toBe("openai/gpt-4");

      const geminiTab = h.byText("Gemini")!;
      act(() => geminiTab.click());

      const after = h.$("input#model-search") as HTMLInputElement;
      expect(after.value).toBe("");
      expect(document.activeElement).toBe(after);
    } finally {
      cleanup(h);
    }
  });

  it("X clears a non-empty query without closing the selector", () => {
    const h = render(
      <AddModelCombobox
        models={NO_MODELS}
        takenKeys={new Set()}
        onCancel={() => {}}
        onAdd={() => {}}
      />,
    );
    try {
      const input = h.$("input#model-search") as HTMLInputElement;
      typeInto(input, "openai/gpt-4");
      expect(input.value).toBe("openai/gpt-4");

      const xBtn = h.$('button[aria-label="Clear model search"]') as HTMLButtonElement;
      expect(xBtn).not.toBeNull();
      act(() => xBtn.click());

      const after = h.$("input#model-search") as HTMLInputElement;
      // Selector stays open (input still present) and is cleared + focused.
      expect(after).not.toBeNull();
      expect(after.value).toBe("");
      expect(document.activeElement).toBe(after);
    } finally {
      cleanup(h);
    }
  });

  it("X closes the selector only when the query is already empty", () => {
    let cancelled = 0;
    const h = render(
      <AddModelCombobox
        models={NO_MODELS}
        takenKeys={new Set()}
        onCancel={() => {
          cancelled += 1;
        }}
        onAdd={() => {}}
      />,
    );
    try {
      // Query is empty → X cancels.
      const xEmpty = h.$('button[aria-label="Cancel add model"]') as HTMLButtonElement;
      expect(xEmpty).not.toBeNull();
      act(() => xEmpty.click());
      expect(cancelled).toBe(1);
    } finally {
      cleanup(h);
    }
  });

  it("the X button aria-label reflects the current action", () => {
    const h = render(
      <AddModelCombobox
        models={NO_MODELS}
        takenKeys={new Set()}
        onCancel={() => {}}
        onAdd={() => {}}
      />,
    );
    try {
      // Empty query → cancel label.
      expect(h.$('button[aria-label="Cancel add model"]')).not.toBeNull();
      expect(h.$('button[aria-label="Clear model search"]')).toBeNull();

      const input = h.$("input#model-search") as HTMLInputElement;
      typeInto(input, "openai/gpt-4");
      // Non-empty query → clear label.
      expect(h.$('button[aria-label="Clear model search"]')).not.toBeNull();
      expect(h.$('button[aria-label="Cancel add model"]')).toBeNull();
    } finally {
      cleanup(h);
    }
  });

  it("never adds a slot during clear or cancel", () => {
    const added: ModelSlot[] = [];
    const h = render(
      <AddModelCombobox
        models={NO_MODELS}
        takenKeys={new Set()}
        onCancel={() => {}}
        onAdd={(slot) => added.push(slot)}
      />,
    );
    try {
      const input = h.$("input#model-search") as HTMLInputElement;
      typeInto(input, "openai/gpt-4");

      // Clear via X (non-empty).
      act(() => (h.$('button[aria-label="Clear model search"]') as HTMLButtonElement).click());
      // Cancel via X (now empty).
      act(() => (h.$('button[aria-label="Cancel add model"]') as HTMLButtonElement).click());
      expect(added).toHaveLength(0);
    } finally {
      cleanup(h);
    }
  });
});
