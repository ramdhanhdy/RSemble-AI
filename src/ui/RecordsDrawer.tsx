// =============================================================================
// RecordsDrawer — quick secondary Records access at >=1024px (Child 08 §H).
//
// Right-anchored 400px panel on the DrawerSurface dialog authority (focus
// trap, inert background, Escape, focus restore inherited — never
// reimplemented). Five workspace groups (non-empty only), five most-recent
// rows per group pre-search, safe search preserving grouping with an EXACT
// MATCH section, and a View-all footer with the ledger-scope honesty note.
//
// Read-only by construction: the drawer queries the accepted Wave 1 typed
// read model (RecordsRepository.list + queryRecords — no second indexing
// system) and renders rows and links only. It performs no execution, export,
// or archive actions, adds no execution controls, and adds no live region
// beyond one role="status" result count while searching (§H.5).
// =============================================================================

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertCircle, History, Search, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useRecordsRepository } from "../lib/persistence/repository-context";
import type { RecordsRepository } from "../lib/records/records-repository";
import { queryRecords, type RecordsPage } from "../lib/records/records-query";
import type { RecordReference } from "../lib/records/record-reference";
import { HONESTY_COPY } from "./honesty-copy";
import { RecordTypeRow } from "./RecordTypeRow";
import { DrawerSurface } from "./DialogSurface";

const DEBOUNCE_MS = 200;
const GROUP_CAP = 5;
/** One bounded read of the full deterministic stream; grouping/caps happen
 *  below. The repository composes sources per call — this stays a single
 *  typed read, not a second index. */
const FULL_STREAM_LIMIT = 1_000_000;

type DrawerGroupKey = "compare" | "evaluations" | "lab" | "observations" | "legacy";

const DRAWER_GROUPS: readonly { key: DrawerGroupKey; heading: string }[] = [
  { key: "compare", heading: "From Compare" },
  { key: "evaluations", heading: "From Evaluations" },
  { key: "lab", heading: "From the Lab" },
  { key: "observations", heading: "Observations" },
  { key: "legacy", heading: "Legacy & Imported" },
];

/** Workspace groups, not type groups (§H.2): rows inside one group may carry
 *  different type eyebrows; the eyebrow carries type identity. */
function groupOf(reference: RecordReference): DrawerGroupKey {
  // Task executions group by their resolved execution source.
  if (reference.recordType === "task-execution") {
    if (reference.runSource.kind === "policy-study") return "lab";
    if (reference.runSource.kind === "experiment") return "evaluations";
    return "compare";
  }
  switch (reference.recordType) {
    case "comparison":
      return "compare";
    case "evaluation":
      return "evaluations";
    case "policy-study":
      return "lab";
    case "observation":
      return "observations";
    case "legacy":
    default:
      return "legacy";
  }
}

function groupReferences(
  references: readonly RecordReference[],
  cap: number | null,
): { key: DrawerGroupKey; heading: string; items: RecordReference[] }[] {
  const buckets = new Map<DrawerGroupKey, RecordReference[]>();
  for (const reference of references) {
    const key = groupOf(reference);
    const bucket = buckets.get(key);
    if (cap !== null && (bucket?.length ?? 0) >= cap) continue;
    if (!bucket) buckets.set(key, [reference]);
    else bucket.push(reference);
  }
  return DRAWER_GROUPS.filter((group) => (buckets.get(group.key)?.length ?? 0) > 0).map(
    (group) => ({ ...group, items: buckets.get(group.key)! }),
  );
}

export function RecordsDrawer({
  open,
  onOpenChange,
  repository = null,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults to the context repository; injectable for tests. */
  repository?: RecordsRepository | null;
  /** Return-focus target handed to the Base UI primitive (the header
   *  trigger, which lives outside this portal). */
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const contextRepository = useRecordsRepository();
  const repo = repository ?? contextRepository;
  const location = useLocation();

  const [references, setReferences] = useState<RecordReference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const requestId = useRef(0);

  // The drawer closes on navigation (§H.2): any route change while open
  // dismisses it — rows, View all, and palette-driven navigation included.
  const lastPathname = useRef(location.pathname);
  useEffect(() => {
    if (lastPathname.current !== location.pathname) {
      lastPathname.current = location.pathname;
      if (open) onOpenChange(false);
    }
  }, [location.pathname, open, onOpenChange]);

  // Fresh read per open; the ledger is device-local and cheap to re-derive.
  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    setReferences(null);
    setError(null);
    // A missing repository must surface the bounded error grammar, never an
    // endless skeleton (repo?.list() would never settle).
    if (!repo) {
      setError("The records repository is unavailable.");
      return;
    }
    repo
      .list({ limit: FULL_STREAM_LIMIT })
      .then((page) => {
        if (requestId.current === id) setReferences(page.items);
      })
      .catch((reason: unknown) => {
        if (requestId.current === id) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
  }, [open, repo, reloadToken]);

  // 200ms debounce, matching the full utility's search (§H.2).
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setDebouncedText(text.trim().toLowerCase()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, open]);

  useEffect(() => {
    if (!open) {
      setText("");
      setDebouncedText("");
    }
  }, [open]);

  const searching = debouncedText.length > 0;
  const page: RecordsPage | null = useMemo(() => {
    if (references === null) return null;
    // Evaluate the complete already-loaded bounded stream: pre-search
    // grouping needs every record to find the newest five per workspace
    // group, and search promises all matches (the queryRecords default is
    // 50).
    return queryRecords(references, {
      text: searching ? debouncedText : undefined,
      limit: FULL_STREAM_LIMIT,
    });
  }, [references, searching, debouncedText]);

  const exactHits =
    page !== null && searching
      ? page.items.filter((reference) => reference.id.toLowerCase() === debouncedText)
      : [];
  // An exact hit promoted into EXACT MATCH must not render a second time
  // inside its workspace group below.
  const grouped =
    page === null
      ? []
      : groupReferences(
          page.items.filter((reference) => !exactHits.includes(reference)),
          searching ? null : GROUP_CAP,
        );
  // §H.4 keyboard contract: ↓/↑ move between record actions (each row's
  // main anchor is one stop, a trailing Exact sibling link the next); ↑
  // from the first stop returns to search; Enter activates (native anchor
  // behavior, made deterministic). Escape stays owned by the Base UI
  // dialog; Tab order and focus trapping are untouched. The handler rides
  // the stops themselves — Base UI's focus manager stops keydown
  // propagation above the popup, so document-level delegation never fires.
  const searchRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  function drawerNavStops(): HTMLElement[] {
    return [
      ...(bodyRef.current?.querySelectorAll<HTMLElement>(
        "a[data-record-row-link], a[data-exact-link]",
      ) ?? []),
    ];
  }
  function onSearchKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const stops = drawerNavStops();
    if (stops.length === 0) return;
    (event.key === "ArrowDown" ? stops[0] : stops[stops.length - 1]).focus();
  }
  function onStopKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const stops = drawerNavStops();
    const index = stops.indexOf(event.currentTarget);
    if (index === -1) return;
    event.preventDefault();
    if (event.key === "ArrowDown") {
      stops[index + 1]?.focus();
    } else {
      const previous = stops[index - 1];
      if (previous) previous.focus();
      else searchRef.current?.focus();
    }
  }
  return (
    <DrawerSurface open={open} onOpenChange={onOpenChange} title="Records" finalFocus={finalFocus}>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-edge px-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Records
        </span>
        <h2 className="text-[15px] font-semibold text-text">Records</h2>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close records"
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-card hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="shrink-0 border-b border-edge p-3">
        <label className="block">
          <span className="sr-only">Search records</span>
          <span className="relative block">
            <Search
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              id="records-drawer-search"
              ref={searchRef}
              data-drawer-search=""
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search exact ID or safe metadata…"
              className="min-h-[44px] w-full rounded-md border border-edge bg-canvas pl-9 pr-3 font-mono text-[13px] text-text placeholder:font-sans placeholder:text-text-muted focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </span>
        </label>
      </div>

      <div
        role="region"
        aria-label="Recent records"
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 scroll-thin"
      >
        {references === null && error === null ? (
          <div data-drawer-loading="" className="flex flex-col gap-2" aria-label="Loading records">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="animate-pulse-ease h-[64px] rounded-md border border-edge bg-raised opacity-60"
              />
            ))}
          </div>
        ) : error !== null ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-error/30 bg-error/[0.06] p-3">
            <span className="flex items-center gap-2 text-sm font-medium text-error">
              <AlertCircle size={16} aria-hidden="true" />
              Records index unavailable.
            </span>
            <p className="break-words text-xs text-text-muted">{error}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-action="retry-records-index"
                onClick={() => setReloadToken((token) => token + 1)}
                className="motion-state min-h-[44px] rounded-md border border-edge px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Retry
              </button>
              <Link
                to="/records"
                data-action="open-full-records"
                className="motion-state flex min-h-[44px] items-center rounded-md border border-edge px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open full records
              </Link>
            </div>
          </div>
        ) : page !== null && page.total === 0 && !searching ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <History size={28} className="text-text-muted" aria-hidden="true" />
            <p className="text-sm font-medium text-text-secondary">No records yet.</p>
            <p className="honesty-note text-[11px] text-text-secondary">
              Every comparison, evaluation, and study leaves an exact record here automatically.
            </p>
          </div>
        ) : page !== null && page.total === 0 && searching ? (
          <div className="flex flex-col items-start gap-2 p-3">
            <p className="text-sm text-text-secondary">No records match “{debouncedText}”.</p>
            <button
              type="button"
              data-action="clear-search"
              onClick={() => setText("")}
              className="motion-state min-h-[44px] rounded-md border border-edge px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {searching && page !== null && (
              <p role="status" className="font-mono text-xs tabular-nums text-text-muted">
                {page.total} matching {page.total === 1 ? "record" : "records"}
              </p>
            )}
            {exactHits.length > 0 && (
              <section data-drawer-group="">
                <h3
                  data-drawer-group-head=""
                  className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
                >
                  Exact Match
                </h3>
                <ul className="flex flex-col gap-1.5" role="list">
                  {exactHits.map((reference) => (
                    <li key={`${reference.recordType}:${reference.id}`}>
                      <RecordTypeRow
                        reference={reference}
                        compact
                        onRecordKeyDown={onStopKeyDown}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {grouped.map((group) => (
              <section key={group.key} data-drawer-group="">
                <h3
                  data-drawer-group-head=""
                  className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
                >
                  {group.heading}
                </h3>
                <ul className="flex flex-col gap-1.5" role="list">
                  {group.items.map((reference) => (
                    <li key={`${reference.recordType}:${reference.id}`}>
                      <RecordTypeRow
                        reference={reference}
                        compact
                        onRecordKeyDown={onStopKeyDown}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-edge p-3">
        <Link
          to="/records"
          data-action="view-all-records"
          className="motion-state flex min-h-[44px] items-center justify-center rounded-md border border-edge bg-panel text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          View all records →
        </Link>
        <p className="honesty-note text-[11px] text-text-secondary">{HONESTY_COPY.ledgerScope}</p>
      </div>
    </DrawerSurface>
  );
}
