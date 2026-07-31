// =============================================================================
// Attachment extraction — spec §6.2, §3.1
// =============================================================================

import type { AttachmentKind } from "./types";
import {
  MAX_TEXT_CHARS_PER_FILE,
  MAX_IMAGE_DIM,
} from "./limits";

/** Read a File as base64 (no data-URL prefix), chunked to avoid stack overflow. */
export async function readAsBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

/** Truncate text at MAX_TEXT_CHARS_PER_FILE, appending a marker. */
export function truncateText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS_PER_FILE) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, MAX_TEXT_CHARS_PER_FILE) +
      `\n\n[truncated: ${MAX_TEXT_CHARS_PER_FILE} of ${text.length} characters shown]`,
    truncated: true,
  };
}

// --- Image extraction ---------------------------------------------------------

export interface PreparedImage {
  data: string;       // base64, no prefix
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Decode, downscale, and re-encode an image for provider transport.
 * GIF → first frame only. HEIC → rejected if not decodable.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // No downscale needed
  if (width <= MAX_IMAGE_DIM && height <= MAX_IMAGE_DIM) {
    const data = await readAsBase64(file);
    bitmap.close();
    return { data, width, height, mimeType: file.type || "image/png" };
  }

  // Downscale to fit MAX_IMAGE_DIM, preserving aspect ratio
  const scale = MAX_IMAGE_DIM / Math.max(width, height);
  const newW = Math.round(width * scale);
  const newH = Math.round(height * scale);

  const canvas = new OffscreenCanvas(newW, newH);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not create canvas context for image downscale.");
  }
  ctx.drawImage(bitmap, 0, 0, newW, newH);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  const data = await readAsBase64(new File([blob], file.name, { type: "image/png" }));
  return { data, width: newW, height: newH, mimeType: "image/png" };
}

// --- PDF extraction -----------------------------------------------------------

export interface PdfExtraction {
  pageCount: number;
  text: string;
  truncated: boolean;
  noExtractableText: boolean;
}

/**
 * Extract text from a PDF using pdfjs-dist (dynamically imported).
 * Returns empty text with noExtractableText=true when the PDF has no text layer.
 */
export async function extractPdf(file: File): Promise<PdfExtraction> {
  try {
    const pdfjs = await import("pdfjs-dist");
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pageCount = pdf.numPages;

    const textParts: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      textParts.push(pageText);
    }

    const fullText = textParts.join("\n\n");
    const { text, truncated } = truncateText(fullText);

    return {
      pageCount,
      text,
      truncated,
      noExtractableText: fullText.trim().length === 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`PDF extraction failed: ${message}`);
  }
}

// --- DOCX extraction ----------------------------------------------------------

/**
 * Extract plain text from a .docx file using mammoth (dynamically imported).
 */
export async function extractDocx(file: File): Promise<{ text: string; truncated: boolean }> {
  try {
    const mammoth = await import("mammoth");
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return truncateText(result.value);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`DOCX extraction failed: ${message}`);
  }
}

// --- Unified extraction dispatcher ---------------------------------------------

export interface ExtractionResult {
  data?: string;          // base64 for image/pdf
  text?: string;          // extracted text for text/doc/pdf-fallback
  truncated?: boolean;
  width?: number;
  height?: number;
  pageCount?: number;
  noExtractableText?: boolean;
  error?: string;
}

/**
 * Extract content from a file based on its kind.
 * All paths catch errors and return a human-readable error string.
 */
export async function extractAttachment(
  file: File,
  kind: AttachmentKind,
): Promise<ExtractionResult> {
  try {
    switch (kind) {
      case "image": {
        const prepared = await prepareImage(file);
        return {
          data: prepared.data,
          width: prepared.width,
          height: prepared.height,
        };
      }

      case "pdf": {
        // Try text extraction first; if no text, fall back to base64 for native transport
        const extraction = await extractPdf(file);
        if (extraction.noExtractableText) {
          const data = await readAsBase64(file);
          return { data, pageCount: extraction.pageCount, noExtractableText: true };
        }
        return {
          text: extraction.text,
          truncated: extraction.truncated,
          pageCount: extraction.pageCount,
        };
      }

      case "text": {
        const raw = await file.text();
        const { text, truncated } = truncateText(raw);
        return { text, truncated };
      }

      case "doc": {
        const { text, truncated } = await extractDocx(file);
        return { text, truncated };
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}