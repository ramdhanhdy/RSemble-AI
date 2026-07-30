// =============================================================================
// RSemble AI — Experiment controller React context (spec §11, Phase 7)
//
// Provides one app-lifetime ExperimentController to the React tree. Composes
// the Dexie-backed evaluation repository, run repository, cross-tab execution
// lease, in-tab ExecutionOwnerRegistry, unit of work, and the shared
// RunExecutor. SuiteEditor starts experiments through it; ExperimentProgress
// and the global execution strip subscribe to its events.
//
// The controller instance is created once per database handle and never
// recreated on navigation, so an active experiment survives route changes.
// =============================================================================

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { RepositoryContext } from "../persistence/repository-context";
import { DexieExperimentStore, createExperimentUnitOfWork } from "../persistence/experiment-unit-of-work";
import { createExecutionLease, type ExecutionLease } from "../execution-lease";
import { createRunExecutor } from "../run-executor";
import { useExecutionOwner } from "../execution-owner-context";
import { createExperimentController, type ExperimentController } from "./experiment-controller";

export interface ExperimentControllerContextValue {
  controller: ExperimentController | null;
  /** The tab's cross-tab execution lease — shared with the controller. The
   *  global execution strip subscribes to it for "owned by another tab" states. */
  lease: ExecutionLease | null;
}

const ExperimentControllerContext = createContext<ExperimentControllerContextValue>({
  controller: null,
  lease: null,
});

export function useExperimentController(): ExperimentController | null {
  return useContext(ExperimentControllerContext).controller;
}

export function useExecutionLease(): ExecutionLease | null {
  return useContext(ExperimentControllerContext).lease;
}

export function ExperimentControllerProvider({ children }: { children: ReactNode }) {
  const { db, evalRepo, runRepo } = useContext(RepositoryContext);
  const { registry: owner } = useExecutionOwner();

  const composed = useMemo<{ controller: ExperimentController; lease: ExecutionLease } | null>(() => {
    if (!db || !evalRepo || !runRepo) return null;
    const lease = createExecutionLease(db);
    const controller = createExperimentController({
      evalRepo,
      uow: createExperimentUnitOfWork(new DexieExperimentStore(db)),
      runRepo,
      lease,
      owner,
      executor: createRunExecutor(),
      generateId: () => crypto.randomUUID(),
      now: () => Date.now(),
      heartbeatMs: 0, // 0 selects the controller default (3000ms) lease-renew cadence
    });
    return { controller, lease };
  }, [db, evalRepo, runRepo, owner]);
  const controller = composed?.controller ?? null;

  // Startup recovery: mark stale running/paused experiments (and their
  // non-terminal task runs) interrupted after lease acquisition. Runs once
  // per controller instance; recovery never silently resumes work (spec §5.6).
  useEffect(() => {
    if (!controller) return;
    void controller.recoverOnStartup().catch(() => {
      // Recovery failure must not break the workspace; the next start attempt
      // re-verifies the lease.
    });
  }, [controller]);

  const value = useMemo<ExperimentControllerContextValue>(
    () => ({ controller, lease: composed?.lease ?? null }),
    [controller, composed],
  );

  return (
    <ExperimentControllerContext.Provider value={value}>
      {children}
    </ExperimentControllerContext.Provider>
  );
}
