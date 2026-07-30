// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ExperimentProgress } from "./ExperimentProgress";
import type {
  ExperimentController,
  ExperimentControllerEvent,
  SimpleResult,
  StartResult,
} from "../../lib/evaluations/experiment-controller";
import type {
  EvaluationTask,
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskState,
} from "../../lib/evaluations/evaluation-types";
import type { ModelSlot } from "../../studio-data";

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

function findButton(h: Harness, name: string): HTMLButtonElement | null {
  return (
    ([...h.container.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === name,
    ) as HTMLButtonElement | undefined) ?? null
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Stub controller ------------------------------------------------------------

function makeController(): {
  controller: ExperimentController;
  emit: (e: ExperimentControllerEvent) => void;
} {
  const listeners = new Set<(e: ExperimentControllerEvent) => void>();
  const controller: ExperimentController = {
    start: vi.fn(async (): Promise<StartResult> => ({ ok: true, experimentId: "exp-1" })),
    requestPause: vi.fn(),
    resume: vi.fn(async (): Promise<SimpleResult> => ({ ok: true })),
    abort: vi.fn(async () => {}),
    retryIncomplete: vi.fn(async (): Promise<SimpleResult> => ({ ok: true })),
    recoverOnStartup: vi.fn(async () => 0),
    subscribe: vi.fn((listener: (e: ExperimentControllerEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    whenIdle: vi.fn(async () => {}),
  };
  return {
    controller,
    emit: (e) => {
      for (const listener of listeners) listener(e);
    },
  };
}

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

function makeSlots(): ModelSlot[] {
  return [
    { id: "slot-1", providerId: "openrouter", provider: "OpenRouter", model: "gpt-4o", slug: "openai/gpt-4o", enabled: true },
    { id: "slot-2", providerId: "gemini", provider: "Gemini", model: "flash", slug: "gemini-2.0-flash", enabled: true },
  ];
}

function makeAttempt(
  id: string,
  status: ExperimentTaskAttempt["status"],
  overrides: Partial<ExperimentTaskAttempt> = {},
): ExperimentTaskAttempt {
  return { id, runId: null, trial: 1, status, startedAt: null, finishedAt: null, error: null, ...overrides };
}

function taskState(taskId: string, attempts: ExperimentTaskAttempt[]): ExperimentTaskState {
  return { taskId, selectedAttemptId: null, attempts };
}

/** Running experiment: task-1 completed, task-2 running (started 5s ago), task-3 queued. */
function makeExperiment(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  const now = Date.now();
  const tasks = [
    makeTask("task-1", "Draft release notes", 0),
    makeTask("task-2", "Write a haiku", 1),
    makeTask("task-3", "Summarize logs", 2),
  ];
  return {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 3,
    protocolFingerprint: "fp",
    status: "running",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 3,
      tasks,
      modelSlots: makeSlots(),
      defaultJudge: { providerId: "openrouter", model: "judge-model" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "fp",
      createdAt: now - 60_000,
    },
    tasks: [
      taskState("task-1", [makeAttempt("att-1", "completed", { runId: "run-1", startedAt: now - 60_000, finishedAt: now - 30_000 })]),
      taskState("task-2", [makeAttempt("att-2", "running", { runId: "run-2", startedAt: now - 5_000 })]),
      taskState("task-3", [makeAttempt("att-3", "queued")]),
    ],
    createdAt: now - 60_000,
    updatedAt: now,
    ...overrides,
  };
}

// --- Tests ----------------------------------------------------------------------

describe("ExperimentProgress", () => {
  it("shows the completed/total count, current task title, suite version, and started timestamp with timezone (plan 7.1 #1)", async () => {
    const { controller } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Task 2 of 3");
    expect(text).toContain("Write a haiku");
    expect(text).toContain("1 completed");
    expect(text).toContain("Suite v3");
    expect(text).toContain("exp-1");
    expect(text).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    cleanup(h);
  });

  it("renders every task attempt as a RecordRow with StatusMark text, never color-only (plan 7.1 #2)", async () => {
    const { controller } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    const rows = h.$$("[data-record-row]");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.querySelector("[data-status-mark]")).not.toBeNull();
    }
    const text = h.container.textContent ?? "";
    expect(text).toContain("Completed");
    expect(text).toContain("Running");
    expect(text).toContain("Queued");
    // Row titles carry the task title
    expect(text).toContain("Draft release notes");
    expect(text).toContain("Summarize logs");
    cleanup(h);
  });

  it("shows ticking elapsed time for the active task attempt (plan 7.1 #3)", async () => {
    const { controller } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    const text = h.container.textContent ?? "";
    // Attempt started 5s before fixture creation → m:ss render
    expect(text).toContain("0:05");
    expect(text).toContain("Trial 1");
    cleanup(h);
  });

  it("Pause after current task calls requestPause and communicates the task boundary (plan 7.1 #4)", async () => {
    const { controller } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    const pause = findButton(h, "Pause after current task");
    expect(pause).not.toBeNull();
    expect(h.container.textContent).toContain("Takes effect when the current task finishes.");
    await act(async () => {
      pause!.click();
      await flush();
    });
    expect(controller.requestPause).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("shows Resume instead of Pause while paused, and Resume calls resume (plan 7.1 #4)", async () => {
    const { controller } = makeController();
    const paused = makeExperiment({
      status: "paused",
      tasks: [
        taskState("task-1", [makeAttempt("att-1", "completed", { runId: "run-1", startedAt: Date.now() - 60_000 })]),
        taskState("task-2", [makeAttempt("att-2", "queued")]),
        taskState("task-3", [makeAttempt("att-3", "queued")]),
      ],
    });
    const h = renderWithRouter(<ExperimentProgress experiment={paused} controller={controller} />);
    await settle();
    expect(findButton(h, "Pause after current task")).toBeNull();
    const resume = findButton(h, "Resume");
    expect(resume).not.toBeNull();
    await act(async () => {
      resume!.click();
      await flush();
    });
    expect(controller.resume).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("Abort experiment has an explicit accessible name and calls abort (plan 7.1 #5)", async () => {
    const { controller } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    const abort = findButton(h, "Abort experiment");
    expect(abort).not.toBeNull();
    expect(abort!.className).toContain("text-error");
    await act(async () => {
      abort!.click();
      await flush();
    });
    expect(controller.abort).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("Retry incomplete tasks appears with retryable attempts and no running attempt, and calls retryIncomplete (plan 7.1 #6)", async () => {
    const { controller } = makeController();
    const retryable = makeExperiment({
      status: "paused",
      tasks: [
        taskState("task-1", [makeAttempt("att-1", "completed", { runId: "run-1", startedAt: Date.now() - 60_000 })]),
        taskState("task-2", [makeAttempt("att-2", "failed", { startedAt: Date.now() - 30_000, finishedAt: Date.now() - 20_000 })]),
        taskState("task-3", [makeAttempt("att-3", "queued")]),
      ],
    });
    const h = renderWithRouter(<ExperimentProgress experiment={retryable} controller={controller} />);
    await settle();
    const retry = findButton(h, "Retry incomplete tasks");
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.click();
      await flush();
    });
    expect(controller.retryIncomplete).toHaveBeenCalledTimes(1);
    expect(controller.retryIncomplete).toHaveBeenCalledWith("exp-1");
    cleanup(h);
  });

  it("hides Retry incomplete tasks when every attempt completed (plan 7.1 #6)", async () => {
    const { controller } = makeController();
    const allDone = makeExperiment({
      status: "completed",
      tasks: [
        taskState("task-1", [makeAttempt("att-1", "completed", { startedAt: Date.now() - 60_000, finishedAt: Date.now() - 50_000 })]),
        taskState("task-2", [makeAttempt("att-2", "completed", { startedAt: Date.now() - 40_000, finishedAt: Date.now() - 30_000 })]),
        taskState("task-3", [makeAttempt("att-3", "completed", { startedAt: Date.now() - 20_000, finishedAt: Date.now() - 10_000 })]),
      ],
    });
    const h = renderWithRouter(<ExperimentProgress experiment={allDone} controller={controller} />);
    await settle();
    expect(findButton(h, "Retry incomplete tasks")).toBeNull();
    cleanup(h);
  });

  it("hides Retry incomplete tasks while a task attempt is running, even with retryable attempts (plan 7.1 #6)", async () => {
    const { controller } = makeController();
    const runningWithFailure = makeExperiment({
      tasks: [
        taskState("task-1", [makeAttempt("att-1", "failed", { startedAt: Date.now() - 60_000, finishedAt: Date.now() - 50_000 })]),
        taskState("task-2", [makeAttempt("att-2", "running", { runId: "run-2", startedAt: Date.now() - 5_000 })]),
        taskState("task-3", [makeAttempt("att-3", "queued")]),
      ],
    });
    const h = renderWithRouter(<ExperimentProgress experiment={runningWithFailure} controller={controller} />);
    await settle();
    expect(findButton(h, "Retry incomplete tasks")).toBeNull();
    cleanup(h);
  });

  it("shows a role=alert region with the failed operation and next action on a controller error event (plan 7.1 #8)", async () => {
    const { controller, emit } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    expect(h.$('[role="alert"]')).toBeNull();
    await act(async () => {
      emit({ kind: "error", error: "quota exceeded" });
      await flush();
    });
    const alert = h.$('[role="alert"]')!;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain("quota exceeded");
    expect(alert.textContent).toContain("Retry or export before refreshing");
    cleanup(h);
  });

  it("disables controls with a truthful helper when the controller is unavailable (plan 7.1 #13)", async () => {
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={null} />);
    await settle();
    expect(h.container.textContent).toContain("Execution controller unavailable (storage not ready).");
    const pause = findButton(h, "Pause after current task");
    const abort = findButton(h, "Abort experiment");
    expect(pause).not.toBeNull();
    expect(pause!.disabled).toBe(true);
    expect(abort).not.toBeNull();
    expect(abort!.disabled).toBe(true);
    cleanup(h);
  });

  it("links Back to suite at the owning suite route with a ≥44px target", async () => {
    const { controller } = makeController();
    const h = renderWithRouter(<ExperimentProgress experiment={makeExperiment()} controller={controller} />);
    await settle();
    const back = h.$('a[href="/evaluations/suite-1"]')!;
    expect(back).not.toBeNull();
    expect(back.textContent).toContain("Back to suite");
    expect(back.className).toContain("min-h-[44px]");
    cleanup(h);
  });
});
