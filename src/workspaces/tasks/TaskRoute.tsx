// =============================================================================
// RSemble AI — Task routes (canonical-tasks spec §7)
//
// Child 02 (Canonical Tasks) Milestone D, Tasks 6-7.
//
//   /tasks/new                     → atomic Task + version 1 create editor
//   /tasks/:taskId                 → detail editor: draft latest version with
//                                    dirty/saved state, explicit version N+1,
//                                    duplicate identity, archive/restore CAS;
//                                    archived Tasks stay routable (§4.5)
//   /tasks/:taskId/versions/:v    → immutable read-only version view
//
// Unknown task IDs, unknown version numbers, and malformed version params
// render explicit not-found / invalid states — never a silent redirect back to
// the catalog.
// =============================================================================

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { StorageError } from "../../lib/persistence/database";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import { useEvaluationRepository } from "../../lib/persistence/repository-context";

import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import { TaskNewEditor, TaskDetailEditor, TaskVersionView } from "./TaskEditor";
import { TaskFacetEditor } from "./TaskFacetEditor";
import { TaskFamilyRegistry } from "./TaskFamilyRegistry";
import { TaskFamilyAssignmentSection } from "./TaskFamilyAssignment";
import { TaskReferencesSection } from "./TaskReferencesSection";

function StorageUnavailable() {
  return (
    <div
      data-task-error-state
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-12 text-center"
    >
      <AlertCircle size={20} className="text-error" aria-hidden="true" />
      <p className="text-sm font-medium text-error">Task storage is unavailable.</p>
      <p className="text-sm text-text-secondary">
        The canonical Task catalog could not be initialized. Compare remains operational.
      </p>
      <BackToCatalog />
    </div>
  );
}

function BackToCatalog() {
  return (
    <Link
      to="/tasks"
      className="mt-2 flex min-h-[44px] items-center gap-2 rounded-md border border-edge bg-card px-3 text-sm text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <ArrowLeft size={16} aria-hidden="true" />
      Back to tasks
    </Link>
  );
}

function NotFound({ label, taskId }: { label: string; taskId: string }) {
  return (
    <div
      data-task-not-found
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-12 text-center"
    >
      <AlertCircle size={20} className="text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-text">{label}</p>
      <p className="text-sm text-text-secondary">
        No canonical Task exists at <span className="font-mono text-xs">{taskId}</span>. Direct
        links to unknown tasks stay explicit instead of redirecting silently.
      </p>
      <BackToCatalog />
    </div>
  );
}

function LoadFailure({ error, onRetry }: { error: StorageError; onRetry: () => void }) {
  return (
    <div
      data-task-error-state
      role="alert"
      className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-12 text-center"
    >
      <AlertCircle size={20} className="text-error" aria-hidden="true" />
      <p className="text-sm font-medium text-error">Failed to load task ({error.kind}).</p>
      <p className="text-sm text-text-secondary">{error.message}</p>
      <button
        type="button"
        data-action="retry"
        onClick={onRetry}
        className="mt-2 min-h-[44px] rounded-md border border-edge bg-card px-4 text-sm text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Retry
      </button>
    </div>
  );
}

type DetailState =
  | { kind: "loading" }
  | { kind: "ready"; record: TaskRecord; version: TaskVersion | null }
  | { kind: "not-found" }
  | { kind: "error"; error: StorageError };

function useTaskRecord(
  repo: TaskRepository | null,
  taskId: string,
): {
  state: DetailState;
  retry: () => void;
} {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (repo === null) {
      setState({
        kind: "error",
        error: new StorageError("unavailable", "Task storage unavailable"),
      });
      return;
    }
    if (taskId === "") {
      setState({ kind: "not-found" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    repo
      .getTaskRecord(taskId)
      .then(async (record) => {
        if (cancelled) return;
        if (!record) {
          setState({ kind: "not-found" });
          return;
        }
        const version = await repo.getTaskVersion(record.id, record.latestVersion);
        if (cancelled) return;
        setState({ kind: "ready", record, version });
      })
      .catch((err) => {
        if (cancelled) return;
        const classified =
          err instanceof StorageError ? err : new StorageError("unavailable", String(err));
        setState({ kind: "error", error: classified });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, taskId, tick]);
  return { state, retry: () => setTick((t) => t + 1) };
}

// --- /tasks/new --------------------------------------------------------------

/** Atomic Task + version 1 create editor (spec §7.3). */
export function TaskNewRoute({ repo }: { repo: TaskRepository | null }) {
  if (repo === null) return <StorageUnavailable />;
  return <TaskNewEditor repo={repo} />;
}

// --- /tasks/:taskId ----------------------------------------------------------

/** Task detail editor: stable identity header plus the draft/commit surface.
 *  Archived Tasks stay routable here and expose restore (spec §4.5). */
export function TaskDetailRoute({ repo, taskId }: { repo: TaskRepository | null; taskId: string }) {
  const evalRepo = useEvaluationRepository();

  const { state, retry } = useTaskRecord(repo, taskId);

  if (state.kind === "error") {
    return state.error.kind === "unavailable" && repo === null ? (
      <StorageUnavailable />
    ) : (
      <LoadFailure error={state.error} onRetry={retry} />
    );
  }
  if (state.kind === "not-found") {
    return <NotFound label={`Task “${taskId}” was not found.`} taskId={taskId} />;
  }
  if (state.kind === "loading") {
    return (
      <div
        data-task-loading
        className="mx-auto flex w-full max-w-3xl items-center justify-center px-4 py-12 text-sm text-text-muted"
      >
        Loading task…
      </div>
    );
  }

  const { record, version } = state;
  return (
    <div
      data-task-detail={record.id}
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold text-text">{version?.title ?? record.id}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span className="font-mono text-xs">{record.id}</span>
            <span>v{record.latestVersion}</span>
            <span>{record.origin}</span>
            {record.archivedAt !== null && (
              <span className="rounded-sm border border-edge bg-raised px-2 py-0.5 text-xs">
                Archived
              </span>
            )}
          </p>
        </div>
        <BackToCatalog />
      </header>
      {/* The route hook exposes the repository through props so the editor
          never couples to the storage context directly. `version` exists
          whenever the record loads; a missing latest row would be corrupt
          state and falls back to the identity header alone. */}
      {version && repo ? (
        <TaskDetailEditor
          repo={repo}
          initialRecord={record}
          initialVersion={version}
          onRefresh={retry}
        />
      ) : null}

      {/* Family and facets are edited separately from Task content, with
          provenance (spec §7.2). Archived Tasks keep the summaries visible
          but render every binding control read-only (spec §4.5). */}
      {version && repo ? (
        <>
          <section
            data-task-family-section
            className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4"
          >
            <h2 className="text-base font-semibold text-text">Family</h2>
            <TaskFamilyAssignmentSection
              repo={repo}
              taskId={record.id}
              taskVersion={record.latestVersion}
              disabled={record.archivedAt !== null}
            />
          </section>

          <section className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4">
            <h2 className="text-base font-semibold text-text">Families</h2>
            <TaskFamilyRegistry repo={repo} />
          </section>

          <section
            data-task-facets-section
            className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4"
          >
            <h2 className="text-base font-semibold text-text">Facets</h2>
            <TaskFacetEditor repo={repo} taskId={record.id} disabled={record.archivedAt !== null} />
          </section>

          <TaskReferencesSection taskRepo={repo} evalRepo={evalRepo} task={record} />
        </>
      ) : null}
    </div>
  );
}

// --- /tasks/:taskId/versions/:version ---------------------------------------

/** Immutable version shell for direct loads and deep links. Unknown versions
 *  and malformed params are explicit; nothing redirects. */
export function TaskVersionRoute({
  repo,
  taskId,
  version,
}: {
  repo: TaskRepository | null;
  taskId: string;
  version: number;
}) {
  const validVersion = Number.isFinite(version) && Number.isInteger(version) && version > 0;
  const { state, retry } = useTaskRecord(repo, validVersion ? taskId : "");
  const [versionState, setVersionState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; version: TaskVersion }
    | { kind: "not-found" }
  >({ kind: "idle" });

  useEffect(() => {
    if (repo === null || !validVersion) return;
    let cancelled = false;
    setVersionState({ kind: "loading" });
    repo
      .getTaskVersion(taskId, version)
      .then((v) => {
        if (cancelled) return;
        setVersionState(v ? { kind: "ready", version: v } : { kind: "not-found" });
      })
      .catch(() => {
        if (!cancelled) setVersionState({ kind: "not-found" });
      });
    return () => {
      cancelled = true;
    };
  }, [repo, taskId, version, validVersion]);

  if (repo === null) return <StorageUnavailable />;
  if (!validVersion) {
    return (
      <div
        data-task-invalid-version
        role="alert"
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2 px-4 py-12 text-center"
      >
        <AlertCircle size={20} className="text-text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-text">Invalid task version.</p>
        <p className="text-sm text-text-secondary">
          Version route params must be positive integers; nothing was redirected.
        </p>
        <BackToCatalog />
      </div>
    );
  }
  if (state.kind === "not-found" || versionState.kind === "not-found") {
    return (
      <NotFound
        label={`Task version “${taskId}@${version}” was not found.`}
        taskId={`${taskId}@${version}`}
      />
    );
  }
  if (state.kind === "error") {
    return <LoadFailure error={state.error} onRetry={retry} />;
  }
  if (versionState.kind === "loading" || versionState.kind === "idle") {
    return (
      <div
        data-task-loading
        className="mx-auto flex w-full max-w-3xl items-center justify-center px-4 py-12 text-sm text-text-muted"
      >
        Loading task version…
      </div>
    );
  }

  const v = versionState.version;
  const latestVersion = state.kind === "ready" ? state.record.latestVersion : v.version;
  return (
    <div
      data-task-version={`${taskId}@${version}`}
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold text-text">{v.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <span className="font-mono text-xs">{v.taskId}</span>
            <span>Version {v.version} (read-only)</span>
          </p>
        </div>
        <BackToCatalog />
      </header>
      <TaskVersionView version={v} latestVersion={latestVersion} />
    </div>
  );
}
