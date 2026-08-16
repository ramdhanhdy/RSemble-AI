// =============================================================================
// RSemble AI — Evidence counting invariants (spec §6, §17)
//
// Pure grouping/selection over an append-only lineage ledger. Locks the
// no-inflation rules:
//
//  - one active observation per lineage cell (latest event wins; a tie is
//    reported as a violation, never silently deduplicated);
//  - Task / version / instance / observation / replicate / attempt counts are
//    reported separately;
//  - attempt counts include every retry and copy (audit), never as samples;
//  - only declared (pre-planned) replicates count as replicates;
//  - response samples are distinct generated outputs among active rows:
//    reuse events carry the original candidate attempt id, so a reused
//    output counts once, under the generation that produced it — existing-
//    model sample counts never increase;
//  - reuse events are counted separately as reused assessment events;
//  - multiple judge events on one output change the active assessment without
//    changing observation counts;
//  - declared paired cells are complete only when both sides are active.
// =============================================================================

export interface EvidenceLedgerRow {
  /** Stable lineage cell identity (source task cell × model configuration). */
  lineageCellKey: string;
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  modelConfigurationId: string;
  /** Monotonic event sequence within the lineage cell. */
  sequence: number;
  /** Original candidate attempt id of this cell's output. */
  candidateAttemptId: string;
  /** True when this event reused an earlier output (roster extension/repair). */
  reusedCandidateOutput: boolean;
  /** True when the frozen protocol planned this execution as a replicate. */
  declaredReplicate: boolean;
  assessmentEventId: string | null;
  /** Every attempt id contributing to this event, including failed retries. */
  attemptIds: string[];
}

export interface EvidenceCountInput {
  rows: EvidenceLedgerRow[];
  /** Declared paired cells: both model configurations must be active. */
  declaredPairs: Array<{ taskId: string; a: string; b: string }>;
}

export interface EvidenceCounts {
  taskCount: number;
  versionCountByTask: Record<string, number>;
  instanceCountByTask: Record<string, number>;
  activeObservationCount: number;
  replicateCount: number;
  attemptCount: number;
  assessmentEventCount: number;
  /** Distinct generated outputs among active rows (reuse never inflates). */
  responseSampleCount: number;
  responseSampleCountByConfiguration: Record<string, number>;
  /** Active rows whose output was reused from an earlier run (spec §6.3). */
  reusedAssessmentEventCount: number;
  pairedCoverage: {
    declaredPairCount: number;
    completePairCount: number;
    complete: boolean;
  };
  /** Lineage cells whose "one active observation" invariant was violated. */
  lineageCellViolations: string[];
}

export function countEvidence(input: EvidenceCountInput): EvidenceCounts {
  const rows = input.rows;

  // --- Active selection per lineage cell ------------------------------------------
  const byCell = new Map<string, EvidenceLedgerRow[]>();
  for (const r of rows) {
    const bucket = byCell.get(r.lineageCellKey);
    if (bucket) bucket.push(r);
    else byCell.set(r.lineageCellKey, [r]);
  }

  const activeRows: EvidenceLedgerRow[] = [];
  const lineageCellViolations: string[] = [];
  for (const [cellKey, cellRows] of byCell) {
    let maxSequence = cellRows[0].sequence;
    for (const r of cellRows) {
      if (r.sequence > maxSequence) maxSequence = r.sequence;
    }
    const active = cellRows.filter((r) => r.sequence === maxSequence);
    if (active.length > 1) {
      lineageCellViolations.push(
        `${cellKey} has ${active.length} active rows at sequence ${maxSequence} — one active observation per lineage cell required.`,
      );
    }
    activeRows.push(...active);
  }

  // --- Coverage counts (active rows only) ------------------------------------------
  const taskIds = new Set<string>();
  const versionsByTask = new Map<string, Set<number>>();
  const instancesByTask = new Map<string, Set<string>>();
  for (const r of activeRows) {
    taskIds.add(r.taskId);
    const versions = versionsByTask.get(r.taskId) ?? new Set<number>();
    versions.add(r.taskVersion);
    versionsByTask.set(r.taskId, versions);
    const instances = instancesByTask.get(r.taskId) ?? new Set<string>();
    instances.add(r.taskInstanceId);
    instancesByTask.set(r.taskId, instances);
  }
  const versionCountByTask: Record<string, number> = {};
  for (const [taskId, versions] of versionsByTask) {
    versionCountByTask[taskId] = versions.size;
  }
  const instanceCountByTask: Record<string, number> = {};
  for (const [taskId, instances] of instancesByTask) {
    instanceCountByTask[taskId] = instances.size;
  }

  // --- Attempt / assessment counts (audit over the full ledger) --------------------
  const attemptIds = new Set<string>();
  const assessmentEventIds = new Set<string>();
  for (const r of rows) {
    for (const id of r.attemptIds) attemptIds.add(id);
    if (r.assessmentEventId !== null) assessmentEventIds.add(r.assessmentEventId);
  }

  // --- Response samples: distinct generated outputs among active rows ---------------
  const activeCandidateAttemptIds = new Set<string>();
  for (const r of activeRows) activeCandidateAttemptIds.add(r.candidateAttemptId);

  const responseSampleCountByConfiguration: Record<string, number> = {};
  const seenByConfiguration = new Map<string, Set<string>>();
  for (const r of activeRows) {
    const seen = seenByConfiguration.get(r.modelConfigurationId);
    if (seen && seen.has(r.candidateAttemptId)) continue;
    if (!seen) seenByConfiguration.set(r.modelConfigurationId, new Set([r.candidateAttemptId]));
    else seen.add(r.candidateAttemptId);
    responseSampleCountByConfiguration[r.modelConfigurationId] =
      (responseSampleCountByConfiguration[r.modelConfigurationId] ?? 0) + 1;
  }

  // --- Declared paired cells ----------------------------------------------------------
  const activeConfigurations = new Set(activeRows.map((r) => r.modelConfigurationId));
  let completePairCount = 0;
  for (const pair of input.declaredPairs) {
    if (activeConfigurations.has(pair.a) && activeConfigurations.has(pair.b)) {
      completePairCount += 1;
    }
  }

  return {
    taskCount: taskIds.size,
    versionCountByTask,
    instanceCountByTask,
    activeObservationCount: activeRows.length,
    replicateCount: activeRows.filter((r) => r.declaredReplicate).length,
    attemptCount: attemptIds.size,
    assessmentEventCount: assessmentEventIds.size,
    responseSampleCount: activeCandidateAttemptIds.size,
    responseSampleCountByConfiguration,
    reusedAssessmentEventCount: activeRows.filter((r) => r.reusedCandidateOutput).length,
    pairedCoverage: {
      declaredPairCount: input.declaredPairs.length,
      completePairCount,
      complete:
        input.declaredPairs.length > 0 && completePairCount === input.declaredPairs.length,
    },
    lineageCellViolations,
  };
}
