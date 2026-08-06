// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type {
  EvaluationTask,
  ExperimentAttemptCoverage,
  ExperimentRecord,
  ExperimentSnapshot,
  ExperimentTaskAttempt,
  ExperimentTaskState,
} from "./evaluation-types";
import {
  PAGE_SIZE,
  buildTaskLedger,
  filterTaskLedgerRows,
  pageTaskLedgerRows,
  searchTaskLedgerRows,
  type TaskLedgerRow,
} from "./experiment-task-ledger";

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

function makeState(
  taskId: string,
  attempts: ExperimentTaskAttempt[],
  selectedAttemptId: string | null = null,
): ExperimentTaskState {
  return { taskId, selectedAttemptId, attempts };
}

function makeExperiment(
  tasks: EvaluationTask[],
  states: ExperimentTaskState[],
  status: ExperimentRecord["status"] = "running",
): ExperimentRecord {
  const now = Date.now();
  const snapshot: ExperimentSnapshot = {
    suiteId: "suite-1",
    suiteVersion: 3,
    tasks,
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
        providerId: "umans",
        provider: "Umans",
        model: "Model2",
        slug: "model2",
        enabled: true,
      },
      {
        id: "s3",
        providerId: "9router",
        provider: "9Router",
        model: "Route",
        slug: "route",
        enabled: true,
      },
      {
        id: "s4",
        providerId: "9router",
        provider: "9Router",
        model: "Route2",
        slug: "route2",
        enabled: true,
      },
      {
        id: "s5",
        providerId: "9router",
        provider: "9Router",
        model: "Route3",
        slug: "route3",
        enabled: true,
      },
      {
        id: "s6",
        providerId: "9router",
        provider: "9Router",
        model: "Route4",
        slug: "route4",
        enabled: true,
      },
      {
        id: "s7",
        providerId: "9router",
        provider: "9Router",
        model: "Route5",
        slug: "route5",
        enabled: true,
      },
      {
        id: "s8",
        providerId: "9router",
        provider: "9Router",
        model: "Route6",
        slug: "route6",
        enabled: true,
      },
    ],
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

const SLOT_COUNT = 8;

// --- Tests ---------------------------------------------------------------------

describe("buildTaskLedger", () => {
  it("derives current attempt and status from the stored selection (Task 8 rules)", () => {
    const now = Date.now();
    const experiment = makeExperiment(
      [makeTask("t1", "Alpha", 0), makeTask("t2", "Beta", 1), makeTask("t3", "Gamma", 2)],
      [
        // Explicit selection wins: completed evidence, newer failed attempt ignored.
        makeState(
          "t1",
          [
            makeAttempt("att-old", "failed", { trial: 1, startedAt: now - 60_000 }),
            makeAttempt("att-good", "completed", {
              trial: 2,
              coverage: makeCoverage(8, 8),
              startedAt: now - 30_000,
            }),
            makeAttempt("att-new", "failed", { trial: 3, startedAt: now - 10_000 }),
          ],
          "att-good",
        ),
        // Running attempt is the live state even without stored selection.
        makeState("t2", [
          makeAttempt("att-run", "running", { runId: "run-2", startedAt: now - 5_000 }),
        ]),
        // No attempts at all → queued, no current attempt.
        makeState("t3", []),
      ],
    );

    const ledger = buildTaskLedger(experiment);
    const [row1, row2, row3] = ledger.rows;
    expect(row1.currentAttemptId).toBe("att-good");
    expect(row1.status).toBe("completed");
    expect(row1.scoredModels).toBe(8);
    expect(row1.totalModels).toBe(8);
    expect(row1.history).toHaveLength(3);

    expect(row2.currentAttemptId).toBe("att-run");
    expect(row2.status).toBe("running");

    expect(row3.currentAttemptId).toBeNull();
    expect(row3.status).toBe("queued");
    expect(row3.history).toHaveLength(0);
  });

  it("prefers a live running retry over preserved selected evidence (engine keeps selection until commit)", () => {
    const now = Date.now();
    // beginTask keeps selectedAttemptId pointing at the prior completed evidence
    // and only recomputes selection at terminal commit (experiment-engine.ts).
    const experiment = makeExperiment(
      [makeTask("t1", "Alpha", 0)],
      [
        makeState(
          "t1",
          [
            makeAttempt("att-original", "completed", {
              trial: 1,
              coverage: makeCoverage(8, 8),
              startedAt: now - 60_000,
            }),
            makeAttempt("att-retry", "running", {
              trial: 2,
              runId: "run-retry",
              startedAt: now - 5_000,
            }),
          ],
          "att-original",
        ),
      ],
    );
    const ledger = buildTaskLedger(experiment);
    const [row] = ledger.rows;
    expect(row.status).toBe("running");
    expect(row.currentAttemptId).toBe("att-retry");
    // A running retry is live work: it must be the current task and the active row.
    expect(ledger.currentTaskId).toBe("t1");
    expect(ledger.currentIndex).toBe(1);
    expect(filterTaskLedgerRows(ledger.rows, "active", "running").map((r) => r.taskId)).toEqual([
      "t1",
    ]);
    expect(ledger.counts.complete).toBe(0);
  });

  it("falls back to selectAttemptId policy, then the newest attempt, for display status", () => {
    const now = Date.now();
    const experiment = makeExperiment(
      [makeTask("t1", "Alpha", 0), makeTask("t2", "Beta", 1)],
      [
        // Highest-coverage partial wins over a lower-coverage newer partial.
        makeState("t1", [
          makeAttempt("att-p1", "partial", {
            coverage: makeCoverage(4, 8),
            startedAt: now - 20_000,
          }),
          makeAttempt("att-p2", "partial", {
            coverage: makeCoverage(6, 8),
            startedAt: now - 10_000,
          }),
        ]),
        // Failed-only task: no selected evidence → newest attempt drives display.
        makeState("t2", [
          makeAttempt("att-f1", "failed", { startedAt: now - 30_000 }),
          makeAttempt("att-f2", "interrupted", { startedAt: now - 10_000 }),
        ]),
      ],
    );

    const ledger = buildTaskLedger(experiment);
    expect(ledger.rows[0].currentAttemptId).toBe("att-p2");
    expect(ledger.rows[0].status).toBe("partial");
    expect(ledger.rows[0].scoredModels).toBe(6);
    expect(ledger.rows[0].totalModels).toBe(8);

    expect(ledger.rows[1].currentAttemptId).toBe("att-f2");
    expect(ledger.rows[1].status).toBe("interrupted");
  });

  it("orders rows by canonical task order, not array order", () => {
    const experiment = makeExperiment(
      [makeTask("t3", "Third", 2), makeTask("t1", "First", 0), makeTask("t2", "Second", 1)],
      [makeState("t2", []), makeState("t1", []), makeState("t3", [])],
    );
    const ledger = buildTaskLedger(experiment);
    expect(ledger.rows.map((r) => r.taskId)).toEqual(["t1", "t2", "t3"]);
    expect(ledger.rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("identifies the running task as current, else the first incomplete task in non-terminal experiments", () => {
    const running = makeExperiment(
      [makeTask("t1", "Alpha", 0), makeTask("t2", "Beta", 1), makeTask("t3", "Gamma", 2)],
      [
        makeState("t1", [makeAttempt("a1", "completed", { coverage: makeCoverage(8, 8) })]),
        makeState("t2", [makeAttempt("a2", "running")]),
        makeState("t3", [makeAttempt("a3", "queued")]),
      ],
      "running",
    );
    const ledger = buildTaskLedger(running);
    expect(ledger.currentTaskId).toBe("t2");
    expect(ledger.currentIndex).toBe(2);
    expect(ledger.total).toBe(3);

    const paused = makeExperiment(
      [makeTask("t1", "Alpha", 0), makeTask("t2", "Beta", 1)],
      [
        makeState("t1", [makeAttempt("a1", "completed", { coverage: makeCoverage(8, 8) })]),
        makeState("t2", [makeAttempt("a2", "queued")]),
      ],
      "paused",
    );
    const pausedLedger = buildTaskLedger(paused);
    expect(pausedLedger.currentTaskId).toBe("t2");
    expect(pausedLedger.currentIndex).toBe(2);

    const done = makeExperiment(
      [makeTask("t1", "Alpha", 0), makeTask("t2", "Beta", 1)],
      [
        makeState("t1", [makeAttempt("a1", "completed", { coverage: makeCoverage(8, 8) })]),
        makeState("t2", [makeAttempt("a2", "completed", { coverage: makeCoverage(8, 8) })]),
      ],
      "completed",
    );
    expect(buildTaskLedger(done).currentTaskId).toBeNull();
    expect(buildTaskLedger(done).currentIndex).toBeNull();
  });

  it("counts complete, partial, failed, and queued rows (failed includes aborted/interrupted)", () => {
    const experiment = makeExperiment(
      [
        makeTask("t1", "Alpha", 0),
        makeTask("t2", "Beta", 1),
        makeTask("t3", "Gamma", 2),
        makeTask("t4", "Delta", 3),
        makeTask("t5", "Epsilon", 4),
      ],
      [
        makeState("t1", [makeAttempt("a1", "completed", { coverage: makeCoverage(8, 8) })]),
        makeState("t2", [makeAttempt("a2", "partial", { coverage: makeCoverage(5, 8) })]),
        makeState("t3", [makeAttempt("a3", "aborted")]),
        makeState("t4", [makeAttempt("a4", "interrupted")]),
        makeState("t5", [makeAttempt("a5", "queued")]),
      ],
    );
    const ledger = buildTaskLedger(experiment);
    expect(ledger.counts).toEqual({ complete: 1, partial: 1, failed: 2, queued: 1 });
  });

  it("exposes titles, coverage fallback to suite slot count, and full attempt history", () => {
    const experiment = makeExperiment(
      [makeTask("t1", "Alpha", 0)],
      [
        makeState("t1", [
          makeAttempt("a1", "completed", { trial: 2, coverage: makeCoverage(6, SLOT_COUNT) }),
        ]),
      ],
    );
    const [row] = buildTaskLedger(experiment).rows;
    expect(row.title).toBe("Alpha");
    expect(row.scoredModels).toBe(6);
    expect(row.totalModels).toBe(SLOT_COUNT);
    expect(row.history[0].id).toBe("a1");

    // No coverage metadata → scored falls back to 0, total to slot count.
    const noCoverage = makeExperiment(
      [makeTask("t1", "Alpha", 0)],
      [makeState("t1", [makeAttempt("a1", "completed")])],
    );
    const [row2] = buildTaskLedger(noCoverage).rows;
    expect(row2.scoredModels).toBe(0);
    expect(row2.totalModels).toBe(SLOT_COUNT);
  });
});

describe("filterTaskLedgerRows", () => {
  function makeRow(taskId: string, status: TaskLedgerRow["status"]): TaskLedgerRow {
    return {
      taskId,
      order: 0,
      title: taskId,
      status,
      scoredModels: 0,
      totalModels: SLOT_COUNT,
      currentAttemptId: null,
      history: [],
    };
  }

  const rows: TaskLedgerRow[] = [
    makeRow("t-run", "running"),
    makeRow("t-complete", "completed"),
    makeRow("t-partial", "partial"),
    makeRow("t-failed", "failed"),
    makeRow("t-interrupted", "interrupted"),
    makeRow("t-aborted", "aborted"),
    makeRow("t-queued", "queued"),
  ];

  it("all returns every row without reordering", () => {
    expect(filterTaskLedgerRows(rows, "all", "running").map((r) => r.taskId)).toEqual([
      "t-run",
      "t-complete",
      "t-partial",
      "t-failed",
      "t-interrupted",
      "t-aborted",
      "t-queued",
    ]);
  });

  it("issues selects failed, partial, interrupted, and aborted rows only", () => {
    expect(filterTaskLedgerRows(rows, "issues", "running").map((r) => r.taskId)).toEqual([
      "t-partial",
      "t-failed",
      "t-interrupted",
      "t-aborted",
    ]);
  });

  it("queued and complete select exactly their status", () => {
    expect(filterTaskLedgerRows(rows, "queued", "running").map((r) => r.taskId)).toEqual([
      "t-queued",
    ]);
    expect(filterTaskLedgerRows(rows, "complete", "running").map((r) => r.taskId)).toEqual([
      "t-complete",
    ]);
  });

  it("active selects the running row, else the first incomplete row in a non-terminal experiment", () => {
    expect(filterTaskLedgerRows(rows, "active", "running").map((r) => r.taskId)).toEqual(["t-run"]);

    const noRunning = rows.filter((r) => r.status !== "running");
    // First incomplete row in a non-terminal experiment is the active task.
    expect(filterTaskLedgerRows(noRunning, "active", "paused").map((r) => r.taskId)).toEqual([
      "t-partial",
    ]);
  });

  it("active is empty for terminal experiments without a running row", () => {
    const noRunning = rows.filter((r) => r.status !== "running");
    expect(filterTaskLedgerRows(noRunning, "active", "completed")).toEqual([]);
  });
});

describe("searchTaskLedgerRows", () => {
  const rows: TaskLedgerRow[] = [
    {
      taskId: "task-1",
      order: 1,
      title: "Draft release notes",
      status: "completed",
      scoredModels: 8,
      totalModels: 8,
      currentAttemptId: "a",
      history: [],
    },
    {
      taskId: "task-2",
      order: 2,
      title: "Write a haiku",
      status: "running",
      scoredModels: 0,
      totalModels: 8,
      currentAttemptId: "b",
      history: [],
    },
    {
      taskId: "task-3",
      order: 3,
      title: "Summarize logs",
      status: "queued",
      scoredModels: 0,
      totalModels: 8,
      currentAttemptId: null,
      history: [],
    },
  ];

  it("matches title substrings case-insensitively without reordering", () => {
    const found = searchTaskLedgerRows(rows, "HAIKU");
    expect(found.map((r) => r.taskId)).toEqual(["task-2"]);
  });

  it("matches task ids", () => {
    expect(searchTaskLedgerRows(rows, "task-3").map((r) => r.taskId)).toEqual(["task-3"]);
  });

  it("returns all rows for an empty query", () => {
    expect(searchTaskLedgerRows(rows, "   ")).toHaveLength(3);
  });

  it("returns an empty list for a miss", () => {
    expect(searchTaskLedgerRows(rows, "nope-nope")).toEqual([]);
  });
});

describe("pageTaskLedgerRows", () => {
  function makeRows(n: number): TaskLedgerRow[] {
    return Array.from({ length: n }, (_, i) => ({
      taskId: `task-${i + 1}`,
      order: i + 1,
      title: `Task ${i + 1}`,
      status: "completed" as const,
      scoredModels: 8,
      totalModels: 8,
      currentAttemptId: null,
      history: [],
    }));
  }

  it("slices 250 rows into 50-row pages with 1-based range text", () => {
    const rows = makeRows(250);
    const page1 = pageTaskLedgerRows(rows, 1);
    expect(page1.rows).toHaveLength(50);
    expect(page1.pageCount).toBe(5);
    expect(page1.start).toBe(1);
    expect(page1.end).toBe(50);
    expect(page1.total).toBe(250);
    expect(page1.rows[0].taskId).toBe("task-1");

    const page5 = pageTaskLedgerRows(rows, 5);
    expect(page5.start).toBe(201);
    expect(page5.end).toBe(250);
    expect(page5.rows[0].taskId).toBe("task-201");
  });

  it("clamps out-of-range pages", () => {
    const rows = makeRows(120);
    expect(pageTaskLedgerRows(rows, 0).page).toBe(1);
    expect(pageTaskLedgerRows(rows, 99).page).toBe(3);
    expect(pageTaskLedgerRows(rows, 99).end).toBe(120);
  });

  it("handles empty and underfull lists", () => {
    expect(pageTaskLedgerRows([], 1)).toMatchObject({
      rows: [],
      page: 1,
      pageCount: 1,
      start: 0,
      end: 0,
      total: 0,
    });
    const single = pageTaskLedgerRows(makeRows(1), 1);
    expect(single.pageCount).toBe(1);
    expect(single.start).toBe(1);
    expect(single.end).toBe(1);
  });

  it("exposes PAGE_SIZE = 50", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});
