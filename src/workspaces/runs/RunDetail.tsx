// =============================================================================
// RunDetail — full run record detail view (spec §8.3).
//
// Renders vertically in semantic section order, separated by hairline
// dividers (border-driven rhythm, transplant map §F):
//   1. Header: source/status/mode chips, title, exact timestamps, timezone
//   2. Status timeline: derived lifecycle summary (existing timestamps only)
//   3. Provenance trail (experiment-sourced only)
//   4. Outcome: all winners, model scores, coverage, failures
//   5. Cost breakdown: incremental stage cards (existing data, visual cards)
//   6. Candidate selector: compact rows with model/provider/score/blind label
//   7. Selected candidate output: full text, timing, tokens, judge explanation
//   8. Judge evidence: accepted attempt, rationale, blind-label mapping
//   9. Fusion evidence (when present)
//  10. Task/configuration (collapsed by default)
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import {
  rankValueFromResults,
  rankScoreOf,
  isFloored,
} from "../../lib/evaluations/evaluation-rubric";
import { inputUsageLabel } from "../../lib/cost";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { formatRunDetail, formatRelativeTime, type DetailSection } from "./run-view-model";
import { Markdown } from "../../ui/Markdown";
import { runConfigFromRecord, type RunConfigPreload } from "../../lib/runs/run-config-preload";
import { CopyLinkButton } from "./CopyLinkButton";

export function RunDetail({
  record,
  focusCandidateId,
  focusJudgeAttemptId,
  onOpenInCompare,
}: {
  record: RunRecordV2 | null;
  /** Deep-linked immutable candidate id (`?candidate=`). When present and
   *  valid, the candidate is selected, scrolled to, and focused. */
  focusCandidateId?: string | null;
  /** Deep-linked judge attempt id (`?attempt=`). When present and valid, the
   *  matching judge attempt is highlighted and labeled. */
  focusJudgeAttemptId?: string | null;
  /** Run Detail → Open in Compare (Slice 5). Optional; wired by the root
   *  shell, omitted in route-only test renders. */
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  const vm = formatRunDetail(record);

  if (!vm || !record) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-text-secondary">Run not found.</p>
        <Link
          to="/runs"
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
        >
          Back to Runs
        </Link>
      </div>
    );
  }

  // Invalid deep links degrade to a compact, non-blocking notice; the run
  // overview renders normally (spec §8.3).
  const candidateMissing =
    focusCandidateId != null && !record.candidates.some((c) => c.candidateId === focusCandidateId);
  const attemptMissing =
    focusJudgeAttemptId != null &&
    !record.judge.attempts.some((a) => a.attemptId === focusJudgeAttemptId);

  return (
    <div data-run-detail="" className="flex flex-1 flex-col overflow-y-auto p-4 text-sm">
      {candidateMissing && (
        <p data-focus-notice="candidate" className="text-sm text-text-secondary">
          Linked candidate not found — showing run overview.
        </p>
      )}
      {attemptMissing && (
        <p data-focus-notice="attempt" className="text-sm text-text-secondary">
          Linked judge attempt not found — showing run overview.
        </p>
      )}
      {/* Border-driven section separators (transplant map §F1): hairline
          divides replace bare gaps so the detail reads as one document with
          deliberate rhythm, not floating cards. */}
      <div className="flex flex-col divide-y divide-edge">
        {vm.sections.map((section) => {
          switch (section.id) {
            case "header":
              return (
                <HeaderSection
                  key="header"
                  section={section}
                  record={record}
                  onOpenInCompare={onOpenInCompare}
                />
              );
            case "timeline":
              return <TimelineSection key="timeline" record={record} />;
            case "provenance":
              return <ProvenanceSection key="provenance" section={section} />;
            case "outcome":
              return <OutcomeSection key="outcome" section={section} record={record} />;
            case "cost-breakdown":
              return <CostBreakdownSection key="cost-breakdown" section={section} />;
            case "candidates":
              return (
                <CandidatesSection
                  key="candidates"
                  section={section}
                  record={record}
                  focusCandidateId={focusCandidateId}
                />
              );
            case "selected-candidate":
              return null; // handled inside CandidatesSection
            case "judge":
              return (
                <JudgeSection
                  key="judge"
                  record={record}
                  focusJudgeAttemptId={focusJudgeAttemptId}
                />
              );
            case "fusion":
              return <FusionSection key="fusion" record={record} />;
            case "task-config":
              return <TaskConfigSection key="task-config" section={section} />;
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}

// --- Section components -------------------------------------------------------

function HeaderSection({
  section,
  record,
  onOpenInCompare,
}: {
  section: {
    title?: string;
    status?: string;
    timestamp?: string;
    relativeTime?: string;
    startedRelativeTime?: string;
    timeZone?: string;
    startedAt?: number;
    completedAt?: number | null;
    completedTimestamp?: string;
    completionLabel?: "Completed" | "Ended";
    duration?: string;
    runningDuration?: string;
    source?: string;
  };
  record: RunRecordV2;
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}) {
  const startedAt = section.startedAt ?? record.createdAt;
  const hasCompletion = section.completedAt !== null && section.completedAt !== undefined;
  return (
    <header data-section="header" className="flex flex-col gap-2 py-4">
      {/* Identity row: source chip, status, mode (prototype detail-header
          grouping — the status/source/mode metadata leads, timestamps follow
          below as a single meta line). */}
      <div className="flex flex-wrap items-center gap-2">
        <SourceChip label={section.source ?? "ad hoc"} />
        <StatusMark status={record.status as StatusMarkStatus} />
        <span className="shrink-0 rounded-sm border border-edge px-1.5 py-px font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] text-text-secondary">
          {record.mode}
        </span>
      </div>
      <h2 className="text-lg font-semibold leading-snug text-text">
        {section.title ?? record.task.title}
      </h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
        <span>
          Started{" "}
          <time
            data-time="started"
            dateTime={new Date(startedAt).toISOString()}
            className="tabular-nums"
          >
            {section.timestamp}
          </time>
          {section.startedRelativeTime ? ` (${section.startedRelativeTime})` : ""}
        </span>
        {hasCompletion && section.completedTimestamp && section.completionLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {section.completionLabel}{" "}
              <time
                data-time="completed"
                dateTime={new Date(section.completedAt!).toISOString()}
                className="tabular-nums"
              >
                {section.completedTimestamp}
              </time>{" "}
              ({section.relativeTime})
            </span>
            {section.duration ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Duration {section.duration}</span>
              </>
            ) : null}
          </>
        ) : record.status === "running" && section.runningDuration ? (
          <>
            <span aria-hidden="true">·</span>
            <span>Running for {section.runningDuration}</span>
          </>
        ) : null}
        {section.timeZone ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{section.timeZone}</span>
          </>
        ) : null}
      </div>
      {/* Contextual continuity actions (Slice 5): open the run's frozen
        config in Compare (honest S-class preload — never copies results or
        fabricates lineage) and copy the deep link. */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onOpenInCompare && (
          <button
            type="button"
            data-action="open-in-compare"
            onClick={() => onOpenInCompare(record.id, runConfigFromRecord(record))}
            className="pressable flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Open in Compare
          </button>
        )}
        <CopyLinkButton />
      </div>
    </header>
  );
}

// --- Timeline -----------------------------------------------------------------

type TimelineState = "done" | "warn" | "error" | "running" | "muted";

const TL_DOT_CLASSES: Record<TimelineState, string> = {
  done: "bg-success",
  warn: "bg-warning",
  error: "bg-error",
  running: "bg-accent animate-pulse",
  muted: "bg-text-muted",
};

interface TimelineStep {
  label: string;
  detail: string;
  state: TimelineState;
}

/** A fusion stage has a valid accepted result only when an accepted attempt
 * pointer exists AND the referenced attempt actually completed with a
 * non-null result. `fusion.status === "done"` alone is not sufficient — a
 * re-fuse that fails after a prior success sets `fusion.status = "error"`
 * but leaves the prior accepted pointer intact, and a corrupted/inconsistent
 * `done` without an accepted result must not claim fusion succeeded
 * (transplant map §F1, evidence-based). */
function hasValidAcceptedFusion(record: RunRecordV2): boolean {
  if (!record.fusion.acceptedAttemptId) return false;
  const attempt = record.fusion.attempts.find(
    (a) => a.attemptId === record.fusion.acceptedAttemptId,
  );
  return attempt !== undefined && attempt.status === "completed" && attempt.result !== null;
}

/** Lifecycle summary derived strictly from persisted record fields — never
 * fabricated (transplant map §F1, prototype "Status timeline"). Accepted
 * attempts are done; only explicit terminal attempt failures count as errors.
 * Candidates that have not settled yet remain pending instead of being
 * mislabeled as failures while a run is active. */
export function buildTimeline(record: RunRecordV2): TimelineStep[] {
  const total = record.candidates.length;
  const done = record.candidates.filter((c) => c.acceptedAttemptId != null).length;
  // Only an explicit terminal `failed` attempt is a candidate error. Aborted
  // / interrupted attempts are stoppages, not failures — counted separately so
  // the timeline never blames a candidate for a global abort/interrupt.
  const failed = record.candidates.filter((candidate) => {
    if (candidate.acceptedAttemptId != null) return false;
    const latest = candidate.attempts[candidate.attempts.length - 1];
    return latest?.status === "failed";
  }).length;
  const stopped = record.candidates.filter((candidate) => {
    if (candidate.acceptedAttemptId != null) return false;
    const latest = candidate.attempts[candidate.attempts.length - 1];
    return latest?.status === "aborted" || latest?.status === "interrupted";
  }).length;
  const unsettled = Math.max(0, total - done - failed - stopped);
  // On a terminal aborted/interrupted record, candidates that never settled
  // are `not completed` (the run will not resume); on an active run they
  // remain `pending`. An absent accepted attempt is never itself a failure.
  const globalStopped = record.status === "aborted" || record.status === "interrupted";
  const candidateDetail = [
    `${done}/${total} done`,
    failed > 0 ? `${failed} error${failed === 1 ? "" : "s"}` : null,
    stopped > 0 ? `${stopped} stopped` : null,
    unsettled > 0 ? (globalStopped ? `${unsettled} not completed` : `${unsettled} pending`) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const steps: TimelineStep[] = [
    { label: "Created", detail: formatRelativeTime(record.createdAt), state: "done" },
    {
      label: "Candidates",
      detail: candidateDetail,
      state:
        record.status === "running"
          ? "running"
          : failed > 0 || stopped > 0 || unsettled > 0
            ? "warn"
            : "done",
    },
  ];
  const judgeStatus = record.judge.status;
  // A stage left `running` by applyAborted/applyInterrupted is not actually
  // running on a terminal record — render the global stop wording instead.
  const judgeRunningStopped = judgeStatus === "running" && globalStopped;
  const judgeDetail =
    judgeStatus === "done"
      ? "accepted"
      : judgeStatus === "error"
        ? "failed"
        : judgeRunningStopped
          ? record.status === "aborted"
            ? "aborted"
            : "interrupted"
          : judgeStatus === "running"
            ? "running"
            : // "pending" implies the judge may still run; on a terminal run
              // an idle judge never ran at all (transplant map §F1 — derived
              // strictly from persisted fields, never fabricated).
              record.status === "running"
              ? "pending"
              : "not run";
  const judgeState: TimelineState = judgeRunningStopped
    ? "warn"
    : judgeStatus === "done"
      ? "done"
      : judgeStatus === "error"
        ? "error"
        : judgeStatus === "running"
          ? "running"
          : "muted";
  steps.push({ label: "Judge", detail: judgeDetail, state: judgeState });
  let result: TimelineStep;
  // Global aborted/interrupted is terminal and takes precedence over any
  // stage-running Result wording (a stopped run is not pending or fusing).
  if (record.status === "aborted") {
    result = { label: "Result", detail: "aborted by user", state: "warn" };
  } else if (record.status === "interrupted") {
    result = { label: "Result", detail: "stopped mid-run", state: "warn" };
  } else if (record.mode === "fuse" && record.fusion.status === "running") {
    // A post-run Re-fuse keeps the run's accepted terminal status
    // (completed/partial) per deriveStatus, but the fusion stage is actively
    // running — surface the live stage before any terminal Result wording
    // (transplant map §F1, evidence-based).
    result = { label: "Result", detail: "fusion running", state: "running" };
  } else if (record.mode === "fuse" && hasValidAcceptedFusion(record)) {
    // A valid previously accepted fusion result exists — truthfully show
    // "fused" even if the latest re-fuse failed (fusion.status === "error").
    // The accepted attempt is the evidence; fusion.status alone is not
    // authoritative when a re-fuse has errored after a prior success
    // (transplant map §F1, evidence-based).
    result = { label: "Result", detail: "fused", state: "done" };
  } else if (record.mode === "fuse" && record.fusion.status === "error") {
    // No valid accepted fusion result and the latest fusion attempt errored.
    result = { label: "Result", detail: "no result - fusion failed", state: "error" };
  } else if (record.mode === "rank" && record.winnerKeys.length > 0) {
    result = { label: "Result", detail: "ranked - winner set", state: "done" };
  } else if (record.status === "failed") {
    // Only an errored Judge actually "failed". An idle Judge never ran, so the
    // run failed before judging (insufficient candidates / fanout); never
    // invent a Judge failure the persisted record does not support.
    result =
      record.judge.status === "error"
        ? { label: "Result", detail: "no result - judge failed", state: "error" }
        : { label: "Result", detail: "no result - failed before judging", state: "error" };
  } else if (record.status === "partial") {
    // A partial Fuse run whose fusion is neither done nor errored has an
    // incomplete fusion stage — do not blame candidates for that. The explicit
    // fusion-error wording is retained by the fusion.status === "error" branch
    // above.
    if (
      record.mode === "fuse" &&
      record.fusion.status !== "done" &&
      record.fusion.status !== "error"
    ) {
      result = { label: "Result", detail: "no result - fusion incomplete", state: "warn" };
    } else {
      result = { label: "Result", detail: "no result - candidate error", state: "warn" };
    }
  } else if (record.status === "running") {
    result = { label: "Result", detail: "pending", state: "running" };
  } else if (record.status === "completed") {
    // Terminal completed Rank run without a winner set — completed, not
    // pending. Wording reflects persisted completion and the absence of a
    // winner; no failure source is invented.
    result = { label: "Result", detail: "completed - no winner", state: "warn" };
  } else {
    result = { label: "Result", detail: "pending", state: "muted" };
  }
  steps.push(result);
  return steps;
}

function TimelineSection({ record }: { record: RunRecordV2 }) {
  const steps = buildTimeline(record);
  return (
    <section data-section="timeline" className="flex flex-col gap-2 py-4">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">
        Status timeline
      </h3>
      <ol className="flex flex-wrap items-start gap-x-5 gap-y-2" role="list">
        {steps.map((step) => (
          <li key={step.label} className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${TL_DOT_CLASSES[step.state]}`}
              />
              <span className="text-xs font-semibold text-text-secondary">{step.label}</span>
            </span>
            <span className="font-mono text-[10px] text-text-muted">{step.detail}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// --- Source chip ---------------------------------------------------------------

/** Per-source tint classes, mirroring RunList's Slice 2 chip (transplant map
 *  §D3/§F1): ad hoc = accent cyan, experiment = warning amber, fallback muted. */
const SOURCE_CHIP_CLASSES: Record<string, string> = {
  "ad hoc": "bg-accent/10 text-accent",
  experiment: "bg-warning/10 text-warning",
  legacy: "bg-white/[0.06] text-text-muted",
};

function SourceChip({ label }: { label: string }) {
  const cls = SOURCE_CHIP_CLASSES[label] ?? "bg-white/[0.06] text-text-muted";
  return (
    <span
      className={`shrink-0 rounded-sm px-1.5 py-px font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.05em] ${cls}`}
    >
      {label}
    </span>
  );
}

function ProvenanceSection({ section }: { section: Record<string, unknown> }) {
  const experimentId = section.experimentId as string;
  const suiteId = section.suiteId as string;
  const suiteVersion = section.suiteVersion as number;
  const taskId = section.taskId as string;
  const attemptId = section.experimentTaskAttemptId as string;
  const linkCls =
    "inline-flex min-h-[44px] items-center rounded-sm px-1 text-accent transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const boundAttempt = attemptId.length > 8;
  return (
    <nav
      data-section="provenance"
      aria-label="Experiment provenance"
      className="flex flex-wrap items-center gap-1.5 py-4 text-sm"
    >
      <Link to={`/evaluations/results/${experimentId}`} className={linkCls}>
        Evaluation
      </Link>
      <span className="text-text-muted">·</span>
      <Link to={`/evaluations/sets/${suiteId}`} className={linkCls}>
        Task Set v{suiteVersion}
      </Link>
      <span className="text-text-muted">·</span>
      <span className="inline-flex min-h-[44px] items-center font-mono text-text-secondary">
        {taskId}
      </span>
      <span className="text-text-muted">·</span>
      <span className="inline-flex min-h-[44px] items-center font-mono text-text-secondary tabular-nums">
        {boundAttempt ? `${attemptId.slice(0, 8)}…` : attemptId}
        <span className="sr-only">{attemptId}</span>
      </span>
      <Link to={`/evaluations/results/${experimentId}`} className={`${linkCls} ml-auto`}>
        Back to evaluation
      </Link>
    </nav>
  );
}

function OutcomeSection({
  section,
  record,
}: {
  section: { winners?: string[]; modelCount?: number };
  record: RunRecordV2;
}) {
  const winners = section.winners ?? record.winnerKeys;
  return (
    <section data-section="outcome" className="flex flex-col gap-2 py-4">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Outcome</h3>
      {winners.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-secondary">Winners:</span>
          {winners.map((w) => (
            <span
              key={w}
              className="rounded-md border border-edge bg-panel px-2 py-1 font-mono text-sm text-text"
            >
              {w}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted">No winners recorded.</p>
      )}
      <div className="flex flex-wrap gap-3 text-sm text-text-muted">
        <span>{record.candidates.length} candidates</span>
      </div>
    </section>
  );
}

function CandidatesSection({
  record,
  focusCandidateId,
}: {
  section: unknown;
  record: RunRecordV2;
  focusCandidateId?: string | null;
}) {
  const focusExists =
    focusCandidateId != null && record.candidates.some((c) => c.candidateId === focusCandidateId);
  const [selectedId, setSelectedId] = useState<string | null>(
    focusExists ? focusCandidateId : (record.candidates[0]?.candidateId ?? null),
  );
  const listRef = useRef<HTMLUListElement | null>(null);

  // Deep link: the focused candidate wins selection on mount / record change,
  // overriding the default first-candidate selection (spec §8.3).
  useEffect(() => {
    if (focusExists && focusCandidateId != null) {
      setSelectedId(focusCandidateId);
    }
  }, [focusCandidateId, focusExists]);

  // Scroll + focus the linked candidate row button.
  useEffect(() => {
    if (!focusExists || focusCandidateId == null) return;
    const list = listRef.current;
    if (!list) return;
    const el = [...list.querySelectorAll<HTMLElement>("[data-candidate-id]")].find(
      (n) => n.getAttribute("data-candidate-id") === focusCandidateId,
    );
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    el.focus();
  }, [focusCandidateId, focusExists, record.id]);

  const selected = record.candidates.find((c) => c.candidateId === selectedId);
  const acceptedAttempt = selected?.acceptedAttemptId
    ? selected.attempts.find((a) => a.attemptId === selected.acceptedAttemptId)
    : null;

  // Build blind-label map from accepted judge attempt
  const blindMap = getBlindLabelMap(record);

  return (
    <section data-section="candidates" className="flex flex-col gap-2 py-4">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Candidates</h3>
      <ul className="flex flex-col gap-1" role="list" ref={listRef}>
        {record.candidates.map((c) => {
          const accepted = c.acceptedAttemptId
            ? c.attempts.find((a) => a.attemptId === c.acceptedAttemptId)
            : null;
          const reusedFrom = accepted?.reusedFrom ?? null;
          const isSelected = c.candidateId === selectedId;
          return (
            <li key={c.candidateId}>
              <button
                type="button"
                data-candidate-id={c.candidateId}
                onClick={() => setSelectedId(c.candidateId)}
                aria-pressed={isSelected}
                className={`flex min-h-[44px] w-full flex-wrap items-center gap-2 rounded-md border bg-panel px-3 py-2 text-left text-sm transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isSelected
                    ? "border-accent/60 bg-raised ring-1 ring-inset ring-accent/30 hover:border-accent/60"
                    : "border-edge hover:border-edge-bright"
                }`}
              >
                {/* Non-interactive: this label sits inside the row <button>; a nested
                disclosure button would be invalid DOM nesting. */}
                <CompactModelLabel providerId={c.providerId} slug={c.slug} interactive={false} />
                {blindMap[c.candidateId] && (
                  <span className="rounded-md border border-edge px-1.5 py-0.5 font-mono text-xs text-text-muted">
                    Label: {blindMap[c.candidateId]}
                  </span>
                )}
                <span className="ml-auto text-text-muted tabular-nums">
                  {c.attempts.length} attempt{c.attempts.length === 1 ? "" : "s"}
                </span>
              </button>
              {reusedFrom ? (
                <p
                  data-reused-from=""
                  className="flex min-h-[44px] min-w-0 items-center gap-2 px-2 text-xs"
                >
                  <span className="text-text-muted">Reused from prior attempt</span>
                  <Link
                    to={`/runs/${reusedFrom.sourceRunId}`}
                    className="inline-flex min-h-[44px] items-center text-accent transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    View source run
                  </Link>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {/* Selected candidate output */}
      {selected && acceptedAttempt && (
        <div
          data-section="selected-candidate"
          className="rounded-md border border-edge border-l-2 border-l-accent bg-panel p-3"
        >
          <p className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-accent">
            Selected candidate
          </p>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-sm text-text">{selected.modelKey}</span>
            {blindMap[selected.candidateId] && (
              <span className="text-sm text-text-muted">
                (Candidate {blindMap[selected.candidateId]} during judging)
              </span>
            )}
          </div>
          <div className="mb-2 flex flex-wrap gap-3 text-xs text-text-muted tabular-nums">
            <span data-input-usage="">
              {inputUsageLabel(acceptedAttempt.inputEstimate, acceptedAttempt.tokensIn)}
            </span>
            {acceptedAttempt.tokensOut != null && <span>Out: {acceptedAttempt.tokensOut}</span>}
            {acceptedAttempt.finishedAt != null && acceptedAttempt.startedAt != null && (
              <span>
                Latency:{" "}
                {Math.round((acceptedAttempt.finishedAt - acceptedAttempt.startedAt) / 1000)}s
              </span>
            )}
            {acceptedAttempt.cost?.usd != null && Number.isFinite(acceptedAttempt.cost.usd) && (
              <span data-cost-source={acceptedAttempt.cost.source}>
                Cost: ${acceptedAttempt.cost.usd.toFixed(6)} ({acceptedAttempt.cost.source})
              </span>
            )}
          </div>
          {acceptedAttempt.output && (
            <div className="prose prose-invert max-w-none text-sm">
              <Markdown text={acceptedAttempt.output} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function JudgeAttemptPanel({
  attempt,
  highlighted,
  historical,
}: {
  attempt: RunRecordV2["judge"]["attempts"][number];
  highlighted: boolean;
  historical: boolean;
}) {
  return (
    <div
      data-judge-attempt={attempt.attemptId}
      className={`rounded-md border border-edge bg-panel p-3${highlighted ? " ring-1 ring-accent" : ""}`}
    >
      {highlighted && <p className="mb-1 text-xs text-accent">Selected attempt</p>}
      {historical && (
        <p className="mb-1 text-xs text-text-secondary">
          Historical attempt — accepted summary unchanged
        </p>
      )}
      <div className="mb-2 flex items-center gap-2 text-sm">
        <CompactModelLabel providerId={attempt.providerId} slug={attempt.model} />
        <span className="text-text-muted">·</span>
        <span className="text-text-muted">Attempt {attempt.attemptId.slice(0, 8)}</span>
      </div>
      <p data-input-usage="" className="mb-2 text-xs text-text-muted tabular-nums">
        {inputUsageLabel(attempt.inputEstimate, attempt.usage?.inputTokens)}
      </p>
      {/* Blind-label mapping — persisted mapping only, never recomputed */}
      <div className="mb-2 flex flex-wrap gap-2 text-sm">
        <span className="text-text-muted">Blind-label mapping:</span>
        {Object.entries(attempt.blindLabelToCandidateId).map(([label, cid]) => (
          <span
            key={label}
            className="rounded-md border border-edge px-1.5 py-0.5 font-mono text-xs text-text-secondary"
          >
            {label} → {cid}
          </span>
        ))}
      </div>
      {attempt.instruction && <p className="text-sm text-text-secondary">{attempt.instruction}</p>}
    </div>
  );
}

function JudgeSection({
  record,
  focusJudgeAttemptId,
}: {
  record: RunRecordV2;
  focusJudgeAttemptId?: string | null;
}) {
  const acceptedAttempt = record.judge.acceptedAttemptId
    ? record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId)
    : null;
  // A deep-linked judge attempt is highlighted and explicitly labeled. When it
  // is not the accepted attempt, it renders as a separate historical panel —
  // accepted summary semantics are never overwritten (spec §12.1).
  const focusedAttempt = focusJudgeAttemptId
    ? (record.judge.attempts.find((a) => a.attemptId === focusJudgeAttemptId) ?? null)
    : null;
  const historicalAttempt =
    focusedAttempt && focusedAttempt.attemptId !== record.judge.acceptedAttemptId
      ? focusedAttempt
      : null;

  return (
    <section data-section="judge" className="flex flex-col gap-2 py-4">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">
        Judge Evidence
      </h3>
      {acceptedAttempt ? (
        <>
          <JudgeAttemptPanel
            attempt={acceptedAttempt}
            highlighted={focusedAttempt?.attemptId === acceptedAttempt.attemptId}
            historical={false}
          />
          {/* Judge report evaluations */}
          {record.judge.report && (
            <div className="rounded-md border border-edge bg-panel p-3">
              <h4 className="mb-2 text-sm text-text-secondary">Evaluations</h4>
              {Object.entries(record.judge.report.evaluationsById).map(([cid, ev]) => (
                <div key={cid} className="mb-2 border-t border-edge pt-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-text">{cid}</span>
                    <span className="rounded-md border border-edge px-1.5 py-0.5 text-xs text-text-muted">
                      Label: {ev.blindLabel}
                    </span>
                    <span className="ml-auto font-mono text-text tabular-nums">
                      {(() => {
                        const rubric = record.evaluation.profile;
                        if (rubric) {
                          const rv = rankValueFromResults(ev.criterionScores, rubric);
                          if (rv !== null) {
                            const rs = rankScoreOf(rv);
                            const floored = isFloored(rv);
                            return floored
                              ? `${rs?.toFixed(1)}* (${rv.toFixed(2)})`
                              : `${rs?.toFixed(1)}`;
                          }
                        }
                        return ev.overallScore.toFixed(1);
                      })()}
                    </span>
                  </div>
                  <p className="mt-1 text-text-secondary">{ev.rationale}</p>
                  {ev.strengths.length > 0 && (
                    <p className="mt-1 text-text-muted">Strengths: {ev.strengths.join(", ")}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-text-muted">No accepted Judge attempt.</p>
      )}
      {historicalAttempt && (
        <JudgeAttemptPanel attempt={historicalAttempt} highlighted historical />
      )}
    </section>
  );
}

function FusionSection({ record }: { record: RunRecordV2 }) {
  const accepted = record.fusion.acceptedAttemptId
    ? record.fusion.attempts.find((a) => a.attemptId === record.fusion.acceptedAttemptId)
    : null;

  return (
    <section data-section="fusion" className="flex flex-col gap-2 py-4">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">
        Fusion Result
      </h3>
      {accepted && accepted.result ? (
        <div className="rounded-md border border-edge bg-panel p-3">
          <div className="mb-2 text-sm text-text-muted">
            <CompactModelLabel providerId={accepted.providerId} slug={accepted.model} />
          </div>
          <p data-input-usage="" className="mb-2 text-xs text-text-muted tabular-nums">
            {inputUsageLabel(accepted.inputEstimate, accepted.usage?.inputTokens)}
          </p>
          <div className="prose prose-invert max-w-none text-sm">
            <Markdown text={accepted.result} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted">No accepted Fusion result.</p>
      )}
    </section>
  );
}

function CostBreakdownSection({ section }: { section: DetailSection }) {
  const stages = (section.stages ?? []) as { label: string; usd: number; source: string }[];
  const totalUsd = section.totalUsd as number | undefined;
  const unknown = section.unknown === true;
  return (
    <section data-section="cost-breakdown" className="flex min-w-0 flex-col gap-2 py-4">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Cost</h3>
      {stages.length === 0 && !unknown ? (
        <p className="text-sm text-text-muted">No cost data for this run.</p>
      ) : null}
      {stages.length > 0 ? (
        <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {stages.map((stage) => (
            <li
              key={stage.label}
              data-cost-source={stage.source}
              className="flex min-w-0 flex-col gap-1 rounded-md border border-edge bg-raised px-3 py-2"
            >
              <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.05em] text-text-muted">
                {stage.label}
              </span>
              <span className="font-mono text-sm font-semibold text-text tabular-nums">
                ${stage.usd.toFixed(6)}
              </span>
              <span className="text-[10px] text-text-muted">{stage.source}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {unknown ? (
        <p className="text-xs text-text-muted">Some accepted stages have Unknown cost.</p>
      ) : null}
      {totalUsd !== undefined && totalUsd > 0 ? (
        <p data-cost-total="" className="border-t border-edge pt-2 text-sm text-text">
          Incremental total:{" "}
          <span className="font-mono tabular-nums text-accent">${totalUsd.toFixed(6)}</span>
        </p>
      ) : null}
    </section>
  );
}

function TaskConfigSection({ section }: { section: DetailSection }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section data-section="task-config" className="flex flex-col gap-1 py-4">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex min-h-[44px] items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 text-left text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text"
      >
        <ChevronDown
          size={14}
          className={
            expanded
              ? "rotate-180 transition-transform duration-150"
              : "transition-transform duration-150"
          }
          aria-hidden="true"
        />
        Task & Configuration
      </button>
      {expanded && (
        <div className="rounded-md border border-edge bg-panel p-3 text-sm">
          <div className="mb-2">
            <span className="text-text-muted">Prompt: </span>
            <span className="text-text">{section.prompt as string}</span>
          </div>
          {(section.systemPrompt as string) && (
            <div className="mb-2">
              <span className="text-text-muted">System: </span>
              <span className="text-text">{section.systemPrompt as string}</span>
            </div>
          )}
          <div className="mb-2">
            <span className="text-text-muted">Temperature: </span>
            <span className="text-text tabular-nums">{section.temperature as number}</span>
          </div>
          {(section.modelRoster as string[] | undefined)?.length ? (
            <div>
              <span className="text-text-muted">Models: </span>
              <span className="font-mono text-text">
                {(section.modelRoster as string[]).join(", ")}
              </span>
            </div>
          ) : null}
          {section.reasoning ? (
            <div className="mt-2 border-t border-edge pt-2" data-reasoning-provenance="">
              <p className="mb-1 text-text-secondary">Reasoning policy</p>
              {Object.entries(section.reasoning.candidates).map(([modelKey, setting]) => (
                <p key={modelKey} className="font-mono text-xs text-text">
                  Candidate {modelKey}: requested {setting.requested} · effective{" "}
                  {setting.effective} · {setting.source}
                </p>
              ))}
              <p className="font-mono text-xs text-text">
                Judge: requested {section.reasoning.judge.requested} · effective{" "}
                {section.reasoning.judge.effective} · {section.reasoning.judge.source}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

// --- Helpers ------------------------------------------------------------------

function getBlindLabelMap(record: RunRecordV2): Record<string, string> {
  if (!record.judge.acceptedAttemptId) return {};
  const att = record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId);
  if (!att) return {};
  const inverted: Record<string, string> = {};
  for (const [label, candidateId] of Object.entries(att.blindLabelToCandidateId)) {
    inverted[candidateId] = label;
  }
  return inverted;
}
