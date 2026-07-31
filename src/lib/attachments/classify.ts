// =============================================================================
// Attachment classification — spec §3
// =============================================================================

import type { AttachmentKind } from "./types";

/** Classification result: either an accepted kind or a rejection reason. */
export type ClassifyResult =
  | { kind: AttachmentKind; mimeType: string }
  | { rejected: string };

/** Map of extension → kind for the extension-fallback path. */
const EXTENSION_MAP: Record<string, AttachmentKind> = {
  // image
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  heic: "image",
  heif: "image",
  // pdf
  pdf: "pdf",
  // text
  md: "text",
  mdx: "text",
  txt: "text",
  csv: "text",
  json: "text",
  ts: "text",
  tsx: "text",
  js: "text",
  jsx: "text",
  py: "text",
  go: "text",
  rs: "text",
  java: "text",
  sql: "text",
  yml: "text",
  yaml: "text",
  toml: "text",
  // doc
  docx: "doc",
};

/** MIME type → kind for the MIME-first path. */
const MIME_MAP: Record<string, AttachmentKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/heic": "image",
  "image/heif": "image",
  "application/pdf": "pdf",
  "text/markdown": "text",
  "text/plain": "text",
  "text/csv": "text",
  "application/json": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
};

/** Extensions that are explicitly rejected with a named reason. */
const REJECTED_EXTENSIONS: Record<string, string> = {
  doc: "Legacy .doc is not supported — save as .docx or PDF.",
  zip: "Archives (.zip) are not supported.",
  tar: "Archives (.tar) are not supported.",
  gz: "Archives (.gz) are not supported.",
  rar: "Archives (.rar) are not supported.",
  "7z": "Archives (.7z) are not supported.",
  mp3: "Audio files are not supported.",
  wav: "Audio files are not supported.",
  ogg: "Audio files are not supported.",
  mp4: "Video files are not supported.",
  webm: "Video files are not supported.",
  avi: "Video files are not supported.",
  mov: "Video files are not supported.",
  xlsx: "Spreadsheets are not supported.",
  xls: "Spreadsheets are not supported.",
  ods: "Spreadsheets are not supported.",
};

/** Extract the lowercase extension from a filename, or "" if none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * Classify a file into an attachment kind, or reject it with a reason.
 * MIME type is checked first; extension is the fallback (browsers report ""
 * for many types on Windows).
 */
export function classifyFile(file: File): ClassifyResult {
  const ext = extensionOf(file.name);
  const mime = file.type.toLowerCase();

  // Explicit rejections by extension (checked before acceptance)
  if (REJECTED_EXTENSIONS[ext]) {
    return { rejected: REJECTED_EXTENSIONS[ext] };
  }

  // MIME-first path
  if (mime && MIME_MAP[mime]) {
    return { kind: MIME_MAP[mime], mimeType: mime };
  }

  // Extension-fallback path
  if (EXTENSION_MAP[ext]) {
    // Normalize the MIME type for known extensions
    const kind = EXTENSION_MAP[ext];
    const normalizedMime = mime || mimeForExtension(ext, kind);
    return { kind, mimeType: normalizedMime };
  }

  // Unknown type
  return {
    rejected: `Unsupported file type: ${file.name || "unknown"}${ext ? ` (.${ext})` : ""}. Supported: images, PDF, Markdown/text, .docx.`,
  };
}

/** Best-effort MIME type for a known extension when the browser reports "". */
function mimeForExtension(ext: string, kind: AttachmentKind): string {
  switch (kind) {
    case "image":
      if (ext === "png") return "image/png";
      if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
      if (ext === "webp") return "image/webp";
      if (ext === "gif") return "image/gif";
      if (ext === "heic") return "image/heic";
      if (ext === "heif") return "image/heif";
      return "image/png";
    case "pdf":
      return "application/pdf";
    case "text":
      if (ext === "md" || ext === "mdx") return "text/markdown";
      if (ext === "csv") return "text/csv";
      if (ext === "json") return "application/json";
      return "text/plain";
    case "doc":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}

/**
 * Sanitize a filename for display and prompt-block use.
 * Strips control chars, ANSI escapes, collapses whitespace, caps at 120 chars.
 */
export function sanitizeName(name: string): string {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")      // ANSI escape sequences (before control-char strip)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, " ")           // control chars → space
    .replace(/\s+/g, " ")                        // collapse whitespace
    .trim()
    .slice(0, 120);
}