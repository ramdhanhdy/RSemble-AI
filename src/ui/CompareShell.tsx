// =============================================================================
// RSemble AI — Compare shell presentational components
//
// Extracted from rsemble.tsx (Plan 007 Workstream D). These are pure render
// helpers for the Compare workspace: the command-drawer close glyph, the ARIA
// split separator, the collapsed focus-mode command strip, pane labels, the
// offline banner, and the Previous comparisons history section integration.
// They are intentionally presentational — all orchestration and Compare state
// live above AppRoutes and stay mounted across navigation.
// =============================================================================

import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import type { StudioState } from "../studio-engine";
import { Play, Square } from "lucide-react";
import { BrandAvatar } from "./brand-icons";
import { ComparisonList, type ComparisonListProps } from "../workspaces/compare/ComparisonList";

export { ComparisonList };
export type { ComparisonListProps };

export function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function SplitDivider({
  dragging,
  value,
  min,
  max,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
}: {
  dragging: boolean;
  value: number;
  min: number;
  max: number;
  onPointerDown: (e: PointerEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onDoubleClick: () => void;
}) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- role="separator" with aria-valuenow is a focusable ARIA widget; pointer/keyboard resizing is its purpose
    <div
      role="separator"
      aria-label="Resize command and output panes"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      data-dragging={dragging ? "true" : undefined}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      className="rsemble-divider hidden lg:block"
    />
  );
}

export function FocusStrip({
  state,
  canRun,
  onRun,
  onAbort,
  blockReason,
}: {
  state: StudioState;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
  /** Attachment gate reason surfaced as the button tooltip (plan 7.6.8). */
  blockReason?: string | null;
}) {
  const enabledSlots = state.slots.filter((s) => s.enabled);
  return (
    <div className="flex h-full w-14 flex-col items-center gap-3 py-4">
      <div className="flex flex-col items-center gap-2">
        {enabledSlots.map((slot) => (
          <BrandAvatar key={slot.id} slug={slot.slug} size={28} className="rounded-md" />
        ))}
        {enabledSlots.length === 0 && (
          <span className="font-mono text-[11px] text-text-muted">—</span>
        )}
      </div>
      <button
        type="button"
        onClick={state.running ? onAbort : onRun}
        disabled={!canRun && !state.running}
        aria-label={state.running ? "Stop run" : "Re-run pipeline"}
        title={state.running ? "Stop run" : (blockReason ?? "Re-run pipeline")}
        className={`pressable mt-auto flex h-11 w-11 items-center justify-center rounded-md ${
          state.running
            ? "bg-error/20 text-error"
            : canRun
              ? "bg-accent text-on-accent hover-lift"
              : "border border-edge bg-card text-text-secondary opacity-60 cursor-not-allowed"
        }`}
      >
        {state.running ? <Square size={16} /> : <Play size={16} />}
      </button>
    </div>
  );
}

export function PaneLabel({
  index,
  title,
  hint,
  action,
}: {
  index: string;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs font-semibold tabular-nums text-accent">{index}</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {title}
          </span>
        </div>
        <p className="mt-1 text-xs text-text-muted">{hint}</p>
      </div>
      {action}
    </div>
  );
}

export function NoKeyBanner() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
      <span>
        <span className="font-semibold">No provider connected.</span> Connect any configured
        provider via the connection status button in the header — or set a supported{" "}
        <code className="rounded bg-warning/10 px-1">VITE_*_KEY</code> in{" "}
        <code className="rounded bg-warning/10 px-1">.env</code> and restart the dev server to
        enable live runs.
      </span>
    </div>
  );
}

/**
 * Previous comparisons section helper for Compare shell integration (spec §6.1).
 */
export function PreviousComparisonsSection({
  repo,
  selectedId,
  onNewComparison,
  modelKeys,
  className = "",
}: ComparisonListProps) {
  return (
    <section aria-label="Previous comparisons" className={`flex flex-col gap-3 ${className}`}>
      <ComparisonList
        repo={repo}
        selectedId={selectedId}
        onNewComparison={onNewComparison}
        modelKeys={modelKeys}
      />
    </section>
  );
}
