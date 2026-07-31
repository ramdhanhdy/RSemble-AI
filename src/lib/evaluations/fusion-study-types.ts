// =============================================================================
// RSemble AI — Fusion Study domain types
//
// Fusion Studies turn the Rank/Fuse spine into an empirical decision engine
// (docs/specs/fusion-study/fusion-study-spec.md v2). This module holds the
// versioned records: fusion recipes, pool manifests, trials, treatment-changing
// attempts, measurement-only observations, studies, and playbooks.
//
// Invariants:
//  - Blindness has no field anywhere in this model — it is a product invariant,
//    not an experimental variable (spec §5.2, non-goal 8).
//  - Recipes, pool manifests, attempts, observations, and playbooks are
//    immutable on creation; trials are mutable only while `in_progress` and
//    become final on seal (spec §6.3).
//  - Trial vs Attempt rule (spec §6.2): a treatment-changing rerun creates a
//    new trial (new sampleIndex) linked by a FusionAttempt record; a
//    measurement-only retry creates an EvaluationObservation on the same trial.
// =============================================================================

import type { CriticRef } from "../providers/types";
import type { ModelSlot } from "../../studio-data";
import { isCriticRef, isModelSlot } from "./evaluation-types";
import {
  isNonBlankString,
  isPersistedError,
  isRecord,
  type PersistedError,
} from "../persistence/run-types";

export type { VerificationKind, TaskVerification } from "./evaluation-types";

// --- Recipes ------------------------------------------------------------------

export type FusionRecipeFamily = "BlindRaw" | "AnalysisFed" | "AnalysisScores";

export const FUSION_RECIPE_FAMILIES: readonly FusionRecipeFamily[] = [
  "BlindRaw",
  "AnalysisFed",
  "AnalysisScores",
];

/** What the synthesizer receives from the development judge (spec §5.2). */
export type JudgeAnalysisMode = "none" | "qualitative" | "scores";

export const JUDGE_ANALYSIS_MODES: readonly JudgeAnalysisMode[] = [
  "none",
  "qualitative",
  "scores",
];

/**
 * The recipe family IS the ablation over judge-analysis mode (spec §7.1):
 * BlindRaw ↔ none, AnalysisFed ↔ qualitative, AnalysisScores ↔ scores.
 */
export const FAMILY_ANALYSIS_MODE: Readonly<Record<FusionRecipeFamily, JudgeAnalysisMode>> = {
  BlindRaw: "none",
  AnalysisFed: "qualitative",
  AnalysisScores: "scores",
};

/**
 * A versioned fusion recipe (spec §5.2). `rubricAccess` and `verification` are
 * explicit booleans because rubric access is the decisive confound variable —
 * it must be declarable, not hidden in prompt text. Blindness is not a field:
 * candidates are always presented to the synthesizer anonymized.
 */
export interface FusionRecipeVersion {
  id: string;
  version: number;
  recipeFamily: FusionRecipeFamily;
  promptVersion: string;
  judgeAnalysisMode: JudgeAnalysisMode;
  /** Whether the synthesizer receives evaluator-only criteria and anchors. */
  rubricAccess: boolean;
  /** Whether the prompt includes verify-arithmetic/flag-unconfirmable instructions. */
  verification: boolean;
  synthesizer: CriticRef;
}

export interface FusionRecipeRef {
  id: string;
  version: number;
}

// --- Pool manifest ------------------------------------------------------------

/**
 * A frozen, versioned model pool (spec §5.6): 6–8 core models chosen for
 * failure-mode diversity plus 0–2 predeclared suite challengers (active pool
 * ≤ 10). Superseded explicitly, never calendar-refreshed.
 */
export interface PoolManifestVersion {
  id: string;
  version: number;
  core: ModelSlot[];
  challengers: ModelSlot[];
  diversityChecklist: string[];
  rationale: string;
  supersedesVersion: number | null;
  createdAt: number;
}

export interface PoolManifestRef {
  id: string;
  version: number;
}

// --- Snapshot refs --------------------------------------------------------------

export interface SuiteSnapshotRef {
  suiteId: string;
  suiteVersion: number;
  protocolFingerprint: string;
}

// --- Trials, attempts, observations -------------------------------------------

export type FusionStage = "A" | "B" | "C";

export const FUSION_STAGES: readonly FusionStage[] = ["A", "B", "C"];

export type FusionTrialStatus = "in_progress" | "sealed";

/** The candidate models participating in one treatment. */
export interface FusionCandidateConfig {
  slots: ModelSlot[];
}

/** Content-addressed synthesis artifact with full generation provenance. */
export interface FusionArtifactRef {
  runId: string;
  fusionAttemptId: string;
  contentHash: string;
}

/** Immutable child links assembled while the trial is in_progress. */
export interface FusionTrialChildren {
  candidateRunId: string | null;
  devJudgeRunId: string | null;
  synthesisArtifact: FusionArtifactRef | null;
}

export interface FusionTokenCost {
  tokensIn: number;
  tokensOut: number;
}

/**
 * Trial cost summary (spec §6.4): policy cost (what a clean successful
 * execution normally costs) reported separately from experimental cost
 * (observed, including retries and failures).
 */
export interface FusionTrialCost {
  policy: FusionTokenCost;
  experimental: FusionTokenCost;
}

/**
 * One treatment sample: immutable treatment spec + assembled child refs.
 * Sealing is final and runs the anti-circularity check (spec §5.3, §6.3).
 * A treatment-changing rerun (synthesis rerun, candidate regeneration) creates
 * a NEW FusionTrial with sampleIndex + 1, linked by a FusionAttempt record —
 * never a mutation of this record.
 *
 * `policy` distinguishes the four execution policies. Fuse trials carry the
 * recipe under test; refine trials carry the synthesizer (and MAY carry the
 * fusion recipe they mirror for confound provenance); rank and best-fixed
 * trials carry neither.
 */
export interface FusionTrial {
  id: string;
  revision: number;
  studyId: string;
  suiteRef: SuiteSnapshotRef;
  poolRef: PoolManifestRef;
  candidateConfig: FusionCandidateConfig;
  judge1: CriticRef;
  judge2: CriticRef;
  policy: FusionPolicyKind;
  recipe: FusionRecipeRef | null;
  /** The effective synthesizer/reviser for fuse and refine policies. */
  synthesizer: CriticRef | null;
  stage: FusionStage;
  sampleIndex: number;
  children: FusionTrialChildren;
  observationIds: string[];
  cost: FusionTrialCost;
  status: FusionTrialStatus;
  sealedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type FusionAttemptReason = "synthesis_rerun" | "candidate_regeneration";

export const FUSION_ATTEMPT_REASONS: readonly FusionAttemptReason[] = [
  "synthesis_rerun",
  "candidate_regeneration",
];

/**
 * A treatment-changing attempt (spec §6.2): links the superseded trial to its
 * successor. Immutable on creation. This is what separates a new sample from a
 * remeasurement — retry storms on the holdout never produce these.
 */
export interface FusionAttempt {
  id: string;
  studyId: string;
  /** Trial whose artifact was replaced. */
  fromTrialId: string;
  /** Successor trial carrying the rerun artifact (sampleIndex incremented). */
  toTrialId: string;
  reason: FusionAttemptReason;
  createdAt: number;
}

export type FusionObservationStatus = "completed" | "failed";

/**
 * A measurement-only observation on an unchanged artifact (spec §6.2): holdout
 * judge attempts, including second-judge observations. Created in terminal
 * state only — a failed holdout retry produces a NEW observation record, never
 * a mutation, so retry storms cannot inflate sample counts.
 */
export interface EvaluationObservation {
  id: string;
  trialId: string;
  /** The holdout judge used for this observation. */
  judge: CriticRef;
  /** The holdout evaluation run record, when one was persisted. */
  runId: string | null;
  status: FusionObservationStatus;
  /** Holdout score of the artifact when completed. */
  overallScore: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: PersistedError | null;
  startedAt: number;
  finishedAt: number;
}

// --- Verifier outcomes (spec §5.5) ----------------------------------------------

/**
 * Executed verifier output for one task × candidate. Binary co-failure metrics
 * may be computed ONLY from these records — never from rubric scores — and only
 * when the task's `verification.kind !== "none"`.
 */
export interface VerifierOutcome {
  taskId: string;
  /** Candidate model key (providerId:slug). */
  modelKey: string;
  passed: boolean;
  /** Wall-clock time the verifier executed. */
  executedAt: number;
}

// --- Stage results --------------------------------------------------------------

export type FusionPairStratum = "high" | "median" | "control";

export interface StageAPairResult {
  /** Pair of candidate model keys (providerId:slug). */
  pair: [string, string];
  stratum: FusionPairStratum;
  /** Holdout score per recipe family on this pair. */
  familyScores: Partial<Record<FusionRecipeFamily, number>>;
  /** Refine-the-winner control score on this pair. */
  refineWinnerScore: number | null;
}

/** Stage A eliminates; it never crowns. Exactly two families survive. */
export interface StageAResult {
  pairs: StageAPairResult[];
  survivors: FusionRecipeFamily[];
  eliminated: Array<{ family: FusionRecipeFamily; reason: string }>;
  completedAt: number;
}

export interface CriterionHeadroom {
  criterionId: string;
  headroom: number;
}

/** One row of the full screened-pair table — losers included (spec §7.2.3). */
export interface ScreenedPairRow {
  pair: [string, string];
  selectionHeadroom: number;
  synthesisHeadroom: number;
  perCriterionHeadroom: CriterionHeadroom[];
  /** Estimated policy cost multiplier relative to best-fixed. */
  costMultiplier: number;
  shortlisted: boolean;
}

export interface PoolAdequacyOutcome {
  probed: boolean;
  outcome: "confirmed" | "unconfirmed" | null;
  challengerKeys: string[];
  note: string;
}

/** Per-policy outcome on one shortlisted pair (blocked holdout evaluation). */
export interface StageBPolicyResult {
  pair: [string, string];
  policy: FusionPolicyKind;
  /** Human-readable configuration, e.g. "B + C → Synth X". */
  configuration: string;
  meanScore: number;
  /** Policy cost multiplier relative to best-fixed (policy cost, not experimental). */
  costMultiplier: number;
  perTaskScores: Array<{ taskId: string; score: number }>;
}

/** A predeclared finalist comparison against the MPID (spec §7.4). */
export interface StageBComparison {
  pair: [string, string];
  p: FusionPolicyKind;
  q: FusionPolicyKind;
  meanDelta: number;
  ciLow: number;
  ciHigh: number;
  wins: number;
  ties: number;
  losses: number;
  mpid: number;
  verdict: "adopt" | "not_justified" | "inconclusive";
}

export interface StageBResult {
  /** The complete screened-pair table (winner's-curse transparency). */
  screenedPairs: ScreenedPairRow[];
  /** The predeclared shortlist rule, recorded verbatim. */
  shortlistRule: string;
  shortlist: Array<[string, string]>;
  /** The recipe family frozen after sequential elimination. */
  frozenRecipe: FusionRecipeFamily | null;
  recipeEliminationLog: Array<{
    pairs: Array<[string, string]>;
    dropped: FusionRecipeFamily;
    reason: string;
  }>;
  poolAdequacy: PoolAdequacyOutcome;
  /** Blocked holdout results per policy per shortlisted pair. */
  policyResults: StageBPolicyResult[];
  /** Finalist paired comparisons vs the predeclared MPID. */
  comparisons: StageBComparison[];
  completedAt: number;
}

export interface StageCSpotCheck {
  pair: [string, string];
  runnerUpFamily: FusionRecipeFamily;
  /** True when the runner-up recipe overturned the Stage B ranking. */
  overturned: boolean;
  /** Flagged recipe-sensitive rankings are not presented as pair-quality results. */
  recipeSensitive: boolean;
}

export interface StageCResult {
  spotChecks: StageCSpotCheck[];
  synthesizerCross: Array<{
    pair: [string, string];
    recipe: FusionRecipeFamily;
    synthesizer: CriticRef;
    score: number;
  }>;
  completedAt: number;
}

export interface FusionStageResults {
  stageA: StageAResult | null;
  stageB: StageBResult | null;
  stageC: StageCResult | null;
}

// --- Study ----------------------------------------------------------------------

export type FusionStudyKind = "exploration" | "confirmation";

export type FusionClaimLevel = "exploratory" | "confirmed";

export type FusionStudyStatus = "in_progress" | "completed";

/**
 * A Fusion Study: an experiment type on a suite version (spec §6.1). Studies
 * carry two visibly different claim levels (spec §7.5): exploration studies are
 * always `exploratory`; confirmation studies evaluate a preselected
 * configuration on a fresh suite version WITHOUT re-selection and may promote
 * the claim to `confirmed` (or demote it).
 */
export interface FusionStudy {
  id: string;
  revision: number;
  kind: FusionStudyKind;
  suiteRef: SuiteSnapshotRef;
  poolRef: PoolManifestRef;
  judge1: CriticRef;
  judge2: CriticRef;
  /** The recipe set under test (frozen at study creation). */
  recipeRefs: FusionRecipeRef[];
  stageResults: FusionStageResults;
  playbookRef: string | null;
  claimLevel: FusionClaimLevel;
  /** Source exploratory study — required when kind === "confirmation". */
  confirmationOf: string | null;
  status: FusionStudyStatus;
  createdAt: number;
  updatedAt: number;
}

// --- Playbook -------------------------------------------------------------------

export type FusionPolicyKind = "best_fixed" | "rank" | "fuse" | "refine";

export const FUSION_POLICY_KINDS: readonly FusionPolicyKind[] = [
  "best_fixed",
  "rank",
  "fuse",
  "refine",
];

export type FusionConfidence = "high" | "medium" | "low";

export interface FusionPlaybookRow {
  policy: FusionPolicyKind;
  configuration: string;
  score: number;
  lift: number;
  costMultiplier: number;
  confidence: FusionConfidence;
}

/** "Do not fuse" is a first-class verdict, not a failure state (spec §8). */
export type FusionRecommendation =
  | { kind: "adopt"; policy: FusionPolicyKind; configuration: string; rationale: string }
  | { kind: "do_not_fuse"; rationale: string };

/**
 * The per-suite deliverable (spec §8): a policy comparison table with an
 * explicit claim level, a pool-adequacy qualifier, and a narrative conclusion.
 * Immutable once created.
 */
export interface FusionPlaybook {
  id: string;
  studyId: string;
  suiteRef: SuiteSnapshotRef;
  rows: FusionPlaybookRow[];
  recommendation: FusionRecommendation;
  poolAdequacy: PoolAdequacyOutcome;
  claimLevel: FusionClaimLevel;
  conclusion: string;
  createdAt: number;
}

// =============================================================================
// Runtime validators (type guards)
// =============================================================================

/** Keys that must never appear in a persisted fusion-study record. */
const PROHIBITED_KEYS: ReadonlySet<string> = new Set([
  "apiKey",
  "authorization",
  "token",
  "secret",
  "password",
  "env",
]);

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

function isFiniteNumber(v: unknown): v is number {
  return isNumber(v) && Number.isFinite(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function hasProhibitedKeys(v: unknown): boolean {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (hasProhibitedKeys(item)) return true;
    }
    return false;
  }
  if (isRecord(v)) {
    for (const key of Object.keys(v)) {
      if (PROHIBITED_KEYS.has(key)) return true;
      if (hasProhibitedKeys(v[key])) return true;
    }
  }
  return false;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

// --- Recipe / pool --------------------------------------------------------------

export function isFusionRecipeFamily(v: unknown): v is FusionRecipeFamily {
  return isString(v) && (FUSION_RECIPE_FAMILIES as readonly string[]).includes(v);
}

export function isJudgeAnalysisMode(v: unknown): v is JudgeAnalysisMode {
  return isString(v) && (JUDGE_ANALYSIS_MODES as readonly string[]).includes(v);
}

export function isFusionRecipeRef(v: unknown): v is FusionRecipeRef {
  return isRecord(v) && isNonEmptyString(v.id) && isNumber(v.version);
}

export function isPoolManifestRef(v: unknown): v is PoolManifestRef {
  return isRecord(v) && isNonEmptyString(v.id) && isNumber(v.version);
}

export function isFusionRecipeVersion(v: unknown): v is FusionRecipeVersion {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.version) || !Number.isInteger(v.version) || v.version < 1) return false;
  if (!isFusionRecipeFamily(v.recipeFamily)) return false;
  if (!isNonEmptyString(v.promptVersion)) return false;
  if (!isJudgeAnalysisMode(v.judgeAnalysisMode)) return false;
  if (!isBoolean(v.rubricAccess)) return false;
  if (!isBoolean(v.verification)) return false;
  if (!isCriticRef(v.synthesizer)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isPoolManifestVersion(v: unknown): v is PoolManifestVersion {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.version) || !Number.isInteger(v.version) || v.version < 1) return false;
  if (!Array.isArray(v.core) || !v.core.every(isModelSlot)) return false;
  if (!Array.isArray(v.challengers) || !v.challengers.every(isModelSlot)) return false;
  if (!isStringArray(v.diversityChecklist)) return false;
  if (!isString(v.rationale)) return false;
  if (v.supersedesVersion !== null && !isNumber(v.supersedesVersion)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isSuiteSnapshotRef(v: unknown): v is SuiteSnapshotRef {
  return (
    isRecord(v) &&
    isNonEmptyString(v.suiteId) &&
    isNumber(v.suiteVersion) &&
    isNonEmptyString(v.protocolFingerprint)
  );
}

// --- Trial / attempt / observation ----------------------------------------------

export function isFusionStage(v: unknown): v is FusionStage {
  return isString(v) && (FUSION_STAGES as readonly string[]).includes(v);
}

export function isFusionCandidateConfig(v: unknown): v is FusionCandidateConfig {
  return isRecord(v) && Array.isArray(v.slots) && v.slots.every(isModelSlot);
}

export function isFusionArtifactRef(v: unknown): v is FusionArtifactRef {
  return (
    isRecord(v) &&
    isNonEmptyString(v.runId) &&
    isNonEmptyString(v.fusionAttemptId) &&
    isNonEmptyString(v.contentHash)
  );
}

export function isFusionTrialChildren(v: unknown): v is FusionTrialChildren {
  if (!isRecord(v)) return false;
  if (v.candidateRunId !== null && !isString(v.candidateRunId)) return false;
  if (v.devJudgeRunId !== null && !isString(v.devJudgeRunId)) return false;
  if (v.synthesisArtifact !== null && !isFusionArtifactRef(v.synthesisArtifact)) return false;
  return true;
}

export function isFusionTokenCost(v: unknown): v is FusionTokenCost {
  return isRecord(v) && isFiniteNumber(v.tokensIn) && isFiniteNumber(v.tokensOut);
}

export function isFusionTrialCost(v: unknown): v is FusionTrialCost {
  return isRecord(v) && isFusionTokenCost(v.policy) && isFusionTokenCost(v.experimental);
}

export function isFusionTrial(v: unknown): v is FusionTrial {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (!isNonEmptyString(v.studyId)) return false;
  if (!isSuiteSnapshotRef(v.suiteRef)) return false;
  if (!isPoolManifestRef(v.poolRef)) return false;
  if (!isFusionCandidateConfig(v.candidateConfig)) return false;
  if (!isCriticRef(v.judge1)) return false;
  if (!isCriticRef(v.judge2)) return false;
  if (!isString(v.policy) || !(FUSION_POLICY_KINDS as readonly string[]).includes(v.policy)) {
    return false;
  }
  if (v.recipe !== null && !isFusionRecipeRef(v.recipe)) return false;
  if (v.synthesizer !== null && !isCriticRef(v.synthesizer)) return false;
  // Policy/ref consistency: fuse requires recipe + synthesizer; refine
  // requires the reviser (recipe optional for confound provenance); rank and
  // best-fixed carry neither.
  if (v.policy === "fuse" && (v.recipe === null || v.synthesizer === null)) return false;
  if (v.policy === "refine" && v.synthesizer === null) return false;
  if ((v.policy === "rank" || v.policy === "best_fixed") && (v.recipe !== null || v.synthesizer !== null)) {
    return false;
  }
  if (!isFusionStage(v.stage)) return false;
  if (!isNumber(v.sampleIndex) || !Number.isInteger(v.sampleIndex) || v.sampleIndex < 0) {
    return false;
  }
  if (!isFusionTrialChildren(v.children)) return false;
  if (!isStringArray(v.observationIds)) return false;
  if (!isFusionTrialCost(v.cost)) return false;
  if (v.status !== "in_progress" && v.status !== "sealed") return false;
  if (v.sealedAt !== null && !isNumber(v.sealedAt)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isFusionAttemptReason(v: unknown): v is FusionAttemptReason {
  return isString(v) && (FUSION_ATTEMPT_REASONS as readonly string[]).includes(v);
}

export function isFusionAttempt(v: unknown): v is FusionAttempt {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNonEmptyString(v.studyId)) return false;
  if (!isNonEmptyString(v.fromTrialId)) return false;
  if (!isNonEmptyString(v.toTrialId)) return false;
  if (!isFusionAttemptReason(v.reason)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isEvaluationObservation(v: unknown): v is EvaluationObservation {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNonEmptyString(v.trialId)) return false;
  if (!isCriticRef(v.judge)) return false;
  if (v.runId !== null && !isString(v.runId)) return false;
  if (v.status !== "completed" && v.status !== "failed") return false;
  if (v.overallScore !== null && !isFiniteNumber(v.overallScore)) return false;
  if (v.tokensIn !== null && !isFiniteNumber(v.tokensIn)) return false;
  if (v.tokensOut !== null && !isFiniteNumber(v.tokensOut)) return false;
  if (v.error !== null && !isPersistedError(v.error)) return false;
  if (!isNumber(v.startedAt)) return false;
  if (!isNumber(v.finishedAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isVerifierOutcome(v: unknown): v is VerifierOutcome {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.taskId)) return false;
  if (!isNonBlankString(v.modelKey)) return false;
  if (!isBoolean(v.passed)) return false;
  if (!isNumber(v.executedAt)) return false;
  return true;
}

// --- Stage results ----------------------------------------------------------------

function isPair(v: unknown): v is [string, string] {
  return Array.isArray(v) && v.length === 2 && isNonEmptyString(v[0]) && isNonEmptyString(v[1]);
}

function isFamilyScoreMap(v: unknown): v is Partial<Record<FusionRecipeFamily, number>> {
  if (!isRecord(v)) return false;
  for (const [key, value] of Object.entries(v)) {
    if (!isFusionRecipeFamily(key)) return false;
    if (!isFiniteNumber(value)) return false;
  }
  return true;
}

export function isStageAPairResult(v: unknown): v is StageAPairResult {
  if (!isRecord(v)) return false;
  if (!isPair(v.pair)) return false;
  if (v.stratum !== "high" && v.stratum !== "median" && v.stratum !== "control") return false;
  if (!isFamilyScoreMap(v.familyScores)) return false;
  if (v.refineWinnerScore !== null && !isFiniteNumber(v.refineWinnerScore)) return false;
  return true;
}

export function isStageAResult(v: unknown): v is StageAResult {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.pairs) || !v.pairs.every(isStageAPairResult)) return false;
  if (!Array.isArray(v.survivors) || !v.survivors.every(isFusionRecipeFamily)) return false;
  if (
    !Array.isArray(v.eliminated) ||
    !v.eliminated.every(
      (e) => isRecord(e) && isFusionRecipeFamily(e.family) && isString(e.reason),
    )
  ) {
    return false;
  }
  if (!isNumber(v.completedAt)) return false;
  return true;
}

export function isCriterionHeadroom(v: unknown): v is CriterionHeadroom {
  return isRecord(v) && isNonEmptyString(v.criterionId) && isFiniteNumber(v.headroom);
}

export function isScreenedPairRow(v: unknown): v is ScreenedPairRow {
  if (!isRecord(v)) return false;
  if (!isPair(v.pair)) return false;
  if (!isFiniteNumber(v.selectionHeadroom)) return false;
  if (!isFiniteNumber(v.synthesisHeadroom)) return false;
  if (!Array.isArray(v.perCriterionHeadroom) || !v.perCriterionHeadroom.every(isCriterionHeadroom)) {
    return false;
  }
  if (!isFiniteNumber(v.costMultiplier)) return false;
  if (!isBoolean(v.shortlisted)) return false;
  return true;
}

export function isPoolAdequacyOutcome(v: unknown): v is PoolAdequacyOutcome {
  if (!isRecord(v)) return false;
  if (!isBoolean(v.probed)) return false;
  if (v.outcome !== null && v.outcome !== "confirmed" && v.outcome !== "unconfirmed") return false;
  if (!isStringArray(v.challengerKeys)) return false;
  if (!isString(v.note)) return false;
  return true;
}

export function isStageBResult(v: unknown): v is StageBResult {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.screenedPairs) || !v.screenedPairs.every(isScreenedPairRow)) return false;
  if (!isString(v.shortlistRule)) return false;
  if (!Array.isArray(v.shortlist) || !v.shortlist.every(isPair)) return false;
  if (v.frozenRecipe !== null && !isFusionRecipeFamily(v.frozenRecipe)) return false;
  if (
    !Array.isArray(v.recipeEliminationLog) ||
    !v.recipeEliminationLog.every(
      (e) =>
        isRecord(e) &&
        Array.isArray(e.pairs) &&
        e.pairs.every(isPair) &&
        isFusionRecipeFamily(e.dropped) &&
        isString(e.reason),
    )
  ) {
    return false;
  }
  if (!isPoolAdequacyOutcome(v.poolAdequacy)) return false;
  if (!Array.isArray(v.policyResults) || !v.policyResults.every(isStageBPolicyResult)) return false;
  if (!Array.isArray(v.comparisons) || !v.comparisons.every(isStageBComparison)) return false;
  if (!isNumber(v.completedAt)) return false;
  return true;
}

export function isStageBPolicyResult(v: unknown): v is StageBPolicyResult {
  if (!isRecord(v)) return false;
  if (!isPair(v.pair)) return false;
  if (!isString(v.policy) || !(FUSION_POLICY_KINDS as readonly string[]).includes(v.policy)) {
    return false;
  }
  if (!isString(v.configuration)) return false;
  if (!isFiniteNumber(v.meanScore)) return false;
  if (!isFiniteNumber(v.costMultiplier)) return false;
  if (
    !Array.isArray(v.perTaskScores) ||
    !v.perTaskScores.every((e) => isRecord(e) && isNonEmptyString(e.taskId) && isFiniteNumber(e.score))
  ) {
    return false;
  }
  return true;
}

export function isStageBComparison(v: unknown): v is StageBComparison {
  if (!isRecord(v)) return false;
  if (!isPair(v.pair)) return false;
  if (!isString(v.p) || !(FUSION_POLICY_KINDS as readonly string[]).includes(v.p)) return false;
  if (!isString(v.q) || !(FUSION_POLICY_KINDS as readonly string[]).includes(v.q)) return false;
  if (!isFiniteNumber(v.meanDelta)) return false;
  if (!isFiniteNumber(v.ciLow)) return false;
  if (!isFiniteNumber(v.ciHigh)) return false;
  if (!isNumber(v.wins) || !isNumber(v.ties) || !isNumber(v.losses)) return false;
  if (!isFiniteNumber(v.mpid)) return false;
  if (v.verdict !== "adopt" && v.verdict !== "not_justified" && v.verdict !== "inconclusive") {
    return false;
  }
  return true;
}

export function isStageCSpotCheck(v: unknown): v is StageCSpotCheck {
  if (!isRecord(v)) return false;
  if (!isPair(v.pair)) return false;
  if (!isFusionRecipeFamily(v.runnerUpFamily)) return false;
  if (!isBoolean(v.overturned)) return false;
  if (!isBoolean(v.recipeSensitive)) return false;
  return true;
}

export function isStageCResult(v: unknown): v is StageCResult {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.spotChecks) || !v.spotChecks.every(isStageCSpotCheck)) return false;
  if (
    !Array.isArray(v.synthesizerCross) ||
    !v.synthesizerCross.every(
      (e) =>
        isRecord(e) &&
        isPair(e.pair) &&
        isFusionRecipeFamily(e.recipe) &&
        isCriticRef(e.synthesizer) &&
        isFiniteNumber(e.score),
    )
  ) {
    return false;
  }
  if (!isNumber(v.completedAt)) return false;
  return true;
}

export function isFusionStageResults(v: unknown): v is FusionStageResults {
  if (!isRecord(v)) return false;
  if (v.stageA !== null && !isStageAResult(v.stageA)) return false;
  if (v.stageB !== null && !isStageBResult(v.stageB)) return false;
  if (v.stageC !== null && !isStageCResult(v.stageC)) return false;
  return true;
}

// --- Study / playbook --------------------------------------------------------------

export function isFusionStudy(v: unknown): v is FusionStudy {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (v.kind !== "exploration" && v.kind !== "confirmation") return false;
  if (!isSuiteSnapshotRef(v.suiteRef)) return false;
  if (!isPoolManifestRef(v.poolRef)) return false;
  if (!isCriticRef(v.judge1)) return false;
  if (!isCriticRef(v.judge2)) return false;
  if (!Array.isArray(v.recipeRefs) || !v.recipeRefs.every(isFusionRecipeRef)) return false;
  if (!isFusionStageResults(v.stageResults)) return false;
  if (v.playbookRef !== null && !isString(v.playbookRef)) return false;
  if (v.claimLevel !== "exploratory" && v.claimLevel !== "confirmed") return false;
  if (v.confirmationOf !== null && !isString(v.confirmationOf)) return false;
  if (v.status !== "in_progress" && v.status !== "completed") return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isFusionPlaybookRow(v: unknown): v is FusionPlaybookRow {
  if (!isRecord(v)) return false;
  if (!isString(v.policy) || !(FUSION_POLICY_KINDS as readonly string[]).includes(v.policy)) {
    return false;
  }
  if (!isString(v.configuration)) return false;
  if (!isFiniteNumber(v.score)) return false;
  if (!isFiniteNumber(v.lift)) return false;
  if (!isFiniteNumber(v.costMultiplier)) return false;
  if (v.confidence !== "high" && v.confidence !== "medium" && v.confidence !== "low") return false;
  return true;
}

export function isFusionRecommendation(v: unknown): v is FusionRecommendation {
  if (!isRecord(v)) return false;
  if (v.kind === "adopt") {
    return (
      isString(v.policy) &&
      (FUSION_POLICY_KINDS as readonly string[]).includes(v.policy) &&
      isString(v.configuration) &&
      isString(v.rationale)
    );
  }
  if (v.kind === "do_not_fuse") {
    return isString(v.rationale);
  }
  return false;
}

export function isFusionPlaybook(v: unknown): v is FusionPlaybook {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNonEmptyString(v.studyId)) return false;
  if (!isSuiteSnapshotRef(v.suiteRef)) return false;
  if (!Array.isArray(v.rows) || !v.rows.every(isFusionPlaybookRow)) return false;
  if (!isFusionRecommendation(v.recommendation)) return false;
  if (!isPoolAdequacyOutcome(v.poolAdequacy)) return false;
  if (v.claimLevel !== "exploratory" && v.claimLevel !== "confirmed") return false;
  if (!isString(v.conclusion)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}
