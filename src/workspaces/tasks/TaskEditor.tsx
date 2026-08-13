// =============================================================================
// RSemble AI — Task create/edit/version editors (canonical-tasks spec §7.2-7.3)
//
// Child 02 (Canonical Tasks) Milestone D, Task 7.
//
// Vertical flows over the real TaskRepository contract:
//   - Create commits the Task record and immutable version 1 atomically
//     (repo.createTask); duplicate builds a brand-new authored identity with
//     its own version 1 — never an implied version of the source (§7.3).
//   - Latest-version editing keeps an in-memory draft with a distinct
//     dirty/saved boundary; committing goes through an explicit two-step
//     "Create version N+1" confirmation and appends via revision CAS. Stale
//     revisions surface an honest conflict banner with a Reload recovery
//     instead of a silent retry (§4.3, §4.5).
//   - Historical versions render read-only with a version selector; committed
//     versions are immutable (§3.2). Archived Tasks hide the editing surface
//     but stay routable and restorable (§4.5). No delete control exists for
//     referenced Tasks (§4.4) — none is rendered anywhere.
//
// All controls are functional: native labels, keyboard-operable buttons and
// selects, and confirmation steps that move focus into the confirmation so a
// keyboard user is never left on a control that disappeared.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, Archive, Copy, RotateCcw } from "lucide-react";
import { StorageError } from "../../lib/persistence/database";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import {
  buildInitialTaskRecord,
  buildNextVersion,
  duplicateTaskRecord,
} from "../../lib/tasks/task-versioning";

// --- shared field styling ---------------------------------------------------

const FIELD_LABEL = "flex flex-col gap-1 text-sm font-medium text-text";
const FIELD_INPUT =
  "min-h-[44px] w-full rounded-md border border-edge bg-card px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70";
const FIELD_AREA =
  "min-h-[88px] w-full rounded-md border border-edge bg-card px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70";
const ACTION_BUTTON =
  "min-h-[44px] rounded-md border border-edge bg-card px-4 text-sm text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PRIMARY_BUTTON =
  "min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CONFIRM_BUTTON =
  "min-h-[44px] rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors hover:bg-accent/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

interface DraftFields {
  title: string;
  objective: string;
  instruction: string;
}

function draftFrom(version: TaskVersion): DraftFields {
  return {
    title: version.title,
    objective: version.objective,
    instruction: version.candidateInstruction,
  };
}

/** Generate an opaque Task ID, falling back when crypto.randomUUID is absent. */
function newTaskId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "task-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

/** Group that moves focus to its first button when it appears — keeps
 *  keyboard users inside the confirmation boundary instead of stranding them
 *  on the control the confirmation replaced. */
function ConfirmFocus({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  return (
    <div ref={ref} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  );
}

// --- version selector (spec §7.2) -------------------------------------------

export function TaskVersionSelect({
  taskId,
  current,
  latestVersion,
}: {
  taskId: string;
  current: number;
  latestVersion: number;
}) {
  const navigate = useNavigate();
  const options: number[] = [];
  for (let n = 1; n <= latestVersion; n++) options.push(n);
  return (
    <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
      <span>Version</span>
      <select
        data-action="version-select"
        aria-label="Select task version"
        value={current}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (next === latestVersion) {
            void navigate(`/tasks/${taskId}`);
          } else {
            void navigate(`/tasks/${taskId}/versions/${next}`);
          }
        }}
        className="min-h-[44px] rounded-md border border-edge bg-card px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            v{n}
            {n === latestVersion ? " (latest)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// --- /tasks/new — atomic create (spec §7.3) ---------------------------------

export function TaskNewEditor({ repo }: { repo: TaskRepository }) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string } | null>(null);

  const canCreate = !busy && title.trim() !== "" && objective.trim() !== "";

  async function handleCreate(): Promise<void> {
    setBusy(true);
    setError(null);
    const now = Date.now();
    const id = newTaskId();
    const record = buildInitialTaskRecord({ id, createdAt: now, origin: "authored" });
    const version: TaskVersion = {
      taskId: id,
      version: 1,
      title: title.trim(),
      objective: objective.trim(),
      candidateInstruction: instruction,
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: null,
      source: { kind: "authored", legacyScopeKey: null, note: null },
      createdAt: now,
    };
    try {
      // Atomic Task + version 1 commit: the repository writes both rows in a
      // single transaction or rejects without partial state (§7.3).
      await repo.createTask(record, version);
      setCreated({ id, title: version.title });
    } catch (err) {
      setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-12">
        <h1 className="text-lg font-semibold text-text">Task created</h1>
        <p className="text-sm text-text-secondary">
          The Task record and version 1 were committed atomically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/tasks/${created.id}`}
            data-action="open-created-task"
            className="flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open {created.title}
          </Link>
          <Link
            to="/tasks"
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-card px-3 text-sm text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Back to tasks
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div data-task-editor="new" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-text">Create task</h1>
        <p className="text-sm text-text-secondary">
          Creating a task commits the Task record and immutable version 1 atomically.
        </p>
      </header>

      <label className={FIELD_LABEL}>
        <span>Title</span>
        <input
          type="text"
          data-editor-field="title"
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          className={FIELD_INPUT}
        />
      </label>
      <label className={FIELD_LABEL}>
        <span>Objective</span>
        <textarea
          data-editor-field="objective"
          value={objective}
          onChange={(event) => setObjective(event.currentTarget.value)}
          className={FIELD_AREA}
        />
      </label>
      <label className={FIELD_LABEL}>
        <span>Candidate instruction</span>
        <textarea
          data-editor-field="instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.currentTarget.value)}
          className={FIELD_AREA}
        />
      </label>

      {error ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-error">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Failed to create the task ({error.kind}): {error.message}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-action="create-task"
          disabled={!canCreate}
          onClick={() => void handleCreate()}
          className={PRIMARY_BUTTON}
        >
          {busy ? "Creating…" : "Create task"}
        </button>
        <Link
          to="/tasks"
          className="flex min-h-[44px] items-center rounded-md border border-edge bg-card px-3 text-sm text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}

// --- /tasks/:taskId — draft latest + lifecycle (spec §7.2) ------------------

type DetailConfirm = "version" | "archive" | null;

export function TaskDetailEditor({
  repo,
  initialRecord,
  initialVersion,
  onRefresh,
}: {
  repo: TaskRepository;
  initialRecord: TaskRecord;
  initialVersion: TaskVersion;
  onRefresh: () => void;
}) {
  const [record, setRecord] = useState<TaskRecord>(initialRecord);
  const [latest, setLatest] = useState<TaskVersion>(initialVersion);
  const [draft, setDraft] = useState<DraftFields>(() => draftFrom(initialVersion));
  const [confirm, setConfirm] = useState<DetailConfirm>(null);
  const [conflict, setConflict] = useState<StorageError | null>(null);
  const [actionError, setActionError] = useState<StorageError | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-baseline whenever the routed record/version changes (route reload).
  useEffect(() => {
    setRecord(initialRecord);
    setLatest(initialVersion);
    setDraft(draftFrom(initialVersion));
    setConflict(null);
    setConfirm(null);
  }, [initialRecord, initialVersion]);

  const archived = record.archivedAt !== null;
  const dirty =
    draft.title !== latest.title ||
    draft.objective !== latest.objective ||
    draft.instruction !== latest.candidateInstruction;
  const nextVersion = record.latestVersion + 1;
  const canCommitVersion = dirty && draft.title.trim() !== "" && draft.objective.trim() !== "";

  /** Classify a failed write: CAS conflicts surface the honest conflict
   *  banner; anything else is a classified action error. */
  function handleWriteFailure(err: unknown): void {
    setConfirm(null);
    if (err instanceof StorageError && err.kind === "conflict") {
      setConflict(err);
    } else {
      setActionError(
        err instanceof StorageError ? err : new StorageError("unavailable", String(err)),
      );
    }
  }

  /** Successful lifecycle writes delegate to the route's reload so the
   *  header badge, version selector, and draft baseline all re-read stored
   *  state instead of trusting optimistic local copies. */
  async function handleConfirmVersion(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      const next = buildNextVersion({
        latestVersion: record.latestVersion,
        taskId: record.id,
        draft: {
          ...latest,
          title: draft.title.trim(),
          objective: draft.objective.trim(),
          candidateInstruction: draft.instruction,
        },
        createdAt: Date.now(),
        source: { kind: "authored", legacyScopeKey: null, note: null },
      });
      await repo.appendTaskVersion(record, next, record.revision);
      onRefresh();
      setConfirm(null);
    } catch (err) {
      handleWriteFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmArchive(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await repo.archiveTask(record.id, record.revision);
      onRefresh();
      setConfirm(null);
    } catch (err) {
      handleWriteFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await repo.restoreTask(record.id, record.revision);
      onRefresh();
    } catch (err) {
      handleWriteFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      const now = Date.now();
      const newId = newTaskId();
      const copyRecord = duplicateTaskRecord({ source: record, newId, createdAt: now });
      // Deep-copy the latest content into the new identity's version 1. The
      // copy is authored, starts at version 1, and never references the
      // source's lineage as a version (spec §7.3).
      const copyVersion: TaskVersion = {
        ...latest,
        taskId: newId,
        version: 1,
        createdAt: now,
        defaultContextManifest: latest.defaultContextManifest.map((entry) => ({ ...entry })),
        responseContract: latest.responseContract
          ? { ...latest.responseContract, constraints: [...latest.responseContract.constraints] }
          : null,
        taskVerifierRef: latest.taskVerifierRef ? { ...latest.taskVerifierRef } : null,
        source: {
          kind: "authored",
          legacyScopeKey: null,
          note: `Duplicated from ${record.id}`,
        },
      };
      await repo.createTask(copyRecord, copyVersion);
      setDuplicate({ id: newId, title: latest.title });
    } catch (err) {
      setActionError(
        err instanceof StorageError ? err : new StorageError("unavailable", String(err)),
      );
    } finally {
      setBusy(false);
    }
  }

  function handleReload(): void {
    setConflict(null);
    setActionError(null);
    setConfirm(null);
    onRefresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {conflict ? (
        <div
          data-task-conflict
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/[0.06] p-4"
        >
          <p className="text-sm font-medium text-text">
            This task changed in another tab or window.
          </p>
          <p className="text-sm text-text-secondary">
            Your working copy references an older revision, so the write was rejected instead of
            overwriting newer state. Reload to pick up the latest saved version, then re-apply your
            edits.
          </p>
          <div>
            <button
              type="button"
              data-action="reload-task"
              onClick={handleReload}
              className={ACTION_BUTTON}
            >
              <span className="inline-flex items-center gap-2">
                <RotateCcw size={16} aria-hidden="true" />
                Reload latest
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-error">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Action failed ({actionError.kind}): {actionError.message}
          </span>
        </div>
      ) : null}

      {duplicate ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-edge bg-card p-3 text-sm text-text-secondary">
          <Copy size={16} aria-hidden="true" />
          <span>Duplicated as a new authored task.</span>
          <Link
            to={`/tasks/${duplicate.id}`}
            data-action="open-duplicate"
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-raised px-3 text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open duplicate {duplicate.title}
          </Link>
        </div>
      ) : null}

      {archived ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            This task is archived: its versions remain routable and referenceable, but the editing
            surface is hidden until it is restored.
          </p>
          <div className="flex flex-col gap-2 text-sm text-text">
            <p className="font-medium">{latest.title}</p>
            <p className="text-text-secondary">{latest.objective}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action="restore-task"
              disabled={busy}
              onClick={() => void handleRestore()}
              className={CONFIRM_BUTTON}
            >
              Restore task
            </button>
            <button
              type="button"
              data-action="duplicate-task"
              disabled={busy}
              onClick={() => void handleDuplicate()}
              className={ACTION_BUTTON}
            >
              <span className="inline-flex items-center gap-2">
                <Copy size={16} aria-hidden="true" />
                Duplicate as new task
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              data-editor-status
              className={
                dirty
                  ? "rounded-sm border border-warning/40 bg-warning/[0.08] px-2 py-1 text-xs text-text"
                  : "rounded-sm border border-edge bg-raised px-2 py-1 text-xs text-text-secondary"
              }
            >
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
            <TaskVersionSelect
              taskId={record.id}
              current={record.latestVersion}
              latestVersion={record.latestVersion}
            />
          </div>

          <label className={FIELD_LABEL}>
            <span>Title</span>
            <input
              type="text"
              data-editor-field="title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
              className={FIELD_INPUT}
            />
          </label>
          <label className={FIELD_LABEL}>
            <span>Objective</span>
            <textarea
              data-editor-field="objective"
              value={draft.objective}
              onChange={(event) => setDraft({ ...draft, objective: event.currentTarget.value })}
              className={FIELD_AREA}
            />
          </label>
          <label className={FIELD_LABEL}>
            <span>Candidate instruction</span>
            <textarea
              data-editor-field="instruction"
              value={draft.instruction}
              onChange={(event) => setDraft({ ...draft, instruction: event.currentTarget.value })}
              className={FIELD_AREA}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {confirm === "version" ? (
              <ConfirmFocus>
                <span className="text-sm text-text-secondary">
                  Editing a committed Task creates a new immutable version.
                </span>
                <button
                  type="button"
                  data-action="confirm-version"
                  disabled={busy}
                  onClick={() => void handleConfirmVersion()}
                  className={CONFIRM_BUTTON}
                >
                  {busy ? "Creating…" : `Create version ${nextVersion}`}
                </button>
                <button
                  type="button"
                  data-action="cancel-version"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                  className={ACTION_BUTTON}
                >
                  Keep editing
                </button>
              </ConfirmFocus>
            ) : (
              <button
                type="button"
                data-action="create-version"
                disabled={!canCommitVersion}
                onClick={() => {
                  setActionError(null);
                  setConfirm("version");
                }}
                className={PRIMARY_BUTTON}
              >
                Create version {nextVersion}
              </button>
            )}

            {confirm === "archive" ? (
              <ConfirmFocus>
                <span className="text-sm text-text-secondary">
                  Archived tasks stay routable and referenceable.
                </span>
                <button
                  type="button"
                  data-action="confirm-archive"
                  disabled={busy}
                  onClick={() => void handleConfirmArchive()}
                  className={CONFIRM_BUTTON}
                >
                  <span className="inline-flex items-center gap-2">
                    <Archive size={16} aria-hidden="true" />
                    Confirm archive
                  </span>
                </button>
                <button
                  type="button"
                  data-action="cancel-archive"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                  className={ACTION_BUTTON}
                >
                  Cancel
                </button>
              </ConfirmFocus>
            ) : (
              <button
                type="button"
                data-action="archive-task"
                disabled={busy}
                onClick={() => {
                  setActionError(null);
                  setConfirm("archive");
                }}
                className={ACTION_BUTTON}
              >
                <span className="inline-flex items-center gap-2">
                  <Archive size={16} aria-hidden="true" />
                  Archive task
                </span>
              </button>
            )}

            <button
              type="button"
              data-action="duplicate-task"
              disabled={busy}
              onClick={() => void handleDuplicate()}
              className={ACTION_BUTTON}
            >
              <span className="inline-flex items-center gap-2">
                <Copy size={16} aria-hidden="true" />
                Duplicate as new task
              </span>
            </button>
          </div>
        </div>
      )}
      {/* No delete control: referenced Tasks are never deletable (spec §4.4). */}
    </div>
  );
}

// --- /tasks/:taskId/versions/:version — immutable read-only view (§3.2) -----

export function TaskVersionView({
  version,
  latestVersion,
}: {
  version: TaskVersion;
  latestVersion: number;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <TaskVersionSelect
          taskId={version.taskId}
          current={version.version}
          latestVersion={latestVersion}
        />
        <span className="rounded-sm border border-edge bg-raised px-2 py-1 text-xs text-text-secondary">
          Version {version.version} — read-only
        </span>
      </div>

      <label className={FIELD_LABEL}>
        <span>Title</span>
        <input
          type="text"
          data-editor-field="title"
          value={version.title}
          disabled
          readOnly
          className={FIELD_INPUT}
        />
      </label>
      <label className={FIELD_LABEL}>
        <span>Objective</span>
        <textarea
          data-editor-field="objective"
          value={version.objective}
          disabled
          readOnly
          className={FIELD_AREA}
        />
      </label>
      <label className={FIELD_LABEL}>
        <span>Candidate instruction</span>
        <textarea
          data-editor-field="instruction"
          value={version.candidateInstruction}
          disabled
          readOnly
          className={FIELD_AREA}
        />
      </label>

      <p className="text-xs text-text-muted">
        Committed versions are immutable; this view is always read-only. Edit the latest version
        from the task detail page to create version {latestVersion + 1}.
      </p>
    </div>
  );
}
