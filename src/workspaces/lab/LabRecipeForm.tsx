import { useMemo, useState } from "react";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import {
  FAMILY_ANALYSIS_MODE,
  FUSION_RECIPE_FAMILIES,
  type FusionRecipeFamily,
} from "../../lib/evaluations/fusion-study-types";
import {
  canonicalRecipePayload,
  recipeDigest,
  type LabRecipeVersion,
} from "../../lib/studies/lab-recipe-types";
import { generateLabId } from "./lab-draft";

interface LabRecipeFormProps {
  labAssetRepo: LabAssetRepository | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
  fromVersion?: LabRecipeVersion | null;
  expectedRevision?: number;
}

export function LabRecipeForm({
  labAssetRepo,
  open,
  onOpenChange,
  onCreated,
  fromVersion = null,
  expectedRevision,
}: LabRecipeFormProps) {
  const [name, setName] = useState(fromVersion ? "" : "");
  const [description, setDescription] = useState("");
  const [family, setFamily] = useState<FusionRecipeFamily>(fromVersion?.recipeFamily ?? "BlindRaw");
  const [promptVersion, setPromptVersion] = useState(fromVersion?.promptVersion ?? "blind-raw-v1");
  const [model, setModel] = useState(fromVersion?.synthesizer.model ?? "acme/synth-1");
  const [rubricAccess, setRubricAccess] = useState(fromVersion?.rubricAccess ?? false);
  const [verification, setVerification] = useState(fromVersion?.verification ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const judgeAnalysisMode = FAMILY_ANALYSIS_MODE[family];
  const isVersion = fromVersion != null;

  const content = useMemo(
    () => ({
      recipeFamily: family,
      promptVersion,
      judgeAnalysisMode,
      rubricAccess,
      verification,
      synthesizer: { providerId: "openrouter" as const, model },
    }),
    [family, judgeAnalysisMode, model, promptVersion, rubricAccess, verification],
  );

  async function submit() {
    if (!labAssetRepo) return;
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const payload = canonicalRecipePayload(content);
      const digest = recipeDigest(content);
      if (isVersion && fromVersion) {
        const nextVersion: LabRecipeVersion = {
          recipeId: fromVersion.recipeId,
          version: fromVersion.version + 1,
          kind: "fusion",
          ...content,
          canonicalPayload: payload,
          digest,
          createdAt: now,
        };
        await labAssetRepo.appendRecipeVersion(nextVersion, expectedRevision ?? 0);
        onCreated?.(fromVersion.recipeId);
      } else {
        if (name.trim().length === 0) {
          setError("Name is required.");
          setBusy(false);
          return;
        }
        const id = generateLabId("recipe");
        await labAssetRepo.createRecipeRecord(
          {
            id,
            kind: "fusion",
            name: name.trim(),
            description,
            latestVersion: 1,
            revision: 0,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          },
          {
            recipeId: id,
            version: 1,
            kind: "fusion",
            ...content,
            canonicalPayload: payload,
            digest,
            createdAt: now,
          },
        );
        onCreated?.(id);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recipe.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="rounded-lg border border-edge-bright bg-raised p-1">
      <form
        data-recipe-create-form=""
        className="flex flex-col gap-3 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-lg font-semibold text-text">
          {isVersion ? `Create version v${(fromVersion?.version ?? 0) + 1}` : "New Fusion Recipe"}
        </h2>
        {!isVersion && (
          <>
            <label className="flex flex-col gap-1 text-sm text-text">
              Name
              <input
                data-field="recipe-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text">
              Description
              <textarea
                data-field="recipe-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[88px] rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm text-text">
          Family
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value as FusionRecipeFamily)}
            className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {FUSION_RECIPE_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-text">
          Prompt version
          <input
            value={promptVersion}
            onChange={(e) => setPromptVersion(e.target.value)}
            className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text">
          Synthesizer model
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={rubricAccess}
            onChange={(e) => setRubricAccess(e.target.checked)}
          />
          Rubric access
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={verification}
            onChange={(e) => setVerification(e.target.checked)}
          />
          Verification instructions
        </label>
        {error && <p className="text-xs text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-action={isVersion ? "create-recipe-version" : "create-recipe"}
            disabled={busy || !labAssetRepo}
            className="flex min-h-[44px] items-center rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {isVersion ? `Create version v${(fromVersion?.version ?? 0) + 1}` : "Create recipe"}
          </button>
        </div>
      </form>
    </div>
  );
}
