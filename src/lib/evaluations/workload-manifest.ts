// =============================================================================
// RSemble AI — Task Set Workload Manifest Materialization & Deterministic Fingerprints
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 2.
//
// Materializes a complete, immutable execution snapshot (`MaterializedWorkloadSnapshot`)
// from a canonical `TaskSetVersion` by resolving exact canonical Task Versions
// and Rubric versions from catalog resolvers.
//
// Hard invariants enforced here (spec §3.2, §3.3, §5.2, §8.2):
//  - Exact resolution: points to exact canonical Task Versions and Rubric versions;
//    never substitutes latest versions or fallback rubrics.
//  - Deterministic member order: normalizes member sequence by ascending `order`
//    property with stable secondary tie-breaker.
//  - Deep immutability: deep-clones all task, rubric, and slot definitions so
//    later mutations to source catalog entities cannot alter frozen snapshots.
//  - Unresolved refs: missing entities or unresolved markers block execution
//    with typed diagnostics (`UnresolvedWorkloadRefError`).
//  - Dirty draft rejection: uncommitted drafts cannot be executed without
//    saving or discarding (`DirtyDraftExecutionError`).
//  - Archived refs: archived tasks/rubrics are flagged; historical replay
//    is permitted with provenance (`isArchived: true`), but new execution
//    requires explicit confirmation or is rejected.
//  - Deterministic protocol fingerprint: canonical JSON serialization + SHA-256
//    produces a reproducible `sha256:<64-hex>` hash sensitive to semantic
//    differences and invariant to non-semantic cosmetic/timestamp fields.
// =============================================================================

import type { ModelSlot } from "../../studio-data";
import type {
  EvaluationRubric,
  TaskEvaluationSelection,
  TaskVerification,
} from "./evaluation-types";
import { canonicalJsonString, hashArtifactContent } from "./protocol-fingerprint";
import type {
  JudgeSnapshot,
  MissingnessPolicy,
  ProtocolDefaults,
  RepeatPolicy,
  TaskExecutionOverrides,
  TaskSetMember,
  TaskSetMemberRole,
  TaskSetUnresolvedRef,
  TaskSetVersion,
  TaskVersionRef,
} from "./task-set-types";
import type { TaskInstance, TaskVersion, VersionRef } from "../tasks/task-types";

// --- Custom Error Classes ----------------------------------------------------

/**
 * Thrown when a Task Set Version references a Task Version or Rubric that
 * cannot be resolved in the catalog, or carries an unresolved member marker.
 */
export class UnresolvedWorkloadRefError extends Error {
  readonly unresolved: TaskSetUnresolvedRef[];

  constructor(unresolved: TaskSetUnresolvedRef[]) {
    const details = unresolved.map((u) => `${u.field}: ${u.reason}`).join("; ");
    super(`Cannot materialize workload manifest due to unresolved references: ${details}`);
    this.name = "UnresolvedWorkloadRefError";
    this.unresolved = unresolved;
  }
}

/**
 * Thrown when an execution is attempted against an uncommitted / dirty
 * in-memory Task Set draft without saving or discarding changes.
 */
export class DirtyDraftExecutionError extends Error {
  constructor(
    message = "Cannot execute dirty Task Set draft without saving or discarding changes.",
  ) {
    super(message);
    this.name = "DirtyDraftExecutionError";
  }
}

/**
 * Thrown when an execution is attempted against a Task Set referencing an
 * archived Task or Rubric when `allowArchived` is set to false.
 */
export class ArchivedTaskExecutionError extends Error {
  constructor(message = "Cannot execute Task Set referencing archived tasks or rubrics.") {
    super(message);
    this.name = "ArchivedTaskExecutionError";
  }
}

// --- Materialized Snapshot Types (spec §3.3) ---------------------------------

/**
 * Materialized member of a workload snapshot with resolved TaskVersion,
 * effective Rubric, and computed execution fields.
 */
export interface MaterializedTask {
  memberId: string;
  taskVersionRef: TaskVersionRef;
  order: number;
  role: TaskSetMemberRole;
  stratum: string | null;
  weight: number;
  rubricOverrideRef: VersionRef | null;
  executionOverrides: TaskExecutionOverrides | null;
  task: TaskVersion;
  effectiveRubricRef: VersionRef | null;
  effectiveRubric: EvaluationRubric | null;
  evaluation: TaskEvaluationSelection;
  judgeInstructionOverride: string | null;
  verification: TaskVerification | null;
  isArchived: boolean;
  taskInstance?: TaskInstance | null;
}

/**
 * Complete, immutable execution snapshot frozen before provider dispatch.
 */
export interface MaterializedWorkloadSnapshot {
  taskSetId: string;
  taskSetVersion: number;
  tasks: MaterializedTask[];
  rubrics: EvaluationRubric[];
  defaultRubricRef: VersionRef | null;
  defaultRubric: EvaluationRubric | null;
  defaultModelSlots: ModelSlot[];
  defaultJudge: JudgeSnapshot;
  repeatPolicy: RepeatPolicy;
  missingnessPolicy: MissingnessPolicy;
  protocolDefaults: ProtocolDefaults;
  protocolFingerprint: string;
  createdAt: number;
}

// --- Catalog Resolvers & Options --------------------------------------------

export interface WorkloadCatalogResolvers {
  getTaskVersion: (ref: TaskVersionRef) => TaskVersion | null | undefined;
  getRubricVersion?: (ref: VersionRef) => EvaluationRubric | null | undefined;
  isTaskArchived?: (taskId: string) => boolean;
  isRubricArchived?: (rubricId: string) => boolean;
}

export interface MaterializeWorkloadOptions {
  now?: number;
  allowArchived?: boolean;
  isDirty?: boolean;
}

export interface ValidateWorkloadForExecutionParams {
  version: TaskSetVersion;
  resolvers: WorkloadCatalogResolvers;
  isDirty?: boolean;
  allowArchived?: boolean;
}

export interface WorkloadExecutionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  unresolved: TaskSetUnresolvedRef[];
  hasArchivedRefs: boolean;
}

// --- Deep Clone Helper (Pure) ------------------------------------------------

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

// --- Validation Preflight ----------------------------------------------------

/**
 * Validates a TaskSetVersion for execution readiness before materialization.
 * Enforces:
 *  - draft clean state (not dirty)
 *  - ≥ 1 member task
 *  - ≥ 1 enabled model slot
 *  - valid default judge
 *  - 100% resolvable Task and Rubric references
 *  - archived references inspection (warning or error depending on allowArchived)
 */
export function validateWorkloadForExecution(
  params: ValidateWorkloadForExecutionParams,
): WorkloadExecutionValidationResult {
  const { version, resolvers, isDirty = false, allowArchived = true } = params;
  const errors: string[] = [];
  const warnings: string[] = [];
  const unresolved: TaskSetUnresolvedRef[] = [];
  let hasArchivedRefs = false;

  if (isDirty) {
    errors.push("Cannot execute dirty Task Set draft without saving or discarding changes.");
  }

  if (!Array.isArray(version.members) || version.members.length === 0) {
    errors.push("Task Set must contain at least one task.");
  }

  const enabledSlots = (version.defaultModelSlots || []).filter((s) => s && s.enabled);
  if (enabledSlots.length === 0) {
    errors.push("Task Set must have at least one enabled model slot.");
  }

  if (
    !version.defaultJudge ||
    typeof version.defaultJudge.providerId !== "string" ||
    typeof version.defaultJudge.model !== "string" ||
    version.defaultJudge.providerId.length === 0 ||
    version.defaultJudge.model.length === 0
  ) {
    errors.push("Task Set must specify a valid judge model.");
  }

  // Validate default rubric reference if set
  if (version.defaultRubricRef !== null) {
    const rubric = resolvers.getRubricVersion?.(version.defaultRubricRef);
    if (!rubric) {
      const err: TaskSetUnresolvedRef = {
        field: "defaultRubricRef",
        ref: version.defaultRubricRef,
        reason: "Default rubric version ref does not resolve in the catalog.",
      };
      unresolved.push(err);
      errors.push(
        `Unresolved default rubric: ${version.defaultRubricRef.id} v${version.defaultRubricRef.version}`,
      );
    } else if (resolvers.isRubricArchived?.(version.defaultRubricRef.id)) {
      hasArchivedRefs = true;
    }
  }

  // Validate each member
  if (Array.isArray(version.members)) {
    version.members.forEach((m, idx) => {
      if (m.unresolved) {
        unresolved.push({
          field: `members[${idx}]`,
          ref: m.taskVersionRef,
          reason: m.unresolved,
        });
        errors.push(`Member ${m.id || idx} is unresolved: ${m.unresolved}`);
        return;
      }

      const task = resolvers.getTaskVersion(m.taskVersionRef);
      if (!task) {
        unresolved.push({
          field: `members[${idx}].taskVersionRef`,
          ref: m.taskVersionRef,
          reason: "Task version ref does not resolve in the catalog.",
        });
        errors.push(
          `Unresolved task reference at member ${idx}: ${m.taskVersionRef?.taskId} v${m.taskVersionRef?.version}`,
        );
      } else if (resolvers.isTaskArchived?.(m.taskVersionRef.taskId)) {
        hasArchivedRefs = true;
      }

      if (m.rubricOverrideRef !== null) {
        const overrideRubric = resolvers.getRubricVersion?.(m.rubricOverrideRef);
        if (!overrideRubric) {
          unresolved.push({
            field: `members[${idx}].rubricOverrideRef`,
            ref: m.rubricOverrideRef,
            reason: "Rubric override ref does not resolve in the catalog.",
          });
          errors.push(
            `Unresolved rubric override at member ${idx}: ${m.rubricOverrideRef.id} v${m.rubricOverrideRef.version}`,
          );
        } else if (resolvers.isRubricArchived?.(m.rubricOverrideRef.id)) {
          hasArchivedRefs = true;
        }
      }
    });
  }

  if (hasArchivedRefs) {
    if (!allowArchived) {
      errors.push("Task Set references archived tasks or rubrics.");
    } else {
      warnings.push("Task Set references archived tasks or rubrics.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    unresolved,
    hasArchivedRefs,
  };
}

// --- Manifest Materializer ---------------------------------------------------

/**
 * Deterministically sorts members by `order` ascending with stable secondary key.
 */
function sortMembers(members: TaskSetMember[]): TaskSetMember[] {
  return [...members].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    const aKey = `${a.taskVersionRef?.taskId ?? ""}::${a.taskVersionRef?.version ?? 0}::${a.id ?? ""}`;
    const bKey = `${b.taskVersionRef?.taskId ?? ""}::${b.taskVersionRef?.version ?? 0}::${b.id ?? ""}`;
    return aKey.localeCompare(bKey);
  });
}

/**
 * Materializes an immutable execution snapshot from a TaskSetVersion.
 *
 * @throws {DirtyDraftExecutionError} If the options indicate a dirty draft.
 * @throws {UnresolvedWorkloadRefError} If any Task or Rubric ref cannot be resolved.
 * @throws {ArchivedTaskExecutionError} If `allowArchived === false` and archived refs exist.
 */
export function materializeWorkloadManifest(
  version: TaskSetVersion,
  resolvers: WorkloadCatalogResolvers,
  options?: MaterializeWorkloadOptions,
): MaterializedWorkloadSnapshot {
  if (options?.isDirty) {
    throw new DirtyDraftExecutionError();
  }

  const allowArchived = options?.allowArchived ?? true;
  const now = options?.now ?? Date.now();

  const preflight = validateWorkloadForExecution({
    version,
    resolvers,
    isDirty: false,
    allowArchived,
  });

  if (preflight.unresolved.length > 0) {
    throw new UnresolvedWorkloadRefError(preflight.unresolved);
  }

  if (!allowArchived && preflight.hasArchivedRefs) {
    throw new ArchivedTaskExecutionError();
  }

  // Resolve default rubric
  let resolvedDefaultRubric: EvaluationRubric | null = null;
  if (version.defaultRubricRef !== null) {
    const r = resolvers.getRubricVersion?.(version.defaultRubricRef);
    if (!r) {
      throw new UnresolvedWorkloadRefError([
        {
          field: "defaultRubricRef",
          ref: version.defaultRubricRef,
          reason: "Default rubric version ref does not resolve in the catalog.",
        },
      ]);
    }
    resolvedDefaultRubric = deepClone(r);
  }

  const rubricsMap = new Map<string, EvaluationRubric>();
  if (resolvedDefaultRubric) {
    rubricsMap.set(
      `${resolvedDefaultRubric.id}::v${resolvedDefaultRubric.version}`,
      resolvedDefaultRubric,
    );
  }

  const sortedMembers = sortMembers(version.members);
  const materializedTasks: MaterializedTask[] = [];

  for (const member of sortedMembers) {
    if (member.unresolved) {
      throw new UnresolvedWorkloadRefError([
        {
          field: `members[${member.id}]`,
          ref: member.taskVersionRef,
          reason: member.unresolved,
        },
      ]);
    }

    const taskVersion = resolvers.getTaskVersion(member.taskVersionRef);
    if (!taskVersion) {
      throw new UnresolvedWorkloadRefError([
        {
          field: `members[${member.id}].taskVersionRef`,
          ref: member.taskVersionRef,
          reason: "Task version ref does not resolve in the catalog.",
        },
      ]);
    }

    const isTaskArchived = resolvers.isTaskArchived?.(member.taskVersionRef.taskId) ?? false;

    // Resolve effective rubric
    let effectiveRubricRef: VersionRef | null = null;
    let effectiveRubric: EvaluationRubric | null = null;

    if (member.rubricOverrideRef !== null) {
      const overrideR = resolvers.getRubricVersion?.(member.rubricOverrideRef);
      if (!overrideR) {
        throw new UnresolvedWorkloadRefError([
          {
            field: `members[${member.id}].rubricOverrideRef`,
            ref: member.rubricOverrideRef,
            reason: "Rubric override ref does not resolve in the catalog.",
          },
        ]);
      }
      effectiveRubricRef = deepClone(member.rubricOverrideRef);
      effectiveRubric = deepClone(overrideR);
      rubricsMap.set(`${effectiveRubric.id}::v${effectiveRubric.version}`, effectiveRubric);
    } else if (version.defaultRubricRef !== null && resolvedDefaultRubric !== null) {
      effectiveRubricRef = deepClone(version.defaultRubricRef);
      effectiveRubric = resolvedDefaultRubric;
    }

    // Resolve evaluation selection
    const evaluation: TaskEvaluationSelection =
      member.executionOverrides?.evaluation !== undefined
        ? deepClone(member.executionOverrides.evaluation)
        : effectiveRubricRef !== null
          ? { kind: "profile", profile: effectiveRubricRef }
          : { kind: "holistic" };

    const judgeInstructionOverride =
      member.executionOverrides?.judgeInstructionOverride !== undefined
        ? member.executionOverrides.judgeInstructionOverride
        : null;

    const verification =
      member.executionOverrides?.verification !== undefined
        ? deepClone(member.executionOverrides.verification)
        : taskVersion.taskVerifierRef !== null
          ? { kind: "custom_checker" as const }
          : null;

    materializedTasks.push({
      memberId: member.id,
      taskVersionRef: deepClone(member.taskVersionRef),
      order: member.order,
      role: member.role,
      stratum: member.stratum,
      weight: member.weight,
      rubricOverrideRef: member.rubricOverrideRef ? deepClone(member.rubricOverrideRef) : null,
      executionOverrides: member.executionOverrides ? deepClone(member.executionOverrides) : null,
      task: deepClone(taskVersion),
      effectiveRubricRef,
      effectiveRubric,
      evaluation,
      judgeInstructionOverride,
      verification,
      isArchived: isTaskArchived,
    });
  }

  // Deduplicate rubrics list deterministically
  const rubrics = Array.from(rubricsMap.values()).sort((a, b) => {
    if (a.id !== b.id) return a.id.localeCompare(b.id);
    return a.version - b.version;
  });

  const snapshotWithoutFingerprint = {
    taskSetId: version.taskSetId,
    taskSetVersion: version.version,
    tasks: materializedTasks,
    rubrics,
    defaultRubricRef: version.defaultRubricRef ? deepClone(version.defaultRubricRef) : null,
    defaultRubric: resolvedDefaultRubric,
    defaultModelSlots: deepClone(version.defaultModelSlots),
    defaultJudge: deepClone(version.defaultJudge),
    repeatPolicy: deepClone(version.repeatPolicy),
    missingnessPolicy: deepClone(version.missingnessPolicy),
    protocolDefaults: deepClone(version.protocolDefaults),
    createdAt: now,
  };

  const protocolFingerprint = computeWorkloadManifestFingerprint(snapshotWithoutFingerprint);

  return {
    ...snapshotWithoutFingerprint,
    protocolFingerprint,
  };
}

// --- Deterministic Semantic Protocol Fingerprint ------------------------------

/**
 * Builds the canonical semantic fingerprint input for a Workload Manifest.
 * Strictly includes all semantic definition fields (tasks instructions, contracts,
 * verifiers, roles, strata, weights, overrides, roster, judge, rubrics, repeat,
 * missingness, protocol defaults) and excludes non-semantic identifiers and
 * timestamps.
 */
export function buildWorkloadFingerprintInput(
  snapshot: Pick<
    MaterializedWorkloadSnapshot,
    | "tasks"
    | "defaultModelSlots"
    | "defaultJudge"
    | "defaultRubricRef"
    | "repeatPolicy"
    | "missingnessPolicy"
    | "protocolDefaults"
    | "rubrics"
  >,
): unknown {
  return {
    tasks: snapshot.tasks.map((t) => ({
      taskId: t.taskVersionRef.taskId,
      taskVersion: t.taskVersionRef.version,
      title: t.task.title,
      objective: t.task.objective,
      candidateInstruction: t.task.candidateInstruction,
      defaultContextManifest: t.task.defaultContextManifest,
      responseContract: t.task.responseContract,
      taskVerifierRef: t.task.taskVerifierRef,
      order: t.order,
      role: t.role,
      stratum: t.stratum,
      weight: t.weight,
      rubricOverrideRef: t.rubricOverrideRef,
      executionOverrides: t.executionOverrides,
      evaluation: t.evaluation,
      judgeInstructionOverride: t.judgeInstructionOverride,
      verification: t.verification,
    })),
    modelSlots: snapshot.defaultModelSlots.map((s) => ({
      providerId: s.providerId,
      slug: s.slug,
      model: s.model,
      enabled: s.enabled,
    })),
    defaultJudge: {
      providerId: snapshot.defaultJudge.providerId,
      model: snapshot.defaultJudge.model,
      ...(snapshot.defaultJudge.reasoningPolicy !== undefined
        ? { reasoningPolicy: snapshot.defaultJudge.reasoningPolicy }
        : {}),
    },
    defaultRubricRef: snapshot.defaultRubricRef,
    repeatPolicy: snapshot.repeatPolicy,
    missingnessPolicy: snapshot.missingnessPolicy,
    protocolDefaults: snapshot.protocolDefaults,
    rubrics: snapshot.rubrics.map((p) => {
      const groupsPresent = Array.isArray(p.requirementGroups) && p.requirementGroups.length > 0;
      const hasBinary = p.criteria.some((c) => c.kind === "binary");
      const groups = groupsPresent
        ? p.requirementGroups!.map((g) => ({
            name: g.name,
            checkIds: g.checkIds,
            weight: g.weight,
            mode: g.mode,
          }))
        : undefined;
      const lambda = groupsPresent || hasBinary ? (p.complianceInfluence ?? 1.0) : undefined;
      return {
        id: p.id,
        version: p.version,
        name: p.name,
        description: p.description,
        judgeInstruction: p.judgeInstruction,
        criteria: p.criteria,
        requirementGroups: groups,
        complianceInfluence: lambda,
      };
    }),
    aggregationPolicy: "equal-task",
    trialsPerTask:
      snapshot.repeatPolicy.kind === "declared-replicate" ? snapshot.repeatPolicy.count : 1,
  };
}

/**
 * Computes the deterministic SHA-256 protocol fingerprint for a materialized workload snapshot.
 * Returns `sha256:<lowercase 64-hex>`.
 */
export function computeWorkloadManifestFingerprint(
  snapshot: Pick<
    MaterializedWorkloadSnapshot,
    | "tasks"
    | "defaultModelSlots"
    | "defaultJudge"
    | "defaultRubricRef"
    | "repeatPolicy"
    | "missingnessPolicy"
    | "protocolDefaults"
    | "rubrics"
  >,
): string {
  const input = buildWorkloadFingerprintInput(snapshot);
  const canonical = canonicalJsonString(input);
  return hashArtifactContent(canonical);
}
