// =============================================================================
// RED — explicit Policy Playbook execution in Compare (spec §8, plan Task 10).
//
// The playbook never attaches silently: execution only proceeds through an
// explicit, preflight-confirmed binding. The parent Comparison Result always
// persists FIRST (before any provider call) carrying the exact playbook ref +
// compatibility receipt; fuse/refine recommendations run the pinned synthesis
// recipe after successful judging; best_fixed/do_not_fuse create no Fusion
// Result; ordinary Compare runs afterwards stay completely playbook-free.
//
// Mock providers only — no paid calls.
// =============================================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type React from "react";
import { createRunController, type RunControllerDeps } from "../run-controller";
import { estimatePlaybookCostPreflight, type PlaybookRunBinding } from "./playbook-execution";
import {
  modelConfigRefForIdentity,
  type PinnedTaskSetVersionView,
  type PlaybookCompatibilityReceipt,
} from "../studies/policy/playbook-compatibility";
import { InMemoryRunRepository } from "../persistence/run-repository";
import { createRunRecorder } from "../persistence/run-recorder";
import type { ComparisonResultIndex } from "./comparison-result-types";
import { InMemoryComparisonRepository } from "../persistence/in-memory-comparison-repository";
import type { ModelSlot } from "../../studio-data";
import { initialState, type StudioState, type Action } from "../../studio-engine";
import type { StreamDeltaBuffer } from "../stream-buffer";
import {
  makeDefinition,
  makePlaybook,
  makePoolVersion,
  makeRecipeVersion,
  makeStudyRecord,
} from "../../workspaces/lab/lab-test-fixtures";
import type { PolicyRecommendation } from "../studies/policy/policy-study-types";
import { clearModelPricing, parseOpenRouterPricing, setModelPricing } from "../providers/pricing";

// ---------------------------------------------------------------------------
// Mocks (same idiom as run-controller.test.ts)
// ---------------------------------------------------------------------------

const chatStreamMock = vi.fn();
const chatCompletionMock = vi.fn();
const getProviderMock = vi.fn();

vi.mock("../providers/registry", () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

vi.mock("../run-history", () => ({
  addRun: vi.fn(),
  modelKey: (p: string, s: string) => `${p}:${s}`,
}));

vi.mock("../history-cache", () => ({
  invalidateHistoryCache: vi.fn(),
}));

function makeStreamBuffer(): StreamDeltaBuffer {
  return { push: vi.fn(), flush: vi.fn(), cancel: vi.fn() } as unknown as StreamDeltaBuffer;
}

// ---------------------------------------------------------------------------
// World fixtures
// ---------------------------------------------------------------------------

const POOL_SLOTS: ModelSlot[] = [
  {
    id: "s1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "m-a",
    slug: "model-a",
    enabled: true,
  },
  {
    id: "s2",
    providerId: "umans",
    provider: "Umans",
    model: "m-b",
    slug: "model-b",
    enabled: true,
  },
];

const WORKLOAD_VIEW: PinnedTaskSetVersionView = {
  taskSetId: "ts1",
  version: 6,
  members: [{ taskVersionRef: { taskId: "task-1", taskVersion: 3 } }],
};

const ADOPT_FUSE: PolicyRecommendation = {
  kind: "adopt",
  policy: "fuse",
  configuration: "m-a × m-b · BlindRaw v1",
  rationale: "Fuse clears the predeclared MPID over best-fixed.",
};

const ADOPT_REFINE: PolicyRecommendation = {
  kind: "adopt",
  policy: "refine",
  configuration: "Refine winner · BlindRaw v1",
  rationale: "Refine clears the MPID vs best-fixed.",
};

const ADOPT_BEST_FIXED: PolicyRecommendation = {
  kind: "adopt",
  policy: "best_fixed",
  configuration: "m-a solo",
  rationale: "Nothing clears the MPID; run the best single model.",
};

interface WorldOptions {
  recommendation?: PolicyRecommendation;
  core?: ModelSlot[];
}

function makeWorld(options: WorldOptions = {}) {
  const pool = makePoolVersion("pool-1", 4, {
    core: options.core ?? POOL_SLOTS,
    challengers: [],
  });
  const definition = makeDefinition({
    modelPool: { poolId: pool.poolId, version: pool.version, digest: pool.digest },
  });
  const study = makeStudyRecord({
    id: "study-1",
    status: "completed",
    reportRef: "pb-1",
    definition,
  });
  const playbook = makePlaybook({
    studyId: study.id,
    definitionFingerprint: study.definitionFingerprint,
    recommendation: options.recommendation ?? ADOPT_FUSE,
  });
  return { pool, definition, study, playbook };
}

function makeBinding(overrides: Partial<PlaybookRunBinding> = {}): PlaybookRunBinding {
  const world = makeWorld({
    recommendation: overrides.playbook?.recommendation ?? ADOPT_FUSE,
  });
  const matchedCandidateIds = POOL_SLOTS.map(
    (s) => modelConfigRefForIdentity(s.providerId, s.model).id,
  ).sort();
  const receipt: PlaybookCompatibilityReceipt = {
    playbookId: "pb-1",
    studyId: "study-1",
    definitionFingerprint: world.study.definitionFingerprint,
    workloadBasis: "task_set_context",
    workload: { taskSetId: "ts1", version: 6 },
    pool: { poolId: "pool-1", version: 4 },
    matchedCandidateIds,
    evaluatedAt: 1,
  };
  const playbook = overrides.playbook
    ? {
        ...overrides.playbook,
        studyId: overrides.study?.id ?? world.study.id,
        definitionFingerprint:
          overrides.study?.definitionFingerprint ?? world.study.definitionFingerprint,
      }
    : world.playbook;
  return {
    playbookId: "pb-1",
    study: world.study,
    poolVersion: world.pool,
    pinnedTaskSetVersion: WORKLOAD_VIEW,
    recipeVersion: makeRecipeVersion(),
    taskSetContext: { taskSetId: "ts1", version: 6 },
    compatibility: { ok: true, receipt },
    costPreflight: {
      pricedAt: 1,
      baselineCostUsd: null,
      policyCostUsd: null,
      synthesisCostUsd: null,
      multiplier: null,
      partial: true,
    },
    preflightConfirmedAt: 100,
    ...overrides,
    playbook,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function stateWithSlots(slots: ModelSlot[] = POOL_SLOTS): StudioState {
  return {
    ...initialState,
    mode: "rank",
    prompt: "Which algorithm finds the shortest path?",
    slots,
    critic: { providerId: "openrouter", model: "judge-model" },
  };
}

function makeDeps(state: StudioState) {
  const dispatched: Action[] = [];
  const stateRef = { current: state } as React.MutableRefObject<StudioState>;
  const runEpochRef = { current: 0 } as React.MutableRefObject<number>;
  const abortControllersRef = { current: new Set<AbortController>() } as React.MutableRefObject<
    Set<AbortController>
  >;
  const dispatch: React.Dispatch<Action> = (a) => {
    dispatched.push(a);
    if (a.type === "SET_MODE") stateRef.current = { ...stateRef.current, mode: a.mode };
    if (a.type === "FANOUT_START")
      stateRef.current = {
        ...stateRef.current,
        running: true,
        candidates: a.candidates,
        runContext: a.context,
        runId: a.runId ?? null,
      };
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
    if (a.type === "INSUFFICIENT_CANDIDATES")
      stateRef.current = { ...stateRef.current, running: false };
    if (a.type === "JUDGE_START")
      stateRef.current = {
        ...stateRef.current,
        running: true,
        judgeStatus: "running",
        judgeReport: null,
        fusionStatus: "idle",
        fusedText: null,
      };
    if (a.type === "JUDGE_RESULT")
      stateRef.current = {
        ...stateRef.current,
        running: a.mode === "fuse" ? stateRef.current.running : false,
        judgeStatus: "done",
        judgeReport: a.report,
        consensus: a.consensus,
      };
    if (a.type === "JUDGE_FAILED")
      stateRef.current = { ...stateRef.current, running: false, judgeStatus: "error" };
    if (a.type === "FUSION_START")
      stateRef.current = { ...stateRef.current, running: true, fusionStatus: "running" };
    if (a.type === "FUSION_RESULT")
      stateRef.current = {
        ...stateRef.current,
        running: false,
        fusionStatus: "done",
        fusedText: a.text,
      };
    if (a.type === "FUSION_FAILED")
      stateRef.current = { ...stateRef.current, running: false, fusionStatus: "error" };
    if (a.type === "ABORT_RUN") stateRef.current = { ...stateRef.current, running: false };
  };

  const runRepo = new InMemoryRunRepository();
  const recorder = createRunRecorder(runRepo, undefined, { enforceLease: false });
  const comparisonRepo = new InMemoryComparisonRepository(runRepo);

  const deps: RunControllerDeps = {
    stateRef,
    dispatch,
    runEpochRef,
    abortControllersRef,
    streamBuffer: makeStreamBuffer(),
    random: () => 0.999,
    now: () => 1_000,
    recorder,
    comparisonRepo,
  };
  return { deps, dispatched, stateRef, runRepo, comparisonRepo };
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

beforeEach(() => {
  chatStreamMock.mockReset();
  chatCompletionMock.mockReset();
  getProviderMock.mockReset();
  getProviderMock.mockImplementation(() => ({
    id: "openrouter",
    label: "OpenRouter",
    chatCompletionStream: chatStreamMock,
    chatCompletion: chatCompletionMock,
  }));
  chatStreamMock.mockImplementation(() => streamOf("Answer text"));
});

afterEach(() => {
  vi.clearAllMocks();
  clearModelPricing();
});

// ---------------------------------------------------------------------------
// Explicit playbook execution
// ---------------------------------------------------------------------------

describe("run-controller — explicit playbook execution (spec §8)", () => {
  it("persists the parent ComparisonResult with the exact playbook ref BEFORE any provider call", async () => {
    const { deps, stateRef, comparisonRepo } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);

    let indexAtFirstProviderCall: ComparisonResultIndex[] | null = null;
    chatStreamMock.mockImplementation(async function* () {
      if (indexAtFirstProviderCall === null) {
        indexAtFirstProviderCall = await comparisonRepo.listComparisonResults({});
      }
      yield "Answer text";
    });
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4.5],
        ["B", 4.0],
      ]),
    );

    const binding = makeBinding({
      playbook: makePlaybook({ recommendation: ADOPT_BEST_FIXED }),
    });
    await controller.runWithPlaybook(binding);

    // The index existed before the first candidate stream call.
    expect(indexAtFirstProviderCall).not.toBeNull();
    expect(indexAtFirstProviderCall!.length).toBe(1);

    const envelope = await comparisonRepo.getComparisonResult(stateRef.current.runId!);
    expect(envelope).not.toBeNull();
    const attachment = envelope!.index.policyPlaybook;
    expect(attachment).not.toBeNull();
    expect(attachment!.playbookId).toBe("pb-1");
    expect(attachment!.studyId).toBe("study-1");
    expect(attachment!.definitionFingerprint).toBe(binding.study.definitionFingerprint);
    expect(attachment!.compatibility.workload).toEqual({ taskSetId: "ts1", version: 6 });
    expect(attachment!.compatibility.matchedCandidateIds).toHaveLength(2);
  });

  it("fuse recommendation runs the pinned recipe synthesis after judging and persists a FusionResult", async () => {
    const { deps, dispatched, stateRef, runRepo } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4.5],
          ["B", 4.0],
        ]),
      )
      .mockResolvedValueOnce("Policy-fused answer.");

    await controller.runWithPlaybook(makeBinding());

    expect(stateRef.current.fusedText).toBe("Policy-fused answer.");
    // The synthesis call used the recipe's synthesizer with recipe messages.
    expect(chatCompletionMock).toHaveBeenCalledTimes(2);
    const synthesisCall = chatCompletionMock.mock.calls[1][0];
    expect(synthesisCall.model).toBe("acme/synth-1");
    expect(JSON.stringify(synthesisCall.messages)).toContain("senior synthesizer");

    // The record carries the derived fusion attempt with the playbook ref.
    const record = await runRepo.get(stateRef.current.runId!);
    expect(record).not.toBeNull();
    expect(record!.mode).toBe("fuse");
    expect(record!.fusion.attempts).toHaveLength(1);
    expect(record!.fusion.attempts[0].result).toBe("Policy-fused answer.");
    expect(record!.fusion.attempts[0].playbookRef?.playbookId).toBe("pb-1");
    expect(dispatched.map((a) => a.type)).toContain("FUSION_RESULT");
  });

  it("refine recommendation revises the judged winner through the pinned recipe flags", async () => {
    const { deps, stateRef } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4.5],
          ["B", 4.0],
        ]),
      )
      .mockResolvedValueOnce("Refined winner answer.");

    await controller.runWithPlaybook(
      makeBinding({ playbook: makePlaybook({ recommendation: ADOPT_REFINE }) }),
    );

    expect(stateRef.current.fusedText).toBe("Refined winner answer.");
    const synthesisCall = chatCompletionMock.mock.calls[1][0];
    const text = JSON.stringify(synthesisCall.messages);
    // The winner (label A, score 4.5) is revised against the rubric.
    expect(text).toContain("Winning draft (Candidate A)");
    expect(text).toContain("senior reviser");
  });

  it("best_fixed recommendation creates NO Fusion Result — the judged parent is the outcome", async () => {
    const { deps, dispatched, stateRef, runRepo } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4.5],
        ["B", 4.0],
      ]),
    );

    await controller.runWithPlaybook(
      makeBinding({ playbook: makePlaybook({ recommendation: ADOPT_BEST_FIXED }) }),
    );

    expect(chatCompletionMock).toHaveBeenCalledTimes(1); // judge only
    expect(stateRef.current.fusedText).toBeNull();
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
    const record = await runRepo.get(stateRef.current.runId!);
    expect(record!.fusion.attempts).toHaveLength(0);
    expect(record!.mode).toBe("rank");
  });

  it("do_not_fuse recommendation creates NO Fusion Result", async () => {
    const { deps, dispatched, stateRef, runRepo } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4.5],
        ["B", 4.0],
      ]),
    );

    const doNotFuse = makePlaybook({
      recommendation: {
        kind: "do_not_fuse",
        rationale: "Nothing clears the predeclared MPID.",
      },
    });
    await controller.runWithPlaybook(makeBinding({ playbook: doNotFuse }));

    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(stateRef.current.fusedText).toBeNull();
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
    const record = await runRepo.get(stateRef.current.runId!);
    expect(record!.fusion.attempts).toHaveLength(0);
    expect(record!.mode).toBe("rank");
  });

  it("a failed Judge stops the run before any derived synthesis", async () => {
    const { deps, dispatched, stateRef, runRepo } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);
    chatCompletionMock.mockRejectedValueOnce(new Error("judge 500"));

    await controller.runWithPlaybook(makeBinding());

    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(dispatched.map((a) => a.type)).toContain("JUDGE_FAILED");
    expect(dispatched.map((a) => a.type)).not.toContain("FUSION_START");
    const record = await runRepo.get(stateRef.current.runId!);
    expect(record).not.toBeNull();
    expect(record!.fusion.attempts).toHaveLength(0);
  });

  it("blocks before any provider call when the current roster is not pool-compatible", async () => {
    const outside: ModelSlot = {
      id: "s3",
      providerId: "gemini",
      provider: "Gemini",
      model: "m-z",
      slug: "model-z",
      enabled: true,
    };
    const state = stateWithSlots([...POOL_SLOTS, outside]);
    const { deps, dispatched, comparisonRepo } = makeDeps(state);
    const controller = createRunController(deps);

    await controller.runWithPlaybook(makeBinding());

    expect(chatStreamMock).not.toHaveBeenCalled();
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(dispatched.map((a) => a.type)).toContain("FANOUT_BLOCKED");
    const blocked = dispatched.find((a) => a.type === "FANOUT_BLOCKED") as { reason: string };
    expect(blocked.reason).toMatch(/pool/i);
    expect(await comparisonRepo.listComparisonResults({})).toHaveLength(0);
  });

  it("requires an explicit preflight confirmation timestamp", async () => {
    const { deps, dispatched } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);

    await controller.runWithPlaybook(makeBinding({ preflightConfirmedAt: 0 }));

    expect(chatStreamMock).not.toHaveBeenCalled();
    expect(chatCompletionMock).not.toHaveBeenCalled();
    expect(dispatched.map((a) => a.type)).toContain("FANOUT_BLOCKED");
  });

  it("ordinary Compare runs after a playbook run remain completely playbook-free", async () => {
    const { deps, dispatched, stateRef, comparisonRepo, runRepo } = makeDeps(stateWithSlots());
    const controller = createRunController(deps);
    chatCompletionMock
      .mockResolvedValueOnce(
        judgeResponse([
          ["A", 4.5],
          ["B", 4.0],
        ]),
      )
      .mockResolvedValueOnce("Policy-fused answer.");
    await controller.runWithPlaybook(makeBinding());
    const playbookRunId = stateRef.current.runId!;

    // Reset to an ordinary Rank session.
    dispatched.length = 0;
    chatStreamMock.mockClear();
    chatCompletionMock.mockClear();
    chatCompletionMock.mockResolvedValueOnce(
      judgeResponse([
        ["A", 4.2],
        ["B", 3.9],
      ]),
    );
    deps.dispatch({ type: "SET_MODE", mode: "rank" });

    await controller.runFanout();

    const ordinaryRunId = stateRef.current.runId!;
    expect(ordinaryRunId).not.toBe(playbookRunId);
    const envelope = await comparisonRepo.getComparisonResult(ordinaryRunId);
    expect(envelope!.index.policyPlaybook).toBeNull();
    const record = await runRepo.get(ordinaryRunId);
    expect(record!.fusion.attempts).toHaveLength(0);
    // Judge only — no synthesis provider call was attached by any playbook.
    expect(chatCompletionMock).toHaveBeenCalledTimes(1);
    expect(stateRef.current.fusedText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Live cost preflight (current pricing only, never a false total)
// ---------------------------------------------------------------------------

describe("playbook cost preflight", () => {
  function seedPrices(): void {
    for (const slug of ["model-a", "model-b", "judge-model", "acme/synth-1"]) {
      setModelPricing(
        parseOpenRouterPricing("openrouter", slug, { prompt: "1", completion: "2" }, 1)!,
      );
    }
    setModelPricing(
      parseOpenRouterPricing("umans", "model-b", { prompt: "1", completion: "2" }, 1)!,
    );
  }

  const preflightInput = (
    recommendation: PolicyRecommendation,
    synthesizer?: { providerId: "openrouter" | "umans"; model: string } | null,
  ) => ({
    prompt: "Which algorithm finds the shortest path?",
    slots: POOL_SLOTS,
    critic: { providerId: "openrouter", model: "judge-model" },
    recommendation,
    synthesizer,
    now: () => 42,
  });

  it("estimates policy cost vs the experimental baseline from current pricing", () => {
    seedPrices();
    const pf = estimatePlaybookCostPreflight(
      preflightInput(ADOPT_FUSE, { providerId: "openrouter", model: "acme/synth-1" }),
    );
    expect(pf.pricedAt).toBe(42);
    expect(pf.baselineCostUsd).not.toBeNull();
    expect(pf.synthesisCostUsd).not.toBeNull();
    expect(pf.policyCostUsd).not.toBeNull();
    expect(pf.policyCostUsd!).toBeGreaterThan(pf.baselineCostUsd!);
    expect(pf.multiplier!).toBeGreaterThan(1);
    expect(pf.partial).toBe(false);
  });

  it("best_fixed policy cost equals the baseline (no synthesis call)", () => {
    seedPrices();
    const pf = estimatePlaybookCostPreflight(preflightInput(ADOPT_BEST_FIXED, null));
    expect(pf.policyCostUsd).toBe(pf.baselineCostUsd);
    expect(pf.multiplier).toBe(1);
    expect(pf.synthesisCostUsd).toBeNull();
  });

  it("is honest (partial, no total) when any component lacks a price", () => {
    // No pricing seeded at all.
    const pf = estimatePlaybookCostPreflight(
      preflightInput(ADOPT_FUSE, { providerId: "openrouter", model: "acme/synth-1" }),
    );
    expect(pf.baselineCostUsd).toBeNull();
    expect(pf.policyCostUsd).toBeNull();
    expect(pf.partial).toBe(true);
  });
});
