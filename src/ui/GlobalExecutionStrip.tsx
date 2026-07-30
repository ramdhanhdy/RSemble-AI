// =============================================================================
// GlobalExecutionStrip — cross-workspace execution awareness (spec §5.5)
//
// One 32–36px line below the app header while execution is active, paused,
// interrupted by storage failure, or owned by another tab. Reuses the
// PipelineRail grammar (status dot + mono caption + tabular elapsed) and is
// suppressed on the exact owning progress route — but suppression never hides
// a storage failure.
//
// Exports:
//  - buildStripViewModel: pure view-model builder (testable without rendering)
//  - formatElapsed: pure m:ss formatter
//  - GlobalExecutionStrip: presentational component
//  - GlobalExecutionStripContainer: wired container mounted in rsemble.tsx
// =============================================================================

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import { StatusMark } from "./StatusMark";
import type { ExperimentRecord } from "../lib/evaluations/evaluation-types";
import { useExecutionOwner } from "../lib/execution-owner-context";
import { useEvaluationRepository, useStorageState } from "../lib/persistence/repository-context";
import { useExecutionLease } from "../lib/evaluations/experiment-controller-context";

// --- View model ---------------------------------------------------------------

export interface StripViewModel {
  kind: "compare" | "experiment" | "other-tab";
  /** e.g. "Evaluation · Task 2/6 · Candidate fanout" */
  caption: string;
  /** Elapsed ms to render as tabular time; null when unknown. */
  elapsedMs: number | null;
  /** Link target for the View progress action; "" renders no link. */
  href: string;
  /** Truthful status line, e.g. running/paused/interrupted/owned elsewhere. */
  status: "running" | "paused" | "interrupted" | "other-tab";
  /** When set, an assertive one-shot announcement (abort/storage failure). */
  alert: string | null;
}

const STORAGE_FAILURE_ALERT =
  "Storage write failed — execution paused; retry or export before refreshing.";

/** m:ss with zero-padded seconds; negative input clamps to 0:00. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** 1-based snapshot index/title of the running (else first incomplete) task,
 *  plus the running attempt's start time for elapsed computation. */
function currentExperimentTask(experiment: ExperimentRecord): {
  total: number;
  currentIndex: number | null;
  currentTitle: string | null;
  runningStartedAt: number | null;
} {
  const stateByTaskId = new Map(experiment.tasks.map((t) => [t.taskId, t]));
  let runningIndex: number | null = null;
  let runningTitle: string | null = null;
  let runningStartedAt: number | null = null;
  let firstIncompleteIndex: number | null = null;
  let firstIncompleteTitle: string | null = null;
  experiment.snapshot.tasks.forEach((task, i) => {
    const attempts = stateByTaskId.get(task.id)?.attempts ?? [];
    const running = attempts.find((a) => a.status === "running");
    if (running && runningIndex === null) {
      runningIndex = i + 1;
      runningTitle = task.title;
      runningStartedAt = running.startedAt;
    }
    if (!attempts.some((a) => a.status === "completed") && firstIncompleteIndex === null) {
      firstIncompleteIndex = i + 1;
      firstIncompleteTitle = task.title;
    }
  });
  const currentIndex = runningIndex ?? firstIncompleteIndex;
  return {
    total: experiment.snapshot.tasks.length,
    currentIndex,
    currentTitle: runningTitle ?? firstIncompleteTitle,
    runningStartedAt,
  };
}

export function buildStripViewModel(deps: {
  owner: { kind: "compare" | "experiment"; id: string } | null;
  experiment: ExperimentRecord | null;
  pathname: string;
  compareRunning: boolean;
  leaseOwnedElsewhere: boolean;
  storageFailed: boolean;
}): StripViewModel | null {
  const { owner, experiment, pathname, compareRunning, leaseOwnedElsewhere, storageFailed } = deps;
  const alert = storageFailed ? STORAGE_FAILURE_ALERT : null;

  if (owner === null) {
    if (!leaseOwnedElsewhere) return null;
    // Execution owned by another tab: this tab has no progress page for it,
    // so the strip is informational only (no View progress link).
    return {
      kind: "other-tab",
      caption: "Execution is active in another tab",
      elapsedMs: null,
      href: "",
      status: "other-tab",
      alert,
    };
  }

  if (owner.kind === "compare") {
    // The Compare route already shows PipelineRail; suppress there. A storage
    // failure is never suppressed (spec §5.5).
    if (!storageFailed && (pathname === "/compare" || pathname === "/")) return null;
    return {
      kind: "compare",
      caption: compareRunning ? "Compare · Candidate fanout" : "Compare · Execution active",
      elapsedMs: null,
      href: "/compare",
      status: storageFailed ? "interrupted" : "running",
      alert,
    };
  }

  // Experiment-owned execution; the experiment progress route carries the same
  // information, so suppress exactly there (unless storage failed).
  if (!storageFailed && pathname === `/experiments/${owner.id}`) return null;
  const href = `/experiments/${owner.id}`;
  if (experiment === null) {
    return {
      kind: "experiment",
      caption: "Evaluation · Loading experiment…",
      elapsedMs: null,
      href,
      status: storageFailed ? "interrupted" : "running",
      alert,
    };
  }
  const current = currentExperimentTask(experiment);
  return {
    kind: "experiment",
    caption:
      current.currentIndex !== null && current.currentTitle !== null
        ? `Evaluation · Task ${current.currentIndex}/${current.total} · ${current.currentTitle}`
        : `Evaluation · ${current.total}/${current.total} tasks complete`,
    elapsedMs: Math.max(0, Date.now() - (current.runningStartedAt ?? experiment.createdAt)),
    href,
    status: storageFailed ? "interrupted" : experiment.status === "paused" ? "paused" : "running",
    alert,
  };
}

// --- Presentational component ---------------------------------------------------

const DOT_CLASSES: Record<StripViewModel["status"], string> = {
  running: "bg-accent motion-safe:animate-pulse",
  paused: "bg-text-muted",
  interrupted: "bg-error",
  "other-tab": "bg-text-muted",
};

export function GlobalExecutionStrip({ view }: { view: StripViewModel | null }): ReactElement | null {
  const [announcedCaption, setAnnouncedCaption] = useState<string | null>(null);
  const lastCaptionRef = useRef<string | null>(null);
  const [announcedAlert, setAnnouncedAlert] = useState<string | null>(null);
  const lastAlertRef = useRef<string | null>(null);

  const caption = view?.caption ?? null;
  const alert = view?.alert ?? null;

  // Polite announcements track meaningful caption (stage) transitions only;
  // an unchanged caption never re-announces (spec §15.8).
  useEffect(() => {
    if (caption !== null && caption !== lastCaptionRef.current) {
      lastCaptionRef.current = caption;
      setAnnouncedCaption(caption);
    }
  }, [caption]);

  // Abort/storage failures announce assertively exactly once per alert string.
  useEffect(() => {
    if (alert === null) {
      lastAlertRef.current = null;
      return;
    }
    if (alert !== lastAlertRef.current) {
      lastAlertRef.current = alert;
      setAnnouncedAlert(alert);
    }
  }, [alert]);

  if (view === null) return null;

  return (
    <div
      data-global-execution-strip=""
      className="flex h-9 items-center gap-2 border-b border-edge bg-panel px-3"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[view.status]}`}
      />
      {view.status === "other-tab" ? (
        <span className="shrink-0 text-xs text-text-muted">Another tab</span>
      ) : (
        <StatusMark status={view.status} />
      )}
      <span aria-hidden="true" className="min-w-0 flex-1 truncate font-mono text-xs text-text">
        {view.caption}
      </span>
      <span className="sr-only">{view.caption}</span>
      {view.elapsedMs !== null && (
        <span className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
          {formatElapsed(view.elapsedMs)}
        </span>
      )}
      {view.href !== "" && (
        <Link
          to={view.href}
          className="flex min-h-[44px] shrink-0 items-center px-3 text-xs text-accent transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View progress
        </Link>
      )}
      <span aria-live="polite" className="sr-only">
        {announcedCaption}
      </span>
      <span aria-live="assertive" className="sr-only">
        {announcedAlert}
      </span>
    </div>
  );
}

// --- Container -------------------------------------------------------------------

export function GlobalExecutionStripContainer({
  compareRunning,
}: {
  compareRunning: boolean;
}): ReactElement | null {
  const { owner } = useExecutionOwner();
  const evalRepo = useEvaluationRepository();
  const lease = useExecutionLease();
  const storageState = useStorageState();
  const { pathname } = useLocation();

  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [leaseOwnedElsewhere, setLeaseOwnedElsewhere] = useState(false);
  const [, setTick] = useState(0);

  const ownerKind = owner?.kind ?? null;
  const ownerId = owner?.id ?? null;

  // Poll the owned experiment record once per second while this tab owns an
  // experiment; the strip never duplicates the full progress controller.
  useEffect(() => {
    if (evalRepo === null || ownerKind !== "experiment" || ownerId === null) {
      setExperiment(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      evalRepo
        .getExperiment(ownerId)
        .then((record) => {
          if (!cancelled) setExperiment(record);
        })
        .catch(() => undefined);
    };
    load();
    const handle: ReturnType<typeof setInterval> | undefined = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [evalRepo, ownerKind, ownerId]);

  // Cross-tab lease contention drives the "owned elsewhere" strip state.
  useEffect(() => {
    if (lease === null) {
      setLeaseOwnedElsewhere(false);
      return;
    }
    return lease.subscribe((state) => {
      setLeaseOwnedElsewhere(state.status === "contested");
    });
  }, [lease]);

  // Tick once per second so the elapsed time stays live while executing.
  useEffect(() => {
    if (owner === null) return;
    const handle: ReturnType<typeof setInterval> | undefined = setInterval(
      () => setTick((t) => t + 1),
      1000,
    );
    return () => clearInterval(handle);
  }, [owner]);

  const view = buildStripViewModel({
    owner,
    experiment,
    pathname,
    compareRunning,
    leaseOwnedElsewhere,
    storageFailed: storageState === "blocked" || storageState === "unavailable",
  });

  return <GlobalExecutionStrip view={view} />;
}
