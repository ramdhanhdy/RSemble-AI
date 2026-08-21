// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Observation } from "../../lib/evidence/evidence-types";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type { RecordsRepository } from "../../lib/records/records-repository";
import type {
  ObservationRecordReference,
  PolicyStudyReference,
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
    getPolicyStudyRecord: vi.fn(async () => null),
    getPolicyStudyChildren: vi.fn(async () => ({
      trialCount: 142,
      observationCount: 12,
      exactRunCount: 25,
      items: Array.from({ length: 20 }, (_, index) => child(index)),
    })),
    ...overrides,
  };
}

async function renderDetail(
  repo: RecordsRepository,
  recordType: "policy-study" | "observation" | "task-execution",
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
