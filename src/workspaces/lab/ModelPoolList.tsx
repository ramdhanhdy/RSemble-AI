import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Boxes, Loader2, Plus, RotateCcw } from "lucide-react";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import {
  useLabAssetRepository,
  useStudyRepository,
} from "../../lib/persistence/repository-context";
import type { ModelPoolRecord, ModelPoolVersion } from "../../lib/studies/model-pool-types";
import { RecordRow } from "../../ui/RecordRow";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { ModelPoolForm } from "./ModelPoolForm";

interface ModelPoolListProps {
  labAssetRepo?: LabAssetRepository | null;
  studyRepo?: StudyRepository | null;
}

interface PoolRow {
  record: ModelPoolRecord;
  version: ModelPoolVersion | null;
  referencedBy: number;
}

function poolSummary(version: ModelPoolVersion | null): string {
  if (!version) return "No versions";
  const core = version.core.length;
  const challengers = version.challengers.length;
  return `v${version.version} · ${core} core · ${challengers} challenger${challengers === 1 ? "" : "s"} configurations`;
}

export function ModelPoolList({
  labAssetRepo: labAssetRepoProp,
  studyRepo: studyRepoProp,
}: ModelPoolListProps) {
  const ctxAssets = useLabAssetRepository();
  const ctxStudies = useStudyRepository();
  const labAssetRepo = labAssetRepoProp !== undefined ? labAssetRepoProp : ctxAssets;
  const studyRepo = studyRepoProp !== undefined ? studyRepoProp : ctxStudies;
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    if (!labAssetRepo) {
      setError("Lab asset storage is unavailable.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const records = await labAssetRepo.listPoolRecords(true);
      const studies = studyRepo ? await studyRepo.listStudies(true) : [];
      const next: PoolRow[] = [];
      for (const record of records) {
        const version = await labAssetRepo.getLatestPoolVersion(record.id);
        const referencedBy = studies.filter((s) => s.definition.modelPool.poolId === record.id)
          .length;
        next.push({ record, version, referencedBy });
      }
      next.sort((a, b) => b.record.updatedAt - a.record.updatedAt);
      setRows(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model pools.");
    } finally {
      setLoading(false);
    }
  }, [labAssetRepo, studyRepo]);

  useEffect(() => {
    void load();
  }, [load]);

  const archivedCount = rows.filter((r) => r.record.archivedAt !== null).length;
  const visible = useMemo(
    () => (includeArchived ? rows : rows.filter((r) => r.record.archivedAt === null)),
    [includeArchived, rows],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            RESEARCH LAB
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <h1 tabIndex={-1} className="text-lg font-semibold text-text">
              Model Pools
            </h1>
            <span className="font-mono text-xs text-text-muted tabular-nums">
              {visible.length} {visible.length === 1 ? "pool" : "pools"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            A pool is an experimental selection manifest of exact model configurations. Pools never
            merge model evidence or act as a synthetic respondent.
          </p>
        </div>
        <button
          type="button"
          data-action="new-model-pool"
          onClick={() => setCreateOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Plus size={14} aria-hidden="true" />
          New Model Pool
        </button>
      </div>

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
          Loading pools…
        </div>
      )}

      {error && (
        <div
          data-state="error"
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center"
        >
          <AlertCircle size={18} className="text-error" aria-hidden="true" />
          <p className="text-sm font-medium text-error">Failed to load model pools.</p>
          <p className="text-xs text-text-secondary">{error}</p>
          <button
            type="button"
            data-action="retry-pools"
            onClick={() => void load()}
            className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div
          data-state="empty"
          className="mx-auto flex max-w-[28rem] flex-col items-center gap-3 py-10 text-center"
        >
          <Boxes size={28} className="text-text-muted" aria-hidden="true" />
          <h2 className="text-sm font-medium text-text">No model pools yet</h2>
          <p className="text-xs text-text-secondary">
            A pool is a selection manifest. It never merges model evidence or implies comparability.
          </p>
        </div>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="flex flex-col gap-1.5" role="list">
          {visible.map(({ record, version, referencedBy }) => {
            const archived = record.archivedAt !== null;
            const digest = version?.digest.slice(0, 9) ?? "";
            return (
              <li key={record.id} className={archived ? "opacity-60" : undefined}>
                <RecordRow
                  variant="list"
                  id={record.id}
                  title={record.name}
                  status={archived ? "paused" : "reusable"}
                  timestamp={record.updatedAt}
                  kind={<KindEyebrow kind="pool" />}
                  summary={poolSummary(version)}
                  provenance={`latest v${record.latestVersion} · referenced by ${referencedBy} ${referencedBy === 1 ? "study" : "studies"} · digest ${digest}…`}
                  href={`/lab/model-pools/${record.id}/versions/${record.latestVersion}`}
                >
                  {archived ? <span className="text-xs text-text-secondary">Archived</span> : null}
                </RecordRow>
              </li>
            );
          })}
        </ul>
      )}

      <ModelPoolForm
        labAssetRepo={labAssetRepo}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void load();
        }}
      />
    </div>
  );
}
