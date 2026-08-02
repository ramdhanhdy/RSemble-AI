// =============================================================================
// MobileExperimentResults — <768px result adaptation (spec §12.1, §16).
//
// The wide matrix is unusable at 390px, so mobile gets a native model
// selector plus one row per task for the selected model. Switching models is
// pure local state — never navigation. Every row with evidence links to it.
// Layout never overflows horizontally: min-w-0 + truncation, no fixed widths.
// =============================================================================

import { useState } from "react";
import { Link } from "react-router-dom";
import type { ReactElement } from "react";
import { Pagination, PAGE_SIZE } from "../../ui/Pagination";
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
import { cellEvidenceLink, MISSING_CELL_DISPLAY } from "./ResultMatrix";
import type { RepairableCellPlans } from "./ResultMatrix";

export interface MobileExperimentResultsProps {
  aggregation: ExperimentAggregation;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  runRecords: ReadonlyMap<string, RunRecordV2>;
  /** Repairable no-score cells by task + model key (spec §11.2). */
  repairablePlans?: RepairableCellPlans;
  /** Recovery handoff — present only while this surface owns the lease; when
   *  provided, every missing row renders one action control (spec §11.1). */
  onRepairRequest?: (taskId: string, modelKey: string) => void;
}

const ROW_CLASSES =
  "flex min-h-[44px] w-full min-w-0 flex-col justify-center gap-1 rounded-md border border-edge bg-panel px-3 py-2";

function MissingTaskRow({
  title,
  reason,
  runId,
  modelKey,
  taskId,
  repairable,
  onRepairRequest,
}: {
  title: string;
  reason: MissingReason;
  runId: string | null;
  modelKey: string;
  taskId: string;
  repairable: boolean;
  onRepairRequest: ((taskId: string, modelKey: string) => void) | undefined;
}): ReactElement {
  const evidenceHref = runId ? `/runs/${runId}` : null;
  return (
    <div className={ROW_CLASSES}>
      <span className="truncate text-sm text-text">{title}</span>
      <span className="flex items-center gap-2">
        <StatusMark status={MISSING_CELL_DISPLAY[reason].status} size={12} />
        <span className="text-xs text-text-secondary">{MISSING_CELL_DISPLAY[reason].text}</span>
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
          className="inline-flex min-h-[44px] items-center text-xs text-accent transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View evidence
        </Link>
      ) : null}
    </div>
  );
}

function TaskRow({
  title,
  cell,
  modelKey,
  taskId,
  repairable,
  onRepairRequest,
  runRecords,
}: {
  title: string;
  cell: CellState;
  modelKey: string;
  taskId: string;
  repairable: boolean;
  onRepairRequest: ((taskId: string, modelKey: string) => void) | undefined;
  runRecords: ReadonlyMap<string, RunRecordV2>;
}): ReactElement {
  if (cell.kind !== "scored") {
    return (
      <MissingTaskRow
        title={title}
        reason={cell.reason}
        runId={cell.runId}
        modelKey={modelKey}
        taskId={taskId}
        repairable={repairable}
        onRepairRequest={onRepairRequest}
      />
    );
  }
  const href = cellEvidenceLink(cell, modelKey, cell.runId ? runRecords.get(cell.runId) : undefined);
  const value = (
    <span className="tabular-nums text-sm text-text">{formatTaskScore(cell.score)}</span>
  );
  const body = (
    <>
      <span className="truncate text-sm text-text">{title}</span>
      {value}
    </>
  );
  return href ? (
    <Link
      to={href}
      className={`${ROW_CLASSES} transition-colors duration-150 hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      {body}
    </Link>
  ) : (
    <div className={ROW_CLASSES}>{body}</div>
  );
}

export function MobileExperimentResults({
  aggregation,
  tasks,
  modelSlots,
  runRecords,
  repairablePlans,
  onRepairRequest,
}: MobileExperimentResultsProps): ReactElement {
  const [selectedKey, setSelectedKey] = useState<string>(aggregation.modelKeys[0] ?? "");
  const activeKey = aggregation.modelKeys.includes(selectedKey)
    ? selectedKey
    : (aggregation.modelKeys[0] ?? "");

  const slotsByKey = new Map(modelSlots.map((s) => [`${s.providerId}:${s.slug}`, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const modelIdx = aggregation.modelKeys.indexOf(activeKey);
  const model = aggregation.models[modelIdx];

  // Large-suite paging: 50 task cards per page, stable suite order (spec §12.5).
  const totalTasks = aggregation.taskIds.length;
  const pageCount = Math.max(1, Math.ceil(totalTasks / PAGE_SIZE));
  const [page, setPage] = useState(1);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageTaskIds = aggregation.taskIds.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="flex min-w-0 flex-col gap-3 pb-[calc(56px+env(safe-area-inset-bottom))]">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="mobile-experiment-model-select" className="text-sm text-text-secondary">
          Model
        </label>
        <select
          id="mobile-experiment-model-select"
          value={activeKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="min-h-[44px] w-full min-w-0 rounded-md border border-edge bg-panel px-3 text-sm text-text transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {aggregation.modelKeys.map((modelKey) => {
            const slot = slotsByKey.get(modelKey);
            return (
              <option key={modelKey} value={modelKey}>
                {slot ? `${slot.providerId}:${slot.slug}` : modelKey}
              </option>
            );
          })}
        </select>
      </div>

      {model ? (
        <p className="flex items-baseline gap-2 text-sm">
          {model.mean !== null ? (
            <>
              <span className="tabular-nums text-base font-bold text-text">
                {formatAggregateMean(model.mean)}
              </span>
              <span className="text-xs text-text-secondary">
                mean · {model.scoredTasks}/{model.totalTasks} tasks
              </span>
            </>
          ) : (
            <span className="text-text-secondary">No scores</span>
          )}
        </p>
      ) : null}

      <ul className="flex min-w-0 flex-col gap-2">
        {pageTaskIds.map((taskId) => {
          const taskIdx = aggregation.taskIds.indexOf(taskId);
          const cell = aggregation.cells[taskIdx]?.[modelIdx];
          if (!cell) return null;
          return (
            <li key={taskId} className="min-w-0">
              <TaskRow
                title={taskById.get(taskId)?.title ?? taskId}
                cell={cell}
                modelKey={activeKey}
                taskId={taskId}
                repairable={repairablePlans?.get(taskId)?.has(activeKey) ?? false}
                onRepairRequest={onRepairRequest}
                runRecords={runRecords}
              />
            </li>
          );
        })}
      </ul>
      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} totalItems={totalTasks} onPageChange={setPage} />
      ) : null}
    </div>
  );
}
