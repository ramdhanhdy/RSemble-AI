// =============================================================================
// RSemble AI — Task observations view (spec §12.2, §13)
//
// Child 04 (Observations, Eligibility, and Evidence Provenance) Milestone D.
// Repository-backed view of canonical Task Observations scoped to a Task or
// Task Version.
//
// Invariants:
//   - Grouped by Task Version and Task Instance (spec §12.2).
//   - Filtered by model configuration, evidence class, eligibility status,
//     allowed use, comparability cohort, source kind, and date.
//   - Deterministic pagination over filtered observations.
//   - Honest counts differentiate Tasks, versions, instances, active
//     observations, selected attempts, and all attempts without inflation.
//   - Discloses unknown model versions, partial identity, and legacy provenance
//     accessibly (never by badge or color alone).
//   - Direct deep links to exact Observation, source Record, Task Version,
//     and Rubric.
//   - Filter parameters survive navigation and browser back/forward via URL
//     search params.
//   - FusionStudy / FusionObservation is never listed or queried as a Task
//     Observation (spec §4).
//   - Resets state on task changes so stale owners cannot leak across
//     same-component route transitions.
// =============================================================================

import { useCallback, useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Layers,
  Loader2,
  RefreshCw,
  Scale,
  X,
  XCircle,
} from "lucide-react";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_USES,
  ELIGIBILITY_STATUSES,
  type EligibilityDecision,
  type EvidenceClass,
  type EligibilityStatus,
  type EvidenceUse,
  type ModelConfigurationSnapshot,
  type Observation,
  type ObservationSourceKind,
} from "../../lib/evidence/evidence-types";
import {
  EVIDENCE_CLASS_LABELS,
  EVIDENCE_USE_EXPLANATIONS,
} from "../../lib/evidence/evidence-explanation";
import { countEvidence, type EvidenceLedgerRow } from "../../lib/evidence/evidence-counting";
import { useEvidenceRepository } from "../../lib/persistence/repository-context";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import { EvidenceReceipt } from "../../ui/EvidenceReceipt";

export interface TaskObservationsProps {
  /** Canonical Task ID */
  taskId: string;
  /** Optional specific version scope (e.g. for /tasks/:taskId/versions/:v) */
  version?: number;
  /** Default items per page (default: 10) */
  pageSize?: number;
  /** Repository override (falls back to useEvidenceRepository hook) */
  evidenceRepo?: EvidenceRepository | null;
  /** Optional custom wrapper className */
  className?: string;
}

const DEFAULT_PAGE_SIZE = 10;

export function TaskObservations({
  taskId,
  version,
  pageSize = DEFAULT_PAGE_SIZE,
  evidenceRepo,
  className = "",
}: TaskObservationsProps): ReactElement {
  const contextRepo = useEvidenceRepository();
  const repo = evidenceRepo !== undefined ? evidenceRepo : contextRepo;

  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [decisions, setDecisions] = useState<Map<string, EligibilityDecision>>(new Map());
  const [modelConfigs, setModelConfigs] = useState<Map<string, ModelConfigurationSnapshot>>(
    new Map(),
  );
  const [refreshIndex, setRefreshIndex] = useState<number>(0);

  // Synchronously reset state during render when taskId changes to avoid leaking stale data
  const [prevTaskId, setPrevTaskId] = useState(taskId);
  if (prevTaskId !== taskId) {
    setPrevTaskId(taskId);
    setObservations([]);
    setDecisions(new Map());
    setModelConfigs(new Map());
    setLoading(true);
    setError(null);
  }

  // Read filter state from URL search params
  const modelFilter = searchParams.get("obs_model") ?? "";
  const classFilter = (searchParams.get("obs_class") as EvidenceClass) || "";
  const statusFilter = (searchParams.get("obs_status") as EligibilityStatus) || "";
  const useFilter = (searchParams.get("obs_use") as EvidenceUse) || "";
  const cohortFilter = searchParams.get("obs_cohort") ?? "";
  const sourceFilter = (searchParams.get("obs_source") as ObservationSourceKind) || "";
  const dateFromFilter = searchParams.get("obs_date_from") ?? "";
  const dateToFilter = searchParams.get("obs_date_to") ?? "";
  const versionFilterParam = searchParams.get("obs_ver") ?? "";
  const activeVersionFilter = version !== undefined ? String(version) : versionFilterParam;
  const instanceFilter = searchParams.get("obs_inst") ?? "";
  const currentPage = Math.max(1, parseInt(searchParams.get("obs_page") ?? "1", 10) || 1);

  // Update URL filter params helper
  const updateFilter = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          // Reset page when any filter changes (except page itself)
          if (key !== "obs_page") {
            next.delete("obs_page");
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const filterKeys = [
          "obs_model",
          "obs_class",
          "obs_status",
          "obs_use",
          "obs_cohort",
          "obs_source",
          "obs_date_from",
          "obs_date_to",
          "obs_ver",
          "obs_inst",
          "obs_page",
        ];
        for (const k of filterKeys) {
          next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // Load observations and resolved decisions/model configs
  useEffect(() => {
    if (!repo || !taskId) {
      setObservations([]);
      setDecisions(new Map());
      setModelConfigs(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const rawObs = await repo.listObservationsByTask(taskId);
        if (cancelled) return;

        // Fetch decisions and model configs for all observations
        const decMap = new Map<string, EligibilityDecision>();
        const configMap = new Map<string, ModelConfigurationSnapshot>();

        const configIds = new Set<string>();
        for (const o of rawObs) {
          if (o.modelConfigurationId) configIds.add(o.modelConfigurationId);
        }

        const [decList, configList] = await Promise.all([
          Promise.all(rawObs.map((o) => repo.getActiveDecision(o.id))),
          Promise.all(Array.from(configIds).map((id) => repo.getModelConfiguration(id))),
        ]);

        if (cancelled) return;

        rawObs.forEach((o, i) => {
          const dec = decList[i];
          if (dec) decMap.set(o.id, dec);
        });

        configList.forEach((cfg) => {
          if (cfg) configMap.set(cfg.id, cfg);
        });

        setObservations(rawObs);
        setDecisions(decMap);
        setModelConfigs(configMap);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load observations");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, taskId, refreshIndex]);

  // Scoped list based on fixed version prop (if supplied)
  const scopedObservations = useMemo(() => {
    if (version !== undefined) {
      return observations.filter((o) => o.taskVersion === version);
    }
    return observations;
  }, [observations, version]);

  // Available filter options derived from current data
  const filterOptions = useMemo(() => {
    const versions = new Set<number>();
    const instances = new Set<string>();
    const modelConfigIds = new Set<string>();
    const cohorts = new Set<string>();

    for (const o of scopedObservations) {
      versions.add(o.taskVersion);
      instances.add(o.taskInstanceId);
      if (o.modelConfigurationId) modelConfigIds.add(o.modelConfigurationId);
      const dec = decisions.get(o.id);
      if (dec?.comparabilityCohortId) cohorts.add(dec.comparabilityCohortId);
    }

    return {
      versions: Array.from(versions).sort((a, b) => a - b),
      instances: Array.from(instances).sort(),
      modelConfigIds: Array.from(modelConfigIds),
      cohorts: Array.from(cohorts).sort(),
    };
  }, [scopedObservations, decisions]);

  // Filtered observations
  const filteredObservations = useMemo(() => {
    return scopedObservations.filter((obs) => {
      // Version filter (when not locked by prop)
      if (version === undefined && activeVersionFilter) {
        if (String(obs.taskVersion) !== activeVersionFilter) return false;
      }

      // Instance filter
      if (instanceFilter && obs.taskInstanceId !== instanceFilter) return false;

      // Model configuration filter
      if (modelFilter && obs.modelConfigurationId !== modelFilter) return false;

      // Decision-based filters
      const dec = decisions.get(obs.id);
      if (classFilter && dec?.evidenceClass !== classFilter) return false;
      if (statusFilter && dec?.status !== statusFilter) return false;
      if (useFilter && !dec?.allowedUses.includes(useFilter)) return false;
      if (cohortFilter && dec?.comparabilityCohortId !== cohortFilter) return false;

      // Source kind filter
      if (sourceFilter && obs.sourceKind !== sourceFilter) return false;

      // Date range filter
      if (dateFromFilter) {
        const fromTime = Date.parse(dateFromFilter);
        if (!isNaN(fromTime) && obs.observedAt < fromTime) return false;
      }
      if (dateToFilter) {
        const toTime = Date.parse(dateToFilter) + 86_400_000 - 1; // End of day
        if (!isNaN(toTime) && obs.observedAt > toTime) return false;
      }

      return true;
    });
  }, [
    scopedObservations,
    version,
    activeVersionFilter,
    instanceFilter,
    modelFilter,
    classFilter,
    statusFilter,
    useFilter,
    cohortFilter,
    sourceFilter,
    dateFromFilter,
    dateToFilter,
    decisions,
  ]);

  // Invariant honest counts over scoped observations
  const honestCounts = useMemo(() => {
    if (scopedObservations.length === 0) {
      return {
        taskCount: taskId ? 1 : 0,
        versionCount: 0,
        instanceCount: 0,
        activeObservationCount: 0,
        selectedAttemptCount: 0,
        allAttemptCount: 0,
      };
    }

    // Build ledger rows for pure no-inflation counting
    const rows: EvidenceLedgerRow[] = scopedObservations.map((o) => ({
      lineageCellKey: `${o.sourceTaskCellId}::${o.modelConfigurationId}`,
      taskId: o.taskId,
      taskVersion: o.taskVersion,
      taskInstanceId: o.taskInstanceId,
      modelConfigurationId: o.modelConfigurationId,
      sequence: o.observedAt,
      candidateAttemptId: o.candidateAttemptId,
      reusedCandidateOutput: false,
      declaredReplicate: false,
      assessmentEventId: o.assessmentRef.judgeAttemptId,
      attemptIds: [o.candidateAttemptId],
    }));

    const counts = countEvidence({ rows, declaredPairs: [] });

    // Distinct selected attempts
    const selectedAttempts = new Set(scopedObservations.map((o) => o.candidateAttemptId)).size;

    return {
      taskCount: taskId ? 1 : 0,
      versionCount:
        Object.keys(counts.versionCountByTask).length > 0
          ? Object.values(counts.versionCountByTask).reduce((a, b) => a + b, 0)
          : new Set(scopedObservations.map((o) => o.taskVersion)).size,
      instanceCount:
        Object.keys(counts.instanceCountByTask).length > 0
          ? Object.values(counts.instanceCountByTask).reduce((a, b) => a + b, 0)
          : new Set(scopedObservations.map((o) => o.taskInstanceId)).size,
      activeObservationCount: counts.activeObservationCount,
      selectedAttemptCount: selectedAttempts,
      allAttemptCount: counts.attemptCount,
    };
  }, [scopedObservations, taskId]);

  // Pagination calculation
  const totalItems = filteredObservations.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedObservations = useMemo(() => {
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredObservations.slice(start, start + pageSize);
  }, [filteredObservations, safeCurrentPage, pageSize]);

  // Group paginated items by Version → Instance for display
  const paginatedGrouped = useMemo(() => {
    const versionMap = new Map<number, Map<string, Observation[]>>();

    for (const obs of paginatedObservations) {
      let instMap = versionMap.get(obs.taskVersion);
      if (!instMap) {
        instMap = new Map<string, Observation[]>();
        versionMap.set(obs.taskVersion, instMap);
      }
      const obsList = instMap.get(obs.taskInstanceId);
      if (obsList) {
        obsList.push(obs);
      } else {
        instMap.set(obs.taskInstanceId, [obs]);
      }
    }

    return versionMap;
  }, [paginatedObservations]);

  const hasActiveFilters = Boolean(
    (version === undefined && activeVersionFilter) ||
    instanceFilter ||
    modelFilter ||
    classFilter ||
    statusFilter ||
    useFilter ||
    cohortFilter ||
    sourceFilter ||
    dateFromFilter ||
    dateToFilter,
  );

  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  const filterIdPrefix = useId();

  return (
    <section
      data-task-observations-section
      className={`flex flex-col gap-4 rounded-md border border-edge bg-panel p-4 text-text ${className}`}
      aria-label="Task observations and evidence provenance"
    >
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-accent" aria-hidden="true" />
            <h2 className="text-base font-semibold text-text">
              Observations
              {version !== undefined ? ` (v${version})` : ""}
            </h2>
          </div>
          <p className="text-xs text-text-secondary">
            Derived canonical observations, comparability cohorts, and eligibility provenance (spec
            §12.2).
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRefreshIndex((i) => i + 1)}
          aria-label="Refresh observations"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw size={13} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </header>

      {/* Honest Count Metrics Banner */}
      <div
        data-honest-counts
        className="grid grid-cols-2 gap-2 rounded-md border border-edge bg-raised p-3 text-xs sm:grid-cols-3 md:grid-cols-6"
        aria-label="Task observation counts summary"
      >
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Tasks</span>
          <span data-count-tasks className="font-mono text-sm font-semibold text-text">
            {honestCounts.taskCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Versions</span>
          <span data-count-versions className="font-mono text-sm font-semibold text-text">
            {honestCounts.versionCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Instances</span>
          <span data-count-instances className="font-mono text-sm font-semibold text-text">
            {honestCounts.instanceCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Active Obs.</span>
          <span
            data-count-active-observations
            className="font-mono text-sm font-semibold text-accent"
          >
            {honestCounts.activeObservationCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">Selected Attempts</span>
          <span data-count-selected-attempts className="font-mono text-sm font-semibold text-text">
            {honestCounts.selectedAttemptCount}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] text-text-muted">All Attempts</span>
          <span
            data-count-all-attempts
            className="font-mono text-sm font-semibold text-text-secondary"
          >
            {honestCounts.allAttemptCount}
          </span>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div
          data-task-observations-loading
          className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-text-muted"
        >
          <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
          <span>Loading observations…</span>
        </div>
      ) : null}

      {/* Error state */}
      {!loading && error ? (
        <div
          data-task-observations-error
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-error/40 bg-error/[0.05] p-4 text-xs text-text"
        >
          <div className="flex items-center gap-2 font-medium text-error">
            <AlertCircle size={16} aria-hidden="true" />
            <span>Failed to load observations ({error})</span>
          </div>
          <p className="text-text-secondary">
            An error occurred while reading from the evidence repository. Source records remain
            safe.
          </p>
          <div>
            <button
              type="button"
              data-retry-button
              onClick={() => setRefreshIndex((i) => i + 1)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded border border-edge bg-raised px-3 py-1.5 text-xs text-text transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <RefreshCw size={12} aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      ) : null}

      {/* Filter Controls Bar */}
      {!loading && !error && scopedObservations.length > 0 ? (
        <fieldset className="flex flex-col gap-3 rounded-md border border-edge bg-raised/50 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className="flex items-center gap-1.5 font-medium text-text">
              <Filter size={13} className="text-accent" aria-hidden="true" />
              <span>Filters</span>
            </legend>
            {hasActiveFilters ? (
              <button
                type="button"
                data-clear-filters
                onClick={clearAllFilters}
                className="inline-flex min-h-[44px] items-center gap-1 text-xs text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={12} aria-hidden="true" />
                <span>Clear filters</span>
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Version filter (when not locked) */}
            {version === undefined ? (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`${filterIdPrefix}-ver`}
                  className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
                >
                  Version
                </label>
                <select
                  id={`${filterIdPrefix}-ver`}
                  data-filter-version
                  value={activeVersionFilter}
                  onChange={(e) => updateFilter("obs_ver", e.target.value)}
                  className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <option value="">All versions ({filterOptions.versions.length})</option>
                  {filterOptions.versions.map((v) => (
                    <option key={v} value={String(v)}>
                      Version {v}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* Instance filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-inst`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Instance
              </label>
              <select
                id={`${filterIdPrefix}-inst`}
                data-filter-instance
                value={instanceFilter}
                onChange={(e) => updateFilter("obs_inst", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All instances ({filterOptions.instances.length})</option>
                {filterOptions.instances.map((inst) => (
                  <option key={inst} value={inst}>
                    {inst}
                  </option>
                ))}
              </select>
            </div>

            {/* Model Configuration filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-model`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Model
              </label>
              <select
                id={`${filterIdPrefix}-model`}
                data-filter-model
                value={modelFilter}
                onChange={(e) => updateFilter("obs_model", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All models ({filterOptions.modelConfigIds.length})</option>
                {filterOptions.modelConfigIds.map((cfgId) => {
                  const cfg = modelConfigs.get(cfgId);
                  const label = cfg
                    ? `${cfg.requestedModel}${cfg.resolvedVersion ? ` (v${cfg.resolvedVersion})` : ""}`
                    : cfgId;
                  return (
                    <option key={cfgId} value={cfgId}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Evidence Class filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-class`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Evidence Class
              </label>
              <select
                id={`${filterIdPrefix}-class`}
                data-filter-class
                value={classFilter}
                onChange={(e) => updateFilter("obs_class", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All classes</option>
                {EVIDENCE_CLASSES.map((cls) => (
                  <option key={cls} value={cls}>
                    {EVIDENCE_CLASS_LABELS[cls]}
                  </option>
                ))}
              </select>
            </div>

            {/* Eligibility Status filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-status`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Eligibility Status
              </label>
              <select
                id={`${filterIdPrefix}-status`}
                data-filter-status
                value={statusFilter}
                onChange={(e) => updateFilter("obs_status", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All statuses</option>
                {ELIGIBILITY_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Allowed Use filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-use`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Allowed Use
              </label>
              <select
                id={`${filterIdPrefix}-use`}
                data-filter-use
                value={useFilter}
                onChange={(e) => updateFilter("obs_use", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All permitted uses</option>
                {EVIDENCE_USES.map((use) => (
                  <option key={use} value={use}>
                    {use.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>

            {/* Cohort filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-cohort`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Cohort
              </label>
              <select
                id={`${filterIdPrefix}-cohort`}
                data-filter-cohort
                value={cohortFilter}
                onChange={(e) => updateFilter("obs_cohort", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All cohorts ({filterOptions.cohorts.length})</option>
                {filterOptions.cohorts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Source Kind filter */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-source`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Source Kind
              </label>
              <select
                id={`${filterIdPrefix}-source`}
                data-filter-source
                value={sourceFilter}
                onChange={(e) => updateFilter("obs_source", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">All sources</option>
                <option value="evaluation">Evaluation</option>
                <option value="comparison">Comparison</option>
              </select>
            </div>

            {/* Date range filters */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-date-from`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Date From
              </label>
              <input
                id={`${filterIdPrefix}-date-from`}
                data-filter-date-from
                type="date"
                value={dateFromFilter}
                onChange={(e) => updateFilter("obs_date_from", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${filterIdPrefix}-date-to`}
                className="font-mono text-[11px] uppercase tracking-wider text-text-muted"
              >
                Date To
              </label>
              <input
                id={`${filterIdPrefix}-date-to`}
                data-filter-date-to
                type="date"
                value={dateToFilter}
                onChange={(e) => updateFilter("obs_date_to", e.target.value)}
                className="min-h-[44px] rounded border border-edge bg-panel px-2 py-1 text-xs text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>
        </fieldset>
      ) : null}

      {/* Empty State (when no observations match or exist) */}
      {!loading && !error && scopedObservations.length === 0 ? (
        <div
          data-observations-empty
          className="flex flex-col items-center justify-center gap-2 rounded-md border border-edge bg-raised/30 p-8 text-center"
        >
          <Layers size={24} className="text-text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-text">No observations recorded for this task.</p>
          <p className="text-xs text-text-secondary">
            Derivation generates immutable Observation references from completed candidate/judge
            attempts during evaluation runs.
          </p>
        </div>
      ) : null}

      {!loading && !error && scopedObservations.length > 0 && filteredObservations.length === 0 ? (
        <div
          data-observations-no-matches
          className="flex flex-col items-center justify-center gap-2 rounded-md border border-edge bg-raised/30 p-6 text-center"
        >
          <Filter size={20} className="text-text-muted" aria-hidden="true" />
          <p className="text-sm font-medium text-text">No observations match active filters.</p>
          <button
            type="button"
            onClick={clearAllFilters}
            className="inline-flex min-h-[44px] items-center gap-1 text-xs text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear all filters
          </button>
        </div>
      ) : null}

      {/* Grouped Observations List */}
      {!loading && !error && paginatedObservations.length > 0 ? (
        <div className="flex flex-col gap-4" data-observations-list>
          {Array.from(paginatedGrouped.entries()).map(([ver, instanceMap]) => (
            <div
              key={ver}
              data-version-group={ver}
              className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-3"
            >
              {/* Version Header */}
              <div className="flex items-center justify-between border-b border-edge pb-2">
                <h3 className="text-sm font-semibold text-text">Task Version {ver}</h3>
                <Link
                  to={`/tasks/${taskId}/versions/${ver}`}
                  className="inline-flex min-h-[44px] items-center gap-1 text-xs text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span>View version definition</span>
                  <ExternalLink size={11} aria-hidden="true" />
                </Link>
              </div>

              {/* Instances inside Version */}
              <div className="flex flex-col gap-3">
                {Array.from(instanceMap.entries()).map(([instId, obsList]) => (
                  <div
                    key={instId}
                    data-instance-group={instId}
                    className="flex flex-col gap-2 rounded-md border border-edge bg-raised/40 p-3"
                  >
                    {/* Instance Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/60 pb-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
                          Instance:
                        </span>
                        <span className="font-mono font-medium text-text">{instId}</span>
                      </div>
                      <span className="text-[11px] text-text-secondary">
                        {obsList.length} {obsList.length === 1 ? "observation" : "observations"}
                      </span>
                    </div>

                    {/* Observations Rows */}
                    <div className="flex flex-col gap-2 pt-1">
                      {obsList.map((obs) => {
                        const dec = decisions.get(obs.id);
                        const cfg = modelConfigs.get(obs.modelConfigurationId);

                        const isEligible = dec?.status === "eligible";
                        const isProvisional = dec?.status === "provisional";

                        const StatusIcon = isEligible
                          ? CheckCircle2
                          : isProvisional
                            ? AlertTriangle
                            : XCircle;
                        const statusTone = isEligible
                          ? "text-success"
                          : isProvisional
                            ? "text-warning"
                            : "text-error";

                        const classLabel = dec?.evidenceClass
                          ? EVIDENCE_CLASS_LABELS[dec.evidenceClass]
                          : "Unknown";

                        // Disclosures
                        const hasUnreportedVersion = !cfg?.resolvedVersion;
                        const hasPartialIdentity = cfg?.identityCompleteness !== "exact";
                        const isLegacyLimited = dec?.reasonCodes?.includes("source_legacy_limited");

                        const runParams = new URLSearchParams();
                        if (obs.candidateAttemptId) {
                          runParams.set("candidate", obs.candidateAttemptId);
                        }
                        if (obs.assessmentRef?.judgeAttemptId) {
                          runParams.set("attempt", obs.assessmentRef.judgeAttemptId);
                        }
                        const runQuery = runParams.toString();
                        const runUrl = `/runs/${encodeURIComponent(obs.sourceResultId)}${runQuery ? `?${runQuery}` : ""}`;
                        const rubricUrl = obs.rubricRef?.id
                          ? `/evaluations/rubrics/${obs.rubricRef.id}`
                          : null;

                        return (
                          <div
                            key={obs.id}
                            data-observation-row={obs.id}
                            className="flex flex-col gap-2.5 rounded border border-edge bg-panel p-3 text-xs transition-colors hover:border-edge-focus"
                          >
                            {/* Row Header: Model, Class, Status, Receipt */}
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-col gap-0.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-text">
                                    {cfg?.requestedModel ?? obs.modelConfigurationId}
                                  </span>
                                  {cfg?.resolvedVersion ? (
                                    <span className="font-mono text-[11px] text-text-secondary">
                                      v{cfg.resolvedVersion}
                                    </span>
                                  ) : (
                                    <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                                      Unreported version
                                    </span>
                                  )}
                                  {hasPartialIdentity ? (
                                    <span className="rounded bg-raised px-1.5 py-0.5 text-[11px] text-text-muted">
                                      Partial identity
                                    </span>
                                  ) : null}
                                </div>
                                <span className="text-[11px] text-text-muted">
                                  Observed {new Date(obs.observedAt).toLocaleString()} • Source:{" "}
                                  <span className="capitalize">{obs.sourceKind}</span>
                                </span>
                              </div>

                              {/* Status & Evidence Class Badges */}
                              <div className="flex items-center gap-2">
                                <div className="flex items-center gap-1">
                                  <StatusIcon size={14} className={statusTone} aria-hidden="true" />
                                  <span className="font-medium capitalize text-text">
                                    {dec?.status ?? "Provisional"}
                                  </span>
                                </div>
                                <span className="rounded border border-edge bg-raised px-2 py-0.5 text-[11px] text-text-secondary">
                                  {classLabel}
                                </span>
                                {/* Evidence Receipt Modal / Popover */}
                                <EvidenceReceipt
                                  compact
                                  observation={obs}
                                  decision={dec}
                                  modelConfig={cfg}
                                />
                              </div>
                            </div>

                            {/* Disclosures & Limitations Banner */}
                            {isLegacyLimited ||
                            hasUnreportedVersion ||
                            dec?.reasonCodes?.includes("canonical_task_unresolved") ? (
                              <div className="flex flex-wrap items-center gap-2 rounded bg-warning/[0.04] p-1.5 text-[11px] text-text-secondary">
                                <AlertTriangle
                                  size={12}
                                  className="text-warning"
                                  aria-hidden="true"
                                />
                                {hasUnreportedVersion ? (
                                  <span>Model version unreported; comparisons split cohorts.</span>
                                ) : null}
                                {isLegacyLimited ? (
                                  <span>
                                    Legacy provenance recorded as-is without inferred identity.
                                  </span>
                                ) : null}
                              </div>
                            ) : null}

                            {/* Allowed Uses */}
                            {dec?.allowedUses && dec.allowedUses.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                                <span className="text-text-muted">Permitted uses:</span>
                                {dec.allowedUses.map((use) => (
                                  <span
                                    key={use}
                                    className="rounded bg-raised px-1.5 py-0.5 text-text-secondary"
                                    title={EVIDENCE_USE_EXPLANATIONS[use]}
                                  >
                                    {use.replace(/_/g, " ")}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[11px] text-text-muted">
                                No permitted uses (excluded from model profile and comparative
                                standing).
                              </div>
                            )}

                            {/* Provenance details and Deep links footer */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge/60 pt-2 text-[11px]">
                              <div className="flex flex-wrap items-center gap-3 text-text-muted">
                                <span>
                                  Observation: <span className="font-mono text-text">{obs.id}</span>
                                </span>
                                {dec?.comparabilityCohortId ? (
                                  <span>
                                    Cohort:{" "}
                                    <span className="font-mono text-text-secondary">
                                      {dec.comparabilityCohortId}
                                    </span>
                                  </span>
                                ) : null}
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                {rubricUrl ? (
                                  <Link
                                    to={rubricUrl}
                                    data-link-rubric
                                    className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                  >
                                    <Scale size={11} aria-hidden="true" />
                                    <span>Rubric v{obs.rubricRef?.version ?? 1}</span>
                                  </Link>
                                ) : null}

                                <Link
                                  to={`/tasks/${obs.taskId}/versions/${obs.taskVersion}`}
                                  data-link-version
                                  className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  <span>Task v{obs.taskVersion}</span>
                                </Link>

                                <Link
                                  to={runUrl}
                                  data-link-record
                                  className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                  <span>Source record</span>
                                  <ExternalLink size={11} aria-hidden="true" />
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Pagination Footer */}
      {!loading && !error && totalItems > pageSize ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3 text-xs">
          <div data-pagination-info className="text-text-secondary">
            Showing <span className="font-medium text-text">{startItem}</span>–
            <span className="font-medium text-text">{endItem}</span> of{" "}
            <span className="font-medium text-text">{totalItems}</span> observations
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-pagination-prev
              disabled={safeCurrentPage <= 1}
              onClick={() => updateFilter("obs_page", String(safeCurrentPage - 1))}
              aria-label="Previous page of observations"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded border border-edge bg-raised px-2.5 py-1 text-xs text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span>Previous</span>
            </button>

            <span className="text-text-muted">
              Page {safeCurrentPage} of {totalPages}
            </span>

            <button
              type="button"
              data-pagination-next
              disabled={safeCurrentPage >= totalPages}
              onClick={() => updateFilter("obs_page", String(safeCurrentPage + 1))}
              aria-label="Next page of observations"
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded border border-edge bg-raised px-2.5 py-1 text-xs text-text transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span>Next</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}
