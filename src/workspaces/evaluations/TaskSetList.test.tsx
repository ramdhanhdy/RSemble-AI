// @vitest-environment happy-dom
//
// Task Set list surface (child 03 Task 5 / spec §4). Canonical copy and
// /evaluations/sets/:taskSetId row links. Frozen EvaluationSuite fields stay
// serialized as suiteId/suiteVersion; only the user-facing list is renamed.
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { TaskSetList } from "./TaskSetList";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { EvaluationSuite } from "../../lib/evaluations/evaluation-types";
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

function renderWithRouter(node: React.ReactNode): Harness {
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

async function settle() {
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function makeSuite(id: string, overrides: Partial<EvaluationSuite> = {}): EvaluationSuite {
  const now = Date.now();
  return {
    id,
    revision: 1,
    version: 1,
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

async function seedRepo(repo: InMemoryEvaluationRepository, suites: EvaluationSuite[]) {
  for (const s of suites) {
    await repo.saveSuite(s, 0);
  }
}

describe("TaskSetList — empty state", () => {
  it("explains what a task set is and offers Create", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    expect(h.container.textContent).toMatch(/task set/i);
    expect(h.container.textContent).toMatch(/groups several tasks/i);
    const createBtn = h.$("button[data-action='create-task-set']");
    expect(createBtn).toBeTruthy();
    expect(createBtn!.textContent).toMatch(/create task set/i);
    cleanup(h);
  });

  it("cross-links rubrics so first-run users learn the split", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const link = h.$("a[href='/evaluations/rubrics']");
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Rubrics");
    expect(h.container.textContent).toMatch(/task sets pin them/i);
    cleanup(h);
  });

  it("storage unavailable shows an error, not a create button that lies about saving", async () => {
    const failingRepo = {
      listSuites: vi.fn().mockRejectedValue(new Error("storage down")),
      getSuite: vi.fn(),
      saveSuite: vi.fn(),
      archiveSuite: vi.fn(),
      listRubrics: vi.fn(),
      getRubricRecord: vi.fn(),
      getRubricVersion: vi.fn(),
      createRubric: vi.fn(),
      appendRubricVersion: vi.fn(),
      setRubricArchived: vi.fn(),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn(),
      getExperiment: vi.fn(),
      listExperiments: vi.fn(),
      beginExperimentTask: vi.fn(),
      commitExperimentTaskTerminal: vi.fn(),
    } as unknown as InMemoryEvaluationRepository;
    const h = renderWithRouter(<TaskSetList repo={failingRepo} />);
    await settle();
    expect(h.container.textContent).toMatch(/failed|error|unavailable/i);
    expect(h.$$("a[href^='/evaluations/sets/']")).toHaveLength(0);
    cleanup(h);
  });
});

describe("TaskSetList — rows", () => {
  it("renders task set rows as links to /evaluations/sets/:taskSetId", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1"), makeSuite("s2")]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const links = h.$$("a[href^='/evaluations/sets/']");
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.some((l) => l.getAttribute("href") === "/evaluations/sets/s1")).toBe(true);
    expect(links.some((l) => l.getAttribute("href") === "/evaluations/sets/s2")).toBe(true);
    cleanup(h);
  });

  it("shows version, task count, and model count", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [
      makeSuite("s1", {
        version: 3,
        tasks: [
          {
            id: "t1",
            title: "T1",
            prompt: "p",
            systemPrompt: "",
            evaluation: { kind: "inherit" },
            judgeInstructionOverride: "",
            order: 0,
          },
        ],
        modelSlots: [
          {
            id: "slot1",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "gpt-4o",
            slug: "openai/gpt-4o",
            enabled: true,
          },
          {
            id: "slot2",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "claude",
            slug: "anthropic/claude",
            enabled: true,
          },
          {
            id: "slot3",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "off",
            slug: "off/off",
            enabled: false,
          },
        ],
      }),
    ]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("v3");
    expect(text).toContain("1 task");
    expect(text).toContain("2 models");
    cleanup(h);
  });

  it("duplicate creates a distinct draft with (copy) suffix", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1", { name: "My Suite" })]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const dupBtn = h.$("button[aria-label^='Duplicate task set']");
    expect(dupBtn).toBeTruthy();
    await act(async () => {
      dupBtn!.click();
      await flush();
    });
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("My Suite (copy)");
    expect(text).toContain("My Suite");
    cleanup(h);
  });

  it("archive requires confirmation before removing", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const archiveBtn = h.$("button[aria-label^='Archive task set']");
    expect(archiveBtn).toBeTruthy();
    await act(async () => {
      archiveBtn!.click();
    });
    await settle();
    const confirmBtn = h.$("button[data-action='confirm-archive']");
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn!.textContent).toMatch(/archive/i);
    expect(h.$$("a[href^='/evaluations/sets/']")).toHaveLength(1);
    cleanup(h);
  });

  it("confirmed archive removes the task set from the default list", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const archiveBtn = h.$("button[aria-label^='Archive task set']");
    await act(async () => {
      archiveBtn!.click();
    });
    await settle();
    const confirmBtn = h.$("button[data-action='confirm-archive']");
    await act(async () => {
      confirmBtn!.click();
      await flush();
    });
    await settle();
    expect(h.$$("[data-record-row] a[href^='/evaluations/sets/']")).toHaveLength(0);
    const showArchived = h.$("input[type='checkbox']") as HTMLInputElement;
    expect(showArchived).toBeTruthy();
    await act(async () => {
      showArchived.click();
    });
    await settle();
    expect(h.$$("a[href^='/evaluations/sets/']")).toHaveLength(1);
    cleanup(h);
  });
});

describe("TaskSetList — create", () => {
  it("create button saves a suite record and keeps frozen suite fields", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const createBtn = h.$("button[data-action='create-task-set']");
    await act(async () => {
      createBtn!.click();
      await flush();
    });
    await settle();
    const suites = await repo.listSuites(true);
    expect(suites).toHaveLength(1);
    expect(suites[0]).toHaveProperty("id");
    expect(suites[0]).toHaveProperty("version");
    cleanup(h);
  });

  it("storage error on create does not claim a task set was saved", async () => {
    const failingRepo = {
      listSuites: vi.fn().mockResolvedValue([]),
      getSuite: vi.fn(),
      saveSuite: vi.fn().mockRejectedValue(new StorageError("quota", "disk full")),
      archiveSuite: vi.fn(),
      listRubrics: vi.fn(),
      getRubricRecord: vi.fn(),
      getRubricVersion: vi.fn(),
      createRubric: vi.fn(),
      appendRubricVersion: vi.fn(),
      setRubricArchived: vi.fn(),
      createExperiment: vi.fn(),
      updateExperiment: vi.fn(),
      getExperiment: vi.fn(),
      listExperiments: vi.fn(),
      beginExperimentTask: vi.fn(),
      commitExperimentTaskTerminal: vi.fn(),
    } as unknown as InMemoryEvaluationRepository;
    const h = renderWithRouter(<TaskSetList repo={failingRepo} />);
    await settle();
    const createBtn = h.$("button[data-action='create-task-set']");
    await act(async () => {
      createBtn!.click();
      await flush();
    });
    await settle();
    expect(h.container.textContent).toMatch(/storage|full|free space/i);
    expect(h.$$("[data-record-row] a[href^='/evaluations/sets/']")).toHaveLength(0);
    cleanup(h);
  });
});

describe("TaskSetList — suite package import", () => {
  const pkg = {
    kind: "rsemble-suite-package",
    schemaVersion: 1,
    name: "Imported Suite",
    tasks: [{ title: "Task A", prompt: "Answer the question" }],
    modelSlots: [
      { providerId: "openrouter", provider: "A", model: "MA", slug: "a/m1" },
      { providerId: "openrouter", provider: "B", model: "MB", slug: "b/m2" },
    ],
    defaultJudge: { providerId: "openrouter", model: "judge-1" },
  };

  async function chooseImportFile(h: Harness, file: File) {
    const input = h.$('input[aria-label="Import task set package"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });
    await settle();
  }

  it("imports a suite package — creates a NEW suite record every time", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const file = new File([JSON.stringify(pkg)], "suite.json", { type: "application/json" });
    await chooseImportFile(h, file);

    expect(await repo.listSuites(true)).toHaveLength(1);
    expect((await repo.listSuites(true))[0].name).toBe("Imported Suite");
    expect(h.$('[data-testid="task-set-import-notes"]')?.textContent).toContain("ready to run");

    await chooseImportFile(h, file);
    expect(await repo.listSuites(true)).toHaveLength(2);
    cleanup(h);
  });

  it("surfaces parse errors and imports nothing", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const file = new File(
      [JSON.stringify({ kind: "rsemble-suite-package", schemaVersion: 1 })],
      "bad.json",
      {
        type: "application/json",
      },
    );
    await chooseImportFile(h, file);
    expect(h.$('[data-testid="task-set-import-errors"]')).not.toBeNull();
    expect(await repo.listSuites(true)).toHaveLength(0);
    cleanup(h);
  });
});

describe("TaskSetList — identity (spec evaluations-identity-ux)", () => {
  it("shows the workload kind eyebrow and ready status, not draft", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1", { name: "My Battery" })]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Workload");
    expect(text).toContain("Ready");
    expect(text).not.toContain("Draft");
    cleanup(h);
  });

  it("archived task sets keep the aborted status", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1", { archivedAt: Date.now() })]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const toggle = h.$("input[type='checkbox']");
    if (toggle) {
      await act(async () => {
        toggle.click();
        await flush();
      });
      await settle();
    }
    expect(h.container.textContent).toContain("Aborted");
    cleanup(h);
  });

  it("shows the pinned rubric chip linking to the rubric", async () => {
    const repo = new InMemoryEvaluationRepository();
    const now = Date.now();
    const criterion = {
      id: "c1",
      name: "Accuracy",
      description: "",
      weight: 1,
      anchors: { one: "1", three: "3", five: "5" },
    };
    await repo.createRubric(
      { id: "p1", revision: 1, latestVersion: 1, createdAt: now, updatedAt: now, archivedAt: null },
      {
        id: "p1",
        version: 1,
        name: "Clarity rubric",
        description: "",
        judgeInstruction: "",
        criteria: [criterion],
        createdAt: now,
        updatedAt: now,
      },
    );
    await seedRepo(repo, [
      makeSuite("s1", {
        defaultEvaluation: { kind: "profile", profile: { id: "p1", version: 1 } },
      }),
    ]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const chip = h.$("a[href='/evaluations/rubrics/p1']");
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain("Clarity rubric v1");
    cleanup(h);
  });

  it("shows a holistic judging chip when the task set uses no rubric", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    expect(h.container.textContent).toContain("Holistic judging");
    cleanup(h);
  });

  it("shows rubric missing when the pinned rubric no longer exists", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [
      makeSuite("s1", {
        defaultEvaluation: { kind: "profile", profile: { id: "gone", version: 1 } },
      }),
    ]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    expect(h.container.textContent).toContain("Rubric missing");
    cleanup(h);
  });

  it("shows latest experiment status on the row when experiments exist", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const now = Date.now();
    await repo.createExperiment({
      id: "exp1",
      revision: 1,
      suiteId: "s1",
      suiteVersion: 1,
      protocolFingerprint: "fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "s1",
        suiteVersion: 1,
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "j" },
        defaultEvaluation: { kind: "holistic" },
        profiles: [],
        protocolFingerprint: "fp",
        createdAt: now,
      },
      tasks: [],
      createdAt: now,
      updatedAt: now,
    });
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    expect(h.container.textContent).toContain("Completed");
    cleanup(h);
  });
});

describe("TaskSetList — accessibility and responsive identity", () => {
  it("all interactive controls meet 44px target size", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const interactives = [...h.$$("button"), ...h.$$("a[href^='/evaluations/sets/']")];
    for (const el of interactives) {
      const cls = el.getAttribute("class") ?? "";
      expect(cls).toMatch(/min-h-\[44px\]|h-11/);
    }
    cleanup(h);
  });

  it("reserves the archive-slot width so arming does not shift the row", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedRepo(repo, [makeSuite("s1")]);
    const h = renderWithRouter(<TaskSetList repo={repo} />);
    await settle();
    const slot = h.$("[data-geometry='task-set-archive-slot']");
    expect(slot).toBeTruthy();
    expect(slot?.className).toMatch(/sm:min-w-\[136px\]/);
    cleanup(h);
  });
});
