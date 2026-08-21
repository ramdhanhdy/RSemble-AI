// =============================================================================
// RunsWorkspace — responsive list/detail layout (spec §8.1).
//
// Desktop (>=1024px with container >=960px): split layout with list (320–420px)
// + detail pane. Reuses useResizableSplit for the divider.
// Mobile/tablet (<1024px): route-based — list at /runs, detail at /runs/:id.
// =============================================================================

import { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useRunRepository } from "../lib/persistence/repository-context";
import { useRunList } from "./runs/useRunList";
import { useRunDetail } from "./runs/useRunDetail";
import { RunList } from "./runs/RunList";
import { RunDetail } from "./runs/RunDetail";
import { LegacyRunDetail } from "./runs/LegacyRunDetail";
import { DataArchiveActions } from "../ui/DataArchiveActions";
import type { RunConfigPreload } from "../lib/runs/run-config-preload";
import { RecordNotFound } from "./records/RecordNotFound";

/** Inline media query — matches the pattern in rsemble.tsx. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const DESKTOP_QUERY = "(min-width: 1024px)";
const LIST_WIDTH = 380;

export function RunsWorkspace({
  onOpenInCompare,
}: {
  /** Run Detail → Open in Compare (Slice 5). Optional; wired by the root
   *  shell, omitted in route-only test renders. */
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  const repo = useRunRepository();
  const { runId } = useParams<{ runId: string }>();
  const [searchParams] = useSearchParams();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  // Deep-link targets from result-matrix evidence links (spec §12.1):
  // /runs/:runId?candidate=:candidateId&attempt=:judgeAttemptId
  const focusCandidateId = searchParams.get("candidate");
  const focusJudgeAttemptId = searchParams.get("attempt");

  // Fetch the selected record for detail rendering
  const { record, loading } = useRunDetail(repo, runId ?? null);

  // Fetch summaries to determine if the selected run is legacy
  const { summaries } = useRunList(repo, { limit: 500 });
  const selectedSummary = runId ? summaries.find((s) => s.id === runId) : null;
  const isLegacy = selectedSummary?.kind === "legacy";

  // --- Mobile/tablet: route-based detail ---
  if (!isDesktop && runId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Link
            to="/runs"
            className="flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary transition-colors duration-150 hover:text-text"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Runs
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLegacy && selectedSummary?.kind === "legacy" ? (
            <LegacyRunDetail
              summary={selectedSummary}
              copyHref={`/records/legacy/${encodeURIComponent(selectedSummary.id)}`}
            />
          ) : loading ? (
            <div className="flex min-h-[120px] items-center justify-center text-sm text-text-muted">
              Loading…
            </div>
          ) : !record ? (
            <RecordNotFound recordType="task-execution" id={runId} />
          ) : (
            <RunDetail
              record={record}
              focusCandidateId={focusCandidateId}
              focusJudgeAttemptId={focusJudgeAttemptId}
              onOpenInCompare={onOpenInCompare}
              copyHref={runId ? `/records/task-execution/${encodeURIComponent(runId)}` : undefined}
            />
          )}
        </div>
      </div>
    );
  }

  // --- Mobile/tablet: list only ---
  if (!isDesktop) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-3">
          <RunList repo={repo} selectedId={runId ?? null} />
        </div>
        <div className="shrink-0 border-t border-edge px-3 py-2">
          <DataArchiveActions />
        </div>
      </div>
    );
  }

  // --- Desktop: split layout ---
  return (
    <div className="flex min-h-0 flex-1">
      {/* List pane — solid panel surface so the run rows read as one
          workspace list instead of cards floating on the shell void
          (Slice 1, transplant map §C1). Detail pane stays on shell. */}
      <div
        className="flex min-h-0 flex-col border-r border-edge bg-panel"
        style={{ width: `${LIST_WIDTH}px`, flexShrink: 0 }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-3">
          <RunList repo={repo} selectedId={runId ?? null} />
        </div>
        <div className="shrink-0 border-t border-edge px-3 py-2">
          <DataArchiveActions />
        </div>
      </div>
      {/* Detail pane */}
      <div className="min-h-0 min-w-[600px] flex-1 overflow-y-auto">
        {runId ? (
          isLegacy && selectedSummary?.kind === "legacy" ? (
            <LegacyRunDetail
              summary={selectedSummary}
              copyHref={`/records/legacy/${encodeURIComponent(selectedSummary.id)}`}
            />
          ) : loading ? (
            <div className="flex min-h-[120px] items-center justify-center text-sm text-text-muted">
              Loading…
            </div>
          ) : !record ? (
            <RecordNotFound recordType="task-execution" id={runId} />
          ) : (
            <RunDetail
              record={record}
              focusCandidateId={focusCandidateId}
              focusJudgeAttemptId={focusJudgeAttemptId}
              onOpenInCompare={onOpenInCompare}
              copyHref={runId ? `/records/task-execution/${encodeURIComponent(runId)}` : undefined}
            />
          )
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-text-secondary">Select a run to inspect its evidence.</p>
            <p className="text-sm text-text-muted">
              Run history is searchable with full audit trail.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
