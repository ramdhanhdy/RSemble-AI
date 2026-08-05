// =============================================================================
// experiment-repair.ts — pure compound-repair planner (spec §11, Task 9).
//
// Derives safe repair targets and a fresh full-roster run seed WITHOUT
// provider or persistence side effects. The controller calls this planner,
// validates through it, then executes with the executor.
//
// Repairability (spec §11.2): a missing cell is target-repairable only when
//   - the task has a selected partial attempt, or a selected completed attempt
//     from a trusted pre-extension protocol snapshot;
//   - its selected run record is available;
//   - that run has accepted outputs for at least one other candidate;
//   - the cell reason is "no-score";
//   - the protocol is unchanged, except for append-only roster extensions;
//   - the target model remains in the immutable snapshot roster.
// `no-attempt`, `no-accepted-attempt`, and `evidence-missing` require a full
// task retry.
// =============================================================================

import type { ExperimentRecord } from "./evaluation-types";
import type { ExperimentAggregation } from "./experiment-aggregation";
import type { RunRecordV2 } from "../persistence/run-types";

export interface RepairRequest {
  taskId: string;
  modelKeys: string[];
}

export interface CompoundRepairPlan {
  taskId: string;
  baseRunId: string;
  requestedModelKeys: string[];
  reusedModelKeys: string[];
  candidateCalls: number;
  judgeCalls: 1;
}

export type RepairPlanResult = { ok: true; plan: CompoundRepairPlan } | { ok: false; reason: string };

/**
 * Plan a targeted missing-cell repair for one task.
 *
 * Pure: never touches repositories, providers, or the base run. The caller
 * supplies `resolveRunRecord` so the planner can inspect the selected run's
 * accepted candidates.
 */
export function planMissingCellRepair(input: {
  experiment: ExperimentRecord;
  aggregation: ExperimentAggregation;
  request: RepairRequest;
  resolveRunRecord: (runId: string) => RunRecordV2 | null;
}): RepairPlanResult {
  const { experiment, aggregation, request, resolveRunRecord } = input;

  // Reject blank or duplicate requested keys deterministically.
  const requested = [...new Set(request.modelKeys)].filter((k) => k.length > 0);
  if (requested.length === 0) {
    return { ok: false, reason: "No model keys requested for repair." };
  }
  if (requested.length !== request.modelKeys.length) {
    return { ok: false, reason: "Duplicate model keys in repair request." };
  }

  // The task must exist in the snapshot roster.
  const task = experiment.snapshot.tasks.find((t) => t.id === request.taskId);
  if (!task) {
    return { ok: false, reason: `Task ${request.taskId} not found in the experiment snapshot.` };
  }

  // The target model must remain in the immutable snapshot roster.
  const snapshotKeys = new Set(experiment.snapshot.modelSlots.map((s) => `${s.providerId}:${s.slug}`));
  for (const key of requested) {
    if (!snapshotKeys.has(key)) {
      return { ok: false, reason: `Model ${key} is not in the experiment snapshot roster.` };
    }
  }

  // Locate the task's cell states in the aggregation.
  const taskIndex = aggregation.taskIds.indexOf(request.taskId);
  if (taskIndex === -1) {
    return { ok: false, reason: `Task ${request.taskId} has no aggregation cells.` };
  }
  const rowCells = aggregation.cells[taskIndex] ?? [];

  // Every requested cell must be missing with reason "no-score".
  const requestedIndices = requested.map((key) => aggregation.modelKeys.indexOf(key));
  if (requestedIndices.some((i) => i === -1)) {
    return { ok: false, reason: "Requested model key is not in the aggregation roster." };
  }
  for (const idx of requestedIndices) {
    const cell = rowCells[idx];
    if (!cell || cell.kind !== "missing" || cell.reason !== "no-score") {
      return { ok: false, reason: "Only no-score cells are target-repairable." };
    }
  }

  // The task must have a selected attempt whose run is available. Status and
  // protocol-lineage eligibility are checked together below.
  const taskState = experiment.tasks.find((t) => t.taskId === request.taskId);
  const selectedAttempt = taskState?.selectedAttemptId
    ? taskState.attempts.find((a) => a.id === taskState.selectedAttemptId)
    : undefined;
  if (!taskState || !selectedAttempt || !selectedAttempt.runId) {
    return { ok: false, reason: "Task has no selected run to repair against." };
  }
  const baseRun = resolveRunRecord(selectedAttempt.runId);
  if (!baseRun) {
    return { ok: false, reason: "Selected run record is unavailable — evidence-missing cells require a full task retry." };
  }
  // Verify the base run is from this experiment, task, and protocol lineage —
  // never reuse outputs across experiment/task/protocol boundaries.
  if (baseRun.id !== selectedAttempt.runId) {
    return { ok: false, reason: "Base run ID does not match the selected attempt." };
  }
  if (baseRun.source.kind !== "experiment") {
    return { ok: false, reason: "Base run is not an experiment run." };
  }
  const src = baseRun.source;
  if (src.experimentId !== experiment.id) {
    return { ok: false, reason: "Base run belongs to a different experiment." };
  }
  if (src.suiteId !== experiment.suiteId || src.suiteVersion !== experiment.suiteVersion) {
    return { ok: false, reason: "Base run belongs to a different suite version." };
  }
  if (src.taskId !== request.taskId) {
    return { ok: false, reason: "Base run belongs to a different task." };
  }
  const sameProtocol = src.protocolFingerprint === experiment.protocolFingerprint;
  const extensionHistory = experiment.rosterExtensions ?? [];
  const ancestorIndex = extensionHistory.findIndex(
    (extension) => extension.priorFingerprint === src.protocolFingerprint,
  );
  const allowedExtensionKeys = new Set(
    ancestorIndex >= 0
      ? extensionHistory.slice(ancestorIndex).map((extension) => extension.addedModelKey)
      : [],
  );
  const trustedRosterExtension =
    !sameProtocol &&
    ancestorIndex >= 0 &&
    requested.every((modelKey) => allowedExtensionKeys.has(modelKey));
  if (!sameProtocol && !trustedRosterExtension) {
    return {
      ok: false,
      reason: "Base run protocol fingerprint does not match the experiment or its roster-extension lineage.",
    };
  }
  if (
    selectedAttempt.status !== "partial" &&
    !(selectedAttempt.status === "completed" && trustedRosterExtension)
  ) {
    return {
      ok: false,
      reason: "Targeted repair requires a selected partial attempt or a trusted pre-extension completed attempt.",
    };
  }

  // The selected run must have accepted outputs for at least one other
  // candidate (so reuse is possible).
  const acceptedCandidateIds = new Set(
    baseRun.candidates.filter((c) => c.acceptedAttemptId !== null).map((c) => c.candidateId),
  );
  const requestedCandidateIds = new Set(
    baseRun.candidates.filter((c) => requested.includes(c.modelKey)).map((c) => c.candidateId),
  );
  const reusableCandidateIds = [...acceptedCandidateIds].filter((id) => !requestedCandidateIds.has(id));
  if (reusableCandidateIds.length === 0) {
    return { ok: false, reason: "No accepted candidate outputs available to reuse for this repair." };
  }

  // Reused model keys = accepted candidates NOT in the requested set.
  const reusedModelKeys = baseRun.candidates
    .filter((c) => c.acceptedAttemptId !== null && !requested.includes(c.modelKey))
    .map((c) => c.modelKey);

  const candidateCalls = requested.length;

  return {
    ok: true,
    plan: {
      taskId: request.taskId,
      baseRunId: baseRun.id,
      requestedModelKeys: requested,
      reusedModelKeys,
      candidateCalls,
      judgeCalls: 1,
    },
  };
}
