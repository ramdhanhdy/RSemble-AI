// =============================================================================
// Attachment limits — review fix 4
//
// Raw file-count / per-file / aggregate limits are re-exported from the single
// shared source (`shared/limits.ts`) used by both the web UI and the localhost
// bridge. Text-character and image-dimension limits are attachment-extraction
// concerns and stay local to this module.
// =============================================================================

import {
  MAX_ATTACHMENT_FILES,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from "../../../shared/limits";

export const MAX_FILES = MAX_ATTACHMENT_FILES;
export const MAX_FILE_BYTES = MAX_ATTACHMENT_FILE_BYTES;
export const MAX_TOTAL_BYTES = MAX_ATTACHMENT_TOTAL_BYTES;

export { BRIDGE_MAX_BODY_BYTES, projectEncodedBridgeBodyBytes } from "../../../shared/limits";

// Local extraction limits (text/document dimensions, not transport sizes).
export const MAX_TEXT_CHARS_PER_FILE = 40_000;
export const MAX_TEXT_CHARS_TOTAL = 120_000;
export const MAX_IMAGE_DIM = 4096;

export interface FileRejection {
  name: string;
  reason: string;
}

export interface AdmitResult {
  accepted: File[];
  rejections: FileRejection[];
}

/**
 * Admit incoming files against the attachment limits.
 * Returns the accepted files and the rejections with reasons.
 * Over-count and over-total reject only the offending files, keeping the rest.
 */
export function admitFiles(existing: { bytes: number }[], incoming: File[]): AdmitResult {
  const accepted: File[] = [];
  const rejections: FileRejection[] = [];

  let currentTotal = existing.reduce((sum, f) => sum + f.bytes, 0);
  let currentCount = existing.length;

  for (const file of incoming) {
    // Max files per task
    if (currentCount >= MAX_FILES) {
      rejections.push({
        name: file.name,
        reason: `Maximum ${MAX_FILES} files per task.`,
      });
      continue;
    }

    // Max single file size
    if (file.size > MAX_FILE_BYTES) {
      rejections.push({
        name: file.name,
        reason: `File is ${formatBytes(file.size)} — maximum ${formatBytes(MAX_FILE_BYTES)} per file.`,
      });
      continue;
    }

    // Max total attachment bytes
    if (currentTotal + file.size > MAX_TOTAL_BYTES) {
      rejections.push({
        name: file.name,
        reason: `Adding this file would exceed the ${formatBytes(MAX_TOTAL_BYTES)} total attachment limit.`,
      });
      continue;
    }

    accepted.push(file);
    currentCount++;
    currentTotal += file.size;
  }

  return { accepted, rejections };
}

/** Format bytes for human-readable error messages. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
