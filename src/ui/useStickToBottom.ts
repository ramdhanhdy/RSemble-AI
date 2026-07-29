// =============================================================================
// useStickToBottom — auto-scroll that respects the user's scroll position.
//
// Replaces the unconditional "scroll to end on every delta" effect that fought
// the user mid-stream. The transcript pins to the bottom only while the user is
// re-pins on demand.
// =============================================================================

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Pixels of slack that still count as "at the bottom". */
const PIN_THRESHOLD = 32;

/**
 * Pure decision: is the element scrolled to (near) its bottom?
 * Extracted so the pinning logic is testable without a DOM environment.
 */
export function isAtBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = PIN_THRESHOLD,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/**
 * Auto-scroll hook for a streaming transcript.
 *
 * @param dep — the content dependency (e.g. the live text). When it changes and
 *   the user is pinned to the bottom, the element scrolls to the end. When the
 *   user has scrolled away, their position is preserved.
 * @returns `{ ref, onScroll, pinned, jumpToLatest }` — attach `ref` + `onScroll`
 *   to the scrollable element; render a Jump-to-latest button when `!pinned`.
 */
export interface StickToBottomResult<T extends HTMLElement> {
  ref: RefObject<T>;
  onScroll: () => void;
  pinned: boolean;
  jumpToLatest: () => void;
}

export function useStickToBottom<T extends HTMLElement>(dep: unknown): StickToBottomResult<T> {
  const ref = useRef<T>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atBottom = isAtBottom(el);
    if (atBottom !== pinnedRef.current) {
      pinnedRef.current = atBottom;
      setPinned(atBottom);
    }
  }, []);

  // On dep change, follow the stream only if the user is still at the bottom.
  useEffect(() => {
    if (pinnedRef.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [dep]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  return { ref, onScroll, pinned, jumpToLatest };
}
