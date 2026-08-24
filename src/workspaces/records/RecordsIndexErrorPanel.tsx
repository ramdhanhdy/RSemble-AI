// =============================================================================
// RecordsIndexErrorPanel — §K.5 blocking diagnostics for a failed records
// index build.
//
// The index is derived and rebuildable; source data is untouched. The panel
// lists exact per-store diagnostics (entity type / ID / reason), offers
// "Retry rebuild" (idempotent, always safe) and "Copy diagnostics", renders the
// diagnostic count, provides accessible and visible clipboard feedback, and
// never echoes payload content.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, DatabaseZap } from "lucide-react";
import type { RecordsIndexDiagnostic } from "../../lib/records/records-repository";

export function RecordsIndexErrorPanel({
  diagnostics,
  onRetry,
}: {
  diagnostics: RecordsIndexDiagnostic[];
  onRetry: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [announcement, setAnnouncement] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function copyDiagnostics() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(
        JSON.stringify(
          diagnostics.map(({ entityType, id, reason }) => ({ entityType, id, reason })),
        ),
      );
      setCopyStatus("copied");
      setAnnouncement("Diagnostics copied to clipboard.");
      timerRef.current = window.setTimeout(() => {
        setCopyStatus("idle");
        setAnnouncement("");
      }, 2_000);
    } catch {
      setCopyStatus("failed");
      setAnnouncement("Failed to copy diagnostics to clipboard.");
      timerRef.current = window.setTimeout(() => {
        setCopyStatus("idle");
        setAnnouncement("");
      }, 3_000);
    }
  }

  const countLabel = `${diagnostics.length} ${
    diagnostics.length === 1 ? "diagnostic" : "diagnostics"
  }`;

  return (
    <div
      data-index-error-panel=""
      role="alert"
      className="flex min-h-[200px] flex-col gap-3 rounded-md border border-error/30 bg-error/[0.06] p-4"
    >
      <div className="flex items-start gap-2">
        <AlertCircle size={18} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-error">The records index could not be built.</p>
          <p className="text-sm text-text-secondary">
            Your runs and results are unaffected — this index is derived and rebuildable.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Diagnostics
        </p>
        <span
          data-testid="diagnostics-count"
          className="font-mono text-xs tabular-nums text-text-muted"
        >
          {countLabel}
        </span>
      </div>
      <ul
        className="flex max-h-40 flex-col gap-1 overflow-y-auto scroll-thin rounded-md border border-edge bg-canvas p-2 font-mono text-xs text-text-secondary"
        aria-label={`Index build diagnostics (${countLabel})`}
      >
        {diagnostics.map((entry, index) => (
          <li key={`${entry.entityType}:${entry.id}:${index}`} className="break-all">
            {entry.entityType} · {entry.id} · {entry.reason}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-action="retry-rebuild"
          onClick={onRetry}
          className="motion-state flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <DatabaseZap size={14} aria-hidden="true" />
          Retry rebuild
        </button>
        <button
          type="button"
          data-action="copy-diagnostics"
          onClick={() => void copyDiagnostics()}
          aria-label={
            copyStatus === "copied"
              ? "Diagnostics copied"
              : copyStatus === "failed"
                ? "Failed to copy diagnostics"
                : "Copy diagnostics"
          }
          className="motion-state flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {copyStatus === "copied" ? <Check size={14} aria-hidden="true" /> : null}
          {copyStatus === "failed" ? (
            <AlertCircle size={14} className="text-error" aria-hidden="true" />
          ) : null}
          {copyStatus === "copied"
            ? "Copied!"
            : copyStatus === "failed"
              ? "Failed to copy"
              : "Copy diagnostics"}
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
