import { describe, expect, it } from "vitest";
import {
  isRecordReference,
  type ComparisonRecordReference,
  type LegacyRecordReference,
  type PolicyStudyReference,
  type TaskExecutionRecordReference,
} from "./record-reference";

function comparison(overrides: Partial<ComparisonRecordReference> = {}): ComparisonRecordReference {
  return {
    recordType: "comparison",
    id: "comparison-1",
    createdAt: 1_000,
    updatedAt: 1_100,
    title: "Compare response quality",
    status: "completed",
    mode: "rank",
    source: "adhoc",
    modelKeys: ["openrouter:qwen3.8-max"],
    searchText: "compare response quality openrouter:qwen3.8-max",
    ownerHint: "in Compare",
    runId: "run-1",
    taskBinding: { kind: "ad_hoc", inputSnapshotRef: "input-1" },
    ...overrides,
  };
}

describe("RecordReference", () => {
  it("accepts each typed reference without copying exact evidence", () => {
    const policyStudy: PolicyStudyReference = {
      recordType: "policy-study",
      id: "study-1",
      createdAt: 2_000,
      updatedAt: 2_100,
      title: "Judge policy study",
      status: "completed",
      mode: null,
      source: null,
      modelKeys: [],
      searchText: "judge policy study",
      ownerHint: "in the Lab",
      claimLevel: "confirmed",
    };
    const taskExecution: TaskExecutionRecordReference = {
      recordType: "task-execution",
      id: "run-1",
      createdAt: 1_000,
      updatedAt: 1_100,
      title: "Compare response quality",
      status: "completed",
      mode: "rank",
      source: "adhoc",
      modelKeys: ["openrouter:qwen3.8-max"],
      searchText: "run-1 compare response quality",
      ownerHint: "in Compare",
      runSource: { kind: "adhoc", comparisonId: "comparison-1" },
    };
    expect(isRecordReference(comparison())).toBe(true);
    expect(isRecordReference(policyStudy)).toBe(true);
    expect(isRecordReference(taskExecution)).toBe(true);
    expect("candidates" in comparison()).toBe(false);
    expect("judge" in policyStudy).toBe(false);
  });

  it("rejects type coercion and credential-shaped fields", () => {
    expect(isRecordReference({ ...comparison(), recordType: "evaluation" })).toBe(false);
    expect(isRecordReference({ ...comparison(), apiKey: "secret" })).toBe(false);
    expect(
      isRecordReference({ ...comparison(), ownerCrosswalk: { authorization: "Bearer secret" } }),
    ).toBe(false);
  });

  it("keeps legacy identity unresolved without fabricated status, mode, or owner", () => {
    const legacy: LegacyRecordReference = {
      recordType: "legacy",
      id: "legacy-1",
      createdAt: 500,
      updatedAt: 500,
      title: "Imported record",
      status: null,
      mode: null,
      source: "legacy",
      modelKeys: [],
      searchText: "legacy-1 imported record",
      ownerHint: "Origin unresolved — preserved as imported",
      ownerCrosswalk: null,
    };
    expect(isRecordReference(legacy)).toBe(true);
    expect(legacy.status).toBeNull();
    expect(legacy.mode).toBeNull();
  });
});
