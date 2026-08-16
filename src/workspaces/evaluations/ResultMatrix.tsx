// =============================================================================
// =============================================================================
// ResultMatrix — accessible desktop experiment result matrix (spec §12.1).
//
// A real <table>: task rows × provider-scoped model columns. Cells are the
// accepted Judge score (neutral tabular numerals, deep-linked to run evidence)
// or explicit missing text paired with a StatusMark — never a bare dash and
// NEVER score-magnitude coloring (ui-redesign-spec §6.1). Readability comes
// from structure, not heat: per-row best scores are marked with a bold ▲
// glyph, complete-coverage winners get crown + #1 and a restrained success
// ring (every tied winner marked), and the footer splits mean score and
// coverage into two explicit labeled rows. The tablet scroll region is
// keyboard-focusable with a persistent outline and never scrolls the page.
// =============================================================================

import { useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Crown } from "lucide-react";
import { Pagination, PAGE_SIZE } from "../../ui/Pagination";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type { ModelSlot } from "../../studio-data";
import type { EvaluationTask } from "../../lib/evaluations/evaluation-types";
import {
  type CellState,
  type ExperimentAggregation,
  type MissingReason,
  formatAggregateMean,
} from "../../lib/evaluations/experiment-aggregation";
import { rankScoreOf } from "../../lib/evaluations/evaluation-rubric";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { EvidenceReceipt } from "../../ui/EvidenceReceipt";
import type { CompoundRepairPlan } from "../../lib/evaluations/experiment-repair";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
/** Planner plans by taskId → modelKey (spec §11.2). Shared with the mobile
 *  adaptation and the recovery toolbar. */
export type RepairableCellPlans = ReadonlyMap<string, ReadonlyMap<string, CompoundRepairPlan>>;

export interface ResultMatrixProps {
  aggregation: ExperimentAggregation;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  /** Loaded run records by runId for evidence links. */
  runRecords: ReadonlyMap<string, RunRecordV2>;
  /** Repairable no-score cells by task + model key (spec §11.2). */
  repairablePlans?: RepairableCellPlans;
  /** Recovery handoff — present only while this surface owns the lease; when
   *  provided, every missing cell renders one action control (spec §11.1). */
  onRepairRequest?: (taskId: string, modelKey: string) => void;
  /** Evidence derivation repository for receipt popovers (spec §12.1). */
  evidenceRepo?: EvidenceRepository | null;
  /** Initial 1-based page (clamped). Used by tests and deep links. */
  initialPage?: number;
  /** Controlled page (1-based) — the URL search param is the source of truth
   *  when provided with onPageChange (spec §12.5). */
  page?: number;
  onPageChange?: (page: number) => void;
}

/** Truthful closest status token per missing reason; text stays primary.
 *  Shared by the desktop matrix and the mobile task rows. */
export const MISSING_CELL_DISPLAY: Record<
  MissingReason,
  { text: string; status: StatusMarkStatus }
> = {
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
    const candidateId =
      record?.candidates.find((c) => c.modelKey === modelKey)?.candidateId ?? null;
    const acceptedAttemptId = record?.judge.acceptedAttemptId ?? null;
    if (candidateId && acceptedAttemptId) {
      return `/runs/${cell.runId}?candidate=${candidateId}&attempt=${acceptedAttemptId}`;
    }
    return `/runs/${cell.runId}`;
  }
  return cell.runId ? `/runs/${cell.runId}` : null;
}

const CELL_LINK_CLASSES =
  "flex min-h-[44px] items-center gap-1 tabular-nums text-sm font-semibold text-text transition-colors duration-150 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Crown + Winner — the spec winner glyph, never color alone (ui-redesign-spec §3). */
function WinnerBadge(): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
      <Crown size={12} aria-hidden="true" /> Winner
    </span>
  );
}

function MissingCellContent({
  reason,
  runId,
  taskId,
  modelKey,
  repairable,
  onRepairRequest,
  evidenceRepo,
}: {
  reason: MissingReason;
  runId: string | null;
  taskId: string;
  modelKey: string;
  repairable: boolean;
  onRepairRequest: ((taskId: string, modelKey: string) => void) | undefined;
  evidenceRepo?: EvidenceRepository | null;
}): ReactElement {
  const display = MISSING_CELL_DISPLAY[reason];
  const evidenceHref = runId ? `/runs/${runId}` : null;
  return (
    <div className="flex min-h-[44px] min-w-0 flex-col justify-center gap-1 py-1">
      <span className="flex items-center gap-2">
        <StatusMark status={display.status} size={12} />
        <span className="text-xs text-text-secondary">{display.text}</span>
        <EvidenceReceipt
          runId={runId}
          taskId={taskId}
          modelKey={modelKey}
          missingReason={reason}
          evidenceRepo={evidenceRepo}
          compact
        />
      </span>
      {onRepairRequest ? (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-recovery-action={repairable ? "repair-cell" : "retry-task"}
            onClick={() => onRepairRequest(taskId, modelKey)}
            className="inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-2.5 text-xs text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {repairable ? "Complete missing result" : "Retry incomplete task"}
          </button>
          {evidenceHref ? (
            <Link
              to={evidenceHref}
              className="inline-flex min-h-[44px] items-center px-1 text-xs text-accent transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Evidence
            </Link>
          ) : null}
        </span>
      ) : evidenceHref ? (
        <Link
          to={evidenceHref}
          className="inline-flex min-h-[44px] items-center px-1 text-xs text-accent transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View evidence
        </Link>
      ) : null}
    </div>
  );
}

function CellContent({
  cell,
  modelKey,
  runRecords,
  rowBest,
  taskId,
  repairable,
  onRepairRequest,
  evidenceRepo,
}: {
  cell: CellState;
  modelKey: string;
  runRecords: ReadonlyMap<string, RunRecordV2>;
  rowBest: boolean;
  taskId: string;
  repairable: boolean;
  onRepairRequest: ((taskId: string, modelKey: string) => void) | undefined;
  evidenceRepo?: EvidenceRepository | null;
}): ReactElement {
  if (cell.kind === "scored") {
    const href = cellEvidenceLink(
      cell,
      modelKey,
      cell.runId ? runRecords.get(cell.runId) : undefined,
    );
    // Compliance-only cells (no graded criteria, spec §16.3): cell.score is the
    // raw compliance share C in [0,1]. Render it as a C-labeled percentage —
    // never as a floored 1.0* rankScore.
    const complianceOnly = cell.q == null && cell.c != null;
    // Normal ranked cells display the BOUNDED presentation value rankScore =
    // max(1, rankValue) (spec §16.2); raw cell.score stays the ranking
    // authority. The floor marker is derived from the raw rankValue, and is
    // announced to assistive tech, not just a title tooltip.
    const floored = !complianceOnly && cell.score < 1; // rankValue below the 1.0 display floor
    const displayScore = complianceOnly
      ? `${(cell.c! * 100).toFixed(0)}%`
      : `${rankScoreOf(cell.score)!.toFixed(1)}`;
    const content = (
      <>
        {displayScore}
        {floored ? (
          <span
            role="img"
            aria-label="display value bounded at the 1.0 floor; raw rank value is lower"
            title="rankValue below the 1.0 display floor"
          >
            *
          </span>
        ) : null}
        {rowBest ? (
          <span
            aria-label="best in row"
            title="Best score for this task"
            className="text-xs text-text-muted"
          >
            ▲
          </span>
        ) : null}
      </>
    );
    const candidateId = cell.runId
      ? runRecords.get(cell.runId)?.candidates.find((c) => c.modelKey === modelKey)?.candidateId ??
        null
      : null;
    return (
      <div className="flex items-center gap-1.5">
        {href ? (
          <Link to={href} className={`${CELL_LINK_CLASSES}${rowBest ? " font-bold" : ""}`}>
            {content}
          </Link>
        ) : (
          <span className={CELL_LINK_CLASSES}>{content}</span>
        )}
        <EvidenceReceipt
          runId={cell.runId}
          attemptId={cell.attemptId}
          taskId={taskId}
          modelKey={modelKey}
          candidateId={candidateId}
          evidenceRepo={evidenceRepo}
          compact
        />
      </div>
    );
  }
  return (
    <MissingCellContent
      reason={cell.reason}
      runId={cell.runId}
      taskId={taskId}
      modelKey={modelKey}
      repairable={repairable}
      onRepairRequest={onRepairRequest}
      evidenceRepo={evidenceRepo}
    />
  );
}

export function ResultMatrix({
  aggregation,
  tasks,
  modelSlots,
  runRecords,
  repairablePlans,
  onRepairRequest,
  evidenceRepo,
  initialPage = 1,
  page,
  onPageChange,
}: ResultMatrixProps): ReactElement {
  const slotsByKey = new Map(modelSlots.map((s) => [`${s.providerId}:${s.slug}`, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const winners = new Set(aggregation.winnerKeys);
  const showNoWinnerCopy =
    aggregation.winnerKeys.length === 0 && aggregation.models.some((m) => !m.complete);
  // Large-suite paging (spec §12.5): 50 task rows per page, stable suite
  // order, page state clamped; hidden pages never mount.
  const totalTasks = aggregation.taskIds.length;
  const pageCount = Math.max(1, Math.ceil(totalTasks / PAGE_SIZE));
  const [internalPage, setInternalPage] = useState(() =>
    Math.min(Math.max(initialPage, 1), pageCount),
  );
  const controlled = page !== undefined && onPageChange !== undefined;
  const currentPage = controlled ? Math.min(Math.max(page!, 1), pageCount) : internalPage;
  const handlePageChange = (next: number) => {
    if (controlled) onPageChange!(next);
    else setInternalPage(next);
  };
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageTaskIds = aggregation.taskIds.slice(pageStart, pageStart + PAGE_SIZE);
  const pageTaskIndexes = new Map(pageTaskIds.map((id, i) => [id, pageStart + i]));

  // Sticky first column: the task header, every row header, and footer labels
  // stay left-0 with an opaque panel surface (spec §12.5).
  const stickyLeftCls = "sticky left-0 z-10 bg-panel";

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
            Evaluation results — task scores by model
          </caption>
          <thead>
            <tr className="border-b border-edge">
              <th
                scope="col"
                className={`sticky top-0 z-20 min-w-[200px] px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted ${stickyLeftCls}`}
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
                    className={`sticky top-0 z-10 min-w-[150px] bg-panel px-3 py-2 font-normal${isWinner ? " bg-success/[0.06] ring-1 ring-success/40" : ""}`}
                  >
                    <span className="flex flex-col items-start gap-1 whitespace-nowrap">
                      {slot ? (
                        <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                      ) : (
                        <span className="font-mono text-text">{modelKey}</span>
                      )}
                      {isWinner ? <WinnerBadge /> : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageTaskIds.map((taskId) => {
              const taskIdx = pageTaskIndexes.get(taskId) ?? 0;
              const task = taskById.get(taskId);
              const title = task?.title ?? taskId;
              const rowCells = aggregation.cells[taskIdx] ?? [];
              const rowRunId = rowCells.find((c) => c.runId !== null)?.runId ?? null;
              // Per-row best: the highest score this task, all ties marked.
              let best: number | null = null;
              for (const c of rowCells) {
                if (c.kind === "scored") best = best === null ? c.score : Math.max(best, c.score);
              }
              return (
                <tr key={taskId} className="border-b border-edge last:border-b-0">
                  <th
                    scope="row"
                    className={`max-w-[320px] px-3 py-1 align-middle font-normal ${stickyLeftCls}`}
                  >
                    {rowRunId ? (
                      <Link
                        to={`/runs/${rowRunId}`}
                        className="flex min-h-[44px] min-w-0 items-center whitespace-normal text-sm font-medium leading-snug text-text transition-colors duration-150 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {title}
                      </Link>
                    ) : (
                      <span className="flex min-h-[44px] min-w-0 items-center whitespace-normal text-sm font-medium leading-snug text-text">
                        {title}
                      </span>
                    )}
                  </th>
                  {aggregation.modelKeys.map((modelKey, modelIdx) => {
                    const cell = rowCells[modelIdx];
                    return (
                      <td key={modelKey} className="px-3 py-1 align-middle">
                        <CellContent
                          cell={cell}
                          modelKey={modelKey}
                          runRecords={runRecords}
                          rowBest={
                            cell.kind === "scored" &&
                            best !== null &&
                            // Same epsilon as aggregation winner ties (1e-9).
                            Math.abs(cell.score - best) <= 1e-9
                          }
                          taskId={taskId}
                          repairable={repairablePlans?.get(taskId)?.has(modelKey) ?? false}
                          onRepairRequest={onRepairRequest}
                          evidenceRepo={evidenceRepo}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-edge bg-panel">
              <th
                scope="row"
                className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted ${stickyLeftCls}`}
              >
                Mean score
              </th>
              {aggregation.models.map((model) => {
                const isWinner = winners.has(model.modelKey);
                return (
                  <td
                    key={model.modelKey}
                    className={`px-3 py-2${isWinner ? " bg-success/[0.06] ring-1 ring-success/40" : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      {model.mean !== null ? (
                        <span className="tabular-nums text-base font-bold text-text">
                          {formatAggregateMean(model.mean)}
                        </span>
                      ) : (
                        <span className="text-sm text-text-secondary">No scores</span>
                      )}
                      {isWinner ? <WinnerBadge /> : null}
                    </span>
                  </td>
                );
              })}
            </tr>
            <tr className="border-t border-edge/60 bg-panel">
              <th
                scope="row"
                className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-text-muted ${stickyLeftCls}`}
              >
                Coverage
              </th>
              {aggregation.models.map((model) => {
                const isWinner = winners.has(model.modelKey);
                return (
                  <td
                    key={model.modelKey}
                    className={`px-3 py-2${isWinner ? " bg-success/[0.06] ring-1 ring-success/40" : ""}`}
                  >
                    <span className="tabular-nums text-sm text-text-secondary">
                      {model.scoredTasks}/{model.totalTasks} tasks
                      {!model.complete ? (
                        <span className="ml-1 text-xs font-medium text-text-muted">
                          Provisional
                        </span>
                      ) : null}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {pageCount > 1 ? (
        <Pagination
          page={currentPage}
          pageCount={pageCount}
          totalItems={totalTasks}
          onPageChange={handlePageChange}
        />
      ) : null}
    </div>
  );
}
