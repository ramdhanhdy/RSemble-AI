// =============================================================================
// RSemble AI — Experiment aggregation (spec §12.2)
//
// Pure, deterministic aggregation over a finished (or in-progress) experiment:
//
//   model-task score = canonical score from that task's selectedAttemptId
//   model overall    = arithmetic mean of that model's available task scores
//   coverage         = scored tasks / total suite tasks
//
// Rules (spec §12.2):
//  - every task has equal weight; criterion weights normalize within a task;
//  - missing results are missing — never silently zero;
//  - only complete-coverage models are winner-eligible;
//  - no complete model → no overall winner;
//  - ranking uses raw unrounded values; ties within 1e-9 share the win;
//  - each task row draws scores from exactly one selected attempt — evidence
//    is never spliced across retries.
// =============================================================================

import type { ExperimentSnapshot, ExperimentTaskState } from "./evaluation-types";
import type { RunRecordV2 } from "../persistence/run-types";
import {
  computeWinnerKeys,
  qualityScore,
  complianceScore,
  rankValueOf,
  getComplianceInfluence,
} from "./evaluation-profile";

// --- Canonical per-model scores from one accepted run ---------------------------

/**
 * Canonical per-model score for one task attempt's run (spec §12.2).
 * With a pinned evaluation profile: Σ(score × weight) / Σ(weight) over the
 * accepted Judge criterion vector. Holistic: the Judge's overall score.
 * Models without an accepted evaluation are absent (missing — never zero).
 */
export function canonicalScoresFromRun(record: RunRecordV2): Record<string, number> {
  const report = record.judge.report;
  if (!report) return {};
  const profile = record.evaluation.profile;
  const scores: Record<string, number> = {};
  for (const candidate of record.candidates) {
    const evaluation = report.evaluationsById[candidate.candidateId];
    if (!evaluation) continue;
    if (profile) {
      const numericScores: Record<string, number> = {};
      const booleanResults: Record<string, boolean> = {};
      for (const cs of evaluation.criterionScores) {
        if (cs.kind === "binary" && cs.value !== undefined) {
          booleanResults[cs.criterionId] = cs.value;
        } else if (cs.score !== undefined) {
          numericScores[cs.criterionId] = cs.score;
        }
      }
      const Q = qualityScore(numericScores, profile);
      const comp = complianceScore(booleanResults, profile);
      const lambda = getComplianceInfluence(profile);
      const C = comp?.C ?? null;
      const rv = rankValueOf(Q, C, lambda);
      if (rv !== null) scores[candidate.modelKey] = rv;
    } else {
      scores[candidate.modelKey] = evaluation.overallScore;
    }
  }
  return scores;
}

// --- Aggregation result types -------------------------------------------------------

export type MissingReason =
  /** Task never ran (no attempts at all). */
  | "no-attempt"
  /** Attempts exist but none was accepted (failed/aborted/interrupted). */
  | "no-accepted-attempt"
  /** The selected attempt's run record could not be loaded. */
  | "evidence-missing"
  /** The accepted run has no score for this model (candidate failed or unjudged). */
  | "no-score";

export type CellState =
  | { kind: "scored"; score: number; runId: string; attemptId: string }
  | { kind: "missing"; reason: MissingReason; runId: string | null; attemptId: string | null };

export interface ModelAggregate {
  modelKey: string;
  /** Raw unrounded mean of available task scores; null when nothing scored. */
  mean: number | null;
  scoredTasks: number;
  totalTasks: number;
  /** scoredTasks === totalTasks (and at least one task exists). */
  complete: boolean;
}

export interface ExperimentAggregation {
  /** Suite task order (rows). */
  taskIds: string[];
  /** Roster order (columns). */
  modelKeys: string[];
  /** cells[taskIndex][modelIndex]. */
  cells: CellState[][];
  /** Roster order. */
  models: ModelAggregate[];
  /** Complete-coverage winners within 1e-9 of the raw max; [] when none. */
  winnerKeys: string[];
}

export interface AggregateExperimentInput {
  snapshot: ExperimentSnapshot;
  taskStates: ExperimentTaskState[];
  /** Load the run record for a selected attempt's run ID. */
  resolveRunRecord(runId: string): RunRecordV2 | null;
}

// --- Aggregation ------------------------------------------------------------------

export function aggregateExperiment(input: AggregateExperimentInput): ExperimentAggregation {
  const { snapshot, taskStates, resolveRunRecord } = input;
  const modelKeys = snapshot.modelSlots.map((s) => `${s.providerId}:${s.slug}`);
  const taskIds = taskStates.map((t) => t.taskId);
  const totalTasks = taskStates.length;

  const cells: CellState[][] = taskStates.map((task) => {
    const selected = task.selectedAttemptId
      ? (task.attempts.find((a) => a.id === task.selectedAttemptId) ?? null)
      : null;

    if (!selected) {
      const reason: MissingReason =
        task.attempts.length === 0 ? "no-attempt" : "no-accepted-attempt";
      return modelKeys.map((): CellState => ({
        kind: "missing",
        reason,
        runId: null,
        attemptId: null,
      }));
    }

    const runId = selected.runId;
    const record = runId ? resolveRunRecord(runId) : null;
    if (!record) {
      return modelKeys.map((): CellState => ({
        kind: "missing",
        reason: "evidence-missing",
        runId,
        attemptId: selected.id,
      }));
    }

    const scores = canonicalScoresFromRun(record);
    return modelKeys.map((modelKey): CellState => {
      const score = scores[modelKey];
      if (score === undefined) {
        return { kind: "missing", reason: "no-score", runId, attemptId: selected.id };
      }
      return { kind: "scored", score, runId: runId!, attemptId: selected.id };
    });
  });

  const models: ModelAggregate[] = modelKeys.map((modelKey, modelIdx) => {
    let sum = 0;
    let scoredTasks = 0;
    for (let taskIdx = 0; taskIdx < totalTasks; taskIdx++) {
      const cell = cells[taskIdx][modelIdx];
      if (cell.kind === "scored") {
        sum += cell.score;
        scoredTasks += 1;
      }
    }
    return {
      modelKey,
      mean: scoredTasks > 0 ? sum / scoredTasks : null,
      scoredTasks,
      totalTasks,
      complete: totalTasks > 0 && scoredTasks === totalTasks,
    };
  });

  // Winner: only complete-coverage models; raw values; epsilon ties all listed.
  const eligibleMeans: Record<string, number> = {};
  for (const model of models) {
    if (model.complete && model.mean !== null) {
      eligibleMeans[model.modelKey] = model.mean;
    }
  }
  const winnerKeys = computeWinnerKeys(eligibleMeans);

  return { taskIds, modelKeys, cells, models, winnerKeys };
}

// --- Display formatting (spec §12.2) -------------------------------------------------

/** Task cells display one decimal. */
export function formatTaskScore(score: number): string {
  return score.toFixed(1);
}

/** Aggregate means display two decimals. Ranking never uses this string. */
export function formatAggregateMean(mean: number): string {
  return mean.toFixed(2);
}
