// =============================================================================
// AttachmentChips — per-attachment cards under the task input (plan 7.5.3).
//
// One card per attachment: thumbnail (object URL) or kind icon, sanitized
// middle-ellipsized name, size/status line, and a Remove button. A single
// aria-live="polite" region announces status changes (spec §8.2) — visible,
// because picker rejections must be user-visible, not just spoken (spec §3.1).
// =============================================================================

import { FileCode2, FileText, FileType2, ImageIcon, X, RotateCcw } from "lucide-react";
import type { Attachment } from "../lib/attachments/types";
import { formatBytes } from "../lib/attachments/limits";
import type { AttachmentNotice } from "./useAttachments";

/** Middle-ellipsize a name for display; the full name stays in `title`. */
export function middleEllipsis(name: string, max = 36): string {
  if (name.length <= max) return name;
  if (max <= 4) return name.slice(0, max);
  const head = Math.ceil(max * 0.55);
  const tail = max - head - 1;
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

function KindIcon({ kind }: { kind: Attachment["kind"] }) {
  const cls = "h-8 w-8 shrink-0 p-1.5 text-text-muted";
  switch (kind) {
    case "image":
      return <ImageIcon size={16} className={cls} aria-hidden="true" />;
    case "pdf":
      return <FileText size={16} className={cls} aria-hidden="true" />;
    case "text":
      return <FileCode2 size={16} className={cls} aria-hidden="true" />;
    case "doc":
      return <FileType2 size={16} className={cls} aria-hidden="true" />;
  }
}

function statusLine(a: Attachment): string {
  if (a.status === "error") return middleEllipsis(a.error ?? "Failed", 48);
  if (a.status === "reading" || a.status === "extracting") return "Reading…";
  const size = formatBytes(a.bytes);
  return a.pages !== undefined ? `${size} · ${a.pages} page${a.pages === 1 ? "" : "s"}` : size;
}

function statusClass(a: Attachment): string {
  if (a.status === "error") return "text-error";
  if (a.status === "reading" || a.status === "extracting") return "text-text-muted";
  return "text-text-secondary";
}

function toneClass(tone: AttachmentNotice["tone"]): string {
  switch (tone) {
    case "warning":
      return "text-warning";
    case "error":
      return "text-error";
    case "info":
      return "text-text-secondary";
  }
}

export function AttachmentChips({
  attachments,
  thumbnails,
  notice,
  onRemove,
  onRetry,
}: {
  attachments: Attachment[];
  thumbnails: Record<string, string>;
  notice: AttachmentNotice | null;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  if (attachments.length === 0 && notice === null) return null;

  return (
    <div className="space-y-1.5">
      {notice && (
        <p role="status" aria-live="polite" className={`text-xs ${toneClass(notice.tone)}`}>
          {notice.text}
        </p>
      )}
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Attached files">
          {attachments.map((a) => {
            const thumb = a.kind === "image" ? thumbnails[a.id] : undefined;
            return (
              <li
                key={a.id}
                className="flex max-w-full items-center gap-2 rounded-md border border-edge bg-card py-1.5 pl-1.5 pr-1"
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-sm object-cover"
                  />
                ) : (
                  <KindIcon kind={a.kind} />
                )}
                <div className="min-w-0">
                  <span className="block max-w-[180px] truncate font-mono text-xs text-text" title={a.name}>
                    {middleEllipsis(a.name)}
                  </span>
                  <span className={`block text-[11px] ${statusClass(a)}`}>{statusLine(a)}</span>
                </div>
                {a.status === "error" && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(a.id)}
                    aria-label={`Retry ${a.name}`}
                    title={`Retry ${a.name}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-warning"
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  aria-label={`Remove ${a.name}`}
                  title={`Remove ${a.name}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-error"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
