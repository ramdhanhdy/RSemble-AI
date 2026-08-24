import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import { useLabAssetRepository } from "../../lib/persistence/repository-context";
import type { LabRecipeRecord, LabRecipeVersion } from "../../lib/studies/lab-recipe-types";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { LabRecipeForm } from "./LabRecipeForm";

interface LabRecipeVersionPageProps {
  labAssetRepo?: LabAssetRepository | null;
}

export function LabRecipeVersionPage({
  labAssetRepo: labAssetRepoProp,
}: LabRecipeVersionPageProps) {
  const ctx = useLabAssetRepository();
  const labAssetRepo = labAssetRepoProp !== undefined ? labAssetRepoProp : ctx;
  const { recipeId = "", version: versionRaw = "" } = useParams<{
    recipeId: string;
    version: string;
  }>();
  const versionNum = Number(versionRaw);
  const [record, setRecord] = useState<LabRecipeRecord | null>(null);
  const [version, setVersion] = useState<LabRecipeVersion | null>(null);
  const [versions, setVersions] = useState<LabRecipeVersion[]>([]);
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
      const rec = await labAssetRepo.getRecipeRecord(recipeId);
      const ver = Number.isInteger(versionNum)
        ? await labAssetRepo.getRecipeVersion(recipeId, versionNum)
        : null;
      const all = rec ? await labAssetRepo.listRecipeVersions(recipeId) : [];
      setRecord(rec);
      setVersion(ver);
      setVersions(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recipe.");
    } finally {
      setLoading(false);
    }
  }, [labAssetRepo, recipeId, versionNum]);

  useEffect(() => {
    void load();
  }, [load]);

  async function archive() {
    if (!labAssetRepo || !record) return;
    await labAssetRepo.archiveRecipeRecord(record.id, record.revision, Date.now());
    await load();
  }

  if (loading) {
    return (
      <div className="flex min-h-[140px] items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 size={16} className="animate-spin-ease text-accent" aria-hidden="true" />
        Loading recipe…
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
          Unknown recipe
        </p>
        <h1 className="text-lg font-semibold text-text">Recipe version not found</h1>
        <p className="text-sm text-text-secondary">
          No Fusion Recipe <span className="font-mono">{recipeId}</span> version{" "}
          <span className="font-mono">{versionRaw}</span> is stored.
        </p>
        {record && (
          <Link
            to={`/lab/recipes/${record.id}/versions/${record.latestVersion}`}
            className="text-sm text-text underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open latest version
          </Link>
        )}
        <Link
          to="/lab/recipes"
          className="flex min-h-[44px] items-center text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Back to Fusion Recipes
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="text-xs text-text-secondary">
        <Link
          to="/lab"
          className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Lab
        </Link>
        {" / "}
        <Link
          to="/lab/recipes"
          className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Fusion Recipes
        </Link>
        {" / "}
        {record.name}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <KindEyebrow kind="recipe" />
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
            data-action="new-recipe-version"
            onClick={() => setVersionOpen(true)}
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            New version from this
          </button>
          {record.archivedAt === null && (
            <button
              type="button"
              data-action="archive-recipe"
              onClick={() => void archive()}
              className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Archive record
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {versions.map((v) => (
          <Link
            key={v.version}
            to={`/lab/recipes/${record.id}/versions/${v.version}`}
            aria-current={v.version === version.version ? "page" : undefined}
            className={`flex min-h-[44px] items-center rounded-md border px-3 font-mono text-xs ${
              v.version === version.version
                ? "border-accent bg-accent/10 text-accent"
                : "border-edge bg-panel text-text"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            v{v.version}
          </Link>
        ))}
      </div>
      <dl className="grid gap-2 rounded-md border border-edge bg-panel p-3 text-sm">
        <div>
          <dt className="text-xs text-text-secondary">Family</dt>
          <dd className="font-mono text-text">{version.recipeFamily}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Prompt version</dt>
          <dd className="font-mono text-text">{version.promptVersion}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Judge analysis</dt>
          <dd className="text-text">{version.judgeAnalysisMode}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Rubric access</dt>
          <dd className="text-text">{version.rubricAccess ? "visible" : "hidden"}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-secondary">Synthesizer</dt>
          <dd className="font-mono text-text">{version.synthesizer.model}</dd>
        </div>
      </dl>
      <LabRecipeForm
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
