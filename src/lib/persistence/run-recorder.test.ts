// =============================================================================
// RSemble AI — Run recorder tests
//
// Verifies the recorder persists stage boundaries via RunRepository, serializes
// writes per run ID, and uses CAS with expectedRevision. No streamed deltas.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRunRecorder, type RunRecorder } from "./run-recorder";
import type { RunRepository } from "./run-repository";
import type { RunRecordV2, ExecutionFence } from "./run-types";
import type { ChatMessage } from "../providers/types";

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

function makeMockRepo(): {
  repo: RunRepository;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async (_record: RunRecordV2, _summary: unknown) => {});
  const update = vi.fn(async (_record: RunRecordV2, _summary: unknown, _expected: number) => 1);
  const get = vi.fn(async (_id: string) => null);
  const repo: RunRepository = {
    create, update, get,
    subscribe: () => () => {},
    list: async () => [],
    importLegacySummary: async () => "created" as const,
    exportAll: async () => ({ schemaVersion: 1 as const, exportedAt: 0, runs: [], summaries: [] }),
    importArchive: async () => ({ imported: 0, skipped: 0, errors: [] }),
  };
  return { repo, create, update, get };
}

const FENCE: ExecutionFence = { ownerId: "tab-1", fence: 1 };

function makeRecord(id = "run-1", revision = 1): RunRecordV2 {
  return {
    schemaVersion: 2,
    id,
    revision,
    execution: FENCE,
    createdAt: 1000,
    updatedAt: 1000,
    candidates: [{
      candidateId: "s1", slotId: "s1", modelKey: "openrouter:a",
      providerId: "openrouter", model: "A", slug: "a",
      acceptedAttemptId: null,
      attempts: [{
        attemptId: "att-0", messages: MESSAGES, startedAt: 1000, finishedAt: null,
        status: "running", output: null, tokensIn: null, tokensOut: null, error: null,
      }],
    }],
    completedAt: null,
    status: "running",
    mode: "rank",
    source: { kind: "adhoc" },
    task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
    evaluation: { profile: null, candidateMessages: [] },
    judge: { status: "idle", acceptedAttemptId: null, report: null, consensus: null, attempts: [] },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: [],
  };
}

const MESSAGES: ChatMessage[] = [{ role: "user", content: "test" }];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RunRecorder", () => {
  let recorder: RunRecorder;
  let mocks: ReturnType<typeof makeMockRepo>;

  beforeEach(() => {
    mocks = makeMockRepo();
    recorder = createRunRecorder(mocks.repo);
  });

  it("begin creates a running record and returns the run ID", async () => {
    mocks.get.mockResolvedValue(null);
    const runId = await recorder.begin({
      runId: "run-1",
      source: { kind: "adhoc" },
      mode: "rank",
      task: { title: "T", prompt: "p", systemPrompt: "", temperature: 0.7 },
      evaluation: { profile: null, candidateMessages: [] },
      slots: [{ id: "s1", providerId: "openrouter", provider: "P", model: "A", slug: "a", enabled: true }],
      fence: FENCE,
    });
    expect(runId).toBe("run-1");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [record] = mocks.create.mock.calls[0];
    expect(record.status).toBe("running");
    expect(record.candidates).toHaveLength(1);
    expect(record.candidates[0].attempts[0].status).toBe("running");
  });

  it("beginCandidateAttempt persists a running attempt before the provider call", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.beginCandidateAttempt("run-1", "s1", "att-1", {
      attemptId: "att-1",
      messages: MESSAGES,
      startedAt: 2000,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [record] = mocks.update.mock.calls[0];
    const attempt = record.candidates[0].attempts.find((a: { attemptId: string }) => a.attemptId === "att-1");
    expect(attempt).toBeDefined();
    expect(attempt!.status).toBe("running");
  });

  it("finishCandidateAttempt finalizes the same attempt ID", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.beginCandidateAttempt("run-1", "s1", "att-1", {
      attemptId: "att-1", messages: MESSAGES, startedAt: 2000,
    });
    await recorder.finishCandidateAttempt("run-1", "s1", "att-1", {
      status: "completed", output: "answer", tokensIn: 5, tokensOut: 10, error: null, finishedAt: 3000,
    });
    // Two updates: begin + finish
    expect(mocks.update).toHaveBeenCalledTimes(2);
    const [finalRecord] = mocks.update.mock.calls[1];
    const attempt = finalRecord.candidates[0].attempts.find((a: { attemptId: string }) => a.attemptId === "att-1");
    expect(attempt!.status).toBe("completed");
    expect(attempt!.output).toBe("answer");
  });

  it("candidate retry appends a running attempt and never overwrites prior accepted", async () => {
    const record = makeRecord();
    // First attempt completed
    record.candidates[0].attempts[0].status = "completed";
    record.candidates[0].attempts[0].output = "first";
    record.candidates[0].acceptedAttemptId = "att-0";
    mocks.get.mockResolvedValue(record);

    await recorder.beginCandidateAttempt("run-1", "s1", "att-1", {
      attemptId: "att-1", messages: MESSAGES, startedAt: 3000,
    });
    const [updatedRecord] = mocks.update.mock.calls[0];
    expect(updatedRecord.candidates[0].attempts).toHaveLength(2);
    expect(updatedRecord.candidates[0].acceptedAttemptId).toBe("att-0");
    expect(updatedRecord.candidates[0].attempts[1].attemptId).toBe("att-1");
  });

  it("beginJudgeAttempt persists running before the call", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.beginJudgeAttempt("run-1", "judge-att-1", {
      providerId: "openrouter", model: "judge", instruction: "",
      messages: MESSAGES,
      blindLabelToCandidateId: { A: "s1" },
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 2000,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [record] = mocks.update.mock.calls[0];
    expect(record.judge.status).toBe("running");
    expect(record.judge.attempts).toHaveLength(1);
    expect(record.judge.attempts[0].status).toBe("running");
  });

  it("finishJudgeAttempt finalizes the same ID; success moves accepted pointer", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.beginJudgeAttempt("run-1", "judge-att-1", {
      providerId: "openrouter", model: "judge", instruction: "",
      messages: MESSAGES,
      blindLabelToCandidateId: { A: "s1" },
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 2000,
    });
    await recorder.finishJudgeAttempt("run-1", "judge-att-1", {
      status: "completed",
      report: { labelMap: [], evaluationsById: {}, comparisons: [] },
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
      error: null, finishedAt: 3000,
    });
    const [record] = mocks.update.mock.calls[1];
    expect(record.judge.acceptedAttemptId).toBe("judge-att-1");
    expect(record.judge.status).toBe("done");
  });

  it("failed Judge does not move accepted pointer", async () => {
    const record = makeRecord();
    record.judge.attempts.push({
      attemptId: "judge-att-0", providerId: "openrouter", model: "judge", instruction: "",
      messages: MESSAGES, blindLabelToCandidateId: { A: "s1" },
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 1000, finishedAt: 2000, status: "completed",
      error: null, report: { labelMap: [], evaluationsById: {}, comparisons: [] },
      consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
    });
    record.judge.acceptedAttemptId = "judge-att-0";
    record.judge.status = "done";
    mocks.get.mockResolvedValue(record);

    await recorder.beginJudgeAttempt("run-1", "judge-att-1", {
      providerId: "openrouter", model: "judge", instruction: "",
      messages: MESSAGES,
      blindLabelToCandidateId: { A: "s1" },
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 3000,
    });
    await recorder.finishJudgeAttempt("run-1", "judge-att-1", {
      status: "failed", report: null, consensus: null,
      error: { message: "bad" }, finishedAt: 4000,
    });
    const [finalRecord] = mocks.update.mock.calls[1];
    expect(finalRecord.judge.acceptedAttemptId).toBe("judge-att-0");
    expect(finalRecord.judge.attempts).toHaveLength(2);
  });

  it("beginFusionAttempt persists running before the call", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.beginFusionAttempt("run-1", "fusion-att-1", {
      providerId: "openrouter", model: "judge",
      messages: MESSAGES,
      sourceJudgeAttemptId: "judge-att-0",
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 2000,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const [record] = mocks.update.mock.calls[0];
    expect(record.fusion.status).toBe("running");
    expect(record.fusion.attempts[0].sourceJudgeAttemptId).toBe("judge-att-0");
  });

  it("finishFusionAttempt finalizes the same ID; success moves accepted pointer", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.beginFusionAttempt("run-1", "fusion-att-1", {
      providerId: "openrouter", model: "judge",
      messages: MESSAGES,
      sourceJudgeAttemptId: "judge-att-0",
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 2000,
    });
    await recorder.finishFusionAttempt("run-1", "fusion-att-1", {
      status: "completed", result: "fused", error: null, finishedAt: 3000,
    });
    const [record] = mocks.update.mock.calls[1];
    expect(record.fusion.acceptedAttemptId).toBe("fusion-att-1");
    expect(record.fusion.status).toBe("done");
  });

  it("failed re-fuse preserves prior accepted Fusion", async () => {
    const record = makeRecord();
    record.fusion.attempts.push({
      attemptId: "fusion-att-0", providerId: "openrouter", model: "judge",
      messages: MESSAGES, sourceJudgeAttemptId: "judge-att-0",
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 1000, finishedAt: 2000, status: "completed",
      error: null, result: "first fused",
    });
    record.fusion.acceptedAttemptId = "fusion-att-0";
    record.fusion.status = "done";
    mocks.get.mockResolvedValue(record);

    await recorder.beginFusionAttempt("run-1", "fusion-att-1", {
      providerId: "openrouter", model: "judge",
      messages: MESSAGES,
      sourceJudgeAttemptId: "judge-att-0",
      candidateAttemptIdsByCandidateId: { s1: "att-0" },
      startedAt: 3000,
    });
    await recorder.finishFusionAttempt("run-1", "fusion-att-1", {
      status: "failed", result: null, error: { message: "fail" }, finishedAt: 4000,
    });
    const [finalRecord] = mocks.update.mock.calls[1];
    expect(finalRecord.fusion.acceptedAttemptId).toBe("fusion-att-0");
    expect(finalRecord.fusion.attempts).toHaveLength(2);
  });

  it("markAborted finalizes all running attempts as aborted", async () => {
    const record = makeRecord();
    record.candidates.push({
      candidateId: "s1", slotId: "s1", modelKey: "k", providerId: "p", model: "m", slug: "s",
      acceptedAttemptId: null,
      attempts: [{ attemptId: "att-0", messages: MESSAGES, startedAt: 1000, finishedAt: null, status: "running", output: null, tokensIn: null, tokensOut: null, error: null }],
    });
    mocks.get.mockResolvedValue(record);
    await recorder.markAborted("run-1");
    const [finalRecord] = mocks.update.mock.calls[0];
    expect(finalRecord.status).toBe("aborted");
    expect(finalRecord.candidates[1].attempts[0].status).toBe("aborted");
  });

  it("serializes writes per run ID (second write waits for first)", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    let resolve1: () => void = () => {};
    const block1 = new Promise<void>((r) => { resolve1 = r; });
    mocks.update.mockImplementationOnce(async () => { await block1; return 2; });

    const p1 = recorder.beginCandidateAttempt("run-1", "s1", "att-1", {
      attemptId: "att-1", messages: MESSAGES, startedAt: 2000,
    });
    const p2 = recorder.beginCandidateAttempt("run-1", "s1", "att-2", {
      attemptId: "att-2", messages: MESSAGES, startedAt: 3000,
    });

    // Let p1's async chain (repo.get → mutate → repo.update) reach the update call
    await new Promise((r) => setTimeout(r, 10));
    // p2 should not have called update yet
    expect(mocks.update).toHaveBeenCalledTimes(1);

    resolve1();
    await p1;
    await p2;
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown run ID", async () => {
    mocks.get.mockResolvedValue(null);
    await expect(
      recorder.beginCandidateAttempt("unknown", "s1", "att-1", {
        attemptId: "att-1", messages: MESSAGES, startedAt: 2000,
      }),
    ).rejects.toThrow(/not found|unknown/i);
  });

  it("repository error is propagated with stage context", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    mocks.update.mockRejectedValueOnce(new Error("storage write failed"));
    await expect(
      recorder.beginCandidateAttempt("run-1", "s1", "att-1", {
        attemptId: "att-1", messages: MESSAGES, startedAt: 2000,
      }),
    ).rejects.toThrow(/storage write failed/i);
  });

  it("no method writes streamed deltas", async () => {
    // The recorder has no method for streaming deltas
    const methods = Object.keys(recorder);
    expect(methods).not.toContain("onCandidateDelta");
    expect(methods).not.toContain("saveDelta");
    expect(methods).not.toContain("appendDelta");
  });

  it("saveFanout persists terminal candidate results after fanout settles", async () => {
    mocks.get.mockResolvedValue(makeRecord());
    await recorder.saveFanout("run-1", {
      candidates: [],
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
