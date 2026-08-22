// =============================================================================
// SuiteTaskEditorRoute — mobile deep-link route for a single task editor.
//
// Renders at /evaluations/:suiteId/tasks/:taskId. On mobile (<1024px) the
// task list and task editor are separate route states (spec §10.3). This
// component loads the suite, finds the task by ID, and renders the
// SuiteTaskEditor standalone with a back link to the suite editor.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  EvaluationSuite,
  EvaluationTask,
  RubricVersionRef,
  RubricRecord,
} from "../../lib/evaluations/evaluation-types";
import type { CatalogModel } from "../../lib/providers/types";
import { SuiteTaskEditor } from "./SuiteTaskEditor";

interface SuiteTaskEditorRouteProps {
  repo: EvaluationRepository | null;
  models: CatalogModel[];
}

export function SuiteTaskEditorRoute({ repo, models }: SuiteTaskEditorRouteProps) {
  const { suiteId, taskSetId, taskId } = useParams<{
    suiteId?: string;
    taskSetId?: string;
    taskId: string;
  }>();
  const ownerId = taskSetId ?? suiteId;
  const navigate = useNavigate();

  const [suite, setSuite] = useState<EvaluationSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rubricRecords, setRubricRecords] = useState<RubricRecord[]>([]);

  const load = useCallback(async () => {
    if (!repo || !ownerId) {
      setSuite(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, rubrics] = await Promise.all([repo.getSuite(ownerId), repo.listRubrics(true)]);
      if (!s) {
        setSuite(null);
        setError("Task set not found.");
      } else {
        setSuite(s);
      }
      setRubricRecords(rubrics.filter((p) => !p.archivedAt));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load task set.");
    } finally {
      setLoading(false);
    }
  }, [repo, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolveRubricLabel = useCallback(
    (ref: RubricVersionRef): string => {
      const rec = rubricRecords.find((p) => p.id === ref.id);
      const name = rec ? `Rubric ${ref.id}` : ref.id;
      return `${name} v${ref.version}`;
    },
    [rubricRecords],
  );

  const task = useMemo(
    () => (suite && taskId ? (suite.tasks.find((t) => t.id === taskId) ?? null) : null),
    [suite, taskId],
  );

  const patchTask = useCallback(
    (patch: Partial<EvaluationTask>) => {
      if (!suite || !taskId) return;
      // In the route context we edit the in-memory suite. Persistence is
      // handled when the user returns to the suite editor and saves. This keeps
      // the mobile task editor focused on authoring.
      setSuite((prev) =>
        prev
          ? {
              ...prev,
              tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
              updatedAt: Date.now(),
            }
          : prev,
      );
    },
    [suite, taskId],
  );

  void models;

  if (loading) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading task…</span>
      </div>
    );
  }

  if (error || !suite) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">{error ?? "Task set not found."}</p>
        <Link
          to="/evaluations/sets"
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Back to task sets
        </Link>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm text-text-muted">Task not found in this task set.</p>
        <button
          type="button"
          onClick={() => navigate(`/evaluations/sets/${ownerId}`)}
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Back to task set
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge p-2">
        <Link
          to={`/evaluations/sets/${ownerId}`}
          aria-label="Back to task set"
          className="flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="truncate">{suite.name || "Untitled task set"}</span>
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-2">
        <SuiteTaskEditor
          task={task}
          suiteDefaultEvaluation={suite.defaultEvaluation}
          onChange={patchTask}
          rubricRecords={rubricRecords}
          resolveRubricLabel={resolveRubricLabel}
        />
      </div>
    </div>
  );
}
