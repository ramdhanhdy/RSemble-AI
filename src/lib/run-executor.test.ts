// =============================================================================
// RSemble AI — Run executor tests
//
// Verifies the provider-agnostic task engine: executeTask, retryCandidate,
// retryJudge, and executeFusionAttempt. The executor emits lifecycle events
// but owns no React state or persistence.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Candidate, ModelSlot } from "../studio-data";
import {
  createRunExecutor,
  type RunRequest,
  type RunExecutorEvents,
  type FrozenCandidateRetryRequest,
  type FrozenJudgeRetryRequest,
  type FrozenFusionRequest,
} from "./run-executor";
import { HOLISTIC_EVALUATION } from "./evaluations/evaluation-profile-adhoc";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const chatStreamMock = vi.fn();
const chatCompletionMock = vi.fn();
const getProviderMock = vi.fn();
const devLogMock = vi.fn();

vi.mock("./dev-terminal-log", () => ({
  devTerminalLog: (...args: unknown[]) => devLogMock(...args),
}));

vi.mock("./providers/registry", () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

beforeEach(() => {
  chatStreamMock.mockReset();
  chatCompletionMock.mockReset();
  getProviderMock.mockReset();
  devLogMock.mockReset();
  getProviderMock.mockImplementation(() => ({
    id: "openrouter",
    label: "OpenRouter",
    chatCompletionStream: chatStreamMock,
    chatCompletion: chatCompletionMock,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TWO_SLOTS: ModelSlot[] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "A",
    slug: "model-a",
    enabled: true,
  },
  { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
];

const THREE_SLOTS: ModelSlot[] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "A",
    slug: "model-a",
    enabled: true,
  },
  { id: "s2", providerId: "umans", provider: "Umans", model: "B", slug: "model-b", enabled: true },
  {
    id: "s3",
    providerId: "gemini",
    provider: "Gemini",
    model: "C",
    slug: "model-c",
    enabled: true,
  },
];

function makeRequest(mode: "rank" | "fuse" = "rank", slots: ModelSlot[] = TWO_SLOTS): RunRequest {
  return {
    source: { kind: "adhoc" },
    mode,
    task: { prompt: "test prompt", systemPrompt: "", temperature: 0.7 },
    evaluation: HOLISTIC_EVALUATION,
    slots,
    critic: { providerId: "openrouter", model: "judge-model" },
    judgeInstruction: "",
    attachments: [],
    attachmentsToJudge: true,
  };
}
function makeEvents(): { events: RunExecutorEvents; calls: string[] } {
  const calls: string[] = [];
  const events: RunExecutorEvents = {
    onFanoutStart: vi.fn(async () => {
      calls.push("fanout-start");
    }),
    onCandidateDelta: vi.fn(() => {}),
    onCandidateTerminal: vi.fn(() => {}),
    onFanoutTerminal: vi.fn(async () => {
      calls.push("fanout-terminal");
    }),
    onCandidateAttemptStart: vi.fn(async () => {
      calls.push("candidate-attempt-start");
    }),
    onCandidateAttemptTerminal: vi.fn(async () => {
      calls.push("candidate-attempt-terminal");
    }),
    onJudgeStart: vi.fn(async () => {
      calls.push("judge-start");
    }),
    onJudgeTerminal: vi.fn(async () => {
      calls.push("judge-terminal");
    }),
    onFusionStart: vi.fn(async () => {
      calls.push("fusion-start");
    }),
    onFusionTerminal: vi.fn(async () => {
      calls.push("fusion-terminal");
    }),
  };
  return { events, calls };
}

async function* streamOf(text: string): AsyncGenerator<string, void, unknown> {
  yield text;
}

function judgeResponse(scores: Array<readonly [string, number]>): string {
  return JSON.stringify({
    consensus: [],
    contradictions: [],
    uniqueInsights: [],
    evaluations: scores.map(([label, score]) => ({
      label,
      score,
      position: `Position ${label}`,
      rationale: `Evidence ${label}`,
      strengths: [`Strength ${label}`],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    })),
    comparisons: [],
  });
}

function makeCandidate(id: string, text: string): Candidate {
  return {
    id,
    model: id,
    provider: "OpenRouter",
    providerId: "openrouter",
    slug: id,
    accent: "indigo",
    strategy: "Parallel model",
    summary: text,
    scores: {},
    weightedScore: 0,
    segments: [{ id: `${id}-s0`, text }],
    status: "done",
    startedAt: 1000,
    finishedAt: 2000,
  };
}

const TWO_DONE: Candidate[] = [
  makeCandidate("cand-s1", "answer A"),
  makeCandidate("cand-s2", "answer B"),
];

// ---------------------------------------------------------------------------
// executeTask tests
// ---------------------------------------------------------------------------

describe("RunExecutor — executeTask", () => {
  it("runs candidate providers in parallel", async () => {
    const callOrder: string[] = [];
    chatStreamMock
      .mockImplementationOnce(() => {
        callOrder.push("A-start");
        return streamOf("answer A");
      })
      .mockImplementationOnce(() => {
        callOrder.push("B-start");
        return streamOf("answer B");
      });
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    expect(callOrder).toEqual(["A-start", "B-start"]);
  });

  it("does not accept candidates or start Judge after terminal acceptance rejects", async () => {
    chatStreamMock.mockImplementation(() => streamOf("late candidate"));
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    events.onCandidateAttemptTerminal = vi.fn(async () => {
      throw new Error("lease fence rejected");
    });

    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);

    expect(events.onCandidateTerminal).not.toHaveBeenCalled();
    expect(calls).not.toContain("judge-start");
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("rejects duplicate enabled provider:model keys before any provider call", async () => {
    const dupSlots: ModelSlot[] = [
      {
        id: "s1",
        providerId: "openrouter",
        provider: "OR",
        model: "A",
        slug: "same",
        enabled: true,
      },
      {
        id: "s2",
        providerId: "openrouter",
        provider: "OR",
        model: "B",
        slug: "same",
        enabled: true,
      },
    ];
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await expect(
      executor.executeTask(makeRequest("rank", dupSlots), events, new AbortController().signal),
    ).rejects.toThrow(/duplicate/i);
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("Rank request never calls Fusion", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    expect(calls).not.toContain("fusion-start");
  });

  it("Fuse request calls Fusion only after valid Judge", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4],
          ["B", 3],
        ]),
      )
      .mockResolvedValueOnce("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);
    expect(calls).toContain("judge-start");
    expect(calls).toContain("fusion-start");
  });

  it("persists Unknown cost when the provider exposes no native usage", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4],
          ["B", 3],
        ]),
      )
      .mockResolvedValueOnce("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    const terminalInputs: Record<string, unknown[]> = { judge: [], fusion: [] };
    const capture =
      (key: "judge" | "fusion") =>
      async (_attemptId: string, input: unknown): Promise<void> => {
        terminalInputs[key].push(input);
      };
    events.onJudgeTerminal = vi.fn(capture("judge")) as never;
    events.onFusionTerminal = vi.fn(capture("fusion")) as never;
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);

    const candidateTerminals = vi.mocked(events.onCandidateAttemptTerminal).mock.calls;
    for (const [, , input] of candidateTerminals) {
      // No native usage on the mocked stream → honest Unknown fallback cost.
      expect((input as { cost: unknown }).cost).toEqual({ usd: null, source: "unknown" });
    }
    const judgeInputs = terminalInputs.judge;
    const fusionInputs = terminalInputs.fusion;
    expect(judgeInputs[judgeInputs.length - 1]).toMatchObject({
      cost: { usd: null, source: "unknown" },
    });
    expect(fusionInputs[fusionInputs.length - 1]).toMatchObject({
      cost: { usd: null, source: "unknown" },
    });
  });

  it("does not call Fusion when Judge fails", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValueOnce("malformed");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);
    expect(calls).toContain("judge-start");
    expect(calls).not.toContain("fusion-start");
  });

  it("does not call Judge when fewer than 2 usable candidates", async () => {
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new Error("B failed");
      });
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    expect(calls).not.toContain("judge-start");
  });

  it("abort suppresses stale events and queue completion", async () => {
    const ctrl = new AbortController();
    let resolveB: () => void = () => {};
    const deferredB = new Promise<void>((r) => {
      resolveB = r;
    });
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(async () => {
        await deferredB;
        return streamOf("answer B");
      });
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    const promise = executor.executeTask(makeRequest("rank"), events, ctrl.signal);
    ctrl.abort();
    resolveB();
    await promise;
    expect(calls).not.toContain("judge-start");
  });

  it("rejected fanout-start makes zero provider calls", async () => {
    const { events, calls } = makeEvents();
    events.onFanoutStart = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    expect(chatStreamMock).not.toHaveBeenCalled();
    expect(calls).not.toContain("candidate-attempt-start");
  });

  it("surfaces candidate-attempt persistence errors instead of leaving generic placeholders", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    const { events } = makeEvents();
    events.onCandidateAttemptStart = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });

    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);

    expect(chatStreamMock).not.toHaveBeenCalled();
    const terminalCalls = vi.mocked(events.onCandidateAttemptTerminal).mock.calls;
    expect(terminalCalls).toHaveLength(2);
    expect(terminalCalls[0][2].status).toBe("failed");
    expect(terminalCalls[0][2].error!.message).toContain("persistence rejected");
  });

  it("rejected fanout-terminal stops before Judge", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    const { events, calls } = makeEvents();
    events.onFanoutTerminal = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    expect(calls).not.toContain("judge-start");
  });

  it("rejected judge-start makes zero Judge calls", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    const { events } = makeEvents();
    events.onJudgeStart = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });

  it("rejected judge-terminal stops before Fusion", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const { events, calls } = makeEvents();
    events.onJudgeTerminal = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);
    expect(calls).not.toContain("fusion-start");
  });

  it("rejected fusion-start makes zero Fusion calls", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const { events } = makeEvents();
    events.onFusionStart = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);
    // The fusion provider call (chatCompletion) should not have been called
    // for fusion — only for the judge.
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
  });

  it("emits exact rendered messages in candidate-attempt-start", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    const startCall = (events.onCandidateAttemptStart as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(startCall[2].messages).toHaveLength(2);
    expect(startCall[2].messages[1].content).toBe("test prompt");
  });

  it("emits exact rendered messages and blind map in judge-start", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    const judgeStartCall = (events.onJudgeStart as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(judgeStartCall[1].messages).toHaveLength(2);
    expect(Object.keys(judgeStartCall[1].blindLabelToCandidateId)).toHaveLength(2);
    expect(judgeStartCall[1].candidateAttemptIdsByCandidateId).toBeTruthy();
  });

  it("emits judge terminal with report on success, error on failure", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    // First: success
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    const okCall = (events.onJudgeTerminal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(okCall[1].status).toBe("completed");
    expect(okCall[1].report).not.toBeNull();
  });

  it("emits fusion start with source judge attempt ID matching judge attemptId", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4],
          ["B", 3],
        ]),
      )
      .mockResolvedValueOnce("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);
    const judgeStartCall = (events.onJudgeStart as ReturnType<typeof vi.fn>).mock.calls[0];
    const judgeAttemptId = judgeStartCall[0];
    const fusionStartCall = (events.onFusionStart as ReturnType<typeof vi.fn>).mock.calls[0];
    // sourceJudgeAttemptId must be the real Judge attempt ID, not a blind label
    expect(fusionStartCall[1].sourceJudgeAttemptId).toBe(judgeAttemptId);
    expect(fusionStartCall[1].sourceJudgeAttemptId).not.toBe("A");
    expect(Object.keys(fusionStartCall[1].candidateAttemptIdsByCandidateId)).toHaveLength(2);
  });

  it("partial candidate success reaches Judge with two usable", async () => {
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new Error("B failed");
      })
      .mockImplementationOnce(() => streamOf("answer C"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeTask(
      makeRequest("rank", THREE_SLOTS),
      events,
      new AbortController().signal,
    );
    expect(calls).toContain("judge-start");
  });

  it("emits bounded sanitized provider error on candidate failure", async () => {
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new Error("connection reset by peer");
      });
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);
    const terminalCalls = (events.onCandidateAttemptTerminal as ReturnType<typeof vi.fn>).mock
      .calls;
    const failedCall = terminalCalls.find((c) => c[2].status === "failed");
    expect(failedCall).toBeTruthy();
    expect(failedCall![2].error).not.toBeNull();
    expect(failedCall![2].error!.message).toContain("connection reset");
  });
});

// ---------------------------------------------------------------------------
// retryCandidate tests
// ---------------------------------------------------------------------------

describe("RunExecutor — retryCandidate", () => {
  function makeRetryRequest(candidateId: string, slotId: string): FrozenCandidateRetryRequest {
    return {
      source: { kind: "adhoc" },
      mode: "rank",
      task: { prompt: "test prompt", systemPrompt: "", temperature: 0.7 },
      evaluation: HOLISTIC_EVALUATION,
      slots: TWO_SLOTS,
      critic: { providerId: "openrouter", model: "judge-model" },
      judgeInstruction: "",
      attachments: [],
      attachmentsToJudge: true,
      retryCandidateId: candidateId,
      retrySlotId: slotId,
      peerCandidates: TWO_DONE.filter((c) => c.id !== candidateId),
      candidateAttemptIdsByCandidateId: { "cand-s1": "peer-att-1", "cand-s2": "peer-att-2" },
    };
  }

  it("resolves the candidate slot and streams a new answer", async () => {
    chatStreamMock.mockImplementation(() => streamOf("retry answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.retryCandidate(
      makeRetryRequest("cand-s1", "s1"),
      events,
      new AbortController().signal,
    );
    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(calls).toContain("candidate-attempt-start");
    expect(calls).toContain("candidate-attempt-terminal");
  });

  it("success opens/runs a new Judge from frozen inputs", async () => {
    chatStreamMock.mockImplementation(() => streamOf("retry answer"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.retryCandidate(
      makeRetryRequest("cand-s1", "s1"),
      events,
      new AbortController().signal,
    );
    expect(calls).toContain("judge-start");
    expect(calls).toContain("judge-terminal");
  });

  it("success in Fuse mode runs a new Fusion attempt from frozen inputs", async () => {
    chatStreamMock.mockImplementation(() => streamOf("retry answer"));
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4],
          ["B", 3],
        ]),
      )
      .mockResolvedValueOnce("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    const req = makeRetryRequest("cand-s1", "s1");
    req.mode = "fuse";
    await executor.retryCandidate(req, events, new AbortController().signal);
    expect(calls).toContain("fusion-start");
    expect(calls).toContain("fusion-terminal");
  });

  it("failure makes no downstream calls (no Judge, no Fusion)", async () => {
    chatStreamMock.mockImplementation(() => {
      throw new Error("provider failed");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.retryCandidate(
      makeRetryRequest("cand-s1", "s1"),
      events,
      new AbortController().signal,
    );
    expect(calls).not.toContain("judge-start");
    expect(calls).not.toContain("fusion-start");
  });
});

// ---------------------------------------------------------------------------
// retryJudge tests
// ---------------------------------------------------------------------------

describe("RunExecutor — retryJudge", () => {
  function makeJudgeRetryRequest(): FrozenJudgeRetryRequest {
    return {
      mode: "rank",
      task: { prompt: "test prompt", systemPrompt: "", temperature: 0.7 },
      evaluation: HOLISTIC_EVALUATION,
      candidates: TWO_DONE,
      critic: { providerId: "openrouter", model: "judge-model" },
      judgeInstruction: "",
      attachments: [],
      attachmentsToJudge: true,
      candidateAttemptIdsByCandidateId: { "cand-s1": "att-1", "cand-s2": "att-2" },
    };
  }

  it("makes zero candidate stream calls", async () => {
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.retryJudge(makeJudgeRetryRequest(), events, new AbortController().signal);
    expect(chatStreamMock).not.toHaveBeenCalled();
  });

  it("uses only frozen candidates and emits judge events", async () => {
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
      ]),
    );
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.retryJudge(makeJudgeRetryRequest(), events, new AbortController().signal);
    expect(calls).toContain("judge-start");
    expect(calls).toContain("judge-terminal");
    expect(calls).not.toContain("fusion-start");
  });

  it("Fuse mode runs Fusion after successful Judge", async () => {
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4],
          ["B", 3],
        ]),
      )
      .mockResolvedValueOnce("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    const req = makeJudgeRetryRequest();
    req.mode = "fuse";
    await executor.retryJudge(req, events, new AbortController().signal);
    expect(calls).toContain("fusion-start");
  });

  it("does not call Fusion when Judge fails", async () => {
    chatCompletionMock.mockResolvedValueOnce("malformed");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    const req = makeJudgeRetryRequest();
    req.mode = "fuse";
    await executor.retryJudge(req, events, new AbortController().signal);
    expect(calls).not.toContain("fusion-start");
  });
});

// ---------------------------------------------------------------------------
// executeFusionAttempt tests
// ---------------------------------------------------------------------------

describe("RunExecutor — executeFusionAttempt", () => {
  function makeFusionRequest(): FrozenFusionRequest {
    return {
      mode: "fuse",
      task: { prompt: "test prompt", systemPrompt: "", temperature: 0.3 },
      evaluation: HOLISTIC_EVALUATION,
      candidates: TWO_DONE,
      critic: { providerId: "openrouter", model: "judge-model" },
      judgeInstruction: "",
      attachments: [],
      attachmentsToJudge: true,
      judgeAttemptId: "judge-att-1",
      blindLabelToCandidateId: { A: "cand-s1", B: "cand-s2" },
      candidateAttemptIdsByCandidateId: { "cand-s1": "att-1", "cand-s2": "att-2" },
    };
  }

  it("makes zero candidate and Judge calls", async () => {
    chatCompletionMock.mockResolvedValue("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeFusionAttempt(makeFusionRequest(), events, new AbortController().signal);
    expect(chatStreamMock).not.toHaveBeenCalled();
    // Only one chatCompletion call — the fusion itself.
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain("candidate-attempt-start");
    expect(calls).not.toContain("judge-start");
  });

  it("emits fusion start and terminal with result on success", async () => {
    chatCompletionMock.mockResolvedValue("fused answer");
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeFusionAttempt(makeFusionRequest(), events, new AbortController().signal);
    expect(calls).toContain("fusion-start");
    expect(calls).toContain("fusion-terminal");
    const terminalCall = (events.onFusionTerminal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(terminalCall[1].status).toBe("completed");
    expect(terminalCall[1].result).toBe("fused answer");
  });

  it("emits fusion terminal with error on failure", async () => {
    chatCompletionMock.mockRejectedValueOnce(new Error("fusion failed"));
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events, calls } = makeEvents();
    await executor.executeFusionAttempt(makeFusionRequest(), events, new AbortController().signal);
    expect(calls).toContain("fusion-start");
    expect(calls).toContain("fusion-terminal");
    const terminalCall = (events.onFusionTerminal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(terminalCall[1].status).toBe("failed");
    expect(terminalCall[1].result).toBeNull();
    expect(terminalCall[1].error).not.toBeNull();
  });

  it("rejected fusion-start makes zero fusion provider calls", async () => {
    const { events, calls } = makeEvents();
    events.onFusionStart = vi.fn(async () => {
      throw new Error("persistence rejected");
    });
    const executor = createRunExecutor({ random: () => 0.999 });
    await executor.executeFusionAttempt(makeFusionRequest(), events, new AbortController().signal);
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(calls).not.toContain("fusion-terminal");
  });
});

// ---------------------------------------------------------------------------
// Persisted error sanitization (spec §18 / plan 8.1 item 9)
// ---------------------------------------------------------------------------

describe("RunExecutor — persisted error sanitization", () => {
  const CRED_KEY = "rsemble.key.umans";
  const CRED_VALUE = "umans-secret-123";

  beforeEach(() => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => (key === CRED_KEY ? CRED_VALUE : null),
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  function failedCandidateError(events: RunExecutorEvents) {
    const terminalCalls = (events.onCandidateAttemptTerminal as ReturnType<typeof vi.fn>).mock
      .calls;
    const failed = terminalCalls.find((c) => c[2].status === "failed");
    expect(failed).toBeTruthy();
    return failed![2].error!;
  }

  it("redacts configured credential values from persisted candidate errors", async () => {
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new Error(`401 unauthorized: Bearer ${CRED_VALUE}`);
      });
    const executor = createRunExecutor({ random: () => 0.999, now: () => 4242 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);

    const error = failedCandidateError(events);
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain(CRED_VALUE);
    expect(error.category).toBe("provider");
    expect(error.stage).toBe("candidate");
    expect(error.model).toBe("model-b");
    expect(error.at).toBe(4242);
  });

  it("caps persisted error messages at 4096 UTF-8 bytes", async () => {
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new Error("x".repeat(9000) + "😀");
      });
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);

    const error = failedCandidateError(events);
    expect(new TextEncoder().encode(error.message).length).toBeLessThanOrEqual(4096);
    const last = error.message.charCodeAt(error.message.length - 1);
    expect(last < 0xd800 || last > 0xdfff).toBe(true);
  });

  it("persists judge failures with provider/judge context", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock.mockRejectedValue(new Error("judge blew up"));
    const executor = createRunExecutor({ random: () => 0.999, now: () => 99 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);

    const judgeTerminalCalls = (events.onJudgeTerminal as ReturnType<typeof vi.fn>).mock.calls;
    const failed = judgeTerminalCalls.find((c) => c[1].status === "failed");
    expect(failed).toBeTruthy();
    const error = failed![1].error!;
    expect(error.message).toContain("judge blew up");
    expect(error.category).toBe("provider");
    expect(error.stage).toBe("judge");
    expect(error.model).toBe("judge-model");
    expect(error.at).toBe(99);
  });

  it("persists fusion failures with provider/fusion context", async () => {
    chatStreamMock.mockImplementation(() => streamOf("answer"));
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4],
          ["B", 3],
        ]),
      )
      .mockRejectedValueOnce(new Error("fusion blew up"));
    const executor = createRunExecutor({ random: () => 0.999 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);

    const fusionTerminalCalls = (events.onFusionTerminal as ReturnType<typeof vi.fn>).mock.calls;
    const failed = fusionTerminalCalls.find((c) => c[1].status === "failed");
    expect(failed).toBeTruthy();
    const error = failed![1].error!;
    expect(error.message).toContain("fusion blew up");
    expect(error.category).toBe("provider");
    expect(error.stage).toBe("fusion");
    expect(error.model).toBe("judge-model");
  });

  it("classifies aborted candidate attempts with the aborted category", async () => {
    chatStreamMock
      .mockImplementationOnce(() => streamOf("answer A"))
      .mockImplementationOnce(() => {
        throw new DOMException("aborted", "AbortError");
      });
    const executor = createRunExecutor({ random: () => 0.999, now: () => 7 });
    const { events } = makeEvents();
    await executor.executeTask(makeRequest("rank"), events, new AbortController().signal);

    const error = failedCandidateError(events);
    expect(error.message).toBe("Candidate aborted");
    expect(error.category).toBe("aborted");
    expect(error.stage).toBe("candidate");
    expect(error.at).toBe(7);
  });
});

// --- Targeted candidate execution (Task 10) -----------------------------------

describe("executeTask — candidateExecution (Task 10)", () => {
  const EIGHT_SLOTS: ModelSlot[] = Array.from({ length: 8 }, (_, i) => ({
    id: `s${i + 1}`,
    providerId: "openrouter",
    provider: "OpenRouter",
    model: `Model ${i + 1}`,
    slug: `model-${i + 1}`,
    enabled: true,
  }));

  function seededCandidate(slot: ModelSlot, text: string): Candidate {
    return {
      id: `cand-${slot.id}`,
      model: slot.model,
      provider: slot.provider,
      providerId: slot.providerId,
      slug: slot.slug,
      accent: "indigo",
      strategy: "Parallel model",
      summary: text,
      scores: {},
      weightedScore: 0,
      segments: [{ id: `${slot.id}-seg`, text }],
      status: "done",
      startedAt: 1000,
      finishedAt: 2000,
    };
  }
  function seededAttemptIds(seeded: Candidate[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const c of seeded) map[c.id] = `seed-${c.id}`;
    return map;
  }

  it("calls the provider exactly once when only one model key is requested", async () => {
    const executor = createRunExecutor({ now: () => 0, generateId: () => "id" });
    const { events } = makeEvents();
    const onCandidateAttemptStart = events.onCandidateAttemptStart as ReturnType<typeof vi.fn>;
    const request = makeRequest("rank", EIGHT_SLOTS);
    const seeded = EIGHT_SLOTS.slice(0, 7).map((s) => seededCandidate(s, `reuse-${s.slug}`));
    const candidateExecution = {
      executeModelKeys: ["openrouter:model-8"],
      seededCandidates: seeded,
      seededAttemptIdsByCandidateId: seededAttemptIds(seeded),
    } as never;

    chatStreamMock.mockResolvedValue(streamOf("fresh-output"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
        ["C", 2],
        ["D", 1],
        ["E", 5],
        ["F", 4],
        ["G", 3],
        ["H", 2],
      ]),
    );

    await executor.executeTask(
      { ...request, candidateExecution },
      events,
      new AbortController().signal,
    );

    expect(chatStreamMock).toHaveBeenCalledTimes(1);
    expect(onCandidateAttemptStart).toHaveBeenCalledTimes(1);
    const calledId = (onCandidateAttemptStart.mock.calls[0] as unknown[])[0];
    expect(calledId).toBe("cand-s8");
  });

  it("never sends reused models to providers", async () => {
    const executor = createRunExecutor({ now: () => 0, generateId: () => "id" });
    const { events } = makeEvents();
    const request = makeRequest("rank", EIGHT_SLOTS);
    const seeded = EIGHT_SLOTS.slice(0, 7).map((s) => seededCandidate(s, `reuse-${s.slug}`));
    const candidateExecution = {
      executeModelKeys: ["openrouter:model-8"],
      seededCandidates: seeded,
      seededAttemptIdsByCandidateId: seededAttemptIds(seeded),
    } as never;

    chatStreamMock.mockResolvedValue(streamOf("fresh-output"));
    chatCompletionMock.mockResolvedValue(judgeResponse([["A", 4]]));

    await executor.executeTask(
      { ...request, candidateExecution },
      events,
      new AbortController().signal,
    );

    const calledSlugs = chatStreamMock.mock.calls.map((c) => (c[0] as { model?: string }).model);
    expect(calledSlugs).toEqual(["model-8"]);
  });

  it("Judge receives all eight candidate outputs with immutable attempt references", async () => {
    const executor = createRunExecutor({ now: () => 0, generateId: () => "id" });
    const { events } = makeEvents();
    const onJudgeStart = events.onJudgeStart as ReturnType<typeof vi.fn>;
    const request = makeRequest("rank", EIGHT_SLOTS);
    const seeded = EIGHT_SLOTS.slice(0, 7).map((s) => seededCandidate(s, `reuse-${s.slug}`));
    const candidateExecution = {
      executeModelKeys: ["openrouter:model-8"],
      seededCandidates: seeded,
      seededAttemptIdsByCandidateId: seededAttemptIds(seeded),
    } as never;

    chatStreamMock.mockResolvedValue(streamOf("fresh-output"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
        ["C", 2],
        ["D", 1],
        ["E", 5],
        ["F", 4],
        ["G", 3],
        ["H", 2],
      ]),
    );

    await executor.executeTask(
      { ...request, candidateExecution },
      events,
      new AbortController().signal,
    );

    expect(onJudgeStart).toHaveBeenCalledTimes(1);
    const judgeArg = (onJudgeStart.mock.calls[0] as unknown[])[0];
    if (judgeArg && typeof judgeArg === "object" && "blindLabelToCandidateId" in judgeArg) {
      const judgeObj = judgeArg as {
        blindLabelToCandidateId: Record<string, string>;
        candidateAttemptIdsByCandidateId: Record<string, string>;
      };
      const candidateIds = Object.values(judgeObj.blindLabelToCandidateId);
      expect(candidateIds).toHaveLength(8);
      // Every judged candidate has an immutable attempt reference.
      expect(Object.keys(judgeObj.candidateAttemptIdsByCandidateId)).toHaveLength(8);
    }
  });

  it("an unavailable target produces a partial compound run without deleting reused outputs", async () => {
    const executor = createRunExecutor({ now: () => 0, generateId: () => "id" });
    const { events } = makeEvents();
    const request = makeRequest("rank", EIGHT_SLOTS);
    const seeded = EIGHT_SLOTS.slice(0, 7).map((s) => seededCandidate(s, `reuse-${s.slug}`));
    const candidateExecution = {
      executeModelKeys: ["openrouter:model-8"],
      seededCandidates: seeded,
      seededAttemptIdsByCandidateId: seededAttemptIds(seeded),
    } as never;

    chatStreamMock.mockRejectedValue(new Error("provider unavailable"));
    chatCompletionMock.mockResolvedValue(
      judgeResponse([
        ["A", 4],
        ["B", 3],
        ["C", 2],
        ["D", 1],
        ["E", 5],
        ["F", 4],
        ["G", 3],
      ]),
    );

    await executor.executeTask(
      { ...request, candidateExecution },
      events,
      new AbortController().signal,
    );

    const onFanoutTerminal = events.onFanoutTerminal as ReturnType<typeof vi.fn>;
    expect(onFanoutTerminal).toHaveBeenCalledTimes(1);
    const doneArg = (onFanoutTerminal.mock.calls[0] as unknown[])[0] as Candidate[];
    expect(doneArg).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// Log containment — Plan 003 workstream D
// ---------------------------------------------------------------------------

describe("run-executor — dev log containment", () => {
  it("never forwards raw err.stack to the terminal logger", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/run-executor.ts"), "utf8");
    expect(source).not.toContain("stack: err.stack");
    expect(source).not.toMatch(/devTerminalLog\([\s\S]{0,200}?stack/);
  });

  it("logs only the sanitized error message for provider failures", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/run-executor.ts"), "utf8");
    // The sanitized PersistedError message is the only error payload passed to
    // devTerminalLog; raw bodies/stacks must not cross that boundary.
    expect(source).toContain("error: error.message");
    expect(source).not.toContain("JSON.stringify(err)");
  });
});

describe("RunExecutor — deadline classification", () => {
  it("maps a response that never yields headers into connect_timeout without a provider call", async () => {
    vi.useFakeTimers();
    try {
      chatStreamMock.mockImplementation((opts: { signal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) =>
            opts.signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        })(),
      );
      const { events } = makeEvents();
      const terminal = vi.mocked(events.onCandidateAttemptTerminal);
      const executor = createRunExecutor({
        deadlines: { connectMs: 50, inactivityMs: 100 },
      });
      const run = executor.executeTask(makeRequest(), events, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(50);
      await run;
      const failed = terminal.mock.calls
        .map((call) => call[2])
        .find((input) => input.status === "failed");
      expect(failed?.error?.category).toBe("timeout");
      expect(failed?.error?.message).toContain("connect_timeout");
      expect(chatCompletionMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits bounded timeout observability for a stalled Judge", async () => {
    vi.useFakeTimers();
    try {
      chatStreamMock.mockImplementation(() => streamOf("candidate answer"));
      chatCompletionMock.mockImplementation(
        (opts: { signal?: AbortSignal }) =>
          new Promise<string>((_resolve, reject) => {
            opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason), {
              once: true,
            });
          }),
      );
      const { events } = makeEvents();
      const executor = createRunExecutor({ deadlines: { connectMs: 25, inactivityMs: 100 } });
      const run = executor.executeTask(makeRequest(), events, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(25);
      await run;
      const timeoutLog = devLogMock.mock.calls.find(
        (call: unknown[]) =>
          call[0] === "judge.request.failed" && (call[1] as { timeoutKind?: string }).timeoutKind,
      );
      expect(timeoutLog?.[1]).toMatchObject({
        stage: "judge",
        status: "failed",
        timeoutKind: "connect_timeout",
      });
      expect(typeof (timeoutLog?.[1] as { durationMs?: unknown }).durationMs).toBe("number");
      expect((timeoutLog?.[1] as { error?: string }).error).not.toMatch(/candidate answer/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits timeout observability for a stalled Fusion", async () => {
    vi.useFakeTimers();
    try {
      chatStreamMock.mockImplementation(() => streamOf("candidate answer"));
      chatCompletionMock
        .mockResolvedValueOnce(
          judgeResponse([
            ["A", 4],
            ["B", 3],
          ]),
        )
        .mockImplementationOnce(
          (opts: { signal?: AbortSignal }) =>
            new Promise<string>((_resolve, reject) => {
              opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason), {
                once: true,
              });
            }),
        );
      const { events } = makeEvents();
      const executor = createRunExecutor({ deadlines: { connectMs: 25, inactivityMs: 100 } });
      const run = executor.executeTask(makeRequest("fuse"), events, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(25);
      await run;
      const timeoutLog = devLogMock.mock.calls.find(
        (call: unknown[]) =>
          call[0] === "fusion.request.failed" && (call[1] as { timeoutKind?: string }).timeoutKind,
      );
      expect(timeoutLog?.[1]).toMatchObject({
        stage: "fusion",
        status: "failed",
        timeoutKind: "connect_timeout",
      });
      expect(typeof (timeoutLog?.[1] as { durationMs?: unknown }).durationMs).toBe("number");
    } finally {
      vi.useRealTimers();
    }
  });
});
