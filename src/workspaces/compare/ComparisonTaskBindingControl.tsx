// =============================================================================
// RSemble AI — Comparison Task Binding Control (spec §7.1, §7.2)
//
// Child 05 (Contextual Compare Results) Milestone D — Task 7.
//
// Canonical Task selection, version pinning, draft detection, and pre-run
// boundary for the Compare command pane:
//   - Search/select canonical Task and exact version
//   - Latest version by default with visible pin
//   - Open Task detail
//   - Clear binding and continue ad hoc
//   - Selecting a Task populates candidate-visible definition and context manifest
//   - Editing task-defining content marks new-Task-version draft
//   - Pre-run choice: Create Task vN+1 and run, Run as ad hoc, or Cancel
//   - No silent mutation of canonical versions, no automatic unlinking
//   - Stale version CAS conflict surfaced cleanly
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, ExternalLink, Link2, Pin, Search, Unlink, X } from "lucide-react";
import { useTaskRepository } from "../../lib/persistence/repository-context";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";
import type { ComparisonTaskBinding } from "../../lib/compare/comparison-result-types";
import { buildNextVersion } from "../../lib/tasks/task-versioning";
import { StorageError } from "../../lib/persistence/database";

export interface ComparisonTaskBindingControlProps {
  /** Canonical Task repository instance (uses context when omitted) */
  repo?: TaskRepository | null;
  /** Current comparison task binding (canonical or null/ad-hoc) */
  binding: ComparisonTaskBinding | null;
  /** Current candidate-visible prompt in Compare */
  prompt: string;
  /** Callback when user selects a canonical task and version */
  onSelectTask: (task: TaskRecord, version: TaskVersion) => void;
  /** Callback when user switches the pinned version of the bound task */
  onVersionChange?: (version: TaskVersion) => void;
  /** Callback when user unlinks canonical binding back to ad hoc */
  onClearBinding: () => void;
  /** Callback to update candidate-visible prompt */
  onPromptChange?: (newPrompt: string) => void;
  /** Callback to proceed with run after pre-run resolution */
  onProceedRun?: (finalBinding: ComparisonTaskBinding | null) => void;
  /** External control of pre-run decision modal */
  isPreRunPromptOpen?: boolean;
  /** Callback when pre-run modal is dismissed */
  onPreRunPromptClose?: () => void;
  /** Optional container class name */
  className?: string;
}

export function ComparisonTaskBindingControl({
  repo: propRepo,
  binding,
  prompt,
  onSelectTask,
  onVersionChange,
  onClearBinding,
  onPromptChange,
  onProceedRun,
  isPreRunPromptOpen = false,
  onPreRunPromptClose,
  className = "",
}: ComparisonTaskBindingControlProps): React.ReactElement {
  const contextRepo = useTaskRepository();
  const repo = propRepo !== undefined ? propRepo : contextRepo;

  // Search & picker state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ task: TaskRecord; title: string }>>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);

  // Bound task record & version state
  const [boundRecord, setBoundRecord] = useState<TaskRecord | null>(null);
  const [boundVersion, setBoundVersion] = useState<TaskVersion | null>(null);

  // Pre-run decision state
  const [isCommitting, setIsCommitting] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when picker opens
  useEffect(() => {
    if (isPickerOpen) {
      searchInputRef.current?.focus();
    }
  }, [isPickerOpen]);

  // Load bound task and version whenever binding changes
  useEffect(() => {
    if (!repo || !binding || binding.kind !== "canonical") {
      setBoundRecord(null);
      setBoundVersion(null);
      return;
    }

    const currentBinding = binding;
    let cancelled = false;
    async function loadBoundTask() {
      try {
        const [record, version] = await Promise.all([
          repo!.getTaskRecord(currentBinding.taskId),
          repo!.getTaskVersion(currentBinding.taskId, currentBinding.taskVersion),
        ]);

        if (cancelled) return;
        if (!record || !version) {
          setBoundRecord(null);
          setBoundVersion(null);
        } else {
          setBoundRecord(record);
          setBoundVersion(version);
        }
      } catch {
        if (!cancelled) {
          setBoundRecord(null);
          setBoundVersion(null);
        }
      }
    }

    void loadBoundTask();
    return () => {
      cancelled = true;
    };
  }, [repo, binding]);

  // Search tasks when picker is open
  useEffect(() => {
    if (!isPickerOpen || !repo) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    setIsSearching(true);

    const trimmed = searchQuery.trim();
    repo
      .listTasks({
        search: trimmed.length > 0 ? trimmed : undefined,
        archiveState: "active",
        limit: 20,
      })
      .then(async (tasks) => {
        if (cancelled) return;
        const tasksWithTitles = await Promise.all(
          tasks.map(async (task) => {
            const ver = await repo.getTaskVersion(task.id, task.latestVersion);
            return {
              task,
              title: ver?.title ?? `Task ${task.id}`,
            };
          }),
        );
        if (!cancelled) {
          setSearchResults(tasksWithTitles);
          setIsSearching(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsSearching(false);
          setSearchResults([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isPickerOpen, searchQuery, repo]);

  // Determine if content is modified (new Task version draft)
  const isDraft = useMemo(() => {
    if (!binding || binding.kind !== "canonical" || !boundVersion) return false;
    // Task-defining instruction check
    return prompt.trim() !== boundVersion.candidateInstruction.trim();
  }, [binding, boundVersion, prompt]);

  // Handle task selection from picker
  const handleSelectTask = async (task: TaskRecord) => {
    if (!repo) return;
    try {
      const latestVer = await repo.getTaskVersion(task.id, task.latestVersion);
      if (!latestVer) return;

      onSelectTask(task, latestVer);
      if (onPromptChange) {
        onPromptChange(latestVer.candidateInstruction || latestVer.objective || "");
      }
      setIsPickerOpen(false);
      setSearchQuery("");
    } catch {
      // ignore
    }
  };

  // Handle version dropdown selection
  const handleVersionChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!repo || !binding || binding.kind !== "canonical") return;
    const nextVerNum = Number(e.target.value);
    try {
      const ver = await repo.getTaskVersion(binding.taskId, nextVerNum);
      if (ver) {
        if (onVersionChange) {
          onVersionChange(ver);
        }
        if (onPromptChange) {
          onPromptChange(ver.candidateInstruction || ver.objective || "");
        }
      }
    } catch {
      // ignore
    }
  };

  // Handle Pre-Run: Create Task vN+1 and run
  const handleCreateVersionAndRun = async () => {
    if (!repo || !binding || binding.kind !== "canonical" || !boundVersion) return;
    setIsCommitting(true);
    setConflictError(null);

    try {
      // 1. Fresh read to verify latest revision CAS
      const freshRecord = await repo.getTaskRecord(binding.taskId);
      if (!freshRecord) {
        throw new StorageError("unavailable", `Task ${binding.taskId} not found`);
      }

      // If another version was already appended, detect conflict
      if (
        freshRecord.latestVersion !== boundVersion.version ||
        freshRecord.revision !== (boundRecord?.revision ?? 0)
      ) {
        throw new StorageError(
          "conflict",
          `Version conflict: Task has been modified to v${freshRecord.latestVersion} (expected v${boundVersion.version}).`,
        );
      }

      // 2. Build immutable next version
      const nextVersionNum = boundVersion.version + 1;
      const now = Date.now();
      const draft: TaskVersion = {
        ...boundVersion,
        candidateInstruction: prompt,
      };
      const nextVersion = buildNextVersion({
        taskId: binding.taskId,
        latestVersion: boundVersion.version,
        draft,
        createdAt: now,
        source: {
          kind: "authored",
          legacyScopeKey: null,
          note: `Created from comparison draft v${nextVersionNum}`,
        },
      });

      // 3. Append via revision CAS atomically before paid calls
      await repo.appendTaskVersion(freshRecord, nextVersion, freshRecord.revision);

      // 4. Update binding and proceed with run
      const newBinding: ComparisonTaskBinding = {
        kind: "canonical",
        taskId: binding.taskId,
        taskVersion: nextVersion.version,
      };

      if (onProceedRun) {
        onProceedRun(newBinding);
      }
      if (onPreRunPromptClose) {
        onPreRunPromptClose();
      }
    } catch (err) {
      const isConflict =
        (err instanceof StorageError && err.kind === "conflict") ||
        String(err).toLowerCase().includes("conflict");
      if (isConflict) {
        setConflictError(
          "Version conflict: This task was modified. Reload to inspect latest changes.",
        );
      } else {
        setConflictError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setIsCommitting(false);
    }
  };

  // Handle Pre-Run: Run as ad hoc
  const handleRunAsAdHoc = () => {
    setConflictError(null);
    if (onProceedRun) {
      onProceedRun(null);
    }
    if (onPreRunPromptClose) {
      onPreRunPromptClose();
    }
  };

  // Handle Pre-Run: Cancel
  const handleCancelRun = () => {
    setConflictError(null);
    if (onPreRunPromptClose) {
      onPreRunPromptClose();
    }
  };

  const isCanonical = binding !== null && binding.kind === "canonical";
  const isLatestVersion =
    isCanonical && boundRecord ? binding.taskVersion === boundRecord.latestVersion : true;

  return (
    <div
      data-testid="comparison-task-binding-control"
      className={`flex flex-col gap-2 rounded-lg border border-edge bg-panel p-3 ${className}`}
    >
      {/* Top row: Status and Primary Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-accent shrink-0" aria-hidden="true" />
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
            Task Binding
          </span>
          <span
            data-testid="task-binding-status"
            className="rounded bg-card px-2 py-0.5 font-mono text-xs text-text-secondary border border-edge"
          >
            {isCanonical ? "Canonical Task" : "Ad hoc comparison"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isCanonical ? (
            <button
              type="button"
              data-action="open-task-picker"
              aria-label="Link canonical task"
              onClick={() => setIsPickerOpen((prev) => !prev)}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-card px-3 text-xs font-medium text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Link2 size={14} />
              Link Task
            </button>
          ) : (
            <button
              type="button"
              data-action="clear-task-binding"
              aria-label="Clear task binding"
              onClick={onClearBinding}
              className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-card px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-card-hover hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Unlink size={14} />
              Clear binding
            </button>
          )}
        </div>
      </div>

      {/* Canonical Task Details Banner */}
      {isCanonical && (
        <div className="flex flex-col gap-2 rounded-md border border-edge/60 bg-card/60 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-medium text-sm text-text truncate">
                {boundVersion?.title ?? `Task ${binding.taskId}`}
              </span>
              <span
                data-testid="task-pin-badge"
                className="flex items-center gap-1 rounded bg-accent/15 px-2 py-0.5 font-mono text-xs text-accent border border-accent/20 shrink-0"
              >
                <Pin size={10} aria-hidden="true" />
                <span>
                  v{binding.taskVersion}
                  {isLatestVersion ? " (latest)" : ""}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Version Selector */}
              {boundRecord && boundRecord.latestVersion > 1 && (
                <label className="flex items-center gap-1 text-xs text-text-muted">
                  <span className="sr-only">Select version</span>
                  <select
                    data-action="select-task-version"
                    aria-label="Select task version"
                    value={binding.taskVersion}
                    onChange={handleVersionChange}
                    className="min-h-[44px] rounded-md border border-edge bg-card px-2 text-xs text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {Array.from({ length: boundRecord.latestVersion }, (_, i) => i + 1).map((v) => (
                      <option key={v} value={v}>
                        v{v}
                        {v === boundRecord.latestVersion ? " (latest)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Open Task Detail Link */}
              <Link
                to={`/tasks/${binding.taskId}/versions/${binding.taskVersion}`}
                data-action="open-task-detail"
                aria-label="Open task detail"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[44px] items-center gap-1 rounded-md border border-edge bg-card px-2.5 text-xs text-text-secondary transition-colors hover:bg-card-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <ExternalLink size={12} />
                <span>View Task</span>
              </Link>
            </div>
          </div>

          {/* Draft Notification Badge */}
          {isDraft && (
            <div
              data-testid="task-draft-badge"
              className="flex items-center gap-2 rounded bg-accent/10 border border-accent/30 px-2.5 py-1.5 text-xs text-accent"
            >
              <AlertCircle size={14} className="shrink-0" />
              <span>
                <strong>New Task version draft (v{binding.taskVersion + 1})</strong> — Content
                modified. Before run you can commit as v{binding.taskVersion + 1} or execute as ad
                hoc.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Task Search Picker Popover */}
      {isPickerOpen && (
        <div
          data-testid="task-picker-popover"
          className="flex flex-col gap-2 rounded-md border border-accent/40 bg-card p-3 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-text">Select Canonical Task</span>
            <button
              type="button"
              data-action="close-task-picker"
              aria-label="Close task picker"
              onClick={() => setIsPickerOpen(false)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted hover:bg-card-hover hover:text-text"
            >
              <X size={14} />
            </button>
          </div>

          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              data-action="search-tasks"
              aria-label="Search canonical tasks"
              placeholder="Search canonical tasks by title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="min-h-[44px] w-full rounded-md border border-edge bg-panel pl-9 pr-3 text-xs text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>

          {/* Results List */}
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto pr-1">
            {isSearching ? (
              <div className="p-3 text-center text-xs text-text-muted">Loading tasks...</div>
            ) : searchResults.length === 0 ? (
              <div className="p-3 text-center text-xs text-text-muted">
                {searchQuery ? "No matching canonical tasks." : "No canonical tasks found."}
              </div>
            ) : (
              searchResults.map(({ task, title }) => (
                <button
                  key={task.id}
                  type="button"
                  data-task-id={task.id}
                  aria-label={`Select task ${title}`}
                  onClick={() => handleSelectTask(task)}
                  className="flex min-h-[44px] items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-text transition-colors hover:bg-panel hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="font-medium truncate">{title}</span>
                  <span className="shrink-0 rounded bg-edge/40 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                    v{task.latestVersion}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Pre-Run Decision Modal / Boundary (spec §7.2) */}
      {isPreRunPromptOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="New Task version decision"
          data-testid="task-version-draft-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-edge bg-card p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="text-accent shrink-0" size={20} />
                <h2 className="text-base font-semibold text-text">Task Content Modified</h2>
              </div>
              <button
                type="button"
                data-action="cancel-run"
                aria-label="Close dialog"
                onClick={handleCancelRun}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted hover:bg-card-hover hover:text-text"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-text-secondary">
              This comparison is bound to canonical Task{" "}
              <strong>
                {boundVersion?.title ??
                  (binding && binding.kind === "canonical" ? binding.taskId : "")}
              </strong>{" "}
              (v
              {boundVersion?.version ??
                (binding && binding.kind === "canonical" ? binding.taskVersion : 1)}
              ). You have modified task-defining prompt content.
            </p>

            {/* Conflict Banner */}
            {conflictError && (
              <div
                role="alert"
                data-testid="task-conflict-banner"
                className="flex flex-col gap-2 rounded-md border border-error/40 bg-error/10 p-3 text-xs text-error"
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertCircle size={14} />
                  <span>{conflictError}</span>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2.5 pt-2">
              {/* Option 1: Create Task vN+1 and run */}
              <button
                type="button"
                data-action="create-version-and-run"
                disabled={isCommitting}
                aria-label={`Create Task v${(boundVersion?.version ?? 1) + 1} and run`}
                onClick={handleCreateVersionAndRun}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <Check size={14} />
                Create Task v{(boundVersion?.version ?? 1) + 1} and run
              </button>

              {/* Option 2: Run as ad hoc */}
              <button
                type="button"
                data-action="run-ad-hoc"
                disabled={isCommitting}
                aria-label="Run as ad hoc"
                onClick={handleRunAsAdHoc}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-edge bg-panel px-4 text-xs font-medium text-text transition-colors hover:bg-card-hover disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Run as ad hoc (preserve canonical v{boundVersion?.version ?? 1})
              </button>

              {/* Option 3: Cancel */}
              <button
                type="button"
                data-action="cancel-run"
                disabled={isCommitting}
                aria-label="Cancel comparison run"
                onClick={handleCancelRun}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-transparent px-4 text-xs font-medium text-text-muted transition-colors hover:bg-card-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
