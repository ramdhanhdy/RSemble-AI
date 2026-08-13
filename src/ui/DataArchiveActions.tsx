// =============================================================================
// RSemble AI — Data archive actions (plan 8.1, spec §13/§14/§18/§20)
//
// Export/import controls for the whole workbench. Export downloads the
// allowlisted archive JSON; import validates file bytes BEFORE decoding,
// validates every limit before any mutation, and reports Created/Skipped/
// Conflicts counts plus conflicting IDs. Storage failures surface classified
// recovery guidance; blocked/versionchange/unavailable storage disables the
// controls with the same guidance.
// =============================================================================

import { useContext, useRef, useState, type ReactElement } from "react";
import { Download, Upload, XCircle } from "lucide-react";
import { RepositoryContext } from "../lib/persistence/repository-context";
import { StorageError } from "../lib/persistence/database";
import {
  archiveFailureGuidance,
  ArchiveExportCancelledError,
  exportWorkbenchArchive,
  exportWorkbenchArchiveV2,
  importWorkbenchArchive,
  parseWorkbenchArchive,
  validateArchiveBytes,
  type ArchiveExportProgress,
  type ArchiveImportResult,
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

/** Human-readable v2 archive serialization. Deterministic for a deterministic
 *  envelope: `JSON.stringify` preserves the adapter's declaration/sort order,
 *  and the payload digest is recomputed over canonical JSON (recursive key
 *  sort) so key order here cannot corrupt integrity. Presentation-only: v2
 *  validation re-parses the exact same JSON data model. */
export function serializeWorkbenchArchiveV2(archive: unknown): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}

export function DataArchiveActions(): ReactElement | null {
  const { db, storageState } = useContext(RepositoryContext);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportV2Busy, setExportV2Busy] = useState(false);
  const [exportV2Progress, setExportV2Progress] = useState<ArchiveExportProgress | null>(null);
  const [exportV2Total, setExportV2Total] = useState<number | null>(null);
  const exportV2AbortRef = useRef<AbortController | null>(null);
  const [report, setReport] = useState<ArchiveImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const storageBlocked =
    storageState === "blocked" ||
    storageState === "versionchange" ||
    storageState === "unavailable";
  const controlsDisabled = busy || db === null || storageBlocked;
  const exportV2Disabled = controlsDisabled || exportV2Busy;

  const resetFeedback = () => {
    setReport(null);
    setErrors([]);
    setFailure(null);
  };

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
      // The export resolved — the signal was never aborted (a pre-delivery
      // abort rejects with ArchiveExportCancelledError inside the adapter).
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

  async function onFileChosen(file: File) {
    if (db === null) return;
    setBusy(true);
    resetFeedback();
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
      const check = parseWorkbenchArchive(parsed);
      if (!check.ok) {
        setErrors(check.errors.length > 0 ? check.errors : [INVALID_ARCHIVE_MESSAGE]);
        return;
      }
      try {
        setReport(await importWorkbenchArchive(db, check.archive));
      } catch (err) {
        setFailure(archiveFailureGuidance(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const buttonClass =
    "inline-flex min-h-[44px] items-center gap-2 rounded border border-edge bg-card px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <section aria-label="Data archive" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
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
            Cancel export
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

      {report !== null && (
        <div role="status" className="flex flex-col gap-1 text-xs text-text-secondary">
          <p>
            Created {report.created.length} · Skipped {report.skipped.length} · Conflicts{" "}
            {report.conflicting.length}
          </p>
          {report.conflicting.length > 0 && (
            <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto scroll-thin">
              {report.conflicting.map((id) => (
                <li key={id} className="max-w-full truncate font-mono text-text-secondary">
                  {id}
                </li>
              ))}
            </ul>
          )}
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
    </section>
  );
}
