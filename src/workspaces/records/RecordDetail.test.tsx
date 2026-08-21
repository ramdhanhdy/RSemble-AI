// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Observation } from "../../lib/evidence/evidence-types";
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
  recordType: "policy-study" | "observation",
  recordId: string,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <RecordDetail repository={repo} recordType={recordType} recordId={recordId} />
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
});
