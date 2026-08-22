// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecordsIndexBuildError,
  type RecordsRepository,
} from "../../lib/records/records-repository";
import { RecordsList } from "./RecordsList";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function repository(): RecordsRepository {
  return {
    list: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 200 })),
    getReference: vi.fn(async () => null),
    getTaskExecution: vi.fn(async () => null),
    getLegacySummary: vi.fn(async () => null),
    getObservation: vi.fn(async () => null),
    getObservationDecision: vi.fn(async () => null),
    getPolicyStudyRecord: vi.fn(async () => null),
    getPolicyStudyChildren: vi.fn(async () => ({
      trialCount: 0,
      observationCount: 0,
      exactRunCount: 0,
      items: [],
    })),
  };
}

async function renderList(repo: RecordsRepository) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <RecordsList repository={repo} selected={null} />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { container, root };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("RecordsList", () => {
  it("adds Type to the preserved filter query", async () => {
    const repo = repository();
    const harness = await renderList(repo);
    const typeSelect = harness.container.querySelector<HTMLSelectElement>(
      "select[data-filter='type']",
    )!;
    act(() => {
      typeSelect.value = "policy-study";
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(repo.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "policy-study", limit: 200, offset: 0 }),
    );
    act(() => harness.root.unmount());
  });

  it("commits search only after the preserved 200ms debounce", async () => {
    vi.useFakeTimers();
    const repo = repository();
    const harness = await renderList(repo);
    const search = harness.container.querySelector<HTMLInputElement>(
      "input[data-filter='search']",
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search, "run-exact");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(repo.list).not.toHaveBeenCalledWith(expect.objectContaining({ text: "run-exact" }));
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(repo.list).toHaveBeenLastCalledWith(expect.objectContaining({ text: "run-exact" }));
    act(() => harness.root.unmount());
  });
});

describe("RecordsList characterization (ported from RunList, §I.2/I.3)", () => {
  function makeReference(
    index: number,
  ): Extract<
    Awaited<ReturnType<RecordsRepository["list"]>>["items"][number],
    { recordType: "task-execution" }
  > {
    const createdAt = index * 1000;
    return {
      recordType: "task-execution",
      id: `run-${index}`,
      createdAt,
      updatedAt: createdAt,
      title: `Task ${index}`,
      status: "completed",
      mode: "rank",
      source: "adhoc",
      modelKeys: ["model-a"],
      searchText: `run-${index} task ${index} model-a`,
      ownerHint: "ad hoc",
      runSource: { kind: "adhoc", comparisonId: null },
    };
  }

  /** Deterministic complete-set repository: filters apply over the whole
   *  corpus before pagination, exactly like queryRecords. */
  function pagedRepository(total: number): RecordsRepository {
    const corpus = Array.from({ length: total }, (_, i) => makeReference(i));
    return {
      list: vi.fn(async (query) => {
        const filtered = query.type
          ? corpus.filter((item) => item.recordType === query.type)
          : corpus;
        const start = query.offset ?? 0;
        return {
          items: filtered.slice(start, start + (query.limit ?? 50)),
          total: filtered.length,
          offset: start,
          limit: query.limit ?? 50,
        };
      }),
      getReference: vi.fn(async () => null),
      getTaskExecution: vi.fn(async () => null),
      getLegacySummary: vi.fn(async () => null),
      getObservation: vi.fn(async () => null),
      getPolicyStudyRecord: vi.fn(async () => null),
      getObservationDecision: vi.fn(async () => null),
      getPolicyStudyChildren: vi.fn(async () => ({
        trialCount: 0,
        observationCount: 0,
        exactRunCount: 0,
        items: [],
      })),
    };
  }

  it(
    "Load more fetches beyond 200 records — query window grows with visible rows",
    async () => {
      const repo = pagedRepository(250);
      const h = await renderList(repo);
      // Initial page is 50 rows.
      expect(h.container.querySelectorAll("a[data-record-row-link]")).toHaveLength(50);
      // Load More four times: 50 → 100 → 150 → 200 → 250.
      for (let click = 0; click < 4; click++) {
        const btn = h.container.querySelector<HTMLButtonElement>("button[data-action='load-more']")!;
        act(() => btn.click());
        await act(async () => {
          await Promise.resolve();
        });
      }
      expect(h.container.querySelectorAll("a[data-record-row-link]")).toHaveLength(250);
      // All records shown — no more Load More.
      expect(h.container.querySelector("button[data-action='load-more']")).toBeNull();
      act(() => h.root.unmount());
    },
    15_000,
  );

  it("changing a non-text filter resets visible pagination to the first page", async () => {
    const repo = pagedRepository(120);
    const h = await renderList(repo);
    expect(h.container.querySelectorAll("a[data-record-row-link]")).toHaveLength(50);
    const loadMore = h.container.querySelector<HTMLButtonElement>(
      "button[data-action='load-more']",
    )!;
    act(() => loadMore.click());
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.container.querySelectorAll("a[data-record-row-link]")).toHaveLength(100);
    // Apply a status filter (immediate, non-text). All 120 runs still match,
    // but pagination must reset to the first page.
    const statusSelect = h.container.querySelector<HTMLSelectElement>(
      "select[data-filter='status']",
    )!;
    act(() => {
      statusSelect.value = "completed";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.container.querySelectorAll("a[data-record-row-link]")).toHaveLength(50);
    expect(h.container.querySelector("button[data-action='load-more']")).toBeTruthy();
    act(() => h.root.unmount());
  });

  it("hides stale Load more pagination button when a blocking index error occurs", async () => {
    const repo = pagedRepository(120);
    const h = await renderList(repo);
    expect(h.container.querySelector("button[data-action='load-more']")).not.toBeNull();
    repo.list = vi.fn().mockRejectedValue(
      new RecordsIndexBuildError([
        { entityType: "runs", id: "runs", reason: "Disk full" },
      ]),
    );
    const typeSelect = h.container.querySelector<HTMLSelectElement>(
      "select[data-filter='type']",
    )!;
    act(() => {
      typeSelect.value = "comparison";
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(h.container.querySelector("[data-index-error-panel]")).not.toBeNull();
    expect(h.container.querySelector("button[data-action='load-more']")).toBeNull();
    act(() => h.root.unmount());
  });
});
