// =============================================================================
// TaskSetTaskList — task list pane for the Task Set editor (spec §5, §10.3).
//
// Displays the deterministic list of canonical Task Version members with:
//  - Deterministic ordering and keyboard-operable Move Up / Move Down
//  - Pinned version tag (vN)
//  - Role, Stratum, and Weight badges
//  - Evaluation mode badge (Inherit / Holistic / Pinned Rubric)
//  - Delete with confirmation
//  - Add task action opening canonical TaskVersionSelector
//  - Read-only support for historical versions
// =============================================================================

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type {
  EvaluationTask,
  TaskEvaluationSelection,
} from "../../lib/evaluations/evaluation-types";
import type { TaskSetMemberRole } from "../../lib/evaluations/task-set-types";
export interface TaskSetMemberData extends EvaluationTask {
  taskVersionRef?: { taskId: string; version: number };
  role?: TaskSetMemberRole;
  stratum?: string | null;
  weight?: number;
}

export interface TaskSetTaskListProps {
  tasks: EvaluationTask[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onAddClick: () => void;
  onMove: (taskId: string, direction: -1 | 1) => void;
  onDelete: (taskId: string) => void;
  readOnly?: boolean;
  resolveTaskInfo?: (
    taskId: string,
    task: EvaluationTask,
  ) => {
    pinnedVersion?: number;
    role?: TaskSetMemberRole;
    stratum?: string | null;
    weight?: number;
    isArchived?: boolean;
  };
}

/** Short label for a task's evaluation mode. */
function evaluationModeBadge(sel: TaskEvaluationSelection): { label: string; title: string } {
  switch (sel.kind) {
    case "inherit":
      return { label: "Inherit", title: "Inherits the task set default evaluation" };
    case "holistic":
      return { label: "Holistic", title: "Holistic judgment (no rubric criteria)" };
    case "profile":
      return {
        label: `Rubric v${sel.profile.version}`,
        title: `Overridden to rubric ${sel.profile.id} v${sel.profile.version}`,
      };
    default:
      return { label: "Unknown", title: "Unknown evaluation mode" };
  }
}

/** A task has content when its prompt or system prompt is non-empty. */
function taskHasContent(task: EvaluationTask): boolean {
  return task.prompt.trim().length > 0 || task.systemPrompt.trim().length > 0;
}

export function TaskSetTaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onAddClick,
  onMove,
  onDelete,
  readOnly = false,
  resolveTaskInfo,
}: TaskSetTaskListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Sort by deterministic order
  const sortedTasks = [...tasks].sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">
          Tasks ({tasks.length})
        </span>
        <button
          type="button"
          data-action="add-task"
          onClick={onAddClick}
          disabled={readOnly}
          className="flex min-h-[44px] items-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary transition-colors hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Plus size={13} aria-hidden="true" /> Add task
        </button>
      </div>

      {sortedTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <p className="text-sm text-text-muted">
            No tasks yet. Add canonical tasks to build this task set.
          </p>
          {!readOnly && (
            <button
              type="button"
              data-action="add-task"
              onClick={onAddClick}
              className="mt-1 flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.08] px-3 font-mono text-xs text-accent hover:bg-accent/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus size={13} aria-hidden="true" /> Add first task
            </button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" role="list">
          {sortedTasks.map((task, i) => {
            const isSelected = task.id === selectedTaskId;
            const badge = evaluationModeBadge(task.evaluation);
            const needsConfirm = taskHasContent(task);
            const isConfirming = confirmDeleteId === task.id;

            const extraInfo = resolveTaskInfo ? resolveTaskInfo(task.id, task) : undefined;
            const taskData = task as TaskSetMemberData;
            const pinnedVersion = extraInfo?.pinnedVersion ?? taskData.taskVersionRef?.version;
            const role = extraInfo?.role ?? taskData.role;
            const stratum = extraInfo?.stratum ?? taskData.stratum;
            const weight = extraInfo?.weight ?? taskData.weight;
            const isArchived = extraInfo?.isArchived ?? false;

            return (
              <li key={task.id} data-task-item>
                <div
                  data-selected={isSelected}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors duration-150 ${
                    isSelected
                      ? "border-accent/50 bg-accent/[0.06]"
                      : "border-edge bg-panel hover:border-edge-bright"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(task.id)}
                    aria-label={`Open task ${task.title || "Untitled task"}`}
                    aria-current={isSelected ? "true" : undefined}
                    className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <span className="font-mono text-xs text-text-muted tabular-nums">{i + 1}.</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm text-text">
                          {task.title.trim() || "Untitled task"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {pinnedVersion !== undefined && (
                          <span
                            data-pinned-version
                            className="rounded-sm border border-edge bg-card px-1 py-0.2 font-mono text-[10.5px] text-text-secondary"
                          >
                            v{pinnedVersion}
                          </span>
                        )}
                        {role && role !== "organic" && (
                          <span className="rounded-sm border border-edge px-1 py-0.2 font-mono text-[10.5px] uppercase tracking-wider text-text-secondary">
                            {role}
                          </span>
                        )}
                        {stratum && (
                          <span className="rounded-sm border border-edge px-1 py-0.2 font-mono text-[10.5px] text-text-secondary">
                            {stratum}
                          </span>
                        )}
                        {weight !== undefined && weight !== 1 && (
                          <span className="rounded-sm border border-edge px-1 py-0.2 font-mono text-[10.5px] text-text-secondary">
                            w:{weight}
                          </span>
                        )}
                        {isArchived && (
                          <span className="rounded-sm border border-warning/40 bg-warning/[0.08] px-1 py-0.2 font-mono text-[10.5px] text-warning">
                            archived
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      title={badge.title}
                      className="shrink-0 rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide text-text-secondary"
                    >
                      {badge.label}
                    </span>
                  </button>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      data-action="move-up"
                      aria-label={`Move task ${task.title || "Untitled task"} up`}
                      title="Move up"
                      disabled={readOnly || i === 0}
                      onClick={() => onMove(task.id, -1)}
                      className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-action="move-down"
                      aria-label={`Move task ${task.title || "Untitled task"} down`}
                      title="Move down"
                      disabled={readOnly || i === sortedTasks.length - 1}
                      onClick={() => onMove(task.id, 1)}
                      className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowDown size={14} aria-hidden="true" />
                    </button>

                    {isConfirming ? (
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          data-action="confirm-delete-task"
                          aria-label={`Confirm delete task ${task.title || "Untitled task"}`}
                          onClick={() => {
                            onDelete(task.id);
                            setConfirmDeleteId(null);
                          }}
                          className="flex min-h-[44px] items-center gap-1 rounded-sm bg-error/[0.12] px-2 text-sm text-error hover:bg-error/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Delete?
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel delete"
                          onClick={() => setConfirmDeleteId(null)}
                          className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        data-action="delete-task"
                        aria-label={`Delete task ${task.title || "Untitled task"}`}
                        title="Delete"
                        disabled={readOnly}
                        onClick={() => {
                          if (needsConfirm) {
                            setConfirmDeleteId(task.id);
                          } else {
                            onDelete(task.id);
                          }
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
