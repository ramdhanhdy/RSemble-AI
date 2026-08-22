// =============================================================================
// ObservationDrilldown — Fable §8 (C4).
//
// Focused record page (not a dialog) at
// /models/:modelConfigurationId/evidence/:observationId. Renders emitted
// identity, canonical Task/Version/Instance links, outcome, assessment /
// provenance, source result backlink, and the Records deep link. Raw candidate
// output is never duplicated here.
// =============================================================================

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, CircleDashed, FileSearch, XCircle } from "lucide-react";
import { CopyLinkButton } from "../runs/CopyLinkButton";
import type { EligibilityStatus, EvidenceClass } from "../../lib/evidence/evidence-types";
import { useEvidenceRepository, useTaskRepository } from "../../lib/persistence/repository-context";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type { TaskRepository } from "../../lib/persistence/task-repository";
import { loadObservationDrilldown } from "./model-profile-loader";

export interface ObservationOutcomeView {
  kind: "verifier" | "judged";
  passed?: boolean | null;
  score?: number | null;
  verifierRef?: string | null;
  verifierDigest?: string | null;
  rubricRef?: string | null;
  cohortId?: string | null;
}

export interface ObservationDrilldownData {
  observationId: string;
  observedAt: number;
  evidenceClass: EvidenceClass;
  eligibility: EligibilityStatus;
  eligibilityReasons: readonly string[];
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  familyId?: string | null;
  familyName?: string;
  outcome: ObservationOutcomeView;
  replicateLabel?: string | null;
  evaluator: {
    kind: string;
    model?: string;
    instructionDigest?: string;
  };
  assessmentLineage: "active" | "superseded";
  sourceKind: "comparison" | "evaluation";
  sourceResultId: string;
  sourceHref: string;
  confidenceLabel?: string;
  recordHref: string;
  configurationId: string;
  configurationLabel: string;
}

export interface ObservationDrilldownProps {
  data?: ObservationDrilldownData | null;
  notFound?: boolean;
  evidenceRepo?: EvidenceRepository | null;
  taskRepo?: TaskRepository | null;
}

const LINK_CLASS =
  "min-h-[44px] inline-flex items-center text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";

const EVIDENCE_CLASS_WORD: Record<EvidenceClass, string> = {
  exploratory: "Exploratory",
  comparable: "Comparable",
  verified: "Verified",
  benchmark_anchor: "Benchmark anchor",
};

function EligibilityMark({
  status,
  reasons,
}: {
  status: EligibilityStatus;
  reasons: readonly string[];
}): ReactNode {
  const Icon = status === "eligible" ? Check : status === "provisional" ? CircleDashed : XCircle;
  return (
    <div data-eligibility className="flex flex-col gap-1 text-sm text-text">
      <span className="inline-flex items-center gap-1">
        <Icon size={14} aria-hidden="true" />
        <span>{status}</span>
      </span>
      {reasons.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-text-secondary">
          {reasons.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NotFoundPanel({ observationId }: { observationId: string }): ReactNode {
  return (
    <div data-drilldown-state="not-found" className="flex flex-col gap-4 py-8">
      <div className="text-text">
        <p className="text-sm">
          No observation with id <span className="font-mono">{observationId}</span> exists in this
          database.
        </p>
      </div>
      <div className="flex gap-2">
        <Link
          to="/models"
          data-action="open-models"
          className="pressable inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text hover:border-edge-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Open Models
        </Link>
        <Link
          to="/runs"
          data-action="open-records"
          className="pressable inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text hover:border-edge-bright focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Open Records
        </Link>
      </div>
      <p className="honesty-note text-xs text-text-muted">
        This lookup is device-local. The observation may exist in another database or under a
        different identity.
      </p>
    </div>
  );
}

export function ObservationDrilldown({
  data: dataProp,
  notFound: notFoundProp,
  evidenceRepo: evidenceRepoProp,
  taskRepo: taskRepoProp,
}: ObservationDrilldownProps = {}): ReactNode {
  const params = useParams<{ modelConfigurationId: string; observationId: string }>();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const observationId = dataProp?.observationId ?? params.observationId ?? "";

  const ctxEvidenceRepo = useEvidenceRepository();
  const ctxTaskRepo = useTaskRepository();
  const evidenceRepo = evidenceRepoProp !== undefined ? evidenceRepoProp : ctxEvidenceRepo;
  const taskRepo = taskRepoProp !== undefined ? taskRepoProp : ctxTaskRepo;

  const [loadedData, setLoadedData] = useState<ObservationDrilldownData | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(notFoundProp ?? false);

  useEffect(() => {
    requestAnimationFrame(() => {
      headingRef.current?.focus();
    });
  }, [observationId]);

  useEffect(() => {
    if (dataProp !== undefined || notFoundProp !== undefined) return;
    if (!evidenceRepo || !observationId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let isCancelled = false;
    setLoading(true);
    setNotFound(false);

    loadObservationDrilldown({
      observationId,
      modelConfigurationId: params.modelConfigurationId,
      evidenceRepo,
      taskRepo,
    })
      .then((result) => {
        if (!isCancelled) {
          if (!result) {
            setNotFound(true);
          } else {
            setLoadedData(result);
          }
          setLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [evidenceRepo, taskRepo, observationId, params.modelConfigurationId, dataProp, notFoundProp]);

  if (notFoundProp || notFound) {
    return <NotFoundPanel observationId={observationId || params.observationId || "unknown"} />;
  }

  const data = dataProp ?? loadedData;

  if (loading || !data) {
    if (loading) {
      return (
        <div data-drilldown-state="loading" className="py-8 text-sm text-text-muted">
          Loading observation…
        </div>
      );
    }
    return <NotFoundPanel observationId={observationId || params.observationId || "unknown"} />;
  }

  const taskHref = `/tasks/${data.taskId}`;
  const versionHref = `/tasks/${data.taskId}/versions/${data.taskVersion}`;
  const observed = new Date(data.observedAt).toISOString();

  return (
    <article data-observation-drilldown className="flex flex-col gap-6">
      <nav
        data-breadcrumb
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1 text-xs text-text-muted"
      >
        <Link
          to="/models"
          className="hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          Models
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          to={`/models/${data.configurationId}`}
          className="hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
        >
          {data.configurationLabel}
        </Link>
        <span aria-hidden="true">/</span>
        <span>Observation</span>
      </nav>

      <section data-section="identity" aria-labelledby="drilldown-heading">
        <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          <FileSearch size={11} aria-hidden="true" />
          OBSERVATION
        </span>
        <h1
          ref={headingRef}
          id="drilldown-heading"
          tabIndex={-1}
          className="mt-1 font-mono text-lg text-text outline-none"
        >
          {data.observationId}
        </h1>
        <p className="mt-1 font-mono text-xs text-text-muted">{observed}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            data-evidence-class={data.evidenceClass}
            className="rounded-sm border border-edge px-2 py-0.5 text-xs text-text-secondary"
          >
            {EVIDENCE_CLASS_WORD[data.evidenceClass]}
          </span>
          <EligibilityMark status={data.eligibility} reasons={data.eligibilityReasons} />
        </div>
      </section>

      <section data-section="canonical" aria-labelledby="canonical-heading">
        <h2 id="canonical-heading" className="text-sm font-semibold text-text">
          Canonical target
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link data-canonical-link to={taskHref} className={LINK_CLASS}>
            Task {data.taskId}
          </Link>
          <Link data-canonical-link to={versionHref} className={LINK_CLASS}>
            Version {data.taskVersion}
          </Link>
          <span
            data-canonical-instance
            className="rounded-sm border border-edge px-2 py-0.5 text-xs text-text-secondary"
          >
            Instance {data.taskInstanceId}
          </span>
          {data.familyName && (
            <span className="rounded-sm border border-edge px-2 py-0.5 text-xs text-text-secondary">
              {data.familyName}
            </span>
          )}
        </div>
      </section>

      <section data-section="outcome" aria-labelledby="outcome-heading">
        <h2 id="outcome-heading" className="text-sm font-semibold text-text">
          Outcome
        </h2>
        <div className="mt-2 text-sm text-text">
          {data.outcome.kind === "verifier" ? (
            data.outcome.passed === true ? (
              <span className="inline-flex items-center gap-1">
                <Check size={14} aria-hidden="true" />
                <span>pass</span>
                {data.outcome.verifierRef && (
                  <span className="font-mono text-xs text-text-secondary">
                    {data.outcome.verifierRef}
                  </span>
                )}
                {data.outcome.verifierDigest && (
                  <span className="font-mono text-xs text-text-muted">
                    {data.outcome.verifierDigest}
                  </span>
                )}
              </span>
            ) : data.outcome.passed === false ? (
              <span className="inline-flex items-center gap-1">
                <XCircle size={14} aria-hidden="true" />
                <span>fail</span>
                {data.outcome.verifierRef && (
                  <span className="font-mono text-xs text-text-secondary">
                    {data.outcome.verifierRef}
                  </span>
                )}
                {data.outcome.verifierDigest && (
                  <span className="font-mono text-xs text-text-muted">
                    {data.outcome.verifierDigest}
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-text-muted">
                <span>unavailable</span>
              </span>
            )
          ) : data.outcome.score !== null && data.outcome.score !== undefined ? (
            <span>
              <span className="font-mono text-lg tabular-nums">{String(data.outcome.score)}</span>
              {data.outcome.rubricRef && (
                <span className="ml-2 font-mono text-xs text-text-secondary">
                  {data.outcome.rubricRef}
                </span>
              )}
              {data.outcome.cohortId && (
                <span className="ml-2 font-mono text-xs text-text-muted">
                  {data.outcome.cohortId}
                </span>
              )}
            </span>
          ) : (
            <span className="font-mono text-xs text-text-muted">unavailable</span>
          )}
        </div>
        {data.replicateLabel && (
          <p className="mt-1 text-xs text-text-secondary">{data.replicateLabel}</p>
        )}
      </section>

      <section data-section="assessment" aria-labelledby="assessment-heading">
        <h2 id="assessment-heading" className="text-sm font-semibold text-text">
          Assessment &amp; provenance
        </h2>
        <div className="mt-2 space-y-1 text-sm text-text">
          <p>
            {data.evaluator.kind}
            {data.evaluator.model ? ` · ${data.evaluator.model}` : ""}
            {data.evaluator.instructionDigest ? (
              <span className="ml-2 font-mono text-xs text-text-muted">
                {data.evaluator.instructionDigest}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-text-secondary">{data.assessmentLineage}</p>
        </div>
      </section>

      <section data-section="source" aria-labelledby="source-heading">
        <h2 id="source-heading" className="text-sm font-semibold text-text">
          Source result
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link data-source-backlink to={data.sourceHref} className={LINK_CLASS}>
            {data.sourceKind} {data.sourceResultId}
          </Link>
          {data.confidenceLabel && (
            <span
              data-confidence-chip
              className="rounded-sm border border-edge px-2 py-0.5 text-xs text-text-secondary"
            >
              {data.confidenceLabel}
            </span>
          )}
        </div>
      </section>

      <section data-section="record" aria-labelledby="record-heading">
        <h2 id="record-heading" className="text-sm font-semibold text-text">
          Exact record
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a data-records-link href={data.recordHref} className={LINK_CLASS}>
            {data.recordHref}
          </a>
          <CopyLinkButton />
        </div>
        <p className="honesty-note mt-2 text-xs text-text-muted">
          Raw output lives on the exact Record; it is not duplicated here.
        </p>
      </section>
    </article>
  );
}
