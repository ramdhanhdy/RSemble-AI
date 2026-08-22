// =============================================================================
// RSemble AI — Policy Playbook compatibility evaluation (spec §8, Task 10).
//
// Pure evaluation of whether a Policy Playbook applies to the current Compare
// context. Enforces:
//   - Exact playbook version identity (no latest/follow semantics);
//   - Provenance: playbook ↔ study definition fingerprint round trip;
//   - Study lifecycle: completed/sealed/archived only;
//   - Workload: pinned Task Set Version context or exact member task binding;
//   - Model pool: all candidate model configurations must be pool members.
// =============================================================================

import {
  POLICY_REPORT_SCHEMA_VERSION,
  type ExactModelConfigurationRef,
  type PolicyReportPayload,
  type PolicyStudyRecord,
} from "./policy-study-types";
import type { ModelPoolVersion } from "../model-pool-types";
import { exactModelConfigRefFor } from "../../../workspaces/lab/lab-draft";
import type { CriticRef } from "../../providers/types";

export interface PinnedTaskSetVersionView {
  taskSetId: string;
  version: number;
  members?: Array<{
    taskVersionRef: {
      taskId: string;
      taskVersion?: number;
      version?: number;
    };
  }>;
  taskIds?: string[];
}

export interface PlaybookCompatibilityInput {
  playbookId?: string;
  playbook: PolicyReportPayload;
  study: PolicyStudyRecord;
  pinnedTaskSetVersion?: PinnedTaskSetVersionView | null;
  poolVersion?: ModelPoolVersion | null;
  candidateConfigurations?: ExactModelConfigurationRef[];
  taskBinding?:
    | { kind: "canonical"; taskId: string; taskVersion?: number }
    | { kind: "ad_hoc"; inputSnapshotRef: string }
    | null;
  taskSetContext?: { taskSetId: string; version: number } | null;
  /** Session judge (F4): when provided, must match study.definition.judge1 or
   *  judge2 by exact model configuration id. */
  judge?: { providerId: string; model: string } | null;
  /** Session rubric pin (F4): when provided, must match study.definition.rubric. */
  rubric?: { rubricId: string; version: number } | null;
}

export type PlaybookCompatibilityFailureCode =
  | "playbook_id_required"
  | "playbook_study_mismatch"
  | "definition_fingerprint_mismatch"
  | "study_not_sealed"
  | "report_schema_mismatch"
  | "workload_context_mismatch"
  | "task_not_in_pinned_workload"
  | "workload_decision_required"
  | "workload_unresolved"
  | "candidates_required"
  | "candidate_not_in_pool"
  | "pool_unresolved"
  | "judge_pin_mismatch"
  | "rubric_pin_mismatch";
export interface PlaybookCompatibilityReceipt {
  playbookId: string;
  studyId: string;
  definitionFingerprint: string;
  workloadBasis: "task_set_context" | "pinned_workload_member";
  workload: { taskSetId: string; version: number };
  pool?: { poolId: string; version: number };
  matchedCandidateIds: string[];
  evaluatedAt: number;
}

export type PlaybookCompatibilityOutcome =
  | { ok: true; receipt: PlaybookCompatibilityReceipt }
  | { ok: false; code: PlaybookCompatibilityFailureCode; reason: string };

/**
 * Resolve providerId + model to exact model configuration ref.
 */
export function modelConfigRefForIdentity(
  providerId: string,
  model: string,
): ExactModelConfigurationRef {
  return exactModelConfigRefFor({
    providerId: providerId as CriticRef["providerId"],
    model,
  });
}

/**
 * Evaluate whether a Policy Playbook is compatible with the given compare context.
 */
export function evaluatePlaybookCompatibility(
  input: PlaybookCompatibilityInput,
): PlaybookCompatibilityOutcome {
  // 1. Playbook ID must be non-empty when provided
  if (input.playbookId !== undefined && input.playbookId.trim().length === 0) {
    return {
      ok: false,
      code: "playbook_id_required",
      reason: "Playbook id required — latest/follow semantics are not permitted.",
    };
  }

  // 2. Playbook <-> Study ID
  if (input.playbook.studyId !== input.study.id) {
    return {
      ok: false,
      code: "playbook_study_mismatch",
      reason: `Playbook studyId "${input.playbook.studyId}" does not match study id "${input.study.id}".`,
    };
  }

  // 3. Definition fingerprint
  if (input.playbook.definitionFingerprint !== input.study.definitionFingerprint) {
    return {
      ok: false,
      code: "definition_fingerprint_mismatch",
      reason: "Definition fingerprint mismatch between playbook and study record.",
    };
  }

  // 4. Study sealed / completed / archived
  if (
    input.study.status !== "completed" &&
    (input.study.status as string) !== "sealed" &&
    input.study.status !== "archived"
  ) {
    return {
      ok: false,
      code: "study_not_sealed",
      reason: `Study status is "${input.study.status}"; only completed, sealed, or archived studies can produce playbooks.`,
    };
  }

  // 5. Report schema version
  if (input.playbook.reportSchemaVersion !== POLICY_REPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "report_schema_mismatch",
      reason: `Unsupported report schema version ${input.playbook.reportSchemaVersion}.`,
    };
  }

  // 6. Workload context
  const pinnedWorkload = input.study.definition.workload;

  if (input.taskBinding?.kind === "ad_hoc") {
    return {
      ok: false,
      code: "workload_decision_required",
      reason:
        "Ad-hoc comparisons require an explicit workload decision before applying a playbook.",
    };
  }

  if (
    !input.pinnedTaskSetVersion ||
    input.pinnedTaskSetVersion.taskSetId !== pinnedWorkload.taskSetId ||
    input.pinnedTaskSetVersion.version !== pinnedWorkload.version
  ) {
    return {
      ok: false,
      code: "workload_unresolved",
      reason: "Pinned Task Set Version cannot be resolved or does not match pinned study workload.",
    };
  }

  let workloadBasis: "task_set_context" | "pinned_workload_member" = "task_set_context";

  if (input.taskSetContext) {
    if (
      input.taskSetContext.taskSetId !== pinnedWorkload.taskSetId ||
      input.taskSetContext.version !== pinnedWorkload.version
    ) {
      return {
        ok: false,
        code: "workload_context_mismatch",
        reason: `Task Set context (${input.taskSetContext.taskSetId}@v${input.taskSetContext.version}) differs from pinned workload (${pinnedWorkload.taskSetId}@v${pinnedWorkload.version}).`,
      };
    }
    workloadBasis = "task_set_context";
  } else if (input.taskBinding?.kind === "canonical") {
    const taskId = input.taskBinding.taskId;
    const isMember =
      input.pinnedTaskSetVersion.members?.some(
        (m) =>
          m.taskVersionRef.taskId === taskId &&
          (input.taskBinding?.kind === "canonical" && input.taskBinding.taskVersion !== undefined
            ? (m.taskVersionRef.taskVersion ?? m.taskVersionRef.version) ===
              input.taskBinding.taskVersion
            : true),
      ) ||
      input.pinnedTaskSetVersion.members?.some((m) => m.taskVersionRef.taskId === taskId) ||
      input.pinnedTaskSetVersion.taskIds?.includes(taskId);

    if (!isMember) {
      return {
        ok: false,
        code: "task_not_in_pinned_workload",
        reason: `Canonical Task "${taskId}" is not a member of pinned workload ${pinnedWorkload.taskSetId}@v${pinnedWorkload.version}.`,
      };
    }
    workloadBasis = "pinned_workload_member";
  } else {
    workloadBasis = "task_set_context";
  }

  // 7. Candidate configurations and model pool
  if (input.candidateConfigurations && input.candidateConfigurations.length === 0) {
    return {
      ok: false,
      code: "candidates_required",
      reason: "Candidate configurations list cannot be empty.",
    };
  }

  const pinnedPool = input.study.definition.modelPool;
  if (
    !input.poolVersion ||
    input.poolVersion.poolId !== pinnedPool.poolId ||
    input.poolVersion.version !== pinnedPool.version ||
    input.poolVersion.digest !== pinnedPool.digest
  ) {
    return {
      ok: false,
      code: "pool_unresolved",
      reason: `Pinned Model Pool Version unresolved or mismatched (expected ${pinnedPool.poolId}@v${pinnedPool.version}).`,
    };
  }

  if (input.candidateConfigurations) {
    const poolConfigIds = new Set<string>();
    for (const slot of [...input.poolVersion.core, ...input.poolVersion.challengers]) {
      poolConfigIds.add(slot.id);
      poolConfigIds.add(modelConfigRefForIdentity(slot.providerId, slot.model).id);
      if (slot.slug) {
        poolConfigIds.add(modelConfigRefForIdentity(slot.providerId, slot.slug).id);
      }
    }

    for (const cand of input.candidateConfigurations) {
      if (!poolConfigIds.has(cand.id)) {
        return {
          ok: false,
          code: "candidate_not_in_pool",
          reason: `Candidate configuration "${cand.id}" is not in the pinned model pool (${pinnedPool.poolId}@v${pinnedPool.version}).`,
        };
      }
    }
  }
  // F4: judge and rubric pin enforcement. The session's judge (critic) must
  // match study.definition.judge1 or judge2 by exact model configuration id,
  // and the session's rubric pin must match study.definition.rubric.
  if (input.judge) {
    const judgeRef = modelConfigRefForIdentity(input.judge.providerId, input.judge.model);
    const pinnedJudgeIds = new Set([
      input.study.definition.judge1?.id,
      input.study.definition.judge2?.id,
    ]);
    if (!pinnedJudgeIds.has(judgeRef.id)) {
      return {
        ok: false,
        code: "judge_pin_mismatch",
        reason: `Session judge "${judgeRef.id}" does not match the study's pinned judges.`,
      };
    }
  }

  if (input.rubric) {
    const pinned = input.study.definition.rubric;
    if (
      !pinned ||
      pinned.rubricId !== input.rubric.rubricId ||
      pinned.version !== input.rubric.version
    ) {
      return {
        ok: false,
        code: "rubric_pin_mismatch",
        reason: `Session rubric "${input.rubric.rubricId}@v${input.rubric.version}" does not match the study's pinned rubric.`,
      };
    }
  }

  const matchedCandidateIds = (input.candidateConfigurations ?? []).map((c) => c.id).sort();

  const rawPlaybook = input.playbook as unknown;
  const playbookId =
    input.playbookId ??
    (rawPlaybook &&
    typeof rawPlaybook === "object" &&
    "id" in rawPlaybook &&
    typeof (rawPlaybook as { id: unknown }).id === "string"
      ? (rawPlaybook as { id: string }).id
      : null) ??
    input.study.reportRef ??
    "pb-1";
  return {
    ok: true,
    receipt: {
      playbookId,
      studyId: input.study.id,
      definitionFingerprint: input.study.definitionFingerprint,
      workloadBasis,
      workload: {
        taskSetId: pinnedWorkload.taskSetId,
        version: pinnedWorkload.version,
      },
      pool: {
        poolId: pinnedPool.poolId,
        version: pinnedPool.version,
      },
      matchedCandidateIds,
      evaluatedAt: Date.now(),
    },
  };
}
