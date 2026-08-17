// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ComparisonResultRoute } from "./ComparisonResultRoute";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  PersistedCandidate,
  JudgeAttemptRecord,
  FusionAttemptRecord,
} from "../../lib/persistence/run-types";
import type { ComparisonTaskBinding } from "../../lib/compare/comparison-result-types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
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

function renderRouted(
  element: React.ReactNode,
  initialEntries: string[] = ["/compare/results/cmp-1"],
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/compare/results/:comparisonId" element={element} />
          <Route path="/compare" element={<div>Compare workspace draft</div>} />
          <Route path="/runs/:runId" element={<div>Run detail view</div>} />
          <Route path="/tasks/:taskId/versions/:version" element={<div>Task version view</div>} />
        </Routes>
      </MemoryRouter>,
    );
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// --- Fixtures ----------------------------------------------------------------

function makeCandidate(
  candidateId: string,
  slotId: string,
  model: string,
  slug: string,
  output: string,
  status: "completed" | "failed" | "running" = "completed",
): PersistedCandidate {
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  return {
    candidateId,
    slotId,
    modelKey: `openrouter:${slug}`,
    providerId: "openrouter",
    model,
    slug,
    acceptedAttemptId: isCompleted ? `att-${candidateId}` : null,
    attempts: [
      {
        attemptId: `att-${candidateId}`,
        messages: [{ role: "user", content: "Prompt" }],
        startedAt: 1716048000000,
        finishedAt: isCompleted || isFailed ? 1716048010000 : null,
        status,
        output: isCompleted ? output : isFailed ? null : output,
        tokensIn: 20,
        tokensOut: 50,
        error: isFailed ? { message: `${model} rate limit exceeded` } : null,
      },
    ],
  };
}

function makeRankRecord(id: string, overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  const c1 = makeCandidate("c1", "s1", "Claude 3.5 Sonnet", "claude-3-5-sonnet", "Python solution 1");
  const c2 = makeCandidate("c2", "s2", "GPT-4o", "gpt-4o", "Python solution 2");

  const judgeAttempt: JudgeAttemptRecord = {
    attemptId: "j-att-1",
    providerId: "openrouter",
    model: "claude-3-5-sonnet",
    instruction: "Evaluate accuracy and readability.",
    messages: [{ role: "user", content: "Evaluate" }],
    blindLabelToCandidateId: { A: "c1", B: "c2" },
    candidateAttemptIdsByCandidateId: { c1: "att-c1", c2: "att-c2" },
    startedAt: 1716048010000,
    finishedAt: 1716048020000,
    status: "completed",
    error: null,
    report: {
      labelMap: [
        { label: "A", candidateId: "c1" },
        { label: "B", candidateId: "c2" },
      ],
      evaluationsById: {
        c1: {
          candidateId: "c1",
          blindLabel: "A",
          overallScore: 4.8,
          position: "First",
          rationale: "Exceptional elegance and optimal time complexity.",
          strengths: ["Clean code", "Accurate tests"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "crit-correctness", label: "Correctness", score: 5.0, rationale: "100% correct" },
            { criterionId: "crit-style", label: "Style", score: 4.6, rationale: "Very clean" },
          ],
        },
        c2: {
          candidateId: "c2",
          blindLabel: "B",
          overallScore: 3.9,
          position: "Second",
          rationale: "Good implementation but slightly verbose.",
          strengths: ["Works as expected"],
          deductions: [{ severity: "minor", reason: "Unnecessary helper function" }],
          missedRequirements: [],
          criterionScores: [
            { criterionId: "crit-correctness", label: "Correctness", score: 4.0, rationale: "Correct" },
            { criterionId: "crit-style", label: "Style", score: 3.8, rationale: "Verbose" },
          ],
        },
      },
      comparisons: [
        {
          candidateIds: ["c1", "c2"],
          blindLabels: ["A", "B"],
          reason: "Candidate A is much clearer and faster.",
        },
      ],
    },
    consensus: {
      consensus: ["Both models implemented the main algorithm correctly."],
      contradictions: ["Candidate A used an in-place sort, while Candidate B allocated a new list."],
      uniqueInsights: [{ source: "Candidate A", insight: "Utilized dual-pivot partitioning." }],
    },
  };

  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1716048000000,
    updatedAt: 1716048025000,
    completedAt: 1716048025000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Write QuickSort in Python",
      prompt: "Implement quicksort in Python with type annotations.",
      systemPrompt: "You are a software engineer.",
      temperature: 0.7,
      attachments: [{ name: "spec.pdf", kind: "pdf", bytes: 1024 }],
    },
    evaluation: {
      profile: {
        id: "rubric-code",
        version: 1,
        name: "Code Quality Rubric",
        description: "Rubric for coding tasks",
        judgeInstruction: "",
        createdAt: 1716048000000,
        updatedAt: 1716048000000,
        criteria: [
          {
            id: "crit-correctness",
            name: "Correctness",
            weight: 0.7,
            description: "Algorithm accuracy",
            anchors: { one: "Bad", two: "Poor", three: "Fair", four: "Good", five: "Excellent" },
          },
          {
            id: "crit-style",
            name: "Style",
            weight: 0.3,
            description: "Pythonic style",
            anchors: { one: "Bad", two: "Poor", three: "Fair", four: "Good", five: "Excellent" },
          },
        ],
      },
      candidateMessages: [{ role: "user", content: "Implement quicksort in Python with type annotations." }],
    },
    candidates: [c1, c2],
    judge: {
      status: "done",
      acceptedAttemptId: "j-att-1",
      report: judgeAttempt.report,
      consensus: judgeAttempt.consensus,
      attempts: [judgeAttempt],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:claude-3-5-sonnet"],
    ...overrides,
  };
}

function makeFuseRecord(id: string, overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  const rankBase = makeRankRecord(id, { mode: "fuse", ...overrides });

  const fusionAttempt: FusionAttemptRecord = {
    attemptId: "fuse-att-1",
    providerId: "openrouter",
    model: "claude-3-5-sonnet",
    messages: [{ role: "user", content: "Fuse" }],
    sourceJudgeAttemptId: "j-att-1",
    candidateAttemptIdsByCandidateId: { c1: "att-c1", c2: "att-c2" },
    startedAt: 1716048020000,
    finishedAt: 1716048030000,
    status: "completed",
    error: null,
    result: "## Fused QuickSort Implementation\n\nHere is the unified optimal QuickSort in Python combining the in-place partitioning of Candidate A with the comprehensive docstrings of Candidate B.",
  };

  return {
    ...rankBase,
    mode: "fuse",
    completedAt: 1716048030000,
    fusion: {
      status: "done",
      acceptedAttemptId: "fuse-att-1",
      attempts: [fusionAttempt],
    },
    ...overrides,
  };
}

function makeSummaryFromRecord(record: RunRecordV2): FullRunSummaryV2 {
  return {
    kind: "full",
    schemaVersion: 2,
    id: record.id,
    revision: record.revision,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    status: record.status,
    mode: record.mode,
    source: record.source,
    taskTitle: record.task.title ?? "Task title",
    taskExcerpt: record.task.prompt,
    modelKeys: record.candidates.map((c) => c.modelKey),
    winnerKeys: record.winnerKeys,
    scoresByModelKey: {
      "openrouter:claude-3-5-sonnet": 4.8,
      "openrouter:gpt-4o": 3.9,
    },
    judgeModelKey: "openrouter:claude-3-5-sonnet",
    evaluationProfileId: record.evaluation.profile?.id ?? null,
    evaluationProfileVersion: record.evaluation.profile?.version ?? null,
    detailAvailable: true,
    searchText: `${record.task.title ?? ""} ${record.task.prompt}`,
  };
}

async function seedTestRecord(
  runsRepo: InMemoryRunRepository,
  comparisonRepo: InMemoryComparisonRepository,
  record: RunRecordV2,
  binding?: ComparisonTaskBinding,
) {
  const resolvedBinding: ComparisonTaskBinding = binding ?? {
    kind: "ad_hoc",
    inputSnapshotRef: `snap:sha256:${record.id.padEnd(64, "0")}`,
  };
  const summary = makeSummaryFromRecord(record);
  await runsRepo.create(record, summary);
  await comparisonRepo.createComparisonEnvelope(record, resolvedBinding);
}

// --- Tests -------------------------------------------------------------------

describe("ComparisonResultRoute", () => {
  it("direct-loads completed Rank comparison reconstructing recommendation, leaderboard, criteria, and answers", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
    const record = makeRankRecord("cmp-rank-100");
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-rank-100"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-rank-100"],
    );
    await settle();

    // Header & metadata
    expect(h.container.textContent).toContain("Write QuickSort in Python");
    expect(h.container.textContent).toContain("rank");
    expect(h.container.textContent).toContain("completed");
    expect(h.container.textContent).toContain("Ad hoc · exploratory");

    // Output surface - Rank recommendation
    expect(h.container.textContent).toContain("Claude 3.5 Sonnet");
    expect(h.container.textContent).toContain("Exceptional elegance");
    expect(h.container.textContent).toContain("4.8");

    // Leaderboard & score explanations
    expect(h.container.textContent).toContain("GPT-4o");
    expect(h.container.textContent).toContain("3.9");
    expect(h.container.textContent).toContain("Python solution 1");
    expect(h.container.textContent).toContain("Python solution 2");

    // Blind key & consensus breakdown
    expect(h.container.textContent).toContain("Both models implemented the main algorithm correctly");

    // Exact Record link
    const recordLink = h.$("a[href='/runs/cmp-rank-100']");
    expect(recordLink).not.toBeNull();
    expect(recordLink?.textContent).toMatch(/record/i);

    cleanup(h);
  });

  it("direct-loads completed Fuse comparison reconstructing markdown document, word count, and provenance", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
    const record = makeFuseRecord("cmp-fuse-200");
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-fuse-200"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-fuse-200"],
    );
    await settle();

    // Header & metadata
    expect(h.container.textContent).toContain("Write QuickSort in Python");
    expect(h.container.textContent).toContain("fuse");
    expect(h.container.textContent).toContain("completed");

    // Fused answer markdown document
    expect(h.container.textContent).toContain("Fused QuickSort Implementation");
    expect(h.container.textContent).toContain("unified optimal QuickSort");
    expect(h.container.textContent).toContain("Fused answer");

    // Candidate source answers visible
    expect(h.container.textContent).toContain("Python solution 1");
    expect(h.container.textContent).toContain("Python solution 2");

    cleanup(h);
  });

  it("renders partial comparison state honestly with candidate error details", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const c1 = makeCandidate("c1", "s1", "Claude 3.5 Sonnet", "claude-3-5-sonnet", "Working output", "completed");
    const c2 = makeCandidate("c2", "s2", "GPT-4o", "gpt-4o", "", "failed");

    const record = makeRankRecord("cmp-partial-300", {
      status: "partial",
      candidates: [c1, c2],
      judge: {
        status: "error",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      winnerKeys: [],
    });
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-partial-300"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-partial-300"],
    );
    await settle();

    expect(h.container.textContent).toContain("partial");
    // Usable candidate output preserved
    expect(h.container.textContent).toContain("Working output");
    // Failed candidate error reason visible
    expect(h.container.textContent).toContain("rate limit exceeded");

    cleanup(h);
  });

  it("renders interrupted comparison state without inventing missing outputs", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const c1 = makeCandidate("c1", "s1", "Claude 3.5 Sonnet", "claude-3-5-sonnet", "Partial candidate 1", "completed");
    const c2 = makeCandidate("c2", "s2", "GPT-4o", "gpt-4o", "", "running");

    const record = makeRankRecord("cmp-interrupted-400", {
      status: "interrupted",
      candidates: [c1, c2],
      judge: {
        status: "idle",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      winnerKeys: [],
    });
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-interrupted-400"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-interrupted-400"],
    );
    await settle();

    expect(h.container.textContent).toContain("interrupted");
    // Completed candidate before crash is visible
    expect(h.container.textContent).toContain("Partial candidate 1");

    cleanup(h);
  });

  it("renders stale running record honestly with in-flight indicator", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const c1 = makeCandidate("c1", "s1", "Claude 3.5 Sonnet", "claude-3-5-sonnet", "Draft 1", "running");
    const c2 = makeCandidate("c2", "s2", "GPT-4o", "gpt-4o", "Draft 2", "running");

    const record = makeRankRecord("cmp-running-500", {
      status: "running",
      completedAt: null,
      candidates: [c1, c2],
      judge: {
        status: "running",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      winnerKeys: [],
    });
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-running-500"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-running-500"],
    );
    await settle();

    expect(h.container.textContent).toContain("running");

    cleanup(h);
  });

  it("renders accepted report as authoritative after a failed re-judge attempt", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const baseRecord = makeRankRecord("cmp-rejudge-600");
    const firstJudgeAttempt = baseRecord.judge.attempts[0]!;

    const failedJudgeAttempt: JudgeAttemptRecord = {
      attemptId: "j-att-failed-2",
      providerId: "openrouter",
      model: "failed-judge-model",
      instruction: "Re-judge",
      messages: [{ role: "user", content: "Re-judge" }],
      blindLabelToCandidateId: { A: "c1", B: "c2" },
      candidateAttemptIdsByCandidateId: { c1: "att-c1", c2: "att-c2" },
      startedAt: 1716048030000,
      finishedAt: 1716048040000,
      status: "failed",
      error: { message: "Judge gateway 502 Bad Gateway" },
      report: null,
      consensus: null,
    };

    const record: RunRecordV2 = {
      ...baseRecord,
      judge: {
        status: "error",
        acceptedAttemptId: firstJudgeAttempt.attemptId,
        report: firstJudgeAttempt.report,
        consensus: firstJudgeAttempt.consensus,
        attempts: [firstJudgeAttempt, failedJudgeAttempt],
      },
    };

    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-rejudge-600"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-rejudge-600"],
    );
    await settle();

    // Must render the accepted winner from acceptedAttemptId
    expect(h.container.textContent).toContain("Claude 3.5 Sonnet");
    expect(h.container.textContent).toContain("Exceptional elegance");
    expect(h.container.textContent).toContain("4.8");

    cleanup(h);
  });

  it("renders explicit not-found state when comparison ID does not exist", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-unknown-999"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-unknown-999"],
    );
    await settle();

    expect(h.container.textContent).toMatch(/not found/i);
    const compareLink = h.$("a[href='/compare']");
    expect(compareLink).not.toBeNull();

    cleanup(h);
  });

  it("renders explicit missing source record state when index exists but run detail is gone", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    // Mock getComparisonResult returning an index with record: null
    vi.spyOn(comparisonRepo, "getComparisonResult").mockResolvedValue({
      index: {
        id: "cmp-no-source-700",
        runId: "cmp-no-source-700",
        createdAt: 1716048000000,
        updatedAt: 1716048025000,
        status: "completed",
        mode: "rank",
        title: "Lost comparison",
        taskBinding: { kind: "ad_hoc", inputSnapshotRef: "snap:1" },
        taskInstanceId: null,
        activeObservationIds: [],
        evidenceReceiptRevision: 0,
        lineage: { repeatedFrom: null },
        revision: 1,
      },
      record: null,
      warning: {
        kind: "missing_source_record",
        message: "Exact source run record cmp-no-source-700 is missing from storage.",
      },
    });

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-no-source-700"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-no-source-700"],
    );
    await settle();

    expect(h.container.textContent).toMatch(/source record.*missing|unavailable/i);

    cleanup(h);
  });

  it("renders revision repair warning banner and handles repair index action", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const record = makeRankRecord("cmp-repair-800", { status: "running", completedAt: null, revision: 0 });
    await seedTestRecord(runsRepo, comparisonRepo, record);

    // Update source record to completed with revision: 0
    const completedRecord = makeRankRecord("cmp-repair-800", { status: "completed", revision: 0, updatedAt: 200 });
    await runsRepo.update(completedRecord, makeSummaryFromRecord(completedRecord), 0);

    const rebuildSpy = vi.spyOn(comparisonRepo, "rebuildComparisonIndex");

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-repair-800"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-repair-800"],
    );
    await settle();

    const repairButton = h.$("button[data-action='repair-index']");
    expect(repairButton).not.toBeNull();
    if (repairButton) {
      act(() => {
        repairButton.click();
      });
      await settle();
      expect(rebuildSpy).toHaveBeenCalledWith("cmp-repair-800");
    }

    cleanup(h);
  });

  it("renders canonical Task binding identity with link to task version", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const binding: ComparisonTaskBinding = {
      kind: "canonical",
      taskId: "task-eval-42",
      taskVersion: 3,
    };
    const record = makeRankRecord("cmp-canon-900");
    await seedTestRecord(runsRepo, comparisonRepo, record, binding);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-canon-900"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-canon-900"],
    );
    await settle();

    expect(h.container.textContent).toContain("task-eval-42");
    expect(h.container.textContent).toContain("v3");
    const taskLink = h.$("a[href='/tasks/task-eval-42/versions/3']");
    expect(taskLink).not.toBeNull();

    cleanup(h);
  });

  it("makes ZERO provider / fetch calls on direct load (spied boundary)", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const record = makeRankRecord("cmp-zero-call");
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-zero-call"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
      />,
      ["/compare/results/cmp-zero-call"],
    );
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();

    cleanup(h);
  });

  it("triggers onOpenInCompare when user clicks Open in Compare", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const record = makeRankRecord("cmp-preload-1");
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const onOpenInCompare = vi.fn();
    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-preload-1"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
        onOpenInCompare={onOpenInCompare}
      />,
      ["/compare/results/cmp-preload-1"],
    );
    await settle();

    const openButton = h.$("button[data-action='open-in-compare']");
    expect(openButton).not.toBeNull();

    act(() => {
      openButton?.click();
    });
    await settle();

    expect(onOpenInCompare).toHaveBeenCalledWith(
      "cmp-preload-1",
      expect.objectContaining({
        mode: "rank",
        prompt: "Implement quicksort in Python with type annotations.",
      }),
    );

    cleanup(h);
  });
});
