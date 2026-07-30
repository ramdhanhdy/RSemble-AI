// =============================================================================
// RunFilters — search + filter controls for the Runs list (spec §8.2).
//
// At 390px search stays visible; model/status/mode/source collapse into a
// single Filters sheet with an applied-count badge. Clear filters resets all.
// =============================================================================

import { useState, type ChangeEvent } from "react";
import { Filter, X } from "lucide-react";
import type { RunStatus } from "../../lib/persistence/run-types";

export interface RunFiltersValue {
  text: string;
  modelKey: string;
  status: RunStatus | "";
  mode: "rank" | "fuse" | "";
  source: "adhoc" | "experiment" | "legacy" | "";
}

export const EMPTY_FILTERS: RunFiltersValue = {
  text: "",
  modelKey: "",
  status: "",
  mode: "",
  source: "",
};

function countApplied(v: RunFiltersValue): number {
  let n = 0;
  if (v.modelKey) n++;
  if (v.status) n++;
  if (v.mode) n++;
  if (v.source) n++;
  return n;
}

export function RunFilters({
  value,
  onChange,
  modelKeys,
}: {
  value: RunFiltersValue;
  onChange: (v: RunFiltersValue) => void;
  modelKeys: string[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const applied = countApplied(value);

  function update(patch: Partial<RunFiltersValue>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Search — always visible */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label="Search runs"
          placeholder="Search task or model…"
          value={value.text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ text: e.target.value })}
          className="min-h-[44px] flex-1 rounded-md border border-edge bg-panel px-3 text-sm text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none"
        />
        {/* Filters sheet toggle — visible on all sizes, essential on mobile */}
        <button
          type="button"
          data-action="toggle-filters"
          aria-label="Toggle filters"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          <Filter size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {applied > 0 && (
            <span className="flex min-w-[20px] items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs text-accent tabular-nums">
              {applied}
            </span>
          )}
        </button>
      </div>

      {/* Filter controls — visible when sheet open or on desktop */}
      {sheetOpen && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-edge bg-panel p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Model</span>
            <select
              data-filter="model"
              value={value.modelKey}
              onChange={(e) => update({ modelKey: e.target.value })}
              className="min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            >
              <option value="">All models</option>
              {modelKeys.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Status</span>
            <select
              data-filter="status"
              value={value.status}
              onChange={(e) => update({ status: e.target.value as RunStatus | "" })}
              className="min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            >
              <option value="">All statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
              <option value="aborted">Aborted</option>
              <option value="interrupted">Interrupted</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Mode</span>
            <select
              data-filter="mode"
              value={value.mode}
              onChange={(e) => update({ mode: e.target.value as "rank" | "fuse" | "" })}
              className="min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            >
              <option value="">All modes</option>
              <option value="rank">Rank</option>
              <option value="fuse">Fuse</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-muted">Source</span>
            <select
              data-filter="source"
              value={value.source}
              onChange={(e) => update({ source: e.target.value as "adhoc" | "experiment" | "legacy" | "" })}
              className="min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none"
            >
              <option value="">All sources</option>
              <option value="adhoc">Ad hoc</option>
              <option value="experiment">Experiment</option>
              <option value="legacy">Legacy</option>
            </select>
          </label>

          <button
            type="button"
            data-action="clear-filters"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
          >
            <X size={14} aria-hidden="true" />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
