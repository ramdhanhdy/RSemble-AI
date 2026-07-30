// =============================================================================
// LegacyRunDetail — summary-only detail for v1-imported records (spec §8.3).
//
// Renders only known fields from the legacy summary. Explicitly states that
// full evidence was not captured by the older history format. Does not
// fabricate status, mode, source, Judge, or evaluation fields.
// =============================================================================

import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import type { LegacyRunSummary } from "../../lib/persistence/run-types";
import { formatRelativeTime } from "./run-view-model";

export function LegacyRunDetail({ summary }: { summary: LegacyRunSummary }) {
  return (
    <div data-run-detail="" className="flex flex-1 flex-col gap-4 p-4 text-sm">
      <header data-section="header" className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text">{summary.taskExcerpt}</h2>
        <div className="flex items-center gap-3 text-text-muted">
          <span className="rounded-md border border-edge px-2 py-0.5 text-xs uppercase">Legacy summary</span>
          <span className="tabular-nums">{new Date(summary.createdAt).toLocaleString()}</span>
          <span className="text-text-muted">·</span>
          <span>{formatRelativeTime(summary.createdAt)}</span>
        </div>
      </header>

      {/* Limitation notice */}
      <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.06] p-3">
        <AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          Full evidence was not captured by the older history format.
          Only summary fields are available for this run.
        </p>
      </div>

      {/* Known fields only */}
      {summary.winnerKeys.length > 0 && (
        <section data-section="outcome" className="flex flex-col gap-1">
          <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Winner</h3>
          <div className="flex flex-wrap gap-2">
            {summary.winnerKeys.map((w) => (
              <span key={w} className="rounded-md border border-edge bg-panel px-2 py-1 font-mono text-sm text-text">
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
              <span key={k} className="font-mono text-sm text-text-secondary">{k}</span>
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
          to="/runs"
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Back to Runs
        </Link>
      </div>
    </div>
  );
}
