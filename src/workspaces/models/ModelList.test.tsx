// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, type Harness } from "./models-test-harness";
import {
  FirstUseState,
  LoadErrorState,
  ModelList,
  SavedRollupsSection,
  ZeroMatchState,
  formatModelWindow,
  type ModelListRowData,
} from "./ModelList";
import type { ModelConfigurationCatalogEntry } from "../../lib/model-profiles/model-configuration-query";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeEntry(
  over: Partial<ModelConfigurationCatalogEntry> = {},
): ModelConfigurationCatalogEntry {
  return {
    modelConfigurationId: "mc:sha256:" + "a".repeat(64),
    providerId: "providerA",
    requestedModel: "alpha-1",
    resolvedModel: "alpha-1",
    resolvedVersion: "2026-08-01",
    reasoningRequested: "high",
    reasoningEffective: "high",
    toolScaffoldSignature: null,
    runtimeSettings: {},
    identityCompleteness: "exact",
    observedFrom: Date.UTC(2026, 4, 1),
    observedTo: Date.UTC(2026, 7, 1),
    observationCount: 38,
    eligibleProfileEvidenceCount: 112,
    latestActivity: Date.UTC(2026, 7, 15),
    ...over,
  };
}

function makeRow(
  over: Omit<Partial<ModelListRowData>, "entry"> & {
    entry?: Partial<ModelConfigurationCatalogEntry>;
  } = {},
): ModelListRowData {
  const { entry: entryOver, ...rest } = over;
  return {
    entry: makeEntry(entryOver),
    taskCount: 38,
    topFamilyNames: ["Code transformation", "Summarization"],
    gapCount: 6,
    ...rest,
  };
}

function renderRouter(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/models"]}>
        <Routes>
          <Route path="/models" element={node} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    text: () => container.textContent ?? "",
  };
}

describe("ModelList — row anatomy (Fable §6.3)", () => {
  it("renders KindEyebrow, VersionStatusChip, CompactModelLabel, window, coverage, families, activity", () => {
    const row = makeRow();
    const h = renderRouter(
      <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />,
    );
    const surface = h.$("[data-record-row-surface]")!;
    expect(surface).not.toBeNull();
    expect(h.text()).toContain("Model Configuration");
    expect(h.$("[data-version-status='exact']")).not.toBeNull();
    expect(h.text()).toContain("alpha-1");
    expect(h.$("[data-window]")!.textContent).toMatch(/May.*Aug.*2026/);
    expect(h.text()).toContain("38");
    expect(h.text()).toContain("112");
    expect(h.text()).toContain("eligible observations");
    const famLine = h.$("[data-families-line]")!;
    expect(famLine.textContent).toContain("Top: Code transformation, Summarization");
    expect(famLine.textContent).toContain("No evidence: 6 families");
    expect(h.text()).toMatch(/ago/);
    cleanup(h);
  });

  it("the whole row is a link to /models/:id", () => {
    const row = makeRow();
    const h = renderRouter(
      <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />,
    );
    const link = h.$("[data-record-row-surface]") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain("/models/");
    expect(link.getAttribute("href")).toContain(row.entry.modelConfigurationId);
    cleanup(h);
  });

  it("a rolling-alias row carries its window on the VersionStatusChip", () => {
    const row = makeRow({
      entry: { identityCompleteness: "rolling_alias", resolvedVersion: null },
    });
    const h = renderRouter(
      <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />,
    );
    expect(h.$("[data-version-status='rolling_alias']")).not.toBeNull();
    expect(h.text()).toContain("Rolling alias");
    cleanup(h);
  });

  it("a zero-qualified row still renders with the exploratory-only line", () => {
    const row = makeRow({
      entry: { observationCount: 5, eligibleProfileEvidenceCount: 0 },
      topFamilyNames: [],
      gapCount: 0,
    });
    const h = renderRouter(
      <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />,
    );
    expect(h.text()).toContain("0 eligible observations");
    expect(h.text()).toContain("exploratory only");
    expect(h.$("[data-record-row-surface]")).not.toBeNull();
    cleanup(h);
  });

  it("a row with no observations renders coverage unavailable", () => {
    const row = makeRow({
      entry: { observationCount: 0, eligibleProfileEvidenceCount: 0 },
      topFamilyNames: [],
      gapCount: 0,
    });
    const h = renderRouter(
      <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />,
    );
    expect(h.text()).toContain("coverage unavailable");
    cleanup(h);
  });

  it("emits no aria-sort attribute anywhere (no sortable score columns)", () => {
    const row = makeRow();
    const h = renderRouter(
      <ModelList rows={[row]} page={1} pageCount={1} totalItems={1} onPageChange={() => {}} />,
    );
    expect(h.$$("[aria-sort]").length).toBe(0);
    cleanup(h);
  });
});

describe("ModelList — pagination", () => {
  it("renders pagination only when more than one page exists", () => {
    const rows = [
      makeRow(),
      makeRow({ entry: { modelConfigurationId: "mc:sha256:" + "b".repeat(64) } }),
    ];
    const h = renderRouter(
      <ModelList rows={rows} page={1} pageCount={1} totalItems={2} onPageChange={() => {}} />,
    );
    expect(h.$("nav[aria-label='Pagination']")).toBeNull();
    cleanup(h);
    const h2 = renderRouter(
      <ModelList rows={rows} page={1} pageCount={2} totalItems={2} onPageChange={() => {}} />,
    );
    expect(h2.$("nav[aria-label='Pagination']")).not.toBeNull();
    cleanup(h2);
  });

  it("reports the visible page range to the pager", () => {
    const h = renderRouter(
      <ModelList
        rows={[makeRow()]}
        page={1}
        pageCount={2}
        totalItems={60}
        onPageChange={() => {}}
      />,
    );
    expect(h.text()).toContain("1–50 of 60");
    cleanup(h);
  });
});

describe("ModelList — Saved rollups section (§6.4)", () => {
  it("renders the boundary-rule divider, empty state, and purpose honesty note", () => {
    const h = renderRouter(<SavedRollupsSection />);
    expect(h.$("[data-saved-rollups]")).not.toBeNull();
    expect(h.text()).toContain("SAVED ROLLUPS — STRATIFIED ONLY");
    expect(h.text()).toContain("No saved rollups.");
    expect(h.text()).toContain("It is not a model and never pools evidence.");
    expect(h.$("[data-action='create-rollup']")).toBeNull();
    cleanup(h);
  });
});

describe("ModelList — list states (§6.5)", () => {
  it("FirstUseState renders the Boxes empty block with no Saved rollups", () => {
    const h = renderRouter(<FirstUseState />);
    expect(h.$("[data-list-state='first-use']")).not.toBeNull();
    expect(h.text()).toContain("No qualified model evidence yet.");
    expect(h.$("[data-saved-rollups]")).toBeNull();
    cleanup(h);
  });

  it("ZeroMatchState renders the no-match message + Clear filters", () => {
    const onClear = vi.fn();
    const h = renderRouter(<ZeroMatchState onClear={onClear} />);
    expect(h.$("[data-list-state='zero-match']")).not.toBeNull();
    expect(h.text()).toContain("No matching configurations.");
    act(() => {
      h.$("[data-action='clear-filters']")!.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("LoadErrorState renders the failure panel + Retry", () => {
    const onRetry = vi.fn();
    const h = renderRouter(<LoadErrorState message="storage offline" onRetry={onRetry} />);
    expect(h.$("[data-list-state='error']")).not.toBeNull();
    expect(h.text()).toContain("Failed to load configurations.");
    expect(h.text()).toContain("storage offline");
    act(() => {
      h.$("[data-action='retry']")!.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup(h);
  });
});

describe("formatModelWindow", () => {
  it("formats a same-year multi-month window as Mon–Mon YYYY", () => {
    expect(formatModelWindow(Date.UTC(2026, 4, 1), Date.UTC(2026, 7, 1))).toBe("May–Aug 2026");
  });
  it("formats a single-month window as Mon YYYY", () => {
    expect(formatModelWindow(Date.UTC(2026, 4, 5), Date.UTC(2026, 4, 28))).toBe("May 2026");
  });
  it("formats a cross-year window as Mon YYYY–Mon YYYY", () => {
    expect(formatModelWindow(Date.UTC(2025, 11, 1), Date.UTC(2026, 1, 1))).toBe(
      "Dec 2025–Feb 2026",
    );
  });
});
