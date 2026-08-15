import type { EvaluationTask } from "../../lib/evaluations/evaluation-types";
import type { TaskSetMemberRole } from "../../lib/evaluations/task-set-types";

export interface TaskSetTaskListProps {
  tasks: EvaluationTask[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onAddClick: () => void;
  onMove: (taskId: string, direction: -1 | 1) => void;
  onDelete: (taskId: string) => void;
  readOnly?: boolean;
  resolveTaskInfo?: (taskId: string, task: EvaluationTask) => {
    pinnedVersion?: number;
    role?: TaskSetMemberRole;
    stratum?: string | null;
    weight?: number;
    isArchived?: boolean;
  };
}

export function TaskSetTaskList(_props: TaskSetTaskListProps) {
  // Stub for RED state
  return null;
}
