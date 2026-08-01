// =============================================================================
// AttachmentCapabilityStrip — pre-flight visibility for native attachments
// (plan 7.5.5, spec §8.1). Renders only when the task has image/pdf
// attachments: "Vision: X of Y selected models", a per-slot disclosure of who
// cannot see what, and a "Disable incompatible" action implementing §5.1
// (unsupported slots drop out of the fanout instead of answering blind).
// =============================================================================

import type { Action } from "../studio-engine";
import type { ModelSlot } from "../studio-data";
import type { Attachment } from "../lib/attachments/types";
import { getModelCapabilities } from "../lib/providers/capabilities";

export function AttachmentCapabilityStrip({
  slots,
  attachments,
  dispatch,
}: {
  slots: ModelSlot[];
  attachments: Attachment[];
  dispatch: React.Dispatch<Action>;
}) {
  const hasNative = attachments.some((a) => a.kind === "image" || a.kind === "pdf");
  if (!hasNative) return null;

  const hasImages = attachments.some((a) => a.kind === "image");
  const hasPdfs = attachments.some((a) => a.kind === "pdf");
  const enabled = slots.filter((s) => s.enabled);
  const vision = enabled.map((s) => ({
    slot: s,
    caps: getModelCapabilities(s.providerId, s.slug),
  }));
  const canSeeImages = vision.filter((v) => v.caps.image).length;
  // Only image support gates the run (§5.1); PDFs degrade to extracted text.
  const incompatible = hasImages ? vision.filter((v) => !v.caps.image) : [];

  return (
    <div className="rounded-md border border-edge bg-card px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-secondary">
          Vision: {canSeeImages} of {enabled.length} selected models
        </span>
        {incompatible.length > 0 && (
          <button
            type="button"
            onClick={() => {
              for (const v of incompatible) {
                dispatch({ type: "TOGGLE_SLOT", id: v.slot.id });
              }
            }}
            aria-label={`Disable ${incompatible.length} model${incompatible.length === 1 ? "" : "s"} that cannot see image attachments`}
            className="rounded-sm border border-edge px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-secondary hover:border-edge-bright hover:text-text"
          >
            Disable incompatible
          </button>
        )}
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {vision.map(({ slot, caps }) => {
          const notes: string[] = [];
          if (hasImages && !caps.image) notes.push("can't see images");
          if (hasPdfs && !caps.pdf) notes.push("PDF arrives as text");
          return (
            <li
              key={slot.id}
              className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-muted"
            >
              <span className="min-w-0 truncate" title={`${slot.provider} — ${slot.slug}`}>
                {slot.model}
              </span>
              <span className={notes.length > 0 ? "text-warning" : "text-text-secondary"}>
                {notes.length > 0 ? notes.join(" · ") : "ready"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
