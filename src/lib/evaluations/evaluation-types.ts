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

import type { CriticRef } from "../providers/types";
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

export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
  weight: number;
  anchors: { one: string; three: string; five: string };
}

export interface EvaluationProfile {
  id: string;
  version: number;
  name: string;
  description: string;
  judgeInstruction: string;
  criteria: EvaluationCriterion[];
  createdAt: number;
  updatedAt: number;
}

export type EvaluationProfileSnapshot = EvaluationProfile;

export interface ProfileRecord {
  id: string;
  revision: number;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface EvaluationProfileRef {
  id: string;
  version: number;
}

export type EvaluationSelection =
  | { kind: "holistic" }
  | { kind: "profile"; profile: EvaluationProfileRef };

export type TaskEvaluationSelection =
  | { kind: "inherit" }
  | EvaluationSelection;

// --- Tasks / suites -----------------------------------------------------------

/**
 * Verifier-derived determinism (fusion-study spec §5.5): deterministic
 * correctness is a property of whether a task has an external verifier, never
 * a user toggle over rubric scores. Task-level only in v1.
 */
export type VerificationKind =
  | "none"
  | "exact_match"
  | "numeric"
  | "schema"
  | "unit_tests"
  | "custom_checker";

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
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

// --- Experiments --------------------------------------------------------------

export interface ExperimentTaskAttempt {
  id: string;
  runId: string | null;
  trial: number;
  status:
    | "queued"
    | "running"
    | "completed"
    | "partial"
    | "failed"
    | "aborted"
    | "interrupted";
  startedAt: number | null;
  finishedAt: number | null;
  error: PersistedError | null;
  /** Scored-model coverage for coverage-aware attempt selection (spec §11.5). */
  coverage?: ExperimentAttemptCoverage;
  /** Compound repair metadata for auditable targeted repairs (spec §11.4). */
  repair?: ExperimentRepairPlan;
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
  profiles: EvaluationProfileSnapshot[];
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

export function isEvaluationCriterion(v: unknown): v is EvaluationCriterion {
  if (!isRecord(v)) return false;
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

export function isEvaluationProfile(v: unknown): v is EvaluationProfile {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.version)) return false;
  if (!isString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!isString(v.judgeInstruction)) return false;
  if (!Array.isArray(v.criteria) || !v.criteria.every(isEvaluationCriterion)) {
    return false;
  }
  // A criterion-based (non-holistic) profile must carry at least one positive
  // weight — otherwise it scores nothing.
  if (v.criteria.length === 0) return false;
  if (!v.criteria.some((c) => isRecord(c) && isNumber(c.weight) && c.weight > 0)) {
    return false;
  }
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isEvaluationProfileRef(v: unknown): v is EvaluationProfileRef {
  return isRecord(v) && isNonEmptyString(v.id) && isNumber(v.version);
}

export function isEvaluationSelection(v: unknown): v is EvaluationSelection {
  if (!isRecord(v)) return false;
  if (v.kind === "holistic") return true;
  if (v.kind === "profile") return isEvaluationProfileRef(v.profile);
  return false;
}

export function isTaskEvaluationSelection(v: unknown): v is TaskEvaluationSelection {
  if (!isRecord(v)) return false;
  if (v.kind === "inherit") return true;
  // Distinguish holistic vs pinned-profile without nullable inference.
  return isEvaluationSelection(v);
}

export function isProfileRecord(v: unknown): v is ProfileRecord {
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
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;

  if (hasProhibitedKeys(v)) return false;
  return true;
}

// --- Experiment ---------------------------------------------------------------

function isExperimentAttemptCoverage(v: unknown): v is ExperimentAttemptCoverage {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.scoredModelKeys) || v.scoredModelKeys.length === 0) return false;
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
  if (v.repair !== undefined && !isExperimentRepairPlan(v.repair)) return false;
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
  if (!Array.isArray(v.profiles) || !v.profiles.every(isEvaluationProfile)) return false;
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
  if (hasProhibitedKeys(v)) return false;
  return true;
}
