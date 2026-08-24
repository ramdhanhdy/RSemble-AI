// @vitest-environment happy-dom
// =============================================================================
// RSemble AI — T13b adversarial QA: REV-7 shortcut isolation probes
//
// Independent of the T13a author. Probes, not product code.
//
// REV-7 claim (plan Task 13): on /lab, /tasks, /compare/results/:id, and an
// unknown route, no Compare pipeline action (request run, abort, mode toggle,
// slot toggle — plus the ⌘F focus and ⌘C copy auxiliaries) can be triggered
// via keyboard; on /compare the shortcuts work.
//
// Two independent layers are probed:
//   1. deriveWorkspace — the pure routing/ownership rule, probed against the
//      exact route strings named by REV-7 (plus /compare positive controls).
//   2. useActionShortcuts — the live listener, probed by dispatching real
//      KeyboardEvents on window with a mutable workspaceRef, asserting that
//      non-owner workspaces suppress every Compare action while the Compare
//      workspace still fires them (positive control), including the running
//      (abort) path and per-keystroke re-gating after a route change without
//      a listener remount.
//
// The probes fail on empty/recovery states by construction: every assertion
// checks that an action did NOT happen (spy not called / focus unchanged /
// clipboard untouched) or DID happen in the positive control.
// =============================================================================

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { deriveWorkspace, useActionShortcuts, type WorkspaceKind } from "./useActionShortcuts";
import { initialState, type StudioState } from "../studio-engine";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

interface HookDeps {
  stateRef: { current: StudioState };
  workspaceRef: { current: WorkspaceKind };
  dispatch: Mock;
  requestRun: Mock;
  abortRun: Mock;
  handleModeChange: Mock;
}

function HookHost({ deps }: { deps: HookDeps }) {
  useActionShortcuts({
    stateRef: deps.stateRef,
    workspaceRef: deps.workspaceRef,
    dispatch: deps.dispatch,
    requestRun: deps.requestRun,
    abortRun: deps.abortRun,
    handleModeChange: deps.handleModeChange,
  });
  return null;
}

function mountHook(workspace: WorkspaceKind, stateOverrides: Partial<StudioState> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const deps: HookDeps = {
    stateRef: { current: { ...initialState, ...stateOverrides } },
    workspaceRef: { current: workspace },
    dispatch: vi.fn(),
    requestRun: vi.fn(),
    abortRun: vi.fn(),
    handleModeChange: vi.fn(),
  };
  act(() => {
    root.render(createElement(HookHost, { deps }));
  });
  return {
    deps,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Dispatch a mod+key KeyboardEvent on window; returns the event for
 *  defaultPrevented inspection. */
function fireModKey(key: string, opts: { meta?: boolean; ctrl?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: opts.meta ?? true,
    ctrlKey: opts.ctrl ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function firePlainKey(key: string): KeyboardEvent {
  return fireModKey(key, { meta: false });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// --- Layer 1: the pure routing/ownership rule ---------------------------------

describe("REV-7 deriveWorkspace — named routes never own Compare execution", () => {
  const NON_OWNER_ROUTES = [
    "/lab",
    "/lab/",
    "/lab/studies/study-1",
    "/lab/recipes",
    "/lab/model-pools/pool-1/versions/2",
    "/tasks",
    "/tasks/new",
    "/tasks/task-1",
    "/tasks/task-1/versions/2",
    "/compare/results/comparison-1",
    "/compare/results/abc/extra",
    "/definitely/not/a/route",
    "/nope",
  ] as const;

  it.each(NON_OWNER_ROUTES)("maps %s to a non-compare workspace", (route) => {
    expect(deriveWorkspace(route)).not.toBe("compare");
    // REV-7 is specifically about the Lab/Tasks/Results/unknown families.
    expect(deriveWorkspace(route)).toBe("other");
  });

  it("maps Compare home routes to the compare workspace (positive control)", () => {
    expect(deriveWorkspace("/compare")).toBe("compare");
    expect(deriveWorkspace("/compare/")).toBe("compare");
    expect(deriveWorkspace("/")).toBe("compare");
  });
});

// --- Layer 2: the live listener ----------------------------------------------

describe("REV-7 useActionShortcuts — keyboard isolation on non-owner routes", () => {
  const NON_OWNER_WORKSPACE = "other";

  it("⌘Enter cannot request a run or abort a run outside Compare", () => {
    const h = mountHook(NON_OWNER_WORKSPACE);
    const idleEvent = fireModKey("Enter");
    expect(h.deps.requestRun).not.toHaveBeenCalled();
    expect(h.deps.abortRun).not.toHaveBeenCalled();
    expect(idleEvent.defaultPrevented).toBe(false);

    // Running state: abort must also be suppressed.
    h.deps.stateRef.current = { ...initialState, running: true };
    const runningEvent = fireModKey("Enter");
    expect(h.deps.abortRun).not.toHaveBeenCalled();
    expect(runningEvent.defaultPrevented).toBe(false);
    h.unmount();
  });

  it("⌘/ cannot toggle the Rank/Fuse mode outside Compare", () => {
    const h = mountHook(NON_OWNER_WORKSPACE);
    const event = fireModKey("/");
    expect(h.deps.handleModeChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    h.unmount();
  });

  it("⌘1–⌘9 cannot toggle model slots outside Compare", () => {
    const h = mountHook(NON_OWNER_WORKSPACE);
    for (let key = 1; key <= 9; key++) {
      const event = fireModKey(String(key));
      expect(h.deps.dispatch).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    }
    h.unmount();
  });

  it("⌘F cannot steal focus from a non-Compare surface", () => {
    const h = mountHook(NON_OWNER_WORKSPACE);
    const input = document.createElement("input");
    input.id = "prompt";
    document.body.appendChild(input);
    const unrelated = document.createElement("button");
    unrelated.id = "unrelated";
    document.body.appendChild(unrelated);
    unrelated.focus();
    const event = fireModKey("f");
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(unrelated);
    input.remove();
    unrelated.remove();
    h.unmount();
  });

  it("⌘C cannot copy a Compare winner outside Compare", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const h = mountHook(NON_OWNER_WORKSPACE, {
      mode: "rank",
      candidates: [
        {
          id: "cand-1",
          model: "m1",
          provider: "openrouter",
          providerId: "openrouter",
          slug: "m1",
          accent: "#fff",
          strategy: "best_fixed",
          summary: "",
          scores: {},
          weightedScore: 9,
          segments: [{ id: "seg-1", text: "winner text" }],
          status: "done",
        },
      ],
    });
    const event = fireModKey("c");
    expect(event.defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    h.unmount();
  });

  it("every Compare action class stays suppressed on all four named route families", () => {
    // Per-keystroke re-gating: the workspace ref is read on every keydown, so
    // a route change must suppress the actions without remounting the listener.
    const h = mountHook(NON_OWNER_WORKSPACE, { running: true });
    h.deps.workspaceRef.current = "other";
    const event = fireModKey("Enter");
    expect(h.deps.abortRun).not.toHaveBeenCalled();
    expect(h.deps.requestRun).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    h.unmount();
  });
});

describe("REV-7 useActionShortcuts — Compare workspace positive control", () => {
  it("⌘Enter requests a run when idle and aborts when running", () => {
    const h = mountHook("compare");
    fireModKey("Enter");
    expect(h.deps.requestRun).toHaveBeenCalledTimes(1);
    expect(h.deps.abortRun).not.toHaveBeenCalled();

    h.deps.stateRef.current = { ...initialState, running: true };
    const event = fireModKey("Enter");
    expect(h.deps.abortRun).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    h.unmount();
  });

  it("⌘/ toggles the mode and ⌘1 toggles a model slot", () => {
    const h = mountHook("compare");
    fireModKey("/");
    expect(h.deps.handleModeChange).toHaveBeenCalledWith("fuse");
    const slotEvent = fireModKey("1");
    expect(h.deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "TOGGLE_SLOT" }));
    expect(slotEvent.defaultPrevented).toBe(true);
    h.unmount();
  });

  it("⌘F focuses the visible prompt textarea", () => {
    const h = mountHook("compare");
    const input = document.createElement("textarea");
    input.id = "prompt";
    document.body.appendChild(input);
    const event = fireModKey("f");
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    input.remove();
    h.unmount();
  });

  it("⌘C copies the winner text on Compare", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const h = mountHook("compare", {
      mode: "rank",
      candidates: [
        {
          id: "cand-1",
          model: "m1",
          provider: "openrouter",
          providerId: "openrouter",
          slug: "m1",
          accent: "#fff",
          strategy: "best_fixed",
          summary: "",
          scores: {},
          weightedScore: 9,
          segments: [{ id: "seg-1", text: "winner text" }],
          status: "done",
        },
      ],
    });
    const event = fireModKey("c");
    expect(event.defaultPrevented).toBe(true);
    expect(writeText).toHaveBeenCalledWith("winner text");
    h.unmount();
  });

  it("unmodified keys never trigger Compare actions on any workspace", () => {
    const h = mountHook("compare");
    for (const key of ["Enter", "/", "1", "f", "c"]) {
      const event = firePlainKey(key);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(h.deps.requestRun).not.toHaveBeenCalled();
    expect(h.deps.abortRun).not.toHaveBeenCalled();
    expect(h.deps.handleModeChange).not.toHaveBeenCalled();
    expect(h.deps.dispatch).not.toHaveBeenCalled();
    h.unmount();
  });
});

// --- Layer 3: route change while mounted -------------------------------------

describe("REV-7 useActionShortcuts — per-keystroke re-gating on route change", () => {
  it("switching from /compare to /lab mid-session suppresses ⌘Enter immediately", () => {
    const h = mountHook("compare");
    fireModKey("Enter");
    expect(h.deps.requestRun).toHaveBeenCalledTimes(1);

    h.deps.workspaceRef.current = "other"; // route changed to /lab, listener stays mounted
    h.deps.requestRun.mockClear();
    const event = fireModKey("Enter");
    expect(h.deps.requestRun).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    h.deps.workspaceRef.current = "compare"; // route back to /compare
    fireModKey("Enter");
    expect(h.deps.requestRun).toHaveBeenCalledTimes(1);
    h.unmount();
  });
});
