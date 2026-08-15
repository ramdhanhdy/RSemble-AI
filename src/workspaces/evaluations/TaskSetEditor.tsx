// =============================================================================
// TaskSetEditor — two-pane Task Set authoring surface (spec §4–§5, Child 03 Task 6).
//
// Desktop: two-pane split (task list | selected task member editor). Header shows
// task set name, persisted version, dirty/save state, settings disclosure,
// and Run evaluation button. Save and Run are distinct controls. Historical
// versions at /evaluations/sets/:taskSetId/versions/:version are read-only.
// Frozen EvaluationSuite fields stay named suiteId/suiteVersion on records.
//
// Task 6 canonical selection:
//  - Add task opens TaskVersionSelector to pick exact canonical Task Versions.
//  - Pinned version is visible and selectable (no latest-version substitution).
//  - Preserves deterministic order, role, stratum, weight, overrides.
//  - Editing a task navigates to /tasks/:taskId (never mutates canonical tasks here).
//  - Archived tasks display warning banner and require confirmation.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ChevronDown,
  Loader2,
  Save,
  Play,
  AlertCircle,
  AlertTriangle,
  Trophy,
  ExternalLink,
} from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import { useExperimentController } from "../../lib/evaluations/experiment-controller-hooks";
import { useModelProbe } from "../../ui/ModelProbeContext";
import { SuitePreflightDialog, type SuitePreflightEntry } from "./SuitePreflightDialog";
import { useExecutionOwner } from "../../lib/execution-owner-context";
import type { ExecutionOwner } from "../../lib/execution-owner";
import { SuiteExperimentHistory } from "./SuiteExperimentHistory";
import { FusionStudyPanel } from "./FusionStudyPanel";
import {
  useFusionStudyRepository,
  useTaskRepository,
  useTaskSetRepository,
} from "../../lib/persistence/repository-context";
import type { TaskSetRepository } from "../../lib/persistence/task-set-repository";
import { suiteToTaskSetRecord, suiteToTaskSetVersion } from "../../lib/evaluations/suite-compat";
import {
  ArchivedTaskExecutionError,
  InvalidWorkloadForExecutionError,
  UnresolvedWorkloadRefError,
  type MaterializedWorkloadSnapshot,
  type WorkloadCatalogResolvers,
} from "../../lib/evaluations/workload-manifest";
import {
  type EvaluationSuite,
  type EvaluationTask,
  type RubricVersionRef,
  type ExperimentRecord,
  type EvaluationRubric,
  type RubricRecord,
  type TaskEvaluationSelection,
} from "../../lib/evaluations/evaluation-types";
import type {
  TaskSetMemberRole,
  TaskSetRecord,
  TaskSetVersion,
} from "../../lib/evaluations/task-set-types";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import type { CatalogModel } from "../../lib/providers/types";
import { DialogSurface } from "../../ui/DialogSurface";
import {
  isSuiteDirty,
  validateSuiteForExecution,
  validateSuiteForSave,
} from "../../lib/evaluations/suite-validation";
import { StorageError } from "../../lib/persistence/database";
import { TaskSetTaskList, type TaskSetMemberData } from "./TaskSetTaskList";
import { TaskVersionSelector, type TaskVersionSelection } from "./TaskVersionSelector";
import { SuiteSettings } from "./SuiteSettings";
import { RubricRefChip } from "../../ui/RubricRefChip";

interface TaskSetEditorProps {
  repo: EvaluationRepository | null;
  /** Catalog models from provider probes (may be empty). */
  models: CatalogModel[];
  /** Test seam: override the context task repository. */
  taskRepo?: TaskRepository | null;
  /** Test seam: override the context task set repository. */
  taskSetRepo?: TaskSetRepository | null;
  /** Test seam: override the context experiment controller. Pass null to
   *  simulate storage-unavailable (no controller). */
  controller?: ExperimentController | null;
  /** Test seam: override the context execution owner. */
  executionOwner?: ExecutionOwner | null;
}

export function TaskSetEditor({
  repo,
  models,
  taskRepo: taskRepoProp,
  taskSetRepo: taskSetRepoProp,
  controller: controllerProp,
  executionOwner: ownerProp,
}: TaskSetEditorProps) {
  const {
    taskSetId,
    suiteId: legacySuiteId,
    version: versionParam,
  } = useParams<{
    taskSetId?: string;
    suiteId?: string;
    version?: string;
  }>();
  const taskSetIdResolved = taskSetId ?? legacySuiteId;
  const requestedVersion = Number(versionParam);
  const historical =
    versionParam !== undefined && Number.isInteger(requestedVersion) && requestedVersion > 0
      ? requestedVersion
      : null;
  const navigate = useNavigate();

  // Context resolution with prop overrides (test seams).
  const ctxTaskRepo = useTaskRepository();
  const taskRepo = taskRepoProp !== undefined ? taskRepoProp : ctxTaskRepo;

  const ctxController = useExperimentController();
  const { owner: ctxOwner } = useExecutionOwner();
  const controller = controllerProp !== undefined ? controllerProp : ctxController;
  const ctxTaskSetRepo = useTaskSetRepository();
  const taskSetRepo = taskSetRepoProp !== undefined ? taskSetRepoProp : ctxTaskSetRepo;
  const executionOwner = ownerProp !== undefined ? ownerProp : ctxOwner;
  const fusionRepo = useFusionStudyRepository();

  const [persisted, setPersisted] = useState<EvaluationSuite | null>(null);
  const [draft, setDraft] = useState<EvaluationSuite | null>(null);
  const [latestExperiment, setLatestExperiment] = useState<ExperimentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rubricRecords, setRubricRecords] = useState<RubricRecord[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [taskSelectorOpen, setTaskSelectorOpen] = useState(false);
  const [dirtyRunOpen, setDirtyRunOpen] = useState(false);
  const [runState, setRunState] = useState<"idle" | "materializing" | "running">("idle");
  // Metadata cache for tasks referenced by the set
  const [taskMeta, setTaskMeta] = useState<
    Map<string, { record: TaskRecord | null; versions: TaskVersion[] }>
  >(new Map());

  const requestIdRef = useRef(0);

  // --- Load suite + rubric records ---
  const load = useCallback(async () => {
    if (!repo || !taskSetIdResolved) {
      setPersisted(null);
      setDraft(null);
      setLoading(false);
      return;
    }
    const id = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      if (versionParam !== undefined && historical === null) {
        throw new StorageError("validation", `Invalid task set version "${versionParam}".`);
      }
      const [latestSuite, rubrics, historicalVersion, taskSetRecord] = await Promise.all([
        repo.getSuite(taskSetIdResolved),
        repo.listRubrics(true),
        historical !== null && taskSetRepo
          ? taskSetRepo.getTaskSetVersion(taskSetIdResolved, historical)
          : Promise.resolve(null),
        historical !== null && taskSetRepo
          ? taskSetRepo.getTaskSetRecord(taskSetIdResolved)
          : Promise.resolve(null),
      ]);
      if (id !== requestIdRef.current) return;
      if (!latestSuite) {
        setPersisted(null);
        setDraft(null);
        setLoadError("Task set not found.");
      } else if (
        historical !== null &&
        (!taskSetRepo || !historicalVersion || !taskSetRecord) &&
        historical !== latestSuite.version
      ) {
        setPersisted(null);
        setDraft(null);
        setLoadError(
          taskSetRepo
            ? `Task set version ${historical} not found.`
            : `Task set version ${historical} is unavailable because storage is unavailable.`,
        );
      } else {
        const suite =
          historicalVersion && taskSetRecord
            ? await projectHistoricalSuite(latestSuite, taskSetRecord, historicalVersion, taskRepo)
            : latestSuite;
        if (id !== requestIdRef.current) return;
        setPersisted(suite);
        setDraft(structuredClone(suite));
        setSelectedTaskId(suite.tasks[0]?.id ?? null);
      }
      setRubricRecords(rubrics.filter((p) => !p.archivedAt));
      setLoading(false);
    } catch (err: unknown) {
      if (id !== requestIdRef.current) return;
      setPersisted(null);
      setDraft(null);
      setLoadError(err instanceof Error ? err.message : "Failed to load task set.");
      setLoading(false);
    }
  }, [historical, repo, taskRepo, taskSetIdResolved, taskSetRepo, versionParam]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load canonical task metadata when draft.tasks change
  const draftTasks = draft?.tasks;
  useEffect(() => {
    if (!taskRepo || !draftTasks) return;
    let cancelled = false;

    const taskIds = Array.from(
      new Set(
        draftTasks.map((t) => {
          const tData = t as TaskSetMemberData;
          return tData.taskVersionRef?.taskId || t.id;
        }),
      ),
    );

    if (taskIds.length === 0) {
      setTaskMeta(new Map());
      return;
    }

    void Promise.all(
      taskIds.map(async (taskId) => {
        try {
          const [rec, vers] = await Promise.all([
            taskRepo.getTaskRecord(taskId),
            taskRepo.listTaskVersions(taskId).catch(() => [] as TaskVersion[]),
          ]);
          return [taskId, { record: rec, versions: vers }] as const;
        } catch {
          return [taskId, { record: null, versions: [] as TaskVersion[] }] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setTaskMeta(new Map(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [taskRepo, draftTasks]);

  // Latest experiment for the header "Latest results" entry
  useEffect(() => {
    let cancelled = false;
    setLatestExperiment(null);
    if (!repo || !persisted) return;
    void repo
      .listExperiments(persisted.id)
      .then((list) => {
        if (!cancelled) setLatestExperiment(list[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setLatestExperiment(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, persisted]);

  // Resolve pinned rubric for header chip
  const [pinnedRubric, setPinnedRubric] = useState<EvaluationRubric | null>(null);
  const [pinnedRubricLoaded, setPinnedRubricLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPinnedRubric(null);
    setPinnedRubricLoaded(false);
    if (!repo || !persisted) return;
    const ev = persisted.defaultEvaluation;
    if (ev.kind !== "profile") {
      setPinnedRubricLoaded(true);
      return;
    }
    void repo
      .getRubricVersion(ev.profile.id, ev.profile.version)
      .then((p) => {
        if (!cancelled) {
          setPinnedRubric(p);
          setPinnedRubricLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setPinnedRubricLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, persisted]);

  // --- Dirty + validation ---
  const dirty = useMemo(
    () => (persisted && draft ? isSuiteDirty(persisted, draft) : false),
    [persisted, draft],
  );

  const execValidation = useMemo(
    () => (draft ? validateSuiteForExecution(draft) : { valid: false, errors: [] }),
    [draft],
  );

  const nextVersion = (persisted?.version ?? 0) + 1;

  // Resolve rubric label
  const resolveRubricLabel = useCallback(
    (ref: RubricVersionRef): string => {
      const rec = rubricRecords.find((p) => p.id === ref.id);
      const name = rec ? `Rubric ${ref.id}` : ref.id;
      return `${name} v${ref.version}`;
    },
    [rubricRecords],
  );

  // Resolve task info for list
  const resolveTaskInfo = useCallback(
    (taskId: string, task: EvaluationTask) => {
      const taskData = task as TaskSetMemberData;
      const canonicalTaskId = taskData.taskVersionRef?.taskId || taskId;
      const meta = taskMeta.get(canonicalTaskId);
      const pinnedVersion =
        taskData.taskVersionRef?.version ?? (meta?.record ? meta.record.latestVersion : undefined);
      const isArchived = meta?.record?.archivedAt != null;

      return {
        pinnedVersion,
        role: taskData.role,
        stratum: taskData.stratum,
        weight: taskData.weight,
        isArchived,
      };
    },
    [taskMeta],
  );

  // --- Draft mutation helpers ---
  const patchDraft = useCallback((patch: Partial<EvaluationSuite>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch, updatedAt: Date.now() } : prev));
  }, []);

  const patchTask = useCallback((taskId: string, patch: Partial<EvaluationTask>) => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
            updatedAt: Date.now(),
          }
        : prev,
    );
  }, []);

  const handleSelectCanonicalTask = useCallback(
    (selection: TaskVersionSelection) => {
      if (!draft) return;

      const newTask: EvaluationTask & {
        taskVersionRef?: { taskId: string; version: number };
        role?: TaskSetMemberRole;
        stratum?: string | null;
        weight?: number;
      } = {
        id: selection.taskId,
        title:
          selection.taskVersion.title || selection.taskVersion.objective || selection.taskRecord.id,
        prompt: selection.taskVersion.candidateInstruction,
        systemPrompt: "",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "",
        order: draft.tasks.length,
        taskVersionRef: { taskId: selection.taskId, version: selection.version },
        role: "organic",
        stratum: null,
        weight: 1,
      };

      setDraft({
        ...draft,
        tasks: [...draft.tasks, newTask],
        updatedAt: Date.now(),
      });
      setSelectedTaskId(selection.taskId);
    },
    [draft],
  );

  const moveTask = useCallback((taskId: string, direction: -1 | 1) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const sorted = [...prev.tasks].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((t) => t.id === taskId);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= sorted.length) return prev;
      const tasks = [...sorted];
      [tasks[idx], tasks[newIdx]] = [tasks[newIdx]!, tasks[idx]!];
      const reordered = tasks.map((t, i) => ({ ...t, order: i }));
      return { ...prev, tasks: reordered, updatedAt: Date.now() };
    });
  }, []);

  const deleteTask = useCallback(
    (taskId: string) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const tasks = prev.tasks.filter((t) => t.id !== taskId).map((t, i) => ({ ...t, order: i }));
        return { ...prev, tasks, updatedAt: Date.now() };
      });
      setSelectedTaskId((prev) => {
        if (prev !== taskId) return prev;
        const remaining = draft?.tasks.filter((t) => t.id !== taskId) ?? [];
        return remaining[0]?.id ?? null;
      });
    },
    [draft],
  );

  // --- Save ---
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!repo || !draft || !persisted || saving) return false;
    const saveValidation = validateSuiteForSave(draft);
    if (!saveValidation.valid) {
      setSaveError(saveValidation.errors[0]?.message ?? "Task set failed validation.");
      return false;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let candidate = { ...draft, version: persisted.version };
      if (taskSetRepo) {
        const [currentSuite, currentTaskSet] = await Promise.all([
          repo.getSuite(draft.id),
          taskSetRepo.getTaskSetRecord(draft.id),
        ]);
        if (!currentSuite || currentSuite.revision !== persisted.revision) {
          throw new StorageError("conflict", "Task set was modified in another tab.");
        }
        if (!currentTaskSet) {
          throw new StorageError("conflict", `Task Set ${draft.id} not found`);
        }
        candidate = { ...candidate, version: currentTaskSet.latestVersion + 1 };
        await persistTaskSetVersion(taskSetRepo, candidate, currentTaskSet.revision);
      }
      const newRevision = await repo.saveSuite(candidate, persisted.revision);
      const fresh = await repo.getSuite(draft.id);
      const settled = fresh
        ? { ...fresh, revision: newRevision }
        : { ...candidate, revision: newRevision };
      setPersisted(settled);
      setDraft(structuredClone(settled));
      return true;
    } catch (err: unknown) {
      setSaveError(
        err instanceof StorageError
          ? friendlyStorageError(err)
          : err instanceof Error
            ? err.message
            : "Could not save the task set.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [repo, draft, persisted, saving, taskSetRepo]);

  // --- Run a clean, persisted suite: materialize immutable workload, then start ---
  const runCleanSuite = useCallback(
    async (cleanSuite: EvaluationSuite) => {
      if (!controller || !repo) return;
      setRunError(null);
      setDirtyRunOpen(false);
      setPreflightOpen(false);
      setRunState("materializing");
      try {
        const materializedSuite = await materializeWorkloadBeforeRun(
          repo,
          taskRepo,
          taskSetRepo,
          cleanSuite,
        );
        setRunState("running");
        const result = await controller.start(materializedSuite.id);
        if (result.ok) {
          void navigate(`/experiments/${result.experimentId}`);
        } else {
          setRunError(result.error);
        }
      } catch (err: unknown) {
        setRunError(friendlyRunError(err));
      } finally {
        setRunState("idle");
      }
    },
    [controller, repo, taskRepo, taskSetRepo, navigate],
  );

  // --- Run entry (Run button) ---
  const handleRun = useCallback(() => {
    if (!controller || !persisted) return;
    if (dirty) {
      setRunError(null);
      setDirtyRunOpen(true);
      return;
    }
    setPreflightOpen(true);
  }, [controller, persisted, dirty]);

  const discardDraft = useCallback(() => {
    if (!persisted) return;
    setDirtyRunOpen(false);
    setDraft(structuredClone(persisted));
    setPreflightOpen(true);
  }, [persisted]);

  const cancelDirtyRun = useCallback(() => {
    setDirtyRunOpen(false);
  }, []);

  const saveNewAndRun = useCallback(async () => {
    setDirtyRunOpen(false);
    const saved = await handleSave();
    if (saved) {
      setPreflightOpen(true);
    }
  }, [handleSave]);

  const probeContext = useModelProbe();
  const enabledCandidates = draft?.modelSlots.filter((s) => s.enabled) ?? [];
  const candidateEntries: SuitePreflightEntry[] = enabledCandidates.map((s) => {
    const state = probeContext.states[`${s.providerId}:${s.slug}`] ?? { kind: "untested" as const };
    return {
      modelKey: `${s.providerId}:${s.slug}`,
      label: `${s.providerId}:${s.slug}`,
      state,
    };
  });
  const judgeKey = `${draft?.defaultJudge.providerId ?? "openrouter"}:${draft?.defaultJudge.model ?? ""}`;
  const judgeEntry: SuitePreflightEntry = {
    modelKey: judgeKey,
    label: `Judge · ${judgeKey}`,
    state: probeContext.states[judgeKey] ?? { kind: "untested" as const },
  };

  const handleRunAnyway = useCallback(async () => {
    setPreflightOpen(false);
    if (persisted) await runCleanSuite(persisted);
  }, [runCleanSuite, persisted]);

  if (!taskSetIdResolved) {
    return <NoTaskSetSelected />;
  }

  if (loading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading task set…</span>
      </div>
    );
  }

  if (loadError || !persisted || !draft) {
    return (
      <div
        className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center"
        data-task-set-editor={versionParam !== undefined ? "" : undefined}
      >
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">{loadError ?? "Task set not found."}</p>
        {versionParam !== undefined && (
          <p className="text-xs text-text-muted">Historical versions are read-only.</p>
        )}
        <button
          type="button"
          onClick={() => navigate("/evaluations/sets")}
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to task sets
        </button>
      </div>
    );
  }

  const selectedTask = draft.tasks.find((t) => t.id === selectedTaskId) ?? null;
  const isHistorical = historical !== null;
  const runDisabledReason = isHistorical
    ? "Historical versions are read-only"
    : !execValidation.valid
      ? (execValidation.errors[0]?.message ?? "Task set is not ready to run.")
      : !controller
        ? "Storage unavailable — cannot start an experiment"
        : executionOwner
          ? "Another execution is active"
          : persisted.archivedAt != null
            ? "Archived task sets cannot run"
            : null;
  const canRun = runDisabledReason === null;

  // Selected task canonical metadata
  const selectedTaskData = selectedTask as TaskSetMemberData | null;
  const selectedCanonicalTaskId =
    selectedTaskData?.taskVersionRef?.taskId || selectedTask?.id || "";
  const selectedMeta = taskMeta.get(selectedCanonicalTaskId);
  const selectedRecord = selectedMeta?.record ?? null;
  const availableVersions = selectedMeta?.versions ?? [];
  const pinnedVersionNum =
    selectedTaskData?.taskVersionRef?.version ??
    (selectedRecord ? selectedRecord.latestVersion : 1);
  const isSelectedTaskArchived = selectedRecord?.archivedAt != null;

  const inheritDescription =
    draft.defaultEvaluation.kind === "holistic"
      ? "Inherits the task set default: holistic judgment"
      : `Inherits the task set default: pinned rubric ${resolveRubricLabel(draft.defaultEvaluation.profile)}`;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-task-set-editor={taskSetIdResolved === "new" ? "new" : ""}
    >
      <header className="flex flex-col gap-2 border-b border-edge p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-base text-text">
              {draft.name || "Untitled task set"}
            </h1>
            <span className="shrink-0 rounded-sm border border-edge px-1.5 py-0.5 font-mono text-xs text-text-secondary tabular-nums">
              v{isHistorical ? historical : persisted.version}
            </span>
            {persisted.defaultEvaluation.kind === "profile" && pinnedRubricLoaded ? (
              pinnedRubric ? (
                <RubricRefChip
                  name={pinnedRubric.name || "Untitled rubric"}
                  rubricId={persisted.defaultEvaluation.profile.id}
                  version={persisted.defaultEvaluation.profile.version}
                />
              ) : (
                <RubricRefChip missing />
              )
            ) : persisted.defaultEvaluation.kind === "holistic" ? (
              <RubricRefChip holistic />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {latestExperiment ? (
              <Link
                to={`/experiments/${latestExperiment.id}`}
                data-testid="latest-results-link"
                title="View the latest experiment results for this task set"
                className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Trophy size={14} aria-hidden="true" />
                Latest results
              </Link>
            ) : null}
            <button
              data-geometry="suite-settings-trigger"
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="suite-settings-disclosure"
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex min-h-[44px] min-w-[104px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronDown
                size={14}
                className={
                  settingsOpen
                    ? "disclosure-chevron shrink-0 rotate-180 transition-transform duration-150 ease-out"
                    : "disclosure-chevron shrink-0 transition-transform duration-150 ease-out"
                }
                aria-hidden="true"
              />
              Settings
            </button>
            <button
              type="button"
              data-action="save-task-set"
              onClick={handleSave}
              disabled={!dirty || saving || isHistorical}
              className="flex min-h-[44px] min-w-[96px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={14} aria-hidden="true" />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              data-action="run-task-set"
              onClick={handleRun}
              disabled={!canRun || runState !== "idle"}
              title={runDisabledReason ?? `Run v${persisted.version}`}
              className="flex min-h-[44px] min-w-[96px] items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-3 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {runState === "materializing" ? (
                <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
              ) : (
                <Play size={14} aria-hidden="true" />
              )}
              {runState === "materializing"
                ? "Preparing…"
                : runState === "running"
                  ? "Running…"
                  : dirty || isHistorical
                    ? "Run"
                    : `Run v${persisted.version}`}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {isHistorical ? (
            <span className="text-text-secondary">
              v{historical} · latest v{persisted.version} · read-only
            </span>
          ) : dirty ? (
            <span className="text-warning">Unsaved changes · next version v{nextVersion}</span>
          ) : (
            <span className="text-success">Saved · v{persisted.version}</span>
          )}
          {runDisabledReason && <span className="text-text-secondary">· {runDisabledReason}</span>}
        </div>

        {saveError && (
          <p role="alert" className="text-sm text-error">
            {saveError}
          </p>
        )}
        {runError && (
          <p role="alert" className="text-sm text-error">
            {runError}
          </p>
        )}
      </header>

      {settingsOpen && (
        <div
          id="suite-settings-disclosure"
          data-geometry="suite-settings-panel"
          className="border-b border-edge p-3"
        >
          <SuiteSettings
            suite={draft}
            onChange={isHistorical ? () => undefined : patchDraft}
            models={models}
            rubricRecords={rubricRecords}
            resolveRubricLabel={resolveRubricLabel}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 lg:flex-row">
        <section
          aria-label="Task list"
          className="min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-edge lg:pr-3"
        >
          <TaskSetTaskList
            tasks={draft.tasks}
            selectedTaskId={selectedTaskId}
            onSelect={(id) => {
              setSelectedTaskId(id);
              if (taskSetIdResolved && !window.matchMedia("(min-width: 1024px)").matches) {
                void navigate(`/evaluations/sets/${taskSetIdResolved}/tasks/${id}`);
              }
            }}
            onAddClick={isHistorical ? () => undefined : () => setTaskSelectorOpen(true)}
            onMove={isHistorical ? () => undefined : moveTask}
            onDelete={isHistorical ? () => undefined : deleteTask}
            readOnly={isHistorical}
            resolveTaskInfo={resolveTaskInfo}
          />
          <div className="mt-3 min-w-0 border-t border-edge pt-3">
            <SuiteExperimentHistory repo={repo} suiteId={persisted.id} />
          </div>
          <div className="mt-3 min-w-0 border-t border-edge pt-3">
            <FusionStudyPanel
              fusionRepo={fusionRepo}
              evalRepo={repo}
              suite={persisted}
              models={models}
            />
          </div>
        </section>

        <section aria-label="Task editor" className="min-h-0 flex-1 lg:overflow-y-auto lg:pl-3">
          {selectedTask ? (
            <div className="flex flex-col gap-4 p-1">
              {/* Canonical Task Identity Header */}
              <div className="flex flex-col gap-2 rounded-md border border-edge bg-panel p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <h2 className="min-w-0 truncate text-base font-semibold text-text">
                      {selectedTask.title || selectedCanonicalTaskId}
                    </h2>
                    <span
                      data-pinned-version
                      className="shrink-0 rounded-sm border border-accent/40 bg-accent/[0.08] px-1.5 py-0.5 font-mono text-xs text-accent"
                    >
                      v{pinnedVersionNum}
                    </span>
                    {isSelectedTaskArchived && (
                      <span className="shrink-0 rounded-sm border border-warning/40 bg-warning/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-warning">
                        Archived
                      </span>
                    )}
                  </div>
                  <Link
                    to={`/tasks/${selectedCanonicalTaskId}`}
                    data-action="open-task-detail"
                    className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-card px-3 text-sm text-text-secondary transition-colors hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    Edit task
                  </Link>
                </div>
                <p className="text-xs text-text-muted">
                  Canonical tasks are managed globally. Editing this task navigates to the Task
                  editor and will not silently mutate saved manifests.
                </p>
              </div>

              {/* Archived Warning Banner */}
              {isSelectedTaskArchived && (
                <div
                  role="alert"
                  data-archived-warning
                  className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/[0.08] p-3 text-xs text-warning"
                >
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-medium">
                      Warning: This referenced canonical task is archived.
                    </p>
                    <p className="text-text-secondary mt-0.5">
                      Archived tasks remain executable in previously saved sets, but cannot receive
                      new canonical versions.
                    </p>
                  </div>
                </div>
              )}

              {/* Candidate Instruction (Read-only Preview) */}
              <div className="flex flex-col gap-1.5">
                <span className="font-mono text-xs uppercase tracking-wide text-text-muted">
                  Candidate Instruction (Read-only preview)
                </span>
                <div className="max-h-[160px] overflow-y-auto rounded-md border border-edge bg-card p-3 font-mono text-xs text-text-secondary scroll-thin whitespace-pre-wrap">
                  {selectedTask.prompt || "(No candidate instruction text)"}
                </div>
              </div>

              {/* Version Pinning Controls */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="member-version-select"
                  className="font-mono text-xs uppercase tracking-wide text-text-muted"
                >
                  Pinned Version
                </label>
                {availableVersions.length > 1 ? (
                  <select
                    id="member-version-select"
                    data-field="member-version"
                    disabled={isHistorical}
                    value={pinnedVersionNum}
                    onChange={(e) => {
                      const newVer = Number(e.target.value);
                      const verObj = availableVersions.find((v) => v.version === newVer);
                      patchTask(selectedTask.id, {
                        title: verObj?.title || verObj?.objective || selectedTask.title,
                        prompt: verObj?.candidateInstruction ?? selectedTask.prompt,
                        taskVersionRef: {
                          taskId: selectedCanonicalTaskId,
                          version: newVer,
                        },
                      } as Partial<EvaluationTask>);
                    }}
                    className="flex min-h-[44px] rounded-md border border-edge bg-input-bg px-3 font-mono text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  >
                    {availableVersions.map((v) => (
                      <option key={v.version} value={v.version}>
                        v{v.version} {v.version === selectedRecord?.latestVersion ? "(latest)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-mono text-xs text-text-secondary">
                    v{pinnedVersionNum}{" "}
                    {selectedRecord?.latestVersion === pinnedVersionNum ? "(latest)" : ""}
                  </span>
                )}
              </div>

              {/* Member Roles, Strata, and Weights */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="member-role-select"
                    className="font-mono text-xs uppercase tracking-wide text-text-muted"
                  >
                    Membership Role
                  </label>
                  <select
                    id="member-role-select"
                    data-field="member-role"
                    disabled={isHistorical}
                    value={selectedTaskData?.role ?? "organic"}
                    onChange={(e) => {
                      patchTask(selectedTask.id, {
                        role: e.target.value as TaskSetMemberRole,
                      } as Partial<EvaluationTask>);
                    }}
                    className="flex min-h-[44px] rounded-md border border-edge bg-input-bg px-3 font-mono text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  >
                    <option value="organic">organic (default)</option>
                    <option value="anchor">anchor</option>
                    <option value="calibration">calibration</option>
                    <option value="holdout">holdout</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="member-stratum-input"
                    className="font-mono text-xs uppercase tracking-wide text-text-muted"
                  >
                    Stratum (optional)
                  </label>
                  <input
                    id="member-stratum-input"
                    data-field="member-stratum"
                    type="text"
                    disabled={isHistorical}
                    value={selectedTaskData?.stratum ?? ""}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      patchTask(selectedTask.id, {
                        stratum: val.length > 0 ? val : null,
                      } as Partial<EvaluationTask>);
                    }}
                    placeholder="e.g. math, code, safety"
                    className="flex min-h-[44px] rounded-md border border-edge bg-input-bg px-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="member-weight-input"
                    className="font-mono text-xs uppercase tracking-wide text-text-muted"
                  >
                    Positive Weight
                  </label>
                  <input
                    id="member-weight-input"
                    data-field="member-weight"
                    type="number"
                    min="0.01"
                    step="0.1"
                    disabled={isHistorical}
                    value={selectedTaskData?.weight ?? 1}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value);
                      if (Number.isFinite(parsed) && parsed > 0) {
                        patchTask(selectedTask.id, {
                          weight: parsed,
                        } as Partial<EvaluationTask>);
                      }
                    }}
                    className="flex min-h-[44px] rounded-md border border-edge bg-input-bg px-3 font-mono text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                  />
                </div>
              </div>

              {/* Evaluation Override */}
              <TaskEvaluationPicker
                selection={selectedTask.evaluation}
                inheritDescription={inheritDescription}
                rubricRecords={rubricRecords}
                resolveRubricLabel={resolveRubricLabel}
                disabled={isHistorical}
                onChange={(sel) => {
                  if (!isHistorical) patchTask(selectedTask.id, { evaluation: sel });
                }}
              />

              {/* Judge Instruction Override */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="judge-override-input"
                  className="font-mono text-xs uppercase tracking-wide text-text-muted"
                >
                  Judge instruction override (evaluator-only)
                </label>
                <textarea
                  id="judge-override-input"
                  data-field="judge-instruction-override"
                  name="judgeInstructionOverride"
                  rows={3}
                  disabled={isHistorical}
                  value={selectedTask.judgeInstructionOverride}
                  onChange={(e) => {
                    if (!isHistorical) {
                      patchTask(selectedTask.id, { judgeInstructionOverride: e.target.value });
                    }
                  }}
                  placeholder="Evaluator-only guidance override for this task in this task set..."
                  className="rounded-md border border-edge bg-input-bg p-3 font-mono text-xs text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-[120px] items-center justify-center text-sm text-text-muted">
              Select a task to inspect details and member configuration, or add a canonical task.
            </div>
          )}
        </section>
      </div>

      <DialogSurface
        open={dirtyRunOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDirtyRunOpen(false);
          }
        }}
        title="Save or discard your changes before running"
        className="max-w-md"
      >
        <div data-dirty-run-dialog className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold text-text">This task set has unsaved changes</h2>
          <p className="text-xs text-text-muted">
            Running must pin an immutable workload. Choose how to proceed:
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-action="dirty-run-save"
              onClick={() => void saveNewAndRun()}
              disabled={saving || runState !== "idle"}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-3 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save a new version and run
            </button>
            <button
              type="button"
              data-action="dirty-run-discard"
              onClick={discardDraft}
              disabled={runState !== "idle"}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Discard draft
            </button>
            <button
              type="button"
              data-action="dirty-run-cancel"
              onClick={cancelDirtyRun}
              disabled={runState !== "idle"}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      </DialogSurface>

      <TaskVersionSelector
        open={taskSelectorOpen}
        onClose={() => setTaskSelectorOpen(false)}
        onSelect={handleSelectCanonicalTask}
        repo={taskRepo}
        existingRefs={draft.tasks.map((t) => {
          const tData = t as TaskSetMemberData;
          return {
            taskId: tData.taskVersionRef?.taskId || t.id,
            version: tData.taskVersionRef?.version,
          };
        })}
      />

      <SuitePreflightDialog
        open={preflightOpen}
        onOpenChange={setPreflightOpen}
        candidates={candidateEntries}
        judge={judgeEntry}
        onRunAnyway={handleRunAnyway}
      />
    </div>
  );
}

function TaskEvaluationPicker({
  selection,
  inheritDescription,
  rubricRecords,
  resolveRubricLabel,
  disabled = false,
  onChange,
}: {
  selection: TaskEvaluationSelection;
  inheritDescription: string;
  rubricRecords: RubricRecord[];
  resolveRubricLabel: (ref: RubricVersionRef) => string;
  disabled?: boolean;
  onChange: (selection: TaskEvaluationSelection) => void;
}) {
  const currentMode = selection.kind;

  return (
    <div className="flex flex-col gap-2 border-t border-edge pt-3">
      <span className="font-mono text-xs uppercase tracking-wide text-text-muted">
        Evaluation Override
      </span>

      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Evaluation mode override"
      >
        <button
          type="button"
          role="radio"
          aria-checked={currentMode === "inherit"}
          disabled={disabled}
          onClick={() => onChange({ kind: "inherit" })}
          className={`flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-xs transition-colors ${
            currentMode === "inherit"
              ? "border-accent bg-accent/[0.12] text-accent font-medium"
              : "border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Inherit suite default
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={currentMode === "holistic"}
          disabled={disabled}
          onClick={() => onChange({ kind: "holistic" })}
          className={`flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-xs transition-colors ${
            currentMode === "holistic"
              ? "border-accent bg-accent/[0.12] text-accent font-medium"
              : "border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Holistic judgment
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={currentMode === "profile"}
          disabled={disabled}
          onClick={() => {
            const first = rubricRecords[0];
            const fallback: RubricVersionRef = first
              ? { id: first.id, version: first.latestVersion }
              : { id: "default", version: 1 };
            onChange({ kind: "profile", profile: fallback });
          }}
          className={`flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-xs transition-colors ${
            currentMode === "profile"
              ? "border-accent bg-accent/[0.12] text-accent font-medium"
              : "border-edge bg-panel text-text-secondary hover:border-edge-bright hover:text-text"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Pin rubric version
        </button>
      </div>

      {currentMode === "inherit" && <p className="text-xs text-text-muted">{inheritDescription}</p>}

      {currentMode === "holistic" && (
        <p className="text-xs text-text-muted">
          Holistic judge scoring: the judge rates candidate outputs directly without criteria
          rubrics.
        </p>
      )}

      {currentMode === "profile" && (
        <div className="flex flex-col gap-1.5 pt-1">
          <label htmlFor="member-rubric-select" className="font-mono text-xs text-text-secondary">
            Pinned Rubric:
          </label>
          {rubricRecords.length > 0 ? (
            <select
              id="member-rubric-select"
              disabled={disabled}
              value={`${selection.profile.id}@${selection.profile.version}`}
              onChange={(e) => {
                const [id, verStr] = e.target.value.split("@");
                if (id && verStr) {
                  onChange({
                    kind: "profile",
                    profile: { id, version: Number(verStr) },
                  });
                }
              }}
              className="flex min-h-[44px] rounded-md border border-edge bg-input-bg px-3 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
            >
              {rubricRecords.map((r) => (
                <option key={r.id} value={`${r.id}@${r.latestVersion}`}>
                  {resolveRubricLabel({ id: r.id, version: r.latestVersion })}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-text-muted">
              Pinned: {resolveRubricLabel(selection.profile)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Reconstruct the read-only compatibility view from one exact immutable Task Set Version. */
async function projectHistoricalSuite(
  latestSuite: EvaluationSuite,
  record: TaskSetRecord,
  version: TaskSetVersion,
  taskRepo: TaskRepository | null,
): Promise<EvaluationSuite> {
  const tasks = await Promise.all(
    [...version.members]
      .sort((a, b) => a.order - b.order)
      .map(async (member): Promise<EvaluationTask> => {
        const latestTask = latestSuite.tasks.find(
          (task) =>
            task.id === member.id ||
            (task as TaskSetMemberData).taskVersionRef?.taskId === member.taskVersionRef.taskId,
        );
        const taskVersion = taskRepo
          ? await taskRepo.getTaskVersion(
              member.taskVersionRef.taskId,
              member.taskVersionRef.version,
            )
          : null;
        const evaluation =
          member.executionOverrides?.evaluation ??
          (member.rubricOverrideRef
            ? { kind: "profile" as const, profile: { ...member.rubricOverrideRef } }
            : { kind: "inherit" as const });
        return {
          id: member.id,
          title:
            taskVersion?.title ??
            latestTask?.title ??
            `${member.taskVersionRef.taskId} v${member.taskVersionRef.version}`,
          prompt: taskVersion?.candidateInstruction ?? latestTask?.prompt ?? "",
          systemPrompt: latestTask?.systemPrompt ?? "",
          evaluation,
          judgeInstructionOverride:
            member.executionOverrides?.judgeInstructionOverride ??
            latestTask?.judgeInstructionOverride ??
            "",
          order: member.order,
          ...(member.executionOverrides?.verification
            ? { verification: { ...member.executionOverrides.verification } }
            : latestTask?.verification
              ? { verification: { ...latestTask.verification } }
              : {}),
          taskVersionRef: { ...member.taskVersionRef },
          role: member.role,
          stratum: member.stratum,
          weight: member.weight,
        } as EvaluationTask & TaskSetMemberData;
      }),
  );
  return {
    ...latestSuite,
    revision: record.revision,
    version: version.version,
    name: record.name,
    description: record.description,
    tasks,
    modelSlots: version.defaultModelSlots.map((slot) => ({ ...slot })),
    defaultJudge: {
      providerId: version.defaultJudge.providerId,
      model: version.defaultJudge.model,
    },
    defaultEvaluation: version.defaultRubricRef
      ? { kind: "profile", profile: { ...version.defaultRubricRef } }
      : { kind: "holistic" },
    ...(version.protocolDefaults.reasoningPolicy
      ? { reasoningPolicy: { ...version.protocolDefaults.reasoningPolicy } }
      : { reasoningPolicy: undefined }),
    createdAt: record.createdAt,
    updatedAt: version.createdAt,
    archivedAt: record.archivedAt,
  };
}

function projectTaskSetVersion(suite: EvaluationSuite) {
  return suiteToTaskSetVersion(suite, (task) => {
    const data = task as TaskSetMemberData;
    return data.taskVersionRef
      ? { taskId: data.taskVersionRef.taskId, version: data.taskVersionRef.version }
      : { taskId: task.id, version: 1 };
  });
}

/** Append (or create) the immutable Task Set Version before updating the Suite compatibility row. */
async function persistTaskSetVersion(
  taskSetRepo: TaskSetRepository,
  candidate: EvaluationSuite,
  expectedRevision: number,
): Promise<number> {
  const record = suiteToTaskSetRecord({ ...candidate, revision: expectedRevision });
  const { version } = projectTaskSetVersion(candidate);
  const existing = await taskSetRepo.getTaskSetRecord(candidate.id);
  if (!existing) {
    await taskSetRepo.createTaskSet({ ...record, latestVersion: version.version }, version);
    return record.revision;
  }
  return taskSetRepo.appendTaskSetVersion(record, version, expectedRevision);
}

type MaterializedSuite = EvaluationSuite & {
  materializedTaskSetRef: {
    taskSetId: string;
    taskSetVersion: number;
    protocolFingerprint: string;
  };
  materializedWorkloadSnapshot: MaterializedWorkloadSnapshot;
};

/** Resolve and durably persist the frozen workload before any controller side effect. */
async function materializeWorkloadBeforeRun(
  repo: EvaluationRepository,
  taskRepo: TaskRepository | null,
  taskSetRepo: TaskSetRepository | null,
  suite: EvaluationSuite,
): Promise<MaterializedSuite> {
  if (!taskSetRepo || !taskRepo) {
    throw new StorageError("validation", "Storage unavailable for workload materialization.");
  }
  const record = suiteToTaskSetRecord(suite);
  const { version } = projectTaskSetVersion(suite);
  const existing = await taskSetRepo.getTaskSetRecord(suite.id);
  if (!existing) {
    await taskSetRepo.createTaskSet({ ...record, latestVersion: version.version }, version);
  }

  const rows = await Promise.all(
    suite.tasks.map((task) => {
      const data = task as TaskSetMemberData;
      return taskRepo.getTaskVersion(
        data.taskVersionRef?.taskId ?? task.id,
        data.taskVersionRef?.version ?? 1,
      );
    }),
  );
  const archivedRows = await Promise.all(
    suite.tasks.map((task) => {
      const data = task as TaskSetMemberData;
      return taskRepo.getTaskRecord(data.taskVersionRef?.taskId ?? task.id);
    }),
  );

  const rubrics = new Map<string, EvaluationRubric>();
  const seenSelections: TaskEvaluationSelection[] = [
    suite.defaultEvaluation,
    ...suite.tasks.map((task) =>
      task.evaluation.kind === "inherit" ? suite.defaultEvaluation : task.evaluation,
    ),
  ];
  for (const sel of seenSelections) {
    if (sel.kind !== "profile") continue;
    const r = await repo.getRubricVersion(sel.profile.id, sel.profile.version);
    if (r) rubrics.set(`${r.id}::${r.version}`, r);
  }

  const resolvers: WorkloadCatalogResolvers = {
    getTaskVersion: (ref) =>
      rows.find((r) => r?.taskId === ref.taskId && r.version === ref.version) ?? undefined,
    getRubricVersion: (ref) => rubrics.get(`${ref.id}::${ref.version}`),
    isTaskArchived: (taskId) => archivedRows.some((r) => r?.id === taskId && r.archivedAt != null),
    isRubricArchived: () => false,
  };

  const snapshot = await taskSetRepo.materializeTaskSetVersion(
    suite.id,
    version.version,
    resolvers,
    {
      allowArchived: false,
      isDirty: false,
    },
  );
  const durable: MaterializedSuite = {
    ...suite,
    materializedTaskSetRef: {
      taskSetId: snapshot.taskSetId,
      taskSetVersion: snapshot.taskSetVersion,
      protocolFingerprint: snapshot.protocolFingerprint,
    },
    materializedWorkloadSnapshot: snapshot,
  };
  const revision = await repo.saveSuite(durable, suite.revision);
  return { ...durable, revision };
}

function friendlyRunError(err: unknown): string {
  if (err instanceof ArchivedTaskExecutionError) {
    return "This task set references an archived task or rubric and cannot run.";
  }
  if (err instanceof UnresolvedWorkloadRefError) {
    return "This task set references unresolved tasks or rubrics and cannot run.";
  }
  if (err instanceof InvalidWorkloadForExecutionError) {
    return "This task set is not ready to run.";
  }
  if (err instanceof StorageError) {
    return friendlyStorageError(err);
  }
  return err instanceof Error ? err.message : "Could not start the task set.";
}

function NoTaskSetSelected() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <h2 className="text-base text-text">No task set selected</h2>
        <p className="text-sm text-text-secondary">
          Choose a task set from the list on the left to start editing, or create a new one.
        </p>
      </div>
    </div>
  );
}

function friendlyStorageError(err: StorageError): string {
  switch (err.kind) {
    case "conflict":
      return "This task set was modified in another tab. Reload to see the latest changes.";
    case "validation":
      return `Validation failed: ${err.message}`;
    case "blocked":
      return "Storage is blocked. Close other tabs using this workspace and try again.";
    case "versionchange":
      return "Close other RSemble tabs to finish the storage upgrade, then retry.";
    case "unavailable":
      return "Storage is unavailable — retry; your existing data was not modified.";
    case "quota":
      return "Storage quota exceeded. Free up disk space to save.";
    default:
      return err.message;
  }
}
