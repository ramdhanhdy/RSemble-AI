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
  /** When provided, the list variant renders as a link. */
  href?: string;
  /** Trailing action slot (buttons, menus, etc.). */
  children?: ReactNode;
}

function formatRelativeTime(ts: number): string {
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
}: Omit<RecordRowProps, "variant" | "id" | "href" | "children">) {
  return (
    <>
      <StatusMark status={status} />
      <span className="truncate font-mono text-sm text-text">{title}</span>
      <span className="ml-auto flex items-center gap-3 text-sm text-text-muted tabular-nums">
        {provenance && <span className="hidden sm:inline">{provenance}</span>}
        {modelCount != null && <span>{modelCount} models</span>}
        {source && <span className="uppercase">{source}</span>}
        {summary && <span className="hidden md:inline">{summary}</span>}
        <span>{formatRelativeTime(timestamp)}</span>
      </span>
    </>
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
        <td className="px-3 py-2 text-sm">
          {children}
        </td>
      </>
    );
  }

  // list variant
  const className =
    "flex min-h-[44px] items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 text-sm transition-colors duration-150 hover:border-edge-bright";

  const inner = (
    <Inner {...rest} />
  );

  return (
    <div data-record-row="" className="flex items-center gap-2 text-sm">
      {href ? (
        <Link
          to={href}
          className={className}
          aria-label={`Run: ${rest.title}`}
        >
          {inner}
        </Link>
      ) : (
        <div className={className}>
          {inner}
        </div>
      )}
      {children && <div className="flex items-center">{children}</div>}
    </div>
  );
}
