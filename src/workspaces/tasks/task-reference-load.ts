// Load exact Task references from the repository without guessing latest versions.
import type { EvaluationSuite, ExperimentRecord } from "../../lib/evaluations/evaluation-types";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import {
  buildTaskReferenceReadModel,
  summarizeTaskReferences,
  type TaskReferenceReadModel,
  type TaskReferenceSummary,
} from "../../lib/tasks/task-references";
import type { TaskRecord } from "../../lib/tasks/task-types";

export async function loadTaskReferenceReadModel(
  taskRepo: TaskRepository,
  task: TaskRecord,
  evalRepo: EvaluationRepository | null,
): Promise<TaskReferenceReadModel> {
  const [versions, crosswalks, instances, marker] = await Promise.all([
    taskRepo.listTaskVersions(task.id),
    taskRepo.listTaskMigrationCrosswalks(task.id),
    taskRepo.listTaskInstances(task.id),
    taskRepo.getCanonicalTaskMigrationMarker(),
  ]);
  let suites: EvaluationSuite[] = [];
  let experiments: ExperimentRecord[] = [];
  let liveScanAvailable = false;
  if (evalRepo) {
    try {
      const [listedSuites, listedExperiments] = await Promise.all([
        evalRepo.listSuites(true),
        evalRepo.listExperiments(),
      ]);
      suites = listedSuites;
      experiments = listedExperiments;
      liveScanAvailable = true;
    } catch {
      liveScanAvailable = false;
    }
  }
  return buildTaskReferenceReadModel({
    task,
    versions,
    crosswalks,
    suites,
    experiments,
    instances,
    liveScanAvailable,
    unresolvedInventoryKeys: marker?.unresolvedKeys ?? [],
  });
}

export async function loadTaskReferenceSummary(
  taskRepo: TaskRepository,
  task: TaskRecord,
  evalRepo: EvaluationRepository | null,
): Promise<TaskReferenceSummary> {
  return summarizeTaskReferences(await loadTaskReferenceReadModel(taskRepo, task, evalRepo));
}
