// =============================================================================
// useNarrowing — interactive narrowing model for the profile dossier (Fable §7.6).
//
// Manages active evidence-table narrowings as removable chips, mirrors them in
// the URL query string, and handles focus management: applying a narrowing moves
// focus to the table heading; clearing returns focus to the originating control.
//
// Narrowings are keyed by a stable string (e.g. "family:code-transformation")
// and carry a human-readable label. The hook is pure state management — it does
// not perform the actual filtering; the parent passes the active narrowings to
// the evidence table.
// =============================================================================

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export interface Narrowing {
  key: string;
  label: string;
}

export interface UseNarrowingOptions {
  /** URL param name for the narrowing list (default "narrow"). */
  paramName?: string;
}

export interface UseNarrowingResult {
  /** Active narrowings in insertion order. */
  narrowings: readonly Narrowing[];
  /** Add a narrowing (idempotent by key). Returns true if newly added. */
  apply: (narrowing: Narrowing) => boolean;
  /** Remove one narrowing by key. */
  remove: (key: string) => void;
  /** Remove all narrowings. */
  clearAll: () => void;
  /** Ref to set on the element that should receive focus after apply. */
  tableHeadingRef: React.RefObject<HTMLHeadingElement>;
  /** Ref to set on the last originating control (for clear focus return). */
  originRef: React.RefObject<HTMLElement | null>;
  /** Call after applying a narrowing to move focus to the table heading. */
  focusTableHeading: () => void;
  /** Call before clearing to capture the originating control for focus return. */
  captureOrigin: (el: HTMLElement | null) => void;
}

const DEFAULT_PARAM = "narrow";

function decodeNarrowings(raw: string | null): Narrowing[] {
  if (!raw) return [];
  return raw
    .split(",")
    .filter(Boolean)
    .map((key) => ({ key, label: key }));
}

export function useNarrowing(options: UseNarrowingOptions = {}): UseNarrowingResult {
  const paramName = options.paramName ?? DEFAULT_PARAM;
  const [searchParams, setSearchParams] = useSearchParams();

  // Derive narrowings from URL — the URL is the source of truth.
  const narrowings = useMemo<Narrowing[]>(() => {
    const raw = searchParams.get(paramName);
    return decodeNarrowings(raw);
  }, [searchParams, paramName]);

  // We also keep a local label map so labels survive URL round-trips.
  const labelMapRef = useRef<Map<string, string>>(new Map());

  // Hydrate label map from URL on first render.
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated) {
    for (const n of narrowings) {
      if (n.label !== n.key) {
        labelMapRef.current.set(n.key, n.label);
      }
    }
    setHydrated(true);
  }

  const tableHeadingRef = useRef<HTMLHeadingElement>(null);
  const originRef = useRef<HTMLElement | null>(null);

  const syncUrl = useCallback(
    (keys: string[]) => {
      const next = new URLSearchParams(searchParams);
      if (keys.length === 0) {
        next.delete(paramName);
      } else {
        next.set(paramName, keys.join(","));
      }
      // Sort for deterministic URLs.
      next.sort();
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams, paramName],
  );

  const apply = useCallback(
    (narrowing: Narrowing): boolean => {
      const existing = narrowings.find((n) => n.key === narrowing.key);
      if (existing) return false;
      labelMapRef.current.set(narrowing.key, narrowing.label);
      const nextKeys = [...narrowings.map((n) => n.key), narrowing.key];
      syncUrl(nextKeys);
      return true;
    },
    [narrowings, syncUrl],
  );

  const remove = useCallback(
    (key: string) => {
      const nextKeys = narrowings.map((n) => n.key).filter((k) => k !== key);
      syncUrl(nextKeys);
    },
    [narrowings, syncUrl],
  );

  const clearAll = useCallback(() => {
    syncUrl([]);
  }, [syncUrl]);

  const focusTableHeading = useCallback(() => {
    requestAnimationFrame(() => {
      tableHeadingRef.current?.focus();
    });
  }, []);

  const captureOrigin = useCallback((el: HTMLElement | null) => {
    originRef.current = el;
  }, []);

  // Enrich narrowings with labels from the map.
  const enriched = useMemo<Narrowing[]>(
    () =>
      narrowings.map((n) => ({
        key: n.key,
        label: labelMapRef.current.get(n.key) ?? n.label,
      })),
    [narrowings],
  );

  return {
    narrowings: enriched,
    apply,
    remove,
    clearAll,
    tableHeadingRef,
    originRef,
    focusTableHeading,
    captureOrigin,
  };
}
