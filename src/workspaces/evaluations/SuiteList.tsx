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
import {
  AlertCircle,
  Copy,
  Loader2,
  Plus,
  Archive,
} from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { EvaluationSuite } from "../../lib/evaluations/evaluation-types";
import { RecordRow } from "../../ui/RecordRow";
import { StorageError } from "../../lib/persistence/database";

interface SuiteListProps {
  repo: EvaluationRepository | null;
}

interface SuiteListState {
  suites: EvaluationSuite[];
  loading: boolean;
  error: string | null;
}

/** Generate a stable random ID for new suites and tasks. */
function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankSuite(): EvaluationSuite {
  const now = Date.now();
  return {
    id: generateId("suite"),
    revision: 0,
    version: 1,
    name: "Untitled suite",
    description: "",
    tasks: [],
    modelSlots: [],
    defaultJudge: { providerId: "openrouter", model: "" },
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
  });
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!repo) {
      setState({ suites: [], loading: false, error: "Storage not available." });
      return;
    }
    const id = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      // Always load every suite (archived included) so the archived-filter
      // toggle can restore discoverability without an extra round-trip.
      const suites = await repo.listSuites(true);
      if (id === requestIdRef.current) {
        setState({ suites, loading: false, error: null });
      }
    } catch (err: unknown) {
      if (id === requestIdRef.current) {
        setState({
          suites: [],
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load suites.",
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
      const msg = err instanceof StorageError ? friendlyStorageError(err) : err instanceof Error ? err.message : "Could not save the suite.";
      setCreateError(msg);
    } finally {
      setCreating(false);
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
      const msg = err instanceof StorageError ? friendlyStorageError(err) : err instanceof Error ? err.message : "Could not duplicate the suite.";
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
      const msg = err instanceof StorageError ? friendlyStorageError(err) : err instanceof Error ? err.message : "Could not archive the suite.";
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
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-text-muted">
          No evaluation suites yet
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          An evaluation suite groups several tasks into a versioned set, executed one at a time
          through the comparison pipeline. Build a suite to compare models across a shared
          workload with a consistent judge and evaluation profile.
        </p>
        {createError && <p className="text-sm text-error">{createError}</p>}
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

      {createError && (
        <p className="text-sm text-error">{createError}</p>
      )}
      {actionError && (
        <p className="text-sm text-error">{actionError}</p>
      )}

      <ul className="flex flex-col gap-1.5" role="list">
        {visible.map((suite) => {
          const isArchived = suite.archivedAt !== null;
          return (
            <li key={suite.id}>
              <RecordRow
                variant="list"
                id={suite.id}
                title={suite.name || "Untitled suite"}
                status={isArchived ? "aborted" : "draft"}
                timestamp={suite.updatedAt}
                modelCount={suite.modelSlots.filter((s) => s.enabled).length}
                summary={suite.tasks.length > 0 ? `${suite.tasks.length} task${suite.tasks.length === 1 ? "" : "s"}` : undefined}
                provenance={`v${suite.version}`}
                href={`/evaluations/${suite.id}`}
              >
                <div className="flex items-center gap-0.5">
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
    default:
      return err.message || "Storage is unavailable.";
  }
}
