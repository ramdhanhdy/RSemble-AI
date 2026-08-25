// =============================================================================
// RSemble AI — Data archive actions (plan 8.1, spec §13/§14/§18/§20;
// Child 02 Task 10C, Child 06 Task 11)
//
// Export/import controls for the whole workbench. Export downloads the
// allowlisted archive JSON (canonical v3 format). Import is preview-first:
// selecting a file validates bytes BEFORE decoding, validates the complete payload,
// and renders a deterministic preview (format, per-collection create/reuse/
// collision counts, conflicting IDs).
//
// Legacy archives (v1/v2/Fusion) are rejected before preview with an invalid
// archive error and zero writes.
// =============================================================================

import { useContext, useRef, useState, type ReactElement } from "react";
import { Download, Upload, XCircle } from "lucide-react";
import { RepositoryContext } from "../lib/persistence/repository-context";
import { StorageError } from "../lib/persistence/database";
import {
  archiveFailureGuidance,
  ArchiveExportCancelledError,
  ArchiveImportCancelledError,
  importWorkbenchArchiveV3Phased,
  exportWorkbenchArchiveV3,
  previewWorkbenchArchive,
  validateArchiveBytes,
  type ArchiveExportV3Progress,
  type ArchiveImportPreview,
} from "../lib/persistence/archive";
import { isWorkbenchArchiveV3, type WorkbenchArchiveV3 } from "../lib/persistence/archive-v3-types";

const INVALID_ARCHIVE_MESSAGE = "The archive is invalid — nothing was imported.";
const MAX_LISTED_ERRORS = 5;

function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Human-readable v3 archive serialization. Pretty-printing is intentionally a
 * presentation-only change: import still parses the exact same JSON data model. */
export function serializeWorkbenchArchiveV3(archive: unknown): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

export function DataArchiveActions(): ReactElement | null {
  const { db, storageState } = useContext(RepositoryContext);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportV3Busy, setExportV3Busy] = useState(false);
  const [exportV3Progress, setExportV3Progress] = useState<ArchiveExportV3Progress | null>(null);
  const [exportV3Total, setExportV3Total] = useState<number | null>(null);
  const exportV3AbortRef = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<ArchiveImportPreview | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const storageBlocked =
    storageState === "blocked" ||
    storageState === "versionchange" ||
    storageState === "unavailable";
  const controlsDisabled = busy || db === null || storageBlocked;
  const exportV3Disabled = controlsDisabled || exportV3Busy;

  const resetFeedback = () => {
    setResult(null);
    setErrors([]);
    setFailure(null);
  };

  /** Return focus to the Import data trigger after the flow closes. */
  function restoreImportFocus() {
    importTriggerRef.current?.focus();
  }

  /** Deliver the serialized archive as a download. */
  function deliverArchive(filename: string, text: string) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onExportV3() {
    if (db === null || exportV3AbortRef.current !== null) return;
    const controller = new AbortController();
    exportV3AbortRef.current = controller;
    setExportV3Busy(true);
    setExportV3Progress(null);
    resetFeedback();
    try {
      const archive = await exportWorkbenchArchiveV3(db, {
        signal: controller.signal,
        onProgress: (p) => setExportV3Progress(p),
      });
      deliverArchive(
        `rsemble-archive-${archiveTimestamp()}.json`,
        serializeWorkbenchArchiveV3(archive),
      );
      const total = Object.values(archive.manifest.counts).reduce((sum, n) => sum + n, 0);
      setExportV3Total(total);
    } catch (err) {
      if (err instanceof ArchiveExportCancelledError) {
        setFailure(archiveFailureGuidance(err));
      } else if (err instanceof StorageError && err.kind === "validation") {
        setErrors([err.message]);
      } else {
        setFailure(archiveFailureGuidance(err));
      }
    } finally {
      exportV3AbortRef.current = null;
      setExportV3Busy(false);
      setExportV3Progress(null);
    }
  }

  function onExportV3Cancel() {
    exportV3AbortRef.current?.abort();
  }

  /** Read, validate, and PREVIEW the selected archive — no writes happen here. */
  async function onFileChosen(file: File) {
    if (db === null) return;
    setBusy(true);
    resetFeedback();
    setPreview(null);
    try {
      // Validate bytes BEFORE reading/decoding the file.
      const sizeError = validateArchiveBytes(file.size);
      if (sizeError !== null) {
        setErrors([sizeError]);
        return;
      }
      const buffer = await file.arrayBuffer();
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(buffer));
      } catch {
        setErrors([INVALID_ARCHIVE_MESSAGE]);
        return;
      }
      if (!isWorkbenchArchiveV3(parsed)) {
        setErrors([INVALID_ARCHIVE_MESSAGE]);
        return;
      }
      try {
        setPreview(await previewWorkbenchArchive(db, parsed, { sourceLabel: file.name }));
      } catch (err) {
        if (err instanceof StorageError && (err.kind === "validation" || err.kind === "conflict")) {
          // Surface the classified message only — archive CONTENT never
          // crosses into the UI (validators emit path/ID labels, not values).
          setErrors([err.message]);
        } else {
          setFailure(archiveFailureGuidance(err));
        }
      }
    } finally {
      setBusy(false);
    }
  }

  /** Confirm the current preview. */
  async function onConfirmImport() {
    if (db === null || preview === null) return;
    const confirmed = preview;
    setBusy(true);
    resetFeedback();
    try {
      const commit = await importWorkbenchArchiveV3Phased(
        db,
        confirmed.payload as WorkbenchArchiveV3,
      );
      const remappedNote =
        commit.remapped.length > 0 ? ` — ${commit.remapped.length} remapped` : "";
      setResult(
        `Imported ${commit.created.length} records — ${commit.reused.length} reused${remappedNote} (${JSON.stringify(confirmed.sourceLabel)})`,
      );
    } catch (err) {
      if (err instanceof ArchiveImportCancelledError) {
        setFailure(archiveFailureGuidance(err));
      } else if (
        err instanceof StorageError &&
        (err.kind === "validation" || err.kind === "conflict")
      ) {
        setErrors([err.message]);
      } else {
        setFailure(archiveFailureGuidance(err));
      }
    } finally {
      setPreview(null);
      setBusy(false);
      restoreImportFocus();
    }
  }

  /** Cancel the preview: close it without writes and restore focus. */
  function onCancelImport() {
    setPreview(null);
    resetFeedback();
    restoreImportFocus();
  }

  const buttonClass =
    "inline-flex min-h-[44px] items-center gap-2 rounded border border-edge bg-card px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section aria-label="Data archive" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-action="export-v3"
          className={buttonClass}
          disabled={exportV3Disabled}
          onClick={() => {
            void onExportV3();
          }}
        >
          <Download size={16} aria-hidden="true" />
          Export archive
        </button>
        {exportV3Busy && (
          <button
            type="button"
            data-action="cancel-export-v3"
            className={buttonClass}
            onClick={onExportV3Cancel}
          >
            <XCircle size={16} aria-hidden="true" />
            Cancel export
          </button>
        )}
        <button
          type="button"
          data-action="import"
          ref={importTriggerRef}
          className={buttonClass}
          disabled={controlsDisabled}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          Import data
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import data file"
          className="sr-only"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void onFileChosen(file);
          }}
        />
      </div>

      {db === null && (
        <p className="text-xs text-text-muted">
          Storage is unavailable — export and import are disabled.
        </p>
      )}
      {db !== null && storageBlocked && (
        <p className="text-xs text-text-muted">
          {archiveFailureGuidance(new StorageError(storageState, storageState))}
        </p>
      )}

      {errors.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 text-xs text-error">
          {errors.slice(0, MAX_LISTED_ERRORS).map((message, i) => (
            <p key={i}>{message}</p>
          ))}
          {errors.length > MAX_LISTED_ERRORS && <p>and {errors.length - MAX_LISTED_ERRORS} more</p>}
        </div>
      )}

      {failure !== null && (
        <p role="alert" className="text-xs text-error">
          {failure}
        </p>
      )}

      {preview !== null && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded border border-edge bg-card p-3 text-xs text-text-secondary"
        >
          <p className="text-text">
            Import preview ({JSON.stringify(preview.sourceLabel)}) — {preview.totalEntities}{" "}
            {preview.totalEntities === 1 ? "record" : "records"}: {preview.create.length} to create,{" "}
            {preview.reuse.length} to reuse, {preview.collisions.length}{" "}
            {preview.collisions.length === 1 ? "planned remap" : "planned remaps"}
            {preview.invalid.length > 0
              ? `, ${preview.invalid.length} invalid (will not import)`
              : ""}
            .
          </p>
          <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto scroll-thin">
            {preview.counts.map((c) => (
              <li key={c.collection} className="max-w-full truncate font-mono text-text-secondary">
                {c.collection}: {c.total}
                {c.create > 0 ? ` · ${c.create} new` : ""}
                {c.reuse > 0 ? ` · ${c.reuse} reused` : ""}
                {c.collision > 0 ? ` · ${c.collision} collision` : ""}
                {c.invalid > 0 ? ` · ${c.invalid} invalid` : ""}
              </li>
            ))}
          </ul>
          {preview.collisions.length > 0 && (
            <p className="text-text">
              Colliding records will be imported under new IDs:{" "}
              {preview.collisions
                .slice(0, MAX_LISTED_ERRORS)
                .map((c) => `${c.collection}/${c.key}`)
                .join(", ")}
              {preview.collisions.length > MAX_LISTED_ERRORS
                ? `, and ${preview.collisions.length - MAX_LISTED_ERRORS} more`
                : ""}
              .
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action="confirm-import"
              className={buttonClass}
              disabled={busy}
              onClick={() => {
                void onConfirmImport();
              }}
            >
              Confirm import
            </button>
            <button
              type="button"
              data-action="cancel-import"
              className={buttonClass}
              disabled={busy}
              onClick={onCancelImport}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result !== null && (
        <div role="status" className="flex flex-col gap-1 text-xs text-text-secondary">
          <p>{result}</p>
        </div>
      )}

      {exportV3Busy && exportV3Progress !== null && (
        <div role="status" className="flex flex-col gap-1 text-xs text-text-secondary">
          <p>
            Exporting archive — stage {exportV3Progress.stage} · {exportV3Progress.done}/
            {exportV3Progress.total}
          </p>
        </div>
      )}

      {!exportV3Busy && exportV3Total !== null && (
        <div role="status" className="flex flex-col gap-1 text-xs text-text-secondary">
          <p>Exported complete archive — {exportV3Total} entities.</p>
        </div>
      )}
    </section>
  );
}
