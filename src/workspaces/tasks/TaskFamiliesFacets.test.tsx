// @vitest-environment happy-dom
//
// Families & facets integration tests — Child 02 (Canonical Tasks) Task 8B
// (RED first).
//
// Covers the catalog/detail integration contract from canonical-tasks spec
// §7.1/§7.2 and the Task 8B acceptance list:
//   - catalog rows carry the primary family name and key facet chips;
//   - archive-state and facet filters are functional through the repository
//     query (never re-filtered behind the repository's back);
//   - Task detail separates family assignment, family registry, and facet
//     editing into distinct sections;
//   - assigning one explicit primary family demotes the previous primary
//     through real repository operations; ending the assignment archives it;
//   - archived Tasks render the family/facet sections read-only.
//
// Uses the repo's happy-dom createRoot/act harness — no testing-library.

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { TaskCatalog } from "./TaskCatalog";
import { TaskDetailRoute } from "./TaskRoute";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ---------------------------------------------------------------

const NOW = 1_700_000_000_000;

async function seedTask(
  repo: InMemoryTaskRepository,
  id: string,
  title: string,
  overrides: { at?: number } = {},
): Promise<TaskRecord> {
  const at = overrides.at ?? NOW;
  const version: TaskVersion = {
    taskId: id,
    version: 1,
    title,
    objective: `Objective for ${title}.`,
    candidateInstruction: `Do: ${title}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: at,
  };
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
  await repo.createTask(record, version);
  return record;
}

async function seedFamily(repo: InMemoryTaskRepository, id: string, name: string) {
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

async function assignFamily(
  repo: InMemoryTaskRepository,
  id: string,
  taskId: string,
  familyId: string,
) {
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

async function annotate(
  repo: InMemoryTaskRepository,
  id: string,
  taskId: string,
  facetId: string,
  valueId: string,
) {
  await repo.annotateTaskFacet({
    id,
    taskId,
    taskVersion: null,
    facetId,
    valueId,
    source: "authored",
    authorKind: "user",
    confidence: null,
    taxonomyVersion: 1,
    createdAt: NOW,
    supersedesId: null,
  });
}

// --- Harness -----------------------------------------------------------------

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
  rows: () => HTMLAnchorElement[];
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter initialEntries={["/tasks"]}>{node}</MemoryRouter>);
  });
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
    rows: () => [...container.querySelectorAll<HTMLAnchorElement>("a[data-task-row]")],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle(turns = 8) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

function selectValue(el: HTMLElement, value: string) {
  act(() => {
    (el as HTMLSelectElement).value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: HTMLElement | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    (el as HTMLButtonElement).click();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- Tests --------------------------------------------------------------------

describe("TaskCatalog — family and facet summaries on rows (spec §7.1)", () => {
  it("rows show the primary family name and key facet chips", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Summarize a report");
    await seedFamily(repo, "fam-1", "Summaries");
    await assignFamily(repo, "asg-1", "t-1", "fam-1");
    await annotate(repo, "ann-1", "t-1", "domain", "nlp");
    const h = render(<TaskCatalog repo={repo} />);
    await settle();
    const row = h.$("a[data-task-row='t-1']");
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain("Summaries");
    const chip = row?.querySelector("[data-facet-chip]");
    expect(chip?.textContent).toContain("Natural language");
    cleanup(h);
  });

  it("rows without family or facets render without chips and stay navigable", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Bare task");
    const h = render(<TaskCatalog repo={repo} />);
    await settle();
    const row = h.$("a[data-task-row='t-1']");
    expect(row).toBeTruthy();
    expect(row?.getAttribute("href")).toBe("/tasks/t-1");
    cleanup(h);
  });
});

describe("TaskCatalog — archive-state and facet filters (spec §7.1)", () => {
  it("filters by archive state through the repository query", async () => {
    const repo = new InMemoryTaskRepository();
    const rec = await seedTask(repo, "t-live", "Live task");
    await seedTask(repo, "t-gone", "Archived task");
    await repo.archiveTask("t-gone", 0);
    const h = render(<TaskCatalog repo={repo} />);
    await settle();
    const archiveFilter = h.$("select[data-filter='archive-state']") as HTMLSelectElement;
    expect(archiveFilter).toBeTruthy();
    // Default keeps the Task 6 behavior: everything visible, archived badged.
    expect(h.rows().map((r) => r.getAttribute("href"))).toEqual(["/tasks/t-gone", "/tasks/t-live"]);
    selectValue(archiveFilter, "active");
    await settle();
    expect(h.rows().map((r) => r.getAttribute("href"))).toEqual(["/tasks/t-live"]);
    selectValue(archiveFilter, "archived");
    await settle();
    expect(h.rows().map((r) => r.getAttribute("href"))).toEqual(["/tasks/t-gone"]);
    // rec referenced to keep the fixture honest (revision 0 archived above).
    expect(rec.archivedAt).toBeNull();
    cleanup(h);
  });

  it("filters by facet dimension and value through the repository query", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-nlp", "NLP task", { at: NOW });
    await seedTask(repo, "t-code", "Code task", { at: NOW + 10 });
    await annotate(repo, "ann-1", "t-nlp", "domain", "nlp");
    await annotate(repo, "ann-2", "t-code", "domain", "code");
    const h = render(<TaskCatalog repo={repo} />);
    await settle();
    const dimension = h.$("select[data-filter='facet-dimension']") as HTMLSelectElement;
    expect(dimension).toBeTruthy();
    selectValue(dimension, "domain");
    await settle();
    const value = h.$("select[data-filter='facet-value']") as HTMLSelectElement;
    expect(value).toBeTruthy();
    expect(value.textContent).toContain("Natural language");
    selectValue(value, "nlp");
    await settle();
    expect(h.rows().map((r) => r.getAttribute("href"))).toEqual(["/tasks/t-nlp"]);
    // Choosing a value with no annotations empties the catalog honestly.
    selectValue(value, "multimodal");
    await settle();
    expect(h.rows()).toHaveLength(0);
    cleanup(h);
  });

  it("facet filter composes with search", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-a", "Summarize contracts", { at: NOW });
    await seedTask(repo, "t-b", "Summarize reports", { at: NOW + 10 });
    await annotate(repo, "ann-1", "t-a", "domain", "nlp");
    await annotate(repo, "ann-2", "t-b", "domain", "code");
    const h = render(<TaskCatalog repo={repo} />);
    await settle();
    const input = h.$("input[aria-label='Search tasks']") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "summarize");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    selectValue(h.$("select[data-filter='facet-dimension']")!, "domain");
    await settle();
    selectValue(h.$("select[data-filter='facet-value']")!, "nlp");
    await settle();
    expect(h.rows().map((r) => r.getAttribute("href"))).toEqual(["/tasks/t-a"]);
    cleanup(h);
  });
});

describe("TaskDetailRoute — family and facet sections (spec §7.2)", () => {
  it("renders separate family assignment and facet sections under the editor", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Sectioned task");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-family-section]")).toBeTruthy();
    expect(h.$("[data-family-registry]")).toBeTruthy();
    expect(h.$("[data-task-facets-section]")).toBeTruthy();
    // Distinct section headings keep the editing surfaces separate.
    const headings = h.$$("[data-task-detail='t-1'] h2").map((el) => el.textContent ?? "");
    expect(headings.some((t) => /famil/i.test(t))).toBe(true);
    expect(headings.some((t) => /facet/i.test(t))).toBe(true);
    cleanup(h);
  });

  it("assigns one explicit primary family through the repository", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Assignable task");
    await seedFamily(repo, "fam-1", "Summaries");
    await seedFamily(repo, "fam-2", "Extractions");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    const section = h.$("[data-task-family-section]");
    expect(section?.textContent).toMatch(/no primary family/i);
    selectValue(section!.querySelector("select[data-field='primary-family']")!, "fam-1");
    click(section!.querySelector("button[data-action='assign-primary-family']"));
    await settle();
    expect(h.$("[data-primary-family]")?.textContent).toContain("Summaries");
    const assignments = await repo.listTaskFamilyAssignments("t-1");
    expect(assignments.filter((a) => a.isPrimary && a.archivedAt === null)).toHaveLength(1);
    cleanup(h);
  });

  it("reassigning the primary family demotes the previous primary — exactly one active primary", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Reassignable task");
    await seedFamily(repo, "fam-1", "Summaries");
    await seedFamily(repo, "fam-2", "Extractions");
    await assignFamily(repo, "asg-1", "t-1", "fam-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-primary-family]")?.textContent).toContain("Summaries");
    selectValue(h.$("select[data-field='primary-family']")!, "fam-2");
    click(h.$("button[data-action='assign-primary-family']"));
    await settle();
    expect(h.$("[data-primary-family]")?.textContent).toContain("Extractions");
    const assignments = await repo.listTaskFamilyAssignments("t-1");
    const primaries = assignments.filter((a) => a.isPrimary && a.archivedAt === null);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].familyId).toBe("fam-2");
    // The old assignment survives as history — demoted, not deleted.
    const demoted = assignments.find((a) => a.id === "asg-1")!;
    expect(demoted.isPrimary).toBe(false);
    expect(demoted.archivedAt).toBeNull();
    cleanup(h);
  });

  it("ending the primary assignment archives it through archiveTaskFamilyAssignment", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Endable task");
    await seedFamily(repo, "fam-1", "Summaries");
    await assignFamily(repo, "asg-1", "t-1", "fam-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    click(h.$("button[data-action='end-primary-assignment']"));
    await settle();
    const assignments = await repo.listTaskFamilyAssignments("t-1");
    expect(assignments[0].archivedAt).not.toBeNull();
    expect(h.$("[data-primary-family]")).toBeNull();
    expect(h.$("[data-task-family-section]")?.textContent).toMatch(/no primary family/i);
    cleanup(h);
  });

  it("an archived task renders the family/facet sections read-only", async () => {
    const repo = new InMemoryTaskRepository();
    const rec = await seedTask(repo, "t-1", "Frozen task");
    await seedFamily(repo, "fam-1", "Summaries");
    await assignFamily(repo, "asg-1", "t-1", "fam-1");
    await annotate(repo, "ann-1", "t-1", "domain", "nlp");
    await repo.archiveTask("t-1", rec.revision);
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    // Provenance stays visible…
    expect(h.$("[data-primary-family]")?.textContent).toContain("Summaries");
    expect(h.$("[data-facet-row='domain']")?.textContent).toContain("Natural language");
    // …but no mutating controls exist on the archived Task's sections.
    expect(h.$("select[data-field='primary-family']")).toBeNull();
    expect(h.$("button[data-action='assign-primary-family']")).toBeNull();
    expect(h.$("button[data-action='add-facet']")).toBeNull();
    cleanup(h);
  });
});
