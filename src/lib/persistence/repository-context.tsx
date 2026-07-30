// =============================================================================
// RSemble AI — Repository context provider
//
// Initializes the Dexie database and exposes repository instances to the React
// tree. Handles initialization failure gracefully: Compare stays operational,
// Runs/Evaluations show a blocking storage error with Retry.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createDatabase, type DatabaseHandle, type StorageState } from "./database";
import { createRunRepository, type RunRepository } from "./run-repository";
import { createEvaluationRepository, type EvaluationRepository } from "./evaluation-repository";

export interface RepositoryContextValue {
  runRepo: RunRepository | null;
  evalRepo: EvaluationRepository | null;
  storageState: StorageState;
  /** Retry database initialization after a failure. */
  retry: () => void;
}

const RepositoryContext = createContext<RepositoryContextValue>({
  runRepo: null,
  evalRepo: null,
  storageState: "unavailable",
  retry: () => undefined,
});

export function useRunRepository(): RunRepository | null {
  return useContext(RepositoryContext).runRepo;
}

export function useEvaluationRepository(): EvaluationRepository | null {
  return useContext(RepositoryContext).evalRepo;
}

export function useStorageState(): StorageState {
  return useContext(RepositoryContext).storageState;
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [handle, setHandle] = useState<DatabaseHandle | null>(null);
  const [storageState, setStorageState] = useState<StorageState>("ready");

  const initialize = useCallback(() => {
    const h = createDatabase();
    setHandle(h);
    setStorageState(h.state);

    h.db.onStateChange((s) => {
      setStorageState(s);
    });

    h.ready
      .then(() => {
        setStorageState(h.state);
      })
      .catch(() => {
        setStorageState("unavailable");
      });
  }, []);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const retry = useCallback(() => {
    setHandle((prev) => {
      if (prev) {
        try {
          prev.db.close();
        } catch {
          // best-effort
        }
      }
      return null;
    });
    setStorageState("ready");
    // Reinitialize on next tick.
    setTimeout(initialize, 0);
  }, [initialize]);

  const runRepo = useMemo(
    () => (handle ? createRunRepository(handle.db) : null),
    [handle],
  );
  const evalRepo = useMemo(
    () => (handle && runRepo ? createEvaluationRepository(handle.db, runRepo) : null),
    [handle, runRepo],
  );

  const value = useMemo<RepositoryContextValue>(
    () => ({ runRepo, evalRepo, storageState, retry }),
    [runRepo, evalRepo, storageState, retry],
  );

  return (
    <RepositoryContext.Provider value={value}>
      {children}
    </RepositoryContext.Provider>
  );
}
