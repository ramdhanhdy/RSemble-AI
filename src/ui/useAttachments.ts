// =============================================================================
// useAttachments — File → dispatch lifecycle for task attachments (plan 7.5.2).
//
// Owns everything the reducer must not: reading/extracting files (status
// "reading" → "ready" | "error" via ATTACHMENT_READY / ATTACHMENT_FAILED),
// picker-level admission + classification (admitFiles/classifyFile), thumbnail
// object URLs, announcement notices, and revocation on remove/reset/unmount
// (spec §10.8 — no dangling object URLs, §11 — File handle released after read).
//
// The attachments themselves live in StudioState; this hook is the only writer.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action } from "../studio-engine";
import type { Attachment } from "../lib/attachments/types";
import { classifyFile, sanitizeName } from "../lib/attachments/classify";
import { admitFiles } from "../lib/attachments/limits";
import { extractAttachment } from "../lib/attachments/extract";

let attSeq = 0;
function nextAttachmentId(): string {
  attSeq += 1;
  return `att-${attSeq}`;
}

/** Announcement for the chips' aria-live region (spec §8.2). */
export interface AttachmentNotice {
  text: string;
  tone: "info" | "warning" | "error";
}

export interface AttachmentDraft extends Attachment {
  /** Original File handle, aligned with the draft — released after reading. */
  file: File;
}

/**
 * Pure admission + classification step (unit-testable, no DOM).
 * Enforces §3.1 limits against the existing set, classifies each admitted
 * file, and produces reading-state drafts with sanitized names. Rejections
 * carry user-visible reasons — silent drops are forbidden (spec §3.1).
 */
export function createAttachmentDrafts(
  existing: { bytes: number }[],
  files: File[]
): { drafts: AttachmentDraft[]; rejections: { name: string; reason: string }[] } {
  const { accepted, rejections } = admitFiles(existing, files);
  const drafts: AttachmentDraft[] = [];
  for (const file of accepted) {
    const classified = classifyFile(file);
    if ("rejected" in classified) {
      rejections.push({ name: file.name, reason: classified.rejected });
      continue;
    }
    drafts.push({
      id: nextAttachmentId(),
      name: sanitizeName(file.name),
      kind: classified.kind,
      mimeType: classified.mimeType,
      bytes: file.size,
      status: "reading",
      file,
    });
  }
  return { drafts, rejections };
}

/** One-shot read/extract for a single draft; dispatches the terminal action. */
async function processFile(
  draft: AttachmentDraft,
  dispatch: React.Dispatch<Action>,
  onReadyNotice: (notice: AttachmentNotice) => void
): Promise<void> {
  const { id, kind, name, file } = draft;
  try {
    const result = await extractAttachment(file, kind);
    if (result.error) {
      dispatch({ type: "ATTACHMENT_FAILED", id, error: result.error });
      onReadyNotice({ text: `${name} failed: ${result.error}`, tone: "error" });
      return;
    }
    dispatch({
      type: "ATTACHMENT_READY",
      id,
      data: result.data,
      text: result.text,
      truncated: result.truncated,
      width: result.width,
      height: result.height,
      pageCount: result.pageCount,
      mimeType: result.mimeType,
    });
    // The spec's ready announcement (§8.2) is page-count specific for PDFs.
    if (kind === "pdf" && result.pageCount !== undefined) {
      onReadyNotice({
        text: result.noExtractableText
          ? `${name} — no extractable text (${result.pageCount} pages)`
          : `${name} — text extracted, ${result.pageCount} pages`,
        tone: "info",
      });
    }
  } catch (err) {
    dispatch({
      type: "ATTACHMENT_FAILED",
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    onReadyNotice({
      text: `${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      tone: "error",
    });
  }
}

export interface UseAttachmentsResult {
  /** Latest announcement for the aria-live region, or null when idle. */
  notice: AttachmentNotice | null;
  /** id → object URL for image thumbnails (revoked when the id leaves state). */
  thumbnails: Record<string, string>;
  addFiles: (files: File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
  setToJudge: (value: boolean) => void;
  retry: (id: string) => void;
}

export function useAttachments(
  attachments: Attachment[],
  dispatch: React.Dispatch<Action>
): UseAttachmentsResult {
  const [notice, setNotice] = useState<AttachmentNotice | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const thumbnailsRef = useRef(new Map<string, string>());
  const filesRef = useRef(new Map<string, File>());

  // Revoke object URLs (and release File handles) for ids that left state —
  // REMOVE_ATTACHMENT, CLEAR_ATTACHMENTS, and RESET_SESSION all land here.
  useEffect(() => {
    const alive = new Set(attachments.map((a) => a.id));
    for (const [id, url] of thumbnailsRef.current) {
      if (!alive.has(id)) {
        URL.revokeObjectURL(url);
        thumbnailsRef.current.delete(id);
        filesRef.current.delete(id);
      }
    }
    setThumbnails(Object.fromEntries(thumbnailsRef.current));
  }, [attachments]);

  // Unmount: revoke everything (spec §10.8 leak audit). The cleanup reads the
  // ref at unmount time — capturing the values at mount would revoke nothing.
  useEffect(() => {
    return () => {
      for (const url of thumbnailsRef.current.values()) URL.revokeObjectURL(url);
      thumbnailsRef.current.clear();
      filesRef.current.clear();
    };
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const { drafts, rejections } = createAttachmentDrafts(attachments, files);
      const rejectionText =
        rejections.length > 0
          ? rejections.map((r) => `${r.name}: ${r.reason}`).join(" · ")
          : null;

      if (drafts.length === 0) {
        if (rejectionText) setNotice({ text: rejectionText, tone: "warning" });
        return;
      }

      dispatch({ type: "ADD_ATTACHMENTS", attachments: drafts });
      setNotice(
        rejectionText
          ? { text: rejectionText, tone: "warning" }
          : {
              text: drafts.length === 1 ? `${drafts[0].name} attached` : `${drafts.length} files attached`,
              tone: "info",
            }
      );

      for (const draft of drafts) {
        filesRef.current.set(draft.id, draft.file);
        if (draft.kind === "image") {
          const url = URL.createObjectURL(draft.file);
          thumbnailsRef.current.set(draft.id, url);
          setThumbnails(Object.fromEntries(thumbnailsRef.current));
        }
        void processFile(draft, dispatch, setNotice);
      }
    },
    [attachments, dispatch]
  );

  const remove = useCallback((id: string) => {
    dispatch({ type: "REMOVE_ATTACHMENT", id });
  }, [dispatch]);

  const clear = useCallback(() => {
    dispatch({ type: "CLEAR_ATTACHMENTS" });
  }, [dispatch]);

  const retry = useCallback((id: string) => {
    const file = filesRef.current.get(id);
    if (!file) {
      setNotice({ text: "The original file handle is no longer available. Remove and attach it again.", tone: "error" });
      return;
    }
    const attachment = attachments.find((a) => a.id === id);
    if (!attachment || attachment.status !== "error") return;
    dispatch({ type: "ATTACHMENT_RETRY", id });
    void processFile({ ...attachment, file }, dispatch, setNotice);
  }, [attachments, dispatch]);

  const setToJudge = useCallback((value: boolean) => {
    dispatch({ type: "SET_ATTACHMENTS_TO_JUDGE", value });
  }, [dispatch]);

  return { notice, thumbnails, addFiles, remove, clear, setToJudge, retry };
}
