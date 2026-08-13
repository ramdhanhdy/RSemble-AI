// =============================================================================
// RSemble AI — Task catalog (canonical-tasks spec §7.1)
//
// Child 02 (Canonical Tasks) Milestone D, Task 6.
//
// Searchable / filterable / paginated catalog of canonical Tasks with explicit
// loading, empty, classified error/retry, and archive states. All list data
// flows through the TaskRepository query contract (search over latest-version
// title/objective, origin and primary-family filters, deterministic
// updatedAt-desc pagination) — the UI never re-filters behind the repository's
// back. Rows link to /tasks/:taskId. Tasks stay a secondary surface: reachable
// from the command palette, absent from primary navigation.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Plus, Search } from "lucide-react";
import { StorageError } from "../../lib/persistence/database";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import type { TaskFamily, TaskRecord } from "../../lib/tasks/task-types";

const PAGE_SIZE = 50;

type OriginFilter = "all" | "authored" | "legacy-task-set" | "promoted-comparison" | "imported";

interface CatalogState {
  kind: "loading" | "ready" | "error";
  rows: TaskRecord[];
  error: StorageError | null;
}

interface FamilyOption {
  id: string;
  name: string;
}

export function TaskCatalog({ repo }: { repo: TaskRepository | null }) {
  const [search, setSearch] = useState("");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [familyFilter, setFamilyFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [state, setState] = useState<CatalogState>({ kind: "loading", rows: [], error: null });
  const [hasMore, setHasMore] = useState(false);
  const [rowTitles, setRowTitles] = useState<Map<string, string>>(new Map());
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  // Reset to the first page whenever the query shape changes.
  useEffect(() => {
    setPage(0);
  }, [search, originFilter, familyFilter]);

  useEffect(() => {
    if (repo === null) {
      setState({ kind: "error", rows: [], error: null });
      setFamilies([]);
      return;
    }
    let cancelled = false;
    const trimmed = search.trim();
    setState((prev) => ({ kind: "loading", rows: prev.rows, error: null }));
    void repo
      .listTaskFamilies(false)
      .catch(() => [] as TaskFamily[])
      .then((fams) => {
        if (cancelled) return;
        setFamilies(
          fams
            .filter((f) => f.archivedAt === null)
            .map((f) => ({ id: f.id, name: f.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      });
    // Fetch one extra row to know whether a next page exists without a
    // separate count query — pagination stays deterministic and cheap.
    repo
      .listTasks({
        search: trimmed === "" ? undefined : trimmed,
        origin: originFilter === "all" ? undefined : originFilter,
        familyId: familyFilter === "all" ? undefined : familyFilter,
        includeArchived: true,
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
      })
      .then(async (rows) => {
        setHasMore(rows.length > PAGE_SIZE);
        const pageRows = rows.slice(0, PAGE_SIZE);
        // Row content (title/objective, spec §7.1) comes from the immutable
        // latest version; fetch one read per visible row.
        const versions = await Promise.all(
          pageRows.map((row) => repo.getTaskVersion(row.id, row.latestVersion)),
        );
        const titles = new Map<string, string>();
        versions.forEach((version, index) => {
          if (version) titles.set(pageRows[index].id, version.title);
        });
        return { pageRows, titles };
      })
      .then(({ pageRows, titles }) => {
        if (cancelled) return;
        setRowTitles(titles);
        setState({ kind: "ready", rows: pageRows, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        const classified =
          err instanceof StorageError ? err : new StorageError("unavailable", String(err));
        setState({ kind: "error", rows: [], error: classified });
        setHasMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, search, originFilter, familyFilter, page, reloadTick]);

  const retry = useCallback(() => setReloadTick((t) => t + 1), []);

  const errorKind = state.error?.kind ?? (repo === null ? "unavailable" : null);
  const errorMessage = useMemo(() => {
    if (repo === null) {
      return "Task catalog storage is unavailable. Compare remains operational; reload the page to retry storage initialization.";
    }
    if (state.error === null) return "";
    switch (state.error.kind) {
      case "blocked":
        return "Storage is blocked by another tab. Close the other RSemble tab, then retry.";
      case "quota":
        return "Local storage quota is full. Free up space, then retry.";
      case "versionchange":
        return "The database changed in another tab. Reload the page, then retry.";
      default:
        return "The task catalog query failed.";
    }
  }, [repo, state.error]);

  return (
    <div data-task-catalog className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-lg font-semibold text-text">Tasks</h1>
          <p className="text-sm text-text-secondary">
            Canonical tasks, versions, and origins. Historical tasks stay routable after archive.
          </p>
        </div>
        <Link
          to="/tasks/new"
          data-action="new-task"
          className="flex min-h-[44px] items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Plus size={16} aria-hidden="true" />
          New task
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            aria-label="Search tasks"
            placeholder="Search title or objective…"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            className="min-h-[44px] w-full rounded-md border border-edge bg-card pl-9 pr-3 text-sm text-text placeholder:text-text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </div>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
          <span>Origin</span>
          <select
            data-filter="origin"
            aria-label="Filter by origin"
            value={originFilter}
            onChange={(event) => setOriginFilter(event.currentTarget.value as OriginFilter)}
            className="min-h-[44px] rounded-md border border-edge bg-card px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <option value="all">All origins</option>
            <option value="authored">Authored</option>
            <option value="legacy-task-set">Legacy task set</option>
            <option value="promoted-comparison">Promoted comparison</option>
            <option value="imported">Imported</option>
          </select>
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-text-secondary">
          <span>Family</span>
          <select
            data-filter="family"
            aria-label="Filter by family"
            value={familyFilter}
            onChange={(event) => setFamilyFilter(event.currentTarget.value)}
            className="min-h-[44px] rounded-md border border-edge bg-card px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <option value="all">All families</option>
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errorKind !== null && state.kind !== "loading" ? (
        <div
          data-task-error-state
          role="alert"
          className="flex flex-col items-center gap-2 rounded-md border border-error/30 bg-error/[0.06] p-6 text-center"
        >
          <AlertCircle size={20} className="text-error" aria-hidden="true" />
          <p className="text-sm font-medium text-error">
            {repo === null ? "Task catalog storage is unavailable." : `Failed to load tasks (${errorKind}).`}
          </p>
          <p className="text-sm text-text-secondary">{errorMessage}</p>
          {repo !== null && (
            <button
              type="button"
              data-action="retry"
              onClick={retry}
              className="min-h-[44px] min-w-[44px] rounded-md border border-edge bg-card px-4 text-sm text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Retry
            </button>
          )}
        </div>
      ) : state.kind === "loading" ? (
        <div
          data-task-loading
          className="flex min-h-[160px] items-center justify-center text-sm text-text-muted"
        >
          Loading tasks…
        </div>
      ) : state.rows.length === 0 ? (
        <div
          data-task-empty
          className="flex flex-col items-center gap-3 rounded-md border border-edge bg-card p-8 text-center"
        >
          <p className="text-sm font-medium text-text">
            {search.trim() !== "" || originFilter !== "all" || familyFilter !== "all"
              ? "No tasks match the current search and filters."
              : "No tasks yet."}
          </p>
          <p className="text-sm text-text-secondary">
            {search.trim() !== "" || originFilter !== "all" || familyFilter !== "all"
              ? "Adjust the search or filters to widen the catalog."
              : "Create a task to start building the canonical catalog, or run the legacy migration to import suite tasks."}
          </p>
          <Link
            to="/tasks/new"
            data-action="new-task"
            className="flex min-h-[44px] items-center gap-2 rounded-md border border-edge bg-raised px-3 text-sm text-text transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Plus size={16} aria-hidden="true" />
            New task
          </Link>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {state.rows.map((row) => (
              <li key={row.id}>
                <Link
                  to={`/tasks/${row.id}`}
                  data-task-row={row.id}
                  className="flex min-h-[44px] items-center gap-3 rounded-md border border-edge bg-card px-4 py-2 transition-colors hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-text">
                      {rowTitles.get(row.id) ?? row.id}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      <span>v{row.latestVersion}</span>
                      <span>{row.origin}</span>
                      <span>Updated {new Date(row.updatedAt).toLocaleString()}</span>
                    </span>
                  </div>
                  {row.archivedAt !== null && (
                    <span
                      data-task-archived={row.id}
                      className="shrink-0 rounded-sm border border-edge bg-raised px-2 py-0.5 text-xs text-text-secondary"
                    >
                      Archived
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <nav aria-label="Task catalog pages" className="flex items-center justify-end gap-2">
            <button
              type="button"
              data-action="prev-page"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="min-h-[44px] rounded-md border border-edge bg-card px-3 text-sm text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Previous
            </button>
            <span className="text-xs text-text-muted">Page {page + 1}</span>
            <button
              type="button"
              data-action="next-page"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="min-h-[44px] rounded-md border border-edge bg-card px-3 text-sm text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
