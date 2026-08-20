import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ModelConfigurationSnapshot } from "../../lib/evidence/evidence-types";
import {
  createModelRollupVersion,
  type ModelRollupRecord,
  type ModelRollupVersion,
} from "../../lib/model-rollups/model-rollup-types";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type { ModelRollupRepository } from "../../lib/persistence/model-rollup-repository";
import { HeterogeneityTable, type RollupMemberIdentity } from "./HeterogeneityTable";
import { MemberShelf } from "./MemberShelf";
import { RollupBanner } from "./RollupBanner";

const DIMENSIONS = [
  "provider",
  "requested slug",
  "resolved version",
  "reasoning",
  "tools",
  "window",
] as const;

interface LoadedRollup {
  record: ModelRollupRecord | null;
  version: ModelRollupVersion | null;
  versions: ModelRollupVersion[];
  members: Array<{ id: string; configuration: ModelConfigurationSnapshot | null }>;
  configurations: ModelConfigurationSnapshot[];
}

export interface ModelRollupRouteProps {
  rollupRepo: ModelRollupRepository | null;
  evidenceRepo: EvidenceRepository | null;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function memberIdentity(
  id: string,
  configuration: ModelConfigurationSnapshot | null,
): RollupMemberIdentity {
  if (!configuration) {
    return {
      id,
      values: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, "not present"])),
    };
  }
  const reasoning = configuration.reasoningEffective ?? configuration.reasoningRequested ?? "none";
  return {
    id,
    values: {
      provider: configuration.providerId,
      "requested slug": configuration.requestedModel,
      "resolved version": configuration.resolvedVersion ?? "unknown",
      reasoning,
      tools: configuration.toolScaffoldSignature ?? "none",
      window: `${formatDate(configuration.observedFrom)}–${formatDate(configuration.observedTo)}`,
    },
  };
}

export function ModelRollupRoute({ rollupRepo, evidenceRepo }: ModelRollupRouteProps): ReactNode {
  const params = useParams<{ rollupId: string; version: string }>();
  const navigate = useNavigate();
  const rollupId = params.rollupId ?? "";
  const versionNumber = Number(params.version);
  const [loaded, setLoaded] = useState<LoadedRollup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!rollupRepo || !evidenceRepo || !Number.isInteger(versionNumber) || versionNumber < 1) {
      setLoaded({ record: null, version: null, versions: [], members: [], configurations: [] });
      return;
    }
    void Promise.all([
      rollupRepo.getModelRollupRecord(rollupId),
      rollupRepo.getModelRollupVersion(rollupId, versionNumber),
      rollupRepo.listModelRollupVersions(rollupId),
      evidenceRepo.listModelConfigurations(),
    ])
      .then(async ([record, version, versions, configurations]) => {
        const members = version
          ? await Promise.all(
              version.memberConfigurationIds.map(async (id) => ({
                id,
                configuration: await evidenceRepo.getModelConfiguration(id),
              })),
            )
          : [];
        if (!cancelled) {
          setLoaded({ record, version, versions, members, configurations });
          setName(version?.name ?? "");
          setSelectedMembers(version ? [...version.memberConfigurationIds] : []);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [rollupRepo, evidenceRepo, rollupId, versionNumber, reload]);

  const identities = useMemo(
    () => loaded?.members.map((member) => memberIdentity(member.id, member.configuration)) ?? [],
    [loaded?.members],
  );

  if (error) {
    return (
      <section
        data-rollup-state="error"
        className="rounded-md border border-danger p-4 text-sm text-danger"
      >
        {error}
      </section>
    );
  }
  if (!loaded) return <p className="text-sm text-text-muted">Loading saved rollup…</p>;
  if (!loaded.record) {
    return (
      <section data-rollup-state="unknown" className="rounded-md border border-edge bg-panel p-4">
        <h1 className="text-base font-semibold text-text">Rollup unknown</h1>
        <p className="mt-1 text-sm text-text-secondary">
          No saved rollup with this exact identity exists in this database.
        </p>
        <Link className="mt-3 inline-flex min-h-[44px] items-center text-accent" to="/models">
          Back to Models
        </Link>
      </section>
    );
  }
  if (!loaded.version) {
    return (
      <section
        data-rollup-state="unknown-version"
        className="rounded-md border border-edge bg-panel p-4"
      >
        <h1 className="text-base font-semibold text-text">Rollup version unknown</h1>
        <p className="mt-1 text-sm text-text-secondary">
          This saved rollup exists, but version {params.version} does not.
        </p>
        <Link
          className="mt-3 inline-flex min-h-[44px] items-center text-accent"
          to={`/models/rollups/${encodeURIComponent(rollupId)}/versions/${loaded.record.latestVersion}`}
        >
          Open latest version
        </Link>
      </section>
    );
  }

  const historical = loaded.version.version !== loaded.record.latestVersion;

  async function append(event: FormEvent) {
    event.preventDefault();
    if (!rollupRepo || !loaded?.record || selectedMembers.length === 0) return;
    const now = Date.now();
    const nextVersion = createModelRollupVersion({
      rollupId: loaded.record.id,
      version: loaded.record.latestVersion + 1,
      name: name.trim(),
      memberConfigurationIds: selectedMembers,
      aggregationPolicy: "stratified_only",
      createdAt: now,
    });
    await rollupRepo.appendModelRollupVersion(
      {
        ...loaded.record,
        name: nextVersion.name,
        latestVersion: nextVersion.version,
        updatedAt: now,
      },
      nextVersion,
      loaded.record.revision,
    );
    navigate(
      `/models/rollups/${encodeURIComponent(loaded.record.id)}/versions/${nextVersion.version}`,
    );
  }

  async function toggleArchive() {
    if (!rollupRepo || !loaded?.record) return;
    if (loaded.record.archivedAt === null) {
      await rollupRepo.archiveModelRollup(loaded.record.id, loaded.record.revision);
    } else {
      await rollupRepo.restoreModelRollup(loaded.record.id, loaded.record.revision);
    }
    setReload((value) => value + 1);
  }

  return (
    <article
      data-model-rollup-route
      data-rollup-state={
        loaded.record.archivedAt !== null ? "archived" : historical ? "historical" : "active"
      }
      className="flex flex-col gap-4"
    >
      <Link
        className="inline-flex min-h-[44px] items-center self-start text-sm text-accent"
        to="/models"
      >
        Models / Saved rollups
      </Link>
      <RollupBanner
        name={loaded.version.name}
        version={loaded.version.version}
        memberCount={loaded.version.memberConfigurationIds.length}
        pinnedDate={formatDate(loaded.version.createdAt)}
        manifestDigest={loaded.version.memberManifestDigest}
        archived={loaded.record.archivedAt !== null}
      />
      <nav aria-label="Rollup versions" className="flex flex-wrap gap-2">
        {loaded.versions.map((version) => (
          <Link
            key={version.version}
            aria-current={version.version === loaded.version!.version ? "page" : undefined}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-edge px-3 font-mono text-sm text-text"
            to={`/models/rollups/${encodeURIComponent(rollupId)}/versions/${version.version}`}
          >
            v{version.version}
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto scroll-thin">
        <HeterogeneityTable dimensions={DIMENSIONS} members={identities} />
      </div>
      <section
        aria-label="Rollup members"
        className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3"
      >
        {loaded.members.map(({ id, configuration }) => (
          <MemberShelf key={id} member={{ id, present: configuration !== null }}>
            {configuration ? (
              <div className="min-w-0">
                <p className="font-mono text-xs text-text-muted">EXACT CONFIGURATION</p>
                <h2 className="mt-1 break-all text-sm font-semibold text-text">
                  {configuration.requestedModel}
                </h2>
                <p className="mt-1 break-all font-mono text-xs text-text-secondary">{id}</p>
                <p className="mt-2 text-xs text-text-secondary">
                  {configuration.providerId} · {configuration.resolvedVersion ?? "version unknown"}
                </p>
                <Link
                  className="mt-2 inline-flex min-h-[44px] items-center text-sm text-accent"
                  to={`/models/${encodeURIComponent(id)}`}
                >
                  Open exact evidence profile
                </Link>
              </div>
            ) : null}
          </MemberShelf>
        ))}
      </section>
      {!historical ? (
        <section className="rounded-md border border-edge bg-panel p-4">
          <div className="flex flex-wrap gap-2">
            {loaded.record.archivedAt === null ? (
              <button
                type="button"
                className="pressable min-h-[44px] rounded-md border border-edge px-3 text-sm text-text"
                onClick={() => setEditOpen((open) => !open)}
              >
                Edit members or name
              </button>
            ) : null}
            <button
              type="button"
              className="pressable min-h-[44px] rounded-md border border-edge px-3 text-sm text-text"
              onClick={() => void toggleArchive()}
            >
              {loaded.record.archivedAt === null ? "Archive rollup" : "Restore rollup"}
            </button>
          </div>
          {editOpen ? (
            <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void append(event)}>
              <label className="text-sm text-text">
                Name
                <input
                  className="mt-1 min-h-[44px] w-full rounded-md border border-edge bg-card px-3 text-text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <fieldset>
                <legend className="text-sm text-text">Exact members</legend>
                {loaded.configurations.map((configuration) => (
                  <label
                    key={configuration.id}
                    className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(configuration.id)}
                      onChange={(event) =>
                        setSelectedMembers((members) =>
                          event.target.checked
                            ? [...members, configuration.id]
                            : members.filter((id) => id !== configuration.id),
                        )
                      }
                    />
                    {configuration.requestedModel}{" "}
                    <span className="font-mono text-xs">
                      {configuration.resolvedVersion ?? "unknown"}
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                className="pressable min-h-[44px] self-start rounded-md bg-accent px-4 text-sm font-medium text-bg"
                type="submit"
              >
                Create immutable version
              </button>
            </form>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
