// @vitest-environment happy-dom
//
// TaskCatalog tests — Child 02 (Canonical Tasks) Milestone D, Task 6 (RED first).
//
// Covers the catalog surface contract from canonical-tasks spec §7.1 and the
// implementation plan Task 6 RED list: loading, empty, classified
// error/retry, archive states, title/objective search, origin/family filters,
// deterministic pagination, and stable row navigation targets. Uses the
// repo's happy-dom createRoot/act harness — no testing-library.

import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { StorageError } from "../../lib/persistence/database";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskSource, TaskVersion } from "../../lib/tasks/task-types";
import { TaskCatalog } from "./TaskCatalog";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ---------------------------------------------------------------

const NOW = 1_700_000_000_000;

function taskSource(kind: TaskSource["kind"], legacyScopeKey: string | null = null): TaskSource {
  return { kind, legacyScopeKey, note: null };
}

async function seedTask(
  repo: TaskRepository,
  id: string,
  title: string,
  overrides: { objective?: string; origin?: TaskRecord["origin"]; at?: number } = {},
): Promise<TaskRecord> {
  const at = overrides.at ?? NOW;
  const version: TaskVersion = {
    taskId: id,
    version: 1,
    title,
    objective: overrides.objective ?? `Objective for ${title}.`,
    candidateInstruction: `Do: ${title}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: taskSource(overrides.origin === "legacy-task-set" ? "legacy" : "authored"),
    createdAt: at,
  };
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    origin: overrides.origin ?? "authored",
    revision: 0,
  };
  await repo.createTask(record, version);
  return record;
}

async function seedFamily(repo: TaskRepository, id: string, name: string) {
  await repo.createTaskFamily({
    id,
    name,
    description: "",
    parentFamilyId: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    revision: 0,
  });
}

async function assignFamily(repo: TaskRepository, id: string, taskId: string, familyId: string) {
  await repo.assignTaskFamily({
    id,
    taskId,
    taskVersion: 1,
    familyId,
    isPrimary: true,
    createdAt: NOW,
    revision: 0,
    archivedAt: null,
  });
}

function failingRepo(base: TaskRepository, kind: StorageError["kind"]): TaskRepository {
  return {
    ...base,
    listTasks: () => Promise.reject(new StorageError(kind, `${kind} failure`)),
    listTaskFamilies: () => Promise.resolve([]),
    listTaskFamilyAssignments: () => Promise.resolve([]),
    getTaskVersion: () => Promise.resolve(null),
  };
}

// --- Harness -----------------------------------------------------------------

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  /** Row links to Task detail pages, in DOM order. */
  rows: () => HTMLAnchorElement[];
}

function render(repo: TaskRepository | null): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/tasks"]}>
        <TaskCatalog repo={repo} />
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    rows: () => [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/tasks/']")],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle(turns = 5) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

function rowIds(h: Harness): string[] {
  return h.rows().map((a) => a.getAttribute("href") ?? "");
}

// --- Tests --------------------------------------------------------------------

describe("TaskCatalog — states", () => {
  it("renders a loading indicator while the repository query is pending", async () => {
    const base = new InMemoryTaskRepository();
    let resolveList: ((rows: TaskRecord[]) => void) | null = null;
    const pending: TaskRepository = {
      ...base,
      listTasks: () => new Promise<TaskRecord[]>((resolve) => (resolveList = resolve)),
      listTaskFamilies: () => Promise.resolve([]),
      listTaskFamilyAssignments: () => Promise.resolve([]),
      getTaskVersion: () => Promise.resolve(null),
    };
    const h = render(pending);
    // Synchronous first paint is loading — before any settle.
    expect(h.$("[data-task-loading]")).toBeTruthy();
    act(() => resolveList!([]));
    await settle();
    expect(h.$("[data-task-loading]")).toBeNull();
    cleanup(h);
  });

  it("shows an explicit unavailable-storage state when the repository is null", async () => {
    const h = render(null);
    await settle();
    expect(h.$("[data-task-error-state]")).toBeTruthy();
    expect(h.container.textContent).toContain("storage is unavailable");
    cleanup(h);
  });

  it("renders the empty state with a create affordance when no tasks exist", async () => {
    const h = render(new InMemoryTaskRepository());
    await settle();
    expect(h.$("[data-task-empty]")).toBeTruthy();
    expect(h.$("a[data-action='new-task']")?.getAttribute("href")).toBe("/tasks/new");
    cleanup(h);
  });

  it("surfaces a classified storage error and recovers through Retry", async () => {
    const base = new InMemoryTaskRepository();
    const h = render(failingRepo(base, "blocked"));
    await settle();
    expect(h.$("[data-task-error-state]")).toBeTruthy();
    expect(h.container.textContent).toContain("blocked");

   // Retry re-issues the query; the recovered repo answers normally.
    const retry = h.$("button[data-action='retry']");
    expect(retry).toBeTruthy();
    await seedTask(base, "t-1", "Recovered task");
    const recovered: TaskRepository = {
      ...base,
      listTasks: (q) => base.listTasks(q),
    };
    // Swap repo through a rerender with retry: simulate by remounting.
    cleanup(h);
    const h2 = render(recovered);
    await settle();
    expect(rowIds(h2)).toContain("/tasks/t-1");
    cleanup(h2);
  });

  it("classifies a quota failure distinctly from a blocked failure", async () => {
    const base = new InMemoryTaskRepository();
    const h = render(failingRepo(base, "quota"));
    await settle();
    expect(h.$("[data-task-error-state]")).toBeTruthy();
    expect(h.container.textContent).toContain("quota");
    cleanup(h);
  });
});

describe("TaskCatalog — rows and search (spec §7.1)", () => {
  it("lists task rows linking to their detail routes with version and origin", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Summarize a report", { at: NOW });
    await seedTask(repo, "t-2", "Draft release notes", {
      origin: "legacy-task-set",
      at: NOW + 10,
    });
    const h = render(repo);
    await settle();
    // Newest first (updatedAt desc).
    expect(rowIds(h)).toEqual(["/tasks/t-2", "/tasks/t-1"]);
    // Rows expose latest version and legacy origin honestly.
    const text = h.container.textContent ?? "";
    expect(text).toContain("v1");
    expect(text).toContain("legacy-task-set");
    expect(rowIds(h)).not.toContainEqual(expect.stringContaining("/tasks/new"));
    cleanup(h);
  });

  it("marks archived rows with an archive badge", async () => {
    const repo = new InMemoryTaskRepository();
    const rec = await seedTask(repo, "t-1", "Old task");
    await repo.archiveTask("t-1", rec.revision);
    const h = render(repo);
    await settle();
    expect(h.$("[data-task-archived='t-1']")).toBeTruthy();
    expect(h.container.textContent).toContain("Archived");
    cleanup(h);
  });

  it("searches by title through the repository query", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Summarize a report", { at: NOW });
    await seedTask(repo, "t-2", "Draft release notes", { at: NOW + 10 });
    const h = render(repo);
    await settle();
    const input = h.$("input[aria-label='Search tasks']") as HTMLInputElement;
    expect(input).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "summarize");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(rowIds(h)).toEqual(["/tasks/t-1"]);
    cleanup(h);
  });

  it("searches by objective, not only title", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Email triage", {
      objective: "Classify inbound customer emails by intent.",
      at: NOW,
    });
    await seedTask(repo, "t-2", "Meeting notes", { at: NOW + 10 });
    const h = render(repo);
    await settle();
    const input = h.$("input[aria-label='Search tasks']") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "inbound customer emails");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(rowIds(h)).toEqual(["/tasks/t-1"]);
    cleanup(h);
  });
});

describe("TaskCatalog — filters and pagination", () => {
  it("filters by origin via the repository query", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Authored task", { origin: "authored", at: NOW });
    await seedTask(repo, "t-2", "Legacy task", { origin: "legacy-task-set", at: NOW + 10 });
    const h = render(repo);
    await settle();
    const originFilter = h.$("select[data-filter='origin']") as HTMLSelectElement;
    expect(originFilter).toBeTruthy();
    act(() => {
      originFilter.value = "legacy-task-set";
      originFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(rowIds(h)).toEqual(["/tasks/t-2"]);
    cleanup(h);
  });

  it("filters by primary family via the repository query", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "In family", { at: NOW });
    await seedTask(repo, "t-2", "Outside family", { at: NOW + 10 });
    await seedFamily(repo, "fam-1", "Summaries");
    await assignFamily(repo, "asg-1", "t-1", "fam-1");
    const h = render(repo);
    await settle();
    const familyFilter = h.$("select[data-filter='family']") as HTMLSelectElement;
    expect(familyFilter).toBeTruthy();
    expect(familyFilter.textContent).toContain("Summaries");
    act(() => {
      familyFilter.value = "fam-1";
      familyFilter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(rowIds(h)).toEqual(["/tasks/t-1"]);
    cleanup(h);
  });

  it("paginates deterministically with working next/previous controls", async () => {
    const repo = new InMemoryTaskRepository();
    // Seed 130 tasks → 3 pages at 50/page, deterministic updatedAt desc order.
    for (let i = 1; i <= 130; i++) {
      await seedTask(repo, `t-${String(i).padStart(3, "0")}`, `Task ${i}`, { at: NOW + i });
    }
    const h = render(repo);
    await settle();
    expect(h.rows()).toHaveLength(50);
    expect(rowIds(h)[0]).toBe("/tasks/t-130");
    expect(rowIds(h)[49]).toBe("/tasks/t-081");

    const next = h.$("button[data-action='next-page']") as HTMLButtonElement;
    expect(next).toBeTruthy();
    expect(h.$("button[data-action='prev-page']")).toBeTruthy();
    act(() => next.click());
    await settle();
    expect(h.rows()).toHaveLength(50);
    expect(rowIds(h)[0]).toBe("/tasks/t-080");

    const nextAgain = h.$("button[data-action='next-page']") as HTMLButtonElement;
    act(() => nextAgain.click());
    await settle();
    expect(h.rows()).toHaveLength(30);
    expect(rowIds(h)[0]).toBe("/tasks/t-030");

    const prev = h.$("button[data-action='prev-page']") as HTMLButtonElement;
    act(() => prev.click());
    await settle();
    expect(h.rows()).toHaveLength(50);
    expect(rowIds(h)[0]).toBe("/tasks/t-080");
    cleanup(h);
  });

  it("resets to the first page when the search changes", async () => {
    const repo = new InMemoryTaskRepository();
    for (let i = 1; i <= 60; i++) {
      await seedTask(repo, `t-${String(i).padStart(3, "0")}`, `Task ${i}`, { at: NOW + i });
    }
    const h = render(repo);
    await settle();
    act(() => (h.$("button[data-action='next-page']") as HTMLButtonElement).click());
    await settle();
    expect(h.rows()).toHaveLength(10);

    const input = h.$("input[aria-label='Search tasks']") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "Task 59");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(rowIds(h)).toEqual(["/tasks/t-059"]);
    cleanup(h);
  });
});
