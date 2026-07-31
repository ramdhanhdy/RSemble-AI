// =============================================================================
// RSemble AI — Fusion Study end-to-end integration tests
//
// Drives a synthetic Fusion Study against mock providers (plan §11):
// stratified Stage A → headroom shortlist → blocked Stage B → Stage C spot
// check → sealed playbook, asserting the Trial/Attempt rule and the
// anti-circularity invariant hold throughout (spec tests 3, 8, 10; acceptance
// 3, 6, 10).
// =============================================================================

import { describe, expect, it } from "vitest";
import { InMemoryFusionStudyRepository } from "../persistence/fusion-study-repository";
import type {
  BlindCandidate,
  CandidateEvaluation,
  JudgeReport,
  ModelSlot,
} from "../../studio-data";
import type { CriticRef, ChatMessage } from "../providers/types";
import type {
  EvaluationProfile,
  EvaluationSuite,
  EvaluationTask,
} from "./evaluation-types";
import type {
  FusionRecipeVersion,
  FusionStudy,
  PoolManifestVersion,
} from "./fusion-study-types";
import {
  FUSION_RECIPE_ANALYSIS_FED_V1,
  FUSION_RECIPE_ANALYSIS_SCORES_V1,
  FUSION_RECIPE_BLIND_RAW_V1,
} from "./fusion-recipes";
import { candidateIdForSlot } from "../pipeline";
import { createFusionStudyController, type FusionPolicyExecutor, type PoolSweepOutput } from "./fusion-study-controller";
import { runStageA, runStageB, runStageC, type StageDriverDeps } from "./fusion-study-stages";
import { buildPlaybook } from "./fusion-playbook";

// --- Deterministic fixture ------------------------------------------------------

const judge1: CriticRef = { providerId: "openrouter", model: "acme/judge-1" };
const judge2: CriticRef = { providerId: "gemini", model: "acme/judge-2" };

function slot(n: number, slug: string): ModelSlot {
  return { id: `s${n}`, providerId: "openrouter", provider: "Test", model: slug, slug, enabled: true };
}

/** Six pool models; B and C are criterion-complementary, the rest identical. */
const POOL_SLOTS = [
  slot(1, "m-a"),
  slot(2, "m-b"),
  slot(3, "m-c"),
  slot(4, "m-d"),
  slot(5, "m-e"),
  slot(6, "m-f"),
];

const STRENGTHS: Record<string, { acc: number; comp: number }> = {
  "openrouter:m-a": { acc: 4, comp: 4 },
  "openrouter:m-b": { acc: 5, comp: 3 },
  "openrouter:m-c": { acc: 3, comp: 5 },
  "openrouter:m-d": { acc: 4, comp: 4 },
  "openrouter:m-e": { acc: 4, comp: 4 },
  "openrouter:m-f": { acc: 4, comp: 4 },
  // Uniform pool for the adequacy-probe fixture — genuinely redundant.
  "openrouter:u-1": { acc: 4, comp: 4 },
  "openrouter:u-2": { acc: 4, comp: 4 },
  "openrouter:u-3": { acc: 4, comp: 4 },
  "openrouter:u-4": { acc: 4, comp: 4 },
  "openrouter:u-5": { acc: 4, comp: 4 },
  "openrouter:u-6": { acc: 4, comp: 4 },
  "openrouter:m-x": { acc: 4, comp: 4 },
};

const PROFILE: EvaluationProfile = {
  id: "prof-1",
  version: 1,
  name: "Quality",
  description: "test",
  judgeInstruction: "judge fairly",
  criteria: [
    { id: "acc", name: "Accuracy", description: "correct", weight: 1, anchors: { one: "bad", three: "ok", five: "great" } },
    { id: "comp", name: "Completeness", description: "complete", weight: 1, anchors: { one: "bad", three: "ok", five: "great" } },
  ],
  createdAt: 1000,
  updatedAt: 1000,
};

function taskOf(n: number): EvaluationTask {
  return {
    id: `t${n}`,
    title: `Task ${n}`,
    prompt: `Prompt ${n}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: n,
  };
}

const TASKS = [taskOf(1), taskOf(2), taskOf(3)];

const SUITE: EvaluationSuite = {
  id: "suite-1",
  revision: 0,
  version: 4,
  name: "Suite",
  description: "",
  tasks: TASKS,
  modelSlots: POOL_SLOTS,
  defaultJudge: judge1,
  defaultEvaluation: { kind: "profile", profile: { id: "prof-1", version: 1 } },
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
};

const POOL: PoolManifestVersion = {
  id: "pool-1",
  version: 1,
  core: POOL_SLOTS,
  challengers: [],
  diversityChecklist: ["independent families"],
  rationale: "test pool",
  supersedesVersion: null,
  createdAt: 1000,
};

/** Holdout scores by artifact key — AnalysisScores > AnalysisFed > BlindRaw. */
const HOLDOUT_SCORES: Record<string, number> = {
  "fuse:BlindRaw": 3.5,
  "fuse:AnalysisFed": 4.2,
  "fuse:AnalysisScores": 4.5,
  refine: 4.4,
  rank: 4.0,
  best_fixed: 3.8,
  cell: 4.0,
};

function evaluationFor(candidateId: string, blindLabel: string, modelKey: string): CandidateEvaluation {
  const s = STRENGTHS[modelKey] ?? { acc: 4, comp: 4 };
  return {
    candidateId,
    blindLabel,
    overallScore: (s.acc + s.comp) / 2,
    position: `${modelKey} position`,
    rationale: "evidence",
    strengths: ["s"],
    deductions: [],
    missedRequirements: [],
    criterionScores: [
      { criterionId: "acc", label: "Accuracy", score: s.acc, rationale: "r" },
      { criterionId: "comp", label: "Completeness", score: s.comp, rationale: "r" },
    ],
  };
}

function judgeReportFor(outputs: PoolSweepOutput[]): JudgeReport {
  const evaluationsById: Record<string, CandidateEvaluation> = {};
  outputs.forEach((o, i) => {
    evaluationsById[o.candidateId] = evaluationFor(o.candidateId, String.fromCharCode(65 + i), o.modelKey);
  });
  return {
    labelMap: outputs.map((o, i) => ({ label: String.fromCharCode(65 + i), candidateId: o.candidateId })),
    evaluationsById,
    comparisons: [],
  };
}

function makeMockExecutor(overrides: Partial<FusionPolicyExecutor> = {}): FusionPolicyExecutor {
  const base: FusionPolicyExecutor = {
    async runPoolSweep(task, slots) {
      return {
        taskId: task.id,
        outputs: slots.map((s) => ({
          slot: s,
          modelKey: `${s.providerId}:${s.slug}`,
          candidateId: candidateIdForSlot(s.id),
          text: `out:${task.id}:${s.slug}`,
          cost: { tokensIn: 100, tokensOut: 50 },
        })),
      };
    },
    async judgePool(_task, _profile, _judge, outputs) {
      return {
        report: judgeReportFor(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        cost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runBlockedEvidence(task, _profile, pair, _judge) {
      const outputs: PoolSweepOutput[] = pair.map((s) => ({
        slot: s,
        modelKey: `${s.providerId}:${s.slug}`,
        candidateId: candidateIdForSlot(s.id),
        text: `out:${task.id}:${s.slug}`,
        cost: { tokensIn: 100, tokensOut: 50 },
      }));
      const blindCandidates: BlindCandidate[] = outputs.map((o, i) => ({
        label: String.fromCharCode(65 + i),
        candidateId: o.candidateId,
        content: o.text,
      }));
      return {
        blindCandidates,
        report: judgeReportFor(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        candidateAttemptIdsByCandidateId: Object.fromEntries(
          outputs.map((o) => [o.candidateId, `catt-${task.id}-${o.slot.id}`]),
        ),
        judgeAttemptId: `jatt-${task.id}`,
        candidateRunId: `run-cand-${task.id}`,
        devJudgeRunId: `run-judge-${task.id}`,
        candidateCosts: Object.fromEntries(outputs.map((o) => [o.candidateId, o.cost])),
        judgeCost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runSynthesis(_synthesizer: CriticRef, messages: ChatMessage[]) {
      return { text: `synth:${messages[1].content.length}`, cost: { tokensIn: 300, tokensOut: 150 } };
    },
    async runHoldout(_task, _profile, _judge, artifacts) {
      const scoresByKey: Record<string, number> = {};
      for (const artifact of artifacts) {
        scoresByKey[artifact.key] = HOLDOUT_SCORES[artifact.key] ?? 3.0;
      }
      return { scoresByKey, cost: { tokensIn: 400, tokensOut: 200 } };
    },
  };
  return { ...base, ...overrides };
}

const RECIPES: FusionRecipeVersion[] = [
  FUSION_RECIPE_BLIND_RAW_V1,
  FUSION_RECIPE_ANALYSIS_FED_V1,
  FUSION_RECIPE_ANALYSIS_SCORES_V1,
];

function makeStudy(): FusionStudy {
  return {
    id: "study-1",
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:abc" },
    poolRef: { id: "pool-1", version: 1 },
    judge1,
    judge2,
    recipeRefs: RECIPES.map((r) => ({ id: r.id, version: r.version })),
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

async function setup(executor: FusionPolicyExecutor = makeMockExecutor()) {
  const repo = new InMemoryFusionStudyRepository();
  await repo.createPoolManifest(POOL);
  const study = makeStudy();
  await repo.createStudy(study);
  let counter = 0;
  let clock = 1000;
  const controller = createFusionStudyController({
    repo,
    generateId: () => `id-${++counter}`,
    now: () => ++clock,
  });
  const deps: StageDriverDeps = { controller, executor, repo };
  return { repo, study, controller, deps };
}

const stratified = [
  { slots: [POOL_SLOTS[1], POOL_SLOTS[2]] as [ModelSlot, ModelSlot], stratum: "high" as const },
  { slots: [POOL_SLOTS[0], POOL_SLOTS[3]] as [ModelSlot, ModelSlot], stratum: "median" as const },
  { slots: [POOL_SLOTS[3], POOL_SLOTS[4]] as [ModelSlot, ModelSlot], stratum: "control" as const },
];

describe("Fusion Study end-to-end (mock providers)", () => {
  it("Stage A stratifies, eliminates the dominated family, and emits exactly two survivors", async () => {
    const { study, deps } = await setup();
    const result = await runStageA(deps, {
      study,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      recipes: RECIPES,
      stratifiedPairs: stratified,
      tasksPerPair: 2,
    });
    expect(result.pairs).toHaveLength(3);
    expect(result.pairs.map((p) => p.stratum)).toEqual(["high", "median", "control"]);
    expect(result.survivors).toHaveLength(2);
    expect(result.survivors).toContain("AnalysisScores");
    // BlindRaw (3.5) is dominated by AnalysisFed (4.2) on every stratified pair.
    expect(result.eliminated.some((e) => e.family === "BlindRaw" && e.reason.includes("Dominated"))).toBe(true);
  });

  it("Stage A seals fuse + refine trials per task with shared blocked lineage", async () => {
    const { study, deps, repo } = await setup();
    await runStageA(deps, {
      study,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      recipes: RECIPES,
      stratifiedPairs: stratified.slice(0, 1),
      tasksPerPair: 1,
    });
    const trials = await repo.listTrials("study-1");
    expect(trials).toHaveLength(4); // 3 recipes + 1 refine control
    expect(trials.every((t) => t.status === "sealed")).toBe(true);
    const runIds = new Set(trials.map((t) => t.children.candidateRunId));
    const judgeIds = new Set(trials.map((t) => t.children.devJudgeRunId));
    // Spec test 7: policies for one task share identical artifact references.
    expect(runIds.size).toBe(1);
    expect(judgeIds.size).toBe(1);
    expect(trials.every((t) => t.observationIds.length === 1)).toBe(true);
    expect(trials.every((t) => t.cost.policy.tokensIn > 0)).toBe(true);
  });

  it("Stage B screens all pairs (losers included), shortlists by the predeclared rule, freezes a recipe, and compares policies", async () => {
    const { study, deps } = await setup();
    const result = await runStageB(deps, {
      study,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      survivingRecipes: [FUSION_RECIPE_ANALYSIS_SCORES_V1, FUSION_RECIPE_ANALYSIS_FED_V1],
      shortlistRule: {
        description: "H_synth ≥ 0.15 or H_select ≥ 0.25; top 5 by max headroom",
        maxPairs: 5,
        minSynthesisHeadroom: 0.15,
        minSelectionHeadroom: 0.25,
      },
      sequentialPairs: 2,
      tasksPerPair: 2,
      mpid: 0.2,
    });

    // All C(6,2) = 15 pairs are reported — winner's-curse transparency.
    expect(result.screenedPairs).toHaveLength(15);
    // B+C leads (H_synth = 1); B and C also open 0.5 headroom with the 4/4
    // models, so the top-5 rule admits B+C plus four B/C pairs.
    expect(result.shortlist[0]).toEqual(["openrouter:m-b", "openrouter:m-c"]);
    expect(result.shortlist).toHaveLength(5);
    const bc = result.screenedPairs.find(
      (r) => r.pair[0] === "openrouter:m-b" && r.pair[1] === "openrouter:m-c",
    )!;
    expect(bc.shortlisted).toBe(true);
    expect(bc.synthesisHeadroom).toBeCloseTo(1, 6);
    expect(result.screenedPairs.filter((r) => r.shortlisted)).toHaveLength(5);

    // Sequential elimination: AnalysisScores beats AnalysisFed → frozen.
    expect(result.frozenRecipe).toBe("AnalysisScores");
    expect(result.recipeEliminationLog.some((e) => e.dropped === "AnalysisFed")).toBe(true);
    expect(result.shortlistRule).toContain("H_synth");

    // Policy results: fuse > refine > rank > best_fixed.
    const byPolicy = new Map(result.policyResults.map((r) => [r.policy, r]));
    expect(byPolicy.get("fuse")!.meanScore).toBeCloseTo(4.5, 6);
    expect(byPolicy.get("refine")!.meanScore).toBeCloseTo(4.4, 6);
    expect(byPolicy.get("rank")!.meanScore).toBeCloseTo(4.0, 6);
    expect(byPolicy.get("best_fixed")!.meanScore).toBeCloseTo(3.8, 6);
    expect(byPolicy.get("fuse")!.costMultiplier).toBeGreaterThan(
      byPolicy.get("best_fixed")!.costMultiplier,
    );

    // MPID verdicts: fuse clears rank (+0.5) but not refine (+0.1).
    const fuseVsRank = result.comparisons.find((c) => c.p === "fuse" && c.q === "rank")!;
    const fuseVsRefine = result.comparisons.find((c) => c.p === "fuse" && c.q === "refine")!;
    expect(fuseVsRank.verdict).toBe("adopt");
    expect(fuseVsRefine.verdict).toBe("not_justified");
  });

  it("Stage C spot check does not flag a stable ranking, and flags an overturned one as recipe-sensitive", async () => {
    const { study, deps } = await setup();
    const stable = await runStageC(deps, {
      study,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      frozenRecipe: FUSION_RECIPE_ANALYSIS_SCORES_V1,
      runnerUpRecipe: FUSION_RECIPE_ANALYSIS_FED_V1,
      topPairs: [{ pair: ["openrouter:m-b", "openrouter:m-c"], frozenMean: 4.5 }],
      alternateSynthesizer: null,
      tasksPerPair: 2,
    });
    expect(stable.spotChecks[0].overturned).toBe(false);
    expect(stable.spotChecks[0].recipeSensitive).toBe(false);

    // Runner-up wins → the Stage B ranking is recipe-sensitive (spec test 8).
    const { deps: deps2, study: study2 } = await setup(
      makeMockExecutor({
        async runHoldout(_t, _p, _j, artifacts) {
          return {
            scoresByKey: Object.fromEntries(artifacts.map((a) => [a.key, 4.9])),
            cost: { tokensIn: 400, tokensOut: 200 },
          };
        },
      }),
    );
    const flagged = await runStageC(deps2, {
      study: study2,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      frozenRecipe: FUSION_RECIPE_ANALYSIS_SCORES_V1,
      runnerUpRecipe: FUSION_RECIPE_ANALYSIS_FED_V1,
      topPairs: [{ pair: ["openrouter:m-b", "openrouter:m-c"], frozenMean: 4.5 }],
      alternateSynthesizer: null,
      tasksPerPair: 2,
    });
    expect(flagged.spotChecks[0].overturned).toBe(true);
    expect(flagged.spotChecks[0].recipeSensitive).toBe(true);
  });

  it("pool adequacy probe fires on a redundant pool and confirms via challengers", async () => {
    // Genuinely redundant pool: all models 4/4 → zero headroom everywhere,
    // best mean 4.0 meaningfully below the 5.0 ceiling → probe triggers.
    const uniformSlots = [slot(11, "u-1"), slot(12, "u-2"), slot(13, "u-3"), slot(14, "u-4"), slot(15, "u-5"), slot(16, "u-6")];
    const uniformPool: PoolManifestVersion = { ...POOL, id: "pool-uniform", core: uniformSlots };
    const probeSetup = await setup();
    await probeSetup.repo.createPoolManifest(uniformPool);
    const uniformStudy: FusionStudy = {
      ...makeStudy(),
      id: "study-uniform",
      poolRef: { id: uniformPool.id, version: uniformPool.version },
    };
    await probeSetup.repo.createStudy(uniformStudy);
    const result = await runStageB(probeSetup.deps, {
      study: uniformStudy,
      suite: SUITE,
      pool: uniformPool,
      profile: PROFILE,
      survivingRecipes: [FUSION_RECIPE_ANALYSIS_SCORES_V1, FUSION_RECIPE_ANALYSIS_FED_V1],
      shortlistRule: { description: "none pass", maxPairs: 5, minSynthesisHeadroom: 0.99, minSelectionHeadroom: 0.99 },
      sequentialPairs: 0,
      tasksPerPair: 1,
      mpid: 0.2,
      outsideChallengers: [slot(9, "m-x")], // identical strengths → also fails
    });
    expect(result.poolAdequacy.probed).toBe(true);
    expect(result.poolAdequacy.outcome).toBe("confirmed");
    expect(result.poolAdequacy.challengerKeys).toEqual(["openrouter:m-x"]);
  });

  it("builds the playbook with all four policies, an exploratory badge, and an honest recommendation", async () => {
    const { study, deps } = await setup();
    const stageB = await runStageB(deps, {
      study,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      survivingRecipes: [FUSION_RECIPE_ANALYSIS_SCORES_V1, FUSION_RECIPE_ANALYSIS_FED_V1],
      shortlistRule: { description: "rule", maxPairs: 5, minSynthesisHeadroom: 0.15, minSelectionHeadroom: 0.25 },
      sequentialPairs: 2,
      tasksPerPair: 2,
      mpid: 0.2,
    });
    const playbook = buildPlaybook({
      study,
      policyResults: stageB.policyResults,
      comparisons: stageB.comparisons,
      poolAdequacy: stageB.poolAdequacy,
      stageC: null,
    });
    expect(playbook.rows.map((r) => r.policy).sort()).toEqual(["best_fixed", "fuse", "rank", "refine"]);
    expect(playbook.claimLevel).toBe("exploratory");
    // Fuse fails the refine bar (+0.1 < MPID) → recommendation falls to the
    // highest-scoring baseline that clears best-fixed: refine (4.4 > 4.0).
    expect(playbook.recommendation.kind).toBe("adopt");
    if (playbook.recommendation.kind === "adopt") {
      expect(playbook.recommendation.policy).toBe("refine");
    }
    expect(playbook.conclusion).toContain("do not use fusion for routine runs");
    expect(playbook.conclusion).toContain("Status: exploratory");
  });

  it("returns do_not_fuse as a first-class verdict when nothing clears the MPID", async () => {
    const flatExecutor = makeMockExecutor({
      async runHoldout(_t, _p, _j, artifacts) {
        return {
          scoresByKey: Object.fromEntries(artifacts.map((a) => [a.key, 4.0])),
          cost: { tokensIn: 400, tokensOut: 200 },
        };
      },
    });
    const { study, deps } = await setup(flatExecutor);
    const stageB = await runStageB(deps, {
      study,
      suite: SUITE,
      pool: POOL,
      profile: PROFILE,
      survivingRecipes: [FUSION_RECIPE_ANALYSIS_SCORES_V1, FUSION_RECIPE_ANALYSIS_FED_V1],
      shortlistRule: { description: "rule", maxPairs: 5, minSynthesisHeadroom: 0.15, minSelectionHeadroom: 0.25 },
      sequentialPairs: 0,
      tasksPerPair: 2,
      mpid: 0.2,
    });
    const playbook = buildPlaybook({
      study,
      policyResults: stageB.policyResults,
      comparisons: stageB.comparisons,
      poolAdequacy: stageB.poolAdequacy,
      stageC: null,
    });
    expect(playbook.recommendation.kind).toBe("do_not_fuse");
    expect(playbook.conclusion).toContain("do not use fusion");
  });
});
