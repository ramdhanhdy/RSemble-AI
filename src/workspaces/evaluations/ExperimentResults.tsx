// =============================================================================
// ExperimentResults — terminal experiment summary + result matrix (spec §12.3).
//
// Loads the run records behind every task's selected attempt, aggregates
// (equal task weight, coverage-transparent means, complete-coverage winners),
// and renders the summary: identity/suite/date/status, winner line, per-model
// mean + coverage, failed/partial/interrupted/aborted attempt summary with
// run links, and the Judge/profile snapshot. ≥768px shows the full matrix;
// below that the model-selectable mobile adaptation.
// =============================================================================

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Crown } from "lucide-react";
import type { ExperimentRecord } from "../../lib/evaluations/evaluation-types";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import { useEvaluationRepository } from "../../lib/persistence/repository-context";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import type { CatalogModel, ProviderId } from "../../lib/providers/types";
import type { ModelSlot } from "../../studio-data";
import {
  aggregateExperiment,
  formatAggregateMean,
  type MissingReason,
} from "../../lib/evaluations/experiment-aggregation";
import { deriveDisplayRanking } from "../../lib/evaluations/experiment-ranking";
import {
  planMissingCellRepair,
  type CompoundRepairPlan,
} from "../../lib/evaluations/experiment-repair";
import {
  planRosterExtension,
  takenModelKeys,
  type RosterExtensionPlan,
} from "../../lib/evaluations/experiment-roster-extension";
import { appendModelToSuite } from "../../lib/evaluations/suite-roster-extension";
import { StatusMark } from "../../ui/StatusMark";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { ResultMatrix, MISSING_CELL_DISPLAY } from "./ResultMatrix";
import { MobileExperimentResults } from "./MobileExperimentResults";
import {
  ExperimentRecoveryDialog,
  type RecoveryDialogVariant,
  type RepairAllSummary,
  type ExperimentRecoveryMessage,
} from "./ExperimentRecoveryDialog";
import { ExperimentAddModelDialog, type AddModelDialogMessage } from "./ExperimentAddModelDialog";

export interface ExperimentResultsProps {
  experiment: ExperimentRecord;
  resolveRunRecord: (runId: string) => Promise<RunRecordV2 | null>;
  /** Terminal recovery handoff — retry incomplete tasks (Task 7). */
  controller?: ExperimentController | null;
  /** Model catalog shared with the suite editor (roster spec F1). */
  models?: CatalogModel[];
  /** Providers currently ready, registry order (roster spec F1). */
  availableProviderIds?: ProviderId[];
  /** Generalized execution-action gate (roster spec F1): controller present
   *  AND no other in-tab execution owns the registry. Gates both recovery and
   *  add-model actions; cross-tab races still resolve via the controller lease. */
  executionActionsEnabled?: boolean;
}

/** Which recovery action the shared dialog currently drives (spec §11.1). */
type RecoveryTarget =
  | { kind: "repair-cell"; taskId: string; modelKey: string }
  | { kind: "retry-task"; taskId: string }
  | { kind: "repair-all" }
  | null;

const DESKTOP_QUERY = "(min-width: 768px)";

/** Inline media query — matches the pattern in RunsWorkspace.tsx. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function ExperimentResults({
  experiment,
  resolveRunRecord,
  controller,
  models = [],
  availableProviderIds = [],
  executionActionsEnabled = true,
}: ExperimentResultsProps): ReactElement {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const evalRepo = useEvaluationRepository();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runRecords, setRunRecords] = useState<ReadonlyMap<string, RunRecordV2> | null>(null);
  const [suiteName, setSuiteName] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  // --- Roster extension (plan Workstream F) ---------------------------------
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [addModelSlot, setAddModelSlot] = useState<ModelSlot | null>(null);
  const [addModelSync, setAddModelSync] = useState(true);
  const [addModelBusy, setAddModelBusy] = useState(false);
  const [addModelMessage, setAddModelMessage] = useState<AddModelDialogMessage | null>(null);
  const [addModelHandoff, setAddModelHandoff] = useState<string | null>(null);

  // Result-matrix page lives in the URL search params (spec §12.5): deep links
  // keep the page, invalid/out-of-range values clamp, and filter changes
  // return to page one.
  const pageParam = Number(searchParams.get("page") ?? "1");
  const matrixPage = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const handleMatrixPageChange = useCallback(
    (next: number) => {
      const clamped = next >= 1 ? next : 1;
      const params = new URLSearchParams(searchParams);
      if (clamped === 1) params.delete("page");
      else params.set("page", String(clamped));
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [recoveryTarget, setRecoveryTarget] = useState<RecoveryTarget>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<ExperimentRecoveryMessage | null>(null);

  // Load every selected attempt's run record; memoized on id + revision.
  const experimentId = experiment.id;
  const experimentRevision = experiment.revision;
  useEffect(() => {
    let cancelled = false;
    setRunRecords(null);
    const runIds: string[] = [];
    for (const taskState of experiment.tasks) {
      const selected = taskState.selectedAttemptId
        ? taskState.attempts.find((a) => a.id === taskState.selectedAttemptId)
        : undefined;
      if (selected?.runId) runIds.push(selected.runId);
    }
    void Promise.all(
      runIds.map(async (runId) => {
        const record = await resolveRunRecord(runId);
        return record ? ([runId, record] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map = new Map<string, RunRecordV2>();
      for (const entry of entries) {
        if (entry) map.set(entry[0], entry[1]);
      }
      setRunRecords(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id + revision per contract
  }, [experimentId, experimentRevision, resolveRunRecord]);

  // Suite name is display chrome; fall back to the immutable suite id.
  useEffect(() => {
    let cancelled = false;
    if (!evalRepo) return;
    void (async () => {
      try {
        const suite = await evalRepo.getSuite(experiment.suiteId);
        if (!cancelled) setSuiteName(suite?.name ?? null);
      } catch {
        if (!cancelled) setSuiteName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evalRepo, experiment.suiteId]);

  // --- Terminal recovery (Task 7): retry all incomplete tasks. ---
  const retryableTaskCount = experiment.tasks.filter((t) =>
    t.attempts.some((a) => a.status === "failed" || a.status === "interrupted"),
  ).length;
  const hasRetryableTasks = retryableTaskCount > 0 && !!controller;
  const executionActive = experiment.status === "running" || experiment.status === "queued";
  // Actions are ABSENT while another execution owns the lease (spec §11.1,
  // roster spec F1): no controller (read-only view), another in-tab execution
  // owns the registry, or the experiment is actively executing. This
  // generalized gate covers recovery AND add-model; cross-tab acquisition can
  // still fail on confirm and renders the controller error.
  const recoveryEnabled = executionActionsEnabled && !!controller && !executionActive;
  const handleRepairRequest = useCallback((taskId: string, modelKey: string) => {
    setRecoveryTarget({ kind: "repair-cell", taskId, modelKey });
  }, []);

  const handleRetryAll = useCallback(async () => {
    if (!controller) return;
    setRetryBusy(true);
    setRetryMessage(null);
    try {
      const result = await controller.retryIncomplete(experimentId);
      if (result.ok) {
        setRetryMessage("Retry started — navigate to the progress view to watch it.");
      } else {
        setRetryMessage(result.error);
      }
    } catch (err: unknown) {
      setRetryMessage(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setRetryBusy(false);
    }
  }, [controller, experimentId]);

  // --- Roster extension: dialog planning + confirm (plan F2–F4) -------------
  const addModelTakenKeys = takenModelKeys(experiment);
  const addModelActionRef = useRef<HTMLButtonElement>(null);
  // The dialog is opened imperatively (not via Dialog.Trigger), so Base UI
  // cannot restore focus on close. Return it to the header action ourselves
  // (keyboard-only flow, plan G2 scenario 6).
  const addModelWasOpenRef = useRef(false);
  useEffect(() => {
    if (addModelWasOpenRef.current && !addModelOpen) {
      addModelActionRef.current?.focus();
    }
    addModelWasOpenRef.current = addModelOpen;
  }, [addModelOpen]);

  const openAddModel = useCallback(() => {
    setAddModelSlot(null);
    setAddModelSync(true);
    setAddModelMessage(null);
    setAddModelOpen(true);
  }, []);

  const selectAddModelSlot = useCallback((slot: ModelSlot | null) => {
    setAddModelSlot(slot);
    setAddModelMessage(null);
  }, []);

  // Exact planner preview for the selected slot. Reads the already-loaded run
  // cache synchronously — the pure planner decides, no provider calls. The
  // controller re-plans after ownership acquisition (plan D2); this preview
  // can only be advisory and the duplicate checks are re-validated there.
  let addModelPlan: RosterExtensionPlan | null = null;
  let addModelPlanError: string | null = null;
  if (addModelSlot !== null && runRecords !== null) {
    const result = planRosterExtension({
      experiment,
      slot: addModelSlot,
      resolveRunRecord: (runId: string) => runRecords.get(runId) ?? null,
    });
    if (result.ok) addModelPlan = result.plan;
    else addModelPlanError = result.reason;
  }

  const confirmAddModel = useCallback(async () => {
    if (!controller || !addModelSlot || addModelBusy) return;
    const slot = addModelSlot; // freeze the selected slot for this operation
    setAddModelBusy(true);
    setAddModelMessage(null);

    // 1. Suite sync first, independently (plan F4). Its outcome never blocks
    //    the confirmed experiment extension.
    let suiteWarning: string | null = null;
    if (addModelSync && evalRepo) {
      const suiteResult = await appendModelToSuite(evalRepo, {
        suiteId: experiment.suiteId,
        slot,
        now: Date.now(),
      });
      if (!suiteResult.ok) suiteWarning = suiteResult.message;
    }

    // 2. Then the controller, regardless of the suite-sync outcome.
    try {
      const result = await controller.addModelAndRun(experimentId, { slot });
      if (result.ok) {
        const handoff = "Add-model run started — navigate to the progress view to watch it.";
        setAddModelHandoff(suiteWarning ? `${handoff} ${suiteWarning}` : handoff);
        setAddModelOpen(false);
        setAddModelSlot(null);
      } else {
        setAddModelMessage({
          tone: "error",
          text: suiteWarning ? `${result.error} (Suite note: ${suiteWarning})` : result.error,
        });
      }
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : "Add-model run failed to start.";
      setAddModelMessage({
        tone: "error",
        text: suiteWarning ? `${text} (Suite note: ${suiteWarning})` : text,
      });
    } finally {
      setAddModelBusy(false);
    }
  }, [
    controller,
    addModelSlot,
    addModelBusy,
    addModelSync,
    evalRepo,
    experiment.suiteId,
    experimentId,
  ]);

  if (!runRecords) {
    return (
      <div className="flex min-h-[120px] flex-1 items-center gap-3 p-8" role="status">
        <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-accent/40" />
        <span className="text-sm text-text-muted">Loading experiment results…</span>
      </div>
    );
  }

  const aggregation = aggregateExperiment({
    snapshot: experiment.snapshot,
    taskStates: experiment.tasks,
    resolveRunRecord: (runId: string) => runRecords.get(runId) ?? null,
  });

  const slotsByKey = new Map(
    experiment.snapshot.modelSlots.map((s) => [`${s.providerId}:${s.slug}`, s]),
  );
  const taskById = new Map(experiment.snapshot.tasks.map((t) => [t.id, t]));

  // --- Recovery planning (spec §11.2) ---------------------------------------
  // Per-cell plans: repairable no-score cells where the task has a selected
  // partial attempt whose run is available and holds accepted outputs for at
  // least one other candidate. The pure planner decides; the sync resolver
  // reads the already-loaded map.
  const repairablePlans = new Map<string, Map<string, CompoundRepairPlan>>();
  const resolveSync = (runId: string) => runRecords.get(runId) ?? null;
  aggregation.cells.forEach((row, taskIdx) => {
    const taskId = aggregation.taskIds[taskIdx];
    row.forEach((cell, modelIdx) => {
      if (cell.kind !== "missing" || cell.reason !== "no-score") return;
      const modelKey = aggregation.modelKeys[modelIdx];
      const result = planMissingCellRepair({
        experiment,
        aggregation,
        request: { taskId, modelKeys: [modelKey] },
        resolveRunRecord: resolveSync,
      });
      if (result.ok) {
        let byKey = repairablePlans.get(taskId);
        if (!byKey) {
          byKey = new Map();
          repairablePlans.set(taskId, byKey);
        }
        byKey.set(modelKey, result.plan);
      }
    });
  });

  // Grouped per-task plans for the batch action (spec §11.7): the toolbar
  // queues ONE controller call per task with ALL its repairable keys, so two
  // missing models on one task never re-plan against changed evidence mid-
  // batch, and the preview never overstates paid work. A task whose grouped
  // plan fails (e.g. no reusable outputs outside the full requested set) is
  // excluded from the batch and counts as fallback.
  const taskRepairPlans = new Map<string, CompoundRepairPlan>();
  for (const [taskId, byKey] of repairablePlans) {
    const grouped = planMissingCellRepair({
      experiment,
      aggregation,
      request: { taskId, modelKeys: [...byKey.keys()] },
      resolveRunRecord: resolveSync,
    });
    if (grouped.ok) taskRepairPlans.set(taskId, grouped.plan);
  }

  let missingCellCount = 0;
  for (const row of aggregation.cells) {
    for (const cell of row) {
      if (cell.kind === "missing") missingCellCount += 1;
    }
  }
  let repairableCount = 0;
  for (const plan of taskRepairPlans.values()) repairableCount += plan.requestedModelKeys.length;
  const fallbackCount = missingCellCount - repairableCount;
  const showRecoveryToolbar = recoveryEnabled && (missingCellCount > 0 || retryableTaskCount > 0);

  /** Aggregate planner counts for the batch "Repair all" action (spec §11.7).
   *  Built from the GROUPED per-task plans: one call per task, all its keys. */
  function summarizeRepairAll(plans: ReadonlyMap<string, CompoundRepairPlan>): RepairAllSummary {
    let candidateCalls = 0;
    let judgeCalls = 0;
    let reusedCount = 0;
    for (const plan of plans.values()) {
      candidateCalls += plan.candidateCalls;
      judgeCalls += plan.judgeCalls;
      reusedCount += plan.reusedModelKeys.length;
    }
    return { taskCount: plans.size, candidateCalls, judgeCalls, reusedCount };
  }

  const recoveryPlan =
    recoveryTarget?.kind === "repair-cell"
      ? (repairablePlans.get(recoveryTarget.taskId)?.get(recoveryTarget.modelKey) ?? null)
      : null;
  const recoveryVariant: RecoveryDialogVariant =
    recoveryTarget?.kind === "repair-cell" && recoveryPlan
      ? "repair-cell"
      : recoveryTarget?.kind === "repair-all"
        ? "repair-all"
        : "retry-task";
  const recoveryTaskTitle =
    recoveryTarget && recoveryTarget.kind !== "repair-all"
      ? (taskById.get(recoveryTarget.taskId)?.title ?? recoveryTarget.taskId)
      : "";
  const recoveryModelLabel = recoveryTarget?.kind === "repair-cell" ? recoveryTarget.modelKey : "";
  const repairAllSummary =
    recoveryTarget?.kind === "repair-all" && taskRepairPlans.size > 0
      ? summarizeRepairAll(taskRepairPlans)
      : null;

  // Plain function (not a hook): derived only after run records load, and the
  // early loading return above must never precede a conditional hook call.
  async function handleRecoveryConfirm(): Promise<void> {
    if (!controller || !recoveryTarget) return;
    // A cell reported as "Retry incomplete task" opens the dialog as a
    // repair-cell target with no planner plan; the effective action is the
    // full-roster retry fallback (spec §11.1).
    const effectiveRepair =
      recoveryTarget.kind === "repair-cell" &&
      repairablePlans.get(recoveryTarget.taskId)?.has(recoveryTarget.modelKey) === true;
    setRecoveryBusy(true);
    setRecoveryMessage(null);
    try {
      if (recoveryTarget.kind === "repair-cell" && effectiveRepair) {
        const result = await controller.repairMissingCells(experimentId, {
          taskId: recoveryTarget.taskId,
          modelKeys: [recoveryTarget.modelKey],
        });
        if (result.ok) {
          setRecoveryTarget(null);
          setRecoveryMessage({
            tone: "success",
            text: "Repair started — navigate to the progress view to watch it.",
          });
        } else {
          setRecoveryMessage({ tone: "error", text: result.error });
        }
      } else if (recoveryTarget.kind === "repair-all") {
        // Repair all: queue ONE controller call per task carrying ALL of that
        // task's repairable model keys (grouped plans), so the batch never
        // re-plans a task against its own changed evidence mid-run. The lease
        // is released between terminal loops; whenIdle gates the next call.
        const plans = [...taskRepairPlans.values()];
        let error: string | null = null;
        let queued = 0;
        for (const plan of plans) {
          const result = await controller.repairMissingCells(experimentId, {
            taskId: plan.taskId,
            modelKeys: plan.requestedModelKeys,
          });
          if (!result.ok) {
            error = result.error;
            break;
          }
          queued += 1;
          await controller.whenIdle();
        }
        if (error) {
          setRecoveryMessage({
            tone: "error",
            text: queued > 0 ? `${error} — ${queued} task(s) already queued.` : error,
          });
        } else {
          setRecoveryTarget(null);
          setRecoveryMessage({
            tone: "success",
            text: "Repair started — navigate to the progress view to watch it.",
          });
        }
      } else {
        // Full-roster fallback: single "Retry incomplete task" cell action or
        // a repair-cell target whose plan disappeared.
        const result = await controller.retryIncomplete(experimentId);
        if (result.ok) {
          setRecoveryTarget(null);
          setRecoveryMessage({
            tone: "success",
            text: "Retry started — navigate to the progress view to watch it.",
          });
        } else {
          setRecoveryMessage({ tone: "error", text: result.error });
        }
      }
    } catch (err: unknown) {
      setRecoveryMessage({
        tone: "error",
        text: err instanceof Error ? err.message : "Recovery failed.",
      });
    } finally {
      setRecoveryBusy(false);
    }
  }

  // Exact localized timestamp + explicit timezone (spec §12.3).
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startedText = `${new Date(experiment.createdAt).toLocaleString()} · ${timeZone}`;

  // Coverage issues derive from CURRENT aggregation cells (spec §12.4 #6): a
  // repaired cell leaves this list as soon as the selected attempt changes.
  const coverageIssues: {
    taskId: string;
    taskTitle: string;
    modelKey: string;
    reason: MissingReason;
    runId: string | null;
  }[] = [];
  aggregation.cells.forEach((row, taskIdx) => {
    const taskId = aggregation.taskIds[taskIdx];
    const taskTitle = taskById.get(taskId)?.title ?? taskId;
    // Fall back to the latest attempt's run id so failed-task evidence stays
    // reachable even before an attempt is selected (spec 02).
    const state = experiment.tasks.find((t) => t.taskId === taskId);
    const latestRunId = state?.attempts[state.attempts.length - 1]?.runId ?? null;
    row.forEach((cell, modelIdx) => {
      if (cell.kind === "missing") {
        coverageIssues.push({
          taskId,
          taskTitle,
          modelKey: aggregation.modelKeys[modelIdx],
          reason: cell.reason,
          runId: cell.runId ?? latestRunId,
        });
      }
    });
  });

  const profiles = experiment.snapshot.profiles;
  const profileText =
    profiles.length > 0
      ? profiles.map((p) => `${p.name} v${p.version}`).join(", ")
      : "Holistic judgment";

  const winnerModels = aggregation.models.filter((m) =>
    aggregation.winnerKeys.includes(m.modelKey),
  );
  const snapshotOrder = new Map(
    experiment.snapshot.modelSlots.map((s, i) => [`${s.providerId}:${s.slug}`, i]),
  );
  const displayRanking = deriveDisplayRanking(aggregation.models, snapshotOrder);
  const { eligible, provisional, provisionalLeader } = displayRanking;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="truncate text-lg font-semibold text-text">
            {suiteName ?? experiment.suiteId}
          </h1>
          <StatusMark status={experiment.status} />
        </div>
        <p className="text-sm text-text-secondary">
          Experiment results · Suite v{experiment.suiteVersion} · {startedText} ·{" "}
          <span className="font-mono text-xs text-text-muted">{experiment.id}</span>
        </p>
        {/* Header action row — Back to suite + Add model (roster spec F3).
            Add model never appears in or adjacent to the recovery toolbar. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            to={`/evaluations/${experiment.suiteId}`}
            className="inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to suite
          </Link>
          {recoveryEnabled && availableProviderIds.length > 0 ? (
            <button
              type="button"
              onClick={openAddModel}
              data-testid="add-model-action"
              ref={addModelActionRef}
              className="inline-flex min-h-[44px] items-center rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Add model
            </button>
          ) : null}
        </div>
        {/* Add-model handoff / suite-sync warning — under the header, outside
            the recovery toolbar. Stays visible after the dialog closes. */}
        {addModelHandoff ? (
          <p role="status" data-testid="add-model-handoff" className="text-sm text-text-secondary">
            {addModelHandoff}
          </p>
        ) : null}
      </header>

      {/* Winner callout — Complete-coverage winner (spec §10.2). */}
      {winnerModels.length > 0 ? (
        <section
          aria-label="Winner"
          className="flex min-w-0 flex-col gap-1 rounded-md border border-success/40 bg-success/[0.06] px-4 py-3"
          data-testid="winner-callout"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-success">
            Complete-coverage winner
          </p>
          {winnerModels.map((model) => {
            const slot = slotsByKey.get(model.modelKey);
            return (
              <div key={model.modelKey} className="flex min-w-0 flex-wrap items-center gap-2">
                <Crown size={15} className="text-success" aria-hidden="true" />
                {slot ? (
                  <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                ) : (
                  <span className="font-mono text-text">{model.modelKey}</span>
                )}
                {model.mean !== null ? (
                  <span className="tabular-nums text-sm font-bold text-text">
                    {formatAggregateMean(model.mean)}
                  </span>
                ) : null}
                <span className="text-xs text-text-secondary">
                  mean over {model.scoredTasks}/{model.totalTasks} tasks
                </span>
              </div>
            );
          })}
        </section>
      ) : (
        <p className="text-sm text-text-secondary">
          No complete-coverage winner. Complete missing results to determine the winner.
        </p>
      )}

      {/* Provisional score leader — restrained line, no crown, no rank (spec §10.2). */}
      {provisionalLeader && provisionalLeader.mean !== null ? (
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text">Provisional score leader</span> ·{" "}
          {formatAggregateMean(provisionalLeader.mean)} mean over {provisionalLeader.scoredTasks}/
          {provisionalLeader.totalTasks} tasks · not winner-eligible
        </p>
      ) : null}

      <section aria-label="Aggregate scores" className="flex min-w-0 flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Eligible standings
        </h2>
        <ul className="flex min-w-0 flex-col gap-1">
          {eligible.map((model, rank) => {
            const slot = slotsByKey.get(model.modelKey);
            const isWinner = aggregation.winnerKeys.includes(model.modelKey);
            return (
              <li
                key={model.modelKey}
                className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
              >
                <span className="w-7 font-mono text-xs text-text-muted">#{rank + 1}</span>
                {isWinner ? <Crown size={12} className="text-success" aria-label="Winner" /> : null}
                {slot ? (
                  <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                ) : (
                  <span className="font-mono text-text">{model.modelKey}</span>
                )}
                {model.mean !== null ? (
                  <>
                    <span className="tabular-nums text-sm font-semibold text-text">
                      {formatAggregateMean(model.mean)}
                    </span>
                    <span className="text-xs text-text-secondary">
                      mean · {model.scoredTasks}/{model.totalTasks} tasks
                    </span>
                  </>
                ) : (
                  <span className="text-text-secondary">No scores</span>
                )}
              </li>
            );
          })}
        </ul>

        {provisional.length > 0 ? (
          <>
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Provisional results
            </h2>
            <ul className="flex min-w-0 flex-col gap-1">
              {provisional.map((model) => {
                const slot = slotsByKey.get(model.modelKey);
                return (
                  <li
                    key={model.modelKey}
                    className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="w-7" aria-hidden="true" />
                    {slot ? (
                      <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                    ) : (
                      <span className="font-mono text-text">{model.modelKey}</span>
                    )}
                    {model.mean !== null ? (
                      <>
                        <span className="tabular-nums text-sm font-semibold text-text">
                          {formatAggregateMean(model.mean)}
                        </span>
                        <span className="text-xs text-text-secondary">
                          Incomplete · {model.scoredTasks}/{model.totalTasks} tasks
                        </span>
                      </>
                    ) : (
                      <span className="text-text-secondary">No scores</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </section>

      {/* Roster extension history — compact audit disclosure (roster spec F3).
          Lists added model identity + extension timestamp in append order.
          Outside standings and recovery; no matrix badges or special columns. */}
      {(experiment.rosterExtensions ?? []).length > 0 ? (
        <section
          aria-label="Roster extensions"
          data-testid="roster-extensions"
          className="flex min-w-0 flex-col gap-1"
        >
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Roster extensions ({(experiment.rosterExtensions ?? []).length})
          </h2>
          <ul className="flex min-w-0 flex-col">
            {(experiment.rosterExtensions ?? []).map((ext) => (
              <li
                key={`${ext.addedModelKey}:${ext.extendedAt}`}
                className="flex min-h-[44px] min-w-0 flex-wrap items-center gap-2 border-b border-edge py-1 last:border-b-0"
              >
                <CompactModelLabel
                  providerId={ext.addedSlot.providerId}
                  slug={ext.addedSlot.slug}
                />
                <span className="text-xs text-text-secondary">
                  added {new Date(ext.extendedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Judge and evaluation profile" className="flex min-w-0 flex-col gap-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Judge &amp; profile
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CompactModelLabel
            providerId={experiment.snapshot.defaultJudge.providerId}
            slug={experiment.snapshot.defaultJudge.model}
          />
          <span className="text-sm text-text-secondary">{profileText}</span>
        </div>
      </section>

      {/* Coverage issues — derives from CURRENT aggregation cells (spec §12.4 #6).
          A repaired cell disappears from here once the selected attempt changes. */}
      {coverageIssues.length > 0 ? (
        <section
          aria-label="Coverage issues"
          data-testid="coverage-issues"
          className="flex min-w-0 flex-col gap-1"
        >
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Coverage issues
          </h2>
          <ul className="flex min-w-0 flex-col">
            {coverageIssues.map(({ taskId, taskTitle, modelKey, reason, runId }) => (
              <li
                key={`${taskId}:${modelKey}`}
                className="flex min-h-[44px] min-w-0 flex-wrap items-center gap-2 border-b border-edge py-1 last:border-b-0"
              >
                <StatusMark status={MISSING_CELL_DISPLAY[reason].status} size={12} />
                <span className="min-w-0 truncate text-sm text-text">{taskTitle}</span>
                <span className="font-mono text-xs text-text-muted">{modelKey}</span>
                <span className="text-xs text-text-secondary">
                  {MISSING_CELL_DISPLAY[reason].text}
                </span>
                {runId ? (
                  <Link
                    to={`/runs/${runId}`}
                    className="inline-flex min-h-[44px] items-center px-2 text-sm text-accent transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    View run
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Recovery toolbar (spec §11.1) — above the matrix, only while this surface
          owns the lease. Reports repairable vs fallback counts and offers the
          batch repair plus the existing full-roster retry fallback. */}
      {showRecoveryToolbar ? (
        <section
          aria-label="Recovery"
          className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-edge bg-panel px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm text-text">
              {missingCellCount} missing result{missingCellCount === 1 ? "" : "s"} —{" "}
              {repairableCount} repairable, {fallbackCount} {fallbackCount === 1 ? "needs" : "need"}{" "}
              a full task retry.
            </p>
            {recoveryMessage ? (
              <p
                role="alert"
                className={`mt-1 text-xs ${recoveryMessage.tone === "error" ? "text-warning" : "text-success"}`}
              >
                {recoveryMessage.text}
              </p>
            ) : retryMessage ? (
              <p role="alert" className="mt-1 text-xs text-warning">
                {retryMessage}
              </p>
            ) : null}
          </div>
          {repairableCount > 0 ? (
            <button
              type="button"
              onClick={() => setRecoveryTarget({ kind: "repair-all" })}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Repair all missing results
            </button>
          ) : null}
          {hasRetryableTasks ? (
            <button
              type="button"
              onClick={() => void handleRetryAll()}
              disabled={retryBusy}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {retryBusy ? "Starting…" : "Retry all incomplete tasks"}
            </button>
          ) : null}
        </section>
      ) : null}

      {isDesktop ? (
        <ResultMatrix
          aggregation={aggregation}
          tasks={experiment.snapshot.tasks}
          modelSlots={experiment.snapshot.modelSlots}
          runRecords={runRecords}
          repairablePlans={repairablePlans}
          onRepairRequest={recoveryEnabled ? handleRepairRequest : undefined}
          page={matrixPage}
          onPageChange={handleMatrixPageChange}
        />
      ) : (
        <MobileExperimentResults
          aggregation={aggregation}
          tasks={experiment.snapshot.tasks}
          modelSlots={experiment.snapshot.modelSlots}
          runRecords={runRecords}
          repairablePlans={repairablePlans}
          onRepairRequest={recoveryEnabled ? handleRepairRequest : undefined}
        />
      )}

      <ExperimentRecoveryDialog
        open={recoveryTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRecoveryTarget(null);
        }}
        variant={recoveryVariant}
        plan={recoveryPlan}
        summary={repairAllSummary}
        taskTitle={recoveryTaskTitle}
        modelLabel={recoveryModelLabel}
        busy={recoveryBusy}
        message={recoveryMessage}
        onConfirm={() => void handleRecoveryConfirm()}
      />

      <ExperimentAddModelDialog
        open={addModelOpen}
        onOpenChange={(open) => {
          if (!open && !addModelBusy) {
            setAddModelOpen(false);
            setAddModelSlot(null);
          }
        }}
        models={models}
        availableProviderIds={availableProviderIds}
        takenKeys={addModelTakenKeys}
        suiteName={suiteName ?? experiment.suiteId}
        selectedSlot={addModelSlot}
        onSelectSlot={selectAddModelSlot}
        plan={addModelPlan}
        planError={addModelPlanError}
        syncToSuite={addModelSync}
        onSyncToSuiteChange={setAddModelSync}
        busy={addModelBusy}
        message={addModelMessage}
        onConfirm={() => void confirmAddModel()}
        onCancel={() => {
          if (!addModelBusy) {
            setAddModelOpen(false);
            setAddModelSlot(null);
          }
        }}
      />
    </div>
  );
}
