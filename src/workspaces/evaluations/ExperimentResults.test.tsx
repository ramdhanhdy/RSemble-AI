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
import type { ModelSlot } from "../../studio-data";

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
  const evaluationsById: Record<string, unknown> = {};
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
    expect(winnerText).toContain("model");
  });

  it("never gives the provisional model a numeric #1 label", async () => {
    const { experiment, runs } = makeWinnerProvisionalExperiment();
    const resolveRun = vi.fn(async (runId: string) => runs[runId] ?? null);

    const h = renderWithRouter(
      <ExperimentResults experiment={experiment} resolveRunRecord={resolveRun} />,
    );
    await settle();

    // The standings section must not label the incomplete 9router:route as #1.
    const standingsSection = h.$('[aria-label="Aggregate scores"]') ?? h.$('[aria-label="Standings"]');
    expect(standingsSection).toBeTruthy();
    const standingsText = standingsSection?.textContent ?? "";

    // The provisional model (9router:route, 4.54 mean) must not appear with #1.
    // Currently the component sorts ALL models by mean and numbers them,
    // so 9router:route gets #1 — this is the bug.
    const rankSpans = standingsSection?.querySelectorAll(".font-mono.text-xs") ?? [];
    const firstRank = rankSpans[0]?.textContent ?? "";
    expect(firstRank).not.toBe("#1");
    // The first ranked entry should be the complete winner, not the provisional leader.
    if (rankSpans.length > 0) {
      const firstRow = rankSpans[0]?.closest("li");
      expect(firstRow?.textContent ?? "").not.toContain("9router");
    }
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
  });
});
