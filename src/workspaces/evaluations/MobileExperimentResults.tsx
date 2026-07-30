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
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type { ModelSlot } from "../../studio-data";
import type { EvaluationTask } from "../../lib/evaluations/evaluation-types";
import type {
  CellState,
  ExperimentAggregation,
} from "../../lib/evaluations/experiment-aggregation";
import {
  formatAggregateMean,
  formatTaskScore,
} from "../../lib/evaluations/experiment-aggregation";
import { StatusMark } from "../../ui/StatusMark";
import { cellEvidenceLink, MISSING_CELL_DISPLAY } from "./ResultMatrix";

export interface MobileExperimentResultsProps {
  aggregation: ExperimentAggregation;
  tasks: EvaluationTask[];
  modelSlots: ModelSlot[];
  runRecords: ReadonlyMap<string, RunRecordV2>;
}

const ROW_CLASSES =
  "flex min-h-[44px] w-full min-w-0 flex-col justify-center gap-1 rounded-md border border-edge bg-panel px-3 py-2";

function TaskRow({
  title,
  cell,
  modelKey,
  runRecords,
}: {
  title: string;
  cell: CellState;
  modelKey: string;
  runRecords: ReadonlyMap<string, RunRecordV2>;
}): ReactElement {
  const href = cellEvidenceLink(cell, modelKey, cell.runId ? runRecords.get(cell.runId) : undefined);
  const value =
    cell.kind === "scored" ? (
      <span className="tabular-nums text-sm text-text">{formatTaskScore(cell.score)}</span>
    ) : (
      <span className="flex items-center gap-2">
        <StatusMark status={MISSING_CELL_DISPLAY[cell.reason].status} size={12} />
        <span className="text-xs text-text-secondary">{MISSING_CELL_DISPLAY[cell.reason].text}</span>
      </span>
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
}: MobileExperimentResultsProps): ReactElement {
  const [selectedKey, setSelectedKey] = useState<string>(aggregation.modelKeys[0] ?? "");
  const activeKey = aggregation.modelKeys.includes(selectedKey)
    ? selectedKey
    : (aggregation.modelKeys[0] ?? "");

  const slotsByKey = new Map(modelSlots.map((s) => [`${s.providerId}:${s.slug}`, s]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const modelIdx = aggregation.modelKeys.indexOf(activeKey);
  const model = aggregation.models[modelIdx];

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
          <span className="text-text-secondary">Mean · coverage</span>
          {model.mean !== null ? (
            <span className="tabular-nums text-text">
              {formatAggregateMean(model.mean)} · {model.scoredTasks}/{model.totalTasks}
            </span>
          ) : (
            <span className="text-text-secondary">No scores</span>
          )}
        </p>
      ) : null}

      <ul className="flex min-w-0 flex-col gap-2">
        {aggregation.taskIds.map((taskId, taskIdx) => {
          const cell = aggregation.cells[taskIdx]?.[modelIdx];
          if (!cell) return null;
          return (
            <li key={taskId} className="min-w-0">
              <TaskRow
                title={taskById.get(taskId)?.title ?? taskId}
                cell={cell}
                modelKey={activeKey}
                runRecords={runRecords}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
