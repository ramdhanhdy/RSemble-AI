import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { RecordReference } from "../lib/records/record-reference";
import { recordDetailHref, recordOpenHref } from "../lib/records/record-owner";
import { StatusMark } from "./StatusMark";
import { RecordTypeEyebrow, recordTypeLabel } from "./RecordTypeEyebrow";

function recordMeta(reference: RecordReference): string | null {
  const parts: string[] = [];
  if (reference.modelKeys.length === 1) parts.push(reference.modelKeys[0]!);
  if (reference.modelKeys.length > 1) parts.push(`${reference.modelKeys.length} models`);
  if (reference.mode) parts.push(reference.mode === "rank" ? "Rank" : "Fuse");
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function RecordTypeRow({
  reference,
  selected = false,
  compact = false,
}: {
  reference: RecordReference;
  selected?: boolean;
  compact?: boolean;
}) {
  const semantic =
    reference.recordType === "comparison" ||
    reference.recordType === "evaluation" ||
    reference.recordType === "policy-study";
  const meta = recordMeta(reference);
  const accessibleName = [recordTypeLabel(reference.recordType), reference.title, reference.status]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      data-record-row=""
      data-record-type={reference.recordType}
      data-record-id={reference.id}
      data-selected={selected || undefined}
      className={`flex min-w-0 items-stretch rounded-md border border-edge bg-panel hover:border-edge-bright ${
        selected ? "bg-raised shadow-[inset_2px_0_0_#00e5ff]" : ""
      }`}
    >
      <Link
        to={recordOpenHref(reference)}
        data-record-row-link=""
        aria-label={accessibleName}
        className="motion-state flex min-h-[44px] min-w-0 flex-1 flex-col gap-0.5 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="flex min-w-0 items-center gap-2">
          <RecordTypeEyebrow recordType={reference.recordType} />
          <span className="ml-auto flex shrink-0 items-center gap-2">
            {reference.status && <StatusMark status={reference.status} size={12} />}
            <time
              dateTime={new Date(reference.createdAt).toISOString()}
              className="font-mono text-[11px] tabular-nums text-text-muted"
            >
              {new Date(reference.createdAt).toLocaleDateString()}
            </time>
          </span>
        </span>
        <span className="truncate text-sm font-medium text-text" title={reference.title}>
          {reference.title}
        </span>
        {!compact && meta && (
          <span className="min-w-0 break-words font-mono text-xs text-text-muted">{meta}</span>
        )}
        <span className="min-w-0 break-words text-xs text-text-secondary">
          {reference.ownerHint}
        </span>
      </Link>
      {semantic && (
        <Link
          to={recordDetailHref(reference)}
          aria-label={`Open exact ${recordTypeLabel(reference.recordType)} record`}
          title="Open exact record"
          className="motion-state flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center border-l border-edge text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ExternalLink size={14} aria-hidden="true" />
          <span className="sr-only">Exact</span>
        </Link>
      )}
    </div>
  );
}
