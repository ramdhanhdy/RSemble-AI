// Exact historical references and instance disclosure for Task detail.
import { useEffect, useState } from "react";
import { StorageError } from "../../lib/persistence/database";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskReferenceReadModel } from "../../lib/tasks/task-references";
import type { TaskRecord } from "../../lib/tasks/task-types";
import { loadTaskReferenceReadModel } from "./task-reference-load";

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}

export function TaskReferencesSection({
  taskRepo,
  evalRepo,
  task,
}: {
  taskRepo: TaskRepository;
  evalRepo: EvaluationRepository | null;
  task: TaskRecord;
}) {
  const [model, setModel] = useState<TaskReferenceReadModel | null>(null);
  const [error, setError] = useState<StorageError | null>(null);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setError(null);
    loadTaskReferenceReadModel(taskRepo, task, evalRepo)
      .then((next) => {
        if (!cancelled) setModel(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof StorageError ? err : new StorageError("unavailable", String(err)));
      });
    return () => {
      cancelled = true;
    };
  }, [taskRepo, evalRepo, task]);

  return (
    <section
      data-task-references-section
      className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4"
    >
      <h2 className="text-base font-semibold text-text">References</h2>
      {error ? (
        <p role="alert" className="text-sm text-error">
          Failed to load references ({error.kind}).
        </p>
      ) : model === null ? (
        <p className="text-sm text-text-muted">Loading references…</p>
      ) : (
        <>
          <p className="text-sm text-text-secondary">
            {model.counts.total} references · origin {model.origin}
          </p>
          <p className="text-sm text-text-secondary">{model.originLimitation}</p>

          {model.currentSuites.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-text">Current suites</h3>
              <ul className="flex flex-col gap-1">
                {model.currentSuites.map((item) => (
                  <li
                    key={`${item.suiteId}:v${item.suiteVersion}:${item.legacyTaskId}`}
                    className="text-sm text-text-secondary"
                  >
                    {item.suiteName ?? item.suiteId} v{item.suiteVersion} ·{" "}
                    {item.state === "resolved" ? `exact v${item.taskVersion}` : item.state}
                    {item.limitation ? ` · ${item.limitation}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {model.experiments.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-text">Historical experiments</h3>
              <ul className="flex flex-col gap-1">
                {model.experiments.map((item) => (
                  <li key={item.experimentId} className="text-sm text-text-secondary">
                    {item.experimentId} · suite {item.suiteId} v{item.suiteVersion} ·{" "}
                    {item.state === "resolved" ? `exact v${item.taskVersion}` : item.state}
                    {item.limitation ? ` · ${item.limitation}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {model.unresolvedDefinitions.length > 0 ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-text">Unresolved definitions</h3>
              <ul className="flex flex-col gap-1">
                {model.unresolvedDefinitions.map((item) => (
                  <li key={item.key} className="text-sm text-text-secondary">
                    {item.key} · {item.limitation}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div data-task-instances className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-text">Task instances</h3>
            {model.instances.length === 0 ? (
              <p className="text-sm text-text-secondary">No stored instances.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {model.instances.map((item) => (
                  <li key={item.id} className="text-sm text-text-secondary">
                    {item.inputDigestAbbreviation} · {item.sourceKind} · {item.state} ·{" "}
                    {formatTimestamp(item.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
