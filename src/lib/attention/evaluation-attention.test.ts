import { describe, expect, it } from "vitest";
import { aggregateExperiment } from "../evaluations/experiment-aggregation";
import type {
  ExperimentRecord,
  ExperimentSnapshot,
  ExperimentTaskAttempt,
  ExperimentTaskState,
} from "../evaluations/evaluation-types";
import type { PersistedCandidate, RunRecordV2 } from "../persistence/run-types";
import type { CandidateEvaluation, ModelSlot } from "../../studio-data";
import { queryEvaluationAttention } from "./evaluation-attention";

const SLOTS: ModelSlot[] = [
  { id: "s1", providerId: "openrouter", provider: "OR", model: "A", slug: "m1", enabled: true },
  { id: "s2", providerId: "openrouter", provider: "OR", model: "B", slug: "m2", enabled: true },
  { id: "s3", providerId: "openrouter", provider: "OR", model: "C", slug: "m3", enabled: true },
];
const MK1 = "openrouter:m1";
const MK2 = "openrouter:m2";

function snapshot(taskIds: string[]): ExperimentSnapshot {
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

function attempt(
  id: string,
  status: ExperimentTaskAttempt["status"],
  extras: Partial<ExperimentTaskAttempt> = {},
): ExperimentTaskAttempt {
  return {
    id,
    runId: extras.runId ?? "run-1",
    trial: extras.trial ?? 0,
    status,
    startedAt: 100,
    finishedAt: status === "running" || status === "queued" ? null : 200,
    error: null,
    ...extras,
  };
}

function experiment(
  status: ExperimentRecord["status"],
  taskStates: ExperimentTaskState[],
  extras: Partial<ExperimentRecord> = {},
): ExperimentRecord {
  return {
    id: "exp-1",
    revision: 1,
    suiteId: "suite-1",
    suiteVersion: 1,
    protocolFingerprint: "sha256:abc",
    status,
    execution: null,
    snapshot: snapshot(taskStates.map((t) => t.taskId)),
    tasks: taskStates,
    createdAt: 1000,
    updatedAt: 2000,
    ...extras,
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

function ownerOf(items: ReturnType<typeof queryEvaluationAttention>) {
  return items.map((item) => ({
    reasonCode: item.reasonCode,
    ownerHref: item.ownerHref,
    kind: item.kind,
  }));
}

describe("queryEvaluationAttention INCLUDE", () => {
  it("includes interrupted evaluation with incomplete tasks", () => {
    const exp = experiment("interrupted", [
      { taskId: "t1", selectedAttemptId: "a1", attempts: [attempt("a1", "interrupted")] },
    ]);
    const items = queryEvaluationAttention({ experiment: exp });
    expect(ownerOf(items)).toEqual([
      {
        reasonCode: "evaluation_interrupted",
        ownerHref: "/evaluations/results/exp-1",
        kind: "evaluation_recovery",
      },
    ]);
  });

  it("includes aborted evaluation with retryable attempts", () => {
    const exp = experiment("aborted", [
      { taskId: "t1", selectedAttemptId: "a1", attempts: [attempt("a1", "failed")] },
    ]);
    expect(ownerOf(queryEvaluationAttention({ experiment: exp }))).toEqual([
      {
        reasonCode: "evaluation_tasks_incomplete",
        ownerHref: "/evaluations/results/exp-1",
        kind: "evaluation_recovery",
      },
    ]);
  });

  it("includes repairable missing cells", () => {
    const run = makeRun("run-base", [MK1, MK2]);
    const exp = experiment("completed_with_failures", [
      { taskId: "t1", selectedAttemptId: "att-t1", attempts: [attempt("att-t1", "partial", { runId: "run-base" })] },
    ]);
    const aggregation = aggregateExperiment({
      snapshot: exp.snapshot,
      taskStates: exp.tasks,
      resolveRunRecord: () => run,
    });
    const items = queryEvaluationAttention({
      experiment: exp,
      aggregation,
      resolveRunRecord: () => run,
    });
    expect(items).toHaveLength(1);
    expect(items[0].reasonCode).toBe("evaluation_cells_repairable");
    expect(items[0].ownerHref).toBe("/evaluations/results/exp-1");
  });

  it("includes fallback retry when a missing cell is not repairable", () => {
    const exp = experiment("completed_with_failures", [
      { taskId: "t1", selectedAttemptId: null, attempts: [attempt("a1", "failed")] },
    ]);
    expect(queryEvaluationAttention({ experiment: exp })[0]?.reasonCode).toBe(
      "evaluation_tasks_incomplete",
    );
  });

  it("includes interrupted roster-extension attempt on an otherwise completed task", () => {
    const exp = experiment("completed", [
      {
        taskId: "t1",
        selectedAttemptId: "done",
        attempts: [
          attempt("done", "completed"),
          attempt("ext", "interrupted", {
            trial: 1,
            repair: { kind: "roster-extension", addedModelKey: "openrouter:m4" },
          }),
        ],
      },
    ]);
    expect(queryEvaluationAttention({ experiment: exp })[0]?.reasonCode).toBe(
      "evaluation_tasks_incomplete",
    );
  });
});

describe("queryEvaluationAttention EXCLUDE", () => {
  it.each(["draft", "queued", "running", "paused"] as const)("excludes %s execution", (status) => {
    const exp = experiment(status, [
      { taskId: "t1", selectedAttemptId: null, attempts: [attempt("a1", "failed")] },
    ]);
    expect(queryEvaluationAttention({ experiment: exp })).toEqual([]);
  });

  it("excludes completed evaluation with full coverage", () => {
    const exp = experiment("completed", [
      { taskId: "t1", selectedAttemptId: "a1", attempts: [attempt("a1", "completed")] },
    ]);
    expect(queryEvaluationAttention({ experiment: exp })).toEqual([]);
  });

  it("excludes aborted evaluation with no retryable attempts", () => {
    const exp = experiment("aborted", [
      { taskId: "t1", selectedAttemptId: "a1", attempts: [attempt("a1", "completed")] },
    ]);
    expect(queryEvaluationAttention({ experiment: exp })).toEqual([]);
  });

  it("excludes resolved roster extension history", () => {
    const exp = experiment(
      "completed",
      [{ taskId: "t1", selectedAttemptId: "a1", attempts: [attempt("a1", "completed")] }],
      {
        rosterExtensions: [
          {
            addedModelKey: "openrouter:m4",
            addedSlot: {
              id: "s4",
              providerId: "openrouter",
              provider: "OR",
              model: "D",
              slug: "m4",
              enabled: true,
            },
            priorFingerprint: "sha256:old",
            extendedAt: 1500,
          },
        ],
      },
    );
    expect(queryEvaluationAttention({ experiment: exp })).toEqual([]);
  });

  it("excludes ordinary provisional standings without a recovery action", () => {
    const exp = experiment("completed", [
      { taskId: "t1", selectedAttemptId: "a1", attempts: [attempt("a1", "completed")] },
    ]);
    expect(queryEvaluationAttention({ experiment: exp, declaredPartialWorkload: true })).toEqual([]);
  });
});
