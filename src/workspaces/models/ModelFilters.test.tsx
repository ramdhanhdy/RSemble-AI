// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { render, cleanup } from "./models-test-harness";
import { ModelFilters, type ModelFiltersOptions } from "./ModelFilters";
import { DEFAULT_MODEL_LIST_URL_STATE, type ModelListUrlState } from "./models-url-state";

const OPTIONS: ModelFiltersOptions = {
  providers: [{ id: "providerA", label: "Provider A" }],
  models: ["alpha-1"],
  signatures: ["reason-high"],
  evidenceClasses: [
    { id: "exploratory", label: "Exploratory" },
    { id: "verified", label: "Verified" },
  ],
  families: [{ id: "family-transform", name: "Code transformation" }],
};

function capture() {
  const received: ModelListUrlState[] = [];
  const onChange = (v: ModelListUrlState) => received.push(v);
  return { onChange, received };
}

describe("ModelFilters — eight filters in spec order (Fable §6.2)", () => {
  it("renders the eight filters with data-filter hooks in spec order", () => {
    const { onChange } = capture();
    const h = render(
      <ModelFilters value={DEFAULT_MODEL_LIST_URL_STATE} onChange={onChange} options={OPTIONS} />,
    );
    const hooks = h.$$("[data-filter]").map((el) => el.getAttribute("data-filter"));
    expect(hooks).toContain("search");
    expect(hooks).toContain("provider");
    expect(hooks).toContain("model");
    expect(hooks).toContain("versionStatus");
    expect(hooks).toContain("signature");
    expect(hooks).toContain("evidenceClass");
    expect(hooks).toContain("family");
    expect(hooks).toContain("recency");
    expect(hooks).toContain("sort");
    const filterHooks = hooks.filter((x) => x !== "sort");
    expect(filterHooks).toHaveLength(8);
    cleanup(h);
  });

  it("preserves the spec order of the eight filter hooks in the DOM", () => {
    const { onChange } = capture();
    const h = render(
      <ModelFilters value={DEFAULT_MODEL_LIST_URL_STATE} onChange={onChange} options={OPTIONS} />,
    );
    const order = h.$$("[data-filter]").map((el) => el.getAttribute("data-filter")!);
    const expected = [
      "search",
      "provider",
      "model",
      "versionStatus",
      "signature",
      "evidenceClass",
      "family",
      "recency",
      "sort",
    ];
    expect(order).toEqual(expected);
    cleanup(h);
  });

  it("desktop filter region is a 2-column grid at lg", () => {
    const { onChange } = capture();
    const h = render(
      <ModelFilters value={DEFAULT_MODEL_LIST_URL_STATE} onChange={onChange} options={OPTIONS} />,
    );
    const desktop = h.$("[data-desktop-filters]")!;
    expect(desktop.className).toContain("grid-cols-2");
    expect(desktop.className).toContain("lg:grid");
    cleanup(h);
  });
});

describe("ModelFilters — applied-count badge + mobile sheet", () => {
  it("shows the applied-count badge on the mobile toggle when filters are set", () => {
    const value: ModelListUrlState = {
      ...DEFAULT_MODEL_LIST_URL_STATE,
      provider: "providerA",
      recency: "30",
    };
    const { onChange } = capture();
    const h = render(<ModelFilters value={value} onChange={onChange} options={OPTIONS} />);
    const badge = h.$("[data-applied-count]")!;
    expect(badge.textContent).toBe("2");
    cleanup(h);
  });

  it("does not count sort toward the applied-filter badge", () => {
    const value: ModelListUrlState = {
      ...DEFAULT_MODEL_LIST_URL_STATE,
      sort: "latest",
    };
    const { onChange } = capture();
    const h = render(<ModelFilters value={value} onChange={onChange} options={OPTIONS} />);
    expect(h.$("[data-applied-count]")).toBeNull();
    cleanup(h);
  });

  it("toggling the sheet open reveals the mobile filter sheet", () => {
    const { onChange } = capture();
    const h = render(
      <ModelFilters value={DEFAULT_MODEL_LIST_URL_STATE} onChange={onChange} options={OPTIONS} />,
    );
    expect(h.$("[data-filter-sheet]")).toBeNull();
    act(() => {
      h.$("[data-action='toggle-filters']")!.click();
    });
    expect(h.$("[data-filter-sheet]")).not.toBeNull();
    cleanup(h);
  });
});

describe("ModelFilters — controlled changes reset page to 1", () => {
  it("changing a select emits the patched state with page reset to 1", () => {
    const value: ModelListUrlState = {
      ...DEFAULT_MODEL_LIST_URL_STATE,
      page: 3,
    };
    const { onChange, received } = capture();
    const h = render(<ModelFilters value={value} onChange={onChange} options={OPTIONS} />);
    const select = h.$("[data-filter='provider']") as HTMLSelectElement;
    select.value = "providerA";
    act(() => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(received).toHaveLength(1);
    expect(received[0].provider).toBe("providerA");
    expect(received[0].page).toBe(1);
    cleanup(h);
  });

  it("the D1 sort toggle switches between canonical and latest activity", () => {
    const { onChange, received } = capture();
    const h = render(
      <ModelFilters value={DEFAULT_MODEL_LIST_URL_STATE} onChange={onChange} options={OPTIONS} />,
    );
    const sortBtn = h.$("[data-sort]")!;
    expect(sortBtn.getAttribute("data-sort")).toBe("canonical");
    act(() => {
      sortBtn.click();
    });
    expect(received[0].sort).toBe("latest");
    cleanup(h);
  });

  it("clear filters resets all eight filters but preserves sort", () => {
    const value: ModelListUrlState = {
      ...DEFAULT_MODEL_LIST_URL_STATE,
      provider: "providerA",
      recency: "30",
      sort: "latest",
    };
    const onChange = vi.fn();
    const h = render(<ModelFilters value={value} onChange={onChange} options={OPTIONS} />);
    act(() => {
      h.$("[data-action='toggle-filters']")!.click();
    });
    act(() => {
      h.$("[data-filter-sheet] [data-action='clear-filters']")!.click();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as ModelListUrlState;
    expect(next.provider).toBe("");
    expect(next.recency).toBe("");
    expect(next.sort).toBe("latest");
    expect(next.page).toBe(1);
    cleanup(h);
  });
});
