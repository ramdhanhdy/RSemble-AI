// =============================================================================
// SuiteTaskList — task list pane for the suite editor (spec §10.3).
//
// Add task (creates a draft with a stable ID), task rows with title and
// evaluation-mode badge, move up/down controls (no drag-and-drop only), and
// delete with confirmation when a task has content.
// =============================================================================

import { useState } from "react";
import { Plus, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type {
  EvaluationTask,
  TaskEvaluationSelection,
} from "../../lib/evaluations/evaluation-types";

interface SuiteTaskListProps {
  tasks: EvaluationTask[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onAdd: () => void;
  onMove: (taskId: string, direction: -1 | 1) => void;
  onDelete: (taskId: string) => void;
}

/** Short label for a task's evaluation mode. */
function evaluationModeBadge(sel: TaskEvaluationSelection): { label: string; title: string } {
  switch (sel.kind) {
    case "inherit":
      return { label: "Inherit", title: "Inherits the suite's default evaluation" };
    case "holistic":
      return { label: "Holistic", title: "Holistic judgment for this task" };
    case "profile":
      return {
        label: "Rubric",
        title: `Pinned rubric ${sel.profile.id} v${sel.profile.version}`,
      };
  }
}

/** A task "has content" when its prompt or system prompt is non-empty. */
function taskHasContent(task: EvaluationTask): boolean {
  return task.prompt.trim().length > 0 || task.systemPrompt.trim().length > 0;
}

export function SuiteTaskList({
  tasks,
  selectedTaskId,
  onSelect,
  onAdd,
  onMove,
  onDelete,
}: SuiteTaskListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">Tasks</span>
        <button
          type="button"
          data-action="add-task"
          onClick={onAdd}
          className="flex min-h-[44px] items-center gap-1.5 rounded-sm border border-dashed border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus size={13} aria-hidden="true" /> Add task
        </button>
      </div>

      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          No tasks yet. Add a task to start building the suite.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" role="list">
          {tasks.map((task, i) => {
            const isSelected = task.id === selectedTaskId;
            const badge = evaluationModeBadge(task.evaluation);
            const needsConfirm = taskHasContent(task);
            const isConfirming = confirmDeleteId === task.id;
            return (
              <li key={task.id}>
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
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
                      {task.title.trim() || "Untitled task"}
                    </span>
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
                      aria-label={`Move task ${task.title || "Untitled task"} up`}
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => onMove(task.id, -1)}
                      className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move task ${task.title || "Untitled task"} down`}
                      title="Move down"
                      disabled={i === tasks.length - 1}
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
                        aria-label={`Delete task ${task.title || "Untitled task"}`}
                        title="Delete"
                        onClick={() => {
                          if (needsConfirm) {
                            setConfirmDeleteId(task.id);
                          } else {
                            onDelete(task.id);
                          }
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
