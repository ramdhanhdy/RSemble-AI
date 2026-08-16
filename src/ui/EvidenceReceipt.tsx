// =============================================================================
// RSemble AI — Evidence receipt component (spec §12.1, §13)
//
// Explains why an Evaluation cell counts, what uses it can support, and what
// limits it. Shows eligibility status, evidence class, allowed uses, plain-
// language reason codes, Task/Version/Instance identity, model configuration,
// rubric/protocol/evaluator/verifier snapshots, retry/reuse/missing warnings,
// exact Observation and Record links, and indexing/loading/failure status.
//
// Invariants:
//   - A badge or color is never the only explanation; keyboard and screen-
//     reader users receive the exact same plain-language meaning.
//   - Missing paired cells never gain comparative or standing use.
//   - Verified is shown only when a persisted executed verifier passed.
//   - Retries and roster-extension reuse do not inflate response counts.
// =============================================================================
import { useState, useEffect, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  ReceiptText,
  Scale,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../lib/evidence/evidence-types";
import { explainDecision } from "../lib/evidence/evidence-explanation";
import type {
  EvidenceIndexJob,
  EvidenceRepository,
} from "../lib/persistence/evidence-repository";
import type { MissingReason } from "../lib/evaluations/experiment-aggregation";

export interface EvidenceReceiptProps {
  /** Run ID to resolve Observation from EvidenceRepository */
  runId?: string | null;
  /** Accepted judge attempt ID for filtering source observations */
  attemptId?: string | null;
  /** Canonical Task ID */
  taskId?: string;
  /** Candidate model key (providerId:slug) */
  modelKey?: string;
  /** Candidate ID for deep links */
  candidateId?: string | null;
  /** Repository override (falls back to useEvidenceRepository hook) */
  evidenceRepo?: EvidenceRepository | null;
  /** Direct preloaded Observation */
  observation?: Observation | null;
  /** Direct preloaded EligibilityDecision */
  decision?: EligibilityDecision | null;
  /** Direct preloaded ModelConfigurationSnapshot */
  modelConfig?: ModelConfigurationSnapshot | null;
  /** Direct preloaded EvidenceIndexJob */
  indexJob?: EvidenceIndexJob | null;
  /** Missing cell reason when no score was produced */
  missingReason?: MissingReason | null;
  /** Loading state flag */
  loading?: boolean;
  /** Error message */
  error?: string | null;
  /** Presentation variant: compact popover/disclosure button vs full card/panel */
  compact?: boolean;
  /** Default open state for disclosures */
  defaultOpen?: boolean;
  /** Optional custom wrapper className */
  className?: string;
}

const MISSING_EXPLANATIONS: Record<MissingReason, string> = {
  "no-attempt":
    "This task has not been run for this model yet. It is excluded from all comparative standing and cannot support any profile use.",
  "no-accepted-attempt":
    "Execution produced no accepted candidate attempt for this task cell. No canonical Observation was derived.",
  "evidence-missing":
    "Evidence for this cell is unavailable or unreconstructable. Excluded from all comparative standing.",
  "no-score":
    "This cell produced no accepted score or assessment. Excluded from comparative standing.",
};

const MISSING_TITLES: Record<MissingReason, string> = {
  "no-attempt": "Not run",
  "no-accepted-attempt": "No accepted attempt",
  "evidence-missing": "Evidence unavailable",
  "no-score": "No score",
};

export function EvidenceReceipt({
  runId,
  attemptId,
  taskId,
  modelKey,
  candidateId,
  evidenceRepo,
  observation,
  decision,
  modelConfig,
  indexJob,
  missingReason,
  loading = false,
  error,
  compact = false,
  defaultOpen = false,
  className = "",
}: EvidenceReceiptProps): ReactElement {
  const repo = evidenceRepo ?? null;
  const [loadedObs, setLoadedObs] = useState<Observation | null>(null);
  const [loadedDecision, setLoadedDecision] = useState<EligibilityDecision | null>(null);
  const [loadedModelConfig, setLoadedModelConfig] =
    useState<ModelConfigurationSnapshot | null>(null);
  const [loadedIndexJob, setLoadedIndexJob] = useState<EvidenceIndexJob | null>(null);
  const [asyncLoading, setAsyncLoading] = useState<boolean>(
    () => observation === undefined && Boolean(runId) && Boolean(repo),
  );
  const [asyncError, setAsyncError] = useState<string | null>(null);

  const [open, setOpen] = useState<boolean>(defaultOpen);
  useEffect(() => {
    // If observation is already passed via props or no runId, nothing to fetch
    if (observation !== undefined || !runId || !repo) {
      return;
    }
    let cancelled = false;
    setAsyncLoading(true);
    setAsyncError(null);

    (async () => {
      try {
        const [observations, job] = await Promise.all([
          repo.listObservationsBySource("evaluation", runId),
          repo.getIndexJob(runId),
        ]);
        if (cancelled) return;
        if (job) setLoadedIndexJob(job);

        // Find matching observation by taskId and optionally modelKey/candidateAttemptId
        const taskMatches = taskId
          ? observations.filter((o) => o.taskId === taskId)
          : observations;

        let matching: Observation | null = null;
        if (taskMatches.length === 1) {
          matching = taskMatches[0];
        } else if (taskMatches.length > 1) {
          if (attemptId) {
            matching = taskMatches.find((o) => o.candidateAttemptId === attemptId) ?? null;
          }
          if (!matching && modelKey) {
            for (const o of taskMatches) {
              if (o.modelConfigurationId) {
                const cfg = await repo.getModelConfiguration(o.modelConfigurationId);
                if (cfg) {
                  const keyWithProvider = `${cfg.providerId}:${cfg.requestedModel}`;
                  if (
                    keyWithProvider === modelKey ||
                    cfg.requestedModel === modelKey ||
                    modelKey.endsWith(`:${cfg.requestedModel}`) ||
                    (cfg.resolvedModel && modelKey.endsWith(`:${cfg.resolvedModel}`))
                  ) {
                    matching = o;
                    break;
                  }
                }
              }
            }
          }
          if (!matching) {
            matching = taskMatches[0];
          }
        } else if (observations.length > 0 && !taskId) {
          matching = observations[0];
        }

        if (matching) {
          setLoadedObs(matching);
          const [dec, cfg] = await Promise.all([
            repo.getActiveDecision(matching.id),
            matching.modelConfigurationId
              ? repo.getModelConfiguration(matching.modelConfigurationId)
              : Promise.resolve(null),
          ]);
          if (cancelled) return;
          setLoadedDecision(dec);
          setLoadedModelConfig(cfg);
        }
      } catch (err) {
        if (!cancelled) {
          setAsyncError(err instanceof Error ? err.message : "Failed to load evidence receipt");
        }
      } finally {
        if (!cancelled) {
          setAsyncLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [observation, runId, attemptId, taskId, modelKey, repo]);

  const obs = observation ?? loadedObs;
  const dec = decision ?? loadedDecision;
  const config = modelConfig ?? loadedModelConfig;
  const job = indexJob ?? loadedIndexJob;
  const isLoading = loading || (observation === undefined && runId != null && asyncLoading);
  const effectiveError = error ?? asyncError;

  // Render loading state
  if (isLoading) {
    if (compact) {
      return (
        <div className={`relative inline-block ${className}`}>
          <button
            type="button"
            aria-expanded={open}
            aria-label="Loading evidence receipt"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[44px] items-center gap-1 px-1 text-xs text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Loader2 size={12} className="animate-spin text-accent" aria-hidden="true" />
            <span className="sr-only">Loading evidence receipt</span>
          </button>
          {open ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-80 sm:w-96">
              <div
                data-testid="evidence-receipt"
                className="rounded-md border border-edge bg-panel p-3 text-xs text-text-secondary shadow-lg"
              >
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />
                  <span>Loading evidence receipt…</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div
        data-testid="evidence-receipt"
        className={`rounded-md border border-edge bg-panel p-3 text-xs text-text-secondary ${className}`}
      >
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />
          <span>Loading evidence receipt…</span>
        </div>
      </div>
    );
  }

  // Render indexing error state
  if (job?.status === "error" || (effectiveError && !obs && !dec)) {
    const errorMsg =
      job?.errorMessage ?? effectiveError ?? "Derivation failed for this source record.";
    const errorKind = job?.errorKind ?? "storage_conflict";
    const label = `Evidence Indexing Error: ${errorKind}`;

    if (compact) {
      return (
        <div className={`relative inline-block ${className}`}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={label}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[44px] items-center gap-1 px-1 text-xs text-error transition-colors hover:text-error-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ShieldAlert size={12} aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </button>
          {open ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-80 sm:w-96">
              <div
                data-testid="evidence-receipt"
                className="rounded-md border border-error/40 bg-raised p-3 text-xs text-text shadow-lg"
              >
                <div className="flex items-center gap-2 font-medium text-error">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>Evidence Indexing Error ({errorKind})</span>
                </div>
                <p className="mt-1 text-text-secondary">{errorMsg}</p>
                <p className="mt-2 text-[11px] text-text-muted">
                  Exact source run records remain safe and immutable. Derivation can be reindexed
                  without provider calls.
                </p>
                {runId ? (
                  <div className="mt-2">
                    <Link
                      to={`/runs/${runId}`}
                      className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span>View source record</span>
                      <ExternalLink size={11} aria-hidden="true" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div
        data-testid="evidence-receipt"
        className={`rounded-md border border-error/40 bg-error/[0.05] p-3 text-xs text-text ${className}`}
      >
        <div className="flex items-center gap-2 font-medium text-error">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>Evidence Indexing Error ({errorKind})</span>
        </div>
        <p className="mt-1 text-text-secondary">{errorMsg}</p>
        <p className="mt-2 text-[11px] text-text-muted">
          Exact source run records remain safe and immutable. Derivation can be reindexed without
          provider calls.
        </p>
        {runId ? (
          <div className="mt-2">
            <Link
              to={`/runs/${runId}`}
              className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span>View source record</span>
              <ExternalLink size={11} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  // Render missing cell state (when no observation exists)
  if (missingReason || (!obs && !dec)) {
    const reasonKey = missingReason ?? "no-score";
    const title = MISSING_TITLES[reasonKey];
    const explanationText = MISSING_EXPLANATIONS[reasonKey];
    const summaryLabel = `Excluded — ${title}`;

    if (compact) {
      return (
        <div className={`relative inline-block ${className}`}>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`Evidence receipt: ${summaryLabel}. Excluded from comparative standing.`}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex min-h-[44px] items-center gap-1 px-1 text-xs text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <XCircle size={12} className="text-text-muted" aria-hidden="true" />
            <span className="sr-only">Evidence receipt: {summaryLabel}</span>
          </button>
          {open ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-80 sm:w-96">
              <div
                data-testid="evidence-receipt"
                className="rounded-md border border-edge bg-raised p-3 text-xs text-text shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-edge pb-2">
                  <div className="flex items-center gap-1.5 font-medium text-text">
                    <XCircle size={14} className="text-text-muted" aria-hidden="true" />
                    <span>{summaryLabel}</span>
                  </div>
                  <span className="rounded bg-panel-hover px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                    Excluded
                  </span>
                </div>
                <div className="mt-2 text-text-secondary">
                  <p>{explanationText}</p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    No Observation was derived. This cell cannot support profile, comparative, or
                    standing use.
                  </p>
                </div>
                {runId ? (
                  <div className="mt-2 border-t border-edge pt-2">
                    <Link
                      to={`/runs/${runId}`}
                      className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span>View source run record</span>
                      <ExternalLink size={11} aria-hidden="true" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <div
        data-testid="evidence-receipt"
        className={`rounded-md border border-edge bg-panel p-3 text-xs text-text ${className}`}
      >
        <div className="flex items-center justify-between border-b border-edge pb-2">
          <div className="flex items-center gap-1.5 font-medium text-text">
            <XCircle size={14} className="text-text-muted" aria-hidden="true" />
            <span>{summaryLabel}</span>
          </div>
          <span className="rounded bg-panel-hover px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-muted">
            Excluded
          </span>
        </div>
        <div className="mt-2 text-text-secondary">
          <p>{explanationText}</p>
          <p className="mt-1 text-[11px] text-text-muted">
            No Observation was derived. This cell cannot support profile, comparative, or standing
            use.
          </p>
        </div>
        {runId ? (
          <div className="mt-2 border-t border-edge pt-2">
            <Link
              to={`/runs/${runId}`}
              className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span>View source run record</span>
              <ExternalLink size={11} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  // Scored observation receipt
  const explanation = dec
    ? explainDecision(dec)
    : {
        observationId: obs?.id ?? "",
        ruleVersion: 1,
        classLabel: "Exploratory",
        classDescription:
          "Exploratory evidence — visible and drillable, excluded from default model profiles.",
        statusLabel: "Provisional",
        statusDescription:
          "Provisional — eligible only for qualified uses with disclosed limitations.",
        summary: "Provisional — Exploratory",
        allowedUses: [],
        reasonLines: [],
        limitationLines: [],
      };

  const statusTone =
    dec?.status === "eligible"
      ? "text-success"
      : dec?.status === "provisional"
        ? "text-warning"
        : "text-error";

  const StatusIcon =
    dec?.status === "eligible"
      ? CheckCircle2
      : dec?.status === "provisional"
        ? AlertTriangle
        : XCircle;

  const summaryAccessibleText = `Evidence receipt: ${explanation.summary}. ${explanation.statusDescription} ${explanation.classDescription}`;

  // Deep links composition
  const runDeepHref = obs
    ? `/runs/${obs.sourceResultId || obs.runId}${
        candidateId
          ? `?candidate=${candidateId}&attempt=${obs.assessmentRef?.judgeAttemptId ?? ""}`
          : ""
      }`
    : runId
      ? `/runs/${runId}`
      : null;

  const taskDeepHref = obs?.taskId
    ? obs.taskVersion
      ? `/tasks/${obs.taskId}/versions/${obs.taskVersion}`
      : `/tasks/${obs.taskId}`
    : taskId
      ? `/tasks/${taskId}`
      : null;

  const rubricDeepHref = obs?.rubricRef?.id
    ? `/evaluations/rubrics/${obs.rubricRef.id}`
    : null;

  // Receipt body
  const receiptBody = (
    <article
      data-testid="evidence-receipt"
      aria-label="Evidence receipt"
      className={`flex flex-col gap-3 rounded-md border border-edge bg-raised p-3 text-xs text-text shadow-sm ${compact ? "shadow-lg" : ""} ${className}`}
    >
      {/* Header / Summary */}
      <header className="flex flex-col gap-1 border-b border-edge pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-text">
            <StatusIcon size={14} className={statusTone} aria-hidden="true" />
            <span>{explanation.summary}</span>
          </div>
          {compact ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close evidence receipt details"
              className="inline-flex min-h-[44px] items-center px-1.5 text-xs text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Close
            </button>
          ) : (
            <span className="font-mono text-[10px] text-text-muted">
              Rule v{dec?.ruleVersion ?? 1}
            </span>
          )}
        </div>
        <p className="text-xs text-text-secondary">{explanation.statusDescription}</p>
        <p className="text-[11px] text-text-muted">{explanation.classDescription}</p>
      </header>

      {/* Why it counts / Reasons */}
      <section className="flex flex-col gap-1.5">
        <h4 className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
          Why it counts
        </h4>
        {explanation.reasonLines.length > 0 ? (
          <ul className="flex flex-col gap-1 pl-1">
            {explanation.reasonLines.map((line) => (
              <li key={line.code} className="flex items-start gap-1.5 text-text-secondary">
                <CheckCircle2
                  size={12}
                  className="mt-0.5 shrink-0 text-success"
                  aria-hidden="true"
                />
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-muted">No specific qualification reasons recorded.</p>
        )}
      </section>

      {/* Limitations & Warnings */}
      {explanation.limitationLines.length > 0 ? (
        <section className="flex flex-col gap-1.5 rounded-sm border border-warning/30 bg-warning/[0.04] p-2">
          <h4 className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-warning">
            <AlertTriangle size={12} aria-hidden="true" />
            <span>Limitations & Disclosures</span>
          </h4>
          <ul className="flex flex-col gap-1">
            {explanation.limitationLines.map((line) => (
              <li key={line.code} className="text-text-secondary">
                {line.text}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Allowed Uses */}
      <section className="flex flex-col gap-1.5">
        <h4 className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
          Allowed Uses
        </h4>
        {explanation.allowedUses.length > 0 ? (
          <ul className="flex flex-col gap-1 pl-1">
            {explanation.allowedUses.map((use) => (
              <li key={use.code} className="flex items-start gap-1.5 text-text-secondary">
                <span className="font-mono text-[10px] text-accent">•</span>
                <span>{use.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-text-muted">
            No permitted evidence uses (this cell cannot support profile, comparative, or standing
            analysis).
          </p>
        )}
      </section>

      {/* Provenance details: Task, Model, Rubric, Evaluator, Verifier */}
      <section className="flex flex-col gap-1.5 border-t border-edge pt-2 text-[11px]">
        <h4 className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
          Evidence Provenance
        </h4>
        <dl className="grid grid-cols-1 gap-x-2 gap-y-1 sm:grid-cols-2">
          {/* Task */}
          <div>
            <dt className="text-text-muted">Task Identity:</dt>
            <dd className="font-mono text-text">
              {taskDeepHref ? (
                <Link
                  to={taskDeepHref}
                  className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span>
                    {obs?.taskId ?? taskId} (v{obs?.taskVersion ?? 1})
                  </span>
                  <ExternalLink size={10} aria-hidden="true" />
                </Link>
              ) : (
                <span>
                  {obs?.taskId ?? taskId} (v{obs?.taskVersion ?? 1})
                </span>
              )}
            </dd>
          </div>

          {/* Task Instance */}
          <div>
            <dt className="text-text-muted">Task Instance:</dt>
            <dd className="font-mono text-text">{obs?.taskInstanceId ?? "Unknown"}</dd>
          </div>

          {/* Model Configuration */}
          <div>
            <dt className="text-text-muted">Model Configuration:</dt>
            <dd className="text-text">
              <span className="font-mono">{config?.requestedModel ?? modelKey ?? "Unknown"}</span>
              {config?.resolvedVersion ? (
                <span className="text-text-secondary"> (v{config.resolvedVersion})</span>
              ) : (
                <span className="text-warning"> (unreported version)</span>
              )}
            </dd>
          </div>

          {/* Protocol Fingerprint */}
          <div>
            <dt className="text-text-muted">Protocol:</dt>
            <dd className="truncate font-mono text-text" title={obs?.protocolFingerprint}>
              {obs?.protocolFingerprint ?? "None"}
            </dd>
          </div>

          {/* Rubric */}
          <div>
            <dt className="text-text-muted">Rubric:</dt>
            <dd className="text-text">
              {rubricDeepHref && obs?.rubricRef ? (
                <Link
                  to={rubricDeepHref}
                  className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Scale size={11} aria-hidden="true" />
                  <span>
                    {obs.rubricRef.id} v{obs.rubricRef.version}
                  </span>
                </Link>
              ) : obs?.rubricRef ? (
                <span>
                  {obs.rubricRef.id} v{obs.rubricRef.version}
                </span>
              ) : (
                <span>Holistic judgment</span>
              )}
            </dd>
          </div>

          {/* Evaluator / Verifier */}
          <div>
            <dt className="text-text-muted">Evaluator & Verifier:</dt>
            <dd className="text-text">
              {obs?.evaluatorSnapshot ? (
                <span>
                  {obs.evaluatorSnapshot.kind === "model_judge" ? "Judge" : "Human"}:{" "}
                  {obs.evaluatorSnapshot.model}
                </span>
              ) : null}
              {obs?.verifierSnapshot ? (
                <span className="ml-1 text-text-secondary">
                  | Verifier: {obs.verifierSnapshot.kind} (
                  {obs.outcome.verifierPassed === true
                    ? "Passed"
                    : obs.outcome.verifierPassed === false
                      ? "Failed"
                      : "N/A"}
                  )
                </span>
              ) : (
                <span className="ml-1 text-text-muted">| No verifier</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/* Exact links / Identifiers footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-2 text-[11px]">
        <div className="flex items-center gap-1 text-text-muted">
          <span>Observation:</span>
          <span className="font-mono text-text">{obs?.id ?? "None"}</span>
        </div>
        {runDeepHref ? (
          <Link
            to={runDeepHref}
            className="inline-flex min-h-[44px] items-center gap-1 text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span>View exact run record</span>
            <ExternalLink size={11} aria-hidden="true" />
          </Link>
        ) : null}
      </footer>
    </article>
  );

  if (compact) {
    return (
      <div className={`relative inline-block ${className}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={summaryAccessibleText}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-[44px] items-center gap-1 rounded px-1.5 py-1 text-xs text-text-secondary transition-colors hover:bg-card-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <StatusIcon size={12} className={statusTone} aria-hidden="true" />
          <ReceiptText size={12} className="text-text-muted" aria-hidden="true" />
          <span className="sr-only">{summaryAccessibleText}</span>
        </button>
        {open ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-80 sm:w-96">{receiptBody}</div>
        ) : null}
      </div>
    );
  }

  return receiptBody;
}
