// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ComparisonResultRoute } from "./ComparisonResultRoute";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  PersistedCandidate,
  JudgeAttemptRecord,
  FusionAttemptRecord,
} from "../../lib/persistence/run-types";
import type { ComparisonTaskBinding } from "../../lib/compare/comparison-result-types";
import {
  OBSERVATION_SCHEMA_VERSION,
  type EligibilityDecision,
  type ModelConfigurationSnapshot,
  type Observation,
} from "../../lib/evidence/evidence-types";
import { observationIdFor } from "../../lib/evidence/evidence-validation";
import { canonicalizeModelConfiguration } from "../../lib/evidence/model-configuration";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
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
          <Route path="/evaluations/rubrics/:rubricId" element={<div>Rubric detail view</div>} />
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
const VALID_SHA = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeTestModelConfig(
  overrides: {
    providerId?: string;
    requestedModel?: string;
    resolvedModel?: string | null;
    resolvedVersion?: string | null;
    observedAt?: number;
  } = {},
): ModelConfigurationSnapshot {
  const res = canonicalizeModelConfiguration({
    providerId: overrides.providerId ?? "openrouter",
    requestedModel: overrides.requestedModel ?? "claude-3-5-sonnet",
    resolvedModel:
      overrides.resolvedModel !== undefined ? overrides.resolvedModel : "claude-3-5-sonnet",
    resolvedVersion:
      overrides.resolvedVersion !== undefined ? overrides.resolvedVersion : "20241022",
    observedAt: overrides.observedAt ?? 1716048000000,
  });
  if (!res.ok) throw new Error(res.reason);
  return res.snapshot;
}

const VALID_MC_ID = makeTestModelConfig().id;

function makeTestObservation(overrides: Partial<Observation> = {}): Observation {
  const runId = overrides.runId ?? overrides.sourceResultId ?? "cmp-evidence-1";
  const candidateAttemptId = overrides.candidateAttemptId ?? "att-c1";
  const modelConfigurationId = overrides.modelConfigurationId ?? VALID_MC_ID;
  const partial = {
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    sourceKind: overrides.sourceKind ?? ("evaluation" as const),
    sourceResultId: runId,
    executionLineageId: overrides.executionLineageId ?? "eval:lineage:1",
    runId,
    sourceTaskCellId: overrides.sourceTaskCellId ?? `cell:${candidateAttemptId}`,
    taskId: overrides.taskId ?? "task-sentiment",
    taskVersion: overrides.taskVersion ?? 2,
    taskInstanceId: overrides.taskInstanceId ?? "inst-001",
    taskFamilyId: overrides.taskFamilyId ?? "family-nlp",
    modelConfigurationId,
    candidateAttemptId,
    assessmentRef: overrides.assessmentRef ?? {
      judgeAttemptId: "j-att-1",
      judgeProviderId: "openrouter",
      judgeModel: "claude-3-5-sonnet",
      blindLabelMapping: { A: "c1", B: "c2" },
      candidateAttemptIdsByCandidateId: { c1: "att-c1", c2: "att-c2" },
      rubricRef: { id: "rubric_accuracy", version: 1 },
      verifierRef: { id: "verifier_exact", version: 1 },
      verifierOutcome: {
        taskId: "task-sentiment",
        modelKey: "openrouter:claude-3-5-sonnet",
        passed: true,
        executedAt: 1716048000000,
      },
    },
    protocolFingerprint: overrides.protocolFingerprint ?? VALID_SHA,
    rubricRef: overrides.rubricRef ?? { id: "rubric_accuracy", version: 1 },
    evaluatorSnapshot: overrides.evaluatorSnapshot ?? {
      kind: "model_judge" as const,
      providerId: "openrouter",
      model: "claude-3-5-sonnet",
      resolvedVersion: "20241022",
      instructionDigest: VALID_SHA,
      reasoningEffort: null,
      toolScaffoldSignature: null,
    },
    verifierSnapshot: overrides.verifierSnapshot ?? {
      verifierRef: { id: "verifier_exact", version: 1 },
      kind: "exact_match",
      configurationDigest: VALID_SHA,
    },
    outcome: overrides.outcome ?? {
      judgeAccepted: true,
      overallScore: 4.8,
      criterionValues: [{ criterionId: "crit-correctness", value: 5.0 }],
      verifierPassed: true,
    },
    observedAt: overrides.observedAt ?? 1716048000000,
    ...overrides,
  };
  return {
    ...partial,
    id: overrides.id ?? observationIdFor(partial as Observation),
  };
}

function makeTestDecision(overrides: Partial<EligibilityDecision> = {}): EligibilityDecision {
  return {
    observationId: overrides.observationId ?? "obs:sha256:obs-1",
    ruleVersion: 1,
    evidenceClass: overrides.evidenceClass ?? "comparable",
    status: overrides.status ?? "eligible",
    allowedUses: overrides.allowedUses ?? [
      "task_descriptive",
      "within_model_profile",
      "paired_model_comparison",
    ],
    reasonCodes: overrides.reasonCodes ?? [
      "canonical_task_resolved",
      "instance_reconstructed",
      "candidate_selected_completed",
      "assessment_selected_completed",
      "model_configuration_exact",
      "protocol_complete",
      "rubric_resolved",
    ],
    comparabilityCohortId: VALID_SHA,
    decidedAt: 1716048000000,
    ...overrides,
  };
}

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
  const c1 = makeCandidate(
    "c1",
    "s1",
    "Claude 3.5 Sonnet",
    "claude-3-5-sonnet",
    "Python solution 1",
  );
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
            {
              criterionId: "crit-correctness",
              label: "Correctness",
              score: 5.0,
              rationale: "100% correct",
            },
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
            {
              criterionId: "crit-correctness",
              label: "Correctness",
              score: 4.0,
              rationale: "Correct",
            },
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
      contradictions: [
        "Candidate A used an in-place sort, while Candidate B allocated a new list.",
      ],
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
    },
    attachments: [{ name: "spec.pdf", kind: "pdf", bytes: 1024 }],
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
      candidateMessages: [
        { role: "user", content: "Implement quicksort in Python with type annotations." },
      ],
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
    result:
      "## Fused QuickSort Implementation\n\nHere is the unified optimal QuickSort in Python combining the in-place partitioning of Candidate A with the comprehensive docstrings of Candidate B.",
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

    // Click candidate 2 to expand its answer
    const gpt2Button = h.$$("button").find((b) => b.textContent?.includes("GPT-4o"));
    if (gpt2Button) {
      act(() => {
        gpt2Button.click();
      });
      await settle();
    }
    expect(h.container.textContent).toContain("Python solution 2");

    // Blind key & consensus breakdown
    expect(h.container.textContent).toContain(
      "Both models implemented the main algorithm correctly",
    );

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

    // Expand source candidate answers
    const claudeButton = h.$$("button").find((b) => b.textContent?.includes("Claude 3.5 Sonnet"));
    if (claudeButton) {
      act(() => {
        claudeButton.click();
      });
      await settle();
    }
    expect(h.container.textContent).toContain("Python solution 1");

    cleanup(h);
  });

  it("renders partial comparison state honestly with candidate error details", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const c1 = makeCandidate(
      "c1",
      "s1",
      "Claude 3.5 Sonnet",
      "claude-3-5-sonnet",
      "Working output",
      "completed",
    );
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
    // Insufficient / stopped state details
    expect(h.container.textContent).toContain("1 of 2");
    // Failed candidate error reason visible
    expect(h.container.textContent).toContain("rate limit exceeded");

    cleanup(h);
  });

  it("renders interrupted comparison state without inventing missing outputs", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    const c1 = makeCandidate(
      "c1",
      "s1",
      "Claude 3.5 Sonnet",
      "claude-3-5-sonnet",
      "Partial candidate 1",
      "completed",
    );
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

    const c1 = makeCandidate(
      "c1",
      "s1",
      "Claude 3.5 Sonnet",
      "claude-3-5-sonnet",
      "Draft 1",
      "running",
    );
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

    const record = makeRankRecord("cmp-repair-800", {
      status: "running",
      completedAt: null,
      revision: 0,
    });
    await seedTestRecord(runsRepo, comparisonRepo, record);

    // Update source record to completed with revision: 0
    const completedRecord = makeRankRecord("cmp-repair-800", {
      status: "completed",
      revision: 0,
      updatedAt: 200,
    });
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

  describe("ComparisonResultRoute — Evidence Receipt (spec §8)", () => {
    it("discloses ad hoc comparison as exploratory evidence without model standing", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const record = makeRankRecord("cmp-adhoc-receipt");
      await seedTestRecord(runsRepo, comparisonRepo, record);

      // Seed exploratory observation in evidenceRepo
      const obs = makeTestObservation({
        sourceResultId: "cmp-adhoc-receipt",
        runId: "cmp-adhoc-receipt",
        taskId: "ad_hoc_task",
        candidateAttemptId: "att-c1",
      });
      const dec = makeTestDecision({
        observationId: obs.id,
        evidenceClass: "exploratory",
        status: "provisional",
        allowedUses: ["task_descriptive"],
        reasonCodes: [
          "canonical_task_unresolved",
          "instance_input_incomplete",
          "candidate_selected_completed",
          "assessment_selected_completed",
          "protocol_complete",
          "rubric_resolved",
        ],
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(makeTestModelConfig());

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-adhoc-receipt"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-adhoc-receipt"],
      );
      await settle();

      // Plain language ad hoc notice (spec §8)
      expect(h.container.textContent).toContain(
        "Preserved as exploratory evidence. Save or link this work to a canonical Task before it can contribute to a model evidence",
      );
      // Shared EvidenceReceipt rendered
      const receipts = h.$$("[data-testid='evidence-receipt']");
      expect(receipts.length).toBeGreaterThanOrEqual(1);

      // Ad hoc task is provisional exploratory and not eligible for within_model_profile
      expect(h.container.textContent).toContain("Exploratory");
      expect(h.container.textContent).toContain(
        "This record has no canonical Task identity yet — it is shown for inspection only.",
      );
      expect(h.container.textContent).not.toContain("Eligible for all declared uses");

      cleanup(h);
    });

    it("discloses canonical comparison evidence eligibility with task version and instance provenance", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const binding: ComparisonTaskBinding = {
        kind: "canonical",
        taskId: "task-sentiment",
        taskVersion: 2,
      };
      const record = makeRankRecord("cmp-canon-receipt");
      await seedTestRecord(runsRepo, comparisonRepo, record, binding);

      const obs = makeTestObservation({
        sourceResultId: "cmp-canon-receipt",
        runId: "cmp-canon-receipt",
        taskId: "task-sentiment",
        taskVersion: 2,
        taskInstanceId: "inst-001",
        candidateAttemptId: "att-c1",
      });
      const dec = makeTestDecision({
        observationId: obs.id,
        evidenceClass: "comparable",
        status: "eligible",
        allowedUses: ["task_descriptive", "within_model_profile", "paired_model_comparison"],
        reasonCodes: [
          "canonical_task_resolved",
          "instance_reconstructed",
          "candidate_selected_completed",
          "assessment_selected_completed",
          "model_configuration_exact",
          "protocol_complete",
          "rubric_resolved",
        ],
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(makeTestModelConfig());

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-canon-receipt"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-canon-receipt"],
      );
      await settle();

      // Status and provenance checks
      expect(h.container.textContent).toContain("task-sentiment");
      expect(h.container.textContent).toContain("inst-001");
      expect(h.container.textContent).toContain("Comparable");

      // Why it counts items
      expect(h.container.textContent).toContain(
        "This record resolves to a canonical Task identity.",
      );
      expect(h.container.textContent).toContain(
        "An accepted completed candidate output exists for this cell.",
      );
      expect(h.container.textContent).toContain("An accepted assessment exists for this output.");

      // Allowed uses
      expect(h.container.textContent).toContain("Contribute to this model configuration's");
      expect(h.container.textContent).toContain(
        "Compare paired models within one protocol cohort.",
      );

      // Links
      const taskLink = h.$("a[href='/tasks/task-sentiment/versions/2']");
      expect(taskLink).not.toBeNull();
      const runLink = h.$("a[href='/runs/cmp-canon-receipt']");
      expect(runLink).not.toBeNull();

      cleanup(h);
    });

    it("discloses incomplete roster coverage and failed candidate attempts honestly", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const binding: ComparisonTaskBinding = {
        kind: "canonical",
        taskId: "task-sentiment",
        taskVersion: 2,
      };
      const c1 = makeCandidate(
        "c1",
        "s1",
        "Claude 3.5 Sonnet",
        "claude-3-5-sonnet",
        "output 1",
        "completed",
      );
      const c2 = makeCandidate("c2", "s2", "GPT-4o", "gpt-4o", "", "failed");
      const record = makeRankRecord("cmp-partial-receipt", {
        status: "partial",
        candidates: [c1, c2],
        judge: {
          status: "idle",
          acceptedAttemptId: null,
          report: null,
          consensus: null,
          attempts: [],
        },
      });
      await seedTestRecord(runsRepo, comparisonRepo, record, binding);

      const obs = makeTestObservation({
        sourceResultId: "cmp-partial-receipt",
        runId: "cmp-partial-receipt",
        candidateAttemptId: "att-c1",
      });
      const dec = makeTestDecision({
        observationId: obs.id,
        reasonCodes: [
          "canonical_task_resolved",
          "candidate_selected_completed",
          "incomplete_task_set_coverage",
          "paired_cell_missing",
        ],
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(makeTestModelConfig());

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-partial-receipt"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-partial-receipt"],
      );
      await settle();

      // Failed candidate gets Excluded / No accepted attempt receipt
      expect(h.container.textContent).toContain("No accepted attempt");
      expect(h.container.textContent).toContain(
        "Execution produced no accepted candidate attempt for this task cell.",
      );

      // Incomplete roster coverage limitations disclosed
      expect(h.container.textContent).toContain("Some declared roster cells are missing evidence.");

      cleanup(h);
    });

    it("discloses unknown / unreported model version qualifications", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const record = makeRankRecord("cmp-unreported-version");
      await seedTestRecord(runsRepo, comparisonRepo, record);

      const cfg = makeTestModelConfig({ resolvedVersion: null });
      const obs = makeTestObservation({
        sourceResultId: "cmp-unreported-version",
        runId: "cmp-unreported-version",
        candidateAttemptId: "att-c1",
        modelConfigurationId: cfg.id,
      });
      const dec = makeTestDecision({
        observationId: obs.id,
        status: "provisional",
        reasonCodes: [
          "canonical_task_resolved",
          "candidate_selected_completed",
          "model_version_unreported",
        ],
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(cfg);

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-unreported-version"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-unreported-version"],
      );
      await settle();

      expect(h.container.textContent).toContain("unreported version");
      expect(h.container.textContent).toContain(
        "The resolved model version was not reported — comparisons split cohorts on this.",
      );

      cleanup(h);
    });

    it("discloses retry and reused candidate assessment qualifications", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const record = makeRankRecord("cmp-reuse-receipt");
      await seedTestRecord(runsRepo, comparisonRepo, record);

      const obs = makeTestObservation({
        sourceResultId: "cmp-reuse-receipt",
        runId: "cmp-reuse-receipt",
        candidateAttemptId: "att-c1",
      });
      const dec = makeTestDecision({
        observationId: obs.id,
        reasonCodes: [
          "canonical_task_resolved",
          "candidate_selected_completed",
          "reused_candidate_assessment",
          "undeclared_repeat",
        ],
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(makeTestModelConfig());

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-reuse-receipt"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-reuse-receipt"],
      );
      await settle();

      expect(h.container.textContent).toContain(
        "This assessment reused an earlier candidate output — it is not a new response sample.",
      );
      expect(h.container.textContent).toContain(
        "This is a repeated execution that was not planned as a replicate before running.",
      );

      cleanup(h);
    });

    it("discloses rubric, protocol, evaluator, and verifier provenance with deep links", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const record = makeRankRecord("cmp-verifier-receipt");
      await seedTestRecord(runsRepo, comparisonRepo, record);

      const obs = makeTestObservation({
        sourceResultId: "cmp-verifier-receipt",
        runId: "cmp-verifier-receipt",
        candidateAttemptId: "att-c1",
        rubricRef: { id: "rubric_accuracy", version: 1 },
        outcome: {
          judgeAccepted: true,
          overallScore: 5.0,
          criterionValues: [{ criterionId: "c1", value: 5.0 }],
          verifierPassed: true,
        },
      });
      const dec = makeTestDecision({
        observationId: obs.id,
        evidenceClass: "verified",
        status: "eligible",
        reasonCodes: [
          "canonical_task_resolved",
          "candidate_selected_completed",
          "verifier_passed",
          "rubric_resolved",
        ],
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(makeTestModelConfig());

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-verifier-receipt"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-verifier-receipt"],
      );
      await settle();

      // Verified status
      expect(h.container.textContent).toContain("Verified");

      // Rubric link
      const rubricLink = h.$("a[href='/evaluations/rubrics/rubric_accuracy']");
      expect(rubricLink).not.toBeNull();
      expect(rubricLink?.textContent).toContain("rubric_accuracy v1");

      // Evaluator & Verifier
      expect(h.container.textContent).toContain("Judge: claude-3-5-sonnet");
      expect(h.container.textContent).toContain("Verifier: exact_match (Passed)");

      cleanup(h);
    });

    it("ensures keyboard and screen-reader accessibility parity for evidence status and disclosures", async () => {
      const runsRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runsRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const record = makeRankRecord("cmp-a11y-receipt");
      await seedTestRecord(runsRepo, comparisonRepo, record);

      const obs = makeTestObservation({
        sourceResultId: "cmp-a11y-receipt",
        runId: "cmp-a11y-receipt",
        candidateAttemptId: "att-c1",
      });
      const dec = makeTestDecision({
        observationId: obs.id,
      });
      await evidenceRepo.putObservation(obs);
      await evidenceRepo.putDecision(dec);
      await evidenceRepo.putModelConfiguration(makeTestModelConfig());

      const h = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-a11y-receipt"
          comparisonRepo={comparisonRepo}
          runRepo={runsRepo}
          evidenceRepo={evidenceRepo}
        />,
        ["/compare/results/cmp-a11y-receipt"],
      );
      await settle();

      const article = h.$("article[aria-label='Evidence receipt']");
      expect(article).not.toBeNull();

      // Accessible headings inside receipt
      const headings = h.$$("article[aria-label='Evidence receipt'] h4");
      const headingTexts = headings.map((heading) => heading.textContent);
      expect(headingTexts).toContain("Why it counts");
      expect(headingTexts).toContain("Allowed Uses");
      expect(headingTexts).toContain("Evidence Provenance");

      cleanup(h);
    });
  });
});

describe("ComparisonResultRoute — 44x44 target rule (Plan Task 13)", () => {
  it("keeps header, banner, and answer-copy actions at the 44px minimum height", async () => {
    const runsRepo = new InMemoryRunRepository();
    const comparisonRepo = new InMemoryComparisonRepository(runsRepo);

    // Seed the index from a running record, then complete the source record so
    // the revision-mismatch banner (repair action) renders alongside the
    // completed result page (candidate answer rows).
    const record = makeRankRecord("cmp-targets-44", {
      status: "running",
      completedAt: null,
      revision: 0,
    });
    await seedTestRecord(runsRepo, comparisonRepo, record);

    const completedRecord = makeRankRecord("cmp-targets-44", {
      status: "completed",
      revision: 0,
      updatedAt: 200,
    });
    await runsRepo.update(completedRecord, makeSummaryFromRecord(completedRecord), 0);

    const h = renderRouted(
      <ComparisonResultRoute
        comparisonId="cmp-targets-44"
        comparisonRepo={comparisonRepo}
        runRepo={runsRepo}
        onOpenInCompare={() => undefined}
      />,
      ["/compare/results/cmp-targets-44"],
    );
    await settle();

    const targets: Array<{ name: string; el: HTMLElement | null }> = [
      { name: "Open in Compare", el: h.$("button[data-action='open-in-compare']") },
      { name: "View exact Record", el: h.$("a[data-action='view-record']") },
      { name: "Repair index", el: h.$("button[data-action='repair-index']") },
      { name: "Candidate copy", el: h.$("button[aria-label^='Copy ']") },
    ];
    for (const { name, el } of targets) {
      expect(el, `${name} action should render on the result page`).not.toBeNull();
      expect(
        el?.className.includes("min-h-[44px]"),
        `${name} must carry the project 44px min-height target class`,
      ).toBe(true);
    }

    cleanup(h);
  });
});
