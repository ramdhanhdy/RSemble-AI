// =============================================================================
// RSemble AI — ModelsWorkspace — the `/models/*` shell (Child 07 Task 9, C2).
//
// Mirrors the Lab workspace shell pattern: a content area whose index route is
// the Models list. Nested profile (`/models/:modelConfigurationId`) and
// observation drilldown routes arrive in Task 10 — their Route slots are left
// absent here, never stubbed with fake pages.
//
// Data flow: the C1 catalog query (`queryModelConfigurationCatalog`) is the
// sort/identity authority — it filters by provider/model/version-status and
// returns canonically sorted entries. The list layer enriches each entry with
// per-configuration observation derivations (distinct tasks, top families,
// gap count, evidence classes) needed by the remaining five filters and the
// §6.3 row anatomy, then applies the complete-set post-filters, the D1 sort
// toggle, and pagination. URL state is the single source of truth
// (`models-url-state` codec over `useSearchParams`).
// =============================================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Route, Routes, useSearchParams } from "react-router-dom";
import { Cpu } from "lucide-react";
import {
  useEvidenceRepository,
  useTaskRepository,
} from "../../lib/persistence/repository-context";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import {
  queryModelConfigurationCatalog,
  type ModelConfigurationCatalogEntry,
  type ModelConfigurationCatalogQuery,
} from "../../lib/model-profiles/model-configuration-query";
import type { EvidenceClass } from "../../lib/evidence/evidence-types";
import type { TaskFamily } from "../../lib/tasks/task-types";
import { PROVIDER_LABELS } from "../../ui/ProviderTabs";
import { ModelFilters, type ModelFiltersOptions } from "./ModelFilters";
import {
  FirstUseState,
  LoadErrorState,
  ModelList,
  SavedRollupsSection,
  ZeroMatchState,
  pageCountFor,
  type ModelListRowData,
} from "./ModelList";
import {
  DEFAULT_MODEL_LIST_URL_STATE,
  countAppliedModelFilters,
  decodeModelListUrlState,
  encodeModelListUrlState,
  type ModelListUrlState,
} from "./models-url-state";

const DAY_MS = 86_400_000;
const PAGE_SIZE = 50;

const STANDING_SUBTITLE =
  "Exact model configurations with qualified evidence. No scores, no ranks — coverage, cohorts, and drilldown.";

const NONE_ELIGIBLE_NOTE =
  "All current evidence is exploratory or excluded — profiles show coverage without claims.";

/** Effective reasoning/tool signature for one entry (filter #5): the
 *  non-null reasoning-effective and tool-scaffold dimensions joined, or
 *  "none" when both are absent. */
function effectiveSignature(entry: ModelConfigurationCatalogEntry): string {
  const parts = [entry.reasoningEffective, entry.toolScaffoldSignature].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : "none";
}

interface LoadedData {
  /** Catalog-filtered, canonically sorted, enriched rows. */
  rows: ModelListRowData[];
  /** Filter option lists derived from the loaded set. */
  options: ModelFiltersOptions;
  /** Total eligible profile-evidence across the loaded set (receipt). */
  totalEligible: number;
}

interface LoadState {
  loading: boolean;
  error: string | null;
  data: LoadedData | null;
}

/** Build the catalog-level query from the provider/model/version-status
 *  filters (the three the C1 catalog query supports). */
function catalogQueryFor(state: ModelListUrlState): ModelConfigurationCatalogQuery {
  const query: ModelConfigurationCatalogQuery = {};
  if (state.provider) query.providerIds = [state.provider];
  if (state.model) query.requestedModels = [state.model];
  if (state.versionStatus) {
    query.identityCompleteness = [state.versionStatus];
  }
  return query;
}

/** Enrich one catalog entry with per-configuration observation derivations. */
async function enrichEntry(
  entry: ModelConfigurationCatalogEntry,
  repo: EvidenceRepository,
  familyNames: Map<string, string>,
  familyUniverse: Set<string>,
): Promise<ModelListRowData> {
  const observations = await repo.listObservationsByModelConfiguration(
    entry.modelConfigurationId,
  );
  const taskIds = new Set<string>();
  const familyCounts = new Map<string, number>();
  for (const obs of observations) {
    if (obs.taskId) taskIds.add(obs.taskId);
    if (obs.taskFamilyId) {
      familyCounts.set(obs.taskFamilyId, (familyCounts.get(obs.taskFamilyId) ?? 0) + 1);
    }
  }
  const topFamilyIds = [...familyCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([id]) => id);
  const topFamilyNames = topFamilyIds
    .map((id) => familyNames.get(id) ?? id)
    .slice(0, 2);
  const observedFamilies = new Set(familyCounts.keys());
  let gapCount = 0;
  for (const famId of familyUniverse) {
    if (!observedFamilies.has(famId)) gapCount += 1;
  }
  return { entry, taskCount: taskIds.size, topFamilyNames, gapCount };
}

/** Build the data-driven filter option lists from the loaded set. */
function buildOptions(
  entries: ModelConfigurationCatalogEntry[],
  familyNames: Map<string, string>,
): ModelFiltersOptions {
  const providerIds = [...new Set(entries.map((e) => e.providerId))].sort((a, b) =>
    a.localeCompare(b),
  );
  const providers = providerIds.map((id) => ({
    id,
    label: PROVIDER_LABELS[id as keyof typeof PROVIDER_LABELS] ?? id,
  }));
  const models = [...new Set(entries.map((e) => e.requestedModel))].sort((a, b) =>
    a.localeCompare(b),
  );
  const signatures = [...new Set(entries.map(effectiveSignature))].sort((a, b) =>
    a.localeCompare(b),
  );
  const classVocab: { id: EvidenceClass; label: string }[] = [
    { id: "exploratory", label: "Exploratory" },
    { id: "comparable", label: "Comparable" },
    { id: "verified", label: "Verified" },
    { id: "benchmark_anchor", label: "Benchmark anchor" },
  ];
  const evidenceClasses = entries.some((e) => e.eligibleProfileEvidenceCount > 0)
    ? classVocab
    : [];
  const families = [...familyNames.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { providers, models, signatures, evidenceClasses, families };
}

/** Load the catalog, enrich every entry, and build filter options + rows. */
async function loadModels(
  repo: EvidenceRepository,
  taskRepo: TaskRepository | null,
  state: ModelListUrlState,
): Promise<LoadedData> {
  const query = catalogQueryFor(state);
  const { entries, receipt } = await queryModelConfigurationCatalog(repo, query);
  const families: TaskFamily[] = taskRepo ? await taskRepo.listTaskFamilies() : [];
  const familyNames = new Map<string, string>();
  const familyUniverse = new Set<string>();
  for (const fam of families) {
    if (fam.archivedAt === null) {
      familyNames.set(fam.id, fam.name);
      familyUniverse.add(fam.id);
    }
  }
  const rows = await Promise.all(
    entries.map((entry) => enrichEntry(entry, repo, familyNames, familyUniverse)),
  );
  const options = buildOptions(entries, familyNames);
  return { rows, options, totalEligible: receipt.totalEligibleProfileEvidence };
}

/** Apply the complete-set post-filters (search, signature, evidence class,
 *  family, recency) to the loaded rows. The catalog query already handled
 *  provider/model/version-status; this preserves the catalog's canonical
 *  order. */
function applyPostFilters(
  rows: ModelListRowData[],
  state: ModelListUrlState,
  now: number,
): ModelListRowData[] {
  const search = state.search.trim().toLowerCase();
  const sig = state.signature;
  const cls = state.evidenceClass;
  const fam = state.family;
  let recencyCutoff = -Infinity;
  if (state.recency) {
    const days = Number(state.recency);
    recencyCutoff = now - days * DAY_MS;
  }
  return rows.filter((row) => {
    const { entry } = row;
    if (search) {
      const haystack = [
        entry.modelConfigurationId,
        entry.providerId,
        entry.requestedModel,
        entry.resolvedModel ?? "",
        entry.resolvedVersion ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (sig && effectiveSignature(entry) !== sig) return false;
    if (cls && entry.eligibleProfileEvidenceCount === 0) return false;
    if (fam && !row.topFamilyNames.includes(fam)) return false;
    if (recencyCutoff !== -Infinity && entry.latestActivity < recencyCutoff) {
      return false;
    }
    return true;
  });
}

/** Apply the D1 sort. Canonical = catalog order (preserved); latest activity =
 *  by latestActivity desc with the configuration id as a stable tiebreak. */
function applySort(
  rows: ModelListRowData[],
  sort: ModelListUrlState["sort"],
): ModelListRowData[] {
  if (sort === "latest") {
    return [...rows].sort(
      (a, b) =>
        b.entry.latestActivity - a.entry.latestActivity ||
        a.entry.modelConfigurationId.localeCompare(b.entry.modelConfigurationId),
    );
  }
  return rows;
}

function ModelsHeader({ count }: { count: number }): ReactNode {
  return (
    <header className="flex flex-col gap-1">
      <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        <Cpu size={11} aria-hidden="true" />
        MODELS
      </span>
      <div className="flex items-baseline gap-2">
        <h1 className="text-lg text-text">Models</h1>
        <span className="font-mono text-xs text-text-muted tabular-nums">
          {count} configurations
        </span>
      </div>
      <p className="text-xs text-text-secondary">{STANDING_SUBTITLE}</p>
    </header>
  );
}

export interface ModelsWorkspaceProps {
  /** Test seam: inject an evidence repository without the React context. */
  evidenceRepo?: EvidenceRepository | null;
  /** Test seam: inject a task repository without the React context. */
  taskRepo?: TaskRepository | null;
}

export function ModelsWorkspace({
  evidenceRepo: evidenceRepoProp,
  taskRepo: taskRepoProp,
}: ModelsWorkspaceProps = {}): ReactNode {
  const ctxEvidenceRepo = useEvidenceRepository();
  const ctxTaskRepo = useTaskRepository();
  const evidenceRepo = evidenceRepoProp !== undefined ? evidenceRepoProp : ctxEvidenceRepo;
  const taskRepo = taskRepoProp !== undefined ? taskRepoProp : ctxTaskRepo;

  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(
    () => decodeModelListUrlState(searchParams),
    [searchParams],
  );

  const [load, setLoad] = useState<LoadState>({
    loading: true,
    error: null,
    data: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  // Reload only when the catalog-level filters or repo/retry change. The
  // post-filters, sort, and page are pure render-time derivations.
  useEffect(() => {
    if (!evidenceRepo) {
      setLoad({ loading: false, error: "Evidence repository unavailable.", data: null });
      return;
    }
    let cancelled = false;
    setLoad({ loading: true, error: null, data: null });
    void loadModels(evidenceRepo, taskRepo, state)
      .then((data) => {
        if (!cancelled) setLoad({ loading: false, error: null, data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setLoad({ loading: false, error: message, data: null });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceRepo, taskRepo, state.provider, state.model, state.versionStatus, reloadKey]);

  function pushState(next: ModelListUrlState) {
    setSearchParams(encodeModelListUrlState(next));
  }
  function handleFiltersChange(next: ModelListUrlState) {
    pushState(next);
  }
  function handlePageChange(page: number) {
    pushState({ ...state, page });
  }
  function handleClearFilters() {
    pushState({ ...DEFAULT_MODEL_LIST_URL_STATE, sort: state.sort });
  }
  function handleRetry() {
    setReloadKey((k) => k + 1);
  }

  const now = Date.now();
  const loadedRows = load.data?.rows ?? [];
  const filtered = useMemo(
    () => applySort(applyPostFilters(loadedRows, state, now), state.sort),
    [loadedRows, state, now],
  );
  const totalItems = filtered.length;
  const pageCount = pageCountFor(totalItems);
  const currentPage = Math.min(Math.max(1, state.page), pageCount);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const appliedFilters = countAppliedModelFilters(state);
  const showNoneEligibleBanner =
    appliedFilters === 0 && (load.data?.totalEligible ?? 0) === 0;

  const listContent = renderListContent({
    load,
    appliedFilters,
    showNoneEligibleBanner,
    pageRows,
    currentPage,
    pageCount,
    totalItems,
    onPageChange: handlePageChange,
    onClearFilters: handleClearFilters,
    onRetry: handleRetry,
  });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-thin px-3 py-4 lg:px-6">
        <div className="max-w-[960px]">
          <ModelsHeader count={load.data?.rows.length ?? 0} />
          <div className="mt-4">
            <ModelFilters
              value={state}
              onChange={handleFiltersChange}
              options={load.data?.options ?? {
                providers: [],
                models: [],
                signatures: [],
                evidenceClasses: [],
                families: [],
              }}
            />
          </div>
          <div className="mt-4">
            <Routes>
              <Route index element={listContent} />
              {/* Nested profile (/models/:modelConfigurationId) and observation
                  drilldown routes arrive in Task 10 — left absent here, never
                  stubbed with fake pages. */}
            </Routes>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RenderArgs {
  load: LoadState;
  appliedFilters: number;
  showNoneEligibleBanner: boolean;
  pageRows: ModelListRowData[];
  currentPage: number;
  pageCount: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onClearFilters: () => void;
  onRetry: () => void;
}

function renderListContent(args: RenderArgs): ReactNode {
  const {
    load,
    appliedFilters,
    showNoneEligibleBanner,
    pageRows,
    currentPage,
    pageCount,
    totalItems,
    onPageChange,
    onClearFilters,
    onRetry,
  } = args;

  if (load.error) {
    return <LoadErrorState message={load.error} onRetry={onRetry} />;
  }
  if (load.loading) {
    return (
      <div data-list-state="loading" className="text-sm text-text-muted">
        Loading configurations…
      </div>
    );
  }
  if (totalItems === 0) {
    if (appliedFilters > 0) {
      return (
        <>
          <ZeroMatchState onClear={onClearFilters} />
          <SavedRollupsSection />
        </>
      );
    }
    return <FirstUseState />;
  }
  return (
    <>
      {showNoneEligibleBanner && (
        <p className="honesty-note mb-3 rounded-md border border-edge bg-panel px-3 py-2 text-xs text-text-muted">
          {NONE_ELIGIBLE_NOTE}
        </p>
      )}
      <ModelList
        rows={pageRows}
        page={currentPage}
        pageCount={pageCount}
        totalItems={totalItems}
        onPageChange={onPageChange}
      />
      <SavedRollupsSection />
    </>
  );
}
