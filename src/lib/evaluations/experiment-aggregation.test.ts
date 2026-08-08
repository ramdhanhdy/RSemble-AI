// =============================================================================
// experiment-aggregation.ts — failing tests (Task 6.1)
//
// V1 aggregation (spec §12.2):
//   model-task score = canonical score from that task's selectedAttemptId
//   model overall    = arithmetic mean of available canonical task scores
//   coverage         = scored tasks / total suite tasks
// Missing results are missing — never silently zero. Only complete-coverage
// models are winner-eligible. Ties within 1e-9 of raw aggregate share the win.
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  aggregateExperiment,
  canonicalScoresFromRun,
  formatTaskScore,
  formatAggregateMean,
  boundedAggregateMean,
} from "./experiment-aggregation";
import { deriveDisplayRanking } from "./experiment-ranking";
import type {
  EvaluationCriterion,
  EvaluationProfile,
  ExperimentSnapshot,
  ExperimentTaskState,
} from "./evaluation-types";
import type { RunRecordV2 } from "../persistence/run-types";
import { type CandidateEvaluation, type ModelSlot } from "../../studio-data";

// --- Fixtures -------------------------------------------------------------------

const CRITERIA: EvaluationCriterion[] = [
  {
    id: "c1",
    name: "Correctness",
    description: "Is it right",
    weight: 3,
    anchors: { one: "wrong", three: "ok", five: "right" },
  },
  {
    id: "c2",
    name: "Clarity",
    description: "Is it clear",
    weight: 1,
    anchors: { one: "muddy", three: "ok", five: "clear" },
  },
];

const PROFILE: EvaluationProfile = {
  id: "p1",
  version: 2,
  name: "Quality",
  description: "d",
  judgeInstruction: "",
  criteria: CRITERIA,
  createdAt: 100,
  updatedAt: 100,
};

function makeSlot(id: string, slug: string, providerId = "openrouter"): ModelSlot {
  return {
    id,
    providerId: providerId as ModelSlot["providerId"],
    provider: "OR",
    model: `Model ${slug}`,
    slug,
    enabled: true,
  };
}

const SLOTS: ModelSlot[] = [makeSlot("s1", "m1"), makeSlot("s2", "m2", "gemini")];
const MK1 = "openrouter:m1";
const MK2 = "gemini:m2";

function makeSnapshot(taskIds: string[]): ExperimentSnapshot {
  return {
    suiteId: "suite-1",
    suiteVersion: 1,
    tasks: taskIds.map((id, i) => ({
      id,
      title: `Task ${id}`,
      prompt: `Prompt ${id}`,
      systemPrompt: "",
      evaluation: { kind: "holistic" },
      judgeInstructionOverride: "",
      order: i,
    })),
    modelSlots: SLOTS,
    defaultJudge: { providerId: "openrouter", model: "judge" },
    defaultEvaluation: { kind: "holistic" },
    profiles: [],
    protocolFingerprint: "sha256:abc",
    createdAt: 1000,
  };
}

function makeEvaluation(
  candidateId: string,
  overallScore: number,
  criterionScores?: Array<{ criterionId: string; score: number }>,
): CandidateEvaluation {
  return {
    candidateId,
    blindLabel: "A",
    overallScore,
    position: "p",
    rationale: "r",
    strengths: ["s"],
    deductions: [],
    missedRequirements: [],
    criterionScores: (criterionScores ?? []).map((cs) => ({
      criterionId: cs.criterionId,
      label: cs.criterionId,
      score: cs.score,
      rationale: "r",
    })),
  };
}

/** Minimal RunRecordV2 carrying only the fields aggregation reads. */
function makeRun(
  runId: string,
  scores: Record<string, number>,
  opts: {
    profile?: EvaluationProfile | null;
    criterionScores?: Record<string, Record<string, number>>;
  } = {},
): RunRecordV2 {
  const candidates = Object.keys(scores).map((modelKey, i) => ({
    candidateId: `cand-${i}`,
    slotId: `slot-${i}`,
    modelKey,
    providerId: modelKey.split(":")[0],
    model: modelKey,
    slug: modelKey.split(":")[1],
    acceptedAttemptId: `att-cand-${i}`,
    attempts: [],
  }));
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  Object.keys(scores).forEach((modelKey, i) => {
    const cid = `cand-${i}`;
    const cs = opts.criterionScores?.[modelKey];
    evaluationsById[cid] = makeEvaluation(
      cid,
      scores[modelKey],
      cs ? Object.entries(cs).map(([criterionId, score]) => ({ criterionId, score })) : undefined,
    );
  });
  return {
    schemaVersion: 2,
    id: runId,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 1100,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: opts.profile ?? null, candidateMessages: [] },
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

function makeTaskState(
  taskId: string,
  attempts: Array<{
    id: string;
    runId: string;
    status: ExperimentTaskState["attempts"][number]["status"];
  }>,
  selectedAttemptId: string | null,
): ExperimentTaskState {
  return {
    taskId,
    selectedAttemptId,
    attempts: attempts.map((a, i) => ({
      id: a.id,
      runId: a.runId,
      trial: i,
      status: a.status,
      startedAt: 100,
      finishedAt: 200,
      error: null,
    })),
  };
}

function aggregate(
  taskIds: string[],
  taskStates: ExperimentTaskState[],
  runs: Record<string, RunRecordV2>,
) {
  return aggregateExperiment({
    snapshot: makeSnapshot(taskIds),
    taskStates,
    resolveRunRecord: (runId) => runs[runId] ?? null,
  });
}

// --- canonicalScoresFromRun -----------------------------------------------------

describe("canonicalScoresFromRun", () => {
  it("returns the judge overall score in holistic mode", () => {
    const run = makeRun("r1", { [MK1]: 4.2, [MK2]: 3.1 });
    expect(canonicalScoresFromRun(run)).toEqual({ [MK1]: 4.2, [MK2]: 3.1 });
  });

  it("computes the canonical weighted score from criterion scores", () => {
    // (5*3 + 1*1) / (3+1) = 16/4 = 4.0 for m1; (2*3 + 4*1)/4 = 2.5 for m2
    const run = makeRun(
      "r1",
      { [MK1]: 0, [MK2]: 0 },
      {
        profile: PROFILE,
        criterionScores: {
          [MK1]: { c1: 5, c2: 1 },
          [MK2]: { c1: 2, c2: 4 },
        },
      },
    );
    const scores = canonicalScoresFromRun(run);
    expect(scores[MK1]).toBeCloseTo(4.0, 10);
    expect(scores[MK2]).toBeCloseTo(2.5, 10);
  });
});

// --- aggregateExperiment -----------------------------------------------------------

describe("aggregateExperiment", () => {
  it("each task contributes scores from exactly one selectedAttemptId", () => {
    // Task t1 has two completed attempts with different scores; selection a2
    // must win and a1's scores must never appear or blend in.
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 1.0, [MK2]: 1.0 }),
      "r-a2": makeRun("r-a2", { [MK1]: 5.0, [MK2]: 4.0 }),
      "r-b1": makeRun("r-b1", { [MK1]: 3.0, [MK2]: 3.0 }),
    };
    const taskStates = [
      makeTaskState(
        "t1",
        [
          { id: "a1", runId: "r-a1", status: "completed" },
          { id: "a2", runId: "r-a2", status: "completed" },
        ],
        "a2",
      ),
      makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "completed" }], "b1"),
    ];
    const result = aggregate(["t1", "t2"], taskStates, runs);

    const t1Cells = result.cells[0];
    expect(t1Cells[0]).toMatchObject({
      kind: "scored",
      score: 5.0,
      attemptId: "a2",
      runId: "r-a2",
    });
    expect(t1Cells[1]).toMatchObject({ kind: "scored", score: 4.0 });

    // Means: m1 = (5+3)/2 = 4.0, m2 = (4+3)/2 = 3.5
    const m1 = result.models.find((m) => m.modelKey === MK1)!;
    const m2 = result.models.find((m) => m.modelKey === MK2)!;
    expect(m1.mean).toBeCloseTo(4.0, 10);
    expect(m2.mean).toBeCloseTo(3.5, 10);
    expect(result.winnerKeys).toEqual([MK1]);
  });

  it("computes coverage as scored tasks / total tasks and means over available scores", () => {
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 4.0, [MK2]: 2.0 }),
      "r-b1": makeRun("r-b1", { [MK1]: 2.0 }), // m2 failed this task — no score
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "completed" }], "a1"),
      makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "partial" }], "b1"),
    ];
    const result = aggregate(["t1", "t2"], taskStates, runs);

    const m1 = result.models.find((m) => m.modelKey === MK1)!;
    const m2 = result.models.find((m) => m.modelKey === MK2)!;

    expect(m1.mean).toBeCloseTo(3.0, 10);
    expect(m1.scoredTasks).toBe(2);
    expect(m1.totalTasks).toBe(2);
    expect(m1.complete).toBe(true);

    // Missing is not zero: m2's mean is over its ONE available score, not (2+0)/2.
    expect(m2.mean).toBeCloseTo(2.0, 10);
    expect(m2.scoredTasks).toBe(1);
    expect(m2.complete).toBe(false);

    // The missing cell is explicit.
    const m2t2 = result.cells[1][1];
    expect(m2t2.kind).toBe("missing");
    if (m2t2.kind === "missing") expect(m2t2.reason).toBe("no-score");
  });

  it("only complete-coverage models are winner-eligible", () => {
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 2.0, [MK2]: 5.0 }),
      "r-b1": makeRun("r-b1", { [MK1]: 2.0 }), // m2 missing → incomplete
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "completed" }], "a1"),
      makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "partial" }], "b1"),
    ];
    const result = aggregate(["t1", "t2"], taskStates, runs);
    // m2 has the higher mean but incomplete coverage → m1 wins.
    expect(result.winnerKeys).toEqual([MK1]);
  });

  it("no complete-coverage model yields no winner", () => {
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 4.0 }),
      "r-b1": makeRun("r-b1", { [MK2]: 4.5 }),
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "partial" }], "a1"),
      makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "partial" }], "b1"),
    ];
    const result = aggregate(["t1", "t2"], taskStates, runs);
    expect(result.winnerKeys).toEqual([]);
  });

  it("task order does not change the aggregate", () => {
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 4.0, [MK2]: 2.0 }),
      "r-b1": makeRun("r-b1", { [MK1]: 2.0, [MK2]: 4.0 }),
    };
    const t1 = makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "completed" }], "a1");
    const t2 = makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "completed" }], "b1");

    const forward = aggregate(["t1", "t2"], [t1, t2], runs);
    const reversed = aggregate(["t2", "t1"], [t2, t1], runs);

    expect(forward.models).toEqual(reversed.models);
    expect(forward.winnerKeys).toEqual(reversed.winnerKeys);
  });

  it("values within 1e-9 epsilon remain tied", () => {
    const diff = 5e-10; // below WINNER_EPSILON
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 3.0 + diff, [MK2]: 3.0 }),
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "completed" }], "a1"),
    ];
    const result = aggregate(["t1"], taskStates, runs);
    expect(result.winnerKeys.sort()).toEqual([MK1, MK2].sort());
  });

  it("values that look equal after rounding but exceed epsilon are NOT tied", () => {
    // Both display "3.00" at two decimals, but the raw difference exceeds 1e-9.
    const runs = {
      "r-a1": makeRun("r-a1", { [MK1]: 3.004, [MK2]: 2.996 }),
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "completed" }], "a1"),
    ];
    const result = aggregate(["t1"], taskStates, runs);
    expect(result.winnerKeys).toEqual([MK1]);
  });

  it("task with no accepted attempt produces missing cells with an explicit reason", () => {
    const runs = {
      "r-b1": makeRun("r-b1", { [MK1]: 3.0, [MK2]: 3.0 }),
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "failed" }], null),
      makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "completed" }], "b1"),
    ];
    const result = aggregate(["t1", "t2"], taskStates, runs);
    for (const cell of result.cells[0]) {
      expect(cell.kind).toBe("missing");
      if (cell.kind === "missing") expect(cell.reason).toBe("no-accepted-attempt");
    }
    // A task that never ran has a distinct reason.
    const taskStates2 = [
      makeTaskState("t1", [], null),
      makeTaskState("t2", [{ id: "b1", runId: "r-b1", status: "completed" }], "b1"),
    ];
    const result2 = aggregate(["t1", "t2"], taskStates2, runs);
    const cell = result2.cells[0][0];
    if (cell.kind === "missing") expect(cell.reason).toBe("no-attempt");
    expect(cell.kind).toBe("missing");
  });

  it("canonical profile scores flow into cells and means", () => {
    const runs = {
      "r-a1": makeRun(
        "r-a1",
        { [MK1]: 0, [MK2]: 0 },
        {
          profile: PROFILE,
          criterionScores: {
            [MK1]: { c1: 5, c2: 1 }, // canonical 4.0
            [MK2]: { c1: 2, c2: 4 }, // canonical 2.5
          },
        },
      ),
    };
    const taskStates = [
      makeTaskState("t1", [{ id: "a1", runId: "r-a1", status: "completed" }], "a1"),
    ];
    const result = aggregate(["t1"], taskStates, runs);
    expect(result.cells[0][0]).toMatchObject({ kind: "scored", score: 4.0 });
    expect(result.cells[0][1]).toMatchObject({ kind: "scored", score: 2.5 });
    expect(result.winnerKeys).toEqual([MK1]);
  });
});

// --- display formatting -------------------------------------------------------------

describe("display formatting", () => {
  it("task cells display one decimal", () => {
    expect(formatTaskScore(3.26)).toBe("3.3");
    expect(formatTaskScore(4)).toBe("4.0");
  });

  it("aggregate means display two decimals", () => {
    expect(formatAggregateMean(3.14159)).toBe("3.14");
    expect(formatAggregateMean(3)).toBe("3.00");
    expect(formatAggregateMean(2.996)).toBe("3.00");
  });
});

// --- Ranking semantics regression (Task 1.2) ----------------------------------

describe("aggregateExperiment — winner vs provisional ranking", () => {
  // Exact shape from the implementation plan:
  //   complete  = { modelKey: "umans:model",  mean: 4.38, scoredTasks: 15, totalTasks: 15, complete: true }
  //   provisional = { modelKey: "9router:model", mean: 4.54, scoredTasks: 14, totalTasks: 15, complete: false }
  it("keeps the complete-coverage model winner-eligible over a higher-mean incomplete model", () => {
    const taskIds = Array.from({ length: 15 }, (_, i) => `t${i + 1}`);
    const taskStates: ExperimentTaskState[] = [];
    const runs: Record<string, RunRecordV2> = {};
    for (let i = 0; i < 15; i++) {
      const taskId = taskIds[i];
      const runId = `r-${taskId}`;
      const scores: Record<string, number> = { "umans:model": 4.38 };
      if (i < 14) scores["9router:model"] = 4.54;
      runs[runId] = makeRun(runId, scores);
      taskStates.push(
        makeTaskState(taskId, [{ id: `a-${taskId}`, runId, status: "completed" }], `a-${taskId}`),
      );
    }
    const snapshot: ExperimentSnapshot = {
      suiteId: "s",
      suiteVersion: 1,
      tasks: taskIds.map((id, i) => ({
        id,
        title: `Task ${id}`,
        prompt: "p",
        systemPrompt: "",
        evaluation: { kind: "holistic" as const },
        judgeInstructionOverride: "",
        order: i,
      })),
      modelSlots: [
        {
          id: "s1",
          providerId: "umans",
          provider: "Umans",
          model: "Model",
          slug: "model",
          enabled: true,
        },
        {
          id: "s2",
          providerId: "9router",
          provider: "9Router",
          model: "Route",
          slug: "model",
          enabled: true,
        },
      ],
      defaultJudge: { providerId: "openrouter", model: "judge" },
      defaultEvaluation: { kind: "holistic" as const },
      profiles: [],
      protocolFingerprint: "sha256:abc",
      createdAt: 1000,
    };
    const result = aggregateExperiment({
      snapshot,
      taskStates,
      resolveRunRecord: (runId) => runs[runId] ?? null,
    });

    // The complete model is the winner.
    expect(result.winnerKeys).toContain("umans:model");
    expect(result.winnerKeys).not.toContain("9router:model");

    // The provisional model has a higher mean but is not complete.
    const provisional = result.models.find((m) => m.modelKey === "9router:model");
    expect(provisional).toBeTruthy();
    expect(provisional!.complete).toBe(false);
    expect(provisional!.mean).toBeGreaterThan(4.38);
    expect(provisional!.scoredTasks).toBe(14);

    // The complete model has complete coverage.
    const complete = result.models.find((m) => m.modelKey === "umans:model");
    expect(complete).toBeTruthy();
    expect(complete!.complete).toBe(true);
    expect(complete!.scoredTasks).toBe(15);
  });
});

// --- Hybrid floored-task aggregation ------------------------------------------

/** A mixed profile with graded criterion + one binary group (lambda default 1). */
/** 5 singleton binary groups + 1 graded criterion (Q=1, λ=1).
 *  C = passCount / 5, so rankValue = 1 - (1 - C) = C.
 *  Valid graded score 1 (integer) + native binary booleans. */
function makeFlooredHybridProfile(): { profile: EvaluationProfile; checkIds: string[] } {
  const checkIds = ["b1", "b2", "b3", "b4", "b5"];
  const profile: EvaluationProfile = {
    id: "p-floored",
    version: 1,
    name: "Floored",
    description: "",
    judgeInstruction: "",
    criteria: [
      {
        id: "quality",
        kind: "graded",
        name: "Quality",
        description: "d",
        weight: 1,
        anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
      },
      ...checkIds.map((id) => ({
        id,
        kind: "binary" as const,
        name: `Check ${id}`,
        description: "d",
        trueWhen: "t",
        falseWhen: "f",
      })),
    ],
    requirementGroups: checkIds.map((id, i) => ({
      id: `g${i + 1}`,
      name: `Group ${i + 1}`,
      checkIds: [id],
      weight: 1,
      mode: "ALL" as const,
    })),
    complianceInfluence: 1.0,
    createdAt: 100,
    updatedAt: 100,
  };
  return { profile, checkIds };
}

/** Make a run with valid Q=1 (graded score 1) and `passCount` of 5 binary
 *  checks passing. rankValue = 1 - 1*(1 - passCount/5) = passCount/5. */
function makeFlooredHybridRun(runId: string, passCount: number): RunRecordV2 {
  const { profile, checkIds } = makeFlooredHybridProfile();
  const criterionScores: CandidateEvaluation["criterionScores"] = [
    { criterionId: "quality", label: "Quality", kind: "graded", score: 1, rationale: "r" },
    ...checkIds.map((id, i) => ({
      criterionId: id,
      label: `Check ${id}`,
      kind: "binary" as const,
      value: i < passCount,
      rationale: "r",
    })),
  ];
  const evaluationsById: Record<string, CandidateEvaluation> = {
    [MK1]: {
      candidateId: MK1,
      blindLabel: "A",
      overallScore: 1,
      position: "p",
      rationale: "r",
      strengths: [],
      deductions: [],
      missedRequirements: [],
      criterionScores,
    },
  };
  return {
    schemaVersion: 2,
    id: runId,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 1100,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile, candidateMessages: [] },
    candidates: [
      {
        candidateId: MK1,
        slotId: "s1",
        modelKey: MK1,
        providerId: "openrouter",
        model: MK1,
        slug: "m1",
        acceptedAttemptId: "att-cand",
        attempts: [],
      },
    ],
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

describe("hybrid floored-task aggregation (rankValue authority)", () => {
  it("aggregates authoritative rankValue across tasks, not bounded rankScore", () => {
    // Two tasks, single model. Q=1 (valid graded score 1), λ=1, 5 singleton
    // binary groups → C = passCount/5, rankValue = passCount/5.
    // Task t1: 4/5 pass → C=0.8 → rankValue=0.8 (floored, rankScore=1)
    // Task t2: 1/5 pass → C=0.2 → rankValue=0.2 (floored, rankScore=1)
    const run1 = makeFlooredHybridRun("r1", 4);
    const run2 = makeFlooredHybridRun("r2", 1);
    const snapshot = makeSnapshot(["t1", "t2"]);
    const aggregation = aggregateExperiment({
      snapshot,
      taskStates: [
        makeTaskState("t1", [{ id: "a1", runId: "r1", status: "completed" }], "a1"),
        makeTaskState("t2", [{ id: "a1", runId: "r2", status: "completed" }], "a1"),
      ],
      resolveRunRecord: (runId) => (runId === "r1" ? run1 : run2),
    });
    const model = aggregation.models[0];
    // rankValue t1 = 0.8, t2 = 0.2 → mean = 0.5 (authoritative, both floored).
    expect(model.mean).toBeCloseTo(0.5, 10);
    // The bounded mean would be 1.0 (both rankScore=1) — a false tie that the
    // authoritative aggregation avoids.
    expect(model.mean).not.toBeCloseTo(1.0, 10);
    expect(model.complete).toBe(true);
    expect(aggregation.winnerKeys).toEqual([MK1]);
  });
});

// --- §16.2 floored audit: raw rankValue mean vs bounded display ---------------

describe("hybrid floored mean vs bounded display (§16.2)", () => {
  function gradedRun(
    runId: string,
    aKey: string,
    aPassCount: number,
    bKey: string,
    bPassCount: number,
  ): RunRecordV2 {
    // Valid hybrid profile: Q=1 (graded score 1), λ=1, 5 singleton binary
    // groups. C = passCount/5, rankValue = 1 - 1*(1-C) = C = passCount/5.
    const checkIds = ["b1", "b2", "b3", "b4", "b5"];
    const profile: EvaluationProfile = {
      id: "p-q",
      version: 1,
      name: "Floored",
      description: "",
      judgeInstruction: "",
      criteria: [
        {
          id: "quality",
          kind: "graded",
          name: "Quality",
          description: "d",
          weight: 1,
          anchors: { one: "1", two: "2", three: "3", four: "4", five: "5" },
        },
        ...checkIds.map((id) => ({
          id,
          kind: "binary" as const,
          name: `Check ${id}`,
          description: "d",
          trueWhen: "t",
          falseWhen: "f",
        })),
      ],
      requirementGroups: checkIds.map((id, i) => ({
        id: `g${i + 1}`,
        name: `Group ${i + 1}`,
        checkIds: [id],
        weight: 1,
        mode: "ALL" as const,
      })),
      complianceInfluence: 1.0,
      createdAt: 100,
      updatedAt: 100,
    };
    const mk = (key: string, passCount: number): CandidateEvaluation => ({
      candidateId: key,
      blindLabel: "A",
      overallScore: 1,
      position: "p",
      rationale: "r",
      strengths: ["s"],
      deductions: [],
      missedRequirements: [],
      criterionScores: [
        { criterionId: "quality", label: "Quality", kind: "graded", score: 1, rationale: "r" },
        ...checkIds.map((id, i) => ({
          criterionId: id,
          label: `Check ${id}`,
          kind: "binary" as const,
          value: i < passCount,
          rationale: "r",
        })),
      ],
    });
    return {
      schemaVersion: 2,
      id: runId,
      revision: 1,
      execution: { ownerId: "tab-1", fence: 1 },
      createdAt: 1000,
      updatedAt: 1000,
      completedAt: 1100,
      status: "completed",
      mode: "rank",
      source: { kind: "adhoc" },
      task: { title: "t", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile, candidateMessages: [] },
      candidates: [
        {
          candidateId: aKey,
          slotId: "s1",
          modelKey: aKey,
          providerId: aKey.split(":")[0],
          model: aKey,
          slug: aKey.split(":")[1],
          acceptedAttemptId: "a",
          attempts: [],
        },
        {
          candidateId: bKey,
          slotId: "s2",
          modelKey: bKey,
          providerId: bKey.split(":")[0],
          model: bKey,
          slug: bKey.split(":")[1],
          acceptedAttemptId: "a",
          attempts: [],
        },
      ],
      judge: {
        status: "done",
        acceptedAttemptId: "j",
        report: {
          labelMap: [],
          evaluationsById: { [aKey]: mk(aKey, aPassCount), [bKey]: mk(bKey, bPassCount) },
          comparisons: [],
        },
        consensus: null,
        attempts: [],
      },
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
      winnerKeys: [],
    };
  }

  it("orders by raw aggregate mean, not the bounded display value", () => {
    // Two complete-coverage models across two tasks; MK1 always passes 4/5
    // binary groups (C=0.8, rankValue=0.8), MK2 always passes 1/5
    // (C=0.2, rankValue=0.2). Both floored (rankValue < 1).
    const agg = aggregateExperiment({
      snapshot: makeSnapshot(["ta", "tb"]),
      taskStates: [
        makeTaskState("ta", [{ id: "a1", runId: "r1", status: "completed" }], "a1"),
        makeTaskState("tb", [{ id: "a1", runId: "r2", status: "completed" }], "a1"),
      ],
      resolveRunRecord: (rid) => gradedRun(rid, MK1, 4, MK2, 1),
    });
    const a = agg.models.find((m) => m.modelKey === MK1)!;
    const b = agg.models.find((m) => m.modelKey === MK2)!;
    expect(a.mean).toBeCloseTo(0.8, 10);
    expect(b.mean).toBeCloseTo(0.2, 10);
    expect(a.flooredTaskCount).toBe(2);
    expect(b.flooredTaskCount).toBe(2);
    expect(boundedAggregateMean(a.mean!)).toBe(1);
    expect(boundedAggregateMean(b.mean!)).toBe(1);
    expect(agg.winnerKeys).toEqual([MK1]);
    // deriveDisplayRanking orders MK1 first (raw mean), then MK2.
    const ranking = deriveDisplayRanking(agg.models, new Map());
    expect(ranking.eligible.map((m) => m.modelKey)).toEqual([MK1, MK2]);
  });
});
