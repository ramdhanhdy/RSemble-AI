// @vitest-environment happy-dom
//
// TaskFamilyRegistry tests — Child 02 (Canonical Tasks) Task 8B (RED first).
//
// Covers the family management contract from canonical-tasks spec §3.5/§7.1
// and the Task 8B acceptance list:
//   - create/edit/archive/restore Task Families through real repository
//     operations with revision CAS;
//   - honest saved/dirty state while a family form is open, and an honest
//     conflict banner with Reload recovery when the revision goes stale;
//   - explicit confirmation dialogs for archive/restore — cancel writes
//     nothing, commit persists;
//   - invalid-parent and cycle handling surfaced from the repository
//     rejection, never silently dropped;
//   - typed overlap/parent/derivative cross-family relations with
//     self-relation prevented in the UI;
//   - keyboard/focus restoration around the confirmation dialog and long
//     family names persisting unabridged.
//
// Uses the repo's happy-dom createRoot/act harness — no testing-library.

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { StorageError } from "../../lib/persistence/database";
import { TaskFamilyRegistry } from "./TaskFamilyRegistry";
import type { TaskFamily } from "../../lib/tasks/task-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ---------------------------------------------------------------

const NOW = 1_700_000_000_000;

async function seedFamily(
  repo: InMemoryTaskRepository,
  id: string,
  name: string,
  overrides: Partial<TaskFamily> = {},
): Promise<TaskFamily> {
  const family: TaskFamily = {
    id,
    name,
    description: `Description of ${name}.`,
    parentFamilyId: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    revision: 0,
    ...overrides,
  };
  await repo.createTaskFamily(family);
  return (await repo.getTaskFamily(id))!;
}

// --- Harness -----------------------------------------------------------------

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function render(repo: InMemoryTaskRepository): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <TaskFamilyRegistry repo={repo} />
      </MemoryRouter>,
    );
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

async function settle(turns = 6) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

function setInputValue(el: HTMLElement, value: string, tag: "input" | "textarea") {
  const proto = tag === "input" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

describe("TaskFamilyRegistry — create (spec §3.5)", () => {
  it("creates a family through the real repository with an honest dirty→saved flow", async () => {
    const repo = new InMemoryTaskRepository();
    const h = render(repo);
    await settle();
    expect(h.$("[data-family-registry]")).toBeTruthy();
    click(h.$("button[data-action='new-family']"));
    await settle();
    // The create form is present and starts dirty.
    expect(h.$("[data-family-form='create']")).toBeTruthy();
    expect(h.$("[data-family-status]")?.textContent).toMatch(/unsaved/i);
    setInputValue(h.$("input[data-field='name']")!, "Summarization", "input");
    setInputValue(
      h.$("textarea[data-field='description']")!,
      "Tasks that summarize content.",
      "textarea",
    );
    click(h.$("button[data-action='save-family']"));
    await settle();
    const families = await repo.listTaskFamilies(true);
    expect(families).toHaveLength(1);
    expect(families[0].name).toBe("Summarization");
    expect(families[0].description).toBe("Tasks that summarize content.");
    expect(families[0].parentFamilyId).toBeNull();
    expect(families[0].revision).toBe(0);
    // Saved state is honest: the status flips and the row is visible.
    expect(h.$("[data-family-status]")?.textContent).toMatch(/saved/i);
    expect(h.$("[data-family-row]")?.textContent).toContain("Summarization");
    cleanup(h);
  });

  it("creates a family under an existing parent via the parent select", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-root", "Root");
    const h = render(repo);
    await settle();
    click(h.$("button[data-action='new-family']"));
    await settle();
    setInputValue(h.$("input[data-field='name']")!, "Child", "input");
    const parent = h.$("select[data-field='parent']") as HTMLSelectElement;
    expect(parent).toBeTruthy();
    expect(parent.textContent).toContain("Root");
    selectValue(parent, "fam-root");
    click(h.$("button[data-action='save-family']"));
    await settle();
    const child = (await repo.listTaskFamilies(true)).find((f) => f.name === "Child")!;
    expect(child.parentFamilyId).toBe("fam-root");
    cleanup(h);
  });

  it("keeps Save disabled until the family name is non-empty", async () => {
    const repo = new InMemoryTaskRepository();
    const h = render(repo);
    await settle();
    click(h.$("button[data-action='new-family']"));
    await settle();
    const save = h.$("button[data-action='save-family']") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    setInputValue(h.$("input[data-field='name']")!, "Named", "input");
    expect(save.disabled).toBe(false);
    cleanup(h);
  });

  it("persists very long family names unabridged and wraps them in the row", async () => {
    const repo = new InMemoryTaskRepository();
    const longName = `Family ${"F".repeat(2000)}`;
    const h = render(repo);
    await settle();
    click(h.$("button[data-action='new-family']"));
    await settle();
    setInputValue(h.$("input[data-field='name']")!, longName, "input");
    click(h.$("button[data-action='save-family']"));
    await settle();
    const families = await repo.listTaskFamilies(true);
    expect(families).toHaveLength(1);
    expect(families[0].name).toBe(longName);
    expect(h.$("[data-family-row]")?.textContent).toContain(longName);
    cleanup(h);
  });
});

describe("TaskFamilyRegistry — edit with CAS and conflict (spec §3.5)", () => {
  it("edits name, description, and parent through updateTaskFamily with revision CAS", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "Original");
    await seedFamily(repo, "fam-b", "Other");
    const h = render(repo);
    await settle();
    click(h.$("[data-family-row='fam-a'] button[data-action='edit-family']"));
    await settle();
    const form = h.$("[data-family-form='edit']");
    expect(form).toBeTruthy();
    setInputValue(h.$("input[data-field='name']")!, "Renamed", "input");
    selectValue(h.$("select[data-field='parent']")!, "fam-b");
    click(h.$("button[data-action='save-family']"));
    await settle();
    const famA = (await repo.getTaskFamily("fam-a"))!;
    expect(famA.name).toBe("Renamed");
    expect(famA.parentFamilyId).toBe("fam-b");
    expect(famA.revision).toBe(1);
    cleanup(h);
  });

  it("a stale revision surfaces an honest conflict banner and recovers through Reload", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "Original");
    const h = render(repo);
    await settle();
    click(h.$("[data-family-row='fam-a'] button[data-action='edit-family']"));
    await settle();
    setInputValue(h.$("input[data-field='name']")!, "UI rename", "input");
    // External writer bumps the revision behind the open form.
    const famA = (await repo.getTaskFamily("fam-a"))!;
    await repo.updateTaskFamily({ ...famA, description: "external edit" }, famA.revision);
    click(h.$("button[data-action='save-family']"));
    await settle();
    // Conflict banner, not a silent retry or overwrite.
    expect(h.$("[data-family-conflict]")).toBeTruthy();
    expect((await repo.getTaskFamily("fam-a"))!.name).toBe("Original");
    click(h.$("button[data-action='reload-families']"));
    await settle();
    expect(h.$("[data-family-conflict]")).toBeNull();
    // The reload re-baselined the registry from stored state.
    expect(h.$("[data-family-row='fam-a']")?.textContent).toContain("external edit");
    cleanup(h);
  });

  it("surfaces a cycle rejection from the repository instead of saving", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    await seedFamily(repo, "fam-b", "B", { parentFamilyId: "fam-a" });
    const h = render(repo);
    await settle();
    click(h.$("[data-family-row='fam-a'] button[data-action='edit-family']"));
    await settle();
    // fam-b → fam-a already exists; making fam-a's parent fam-b closes a loop.
    selectValue(h.$("select[data-field='parent']")!, "fam-b");
    click(h.$("button[data-action='save-family']"));
    await settle();
    expect(h.$("[data-family-error]")?.textContent).toMatch(/cycle/i);
    expect((await repo.getTaskFamily("fam-a"))!.parentFamilyId).toBeNull();
    cleanup(h);
  });

  it("the edit parent select excludes the family itself (self-parent is unreachable)", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    const h = render(repo);
    await settle();
    click(h.$("[data-family-row='fam-a'] button[data-action='edit-family']"));
    await settle();
    const parent = h.$("select[data-field='parent']") as HTMLSelectElement;
    const optionValues = [...parent.querySelectorAll("option")].map((o) => o.value);
    expect(optionValues).not.toContain("fam-a");
    cleanup(h);
  });
});

describe("TaskFamilyRegistry — archive/restore with explicit confirmation", () => {
  it("archiving asks for confirmation; cancel writes nothing", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    const h = render(repo);
    await settle();
    const archiveBtn = h.$("[data-family-row='fam-a'] button[data-action='archive-family']")!;
    act(() => {
      archiveBtn.focus();
      (archiveBtn as HTMLButtonElement).click();
    });
    await settle();
    const dialog = document.querySelector("[role=dialog]");
    expect(dialog).toBeTruthy();
    // Nothing archived before the explicit commit.
    expect((await repo.getTaskFamily("fam-a"))!.archivedAt).toBeNull();
    click(document.querySelector("button[data-action='cancel-archive-family']"));
    await settle();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect((await repo.getTaskFamily("fam-a"))!.archivedAt).toBeNull();
    cleanup(h);
  });

  it("committing the archive dialog archives the family and marks the row", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    const h = render(repo);
    await settle();
    const archiveBtn = h.$("[data-family-row='fam-a'] button[data-action='archive-family']")!;
    act(() => {
      archiveBtn.focus();
      (archiveBtn as HTMLButtonElement).click();
    });
    await settle();
    click(document.querySelector("button[data-action='confirm-archive-family']"));
    await settle();
    expect((await repo.getTaskFamily("fam-a"))!.archivedAt).not.toBeNull();
    expect(h.$("[data-family-archived='fam-a']")).toBeTruthy();
    // Archived families offer Restore instead of Archive.
    expect(h.$("[data-family-row='fam-a'] button[data-action='restore-family']")).toBeTruthy();
    cleanup(h);
  });

  it("restoring an archived family goes through the same confirmation boundary", async () => {
    const repo = new InMemoryTaskRepository();
    const fam = await seedFamily(repo, "fam-a", "A");
    await repo.archiveTaskFamily(fam.id, fam.revision);
    const h = render(repo);
    await settle();
    const restoreBtn = h.$("[data-family-row='fam-a'] button[data-action='restore-family']")!;
    act(() => {
      restoreBtn.focus();
      (restoreBtn as HTMLButtonElement).click();
    });
    await settle();
    click(document.querySelector("button[data-action='confirm-restore-family']"));
    await settle();
    expect((await repo.getTaskFamily("fam-a"))!.archivedAt).toBeNull();
    expect(h.$("[data-family-archived='fam-a']")).toBeNull();
    cleanup(h);
  });

  it("closing the archive dialog with Escape restores focus to the trigger", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    const h = render(repo);
    await settle();
    const archiveBtn = h.$(
      "[data-family-row='fam-a'] button[data-action='archive-family']",
    ) as HTMLButtonElement;
    act(() => {
      archiveBtn.focus();
      archiveBtn.click();
    });
    await settle();
    expect(document.querySelector("[role=dialog]")).toBeTruthy();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(archiveBtn);
    cleanup(h);
  });
});

describe("TaskFamilyRegistry — typed relations (spec §3.5)", () => {
  it("creates overlap/parent/derivative relations through the relation repository", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    await seedFamily(repo, "fam-b", "B");
    const h = render(repo);
    await settle();
    selectValue(h.$("select[data-field='relation-from']")!, "fam-a");
    selectValue(h.$("select[data-field='relation-to']")!, "fam-b");
    selectValue(h.$("select[data-field='relation-kind']")!, "derivative");
    click(h.$("button[data-action='save-relation']"));
    await settle();
    const relations = await repo.listTaskFamilyRelations();
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      fromFamilyId: "fam-a",
      toFamilyId: "fam-b",
      kind: "derivative",
    });
    // The relation row renders with both family names and the kind.
    const row = h.$("[data-relation-row]");
    expect(row?.textContent).toContain("A");
    expect(row?.textContent).toContain("B");
    expect(row?.textContent).toMatch(/derivative/i);
    cleanup(h);
  });

  it("the relation target select excludes the chosen source family (no self-relation)", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    await seedFamily(repo, "fam-b", "B");
    const h = render(repo);
    await settle();
    selectValue(h.$("select[data-field='relation-from']")!, "fam-a");
    const to = h.$("select[data-field='relation-to']") as HTMLSelectElement;
    const optionValues = [...to.querySelectorAll("option")].map((o) => o.value);
    expect(optionValues).not.toContain("fam-a");
    cleanup(h);
  });

  it("surfaces a repository rejection as an error instead of dropping silently", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    await seedFamily(repo, "fam-b", "B");
    // Wrapper that rejects relation writes with a classified conflict.
    const rejecting = new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === "createTaskFamilyRelation") {
          return () => Promise.reject(new StorageError("conflict", "fam-b was deleted elsewhere"));
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const h = render(rejecting as InMemoryTaskRepository);
    await settle();
    selectValue(h.$("select[data-field='relation-from']")!, "fam-a");
    selectValue(h.$("select[data-field='relation-to']")!, "fam-b");
    selectValue(h.$("select[data-field='relation-kind']")!, "overlap");
    click(h.$("button[data-action='save-relation']"));
    await settle();
    expect(h.$("[data-family-error]")?.textContent).toMatch(/conflict|deleted/i);
    expect(await repo.listTaskFamilyRelations()).toHaveLength(0);
    cleanup(h);
  });

  it("lists existing relations in deterministic order on load", async () => {
    const repo = new InMemoryTaskRepository();
    await seedFamily(repo, "fam-a", "A");
    await seedFamily(repo, "fam-b", "B");
    await seedFamily(repo, "fam-c", "C");
    await repo.createTaskFamilyRelation({
      id: "rel-1",
      fromFamilyId: "fam-a",
      toFamilyId: "fam-b",
      kind: "overlap",
      createdAt: NOW + 2,
    });
    await repo.createTaskFamilyRelation({
      id: "rel-2",
      fromFamilyId: "fam-b",
      toFamilyId: "fam-c",
      kind: "parent",
      createdAt: NOW + 1,
    });
    const h = render(repo);
    await settle();
    const rows = h.$$("[data-relation-row]");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/parent/i);
    expect(rows[1].textContent).toMatch(/overlap/i);
    cleanup(h);
  });
});
