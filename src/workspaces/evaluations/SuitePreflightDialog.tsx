// =============================================================================
// SuitePreflightDialog — confirmation before a paid suite run (spec §8.5).
//
// Summarizes model preflight state (Ready, Failed, Untested) without silently
// changing the roster. When any enabled candidate or Judge has failed, the
// primary action is "Review model tests" and a secondary "Run anyway" is
// required to proceed. Untested models do not hard-block execution.
//
// Uses the shared DialogSurface (Base UI Dialog) for focus entry, Tab trap,
// Escape close, and focus restoration.
// =============================================================================

import type { ReactElement } from "react";
import { DialogSurface } from "../../ui/DialogSurface";
import type { ModelProbeState } from "../../lib/providers/model-probe";

export interface SuitePreflightEntry {
  modelKey: string;
  label: string;
  state: ModelProbeState;
}

export interface SuitePreflightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: SuitePreflightEntry[];
  judge: SuitePreflightEntry;
  onRunAnyway: () => void;
}

function summarize(entries: SuitePreflightEntry[]) {
  let ready = 0;
  let failed = 0;
  let untested = 0;
  const failures: SuitePreflightEntry[] = [];
  for (const e of entries) {
    if (e.state.kind === "ready") ready++;
    else if (e.state.kind === "failed") {
      failed++;
      failures.push(e);
    } else untested++;
  }
  return { ready, failed, untested, failures };
}

function stateLabel(state: ModelProbeState): string {
  switch (state.kind) {
    case "untested":
      return "Untested";
    case "testing":
      return "Testing…";
    case "ready":
      return `Ready · ${state.latencyMs}ms`;
    case "failed":
      return `Failed · ${state.message}`;
  }
}

export function SuitePreflightDialog({
  open,
  onOpenChange,
  candidates,
  judge,
  onRunAnyway,
}: SuitePreflightDialogProps): ReactElement {
  const all = [judge, ...candidates];
  const { ready, failed, untested, failures } = summarize(all);
  const hasFailures = failed > 0;

  return (
    <DialogSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Task set model preflight"
      className="max-w-md"
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-text">Task set model preflight</h2>
        <p className="text-xs text-text-muted">
          Live model tests send a small generation request and may incur provider cost.
        </p>

        {/* Summary counts */}
        <div className="flex gap-4 text-xs tabular-nums">
          <span className="text-success">{ready} Ready</span>
          {failed > 0 && <span className="text-error">{failed} Failed</span>}
          {untested > 0 && <span className="text-text-muted">{untested} Untested</span>}
        </div>

        {/* Failed models list */}
        {hasFailures && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-error">Failed models:</p>
            <ul className="space-y-0.5">
              {failures.map((f) => (
                <li key={f.modelKey} className="text-xs text-text-secondary">
                  <span className="font-mono">{f.label}</span>: {stateLabel(f.state)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Untested-only recommendation */}
        {!hasFailures && untested > 0 && (
          <p className="text-xs text-text-muted">
            {untested} model(s) are untested. Testing is recommended but not required.
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          {hasFailures ? (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Review model tests
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onRunAnyway();
                }}
                className="inline-flex min-h-[44px] items-center rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Run anyway
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onRunAnyway();
                }}
                className="inline-flex min-h-[44px] items-center rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Run task set
              </button>
            </>
          )}
        </div>
      </div>
    </DialogSurface>
  );
}
