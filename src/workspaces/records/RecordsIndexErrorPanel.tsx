// =============================================================================
// RecordsIndexErrorPanel — §K.5 blocking diagnostics for a failed records
// index build.
//
// The index is derived and rebuildable; source data is untouched. The panel
// lists exact per-store diagnostics (entity type / ID / reason), offers
// "Retry rebuild" (idempotent, always safe) and "Copy diagnostics", and never
// echoes payload content.
// =============================================================================

import { useState } from "react";
import { AlertCircle, Check, DatabaseZap } from "lucide-react";
import type { RecordsIndexDiagnostic } from "../../lib/records/records-repository";

export function RecordsIndexErrorPanel({
  diagnostics,
  onRetry,
}: {
  diagnostics: RecordsIndexDiagnostic[];
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copyDiagnostics() {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          diagnostics.map(({ entityType, id, reason }) => ({ entityType, id, reason })),
        ),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard unavailable (permissions/insecure context): the panel stays
      // readable on screen, so a failed copy is non-blocking.
    }
  }
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
      <ul
        className="flex max-h-40 flex-col gap-1 overflow-y-auto scroll-thin rounded-md border border-edge bg-canvas p-2 font-mono text-xs text-text-secondary"
        aria-label="Index build diagnostics"
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
          className="motion-state flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {copied ? <Check size={14} aria-hidden="true" /> : null}
          {copied ? "Copied!" : "Copy diagnostics"}
        </button>
      </div>
    </div>
  );
}
