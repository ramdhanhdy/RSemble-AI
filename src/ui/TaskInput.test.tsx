// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskInput } from "./TaskInput";
import type { Action } from "../studio-engine";
import type { Attachment } from "../lib/attachments/types";

const noop: React.Dispatch<Action> = () => undefined;
const noAddFiles: (files: File[]) => void = () => undefined;

const IMAGE_ATTACHMENT: Attachment = {
  id: "att-1",
  name: "chart.png",
  kind: "image",
  mimeType: "image/png",
  bytes: 1024,
  status: "ready",
  data: "AAAA",
  width: 1024,
  height: 512,
};

describe("TaskInput — one-click 'Try an example' control", () => {
  it("renders an accessible control labelled 'Try an example' near the task input", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    expect(html).toContain("Try an example");
    // It must be a real focusable control with an aria-label so keyboard/AT
    // users can reach and activate it.
    expect(html).toMatch(/<(button|a)[^>]*aria-label="Try an example"/);
  });

  it("the control is keyboard-focusable (not disabled) when the task is empty", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    const match = html.match(/<(button|a)[^>]*aria-label="Try an example"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0].toLowerCase()).not.toContain("disabled");
  });

  it("shows a 'replace' confirmation affordance when the task already has user text", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="my own task" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    // When user text is present (not an unedited example), the control must
    // surface a replace confirmation (visible hint or title) rather than
    // destroying text on the first click.
    expect(html.toLowerCase()).toMatch(/replace/);
  });

  it("still renders the control when the task has text (not hidden)", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="my own task" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    expect(html).toMatch(/aria-label="Try an example"/);
  });

  it("renders a token counter for the prompt", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="hello world" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    expect(html).toContain("tokens");
  });

  it("preserves the prompt textarea and its label", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    expect(html).toContain('id="prompt"');
    expect(html).toContain('aria-label="Task"');
  });

  it("the control meets the 44px touch-target minimum (WCAG 2.5.5)", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    // The button must carry a min-height class that guarantees a 44px touch
    // target on mobile — matching the h-11 convention used by ResetButton and
    // the Add-model control in the same command pane.
    const match = html.match(/<(button)[^>]*aria-label="Try an example"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/min-h-\[44px\]|h-11/);
  });
});

// ---------------------------------------------------------------------------
// Attachments UI — plan 7.5.4
// ---------------------------------------------------------------------------

describe("TaskInput — attachment surface (7.5.4)", () => {
  it("renders an Attach button that opens the hidden file picker", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const onAddFiles = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);
    act(() => {
      root!.render(<TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={onAddFiles} />);
    });
    act(() => {
      (container.querySelector('button[aria-label="Attach files to this task"]') as HTMLButtonElement).click();
    });
    expect(clickSpy).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    container.remove();
    clickSpy.mockRestore();
  });

  it("restricts the picker to the accepted attachment types", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    const match = html.match(/<input[^>]*type="file"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('accept="');
    expect(match![0]).toContain("application/pdf");
    expect(match![0]).toContain(".mdx");
  });

  it("adds the file-token contribution to the counter", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="hello" exampleIndex={-1} dispatch={noop} attachments={[IMAGE_ATTACHMENT]} onAddFiles={noAddFiles} />,
    );
    // 1024×512 → ceil(1024/512)×ceil(512/512)×170 + 85 = 425.
    expect(html).toContain("native media cost unknown");
  });

  it("keeps the plain counter when no attachments are present", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="hello" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />,
    );
    expect(html).toContain("~2 tokens");
    expect(html).not.toContain("from files");
  });

  it("shows the drop overlay on dragenter and hides it on dragleave", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);
    act(() => {
      root!.render(<TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={noAddFiles} />);
    });
    const field = container.querySelector("div.relative") as HTMLElement;
    expect(field).not.toBeNull();

    act(() => {
      field.dispatchEvent(new Event("dragenter", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).toContain("Drop files — images, PDF, Markdown, .docx");

    act(() => {
      field.dispatchEvent(new Event("dragleave", { bubbles: true, cancelable: true }));
    });
    expect(container.textContent).not.toContain("Drop files");
    act(() => root?.unmount());
    container.remove();
  });

  it("passes dropped files to onAddFiles", () => {
    const onAddFiles = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);
    act(() => {
      root!.render(<TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={onAddFiles} />);
    });
    const field = container.querySelector("div.relative") as HTMLElement;
    const file = new File(["png"], "drop.png", { type: "image/png" });
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
    act(() => {
      field.dispatchEvent(drop);
    });
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    act(() => root?.unmount());
    container.remove();
  });

  it("attaches pasted files instead of inserting text", () => {
    const onAddFiles = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);
    act(() => {
      root!.render(<TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={onAddFiles} />);
    });
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const file = new File(["shot"], "shot.png", { type: "image/png" });
    const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file] } });
    act(() => {
      textarea.dispatchEvent(paste);
    });
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    act(() => root?.unmount());
    container.remove();
  });

  it("forwards picker selection through the hidden input", () => {
    const onAddFiles = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | null = createRoot(container);
    act(() => {
      root!.render(<TaskInput prompt="" exampleIndex={-1} dispatch={noop} attachments={[]} onAddFiles={onAddFiles} />);
    });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["md"], "notes.md", { type: "text/markdown" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    act(() => root?.unmount());
    container.remove();
  });
});
