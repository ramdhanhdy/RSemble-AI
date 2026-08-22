// =============================================================================
// RSemble AI — Previous comparisons list (spec §6.1)
//
// Child 05 (Contextual Compare Results) Milestone C — Task 5.
//
// Displays searchable, filterable, and paginated comparison history over the
// ComparisonResultIndex read model. Rows are semantic result links to
// /compare/results/:id, not inert entities or raw Runs.
//
// Features:
//  - New comparison and Previous comparisons sections
//  - Complete-set filtering before pagination (title text, model, status, mode,
//    Task binding, date)
//  - Reactive repository subscription
//  - Explicit loading, error, empty, and zero-match states
//  - Interrupted / recoverable rows linking to their owning result recovery action
//  - 390px mobile usable layout
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, GitCompare, Loader2, Plus, RotateCcw } from "lucide-react";
import type {
  ComparisonListQuery,
  ComparisonRepository,
} from "../../lib/persistence/comparison-repository";
import type {
  ComparisonMode,
  ComparisonResultIndex,
} from "../../lib/compare/comparison-result-types";
import type { RunStatus } from "../../lib/persistence/run-types";
import { RecordRow } from "../../ui/RecordRow";
import { Pagination, PAGE_SIZE } from "../../ui/Pagination";
import {
  ComparisonFilters,
  EMPTY_COMPARISON_FILTERS,
  type ComparisonFiltersValue,
} from "./ComparisonFilters";

const DEBOUNCE_MS = 200;

export interface ComparisonListProps {
  repo: ComparisonRepository | null;
  selectedId?: string | null;
  /** Optional callback when user initiates a new comparison draft */
  onNewComparison?: () => void;
  /** Optional pre-discovered model keys to populate filter dropdown */
  modelKeys?: string[];
  className?: string;
}

function formatTaskBindingLabel(item: ComparisonResultIndex): string {
  if (item.taskBinding.kind === "ad_hoc") {
    return "Ad hoc · exploratory";
  }
  return `Task ${item.taskBinding.taskId} v${item.taskBinding.taskVersion}`;
}

function ModeChip({ mode }: { mode: ComparisonMode }) {
  const isRank = mode === "rank";
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] ${
        isRank ? "bg-accent/10 text-accent" : "bg-purple-500/10 text-purple-400"
      }`}
    >
      {mode}
    </span>
  );
}

export function ComparisonList({
  repo,
  selectedId,
  onNewComparison,
  modelKeys = [],
  className = "",
}: ComparisonListProps) {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<ComparisonFiltersValue>(EMPTY_COMPARISON_FILTERS);
  const [debouncedText, setDebouncedText] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ComparisonResultIndex[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const committedTextRef = useRef("");
  const debounceRef = useRef<number | undefined>(undefined);
  const requestIdRef = useRef(0);

  // Debounce search text
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (committedTextRef.current === filters.text) return;
      committedTextRef.current = filters.text;
      setDebouncedText(filters.text);
      setPage(1);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(debounceRef.current);
  }, [filters.text]);

  function handleFiltersChange(next: ComparisonFiltersValue) {
    if (
      next.modelKey !== filters.modelKey ||
      next.status !== filters.status ||
      next.mode !== filters.mode ||
      next.bindingKind !== filters.bindingKind ||
      next.taskId !== filters.taskId ||
      next.createdFrom !== filters.createdFrom ||
      next.createdTo !== filters.createdTo
    ) {
      setPage(1);
    }
    setFilters(next);
  }

  const hasActiveQuery = Boolean(
    debouncedText ||
    filters.modelKey ||
    filters.status ||
    filters.mode ||
    filters.bindingKind ||
    filters.taskId ||
    filters.createdFrom !== undefined ||
    filters.createdTo !== undefined,
  );

  const loadComparisons = useCallback(async () => {
    if (!repo) {
      setItems([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const currentReq = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      // Query without limit to get total count across the complete filtered set
      const baseQuery: ComparisonListQuery = {
        text: debouncedText || undefined,
        modelKey: filters.modelKey || undefined,
        status: (filters.status || undefined) as RunStatus | undefined,
        mode: (filters.mode || undefined) as ComparisonMode | undefined,
        bindingKind: (filters.bindingKind || undefined) as "ad_hoc" | "canonical" | undefined,
        taskId: filters.taskId || undefined,
        createdFrom: filters.createdFrom,
        createdTo: filters.createdTo,
      };

      const allMatches = await repo.listComparisonResults({
        ...baseQuery,
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
      });

      if (requestIdRef.current !== currentReq) return;

      setTotalCount(allMatches.length);

      const pagedItems = allMatches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      setItems(pagedItems);
      setLoading(false);
    } catch (err) {
      if (requestIdRef.current !== currentReq) return;
      setError(err instanceof Error ? err.message : "Failed to load comparisons");
      setLoading(false);
    }
  }, [repo, debouncedText, filters, page]);

  useEffect(() => {
    void loadComparisons();
  }, [loadComparisons]);

  // Subscribe to repository mutations
  useEffect(() => {
    if (!repo) return;
    return repo.subscribe(() => {
      void loadComparisons();
    });
  }, [repo, loadComparisons]);

  function handleNewComparisonClick() {
    if (onNewComparison) {
      onNewComparison();
    } else {
      void navigate("/compare");
    }
  }

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Header & New Comparison Action */}
      <div className="flex items-center justify-between gap-3 border-b border-edge pb-3">
        <div data-section="previous-comparisons" className="flex items-baseline gap-2">
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-text">
            Previous comparisons
          </h2>
          {totalCount > 0 && (
            <span className="text-xs text-text-muted tabular-nums">({totalCount})</span>
          )}
        </div>

        <button
          type="button"
          data-action="new-comparison"
          onClick={handleNewComparisonClick}
          className="pressable flex min-h-[36px] items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus size={14} aria-hidden="true" />
          <span>New comparison</span>
        </button>
      </div>

      {/* Search & Filters */}
      <ComparisonFilters value={filters} onChange={handleFiltersChange} modelKeys={modelKeys} />

      {/* Loading State */}
      {loading && items.length === 0 && (
        <div
          data-state="loading"
          className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-muted"
        >
          <Loader2 size={16} className="animate-spin-ease text-accent" aria-hidden="true" />
          <span>Loading comparisons…</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div
          data-state="error"
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center"
        >
          <AlertCircle size={18} className="text-error" aria-hidden="true" />
          <p className="text-sm font-medium text-error">Failed to load comparison history.</p>
          <p className="text-xs text-text-muted">{error}</p>
          <button
            type="button"
            data-action="retry-comparisons"
            onClick={() => void loadComparisons()}
            className="mt-2 flex min-h-[36px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-xs text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {/* Empty State (0 records in DB) */}
      {!loading && !error && items.length === 0 && !hasActiveQuery && (
        <div
          data-state="empty"
          className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-md border border-edge/60 bg-panel/40 p-6 text-center"
        >
          <GitCompare size={24} className="text-text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-text-secondary">No previous comparisons yet.</p>
          <p className="max-w-xs text-xs text-text-muted">
            Completed comparisons will appear here with full evidence and model rankings.
          </p>
          <button
            type="button"
            data-action="start-comparison"
            onClick={handleNewComparisonClick}
            className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-xs font-medium text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
          >
            <Plus size={14} aria-hidden="true" />
            Start comparison
          </button>
        </div>
      )}

      {/* No Match State (filters returned 0 results) */}
      {!loading && !error && items.length === 0 && hasActiveQuery && (
        <div
          data-state="no-match"
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-md border border-edge/60 bg-panel/40 p-4 text-center"
        >
          <p className="text-sm text-text-secondary">No matching comparisons.</p>
          <p className="text-xs text-text-muted">
            No comparisons match the current search or filters.
          </p>
          <button
            type="button"
            data-action="clear-empty-filters"
            onClick={() => {
              setFilters(EMPTY_COMPARISON_FILTERS);
              setDebouncedText("");
              setPage(1);
            }}
            className="mt-2 flex min-h-[36px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-xs text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
          >
            Clear search and filters
          </button>
        </div>
      )}

      {/* Comparison Items List */}
      {!loading && !error && items.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1.5" role="list">
            {items.map((item) => {
              const isSelected = item.id === selectedId;
              const bindingLabel = formatTaskBindingLabel(item);
              const obsCount = item.activeObservationIds?.length ?? 0;
              const isInterrupted = item.status === "interrupted";

              const summaryParts = [
                bindingLabel,
                obsCount > 0 ? `${obsCount} observations` : null,
                item.lineage?.repeatedFrom
                  ? `Repeated from ${item.lineage.repeatedFrom.slice(0, 8)}…`
                  : null,
                isInterrupted ? "Recoverable in Compare" : null,
              ].filter(Boolean);

              return (
                <li key={item.id}>
                  <div
                    data-selected={isSelected ? "true" : undefined}
                    className={`rounded-md transition-colors ${
                      isSelected ? "bg-raised shadow-[inset_2px_0_0_0_#00e5ff]" : ""
                    }`}
                  >
                    <RecordRow
                      variant="list"
                      id={item.id}
                      title={item.title || "Untitled comparison"}
                      status={item.status}
                      timestamp={item.createdAt}
                      kind={<ModeChip mode={item.mode} />}
                      summary={summaryParts.join(" · ")}
                      ariaCurrent={isSelected ? "true" : undefined}
                      href={`/compare/results/${item.id}`}
                    >
                      {isSelected && <span className="sr-only">Selected</span>}
                    </RecordRow>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="mt-2 border-t border-edge pt-3">
              <Pagination
                page={page}
                pageCount={pageCount}
                totalItems={totalCount}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
