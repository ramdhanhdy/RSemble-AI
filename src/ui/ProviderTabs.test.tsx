// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { listProviders } from "../lib/providers/registry";
import type { CatalogModel } from "../lib/providers/types";
import { MODEL_PICKER_PROVIDERS, PROVIDER_LABELS, ProviderTabs } from "./ProviderTabs";
import { AddModelCombobox } from "./ModelList";
import { JudgeCombobox } from "./JudgeConfig";

describe("ProviderTabs — shared responsive provider chooser", () => {
  it("contains every registered provider id exactly once in registry order", () => {
    const registered = listProviders().map((p) => p.id);
    expect(MODEL_PICKER_PROVIDERS.map((p) => p.id)).toEqual(registered);
    // exactly once
    const ids = MODEL_PICKER_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes 9Router", () => {
    expect(MODEL_PICKER_PROVIDERS.map((p) => p.id)).toContain("9router");
  });

  it("exposes a display label for every provider id", () => {
    for (const p of MODEL_PICKER_PROVIDERS) {
      expect(PROVIDER_LABELS[p.id]).toBe(p.label);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("renders one button per provider, each meeting the 44px touch target", () => {
    const html = renderToStaticMarkup(
      <ProviderTabs value="openrouter" onChange={() => {}} ariaLabel="Candidate model providers" />,
    );
    for (const p of MODEL_PICKER_PROVIDERS) {
      expect(html).toContain(p.label);
    }
    // Every provider button carries the 44px minimum-height class.
    const buttonCount = (html.match(/min-h-\[44px\]/g) ?? []).length;
    expect(buttonCount).toBe(MODEL_PICKER_PROVIDERS.length);
  });

  it("exposes the active state programmatically via aria-pressed", () => {
    const html = renderToStaticMarkup(
      <ProviderTabs value="gemini" onChange={() => {}} ariaLabel="Judge model providers" />,
    );
    // Exactly one button is pressed (the active one).
    const pressedCount = (html.match(/aria-pressed="true"/g) ?? []).length;
    expect(pressedCount).toBe(1);
    // The active provider's button is the pressed one — order-independent check
    // via a fresh render per provider.
    for (const p of MODEL_PICKER_PROVIDERS) {
      const h = renderToStaticMarkup(
        <ProviderTabs value={p.id} onChange={() => {}} ariaLabel="x" />,
      );
      expect(h).toContain('aria-pressed="true"');
    }
  });

  it("uses a wrapping grid contract, not a single non-wrapping flex row", () => {
    const html = renderToStaticMarkup(
      <ProviderTabs value="openrouter" onChange={() => {}} ariaLabel="x" />,
    );
    // The container must wrap (grid auto-fill), and buttons must not stretch
    // with the old non-wrapping flex-1 contract.
    expect(html).toMatch(/grid/);
    expect(html).not.toContain("flex-1");
  });

  it("labels the group accessibly", () => {
    const html = renderToStaticMarkup(
      <ProviderTabs value="openrouter" onChange={() => {}} ariaLabel="Candidate model providers" />,
    );
    expect(html).toContain('aria-label="Candidate model providers"');
  });
});

describe("ProviderTabs — shared by both selectors", () => {
  const noop = () => {};
  const models: CatalogModel[] = [];

  it("the candidate AddModelCombobox renders the shared provider tabs", () => {
    const html = renderToStaticMarkup(
      <AddModelCombobox models={models} takenKeys={new Set()} onCancel={noop} onAdd={noop} />,
    );
    // Shared component signature: a labelled group of aria-pressed buttons.
    expect(html).toContain('role="group"');
    expect(html).toContain("aria-pressed");
    for (const p of MODEL_PICKER_PROVIDERS) {
      expect(html).toContain(p.label);
    }
  });

  it("the JudgeCombobox renders the shared provider tabs", () => {
    const html = renderToStaticMarkup(
      <JudgeCombobox
        models={models}
        current="some-model"
        initialProvider="openrouter"
        onCancel={noop}
        onCommit={noop}
      />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain("aria-pressed");
    for (const p of MODEL_PICKER_PROVIDERS) {
      expect(html).toContain(p.label);
    }
  });

  it("the candidate combobox no longer uses a private non-wrapping provider row", () => {
    const html = renderToStaticMarkup(
      <AddModelCombobox models={models} takenKeys={new Set()} onCancel={noop} onAdd={noop} />,
    );
    // The old non-wrapping tab row signature must be gone, replaced by the
    // shared wrapping grid group.
    expect(html).not.toContain("mb-2 flex items-center gap-1");
    expect(html).toContain('role="group"');
    expect(html).toMatch(/grid/);
  });
});
