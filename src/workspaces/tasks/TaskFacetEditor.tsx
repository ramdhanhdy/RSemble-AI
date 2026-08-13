// =============================================================================
// RSemble AI — Task facet editor (canonical-tasks spec §3.6)
//
// Child 02 (Canonical Tasks) Task 8B.
//
// Facet annotations are edited separately from Task content with honest
// provenance (spec §7.2): every effective annotation row discloses its value,
// source (authored/imported/suggested), author kind, confidence, taxonomy
// version, and supersession chain. Annotations are append-only: adding a new
// value for a dimension appends an annotation that supersedes the current
// effective one — history is never mutated.
//
// Suggestions never become accepted annotations without explicit user
// confirmation: accepting a suggestion opens a confirm/cancel boundary, and
// committing appends an authored annotation that supersedes the suggestion.
// The allowlist for authored choices comes from the frozen taxonomy seam
// (`getFacetTaxonomyValues`); imported/suggested values outside the allowlist
// render raw, unabridged. No inference, no universal capability tree.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { StorageError } from "../../lib/persistence/database";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskFacetAnnotation, TaskFacetDimension } from "../../lib/tasks/task-types";
import {
  TASK_FACET_DIMENSIONS,
  getFacetTaxonomyValues,
} from "../../lib/tasks/task-validation";

const SECTION_LABEL = "text-sm font-medium text-text";
const FIELD_SELECT =
  "min-h-[44px] rounded-md border border-edge bg-card px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
const ACTION_BUTTON =
  "min-h-[44px] rounded-md border border-edge bg-card px-4 text-sm text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const PRIMARY_BUTTON =
  "min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CONFIRM_BUTTON =
  "min-h-[44px] rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors hover:bg-accent/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const CHIP =
  "rounded-sm border border-edge bg-raised px-2 py-0.5 text-xs text-text-secondary";

const DIMENSION_LABELS: Record<TaskFacetDimension, string> = {
  domain: "Domain",
  "task-form": "Task form",
  transformation: "Transformation",
  constraint: "Constraint",
  "interaction-mode": "Interaction mode",
  modality: "Modality",
  "evaluation-type": "Evaluation type",
  setting: "Setting",
};

/** Generate an opaque annotation ID matching the persistence ID pattern. */
function newAnnotationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `ann-${globalThis.crypto.randomUUID()}`;
  }
  return `ann-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Resolve a taxonomy value to its stable label; unknown/long values render
 *  raw and unabridged (provenance over prettiness). */
function facetValueLabel(facetId: string, valueId: string): string {
  const hit = getFacetTaxonomyValues(1).find(
    (v) => v.facetId === facetId && v.valueId === valueId,
  );
  return hit?.label ?? valueId;
}

export function TaskFacetEditor({
  repo,
  taskId,
  disabled = false,
}: {
  repo: TaskRepository;
  taskId: string;
  /** Read-only mode (archived Task, spec §4.5): provenance stays visible, no
   *  mutating controls render. */
  disabled?: boolean;
}) {
  const [annotations, setAnnotations] = useState<TaskFacetAnnotation[] | null>(null);
  const [dimension, setDimension] = useState<"" | TaskFacetDimension>("");
  const [valueId, setValueId] = useState("");
  const [confirmAcceptId, setConfirmAcceptId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StorageError | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    repo
      .listTaskFacetAnnotations(taskId)
      .then((rows) => {
        if (!cancelled) setAnnotations(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
          setAnnotations([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, taskId, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  // Effective annotation per dimension: an annotation superseded by another
  // annotation of this Task moves to history; the newest non-superseded one
  // is the effective value. Supersession is append-only provenance — the
  // superseded row is never mutated.
  const dimensionRows = useMemo(() => {
    if (annotations === null) return null;
    const supersededIds = new Set(
      annotations
        .map((a) => a.supersedesId)
        .filter((id): id is string => id !== null),
    );
    return TASK_FACET_DIMENSIONS.map((facetId) => {
      const list = annotations.filter((a) => a.facetId === facetId);
      if (list.length === 0) return null;
      const active = list
        .filter((a) => !supersededIds.has(a.id))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const history = list
        .filter((a) => supersededIds.has(a.id))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      return { facetId, effective: active[0] ?? null, history };
    }).filter((row): row is NonNullable<typeof row> => row !== null);
  }, [annotations]);

  const valueOptions = useMemo(
    () =>
      dimension === ""
        ? []
        : getFacetTaxonomyValues(1).filter((v) => v.facetId === dimension),
    [dimension],
  );

  async function handleAdd(): Promise<void> {
    if (dimension === "" || valueId === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Adding a value where an effective annotation exists appends a
      // superseding annotation; otherwise it starts the dimension's lineage.
      const current = dimensionRows?.find((r) => r.facetId === dimension)?.effective ?? null;
      const annotation: TaskFacetAnnotation = {
        id: newAnnotationId(),
        taskId,
        taskVersion: null,
        facetId: dimension,
        valueId,
        source: "authored",
        authorKind: "user",
        confidence: null,
        taxonomyVersion: 1,
        createdAt: Date.now(),
        supersedesId: current?.id ?? null,
      };
      await repo.annotateTaskFacet(annotation);
      setValueId("");
      reload();
    } catch (err) {
      setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmAccept(suggestion: TaskFacetAnnotation): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Acceptance appends an authored annotation superseding the suggestion;
      // the suggestion itself survives unmutated as provenance.
      const annotation: TaskFacetAnnotation = {
        id: newAnnotationId(),
        taskId,
        taskVersion: suggestion.taskVersion,
        facetId: suggestion.facetId,
        valueId: suggestion.valueId,
        source: "authored",
        authorKind: "user",
        confidence: null,
        taxonomyVersion: suggestion.taxonomyVersion,
        createdAt: Date.now(),
        supersedesId: suggestion.id,
      };
      await repo.annotateTaskFacet(annotation);
      setConfirmAcceptId(null);
      reload();
    } catch (err) {
      setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-facet-editor className="flex flex-col gap-3">
      {error ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-error">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Facet action failed ({error.kind}): {error.message}
          </span>
        </div>
      ) : null}

      {dimensionRows === null ? (
        <p className="text-sm text-text-muted">Loading facet annotations…</p>
      ) : dimensionRows.length === 0 ? (
        <p className="text-sm text-text-secondary">No facet annotations yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dimensionRows.map(({ facetId, effective, history }) =>
            effective === null ? null : (
              <li
                key={facetId}
                data-facet-row={facetId}
                className="flex min-w-0 flex-col gap-1 rounded-md border border-edge bg-card px-3 py-2"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="w-36 shrink-0 text-xs text-text-muted">
                    {DIMENSION_LABELS[facetId] ?? facetId}
                  </span>
                  <span className="min-w-0 break-words text-sm font-medium text-text">
                    {facetValueLabel(effective.facetId, effective.valueId)}
                  </span>
                  <span data-facet-source className={CHIP}>
                    {effective.source}
                  </span>
                  <span data-facet-author className={CHIP}>
                    {effective.authorKind}
                  </span>
                  {effective.confidence !== null ? (
                    <span data-facet-confidence className={CHIP}>
                      {effective.confidence}
                    </span>
                  ) : null}
                  <span data-facet-taxonomy className={CHIP}>
                    taxonomy v{effective.taxonomyVersion}
                  </span>
                  {effective.supersedesId !== null ? (
                    <span data-facet-supersedes className={CHIP}>
                      supersedes {effective.supersedesId}
                    </span>
                  ) : null}
                </div>

                {effective.source === "suggested" && !disabled ? (
                  confirmAcceptId === effective.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-text-secondary">
                        Accept this suggestion as an authored annotation? The suggestion stays in
                        history.
                      </span>
                      <button
                        type="button"
                        data-action="confirm-accept-suggestion"
                        disabled={busy}
                        onClick={() => void handleConfirmAccept(effective)}
                        className={CONFIRM_BUTTON}
                      >
                        Accept suggestion
                      </button>
                      <button
                        type="button"
                        data-action="cancel-accept-suggestion"
                        disabled={busy}
                        onClick={() => setConfirmAcceptId(null)}
                        className={ACTION_BUTTON}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        data-action="accept-suggestion"
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setConfirmAcceptId(effective.id);
                        }}
                        className={ACTION_BUTTON}
                      >
                        Accept suggestion…
                      </button>
                    </div>
                  )
                ) : null}

                {history.length > 0 ? (
                  <ul className="flex flex-col gap-1 pl-36">
                    {history.map((past) => (
                      <li
                        key={past.id}
                        data-facet-history-row
                        className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-muted"
                      >
                        <span className="min-w-0 break-words">
                          {facetValueLabel(past.facetId, past.valueId)}
                        </span>
                        <span className={CHIP}>{past.source}</span>
                        <span>superseded</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}

      {!disabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span className={SECTION_LABEL}>Dimension</span>
            <select
              data-field="facet-dimension"
              aria-label="Facet dimension"
              value={dimension}
              onChange={(event) => {
                setDimension(event.currentTarget.value as "" | TaskFacetDimension);
                setValueId("");
              }}
              className={FIELD_SELECT}
            >
              <option value="">Choose dimension…</option>
              {TASK_FACET_DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
            <span className={SECTION_LABEL}>Value</span>
            <select
              data-field="facet-value"
              aria-label="Facet value"
              value={valueId}
              disabled={dimension === ""}
              onChange={(event) => setValueId(event.currentTarget.value)}
              className={FIELD_SELECT}
            >
              <option value="">Choose value…</option>
              {valueOptions.map((v) => (
                <option key={v.valueId} value={v.valueId}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-action="add-facet"
            disabled={busy || dimension === "" || valueId === ""}
            onClick={() => void handleAdd()}
            className={PRIMARY_BUTTON}
          >
            {busy ? "Saving…" : "Add facet"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
