// =============================================================================
// ExperimentAddModelDialog.test.tsx — presentational add-model dialog
// (plan 001, F5). Data + callbacks only: no repository, controller, or
// provider involved. Verifies placement of the picker, suite-sync checkbox,
// exact preview copy, busy semantics, and the single message region.
// =============================================================================

// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ExperimentAddModelDialog } from "./ExperimentAddModelDialog";
import type { RosterExtensionPlan } from "../../lib/evaluations/experiment-roster-extension";
import type { ModelSlot } from "../../studio-data";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface Harness {
  container: HTMLDivElement;
  root: { render: (n: React.ReactNode) => void; unmount: () => void };
  $: (s: string) => HTMLElement | null;
  $$: (s: string) => HTMLElement[];
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function render(node: React.ReactNode): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    root,
    $: (s) => document.body.querySelector<HTMLElement>(s),
    $$: (s) => [...document.body.querySelectorAll<HTMLElement>(s)],
  };
}

function cleanup(h: Harness) {
  act(() => h.root.unmount());
  h.container.remove();
}

async function settle() {
  await act(async () => {
    await flush();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

// --- Fixtures ----------------------------------------------------------------

const TAKEN = new Set(["openrouter:org/m1", "gemini:m2"]);

const SELECTED_SLOT: ModelSlot = {
  id: "slot-new",
  providerId: "deepseek",
  provider: "DeepSeek",
  model: "deepseek-chat",
  slug: "deepseek-chat",
  enabled: true,
};

function makePlan(overrides: Partial<RosterExtensionPlan> = {}): RosterExtensionPlan {
  return {
    addedModelKey: "deepseek:deepseek-chat",
    addedSlot: SELECTED_SLOT,
    taskPlans: [],
    taskCount: 3,
    candidateCalls: 4,
    judgeCalls: 3,
    reusedOutputCount: 2,
    fullRosterFallbackCount: 0,
    fullRosterCandidateCount: 3,
    ...overrides,
  };
}

interface DialogOptions {
  selectedSlot?: ModelSlot | null;
  plan?: RosterExtensionPlan | null;
  planError?: string | null;
  syncToSuite?: boolean;
  busy?: boolean;
  message?: { tone: "error" | "warning"; text: string } | null;
}

function renderDialog(opts: DialogOptions = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const onSelectSlot = vi.fn();
  const h = render(
    <ExperimentAddModelDialog
      open
      onOpenChange={() => {}}
      models={[]}
      availableProviderIds={["openrouter"]}
      takenKeys={TAKEN}
      suiteName="PulseFit Advanced"
      selectedSlot={opts.selectedSlot ?? null}
      onSelectSlot={onSelectSlot}
      plan={opts.plan ?? null}
      planError={opts.planError ?? null}
      syncToSuite={opts.syncToSuite ?? true}
      onSyncToSuiteChange={() => {}}
      busy={opts.busy ?? false}
      message={opts.message ?? null}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { h, onConfirm, onCancel, onSelectSlot };
}

// --- Tests --------------------------------------------------------------------

describe("ExperimentAddModelDialog", () => {
  it("renders the title, picker, checked suite-sync checkbox naming the suite, and action buttons", async () => {
    const { h } = renderDialog();
    await settle();

    expect(document.body.textContent).toContain("Add model to results");
    // Picker opens on the first available provider with the search input.
    expect(h.$("input#model-search")).not.toBeNull();
    // Checked-by-default suite sync naming the suite explicitly.
    const checkbox = h.$('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
    const label = checkbox.closest("label");
    expect(label?.textContent).toContain("PulseFit Advanced");
    // Visible-text actions.
    const buttons = h.$$("button").map((b) => b.textContent ?? "");
    expect(buttons).toContain("Cancel");
    expect(buttons).toContain("Add and run");
    cleanup(h);
  });

  it("disables confirm until a slot is selected and planning succeeds", async () => {
    const { h } = renderDialog({ selectedSlot: SELECTED_SLOT, plan: null, planError: "Model already in this experiment's roster." });
    await settle();

    const confirm = h.$$("button").find((b) => b.textContent === "Add and run") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    // Planner rejection is visible.
    expect(document.body.textContent).toContain("already in this experiment");
    cleanup(h);
  });

  it("shows the exact compound preview copy from the planner", async () => {
    const { h } = renderDialog({ selectedSlot: SELECTED_SLOT, plan: makePlan() });
    await settle();

    const preview = h.$("[data-cost-preview]");
    expect(preview?.textContent).toContain("4 candidate calls + 3 Judge calls across 3 tasks.");
    expect(preview?.textContent).toContain("2 accepted candidate outputs will be reused.");
    // No fallback sentence when fullRosterFallbackCount is zero.
    expect(preview?.textContent).not.toContain("lack reusable evidence");
    cleanup(h);
  });

  it("adds the fallback sentence when some tasks lack reusable evidence", async () => {
    const { h } = renderDialog({
      selectedSlot: SELECTED_SLOT,
      plan: makePlan({ fullRosterFallbackCount: 1, candidateCalls: 5 }),
    });
    await settle();

    const preview = h.$("[data-cost-preview]");
    expect(preview?.textContent).toContain("1 task lacks reusable evidence and will run the full roster (3 candidates each).");
    cleanup(h);
  });

  it("pluralizes the fallback sentence for multiple tasks", async () => {
    const { h } = renderDialog({
      selectedSlot: SELECTED_SLOT,
      plan: makePlan({ fullRosterFallbackCount: 2 }),
    });
    await settle();

    expect(h.$("[data-cost-preview]")?.textContent).toContain("2 tasks lack reusable evidence");
    cleanup(h);
  });

  it("shows the committed slot with a Change model action and no second picker", async () => {
    const { h, onSelectSlot } = renderDialog({ selectedSlot: SELECTED_SLOT, plan: makePlan() });
    await settle();

    expect(h.$("input#model-search")).toBeNull();
    expect(document.body.textContent).toContain("deepseek-chat");
    const change = h.$$("button").find((b) => b.textContent === "Change model") as HTMLButtonElement;
    expect(change).toBeTruthy();
    await act(async () => {
      change.click();
      await flush();
    });
    expect(onSelectSlot).toHaveBeenCalledWith(null);
    cleanup(h);
  });

  it("shows busy copy, disables cancel, and suppresses Escape/close while starting", async () => {
    const onOpenChange = vi.fn();
    const h = render(
      <ExperimentAddModelDialog
        open
        onOpenChange={onOpenChange}
        models={[]}
        availableProviderIds={["openrouter"]}
        takenKeys={TAKEN}
        suiteName="Suite"
        selectedSlot={SELECTED_SLOT}
        onSelectSlot={() => {}}
        plan={makePlan()}
        planError={null}
        syncToSuite
        onSyncToSuiteChange={() => {}}
        busy
        message={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await settle();

    const confirm = h.$$("button").find((b) => b.textContent === "Starting…");
    expect(confirm).toBeTruthy();
    const cancel = h.$$("button").find((b) => b.textContent === "Cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    cleanup(h);
  });

  it("renders the single live message region with the given text", async () => {
    const { h } = renderDialog({
      selectedSlot: SELECTED_SLOT,
      plan: makePlan(),
      message: { tone: "error", text: "Another execution owns the lease." },
    });
    await settle();

    const alert = h.$('[role="alert"]');
    expect(alert?.textContent).toContain("Another execution owns the lease.");
    cleanup(h);
  });
});
