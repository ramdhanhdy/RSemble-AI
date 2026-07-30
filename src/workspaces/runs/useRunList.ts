// =============================================================================
// useRunList — query hook for run summaries (Phase 3 Task 3.1).
//
// Keeps repository state out of presentational components. Subscribes to the
// repository's change notifications so new completed runs appear without
// reload. Uses a monotonically-increasing request ID so a stale async response
// can never overwrite a newer query's results.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type { RunListQuery, RunSummary } from "../../lib/persistence/run-types";

export interface RunListState {
  summaries: RunSummary[];
  loading: boolean;
  error: string | null;
}

/** Serialize a RunListQuery to a stable string for the dependency array.
 *  Prevents a new query object reference from causing an infinite re-render loop. */
function stableQueryKey(q: RunListQuery): string {
  return [
    q.text ?? "",
    q.modelKey ?? "",
    q.status ?? "",
    q.mode ?? "",
    q.source ?? "",
    String(q.limit ?? ""),
    String(q.offset ?? ""),
  ].join("\0");
}

export function useRunList(repo: RunRepository | null, query: RunListQuery): RunListState {
  const [state, setState] = useState<RunListState>({
    summaries: [],
    loading: true,
    error: null,
  });
  // Monotonic request counter: only the latest in-flight request may commit.
  const requestIdRef = useRef(0);
  const queryKey = stableQueryKey(query);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (!repo) {
      setState({ summaries: [], loading: false, error: "Storage not available." });
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    function load() {
      const id = requestId;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      repo!
        .list(queryRef.current)
        .then((summaries) => {
          if (!cancelled && id === requestIdRef.current) {
            setState({ summaries, loading: false, error: null });
          }
        })
        .catch((err: unknown) => {
          if (!cancelled && id === requestIdRef.current) {
            setState({
              summaries: [],
              loading: false,
              error: err instanceof Error ? err.message : "Failed to load run history.",
            });
          }
        });
    }

    load();

    // Subscribe to repository changes and re-run the query.
    const unsubscribe = repo.subscribe(() => {
      if (!cancelled) {
        load();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repo, queryKey]);

  return state;
}
