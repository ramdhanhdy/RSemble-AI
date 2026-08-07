// =============================================================================
// RSemble AI — Fusion Study confirmation lifecycle (spec §7.5)
//
// Stages A and B are selection procedures; their intervals are optimistically
// biased (winner's curse). A CONFIRMATION study evaluates the preselected
// configuration on a fresh suite version — it does NOT re-select. No
// stratification, no screening, no shortlist: the frozen recipe and the top
// pair come from the source study's sealed Stage B, and only the evaluation
// runs on new tasks.
//
// Promotion rule: when the source recommendation reproduces on fresh tasks
// (same adopted policy, or do-not-fuse confirmed), the confirmation study and
// its playbook carry the confirmed claim level and the source study's
// recommendation is promoted; otherwise the claim stays exploratory (demoted).
// =============================================================================

import type {
  EvaluationProfileSnapshot,
  EvaluationSuite,
  EvaluationTask,
} from "./evaluation-types";
import type {
  FusionPlaybook,
  FusionPolicyKind,
  FusionRecipeFamily,
  FusionStudy,
  PoolManifestVersion,
} from "./fusion-study-types";
import { buildPlaybook, recommendPolicy } from "./fusion-playbook";
import { evaluatePairBlocked, type StageDriverDeps } from "./fusion-study-stages";

/** The configuration frozen at selection time — the ONLY thing a confirmation evaluates. */
export interface PreselectedConfig {
  policy: FusionPolicyKind;
  recipeFamily: FusionRecipeFamily | null;
  pair: [string, string] | null;
  /** The best-fixed baseline model — frozen at selection time, never re-derived. */
  bestFixedKey: string | null;
}

/**
 * Extract the preselected configuration from a completed source study: the
 * frozen recipe and the best fuse pair from sealed Stage B, plus the
 * playbook's recommended policy.
 */
export function preselectedConfigFrom(
  sourceStudy: FusionStudy,
  sourcePlaybook: FusionPlaybook,
): PreselectedConfig | null {
  const stageB = sourceStudy.stageResults.stageB;
  if (!stageB) return null;
  const fuseRows = stageB.policyResults.filter((r) => r.policy === "fuse");
  const top = [...fuseRows].sort((a, b) => b.meanScore - a.meanScore)[0];
  const recipeFamily = stageB.frozenRecipe ?? sourceStudy.stageResults.stageA?.survivors[0] ?? null;
  return {
    policy:
      sourcePlaybook.recommendation.kind === "adopt"
        ? sourcePlaybook.recommendation.policy
        : "fuse",
    recipeFamily,
    pair: top?.pair ?? null,
    bestFixedKey:
      stageB.policyResults.find((r) => r.policy === "best_fixed")?.configuration ?? null,
  };
}

export interface ConfirmationInput {
  sourceStudyId: string;
  confirmationStudyId: string;
  /** The NEW suite version carrying fresh tasks. */
  suite: EvaluationSuite;
  profile: EvaluationProfileSnapshot | null;
  tasksPerPair: number;
  mpid: number;
  rng?: () => number;
}

export interface ConfirmationOutcome {
  playbook: FusionPlaybook;
  /** True when the preselected recommendation held on fresh tasks. */
  promoted: boolean;
}

/**
 * Run a confirmation study: evaluate the preselected configuration on the new
 * suite version's fresh tasks — never re-selecting. Throws when the guard is
 * violated (wrong study kind, missing lineage, or same suite snapshot).
 */
export async function runConfirmationStudy(
  deps: StageDriverDeps,
  input: ConfirmationInput,
): Promise<ConfirmationOutcome> {
  const source = await deps.repo.getStudy(input.sourceStudyId);
  if (!source) throw new Error(`Source study ${input.sourceStudyId} not found`);
  if (source.status !== "completed" || !source.playbookRef) {
    throw new Error("Only a completed study with a playbook can be confirmed.");
  }
  const sourcePlaybook = await deps.repo.getPlaybook(source.playbookRef);
  if (!sourcePlaybook) throw new Error(`Playbook ${source.playbookRef} not found`);

  const confirmation = await deps.repo.getStudy(input.confirmationStudyId);
  if (!confirmation) throw new Error(`Confirmation study ${input.confirmationStudyId} not found`);
  if (confirmation.kind !== "confirmation" || confirmation.confirmationOf !== source.id) {
    throw new Error(
      "Promotion requires a confirmation study linked to its exploratory source — " +
        "exploration studies cannot self-confirm.",
    );
  }
  // Fresh tasks are the confirmation vehicle: same snapshot = re-selection data.
  if (
    confirmation.suiteRef.suiteVersion === source.suiteRef.suiteVersion &&
    confirmation.suiteRef.protocolFingerprint === source.suiteRef.protocolFingerprint
  ) {
    throw new Error(
      "A confirmation study must run on a NEW suite version — confirming on the " +
        "selection data re-introduces the winner's curse.",
    );
  }

  const pool: PoolManifestVersion | null = await deps.repo.getPoolManifest(
    confirmation.poolRef.id,
    confirmation.poolRef.version,
  );
  if (!pool) {
    throw new Error(
      `Pool manifest ${confirmation.poolRef.id} v${confirmation.poolRef.version} not found`,
    );
  }

  const config = preselectedConfigFrom(source, sourcePlaybook);
  if (!config?.pair || !config.recipeFamily) {
    throw new Error("The source study has no preselected pair/recipe to confirm.");
  }
  const recipe = config.recipeFamily
    ? await (async () => {
        for (const ref of source.recipeRefs) {
          const r = await deps.repo.getRecipe(ref.id, ref.version);
          if (r?.recipeFamily === config.recipeFamily) return r;
        }
        return null;
      })()
    : null;
  if (!recipe)
    throw new Error(`Frozen recipe family ${config.recipeFamily} not found in the recipe store`);

  // Evaluate the preselected pair blocked on fresh tasks — no screening, no
  // shortlist, no Stage A, no re-derived baseline. The best-fixed model comes
  // from the source's sealed Stage B; falling back to the pool's first core
  // slot only when the source never evaluated one.
  const tasks: EvaluationTask[] = input.suite.tasks.slice(0, input.tasksPerPair);
  const poolSlots = [...pool.core, ...pool.challengers].filter((s) => s.enabled);
  const bestFixedKey =
    config.bestFixedKey ??
    (poolSlots[0] ? `${poolSlots[0].providerId}:${poolSlots[0].slug}` : null);
  if (!bestFixedKey) throw new Error("The pool manifest has no enabled models.");

  const outcome = await evaluatePairBlocked(
    deps,
    {
      study: confirmation,
      pool,
      profile: input.profile,
      mpid: input.mpid,
      rng: input.rng,
    },
    config.pair,
    { recipes: [recipe], bestFixedKey, tasks },
  );

  // Does the preselected recommendation hold on fresh tasks?
  const rows = ["best_fixed", "rank", "fuse", "refine"] as FusionPolicyKind[];
  const bestFixedScore = (() => {
    const fixed = outcome.policyResults.filter((r) => r.policy === "best_fixed");
    return fixed.length === 0 ? 0 : fixed.reduce((a, r) => a + r.meanScore, 0) / fixed.length;
  })();
  const aggregated = rows
    .map((policy) => {
      const prs = outcome.policyResults.filter((r) => r.policy === policy);
      if (prs.length === 0) return null;
      const score = prs.reduce((a, r) => a + r.meanScore, 0) / prs.length;
      return {
        policy,
        configuration: prs.map((r) => r.configuration).join("; "),
        score,
        lift: score - bestFixedScore,
        costMultiplier: prs.reduce((a, r) => a + r.costMultiplier, 0) / prs.length,
        confidence: "medium" as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  const freshRecommendation = recommendPolicy(aggregated, outcome.comparisons);

  const sourceRec = sourcePlaybook.recommendation;
  const promoted =
    (sourceRec.kind === "do_not_fuse" && freshRecommendation.kind === "do_not_fuse") ||
    (sourceRec.kind === "adopt" &&
      freshRecommendation.kind === "adopt" &&
      freshRecommendation.policy === sourceRec.policy);

  const claimLevel = promoted ? "confirmed" : "exploratory";
  const playbook = buildPlaybook({
    study: { ...confirmation, claimLevel },
    policyResults: outcome.policyResults,
    comparisons: outcome.comparisons,
    poolAdequacy: { probed: false, outcome: null, challengerKeys: [], note: "" },
    stageC: null,
  });
  const stamped: FusionPlaybook = { ...playbook, claimLevel };
  await deps.repo.createPlaybook(stamped);

  let current = confirmation;
  current = await deps.controller.updateStudy({
    ...current,
    claimLevel,
    playbookRef: stamped.id,
    status: "completed",
  });
  void current;

  if (promoted) {
    // Promote the source recommendation — the visible claim level moves.
    const latestSource = await deps.repo.getStudy(source.id);
    if (latestSource) {
      await deps.controller.updateStudy({ ...latestSource, claimLevel: "confirmed" });
    }
  }

  return { playbook: stamped, promoted };
}
