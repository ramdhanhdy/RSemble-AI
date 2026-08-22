// =============================================================================
// LegacyRunDetail — summary-only detail for v1-imported records (spec §8.3).
//
// Renders only known fields from the legacy summary. Explicitly states that
// full evidence was not captured by the older history format. Does not
// fabricate status, mode, source, Judge, or evaluation fields.
// Records (Child 08 §K.4) additionally discloses the preserved payload and
// import provenance when the caller passes them through.
// =============================================================================

import { useState } from "react";

import { AlertCircle, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import type { LegacyRunSummary } from "../../lib/persistence/run-types";
import { formatRelativeTime } from "./run-view-model";
import { CopyLinkButton } from "./CopyLinkButton";

export function LegacyRunDetail({
  summary,
  copyHref,
  backHref = "/runs",
  backLabel = "Back to Runs",
  preservedPayload,
}: {
  summary: LegacyRunSummary;
  copyHref?: string;
  backHref?: string;
  backLabel?: string;
  /** §K.4: the exact preserved record object, disclosed verbatim behind a
   *  contained-scroll panel. Optional so the /runs compatibility route can
   *  keep its leaner posture. */
  preservedPayload?: unknown;
}) {
  const [payloadOpen, setPayloadOpen] = useState(false);
  return (
    <div data-run-detail="" className="flex flex-1 flex-col gap-4 p-4 text-sm">
      <header data-section="header" className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text">{summary.taskExcerpt}</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
          <span className="rounded-md border border-edge px-2 py-0.5 text-xs uppercase">
            Legacy summary
          </span>
          <span className="tabular-nums">{new Date(summary.createdAt).toLocaleString()}</span>
          <span className="text-text-muted" aria-hidden="true">
            ·
          </span>
          <span>{formatRelativeTime(summary.createdAt)}</span>
        </div>
        {/* No "Open in Compare" for legacy runs: the v1 format has no frozen
          config to preload. Copy link still works (the deep link resolves via
          the legacy summary). */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <CopyLinkButton href={copyHref} subject={copyHref ? "record" : "run"} />
        </div>
      </header>
      {/* Import provenance — only what the stored summary itself declares
          ("1-import" format + import timestamp). Nothing is inferred. */}
      <section data-section="provenance" className="flex flex-col gap-1">
        <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">
          Import provenance
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-text-secondary">
          <dt className="text-text-muted">Format</dt>
          <dd className="font-mono">{summary.schemaVersion}</dd>
          <dt className="text-text-muted">Imported</dt>
          <dd className="font-mono tabular-nums">{new Date(summary.createdAt).toLocaleString()}</dd>
        </dl>
      </section>

      {preservedPayload !== undefined && (
        <section data-section="preserved-payload" className="flex flex-col gap-1">
          <button
            type="button"
            data-payload-disclosure=""
            aria-expanded={payloadOpen}
            onClick={() => setPayloadOpen((open) => !open)}
            className="motion-state flex min-h-[44px] w-fit items-center gap-1.5 rounded-md border border-edge bg-panel px-3 font-mono text-xs uppercase tracking-[0.08em] text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Preserved payload
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {payloadOpen && (
            <pre
              data-payload-panel=""
              className="max-h-96 overflow-y-auto scroll-thin whitespace-pre-wrap break-all rounded-md border border-edge bg-canvas p-2 font-mono text-xs text-text-secondary"
            >
              {JSON.stringify(preservedPayload)}
            </pre>
          )}
        </section>
      )}

      {/* Limitation notice */}
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.06] p-3">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          Full evidence was not captured by the older history format. Only summary fields are
          available for this run.
        </p>
      </div>

      {/* Known fields only */}
      {summary.winnerKeys.length > 0 && (
        <section data-section="outcome" className="flex flex-col gap-1">
          <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Winner</h3>
          <div className="flex flex-wrap gap-2">
            {summary.winnerKeys.map((w) => (
              <span
                key={w}
                className="rounded-md border border-edge bg-panel px-2 py-1 font-mono text-sm text-text"
              >
                {w}
              </span>
            ))}
          </div>
        </section>
      )}

      {summary.modelKeys.length > 0 && (
        <section data-section="models" className="flex flex-col gap-1">
          <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Models</h3>
          <div className="flex flex-wrap gap-2">
            {summary.modelKeys.map((k) => (
              <span key={k} className="font-mono text-sm text-text-secondary">
                {k}
              </span>
            ))}
          </div>
        </section>
      )}

      {Object.keys(summary.scoresByModelKey).length > 0 && (
        <section data-section="scores" className="flex flex-col gap-1">
          <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Scores</h3>
          <div className="flex flex-wrap gap-3">
            {Object.entries(summary.scoresByModelKey).map(([k, score]) => (
              <span key={k} className="font-mono text-sm text-text-secondary tabular-nums">
                {k}: {score.toFixed(1)}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="mt-4">
        <Link
          to={backHref}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}
