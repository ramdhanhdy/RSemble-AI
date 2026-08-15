// =============================================================================
// RSemble AI — Canonical Task Set domain types and runtime validators
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 1.
//
// Defines the canonical versioned Task Set entities per the task-sets-and-
// evaluations specification (§3): TaskSetRecord, immutable TaskSetVersion /
// WorkloadManifest, TaskSetMember, and the supporting protocol-default types
// (JudgeSnapshot, RepeatPolicy, MissingnessPolicy, ProtocolDefaults,
// TaskExecutionOverrides). A committed TaskSetVersion is immutable; membership
// points to exact canonical Task Versions and never embeds mutable catalog
// definitions as canonical identity.
//
// Identity reuse: this module reuses the canonical VersionRef from
// `../tasks/task-types` (same shape as RubricVersionRef), ModelSlot from
// `../../studio-data`, CriticRef/ReasoningPolicy/ProviderId from
// `../providers/types`, and TaskEvaluationSelection/TaskVerification from
// `./evaluation-types`. It does not casually duplicate those identities. The
// prohibited-key / credential-shape / ID-pattern primitives are reused from
// `../tasks/task-validation` (the canonical Task domain boundary) so every
// persisted Task Set record gets the same deep-walk scan as Task/Rubric/Run
// records.
//
// Runtime validators mirror the project's confirmed idioms: boolean `is*`
// guards for persistence-boundary checks and `{valid, errors}` validators for
// field-specific diagnostics. Ref *resolution* (does this task version exist
// in the catalog?) is separated from structural *validity* via
// `validateTaskSetVersionRefs`, which records unresolved members and refs
// without inventing latest-Task substitutions (spec §8.2).
//
// No manifest materializer, persistence, migration, UI/routes, archive,
// execution/controller, or provider calls live here — those are later tasks.
// =============================================================================

import type { CriticRef, ProviderId, ReasoningPolicy } from "../providers/types";
import type { ModelSlot } from "../../studio-data";
import type { VersionRef } from "../tasks/task-types";

import {
  hasProhibitedKeys,
  isVersionRef,
  ID_PATTERN,
  PROHIBITED_KEYS,
  CREDENTIAL_LIKE_VALUE,
} from "../tasks/task-validation";
import {
  isModelSlot,
  isReasoningPolicy,
  isTaskEvaluationSelection,
  isTaskVerification,
  type TaskEvaluationSelection,
  type TaskVerification,
} from "./evaluation-types";

// --- re-exported canonical primitives ---------------------------------------
// Re-exported so callers validating Task Set records import the canonical
// prohibited-key / credential-shape / ID-pattern primitives from one seam,
// identical to the Task and Rubric domain boundaries.

export { PROHIBITED_KEYS, CREDENTIAL_LIKE_VALUE, ID_PATTERN, hasProhibitedKeys };

// --- canonical entities (spec §3) -------------------------------------------

/** Origin of a TaskSetRecord (spec §3.1). Mutable only as administrative
 *  state. `legacy-suite` marks a record reconstructed from a deprecated
 * EvaluationSuite through the compatibility adapter. */
export type TaskSetOrigin = "authored" | "legacy-suite" | "imported";

/** Canonical persisted Task Set record. Only administrative metadata and
 *  lifecycle state are mutable through compare-and-swap (`revision`,
 *  `latestVersion`, `updatedAt`, `archivedAt`). Immutable TaskSetVersions
 *  live separately. */
export interface TaskSetRecord {
  id: string;
  latestVersion: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
  origin: TaskSetOrigin;
}

/** Membership role (spec §3.2, §5.3). Visible in provenance; never becomes
 *  global Rubric weighting. */
export type TaskSetMemberRole = "organic" | "anchor" | "calibration" | "holdout";

/** Exact reference to an immutable canonical Task Version inside a member.
 *  Named `taskId`/`version` for task-version identity; structurally a
 *  VersionRef. The catalog crosswalk (child 02) resolves `taskId` to a
 *  canonical TaskRecord. */
export interface TaskVersionRef {
  taskId: string;
  version: number;
}

/** Per-member execution overrides projected from legacy embedded task fields
 *  (spec §3.2). Optional fields preserve the legacy shape without forcing a
 *  value; `null` on the member means "no overrides / inherit defaults". */
export interface TaskExecutionOverrides {
  evaluation?: TaskEvaluationSelection;
  judgeInstructionOverride?: string;
  verification?: TaskVerification;
}

/** A single member of a Task Set Version (spec §3.2). Points to an exact
 *  canonical Task Version; carries deterministic order, role, optional
 *  stratum, positive weight, an optional per-member Rubric override ref, and
 *  optional execution overrides.
 *
 *  `unresolved` records members whose embedded legacy task could not map to a
 *  canonical Task Version (spec §8.2). An unresolved member remains readable
 *  and blocks new paid execution for that version; it never substitutes the
 *  latest task or drops the member. `null` (or absent) means resolved. */
export interface TaskSetMember {
  id: string;
  taskVersionRef: TaskVersionRef;
  order: number;
  role: TaskSetMemberRole;
  stratum: string | null;
  weight: number;
  rubricOverrideRef: VersionRef | null;
  executionOverrides: TaskExecutionOverrides | null;
  unresolved: string | null;
}

/** Frozen judge identity for a Task Set Version. Reuses the canonical
 *  CriticRef provider/model identity. The optional reasoning-policy snapshot
 *  is carried separately on ProtocolDefaults to preserve the legacy
 *  suite-level `reasoningPolicy` placement. */
export interface JudgeSnapshot {
  providerId: ProviderId;
  model: string;
  reasoningPolicy?: ReasoningPolicy;
}

/** Repeat policy (spec §3.2, parent §9.3). `none` = no declared replicate
 *  (ordinary retry-only execution). `declared-replicate` = a deliberately
 *  planned independent stochastic repetition declared by protocol before
 *  execution; `count` is a positive integer. */
export type RepeatPolicy = { kind: "none" } | { kind: "declared-replicate"; count: number };

/** Missingness policy (spec §3.2). `strict` = missing cells fail without
 *  repair. `allow-repair` = the current missing-cell repair / roster-extension
 *  behavior is permitted. Preserves the legacy suite's shipped repair
 *  semantics. */
export type MissingnessPolicy = { kind: "strict" } | { kind: "allow-repair" };

/** Protocol-level defaults (spec §3.2). Carries the optional reasoning policy
 *  projected from the legacy suite-level `reasoningPolicy`. Additional
 *  protocol knobs are added by later tasks; this child only types the seam. */
export interface ProtocolDefaults {
  reasoningPolicy?: ReasoningPolicy;
}

/** Immutable Task Set Version / WorkloadManifest (spec §3.2). The manifest is
 *  immutable; membership points to exact Task Versions and never embeds
 *  mutable catalog definitions as canonical identity.
 *
 *  `defaultRubricRef` is `VersionRef | null`: a pinned Rubric version for
 *  rubric-scored evaluations, or `null` for holistic evaluation (preserving
 *  the legacy `defaultEvaluation: { kind: "holistic" }` semantics without
 *  inventing a synthetic holistic rubric). */
export interface TaskSetVersion {
  taskSetId: string;
  version: number;
  members: TaskSetMember[];
  defaultRubricRef: VersionRef | null;
  defaultModelSlots: ModelSlot[];
  defaultJudge: JudgeSnapshot;
  repeatPolicy: RepeatPolicy;
  missingnessPolicy: MissingnessPolicy;
  protocolDefaults: ProtocolDefaults;
  createdAt: number;
}

// --- validation result shapes -----------------------------------------------

export interface TaskSetValidationError {
  field: string;
  message: string;
}

export interface TaskSetValidationResult {
  valid: boolean;
  errors: TaskSetValidationError[];
}

export interface TaskSetUnresolvedRef {
  field: string;
  ref: unknown;
  reason: string;
}

export interface TaskSetRefResolutionResult {
  unresolved: TaskSetUnresolvedRef[];
}

function fail(errors: TaskSetValidationError[]): TaskSetValidationResult {
  return { valid: errors.length === 0, errors };
}

// --- primitive guards (local; mirror canonical idiom) -----------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isPositiveInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v > 0;
}
function isNonNegativeInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v >= 0;
}
function isPositiveNumber(v: unknown): v is number {
  return isNumber(v) && v > 0;
}
function isId(v: unknown): v is string {
  return isString(v) && ID_PATTERN.test(v);
}
function isSafeIdentifier(v: unknown): v is string {
  return isNonEmptyString(v) && !CREDENTIAL_LIKE_VALUE.test(v);
}

const TASK_SET_ORIGINS: readonly TaskSetOrigin[] = ["authored", "legacy-suite", "imported"];
const TASK_SET_MEMBER_ROLES: readonly TaskSetMemberRole[] = [
  "organic",
  "anchor",
  "calibration",
  "holdout",
];

// --- supporting type guards --------------------------------------------------

export function isTaskSetOrigin(v: unknown): v is TaskSetOrigin {
  return typeof v === "string" && (TASK_SET_ORIGINS as readonly string[]).includes(v);
}

export function isTaskSetMemberRole(v: unknown): v is TaskSetMemberRole {
  return typeof v === "string" && (TASK_SET_MEMBER_ROLES as readonly string[]).includes(v);
}

/** Structural guard for an exact Task Version ref. `taskId` must match the
 *  canonical opaque ID pattern and be free of credential-shaped values;
 *  `version` must be a positive integer. Prohibited keys are rejected. */
export function isTaskVersionRef(v: unknown): v is TaskVersionRef {
  if (!isRecord(v)) return false;
  if (!isId(v.taskId) || !isSafeIdentifier(v.taskId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  return !hasProhibitedKeys(v);
}

export function isJudgeSnapshot(v: unknown): v is JudgeSnapshot {
  if (!isRecord(v)) return false;
  // Mirror isCriticRef's leniency on providerId (string, not enum-locked) so
  // the canonical Task Set boundary stays compatible with forward provider
  // additions without duplicating the ProviderId allowlist here.
  if (!isString(v.providerId) || !isNonEmptyString(v.model)) return false;
  if (v.reasoningPolicy !== undefined && !isReasoningPolicy(v.reasoningPolicy)) return false;
  return !hasProhibitedKeys(v);
}

export function isRepeatPolicy(v: unknown): v is RepeatPolicy {
  if (!isRecord(v)) return false;
  if (v.kind === "none") return !hasProhibitedKeys(v);
  if (v.kind === "declared-replicate") {
    return isPositiveInteger(v.count) && !hasProhibitedKeys(v);
  }
  return false;
}

export function isMissingnessPolicy(v: unknown): v is MissingnessPolicy {
  if (!isRecord(v)) return false;
  if (v.kind !== "strict" && v.kind !== "allow-repair") return false;
  return !hasProhibitedKeys(v);
}

export function isProtocolDefaults(v: unknown): v is ProtocolDefaults {
  if (!isRecord(v)) return false;
  if (v.reasoningPolicy !== undefined && !isReasoningPolicy(v.reasoningPolicy)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskExecutionOverrides(v: unknown): v is TaskExecutionOverrides | null {
  if (v === null) return true;
  if (!isRecord(v)) return false;
  if (v.evaluation !== undefined && !isTaskEvaluationSelection(v.evaluation)) return false;
  if (v.judgeInstructionOverride !== undefined && !isString(v.judgeInstructionOverride)) {
    return false;
  }
  if (v.verification !== undefined && !isTaskVerification(v.verification)) return false;
  return !hasProhibitedKeys(v);
}

// --- canonical entity guards -------------------------------------------------

export function isTaskSetMember(v: unknown): v is TaskSetMember {
  if (!isRecord(v)) return false;
  if (!isId(v.id) || !isSafeIdentifier(v.id)) return false;
  if (!isTaskVersionRef(v.taskVersionRef)) {
    // An unresolved member may carry a placeholder ref (e.g. empty taskId /
    // zero version) as long as it is explicitly flagged unresolved.
    if (v.unresolved === null || v.unresolved === undefined || !isString(v.unresolved)) {
      return false;
    }
    if (!isRecord(v.taskVersionRef)) return false;
    if (!isString(v.taskVersionRef.taskId) || !isNumber(v.taskVersionRef.version)) return false;
  }
  if (!isNonNegativeInteger(v.order)) return false;
  if (!isTaskSetMemberRole(v.role)) return false;
  if (v.stratum !== null && !isString(v.stratum)) return false;
  if (!isPositiveNumber(v.weight)) return false;
  if (v.rubricOverrideRef !== null && !isVersionRef(v.rubricOverrideRef)) return false;
  if (!isTaskExecutionOverrides(v.executionOverrides)) return false;
  if (v.unresolved !== null && v.unresolved !== undefined && !isString(v.unresolved)) {
    return false;
  }
  return !hasProhibitedKeys(v);
}

export function isTaskSetVersion(v: unknown): v is TaskSetVersion {
  if (!isRecord(v)) return false;
  if (!isId(v.taskSetId) || !isSafeIdentifier(v.taskSetId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!Array.isArray(v.members) || v.members.length === 0) return false;
  if (!v.members.every(isTaskSetMember)) return false;
  if (v.defaultRubricRef !== null && !isVersionRef(v.defaultRubricRef)) return false;
  if (!Array.isArray(v.defaultModelSlots) || !v.defaultModelSlots.every(isModelSlot)) {
    return false;
  }
  if (!isJudgeSnapshot(v.defaultJudge)) return false;
  if (!isRepeatPolicy(v.repeatPolicy)) return false;
  if (!isMissingnessPolicy(v.missingnessPolicy)) return false;
  if (!isProtocolDefaults(v.protocolDefaults)) return false;
  if (!isNumber(v.createdAt)) return false;
  // Deterministic order: unique non-negative integer orders across members.
  const orders = v.members.map((m) => (m as TaskSetMember).order);
  if (new Set(orders).size !== orders.length) return false;
  // Unique member ids.
  const ids = v.members.map((m) => (m as TaskSetMember).id);
  if (new Set(ids).size !== ids.length) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskSetRecord(v: unknown): v is TaskSetRecord {
  if (!isRecord(v)) return false;
  if (!isId(v.id) || !isSafeIdentifier(v.id)) return false;
  if (!isPositiveInteger(v.latestVersion)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;
  if (!isNonNegativeInteger(v.revision)) return false;
  if (!isTaskSetOrigin(v.origin)) return false;
  return !hasProhibitedKeys(v);
}

// --- {valid, errors} validators ---------------------------------------------

export function validateTaskSetRecord(v: unknown): TaskSetValidationResult {
  const errors: TaskSetValidationError[] = [];
  if (!isRecord(v)) {
    return fail([{ field: "", message: "TaskSetRecord must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isPositiveInteger(v.latestVersion)) {
    errors.push({ field: "latestVersion", message: "latestVersion must be a positive integer." });
  }
  if (!isNonEmptyString(v.name)) {
    errors.push({ field: "name", message: "name must be a non-empty string." });
  }
  if (!isString(v.description)) {
    errors.push({ field: "description", message: "description must be a string." });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (!isNumber(v.updatedAt)) {
    errors.push({ field: "updatedAt", message: "updatedAt must be a number." });
  }
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) {
    errors.push({ field: "archivedAt", message: "archivedAt must be a number or null." });
  }
  if (!isNonNegativeInteger(v.revision)) {
    errors.push({ field: "revision", message: "revision must be a non-negative integer." });
  }
  if (!isTaskSetOrigin(v.origin)) {
    errors.push({ field: "origin", message: "origin has an invalid value." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({
      field: "",
      message: "TaskSetRecord carries prohibited credential/transport keys.",
    });
  }
  return fail(errors);
}

export function validateTaskSetMember(v: unknown): TaskSetValidationResult {
  const errors: TaskSetValidationError[] = [];
  if (!isRecord(v)) {
    return fail([{ field: "", message: "TaskSetMember must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  const unresolved = v.unresolved;
  const isUnresolved = isString(unresolved) && unresolved.length > 0;
  if (!isTaskVersionRef(v.taskVersionRef)) {
    if (!isUnresolved) {
      errors.push({
        field: "taskVersionRef",
        message: "taskVersionRef must be an exact Task Version ref.",
      });
    } else if (
      !isRecord(v.taskVersionRef) ||
      !isString(v.taskVersionRef.taskId) ||
      !isNumber(v.taskVersionRef.version)
    ) {
      errors.push({
        field: "taskVersionRef",
        message: "unresolved member taskVersionRef must remain a { taskId, version } placeholder.",
      });
    }
  }
  if (!isNonNegativeInteger(v.order)) {
    errors.push({ field: "order", message: "order must be a non-negative integer." });
  }
  if (!isTaskSetMemberRole(v.role)) {
    errors.push({ field: "role", message: "role has an invalid value." });
  }
  if (v.stratum !== null && !isString(v.stratum)) {
    errors.push({ field: "stratum", message: "stratum must be a string or null." });
  }
  if (!isPositiveNumber(v.weight)) {
    errors.push({ field: "weight", message: "weight must be a positive number." });
  }
  if (v.rubricOverrideRef !== null && !isVersionRef(v.rubricOverrideRef)) {
    errors.push({
      field: "rubricOverrideRef",
      message: "rubricOverrideRef must be a VersionRef or null.",
    });
  }
  if (!isTaskExecutionOverrides(v.executionOverrides)) {
    errors.push({
      field: "executionOverrides",
      message: "executionOverrides must be a TaskExecutionOverrides or null.",
    });
  }
  if (unresolved !== null && unresolved !== undefined && !isString(unresolved)) {
    errors.push({ field: "unresolved", message: "unresolved must be a string or null." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({
      field: "",
      message: "TaskSetMember carries prohibited credential/transport keys.",
    });
  }
  return fail(errors);
}

export function validateTaskSetVersion(v: unknown): TaskSetValidationResult {
  const errors: TaskSetValidationError[] = [];
  if (!isRecord(v)) {
    return fail([{ field: "", message: "TaskSetVersion must be an object." }]);
  }
  if (!isId(v.taskSetId)) {
    errors.push({ field: "taskSetId", message: "taskSetId must match the opaque ID pattern." });
  }
  if (!isPositiveInteger(v.version)) {
    errors.push({ field: "version", message: "version must be a positive integer." });
  }
  if (!Array.isArray(v.members) || v.members.length === 0) {
    errors.push({ field: "members", message: "members must be a non-empty array." });
  } else {
    const orders: number[] = [];
    const ids: string[] = [];
    v.members.forEach((m, i) => {
      const memberResult = validateTaskSetMember(m);
      if (!memberResult.valid) {
        for (const e of memberResult.errors) {
          errors.push({
            field: e.field ? `members[${i}].${e.field}` : `members[${i}]`,
            message: e.message,
          });
        }
      }
      if (isRecord(m) && isNumber(m.order)) orders.push(m.order);
      if (isRecord(m) && isString(m.id)) ids.push(m.id);
    });
    if (orders.length > 0 && new Set(orders).size !== orders.length) {
      errors.push({ field: "members", message: "member orders must be unique." });
    }
    if (ids.length > 0 && new Set(ids).size !== ids.length) {
      errors.push({ field: "members", message: "member ids must be unique." });
    }
  }
  if (v.defaultRubricRef !== null && !isVersionRef(v.defaultRubricRef)) {
    errors.push({
      field: "defaultRubricRef",
      message: "defaultRubricRef must be a VersionRef or null (null = holistic).",
    });
  }
  if (!Array.isArray(v.defaultModelSlots) || !v.defaultModelSlots.every(isModelSlot)) {
    errors.push({ field: "defaultModelSlots", message: "defaultModelSlots must be ModelSlot[]." });
  }
  if (!isJudgeSnapshot(v.defaultJudge)) {
    errors.push({ field: "defaultJudge", message: "defaultJudge must be a JudgeSnapshot." });
  }
  if (!isRepeatPolicy(v.repeatPolicy)) {
    errors.push({ field: "repeatPolicy", message: "repeatPolicy is malformed." });
  }
  if (!isMissingnessPolicy(v.missingnessPolicy)) {
    errors.push({ field: "missingnessPolicy", message: "missingnessPolicy is malformed." });
  }
  if (!isProtocolDefaults(v.protocolDefaults)) {
    errors.push({ field: "protocolDefaults", message: "protocolDefaults is malformed." });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({
      field: "",
      message: "TaskSetVersion carries prohibited credential/transport keys.",
    });
  }
  return fail(errors);
}

// --- ref resolution: unresolved + malformed refs ----------------------------

/** Resolvers supplied by the caller (repository / migration). Each returns
 *  true when the referenced entity exists in the catalog at that exact
 *  version. A missing resolver is treated as "no catalog available": refs are
 *  not reported unresolved on existence grounds alone (structural validity
 *  still applies), but explicitly unresolved-flagged members are always
 *  reported. */
export interface TaskSetRefResolvers {
  taskVersionExists?: (ref: TaskVersionRef) => boolean;
  rubricVersionExists?: (ref: { id: string; version: number }) => boolean;
}

/** Validate that every Task/Rubric ref in a TaskSetVersion resolves against
 *  the supplied catalog resolvers, and surface explicitly unresolved members
 *  (spec §8.2). Malformed refs are caught by structural validation; this
 *  function only reports *unresolved* (structurally valid but not found, or
 *  explicitly flagged) refs. It never substitutes the latest task or drops a
 *  member. */
export function validateTaskSetVersionRefs(
  version: TaskSetVersion,
  resolvers: TaskSetRefResolvers,
): TaskSetRefResolutionResult {
  const unresolved: TaskSetUnresolvedRef[] = [];

  if (
    version.defaultRubricRef !== null &&
    resolvers.rubricVersionExists &&
    !resolvers.rubricVersionExists(version.defaultRubricRef)
  ) {
    unresolved.push({
      field: "defaultRubricRef",
      ref: version.defaultRubricRef,
      reason: "default rubric version ref does not resolve in the catalog.",
    });
  }

  version.members.forEach((m, i) => {
    if (m.unresolved !== null && m.unresolved !== undefined && m.unresolved.length > 0) {
      unresolved.push({
        field: `members[${i}]`,
        ref: m.taskVersionRef,
        reason: m.unresolved,
      });
      return;
    }
    if (resolvers.taskVersionExists && !resolvers.taskVersionExists(m.taskVersionRef)) {
      unresolved.push({
        field: `members[${i}].taskVersionRef`,
        ref: m.taskVersionRef,
        reason: "task version ref does not resolve in the catalog.",
      });
    }
    if (
      m.rubricOverrideRef !== null &&
      resolvers.rubricVersionExists &&
      !resolvers.rubricVersionExists(m.rubricOverrideRef)
    ) {
      unresolved.push({
        field: `members[${i}].rubricOverrideRef`,
        ref: m.rubricOverrideRef,
        reason: "rubric override ref does not resolve in the catalog.",
      });
    }
  });

  return { unresolved };
}

// --- CriticRef compatibility (re-exported for adapter callers) --------------

/** Re-exported so suite-compat callers can construct a JudgeSnapshot from a
 *  legacy CriticRef without re-importing the provider types seam ad hoc. */
export type { CriticRef };
