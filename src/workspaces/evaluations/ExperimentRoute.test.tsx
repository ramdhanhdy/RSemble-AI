// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ExperimentRoute } from "./ExperimentRoute";
import type {
  EvaluationTask,
  ExperimentRecord,
  ExperimentSnapshot,
  ExperimentTaskState,
} from "../../lib/evaluations/evaluation-types";

const { mockController, mockEvalRepo, mockRunRepo } = vi.hoisted(() => {
  const controller = {
    start: vi.fn(async (_materializationId: string) => ({ ok: true, experimentId: "exp-1" })),
    requestPause: vi.fn(async () => {}),
    resume: vi.fn(async () => ({ ok: true })),
    abort: vi.fn(async () => {}),
    retryIncomplete: vi.fn(async () => ({ ok: true })),
    repairMissingCells: vi.fn(async () => ({ ok: true })),
    addModelAndRun: vi.fn(async () => ({ ok: true, experimentId: "exp-1" })),
    recoverOnStartup: vi.fn(async () => 0),
    subscribe: vi.fn(() => () => {}),
    whenIdle: vi.fn(async () => {}),
  };
  return {
    mockController: controller,
    mockEvalRepo: { getExperiment: vi.fn(), getSuite: vi.fn() },
    mockRunRepo: { get: vi.fn() },
  };
});

vi.mock("../../lib/evaluations/experiment-controller-hooks", () => ({
  useExperimentController: () => mockController,
  useExecutionLease: () => null,
}));

vi.mock("../../lib/execution-owner-context", () => ({
  useExecutionOwner: () => ({ registry: null, owner: null }),
}));

vi.mock("../../lib/persistence/repository-context", () => ({
  useEvaluationRepository: () => mockEvalRepo,
  useRunRepository: () => mockRunRepo,
}));

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
    root.render(
      <MemoryRouter initialEntries={["/evaluations/results/exp-1"]}>
        <Routes>
          <Route path="/evaluations/results/:evaluationExecutionId" element={node} />
          <Route path="/experiments/:experimentId" element={node} />
        </Routes>
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

async function settle() {
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Fixtures -----------------------------------------------------------------

function makeTask(id: string, title: string, order: number): EvaluationTask {
  return {
    id,
    title,
    prompt: `Prompt for ${title}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order,
  };
}

function makeExperiment(status: ExperimentRecord["status"]): ExperimentRecord {
  const now = Date.now();
  const snapshot: ExperimentSnapshot = {
    suiteId: "suite-1",
    suiteVersion: 3,
    tasks: [makeTask("task-1", "Draft release notes", 0), makeTask("task-2", "Write a haiku", 1)],
    modelSlots: [
      {
        id: "s1",
        providerId: "umans",
        provider: "Umans",
        model: "Model",
        slug: "model",
        enabled: true,
      },
      {
        id: "s2",
        providerId: "9router",
        provider: "9Router",
        model: "Route",
        slug: "route",
        enabled: true,
      },
    ],
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    profiles: [],
    protocolFingerprint: "fp",
    createdAt: now - 60_000,
  };
  const tasks: ExperimentTaskState[] = [
    {
      taskId: "task-1",
      selectedAttemptId: "att-1",
      attempts: [
        {
          id: "att-1",
          runId: "run-1",
          trial: 1,
          status: "completed",
          startedAt: now - 60_000,
          finishedAt: now - 30_000,
          error: null,
        },
      ],
    },
    {
      taskId: "task-2",
      selectedAttemptId: null,
      attempts: [
        status === "completed"
          ? {
              id: "att-2",
              runId: "run-2",
              trial: 1,
              status: "completed",
              startedAt: now - 30_000,
              finishedAt: now - 10_000,
              error: null,
            }
          : {
              id: "att-2",
              runId: null,
              trial: 1,
              status: "queued",
              startedAt: null,
              finishedAt: null,
              error: null,
            },
      ],
    },
  ];
  return {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 3,
    protocolFingerprint: "fp",
    status,
    execution: null,
    snapshot,
    tasks,
    createdAt: now - 60_000,
    updatedAt: now,
  };
}

// --- Tests ---------------------------------------------------------------------

describe("ExperimentRoute", () => {
  it("renders the progress ledger surface for a non-terminal experiment", async () => {
    mockEvalRepo.getExperiment.mockResolvedValue(makeExperiment("running"));
    const h = renderWithRouter(<ExperimentRoute />);
    await settle();
    expect(mockEvalRepo.getExperiment).toHaveBeenCalledWith("exp-1");
    expect(h.$("[data-ledger-instrument]")).not.toBeNull();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Pause after current task");
    expect(text).toContain("Abort experiment");
    cleanup(h);
  });

  it("renders the terminal results surface for a completed experiment", async () => {
    mockEvalRepo.getExperiment.mockResolvedValue(makeExperiment("completed"));
    mockEvalRepo.getSuite.mockResolvedValue(null);
    mockRunRepo.get.mockResolvedValue(null);
    const h = renderWithRouter(<ExperimentRoute />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Evaluation results · Task Set v3");
    cleanup(h);
  });

  it("shows the not-found state with a back link for a missing record", async () => {
    mockEvalRepo.getExperiment.mockResolvedValue(null);
    const h = renderWithRouter(<ExperimentRoute />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Evaluation not found.");
    const back = h.$('a[href="/evaluations/sets"]');
    expect(back).not.toBeNull();
    expect(back!.textContent).toContain("Back to Evaluations");
    cleanup(h);
  });

  it("shows the add-model action on a terminal experiment with a ready provider and no owner", async () => {
    mockEvalRepo.getExperiment.mockResolvedValue(makeExperiment("completed"));
    mockEvalRepo.getSuite.mockResolvedValue(null);
    mockRunRepo.get.mockResolvedValue(null);
    const h = renderWithRouter(
      <ExperimentRoute models={[]} availableProviderIds={["openrouter"]} />,
    );
    await settle();
    expect(h.$('[data-testid="add-model-action"]')).not.toBeNull();
    cleanup(h);
  });

  it("hides the add-model action when another in-tab execution owns the registry", async () => {
    mockEvalRepo.getExperiment.mockResolvedValue(makeExperiment("completed"));
    mockEvalRepo.getSuite.mockResolvedValue(null);
    mockRunRepo.get.mockResolvedValue(null);
    const h = renderWithRouter(
      <ExperimentRoute
        models={[]}
        availableProviderIds={["openrouter"]}
        executionOwner={{ kind: "compare", id: "run-1" }}
      />,
    );
    await settle();
    expect(h.$('[data-testid="add-model-action"]')).toBeNull();
    cleanup(h);
  });

  it("hides the add-model action when no provider is ready", async () => {
    mockEvalRepo.getExperiment.mockResolvedValue(makeExperiment("completed"));
    mockEvalRepo.getSuite.mockResolvedValue(null);
    mockRunRepo.get.mockResolvedValue(null);
    const h = renderWithRouter(<ExperimentRoute models={[]} availableProviderIds={[]} />);
    await settle();
    expect(h.$('[data-testid="add-model-action"]')).toBeNull();
    cleanup(h);
  });
});
