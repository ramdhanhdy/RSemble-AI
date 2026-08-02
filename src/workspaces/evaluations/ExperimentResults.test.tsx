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
  function makeController(retryResult: { ok: boolean; error?: string }) {
    return {
      retryIncomplete: vi.fn(async () => retryResult),
      subscribe: vi.fn(() => () => {}),
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
