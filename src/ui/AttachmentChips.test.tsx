// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentChips, middleEllipsis } from "./AttachmentChips";
import type { Attachment } from "../lib/attachments/types";

const READY: Attachment = {
  id: "att-1",
  name: "quarterly-report.pdf",
  kind: "pdf",
  mimeType: "application/pdf",
  bytes: 1_500_000,
  status: "ready",
  text: "…",
  pages: 12,
};

const READING: Attachment = {
  ...READY,
  id: "att-2",
  name: "shot.png",
  kind: "image",
  mimeType: "image/png",
  status: "reading",
};

const FAILED: Attachment = {
  id: "att-3",
  name: "notes.docx",
  kind: "doc",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytes: 100,
  status: "error",
  error: "DOCX extraction failed: corrupt package",
};

describe("middleEllipsis", () => {
  it("keeps short names intact", () => {
    expect(middleEllipsis("short.md", 36)).toBe("short.md");
  });

  it("ellipsizes long names, keeping head and tail", () => {
    const out = middleEllipsis("a".repeat(80), 20);
    expect(out).toHaveLength(20);
    expect(out).toContain("…");
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("a")).toBe(true);
  });
});

describe("AttachmentChips — a11y and status rendering (7.5.3)", () => {
  it("renders nothing when there are no attachments and no notice", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips attachments={[]} thumbnails={{}} notice={null} onRemove={() => {}} />,
    );
    expect(html).toBe("");
  });

  it("labels every Remove button with the sanitized name", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips attachments={[READY]} thumbnails={{}} notice={null} onRemove={() => {}} />,
    );
    expect(html).toContain('aria-label="Remove quarterly-report.pdf"');
    expect(html).toMatch(/<button[^>]*aria-label="Remove /);
  });

  it("shows size and page count for a ready PDF", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips attachments={[READY]} thumbnails={{}} notice={null} onRemove={() => {}} />,
    );
    expect(html).toContain("1.4 MB");
    expect(html).toContain("12 pages");
  });

  it("shows a transient state for reading attachments", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips attachments={[READING]} thumbnails={{}} notice={null} onRemove={() => {}} />,
    );
    expect(html).toContain("Reading…");
  });

  it("exposes a reachable Retry action for a failed attachment when provided", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips
        attachments={[FAILED]}
        thumbnails={{}}
        notice={null}
        onRemove={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Retry notes.docx"');
  });

  it("renders the error message on failed attachments", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips attachments={[FAILED]} thumbnails={{}} notice={null} onRemove={() => {}} />,
    );
    expect(html).toContain("DOCX extraction failed: corrupt package");
  });

  it("renders image thumbnails from object URLs", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips
        attachments={[READING]}
        thumbnails={{ "att-2": "blob:thumb" }}
        notice={null}
        onRemove={() => {}}
      />,
    );
    expect(html).toContain('src="blob:thumb"');
  });

  it("announces notices through a polite live region that is visible", () => {
    const html = renderToStaticMarkup(
      <AttachmentChips
        attachments={[]}
        thumbnails={{}}
        notice={{ text: "huge.zip: archives are not supported", tone: "warning" }}
        onRemove={() => {}}
      />,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain("huge.zip: archives are not supported");
  });

  it("dispatches removal when the Remove button is clicked", () => {
    const onRemove = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root | null = createRoot(container);
    act(() => {
      root!.render(
        <AttachmentChips attachments={[READY]} thumbnails={{}} notice={null} onRemove={onRemove} />,
      );
    });
    act(() => {
      (
        container.querySelector(
          'button[aria-label="Remove quarterly-report.pdf"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onRemove).toHaveBeenCalledWith("att-1");
    act(() => root?.unmount());
    container.remove();
  });
});
