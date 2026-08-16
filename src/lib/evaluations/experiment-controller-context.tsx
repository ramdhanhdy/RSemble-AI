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

import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RepositoryContext } from "../persistence/repository-context";
import {
  DexieExperimentStore,
  createExperimentUnitOfWork,
} from "../persistence/experiment-unit-of-work";
import { createExecutionLease, type ExecutionLease } from "../execution-lease";
import { createRunExecutor } from "../run-executor";
import { useExecutionOwner } from "../execution-owner-context";
import { createEvidenceRepository } from "../persistence/evidence-repository";
import {
  createDerivationQueue,
  createRepositoryVerifierResolver,
  type EvaluationSourceResolver,
} from "../evidence/derive-observations";
import { createExperimentController, type ExperimentController } from "./experiment-controller";
import {
  ExperimentControllerContext,
  type ExperimentControllerContextValue,
} from "./experiment-controller-hooks";

export function ExperimentControllerProvider({ children }: { children: ReactNode }) {
  const { db, evalRepo, runRepo } = useContext(RepositoryContext);
  const { registry: owner } = useExecutionOwner();

  const composed = useMemo<{
    controller: ExperimentController;
    lease: ExecutionLease;
  } | null>(() => {
    if (!db || !evalRepo || !runRepo) return null;
    const lease = createExecutionLease(db);
    // Post-commit derivation queue (evidence spec §4): a local, serialized
    // job runner over the schema v8 evidence stores. It is separate from the
    // paid-execution owner and the experiment unit of work.
    const evidenceRepo = createEvidenceRepository(db);
    const sourceResolver: EvaluationSourceResolver = {
      getExperiment: (id) => evalRepo.getExperiment(id),
      getRun: (id) => runRepo.get(id),
    };
    const derivationQueue = createDerivationQueue({
      evidenceRepo,
      resolver: sourceResolver,
      resolveVerifierOutcomes: createRepositoryVerifierResolver(evidenceRepo),
    });
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
      onTaskTerminalCommitted: (event) => {
        if (event.status !== "completed" && event.status !== "partial") return;
        void derivationQueue.enqueue({
          sourceKind: "evaluation",
          sourceResultId: event.runId,
          sourceRevision: event.runRevision,
        });
      },
    });
    return { controller, lease };
  }, [db, evalRepo, runRepo, owner]);
  const controller = composed?.controller ?? null;
  const [recoveredController, setRecoveredController] = useState<ExperimentController | null>(null);

  // Startup recovery (spec §20): after lease acquisition, mark stale
  // running/paused experiments (and their non-terminal task runs) interrupted,
  // and sweep stale ad-hoc "running" runs (crashed tabs, orphaned writes) to
  // interrupted so they stop presenting as live. Recovery never silently
  // resumes work and runs once per controller instance.
  useEffect(() => {
    if (!controller || !composed || !runRepo) return;
    let cancelled = false;
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
      if (!cancelled) setRecoveredController(controller);
    })();
    return () => {
      cancelled = true;
    };
  }, [controller, composed, runRepo]);

  // Never expose execution actions until both recovery passes finish. Identity
  // matching also withholds a newly composed controller immediately, without
  // relying on an effect to clear readiness from a previous database handle.
  const readyController = recoveredController === controller ? controller : null;

  const value = useMemo<ExperimentControllerContextValue>(
    () => ({ controller: readyController, lease: composed?.lease ?? null }),
    [readyController, composed],
  );

  return (
    <ExperimentControllerContext.Provider value={value}>
      {children}
    </ExperimentControllerContext.Provider>
  );
}
