// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { StatusMark } from "./StatusMark";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    root,
    $: (s) => container.querySelector<HTMLElement>(s),
    $$: (s) => [...container.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StatusMark", () => {
  // Spec §6.1: every status uses exact shared color + icon/shape contract.
  const cases: Array<{ status: string; icon: string }> = [
    { status: "draft", icon: "svg" },           // FilePenLine
    { status: "queued", icon: "svg" },          // hollow circle
    { status: "running", icon: "svg" },         // Loader2
    { status: "paused", icon: "svg" },          // Pause
    { status: "completed", icon: "svg" },       // Check
    { status: "completed_with_failures", icon: "svg" }, // AlertTriangle
    { status: "partial", icon: "svg" },         // CircleDashed
    { status: "failed", icon: "svg" },           // XCircle
    { status: "aborted", icon: "svg" },          // Square
    { status: "interrupted", icon: "svg" },      // Unplug
  ];

  for (const { status } of cases) {
    it(`renders ${status} with an icon and visible text`, () => {
      const h = render(<StatusMark status={status as never} />);
      // Status always includes visible or programmatic text (spec §6.1).
      const text = h.container.textContent ?? "";
      expect(text.length).toBeGreaterThan(0);
      // Icon/shape cue is present.
      expect(h.$("svg")).toBeTruthy();
      cleanup(h);
    });
  }

  it("status text is distinguishable without color (every status has unique text)", () => {
    const texts = new Set<string>();
    for (const { status } of cases) {
      const h = render(<StatusMark status={status as never} />);
      texts.add((h.container.textContent ?? "").trim());
      cleanup(h);
    }
    // Every status has a distinct text label — color is never the only cue.
    expect(texts.size).toBe(cases.length);
  });

  it("running rotation is disabled when prefers-reduced-motion is reduce", () => {
    // The spin animation class is applied conditionally. We verify the class
    // is present under normal motion, and absent (or animation disabled via
    // the global CSS rule) under reduced motion. The global CSS at
    // index.css:125 already forces animation-duration: 0.01ms for all
    // elements under reduced-motion. The component-level contract is: the
    // spin class is only added when motion is allowed.
    const h = render(<StatusMark status="running" reducedMotion={true} />);
    const spinner = h.$("svg");
    expect(spinner).toBeTruthy();
    // Under reduced motion, the spinner must NOT carry the spin animation class.
    expect(spinner?.getAttribute("class") ?? "").not.toContain("animate-spin");
    cleanup(h);
  });

  it("running rotation is present when reduced motion is off", () => {
    const h = render(<StatusMark status="running" reducedMotion={false} />);
    const spinner = h.$("svg");
    expect(spinner).toBeTruthy();
    expect(spinner?.getAttribute("class") ?? "").toContain("animate-spin");
    cleanup(h);
  });

  it("uses 13px minimum body text", () => {
    const h = render(<StatusMark status="completed" />);
    const el = h.$("[data-status-mark]");
    expect(el).toBeTruthy();
    // The spec requires 13px minimum. We check the text element's font size
    // is at least 13px via the className (text-[13px] or larger).
    const classes = (el?.getAttribute("class") ?? "").split(/\s+/);
    const hasMinSize = classes.some((c) => {
      const m = c.match(/^text-\[(\d+)px\]$/);
      return m && parseInt(m[1], 10) >= 13;
    });
    // Also accept text-sm (14px) or text-base (16px) — both exceed 13px.
    const hasStdSize = classes.includes("text-sm") || classes.includes("text-base");
    expect(hasMinSize || hasStdSize).toBe(true);
    cleanup(h);
  });
});
