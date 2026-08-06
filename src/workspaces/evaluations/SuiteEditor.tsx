// =============================================================================
// SuiteEditor — two-pane suite authoring surface (spec §10.3).
//
// Desktop: two-pane split (task list | selected task editor). Header shows
// suite name, persisted version, dirty/save state, suite settings disclosure,
// and Run evaluation button. Save and Run are distinct controls. While dirty
// the header says "Unsaved changes · next version vN+1" and Run is disabled
// with "Save this suite before running". After save, Run states "Run vN" and
// snapshots that exact persisted version. Run is disabled until the persisted
// suite passes execution validation (validateSuiteForExecution).
//
// At <1024px the task list and task editor are separate route states. This
// component handles the desktop split; the mobile routes render SuiteTaskEditor
// directly via the router.
//
// Run evaluation starts a real experiment through the ExperimentController
// context and navigates to /experiments/:experimentId on success. Run is also
// gated on controller availability (storage), the in-tab execution owner, and
// archive state. The `controller` and `executionOwner` optional props are test
// seams: when undefined they resolve from context; pass them explicitly to
// inject fakes without mounting provider trees.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronDown, Loader2, Save, Play, AlertCircle, Trophy } from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { ExperimentController } from "../../lib/evaluations/experiment-controller";
import { useExperimentController } from "../../lib/evaluations/experiment-controller-hooks";
import { useModelProbe } from "../../ui/ModelProbeContext";
import { SuitePreflightDialog, type SuitePreflightEntry } from "./SuitePreflightDialog";
import { useExecutionOwner } from "../../lib/execution-owner-context";
import type { ExecutionOwner } from "../../lib/execution-owner";
import { SuiteExperimentHistory } from "./SuiteExperimentHistory";
import { FusionStudyPanel } from "./FusionStudyPanel";
import { useFusionStudyRepository } from "../../lib/persistence/repository-context";
import {
  type EvaluationSuite,
  type EvaluationTask,
  type EvaluationProfileRef,
  type ExperimentRecord,
  type EvaluationProfile,
  type ProfileRecord,
} from "../../lib/evaluations/evaluation-types";
import type { CatalogModel } from "../../lib/providers/types";
import {
  isSuiteDirty,
  validateSuiteForExecution,
  validateSuiteForSave,
} from "../../lib/evaluations/suite-validation";
import { StorageError } from "../../lib/persistence/database";
import { SuiteTaskList } from "./SuiteTaskList";
import { SuiteTaskEditor } from "./SuiteTaskEditor";
import { SuiteSettings } from "./SuiteSettings";
import { ProfileRefChip } from "../../ui/ProfileRefChip";

interface SuiteEditorProps {
  repo: EvaluationRepository | null;
  /** Catalog models from provider probes (may be empty). */
  models: CatalogModel[];
  /** Test seam: override the context experiment controller. Pass null to
   *  simulate storage-unavailable (no controller). */
  controller?: ExperimentController | null;
  /** Test seam: override the context execution owner. */
  executionOwner?: ExecutionOwner | null;
}

function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function SuiteEditor({
  repo,
  models,
  controller: controllerProp,
  executionOwner: ownerProp,
}: SuiteEditorProps) {
  const { suiteId } = useParams<{ suiteId: string }>();
  const navigate = useNavigate();

  // Context resolution with prop overrides (test seams — see file header).
  const ctxController = useExperimentController();
  const { owner: ctxOwner } = useExecutionOwner();
  const controller = controllerProp !== undefined ? controllerProp : ctxController;
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
  const [profileRecords, setProfileRecords] = useState<ProfileRecord[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const requestIdRef = useRef(0);

  // --- Load suite + profile records ---
  const load = useCallback(async () => {
    if (!repo || !suiteId) {
      setPersisted(null);
      setDraft(null);
      setLoading(false);
      return;
    }
    const id = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [suite, profiles] = await Promise.all([
        repo.getSuite(suiteId),
        repo.listProfiles(true),
      ]);
      if (id !== requestIdRef.current) return;
      if (!suite) {
        setPersisted(null);
        setDraft(null);
        setLoadError("Suite not found.");
      } else {
        setPersisted(suite);
        setDraft(structuredClone(suite));
        // Auto-select first task if none selected.
        setSelectedTaskId((prev) => prev ?? suite.tasks[0]?.id ?? null);
      }
      setProfileRecords(profiles.filter((p) => !p.archivedAt));
      setLoading(false);
    } catch (err: unknown) {
      if (id !== requestIdRef.current) return;
      setLoadError(err instanceof Error ? err.message : "Failed to load suite.");
      setLoading(false);
    }
  }, [repo, suiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Latest experiment for the header "Latest results" entry — the persistent
  // path back to results after navigation (discoverability, spec §10.4).
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

  // Resolve the persisted default-evaluation pin for the header rubric chip
  // (identity spec §5.3). Tracks the persisted suite — the version Run uses.
  const [pinnedProfile, setPinnedProfile] = useState<EvaluationProfile | null>(null);
  const [pinnedProfileLoaded, setPinnedProfileLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPinnedProfile(null);
    setPinnedProfileLoaded(false);
    if (!repo || !persisted) return;
    const ev = persisted.defaultEvaluation;
    if (ev.kind !== "profile") {
      setPinnedProfileLoaded(true);
      return;
    }
    void repo
      .getProfile(ev.profile.id, ev.profile.version)
      .then((p) => {
        if (!cancelled) {
          setPinnedProfile(p);
          setPinnedProfileLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setPinnedProfileLoaded(true);
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

  // --- Resolve profile label (id + version → "Name vN") ---
  const resolveProfileLabel = useCallback(
    (ref: EvaluationProfileRef): string => {
      const rec = profileRecords.find((p) => p.id === ref.id);
      const name = rec ? `Profile ${ref.id}` : ref.id;
      return `${name} v${ref.version}`;
    },
    [profileRecords],
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

  const addTask = useCallback(() => {
    if (!draft) return;
    const id = generateTaskId();
    const newTask: EvaluationTask = {
      id,
      title: "",
      prompt: "",
      systemPrompt: "",
      evaluation: { kind: "inherit" },
      judgeInstructionOverride: "",
      order: draft.tasks.length,
    };
    setDraft({
      ...draft,
      tasks: [...draft.tasks, newTask],
      updatedAt: Date.now(),
    });
    setSelectedTaskId(id);
  }, [draft]);

  const moveTask = useCallback((taskId: string, direction: -1 | 1) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const idx = prev.tasks.findIndex((t) => t.id === taskId);
      if (idx < 0) return prev;
      const newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= prev.tasks.length) return prev;
      const tasks = [...prev.tasks];
      [tasks[idx], tasks[newIdx]] = [tasks[newIdx], tasks[idx]];
      // Reassign order to reflect new positions.
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
        // Move selection to the nearest remaining task.
        const remaining = draft?.tasks.filter((t) => t.id !== taskId) ?? [];
        return remaining[0]?.id ?? null;
      });
    },
    [draft],
  );

  // --- Save ---
  const handleSave = useCallback(async () => {
    if (!repo || !draft || !persisted || saving) return;
    const saveValidation = validateSuiteForSave(draft);
    if (!saveValidation.valid) {
      setSaveError(saveValidation.errors[0]?.message ?? "Suite failed validation.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const newRevision = await repo.saveSuite(
        { ...draft, version: draft.version, revision: persisted.revision },
        persisted.revision,
      );
      // Reload persisted state to reflect the saved revision.
      const fresh = await repo.getSuite(draft.id);
      if (fresh) {
        setPersisted({ ...fresh, revision: newRevision });
        setDraft(structuredClone({ ...fresh, revision: newRevision }));
      }
    } catch (err: unknown) {
      const msg =
        err instanceof StorageError
          ? friendlyStorageError(err)
          : err instanceof Error
            ? err.message
            : "Could not save the suite.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [repo, draft, persisted, saving]);

  // --- Run experiment ---
  const handleRun = useCallback(async () => {
    if (!controller || !persisted) return;
    setRunError(null);
    const result = await controller.start(persisted.id);
    if (result.ok) {
      navigate(`/experiments/${result.experimentId}`);
    } else {
      setRunError(result.error);
    }
  }, [controller, persisted, navigate]);

  // --- Suite model preflight (spec §8.5) — one unconditional hook, map lookups. ---
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
    await handleRun();
  }, [handleRun]);

  // --- States ---
  if (!suiteId) {
    return <NoSuiteSelected />;
  }

  if (loading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading suite…</span>
      </div>
    );
  }

  if (loadError || !persisted || !draft) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">{loadError ?? "Suite not found."}</p>
        <button
          type="button"
          onClick={() => navigate("/evaluations")}
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to suites
        </button>
      </div>
    );
  }

  const selectedTask = draft.tasks.find((t) => t.id === selectedTaskId) ?? null;
  const runDisabledReason = dirty
    ? "Save this suite before running"
    : !execValidation.valid
      ? (execValidation.errors[0]?.message ?? "Suite is not ready to run.")
      : !controller
        ? "Storage unavailable — cannot start an experiment"
        : executionOwner
          ? "Another execution is active"
          : persisted.archivedAt != null
            ? "Archived suites cannot run"
            : null;
  const canRun = runDisabledReason === null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex flex-col gap-2 border-b border-edge p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-base text-text">
              {draft.name || "Untitled suite"}
            </h1>
            <span className="shrink-0 rounded-sm border border-edge px-1.5 py-0.5 font-mono text-xs text-text-secondary tabular-nums">
              v{persisted.version}
            </span>
            {/* Identity spec §5.3: name the pinned rubric where the suite is
                configured. Rendered outside the row-link pattern — the header
                has no nesting constraint. */}
            {persisted.defaultEvaluation.kind === "profile" && pinnedProfileLoaded ? (
              pinnedProfile ? (
                <ProfileRefChip
                  name={pinnedProfile.name || "Untitled rubric"}
                  profileId={persisted.defaultEvaluation.profile.id}
                  version={persisted.defaultEvaluation.profile.version}
                />
              ) : (
                <ProfileRefChip missing />
              )
            ) : persisted.defaultEvaluation.kind === "holistic" ? (
              <ProfileRefChip holistic />
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {latestExperiment ? (
              <Link
                to={`/experiments/${latestExperiment.id}`}
                data-testid="latest-results-link"
                title="View the latest experiment results for this suite"
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
              data-action="save-suite"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex min-h-[44px] min-w-[96px] items-center justify-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={14} aria-hidden="true" />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              data-action="run-suite"
              onClick={() => {
                // Run snaps the exact persisted version inside the controller;
                // success navigates to the live experiment progress route.
                // Preflight confirmation summarizes model test state first (§8.5).
                if (canRun) {
                  setPreflightOpen(true);
                }
              }}
              disabled={!canRun}
              title={runDisabledReason ?? `Run v${persisted.version}`}
              className="flex min-h-[44px] min-w-[96px] items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-3 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} aria-hidden="true" />
              {dirty ? "Run" : `Run v${persisted.version}`}
            </button>
          </div>
        </div>

        {/* Dirty / validation state line */}
        <div className="flex items-center gap-3 text-xs">
          {dirty ? (
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

      {/* Settings disclosure (in-page, not a permanent third pane) */}
      {settingsOpen && (
        <div
          id="suite-settings-disclosure"
          data-geometry="suite-settings-panel"
          className="border-b border-edge p-3"
        >
          <SuiteSettings
            suite={draft}
            onChange={patchDraft}
            models={models}
            profileRecords={profileRecords}
            resolveProfileLabel={resolveProfileLabel}
          />
        </div>
      )}

      {/* Two-pane split: task list | task editor */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 lg:flex-row">
        <section
          aria-label="Task list"
          className="min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-edge lg:pr-3"
        >
          <SuiteTaskList
            tasks={draft.tasks}
            selectedTaskId={selectedTaskId}
            onSelect={(id) => {
              setSelectedTaskId(id);
              // On mobile, navigate to the task route for deep-linking.
              if (suiteId && !window.matchMedia("(min-width: 1024px)").matches) {
                navigate(`/evaluations/${suiteId}/tasks/${id}`);
              }
            }}
            onAdd={addTask}
            onMove={moveTask}
            onDelete={deleteTask}
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
            <SuiteTaskEditor
              task={selectedTask}
              suiteDefaultEvaluation={draft.defaultEvaluation}
              onChange={(patch) => patchTask(selectedTask.id, patch)}
              profileRecords={profileRecords}
              resolveProfileLabel={resolveProfileLabel}
            />
          ) : (
            <div className="flex min-h-[120px] items-center justify-center text-sm text-text-muted">
              Select a task to edit, or add a new task.
            </div>
          )}
        </section>
      </div>

      {/* Suite model preflight confirmation (spec §8.5) */}
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

function NoSuiteSelected() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
      <p className="text-sm text-text-muted">Select a suite from the list.</p>
    </div>
  );
}

function friendlyStorageError(err: StorageError): string {
  switch (err.kind) {
    case "quota":
      return "Storage is full — free space or remove unused data before saving.";
    case "conflict":
      return "This suite was modified elsewhere. Reload and retry.";
    case "validation":
      return "The suite could not be saved — a field failed validation.";
    case "blocked":
    case "versionchange":
      return "Storage is blocked by another tab. Close it and retry.";
    default:
      return err.message || "Storage is unavailable.";
  }
}
