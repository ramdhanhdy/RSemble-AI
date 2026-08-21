import { describe, expect, it } from "vitest";
import { resolveRecordOwner } from "./record-owner";
import type {
  LegacyRecordReference,
  ObservationRecordReference,
  PolicyStudyReference,
  TaskExecutionRecordReference,
} from "./record-reference";

const base = {
  createdAt: 1_000,
  updatedAt: 1_100,
  title: "Record",
  status: "completed" as const,
  mode: null,
  source: null,
  modelKeys: [] as string[],
  searchText: "record",
  ownerHint: "owner",
};

describe("resolveRecordOwner", () => {
  it("routes Policy Studies only to the Lab", () => {
    const ref: PolicyStudyReference = {
      ...base,
      recordType: "policy-study",
      id: "study-1",
      claimLevel: "exploratory",
    };
    expect(resolveRecordOwner(ref)).toEqual({
      ownerKind: "lab",
      ownerHref: "/lab/studies/study-1",
      ownerLabel: "Policy Study in the Lab",
      confidence: "exact",
      reason: null,
    });
  });

  it("resolves exact task execution owners from persisted source identity", () => {
    const comparison: TaskExecutionRecordReference = {
      ...base,
      recordType: "task-execution",
      id: "run-1",
      mode: "rank",
      source: "adhoc",
      runSource: { kind: "adhoc", comparisonId: "run-1" },
    };
    const evaluation: TaskExecutionRecordReference = {
      ...comparison,
      id: "run-2",
      source: "experiment",
      runSource: {
        kind: "experiment",
        evaluationExecutionId: "evaluation-1",
        taskSetId: "task-set-1",
      },
    };
    expect(resolveRecordOwner(comparison).ownerHref).toBe("/compare/results/run-1");
    expect(resolveRecordOwner(evaluation).ownerHref).toBe("/evaluations/results/evaluation-1");
  });

  it("resolves observations to their exact semantic source", () => {
    const ref: ObservationRecordReference = {
      ...base,
      recordType: "observation",
      id: "observation-1",
      source: "experiment",
      sourceKind: "evaluation",
      sourceResultId: "evaluation-1",
      runId: "run-1",
      taskId: "task-1",
      modelConfigurationId: "model-config-1",
    };
    expect(resolveRecordOwner(ref)).toMatchObject({
      ownerKind: "evaluation",
      ownerHref: "/evaluations/results/evaluation-1",
      confidence: "exact",
    });
  });

  it("uses an explicit historical crosswalk but never guesses an owner", () => {
    const mapped: LegacyRecordReference = {
      ...base,
      recordType: "legacy",
      id: "legacy-1",
      status: null,
      source: "legacy",
      ownerCrosswalk: {
        ownerKind: "task",
        ownerHref: "/tasks/task-1/versions/2",
        ownerLabel: "Task v2",
        reason: "Mapped via the canonical Task migration crosswalk",
      },
    };
    const unresolved: LegacyRecordReference = {
      ...mapped,
      id: "legacy-2",
      ownerCrosswalk: null,
    };
    expect(resolveRecordOwner(mapped)).toMatchObject({
      confidence: "crosswalk",
      ownerHref: "/tasks/task-1/versions/2",
    });
    expect(resolveRecordOwner(unresolved)).toEqual({
      ownerKind: "legacy",
      ownerHref: null,
      ownerLabel: "Origin unresolved",
      confidence: "unresolved",
      reason: "No exact owner or historical crosswalk is stored for this record.",
    });
  });
});
