// @vitest-environment happy-dom
//
// TaskEditor tests — Child 02 (Canonical Tasks) Milestone D, Task 7 (RED first).
//
// Covers the create/edit/version/detail surface contract from
// canonical-tasks spec §7.2-§7.3 and the implementation plan Task 7 RED list:
//   - atomic create of Task + version 1 from /tasks/new;
//   - latest-version editing with distinct dirty/saved state and an explicit
//     two-step "Create version N+1" confirmation;
//   - historical versions remain read-only (committed versions are immutable);
//   - duplicate creates a new authored Task identity — never an implied
//     version of the source;
//   - archive/restore with revision CAS, conflict banners with reload for
//     stale state, and no delete control anywhere;
//   - long fields stay editable, wrap in display, and persist unabridged;
//   - direct loads surface unknown IDs/versions as explicit not-found states.
//
// Uses the repo's happy-dom createRoot/act harness — no testing-library.

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import { buildNextVersion } from "../../lib/tasks/task-versioning";
import { TaskNewRoute, TaskDetailRoute, TaskVersionRoute } from "./TaskRoute";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ---------------------------------------------------------------

const NOW = 1_700_000_000_000;

function taskVersionFor(
  taskId: string,
  version: number,
  overrides: Partial<TaskVersion> = {},
): TaskVersion {
  return {
    taskId,
    version,
    title: `Task ${taskId} v${version}`,
    objective: `Objective for ${taskId}.`,
    candidateInstruction: `Do the thing for ${taskId}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: NOW + version,
    ...overrides,
  };
}

async function seedTask(
  repo: TaskRepository,
  id: string,
  overrides: Partial<TaskVersion> = {},
): Promise<TaskRecord> {
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
  await repo.createTask(record, taskVersionFor(id, 1, overrides));
  return record;
}

/** Seed a v2 on top of v1 so historical-version behavior is observable. */
async function seedV2(repo: TaskRepository, id: string): Promise<TaskRecord> {
  const record = (await repo.getTaskRecord(id))!;
  const latest = (await repo.getTaskVersion(id, record.latestVersion))!;
  const next = buildNextVersion({
    latestVersion: record.latestVersion,
    taskId: id,
    draft: { ...latest, title: `Task ${id} v2`, candidateInstruction: "Updated instruction." },
    createdAt: NOW + 2,
    source: { kind: "authored", legacyScopeKey: null, note: null },
  });
  await repo.appendTaskVersion(record, next, record.revision);
  return (await repo.getTaskRecord(id))!;
}

// --- Harness -----------------------------------------------------------------

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

async function settle(turns = 6) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

// --- happy-dom native-setter helpers ---------------------------------------
// React's synthetic input/textarea onChange only fires when the value is set
// through the element prototype's own setter before dispatching the event.

function setInputValue(el: HTMLElement, value: string, tag: "input" | "textarea") {
  const proto = tag === "input" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fillTitle(h: Harness, value: string) {
  const el = h.$("input[data-editor-field='title']");
  if (!el) throw new Error("title input not found");
  setInputValue(el, value, "input");
}

function fillObjective(h: Harness, value: string) {
  const el = h.$("textarea[data-editor-field='objective']");
  if (!el) throw new Error("objective textarea not found");
  setInputValue(el, value, "textarea");
}

function click(el: HTMLElement | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    (el as HTMLButtonElement).click();
  });
}

// --- Tests --------------------------------------------------------------------

describe("TaskNewRoute — atomic create of Task + version 1 (spec §7.3)", () => {
  it("renders a real create form with accessible labels — not the Task 6 placeholder", async () => {
    const h = render(<TaskNewRoute repo={new InMemoryTaskRepository()} />);
    await settle();
    expect(h.$("[data-task-editor='new']")).toBeTruthy();
    expect(h.$("[data-task-new-placeholder]")).toBeNull();
    // Every editable field is reachable by its accessible label.
    expect(h.$("input[data-editor-field='title']")).toBeTruthy();
    expect(h.$("textarea[data-editor-field='objective']")).toBeTruthy();
    expect(h.$("textarea[data-editor-field='instruction']")).toBeTruthy();
    expect(h.$$("label").some((l) => (l.textContent ?? "").includes("Title"))).toBe(true);
    cleanup(h);
  });

  it("keeps Create task disabled until the required title and objective are filled", async () => {
    const h = render(<TaskNewRoute repo={new InMemoryTaskRepository()} />);
    await settle();
    const button = h.$("button[data-action='create-task']") as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(true);
    fillTitle(h, "Summarize earnings calls");
    expect(button.disabled).toBe(true);
    fillObjective(h, "Condense a full earnings call into decision-grade bullets.");
    expect(button.disabled).toBe(false);
    cleanup(h);
  });

  it("creating commits Task + version 1 atomically and navigates to the new Task", async () => {
    const repo = new InMemoryTaskRepository();
    const h = render(<TaskNewRoute repo={repo} />);
    await settle();
    fillTitle(h, "Triage support inbox");
    fillObjective(h, "Route inbound mail to the owning queue.");
    click(h.$("button[data-action='create-task']"));
    await settle();
    // Atomic: the record and immutable version 1 both exist with the
    // canonical shape (latestVersion 1, revision 0, origin authored).
    const tasks = await repo.listTasks({ includeArchived: true });
    expect(tasks).toHaveLength(1);
    const record = tasks[0];
    expect(record.latestVersion).toBe(1);
    expect(record.revision).toBe(0);
    expect(record.origin).toBe("authored");
    const v1 = await repo.getTaskVersion(record.id, 1);
    expect(v1?.title).toBe("Triage support inbox");
    expect(v1?.objective).toBe("Route inbound mail to the owning queue.");
    // Detail link rendered by the success state points at the new identity.
    const link = h.$("a[data-action='open-created-task']");
    expect(link?.getAttribute("href")).toBe(`/tasks/${record.id}`);
    expect(link?.textContent).toContain("Triage support inbox");
  });

  it("persists very long fields unabridged on create", async () => {
    const repo = new InMemoryTaskRepository();
    const longTitle = `Long ${"T".repeat(4000)}`;
    const longObjective = `Longer ${"O".repeat(12000)}`;
    const h = render(<TaskNewRoute repo={repo} />);
    await settle();
    fillTitle(h, longTitle);
    fillObjective(h, longObjective);
    click(h.$("button[data-action='create-task']"));
    await settle();
    const tasks = await repo.listTasks({ includeArchived: true });
    expect(tasks).toHaveLength(1);
    const v1 = await repo.getTaskVersion(tasks[0].id, 1);
    expect(v1?.title).toBe(longTitle);
    expect(v1?.objective).toBe(longObjective);
    cleanup(h);
  });
});

describe("TaskDetailRoute — dirty/saved draft state (spec §7.2)", () => {
  it("newest-first editing of the latest version flips Saved → Unsaved → Saved", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    const status = h.$("[data-editor-status]");
    expect(status?.textContent).toMatch(/saved/i);
    fillTitle(h, "A changed title");
    expect(status?.textContent).toMatch(/unsaved/i);
    // The draft does not silently persist: dirty state is in-memory only
    // until the explicit Create version action completes.
    const v1 = await repo.getTaskVersion("t-1", 1);
    expect(v1?.title).not.toBe("A changed title");
    cleanup(h);
  });

  it("dirty draft fields stay editable for very long values without truncation", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    const longValue = `Long ${"L".repeat(4000)}`;
    fillTitle(h, longValue);
    await settle();
    const input = h.$("input[data-editor-field='title']") as HTMLInputElement;
    expect(input.value).toBe(longValue);
    expect(h.$("[data-editor-status]")?.textContent).toMatch(/unsaved/i);
    cleanup(h);
  });
});

describe("TaskDetailRoute — explicit Create version N+1 confirmation (spec §7.2)", () => {
  it("committing a dirty draft asks for confirmation, then appends version N+1 exactly once", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    const createButton = h.$("button[data-action='create-version']") as HTMLButtonElement;
    // Clean state: the action labels what it will create but is inert.
    expect(createButton).toBeTruthy();
    expect(createButton.disabled).toBe(true);
    fillTitle(h, "Now different");
    expect(createButton.disabled).toBe(false);
    click(createButton);
    await settle();
    // Confirmation boundary: version 2 is NOT committed until the explicit
    // confirm step — the button flips into a confirm/cancel pair.
    expect(await repo.getTaskVersion("t-1", 2)).toBeNull();
    const confirm = h.$("button[data-action='confirm-version']");
    expect(confirm).toBeTruthy();
    expect(confirm?.textContent).toMatch(/Create version 2/);
    expect(h.$("button[data-action='cancel-version']")).toBeTruthy();
    click(confirm);
    await settle();
    // Append CAS happened exactly once: v2 exists, latestVersion is 2.
    const v2 = await repo.getTaskVersion("t-1", 2);
    expect(v2?.title).toBe("Now different");
    const record = (await repo.getTaskRecord("t-1"))!;
    expect(record.latestVersion).toBe(2);
    expect(record.revision).toBe(1);
    // Draft re-baselines to the new latest version.
    expect(h.$("[data-editor-status]")?.textContent).toMatch(/saved/i);
    expect((h.$("input[data-editor-field='title']") as HTMLInputElement).value).toBe(
      "Now different",
    );
  });

  it("cancelling the Create version confirmation keeps the draft dirty and writes nothing", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    fillTitle(h, "Cancelled change");
    click(h.$("button[data-action='create-version']"));
    await settle();
    click(h.$("button[data-action='cancel-version']"));
    await settle();
    expect(await repo.getTaskVersion("t-1", 2)).toBeNull();
    expect((await repo.getTaskRecord("t-1"))!.latestVersion).toBe(1);
    // The draft survives cancellation — still dirty, still editable.
    expect(h.$("[data-editor-status]")?.textContent).toMatch(/unsaved/i);
    expect((h.$("input[data-editor-field='title']") as HTMLInputElement).value).toBe(
      "Cancelled change",
    );
    cleanup(h);
  });

  it("a stale revision surfaces an honest conflict banner and recovers through Reload", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    fillTitle(h, "UI draft");
    // Simulate a concurrent tab/app writer bumping the revision behind the UI.
    const record = (await repo.getTaskRecord("t-1"))!;
    const latest = (await repo.getTaskVersion("t-1", 1))!;
    const external = buildNextVersion({
      latestVersion: 1,
      taskId: "t-1",
      draft: { ...latest, title: "External tab change" },
      createdAt: NOW + 50,
      source: { kind: "authored", legacyScopeKey: null, note: null },
    });
    await repo.appendTaskVersion(record, external, record.revision);
    // The UI's own commit now fights a stale revision → conflict, not a loss.
    click(h.$("button[data-action='create-version']"));
    await settle();
    click(h.$("button[data-action='confirm-version']"));
    await settle();
    const conflict = h.$("[data-task-conflict]");
    expect(conflict).toBeTruthy();
    expect(conflict?.getAttribute("role")).toBe("alert");
    expect(conflict?.textContent).toMatch(/changed|conflict/i);
    // Recovery is explicit and honest: reload re-baselines the draft to the
    // newest committed version instead of retrying the stale write.
    const reload = h.$("button[data-action='reload-task']");
    expect(reload).toBeTruthy();
    click(reload);
    await settle();
    expect(h.$("[data-task-conflict]")).toBeNull();
    expect((h.$("input[data-editor-field='title']") as HTMLInputElement).value).toBe(
      "External tab change",
    );
    expect(h.$("[data-editor-status]")?.textContent).toMatch(/saved/i);
  });
});

describe("TaskVersionRoute — immutable historical versions (spec §3.2, §7.2)", () => {
  it("renders a historical version read-only with a switcher — never editable", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    await seedV2(repo, "t-1");
    const h = render(<TaskVersionRoute repo={repo} taskId="t-1" version={1} />);
    await settle();
    expect(h.$("[data-task-version='t-1@1']")).toBeTruthy();
    // Read-only presentation: disabled labelled inputs and no edit actions.
    const title = h.$("input[data-editor-field='title']") as HTMLInputElement | null;
    expect(title).toBeTruthy();
    expect(title!.disabled).toBe(true);
    expect(title!.value).toBe("Task t-1 v1");
    expect(h.$("button[data-action='create-version']")).toBeNull();
    expect(h.$("button[data-action='create-task']")).toBeNull();
    expect(h.container.textContent).toContain("read-only");
    // Version switcher shows which of the committed versions is on screen.
    const select = h.$("select[data-action='version-select']") as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    expect(select!.value).toBe("1");
    cleanup(h);
  });

  it("keeps an unknown historical version an explicit not-found state", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskVersionRoute repo={repo} taskId="t-1" version={7} />);
    await settle();
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    cleanup(h);
  });
});

describe("TaskDetailRoute — duplicate creates a new authored identity (spec §7.3)", () => {
  it("duplicating copies the latest content into a fresh Task with its own version 1", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    await seedV2(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    click(h.$("button[data-action='duplicate-task']"));
    await settle();
    const tasks = await repo.listTasks({ includeArchived: true });
    expect(tasks).toHaveLength(2);
    const copy = tasks.find((t) => t.id !== "t-1")!;
    // New identity: authored origin, its own version lineage starting at 1 —
    // never an implied version of the source.
    expect(copy.origin).toBe("authored");
    expect(copy.latestVersion).toBe(1);
    expect(copy.revision).toBe(0);
    expect(copy.archivedAt).toBeNull();
    const copyV1 = await repo.getTaskVersion(copy.id, 1);
    // Latest content is copied; provenance states the duplicate identity.
    expect(copyV1?.title).toBe("Task t-1 v2");
    expect(copyV1?.taskId).toBe(copy.id);
    expect(copyV1?.source.kind).toBe("authored");
    // The source is untouched.
    const source = (await repo.getTaskRecord("t-1"))!;
    expect(source.latestVersion).toBe(2);
    const link = h.$("a[data-action='open-duplicate']");
    expect(link?.getAttribute("href")).toBe(`/tasks/${copy.id}`);
  });

  it("never entangles the duplicate's lineage with the source's versions", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    click(h.$("button[data-action='duplicate-task']"));
    await settle();
    const tasks = await repo.listTasks({ includeArchived: true });
    const copy = tasks.find((t) => t.id !== "t-1")!;
    // The copy has exactly one version; asking for the source's higher
    // version numbers on the copy is an explicit not-found, not a leak.
    expect(await repo.getTaskVersion(copy.id, 2)).toBeNull();
    expect(await repo.getTaskVersion("t-1", 1)).toBeTruthy();
    cleanup(h);
  });
});

describe("TaskDetailRoute — archive/restore with revision CAS (spec §4.5)", () => {
  it("hides the editing surface while a Task is archived and keeps it routable", async () => {
    const repo = new InMemoryTaskRepository();
    const record = await seedTask(repo, "t-1");
    await repo.archiveTask("t-1", record.revision);
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    // Archived tasks stay routable; the edit affordances step back but the
    // content and restore affordance remain.
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.container.textContent).toContain("Archived");
    expect(h.$("input[data-editor-field='title']")).toBeNull();
    expect(h.$("button[data-action='create-version']")).toBeNull();
    expect(h.$("button[data-action='restore-task']")).toBeTruthy();
    expect(h.$("button[data-action='archive-task']")).toBeNull();
    cleanup(h);
  });

  it("archiving runs a two-step confirmation, then bounces the version CAS forward", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    click(h.$("button[data-action='archive-task']"));
    await settle();
    // Not archived until confirmed.
    expect((await repo.getTaskRecord("t-1"))!.archivedAt).toBeNull();
    const confirm = h.$("button[data-action='confirm-archive']");
    expect(confirm).toBeTruthy();
    click(confirm);
    await settle();
    const record = (await repo.getTaskRecord("t-1"))!;
    expect(record.archivedAt).not.toBeNull();
    expect(record.revision).toBe(1);
    expect(h.$("button[data-action='restore-task']")).toBeTruthy();
  });

  it("restoring a Task returns it to the editing surface with a bumped revision", async () => {
    const repo = new InMemoryTaskRepository();
    const record = await seedTask(repo, "t-1");
    await repo.archiveTask("t-1", record.revision);
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    click(h.$("button[data-action='restore-task']"));
    await settle();
    const restored = (await repo.getTaskRecord("t-1"))!;
    expect(restored.archivedAt).toBeNull();
    expect(restored.revision).toBe(2);
    expect(h.$("input[data-editor-field='title']")).toBeTruthy();
    expect(h.$("[data-editor-status]")?.textContent).toMatch(/saved/i);
  });

  it("surfaces a stale-revision conflict on archive and recovers through reload", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    // A concurrent writer archives the task first, invalidating the UI's
    // revision before it confirms.
    const record = (await repo.getTaskRecord("t-1"))!;
    await repo.archiveTask("t-1", record.revision);
    click(h.$("button[data-action='archive-task']"));
    await settle();
    click(h.$("button[data-action='confirm-archive']"));
    await settle();
    const conflict = h.$("[data-task-conflict]");
    expect(conflict).toBeTruthy();
    const reload = h.$("button[data-action='reload-task']");
    expect(reload).toBeTruthy();
    click(reload);
    await settle();
    // Reload reflects the externally archived state: restore, not archive.
    expect(h.$("[data-task-conflict]")).toBeNull();
    expect(h.$("button[data-action='restore-task']")).toBeTruthy();
    expect(h.$("button[data-action='archive-task']")).toBeNull();
  });
});

describe("TaskDetailRoute — referenced Tasks have no delete control (spec §4.4, §7.1)", () => {
  it("renders archive affordances but never a delete action at any state", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$$("button[data-action^='delete']")).toHaveLength(0);
    expect(h.$$("[data-action^='delete']")).toHaveLength(0);
    cleanup(h);
  });
});

describe("Task routes — direct loads and unknown IDs (spec §7)", () => {
  it("direct-loads an existing Task detail with the stable identity header", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-direct");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-direct" />);
    await settle();
    expect(h.$("[data-task-detail='t-direct']")).toBeTruthy();
    expect(h.container.textContent).toContain("t-direct");
    cleanup(h);
  });

  it("keeps an unknown Task ID an explicit not-found state (no silent redirect)", async () => {
    const h = render(<TaskDetailRoute repo={new InMemoryTaskRepository()} taskId="no-such-task" />);
    await settle();
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    expect(h.container.textContent).toContain("no-such-task");
    cleanup(h);
  });
});
