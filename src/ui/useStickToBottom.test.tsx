// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useStickToBottom, isAtBottom, type StickToBottomResult } from "./useStickToBottom";

// React 18 checks this global to decide whether act() warnings are suppressed.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Pure decision function — no DOM needed.
// ---------------------------------------------------------------------------

describe("isAtBottom — the pinning decision function", () => {
  it("returns true when scrolled to the exact bottom", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })).toBe(true);
  });

  it("returns true within the 32px threshold", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 870, clientHeight: 100 })).toBe(true);
  });

  it("returns false when scrolled away from the bottom", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 100 })).toBe(false);
  });

  it("returns false just outside the default 32px threshold", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 867, clientHeight: 100 })).toBe(false);
  });

  it("honors a custom threshold", () => {
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 850, clientHeight: 100 }, 50)).toBe(true);
    expect(isAtBottom({ scrollHeight: 1000, scrollTop: 849, clientHeight: 100 }, 50)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hook behavior — exercises useEffect (scroll-on-dep) and onScroll (pinning)
// with a real DOM element via happy-dom.
// ---------------------------------------------------------------------------

let hook: StickToBottomResult<HTMLDivElement> | null = null;

function TestComp({ dep }: { dep: string }) {
  hook = useStickToBottom<HTMLDivElement>(dep);
  return (
    <div ref={hook.ref} onScroll={hook.onScroll} style={{ height: 200, overflow: "auto" }}>
      <div style={{ height: 1000 }}>{dep}</div>
    </div>
  );
}

/** Override layout-dependent properties that happy-dom doesn't compute. */
function setScrollGeometry(el: HTMLDivElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

describe("useStickToBottom — hook behavior", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    hook = null;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("pinned: scrolls to bottom on dep change (initial mount)", () => {
    act(() => {
      root.render(<TestComp dep="a" />);
    });
    const el = hook!.ref.current!;
    setScrollGeometry(el, 1000, 200);
    el.scrollTop = 0;
    expect(hook!.pinned).toBe(true);

    // Dep change while pinned → effect should scroll to the bottom.
    act(() => {
      root.render(<TestComp dep="b" />);
    });
    expect(el.scrollTop).toBe(1000);
  });

  it("unpinned: does not scroll on dep change after the user scrolls away", () => {
    act(() => {
      root.render(<TestComp dep="a" />);
    });
    const el = hook!.ref.current!;
    setScrollGeometry(el, 1000, 200);

    // Scroll away from the bottom and fire onScroll to unpin.
    el.scrollTop = 0;
    act(() => {
      hook!.onScroll();
    });
    expect(hook!.pinned).toBe(false);

    // Dep change while unpinned → scrollTop must NOT change.
    el.scrollTop = 0;
    act(() => {
      root.render(<TestComp dep="b" />);
    });
    expect(el.scrollTop).toBe(0);
  });

  it("re-pin: scrolling back to the bottom threshold re-pins, then dep change scrolls", () => {
    act(() => {
      root.render(<TestComp dep="a" />);
    });
    const el = hook!.ref.current!;
    setScrollGeometry(el, 1000, 200);

    // Unpin.
    el.scrollTop = 0;
    act(() => {
      hook!.onScroll();
    });
    expect(hook!.pinned).toBe(false);

    // Scroll back near the bottom (within 32px: 1000 - 200 = 800, so ≥ 768).
    el.scrollTop = 780;
    act(() => {
      hook!.onScroll();
    });
    expect(hook!.pinned).toBe(true);

    // Dep change should now scroll to the bottom again.
    act(() => {
      root.render(<TestComp dep="b" />);
    });
    expect(el.scrollTop).toBe(1000);
  });
});
