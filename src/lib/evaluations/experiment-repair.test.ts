// =============================================================================
// experiment-repair.test.ts — pure compound-repair planner (spec §11, Task 9).
// =============================================================================
import { describe, expect, it } from "vitest";
import { planMissingCellRepair } from "./experiment-repair";
import { aggregateExperiment } from "./experiment-aggregation";
import type {
  ExperimentRecord,
  ExperimentSnapshot,
  ExperimentTaskState,
  ExperimentTaskAttempt,
} from "./evaluation-types";
import type { RunRecordV2, PersistedCandidate } from "../persistence/run-types";
import type { CandidateEvaluation, ModelSlot } from "../../studio-data";

const SLOTS: ModelSlot[] = [
  { id: "s1", providerId: "openrouter", provider: "OR", model: "A", slug: "m1", enabled: true },
  { id: "s2", providerId: "openrouter", provider: "OR", model: "B", slug: "m2", enabled: true },
  { id: "s3", providerId: "openrouter", provider: "OR", model: "C", slug: "m3", enabled: true },
];
const MK1 = "openrouter:m1";
const MK2 = "openrouter:m2";
const MK3 = "openrouter:m3";

function makeSnapshot(taskIds: string[]): ExperimentSnapshot {
  return {
    suiteId: "suite-1",
    suiteVersion: 1,
    tasks: taskIds.map((id, i) => ({
      id,
      title: `Task ${id}`,
      prompt: `Prompt ${id}`,
      systemPrompt: "",
      evaluation: { kind: "holistic" as const },
      judgeInstructionOverride: "",
      order: i,
    })),
    modelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" as const },
    profiles: [],
    protocolFingerprint: "sha256:abc",
    createdAt: 1000,
  };
}

function makeRun(runId: string, scoredKeys: string[]): RunRecordV2 {
  const candidates: PersistedCandidate[] = SLOTS.map((slot, i) => {
    const key = `${slot.providerId}:${slot.slug}`;
    const accepted = scoredKeys.includes(key);
    return {
      candidateId: `cand-${i}`,
      slotId: slot.id,
      modelKey: key,
      providerId: slot.providerId,
      model: slot.model,
      slug: slot.slug,
      acceptedAttemptId: accepted ? `att-cand-${i}` : null,
      attempts: accepted
        ? [
            {
              attemptId: `att-cand-${i}`,
              messages: [],
              startedAt: 100,
              finishedAt: 200,
              status: "completed",
              output: `output-${key}`,
              tokensIn: 1,
              tokensOut: 1,
              error: null,
            },
          ]
        : [],
    };
  });
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  scoredKeys.forEach((_key, i) => {
    evaluationsById[`cand-${i}`] = {
      candidateId: `cand-${i}`,
      blindLabel: "A",
      overallScore: 4,
      position: "p",
      rationale: "r",
      strengths: ["s"],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    };
  });
  return {
    schemaVersion: 2,
    id: runId,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 1100,
    status: "partial",
    mode: "rank",
    source: {
      kind: "experiment",
      experimentId: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "sha256:abc",
      taskId: "t1",
      experimentTaskAttemptId: "att-t1",
      trial: 0,
    },
    task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates,
    judge: {
      status: "done",
      acceptedAttemptId: "judge-att-1",
      report: { labelMap: [], evaluationsById, comparisons: [] },
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

function makeExperiment(taskIds: string[], taskStates: ExperimentTaskState[]): ExperimentRecord {
  return {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status: "completed_with_failures",
    execution: null,
    snapshot: makeSnapshot(taskIds),
    tasks: taskStates,
    createdAt: 1000,
    updatedAt: 2000,
  };
}

function makeTaskState(
  taskId: string,
  attempts: ExperimentTaskAttempt[],
  selectedAttemptId: string | null,
): ExperimentTaskState {
  return { taskId, selectedAttemptId, attempts };
}

function makeAttempt(id: string, runId: string | null, status: ExperimentTaskAttempt["status"]): ExperimentTaskAttempt {
  return {
    id,
    runId,
    trial: 0,
    status,
    startedAt: 100,
    finishedAt: status === "running" || status === "queued" ? null : 200,
    error: null,
  };
}

/** 3 models on t1: m1+m2 scored, m3 missing (no-score). */
function makeRepairableFixture() {
  const run = makeRun("run-base", [MK1, MK2]);
  const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-base", "partial")], "att-t1")];
  const experiment = makeExperiment(["t1"], taskStates);
  const aggregation = aggregateExperiment({
    snapshot: experiment.snapshot,
    taskStates,
    resolveRunRecord: () => run,
  });
  return { experiment, aggregation, run };
}

describe("planMissingCellRepair", () => {
  it("plans a single no-score cell repair with exact cost preview", () => {
    const { experiment, aggregation, run } = makeRepairableFixture();
    const result = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId: "t1", modelKeys: [MK3] },
      resolveRunRecord: () => run,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.taskId).toBe("t1");
    expect(result.plan.baseRunId).toBe("run-base");
    expect(result.plan.requestedModelKeys).toEqual([MK3]);
    expect(result.plan.reusedModelKeys).toEqual([MK1, MK2]);
    expect(result.plan.candidateCalls).toBe(1);
    expect(result.plan.judgeCalls).toBe(1);
  });

  it("repairs models added after a selected completed run using trusted extension lineage", () => {
    const baseRun = makeRun("run-base", [MK1]);
    const taskStates = [
      makeTaskState("t1", [makeAttempt("att-t1", "run-base", "completed")], "att-t1"),
    ];
    const original = makeExperiment(["t1"], taskStates);
    const experiment: ExperimentRecord = {
      ...original,
      protocolFingerprint: "sha256:current",
      snapshot: { ...original.snapshot, protocolFingerprint: "sha256:current" },
      rosterExtensions: [
        {
          addedModelKey: MK2,
          addedSlot: SLOTS[1],
          priorFingerprint: "sha256:abc",
          extendedAt: 1100,
        },
        {
          addedModelKey: MK3,
          addedSlot: SLOTS[2],
          priorFingerprint: "sha256:after-m2",
          extendedAt: 1200,
        },
      ],
    };
    const aggregation = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => baseRun,
    });

    const result = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId: "t1", modelKeys: [MK2, MK3] },
      resolveRunRecord: () => baseRun,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.requestedModelKeys).toEqual([MK2, MK3]);
    expect(result.plan.reusedModelKeys).toEqual([MK1]);
    expect(result.plan.candidateCalls).toBe(2);
  });

  it("plans several missing cells on the same task as one plan", () => {
    const { experiment } = makeRepairableFixture();
    const run2 = makeRun("run-base", [MK1]);
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-base", "partial")], "att-t1")];
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => run2,
    });
    const result = planMissingCellRepair({
      experiment,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK2, MK3] },
      resolveRunRecord: () => run2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.requestedModelKeys).toEqual([MK2, MK3]);
    expect(result.plan.candidateCalls).toBe(2);
  });

  it("rejects duplicate requested keys deterministically", () => {
    const { experiment, aggregation, run } = makeRepairableFixture();
    const result = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId: "t1", modelKeys: [MK3, MK3] },
      resolveRunRecord: () => run,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/duplicate/i);
  });

  it("rejects scored cells — they cannot be repaid through repair", () => {
    const { experiment, aggregation, run } = makeRepairableFixture();
    const result = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId: "t1", modelKeys: [MK1] },
      resolveRunRecord: () => run,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no-score/i);
  });

  it("rejects when there is no base selected run", () => {
    const { experiment } = makeRepairableFixture();
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", null, "failed")], null)];
    const experiment2 = makeExperiment(["t1"], taskStates);
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => null,
    });
    const result = planMissingCellRepair({
      experiment: experiment2,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK3] },
      resolveRunRecord: () => null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBeTruthy();
  });

  it("rejects evidence-missing cells (run unavailable)", () => {
    const { experiment } = makeRepairableFixture();
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-gone", "partial")], "att-t1")];
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => null,
    });
    const result = planMissingCellRepair({
      experiment,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK3] },
      resolveRunRecord: () => null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no-score|repair/i);
  });

  it("rejects a model outside the snapshot roster", () => {
    const { experiment, aggregation, run } = makeRepairableFixture();
    const result = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId: "t1", modelKeys: ["openrouter:not-in-roster"] },
      resolveRunRecord: () => run,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/snapshot roster/i);
  });

  it("rejects an unknown task id", () => {
    const { experiment, aggregation, run } = makeRepairableFixture();
    const result = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId: "t-unknown", modelKeys: [MK3] },
      resolveRunRecord: () => run,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not found/i);
  });

  it("rejects when no accepted candidate outputs are reusable", () => {
    const { experiment } = makeRepairableFixture();
    const run = makeRun("run-base", []);
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-base", "partial")], "att-t1")];
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => run,
    });
    const result = planMissingCellRepair({
      experiment,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK1, MK2, MK3] },
      resolveRunRecord: () => run,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/reuse/i);
  });

  it("rejects a base run whose id does not match the selected attempt", () => {
    const { experiment } = makeRepairableFixture();
    const wrongRun = { ...makeRun("run-WRONG", [MK1, MK2]) };
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-base", "partial")], "att-t1")];
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => wrongRun,
    });
    const result = planMissingCellRepair({
      experiment,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK3] },
      resolveRunRecord: () => wrongRun,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/id does not match/i);
  });

  it("rejects a base run from a different experiment", () => {
    const { experiment } = makeRepairableFixture();
    const baseRun = makeRun("run-base", [MK1, MK2]);
    const otherExpRun = {
      ...baseRun,
      source: {
        ...baseRun.source,
        experimentId: "exp-OTHER",
      },
    };
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-base", "partial")], "att-t1")];
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => otherExpRun,
    });
    const result = planMissingCellRepair({
      experiment,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK3] },
      resolveRunRecord: () => otherExpRun,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/different experiment/i);
  });

  it("rejects a base run with a mismatched protocol fingerprint", () => {
    const { experiment } = makeRepairableFixture();
    const baseRun = makeRun("run-base", [MK1, MK2]);
    const mismatchedRun = {
      ...baseRun,
      source: {
        ...baseRun.source,
        protocolFingerprint: "sha256:DIFFERENT",
      },
    };
    const taskStates = [makeTaskState("t1", [makeAttempt("att-t1", "run-base", "partial")], "att-t1")];
    const aggregation2 = aggregateExperiment({
      snapshot: experiment.snapshot,
      taskStates,
      resolveRunRecord: () => mismatchedRun,
    });
    const result = planMissingCellRepair({
      experiment,
      aggregation: aggregation2,
      request: { taskId: "t1", modelKeys: [MK3] },
      resolveRunRecord: () => mismatchedRun,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/protocol fingerprint/i);
  });
});
