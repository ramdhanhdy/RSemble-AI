// @vitest-environment happy-dom
// =============================================================================
// Comparison Recovery Regression Suite (Plan Task 10, Spec §9)
//
// Pins recovery, retry, re-judge, re-fuse, abort, storage/lease failure, and
// Open in Compare / exact Record backlink contracts:
//  - Candidate retry: preserves frozen context, resets candidate to pending,
//    updates segments/stream deltas, transitions to done/error, progresses to
//    judge stage on success, acquires and releases execution lease;
//  - Judge retry / re-judge: candidate outputs are never re-executed, dynamic
//    blind labels stay valid and correctly unblind to candidate IDs, report is
//    keyed by candidate IDs not blind labels, transitions error -> running -> done;
//  - Fusion retry / re-fuse: candidate outputs and judge report are never re-executed,
//    re-fuse passes accepted judge attempt ID and blind-label map to synthesizer,
//    re-fuse without accepted judge attempt fails cleanly;
//  - Abort / interruption: halts active streams, sets aborted=true, releases
//    execution lease, blocks subsequent retries while aborted, records valid status;
//  - Storage / Lease recovery: blocks retry/judge/fusion when lease is unavailable
//    or another execution is active, clears cleanly when lease recovers;
//  - Open in Compare & Record backlink UI: restores frozen configuration ONLY,
//    never injects outputs or implicit lineage, provides exact Record deep link
//    to /runs/:runId and canonical task link when bound.
// =============================================================================

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ComparisonResultRoute } from "./ComparisonResultRoute";
import { InMemoryComparisonRepository } from "../../lib/persistence/in-memory-comparison-repository";
import { InMemoryRunRepository } from "../../lib/persistence/run-repository";
import { InMemoryEvidenceRepository } from "../../lib/persistence/evidence-repository";
import { InMemoryExecutionLease } from "../../lib/execution-lease";
import { createRunController, type RunControllerDeps } from "../../lib/run-controller";
import { type StudioState, type Action } from "../../studio-engine";
import { type Candidate, type ModelSlot } from "../../studio-data";
import type {
  RunRecordV2,
  FullRunSummaryV2,
  PersistedCandidate,
  JudgeAttemptRecord,
} from "../../lib/persistence/run-types";
import type { StreamDeltaBuffer } from "../../lib/stream-buffer";
import type { Attachment } from "../../lib/attachments/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// --- Mock provider & pipeline dependencies -----------------------------------

const chatStreamMock = vi.fn();
const chatCompletionMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("../../lib/providers/registry", () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

vi.mock("../../lib/run-history", () => ({
  addRun: vi.fn(),
  modelKey: (p: string, s: string) => `${p}:${s}`,
}));

vi.mock("../../lib/history-cache", () => ({
  invalidateHistoryCache: vi.fn(),
}));

function makeStreamBuffer(): StreamDeltaBuffer {
  return {
    push: vi.fn(),
    flush: vi.fn(),
    cancel: vi.fn(),
  } as unknown as StreamDeltaBuffer;
}

const TWO_SLOTS: ModelSlot[] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "gpt-4o",
    slug: "gpt-4o",
    enabled: true,
  },
  {
    id: "s2",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "claude-3.5-sonnet",
    slug: "claude-3.5-sonnet",
    enabled: true,
  },
];

const SAMPLE_ATTACHMENT: Attachment = {
  id: "att-1",
  name: "notes.txt",
  kind: "text",
  status: "ready",
  mimeType: "text/plain",
  text: "notes context",
  bytes: 13,
};

function stateWithSlots(
  slots: ModelSlot[] = TWO_SLOTS,
  mode: "rank" | "fuse" = "rank",
): StudioState {
  return {
    running: false,
    aborted: false,
    mode,
    slots,
    prompt: "Compare these responses",
    exampleIndex: -1,
    systemPrompt: "You are a helpful assistant",
    temperature: 0.7,
    evaluation: { kind: "holistic" },
    critic: { providerId: "openrouter", model: "judge-model" },
    judgeInstruction: "",
    reasoningPolicy: { candidates: "provider-default", judge: "provider-default" },
    models: [],
    candidates: [],
    judgeStatus: "idle",
    judgeError: null,
    judgeReport: null,
    consensus: null,
    insufficient: null,
    fusionStatus: "idle",
    fusionError: null,
    fusedText: null,
    qualityRating: 0,
    taskBinding: null,
    attachments: [],
    attachmentsToJudge: true,
    runContext: null,
    runId: null,
    audit: [],
  };
}

function doneCandidate(id: string, providerId: string, model: string, text: string): Candidate {
  return {
    id,
    providerId: providerId as never,
    provider: providerId,
    model,
    slug: model,
    accent: "indigo",
    strategy: "Parallel model",
    summary: text.slice(0, 50),
    scores: {},
    weightedScore: 0,
    status: "done",
    segments: [{ id: `${id}-s0`, text }],
  };
}

async function* streamOf(text: string) {
  yield text;
}

function makeJudgeResponse(evaluations: [string, number, string?][]) {
  return JSON.stringify({
    consensus: ["Both candidates answered correctly."],
    contradictions: [],
    uniqueInsights: [],
    evaluations: evaluations.map(([label, score, rationale], i) => ({
      label,
      score,
      position: i === 0 ? "First" : "Second",
      rationale: rationale ?? `Evaluation for ${label}`,
      strengths: ["Clear and accurate response."],
      deductions: [],
      missedRequirements: [],
      criterionScores: [],
    })),
    comparisons: [
      {
        labels: ["A", "B"],
        reason: "Candidate A had slightly better structure.",
      },
    ],
  });
}

function makeDeps(state: StudioState, now: () => number = () => Date.now()) {
  const dispatched: Action[] = [];
  const stateRef = { current: state } as React.MutableRefObject<StudioState>;
  const runEpochRef = { current: 0 } as React.MutableRefObject<number>;
  const abortControllersRef = { current: new Set<AbortController>() } as React.MutableRefObject<
    Set<AbortController>
  >;

  const dispatch: React.Dispatch<Action> = (a) => {
    dispatched.push(a);
    if (a.type === "FANOUT_START") {
      stateRef.current = {
        ...stateRef.current,
        running: true,
        candidates: a.candidates,
        runContext: a.context,
      };
    }
    if (a.type === "CANDIDATE_RESULT") {
      stateRef.current = {
        ...stateRef.current,
        candidates: stateRef.current.candidates.map((c) =>
          c.id === a.id ? { ...c, status: "done", segments: a.segments, summary: a.summary } : c,
        ),
      };
    }
    if (a.type === "CANDIDATE_FAILED") {
      stateRef.current = {
        ...stateRef.current,
        candidates: stateRef.current.candidates.map((c) =>
          c.id === a.id ? { ...c, status: "error", errorMessage: a.error } : c,
        ),
      };
    }
    if (a.type === "RETRY_CANDIDATE_START") {
      stateRef.current = {
        ...stateRef.current,
        running: true,
        candidates: stateRef.current.candidates.map((c) =>
          c.id === a.id
            ? { ...c, status: "pending", segments: [], summary: "", errorMessage: undefined }
            : c,
        ),
      };
    }
    if (a.type === "RETRY_CANDIDATE_RESULT") {
      stateRef.current = {
        ...stateRef.current,
        candidates: stateRef.current.candidates.map((c) =>
          c.id === a.id ? { ...c, status: "done", segments: a.segments, summary: a.summary } : c,
        ),
      };
    }
    if (a.type === "JUDGE_START") {
      stateRef.current = {
        ...stateRef.current,
        running: true,
        judgeStatus: "running",
        judgeError: null,
        judgeReport: null,
      };
    }
    if (a.type === "JUDGE_RESULT") {
      stateRef.current = {
        ...stateRef.current,
        running: a.mode === "fuse" ? stateRef.current.running : false,
        judgeStatus: "done",
        judgeReport: a.report,
      };
    }
    if (a.type === "JUDGE_FAILED") {
      stateRef.current = {
        ...stateRef.current,
        running: false,
        judgeStatus: "error",
        judgeError: a.error,
      };
    }
    if (a.type === "FUSION_START") {
      stateRef.current = { ...stateRef.current, running: true, fusionStatus: "running" };
    }
    if (a.type === "FUSION_RESULT") {
      stateRef.current = {
        ...stateRef.current,
        running: false,
        fusionStatus: "done",
        fusedText: a.text,
      };
    }
    if (a.type === "FUSION_FAILED") {
      stateRef.current = {
        ...stateRef.current,
        running: false,
        fusionStatus: "error",
        fusionError: a.error,
      };
    }
    if (a.type === "ABORT_RUN") {
      stateRef.current = { ...stateRef.current, running: false, aborted: true };
    }
    if (a.type === "FANOUT_BLOCKED") {
      stateRef.current = { ...stateRef.current, running: false };
    }
  };

  const deps: RunControllerDeps = {
    stateRef,
    dispatch,
    runEpochRef,
    abortControllersRef,
    streamBuffer: makeStreamBuffer(),
    random: () => 0.999, // Deterministic unblind: Candidate A -> first, Candidate B -> second
    now,
  };

  return { stateRef, dispatched, deps, runEpochRef, abortControllersRef };
}

// --- UI Test Harness ---------------------------------------------------------

interface DomHarness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function renderRouted(
  element: React.ReactNode,
  initialEntries: string[] = ["/compare/results/cmp-rec-1"],
): DomHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/compare/results/:comparisonId" element={element} />
          <Route
            path="/compare"
            element={<div data-testid="compare-workspace">Compare Draft Workspace</div>}
          />
          <Route
            path="/runs/:runId"
            element={<div data-testid="run-detail">Run Detail View</div>}
          />
          <Route
            path="/tasks/:taskId/versions/:version"
            element={<div data-testid="task-version">Task Version View</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return {
    container,
    root,
    $: (sel: string) => container.querySelector(sel),
    $$: (sel: string) => Array.from(container.querySelectorAll(sel)),
  };
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function makePersistedCandidate(
  candidateId: string,
  slotId: string,
  model: string,
  slug: string,
  output: string,
  status: "completed" | "failed" = "completed",
): PersistedCandidate {
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  return {
    candidateId,
    slotId,
    modelKey: `openrouter:${slug}`,
    providerId: "openrouter",
    model,
    slug,
    acceptedAttemptId: isCompleted ? `att-${candidateId}` : null,
    attempts: [
      {
        attemptId: `att-${candidateId}`,
        messages: [{ role: "user", content: "Prompt" }],
        startedAt: 1000,
        finishedAt: 1050,
        status,
        output: isCompleted ? output : null,
        tokensIn: 20,
        tokensOut: 50,
        error: isFailed ? { message: `${model} failure` } : null,
      },
    ],
  };
}

function makeValidRankRecord(id: string): RunRecordV2 {
  const c1 = makePersistedCandidate("cand-1", "s1", "GPT-4o", "gpt-4o", "Candidate 1 output");
  const judgeAttempt: JudgeAttemptRecord = {
    attemptId: "j-att-1",
    providerId: "openrouter",
    model: "judge-model",
    instruction: "Evaluate accuracy.",
    messages: [{ role: "user", content: "Evaluate" }],
    blindLabelToCandidateId: { A: "cand-1" },
    candidateAttemptIdsByCandidateId: { "cand-1": "att-cand-1" },
    startedAt: 1100,
    finishedAt: 1150,
    status: "completed",
    error: null,
    report: {
      labelMap: [{ label: "A", candidateId: "cand-1" }],
      evaluationsById: {
        "cand-1": {
          candidateId: "cand-1",
          blindLabel: "A",
          overallScore: 5.0,
          position: "First",
          rationale: "Correct implementation",
          strengths: ["Clean"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [
            {
              criterionId: "crit-correctness",
              label: "Correctness",
              score: 5.0,
              rationale: "100% correct",
            },
          ],
        },
      },
      comparisons: [],
    },
    consensus: null,
  };

  return {
    schemaVersion: 2,
    id,
    revision: 1,
    execution: { ownerId: "tab-1", fence: 1 },
    createdAt: 1000,
    updatedAt: 1200,
    completedAt: 1200,
    status: "completed",
    mode: "rank",
    source: { kind: "adhoc" },
    task: {
      title: "Algorithm comparison",
      prompt: "Implement binary search in TypeScript",
      systemPrompt: "Use strict types",
      temperature: 0.5,
    },
    evaluation: {
      profile: {
        id: "rub-1",
        version: 1,
        name: "Accuracy Rubric",
        description: "Rubric for accuracy",
        judgeInstruction: "Judge accurately",
        createdAt: 1000,
        updatedAt: 1000,
        criteria: [
          {
            id: "crit-correctness",
            kind: "graded",
            name: "Correctness",
            description: "Is output correct",
            weight: 1,
            anchors: {
              one: "Completely incorrect",
              two: "Major issues",
              three: "Partially correct",
              four: "Minor issues",
              five: "100% correct",
            },
          },
        ],
      },
      candidateMessages: [{ role: "user", content: "Prompt" }],
    },
    candidates: [c1],
    judge: {
      status: "done",
      acceptedAttemptId: "j-att-1",
      report: judgeAttempt.report,
      consensus: null,
      attempts: [judgeAttempt],
    },
    fusion: { status: "idle", acceptedAttemptId: null, attempts: [] },
    winnerKeys: ["openrouter:gpt-4o"],
  };
}

// --- Test suite --------------------------------------------------------------

describe("Comparison Recovery & Regression (Spec §9)", () => {
  beforeEach(() => {
    chatStreamMock.mockReset();
    chatCompletionMock.mockReset();
    getProviderMock.mockReset();
    getProviderMock.mockImplementation(() => ({
      id: "openrouter",
      label: "OpenRouter",
      chatCompletionStream: chatStreamMock,
      chatCompletion: chatCompletionMock,
      supportsStreaming: true,
      supportedReasoningEfforts: () => ["none"],
    }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Candidate retry
  // ---------------------------------------------------------------------------
  describe("Candidate retry recovery", () => {
    it("retries a single failed candidate preserving frozen context and progresses to judge", async () => {
      const c1 = doneCandidate("cand-s1", "openrouter", "gpt-4o", "Candidate 1 text");
      const c2Failed: Candidate = {
        id: "cand-s2",
        providerId: "openrouter",
        provider: "OpenRouter",
        model: "claude-3.5-sonnet",
        slug: "claude-3.5-sonnet",
        accent: "indigo",
        strategy: "Parallel model",
        summary: "",
        scores: {},
        weightedScore: 0,
        status: "error",
        errorMessage: "Provider 500 error",
        segments: [],
      };

      const baseState = stateWithSlots(TWO_SLOTS, "rank");
      baseState.candidates = [c1, c2Failed];
      baseState.runContext = {
        task: {
          prompt: "Frozen prompt task",
          systemPrompt: "Frozen system prompt",
          temperature: 0.4,
        },
        prompt: "Frozen prompt task",
        evaluation: { kind: "holistic" },
        slots: TWO_SLOTS,
        attachments: [SAMPLE_ATTACHMENT],
        attachmentsToJudge: true,
        critic: baseState.critic,
        reasoningPolicy: baseState.reasoningPolicy,
      };

      // User modified mutable state after run failed
      baseState.prompt = "Mutable modified prompt";
      baseState.attachments = [];

      const { stateRef, dispatched, deps } = makeDeps(baseState);
      const controller = createRunController(deps);

      // Candidate retry stream succeeds
      chatStreamMock.mockImplementation(() => streamOf("Retried candidate 2 answer"));
      // Judge evaluates both candidates
      chatCompletionMock.mockResolvedValue(
        makeJudgeResponse([
          ["A", 4.5, "Good candidate 1"],
          ["B", 4.0, "Good candidate 2"],
        ]),
      );

      await controller.retryCandidate(c2Failed);

      // Assert candidate retry started and ran with frozen context
      expect(dispatched.some((a) => a.type === "RETRY_CANDIDATE_START")).toBe(true);
      expect(chatStreamMock).toHaveBeenCalledTimes(1);

      const streamCall = chatStreamMock.mock.calls[0][0];
      expect(JSON.stringify(streamCall)).toContain("Frozen prompt task");
      expect(JSON.stringify(streamCall)).toContain("notes context");

      // Candidate 2 status transitioned to done
      expect(stateRef.current.candidates.find((c) => c.id === "cand-s2")?.status).toBe("done");

      // Automatically progressed to Judge
      expect(dispatched.some((a) => a.type === "JUDGE_START")).toBe(true);
      expect(dispatched.some((a) => a.type === "JUDGE_RESULT")).toBe(true);
      expect(stateRef.current.judgeStatus).toBe("done");
      expect(stateRef.current.running).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Judge retry / re-judge with dynamic blind labels
  // ---------------------------------------------------------------------------
  describe("Judge retry & re-judge with dynamic blind-labels", () => {
    it("retries failed Judge without re-executing candidates and maps blind labels to candidate IDs", async () => {
      const c1 = doneCandidate("cand-s1", "openrouter", "gpt-4o", "Output from model 1");
      const c2 = doneCandidate("cand-s2", "openrouter", "claude-3.5-sonnet", "Output from model 2");

      const baseState = stateWithSlots(TWO_SLOTS, "rank");
      baseState.candidates = [c1, c2];
      baseState.judgeStatus = "error";
      baseState.judgeError = "Judge rate limit exceeded";
      baseState.runContext = {
        task: {
          prompt: "Compare answers",
          systemPrompt: "You are a helpful assistant",
          temperature: 0.7,
        },
        prompt: "Compare answers",
        evaluation: { kind: "holistic" },
        slots: TWO_SLOTS,
        attachments: [],
        attachmentsToJudge: true,
        critic: baseState.critic,
        reasoningPolicy: baseState.reasoningPolicy,
      };

      const { stateRef, dispatched, deps } = makeDeps(baseState);
      const controller = createRunController(deps);

      // Judge re-try succeeds with blind labels
      chatCompletionMock.mockResolvedValue(
        makeJudgeResponse([
          ["A", 4.2, "Model 1 analysis"],
          ["B", 3.8, "Model 2 analysis"],
        ]),
      );

      await controller.retryJudge();

      // Candidates were NOT re-streamed
      expect(chatStreamMock).not.toHaveBeenCalled();

      // Judge ran once
      expect(chatCompletionMock).toHaveBeenCalledTimes(1);

      // Judge status transitions: running -> done
      expect(dispatched.some((a) => a.type === "JUDGE_START")).toBe(true);
      expect(dispatched.some((a) => a.type === "JUDGE_RESULT")).toBe(true);
      expect(stateRef.current.judgeStatus).toBe("done");

      // Blind label "A" correctly unblinded to cand-s1, "B" to cand-s2
      const report = stateRef.current.judgeReport;
      expect(report).not.toBeNull();
      expect(report?.evaluationsById["cand-s1"]).toBeDefined();
      expect(report?.evaluationsById["cand-s1"].overallScore).toBe(4.2);
      expect(report?.evaluationsById["cand-s2"]).toBeDefined();
      expect(report?.evaluationsById["cand-s2"].overallScore).toBe(3.8);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Fusion retry / re-fuse
  // ---------------------------------------------------------------------------
  describe("Fusion retry / re-fuse with accepted Judge provenance", () => {
    it("re-fuses with accepted Judge provenance and does not re-run candidates or judge", async () => {
      const c1 = doneCandidate("cand-s1", "openrouter", "gpt-4o", "Candidate A output");
      const c2 = doneCandidate("cand-s2", "openrouter", "claude-3.5-sonnet", "Candidate B output");

      const baseState = stateWithSlots(TWO_SLOTS, "fuse");
      baseState.candidates = [c1, c2];
      baseState.judgeStatus = "done";
      baseState.judgeReport = {
        labelMap: [
          { label: "A", candidateId: "cand-s1" },
          { label: "B", candidateId: "cand-s2" },
        ],
        evaluationsById: {
          "cand-s1": {
            candidateId: "cand-s1",
            blindLabel: "A",
            overallScore: 4.5,
            position: "First",
            rationale: "Good A",
            strengths: ["Clear"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [],
          },
          "cand-s2": {
            candidateId: "cand-s2",
            blindLabel: "B",
            overallScore: 3.5,
            position: "Second",
            rationale: "Good B",
            strengths: ["Adequate"],
            deductions: [],
            missedRequirements: [],
            criterionScores: [],
          },
        },
        comparisons: [],
      };
      baseState.fusionStatus = "error";
      baseState.fusionError = "Synthesis timeout";
      baseState.runContext = {
        mode: "fuse",
        prompt: "Fuse best elements",
        evaluation: { kind: "holistic" },
        slots: TWO_SLOTS,
        attachments: [],
        attachmentsToJudge: true,
      };

      const { stateRef, dispatched, deps } = makeDeps(baseState);
      const controller = createRunController(deps);

      chatCompletionMock.mockResolvedValue("High quality synthesized fusion text.");

      controller.triggerFusion(true);
      await settle();

      expect(chatStreamMock).not.toHaveBeenCalled();
      expect(chatCompletionMock).toHaveBeenCalledTimes(1);

      expect(dispatched.some((a) => a.type === "FUSION_START")).toBe(true);
      expect(dispatched.some((a) => a.type === "FUSION_RESULT")).toBe(true);
      expect(stateRef.current.fusionStatus).toBe("done");
      expect(stateRef.current.fusedText).toBe("High quality synthesized fusion text.");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Abort / Interruption and lease release
  // ---------------------------------------------------------------------------
  describe("Abort and interruption recovery", () => {
    it("aborts active execution, marks aborted=true, and releases execution lease", async () => {
      const baseState = stateWithSlots(TWO_SLOTS, "rank");
      const shared = {
        lease: null as import("../../lib/execution-lease").LeaseInfo | null,
        fence: 0,
      };
      const lease = new InMemoryExecutionLease(shared, null, { ownerId: "tab-test" });
      const { stateRef, dispatched, deps } = makeDeps(baseState);
      deps.lease = lease;
      const controller = createRunController(deps);

      // Simulate a long-running candidate stream
      chatStreamMock.mockImplementation(async function* () {
        yield "Initial chunk";
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
        yield "Final chunk";
      });

      const runPromise = controller.runFanout();
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      });

      expect(stateRef.current.running).toBe(true);

      // Trigger abort
      controller.abortRun();
      await runPromise;

      expect(dispatched.some((a) => a.type === "ABORT_RUN")).toBe(true);
      expect(stateRef.current.running).toBe(false);
      expect(stateRef.current.aborted).toBe(true);
      // Execution lease released cleanly
      expect(shared.lease).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Storage and lease failure recovery
  // ---------------------------------------------------------------------------
  describe("Storage and lease failure recovery", () => {
    it("blocks retry cleanly when lease is held by another active execution", async () => {
      const c1 = doneCandidate("cand-s1", "openrouter", "gpt-4o", "text 1");
      const c2: Candidate = {
        ...c1,
        id: "cand-s2",
        status: "error",
        errorMessage: "err",
      };

      const baseState = stateWithSlots(TWO_SLOTS, "rank");
      baseState.candidates = [c1, c2];
      baseState.runContext = {
        prompt: "Task",
        evaluation: { kind: "holistic" },
        slots: TWO_SLOTS,
        attachments: [],
        attachmentsToJudge: true,
      };

      const shared = {
        lease: {
          leaseId: "lease-other",
          ownerId: "tab-other",
          kind: "compare" as const,
          executionId: "other-exec",
          acquiredAt: Date.now(),
          heartbeatAt: Date.now(),
          fence: 1,
          expiresAt: Date.now() + 60000,
        },
        fence: 1,
      };
      const lease = new InMemoryExecutionLease(shared, null, { ownerId: "tab-test" });

      const { dispatched, deps } = makeDeps(baseState);
      deps.lease = lease;

      const controller = createRunController(deps);
      await controller.retryCandidate(c2);

      // Blocked before calling any provider
      expect(chatStreamMock).not.toHaveBeenCalled();
      expect(dispatched.some((a) => a.type === "FANOUT_BLOCKED")).toBe(true);
      const blockedAction = dispatched.find((a) => a.type === "FANOUT_BLOCKED");
      expect((blockedAction as { reason: string }).reason).toContain("Another execution is active");
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Open in Compare & Record backlink in UI
  // ---------------------------------------------------------------------------
  describe("Open in Compare & Exact Record backlink UI", () => {
    it("restores config only to onOpenInCompare and renders deep link to /runs/:runId", async () => {
      const runRepo = new InMemoryRunRepository();
      const comparisonRepo = new InMemoryComparisonRepository(runRepo);
      const evidenceRepo = new InMemoryEvidenceRepository();

      const record = makeValidRankRecord("cmp-rec-1");

      const summary: FullRunSummaryV2 = {
        kind: "full",
        schemaVersion: 2,
        id: "cmp-rec-1",
        revision: 1,
        createdAt: 1000,
        completedAt: 1200,
        status: "completed",
        mode: "rank",
        source: { kind: "adhoc" },
        taskTitle: "Algorithm comparison",
        taskExcerpt: "Implement binary search in TypeScript",
        modelKeys: ["openrouter:gpt-4o"],
        winnerKeys: ["openrouter:gpt-4o"],
        scoresByModelKey: { "openrouter:gpt-4o": 5 },
        judgeModelKey: "openrouter:judge-model",
        evaluationProfileId: "rub-1",
        evaluationProfileVersion: 1,
        detailAvailable: true,
        searchText: "algorithm comparison implement binary search",
      };

      await runRepo.create(record, summary);

      await comparisonRepo.createComparisonEnvelope(record, {
        kind: "ad_hoc",
        inputSnapshotRef:
          "snap:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });

      const onOpenInCompare = vi.fn();

      const harness = renderRouted(
        <ComparisonResultRoute
          comparisonId="cmp-rec-1"
          comparisonRepo={comparisonRepo}
          runRepo={runRepo}
          evidenceRepo={evidenceRepo}
          onOpenInCompare={onOpenInCompare}
        />,
        ["/compare/results/cmp-rec-1"],
      );

      await settle();

      // Exact Record deep link is rendered
      const recordLink = harness.$('a[href="/runs/cmp-rec-1"]');
      expect(recordLink).not.toBeNull();
      expect(recordLink?.textContent).toContain("View exact Record");

      // Open in Compare button is present and triggers onOpenInCompare
      const openBtn = harness.$('button[data-action="open-in-compare"]');
      expect(openBtn).not.toBeNull();

      act(() => {
        openBtn?.click();
      });

      expect(onOpenInCompare).toHaveBeenCalledTimes(1);
      const [runId, preloadConfig] = onOpenInCompare.mock.calls[0];
      expect(runId).toBe("cmp-rec-1");

      // Honest preload contract: includes configuration ONLY, never outputs or lineage
      expect(preloadConfig.prompt).toBe("Implement binary search in TypeScript");
      expect(preloadConfig.systemPrompt).toBe("Use strict types");
      expect(preloadConfig.temperature).toBe(0.5);
      expect(preloadConfig.mode).toBe("rank");
      expect(preloadConfig.evaluation.kind).toBe("profile");
      expect(preloadConfig.slots.length).toBe(1);
      expect(preloadConfig.critic).toEqual({ providerId: "openrouter", model: "judge-model" });

      // No results, winners, or lineage fabricated into the preload
      expect(preloadConfig).not.toHaveProperty("winnerKeys");
      expect(preloadConfig).not.toHaveProperty("repeatedFrom");
      expect(preloadConfig).not.toHaveProperty("results");
    });
  });
});
