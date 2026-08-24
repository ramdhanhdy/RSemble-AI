// =============================================================================
// RSemble AI — Data diagnostics surface (Child 10 Task 9, spec §4.3)
//
// Non-destructive local diagnostics at /records/diagnostics, reached from the
// Records/archive utility area. Reports storage schema and migration marker
// versions, source/index counts, unresolved crosswalks and orphan references,
// derived rebuild status, and corrupted entities — and offers exactly three
// safe actions: Verify, Resume Migration, and Rebuild Derived Indexes.
//
// It never offers destructive delete/reset as a casual repair: exact source
// records remain protected, Verify performs reads only, and Rebuild touches
// only disposable derived indexes (search documents), never source records.
// Storage errors surface through classified StorageError guidance, never raw
// error echo.
// =============================================================================

import { useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ArrowLeft, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

import { RepositoryContext, useStorageState } from "../../lib/persistence/repository-context";
import {
  classifyStorageError,
  StorageError,
  type RSembleEvaluationDB,
} from "../../lib/persistence/database";
import {
  runMigrationRegistry,
  verifyMigrationState,
} from "../../lib/persistence/migration-registry";
import { canonicalTaskMigrationMarkerKey } from "../../lib/persistence/canonical-task-migration";
import { taskSetMigrationMarkerKey } from "../../lib/persistence/task-set-migration";
import { comparisonResultMigrationMarkerKey } from "../../lib/persistence/comparison-result-migration";
import { fusionToResearchLabReceiptKey } from "../../lib/migrations/fusion-to-research-lab";
import { createSearchIndexRepository } from "../../lib/persistence/search-index-repository";
import {
  createDexieSearchReindexMetaStore,
  createDexieSearchSourceResolver,
  rebuildSearchIndexWithLease,
} from "../../lib/search/search-reindex";
import { parseSearchDocument } from "../../lib/search/search-types";

// --- Pure reporting API (reads only) ------------------------------------------

export interface DiagnosticsMarker {
  key: string;
  version: number | null;
  completedAt: number | null;
}

export interface DiagnosticsCount {
  label: string;
  count: number;
}

export interface DiagnosticsIssue {
  kind: string;
  id: string;
}

export interface DiagnosticsReport {
  schemaVersion: number;
  markers: DiagnosticsMarker[];
  counts: DiagnosticsCount[];
  orphans: DiagnosticsIssue[];
  corrupted: DiagnosticsIssue[];
  searchDocumentCount: number;
  evidenceJobs: Record<string, number>;
}

const KNOWN_MARKER_KEYS: readonly string[] = [
  canonicalTaskMigrationMarkerKey,
  taskSetMigrationMarkerKey,
  comparisonResultMigrationMarkerKey,
  fusionToResearchLabReceiptKey,
];

const REGISTRY_COMPLETION_PREFIX = "migration-registry:complete:";
const MAX_LISTED_ISSUES = 50;

function markerVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const v = (value as Record<string, unknown>).version;
  return typeof v === "number" ? v : null;
}

function markerCompletedAt(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const v = (value as Record<string, unknown>).completedAt;
  return typeof v === "number" ? v : null;
}

/** Collect the full diagnostics report. Reads only; never writes. */
export async function collectDiagnostics(db: RSembleEvaluationDB): Promise<DiagnosticsReport> {
  const metaRows = await db.storageMeta.toArray();
  const markers: DiagnosticsMarker[] = [];
  for (const row of metaRows) {
    if (KNOWN_MARKER_KEYS.includes(row.key) || row.key.startsWith(REGISTRY_COMPLETION_PREFIX)) {
      markers.push({
        key: row.key,
        version: markerVersion(row.value),
        completedAt: markerCompletedAt(row.value),
      });
    }
  }
  markers.sort((a, b) => a.key.localeCompare(b.key));

  const [
    tasks,
    taskVersions,
    taskSets,
    taskSetVersions,
    comparisonResults,
    observations,
    runSummaries,
    searchDocuments,
  ] = await Promise.all([
    db.tasks.count(),
    db.taskVersions.count(),
    db.taskSets.count(),
    db.taskSetVersions.count(),
    db.comparisonResults.count(),
    db.observations.count(),
    db.runSummaries.count(),
    db.searchDocuments.count(),
  ]);
  const counts: DiagnosticsCount[] = [
    { label: "Run Summaries", count: runSummaries },
    { label: "Tasks", count: tasks },
    { label: "Task Versions", count: taskVersions },
    { label: "Task Sets", count: taskSets },
    { label: "Task Set Versions", count: taskSetVersions },
    { label: "Comparison Results", count: comparisonResults },
    { label: "Observations", count: observations },
    { label: "Search Documents", count: searchDocuments },
  ];

  // Orphan detection: crosswalk rows whose canonical target is missing, and
  // search documents whose source no longer resolves. IDs listed are storage
  // keys/types only — never record payloads.
  const orphans: DiagnosticsIssue[] = [];
  const crosswalks = await db.taskMigrationCrosswalk.toArray();
  for (const row of crosswalks.slice(0, MAX_LISTED_ISSUES)) {
    const target = await db.taskVersions.get([row.taskId, row.taskVersion]);
    if (!target) {
      orphans.push({ kind: "task-crosswalk", id: row.legacyScopeKey });
    }
  }
  const resolver = createDexieSearchSourceResolver(db);
  const searchRows = await db.searchDocuments.toArray();
  for (const row of searchRows.slice(0, MAX_LISTED_ISSUES)) {
    try {
      const resolved = await resolver.resolveDocument({ type: row.type, id: row.id });
      if (resolved === null) {
        orphans.push({ kind: "search-document", id: `${row.type}:${row.id}` });
      }
    } catch {
      orphans.push({ kind: "search-document", id: `${row.type}:${row.id}` });
    }
  }

  const corrupted: DiagnosticsIssue[] = [];
  for (const row of searchRows.slice(0, MAX_LISTED_ISSUES)) {
    try {
      parseSearchDocument(row);
    } catch {
      corrupted.push({ kind: "search-document", id: `${row.type}:${row.id}` });
    }
  }
  for (const row of crosswalks.slice(0, MAX_LISTED_ISSUES)) {
    if (typeof row.taskId !== "string" || typeof row.taskVersion !== "number") {
      corrupted.push({ kind: "task-crosswalk", id: String(row.legacyScopeKey) });
    }
  }

  const evidenceJobs: Record<string, number> = {};
  const jobs = await db.evidenceIndexJobs.toArray();
  for (const job of jobs) {
    const status = typeof job.status === "string" ? job.status : "unknown";
    evidenceJobs[status] = (evidenceJobs[status] ?? 0) + 1;
  }

  return {
    schemaVersion: db.verno,
    markers,
    counts,
    orphans,
    corrupted,
    searchDocumentCount: searchDocuments,
    evidenceJobs,
  };
}

/** Classified, safe error guidance. Never echoes raw error text. */
function safeStorageErrorMessage(err: unknown): string {
  const classified = err instanceof StorageError ? err : classifyStorageError(err);
  switch (classified.kind) {
    case "quota":
      return "Storage is full. Free up browser storage space and try again.";
    case "blocked":
      return "Storage is blocked by another tab. Close other RSemble tabs and retry.";
    case "versionchange":
      return "Storage was upgraded in another tab. Reload the page to continue.";
    case "unavailable":
      return "Storage is unavailable in this browser context.";
    case "validation":
      return "The storage check failed validation. No data was changed.";
    case "conflict":
      return "A storage conflict was detected. Reload the page to resume.";
    default:
      return "The storage check failed validation. No data was changed.";
  }
}

const buttonClass =
  "inline-flex min-h-[44px] items-center gap-2 rounded border border-edge bg-card px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded border border-edge bg-panel p-3">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">{title}</h2>
      {children}
    </section>
  );
}

type BusyAction = "verify" | "resume-migration" | "rebuild-indexes";

export function DataDiagnostics(): ReactElement {
  const { db } = useContext(RepositoryContext);
  const storageState = useStorageState();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);

  const storageReady = storageState === "ready" && db !== null;

  useEffect(() => {
    if (storageState !== "ready" || db === null) return;
    let cancelled = false;
    collectDiagnostics(db)
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(safeStorageErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [db, storageState]);

  async function refresh() {
    if (db === null) return;
    setReport(await collectDiagnostics(db));
  }

  async function runAction(action: BusyAction) {
    if (db === null || busy !== null) return;
    setBusy(action);
    setActionError(null);
    setActionResult(null);
    try {
      if (action === "verify") {
        const result = await verifyMigrationState(db);
        const verified = result.steps.filter((s) => s.verified).length;
        setActionResult(
          `Verify complete — ${verified}/${result.steps.length} migration steps verified.`,
        );
      } else if (action === "resume-migration") {
        const result = await runMigrationRegistry(db);
        setActionResult(
          result.ready
            ? "Resume migration complete — storage ready."
            : `Resume migration finished with ${result.errors.length} incomplete step(s).`,
        );
      } else {
        const result = await rebuildSearchIndexWithLease({
          searchRepo: createSearchIndexRepository(db),
          resolver: createDexieSearchSourceResolver(db),
          meta: createDexieSearchReindexMetaStore(db),
        });
        setActionResult(
          result.skipped
            ? `Rebuild skipped — another tab owns the rebuild (${result.reason}).`
            : `Rebuilt derived search index — ${result.indexedCount} documents.`,
        );
      }
      await refresh();
    } catch (err) {
      setActionError(safeStorageErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin bg-panel">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <div className="flex items-center gap-2">
          <Link
            to="/records"
            className="motion-state flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to Records
          </Link>
        </div>

        <header className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            Records
          </span>
          <h1 className="text-lg font-semibold text-text">Data diagnostics</h1>
          <p className="text-xs text-text-secondary">
            Read-only inspection of storage schema, migrations, and derived indexes. Repairs are
            limited to resuming migrations and rebuilding disposable derived indexes — exact source
            records are never modified here.
          </p>
        </header>

        {storageState !== "ready" && (
          <div
            role="status"
            data-diag="storage-blocked"
            className="flex flex-col gap-1 rounded border border-edge bg-card p-3 text-sm text-text-secondary"
          >
            <p className="font-medium text-text">Storage is {storageState}</p>
            <p>
              Diagnostics are unavailable while storage is blocked or upgraded by another tab. Close
              other RSemble tabs or reload the page, then return here.
            </p>
          </div>
        )}

        {storageState === "ready" && db === null && (
          <div
            role="status"
            className="rounded border border-edge bg-card p-3 text-sm text-text-secondary"
          >
            Storage is unavailable. Diagnostics cannot read the database handle.
          </div>
        )}

        {loadError !== null && (
          <p role="alert" className="text-xs text-error">
            {loadError}
          </p>
        )}

        {storageReady && report === null && loadError === null && (
          <p className="text-sm text-text-muted">Reading storage state…</p>
        )}

        {storageReady && report !== null && (
          <>
            <Section title="Storage schema">
              <p className="text-sm text-text-secondary" data-diag="schema-version">
                Schema version {report.schemaVersion}
              </p>
              {report.markers.length === 0 ? (
                <p className="text-xs text-text-muted">No migration markers recorded yet.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {report.markers.map((marker) => (
                    <li
                      key={marker.key}
                      data-diag="marker"
                      className="max-w-full truncate font-mono text-[11px] text-text-secondary"
                    >
                      {marker.key} — version {marker.version ?? "unknown"}
                      {marker.completedAt !== null
                        ? ` · completed ${new Date(marker.completedAt).toISOString()}`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Source and index counts">
              <ul className="flex flex-col gap-0.5">
                {report.counts.map((row) => (
                  <li key={row.label} data-diag="count" className="flex justify-between text-sm">
                    <span data-diag="count-label" className="text-text-secondary">
                      {row.label}
                    </span>
                    <span data-diag="count-value" className="font-mono text-text">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Unresolved references">
              {report.orphans.length === 0 ? (
                <p className="text-xs text-text-muted">
                  No unresolved crosswalks or orphan references.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {report.orphans.map((orphan) => (
                    <li
                      key={`${orphan.kind}:${orphan.id}`}
                      data-diag="orphan"
                      className="max-w-full truncate font-mono text-[11px] text-text-secondary"
                    >
                      {orphan.kind} — {orphan.id}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Derived index status">
              <p className="text-sm text-text-secondary" data-diag="search-index-count">
                Search documents — {report.searchDocumentCount} indexed
              </p>
              <p className="text-sm text-text-secondary" data-diag="evidence-jobs">
                Evidence index jobs —{" "}
                {Object.keys(report.evidenceJobs).length === 0
                  ? "none recorded"
                  : Object.keys(report.evidenceJobs)
                      .sort()
                      .map((status) => `${status}: ${report.evidenceJobs[status]}`)
                      .join(" · ")}
              </p>
            </Section>

            <Section title="Corrupted entities">
              {report.corrupted.length === 0 ? (
                <p className="text-xs text-text-muted">No corrupted entities detected.</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {report.corrupted.map((entry) => (
                    <li
                      key={`${entry.kind}:${entry.id}`}
                      data-diag="corrupted"
                      className="max-w-full truncate font-mono text-[11px] text-text-secondary"
                    >
                      {entry.kind} — {entry.id}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-action="verify"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => {
                  void runAction("verify");
                }}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                Verify
              </button>
              <button
                type="button"
                data-action="resume-migration"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => {
                  void runAction("resume-migration");
                }}
              >
                <Play size={16} aria-hidden="true" />
                Resume Migration
              </button>
              <button
                type="button"
                data-action="rebuild-indexes"
                className={buttonClass}
                disabled={busy !== null}
                onClick={() => {
                  void runAction("rebuild-indexes");
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Rebuild Derived Indexes
              </button>
            </div>

            {actionResult !== null && (
              <p role="status" data-diag="action-result" className="text-xs text-text-secondary">
                {actionResult}
              </p>
            )}
            {actionError !== null && (
              <p role="alert" className="text-xs text-error">
                {actionError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
