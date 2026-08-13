// =============================================================================
// RSemble AI — Task family registry (canonical-tasks spec §3.5)
//
// Child 02 (Canonical Tasks) Task 8B.
//
// Complete family management surface over the real repository contract:
//   - create/edit families with honest dirty/saved state and revision CAS;
//   - archive/restore through explicit DialogSurface confirmation (cancel
//     writes nothing; Escape restores focus to the trigger);
//   - stale revisions surface an honest conflict banner with Reload recovery;
//   - parent selection prevents self-parent and surfaces the repository's
//     invalid-parent/cycle rejections instead of dropping them;
//   - typed cross-family relations (overlap/parent/derivative) with the
//     target select excluding the chosen source (no self-relation).
//
// Relations stay explicit and typed: no hierarchy is inferred and there is no
// universal family tree (spec §3.5, Task 8A seam).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { StorageError } from "../../lib/persistence/database";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type {
  TaskFamily,
  TaskFamilyRelation,
  TaskFamilyRelationKind,
} from "../../lib/tasks/task-types";
import { DialogSurface } from "../../ui/DialogSurface";

const FIELD_LABEL = "flex flex-col gap-1 text-sm font-medium text-text";
const FIELD_INPUT =
  "min-h-[44px] w-full rounded-md border border-edge bg-card px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70";
const FIELD_AREA =
  "min-h-[88px] w-full rounded-md border border-edge bg-card px-3 py-2 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70";
const FIELD_SELECT =
  "min-h-[44px] rounded-md border border-edge bg-card px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const ACTION_BUTTON =
  "min-h-[44px] rounded-md border border-edge bg-card px-4 text-sm text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PRIMARY_BUTTON =
  "min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CONFIRM_BUTTON =
  "min-h-[44px] rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors hover:bg-accent/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const RELATION_KIND_LABELS: Record<TaskFamilyRelationKind, string> = {
  overlap: "Overlap",
  parent: "Parent of",
  derivative: "Derivative of",
};

/** Generate an opaque ID matching the persistence ID pattern. */
function newId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

interface FamilyFormState {
  mode: "create" | "edit";
  familyId: string | null;
  name: string;
  description: string;
  parentFamilyId: string;
  baselineRevision: number;
}

type LifecycleDialog =
  | { kind: "archive"; family: TaskFamily }
  | { kind: "restore"; family: TaskFamily }
  | null;

export function TaskFamilyRegistry({ repo }: { repo: TaskRepository }) {
  const [families, setFamilies] = useState<TaskFamily[] | null>(null);
  const [relations, setRelations] = useState<TaskFamilyRelation[]>([]);
  const [form, setForm] = useState<FamilyFormState | null>(null);
  const [lifecycleDialog, setLifecycleDialog] = useState<LifecycleDialog>(null);
  const [conflict, setConflict] = useState<StorageError | null>(null);
  const [actionError, setActionError] = useState<StorageError | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Relation form state.
  const [relationFrom, setRelationFrom] = useState("");
  const [relationTo, setRelationTo] = useState("");
  const [relationKind, setRelationKind] = useState<TaskFamilyRelationKind>("overlap");

  const dialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogWasOpenRef = useRef(false);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      repo.listTaskFamilies(true).catch(() => [] as TaskFamily[]),
      // Relations are an optional seam on the plain TaskRepository interface
      // type; the concrete repository always implements it.
      ("listTaskFamilyRelations" in repo
        ? (repo as { listTaskFamilyRelations(): Promise<TaskFamilyRelation[]> }).listTaskFamilyRelations()
        : Promise.resolve([] as TaskFamilyRelation[])),
    ]).then(([familyRows, relationRows]) => {
      if (cancelled) return;
      setFamilies(familyRows);
      setRelations(relationRows);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, reloadTick]);

  // Dialogs here open imperatively (not via Dialog.Trigger), so Base UI
  // cannot restore focus on close. Return it to the trigger ourselves
  // (keyboard-only flow; mirrors the ExperimentResults pattern).
  useEffect(() => {
    if (dialogWasOpenRef.current && lifecycleDialog === null) {
      dialogTriggerRef.current?.focus();
    }
    dialogWasOpenRef.current = lifecycleDialog !== null;
  }, [lifecycleDialog]);

  const sortedFamilies = useMemo(() => {
    if (families === null) return [];
    return [...families].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }, [families]);

  const familyName = useCallback(
    (id: string): string => families?.find((f) => f.id === id)?.name ?? id,
    [families],
  );

  function openCreate(): void {
    setActionError(null);
    setConflict(null);
    setForm({
      mode: "create",
      familyId: null,
      name: "",
      description: "",
      parentFamilyId: "",
      baselineRevision: 0,
    });
  }

  function openEdit(family: TaskFamily): void {
    setActionError(null);
    setConflict(null);
    setForm({
      mode: "edit",
      familyId: family.id,
      name: family.name,
      description: family.description,
      parentFamilyId: family.parentFamilyId ?? "",
      baselineRevision: family.revision,
    });
  }

  const dirty = useMemo(() => {
    if (form === null) return false;
    if (form.mode === "create") return true;
    const baseline = families?.find((f) => f.id === form.familyId) ?? null;
    if (baseline === null) return true;
    return (
      form.name !== baseline.name ||
      form.description !== baseline.description ||
      (form.parentFamilyId || null) !== baseline.parentFamilyId
    );
  }, [form, families]);

  function handleWriteFailure(err: unknown): void {
    if (err instanceof StorageError && err.kind === "conflict" && /stale revision/i.test(err.message)) {
      setConflict(err);
    } else {
      setActionError(
        err instanceof StorageError ? err : new StorageError("unavailable", String(err)),
      );
    }
  }

  async function handleSave(): Promise<void> {
    if (form === null || busy) return;
    setBusy(true);
    setActionError(null);
    setConflict(null);
    const now = Date.now();
    try {
      if (form.mode === "create") {
        const family: TaskFamily = {
          id: newId("fam"),
          name: form.name.trim(),
          description: form.description.trim(),
          parentFamilyId: form.parentFamilyId === "" ? null : form.parentFamilyId,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          revision: 0,
        };
        await repo.createTaskFamily(family);
        // Honest saved state: the form re-baselines on the family that was
        // just committed, so the status flips to Saved without closing.
        setForm({
          mode: "edit",
          familyId: family.id,
          name: family.name,
          description: family.description,
          parentFamilyId: family.parentFamilyId ?? "",
          baselineRevision: family.revision,
        });
      } else {
        const baseline = await repo.getTaskFamily(form.familyId!);
        if (baseline === null) {
          throw new StorageError("conflict", `Task family ${form.familyId} not found`);
        }
        const updated: TaskFamily = {
          ...baseline,
          name: form.name.trim(),
          description: form.description.trim(),
          parentFamilyId: form.parentFamilyId === "" ? null : form.parentFamilyId,
          updatedAt: now,
        };
        const newRevision = await repo.updateTaskFamily(updated, form.baselineRevision);
        // Re-baseline on the committed revision so the next CAS uses the
        // latest stored state.
        setForm({
          ...form,
          name: updated.name,
          description: updated.description,
          parentFamilyId: updated.parentFamilyId ?? "",
          baselineRevision: newRevision,
        });
      }
      reload();
    } catch (err) {
      handleWriteFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmLifecycle(): Promise<void> {
    if (lifecycleDialog === null || busy) return;
    const { kind, family } = lifecycleDialog;
    setBusy(true);
    setActionError(null);
    setConflict(null);
    try {
      if (kind === "archive") {
        await repo.archiveTaskFamily(family.id, family.revision);
      } else {
        await repo.restoreTaskFamily(family.id, family.revision);
      }
      setLifecycleDialog(null);
      reload();
    } catch (err) {
      setLifecycleDialog(null);
      handleWriteFailure(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRelation(): Promise<void> {
    if (relationFrom === "" || relationTo === "" || busy) return;
    setBusy(true);
    setActionError(null);
    setConflict(null);
    try {
      if (!("createTaskFamilyRelation" in repo)) {
        throw new StorageError("unavailable", "Relation repository is not available");
      }
      const relation: TaskFamilyRelation = {
        id: newId("rel"),
        fromFamilyId: relationFrom,
        toFamilyId: relationTo,
        kind: relationKind,
        createdAt: Date.now(),
      };
      await (repo as { createTaskFamilyRelation(r: TaskFamilyRelation): Promise<void> })
        .createTaskFamilyRelation(relation);
      setRelationFrom("");
      setRelationTo("");
      reload();
    } catch (err) {
      handleWriteFailure(err);
    } finally {
      setBusy(false);
    }
  }

  // Parent options: every family except the one being edited (self-parent is
  // unreachable in the UI; the repository still enforces cycle/invalid-parent
  // rules for any other path).
  const parentOptions = sortedFamilies.filter(
    (f) => form === null || form.mode === "create" || f.id !== form.familyId,
  );
  const relationToOptions = sortedFamilies.filter((f) => f.id !== relationFrom);

  return (
    <div data-family-registry className="flex flex-col gap-4">
      {conflict ? (
        <div
          data-family-conflict
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/[0.06] p-4"
        >
          <p className="text-sm font-medium text-text">
            This family changed in another tab or window.
          </p>
          <p className="text-sm text-text-secondary">
            Your working copy references an older revision, so the write was rejected instead of
            overwriting newer state. Reload to pick up the latest saved family.
          </p>
          <div>
            <button
              type="button"
              data-action="reload-families"
              onClick={() => {
                setConflict(null);
                setForm(null);
                reload();
              }}
              className={ACTION_BUTTON}
            >
              Reload latest
            </button>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <div
          data-family-error
          role="alert"
          className="flex items-center gap-2 text-sm text-error"
        >
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Family action failed ({actionError.kind}): {actionError.message}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Families group deliberate Task variants. Relations express typed overlap — never an
          inferred tree.
        </p>
        <button type="button" data-action="new-family" onClick={openCreate} className={PRIMARY_BUTTON}>
          New family
        </button>
      </div>

      {form !== null ? (
        <div
          data-family-form={form.mode}
          className="flex flex-col gap-3 rounded-md border border-edge bg-card p-4"
        >
          <div className="flex items-center gap-2">
            <span
              data-family-status
              className={
                dirty
                  ? "rounded-sm border border-warning/40 bg-warning/[0.08] px-2 py-1 text-xs text-text"
                  : "rounded-sm border border-edge bg-raised px-2 py-1 text-xs text-text-secondary"
              }
            >
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>
          <label className={FIELD_LABEL}>
            <span>Name</span>
            <input
              type="text"
              data-field="name"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.currentTarget.value })}
              className={FIELD_INPUT}
            />
          </label>
          <label className={FIELD_LABEL}>
            <span>Description</span>
            <textarea
              data-field="description"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.currentTarget.value })}
              className={FIELD_AREA}
            />
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span className="font-medium text-text">Parent family</span>
            <select
              data-field="parent"
              aria-label="Parent family"
              value={form.parentFamilyId}
              onChange={(event) => setForm({ ...form, parentFamilyId: event.currentTarget.value })}
              className={FIELD_SELECT}
            >
              <option value="">No parent</option>
              {parentOptions.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action="save-family"
              disabled={busy || form.name.trim() === ""}
              onClick={() => void handleSave()}
              className={PRIMARY_BUTTON}
            >
              {busy ? "Saving…" : form.mode === "create" ? "Create family" : "Save family"}
            </button>
            <button
              type="button"
              data-action="cancel-family"
              disabled={busy}
              onClick={() => setForm(null)}
              className={ACTION_BUTTON}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {families === null ? (
        <p className="text-sm text-text-muted">Loading families…</p>
      ) : sortedFamilies.length === 0 ? (
        <p className="text-sm text-text-secondary">No families yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sortedFamilies.map((family) => (
            <li
              key={family.id}
              data-family-row={family.id}
              className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-edge bg-card px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0 break-words text-sm font-medium text-text">
                  {family.name}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-secondary">
                  {family.description !== "" ? (
                    <span className="min-w-0 break-words">{family.description}</span>
                  ) : null}
                  {family.parentFamilyId !== null ? (
                    <span>parent: {familyName(family.parentFamilyId)}</span>
                  ) : null}
                </span>
              </div>
              {family.archivedAt !== null ? (
                <span
                  data-family-archived={family.id}
                  className="shrink-0 rounded-sm border border-edge bg-raised px-2 py-0.5 text-xs text-text-secondary"
                >
                  Archived
                </span>
              ) : null}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  data-action="edit-family"
                  onClick={() => openEdit(family)}
                  className={ACTION_BUTTON}
                >
                  Edit
                </button>
                {family.archivedAt === null ? (
                  <button
                    type="button"
                    data-action="archive-family"
                    onClick={() => {
                      dialogTriggerRef.current = document.activeElement as HTMLButtonElement | null;
                      setActionError(null);
                      setLifecycleDialog({ kind: "archive", family });
                    }}
                    className={ACTION_BUTTON}
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    type="button"
                    data-action="restore-family"
                    onClick={() => {
                      dialogTriggerRef.current = document.activeElement as HTMLButtonElement | null;
                      setActionError(null);
                      setLifecycleDialog({ kind: "restore", family });
                    }}
                    className={CONFIRM_BUTTON}
                  >
                    Restore
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-text">Typed cross-family relations</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span>From</span>
            <select
              data-field="relation-from"
              aria-label="Relation source family"
              value={relationFrom}
              onChange={(event) => {
                setRelationFrom(event.currentTarget.value);
                setRelationTo("");
              }}
              className={FIELD_SELECT}
            >
              <option value="">Choose family…</option>
              {sortedFamilies.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span>To</span>
            <select
              data-field="relation-to"
              aria-label="Relation target family"
              value={relationTo}
              disabled={relationFrom === ""}
              onChange={(event) => setRelationTo(event.currentTarget.value)}
              className={FIELD_SELECT}
            >
              <option value="">Choose family…</option>
              {relationToOptions.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span>Kind</span>
            <select
              data-field="relation-kind"
              aria-label="Relation kind"
              value={relationKind}
              onChange={(event) =>
                setRelationKind(event.currentTarget.value as TaskFamilyRelationKind)
              }
              className={FIELD_SELECT}
            >
              <option value="overlap">Overlap</option>
              <option value="parent">Parent of</option>
              <option value="derivative">Derivative of</option>
            </select>
          </label>
          <button
            type="button"
            data-action="save-relation"
            disabled={busy || relationFrom === "" || relationTo === ""}
            onClick={() => void handleSaveRelation()}
            className={PRIMARY_BUTTON}
          >
            Add relation
          </button>
        </div>
        {relations.length === 0 ? (
          <p className="text-sm text-text-secondary">No relations yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {relations.map((relation) => (
              <li
                key={relation.id}
                data-relation-row
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-edge bg-card px-3 py-1.5 text-sm text-text"
              >
                <span className="min-w-0 break-words">{familyName(relation.fromFamilyId)}</span>
                <span className="text-xs text-text-muted">
                  {RELATION_KIND_LABELS[relation.kind]}
                </span>
                <span className="min-w-0 break-words">{familyName(relation.toFamilyId)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DialogSurface
        open={lifecycleDialog !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setLifecycleDialog(null);
        }}
        title={
          lifecycleDialog?.kind === "restore" ? "Restore family" : "Archive family"
        }
      >
        <div className="flex flex-col gap-4 p-5">
          <h2 className="text-base font-semibold text-text">
            {lifecycleDialog?.kind === "restore" ? "Restore family" : "Archive family"}
          </h2>
          <p className="text-sm text-text-secondary">
            {lifecycleDialog?.kind === "restore"
              ? `Restore "${lifecycleDialog.family.name}"? Restoring keeps all existing assignments and relations and bumps the family revision.`
              : `Archive "${lifecycleDialog?.family.name}"? Archived families keep their assignments and relations but are hidden from new assignments until restored.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action={
                lifecycleDialog?.kind === "restore"
                  ? "confirm-restore-family"
                  : "confirm-archive-family"
              }
              disabled={busy}
              onClick={() => void handleConfirmLifecycle()}
              className={CONFIRM_BUTTON}
            >
              {busy
                ? "Saving…"
                : lifecycleDialog?.kind === "restore"
                  ? "Confirm restore"
                  : "Confirm archive"}
            </button>
            <button
              type="button"
              data-action={
                lifecycleDialog?.kind === "restore"
                  ? "cancel-restore-family"
                  : "cancel-archive-family"
              }
              disabled={busy}
              onClick={() => setLifecycleDialog(null)}
              className={ACTION_BUTTON}
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogSurface>
    </div>
  );
}
