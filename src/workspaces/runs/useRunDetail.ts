// =============================================================================
// useRunDetail — query hook for a single full run record (Phase 3 Task 3.1).
//
// Loads one RunRecordV2 by ID. Returns null for missing/not-found records.
// Uses a monotonically-increasing request ID so a stale async response cannot
// replace the current selection.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type { RunRecordV2 } from "../../lib/persistence/run-types";

export interface RunDetailState {
  record: RunRecordV2 | null;
  loading: boolean;
  error: string | null;
}

export function useRunDetail(repo: RunRepository | null, id: string | null): RunDetailState {
  const [state, setState] = useState<RunDetailState>({
    record: null,
    loading: false,
    error: null,
  });
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!id) {
      setState({ record: null, loading: false, error: null });
      return;
    }

    if (!repo) {
      setState({ record: null, loading: false, error: "Storage not available." });
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    function load() {
      const reqId = requestId;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      repo!
        .get(id!)
        .then((record) => {
          if (!cancelled && reqId === requestIdRef.current) {
            setState({ record, loading: false, error: null });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled && reqId === requestIdRef.current) {
            setState({
              record: null,
              loading: false,
              error: err instanceof Error ? err.message : "Failed to load run detail.",
            });
          }
        });
    }

    load();

    const unsubscribe = repo.subscribe(() => {
      if (!cancelled) {
        load();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repo, id]);

  return state;
}
