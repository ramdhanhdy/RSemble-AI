// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AddModelCombobox, ModelList } from "./ModelList";
import type { CatalogModel } from "../lib/providers/types";
import type { ModelSlot } from "../studio-data";
import type { Action } from "../studio-engine";
import { InMemoryRunRepository } from "../lib/persistence/run-repository";
import { RepositoryContext } from "../lib/persistence/repository-context";

function withRepo(node: React.ReactNode) {
  return (
    <RepositoryContext.Provider
      value={{ runRepo: new InMemoryRunRepository(), evalRepo: null, db: null, storageState: "ready", retry: () => {} }}
    >
      {node}
    </RepositoryContext.Provider>
  );
}

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
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

// ---------------------------------------------------------------------------
// AddModelCombobox — complete catalog scrolling (no eight-item cutoff) (spec §8.4)
// ---------------------------------------------------------------------------

function geminiCatalog(n: number): CatalogModel[] {
  // Ordered newest-first, simulating the adapter's recency output.
  return Array.from({ length: n }, (_, i) => ({
    id: `gemini-3.${n - i}-flash`,
    name: `Gemini 3.${n - i} Flash`,
    providerId: "gemini" as const,
  }));
}

describe("AddModelCombobox — complete catalog (no slice cutoff)", () => {
  it("renders every catalog entry on an empty query, not just the first eight", () => {
    const models = geminiCatalog(12);
    const h = render(
      <AddModelCombobox models={models} takenKeys={new Set()} onCancel={() => {}} onAdd={() => {}} />,
    );
    try {
      // Switch to the Gemini provider tab (default is OpenRouter).
      act(() => h.byText("Gemini")!.click());
      const catalogBtns = h.$$("ul button");
      // All 12 entries render — the old .slice(0, 8) would have shown 8.
      expect(catalogBtns.length).toBe(12);
      // First item is the newest ordered entry supplied (models[0]).
      expect(catalogBtns[0].textContent).toContain(models[0].id);
      // Items 9 and 12 (1-indexed) exist in the scrollable list.
      expect(catalogBtns[8].textContent).toContain(models[8].id);
      expect(catalogBtns[11].textContent).toContain(models[11].id);
    } finally {
      cleanup(h);
    }
  });

  it("keeps the bounded-height overflow list class", () => {
    const models = geminiCatalog(12);
    const h = render(
      <AddModelCombobox models={models} takenKeys={new Set()} onCancel={() => {}} onAdd={() => {}} />,
    );
    try {
      act(() => h.byText("Gemini")!.click());
      const list = h.$("ul")!;
      expect(list.className).toContain("max-h-48");
      expect(list.className).toContain("overflow-y-auto");
    } finally {
      cleanup(h);
    }
  });

  it("a search can return every matching item, including ones near the bottom", () => {
    const models = geminiCatalog(12);
    const h = render(
      <AddModelCombobox models={models} takenKeys={new Set()} onCancel={() => {}} onAdd={() => {}} />,
    );
    try {
      act(() => h.byText("Gemini")!.click());
      const input = h.$("input#model-search") as HTMLInputElement;
      // Search for a bottom-of-list model.
      typeInto(input, models[11].id);
      const matches = h.$$("ul button");
      expect(matches.length).toBe(1);
      expect(matches[0].textContent).toContain(models[11].id);
    } finally {
      cleanup(h);
    }
  });

  it("a nonmatching manual slug can still be committed exactly", () => {
    const models = geminiCatalog(12);
    let added: ModelSlot | null = null;
    const h = render(
      <AddModelCombobox
        models={models}
        takenKeys={new Set()}
        onCancel={() => {}}
        onAdd={(slot) => {
          added = slot;
        }}
      />,
    );
    try {
      act(() => h.byText("Gemini")!.click());
      const input = h.$("input#model-search") as HTMLInputElement;
      typeInto(input, "gemini-custom-fake");
      const addSlugBtn = h.$$("button").find((b) =>
        b.getAttribute("aria-label")?.startsWith("Add slug "),
      ) as HTMLButtonElement;
      expect(addSlugBtn).toBeTruthy();
      act(() => addSlugBtn.click());
      expect(added).not.toBeNull();
      expect(added!.slug).toBe("gemini-custom-fake");
      expect(added!.providerId).toBe("gemini");
    } finally {
      cleanup(h);
    }
  });
});

// ---------------------------------------------------------------------------
// ModelList — switch model for an existing slot (run-recovery: candidate swap)
// ---------------------------------------------------------------------------

describe("ModelList — switch model for a slot", () => {
  const slot: ModelSlot = {
    id: "slot-2",
    providerId: "umans",
    provider: "Umans",
    model: "Kimi K3",
    slug: "kimi-k3",
    enabled: true,
  };

  it("opens the edit combobox on the slot's CURRENT provider, not OpenRouter", () => {
    const h = render(
      withRepo(<ModelList slots={[slot]} models={NO_MODELS} dispatch={() => {}} />),
    );
    try {
      act(() => (h.$('button[aria-label="Switch model for Kimi K3"]') as HTMLButtonElement).click());
      // The Umans tab is active in the opened combobox (aria-pressed/selected).
      const umansTab = h.byText("Umans")!;
      const pressed = umansTab.getAttribute("aria-pressed") ?? umansTab.getAttribute("aria-selected");
      expect(pressed).toBe("true");
    } finally {
      cleanup(h);
    }
  });

  it("committing a different provider dispatches SWAP_SLOT with the new providerId and the SAME slot id", () => {
    const dispatched: Action[] = [];
    const h = render(
      withRepo(<ModelList slots={[slot]} models={NO_MODELS} dispatch={(a) => dispatched.push(a)} />),
    );
    try {
      act(() => (h.$('button[aria-label="Switch model for Kimi K3"]') as HTMLButtonElement).click());
      // Switch to the Gemini provider tab.
      act(() => h.byText("Gemini")!.click());
      const input = h.$("input#model-search") as HTMLInputElement;
      typeInto(input, "gemini-3.6-flash");
      // Commit the manual slug (commitLabel is "Switch to" in the edit flow).
      const commitBtn = h.$$("button").find((b) =>
        b.getAttribute("aria-label")?.startsWith("Switch to "),
      ) as HTMLButtonElement;
      expect(commitBtn).toBeTruthy();
      act(() => commitBtn.click());

      const swap = dispatched.find((a) => a.type === "SWAP_SLOT");
      expect(swap).toBeDefined();
      expect(swap).toMatchObject({
        type: "SWAP_SLOT",
        id: "slot-2", // stable identity — the candidate→slot retry link survives
        providerId: "gemini",
        slug: "gemini-3.6-flash",
      });
    } finally {
      cleanup(h);
    }
  });

  it("does not dispatch SWAP_SLOT when the edit is cancelled", () => {
    const dispatched: Action[] = [];
    const h = render(
      withRepo(<ModelList slots={[slot]} models={NO_MODELS} dispatch={(a) => dispatched.push(a)} />),
    );
    try {
      act(() => (h.$('button[aria-label="Switch model for Kimi K3"]') as HTMLButtonElement).click());
      const input = h.$("input#model-search") as HTMLInputElement;
      typeInto(input, "gemini-3.6-flash");
      // X with a non-empty query clears it; X again cancels.
      act(() => (h.$('button[aria-label="Clear model search"]') as HTMLButtonElement).click());
      act(() => (h.$('button[aria-label="Cancel add model"]') as HTMLButtonElement).click());
      expect(dispatched.find((a) => a.type === "SWAP_SLOT")).toBeUndefined();
    } finally {
      cleanup(h);
    }
  });
});
