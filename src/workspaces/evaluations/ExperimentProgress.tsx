// =============================================================================
// ExperimentProgress — live experiment progress surface (spec §11, Phase 7)
//
// Mounted by ExperimentRoute for non-terminal experiments. Shows the
// completed/total summary, one RecordRow per task attempt in snapshot order,
// and the execution controls (pause-at-boundary, resume, abort, retry
// incomplete). A controller "error" event surfaces a compact role="alert"
// region with the failed operation and the next action (spec §14).
// =============================================================================

import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { StatusMark } from "../../ui/StatusMark";
import { RecordRow } from "../../ui/RecordRow";
import { formatElapsed } from "../../ui/GlobalExecutionStrip";
import type { ExperimentRecord } from "../../lib/evaluations/evaluation-types";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";

export interface ExperimentProgressProps {
  experiment: ExperimentRecord;
  controller: ExperimentController | null;
}

const RETRYABLE_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "partial",
  "interrupted",
  "aborted",
]);

const BUTTON_BASE =
  "flex min-h-[44px] items-center rounded-md border px-4 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_NEUTRAL = `${BUTTON_BASE} border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text`;
const BUTTON_DESTRUCTIVE = `${BUTTON_BASE} border-error/40 bg-panel text-error hover:border-error`;

export function ExperimentProgress({
  experiment,
  controller,
}: ExperimentProgressProps): ReactElement {
  const [controllerError, setControllerError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Persistence errors stop advancement; surface the failed operation plus
  // the next action (spec §11.4, §14).
  useEffect(() => {
    if (controller === null) return;
    return controller.subscribe((event) => {
      if (event.kind === "error") setControllerError(event.error);
    });
  }, [controller]);

  const stateByTaskId = new Map(experiment.tasks.map((t) => [t.taskId, t]));
  const ordered = experiment.snapshot.tasks.map((task) => ({
    task,
    attempts: stateByTaskId.get(task.id)?.attempts ?? [],
  }));

  const hasRunningAttempt = experiment.tasks.some((t) =>
    t.attempts.some((a) => a.status === "running"),
  );
  const hasRetryableAttempt = experiment.tasks.some((t) =>
    t.attempts.some((a) => RETRYABLE_STATUSES.has(a.status)),
  );
  // Retry is absent (not disabled) while work is active or nothing failed.
  const showRetry = !hasRunningAttempt && hasRetryableAttempt;

  // Tick once per second so the active attempt's elapsed time stays live.
  useEffect(() => {
    if (!hasRunningAttempt) return;
    const handle: ReturnType<typeof setInterval> | undefined = setInterval(
      () => setNow(Date.now()),
      1000,
    );
    return () => clearInterval(handle);
  }, [hasRunningAttempt]);

  const total = ordered.length;
  const completedCount = ordered.filter(({ attempts }) =>
    attempts.some((a) => a.status === "completed"),
  ).length;
  const currentEntry =
    ordered.find(({ attempts }) => attempts.some((a) => a.status === "running")) ??
    ordered.find(({ attempts }) => !attempts.some((a) => a.status === "completed"));
  const currentIndex = currentEntry ? ordered.indexOf(currentEntry) + 1 : null;

  const controllerUnavailable = controller === null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="max-w-[18rem] truncate font-mono text-sm text-text">{experiment.id}</h1>
          <span className="text-xs text-text-muted">Suite v{experiment.snapshot.suiteVersion}</span>
          <StatusMark status={experiment.status} />
        </div>
        <p className="text-xs text-text-muted">
          Started {new Date(experiment.createdAt).toLocaleString()} ({timeZone})
        </p>
      </header>

      <p className="text-sm text-text-secondary">
        {currentIndex !== null && currentEntry
          ? `Task ${currentIndex} of ${total} · ${currentEntry.task.title} · ${completedCount} completed`
          : `${total} of ${total} tasks complete`}
      </p>

      {controllerError !== null && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-error/40 bg-panel px-3 py-2 text-sm text-error"
        >
          <p>Storage write failed: {controllerError}</p>
          <p>Retry or export before refreshing.</p>
        </div>
      )}

      <section aria-label="Experiment tasks" className="flex flex-col gap-2">
        {ordered.map(({ task, attempts }) => (
          <div key={task.id} data-task-section="" className="flex flex-col gap-1">
            {attempts.map((attempt) => (
              <RecordRow
                key={attempt.id}
                variant="list"
                id={attempt.id}
                title={task.title}
                status={attempt.status}
                timestamp={attempt.startedAt ?? experiment.createdAt}
                summary={
                  attempt.status === "running" && attempt.startedAt !== null
                    ? `Trial ${attempt.trial} · ${formatElapsed(now - attempt.startedAt)} elapsed`
                    : `Trial ${attempt.trial}`
                }
              />
            ))}
          </div>
        ))}
      </section>

      <footer className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {experiment.status === "running" && (
            <button
              type="button"
              disabled={controllerUnavailable}
              onClick={() => controller?.requestPause()}
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
          {(experiment.status === "running" || experiment.status === "paused") && (
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
          {showRetry && (
            <button
              type="button"
              disabled={controllerUnavailable}
              onClick={() => {
                if (controller) void controller.retryIncomplete(experiment.id);
              }}
              className={BUTTON_NEUTRAL}
            >
              Retry incomplete tasks
            </button>
          )}
          <Link
            to={`/evaluations/${experiment.suiteId}`}
            className="flex min-h-[44px] items-center px-3 text-sm text-text-secondary transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to suite
          </Link>
        </div>
        {experiment.status === "running" && (
          <p className="text-xs text-text-muted">Takes effect when the current task finishes.</p>
        )}
        {controllerUnavailable && (
          <p className="text-xs text-text-muted">
            Execution controller unavailable (storage not ready).
          </p>
        )}
      </footer>
    </div>
  );
}
