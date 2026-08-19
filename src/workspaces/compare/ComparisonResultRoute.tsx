// =============================================================================
// RSemble AI — Comparison Result route (spec §6.2)
//
// Child 05 (Contextual Compare Results) Milestone C — Task 6.
//
// Direct-loads and reconstructs historical Rank and Fuse comparison results
// from exact persisted state (RunRecordV2 + ComparisonResultIndex read model).
//
// Key invariants:
//  - ZERO provider calls on direct load (pure reconstruction of stored facts);
//  - Direct load completed Rank and Fuse results with exact outputs and evidence;
//  - Partial, interrupted, and stale-running states rendered honestly;
//  - After a failed re-judge, earlier accepted report remains authoritative;
//  - Source/index revision repair warning with one-click repair action;
//  - Semantic links to exact Record (/runs/:id) and Task (/tasks/:id/versions/:v);
//  - Open in Compare configuration preload via onOpenInCompare;
//  - 390px mobile responsive layout.
// =============================================================================

import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  GitCompare,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  DEFAULT_REASONING_POLICY,
  type CatalogModel,
  type ProviderId,
} from "../../lib/providers/types";
import {
  createComparisonRepository,
  type ComparisonRepository,
  type ComparisonResultEnvelope,
} from "../../lib/persistence/comparison-repository";
import {
  RepositoryContext,
  useEvidenceRepository,
  useRunRepository,
} from "../../lib/persistence/repository-context";
import type { RunRepository } from "../../lib/persistence/run-repository";
import type {
  EvidenceRepository,
  EvidenceIndexJob,
} from "../../lib/persistence/evidence-repository";
import type {
  EligibilityDecision,
  ModelConfigurationSnapshot,
  Observation,
} from "../../lib/evidence/evidence-types";
import { EvidenceReceipt } from "../../ui/EvidenceReceipt";
import type { RunRecordV2 } from "../../lib/persistence/run-types";
import type {
  ComparisonMode,
  ComparisonResultIndex,
  ComparisonTaskBinding,
} from "../../lib/compare/comparison-result-types";
import { runConfigFromRecord, type RunConfigPreload } from "../../lib/runs/run-config-preload";
import { OutputPane } from "../../ui/OutputPane";
import { StatusMark, type StatusMarkStatus } from "../../ui/StatusMark";
import type { Attachment } from "../../lib/attachments/types";
import { splitSegments, summarize } from "../../lib/pipeline";
import {
  CANDIDATE_ACCENTS,
  type Candidate,
  type CandidateSegment,
  type CandidateStatus,
  type ConsensusBreakdown,
  type JudgeReport,
  type Mode,
  type ModelSlot,
} from "../../studio-data";
import { HOLISTIC_EVALUATION } from "../../lib/evaluations/evaluation-rubric-adhoc";
import type { StageStatus, StudioState } from "../../studio-engine";
import { formatRelativeTime } from "../runs/run-view-model";

export interface ComparisonResultRouteProps {
  comparisonId?: string;
  comparisonRepo?: ComparisonRepository | null;
  runRepo?: RunRepository | null;
  evidenceRepo?: EvidenceRepository | null;
  models?: CatalogModel[];
  onOpenInCompare?: (runId: string, config: RunConfigPreload) => void;
}

/**
 * Deterministically reconstructs the StudioState view model from persisted RunRecordV2.
 * Pure function: reproduces byte-identical segments, summary, scores, and authoritative reports.
 */
export function reconstructStudioStateFromRecord(
  record: RunRecordV2,
  index?: ComparisonResultIndex | null,
  models: CatalogModel[] = [],
): StudioState {
  const mode: Mode = record.mode;
  const prompt = record.task.prompt;
  const systemPrompt = record.task.systemPrompt ?? "";
  const temperature = record.task.temperature ?? 0.7;
  const firstJudgeAttempt = record.judge.attempts[0];
  const judgeInstruction = firstJudgeAttempt?.instruction ?? "";

  const slots: ModelSlot[] = record.candidates.map((c) => ({
    id: c.slotId,
    providerId: c.providerId as ProviderId,
    provider: c.providerId,
    model: c.model,
    slug: c.slug,
    enabled: true,
  }));

  const evaluation = record.evaluation.profile
    ? { kind: "custom" as const, profile: record.evaluation.profile }
    : HOLISTIC_EVALUATION;

  const critic = {
    providerId: (firstJudgeAttempt?.providerId ?? "openrouter") as ProviderId,
    model: firstJudgeAttempt?.model ?? "judge",
    slug: firstJudgeAttempt?.model ?? "judge",
  };

  const reasoningPolicy = DEFAULT_REASONING_POLICY;

  const taskBinding: ComparisonTaskBinding | null = index?.taskBinding ?? {
    kind: "ad_hoc",
    inputSnapshotRef: "migrated",
  };

  const attachments: Attachment[] = (record.attachments ?? []).map((a) => ({
    name: a.name,
    kind: a.kind,
    bytes: a.bytes,
    id: a.name,
    status: "ready" as const,
    mimeType:
      a.kind === "image" ? "image/png" : a.kind === "pdf" ? "application/pdf" : "text/plain",
  }));

  // Resolve candidates from persisted attempts
  const candidates: Candidate[] = record.candidates.map((c, i) => {
    const accepted = c.acceptedAttemptId
      ? c.attempts.find((a) => a.attemptId === c.acceptedAttemptId)
      : null;
    const latest = c.attempts[c.attempts.length - 1];
    const output = accepted?.output ?? latest?.output ?? "";
    const isDone = accepted != null && accepted.status === "completed";
    const isRunning = record.status === "running" && latest?.status === "running";
    const status: CandidateStatus = isDone ? "done" : isRunning ? "pending" : "error";
    const segments: CandidateSegment[] = output ? splitSegments(output, c.candidateId) : [];
    const summary = output ? summarize(output) : "";

    const evalReport = record.judge.report?.evaluationsById?.[c.candidateId];
    const scores: Record<string, number> = {};
    if (evalReport?.criterionScores) {
      for (const cs of evalReport.criterionScores) {
        if (cs.score !== undefined) {
          scores[cs.criterionId] = cs.score;
        }
      }
    }

    const weightedScore = evalReport?.overallScore ?? 0;

    return {
      id: c.candidateId,
      model: c.model,
      provider: c.providerId,
      providerId: c.providerId as ProviderId,
      slug: c.slug,
      accent: CANDIDATE_ACCENTS[i % CANDIDATE_ACCENTS.length] ?? "indigo",
      strategy: "Parallel model",
      summary,
      scores,
      weightedScore,
      segments,
      status,
      errorMessage: latest?.error?.message ?? undefined,
      startedAt: accepted?.startedAt ?? latest?.startedAt ?? undefined,
      finishedAt: accepted?.finishedAt ?? latest?.finishedAt ?? undefined,
      tokensIn: accepted?.tokensIn ?? latest?.tokensIn ?? null,
      tokensOut: accepted?.tokensOut ?? latest?.tokensOut ?? null,
    };
  });

  // Resolve Judge Report & Consensus:
  // Rule: After a failed re-judge, judge.status may read 'error' while an earlier
  // accepted report remains authoritative — render from acceptedAttemptId/report.
  const acceptedJudgeAttempt = record.judge.acceptedAttemptId
    ? record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId)
    : null;
  const judgeReport: JudgeReport | null =
    acceptedJudgeAttempt?.report ?? record.judge.report ?? null;
  const consensus: ConsensusBreakdown | null =
    acceptedJudgeAttempt?.consensus ?? record.judge.consensus ?? null;
  const hasAcceptedJudge = judgeReport !== null;

  const judgeStatus: StageStatus = hasAcceptedJudge
    ? "done"
    : record.status === "running" && record.judge.status === "running"
      ? "running"
      : record.judge.status === "error" || record.judge.attempts.some((a) => a.status === "failed")
        ? "error"
        : "idle";

  const judgeError: string | null = hasAcceptedJudge
    ? null
    : (record.judge.attempts.find((a) => a.status === "failed")?.error?.message ??
      (record.judge.status === "error" ? "Judge failed." : null));

  // Resolve Fusion result
  const acceptedFusionAttempt = record.fusion.acceptedAttemptId
    ? record.fusion.attempts.find((a) => a.attemptId === record.fusion.acceptedAttemptId)
    : null;
  const fusedText: string | null = acceptedFusionAttempt?.result ?? null;
  const hasAcceptedFusion = fusedText !== null;

  const fusionStatus: StageStatus = hasAcceptedFusion
    ? "done"
    : record.status === "running" && record.fusion.status === "running"
      ? "running"
      : record.fusion.status === "error" ||
          record.fusion.attempts.some((a) => a.status === "failed")
        ? "error"
        : "idle";

  const fusionError: string | null = hasAcceptedFusion
    ? null
    : (record.fusion.attempts.find((a) => a.status === "failed")?.error?.message ??
      (record.fusion.status === "error" ? "Fusion failed." : null));

  // Derive insufficient candidate state
  const usableDone = candidates.filter((c) => c.status === "done" && c.segments.length > 0).length;
  const failedCount = candidates.length - usableDone;
  const insufficient =
    usableDone < 2 &&
    (record.status === "partial" ||
      record.status === "failed" ||
      record.status === "interrupted") &&
    !hasAcceptedJudge
      ? { done: usableDone, failed: failedCount }
      : null;

  const aborted = record.status === "aborted" || record.status === "interrupted";
  const executionConflict = record.status === "interrupted" ? "Execution was interrupted." : null;

  return {
    mode,
    prompt,
    exampleIndex: -1,
    evaluation,
    slots,
    temperature,
    systemPrompt,
    critic,
    judgeInstruction,
    reasoningPolicy,
    taskBinding,
    attachments,
    attachmentsToJudge: false,
    candidates,
    running: record.status === "running",
    models,
    judgeStatus,
    judgeError,
    consensus,
    judgeReport,
    fusionStatus,
    fusionError,
    fusedText,
    insufficient,
    aborted,
    executionConflict,
    runContext: null,
    runId: record.id,
    qualityRating: 0,
    audit: [],
  };
}

function ModeChip({ mode }: { mode: ComparisonMode }) {
  const isRank = mode === "rank";
  return (
    <span
      className={`shrink-0 rounded-sm px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${
        isRank
          ? "bg-accent/10 text-accent border border-accent/20"
          : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
      }`}
    >
      {mode}
    </span>
  );
}

function TaskBindingBadge({ binding }: { binding: ComparisonTaskBinding }) {
  if (binding.kind === "canonical") {
    return (
      <Link
        to={`/tasks/${binding.taskId}/versions/${binding.taskVersion}`}
        data-task-binding="canonical"
        title={`View canonical Task ${binding.taskId} v${binding.taskVersion}`}
        className="flex min-h-[28px] items-center gap-1 rounded-sm border border-accent/30 bg-accent/[0.06] px-2 font-mono text-xs text-accent transition-colors hover:border-accent hover:bg-accent/10"
      >
        <Sparkles size={12} />
        <span>
          Task {binding.taskId} v{binding.taskVersion}
        </span>
      </Link>
    );
  }

  return (
    <span
      data-task-binding="ad_hoc"
      className="flex min-h-[28px] items-center gap-1 rounded-sm border border-edge bg-panel px-2 font-mono text-xs text-text-secondary"
    >
      Ad hoc · exploratory
    </span>
  );
}

export function ComparisonResultRoute({
  comparisonId: propComparisonId,
  comparisonRepo: propComparisonRepo,
  runRepo: propRunRepo,
  evidenceRepo: propEvidenceRepo,
  models = [],
  onOpenInCompare,
}: ComparisonResultRouteProps) {
  const params = useParams<{ comparisonId: string }>();
  const comparisonId = propComparisonId ?? params.comparisonId ?? "";
  const navigate = useNavigate();
  const repoContext = useContext(RepositoryContext);
  const contextRunRepo = useRunRepository();
  const runRepo = propRunRepo ?? contextRunRepo ?? repoContext.runRepo;
  const contextEvidenceRepo = useEvidenceRepository();
  const evidenceRepo = propEvidenceRepo ?? contextEvidenceRepo ?? repoContext.evidenceRepo ?? null;
  const comparisonRepo = useMemo(() => {
    if (propComparisonRepo) return propComparisonRepo;
    if (repoContext.db && runRepo) {
      return createComparisonRepository(repoContext.db, runRepo);
    }
    return null;
  }, [propComparisonRepo, repoContext.db, runRepo]);

  const [envelope, setEnvelope] = useState<ComparisonResultEnvelope | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairedNotice, setRepairedNotice] = useState(false);

  const [evidenceData, setEvidenceData] = useState<{
    observations: Observation[];
    decisions: Map<string, EligibilityDecision>;
    modelConfigs: Map<string, ModelConfigurationSnapshot>;
    indexJob: EvidenceIndexJob | null;
  } | null>(null);

  useEffect(() => {
    if (!evidenceRepo || !comparisonId) {
      setEvidenceData(null);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const [observationsBySource, job] = await Promise.all([
          evidenceRepo.listObservationsBySource("evaluation", comparisonId),
          evidenceRepo.getIndexJob(comparisonId),
        ]);

        const allObservations = [...observationsBySource];
        if (
          envelope?.index?.activeObservationIds &&
          envelope.index.activeObservationIds.length > 0
        ) {
          const fetchedObs = await Promise.all(
            envelope.index.activeObservationIds.map((id) => evidenceRepo.getObservation(id)),
          );
          for (const obs of fetchedObs) {
            if (obs && !allObservations.some((o) => o.id === obs.id)) {
              allObservations.push(obs);
            }
          }
        }

        const decisionsMap = new Map<string, EligibilityDecision>();
        const configsMap = new Map<string, ModelConfigurationSnapshot>();

        await Promise.all(
          allObservations.map(async (obs) => {
            const [dec, cfg] = await Promise.all([
              evidenceRepo.getActiveDecision(obs.id),
              obs.modelConfigurationId
                ? evidenceRepo.getModelConfiguration(obs.modelConfigurationId)
                : Promise.resolve(null),
            ]);
            if (dec) decisionsMap.set(obs.id, dec);
            if (cfg && obs.modelConfigurationId) configsMap.set(obs.modelConfigurationId, cfg);
          }),
        );

        if (!cancelled) {
          setEvidenceData({
            observations: allObservations,
            decisions: decisionsMap,
            modelConfigs: configsMap,
            indexJob: job,
          });
        }
      } catch {
        // Safe degrade: evidence errors do not crash comparison result view
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [evidenceRepo, comparisonId, envelope?.index?.activeObservationIds]);

  const loadData = useCallback(async () => {
    if (!comparisonRepo || !comparisonId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await comparisonRepo.getComparisonResult(comparisonId);
      setEnvelope(res);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load comparison result");
    } finally {
      setLoading(false);
    }
  }, [comparisonRepo, comparisonId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRepair = useCallback(async () => {
    if (!comparisonRepo || !comparisonId) return;
    setRepairing(true);
    try {
      await comparisonRepo.rebuildComparisonIndex(comparisonId);
      const updated = await comparisonRepo.getComparisonResult(comparisonId);
      setEnvelope(updated);
      setRepairedNotice(true);
      setTimeout(() => setRepairedNotice(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to repair comparison index");
    } finally {
      setRepairing(false);
    }
  }, [comparisonRepo, comparisonId]);

  const handleOpenCompare = useCallback(() => {
    if (!envelope?.record) return;
    const config = runConfigFromRecord(envelope.record);
    onOpenInCompare?.(envelope.record.id, config);
    void navigate("/compare");
  }, [envelope?.record, onOpenInCompare, navigate]);

  const { index, record, warning } = envelope ?? {};

  const candidateReceipts = useMemo(() => {
    if (!record || !index) return [];
    const candidates = record.candidates ?? [];

    return candidates.map((candidate) => {
      const modelKey =
        candidate.modelKey ||
        (candidate.providerId ? `${candidate.providerId}:${candidate.model}` : candidate.model);
      const attemptId = candidate.acceptedAttemptId;

      let matchingObs: Observation | null = null;
      if (evidenceData?.observations && evidenceData.observations.length > 0) {
        if (attemptId) {
          matchingObs =
            evidenceData.observations.find((o) => o.candidateAttemptId === attemptId) ?? null;
        }
        if (!matchingObs && candidate.candidateId) {
          matchingObs =
            evidenceData.observations.find(
              (o) =>
                o.assessmentRef?.candidateAttemptIdsByCandidateId?.[candidate.candidateId] ===
                  o.candidateAttemptId || o.candidateAttemptId === `att-${candidate.candidateId}`,
            ) ?? null;
        }
        if (!matchingObs) {
          for (const o of evidenceData.observations) {
            const cfg = o.modelConfigurationId
              ? evidenceData.modelConfigs.get(o.modelConfigurationId)
              : null;
            if (cfg) {
              const fullKey = `${cfg.providerId}:${cfg.requestedModel}`;
              if (
                fullKey === modelKey ||
                cfg.requestedModel === candidate.model ||
                cfg.requestedModel === candidate.slug ||
                (cfg.resolvedModel && cfg.resolvedModel === candidate.model)
              ) {
                matchingObs = o;
                break;
              }
            }
          }
        }
        if (!matchingObs && evidenceData.observations.length === 1 && candidates.length === 1) {
          matchingObs = evidenceData.observations[0];
        }
      }

      const decision = matchingObs ? (evidenceData?.decisions.get(matchingObs.id) ?? null) : null;
      const modelConfig = matchingObs?.modelConfigurationId
        ? (evidenceData?.modelConfigs.get(matchingObs.modelConfigurationId) ?? null)
        : null;

      const activeAttempt = candidate.acceptedAttemptId
        ? candidate.attempts?.find((a) => a.attemptId === candidate.acceptedAttemptId)
        : candidate.attempts?.[candidate.attempts.length - 1];
      const candidateStatus =
        activeAttempt?.status ?? (candidate.acceptedAttemptId ? "completed" : "failed");
      const isFailed =
        !candidate.acceptedAttemptId ||
        candidateStatus === "failed" ||
        candidateStatus === "aborted";

      return {
        candidate,
        modelKey,
        attemptId,
        matchingObs,
        decision,
        modelConfig,
        candidateStatus,
        isFailed,
      };
    });
  }, [record, index, evidenceData]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading && envelope === undefined) {
    return (
      <div
        aria-busy="true"
        className="flex min-h-[400px] flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      >
        <Loader2 size={24} className="animate-spin-ease text-accent" />
        <p className="font-mono text-sm text-text-secondary">Loading comparison result...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Storage error state
  // ---------------------------------------------------------------------------
  if (error && envelope === undefined) {
    return (
      <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertCircle size={28} className="text-error" />
        <h2 className="font-mono text-sm uppercase tracking-wider text-error">Storage Error</h2>
        <p className="max-w-md text-sm text-text-secondary">{error}</p>
        <button
          type="button"
          onClick={() => void loadData()}
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-4 text-sm text-text hover:border-edge-bright"
        >
          <RotateCcw size={14} /> Retry
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Not found state (null envelope)
  // ---------------------------------------------------------------------------
  if (envelope === null) {
    return (
      <div className="flex min-h-[400px] flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <GitCompare size={32} className="text-text-muted" />
        <h2 className="font-mono text-base font-semibold uppercase tracking-wider text-text">
          Comparison not found
        </h2>
        <p className="max-w-md text-sm text-text-secondary">
          No comparison result index exists with id{" "}
          <span className="font-mono text-text">{comparisonId}</span>.
        </p>
        <Link
          to="/compare"
          className="flex min-h-[44px] items-center gap-2 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
        >
          <ArrowLeft size={14} /> Back to Compare
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Missing source record state (index exists, but source RunRecordV2 is missing)
  // ---------------------------------------------------------------------------
  if (!record && index) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6 scroll-thin">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge pb-4">
          <Link
            to="/compare"
            className="flex min-h-[36px] items-center gap-1.5 font-mono text-xs text-text-secondary hover:text-text"
          >
            <ArrowLeft size={13} /> Back to Compare
          </Link>
        </div>

        <div
          data-state="missing-source"
          className="flex flex-col items-center justify-center gap-3 rounded-lg border border-warning/40 bg-warning/[0.06] p-8 text-center"
        >
          <AlertTriangle size={28} className="text-warning" />
          <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-warning">
            Source record is missing or unavailable
          </h2>
          <p className="max-w-md text-sm text-text-secondary">
            The comparison index <span className="font-mono text-text">{index.id}</span> exists, but
            its exact source run record could not be found in storage. Historical candidate outputs
            and judge reports cannot be reconstructed.
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-muted">
            <span>Title: {index.title}</span>
            <span>·</span>
            <span>Mode: {index.mode}</span>
            <span>·</span>
            <span>Status: {index.status}</span>
          </div>
          <Link
            to="/compare"
            className="mt-4 flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge bg-panel px-4 text-sm text-text-secondary hover:border-edge-bright hover:text-text"
          >
            Back to Compare
          </Link>
        </div>
      </div>
    );
  }

  if (!record || !index) return null;

  const reconstructedState = reconstructStudioStateFromRecord(record, index, models);
  const isInterrupted = record.status === "interrupted";
  const isRunning = record.status === "running";
  const formattedTime = formatRelativeTime(record.createdAt);

  return (
    <div
      data-comparison-result-route=""
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-shell p-3 sm:p-5 scroll-thin"
    >
      {/* ---------------------------------------------------------------------
          Toolbar & Context Header
          --------------------------------------------------------------------- */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge bg-panel px-4 py-3 rounded-t-lg">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Link
            to="/compare"
            className="pressable flex min-h-[36px] items-center gap-1.5 rounded-md border border-edge px-2.5 font-mono text-xs text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
          >
            <ArrowLeft size={13} /> Back to Compare
          </Link>

          <ModeChip mode={index.mode} />

          <div className="flex items-center gap-1.5 font-mono text-xs text-text">
            <StatusMark status={record.status as StatusMarkStatus} />
            <span className="capitalize">{record.status}</span>
          </div>

          <TaskBindingBadge binding={index.taskBinding} />

          <span className="hidden font-mono text-xs text-text-muted sm:inline">
            {formattedTime}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenInCompare && (
            <button
              type="button"
              data-action="open-in-compare"
              onClick={handleOpenCompare}
              title="Preload this configuration into Compare command pane"
              className="pressable flex min-h-[44px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/[0.08] px-3 font-mono text-xs font-semibold text-accent transition-colors hover:bg-accent/[0.14]"
            >
              <Play size={12} /> Open in Compare
            </button>
          )}

          <Link
            to={`/runs/${record.id}`}
            data-action="view-record"
            title="Inspect full immutable run audit record"
            className="pressable flex min-h-[44px] items-center gap-1.5 rounded-md border border-edge px-3 font-mono text-xs text-text-secondary transition-colors hover:border-edge-bright hover:text-text"
          >
            <FileText size={13} /> View exact Record
          </Link>
        </div>
      </div>

      {/* ---------------------------------------------------------------------
          Source / Index Revision Mismatch Warning Banner (spec §11)
          --------------------------------------------------------------------- */}
      {warning?.kind === "source_index_revision_mismatch" && (
        <div
          data-warning="source_index_revision_mismatch"
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-warning/40 bg-warning/[0.08] px-4 py-2.5 text-xs text-warning"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>Source record and index revision mismatch ({warning.message}).</span>
          </div>
          <button
            type="button"
            data-action="repair-index"
            onClick={() => void handleRepair()}
            disabled={repairing}
            className="flex min-h-[44px] items-center gap-1 rounded-sm border border-warning/50 bg-warning/10 px-2.5 font-mono text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
          >
            {repairing ? (
              <Loader2 size={12} className="animate-spin-ease" />
            ) : (
              <RotateCcw size={12} />
            )}
            Repair index
          </button>
        </div>
      )}

      {repairedNotice && (
        <div className="flex shrink-0 items-center gap-2 border-b border-success/40 bg-success/[0.08] px-4 py-2 text-xs text-success">
          <CheckCircle2 size={14} />
          <span>Comparison index successfully repaired and synchronized with source record.</span>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          Task Title & Prompt Bar
          --------------------------------------------------------------------- */}
      <div className="flex flex-col gap-2 border-b border-edge bg-panel/50 px-4 py-3">
        <h1 className="font-sans text-base font-semibold leading-snug text-text">
          {index.title || record.task.title || "Untitled Comparison"}
        </h1>
        <p className="line-clamp-3 text-sm leading-relaxed text-text-secondary">
          {record.task.prompt}
        </p>
      </div>

      {/* ---------------------------------------------------------------------
          Interrupted / Stale Running Status Banners
          --------------------------------------------------------------------- */}
      {isInterrupted && (
        <div
          data-state="interrupted-notice"
          className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/[0.06] p-3 text-xs leading-relaxed text-warning"
        >
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Comparison execution was interrupted.</span> All
            candidate outputs completed before interruption are preserved below.
          </div>
        </div>
      )}

      {isRunning && (
        <div
          data-state="running-notice"
          className="mt-3 flex items-center gap-2 rounded-md border border-accent/40 bg-accent/[0.06] p-3 text-xs text-accent"
        >
          <Loader2 size={14} className="animate-spin-ease" />
          <span>
            This comparison is currently in flight or was left in a running state. Stale records
            render honestly until lease recovery sweeps them.
          </span>
        </div>
      )}

      {/* ---------------------------------------------------------------------
          Evidence Receipt Notice (spec §8)
          --------------------------------------------------------------------- */}
      {/* ---------------------------------------------------------------------
          Evidence Receipts Section (spec §8)
          --------------------------------------------------------------------- */}
      <section
        aria-label="Evidence receipts"
        data-section="evidence-receipts"
        className="mt-3 flex flex-col gap-3"
      >
        {index.taskBinding.kind === "ad_hoc" ? (
          <div
            data-evidence-receipt="ad_hoc"
            className="rounded-md border border-edge bg-card p-3 text-xs text-text-secondary"
          >
            <span className="font-semibold text-text">Evidence status:</span> Preserved as
            exploratory evidence. Save or link this work to a canonical Task before it can
            contribute to a model evidence {"profile"}.
          </div>
        ) : (
          <div
            data-evidence-receipt="canonical"
            className="rounded-md border border-accent/20 bg-accent/[0.04] p-3 text-xs text-text-secondary"
          >
            <span className="font-semibold text-text">Evidence status:</span> Canonical evidence
            bound to Task{" "}
            <Link
              to={`/tasks/${index.taskBinding.taskId}/versions/${index.taskBinding.taskVersion}`}
              className="font-medium text-accent underline hover:text-accent-deep"
            >
              {index.taskBinding.taskId} v{index.taskBinding.taskVersion}
            </Link>
            .
          </div>
        )}

        {candidateReceipts.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {candidateReceipts.map(
              ({
                candidate,
                modelKey,
                attemptId,
                matchingObs,
                decision,
                modelConfig,
                candidateStatus,
                isFailed,
              }) => (
                <div key={candidate.candidateId} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-1 text-xs">
                    <span className="font-mono font-medium text-text">{candidate.model}</span>
                    <span className="text-[11px] text-text-muted capitalize">
                      {candidateStatus}
                    </span>
                  </div>
                  <EvidenceReceipt
                    runId={record.id}
                    attemptId={attemptId}
                    taskId={
                      index.taskBinding.kind === "canonical" ? index.taskBinding.taskId : undefined
                    }
                    modelKey={modelKey}
                    candidateId={candidate.candidateId}
                    evidenceRepo={evidenceRepo}
                    observation={matchingObs}
                    decision={decision}
                    modelConfig={modelConfig}
                    indexJob={evidenceData?.indexJob}
                    missingReason={!matchingObs && isFailed ? "no-accepted-attempt" : undefined}
                    defaultOpen
                  />
                </div>
              ),
            )}
          </div>
        ) : (
          <EvidenceReceipt
            runId={record.id}
            taskId={index.taskBinding.kind === "canonical" ? index.taskBinding.taskId : undefined}
            evidenceRepo={evidenceRepo}
            defaultOpen
          />
        )}
      </section>

      {/* ---------------------------------------------------------------------
          Main Output Surface (reconstructed OutputPane)
          --------------------------------------------------------------------- */}
      <div className="mt-3 min-h-0 flex-1 rounded-b-lg border border-edge bg-panel overflow-hidden">
        <OutputPane state={reconstructedState} />
      </div>
    </div>
  );
}
