// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentCapabilityStrip } from "./AttachmentCapabilityStrip";
import type { Action } from "../studio-engine";
import type { ModelSlot } from "../studio-data";
import type { Attachment } from "../lib/attachments/types";
import { clearModelCapabilities, setModelCapabilities } from "../lib/providers/capabilities";

const IMAGE: Attachment = {
  id: "att-1",
  name: "shot.png",
  kind: "image",
  mimeType: "image/png",
  bytes: 100,
  status: "ready",
  data: "AAAA",
};

const PDF: Attachment = {
  id: "att-2",
  name: "report.pdf",
  kind: "pdf",
  mimeType: "application/pdf",
  bytes: 200,
  status: "ready",
  data: "BBBB",
  text: "…",
  pages: 2,
};

const TEXT: Attachment = {
  id: "att-3",
  name: "notes.md",
  kind: "text",
  mimeType: "text/markdown",
  bytes: 10,
  status: "ready",
  text: "hello",
};

function slot(id: string, model: string, slug: string, enabled = true): ModelSlot {
  return {
    id,
    providerId: "openrouter",
    provider: "OpenRouter",
    model,
    slug,
    enabled,
  };
}

beforeEach(() => {
  clearModelCapabilities();
});

afterEach(() => {
  clearModelCapabilities();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AttachmentCapabilityStrip (7.5.5)", () => {
  it("renders nothing when attachments carry no native media", () => {
    const html = renderToStaticMarkup(
      <AttachmentCapabilityStrip
        slots={[slot("s1", "Model A", "a/model-a")]}
        attachments={[TEXT]}
        dispatch={() => {}}
      />,
    );
    expect(html).toBe("");
  });

  it("reports the vision ratio across enabled slots only", () => {
    setModelCapabilities("openrouter", "a/model-a", { image: true, pdf: false });
    setModelCapabilities("openrouter", "b/model-b", { image: false, pdf: false });
    const html = renderToStaticMarkup(
      <AttachmentCapabilityStrip
        slots={[slot("s1", "Model A", "a/model-a"), slot("s2", "Model B", "b/model-b")]}
        attachments={[IMAGE]}
        dispatch={() => {}}
      />,
    );
    expect(html).toContain("Vision: 1 of 2 selected models");
    // React SSR escapes the apostrophe as &#x27;.
    expect(html).toContain("can&#x27;t see images");
  });

  it("notes PDF degradation without disabling it", () => {
    setModelCapabilities("openrouter", "a/model-a", { image: true, pdf: true });
    setModelCapabilities("openrouter", "b/model-b", { image: true, pdf: false });
    const html = renderToStaticMarkup(
      <AttachmentCapabilityStrip
        slots={[slot("s1", "Model A", "a/model-a"), slot("s2", "Model B", "b/model-b")]}
        attachments={[PDF]}
        dispatch={() => {}}
      />,
    );
    expect(html).toContain("Vision: 2 of 2 selected models");
    expect(html).toContain("PDF arrives as text");
  });

  it("hides the disable action when every enabled slot can see images", () => {
    setModelCapabilities("openrouter", "a/model-a", { image: true, pdf: false });
    const html = renderToStaticMarkup(
      <AttachmentCapabilityStrip
        slots={[slot("s1", "Model A", "a/model-a")]}
        attachments={[IMAGE]}
        dispatch={() => {}}
      />,
    );
    expect(html).not.toContain("Disable incompatible");
  });

  it("disables incompatible slots via TOGGLE_SLOT", () => {
    setModelCapabilities("openrouter", "a/model-a", { image: true, pdf: false });
    setModelCapabilities("openrouter", "b/model-b", { image: false, pdf: false });
    setModelCapabilities("openrouter", "c/model-c", { image: false, pdf: false });
    const dispatched: Action[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root | null = createRoot(container);
    act(() => {
      root!.render(
        <AttachmentCapabilityStrip
          slots={[
            slot("s1", "Model A", "a/model-a"),
            slot("s2", "Model B", "b/model-b"),
            slot("s3", "Model C", "c/model-c"),
          ]}
          attachments={[IMAGE]}
          dispatch={(a) => dispatched.push(a)}
        />,
      );
    });
    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(dispatched).toEqual([
      { type: "TOGGLE_SLOT", id: "s2" },
      { type: "TOGGLE_SLOT", id: "s3" },
    ]);
    act(() => root?.unmount());
    container.remove();
  });

  it("ignores disabled slots in both the ratio and the disable action", () => {
    setModelCapabilities("openrouter", "a/model-a", { image: false, pdf: false });
    setModelCapabilities("openrouter", "b/model-b", { image: false, pdf: false });
    const html = renderToStaticMarkup(
      <AttachmentCapabilityStrip
        slots={[slot("s1", "Model A", "a/model-a", false), slot("s2", "Model B", "b/model-b")]}
        attachments={[IMAGE]}
        dispatch={() => {}}
      />,
    );
    expect(html).toContain("Vision: 0 of 1 selected models");
    // Only the enabled incapable slot is listed as incompatible.
    expect(html).toContain("Disable incompatible");
  });
});
