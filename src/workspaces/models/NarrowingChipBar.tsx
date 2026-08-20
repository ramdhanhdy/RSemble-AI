// =============================================================================
// NarrowingChipBar — Fable §5.10.
//
// Removable chips for the active evidence-table narrowings plus a "Clear all"
// control. Each chip carries its label and a remove button; clearing returns
// focus to the originating control (wired by the parent via onClearAll).
// =============================================================================

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { COPY } from "./copy";

export interface NarrowingChip {
  key: string;
  label: string;
}

interface NarrowingChipBarProps {
  chips: readonly NarrowingChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

export function NarrowingChipBar({
  chips,
  onRemove,
  onClearAll,
}: NarrowingChipBarProps): ReactNode {
  if (chips.length === 0) return null;
  return (
    <div data-narrowing-chip-bar className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <span
          key={chip.key}
          data-narrowing-chip
          data-narrowing-key={chip.key}
          className="inline-flex min-h-[28px] items-center gap-1 rounded-sm border border-edge bg-card px-2 text-xs text-text"
        >
          <span>{chip.label}</span>
          <button
            type="button"
            data-remove-narrowing
            aria-label={COPY.narrowingChipBar.removeLabel(chip.label)}
            className="pressable inline-flex size-5 items-center justify-center rounded-sm text-text-muted hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            onClick={() => onRemove(chip.key)}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        data-clear-all
        className="pressable inline-flex min-h-[28px] items-center rounded-sm px-2 text-xs text-text-secondary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        onClick={onClearAll}
      >
        {COPY.narrowingChipBar.clearAll}
      </button>
    </div>
  );
}
