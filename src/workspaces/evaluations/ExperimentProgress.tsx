// =============================================================================
// ExperimentProgress — live experiment progress surface (spec §11, Phase 7)
//
// Mounted by ExperimentRoute for non-terminal experiments. Shows the identity
// header, the scalable task ledger (sticky instrument header with current task,
// counts, elapsed, Pause/Resume + Abort; one primary row per task; collapsed
// attempt history; 50-row pages), and the footer recovery controls
// (retry incomplete, back to suite). A controller "error" event surfaces a
// compact role="alert" region with the failed operation and the next action
// (spec §14).
// =============================================================================

import { useEffect, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { StatusMark } from "../../ui/StatusMark";
import { ExperimentTaskLedger } from "./ExperimentTaskLedger";
import type { ExperimentRecord } from "../../lib/evaluations/evaluation-types";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import { deriveActiveOperationScope } from "../../lib/evaluations/experiment-task-ledger";

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
  "pressable flex min-h-[44px] items-center rounded-md border px-4 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_NEUTRAL = `${BUTTON_BASE} border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text`;

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

  const controllerUnavailable = controller === null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Live scope comes from the active attempt plan, never rosterExtensions history.
  const activeScope = deriveActiveOperationScope(experiment);
  const scopeModelLabel =
    activeScope === null
      ? ""
      : activeScope.modelKeys.length === 1
        ? activeScope.modelKeys[0]!
        : activeScope.modelKeys.join(", ");

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="max-w-[18rem] truncate font-mono text-sm text-text">{experiment.id}</h1>
          <span className="text-xs text-text-muted">Task Set v{experiment.snapshot.suiteVersion}</span>
          <StatusMark status={experiment.status} />
        </div>
        <p className="text-xs text-text-muted">
          Started {new Date(experiment.createdAt).toLocaleString()} ({timeZone})
        </p>
        {activeScope !== null && (
          <p
            data-extension-scope=""
            data-operation-kind={activeScope.kind}
            className="rounded-md border border-accent/40 bg-panel px-3 py-2 text-xs text-text-secondary"
          >
            {activeScope.kind === "targeted-mixed" ? (
              <>
                Targeted completion in progress
                {scopeModelLabel ? (
                  <>
                    : <span className="font-mono text-text">{scopeModelLabel}</span>
                  </>
                ) : null}
                . Other accepted evidence is reused; one fresh Judge pass per task.
              </>
            ) : (
              <>
                {activeScope.label}: running{" "}
                <span className="font-mono text-text">{scopeModelLabel}</span>
                {activeScope.modelKeys.length === 1 ? " only" : ""}. Other accepted evidence is
                reused; one fresh Judge pass per task.
              </>
            )}
          </p>
        )}
      </header>

      {controllerError !== null && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-error/40 bg-panel px-3 py-2 text-sm text-error"
        >
          <p>Storage write failed: {controllerError}</p>
          <p>Retry or export before refreshing.</p>
        </div>
      )}

      <ExperimentTaskLedger experiment={experiment} controller={controller} now={now} />

      <footer className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
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
            to={`/evaluations/sets/${experiment.suiteId}`}
            className="flex min-h-[44px] items-center px-3 text-sm text-text-secondary transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to task set
          </Link>
        </div>
        {controllerUnavailable && (
          <p className="text-xs text-text-muted">
            Execution controller unavailable (storage not ready).
          </p>
        )}
      </footer>
    </div>
  );
}
