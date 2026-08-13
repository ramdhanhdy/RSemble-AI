// =============================================================================
// RSemble AI — Repository context provider
//
// Initializes the Dexie database and exposes repository instances to the React
// tree. Handles initialization failure gracefully: Compare stays operational,
// Runs/Evaluations show a blocking storage error with Retry.
//
// Child 02 (Canonical Tasks) Milestone B — Task 3: composes the Task
// repository beside run → eval → fusion. A canonical Task migration failure is
// bounded to `taskMigrationError` and leaves Compare's established repositories
// operational (spec §8).
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
  type StorageError,
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
  /** Additive canonical Task migration failure, if one prevented Task catalog
   *  publication without affecting existing Compare repositories. */
  taskMigrationError?: StorageError | null;
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
  taskMigrationError: null,
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

/** Read the bounded canonical Task migration failure, if Task catalog storage
 * could not be prepared while the established Compare stores remain ready. */
export function useTaskMigrationError(): StorageError | null {
  return useContext(RepositoryContext).taskMigrationError ?? null;
}

export function useStorageState(): StorageState {
  return useContext(RepositoryContext).storageState;
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [handle, setHandle] = useState<DatabaseHandle | null>(null);
  const [storageState, setStorageState] = useState<StorageState>("ready");
  const [taskMigrationError, setTaskMigrationError] = useState<StorageError | null>(null);
  const [repositoriesReady, setRepositoriesReady] = useState(false);
  const initialize = useCallback(() => {
    const h = createDatabase();
    setHandle(h);
    setStorageState(h.state);
    setRepositoriesReady(false);
    setTaskMigrationError(null);

    h.db.onStateChange((s) => {
      setStorageState(s);
    });

    h.ready
      .then(() => {
        setTaskMigrationError(h.taskMigrationError);
        setRepositoriesReady(true);
        setStorageState(h.state);
      })
      .catch(() => {
        setTaskMigrationError(null);
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
    setTaskMigrationError(null);
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
    () =>
      repositoriesReady && handle && taskMigrationError === null
        ? createTaskRepository(handle.db)
        : null,
    [repositoriesReady, handle, taskMigrationError],
  );

  const value = useMemo<RepositoryContextValue>(
    () => ({
      runRepo,
      evalRepo,
      fusionRepo,
      taskRepo,
      db: handle?.db ?? null,
      storageState,
      taskMigrationError,
      retry,
    }),
    [runRepo, evalRepo, fusionRepo, taskRepo, handle, storageState, taskMigrationError, retry],
  );
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}
