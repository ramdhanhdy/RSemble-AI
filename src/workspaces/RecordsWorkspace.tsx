import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { isRecordType } from "../lib/records/record-reference";
import { useRecordsRepository } from "../lib/persistence/repository-context";
import type { RunConfigPreload } from "../lib/runs/run-config-preload";
import { DataArchiveActions } from "../ui/DataArchiveActions";
import type { StatusMarkStatus } from "../ui/StatusMark";
import { RecordDetail } from "./records/RecordDetail";
import type { RecordsFiltersValue } from "./records/RecordsFilters";
import { RecordsList } from "./records/RecordsList";
import { RecordNotFound } from "./records/RecordNotFound";

const DESKTOP_QUERY = "(min-width: 1024px)";
const LIST_WIDTH = 380;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const STATUS_VALUES: Record<StatusMarkStatus, true> = {
  draft: true,
  queued: true,
  running: true,
  paused: true,
  completed: true,
  completed_with_failures: true,
  partial: true,
  failed: true,
  aborted: true,
  interrupted: true,
  archived: true,
  ready: true,
  reusable: true,
};

function filtersFromSearchParams(searchParams: URLSearchParams): RecordsFiltersValue {
  const type = searchParams.get("type") ?? "";
  const status = searchParams.get("status") ?? "";
  const mode = searchParams.get("mode") ?? "";
  const source = searchParams.get("source") ?? "";
  return {
    text: searchParams.get("text") ?? "",
    type: isRecordType(type) ? type : "",
    modelKey: searchParams.get("model") ?? searchParams.get("modelKey") ?? "",
    status:
      status.length > 0 && STATUS_VALUES[status as StatusMarkStatus]
        ? (status as StatusMarkStatus)
        : "",
    mode: mode === "rank" || mode === "fuse" ? mode : "",
    source: source === "adhoc" || source === "experiment" || source === "legacy" ? source : "",
  };
}

export function RecordsWorkspace({
  onOpenInCompare,
}: {
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  const repository = useRecordsRepository();
  const { recordType: rawRecordType, recordId } = useParams<{
    recordType: string;
    recordId: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const recordType = isRecordType(rawRecordType) ? rawRecordType : null;
  const selected = recordType && recordId ? { recordType, id: recordId } : null;
  const [initialFilters] = useState(() => filtersFromSearchParams(searchParams));
  const focusCandidateId = searchParams.get("candidate");
  const focusJudgeAttemptId = searchParams.get("attempt");

  function syncFilters(filters: RecordsFiltersValue) {
    const next = new URLSearchParams();
    if (filters.text) next.set("text", filters.text);
    if (filters.type) next.set("type", filters.type);
    if (filters.modelKey) next.set("model", filters.modelKey);
    if (filters.status) next.set("status", filters.status);
    if (filters.mode) next.set("mode", filters.mode);
    if (filters.source) next.set("source", filters.source);
    setSearchParams(next, { replace: true });
  }

  const detail =
    rawRecordType && recordId ? (
      recordType ? (
        <RecordDetail
          repository={repository}
          recordType={recordType}
          recordId={recordId}
          focusCandidateId={focusCandidateId}
          focusJudgeAttemptId={focusJudgeAttemptId}
          onOpenInCompare={onOpenInCompare}
        />
      ) : (
        <RecordNotFound recordType={rawRecordType} id={recordId} />
      )
    ) : null;

  if (!isDesktop && detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          <Link
            to="/records"
            className="motion-state flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Records
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
      </div>
    );
  }

  if (!isDesktop) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-3">
          <RecordsList
            repository={repository}
            selected={selected}
            initialFilters={initialFilters}
            onFiltersChange={syncFilters}
          />
        </div>
        <div id="import-data" className="shrink-0 border-t border-edge px-3 py-2">
          <DataArchiveActions />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div
        className="flex min-h-0 flex-col border-r border-edge bg-panel"
        style={{ width: `${LIST_WIDTH}px`, flexShrink: 0 }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-3">
          <RecordsList
            repository={repository}
            selected={selected}
            initialFilters={initialFilters}
            onFiltersChange={syncFilters}
          />
        </div>
        <div id="import-data" className="shrink-0 border-t border-edge px-3 py-2">
          <DataArchiveActions />
        </div>
      </div>
      <div className="min-h-0 min-w-[600px] flex-1 overflow-y-auto">
        {detail ?? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-text-secondary">
              Select a record to inspect exact evidence.
            </p>
            <p className="text-sm text-text-muted">
              Semantic references open their owning workspace; exact rows open here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
