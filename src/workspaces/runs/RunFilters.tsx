// =============================================================================
// RunFilters — search + filter controls for the Runs list (spec §8.2).
//
// Desktop (lg/1024+, where the Runs workspace split begins): search stays
// visible and model/status/mode/source render always-visible in a compact
// 2-column grid sized for the 380px list pane, with the applied-count badge
// and Clear filters beside them (transplant map §E1: RESTYLE — desktop
// filters compact and always visible).
//
// Below lg: search stays visible; model/status/mode/source collapse into a
// single Filters sheet behind the toggle, with the applied-count badge on the
// toggle (KEEP — mobile collapsed sheet/toggle). Clear filters resets all five
// fields at every width. No new query semantics, chips, or persistence.
// =============================================================================

import { useState, type ChangeEvent, type ReactNode } from "react";
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

/** Shared select chrome so the mobile sheet and the desktop composition can
 *  never drift apart (transplant map §E1 — one source of truth for the
 *  data-filter selects and their accessible label structure). */
const SELECT_CLASSES =
  "min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Local presentational helper: labeled filter select with a data-filter
 *  hook. The wrapping <label> keeps the accessible name; the data-filter
 *  attribute keeps the query hook used by RunList tests and CDP probes. */
function FilterSelect({
  label,
  dataFilter,
  value,
  onChange,
  wrapperClassName = "",
  labelClassName = "text-text-muted",
  selectClassName = "",
  children,
}: {
  label: string;
  dataFilter: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  wrapperClassName?: string;
  labelClassName?: string;
  selectClassName?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${wrapperClassName}`}>
      <span className={labelClassName}>{label}</span>
      <select
        data-filter={dataFilter}
        value={value}
        onChange={onChange}
        className={`${SELECT_CLASSES} ${selectClassName}`}
      >
        {children}
      </select>
    </label>
  );
}

/** Shared option lists — identical in the sheet and the desktop grid so the
 *  filter semantics (text, model, status, mode, source) cannot diverge. */
const modelOptions = (modelKeys: string[]) => (
  <>
    <option value="">All models</option>
    {modelKeys.map((k) => (
      <option key={k} value={k}>
        {k}
      </option>
    ))}
  </>
);

const statusOptions = (
  <>
    <option value="">All statuses</option>
    <option value="running">Running</option>
    <option value="completed">Completed</option>
    <option value="partial">Partial</option>
    <option value="failed">Failed</option>
    <option value="aborted">Aborted</option>
    <option value="interrupted">Interrupted</option>
  </>
);

const modeOptions = (
  <>
    <option value="">All modes</option>
    <option value="rank">Rank</option>
    <option value="fuse">Fuse</option>
  </>
);

const sourceOptions = (
  <>
    <option value="">All sources</option>
    <option value="adhoc">Ad hoc</option>
    <option value="experiment">Experiment</option>
    <option value="legacy">Legacy</option>
  </>
);

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
      {/* Search — always visible at every width */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label="Search runs"
          placeholder="Search task or model…"
          value={value.text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ text: e.target.value })}
          className="min-h-[44px] flex-1 rounded-md border border-edge bg-panel px-3 text-sm text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {/* Filters sheet toggle — mobile/tablet only (below lg). On desktop the
            composition below is always visible, so the toggle is redundant
            there and hidden via lg:hidden (KEEP: mobile collapsed sheet). */}
        <button
          type="button"
          data-action="toggle-filters"
          aria-label="Toggle filters"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((o) => !o)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
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

      {/* Desktop composition — always rendered at lg+ (transplant map §E1
          RESTYLE): all four selects in a compact 2-col grid that fits the
          380px list pane; Model spans the full width because model keys are
          long. The header mirrors the mobile toggle's label + applied-count
          badge so the count semantic survives at every width. */}
      <div data-desktop-filters className="hidden grid-cols-2 gap-2 lg:grid">
        <div className="col-span-2 flex items-center gap-1.5">
          <span className="text-xs text-text-muted">Filters</span>
          {applied > 0 && (
            <span className="flex min-w-[20px] items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs text-accent tabular-nums">
              {applied}
            </span>
          )}
        </div>

        <FilterSelect
          label="Model"
          dataFilter="model"
          value={value.modelKey}
          onChange={(e) => update({ modelKey: e.target.value })}
          wrapperClassName="col-span-2"
          labelClassName="text-xs text-text-muted"
          selectClassName="w-full min-w-0"
        >
          {modelOptions(modelKeys)}
        </FilterSelect>

        <FilterSelect
          label="Status"
          dataFilter="status"
          value={value.status}
          onChange={(e) => update({ status: e.target.value as RunStatus | "" })}
          labelClassName="text-xs text-text-muted"
          selectClassName="w-full min-w-0"
        >
          {statusOptions}
        </FilterSelect>

        <FilterSelect
          label="Mode"
          dataFilter="mode"
          value={value.mode}
          onChange={(e) => update({ mode: e.target.value as "rank" | "fuse" | "" })}
          labelClassName="text-xs text-text-muted"
          selectClassName="w-full min-w-0"
        >
          {modeOptions}
        </FilterSelect>

        <FilterSelect
          label="Source"
          dataFilter="source"
          value={value.source}
          onChange={(e) =>
            update({ source: e.target.value as "adhoc" | "experiment" | "legacy" | "" })
          }
          labelClassName="text-xs text-text-muted"
          selectClassName="w-full min-w-0"
        >
          {sourceOptions}
        </FilterSelect>

        <button
          type="button"
          data-action="clear-filters"
          onClick={() => onChange({ ...EMPTY_FILTERS })}
          className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={14} aria-hidden="true" />
          Clear filters
        </button>
      </div>

      {/* Mobile/tablet sheet — below lg only, opened via the toggle (KEEP).
          lg:hidden guards against a sheet left open when the viewport crosses
          into desktop, where the composition above is authoritative. */}
      {sheetOpen && (
        <div
          data-filter-sheet
          className="flex flex-wrap items-end gap-2 rounded-md border border-edge bg-panel p-3 lg:hidden"
        >
          <FilterSelect
            label="Model"
            dataFilter="model"
            value={value.modelKey}
            onChange={(e) => update({ modelKey: e.target.value })}
          >
            {modelOptions(modelKeys)}
          </FilterSelect>

          <FilterSelect
            label="Status"
            dataFilter="status"
            value={value.status}
            onChange={(e) => update({ status: e.target.value as RunStatus | "" })}
          >
            {statusOptions}
          </FilterSelect>

          <FilterSelect
            label="Mode"
            dataFilter="mode"
            value={value.mode}
            onChange={(e) => update({ mode: e.target.value as "rank" | "fuse" | "" })}
          >
            {modeOptions}
          </FilterSelect>

          <FilterSelect
            label="Source"
            dataFilter="source"
            value={value.source}
            onChange={(e) =>
              update({ source: e.target.value as "adhoc" | "experiment" | "legacy" | "" })
            }
          >
            {sourceOptions}
          </FilterSelect>

          <button
            type="button"
            data-action="clear-filters"
            onClick={() => onChange({ ...EMPTY_FILTERS })}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={14} aria-hidden="true" />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
