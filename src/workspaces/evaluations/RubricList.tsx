// =============================================================================
// RubricList — latest rubric revisions with archived filtering (spec §5.1, §6.1).
//
// Lists each RubricRecord's latest revision: name, version, criterion count,
// updated timestamp, archived state. Primary action: New rubric. Row overflow:
// Duplicate, Archive/Restore. Archived filter toggle. Rows render as links to
// /evaluations/rubrics/:rubricId via RecordRow.
//
// Reads the EvaluationRepository from EvaluationContext (no props) so the
// EvaluationsWorkspace provider can inject the repo once for all routes.
// A `repo` prop is accepted for testability and route wrappers that pass it
// explicitly; it takes precedence over context.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Plus,
  Copy,
  Archive,
  ArchiveRestore,
  Loader2,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  EvaluationCriterion,
  EvaluationRubric,
  RubricRecord,
} from "../../lib/evaluations/evaluation-types";
import { useEvaluationRepository } from "../../lib/persistence/evaluation-context";
import { RecordRow } from "../../ui/RecordRow";
import { KindEyebrow } from "../../ui/KindEyebrow";

interface RubricRow {
  record: RubricRecord;
  rubric: EvaluationRubric | null;
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeDefaultCriterion(): EvaluationCriterion {
  // The persisted-record guard requires non-empty 1/3/5 anchors — seed
  // placeholders the user rewrites, or the repository rejects the draft.
  return {
    id: "c-1",
    name: "New criterion",
    description: "",
    weight: 1,
    anchors: {
      one: "1 — does not meet this criterion at all",
      three: "3 — partially meets this criterion",
      five: "5 — fully meets this criterion",
    },
  };
}

const ACTION_BTN =
  "flex h-11 w-11 items-center justify-center text-text-secondary transition-colors hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30";

export function RubricList({ repo }: { repo?: EvaluationRepository | null }) {
  // Hook order must be stable: read the context unconditionally, then
  // prefer the injected repository when one is provided.
  const contextRepository = useEvaluationRepository();
  const repository = repo ?? contextRepository;
  const navigate = useNavigate();
  const [rows, setRows] = useState<RubricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!repository) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const records = await repository.listRubrics(showArchived);
      const rubrics = await Promise.all(
        records.map((r) => repository.getRubricVersion(r.id, r.latestVersion)),
      );
      setRows(records.map((record, i) => ({ record, rubric: rubrics[i] ?? null })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rubrics.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [repository, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRubric() {
    if (!repository) return;
    const id = genId();
    const now = Date.now();
    const record: RubricRecord = {
      id,
      revision: 1,
      latestVersion: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const rubric: EvaluationRubric = {
      id,
      version: 1,
      name: "Untitled rubric",
      description: "",
      judgeInstruction: "",
      criteria: [makeDefaultCriterion()],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await repository.createRubric(record, rubric);
      await load();
      void navigate(`/evaluations/rubrics/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rubric.");
    }
  }

  async function duplicateRubric(record: RubricRecord, rubric: EvaluationRubric | null) {
    if (!repository || !rubric) return;
    setBusyId(record.id);
    try {
      const newId = genId();
      const now = Date.now();
      const newRecord: RubricRecord = {
        id: newId,
        revision: 1,
        latestVersion: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      const newRubric: EvaluationRubric = {
        ...rubric,
        id: newId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repository.createRubric(newRecord, newRubric);
      await load();
      void navigate(`/evaluations/rubrics/${newId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate rubric.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchive(record: RubricRecord) {
    if (!repository) return;
    setBusyId(record.id);
    try {
      const fresh = await repository.getRubricRecord(record.id);
      if (!fresh) return;
      const willArchive = !fresh.archivedAt;
      await (willArchive
        ? repository.archiveRubric(record.id, fresh.revision)
        : repository.restoreRubric(record.id, fresh.revision));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rubric.");
    } finally {
      setBusyId(null);
    }
  }

  // --- States ---

  if (!repository) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
        <AlertCircle size={16} className="text-text-muted" aria-hidden="true" />
        <p className="text-sm text-text-secondary">Evaluation storage is unavailable.</p>
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading rubrics…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">Failed to load rubrics.</p>
        <p className="text-sm text-text-secondary">{error}</p>
        <button
          type="button"
          data-action="retry"
          onClick={() => void load()}
          className="mt-1 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-action="new-rubric"
        onClick={() => void createRubric()}
        className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-4 text-sm text-text transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus size={15} aria-hidden="true" />
        New rubric
      </button>
      <button
        type="button"
        data-action="toggle-archived"
        aria-pressed={showArchived}
        onClick={() => setShowArchived((v) => !v)}
        className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArchiveRestore size={15} aria-hidden="true" />
        Show archived
      </button>
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-2 overflow-x-hidden">
        {toolbar}
        <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
          <FolderOpen size={18} className="text-text-muted" aria-hidden="true" />
          <p className="text-sm text-text-secondary">No rubrics yet.</p>
          <p className="text-sm text-text-muted">
            Rubrics define how candidate work is assessed.
          </p>
          {/* Identity spec §5.4: teach the split from the rubric side. */}
          <p className="text-sm text-text-muted">
            <Link
              to="/evaluations"
              className="text-text-secondary underline decoration-edge-bright underline-offset-2 hover:text-text"
            >
              Suites
            </Link>{" "}
            pin rubrics to score their tasks.
          </p>
          <button
            type="button"
            data-action="create-rubric"
            onClick={() => void createRubric()}
            className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus size={15} aria-hidden="true" />
            Create rubric
          </button>
        </div>
      </div>
    );
  }

  // --- List ---

  return (
    <div className="flex min-w-0 flex-col gap-2 overflow-x-hidden">
      {toolbar}

      <ul className="flex min-w-0 flex-col gap-1.5" role="list">
        {rows.map(({ record, rubric }) => {
          const archived = record.archivedAt != null;
          const criteriaCount = rubric?.criteria.length ?? 0;
          // Identity spec §5.4: preview what the rubric actually measures —
          // first criterion name plus a count of the rest.
          const firstName = rubric?.criteria[0]?.name ?? "";
          const preview =
            criteriaCount === 0
              ? ""
              : criteriaCount === 1
                ? firstName
                : `${firstName} +${criteriaCount - 1} more`;
          const summary = `${criteriaCount} ${
            criteriaCount === 1 ? "criterion" : "criteria"
          }${preview ? ` · ${preview}` : ""}${archived ? " · Archived" : ""}`;
          const label = rubric?.name ?? record.id;
          return (
            <li key={record.id} className="min-w-0">
              <RecordRow
                variant="list"
                id={record.id}
                title={label}
                status={archived ? "aborted" : "reusable"}
                timestamp={record.updatedAt}
                kind={<KindEyebrow kind="profile" />}
                summary={summary}
                provenance={`v${record.latestVersion}`}
                href={`/evaluations/rubrics/${record.id}`}
              >
                <button
                  type="button"
                  data-action="duplicate"
                  aria-label={`Duplicate ${label}`}
                  disabled={busyId === record.id}
                  onClick={() => void duplicateRubric(record, rubric)}
                  className={ACTION_BTN}
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  data-action={archived ? "restore" : "archive"}
                  aria-label={archived ? `Restore ${label}` : `Archive ${label}`}
                  disabled={busyId === record.id}
                  onClick={() => void toggleArchive(record)}
                  className={ACTION_BTN}
                >
                  {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                </button>
              </RecordRow>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
