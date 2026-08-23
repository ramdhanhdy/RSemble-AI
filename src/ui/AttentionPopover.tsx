import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { ATTENTION_REASON_COPY, type AttentionItem } from "../lib/attention/attention-types";
import type { AttentionQueryResult } from "../lib/attention/attention-query";

export function formatAttentionAge(occurredAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - occurredAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function actionLabel(item: AttentionItem): string {
  if (item.kind === "evaluation_recovery") return "Repair evaluation";
  if (item.kind === "comparison_recovery") return "Open comparison";
  return "Open";
}

export function AttentionPopover({
  snapshot,
  now = Date.now(),
}: {
  snapshot: AttentionQueryResult;
  now?: number;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    dialog?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (snapshot.total === 0) return null;

  const countLabel = snapshot.overflowLabel ?? String(snapshot.total);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-attention-trigger
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Attention, ${countLabel} items`}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Bell size={15} aria-hidden="true" />
        <span>{countLabel}</span>
      </button>
      {open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-attention-dialog
          className="fixed inset-x-0 bottom-0 z-40 max-h-[70vh] overflow-auto border border-edge bg-shell p-3 shadow-lg md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-80 md:rounded-md"
        >
          <h2 id={titleId} className="mb-2 text-sm font-semibold text-text">
            Needs attention
          </h2>
          <ul className="flex flex-col gap-2">
            {snapshot.visible.map((row) => (
              <li key={row.key}>
                <Link
                  to={row.ownerHref}
                  data-attention-item
                  className="block rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text hover:border-edge-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  onClick={() => setOpen(false)}
                >
                  <div className="font-medium">{ATTENTION_REASON_COPY[row.reasonCode].label}</div>
                  <div className="text-xs text-text-secondary">
                    <time dateTime={new Date(row.occurredAt).toISOString()} title={new Date(row.occurredAt).toISOString()}>
                      {formatAttentionAge(row.occurredAt, now)}
                    </time>
                    {" · "}
                    {actionLabel(row)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {snapshot.total > 5 ? (
            <Link
              to="/attention"
              data-attention-view-all
              className="mt-3 block min-h-[44px] px-1 py-2 text-sm text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              onClick={() => setOpen(false)}
            >
              View all attention
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
