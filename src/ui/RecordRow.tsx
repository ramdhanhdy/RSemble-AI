// =============================================================================
// RecordRow — shared compact record row family (spec §6.3).
//
// Used by Runs rows, Compare recent-run rows, suite experiment-history rows,
// and task-attempt rows. Two variants:
//   - "list": a full-width row (div or anchor)
//   - "table-cell": a <td> cell pair for table layouts
//
// Slots cover status token, primary title, exact/relative timestamp, winner
// or score summary, model count, provenance, and trailing action.
// =============================================================================

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { StatusMark, type StatusMarkStatus } from "./StatusMark";

export interface RecordRowProps {
  variant: "list" | "table-cell";
  id: string;
  title: string;
  status: StatusMarkStatus;
  timestamp: number;
  summary?: string;
  modelCount?: number;
  source?: string;
  provenance?: string;
  /** Optional identity slot rendered first on the title line (list variant),
   *  e.g. a KindEyebrow naming the entity kind (identity spec §5.4). */
  kind?: ReactNode;
  /** Optional node rendered after the summary text on the meta line,
   *  e.g. a ProfileRefChip or latest-experiment mark (identity spec §5.4). */
  afterSummary?: ReactNode;
  /** When provided, the list variant renders as a link. */
  href?: string;
  /** Trailing action slot (buttons, menus, etc.). */
  children?: ReactNode;
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function Inner({
  title,
  status,
  timestamp,
  summary,
  modelCount,
  source,
  provenance,
  kind,
  afterSummary,
}: Omit<RecordRowProps, "variant" | "id" | "href" | "children">) {
  return (
    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
      <span className="flex w-full min-w-0 items-center gap-2">
        {kind}
        <StatusMark status={status} />
        <span className="truncate font-mono text-sm text-text">{title}</span>
      </span>
      {/* The meta line indents under the title (past the status glyph) only
          when no kind eyebrow is present; with an eyebrow the left edge is
          the row's anchor, so the meta line aligns flush to it.
          Below sm the line wraps (Task 14 mobile finding): the afterSummary
          cluster and the ml-auto models/time cluster are both shrink-0, so
          at phone widths the time cluster would overshoot the card edge —
          wrapping drops it to a second meta line instead of clipping. */}
      <span
        className={`flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-text-muted tabular-nums ${
          kind ? "" : "pl-[21px]"
        }`}
      >
        {summary && (
          <span className="min-w-0 truncate" title={summary}>
            {summary}
          </span>
        )}
        {afterSummary && <span className="flex shrink-0 items-center gap-1">{afterSummary}</span>}
        {provenance && <span className="hidden min-w-0 truncate sm:inline">{provenance}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {modelCount != null && <span>{modelCount} models</span>}
          {source && <span className="uppercase">{source}</span>}
          <span>{formatRelativeTime(timestamp)}</span>
        </span>
      </span>
    </span>
  );
}

export function RecordRow(props: RecordRowProps) {
  const { variant, id, href, children, ...rest } = props;

  if (variant === "table-cell") {
    return (
      <>
        <td data-record-row="" className="px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <StatusMark status={rest.status} />
            <span className="truncate font-mono text-text">{rest.title}</span>
          </div>
        </td>
        <td className="px-3 py-2 text-sm text-text-muted tabular-nums">
          {rest.modelCount != null && <span>{rest.modelCount} models</span>}
        </td>
        <td className="px-3 py-2 text-sm text-text-muted tabular-nums">
          {rest.source && <span className="uppercase">{rest.source}</span>}
        </td>
        <td className="px-3 py-2 text-sm text-text-muted tabular-nums">
          {formatRelativeTime(rest.timestamp)}
        </td>
        <td className="px-3 py-2 text-sm">{children}</td>
      </>
    );
  }

  // list variant
  // The painted child (link or div) carries the width contract — flex-1 + min-w-0
  // so it fills the wrapper while long titles truncate instead of expanding the
  // row (spec §12.2 row geometry; Task 13).
  const className =
    "flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 text-sm transition-colors duration-150 hover:border-edge-bright";

  const inner = <Inner {...rest} />;

  return (
    <div data-record-row="" className="flex items-center gap-2 text-sm">
      {href ? (
        <Link
          to={href}
          data-record-row-surface=""
          className={className}
          aria-label={`Run: ${rest.title}`}
        >
          {inner}
        </Link>
      ) : (
        <div data-record-row-surface="" className={className}>
          {inner}
        </div>
      )}
      {children && <div className="flex items-center">{children}</div>}
    </div>
  );
}
