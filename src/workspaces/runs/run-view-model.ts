// =============================================================================
// run-view-model — pure view-model formatting for RunSummary / RunRecordV2.
//
// Converts persisted domain records into display-ready strings. No I/O, no side
// effects. Used by RunList, RunDetail, OutputPane recent-runs, and ModelList
// telemetry (Phase 3 Tasks 3.1, 3.2, 3.3, 3.5, 3.6).
// =============================================================================

import type {
  FullRunSummaryV2,
  LegacyRunSummary,
  RunRecordV2,
  RunStatus,
  RunSummary,
} from "../../lib/persistence/run-types";
import {
  DEFAULT_REASONING_POLICY,
  type CostRecord,
  type RunReasoningProvenance,
} from "../../lib/providers/types";
// --- Relative time -----------------------------------------------------------

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

// --- Run row view model -------------------------------------------------------

export interface RunRowViewModel {
  kind: "full" | "legacy";
  id: string;
  taskTitle: string;
  status: RunStatus | null;
  mode: string | null;
  modelCount: number;
  winnerKeys: string[];
  topScore: number | null;
  sourceLabel: string;
  isLegacy: boolean;
  detailAvailable: boolean;
  timestampMs: number;
  relativeTime: string;
  isExperiment: boolean;
}

export function formatRunRow(summary: RunSummary): RunRowViewModel {
  if (summary.kind === "legacy") {
    return formatLegacyRow(summary);
  }
  return formatFullRow(summary);
}

function formatFullRow(s: FullRunSummaryV2): RunRowViewModel {
  const winnerKeys = s.winnerKeys;
  const topScore = winnerKeys.length > 0 ? (s.scoresByModelKey[winnerKeys[0]!] ?? null) : null;
  const isExperiment = s.source.kind === "experiment";

  return {
    kind: "full",
    id: s.id,
    taskTitle: s.taskTitle,
    status: s.status,
    mode: s.mode,
    modelCount: s.modelKeys.length,
    winnerKeys,
    topScore,
    sourceLabel: isExperiment ? "experiment" : "ad hoc",
    isLegacy: false,
    detailAvailable: true,
    timestampMs: s.createdAt,
    relativeTime: formatRelativeTime(s.createdAt),
    isExperiment,
  };
}

function formatLegacyRow(s: LegacyRunSummary): RunRowViewModel {
  return {
    kind: "legacy",
    id: s.id,
    taskTitle: s.taskExcerpt,
    status: null,
    mode: null,
    modelCount: s.modelKeys.length,
    winnerKeys: s.winnerKeys,
    topScore: s.winnerKeys.length > 0 ? (s.scoresByModelKey[s.winnerKeys[0]!] ?? null) : null,
    sourceLabel: "legacy",
    isLegacy: true,
    detailAvailable: false,
    timestampMs: s.createdAt,
    relativeTime: formatRelativeTime(s.createdAt),
    isExperiment: false,
  };
}

// --- Run detail view model ----------------------------------------------------

export interface DetailSection {
  id: string;
  title?: string;
  status?: string;
  timestamp?: string;
  relativeTime?: string;
  startedRelativeTime?: string;
  source?: string;
  timeZone?: string;
  startedAt?: number;
  completedAt?: number | null;
  completedTimestamp?: string;
  completionLabel?: "Completed" | "Ended";
  duration?: string;
  runningDuration?: string;
  reasoning?: RunReasoningProvenance;
  winners?: string[];
  modelCount?: number;
  [key: string]: unknown;
}

export interface RunDetailViewModel {
  sections: DetailSection[];
}

export function formatRunDetail(record: RunRecordV2 | null): RunDetailViewModel | null {
  if (!record) return null;

  const sections: DetailSection[] = [];
  const fallbackCandidateReasoning: RunReasoningProvenance["candidates"] = {};
  for (const candidate of record.candidates) {
    fallbackCandidateReasoning[candidate.modelKey] = {
      requested: DEFAULT_REASONING_POLICY.candidates,
      effective: DEFAULT_REASONING_POLICY.candidates,
      source: "unknown",
    };
  }
  const reasoningProvenance: RunReasoningProvenance = record.reasoning ?? {
    candidates: fallbackCandidateReasoning,
    judge: {
      requested: DEFAULT_REASONING_POLICY.judge,
      effective: DEFAULT_REASONING_POLICY.judge,
      source: "unknown",
    },
  };

  // 1. Header — always present. Completion is an immutable event when present;
  // older records may have only the start timestamp.
  const startedAt = record.createdAt;
  const completedAt = record.completedAt;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startedTimestamp = new Date(startedAt).toLocaleString();
  const startedRelativeTime = formatRelativeTime(startedAt);
  const hasCompletion = completedAt !== null;
  const completedTimestamp = hasCompletion ? new Date(completedAt).toLocaleString() : undefined;
  const completedRelativeTime = hasCompletion ? formatRelativeTime(completedAt) : undefined;
  const completionLabel =
    hasCompletion && record.status === "completed"
      ? "Completed"
      : hasCompletion
        ? "Ended"
        : undefined;
  sections.push({
    id: "header",
    title: record.task.title,
    status: record.status,
    timestamp: startedTimestamp,
    relativeTime: completedRelativeTime ?? startedRelativeTime,
    startedRelativeTime,
    startedAt,
    completedAt,
    completedTimestamp,
    completionLabel,
    duration: hasCompletion ? formatDuration(completedAt - startedAt) : undefined,
    runningDuration:
      record.status === "running" ? formatDuration(Date.now() - startedAt) : undefined,
    timeZone,
    source: record.source.kind === "experiment" ? "experiment" : "ad hoc",
  });

  // 2. Provenance — only for experiment-sourced runs
  if (record.source.kind === "experiment") {
    sections.push({
      id: "provenance",
      experimentId: record.source.experimentId,
      suiteId: record.source.suiteId,
      suiteVersion: record.source.suiteVersion,
      taskId: record.source.taskId,
      experimentTaskAttemptId: record.source.experimentTaskAttemptId,
      trial: record.source.trial,
    });
  }

  // 3. Outcome — always present
  sections.push({
    id: "outcome",
    winners: record.winnerKeys,
    modelCount: record.candidates.length,
    status: record.status,
  });

  // 3.5 Cost breakdown — incremental totals, never double-counting reused
  // source outputs. Each stage reports Reported / Estimated / Unknown.
  const acceptedCandidateCosts: { label: string; usd: number; source: string }[] = [];
  let totalUsd = 0;
  let anyReported = false;
  let anyEstimated = false;
  let anyUnknown = false;
  const addStageCost = (
    label: string,
    cost: CostRecord | null | undefined,
    done: boolean,
  ): void => {
    if (cost?.usd !== null && cost?.usd !== undefined && Number.isFinite(cost.usd)) {
      acceptedCandidateCosts.push({ label, usd: cost.usd, source: cost.source });
      totalUsd += cost.usd;
      if (cost.source === "provider-reported") anyReported = true;
      else if (cost.source === "catalog-estimate") anyEstimated = true;
    } else if (done) {
      anyUnknown = true;
    }
  };
  for (const c of record.candidates) {
    const accepted = c.acceptedAttemptId
      ? c.attempts.find((a) => a.attemptId === c.acceptedAttemptId)
      : undefined;
    // A reused output carries zero incremental cost in this run — the source
    // run already paid for it (spec 06: never double-count reused evidence).
    if (!accepted?.reusedFrom) {
      addStageCost(c.modelKey, accepted?.cost, accepted !== undefined);
    }
  }
  const judgeAccepted = record.judge.acceptedAttemptId
    ? record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId)
    : undefined;
  addStageCost("Judge", judgeAccepted?.cost, record.judge.status === "done");
  const fusionAccepted = record.fusion.acceptedAttemptId
    ? record.fusion.attempts.find((a) => a.attemptId === record.fusion.acceptedAttemptId)
    : undefined;
  addStageCost("Fusion", fusionAccepted?.cost, record.fusion.status === "done");
  const dominant = anyReported
    ? "provider-reported"
    : anyEstimated
      ? "catalog-estimate"
      : "unknown";
  sections.push({
    id: "cost-breakdown",
    stages: acceptedCandidateCosts,
    totalUsd,
    source: dominant,
    unknown: anyUnknown,
  });

  // 4. Candidates selector — always present
  const blindMap = getBlindLabelMap(record);
  sections.push({
    id: "candidates",
    candidates: record.candidates.map((c) => ({
      candidateId: c.candidateId,
      modelKey: c.modelKey,
      provider: c.providerId,
      model: c.model,
      slug: c.slug,
      blindLabel: blindMap[c.candidateId] ?? null,
      status: c.acceptedAttemptId ? "completed" : "failed",
      score: getScoreForCandidate(record, c.candidateId),
      attemptCount: c.attempts.length,
      acceptedAttemptId: c.acceptedAttemptId,
    })),
  });

  // 5. Selected candidate — always present (defaults to first)
  const first = record.candidates[0];
  if (first) {
    sections.push({
      id: "selected-candidate",
      candidateId: first.candidateId,
      modelKey: first.modelKey,
      blindLabel: blindMap[first.candidateId] ?? null,
      output: first.acceptedAttemptId
        ? (first.attempts.find((a) => a.attemptId === first.acceptedAttemptId)?.output ?? null)
        : null,
      tokensIn: first.acceptedAttemptId
        ? (first.attempts.find((a) => a.attemptId === first.acceptedAttemptId)?.tokensIn ?? null)
        : null,
      tokensOut: first.acceptedAttemptId
        ? (first.attempts.find((a) => a.attemptId === first.acceptedAttemptId)?.tokensOut ?? null)
        : null,
    });
  }

  // 6. Judge evidence — always present
  sections.push({
    id: "judge",
    acceptedAttemptId: record.judge.acceptedAttemptId,
    status: record.judge.status,
    attemptCount: record.judge.attempts.length,
    blindMap: record.judge.acceptedAttemptId
      ? (record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId)
          ?.blindLabelToCandidateId ?? {})
      : {},
  });

  // 7. Fusion evidence — only when Fusion attempts exist
  if (record.fusion.attempts.length > 0) {
    sections.push({
      id: "fusion",
      acceptedAttemptId: record.fusion.acceptedAttemptId,
      status: record.fusion.status,
      attemptCount: record.fusion.attempts.length,
      result: record.fusion.acceptedAttemptId
        ? (record.fusion.attempts.find((a) => a.attemptId === record.fusion.acceptedAttemptId)
            ?.result ?? null)
        : null,
    });
  }

  // 8. Task/config — always present (collapsed by default)
  sections.push({
    id: "task-config",
    prompt: record.task.prompt,
    systemPrompt: record.task.systemPrompt,
    temperature: record.task.temperature,
    modelRoster: record.candidates.map((c) => c.modelKey),
    reasoning: reasoningProvenance,
  });

  return { sections };
}

// --- Helpers ------------------------------------------------------------------

function getBlindLabelMap(record: RunRecordV2): Record<string, string> {
  if (!record.judge.acceptedAttemptId) return {};
  const att = record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId);
  if (!att) return {};
  // Invert: candidateId → blindLabel
  const inverted: Record<string, string> = {};
  for (const [label, candidateId] of Object.entries(att.blindLabelToCandidateId)) {
    inverted[candidateId] = label;
  }
  return inverted;
}

function getScoreForCandidate(record: RunRecordV2, candidateId: string): number | null {
  if (!record.judge.report) return null;
  // JudgeReport.evaluationsById is keyed by resolved candidate ID.
  const ev = record.judge.report.evaluationsById[candidateId];
  return ev?.overallScore ?? null;
}
