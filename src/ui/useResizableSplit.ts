import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_WIDTH = 320;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 420;
const STORAGE_KEY = "rsemble.splitRatio.v1";

function readStoredRatio(): number | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const ratio = parseFloat(stored);
      if (!isNaN(ratio) && ratio > 0 && ratio < 1) return ratio;
    }
  } catch {}
  return null;
}

function clampWidth(w: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
}

export function useResizableSplit() {
  // Spec §3.1: persist a RATIO (commandWidth / containerWidth) so the split
  // survives viewport changes. On first paint the container isn't measured
  // yet, so we start from the default and let the layout effect below
  // recompute from the stored ratio once the container is measured.
  const [commandWidth, setCommandWidth] = useState<number>(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(commandWidth);

  // Once the container is measured (and on resize), recompute the command
  // width from the persisted ratio so it restores accurately regardless of
  // the shell frame / IconRail width.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const recompute = () => {
      const ratio = readStoredRatio();
      if (ratio === null) return;
      const containerW = el.getBoundingClientRect().width;
      if (containerW <= 0) return;
      const w = clampWidth(Math.round(ratio * containerW));
      widthRef.current = w;
      setCommandWidth(w);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const persist = useCallback((w: number) => {
    try {
      const rect = containerRef.current?.getBoundingClientRect();
      const containerW = rect?.width ?? window.innerWidth;
      const ratio = containerW > 0 ? w / containerW : 0;
      localStorage.setItem(STORAGE_KEY, String(ratio));
    } catch {}
  }, []);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = e.clientX - rect.left;
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
    widthRef.current = clamped;
    setCommandWidth(clamped);
  }, []);

  const onPointerUp = useCallback(() => {
    setDragging(false);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    persist(widthRef.current);
  }, [onPointerMove, persist]);

  const onDividerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      widthRef.current = commandWidth;
      setDragging(true);
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [onPointerMove, onPointerUp, commandWidth],
  );

  const onDividerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 64 : 16;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setCommandWidth((w) => {
          const next = Math.max(MIN_WIDTH, w - step);
          widthRef.current = next;
          persist(next);
          return next;
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setCommandWidth((w) => {
          const next = Math.min(MAX_WIDTH, w + step);
          widthRef.current = next;
          persist(next);
          return next;
        });
      } else if (e.key === "Home") {
        e.preventDefault();
        widthRef.current = MIN_WIDTH;
        persist(MIN_WIDTH);
        setCommandWidth(MIN_WIDTH);
      } else if (e.key === "End") {
        e.preventDefault();
        widthRef.current = MAX_WIDTH;
        persist(MAX_WIDTH);
        setCommandWidth(MAX_WIDTH);
      }
    },
    [persist],
  );

  const onDoubleClick = useCallback(() => {
    widthRef.current = DEFAULT_WIDTH;
    persist(DEFAULT_WIDTH);
    setCommandWidth(DEFAULT_WIDTH);
  }, [persist]);

  useEffect(() => {
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  return {
    commandWidth,
    dragging,
    onDividerPointerDown,
    onDividerKeyDown,
    onDoubleClick,
    containerRef,
    min: MIN_WIDTH,
    max: MAX_WIDTH,
  };
}
