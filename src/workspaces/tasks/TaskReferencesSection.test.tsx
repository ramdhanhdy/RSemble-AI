// @vitest-environment happy-dom
//
// TaskReferencesSection tests — Canonical Tasks references and instance disclosure.
// Verifies that references render without suite or task version numbers and without
// "exact vN" wording, while retaining state facts and limitations.

import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { InMemoryTaskRepository } from "../../lib/persistence/in-memory-task-repository";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import type {
  EvaluationSuite,
  EvaluationTask,
  ExperimentRecord,
} from "../../lib/evaluations/evaluation-types";
import { computeInstanceInputDigest } from "../../lib/tasks/task-instance";
import { TaskReferencesSection } from "./TaskReferencesSection";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_700_000_000_000;

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

async function seedTask(
  repo: InMemoryTaskRepository,
  id: string,
  title: string,
): Promise<TaskRecord> {
  const version: TaskVersion = {
    taskId: id,
    version: 1,
    title,
    objective: `Objective for ${title}.`,
    candidateInstruction: `Instruction for ${title}.`,
    defaultContextManifest: [],
    responseContract: null,
    taskVerifierRef: null,
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: NOW,
  };
  const record: TaskRecord = {
    id,
    latestVersion: 1,
    origin: "authored",
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
  await repo.createTask(record, version);
  return record;
}

describe("TaskReferencesSection — rendering references without version wording", () => {
  it("renders references and origin disclosure", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const evalRepo = new InMemoryEvaluationRepository();
    const task = await seedTask(taskRepo, "t-1", "Test Task");

    const h = render(<TaskReferencesSection taskRepo={taskRepo} evalRepo={evalRepo} task={task} />);
    await settle();

    expect(h.$("[data-task-references-section]")).toBeTruthy();
    expect(h.container.textContent).toContain("References");
    expect(h.container.textContent).toContain("Shows where this task is used.");
    expect(h.container.textContent).toContain("origin authored");
    expect(h.container.textContent).not.toContain("exact stored versions and instances");
    expect(h.container.textContent).not.toMatch(/crosswalk/i);
    expect(h.container.textContent).not.toMatch(/compatibility/i);
    cleanup(h);
  });

  it("renders current suites with suite name and state without version numbers or exact vN wording", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const evalRepo = new InMemoryEvaluationRepository();
    const task = await seedTask(taskRepo, "t-1", "Referenced Task");

    const suite: EvaluationSuite = {
      id: "suite-alpha",
      revision: 1,
      version: 5,
      name: "Alpha Suite",
      description: "",
      tasks: [
        {
          id: "t-1",
          title: "Referenced Task",
          prompt: "Prompt",
          systemPrompt: "",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
          taskVersionRef: { taskId: "t-1", version: 2 },
        } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
      ],
      modelSlots: [],
      defaultJudge: { providerId: "openrouter", model: "" },
      defaultEvaluation: { kind: "holistic" },
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };
    await evalRepo.saveSuite(suite, 0);

    const h = render(<TaskReferencesSection taskRepo={taskRepo} evalRepo={evalRepo} task={task} />);
    await settle();

    expect(h.container.textContent).toContain("Current suites");
    expect(h.container.textContent).toContain("Alpha Suite · Unavailable");
    // Explicit absence checks for version mindset
    expect(h.container.textContent).not.toContain("exact v");
    expect(h.container.textContent).not.toContain("Alpha Suite v5");
    expect(h.container.textContent).not.toMatch(/Task Version/i);
    expect(h.container.textContent).not.toMatch(/pinned version/i);
    expect(h.container.textContent).not.toMatch(/crosswalk/i);
    expect(h.container.textContent).not.toMatch(/compatibility/i);
    expect(h.container.textContent).not.toContain("resolved");
    expect(h.container.textContent).not.toContain("unresolved");
    cleanup(h);
  });

  it("renders past evaluations with suite id and state without version numbers or exact vN wording", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const evalRepo = new InMemoryEvaluationRepository();
    const task = await seedTask(taskRepo, "t-1", "Experiment Task");

    const suite: EvaluationSuite = {
      id: "suite-beta",
      revision: 1,
      version: 3,
      name: "Beta Suite",
      description: "",
      tasks: [
        {
          id: "t-1",
          title: "Experiment Task",
          prompt: "Prompt",
          systemPrompt: "",
          evaluation: { kind: "inherit" },
          judgeInstructionOverride: "",
          order: 0,
          taskVersionRef: { taskId: "t-1", version: 1 },
        } as EvaluationTask & { taskVersionRef: { taskId: string; version: number } },
      ],
      modelSlots: [],
      defaultJudge: { providerId: "openrouter", model: "" },
      defaultEvaluation: { kind: "holistic" },
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    };
    await evalRepo.saveSuite(suite, 0);

    const exp: ExperimentRecord = {
      id: "exp-101",
      revision: 0,
      suiteId: "suite-beta",
      suiteVersion: 3,
      protocolFingerprint: "sha256:fp",
      status: "completed",
      execution: null,
      snapshot: {
        suiteId: "suite-beta",
        suiteVersion: 3,
        tasks: suite.tasks,
        modelSlots: [],
        defaultJudge: suite.defaultJudge,
        defaultEvaluation: suite.defaultEvaluation,
        profiles: [],
        protocolFingerprint: "sha256:fp",
        createdAt: NOW,
      },
      tasks: [],
      createdAt: NOW,
      updatedAt: NOW,
    };
    await evalRepo.createExperiment(exp);

    const h = render(<TaskReferencesSection taskRepo={taskRepo} evalRepo={evalRepo} task={task} />);
    await settle();

    expect(h.container.textContent).toContain("Past evaluations");
    expect(h.container.textContent).not.toContain("Historical experiments");
    expect(h.container.textContent).toContain("exp-101 · suite suite-beta · Unavailable");
    expect(h.container.textContent).not.toContain("exact v");
    expect(h.container.textContent).not.toContain("suite-beta v3");
    expect(h.container.textContent).not.toMatch(/crosswalk/i);
    expect(h.container.textContent).not.toMatch(/compatibility/i);
    expect(h.container.textContent).not.toContain("resolved");
    expect(h.container.textContent).not.toContain("unresolved");
    cleanup(h);
  });

  it("lists task instances with digest abbreviation, source, and state", async () => {
    const taskRepo = new InMemoryTaskRepository();
    const evalRepo = new InMemoryEvaluationRepository();
    const task = await seedTask(taskRepo, "t-1", "Instance Task");

    const candidate = {
      id: "inst-1",
      taskId: "t-1",
      taskVersion: 1,
      normalizedInput: { text: "Input text", artifactIds: [] as string[], metadata: {} },
      contextManifest: [],
      inputDigest: "",
      inputCompleteness: "complete" as const,
      createdAt: NOW,
      sourceRef: { kind: "authored" as const, legacyScopeKey: null, originId: null },
    };
    candidate.inputDigest = computeInstanceInputDigest(candidate);
    await taskRepo.getOrCreateTaskInstance(candidate, new Map());

    const h = render(<TaskReferencesSection taskRepo={taskRepo} evalRepo={evalRepo} task={task} />);
    await settle();

    const list = h.$("[data-task-instances]");
    expect(list).toBeTruthy();
    expect(list?.textContent).toContain(candidate.inputDigest.slice(7, 15));
    expect(list?.textContent).toMatch(/authored/i);
    expect(list?.textContent).toContain("Linked");
    expect(list?.textContent).not.toMatch(/resolved/i);
    expect(list?.textContent).not.toMatch(/unresolved/i);
    expect(h.container.textContent).not.toMatch(/crosswalk/i);
    expect(h.container.textContent).not.toMatch(/compatibility/i);
    cleanup(h);
  });
});
