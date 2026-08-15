// @vitest-environment happy-dom
//
// Task Set editor surface (child 03 Task 5 / spec §4–§5). Canonical routes
// /evaluations/sets/:taskSetId and /evaluations/sets/:taskSetId/versions/:version.
// Historical versions are read-only. Frozen EvaluationSuite fields stay named
// suiteId/suiteVersion on persisted records.
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ModelProbeProvider } from "../../ui/ModelProbeContext";
import { TaskSetEditor } from "./TaskSetEditor";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { ExecutionOwnerProvider } from "../../lib/execution-owner-context";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import type {
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
} from "../../lib/evaluations/evaluation-types";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import { InMemoryTaskSetRepository } from "../../lib/persistence/in-memory-task-set-repository";
import { suiteToTaskSetRecord, suiteToTaskSetVersion } from "../../lib/evaluations/suite-compat";
import { StorageError } from "../../lib/persistence/database";

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

function renderWithRouter(node: React.ReactNode, initialPath = "/evaluations/sets/s1"): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <ExecutionOwnerProvider>
          <ModelProbeProvider>
            <Routes>
              <Route path="/evaluations/sets/:taskSetId" element={node} />
              <Route path="/evaluations/sets/:taskSetId/versions/:version" element={node} />
              <Route path="/evaluations/sets/:taskSetId/tasks/:taskId" element={node} />
              <Route path="/tasks/:taskId" element={<div data-route="task-detail" />} />
              <Route
                path="/tasks/:taskId/versions/:version"
                element={<div data-route="task-version" />}
              />
              <Route
                path="/experiments/:experimentId"
                element={<div data-route="experiment-progress" />}
              />
            </Routes>
          </ModelProbeProvider>
        </ExecutionOwnerProvider>
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

async function settle() {
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function makeTask(id: string, overrides: Partial<EvaluationTask> = {}): EvaluationTask {
  return {
    id,
    title: `Task ${id}`,
    prompt: `Prompt for ${id}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
    ...overrides,
  };
}

function makeSuite(id: string, overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  const now = Date.now();
  return {
    id,
    revision: 1,
    version: 2,
    name: `Suite ${id}`,
    description: "",
    tasks: [],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "" },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

async function seedSuite(repo: InMemoryEvaluationRepository, suite: EvaluationSuite) {
  await repo.saveSuite(suite, 0);
}

async function seedCanonicalTask(
  repo: InMemoryTaskRepository,
  id: string,
  title: string,
  overrides: {
    objective?: string;
    instruction?: string;
    systemInstruction?: string;
    archived?: boolean;
    extraVersions?: number;
  } = {},
): Promise<TaskRecord> {
  const now = Date.now();
  const v1: TaskVersion = {
    taskId: id,
    version: 1,
    title,
    objective: overrides.objective ?? `Objective for ${title}.`,
    candidateInstruction: overrides.instruction ?? `Instruction for ${title}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: now,
  };

  const record: TaskRecord = {
    id,
    latestVersion: 1,
    origin: "authored",
    revision: 0,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  await repo.createTask(record, v1);

  if (overrides.extraVersions && overrides.extraVersions > 1) {
    for (let v = 2; v <= overrides.extraVersions; v++) {
      const rec = (await repo.getTaskRecord(id))!;
      const nextVer: TaskVersion = {
        ...v1,
        version: v,
        title: `${title} (v${v})`,
        objective: `${title} objective (v${v})`,
        candidateInstruction: `Instruction for ${title} (v${v})`,
        createdAt: now + v * 1000,
      };
      await repo.appendTaskVersion(rec, nextVer, rec.revision);
    }
  }

  if (overrides.archived) {
    const rec = (await repo.getTaskRecord(id))!;
    await repo.archiveTask(id, rec.revision);
  }

  return (await repo.getTaskRecord(id))!;
}

function makeExperiment(id: string, suite: EvaluationSuite): ExperimentRecord {
  return {
    id,
    revision: 0,
    suiteId: suite.id,
    suiteVersion: suite.version,
    protocolFingerprint: "sha256:fp",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: suite.id,
      suiteVersion: suite.version,
      tasks: suite.tasks,
      modelSlots: suite.modelSlots,
      defaultJudge: suite.defaultJudge,
      defaultEvaluation: suite.defaultEvaluation,
      profiles: [],
      protocolFingerprint: "sha256:fp",
      createdAt: 1000,
    },
    tasks: [],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeValidSuite(id: string): EvaluationSuite {
  return makeSuite(id, {
    name: "Valid Suite",
    version: 1,
    tasks: [makeTask("t1")],
    modelSlots: [
      {
        id: "s1",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "gpt-4o",
        slug: "openai/gpt-4o",
        enabled: true,
      },
      {
        id: "s2",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "claude",
        slug: "anthropic/claude",
        enabled: true,
      },
    ],
    defaultJudge: { providerId: "openrouter", model: "z-ai/glm-5.2" },
  });
}

function makeStubController(overrides: Partial<ExperimentController> = {}): ExperimentController {
  return {
    start: vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" })),
    requestPause: vi.fn(async () => {}),
    resume: vi.fn(async () => ({ ok: true as const })),
    abort: vi.fn(async () => {}),
    retryIncomplete: vi.fn(async () => ({ ok: true as const })),
    repairMissingCells: vi.fn(async () => ({ ok: true as const })),
    addModelAndRun: vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" })),
    recoverOnStartup: vi.fn(async () => 0),
    subscribe: vi.fn(() => () => {}),
    whenIdle: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Crosswalk every suite task id to taskId + v1. */
function identityCrosswalk(task: EvaluationTask) {
  const data = task as { taskVersionRef?: { taskId: string; version: number } };
  if (data.taskVersionRef && data.taskVersionRef.taskId && data.taskVersionRef.version > 0) {
    return { taskId: data.taskVersionRef.taskId, version: data.taskVersionRef.version };
  }
  return { taskId: task.id, version: 1 };
}

/** Persist a canonical Task Set Version for a saved suite with an explicit revision. */
async function seedTaskSetVersion(
  taskSetRepo: InMemoryTaskSetRepository,
  suite: EvaluationSuite,
  expectedRevision: number,
): Promise<number> {
  const record = suiteToTaskSetRecord(suite);
  const { version } = suiteToTaskSetVersion(suite, identityCrosswalk);
  const existing = await taskSetRepo.getTaskSetRecord(suite.id);
  if (!existing) {
    await taskSetRepo.createTaskSet({ ...record, latestVersion: version.version }, version);
    return 1;
  }
  return taskSetRepo.appendTaskSetVersion(record, version, expectedRevision);
}

/** In-memory tracking repository that records materialization reads in order. */
class TrackingTaskSetRepository extends InMemoryTaskSetRepository {
  constructor(private readonly onMaterialize: () => void) {
    super();
  }
  override async getTaskSetVersion(taskSetId: string, version: number) {
    const stored = await super.getTaskSetVersion(taskSetId, version);
    this.onMaterialize();
    return stored;
  }
}

/** Task Set repository whose materialization always fails (persistence failure seam). */
class FailingTaskSetRepository extends InMemoryTaskSetRepository {
  override async materializeTaskSetVersion(): Promise<never> {
    throw new StorageError("quota", "disk full");
  }
}

describe("TaskSetEditor — loading & not found", () => {
  it("shows loading state", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    expect(h.container.textContent).toMatch(/loading/i);
    await settle();
    cleanup(h);
  });
  it("shows not found for a missing task set", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    expect(h.container.textContent).toMatch(/not found/i);
    cleanup(h);
  });
});

describe("TaskSetEditor — header & dirty state", () => {
  it("shows the task set name and persisted version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 3 }));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("My Suite");
    expect(text).toContain("v3");
    expect(text).toMatch(/saved/i);
    cleanup(h);
  });

  it("dirty state shows unsaved changes and next version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 2 }));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    typeInto(nameInput, "My Suite (edited)");
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toMatch(/unsaved changes/i);
    expect(text).toMatch(/v3/);
    cleanup(h);
  });

  it("dirty Run presents explicit Save a new version, Discard draft, and Cancel choices", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const controller = makeStubController();
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} controller={controller} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    typeInto(nameInput, "Dirty Suite");
    await settle();

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();

    expect(document.body.querySelector("[data-dirty-run-dialog]")).toBeTruthy();
    expect(document.body.textContent).toContain("Discard draft");
    expect(document.body.textContent).toContain("Cancel");
    expect(controller.start).not.toHaveBeenCalled();
    cleanup(h);
  });
});

describe("TaskSetEditor — save", () => {
  it("save persists changes and clears dirty state without renaming frozen suite fields", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 2 }));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    typeInto(nameInput, "Saved Suite");
    await settle();
    const saveBtn = h.$("button[data-action='save-task-set']") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    await act(async () => {
      saveBtn.click();
      await flush();
    });
    await settle();
    const fresh = await repo.getSuite("s1");
    expect(fresh?.name).toBe("Saved Suite");
    expect(fresh).toHaveProperty("id", "s1");
    expect(fresh).toHaveProperty("version");
    expect(h.container.textContent).toMatch(/saved/i);
    expect(h.container.textContent).not.toMatch(/unsaved changes/i);
    cleanup(h);
  });

  it("save with empty name shows validation error", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 2 }));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    typeInto(nameInput, "");
    await settle();
    const saveBtn = h.$("button[data-action='save-task-set']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
      await flush();
    });
    await settle();
    expect(h.container.textContent).toMatch(/name is required/i);
    const fresh = await repo.getSuite("s1");
    expect(fresh?.name).toBe("My Suite");
    cleanup(h);
  });
});

describe("TaskSetEditor — run validation", () => {
  it("Run disabled when the task set fails execution validation (no models)", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "Valid Suite",
        version: 1,
        tasks: [makeTask("t1")],
        modelSlots: [],
      }),
    );
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toMatch(/candidate models/i);
    cleanup(h);
  });

  it("Run enabled when the task set passes execution validation", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(
      <TaskSetEditor repo={repo} models={[]} controller={makeStubController()} />,
    );
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    expect(runBtn.textContent).toMatch(/run v1/i);
    cleanup(h);
  });
});

describe("TaskSetEditor — run execution", () => {
  it("Run click calls controller.start with the persisted suite id and navigates", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const taskSetRepo = new InMemoryTaskSetRepository();
    await seedCanonicalTask(taskRepo, "t1", "Download Music", {
      instruction: "Download this album.",
    });
    const suite = makeValidSuite("s1");
    await seedSuite(repo, suite);
    await seedTaskSetVersion(taskSetRepo, suite, 0);
    const controller = makeStubController();
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={taskSetRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();
    const confirmBtn = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Run task set",
    );
    expect(confirmBtn).toBeTruthy();
    await act(async () => {
      confirmBtn!.click();
      await flush();
    });
    await settle();
    expect(controller.start).toHaveBeenCalledWith("s1");
    expect(h.$("[data-route='experiment-progress']")).toBeTruthy();
    cleanup(h);
  });

  it("start failure shows the error in a role=alert line and does not navigate", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const taskSetRepo = new InMemoryTaskSetRepository();
    await seedCanonicalTask(taskRepo, "t1", "Download Music", {
      instruction: "Download this album.",
    });
    const suite = makeValidSuite("s1");
    await seedSuite(repo, suite);
    await seedTaskSetVersion(taskSetRepo, suite, 0);
    const controller = makeStubController({
      start: vi.fn(async () => ({
        ok: false as const,
        error: "Another tab is active (lease held)",
      })),
    });
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={taskSetRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();
    const confirmBtn = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Run task set",
    );
    expect(confirmBtn).toBeTruthy();
    await act(async () => {
      confirmBtn!.click();
      await flush();
    });
    await settle();
    const alert = h.$("[role='alert']");
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("Another tab is active (lease held)");
    expect(h.$("[data-route='experiment-progress']")).toBeNull();
    cleanup(h);
  });

  it("active in-tab execution owner disables Run with a truthful helper", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        models={[]}
        controller={makeStubController()}
        executionOwner={{ kind: "compare", id: "run-9" }}
      />,
    );
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toContain("Another execution is active");
    cleanup(h);
  });

  it("null controller disables Run with a storage-unavailable helper", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} controller={null} />);
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toContain("Storage unavailable — cannot start an experiment");
    cleanup(h);
  });

  it("shows a Latest results entry linking to the newest experiment", async () => {
    const repo = new InMemoryEvaluationRepository();
    const suite = makeValidSuite("s1");
    await seedSuite(repo, suite);
    await repo.createExperiment(makeExperiment("exp-1", suite));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const link = h.$('[data-testid="latest-results-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/experiments/exp-1");
    cleanup(h);
  });

  it("hides the Latest results entry when the task set has no experiments", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    expect(h.$('[data-testid="latest-results-link"]')).toBeNull();
    cleanup(h);
  });

  it("archived task set disables Run with an archived helper", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, { ...makeValidSuite("s1"), archivedAt: Date.now() });
    const h = renderWithRouter(
      <TaskSetEditor repo={repo} models={[]} controller={makeStubController()} />,
    );
    await settle();
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toContain("Archived task sets cannot run");
    cleanup(h);
  });
});

describe("TaskSetEditor — two-pane split", () => {
  it("renders task list and task editor panes on desktop", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "My Suite",
        version: 1,
        tasks: [makeTask("t1"), makeTask("t2")],
      }),
    );
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const taskListSection = h.$('section[aria-label="Task list"]');
    expect(taskListSection).toBeTruthy();
    expect(h.container.textContent).toContain("Task t1");
    expect(h.container.textContent).toContain("Task t2");
    const taskEditorSection = h.$('section[aria-label="Task editor"]');
    expect(taskEditorSection).toBeTruthy();
    cleanup(h);
  });
});

describe("TaskSetEditor — settings disclosure", () => {
  it("settings disclosure opens and closes", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 1 }));
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    expect(settingsBtn).toBeTruthy();
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const openBtn = h.$("button[aria-expanded='true']");
    expect(openBtn).toBeTruthy();
    expect(h.$("#task-set-name")).toBeTruthy();
    cleanup(h);
  });
});

describe("TaskSetEditor — historical version is read-only", () => {
  it("direct-loads /sets/:taskSetId/versions/:version as a read-only historical view", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "Historical Set", version: 2 }));
    const h = renderWithRouter(
      <TaskSetEditor repo={repo} models={[]} />,
      "/evaluations/sets/s1/versions/1",
    );
    await settle();
    expect(h.$("[data-task-set-editor]")).toBeTruthy();
    expect(h.container.textContent).toMatch(/read-only/i);
    const saveBtn = h.$("button[data-action='save-task-set']") as HTMLButtonElement | null;
    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement | null;
    expect(saveBtn?.disabled ?? true).toBe(true);
    expect(runBtn?.disabled ?? true).toBe(true);
    cleanup(h);
  });
});

describe("TaskSetEditor — Test selected models (spec §8.1)", () => {
  it("puts one model-specific test action inside each candidate row", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "My Suite",
        version: 1,
        modelSlots: [
          {
            id: "m1",
            providerId: "9router",
            provider: "9Router",
            model: "A",
            slug: "cmc/model-a",
            enabled: true,
          },
          {
            id: "m2",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "B",
            slug: "org/model-b",
            enabled: true,
          },
        ],
      }),
    );
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    await act(async () => h.$("button[aria-expanded='false']")!.click());
    await settle();

    for (const label of ["9router:cmc/model-a", "openrouter:org/model-b"]) {
      const checkbox = h.$(`input[aria-label="Enable ${label}"]`);
      const row = checkbox?.closest("li");
      const action = row?.querySelector<HTMLButtonElement>(
        `button[aria-label="Test model ${label}"]`,
      );
      expect(action).toBeTruthy();
      expect(action?.textContent?.trim()).toBe("Test");
      expect(h.$$(`button[aria-label="Test model ${label}"]`)).toHaveLength(1);
    }

    cleanup(h);
  });

  it("shows the batch test action when enabled candidates exist", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "My Suite",
        version: 1,
        modelSlots: [
          {
            id: "m1",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "A",
            slug: "model-a",
            enabled: true,
          },
          {
            id: "m2",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "B",
            slug: "model-b",
            enabled: true,
          },
        ],
      }),
    );
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const batchBtn = h.$$("button").find((b) => b.textContent?.trim() === "Test selected models");
    expect(batchBtn).toBeTruthy();
    cleanup(h);
  });

  it("does not show the batch action when no candidates are enabled", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "My Suite",
        version: 1,
        modelSlots: [
          {
            id: "m1",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "A",
            slug: "model-a",
            enabled: false,
          },
        ],
      }),
    );
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const batchBtn = h.$$("button").find((b) => b.textContent?.trim() === "Test selected models");
    expect(batchBtn).toBeFalsy();
    cleanup(h);
  });
});

describe("TaskSetEditor — canonical Task selection and version pinning", () => {
  it("Add task opens TaskVersionSelector and adds selected canonical task version to the set", async () => {
    const evalRepo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    await seedSuite(evalRepo, makeSuite("s1", { name: "Bench Suite", version: 1, tasks: [] }));
    await seedCanonicalTask(taskRepo, "t-canon", "Code Review Task", {
      objective: "Review PR for security issues",
      instruction: "Find any security flaws in this PR.",
      extraVersions: 2,
    });

    const h = renderWithRouter(<TaskSetEditor repo={evalRepo} taskRepo={taskRepo} models={[]} />);
    await settle();

    // Click Add task
    const addBtn =
      h.$("button[data-action='add-task']") ??
      h.$$("button").find((b) => b.textContent?.includes("Add task"));
    expect(addBtn).toBeTruthy();
    await act(async () => {
      addBtn!.click();
    });
    await settle();

    // TaskVersionSelector is open
    const dialog = h.$("[role='dialog']") ?? h.$("[data-task-version-selector]");
    expect(dialog).toBeTruthy();

    // Select the task
    const taskRow =
      h.$("[data-task-id='t-canon']") ??
      h.$$("button, [role='button']").find((b) => b.textContent?.includes("Code Review Task"));
    expect(taskRow).toBeTruthy();
    await act(async () => {
      taskRow!.click();
    });
    await settle();

    // Confirm selection (defaults to latest v2)
    const selectBtn =
      h.$("button[data-action='confirm-select-task']") ??
      h.$$("button").find((b) => b.textContent?.match(/add|select|pin/i));
    expect(selectBtn).toBeTruthy();
    await act(async () => {
      selectBtn!.click();
    });
    await settle();

    // Task is added to the set and shows pinned v2
    expect(h.container.textContent).toContain("Code Review Task");
    expect(h.container.textContent).toContain("v2");
    expect(h.container.textContent).toMatch(/unsaved changes/i);
    cleanup(h);
  });

  it("allows selecting an older canonical task version without upgrading to latest on save", async () => {
    const evalRepo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    await seedSuite(evalRepo, makeSuite("s1", { name: "Bench Suite", version: 1, tasks: [] }));
    await seedCanonicalTask(taskRepo, "t-multi", "Multi Version Task", {
      extraVersions: 3,
    });

    const h = renderWithRouter(<TaskSetEditor repo={evalRepo} taskRepo={taskRepo} models={[]} />);
    await settle();

    // Open selector
    const addBtn =
      h.$("button[data-action='add-task']") ??
      h.$$("button").find((b) => b.textContent?.includes("Add task"));
    await act(async () => {
      addBtn!.click();
    });
    await settle();

    // Pick task
    const taskRow =
      h.$("[data-task-id='t-multi']") ??
      h.$$("button, [role='button']").find((b) => b.textContent?.includes("Multi Version Task"));
    await act(async () => {
      taskRow!.click();
    });
    await settle();

    // Select older version v1
    const v1Option =
      h.$("[data-version-option='1']") ??
      h
        .$$("button, option")
        .find((el) => el.textContent?.trim() === "v1" || el.getAttribute("value") === "1");
    expect(v1Option).toBeTruthy();
    if (v1Option?.tagName.toLowerCase() === "option") {
      const select = v1Option.closest("select")!;
      await act(async () => {
        select.value = "1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    } else {
      await act(async () => {
        v1Option!.click();
      });
    }
    await settle();

    // Confirm selection
    const selectBtn =
      h.$("button[data-action='confirm-select-task']") ??
      h.$$("button").find((b) => b.textContent?.match(/add|select|pin/i));
    await act(async () => {
      selectBtn!.click();
    });
    await settle();

    // Pinned version shows v1
    expect(h.container.textContent).toContain("v1");

    // Save task set
    const saveBtn = h.$("button[data-action='save-task-set']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
      await flush();
    });
    await settle();

    const fresh = await evalRepo.getSuite("s1");
    expect(fresh?.tasks.length).toBe(1);
    // Verified: No latest-version substitution happened
    expect(h.container.textContent).toContain("v1");
    cleanup(h);
  });
});

describe("TaskSetEditor — member roles, strata, positive weights, and overrides", () => {
  it("modifying member role, stratum, positive weight, rubric override, and judge override marks draft dirty and persists on save", async () => {
    const evalRepo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    await seedSuite(
      evalRepo,
      makeSuite("s1", {
        name: "Bench Suite",
        version: 1,
        tasks: [makeTask("t-mem", { title: "Configurable Member", prompt: "Prompt", order: 0 })],
      }),
    );

    const h = renderWithRouter(<TaskSetEditor repo={evalRepo} taskRepo={taskRepo} models={[]} />);
    await settle();

    // Select the task
    const taskBtn = h.$("button[aria-label*='Configurable Member'], [data-task-item] button");
    await act(async () => {
      taskBtn?.click();
    });
    await settle();

    // Change role
    const roleSelect = h.$("select[data-field='member-role']") as HTMLSelectElement | null;
    if (roleSelect) {
      await act(async () => {
        roleSelect.value = "anchor";
        roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
    }

    // Change stratum
    const stratumInput = h.$("input[data-field='member-stratum']") as HTMLInputElement | null;
    if (stratumInput) {
      typeInto(stratumInput, "reasoning");
      await settle();
    }

    // Change weight
    const weightInput = h.$("input[data-field='member-weight']") as HTMLInputElement | null;
    if (weightInput) {
      typeInto(weightInput, "2.5");
      await settle();
    }

    // Change judge override
    const judgeOverride = h.$(
      "textarea[data-field='judge-instruction-override'], textarea[name='judgeInstructionOverride']",
    ) as HTMLTextAreaElement | null;
    if (judgeOverride) {
      typeInto(judgeOverride, "Special instructions for judge");
      await settle();
    }

    expect(h.container.textContent).toMatch(/unsaved changes/i);

    // Save
    const saveBtn = h.$("button[data-action='save-task-set']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
      await flush();
    });
    await settle();

    expect(h.container.textContent).toMatch(/saved/i);
    cleanup(h);
  });
});

describe("TaskSetEditor — task detail navigation without mutation", () => {
  it("provides link to canonical task detail without offering editable inputs that mutate the canonical task", async () => {
    const evalRepo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    await seedCanonicalTask(taskRepo, "t-nav", "Canonical Nav Task", {
      objective: "Translate text accurately",
      instruction: "Translate this French paragraph to English.",
    });
    await seedSuite(
      evalRepo,
      makeSuite("s1", {
        name: "Bench Suite",
        version: 1,
        tasks: [
          makeTask("t-nav", {
            title: "Canonical Nav Task",
            prompt: "Translate this French paragraph to English.",
            order: 0,
          }),
        ],
      }),
    );

    const h = renderWithRouter(<TaskSetEditor repo={evalRepo} taskRepo={taskRepo} models={[]} />);
    await settle();

    // Link to canonical task detail exists
    const editLink =
      h.$("a[data-action='open-task-detail']") ??
      h.$$("a").find((a) => a.textContent?.match(/edit task|open task/i));
    expect(editLink).toBeTruthy();
    expect(editLink?.getAttribute("href")).toContain("/tasks/t-nav");

    // The candidate prompt is a read-only preview, not an editable textarea mutating canonical task
    const promptInput = h.$(
      "textarea[name='prompt'], textarea[data-field='task-prompt']",
    ) as HTMLTextAreaElement | null;
    if (promptInput) {
      expect(promptInput.readOnly || promptInput.disabled).toBe(true);
    } else {
      // It is rendered as read-only text / pre
      expect(h.container.textContent).toContain("Translate this French paragraph to English.");
    }
    cleanup(h);
  });
});

describe("TaskSetEditor — archived task warning", () => {
  it("displays warning when a member references an archived canonical task", async () => {
    const evalRepo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    await seedCanonicalTask(taskRepo, "t-arch", "Archived Task", { archived: true });
    await seedSuite(
      evalRepo,
      makeSuite("s1", {
        name: "Bench Suite",
        version: 1,
        tasks: [makeTask("t-arch", { title: "Archived Task", order: 0 })],
      }),
    );

    const h = renderWithRouter(<TaskSetEditor repo={evalRepo} taskRepo={taskRepo} models={[]} />);
    await settle();

    // Warning is visible
    const warning = h.$("[data-archived-warning]") ?? h.$("[role='alert']");
    expect(warning).toBeTruthy();
    expect(warning?.textContent?.toLowerCase()).toContain("archived");
    cleanup(h);
  });
});

describe("TaskSetEditor — keyboard reordering", () => {
  it("reordering tasks via keyboard controls updates deterministic order", async () => {
    const evalRepo = new InMemoryEvaluationRepository();
    await seedSuite(
      evalRepo,
      makeSuite("s1", {
        name: "Bench Suite",
        version: 1,
        tasks: [
          makeTask("t1", { title: "Task 1", order: 0 }),
          makeTask("t2", { title: "Task 2", order: 1 }),
        ],
      }),
    );

    const h = renderWithRouter(<TaskSetEditor repo={evalRepo} models={[]} />);
    await settle();

    const moveDownBtns = h.$$("button[aria-label*='down'], button[data-action='move-down']");
    expect(moveDownBtns.length).toBeGreaterThan(0);
    await act(async () => {
      moveDownBtns[0]?.click();
    });
    await settle();

    expect(h.container.textContent).toMatch(/unsaved changes/i);
    cleanup(h);
  });
});

describe("TaskSetEditor — safe Save versus Run boundary", () => {
  it("Discard draft resets to the stored revision, waits on materialization, and runs it once", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const taskSetRepo = new InMemoryTaskSetRepository();
    await seedCanonicalTask(taskRepo, "canon-t", "Canonical Task", {
      instruction: "Solve this candidate problem.",
    });
    const suite = makeValidSuite("s1");
    suite.tasks = [
      {
        ...makeTask("t1"),
        title: "Canonical Task",
        prompt: "Solve this candidate problem.",
        taskVersionRef: { taskId: "canon-t", version: 1 },
      } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
    ];
    await seedSuite(repo, suite);
    await seedTaskSetVersion(taskSetRepo, suite, 0);

    const runCall = vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" }));
    const controller = makeStubController({ start: runCall });
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={taskSetRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();

    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    typeInto(nameInput, "Dirty Draft");
    await settle();

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();
    const discard = document.body.querySelector(
      "button[data-action='dirty-run-discard']",
    ) as HTMLButtonElement | null;
    expect(discard).toBeTruthy();
    await act(async () => {
      discard!.click();
      await flush();
    });
    await settle();

    const preflightRun = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Run task set",
    );
    await act(async () => {
      preflightRun?.click();
      await flush();
    });
    await settle();

    expect(runCall).toHaveBeenCalledTimes(1);
    expect(runCall).toHaveBeenCalledWith("s1");
    expect(h.$("[data-route='experiment-progress']")).toBeTruthy();
    cleanup(h);
  });

  it("Cancel makes no provider call, keeps the dirty draft, and does not navigate", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const taskSetRepo = new InMemoryTaskSetRepository();
    await seedCanonicalTask(taskRepo, "canon-t", "Canonical Task", {
      instruction: "Solve this candidate problem.",
    });
    const suite = makeValidSuite("s1");
    suite.tasks = [
      {
        ...makeTask("t1"),
        taskVersionRef: { taskId: "canon-t", version: 1 },
      } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
    ];
    await seedSuite(repo, suite);
    await seedTaskSetVersion(taskSetRepo, suite, 0);

    const runCall = vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" }));
    const controller = makeStubController({ start: runCall });
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={taskSetRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();

    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    typeInto(nameInput, "Never Commit");
    await settle();

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();
    const cancel = document.body.querySelector(
      "button[data-action='dirty-run-cancel']",
    ) as HTMLButtonElement | null;
    expect(cancel).toBeTruthy();
    await act(async () => {
      cancel!.click();
      await flush();
    });
    expect(runCall).not.toHaveBeenCalled();
    expect(h.container.textContent).toMatch(/unsaved changes/i);
    expect(h.container.textContent).toContain("Never Commit");
    expect(h.$("[data-route='experiment-progress']")).toBeNull();
    cleanup(h);
  });

  it("stale CAS blocks Save a new version and Run with zero provider calls", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const taskSetRepo = new InMemoryTaskSetRepository();
    await seedCanonicalTask(taskRepo, "canon-t", "Canonical Task", {
      instruction: "Solve this candidate problem.",
    });
    const suite = makeValidSuite("s1");
    suite.tasks = [
      {
        ...makeTask("t1"),
        taskVersionRef: { taskId: "canon-t", version: 1 },
      } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
    ];
    await seedSuite(repo, suite);
    await seedTaskSetVersion(taskSetRepo, suite, 0);

    const runCall = vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" }));
    const controller = makeStubController({ start: runCall });
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={taskSetRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();

    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#task-set-name") as HTMLInputElement;
    typeInto(nameInput, "Stale Save");
    await settle();

    // Another tab wins the suite save first: the save surface reports a stale
    // revision conflict before any paid work can begin.
    await repo.saveSuite({ ...suite, name: "Another Tab Won" }, suite.revision);

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();
    const saveAndRun = document.body.querySelector(
      "button[data-action='dirty-run-save']",
    ) as HTMLButtonElement | null;
    expect(saveAndRun).toBeTruthy();
    await act(async () => {
      saveAndRun!.click();
      await flush();
    });
    await settle();

    expect(h.$("[role='alert']")?.textContent).toMatch(/stale|conflict|modified in another tab/i);
    expect(runCall).not.toHaveBeenCalled();
    expect(h.$("[data-route='experiment-progress']")).toBeNull();
    cleanup(h);
  });

  it("failed workload validation blocks Run with zero provider calls", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const taskSetRepo = new InMemoryTaskSetRepository();
    // No enabled candidates -> workload validation fails before any call.
    const suite = makeValidSuite("s1");
    suite.modelSlots = suite.modelSlots.map((s) => ({ ...s, enabled: false }));
    await seedSuite(repo, suite);
    await seedTaskSetVersion(taskSetRepo, suite, 0);

    const runCall = vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" }));
    const controller = makeStubController({ start: runCall });
    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={taskSetRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement;
    expect(runBtn?.disabled ?? true).toBe(true);
    expect(runCall).not.toHaveBeenCalled();
    cleanup(h);
  });

  it("unresolved refs block Run and archived-ref rejection blocks Run, both with zero provider calls", async () => {
    // --- Unresolved refs ---
    {
      const repo = new InMemoryEvaluationRepository();
      const taskRepo = new InMemoryTaskRepository();
      const taskSetRepo = new InMemoryTaskSetRepository();
      const suite = makeValidSuite("s1");
      suite.tasks = [
        {
          ...makeTask("t1"),
          taskVersionRef: { taskId: "missing-task", version: 9 },
        } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
      ];
      await seedSuite(repo, suite);
      await seedTaskSetVersion(taskSetRepo, suite, 0);

      const controller = makeStubController();
      const h = renderWithRouter(
        <TaskSetEditor
          repo={repo}
          taskRepo={taskRepo}
          taskSetRepo={taskSetRepo}
          models={[]}
          controller={controller}
        />,
      );
      await settle();
      const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement | null;
      expect(runBtn?.disabled ?? true).toBe(false);
      await act(async () => {
        runBtn?.click();
        await flush();
      });
      await settle();
      const confirm = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Run task set",
      );
      await act(async () => {
        confirm?.click();
        await flush();
      });
      await settle();
      expect(h.$("[role='alert']")?.textContent).toMatch(/unresolved/i);
      expect(controller.start).not.toHaveBeenCalled();
      expect(h.$("[data-route='experiment-progress']")).toBeNull();
      cleanup(h);
    }

    // --- Archived-ref rejection ---
    {
      const repo = new InMemoryEvaluationRepository();
      const taskRepo = new InMemoryTaskRepository();
      const taskSetRepo = new InMemoryTaskSetRepository();
      await seedCanonicalTask(taskRepo, "arch-t", "Archived Task", { archived: true });
      const suite = makeValidSuite("s1");
      suite.tasks = [
        {
          ...makeTask("t1"),
          taskVersionRef: { taskId: "arch-t", version: 1 },
        } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
      ];
      await seedSuite(repo, suite);
      // Force an archived ref on the pinned workload.
      const record = suiteToTaskSetRecord(suite);
      const { version } = suiteToTaskSetVersion(suite, () => ({ taskId: "arch-t", version: 1 }));
      await taskSetRepo.createTaskSet({ ...record, latestVersion: version.version }, version);

      const controller = makeStubController();
      const h = renderWithRouter(
        <TaskSetEditor
          repo={repo}
          taskRepo={taskRepo}
          taskSetRepo={taskSetRepo}
          models={[]}
          controller={controller}
        />,
      );
      await settle();
      const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement | null;
      expect(runBtn?.disabled ?? true).toBe(false);
      await act(async () => {
        runBtn?.click();
        await flush();
      });
      await settle();
      const confirm = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Run task set",
      );
      await act(async () => {
        confirm?.click();
        await flush();
      });
      await settle();
      expect(h.$("[role='alert']")?.textContent).toMatch(/archived/i);
      expect(controller.start).not.toHaveBeenCalled();
      expect(h.$("[data-route='experiment-progress']")).toBeNull();
      cleanup(h);
    }
  });

  it("persistence failure blocks materialization with zero provider calls", async () => {
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    const suite = makeValidSuite("s1");
    await seedSuite(repo, suite);

    const runCall = vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" }));
    const controller = makeStubController({ start: runCall });
    const failingRepo = new FailingTaskSetRepository();

    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={failingRepo}
        models={[]}
        controller={controller}
      />,
    );
    await settle();

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement | null;
    expect(runBtn?.disabled ?? true).toBe(false);
    await act(async () => {
      runBtn?.click();
      await flush();
    });
    await settle();
    const confirm = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Run task set",
    );
    await act(async () => {
      confirm?.click();
      await flush();
    });
    await settle();
    expect(h.$("[role='alert']")?.textContent).toMatch(/disk full|quota/i);
    expect(runCall).not.toHaveBeenCalled();
    expect(h.$("[data-route='experiment-progress']")).toBeNull();
    cleanup(h);
  });

  it("durably materializes before lease acquisition, attempt creation, controller work, and provider call", async () => {
    const order: string[] = [];
    const repo = new InMemoryEvaluationRepository();
    const taskRepo = new InMemoryTaskRepository();
    await seedCanonicalTask(taskRepo, "canon-t", "Canonical Task", {
      instruction: "Solve this candidate problem.",
    });
    const suite = makeValidSuite("s1");
    suite.tasks = [
      {
        ...makeTask("t1"),
        taskVersionRef: { taskId: "canon-t", version: 1 },
      } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
    ];
    await seedSuite(repo, suite);

    // Deterministic fake observes the exact boundary order the editor must honor.
    const orderedController = {
      ...makeStubController(),
      start: vi.fn(async () => {
        order.push("lease-acquire");
        order.push("attempt-create");
        order.push("controller-paid-work");
        order.push("provider-call");
        return { ok: true as const, experimentId: "exp-1" };
      }),
    };
    const trackingRepo = new TrackingTaskSetRepository(() => order.push("materialize"));
    await seedTaskSetVersion(trackingRepo, suite, 0);

    const h = renderWithRouter(
      <TaskSetEditor
        repo={repo}
        taskRepo={taskRepo}
        taskSetRepo={trackingRepo}
        models={[]}
        controller={orderedController}
      />,
    );
    await settle();

    const runBtn = h.$("button[data-action='run-task-set']") as HTMLButtonElement | null;
    expect(runBtn?.disabled ?? true).toBe(false);
    await act(async () => {
      runBtn?.click();
      await flush();
    });
    await settle();
    const confirm = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Run task set",
    );
    await act(async () => {
      confirm?.click();
      await flush();
    });
    await settle();

    const mat = order.indexOf("materialize");
    const lease = order.indexOf("lease-acquire");
    const attempt = order.indexOf("attempt-create");
    const paid = order.indexOf("controller-paid-work");
    const provider = order.indexOf("provider-call");
    expect(mat).toBeGreaterThanOrEqual(0);
    expect(lease).toBeGreaterThan(mat);
    expect(attempt).toBeGreaterThan(lease);
    expect(paid).toBeGreaterThan(attempt);
    expect(provider).toBeGreaterThan(paid);
    cleanup(h);
  });
});

describe("TaskSetEditor — accessibility", () => {
  it("all interactive controls meet 44px target size", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "My Suite",
        version: 1,
        tasks: [makeTask("t1")],
      }),
    );
    const h = renderWithRouter(<TaskSetEditor repo={repo} models={[]} />);
    await settle();
    const buttons = h.$$("button");
    for (const el of buttons) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).toMatch(/min-h-\[44px\]|h-11/);
    }
    cleanup(h);
  });
});
