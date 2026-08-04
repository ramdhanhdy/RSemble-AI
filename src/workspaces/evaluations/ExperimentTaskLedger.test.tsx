// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ExperimentTaskLedger } from "./ExperimentTaskLedger";
import type {
  ExperimentController,
  SimpleResult,
  StartResult,
} from "../../lib/evaluations/experiment-controller";
import type {
  EvaluationTask,
  ExperimentAttemptCoverage,
  ExperimentRecord,
  ExperimentSnapshot,
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

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
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

function makeController(): ExperimentController {
  return {
    start: vi.fn(async (): Promise<StartResult> => ({ ok: true, experimentId: "exp-1" })),
    requestPause: vi.fn(async () => {}),
    resume: vi.fn(async (): Promise<SimpleResult> => ({ ok: true })),
    abort: vi.fn(async () => {}),
    retryIncomplete: vi.fn(async (): Promise<SimpleResult> => ({ ok: true })),
    repairMissingCells: vi.fn(async (): Promise<SimpleResult> => ({ ok: true })),
    addModelAndRun: vi.fn(async (): Promise<StartResult> => ({ ok: true, experimentId: "exp-1" })),
    recoverOnStartup: vi.fn(async () => 0),
    subscribe: vi.fn(() => () => {}),
    whenIdle: vi.fn(async () => {}),
  };
}

// --- Fixtures -----------------------------------------------------------------

const LONG_TITLE =
  "A very long task title that exceeds normal width and should truncate rather than expand the row geometry";

function makeSlots(count = 8): ModelSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `slot-${i + 1}`,
    providerId: "umans",
    provider: "Umans",
    model: `Model ${i + 1}`,
    slug: `model-${i + 1}`,
    enabled: true,
  }));
}

function makeCoverage(scored: number, total: number): ExperimentAttemptCoverage {
  return {
    scoredModelKeys: Array.from({ length: scored }, (_, i) => `model-${i}`),
    totalModels: total,
  };
}

function makeAttempt(
  id: string,
  status: ExperimentTaskAttempt["status"],
  overrides: Partial<ExperimentTaskAttempt> = {},
): ExperimentTaskAttempt {
  return {
    id,
    runId: null,
    trial: 1,
    status,
    startedAt: null,
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

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

function makeExperiment(
  tasks: { id: string; title: string }[],
  states: ExperimentTaskState[],
  status: ExperimentRecord["status"] = "running",
  slotCount = 8,
): ExperimentRecord {
  const now = Date.now();
  const snapshot: ExperimentSnapshot = {
    suiteId: "suite-1",
    suiteVersion: 3,
    tasks: tasks.map((t, i) => makeTask(t.id, t.title, i)),
    modelSlots: makeSlots(slotCount),
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    profiles: [],
    protocolFingerprint: "fp",
    createdAt: now - 60_000,
  };
  return {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 3,
    protocolFingerprint: "fp",
    status,
    execution: null,
    snapshot,
    tasks: states,
    createdAt: now - 60_000,
    updatedAt: now,
  };
}

/** Small running fixture: t1 completed, t2 running, t3 queued. */
function makeRunningExperiment(): ExperimentRecord {
  const now = Date.now();
  return makeExperiment(
    [
      { id: "task-1", title: "Draft release notes" },
      { id: "task-2", title: "Write a haiku" },
      { id: "task-3", title: "Summarize logs" },
    ],
    [
      {
        taskId: "task-1",
        selectedAttemptId: null,
        attempts: [makeAttempt("att-1", "completed", { runId: "run-1", coverage: makeCoverage(8, 8), startedAt: now - 60_000 })],
      },
      {
        taskId: "task-2",
        selectedAttemptId: null,
        attempts: [makeAttempt("att-2", "running", { runId: "run-2", startedAt: now - 5_000 })],
      },
      { taskId: "task-3", selectedAttemptId: null, attempts: [makeAttempt("att-3", "queued")] },
    ],
    "running",
  );
}

/** 250 tasks × 8 models × 3 attempts. Task 0 runs, task 1 is partial, rest complete. */
function makeStressExperiment(): ExperimentRecord {
  const now = Date.now();
  const tasks: { id: string; title: string }[] = [];
  const states: ExperimentTaskState[] = [];
  for (let i = 0; i < 250; i++) {
    const id = `task-${String(i).padStart(3, "0")}`;
    tasks.push({
      id,
      title: i === 0 ? "T" : i === 1 ? LONG_TITLE : `Task ${String(i).padStart(3, "0")}`,
    });
    if (i === 0) {
      states.push({
        taskId: id,
        selectedAttemptId: null,
        attempts: [
          makeAttempt(`${id}-a1`, "completed", { trial: 1, coverage: makeCoverage(8, 8), startedAt: now - 90_000 }),
          makeAttempt(`${id}-a2`, "failed", { trial: 2, startedAt: now - 45_000, finishedAt: now - 40_000 }),
          makeAttempt(`${id}-a3`, "running", { trial: 3, runId: `run-${id}`, startedAt: now - 5_000 }),
        ],
      });
    } else if (i === 1) {
      states.push({
        taskId: id,
        selectedAttemptId: null,
        attempts: [
          makeAttempt(`${id}-a1`, "failed", { trial: 1, startedAt: now - 80_000, finishedAt: now - 70_000 }),
          makeAttempt(`${id}-a2`, "partial", { trial: 2, coverage: makeCoverage(5, 8), startedAt: now - 50_000 }),
          makeAttempt(`${id}-a3`, "partial", { trial: 3, coverage: makeCoverage(4, 8), startedAt: now - 20_000 }),
        ],
      });
    } else {
      states.push({
        taskId: id,
        selectedAttemptId: null,
        attempts: [
          makeAttempt(`${id}-a1`, "completed", { trial: 1, coverage: makeCoverage(8, 8), startedAt: now - 100_000 }),
          makeAttempt(`${id}-a2`, "completed", { trial: 2, coverage: makeCoverage(8, 8), startedAt: now - 60_000 }),
          makeAttempt(`${id}-a3`, "partial", { trial: 3, coverage: makeCoverage(6, 8), startedAt: now - 10_000 }),
        ],
      });
    }
  }
  return makeExperiment(tasks, states, "running", 8);
}

// --- Tests ---------------------------------------------------------------------

describe("ExperimentTaskLedger — stress", () => {
  it("mounts at most 50 primary rows, discloses attempts lazily, and keeps instrument controls before the ledger (250 tasks)", async () => {
    const controller = makeController();
    const h = render(
      <ExperimentTaskLedger experiment={makeStressExperiment()} controller={controller} now={Date.now()} />,
    );
    await settle();

    // At most 50 primary rows mount; the page announces the full extent.
    const primaryRows = h.$$("[data-task-row]");
    expect(primaryRows.length).toBeLessThanOrEqual(50);
    expect(primaryRows.length).toBe(50);
    expect(h.container.textContent).toContain("1–50 of 250");

    // Attempt rows do not mount until disclosure opens.
    expect(h.$$("[data-attempt-row]")).toHaveLength(0);
    const firstToggle = primaryRows[0].querySelector<HTMLButtonElement>("[data-attempt-toggle]")!;
    expect(firstToggle).not.toBeNull();
    await act(async () => {
      firstToggle.click();
      await flush();
    });
    const attemptRows = h.$$("[data-attempt-row]");
    expect(attemptRows).toHaveLength(3);
    await act(async () => {
      firstToggle.click();
      await flush();
    });
    expect(h.$$("[data-attempt-row]")).toHaveLength(0);

    // Current task and Pause/Abort controls sit in the instrument header, before the rows.
    const instrument = h.$("[data-ledger-instrument]")!;
    expect(instrument).not.toBeNull();
    expect(instrument.className).toContain("sticky");
    expect(instrument.className).toContain("bg-panel");
    expect(instrument.className).not.toContain("bg-panel/");
    expect(instrument.textContent).toContain("Task 1 of 250");
    const pause = [...instrument.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Pause after current task",
    );
    const abort = [...instrument.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Abort experiment",
    );
    expect(pause).not.toBeNull();
    expect(abort).not.toBeNull();
    const rowsSection = h.$("[data-ledger-rows]")!;
    const position = instrument.compareDocumentPosition(rowsSection);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup(h);
  });

  it("filtering never mutates canonical order and short/long titles share row geometry", async () => {
    const h = render(
      <ExperimentTaskLedger experiment={makeStressExperiment()} controller={makeController()} now={Date.now()} />,
    );
    await settle();

    const titleOf = (row: HTMLElement): string => {
      const cell = row.querySelector("[data-record-row-surface] span.font-mono");
      return cell?.textContent ?? "";
    };

    // Page 1 starts at canonical task 1 (short title "T") and includes the long title row.
    const before = h.$$("[data-task-row]");
    expect(titleOf(before[0])).toBe("T");
    const longRow = before.find((r) => titleOf(r) === LONG_TITLE);
    expect(longRow).toBeTruthy();

    // Short and long title rows carry identical width-contract geometry.
    const shortSurface = before[0].querySelector<HTMLElement>("[data-record-row-surface]")!;
    const longSurface = longRow!.querySelector<HTMLElement>("[data-record-row-surface]")!;
    const shortCls = shortSurface.getAttribute("class") ?? "";
    const longCls = longSurface.getAttribute("class") ?? "";
    expect(shortCls).toBe(longCls);
    expect(shortCls).toContain("flex-1");
    expect(shortCls).toContain("min-w-0");
    const shortTitle = shortSurface.querySelector<HTMLElement>("span.font-mono")!;
    expect(shortTitle.className).toContain("truncate");
    expect(shortTitle.className).toContain("min-w-0");

    // Complete filter keeps canonical order: first row is task-002 (order 3).
    await act(async () => {
      findButton(h, "Complete")!.click();
      await flush();
    });
    const completeRows = h.$$("[data-task-row]");
    expect(completeRows).toHaveLength(50);
    expect(titleOf(completeRows[0])).toBe("Task 002");

    // Back to All restores the original ordering.
    await act(async () => {
      findButton(h, "All")!.click();
      await flush();
    });
    expect(titleOf(h.$$("[data-task-row]")[0])).toBe("T");
    cleanup(h);
  });
});

describe("ExperimentTaskLedger — controls and counts", () => {
  it("shows current task, counts, and live elapsed time for the running attempt", async () => {
    const h = render(
      <ExperimentTaskLedger experiment={makeRunningExperiment()} controller={makeController()} now={Date.now()} />,
    );
    await settle();
    const text = h.container.textContent ?? "";
    expect(text).toContain("Task 2 of 3");
    expect(text).toContain("Write a haiku");
    expect(text).toContain("1 completed");
    expect(text).toContain("1 queued");
    expect(text).toContain("0:05");
    expect(text).toContain("Trial 1");
    expect(text).toContain("Completed");
    expect(text).toContain("Running");
    expect(text).toContain("Queued");
    cleanup(h);
  });

  it("Pause after current task calls requestPause; Abort calls abort", async () => {
    const controller = makeController();
    const h = render(
      <ExperimentTaskLedger experiment={makeRunningExperiment()} controller={controller} now={Date.now()} />,
    );
    await settle();
    const pause = findButton(h, "Pause after current task")!;
    await act(async () => {
      pause.click();
      await flush();
    });
    expect(controller.requestPause).toHaveBeenCalledTimes(1);
    const abort = findButton(h, "Abort experiment")!;
    expect(abort.className).toContain("text-error");
    await act(async () => {
      abort.click();
      await flush();
    });
    expect(controller.abort).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("shows Resume instead of Pause while paused and calls resume", async () => {
    const controller = makeController();
    const now = Date.now();
    const paused = makeExperiment(
      [
        { id: "task-1", title: "Alpha" },
        { id: "task-2", title: "Beta" },
      ],
      [
        {
          taskId: "task-1",
          selectedAttemptId: null,
          attempts: [makeAttempt("att-1", "completed", { coverage: makeCoverage(8, 8), startedAt: now - 60_000 })],
        },
        { taskId: "task-2", selectedAttemptId: null, attempts: [makeAttempt("att-2", "queued")] },
      ],
      "paused",
    );
    const h = render(<ExperimentTaskLedger experiment={paused} controller={controller} now={now} />);
    await settle();
    expect(findButton(h, "Pause after current task")).toBeNull();
    const resume = findButton(h, "Resume")!;
    await act(async () => {
      resume.click();
      await flush();
    });
    expect(controller.resume).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("disables Pause/Abort when the controller is unavailable", async () => {
    const h = render(
      <ExperimentTaskLedger experiment={makeRunningExperiment()} controller={null} now={Date.now()} />,
    );
    await settle();
    expect(findButton(h, "Pause after current task")!.disabled).toBe(true);
    expect(findButton(h, "Abort experiment")!.disabled).toBe(true);
    cleanup(h);
  });
});

describe("ExperimentTaskLedger — filter, search, pagination, disclosure", () => {
  function makeMixedExperiment(): ExperimentRecord {
    const now = Date.now();
    return makeExperiment(
      [
        { id: "task-1", title: "Alpha done" },
        { id: "task-2", title: "Beta broken" },
        { id: "task-3", title: "Gamma partial" },
        { id: "task-4", title: "Delta pending" },
        { id: "task-5", title: "Epsilon done" },
      ],
      [
        {
          taskId: "task-1",
          selectedAttemptId: null,
          attempts: [makeAttempt("att-1", "completed", { coverage: makeCoverage(8, 8), startedAt: now - 60_000 })],
        },
        { taskId: "task-2", selectedAttemptId: null, attempts: [makeAttempt("att-2", "failed", { startedAt: now - 30_000 })] },
        {
          taskId: "task-3",
          selectedAttemptId: null,
          attempts: [makeAttempt("att-3", "partial", { coverage: makeCoverage(5, 8), startedAt: now - 20_000 })],
        },
        { taskId: "task-4", selectedAttemptId: null, attempts: [makeAttempt("att-4", "queued")] },
        {
          taskId: "task-5",
          selectedAttemptId: null,
          attempts: [makeAttempt("att-5", "completed", { coverage: makeCoverage(8, 8), startedAt: now - 10_000 })],
        },
      ],
      "paused",
    );
  }

  it("filters by status category and preserves canonical order", async () => {
    const h = render(
      <ExperimentTaskLedger experiment={makeMixedExperiment()} controller={makeController()} now={Date.now()} />,
    );
    await settle();

    const titleOf = (row: HTMLElement): string =>
      row.querySelector("[data-record-row-surface] span.font-mono")?.textContent ?? "";

    await act(async () => {
      findButton(h, "Issues")!.click();
      await flush();
    });
    const issues = h.$$("[data-task-row]").map(titleOf);
    expect(issues).toEqual(["Beta broken", "Gamma partial"]);

    await act(async () => {
      findButton(h, "Queued")!.click();
      await flush();
    });
    expect(h.$$("[data-task-row]").map(titleOf)).toEqual(["Delta pending"]);

    await act(async () => {
      findButton(h, "Active")!.click();
      await flush();
    });
    // Non-terminal paused experiment: the first incomplete task is the active one.
    expect(h.$$("[data-task-row]").map(titleOf)).toEqual(["Beta broken"]);

    await act(async () => {
      findButton(h, "Complete")!.click();
      await flush();
    });
    expect(h.$$("[data-task-row]").map(titleOf)).toEqual(["Alpha done", "Epsilon done"]);
    cleanup(h);
  });

  it("searches titles without disturbing order", async () => {
    const h = render(
      <ExperimentTaskLedger experiment={makeMixedExperiment()} controller={makeController()} now={Date.now()} />,
    );
    await settle();
    const input = h.$('input[type="search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "BETA");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
    });
    const titleOf = (row: HTMLElement): string =>
      row.querySelector("[data-record-row-surface] span.font-mono")?.textContent ?? "";
    expect(h.$$("[data-task-row]").map(titleOf)).toEqual(["Beta broken"]);
    cleanup(h);
  });

  it("pages 120 tasks in 50-row pages with Previous/Next and range text", async () => {
    const now = Date.now();
    const tasks = Array.from({ length: 120 }, (_, i) => ({ id: `task-${i}`, title: `Task ${i + 1}` }));
    const states = tasks.map((t, i) => ({
      taskId: t.id,
      selectedAttemptId: null,
      attempts: [
        makeAttempt(`att-${i}`, i % 3 === 0 ? "completed" : "queued", {
          coverage: i % 3 === 0 ? makeCoverage(8, 8) : undefined,
          startedAt: i % 3 === 0 ? now - 60_000 : null,
        }),
      ],
    }));
    const experiment = makeExperiment(tasks, states, "paused", 8);
    const h = render(<ExperimentTaskLedger experiment={experiment} controller={makeController()} now={now} />);
    await settle();

    expect(h.$$("[data-task-row]")).toHaveLength(50);
    expect(h.container.textContent).toContain("1–50 of 120");
    expect(findButton(h, "Previous")!.disabled).toBe(true);

    await act(async () => {
      findButton(h, "Next")!.click();
      await flush();
    });
    expect(h.container.textContent).toContain("51–100 of 120");

    await act(async () => {
      findButton(h, "Next")!.click();
      await flush();
    });
    expect(h.container.textContent).toContain("101–120 of 120");
    expect(h.$$("[data-task-row]")).toHaveLength(20);
    expect(findButton(h, "Next")!.disabled).toBe(true);

    await act(async () => {
      findButton(h, "Previous")!.click();
      await flush();
    });
    expect(h.container.textContent).toContain("51–100 of 120");
    cleanup(h);
  });

  it("keeps attempt history collapsed by default and mounts rows only on disclosure", async () => {
    const h = render(
      <ExperimentTaskLedger experiment={makeMixedExperiment()} controller={makeController()} now={Date.now()} />,
    );
    await settle();
    expect(h.$$("[data-attempt-row]")).toHaveLength(0);
    const toggle = h.$$("[data-attempt-toggle]")[1]; // task-2 has a failed attempt
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      toggle.click();
      await flush();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(h.$$("[data-attempt-row]")).toHaveLength(1);
    expect(h.container.textContent).toContain("Trial 1");
    cleanup(h);
  });
});
