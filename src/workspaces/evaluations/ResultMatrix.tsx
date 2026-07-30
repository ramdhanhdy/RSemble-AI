// =============================================================================
// ResultMatrix — accessible desktop experiment result matrix (spec §12.1).
//
// A real <table>: task rows × provider-scoped model columns. Cells are the
// accepted Judge score (neutral tabular numerals, deep-linked to run evidence)
// or explicit missing text paired with a StatusMark — never a bare dash and
// never score-magnitude coloring. Complete-coverage winners get a restrained
// emerald ring; every tied winner is marked. The tablet scroll region is
// keyboard-focusable with a persistent outline and never scrolls the page.
// =============================================================================

import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type { ModelSlot } from "../../studio-data";
import type { EvaluationTask } from "../../lib/evaluations/evaluation-types";
import type {
  CellState,
  ExperimentAggregation,
  MissingReason,
} from "../../lib/evaluations/experiment-aggregation";
import {
  formatAggregateMean,
  formatTaskScore,
} from "../../lib/evaluations/experiment-aggregation";
import { StatusMark } from "../../ui/StatusMark";
import type { StatusMarkStatus } from "../../ui/StatusMark";
import { CompactModelLabel } from "../../ui/CompactModelLabel";

export interface ResultMatrixProps {
  aggregation: ExperimentAggregation;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  /** Loaded run records by runId for evidence links. */
  runRecords: ReadonlyMap<string, RunRecordV2>;
}

/** Truthful closest status token per missing reason; text stays primary.
 *  Shared by the desktop matrix and the mobile task rows. */
export const MISSING_CELL_DISPLAY: Record<MissingReason, { text: string; status: StatusMarkStatus }> = {
  "no-attempt": { text: "Not run", status: "draft" },
  "no-accepted-attempt": { text: "No accepted attempt", status: "failed" },
  "evidence-missing": { text: "Evidence unavailable", status: "interrupted" },
  "no-score": { text: "No score", status: "partial" },
};

/**
 * Deep link from one matrix cell to its run evidence (spec §12.1):
 * scored cells point at the immutable candidate and the accepted Judge
 * attempt; anything else with a runId falls back to the run overview.
 */
export function cellEvidenceLink(
  cell: CellState,
  modelKey: string,
  record: RunRecordV2 | undefined,
): string | null {
  if (cell.kind === "scored") {
    const candidateId = record?.candidates.find((c) => c.modelKey === modelKey)?.candidateId ?? null;
    const acceptedAttemptId = record?.judge.acceptedAttemptId ?? null;
    if (candidateId && acceptedAttemptId) {
      return `/runs/${cell.runId}?candidate=${candidateId}&attempt=${acceptedAttemptId}`;
    }
    return `/runs/${cell.runId}`;
  }
  return cell.runId ? `/runs/${cell.runId}` : null;
}

const CELL_LINK_CLASSES =
  "flex min-h-[44px] items-center tabular-nums text-sm text-text transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function CellContent({
  cell,
  modelKey,
  runRecords,
}: {
  cell: CellState;
  modelKey: string;
  runRecords: ReadonlyMap<string, RunRecordV2>;
}): ReactElement {
  if (cell.kind === "scored") {
    const href = cellEvidenceLink(cell, modelKey, cell.runId ? runRecords.get(cell.runId) : undefined);
    const score = formatTaskScore(cell.score);
    return href ? (
      <Link to={href} className={CELL_LINK_CLASSES}>
        {score}
      </Link>
    ) : (
      <span className={CELL_LINK_CLASSES}>{score}</span>
    );
  }
  const display = MISSING_CELL_DISPLAY[cell.reason];
  return (
    <span className="flex min-h-[44px] items-center gap-2">
      <StatusMark status={display.status} size={12} />
      <span className="text-xs text-text-secondary">{display.text}</span>
    </span>
  );
}

export function ResultMatrix({
  aggregation,
  tasks,
  modelSlots,
  runRecords,
}: ResultMatrixProps): ReactElement {
  const slotsByKey = new Map(modelSlots.map((s) => [`${s.providerId}:${s.slug}`, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const winners = new Set(aggregation.winnerKeys);
  const showNoWinnerCopy =
    aggregation.winnerKeys.length === 0 && aggregation.models.some((m) => !m.complete);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {showNoWinnerCopy ? (
        <p className="text-sm text-text-secondary">No complete-coverage winner</p>
      ) : null}
      <div
        role="region"
        aria-label="Result matrix — scrollable"
        tabIndex={0}
        className="scroll-thin max-w-full overflow-x-auto rounded-md border border-edge focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <table className="min-w-full border-collapse text-left text-sm">
          <caption className="px-3 py-2 text-left text-xs text-text-muted">
            Experiment results — task scores by model
          </caption>
          <thead>
            <tr className="border-b border-edge">
              <th
                scope="col"
                className="sticky top-0 z-10 bg-panel px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted"
              >
                Task
              </th>
              {aggregation.modelKeys.map((modelKey) => {
                const slot = slotsByKey.get(modelKey);
                const isWinner = winners.has(modelKey);
                return (
                  <th
                    key={modelKey}
                    scope="col"
                    className={`sticky top-0 z-10 bg-panel px-3 py-2 font-normal${isWinner ? " ring-1 ring-success/40" : ""}`}
                  >
                    <span className="flex flex-col gap-0.5">
                      {slot ? (
                        <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                      ) : (
                        <span className="font-mono text-text">{modelKey}</span>
                      )}
                      {isWinner ? <span className="text-xs text-success">Winner</span> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {aggregation.taskIds.map((taskId, taskIdx) => {
              const task = taskById.get(taskId);
              const title = task?.title ?? taskId;
              const rowCells = aggregation.cells[taskIdx] ?? [];
              const rowRunId = rowCells.find((c) => c.runId !== null)?.runId ?? null;
              return (
                <tr key={taskId} className="border-b border-edge last:border-b-0">
                  <th scope="row" className="max-w-[280px] px-3 py-1 align-middle font-normal">
                    {rowRunId ? (
                      <Link
                        to={`/runs/${rowRunId}`}
                        className="flex min-h-[44px] min-w-0 items-center truncate text-sm text-text transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {title}
                      </Link>
                    ) : (
                      <span className="flex min-h-[44px] min-w-0 items-center truncate text-sm text-text">
                        {title}
                      </span>
                    )}
                  </th>
                  {aggregation.modelKeys.map((modelKey, modelIdx) => (
                    <td key={modelKey} className="px-3 py-1 align-middle">
                      <CellContent cell={rowCells[modelIdx]} modelKey={modelKey} runRecords={runRecords} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-edge bg-panel">
              <th
                scope="row"
                className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted"
              >
                Mean · coverage
              </th>
              {aggregation.models.map((model) => {
                const isWinner = winners.has(model.modelKey);
                return (
                  <td
                    key={model.modelKey}
                    className={`px-3 py-2${isWinner ? " ring-1 ring-success/40" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      {model.mean !== null ? (
                        <span className="tabular-nums text-sm text-text">
                          {formatAggregateMean(model.mean)} · {model.scoredTasks}/{model.totalTasks}
                        </span>
                      ) : (
                        <span className="text-sm text-text-secondary">No scores</span>
                      )}
                      {isWinner ? <span className="text-xs text-success">Winner</span> : null}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
