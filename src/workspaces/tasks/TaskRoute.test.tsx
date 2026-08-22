// @vitest-environment happy-dom
//
// TaskRoute tests — Child 02 (Canonical Tasks) Milestone D, Task 6 (RED first).
//
// Covers the direct-route contract from canonical-tasks spec §7: /tasks/new is
// an honest placeholder shell for Task 7 create flow; /tasks/:taskId renders
// the stable identity header for an existing Task; archived Tasks remain
// routable (spec §4.5); unknown task IDs, unknown versions, and malformed
// version params render explicit not-found/invalid states — never a silent
// redirect. Uses the repo's happy-dom createRoot/act harness.

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import { computeInstanceInputDigest } from "../../lib/tasks/task-instance";
import { TaskNewRoute, TaskDetailRoute, TaskVersionRoute } from "./TaskRoute";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures ---------------------------------------------------------------

const NOW = 1_700_000_000_000;

async function seedTask(repo: TaskRepository, id: string, title: string): Promise<TaskRecord> {
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
    createdAt: NOW,
  };
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
  await repo.createTask(record, version);
  return record;
}

// --- Harness -----------------------------------------------------------------

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
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

// --- Tests --------------------------------------------------------------------

describe("TaskRoute — /tasks/new create editor", () => {
  it("renders the create editor with a catalog escape", () => {
    const repo = new InMemoryTaskRepository();
    const h = render(<TaskNewRoute repo={repo} />);
    // The Task 7 editor replaces the Task 6 placeholder.
    expect(h.$("[data-task-new-placeholder]")).toBeNull();
    expect(h.$("[data-task-editor='new']")).toBeTruthy();
    expect(h.container.textContent).toMatch(/creat/i);
    // The back link targets the catalog, keeping the route honest.
    const back = h.$("a[href='/tasks']");
    expect(back).toBeTruthy();
    cleanup(h);
  });

  it("shows storage-unavailable state when the repository is null", () => {
    const h = render(<TaskNewRoute repo={null} />);
    expect(h.$("[data-task-error-state]")).toBeTruthy();
    expect(h.container.textContent).toContain("unavailable");
    cleanup(h);
  });
});

describe("TaskRoute — /tasks/:taskId detail shell", () => {
  it("renders the identity header for an existing task", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Summarize a report");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.container.textContent).toContain("Summarize a report");
    expect(h.container.textContent).toContain("v1");
    cleanup(h);
  });

  it("renders an explicit not-found state for an unknown task id (no silent redirect)", async () => {
    const repo = new InMemoryTaskRepository();
    const h = render(<TaskDetailRoute repo={repo} taskId="does-not-exist" />);
    await settle();
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    expect(h.container.textContent).toContain("not found");
    cleanup(h);
  });

  it("keeps an archived task routable and marks it archived (spec §4.5)", async () => {
    const repo = new InMemoryTaskRepository();
    const rec = await seedTask(repo, "t-1", "Legacy summary");
    await repo.archiveTask("t-1", rec.revision);
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.container.textContent).toContain("Archived");
    expect(h.$("[data-task-not-found]")).toBeNull();
    cleanup(h);
  });

  it("shows storage-unavailable state when the repository is null", async () => {
    const h = render(<TaskDetailRoute repo={null} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-error-state]")).toBeTruthy();
    cleanup(h);
  });
});

describe("TaskRoute — /tasks/:taskId/versions/:version shell", () => {
  it("renders a specific historical version", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Versioned task");
    const h = render(<TaskVersionRoute repo={repo} taskId="t-1" version={1} />);
    await settle();
    expect(h.$("[data-task-version='t-1@1']")).toBeTruthy();
    expect(h.container.textContent).toContain("Versioned task");
    cleanup(h);
  });

  it("renders an explicit not-found state for an unknown version number", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Versioned task");
    const h = render(<TaskVersionRoute repo={repo} taskId="t-1" version={99} />);
    await settle();
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    cleanup(h);
  });

  it("renders an explicit invalid-version state for a malformed version param", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Versioned task");
    const h = render(<TaskVersionRoute repo={repo} taskId="t-1" version={Number.NaN} />);
    await settle();
    expect(h.$("[data-task-invalid-version]")).toBeTruthy();
    cleanup(h);
  });

  it("renders not-found for an unknown task id on the version route", async () => {
    const repo = new InMemoryTaskRepository();
    const h = render(<TaskVersionRoute repo={repo} taskId="ghost" version={1} />);
    await settle();
    expect(h.$("[data-task-not-found]")).toBeTruthy();
    cleanup(h);
  });
});

describe("TaskDetailRoute — historical references and origin (spec §7.2)", () => {
  it("renders a scoped references section with origin disclosure", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Referenced task");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-references-section]")).toBeTruthy();
    expect(h.container.textContent).toMatch(/reference/i);
    expect(h.container.textContent).toMatch(/origin/i);
    cleanup(h);
  });

  it("lists instances with digest abbreviation, source, timestamp, and no secrets", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "Instanced task");
    const secret = "sk-live123SECRET_TOKEN";
    const candidate = {
      id: "inst-secret",
      taskId: "t-1",
      taskVersion: 1,
      normalizedInput: { text: secret, artifactIds: [] as string[], metadata: {} },
      contextManifest: [],
      inputDigest: "",
      inputCompleteness: "complete" as const,
      createdAt: NOW,
      sourceRef: { kind: "authored" as const, legacyScopeKey: null, originId: null },
    };
    candidate.inputDigest = computeInstanceInputDigest(candidate);
    await repo.getOrCreateTaskInstance(candidate, new Map());
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    const list = h.$("[data-task-instances]");
    expect(list).toBeTruthy();
    expect(list?.textContent).toContain(candidate.inputDigest.slice(7, 15));
    expect(list?.textContent).toMatch(/authored/i);
    expect(h.container.textContent).not.toContain(secret);
    expect(h.container.textContent).not.toContain("sk-live");
    cleanup(h);
  });

  it("renders observations section and keeps future Compare section absent, not placeholders", async () => {
    const repo = new InMemoryTaskRepository();
    await seedTask(repo, "t-1", "No future sections");
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-compare-section]")).toBeNull();
    expect(h.$("[data-task-observations-section]")).toBeTruthy();
    const text = h.container.textContent ?? "";
    expect(text).not.toMatch(/coming soon/i);
    expect(text).not.toMatch(/placeholder/i);
    cleanup(h);
  });

  it("direct-loads references on an archived Task without falling back to latest", async () => {
    const repo = new InMemoryTaskRepository();
    const rec = await seedTask(repo, "t-1", "Archived referenced");
    await repo.archiveTask("t-1", rec.revision);
    const h = render(<TaskDetailRoute repo={repo} taskId="t-1" />);
    await settle();
    expect(h.$("[data-task-detail='t-1']")).toBeTruthy();
    expect(h.$("[data-task-references-section]")).toBeTruthy();
    expect(h.container.textContent).toContain("Archived");
    cleanup(h);
  });
});
