// =============================================================================
// TaskSetExecutionHistory — compact execution history for one task set (spec §10.4).
//
// Lists every experiment for the task set newest first — completed,
// completed_with_failures, aborted, and interrupted alike — below the task set
// editor's task list. Rows use the shared RecordRow family; each row links to
// /evaluations/results/:evaluationExecutionId and carries an exact localized start
// timestamp with timezone beneath the row (RecordRow itself shows relative time).
// Pagination begins after 20 rows and applies after filtering.
// =============================================================================

import { useEffect, useState } from "react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { ExperimentRecord } from "../../lib/evaluations/evaluation-types";
import { RecordRow } from "../../ui/RecordRow";

export interface TaskSetExecutionHistoryProps {
  repo: EvaluationRepository | null;
  taskSetId?: string;
  suiteId?: string;
}

export type SuiteExperimentHistoryProps = TaskSetExecutionHistoryProps;

const PAGE_SIZE = 20;

/** Task coverage: tasks with at least one completed attempt over total tasks. */
export function experimentCoverage(exp: ExperimentRecord): { completed: number; total: number } {
  return {
    completed: exp.tasks.filter((t) => t.attempts.some((a) => a.status === "completed")).length,
    total: exp.tasks.length,
  };
}

export function TaskSetExecutionHistory({
  repo,
  taskSetId,
  suiteId,
}: TaskSetExecutionHistoryProps) {
  const effectiveId = taskSetId ?? suiteId ?? "";
  const [experiments, setExperiments] = useState<ExperimentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    setVisibleCount(PAGE_SIZE);
    if (!repo) {
      setExperiments([]);
      setError("Storage unavailable — experiment history cannot load.");
      return;
    }
    setExperiments(null);
    setError(null);
    repo
      .listExperiments(effectiveId)
      .then((list) => {
        if (cancelled) return;
        // Sort defensively newest first even if the repository already orders.
        setExperiments([...list].sort((a, b) => b.createdAt - a.createdAt));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load experiments.");
        setExperiments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, effectiveId]);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <section aria-label="Evaluations" className="flex min-w-0 flex-col gap-2">
      <h2 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Evaluations</h2>
      {experiments === null ? (
        <p role="status" className="text-sm text-text-muted">
          Loading evaluations…
        </p>
      ) : error ? (
        <p className="text-sm text-text-secondary">{error}</p>
      ) : experiments.length === 0 ? (
        <p className="text-sm text-text-muted">
          No evaluations yet — run this task set to create one.
        </p>
      ) : (
        <>
          <ul className="flex min-w-0 flex-col gap-2" role="list">
            {experiments.slice(0, visibleCount).map((exp) => {
              const coverage = experimentCoverage(exp);
              return (
                <li key={exp.id} className="min-w-0">
                  <RecordRow
                    variant="list"
                    id={exp.id}
                    title={exp.id}
                    status={exp.status}
                    timestamp={exp.createdAt}
                    summary={`Task Set v${exp.suiteVersion} · ${coverage.completed}/${coverage.total} tasks · ${exp.snapshot.modelSlots.length} models`}
                    href={`/evaluations/results/${exp.id}`}
                  />
                  <p className="mt-0.5 min-w-0 truncate text-xs text-text-muted tabular-nums">
                    {new Date(exp.createdAt).toLocaleString()} ({timeZone})
                  </p>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-secondary tabular-nums">
              {Math.min(visibleCount, experiments.length)} of {experiments.length}
            </span>
            {visibleCount < experiments.length && (
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Show more
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

export { TaskSetExecutionHistory as SuiteExperimentHistory };
