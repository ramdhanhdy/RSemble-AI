// =============================================================================
// RSemble AI — Deprecated EvaluationSuite compatibility adapter
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 1.
//
// Isolated, deprecated serialized/input adapter (spec §8.3). Projects a legacy
// `EvaluationSuite` into the canonical Task Set vocabulary so new editors,
// repositories, and routes can read frozen Suite data through Task Set names
// and references during rollout.
//
// Hard rules enforced here:
//  - The adapter NEVER makes Suite canonical. Without a crosswalk that maps
//    each embedded legacy task to an exact canonical Task Version, every
//    member is recorded as `unresolved` (spec §8.2): it never substitutes the
//    latest task, invents a synthetic task id, or drops the member.
//  - The adapter NEVER mutates source values. All projections return fresh
//    objects/arrays; the input suite is left byte-identical.
//  - Current serialized semantics are preserved: order, model slots, judge
//    identity, default evaluation (holistic → null defaultRubricRef; pinned
//    profile → defaultRubricRef), per-task evaluation/judge-instruction/
//    verification overrides, suite-level reasoningPolicy (→ protocolDefaults),
//    and the shipped missing-cell repair behavior (→ allow-repair). Legacy
//    suites have no repeat concept (→ repeatPolicy { kind: "none" }).
//
// No migration, persistence, materialization, fingerprinting, UI/routes,
// archive, execution/controller, or provider calls live here — those are
// later tasks. This module is types + pure projection only.
// =============================================================================

import type { EvaluationSuite, EvaluationTask } from "./evaluation-types";
import type { RubricVersionRef } from "./evaluation-types";
import type {
  JudgeSnapshot,
  ProtocolDefaults,
  TaskExecutionOverrides,
  TaskSetMember,
  TaskSetRecord,
  TaskSetVersion,
  TaskVersionRef,
} from "./task-set-types";

/** Maps a legacy embedded `EvaluationTask` to an exact canonical Task Version
 *  ref, or returns `null` when the task cannot map (unresolved member). The
 *  crosswalk is supplied by the migration layer (child 02 crosswalk, Task 4);
 *  the adapter itself owns no crosswalk. */
export type TaskCrosswalk = (task: EvaluationTask) => TaskVersionRef | null;

/** Reason recorded on unresolved members when no crosswalk is supplied. */
const NO_CROSSWALK_REASON = "no-crosswalk";

/** Reason recorded on unresolved members when the crosswalk could not map the
 *  embedded task to a canonical Task Version. */
const UNMAPPED_REASON = "unmapped";

/**
 * Project a legacy `EvaluationSuite` to a canonical `TaskSetRecord` (spec §3.1,
 * §8.1). The record carries `origin: "legacy-suite"` and preserves id, name,
 * description, version/revision, and lifecycle timestamps. Does not mutate the
 * source suite.
 */
export function suiteToTaskSetRecord(suite: EvaluationSuite): TaskSetRecord {
  return {
    id: suite.id,
    latestVersion: suite.version,
    name: suite.name,
    description: suite.description,
    createdAt: suite.createdAt,
    updatedAt: suite.updatedAt,
    archivedAt: suite.archivedAt,
    revision: suite.revision,
    origin: "legacy-suite",
  };
}

/**
 * Project a legacy `EvaluationSuite` to a canonical `TaskSetVersion` (spec
 * §3.2, §8.1, §8.2). Members are derived from `suite.tasks`; each member's
 * `taskVersionRef` is resolved through the optional `crosswalk`. Without a
 * crosswalk, or when the crosswalk returns `null` for a task, the member is
 * recorded as `unresolved` and its `taskVersionRef` is a deterministic
 * placeholder — it never substitutes the latest task or drops the member.
 *
 * Returns the projected version plus the list of member ids that remained
 * unresolved. Does not mutate the source suite.
 */
export function suiteToTaskSetVersion(
  suite: EvaluationSuite,
  crosswalk?: TaskCrosswalk,
): { version: TaskSetVersion; unresolvedMemberIds: string[] } {
  const unresolvedMemberIds: string[] = [];
  const members: TaskSetMember[] = suite.tasks.map((task) => {
    const resolved = crosswalk ? crosswalk(task) : null;
    const unresolvedReason =
      crosswalk === undefined ? NO_CROSSWALK_REASON : resolved === null ? UNMAPPED_REASON : null;

    if (unresolvedReason !== null) {
      unresolvedMemberIds.push(task.id);
    }

    return {
      id: task.id,
      taskVersionRef: resolved ?? { taskId: "", version: 0 },
      order: task.order,
      role: "organic",
      stratum: null,
      weight: 1,
      rubricOverrideRef: rubricOverrideRefFromTask(task),
      executionOverrides: executionOverridesFromTask(task),
      unresolved: unresolvedReason,
    };
  });

  const version: TaskSetVersion = {
    taskSetId: suite.id,
    version: suite.version,
    members,
    defaultRubricRef: defaultRubricRefFromSuite(suite),
    defaultModelSlots: suite.modelSlots.map((s) => ({ ...s })),
    defaultJudge: judgeSnapshotFromSuite(suite),
    repeatPolicy: { kind: "none" },
    missingnessPolicy: { kind: "allow-repair" },
    protocolDefaults: protocolDefaultsFromSuite(suite),
    createdAt: suite.updatedAt,
  };

  return { version, unresolvedMemberIds };
}

// --- projection helpers (pure, no source mutation) -------------------------

/** Holistic default evaluation → null; pinned profile → its version ref. */
function defaultRubricRefFromSuite(suite: EvaluationSuite): RubricVersionRef | null {
  const sel = suite.defaultEvaluation;
  if (sel.kind === "profile") return { id: sel.profile.id, version: sel.profile.version };
  return null;
}

/** Per-task rubric override: a pinned profile selection projects to its ref;
 *  inherit/holistic project to null (the member inherits the set default). */
function rubricOverrideRefFromTask(task: EvaluationTask): RubricVersionRef | null {
  const sel = task.evaluation;
  if (sel.kind === "profile") return { id: sel.profile.id, version: sel.profile.version };
  return null;
}

/** Preserve the legacy per-task execution fields as a TaskExecutionOverrides
 *  projection. Always populated for legacy-derived members (legacy tasks
 *  always carry evaluation + judgeInstructionOverride). */
function executionOverridesFromTask(task: EvaluationTask): TaskExecutionOverrides {
  const overrides: TaskExecutionOverrides = {
    evaluation: task.evaluation,
    judgeInstructionOverride: task.judgeInstructionOverride,
  };
  if (task.verification !== undefined) {
    overrides.verification = task.verification;
  }
  return overrides;
}

/** Judge identity from the legacy CriticRef. The suite-level reasoningPolicy
 *  is carried on ProtocolDefaults (preserving the legacy placement), not on
 *  the judge snapshot. */
function judgeSnapshotFromSuite(suite: EvaluationSuite): JudgeSnapshot {
  return {
    providerId: suite.defaultJudge.providerId,
    model: suite.defaultJudge.model,
  };
}

/** Protocol-level defaults projected from the suite. The optional suite-level
 *  reasoningPolicy is preserved here when present. */
function protocolDefaultsFromSuite(suite: EvaluationSuite): ProtocolDefaults {
  const defaults: ProtocolDefaults = {};
  if (suite.reasoningPolicy !== undefined) {
    defaults.reasoningPolicy = {
      candidates: suite.reasoningPolicy.candidates,
      judge: suite.reasoningPolicy.judge,
    };
  }
  return defaults;
}
