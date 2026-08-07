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
    // The selected row should have a data-selected attribute or aria-selected
    const selectedRow = h.$("[data-selected='true']");
    expect(selectedRow).toBeTruthy();
    // aria-current="page" is NOT on the row — it belongs to route-level nav
    const ariaCurrent = h.$("[aria-current='page']");
    expect(ariaCurrent).toBeNull();
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
    // Type in search
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
    // Apply search filter
    const search = h.$(
      "input[type='search'], input[role='searchbox'], input[aria-label*='earch' i]",
    ) as HTMLInputElement;
    typeInto(search, "sort");
    await settleWithDebounce();
    // Open filter sheet to access Clear filters
    const toggleBtn = h.$("button[data-action='toggle-filters']");
    act(() => toggleBtn!.click());
    await settle();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(1);
    // Click Clear filters
    const clearBtn = h.$("button[data-action='clear-filters']");
    expect(clearBtn).toBeTruthy();
    act(() => clearBtn!.click());
    await settleWithDebounce();
    expect(h.$$("a[href^='/runs/']")).toHaveLength(2);
    cleanup(h);
  });

  it("loading state shows distinct copy", async () => {
    const slowRepo = {
      list: vi.fn(() => new Promise(() => {})), // never resolves
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
    // Empty state
    const links = h.$$("a[href^='/runs/']");
    expect(links).toHaveLength(0);
    // Go to Compare link
    const compareLink = h.$("a[href='/compare']");
    expect(compareLink).toBeTruthy();
    // No fake local Run action
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
    // No rows rendered
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
    // Both winners must be visible
    expect(rowText).toContain("openrouter:gpt-4o");
    expect(rowText).toContain("umans:claude-opus");
    cleanup(h);
  });

  it("status filter excludes legacy summaries", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000, { status: "completed" }]]);
    // Add a legacy summary
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
    // Without filters, both visible
    expect(h.$$("a[href^='/runs/']")).toHaveLength(2);
    // Open the Filters sheet to reveal the selects
    const toggleBtn = h.$("button[data-action='toggle-filters']");
    expect(toggleBtn).toBeTruthy();
    act(() => toggleBtn!.click());
    await settle();
    // Apply status=completed filter — legacy excluded
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

  it("all interactive controls meet 44px target size", async () => {
    const repo = new InMemoryRunRepository();
    await seedRepo(repo, [["run-1", 1000]]);
    const h = renderWithRouter(<RunList repo={repo} selectedId={null} />);
    await settle();
    // Check all buttons and links have min-h-[44px]
    const interactives = [...h.$$("button"), ...h.$$("a[href^='/runs/']")];
    for (const el of interactives) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).toContain("min-h-[44px]");
    }
    cleanup(h);
  });
});
