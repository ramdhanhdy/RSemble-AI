// =============================================================================
// SuiteList — the evaluation-suite index (spec §10.1).
//
// Lists saved suites with name, version, task count, model count, and latest
// experiment status. Rows route to /evaluations/:suiteId via RecordRow. Empty
// state explains what a suite is and offers Create. Duplicate creates a distinct
// draft. Archive requires confirmation and removes from the default list; an
// archived filter restores discoverability. A storage error never claims a
// suite was saved.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Copy, Loader2, Upload, Plus, Archive } from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type {
  EvaluationProfile,
  EvaluationSuite,
  ExperimentRecord,
} from "../../lib/evaluations/evaluation-types";
import { RecordRow, formatRelativeTime } from "../../ui/RecordRow";
import { StatusMark } from "../../ui/StatusMark";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { RubricRefChip } from "../../ui/RubricRefChip";
import { StorageError } from "../../lib/persistence/database";
import { DEFAULT_CRITIC_REF } from "../../studio-data";
import {
  normalizeSuitePackage,
  parseSuitePackage,
  validateSuitePackageBytes,
} from "../../lib/evaluations/suite-package";

interface SuiteListProps {
  repo: EvaluationRepository | null;
}

interface SuiteListState {
  suites: EvaluationSuite[];
  loading: boolean;
  error: string | null;
  /** Pinned profile resolved per "profileId@version" (identity spec §5.3). */
  profiles: Map<string, EvaluationProfile>;
  /** Latest experiment per suite id, by updatedAt (identity spec §5.4). */
  latestExperiment: Map<string, ExperimentRecord>;
}

/** Generate a stable random ID for new suites and tasks. */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankSuite(): EvaluationSuite {
  const now = Date.now();
  // The persisted-record guard requires ≥1 valid task and ≥2 enabled, unique
  // model slots — a blank draft must seed a runnable starting point or the
  // repository rejects it as a validation failure.
  return {
    id: generateId("suite"),
    revision: 0,
    version: 1,
    name: "Untitled suite",
    description: "",
    tasks: [
      {
        id: generateId("task"),
        title: "Task 1",
        prompt: "Describe the task you want the candidate models to answer.",
        systemPrompt: "",
        evaluation: { kind: "inherit" },
        judgeInstructionOverride: "",
        order: 0,
      },
    ],
    modelSlots: [
      {
        id: generateId("slot"),
        providerId: "openrouter",
        provider: "Z-AI",
        model: "GLM 5.2",
        slug: "z-ai/glm-5.2",
        enabled: true,
      },
      {
        id: generateId("slot"),
        providerId: "openrouter",
        provider: "DeepSeek",
        model: "DeepSeek V4 Flash",
        slug: "deepseek/deepseek-v4-flash",
        enabled: true,
      },
    ],
    defaultJudge: { ...DEFAULT_CRITIC_REF },
    defaultEvaluation: { kind: "holistic" },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

export function SuiteList({ repo }: SuiteListProps) {
  const [state, setState] = useState<SuiteListState>({
    suites: [],
    loading: true,
    error: null,
    profiles: new Map(),
    latestExperiment: new Map(),
  });
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!repo) {
      setState({
        suites: [],
        loading: false,
        error: "Storage not available.",
        profiles: new Map(),
        latestExperiment: new Map(),
      });
      return;
    }
    const id = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      // Always load every suite (archived included) so the archived-filter
      // toggle can restore discoverability without an extra round-trip.
      // Experiments ride along for the latest-run mark on each row.
      const [suites, experiments] = await Promise.all([
        repo.listSuites(true),
        repo.listExperiments(),
      ]);
      // Resolve only the profiles actually pinned by suite default
      // evaluations — one lookup per distinct (id, version) pair.
      const pairKeys = new Set<string>();
      for (const s of suites) {
        if (s.defaultEvaluation.kind === "profile") {
          const ref = s.defaultEvaluation.profile;
          pairKeys.add(`${ref.id}@${ref.version}`);
        }
      }
      const resolvedPairs = await Promise.all(
        [...pairKeys].map(async (key) => {
          const sep = key.lastIndexOf("@");
          const pid = key.slice(0, sep);
          const version = Number(key.slice(sep + 1));
          const profile = await repo.getProfile(pid, version).catch(() => null);
          return [key, profile ?? null] as const;
        }),
      );
      const profiles = new Map<string, EvaluationProfile>();
      for (const [key, profile] of resolvedPairs) {
        if (profile) profiles.set(key, profile);
      }
      const latestExperiment = new Map<string, ExperimentRecord>();
      // Mock/test repos may return undefined for listExperiments — tolerate it.
      for (const e of experiments ?? []) {
        const prev = latestExperiment.get(e.suiteId);
        if (!prev || e.updatedAt > prev.updatedAt) latestExperiment.set(e.suiteId, e);
      }
      if (id === requestIdRef.current) {
        setState({ suites, loading: false, error: null, profiles, latestExperiment });
      }
    } catch (err: unknown) {
      if (id === requestIdRef.current) {
        setState({
          suites: [],
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load suites.",
          profiles: new Map(),
          latestExperiment: new Map(),
        });
      }
    }
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!repo || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const draft = blankSuite();
      await repo.saveSuite(draft, 0);
      // Reload to surface the persisted row, then navigate to the new suite.
      await load();
      window.location.hash = `#/evaluations/${draft.id}`;
    } catch (err: unknown) {
      // Storage error never claims a suite was saved.
      const msg =
        err instanceof StorageError
          ? friendlyStorageError(err)
          : err instanceof Error
            ? err.message
            : "Could not save the suite.";
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  }

  /** Import a suite package (content authoring) — always creates a NEW suite. */
  async function handleImportFile(file: File) {
    if (!repo || importing) return;
    setImporting(true);
    setImportErrors([]);
    setImportNotes([]);
    try {
      const sizeError = validateSuitePackageBytes(file.size);
      if (sizeError) {
        setImportErrors([sizeError]);
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setImportErrors(["The file is not valid JSON — nothing was imported."]);
        return;
      }
      const check = parseSuitePackage(parsed);
      if (!check.ok) {
        setImportErrors(check.errors);
        return;
      }
      const [suites, profiles] = await Promise.all([
        repo.listSuites(true),
        repo.listProfiles(true),
      ]);
      const takenIds = new Set<string>([...suites.map((s) => s.id), ...profiles.map((p) => p.id)]);
      const normalized = normalizeSuitePackage(check.pkg, {
        takenIds,
        existingProfileIds: new Set(profiles.map((p) => p.id)),
      });
      if (!normalized.ok) {
        setImportErrors(normalized.errors);
        return;
      }
      const result = await repo.importSuitePackage(normalized.result);
      setImportNotes([
        `Imported "${normalized.result.suite.name}" — ${normalized.result.suite.tasks.length} task(s)` +
          (result.profileIds.length > 0 ? `, ${result.profileIds.length} profile(s)` : "") +
          (normalized.result.executionReady ? " — ready to run." : " — saved as a draft."),
        ...normalized.result.notes,
      ]);
      await load();
      window.location.hash = `#/evaluations/${result.suiteId}`;
    } catch (err: unknown) {
      const msg =
        err instanceof StorageError
          ? friendlyStorageError(err)
          : err instanceof Error
            ? err.message
            : "Could not import the suite package.";
      setImportErrors([msg]);
    } finally {
      setImporting(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  async function handleDuplicate(suite: EvaluationSuite) {
    if (!repo) return;
    setActionError(null);
    try {
      const copy: EvaluationSuite = {
        ...suite,
        id: generateId("suite"),
        revision: 0,
        version: 1,
        name: `${suite.name} (copy)`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archivedAt: null,
      };
      await repo.saveSuite(copy, 0);
      await load();
      window.location.hash = `#/evaluations/${copy.id}`;
    } catch (err: unknown) {
      const msg =
        err instanceof StorageError
          ? friendlyStorageError(err)
          : err instanceof Error
            ? err.message
            : "Could not duplicate the suite.";
      setActionError(msg);
    }
  }

  async function handleArchive(id: string) {
    if (!repo) return;
    setActionError(null);
    try {
      await repo.archiveSuite(id);
      setConfirmArchiveId(null);
      await load();
    } catch (err: unknown) {
      const msg =
        err instanceof StorageError
          ? friendlyStorageError(err)
          : err instanceof Error
            ? err.message
            : "Could not archive the suite.";
      setActionError(msg);
    }
  }

  // --- States ---

  if (state.loading && state.suites.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted">
        <Loader2 size={14} className="animate-spin-ease" aria-hidden="true" />
        <span>Loading suites…</span>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-4 text-center">
        <AlertCircle size={16} className="text-error" aria-hidden="true" />
        <p className="text-sm text-error">Failed to load suites.</p>
        <p className="text-sm text-text-muted">{state.error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Retry
        </button>
      </div>
    );
  }

  const allSuites = state.suites;
  const archivedCount = allSuites.filter((s) => s.archivedAt !== null).length;
  const visible = includeArchived ? allSuites : allSuites.filter((s) => !s.archivedAt);

  if (visible.length === 0) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 p-6 text-center">
        <input
          ref={importFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Import suite package"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
          }}
        />
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">
          No evaluation suites yet
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          An evaluation suite groups several tasks into a versioned set, executed one at a time
          through the comparison pipeline. Build a suite to compare models across a shared workload
          with a consistent judge and evaluation profile.
        </p>
        {/* Identity spec §5.4: teach the split from the suite side. */}
        <p className="max-w-md text-sm text-text-muted">
          Judging rules live in{" "}
          <Link
            to="/evaluations/profiles"
            className="text-text-secondary underline decoration-edge-bright underline-offset-2 hover:text-text"
          >
            Profiles
          </Link>
          ; suites pin them.
        </p>
        {createError && <p className="text-sm text-error">{createError}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-action="create-suite"
            onClick={handleCreate}
            disabled={creating}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-4 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <Plus size={15} aria-hidden="true" />
            {creating ? "Creating…" : "Create suite"}
          </button>
          <button
            type="button"
            data-action="import-suite"
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <Upload size={15} aria-hidden="true" />
            {importing ? "Importing…" : "Import suite"}
          </button>
        </div>
        {importErrors.length > 0 && (
          <ul
            className="flex max-w-md flex-col gap-0.5 text-left text-sm text-error"
            data-testid="suite-import-errors"
          >
            {importErrors.slice(0, 5).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {importNotes.length > 0 && (
          <ul
            className="flex max-w-md flex-col gap-0.5 text-left text-sm text-text-secondary"
            data-testid="suite-import-notes"
          >
            {importNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {archivedCount > 0 && (
          <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Show archived ({archivedCount})
          </label>
        )}
      </div>
    );
  }

  // --- List ---
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={importFileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Import suite package"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">
          {visible.length} suite{visible.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Show archived
            </label>
          )}
          <button
            type="button"
            data-action="import-suite"
            onClick={() => importFileRef.current?.click()}
            disabled={importing}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <Upload size={15} aria-hidden="true" />
            {importing ? "Importing…" : "Import"}
          </button>
          <button
            type="button"
            data-action="create-suite"
            onClick={handleCreate}
            disabled={creating}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.06] px-3 text-sm text-accent transition-colors duration-150 hover:bg-accent/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            <Plus size={15} aria-hidden="true" />
            {creating ? "Creating…" : "New suite"}
          </button>
        </div>
      </div>

      {createError && <p className="text-sm text-error">{createError}</p>}
      {actionError && <p className="text-sm text-error">{actionError}</p>}
      {importErrors.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-sm text-error" data-testid="suite-import-errors">
          {importErrors.slice(0, 5).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {importNotes.length > 0 && (
        <ul
          className="flex flex-col gap-0.5 text-sm text-text-secondary"
          data-testid="suite-import-notes"
        >
          {importNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-1.5" role="list">
        {visible.map((suite) => {
          const isArchived = suite.archivedAt !== null;
          // Identity spec §5.3: resolve the suite's default-evaluation pin.
          const evalChip = (() => {
            const ev = suite.defaultEvaluation;
            if (ev.kind === "holistic") return <RubricRefChip holistic />;
            const profile = state.profiles.get(`${ev.profile.id}@${ev.profile.version}`);
            if (!profile) return <RubricRefChip missing />;
            return (
              <RubricRefChip
                name={profile.name || "Untitled rubric"}
                rubricId={ev.profile.id}
                version={ev.profile.version}
              />
            );
          })();
          // Identity spec §5.4: latest experiment outcome, when the suite has run.
          const latest = state.latestExperiment.get(suite.id);
          return (
            <li key={suite.id}>
              <RecordRow
                variant="list"
                id={suite.id}
                title={suite.name || "Untitled suite"}
                status={isArchived ? "aborted" : "ready"}
                timestamp={suite.updatedAt}
                kind={<KindEyebrow kind="suite" />}
                modelCount={suite.modelSlots.filter((s) => s.enabled).length}
                summary={
                  suite.tasks.length > 0
                    ? `${suite.tasks.length} task${suite.tasks.length === 1 ? "" : "s"}`
                    : undefined
                }
                afterSummary={
                  latest ? (
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      <span aria-hidden="true">·</span>
                      <StatusMark status={latest.status} size={11} />
                      <span>last run {formatRelativeTime(latest.updatedAt)}</span>
                    </span>
                  ) : undefined
                }
                provenance={`v${suite.version}`}
                href={`/evaluations/${suite.id}`}
              >
                <div className="flex items-center gap-0.5">
                  {/* The pin chip lives in the trailing cluster rather than
                      inside the row link — nesting <a> in <a> is invalid HTML. */}
                  {evalChip}
                  <button
                    type="button"
                    aria-label={`Duplicate suite ${suite.name || "Untitled suite"}`}
                    title="Duplicate"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handleDuplicate(suite);
                    }}
                    className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                  {/* Stable geometry across the arm-to-confirm swap (identity
                      spec §5.2 / Task 12): the slot reserves the widest armed
                      state — "Archive?" (~88px) + gap + cancel (44px) — so
                      arming never shifts the row's action cluster. */}
                  <span
                    data-geometry="suite-archive-slot"
                    className="flex min-w-0 items-center justify-end sm:min-w-[136px]"
                  >
                    {confirmArchiveId === suite.id ? (
                      <span className="flex items-center gap-0.5">
                        <button
                          type="button"
                          data-action="confirm-archive"
                          aria-label={`Confirm archive suite ${suite.name || "Untitled suite"}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleArchive(suite.id);
                          }}
                          className="flex min-h-[44px] items-center gap-1 rounded-sm bg-error/[0.12] px-2 text-sm text-error hover:bg-error/[0.2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <Archive size={14} aria-hidden="true" />
                          Archive?
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel archive"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setConfirmArchiveId(null);
                          }}
                          className="flex h-11 w-11 items-center justify-center rounded-sm text-text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          ✕
                        </button>
                      </span>
                    ) : isArchived ? (
                      <span className="px-1 font-mono text-xs text-text-muted">Archived</span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Archive suite ${suite.name || "Untitled suite"}`}
                        title="Archive"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmArchiveId(suite.id);
                        }}
                        className="flex h-11 w-11 items-center justify-center rounded-sm text-text-secondary hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <Archive size={14} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </div>
              </RecordRow>
            </li>
          );
        })}
      </ul>

      {includeArchived && (
        <p className="pt-2 text-xs text-text-muted">
          Archived suites are hidden by default and excluded from new experiments. They remain
          readable and their pinned experiments are intact.
        </p>
      )}
    </div>
  );
}

function friendlyStorageError(err: StorageError): string {
  switch (err.kind) {
    case "quota":
      return "Storage is full — free space or remove unused suites before saving.";
    case "conflict":
      return "This suite was modified elsewhere. Reload and retry.";
    case "validation":
      return "The suite could not be saved — a field failed validation.";
    case "blocked":
    case "versionchange":
      return "Storage is blocked by another tab. Close it and retry.";
    case "unavailable":
      return "Storage is unavailable — retry; your existing data was not modified.";
  }
}
