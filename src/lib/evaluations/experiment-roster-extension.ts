// =============================================================================
// experiment-roster-extension.ts — pure roster-extension planner + rotator
// (roster spec §6).
//
// Extension is an intentional evidence-base extension, NOT a repair:
//  - planRosterExtension decides per task whether the added model can be
//    executed as a compound attempt (reuse accepted outputs + one fresh
//    candidate + fresh Judge) or must fall back to a full-roster attempt;
//  - rotateExperimentRoster appends exactly one enabled slot to the snapshot,
//    recomputes the protocol fingerprint over the rotated snapshot, and
//    appends one history entry. Only `snapshot.modelSlots` and the
//    fingerprints change; everything else is byte-identical.
//
// Pure: no repositories, providers, or mutation of inputs. The controller
// validates through these functions before any paid call (spec §9.1).
// =============================================================================

import type {
  ExperimentRecord,
  ExperimentRosterExtension,
  ExperimentRosterExtensionPlan,
} from "./evaluation-types";
import type { ModelSlot } from "../../studio-data";
import type { RunRecordV2 } from "../persistence/run-types";
import { computeSnapshotProtocolFingerprint } from "./protocol-fingerprint";

/** Terminal experiment statuses eligible for roster extension. */
const TERMINAL_STATUSES: ReadonlySet<ExperimentRecord["status"]> = new Set([
  "completed",
  "completed_with_failures",
  "aborted",
  "interrupted",
]);

const CREDENTIAL_LIKE_KEY = /^(sk-|AIza|Bearer\s)/i;

export interface RosterExtensionTaskPlan {
  taskId: string;
  executionPlan: ExperimentRosterExtensionPlan;
  mode: "compound" | "full-roster";
  candidateCalls: number;
  judgeCalls: 1;
  reusedModelKeys: string[];
}

export interface RosterExtensionPlan {
  addedModelKey: string;
  addedSlot: ModelSlot;
  taskPlans: RosterExtensionTaskPlan[];
  taskCount: number;
  candidateCalls: number;
  judgeCalls: number;
  reusedOutputCount: number;
  fullRosterFallbackCount: number;
  /** Enabled slot count of the ROTATED roster — what a fallback task pays. */
  fullRosterCandidateCount: number;
}

export type RosterExtensionPlanResult =
  | { ok: true; plan: RosterExtensionPlan }
  | { ok: false; reason: string };

export type RosterRotationResult =
  | {
      ok: true;
      record: ExperimentRecord;
      historyEntry: ExperimentRosterExtension;
    }
  | { ok: false; reason: string };

/** Provider-scoped model key — the extension identity. */
export function modelKeyOf(slot: Pick<ModelSlot, "providerId" | "slug">): string {
  return `${slot.providerId}:${slot.slug}`;
}

/** All model keys already present: snapshot roster + extension history. */
export function takenModelKeys(experiment: ExperimentRecord): Set<string> {
  const keys = new Set<string>(
    experiment.snapshot.modelSlots.map((s) => modelKeyOf(s)),
  );
  for (const entry of experiment.rosterExtensions ?? []) {
    keys.add(entry.addedModelKey);
  }
  return keys;
}

/**
 * Plan a roster extension: one attempt per snapshot task, compound where the
 * selected attempt supplies reusable accepted outputs, full-roster otherwise.
 *
 * Pure. `resolveRunRecord` reads the already-loaded run cache synchronously —
 * the caller pre-loads every selected attempt's run (same pattern as
 * `repairMissingCells`).
 */
export function planRosterExtension(input: {
  experiment: ExperimentRecord;
  slot: ModelSlot;
  resolveRunRecord: (runId: string) => RunRecordV2 | null;
}): RosterExtensionPlanResult {
  const { experiment, slot, resolveRunRecord } = input;

  if (!TERMINAL_STATUSES.has(experiment.status)) {
    return {
      ok: false,
      reason: `Roster extension requires a terminal experiment, not ${experiment.status}.`,
    };
  }
  if (!slot || typeof slot.providerId !== "string" || typeof slot.slug !== "string") {
    return { ok: false, reason: "A valid model slot is required." };
  }
  if (slot.providerId.length === 0 || slot.slug.length === 0) {
    return { ok: false, reason: "The model slot needs a provider and slug." };
  }
  if (slot.enabled !== true) {
    return { ok: false, reason: "The added model slot must be enabled." };
  }
  const addedModelKey = modelKeyOf(slot);
  if (CREDENTIAL_LIKE_KEY.test(addedModelKey)) {
    return { ok: false, reason: "The model key looks like a credential and is rejected." };
  }
  if (takenModelKeys(experiment).has(addedModelKey)) {
    return {
      ok: false,
      reason: `Model ${addedModelKey} is already in this experiment's roster.`,
    };
  }

  const rotatedEnabledCount =
    experiment.snapshot.modelSlots.filter((s) => s.enabled).length + 1;
  const fullRosterCandidateCount = rotatedEnabledCount;

  const taskPlans: RosterExtensionTaskPlan[] = [];
  for (const task of experiment.snapshot.tasks) {
    const taskPlan = planTask({
      experiment,
      taskId: task.id,
      addedModelKey,
      fullRosterCandidateCount,
      resolveRunRecord,
    });
    taskPlans.push(taskPlan);
  }

  const fullRosterFallbackCount = taskPlans.filter(
    (p) => p.mode === "full-roster",
  ).length;
  const reusedOutputCount = taskPlans.reduce(
    (sum, p) => sum + p.reusedModelKeys.length,
    0,
  );

  return {
    ok: true,
    plan: {
      addedModelKey,
      addedSlot: { ...slot },
      taskPlans,
      taskCount: taskPlans.length,
      candidateCalls: taskPlans.reduce((sum, p) => sum + p.candidateCalls, 0),
      judgeCalls: taskPlans.length,
      reusedOutputCount,
      fullRosterFallbackCount,
      fullRosterCandidateCount,
    },
  };
}

/** Per-task decision (spec §6.2 table). */
function planTask(input: {
  experiment: ExperimentRecord;
  taskId: string;
  addedModelKey: string;
  fullRosterCandidateCount: number;
  resolveRunRecord: (runId: string) => RunRecordV2 | null;
}): RosterExtensionTaskPlan {
  const { experiment, taskId, addedModelKey, fullRosterCandidateCount, resolveRunRecord } = input;

  const fallback = (
    baseRunId?: string,
  ): RosterExtensionTaskPlan => ({
    taskId,
    executionPlan: {
      kind: "roster-extension",
      addedModelKey,
      ...(baseRunId !== undefined ? { baseRunId } : {}),
    },
    mode: "full-roster",
    candidateCalls: fullRosterCandidateCount,
    judgeCalls: 1,
    reusedModelKeys: [],
  });

  // Full roster when there are no attempts, no selected attempt, or no run.
  const taskState = experiment.tasks.find((t) => t.taskId === taskId);
  const selected = taskState?.selectedAttemptId
    ? taskState.attempts.find((a) => a.id === taskState.selectedAttemptId)
    : undefined;
  if (!selected || !selected.runId) return fallback();

  // Terminal selected attempt with a loadable run.
  const run = resolveRunRecord(selected.runId);
  if (!run) return fallback();

  // ≥1 accepted candidate output whose accepted attempt exists and completed.
  const reusable = run.candidates.filter((c) => {
    if (c.acceptedAttemptId === null) return false;
    const attempt = c.attempts.find((a) => a.attemptId === c.acceptedAttemptId);
    return attempt !== undefined && attempt.status === "completed";
  });
  if (reusable.length === 0) return fallback();

  // Identity guards: same experiment, suite/version, task, selected attempt,
  // and the CURRENT pre-extension protocol fingerprint. Mismatch → full
  // roster, never cross-boundary reuse.
  if (run.source.kind !== "experiment") return fallback();
  const src = run.source;
  if (src.experimentId !== experiment.id) return fallback();
  if (src.suiteId !== experiment.suiteId || src.suiteVersion !== experiment.suiteVersion) {
    return fallback();
  }
  if (src.taskId !== taskId) return fallback();
  if (src.experimentTaskAttemptId !== selected.id) return fallback();
  if (src.protocolFingerprint !== experiment.protocolFingerprint) return fallback();

  return {
    taskId,
    executionPlan: {
      kind: "roster-extension",
      addedModelKey,
      baseRunId: run.id,
    },
    mode: "compound",
    candidateCalls: 1,
    judgeCalls: 1,
    reusedModelKeys: reusable.map((c) => c.modelKey),
  };
}

/**
 * Rotate the snapshot roster by appending exactly one enabled slot and
 * recomputing the protocol fingerprint over the rotated snapshot (spec §6.1,
 * §6.5). Returns a NEW record; the input experiment is never mutated. The
 * record is left terminal — the engine queue transition owns `running`.
 */
export function rotateExperimentRoster(input: {
  experiment: ExperimentRecord;
  slot: ModelSlot;
  extendedAt: number;
}): RosterRotationResult {
  const { experiment, slot, extendedAt } = input;

  if (!slot || typeof slot.providerId !== "string" || typeof slot.slug !== "string") {
    return { ok: false, reason: "A valid model slot is required." };
  }
  if (slot.enabled !== true) {
    return { ok: false, reason: "The added model slot must be enabled." };
  }
  if (!Number.isFinite(extendedAt) || extendedAt < 0) {
    return { ok: false, reason: "extendedAt must be a finite non-negative timestamp." };
  }
  const addedModelKey = modelKeyOf(slot);
  if (CREDENTIAL_LIKE_KEY.test(addedModelKey)) {
    return { ok: false, reason: "The model key looks like a credential and is rejected." };
  }
  if (takenModelKeys(experiment).has(addedModelKey)) {
    return {
      ok: false,
      reason: `Model ${addedModelKey} is already in this experiment's roster.`,
    };
  }

  const priorFingerprint = experiment.snapshot.protocolFingerprint;
  const appendedSlot: ModelSlot = JSON.parse(JSON.stringify(slot)) as ModelSlot;

  // Only the roster changes; everything else is byte-identical.
  const rotatedSnapshot = {
    ...experiment.snapshot,
    modelSlots: [...experiment.snapshot.modelSlots, appendedSlot],
  };
  const newFingerprint = computeSnapshotProtocolFingerprint(rotatedSnapshot);
  rotatedSnapshot.protocolFingerprint = newFingerprint;

  const historyEntry: ExperimentRosterExtension = {
    addedModelKey,
    addedSlot: appendedSlot,
    priorFingerprint,
    extendedAt,
  };

  const record: ExperimentRecord = {
    ...experiment,
    protocolFingerprint: newFingerprint,
    snapshot: rotatedSnapshot,
    rosterExtensions: [
      ...(experiment.rosterExtensions ?? []),
      historyEntry,
    ],
  };

  return { ok: true, record, historyEntry };
}
