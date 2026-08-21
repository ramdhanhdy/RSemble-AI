import { describe, expect, it, vi } from "vitest";
import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import type { FullRunSummaryV2 } from "../persistence/run-types";
import { createRecordsRepository } from "./records-repository";

const runSummary: FullRunSummaryV2 = {
  kind: "full",
  schemaVersion: 2,
  id: "run-1",
  revision: 0,
  createdAt: 1_000,
  completedAt: 1_100,
  status: "completed",
  mode: "rank",
  source: { kind: "adhoc" },
  taskTitle: "Compare task",
  taskExcerpt: "Exact input",
  modelKeys: ["openrouter:qwen3.8-max"],
  winnerKeys: [],
  scoresByModelKey: {},
  judgeModelKey: null,
  evaluationProfileId: null,
  evaluationProfileVersion: null,
  detailAvailable: true,
  searchText: "compare task exact input openrouter:qwen3.8-max",
};

const comparison: ComparisonResultIndex = {
  id: "run-1",
  runId: "run-1",
  createdAt: 1_000,
  updatedAt: 1_100,
  status: "completed",
  mode: "rank",
  title: "Compare task",
  taskBinding: { kind: "ad_hoc", inputSnapshotRef: "input-1" },
  taskInstanceId: null,
  activeObservationIds: [],
  evidenceReceiptRevision: 0,
  lineage: { repeatedFrom: null },
  revision: 0,
};

function dependencies() {
  return {
    runRepo: {
      list: vi.fn(async ({ offset = 0 }: { offset?: number }) =>
        offset === 0 ? [runSummary] : [],
      ),
      get: vi.fn(async () => null),
    },
    comparisonRepo: {
      listComparisonResults: vi.fn(async ({ offset = 0 }: { offset?: number }) =>
        offset === 0 ? [comparison] : [],
      ),
      getComparisonResult: vi.fn(async () => null),
    },
    evaluationRepo: {
      listExperiments: vi.fn(async () => []),
      listSuites: vi.fn(async () => []),
      getExperiment: vi.fn(async () => null),
    },
    studyRepo: {
      listStudies: vi.fn(async () => []),
      listTrials: vi.fn(async () => []),
      listObservations: vi.fn(async () => []),
      getStudy: vi.fn(async () => null),
    },
    evidenceRepo: {
      listObservations: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 500 })),
      listModelConfigurations: vi.fn(async () => []),
      getObservation: vi.fn(async () => null),
    },
  };
}

describe("RecordsRepository", () => {
  it("composes semantic and exact references behind a read-only API", async () => {
    const repository = createRecordsRepository(dependencies() as never);
    const page = await repository.list({});
    expect(page.items.map((item) => `${item.recordType}:${item.id}`)).toEqual([
      "comparison:run-1",
      "task-execution:run-1",
    ]);
    expect(Object.keys(repository).sort()).toEqual([
      "getLegacySummary",
      "getObservation",
      "getPolicyStudyChildren",
      "getPolicyStudyRecord",
      "getReference",
      "getTaskExecution",
      "list",
    ]);
  });

  it("loads sources to completion before applying Type and pagination", async () => {
    const deps = dependencies();
    const repository = createRecordsRepository(deps as never);
    const page = await repository.list({ type: "comparison", limit: 1, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.recordType).toBe("comparison");
    expect(deps.runRepo.list).toHaveBeenCalledWith({ limit: 500, offset: 0 });
    expect(deps.comparisonRepo.listComparisonResults).toHaveBeenCalledWith({
      limit: 500,
      offset: 0,
    });
  });

  it("returns null for an unknown typed identity", async () => {
    const repository = createRecordsRepository(dependencies() as never);
    await expect(repository.getReference("observation", "missing")).resolves.toBeNull();
  });
});
