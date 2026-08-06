// =============================================================================
// RSemble AI — Confirmation lifecycle tests (spec test 11)
//
// An exploratory recommendation can be promoted to confirmed ONLY by a
// follow-up study on a new suite version with fresh tasks, evaluating the
// preselected configuration without re-selection.
// =============================================================================

import { describe, expect, it } from "vitest";
import { InMemoryFusionStudyRepository } from "../persistence/fusion-study-repository";
import type { ModelSlot } from "../../studio-data";
import type { CriticRef } from "../providers/types";
import type { EvaluationSuite, EvaluationTask } from "./evaluation-types";
import type { FusionPlaybook, FusionStudy, PoolManifestVersion } from "./fusion-study-types";
import { FUSION_RECIPE_ANALYSIS_FED_V1, FUSION_RECIPE_ANALYSIS_SCORES_V1 } from "./fusion-recipes";
import { createFusionStudyController, type FusionPolicyExecutor } from "./fusion-study-controller";
import { runConfirmationStudy } from "./fusion-confirmation";
import type { StageDriverDeps } from "./fusion-study-stages";

const judge1: CriticRef = { providerId: "openrouter", model: "acme/judge-1" };
const judge2: CriticRef = { providerId: "gemini", model: "acme/judge-2" };

function slot(n: number, slug: string): ModelSlot {
  return {
    id: `s${n}`,
    providerId: "openrouter",
    provider: "Test",
    model: slug,
    slug,
    enabled: true,
  };
}

const POOL_SLOTS = [
  slot(1, "m-a"),
  slot(2, "m-b"),
  slot(3, "m-c"),
  slot(4, "m-d"),
  slot(5, "m-e"),
  slot(6, "m-f"),
];

const POOL: PoolManifestVersion = {
  id: "pool-1",
  version: 1,
  core: POOL_SLOTS,
  challengers: [],
  diversityChecklist: ["families"],
  rationale: "test",
  supersedesVersion: null,
  createdAt: 1000,
};

function taskOf(id: string): EvaluationTask {
  return {
    id,
    title: id,
    prompt: `Prompt ${id}`,
    systemPrompt: "",
    evaluation: { kind: "inherit" },
    judgeInstructionOverride: "",
    order: 0,
  };
}

function suiteOf(version: number, taskPrefix: string): EvaluationSuite {
  return {
    id: "suite-1",
    revision: 0,
    version,
    name: "Suite",
    description: "",
    tasks: [taskOf(`${taskPrefix}-1`), taskOf(`${taskPrefix}-2`)],
    modelSlots: POOL_SLOTS,
    defaultJudge: judge1,
    defaultEvaluation: { kind: "holistic" },
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeStudy(overrides: Partial<FusionStudy>): FusionStudy {
  return {
    id: "study-x",
    revision: 0,
    kind: "exploration",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:v4" },
    poolRef: { id: "pool-1", version: 1 },
    judge1,
    judge2,
    recipeRefs: [
      { id: FUSION_RECIPE_ANALYSIS_SCORES_V1.id, version: 1 },
      { id: FUSION_RECIPE_ANALYSIS_FED_V1.id, version: 1 },
    ],
    stageResults: { stageA: null, stageB: null, stageC: null },
    playbookRef: null,
    claimLevel: "exploratory",
    confirmationOf: null,
    status: "in_progress",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function sourceStudy(): FusionStudy {
  return makeStudy({
    id: "study-source",
    status: "completed",
    playbookRef: "pb-source",
    stageResults: {
      stageA: null,
      stageB: {
        screenedPairs: [],
        shortlistRule: "rule",
        shortlist: [["openrouter:m-b", "openrouter:m-c"]],
        frozenRecipe: "AnalysisScores",
        recipeEliminationLog: [],
        poolAdequacy: { probed: false, outcome: null, challengerKeys: [], note: "" },
        policyResults: [
          {
            pair: ["openrouter:m-b", "openrouter:m-c"],
            policy: "fuse",
            configuration: "m-b + m-c → AnalysisScores",
            meanScore: 4.5,
            costMultiplier: 3.2,
            perTaskScores: [{ taskId: "t1", score: 4.5 }],
          },
          {
            pair: ["openrouter:m-b", "openrouter:m-c"],
            policy: "best_fixed",
            configuration: "openrouter:m-a",
            meanScore: 4.0,
            costMultiplier: 1,
            perTaskScores: [{ taskId: "t1", score: 4.0 }],
          },
        ],
        comparisons: [],
        completedAt: 1000,
      },
      stageC: null,
    },
  });
}

function sourcePlaybook(): FusionPlaybook {
  return {
    id: "pb-source",
    studyId: "study-source",
    suiteRef: { suiteId: "suite-1", suiteVersion: 4, protocolFingerprint: "sha256:v4" },
    rows: [],
    recommendation: {
      kind: "adopt",
      policy: "fuse",
      configuration: "m-b + m-c → AnalysisScores",
      rationale: "clears MPID vs rank and refine",
    },
    poolAdequacy: { probed: false, outcome: null, challengerKeys: [], note: "" },
    claimLevel: "exploratory",
    conclusion: "Fuse B+C when maximum quality matters. Status: exploratory.",
    createdAt: 1000,
  };
}

/** Mock executor; holdout scores assigned per artifact key. */
function mockExecutor(holdoutScores: Record<string, number>): FusionPolicyExecutor {
  const report = (outputs: Array<{ candidateId: string }>) => ({
    labelMap: outputs.map((o, i) => ({
      label: String.fromCharCode(65 + i),
      candidateId: o.candidateId,
    })),
    evaluationsById: Object.fromEntries(
      outputs.map((o, i) => [
        o.candidateId,
        {
          candidateId: o.candidateId,
          blindLabel: String.fromCharCode(65 + i),
          overallScore: 4,
          position: "p",
          rationale: "r",
          strengths: ["s"],
          deductions: [],
          missedRequirements: [],
          criterionScores: [],
        },
      ]),
    ),
    comparisons: [],
  });
  return {
    async runPoolSweep(task, slots) {
      return {
        taskId: task.id,
        outputs: slots.map((s) => ({
          slot: s,
          modelKey: `${s.providerId}:${s.slug}`,
          candidateId: `cand-${s.id}`,
          text: `out:${s.slug}`,
          cost: { tokensIn: 100, tokensOut: 50 },
        })),
      };
    },
    async judgePool(_t, _p, _j, outputs) {
      return {
        report: report(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        cost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runBlockedEvidence(task, _p, pair, _j) {
      const outputs = pair.map((s) => ({
        slot: s,
        modelKey: `${s.providerId}:${s.slug}`,
        candidateId: `cand-${s.id}`,
        text: `out:${s.slug}`,
        cost: { tokensIn: 100, tokensOut: 50 },
      }));
      return {
        blindCandidates: outputs.map((o, i) => ({
          label: String.fromCharCode(65 + i),
          candidateId: o.candidateId,
          content: o.text,
        })),
        report: report(outputs),
        consensus: { consensus: [], contradictions: [], uniqueInsights: [] },
        candidateAttemptIdsByCandidateId: Object.fromEntries(
          outputs.map((o) => [o.candidateId, `catt-${o.slot.id}`]),
        ),
        judgeAttemptId: `jatt-${task.id}`,
        candidateRunId: `run-cand-${task.id}`,
        devJudgeRunId: `run-judge-${task.id}`,
        candidateCosts: Object.fromEntries(outputs.map((o) => [o.candidateId, o.cost])),
        judgeCost: { tokensIn: 200, tokensOut: 100 },
      };
    },
    async runSynthesis(_s, messages) {
      return {
        text: `synth:${messages[1].content.length}`,
        cost: { tokensIn: 300, tokensOut: 150 },
      };
    },
    async runHoldout(_t, _p, _j, artifacts) {
      return {
        scoresByKey: Object.fromEntries(artifacts.map((a) => [a.key, holdoutScores[a.key] ?? 3.0])),
        cost: { tokensIn: 400, tokensOut: 200 },
      };
    },
  };
}

async function setup(scores: Record<string, number>) {
  const repo = new InMemoryFusionStudyRepository();
  await repo.createPoolManifest(POOL);
  await repo.createRecipe(FUSION_RECIPE_ANALYSIS_SCORES_V1);
  await repo.createRecipe(FUSION_RECIPE_ANALYSIS_FED_V1);
  await repo.createStudy(sourceStudy());
  await repo.createPlaybook(sourcePlaybook());
  const controller = createFusionStudyController({ repo });
  const deps: StageDriverDeps = { controller, executor: mockExecutor(scores), repo };
  return { repo, controller, deps };
}

function confirmationStudy(id = "study-confirm"): FusionStudy {
  return makeStudy({
    id,
    kind: "confirmation",
    confirmationOf: "study-source",
    suiteRef: { suiteId: "suite-1", suiteVersion: 5, protocolFingerprint: "sha256:v5-fresh" },
    status: "in_progress",
  });
}

const WINNING = { "fuse:AnalysisScores": 4.6, refine: 4.0, rank: 4.0, best_fixed: 3.8 };
const FLOP = { "fuse:AnalysisScores": 3.9, refine: 4.4, rank: 4.3, best_fixed: 3.8 };

describe("confirmation lifecycle (spec test 11)", () => {
  it("promotes exploratory → confirmed when the preselected config holds on fresh tasks", async () => {
    const { repo, deps } = await setup(WINNING);
    await repo.createStudy(confirmationStudy());
    const outcome = await runConfirmationStudy(deps, {
      sourceStudyId: "study-source",
      confirmationStudyId: "study-confirm",
      suite: suiteOf(5, "fresh"),
      profile: null,
      tasksPerPair: 2,
      mpid: 0.2,
    });
    expect(outcome.promoted).toBe(true);
    expect(outcome.playbook.claimLevel).toBe("confirmed");

    const confirmation = await repo.getStudy("study-confirm");
    expect(confirmation?.claimLevel).toBe("confirmed");
    expect(confirmation?.status).toBe("completed");
    // The source recommendation is visibly promoted.
    const source = await repo.getStudy("study-source");
    expect(source?.claimLevel).toBe("confirmed");
  });

  it("evaluates ONLY the preselected pair — no re-selection on the new data", async () => {
    const { repo, deps } = await setup(WINNING);
    await repo.createStudy(confirmationStudy());
    await runConfirmationStudy(deps, {
      sourceStudyId: "study-source",
      confirmationStudyId: "study-confirm",
      suite: suiteOf(5, "fresh"),
      profile: null,
      tasksPerPair: 2,
      mpid: 0.2,
    });
    const confirmation = await repo.getStudy("study-confirm");
    // No screening ever happened: no Stage A, no screened-pair table.
    expect(confirmation?.stageResults.stageA).toBeNull();
    expect(confirmation?.stageResults.stageB).toBeNull();
    // Every trial targets the preselected pair (B, C) — even though the fresh
    // sweep data might favor a different pair.
    const trials = await repo.listTrials("study-confirm");
    expect(trials.length).toBeGreaterThan(0);
    for (const trial of trials) {
      const keys = trial.candidateConfig.slots.map((s) => `${s.providerId}:${s.slug}`);
      // Pair trials use only the preselected pair; the best-fixed baseline is
      // the source's frozen model, not a fresh-data re-derivation.
      expect(
        keys.every((k) => ["openrouter:m-b", "openrouter:m-c", "openrouter:m-a"].includes(k)),
      ).toBe(true);
      // The frozen recipe is the source's, not a re-picked one.
      if (trial.policy === "fuse") {
        expect(trial.recipe).toEqual({ id: "builtin-analysis-scores", version: 1 });
      }
    }
  });

  it("demotes (stays exploratory) when the preselected config flops on fresh tasks", async () => {
    const { repo, deps } = await setup(FLOP);
    await repo.createStudy(confirmationStudy());
    const outcome = await runConfirmationStudy(deps, {
      sourceStudyId: "study-source",
      confirmationStudyId: "study-confirm",
      suite: suiteOf(5, "fresh"),
      profile: null,
      tasksPerPair: 2,
      mpid: 0.2,
    });
    expect(outcome.promoted).toBe(false);
    expect(outcome.playbook.claimLevel).toBe("exploratory");
    expect((await repo.getStudy("study-source"))?.claimLevel).toBe("exploratory");
  });

  it("rejects promotion without confirmation lineage or on the same snapshot", async () => {
    const { repo, deps } = await setup(WINNING);

    // An exploration study cannot self-confirm.
    await repo.createStudy(
      makeStudy({
        id: "study-self",
        suiteRef: { suiteId: "suite-1", suiteVersion: 5, protocolFingerprint: "sha256:v5-fresh" },
      }),
    );
    await expect(
      runConfirmationStudy(deps, {
        sourceStudyId: "study-source",
        confirmationStudyId: "study-self",
        suite: suiteOf(5, "fresh"),
        profile: null,
        tasksPerPair: 2,
        mpid: 0.2,
      }),
    ).rejects.toThrow(/cannot self-confirm/);

    // Same suite snapshot = re-selection data, not confirmation.
    await repo.createStudy(
      makeStudy({
        id: "study-same",
        kind: "confirmation",
        confirmationOf: "study-source",
      }),
    );
    await expect(
      runConfirmationStudy(deps, {
        sourceStudyId: "study-source",
        confirmationStudyId: "study-same",
        suite: suiteOf(4, "old"),
        profile: null,
        tasksPerPair: 2,
        mpid: 0.2,
      }),
    ).rejects.toThrow(/NEW suite version/);
  });
});
