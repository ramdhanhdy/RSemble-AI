// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ComparisonList } from "./ComparisonList";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import type { RunRecordV2, FullRunSummaryV2 } from "../../lib/persistence/run-types";
import type { ComparisonTaskBinding } from "../../lib/compare/comparison-result-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
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

function makeRunRecord(
  id: string,
  createdAt: number,
  overrides: Partial<RunRecordV2> = {},
): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: { ownerId: "owner-1", fence: 1 },
    createdAt,
    updatedAt: createdAt + 100,
    completedAt: createdAt + 200,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Task " + id, prompt: "prompt for " + id, systemPrompt: "", temperature: 0 },
    evaluation: {
      profile: null,
      candidateMessages: [{ role: "user", content: "prompt for " + id }],
    },
    candidates: [],
    judge: {
      status: "idle",
      acceptedAttemptId: null,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
    ...overrides,
  };
}

function makeSummary(
  id: string,
  createdAt: number,
  overrides: Partial<FullRunSummaryV2> = {},
): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt,
    completedAt: createdAt + 200,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: "Task " + id,
    taskExcerpt: "prompt for " + id,
    modelKeys: ["openai:gpt-4o", "anthropic:claude-3-5-sonnet"],
    winnerKeys: ["openai:gpt-4o"],
    scoresByModelKey: { "openai:gpt-4o": 4.5 },
    judgeModelKey: "openai:gpt-4o",
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: "Task " + id + " prompt for " + id,
    ...overrides,
  };
}

async function seedTestComparison(
  runsRepo: InMemoryRunRepository,
  comparisonRepo: InMemoryComparisonRepository,
  id: string,
  createdAt: number,
  options: {
    title?: string;
    status?: RunRecordV2["status"];
    mode?: "rank" | "fuse";
    binding?: ComparisonTaskBinding;
    modelKeys?: string[];
  } = {},
) {
  const binding: ComparisonTaskBinding = options.binding ?? {
    kind: "ad_hoc",
    inputSnapshotRef: `snap:sha256:${id.padEnd(64, "0")}`,
  };

  const record = makeRunRecord(id, createdAt, {
    task: {
      title: options.title ?? `Task ${id}`,
      prompt: `Prompt for ${id}`,
      systemPrompt: "",
      temperature: 0,
    },
    status: options.status ?? "completed",
    mode: options.mode ?? "rank",
  });

  const summary = makeSummary(id, createdAt, {
    taskTitle: options.title ?? `Task ${id}`,
    status: options.status ?? "completed",
    mode: options.mode ?? "rank",
    modelKeys: options.modelKeys ?? ["openai:gpt-4o", "anthropic:claude-3-5-sonnet"],
  });

  await runsRepo.create(record, summary);
  await comparisonRepo.createComparisonEnvelope(record, binding);
}

describe("ComparisonList", () => {
  it("renders New comparison action and Previous comparisons section header", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-1", 1000, {
      title: "Evaluate Sorting",
    });

    const onNewComparison = vi.fn();
    const h = renderWithRouter(
      <ComparisonList repo={comparisonRepo} onNewComparison={onNewComparison} />,
    );
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const newBtn = h.$("[data-action='new-comparison']");
    expect(newBtn).not.toBeNull();
    expect(newBtn?.textContent).toMatch(/new comparison/i);

    act(() => {
      newBtn?.click();
    });
    expect(onNewComparison).toHaveBeenCalled();

    const header = h.$("[data-section='previous-comparisons']");
    expect(header).not.toBeNull();
    expect(header?.textContent).toMatch(/previous comparisons/i);

    cleanup(h);
  });

  it("renders semantic result rows linking to /compare/results/:id sorted newest first", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-old", 1000, {
      title: "Older Comparison",
    });
    await seedTestComparison(runsRepo, comparisonRepo, "cmp-new", 2000, {
      title: "Newer Comparison",
    });

    const h = renderWithRouter(<ComparisonList repo={comparisonRepo} />);
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const rows = h.$$("[data-record-row]");
    expect(rows.length).toBe(2);

    // Newest first
    expect(rows[0]?.textContent).toContain("Newer Comparison");
    expect(rows[1]?.textContent).toContain("Older Comparison");

    // Semantic result link to /compare/results/:id
    const firstLink = rows[0]?.querySelector("a") as HTMLAnchorElement | null;
    expect(firstLink).not.toBeNull();
    expect(firstLink?.getAttribute("href")).toBe("/compare/results/cmp-new");

    const secondLink = rows[1]?.querySelector("a") as HTMLAnchorElement | null;
    expect(secondLink).not.toBeNull();
    expect(secondLink?.getAttribute("href")).toBe("/compare/results/cmp-old");

    cleanup(h);
  });

  it("displays compact status, task title, mode, coverage/evidence state, and timestamp", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-adhoc", 1000, {
      title: "Ad Hoc Evaluation",
      mode: "rank",
      status: "completed",
      binding: { kind: "ad_hoc", inputSnapshotRef: "snap:sha256:1111" },
    });

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-canon", 2000, {
      title: "Canonical Task Run",
      mode: "fuse",
      status: "completed",
      binding: { kind: "canonical", taskId: "task-42", taskVersion: 3 },
    });

    const h = renderWithRouter(<ComparisonList repo={comparisonRepo} />);
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const rows = h.$$("[data-record-row]");
    expect(rows.length).toBe(2);

    // Canonical row
    expect(rows[0]?.textContent).toContain("Canonical Task Run");
    expect(rows[0]?.textContent?.toLowerCase()).toContain("fuse");
    expect(rows[0]?.textContent).toMatch(/task.*42.*v3|canonical/i);

    // Ad hoc row
    expect(rows[1]?.textContent).toContain("Ad Hoc Evaluation");
    expect(rows[1]?.textContent?.toLowerCase()).toContain("rank");
    expect(rows[1]?.textContent).toMatch(/ad hoc|exploratory/i);

    cleanup(h);
  });

  it("renders interrupted comparison with owning recovery action without inline execution controls", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-interrupted", 1500, {
      title: "Interrupted Pipeline",
      status: "interrupted",
    });

    const h = renderWithRouter(<ComparisonList repo={comparisonRepo} />);
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const row = h.$("[data-record-row]");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Interrupted Pipeline");
    expect(row?.textContent).toMatch(/interrupted/i);

    // Row links to the owning result route for recovery
    const link = row?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/compare/results/cmp-interrupted");

    // Interrupted row must NOT have inline execution controls (e.g. no run / abort button)
    const runBtn = row?.querySelector("button[data-action='run'], button[data-action='abort']");
    expect(runBtn).toBeNull();

    cleanup(h);
  });

  it("displays empty state with start comparison action when repository is empty", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const onNewComparison = vi.fn();
    const h = renderWithRouter(
      <ComparisonList repo={comparisonRepo} onNewComparison={onNewComparison} />,
    );
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const empty = h.$("[data-state='empty']");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toMatch(/no previous comparisons yet/i);

    const startBtn = h.$("[data-action='start-comparison']");
    expect(startBtn).not.toBeNull();

    act(() => {
      startBtn?.click();
    });
    expect(onNewComparison).toHaveBeenCalled();

    cleanup(h);
  });

  it("displays no-match state with clear filters button when search matches nothing", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-1", 1000, {
      title: "Binary Search",
    });

    const h = renderWithRouter(<ComparisonList repo={comparisonRepo} />);
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    // Enter search text that matches nothing
    const searchInput = h.$("input[type='search']") as HTMLInputElement;
    act(() => {
      searchInput.value = "Quantum Physics";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 250);
      await promise;
    });

    const noMatch = h.$("[data-state='no-match']");
    expect(noMatch).not.toBeNull();
    expect(noMatch?.textContent).toMatch(/no matching comparisons/i);

    const clearBtn = h.$("[data-action='clear-empty-filters']");
    expect(clearBtn).not.toBeNull();

    act(() => {
      clearBtn?.click();
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 250);
      await promise;
    });

    // Restores original rows
    expect(h.$$("[data-record-row]").length).toBe(1);

    cleanup(h);
  });

  it("filters across complete set by status, mode, task binding, and model", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-rank", 1000, {
      title: "Rank Task",
      mode: "rank",
      status: "completed",
      binding: { kind: "ad_hoc", inputSnapshotRef: "snap:1" },
      modelKeys: ["openai:gpt-4o"],
    });

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-fuse", 2000, {
      title: "Fuse Task",
      mode: "fuse",
      status: "interrupted",
      binding: { kind: "canonical", taskId: "task-1", taskVersion: 1 },
      modelKeys: ["anthropic:claude-3-5-sonnet"],
    });

    const h = renderWithRouter(
      <ComparisonList
        repo={comparisonRepo}
        modelKeys={["openai:gpt-4o", "anthropic:claude-3-5-sonnet"]}
      />,
    );
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    expect(h.$$("[data-record-row]").length).toBe(2);

    // Filter by mode = fuse
    const modeSelect = h.$("select[data-filter='mode']") as HTMLSelectElement;
    act(() => {
      modeSelect.value = "fuse";
      modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const rowsAfterMode = h.$$("[data-record-row]");
    expect(rowsAfterMode.length).toBe(1);
    expect(rowsAfterMode[0]?.textContent).toContain("Fuse Task");

    // Filter by binding = canonical
    const bindingSelect = h.$("select[data-filter='binding']") as HTMLSelectElement;
    act(() => {
      bindingSelect.value = "canonical";
      bindingSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    expect(h.$$("[data-record-row]").length).toBe(1);

    cleanup(h);
  });

  it("marks selected comparison with data-selected and aria-current", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    await seedTestComparison(runsRepo, comparisonRepo, "cmp-1", 1000, {
      title: "Comparison 1",
    });
    await seedTestComparison(runsRepo, comparisonRepo, "cmp-2", 2000, {
      title: "Comparison 2",
    });

    const h = renderWithRouter(<ComparisonList repo={comparisonRepo} selectedId="cmp-2" />);
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    const selectedWrapper = h.$("[data-selected='true']");
    expect(selectedWrapper).not.toBeNull();
    expect(selectedWrapper?.textContent).toContain("Comparison 2");

    const selectedLink = selectedWrapper?.querySelector("a");
    expect(selectedLink?.getAttribute("aria-current")).toBe("true");

    cleanup(h);
  });

  it("subscribes to repository changes and updates dynamically", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const h = renderWithRouter(<ComparisonList repo={comparisonRepo} />);
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    expect(h.$("[data-state='empty']")).not.toBeNull();

    // Add a comparison to repo
    await seedTestComparison(runsRepo, comparisonRepo, "cmp-live", 5000, {
      title: "Live Dynamically Added",
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    });

    expect(h.$$("[data-record-row]").length).toBe(1);
    expect(h.$("[data-record-row]")?.textContent).toContain("Live Dynamically Added");

    cleanup(h);
  });
});
