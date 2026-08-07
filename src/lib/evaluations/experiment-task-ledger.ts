// =============================================================================
// experiment-task-ledger — pure view model for the scalable experiment task
// progress ledger (spec §12.2-12.3, Task 13).
//
// Derives one primary row per task from an ExperimentRecord without touching
// run records: current attempt follows the Task 8 selection rules (explicit
// selectedAttemptId, else a live running attempt, else selectAttemptId's
// evidence policy, else the newest attempt), and status/coverage/attempt/time
// columns are derived from that attempt. Filtering, search, and page slicing
// never mutate the canonical row order.
// =============================================================================

import { selectAttemptId } from "./experiment-engine";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
  ExperimentTaskExecutionPlan,
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
 * Current attempt for display: a live running attempt first (a retry/repair
 * run in flight is the current state even though the engine preserves the
 * prior selected evidence until terminal commit), then the explicit selection,
 * then the evidence-selection policy (spec §11.5), then the newest attempt so
 * failed/aborted/queued rows still show a truthful status.
 */
export function currentAttemptOf(task: ExperimentTaskState): ExperimentTaskAttempt | null {
  const running = task.attempts.find((a) => a.status === "running");
  if (running) return running;
  if (task.selectedAttemptId !== null) {
    const selected = task.attempts.find((a) => a.id === task.selectedAttemptId);
    if (selected) return selected;
  }
  const selectedId = selectAttemptId(task);
  if (selectedId !== null) {
    const selected = task.attempts.find((a) => a.id === selectedId);
    if (selected) return selected;
  }
  return task.attempts[task.attempts.length - 1] ?? null;
}

/** Live progress banner scope. History (`rosterExtensions`) is never consulted. */
export type ActiveOperationScope =
  | {
      kind: "missing-cells";
      modelKeys: string[];
      label: "Completing missing results";
    }
  | {
      kind: "roster-extension";
      modelKeys: string[];
      label: "Roster extension in progress";
    }
  | {
      kind: "targeted-mixed";
      modelKeys: string[];
      label: "Targeted completion in progress";
    };

function planModelKeys(plan: ExperimentTaskExecutionPlan): string[] {
  if (plan.kind === "missing-cells") return [...plan.requestedModelKeys];
  return [plan.addedModelKey];
}

/**
 * Derive the active targeted-operation banner from live/queued attempt plans.
 * Prefers running attempts via `currentAttemptOf`; while paused with no runner,
 * falls back to queued plans. Never reads `rosterExtensions` history.
 */
export function deriveActiveOperationScope(
  experiment: ExperimentRecord,
): ActiveOperationScope | null {
  if (experiment.status !== "running" && experiment.status !== "paused") {
    return null;
  }

  const livePlans: ExperimentTaskExecutionPlan[] = [];
  for (const task of experiment.tasks) {
    const current = currentAttemptOf(task);
    if (!current?.repair) continue;
    if (current.status === "running") {
      livePlans.push(current.repair);
      continue;
    }
    // Paused experiments keep truthful scope from queued planned work.
    if (experiment.status === "paused" && current.status === "queued" && current.repair) {
      livePlans.push(current.repair);
    }
  }

  // If nothing is running, still surface any queued plan while the experiment
  // is running (between tasks) so the banner does not flicker to history.
  if (livePlans.length === 0 && experiment.status === "running") {
    for (const task of experiment.tasks) {
      for (const attempt of task.attempts) {
        if (attempt.status === "queued" && attempt.repair) {
          livePlans.push(attempt.repair);
        }
      }
    }
  }

  if (livePlans.length === 0) return null;

  const kinds = new Set(livePlans.map((p) => p.kind));
  const keySets = livePlans.map((p) => planModelKeys(p).slice().sort().join("\0"));
  const uniqueKeySets = new Set(keySets);
  const modelKeys = [...new Set(livePlans.flatMap(planModelKeys))];

  if (kinds.size > 1 || uniqueKeySets.size > 1) {
    if (import.meta.env?.DEV) {
      console.warn(
        "[experiment] inconsistent active operation plans; rendering neutral targeted banner",
        { kinds: [...kinds], modelKeys },
      );
    }
    return {
      kind: "targeted-mixed",
      modelKeys,
      label: "Targeted completion in progress",
    };
  }

  const plan = livePlans[0]!;
  if (plan.kind === "missing-cells") {
    return {
      kind: "missing-cells",
      modelKeys: planModelKeys(plan),
      label: "Completing missing results",
    };
  }
  return {
    kind: "roster-extension",
    modelKeys: planModelKeys(plan),
    label: "Roster extension in progress",
  };
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
      const current = currentAttemptOf(
        state ?? { taskId: task.id, selectedAttemptId: null, attempts },
      );
      return {
        taskId: task.id,
        order: index + 1,
        title: task.title,
        status: current?.status ?? "queued",
        scoredModels: current?.coverage?.scoredModelKeys.length ?? 0,
        totalModels: current?.coverage?.totalModels ?? slotCount,
        currentAttemptId: current?.id ?? null,
        history: attempts,
      };
    });

  const runningRow = rows.find((r) => r.status === "running") ?? null;
  const currentRow =
    runningRow ?? (terminal ? null : (rows.find((r) => r.status !== "completed") ?? null));

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
