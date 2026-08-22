import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Link as LinkIcon, Route } from "lucide-react";
import { Link } from "react-router-dom";
import type { Observation } from "../../lib/evidence/evidence-types";
import type { LegacyRunSummary, RunRecordV2 } from "../../lib/persistence/run-types";
import type { PolicyStudyChildren, RecordsRepository } from "../../lib/records/records-repository";
import type {
  EvaluationExecutionReference,
  PolicyStudyReference,
  RecordReference,
  RecordType,
} from "../../lib/records/record-reference";
import { recordDetailHref, resolveRecordOwner } from "../../lib/records/record-owner";
import { HONESTY_COPY } from "../../ui/honesty-copy";
import { RecordTypeEyebrow } from "../../ui/RecordTypeEyebrow";
import { RecordTypeRow } from "../../ui/RecordTypeRow";
import { StatusMark } from "../../ui/StatusMark";
import { CopyLinkButton } from "../runs/CopyLinkButton";
import { LegacyRunDetail } from "../runs/LegacyRunDetail";
import { RunDetail } from "../runs/RunDetail";
import type { RunConfigPreload } from "../../lib/runs/run-config-preload";
import { RecordNotFound } from "./RecordNotFound";

interface DetailState {
  reference: RecordReference | null;
  observation: Observation | null;
  policyChildren: PolicyStudyChildren | null;
  childRecords: RecordReference[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: DetailState = {
  reference: null,
  observation: null,
  policyChildren: null,
  childRecords: [],
  loading: true,
  error: null,
};

function ConfidenceChip({ reference }: { reference: RecordReference }) {
  const owner = resolveRecordOwner(reference);
  const Icon =
    owner.confidence === "exact"
      ? LinkIcon
      : owner.confidence === "crosswalk"
        ? Route
        : AlertTriangle;
  const label =
    owner.confidence === "exact"
      ? "Exact owner"
      : owner.confidence === "crosswalk"
        ? "Mapped owner"
        : "Origin unresolved";
  return (
    <span
      title={owner.reason ?? undefined}
      aria-label={owner.reason ? `${label}: ${owner.reason}` : label}
      className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-md border border-edge px-2 font-mono text-[11px] ${
        owner.confidence === "unresolved" ? "text-warning" : "text-text-secondary"
      }`}
    >
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

function OwnerCard({ reference }: { reference: RecordReference }) {
  const owner = resolveRecordOwner(reference);
  return (
    <section className="flex flex-col gap-2 border-y border-edge py-4" aria-label="Owning context">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
        This record&apos;s home
      </p>
      <p className="text-sm font-medium text-text">{owner.ownerLabel}</p>
      <div className="flex flex-wrap items-center gap-2">
        {owner.ownerHref && (
          <Link
            to={owner.ownerHref}
            className="motion-state inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Open owning context
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        )}
        <ConfidenceChip reference={reference} />
      </div>
      {owner.confidence === "unresolved" && (
        <p className="honesty-note text-[11px] text-text-secondary">
          {HONESTY_COPY.unresolvedOwner}
        </p>
      )}
    </section>
  );
}

function ReferenceHeader({ reference }: { reference: RecordReference }) {
  return (
    <header className="flex flex-col gap-2 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <RecordTypeEyebrow recordType={reference.recordType} />
        {reference.status && <StatusMark status={reference.status} />}
      </div>
      <h1 tabIndex={-1} className="text-lg font-semibold text-text focus:outline-none">
        {reference.title}
      </h1>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-text-muted">
        <span className="break-all">{reference.id}</span>
        <time dateTime={new Date(reference.createdAt).toISOString()}>
          {new Date(reference.createdAt).toLocaleString()}
        </time>
      </div>
    </header>
  );
}

function ReferenceSummary({ reference }: { reference: RecordReference }) {
  return (
    <section className="flex flex-col gap-2 py-4">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
        Reference summary
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-text-muted">Models</dt>
        <dd className="min-w-0 break-words font-mono text-text-secondary">
          {reference.modelKeys.length > 0 ? reference.modelKeys.join(" · ") : "Not recorded here"}
        </dd>
        <dt className="text-text-muted">Mode</dt>
        <dd className="text-text-secondary">{reference.mode ?? "Owned by source context"}</dd>
        <dt className="text-text-muted">Updated</dt>
        <dd className="font-mono tabular-nums text-text-secondary">
          {new Date(reference.updatedAt).toLocaleString()}
        </dd>
      </dl>
      <p className="honesty-note text-[11px] text-text-secondary">
        {HONESTY_COPY.referenceMeaning}
      </p>
    </section>
  );
}

function BeneathList({
  reference,
  records,
  policyChildren,
}: {
  reference: RecordReference;
  records: RecordReference[];
  policyChildren: PolicyStudyChildren | null;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-edge py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
          Beneath this record
        </h2>
        {reference.recordType === "policy-study" && policyChildren && (
          <p className="font-mono text-xs tabular-nums text-text-muted">
            {policyChildren.trialCount} trials · {policyChildren.observationCount} observations ·{" "}
            {policyChildren.exactRunCount} exact runs
          </p>
        )}
      </div>
      {records.length > 0 ? (
        <ul className="flex flex-col gap-1" role="list">
          {records.map((child) => (
            <li key={`${child.recordType}:${child.id}`}>
              <RecordTypeRow reference={child} compact />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">No exact child records are available.</p>
      )}
    </section>
  );
}

function SemanticReferenceDetail({
  reference,
  childRecords,
  policyChildren,
}: {
  reference:
    | EvaluationExecutionReference
    | PolicyStudyReference
    | Extract<RecordReference, { recordType: "comparison" }>;
  childRecords: RecordReference[];
  policyChildren: PolicyStudyChildren | null;
}) {
  return (
    <div data-record-detail={reference.recordType} className="flex flex-col p-4 text-sm">
      <ReferenceHeader reference={reference} />
      <OwnerCard reference={reference} />
      <ReferenceSummary reference={reference} />
      <BeneathList reference={reference} records={childRecords} policyChildren={policyChildren} />
      <div className="flex flex-wrap gap-2 border-t border-edge py-4">
        <CopyLinkButton href={recordDetailHref(reference)} subject="record" />
      </div>
    </div>
  );
}

function ObservationDetail({
  reference,
  observation,
}: {
  reference: RecordReference;
  observation: Observation;
}) {
  return (
    <div data-record-detail="observation" className="flex flex-col p-4 text-sm">
      <ReferenceHeader reference={reference} />
      <OwnerCard reference={reference} />
      <section className="flex flex-col gap-2 py-4">
        <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
          Exact source references
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/records/task-execution/${encodeURIComponent(observation.runId)}`}
            className="motion-state inline-flex min-h-[44px] items-center rounded-md border border-edge px-3 font-mono text-xs text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Run {observation.runId}
          </Link>
          <span className="inline-flex min-h-[44px] items-center rounded-md border border-edge px-3 font-mono text-xs text-text-secondary">
            Attempt {observation.candidateAttemptId}
          </span>
          <span className="inline-flex min-h-[44px] items-center rounded-md border border-edge px-3 font-mono text-xs text-text-secondary">
            Assessment {observation.assessmentRef.judgeAttemptId}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-text-muted">Task</dt>
          <dd className="break-all font-mono text-text-secondary">
            {observation.taskId}@{observation.taskVersion}
          </dd>
          <dt className="text-text-muted">Model configuration</dt>
          <dd className="break-all font-mono text-text-secondary">
            {observation.modelConfigurationId}
          </dd>
          <dt className="text-text-muted">Judge accepted</dt>
          <dd className="text-text-secondary">
            {observation.outcome.judgeAccepted ? "Yes" : "No"}
          </dd>
          <dt className="text-text-muted">Verifier</dt>
          <dd className="text-text-secondary">
            {observation.outcome.verifierPassed === null
              ? "Not declared"
              : observation.outcome.verifierPassed
                ? "Passed"
                : "Failed"}
          </dd>
        </dl>
      </section>
      <div className="flex flex-wrap gap-2 border-t border-edge py-4">
        <CopyLinkButton href={recordDetailHref(reference)} subject="record" />
      </div>
    </div>
  );
}

export function RecordDetail({
  repository,
  recordType,
  recordId,
  focusCandidateId,
  focusJudgeAttemptId,
  onOpenInCompare,
}: {
  repository: RecordsRepository | null;
  recordType: RecordType;
  recordId: string;
  focusCandidateId?: string | null;
  focusJudgeAttemptId?: string | null;
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  const [state, setState] = useState(INITIAL_STATE);

  useEffect(() => {
    let active = true;
    setState(INITIAL_STATE);
    if (!repository) {
      setState({ ...INITIAL_STATE, loading: false, error: "Records storage is unavailable." });
      return () => {
        active = false;
      };
    }
    void (async () => {
      const reference = await repository.getReference(recordType, recordId);
      if (!reference) return { ...INITIAL_STATE, loading: false };
      let observation: Observation | null = null;
      let policyChildren: PolicyStudyChildren | null = null;
      let childRecords: RecordReference[] = [];
      if (reference.recordType === "observation") {
        observation = await repository.getObservation(reference.id);
      } else if (reference.recordType === "comparison") {
        const page = await repository.list({
          type: "task-execution",
          text: reference.runId,
          limit: 50,
        });
        childRecords = page.items.filter((item) => item.id === reference.runId);
      } else if (reference.recordType === "evaluation") {
        const page = await repository.list({ type: "task-execution", limit: 500 });
        const ids = new Set(reference.childRunIds);
        childRecords = page.items.filter((item) => ids.has(item.id)).slice(0, 20);
      } else if (reference.recordType === "policy-study") {
        policyChildren = await repository.getPolicyStudyChildren(reference.id);
        childRecords = policyChildren.items;
      }
      return { reference, observation, policyChildren, childRecords, loading: false, error: null };
    })()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setState({
          ...INITIAL_STATE,
          loading: false,
          error: reason instanceof Error ? reason.message : "Unknown storage error",
        });
      });
    return () => {
      active = false;
    };
  }, [repository, recordType, recordId]);

  useEffect(() => {
    if (!state.loading) document.querySelector<HTMLElement>("[data-record-detail] h1")?.focus();
  }, [state.loading, recordId]);

  if (state.loading) {
    return (
      <div
        className="flex flex-col gap-3 p-4"
        aria-label={`Loading ${recordType} record ${recordId}`}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          {recordType} · <span className="break-all">{recordId}</span>
        </p>
        <div className="animate-pulse-ease h-7 w-2/3 rounded-md bg-raised opacity-60" />
        <div className="animate-pulse-ease h-28 rounded-md border border-edge bg-raised opacity-60" />
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <AlertTriangle size={18} className="text-error" aria-hidden="true" />
        <h1 tabIndex={-1} className="text-lg font-semibold text-text focus:outline-none">
          Failed to load record.
        </h1>
        <p className="text-sm text-text-muted">{state.error}</p>
      </div>
    );
  }
  if (!state.reference) return <RecordNotFound recordType={recordType} id={recordId} />;

  if (state.reference.recordType === "task-execution") {
    return (
      <TaskExecutionDetail
        repository={repository!}
        reference={state.reference}
        focusCandidateId={focusCandidateId}
        focusJudgeAttemptId={focusJudgeAttemptId}
        onOpenInCompare={onOpenInCompare}
      />
    );
  }
  if (state.reference.recordType === "legacy") {
    return <LegacyDetail repository={repository!} reference={state.reference} />;
  }
  if (state.reference.recordType === "observation") {
    return state.observation ? (
      <ObservationDetail reference={state.reference} observation={state.observation} />
    ) : (
      <RecordNotFound recordType="observation" id={recordId} />
    );
  }
  return (
    <SemanticReferenceDetail
      reference={state.reference}
      childRecords={state.childRecords}
      policyChildren={state.policyChildren}
    />
  );
}

function TaskExecutionDetail({
  repository,
  reference,
  focusCandidateId,
  focusJudgeAttemptId,
  onOpenInCompare,
}: {
  repository: RecordsRepository;
  reference: Extract<RecordReference, { recordType: "task-execution" }>;
  focusCandidateId?: string | null;
  focusJudgeAttemptId?: string | null;
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  const [record, setRecord] = useState<RunRecordV2 | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void repository.getTaskExecution(reference.id).then((value) => {
      if (!active) return;
      setRecord(value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [repository, reference.id]);
  // Route-focus contract (Child 08 spec §P): after the exact detail mounts,
  // focus its heading — unless a candidate/attempt deep link owns the focus
  // (RunDetail focuses the linked candidate row itself).
  const deepLinkFocus = focusCandidateId != null || focusJudgeAttemptId != null;
  useEffect(() => {
    if (loading || !record || deepLinkFocus) return;
    document.querySelector<HTMLElement>("[data-run-detail] [data-detail-heading]")?.focus();
  }, [loading, record, deepLinkFocus, reference.id]);
  if (loading) {
    return <div className="animate-pulse-ease m-4 h-28 rounded-md bg-raised opacity-60" />;
  }
  if (!record) return <RecordNotFound recordType="task-execution" id={reference.id} />;
  return (
    <RunDetail
      record={record}
      focusCandidateId={focusCandidateId}
      focusJudgeAttemptId={focusJudgeAttemptId}
      onOpenInCompare={onOpenInCompare}
      copyHref={recordDetailHref(reference)}
    />
  );
}

function LegacyDetail({
  repository,
  reference,
}: {
  repository: RecordsRepository;
  reference: Extract<RecordReference, { recordType: "legacy" }>;
}) {
  const [summary, setSummary] = useState<LegacyRunSummary | null>(null);
  useEffect(() => {
    let active = true;
    void repository.getLegacySummary(reference.id).then((value) => {
      if (active) setSummary(value);
    });
    return () => {
      active = false;
    };
  }, [repository, reference.id]);
  return summary ? (
    <LegacyRunDetail
      summary={summary}
      copyHref={recordDetailHref(reference)}
      backHref="/records"
      backLabel="Back to Records"
    />
  ) : (
    <RecordNotFound recordType="legacy" id={reference.id} />
  );
}
