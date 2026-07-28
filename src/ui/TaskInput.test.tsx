import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskInput } from "./TaskInput";
import type { Action } from "../studio-engine";

const noop: React.Dispatch<Action> = () => undefined;

describe("TaskInput — one-click 'Try an example' control", () => {
  it("renders an accessible control labelled 'Try an example' near the task input", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} />,
    );
    expect(html).toContain("Try an example");
    // It must be a real focusable control with an aria-label so keyboard/AT
    // users can reach and activate it.
    expect(html).toMatch(/<(button|a)[^>]*aria-label="Try an example"/);
  });

  it("the control is keyboard-focusable (not disabled) when the task is empty", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} />,
    );
    const match = html.match(/<(button|a)[^>]*aria-label="Try an example"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0].toLowerCase()).not.toContain("disabled");
  });

  it("shows a 'replace' confirmation affordance when the task already has user text", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="my own task" exampleIndex={-1} dispatch={noop} />,
    );
    // When user text is present (not an unedited example), the control must
    // surface a replace confirmation (visible hint or title) rather than
    // destroying text on the first click.
    expect(html.toLowerCase()).toMatch(/replace/);
  });

  it("still renders the control when the task has text (not hidden)", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="my own task" exampleIndex={-1} dispatch={noop} />,
    );
    expect(html).toMatch(/aria-label="Try an example"/);
  });

  it("renders a token counter for the prompt", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="hello world" exampleIndex={-1} dispatch={noop} />,
    );
    expect(html).toContain("tokens");
  });

  it("preserves the prompt textarea and its label", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} />,
    );
    expect(html).toContain('id="prompt"');
    expect(html).toContain('aria-label="Task"');
  });

  it("the control meets the 44px touch-target minimum (WCAG 2.5.5)", () => {
    const html = renderToStaticMarkup(
      <TaskInput prompt="" exampleIndex={-1} dispatch={noop} />,
    );
    // The button must carry a min-height class that guarantees a 44px touch
    // target on mobile — matching the h-11 convention used by ResetButton and
    // the Add-model control in the same command pane.
    const match = html.match(/<(button)[^>]*aria-label="Try an example"[^>]*>/);
    expect(match).not.toBeNull();
    expect(match![0]).toMatch(/min-h-\[44px\]|h-11/);
  });
});
