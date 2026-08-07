// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi, type Mock } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useActionShortcuts, type WorkspaceKind } from "./useActionShortcuts";
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
