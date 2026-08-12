// =============================================================================
// RSemble AI — Evaluation domain types
//
// Evaluation profiles (criteria + 1/3/5 anchors), suites (tasks + model slots),
// and experiment records that orchestrate repeated runs across a suite.
//
// Validation rules (see workbench plan):
//  - Profile validation requires 1/3/5 anchors and at least one positive weight
//    when non-holistic
//  - Task evaluation validation distinguishes inherit, holistic, and
//    pinned-profile selections without nullable inference
//  - Suite RECORDS validate structurally (non-empty name, valid task objects);
//    execution preconditions (≥1 task, ≥2 enabled unique model keys, ready
//    judge) live in validateSuiteForExecution — incomplete drafts are saveable
//  - Profile archive state validates only on mutable ProfileRecord, never on
//    immutable EvaluationProfile versions
// =============================================================================

import type { CriticRef, ReasoningEffort, ReasoningPolicy } from "../providers/types";
import type { ModelSlot } from "../../studio-data";
import {
  isExecutionFence,
  isNonBlankString,
  isPersistedError,
  type ExecutionFence,
  type FullRunSummaryV2,
  type PersistedError,
  type RunRecordV2,
} from "../persistence/run-types";

// --- Profiles -----------------------------------------------------------------

// --- Criterion domain model (hybrid: graded + binary + legacy) ----------------

export interface EvaluationCriterionBase {
  id: string;
  name: string;
  description: string;
}

/** Explicit graded criterion with five authored anchors and integer 1–5 scoring. */
export interface GradedEvaluationCriterion extends EvaluationCriterionBase {
  kind: "graded";
  weight: number; // > 0 for new criteria
  anchors: {
    one: string;
    two: string;
    three: string;
    four: string;
    five: string;
  };
}

/** Binary check with authored true/false conditions. No criterion-level weight —
 *  the weight lives on its RequirementGroup. */
export interface BinaryEvaluationCriterion extends EvaluationCriterionBase {
  kind: "binary";
  trueWhen: string;
  falseWhen: string;
}

/** Legacy 1/3/5 criterion (kind undefined). Must remain readable; never rewritten. */
export interface LegacyGradedEvaluationCriterion extends EvaluationCriterionBase {
  kind?: undefined;
  weight: number;
  anchors: { one: string; three: string; five: string };
}

export type EvaluationCriterion =
  GradedEvaluationCriterion | BinaryEvaluationCriterion | LegacyGradedEvaluationCriterion;

// --- Requirement Groups (binary-channel weighting) ---------------------------

export interface RequirementGroup {
  id: string;
  name: string;
  checkIds: string[]; // exactly-one membership; length >= 1; all must resolve to binary checks
  weight: number; // v_g > 0 — the sole binary-channel weight
  mode: "ALL"; // only mode in v1; MEAN is deferred
}

/**
 * Optional authored criterion-to-facet mapping (rubric-terminology spec §5.3).
 *
 * Disclosed evidence metadata only — never consumed by scoring math, never
 * used to infer mappings, and never used to authorize model-profile
 * aggregation. Child 06 decides how authored mappings are consumed. The
 * field may remain empty; unmapped criteria stay visible and cannot silently
 * power facet-level claims.
 */
export interface CriterionFacetMapping {
  criterionId: string;
  facetId: string;
  mappingKind: "direct" | "supporting";
  source: "authored" | "imported";
}

/**
 * Canonical scoring rubric: an immutable versioned set of criteria (graded,
 * binary, or legacy 1/3/5) plus optional requirement groups and compliance
 * influence. This is the canonical domain name for the scoring object
 * historically called an "evaluation profile". Persisted field and store names
 * (`evaluationProfileId`, `profiles`, `profileVersions`) are frozen and
 * unchanged; only the domain type name is canonicalized.
 */
export interface EvaluationRubric {
  id: string;
  version: number;
  name: string;
  description: string;
  judgeInstruction: string;
  criteria: EvaluationCriterion[];
  /** Binary requirement groups; absent for legacy/graded-only rubrics. */
  requirementGroups?: RequirementGroup[];
  /** Compliance influence (lambda) in [0,1], default 1.0. "Maximum number of
   *  ranking points that failing all ordinary compliance requirements may cost." */
  complianceInfluence?: number;
  /** Optional authored criterion-to-facet mapping metadata (spec §5.3).
   *  Disclosed evidence metadata — never consumed by scoring math. May remain
   *  empty; child 06 decides how authored mappings are consumed. */
  facetMappings?: CriterionFacetMapping[];
  createdAt: number;
  updatedAt: number;
}

/** Canonical alias for a rubric snapshot embedded in run/experiment provenance. */
export type RubricSnapshot = EvaluationRubric;

/** Canonical persisted rubric record. Mutable archive state lives here; the
 *  immutable rubric versions are stored separately. */
export interface RubricRecord {
  id: string;
  revision: number;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

/** Canonical reference to an immutable rubric version. */
export interface RubricVersionRef {
  id: string;
  version: number;
}

// --- Legacy aliases (deprecated) ---------------------------------------------
// Canonical names above are the primary domain surface. The legacy names below
// remain importable from this module only because `evaluation-repository.ts`
// (migrated in a later task) still references them; new domain code MUST import
// the canonical names. The explicit deprecated re-export surface lives in
// `rubric-compat.ts`. Remove these aliases once all consumers migrate.

/** @deprecated Use `EvaluationRubric`. Legacy alias for the scoring rubric. */
export type EvaluationProfile = EvaluationRubric;

/** @deprecated Use `RubricSnapshot`. Legacy alias for a rubric snapshot. */
export type EvaluationProfileSnapshot = RubricSnapshot;

/** @deprecated Use `RubricRecord`. Legacy alias for a persisted rubric record. */
export type ProfileRecord = RubricRecord;

/** @deprecated Use `RubricVersionRef`. Legacy alias for a rubric version ref. */
export type EvaluationProfileRef = RubricVersionRef;

export type EvaluationSelection =
  { kind: "holistic" } | { kind: "profile"; profile: RubricVersionRef };

export type TaskEvaluationSelection = { kind: "inherit" } | EvaluationSelection;

// --- Tasks / suites -----------------------------------------------------------

/**
 * Verifier-derived determinism (fusion-study spec §5.5): deterministic
 * correctness is a property of whether a task has an external verifier, never
 * a user toggle over rubric scores. Task-level only in v1.
 */
export type VerificationKind =
  "none" | "exact_match" | "numeric" | "schema" | "unit_tests" | "custom_checker";

export const VERIFICATION_KINDS: readonly VerificationKind[] = [
  "none",
  "exact_match",
  "numeric",
  "schema",
  "unit_tests",
  "custom_checker",
];

export interface TaskVerification {
  kind: VerificationKind;
}

export interface EvaluationTask {
  id: string;
  title: string;
  prompt: string;
  systemPrompt: string;
  evaluation: TaskEvaluationSelection;
  judgeInstructionOverride: string;
  order: number;
  /** External verifier configuration; absent or kind "none" = rubric-only. */
  verification?: TaskVerification;
}

export interface EvaluationSuite {
  id: string;
  revision: number;
  version: number;
  name: string;
  description: string;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  defaultJudge: CriticRef;
  defaultEvaluation: EvaluationSelection;
  /** Optional for backward compatibility; absent means provider-default. */
  reasoningPolicy?: ReasoningPolicy;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

// --- Experiments --------------------------------------------------------------

export interface ExperimentTaskAttempt {
  id: string;
  runId: string | null;
  trial: number;
  status: "queued" | "running" | "completed" | "partial" | "failed" | "aborted" | "interrupted";
  startedAt: number | null;
  finishedAt: number | null;
  error: PersistedError | null;
  /** Scored-model coverage for coverage-aware attempt selection (spec §11.5). */
  coverage?: ExperimentAttemptCoverage;
  /** Compound repair metadata for auditable targeted repairs (spec §11.4). */
  repair?: ExperimentTaskExecutionPlan;
}

export interface ExperimentAttemptCoverage {
  scoredModelKeys: string[];
  totalModels: number;
}

export interface ExperimentRepairPlan {
  kind: "missing-cells";
  baseRunId: string;
  requestedModelKeys: string[];
}

/** Roster-extension attempt provenance (spec §6.4). Rides the persisted
 *  `repair` field on attempts and run sources; the `kind` discriminant is
 *  load-bearing. Never derive user-visible "repair" wording from the field
 *  name. */
export interface ExperimentRosterExtensionPlan {
  kind: "roster-extension";
  /** Model key `providerId:slug` of the added model. */
  addedModelKey: string;
  /** Selected attempt run that supplied the reused outputs for this task,
   *  when the compound path was taken. Absent on full-roster fallback. */
  baseRunId?: string;
}

/** Persisted execution-plan discriminant on queued/terminal attempts. The
 *  property name `repair` is legacy persisted schema kept for compatibility;
 *  branch on `kind` for behavior and copy. */
export type ExperimentTaskExecutionPlan = ExperimentRepairPlan | ExperimentRosterExtensionPlan;

/** Append-only extension history entry (spec §6.5). */
export interface ExperimentRosterExtension {
  addedModelKey: string;
  /** The exact appended slot (stable id shared with the suite, spec §8). */
  addedSlot: ModelSlot;
  /** Snapshot fingerprint before this extension. */
  priorFingerprint: string;
  /** Epoch ms. */
  extendedAt: number;
}

export interface ExperimentTaskState {
  taskId: string;
  selectedAttemptId: string | null;
  attempts: ExperimentTaskAttempt[];
}

export interface ExperimentSnapshot {
  suiteId: string;
  suiteVersion: number;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  defaultJudge: CriticRef;
  defaultEvaluation: EvaluationSelection;
  /** Optional for imported pre-policy snapshots. */
  reasoningPolicy?: ReasoningPolicy;
  profiles: RubricSnapshot[];
  protocolFingerprint: string;
  createdAt: number;
}

export interface ExperimentRecord {
  id: string;
  revision: number;
  suiteId: string;
  suiteVersion: number;
  protocolFingerprint: string;
  status:
    | "draft"
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "completed_with_failures"
    | "aborted"
    | "interrupted";
  execution: ExecutionFence | null;
  snapshot: ExperimentSnapshot;
  tasks: ExperimentTaskState[];
  createdAt: number;
  updatedAt: number;
  /** Append-only model-addition history (spec §6.5); absent for records
   *  created before roster extension existed. */
  rosterExtensions?: ExperimentRosterExtension[];
}

// --- Experiment task orchestration inputs -------------------------------------

export interface BeginExperimentTaskInput {
  experimentId: string;
  taskId: string;
  attemptId: string;
  run: RunRecordV2;
  summary: FullRunSummaryV2;
  expectedExperimentRevision: number;
  /** When present, the write verifies the current unexpired lease carries
   *  exactly this { ownerId, fence } inside the same transaction (spec §5.6). */
  fence?: ExecutionFence;
}

export interface CommitExperimentTaskTerminalInput {
  experimentId: string;
  taskId: string;
  attemptId: string;
  run: RunRecordV2;
  summary: FullRunSummaryV2;
  expectedRunRevision: number;
  expectedExperimentRevision: number;
  /** When present, verified against the current lease in-transaction. */
  fence?: ExecutionFence;
  /** Scored-model coverage persisted on the terminal attempt (spec §11.5). */
  coverage?: ExperimentAttemptCoverage;
  /** Compound repair metadata persisted on the terminal attempt (spec §11.4). */
  repair?: ExperimentTaskExecutionPlan;
}

// =============================================================================
// Runtime validators (type guards)
// =============================================================================

const EXPERIMENT_TASK_STATUSES: readonly string[] = [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "aborted",
  "interrupted",
];

const EXPERIMENT_STATUSES: readonly string[] = [
  "draft",
  "queued",
  "running",
  "paused",
  "completed",
  "completed_with_failures",
  "aborted",
  "interrupted",
];

/** Keys that must never appear in a persisted evaluation record. */
const PROHIBITED_KEYS: ReadonlySet<string> = new Set([
  "apiKey",
  "authorization",
  "token",
  "secret",
  "password",
  "env",
]);

/** String values that must never appear in an authored identifier field —
 *  matches the credential-shape check used for roster-extension model keys
 *  (see `experiment-roster-extension.ts`). Used to reject secret-shaped
 *  criterion/facet mapping values before they are persisted. */
const CREDENTIAL_LIKE_VALUE = /^(sk-|AIza|Bearer\s)/i;

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = [
  "provider-default",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && REASONING_EFFORT_VALUES.includes(value as ReasoningEffort);
}

export function isReasoningPolicy(value: unknown): value is ReasoningPolicy {
  return isRecord(value) && isReasoningEffort(value.candidates) && isReasoningEffort(value.judge);
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

// --- Profile / criterion ------------------------------------------------------

// --- Kind-aware type guards ---------------------------------------------------

/** Legacy graded criterion (kind undefined, 1/3/5 anchors, numeric weight). */
export function isLegacyGradedEvaluationCriterion(
  v: unknown,
): v is LegacyGradedEvaluationCriterion {
  if (!isRecord(v)) return false;
  if (v.kind !== undefined) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!isNumber(v.weight) || !Number.isFinite(v.weight) || v.weight < 0) return false;
  const anchors = v.anchors;
  if (
    !isRecord(anchors) ||
    !isNonEmptyString(anchors.one) ||
    !isNonEmptyString(anchors.three) ||
    !isNonEmptyString(anchors.five)
  ) {
    return false;
  }
  return true;
}

/** Explicit graded criterion (kind "graded", five anchors, positive weight). */
export function isGradedEvaluationCriterion(v: unknown): v is GradedEvaluationCriterion {
  if (!isRecord(v)) return false;
  if (v.kind !== "graded") return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!isNumber(v.weight) || !Number.isFinite(v.weight) || v.weight < 0) return false;
  const anchors = v.anchors;
  if (
    !isRecord(anchors) ||
    !isNonEmptyString(anchors.one) ||
    !isNonEmptyString(anchors.two) ||
    !isNonEmptyString(anchors.three) ||
    !isNonEmptyString(anchors.four) ||
    !isNonEmptyString(anchors.five)
  ) {
    return false;
  }
  return true;
}

/** Binary check (kind "binary", trueWhen/falseWhen, no criterion-level weight). */
export function isBinaryEvaluationCriterion(v: unknown): v is BinaryEvaluationCriterion {
  if (!isRecord(v)) return false;
  if (v.kind !== "binary") return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!isNonEmptyString(v.trueWhen)) return false;
  if (!isNonEmptyString(v.falseWhen)) return false;
  // Criterion-level weight is forbidden on binary checks in v1 — the weight
  // lives on the RequirementGroup only.
  if (v.weight !== undefined) return false;
  return true;
}

/** Union guard: accepts legacy, graded, and binary criteria. Rejects "gate". */
export function isEvaluationCriterion(v: unknown): v is EvaluationCriterion {
  return (
    isLegacyGradedEvaluationCriterion(v) ||
    isGradedEvaluationCriterion(v) ||
    isBinaryEvaluationCriterion(v)
  );
}

/** Guard for RequirementGroup (v_g > 0, mode "ALL", non-empty checkIds). */
export function isRequirementGroup(v: unknown): v is RequirementGroup {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isString(v.name)) return false;
  if (!Array.isArray(v.checkIds) || v.checkIds.length === 0) return false;
  if (!v.checkIds.every((id: unknown): id is string => isNonEmptyString(id))) return false;
  if (!isNumber(v.weight) || !Number.isFinite(v.weight) || v.weight <= 0) return false;
  if (v.mode !== "ALL") return false;
  return true;
}

/** Structural guard for a single CriterionFacetMapping (spec §5.3).
 *  Checks field types and enum values only; cross-field references
 *  (criterionId ∈ rubric.criteria, duplicate tuples, secret-shaped values)
 *  are enforced by `isEvaluationRubric` / `validateRubric`, which have the
 *  rubric context required to evaluate them. */
export function isCriterionFacetMapping(v: unknown): v is CriterionFacetMapping {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.criterionId)) return false;
  if (!isNonEmptyString(v.facetId)) return false;
  if (v.mappingKind !== "direct" && v.mappingKind !== "supporting") return false;
  if (v.source !== "authored" && v.source !== "imported") return false;
  return true;
}

export function isEvaluationRubric(v: unknown): v is EvaluationRubric {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.version)) return false;
  if (!isString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!isString(v.judgeInstruction)) return false;
  if (!Array.isArray(v.criteria) || !v.criteria.every(isEvaluationCriterion)) {
    return false;
  }
  // Reject reserved "gate" kind with an actionable message is handled at
  // validateProfile (authoring boundary). Here we simply reject unknown kinds.
  // Empty criteria denotes holistic mode (valid — see validateProfile and
  // judgeEvaluationBlock); non-empty profiles must score something.
  const isHolistic = v.criteria.length === 0;
  if (!isHolistic) {
    // At least one positive-weight graded/legacy criterion OR at least one
    // requirement group — otherwise the profile scores nothing.
    const hasPositiveGraded = v.criteria.some(
      (c) =>
        isRecord(c) &&
        isNumber(c.weight) &&
        c.weight > 0 &&
        (c.kind === "graded" || c.kind === undefined),
    );
    const hasGroups = Array.isArray(v.requirementGroups) && v.requirementGroups.length > 0;
    if (!hasPositiveGraded && !hasGroups) return false;
  }

  // Validate requirement groups if present. A profile carrying binary checks
  // but NO requirementGroups field is invalid (spec §19: every binary check
  // belongs to exactly one ALL-mode group) — validation must not be skipped
  // just because the field is undefined (CodeRabbit 4890236254).
  const hasBinaryCriteria = v.criteria.some((c) => c.kind === "binary");
  if (v.requirementGroups === undefined && hasBinaryCriteria) return false;
  if (v.requirementGroups !== undefined) {
    if (!Array.isArray(v.requirementGroups) || !v.requirementGroups.every(isRequirementGroup)) {
      return false;
    }
    // Semantic membership (spec §19): every checkId resolves to a binary check,
    // no check appears in two groups, and every binary check is assigned to
    // exactly one group. An imported profile violating these invariants could
    // silently drop compliance deductions, so the runtime guard must reject it.
    const binaryIds = new Set(v.criteria.filter(isBinaryEvaluationCriterion).map((c) => c.id));
    const assigned = new Set<string>();
    for (const g of v.requirementGroups) {
      for (const checkId of g.checkIds) {
        if (!binaryIds.has(checkId)) return false; // missing or non-binary reference
        if (assigned.has(checkId)) return false; // same check in multiple groups
        assigned.add(checkId);
      }
    }
    for (const c of v.criteria) {
      if (c.kind === "binary" && !assigned.has(c.id)) return false; // ungrouped binary
    }
  }

  // Validate complianceInfluence if present (lambda in [0,1]).
  if (v.complianceInfluence !== undefined) {
    if (
      !isNumber(v.complianceInfluence) ||
      !Number.isFinite(v.complianceInfluence) ||
      v.complianceInfluence < 0 ||
      v.complianceInfluence > 1
    ) {
      return false;
    }
  }

  // Validate optional criterion-to-facet mappings (spec §5.3). Disclosed
  // evidence metadata only — never consumed by scoring math. The runtime
  // guard enforces the same invariants as `validateRubric` so an imported
  // rubric carrying malformed mappings cannot silently pass the guard.
  if (v.facetMappings !== undefined) {
    if (!Array.isArray(v.facetMappings) || !v.facetMappings.every(isCriterionFacetMapping)) {
      return false;
    }
    const criterionIds = new Set(v.criteria.map((c) => c.id));
    const seen = new Set<string>();
    for (const m of v.facetMappings) {
      // Missing criterion: criterionId must reference an existing criterion.
      if (!criterionIds.has(m.criterionId)) return false;
      // Missing facet: facetId must be non-empty (structural guard already
      // enforces this; kept defensive against future relaxation).
      if (!m.facetId) return false;
      // Duplicate mapping: the same (criterionId, facetId, mappingKind) tuple
      // may not appear twice.
      const key = `${m.criterionId}\u{1F}/${m.facetId}\u{1F}/${m.mappingKind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      // Prohibited/secret-shaped values: authored identifiers must never look
      // like credentials (matches the roster-extension credential check).
      if (CREDENTIAL_LIKE_VALUE.test(m.criterionId) || CREDENTIAL_LIKE_VALUE.test(m.facetId)) {
        return false;
      }
    }
  }

  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isRubricVersionRef(v: unknown): v is RubricVersionRef {
  return isRecord(v) && isNonEmptyString(v.id) && isNumber(v.version);
}

export function isEvaluationSelection(v: unknown): v is EvaluationSelection {
  if (!isRecord(v)) return false;
  if (v.kind === "holistic") return true;
  if (v.kind === "profile") return isRubricVersionRef(v.profile);
  return false;
}

export function isTaskEvaluationSelection(v: unknown): v is TaskEvaluationSelection {
  if (!isRecord(v)) return false;
  if (v.kind === "inherit") return true;
  // Distinguish holistic vs pinned-profile without nullable inference.
  return isEvaluationSelection(v);
}

export function isRubricRecord(v: unknown): v is RubricRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (!isNumber(v.latestVersion)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  // Archive state lives only on the mutable ProfileRecord.
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

// --- Legacy guard aliases (deprecated) ---------------------------------------
// Canonical guards above are the primary surface. The legacy aliases below
// remain importable here only because `evaluation-repository.ts` (migrated in
// a later task) still imports them; this is the documented migration window
// authorized by the rubric-terminology spec. The explicit deprecated re-export
// surface lives in `rubric-compat.ts`. Remove once all consumers migrate.

/** @deprecated Use `isEvaluationRubric`. Legacy alias for the rubric guard. */
export const isEvaluationProfile = isEvaluationRubric;

/** @deprecated Use `isRubricVersionRef`. Legacy alias for the version-ref guard. */
export const isEvaluationProfileRef = isRubricVersionRef;

/** @deprecated Use `isRubricRecord`. Legacy alias for the record guard. */
export const isProfileRecord = isRubricRecord;

// --- Model slot / critic ref --------------------------------------------------

export function isModelSlot(v: unknown): v is ModelSlot {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isString(v.providerId) &&
    isString(v.provider) &&
    isString(v.model) &&
    isString(v.slug) &&
    isBoolean(v.enabled)
  );
}

export function isCriticRef(v: unknown): v is CriticRef {
  return isRecord(v) && isString(v.providerId) && isString(v.model);
}

// --- Tasks / suite ------------------------------------------------------------

export function isTaskVerification(v: unknown): v is TaskVerification {
  return (
    isRecord(v) &&
    typeof v.kind === "string" &&
    (VERIFICATION_KINDS as readonly string[]).includes(v.kind)
  );
}

export function isEvaluationTask(v: unknown): v is EvaluationTask {
  if (!isRecord(v)) return false;
  if (v.verification !== undefined && !isTaskVerification(v.verification)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonBlankString(v.title) &&
    isNonBlankString(v.prompt) &&
    isString(v.systemPrompt) &&
    isTaskEvaluationSelection(v.evaluation) &&
    isString(v.judgeInstructionOverride) &&
    isNumber(v.order)
  );
}

/**
 * Structural record validity for a persisted suite. Execution preconditions
 * (≥1 task, ≥2 enabled unique model keys, ready judge) are deliberately NOT
 * enforced here — incomplete drafts are saveable records; the Run gate is
 * validateSuiteForExecution (suite-validation.ts §10.2).
 */
export function isEvaluationSuite(v: unknown): v is EvaluationSuite {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (!isNumber(v.version)) return false;
  // Non-empty name required.
  if (!isNonEmptyString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!Array.isArray(v.tasks) || !v.tasks.every(isEvaluationTask)) return false;
  if (!Array.isArray(v.modelSlots) || !v.modelSlots.every(isModelSlot)) return false;
  if (!isCriticRef(v.defaultJudge)) return false;
  if (!isEvaluationSelection(v.defaultEvaluation)) return false;
  if (v.reasoningPolicy !== undefined && !isReasoningPolicy(v.reasoningPolicy)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;

  if (hasProhibitedKeys(v)) return false;
  return true;
}

// --- Experiment ---------------------------------------------------------------

function isExperimentAttemptCoverage(v: unknown): v is ExperimentAttemptCoverage {
  if (!isRecord(v)) return false;
  // Empty scoredModelKeys is legal — a judge-failed run scores nothing.
  if (!Array.isArray(v.scoredModelKeys)) return false;
  if (!v.scoredModelKeys.every((k): k is string => isNonEmptyString(k))) return false;
  if (new Set(v.scoredModelKeys).size !== v.scoredModelKeys.length) return false;
  if (!isNumber(v.totalModels) || v.totalModels < 0) return false;
  if (v.scoredModelKeys.some((k) => /^(sk-|AIza|Bearer\s)/i.test(k))) return false;
  return true;
}

function isExperimentRepairPlan(v: unknown): v is ExperimentRepairPlan {
  if (!isRecord(v)) return false;
  if (v.kind !== "missing-cells") return false;
  if (!isNonEmptyString(v.baseRunId) || /^(sk-|AIza|Bearer\s)/i.test(v.baseRunId)) return false;
  if (!Array.isArray(v.requestedModelKeys) || v.requestedModelKeys.length === 0) return false;
  if (!v.requestedModelKeys.every((k): k is string => isNonEmptyString(k))) return false;
  if (new Set(v.requestedModelKeys).size !== v.requestedModelKeys.length) return false;
  if (v.requestedModelKeys.some((k) => /^(sk-|AIza|Bearer\s)/i.test(k))) return false;
  return true;
}

function isExperimentRosterExtensionPlan(v: unknown): v is ExperimentRosterExtensionPlan {
  if (!isRecord(v)) return false;
  if (v.kind !== "roster-extension") return false;
  if (!isNonEmptyString(v.addedModelKey)) return false;
  if (/^(sk-|AIza|Bearer\s)/i.test(v.addedModelKey)) return false;
  if (v.baseRunId !== undefined) {
    if (!isNonEmptyString(v.baseRunId)) return false;
    if (/^(sk-|AIza|Bearer\s)/i.test(v.baseRunId)) return false;
  }
  return true;
}

/** Discriminant union — legacy `missing-cells` plus `roster-extension`.
 *  Exported for run-source validation in persistence/run-types.ts. */
export function isExperimentTaskExecutionPlan(v: unknown): v is ExperimentTaskExecutionPlan {
  return isExperimentRepairPlan(v) || isExperimentRosterExtensionPlan(v);
}

function isExperimentRosterExtension(v: unknown): v is ExperimentRosterExtension {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.addedModelKey)) return false;
  if (/^(sk-|AIza|Bearer\s)/i.test(v.addedModelKey)) return false;
  if (!isModelSlot(v.addedSlot)) return false;
  // Slot identity must match the recorded key exactly.
  if (`${v.addedSlot.providerId}:${v.addedSlot.slug}` !== v.addedModelKey) return false;
  if (!isNonEmptyString(v.priorFingerprint)) return false;
  if (!isNumber(v.extendedAt) || !Number.isFinite(v.extendedAt) || v.extendedAt < 0) {
    return false;
  }
  return true;
}

/** History-wide invariants: unique added keys and unique slot ids. */
function hasValidRosterExtensionHistory(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  if (!v.every(isExperimentRosterExtension)) return false;
  const keys = new Set<string>();
  const slotIds = new Set<string>();
  for (const entry of v) {
    if (keys.has(entry.addedModelKey)) return false;
    keys.add(entry.addedModelKey);
    if (slotIds.has(entry.addedSlot.id)) return false;
    slotIds.add(entry.addedSlot.id);
  }
  return true;
}

export function isExperimentTaskAttempt(v: unknown): v is ExperimentTaskAttempt {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (v.runId !== null && !isString(v.runId)) return false;
  if (!isNumber(v.trial)) return false;
  if (typeof v.status !== "string" || !EXPERIMENT_TASK_STATUSES.includes(v.status)) {
    return false;
  }
  if (v.startedAt !== null && !isNumber(v.startedAt)) return false;
  if (v.finishedAt !== null && !isNumber(v.finishedAt)) return false;
  if (v.error !== null && !isPersistedError(v.error)) return false;
  if (v.coverage !== undefined && !isExperimentAttemptCoverage(v.coverage)) return false;
  if (v.repair !== undefined && !isExperimentTaskExecutionPlan(v.repair)) return false;
  return true;
}

export function isExperimentTaskState(v: unknown): v is ExperimentTaskState {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.taskId)) return false;
  if (v.selectedAttemptId !== null && !isString(v.selectedAttemptId)) return false;
  if (!Array.isArray(v.attempts) || !v.attempts.every(isExperimentTaskAttempt)) {
    return false;
  }
  return true;
}

export function isExperimentSnapshot(v: unknown): v is ExperimentSnapshot {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.suiteId)) return false;
  if (!isNumber(v.suiteVersion)) return false;
  if (!Array.isArray(v.tasks) || !v.tasks.every(isEvaluationTask)) return false;
  if (!Array.isArray(v.modelSlots) || !v.modelSlots.every(isModelSlot)) return false;
  if (!isCriticRef(v.defaultJudge)) return false;
  if (!isEvaluationSelection(v.defaultEvaluation)) return false;
  if (v.reasoningPolicy !== undefined && !isReasoningPolicy(v.reasoningPolicy)) return false;
  if (!Array.isArray(v.profiles) || !v.profiles.every(isEvaluationRubric)) return false;
  if (!isNonEmptyString(v.protocolFingerprint)) return false;
  if (!isNumber(v.createdAt)) return false;
  return true;
}

export function isExperimentRecord(v: unknown): v is ExperimentRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (!isNonEmptyString(v.suiteId)) return false;
  if (!isNumber(v.suiteVersion)) return false;
  if (!isNonEmptyString(v.protocolFingerprint)) return false;
  if (typeof v.status !== "string" || !EXPERIMENT_STATUSES.includes(v.status)) {
    return false;
  }
  if (v.execution !== null && !isExecutionFence(v.execution)) return false;
  if (!isExperimentSnapshot(v.snapshot)) return false;
  if (!Array.isArray(v.tasks) || !v.tasks.every(isExperimentTaskState)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.rosterExtensions !== undefined && !hasValidRosterExtensionHistory(v.rosterExtensions))
    return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}
