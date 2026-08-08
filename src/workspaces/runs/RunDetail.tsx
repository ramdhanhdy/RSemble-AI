// =============================================================================
// RunDetail — full run record detail view (spec §8.3).
//
// Renders vertically in semantic section order:
//   1. Header: title, exact timestamp + timezone, relative time, status, source
//   2. Provenance trail (experiment-sourced only)
//   3. Outcome: all winners, model scores, coverage, failures
//   4. Candidate selector: compact rows with model/provider/score/blind label
//   5. Selected candidate output: full text, timing, tokens, judge explanation
//   6. Judge evidence: accepted attempt, rationale, blind-label mapping
//   7. Fusion evidence (when present)
//   8. Task/configuration (collapsed by default)
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import { rankValueFromResults, rankScoreOf, isFloored } from "../../lib/evaluations/evaluation-profile";
import { inputUsageLabel } from "../../lib/cost";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { formatRunDetail, type DetailSection } from "./run-view-model";
import { Markdown } from "../../ui/Markdown";

export function RunDetail({
  record,
  focusCandidateId,
  focusJudgeAttemptId,
}: {
  record: RunRecordV2 | null;
  /** Deep-linked immutable candidate id (`?candidate=`). When present and
   *  valid, the candidate is selected, scrolled to, and focused. */
  focusCandidateId?: string | null;
  /** Deep-linked judge attempt id (`?attempt=`). When present and valid, the
   *  matching judge attempt is highlighted and labeled. */
  focusJudgeAttemptId?: string | null;
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
    <div data-run-detail="" className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 text-sm">
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
      {vm.sections.map((section) => {
        switch (section.id) {
          case "header":
            return <HeaderSection key="header" section={section} record={record} />;
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
              <JudgeSection key="judge" record={record} focusJudgeAttemptId={focusJudgeAttemptId} />
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
  );
}

// --- Section components -------------------------------------------------------

function HeaderSection({
  section,
  record,
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
}) {
  const startedAt = section.startedAt ?? record.createdAt;
  const hasCompletion = section.completedAt !== null && section.completedAt !== undefined;
  return (
    <header data-section="header" className="flex flex-col gap-1">
      <h2 className="text-base font-semibold text-text">{section.title ?? record.task.title}</h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted">
        <StatusMark status={record.status as StatusMarkStatus} />
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
        <span aria-hidden="true">·</span>
        <span className="uppercase">{section.source}</span>
        <span aria-hidden="true">·</span>
        <span className="uppercase">{record.mode}</span>
      </div>
    </header>
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
      className="flex flex-wrap items-center gap-1.5 rounded-md border border-edge bg-panel px-3 py-2 text-sm"
    >
      <Link to={`/experiments/${experimentId}`} className={linkCls}>
        Experiment
      </Link>
      <span className="text-text-muted">·</span>
      <Link to={`/evaluations/${suiteId}`} className={linkCls}>
        Suite v{suiteVersion}
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
      <Link to={`/experiments/${experimentId}`} className={`${linkCls} ml-auto`}>
        Back to experiment
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
    <section data-section="outcome" className="flex flex-col gap-2">
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
    <section data-section="candidates" className="flex flex-col gap-2">
      <h3 className="font-mono text-sm uppercase tracking-[0.1em] text-text-muted">Candidates</h3>
      <ul className="flex flex-col gap-1" role="list" ref={listRef}>
        {record.candidates.map((c) => {
          const accepted = c.acceptedAttemptId
            ? c.attempts.find((a) => a.attemptId === c.acceptedAttemptId)
            : null;
          const reusedFrom = accepted?.reusedFrom ?? null;
          return (
            <li key={c.candidateId}>
              <button
                type="button"
                data-candidate-id={c.candidateId}
                tabIndex={-1}
                onClick={() => setSelectedId(c.candidateId)}
                aria-pressed={c.candidateId === selectedId}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-md border border-edge bg-panel px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-edge-bright focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          className="rounded-md border border-edge bg-panel p-3"
        >
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
    <section data-section="judge" className="flex flex-col gap-2">
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
                        const profile = record.evaluation.profile;
                        if (profile) {
                          const rv = rankValueFromResults(ev.criterionScores, profile);
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
    <section data-section="fusion" className="flex flex-col gap-2">
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
    <section
      data-section="cost-breakdown"
      className="flex min-w-0 flex-col gap-1 rounded-md border border-edge bg-panel p-3"
    >
      <h3 className="text-sm font-semibold text-text">Cost</h3>
      {stages.length === 0 && !unknown ? (
        <p className="text-sm text-text-muted">No cost data for this run.</p>
      ) : null}
      {stages.length > 0 ? (
        <ul className="flex min-w-0 flex-col">
          {stages.map((stage) => (
            <li
              key={stage.label}
              data-cost-source={stage.source}
              className="flex min-h-[44px] min-w-0 items-center justify-between gap-2 border-b border-edge py-1 text-sm last:border-b-0"
            >
              <span className="min-w-0 truncate font-mono text-text-secondary">{stage.label}</span>
              <span className="shrink-0 tabular-nums text-text">
                ${stage.usd.toFixed(6)} <span className="text-text-muted">· {stage.source}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {unknown ? (
        <p className="text-xs text-text-muted">Some accepted stages have Unknown cost.</p>
      ) : null}
      {totalUsd !== undefined && totalUsd > 0 ? (
        <p data-cost-total="" className="text-sm text-text">
          Incremental total: <span className="tabular-nums">${totalUsd.toFixed(6)}</span>
        </p>
      ) : null}
    </section>
  );
}

function TaskConfigSection({ section }: { section: DetailSection }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section data-section="task-config" className="flex flex-col gap-1">
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
