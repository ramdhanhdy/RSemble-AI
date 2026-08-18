import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, FlaskConical, Loader2, Plus, RotateCcw } from "lucide-react";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import { computeProtocolFingerprint } from "../../lib/evaluations/protocol-fingerprint";
import type { EvaluationRubric, RubricVersionRef } from "../../lib/evaluations/evaluation-types";
import {
  useEvaluationRepository,
  useStudyRepository,
} from "../../lib/persistence/repository-context";
import type {
  PolicyReportPayload,
  PolicyStudyRecord,
} from "../../lib/studies/policy/policy-study-types";
import { RecordRow } from "../../ui/RecordRow";
import { KindEyebrow } from "../../ui/KindEyebrow";
import type { StatusMarkStatus } from "../../ui/StatusMark";
import { draftPolicyStudyDefinition, draftPolicyStudyRecord } from "./lab-draft";

interface PolicyStudyListProps {
  studyRepo?: StudyRepository | null;
  evalRepo?: EvaluationRepository | null;
}

interface StudyRow {
  study: PolicyStudyRecord;
  playbook: PolicyReportPayload | null;
}

function studyStatusMark(status: PolicyStudyRecord["status"]): StatusMarkStatus {
  if (status === "in_progress") return "running";
  if (status === "archived") return "paused";
  if (status === "draft" || status === "completed" || status === "failed") return status;
  return "draft";
}

function honestStateLine(study: PolicyStudyRecord, playbook: PolicyReportPayload | null): string {
  if (playbook?.conclusion) return playbook.conclusion;
  if (study.status === "draft") return "Draft — inputs not sealed";
  if (study.status === "in_progress") return "In progress";
  if (study.status === "failed") return "Failed — see diagnostics";
  if (study.status === "archived") return "Archived";
  return "Completed";
}

function metaLine(study: PolicyStudyRecord, playbook: PolicyReportPayload | null): string {
  const parts = [
    `Task Set v${study.definition.workload.version}`,
    `Pool v${study.definition.modelPool.version}`,
  ];
  const cost = playbook?.rows[0]?.costMultiplier;
  if (typeof cost === "number") parts.push(`policy cost ${cost.toFixed(1)}×`);
  parts.push(
    new Date(study.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  );
  return parts.join(" · ");
}

/**
 * Resolve the real manifest digest for a Task Set Version (F7). Mirrors the
 * PolicyStudyEditor workload-change logic: prefer a persisted materialization's
 * protocolFingerprint; fall back to computing it from the live suite + rubrics
 * when the version is the suite's current version. Returns null when no honest
 * digest can be resolved — the caller keeps the placeholder rather than pinning
 * a fabricated value.
 */
async function resolveManifestDigest(
  evalRepo: EvaluationRepository,
  taskSetId: string,
  version: number,
): Promise<string | null> {
  const suite = await evalRepo.getSuite(taskSetId);
  if (!suite) return null;
  const materializations = await evalRepo.listTaskSetMaterializations(suite.id);
  const materialized = materializations.find((m) => m.taskSetVersion === version);
  if (materialized) return materialized.protocolFingerprint;
  if (version === suite.version) {
    const refs: RubricVersionRef[] = [];
    if (suite.defaultEvaluation.kind === "profile") refs.push(suite.defaultEvaluation.profile);
    for (const task of suite.tasks) {
      if (task.evaluation.kind === "profile") refs.push(task.evaluation.profile);
    }
    const unique = new Map(refs.map((r) => [`${r.id}@${r.version}`, r]));
    const rubrics: EvaluationRubric[] = [];
    for (const ref of unique.values()) {
      const rubric = await evalRepo.getRubricVersion(ref.id, ref.version);
      if (rubric) rubrics.push(rubric);
    }
    return computeProtocolFingerprint(suite, rubrics);
  }
  return null;
}

export function PolicyStudyList({
  studyRepo: studyRepoProp,
  evalRepo: evalRepoProp,
}: PolicyStudyListProps) {
  const ctxStudy = useStudyRepository();
  const ctxEval = useEvaluationRepository();
  const studyRepo = studyRepoProp !== undefined ? studyRepoProp : ctxStudy;
  const evalRepo = evalRepoProp !== undefined ? evalRepoProp : ctxEval;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<StudyRow[]>([]);
  const [taskSetCount, setTaskSetCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [claimFilter, setClaimFilter] = useState("all");
  const [creating, setCreating] = useState(false);
  const prefillConsumed = useRef(false);

  const load = useCallback(async () => {
    if (!studyRepo) {
      setError("Study storage is unavailable.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const studies = await studyRepo.listStudies(true);
      const withBooks: StudyRow[] = await Promise.all(
        studies.map(async (study) => {
          const found = await studyRepo.getPlaybookForStudy(study.id);
          return { study, playbook: found?.playbook ?? null };
        }),
      );
      withBooks.sort((a, b) => b.study.updatedAt - a.study.updatedAt);
      setRows(withBooks);
      if (evalRepo) {
        const suites = await evalRepo.listSuites();
        setTaskSetCount(suites.length);
      } else {
        setTaskSetCount(0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load studies.");
    } finally {
      setLoading(false);
    }
  }, [evalRepo, studyRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  const createDraft = useCallback(
    async (prefill?: { taskSetId: string; version: number }) => {
      if (!studyRepo || creating) return;
      setCreating(true);
      setError(null);
      try {
        // F7: when prefilling from a Task Set Version, resolve the real
        // manifestDigest from the evaluation repository rather than pinning
        // the placeholder. A draft with a placeholder digest can never seal
        // truthfully — the workload it claims to study is unidentified.
        let manifestDigest: string | undefined;
        if (prefill && evalRepo) {
          const resolved = await resolveManifestDigest(
            evalRepo,
            prefill.taskSetId,
            prefill.version,
          );
          manifestDigest = resolved ?? undefined;
        }
        const definition = draftPolicyStudyDefinition(
          prefill && manifestDigest
            ? { taskSetId: prefill.taskSetId, version: prefill.version, manifestDigest }
            : prefill,
        );
        const title = prefill
          ? `Policy Study · ${prefill.taskSetId} v${prefill.version}`
          : "Untitled Policy Study";
        const record = draftPolicyStudyRecord(title, definition, Date.now());
        await studyRepo.createStudy(record);
        void navigate(`/lab/studies/${record.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create the study.");
        setCreating(false);
      }
    },
    [creating, evalRepo, navigate, studyRepo],
  );

  useEffect(() => {
    if (prefillConsumed.current || loading || !studyRepo) return;
    if (searchParams.get("startPolicyStudy") !== "1") return;
    const taskSetId = searchParams.get("taskSetId");
    const versionRaw = searchParams.get("version");
    const version = versionRaw ? Number(versionRaw) : NaN;
    if (!taskSetId || !Number.isInteger(version) || version <= 0) return;
    prefillConsumed.current = true;
    void createDraft({ taskSetId, version });
  }, [createDraft, loading, searchParams, studyRepo]);

  const archivedCount = rows.filter((r) => r.study.archivedAt !== null).length;
  const visibleBase = includeArchived ? rows : rows.filter((r) => r.study.archivedAt === null);
  const showFilters = rows.length > 8;
  const filtersActive = query.trim().length > 0 || statusFilter !== "all" || claimFilter !== "all";

  const visible = useMemo(() => {
    if (!showFilters) return visibleBase;
    const q = query.trim().toLowerCase();
    return visibleBase.filter(({ study, playbook }) => {
      if (statusFilter !== "all" && study.status !== statusFilter) return false;
      const claim = playbook?.claimLevel ?? study.claimLevel;
      if (claimFilter !== "all" && claim !== claimFilter) return false;
      if (!q) return true;
      const hay = `${study.title} ${honestStateLine(study, playbook)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [claimFilter, query, showFilters, statusFilter, visibleBase]);

  const activeCount = rows.filter(
    (r) => r.study.status === "draft" || r.study.status === "in_progress",
  ).length;
  const findingsCount = rows.filter((r) => r.playbook !== null).length;
  const confirmedCount = rows.filter(
    (r) => r.playbook?.claimLevel === "confirmed" || r.study.claimLevel === "confirmed",
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            RESEARCH LAB
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <h1 tabIndex={-1} className="text-lg font-semibold text-text">
              Policy Studies
            </h1>
            <span className="font-mono text-xs text-text-muted tabular-nums">
              {visibleBase.length} {visibleBase.length === 1 ? "study" : "studies"}
            </span>
          </div>
        </div>
        <button
          type="button"
          data-action="new-policy-study"
          disabled={!studyRepo || creating}
          onClick={() => void createDraft()}
          className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus size={14} aria-hidden="true" />
          New Policy Study
        </button>
      </div>

      {rows.length > 0 && (
        <div
          className="grid grid-cols-3 divide-x divide-edge rounded-md border border-edge"
          data-summary-strip=""
        >
          <div data-summary="active" className="p-3">
            <p className="font-mono text-lg tabular-nums text-text">{activeCount}</p>
            <p className="text-xs text-text-secondary">Active</p>
          </div>
          <div data-summary="findings" className="p-3">
            <p className="font-mono text-lg tabular-nums text-text">{findingsCount}</p>
            <p className="text-xs text-text-secondary">Findings</p>
          </div>
          <div data-summary="confirmed" className="p-3">
            <p className="font-mono text-lg tabular-nums text-text">{confirmedCount}</p>
            <p className="text-xs text-text-secondary">Confirmed</p>
          </div>
        </div>
      )}

      {showFilters && (
        <div data-lab-filters="" className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search studies"
            aria-label="Search studies"
            className="min-h-[44px] min-w-0 flex-1 rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={claimFilter}
            onChange={(e) => setClaimFilter(e.target.value)}
            aria-label="Filter by claim level"
            className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="all">All claims</option>
            <option value="exploratory">Exploratory</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </div>
      )}

      {archivedCount > 0 && (
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            data-action="show-archived"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Show archived ({archivedCount})
        </label>
      )}

      {loading && rows.length === 0 && (
        <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-secondary">
          <Loader2 size={16} className="animate-spin-ease text-accent" aria-hidden="true" />
          Loading studies…
        </div>
      )}

      {error && (
        <div
          data-state="error"
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center"
        >
          <AlertCircle size={18} className="text-error" aria-hidden="true" />
          <p className="text-sm font-medium text-error">Failed to load studies.</p>
          <p className="text-xs text-text-secondary">{error}</p>
          <button
            type="button"
            data-action="retry-studies"
            onClick={() => void load()}
            className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div
          data-state="empty"
          className="mx-auto flex max-w-[28rem] flex-col items-center gap-3 py-10 text-center"
        >
          <FlaskConical size={28} className="text-text-muted" aria-hidden="true" />
          <h2 className="text-sm font-medium text-text">No policy studies yet</h2>
          <p className="text-xs text-text-secondary">
            A Policy Study pins an exact Task Set Version, Model Pool, and Fusion Recipes, then
            compares best-single, Rank, Fuse, and Refine policies on held-out tasks. It ends in a
            Policy Playbook — including the finding that fusing is not worth it.
          </p>
          <button
            type="button"
            data-action="new-policy-study"
            disabled={!studyRepo || creating}
            onClick={() => void createDraft()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            New Policy Study
          </button>
          {taskSetCount === 0 && (
            <Link
              to="/evaluations/sets"
              className="flex min-h-[44px] items-center text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Open Evaluations to build a Task Set first
            </Link>
          )}
        </div>
      )}

      {!loading && !error && rows.length > 0 && visible.length === 0 && filtersActive && (
        <div data-state="no-match" className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm text-text-secondary">No matching studies.</p>
          <button
            type="button"
            data-action="clear-filters"
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setClaimFilter("all");
            }}
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear search and filters
          </button>
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="flex flex-col gap-1.5" role="list">
          {visible.map(({ study, playbook }) => {
            const archived = study.archivedAt !== null;
            return (
              <li key={study.id} className={archived ? "opacity-60" : undefined}>
                <RecordRow
                  variant="list"
                  id={study.id}
                  title={study.title}
                  status={studyStatusMark(study.status)}
                  timestamp={study.updatedAt}
                  kind={<KindEyebrow kind="study" />}
                  summary={honestStateLine(study, playbook)}
                  provenance={metaLine(study, playbook)}
                  href={`/lab/studies/${study.id}`}
                >
                  {archived ? <span className="text-xs text-text-secondary">Archived</span> : null}
                </RecordRow>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
