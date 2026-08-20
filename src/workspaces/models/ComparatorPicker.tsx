// =============================================================================
// ComparatorPicker — Fable §5.9 / §7.5.
//
// Wraps DialogSurface (does not fork it). The trigger button reads "Select
// comparator"; the dialog lists candidate configurations ordered by shared-task
// overlap (descending) — the only ranking in the workspace, and it ranks
// overlap, never quality (labeled as such). Selecting a candidate reports the
// choice and closes the dialog.
// =============================================================================

import type { ReactNode } from "react";
import { DialogSurface } from "../../ui/DialogSurface";
import { COPY } from "./copy";

export interface ComparatorCandidate {
  id: string;
  label: string;
  sharedTaskCount: number;
}

interface ComparatorPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: readonly ComparatorCandidate[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function ComparatorPicker({
  open,
  onOpenChange,
  candidates,
  selectedId,
  onSelect,
}: ComparatorPickerProps): ReactNode {
  const ordered = [...candidates].sort((a, b) => b.sharedTaskCount - a.sharedTaskCount);
  return (
    <>
      <button
        type="button"
        data-comparator-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        className="pressable inline-flex min-h-[44px] items-center gap-1 rounded-sm border border-edge px-3 text-sm text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        onClick={() => onOpenChange(true)}
      >
        {COPY.comparatorPicker.trigger}
      </button>
      <DialogSurface open={open} onOpenChange={onOpenChange} title={COPY.comparatorPicker.title}>
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
          <div className="border-b border-edge px-4 py-3">
            <h2 className="text-sm font-semibold text-text">{COPY.comparatorPicker.title}</h2>
            <p className="mt-1 text-xs text-text-secondary">{COPY.comparatorPicker.rankingLabel}</p>
          </div>
          <ul data-comparator-list className="overflow-y-auto scroll-thin py-1">
            {ordered.map((c) => {
              const selected = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    data-comparator-candidate
                    data-candidate-id={c.id}
                    aria-pressed={selected}
                    className="pressable flex w-full min-h-[44px] items-center justify-between gap-2 px-4 py-2 text-left text-sm text-text hover:bg-card-hover focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                    onClick={() => {
                      onSelect(c.id);
                      onOpenChange(false);
                    }}
                  >
                    <span>{c.label}</span>
                    <span className="font-mono text-xs text-text-secondary">
                      {COPY.comparatorPicker.sharedTasks(c.sharedTaskCount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogSurface>
    </>
  );
}
