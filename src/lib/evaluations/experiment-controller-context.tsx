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

import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { RepositoryContext } from "../persistence/repository-context";
import { DexieExperimentStore, createExperimentUnitOfWork } from "../persistence/experiment-unit-of-work";
import { createExecutionLease, type ExecutionLease } from "../execution-lease";
import { createRunExecutor } from "../run-executor";
import { useExecutionOwner } from "../execution-owner-context";
import { createExperimentController, type ExperimentController } from "./experiment-controller";
import {
  ExperimentControllerContext,
  type ExperimentControllerContextValue,
} from "./experiment-controller-hooks";

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

  // Startup recovery (spec §20): after lease acquisition, mark stale
  // running/paused experiments (and their non-terminal task runs) interrupted,
  // and sweep stale ad-hoc "running" runs (crashed tabs, orphaned writes) to
  // interrupted so they stop presenting as live. Recovery never silently
  // resumes work and runs once per controller instance.
  useEffect(() => {
    if (!controller || !composed || !runRepo) return;
    const lease = composed.lease;
    const repo = runRepo;
    void (async () => {
      try {
        await controller.recoverOnStartup();
      } catch {
        // Recovery failure must not break the workspace; the next start
        // attempt re-verifies the lease.
      }
      try {
        await lease.recoverInterruptedRuns(repo);
      } catch {
        // Sweep is idempotent; a later startup retries.
      }
    })();
  }, [controller, composed, runRepo]);

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
