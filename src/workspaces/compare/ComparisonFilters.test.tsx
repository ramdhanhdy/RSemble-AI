// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ComparisonFilters,
  EMPTY_COMPARISON_FILTERS,
  type ComparisonFiltersValue,
} from "./ComparisonFilters";

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
  act(() => {
    root.render(node);
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
  vi.clearAllMocks();
});

describe("ComparisonFilters", () => {
  it("renders search input with accessible label and placeholder", () => {
    const onChange = vi.fn();
    const h = render(<ComparisonFilters value={EMPTY_COMPARISON_FILTERS} onChange={onChange} />);

    const searchInput = h.$("input[type='search']") as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    expect(searchInput?.getAttribute("aria-label")).toBe("Search comparisons");
    expect(searchInput?.placeholder).toMatch(/search/i);

    cleanup(h);
  });

  it("emits updated text filter when typing in search input", () => {
    const onChange = vi.fn();
    const h = render(<ComparisonFilters value={EMPTY_COMPARISON_FILTERS} onChange={onChange} />);

    const searchInput = h.$("input[type='search']") as HTMLInputElement;
    act(() => {
      searchInput.value = "Sorting algorithm";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Sorting algorithm",
      }),
    );

    cleanup(h);
  });

  it("renders desktop filter dropdowns for model, status, mode, binding, and date", () => {
    const onChange = vi.fn();
    const h = render(
      <ComparisonFilters
        value={EMPTY_COMPARISON_FILTERS}
        onChange={onChange}
        modelKeys={["openai:gpt-4o", "anthropic:claude-3-5-sonnet"]}
      />,
    );

    const desktopFilters = h.$("[data-desktop-filters]");
    expect(desktopFilters).not.toBeNull();

    const modelSelect = h.$("select[data-filter='model']") as HTMLSelectElement | null;
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.textContent).toContain("All models");
    expect(modelSelect?.textContent).toContain("openai:gpt-4o");
    expect(modelSelect?.textContent).toContain("anthropic:claude-3-5-sonnet");

    const statusSelect = h.$("select[data-filter='status']") as HTMLSelectElement | null;
    expect(statusSelect).not.toBeNull();
    expect(statusSelect?.textContent).toContain("All statuses");
    expect(statusSelect?.textContent).toContain("Completed");
    expect(statusSelect?.textContent).toContain("Interrupted");
    expect(statusSelect?.textContent).toContain("Partial");
    expect(statusSelect?.textContent).toContain("Failed");

    const modeSelect = h.$("select[data-filter='mode']") as HTMLSelectElement | null;
    expect(modeSelect).not.toBeNull();
    expect(modeSelect?.textContent).toContain("All modes");
    expect(modeSelect?.textContent).toContain("Rank");
    expect(modeSelect?.textContent).toContain("Fuse");

    const bindingSelect = h.$("select[data-filter='binding']") as HTMLSelectElement | null;
    expect(bindingSelect).not.toBeNull();
    expect(bindingSelect?.textContent).toContain("All bindings");
    expect(bindingSelect?.textContent).toContain("Ad hoc");
    expect(bindingSelect?.textContent).toContain("Canonical");

    cleanup(h);
  });

  it("emits filter updates when status, mode, binding, or model are changed", () => {
    const onChange = vi.fn();
    const h = render(
      <ComparisonFilters
        value={EMPTY_COMPARISON_FILTERS}
        onChange={onChange}
        modelKeys={["openai:gpt-4o"]}
      />,
    );

    const statusSelect = h.$("select[data-filter='status']") as HTMLSelectElement;
    act(() => {
      statusSelect.value = "interrupted";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "interrupted",
      }),
    );

    const modeSelect = h.$("select[data-filter='mode']") as HTMLSelectElement;
    act(() => {
      modeSelect.value = "fuse";
      modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "fuse",
      }),
    );

    const bindingSelect = h.$("select[data-filter='binding']") as HTMLSelectElement;
    act(() => {
      bindingSelect.value = "canonical";
      bindingSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingKind: "canonical",
      }),
    );

    cleanup(h);
  });

  it("shows clear button when any filter is active and resets all filters on click", () => {
    const onChange = vi.fn();
    const activeFilters: ComparisonFiltersValue = {
      text: "test",
      modelKey: "openai:gpt-4o",
      status: "completed",
      mode: "rank",
      bindingKind: "ad_hoc",
      taskId: "",
    };

    const h = render(<ComparisonFilters value={activeFilters} onChange={onChange} />);

    const clearButton = h.$("[data-action='clear-filters']");
    expect(clearButton).not.toBeNull();

    act(() => {
      clearButton?.click();
    });

    expect(onChange).toHaveBeenCalledWith(EMPTY_COMPARISON_FILTERS);

    cleanup(h);
  });

  it("hides clear button when filters are empty", () => {
    const onChange = vi.fn();
    const h = render(<ComparisonFilters value={EMPTY_COMPARISON_FILTERS} onChange={onChange} />);

    const clearButton = h.$("[data-action='clear-filters']");
    expect(clearButton).toBeNull();

    cleanup(h);
  });

  it("toggles mobile filter sheet with badge showing active filter count", () => {
    const onChange = vi.fn();
    const activeFilters: ComparisonFiltersValue = {
      ...EMPTY_COMPARISON_FILTERS,
      status: "interrupted",
      mode: "rank",
    };

    const h = render(<ComparisonFilters value={activeFilters} onChange={onChange} />);

    const toggleButton = h.$("[data-action='toggle-filters']");
    expect(toggleButton).not.toBeNull();
    expect(toggleButton?.getAttribute("aria-expanded")).toBe("false");
    expect(toggleButton?.textContent).toContain("2"); // 2 active filters

    // Open sheet
    act(() => {
      toggleButton?.click();
    });

    expect(toggleButton?.getAttribute("aria-expanded")).toBe("true");
    const mobileSheet = h.$("[data-mobile-filters]");
    expect(mobileSheet).not.toBeNull();

    // Close sheet
    act(() => {
      toggleButton?.click();
    });
    expect(toggleButton?.getAttribute("aria-expanded")).toBe("false");

    cleanup(h);
  });
});
