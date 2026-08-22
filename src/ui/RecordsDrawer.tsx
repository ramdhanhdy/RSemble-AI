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

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { AlertCircle, History, Search, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useRecordsRepository, useStorageRetry } from "../lib/persistence/repository-context";
import type { RecordsRepository } from "../lib/records/records-repository";
import { queryRecords, type RecordsPage } from "../lib/records/records-query";
import type { RecordReference } from "../lib/records/record-reference";
import { HONESTY_COPY } from "./honesty-copy";
import { RecordTypeRow } from "./RecordTypeRow";
import { DrawerSurface } from "./DialogSurface";

const DEBOUNCE_MS = 200;
const GROUP_CAP = 5;
const WINDOW_SIZE = 30;
const ROW_HEIGHT = 68;

type DrawerGroupKey = "compare" | "evaluations" | "lab" | "observations" | "legacy";

const DRAWER_GROUPS: readonly { key: DrawerGroupKey; heading: string }[] = [
  { key: "compare", heading: "From Compare" },
  { key: "evaluations", heading: "From Evaluations" },
  { key: "lab", heading: "From the Lab" },
  { key: "observations", heading: "Observations" },
  { key: "legacy", heading: "Legacy & Imported" },
];

interface DrawerSection {
  key: string;
  heading: string;
  items: RecordReference[];
}

interface LogicalStop {
  stopIndex: number;
  itemIndex: number;
  kind: "main" | "exact";
  reference: RecordReference;
}
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
  const storageRetry = useStorageRetry();
  const location = useLocation();

  const [references, setReferences] = useState<RecordReference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [text, setText] = useState("");
  const [debouncedText, setDebouncedText] = useState("");
  const requestId = useRef(0);

  // Dismissal differentiation (§P focus management): ordinary dismissal
  // restores the header trigger via finalFocus; a navigational dismissal
  // hands focus to the destination page instead, so the restoration target
  // is dropped before the dialog closes.
  const activeFinalFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && !suppressFinalFocus.current) {
      activeFinalFocus.current = finalFocus?.current ?? null;
    }
    if (!open) suppressFinalFocus.current = false;
  }, [open, finalFocus]);
  const suppressFinalFocus = useRef(false);
  function dismissByNavigation() {
    suppressFinalFocus.current = true;
    activeFinalFocus.current = null;
    if (open) onOpenChange(false);
  }

  // The drawer closes on navigation (§H.2). Route changes close it even
  // when the click came from outside the drawer (palette-driven nav);
  // same-path activations are closed by the link click-capture below.
  const lastPathname = useRef(location.pathname);
  useEffect(() => {
    if (lastPathname.current !== location.pathname) {
      lastPathname.current = location.pathname;
      dismissByNavigation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissal identity is stable per open cycle
  }, [location.pathname, open, onOpenChange]);

  // Any drawer link activation navigates — including to the current path —
  // so the drawer closes directly on the click itself.
  function onDrawerLinkClickCapture(event: React.MouseEvent) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("a")) dismissByNavigation();
  }

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
      .list()
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
    return queryRecords(references, {
      text: searching ? debouncedText : undefined,
    });
  }, [references, searching, debouncedText]);

  const sections = useMemo<DrawerSection[]>(() => {
    if (page === null) return [];
    const exactHits = searching
      ? page.items.filter((reference) => reference.id.toLowerCase() === debouncedText)
      : [];
    const grouped = groupReferences(
      page.items.filter((reference) => !exactHits.includes(reference)),
      searching ? null : GROUP_CAP,
    );
    const list: DrawerSection[] = [];
    if (exactHits.length > 0) {
      list.push({ key: "exact", heading: "Exact Match", items: exactHits });
    }
    for (const group of grouped) {
      list.push({ key: group.key, heading: group.heading, items: group.items });
    }
    return list;
  }, [page, searching, debouncedText]);

  const flatItems = useMemo<
    Array<{ reference: RecordReference; sectionKey: string; sectionHeading: string }>
  >(() => {
    const result: Array<{
      reference: RecordReference;
      sectionKey: string;
      sectionHeading: string;
    }> = [];
    for (const section of sections) {
      for (const item of section.items) {
        result.push({
          reference: item,
          sectionKey: section.key,
          sectionHeading: section.heading,
        });
      }
    }
    return result;
  }, [sections]);

  const logicalStops = useMemo<LogicalStop[]>(() => {
    const stops: LogicalStop[] = [];
    for (let i = 0; i < flatItems.length; i++) {
      const item = flatItems[i]!;
      stops.push({
        stopIndex: stops.length,
        itemIndex: i,
        kind: "main",
        reference: item.reference,
      });
      const semantic =
        item.reference.recordType === "comparison" ||
        item.reference.recordType === "evaluation" ||
        item.reference.recordType === "policy-study";
      if (semantic) {
        stops.push({
          stopIndex: stops.length,
          itemIndex: i,
          kind: "exact",
          reference: item.reference,
        });
      }
    }
    return stops;
  }, [flatItems]);

  const [scrollTop, setScrollTop] = useState(0);
  const [targetStop, setTargetStop] = useState<number | null>(null);

  const onBodyScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const totalItemsCount = flatItems.length;
  const startIndex = searching
    ? Math.max(
        0,
        Math.min(
          Math.floor(scrollTop / ROW_HEIGHT) - 5,
          Math.max(0, totalItemsCount - WINDOW_SIZE),
        ),
      )
    : 0;
  const endIndex = searching
    ? Math.min(totalItemsCount, startIndex + WINDOW_SIZE)
    : totalItemsCount;

  const topSpacerHeight = searching ? startIndex * ROW_HEIGHT : 0;
  const bottomSpacerHeight = searching ? (totalItemsCount - endIndex) * ROW_HEIGHT : 0;

  const windowedSections = useMemo<DrawerSection[]>(() => {
    if (!searching) return sections;
    if (flatItems.length === 0) return [];
    const slice = flatItems.slice(startIndex, endIndex);
    const bySection = new Map<string, DrawerSection>();
    for (const entry of slice) {
      let s = bySection.get(entry.sectionKey);
      if (!s) {
        s = { key: entry.sectionKey, heading: entry.sectionHeading, items: [] };
        bySection.set(entry.sectionKey, s);
      }
      s.items.push(entry.reference);
    }
    return [...bySection.values()];
  }, [searching, sections, flatItems, startIndex, endIndex]);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (targetStop === null) return;
    const stop = logicalStops[targetStop];
    if (!stop) return;
    const selector =
      stop.kind === "exact"
        ? `[data-record-type="${stop.reference.recordType}"][data-record-id="${stop.reference.id}"] a[data-exact-link]`
        : `[data-record-type="${stop.reference.recordType}"][data-record-id="${stop.reference.id}"] a[data-record-row-link]`;
    const el = bodyRef.current?.querySelector<HTMLElement>(selector);
    if (el) {
      el.focus();
    }
  }, [targetStop, logicalStops, windowedSections]);

  function navigateToStop(index: number) {
    if (index < 0) {
      setTargetStop(null);
      searchRef.current?.focus();
      return;
    }
    if (index >= logicalStops.length) return;
    setTargetStop(index);
    const stop = logicalStops[index];
    if (stop) {
      const itemIndex = stop.itemIndex;
      if (searching && (itemIndex < startIndex || itemIndex >= endIndex)) {
        if (bodyRef.current) {
          bodyRef.current.scrollTop = itemIndex * ROW_HEIGHT;
        }
      }
      const selector =
        stop.kind === "exact"
          ? `[data-record-type="${stop.reference.recordType}"][data-record-id="${stop.reference.id}"] a[data-exact-link]`
          : `[data-record-type="${stop.reference.recordType}"][data-record-id="${stop.reference.id}"] a[data-record-row-link]`;
      const el = bodyRef.current?.querySelector<HTMLElement>(selector);
      if (el) {
        el.focus();
      }
    }
  }

  function onSearchKeyDown(event: React.KeyboardEvent) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (logicalStops.length === 0) return;
    event.preventDefault();
    if (event.key === "ArrowDown") {
      navigateToStop(0);
    } else {
      navigateToStop(logicalStops.length - 1);
    }
  }

  function onStopKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const isExact = event.currentTarget.hasAttribute("data-exact-link");
    const row = event.currentTarget.closest<HTMLElement>("[data-record-row]");
    const recordId = row?.getAttribute("data-record-id");
    const recordType = row?.getAttribute("data-record-type");
    const currentStopIndex = logicalStops.findIndex(
      (s) =>
        s.reference.id === recordId &&
        s.reference.recordType === recordType &&
        (isExact ? s.kind === "exact" : s.kind === "main"),
    );
    if (currentStopIndex === -1) return;
    if (event.key === "ArrowDown") {
      navigateToStop(currentStopIndex + 1);
    } else {
      navigateToStop(currentStopIndex - 1);
    }
  }
  return (
    <DrawerSurface
      open={open}
      onOpenChange={onOpenChange}
      title="Records"
      finalFocus={activeFinalFocus}
    >
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
        onScroll={searching ? onBodyScroll : undefined}
        onClickCapture={onDrawerLinkClickCapture}
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
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-md border border-error/30 bg-error/[0.06] p-3"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-error">
              <AlertCircle size={16} aria-hidden="true" />
              Records index unavailable.
            </span>
            <p className="break-words text-xs text-text-muted">{error}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-action="retry-records-index"
                onClick={() => {
                  if (!repo) storageRetry();
                  else setReloadToken((token) => token + 1);
                }}
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
            {topSpacerHeight > 0 && (
              <div style={{ height: topSpacerHeight }} aria-hidden="true" />
            )}
            {windowedSections.map((group) => (
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
            {bottomSpacerHeight > 0 && (
              <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
            )}
          </>
        )}
      </div>

      <div
        className="flex shrink-0 flex-col gap-2 border-t border-edge p-3"
        onClickCapture={onDrawerLinkClickCapture}
      >
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
