// =============================================================================
// RunList — searchable, filterable run history list (spec §8.2).
//
// Uses useRunList hook for async repository queries. Rows render as links to
// /runs/:runId via RecordRow. Search debounces before updating the query.
// Filters combine across the complete result set before pagination.
// =============================================================================

import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { GitCompare, AlertCircle, Loader2 } from "lucide-react";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type { RunStatus } from "../../lib/persistence/run-types";
import { formatCandidateScoreDisplay } from "../../lib/evaluations/evaluation-profile";
import { useRunList } from "./useRunList";
import { formatRunRow } from "./run-view-model";
import { RecordRow } from "../../ui/RecordRow";
import { RunFilters, EMPTY_FILTERS, type RunFiltersValue } from "./RunFilters";

const DEBOUNCE_MS = 200;
const PAGE_SIZE = 50;

/** Per-source tint classes for the identity chip (transplant map §D3).
 *  Matches the prototype's source-label treatment: ad hoc = accent cyan,
 *  experiment = warning amber, legacy = muted gray. Rendered via RecordRow's
 *  `kind` slot so RecordRow's shared signature and other consumers are
 *  untouched. Slice 2. */
const SOURCE_CHIP_CLASSES: Record<string, string> = {
  "ad hoc": "bg-accent/10 text-accent",
  experiment: "bg-warning/10 text-warning",
  legacy: "bg-white/[0.06] text-text-muted",
};

function SourceChip({ label }: { label: string }) {
  const cls = SOURCE_CHIP_CLASSES[label] ?? "bg-white/[0.06] text-text-muted";
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] ${cls}`}
    >
      {label}
    </span>
  );
}

export function RunList({
  repo,
  selectedId,
}: {
  repo: RunRepository | null;
  selectedId: string | null;
}) {
  const [filters, setFilters] = useState<RunFiltersValue>(EMPTY_FILTERS);
  const [debouncedText, setDebouncedText] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const debounceRef = useRef<number | undefined>(undefined);
  // Debounce search text
  useEffect(() => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      setDebouncedText(filters.text);
      setVisibleCount(PAGE_SIZE); // reset pagination on new search
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(debounceRef.current);
  }, [filters.text]);

  const query = useMemo(
    () => ({
      text: debouncedText || undefined,
      modelKey: filters.modelKey || undefined,
      status: (filters.status || undefined) as RunStatus | undefined,
      mode: (filters.mode || undefined) as "rank" | "fuse" | undefined,
      source: (filters.source || undefined) as "adhoc" | "experiment" | "legacy" | undefined,
      limit: PAGE_SIZE * 4, // fetch enough for pagination + filter preview
      offset: 0,
    }),
    [debouncedText, filters.modelKey, filters.status, filters.mode, filters.source],
  );

  const { summaries, loading, error } = useRunList(repo, query);

  // Collect all model keys for the filter dropdown
  const modelKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of summaries) {
      for (const k of s.modelKeys) set.add(k);
    }
    return [...set].sort();
  }, [summaries]);

  // Paginate visible rows
  const visible = summaries.slice(0, visibleCount);
  const hasMore = summaries.length > visibleCount;

  // --- States ---

  if (loading && summaries.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading runs…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">Failed to load run history.</p>
        <p className="text-sm text-text-muted">{error}</p>
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm text-text-secondary">No run history yet.</p>
        <p className="text-sm text-text-muted">
          Completed runs will appear here with full evidence.
        </p>
        <Link
          to="/compare"
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          <GitCompare size={15} aria-hidden="true" />
          Go to Compare
        </Link>
      </div>
    );
  }

  // --- List ---
  return (
    <div className="flex flex-col gap-2">
      <RunFilters value={filters} onChange={setFilters} modelKeys={modelKeys} />

      {visible.length === 0 && debouncedText && (
        <p className="py-4 text-center text-sm text-text-muted">No matching runs.</p>
      )}

      <ul className="flex flex-col" role="list">
        {visible.map((summary) => {
          const vm = formatRunRow(summary);
          const isSelected = vm.id === selectedId;
          return (
            <li key={vm.id}>
              {/* Runs-scoped selected treatment: prototype's raised bg + 2px
                  left accent (Slice 2 / §D1). RecordRow inside is unchanged;
                  the accent sits on the wrapper via box-shadow so it does not
                  disturb RecordRow's own border/box geometry. */}
              <div
                data-selected={isSelected}
                className={`px-2 py-0.5 ${
                  isSelected ? "bg-raised shadow-[inset_2px_0_0_0_#00e5ff]" : ""
                }`}
              >
                <RecordRow
                  variant="list"
                  id={vm.id}
                  title={vm.taskTitle}
                  status={vm.status ?? "completed"}
                  timestamp={vm.timestampMs}
                  modelCount={vm.modelCount}
                  kind={<SourceChip label={vm.sourceLabel} />}
                  ariaCurrent={isSelected ? "true" : undefined}
                  summary={
                    [
                      vm.winnerKeys.length > 0 ? `Winner: ${vm.winnerKeys.join(", ")}` : null,
                      vm.topScore != null
                        ? `Score: ${formatCandidateScoreDisplay(vm.topScore, vm.scoreDomain)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  href={`/runs/${vm.id}`}
                >
                  {isSelected && <span className="sr-only">Selected</span>}
                </RecordRow>
              </div>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button
          type="button"
          data-action="load-more"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="flex min-h-[44px] items-center justify-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Load more ({summaries.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
