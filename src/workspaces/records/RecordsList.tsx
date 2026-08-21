import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, GitCompare, History } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { RecordsRepository } from "../../lib/records/records-repository";
import type { RecordsPage, RecordsQuery } from "../../lib/records/records-query";
import type { RecordType } from "../../lib/records/record-reference";
import { RecordTypeRow } from "../../ui/RecordTypeRow";
import { RecordsFilters, EMPTY_RECORDS_FILTERS, type RecordsFiltersValue } from "./RecordsFilters";

const DEBOUNCE_MS = 200;
const PAGE_SIZE = 50;

const EMPTY_PAGE: RecordsPage = { items: [], total: 0, offset: 0, limit: PAGE_SIZE };

export function RecordsList({
  repository,
  selected,
  initialFilters = EMPTY_RECORDS_FILTERS,
  onFiltersChange,
}: {
  repository: RecordsRepository | null;
  selected: { recordType: RecordType; id: string } | null;
  initialFilters?: RecordsFiltersValue;
  onFiltersChange?: (filters: RecordsFiltersValue) => void;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [debouncedText, setDebouncedText] = useState(initialFilters.text);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [page, setPage] = useState<RecordsPage>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestId = useRef(0);
  const committedText = useRef(initialFilters.text);
  const filterRootRef = useRef<HTMLDivElement | null>(null);
  // "Find record by ID…" below 1024 lands here with ?focus=search (§G.7):
  // focus the search field once, then strip the param so refresh/back stay
  // clean.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("focus") !== "search") return;
    filterRootRef.current?.querySelector<HTMLInputElement>('input[data-filter="search"]')?.focus();
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only handoff
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (committedText.current === filters.text) return;
      committedText.current = filters.text;
      setDebouncedText(filters.text);
      setVisibleCount(PAGE_SIZE);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters.text]);

  const query = useMemo<RecordsQuery>(
    () => ({
      text: debouncedText || undefined,
      type: filters.type || undefined,
      modelKey: filters.modelKey || undefined,
      status: filters.status || undefined,
      mode: filters.mode || undefined,
      source: filters.source || undefined,
      limit: Math.max(PAGE_SIZE * 4, visibleCount + PAGE_SIZE),
      offset: 0,
    }),
    [
      debouncedText,
      filters.type,
      filters.modelKey,
      filters.status,
      filters.mode,
      filters.source,
      visibleCount,
    ],
  );

  useEffect(() => {
    const currentRequest = ++requestId.current;
    if (!repository) {
      setPage(EMPTY_PAGE);
      setLoading(false);
      setError("Records storage is unavailable.");
      return;
    }
    setLoading(true);
    setError(null);
    void repository
      .list(query)
      .then((nextPage) => {
        if (requestId.current === currentRequest) setPage(nextPage);
      })
      .catch((reason: unknown) => {
        if (requestId.current !== currentRequest) return;
        setError(reason instanceof Error ? reason.message : "Unknown storage error");
      })
      .finally(() => {
        if (requestId.current === currentRequest) setLoading(false);
      });
  }, [repository, query, reloadToken]);

  function updateFilters(next: RecordsFiltersValue) {
    if (
      next.type !== filters.type ||
      next.modelKey !== filters.modelKey ||
      next.status !== filters.status ||
      next.mode !== filters.mode ||
      next.source !== filters.source
    ) {
      setVisibleCount(PAGE_SIZE);
    }
    setFilters(next);
    onFiltersChange?.(next);
  }

  const modelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const reference of page.items) {
      for (const modelKey of reference.modelKeys) keys.add(modelKey);
    }
    return [...keys].sort();
  }, [page.items]);
  const hasActiveQuery = Boolean(
    debouncedText ||
    filters.type ||
    filters.modelKey ||
    filters.status ||
    filters.mode ||
    filters.source,
  );
  const visible = page.items.slice(0, visibleCount);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Records
          </p>
          <h1 className="text-lg font-semibold text-text">Records</h1>
        </div>
        <p className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
          {page.total} {page.total === 1 ? "record" : "records"}
        </p>
      </header>

      <div ref={filterRootRef}>
        <RecordsFilters value={filters} onChange={updateFilters} modelKeys={modelKeys} />
      </div>

      {loading && page.items.length === 0 ? (
        <div data-records-loading="" className="flex flex-col gap-2" aria-label="Loading records">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="animate-pulse-ease h-[76px] rounded-md border border-edge bg-raised opacity-60"
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
          <AlertCircle size={18} className="text-error" aria-hidden="true" />
          <p className="text-sm font-medium text-error">Failed to load records.</p>
          <p className="text-sm text-text-muted">{error}</p>
          <button
            type="button"
            onClick={() => setReloadToken((token) => token + 1)}
            className="motion-state mt-1 min-h-[44px] rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry
          </button>
        </div>
      ) : page.total === 0 && !hasActiveQuery ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 p-4 text-center">
          <History size={28} className="text-text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-text-secondary">No records yet.</p>
          <p className="max-w-sm text-sm text-text-muted">
            Run a comparison or an evaluation — its exact record appears here automatically.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Link
              to="/compare"
              className="motion-state flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <GitCompare size={15} aria-hidden="true" />
              Compare
            </Link>
            <Link
              to="/evaluations"
              className="motion-state flex min-h-[44px] items-center rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Evaluations
            </Link>
          </div>
          <p className="honesty-note mt-1 text-[11px] text-text-secondary">
            Records preserve exact execution provenance. Meaningful results live in Compare,
            Evaluations, Lab, and Models.
          </p>
        </div>
      ) : page.total === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="text-sm text-text-secondary">No records match the current filters.</p>
          <button
            type="button"
            onClick={() => updateFilters(EMPTY_RECORDS_FILTERS)}
            className="motion-state min-h-[44px] rounded-md border border-edge px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-1" role="list" aria-label="Records">
          {visible.map((reference) => (
            <li key={`${reference.recordType}:${reference.id}`}>
              <RecordTypeRow
                reference={reference}
                selected={
                  selected?.recordType === reference.recordType && selected.id === reference.id
                }
              />
            </li>
          ))}
        </ul>
      )}

      {page.total > visibleCount && (
        <button
          type="button"
          data-action="load-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          className="motion-state flex min-h-[44px] items-center justify-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Load more ({page.total - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
