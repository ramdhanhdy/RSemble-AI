// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RunList } from "./RunList";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import type { RunRecordV2, FullRunSummaryV2 } from "../../lib/persistence/run-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderWithRouter(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
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

// --- Helpers ------------------------------------------------------------------

function makeSummary(
  id: string,
  createdAt: number,
  overrides: Partial<FullRunSummaryV2> = {},
): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 1,
    createdAt,
    completedAt: createdAt + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: `Task ${id} excerpt`,
    modelKeys: ["openrouter:gpt-4o"],
    winnerKeys: ["openrouter:gpt-4o"],
    scoresByModelKey: { "openrouter:gpt-4o": 4.5 },
    judgeModelKey: "openrouter:judge",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: `task ${id} excerpt`,
    ...overrides,
  };
}

function makeMinimalRecord(id: string, createdAt: number): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt,
    updatedAt: createdAt + 1000,
    completedAt: createdAt + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: `Task ${id}`, prompt: "do it", systemPrompt: "helpful", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

async function seedRepo(
  repo: InMemoryRunRepository,
  entries: Array<[string, number, Partial<FullRunSummaryV2>?]>,
) {
  for (const [id, createdAt, overrides] of entries) {
    await repo.create(makeMinimalRecord(id, createdAt), makeSummary(id, createdAt, overrides));
  }
}

async function settle() {
  await act(async () => {
    await flush();
  });
}

/** Type into a React controlled input by bypassing React's value tracker.
 *  Matches the pattern in JudgeConfig.test.tsx. */
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

/** Wait for the 200ms search debounce to fire, plus one settle cycle. */
async function settleWithDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
  await settle();
}

// --- Tests --------------------------------------------------------------------

describe("RunList", () => {
  it("rows are links to /runs/:runId", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000],
      ["run-2", 2000],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const links = h.$$("a[href^='/runs/']");
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/runs/run-2")).toBe(true);
    cleanup(h);
  });

  it("current row has selected state without replacing aria-current route semantics", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000],
      ["run-2", 2000],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId="run-1" />);
    await settle();
    const selectedRow = h.$("[data-selected='true']");
    expect(selectedRow).toBeTruthy();
    const ariaCurrent = h.$("[aria-current='page']");
    expect(ariaCurrent).toBeNull();
    cleanup(h);
  });

  it("selected row link exposes aria-current=true (screen reader selected state)", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000],
      ["run-2", 2000],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId="run-1" />);
    await settle();
    const selectedLink = h.$("a[href='/runs/run-1']");
    const otherLink = h.$("a[href='/runs/run-2']");
    expect(selectedLink?.getAttribute("aria-current")).toBe("true");
    expect(otherLink?.getAttribute("aria-current")).toBeNull();
    cleanup(h);
  });

  it("search filters results", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000, { taskTitle: "write python sort", searchText: "write python sort" }],
      ["run-2", 2000, { taskTitle: "fix bug fix", searchText: "fix bug fix" }],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const search = h.$(
      "input[type='search'], input[role='searchbox'], input[aria-label*='earch' i]",
    ) as HTMLInputElement;
    expect(search).toBeTruthy();
    typeInto(search, "sort");
    await settleWithDebounce();
    const links = h.$$("a[href^='/runs/']");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/runs/run-1");
    cleanup(h);
  });

  it("Clear filters resets every filter", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000, { taskTitle: "sort task", searchText: "sort task" }],
      ["run-2", 2000, { taskTitle: "bug fix", searchText: "bug fix" }],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const search = h.$(
      "input[type='search'], input[role='searchbox'], input[aria-label*='earch' i]",
    ) as HTMLInputElement;
    typeInto(search, "sort");
    await settleWithDebounce();
    const toggleBtn = h.$("button[data-action='toggle-filters']");
    act(() => toggleBtn!.click());
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(1);
    const clearBtn = h.$("button[data-action='clear-filters']");
    expect(clearBtn).toBeTruthy();
    act(() => clearBtn!.click());
    await settleWithDebounce();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(2);
    cleanup(h);
  });

  it("loading state shows distinct copy", async () => {
    const slowRepo = {
      list: vi.fn(() => new Promise(() => {})),
      subscribe: vi.fn().mockReturnValue(() => {}),
    } as unknown as InMemoryRunRepository;
    const h = renderWithRouter(<RunList repo={slowRepo} selectedId={null} />);
    await settle();
    expect(h.container.textContent).toMatch(/loading/i);
    cleanup(h);
  });

  it("no-history state shows distinct copy with Go to Compare link", async () => {
    const repo = new InMemoryRunRepository();
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const links = h.$$("a[href^='/runs/']");
    expect(links).toHaveLength(0);
    const compareLink = h.$("a[href='/compare']");
    expect(compareLink).toBeTruthy();
    const runButtons = h.$$("button[data-action='run']");
    expect(runButtons).toHaveLength(0);
    cleanup(h);
  });

  it("error state shows distinct copy", async () => {
    const failingRepo = {
      list: vi.fn().mockRejectedValue(new Error("storage down")),
      subscribe: vi.fn().mockReturnValue(() => {}),
    } as unknown as InMemoryRunRepository;
    const h = renderWithRouter(<RunList repo={failingRepo} selectedId={null} />);
    await settle();
    expect(h.container.textContent).toMatch(/error|failed|unavailable/i);
    expect(h.$$("a[href^='/runs/']")).toHaveLength(0);
    cleanup(h);
  });

  it("a tie row exposes every persisted winner label rather than selecting the first", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      [
        "run-1",
        1000,
        {
          winnerKeys: ["openrouter:gpt-4o", "umans:claude-opus"],
          scoresByModelKey: { "openrouter:gpt-4o": 4.5, "umans:claude-opus": 4.5 },
          modelKeys: ["openrouter:gpt-4o", "umans:claude-opus"],
        },
      ],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const rowText = h.container.textContent ?? "";
    expect(rowText).toContain("openrouter:gpt-4o");
    expect(rowText).toContain("umans:claude-opus");
    cleanup(h);
  });

  it("status filter excludes legacy summaries", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000, { status: "completed" }]]);
    await repo.importLegacySummary({
      kind: "legacy",
      schemaVersion: "1-import",
      id: "legacy-1",
      createdAt: 500,
      taskExcerpt: "old legacy run",
      modelKeys: ["openrouter:old"],
      winnerKeys: ["openrouter:old"],
      scoresByModelKey: { "openrouter:old": 3.0 },
      detailAvailable: false,
      searchText: "old legacy run",
    });
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(2);
    const toggleBtn = h.$("button[data-action='toggle-filters']");
    expect(toggleBtn).toBeTruthy();
    act(() => toggleBtn!.click());
    await settle();
    const statusSelect = h.$("select[data-filter='status']") as HTMLSelectElement;
    expect(statusSelect).toBeTruthy();
    act(() => {
      statusSelect.value = "completed";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(1);
    expect(h.$("a[href='/runs/run-1']")).toBeTruthy();
    cleanup(h);
  });

  it("desktop filter composition renders without a redundant heading", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const desktopBlock = h.$("[data-desktop-filters]");
    expect(desktopBlock).toBeTruthy();
    expect(desktopBlock!.className).toContain("hidden");
    expect(desktopBlock!.className).toContain("lg:grid");
    for (const name of ["model", "status", "mode", "source"]) {
      expect(h.$(`[data-desktop-filters] select[data-filter='${name}']`)).toBeTruthy();
    }
    // The individual field labels provide hierarchy; there is no orphaned
    // standalone "Filters" label above Model.
    expect(
      [...desktopBlock!.children].some((child) => child.textContent?.trim() === "Filters"),
    ).toBe(false);
    // Reset is contextual: nothing to clear means no desktop Clear action yet.
    expect(h.$("button[data-action='clear-filters']")).toBeNull();
    expect(h.$("[data-filter-sheet]")).toBeNull();
    const toggle = h.$("button[data-action='toggle-filters']");
    expect(toggle).toBeTruthy();
    expect(toggle!.className).toContain("lg:hidden");
    cleanup(h);
  });

  it("desktop Clear appears beside search only when something is active", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const search = h.$("input[type='search']") as HTMLInputElement;
    typeInto(search, "Task");
    await settle();
    const clear = h.$("button[data-action='clear-filters']");
    expect(clear).toBeTruthy();
    expect(clear!.textContent).toContain("Clear");
    expect(clear!.className).toContain("lg:flex");
    expect(clear!.className).toContain("min-h-[44px]");
    act(() => clear!.click());
    await settle();
    expect((h.$("input[type='search']") as HTMLInputElement).value).toBe("");
    expect(h.$("button[data-action='clear-filters']")).toBeNull();
    cleanup(h);
  });

  it("mobile filter sheet stays collapsed until toggled", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const toggle = h.$("button[data-action='toggle-filters']")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(h.$("[data-filter-sheet]")).toBeNull();
    act(() => toggle.click());
    await settle();
    const sheet = h.$("[data-filter-sheet]");
    expect(sheet).toBeTruthy();
    expect(sheet!.className).toContain("lg:hidden");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    for (const name of ["model", "status", "mode", "source"]) {
      expect(h.$(`[data-filter-sheet] select[data-filter='${name}']`)).toBeTruthy();
    }
    expect(h.$("[data-filter-sheet] button[data-action='clear-filters']")).toBeTruthy();
    act(() => toggle.click());
    await settle();
    expect(h.$("[data-filter-sheet]")).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    cleanup(h);
  });

  it("applied-count badge stays on the mobile toggle; contextual desktop Clear resets", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    expect(h.$("button[data-action='toggle-filters'] .rounded-full")).toBeNull();
    expect(h.$("button[data-action='clear-filters']")).toBeNull();
    const statusSelect = h.$(
      "[data-desktop-filters] select[data-filter='status']",
    ) as HTMLSelectElement;
    act(() => {
      statusSelect.value = "completed";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(h.$("button[data-action='toggle-filters'] .rounded-full")?.textContent).toBe("1");
    const clear = h.$("button[data-action='clear-filters']");
    expect(clear).toBeTruthy();
    act(() => clear!.click());
    await settle();
    expect(
      (h.$("[data-desktop-filters] select[data-filter='status']") as HTMLSelectElement).value,
    ).toBe("");
    expect(h.$("button[data-action='toggle-filters'] .rounded-full")).toBeNull();
    expect(h.$("button[data-action='clear-filters']")).toBeNull();
    cleanup(h);
  });

  it("all interactive controls meet 44px target size", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    const interactives = [...h.$$("button"), ...h.$$("a[href^='/runs/']")];
    for (const el of interactives) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).toContain("min-h-[44px]");
    }
    cleanup(h);
  });

  it("zero-match Clear search and filters restores the full list and clears every field including debounced text", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [
      ["run-1", 1000, { taskTitle: "sort task", searchText: "sort task" }],
      ["run-2", 2000, { taskTitle: "bug fix", searchText: "bug fix" }],
      ["run-3", 3000, { taskTitle: "refactor module", searchText: "refactor module" }],
    ]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(3);

    // Drive the list into a zero-match state via both search text and a
    // status filter that matches nothing, so the reset must clear every
    // field plus the debounced text state.
    const search = h.$("input[type='search']") as HTMLInputElement;
    typeInto(search, "zzz-no-match");
    const statusSelect = h.$(
      "[data-desktop-filters] select[data-filter='status']",
    ) as HTMLSelectElement;
    act(() => {
      statusSelect.value = "failed";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settleWithDebounce();

    // Zero-match state renders its one-click reset, not the no-history state.
    expect(h.$$("a[href^='/runs/']")).toHaveLength(0);
    const clearEmpty = h.$("button[data-action='clear-empty-filters']");
    expect(clearEmpty).toBeTruthy();
    expect(clearEmpty?.textContent).toContain("Clear search and filters");
    expect(h.$("a[href='/compare']")).toBeNull();

    act(() => clearEmpty!.click());
    await settleWithDebounce();

    // Complete list restored.
    expect(h.$$("a[href^='/runs/']")).toHaveLength(3);
    expect(h.$("a[href='/runs/run-1']")).toBeTruthy();
    expect(h.$("a[href='/runs/run-2']")).toBeTruthy();
    expect(h.$("a[href='/runs/run-3']")).toBeTruthy();
    // Search input cleared (filters.text).
    expect((h.$("input[type='search']") as HTMLInputElement).value).toBe("");
    // Every filter select reset to its "All" option.
    for (const name of ["model", "status", "mode", "source"]) {
      const sel = h.$(`[data-desktop-filters] select[data-filter='${name}']`) as HTMLSelectElement;
      expect(sel.value).toBe("");
    }
    // The zero-match reset action is gone now that the list is populated.
    expect(h.$("button[data-action='clear-empty-filters']")).toBeNull();
    cleanup(h);
  });

  it("Load More fetches beyond 200 records — query window grows with visible rows", async () => {
    const repo = new InMemoryRunRepository();
    const entries: Array<[string, number]> = Array.from({ length: 250 }, (_, i) => [
      `run-${i}`,
      i * 1000,
    ]);
    await seedRepo(repo, entries);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    // Initial page is 50 rows.
    expect(h.$$("a[href^='/runs/']")).toHaveLength(50);

    // Load More four times: 50 → 100 → 150 → 200 → 250.
    // The old fixed limit of 200 (PAGE_SIZE * 4) would cap at 200 and hide
    // the remaining 50 runs. The growing query window must fetch all 250.
    for (let click = 0; click < 4; click++) {
      const btn = h.$("button[data-action='load-more']");
      if (!btn) throw new Error(`Load More button missing on iteration ${click}`);
      act(() => btn.click());
      await settle();
    }
    expect(h.$$("a[href^='/runs/']")).toHaveLength(250);
    // All records shown — no more Load More.
    expect(h.$("button[data-action='load-more']")).toBeNull();
    cleanup(h);
  });

  it("changing a non-text filter resets visible pagination to the first page", async () => {
    const repo = new InMemoryRunRepository();
    // 120 completed runs — all match a status=completed filter.
    const entries: Array<[string, number]> = Array.from({ length: 120 }, (_, i) => [
      `run-${i}`,
      i * 1000,
    ]);
    await seedRepo(repo, entries);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(50);

    // Advance past the first page via Load More.
    const loadMore = h.$("button[data-action='load-more']");
    expect(loadMore).toBeTruthy();
    act(() => loadMore!.click());
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(100);

    // Apply a status filter (immediate, non-text). Pagination must reset
    // to the first page even though all 120 runs still match.
    const statusSelect = h.$(
      "[data-desktop-filters] select[data-filter='status']",
    ) as HTMLSelectElement;
    act(() => {
      statusSelect.value = "completed";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(50);
    // Load More is available again (120 matches > 50 visible).
    expect(h.$("button[data-action='load-more']")).toBeTruthy();
    cleanup(h);
  });
});
