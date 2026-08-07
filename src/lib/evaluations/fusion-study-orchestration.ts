// =============================================================================
// RSemble AI — Fusion Study orchestration entry point
//
// Chains the three stages end-to-end for one study: stratified Stage A →
// headroom shortlist (Stage B) → Stage C spot check → sealed playbook, wiring
// the executor port, the controller, and the repository. Persisted after each
// stage so an interrupted study retains sealed progress.
// =============================================================================

import type { CriticRef } from "../providers/types";
import type { ModelSlot } from "../../studio-data";
import type { EvaluationProfileSnapshot, EvaluationSuite } from "./evaluation-types";
import type {
  FusionPlaybook,
  FusionRecipeVersion,
  FusionStudy,
  PoolManifestVersion,
} from "./fusion-study-types";
import {
  computeHeadroom,
  taskOverall,
  modelTaskScoreFromReport,
  type CriterionWeights,
  type ModelTaskScore,
  type PairedTaskScores,
} from "./complementarity";
import { buildPlaybook } from "./fusion-playbook";
import {
  activePoolSlots,
  modelKeyOf,
  runStageA,
  runStageB,
  runStageC,
  type ShortlistRule,
  type StageDriverDeps,
  type StratifiedPair,
} from "./fusion-study-stages";

export interface RunFusionStudyInput {
  studyId: string;
  suite: EvaluationSuite;
  profile: EvaluationProfileSnapshot | null;
  /** How many tasks feed Stage A stratification screening. */
  stratificationTasks: number;
  tasksPerPairA: number;
  tasksPerPairB: number;
  tasksPerPairC: number;
  shortlistRule: ShortlistRule;
  sequentialPairs: number;
  mpid: number;
  outsideChallengers?: ModelSlot[];
  alternateSynthesizer?: CriticRef | null;
}

export const DEFAULT_SHORTLIST_RULE: ShortlistRule = {
  description: "Shortlist pairs with H_synth ≥ 0.15 or H_select ≥ 0.25; top 5 by max headroom.",
  maxPairs: 5,
  minSynthesisHeadroom: 0.15,
  minSelectionHeadroom: 0.25,
};

/**
 * Pick the stratified Stage A pairs (spec §7.1): highest-headroom pair, a
 * median-positive pair, and a near-zero/control pair, from a cheap screening
 * sweep over a small task sample.
 */
export async function pickStratifiedPairs(
  deps: StageDriverDeps,
  study: FusionStudy,
  suite: EvaluationSuite,
  pool: PoolManifestVersion,
  profile: EvaluationProfileSnapshot | null,
  taskSample: number,
): Promise<StratifiedPair[]> {
  const weights: CriterionWeights = new Map((profile?.criteria ?? []).map((c) => [c.id, c.weight]));
  const slots = activePoolSlots(pool);
  const tasks = suite.tasks.slice(0, Math.max(1, taskSample));
  const scoresByTask = new Map<string, Map<string, ModelTaskScore>>();
  for (const task of tasks) {
    const sweep = await deps.executor.runPoolSweep(task, slots);
    const judged = await deps.executor.judgePool(task, profile, study.judge1, sweep.outputs);
    const modelScores = new Map<string, ModelTaskScore>();
    for (const output of sweep.outputs) {
      const score = modelTaskScoreFromReport(judged.report, output.candidateId);
      if (score) modelScores.set(output.modelKey, score);
    }
    scoresByTask.set(task.id, modelScores);
  }

  const rows: Array<{ slots: [ModelSlot, ModelSlot]; headroom: number }> = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const paired: PairedTaskScores[] = [];
      for (const task of tasks) {
        const a = scoresByTask.get(task.id)?.get(modelKeyOf(slots[i]));
        const b = scoresByTask.get(task.id)?.get(modelKeyOf(slots[j]));
        if (a && b) paired.push({ taskId: task.id, a, b });
      }
      const metrics = computeHeadroom(paired, weights);
      rows.push({
        slots: [slots[i], slots[j]],
        headroom: Math.max(metrics.selectionHeadroom, metrics.synthesisHeadroom ?? 0),
      });
    }
  }
  rows.sort((a, b) => b.headroom - a.headroom);
  if (rows.length === 0) return [];

  const high = rows[0];
  const positives = rows.filter((r) => r.headroom > 0.05);
  const median =
    positives.length > 1
      ? positives[Math.floor(positives.length / 2)]
      : rows[Math.min(1, rows.length - 1)];
  const control = rows[rows.length - 1];

  const picked: StratifiedPair[] = [{ slots: high.slots, stratum: "high" }];
  if (median && median !== high) picked.push({ slots: median.slots, stratum: "median" });
  if (control && control !== high && control !== median) {
    picked.push({ slots: control.slots, stratum: "control" });
  }
  return picked;
}

/**
 * Run a full exploration study: Stage A → B → C → playbook. Stage results are
 * persisted after each stage; the playbook is created immutable and the study
 * is marked completed with its playbook ref.
 */
export async function runFusionStudy(
  deps: StageDriverDeps,
  input: RunFusionStudyInput,
): Promise<FusionPlaybook> {
  const study = await deps.repo.getStudy(input.studyId);
  if (!study) throw new Error(`Fusion study ${input.studyId} not found`);
  const pool = await deps.repo.getPoolManifest(study.poolRef.id, study.poolRef.version);
  if (!pool)
    throw new Error(`Pool manifest ${study.poolRef.id} v${study.poolRef.version} not found`);
  const recipes: FusionRecipeVersion[] = [];
  for (const ref of study.recipeRefs) {
    const recipe = await deps.repo.getRecipe(ref.id, ref.version);
    if (!recipe) throw new Error(`Recipe ${ref.id} v${ref.version} not found`);
    recipes.push(recipe);
  }

  let current = study;

  // Stage A — stratified recipe elimination.
  const stratifiedPairs = await pickStratifiedPairs(
    deps,
    current,
    input.suite,
    pool,
    input.profile,
    input.stratificationTasks,
  );
  const stageA = await runStageA(deps, {
    study: current,
    suite: input.suite,
    pool,
    profile: input.profile,
    recipes,
    stratifiedPairs,
    tasksPerPair: input.tasksPerPairA,
  });
  current = await deps.controller.updateStudy({
    ...current,
    stageResults: { ...current.stageResults, stageA },
  });

  // Stage B — pair discovery with both survivors, sequential elimination.
  const survivorRecipes = stageA.survivors.map((family) => {
    const recipe = recipes.find((r) => r.recipeFamily === family);
    if (!recipe) throw new Error(`Surviving family ${family} has no recipe in the study set`);
    return recipe;
  }) as [FusionRecipeVersion, FusionRecipeVersion];
  const stageB = await runStageB(deps, {
    study: current,
    suite: input.suite,
    pool,
    profile: input.profile,
    survivingRecipes: survivorRecipes,
    shortlistRule: input.shortlistRule,
    sequentialPairs: input.sequentialPairs,
    tasksPerPair: input.tasksPerPairB,
    mpid: input.mpid,
    outsideChallengers: input.outsideChallengers,
  });
  current = await deps.controller.updateStudy({
    ...current,
    stageResults: { ...current.stageResults, stageB },
  });

  // Stage C — runner-up spot check on the best pair(s).
  const frozenFamily = stageB.frozenRecipe ?? stageA.survivors[0];
  const runnerUpFamily = stageA.survivors.find((f) => f !== frozenFamily) ?? stageA.survivors[1];
  const frozenRecipe = survivorRecipes.find((r) => r.recipeFamily === frozenFamily)!;
  const runnerUpRecipe = survivorRecipes.find((r) => r.recipeFamily === runnerUpFamily)!;
  const fuseRows = stageB.policyResults.filter((r) => r.policy === "fuse");
  const topPairs = [...fuseRows]
    .sort((a, b) => b.meanScore - a.meanScore)
    .slice(0, 2)
    .map((r) => ({ pair: r.pair, frozenMean: r.meanScore }));

  let stageC = null;
  if (topPairs.length > 0) {
    stageC = await runStageC(deps, {
      study: current,
      suite: input.suite,
      pool,
      profile: input.profile,
      frozenRecipe,
      runnerUpRecipe,
      topPairs,
      alternateSynthesizer: input.alternateSynthesizer ?? null,
      tasksPerPair: input.tasksPerPairC,
    });
    current = await deps.controller.updateStudy({
      ...current,
      stageResults: { ...current.stageResults, stageC },
    });
  }

  // Playbook — the per-suite deliverable.
  const playbook = buildPlaybook({
    study: current,
    policyResults: stageB.policyResults,
    comparisons: stageB.comparisons,
    poolAdequacy: stageB.poolAdequacy,
    stageC,
  });
  await deps.repo.createPlaybook(playbook);
  await deps.controller.updateStudy({
    ...current,
    playbookRef: playbook.id,
    status: "completed",
  });
  return playbook;
}

/** Best-fixed suite mean (used by confirmation economics, spec §14.3). */
export function bestFixedSuiteMean(
  tasks: Array<{ id: string }>,
  scoresByTask: Map<string, Map<string, ModelTaskScore>>,
  weights: CriterionWeights,
  modelKeys: string[],
): number {
  let best = 0;
  for (const key of modelKeys) {
    const overalls = tasks
      .map((t) => scoresByTask.get(t.id)?.get(key))
      .filter((s): s is ModelTaskScore => s !== undefined)
      .map((s) => taskOverall(s, weights))
      .filter((v): v is number => v !== null);
    const mean = overalls.length === 0 ? 0 : overalls.reduce((a, v) => a + v, 0) / overalls.length;
    best = Math.max(best, mean);
  }
  return best;
}
