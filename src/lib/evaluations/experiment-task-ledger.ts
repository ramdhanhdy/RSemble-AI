// =============================================================================
// experiment-task-ledger — pure view model for the scalable experiment task
// progress ledger (spec §12.2-12.3, Task 13).
//
// Derives one primary row per task from an ExperimentRecord without touching
// run records: current attempt follows the Task 8 selection rules (explicit
// selectedAttemptId, else a live running attempt, else selectAttemptId's
// evidence policy, else the newest attempt), and status/coverage/trial/time
// columns are derived from that attempt. Filtering, search, and page slicing
// never mutate the canonical row order.
// =============================================================================

import { selectAttemptId } from "./experiment-engine";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskState,
} from "./evaluation-types";

export type TaskLedgerFilter = "all" | "active" | "issues" | "queued" | "complete";

export interface TaskLedgerRow {
  taskId: string;
  /** 1-based canonical position (snapshot tasks sorted by order). */
  order: number;
  title: string;
  status: string;
  scoredModels: number;
  totalModels: number;
  trialCount: number;
  currentAttemptId: string | null;
  history: ExperimentTaskAttempt[];
}

export interface TaskLedgerCounts {
  complete: number;
  partial: number;
  failed: number;
  queued: number;
}

export interface TaskLedgerContext {
  rows: TaskLedgerRow[];
  /** Running task, else first incomplete task in a non-terminal experiment. */
  currentTaskId: string | null;
  /** 1-based position of the current task; null when none. */
  currentIndex: number | null;
  total: number;
  counts: TaskLedgerCounts;
}

export interface TaskLedgerPage {
  rows: TaskLedgerRow[];
  /** Effective 1-based page after clamping. */
  page: number;
  pageCount: number;
  /** 1-based start within the filtered total (0 when empty). */
  start: number;
  /** Inclusive end within the filtered total (0 when empty). */
  end: number;
  total: number;
}

export const PAGE_SIZE = 50;

const FAILED_STATUSES: Record<string, true> = {
  failed: true,
  interrupted: true,
  aborted: true,
};

const ISSUE_STATUSES: Record<string, true> = {
  failed: true,
  partial: true,
  interrupted: true,
  aborted: true,
};

function isTerminal(status: ExperimentRecord["status"]): boolean {
  return (
    status === "completed" ||
    status === "completed_with_failures" ||
    status === "aborted" ||
    status === "interrupted"
  );
}

/**
 * Current attempt for display: explicit selection, else a live running
 * attempt, else the evidence-selection policy (spec §11.5), else the newest
 * attempt so failed/aborted/queued rows still show a truthful status.
 */
export function currentAttemptOf(task: ExperimentTaskState): ExperimentTaskAttempt | null {
  if (task.selectedAttemptId !== null) {
    const selected = task.attempts.find((a) => a.id === task.selectedAttemptId);
    if (selected) return selected;
  }
  const running = task.attempts.find((a) => a.status === "running");
  if (running) return running;
  const selectedId = selectAttemptId(task);
  if (selectedId !== null) {
    const selected = task.attempts.find((a) => a.id === selectedId);
    if (selected) return selected;
  }
  return task.attempts[task.attempts.length - 1] ?? null;
}

export function buildTaskLedger(experiment: ExperimentRecord): TaskLedgerContext {
  const stateByTaskId = new Map(experiment.tasks.map((t) => [t.taskId, t]));
  const slotCount = experiment.snapshot.modelSlots.length;
  const terminal = isTerminal(experiment.status);

  const rows: TaskLedgerRow[] = [...experiment.snapshot.tasks]
    .sort((a, b) => a.order - b.order)
    .map((task, index) => {
      const state = stateByTaskId.get(task.id);
      const attempts = state?.attempts ?? [];
      const current = currentAttemptOf(state ?? { taskId: task.id, selectedAttemptId: null, attempts });
      return {
        taskId: task.id,
        order: index + 1,
        title: task.title,
        status: current?.status ?? "queued",
        scoredModels: current?.coverage?.scoredModelKeys.length ?? 0,
        totalModels: current?.coverage?.totalModels ?? slotCount,
        trialCount: attempts.length,
        currentAttemptId: current?.id ?? null,
        history: attempts,
      };
    });

  const runningRow = rows.find((r) => r.status === "running") ?? null;
  const currentRow =
    runningRow ??
    (terminal ? null : (rows.find((r) => r.status !== "completed") ?? null));

  const counts: TaskLedgerCounts = { complete: 0, partial: 0, failed: 0, queued: 0 };
  for (const row of rows) {
    if (row.status === "completed") counts.complete += 1;
    else if (row.status === "partial") counts.partial += 1;
    else if (FAILED_STATUSES[row.status]) counts.failed += 1;
    else if (row.status === "queued") counts.queued += 1;
    // running rows are the live current task and belong to no bucket.
  }

  return {
    rows,
    currentTaskId: currentRow?.taskId ?? null,
    currentIndex: currentRow ? currentRow.order : null,
    total: rows.length,
    counts,
  };
}

/** Filter by ledger category. Returns a new array; never mutates input order. */
export function filterTaskLedgerRows(
  rows: TaskLedgerRow[],
  filter: TaskLedgerFilter,
  experimentStatus: ExperimentRecord["status"],
): TaskLedgerRow[] {
  switch (filter) {
    case "all":
      return rows;
    case "issues":
      return rows.filter((r) => ISSUE_STATUSES[r.status]);
    case "queued":
      return rows.filter((r) => r.status === "queued");
    case "complete":
      return rows.filter((r) => r.status === "completed");
    case "active": {
      const running = rows.filter((r) => r.status === "running");
      if (running.length > 0) return running;
      if (isTerminal(experimentStatus)) return [];
      const firstIncomplete = rows.find((r) => r.status !== "completed");
      return firstIncomplete ? [firstIncomplete] : [];
    }
  }
}

/** Case-insensitive search over title and task id. Returns a new array. */
export function searchTaskLedgerRows(rows: TaskLedgerRow[], query: string): TaskLedgerRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") return rows;
  return rows.filter(
    (r) => r.title.toLowerCase().includes(q) || r.taskId.toLowerCase().includes(q),
  );
}

/** Slice a row list into 1-based pages of PAGE_SIZE, clamping out-of-range pages. */
export function pageTaskLedgerRows(rows: TaskLedgerRow[], page: number): TaskLedgerPage {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const effective = Math.min(Math.max(1, page), pageCount);
  const startIndex = (effective - 1) * PAGE_SIZE;
  const slice = rows.slice(startIndex, startIndex + PAGE_SIZE);
  return {
    rows: slice,
    page: effective,
    pageCount,
    start: total === 0 ? 0 : startIndex + 1,
    end: startIndex + slice.length,
    total,
  };
}
