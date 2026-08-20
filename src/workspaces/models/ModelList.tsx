// =============================================================================
// RSemble AI — ModelList — the `/models` exact-configuration rows (Fable §6.3).
//
// Each row is a list link to the (future) profile route `/models/:id`. The
// §6.3 anatomy is three text lines + three identity elements (KindEyebrow,
// VersionStatusChip, activity stamp) — densification cap §12.1. RecordRow's
// fixed two-line inner cannot express that anatomy nor a CompactModelLabel
// title (its `title` is a string), so the row mirrors RecordRow's list-link
// structure (Link + data-record-row + the same surface classes) directly.
//
// Coverage renders with HonestQuantity semantics (reused from the C1
// coverage-summary contract): available counts inline, "coverage unavailable"
// when a configuration has no observations, and the exploratory-only line for
// zero-qualified rows. No scores, no ranks, no aria-sort on any column.
//
// The Saved rollups section (§6.4) is a physically separate boundary-ruled
// block. The rollup repository arrives in Task 11; until then the section
// shows its empty state + purpose honesty note and no create affordance.
// =============================================================================

import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Boxes, Layers } from "lucide-react";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { Pagination, PAGE_SIZE } from "../../ui/Pagination";
import { formatRelativeTime } from "../../ui/RecordRow";
import { VersionStatusChip, type VersionStatus } from "./VersionStatusChip";
import type { HonestQuantity } from "../../lib/model-profiles/coverage-summary";
import type { ModelConfigurationCatalogEntry } from "../../lib/model-profiles/model-configuration-query";
import type { EvidenceClass, IdentityCompleteness } from "../../lib/evidence/evidence-types";
import type {
  ModelRollupRecord,
  ModelRollupVersion,
} from "../../lib/model-rollups/model-rollup-types";

const ROW_SURFACE_CLASS =
  "flex min-h-[44px] min-w-0 flex-1 flex-col gap-1 rounded-md border border-edge bg-panel px-3 py-2 text-sm transition-colors duration-150 hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Format an observed window as "Mon–Mon YYYY" (or "Mon YYYY" when the window
 *  sits inside one calendar month). Returns "window unavailable" when the
 *  catalog entry has no usable window. */
export function formatModelWindow(from: number, to: number): string {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "window unavailable";
  const f = new Date(from);
  const t = new Date(to);
  const fMon = MONTHS[f.getUTCMonth()] ?? "—";
  const tMon = MONTHS[t.getUTCMonth()] ?? "—";
  const fYear = f.getUTCFullYear();
  const tYear = t.getUTCFullYear();
  if (fYear === tYear && f.getUTCMonth() === t.getUTCMonth()) {
    return `${fMon} ${fYear}`;
  }
  if (fYear === tYear) {
    return `${fMon}–${tMon} ${fYear}`;
  }
  return `${fMon} ${fYear}–${tMon} ${tYear}`;
}

function completenessToVersionStatus(completeness: IdentityCompleteness): VersionStatus {
  if (completeness === "rolling_alias") return "rolling_alias";
  if (completeness === "partial") return "partial_identity";
  return "exact";
}

/** Derive the missing-dimension label for a partial-identity chip (§5.2). */
function missingDimensionFor(entry: ModelConfigurationCatalogEntry): string {
  if (entry.resolvedVersion === null) return "no resolved version";
  if (entry.resolvedModel === null) return "no resolved model";
  return "incomplete identity";
}

/** One enriched row: the catalog entry plus the per-configuration derivations
 *  the list row needs (distinct tasks, top families, gap count). These are
 *  simple aggregations over observations — not the profile coverage-summary
 *  machinery, which lives on the profile route. */
export interface ModelListRowData {
  entry: ModelConfigurationCatalogEntry;
  /** Distinct task ids observed for this configuration. */
  taskCount: number;
  /** Top covered family names (≤2), most-observed first. */
  topFamilyNames: string[];
  /** Full set of covered family IDs for this configuration (for filtering). */
  coveredFamilyIds?: string[];
  /** Full set of covered family names for this configuration (for filtering). */
  coveredFamilyNames?: string[];
  /** Actual set of evidence classes present for this configuration. */
  evidenceClasses?: EvidenceClass[];
  /** Count of families with no observations for this configuration
   *  (universe − observed). Negative when the universe is unknown. */
  gapCount: number;
}

/** Inline HonestQuantity rendering for a compact row meta line. Mirrors
 *  HonestValue's three states without the block layout — the row needs inline
 *  text, not labelled blocks. */
function honestInline(q: HonestQuantity): string {
  if (q.state === "available") return String(q.value);
  if (q.state === "limited") return String(q.value);
  return "Unavailable";
}

function taskQuantity(taskCount: number, hasObservations: boolean): HonestQuantity {
  if (!hasObservations) {
    return { state: "unavailable", reason: "No observations indexed to this configuration." };
  }
  return { state: "available", value: taskCount };
}

function eligibleQuantity(eligible: number, hasObservations: boolean): HonestQuantity {
  if (!hasObservations) {
    return { state: "unavailable", reason: "coverage unavailable" };
  }
  return { state: "available", value: eligible };
}

function ModelListRow({ row }: { row: ModelListRowData }) {
  const { entry, taskCount, topFamilyNames, gapCount } = row;
  const hasObservations = entry.observationCount > 0;
  const status = completenessToVersionStatus(entry.identityCompleteness);
  const windowText = formatModelWindow(entry.observedFrom, entry.observedTo);
  const tasks = taskQuantity(taskCount, hasObservations);
  const eligible = eligibleQuantity(entry.eligibleProfileEvidenceCount, hasObservations);
  const zeroQualified = entry.eligibleProfileEvidenceCount === 0;

  // Line 3 — families + gaps (cap: ≤2 family names, ≤1 gap count).
  const topPart = topFamilyNames.length > 0 ? `Top: ${topFamilyNames.join(", ")}` : "";
  const gapPart = gapCount > 0 ? `No evidence: ${gapCount} families` : "";
  const familiesLine = [topPart, gapPart].filter(Boolean).join(" · ");
  const familiesText = familiesLine || (hasObservations ? "families unavailable" : "No evidence");

  // Line 2 — window + coverage. Zero-qualified rows read the exploratory-only
  // line; rows with no observations read "coverage unavailable".
  let coverageLine: ReactNode;
  if (!hasObservations) {
    coverageLine = (
      <span data-honest-state="unavailable" className="text-text-muted">
        {windowText} · coverage unavailable
      </span>
    );
  } else if (zeroQualified) {
    coverageLine = (
      <span data-honest-state="available" className="text-text-muted">
        {windowText} · 0 eligible observations · exploratory only
      </span>
    );
  } else {
    coverageLine = (
      <span className="flex flex-wrap items-baseline gap-x-1 text-text-muted tabular-nums">
        <span data-window>{windowText}</span>
        <span aria-hidden="true">·</span>
        <span data-honest-state={tasks.state}>{honestInline(tasks)}</span>
        <span>tasks</span>
        <span aria-hidden="true">·</span>
        <span data-honest-state={eligible.state}>{honestInline(eligible)}</span>
        <span>eligible observations</span>
      </span>
    );
  }

  return (
    <div data-record-row="" className="flex items-center gap-2 text-sm">
      <Link
        to={`/models/${entry.modelConfigurationId}`}
        data-record-row-surface=""
        data-model-id={entry.modelConfigurationId}
        aria-label={`Model configuration ${entry.modelConfigurationId}`}
        className={ROW_SURFACE_CLASS}
      >
        {/* Identity elements row (cap: 3 — eyebrow, version chip, activity). */}
        <span className="flex w-full min-w-0 items-center gap-2">
          <KindEyebrow kind="model-configuration" />
          <VersionStatusChip
            status={status}
            window={status === "rolling_alias" ? windowText : undefined}
            missingDimension={
              status === "partial_identity" ? missingDimensionFor(entry) : undefined
            }
          />
          <span className="ml-auto font-mono text-xs text-text-muted tabular-nums">
            {formatRelativeTime(entry.latestActivity)}
          </span>
        </span>
        {/* Title — CompactModelLabel (non-interactive: nested inside a link). */}
        <span className="flex w-full min-w-0 items-center">
          <CompactModelLabel
            providerId={entry.providerId}
            slug={entry.requestedModel}
            interactive={false}
          />
        </span>
        {/* Line 2 — window + coverage (HonestValue semantics). */}
        {coverageLine}
        {/* Line 3 — families + gaps (≤2 names, ≤1 gap count). */}
        <span className="w-full min-w-0 text-text-muted" data-families-line>
          {familiesText}
        </span>
      </Link>
    </div>
  );
}

export interface ModelListProps {
  rows: ModelListRowData[];
  page: number;
  pageCount: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

/** Render the paginated exact-configuration rows. Pagination appears only when
 *  more than one page exists. */
export function ModelList({
  rows,
  page,
  pageCount,
  totalItems,
  onPageChange,
}: ModelListProps): ReactNode {
  return (
    <section data-model-list aria-label="Model configurations" className="flex flex-col gap-2">
      {rows.map((row) => (
        <ModelListRow key={row.entry.modelConfigurationId} row={row} />
      ))}
      {pageCount > 1 && (
        <Pagination
          page={page}
          pageCount={pageCount}
          totalItems={totalItems}
          onPageChange={onPageChange}
        />
      )}
    </section>
  );
}

export interface SavedRollupListItem {
  record: ModelRollupRecord;
  version: ModelRollupVersion;
}

export interface SavedRollupsSectionProps {
  items?: SavedRollupListItem[];
  memberOptions?: Array<{ id: string; label: string }>;
  onCreate?: (name: string, memberConfigurationIds: string[]) => Promise<void>;
}

/** Canonical Saved rollups list/create entry. Archived definitions remain
 * disclosed behind an explicit toggle; every row links to its pinned latest
 * immutable version. */
export function SavedRollupsSection({
  items = [],
  memberOptions = [],
  onCreate,
}: SavedRollupsSectionProps = {}): ReactNode {
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const archivedCount = items.filter((item) => item.record.archivedAt !== null).length;
  const visible = items.filter((item) => item.record.archivedAt === null || showArchived);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!onCreate || name.trim().length === 0 || members.length === 0) return;
    await onCreate(name.trim(), members);
    setName("");
    setMembers([]);
    setCreating(false);
  }

  return (
    <section data-saved-rollups aria-label="Saved rollups" className="mt-6 flex flex-col gap-2">
      <div className="boundary-rule flex items-center gap-2 border-t border-edge pt-3 text-xs font-mono uppercase tracking-[0.14em] text-text-muted">
        <Layers size={12} aria-hidden="true" />
        SAVED ROLLUPS — STRATIFIED ONLY
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="honesty-note text-xs text-text-muted">
          A rollup is a pinned list of exact configurations viewed side by side. It is not a model
          and never pools evidence.
        </p>
        {onCreate && memberOptions.length > 0 ? (
          <button type="button" className="pressable min-h-[44px] rounded-md border border-edge px-3 text-sm text-text" onClick={() => setCreating((open) => !open)}>
            Create rollup
          </button>
        ) : null}
      </div>
      {creating ? (
        <form data-rollup-create className="rounded-md border border-edge bg-panel p-3" onSubmit={(event) => void submit(event)}>
          <label className="text-sm text-text">Name<input className="mt-1 min-h-[44px] w-full rounded-md border border-edge bg-card px-3 text-text" value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <fieldset className="mt-3"><legend className="text-sm text-text">Exact configurations</legend>{memberOptions.map((option) => <label key={option.id} className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={members.includes(option.id)} onChange={(event) => setMembers((current) => event.target.checked ? [...current, option.id] : current.filter((id) => id !== option.id))} />{option.label}</label>)}</fieldset>
          <button type="submit" className="pressable mt-3 min-h-[44px] rounded-md bg-accent px-4 text-sm font-medium text-bg">Save pinned rollup</button>
        </form>
      ) : null}
      {visible.length === 0 ? (
        <div className="rounded-md border border-edge bg-panel px-3 py-4 text-sm text-text-muted">
          <p>No saved rollups.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(({ record, version }) => (
            <Link key={record.id} data-rollup-row data-archived={record.archivedAt !== null ? "" : undefined} className={ROW_SURFACE_CLASS} to={`/models/rollups/${encodeURIComponent(record.id)}/versions/${version.version}`}>
              <span className="flex items-center gap-2"><KindEyebrow kind="rollup" /><strong className="text-text">{version.name}</strong><span className="font-mono text-xs text-text-secondary">v{version.version}</span></span>
              <span className="text-xs text-text-secondary">{version.memberConfigurationIds.length} members · stratified only · created {formatModelWindow(version.createdAt, version.createdAt)}</span>
              {record.archivedAt !== null ? <span className="text-xs text-warning">Archived · read-only</span> : null}
            </Link>
          ))}
        </div>
      )}
      {archivedCount > 0 ? (
        <button type="button" className="pressable min-h-[44px] self-start rounded-md px-2 text-sm text-accent" onClick={() => setShowArchived((shown) => !shown)}>
          {showArchived ? "Hide archived" : `Show archived (${archivedCount})`}
        </button>
      ) : null}
    </section>
  );
}

/** First-use empty state (§6.5): no qualified model evidence yet. The Saved
 *  rollups section does not render alongside this. */
export function FirstUseState(): ReactNode {
  return (
    <div
      data-list-state="first-use"
      className="flex flex-col items-center gap-2 rounded-md border border-edge bg-panel px-4 py-10 text-center"
    >
      <Boxes size={28} className="text-text-muted" aria-hidden="true" />
      <p className="text-sm text-text">No qualified model evidence yet.</p>
      <p className="honesty-note text-xs text-text-muted">
        Models appears once canonical Observations pass eligibility. Run an Evaluation or Compare
        first.
      </p>
      <div className="mt-2 flex gap-2">
        <Link
          to="/evaluations"
          className="rounded-md border border-edge px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Evaluations
        </Link>
        <Link
          to="/compare"
          className="rounded-md border border-edge px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Compare
        </Link>
      </div>
    </div>
  );
}

/** Filters-zero-match state (§6.5): no configurations match the active
 *  filters, with a Clear filters action. */
export function ZeroMatchState({ onClear }: { onClear: () => void }): ReactNode {
  return (
    <div
      data-list-state="zero-match"
      className="flex flex-col items-center gap-2 rounded-md border border-edge bg-panel px-4 py-8 text-center"
    >
      <p className="text-sm text-text">No matching configurations.</p>
      <button
        type="button"
        data-action="clear-filters"
        onClick={onClear}
        className="mt-1 rounded-md border border-edge px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Clear filters
      </button>
    </div>
  );
}

/** Load-error state (§6.5): inline failure panel with Retry. */
export function LoadErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactNode {
  return (
    <div
      data-list-state="error"
      className="flex flex-col items-start gap-2 rounded-md border border-edge bg-panel px-4 py-4 text-sm"
    >
      <div className="flex items-center gap-2 text-text">
        <AlertCircle size={16} className="text-warning" aria-hidden="true" />
        <span>Failed to load configurations.</span>
      </div>
      {message && <p className="honesty-note text-xs text-text-muted">{message}</p>}
      <button
        type="button"
        data-action="retry"
        onClick={onRetry}
        className="rounded-md border border-edge px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Retry
      </button>
    </div>
  );
}

/** Convenience: total pages from a complete-set item count. */
export function pageCountFor(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / PAGE_SIZE));
}
