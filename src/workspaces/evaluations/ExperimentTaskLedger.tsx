// =============================================================================
// ExperimentTaskLedger — scalable task progress ledger (spec §12.2-12.3, Task 13)
//
// One primary row per task with stable columns (index, title, status, coverage,
// trial, time, action) below a sticky instrument header that pins the current
// task and Pause/Resume + Abort controls to the top of the route scroller.
// Attempt history lives behind a collapsed disclosure and only mounts when
// opened, so 250-task suites stay bounded: at most PAGE_SIZE primary rows are
// ever mounted, and filter/page changes never animate or reorder the rows.
// =============================================================================

import { useMemo, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";
import { formatElapsed } from "../../ui/GlobalExecutionStrip";
import { formatRelativeTime } from "../../ui/RecordRow";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
} from "../../lib/evaluations/evaluation-types";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import {
  buildTaskLedger,
  filterTaskLedgerRows,
  pageTaskLedgerRows,
  searchTaskLedgerRows,
  type TaskLedgerFilter,
  type TaskLedgerRow,
} from "../../lib/evaluations/experiment-task-ledger";

export interface ExperimentTaskLedgerProps {
  experiment: ExperimentRecord;
  controller: ExperimentController | null;
  /** Tick clock so the running task's elapsed time stays live. */
  now: number;
}

const FILTERS: readonly { value: TaskLedgerFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "issues", label: "Issues" },
  { value: "queued", label: "Queued" },
  { value: "complete", label: "Complete" },
];

const BUTTON_BASE =
  "pressable flex min-h-[44px] items-center rounded-md border px-4 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_NEUTRAL = `${BUTTON_BASE} border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text`;
const BUTTON_DESTRUCTIVE = `${BUTTON_BASE} border-error/40 bg-panel text-error hover:border-error`;

function currentAttemptOf(row: TaskLedgerRow): ExperimentTaskAttempt | null {
  if (row.currentAttemptId === null) return null;
  return row.history.find((a) => a.id === row.currentAttemptId) ?? null;
}

/** Running attempts show live elapsed; finished attempts show relative time. */
function attemptTime(attempt: ExperimentTaskAttempt | null, now: number): string {
  if (!attempt) return "—";
  if (attempt.status === "running" && attempt.startedAt !== null) {
    return formatElapsed(now - attempt.startedAt);
  }
  const ts = attempt.finishedAt ?? attempt.startedAt;
  return ts === null ? "—" : formatRelativeTime(ts);
}

export function ExperimentTaskLedger({
  experiment,
  controller,
  now,
}: ExperimentTaskLedgerProps): ReactElement {
  const [filter, setFilter] = useState<TaskLedgerFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const context = useMemo(() => buildTaskLedger(experiment), [experiment]);
  const { rows, currentTaskId, currentIndex, total, counts } = context;

  const filtered = useMemo(() => {
    let out = filterTaskLedgerRows(rows, filter, experiment.status);
    if (query.trim() !== "") out = searchTaskLedgerRows(out, query);
    return out;
  }, [rows, filter, query, experiment.status]);

  const paged = useMemo(() => pageTaskLedgerRows(filtered, page), [filtered, page]);

  const currentRow =
    currentTaskId !== null ? (rows.find((r) => r.taskId === currentTaskId) ?? null) : null;
  const currentAttempt = currentRow ? currentAttemptOf(currentRow) : null;

  const controllerUnavailable = controller === null;
  const workActive = experiment.status === "running" || experiment.status === "paused";

  const applyFilter = (value: TaskLedgerFilter): void => {
    setFilter(value);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-2">
      <header
        data-ledger-instrument=""
        className="sticky top-0 z-10 flex flex-col gap-2 border-b border-edge bg-panel/95 py-2"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {currentIndex !== null && currentRow ? (
            <p className="text-sm text-text-secondary">
              Task {currentIndex} of {total} ·{" "}
              <span className="font-mono text-text">{currentRow.title}</span>
            </p>
          ) : (
            <p className="text-sm text-text-secondary">All {total} tasks complete</p>
          )}
          <p className="text-xs text-text-muted">
            {counts.complete} completed · {counts.partial} partial · {counts.failed} failed ·{" "}
            {counts.queued} queued
            {currentAttempt?.status === "running" && currentAttempt.startedAt !== null && (
              <>
                {" "}
                · <span className="tabular-nums">{formatElapsed(now - currentAttempt.startedAt)}</span>{" "}
                elapsed
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {experiment.status === "running" && (
            <button
              type="button"
              disabled={controllerUnavailable}
              onClick={() => {
                if (controller) void controller.requestPause();
              }}
              className={BUTTON_NEUTRAL}
            >
              Pause after current task
            </button>
          )}
          {experiment.status === "paused" && (
            <button
              type="button"
              disabled={controllerUnavailable}
              onClick={() => {
                if (controller) void controller.resume();
              }}
              className={BUTTON_NEUTRAL}
            >
              Resume
            </button>
          )}
          {workActive && (
            <button
              type="button"
              disabled={controllerUnavailable}
              onClick={() => {
                if (controller) void controller.abort();
              }}
              className={BUTTON_DESTRUCTIVE}
            >
              Abort experiment
            </button>
          )}
          <label className="ml-auto flex min-h-[44px] items-center gap-2 rounded-md border border-edge bg-panel px-3 focus-within:border-edge-bright focus-within:ring-2 focus-within:ring-accent">
            <span className="sr-only">Search tasks</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search tasks…"
              className="w-48 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            />
          </label>
        </div>

        <div role="group" aria-label="Filter tasks" className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => applyFilter(f.value)}
              className={`${BUTTON_BASE} ${
                filter === f.value
                  ? "border-edge-bright bg-panel text-text"
                  : "border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <section data-ledger-rows="" aria-label="Task ledger" className="flex flex-col gap-1.5">
        {paged.rows.map((row) => {
          const attempt = currentAttemptOf(row);
          const open = openTaskId === row.taskId;
          return (
            <div key={row.taskId} className="flex flex-col gap-1">
              <div data-task-row="" className="flex items-center gap-2">
                <div
                  data-record-row-surface=""
                  className="grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)_8rem_5rem_5rem_7rem] items-center gap-3 rounded-md border border-edge bg-panel px-3 py-2 text-sm transition-colors duration-150 hover:border-edge-bright"
                >
                  <span className="tabular-nums text-text-muted">{row.order}</span>
                  <span className="min-w-0 truncate font-mono text-text" title={row.title}>
                    {row.title}
                  </span>
                  <StatusMark status={row.status as StatusMarkStatus} />
                  <span className="tabular-nums text-text-muted">
                    {attempt && attempt.coverage
                      ? `${attempt.coverage.scoredModelKeys.length}/${attempt.coverage.totalModels}`
                      : "—"}
                  </span>
                  <span className="text-text-secondary">
                    {attempt ? `Trial ${attempt.trial}` : "—"}
                  </span>
                  <span className="tabular-nums text-text-secondary">{attemptTime(attempt, now)}</span>
                </div>
                <div className="flex items-center">
                  <button
                    type="button"
                    data-attempt-toggle=""
                    aria-expanded={open}
                    aria-controls={`attempts-${row.taskId}`}
                    onClick={() => setOpenTaskId(open ? null : row.taskId)}
                    className="pressable flex min-h-[44px] items-center gap-1 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {open ? (
                      <ChevronDown aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    )}
                    Attempts ({row.trialCount})
                  </button>
                </div>
              </div>
              {open && (
                <div
                  id={`attempts-${row.taskId}`}
                  data-attempt-history=""
                  className="flex flex-col gap-1 rounded-md border border-edge bg-panel/60 px-3 py-2"
                >
                  {row.history.length === 0 && (
                    <p className="text-sm text-text-muted">No attempts yet.</p>
                  )}
                  {row.history.map((attempt) => (
                    <div
                      key={attempt.id}
                      data-attempt-row=""
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 py-1 text-sm"
                    >
                      <StatusMark status={attempt.status} />
                      <span className="text-text-secondary">Trial {attempt.trial}</span>
                      <span className="tabular-nums text-text-muted">
                        {attempt.coverage
                          ? `${attempt.coverage.scoredModelKeys.length}/${attempt.coverage.totalModels}`
                          : "—"}
                      </span>
                      <span className="tabular-nums text-text-muted">{attemptTime(attempt, now)}</span>
                      {attempt.error && <span className="text-error">{attempt.error.message}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <nav aria-label="Task pages" className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={paged.page <= 1}
          onClick={() => setPage(paged.page - 1)}
          className={BUTTON_NEUTRAL}
        >
          Previous
        </button>
        <span className="text-sm tabular-nums text-text-secondary">
          {paged.start}–{paged.end} of {paged.total}
        </span>
        <button
          type="button"
          disabled={paged.page >= paged.pageCount}
          onClick={() => setPage(paged.page + 1)}
          className={BUTTON_NEUTRAL}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
