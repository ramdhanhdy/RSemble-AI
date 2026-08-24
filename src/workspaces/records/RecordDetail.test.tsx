// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EligibilityDecision, Observation } from "../../lib/evidence/evidence-types";
import type { LegacyRunSummary, RunRecordV2 } from "../../lib/persistence/run-types";
import type { RecordsRepository } from "../../lib/records/records-repository";
import type {
  ObservationRecordReference,
  PolicyStudyReference,
  RecordReference,
  TaskExecutionRecordReference,
} from "../../lib/records/record-reference";
import { RecordDetail } from "./RecordDetail";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const study: PolicyStudyReference = {
  recordType: "policy-study",
  id: "study-1",
  createdAt: 1_000,
  updatedAt: 2_000,
  title: "Judge policy study",
  status: "completed",
  mode: null,
  source: null,
  modelKeys: [],
  searchText: "study-1 judge policy study",
  ownerHint: "in the Lab",
  claimLevel: "confirmed",
};

function child(index: number): TaskExecutionRecordReference {
  return {
    recordType: "task-execution",
    id: `run-${index}`,
    createdAt: index,
    updatedAt: index + 1,
    title: `Task ${index}`,
    status: "completed",
    mode: "rank",
    source: "adhoc",
    modelKeys: [],
    searchText: `run-${index}`,
    ownerHint: "in a Policy Study · Lab",
    runSource: { kind: "policy-study", studyId: "study-1" },
  };
}

function repository(overrides: Partial<RecordsRepository> = {}): RecordsRepository {
  return {
    list: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 50 })),
    getReference: vi.fn(async () => study),
    getTaskExecution: vi.fn(async () => null),
    getLegacySummary: vi.fn(async () => null),
    getObservation: vi.fn(async () => null),
    getObservationDecision: vi.fn(async () => null),
    getPolicyStudyRecord: vi.fn(async () => null),
    getPolicyStudyChildren: vi.fn(async () => ({
      trialCount: 142,
      observationCount: 12,
      exactRunCount: 25,
      items: Array.from({ length: 20 }, (_, index) => child(index)),
    })),
    ...overrides,
  } as RecordsRepository;
}

async function renderDetail(
  repo: RecordsRepository,
  recordType:
    "policy-study" | "observation" | "task-execution" | "comparison" | "evaluation" | "legacy",
  recordId: string,
  focus?: { candidateId?: string; judgeAttemptId?: string },
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <RecordDetail
          repository={repo}
          recordType={recordType}
          recordId={recordId}
          focusCandidateId={focus?.candidateId ?? null}
          focusJudgeAttemptId={focus?.judgeAttemptId ?? null}
        />
      </MemoryRouter>,
    );
  });
  for (let index = 0; index < 5; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

const taskExecutionReference: TaskExecutionRecordReference = {
  recordType: "task-execution",
  id: "run-1",
  createdAt: 1_000,
  updatedAt: 1_100,
  title: "Write a Python sort function",
  status: "completed",
  mode: "rank",
  source: "adhoc",
  modelKeys: ["openrouter:gpt-4o"],
  searchText: "run-1 write a python sort function",
  ownerHint: "in Compare",
  runSource: { kind: "adhoc", comparisonId: "run-1" },
};

function fullRunRecord(): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: "run-1",
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1716048000000,
    updatedAt: 1716048060000,
    completedAt: 1716048060000,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Write a Python sort function",
      prompt: "Sort integers.",
      systemPrompt: "Helpful.",
      temperature: 0.7,
    },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [
      {
        candidateId: "c1",
        slotId: "s1",
        modelKey: "openrouter:gpt-4o",
        providerId: "openrouter",
        model: "GPT-4o",
        slug: "gpt-4o",
        acceptedAttemptId: "att-1",
        attempts: [
          {
            attemptId: "att-1",
            messages: [{ role: "user", content: "Sort the list" }],
            startedAt: 1716048000000,
            finishedAt: 1716048030000,
            output: "def bubble_sort(arr):\n    return sorted(arr)",
            status: "completed" as const,
            tokensIn: 15,
            tokensOut: 30,
            error: null,
          },
        ],
      },
    ],
    judge: {
      status: "idle" as const,
      acceptedAttemptId: null,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle" as const, acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

describe("RecordDetail", () => {
  it("keeps Policy Study meaning in the Lab and caps the Records child list", async () => {
    const harness = await renderDetail(repository(), "policy-study", "study-1");
    expect(harness.container.querySelector("a[href='/lab/studies/study-1']")).not.toBeNull();
    expect(harness.container.textContent).toContain("142 trials · 12 observations · 25 exact runs");
    expect(harness.container.querySelectorAll("[data-record-row]")).toHaveLength(20);
    expect(harness.container.textContent).toContain(
      "Judged results, rationale, and evidence live in the owning context.",
    );
    expect(harness.container.textContent).not.toMatch(
      /re-judge|re-fuse|resume|repair|add model|retention|delete/i,
    );
    act(() => harness.root.unmount());
  });

  it("renders Observation source references without copying owner evidence", async () => {
    const reference: ObservationRecordReference = {
      recordType: "observation",
      id: "observation-1",
      createdAt: 2_000,
      updatedAt: 2_000,
      title: "Observation for task-1",
      status: "completed",
      mode: null,
      source: "experiment",
      modelKeys: ["openrouter:qwen3.8-max"],
      searchText: "observation-1 task-1",
      ownerHint: "from an Evaluation",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      modelConfigurationId: "model-config-1",
    };
    const observation = {
      id: "observation-1",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      taskVersion: 2,
      modelConfigurationId: "model-config-1",
      candidateAttemptId: "candidate-attempt-1",
      assessmentRef: { judgeAttemptId: "judge-attempt-1" },
      outcome: { judgeAccepted: true, verifierPassed: true },
    } as Observation;
    const repo = repository({
      getReference: vi.fn(async () => reference),
      getObservation: vi.fn(async () => observation),
    });
    const harness = await renderDetail(repo, "observation", "observation-1");
    expect(
      harness.container.querySelector("a[href='/evaluations/results/evaluation-1']"),
    ).not.toBeNull();
    expect(
      harness.container.querySelector("a[href='/records/task-execution/run-1']"),
    ).not.toBeNull();
    expect(harness.container.textContent).toContain("Assessment judge-attempt-1");
    act(() => harness.root.unmount());
  });

  it("moves route focus to the exact Task Execution detail heading", async () => {
    const record = fullRunRecord();
    const repo = repository({
      getReference: vi.fn(async () => taskExecutionReference),
      getTaskExecution: vi.fn(async () => record),
    });
    const harness = await renderDetail(repo, "task-execution", "run-1");
    const heading = harness.container.querySelector<HTMLElement>("[data-detail-heading]");
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(harness.container.querySelector("[data-run-detail]")).not.toBeNull();
    act(() => harness.root.unmount());
  });

  it("keeps candidate deep-link focus ahead of the detail heading", async () => {
    const record = fullRunRecord();
    const repo = repository({
      getReference: vi.fn(async () => taskExecutionReference),
      getTaskExecution: vi.fn(async () => record),
    });
    const harness = await renderDetail(repo, "task-execution", "run-1", {
      candidateId: "c1",
    });
    const heading = harness.container.querySelector<HTMLElement>("[data-detail-heading]");
    expect(document.activeElement).not.toBe(heading);
    expect(document.activeElement?.getAttribute("data-candidate-id")).toBe("c1");
    act(() => harness.root.unmount());
  });
});

describe("Typed details — Task 8 canonical completion", () => {
  const comparisonReference: RecordReference = {
    recordType: "comparison",
    id: "cmp-1",
    createdAt: 1_000,
    updatedAt: 1_100,
    title: "Frontend reliability compare",
    status: "completed",
    mode: "rank",
    source: "adhoc",
    modelKeys: ["m/a", "m/b"],
    searchText: "cmp-1 frontend reliability",
    ownerHint: "in Compare",
    runId: "run-1",
    taskBinding: { kind: "ad_hoc", inputSnapshotRef: "snap-1" },
  };

  const evaluationReference: RecordReference = {
    recordType: "evaluation",
    id: "eval-1",
    createdAt: 1_000,
    updatedAt: 1_100,
    title: "Suite run eval-1",
    status: "completed",
    mode: null,
    source: "experiment",
    modelKeys: ["openrouter:gpt-4o"],
    searchText: "eval-1 suite run",
    ownerHint: "in Evaluations",
    taskSetId: "ts-1",
    taskSetVersion: 1,
    childRunIds: ["run-1"],
  };

  const legacyReference: RecordReference = {
    recordType: "legacy",
    id: "legacy-1",
    createdAt: 1_000,
    updatedAt: 1_000,
    title: "Imported comparison",
    status: null,
    mode: null,
    source: "legacy",
    modelKeys: ["gpt-3.5"],
    searchText: "legacy-1 imported comparison",
    ownerHint: "Origin unresolved — preserved as imported",
    ownerCrosswalk: null,
  };

  const legacySummary: LegacyRunSummary = {
    kind: "legacy",
    schemaVersion: "1-import",
    id: "legacy-1",
    createdAt: 1_000,
    taskExcerpt: "Imported comparison",
    modelKeys: ["gpt-3.5"],
    winnerKeys: ["gpt-3.5"],
    scoresByModelKey: { "gpt-3.5": 4.5 },
    detailAvailable: false,
    searchText: "legacy-1 imported comparison",
  };

  function ownerAction(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>("[data-owner-action]");
  }

  it("labels semantic owner actions with their context, not generic words", async () => {
    const comparisonRepo = repository({
      getReference: vi.fn(async () => comparisonReference),
      list: vi.fn(async () => ({
        items: [taskExecutionReference],
        total: 1,
        offset: 0,
        limit: 50,
      })),
    });
    const comparisonView = await renderDetail(
      comparisonRepo as RecordsRepository,
      "comparison",
      "cmp-1",
    );
    expect(ownerAction(comparisonView.container)?.textContent).toContain("Open comparison result");
    expect(ownerAction(comparisonView.container)?.getAttribute("href")).toBe(
      "/compare/results/cmp-1",
    );
    act(() => comparisonView.root.unmount());

    const evaluationRepo = repository({
      getReference: vi.fn(async () => evaluationReference),
      list: vi.fn(async () => ({
        items: [taskExecutionReference],
        total: 1,
        offset: 0,
        limit: 500,
      })),
    });
    const evaluationView = await renderDetail(
      evaluationRepo as RecordsRepository,
      "evaluation",
      "eval-1",
    );
    expect(ownerAction(evaluationView.container)?.textContent).toContain("Open evaluation");
    expect(ownerAction(evaluationView.container)?.getAttribute("href")).toBe(
      "/evaluations/results/eval-1",
    );
    act(() => evaluationView.root.unmount());

    // The policy study keeps its single Lab owner action.
    const studyView = await renderDetail(repository(), "policy-study", "study-1");
    expect(ownerAction(studyView.container)?.textContent).toContain("Open study");
    expect(ownerAction(studyView.container)?.getAttribute("href")).toBe("/lab/studies/study-1");
    act(() => studyView.root.unmount());
  });

  it("keeps the configuration-only honesty token under Open in Compare", async () => {
    const record = fullRunRecord();
    const repo = repository({
      getReference: vi.fn(async () => taskExecutionReference),
      getTaskExecution: vi.fn(async () => record),
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <RecordDetail
            repository={repo}
            recordType="task-execution"
            recordId="run-1"
            focusCandidateId={null}
            focusJudgeAttemptId={null}
            onOpenInCompare={() => {}}
          />
        </MemoryRouter>,
      );
    });
    for (let index = 0; index < 5; index++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(container.querySelector("[data-action='open-in-compare']")).not.toBeNull();
    expect(container.textContent).toContain(
      "Loads configuration only — no outputs, no execution, no lineage.",
    );
    act(() => root.unmount());
  });

  it("offers the evaluation owner action on an experiment-owned exact run", async () => {
    const record = fullRunRecord();
    const owned: TaskExecutionRecordReference = {
      ...taskExecutionReference,
      ownerHint: "in an Evaluation",
      runSource: { kind: "experiment", evaluationExecutionId: "eval-1", taskSetId: "ts-1" },
    };
    const repo = repository({
      getReference: vi.fn(async () => owned),
      getTaskExecution: vi.fn(async () => record),
    });
    const harness = await renderDetail(repo, "task-execution", "run-1");
    const action = ownerAction(harness.container);
    expect(action?.textContent).toContain("Open evaluation");
    expect(action?.getAttribute("href")).toBe("/evaluations/results/eval-1");
    act(() => harness.root.unmount());
  });
  it("renders both owner navigation and configuration-only preload in fixed §L order for comparison records", async () => {
    const record = fullRunRecord();
    const comparisonRepo = repository({
      getReference: vi.fn(async () => comparisonReference),
      getTaskExecution: vi.fn(async () => record),
      list: vi.fn(async () => ({
        items: [taskExecutionReference],
        total: 1,
        offset: 0,
        limit: 50,
      })),
    });
    const onOpenInCompare = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <RecordDetail
            repository={comparisonRepo as RecordsRepository}
            recordType="comparison"
            recordId="cmp-1"
            onOpenInCompare={onOpenInCompare}
          />
        </MemoryRouter>,
      );
    });
    for (let index = 0; index < 5; index++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    // Action 1: Owner navigation ("Open comparison result")
    const ownerLink = container.querySelector<HTMLAnchorElement>("[data-owner-action]");
    expect(ownerLink).not.toBeNull();
    expect(ownerLink?.textContent).toContain("Open comparison result");
    expect(ownerLink?.getAttribute("href")).toBe("/compare/results/cmp-1");

    // Action 2: Configuration-only preload ("Open in Compare") with honesty token
    const compareBtn = container.querySelector<HTMLButtonElement>(
      "button[data-action='open-in-compare']",
    );
    expect(compareBtn).not.toBeNull();
    expect(compareBtn?.textContent).toContain("Open in Compare");
    expect(container.textContent).toContain(
      "Loads configuration only — no outputs, no execution, no lineage.",
    );

    // Action 3: Copy link
    const copyBtn = container.querySelector<HTMLButtonElement>("button[data-action='copy-link']");
    expect(copyBtn).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("renders both owner navigation and configuration-only preload in fixed §L order for compare-owned task execution records", async () => {
    const record = fullRunRecord();
    const compareOwned: TaskExecutionRecordReference = {
      ...taskExecutionReference,
      ownerHint: "in Compare",
      runSource: { kind: "adhoc", comparisonId: "cmp-1" },
    };
    const repo = repository({
      getReference: vi.fn(async () => compareOwned),
      getTaskExecution: vi.fn(async () => record),
    });
    const onOpenInCompare = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <RecordDetail
            repository={repo as RecordsRepository}
            recordType="task-execution"
            recordId="run-1"
            onOpenInCompare={onOpenInCompare}
          />
        </MemoryRouter>,
      );
    });
    for (let index = 0; index < 5; index++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    // Action 1: Owner navigation ("Open comparison result" -> /compare/results/cmp-1)
    const ownerLink = container.querySelector<HTMLAnchorElement>("[data-owner-action]");
    expect(ownerLink).not.toBeNull();
    expect(ownerLink?.textContent).toContain("Open comparison result");
    expect(ownerLink?.getAttribute("href")).toBe("/compare/results/cmp-1");

    // Action 2: Configuration-only preload ("Open in Compare") with honesty token
    const compareBtn = container.querySelector<HTMLButtonElement>(
      "button[data-action='open-in-compare']",
    );
    expect(compareBtn).not.toBeNull();
    expect(compareBtn?.textContent).toContain("Open in Compare");
    expect(container.textContent).toContain(
      "Loads configuration only — no outputs, no execution, no lineage.",
    );

    // Action 3: Copy link
    const copyBtn = container.querySelector<HTMLButtonElement>("button[data-action='copy-link']");
    expect(copyBtn).not.toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("renders the observation eligibility panel as icon plus word, never color alone", async () => {
    const reference: ObservationRecordReference = {
      ...({
        recordType: "observation",
        id: "observation-1",
        createdAt: 2_000,
        updatedAt: 2_000,
        title: "Observation for task-1",
        status: "completed",
        mode: null,
        source: "experiment",
        modelKeys: ["openrouter:qwen3.8-max"],
        searchText: "observation-1 task-1",
        ownerHint: "from an Evaluation",
        sourceKind: "evaluation",
        sourceResultId: "evaluation-1",
        runId: "run-1",
        taskId: "task-1",
        modelConfigurationId: "model-config-1",
      } as ObservationRecordReference),
      policyStudyId: "study-1",
    };
    const observation = {
      id: "observation-1",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      taskVersion: 2,
      modelConfigurationId: "model-config-1",
      candidateAttemptId: "candidate-attempt-1",
      assessmentRef: { judgeAttemptId: "judge-attempt-1" },
      outcome: { judgeAccepted: true, verifierPassed: true },
    } as Observation;
    const decision: EligibilityDecision = {
      observationId: "observation-1",
      ruleVersion: 3,
      status: "eligible",
      evidenceClass: "comparable",
      allowedUses: ["task_descriptive"],
      reasonCodes: ["verifier_passed", "protocol_complete"],
      comparabilityCohortId: "cohort-1",
      decidedAt: 5_000,
    };
    const repo = repository({
      getReference: vi.fn(async () => reference),
      getObservation: vi.fn(async () => observation),
      getObservationDecision: vi.fn(async () => decision),
    });
    const harness = await renderDetail(repo as RecordsRepository, "observation", "observation-1");
    const panel = harness.container.querySelector("[data-observation-eligibility]");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Comparable");
    expect(panel?.textContent).toContain("Eligible");
    // Rules passed render as icon + word rows.
    const rules = panel!.querySelectorAll("[data-eligibility-rule]");
    expect(rules.length).toBe(2);
    expect(rules[0]!.querySelector("svg")).not.toBeNull();
    expect(panel?.textContent).toContain("The deterministic verifier passed.");
    // Study-linked observation carries the policy-evidence marker.
    const marker = harness.container.querySelector("[data-policy-evidence]");
    expect(marker?.getAttribute("aria-label")).toBe(
      "This result is policy evidence about the configuration, not evidence about this model.",
    );
    // Owner backlink to the Task context.
    // Owner backlink to the canonical Task context.
    expect(harness.container.querySelector("a[href='/tasks/task-1/versions/2']")).not.toBeNull();
    expect(harness.container.querySelector("a[href='/models/model-config-1']")).not.toBeNull();
    act(() => harness.root.unmount());
  });
  it("separates passed rules from limitations/failures with truthful icons and labels for provisional decisions", async () => {
    const reference: ObservationRecordReference = {
      recordType: "observation",
      id: "observation-prov",
      createdAt: 2_000,
      updatedAt: 2_000,
      title: "Provisional observation",
      status: "completed",
      mode: null,
      source: "experiment",
      modelKeys: ["openrouter:qwen3.8-max"],
      searchText: "observation-prov task-1",
      ownerHint: "from an Evaluation",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      modelConfigurationId: "model-config-1",
    };
    const observation = {
      id: "observation-prov",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      taskVersion: 2,
      modelConfigurationId: "model-config-1",
      candidateAttemptId: "candidate-attempt-1",
      assessmentRef: { judgeAttemptId: "judge-attempt-1" },
      outcome: { judgeAccepted: true, verifierPassed: null },
    } as Observation;
    const decision: EligibilityDecision = {
      observationId: "observation-prov",
      ruleVersion: 3,
      status: "provisional",
      evidenceClass: "exploratory",
      allowedUses: ["task_descriptive"],
      reasonCodes: ["protocol_complete", "incomplete_task_set_coverage"],
      comparabilityCohortId: "cohort-1",
      decidedAt: 5_000,
    };
    const repo = repository({
      getReference: vi.fn(async () => reference),
      getObservation: vi.fn(async () => observation),
      getObservationDecision: vi.fn(async () => decision),
    });
    const harness = await renderDetail(
      repo as RecordsRepository,
      "observation",
      "observation-prov",
    );
    const panel = harness.container.querySelector("[data-observation-eligibility]");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Provisional");

    // Genuine passed rules render under Rules passed with data-eligibility-rule.
    const passedRules = panel!.querySelectorAll("[data-eligibility-rule]");
    expect(passedRules.length).toBe(1);
    expect(passedRules[0]!.textContent).toContain("The execution protocol is fully recorded.");
    expect(passedRules[0]!.querySelector("svg.text-success")).not.toBeNull();

    // Limitations render under a separate limitations list with data-eligibility-limitation and warning treatment.
    const limitations = panel!.querySelectorAll("[data-eligibility-limitation]");
    expect(limitations.length).toBe(1);
    expect(limitations[0]!.textContent).toContain(
      "Some declared roster cells are missing evidence.",
    );
    expect(limitations[0]!.querySelector("svg.text-warning")).not.toBeNull();

    // Limitations must NEVER appear inside the Rules passed list or carry text-success.
    const passedList = panel!.querySelector("ul[aria-label='Rules passed']");
    expect(passedList?.textContent).not.toContain(
      "Some declared roster cells are missing evidence.",
    );
    act(() => harness.root.unmount());
  });

  it("separates passed rules from limitations/failures with truthful icons and labels for excluded decisions", async () => {
    const reference: ObservationRecordReference = {
      recordType: "observation",
      id: "observation-excl",
      createdAt: 2_000,
      updatedAt: 2_000,
      title: "Excluded observation",
      status: "completed",
      mode: null,
      source: "experiment",
      modelKeys: ["openrouter:qwen3.8-max"],
      searchText: "observation-excl task-1",
      ownerHint: "from an Evaluation",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      modelConfigurationId: "model-config-1",
    };
    const observation = {
      id: "observation-excl",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      taskVersion: 2,
      modelConfigurationId: "model-config-1",
      candidateAttemptId: "candidate-attempt-1",
      assessmentRef: { judgeAttemptId: "judge-attempt-1" },
      outcome: { judgeAccepted: false, verifierPassed: false },
    } as Observation;
    const decision: EligibilityDecision = {
      observationId: "observation-excl",
      ruleVersion: 3,
      status: "excluded",
      evidenceClass: "exploratory",
      allowedUses: [],
      reasonCodes: ["verifier_failed", "candidate_missing_or_failed"],
      comparabilityCohortId: "cohort-1",
      decidedAt: 5_000,
    };
    const repo = repository({
      getReference: vi.fn(async () => reference),
      getObservation: vi.fn(async () => observation),
      getObservationDecision: vi.fn(async () => decision),
    });
    const harness = await renderDetail(
      repo as RecordsRepository,
      "observation",
      "observation-excl",
    );
    const panel = harness.container.querySelector("[data-observation-eligibility]");
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Excluded");

    // Zero passed rules for an excluded decision with only limitations.
    const passedRules = panel!.querySelectorAll("[data-eligibility-rule]");
    expect(passedRules.length).toBe(0);

    // Limitations / failures render with error/warning styling and data-eligibility-limitation.
    const limitations = panel!.querySelectorAll("[data-eligibility-limitation]");
    expect(limitations.length).toBe(2);
    expect(limitations[0]!.querySelector("svg.text-error, svg.text-warning")).not.toBeNull();
    expect(panel?.querySelector("ul[aria-label='Rules passed']")).toBeNull();
    act(() => harness.root.unmount());
  });

  it("keeps Legacy known-fields-only with provenance, source event honesty, and preserved payload", async () => {
    const richLegacySummary: LegacyRunSummary = {
      ...legacySummary,
      createdAt: 1_700_000_000_000,
      rawPayload: {
        taskExcerpt: "Imported comparison",
        models: ["gpt-3.5"],
        stats: { "gpt-3.5": { score: 4.5, latencyMs: 1200, costUsd: 0.005 } },
        winner: "gpt-3.5",
        timestamp: 1_700_000_000_000,
        extraRawField: "raw-unnormalized-value",
      },
      importMetadata: {
        importedAt: 1_700_050_000_000,
        format: "1-import",
        importer: "localStorage:rsemble.runHistory.v1",
      },
    };
    const repo = repository({
      getReference: vi.fn(async () => legacyReference),
      getLegacySummary: vi.fn(async () => richLegacySummary),
    });
    const harness = await renderDetail(repo as RecordsRepository, "legacy", "legacy-1");
    expect(harness.container.textContent).toContain("Origin unresolved");
    expect(harness.container.textContent).toContain("This record's historical owner is unknown.");

    // Import provenance: Format, Importer, Source event (createdAt), and Imported (importedAt).
    const provenance = harness.container.querySelector("[data-section='provenance']");
    expect(provenance).not.toBeNull();
    expect(provenance?.textContent).toContain("Format");
    expect(provenance?.textContent).toContain("1-import");
    expect(provenance?.textContent).toContain("Importer");
    expect(provenance?.textContent).toContain("localStorage:rsemble.runHistory.v1");
    expect(provenance?.textContent).toContain("Source event");
    expect(provenance?.textContent).toContain(new Date(1_700_000_000_000).toLocaleString());
    expect(provenance?.textContent).toContain("Imported");
    expect(provenance?.textContent).toContain(new Date(1_700_050_000_000).toLocaleString());

    // Disclosure panel reveals the validated raw payload (including unnormalized extra fields).
    const disclosure = harness.container.querySelector<HTMLButtonElement>(
      "button[data-payload-disclosure]",
    )!;
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(harness.container.querySelector("[data-payload-panel]")).toBeNull();
    await act(async () => {
      disclosure.click();
    });
    const panel = harness.container.querySelector("[data-payload-panel]");
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("max-h-96");
    expect(panel?.textContent).toContain('"extraRawField":"raw-unnormalized-value"');
    act(() => harness.root.unmount());
  });

  it("does not fabricate an Imported line when legacy summary has no importedAt metadata", async () => {
    const unaugmentedLegacy: LegacyRunSummary = {
      ...legacySummary,
      createdAt: 1_700_000_000_000,
    };
    const repo = repository({
      getReference: vi.fn(async () => legacyReference),
      getLegacySummary: vi.fn(async () => unaugmentedLegacy),
    });
    const harness = await renderDetail(repo as RecordsRepository, "legacy", "legacy-1");
    const provenance = harness.container.querySelector("[data-section='provenance']");
    expect(provenance).not.toBeNull();
    expect(provenance?.textContent).toContain("Source event");
    expect(provenance?.textContent).toContain(new Date(1_700_000_000_000).toLocaleString());
    // Must NOT label createdAt as Imported or fabricate an Imported line.
    const dtElements = Array.from(provenance?.querySelectorAll("dt") ?? []).map((el) =>
      el.textContent?.trim(),
    );
    expect(dtElements).not.toContain("Imported");
    act(() => harness.root.unmount());
  });
});
