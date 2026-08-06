// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useReducer } from "react";
import { useAttachments, createAttachmentDrafts } from "./useAttachments";
import { initialState, reducer } from "../studio-engine";
import { MAX_FILES } from "../lib/attachments/limits";

// ---------------------------------------------------------------------------
// Pure admission/classification step
// ---------------------------------------------------------------------------

describe("createAttachmentDrafts — pure admission (7.5.2)", () => {
  it("classifies an admitted PNG into a reading-state image draft", () => {
    const file = new File(["x"], "chart.png", { type: "image/png" });
    const { drafts, rejections } = createAttachmentDrafts([], [file]);
    expect(rejections).toEqual([]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      bytes: 1,
      status: "reading",
      name: "chart.png",
      file,
    });
    expect(drafts[0].id).toMatch(/^att-\d+$/);
  });

  it("rejects a legacy .doc with the named reason", () => {
    const file = new File(["x"], "old.doc", { type: "application/msword" });
    const { drafts, rejections } = createAttachmentDrafts([], [file]);
    expect(drafts).toEqual([]);
    expect(rejections[0].name).toBe("old.doc");
    expect(rejections[0].reason.toLowerCase()).toContain("doc");
  });

  it("enforces the file-count cap against the existing set", () => {
    const existing = Array.from({ length: MAX_FILES }, () => ({ bytes: 1 }));
    const file = new File(["x"], "one-more.txt", { type: "text/plain" });
    const { drafts, rejections } = createAttachmentDrafts(existing, [file]);
    expect(drafts).toEqual([]);
    expect(rejections[0].reason).toContain("Maximum 10 files");
  });

  it("keeps the admitted file when a sibling is rejected", () => {
    const good = new File(["ok"], "fine.md", { type: "text/markdown" });
    const bad = new File(["x"], "zip.zip", { type: "application/zip" });
    const { drafts, rejections } = createAttachmentDrafts([], [good, bad]);
    expect(drafts.map((d) => d.name)).toEqual(["fine.md"]);
    expect(rejections.map((r) => r.name)).toEqual(["zip.zip"]);
  });

  it("sanitizes names for display and prompt use", () => {
    const file = new File(["x"], "..\\..\\etc\r\npasswd", { type: "text/plain" });
    const { drafts } = createAttachmentDrafts([], [file]);
    // Control chars → space, whitespace collapsed (spec §8.2): the CRLF
    // injection becomes a single space, never a new line.
    expect(drafts[0].name).not.toContain("\r");
    expect(drafts[0].name).not.toContain("\n");
    expect(drafts[0].name).toBe("..\\..\\etc passwd");
  });
});

// ---------------------------------------------------------------------------
// Hook lifecycle — real reducer, happy-dom
// ---------------------------------------------------------------------------

function Harness() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const ui = useAttachments(state.attachments, dispatch);
  return (
    <div>
      <button
        data-testid="add"
        onClick={() => ui.addFiles([new File(["hello"], "note.txt", { type: "text/plain" })])}
      >
        add
      </button>
      <button
        data-testid="add-img"
        onClick={() => ui.addFiles([new File(["img"], "shot.png", { type: "image/png" })])}
      >
        add-img
      </button>
      <button data-testid="remove" onClick={() => ui.remove(state.attachments[0]?.id ?? "")}>
        remove
      </button>
      <span data-testid="count">{state.attachments.length}</span>
      <span data-testid="status">{state.attachments[0]?.status ?? "none"}</span>
      <span data-testid="notice">{ui.notice?.text ?? ""}</span>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLElement;

function mount(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Harness />);
  });
  return container;
}

function byId(container: HTMLElement, id: string): HTMLElement {
  return container.querySelector(`[data-testid="${id}"]`) as HTMLElement;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAttachments — File → dispatch lifecycle (7.5.2)", () => {
  it("adds a text file and settles it to ready with extracted text", async () => {
    const container = mount();
    act(() => byId(container, "add").click());
    expect(byId(container, "count").textContent).toBe("1");
    expect(byId(container, "status").textContent).toBe("reading");

    await vi.waitFor(() => {
      expect(byId(container, "status").textContent).toBe("ready");
    });
    expect(byId(container, "notice").textContent).toContain("note.txt attached");
  });

  it("creates a thumbnail object URL for images and revokes it on remove", async () => {
    const createSpy = vi.fn(() => "blob:test-url");
    const revokeSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

    const container = mount();
    act(() => byId(container, "add-img").click());
    expect(createSpy).toHaveBeenCalledTimes(1);

    // Extraction settles (image decode may fail in happy-dom — either terminal
    // state proves the lifecycle ended).
    await vi.waitFor(() => {
      expect(["ready", "error"]).toContain(byId(container, "status").textContent);
    });

    act(() => byId(container, "remove").click());
    await vi.waitFor(() => {
      expect(byId(container, "count").textContent).toBe("0");
    });
    expect(revokeSpy).toHaveBeenCalledWith("blob:test-url");
  });

  it("revokes every object URL on unmount (spec §10.8)", async () => {
    const createSpy = vi.fn(() => "blob:test-url");
    const revokeSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

    const container = mount();
    act(() => byId(container, "add-img").click());
    await vi.waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    act(() => root?.unmount());
    root = null;
    expect(revokeSpy).toHaveBeenCalledWith("blob:test-url");
  });
});
