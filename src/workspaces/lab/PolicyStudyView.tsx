// =============================================================================
// PolicyStudyView — the routed dossier for a sealed Policy Study
// (Fable §6, §6.12).
//
// One scrollable document — never tabs (§14.1). This module owns:
//   - the identity header (KindEyebrow, ClaimBadge, StatusMark, lineage chips,
//     backlink to the pinned Task Set);
//   - lifecycle banners: running (live progress in the route's single polite
//     live region), interrupted (Resume from the last sealed trial), failed
//     (exact error + Archive), archived (read-only);
//   - stage sections that grow as the study runs: unstarted stages do not
//     render, blind candidate tokens resolve only after judging (D3).
//
// Verdicts are never invented: no playbook → no verdict banner, no winner
// markers. Slice 3 adds the verdict banner, sealed-inputs grid, policy
// playbook, evidence boundary, and records sections.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type { StudyAttempt } from "../../lib/studies/study-types";
import type {
  PolicyStudyObservation,
  PolicyStudyRecord,
  PolicyStudyTrial,
} from "../../lib/studies/policy/policy-study-types";
import { ClaimBadge } from "../../ui/ClaimBadge";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";

// --- Execution seam ------------------------------------------------------------

/**
 * Drives one study execution to a terminal state. Resolves when the
 * methodology completes (the study seals), rejects when execution fails.
 * Production wiring adapts the PolicyStudyAdapter; tests inject a mock.
 */
export interface PolicyStudyRunner {
  run(study: PolicyStudyRecord): Promise<void>;
}

export type PolicyStudySessionPhase = "running" | "interrupted" | null;

export interface PolicyStudyLifecycle {
  phase: PolicyStudySessionPhase;
  /** Exact error from the rejected run, when this session observed one. */
  failureMessage: string | null;
  runnerAvailable: boolean;
  onResume: () => void;
  onInterrupt: () => void;
  onArchive: () => void;
}

export interface PolicyStudyViewProps {
  studyRepo: StudyRepository | null;
  labAssetRepo?: LabAssetRepository | null;
  evalRepo?: EvaluationRepository | null;
  evidenceRepo?: EvidenceRepository | null;
  study: PolicyStudyRecord;
  lifecycle?: PolicyStudyLifecycle;
}

// --- Small helpers ---------------------------------------------------------------

const STAGE_ORDER = ["A", "B", "C"] as const;
type StageLetter = (typeof STAGE_ORDER)[number];

const STAGE_TITLES: Record<StageLetter, { title: string; subtitle: string }> = {
  A: {
    title: "Stage A — Recipe-family elimination",
    subtitle: "Eliminates recipe families. No winner is crowned here.",
  },
  B: {
    title: "Stage B — Pair screening & holdout comparison",
    subtitle: "Screens candidate pairs, then compares the four policies on blocked holdout tasks.",
  },
  C: {
    title: "Stage C — Sensitivity & cross-checks",
    subtitle: "Recipe-sensitivity and synthesizer cross-checks on the pinned configuration.",
  },
};

function trialTokens(trial: PolicyStudyTrial): number {
  return trial.experimentalCost.tokensIn + trial.experimentalCost.tokensOut;
}

function blindToken(index: number): string {
  return `candidate-${String.fromCharCode(65 + index)}`;
}

function shortMc(id: string): string {
  const hex = id.startsWith("mc:sha256:") ? id.slice(10) : id;
  return `mc:${hex.slice(0, 8)}…`;
}

function headerStatus(
  study: PolicyStudyRecord,
  phase: PolicyStudySessionPhase,
): StatusMarkStatus {
  if (study.status === "in_progress") return phase === "running" ? "running" : "interrupted";
  if (study.status === "archived") return "archived";
  return study.status;
}

// --- Component ------------------------------------------------------------------

export function PolicyStudyView({
  studyRepo,
  evidenceRepo = null,
  study,
  lifecycle,
}: PolicyStudyViewProps) {
  const [trials, setTrials] = useState<PolicyStudyTrial[]>([]);
  const [observations, setObservations] = useState<PolicyStudyObservation[]>([]);
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [configLabels, setConfigLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!studyRepo) return;
    void (async () => {
      const [loadedTrials, loadedObservations, loadedAttempts, configs] = await Promise.all([
        studyRepo.listTrials(study.id),
        studyRepo.listObservations(study.id),
        studyRepo.listAttempts(study.id),
        evidenceRepo ? evidenceRepo.listModelConfigurations() : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setTrials(loadedTrials);
      setObservations(loadedObservations);
      setAttempts(loadedAttempts);
      setConfigLabels(
        new Map(configs.map((c) => [c.id, `${c.providerId}:${c.requestedModel}`] as const)),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [studyRepo, evidenceRepo, study.id, study.updatedAt, study.reportRef]);

  const observationsById = useMemo(
    () => new Map(observations.map((o) => [o.id, o] as const)),
    [observations],
  );

  const trialsByStage = useMemo(() => {
    const map = new Map<StageLetter, PolicyStudyTrial[]>();
    for (const stage of STAGE_ORDER) map.set(stage, []);
    for (const trial of trials) map.get(trial.payload.stage)?.push(trial);
    return map;
  }, [trials]);

  const phase: PolicyStudySessionPhase = lifecycle?.phase ?? null;
  const activeStage: StageLetter | null = useMemo(() => {
    for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
      const stage = STAGE_ORDER[i]!;
      if (trialsByStage.get(stage)?.some((t) => t.status === "in_progress")) return stage;
    }
    for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
      const stage = STAGE_ORDER[i]!;
      if ((trialsByStage.get(stage)?.length ?? 0) > 0) return stage;
    }
    return null;
  }, [trialsByStage]);

  const sealedCount = trials.filter((t) => t.status === "sealed").length;
  const tokensSoFar = trials.reduce((sum, t) => sum + trialTokens(t), 0);
  const anyBlind = trials.some(
    (t) => !t.observationIds.some((id) => observationsById.get(id)?.status === "completed"),
  );

  /** Candidate labels: blind tokens until judging completes (D3), then the
   *  resolved configuration identity (or its exact id when unresolvable). */
  function candidateLabel(mcId: string, index: number, blind: boolean): string {
    if (blind) return blindToken(index);
    return configLabels.get(mcId) ?? shortMc(mcId);
  }

  const isArchived = study.status === "archived";

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="policy-study-view">
      {/* Breadcrumb */}
      <nav className="text-xs text-text-secondary">
        <Link
          to="/lab"
          className="text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Lab
        </Link>
        {" / "}
        Policy Studies
      </nav>

      {/* Identity header */}
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <KindEyebrow kind="study" />
          <ClaimBadge level={study.claimLevel} />
          <StatusMark status={headerStatus(study, phase)} />
        </div>
        <h1
          tabIndex={-1}
          className={`text-lg font-semibold lg:text-xl ${isArchived ? "text-text-secondary" : "text-text"}`}
        >
          {study.title}
        </h1>
        <p className="font-mono text-xs text-text-muted">
          {study.id} · definition {study.definitionFingerprint.slice(7, 15)} · schema v
          {study.definitionSchemaVersion}
        </p>
        {study.confirmationOf !== null && (
          <p className="font-mono text-xs">
            <Link
              to={`/lab/studies/${study.confirmationOf}`}
              className="text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Confirms {study.confirmationOf} →
            </Link>
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Link
            to={`/evaluations/sets/${study.definition.workload.taskSetId}`}
            className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Open Task Set v{study.definition.workload.version}
          </Link>
          {(study.status === "completed" || study.status === "failed") && lifecycle && (
            <button
              type="button"
              data-action="archive-study"
              onClick={lifecycle.onArchive}
              className="min-h-[44px] min-w-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Archive
            </button>
          )}
        </div>
      </header>

      {/* Lifecycle banners */}
      {study.status === "in_progress" && phase === "running" && (
        <section
          data-testid="lifecycle-running"
          aria-label="Execution in progress"
          className="flex flex-col gap-2 rounded-md border border-edge bg-panel p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusMark status="running" />
            <button
              type="button"
              data-action="interrupt-study"
              onClick={lifecycle?.onInterrupt}
              className="min-h-[44px] min-w-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Interrupt
            </button>
          </div>
          {/* The route's single polite live region (§9.4): milestone-level
              progress, not per-token spam. */}
          <p role="status" aria-live="polite" data-testid="run-progress" className="text-sm text-text-secondary">
            {activeStage === null
              ? "Execution starting — no trials recorded yet."
              : `Stage ${activeStage} · ${sealedCount} of ${trials.length} recorded trials sealed · ${tokensSoFar.toLocaleString()} tokens so far`}
          </p>
          <ul className="flex flex-col gap-1" data-testid="stage-progress">
            {STAGE_ORDER.filter((s) => (trialsByStage.get(s)?.length ?? 0) > 0).map((stage) => {
              const stageTrials = trialsByStage.get(stage) ?? [];
              const sealed = stageTrials.filter((t) => t.status === "sealed").length;
              const running = stageTrials.length - sealed;
              return (
                <li key={stage} className="flex items-center gap-2 text-xs text-text-secondary">
                  <StatusMark status={running > 0 ? "running" : "completed"} size={11} />
                  Stage {stage} · {sealed} sealed
                  {running > 0 ? ` · ${running} in progress` : ""}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {study.status === "in_progress" && phase !== "running" && (
        <section
          data-testid="lifecycle-interrupted"
          aria-label="Study interrupted"
          className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3"
        >
          <StatusMark status="interrupted" />
          <p className="text-sm text-text">
            {activeStage === null
              ? "Interrupted before the first stage — sealed inputs are preserved. Resume starts execution."
              : `Interrupted at Stage ${activeStage} — sealed work is preserved. Resume continues from the last sealed trial.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-action="resume-study"
              onClick={lifecycle?.onResume}
              disabled={!lifecycle?.runnerAvailable}
              className="min-h-[44px] min-w-[44px] rounded-md bg-accent px-3 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
            >
              Resume
            </button>
            {!lifecycle?.runnerAvailable && (
              <p className="text-xs text-text-secondary">
                Execution wiring is unavailable in this session — Resume cannot start a run.
              </p>
            )}
          </div>
        </section>
      )}

      {study.status === "failed" && (
        <section
          data-testid="lifecycle-failed"
          aria-label="Study failed"
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-error/50 bg-error/10 p-3"
        >
          <StatusMark status="failed" />
          <p className="text-sm text-text">
            {lifecycle?.failureMessage ??
              "This study failed during execution. Sealed work remains readable below."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {lifecycle && (
              <button
                type="button"
                data-action="archive-study"
                onClick={lifecycle.onArchive}
                className="min-h-[44px] min-w-[44px] rounded-md border border-edge bg-panel px-3 text-sm text-text-secondary hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Archive
              </button>
            )}
          </div>
        </section>
      )}

      {isArchived && (
        <p
          data-testid="lifecycle-archived"
          className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-text-secondary"
        >
          Archived — read-only. All links remain resolvable.
          {study.archivedAt !== null && (
            <span className="font-mono text-xs text-text-muted">
              {" "}
              · archived {new Date(study.archivedAt).toLocaleString()}
            </span>
          )}
        </p>
      )}

      {/* Stage sections — only stages that have started render (§6.5). */}
      {STAGE_ORDER.map((stage) => {
        const stageTrials = trialsByStage.get(stage) ?? [];
        if (stageTrials.length === 0) return null;
        const running = stageTrials.some((t) => t.status === "in_progress");
        const cost = stageTrials.reduce((sum, t) => sum + trialTokens(t), 0);
        return (
          <section
            key={stage}
            id={`stage-${stage.toLowerCase()}`}
            aria-label={STAGE_TITLES[stage].title}
            className="rounded-md border border-edge bg-panel"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-text">{STAGE_TITLES[stage].title}</h2>
                <p className="text-xs text-text-secondary">{STAGE_TITLES[stage].subtitle}</p>
              </div>
              <StatusMark status={running ? "running" : "completed"} />
              <span className="ml-auto font-mono text-xs text-text-muted">
                exp. {cost.toLocaleString()} tokens
              </span>
            </header>
            <div className="flex flex-col gap-2 p-3">
              {anyBlind && (
                <p className="text-xs text-text-muted">
                  Blind — labels resolve after judging.
                </p>
              )}
              <div
                role="region"
                aria-label={`Stage ${stage} trials — scrollable`}
                tabIndex={0}
                className="scroll-thin max-w-full overflow-x-auto rounded-md border border-edge focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">{STAGE_TITLES[stage].title} trials</caption>
                  <thead>
                    <tr className="border-b border-edge text-left text-xs text-text-muted">
                      <th scope="col" className="sticky left-0 z-10 bg-panel py-1 pr-2 font-medium">
                        Trial
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Policy
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Candidates
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="py-1 pr-2 font-medium">
                        Tokens
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageTrials.map((trial) => {
                      const blind = !trial.observationIds.some(
                        (id) => observationsById.get(id)?.status === "completed",
                      );
                      return (
                        <tr key={trial.id} className="border-b border-edge/50">
                          <th
                            scope="row"
                            className="sticky left-0 z-10 bg-panel py-1 pr-2 text-left font-mono text-xs font-normal text-text"
                          >
                            {trial.id}
                          </th>
                          <td className="py-1 pr-2 text-text-secondary">{trial.payload.policy}</td>
                          <td className="py-1 pr-2">
                            <span
                              className={`font-mono text-xs ${blind ? "text-text-muted" : "text-text"}`}
                            >
                              {trial.payload.candidateConfig.members
                                .map((m, i) => candidateLabel(m.id, i, blind))
                                .join(" + ")}
                            </span>
                          </td>
                          <td className="py-1 pr-2">
                            <StatusMark
                              status={trial.status === "sealed" ? "completed" : "running"}
                              size={11}
                            />
                          </td>
                          <td className="py-1 pr-2 font-mono text-xs text-text-secondary tabular-nums">
                            {trialTokens(trial).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        );
      })}

      {/* attempts are treatment-changing retries (spec §4.3) — the records
          section (completed-dossier slice) lists them with full lineage. */}
      {attempts.length > 0 && (
        <p className="text-xs text-text-secondary">
          {attempts.length} treatment-changing {attempts.length === 1 ? "retry" : "retries"}{" "}
          recorded.
        </p>
      )}
    </div>
  );
}
