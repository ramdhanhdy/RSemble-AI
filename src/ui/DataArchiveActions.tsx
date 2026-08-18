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
// Unsupported legacy Fusion archives (REV-3) reject deterministically with a
// receipt before any writes, showing the collections and a single Close action.
// =============================================================================

import { useContext, useRef, useState, type ReactElement } from "react";
import { Download, Upload, XCircle } from "lucide-react";
import { RepositoryContext } from "../lib/persistence/repository-context";
import { StorageError } from "../lib/persistence/database";
import {
  archiveFailureGuidance,
  ArchiveExportCancelledError,
  ArchiveImportCancelledError,
  commitPreviewWorkbenchArchiveV2,
  commitPreviewWorkbenchArchiveV3,
  exportWorkbenchArchive,
  exportWorkbenchArchiveV2,
  exportWorkbenchArchiveV3,
  importWorkbenchArchive,
  previewWorkbenchArchive,
  validateArchiveBytes,
  type ArchiveExportProgress,
  type ArchiveExportV3Progress,
  type ArchiveImportPreview,
} from "../lib/persistence/archive";

const INVALID_ARCHIVE_MESSAGE = "The archive is invalid — nothing was imported.";
const MAX_LISTED_ERRORS = 5;

function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Human-readable archive serialization. Pretty-printing is intentionally a
 * presentation-only change: import still parses the exact same JSON data model. */
export function serializeWorkbenchArchive(archive: unknown): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

/** Human-readable v2 archive serialization. */
export function serializeWorkbenchArchiveV2(archive: unknown): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

/** Human-readable v3 archive serialization. */
export function serializeWorkbenchArchiveV3(archive: unknown): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

export function DataArchiveActions(): ReactElement | null {
  const { db, storageState } = useContext(RepositoryContext);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportV2Busy, setExportV2Busy] = useState(false);
  const [exportV2Progress, setExportV2Progress] = useState<ArchiveExportProgress | null>(null);
  const [exportV2Total, setExportV2Total] = useState<number | null>(null);
  const exportV2AbortRef = useRef<AbortController | null>(null);
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
  const exportV2Disabled = controlsDisabled || exportV2Busy;
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
        `rsemble-archive-v3-${archiveTimestamp()}.json`,
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

  async function onExportV2() {
    if (db === null || exportV2AbortRef.current !== null) return;
    const controller = new AbortController();
    exportV2AbortRef.current = controller;
    setExportV2Busy(true);
    setExportV2Progress(null);
    resetFeedback();
    try {
      const archive = await exportWorkbenchArchiveV2(db, {
        signal: controller.signal,
        onProgress: (p) => setExportV2Progress(p),
      });
      deliverArchive(
        `rsemble-archive-v2-${archiveTimestamp()}.json`,
        serializeWorkbenchArchiveV2(archive),
      );
      const total = Object.values(archive.manifest.counts).reduce((sum, n) => sum + n, 0);
      setExportV2Total(total);
    } catch (err) {
      if (err instanceof ArchiveExportCancelledError) {
        setFailure(archiveFailureGuidance(err));
      } else if (err instanceof StorageError && err.kind === "validation") {
        setErrors([err.message]);
      } else {
        setFailure(archiveFailureGuidance(err));
      }
    } finally {
      exportV2AbortRef.current = null;
      setExportV2Busy(false);
      setExportV2Progress(null);
    }
  }

  function onExportV2Cancel() {
    exportV2AbortRef.current?.abort();
  }

  async function onExport() {
    if (db === null) return;
    setBusy(true);
    resetFeedback();
    try {
      const archive = await exportWorkbenchArchive(db);
      deliverArchive(
        `rsemble-archive-${archiveTimestamp()}.json`,
        serializeWorkbenchArchive(archive),
      );
    } catch (err) {
      setFailure(archiveFailureGuidance(err));
    } finally {
      setBusy(false);
    }
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
      if (confirmed.format === "v1") {
        const report = await importWorkbenchArchive(db, confirmed.payload as never);
        setResult(
          `Imported ${report.created.length} records — ${report.skipped.length} reused (${JSON.stringify(confirmed.sourceLabel)})`,
        );
      } else if (confirmed.format === "v2") {
        const commit = await commitPreviewWorkbenchArchiveV2(db, confirmed);
        setResult(
          `Imported ${commit.created.length} records — ${commit.reused.length} reused (${JSON.stringify(confirmed.sourceLabel)})`,
        );
      } else if (confirmed.format === "v3") {
        const commit = await commitPreviewWorkbenchArchiveV3(db, confirmed);
        setResult(
          `Imported ${commit.created.length} records — ${commit.reused.length} reused (${JSON.stringify(confirmed.sourceLabel)})`,
        );
      }
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
          data-action="export"
          className={buttonClass}
          disabled={controlsDisabled}
          onClick={() => {
            void onExport();
          }}
        >
          <Download size={16} aria-hidden="true" />
          Export data
        </button>
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
        <button
          type="button"
          data-action="export-v2"
          className={buttonClass}
          disabled={exportV2Disabled}
          onClick={() => {
            void onExportV2();
          }}
        >
          <Download size={16} aria-hidden="true" />
          Export v2 archive
        </button>
        {exportV2Busy && (
          <button
            type="button"
            data-action="cancel-export"
            className={buttonClass}
            onClick={onExportV2Cancel}
          >
            <XCircle size={16} aria-hidden="true" />
            Cancel export v2
          </button>
        )}
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

      {preview !== null && preview.format === "unsupported_fusion_archive_shape" && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded border border-edge bg-card p-3 text-xs text-text-secondary"
        >
          <p className="font-medium text-text">Unsupported legacy archive format</p>
          <p className="text-text">
            This archive contains retired Fusion Study collections (
            {preview.unsupportedReceipt?.rejectedCollections.map((c, i) => (
              <span key={c}>
                {i > 0 ? ", " : ""}
                <code className="font-mono text-text">{c}</code>
              </span>
            ))}
            ) and cannot be imported. Export a new archive from an upgraded RSemble instead.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action="close-unsupported"
              className={buttonClass}
              onClick={onCancelImport}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {preview !== null && preview.format !== "unsupported_fusion_archive_shape" && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded border border-edge bg-card p-3 text-xs text-text-secondary"
        >
          <p className="text-text">
            Import preview ({JSON.stringify(preview.sourceLabel)}) — format {preview.format},{" "}
            {preview.totalEntities} {preview.totalEntities === 1 ? "record" : "records"}:{" "}
            {preview.create.length} to create, {preview.reuse.length} to reuse,{" "}
            {preview.collisions.length}{" "}
            {preview.collisions.length === 1 ? "collision" : "collisions"}
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
              Colliding records will be left unchanged:{" "}
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

      {exportV2Busy && exportV2Progress !== null && (
        <div role="status" className="flex flex-col gap-1 text-xs text-text-secondary">
          <p>
            Exporting v2 archive — stage {exportV2Progress.stage} · {exportV2Progress.done}/
            {exportV2Progress.total}
          </p>
        </div>
      )}

      {!exportV2Busy && exportV2Total !== null && (
        <div role="status" className="flex flex-col gap-1 text-xs text-text-secondary">
          <p>Exported complete v2 archive — {exportV2Total} entities.</p>
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
