import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { useLabAssetRepository } from "../../lib/persistence/repository-context";
import type { ModelPoolRecord, ModelPoolVersion } from "../../lib/studies/model-pool-types";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { ModelPoolForm } from "./ModelPoolForm";

interface ModelPoolVersionPageProps {
  labAssetRepo?: LabAssetRepository | null;
}

export function ModelPoolVersionPage({ labAssetRepo: labAssetRepoProp }: ModelPoolVersionPageProps) {
  const ctx = useLabAssetRepository();
  const labAssetRepo = labAssetRepoProp !== undefined ? labAssetRepoProp : ctx;
  const { poolId = "", version: versionRaw = "" } = useParams<{
    poolId: string;
    version: string;
  }>();
  const versionNum = Number(versionRaw);
  const [record, setRecord] = useState<ModelPoolRecord | null>(null);
  const [version, setVersion] = useState<ModelPoolVersion | null>(null);
  const [versions, setVersions] = useState<ModelPoolVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);

  const load = useCallback(async () => {
    if (!labAssetRepo) {
      setError("Lab asset storage is unavailable.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rec = await labAssetRepo.getPoolRecord(poolId);
      const ver = Number.isInteger(versionNum)
        ? await labAssetRepo.getPoolVersion(poolId, versionNum)
        : null;
      const all = rec ? await labAssetRepo.listPoolVersions(poolId) : [];
      setRecord(rec);
      setVersion(ver);
      setVersions(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pool.");
    } finally {
      setLoading(false);
    }
  }, [labAssetRepo, poolId, versionNum]);

  useEffect(() => {
    void load();
  }, [load]);

  async function archive() {
    if (!labAssetRepo || !record) return;
    await labAssetRepo.archivePoolRecord(record.id, record.revision, Date.now());
    await load();
  }

  if (loading) {
    return (
      <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin-ease text-accent" aria-hidden="true" />
        Loading pool…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center">
        <AlertCircle className="text-error" size={18} aria-hidden="true" />
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }

  if (!record || !version) {
    return (
      <div className="flex flex-col gap-3 p-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Unknown pool
        </p>
        <h1 className="text-lg font-semibold text-text">Model pool version not found</h1>
        <p className="text-sm text-text-secondary">
          No Model Pool <span className="font-mono">{poolId}</span> version{" "}
          <span className="font-mono">{versionRaw}</span> is stored.
        </p>
        <Link
          to="/lab/model-pools"
          className="flex min-h-[44px] items-center text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to Model Pools
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-xs text-text-secondary">
        <Link to="/lab" className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          Lab
        </Link>
        {" / "}
        <Link
          to="/lab/model-pools"
          className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Model Pools
        </Link>
        {" / "}
        {record.name}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <KindEyebrow kind="pool" />
          <h1 className="mt-1 text-lg font-semibold text-text">
            {record.name}{" "}
            <span className="font-mono text-sm text-text-secondary">v{version.version}</span>
          </h1>
          <p className="font-mono text-xs text-text-muted">{version.digest}</p>
          {record.archivedAt !== null && (
            <p className="mt-1 text-xs text-text-secondary">Archived</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-action="new-pool-version"
            onClick={() => setVersionOpen(true)}
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            New version from this
          </button>
          {record.archivedAt === null && (
            <button
              type="button"
              data-action="archive-pool"
              onClick={() => void archive()}
              className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Archive record
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-text-secondary">
        A pool is a selection manifest. It never merges model evidence or implies comparability.
      </p>
      <div className="overflow-x-auto rounded-md border border-edge">
        <table className="w-full text-sm">
          <caption className="sr-only">Pool members</caption>
          <thead>
            <tr className="border-b border-edge text-left text-xs text-text-secondary">
              <th className="px-3 py-2">Configuration</th>
              <th className="px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {version.core.map((m) => (
              <tr key={`core-${m.id}`} className="border-b border-edge">
                <td className="px-3 py-2 font-mono text-text">{m.slug}</td>
                <td className="px-3 py-2 text-text">core</td>
              </tr>
            ))}
            {version.challengers.map((m) => (
              <tr key={`ch-${m.id}`}>
                <td className="px-3 py-2 font-mono text-text">{m.slug}</td>
                <td className="px-3 py-2 text-text">challenger</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LabRecipeLikeNav versions={versions} current={version.version} poolId={record.id} />
      <ModelPoolForm
        labAssetRepo={labAssetRepo}
        open={versionOpen}
        onOpenChange={setVersionOpen}
        fromVersion={version}
        expectedRevision={record.revision}
        onCreated={() => {
          setVersionOpen(false);
          void load();
        }}
      />
    </div>
  );
}

function LabRecipeLikeNav({
  versions,
  current,
  poolId,
}: {
  versions: ModelPoolVersion[];
  current: number;
  poolId: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {versions.map((v) => (
        <Link
          key={v.version}
          to={`/lab/model-pools/${poolId}/versions/${v.version}`}
          aria-current={v.version === current ? "page" : undefined}
          className={`flex min-h-[44px] items-center rounded-md border px-3 font-mono text-xs ${
            v.version === current
              ? "border-accent bg-accent/10 text-accent"
              : "border-edge bg-panel text-text"
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
        >
          v{v.version}
        </Link>
      ))}
    </div>
  );
}
