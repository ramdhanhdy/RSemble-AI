// =============================================================================
// ExperimentResults — terminal experiment summary + result matrix (spec §12.3).
//
// Loads the run records behind every task's selected attempt, aggregates
// (equal task weight, coverage-transparent means, complete-coverage winners),
// and renders the summary: identity/suite/date/status, winner line, per-model
// mean + coverage, failed/partial/interrupted/aborted attempt summary with
// run links, and the Judge/profile snapshot. ≥768px shows the full matrix;
// below that the model-selectable mobile adaptation.
// =============================================================================

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown } from "lucide-react";
import type { ReactElement } from "react";
import type {
  ExperimentRecord,
  ExperimentTaskAttempt,
} from "../../lib/evaluations/evaluation-types";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import { useEvaluationRepository } from "../../lib/persistence/repository-context";
import {
  aggregateExperiment,
  formatAggregateMean,
} from "../../lib/evaluations/experiment-aggregation";
import { deriveDisplayRanking } from "../../lib/evaluations/experiment-ranking";
import { StatusMark } from "../../ui/StatusMark";
import { CompactModelLabel } from "../../ui/CompactModelLabel";
import { ResultMatrix } from "./ResultMatrix";
import { MobileExperimentResults } from "./MobileExperimentResults";

export interface ExperimentResultsProps {
  experiment: ExperimentRecord;
  resolveRunRecord: (runId: string) => Promise<RunRecordV2 | null>;
}

const DESKTOP_QUERY = "(min-width: 768px)";

/** Inline media query — matches the pattern in RunsWorkspace.tsx. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Attempt statuses that belong in the §12.3 non-completed summary. */
const ISSUE_STATUSES: ReadonlySet<ExperimentTaskAttempt["status"]> = new Set([
  "failed",
  "partial",
  "interrupted",
  "aborted",
]);

export function ExperimentResults({
  experiment,
  resolveRunRecord,
}: ExperimentResultsProps): ReactElement {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const evalRepo = useEvaluationRepository();
  const [runRecords, setRunRecords] = useState<ReadonlyMap<string, RunRecordV2> | null>(null);
  const [suiteName, setSuiteName] = useState<string | null>(null);

  // Load every selected attempt's run record; memoized on id + revision.
  const experimentId = experiment.id;
  const experimentRevision = experiment.revision;
  useEffect(() => {
    let cancelled = false;
    setRunRecords(null);
    const runIds: string[] = [];
    for (const taskState of experiment.tasks) {
      const selected = taskState.selectedAttemptId
        ? taskState.attempts.find((a) => a.id === taskState.selectedAttemptId)
        : undefined;
      if (selected?.runId) runIds.push(selected.runId);
    }
    void Promise.all(
      runIds.map(async (runId) => {
        const record = await resolveRunRecord(runId);
        return record ? ([runId, record] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;
      const map = new Map<string, RunRecordV2>();
      for (const entry of entries) {
        if (entry) map.set(entry[0], entry[1]);
      }
      setRunRecords(map);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id + revision per contract
  }, [experimentId, experimentRevision, resolveRunRecord]);

  // Suite name is display chrome; fall back to the immutable suite id.
  useEffect(() => {
    let cancelled = false;
    if (!evalRepo) return;
    void (async () => {
      try {
        const suite = await evalRepo.getSuite(experiment.suiteId);
        if (!cancelled) setSuiteName(suite?.name ?? null);
      } catch {
        if (!cancelled) setSuiteName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [evalRepo, experiment.suiteId]);

  if (!runRecords) {
    return (
      <div className="flex min-h-[120px] flex-1 items-center gap-3 p-8" role="status">
        <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-accent/40" />
        <span className="text-sm text-text-muted">Loading experiment results…</span>
      </div>
    );
  }

  const aggregation = aggregateExperiment({
    snapshot: experiment.snapshot,
    taskStates: experiment.tasks,
    resolveRunRecord: (runId: string) => runRecords.get(runId) ?? null,
  });

  const slotsByKey = new Map(
    experiment.snapshot.modelSlots.map((s) => [`${s.providerId}:${s.slug}`, s]),
  );
  const taskById = new Map(experiment.snapshot.tasks.map((t) => [t.id, t]));

  // Exact localized timestamp + explicit timezone (spec §12.3).
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startedText = `${new Date(experiment.createdAt).toLocaleString()} · ${timeZone}`;

  const issueAttempts: { taskTitle: string; attempt: ExperimentTaskAttempt }[] = [];
  for (const taskState of experiment.tasks) {
    const taskTitle = taskById.get(taskState.taskId)?.title ?? taskState.taskId;
    for (const attempt of taskState.attempts) {
      if (ISSUE_STATUSES.has(attempt.status)) issueAttempts.push({ taskTitle, attempt });
    }
  }

  const profiles = experiment.snapshot.profiles;
  const profileText =
    profiles.length > 0
      ? profiles.map((p) => `${p.name} v${p.version}`).join(", ")
      : "Holistic judgment";

  const winnerModels = aggregation.models.filter((m) => aggregation.winnerKeys.includes(m.modelKey));
  const snapshotOrder = new Map(experiment.snapshot.modelSlots.map((s, i) => [`${s.providerId}:${s.slug}`, i]));
  const displayRanking = deriveDisplayRanking(aggregation.models, snapshotOrder);
  const { eligible, provisional, provisionalLeader } = displayRanking;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="truncate text-lg font-semibold text-text">
            {suiteName ?? experiment.suiteId}
          </h1>
          <StatusMark status={experiment.status} />
        </div>
        <p className="text-sm text-text-secondary">
          Experiment results · Suite v{experiment.suiteVersion} · {startedText} ·{" "}
          <span className="font-mono text-xs text-text-muted">{experiment.id}</span>
        </p>
        <div>
          <Link
            to={`/evaluations/${experiment.suiteId}`}
            className="inline-flex min-h-[44px] items-center rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Back to suite
          </Link>
        </div>
      </header>

      {/* Winner callout — Complete-coverage winner (spec §10.2). */}
      {winnerModels.length > 0 ? (
        <section
          aria-label="Winner"
          className="flex min-w-0 flex-col gap-1 rounded-md border border-success/40 bg-success/[0.06] px-4 py-3"
          data-testid="winner-callout"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-success">
            Complete-coverage winner
          </p>
          {winnerModels.map((model) => {
            const slot = slotsByKey.get(model.modelKey);
            return (
              <div key={model.modelKey} className="flex min-w-0 flex-wrap items-center gap-2">
                <Crown size={15} className="text-success" aria-hidden="true" />
                {slot ? (
                  <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                ) : (
                  <span className="font-mono text-text">{model.modelKey}</span>
                )}
                {model.mean !== null ? (
                  <span className="tabular-nums text-sm font-bold text-text">
                    {formatAggregateMean(model.mean)}
                  </span>
                ) : null}
                <span className="text-xs text-text-secondary">
                  mean over {model.scoredTasks}/{model.totalTasks} tasks
                </span>
              </div>
            );
          })}
        </section>
      ) : (
        <p className="text-sm text-text-secondary">
          No complete-coverage winner. Complete missing results to determine the winner.
        </p>
      )}

      {/* Provisional score leader — restrained line, no crown, no rank (spec §10.2). */}
      {provisionalLeader && provisionalLeader.mean !== null ? (
        <p className="text-sm text-text-secondary">
          <span className="font-medium text-text">Provisional score leader</span> ·{" "}
          {formatAggregateMean(provisionalLeader.mean)} mean over{" "}
          {provisionalLeader.scoredTasks}/{provisionalLeader.totalTasks} tasks · not winner-eligible
        </p>
      ) : null}

      <section aria-label="Aggregate scores" className="flex min-w-0 flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Eligible standings
        </h2>
        <ul className="flex min-w-0 flex-col gap-1">
          {eligible.map((model, rank) => {
            const slot = slotsByKey.get(model.modelKey);
            const isWinner = aggregation.winnerKeys.includes(model.modelKey);
            return (
              <li key={model.modelKey} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <span className="w-7 font-mono text-xs text-text-muted">#{rank + 1}</span>
                {isWinner ? (
                  <Crown size={12} className="text-success" aria-label="Winner" />
                ) : null}
                {slot ? (
                  <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                ) : (
                  <span className="font-mono text-text">{model.modelKey}</span>
                )}
                {model.mean !== null ? (
                  <>
                    <span className="tabular-nums text-sm font-semibold text-text">
                      {formatAggregateMean(model.mean)}
                    </span>
                    <span className="text-xs text-text-secondary">
                      mean · {model.scoredTasks}/{model.totalTasks} tasks
                    </span>
                  </>
                ) : (
                  <span className="text-text-secondary">No scores</span>
                )}
              </li>
            );
          })}
        </ul>

        {provisional.length > 0 ? (
          <>
            <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Provisional results
            </h2>
            <ul className="flex min-w-0 flex-col gap-1">
              {provisional.map((model) => {
                const slot = slotsByKey.get(model.modelKey);
                return (
                  <li
                    key={model.modelKey}
                    className="flex min-w-0 flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="w-7" aria-hidden="true" />
                    {slot ? (
                      <CompactModelLabel providerId={slot.providerId} slug={slot.slug} />
                    ) : (
                      <span className="font-mono text-text">{model.modelKey}</span>
                    )}
                    {model.mean !== null ? (
                      <>
                        <span className="tabular-nums text-sm font-semibold text-text">
                          {formatAggregateMean(model.mean)}
                        </span>
                        <span className="text-xs text-text-secondary">
                          Incomplete · {model.scoredTasks}/{model.totalTasks} tasks
                        </span>
                      </>
                    ) : (
                      <span className="text-text-secondary">No scores</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-label="Judge and evaluation profile" className="flex min-w-0 flex-col gap-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Judge &amp; profile
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CompactModelLabel
            providerId={experiment.snapshot.defaultJudge.providerId}
            slug={experiment.snapshot.defaultJudge.model}
          />
          <span className="text-sm text-text-secondary">{profileText}</span>
        </div>
      </section>

      {issueAttempts.length > 0 ? (
        <section aria-label="Failed or incomplete task attempts" className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
            Failed &amp; incomplete attempts
          </h2>
          <ul className="flex min-w-0 flex-col">
            {issueAttempts.map(({ taskTitle, attempt }) => (
              <li
                key={attempt.id}
                className="flex min-h-[44px] min-w-0 flex-wrap items-center gap-2 border-b border-edge py-1 last:border-b-0"
              >
                <StatusMark status={attempt.status} />
                <span className="min-w-0 truncate text-sm text-text">{taskTitle}</span>
                <span className="text-xs text-text-muted">Trial {attempt.trial}</span>
                {attempt.runId ? (
                  <Link
                    to={`/runs/${attempt.runId}`}
                    className="inline-flex min-h-[44px] items-center px-2 text-sm text-accent transition-colors duration-150 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    View run
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isDesktop ? (
        <ResultMatrix
          aggregation={aggregation}
          tasks={experiment.snapshot.tasks}
          modelSlots={experiment.snapshot.modelSlots}
          runRecords={runRecords}
        />
      ) : (
        <MobileExperimentResults
          aggregation={aggregation}
          tasks={experiment.snapshot.tasks}
          modelSlots={experiment.snapshot.modelSlots}
          runRecords={runRecords}
        />
      )}
    </div>
  );
}
