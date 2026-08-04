// =============================================================================
// RSemble AI — Run record builder tests
//
// Verifies the pure functions that convert executor events into RunRecordV2
// mutations and derive FullRunSummaryV2. No I/O, no side effects.
// Status derivation follows spec §7.5.
//
// Contract notes (fixed in Phase 6):
//  - persisted candidateId uses candidateIdForSlot(slot.id) — the same ID the
//    executor's fanout jobs and Judge blind labels carry, so candidate events
//    always join;
//  - fanout start creates candidates with EMPTY attempt lists; the executor's
//    onCandidateAttemptStart appends the real attempt before the provider
//    call. No placeholder attempt keeps a run pinned at "running".
// =============================================================================

import { describe, it, expect } from "vitest";
import type { ModelSlot } from "../../studio-data";
import type { ChatMessage, ProviderId } from "../providers/types";
import type { JudgeReport, ConsensusBreakdown, CandidateEvaluation } from "../../studio-data";
import type { RunSource, ExecutionFence, RunRecordV2 } from "./run-types";
import { isRunRecordV2 } from "./run-types";
import {
  createRunRecordBuilder,
  type RunRecordBuilderState,
  type BuilderDeps,
} from "./run-record-builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FENCE: ExecutionFence = { ownerId: "tab-1", fence: 1 };
const ADHOC: RunSource = { kind: "adhoc" };

const TWO_SLOTS = [
  { id: "s1", providerId: "openrouter", model: "A", slug: "model-a", enabled: true },
  { id: "s2", providerId: "umans", model: "B", slug: "model-b", enabled: true },
] as const;

/** Executor-style candidate IDs (cand-<slotId>) for the two fixture slots. */
const CANDIDATE_S1 = "cand-s1";
const CANDIDATE_S2 = "cand-s2";

function makeDeps(): BuilderDeps {
  return { now: () => 1000 };
}

function makeMessages(): ChatMessage[] {
  return [
    { role: "system", content: "system prompt" },
    { role: "user", content: "test prompt" },
  ];
}

function makeConsensus(): ConsensusBreakdown {
  return { consensus: ["A is better"], contradictions: [], uniqueInsights: [] };
}

function makeJudgeReport(scoresById: Record<string, number>): JudgeReport {
  const labelMap = Object.keys(scoresById).map((candidateId, i) => ({
    label: String.fromCharCode(65 + i),
    candidateId,
  }));
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  for (const { label, candidateId } of labelMap) {
    evaluationsById[candidateId] = {
      candidateId,
      blindLabel: label,
      overallScore: scoresById[candidateId],
      position: `Position ${label}`,
      rationale: `Evidence ${label}`,
      strengths: [`Strength ${label}`],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    };
  }
  return { labelMap, evaluationsById, comparisons: [] };
}

type Builder = ReturnType<typeof createRunRecordBuilder>;

function startFanout(
  state: RunRecordBuilderState,
  builder: Builder,
  slots: readonly { id: string; providerId: ProviderId; model: string; slug: string; enabled: boolean }[] = TWO_SLOTS,
): RunRecordV2 {
  return builder.applyFanoutStart(state, {
    runId: "run-1",
    source: ADHOC,
    mode: "rank" as const,
    task: { title: "Test Task", prompt: "test prompt", systemPrompt: "system prompt", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    slots: slots.map((s) => ({ ...s, provider: "P" })),
    fence: FENCE,
  });
}

/** Mirror the executor: attempt-start, then terminal with the same IDs. */
function runCandidateAttempt(
  builder: Builder,
  state: RunRecordBuilderState,
  record: RunRecordV2,
  candidateId: string,
  attemptId: string,
  terminal:
    | { status: "completed"; output: string; tokensIn?: number; tokensOut?: number }
    | { status: "failed"; error?: { message: string } },
): void {
  builder.applyCandidateAttemptStart(state, record, candidateId, {
    attemptId,
    messages: makeMessages(),
    startedAt: 1500,
  });
  builder.applyCandidateAttemptTerminal(state, record, candidateId, attemptId, {
    status: terminal.status,
    output: terminal.status === "completed" ? terminal.output : null,
    tokensIn: terminal.status === "completed" ? (terminal.tokensIn ?? 5) : null,
    tokensOut: terminal.status === "completed" ? (terminal.tokensOut ?? 10) : null,
    error: terminal.status === "failed" ? (terminal.error ?? { message: "fail" }) : null,
    finishedAt: 2000,
  });
}

/** Complete every candidate once, using per-candidate attempt IDs. */
function completeAllCandidates(builder: Builder, state: RunRecordBuilderState, record: RunRecordV2): void {
  for (const c of record.candidates) {
    runCandidateAttempt(builder, state, record, c.candidateId, `att-${c.candidateId}`, {
      status: "completed",
      output: `out-${c.candidateId}`,
    });
  }
}

function runJudgeAttempt(
  builder: Builder,
  state: RunRecordBuilderState,
  record: RunRecordV2,
  judgeAttemptId: string,
  ok: boolean,
): void {
  builder.applyJudgeStart(state, record, judgeAttemptId, {
    providerId: "openrouter",
    model: "judge-model",
    instruction: "",
    messages: makeMessages(),
    blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
    candidateAttemptIdsByCandidateId: {
      [CANDIDATE_S1]: `att-${CANDIDATE_S1}`,
      [CANDIDATE_S2]: `att-${CANDIDATE_S2}`,
    },
    startedAt: 3000,
  });
  builder.applyJudgeTerminal(state, record, judgeAttemptId, ok
    ? {
        status: "completed",
        report: makeJudgeReport({ [CANDIDATE_S1]: 4, [CANDIDATE_S2]: 3 }),
        consensus: null,
        error: null,
        finishedAt: 4000,
      }
    : {
        status: "failed",
        report: null,
        consensus: null,
        error: { message: "bad" },
        finishedAt: 4000,
      });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RunRecordBuilder — fanout start", () => {
  it("creates one stable run ID with candidates that carry no attempts yet", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);

    expect(record.id).toBe("run-1");
    expect(record.status).toBe("running");
    expect(record.candidates).toHaveLength(2);
    for (const c of record.candidates) {
      // No placeholder attempt: a pre-created running attempt would never
      // terminate and would pin deriveStatus at "running" forever.
      expect(c.attempts).toEqual([]);
      expect(c.acceptedAttemptId).toBeNull();
    }
  });

  it("assigns immutable candidateId, slotId, modelKey per candidate", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);

    // candidateId matches the executor's fanout job ID scheme (cand-<slotId>).
    expect(record.candidates[0].candidateId).toBe(CANDIDATE_S1);
    expect(record.candidates[0].slotId).toBe("s1");
    expect(record.candidates[0].modelKey).toBe("openrouter:model-a");
    expect(record.candidates[1].candidateId).toBe(CANDIDATE_S2);
    expect(record.candidates[1].modelKey).toBe("umans:model-b");
  });
});

describe("RunRecordBuilder — executor event identity (regression)", () => {
  it("executor-style cand-<slotId> events join persisted candidates and reach terminal", () => {
    // Regression: persisted candidateId was slot.id while executor events
    // carried cand-<slot.id>, so every candidate attempt write silently
    // no-op'd and deriveStatus never left "running".
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);

    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);

    expect(builder.deriveStatus(record)).toBe("completed");
    const summary = builder.deriveSummary(record);
    expect(summary.scoresByModelKey).toEqual({
      "openrouter:model-a": 4,
      "umans:model-b": 3,
    });
    expect(summary.winnerKeys).toEqual(["openrouter:model-a"]);
  });
});

describe("RunRecordBuilder — candidate terminal", () => {
  it("stores output, tokens, timings on terminal", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);

    runCandidateAttempt(builder, state, record, CANDIDATE_S1, "att-1", {
      status: "completed",
      output: "answer text",
      tokensIn: 10,
      tokensOut: 20,
    });

    const attempt = record.candidates[0].attempts[0];
    expect(attempt.status).toBe("completed");
    expect(attempt.output).toBe("answer text");
    expect(attempt.tokensIn).toBe(10);
    expect(attempt.tokensOut).toBe(20);
    expect(attempt.finishedAt).toBe(2000);
    expect(record.candidates[0].acceptedAttemptId).toBe("att-1");
  });

  it("stores bounded sanitized error on failure", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);

    runCandidateAttempt(builder, state, record, CANDIDATE_S1, "att-1", {
      status: "failed",
      error: { message: "connection reset" },
    });

    expect(record.candidates[0].attempts[0].status).toBe("failed");
    expect(record.candidates[0].attempts[0].error).toEqual({ message: "connection reset" });
    expect(record.candidates[0].acceptedAttemptId).toBeNull();
  });
});

describe("RunRecordBuilder — candidate retry", () => {
  it("appends a running attempt before the call", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    runCandidateAttempt(builder, state, record, CANDIDATE_S1, "att-1", {
      status: "completed",
      output: "first",
    });

    // Retry: append a new running attempt
    builder.applyCandidateAttemptStart(state, record, CANDIDATE_S1, {
      attemptId: "retry-att-1",
      messages: makeMessages(),
      startedAt: 3000,
    });

    expect(record.candidates[0].attempts).toHaveLength(2);
    expect(record.candidates[0].attempts[1].status).toBe("running");
    expect(record.candidates[0].attempts[1].attemptId).toBe("retry-att-1");
  });

  it("success moves accepted pointer; failure preserves prior accepted output", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    runCandidateAttempt(builder, state, record, CANDIDATE_S1, "att-1", {
      status: "completed",
      output: "first",
    });

    // Retry attempt
    builder.applyCandidateAttemptStart(state, record, CANDIDATE_S1, {
      attemptId: "retry-att-1", messages: makeMessages(), startedAt: 3000,
    });
    builder.applyCandidateAttemptTerminal(state, record, CANDIDATE_S1, "retry-att-1", {
      status: "completed", output: "second", tokensIn: 6, tokensOut: 12, error: null, finishedAt: 4000,
    });
    expect(record.candidates[0].acceptedAttemptId).toBe("retry-att-1");

    // Another retry that fails — should NOT move accepted pointer
    builder.applyCandidateAttemptStart(state, record, CANDIDATE_S1, {
      attemptId: "retry-att-2", messages: makeMessages(), startedAt: 5000,
    });
    builder.applyCandidateAttemptTerminal(state, record, CANDIDATE_S1, "retry-att-2", {
      status: "failed", output: null, tokensIn: null, tokensOut: null,
      error: { message: "failed" }, finishedAt: 6000,
    });
    expect(record.candidates[0].acceptedAttemptId).toBe("retry-att-1");
    expect(record.candidates[0].attempts).toHaveLength(3);
  });
});

describe("RunRecordBuilder — Judge", () => {
  function setupJudgeReady() {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    completeAllCandidates(builder, state, record);
    return { builder, state, record };
  }

  it("starts as running with immutable attempt ID, messages, blind map, candidate refs", () => {
    const { builder, state, record } = setupJudgeReady();
    builder.applyJudgeStart(state, record, "judge-att-1", {
      providerId: "openrouter", model: "judge-model", instruction: "be strict",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 3000,
    });
    const j = record.judge;
    expect(j.status).toBe("running");
    expect(j.attempts).toHaveLength(1);
    expect(j.attempts[0].attemptId).toBe("judge-att-1");
    expect(j.attempts[0].messages).toHaveLength(2);
    expect(j.attempts[0].blindLabelToCandidateId).toEqual({ A: CANDIDATE_S1, B: CANDIDATE_S2 });
    expect(j.attempts[0].candidateAttemptIdsByCandidateId).toEqual({ [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" });
  });

  it("success retains report, consensus, scores, and accepted pointer", () => {
    const { builder, state, record } = setupJudgeReady();
    builder.applyJudgeStart(state, record, "judge-att-1", {
      providerId: "openrouter", model: "judge-model", instruction: "",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 3000,
    });
    const report = makeJudgeReport({ [CANDIDATE_S1]: 4, [CANDIDATE_S2]: 3 });
    const consensus = makeConsensus();
    builder.applyJudgeTerminal(state, record, "judge-att-1", {
      status: "completed", report, consensus, error: null, finishedAt: 4000,
    });
    expect(record.judge.status).toBe("done");
    expect(record.judge.acceptedAttemptId).toBe("judge-att-1");
    expect(record.judge.report).toBe(report);
    expect(record.judge.consensus).toBe(consensus);
  });

  it("candidate retry failure preserves prior accepted Judge and candidate refs", () => {
    const { builder, state, record } = setupJudgeReady();
    builder.applyJudgeStart(state, record, "judge-att-1", {
      providerId: "openrouter", model: "judge-model", instruction: "",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 3000,
    });
    const report = makeJudgeReport({ [CANDIDATE_S1]: 4, [CANDIDATE_S2]: 3 });
    builder.applyJudgeTerminal(state, record, "judge-att-1", {
      status: "completed", report, consensus: null, error: null, finishedAt: 4000,
    });

    // New Judge attempt after candidate retry — fails
    builder.applyJudgeStart(state, record, "judge-att-2", {
      providerId: "openrouter", model: "judge-model", instruction: "",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "retry-att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 5000,
    });
    builder.applyJudgeTerminal(state, record, "judge-att-2", {
      status: "failed", report: null, consensus: null,
      error: { message: "malformed" }, finishedAt: 6000,
    });

    // Prior accepted Judge preserved
    expect(record.judge.acceptedAttemptId).toBe("judge-att-1");
    expect(record.judge.report).toBe(report);
    expect(record.judge.attempts).toHaveLength(2);
  });
});

describe("RunRecordBuilder — Fusion", () => {
  function setupFusionReady() {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    completeAllCandidates(builder, state, record);
    builder.applyJudgeStart(state, record, "judge-att-1", {
      providerId: "openrouter", model: "judge-model", instruction: "",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 3000,
    });
    builder.applyJudgeTerminal(state, record, "judge-att-1", {
      status: "completed", report: makeJudgeReport({ [CANDIDATE_S1]: 4, [CANDIDATE_S2]: 3 }),
      consensus: null, error: null, finishedAt: 4000,
    });
    return { builder, state, record };
  }

  it("appends running fusion with source Judge and candidate attempt IDs", () => {
    const { builder, state, record } = setupFusionReady();
    builder.applyFusionStart(state, record, "fusion-att-1", {
      providerId: "openrouter", model: "judge-model",
      messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 5000,
    });
    expect(record.fusion.status).toBe("running");
    expect(record.fusion.attempts).toHaveLength(1);
    expect(record.fusion.attempts[0].sourceJudgeAttemptId).toBe("judge-att-1");
  });

  it("success moves accepted pointer; failed re-fuse preserves prior accepted", () => {
    const { builder, state, record } = setupFusionReady();
    builder.applyFusionStart(state, record, "fusion-att-1", {
      providerId: "openrouter", model: "judge-model",
      messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 5000,
    });
    builder.applyFusionTerminal(state, record, "fusion-att-1", {
      status: "completed", result: "fused text", error: null, finishedAt: 6000,
    });
    expect(record.fusion.acceptedAttemptId).toBe("fusion-att-1");

    // Re-fuse that fails
    builder.applyFusionStart(state, record, "fusion-att-2", {
      providerId: "openrouter", model: "judge-model",
      messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-1", [CANDIDATE_S2]: "att-2" },
      startedAt: 7000,
    });
    builder.applyFusionTerminal(state, record, "fusion-att-2", {
      status: "failed", result: null, error: { message: "fusion failed" }, finishedAt: 8000,
    });
    // Prior accepted Fusion preserved
    expect(record.fusion.acceptedAttemptId).toBe("fusion-att-1");
    expect(record.fusion.attempts).toHaveLength(2);
  });
});

describe("RunRecordBuilder — summary derivation", () => {
  it("search text contains task title/excerpt and model IDs", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    const summary = builder.deriveSummary(record);
    expect(summary.searchText).toContain("Test Task");
    expect(summary.searchText).toContain("test prompt");
    expect(summary.searchText).toContain("model-a");
    expect(summary.searchText).toContain("model-b");
  });

  it("summary has detailAvailable: true, kind: full, schemaVersion: 2", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    const summary = builder.deriveSummary(record);
    expect(summary.kind).toBe("full");
    expect(summary.schemaVersion).toBe(2);
    expect(summary.detailAvailable).toBe(true);
    expect(summary.modelKeys).toEqual(["openrouter:model-a", "umans:model-b"]);
  });
});

describe("RunRecordBuilder — status derivation (§7.5)", () => {
  function setup(mode: "rank" | "fuse" = "rank") {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = builder.applyFanoutStart(state, {
      runId: "run-1", source: ADHOC, mode,
      task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: TWO_SLOTS.map((s) => ({ ...s, provider: "P" })),
      fence: FENCE,
    });
    return { builder, state, record };
  }

  it("running: provider calls active, no terminal action", () => {
    const { builder, state, record } = setup();
    builder.applyCandidateAttemptStart(state, record, CANDIDATE_S1, {
      attemptId: "att-1", messages: makeMessages(), startedAt: 1500,
    });
    expect(builder.deriveStatus(record)).toBe("running");
  });

  it("completed: accepted Judge + all candidates usable, no Fusion requested", () => {
    const { builder, state, record } = setup("rank");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);
    expect(builder.deriveStatus(record)).toBe("completed");
  });

  it("completed: accepted Judge + all candidates + accepted Fusion in fuse mode", () => {
    const { builder, state, record } = setup("fuse");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);
    builder.applyFusionStart(state, record, "fusion-att-1", {
      providerId: "openrouter", model: "judge-model", messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" }, startedAt: 5000,
    });
    builder.applyFusionTerminal(state, record, "fusion-att-1", {
      status: "completed", result: "fused", error: null, finishedAt: 6000,
    });
    expect(builder.deriveStatus(record)).toBe("completed");
  });

  it("partial: accepted Judge with one failed candidate", () => {
    const { builder, state, record } = setup("rank");
    // First candidate completes; second fails.
    runCandidateAttempt(builder, state, record, CANDIDATE_S1, "att-s1", {
      status: "completed", output: "out-s1",
    });
    runCandidateAttempt(builder, state, record, CANDIDATE_S2, "att-s2", {
      status: "failed", error: { message: "fail" },
    });
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);
    expect(builder.deriveStatus(record)).toBe("partial");
  });

  it("partial: accepted Judge but requested Fusion has no accepted result", () => {
    const { builder, state, record } = setup("fuse");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);
    // Fusion started but failed
    builder.applyFusionStart(state, record, "fusion-att-1", {
      providerId: "openrouter", model: "judge-model", messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" }, startedAt: 5000,
    });
    builder.applyFusionTerminal(state, record, "fusion-att-1", {
      status: "failed", result: null, error: { message: "fusion fail" }, finishedAt: 6000,
    });
    expect(builder.deriveStatus(record)).toBe("partial");
  });

  it("failed: fewer than two usable candidates", () => {
    const { builder, state, record } = setup("rank");
    // Both fail
    runCandidateAttempt(builder, state, record, CANDIDATE_S1, "att-s1", { status: "failed" });
    runCandidateAttempt(builder, state, record, CANDIDATE_S2, "att-s2", { status: "failed" });
    builder.applyFanoutTerminal(state, record, []);
    expect(builder.deriveStatus(record)).toBe("failed");
  });

  it("failed: Judge ends without accepted report", () => {
    const { builder, state, record } = setup("rank");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", false);
    expect(builder.deriveStatus(record)).toBe("failed");
  });

  it("aborted: user abort wins", () => {
    const { builder, state, record } = setup();
    builder.applyAborted(state, record);
    expect(record.status).toBe("aborted");
    expect(builder.deriveStatus(record)).toBe("aborted");
  });

  it("interrupted: startup recovery finds expired lease", () => {
    const { builder, state, record } = setup();
    builder.applyInterrupted(state, record);
    expect(record.status).toBe("interrupted");
    expect(builder.deriveStatus(record)).toBe("interrupted");
  });

  it("failed re-fuse with prior accepted Fusion preserves completed/partial", () => {
    const { builder, state, record } = setup("fuse");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);
    // First fusion succeeds
    builder.applyFusionStart(state, record, "fusion-att-1", {
      providerId: "openrouter", model: "judge-model", messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" }, startedAt: 5000,
    });
    builder.applyFusionTerminal(state, record, "fusion-att-1", {
      status: "completed", result: "fused", error: null, finishedAt: 6000,
    });
    // Re-fuse fails
    builder.applyFusionStart(state, record, "fusion-att-2", {
      providerId: "openrouter", model: "judge-model", messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" }, startedAt: 7000,
    });
    builder.applyFusionTerminal(state, record, "fusion-att-2", {
      status: "failed", result: null, error: { message: "refuse fail" }, finishedAt: 8000,
    });
    // Still completed because prior accepted Fusion exists
    expect(builder.deriveStatus(record)).toBe("completed");
  });

  it("fusion start after accepted Judge does not regress partial to running (§5.6)", () => {
    const { builder, state, record } = setup("fuse");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", true);
    // Fuse mode with an accepted Judge and no accepted Fusion → partial (terminal).
    expect(builder.deriveStatus(record)).toBe("partial");
    // Starting the post-run fusion attempt must NOT regress the accepted
    // overall status to running — the repository CAS guard rejects that
    // regression, so the builder must not produce it (spec §5.6).
    builder.applyFusionStart(state, record, "fusion-att-1", {
      providerId: "openrouter", model: "judge-model", messages: makeMessages(),
      sourceJudgeAttemptId: "judge-att-1",
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" }, startedAt: 5000,
    });
    expect(builder.deriveStatus(record)).toBe("partial");
  });

  it("judge retry after judge failure does not regress failed to running (§5.6)", () => {
    const { builder, state, record } = setup("rank");
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    runJudgeAttempt(builder, state, record, "judge-att-1", false);
    expect(builder.deriveStatus(record)).toBe("failed");
    builder.applyJudgeStart(state, record, "judge-att-2", {
      providerId: "openrouter", model: "judge-model", instruction: "",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" },
      startedAt: 5000,
    });
    expect(builder.deriveStatus(record)).toBe("failed");
  });
});

describe("RunRecordBuilder — winners", () => {
  it("equal top scores produce multiple winnerKeys", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    completeAllCandidates(builder, state, record);
    builder.applyFanoutTerminal(state, record, []);
    builder.applyJudgeStart(state, record, "judge-att-1", {
      providerId: "openrouter", model: "judge-model", instruction: "",
      messages: makeMessages(),
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "a1", [CANDIDATE_S2]: "a2" },
      startedAt: 3000,
    });
    // Tie: both score 4
    builder.applyJudgeTerminal(state, record, "judge-att-1", {
      status: "completed",
      report: makeJudgeReport({ [CANDIDATE_S1]: 4, [CANDIDATE_S2]: 4 }),
      consensus: null, error: null, finishedAt: 4000,
    });
    const summary = builder.deriveSummary(record);
    expect(summary.winnerKeys).toHaveLength(2);
    expect(summary.winnerKeys).toContain("openrouter:model-a");
    expect(summary.winnerKeys).toContain("umans:model-b");
  });
});

describe("RunRecordBuilder — prohibited keys", () => {
  it("no prohibited transport/credential fields are serialized", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    const parsed = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    // Check that no credential-like keys exist at any level
    const forbidden = ["apiKey", "authorization", "secret", "password", "token", "bearer"];
    const checkKeys = (obj: unknown, path: string): string[] => {
      if (typeof obj !== "object" || obj === null) return [];
      const found: string[] = [];
      for (const [key, val] of Object.entries(obj)) {
        if (forbidden.includes(key)) found.push(`${path}.${key}`);
        if (typeof val === "object" && val !== null) {
          found.push(...checkKeys(val, `${path}.${key}`));
        }
      }
      return found;
    };
    const violations = checkKeys(parsed, "root");
    expect(violations).toEqual([]);
  });
});

describe("RunRecordBuilder — compound repair run seed (Task 9)", () => {
  /** Build a base run with two accepted candidates via the builder. */
  function buildBaseRun(): RunRecordV2 {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = startFanout(state, builder);
    builder.applyCandidateAttemptStart(state, record, CANDIDATE_S1, {
      attemptId: "att-base-s1",
      messages: makeMessages(),
      startedAt: 900,
    });
    builder.applyCandidateAttemptTerminal(state, record, CANDIDATE_S1, "att-base-s1", {
      status: "completed", output: "output-A", tokensIn: 10, tokensOut: 5, error: null, finishedAt: 950,
    });
    builder.applyCandidateAttemptStart(state, record, CANDIDATE_S2, {
      attemptId: "att-base-s2",
      messages: makeMessages(),
      startedAt: 900,
    });
    builder.applyCandidateAttemptTerminal(state, record, CANDIDATE_S2, "att-base-s2", {
      status: "completed", output: "output-B", tokensIn: 12, tokensOut: 6, error: null, finishedAt: 960,
    });
    builder.applyFanoutTerminal(state, record, [
      { id: CANDIDATE_S1, status: "done" } as never,
      { id: CANDIDATE_S2, status: "done" } as never,
    ]);
    builder.applyJudgeStart(state, record, "judge-att", {
      providerId: "openrouter", model: "judge", instruction: "", messages: [],
      blindLabelToCandidateId: { A: CANDIDATE_S1, B: CANDIDATE_S2 },
      candidateAttemptIdsByCandidateId: { [CANDIDATE_S1]: "att-base-s1", [CANDIDATE_S2]: "att-base-s2" },
      startedAt: 970,
    });
    builder.applyJudgeTerminal(state, record, "judge-att", {
      status: "completed", report: makeJudgeReport({ [CANDIDATE_S1]: 4, [CANDIDATE_S2]: 3 }), consensus: null, error: null, finishedAt: 980,
    });
    return record;
  }

  it("creates a fresh run with reused accepted outputs carrying provenance", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const baseRun = buildBaseRun();
    let id = 0;
    const generateId = () => `fresh-${++id}`;

    const seed = builder.buildRepairRunSeed({
      runId: "run-repair",
      source: {
        kind: "experiment",
        experimentId: "exp-1",
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: "fp",
        taskId: "t1",
        experimentTaskAttemptId: "att-repair",
        trial: 1,
        repair: { kind: "missing-cells", baseRunId: "run-base", requestedModelKeys: ["umans:model-b"] },
      },
      task: { title: "Test Task", prompt: "test prompt", systemPrompt: "system prompt", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: TWO_SLOTS.map((s) => ({ ...s, provider: "P" })),
      fence: FENCE,
      baseRun,
      requestedModelKeys: ["umans:model-b"],
      generateId,
    });

    expect(seed.id).toBe("run-repair");
    expect(seed.status).toBe("running");
    // Fresh source with repair metadata.
    expect(seed.source).toMatchObject({
      kind: "experiment",
      repair: { kind: "missing-cells", baseRunId: "run-base", requestedModelKeys: ["umans:model-b"] },
    });
    // Two candidates: s1 reused, s2 requested (unstarted).
    expect(seed.candidates).toHaveLength(2);
    const reused = seed.candidates.find((c) => c.modelKey === "openrouter:model-a")!;
    const fresh = seed.candidates.find((c) => c.modelKey === "umans:model-b")!;

    // Reused candidate: fresh attempt id, copied output, explicit provenance.
    expect(reused.acceptedAttemptId).toBe("fresh-1");
    expect(reused.attempts).toHaveLength(1);
    expect(reused.attempts[0].attemptId).toBe("fresh-1");
    expect(reused.attempts[0].output).toBe("output-A");
    expect(reused.attempts[0].reusedFrom).toEqual({
      sourceRunId: "run-1",
      sourceCandidateId: CANDIDATE_S1,
      sourceAttemptId: "att-base-s1",
    });

    // Requested candidate: no attempts (executor will fill).
    expect(fresh.attempts).toHaveLength(0);
    expect(fresh.acceptedAttemptId).toBeNull();

    // Empty Judge/fusion evidence and no winner report.
    expect(seed.judge.attempts).toHaveLength(0);
    expect(seed.judge.report).toBeNull();
    expect(seed.fusion.attempts).toHaveLength(0);
    expect(seed.winnerKeys).toEqual([]);
    // Valid persisted shape.
    expect(isRunRecordV2(seed)).toBe(true);
  });

  it("does not copy judge scores or winner report into the seed", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const baseRun = buildBaseRun();
    let id = 0;
    const seed = builder.buildRepairRunSeed({
      runId: "run-repair-2",
      source: {
        kind: "experiment",
        experimentId: "exp-1",
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: "fp",
        taskId: "t1",
        experimentTaskAttemptId: "att-repair-2",
        trial: 1,
      },
      task: { title: "Test Task", prompt: "test prompt", systemPrompt: "system prompt", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: TWO_SLOTS.map((s) => ({ ...s, provider: "P" })),
      fence: FENCE,
      baseRun,
      requestedModelKeys: [],
      generateId: () => `fresh-${++id}`,
    });
    expect(seed.judge.report).toBeNull();
    expect(seed.judge.attempts).toHaveLength(0);
    expect(seed.winnerKeys).toEqual([]);
  });

  it("tolerates a rotated roster whose requested key has no base-run candidate", () => {
    // Roster-extension shape (plan 001, A2): the rotated roster contains all
    // old slots plus one NEW slot that never ran in the base run. The seed
    // must reuse every accepted old output and leave the new slot unstarted.
    const builder = createRunRecordBuilder(makeDeps());
    const baseRun = buildBaseRun();
    const baseBefore = JSON.parse(JSON.stringify(baseRun));

    const newSlot: ModelSlot = { id: "s3", providerId: "gemini", provider: "Gemini", model: "C", slug: "model-c", enabled: true };
    const rotatedSlots: ModelSlot[] = [
      ...TWO_SLOTS.map((s) => ({ ...s, provider: "P" })),
      newSlot,
    ];
    let id = 0;
    const generateId = () => `fresh-${++id}`;

    const seed = builder.buildRepairRunSeed({
      runId: "run-extension",
      source: {
        kind: "experiment",
        experimentId: "exp-1",
        suiteId: "suite-1",
        suiteVersion: 1,
        protocolFingerprint: "fp-rotated",
        taskId: "t1",
        experimentTaskAttemptId: "att-extension",
        trial: 1,
        repair: { kind: "roster-extension", addedModelKey: "gemini:model-c", baseRunId: "run-1" },
      },
      task: { title: "Test Task", prompt: "test prompt", systemPrompt: "system prompt", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: rotatedSlots,
      fence: FENCE,
      baseRun,
      requestedModelKeys: ["gemini:model-c"],
      generateId,
    });

    // Three candidates: two reused, one fresh.
    expect(seed.candidates).toHaveLength(3);
    const reusedA = seed.candidates.find((c) => c.modelKey === "openrouter:model-a")!;
    const reusedB = seed.candidates.find((c) => c.modelKey === "umans:model-b")!;
    const freshC = seed.candidates.find((c) => c.modelKey === "gemini:model-c")!;

    expect(reusedA.acceptedAttemptId).not.toBeNull();
    expect(reusedA.attempts[0].reusedFrom).toEqual({
      sourceRunId: "run-1",
      sourceCandidateId: CANDIDATE_S1,
      sourceAttemptId: "att-base-s1",
    });
    expect(reusedB.acceptedAttemptId).not.toBeNull();
    expect(reusedB.attempts[0].reusedFrom).toEqual({
      sourceRunId: "run-1",
      sourceCandidateId: CANDIDATE_S2,
      sourceAttemptId: "att-base-s2",
    });

    // New slot: no accepted attempt, no attempts.
    expect(freshC.acceptedAttemptId).toBeNull();
    expect(freshC.attempts).toHaveLength(0);

    // Fresh candidate IDs never collide with base-run IDs.
    for (const c of seed.candidates) {
      for (const a of c.attempts) {
        expect(a.attemptId).not.toBe("att-base-s1");
        expect(a.attemptId).not.toBe("att-base-s2");
      }
    }

    // Judge/fusion evidence and winners are empty.
    expect(seed.judge.attempts).toHaveLength(0);
    expect(seed.judge.report).toBeNull();
    expect(seed.fusion.attempts).toHaveLength(0);
    expect(seed.winnerKeys).toEqual([]);

    // The base run is unmodified.
    expect(baseRun).toEqual(baseBefore);

    // Valid persisted shape with the roster-extension source.
    expect(isRunRecordV2(seed)).toBe(true);
    expect(seed.source).toMatchObject({
      kind: "experiment",
      protocolFingerprint: "fp-rotated",
      repair: { kind: "roster-extension", addedModelKey: "gemini:model-c", baseRunId: "run-1" },
    });
  });
});

describe("RunRecordBuilder — source metadata", () => {
  it("distinguishes adhoc and experiment task runs", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state1 = builder.createInitialState();
    const adhocRecord = builder.applyFanoutStart(state1, {
      runId: "r1", source: ADHOC, mode: "rank",
      task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: TWO_SLOTS.map((s) => ({ ...s, provider: "P" })),
      fence: FENCE,
    });
    expect(adhocRecord.source).toEqual({ kind: "adhoc" });

    const state2 = builder.createInitialState();
    const expSource: RunSource = {
      kind: "experiment",
      experimentId: "exp-1",
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "fp-abc",
      taskId: "task-1",
      experimentTaskAttemptId: "exp-att-1",
      trial: 0,
    };
    const expRecord = builder.applyFanoutStart(state2, {
      runId: "r2", source: expSource, mode: "rank",
      task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: TWO_SLOTS.map((s) => ({ ...s, provider: "P" })),
      fence: FENCE,
    });
    expect(expRecord.source.kind).toBe("experiment");
    expect(expRecord.source).toEqual(expSource);
  });
});

// ---------------------------------------------------------------------------
// Attachment metadata — plan 7.7.2
// ---------------------------------------------------------------------------

describe("run record builder — attachment metadata (7.7.2)", () => {
  it("records attachment metadata (never bytes/text) when provided", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = builder.applyFanoutStart(state, {
      runId: "run-1", source: ADHOC, mode: "rank",
      task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: [
        { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
        { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
      ],
      fence: { ownerId: "tab-1", fence: 1 },
      attachments: [
        { name: "shot.png", kind: "image", bytes: 1024 },
        { name: "notes.md", kind: "text", bytes: 200 },
      ],
    });

    expect(record.attachments).toEqual([
      { name: "shot.png", kind: "image", bytes: 1024 },
      { name: "notes.md", kind: "text", bytes: 200 },
    ]);
    // Bytes/text of the attachment never appear on the record.
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("data:");
    expect(serialized).not.toContain("iVBOR");
  });

  it("omits the field entirely for attachment-free runs (pre-attachments shape)", () => {
    const builder = createRunRecordBuilder(makeDeps());
    const state = builder.createInitialState();
    const record = builder.applyFanoutStart(state, {
      runId: "run-1", source: ADHOC, mode: "rank",
      task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: [
        { id: "s1", providerId: "openrouter", provider: "OpenRouter", model: "A", slug: "model-a", enabled: true },
        { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
      ],
      fence: { ownerId: "tab-1", fence: 1 },
    });
    expect("attachments" in record).toBe(false);
    // Old records without the field still validate.
    expect(isRunRecordV2(record)).toBe(true);
  });
});
