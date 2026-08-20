// =============================================================================
// EvidenceTable — Section 6: observations table (Fable §7.6).
//
// Always present. A contained-scroll, paginated (50/page) table with sticky
// header. Columns: Observation, Task, Family, Outcome, Evidence class,
// Eligibility, Observed, Source. Quick-tabs: All · Supporting · Contradicting ·
// Recent (D8, aria-pressed segmented control). Narrowing chips render above the
// table. At ≤390px the table becomes an ObservationCard list.
//
// Renders emitted backend shapes; computes no aggregates, intervals, or claims.
// =============================================================================

import { useMemo, useState, type ReactNode } from "react";
import { Pagination, PAGE_SIZE } from "../../ui/Pagination";
import { NarrowingChipBar, type NarrowingChip } from "./NarrowingChipBar";
import { ObservationCard } from "./ObservationCard";
import type { Narrowing } from "./useNarrowing";

export type EvidenceQuickTab = "all" | "supporting" | "contradicting" | "recent";

export interface EvidenceTableRow {
  observationId: string;
  taskId: string;
  taskName?: string;
  version: number;
  instanceId: string;
  familyId?: string;
  familyName?: string;
  outcome: string;
  evidenceClass: string;
  eligibility: string;
  eligibilityReason?: string;
  observedDate: string;
  sourceKind: string;
  /** Whether this row supports the profile claims. */
  supporting?: boolean;
  /** Whether this row contradicts the profile claims. */
  contradicting?: boolean;
}

interface EvidenceTableProps {
  rows: readonly EvidenceTableRow[];
  /** Active narrowings to display as chips. */
  narrowings?: readonly Narrowing[];
  /** Called when a narrowing chip is removed. */
  onRemoveNarrowing?: (key: string) => void;
  /** Called when all narrowings are cleared. */
  onClearAllNarrowings?: () => void;
  /** Called when a row is clicked (drilldown). */
  onRowClick?: (observationId: string) => void;
}

const TABS: { key: EvidenceQuickTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "supporting", label: "Supporting" },
  { key: "contradicting", label: "Contradicting" },
  { key: "recent", label: "Recent" },
];

const SCROLL_CLASS =
  "scroll-thin max-w-full overflow-x-auto rounded-md border border-edge focus:outline-none focus:ring-2 focus:ring-accent";

function narrowChips(narrowings: readonly Narrowing[]): NarrowingChip[] {
  return narrowings.map((n) => ({ key: n.key, label: n.label }));
}

export function EvidenceTable({
  rows,
  narrowings,
  onRemoveNarrowing,
  onClearAllNarrowings,
  onRowClick,
}: EvidenceTableProps): ReactNode {
  const [tab, setTab] = useState<EvidenceQuickTab>("all");
  const [page, setPage] = useState(1);

  // Filter by tab.
  const filtered = useMemo(() => {
    if (tab === "all") return rows;
    if (tab === "supporting") return rows.filter((r) => r.supporting);
    if (tab === "contradicting") return rows.filter((r) => r.contradicting);
    // recent: sort by observedDate desc (most recent first)
    return [...rows].sort(
      (a, b) => b.observedDate.localeCompare(a.observedDate),
    );
  }, [rows, tab]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const hasNarrowings = narrowings && narrowings.length > 0;

  return (
    <section data-section="evidence-table" aria-labelledby="evidence-heading">
      <h2
        id="evidence-heading"
        tabIndex={-1}
        className="text-base font-semibold text-text outline-none"
      >
        Observations
      </h2>

      {/* Narrowing chip bar */}
      {hasNarrowings && (
        <div className="mt-2">
          <NarrowingChipBar
            chips={narrowChips(narrowings!)}
            onRemove={(key) => onRemoveNarrowing?.(key)}
            onClearAll={() => onClearAllNarrowings?.()}
          />
        </div>
      )}

      {/* Quick-tabs (D8) */}
      <div
        data-quick-tabs
        role="group"
        aria-label="Evidence filter tabs"
        className="mt-3 flex gap-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            data-quick-tab={t.key}
            aria-pressed={tab === t.key}
            className={`pressable rounded-sm px-3 py-1 text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${
              tab === t.key
                ? "bg-accent/15 text-accent"
                : "text-text-secondary hover:text-text"
            }`}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table / card list */}
      <div className="mt-3">
        {/* Desktop: contained-scroll table (hidden below 390px via CSS) */}
        <div
          className={`hidden min-[391px]:block ${SCROLL_CLASS}`}
          role="region"
          aria-label="Evidence observations — scrollable"
          tabIndex={0}
        >
          <table data-evidence-table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge">
                <th className="sticky left-0 bg-panel px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Observation
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Task
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Family
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Outcome
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Evidence class
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Eligibility
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Observed
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-text-secondary">
                  Source
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={row.observationId}
                  data-evidence-row={row.observationId}
                  className="border-b border-edge last:border-b-0"
                >
                  <td className="sticky left-0 bg-panel px-3 py-2">
                    <button
                      type="button"
                      className="pressable font-mono text-xs text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      onClick={() => onRowClick?.(row.observationId)}
                    >
                      {row.observationId}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-text">
                    {row.taskName ?? row.taskId}
                    {row.version > 0 && ` · v${row.version}`}
                    {row.instanceId && ` · ${row.instanceId}`}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.familyName ?? row.familyId ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-text">{row.outcome}</td>
                  <td className="px-3 py-2">
                    <span
                      data-evidence-class={row.evidenceClass}
                      className="text-xs text-text-secondary"
                    >
                      {row.evidenceClass}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.eligibility}
                    {row.eligibilityReason && ` · ${row.eligibilityReason}`}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {row.observedDate}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.sourceKind}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: ObservationCard list (visible below 391px) */}
        <div className="min-[391px]:hidden space-y-2">
          {pageRows.map((row) => (
            <button
              key={row.observationId}
              type="button"
              className="w-full text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              onClick={() => onRowClick?.(row.observationId)}
            >
              <ObservationCard
                observationId={row.observationId}
                task={row.taskName ?? row.taskId}
                version={row.version}
                instance={row.instanceId}
                eligibility={row.eligibility}
                evidenceClass={row.evidenceClass}
                source={row.sourceKind}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="mt-3">
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            totalItems={filtered.length}
            onPageChange={setPage}
          />
        </div>
      )}
    </section>
  );
}
