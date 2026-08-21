import { useState, type ReactNode } from "react";
import { Filter, X } from "lucide-react";
import type { RecordType } from "../../lib/records/record-reference";
import type { StatusMarkStatus } from "../../ui/StatusMark";

export interface RecordsFiltersValue {
  text: string;
  type: "" | RecordType;
  modelKey: string;
  status: "" | StatusMarkStatus;
  mode: "" | "rank" | "fuse";
  source: "" | "adhoc" | "experiment" | "legacy";
}

export const EMPTY_RECORDS_FILTERS: RecordsFiltersValue = {
  text: "",
  type: "",
  modelKey: "",
  status: "",
  mode: "",
  source: "",
};

const SELECT_CLASSES =
  "min-h-[44px] w-full rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function FilterSelect({
  label,
  dataFilter,
  value,
  onChange,
  children,
}: {
  label: string;
  dataFilter: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-text-muted">
      {label}
      <select
        data-filter={dataFilter}
        className={SELECT_CLASSES}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function RecordsFilters({
  value,
  onChange,
  modelKeys,
}: {
  value: RecordsFiltersValue;
  onChange: (value: RecordsFiltersValue) => void;
  modelKeys: string[];
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const appliedCount = [value.type, value.modelKey, value.status, value.mode, value.source].filter(
    Boolean,
  ).length;
  const anyApplied = appliedCount > 0 || value.text.length > 0;

  const selects = (
    <>
      <FilterSelect
        label="Type"
        dataFilter="type"
        value={value.type}
        onChange={(type) => onChange({ ...value, type: type as RecordsFiltersValue["type"] })}
      >
        <option value="">All types</option>
        <option value="comparison">Comparison</option>
        <option value="evaluation">Evaluation</option>
        <option value="policy-study">Policy Study</option>
        <option value="task-execution">Task execution</option>
        <option value="observation">Observation</option>
        <option value="legacy">Legacy</option>
      </FilterSelect>
      <FilterSelect
        label="Model"
        dataFilter="model"
        value={value.modelKey}
        onChange={(modelKey) => onChange({ ...value, modelKey })}
      >
        <option value="">All models</option>
        {modelKeys.map((modelKey) => (
          <option key={modelKey} value={modelKey}>
            {modelKey}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Status"
        dataFilter="status"
        value={value.status}
        onChange={(status) =>
          onChange({ ...value, status: status as RecordsFiltersValue["status"] })
        }
      >
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="queued">Queued</option>
        <option value="running">Running</option>
        <option value="paused">Paused</option>
        <option value="completed">Completed</option>
        <option value="completed_with_failures">Completed with failures</option>
        <option value="partial">Partial</option>
        <option value="failed">Failed</option>
        <option value="aborted">Aborted</option>
        <option value="interrupted">Interrupted</option>
        <option value="archived">Archived</option>
      </FilterSelect>
      <FilterSelect
        label="Mode"
        dataFilter="mode"
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode: mode as RecordsFiltersValue["mode"] })}
      >
        <option value="">All modes</option>
        <option value="rank">Rank</option>
        <option value="fuse">Fuse</option>
      </FilterSelect>
      <FilterSelect
        label="Source"
        dataFilter="source"
        value={value.source}
        onChange={(source) =>
          onChange({ ...value, source: source as RecordsFiltersValue["source"] })
        }
      >
        <option value="">All sources</option>
        <option value="adhoc">Ad hoc</option>
        <option value="experiment">Experiment</option>
        <option value="legacy">Legacy</option>
      </FilterSelect>
    </>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search records</span>
          <input
            type="search"
            data-filter="search"
            value={value.text}
            onChange={(event) => onChange({ ...value, text: event.target.value })}
            placeholder="Search exact ID or safe metadata…"
            className="min-h-[44px] w-full rounded-md border border-edge bg-canvas px-3 font-mono text-sm text-text placeholder:font-sans placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        {anyApplied && (
          <button
            type="button"
            data-action="clear-record-filters"
            onClick={() => onChange(EMPTY_RECORDS_FILTERS)}
            className="motion-state flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-edge text-text-muted hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Clear record filters"
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <button
        type="button"
        data-action="toggle-record-filters"
        onClick={() => setMobileOpen((open) => !open)}
        aria-expanded={mobileOpen}
        className="motion-state flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-edge text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden"
      >
        <Filter size={15} aria-hidden="true" />
        Filters
        {appliedCount > 0 && (
          <span className="rounded-sm bg-raised px-1.5 font-mono text-[11px] text-text">
            {appliedCount}
          </span>
        )}
      </button>
      {mobileOpen && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">{selects}</div>
      )}
      <div className="hidden grid-cols-2 gap-2 lg:grid">{selects}</div>
    </div>
  );
}
