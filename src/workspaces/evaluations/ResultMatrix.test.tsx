// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { ResultMatrix, cellEvidenceLink } from "./ResultMatrix";
import { ExperimentResults } from "./ExperimentResults";
import type {
  CellState,
  ExperimentAggregation,
  MissingReason,
} from "../../lib/evaluations/experiment-aggregation";
import type { CompoundRepairPlan } from "../../lib/evaluations/experiment-repair";
import type {
  EvaluationTask,
  ExperimentRecord,
} from "../../lib/evaluations/evaluation-types";
import type {
  PersistedCandidate,
  RunRecordV2,
} from "../../lib/persistence/run-types";
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

function renderWithRouter(node: ReactNode, initialEntries: string[] = ["/"]): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter initialEntries={initialEntries}>{node}</MemoryRouter>);
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
  vi.unstubAllGlobals();
});

// --- Fixtures -----------------------------------------------------------------

const KEY_A = "gemini:gemini-3-pro-preview";
const KEY_B = "openrouter:anthropic/claude-4.5-sonnet";
const KEY_C = "umans:umans-kimi-k3";

const SLOTS: ModelSlot[] = [
  { id: "slot-a", providerId: "gemini", provider: "Gemini", model: "Gemini 3 Pro", slug: "gemini-3-pro-preview", enabled: true },
  { id: "slot-b", providerId: "openrouter", provider: "OpenRouter", model: "Claude 4.5 Sonnet", slug: "anthropic/claude-4.5-sonnet", enabled: true },
  { id: "slot-c", providerId: "umans", provider: "Umans", model: "Kimi K3", slug: "umans-kimi-k3", enabled: true },
];

const TASKS: EvaluationTask[] = [
  { id: "t1", title: "Task 1: Summarize", prompt: "p1", systemPrompt: "", evaluation: { kind: "inherit" }, judgeInstructionOverride: "", order: 0 },
  { id: "t2", title: "Task 2: Classify", prompt: "p2", systemPrompt: "", evaluation: { kind: "inherit" }, judgeInstructionOverride: "", order: 1 },
  { id: "t3", title: "Task 3: Rewrite", prompt: "p3", systemPrompt: "", evaluation: { kind: "inherit" }, judgeInstructionOverride: "", order: 2 },
];

function scored(score: number, runId: string): CellState {
  return { kind: "scored", score, runId, attemptId: `att-${runId}` };
}

function missing(reason: MissingReason, runId: string | null): CellState {
  return { kind: "missing", reason, runId, attemptId: runId ? `att-${runId}` : null };
}

/** Base: A wins outright (complete), B complete but lower, C incomplete. */
const BASE: ExperimentAggregation = {
  taskIds: ["t1", "t2", "t3"],
  modelKeys: [KEY_A, KEY_B, KEY_C],
  cells: [
    [scored(5, "run-1"), scored(4, "run-1"), scored(4, "run-1")],
    [scored(4, "run-2"), scored(4, "run-2"), missing("no-score", "run-2")],
    [scored(4, "run-3"), scored(4, "run-3"), missing("no-accepted-attempt", null)],
  ],
  models: [
    { modelKey: KEY_A, mean: 13 / 3, scoredTasks: 3, totalTasks: 3, complete: true },
    { modelKey: KEY_B, mean: 4, scoredTasks: 3, totalTasks: 3, complete: true },
    { modelKey: KEY_C, mean: 4, scoredTasks: 1, totalTasks: 3, complete: false },
  ],
  winnerKeys: [KEY_A],
};

/** Tied: A and B share the win; both must be marked. */
const TIED: ExperimentAggregation = {
  ...BASE,
  models: [
    { modelKey: KEY_A, mean: 4, scoredTasks: 3, totalTasks: 3, complete: true },
    { modelKey: KEY_B, mean: 4, scoredTasks: 3, totalTasks: 3, complete: true },
    { modelKey: KEY_C, mean: 4, scoredTasks: 1, totalTasks: 3, complete: false },
  ],
  winnerKeys: [KEY_A, KEY_B],
};

/** No complete-coverage winner: nobody finished every task. */
const NO_WINNER: ExperimentAggregation = {
  taskIds: ["t1", "t2", "t3"],
  modelKeys: [KEY_A, KEY_B, KEY_C],
  cells: [
    [scored(5, "run-1"), scored(4, "run-1"), missing("no-score", "run-1")],
    [scored(4, "run-2"), scored(4, "run-2"), missing("evidence-missing", "run-2")],
    [missing("no-attempt", null), missing("no-attempt", null), missing("no-attempt", null)],
  ],
  models: [
    { modelKey: KEY_A, mean: 4.5, scoredTasks: 2, totalTasks: 3, complete: false },
    { modelKey: KEY_B, mean: 4, scoredTasks: 2, totalTasks: 3, complete: false },
    { modelKey: KEY_C, mean: null, scoredTasks: 0, totalTasks: 3, complete: false },
  ],
  winnerKeys: [],
};

function makeCandidate(candidateId: string, modelKey: string): PersistedCandidate {
  const [providerId, slug] = [modelKey.slice(0, modelKey.indexOf(":")), modelKey.slice(modelKey.indexOf(":") + 1)];
  return {
    candidateId,
    slotId: `slot-${candidateId}`,
    modelKey,
    providerId,
    model: modelKey,
    slug,
    acceptedAttemptId: `catt-${candidateId}`,
    attempts: [],
  };
}

function makeRunRecord(
  runId: string,
  overrides: { acceptedAttemptId?: string | null; candidates?: PersistedCandidate[] } = {},
): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: runId,
    revision: 1,
    execution: { ownerId: "owner-1", fence: 1 },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    completedAt: 1700000001000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Task", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: overrides.candidates ?? [
      makeCandidate("cand-x", KEY_A),
      makeCandidate("cand-y", KEY_B),
    ],
    judge: {
      status: "done",
      acceptedAttemptId: overrides.acceptedAttemptId === undefined ? "jatt-1" : overrides.acceptedAttemptId,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function defaultRecords(): ReadonlyMap<string, RunRecordV2> {
  return new Map([
    ["run-1", makeRunRecord("run-1")],
    ["run-2", makeRunRecord("run-2")],
    ["run-3", makeRunRecord("run-3")],
  ]);
}

function renderMatrix(
  aggregation: ExperimentAggregation = BASE,
  runRecords: ReadonlyMap<string, RunRecordV2> = defaultRecords(),
): Harness {
  return renderWithRouter(
    <ResultMatrix aggregation={aggregation} tasks={TASKS} modelSlots={SLOTS} runRecords={runRecords} />,
  );
}

function tdCells(row: HTMLElement): HTMLElement[] {
  return [...row.children].filter((c): c is HTMLElement => c.tagName === "TD");
}

// --- 1. Table semantics ---------------------------------------------------------

describe("ResultMatrix — table semantics (plan 7.2 #1, #8)", () => {
  it("renders a real table with caption and scoped headers", () => {
    const h = renderMatrix();
    const table = h.$("table");
    expect(table).not.toBeNull();
    const caption = table!.querySelector("caption");
    expect(caption?.textContent).toContain("task scores by model");
    // corner + one scope=col per model
    expect(h.$$('thead th[scope="col"]')).toHaveLength(SLOTS.length + 1);
    // one scope=row per task + two labeled footer rows (mean score, coverage)
    expect(h.$$('tbody th[scope="row"]')).toHaveLength(TASKS.length);
    expect(h.$$('tfoot th[scope="row"]')).toHaveLength(2);
    cleanup(h);
  });

  it("keeps sticky header classes on th without breaking scope semantics", () => {
    const h = renderMatrix();
    for (const th of h.$$('thead th[scope="col"]')) {
      expect(th.className).toContain("sticky");
      expect(th.className).toContain("top-0");
      expect(th.className).toContain("bg-panel");
      expect(th.getAttribute("scope")).toBe("col");
    }
    cleanup(h);
  });
});

// --- 2. Row/column ordering ------------------------------------------------------

describe("ResultMatrix — ordering (plan 7.2 #2)", () => {
  it("renders tasks as rows and provider-scoped models as columns, in order", () => {
    const h = renderMatrix();
    const rowHeaders = h.$$('tbody th[scope="row"]');
    expect(rowHeaders.map((th) => th.textContent)).toEqual([
      "Task 1: Summarize",
      "Task 2: Classify",
      "Task 3: Rewrite",
    ]);
    const colHeaders = h.$$('thead th[scope="col"]');
    const fullIds = colHeaders
      .map((th) => th.querySelector("[data-full-id]")?.getAttribute("data-full-id") ?? null)
      .filter((id) => id !== null);
    expect(fullIds).toEqual([KEY_A, KEY_B, KEY_C]);
    cleanup(h);
  });
});

// --- 3. Cell content --------------------------------------------------------------

describe("ResultMatrix — cell content (plan 7.2 #3, #10)", () => {
  it("shows formatted scores and explicit missing text + StatusMark, never a bare dash", () => {
    const h = renderMatrix();
    const rows = h.$$("tbody tr");
    expect(tdCells(rows[0])[0].textContent).toContain("5.0");
    expect(tdCells(rows[1])[2].textContent).toContain("No score");
    expect(tdCells(rows[1])[2].querySelector("[data-status-mark]")).not.toBeNull();
    expect(tdCells(rows[2])[2].textContent).toContain("No accepted attempt");
    expect(tdCells(rows[2])[2].querySelector("[data-status-mark]")).not.toBeNull();
    for (const td of h.$$("td")) {
      expect(td.textContent?.trim()).not.toBe("—");
    }
    cleanup(h);
  });

  it("labels every missing reason truthfully", () => {
    const h = renderMatrix(NO_WINNER);
    expect(h.container.textContent).toContain("Not run");
    expect(h.container.textContent).toContain("Evidence unavailable");
    expect(h.container.textContent).toContain("No score");
    for (const td of h.$$("td")) {
      expect(td.textContent?.trim()).not.toBe("—");
    }
    cleanup(h);
  });

  it("uses neutral tabular numerals with no score-magnitude color classes", () => {
    const h = renderMatrix();
    const rows = h.$$("tbody tr");
    const scoredLink = tdCells(rows[0])[0].querySelector("a");
    expect(scoredLink).not.toBeNull();
    expect(scoredLink!.className).toContain("tabular-nums");
    expect(scoredLink!.className).toContain("text-text");
    expect(scoredLink!.className).not.toContain("text-success");
    expect(scoredLink!.className).not.toContain("text-error");
    cleanup(h);
  });
});

// --- 4. Evidence links --------------------------------------------------------------

describe("ResultMatrix — evidence links (plan 7.2 #4)", () => {
  it("links scored cells to the immutable candidate + judge attempt deep link", () => {
    const h = renderMatrix();
    const rows = h.$$("tbody tr");
    const link = tdCells(rows[0])[0].querySelector("a");
    expect(link?.getAttribute("href")).toBe("/runs/run-1?candidate=cand-x&attempt=jatt-1");
    cleanup(h);
  });

  it("links task row headers to the task run evidence", () => {
    const h = renderMatrix();
    const rowHeaders = h.$$('tbody th[scope="row"]');
    expect(rowHeaders[0].querySelector("a")?.getAttribute("href")).toBe("/runs/run-1");
    expect(rowHeaders[1].querySelector("a")?.getAttribute("href")).toBe("/runs/run-2");
    cleanup(h);
  });

  it("cellEvidenceLink builds the full deep link for a scored cell", () => {
    const cell = scored(5, "run-1");
    expect(cellEvidenceLink(cell, KEY_A, makeRunRecord("run-1"))).toBe(
      "/runs/run-1?candidate=cand-x&attempt=jatt-1",
    );
  });

  it("cellEvidenceLink falls back to the run link when candidate or judge attempt is missing", () => {
    const cell = scored(5, "run-1");
    // no candidate for this modelKey
    expect(cellEvidenceLink(cell, KEY_C, makeRunRecord("run-1"))).toBe("/runs/run-1");
    // no accepted judge attempt
    expect(cellEvidenceLink(cell, KEY_A, makeRunRecord("run-1", { acceptedAttemptId: null }))).toBe("/runs/run-1");
    // record unavailable
    expect(cellEvidenceLink(cell, KEY_A, undefined)).toBe("/runs/run-1");
  });

  it("cellEvidenceLink links missing cells to the run when a runId exists, else null", () => {
    expect(cellEvidenceLink(missing("no-score", "run-2"), KEY_C, undefined)).toBe("/runs/run-2");
    expect(cellEvidenceLink(missing("no-attempt", null), KEY_C, undefined)).toBeNull();
  });
});

// --- 5. Footer aggregation ------------------------------------------------------------

describe("ResultMatrix — footer (plan 7.2 #5)", () => {
  it("shows formatted means with coverage per model", () => {
    const h = renderMatrix();
    const tfoot = h.$("tfoot");
    // Mean score and coverage are separate, explicitly labeled rows — never a
    // cryptic "4.33 · 3/3" composite.
    expect(tfoot?.textContent).toContain("Mean score");
    expect(tfoot?.textContent).toContain("Coverage");
    expect(tfoot?.textContent).toContain("4.33");
    expect(tfoot?.textContent).toContain("4.00");
    expect(tfoot?.textContent).toContain("3/3 tasks");
    expect(tfoot?.textContent).toContain("1/3 tasks");
    expect(tfoot?.textContent).not.toContain("· 3/3");
    cleanup(h);
  });

  it("shows No scores for models without any scored task", () => {
    const h = renderMatrix(NO_WINNER);
    expect(h.$("tfoot")?.textContent).toContain("No scores");
    cleanup(h);
  });
});

// --- 6/7/11. Winner treatment ----------------------------------------------------------

describe("ResultMatrix — winner treatment (plan 7.2 #6, #7, #11)", () => {
  it("marks only the complete-coverage winner column header and footer", () => {
    const h = renderMatrix();
    const colHeaders = h.$$('thead th[scope="col"]');
    expect(colHeaders[1].className).toContain("ring-success/40");
    expect(colHeaders[1].textContent).toContain("Winner");
    expect(colHeaders[2].className).not.toContain("ring-success/40");
    expect(colHeaders[2].textContent).not.toContain("Winner");
    expect(colHeaders[3].className).not.toContain("ring-success/40");
    const footerCells = h.$$("tfoot td");
    expect(footerCells[0].className).toContain("ring-success/40");
    expect(footerCells[1].className).not.toContain("ring-success/40");
    expect(footerCells[2].className).not.toContain("ring-success/40");
    cleanup(h);
  });

  it("marks every tied winner — headers and footers", () => {
    const h = renderMatrix(TIED);
    const colHeaders = h.$$('thead th[scope="col"]');
    expect(colHeaders[1].className).toContain("ring-success/40");
    expect(colHeaders[1].textContent).toContain("Winner");
    expect(colHeaders[2].className).toContain("ring-success/40");
    expect(colHeaders[2].textContent).toContain("Winner");
    expect(colHeaders[3].className).not.toContain("ring-success/40");
    // Two tied winners × two footer rows (mean + coverage) = 4 marked cells.
    const markedFooters = h.$$("tfoot td").filter((td) => td.className.includes("ring-success/40"));
    expect(markedFooters).toHaveLength(4);
    cleanup(h);
  });

  it("shows truthful No complete-coverage winner copy when no model is complete", () => {
    const h = renderMatrix(NO_WINNER);
    expect(h.container.textContent).toContain("No complete-coverage winner");
    expect(h.$$('thead th[scope="col"]').some((th) => th.className.includes("ring-success/40"))).toBe(false);
    cleanup(h);
  });

  it("does not show the no-winner copy when a winner exists", () => {
    const h = renderMatrix();
    expect(h.container.textContent).not.toContain("No complete-coverage winner");
    cleanup(h);
  });
});

// --- 9. Compact model identity ------------------------------------------------------------

describe("ResultMatrix — per-row best marker", () => {
  it("marks the best cell per row with a bold ▲, all ties marked", () => {
    const h = renderMatrix();
    const rows = h.$$("tbody tr");
    const mark = (td: HTMLElement) => td.querySelector('[aria-label="best in row"]') !== null;
    // Row 0: only column A (5.0) is best.
    expect(tdCells(rows[0]).map(mark)).toEqual([true, false, false]);
    // Rows 1 and 2: A and B tie at 4.0 — both marked, C (missing) never marked.
    expect(tdCells(rows[1]).map(mark)).toEqual([true, true, false]);
    expect(tdCells(rows[2]).map(mark)).toEqual([true, true, false]);
    cleanup(h);
  });
});

describe("ResultMatrix — model identity (plan 7.2 #9)", () => {
  it("renders CompactModelLabel with full identity available without hover", () => {
    const h = renderMatrix();
    const colHeaders = h.$$('thead th[scope="col"]');
    const aHeader = colHeaders[1];
    expect(aHeader.querySelector("[data-full-id]")?.getAttribute("data-full-id")).toBe(KEY_A);
    const disclosure = aHeader.querySelector("[data-full-id-disclosure]");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.getAttribute("aria-label")).toContain(KEY_A);
    cleanup(h);
  });
});

// --- 12. Scroll region ----------------------------------------------------------------

describe("ResultMatrix — scroll region (plan 7.2 #12)", () => {
  it("exposes a focusable, outlined, page-safe scroll region", () => {
    const h = renderMatrix();
    const region = h.$('[role="region"]');
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-label")).toBe("Result matrix — scrollable");
    expect(region!.tabIndex).toBe(0);
    expect(region!.className).toContain("overflow-x-auto");
    expect(region!.className).toContain("max-w-full");
    expect(region!.className).toContain("focus-visible:outline-none");
    expect(region!.className).toContain("focus-visible:ring-2");
    expect(region!.className).toContain("focus-visible:ring-accent");
    // persistent outline while focused, not only focus-visible
    expect(region!.className).toContain("focus:ring-2");
    cleanup(h);
  });
});

// --- 14. Recovery actions (spec §11.1) --------------------------------------------------

describe("ResultMatrix — recovery actions (spec §11.1)", () => {
  const PLAN_C: CompoundRepairPlan = {
    taskId: "t2",
    baseRunId: "run-2",
    requestedModelKeys: [KEY_C],
    reusedModelKeys: [KEY_A, KEY_B],
    candidateCalls: 1,
    judgeCalls: 1,
  };
  const REPAIRABLE = new Map([["t2", new Map([[KEY_C, PLAN_C]])]]);

  function renderWithRecovery(
    repairablePlans: ReadonlyMap<string, ReadonlyMap<string, CompoundRepairPlan>> = REPAIRABLE,
    onRepairRequest: ((taskId: string, modelKey: string) => void) | undefined = vi.fn(),
  ): Harness {
    return renderWithRouter(
      <ResultMatrix
        aggregation={BASE}
        tasks={TASKS}
        modelSlots={SLOTS}
        runRecords={defaultRecords()}
        repairablePlans={repairablePlans}
        onRepairRequest={onRepairRequest}
      />,
    );
  }

  it("shows Complete missing result on a repairable no-score cell", () => {
    const h = renderWithRecovery();
    const rows = h.$$("tbody tr");
    const cell = tdCells(rows[1])[2];
    const action = cell.querySelector("button");
    expect(action).not.toBeNull();
    expect(action?.textContent).toContain("Complete missing result");
    cleanup(h);
  });

  it("shows Retry incomplete task on a non-repairable missing cell", () => {
    const h = renderWithRecovery();
    const rows = h.$$("tbody tr");
    const cell = tdCells(rows[2])[2]; // no-accepted-attempt, no run
    const action = cell.querySelector("button");
    expect(action).not.toBeNull();
    expect(action?.textContent).toContain("Retry incomplete task");
    cleanup(h);
  });

  it("clicking a cell action reports the exact task and model key", () => {
    const onRepairRequest = vi.fn();
    const h = renderWithRecovery(REPAIRABLE, onRepairRequest);
    const rows = h.$$("tbody tr");
    const action = tdCells(rows[1])[2].querySelector("button") as HTMLButtonElement;
    act(() => action.click());
    expect(onRepairRequest).toHaveBeenCalledWith("t2", KEY_C);
    // fallback cell reports its task too
    const fallback = tdCells(rows[2])[2].querySelector("button") as HTMLButtonElement;
    act(() => fallback.click());
    expect(onRepairRequest).toHaveBeenCalledWith("t3", KEY_C);
    cleanup(h);
  });

  it("keeps one action control and one evidence link, never nested", () => {
    const h = renderWithRecovery();
    const rows = h.$$("tbody tr");
    const cell = tdCells(rows[1])[2]; // no-score with run-2 evidence
    expect(cell.querySelector("button")).not.toBeNull();
    expect(cell.querySelector("a")?.getAttribute("href")).toBe("/runs/run-2");
    // No nested interactive elements: button not inside a link, link not inside a button.
    expect(cell.querySelector("a button")).toBeNull();
    expect(cell.querySelector("button a")).toBeNull();
    cleanup(h);
  });

  it("renders no action buttons when no recovery handler is wired", () => {
    const h = renderMatrix();
    expect(h.$$("tbody button")).toHaveLength(0);
    cleanup(h);
  });

  it("keeps 44px action targets with keyboard focus-visible rings", () => {
    const h = renderWithRecovery();
    const rows = h.$$("tbody tr");
    const action = tdCells(rows[1])[2].querySelector("button") as HTMLButtonElement;
    expect(action.className).toContain("min-h-[44px]");
    expect(action.className).toContain("focus-visible:ring-2");
    expect(action.className).toContain("focus-visible:ring-accent");
    cleanup(h);
  });
});

// --- 13. Failed task-attempt summary (ExperimentResults) ------------------------------

function makeExperiment(): ExperimentRecord {
  return {
    id: "exp-1",
    revision: 3,
    suiteId: "suite-1",
    suiteVersion: 2,
    protocolFingerprint: "fp",
    status: "completed_with_failures",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 2,
      tasks: TASKS,
      modelSlots: SLOTS,
      defaultJudge: { providerId: "gemini", model: "gemini-3-pro-preview" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "fp",
      createdAt: 1700000000000,
    },
    tasks: [
      {
        taskId: "t1",
        selectedAttemptId: "att-1",
        attempts: [
          { id: "att-1", runId: "run-1", trial: 1, status: "completed", startedAt: 1, finishedAt: 2, error: null },
        ],
      },
      {
        taskId: "t2",
        selectedAttemptId: null,
        attempts: [
          { id: "att-f1", runId: "run-f1", trial: 1, status: "failed", startedAt: 1, finishedAt: 2, error: { message: "Judge error" } },
        ],
      },
      {
        taskId: "t3",
        selectedAttemptId: "att-3",
        attempts: [
          { id: "att-3", runId: "run-3", trial: 1, status: "completed", startedAt: 1, finishedAt: 2, error: null },
        ],
      },
    ],
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
  };
}

describe("ExperimentResults — summary (plan 7.2 #13)", () => {
  it("lists non-completed task attempts with status and run links", async () => {
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
    const records = defaultRecords();
    const h = renderWithRouter(
      <ExperimentResults
        experiment={makeExperiment()}
        resolveRunRecord={async (runId: string) => records.get(runId) ?? null}
      />,
      ["/experiments/exp-1"],
    );
    await settle();
    await settle();

    // failed attempt summary: task title, status cue, and a link to its run
    expect(h.container.textContent).toContain("Task 2: Classify");
    const runLink = h.$$("a").find((a) => a.getAttribute("href") === "/runs/run-f1");
    expect(runLink).not.toBeUndefined();
    // summary chrome
    expect(h.container.textContent).toContain("Suite v2");
    const backLink = h.$$("a").find((a) => a.getAttribute("href") === "/evaluations/suite-1");
    expect(backLink).not.toBeUndefined();
    cleanup(h);
  });
});

describe("ResultMatrix — large-suite paging and sticky context (Task 14)", () => {
  function bigAggregation(taskCount: number): ExperimentAggregation {
    const taskIds = Array.from({ length: taskCount }, (_, i) => `t${i + 1}`);
    return {
      taskIds,
      modelKeys: BASE.modelKeys,
      cells: taskIds.map((_id, i) => [
        scored(4, `run-${i}`),
        scored(3, `run-${i}`),
        missing("no-score", `run-${i}`),
      ]),
      models: BASE.models,
      winnerKeys: BASE.winnerKeys,
    };
  }

  const BIG_TASKS: EvaluationTask[] = Array.from({ length: 250 }, (_, i) => ({
    id: `t${i + 1}`,
    title: `Task ${i + 1}${i === 249 ? ": a very long title that should not change row geometry" : ""}`,
    prompt: `p${i + 1}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: i,
  }));

  function bigRecords(): ReadonlyMap<string, RunRecordV2> {
    const map = new Map<string, RunRecordV2>();
    for (let i = 0; i < 250; i++) map.set(`run-${i}`, makeRunRecord(`run-${i}`));
    return map;
  }

  it("mounts exactly 50 task rows on page one of 250", () => {
    const h = renderWithRouter(
      <ResultMatrix
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={SLOTS}
        runRecords={bigRecords()}
      />,
    );
    // One row per task in <tbody>.
    const rows = h.$$("tbody tr");
    expect(rows).toHaveLength(50);
    cleanup(h);
  });

  it("shows pagination with range text 1–50 of 250", () => {
    const h = renderWithRouter(
      <ResultMatrix
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={SLOTS}
        runRecords={bigRecords()}
      />,
    );
    const text = h.container.textContent ?? "";
    expect(text).toContain("1–50 of 250");
    cleanup(h);
  });

  it("pages to the next 50 rows via the Next button", () => {
    const h = renderWithRouter(
      <ResultMatrix
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={SLOTS}
        runRecords={bigRecords()}
      />,
    );
    const next = h.$$("button").find((b) => b.getAttribute("aria-label") === "Next page")!;
    act(() => next.click());
    expect(h.$$("tbody tr")).toHaveLength(50);
    const text = h.container.textContent ?? "";
    expect(text).toContain("51–100 of 250");
    cleanup(h);
  });

  it("clamps out-of-range page safely", () => {
    const h = renderWithRouter(
      <ResultMatrix
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={SLOTS}
        runRecords={bigRecords()}
        initialPage={999}
      />,
    );
    const text = h.container.textContent ?? "";
    // Clamped to the last page: 201–250 of 250.
    expect(text).toContain("201–250 of 250");
    expect(h.$$("tbody tr")).toHaveLength(50);
    cleanup(h);
  });

  it("keeps the first task column sticky-left with an opaque surface", () => {
    const h = renderWithRouter(
      <ResultMatrix
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={SLOTS}
        runRecords={bigRecords()}
      />,
    );
    const header = h.$("thead th");
    const firstRowCell = h.$("tbody tr th");
    const footer = h.$("tfoot th");
    for (const el of [header, firstRowCell, footer]) {
      const cls = el?.getAttribute("class") ?? "";
      expect(cls).toContain("sticky");
      expect(cls).toContain("left-0");
      // Opaque surface so scores never bleed through.
      expect(cls).toMatch(/bg-(panel|card)/);
    }
    cleanup(h);
  });

  it("keeps column headers sticky top and the scroll region keyboard-focusable", () => {
    const h = renderWithRouter(
      <ResultMatrix
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={SLOTS}
        runRecords={bigRecords()}
      />,
    );
    const modelHeader = h.$$("thead th")[1];
    expect((modelHeader?.getAttribute("class") ?? "")).toContain("sticky top-0");
    const region = h.$("[role='region']");
    expect(region?.getAttribute("tabindex")).toBe("0");
    cleanup(h);
  });
});
