// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ExperimentResults } from "./ExperimentResults";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskState,
  ExperimentSnapshot,
} from "../../lib/evaluations/evaluation-types";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import type { CandidateEvaluation, ModelSlot } from "../../studio-data";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function renderWithRouter(node: ReactNode): Harness {
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --- Fixtures ---

const SLOTS: ModelSlot[] = [
  { id: "s1", providerId: "umans", provider: "Umans", model: "Model", slug: "model", enabled: true },
  { id: "s2", providerId: "9router", provider: "9Router", model: "Route", slug: "route", enabled: true },
];
const MK_COMPLETE = "umans:model";
const MK_PROVISIONAL = "9router:route";

function makeSnapshot(taskIds: string[]): ExperimentSnapshot {
  return {
    suiteId: "suite-1",
    suiteVersion: 1,
    tasks: taskIds.map((id, i) => ({
      id,
      title: `Task ${id}`,
      prompt: `Prompt ${id}`,
      systemPrompt: "",
      evaluation: { kind: "holistic" as const },
      judgeInstructionOverride: "",
      order: i,
    })),
    modelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" as const },
    profiles: [],
    protocolFingerprint: "sha256:abc",
    createdAt: 1000,
  };
}

function makeRun(runId: string, scores: Record<string, number>): RunRecordV2 {
  const candidates = Object.keys(scores).map((modelKey, i) => ({
    candidateId: `cand-${i}`,
    slotId: `slot-${i}`,
    modelKey,
    providerId: modelKey.split(":")[0] as RunRecordV2["candidates"][number]["providerId"],
    model: modelKey,
    slug: modelKey.split(":")[1],
    acceptedAttemptId: `att-cand-${i}`,
    attempts: [],
  }));
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  Object.keys(scores).forEach((modelKey, i) => {
    const cid = `cand-${i}`;
    evaluationsById[cid] = {
      candidateId: cid,
      blindLabel: "A",
      overallScore: scores[modelKey],
      position: "p",
      rationale: "r",
      strengths: ["s"],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    };
  });
  return {
    schemaVersion: 2,
    id: runId,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 1100,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates,
    judge: {
      status: "done",
      acceptedAttemptId: "judge-att-1",
      report: { labelMap: [], evaluationsById, comparisons: [] },
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function makeTaskState(
  taskId: string,
  runId: string,
  status: ExperimentTaskAttempt["status"] = "completed",
): ExperimentTaskState {
  return {
    taskId,
    selectedAttemptId: `att-${taskId}`,
    attempts: [
      { id: `att-${taskId}`, runId, trial: 0, status, startedAt: 100, finishedAt: 200, error: null },
    ],
  };
}

/**
 * 15-task experiment where:
 * - umans:model scores 4.38 on all 15 tasks (complete, winner-eligible)
 * - 9router:route scores 4.54 on 14/15 tasks (higher mean, incomplete)
 *
 * The terminal results must crown umans:model as the complete-coverage winner
 * and must never label 9router:route as #1.
 */
function makeWinnerProvisionalExperiment(): {
  experiment: ExperimentRecord;
  runs: Record<string, RunRecordV2>;
} {
  const taskIds = Array.from({ length: 15 }, (_, i) => `t${i + 1}`);
  const taskStates: ExperimentTaskState[] = [];
  const runs: Record<string, RunRecordV2> = {};

  for (let i = 0; i < 15; i++) {
    const taskId = taskIds[i];
    const runId = `run-${taskId}`;
    const scores: Record<string, number> = { [MK_COMPLETE]: 4.38 };
    // 9router:route is missing on the last task (14/15)
    if (i < 14) scores[MK_PROVISIONAL] = 4.54;
    runs[runId] = makeRun(runId, scores);
    taskStates.push(makeTaskState(taskId, runId));
  }

  const experiment: ExperimentRecord = {
    id: "exp-1",
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    execution: null,
    snapshot: makeSnapshot(taskIds),
    tasks: taskStates,
    status: "completed",
    revision: 1,
    createdAt: 1000,
    updatedAt: 2000,
  };

  return { experiment, runs };
}

describe("ExperimentResults — winner and provisional ranking", () => {
  it("crowns the complete-coverage winner, not the higher-mean incomplete model", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const resolveRun = vi.fn(async (runId: string) => runs[runId] ?? null);

    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={resolveRun} />,
    );
    await settle();

    const winnerCallout = h.$('[data-testid="winner-callout"]');
    expect(winnerCallout).toBeTruthy();
    const winnerText = winnerCallout?.textContent ?? "";
    expect(winnerText).toContain("umans");
    cleanup(h);
  });

  it("never gives the provisional model a numeric rank", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const resolveRun = vi.fn(async (runId: string) => runs[runId] ?? null);

    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={resolveRun} />,
    );
    await settle();

    const text = h.container.textContent ?? "";
    // Provisional results heading exists and the provisional model is listed
    // WITHOUT any numeric rank (the eligible group owns the #1..#N ranks).
    expect(text).toContain("Provisional results");
    // The provisional row must not contain a rank label: find the row that
    // contains the 9router label and assert no "#" rank text precedes it.
    const provisionalList = h.$('[aria-label="Aggregate scores"]');
    const rows = [...(provisionalList?.querySelectorAll("li") ?? [])];
    const provisionalRow = rows.find((li) => li.textContent?.includes("9router"));
    expect(provisionalRow).toBeTruthy();
    // The only rank span in the provisional row would be the spacer (empty);
    // assert it is not a numeric "#N".
    const rankText = provisionalRow?.querySelector(".font-mono.text-xs")?.textContent ?? "";
    expect(rankText).not.toMatch(/^#\d+$/);
    cleanup(h);
  });

  it("labels the winner callout as Complete-coverage winner", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const resolveRun = vi.fn(async (runId: string) => runs[runId] ?? null);

    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={resolveRun} />,
    );
    await settle();

    const winnerCallout = h.$('[data-testid="winner-callout"]');
    expect(winnerCallout?.textContent ?? "").toContain("Complete-coverage winner");
    cleanup(h);
  });

  it("shows a provisional score leader line when an incomplete model has a higher mean", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const resolveRun = vi.fn(async (runId: string) => runs[runId] ?? null);

    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={resolveRun} />,
    );
    await settle();

    const text = h.container.textContent ?? "";
    expect(text).toContain("Provisional score leader");
    expect(text).toContain("not winner-eligible");
    cleanup(h);
  });

  it("labels incomplete models with Incomplete and coverage", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const resolveRun = vi.fn(async (runId: string) => runs[runId] ?? null);

    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={resolveRun} />,
    );
    await settle();

    const text = h.container.textContent ?? "";
    expect(text).toContain("Incomplete");
    expect(text).toContain("14/15");
    cleanup(h);
  });
});

describe("ExperimentResults — terminal recovery (Task 7)", () => {
  function makeController(retryResult: { ok: boolean; error?: string } = { ok: true }) {
    return {
      retryIncomplete: vi.fn(async () => retryResult),
      repairMissingCells: vi.fn(async () => ({ ok: true })),
      requestPause: vi.fn(async () => {}),
      recoverOnStartup: vi.fn(async () => 0),
      subscribe: vi.fn(() => () => {}),
      whenIdle: vi.fn(async () => {}),
    } as unknown as ExperimentController;
  }

  function makeFailedExperiment(): { experiment: ExperimentRecord; runs: Record<string, RunRecordV2> } {
    const taskIds = ["t1", "t2", "t3"];
    const taskStates: ExperimentTaskState[] = [];
    const runs: Record<string, RunRecordV2> = {};
    taskIds.forEach((taskId, i) => {
      const runId = `run-${taskId}`;
      runs[runId] = makeRun(runId, { [MK_COMPLETE]: 4.0 });
      taskStates.push({
        taskId,
        selectedAttemptId: `att-${taskId}`,
        attempts: [
          {
            id: `att-${taskId}`,
            runId,
            trial: 0,
            status: i === 0 ? "failed" : "completed",
            startedAt: 100,
            finishedAt: 200,
            error: null,
          },
        ],
      });
    });
    return {
      experiment: {
        id: "exp-fail",
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: "sha256:abc",
        execution: null,
        snapshot: makeSnapshot(taskIds),
        tasks: taskStates,
        status: "completed_with_failures",
        revision: 1,
        createdAt: 1000,
        updatedAt: 2000,
      },
      runs,
    };
  }

  it("shows Retry all incomplete tasks when retryable tasks exist and no execution is active", async () => {
    const { experiment, runs } = makeFailedExperiment();
    const controller = makeController({ ok: true });
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    const btn = h.$$("button").find((b) => b.textContent?.includes("Retry all incomplete tasks"));
    expect(btn).toBeTruthy();
    cleanup(h);
  });

  it("clicking retry calls controller.retryIncomplete with the experiment id", async () => {
    const { experiment, runs } = makeFailedExperiment();
    const controller = makeController({ ok: true });
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    const btn = h.$$("button").find((b) => b.textContent?.includes("Retry all incomplete tasks"))!;
    await act(async () => {
      btn.click();
      await flush();
    });
    await settle();
    expect(controller.retryIncomplete).toHaveBeenCalledWith("exp-fail");
    cleanup(h);
  });

  it("operation errors render as visible alerts", async () => {
    const { experiment, runs } = makeFailedExperiment();
    const controller = makeController({ ok: false, error: "Another tab holds the lease" });
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    const btn = h.$$("button").find((b) => b.textContent?.includes("Retry all incomplete tasks"))!;
    await act(async () => {
      btn.click();
      await flush();
    });
    await settle();
    const alert = h.$("[role='alert']");
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("Another tab holds the lease");
    cleanup(h);
  });

  it("shows no retry action for a fully complete experiment", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const controller = makeController({ ok: true });
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    const btn = h.$$("button").find((b) => b.textContent?.includes("Retry all incomplete tasks"));
    expect(btn).toBeFalsy();
    cleanup(h);
  });
});

describe("ExperimentResults — recovery controls (Task 12)", () => {
  function makeController(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      retryIncomplete: vi.fn(async () => ({ ok: true })),
      repairMissingCells: vi.fn(async () => ({ ok: true })),
      requestPause: vi.fn(async () => {}),
      recoverOnStartup: vi.fn(async () => 0),
      subscribe: vi.fn(() => () => {}),
      whenIdle: vi.fn(async () => {}),
      ...overrides,
    } as unknown as ExperimentController;
  }

  /** Desktop media query so the full result matrix (with cell actions) renders. */
  function stubDesktop() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("min-width: 768"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
  }

  /**
   * Three-task experiment with one repairable cell and fallback cells:
   * - t1: fully scored (both models).
   * - t2: selected partial attempt whose run scored only MK_COMPLETE → the
   *   MK_PROVISIONAL cell is no-score AND repairable (accepted candidate exists).
   * - t3: no selected attempt (attempt failed) → all cells no-accepted-attempt,
   *   which require the full-task fallback.
   *
   * Runs are experiment-sourced (source.kind === "experiment" with matching
   * experiment/suite/protocol/task identity) so the pure planner accepts them
   * as repairable base runs (spec §11.2).
   */
  function makeExperimentRun(
    runId: string,
    scores: Record<string, number>,
    taskId: string,
    experimentId = "exp-rep",
  ): RunRecordV2 {
    return {
      ...makeRun(runId, scores),
      source: {
        kind: "experiment" as const,
        experimentId,
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: "sha256:abc",
        taskId,
        experimentTaskAttemptId: `att-${taskId}`,
        trial: 0,
      },
    };
  }

  function makeRepairableExperiment(): {
    experiment: ExperimentRecord;
    runs: Record<string, RunRecordV2>;
  } {
    const runT1 = makeExperimentRun("run-t1", { [MK_COMPLETE]: 4.1, [MK_PROVISIONAL]: 4.2 }, "t1");
    const runT2 = makeExperimentRun("run-t2", { [MK_COMPLETE]: 4.2 }, "t2");
    const runT3 = makeExperimentRun("run-t3", { [MK_COMPLETE]: 3.9 }, "t3");
    const runs: Record<string, RunRecordV2> = { "run-t1": runT1, "run-t2": runT2, "run-t3": runT3 };
    const experiment: ExperimentRecord = {
      id: "exp-rep",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      execution: null,
      snapshot: makeSnapshot(["t1", "t2", "t3"]),
      tasks: [
        makeTaskState("t1", "run-t1"),
        makeTaskState("t2", "run-t2", "partial"),
        {
          taskId: "t3",
          selectedAttemptId: null,
          attempts: [
            { id: "att-t3-f", runId: "run-t3", trial: 0, status: "failed", startedAt: 100, finishedAt: 200, error: null },
          ],
        },
      ],
      status: "completed_with_failures",
      revision: 1,
      createdAt: 1000,
      updatedAt: 2000,
    };
    return { experiment, runs };
  }

  it("shows Complete missing result on a repairable cell and starts the repair through the controller", async () => {
    stubDesktop();
    const { experiment, runs } = makeRepairableExperiment();
    const controller = makeController();
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    await settle();

    const cellAction = h.$$("button").find((b) => b.textContent?.includes("Complete missing result"));
    expect(cellAction).toBeTruthy();
    await act(async () => {
      cellAction!.click();
      await flush();
    });
    await settle();

    // Shared dialog renders on document.body with the planner cost preview.
    expect(document.body.textContent).toContain("Complete missing result");
    const preview = document.body.querySelector("[data-cost-preview]");
    expect(preview?.textContent).toContain("1 candidate call + 1 Judge call across 1 task.");
    expect(preview?.textContent).toContain("1 candidate output will be reused.");

    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm!.click();
      await flush();
    });
    await settle();

    expect(controller.repairMissingCells).toHaveBeenCalledWith("exp-rep", {
      taskId: "t2",
      modelKeys: [MK_PROVISIONAL],
    });
    cleanup(h);
  });

  it("shows Retry incomplete task on a non-repairable cell and confirms through the full-roster fallback", async () => {
    stubDesktop();
    const { experiment, runs } = makeRepairableExperiment();
    const controller = makeController();
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    await settle();

    const cellActions = h.$$("button").filter((b) => b.textContent?.includes("Retry incomplete task"));
    expect(cellActions.length).toBeGreaterThan(0);
    await act(async () => {
      cellActions[0].click();
      await flush();
    });
    await settle();

    expect(document.body.textContent).toContain("Retry incomplete task");
    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    expect(confirm?.textContent).toBe("Retry task");
    await act(async () => {
      confirm!.click();
      await flush();
    });
    await settle();

    expect(controller.retryIncomplete).toHaveBeenCalledWith("exp-rep");
    cleanup(h);
  });

  it("toolbar reports repairable and fallback counts and offers Repair all missing results", async () => {
    stubDesktop();
    const { experiment, runs } = makeRepairableExperiment();
    const controller = makeController();
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    await settle();

    const toolbar = h.$('[aria-label="Recovery"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.textContent).toContain("3 missing results — 1 repairable, 2 need a full task retry.");
    const repairAll = h.$$("button").find((b) => b.textContent?.includes("Repair all missing results"));
    expect(repairAll).toBeTruthy();
    await act(async () => {
      repairAll!.click();
      await flush();
    });
    await settle();

    const preview = document.body.querySelector("[data-cost-preview]");
    expect(preview?.textContent).toContain("1 candidate call + 1 Judge call across 1 task.");
    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    await act(async () => {
      confirm!.click();
      await flush();
    });
    await settle();
    expect(controller.repairMissingCells).toHaveBeenCalledWith("exp-rep", {
      taskId: "t2",
      modelKeys: [MK_PROVISIONAL],
    });
    cleanup(h);
  });

  it("groups repairable keys per task: one controller call with all keys and an honest preview", async () => {
    stubDesktop();
    const MK_EXTRA = "openrouter:claude";
    const SLOTS3: ModelSlot[] = [
      ...SLOTS,
      { id: "s3", providerId: "openrouter", provider: "OpenRouter", model: "Claude", slug: "claude", enabled: true },
    ];
    const snapshot: ExperimentSnapshot = {
      ...makeSnapshot(["t1", "t2"]),
      modelSlots: SLOTS3,
    };
    const runT1 = makeExperimentRun(
      "run-t1",
      { [MK_COMPLETE]: 4.1, [MK_PROVISIONAL]: 4.2, [MK_EXTRA]: 4.0 },
      "t1",
      "exp-group",
    );
    const runT2 = makeExperimentRun("run-t2", { [MK_COMPLETE]: 4.2 }, "t2", "exp-group");
    const runs: Record<string, RunRecordV2> = { "run-t1": runT1, "run-t2": runT2 };
    const experiment: ExperimentRecord = {
      id: "exp-group",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      execution: null,
      snapshot,
      tasks: [makeTaskState("t1", "run-t1"), makeTaskState("t2", "run-t2", "partial")],
      status: "completed_with_failures",
      revision: 1,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const controller = makeController();
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    await settle();

    const repairAll = h.$$("button").find((b) => b.textContent?.includes("Repair all missing results"));
    expect(repairAll).toBeTruthy();
    await act(async () => {
      repairAll!.click();
      await flush();
    });
    await settle();

    // Grouped preview: both missing keys are one task plan — 2 candidate calls,
    // one Judge call, the scored third model reused once.
    const preview = document.body.querySelector("[data-cost-preview]");
    expect(preview?.textContent).toContain("2 candidate calls + 1 Judge call across 1 task.");
    expect(preview?.textContent).toContain("1 candidate output will be reused.");

    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    await act(async () => {
      confirm!.click();
      await flush();
    });
    await settle();

    // Exactly ONE controller call for the task, carrying BOTH missing keys.
    expect(controller.repairMissingCells).toHaveBeenCalledTimes(1);
    expect(controller.repairMissingCells).toHaveBeenCalledWith("exp-group", {
      taskId: "t2",
      modelKeys: [MK_PROVISIONAL, MK_EXTRA],
    });
    cleanup(h);
  });

  it("recovery actions are absent while another execution owns the lease", async () => {
    stubDesktop();
    const { experiment, runs } = makeRepairableExperiment();
    // Another owner: the experiment is currently running.
    const running: ExperimentRecord = { ...experiment, status: "running" };
    const h = renderWithRouter(
      <ExperimentResults experiment={running} resolveRunRecord={async (id) => runs[id] ?? null} controller={makeController()} />,
    );
    await settle();
    await settle();
    expect(h.$$("button").find((b) => b.textContent?.includes("Complete missing result"))).toBeUndefined();
    expect(h.$$("button").find((b) => b.textContent?.includes("Retry incomplete task"))).toBeUndefined();
    expect(h.$('[aria-label="Recovery"]')).toBeNull();
    cleanup(h);

    // No controller at all: same absence.
    const h2 = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} />,
    );
    await settle();
    await settle();
    expect(h2.$$("button").find((b) => b.textContent?.includes("Complete missing result"))).toBeUndefined();
    expect(h2.$$("button").find((b) => b.textContent?.includes("Retry incomplete task"))).toBeUndefined();
    expect(h2.$('[aria-label="Recovery"]')).toBeNull();
    cleanup(h2);
  });

  it("operation result appears visibly after a repair starts", async () => {
    stubDesktop();
    const { experiment, runs } = makeRepairableExperiment();
    const controller = makeController();
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    await settle();

    const cellAction = h.$$("button").find((b) => b.textContent?.includes("Complete missing result"))!;
    await act(async () => {
      cellAction.click();
      await flush();
    });
    await settle();
    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    await act(async () => {
      confirm!.click();
      await flush();
    });
    await settle();

    // Dialog closed; the toolbar surfaces a live alert with the outcome.
    expect(document.body.querySelector("[data-recovery-confirm]")).toBeNull();
    const alert = h.$("[role='alert']");
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toContain("Repair started");
    cleanup(h);
  });

  it("focus returns to the triggering cell after cancel", async () => {
    stubDesktop();
    const { experiment, runs } = makeRepairableExperiment();
    const controller = makeController();
    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={async (id) => runs[id] ?? null} controller={controller} />,
    );
    await settle();
    await settle();

    const cellAction = h.$$("button").find((b) => b.textContent?.includes("Complete missing result"))!;
    cellAction.focus();
    await act(async () => {
      cellAction.click();
      await flush();
    });
    await settle();
    const cancel = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    expect(cancel).not.toBeUndefined();
    await act(async () => {
      cancel!.click();
      await flush();
    });
    await settle();
    expect(document.activeElement).toBe(cellAction);
    cleanup(h);
  });

  it("a repaired cell disappears from current coverage issues after the selected attempt changes, while its old failure stays in history", async () => {
    const runOld = makeRun("run-old", { [MK_COMPLETE]: 4.0 });
    const runNew = makeRun("run-new", { [MK_COMPLETE]: 4.0, [MK_PROVISIONAL]: 4.3 });
    const taskId = "t2";
    const base = {
      id: "exp-rep2",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      execution: null,
      snapshot: makeSnapshot([taskId]),
      status: "completed_with_failures" as const,
      createdAt: 1000,
      updatedAt: 2000,
    };

    // Before the repair: the old failed attempt is selected; 9router has no score.
    const before: ExperimentRecord = {
      ...base,
      revision: 1,
      tasks: [
        {
          taskId,
          selectedAttemptId: "att-old",
          attempts: [
            { id: "att-old", runId: "run-old", trial: 0, status: "failed", startedAt: 100, finishedAt: 200, error: null },
          ],
        },
      ],
    };
    const h1 = renderWithRouter(
      <ExperimentResults experiment={before} resolveRunRecord={async (id) => (id === "run-old" ? runOld : null)} />,
    );
    await settle();
    await settle();
    const issues1 = h1.$('[data-testid="coverage-issues"]');
    expect(issues1?.textContent).toContain("Task t2");
    expect(issues1?.textContent).toContain(MK_PROVISIONAL);
    expect(issues1?.textContent).toContain("No score");
    cleanup(h1);

    // After the repair: the new completed attempt is selected; the cell is scored
    // and disappears from current issues — but the old failure stays in history.
    const after: ExperimentRecord = {
      ...base,
      revision: 2,
      tasks: [
        {
          taskId,
          selectedAttemptId: "att-new",
          attempts: [
            { id: "att-old", runId: "run-old", trial: 0, status: "failed", startedAt: 100, finishedAt: 200, error: null },
            { id: "att-new", runId: "run-new", trial: 1, status: "completed", startedAt: 300, finishedAt: 400, error: null },
          ],
        },
      ],
    };
    const h2 = renderWithRouter(
      <ExperimentResults
        experiment={after}
        resolveRunRecord={async (id) => (id === "run-old" ? runOld : id === "run-new" ? runNew : null)}
      />,
    );
    await settle();
    await settle();
    expect(h2.$('[data-testid="coverage-issues"]')).toBeNull();
    const history = h2.$('[data-testid="attempt-history"]');
    expect(history).not.toBeNull();
    expect(history?.textContent).toContain("Task t2");
    const oldRunLink = h2.$$("a").find((a) => a.getAttribute("href") === "/runs/run-old");
    expect(oldRunLink).not.toBeUndefined();
    // Historical failures live ONLY inside the collapsed disclosure — the old
    // default-visible list must not resurface them twice.
    expect(h2.container.textContent).not.toContain("Failed &amp; incomplete attempts");
    expect(h2.container.textContent).not.toContain("Failed & incomplete attempts");
    cleanup(h2);
  });
});
