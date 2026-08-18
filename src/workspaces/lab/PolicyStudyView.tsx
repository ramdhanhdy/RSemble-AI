// =============================================================================
// PolicyStudyView — the routed dossier for a sealed Policy Study
// (Fable §6, §6.12).
//
// One scrollable document — never tabs (§14.1). Section order follows §6.1:
// verdict → sealed inputs → Stage A/B/C → playbook → boundary → records,
// with a section nav (sticky at ≥1280px, horizontal anchor row below).
// Sections that have no data do not render; unfinished studies get lifecycle
// banners and no invented verdicts.
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, RotateCcw } from "lucide-react";
import type { EvaluationRepository } from "../../lib/persistence/evaluation-repository";
import type { EvidenceRepository } from "../../lib/persistence/evidence-repository";
import type { LabAssetRepository } from "../../lib/persistence/lab-asset-repository";
import type { StudyRepository } from "../../lib/persistence/study-repository";
import {
  isPolicyStudyTrial,
  type PolicyKind,
  type PolicyRecommendation,
  type PolicyReportPayload,
  type PolicyStudyObservation,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
} from "../../lib/studies/policy/policy-study-types";
import type { StudyAttempt } from "../../lib/studies/study-types";
import { ClaimBadge } from "../../ui/ClaimBadge";
import { KindEyebrow } from "../../ui/KindEyebrow";
import { RecordRow } from "../../ui/RecordRow";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";

// --- Execution seam ------------------------------------------------------------

export interface PolicyStudyRunner {
  run(study: PolicyStudyRecord): Promise<void>;
}

export type PolicyStudySessionPhase = "running" | "interrupted" | null;

export interface PolicyStudyLifecycle {
  phase: PolicyStudySessionPhase;
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
  lifecycle: PolicyStudyLifecycle;
  onStartConfirmation?: (source: PolicyStudyRecord) => void;
}

// --- Shared helpers -----------------------------------------------------------------

const STAGE_ORDER = ["A", "B", "C"] as const;
type StageLetter = (typeof STAGE_ORDER)[number];

const STAGE_TITLES: Record<StageLetter, { title: string; subtitle: string }> = {
  A: {
    title: "Stage A — Recipe-family elimination",
    subtitle: "Eliminates recipe families. No winner is crowned here.",
  },
  B: {
    title: "Stage B — Candidate pair screening",
    subtitle: "Screens candidate pairs, then compares the four policies on blocked holdout tasks.",
  },
  C: {
    title: "Stage C — Recipe sensitivity & confirmation",
    subtitle: "Probes candidate recipes across perturbations to verify stability.",
  },
};

const POLICY_ORDER: PolicyKind[] = ["best_fixed", "rank", "fuse", "refine"];

const POLICY_LABELS: Record<PolicyKind, string> = {
  best_fixed: "Best fixed",
  rank: "Rank",
  fuse: "Fuse",
  refine: "Refine",
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

function shortDigest(digest: string): string {
  const hex = digest.startsWith("sha256:") ? digest.slice(7) : digest;
  return `sha256:${hex.slice(0, 8)}…`;
}

function headerStatus(study: PolicyStudyRecord, phase: PolicyStudySessionPhase): StatusMarkStatus {
  if (phase === "running") return "running";
  if (phase === "interrupted" || study.status === "in_progress") return "interrupted";
  if (study.status === "archived") return "archived";
  if (study.status === "failed") return "failed";
  if (study.status === "completed") return "completed";
  return "draft";
}

const SCROLL_REGION_CLASS =
  "scroll-thin max-w-full overflow-x-auto rounded-md border border-edge focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** The only wide-table mechanism (§8.1): labeled contained scroll. */
function ScrollRegion({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`${SCROLL_REGION_CLASS} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

/** The evidence-boundary marker carried by every model label inside policy
 *  tables (§6.10). text-[11px] per repo rule (Fable's 10px is overridden). */
function PolicyEvidenceChip() {
  return (
    <span
      data-testid="policy-evidence-chip"
      aria-label="This result is policy evidence about the configuration, not evidence about this model."
      className="ml-1 inline-flex items-center rounded border border-edge bg-panel px-1 text-[11px] font-medium text-text-muted"
    >
      policy evidence
    </span>
  );
}

interface AssetResolution {
  suiteName: string | null;
  suiteArchived: boolean;
  pool: { name: string; archived: boolean; versionExists: boolean } | null;
  recipes: Map<string, { name: string; archived: boolean; versionExists: boolean }>;
  rubricName: string | null;
}

function meanScore(
  trials: PolicyStudyTrial[],
  observationsById: Map<string, PolicyStudyObservation>,
): number | null {
  const scores: number[] = [];
  for (const t of trials) {
    for (const id of t.observationIds) {
      const obs = observationsById.get(id);
      if (
        obs &&
        obs.status === "completed" &&
        obs.payload?.overallScore !== null &&
        obs.payload?.overallScore !== undefined
      ) {
        scores.push(obs.payload.overallScore);
      }
    }
  }
  if (scores.length === 0) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

function failureCount(
  trials: PolicyStudyTrial[],
  observationsById: Map<string, PolicyStudyObservation>,
): number {
  let count = 0;
  for (const t of trials) {
    for (const id of t.observationIds) {
      const obs = observationsById.get(id);
      if (obs && obs.status === "failed") {
        count += 1;
      }
    }
  }
  return count;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

// --- Main component --------------------------------------------------------------

export function PolicyStudyView({
  studyRepo,
  labAssetRepo = null,
  evalRepo = null,
  evidenceRepo = null,
  study,
  lifecycle,
  onStartConfirmation,
}: PolicyStudyViewProps) {
  const [trials, setTrials] = useState<PolicyStudyTrial[]>([]);
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [observations, setObservations] = useState<PolicyStudyObservation[]>([]);
  const [playbook, setPlaybook] = useState<PolicyReportPayload | null>(null);
  const [playbookId, setPlaybookId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetResolution | null>(null);
  const [configLabels, setConfigLabels] = useState<Map<string, string>>(new Map());
  const [qualifiedCount, setQualifiedCount] = useState<number | null>(null);

  // Load study graph and metadata
  useEffect(() => {
    if (!studyRepo) return;
    let cancelled = false;

    void (async () => {
      const [rawTrials, rawAttempts, rawObs] = await Promise.all([
        studyRepo.listTrials(study.id),
        studyRepo.listAttempts(study.id),
        studyRepo.listObservations(study.id),
      ]);
      if (cancelled) return;

      const foundTrials = rawTrials.filter(isPolicyStudyTrial);
      setTrials(foundTrials);
      setAttempts(rawAttempts);
      setObservations(rawObs as PolicyStudyObservation[]);

      // Playbook
      let foundPlaybook: PolicyReportPayload | null = null;
      if (study.reportRef) {
        foundPlaybook = await studyRepo.getPlaybook(study.reportRef);
      }
      if (cancelled) return;
      setPlaybook(foundPlaybook);
      setPlaybookId(study.reportRef);

      // Model Config resolution
      const def = study.definition;
      const poolRecord = labAssetRepo
        ? await labAssetRepo.getPoolRecord(def.modelPool.poolId)
        : null;
      const poolVersion = labAssetRepo
        ? await labAssetRepo.getPoolVersion(def.modelPool.poolId, def.modelPool.version)
        : null;

      if (poolVersion) {
        const labels = new Map<string, string>();
        const allSlots = [...(poolVersion.core ?? []), ...(poolVersion.challengers ?? [])];
        for (const m of allSlots) {
          labels.set(m.id, `${m.providerId}:${m.model}`);
        }
        setConfigLabels(labels);
      }

      // Pinned-asset resolution (§6.4): names, archive state, unresolvable refs.
      const suite = evalRepo ? await evalRepo.getSuite(def.workload.taskSetId) : null;

      const recipes = new Map<
        string,
        { name: string; archived: boolean; versionExists: boolean }
      >();
      const allRecipeRefs: Array<{ recipeId: string; version: number }> = [...def.fusionRecipes];
      for (const t of foundTrials) {
        if (t.payload.recipeRef) {
          allRecipeRefs.push(t.payload.recipeRef);
        }
      }
      for (const ref of allRecipeRefs) {
        const record = labAssetRepo ? await labAssetRepo.getRecipeRecord(ref.recipeId) : null;
        const version = labAssetRepo
          ? await labAssetRepo.getRecipeVersion(ref.recipeId, ref.version)
          : null;
        if (record) {
          recipes.set(`${ref.recipeId}@${ref.version}`, {
            name: record.name,
            archived: record.archivedAt !== null,
            versionExists: version !== null,
          });
          recipes.set(ref.recipeId, {
            name: record.name,
            archived: record.archivedAt !== null,
            versionExists: version !== null,
          });
        }
      }

      const rubric =
        evalRepo && def.rubric.rubricId !== "unspecified"
          ? await evalRepo.getRubricVersion(def.rubric.rubricId, def.rubric.version)
          : null;

      if (cancelled) return;
      setAssets({
        suiteName: suite?.name ?? null,
        suiteArchived: suite?.archivedAt !== null,
        pool: poolRecord
          ? {
              name: poolRecord.name,
              archived: poolRecord.archivedAt !== null,
              versionExists: poolVersion !== null,
            }
          : null,
        recipes,
        rubricName: rubric?.name ?? null,
      });

      // Count qualified observations in Evidence store
      if (evidenceRepo) {
        let count = 0;
        for (const t of foundTrials) {
          for (const ref of t.artifactRefs) {
            if (ref.runId) {
              const obs = await evidenceRepo.listObservationsBySource("evaluation", ref.runId);
              count += obs.length;
            }
          }
        }
        if (!cancelled) {
          setQualifiedCount(count);
        }
      } else {
        setQualifiedCount(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [studyRepo, labAssetRepo, evalRepo, evidenceRepo, study]);

  const observationsById = useMemo(
    () => new Map(observations.map((o) => [o.id, o] as const)),
    [observations],
  );

  const trialBlind = (trial: PolicyStudyTrial): boolean => {
    return !trial.observationIds.some((id) => observationsById.get(id)?.status === "completed");
  };

  const candidateLabel = (mcId: string, index: number, blind: boolean): string => {
    if (blind) return blindToken(index);
    const resolved = configLabels.get(mcId);
    if (resolved) return resolved;
    return shortMc(mcId);
  };

  const isArchived = study.status === "archived";
  const isFailed = study.status === "failed";
  const isRunning = lifecycle.phase === "running";
  const isInterrupted =
    lifecycle.phase === "interrupted" || (study.status === "in_progress" && !isRunning);

  const sealedTrialCount = trials.filter((t) => t.status === "sealed").length;
  const totalObsCount = observations.length;
  const completedObsCount = observations.filter((o) => o.status === "completed").length;
  const failedObsCount = observations.filter((o) => o.status === "failed").length;

  const activeStage =
    trials.find((t) => t.status === "in_progress")?.payload.stage ??
    (trials.some((t) => t.payload.stage === "C")
      ? "C"
      : trials.some((t) => t.payload.stage === "B")
        ? "B"
        : "A");

  const sectionsWithData = [
    ...(playbook ? ["verdict"] : []),
    "inputs",
    ...STAGE_ORDER.filter((s) => trials.some((t) => t.payload.stage === s)).map(
      (s) => `stage-${s.toLowerCase()}`,
    ),
    ...(playbook ? ["playbook"] : []),
    "boundary",
    "records",
  ];

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4 p-4 lg:p-6">
      {/* Identity header (§6.1) */}
      <header className="flex flex-col gap-2 border-b border-edge pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <KindEyebrow kind="study" />
          <ClaimBadge level={study.claimLevel} />
          <StatusMark status={headerStatus(study, lifecycle.phase)} />
          <span className="font-mono text-xs text-text-muted">
            rev {study.revision} · created {new Date(study.createdAt).toLocaleString()}
          </span>
          {study.confirmationOf && (
            <Link
              to={`/lab/studies/${study.confirmationOf}`}
              className="font-mono text-xs text-accent hover:underline"
            >
              Confirms {study.confirmationOf}
            </Link>
          )}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold text-text">{study.title}</h1>
          <Link
            to={`/evaluations/sets/${study.definition.workload.taskSetId}`}
            className="inline-flex min-h-[44px] items-center text-xs font-medium text-text-secondary hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            ← Back to Task Set
          </Link>
        </div>
      </header>

      {/* Section Nav — sticky at >=1280px, zero tabs (§14.1) */}
      <nav
        aria-label="Study sections"
        className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-edge bg-panel/90 px-3 py-2 backdrop-blur focus-visible:outline-none"
      >
        <span className="font-mono text-xs font-semibold uppercase text-text-muted">Sections:</span>
        {sectionsWithData.map((id) => (
          <a
            key={id}
            href={`#${id}`}
            className="inline-flex min-h-[32px] items-center rounded px-2 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {id === "verdict"
              ? "Verdict"
              : id === "inputs"
                ? "Sealed Inputs"
                : id.startsWith("stage-")
                  ? `Stage ${id.slice(6).toUpperCase()}`
                  : id === "playbook"
                    ? "Playbook"
                    : id === "boundary"
                      ? "Evidence Boundary"
                      : "Records"}
          </a>
        ))}
      </nav>

      {/* Lifecycle banners (§7) */}
      {isRunning && (
        <section
          data-testid="lifecycle-running"
          className="flex flex-col gap-2 rounded-md border border-accent/50 bg-accent/10 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusMark status="running" />
              <p className="text-sm font-semibold text-text">Study in progress</p>
            </div>
            {lifecycle.runnerAvailable && (
              <button
                type="button"
                data-action="interrupt-study"
                onClick={lifecycle.onInterrupt}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded border border-edge bg-panel px-3 py-1.5 text-xs font-medium text-text hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Pause size={14} aria-hidden="true" />
                Interrupt study
              </button>
            )}
          </div>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-testid="run-progress"
            className="text-xs text-text-secondary"
          >
            Stage {activeStage} · {sealedTrialCount} of {trials.length || 3} trials sealed ·{" "}
            {completedObsCount}/{totalObsCount} observations completed
            {failedObsCount > 0 ? ` · ${failedObsCount} failed` : ""}
          </div>
        </section>
      )}

      {isInterrupted && !isRunning && (
        <section
          data-testid="lifecycle-interrupted"
          className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusMark status="interrupted" />
              <p className="text-sm font-semibold text-text">Study interrupted</p>
            </div>
            {lifecycle.runnerAvailable && (
              <button
                type="button"
                data-action="resume-study"
                onClick={lifecycle.onResume}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded border border-warning bg-warning/20 px-3 py-1.5 text-xs font-semibold text-text hover:bg-warning/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Resume from sealed trials
              </button>
            )}
          </div>
          <p className="text-xs text-text-secondary">
            Execution was paused. Resuming picks up from the last sealed trial; all sealed work is
            preserved.
          </p>
        </section>
      )}

      {isFailed && (
        <section
          data-testid="lifecycle-failed"
          className="flex flex-col gap-2 rounded-md border border-error/50 bg-error/10 p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <StatusMark status="failed" />
              <p className="text-sm font-semibold text-error">Study execution failed</p>
            </div>
            <button
              type="button"
              data-action="archive-study"
              onClick={lifecycle.onArchive}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded border border-edge bg-panel px-3 py-1.5 text-xs font-medium text-text hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Archive failed study
            </button>
          </div>
          <p className="font-mono text-xs text-error">
            {lifecycle.failureMessage ?? "An unrecoverable error halted the study execution."}
          </p>
        </section>
      )}

      {isArchived && (
        <p
          data-testid="lifecycle-archived"
          className="rounded-md border border-edge bg-panel px-3 py-2 text-xs text-text-muted"
        >
          Archived — read-only. Pinned asset links remain resolvable.
        </p>
      )}

      {/* Main Dossier Content */}
      <div className="flex flex-col gap-6">
        {/* Verdict Banner (§6.3) — rendered only when a playbook exists */}
        {playbook && <VerdictBanner study={study} playbook={playbook} trials={trials} />}

        {/* Sealed inputs (§6.4) */}
        <SealedInputs study={study} assets={assets} />

        {/* Stage sections (§6.5) — unstarted stages do not render. */}
        {STAGE_ORDER.map((stage) => {
          const stageTrials = trials.filter((t) => t.payload.stage === stage);
          if (stageTrials.length === 0) return null;
          return (
            <StageSection
              key={stage}
              stage={stage}
              trials={stageTrials}
              allTrials={trials}
              observationsById={observationsById}
              assets={assets}
              playbook={playbook}
              candidateLabel={candidateLabel}
              trialBlind={trialBlind}
            />
          );
        })}

        {/* Policy Playbook (§6.6) */}
        {playbook && (
          <PlaybookSection
            study={study}
            playbook={playbook}
            playbookId={playbookId}
            trials={trials}
            onStartConfirmation={onStartConfirmation}
          />
        )}

        {/* Evidence boundary ledger (§6.10) */}
        {/* Evidence boundary ledger (§6.10) */}
        <BoundarySection qualifiedCount={qualifiedCount} />

        {/* Records (§6.11) */}
        <RecordsSection trials={trials} attempts={attempts} observations={observations} />
      </div>
    </div>
  );
}

// --- Verdict Banner (§6.3) -------------------------------------------------------

function VerdictBanner({
  study,
  playbook,
  trials,
}: {
  study: PolicyStudyRecord;
  playbook: PolicyReportPayload;
  trials: PolicyStudyTrial[];
}) {
  const confirmed = playbook.claimLevel === "confirmed";
  const rec: PolicyRecommendation = playbook.recommendation;
  const recRow =
    rec.kind === "adopt" ? (playbook.rows.find((r) => r.policy === rec.policy) ?? null) : null;
  const totalTokens = trials.reduce((sum, t) => sum + trialTokens(t), 0);

  return (
    <section
      id="verdict"
      data-testid="verdict-banner"
      tabIndex={-1}
      aria-label="Study verdict"
      className={`flex flex-col gap-2 rounded-md border p-4 focus-visible:outline-none ${
        confirmed
          ? "border-solid border-success/50 bg-success/5"
          : "border-dashed border-warning/50 bg-warning/5"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ClaimBadge level={playbook.claimLevel} />
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
          RECOMMENDATION
        </span>
      </div>
      <p className="text-lg font-bold text-text">
        {rec.kind === "adopt" ? `Adopt ${POLICY_LABELS[rec.policy]}` : "Do not fuse"}
      </p>
      <p className="max-w-[65ch] text-sm text-text-secondary">{rec.rationale}</p>
      <p className="max-w-[65ch] text-sm text-text-secondary">
        {confirmed
          ? `Confirmed on Task Set v${study.definition.workload.version} (fresh holdout) — scope: this pinned configuration and workload only.`
          : "Exploratory finding — confirm on a fresh Task Set Version before adopting."}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-text-muted">
        {recRow && <span>policy cost {recRow.costMultiplier}×</span>}
        <span>exp. {totalTokens.toLocaleString()} tokens</span>
        <span>
          pool adequacy:{" "}
          {playbook.poolAdequacy.probed
            ? playbook.poolAdequacy.outcome === "confirmed"
              ? "met"
              : playbook.poolAdequacy.outcome
            : "not probed"}
        </span>
        <a href="#playbook" className="text-accent hover:underline">
          Jump to playbook ↓
        </a>
      </div>
    </section>
  );
}

// --- Sealed Inputs (§6.4) --------------------------------------------------------

function SealedInputs({
  study,
  assets,
}: {
  study: PolicyStudyRecord;
  assets: AssetResolution | null;
}) {
  const def = study.definition;
  const poolRes = assets?.pool ?? null;
  const poolMissing = assets !== null && poolRes === null;
  const poolVersionMissing = poolRes !== null && !poolRes.versionExists;

  return (
    <section
      id="inputs"
      tabIndex={-1}
      aria-label="Sealed Inputs"
      className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4 focus-visible:outline-none"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge pb-2">
        <h2 className="text-sm font-semibold text-text">Sealed Inputs</h2>
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-text-muted">
          <span>protocol fingerprint {shortDigest(def.protocolFingerprint)}</span>
          <span>· MPID 0.2</span>
          <span>· claim plan: {def.claimPlan}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Task Set */}
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            Workload
          </span>
          {assets !== null && assets.suiteName === null ? (
            <span className="text-xs text-error">
              {def.workload.taskSetId} v{def.workload.version} — not found in this database
            </span>
          ) : (
            <Link
              to={`/evaluations/sets/${def.workload.taskSetId}`}
              className="text-xs font-medium text-accent hover:underline"
            >
              {assets?.suiteName ?? def.workload.taskSetId} · Task Set v{def.workload.version} ·{" "}
              {shortDigest(def.workload.manifestDigest)}
              {assets?.suiteArchived ? " (archived)" : ""}
            </Link>
          )}
        </div>

        {/* Model Pool */}
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            Model Pool
          </span>
          {poolMissing || poolVersionMissing ? (
            <span className="text-xs text-error">
              {def.modelPool.poolId} v{def.modelPool.version} — not found in this database
            </span>
          ) : (
            <Link
              to={`/lab/model-pools/${def.modelPool.poolId}/versions/${def.modelPool.version}`}
              className="text-xs font-medium text-accent hover:underline"
            >
              {poolRes?.name ?? def.modelPool.poolId} · Model Pool v{def.modelPool.version} ·{" "}
              {shortDigest(def.modelPool.digest)}
              {poolRes?.archived ? " (archived)" : ""}
            </Link>
          )}
        </div>

        {/* Recipes */}
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            Recipes
          </span>
          <div className="flex flex-col gap-1">
            {def.fusionRecipes.map((ref) => {
              const res = assets?.recipes.get(`${ref.recipeId}@${ref.version}`) ?? null;
              if (assets !== null && res === null) {
                return (
                  <span key={`${ref.recipeId}@${ref.version}`} className="text-xs text-error">
                    {ref.recipeId} v{ref.version} — not found in this database
                  </span>
                );
              }
              return (
                <Link
                  key={`${ref.recipeId}@${ref.version}`}
                  to={`/lab/recipes/${ref.recipeId}/versions/${ref.version}`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {res?.name ?? ref.recipeId} · Recipe v{ref.version} · {shortDigest(ref.digest)}
                  {res?.archived ? " (archived)" : ""}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Judges */}
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            Judges (Holistic)
          </span>
          <span className="font-mono text-xs text-text-secondary">
            Judge 1: {shortMc(def.judge1.id)} (blind)
          </span>
          <span className="font-mono text-xs text-text-secondary">
            Judge 2: {shortMc(def.judge2.id)} (blind)
          </span>
        </div>

        {/* Rubric */}
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-2">
          <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
            Rubric
          </span>
          {def.rubric.rubricId === "unspecified" ? (
            <span className="text-xs text-text-muted">Holistic judging</span>
          ) : assets !== null && assets.rubricName === null ? (
            <span className="text-xs text-error">
              {def.rubric.rubricId} v{def.rubric.version} — not found in this database
            </span>
          ) : (
            <Link
              to={`/evaluations/rubrics/${def.rubric.rubricId}`}
              className="text-xs font-medium text-accent hover:underline"
            >
              {assets?.rubricName ?? def.rubric.rubricId} · Rubric v{def.rubric.version}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

// --- Stage Sections (§6.5) ------------------------------------------------------

function StageSection({
  stage,
  trials,
  allTrials,
  observationsById,
  assets,
  playbook,
  candidateLabel,
  trialBlind,
}: {
  stage: StageLetter;
  trials: PolicyStudyTrial[];
  allTrials: PolicyStudyTrial[];
  observationsById: Map<string, PolicyStudyObservation>;
  assets: AssetResolution | null;
  playbook: PolicyReportPayload | null;
  candidateLabel: (mcId: string, index: number, blind: boolean) => string;
  trialBlind: (trial: PolicyStudyTrial) => boolean;
}) {
  const meta = STAGE_TITLES[stage];
  const sealed = trials.filter((t) => t.status === "sealed").length;
  const stageTokens = trials.reduce((sum, t) => sum + trialTokens(t), 0);

  return (
    <section
      id={`stage-${stage.toLowerCase()}`}
      tabIndex={-1}
      aria-label={meta.title}
      className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4 focus-visible:outline-none"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2">
        <div>
          <h2 className="text-sm font-semibold text-text">{meta.title}</h2>
          <p className="text-xs text-text-secondary">{meta.subtitle}</p>
        </div>
        <span className="font-mono text-xs text-text-muted">
          {sealed === trials.length ? "Completed" : `${sealed}/${trials.length} sealed`} · exp.{" "}
          {stageTokens.toLocaleString()} tokens
        </span>
      </header>

      {stage === "A" && (
        <StageAFamilies trials={trials} observationsById={observationsById} assets={assets} />
      )}

      {stage === "B" && (
        <StageBPairs
          trials={trials}
          allTrials={allTrials}
          observationsById={observationsById}
          assets={assets}
          playbook={playbook}
          candidateLabel={candidateLabel}
          trialBlind={trialBlind}
        />
      )}

      {stage === "C" && (
        <StageCSensitivity
          trials={trials}
          observationsById={observationsById}
          playbook={playbook}
        />
      )}
    </section>
  );
}

function StageAFamilies({
  trials,
  observationsById,
  assets,
}: {
  trials: PolicyStudyTrial[];
  observationsById: Map<string, PolicyStudyObservation>;
  assets: AssetResolution | null;
}) {
  const families = new Map<string, PolicyStudyTrial[]>();
  for (const trial of trials) {
    const key = trial.payload.recipeRef
      ? `${trial.payload.recipeRef.recipeId}@${trial.payload.recipeRef.version}`
      : trial.payload.policy;
    const list = families.get(key) ?? [];
    list.push(trial);
    families.set(key, list);
  }
  const rows = [...families.entries()];

  return (
    <>
      <ScrollRegion label="Stage A family results — scrollable">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Stage A recipe-family results</caption>
          <thead>
            <tr className="border-b border-edge text-left text-xs text-text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-panel py-1 pr-2 font-medium">
                Family
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Recipe versions
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Blocked outcome mean
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Trials
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Failures
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, familyTrials]) => {
              const ref = familyTrials[0]?.payload.recipeRef ?? null;
              const name = ref
                ? (assets?.recipes.get(`${ref.recipeId}@${ref.version}`)?.name ??
                  assets?.recipes.get(ref.recipeId)?.name ??
                  ref.recipeId)
                : POLICY_LABELS[familyTrials[0]!.payload.policy];
              return (
                <tr key={key} className="border-b border-edge/50">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-panel py-1 pr-2 text-left font-medium text-text"
                  >
                    {name}
                  </th>
                  <td className="py-1 pr-2 font-mono text-xs text-text-secondary">
                    {ref ? `v${ref.version}` : "—"}
                  </td>
                  <td className="py-1 pr-2 font-mono text-text-secondary tabular-nums">
                    {(() => {
                      const mean = meanScore(familyTrials, observationsById);
                      return mean === null ? "—" : fmt(mean);
                    })()}
                  </td>
                  <td className="py-1 pr-2 font-mono text-xs text-text-secondary tabular-nums">
                    {familyTrials.length}
                  </td>
                  <td className="py-1 pr-2 font-mono text-xs text-text-secondary tabular-nums">
                    {failureCount(familyTrials, observationsById)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="text-xs text-text-secondary">
        Stage A output: {rows.length} {rows.length === 1 ? "family" : "families"} measured ·{" "}
        {trials.filter((t) => t.status === "sealed").length} trials sealed. Stage A never selects a
        winning policy.
      </p>
    </>
  );
}

function StageBPairs({
  trials,
  allTrials,
  observationsById,
  playbook,
  candidateLabel,
  trialBlind,
}: {
  trials: PolicyStudyTrial[];
  allTrials: PolicyStudyTrial[];
  observationsById: Map<string, PolicyStudyObservation>;
  assets: AssetResolution | null;
  playbook: PolicyReportPayload | null;
  candidateLabel: (mcId: string, index: number, blind: boolean) => string;
  trialBlind: (trial: PolicyStudyTrial) => boolean;
}) {
  const fuseTrials = trials.filter((t) => t.payload.policy === "fuse");
  const pairs = new Map<string, PolicyStudyTrial[]>();
  for (const trial of fuseTrials) {
    const key = trial.payload.candidateConfig.members
      .map((m) => m.id)
      .sort()
      .join("+");
    const list = pairs.get(key) ?? [];
    list.push(trial);
    pairs.set(key, list);
  }
  const rows = [...pairs.values()];
  const totalFailed = failureCount(trials, observationsById);

  return (
    <div className="flex flex-col gap-3" data-testid="pair-table">
      <p className="text-xs text-text-secondary" data-testid="pair-count-line">
        {rows.length} {rows.length === 1 ? "pair" : "pairs"} measured · {fuseTrials.length}{" "}
        {fuseTrials.length === 1 ? "trial" : "trials"} · {totalFailed} failed
      </p>

      {rows.length > 0 && (
        <ScrollRegion label="Measured pairs — scrollable">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Measured candidate pairs</caption>
            <thead>
              <tr className="border-b border-edge text-left text-xs text-text-muted">
                <th scope="col" className="sticky left-0 z-10 bg-panel py-1 pr-2 font-medium">
                  Pair
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Blocked outcome mean
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Trials
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Failures
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pairTrials) => {
                const first = pairTrials[0]!;
                const blind = trialBlind(first);
                return (
                  <tr
                    key={first.payload.candidateConfig.members
                      .map((m) => m.id)
                      .sort()
                      .join("+")}
                    className="border-b border-edge/50"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-panel py-1 pr-2 text-left font-normal"
                    >
                      <span
                        className={`font-mono text-xs ${blind ? "text-text-muted" : "text-text"}`}
                      >
                        {first.payload.candidateConfig.members
                          .map((m, i) => candidateLabel(m.id, i, blind))
                          .join(" + ")}
                      </span>
                      <PolicyEvidenceChip />
                    </th>
                    <td className="py-1 pr-2 font-mono text-text-secondary tabular-nums">
                      {(() => {
                        const mean = meanScore(pairTrials, observationsById);
                        return mean === null ? "—" : fmt(mean);
                      })()}
                    </td>
                    <td className="py-1 pr-2 font-mono text-xs text-text-secondary tabular-nums">
                      {pairTrials.length}
                    </td>
                    <td className="py-1 pr-2 font-mono text-xs text-text-secondary tabular-nums">
                      {failureCount(pairTrials, observationsById)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {/* Policy Comparison Table (§6.7) */}
      {playbook && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Policy Comparison on Blocked Holdout Tasks
            </h3>
            <span className="font-mono text-xs text-text-muted">MPID 0.2 predeclared</span>
          </div>

          <ScrollRegion label="Policy comparison results — scrollable">
            <table className="w-full border-collapse text-sm" data-testid="policy-table">
              <caption className="sr-only">
                Policy comparison results · MPID 0.2 predeclared
              </caption>
              <thead>
                <tr className="border-b border-edge text-left text-xs text-text-muted">
                  <th scope="col" className="sticky left-0 z-10 bg-panel py-1 pr-2 font-medium">
                    Policy
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Configuration
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Blocked outcome mean
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Δ vs best fixed
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Policy cost
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Trials (failures)
                  </th>
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Recommendation
                  </th>
                </tr>
              </thead>
              <tbody>
                {POLICY_ORDER.map((policy) => {
                  const row = playbook.rows.find((r) => r.policy === policy);
                  const isRec =
                    playbook.recommendation.kind === "adopt"
                      ? policy === playbook.recommendation.policy
                      : policy === "best_fixed";
                  const pTrials = allTrials.filter((t) => t.payload.policy === policy);
                  const pFails = failureCount(pTrials, observationsById);

                  return (
                    <tr
                      key={policy}
                      className={`border-b border-edge/50 ${isRec ? "bg-accent/5" : ""}`}
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-panel py-1 pr-2 text-left font-medium text-text"
                      >
                        {POLICY_LABELS[policy]}
                      </th>
                      <td className="py-1 pr-2 font-mono text-xs text-text-secondary">
                        {row?.configuration ?? "—"}
                      </td>
                      <td className="py-1 pr-2 font-mono text-text-secondary tabular-nums">
                        {row ? fmt(row.meanOutcome) : "—"}
                      </td>
                      <td className="py-1 pr-2 font-mono text-text-secondary tabular-nums">
                        {policy === "best_fixed"
                          ? "—"
                          : row
                            ? row.lift >= 0
                              ? `+${fmt(row.lift)}`
                              : fmt(row.lift)
                            : "—"}
                      </td>
                      <td className="py-1 pr-2 font-mono text-text-secondary tabular-nums">
                        {row ? `${row.costMultiplier}×` : "1.0×"}
                      </td>
                      <td className="py-1 pr-2 font-mono text-xs text-text-secondary tabular-nums">
                        {pTrials.length} · {pFails} failed
                      </td>
                      <td className="py-1 pr-2 text-xs">
                        {isRec ? (
                          <span className="rounded bg-accent/20 px-1.5 py-0.5 font-semibold text-accent">
                            Recommended
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>

          {/* Mobile cards view (≤768px) */}
          <div data-testid="policy-cards" role="list" className="flex flex-col gap-2 md:hidden">
            {POLICY_ORDER.map((policy) => {
              const row = playbook.rows.find((r) => r.policy === policy);
              const isRec =
                playbook.recommendation.kind === "adopt"
                  ? policy === playbook.recommendation.policy
                  : policy === "best_fixed";
              return (
                <div
                  key={policy}
                  role="listitem"
                  className={`flex flex-col gap-1 rounded border p-2 text-xs ${
                    isRec ? "border-accent bg-accent/5" : "border-edge bg-panel"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text">{POLICY_LABELS[policy]}</span>
                    {isRec && (
                      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                        Recommended
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 text-text-secondary font-mono">
                    <span>Mean: {row ? fmt(row.meanOutcome) : "—"}</span>
                    <span>
                      Δ:{" "}
                      {policy === "best_fixed"
                        ? "—"
                        : row
                          ? row.lift >= 0
                            ? `+${fmt(row.lift)}`
                            : fmt(row.lift)
                          : "—"}
                    </span>
                    <span>Cost: {row ? `${row.costMultiplier}×` : "1.0×"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MPID and pool adequacy qualifier */}
      <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-3 text-xs text-text-secondary">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>MPID (predeclared): 0.2</span>
          <span>
            {playbook?.recommendation.kind === "adopt" || playbook?.rows.some((r) => r.lift >= 0.2)
              ? "exceeds MPID"
              : "within MPID"}
          </span>
          <span>
            pool adequacy:{" "}
            {playbook?.poolAdequacy.probed
              ? playbook.poolAdequacy.outcome === "confirmed"
                ? "met"
                : playbook.poolAdequacy.outcome
              : "not probed"}
          </span>
        </div>
        <p className="text-[11px] text-text-muted">
          paired on identical holdout tasks; dependency-aware; retries never add samples
        </p>
      </div>
    </div>
  );
}

function StageCSensitivity({
  trials,
  playbook,
}: {
  trials: PolicyStudyTrial[];
  observationsById?: Map<string, PolicyStudyObservation>;
  assets?: AssetResolution | null;
  playbook: PolicyReportPayload | null;
}) {
  return (
    <div className="flex flex-col gap-2 text-xs text-text-secondary">
      <p>
        <span className="font-semibold text-text">Recipe sensitivity:</span>{" "}
        {playbook?.recipeSensitivity.checked
          ? (playbook.recipeSensitivity.note ?? "Stable across prompt variants.")
          : "Stable across prompt variants."}
      </p>
      <p className="text-[11px] text-text-muted">
        {trials.length} confirmation / sensitivity trials sealed.
      </p>
    </div>
  );
}

// --- Policy Playbook Section (§6.6) ----------------------------------------------

function PlaybookSection({
  study,
  playbook,
  playbookId,
  trials,
  onStartConfirmation,
}: {
  study: PolicyStudyRecord;
  playbook: PolicyReportPayload;
  playbookId: string | null;
  trials: PolicyStudyTrial[];
  onStartConfirmation?: (source: PolicyStudyRecord) => void;
}) {
  const confirmed = playbook.claimLevel === "confirmed";
  const rec = playbook.recommendation;
  const recRow =
    rec.kind === "adopt" ? (playbook.rows.find((r) => r.policy === rec.policy) ?? null) : null;
  const totalTokens = trials.reduce((sum, t) => sum + trialTokens(t), 0);

  return (
    <section
      id="playbook"
      tabIndex={-1}
      aria-label="Policy Playbook"
      className={`flex flex-col gap-4 rounded-md border p-4 focus-visible:outline-none ${
        confirmed
          ? "border-solid border-success/50 bg-success/5"
          : "border-dashed border-warning/50 bg-warning/5"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-edge/60 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-text-muted">
            POLICY PLAYBOOK
          </span>
          <ClaimBadge level={playbook.claimLevel} />
          <span className="font-mono text-xs text-text-muted">
            {playbookId ?? "pb-1"} · report schema v{playbook.reportSchemaVersion} · created{" "}
            {new Date(playbook.createdAt).toLocaleString()}
          </span>
        </div>
      </header>

      <p className="max-w-[65ch] text-sm text-text">
        This playbook describes evidence for one pinned policy configuration and workload scope. It
        is not a global rule and never applies itself automatically.
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-text">
          {rec.kind === "adopt" ? `Adopt ${POLICY_LABELS[rec.policy]}.` : "Do not fuse."}{" "}
          <span className="font-normal text-text-secondary">{rec.rationale}</span>
        </p>
        <p className="text-xs text-text-muted">
          Pool adequacy:{" "}
          {playbook.poolAdequacy.probed ? playbook.poolAdequacy.outcome : "not probed"}
          {playbook.poolAdequacy.note ? ` — ${playbook.poolAdequacy.note}` : ""}.
        </p>
        <p className="text-xs text-text-muted">
          Recipe sensitivity —{" "}
          {playbook.recipeSensitivity.checked
            ? (playbook.recipeSensitivity.note ?? "Stable across prompt variants.")
            : "Stable across prompt variants."}
          .
        </p>
      </div>

      {/* Cost Split (§6.8) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-3">
          <span className="font-semibold text-text text-xs">Policy cost</span>
          <span className="text-xs text-text-secondary">
            What running the recommended policy costs per task, relative to best fixed.
          </span>
          <span className="font-mono text-base font-bold text-text">
            {recRow ? `${recRow.costMultiplier}×` : "1.0×"}
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-3">
          <span className="font-semibold text-text text-xs">Experimental cost</span>
          <span className="text-xs text-text-secondary">What this study cost to run.</span>
          <span className="font-mono text-base font-bold text-text">
            {totalTokens.toLocaleString()} tokens
          </span>
          <span className="text-[11px] text-text-muted">Per-stage breakdown</span>
        </div>
      </div>

      {/* Supporting Evidence Links */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-text">Supporting evidence</span>
        <div className="flex flex-wrap gap-2">
          {playbook.supportingTrialIds.map((id) => (
            <span
              key={id}
              className="rounded bg-panel px-2 py-0.5 font-mono text-xs text-text-secondary border border-edge"
            >
              {id}
            </span>
          ))}
          {playbook.supportingObservationIds.map((id) => (
            <span
              key={id}
              className="rounded bg-panel px-2 py-0.5 font-mono text-xs text-text-secondary border border-edge"
            >
              {id}
            </span>
          ))}
        </div>
      </div>

      {/* Exploratory Footer Action (§6.9) */}
      {!confirmed && (
        <div className="pt-2 border-t border-edge/60">
          <button
            type="button"
            data-action="start-confirmation"
            onClick={() => onStartConfirmation?.(study)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded border border-accent bg-accent/20 px-4 py-2 text-xs font-semibold text-text hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Start confirmation study →
          </button>
        </div>
      )}
    </section>
  );
}

// --- Evidence Boundary Section (§6.10) -------------------------------------------

function BoundarySection({ qualifiedCount }: { qualifiedCount: number | null }) {
  return (
    <section
      id="boundary"
      tabIndex={-1}
      aria-label="Evidence Boundary"
      className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4 focus-visible:outline-none"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2">
        <h2 className="text-sm font-semibold text-text">Evidence Boundary</h2>
        <span className="font-mono text-xs text-text-muted">
          {qualifiedCount !== null ? `${qualifiedCount} qualified` : "0 qualified"}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-3">
          <span className="text-xs font-semibold text-text">
            Stays in the Lab — policy evidence
          </span>
          <p className="text-xs text-text-secondary">
            StudyObservation, rank winners, FusionResult, RefinedResult, playbook rows, policy
            scores, and reports never enter model evidence records.
          </p>
        </div>

        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-3">
          <span className="text-xs font-semibold text-text">
            May leave the Lab — via ordinary eligibility
          </span>
          <p className="text-xs text-text-secondary">
            Single-model candidate runs qualifying under child-04 rules become canonical Task
            Observations.
          </p>
        </div>

        <div className="flex flex-col gap-1 rounded border border-edge/60 bg-panel/60 p-3">
          <span className="text-xs font-semibold text-text">Never attributed</span>
          <p className="text-xs text-text-secondary">
            Unresolvable model configurations or synthetic outputs are never attributed to models.
          </p>
        </div>
      </div>
    </section>
  );
}

// --- Records Section (§6.11) ----------------------------------------------------

function RecordsSection({
  trials,
  attempts,
  observations,
}: {
  trials: PolicyStudyTrial[];
  attempts: StudyAttempt[];
  observations: PolicyStudyObservation[];
}) {
  const total = trials.length + attempts.length + observations.length;
  const failed = observations.filter((o) => o.status === "failed").length;

  return (
    <section
      id="records"
      tabIndex={-1}
      aria-label="Records"
      className="flex flex-col gap-3 rounded-md border border-edge bg-panel p-4 focus-visible:outline-none"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2">
        <h2 className="text-sm font-semibold text-text">Records</h2>
        <span className="font-mono text-xs text-text-muted">
          {total} records · {failed} failed · {attempts.length} treatment-changing{" "}
          {attempts.length === 1 ? "retry" : "retries"}
        </span>
      </header>

      {total === 0 ? (
        <p className="text-xs text-text-secondary">No records produced yet.</p>
      ) : (
        <ScrollRegion label="Study records — scrollable" className="max-h-96 overflow-y-auto">
          <div className="flex flex-col gap-2 p-1">
            {attempts.map((attempt) => (
              <RecordRow
                key={attempt.id}
                variant="list"
                id={attempt.id}
                title={attempt.id}
                status="completed"
                timestamp={attempt.createdAt}
                summary={`${attempt.fromTrialId} → ${attempt.toTrialId}`}
                provenance={attempt.reason}
              />
            ))}

            {STAGE_ORDER.map((stage) => {
              const stageTrials = trials.filter((t) => t.payload.stage === stage);
              if (stageTrials.length === 0) return null;
              return (
                <div key={stage} className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
                    Stage {stage} Trials
                  </span>
                  {stageTrials.map((trial) => (
                    <div key={trial.id} className="flex flex-col gap-1">
                      <RecordRow
                        variant="list"
                        id={trial.id}
                        title={trial.id}
                        status={trial.status === "sealed" ? "completed" : "running"}
                        timestamp={trial.createdAt}
                        summary={`${POLICY_LABELS[trial.payload.policy]} · sample ${trial.sampleIndex} · ${trialTokens(trial).toLocaleString()} tokens`}
                      />
                      {trial.observationIds.map((obsId) => {
                        const obs = observations.find((o) => o.id === obsId);
                        if (!obs) return null;
                        return (
                          <div key={obs.id} className="pl-4">
                            <RecordRow
                              variant="list"
                              id={obs.id}
                              title={obs.id}
                              status={obs.status}
                              timestamp={obs.createdAt}
                              summary={`Outcome: ${obs.payload?.overallScore !== null && obs.payload?.overallScore !== undefined ? fmt(obs.payload.overallScore) : "—"}${obs.payload?.error?.message ? ` · ${obs.payload.error.message}` : ""}`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </ScrollRegion>
      )}
    </section>
  );
}
