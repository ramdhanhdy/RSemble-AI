// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ExperimentRecoveryDialog,
  type ExperimentRecoveryDialogProps,
} from "./ExperimentRecoveryDialog";
import type { CompoundRepairPlan } from "../../lib/evaluations/experiment-repair";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: ReactNode) => void; unmount: () => void };
}

function render(node: ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { container, root };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Fixtures -----------------------------------------------------------------

const PLAN: CompoundRepairPlan = {
  taskId: "t2",
  baseRunId: "run-2",
  requestedModelKeys: ["umans:umans-kimi-k3"],
  reusedModelKeys: [
    "gemini:gemini-3-pro-preview",
    "openrouter:anthropic/claude-4.5-sonnet",
    "x:1",
    "x:2",
    "x:3",
    "x:4",
    "x:5",
  ],
  candidateCalls: 1,
  judgeCalls: 1,
};

function baseProps(
  overrides: Partial<ExperimentRecoveryDialogProps> = {},
): ExperimentRecoveryDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    variant: "repair-cell",
    plan: PLAN,
    summary: null,
    taskTitle: "Task 2: Classify",
    modelLabel: "umans:umans-kimi-k3",
    busy: false,
    message: null,
    onConfirm: vi.fn(),
    ...overrides,
  };
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

describe("ExperimentRecoveryDialog — cost preview (spec §11.7)", () => {
  it("renders exact planner candidate/Judge counts for a single-cell repair", () => {
    const h = render(<ExperimentRecoveryDialog {...baseProps()} />);
    const preview = document.body.querySelector("[data-cost-preview]");
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain("1 candidate call + 1 Judge call across 1 task.");
    expect(preview?.textContent).toContain("7 candidate outputs will be reused.");
    cleanup(h);
  });

  it("renders aggregate planner counts for the repair-all action", () => {
    const h = render(
      <ExperimentRecoveryDialog
        {...baseProps({
          variant: "repair-all",
          plan: null,
          summary: { taskCount: 2, candidateCalls: 3, judgeCalls: 2, reusedCount: 9 },
        })}
      />,
    );
    const preview = document.body.querySelector("[data-cost-preview]");
    expect(preview?.textContent).toContain("3 candidate calls + 2 Judge calls across 2 tasks.");
    expect(preview?.textContent).toContain("9 candidate outputs will be reused.");
    cleanup(h);
  });

  it("never shows a currency estimate — pricing data does not cover every model", () => {
    const h = render(
      <ExperimentRecoveryDialog
        {...baseProps({
          variant: "repair-all",
          plan: null,
          summary: { taskCount: 2, candidateCalls: 3, judgeCalls: 2, reusedCount: 9 },
        })}
      />,
    );
    expect(bodyText()).not.toMatch(/\$\d/);
    cleanup(h);
  });

  it("shows fallback copy for the retry-task variant with no cost preview", () => {
    const h = render(
      <ExperimentRecoveryDialog
        {...baseProps({ variant: "retry-task", plan: null, taskTitle: "Task 3: Rewrite" })}
      />,
    );
    expect(bodyText()).toContain("Retry incomplete task");
    expect(bodyText()).toContain("full candidate roster");
    expect(bodyText()).toContain("Task 3: Rewrite");
    expect(document.body.querySelector("[data-cost-preview]")).toBeNull();
    cleanup(h);
  });
});

describe("ExperimentRecoveryDialog — actions (spec §11.1)", () => {
  it("confirm calls onConfirm and labels the action per variant", () => {
    const onConfirm = vi.fn();
    const h = render(<ExperimentRecoveryDialog {...baseProps({ onConfirm })} />);
    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    expect(confirm?.textContent).toBe("Start repair");
    act(() => confirm?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    cleanup(h);
  });

  it("labels the retry-task confirm Retry task", () => {
    const h = render(
      <ExperimentRecoveryDialog
        {...baseProps({ variant: "retry-task", plan: null, taskTitle: "Task 3" })}
      />,
    );
    expect(document.body.querySelector("[data-recovery-confirm]")?.textContent).toBe("Retry task");
    cleanup(h);
  });

  it("cancel calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    const h = render(<ExperimentRecoveryDialog {...baseProps({ onOpenChange })} />);
    const cancel = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel",
    );
    expect(cancel).not.toBeUndefined();
    act(() => cancel?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cleanup(h);
  });

  it("disables both buttons while busy and swaps the confirm label", () => {
    const h = render(<ExperimentRecoveryDialog {...baseProps({ busy: true })} />);
    const confirm = document.body.querySelector<HTMLButtonElement>("[data-recovery-confirm]");
    const cancel = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel",
    );
    expect(confirm?.disabled).toBe(true);
    expect(cancel?.disabled).toBe(true);
    expect(confirm?.textContent).toBe("Starting…");
    cleanup(h);
  });

  it("renders the operation result as a live alert", () => {
    const h = render(
      <ExperimentRecoveryDialog
        {...baseProps({ message: { tone: "error", text: "Another tab holds the lease" } })}
      />,
    );
    const alert = document.body.querySelector<HTMLElement>("[data-recovery-message]");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toContain("Another tab holds the lease");
    cleanup(h);
  });
});
