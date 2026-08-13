// =============================================================================
// RSemble AI — Repository context provider
//
// Initializes the Dexie database and exposes repository instances to the React
// tree. Handles initialization failure gracefully: Compare stays operational,
// Runs/Evaluations show a blocking storage error with Retry.
//
// Child 02 (Canonical Tasks) Milestone B — Task 3: composes the Task
// repository beside run → eval → fusion. When storage initialization fails,
// `taskRepo` is null alongside the other repositories, preserving the current
// Compare fallback behavior (spec §8).
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createDatabase,
  type DatabaseHandle,
  type RSembleEvaluationDB,
  type StorageState,
} from "./database";
import { createRunRepository, type RunRepository } from "./run-repository";
import { createEvaluationRepository, type EvaluationRepository } from "./evaluation-repository";
import { createFusionStudyRepository, type FusionStudyRepository } from "./fusion-study-repository";
import { createTaskRepository, type TaskRepository } from "./task-repository";

export interface RepositoryContextValue {
  runRepo: RunRepository | null;
  evalRepo: EvaluationRepository | null;
  fusionRepo: FusionStudyRepository | null;
  taskRepo: TaskRepository | null;
  /** Raw Dexie handle for infrastructure that composes repositories (execution
   *  lease, experiment unit of work). Null while storage is unavailable. */
  db: RSembleEvaluationDB | null;
  storageState: StorageState;
  /** Retry database initialization after a failure. */
  retry: () => void;
}

export const RepositoryContext = createContext<RepositoryContextValue>({
  runRepo: null,
  evalRepo: null,
  fusionRepo: null,
  taskRepo: null,
  db: null,
  storageState: "unavailable",
  retry: () => undefined,
});

export function useRunRepository(): RunRepository | null {
  return useContext(RepositoryContext).runRepo;
}

export function useEvaluationRepository(): EvaluationRepository | null {
  return useContext(RepositoryContext).evalRepo;
}

export function useFusionStudyRepository(): FusionStudyRepository | null {
  return useContext(RepositoryContext).fusionRepo;
}

export function useTaskRepository(): TaskRepository | null {
  return useContext(RepositoryContext).taskRepo;
}

export function useStorageState(): StorageState {
  return useContext(RepositoryContext).storageState;
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [handle, setHandle] = useState<DatabaseHandle | null>(null);
  const [storageState, setStorageState] = useState<StorageState>("ready");
  const [repositoriesReady, setRepositoriesReady] = useState(false);
  const initialize = useCallback(() => {
    const h = createDatabase();
    setHandle(h);
    setStorageState(h.state);
    setRepositoriesReady(false);

    h.db.onStateChange((s) => {
      setStorageState(s);
    });

    h.ready
      .then(() => {
        setRepositoriesReady(true);
        setStorageState(h.state);
      })
      .catch(() => {
        setRepositoriesReady(false);
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
    setRepositoriesReady(false);
    // Reinitialize on next tick.
    setTimeout(initialize, 0);
  }, [initialize]);

  const runRepo = useMemo(
    () => (repositoriesReady && handle ? createRunRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const evalRepo = useMemo(
    () =>
      repositoriesReady && handle && runRepo
        ? createEvaluationRepository(handle.db, runRepo)
        : null,
    [repositoriesReady, handle, runRepo],
  );
  const fusionRepo = useMemo(
    () => (repositoriesReady && handle ? createFusionStudyRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const taskRepo = useMemo(
    () => (repositoriesReady && handle ? createTaskRepository(handle.db) : null),
    [repositoriesReady, handle],
  );

  const value = useMemo<RepositoryContextValue>(
    () => ({
      runRepo,
      evalRepo,
      fusionRepo,
      taskRepo,
      db: handle?.db ?? null,
      storageState,
      retry,
    }),
    [runRepo, evalRepo, fusionRepo, taskRepo, handle, storageState, retry],
  );

  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}
