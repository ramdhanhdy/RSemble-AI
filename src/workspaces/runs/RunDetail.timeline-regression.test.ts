// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import { buildTimeline } from "./RunDetail";

function baseRecord(overrides: Partial<RunRecordV2> = {}): RunRecordV2 {
  return {
    schemaVersion: 2,
    id: "run-timeline",
    revision: 1,
    execution: { ownerId: "tab", fence: 1 },
    createdAt: 1_000,
    updatedAt: 2_000,
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "Timeline", prompt: "p", systemPrompt: "", temperature: 0.4 },
    evaluation: { profile: null, candidateMessages: [] },
    candidates: [],
    judge: {
      status: "idle",
      acceptedAttemptId: null,
      report: null,
      consensus: null,
      attempts: [],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
    ...overrides,
  };
}

function candidate(
  id: string,
  status: "running" | "completed" | "failed" | "aborted" | "interrupted" | null,
  accepted = false,
): RunRecordV2["candidates"][number] {
  return {
    candidateId: id,
    slotId: `slot-${id}`,
    modelKey: `openrouter:${id}`,
    providerId: "openrouter",
    model: id,
    slug: id,
    acceptedAttemptId: accepted ? `att-${id}` : null,
    attempts:
      status === null
        ? []
        : [
            {
              attemptId: `att-${id}`,
              messages: [],
              startedAt: 1_000,
              finishedAt: status === "running" ? null : 2_000,
              status,
              output: status === "completed" ? "ok" : null,
              tokensIn: null,
              tokensOut: null,
              error: status === "failed" ? { message: "failed" } : null,
            },
          ],
  };
}

describe("RunDetail status timeline regressions", () => {
  it("does not count unsettled candidates as errors while a run is active", () => {
    const record = baseRecord({
      candidates: [
        candidate("done", "completed", true),
        candidate("active", "running"),
        candidate("queued", null),
      ],
    });

    const candidates = buildTimeline(record).find((step) => step.label === "Candidates");
    expect(candidates?.detail).toBe("1/3 done · 2 pending");
    expect(candidates?.detail).not.toContain("error");
    expect(candidates?.state).toBe("running");
  });

  it("counts only explicit terminal candidate failures as errors", () => {
    const record = baseRecord({
      status: "partial",
      completedAt: 3_000,
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
    });

    const candidates = buildTimeline(record).find((step) => step.label === "Candidates");
    expect(candidates?.detail).toBe("1/2 done · 1 error");
    expect(candidates?.state).toBe("warn");
  });

  it("reports a completed Fuse run as fused even when Judge winners exist", () => {
    const record = baseRecord({
      status: "completed",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: ["openrouter:done"],
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "done",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: {
        status: "done",
        acceptedAttemptId: "fusion-att-1",
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 1_500,
            finishedAt: 2_000,
            status: "completed",
            error: null,
            result: "Fused answer combining all candidates",
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("fused");
    expect(result?.state).toBe("done");
  });

  it("a terminal completed Rank run without winner keys is not pending", () => {
    const record = baseRecord({
      status: "completed",
      completedAt: 3_000,
      mode: "rank",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("completed - no winner");
    expect(result?.detail).not.toContain("pending");
    expect(result?.state).toBe("warn");
  });

  it("a failed run whose Judge is idle does not claim the judge failed", () => {
    const record = baseRecord({
      status: "failed",
      completedAt: 3_000,
      mode: "rank",
      winnerKeys: [],
      candidates: [candidate("bad", "failed"), candidate("bad2", "failed")],
      judge: {
        status: "idle",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("no result - failed before judging");
    expect(result?.detail).not.toContain("judge failed");
    expect(result?.state).toBe("error");
  });

  it("a failed run whose Judge errored retains the judge-failed wording", () => {
    const record = baseRecord({
      status: "failed",
      completedAt: 3_000,
      mode: "rank",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true), candidate("done2", "completed", true)],
      judge: {
        status: "error",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [
          {
            attemptId: "judge-att-1",
            providerId: "openrouter",
            model: "judge-model",
            instruction: "Evaluate",
            messages: [{ role: "user", content: "Evaluate" }],
            blindLabelToCandidateId: { A: "done" },
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 2_000,
            finishedAt: 2_500,
            status: "failed",
            error: { message: "malformed" },
            report: null,
            consensus: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("no result - judge failed");
    expect(result?.state).toBe("error");
  });

  it("a partial Fuse run with incomplete fusion does not blame candidates", () => {
    const record = baseRecord({
      status: "partial",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      // Fusion never produced a result and is not in an error state — the
      // stage is incomplete, not a candidate failure.
      fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("no result - fusion incomplete");
    expect(result?.detail).not.toContain("candidate error");
    expect(result?.state).toBe("warn");
  });

  it("a partial Fuse run with an errored fusion retains the fusion-failed wording", () => {
    const record = baseRecord({
      status: "partial",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: {
        status: "error",
        acceptedAttemptId: null,
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 2_500,
            finishedAt: 2_800,
            status: "failed",
            error: { message: "fusion failed" },
            result: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("no result - fusion failed");
    expect(result?.state).toBe("error");
  });

  it("a completed Fuse run mid-re-fusion reports fusion running, not fused", () => {
    // deriveStatus preserves the accepted terminal `completed` status during a
    // post-run Re-fuse; the timeline must surface the live fusion stage.
    const record = baseRecord({
      status: "completed",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: ["openrouter:done"],
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      // A prior accepted fusion attempt exists, but a new Re-fuse attempt is
      // in flight — fusion.status is `running`, not `done`.
      fusion: {
        status: "running",
        acceptedAttemptId: "fusion-att-1",
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 1_500,
            finishedAt: 2_000,
            status: "completed",
            error: null,
            result: "Fused answer combining all candidates",
          },
          {
            attemptId: "fusion-att-2",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge again" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 3_500,
            finishedAt: null,
            status: "running",
            error: null,
            result: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("fusion running");
    expect(result?.detail).not.toContain("fused");
    expect(result?.state).toBe("running");
  });

  it("a partial Fuse run mid-re-fusion reports fusion running, not fusion incomplete", () => {
    const record = baseRecord({
      status: "partial",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: {
        status: "running",
        acceptedAttemptId: null,
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 3_500,
            finishedAt: null,
            status: "running",
            error: null,
            result: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("fusion running");
    expect(result?.detail).not.toContain("fusion incomplete");
    expect(result?.detail).not.toContain("candidate error");
    expect(result?.state).toBe("running");
  });

  it("an aborted run with a left-running Judge reports Judge aborted, not running", () => {
    // applyAborted finalizes attempts but leaves judge.status === "running";
    // the timeline must not claim the Judge is still running on a terminal run.
    const record = baseRecord({
      status: "aborted",
      completedAt: 3_000,
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
      judge: {
        status: "running",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
    });

    const judge = buildTimeline(record).find((step) => step.label === "Judge");
    expect(judge?.detail).toBe("aborted");
    expect(judge?.detail).not.toContain("running");
    expect(judge?.state).toBe("warn");
  });

  it("an interrupted run with a left-running Judge reports Judge interrupted, not running", () => {
    const record = baseRecord({
      status: "interrupted",
      completedAt: 3_000,
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "running",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
    });

    const judge = buildTimeline(record).find((step) => step.label === "Judge");
    expect(judge?.detail).toBe("interrupted");
    expect(judge?.detail).not.toContain("running");
    expect(judge?.state).toBe("warn");
  });

  it("global aborted takes precedence over a left-running fusion Result", () => {
    const record = baseRecord({
      status: "aborted",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "running",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: { status: "running", acceptedAttemptId: null, attempts: [] },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("aborted by user");
    expect(result?.detail).not.toContain("fusion running");
    expect(result?.detail).not.toContain("pending");
    expect(result?.state).toBe("warn");
  });

  it("global interrupted takes precedence over a left-running fusion Result", () => {
    const record = baseRecord({
      status: "interrupted",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "running",
        acceptedAttemptId: null,
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: { status: "running", acceptedAttemptId: null, attempts: [] },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("stopped mid-run");
    expect(result?.detail).not.toContain("fusion running");
    expect(result?.state).toBe("warn");
  });

  it("candidate detail distinguishes failed from aborted/interrupted attempts", () => {
    const record = baseRecord({
      status: "interrupted",
      completedAt: 3_000,
      candidates: [
        candidate("done", "completed", true),
        candidate("bad", "failed"),
        candidate("stopped", "interrupted"),
      ],
    });

    const candidates = buildTimeline(record).find((step) => step.label === "Candidates");
    // 1 done, 1 failed (error), 1 interrupted (stopped) — not 2 errors.
    expect(candidates?.detail).toBe("1/3 done · 1 error · 1 stopped");
    expect(candidates?.detail).not.toContain("2 error");
    expect(candidates?.state).toBe("warn");
  });

  it("unstarted candidates on a terminal aborted record are not completed, not pending", () => {
    const record = baseRecord({
      status: "aborted",
      completedAt: 3_000,
      candidates: [candidate("done", "completed", true), candidate("queued", null)],
    });

    const candidates = buildTimeline(record).find((step) => step.label === "Candidates");
    expect(candidates?.detail).toBe("1/2 done · 1 not completed");
    expect(candidates?.detail).not.toContain("pending");
    expect(candidates?.state).toBe("warn");
  });

  it("running records still label unsettled candidates as pending, not not completed", () => {
    const record = baseRecord({
      status: "running",
      candidates: [
        candidate("done", "completed", true),
        candidate("active", "running"),
        candidate("queued", null),
      ],
    });

    const candidates = buildTimeline(record).find((step) => step.label === "Candidates");
    expect(candidates?.detail).toBe("1/3 done · 2 pending");
    expect(candidates?.detail).not.toContain("not completed");
    expect(candidates?.state).toBe("running");
  });

  it("a failed re-fuse with a valid prior accepted fusion shows fused, not no result", () => {
    // Defect: a Fuse run whose latest re-fuse fails but still has a valid
    // previously accepted fusion result must truthfully show the accepted
    // fused outcome, not "no result - fusion failed".
    const record = baseRecord({
      status: "completed",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: ["openrouter:done"],
      candidates: [candidate("done", "completed", true)],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: {
        status: "error",
        acceptedAttemptId: "fusion-att-1",
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 1_500,
            finishedAt: 2_000,
            status: "completed",
            error: null,
            result: "Fused answer combining all candidates",
          },
          {
            attemptId: "fusion-att-2",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge again" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 3_500,
            finishedAt: 4_000,
            status: "failed",
            error: { message: "re-fuse failed" },
            result: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("fused");
    expect(result?.detail).not.toContain("no result");
    expect(result?.detail).not.toContain("fusion failed");
    expect(result?.state).toBe("done");
  });

  it("a Fusion done record without a valid accepted result does not claim fusion succeeded", () => {
    // Defect: fusion.status === "done" without a valid accepted result
    // (acceptedAttemptId is null or the accepted attempt has no result)
    // must not claim fusion succeeded.
    const record = baseRecord({
      status: "partial",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      // fusion.status is "done" but acceptedAttemptId is null — inconsistent
      // state that must not be reported as "fused".
      fusion: {
        status: "done",
        acceptedAttemptId: null,
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 2_500,
            finishedAt: 2_800,
            status: "failed",
            error: { message: "fusion failed" },
            result: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).not.toBe("fused");
    // Falls through to the partial + fusion-incomplete path since
    // fusion.status is "done" (not "error") but no valid accepted fusion.
    expect(result?.state).not.toBe("done");
  });

  it("a failed re-fuse with no prior accepted fusion still shows fusion failed", () => {
    // No prior accepted fusion — the error wording is correct.
    const record = baseRecord({
      status: "partial",
      completedAt: 3_000,
      mode: "fuse",
      winnerKeys: [],
      candidates: [candidate("done", "completed", true), candidate("bad", "failed")],
      judge: {
        status: "done",
        acceptedAttemptId: "judge-att-1",
        report: null,
        consensus: null,
        attempts: [],
      },
      fusion: {
        status: "error",
        acceptedAttemptId: null,
        attempts: [
          {
            attemptId: "fusion-att-1",
            providerId: "openrouter",
            model: "fuse-model",
            messages: [{ role: "user", content: "Merge" }],
            sourceJudgeAttemptId: "judge-att-1",
            candidateAttemptIdsByCandidateId: { done: "att-done" },
            startedAt: 2_500,
            finishedAt: 2_800,
            status: "failed",
            error: { message: "fusion failed" },
            result: null,
          },
        ],
      },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("no result - fusion failed");
    expect(result?.state).toBe("error");
  });
});
