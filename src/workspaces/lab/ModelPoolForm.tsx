import { useState } from "react";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import {
  canonicalPoolPayload,
  poolDigest,
  type ModelPoolVersion,
} from "../../lib/studies/model-pool-types";
import type { ModelSlot } from "../../studio-data";
import { generateLabId } from "./lab-draft";

const DEFAULT_CORE: ModelSlot[] = [
  {
    id: "core-1",
    providerId: "openrouter",
    provider: "OpenRouter",
    model: "openai/gpt-4o-mini",
    slug: "openai/gpt-4o-mini",
    enabled: true,
  },
];

interface ModelPoolFormProps {
  labAssetRepo: LabAssetRepository | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
  fromVersion?: ModelPoolVersion | null;
  expectedRevision?: number;
}

export function ModelPoolForm({
  labAssetRepo,
  open,
  onOpenChange,
  onCreated,
  fromVersion = null,
  expectedRevision,
}: ModelPoolFormProps) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [rationale, setRationale] = useState(fromVersion?.rationale ?? "Initial experimental selection.");
  const [checklist, setChecklist] = useState(
    (fromVersion?.diversityChecklist ?? ["independent families"]).join(", "),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isVersion = fromVersion != null;

  async function submit() {
    if (!labAssetRepo) return;
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const diversityChecklist = checklist
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const content = {
        core: fromVersion?.core ?? DEFAULT_CORE,
        challengers: fromVersion?.challengers ?? [],
        diversityChecklist:
          diversityChecklist.length > 0 ? diversityChecklist : ["independent families"],
        rationale: rationale.trim() || purpose.trim() || "Initial experimental selection.",
        supersedesVersion: fromVersion ? fromVersion.version : null,
      };
      const canonicalPayload = canonicalPoolPayload(content);
      const digest = poolDigest(content);
      if (isVersion && fromVersion) {
        await labAssetRepo.appendPoolVersion(
          {
            poolId: fromVersion.poolId,
            version: fromVersion.version + 1,
            ...content,
            canonicalPayload,
            digest,
            createdAt: now,
          },
          expectedRevision ?? 0,
        );
        onCreated?.(fromVersion.poolId);
      } else {
        if (name.trim().length === 0) {
          setError("Name is required.");
          setBusy(false);
          return;
        }
        if (purpose.trim().length === 0) {
          setError("Purpose is required.");
          setBusy(false);
          return;
        }
        const id = generateLabId("pool");
        await labAssetRepo.createPoolRecord(
          {
            id,
            name: name.trim(),
            purpose: purpose.trim(),
            latestVersion: 1,
            revision: 0,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          },
          {
            poolId: id,
            version: 1,
            ...content,
            canonicalPayload,
            digest,
            createdAt: now,
          },
        );
        onCreated?.(id);
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save pool.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <div className="rounded-lg border border-edge-bright bg-raised p-1">
      <form
        className="flex flex-col gap-3 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-lg font-semibold text-text">
          {isVersion ? `Create version v${(fromVersion?.version ?? 0) + 1}` : "New Model Pool"}
        </h2>
        {!isVersion && (
          <>
            <label className="flex flex-col gap-1 text-sm text-text">
              Name
              <input
                data-field="pool-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-text">
              Purpose
              <textarea
                data-field="pool-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="min-h-[88px] rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm text-text">
          Rationale
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="min-h-[88px] rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-text">
          Diversity checklist
          <input
            value={checklist}
            onChange={(e) => setChecklist(e.target.value)}
            className="min-h-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <p className="text-xs text-text-secondary">
          A pool is a selection manifest. It never merges model evidence or implies comparability.
        </p>
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
            data-action={isVersion ? "create-pool-version" : "create-pool"}
            disabled={busy || !labAssetRepo}
            className="flex min-h-[44px] items-center rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {isVersion ? `Create version v${(fromVersion?.version ?? 0) + 1}` : "Create pool"}
          </button>
        </div>
      </form>
    </div>
  );
}
