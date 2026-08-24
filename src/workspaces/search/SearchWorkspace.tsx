// =============================================================================
// RSemble AI — Full Search Workspace (spec §2, §7)
//
// Fast, local-only, cross-entity search surface covering:
//  - Tasks, Task Sets, Rubrics, Comparisons, Evaluations, Fusion Studies,
//    Model Configurations, Model Rollups, Observations, and Records.
//
// Properties:
//  - Local lexical ranking (exact ID > title prefix > tokens).
//  - Type filtering without coercion.
//  - URL search params synchronization (?q=...&type=...).
//  - Bounded pagination (at most 100 rows rendered at once).
//  - Navigation only (no execution, retry, or provider calls).
//  - Zero secrets in rendered outputs.
// =============================================================================

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  BarChart3,
  Cpu,
  Eye,
  FileText,
  FlaskConical,
  GitCompare,
  History,
  Layers,
  ListChecks,
  Loader2,
  Search,
  TestTubes,
  X,
} from "lucide-react";
import { SEARCH_DOCUMENT_TYPES, type SearchDocumentType } from "../../lib/search/search-types";
import type { SearchHit, SearchPage } from "../../lib/search/search-query";
import type { SearchIndexRepository } from "../../lib/persistence/search-index-repository";
import { verifyAndRepairHit, type SearchSourceResolver } from "../../lib/search/search-reindex";
const PAGE_SIZE = 100;

export const SEARCH_TYPE_LABELS: Record<SearchDocumentType, string> = {
  task: "Tasks",
  task_set: "Task Sets",
  rubric: "Rubrics",
  comparison: "Comparisons",
  evaluation: "Evaluations",
  fusion_study: "Fusion Studies",
  model_configuration: "Model Configurations",
  model_rollup: "Model Rollups",
  observation: "Observations",
  record: "Records",
};

export const SEARCH_TYPE_SINGULAR_LABELS: Record<SearchDocumentType, string> = {
  task: "Task",
  task_set: "Task Set",
  rubric: "Rubric",
  comparison: "Comparison",
  evaluation: "Evaluation",
  fusion_study: "Fusion Study",
  model_configuration: "Model Config",
  model_rollup: "Model Rollup",
  observation: "Observation",
  record: "Record",
};

export const SEARCH_TYPE_ICONS: Record<SearchDocumentType, typeof ListChecks> = {
  task: ListChecks,
  task_set: Layers,
  rubric: FileText,
  comparison: GitCompare,
  evaluation: FlaskConical,
  fusion_study: TestTubes,
  model_configuration: Cpu,
  model_rollup: BarChart3,
  observation: Eye,
  record: History,
};

function isValidSearchType(v: string | null): v is SearchDocumentType {
  return v !== null && (SEARCH_DOCUMENT_TYPES as readonly string[]).includes(v);
}

export interface SearchWorkspaceProps {
  searchRepo?: SearchIndexRepository | null;
  resolver?: SearchSourceResolver | null;
  onNavigate?: (href: string) => void;
}

export function SearchWorkspace({ searchRepo, resolver, onNavigate }: SearchWorkspaceProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  const rawType = searchParams.get("type");
  const urlType: SearchDocumentType | "" = isValidSearchType(rawType) ? rawType : "";

  const [queryInput, setQueryInput] = useState(urlQuery);
  const [activeType, setActiveType] = useState<SearchDocumentType | "">(urlType);
  const [pageOffset, setPageOffset] = useState(0);

  const [page, setPage] = useState<SearchPage | null>(null);
  const [allTypesPage, setAllTypesPage] = useState<SearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state from URL
  useEffect(() => {
    setQueryInput(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    setActiveType(urlType);
  }, [urlType]);

  // Update URL helper
  const updateUrl = (nextQuery: string, nextType: SearchDocumentType | "") => {
    const params: Record<string, string> = {};
    if (nextQuery.trim()) {
      params.q = nextQuery.trim();
    }
    if (nextType) {
      params.type = nextType;
    }
    setSearchParams(params, { replace: true });
  };

  // Perform search query
  useEffect(() => {
    const trimmed = queryInput.trim();
    if (!trimmed || !searchRepo) {
      setPage(null);
      setAllTypesPage(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Fetch filtered results
    const fetchFiltered = searchRepo.search({
      text: trimmed,
      type: activeType ? activeType : undefined,
      limit: PAGE_SIZE,
      offset: pageOffset,
    });

    // Fetch all-types result for tab counts if filtered
    const fetchAll = activeType
      ? searchRepo.search({
          text: trimmed,
          limit: 1000,
        })
      : fetchFiltered;

    Promise.all([fetchFiltered, fetchAll])
      .then(([filteredResult, allResult]) => {
        if (cancelled) return;
        setPage(filteredResult);
        setAllTypesPage(allResult);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPage(null);
        setAllTypesPage(null);
        setLoading(false);
        setError(err instanceof Error ? err.message : "Search query failed.");
      });

    return () => {
      cancelled = true;
    };
  }, [queryInput, activeType, pageOffset, searchRepo]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setQueryInput(next);
    setPageOffset(0);
    updateUrl(next, activeType);
  };

  const handleClear = () => {
    setQueryInput("");
    setPageOffset(0);
    updateUrl("", activeType);
  };

  const handleTypeSelect = (type: SearchDocumentType | "") => {
    setActiveType(type);
    setPageOffset(0);
    updateUrl(queryInput, type);
  };

  // Calculate group counts
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (allTypesPage) {
      for (const group of allTypesPage.groups) {
        counts[group.type] = group.count;
      }
    }
    return counts;
  }, [allTypesPage]);

  const totalHits = allTypesPage ? allTypesPage.total : 0;
  const filteredHits = page ? page.items : [];
  const currentTotal = page ? page.total : 0;
  const totalPages = Math.ceil(currentTotal / PAGE_SIZE) || 1;
  const currentPage = Math.floor(pageOffset / PAGE_SIZE) + 1;

  const handleSelectHit = async (e: React.MouseEvent, doc: SearchHit["document"]) => {
    e.preventDefault();
    if (searchRepo && resolver) {
      try {
        const result = await verifyAndRepairHit(
          { type: doc.type, id: doc.id, revision: doc.revision },
          { searchRepo, resolver },
        );
        if (result.status === "removed") {
          setPage((prev) => {
            if (!prev) return null;
            const items = prev.items.filter(
              (i) => !(i.document.type === doc.type && i.document.id === doc.id),
            );
            return {
              ...prev,
              items,
              total: Math.max(0, prev.total - 1),
            };
          });
          setAllTypesPage((prev) => {
            if (!prev) return null;
            const items = prev.items.filter(
              (i) => !(i.document.type === doc.type && i.document.id === doc.id),
            );
            return {
              ...prev,
              items,
              total: Math.max(0, prev.total - 1),
            };
          });
          return;
        }
        const targetHref = result.status === "repaired" ? result.document.ownerHref : doc.ownerHref;
        if (onNavigate) {
          onNavigate(targetHref);
        } else {
          await navigate(targetHref);
        }
        return;
      } catch {
        // Fallback
      }
    }
    if (onNavigate) {
      onNavigate(doc.ownerHref);
    } else {
      await navigate(doc.ownerHref);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      {/* Header & Title */}
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-text">Search</h1>
        <p className="text-sm text-text-secondary">
          Fast local cross-entity search across tasks, task sets, rubrics, comparisons, evaluations,
          fusion studies, models, observations, and records.
        </p>
      </header>

      {/* Search Input Bar */}
      <div role="search" className="relative flex items-center">
        <Search size={18} className="pointer-events-none absolute left-4 text-text-secondary" />
        <input
          type="search"
          value={queryInput}
          onChange={handleInputChange}
          placeholder="Search by exact ID, title prefix, or tokens…"
          aria-label="Search"
          className="min-h-[48px] w-full rounded-lg border border-edge bg-raised pl-11 pr-12 text-sm text-text placeholder-text-secondary shadow-sm transition-colors focus:border-edge-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {queryInput && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
            className="absolute right-3 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Type Filter Pills */}
      {queryInput.trim().length > 0 && (
        <nav aria-label="Entity type filters" className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-type-filter="all"
            onClick={() => handleTypeSelect("")}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              activeType === ""
                ? "bg-accent/15 text-accent border border-accent/30"
                : "border border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text"
            }`}
          >
            <span>All</span>
            {totalHits > 0 && (
              <span className="rounded-full bg-card px-1.5 py-0.2 font-mono text-[11px]">
                {totalHits}
              </span>
            )}
          </button>

          {SEARCH_DOCUMENT_TYPES.map((type) => {
            const count = groupCounts[type] ?? 0;
            const Icon = SEARCH_TYPE_ICONS[type];
            const isSelected = activeType === type;
            return (
              <button
                key={type}
                type="button"
                data-type-filter={type}
                onClick={() => handleTypeSelect(type)}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isSelected
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "border border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text"
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span>{SEARCH_TYPE_LABELS[type]}</span>
                {count > 0 && (
                  <span className="rounded-full bg-card px-1.5 py-0.2 font-mono text-[11px]">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* Main Results Body */}
      {loading ? (
        <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-text-secondary">
          <Loader2 size={18} className="animate-spin text-accent" />
          <span>Searching index…</span>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error"
        >
          <div className="font-semibold">Search failed</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : !queryInput.trim() ? (
        <section className="rounded-xl border border-edge bg-panel p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-raised text-text-secondary">
            <Search size={22} />
          </div>
          <h2 className="mt-4 text-base font-semibold text-text">
            Search across workbench entities
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-text-secondary">
            Enter a query to find tasks, task sets, rubrics, comparisons, evaluations, fusion
            studies, model configs, rollups, observations, and records.
          </p>
        </section>
      ) : filteredHits.length === 0 ? (
        <section className="rounded-xl border border-edge bg-panel p-8 text-center">
          <h2 className="text-base font-semibold text-text">
            No results found for &ldquo;{queryInput.trim()}&rdquo;
          </h2>
          <p className="mt-1 text-xs text-text-secondary">
            {activeType
              ? `No ${SEARCH_TYPE_LABELS[activeType]} matched your query. Try selecting 'All' or adjusting your search terms.`
              : "No workbench entities matched your query. Check the spelling or search by exact entity ID."}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1 text-xs text-text-secondary">
            <span>
              Showing {pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, currentTotal)} of{" "}
              {currentTotal} {currentTotal === 1 ? "result" : "results"}
              {activeType && ` in ${SEARCH_TYPE_LABELS[activeType]}`}
            </span>
            {totalPages > 1 && (
              <span>
                Page {currentPage} of {totalPages}
              </span>
            )}
          </div>

          <ul className="flex flex-col gap-2.5" role="list">
            {filteredHits.map((hit: SearchHit) => {
              const doc = hit.document;
              const Icon = SEARCH_TYPE_ICONS[doc.type] ?? Search;
              const singularLabel = SEARCH_TYPE_SINGULAR_LABELS[doc.type] ?? doc.type;
              return (
                <li key={`${doc.type}-${doc.id}`} data-search-hit data-hit-type={doc.type}>
                  <Link
                    to={doc.ownerHref}
                    onClick={(e) => handleSelectHit(e, doc)}
                    className="group flex min-h-[48px] flex-col justify-between gap-2.5 rounded-lg border border-edge bg-raised p-3.5 transition-colors hover:border-edge-bright hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-edge bg-panel text-text-secondary group-hover:text-text">
                        <Icon size={15} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-text group-hover:text-accent">
                            {doc.title}
                          </span>
                          <span className="rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-text-secondary">
                            {singularLabel}
                          </span>
                        </div>
                        {doc.subtitle && (
                          <p className="mt-0.5 truncate text-xs text-text-secondary">
                            {doc.subtitle}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                      <span className="rounded border border-edge bg-card px-2 py-0.5 font-mono text-xs text-text-secondary">
                        {doc.id}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-edge pt-4">
              <button
                type="button"
                disabled={pageOffset === 0}
                onClick={() => setPageOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
                className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3.5 py-1.5 text-xs font-medium text-text transition-colors hover:border-edge-bright disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Previous
              </button>
              <span className="text-xs text-text-secondary">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPageOffset((prev) => prev + PAGE_SIZE)}
                className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3.5 py-1.5 text-xs font-medium text-text transition-colors hover:border-edge-bright disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
