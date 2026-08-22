// =============================================================================
// RecordsMovePointer — one-time anchored migration pointer (spec §O.1).
//
// On the first app open after the nav switch ships, if (and only if) the
// local database contains at least one run record, the header Records button
// renders a one-time anchored popover:
//
//   "Runs moved."
//   "Exact execution records now live here — same history, same links, new address."
//   [Got it]                                   (min-h-[44px]; dismisses forever)
//
// Dismissal persists in localStorage (records-move-pointer-dismissed). The
// popover also dismisses on any navigation or on opening the drawer. It never
// re-renders afterward, never appears for fresh databases (nothing moved for
// them), and is fully keyboard reachable (takes focus order after the Records
// button without trapping). Reduced motion: appears without transition.
// =============================================================================

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { useRunRepository } from "../lib/persistence/repository-context";
import type { RunRepository } from "../lib/persistence/run-repository";

export const DISMISSED_STORAGE_KEY = "records-move-pointer-dismissed";

function isDismissedInStorage(storage?: Storage): boolean {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    return Boolean(s?.getItem(DISMISSED_STORAGE_KEY));
  } catch {
    return false;
  }
}

function persistDismissal(storage?: Storage): void {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    s?.setItem(DISMISSED_STORAGE_KEY, "true");
  } catch {
    // Graceful degradation when storage is blocked or inaccessible
  }
}

export interface RecordsMovePointerProps {
  /** Optional run repository override for checking existing runs */
  runRepo?: RunRepository | null;
  /** Explicit override for existing runs count check */
  hasExistingRuns?: boolean;
  /** Whether the records drawer is currently open (triggers immediate dismissal) */
  recordsOpen?: boolean;
  /** Callback fired on dismissal */
  onDismiss?: () => void;
  /** Custom storage interface if needed (defaults to window.localStorage) */
  storage?: Storage;
}

export function RecordsMovePointer({
  runRepo: propRunRepo,
  hasExistingRuns,
  recordsOpen = false,
  onDismiss,
  storage,
}: RecordsMovePointerProps): ReactElement | null {
  const contextRunRepo = useRunRepository();
  const repo = propRunRepo !== undefined ? propRunRepo : contextRunRepo;
  const [dismissed, setDismissed] = useState<boolean>(() => isDismissedInStorage(storage));
  const [hasRuns, setHasRuns] = useState<boolean>(() => hasExistingRuns === true);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    persistDismissal(storage);
    onDismiss?.();
  }, [storage, onDismiss]);

  // Synchronize hasExistingRuns prop if explicitly provided
  useEffect(() => {
    if (hasExistingRuns !== undefined) {
      setHasRuns(hasExistingRuns);
    }
  }, [hasExistingRuns]);

  // Check run repository if hasExistingRuns was not explicitly passed
  useEffect(() => {
    if (dismissed || hasExistingRuns !== undefined || !repo) return;
    let active = true;

    void repo
      .list({ limit: 1 })
      .then((runs) => {
        if (active && runs.length > 0) {
          setHasRuns(true);
        }
      })
      .catch(() => {
        // Storage read error: fail closed (no pointer)
      });

    return () => {
      active = false;
    };
  }, [dismissed, hasExistingRuns, repo]);

  // Dismiss on opening the records drawer (spec §O.1)
  useEffect(() => {
    if (recordsOpen && !dismissed) {
      handleDismiss();
    }
  }, [recordsOpen, dismissed, handleDismiss]);

  // Dismiss on any navigation (spec §O.1)
  const location = useLocation();
  const initialLocationRef = useRef<string>(location.pathname + location.search);
  useEffect(() => {
    if (!dismissed && location.pathname + location.search !== initialLocationRef.current) {
      handleDismiss();
    }
  }, [location.pathname, location.search, dismissed, handleDismiss]);

  if (dismissed || !hasRuns) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-records-move-pointer=""
      className="motion-state absolute right-0 top-full z-40 mt-2 flex w-72 flex-col gap-2.5 rounded-lg border border-edge-bright bg-raised p-3 shadow-popover motion-reduce:transition-none sm:w-80"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-text">Runs moved.</h2>
        <p className="text-xs leading-relaxed text-text-secondary">
          Exact execution records now live here — same history, same links, new address.
        </p>
      </div>
      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={handleDismiss}
          className="motion-state flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-edge bg-panel px-3 text-xs font-medium text-text hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
