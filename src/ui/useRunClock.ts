// =============================================================================
// useRunClock — a single shared 1Hz clock for the whole run.
// Replaces per-candidate setInterval timers with one source of truth.
// =============================================================================

import { useEffect, useState } from "react";

/**
 * Returns a monotonically increasing `now` timestamp (ms) that updates once
 * per second while `active` is true. When `active` is false the clock is
 * stopped and the last value is frozen.
 */
export function useRunClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return now;
}

/** Convenience: compute elapsed whole seconds from a start timestamp. */
export function elapsedSeconds(startedAt: number | undefined, now: number): number {
  if (startedAt == null) return 0;
  return Math.max(0, Math.round((now - startedAt) / 1000));
}
