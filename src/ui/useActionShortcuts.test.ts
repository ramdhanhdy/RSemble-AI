// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi, type Mock } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { deriveWorkspace, useActionShortcuts, type WorkspaceKind } from "./useActionShortcuts";
import { initialState, type StudioState, type Action } from "../studio-engine";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface HookDeps {
  stateRef: { current: StudioState };
  workspaceRef: { current: WorkspaceKind };
  dispatch: React.Dispatch<Action>;
  requestRun: () => void;
  abortRun: () => void;
  handleModeChange: (mode: "rank" | "fuse") => void;
}

function HookHost(deps: HookDeps) {
  useActionShortcuts(deps);
  return null;
}

interface Mounted {
  container: HTMLDivElement;
  root: { unmount: () => void };
  spies: {
    dispatch: Mock;
    requestRun: Mock;
    abortRun: Mock;
    handleModeChange: Mock;
  };
  stateRef: { current: StudioState };
  workspaceRef: { current: WorkspaceKind };
}

function mountHook(workspace: WorkspaceKind, stateOverrides: Partial<StudioState> = {}): Mounted {
  const spies = {
    dispatch: vi.fn(),
    requestRun: vi.fn(),
    abortRun: vi.fn(),
    handleModeChange: vi.fn(),
  };
  const stateRef = { current: { ...initialState, ...stateOverrides } };
  const workspaceRef = { current: workspace };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(HookHost, {
        stateRef,
        workspaceRef,
        dispatch: spies.dispatch,
        requestRun: spies.requestRun,
        abortRun: spies.abortRun,
        handleModeChange: spies.handleModeChange,
      }),
    );
  });
  return { container, root, spies, stateRef, workspaceRef };
}

/** Dispatch a mod+key event on window; returns a spy on its preventDefault. */
function fireModKey(key: string): Mock {
  const e = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  const preventDefault = vi.spyOn(e, "preventDefault");
  act(() => {
    window.dispatchEvent(e);
  });
  return preventDefault;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useActionShortcuts workspace gating (plan 8.2 / spec §15.12)", () => {
  it("suppresses every Compare-only shortcut in the runs workspace", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const m = mountHook("runs", { running: false, mode: "fuse", fusedText: "fused answer" });

    // ⌘Enter — run/abort must not fire.
    let pd = fireModKey("Enter");
    expect(m.spies.requestRun).not.toHaveBeenCalled();
    expect(m.spies.abortRun).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    // ⌘/ — Rank ↔ Fuse toggle must not fire.
    pd = fireModKey("/");
    expect(m.spies.handleModeChange).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    // ⌘1 — slot toggle must not fire.
    pd = fireModKey("1");
    expect(m.spies.dispatch).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    // ⌘F — task-input focus must not fire.
    pd = fireModKey("f");
    expect(pd).not.toHaveBeenCalled();

    // ⌘C — copy winner must not fire.
    pd = fireModKey("c");
    expect(writeText).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    act(() => m.root.unmount());
    m.container.remove();
  });

  it("suppresses Compare-only shortcuts in evaluations and experiments workspaces", () => {
    for (const workspace of ["evaluations", "experiments"] as WorkspaceKind[]) {
      const m = mountHook(workspace);
      const pd = fireModKey("Enter");
      expect(m.spies.requestRun).not.toHaveBeenCalled();
      expect(m.spies.abortRun).not.toHaveBeenCalled();
      expect(pd).not.toHaveBeenCalled();
      act(() => m.root.unmount());
      m.container.remove();
    }
  });

  it("runs the pipeline on ⌘Enter in compare when idle, aborts when running", () => {
    const m = mountHook("compare", { running: false });

    const pd = fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(1);
    expect(m.spies.abortRun).not.toHaveBeenCalled();
    expect(pd).toHaveBeenCalled();

    // Flip to running — the same binding aborts.
    m.stateRef.current = { ...m.stateRef.current, running: true };
    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(1);
    expect(m.spies.abortRun).toHaveBeenCalledTimes(1);

    act(() => m.root.unmount());
    m.container.remove();
  });

  it("toggles Rank ↔ Fuse on ⌘/ in compare with the opposite mode", () => {
    const m = mountHook("compare", { mode: "rank" });

    fireModKey("/");
    expect(m.spies.handleModeChange).toHaveBeenCalledWith("fuse");

    m.stateRef.current = { ...m.stateRef.current, mode: "fuse" };
    fireModKey("/");
    expect(m.spies.handleModeChange).toHaveBeenCalledWith("rank");

    act(() => m.root.unmount());
    m.container.remove();
  });

  it("toggles model slots on ⌘1…⌘9 in compare only", () => {
    const m = mountHook("compare");
    const firstSlot = initialState.slots[0];
    expect(firstSlot).toBeTruthy();

    fireModKey("1");
    expect(m.spies.dispatch).toHaveBeenCalledWith({
      type: "TOGGLE_SLOT",
      id: firstSlot.id,
    });
    act(() => m.root.unmount());
    m.container.remove();
  });

  it("suppresses shortcuts at runtime when the workspace changes without remount", () => {
    const m = mountHook("compare", { running: false });

    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(1);

    // Switch workspace mid-session — the listener must gate on the ref value,
    // not on a value captured at mount.
    m.workspaceRef.current = "runs";
    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(1);

    // Switching back re-enables without a remount.
    m.workspaceRef.current = "compare";
    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(2);

    act(() => m.root.unmount());
    m.container.remove();
  });
});

// --- REV-5: explicit routing/ownership rule ----------------------------------
//
// Compare pipeline shortcuts (⌘Enter run/abort, ⌘/ mode, ⌘1–9 slots, ⌘F focus,
// ⌘C copy) fire ONLY on routes that own live Compare execution — Compare home
// (/compare, and / which redirects there). Every other route maps to a
// non-compare workspace so the listener and the command palette suppress
// Compare-only actions there. This is an opt-in ownership rule, not a default
// "compare" fallback with a "lab" arm bolted on (spec §15.12, REV-5).
describe("deriveWorkspace — explicit Compare ownership rule (REV-5, spec §15.12)", () => {
  it("classifies Compare home (/compare and /) as the compare workspace", () => {
    expect(deriveWorkspace("/compare")).toBe("compare");
    expect(deriveWorkspace("/")).toBe("compare");
  });

  it("classifies the live Compare execution surface as compare", () => {
    // The live execution surface is Compare home itself; trailing slashes and
    // exact match both own the pipeline.
    expect(deriveWorkspace("/compare/")).toBe("compare");
  });

  it("does NOT classify /compare/results/* as compare — historical results do not own live execution", () => {
    expect(deriveWorkspace("/compare/results/rec-123")).not.toBe("compare");
    expect(deriveWorkspace("/compare/results/rec-123")).toBe("other");
  });

  it("does NOT classify /lab or any Lab sub-route as compare", () => {
    expect(deriveWorkspace("/lab")).not.toBe("compare");
    expect(deriveWorkspace("/lab/studies")).not.toBe("compare");
    expect(deriveWorkspace("/lab/studies/study-1")).toBe("other");
  });

  it("does NOT classify /tasks or any Task sub-route as compare", () => {
    expect(deriveWorkspace("/tasks")).not.toBe("compare");
    expect(deriveWorkspace("/tasks/new")).not.toBe("compare");
    expect(deriveWorkspace("/tasks/task-1")).toBe("other");
  });

  it("does NOT classify unknown routes as compare", () => {
    expect(deriveWorkspace("/anything-else")).not.toBe("compare");
    expect(deriveWorkspace("/anything/else/deep")).toBe("other");
  });

  it("classifies the named non-compare workspaces by their route prefix", () => {
    expect(deriveWorkspace("/runs")).toBe("runs");
    expect(deriveWorkspace("/runs/run-1")).toBe("runs");
    expect(deriveWorkspace("/evaluations")).toBe("evaluations");
    expect(deriveWorkspace("/evaluations/sets")).toBe("evaluations");
    expect(deriveWorkspace("/experiments")).toBe("experiments");
    expect(deriveWorkspace("/experiments/exp-1")).toBe("experiments");
  });
});

describe("useActionShortcuts — non-owner routes suppress every Compare shortcut (REV-5)", () => {
  // The "other" workspace represents every route that does not own live
  // Compare execution: /lab, /tasks, /compare/results/*, and unknown routes.
  // The listener must suppress the full Compare shortcut set there.
  it("suppresses ⌘Enter, ⌘/, ⌘1, ⌘F, and ⌘C on the 'other' workspace", () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const m = mountHook("other", {
      running: false,
      mode: "fuse",
      fusedText: "fused answer",
    });

    // ⌘Enter — run/abort must not fire.
    let pd = fireModKey("Enter");
    expect(m.spies.requestRun).not.toHaveBeenCalled();
    expect(m.spies.abortRun).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    // ⌘/ — Rank ↔ Fuse toggle must not fire.
    pd = fireModKey("/");
    expect(m.spies.handleModeChange).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    // ⌘1 — slot toggle must not fire.
    pd = fireModKey("1");
    expect(m.spies.dispatch).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    // ⌘F — task-input focus must not fire.
    pd = fireModKey("f");
    expect(pd).not.toHaveBeenCalled();

    // ⌘C — copy winner must not fire.
    pd = fireModKey("c");
    expect(writeText).not.toHaveBeenCalled();
    expect(pd).not.toHaveBeenCalled();

    act(() => m.root.unmount());
    m.container.remove();
  });

  it("gates shortcuts live when navigating between compare and a non-owner route without remount", () => {
    const m = mountHook("compare", { running: false });

    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(1);

    // Navigate to a non-owner route (/lab) — the ref flips to "other" and the
    // listener must gate on the new value without re-registering.
    m.workspaceRef.current = "other";
    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(1);

    // Navigating back to Compare re-enables without a remount.
    m.workspaceRef.current = "compare";
    fireModKey("Enter");
    expect(m.spies.requestRun).toHaveBeenCalledTimes(2);

    act(() => m.root.unmount());
    m.container.remove();
  });
});
