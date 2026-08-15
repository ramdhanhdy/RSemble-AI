// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SuiteExperimentHistory as TaskSetExecutionHistory, experimentCoverage } from "./SuiteExperimentHistory";
import { InMemoryEvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskState,
} from "../../lib/evaluations/evaluation-types";

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
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>));
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
});

// --- Fixtures -----------------------------------------------------------------

function makeTaskState(
  taskId: string,
  statuses: ExperimentTaskAttempt["status"][],
): ExperimentTaskState {
  return {
    taskId,
    selectedAttemptId: statuses.length > 0 ? `${taskId}-a0` : null,
    attempts: statuses.map((status, i) => ({
      id: `${taskId}-a${i}`,
      runId: null,
      trial: 1,
      status,
      startedAt: null,
      finishedAt: null,
      error: null,
    })),
  };
}

function makeExperiment(id: string, overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  const now = Date.now();
  return {
    id,
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 2,
    protocolFingerprint: "fp",
    status: "completed",
    execution: null,
    snapshot: {
      suiteId: "suite-1",
      suiteVersion: 2,
      tasks: [],
      modelSlots: [
        {
          id: "m1",
          providerId: "openrouter",
          provider: "OpenRouter",
          model: "gpt-4o",
          slug: "openai/gpt-4o",
          enabled: true,
        },
        {
          id: "m2",
          providerId: "openrouter",
          provider: "OpenRouter",
          model: "claude",
          slug: "anthropic/claude",
          enabled: true,
        },
      ],
      defaultJudge: { providerId: "openrouter", model: "judge-model" },
      defaultEvaluation: { kind: "holistic" },
      profiles: [],
      protocolFingerprint: "fp",
      createdAt: now,
    },
    tasks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function seedExperiments(
  repo: InMemoryEvaluationRepository,
  experiments: ExperimentRecord[],
) {
  for (const exp of experiments) {
    await repo.createExperiment(exp);
  }
}

function rowLinks(h: Harness): HTMLAnchorElement[] {
  return [
    ...h.container.querySelectorAll<HTMLAnchorElement>(
      "[data-record-row] a[href^='/evaluations/results/']",
    ),
  ];
}

// --- Tests --------------------------------------------------------------------

describe("TaskSetExecutionHistory", () => {
  it("lists multiple experiments newest first, not only the latest", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedExperiments(repo, [
      makeExperiment("exp-oldest", { createdAt: 1715961600000 }),
      makeExperiment("exp-newest", { createdAt: 1716134400000 }),
      makeExperiment("exp-middle", { createdAt: 1716048000000 }),
    ]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    const links = rowLinks(h);
    expect(links).toHaveLength(3);
    expect(links[0].getAttribute("href")).toBe("/evaluations/results/exp-newest");
    expect(links[1].getAttribute("href")).toBe("/evaluations/results/exp-middle");
    expect(links[2].getAttribute("href")).toBe("/evaluations/results/exp-oldest");
    cleanup(h);
  });

  it("row shows exact localized timestamp with timezone, StatusMark, task set version, coverage, and model count", async () => {
    const repo = new InMemoryEvaluationRepository();
    const exp = makeExperiment("exp-1", {
      suiteVersion: 3,
      createdAt: 1716048000000,
      tasks: [makeTaskState("t1", ["completed"]), makeTaskState("t2", ["failed"])],
    });
    await seedExperiments(repo, [exp]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    const text = h.container.textContent ?? "";
    // Exact localized start time + timezone (RecordRow itself shows relative time)
    expect(text).toContain(new Date(exp.createdAt).toLocaleString());
    expect(text).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // StatusMark renders an explicit status label
    const mark = h.$("[data-status-mark]");
    expect(mark).toBeTruthy();
    expect(mark!.textContent).toContain("Completed");
    // Task set version, task coverage, model count
    expect(text).toContain("Task Set v3");
    expect(text).toContain("1/2 tasks");
    expect(text).toContain("2 models");
    cleanup(h);
  });

  it("completed, completed_with_failures, aborted, and interrupted experiments all remain listed", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedExperiments(repo, [
      makeExperiment("exp-completed", { status: "completed", createdAt: 1716048000000 }),
      makeExperiment("exp-cwf", { status: "completed_with_failures", createdAt: 1716048100000 }),
      makeExperiment("exp-aborted", { status: "aborted", createdAt: 1716048200000 }),
      makeExperiment("exp-interrupted", { status: "interrupted", createdAt: 1716048300000 }),
    ]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    const links = rowLinks(h);
    expect(links).toHaveLength(4);
    const text = h.container.textContent ?? "";
    expect(text).toContain("Completed");
    expect(text).toContain("Completed with failures");
    expect(text).toContain("Aborted");
    expect(text).toContain("Interrupted");
    cleanup(h);
  });

  it("each row links to /evaluations/results/:id", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedExperiments(repo, [
      makeExperiment("exp-1"),
      makeExperiment("exp-2", { createdAt: 1716048100000 }),
    ]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    expect(h.$("a[href='/evaluations/results/exp-1']")).toBeTruthy();
    expect(h.$("a[href='/evaluations/results/exp-2']")).toBeTruthy();
    cleanup(h);
  });

  it("paginates after 20 rows with a Show more button and a live count", async () => {
    const repo = new InMemoryEvaluationRepository();
    const experiments = Array.from({ length: 25 }, (_, i) =>
      makeExperiment(`exp-${String(i).padStart(2, "0")}`, { createdAt: 1716048000000 + i * 1000 }),
    );
    await seedExperiments(repo, experiments);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    expect(h.$$("[data-record-row]")).toHaveLength(20);
    expect(h.container.textContent).toContain("20 of 25");
    const showMore = [...h.$$("button")].find((b) => b.textContent?.includes("Show more"));
    expect(showMore).toBeTruthy();
    await act(async () => {
      showMore!.click();
      await flush();
    });
    await settle();
    expect(h.$$("[data-record-row]")).toHaveLength(25);
    expect(h.container.textContent).toContain("25 of 25");
    expect([...h.$$("button")].some((b) => b.textContent?.includes("Show more"))).toBe(false);
    cleanup(h);
  });

  it("archived suites still list experiments with working links", async () => {
    const repo = new InMemoryEvaluationRepository();
    const now = Date.now();
    await repo.saveSuite(
      {
        id: "suite-1",
        revision: 1,
        version: 2,
        name: "Archived suite",
        description: "",
        tasks: [],
        modelSlots: [],
        defaultJudge: { providerId: "openrouter", model: "" },
        defaultEvaluation: { kind: "holistic" },
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      },
      0,
    );
    await repo.archiveSuite("suite-1");
    await seedExperiments(repo, [
      makeExperiment("exp-1"),
      makeExperiment("exp-2", { createdAt: 1716048100000 }),
    ]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    expect(h.$$("[data-record-row]")).toHaveLength(2);
    expect(h.$("a[href='/evaluations/results/exp-1']")).toBeTruthy();
    expect(h.$("a[href='/evaluations/results/exp-2']")).toBeTruthy();
    cleanup(h);
  });

  it("row ids truncate and no fixed pixel widths threaten a 390px viewport", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedExperiments(repo, [
      makeExperiment("experiment-with-a-very-long-identifier-0123456789"),
    ]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    const row = h.$("[data-record-row]");
    expect(row).toBeTruthy();
    // Title element carries the truncate class
    const title = row!.querySelector(".truncate");
    expect(title).toBeTruthy();
    expect(title!.textContent).toContain("experiment-with-a-very-long-identifier");
    // No fixed pixel widths in the section markup
    const section = h.$("section[aria-label='Evaluations']");
    expect(section).toBeTruthy();
    expect(section!.innerHTML).not.toMatch(/w-\[\d+px\]/);
    cleanup(h);
  });

  it("rows use the shared RecordRow grammar (status mark, mono title, timestamp)", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedExperiments(repo, [makeExperiment("exp-1", { createdAt: 1716048000000 })]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    const row = h.$("[data-record-row]");
    expect(row).toBeTruthy();
    // StatusMark inside the row
    expect(row!.querySelector("[data-status-mark]")).toBeTruthy();
    // Mono title with the experiment id
    const title = row!.querySelector("span.font-mono");
    expect(title).toBeTruthy();
    expect(title!.textContent).toContain("exp-1");
    // Relative timestamp from RecordRow
    expect(row!.textContent).toMatch(/ago/);
    cleanup(h);
  });

  it("shows a compact loading line with role=status before resolving", async () => {
    const repo = new InMemoryEvaluationRepository();
    await seedExperiments(repo, [makeExperiment("exp-1")]);
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    const status = h.$("[role='status']");
    expect(status).toBeTruthy();
    expect(status!.textContent).toMatch(/loading evaluations/i);
    await settle();
    cleanup(h);
  });

  it("shows a compact one-line empty state", async () => {
    const repo = new InMemoryEvaluationRepository();
    const h = renderWithRouter(<TaskSetExecutionHistory repo={repo} suiteId="suite-1" />);
    await settle();
    expect(h.container.textContent).toContain("No evaluations yet — run this task set to create one.");
    expect(h.$$("[data-record-row]")).toHaveLength(0);
    cleanup(h);
  });
});

describe("experimentCoverage", () => {
  it("counts tasks with at least one completed attempt", () => {
    const exp = makeExperiment("exp-1", {
      tasks: [
        makeTaskState("t1", ["completed"]),
        makeTaskState("t2", ["failed", "completed"]),
        makeTaskState("t3", ["failed"]),
        makeTaskState("t4", []),
      ],
    });
    expect(experimentCoverage(exp)).toEqual({ completed: 2, total: 4 });
  });
});
