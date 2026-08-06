// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { MobileExperimentResults } from "./MobileExperimentResults";
import type {
  CellState,
  ExperimentAggregation,
  MissingReason,
} from "../../lib/evaluations/experiment-aggregation";
import type { CompoundRepairPlan } from "../../lib/evaluations/experiment-repair";
import type { EvaluationTask } from "../../lib/evaluations/evaluation-types";
import type { PersistedCandidate, RunRecordV2 } from "../../lib/persistence/run-types";
import type { ModelSlot } from "../../studio-data";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
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

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Fixtures -----------------------------------------------------------------

const KEY_A = "gemini:gemini-3-pro-preview";
const KEY_B = "openrouter:anthropic/claude-4.5-sonnet";
const KEY_C = "umans:umans-kimi-k3";

const SLOTS: ModelSlot[] = [
  {
    id: "slot-a",
    providerId: "gemini",
    provider: "Gemini",
    model: "Gemini 3 Pro",
    slug: "gemini-3-pro-preview",
    enabled: true,
  },
  {
    id: "slot-b",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "Claude 4.5 Sonnet",
    slug: "anthropic/claude-4.5-sonnet",
    enabled: true,
  },
  {
    id: "slot-c",
    providerId: "umans",
    provider: "Umans",
    model: "Kimi K3",
    slug: "umans-kimi-k3",
    enabled: true,
  },
];

const TASKS: EvaluationTask[] = [
  {
    id: "t1",
    title: "Task 1: Summarize",
    prompt: "p1",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
  },
  {
    id: "t2",
    title: "Task 2: Classify",
    prompt: "p2",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 1,
  },
  {
    id: "t3",
    title: "Task 3: Rewrite",
    prompt: "p3",
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 2,
  },
];

function scored(score: number, runId: string): CellState {
  return { kind: "scored", score, runId, attemptId: `att-${runId}` };
}

function missing(reason: MissingReason, runId: string | null): CellState {
  return { kind: "missing", reason, runId, attemptId: runId ? `att-${runId}` : null };
}

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

function makeCandidate(candidateId: string, modelKey: string): PersistedCandidate {
  return {
    candidateId,
    slotId: `slot-${candidateId}`,
    modelKey,
    providerId: modelKey.slice(0, modelKey.indexOf(":")),
    model: modelKey,
    slug: modelKey.slice(modelKey.indexOf(":") + 1),
    acceptedAttemptId: `catt-${candidateId}`,
    attempts: [],
  };
}

function makeRunRecord(runId: string): RunRecordV2 {
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
    candidates: [makeCandidate("cand-x", KEY_A), makeCandidate("cand-y", KEY_B)],
    judge: {
      status: "done",
      acceptedAttemptId: "jatt-1",
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

const RECORDS: ReadonlyMap<string, RunRecordV2> = new Map([
  ["run-1", makeRunRecord("run-1")],
  ["run-2", makeRunRecord("run-2")],
  ["run-3", makeRunRecord("run-3")],
]);

function renderMobile(initialEntries: string[] = ["/experiments/exp-1"]): Harness {
  return renderWithRouter(
    <>
      <MobileExperimentResults
        aggregation={BASE}
        tasks={TASKS}
        modelSlots={SLOTS}
        runRecords={RECORDS}
      />
      <LocationProbe />
    </>,
    initialEntries,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-location={`${location.pathname}${location.search}`} />;
}

function switchModel(h: Harness, modelKey: string) {
  const select = h.$("select") as HTMLSelectElement | null;
  expect(select).not.toBeNull();
  act(() => {
    select!.value = modelKey;
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// --- 1. Model selector ----------------------------------------------------------

describe("MobileExperimentResults — model selector (plan 7.3 #1)", () => {
  it("exposes every model with full provider scope in option text", () => {
    const h = renderMobile();
    const select = h.$("select");
    expect(select).not.toBeNull();
    const options = [...select!.querySelectorAll("option")];
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.textContent)).toEqual([KEY_A, KEY_B, KEY_C]);
    // label is associated with the select
    const label = h.$("label");
    expect(label?.getAttribute("for")).toBe(select!.id);
    cleanup(h);
  });
});

// --- 2. Selected model content ----------------------------------------------------

describe("MobileExperimentResults — selected model (plan 7.3 #2)", () => {
  it("shows mean + coverage and one row per task with score or status", () => {
    const h = renderMobile();
    expect(h.container.textContent).toContain("4.33");
    expect(h.container.textContent).toContain("3/3 tasks");
    const rows = h.$$("li");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Task 1: Summarize");
    expect(rows[0].textContent).toContain("5.0");
    cleanup(h);
  });

  it("shows missing status text + StatusMark for cells without a score", () => {
    const h = renderMobile();
    switchModel(h, KEY_C);
    expect(h.container.textContent).toContain("4.00");
    expect(h.container.textContent).toContain("1/3 tasks");
    const rows = h.$$("li");
    expect(rows[1].textContent).toContain("No score");
    expect(rows[1].querySelector("[data-status-mark]")).not.toBeNull();
    expect(rows[2].textContent).toContain("No accepted attempt");
    cleanup(h);
  });
});

// --- 3. Switching is local state ---------------------------------------------------

describe("MobileExperimentResults — local selection (plan 7.3 #3)", () => {
  it("switching models never navigates and preserves experiment state", () => {
    const h = renderMobile(["/experiments/exp-1"]);
    const probe = h.$("[data-location]");
    expect(probe?.getAttribute("data-location")).toBe("/experiments/exp-1");
    switchModel(h, KEY_B);
    expect(h.$("[data-location]")?.getAttribute("data-location")).toBe("/experiments/exp-1");
    // experiment state intact: model B aggregate now displayed
    expect(h.container.textContent).toContain("4.00");
    expect(h.container.textContent).toContain("3/3 tasks");
    expect(h.$$("li")).toHaveLength(3);
    cleanup(h);
  });
});

// --- 4. Evidence links --------------------------------------------------------------

describe("MobileExperimentResults — evidence links (plan 7.3 #4)", () => {
  it("links scored rows to the candidate + judge attempt deep link", () => {
    const h = renderMobile();
    const rows = h.$$("li");
    expect(rows[0].querySelector("a")?.getAttribute("href")).toBe(
      "/runs/run-1?candidate=cand-x&attempt=jatt-1",
    );
    cleanup(h);
  });

  it("links missing rows to the run when a runId exists, and renders no link otherwise", () => {
    const h = renderMobile();
    switchModel(h, KEY_C);
    const rows = h.$$("li");
    expect(rows[1].querySelector("a")?.getAttribute("href")).toBe("/runs/run-2");
    expect(rows[2].querySelector("a")).toBeNull();
    cleanup(h);
  });
});

// --- 7. Recovery actions (spec §11.1) ---------------------------------------------------

describe("MobileExperimentResults — recovery actions (spec §11.1)", () => {
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
    onRepairRequest: ((taskId: string, modelKey: string) => void) | undefined = vi.fn(),
  ): Harness {
    return renderWithRouter(
      <MobileExperimentResults
        aggregation={BASE}
        tasks={TASKS}
        modelSlots={SLOTS}
        runRecords={RECORDS}
        repairablePlans={REPAIRABLE}
        onRepairRequest={onRepairRequest}
      />,
      ["/experiments/exp-1"],
    );
  }

  it("shows Complete missing result on repairable cells and Retry incomplete task otherwise", () => {
    const h = renderWithRecovery();
    switchModel(h, KEY_C);
    const rows = h.$$("li");
    expect(rows[1].querySelector("button")?.textContent).toContain("Complete missing result");
    expect(rows[2].querySelector("button")?.textContent).toContain("Retry incomplete task");
    cleanup(h);
  });

  it("clicking a cell action reports the exact task and model key", () => {
    const onRepairRequest = vi.fn();
    const h = renderWithRecovery(onRepairRequest);
    switchModel(h, KEY_C);
    const rows = h.$$("li");
    act(() => (rows[1].querySelector("button") as HTMLButtonElement).click());
    expect(onRepairRequest).toHaveBeenCalledWith("t2", KEY_C);
    act(() => (rows[2].querySelector("button") as HTMLButtonElement).click());
    expect(onRepairRequest).toHaveBeenCalledWith("t3", KEY_C);
    cleanup(h);
  });

  it("keeps 44px action targets and never nests links inside buttons", () => {
    const h = renderWithRecovery();
    switchModel(h, KEY_C);
    const rows = h.$$("li");
    const action = rows[1].querySelector("button") as HTMLButtonElement;
    expect(action.className).toContain("min-h-[44px]");
    expect(action.className).toContain("focus-visible:ring-2");
    expect(action.className).toContain("focus-visible:ring-accent");
    expect(rows[1].querySelector("a button")).toBeNull();
    expect(rows[1].querySelector("button a")).toBeNull();
    cleanup(h);
  });

  it("renders no action buttons when no recovery handler is wired", () => {
    const h = renderMobile();
    switchModel(h, KEY_C);
    expect(h.$$("button")).toHaveLength(0);
    cleanup(h);
  });
});

describe("MobileExperimentResults — 390px layout (plan 7.3 #5, #6)", () => {
  it("has no horizontal scrolling and no fixed widths above 390px", () => {
    const h = renderMobile();
    const root = h.container.firstElementChild as HTMLElement;
    expect(root.getAttribute("class") ?? "").not.toMatch(/overflow-x-(auto|scroll)/);
    for (const el of [root, ...root.querySelectorAll<HTMLElement>("[class]")]) {
      const cls = el.getAttribute("class") ?? "";
      const fixedWidths = cls.match(/w-\[(\d+)px\]/g) ?? [];
      for (const w of fixedWidths) {
        const px = Number(w.slice(3, -3));
        expect(px).toBeLessThanOrEqual(390);
      }
    }
    cleanup(h);
  });

  it("reserves bottom navigation clearance on the root", () => {
    const h = renderMobile();
    const root = h.container.firstElementChild as HTMLElement;
    // Choice: the root always reserves the 56px mobile bottom nav + safe-area
    // inset so the surface stays clear of the fixed nav even when mounted
    // outside the app shell's own clearance wrapper.
    expect(root.getAttribute("class") ?? "").toContain(
      "pb-[calc(56px+env(safe-area-inset-bottom))]",
    );
    cleanup(h);
  });
});

describe("MobileExperimentResults — large-suite paging (Task 14)", () => {
  function bigAggregation(taskCount: number): ExperimentAggregation {
    const taskIds = Array.from({ length: taskCount }, (_, i) => `t${i + 1}`);
    return {
      taskIds,
      modelKeys: [KEY_A],
      cells: taskIds.map((_id, i) => [scored(4, `run-${i}`)]),
      models: [
        { modelKey: KEY_A, mean: 4, scoredTasks: taskCount, totalTasks: taskCount, complete: true },
      ],
      winnerKeys: [KEY_A],
    };
  }

  const BIG_TASKS: EvaluationTask[] = Array.from({ length: 250 }, (_, i) => ({
    id: `t${i + 1}`,
    title: `Task ${i + 1}`,
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

  it("mounts 50 cards or fewer on page one of 250", () => {
    const h = renderWithRouter(
      <MobileExperimentResults
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={[SLOTS[0]]}
        runRecords={bigRecords()}
      />,
    );
    const cards = h.$$("li");
    expect(cards.length).toBeLessThanOrEqual(50);
    expect(cards.length).toBeGreaterThan(0);
    cleanup(h);
  });

  it("pages with range text and mounts 50 cards on page two", () => {
    const h = renderWithRouter(
      <MobileExperimentResults
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={[SLOTS[0]]}
        runRecords={bigRecords()}
      />,
    );
    expect(h.container.textContent ?? "").toContain("1–50 of 250");
    const next = h.$$("button").find((b) => b.getAttribute("aria-label") === "Next page")!;
    act(() => next.click());
    expect(h.$$("li")).toHaveLength(50);
    expect(h.container.textContent ?? "").toContain("51–100 of 250");
    cleanup(h);
  });

  it("introduces no page-level horizontal overflow", () => {
    const h = renderWithRouter(
      <MobileExperimentResults
        aggregation={bigAggregation(250)}
        tasks={BIG_TASKS}
        modelSlots={[SLOTS[0]]}
        runRecords={bigRecords()}
      />,
    );
    const root = h.container.firstElementChild as HTMLElement;
    const cls = root.getAttribute("class") ?? "";
    // No class that would force horizontal overflow; the list truncates.
    expect(cls).not.toContain("overflow-x-auto");
    expect(cls).not.toContain("w-screen");
    cleanup(h);
  });
});
