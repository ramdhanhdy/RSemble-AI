// =============================================================================
// RSemble AI — Fusion corpus characterization fixture (Child 06 Milestone A, T0)
//
// A comprehensive, type-guard-valid snapshot of the LIVE Fusion corpus as it
// exists on baseline `0bab030e` (Dexie v11, seven Fusion stores from schema
// v2). This fixture is characterization evidence: it exercises every policy,
// recipe family/stage, lifecycle state, retry/failure path, cost shape,
// artifact ref, pool-adequacy outcome, recipe-sensitivity finding, the
// `do_not_fuse` verdict, and an unresolved Suite→Task Set owner — so that the
// later hard-migration (Milestone B) can be failed against it.
//
// This module is FIXTURE ONLY. It does not migrate, add Lab stores, touch the
// Fusion runtime, or import the database. Every record is constructed through
// the same builder helpers the existing fusion-study-repository.test.ts uses,
// so the shapes stay valid against the live type guards.
// =============================================================================

import type { ModelSlot } from "../../studio-data";
import type { CriticRef, ProviderId } from "../providers/types";
import type {
  EvaluationObservation,
  FusionAttempt,
  FusionPlaybook,
  FusionRecipeRef,
  FusionRecipeVersion,
  FusionStageResults,
  FusionStudy,
  FusionTrial,
  FusionTrialChildren,
  FusionTrialCost,
  PoolAdequacyOutcome,
  PoolManifestVersion,
  StageAResult,
  StageBResult,
  StageCResult,
} from "../evaluations/fusion-study-types";
import type { TaskSetOwnershipCrosswalkRow } from "../persistence/database";

// --- Builder helpers ----------------------------------------------------------

function slot(id: string, slug: string, providerId: ProviderId = "openrouter"): ModelSlot {
  return {
    id,
    providerId,
    provider: "Test",
    model: `Model ${id}`,
    slug,
    enabled: true,
  };
}

const JUDGE_DEV: CriticRef = { providerId: "openrouter", model: "acme/judge-dev" };
const JUDGE_HOLDOUT: CriticRef = { providerId: "gemini", model: "acme/judge-holdout" };
const SYNTHESIZER: CriticRef = { providerId: "openrouter", model: "acme/synth" };
const REFINER: CriticRef = { providerId: "openrouter", model: "acme/refiner" };

const SUITE_REF = {
  suiteId: "suite-1",
  suiteVersion: 4,
  protocolFingerprint: "sha256:protocol-fixture-v4",
} as const;
const SUITE_REF_CONFIRM = {
  suiteId: "suite-1",
  suiteVersion: 5,
  protocolFingerprint: "sha256:protocol-fixture-v5",
} as const;
const SUITE_REF_DNF = {
  suiteId: "suite-2",
  suiteVersion: 3,
  protocolFingerprint: "sha256:protocol-fixture-dnf-v3",
} as const;
const SUITE_REF_UNRESOLVED = {
  suiteId: "suite-3",
  suiteVersion: 2,
  protocolFingerprint: "sha256:protocol-fixture-unresolved-v2",
} as const;

function recipe(
  id: string,
  version: number,
  family: FusionRecipeVersion["recipeFamily"],
  overrides: Partial<FusionRecipeVersion> = {},
): FusionRecipeVersion {
  const mode =
    family === "BlindRaw" ? "none" : family === "AnalysisFed" ? "qualitative" : "scores";
  return {
    id,
    version,
    recipeFamily: family,
    promptVersion: `${id}-v${version}`,
    judgeAnalysisMode: mode,
    rubricAccess: false,
    verification: false,
    synthesizer: SYNTHESIZER,
    ...overrides,
  };
}

function manifest(
  id: string,
  version: number,
  overrides: Partial<PoolManifestVersion> = {},
): PoolManifestVersion {
  return {
    id,
    version,
    core: [
      slot("s1", "a/m1"),
      slot("s2", "a/m2"),
      slot("s3", "b/m3"),
      slot("s4", "c/m4"),
      slot("s5", "d/m5"),
      slot("s6", "e/m6"),
    ],
    challengers: [],
    diversityChecklist: ["independent families", "mixed reasoning profiles"],
    rationale: "fixture pool",
    supersedesVersion: null,
    createdAt: 1000,
    ...overrides,
  };
}

function trialCost(
  policy: [number, number],
  experimental: [number, number],
): FusionTrialCost {
  return {
    policy: { tokensIn: policy[0], tokensOut: policy[1] },
    experimental: { tokensIn: experimental[0], tokensOut: experimental[1] },
  };
}

function emptyChildren(): FusionTrialChildren {
  return { candidateRunId: null, devJudgeRunId: null, synthesisArtifact: null };
}

function artifactChildren(): FusionTrialChildren {
  return {
    candidateRunId: "run-cand-fixture",
    devJudgeRunId: "run-devjudge-fixture",
    synthesisArtifact: {
      runId: "run-synth-fixture",
      fusionAttemptId: "attempt-synth-fixture",
      contentHash: "sha256:artifact-fixture",
    },
  };
}

interface TrialSpec {
  id: string;
  studyId: string;
  policy: FusionTrial["policy"];
  stage: FusionTrial["stage"];
  sampleIndex?: number;
  status?: FusionTrial["status"];
  suiteRef?: FusionStudy["suiteRef"];
  sealedAt?: number | null;
  children?: FusionTrialChildren;
  cost?: FusionTrialCost;
  observationIds?: string[];
  createdAt?: number;
}

function trial(spec: TrialSpec): FusionTrial {
  const isFuse = spec.policy === "fuse";
  const isRefine = spec.policy === "refine";
  return {
    id: spec.id,
    revision: 0,
    studyId: spec.studyId,
    suiteRef: spec.suiteRef ?? SUITE_REF,
    poolRef: { id: "pool-core-6", version: 1 },
    candidateConfig: { slots: [slot("s1", "a/m1"), slot("s3", "b/m3")] },
    judge1: JUDGE_DEV,
    judge2: JUDGE_HOLDOUT,
    policy: spec.policy,
    recipe: isFuse ? { id: "recipe-analysis-fed", version: 1 } : null,
    synthesizer: isFuse || isRefine ? (isRefine ? REFINER : SYNTHESIZER) : null,
    stage: spec.stage,
    sampleIndex: spec.sampleIndex ?? 0,
    children: spec.children ?? (spec.status === "sealed" ? artifactChildren() : emptyChildren()),
    observationIds: spec.observationIds ?? [],
    cost: spec.cost ?? trialCost([1200, 400], [1800, 520]),
    status: spec.status ?? "in_progress",
    sealedAt: spec.sealedAt ?? (spec.status === "sealed" ? 4000 : null),
    createdAt: spec.createdAt ?? 1000,
    updatedAt: spec.createdAt ?? (spec.status === "sealed" ? 4000 : 1000),
  };
}

function observation(
  id: string,
  trialId: string,
  overrides: Partial<EvaluationObservation> = {},
): EvaluationObservation {
  return {
    id,
    trialId,
    judge: JUDGE_HOLDOUT,
    runId: null,
    status: "completed",
    overallScore: 0.82,
    tokensIn: 900,
    tokensOut: 220,
    error: null,
    startedAt: 3000,
    finishedAt: 3100,
    ...overrides,
  };
}

function attempt(
  id: string,
  studyId: string,
  fromTrialId: string,
  toTrialId: string,
  reason: FusionAttempt["reason"],
  createdAt: number,
): FusionAttempt {
  return { id, studyId, fromTrialId, toTrialId, reason, createdAt };
}

// --- Stage results ------------------------------------------------------------

const STAGE_A: StageAResult = {
  pairs: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      stratum: "high",
      familyScores: { BlindRaw: 0.61, AnalysisFed: 0.74, AnalysisScores: 0.77 },
      refineWinnerScore: 0.7,
    },
    {
      pair: ["openrouter:a/m2", "openrouter:c/m4"],
      stratum: "median",
      familyScores: { BlindRaw: 0.58, AnalysisFed: 0.69, AnalysisScores: 0.71 },
      refineWinnerScore: 0.66,
    },
  ],
  survivors: ["AnalysisFed", "AnalysisScores"],
  eliminated: [{ family: "BlindRaw", reason: "lowest mean across both strata" }],
  completedAt: 4200,
};

const POOL_ADEQUACY_CONFIRMED: PoolAdequacyOutcome = {
  probed: true,
  outcome: "confirmed",
  challengerKeys: ["openrouter:chall-1"],
  note: "challenger did not overturn the shortlist",
};

const POOL_ADEQUACY_UNCONFIRMED: PoolAdequacyOutcome = {
  probed: true,
  outcome: "unconfirmed",
  challengerKeys: ["openrouter:chall-2"],
  note: "challenger overturned one shortlisted pair",
};

const STAGE_B_ADOPT: StageBResult = {
  screenedPairs: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      selectionHeadroom: 0.12,
      synthesisHeadroom: 0.09,
      perCriterionHeadroom: [{ criterionId: "c-acc", headroom: 0.08 }],
      costMultiplier: 1.4,
      shortlisted: true,
    },
    {
      pair: ["openrouter:a/m2", "openrouter:c/m4"],
      selectionHeadroom: 0.05,
      synthesisHeadroom: 0.03,
      perCriterionHeadroom: [{ criterionId: "c-acc", headroom: 0.02 }],
      costMultiplier: 1.1,
      shortlisted: false,
    },
  ],
  shortlistRule: "top-1 by selection headroom",
  shortlist: [["openrouter:a/m1", "openrouter:b/m3"]],
  frozenRecipe: "AnalysisFed",
  recipeEliminationLog: [
    {
      pairs: [["openrouter:a/m1", "openrouter:b/m3"]],
      dropped: "AnalysisScores",
      reason: "no lift over AnalysisFed at the predeclared MPID",
    },
  ],
  poolAdequacy: POOL_ADEQUACY_CONFIRMED,
  policyResults: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      policy: "best_fixed",
      configuration: "best-fixed A",
      meanScore: 0.7,
      costMultiplier: 1.0,
      perTaskScores: [{ taskId: "t-1", score: 0.7 }],
    },
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      policy: "rank",
      configuration: "rank A→B",
      meanScore: 0.74,
      costMultiplier: 1.2,
      perTaskScores: [{ taskId: "t-1", score: 0.74 }],
    },
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      policy: "fuse",
      configuration: "A + B → Synth",
      meanScore: 0.83,
      costMultiplier: 1.4,
      perTaskScores: [{ taskId: "t-1", score: 0.83 }],
    },
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      policy: "refine",
      configuration: "Refine winner",
      meanScore: 0.79,
      costMultiplier: 1.3,
      perTaskScores: [{ taskId: "t-1", score: 0.79 }],
    },
  ],
  comparisons: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      p: "fuse",
      q: "best_fixed",
      meanDelta: 0.13,
      ciLow: 0.06,
      ciHigh: 0.2,
      wins: 7,
      ties: 1,
      losses: 2,
      mpid: 0.05,
      verdict: "adopt",
    },
  ],
  completedAt: 4400,
};

const STAGE_B_DO_NOT_FUSE: StageBResult = {
  ...STAGE_B_ADOPT,
  poolAdequacy: POOL_ADEQUACY_UNCONFIRMED,
  comparisons: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      p: "fuse",
      q: "best_fixed",
      meanDelta: 0.02,
      ciLow: -0.03,
      ciHigh: 0.07,
      wins: 4,
      ties: 2,
      losses: 4,
      mpid: 0.05,
      verdict: "not_justified",
    },
  ],
  completedAt: 4400,
};

const STAGE_C_RECIPE_SENSITIVE: StageCResult = {
  spotChecks: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      runnerUpFamily: "AnalysisScores",
      overturned: false,
      recipeSensitive: true,
    },
  ],
  synthesizerCross: [
    {
      pair: ["openrouter:a/m1", "openrouter:b/m3"],
      recipe: "AnalysisFed",
      synthesizer: SYNTHESIZER,
      score: 0.82,
    },
  ],
  completedAt: 4600,
};

const STAGE_RESULTS_COMPLETE: FusionStageResults = {
  stageA: STAGE_A,
  stageB: STAGE_B_ADOPT,
  stageC: STAGE_C_RECIPE_SENSITIVE,
};

const STAGE_RESULTS_DNF: FusionStageResults = {
  stageA: STAGE_A,
  stageB: STAGE_B_DO_NOT_FUSE,
  stageC: STAGE_C_RECIPE_SENSITIVE,
};

const STAGE_RESULTS_INPROGRESS: FusionStageResults = {
  stageA: STAGE_A,
  stageB: null,
  stageC: null,
};

// --- Playbooks ----------------------------------------------------------------

function playbookAdopt(id: string, studyId: string): FusionPlaybook {
  return {
    id,
    studyId,
    suiteRef: SUITE_REF,
    rows: [
      {
        policy: "best_fixed",
        configuration: "best-fixed A",
        score: 0.7,
        lift: 0,
        costMultiplier: 1.0,
        confidence: "low",
      },
      {
        policy: "rank",
        configuration: "rank A→B",
        score: 0.74,
        lift: 0.04,
        costMultiplier: 1.2,
        confidence: "medium",
      },
      {
        policy: "fuse",
        configuration: "A + B → Synth",
        score: 0.83,
        lift: 0.13,
        costMultiplier: 1.4,
        confidence: "high",
      },
      {
        policy: "refine",
        configuration: "Refine winner",
        score: 0.79,
        lift: 0.09,
        costMultiplier: 1.3,
        confidence: "medium",
      },
    ],
    recommendation: {
      kind: "adopt",
      policy: "fuse",
      configuration: "A + B → Synth",
      rationale: "Fuse clears the predeclared MPID over best-fixed.",
    },
    poolAdequacy: POOL_ADEQUACY_CONFIRMED,
    claimLevel: "exploratory",
    conclusion: "Adopt Fuse for this suite version.",
    createdAt: 5000,
  };
}

function playbookConfirmed(id: string, studyId: string): FusionPlaybook {
  return {
    ...playbookAdopt(id, studyId),
    suiteRef: SUITE_REF_CONFIRM,
    claimLevel: "confirmed",
    conclusion: "Confirmed: Fuse clears the MPID on a fresh suite version.",
    createdAt: 9000,
  };
}

function playbookDoNotFuse(id: string, studyId: string): FusionPlaybook {
  return {
    id,
    studyId,
    suiteRef: SUITE_REF_DNF,
    rows: [
      {
        policy: "best_fixed",
        configuration: "best-fixed A",
        score: 0.7,
        lift: 0,
        costMultiplier: 1.0,
        confidence: "medium",
      },
      {
        policy: "fuse",
        configuration: "A + B → Synth",
        score: 0.72,
        lift: 0.02,
        costMultiplier: 1.4,
        confidence: "low",
      },
    ],
    recommendation: {
      kind: "do_not_fuse",
      rationale: "Fuse does not clear the predeclared MPID; pool adequacy unconfirmed.",
    },
    poolAdequacy: POOL_ADEQUACY_UNCONFIRMED,
    claimLevel: "exploratory",
    conclusion: "Do not fuse for this suite version.",
    createdAt: 7000,
  };
}

// --- Studies ------------------------------------------------------------------

const STUDY_EXPLORATION_COMPLETED: FusionStudy = {
  id: "study-exploration-completed",
  revision: 3,
  kind: "exploration",
  suiteRef: SUITE_REF,
  poolRef: { id: "pool-core-6", version: 1 },
  judge1: JUDGE_DEV,
  judge2: JUDGE_HOLDOUT,
  recipeRefs: [
    { id: "recipe-analysis-fed", version: 1 },
    { id: "recipe-analysis-scores", version: 1 },
  ],
  stageResults: STAGE_RESULTS_COMPLETE,
  playbookRef: "playbook-adopt",
  claimLevel: "exploratory",
  confirmationOf: null,
  status: "completed",
  createdAt: 1000,
  updatedAt: 5000,
};

const STUDY_EXPLORATION_INPROGRESS: FusionStudy = {
  id: "study-exploration-inprogress",
  revision: 1,
  kind: "exploration",
  suiteRef: SUITE_REF,
  poolRef: { id: "pool-core-6", version: 1 },
  judge1: JUDGE_DEV,
  judge2: JUDGE_HOLDOUT,
  recipeRefs: [{ id: "recipe-analysis-fed", version: 1 }],
  stageResults: STAGE_RESULTS_INPROGRESS,
  playbookRef: null,
  claimLevel: "exploratory",
  confirmationOf: null,
  status: "in_progress",
  createdAt: 1000,
  updatedAt: 4200,
};

const STUDY_CONFIRMATION_COMPLETED: FusionStudy = {
  id: "study-confirmation-completed",
  revision: 2,
  kind: "confirmation",
  suiteRef: SUITE_REF_CONFIRM,
  poolRef: { id: "pool-core-6", version: 1 },
  judge1: JUDGE_DEV,
  judge2: JUDGE_HOLDOUT,
  recipeRefs: [{ id: "recipe-analysis-fed", version: 1 }],
  stageResults: STAGE_RESULTS_COMPLETE,
  playbookRef: "playbook-confirmed",
  claimLevel: "confirmed",
  confirmationOf: "study-exploration-completed",
  status: "completed",
  createdAt: 8000,
  updatedAt: 9000,
};

const STUDY_DO_NOT_FUSE: FusionStudy = {
  id: "study-do-not-fuse",
  revision: 2,
  kind: "exploration",
  suiteRef: SUITE_REF_DNF,
  poolRef: { id: "pool-core-6", version: 1 },
  judge1: JUDGE_DEV,
  judge2: JUDGE_HOLDOUT,
  recipeRefs: [{ id: "recipe-analysis-fed", version: 1 }],
  stageResults: STAGE_RESULTS_DNF,
  playbookRef: "playbook-do-not-fuse",
  claimLevel: "exploratory",
  confirmationOf: null,
  status: "completed",
  createdAt: 6000,
  updatedAt: 7000,
};

const STUDY_UNRESOLVED_OWNER: FusionStudy = {
  id: "study-unresolved-owner",
  revision: 0,
  kind: "exploration",
  suiteRef: SUITE_REF_UNRESOLVED,
  poolRef: { id: "pool-core-6", version: 1 },
  judge1: JUDGE_DEV,
  judge2: JUDGE_HOLDOUT,
  recipeRefs: [{ id: "recipe-analysis-fed", version: 1 }],
  stageResults: { stageA: null, stageB: null, stageC: null },
  playbookRef: null,
  claimLevel: "exploratory",
  confirmationOf: null,
  status: "in_progress",
  createdAt: 9500,
  updatedAt: 9500,
};

// --- Trials -------------------------------------------------------------------
// Covers every policy (best_fixed, rank, fuse, refine), every stage (A/B/C),
// in-progress + sealed, a treatment-changing retry pair (sampleIndex 0→1
// linked by a FusionAttempt), and an unsealed trial that holds observations.

const TRIALS: FusionTrial[] = [
  // study-exploration-completed — full policy × stage matrix.
  trial({ id: "trial-ec-bestfixed-A", studyId: "study-exploration-completed", policy: "best_fixed", stage: "A", status: "sealed", createdAt: 1100 }),
  trial({ id: "trial-ec-rank-A", studyId: "study-exploration-completed", policy: "rank", stage: "A", status: "sealed", createdAt: 1150 }),
  trial({ id: "trial-ec-fuse-A", studyId: "study-exploration-completed", policy: "fuse", stage: "A", status: "sealed", createdAt: 1200 }),
  trial({ id: "trial-ec-refine-A", studyId: "study-exploration-completed", policy: "refine", stage: "A", status: "sealed", createdAt: 1250 }),
  trial({ id: "trial-ec-bestfixed-B", studyId: "study-exploration-completed", policy: "best_fixed", stage: "B", status: "sealed", createdAt: 1300 }),
  trial({ id: "trial-ec-rank-B", studyId: "study-exploration-completed", policy: "rank", stage: "B", status: "sealed", createdAt: 1350 }),
  trial({ id: "trial-ec-fuse-B-0", studyId: "study-exploration-completed", policy: "fuse", stage: "B", sampleIndex: 0, status: "sealed", observationIds: ["obs-completed", "obs-failed", "obs-second-judge"], createdAt: 1400 }),
  trial({ id: "trial-ec-fuse-B-1", studyId: "study-exploration-completed", policy: "fuse", stage: "B", sampleIndex: 1, status: "sealed", createdAt: 2400 }),
  trial({ id: "trial-ec-refine-B", studyId: "study-exploration-completed", policy: "refine", stage: "B", status: "sealed", createdAt: 1450 }),
  trial({ id: "trial-ec-fuse-C", studyId: "study-exploration-completed", policy: "fuse", stage: "C", status: "sealed", createdAt: 1500 }),
  trial({ id: "trial-ec-refine-C", studyId: "study-exploration-completed", policy: "refine", stage: "C", status: "sealed", createdAt: 1550 }),
  // Unsealed in-progress trial carrying observations (measurement-only retries).
  trial({ id: "trial-ec-fuse-B-inprogress", studyId: "study-exploration-completed", policy: "fuse", stage: "B", status: "in_progress", observationIds: ["obs-inprogress-1"], createdAt: 1600 }),

  // study-exploration-inprogress — single in-progress trial.
  trial({ id: "trial-eip-fuse-A", studyId: "study-exploration-inprogress", policy: "fuse", stage: "A", status: "in_progress", createdAt: 1100 }),

  // study-confirmation-completed — fresh pinned configuration, no reselection.
  trial({ id: "trial-conf-fuse-B", studyId: "study-confirmation-completed", policy: "fuse", stage: "B", status: "sealed", suiteRef: SUITE_REF_CONFIRM, createdAt: 8200 }),

  // study-do-not-fuse — fuse trial that did not clear the MPID.
  trial({ id: "trial-dnf-fuse-B", studyId: "study-do-not-fuse", policy: "fuse", stage: "B", status: "sealed", suiteRef: SUITE_REF_DNF, createdAt: 6200 }),

  // study-unresolved-owner — in-progress trial with no crosswalk mapping.
  trial({ id: "trial-unres-fuse-A", studyId: "study-unresolved-owner", policy: "fuse", stage: "A", status: "in_progress", suiteRef: SUITE_REF_UNRESOLVED, createdAt: 9600 }),
];

const ATTEMPTS: FusionAttempt[] = [
  attempt("attempt-ec-fuse-B-synthesis-rerun", "study-exploration-completed", "trial-ec-fuse-B-0", "trial-ec-fuse-B-1", "synthesis_rerun", 2500),
];

const OBSERVATIONS: EvaluationObservation[] = [
  observation("obs-completed", "trial-ec-fuse-B-0", { status: "completed", overallScore: 0.83, tokensIn: 900, tokensOut: 220 }),
  observation("obs-failed", "trial-ec-fuse-B-0", { status: "failed", overallScore: null, tokensIn: null, tokensOut: null, error: { message: "holdout timeout", category: "provider", stage: "judge", timeoutKind: "overall_timeout", elapsedMs: 30000, configuredDurationMs: 30000 } }),
  observation("obs-second-judge", "trial-ec-fuse-B-0", { judge: { providerId: "deepseek", model: "acme/judge-third" }, status: "completed", overallScore: 0.81 }),
  observation("obs-inprogress-1", "trial-ec-fuse-B-inprogress", { status: "completed", overallScore: 0.8 }),
];

const PLAYBOOKS: FusionPlaybook[] = [
  playbookAdopt("playbook-adopt", "study-exploration-completed"),
  playbookConfirmed("playbook-confirmed", "study-confirmation-completed"),
  playbookDoNotFuse("playbook-do-not-fuse", "study-do-not-fuse"),
];

// --- Suite→Task Set ownership crosswalk --------------------------------------
// The live `taskSetOwnershipCrosswalk` rows that pin each Fusion study to an
// exact reconstructed Task Set Version (child 03 Task 4). The legacy route
// `/evaluations/:suiteId/fusion/:studyId` resolves via `ts-xwalk:fusion:<id>`.
// One study is intentionally UNRESOLVED — the crosswalk could not pin it to an
// exact Task Set Version, so it stays on its legacy route. This is the
// provenance-reconstruction evidence the STOP classification checks.

function fusionCrosswalk(
  studyId: string,
  suiteRef: FusionStudy["suiteRef"],
  resolved: { taskSetId: string; version: number },
): TaskSetOwnershipCrosswalkRow {
  return {
    key: `ts-xwalk:fusion:${studyId}`,
    kind: "fusion-owner",
    taskSetId: resolved.taskSetId,
    version: resolved.version,
    digest: null,
    status: "resolved",
    suiteRef: { suiteId: suiteRef.suiteId, suiteVersion: suiteRef.suiteVersion, protocolFingerprint: suiteRef.protocolFingerprint },
    updatedAt: 5200,
  };
}

function unresolvedFusionCrosswalk(
  studyId: string,
  suiteRef: FusionStudy["suiteRef"],
  note: string,
): TaskSetOwnershipCrosswalkRow {
  return {
    key: `ts-xwalk:fusion:${studyId}`,
    kind: "fusion-owner",
    taskSetId: "",
    version: null,
    digest: null,
    status: "unresolved",
    suiteRef: { suiteId: suiteRef.suiteId, suiteVersion: suiteRef.suiteVersion, protocolFingerprint: suiteRef.protocolFingerprint },
    note,
    updatedAt: 9700,
  };
}

const CROSSWALK_ROWS: TaskSetOwnershipCrosswalkRow[] = [
  fusionCrosswalk("study-exploration-completed", SUITE_REF, { taskSetId: "ts-1", version: 4 }),
  fusionCrosswalk("study-exploration-inprogress", SUITE_REF, { taskSetId: "ts-1", version: 4 }),
  fusionCrosswalk("study-confirmation-completed", SUITE_REF_CONFIRM, { taskSetId: "ts-1", version: 5 }),
  fusionCrosswalk("study-do-not-fuse", SUITE_REF_DNF, { taskSetId: "ts-2", version: 3 }),
  unresolvedFusionCrosswalk("study-unresolved-owner", SUITE_REF_UNRESOLVED, "suite-3 v2 has no exact reconstructed Task Set Version"),
];

// --- Recipes & pools ----------------------------------------------------------

const RECIPES: FusionRecipeVersion[] = [
  recipe("recipe-blind-raw", 1, "BlindRaw"),
  recipe("recipe-blind-raw", 2, "BlindRaw", { promptVersion: "blind-raw-v2", rubricAccess: true }),
  recipe("recipe-analysis-fed", 1, "AnalysisFed"),
  recipe("recipe-analysis-scores", 1, "AnalysisScores"),
  recipe("recipe-rubric-access", 1, "AnalysisFed", { rubricAccess: true }),
  recipe("recipe-verification", 1, "AnalysisScores", { verification: true }),
];

const POOLS: PoolManifestVersion[] = [
  manifest("pool-core-6", 1),
  manifest("pool-core-8-chall-2", 1, {
    core: [
      slot("s1", "a/m1"), slot("s2", "a/m2"), slot("s3", "b/m3"), slot("s4", "c/m4"),
      slot("s5", "d/m5"), slot("s6", "e/m6"), slot("s7", "f/m7"), slot("s8", "g/m8"),
    ],
    challengers: [slot("sc1", "h/m9"), slot("sc2", "i/m10")],
  }),
  manifest("pool-superseded", 1),
  manifest("pool-superseded", 2, { supersedesVersion: 1, rationale: "replaced challenger set" }),
];

const STUDIES: FusionStudy[] = [
  STUDY_EXPLORATION_COMPLETED,
  STUDY_EXPLORATION_INPROGRESS,
  STUDY_CONFIRMATION_COMPLETED,
  STUDY_DO_NOT_FUSE,
  STUDY_UNRESOLVED_OWNER,
];

// --- Source inventory (pinned for the characterization suite) ----------------
// The seven live Fusion stores, repository methods, controller methods, route
// branches, and UI actions. The characterization test asserts each is present
// on the current baseline so Milestone B migration can detect drift.

export const FUSION_STORE_NAMES = [
  "fusionRecipes",
  "poolManifests",
  "fusionStudies",
  "fusionTrials",
  "fusionAttempts",
  "fusionObservations",
  "fusionPlaybooks",
] as const;

export const FUSION_REPOSITORY_METHODS = [
  "createRecipe",
  "getRecipe",
  "getLatestRecipe",
  "listRecipes",
  "createPoolManifest",
  "getPoolManifest",
  "getLatestPoolManifest",
  "listPoolManifests",
  "createStudy",
  "updateStudy",
  "getStudy",
  "listStudies",
  "createTrial",
  "getTrial",
  "listTrials",
  "updateTrialLinks",
  "sealTrial",
  "recordTrialAttempt",
  "listTrialAttempts",
  "addObservation",
  "getObservation",
  "listObservations",
  "createPlaybook",
  "getPlaybook",
] as const;

export const FUSION_CONTROLLER_METHODS = [
  "createTrial",
  "attachChildren",
  "addCostEdge",
  "addHoldoutObservation",
  "rerunTreatment",
  "changeRecipe",
  "seal",
  "updateStudy",
] as const;

export const FUSION_ROUTE_BRANCHES = [
  "sets/:taskSetId/fusion/:studyId",
  ":suiteId/fusion/:studyId",
] as const;

export const FUSION_UI_ACTIONS = [
  "createStudy",
  "runStudy",
  "confirmStudy",
] as const;

export const FUSION_RECIPE_FAMILIES_IN_FIXTURE = [
  "BlindRaw",
  "AnalysisFed",
  "AnalysisScores",
] as const;

export const FUSION_POLICIES_IN_FIXTURE = [
  "best_fixed",
  "rank",
  "fuse",
  "refine",
] as const;

export const FUSION_STAGES_IN_FIXTURE = ["A", "B", "C"] as const;

export interface FusionCorpusFixture {
  recipes: FusionRecipeVersion[];
  pools: PoolManifestVersion[];
  studies: FusionStudy[];
  trials: FusionTrial[];
  attempts: FusionAttempt[];
  observations: EvaluationObservation[];
  playbooks: FusionPlaybook[];
  crosswalk: TaskSetOwnershipCrosswalkRow[];
  /** Recipe refs the studies pin (provenance-reconstruction evidence). */
  studyRecipeRefs: Record<string, FusionRecipeRef[]>;
  /** Studies whose Suite→Task Set owner is unresolved (kept on legacy route). */
  unresolvedOwnerStudyIds: string[];
}

export const FUSION_CORPUS_FIXTURE: FusionCorpusFixture = {
  recipes: RECIPES,
  pools: POOLS,
  studies: STUDIES,
  trials: TRIALS,
  attempts: ATTEMPTS,
  observations: OBSERVATIONS,
  playbooks: PLAYBOOKS,
  crosswalk: CROSSWALK_ROWS,
  studyRecipeRefs: {
    "study-exploration-completed": [
      { id: "recipe-analysis-fed", version: 1 },
      { id: "recipe-analysis-scores", version: 1 },
    ],
    "study-exploration-inprogress": [{ id: "recipe-analysis-fed", version: 1 }],
    "study-confirmation-completed": [{ id: "recipe-analysis-fed", version: 1 }],
    "study-do-not-fuse": [{ id: "recipe-analysis-fed", version: 1 }],
    "study-unresolved-owner": [{ id: "recipe-analysis-fed", version: 1 }],
  },
  unresolvedOwnerStudyIds: ["study-unresolved-owner"],
};
