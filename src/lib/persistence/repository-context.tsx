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
// operational (spec §8). Child 03 Milestone A Task 3 publishes Task Set
// storage independently of that Task-catalog migration boundary.
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
import type { FusionStudyRepository } from "./fusion-study-repository";
import { createTaskRepository, type TaskRepository } from "./task-repository";
import { createTaskSetRepository, type TaskSetRepository } from "./task-set-repository";
import { createEvidenceRepository, type EvidenceRepository } from "./evidence-repository";
import { createStudyRepository, type StudyRepository } from "./study-repository";
import { createLabAssetRepository, type LabAssetRepository } from "./lab-asset-repository";
import { createModelRollupRepository, type ModelRollupRepository } from "./model-rollup-repository";
import { createComparisonRepository } from "./comparison-repository";
import { createRecordsRepository, type RecordsRepository } from "../records/records-repository";
export interface RepositoryContextValue {
  runRepo: RunRepository | null;
  evalRepo: EvaluationRepository | null;
  fusionRepo: FusionStudyRepository | null;
  taskRepo: TaskRepository | null;
  /** Optional so out-of-ownership test doubles keep typechecking. Published
   *  only after the database is ready; independent of taskMigrationError. */
  taskSetRepo?: TaskSetRepository | null;
  /** Evidence derivation repository for Observations, Eligibility Decisions,
   *  Model Configuration snapshots, and index jobs (spec §10, §12.1). */
  evidenceRepo?: EvidenceRepository | null;
  /** First-party Study repository (schema v12/v13, spec §4/§5). */
  studyRepo?: StudyRepository | null;
  /** Reusable Lab asset repository (schema v12/v13, spec §6). */
  labAssetRepo?: LabAssetRepository | null;
  /** Versioned Model Rollup definition authority (schema v14). */
  modelRollupRepo?: ModelRollupRepository | null;
  /** Read-only typed composition over Runs and child-owned semantic indexes. */
  recordsRepo?: RecordsRepository | null;
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
  taskSetRepo: null,
  db: null,
  evidenceRepo: null,
  modelRollupRepo: null,
  recordsRepo: null,
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

export function useTaskSetRepository(): TaskSetRepository | null {
  return useContext(RepositoryContext).taskSetRepo ?? null;
}

export function useEvidenceRepository(): EvidenceRepository | null {
  return useContext(RepositoryContext).evidenceRepo ?? null;
}

export function useStudyRepository(): StudyRepository | null {
  return useContext(RepositoryContext).studyRepo ?? null;
}

export function useLabAssetRepository(): LabAssetRepository | null {
  return useContext(RepositoryContext).labAssetRepo ?? null;
}

export function useModelRollupRepository(): ModelRollupRepository | null {
  return useContext(RepositoryContext).modelRollupRepo ?? null;
}
export function useRecordsRepository(): RecordsRepository | null {
  return useContext(RepositoryContext).recordsRepo ?? null;
}

/** Storage-level retry for surfaces whose Retry must re-run database
 *  initialization (e.g. the Records drawer when no repository exists). */
export function useStorageRetry(): () => void {
  return useContext(RepositoryContext).retry;
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
  // Schema v13 cutover: legacy fusion stores are deleted; fusionRepo is null at runtime.
  const fusionRepo = null;
  const studyRepo = useMemo(
    () => (repositoriesReady && handle ? createStudyRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const labAssetRepo = useMemo(
    () => (repositoriesReady && handle ? createLabAssetRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const taskRepo = useMemo(
    () =>
      repositoriesReady && handle && taskMigrationError === null
        ? createTaskRepository(handle.db)
        : null,
    [repositoriesReady, handle, taskMigrationError],
  );
  const taskSetRepo = useMemo(
    () => (repositoriesReady && handle ? createTaskSetRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const evidenceRepo = useMemo(
    () => (repositoriesReady && handle ? createEvidenceRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const modelRollupRepo = useMemo(
    () => (repositoriesReady && handle ? createModelRollupRepository(handle.db) : null),
    [repositoriesReady, handle],
  );
  const recordsRepo = useMemo(() => {
    if (!repositoriesReady || !handle || !runRepo) return null;
    return createRecordsRepository({
      runRepo,
      comparisonRepo: createComparisonRepository(handle.db, runRepo),
      evaluationRepo: evalRepo,
      studyRepo,
      evidenceRepo,
    });
  }, [repositoriesReady, handle, runRepo, evalRepo, studyRepo, evidenceRepo]);

  const value = useMemo<RepositoryContextValue>(
    () => ({
      runRepo,
      evalRepo,
      fusionRepo,
      taskRepo,
      taskSetRepo,
      evidenceRepo,
      studyRepo,
      labAssetRepo,
      modelRollupRepo,
      recordsRepo,
      db: handle?.db ?? null,
      storageState,
      taskMigrationError,
      retry,
    }),
    [
      runRepo,
      evalRepo,
      taskRepo,
      taskSetRepo,
      evidenceRepo,
      studyRepo,
      labAssetRepo,
      modelRollupRepo,
      recordsRepo,
      handle,
      storageState,
      taskMigrationError,
      retry,
    ],
  );
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}
