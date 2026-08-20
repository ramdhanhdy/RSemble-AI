// =============================================================================
// RSemble AI — ModelFilters — the eight `/models` browse filters (Fable §6.2).
//
// Exactly eight filters in spec order: Search, Provider, Model, Version
// status, Reasoning/tool signature, Evidence class, Family/facet, Recency.
// Desktop (lg+): always-visible 2-column grid inside a bordered panel,
// mirroring RunFilters. Mobile: collapsible sheet behind a toggle with an
// applied-count badge. The D1 "Latest activity" sort toggle is the only sort
// control and sits beside the filters; it is not counted among the eight.
//
// No new query semantics: the component is a controlled presentational surface
// over {@link ModelListUrlState}. Filter option lists are supplied by
// ModelsWorkspace from the catalog; version-status and recency are fixed
// vocabularies.
// =============================================================================

import { useState, type ChangeEvent, type ReactNode } from "react";
import { Filter, X } from "lucide-react";
import {
  countAppliedModelFilters,
  type ModelListUrlState,
  type ModelListSort,
} from "./models-url-state";

/** Dynamic option lists for the data-driven filters. Each is derived from the
 *  catalog by ModelsWorkspace so the filter semantics cannot diverge from the
 *  rendered rows. */
export interface ModelFiltersOptions {
  providers: { id: string; label: string }[];
  models: string[];
  signatures: string[];
  evidenceClasses: { id: string; label: string }[];
  families: { id: string; name: string }[];
}

const SELECT_CLASSES =
  "min-h-[44px] rounded-md border border-edge bg-canvas px-2 text-sm text-text focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Labeled filter select with a data-filter hook. The wrapping <label> keeps
 *  the accessible name; the data-filter attribute keeps the query hook used by
 *  ModelList tests. */
function FilterSelect({
  label,
  dataFilter,
  value,
  onChange,
  wrapperClassName = "",
  selectClassName = "",
  children,
}: {
  label: string;
  dataFilter: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  wrapperClassName?: string;
  selectClassName?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${wrapperClassName}`}>
      <span className="text-xs text-text-muted">{label}</span>
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

const VERSION_STATUS_OPTIONS = (
  <>
    <option value="">Any version status</option>
    <option value="exact">Exact version</option>
    <option value="rolling_alias">Rolling alias</option>
    <option value="partial">Partial identity</option>
  </>
);

const RECENCY_OPTIONS = (
  <>
    <option value="">Any time</option>
    <option value="7">Active last 7 days</option>
    <option value="30">Active last 30 days</option>
    <option value="90">Active last 90 days</option>
  </>
);

function providerOptions(providers: { id: string; label: string }[]) {
  return (
    <>
      <option value="">All providers</option>
      {providers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </>
  );
}

function modelOptions(models: string[]) {
  return (
    <>
      <option value="">All models</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </>
  );
}

function signatureOptions(signatures: string[]) {
  return (
    <>
      <option value="">Any signature</option>
      {signatures.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </>
  );
}

function evidenceClassOptions(classes: { id: string; label: string }[]) {
  return (
    <>
      <option value="">All evidence classes</option>
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </>
  );
}

function familyOptions(families: { id: string; name: string }[]) {
  return (
    <>
      <option value="">All families</option>
      {families.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </>
  );
}

/** The D1 sort toggle: the single optional "Latest activity" ordering. A
 *  pressed toggle switches sort from canonical identity (default) to latest
 *  activity. No aria-sort is emitted — this is not a sortable score column. */
function SortToggle({
  sort,
  onChange,
  wrapperClassName = "",
}: {
  sort: ModelListSort;
  onChange: (sort: ModelListSort) => void;
  wrapperClassName?: string;
}) {
  const active = sort === "latest";
  return (
    <label className={`flex flex-col gap-1 text-sm ${wrapperClassName}`}>
      <span className="text-xs text-text-muted">Sort</span>
      <button
        type="button"
        data-filter="sort"
        data-sort={sort}
        aria-pressed={active}
        aria-label="Toggle latest activity ordering"
        onClick={() => onChange(active ? "canonical" : "latest")}
        className={`${SELECT_CLASSES} justify-center text-left ${
          active ? "border-accent/60 text-accent" : "text-text-secondary"
        }`}
      >
        {active ? "Latest activity" : "Canonical identity"}
      </button>
    </label>
  );
}

export interface ModelFiltersProps {
  value: ModelListUrlState;
  onChange: (next: ModelListUrlState) => void;
  options: ModelFiltersOptions;
}

export function ModelFilters({ value, onChange, options }: ModelFiltersProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const applied = countAppliedModelFilters(value);
  const hasAny = value.search.trim().length > 0 || applied > 0;

  function update(patch: Partial<ModelListUrlState>) {
    // Any filter change resets to page 1 — a new filter set is a new complete
    // set, never a mid-page jump.
    onChange({ ...value, ...patch, page: 1 });
  }

  function clearAll() {
    onChange({ ...value, search: "", provider: "", model: "", versionStatus: "", signature: "", evidenceClass: "", family: "", recency: "", page: 1 });
  }

  const desktopGrid = (
    <div data-desktop-filters className="hidden grid-cols-2 gap-2 lg:grid">
      <FilterSelect
        label="Provider"
        dataFilter="provider"
        value={value.provider}
        onChange={(e) => update({ provider: e.target.value })}
        wrapperClassName="col-span-2"
        selectClassName="w-full min-w-0"
      >
        {providerOptions(options.providers)}
      </FilterSelect>
      <FilterSelect
        label="Model"
        dataFilter="model"
        value={value.model}
        onChange={(e) => update({ model: e.target.value })}
        wrapperClassName="col-span-2"
        selectClassName="w-full min-w-0"
      >
        {modelOptions(options.models)}
      </FilterSelect>
      <FilterSelect
        label="Version status"
        dataFilter="versionStatus"
        value={value.versionStatus}
        onChange={(e) =>
          update({
            versionStatus: e.target.value as ModelListUrlState["versionStatus"],
          })
        }
        selectClassName="w-full min-w-0"
      >
        {VERSION_STATUS_OPTIONS}
      </FilterSelect>
      <FilterSelect
        label="Reasoning/tool signature"
        dataFilter="signature"
        value={value.signature}
        onChange={(e) => update({ signature: e.target.value })}
        selectClassName="w-full min-w-0"
      >
        {signatureOptions(options.signatures)}
      </FilterSelect>
      <FilterSelect
        label="Evidence class"
        dataFilter="evidenceClass"
        value={value.evidenceClass}
        onChange={(e) => update({ evidenceClass: e.target.value })}
        selectClassName="w-full min-w-0"
      >
        {evidenceClassOptions(options.evidenceClasses)}
      </FilterSelect>
      <FilterSelect
        label="Family/facet"
        dataFilter="family"
        value={value.family}
        onChange={(e) => update({ family: e.target.value })}
        selectClassName="w-full min-w-0"
      >
        {familyOptions(options.families)}
      </FilterSelect>
      <FilterSelect
        label="Recency"
        dataFilter="recency"
        value={value.recency}
        onChange={(e) =>
          update({ recency: e.target.value as ModelListUrlState["recency"] })
        }
        selectClassName="w-full min-w-0"
      >
        {RECENCY_OPTIONS}
      </FilterSelect>
      <SortToggle
        sort={value.sort}
        onChange={(sort) => update({ sort })}
        wrapperClassName="col-span-2"
      />
    </div>
  );

  const sheetBody = (
    <div
      data-filter-sheet
      className="flex flex-wrap items-end gap-2 rounded-md border border-edge bg-panel p-3 overflow-x-hidden min-w-0 lg:hidden"
    >
      <FilterSelect
        label="Provider"
        dataFilter="provider"
        value={value.provider}
        onChange={(e) => update({ provider: e.target.value })}
        wrapperClassName="w-full min-w-0"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {providerOptions(options.providers)}
      </FilterSelect>
      <FilterSelect
        label="Model"
        dataFilter="model"
        value={value.model}
        onChange={(e) => update({ model: e.target.value })}
        wrapperClassName="w-full min-w-0"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {modelOptions(options.models)}
      </FilterSelect>
      <FilterSelect
        label="Version status"
        dataFilter="versionStatus"
        value={value.versionStatus}
        onChange={(e) =>
          update({
            versionStatus: e.target.value as ModelListUrlState["versionStatus"],
          })
        }
        wrapperClassName="min-w-0 flex-1 basis-[calc(50%-0.25rem)]"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {VERSION_STATUS_OPTIONS}
      </FilterSelect>
      <FilterSelect
        label="Reasoning/tool signature"
        dataFilter="signature"
        value={value.signature}
        onChange={(e) => update({ signature: e.target.value })}
        wrapperClassName="min-w-0 flex-1 basis-[calc(50%-0.25rem)]"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {signatureOptions(options.signatures)}
      </FilterSelect>
      <FilterSelect
        label="Evidence class"
        dataFilter="evidenceClass"
        value={value.evidenceClass}
        onChange={(e) => update({ evidenceClass: e.target.value })}
        wrapperClassName="min-w-0 flex-1 basis-[calc(50%-0.25rem)]"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {evidenceClassOptions(options.evidenceClasses)}
      </FilterSelect>
      <FilterSelect
        label="Family/facet"
        dataFilter="family"
        value={value.family}
        onChange={(e) => update({ family: e.target.value })}
        wrapperClassName="min-w-0 flex-1 basis-[calc(50%-0.25rem)]"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {familyOptions(options.families)}
      </FilterSelect>
      <FilterSelect
        label="Recency"
        dataFilter="recency"
        value={value.recency}
        onChange={(e) =>
          update({ recency: e.target.value as ModelListUrlState["recency"] })
        }
        wrapperClassName="w-full min-w-0"
        selectClassName="w-full min-w-0 max-w-full"
      >
        {RECENCY_OPTIONS}
      </FilterSelect>
      <SortToggle
        sort={value.sort}
        onChange={(sort) => update({ sort })}
        wrapperClassName="w-full min-w-0"
      />
      <button
        type="button"
        data-action="clear-filters"
        onClick={clearAll}
        className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X size={14} aria-hidden="true" />
        Clear filters
      </button>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="search"
          aria-label="Search model configurations"
          data-filter="search"
          placeholder="Search id, slug, or provider…"
          value={value.search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update({ search: e.target.value })}
          className="min-h-[44px] flex-1 rounded-md border border-edge bg-panel px-3 text-sm text-text placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {hasAny && (
          <button
            type="button"
            data-action="clear-filters"
            aria-label="Clear search and filters"
            onClick={clearAll}
            className="hidden min-h-[44px] shrink-0 items-center gap-1 rounded-md px-2 text-xs text-text-muted transition-colors duration-150 hover:bg-raised hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"
          >
            <X size={13} aria-hidden="true" />
            Clear
          </button>
        )}
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
            <span
              data-applied-count={applied}
              className="flex min-w-[20px] items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs text-accent tabular-nums"
            >
              {applied}
            </span>
          )}
        </button>
      </div>
      {desktopGrid}
      {sheetOpen && sheetBody}
    </div>
  );
}
