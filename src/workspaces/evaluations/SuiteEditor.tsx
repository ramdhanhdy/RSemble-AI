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
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronDown, Loader2, Save, Play, AlertCircle } from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  EvaluationSuite,
  EvaluationTask,
  EvaluationProfileRef,
} from "../../lib/evaluations/evaluation-types";
import type { ProfileRecord } from "../../lib/evaluations/evaluation-types";
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

interface SuiteEditorProps {
  repo: EvaluationRepository | null;
  /** Catalog models from provider probes (may be empty). */
  models: CatalogModel[];
}

function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function SuiteEditor({ repo, models }: SuiteEditorProps) {
  const { suiteId } = useParams<{ suiteId: string }>();
  const navigate = useNavigate();

  const [persisted, setPersisted] = useState<EvaluationSuite | null>(null);
  const [draft, setDraft] = useState<EvaluationSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileRecords, setProfileRecords] = useState<ProfileRecord[]>([]);
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

  const deleteTask = useCallback((taskId: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const tasks = prev.tasks
        .filter((t) => t.id !== taskId)
        .map((t, i) => ({ ...t, order: i }));
      return { ...prev, tasks, updatedAt: Date.now() };
    });
    setSelectedTaskId((prev) => {
      if (prev !== taskId) return prev;
      // Move selection to the nearest remaining task.
      const remaining = draft?.tasks.filter((t) => t.id !== taskId) ?? [];
      return remaining[0]?.id ?? null;
    });
  }, [draft]);

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
      const msg = err instanceof StorageError ? friendlyStorageError(err) : err instanceof Error ? err.message : "Could not save the suite.";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [repo, draft, persisted, saving]);

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
  const canRun = !dirty && execValidation.valid;
  const runDisabledReason = dirty
    ? "Save this suite before running"
    : !execValidation.valid
      ? execValidation.errors[0]?.message ?? "Suite is not ready to run."
      : null;

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
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="suite-settings-disclosure"
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronDown
                size={14}
                className={settingsOpen ? "rotate-180 transition-transform duration-150" : "transition-transform duration-150"}
                aria-hidden="true"
              />
              Settings
            </button>
            <button
              type="button"
              data-action="save-suite"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save size={14} aria-hidden="true" />
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              data-action="run-suite"
              onClick={() => {
                // Run snaps the exact persisted version; execution wiring is a
                // later phase. This control's disabled-state contract is the
                // acceptance criterion here.
                if (canRun) {
                  void runExperiment(repo, persisted);
                }
              }}
              disabled={!canRun}
              title={runDisabledReason ?? `Run v${persisted.version}`}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-3 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} aria-hidden="true" />
              {dirty ? "Run" : `Run v${persisted.version}`}
            </button>
          </div>
        </div>

        {/* Dirty / validation state line */}
        <div className="flex items-center gap-3 text-xs">
          {dirty ? (
            <span className="text-warning">
              Unsaved changes · next version v{nextVersion}
            </span>
          ) : (
            <span className="text-success">Saved · v{persisted.version}</span>
          )}
          {runDisabledReason && (
            <span className="text-text-muted">· {runDisabledReason}</span>
          )}
        </div>

        {saveError && (
          <p role="alert" className="text-sm text-error">{saveError}</p>
        )}
      </header>

      {/* Settings disclosure (in-page, not a permanent third pane) */}
      {settingsOpen && (
        <div id="suite-settings-disclosure" className="border-b border-edge p-3">
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
        <section aria-label="Task list" className="min-h-0 lg:w-[320px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-edge lg:pr-3">
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

/**
 * Run an experiment from the persisted suite. Execution orchestration is a
 * later phase; this stub snaps the exact persisted version and is wired so the
 * Run button's disabled-state contract is testable now.
 */
async function runExperiment(repo: EvaluationRepository | null, suite: EvaluationSuite): Promise<void> {
  if (!repo) return;
  // Future: createExperiment with a snapshot of `suite` (exact persisted version).
  // For now this is a no-op placeholder that satisfies the control contract.
  void suite;
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
