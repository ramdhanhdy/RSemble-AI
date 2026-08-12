// =============================================================================
// RubricDetail — view/edit a rubric across its version history (spec §5.1, §6.2).
//
// Shows name, version, description, judge instruction, and the criteria editor.
// Latest version is editable (Save commits a new immutable version). Non-latest
// versions are read-only with a banner and "Edit as new version". Duplicate
// creates a new rubric identity. Archive/Restore toggles the record. Lists
// suites pinned to the viewed version.
//
// Accepts a `repo` prop (testability + route wrappers) that takes precedence
// over the EvaluationRepository read from EvaluationContext. `rubricId`
// identifies the rubric record to load.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Archive,
  ArchiveRestore,
  Loader2,
  AlertCircle,
  Save,
  GitBranch,
  Pin,
} from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { EvaluationRubric, RubricRecord } from "../../lib/evaluations/evaluation-types";
import { suitesUsingProfile, type ProfileUsage } from "../../lib/evaluations/profile-usage";
import { validateRubric } from "../../lib/evaluations/evaluation-rubric";
import { useEvaluationRepository } from "../../lib/persistence/evaluation-context";
import { EvaluationProfileEditor } from "../../ui/EvaluationProfileEditor";
import { RecordRow } from "../../ui/RecordRow";
import { KindEyebrow } from "../../ui/KindEyebrow";

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function RubricDetail({
  repo,
  rubricId,
  version,
}: {
  repo?: EvaluationRepository | null;
  rubricId: string;
  /** Optional initial/version rubric version to load, driven by the
   *  canonical /evaluations/rubrics/:rubricId/versions/:version route
   *  (rubric-terminology spec §4). When omitted, the latest version loads.
   *  A change to this prop (URL navigation) reloads the requested version. */
  version?: number;
}) {
  // Hook order must be stable: read the context unconditionally, then
  // prefer the injected repository when one is provided.
  const contextRepository = useEvaluationRepository();
  const repository = repo ?? contextRepository;
  const navigate = useNavigate();
  const [record, setRecord] = useState<RubricRecord | null>(null);
  const [selectedVersion, setSelectedVersion] = useState(0);
  const [viewed, setViewed] = useState<EvaluationRubric | null>(null);
  const [draft, setDraft] = useState<EvaluationRubric | null>(null);
  const [usage, setUsage] = useState<ProfileUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (version: number | "latest") => {
      if (!repository || !rubricId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const rec = await repository.getRubricRecord(rubricId);
        if (!rec) {
          setRecord(null);
          setViewed(null);
          setDraft(null);
          setUsage([]);
          return;
        }
        setRecord(rec);
        const v = version === "latest" ? rec.latestVersion : version;
        setSelectedVersion(v);
        const rub = await repository.getRubricVersion(rubricId, v);
        setViewed(rub);
        setDraft(v === rec.latestVersion && rub ? rub : null);
        const suites = await repository.listSuites(true);
        // Shared tested derivation (identity spec §5.3). Rendering splits the
        // result into suites pinned at the selected version and suites still
        // pinned at other versions.
        setUsage(suitesUsingProfile(suites, rubricId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load rubric.");
      } finally {
        setLoading(false);
      }
    },
    [repository, rubricId],
  );

  useEffect(() => {
    void load(version ?? "latest");
  }, [load, version]);

  const isLatest =
    record != null && selectedVersion === record.latestVersion && selectedVersion > 0;
  const current: EvaluationRubric | null = isLatest ? draft : viewed;

  const handleEditorChange = useCallback(
    (p: EvaluationRubric) => {
      if (isLatest) setDraft(p);
    },
    [isLatest],
  );

  function updateDraft(patch: Partial<EvaluationRubric>) {
    setDraft((d) => (d ? { ...d, ...patch, updatedAt: Date.now() } : d));
  }

  async function save() {
    if (!repository || !draft) return;
    // Authoring-boundary validation: actionable errors for gate rejection,
    // ungrouped binary checks, invalid groups, and out-of-range lambda.
    const validationErrors = validateRubric(draft);
    if (validationErrors.length > 0) {
      setError(validationErrors.join(" "));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fresh = await repository.getRubricRecord(rubricId);
      if (!fresh) {
        setError("Rubric not found.");
        return;
      }
      await repository.appendRubricVersion(fresh, draft, fresh.revision);
      await load("latest");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save rubric.");
    } finally {
      setSaving(false);
    }
  }

  async function editAsNewVersion() {
    if (!repository || !viewed) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await repository.getRubricRecord(rubricId);
      if (!fresh) {
        setError("Rubric not found.");
        return;
      }
      await repository.appendRubricVersion(fresh, { ...viewed }, fresh.revision);
      await load("latest");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create version.");
    } finally {
      setBusy(false);
    }
  }

  async function duplicateRubric() {
    if (!repository || !viewed) return;
    setBusy(true);
    setError(null);
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
        ...viewed,
        id: newId,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await repository.createRubric(newRecord, newRubric);
      void navigate(`/evaluations/rubrics/${newId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to duplicate rubric.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!repository || !record) return;
    setBusy(true);
    setError(null);
    try {
      const fresh = await repository.getRubricRecord(rubricId);
      if (!fresh) {
        setError("Rubric not found.");
        return;
      }
      const willArchive = !fresh.archivedAt;
      await (willArchive
        ? repository.archiveRubric(rubricId, fresh.revision)
        : repository.restoreRubric(rubricId, fresh.revision));
      await load(selectedVersion > 0 ? selectedVersion : "latest");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rubric.");
    } finally {
      setBusy(false);
    }
  }

  // Split the usage derivation by the viewed version: suites pinned at the
  // selected version render as backlink rows; suites pinned only at other
  // versions render as a one-line advisory (identity spec §5.3).
  // NOTE: hooks must stay above the early returns below — same hook count on
  // every render.
  const pinnedAtSelected = useMemo(
    () => usage.filter((u) => u.versions.includes(selectedVersion)),
    [usage, selectedVersion],
  );
  const pinnedElsewhere = useMemo(
    () => usage.filter((u) => !u.versions.includes(selectedVersion)),
    [usage, selectedVersion],
  );

  // --- States ---

  if (!repository) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center">
        <AlertCircle size={16} className="text-text-muted" aria-hidden="true" />
        <p className="text-sm text-text-secondary">Evaluation storage is unavailable.</p>
      </div>
    );
  }

  if (loading && !record) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading rubric…</span>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-text-secondary">Rubric not found.</p>
        <Link
          to="/evaluations/rubrics"
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to rubrics
        </Link>
      </div>
    );
  }

  const archived = record.archivedAt != null;
  const versions =
    record.latestVersion > 0 ? Array.from({ length: record.latestVersion }, (_, i) => i + 1) : [1];

  return (
    <div
      data-rubric-detail=""
      className="flex min-w-0 flex-col gap-3 overflow-x-hidden p-3 text-sm"
    >
      <Link
        to="/evaluations/rubrics"
        className="flex min-h-[44px] w-fit items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Rubrics
      </Link>

      {/* Sticky action bar — stays visible above the soft keyboard */}
      <div className="sticky top-0 z-20 -mx-3 flex flex-wrap items-center gap-2 border-b border-edge bg-panel px-3 py-2">
        {isLatest ? (
          <button
            type="button"
            data-action="save"
            disabled={saving || !draft}
            onClick={() => void save()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-4 text-sm text-text transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <Save size={14} aria-hidden="true" />
            {saving ? "Saving…" : "Save"}
          </button>
        ) : (
          <button
            type="button"
            data-action="edit-as-new-version"
            disabled={busy}
            onClick={() => void editAsNewVersion()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-4 text-sm text-text transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <GitBranch size={14} aria-hidden="true" />
            Edit as new version
          </button>
        )}
        <button
          type="button"
          data-action="duplicate"
          disabled={busy}
          onClick={() => void duplicateRubric()}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          <Copy size={14} aria-hidden="true" />
          Duplicate
        </button>
        <button
          type="button"
          data-action={archived ? "restore" : "archive"}
          disabled={busy}
          onClick={() => void toggleArchive()}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          {archived ? (
            <ArchiveRestore size={14} aria-hidden="true" />
          ) : (
            <Archive size={14} aria-hidden="true" />
          )}
          {archived ? "Restore" : "Archive"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error/[0.06] px-3 py-2 text-sm text-error">
          <AlertCircle size={14} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Version selector */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor="rubric-version"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
        >
          Version
        </label>
        <select
          id="rubric-version"
          data-action="version-selector"
          value={selectedVersion}
          onChange={(e) => void load(Number(e.target.value))}
          className="min-h-[44px] rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {versions.map((v) => (
            <option key={v} value={v}>
              v{v}
              {v === record.latestVersion ? " (latest)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Read-only banner for non-latest versions */}
      {!isLatest && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/[0.08] px-3 py-2 text-sm">
          <span className="text-text-secondary">
            v{selectedVersion} · latest v{record.latestVersion} · read-only
          </span>
          <button
            type="button"
            data-action="edit-as-new-version"
            disabled={busy}
            onClick={() => void editAsNewVersion()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 text-sm text-text transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
          >
            <GitBranch size={14} aria-hidden="true" />
            Edit as new version
          </button>
        </div>
      )}

      {archived && (
        <div className="rounded-md border border-edge bg-card-hover px-3 py-2 text-sm text-text-secondary">
          This rubric is archived. Restore it to use in new suites.
        </div>
      )}

      {/* Rubric fields */}
      {current && (
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <label
              htmlFor="rubric-name"
              className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
            >
              Name
            </label>
            <input
              id="rubric-name"
              type="text"
              value={current.name}
              readOnly={!isLatest}
              onChange={(e) => updateDraft({ name: e.target.value })}
              className="mt-1 min-h-[44px] w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <div>
            <label
              htmlFor="rubric-description"
              className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
            >
              Description
            </label>
            <textarea
              id="rubric-description"
              rows={2}
              value={current.description}
              readOnly={!isLatest}
              onChange={(e) => updateDraft({ description: e.target.value })}
              className="mt-1 min-h-[44px] w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <div>
            <label
              htmlFor="rubric-judge"
              className="block font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
            >
              Judge instruction
            </label>
            <textarea
              id="rubric-judge"
              rows={3}
              value={current.judgeInstruction}
              readOnly={!isLatest}
              onChange={(e) => updateDraft({ judgeInstruction: e.target.value })}
              className="mt-1 min-h-[44px] w-full rounded-sm border border-edge bg-card px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <EvaluationProfileEditor
            profile={current}
            onChange={handleEditorChange}
            readOnly={!isLatest}
          />
        </div>
      )}

      {/* Suites pinned to this version (identity spec §5.3) */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          <Pin size={12} aria-hidden="true" />
          Suites pinned to v{selectedVersion}
        </div>
        {pinnedAtSelected.length === 0 ? (
          <p className="text-sm text-text-muted">
            No suite pins this rubric at this version.{" "}
            <Link
              to="/evaluations"
              className="text-text-secondary underline decoration-edge-bright underline-offset-2 hover:text-text"
            >
              Browse suites
            </Link>
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1.5" role="list">
            {pinnedAtSelected.map(({ suite }) => (
              <li key={suite.id} className="min-w-0">
                <RecordRow
                  variant="list"
                  id={suite.id}
                  title={suite.name}
                  status={suite.archivedAt != null ? "aborted" : "ready"}
                  timestamp={suite.updatedAt}
                  kind={<KindEyebrow kind="suite" />}
                  summary={`v${suite.version} · ${suite.tasks.length} tasks`}
                  href={`/evaluations/${suite.id}`}
                />
              </li>
            ))}
          </ul>
        )}
        {/* Suites still pinned at other versions — a user viewing v2 must see
            that a suite still pins v1 (identity spec §5.3). */}
        {pinnedElsewhere.length > 0 && (
          <p className="text-sm text-text-muted">
            Also pinned at other versions by:{" "}
            {pinnedElsewhere.map(({ suite, versions }, i) => (
              <span key={suite.id}>
                {i > 0 && ", "}
                <Link
                  to={`/evaluations/${suite.id}`}
                  className="text-text-secondary underline decoration-edge-bright underline-offset-2 hover:text-text"
                >
                  {suite.name}
                </Link>{" "}
                (v{versions.filter((v) => v !== selectedVersion).join(", v")})
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
