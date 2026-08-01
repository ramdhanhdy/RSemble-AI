// =============================================================================
// Attachment types — spec §4
// =============================================================================

export type AttachmentKind = "image" | "pdf" | "text" | "doc";

/** Terminal-or-transient lifecycle of one attachment. */
export type AttachmentStatus = "reading" | "extracting" | "ready" | "error";

export interface Attachment {
  id: string;                 // `att-${counter}` — stable, used as React key
  name: string;               // sanitized display name (§8.2)
  kind: AttachmentKind;
  mimeType: string;           // normalized, never ""
  bytes: number;
  status: AttachmentStatus;
  error?: string;             // set iff status === "error"

  /** base64 (no data-URL prefix) — present for kind "image" | "pdf" once ready. */
  data?: string;
  /** Extracted plain text — present for "text" | "doc", and for "pdf" as a fallback. */
  text?: string;
  /** True when `text` was cut at a limit in §3.1. */
  truncated?: boolean;
  /** Image intrinsic size after downscale, for the UI chip and token estimate. */
  width?: number;
  height?: number;
  /** Page count for PDFs (spec §8.2 announcements, §9 token estimate). */
  pages?: number;
}