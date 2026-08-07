// =============================================================================
// RSemble AI — Fusion Study stage drivers (spec §7)
//
// Stage A — recipe elimination over stratified pairs. Families are compared
//   against each other and the refine-the-winner control; dominated or
//   control-matched families are ELIMINATED, exactly two survive.
// Stage B — pool sweep → headroom for all pairs → predeclared shortlist →
//   both surviving recipes on the first 2–3 pairs (sequential elimination) →
//   blocked holdout evaluation vs the three baselines (best-fixed, Rank,
//   Refine) with MPID comparisons.
// Stage C — runner-up recipe spot check (flags recipe-sensitive rankings) and
//   a recipe × synthesizer cross for the top pair.
//
// Drivers orchestrate the controller (trials/observations/cost/seals) and the
// injected FusionPolicyExecutor (provider calls). All policy outputs for one
// task share one blocked evidence run; holdout evaluation is blind.
// =============================================================================

import type { CriticRef } from "../providers/types";
import type { Attachment } from "../attachments/types";
import type { ModelSlot } from "../../studio-data";
import type {
  EvaluationProfileSnapshot,
  EvaluationTask,
  EvaluationSuite,
} from "./evaluation-types";
import type {
  FusionPolicyKind,
  FusionRecipeFamily,
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
  PoolAdequacyOutcome,
  PoolManifestVersion,
  ScreenedPairRow,
  StageAResult,
  StageAPairResult,
  StageBComparison,
  StageBPolicyResult,
  StageBResult,
  StageCResult,
  FusionPairStratum,
} from "./fusion-study-types";
import {
  computeHeadroom,
  probePoolAdequacy,
  assessChallengerOutcome,
  modelTaskScoreFromReport,
  taskOverall,
  type CriterionWeights,
  type ModelTaskScore,
  type PairedTaskScores,
} from "./complementarity";
import { pairedDeltaComparison } from "./study-stats";
import { hashArtifactContent } from "./protocol-fingerprint";
import { renderRecipeMessages, renderRefineWinnerMessages } from "./fusion-recipes";
import { deriveRankWinner } from "./policy-runner";
import type { FusionStudyRepository } from "../persistence/fusion-study-repository";
import {
  type BlockedRunResult,
  type FusionPolicyExecutor,
  type FusionStudyController,
  type HoldoutArtifact,
  type TokenCost,
} from "./fusion-study-controller";

export interface StageDriverDeps {
  controller: FusionStudyController;
  executor: FusionPolicyExecutor;
  repo: FusionStudyRepository;
}

function modelKeyOf(slot: ModelSlot): string {
  return `${slot.providerId}:${slot.slug}`;
}

function activePoolSlots(pool: PoolManifestVersion): ModelSlot[] {
  return [...pool.core, ...pool.challengers].filter((s) => s.enabled);
}

function criterionWeights(profile: EvaluationProfileSnapshot | null): CriterionWeights {
  const map = new Map<string, number>();
  for (const c of profile?.criteria ?? []) map.set(c.id, c.weight);
  return map;
}

function sumCosts(costs: TokenCost[]): TokenCost {
  return costs.reduce(
    (acc, c) => ({ tokensIn: acc.tokensIn + c.tokensIn, tokensOut: acc.tokensOut + c.tokensOut }),
    { tokensIn: 0, tokensOut: 0 },
  );
}

function scaleCost(cost: TokenCost, factor: number): TokenCost {
  return { tokensIn: cost.tokensIn * factor, tokensOut: cost.tokensOut * factor };
}

function totalTokens(cost: TokenCost): number {
  return cost.tokensIn + cost.tokensOut;
}

/** Ensure the recipes under test exist in the store (seal-time provenance). */
async function ensureRecipesPersisted(
  repo: FusionStudyRepository,
  recipes: FusionRecipeVersion[],
): Promise<void> {
  for (const recipe of recipes) {
    const existing = await repo.getRecipe(recipe.id, recipe.version);
    if (!existing) await repo.createRecipe(recipe);
  }
}

/**
 * Attribute the trial's full cost in one edge (spec §6.4): shared candidate
 * generation + dev judge (a clean standalone execution of this policy incurs
 * them in full) plus the finishing edges. Holdout retries and failures would
 * roll in separately with countsTowardPolicy=false.
 */
async function writeTrialCost(
  deps: StageDriverDeps,
  trialId: string,
  evidenceCosts: TokenCost[],
  finishCosts: TokenCost[],
): Promise<void> {
  const total = sumCosts([...evidenceCosts, ...finishCosts]);
  await deps.controller.addCostEdge(trialId, { ...total, countsTowardPolicy: true });
}

function evidenceCosts(evidence: BlockedRunResult): TokenCost[] {
  return [...Object.values(evidence.candidateCosts), evidence.judgeCost];
}

async function recordObservation(
  deps: StageDriverDeps,
  trialId: string,
  judge2: CriticRef,
  score: number,
  cost: TokenCost,
): Promise<void> {
  const now = Date.now();
  await deps.controller.addHoldoutObservation(trialId, {
    judge: judge2,
    runId: null,
    status: "completed",
    overallScore: score,
    tokensIn: cost.tokensIn,
    tokensOut: cost.tokensOut,
    error: null,
    startedAt: now,
    finishedAt: now,
  });
}

function artifactFor(
  trialId: string,
  text: string,
  synthesizer: CriticRef | null,
  promptVersion: string | null,
) {
  return {
    runId: `fusion-synth-${trialId}`,
    fusionAttemptId: `fa-${trialId}`,
    contentHash: hashArtifactContent(JSON.stringify({ text, synthesizer, promptVersion })),
  };
}

// =============================================================================
// Stage A — recipe elimination
// =============================================================================

export interface StratifiedPair {
  slots: [ModelSlot, ModelSlot];
  stratum: FusionPairStratum;
}

export interface StageADriverInput {
  study: FusionStudy;
  suite: EvaluationSuite;
  pool: PoolManifestVersion;
  profile: EvaluationProfileSnapshot | null;
  /** All three families under test. */
  recipes: FusionRecipeVersion[];
  stratifiedPairs: StratifiedPair[];
  tasksPerPair: number;
  /** In-memory per-task attachments (never persisted — plan 7.6.7). */
  taskAttachments?: Record<string, Attachment[]>;
}

interface PairTaskOutcome {
  familyScores: Partial<Record<FusionRecipeFamily, number>>;
  refineScore: number;
}

/**
 * Elimination rule (predeclared, recorded verbatim in reasons):
 *  - A family dominated by the same rival on EVERY stratified pair is dropped.
 *  - A family the refine-the-winner control matches or beats on every pair is
 *    dropped — the second model buys no complementary information.
 *  - The top two remaining families by mean holdout score survive. Stage A
 *    eliminates; it never crowns.
 */
export function eliminateFamilies(
  pairs: StageAPairResult[],
  families: FusionRecipeFamily[],
): {
  survivors: FusionRecipeFamily[];
  eliminated: Array<{ family: FusionRecipeFamily; reason: string }>;
} {
  const meanOf = (family: FusionRecipeFamily): number => {
    const scores = pairs
      .map((p) => p.familyScores[family])
      .filter((s): s is number => typeof s === "number");
    return scores.length === 0 ? 0 : scores.reduce((a, v) => a + v, 0) / scores.length;
  };

  const eliminated = new Map<FusionRecipeFamily, string>();
  for (const family of families) {
    const dominator = families.find(
      (rival) =>
        rival !== family &&
        pairs.length > 0 &&
        pairs.every((p) => {
          const a = p.familyScores[rival];
          const b = p.familyScores[family];
          return typeof a === "number" && typeof b === "number" && a > b;
        }),
    );
    if (dominator) {
      eliminated.set(
        family,
        `Dominated by ${dominator} on all ${pairs.length} stratified pairs ` +
          `(mean ${meanOf(family).toFixed(2)} vs ${meanOf(dominator).toFixed(2)}).`,
      );
      continue;
    }
    const refineMatched =
      pairs.length > 0 &&
      pairs.every((p) => {
        const f = p.familyScores[family];
        return typeof f === "number" && p.refineWinnerScore !== null && p.refineWinnerScore >= f;
      });
    if (refineMatched) {
      eliminated.set(
        family,
        "Refine-the-winner control matches or beats this family on every stratified " +
          "pair — the second model buys no complementary information.",
      );
    }
  }

  const byMean = [...families].sort((a, b) => meanOf(b) - meanOf(a));
  const survivors: FusionRecipeFamily[] = [];
  for (const family of byMean) {
    if (survivors.length < 2 && !eliminated.has(family)) survivors.push(family);
  }
  // Guarantee exactly two survivors: backfill from eliminated families by mean.
  for (const family of byMean) {
    if (survivors.length >= 2) break;
    if (!survivors.includes(family)) {
      survivors.push(family);
      eliminated.delete(family);
    }
  }
  return {
    survivors,
    eliminated: [...eliminated.entries()].map(([family, reason]) => ({ family, reason })),
  };
}

export async function runStageA(
  deps: StageDriverDeps,
  input: StageADriverInput,
): Promise<StageAResult> {
  await ensureRecipesPersisted(deps.repo, input.recipes);
  const pairResults: StageAPairResult[] = [];
  const refineFlags = input.recipes[0] ?? null;

  for (const stratified of input.stratifiedPairs) {
    const tasks = input.suite.tasks.slice(0, Math.max(1, input.tasksPerPair));
    const outcomes: PairTaskOutcome[] = [];

    for (const task of tasks) {
      const evidence = await deps.executor.runBlockedEvidence(
        task,
        input.profile,
        stratified.slots,
        input.study.judge1,
      );
      const winner = deriveRankWinner(evidence.blindCandidates, evidence.report);
      const winnerContent =
        evidence.blindCandidates.find((c) => c.candidateId === winner.winnerCandidateId)?.content ??
        "";

      const artifacts: HoldoutArtifact[] = [];
      const synthByFamily = new Map<FusionRecipeFamily, { text: string; cost: TokenCost }>();
      for (const recipe of input.recipes) {
        const messages = renderRecipeMessages(recipe, {
          prompt: task.prompt,
          profile: input.profile,
          blindCandidates: evidence.blindCandidates,
          judgeReport: evidence.report,
          consensus: evidence.consensus,
          attachments: input.taskAttachments?.[task.id] ?? [],
        });
        const synth = await deps.executor.runSynthesis(recipe.synthesizer, messages);
        synthByFamily.set(recipe.recipeFamily, synth);
        artifacts.push({ key: `fuse:${recipe.recipeFamily}`, text: synth.text });
      }

      let refineSynth: { text: string; cost: TokenCost } | null = null;
      if (refineFlags) {
        const refineMessages = renderRefineWinnerMessages({
          prompt: task.prompt,
          profile: input.profile,
          winnerLabel: winner.winnerBlindLabel,
          winnerContent,
          blindCandidates: evidence.blindCandidates,
          rubricAccess: refineFlags.rubricAccess,
          verification: refineFlags.verification,
          attachments: input.taskAttachments?.[task.id] ?? [],
        });
        refineSynth = await deps.executor.runSynthesis(refineFlags.synthesizer, refineMessages);
        artifacts.push({ key: "refine", text: refineSynth.text });
      }

      const holdout = await deps.executor.runHoldout(
        task,
        input.profile,
        input.study.judge2,
        artifacts,
      );
      const share = 1 / artifacts.length;

      for (const recipe of input.recipes) {
        const synth = synthByFamily.get(recipe.recipeFamily)!;
        const trial = await deps.controller.createTrial({
          study: input.study,
          poolRef: { id: input.pool.id, version: input.pool.version },
          candidateConfig: { slots: [...stratified.slots] },
          policy: "fuse",
          recipe: { id: recipe.id, version: recipe.version },
          synthesizer: recipe.synthesizer,
          stage: "A",
          sampleIndex: 0,
        });
        await deps.controller.attachChildren(trial.id, {
          candidateRunId: evidence.candidateRunId,
          devJudgeRunId: evidence.devJudgeRunId,
          synthesisArtifact: artifactFor(
            trial.id,
            synth.text,
            recipe.synthesizer,
            recipe.promptVersion,
          ),
        });
        await writeTrialCost(deps, trial.id, evidenceCosts(evidence), [
          synth.cost,
          scaleCost(holdout.cost, share),
        ]);
        await recordObservation(
          deps,
          trial.id,
          input.study.judge2,
          holdout.scoresByKey[`fuse:${recipe.recipeFamily}`] ?? 0,
          scaleCost(holdout.cost, share),
        );
        await deps.controller.seal(trial.id);
      }

      if (refineFlags && refineSynth) {
        const trial = await deps.controller.createTrial({
          study: input.study,
          poolRef: { id: input.pool.id, version: input.pool.version },
          candidateConfig: { slots: [...stratified.slots] },
          policy: "refine",
          recipe: { id: refineFlags.id, version: refineFlags.version },
          synthesizer: refineFlags.synthesizer,
          stage: "A",
          sampleIndex: 0,
        });
        await deps.controller.attachChildren(trial.id, {
          candidateRunId: evidence.candidateRunId,
          devJudgeRunId: evidence.devJudgeRunId,
          synthesisArtifact: artifactFor(
            trial.id,
            refineSynth.text,
            refineFlags.synthesizer,
            "refine-winner-v1",
          ),
        });
        await writeTrialCost(deps, trial.id, evidenceCosts(evidence), [
          refineSynth.cost,
          scaleCost(holdout.cost, share),
        ]);
        await recordObservation(
          deps,
          trial.id,
          input.study.judge2,
          holdout.scoresByKey["refine"] ?? 0,
          scaleCost(holdout.cost, share),
        );
        await deps.controller.seal(trial.id);
      }

      outcomes.push({
        familyScores: Object.fromEntries(
          input.recipes.map((r) => [
            r.recipeFamily,
            holdout.scoresByKey[`fuse:${r.recipeFamily}`] ?? 0,
          ]),
        ) as Partial<Record<FusionRecipeFamily, number>>,
        refineScore: holdout.scoresByKey["refine"] ?? 0,
      });
    }

    pairResults.push({
      pair: [modelKeyOf(stratified.slots[0]), modelKeyOf(stratified.slots[1])],
      stratum: stratified.stratum,
      familyScores: meanFamilyScores(
        outcomes,
        input.recipes.map((r) => r.recipeFamily),
      ),
      refineWinnerScore:
        outcomes.reduce((a, o) => a + o.refineScore, 0) / Math.max(1, outcomes.length),
    });
  }

  const families = input.recipes.map((r) => r.recipeFamily);
  const { survivors, eliminated } = eliminateFamilies(pairResults, families);
  return { pairs: pairResults, survivors, eliminated, completedAt: Date.now() };
}

function meanFamilyScores(
  outcomes: PairTaskOutcome[],
  families: FusionRecipeFamily[],
): Partial<Record<FusionRecipeFamily, number>> {
  const result: Partial<Record<FusionRecipeFamily, number>> = {};
  for (const family of families) {
    const scores = outcomes
      .map((o) => o.familyScores[family])
      .filter((s): s is number => typeof s === "number");
    if (scores.length > 0) result[family] = scores.reduce((a, v) => a + v, 0) / scores.length;
  }
  return result;
}

// =============================================================================
// Stage B — pair discovery with sequential recipe elimination
// =============================================================================

export interface ShortlistRule {
  /** Verbatim predeclared rule, recorded in the result. */
  description: string;
  maxPairs: number;
  minSynthesisHeadroom: number;
  minSelectionHeadroom: number;
}

export interface StageBDriverInput {
  study: FusionStudy;
  suite: EvaluationSuite;
  pool: PoolManifestVersion;
  profile: EvaluationProfileSnapshot | null;
  survivingRecipes: [FusionRecipeVersion, FusionRecipeVersion];
  shortlistRule: ShortlistRule;
  /** Both survivors run on this many first shortlisted pairs (2–3). */
  sequentialPairs: number;
  tasksPerPair: number;
  mpid: number;
  /** Outside-pool challengers for the adequacy probe (spec §5.6). */
  outsideChallengers?: ModelSlot[];
  rng?: () => number;
  /** In-memory per-task attachments (never persisted — plan 7.6.7). */
  taskAttachments?: Record<string, Attachment[]>;
}

export async function runStageB(
  deps: StageDriverDeps,
  input: StageBDriverInput,
): Promise<StageBResult> {
  await ensureRecipesPersisted(deps.repo, input.survivingRecipes);
  const weights = criterionWeights(input.profile);
  const poolSlots = activePoolSlots(input.pool);
  const tasks = input.suite.tasks;

  // 1–2. Pool sweep + dev-judge scoring per task (screening evidence).
  const scoresByTask = new Map<string, Map<string, ModelTaskScore>>();
  const textByTask = new Map<string, Map<string, string>>();
  for (const task of tasks) {
    const sweep = await deps.executor.runPoolSweep(task, poolSlots);
    const judged = await deps.executor.judgePool(
      task,
      input.profile,
      input.study.judge1,
      sweep.outputs,
    );
    const modelScores = new Map<string, ModelTaskScore>();
    const modelTexts = new Map<string, string>();
    for (const output of sweep.outputs) {
      const score = modelTaskScoreFromReport(judged.report, output.candidateId);
      if (score) modelScores.set(output.modelKey, score);
      modelTexts.set(output.modelKey, output.text);
    }
    scoresByTask.set(task.id, modelScores);
    textByTask.set(task.id, modelTexts);
  }

  // Headroom for all pairs (the full screened-pair table — losers included).
  const modelKeys = poolSlots.map(modelKeyOf);
  const screenedPairs: ScreenedPairRow[] = [];
  for (let i = 0; i < modelKeys.length; i++) {
    for (let j = i + 1; j < modelKeys.length; j++) {
      const pair: [string, string] = [modelKeys[i], modelKeys[j]];
      const paired: PairedTaskScores[] = [];
      for (const task of tasks) {
        const scores = scoresByTask.get(task.id)!;
        const a = scores.get(pair[0]);
        const b = scores.get(pair[1]);
        if (a && b) paired.push({ taskId: task.id, a, b });
      }
      const metrics = computeHeadroom(paired, weights);
      screenedPairs.push({
        pair,
        selectionHeadroom: metrics.selectionHeadroom,
        synthesisHeadroom: metrics.synthesisHeadroom ?? 0,
        perCriterionHeadroom: metrics.perCriterion,
        // Fuse over a pair ≈ 2 generations + judge + synthesizer vs 1 generation.
        costMultiplier: 4,
        shortlisted: false,
      });
    }
  }

  // 3. Predeclared shortlist rule.
  const rule = input.shortlistRule;
  const ranked = [...screenedPairs].sort(
    (x, y) =>
      Math.max(y.synthesisHeadroom, y.selectionHeadroom) -
      Math.max(x.synthesisHeadroom, x.selectionHeadroom),
  );
  const eligible = ranked.filter(
    (r) =>
      r.synthesisHeadroom >= rule.minSynthesisHeadroom ||
      r.selectionHeadroom >= rule.minSelectionHeadroom,
  );
  const shortlist = eligible.slice(0, rule.maxPairs).map((r) => r.pair);
  const shortlistSet = new Set(shortlist.map((p) => p.join("|")));
  for (const row of screenedPairs) row.shortlisted = shortlistSet.has(row.pair.join("|"));

  // 4. Pool adequacy probe (spec §5.6).
  const poolAdequacy = await runPoolAdequacyProbe(
    deps,
    input,
    tasks,
    scoresByTask,
    screenedPairs,
    modelKeys,
    weights,
  );

  // 5. Sequential recipe elimination on the first shortlisted pairs, then
  //    blocked holdout evaluation vs the three baselines on all of them.
  const bestFixedKey = bestFixedModelKey(tasks, scoresByTask, weights, modelKeys);
  const sequential = shortlist.slice(
    0,
    Math.max(0, Math.min(input.sequentialPairs, shortlist.length)),
  );
  const remaining = shortlist.slice(sequential.length);

  const familyMeans = new Map<FusionRecipeFamily, number[]>();
  for (const recipe of input.survivingRecipes) familyMeans.set(recipe.recipeFamily, []);
  const policyResults: StageBPolicyResult[] = [];
  const comparisons: StageBComparison[] = [];
  const recipeEliminationLog: StageBResult["recipeEliminationLog"] = [];

  for (const pair of sequential) {
    const outcome = await evaluatePairBlocked(deps, input, pair, {
      recipes: [...input.survivingRecipes],
      bestFixedKey,
      tasks: tasks.slice(0, input.tasksPerPair),
    });
    policyResults.push(...outcome.policyResults);
    comparisons.push(...outcome.comparisons);
    for (const recipe of input.survivingRecipes) {
      familyMeans.get(recipe.recipeFamily)!.push(outcome.familyMeans.get(recipe.recipeFamily)!);
    }
  }

  // Sequential elimination: drop a survivor that loses on EVERY sequential pair.
  let activeRecipes: FusionRecipeVersion[] = [...input.survivingRecipes];
  let frozenRecipe: FusionRecipeFamily | null = null;
  if (input.survivingRecipes.length === 2 && sequential.length > 0) {
    const [x, y] = input.survivingRecipes;
    const xWins = sequential.every(
      (_, idx) => familyMeans.get(x.recipeFamily)![idx] > familyMeans.get(y.recipeFamily)![idx],
    );
    const yWins = sequential.every(
      (_, idx) => familyMeans.get(y.recipeFamily)![idx] > familyMeans.get(x.recipeFamily)![idx],
    );
    if (xWins || yWins) {
      const dropped = xWins ? y : x;
      const kept = xWins ? x : y;
      recipeEliminationLog.push({
        pairs: [...sequential],
        dropped: dropped.recipeFamily,
        reason:
          `${kept.recipeFamily} outscored ${dropped.recipeFamily} on all ${sequential.length} ` +
          `sequentially evaluated pairs — ${dropped.recipeFamily} dropped, ${kept.recipeFamily} frozen.`,
      });
      activeRecipes = [kept];
      frozenRecipe = kept.recipeFamily;
    }
  }

  for (const pair of remaining) {
    const outcome = await evaluatePairBlocked(deps, input, pair, {
      recipes: activeRecipes,
      bestFixedKey,
      tasks: tasks.slice(0, input.tasksPerPair),
    });
    policyResults.push(...outcome.policyResults);
    comparisons.push(...outcome.comparisons);
  }

  return {
    screenedPairs,
    shortlistRule: rule.description,
    shortlist,
    frozenRecipe,
    recipeEliminationLog,
    poolAdequacy,
    policyResults,
    comparisons,
    completedAt: Date.now(),
  };
}

export function bestFixedModelKey(
  tasks: EvaluationTask[],
  scoresByTask: Map<string, Map<string, ModelTaskScore>>,
  weights: CriterionWeights,
  modelKeys: string[],
): string {
  let best = modelKeys[0];
  let bestMean = Number.NEGATIVE_INFINITY;
  for (const key of modelKeys) {
    const overalls = tasks
      .map((t) => scoresByTask.get(t.id)?.get(key))
      .filter((s): s is ModelTaskScore => s !== undefined)
      .map((s) => taskOverall(s, weights))
      .filter((v): v is number => v !== null);
    const mean = overalls.length === 0 ? 0 : overalls.reduce((a, v) => a + v, 0) / overalls.length;
    if (mean > bestMean) {
      bestMean = mean;
      best = key;
    }
  }
  return best;
}

async function runPoolAdequacyProbe(
  deps: StageDriverDeps,
  input: StageBDriverInput,
  tasks: EvaluationTask[],
  scoresByTask: Map<string, Map<string, ModelTaskScore>>,
  screenedPairs: ScreenedPairRow[],
  modelKeys: string[],
  weights: CriterionWeights,
): Promise<PoolAdequacyOutcome> {
  // Pool-level oracle: E_t[max_m S_m,t] − max_m E[S_m,t].
  const meansByModel = new Map<string, number>();
  for (const key of modelKeys) {
    const overalls = tasks
      .map((t) => scoresByTask.get(t.id)?.get(key))
      .filter((s): s is ModelTaskScore => s !== undefined)
      .map((s) => taskOverall(s, weights))
      .filter((v): v is number => v !== null);
    meansByModel.set(
      key,
      overalls.length === 0 ? 0 : overalls.reduce((a, v) => a + v, 0) / overalls.length,
    );
  }
  const taskMaxes = tasks.map((t) => {
    const scores = modelKeys
      .map((k) => scoresByTask.get(t.id)?.get(k))
      .filter((s): s is ModelTaskScore => s !== undefined)
      .map((s) => taskOverall(s, weights))
      .filter((v): v is number => v !== null);
    return scores.length === 0 ? 0 : Math.max(...scores);
  });
  const oracle =
    (taskMaxes.length === 0 ? 0 : taskMaxes.reduce((a, v) => a + v, 0) / taskMaxes.length) -
    Math.max(...meansByModel.values());
  const bestModelMean = Math.max(...meansByModel.values());
  const maxPairHeadroom = screenedPairs.reduce(
    (acc, row) => Math.max(acc, row.selectionHeadroom, row.synthesisHeadroom),
    0,
  );

  const probe = probePoolAdequacy({
    bestModelMean,
    ceiling: 5,
    poolOracleHeadroom: Math.max(0, oracle),
    maxPairHeadroom,
  });
  if (!probe.triggerChallengers) {
    return { probed: false, outcome: null, challengerKeys: [], note: "Probe conditions not met." };
  }

  const challengers = (input.outsideChallengers ?? []).filter((s) => s.enabled);
  if (challengers.length === 0) {
    return {
      probed: true,
      outcome: null,
      challengerKeys: [],
      note: `Probe triggered (${probe.reasons.join(" ")}) but no outside-pool challengers are configured.`,
    };
  }

  // Run outside-pool challengers and measure headroom against the pool.
  const challengerKeys: string[] = [];
  const outcomeInputs: Array<{ modelKey: string; maxPairHeadroomWithPool: number }> = [];
  for (const challenger of challengers) {
    const key = modelKeyOf(challenger);
    challengerKeys.push(key);
    const challengerScores = new Map<string, ModelTaskScore>();
    for (const task of tasks) {
      const sweep = await deps.executor.runPoolSweep(task, [challenger]);
      const judged = await deps.executor.judgePool(
        task,
        input.profile,
        input.study.judge1,
        sweep.outputs,
      );
      const score = modelTaskScoreFromReport(judged.report, sweep.outputs[0]?.candidateId ?? "");
      if (score) challengerScores.set(task.id, score);
    }
    let maxHeadroom = 0;
    for (const poolKey of modelKeys) {
      const paired: PairedTaskScores[] = [];
      for (const task of tasks) {
        const a = challengerScores.get(task.id);
        const b = scoresByTask.get(task.id)?.get(poolKey);
        if (a && b) paired.push({ taskId: task.id, a, b });
      }
      const metrics = computeHeadroom(paired, weights);
      maxHeadroom = Math.max(
        maxHeadroom,
        metrics.selectionHeadroom,
        metrics.synthesisHeadroom ?? 0,
      );
    }
    outcomeInputs.push({ modelKey: key, maxPairHeadroomWithPool: maxHeadroom });
  }

  const outcome = assessChallengerOutcome(outcomeInputs);
  return {
    probed: true,
    outcome,
    challengerKeys,
    note:
      outcome === "confirmed"
        ? "Outside-pool challengers failed on the same instances — the no-fusion conclusion is credible."
        : "An outside-pool challenger opened headroom — the declared pool was inadequate.",
  };
}

// --- Blocked pair evaluation -------------------------------------------------------------

export interface PairEvalOutcome {
  policyResults: StageBPolicyResult[];
  comparisons: StageBComparison[];
  familyMeans: Map<FusionRecipeFamily, number>;
}

/** Minimal input for blocked pair evaluation — shared by Stage B and the
 *  confirmation lifecycle (which evaluates a preselected pair without any
 *  screening or shortlisting). */
export interface PairEvaluationInput {
  study: FusionStudy;
  pool: PoolManifestVersion;
  profile: EvaluationProfileSnapshot | null;
  mpid: number;
  rng?: () => number;
  /** In-memory per-task attachments (never persisted — plan 7.6.7). */
  taskAttachments?: Record<string, Attachment[]>;
}

export async function evaluatePairBlocked(
  deps: StageDriverDeps,
  input: PairEvaluationInput,
  pair: [string, string],
  opts: { recipes: FusionRecipeVersion[]; bestFixedKey: string; tasks: EvaluationTask[] },
): Promise<PairEvalOutcome> {
  const slots = resolvePairSlots(input.pool, pair);
  const bestSlot = resolveSlot(input.pool, opts.bestFixedKey);
  const perTask: Array<{ taskId: string; scores: Record<string, number> }> = [];
  const policyCostTotals: Record<string, number> = {};
  const familyMeans = new Map<FusionRecipeFamily, number>();

  for (const task of opts.tasks) {
    const evidence = await deps.executor.runBlockedEvidence(
      task,
      input.profile,
      slots,
      input.study.judge1,
    );
    const winner = deriveRankWinner(evidence.blindCandidates, evidence.report);
    const winnerContent =
      evidence.blindCandidates.find((c) => c.candidateId === winner.winnerCandidateId)?.content ??
      "";

    // Finishes from the SHARED evidence — only the finishing step varies.
    const artifacts: HoldoutArtifact[] = [{ key: "rank", text: winnerContent }];
    const synths: Array<{
      key: string;
      text: string;
      cost: TokenCost;
      recipe: FusionRecipeVersion | null;
    }> = [];
    for (const recipe of opts.recipes) {
      const messages = renderRecipeMessages(recipe, {
        prompt: task.prompt,
        profile: input.profile,
        blindCandidates: evidence.blindCandidates,
        judgeReport: evidence.report,
        consensus: evidence.consensus,
        attachments: input.taskAttachments?.[task.id] ?? [],
      });
      const synth = await deps.executor.runSynthesis(recipe.synthesizer, messages);
      const key = `fuse:${recipe.recipeFamily}`;
      synths.push({ key, text: synth.text, cost: synth.cost, recipe });
      artifacts.push({ key, text: synth.text });
    }

    const refineRecipe = opts.recipes[0];
    const refineMessages = renderRefineWinnerMessages({
      prompt: task.prompt,
      profile: input.profile,
      winnerLabel: winner.winnerBlindLabel,
      winnerContent,
      blindCandidates: evidence.blindCandidates,
      rubricAccess: refineRecipe.rubricAccess,
      verification: refineRecipe.verification,
      attachments: input.taskAttachments?.[task.id] ?? [],
    });
    const refineSynth = await deps.executor.runSynthesis(refineRecipe.synthesizer, refineMessages);
    synths.push({ key: "refine", text: refineSynth.text, cost: refineSynth.cost, recipe: null });
    artifacts.push({ key: "refine", text: refineSynth.text });

    // Best-fixed baseline: the pool's best single model (its own generation).
    const sweep = await deps.executor.runPoolSweep(task, [bestSlot]);
    const bestFixedText = sweep.outputs[0]?.text ?? "";
    const bestFixedCost = sweep.outputs[0]?.cost ?? { tokensIn: 0, tokensOut: 0 };
    artifacts.push({ key: "best_fixed", text: bestFixedText });

    const holdout = await deps.executor.runHoldout(
      task,
      input.profile,
      input.study.judge2,
      artifacts,
    );
    const share = 1 / artifacts.length;
    const scores: Record<string, number> = {};
    for (const artifact of artifacts) {
      scores[artifact.key] = holdout.scoresByKey[artifact.key] ?? 0;
    }
    perTask.push({ taskId: task.id, scores });

    // Trials: rank, fuse per recipe, refine, best_fixed — all sharing lineage.
    const rankTrial = await finishTrial(deps, input, {
      slots: [...slots],
      policy: "rank",
      recipe: null,
      synthesizer: null,
      stageEvidence: evidence,
      artifactText: winnerContent,
      artifactSynth: null,
      finishCosts: [scaleCost(holdout.cost, share)],
      score: scores["rank"],
    });
    policyCostTotals["rank"] = (policyCostTotals["rank"] ?? 0) + totalTokens(rankTrial.cost.policy);

    for (const synth of synths) {
      const policy: FusionPolicyKind = synth.key === "refine" ? "refine" : "fuse";
      const trial = await finishTrial(deps, input, {
        slots: [...slots],
        policy,
        recipe: synth.recipe ? { id: synth.recipe.id, version: synth.recipe.version } : null,
        synthesizer: synth.recipe?.synthesizer ?? refineRecipe.synthesizer,
        stageEvidence: evidence,
        artifactText: synth.text,
        artifactSynth: {
          synthesizer: synth.recipe?.synthesizer ?? refineRecipe.synthesizer,
          promptVersion: synth.recipe?.promptVersion ?? "refine-winner-v1",
        },
        finishCosts: [synth.cost, scaleCost(holdout.cost, share)],
        score: scores[synth.key],
      });
      policyCostTotals[synth.key] =
        (policyCostTotals[synth.key] ?? 0) + totalTokens(trial.cost.policy);
    }

    const bestTrial = await finishTrial(deps, input, {
      slots: [bestSlot],
      policy: "best_fixed",
      recipe: null,
      synthesizer: null,
      stageEvidence: null,
      artifactText: bestFixedText,
      artifactSynth: null,
      finishCosts: [bestFixedCost, scaleCost(holdout.cost, share)],
      score: scores["best_fixed"],
    });
    policyCostTotals["best_fixed"] =
      (policyCostTotals["best_fixed"] ?? 0) + totalTokens(bestTrial.cost.policy);
  }

  // Aggregate per policy.
  const bestFixedTotal = Math.max(1, policyCostTotals["best_fixed"] ?? 1);
  const fuseKeys = opts.recipes.map((r) => `fuse:${r.recipeFamily}`);
  const policyDefs: Array<{ key: string; policy: FusionPolicyKind; configuration: string }> = [
    { key: "best_fixed", policy: "best_fixed", configuration: opts.bestFixedKey },
    { key: "rank", policy: "rank", configuration: `${pair[0]} + ${pair[1]}` },
    { key: "refine", policy: "refine", configuration: `rank winner → rubric-aware reviser` },
    ...fuseKeys.map((key) => ({
      key,
      policy: "fuse" as FusionPolicyKind,
      configuration: `${pair[0]} + ${pair[1]} → ${key.replace("fuse:", "")}`,
    })),
  ];

  const policyResults: StageBPolicyResult[] = [];
  for (const def of policyDefs) {
    const taskScores = perTask
      .filter((t) => def.key in t.scores)
      .map((t) => ({ taskId: t.taskId, score: t.scores[def.key] }));
    if (taskScores.length === 0) continue;
    const meanScore = taskScores.reduce((a, v) => a + v.score, 0) / taskScores.length;
    policyResults.push({
      pair,
      policy: def.policy,
      configuration: def.configuration,
      meanScore,
      costMultiplier: (policyCostTotals[def.key] ?? bestFixedTotal) / bestFixedTotal,
      perTaskScores: taskScores,
    });
    if (def.key.startsWith("fuse:")) {
      familyMeans.set(def.key.replace("fuse:", "") as FusionRecipeFamily, meanScore);
    }
  }

  // Predeclared finalist comparisons vs the MPID.
  const compareKeys: Array<[string, string]> = [];
  for (const fk of fuseKeys) {
    compareKeys.push([fk, "rank"], [fk, "refine"], [fk, "best_fixed"]);
  }
  compareKeys.push(["rank", "best_fixed"], ["refine", "best_fixed"]);
  const comparisons: StageBComparison[] = [];
  for (const [pKey, qKey] of compareKeys) {
    const taskRows = perTask
      .filter((t) => pKey in t.scores && qKey in t.scores)
      .map((t) => ({ taskId: t.taskId, scoresP: [t.scores[pKey]], scoresQ: [t.scores[qKey]] }));
    if (taskRows.length === 0) continue;
    const stats = pairedDeltaComparison(taskRows, { mpid: input.mpid, rng: input.rng });
    comparisons.push({
      pair,
      p: policyForKey(pKey),
      q: policyForKey(qKey),
      meanDelta: stats.meanDelta,
      ciLow: stats.ciLow,
      ciHigh: stats.ciHigh,
      wins: stats.wins,
      ties: stats.ties,
      losses: stats.losses,
      mpid: input.mpid,
      verdict: stats.verdict,
    });
  }

  return { policyResults, comparisons, familyMeans };
}

function policyForKey(key: string): FusionPolicyKind {
  if (key.startsWith("fuse:")) return "fuse";
  return key as FusionPolicyKind;
}

function resolvePairSlots(
  pool: PoolManifestVersion,
  pair: [string, string],
): [ModelSlot, ModelSlot] {
  return [resolveSlot(pool, pair[0]), resolveSlot(pool, pair[1])];
}

function resolveSlot(pool: PoolManifestVersion, modelKey: string): ModelSlot {
  const slot = activePoolSlots(pool).find((s) => modelKeyOf(s) === modelKey);
  if (!slot) throw new Error(`Model ${modelKey} is not in the active pool manifest.`);
  return slot;
}

interface FinishTrialInput {
  slots: ModelSlot[];
  policy: FusionPolicyKind;
  recipe: { id: string; version: number } | null;
  synthesizer: CriticRef | null;
  /** Shared blocked evidence — null for the best-fixed baseline. */
  stageEvidence: BlockedRunResult | null;
  artifactText: string;
  artifactSynth: { synthesizer: CriticRef; promptVersion: string } | null;
  finishCosts: TokenCost[];
  score: number;
}

async function finishTrial(
  deps: StageDriverDeps,
  input: PairEvaluationInput,
  args: FinishTrialInput,
): Promise<FusionTrial> {
  const trial = await deps.controller.createTrial({
    study: input.study,
    poolRef: { id: input.pool.id, version: input.pool.version },
    candidateConfig: { slots: args.slots },
    policy: args.policy,
    recipe: args.recipe,
    synthesizer: args.synthesizer,
    stage: "B",
    sampleIndex: 0,
  });
  await deps.controller.attachChildren(trial.id, {
    candidateRunId: args.stageEvidence?.candidateRunId ?? null,
    devJudgeRunId: args.stageEvidence?.devJudgeRunId ?? null,
    synthesisArtifact: args.artifactSynth
      ? artifactFor(
          trial.id,
          args.artifactText,
          args.artifactSynth.synthesizer,
          args.artifactSynth.promptVersion,
        )
      : null,
  });
  const shared = args.stageEvidence ? evidenceCosts(args.stageEvidence) : [];
  await writeTrialCost(deps, trial.id, shared, args.finishCosts);
  await recordObservation(
    deps,
    trial.id,
    input.study.judge2,
    args.score,
    sumCosts(args.finishCosts),
  );
  return deps.controller.seal(trial.id);
}

// =============================================================================
// Stage C — interaction check
// =============================================================================

export interface StageCDriverInput {
  study: FusionStudy;
  suite: EvaluationSuite;
  pool: PoolManifestVersion;
  profile: EvaluationProfileSnapshot | null;
  frozenRecipe: FusionRecipeVersion;
  runnerUpRecipe: FusionRecipeVersion;
  /** Best 1–2 pairs from Stage B with their frozen-family mean scores. */
  topPairs: Array<{ pair: [string, string]; frozenMean: number }>;
  /** Alternate synthesizer for the cross (budget-gated). */
  alternateSynthesizer: CriticRef | null;
  tasksPerPair: number;
  /** In-memory per-task attachments (never persisted — plan 7.6.7). */
  taskAttachments?: Record<string, Attachment[]>;
}

export async function runStageC(
  deps: StageDriverDeps,
  input: StageCDriverInput,
): Promise<StageCResult> {
  await ensureRecipesPersisted(deps.repo, [input.frozenRecipe, input.runnerUpRecipe]);
  const spotChecks: StageCResult["spotChecks"] = [];
  const synthesizerCross: StageCResult["synthesizerCross"] = [];

  for (const top of input.topPairs) {
    const slots = resolvePairSlots(input.pool, top.pair);
    const tasks = input.suite.tasks.slice(0, input.tasksPerPair);
    const runnerUpScores: number[] = [];

    for (const task of tasks) {
      const evidence = await deps.executor.runBlockedEvidence(
        task,
        input.profile,
        slots,
        input.study.judge1,
      );
      const messages = renderRecipeMessages(input.runnerUpRecipe, {
        prompt: task.prompt,
        profile: input.profile,
        blindCandidates: evidence.blindCandidates,
        judgeReport: evidence.report,
        consensus: evidence.consensus,
        attachments: input.taskAttachments?.[task.id] ?? [],
      });
      const synth = await deps.executor.runSynthesis(input.runnerUpRecipe.synthesizer, messages);
      const holdout = await deps.executor.runHoldout(task, input.profile, input.study.judge2, [
        { key: `fuse:${input.runnerUpRecipe.recipeFamily}`, text: synth.text },
      ]);

      const trial = await deps.controller.createTrial({
        study: input.study,
        poolRef: { id: input.pool.id, version: input.pool.version },
        candidateConfig: { slots: [...slots] },
        policy: "fuse",
        recipe: { id: input.runnerUpRecipe.id, version: input.runnerUpRecipe.version },
        synthesizer: input.runnerUpRecipe.synthesizer,
        stage: "C",
        sampleIndex: 0,
      });
      await deps.controller.attachChildren(trial.id, {
        candidateRunId: evidence.candidateRunId,
        devJudgeRunId: evidence.devJudgeRunId,
        synthesisArtifact: artifactFor(
          trial.id,
          synth.text,
          input.runnerUpRecipe.synthesizer,
          input.runnerUpRecipe.promptVersion,
        ),
      });
      const score = holdout.scoresByKey[`fuse:${input.runnerUpRecipe.recipeFamily}`] ?? 0;
      runnerUpScores.push(score);
      await writeTrialCost(deps, trial.id, evidenceCosts(evidence), [synth.cost, holdout.cost]);
      await recordObservation(deps, trial.id, input.study.judge2, score, holdout.cost);
      await deps.controller.seal(trial.id);
    }

    const runnerUpMean =
      runnerUpScores.length === 0
        ? 0
        : runnerUpScores.reduce((a, v) => a + v, 0) / runnerUpScores.length;
    const overturned = runnerUpMean > top.frozenMean;
    // An overturned Stage B ranking is recipe-sensitive, not a pair-quality result.
    spotChecks.push({
      pair: top.pair,
      runnerUpFamily: input.runnerUpRecipe.recipeFamily,
      overturned,
      recipeSensitive: overturned,
    });
  }

  // Recipe × synthesizer cross for the top pair (budget-gated). Blocked
  // evidence depends only on (task, pair, judge1) — generate it once per task
  // and reuse it across all four cells (spec §6.3 child reuse).
  if (input.alternateSynthesizer && input.topPairs.length > 0) {
    const top = input.topPairs[0];
    const slots = resolvePairSlots(input.pool, top.pair);
    const tasks = input.suite.tasks.slice(0, input.tasksPerPair);
    const evidenceByTask = new Map<string, BlockedRunResult>();
    for (const task of tasks) {
      evidenceByTask.set(
        task.id,
        await deps.executor.runBlockedEvidence(task, input.profile, slots, input.study.judge1),
      );
    }
    for (const recipe of [input.frozenRecipe, input.runnerUpRecipe]) {
      for (const synthesizer of [recipe.synthesizer, input.alternateSynthesizer]) {
        const scores: number[] = [];
        for (const task of tasks) {
          const evidence = evidenceByTask.get(task.id)!;
          const messages = renderRecipeMessages(recipe, {
            prompt: task.prompt,
            profile: input.profile,
            blindCandidates: evidence.blindCandidates,
            judgeReport: evidence.report,
            consensus: evidence.consensus,
            attachments: input.taskAttachments?.[task.id] ?? [],
          });
          const synth = await deps.executor.runSynthesis(synthesizer, messages);
          const holdout = await deps.executor.runHoldout(task, input.profile, input.study.judge2, [
            { key: "cell", text: synth.text },
          ]);
          scores.push(holdout.scoresByKey["cell"] ?? 0);
        }
        synthesizerCross.push({
          pair: top.pair,
          recipe: recipe.recipeFamily,
          synthesizer,
          score: scores.length === 0 ? 0 : scores.reduce((a, v) => a + v, 0) / scores.length,
        });
      }
    }
  }

  return { spotChecks, synthesizerCross, completedAt: Date.now() };
}
