// =============================================================================
// RSemble AI — Task primary family assignment (canonical-tasks spec §3.5)
//
// Child 02 (Canonical Tasks) Task 8B.
//
// A Task has at most one primary family at a time through a versioned
// assignment (spec §3.5). This section manages that assignment through real
// repository operations: assigning a new primary demotes the previous one
// inside the repository's transaction, and ending the assignment archives it
// — assignment history is never deleted. Archived Tasks render the current
// primary read-only (spec §4.5).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { StorageError } from "../../lib/persistence/database";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskFamily, TaskFamilyAssignment } from "../../lib/tasks/task-types";

const FIELD_SELECT =
  "min-h-[44px] rounded-md border border-edge bg-card px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const ACTION_BUTTON =
  "min-h-[44px] rounded-md border border-edge bg-card px-4 text-sm text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PRIMARY_BUTTON =
  "min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Generate an opaque assignment ID matching the persistence ID pattern. */
function newAssignmentId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `asg-${globalThis.crypto.randomUUID()}`;
  }
  return `asg-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function TaskFamilyAssignmentSection({
  repo,
  taskId,
  taskVersion,
  disabled = false,
}: {
  repo: TaskRepository;
  taskId: string;
  /** Assignments bind to a Task Version (spec §3.5): the routed record's
   *  latest version at render time. */
  taskVersion: number;
  /** Read-only mode (archived Task, spec §4.5). */
  disabled?: boolean;
}) {
  const [families, setFamilies] = useState<TaskFamily[]>([]);
  const [assignments, setAssignments] = useState<TaskFamilyAssignment[] | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      repo.listTaskFamilies(true).catch(() => [] as TaskFamily[]),
      repo.listTaskFamilyAssignments(taskId).catch(() => [] as TaskFamilyAssignment[]),
    ]).then(([familyRows, assignmentRows]) => {
      if (cancelled) return;
      setFamilies(
        [...familyRows].sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        ),
      );
      setAssignments(assignmentRows);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, taskId, reloadTick]);

  const primary =
    assignments?.find((a) => a.isPrimary && a.archivedAt === null) ?? null;
  const familyName = useCallback(
    (id: string): string => families.find((f) => f.id === id)?.name ?? id,
    [families],
  );
  // Only active families are assignable; archived ones stay visible through
  // the existing assignment's provenance.
  const assignableFamilies = families.filter((f) => f.archivedAt === null);

  async function handleAssign(): Promise<void> {
    if (selectedFamilyId === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The repository enforces at-most-one active primary per Task: the
      // previous primary assignment is demoted inside the same write.
      await repo.assignTaskFamily({
        id: newAssignmentId(),
        taskId,
        taskVersion,
        familyId: selectedFamilyId,
        isPrimary: true,
        createdAt: Date.now(),
        revision: 0,
        archivedAt: null,
      });
      setSelectedFamilyId("");
      reload();
    } catch (err) {
      setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd(): Promise<void> {
    if (primary === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Ending an assignment archives it — the history row survives with its
      // provenance intact (spec §4.5 archive semantics).
      await repo.archiveTaskFamilyAssignment(primary.id, primary.revision);
      reload();
    } catch (err) {
      setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-task-family-assignment className="flex flex-col gap-2">
      {error ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-error">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Family assignment failed ({error.kind}): {error.message}
          </span>
        </div>
      ) : null}

      {assignments === null ? (
        <p className="text-sm text-text-muted">Loading family assignments…</p>
      ) : primary !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-secondary">Primary family</span>
          <span data-primary-family className="font-medium text-text">
            {familyName(primary.familyId)}
          </span>
          {!disabled ? (
            <button
              type="button"
              data-action="end-primary-assignment"
              disabled={busy}
              onClick={() => void handleEnd()}
              className={ACTION_BUTTON}
            >
              End assignment
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-text-secondary">No primary family assigned.</p>
      )}

      {!disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span>Family</span>
            <select
              data-field="primary-family"
              aria-label="Primary family"
              value={selectedFamilyId}
              onChange={(event) => setSelectedFamilyId(event.currentTarget.value)}
              className={FIELD_SELECT}
            >
              <option value="">Choose family…</option>
              {assignableFamilies.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-action="assign-primary-family"
            disabled={busy || selectedFamilyId === ""}
            onClick={() => void handleAssign()}
            className={PRIMARY_BUTTON}
          >
            {busy ? "Assigning…" : "Assign primary family"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
