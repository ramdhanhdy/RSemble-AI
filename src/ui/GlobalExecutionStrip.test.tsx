// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  buildStripViewModel,
  formatElapsed,
  GlobalExecutionStrip,
  type StripViewModel,
} from "./GlobalExecutionStrip";
import type {
  EvaluationTask,
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskState,
} from "../lib/evaluations/evaluation-types";
import type { ModelSlot } from "../studio-data";

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

function rerender(h: Harness, node: React.ReactNode) {
  act(() => {
    h.root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
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

function makeSlots(): ModelSlot[] {
  return [
    {
      id: "slot-1",
      providerId: "openrouter",
      provider: "OpenRouter",
      model: "gpt-4o",
      slug: "openai/gpt-4o",
      enabled: true,
    },
    {
      id: "slot-2",
      providerId: "gemini",
      provider: "Gemini",
      model: "flash",
      slug: "gemini-2.0-flash",
      enabled: true,
    },
  ];
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
      taskState("task-1", [
        makeAttempt("att-1", "completed", {
          runId: "run-1",
          startedAt: now - 60_000,
          finishedAt: now - 30_000,
        }),
      ]),
      taskState("task-2", [
        makeAttempt("att-2", "running", { runId: "run-2", startedAt: now - 5_000 }),
      ]),
      taskState("task-3", [makeAttempt("att-3", "queued")]),
    ],
    createdAt: now - 60_000,
    updatedAt: now,
    ...overrides,
  };
}

const BASE_VIEW: StripViewModel = {
  kind: "experiment",
  caption: "Evaluation · Task 2/3 · Write a haiku",
  elapsedMs: 5000,
  href: "/evaluations/results/exp-1",
  status: "running",
  alert: null,
};

// --- buildStripViewModel --------------------------------------------------------

describe("buildStripViewModel", () => {
  it("suppresses compare-owned execution on /compare and / (plan 7.1 #9)", () => {
    const base = {
      owner: { kind: "compare" as const, id: "run-1" },
      experiment: null,
      compareRunning: true,
      leaseOwnedElsewhere: false,
      storageFailed: false,
    };
    expect(buildStripViewModel({ ...base, pathname: "/compare" })).toBeNull();
    expect(buildStripViewModel({ ...base, pathname: "/" })).toBeNull();
  });

  it("suppresses experiment-owned execution on its own progress route (plan 7.1 #9)", () => {
    const view1 = buildStripViewModel({
      owner: { kind: "experiment", id: "exp-1" },
      experiment: makeExperiment(),
      pathname: "/evaluations/results/exp-1",
      compareRunning: false,
      leaseOwnedElsewhere: false,
      storageFailed: false,
    });
    expect(view1).toBeNull();

    const view2 = buildStripViewModel({
      owner: { kind: "experiment", id: "exp-1" },
      experiment: makeExperiment(),
      pathname: "/experiments/exp-1",
      compareRunning: false,
      leaseOwnedElsewhere: false,
      storageFailed: false,
    });
    expect(view2).toBeNull();
  });

  it("never suppresses a storage failure, even on owning routes (plan 7.1 #9)", () => {
    const experimentView = buildStripViewModel({
      owner: { kind: "experiment", id: "exp-1" },
      experiment: makeExperiment(),
      pathname: "/experiments/exp-1",
      compareRunning: false,
      leaseOwnedElsewhere: false,
      storageFailed: true,
    });
    expect(experimentView).not.toBeNull();
    expect(experimentView?.status).toBe("interrupted");
    expect(experimentView?.alert).toBeTruthy();

    const compareView = buildStripViewModel({
      owner: { kind: "compare", id: "run-1" },
      experiment: null,
      pathname: "/compare",
      compareRunning: true,
      leaseOwnedElsewhere: false,
      storageFailed: true,
    });
    expect(compareView).not.toBeNull();
    expect(compareView?.status).toBe("interrupted");
    expect(compareView?.alert).toBeTruthy();
  });

  it("appears on other routes with the experiment caption and progress link (plan 7.1 #10)", () => {
    const view = buildStripViewModel({
      owner: { kind: "experiment", id: "exp-1" },
      experiment: makeExperiment(),
      pathname: "/runs",
      compareRunning: false,
      leaseOwnedElsewhere: false,
      storageFailed: false,
    });
    expect(view?.kind).toBe("experiment");
    expect(view?.caption).toBe("Evaluation · Task 2/3 · Write a haiku");
    expect(view?.href).toBe("/evaluations/results/exp-1");
    expect(view?.status).toBe("running");
    expect(typeof view?.elapsedMs).toBe("number");
    expect(view?.elapsedMs ?? 0).toBeGreaterThanOrEqual(5000);
  });

  it("appears for a compare owner with a compare caption (plan 7.1 #10)", () => {
    const view = buildStripViewModel({
      owner: { kind: "compare", id: "run-1" },
      experiment: null,
      pathname: "/evaluations",
      compareRunning: true,
      leaseOwnedElsewhere: false,
      storageFailed: false,
    });
    expect(view?.kind).toBe("compare");
    expect(view?.caption).toMatch(/^Compare · /);
    expect(view?.href).toBe("/compare");
  });

  it("reports a paused experiment truthfully", () => {
    const view = buildStripViewModel({
      owner: { kind: "experiment", id: "exp-1" },
      experiment: makeExperiment({
        status: "paused",
        tasks: [
          taskState("task-1", [
            makeAttempt("att-1", "completed", { runId: "run-1", startedAt: Date.now() - 60_000 }),
          ]),
          taskState("task-2", [makeAttempt("att-2", "queued")]),
          taskState("task-3", [makeAttempt("att-3", "queued")]),
        ],
      }),
      pathname: "/runs",
      compareRunning: false,
      leaseOwnedElsewhere: false,
      storageFailed: false,
    });
    expect(view?.status).toBe("paused");
    expect(view?.caption).toBe("Evaluation · Task 2/3 · Write a haiku");
  });

  it("other-tab ownership yields a truthful caption and no progress link target (plan 7.1 #13)", () => {
    const view = buildStripViewModel({
      owner: null,
      experiment: null,
      pathname: "/runs",
      compareRunning: false,
      leaseOwnedElsewhere: true,
      storageFailed: false,
    });
    expect(view?.kind).toBe("other-tab");
    expect(view?.status).toBe("other-tab");
    expect(view?.caption).toBe("Execution is active in another tab");
    expect(view?.href).toBe("");
  });

  it("shows cross-tab lease kind and age without task details", () => {
    const view = buildStripViewModel({
      owner: null,
      experiment: null,
      pathname: "/runs",
      compareRunning: false,
      leaseOwnedElsewhere: true,
      lease: {
        leaseId: "lease-b",
        ownerId: "tab-b",
        kind: "compare",
        executionId: "run-b",
        acquiredAt: 1_000,
        heartbeatAt: 2_000,
        fence: 2,
        expiresAt: 12_000,
      },
      now: () => 6_000,
      storageFailed: false,
    });
    expect(view?.caption).toContain("Compare is active in another tab");
    expect(view?.caption).toContain("0:05 active");
    expect(view?.caption).not.toContain("run-b");
  });

  it("returns null when there is no owner and no lease contention", () => {
    expect(
      buildStripViewModel({
        owner: null,
        experiment: null,
        pathname: "/runs",
        compareRunning: false,
        leaseOwnedElsewhere: false,
        storageFailed: false,
      }),
    ).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("formats m:ss with tabular padding", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(5000)).toBe("0:05");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(9 * 60_000 + 7000)).toBe("9:07");
    expect(formatElapsed(-100)).toBe("0:00");
  });
});

// --- GlobalExecutionStrip component ---------------------------------------------

describe("GlobalExecutionStrip", () => {
  it("renders nothing when the view model is null", () => {
    const h = renderWithRouter(<GlobalExecutionStrip view={null} />);
    expect(h.$("[data-global-execution-strip]")).toBeNull();
    cleanup(h);
  });

  it("renders one h-9 line with status dot, status text, mono caption, tabular elapsed, and sr-only full caption (plan 7.1 #10)", async () => {
    const h = renderWithRouter(<GlobalExecutionStrip view={BASE_VIEW} />);
    await settle();

    const strip = h.$("[data-global-execution-strip]")!;
    expect(strip).not.toBeNull();
    expect(strip.className).toContain("h-9");
    expect(strip.className).toContain("border-b");
    // Not a card: no rounding / shadow
    expect(strip.className).not.toContain("rounded");
    expect(strip.className).not.toContain("shadow");

    // PipelineRail status-dot grammar
    const dot = strip.querySelector("span.rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-accent");

    // Status as text, never color-only (spec §15.14)
    expect(strip.textContent).toContain("Running");

    // Mono caption with truncate; full text carried in an sr-only span
    const captionSpan = [...strip.querySelectorAll("span")].find(
      (s) => s.className.includes("font-mono") && s.className.includes("truncate"),
    );
    expect(captionSpan).toBeDefined();
    const srOnly = [...strip.querySelectorAll("span")].find(
      (s) => s.className.includes("sr-only") && !s.hasAttribute("aria-live"),
    );
    expect(srOnly?.textContent).toBe(BASE_VIEW.caption);

    // Tabular elapsed time
    const elapsed = [...strip.querySelectorAll("span")].find(
      (s) => s.className.includes("tabular-nums") && s.textContent === "0:05",
    );
    expect(elapsed).toBeDefined();
    expect(elapsed!.className).toContain("font-mono");

    cleanup(h);
  });

  it("renders a View progress link with a ≥44px target (plan 7.1 #10)", async () => {
    const h = renderWithRouter(<GlobalExecutionStrip view={BASE_VIEW} />);
    await settle();
    const link = h.$('a[href="/evaluations/results/exp-1"]')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain("View progress");
    expect(link.className).toContain("min-h-[44px]");
    cleanup(h);
  });

  it("omits the View progress link for other-tab ownership (plan 7.1 #13)", async () => {
    const view: StripViewModel = {
      kind: "other-tab",
      caption: "Execution is active in another tab",
      elapsedMs: null,
      href: "",
      status: "other-tab",
      alert: null,
    };
    const h = renderWithRouter(<GlobalExecutionStrip view={view} />);
    await settle();
    const strip = h.$("[data-global-execution-strip]")!;
    expect(strip.textContent).toContain("Execution is active in another tab");
    expect(strip.textContent).toContain("Open the owning execution or wait for lease expiry.");
    expect(strip.querySelector("[data-execution-guidance]")).not.toBeNull();
    expect(strip.querySelector("a")).toBeNull();
    // Status text, never color-only
    expect(strip.textContent).toContain("Another tab");
    cleanup(h);
  });

  it("announces caption changes politely, but never re-announces an unchanged caption (plan 7.1 #12)", async () => {
    const h = renderWithRouter(<GlobalExecutionStrip view={BASE_VIEW} />);
    await settle();
    const polite = h.$('[aria-live="polite"]')!;
    expect(polite.textContent).toBe(BASE_VIEW.caption);

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(polite, { childList: true, characterData: true, subtree: true });

    // Re-render with an unchanged caption → no DOM mutation → no re-announcement
    rerender(h, <GlobalExecutionStrip view={{ ...BASE_VIEW }} />);
    await settle();
    expect(mutations).toHaveLength(0);

    // Meaningful stage transition → announced once
    rerender(
      h,
      <GlobalExecutionStrip
        view={{ ...BASE_VIEW, caption: "Evaluation · Task 3/3 · Summarize logs" }}
      />,
    );
    await settle();
    expect(polite.textContent).toBe("Evaluation · Task 3/3 · Summarize logs");
    expect(mutations.length).toBeGreaterThan(0);

    observer.disconnect();
    cleanup(h);
  });

  it("announces an alert assertively exactly once across re-renders (plan 7.1 #12)", async () => {
    const alertView: StripViewModel = {
      ...BASE_VIEW,
      status: "interrupted",
      alert: "Storage write failed — execution paused; retry or export before refreshing.",
    };
    const h = renderWithRouter(<GlobalExecutionStrip view={alertView} />);
    await settle();
    const assertive = h.$('[aria-live="assertive"]')!;
    expect(assertive.textContent).toBe(alertView.alert);

    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(assertive, { childList: true, characterData: true, subtree: true });

    // Re-render the same alert twice → announced exactly once, no further mutations
    rerender(h, <GlobalExecutionStrip view={{ ...alertView }} />);
    await settle();
    rerender(h, <GlobalExecutionStrip view={{ ...alertView }} />);
    await settle();
    expect(mutations).toHaveLength(0);
    expect(assertive.textContent).toBe(alertView.alert);

    observer.disconnect();
    cleanup(h);
  });
});
