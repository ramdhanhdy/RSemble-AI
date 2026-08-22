// =============================================================================
// RSemble AI — Comparison filters (spec §6.1)
//
// Child 05 (Contextual Compare Results) Milestone C — Task 5.
//
// Provides search and filtering for previous comparisons by title/prompt text,
// candidate model, run status, execution mode, and Task binding.
//
// Responsive layout:
//  - Desktop (lg+): search stays visible; model, status, mode, and binding
//    render in a compact grid sized for the drawer / rail pane.
//  - Mobile/tablet (below lg): search stays visible; filter selects collapse
//    into a sheet toggled by an accessible button with active-count badge.
// =============================================================================

import { useState, type ChangeEvent, type ReactNode } from "react";
import { Filter, X } from "lucide-react";
import type { RunStatus } from "../../lib/persistence/run-types";
import type { ComparisonMode } from "../../lib/compare/comparison-result-types";

export interface ComparisonFiltersValue {
  text: string;
  modelKey: string;
  status: RunStatus | "";
  mode: ComparisonMode | "";
  bindingKind: "ad_hoc" | "canonical" | "";
  taskId: string;
  createdFrom?: number;
  createdTo?: number;
}

export const EMPTY_COMPARISON_FILTERS: ComparisonFiltersValue = {
  text: "",
  modelKey: "",
  status: "",
  mode: "",
  bindingKind: "",
  taskId: "",
  createdFrom: undefined,
  createdTo: undefined,
};

function countAppliedFilters(v: ComparisonFiltersValue): number {
  let count = 0;
  if (v.modelKey) count++;
  if (v.status) count++;
  if (v.mode) count++;
  if (v.bindingKind) count++;
  if (v.taskId) count++;
  if (v.createdFrom !== undefined) count++;
  if (v.createdTo !== undefined) count++;
  return count;
}

const SELECT_CLASSES =
  "min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
    <label className={`flex flex-col gap-1 ${wrapperClassName}`}>
      <span className={`text-xs font-medium ${labelClassName}`}>{label}</span>
      <select
        data-filter={dataFilter}
        aria-label={label}
        value={value}
        onChange={onChange}
        className={`${SELECT_CLASSES} ${selectClassName}`}
      >
        {children}
      </select>
    </label>
  );
}

const STATUS_LABELS: Record<RunStatus, string> = {
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
  aborted: "Aborted",
  interrupted: "Interrupted",
  running: "Running",
};

export function ComparisonFilters({
  value,
  onChange,
  modelKeys = [],
}: {
  value: ComparisonFiltersValue;
  onChange: (value: ComparisonFiltersValue) => void;
  modelKeys?: string[];
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const appliedCount = countAppliedFilters(value);
  const hasActiveFilters = value.text.trim().length > 0 || appliedCount > 0;

  function update(patch: Partial<ComparisonFiltersValue>) {
    onChange({ ...value, ...patch });
  }

  function clearAll() {
    onChange({ ...EMPTY_COMPARISON_FILTERS });
  }

  const modelOptions = (
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
      {(Object.keys(STATUS_LABELS) as RunStatus[]).map((st) => (
        <option key={st} value={st}>
          {STATUS_LABELS[st]}
        </option>
      ))}
    </>
  );

  const modeOptions = (
    <>
      <option value="">All modes</option>
      <option value="rank">Rank</option>
      <option value="fuse">Fuse</option>
    </>
  );

  const bindingOptions = (
    <>
      <option value="">All bindings</option>
      <option value="ad_hoc">Ad hoc (exploratory)</option>
      <option value="canonical">Canonical Task</option>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Search Bar + Controls */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label="Search comparisons"
          placeholder="Search comparisons by title…"
          value={value.text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ text: e.target.value })}
          className="min-h-[44px] flex-1 rounded-md border border-edge bg-panel px-3 text-sm text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />

        {hasActiveFilters && (
          <button
            type="button"
            data-action="clear-filters"
            aria-label="Clear search and filters"
            onClick={clearAll}
            className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md px-2 text-xs text-text-muted transition-colors duration-150 hover:bg-raised hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}

        {/* Mobile toggle button */}
        <button
          type="button"
          data-action="toggle-filters"
          aria-label="Toggle filters"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen((prev) => !prev)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
        >
          <Filter size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Filters</span>
          {appliedCount > 0 && (
            <span
              data-applied-count=""
              className="flex min-w-[20px] items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs text-accent tabular-nums"
            >
              {appliedCount}
            </span>
          )}
        </button>
      </div>

      {/* Desktop filter composition (lg+) */}
      <div data-desktop-filters className="hidden grid-cols-2 gap-2 lg:grid">
        {modelKeys.length > 0 && (
          <FilterSelect
            label="Model"
            dataFilter="model"
            value={value.modelKey}
            onChange={(e) => update({ modelKey: e.target.value })}
            wrapperClassName="col-span-2"
            labelClassName="text-xs text-text-muted"
            selectClassName="w-full min-w-0"
          >
            {modelOptions}
          </FilterSelect>
        )}

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
          onChange={(e) => update({ mode: e.target.value as ComparisonMode | "" })}
          labelClassName="text-xs text-text-muted"
          selectClassName="w-full min-w-0"
        >
          {modeOptions}
        </FilterSelect>

        <FilterSelect
          label="Task Binding"
          dataFilter="binding"
          value={value.bindingKind}
          onChange={(e) => update({ bindingKind: e.target.value as "ad_hoc" | "canonical" | "" })}
          wrapperClassName="col-span-2"
          labelClassName="text-xs text-text-muted"
          selectClassName="w-full min-w-0"
        >
          {bindingOptions}
        </FilterSelect>
      </div>

      {/* Mobile/tablet filter sheet (below lg) */}
      {sheetOpen && (
        <div
          data-mobile-filters=""
          className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-3 lg:hidden"
        >
          <div className="flex items-center justify-between border-b border-edge pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Filters {appliedCount > 0 && `(${appliedCount})`}
            </span>
            <button
              type="button"
              data-action="close-filters"
              onClick={() => setSheetOpen(false)}
              className="text-xs text-text-muted hover:text-text"
            >
              Done
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {modelKeys.length > 0 && (
              <FilterSelect
                label="Model"
                dataFilter="model"
                value={value.modelKey}
                onChange={(e) => update({ modelKey: e.target.value })}
                labelClassName="text-xs text-text-muted"
                selectClassName="w-full min-w-0"
              >
                {modelOptions}
              </FilterSelect>
            )}

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
              onChange={(e) => update({ mode: e.target.value as ComparisonMode | "" })}
              labelClassName="text-xs text-text-muted"
              selectClassName="w-full min-w-0"
            >
              {modeOptions}
            </FilterSelect>

            <FilterSelect
              label="Task Binding"
              dataFilter="binding"
              value={value.bindingKind}
              onChange={(e) =>
                update({ bindingKind: e.target.value as "ad_hoc" | "canonical" | "" })
              }
              labelClassName="text-xs text-text-muted"
              selectClassName="w-full min-w-0"
            >
              {bindingOptions}
            </FilterSelect>
          </div>
        </div>
      )}
    </div>
  );
}
