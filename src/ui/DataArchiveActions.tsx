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
import { Download, Upload } from "lucide-react";
import { RepositoryContext } from "../lib/persistence/repository-context";
import { StorageError } from "../lib/persistence/database";
import {
  archiveFailureGuidance,
  exportWorkbenchArchive,
  importWorkbenchArchive,
  parseWorkbenchArchive,
  validateArchiveBytes,
  type ArchiveImportResult,
} from "../lib/persistence/archive";

const INVALID_ARCHIVE_MESSAGE = "The archive is invalid — nothing was imported.";
const MAX_LISTED_ERRORS = 5;

function archiveTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function DataArchiveActions(): ReactElement | null {
  const { db, storageState } = useContext(RepositoryContext);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ArchiveImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const storageBlocked =
    storageState === "blocked" || storageState === "versionchange" || storageState === "unavailable";
  const controlsDisabled = busy || db === null || storageBlocked;

  const resetFeedback = () => {
    setReport(null);
    setErrors([]);
    setFailure(null);
  };

  async function onExport() {
    if (db === null) return;
    setBusy(true);
    resetFeedback();
    try {
      const archive = await exportWorkbenchArchive(db);
      const blob = new Blob([JSON.stringify(archive)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rsemble-archive-${archiveTimestamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
          {errors.length > MAX_LISTED_ERRORS && (
            <p>and {errors.length - MAX_LISTED_ERRORS} more</p>
          )}
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
    </section>
  );
}
