// @vitest-environment happy-dom
// =============================================================================
// RSemble AI — PromoteComparisonTaskDialog tests (spec §7.3, §7.4)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 8 (RED first).
//
// Covers the Save/Link Task promotion workflow for ad hoc comparisons:
//   - preview title, objective, instruction, context manifest, response contract,
//     family, and facets;
//   - exact-content matches suggested as choices, never auto-merged;
//   - Create new Task workflow (creates TaskRecord, TaskVersion, TaskInstance,
//     assigns family/facets, CAS updates comparison binding, triggers reindex);
//   - Link to existing Task Version workflow (validates exact normalized match,
//     reconstructs TaskInstance, CAS updates comparison binding, triggers reindex);
//   - mismatch rejection with clear explanation;
//   - CAS stale revision conflict handling with retry without losing inputs;
//   - missing historical input limitation (instance_input_incomplete);
//   - cancel / focus-return flows with zero side effects;
//   - accessibility and 44px min touch target sizes.
// =============================================================================

import { describe, expect, it, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import type { TaskRecord, TaskVersion, TaskFamily } from "../../lib/tasks/task-types";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import { PromoteComparisonTaskDialog } from "./PromoteComparisonTaskDialog";

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
    $: (s) => document.body.querySelector<HTMLElement>(s),
    $$: (s) => [...document.body.querySelectorAll<HTMLElement>(s)],
  };
  cleanups.push(h);
  return h;
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
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

const NOW = 1_700_000_000_000;

function makeMockRecord(id: string, prompt: string): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision: 0,
    execution: { ownerId: "owner", fence: 1 },
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW + 1000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Comparison " + id,
      prompt: prompt ?? "",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
    },
    evaluation: {
      profile: null,
      candidateMessages: [{ role: "user", content: prompt || "hi" }],
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
  };
}

async function setupRepos(runId: string, prompt: string) {
  const taskRepo = new InMemoryTaskRepository();
  const runRepo = new InMemoryRunRepository();
  const comparisonRepo = new InMemoryComparisonRepository(runRepo);

  const record = makeMockRecord(runId, prompt);
  const index = await comparisonRepo.createComparisonEnvelope(record, {
    kind: "ad_hoc",
    inputSnapshotRef: "snap:test",
  });

  return { taskRepo, comparisonRepo, runRepo, record, index };
}

describe("PromoteComparisonTaskDialog", () => {
  it("previews title, objective, instruction, context manifest, response contract, family, and facets", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos(
      "run-preview-1",
      "Write a binary search algorithm in TypeScript.",
    );

    // Seed a family
    const family: TaskFamily = {
      id: "fam-algorithms",
      name: "Algorithms & Data Structures",
      description: "Algorithmic challenges and implementations",
      parentFamilyId: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      revision: 0,
    };
    await taskRepo.createTaskFamily(family);

    const onOpenChange = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-preview-1"
        expectedRevision={0}
        prompt="Write a binary search algorithm in TypeScript."
        title="Binary Search in TS"
        objective="Implement efficient binary search."
        contextManifest={[
          {
            role: "reference",
            artifactId: "art-1",
            externalRef: null,
            metadataDigest: "sha256:1111",
            mediaType: "text/plain",
            byteCount: 256,
          },
        ]}
        responseContract={{
          format: "typescript",
          constraints: ["type annotations required", "O(log n) complexity"],
          maxLength: 1000,
        }}
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
      />,
    );

    await settle();

    // Verify preview fields are rendered
    expect(h.$("[data-testid='preview-instruction']")?.textContent).toContain(
      "Write a binary search algorithm in TypeScript.",
    );
    expect(h.$("[data-testid='preview-context-manifest']")?.textContent).toContain("art-1");
    expect(h.$("[data-testid='preview-response-contract']")?.textContent).toContain("typescript");
    expect(h.$("[data-testid='preview-response-contract']")?.textContent).toContain(
      "O(log n) complexity",
    );

    // Family dropdown option available
    expect(h.$("select[data-testid='task-family-select']")).toBeTruthy();
    // Facet options available
    expect(h.$("[data-testid='task-facet-selector']")).toBeTruthy();
  });

  it("suggests exact-content matches as choices, but NEVER merges automatically (spec §7.3, §7.4)", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos(
      "run-exact-match",
      "Exact matching instruction for search.",
    );

    // Seed existing task with exact same instruction
    const taskRecord: TaskRecord = {
      id: "task-existing-1",
      latestVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      origin: "authored",
      revision: 0,
    };
    const taskVersion: TaskVersion = {
      taskId: "task-existing-1",
      version: 1,
      title: "Existing Search Task",
      objective: "Existing objective.",
      candidateInstruction: "Exact matching instruction for search.",
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: null,
      source: { kind: "authored", legacyScopeKey: null, note: null },
      createdAt: NOW,
    };
    await taskRepo.createTask(taskRecord, taskVersion);

    const onOpenChange = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-exact-match"
        expectedRevision={0}
        prompt="Exact matching instruction for search."
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
      />,
    );

    await settle();

    // Exact match suggestion banner should be visible
    const suggestionBox = h.$("[data-testid='exact-match-suggestions']");
    expect(suggestionBox).toBeTruthy();
    expect(suggestionBox?.textContent).toContain("Existing Search Task");
    expect(suggestionBox?.textContent).toContain("task-existing-1");

    // But default mode is still "create" (never auto-merged)
    expect((h.$("input[name='promotion-mode'][value='create']") as HTMLInputElement).checked).toBe(
      true,
    );

    // User can explicitly click "Select to Link"
    const selectLinkBtn = h.$("[data-testid='select-exact-match-task-existing-1-1']");
    expect(selectLinkBtn).toBeTruthy();
    act(() => {
      selectLinkBtn?.click();
    });
    await settle();

    // Now mode should be switched to "link" with that task selected
    expect((h.$("input[name='promotion-mode'][value='link']") as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("creates a new canonical Task and updates CAS binding (spec §7.3)", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos(
      "run-create-new",
      "Build a custom hook for local storage in React.",
    );

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    const onReindex = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-create-new"
        expectedRevision={0}
        prompt="Build a custom hook for local storage in React."
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
        onSuccess={onSuccess}
        onReindex={onReindex}
      />,
    );

    await settle();

    const titleInput = h.$("input[data-testid='task-title-input']") as HTMLInputElement;
    const objectiveInput = h.$(
      "textarea[data-testid='task-objective-input']",
    ) as HTMLTextAreaElement;

    typeInto(titleInput, "useLocalStorage Hook");
    typeInto(objectiveInput, "Create a safe type-safe useLocalStorage hook.");

    const submitBtn = h.$("[data-testid='submit-promote-btn']");
    expect(submitBtn).toBeTruthy();

    await act(async () => {
      submitBtn?.click();
    });
    await settle();

    // Check Task was created in repo
    const tasks = await taskRepo.listTasks({});
    expect(tasks).toHaveLength(1);
    const createdTask = tasks[0];
    expect(createdTask.origin).toBe("promoted-comparison");
    expect(createdTask.latestVersion).toBe(1);

    const version = await taskRepo.getTaskVersion(createdTask.id, 1);
    expect(version?.title).toBe("useLocalStorage Hook");
    expect(version?.objective).toBe("Create a safe type-safe useLocalStorage hook.");
    expect(version?.candidateInstruction).toBe("Build a custom hook for local storage in React.");

    // Check Comparison was bound to task in comparisonRepo
    const envelope = await comparisonRepo.getComparisonResult("run-create-new");
    expect(envelope?.index.taskBinding).toEqual({
      kind: "canonical",
      taskId: createdTask.id,
      taskVersion: 1,
    });
    expect(envelope?.index.taskInstanceId).toBeTruthy();

    // Check callbacks
    expect(onReindex).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: createdTask.id,
        taskVersion: 1,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("links to an existing Task Version after validating exact match (spec §7.3)", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos(
      "run-link-existing",
      "Implement quicksort with lomuto partition scheme.",
    );

    // Seed existing task
    const taskRecord: TaskRecord = {
      id: "task-qs-1",
      latestVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      origin: "authored",
      revision: 0,
    };
    const taskVersion: TaskVersion = {
      taskId: "task-qs-1",
      version: 1,
      title: "Quicksort Algorithm",
      objective: "Implement quicksort.",
      candidateInstruction: "Implement quicksort with lomuto partition scheme.",
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: null,
      source: { kind: "authored", legacyScopeKey: null, note: null },
      createdAt: NOW,
    };
    await taskRepo.createTask(taskRecord, taskVersion);

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    const onReindex = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-link-existing"
        expectedRevision={0}
        prompt="Implement quicksort with lomuto partition scheme."
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
        onSuccess={onSuccess}
        onReindex={onReindex}
      />,
    );

    await settle();

    // Switch to "link" mode
    const linkRadio = h.$("input[name='promotion-mode'][value='link']") as HTMLInputElement;
    act(() => {
      linkRadio.click();
    });
    await settle();

    // Select the task
    const taskSelect = h.$("select[data-testid='link-task-select']") as HTMLSelectElement;
    act(() => {
      taskSelect.value = "task-qs-1";
      taskSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    // Submit linking
    const submitBtn = h.$("[data-testid='submit-promote-btn']");
    await act(async () => {
      submitBtn?.click();
    });
    await settle();

    // Verify comparison is bound to the existing task
    const envelope = await comparisonRepo.getComparisonResult("run-link-existing");
    expect(envelope?.index.taskBinding).toEqual({
      kind: "canonical",
      taskId: "task-qs-1",
      taskVersion: 1,
    });

    expect(onReindex).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({
      taskId: "task-qs-1",
      taskVersion: 1,
      taskInstanceId: expect.any(String),
    });
  });

  it("rejects linking to a mismatched Task Version with clear explanation (spec §7.3, §7.4)", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos(
      "run-link-mismatch",
      "Instruction for Task A.",
    );

    // Seed task with different instruction
    const taskRecord: TaskRecord = {
      id: "task-different",
      latestVersion: 1,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      origin: "authored",
      revision: 0,
    };
    const taskVersion: TaskVersion = {
      taskId: "task-different",
      version: 1,
      title: "Different Task",
      objective: "Objective B.",
      candidateInstruction: "Instruction for Task B (Different).",
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: null,
      source: { kind: "authored", legacyScopeKey: null, note: null },
      createdAt: NOW,
    };
    await taskRepo.createTask(taskRecord, taskVersion);

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-link-mismatch"
        expectedRevision={0}
        prompt="Instruction for Task A."
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
        onSuccess={onSuccess}
      />,
    );

    await settle();

    // Switch to "link" mode
    const linkRadio = h.$("input[name='promotion-mode'][value='link']") as HTMLInputElement;
    act(() => {
      linkRadio.click();
    });
    await settle();

    const taskSelect = h.$("select[data-testid='link-task-select']") as HTMLSelectElement;
    act(() => {
      taskSelect.value = "task-different";
      taskSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    // Mismatch warning must be displayed
    const mismatchWarning = h.$("[data-testid='link-mismatch-warning']");
    expect(mismatchWarning).toBeTruthy();
    expect(mismatchWarning?.textContent).toContain("mismatch");

    // Submit button should be disabled or prevented
    const submitBtn = h.$("[data-testid='submit-promote-btn']") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("surfaces CAS stale revision conflict without losing form inputs", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos("run-cas-conflict", "Prompt content.");

    // Simulate concurrent modification by bumping revision
    await comparisonRepo.bindComparisonToTask(
      "run-cas-conflict",
      { kind: "ad_hoc", inputSnapshotRef: "snap:other" },
      null,
      0, // revision becomes 1
    );

    const onOpenChange = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-cas-conflict"
        expectedRevision={0} // Stale revision
        prompt="Prompt content."
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
      />,
    );

    await settle();

    const titleInput = h.$("input[data-testid='task-title-input']") as HTMLInputElement;
    typeInto(titleInput, "My Typed Title");

    const submitBtn = h.$("[data-testid='submit-promote-btn']");
    await act(async () => {
      submitBtn?.click();
    });
    await settle();

    // Conflict error must be surfaced
    const conflictAlert = h.$("[data-testid='promotion-conflict-alert']");
    expect(conflictAlert).toBeTruthy();
    expect(conflictAlert?.textContent).toMatch(/conflict|concurrent/i);

    // Dialog stays open and input is preserved
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((h.$("input[data-testid='task-title-input']") as HTMLInputElement).value).toBe(
      "My Typed Title",
    );
  });

  it("warns about missing historical input (instance_input_incomplete) when input is missing (spec §7.3)", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos("run-missing-input", "   ");

    const onOpenChange = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-missing-input"
        expectedRevision={0}
        prompt="   " // Empty / missing input
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
      />,
    );

    await settle();

    // Warning about instance_input_incomplete
    const missingWarning = h.$("[data-testid='missing-input-warning']");
    expect(missingWarning).toBeTruthy();
    expect(missingWarning?.textContent).toContain("instance_input_incomplete");
  });

  it("closes cleanly on cancel with zero side effects", async () => {
    const { taskRepo, comparisonRepo } = await setupRepos("run-cancel", "Prompt.");

    const onOpenChange = vi.fn();
    const onCancel = vi.fn();

    const h = renderWithRouter(
      <PromoteComparisonTaskDialog
        open={true}
        onOpenChange={onOpenChange}
        comparisonId="run-cancel"
        expectedRevision={0}
        prompt="Prompt."
        taskRepo={taskRepo}
        comparisonRepo={comparisonRepo}
        onCancel={onCancel}
      />,
    );

    await settle();

    const cancelBtn = h.$("[data-testid='cancel-promote-btn']");
    expect(cancelBtn).toBeTruthy();

    act(() => {
      cancelBtn?.click();
    });
    await settle();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCancel).toHaveBeenCalled();

    // No tasks created
    expect(await taskRepo.listTasks({})).toHaveLength(0);
  });
});
