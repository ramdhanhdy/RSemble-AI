// =============================================================================
// ProfileList — latest profile revisions with archived filtering (spec §5.1).
//
// Lists each ProfileRecord's latest revision: name, version, criterion count,
// updated timestamp, archived state. Primary action: New profile. Row overflow:
// Duplicate, Archive/Restore. Archived filter toggle. Rows render as links to
// /evaluations/profiles/:profileId via RecordRow.
//
// Reads the EvaluationRepository from EvaluationContext (no props) so the
// EvaluationsWorkspace provider can inject the repo once for all routes.
// A `repo` prop is accepted for testability and route wrappers that pass it
// explicitly; it takes precedence over context.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  EvaluationProfile,
  ProfileRecord,
} from "../../lib/evaluations/evaluation-types";
import { useEvaluationRepository } from "../../lib/persistence/evaluation-context";
import { RecordRow } from "../../ui/RecordRow";

interface ProfileRow {
  record: ProfileRecord;
  profile: EvaluationProfile | null;
}

function genId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeDefaultCriterion(): EvaluationCriterion {
  return {
    id: "c-1",
    name: "",
    description: "",
    weight: 1,
    anchors: { one: "", three: "", five: "" },
  };
}

const ACTION_BTN =
  "flex h-11 w-11 items-center justify-center text-text-secondary transition-colors hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-30";

export function ProfileList({ repo }: { repo?: EvaluationRepository | null }) {
  const repository = repo ?? useEvaluationRepository();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ProfileRow[]>([]);
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
      const records = await repository.listProfiles(showArchived);
      const profiles = await Promise.all(
        records.map((r) => repository.getProfile(r.id, r.latestVersion)),
      );
      setRows(
        records.map((record, i) => ({ record, profile: profiles[i] ?? null })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profiles.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [repository, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createProfile() {
    if (!repository) return;
    const id = genId();
    const now = Date.now();
    const record: ProfileRecord = {
      id,
      revision: 1,
      latestVersion: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const profile: EvaluationProfile = {
      id,
      version: 1,
      name: "Untitled profile",
      description: "",
      judgeInstruction: "",
      criteria: [makeDefaultCriterion()],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await repository.createProfile(record, profile);
      await load();
      navigate(`/evaluations/profiles/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create profile.");
    }
  }

  async function duplicateProfile(
    record: ProfileRecord,
    profile: EvaluationProfile | null,
  ) {
    if (!repository || !profile) return;
    setBusyId(record.id);
    try {
      const newId = genId();
      const now = Date.now();
      const newRecord: ProfileRecord = {
        id: newId,
        revision: 1,
        latestVersion: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      const newProfile: EvaluationProfile = {
        ...profile,
        id: newId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repository.createProfile(newRecord, newProfile);
      await load();
      navigate(`/evaluations/profiles/${newId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate profile.");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchive(record: ProfileRecord) {
    if (!repository) return;
    setBusyId(record.id);
    try {
      const fresh = await repository.getProfileRecord(record.id);
      if (!fresh) return;
      const willArchive = !fresh.archivedAt;
      await repository.setProfileArchived(
        record.id,
        willArchive,
        fresh.revision,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update profile.");
    } finally {
      setBusyId(null);
    }
  }

  // --- States ---

  if (!repository) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
        <AlertCircle size={16} className="text-text-muted" aria-hidden="true" />
        <p className="text-sm text-text-secondary">
          Evaluation storage is unavailable.
        </p>
      </div>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading profiles…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">Failed to load profiles.</p>
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
        data-action="new-profile"
        onClick={() => void createProfile()}
        className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-4 text-sm text-text transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Plus size={15} aria-hidden="true" />
        New profile
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
          <p className="text-sm text-text-secondary">No profiles yet.</p>
          <p className="text-sm text-text-muted">
            Create an evaluation profile to define scoring criteria.
          </p>
          <button
            type="button"
            data-action="create-profile"
            onClick={() => void createProfile()}
            className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Plus size={15} aria-hidden="true" />
            Create profile
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
        {rows.map(({ record, profile }) => {
          const archived = record.archivedAt != null;
          const criteriaCount = profile?.criteria.length ?? 0;
          const summary = `${criteriaCount} ${
            criteriaCount === 1 ? "criterion" : "criteria"
          }${archived ? " · Archived" : ""}`;
          const label = profile?.name ?? record.id;
          return (
            <li key={record.id} className="min-w-0">
              <RecordRow
                variant="list"
                id={record.id}
                title={label}
                status={archived ? "draft" : "completed"}
                timestamp={record.updatedAt}
                summary={summary}
                provenance={`v${record.latestVersion}`}
                href={`/evaluations/profiles/${record.id}`}
              >
                <button
                  type="button"
                  data-action="duplicate"
                  aria-label={`Duplicate ${label}`}
                  disabled={busyId === record.id}
                  onClick={() => void duplicateProfile(record, profile)}
                  className={ACTION_BTN}
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  data-action={archived ? "restore" : "archive"}
                  aria-label={
                    archived ? `Restore ${label}` : `Archive ${label}`
                  }
                  disabled={busyId === record.id}
                  onClick={() => void toggleArchive(record)}
                  className={ACTION_BTN}
                >
                  {archived ? (
                    <ArchiveRestore size={14} />
                  ) : (
                    <Archive size={14} />
                  )}
                </button>
              </RecordRow>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
