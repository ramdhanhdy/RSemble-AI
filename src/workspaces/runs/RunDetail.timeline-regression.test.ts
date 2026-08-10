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
      fusion: { status: "done", acceptedAttemptId: null, attempts: [] },
    });

    const result = buildTimeline(record).find((step) => step.label === "Result");
    expect(result?.detail).toBe("fused");
    expect(result?.state).toBe("done");
  });
});
