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

export function TaskVersionSelector(_props: TaskVersionSelectorProps) {
  // Stub for RED state
  return null;
}
