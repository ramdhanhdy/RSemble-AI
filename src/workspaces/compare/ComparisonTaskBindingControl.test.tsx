// @vitest-environment happy-dom
// =============================================================================
// RSemble AI — ComparisonTaskBindingControl tests (spec §7.1, §7.2)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 7 (RED first).
//
// Covers the canonical Task selection/version boundary for the Compare command pane:
//   - search/select canonical Task and exact version;
//   - latest version by default with visible pin;
//   - open Task detail;
//   - clear binding and continue ad hoc;
//   - selecting a Task populates candidate-visible definition and context manifest;
//   - editing task-defining content marks new-Task-version draft;
//   - before run: Create Task vN+1 and run, Run as ad hoc, or Cancel;
//   - no silent mutation of canonical versions, no automatic unlinking;
//   - stale version CAS conflict surfaced cleanly.
// =============================================================================

import { describe, expect, it, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import type { ComparisonTaskBinding } from "../../lib/compare/comparison-result-types";
import { ComparisonTaskBindingControl } from "./ComparisonTaskBindingControl";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

const cleanups: Harness[] = [];

function renderWithRouter(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  const h: Harness = {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
  cleanups.push(h);
  return h;
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

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

afterEach(() => {
  for (const h of cleanups) {
    act(() => h.root.unmount());
    h.container.remove();
  }
  cleanups.length = 0;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Fixtures ----------------------------------------------------------------

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
    candidateInstruction: `Instruction for ${taskId} v${version}.`,
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
  versions: number = 1,
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
  for (let v = 2; v <= versions; v++) {
    const nextVer = taskVersionFor(id, v, overrides);
    const rec = (await repo.getTaskRecord(id))!;
    await repo.appendTaskVersion(rec, nextVer, rec.revision);
  }
  return (await repo.getTaskRecord(id))!;
}

// --- Contract Tests ----------------------------------------------------------

describe("ComparisonTaskBindingControl", () => {
  it("renders ad hoc state when unlinked and opens task search picker", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-1", 1, { title: "Binary Search Implementation" });

    const onSelectTask = vi.fn();
    const onClearBinding = vi.fn();

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={null}
        prompt="Ad hoc prompt"
        onSelectTask={onSelectTask}
        onClearBinding={onClearBinding}
      />,
    );
    await settle();

    // Check ad-hoc label and link action
    expect(h.$("[data-testid='task-binding-status']")?.textContent).toContain("Ad hoc comparison");
    const linkBtn = h.$("button[data-action='open-task-picker']");
    expect(linkBtn).not.toBeNull();
    expect(linkBtn?.getAttribute("aria-label")).toBe("Link canonical task");

    // Click link button to open picker
    act(() => {
      linkBtn?.click();
    });
    await settle();

    // Picker search input appears
    const searchInput = h.$("input[data-action='search-tasks']") as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    expect(searchInput?.getAttribute("aria-label")).toBe("Search canonical tasks");

    // Task from repository is listed
    expect(h.container.textContent).toContain("Binary Search Implementation");
  });

  it("searches and selects a canonical Task, populating candidate definition and binding to latest version", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-sort", 2, {
      title: "Sort Benchmark",
      candidateInstruction: "Implement quicksort in TypeScript.",
    });

    const onSelectTask = vi.fn();
    const onClearBinding = vi.fn();
    const onPromptChange = vi.fn();

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={null}
        prompt=""
        onSelectTask={onSelectTask}
        onClearBinding={onClearBinding}
        onPromptChange={onPromptChange}
      />,
    );
    await settle();

    // Open picker
    act(() => {
      h.$("button[data-action='open-task-picker']")?.click();
    });
    await settle();

    const searchInput = h.$("input[data-action='search-tasks']") as HTMLInputElement;
    typeInto(searchInput, "Sort");
    await settle();

    // Select the task item
    const selectBtn = h.$("button[data-task-id='task-sort']");
    expect(selectBtn).not.toBeNull();
    act(() => {
      selectBtn?.click();
    });
    await settle();

    // Verifies onSelectTask called with record and latest version (v2)
    expect(onSelectTask).toHaveBeenCalledTimes(1);
    const [selectedRecord, selectedVersion] = onSelectTask.mock.calls[0];
    expect(selectedRecord.id).toBe("task-sort");
    expect(selectedVersion.version).toBe(2);
    expect(selectedVersion.candidateInstruction).toBe("Implement quicksort in TypeScript.");

    // Verifies definition population
    expect(onPromptChange).toHaveBeenCalledWith("Implement quicksort in TypeScript.");
  });

  it("displays pinned latest version with visible pin badge and task details link", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-pinned", 2, {
      title: "Pinned Math Evaluation",
      candidateInstruction: "Calculate primes.",
    });

    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-pinned",
      taskVersion: 2,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Calculate primes."
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    // Verify task title is rendered
    expect(h.container.textContent).toContain("Pinned Math Evaluation");

    // Verify pin badge
    const pinBadge = h.$("[data-testid='task-pin-badge']");
    expect(pinBadge).not.toBeNull();
    expect(pinBadge?.textContent).toContain("v2");
    expect(pinBadge?.textContent).toContain("latest");

    // Verify open task detail link
    const detailLink = h.$("a[data-action='open-task-detail']");
    expect(detailLink).not.toBeNull();
    expect(detailLink?.getAttribute("href")).toBe("/tasks/task-pinned/versions/2");
    expect(detailLink?.getAttribute("aria-label")).toBe("Open task detail");
  });

  it("allows selecting an older version and updates binding and prompt", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-ver", 3, {
      title: "Multi-version Task",
    });

    // Custom instruction for v1
    const v1 = (await repo.getTaskVersion("task-ver", 1))!;
    expect(v1.candidateInstruction).toBe("Instruction for task-ver v1.");

    const onSelectTask = vi.fn();
    const onVersionChange = vi.fn();
    const onPromptChange = vi.fn();

    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-ver",
      taskVersion: 3,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Instruction for task-ver v3."
        onSelectTask={onSelectTask}
        onVersionChange={onVersionChange}
        onPromptChange={onPromptChange}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    // Select older version (v1)
    const versionSelect = h.$("select[data-action='select-task-version']") as HTMLSelectElement;
    expect(versionSelect).not.toBeNull();
    expect(versionSelect.value).toBe("3");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(versionSelect, "1");
      versionSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    // Verifies onVersionChange called with v1
    expect(onVersionChange).toHaveBeenCalledTimes(1);
    const ver1 = onVersionChange.mock.calls[0][0] as TaskVersion;
    expect(ver1.version).toBe(1);
    expect(onPromptChange).toHaveBeenCalledWith("Instruction for task-ver v1.");
  });

  it("clears canonical binding back to ad hoc without deleting prompt content", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-clear", 1, {
      title: "Task To Unlink",
      candidateInstruction: "Persistent user prompt text.",
    });

    const onClearBinding = vi.fn();
    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-clear",
      taskVersion: 1,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Persistent user prompt text."
        onSelectTask={vi.fn()}
        onClearBinding={onClearBinding}
      />,
    );
    await settle();

    const clearBtn = h.$("button[data-action='clear-task-binding']");
    expect(clearBtn).not.toBeNull();
    expect(clearBtn?.getAttribute("aria-label")).toBe("Clear task binding");

    act(() => {
      clearBtn?.click();
    });
    await settle();

    expect(onClearBinding).toHaveBeenCalledTimes(1);
  });

  it("marks comparison as new-Task-version draft when task-defining prompt is modified without silent mutation or auto-unlinking", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-edit", 1, {
      title: "Editable Task",
      candidateInstruction: "Original canonical instruction.",
    });

    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-edit",
      taskVersion: 1,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Modified prompt with new constraints!"
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    // Draft badge appears indicating draft of next version (v2)
    const draftBadge = h.$("[data-testid='task-draft-badge']");
    expect(draftBadge).not.toBeNull();
    expect(draftBadge?.textContent).toContain("New Task version draft");
    expect(draftBadge?.textContent).toContain("v2");

    // Canonical version in repo is strictly unchanged (no silent mutation)
    const v1 = await repo.getTaskVersion("task-edit", 1);
    expect(v1?.candidateInstruction).toBe("Original canonical instruction.");

    // Task latestVersion remains 1 in repo
    const rec = await repo.getTaskRecord("task-edit");
    expect(rec?.latestVersion).toBe(1);
  });

  it("handles pre-run decision: Create Task vN+1 and run commits version before execution", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-prerun-1", 1, {
      title: "Pre-run Task",
      candidateInstruction: "Instruction v1.",
    });

    const onProceedRun = vi.fn();
    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-prerun-1",
      taskVersion: 1,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Instruction modified for v2."
        isPreRunPromptOpen={true}
        onProceedRun={onProceedRun}
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    // Pre-run modal is visible
    const modal = h.$("[data-testid='task-version-draft-modal']");
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute("role")).toBe("dialog");

    // Choose "Create Task vN+1 and run"
    const createBtn = h.$("button[data-action='create-version-and-run']");
    expect(createBtn).not.toBeNull();

    await act(async () => {
      createBtn?.click();
    });
    await settle();

    // Verifies v2 was committed to TaskRepository
    const rec = await repo.getTaskRecord("task-prerun-1");
    expect(rec?.latestVersion).toBe(2);
    const v2 = await repo.getTaskVersion("task-prerun-1", 2);
    expect(v2).not.toBeNull();
    expect(v2?.candidateInstruction).toBe("Instruction modified for v2.");

    // Verifies onProceedRun called with the updated canonical binding { taskId, taskVersion: 2 }
    expect(onProceedRun).toHaveBeenCalledWith({
      kind: "canonical",
      taskId: "task-prerun-1",
      taskVersion: 2,
    });
  });

  it("handles pre-run decision: Run as ad hoc preserves canonical Task unchanged", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-prerun-2", 1, {
      title: "Ad hoc Fallback Task",
      candidateInstruction: "Instruction v1.",
    });

    const onProceedRun = vi.fn();
    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-prerun-2",
      taskVersion: 1,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Ad hoc modified text."
        isPreRunPromptOpen={true}
        onProceedRun={onProceedRun}
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    // Choose "Run as ad hoc"
    const adhocBtn = h.$("button[data-action='run-ad-hoc']");
    expect(adhocBtn).not.toBeNull();

    await act(async () => {
      adhocBtn?.click();
    });
    await settle();

    // Verifies canonical Task in repository was NOT mutated
    const rec = await repo.getTaskRecord("task-prerun-2");
    expect(rec?.latestVersion).toBe(1);
    const v2 = await repo.getTaskVersion("task-prerun-2", 2);
    expect(v2).toBeNull();

    // Verifies onProceedRun called with null (ad-hoc binding)
    expect(onProceedRun).toHaveBeenCalledWith(null);
  });

  it("handles pre-run decision: Cancel closes prompt with no repo mutation and no execution", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-prerun-3", 1, {
      title: "Cancel Task",
      candidateInstruction: "Instruction v1.",
    });

    const onProceedRun = vi.fn();
    const onPreRunPromptClose = vi.fn();
    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-prerun-3",
      taskVersion: 1,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Modified prompt."
        isPreRunPromptOpen={true}
        onProceedRun={onProceedRun}
        onPreRunPromptClose={onPreRunPromptClose}
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    const cancelBtn = h.$("button[data-action='cancel-run']");
    expect(cancelBtn).not.toBeNull();

    await act(async () => {
      cancelBtn?.click();
    });
    await settle();

    // Repo was not mutated
    const rec = await repo.getTaskRecord("task-prerun-3");
    expect(rec?.latestVersion).toBe(1);

    // No run initiated
    expect(onProceedRun).not.toHaveBeenCalled();
    expect(onPreRunPromptClose).toHaveBeenCalled();
  });

  it("surfaces stale version CAS conflict cleanly without proceeding with run", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-conflict", 1, {
      title: "Conflict Task",
      candidateInstruction: "Original v1.",
    });

    // Simulate concurrent modification bump in repository behind the scene
    const rec = (await repo.getTaskRecord("task-conflict"))!;
    await repo.appendTaskVersion(
      rec,
      taskVersionFor("task-conflict", 2, { candidateInstruction: "Concurrent v2" }),
      rec.revision,
    );

    const onProceedRun = vi.fn();
    // Compare still thinks it's at v1
    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-conflict",
      taskVersion: 1,
    };

    // When attempting to create next version from stale record revision (expected 0 vs current 1)
    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="My conflicting edits"
        isPreRunPromptOpen={true}
        onProceedRun={onProceedRun}
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    // Trigger create version and run
    const createBtn = h.$("button[data-action='create-version-and-run']");
    await act(async () => {
      createBtn?.click();
    });
    await settle();

    // Conflict banner appears
    const conflictBanner = h.$("[data-testid='task-conflict-banner']");
    expect(conflictBanner).not.toBeNull();
    expect(conflictBanner?.textContent).toContain("Version conflict");

    // Run was NOT called
    expect(onProceedRun).not.toHaveBeenCalled();
  });

  it("ensures all controls are keyboard-operable and have min 44px touch targets", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "task-a11y", 2, { title: "Accessible Task" });

    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-a11y",
      taskVersion: 2,
    };

    const h = renderWithRouter(
      <ComparisonTaskBindingControl
        repo={repo}
        binding={binding}
        prompt="Accessible prompt"
        onSelectTask={vi.fn()}
        onClearBinding={vi.fn()}
      />,
    );
    await settle();

    const buttons = h.$$("button");
    const links = h.$$("a");
    const selects = h.$$("select");

    const interactive = [...buttons, ...links, ...selects];
    expect(interactive.length).toBeGreaterThan(0);

    for (const el of interactive) {
      // Must have aria-label or accessible text
      const hasAria = el.getAttribute("aria-label") || el.textContent?.trim();
      expect(hasAria).toBeTruthy();

      // Check min 44px class or sizing
      const classes = el.className;
      const is44px =
        classes.includes("min-h-[44px]") ||
        classes.includes("h-11") ||
        classes.includes("min-w-[44px]");
      expect(is44px).toBe(true);
    }
  });
});
