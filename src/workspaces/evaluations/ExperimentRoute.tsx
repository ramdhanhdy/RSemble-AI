// =============================================================================
// ExperimentRoute — /experiments/:experimentId (spec §5.1, Phase 7)
//
// One route, two surfaces:
//   - non-terminal (draft/queued/running/paused) → ExperimentProgress
//   - terminal (completed/completed_with_failures/aborted/interrupted) →
//     ExperimentResults
//
// Loads the record from the evaluation repository and refreshes on controller
// events plus a slow poll while non-terminal. Missing records render the
// compact not-found state with a link back to Evaluations (spec §14).
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ExperimentRecord } from "../../lib/evaluations/evaluation-types";
import { useEvaluationRepository, useRunRepository } from "../../lib/persistence/repository-context";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type { CatalogModel, ProviderId } from "../../lib/providers/types";
import type { ExecutionOwner } from "../../lib/execution-owner";
import { useExecutionOwner } from "../../lib/execution-owner-context";
import { useExperimentController } from "../../lib/evaluations/experiment-controller-context";
import { ExperimentProgress } from "./ExperimentProgress";
import { ExperimentResults } from "./ExperimentResults";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "completed_with_failures",
  "aborted",
  "interrupted",
]);

export function isExperimentTerminal(status: ExperimentRecord["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface ExperimentRouteProps {
  /** Model catalog shared with the suite editor (roster spec F1). */
  models?: CatalogModel[];
  /** Providers currently ready, in registry order (roster spec F1). */
  availableProviderIds?: ProviderId[];
  /** Test seam: override the context execution owner (SuiteEditor pattern). */
  executionOwner?: ExecutionOwner | null;
}

export function ExperimentRoute({
  models = [],
  availableProviderIds = [],
  executionOwner: ownerProp,
}: ExperimentRouteProps) {
  const { experimentId } = useParams<{ experimentId: string }>();
  const evalRepo = useEvaluationRepository();
  const runRepo = useRunRepository();
  const controller = useExperimentController();
  const { owner: ctxOwner } = useExecutionOwner();
  const owner = ownerProp !== undefined ? ownerProp : ctxOwner;

  const [experiment, setExperiment] = useState<ExperimentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!evalRepo || !experimentId) {
      setExperiment(null);
      setLoading(false);
      return;
    }
    const id = ++requestIdRef.current;
    try {
      const record = await evalRepo.getExperiment(experimentId);
      if (id !== requestIdRef.current) return;
      setExperiment(record);
      setLoadError(record ? null : "Experiment not found.");
    } catch (err: unknown) {
      if (id !== requestIdRef.current) return;
      setLoadError(err instanceof Error ? err.message : "Failed to load experiment.");
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [evalRepo, experimentId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Refresh on controller events (task-began / task-terminal) and poll slowly
  // while the experiment is non-terminal so progress stays live.
  useEffect(() => {
    if (!controller) return;
    const unsub = controller.subscribe(() => {
      void load();
    });
    return unsub;
  }, [controller, load]);

  useEffect(() => {
    if (!experiment || isExperimentTerminal(experiment.status)) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [experiment, load]);

  const resolveRunRecord = useCallback(
    async (runId: string): Promise<RunRecordV2 | null> => {
      if (!runRepo) return null;
      return runRepo.get(runId);
    },
    [runRepo],
  );

  if (loading) {
    return (
      <div className="flex min-h-[120px] flex-1 items-center justify-center p-8 text-sm text-text-muted" role="status">
        Loading experiment…
      </div>
    );
  }

  if (!experiment) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-text-secondary">{loadError ?? "Experiment not found."}</p>
        <Link
          to="/evaluations"
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to Evaluations
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {isExperimentTerminal(experiment.status) ? (
        <ExperimentResults
          experiment={experiment}
          resolveRunRecord={resolveRunRecord}
          controller={controller}
          models={models}
          availableProviderIds={availableProviderIds}
          executionActionsEnabled={controller !== null && owner === null}
        />
      ) : (
        <ExperimentProgress experiment={experiment} controller={controller} />
      )}
    </div>
  );
}
