// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ModelProbeProvider } from "../../ui/ModelProbeContext";
import { SuiteEditor } from "./SuiteEditor";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import { ExecutionOwnerProvider } from "../../lib/execution-owner-context";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import type { EvaluationSuite, EvaluationTask, ExperimentRecord } from "../../lib/evaluations/evaluation-types";

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

function renderWithRouter(node: React.ReactNode, initialPath = "/evaluations/s1"): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <ExecutionOwnerProvider>
          <ModelProbeProvider>
            <Routes>
              <Route path="/evaluations/:suiteId" element={node} />
              <Route path="/evaluations/:suiteId/tasks/:taskId" element={node} />
              <Route path="/experiments/:experimentId" element={<div data-route="experiment-progress" />} />
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

/** Type into a React controlled input by bypassing React's value tracker. */
function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const proto = input instanceof HTMLTextAreaElement
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

// --- Helpers ------------------------------------------------------------------

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
      { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "gpt-4o", slug: "openai/gpt-4o", enabled: true },
      { id: "s2", providerId: "openrouter", provider: "OpenRouter", model: "claude", slug: "anthropic/claude", enabled: true },
    ],
    defaultJudge: { providerId: "openrouter", model: "z-ai/glm-5.2" },
  });
}

function makeStubController(overrides: Partial<ExperimentController> = {}): ExperimentController {
  return {
    start: vi.fn(async () => ({ ok: true as const, experimentId: "exp-1" })),
    requestPause: vi.fn(),
    resume: vi.fn(async () => ({ ok: true as const })),
    abort: vi.fn(async () => {}),
    retryIncomplete: vi.fn(async () => ({ ok: true as const })),
    recoverOnStartup: vi.fn(async () => 0),
    subscribe: vi.fn(() => () => {}),
    whenIdle: vi.fn(async () => {}),
    ...overrides,
  };
}

// --- Tests --------------------------------------------------------------------

describe("SuiteEditor — loading & not found", () => {
  it("shows loading state", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    expect(h.container.textContent).toMatch(/loading/i);
    await settle();
    cleanup(h);
  });

  it("shows not found for missing suite", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    expect(h.container.textContent).toMatch(/not found/i);
    cleanup(h);
  });
});

describe("SuiteEditor — header & dirty state", () => {
  it("shows suite name and persisted version", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 3 }));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
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
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    // Open settings to access the name input
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput2 = h.$("#suite-name") as HTMLInputElement;
    expect(nameInput2).toBeTruthy();
    typeInto(nameInput2, "My Suite (edited)");
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toMatch(/unsaved changes/i);
    expect(text).toMatch(/v3/); // next version
    cleanup(h);
  });

  it("Run is disabled while dirty with save-first message", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 2 }));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    // Make dirty by opening settings and editing name
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#suite-name") as HTMLInputElement;
    typeInto(nameInput, "Edited");
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toMatch(/save this suite before running/i);
    cleanup(h);
  });
});

describe("SuiteEditor — save", () => {
  it("save persists changes and clears dirty state", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 2 }));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    // Make dirty
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#suite-name") as HTMLInputElement;
    typeInto(nameInput, "Saved Suite");
    await settle();
    // Save button should be enabled
    const saveBtn = h.$("button[data-action='save-suite']") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    await act(async () => {
      saveBtn.click();
      await flush();
    });
    await settle();
    // Persisted suite has the new name
    const fresh = await repo.getSuite("s1");
    expect(fresh?.name).toBe("Saved Suite");
    // Dirty state cleared
    expect(h.container.textContent).toMatch(/saved/i);
    expect(h.container.textContent).not.toMatch(/unsaved changes/i);
    cleanup(h);
  });

  it("save with empty name shows validation error", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 2 }));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    // Make dirty with empty name
    const settingsBtn = h.$("button[aria-expanded='false']");
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const nameInput = h.$("#suite-name") as HTMLInputElement;
    typeInto(nameInput, "");
    await settle();
    // Click save — validation should reject empty name
    const saveBtn = h.$("button[data-action='save-suite']") as HTMLButtonElement;
    await act(async () => {
      saveBtn.click();
      await flush();
    });
    await settle();
    expect(h.container.textContent).toMatch(/name is required/i);
    // Not persisted
    const fresh = await repo.getSuite("s1");
    expect(fresh?.name).toBe("My Suite");
    cleanup(h);
  });
});

describe("SuiteEditor — run validation", () => {
  it("Run disabled when suite fails execution validation (no models)", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "Valid Suite",
        version: 1,
        tasks: [makeTask("t1")],
        modelSlots: [], // < 2 models
      }),
    );
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toMatch(/candidate models/i);
    cleanup(h);
  });

  it("Run enabled when suite passes execution validation", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} controller={makeStubController()} />);
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    // Run states the persisted version
    expect(runBtn.textContent).toMatch(/run v1/i);
    cleanup(h);
  });
});

describe("SuiteEditor — run execution", () => {
  it("Run click calls controller.start with the persisted suite id and navigates to the experiment", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const controller = makeStubController();
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} controller={controller} />);
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(false);
    await act(async () => {
      runBtn.click();
      await flush();
    });
    await settle();
    expect(controller.start).toHaveBeenCalledWith("s1");
    expect(h.$("[data-route='experiment-progress']")).toBeTruthy();
    cleanup(h);
  });

  it("start failure shows the error in a role=alert line and does not navigate", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const controller = makeStubController({
      start: vi.fn(async () => ({ ok: false as const, error: "Another tab is active (lease held)" })),
    });
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} controller={controller} />);
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
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
      <SuiteEditor
        repo={repo}
        models={[]}
        controller={makeStubController()}
        executionOwner={{ kind: "compare", id: "run-9" }}
      />,
    );
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toContain("Another execution is active");
    cleanup(h);
  });

  it("null controller disables Run with a storage-unavailable helper", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} controller={null} />);
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toContain("Storage unavailable — cannot start an experiment");
    cleanup(h);
  });

  it("shows a Latest results entry linking to the newest experiment", async () => {
    const repo = new InMemoryEvaluationRepository();
    const suite = makeValidSuite("s1");
    await seedSuite(repo, suite);
    await repo.createExperiment(makeExperiment("exp-1", suite));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    const link = h.$('[data-testid="latest-results-link"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("/experiments/exp-1");
    cleanup(h);
  });

  it("hides the Latest results entry when the suite has no experiments", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeValidSuite("s1"));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    expect(h.$('[data-testid="latest-results-link"]')).toBeNull();
    cleanup(h);
  });

  it("archived suite disables Run with an archived helper", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, { ...makeValidSuite("s1"), archivedAt: Date.now() });
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} controller={makeStubController()} />);
    await settle();
    const runBtn = h.$("button[data-action='run-suite']") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(h.container.textContent).toContain("Archived suites cannot run");
    cleanup(h);
  });
});

describe("SuiteEditor — two-pane split", () => {
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
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    // Task list section
    const taskListSection = h.$('section[aria-label="Task list"]');
    expect(taskListSection).toBeTruthy();
    // Both tasks visible
    expect(h.container.textContent).toContain("Task t1");
    expect(h.container.textContent).toContain("Task t2");
    // Task editor section
    const taskEditorSection = h.$('section[aria-label="Task editor"]');
    expect(taskEditorSection).toBeTruthy();
    cleanup(h);
  });
});

describe("SuiteEditor — settings disclosure", () => {
  it("settings disclosure opens and closes", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(repo, makeSuite("s1", { name: "My Suite", version: 1 }));
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    const settingsBtn = h.$("button[aria-expanded='false']");
    expect(settingsBtn).toBeTruthy();
    await act(async () => {
      settingsBtn!.click();
    });
    await settle();
    const openBtn = h.$("button[aria-expanded='true']");
    expect(openBtn).toBeTruthy();
    // Settings content visible
    expect(h.$("#suite-name")).toBeTruthy();
    cleanup(h);
  });
});

describe("SuiteEditor — Test selected models (spec §8.1)", () => {
  it("shows the batch test action when enabled candidates exist", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedSuite(
      repo,
      makeSuite("s1", {
        name: "My Suite",
        version: 1,
        modelSlots: [
          { id: "m1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
          { id: "m2", providerId: "openrouter", provider: "OpenRouter", model: "B", slug: "model-b", enabled: true },
        ],
      }),
    );
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
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
          { id: "m1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: false },
        ],
      }),
    );
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
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

describe("SuiteEditor — accessibility", () => {
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
    const h = renderWithRouter(<SuiteEditor repo={repo} models={[]} />);
    await settle();
    const buttons = h.$$("button");
    for (const el of buttons) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).toMatch(/min-h-\[44px\]|h-11/);
    }
    cleanup(h);
  });
});
