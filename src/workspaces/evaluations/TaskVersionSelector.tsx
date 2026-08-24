// =============================================================================
// TaskVersionSelector — searchable canonical Task/Version selection dialog.
//
// Spec §5.1 / §5.3 (Child 03 Task 6):
//  - Add Task opens a searchable canonical Task/Version selector.
//  - Default selection is latest Task Version, but the pinned version is
//    visible before save.
//  - Older versions are intentionally selectable.
//  - Archived tasks warn and require explicit confirmation before selection.
//  - Exact Task Version refs ({ taskId, version }) are returned.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Check, Layers, Loader2, Search, X } from "lucide-react";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskRecord, TaskVersion } from "../../lib/tasks/task-types";

export interface TaskVersionSelection {
  taskId: string;
  version: number;
  taskRecord: TaskRecord;
  taskVersion: TaskVersion;
}

export interface TaskVersionSelectorProps {
  repo: TaskRepository | null;
  open: boolean;
  onClose: () => void;
  onSelect: (selection: TaskVersionSelection) => void;
  existingRefs?: Array<{ taskId: string; version?: number }>;
}

export function TaskVersionSelector({
  repo,
  open,
  onClose,
  onSelect,
  existingRefs = [],
}: TaskVersionSelectorProps) {
  const [search, setSearch] = useState("");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [taskTitles, setTaskTitles] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [versions, setVersions] = useState<TaskVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedVersionNum, setSelectedVersionNum] = useState<number | null>(null);
  const [archivedConfirmed, setArchivedConfirmed] = useState(false);

  // Load tasks on open or search change
  useEffect(() => {
    if (!open || !repo) {
      setTasks([]);
      setTaskTitles(new Map());
      setSelectedTaskId(null);
      setVersions([]);
      setSelectedVersionNum(null);
      setArchivedConfirmed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void repo
      .listTasks({ search: search.trim(), includeArchived: true, limit: 50 })
      .then(async (records) => {
        if (cancelled) return;
        setTasks(records);
        const verResults = await Promise.all(
          records.map((r) => repo.getTaskVersion(r.id, r.latestVersion).catch(() => null)),
        );
        if (cancelled) return;
        const titles = new Map<string, string>();
        verResults.forEach((v, idx) => {
          if (v && records[idx]) {
            titles.set(records[idx]!.id, v.title || v.objective || records[idx]!.id);
          }
        });
        setTaskTitles(titles);
        setLoading(false);
        if (records.length > 0) {
          setSelectedTaskId((prev) =>
            prev && records.some((r) => r.id === prev) ? prev : records[0]!.id,
          );
        } else {
          setSelectedTaskId(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : "Failed to load tasks.");
      });

    return () => {
      cancelled = true;
    };
  }, [open, repo, search]);

  // Load versions when selectedTaskId changes
  useEffect(() => {
    if (!open || !repo || !selectedTaskId) {
      setVersions([]);
      setSelectedVersionNum(null);
      setArchivedConfirmed(false);
      return;
    }

    let cancelled = false;
    setLoadingVersions(true);

    void repo
      .listTaskVersions(selectedTaskId)
      .then((verList) => {
        if (cancelled) return;
        const sorted = [...verList].sort((a, b) => b.version - a.version);
        setVersions(sorted);
        setLoadingVersions(false);
        const taskRec = tasks.find((t) => t.id === selectedTaskId);
        const defaultVer = taskRec ? taskRec.latestVersion : (sorted[0]?.version ?? 1);
        setSelectedVersionNum(defaultVer);
        setArchivedConfirmed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadingVersions(false);
        setVersions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open, repo, selectedTaskId, tasks]);

  const selectedRecord = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const selectedVersionObj =
    versions.find((v) => v.version === selectedVersionNum) ?? versions[0] ?? null;
  const isArchived = selectedRecord?.archivedAt != null;

  const handleConfirmSelect = useCallback(() => {
    if (!selectedRecord || !selectedVersionObj) return;
    if (isArchived && !archivedConfirmed) return;
    onSelect({
      taskId: selectedRecord.id,
      version: selectedVersionObj.version,
      taskRecord: selectedRecord,
      taskVersion: selectedVersionObj,
    });
    onClose();
  }, [selectedRecord, selectedVersionObj, isArchived, archivedConfirmed, onSelect, onClose]);

  if (!open) return null;

  const canConfirm = selectedRecord && selectedVersionObj && (!isArchived || archivedConfirmed);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-version-selector-title"
      data-task-version-selector
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
    >
      <div className="flex h-[90vh] max-h-[720px] w-full max-w-4xl flex-col rounded-lg border border-edge bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge p-4">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-accent" aria-hidden="true" />
            <h2 id="task-version-selector-title" className="text-base font-medium text-text">
              Select Canonical Task Version
            </h2>
          </div>
          <button
            type="button"
            data-action="close-selector"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Search Toolbar */}
        <div className="border-b border-edge p-3">
          <div className="relative flex items-center">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 text-text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              data-action="search-tasks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks by title or objective…"
              className="flex min-h-[44px] w-full rounded-md border border-edge bg-input-bg pl-9 pr-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>

        {/* Two-Pane Body */}
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-edge md:flex-row md:divide-x md:divide-y-0">
          {/* Left Column: Task List */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2 md:w-1/2">
            {loading ? (
              <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-muted">
                <Loader2 size={16} className="animate-spin-ease" aria-hidden="true" />
                <span>Loading canonical tasks…</span>
              </div>
            ) : error ? (
              <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 p-4 text-center">
                <AlertCircle size={18} className="text-error" aria-hidden="true" />
                <p className="text-sm text-error">{error}</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex min-h-[140px] items-center justify-center p-4 text-center text-sm text-text-muted">
                {search.trim()
                  ? "No canonical tasks match your search."
                  : "No canonical tasks available."}
              </div>
            ) : (
              <ul className="flex flex-col gap-1" role="list">
                {tasks.map((task) => {
                  const isSelected = task.id === selectedTaskId;
                  const alreadyAdded = existingRefs.some((r) => r.taskId === task.id);
                  const isTaskArchived = task.archivedAt != null;
                  const displayTitle = taskTitles.get(task.id) || task.id;

                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        data-task-id={task.id}
                        onClick={() => setSelectedTaskId(task.id)}
                        aria-current={isSelected ? "true" : undefined}
                        className={`flex min-h-[44px] w-full flex-col gap-0.5 rounded-md border p-2.5 text-left transition-colors ${
                          isSelected
                            ? "border-accent/60 bg-accent/[0.08]"
                            : "border-edge bg-panel hover:border-edge-bright hover:bg-card-hover"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-text">
                            {displayTitle}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isTaskArchived && (
                              <span className="rounded-sm border border-warning/40 bg-warning/[0.08] px-1.5 py-0.5 font-mono text-[11px] text-warning">
                                Archived
                              </span>
                            )}
                            {alreadyAdded && (
                              <span className="rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">
                                In set
                              </span>
                            )}
                            <span className="rounded-sm border border-edge px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                              v{task.latestVersion}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right Column: Version Picker & Preview */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:w-1/2">
            {selectedRecord ? (
              <div className="flex flex-col gap-4">
                {/* Task Title & Details */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-semibold text-text">
                      {selectedVersionObj?.title ||
                        taskTitles.get(selectedRecord.id) ||
                        selectedRecord.id}
                    </h3>
                    <span
                      data-pinned-version
                      className="shrink-0 rounded-sm border border-accent/40 bg-accent/[0.08] px-2 py-0.5 font-mono text-xs text-accent"
                    >
                      Pinned: v{selectedVersionNum ?? selectedRecord.latestVersion}
                    </span>
                  </div>
                  {selectedVersionObj?.objective && (
                    <p className="mt-1 text-xs text-text-secondary">
                      {selectedVersionObj.objective}
                    </p>
                  )}
                </div>

                {/* Version Selector */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="task-version-select"
                    className="font-mono text-xs uppercase tracking-wide text-text-muted"
                  >
                    Version Pin
                  </label>
                  {loadingVersions ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
                      <Loader2 size={12} className="animate-spin-ease" aria-hidden="true" />
                      <span>Loading versions…</span>
                    </div>
                  ) : versions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        id="task-version-select"
                        value={selectedVersionNum ?? selectedRecord.latestVersion}
                        onChange={(e) => setSelectedVersionNum(Number(e.target.value))}
                        className="flex min-h-[44px] flex-1 rounded-md border border-edge bg-input-bg px-3 font-mono text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {versions.map((ver) => (
                          <option
                            key={ver.version}
                            value={ver.version}
                            data-version-option={ver.version}
                          >
                            v{ver.version}{" "}
                            {ver.version === selectedRecord.latestVersion ? "(latest)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="font-mono text-xs text-text-secondary">
                      v{selectedRecord.latestVersion} (latest)
                    </span>
                  )}
                </div>

                {/* Candidate Instruction Preview */}
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono text-xs uppercase tracking-wide text-text-muted">
                    Candidate Instruction Preview
                  </span>
                  <div className="max-h-[160px] overflow-y-auto rounded-md border border-edge bg-card p-3 font-mono text-xs text-text-secondary scroll-thin whitespace-pre-wrap">
                    {selectedVersionObj?.candidateInstruction || "(No candidate instruction text)"}
                  </div>
                </div>

                {/* Archived Warning & Confirmation */}
                {isArchived && (
                  <div
                    role="alert"
                    data-archived-warning
                    className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/[0.08] p-3 text-xs text-warning"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                      <div>
                        <p className="font-medium">Warning: This canonical task is archived.</p>
                        <p className="text-text-secondary mt-0.5">
                          Archived tasks can only execute in previously saved sets. Adding to a new
                          workload requires explicit confirmation.
                        </p>
                      </div>
                    </div>
                    <label className="flex min-h-[44px] items-center gap-2 pt-1 font-sans text-xs text-text cursor-pointer">
                      <input
                        type="checkbox"
                        data-action="confirm-archived"
                        checked={archivedConfirmed}
                        onChange={(e) => setArchivedConfirmed(e.target.checked)}
                        className="h-4 w-4 rounded-sm border-edge text-accent focus-visible:ring-2 focus-visible:ring-accent"
                      />
                      <span>I confirm adding this archived task version to the task set</span>
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[200px] items-center justify-center text-center text-sm text-text-muted">
                Select a task on the left to inspect versions and preview instructions.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-edge p-3">
          <button
            type="button"
            data-action="close-selector"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[80px] items-center justify-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            data-action="confirm-select-task"
            onClick={handleConfirmSelect}
            disabled={!canConfirm}
            className="flex min-h-[44px] min-w-[120px] items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.12] px-4 text-sm font-medium text-accent hover:bg-accent/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} aria-hidden="true" />
            Add to task set
          </button>
        </div>
      </div>
    </div>
  );
}
