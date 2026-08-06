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
  EvaluationProfileRef,
  ProfileRecord,
} from "../../lib/evaluations/evaluation-types";
import type { CatalogModel } from "../../lib/providers/types";
import { SuiteTaskEditor } from "./SuiteTaskEditor";

interface SuiteTaskEditorRouteProps {
  repo: EvaluationRepository | null;
  models: CatalogModel[];
}

export function SuiteTaskEditorRoute({ repo, models }: SuiteTaskEditorRouteProps) {
  const { suiteId, taskId } = useParams<{ suiteId: string; taskId: string }>();
  const navigate = useNavigate();

  const [suite, setSuite] = useState<EvaluationSuite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileRecords, setProfileRecords] = useState<ProfileRecord[]>([]);

  const load = useCallback(async () => {
    if (!repo || !suiteId) {
      setSuite(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, profiles] = await Promise.all([repo.getSuite(suiteId), repo.listProfiles(true)]);
      if (!s) {
        setSuite(null);
        setError("Suite not found.");
      } else {
        setSuite(s);
      }
      setProfileRecords(profiles.filter((p) => !p.archivedAt));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load suite.");
    } finally {
      setLoading(false);
    }
  }, [repo, suiteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolveProfileLabel = useCallback(
    (ref: EvaluationProfileRef): string => {
      const rec = profileRecords.find((p) => p.id === ref.id);
      const name = rec ? `Profile ${ref.id}` : ref.id;
      return `${name} v${ref.version}`;
    },
    [profileRecords],
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
        <p className="text-sm text-error">{error ?? "Suite not found."}</p>
        <Link
          to="/evaluations"
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Back to suites
        </Link>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm text-text-muted">Task not found in this suite.</p>
        <button
          type="button"
          onClick={() => navigate(`/evaluations/${suiteId}`)}
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Back to suite
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge p-2">
        <Link
          to={`/evaluations/${suiteId}`}
          aria-label="Back to suite"
          className="flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          <span className="truncate">{suite.name || "Untitled suite"}</span>
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-2">
        <SuiteTaskEditor
          task={task}
          suiteDefaultEvaluation={suite.defaultEvaluation}
          onChange={patchTask}
          profileRecords={profileRecords}
          resolveProfileLabel={resolveProfileLabel}
        />
      </div>
    </div>
  );
}
