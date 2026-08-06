// =============================================================================
// RSemble AI — Fusion playbook builder (spec §8)
//
// The per-suite deliverable: a policy comparison table with an explicit claim
// level, a pool-adequacy qualifier, and a narrative conclusion. "Do not fuse"
// is a first-class verdict, not a failure state.
//
// Recommendation logic (predeclared):
//  - Fuse must beat BOTH Rank and the rubric-aware refine pass against the
//    MPID to be recommended (spec §1.4) — beating solo outputs is not enough.
//  - Otherwise the best baseline that clears the MPID vs best-fixed wins.
//  - If nothing clears the MPID, the verdict is do_not_fuse with the
//    pool-adequacy qualifier attached.
// =============================================================================

import type {
  FusionConfidence,
  FusionPlaybook,
  FusionPlaybookRow,
  FusionPolicyKind,
  FusionRecommendation,
  FusionStudy,
  PoolAdequacyOutcome,
  StageBComparison,
  StageBPolicyResult,
  StageCResult,
} from "./fusion-study-types";

export interface PlaybookInput {
  study: FusionStudy;
  policyResults: StageBPolicyResult[];
  comparisons: StageBComparison[];
  poolAdequacy: PoolAdequacyOutcome;
  stageC: StageCResult | null;
  generateId?: () => string;
  now?: () => number;
}

/** Aggregate one policy's rows across pairs into a single playbook row. */
function aggregatePolicy(
  policy: FusionPolicyKind,
  results: StageBPolicyResult[],
  bestFixedScore: number,
): FusionPlaybookRow | null {
  const rows = results.filter((r) => r.policy === policy);
  if (rows.length === 0) return null;
  const score = rows.reduce((a, r) => a + r.meanScore, 0) / rows.length;
  const costMultiplier = rows.reduce((a, r) => a + r.costMultiplier, 0) / rows.length;
  const configuration = rows.map((r) => r.configuration).join("; ");
  return {
    policy,
    configuration,
    score,
    lift: score - bestFixedScore,
    costMultiplier,
    confidence: "medium", // replaced by confidence pass below
  };
}

function confidenceFromComparisons(
  policy: FusionPolicyKind,
  comparisons: StageBComparison[],
): FusionConfidence {
  const relevant = comparisons.filter((c) => c.p === policy || c.q === policy);
  if (relevant.length === 0) return "low";
  const adopted = relevant.filter((c) => c.verdict === "adopt").length;
  const widths = relevant.map((c) => c.ciHigh - c.ciLow);
  const maxWidth = Math.max(...widths);
  if (adopted === relevant.length && maxWidth <= 0.3) return "high";
  if (relevant.some((c) => c.verdict === "adopt")) return "medium";
  return "low";
}

/**
 * The predeclared recommendation: Fuse only when it clears the MPID against
 * BOTH Rank and Refine; else the best MPID-clearing baseline; else do not fuse.
 */
export function recommendPolicy(
  rows: FusionPlaybookRow[],
  comparisons: StageBComparison[],
): FusionRecommendation {
  const fuseRow = rows.find((r) => r.policy === "fuse");
  const rankRow = rows.find((r) => r.policy === "rank");
  const refineRow = rows.find((r) => r.policy === "refine");
  const bestFixedRow = rows.find((r) => r.policy === "best_fixed");

  const verdictBetween = (p: FusionPolicyKind, q: FusionPolicyKind) =>
    comparisons.find((c) => c.p === p && c.q === q)?.verdict ?? null;

  if (fuseRow) {
    const beatsRank = verdictBetween("fuse", "rank") === "adopt";
    const beatsRefine = verdictBetween("fuse", "refine") === "adopt";
    if (beatsRank && beatsRefine) {
      return {
        kind: "adopt",
        policy: "fuse",
        configuration: fuseRow.configuration,
        rationale:
          `Fusion clears the +MPID bar against both Rank and the refine-the-winner ` +
          `control (mean ${fuseRow.score.toFixed(2)}, ${fuseRow.costMultiplier.toFixed(1)}× cost).`,
      };
    }
  }

  // Best baseline that clears the MPID vs best-fixed.
  const baselines = [rankRow, refineRow].filter((r): r is FusionPlaybookRow => r !== null);
  const clearing = baselines.filter((r) => verdictBetween(r.policy, "best_fixed") === "adopt");
  if (clearing.length > 0) {
    clearing.sort((a, b) => b.score - a.score || a.costMultiplier - b.costMultiplier);
    const best = clearing[0];
    const fuseNote = fuseRow
      ? " Fusion did not justify its cost against this baseline — do not fuse for routine runs."
      : "";
    return {
      kind: "adopt",
      policy: best.policy,
      configuration: best.configuration,
      rationale:
        `${best.policy === "rank" ? "Rank" : "Refine"} clears the MPID vs best-fixed ` +
        `(mean ${best.score.toFixed(2)} at ${best.costMultiplier.toFixed(1)}× cost).${fuseNote}`,
    };
  }

  void bestFixedRow;
  return {
    kind: "do_not_fuse",
    rationale:
      "No policy clears the predeclared MPID over the best fixed model. " +
      "Do not fuse for this suite — run the best single model.",
  };
}

/** The narrative conclusion line (spec §8), including the adequacy qualifier. */
export function playbookConclusion(
  rows: FusionPlaybookRow[],
  recommendation: FusionRecommendation,
  poolAdequacy: PoolAdequacyOutcome,
  claimLevel: "exploratory" | "confirmed",
  stageC: StageCResult | null,
): string {
  const parts: string[] = [];
  const fuseRow = rows.find((r) => r.policy === "fuse");
  const rankRow = rows.find((r) => r.policy === "rank");

  if (recommendation.kind === "do_not_fuse") {
    parts.push("For this suite: do not use fusion — run the best single model.");
  } else if (recommendation.policy === "fuse" && fuseRow) {
    parts.push(
      `For this suite: Fuse ${fuseRow.configuration} when maximum quality matters` +
        (rankRow ? `; Rank ${rankRow.configuration} when cost matters` : "") +
        "; do not use fusion for routine runs.",
    );
  } else {
    parts.push(
      `For this suite: ${recommendation.policy === "rank" ? "Rank" : "Refine"} ` +
        `${recommendation.configuration}; do not use fusion for routine runs.`,
    );
  }

  if (poolAdequacy.probed) {
    parts.push(
      `Pool adequacy: ${poolAdequacy.outcome ?? "unconfirmed (probe triggered, no challengers run)"}.`,
    );
  }
  const sensitive = stageC?.spotChecks.filter((s) => s.recipeSensitive) ?? [];
  if (sensitive.length > 0) {
    parts.push(
      `Recipe-sensitive ranking flagged on ${sensitive.map((s) => s.pair.join("+")).join(", ")} — ` +
        `treat the pair ranking as recipe-dependent.`,
    );
  }
  parts.push(`Status: ${claimLevel}.`);
  return parts.join(" ");
}

export function buildPlaybook(input: PlaybookInput): FusionPlaybook {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const now = input.now ?? Date.now;

  const bestFixedResults = input.policyResults.filter((r) => r.policy === "best_fixed");
  const bestFixedScore =
    bestFixedResults.length === 0
      ? 0
      : bestFixedResults.reduce((a, r) => a + r.meanScore, 0) / bestFixedResults.length;

  const rows: FusionPlaybookRow[] = [];
  for (const policy of ["best_fixed", "rank", "fuse", "refine"] as FusionPolicyKind[]) {
    const row = aggregatePolicy(policy, input.policyResults, bestFixedScore);
    if (!row) continue;
    row.confidence =
      policy === "best_fixed" ? "high" : confidenceFromComparisons(policy, input.comparisons);
    rows.push(row);
  }

  const recommendation = recommendPolicy(rows, input.comparisons);
  const conclusion = playbookConclusion(
    rows,
    recommendation,
    input.poolAdequacy,
    input.study.claimLevel,
    input.stageC,
  );

  return {
    id: generateId(),
    studyId: input.study.id,
    suiteRef: input.study.suiteRef,
    rows,
    recommendation,
    poolAdequacy: input.poolAdequacy,
    claimLevel: input.study.claimLevel,
    conclusion,
    createdAt: now(),
  };
}
