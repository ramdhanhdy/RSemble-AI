import { describe, expect, it } from "vitest";
import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import type { Observation } from "../evidence/evidence-types";
import type { ExperimentRecord } from "../evaluations/evaluation-types";
import type { RunSummary } from "../persistence/run-types";
import type { PolicyStudyRecord } from "../studies/policy/policy-study-types";
import type { RecordReference } from "./record-reference";
import { composeRecordReferences, queryRecords } from "./records-query";

function reference(
  id: string,
  createdAt: number,
  recordType: RecordReference["recordType"] = "task-execution",
): RecordReference {
  if (recordType === "legacy") {
    return {
      recordType,
      id,
      createdAt,
      updatedAt: createdAt,
      title: id,
      status: null,
      mode: null,
      source: "legacy",
      modelKeys: [],
      searchText: id,
      ownerHint: "Origin unresolved — preserved as imported",
      ownerCrosswalk: null,
    };
  }
  return {
    recordType: "task-execution",
    id,
    createdAt,
    updatedAt: createdAt,
    title: id,
    status: "completed",
    mode: "rank",
    source: "adhoc",
    modelKeys: ["openrouter:qwen3.8-max"],
    searchText: `${id} openrouter:qwen3.8-max`,
    ownerHint: "in Compare",
    runSource: { kind: "adhoc", comparisonId: id },
  };
}

function fullRun(id: string, createdAt: number): RunSummary {
  return {
    kind: "full",
    schemaVersion: 2,
    id,
    revision: 0,
    createdAt,
    completedAt: createdAt + 10,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    taskTitle: `Task ${id}`,
    taskExcerpt: "Exact prompt excerpt",
    modelKeys: ["openrouter:qwen3.8-max"],
    winnerKeys: [],
    scoresByModelKey: {},
    judgeModelKey: null,
    evaluationProfileId: null,
    evaluationProfileVersion: null,
    detailAvailable: true,
    searchText: `task ${id} exact prompt excerpt openrouter:qwen3.8-max`,
  };
}

describe("composeRecordReferences", () => {
  it("interleaves semantic references and exact Task Executions without hiding leaves", () => {
    const comparison: ComparisonResultIndex = {
      id: "run-1",
      runId: "run-1",
      createdAt: 1_000,
      updatedAt: 1_100,
      status: "completed",
      mode: "rank",
      title: "Task run-1",
      taskBinding: { kind: "ad_hoc", inputSnapshotRef: "input-1" },
      taskInstanceId: null,
      activeObservationIds: [],
      evidenceReceiptRevision: 0,
      lineage: { repeatedFrom: null },
      revision: 0,
    };
    const refs = composeRecordReferences({
      runSummaries: [fullRun("run-1", 1_000)],
      comparisons: [comparison],
      evaluations: [],
      policyStudies: [],
      observations: [],
      modelConfigurations: [],
      policyStudyIdByRunId: {},
    });
    expect(refs.map((item) => `${item.recordType}:${item.id}`)).toEqual([
      "comparison:run-1",
      "task-execution:run-1",
    ]);
  });

  it("maps every source index to its own typed identity", () => {
    const evaluation = {
      id: "evaluation-1",
      revision: 0,
      suiteId: "task-set-1",
      suiteVersion: 2,
      protocolFingerprint: "sha256:test",
      status: "completed_with_failures",
      execution: null,
      snapshot: {
        suiteId: "task-set-1",
        suiteVersion: 2,
        tasks: [],
        modelSlots: [
          {
            id: "slot-1",
            providerId: "openrouter",
            provider: "OpenRouter",
            model: "Qwen",
            slug: "qwen3.8-max",
            enabled: true,
          },
        ],
        defaultJudge: {} as never,
        defaultEvaluation: {} as never,
        profiles: [],
        protocolFingerprint: "sha256:test",
        createdAt: 2_000,
      },
      tasks: [
        {
          taskId: "task-1",
          selectedAttemptId: "attempt-1",
          attempts: [
            {
              id: "attempt-1",
              runId: "run-2",
              trial: 1,
              status: "completed",
              startedAt: 2_000,
              finishedAt: 2_100,
              error: null,
            },
          ],
        },
      ],
      createdAt: 2_000,
      updatedAt: 2_100,
    } as ExperimentRecord;
    const study = {
      id: "study-1",
      revision: 0,
      kind: "policy",
      title: "Policy study",
      status: "completed",
      claimLevel: "confirmed",
      createdAt: 3_000,
      updatedAt: 3_100,
      archivedAt: null,
    } as PolicyStudyRecord;
    const observation = {
      id: "observation-1",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      executionLineageId: "lineage-1",
      runId: "run-2",
      sourceTaskCellId: "cell-1",
      taskId: "task-1",
      taskVersion: 1,
      taskInstanceId: "instance-1",
      taskFamilyId: null,
      modelConfigurationId: "model-config-1",
      candidateAttemptId: "candidate-attempt-1",
      observedAt: 2_200,
    } as Observation;
    const refs = composeRecordReferences({
      runSummaries: [],
      comparisons: [],
      evaluations: [evaluation],
      policyStudies: [study],
      observations: [observation],
      modelConfigurations: [],
      policyStudyIdByRunId: {},
    });
    expect(refs.map((item) => item.recordType)).toEqual([
      "policy-study",
      "observation",
      "evaluation",
    ]);
    expect(refs.find((item) => item.recordType === "evaluation")).toMatchObject({
      childRunIds: ["run-2"],
      modelKeys: ["openrouter:qwen3.8-max"],
    });
  });
});

describe("queryRecords", () => {
  it("sorts deterministically by newest time, then id, then type", () => {
    const records = [reference("b", 10), reference("a", 10), reference("z", 20)];
    expect(queryRecords(records, {}).items.map((item) => item.id)).toEqual(["z", "a", "b"]);
  });

  it("applies every filter to the complete set before pagination", () => {
    const records = Array.from({ length: 55 }, (_, index) =>
      reference(`ordinary-${index}`, 100 + index),
    );
    records.push({ ...reference("target", 1), searchText: "target unique marker" });
    const result = queryRecords(records, { text: "unique marker", limit: 50 });
    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(["target"]);
  });

  it("combines Type with the preserved text/model/status/mode/source filters", () => {
    const records: RecordReference[] = [reference("task", 2), reference("legacy", 1, "legacy")];
    expect(
      queryRecords(records, {
        type: "task-execution",
        text: "task",
        modelKey: "openrouter:qwen3.8-max",
        status: "completed",
        mode: "rank",
        source: "adhoc",
      }).items.map((item) => item.id),
    ).toEqual(["task"]);
    expect(queryRecords(records, { type: "legacy" }).items.map((item) => item.id)).toEqual([
      "legacy",
    ]);
  });
});
