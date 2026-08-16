// =============================================================================
// RSemble AI — Canonical observation source selection (spec §3.4, §6)
//
// Pure selector over immutable source records. For one experiment task it
// resolves:
//
//  - the selected candidate attempt (reusing the canonical selectAttemptId
//    policy from experiment-engine);
//  - per-model cells: the ORIGINAL candidate attempt id (reuse chains are
//    followed to their root — reused outputs keep their original
//    candidateAttemptId), the provenance kind, the accepted judge assessment
//    (with prior re-judge events listed), and the executed verifier outcome;
//  - audit-only attempts (failed/rejected/superseded) and explicit coverage
//    gaps (missing cells, failed candidates, unusable runs);
//
// Rules honored here (spec §6): operational retries that became selected
// replace the active source selection; fresh judge assessments on reused
// outputs are assessment events, not new candidate samples; added-model
// candidate attempts are new observations; full-roster fallback re-executes
// every model fresh.
//
// Pure: never writes, never calls a provider, never mutates inputs.
// =============================================================================

import { selectAttemptId } from "../evaluations/experiment-engine";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskExecutionPlan,
} from "../evaluations/evaluation-types";
import { modelKeyOf } from "../evaluations/experiment-roster-extension";
import type { VerifierOutcome } from "../evaluations/fusion-study-types";
import type {
  CandidateAttemptRecord,
  JudgeAttemptRecord,
  PersistedCandidate,
  RunRecordV2,
} from "../persistence/run-types";

// --- Result types -----------------------------------------------------------------

export type CellProvenance =
  | "fresh"
  | "retry_success"
  | "repair_reused"
  | "repair_new"
  | "roster_extension_reused"
  | "roster_extension_added"
  | "reused";

/** Accepted judge assessment for one run, with prior re-judge events listed. */
export interface AcceptedJudgeAssessment {
  judgeAttemptId: string;
  providerId: string;
  model: string;
  blindLabelMapping: Record<string, string>;
  candidateAttemptIdsByCandidateId: Record<string, string>;
  /** Earlier completed judge events on the same output (drillable re-judges). */
  priorJudgeAttemptIds: string[];
}

export interface ObservationSourceCell {
  /** Stable source cell id: experiment × task × model key. */
  sourceTaskCellId: string;
  modelKey: string;
  candidateId: string;
  /** The ORIGINAL attempt id of the accepted output (root of any reuse chain). */
  candidateAttemptId: string;
  provenance: CellProvenance;
  reusedOutput: boolean;
  runId: string;
  judgeAssessment: AcceptedJudgeAssessment | null;
  verifier: VerifierOutcome | null;
}

export interface ObservationSourceGap {
  modelKey: string;
  reason: "no_accepted_output" | "candidate_failed" | "missing_cell";
}

export interface ObservationSourceAuditAttempt {
  attemptId: string;
  runId: string | null;
  status: ExperimentTaskAttempt["status"];
  /** True when this attempt once produced results but is no longer selected. */
  superseded: boolean;
}

export interface ObservationSourceSelection {
  taskId: string;
  executionLineageId: string;
  selectedAttemptId: string | null;
  selectedRunId: string | null;
  auditOnlyAttempts: ObservationSourceAuditAttempt[];
  cells: ObservationSourceCell[];
  gaps: ObservationSourceGap[];
  integrityIssues: string[];
}

export interface ObservationSourceInput {
  experiment: ExperimentRecord;
  taskId: string;
  resolveRunRecord: (runId: string) => RunRecordV2 | null;
  verifierOutcomes?: VerifierOutcome[];
}

export type ObservationSourceResult =
  | { ok: true; selection: ObservationSourceSelection }
  | { ok: false; reason: string };

// --- Selection ---------------------------------------------------------------------

export function selectObservationSources(input: ObservationSourceInput): ObservationSourceResult {
  const { experiment, taskId, resolveRunRecord, verifierOutcomes = [] } = input;
  const taskState = experiment.tasks.find((t) => t.taskId === taskId);
  if (!taskState) {
    return { ok: false, reason: `Task ${taskId} is not part of experiment ${experiment.id}.` };
  }

  const rosterKeys = experiment.snapshot.modelSlots
    .filter((s) => s.enabled)
    .map((s) => modelKeyOf(s));
  const executionLineageId = `eval:${experiment.id}:${taskId}`;
  const selectedAttemptId = taskState.selectedAttemptId ?? selectAttemptId(taskState);
  const selectedAttempt =
    (selectedAttemptId && taskState.attempts.find((a) => a.id === selectedAttemptId)) || null;

  const auditOnlyAttempts: ObservationSourceAuditAttempt[] = taskState.attempts
    .filter((a) => a.id !== selectedAttemptId)
    .map((a) => ({
      attemptId: a.id,
      runId: a.runId,
      status: a.status,
      superseded: a.status === "completed" || a.status === "partial",
    }));

  const emptySelection = (
    cells: ObservationSourceCell[],
    gaps: ObservationSourceGap[],
    integrityIssues: string[],
    selectedRunId: string | null = null,
  ): ObservationSourceSelection => ({
    taskId,
    executionLineageId,
    selectedAttemptId,
    selectedRunId,
    auditOnlyAttempts,
    cells,
    gaps,
    integrityIssues,
  });

  if (!selectedAttempt) {
    return {
      ok: true,
      selection: emptySelection(
        [],
        rosterKeys.map((modelKey) => ({ modelKey, reason: "missing_cell" })),
        [],
      ),
    };
  }

  const integrityIssues: string[] = [];
  let run: RunRecordV2 | null = null;
  if (selectedAttempt.runId === null) {
    integrityIssues.push(`Selected attempt ${selectedAttempt.id} has no run record.`);
  } else {
    run = resolveRunRecord(selectedAttempt.runId);
    if (!run) {
      integrityIssues.push(
        `Selected attempt ${selectedAttempt.id} run ${selectedAttempt.runId} could not be resolved.`,
      );
    } else {
      integrityIssues.push(...checkRunIntegrity(experiment, taskId, selectedAttempt, run));
    }
  }

  if (!run || integrityIssues.length > 0) {
    return {
      ok: true,
      selection: emptySelection(
        [],
        rosterKeys.map((modelKey) => ({ modelKey, reason: "no_accepted_output" })),
        integrityIssues,
        run?.id ?? null,
      ),
    };
  }

  const judgeAssessment = resolveJudgeAssessment(run);
  const cells: ObservationSourceCell[] = [];
  const gaps: ObservationSourceGap[] = [];
  const seenModelKeys = new Set<string>();

  for (const candidate of run.candidates) {
    seenModelKeys.add(candidate.modelKey);
    const accepted = resolveAcceptedAttempt(candidate);
    if (!accepted || accepted.status !== "completed") {
      gaps.push({ modelKey: candidate.modelKey, reason: "candidate_failed" });
      continue;
    }
    const root = rootAttemptId(accepted, resolveRunRecord);
    if (!root.resolved) {
      integrityIssues.push(
        `Reuse chain for ${candidate.modelKey} could not be fully resolved; ` +
          `using the deepest resolvable original attempt ${root.candidateAttemptId}.`,
      );
    }
    cells.push({
      sourceTaskCellId: `${experiment.id}:${taskId}:${candidate.modelKey}`,
      modelKey: candidate.modelKey,
      candidateId: candidate.candidateId,
      candidateAttemptId: root.candidateAttemptId,
      provenance: classifyProvenance(selectedAttempt, candidate.modelKey, accepted),
      reusedOutput: accepted.reusedFrom !== undefined,
      runId: run.id,
      judgeAssessment,
      verifier: latestVerifierOutcome(verifierOutcomes, taskId, candidate.modelKey),
    });
  }

  for (const modelKey of rosterKeys) {
    if (!seenModelKeys.has(modelKey)) {
      gaps.push({ modelKey, reason: "missing_cell" });
    }
  }

  return {
    ok: true,
    selection: emptySelection(cells, gaps, integrityIssues, run.id),
  };
}

// --- Helpers -----------------------------------------------------------------------

function checkRunIntegrity(
  experiment: ExperimentRecord,
  taskId: string,
  selectedAttempt: ExperimentTaskAttempt,
  run: RunRecordV2,
): string[] {
  const issues: string[] = [];
  if (run.source.kind !== "experiment") {
    issues.push(`Selected run ${run.id} is not an experiment run.`);
    return issues;
  }
  const src = run.source;
  if (src.experimentId !== experiment.id) {
    issues.push(`Selected run ${run.id} belongs to a different experiment (${src.experimentId}).`);
  }
  if (src.suiteId !== experiment.suiteId || src.suiteVersion !== experiment.suiteVersion) {
    issues.push(`Selected run ${run.id} belongs to a different suite version.`);
  }
  if (src.taskId !== taskId) {
    issues.push(`Selected run ${run.id} belongs to a different task (${src.taskId}).`);
  }
  if (src.protocolFingerprint !== experiment.protocolFingerprint) {
    issues.push(`Selected run ${run.id} protocol fingerprint does not match the experiment.`);
  }
  if (src.experimentTaskAttemptId !== selectedAttempt.id) {
    issues.push(`Selected run ${run.id} does not match the selected attempt ${selectedAttempt.id}.`);
  }
  return issues;
}

function resolveAcceptedAttempt(candidate: PersistedCandidate): CandidateAttemptRecord | null {
  if (candidate.acceptedAttemptId === null) return null;
  return candidate.attempts.find((a) => a.attemptId === candidate.acceptedAttemptId) ?? null;
}

function findAttemptInRun(run: RunRecordV2, attemptId: string): CandidateAttemptRecord | null {
  for (const candidate of run.candidates) {
    const found = candidate.attempts.find((a) => a.attemptId === attemptId);
    if (found) return found;
  }
  return null;
}

/** Follow the reuse chain to the ORIGINAL attempt id (spec §6.3). */
function rootAttemptId(
  attempt: CandidateAttemptRecord,
  resolveRunRecord: (runId: string) => RunRecordV2 | null,
): { candidateAttemptId: string; resolved: boolean } {
  let current = attempt;
  const visited = new Set<string>([attempt.attemptId]);
  while (current.reusedFrom !== undefined) {
    const sourceRun = resolveRunRecord(current.reusedFrom.sourceRunId);
    const sourceAttempt = sourceRun
      ? findAttemptInRun(sourceRun, current.reusedFrom.sourceAttemptId)
      : null;
    if (!sourceAttempt) {
      return { candidateAttemptId: current.reusedFrom.sourceAttemptId, resolved: false };
    }
    if (visited.has(sourceAttempt.attemptId)) {
      return { candidateAttemptId: sourceAttempt.attemptId, resolved: false };
    }
    visited.add(sourceAttempt.attemptId);
    current = sourceAttempt;
  }
  return { candidateAttemptId: current.attemptId, resolved: true };
}

function classifyProvenance(
  selectedAttempt: ExperimentTaskAttempt,
  modelKey: string,
  accepted: CandidateAttemptRecord,
): CellProvenance {
  const plan: ExperimentTaskExecutionPlan | undefined = selectedAttempt.repair;
  const reused = accepted.reusedFrom !== undefined;

  if (plan?.kind === "roster-extension") {
    if (plan.addedModelKey === modelKey) {
      return reused ? "reused" : "roster_extension_added";
    }
    return reused ? "roster_extension_reused" : "fresh";
  }
  if (plan?.kind === "missing-cells") {
    if (plan.requestedModelKeys.includes(modelKey)) {
      return reused ? "repair_reused" : "repair_new";
    }
    return reused ? "repair_reused" : "fresh";
  }
  if (reused) return "reused";
  return selectedAttempt.trial > 0 ? "retry_success" : "fresh";
}

/**
 * The active verifier outcome for one cell is the latest execution
 * (greatest executedAt); ties keep the earliest match in array order so the
 * selection is deterministic (spec §6.3 latest-active rule).
 */
function latestVerifierOutcome(
  outcomes: VerifierOutcome[],
  taskId: string,
  modelKey: string,
): VerifierOutcome | null {
  let latest: VerifierOutcome | null = null;
  for (const outcome of outcomes) {
    if (outcome.taskId !== taskId || outcome.modelKey !== modelKey) continue;
    if (latest === null || outcome.executedAt > latest.executedAt) latest = outcome;
  }
  return latest;
}
function resolveJudgeAssessment(run: RunRecordV2): AcceptedJudgeAssessment | null {
  if (run.judge.acceptedAttemptId === null) return null;

  const accepted = run.judge.attempts.find(
    (a: JudgeAttemptRecord) => a.attemptId === run.judge.acceptedAttemptId,
  );
  if (!accepted) return null;
  const priorJudgeAttemptIds = run.judge.attempts
    .filter(
      (a: JudgeAttemptRecord) =>
        a.attemptId !== accepted.attemptId && a.status === "completed" && a.report !== null,
    )
    .map((a: JudgeAttemptRecord) => a.attemptId);
  return {
    judgeAttemptId: accepted.attemptId,
    providerId: accepted.providerId,
    model: accepted.model,
    blindLabelMapping: { ...accepted.blindLabelToCandidateId },
    candidateAttemptIdsByCandidateId: { ...accepted.candidateAttemptIdsByCandidateId },
    priorJudgeAttemptIds,
  };
}
