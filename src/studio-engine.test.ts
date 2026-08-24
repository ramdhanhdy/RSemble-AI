import { describe, it, expect } from "vitest";
import { reducer, initialState, type StudioState } from "./studio-engine";
import {
  type Candidate,
  type JudgeReport,
  type JudgeComparison,
  type JudgeCriterionScore,
} from "./studio-data";
import type { ProviderId, ReasoningPolicy } from "./lib/providers/types";
import type { RubricSnapshot } from "./lib/evaluations/evaluation-types";
import { HOLISTIC_EVALUATION } from "./lib/evaluations/evaluation-rubric-adhoc";
import type { Attachment } from "./lib/attachments/types";
import { MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "./lib/attachments/limits";

function makeCandidate(id: string, providerId: ProviderId, slug: string): Candidate {
  return {
    id,
    model: slug,
    provider: providerId,
    providerId,
    slug,
    accent: "A",
    strategy: "Parallel model",
    summary: "",
    scores: {},
    weightedScore: 0,
    segments: [],
    status: "pending",
  };
}

function runningStateWithCandidates(
  candidates: Candidate[],
  mode: "rank" | "fuse" = "rank",
): StudioState {
  return {
    ...initialState,
    mode,
    running: true,
    candidates,
    judgeStatus: "running",
    fusionStatus: mode === "fuse" ? "idle" : "idle",
  };
}

describe("reducer — JUDGE_FAILED terminates run in all modes", () => {
  it("clears running and sets judgeStatus to error in RANK mode", () => {
    const state = runningStateWithCandidates(
      [makeCandidate("c1", "openrouter", "model-a"), makeCandidate("c2", "umans", "model-b")],
      "rank",
    );
    const next = reducer(state, { type: "JUDGE_FAILED", error: "judge exploded" });
    expect(next.running).toBe(false);
    expect(next.judgeStatus).toBe("error");
    expect(next.judgeError).toBe("judge exploded");
  });

  it("clears running and sets judgeStatus to error in FUSE mode (does not proceed to fusion)", () => {
    const state = runningStateWithCandidates(
      [makeCandidate("c1", "openrouter", "model-a"), makeCandidate("c2", "umans", "model-b")],
      "fuse",
    );
    const next = reducer(state, { type: "JUDGE_FAILED", error: "judge exploded" });
    expect(next.running).toBe(false);
    expect(next.judgeStatus).toBe("error");
    expect(next.judgeError).toBe("judge exploded");
    // Fusion must not have been started
    expect(next.fusionStatus).toBe("idle");
  });
});

describe("reducer — FUSION_FAILED terminates run", () => {
  it("clears running and sets fusionStatus to error", () => {
    const state: StudioState = {
      ...initialState,
      mode: "fuse",
      running: true,
      candidates: [makeCandidate("c1", "openrouter", "model-a")],
      fusionStatus: "running",
      judgeStatus: "done",
    };
    const next = reducer(state, { type: "FUSION_FAILED", error: "fusion exploded" });
    expect(next.running).toBe(false);
    expect(next.fusionStatus).toBe("error");
    expect(next.fusionError).toBe("fusion exploded");
  });
});

describe("reducer — JUDGE_RESULT stores actual judge scores", () => {
  it("updates weightedScore from scoresById, not stale values", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const c2 = makeCandidate("c2", "umans", "model-b");
    const state = runningStateWithCandidates([c1, c2], "rank");
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.5, c2: 3.2 },
      report: makeReport([]),
    });
    // In rank mode, running clears after judge
    expect(next.running).toBe(false);
    expect(next.judgeStatus).toBe("done");
    // Scores should come from scoresById
    const updated1 = next.candidates.find((c) => c.id === "c1")!;
    const updated2 = next.candidates.find((c) => c.id === "c2")!;
    expect(updated1.weightedScore).toBe(4.5);
    expect(updated2.weightedScore).toBe(3.2);
  });

  it("keeps running=true in FUSE mode after JUDGE_RESULT (continues to fusion)", () => {
    const state = runningStateWithCandidates(
      [makeCandidate("c1", "openrouter", "model-a"), makeCandidate("c2", "umans", "model-b")],
      "fuse",
    );
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "fuse",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.0, c2: 3.5 },
      report: makeReport([]),
    });
    expect(next.running).toBe(true);
    expect(next.judgeStatus).toBe("done");
  });

  it("uses captured RANK mode when the current UI mode changed to FUSE", () => {
    const state = runningStateWithCandidates(
      [makeCandidate("c1", "openrouter", "model-a"), makeCandidate("c2", "umans", "model-b")],
      "fuse",
    );
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4, c2: 3 },
      report: makeReport([]),
    });
    expect(next.running).toBe(false);
  });

  it("uses captured FUSE mode when the current UI mode changed to RANK", () => {
    const state = runningStateWithCandidates(
      [makeCandidate("c1", "openrouter", "model-a"), makeCandidate("c2", "umans", "model-b")],
      "rank",
    );
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "fuse",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4, c2: 3 },
      report: makeReport([]),
    });
    expect(next.running).toBe(true);
  });
});

describe("reducer — INSUFFICIENT_CANDIDATES is terminal", () => {
  it("clears running and records done/failed counts", () => {
    const state = runningStateWithCandidates([makeCandidate("c1", "openrouter", "model-a")]);
    const next = reducer(state, { type: "INSUFFICIENT_CANDIDATES", done: 1, failed: 2 });
    expect(next.running).toBe(false);
    expect(next.insufficient).toEqual({ done: 1, failed: 2 });
  });
});

describe("reducer — RETRY_CANDIDATE_START resets the candidate and sets running", () => {
  it("marks target candidate as pending and clears judge/fusion state", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    c1.status = "error";
    c1.errorMessage = "failed";
    c1.weightedScore = 0;
    const state: StudioState = {
      ...initialState,
      running: false,
      candidates: [c1],
      judgeStatus: "done",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
    };
    const next = reducer(state, { type: "RETRY_CANDIDATE_START", id: "c1" });
    expect(next.running).toBe(true);
    expect(next.judgeStatus).toBe("idle");
    expect(next.judgeError).toBeNull();
    expect(next.consensus).toBeNull();
    expect(next.fusionStatus).toBe("idle");
    expect(next.fusedText).toBeNull();
    const retried = next.candidates.find((c) => c.id === "c1")!;
    expect(retried.status).toBe("pending");
    expect(retried.errorMessage).toBeUndefined();
    expect(retried.segments).toEqual([]);
    expect(retried.weightedScore).toBe(0);
  });
});

describe("reducer — RETRY_CANDIDATE_FAILED is terminal", () => {
  it("clears running and marks candidate as error", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    c1.status = "pending";
    const state: StudioState = {
      ...initialState,
      running: true,
      candidates: [c1],
    };
    const next = reducer(state, {
      type: "RETRY_CANDIDATE_FAILED",
      id: "c1",
      error: "retry failed",
      finishedAt: 123,
    });
    expect(next.running).toBe(false);
    const failed = next.candidates.find((c) => c.id === "c1")!;
    expect(failed.status).toBe("error");
    expect(failed.errorMessage).toBe("retry failed");
  });
});

describe("reducer — ABORT_RUN clears running", () => {
  it("sets aborted=true and clears pending candidates", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    c1.status = "pending";
    const state: StudioState = {
      ...initialState,
      running: true,
      candidates: [c1],
      judgeStatus: "running",
    };
    const next = reducer(state, { type: "ABORT_RUN" });
    expect(next.running).toBe(false);
    expect(next.aborted).toBe(true);
    expect(next.judgeStatus).toBe("idle");
    const aborted = next.candidates.find((c) => c.id === "c1")!;
    expect(aborted.status).toBe("error");
    expect(aborted.errorMessage).toBe("Aborted");
  });
});

describe("reducer — judge custom instruction", () => {
  it("initial state starts with an empty judgeInstruction", () => {
    expect(initialState.judgeInstruction).toBe("");
  });

  it("SET_JUDGE_INSTRUCTION stores the value in state", () => {
    const next = reducer(initialState, {
      type: "SET_JUDGE_INSTRUCTION",
      value: "Prefer concise answers.",
    });
    expect(next.judgeInstruction).toBe("Prefer concise answers.");
  });

  it("SET_JUDGE_INSTRUCTION overwrites a prior instruction", () => {
    const s: StudioState = { ...initialState, judgeInstruction: "old note" };
    const next = reducer(s, { type: "SET_JUDGE_INSTRUCTION", value: "new note" });
    expect(next.judgeInstruction).toBe("new note");
  });

  it("RESET_SESSION clears the judgeInstruction back to empty", () => {
    const s: StudioState = {
      ...initialState,
      judgeInstruction: "prefer brevity",
      candidates: [makeCandidate("c1", "openrouter", "model-a")],
    };
    const next = reducer(s, { type: "RESET_SESSION" });
    expect(next.judgeInstruction).toBe("");
  });
});

describe("reducer — RESET_SESSION preserves model selection", () => {
  it("keeps slots and critic while clearing run output", () => {
    const customSlots = [
      {
        id: "mine",
        providerId: "gemini" as const,
        provider: "Gemini",
        model: "Pro",
        slug: "gemini-2.5-pro",
        enabled: true,
      },
    ];
    const customCritic = { providerId: "umans" as const, model: "judge-x" };
    const s: StudioState = {
      ...initialState,
      slots: customSlots,
      critic: customCritic,
      prompt: "a task",
      candidates: [makeCandidate("c1", "openrouter", "model-a")],
      consensus: {
        consensus: ["x"],
        contradictions: [],
        uniqueInsights: [],
      },
    };
    const next = reducer(s, { type: "RESET_SESSION" });
    expect(next.slots).toEqual(customSlots);
    expect(next.critic).toEqual(customCritic);
    expect(next.prompt).toBe(initialState.prompt);
    expect(next.candidates).toEqual([]);
    expect(next.consensus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Judge report threading — JUDGE_RESULT stores the resolved report; stale
// reports are cleared on new run / retry / reset / judge failure; Rank/Fuse
// toggle preserves the report; criterion scores populate Candidate.scores.
// ---------------------------------------------------------------------------

function makeReport(
  entries: Array<{
    id: string;
    label: string;
    score: number;
    criterionScores?: JudgeCriterionScore[];
  }>,
  comparisons: JudgeComparison[] = [],
): JudgeReport {
  return {
    labelMap: entries.map((e) => ({ label: e.label, candidateId: e.id })),
    evaluationsById: Object.fromEntries(
      entries.map((e) => [
        e.id,
        {
          candidateId: e.id,
          blindLabel: e.label,
          overallScore: e.score,
          position: `pos ${e.label}`,
          rationale: `why ${e.label}`,
          strengths: ["s"],
          deductions: [],
          missedRequirements: [],
          criterionScores: e.criterionScores ?? [],
        },
      ]),
    ),
    comparisons,
  };
}

describe("reducer — JUDGE_RESULT stores the judge report", () => {
  it("stores judgeReport with evaluations keyed by candidate IDs, not blind labels", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const c2 = makeCandidate("c2", "umans", "model-b");
    const state = runningStateWithCandidates([c1, c2], "rank");
    const report = makeReport([
      { id: "c1", label: "B", score: 4.5 },
      { id: "c2", label: "A", score: 3.2 },
    ]);
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.5, c2: 3.2 },
      report,
    });
    expect(next.judgeReport).toBe(report);
    expect(next.judgeReport?.evaluationsById["c1"].blindLabel).toBe("B");
    expect(next.judgeReport?.evaluationsById["c2"].blindLabel).toBe("A");
  });

  it("populates Candidate.scores from criterion scores, keyed by criterion display label", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const c2 = makeCandidate("c2", "umans", "model-b");
    const state = runningStateWithCandidates([c1, c2], "rank");
    const report = makeReport([
      {
        id: "c1",
        label: "A",
        score: 4.5,
        criterionScores: [
          {
            criterionId: "commercial-reasoning",
            label: "Commercial reasoning",
            score: 4.7,
            rationale: "r",
          },
          {
            criterionId: "constraint-awareness",
            label: "Constraint awareness",
            score: 3.9,
            rationale: "r",
          },
        ],
      },
      { id: "c2", label: "B", score: 3.2 },
    ]);
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.5, c2: 3.2 },
      report,
    });
    const scored = next.candidates.find((c) => c.id === "c1")!;
    expect(scored.scores).toEqual({
      "Commercial reasoning": 4.7,
      "Constraint awareness": 3.9,
    });
    // Candidates without criterion scores keep an empty scores map (not wiped
    // with invented dimensions).
    const unscored = next.candidates.find((c) => c.id === "c2")!;
    expect(unscored.scores).toEqual({});
  });

  it("does not populate criterion scores when no criteria are defined (no invention)", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state = runningStateWithCandidates([c1], "rank");
    const report = makeReport([{ id: "c1", label: "A", score: 4.5, criterionScores: [] }]);
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.5 },
      report,
    });
    const scored = next.candidates.find((c) => c.id === "c1")!;
    expect(scored.scores).toEqual({});
  });

  it("disambiguates duplicate criterion display labels by appending the criterion id", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state = runningStateWithCandidates([c1], "rank");
    // Two criteria share the display label "Reasoning".
    const report = makeReport([
      {
        id: "c1",
        label: "A",
        score: 4.5,
        criterionScores: [
          { criterionId: "commercial", label: "Reasoning", score: 4.7, rationale: "r" },
          { criterionId: "logical", label: "Reasoning", score: 4.1, rationale: "r" },
        ],
      },
    ]);
    const next = reducer(state, {
      type: "JUDGE_RESULT",
      mode: "rank",
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      scoresById: { c1: 4.5 },
      report,
    });
    const scores = next.candidates.find((c) => c.id === "c1")!.scores;
    expect(Object.keys(scores).sort()).toEqual(["Reasoning (commercial)", "Reasoning (logical)"]);
    expect(scores["Reasoning (commercial)"]).toBe(4.7);
    expect(scores["Reasoning (logical)"]).toBe(4.1);
  });
});

describe("reducer — stale reports are cleared correctly", () => {
  it("FANOUT_START clears a prior judgeReport", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state: StudioState = {
      ...initialState,
      running: false,
      candidates: [c1],
      judgeStatus: "done",
      judgeReport: makeReport([{ id: "c1", label: "A", score: 4.0 }]),
    };
    const next = reducer(state, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: {
        prompt: state.prompt,
        evaluation: state.evaluation,
        attachments: [],
        attachmentsToJudge: true,
      },
    });
    expect(next.judgeReport).toBeNull();
  });

  it("RESET_SESSION clears the judgeReport", () => {
    const state: StudioState = {
      ...initialState,
      candidates: [makeCandidate("c1", "openrouter", "model-a")],
      judgeReport: makeReport([{ id: "c1", label: "A", score: 4.0 }]),
    };
    const next = reducer(state, { type: "RESET_SESSION" });
    expect(next.judgeReport).toBeNull();
  });

  it("RETRY_CANDIDATE_START clears the stale judgeReport (retry invalidates the prior judgment)", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state: StudioState = {
      ...initialState,
      running: false,
      candidates: [c1],
      judgeStatus: "done",
      judgeReport: makeReport([{ id: "c1", label: "A", score: 4.0 }]),
    };
    const next = reducer(state, { type: "RETRY_CANDIDATE_START", id: "c1" });
    expect(next.judgeReport).toBeNull();
  });

  it("JUDGE_FAILED clears any stale report so a half-populated report is never retained", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state: StudioState = {
      ...initialState,
      running: true,
      candidates: [c1],
      judgeStatus: "running",
      judgeReport: makeReport([{ id: "c1", label: "A", score: 4.0 }]),
    };
    const next = reducer(state, { type: "JUDGE_FAILED", error: "judge down" });
    expect(next.judgeReport).toBeNull();
  });
});

describe("reducer — Rank/Fuse toggle preserves the report", () => {
  it("SET_MODE does not discard the judgeReport", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state: StudioState = {
      ...initialState,
      mode: "rank",
      candidates: [c1],
      judgeStatus: "done",
      judgeReport: makeReport([{ id: "c1", label: "A", score: 4.0 }]),
    };
    const next = reducer(state, { type: "SET_MODE", mode: "fuse" });
    expect(next.mode).toBe("fuse");
    expect(next.judgeReport).not.toBeNull();
  });
});

describe("reducer — initial state has a null judgeReport", () => {
  it("initialState.judgeReport is null", () => {
    expect(initialState.judgeReport).toBeNull();
  });
});

describe("reducer — FANOUT_START clears fusion state (regression)", () => {
  it("a new run resets fusionStatus/fusedText so a stale 'done' fusion cannot suppress the next run", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const state: StudioState = {
      ...initialState,
      mode: "fuse",
      running: false,
      candidates: [c1],
      fusionStatus: "done",
      fusedText: "stale fused text",
      fusionError: "stale error",
    };
    const next = reducer(state, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: {
        prompt: state.prompt,
        evaluation: state.evaluation,
        attachments: [],
        attachmentsToJudge: true,
      },
    });
    expect(next.fusionStatus).toBe("idle");
    expect(next.fusedText).toBeNull();
    expect(next.fusionError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Run evaluation context + Judge-only retry stage state (run-recovery spec §5)
// ---------------------------------------------------------------------------

describe("reducer — retained run evaluation context", () => {
  // initialState.evaluation is holistic — context tests need a real rubric.
  const testRubric = (): RubricSnapshot => ({
    id: "tp",
    version: 1,
    name: "Test Rubric",
    description: "test",
    judgeInstruction: "",
    criteria: [
      {
        id: "r1",
        name: "Correctness",
        description: "Is it right?",
        weight: 0.5,
        anchors: { one: "Poor", three: "OK", five: "Great" },
      },
      {
        id: "r2",
        name: "Clarity",
        description: "Is it clear?",
        weight: 0.3,
        anchors: { one: "Poor", three: "OK", five: "Great" },
      },
    ],
    createdAt: 1000,
    updatedAt: 1000,
  });
  const testEvaluation = () => ({ kind: "custom" as const, profile: testRubric() });

  it("FANOUT_START stores a deep-copied current-run evaluation context", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const evaluation = testEvaluation();
    const next = reducer(initialState, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: { prompt: "original task", evaluation, attachments: [], attachmentsToJudge: true },
    });
    expect(next.runContext).not.toBeNull();
    expect(next.runContext?.prompt).toBe("original task");
    expect(next.runContext?.evaluation).toEqual(evaluation);
    // Deep copy: the stored rubric must not alias the payload's object.
    expect(next.runContext?.evaluation).not.toBe(evaluation);
    expect(next.runContext?.evaluation).toEqual({ kind: "custom", profile: testRubric() });
  });

  it("replacing the command evaluation after fanout does not mutate the stored run evaluation", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const started = reducer(
      { ...initialState, evaluation: testEvaluation() },
      {
        type: "FANOUT_START",
        candidates: [{ ...c1, status: "pending" }],
        context: {
          prompt: "original task",
          evaluation: testEvaluation(),
          attachments: [],
          attachmentsToJudge: true,
        },
      },
    );
    const edited = reducer(started, { type: "SET_EVALUATION", config: HOLISTIC_EVALUATION });
    expect(edited.evaluation).toEqual({ kind: "holistic" });
    const stored = started.runContext?.evaluation;
    expect(stored).toEqual(testEvaluation());
  });

  it("FANOUT_START deep-copies the complete reasoning policy into the frozen context", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const policy: ReasoningPolicy = { candidates: "medium", judge: "high" };
    const next = reducer(initialState, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: {
        mode: "rank",
        task: { prompt: "task", systemPrompt: "system", temperature: 0.2 },
        prompt: "task",
        evaluation: HOLISTIC_EVALUATION,
        slots: [{ ...initialState.slots[0] }],
        critic: { ...initialState.critic },
        judgeInstruction: "frozen instruction",
        attachments: [],
        attachmentsToJudge: true,
        reasoningPolicy: policy,
      },
    });
    policy.candidates = "low";
    policy.judge = "minimal";
    expect(next.runContext?.reasoningPolicy).toEqual({ candidates: "medium", judge: "high" });
    expect(next.runContext?.reasoningPolicy).not.toBe(policy);
    expect(next.runContext?.mode).toBe("rank");
    expect(next.runContext?.task).toEqual({
      prompt: "task",
      systemPrompt: "system",
      temperature: 0.2,
    });
  });

  it("RESET_SESSION clears the retained run context", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const started = reducer(initialState, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: {
        prompt: "original task",
        evaluation: HOLISTIC_EVALUATION,
        attachments: [],
        attachmentsToJudge: true,
      },
    });
    expect(started.runContext).not.toBeNull();
    const reset = reducer(started, { type: "RESET_SESSION" });
    expect(reset.runContext).toBeNull();
  });

  it("a new fanout replaces the previous context", () => {
    const c1 = makeCandidate("c1", "openrouter", "model-a");
    const first = reducer(initialState, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: {
        prompt: "task one",
        evaluation: HOLISTIC_EVALUATION,
        attachments: [],
        attachmentsToJudge: true,
      },
    });
    const second = reducer(first, {
      type: "FANOUT_START",
      candidates: [{ ...c1, status: "pending" }],
      context: {
        prompt: "task two",
        evaluation: HOLISTIC_EVALUATION,
        attachments: [],
        attachmentsToJudge: true,
      },
    });
    expect(second.runContext?.prompt).toBe("task two");
  });
});

describe("reducer — JUDGE_START as a standalone active-stage transition", () => {
  const judgeErrorState = (mode: "rank" | "fuse" = "rank"): StudioState => ({
    ...initialState,
    mode,
    running: false,
    candidates: [
      { ...makeCandidate("c1", "openrouter", "model-a"), status: "done" },
      { ...makeCandidate("c2", "umans", "model-b"), status: "done" },
    ],
    judgeStatus: "error",
    judgeError: "judge exploded",
    judgeReport: makeReport([{ id: "c1", label: "A", score: 4.0 }]),
    consensus: { consensus: ["shared"], contradictions: [], uniqueInsights: [] },
    insufficient: { done: 2, failed: 1 },
    runContext: {
      prompt: "original task",
      evaluation: HOLISTIC_EVALUATION,
      attachments: [],
      attachmentsToJudge: true,
    },
  });

  it("sets running: true when the previous state is a Judge error", () => {
    const next = reducer(judgeErrorState(), { type: "JUDGE_START" });
    expect(next.running).toBe(true);
    expect(next.judgeStatus).toBe("running");
  });

  it("clears judgeError, stale report, consensus, and insufficient state", () => {
    const next = reducer(judgeErrorState(), { type: "JUDGE_START" });
    expect(next.judgeError).toBeNull();
    expect(next.judgeReport).toBeNull();
    expect(next.consensus).toBeNull();
    expect(next.insufficient).toBeNull();
  });

  it("in Fuse mode, retry start clears stale Fusion error and result", () => {
    const state: StudioState = {
      ...judgeErrorState("fuse"),
      fusionStatus: "error",
      fusionError: "fusion exploded",
      fusedText: "stale fused text",
    };
    const next = reducer(state, { type: "JUDGE_START" });
    expect(next.fusionStatus).toBe("idle");
    expect(next.fusionError).toBeNull();
    expect(next.fusedText).toBeNull();
  });

  it("retains the run context for the new Judge attempt", () => {
    const state = judgeErrorState();
    const next = reducer(state, { type: "JUDGE_START" });
    expect(next.runContext).toBe(state.runContext);
  });
});

describe("reducer — standalone Fusion transition", () => {
  it("FUSION_START marks the app running so Judge retry cannot overlap it", () => {
    const next = reducer(
      {
        ...initialState,
        running: false,
        judgeStatus: "done",
        fusionStatus: "idle",
      },
      { type: "FUSION_START" },
    );
    expect(next.running).toBe(true);
    expect(next.fusionStatus).toBe("running");
  });
});

describe("reducer — SWAP_SLOT switches a slot's model", () => {
  const baseSlots: StudioState["slots"] = [
    {
      id: "s1",
      providerId: "openrouter",
      provider: "OpenRouter",
      model: "A",
      slug: "model-a",
      enabled: true,
    },
  ];

  it("updates slug/model/provider label within the same provider", () => {
    const state: StudioState = { ...initialState, slots: baseSlots };
    const next = reducer(state, {
      type: "SWAP_SLOT",
      id: "s1",
      provider: "OpenRouter",
      model: "A2",
      slug: "vendor/model-a2",
    });
    expect(next.slots[0]).toMatchObject({
      id: "s1",
      providerId: "openrouter", // unchanged — same provider
      model: "A2",
      slug: "vendor/model-a2",
      enabled: true, // preserved
    });
  });

  it("updates providerId when switching to a different provider", () => {
    const state: StudioState = { ...initialState, slots: baseSlots };
    const next = reducer(state, {
      type: "SWAP_SLOT",
      id: "s1",
      providerId: "gemini",
      provider: "Gemini",
      model: "Gemini 3.6 Flash",
      slug: "gemini-3.6-flash",
    });
    expect(next.slots[0]).toMatchObject({
      id: "s1",
      providerId: "gemini", // switched
      provider: "Gemini",
      model: "Gemini 3.6 Flash",
      slug: "gemini-3.6-flash",
      enabled: true,
    });
  });

  it("keeps the slot id stable so the candidate→slot retry link survives a switch", () => {
    const state: StudioState = { ...initialState, slots: baseSlots };
    const next = reducer(state, {
      type: "SWAP_SLOT",
      id: "s1",
      providerId: "umans",
      provider: "Umans",
      model: "K3",
      slug: "kimi-k3",
    });
    // The slot id is the stable identity the retry path keys on (cand-s1 → s1).
    expect(next.slots[0].id).toBe("s1");
  });
});

// ---------------------------------------------------------------------------
// Attachments — plan 7.5.1
// ---------------------------------------------------------------------------

function makeAttachment(id: string, over: Partial<Attachment> = {}): Attachment {
  return {
    id,
    name: `${id}.png`,
    kind: "image",
    mimeType: "image/png",
    bytes: 1024,
    status: "reading",
    ...over,
  };
}

describe("reducer — ADD_ATTACHMENTS", () => {
  it("appends reading-state drafts and defaults attachmentsToJudge on", () => {
    const next = reducer(initialState, {
      type: "ADD_ATTACHMENTS",
      attachments: [makeAttachment("att-1"), makeAttachment("att-2")],
    });
    expect(next.attachments.map((a) => a.id)).toEqual(["att-1", "att-2"]);
    expect(next.attachments[0].status).toBe("reading");
    expect(next.attachmentsToJudge).toBe(true);
  });

  it("enforces MAX_FILES defensively, keeping the first files", () => {
    const state: StudioState = {
      ...initialState,
      attachments: Array.from({ length: MAX_FILES }, (_, i) => makeAttachment(`att-${i}`)),
    };
    const next = reducer(state, {
      type: "ADD_ATTACHMENTS",
      attachments: [makeAttachment("overflow")],
    });
    expect(next.attachments.length).toBe(MAX_FILES);
    expect(next.attachments.some((a) => a.id === "overflow")).toBe(false);
  });

  it("enforces MAX_TOTAL_BYTES per file, keeping non-offending files", () => {
    const state: StudioState = { ...initialState, attachments: [] };
    const next = reducer(state, {
      type: "ADD_ATTACHMENTS",
      attachments: [
        makeAttachment("ok", { bytes: 1000 }),
        makeAttachment("overflow", { bytes: MAX_TOTAL_BYTES }), // would exceed alone? no — with ok
      ],
    });
    // ok (1000) fits; overflow (40 MB) pushes the total to 40 MB + 1000 > 40 MB → rejected.
    expect(next.attachments.map((a) => a.id)).toEqual(["ok"]);
  });

  it("rejects a single file over MAX_FILE_BYTES but keeps the rest", () => {
    const next = reducer(initialState, {
      type: "ADD_ATTACHMENTS",
      attachments: [makeAttachment("big", { bytes: MAX_FILE_BYTES + 1 }), makeAttachment("fine")],
    });
    expect(next.attachments.map((a) => a.id)).toEqual(["fine"]);
  });
});

describe("reducer — attachment lifecycle transitions", () => {
  it("ATTACHMENT_READY fills fields and flips status to ready", () => {
    const state: StudioState = {
      ...initialState,
      attachments: [makeAttachment("att-1")],
    };
    const next = reducer(state, {
      type: "ATTACHMENT_READY",
      id: "att-1",
      text: "extracted",
      truncated: true,
      pageCount: 3,
    });
    expect(next.attachments[0]).toMatchObject({
      status: "ready",
      text: "extracted",
      truncated: true,
      pages: 3,
      error: undefined,
    });
  });

  it("ATTACHMENT_READY updates the media type after image re-encode", () => {
    const state: StudioState = {
      ...initialState,
      attachments: [makeAttachment("att-1", { mimeType: "image/jpeg" })],
    };
    const next = reducer(state, { type: "ATTACHMENT_READY", id: "att-1", mimeType: "image/png" });
    expect(next.attachments[0].mimeType).toBe("image/png");
  });

  it("ATTACHMENT_FAILED sets status error with the message", () => {
    const state: StudioState = {
      ...initialState,
      attachments: [makeAttachment("att-1")],
    };
    const next = reducer(state, {
      type: "ATTACHMENT_FAILED",
      id: "att-1",
      error: "PDF extraction failed: x",
    });
    expect(next.attachments[0].status).toBe("error");
    expect(next.attachments[0].error).toBe("PDF extraction failed: x");
  });

  it("REMOVE_ATTACHMENT drops the id and recomputes the judge default", () => {
    const state: StudioState = {
      ...initialState,
      attachments: [makeAttachment("a", { bytes: 1 }), makeAttachment("b")],
      attachmentsToJudge: false,
    };
    const next = reducer(state, { type: "REMOVE_ATTACHMENT", id: "a" });
    expect(next.attachments.map((x) => x.id)).toEqual(["b"]);
    expect(next.attachmentsToJudge).toBe(true);
  });

  it("CLEAR_ATTACHMENTS empties the set", () => {
    const state: StudioState = {
      ...initialState,
      attachments: [makeAttachment("a")],
      attachmentsToJudge: false,
    };
    const next = reducer(state, { type: "CLEAR_ATTACHMENTS" });
    expect(next.attachments).toEqual([]);
    expect(next.attachmentsToJudge).toBe(true);
  });

  it("RESET_SESSION clears attachments but keeps the model roster", () => {
    const state: StudioState = {
      ...initialState,
      attachments: [makeAttachment("a")],
      attachmentsToJudge: false,
      slots: [
        {
          id: "s1",
          providerId: "openrouter",
          provider: "OpenRouter",
          model: "A",
          slug: "model-a",
          enabled: true,
        },
      ],
    };
    const next = reducer(state, { type: "RESET_SESSION" });
    expect(next.attachments).toEqual([]);
    expect(next.attachmentsToJudge).toBe(true);
    expect(next.slots).toEqual(state.slots);
  });
});

describe("reducer — attachmentsToJudge auto-default (spec §6.2)", () => {
  it("SET_ATTACHMENTS_TO_JUDGE overrides until the next set change", () => {
    const next = reducer(initialState, { type: "SET_ATTACHMENTS_TO_JUDGE", value: false });
    expect(next.attachmentsToJudge).toBe(false);
  });

  it("flips to false at the 5th image", () => {
    const four = Array.from({ length: 4 }, (_, i) => makeAttachment(`i${i}`, { bytes: 100 }));
    const atFour = reducer(initialState, { type: "ADD_ATTACHMENTS", attachments: four });
    expect(atFour.attachmentsToJudge).toBe(true);

    const five = reducer(atFour, {
      type: "ADD_ATTACHMENTS",
      attachments: [makeAttachment("i4", { bytes: 100 })],
    });
    expect(five.attachmentsToJudge).toBe(false);
  });

  it("flips to false when native bytes exceed 4 MB even with few images", () => {
    const big = [
      makeAttachment("big", {
        kind: "pdf",
        mimeType: "application/pdf",
        bytes: 4 * 1024 * 1024 + 1,
      }),
    ];
    const next = reducer(initialState, { type: "ADD_ATTACHMENTS", attachments: big });
    expect(next.attachmentsToJudge).toBe(false);
  });

  it("stays on when a text-only attachment is added", () => {
    const next = reducer(initialState, {
      type: "ADD_ATTACHMENTS",
      attachments: [
        makeAttachment("doc", {
          kind: "doc",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          bytes: 30 * 1024 * 1024,
        }),
      ],
    });
    expect(next.attachmentsToJudge).toBe(true);
  });
});
