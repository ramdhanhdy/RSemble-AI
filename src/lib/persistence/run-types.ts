// =============================================================================
// RSemble AI — Persistence domain types for run records
//
// Source of truth for the on-disk run record schema (v2) plus the legacy import
// summary shape. Every type that crosses the persistence boundary has a paired
// runtime type guard so imported JSON is never trusted via a TypeScript cast.
//
// Validation rules (see workbench plan):
//  - Reject unknown schema versions
//  - Reject records with missing IDs, prohibited transport/credential fields,
//    or invalid status values
//  - Provider-scoped model keys remain opaque strings; every full candidate has
//    immutable candidateId, slotId, and modelKey
//  - Legacy summaries cannot carry fabricated status, mode, Judge, source, or
//    evaluation fields
//  - Winner arrays preserve zero, one, or multiple tied winners
//  - Experiment run sources require immutable experimentTaskAttemptId
//  - Accept empty Fusion-attempt history and discriminated legacy summary-only
//    records
//  - Never persist credentials, authorization headers, or environment dumps —
//    validators reject records containing keys like apiKey, authorization,
//    token, secret, password, env
// =============================================================================

import type { ChatMessage } from "../providers/types";
import type { ConsensusBreakdown, JudgeReport } from "../../studio-data";
import type { StageStatus } from "../../studio-engine";
import { isEvaluationProfile, type EvaluationProfileSnapshot } from "../evaluations/evaluation-types";

// --- Status enums -------------------------------------------------------------

export type RunStatus =
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "aborted"
  | "interrupted";

export type AttemptStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "interrupted";

const RUN_STATUSES: readonly RunStatus[] = [
  "running",
  "completed",
  "partial",
  "failed",
  "aborted",
  "interrupted",
];

const ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  "running",
  "completed",
  "failed",
  "aborted",
  "interrupted",
];

const STAGE_STATUSES: readonly StageStatus[] = ["idle", "running", "done", "error"];

/** Keys that must never appear in a persisted record (credential/transport leak). */
const PROHIBITED_KEYS: ReadonlySet<string> = new Set([
  "apiKey",
  "authorization",
  "token",
  "secret",
  "password",
  "env",
]);

// --- Shared primitives --------------------------------------------------------

export interface ExecutionFence {
  ownerId: string;
  fence: number;
}

export interface PersistedError {
  message: string;
  code?: string;
  /** Normalized error category (e.g. provider, aborted, validation). */
  category?: string;
  /** Pipeline stage that produced the error (candidate, judge, fusion). */
  stage?: string;
  /** Provider model/slug involved in the failure, when known. */
  model?: string;
  /** Epoch ms when the error was sanitized for persistence. */
  at?: number;
}

export type RunSource =
  | { kind: "adhoc" }
  | {
      kind: "experiment";
      experimentId: string;
      suiteId: string;
      suiteVersion: number;
      protocolFingerprint: string;
      taskId: string;
      experimentTaskAttemptId: string;
      trial: number;
    };

// --- Run summaries ------------------------------------------------------------

export interface FullRunSummaryV2 {
  kind: "full";
  schemaVersion: 2;
  id: string;
  revision: number;
  createdAt: number;
  completedAt: number | null;
  status: RunStatus;
  mode: "rank" | "fuse";
  source: RunSource;
  taskTitle: string;
  taskExcerpt: string;
  modelKeys: string[];
  winnerKeys: string[];
  scoresByModelKey: Record<string, number>;
  judgeModelKey: string | null;
  evaluationProfileId: string | null;
  evaluationProfileVersion: number | null;
  detailAvailable: true;
  searchText: string;
}

export interface LegacyRunSummary {
  kind: "legacy";
  schemaVersion: "1-import";
  id: string;
  createdAt: number;
  taskExcerpt: string;
  modelKeys: string[];
  winnerKeys: string[];
  scoresByModelKey: Record<string, number>;
  detailAvailable: false;
  searchText: string;
}

export type RunSummary = FullRunSummaryV2 | LegacyRunSummary;

// --- Candidate / judge / fusion attempt records -------------------------------

export interface CandidateAttemptRecord {
  attemptId: string;
  /** Exact rendered messages sent to the provider for this attempt. */
  messages: ChatMessage[];
  startedAt: number;
  finishedAt: number | null;
  status: AttemptStatus;
  output: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: PersistedError | null;
}

export interface PersistedCandidate {
  candidateId: string;
  slotId: string;
  modelKey: string;
  providerId: string;
  model: string;
  slug: string;
  acceptedAttemptId: string | null;
  attempts: CandidateAttemptRecord[];
}

export interface JudgeAttemptRecord {
  attemptId: string;
  providerId: string;
  model: string;
  instruction: string;
  messages: ChatMessage[];
  blindLabelToCandidateId: Record<string, string>;
  candidateAttemptIdsByCandidateId: Record<string, string>;
  startedAt: number;
  finishedAt: number | null;
  status: AttemptStatus;
  error: PersistedError | null;
  report: JudgeReport | null;
  consensus: ConsensusBreakdown | null;
}

export interface FusionAttemptRecord {
  attemptId: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  sourceJudgeAttemptId: string;
  candidateAttemptIdsByCandidateId: Record<string, string>;
  startedAt: number;
  finishedAt: number | null;
  status: AttemptStatus;
  error: PersistedError | null;
  result: string | null;
}

// --- Full run record ----------------------------------------------------------

export interface RunRecordV2 {
  schemaVersion: 2;
  id: string;
  revision: number;
  execution: ExecutionFence;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  status: RunStatus;
  mode: "rank" | "fuse";
  source: RunSource;
  task: { title: string; prompt: string; systemPrompt: string; temperature: number };
  evaluation: { profile: EvaluationProfileSnapshot | null; candidateMessages: ChatMessage[] };
  candidates: PersistedCandidate[];
  judge: {
    status: StageStatus;
    acceptedAttemptId: string | null;
    report: JudgeReport | null;
    consensus: ConsensusBreakdown | null;
    attempts: JudgeAttemptRecord[];
  };
  fusion: {
    status: StageStatus;
    acceptedAttemptId: string | null;
    attempts: FusionAttemptRecord[];
  };
  winnerKeys: string[];
}

// --- Query / archive ----------------------------------------------------------

export interface RunListQuery {
  text?: string;
  modelKey?: string;
  status?: RunStatus;
  mode?: "rank" | "fuse";
  source?: "adhoc" | "experiment" | "legacy";
  limit?: number;
  offset?: number;
}

export interface RunArchiveV1 {
  schemaVersion: 1;
  exportedAt: number;
  runs: RunRecordV2[];
  summaries: RunSummary[];
}

export interface RunImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// =============================================================================
// Runtime validators (type guards)
// =============================================================================

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}

/** Canonical record guard for persistence/type-guard modules — reuse, do not redefine. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isNumberRecord(v: unknown): v is Record<string, number> {
  if (!isRecord(v)) return false;
  for (const k of Object.keys(v)) {
    if (!isNumber(v[k])) return false;
  }
  return true;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isRecord(v)) return false;
  for (const k of Object.keys(v)) {
    if (!isString(v[k])) return false;
  }
  return true;
}

/** Deep-scan a value for prohibited credential/transport keys. */
function hasProhibitedKeys(v: unknown): boolean {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (hasProhibitedKeys(item)) return true;
    }
    return false;
  }
  if (isRecord(v)) {
    for (const key of Object.keys(v)) {
      if (PROHIBITED_KEYS.has(key)) return true;
      if (hasProhibitedKeys(v[key])) return true;
    }
  }
  return false;
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (!isRecord(v)) return false;
  return (
    (v.role === "system" || v.role === "user" || v.role === "assistant") &&
    isString(v.content)
  );
}

function isChatMessageArray(v: unknown): v is ChatMessage[] {
  return Array.isArray(v) && v.every(isChatMessage);
}

function isJudgeReport(v: unknown): v is JudgeReport {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.labelMap)) return false;
  for (const entry of v.labelMap) {
    if (!isRecord(entry) || !isString(entry.label) || !isString(entry.candidateId)) {
      return false;
    }
  }
  if (!isRecord(v.evaluationsById)) return false;
  if (!Array.isArray(v.comparisons)) return false;
  return true;
}

function isConsensusBreakdown(v: unknown): v is ConsensusBreakdown {
  if (!isRecord(v)) return false;
  if (!isStringArray(v.consensus)) return false;
  if (!isStringArray(v.contradictions)) return false;
  if (!Array.isArray(v.uniqueInsights)) return false;
  return true;
}

// --- Public primitive validators ----------------------------------------------

export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v);
}

export function isAttemptStatus(v: unknown): v is AttemptStatus {
  return typeof v === "string" && (ATTEMPT_STATUSES as readonly string[]).includes(v);
}

function isStageStatus(v: unknown): v is StageStatus {
  return typeof v === "string" && (STAGE_STATUSES as readonly string[]).includes(v);
}

export function isPersistedError(v: unknown): v is PersistedError {
  if (!isRecord(v)) return false;
  if (!isString(v.message)) return false;
  if (v.code !== undefined && !isString(v.code)) return false;
  if (v.category !== undefined && !isString(v.category)) return false;
  if (v.stage !== undefined && !isString(v.stage)) return false;
  if (v.model !== undefined && !isString(v.model)) return false;
  if (v.at !== undefined && !isNumber(v.at)) return false;
  return true;
}

export function isExecutionFence(v: unknown): v is ExecutionFence {
  return isRecord(v) && isString(v.ownerId) && isNumber(v.fence);
}

export function isRunSource(v: unknown): v is RunSource {
  if (!isRecord(v)) return false;
  if (v.kind === "adhoc") return true;
  if (v.kind === "experiment") {
    return (
      isString(v.experimentId) &&
      isString(v.suiteId) &&
      isNumber(v.suiteVersion) &&
      isString(v.protocolFingerprint) &&
      isString(v.taskId) &&
      // Experiment run sources require an immutable, non-empty attempt id.
      isNonEmptyString(v.experimentTaskAttemptId) &&
      isNumber(v.trial)
    );
  }
  return false;
}

// --- Attempt records ----------------------------------------------------------

function isCandidateAttemptRecord(v: unknown): v is CandidateAttemptRecord {
  if (!isRecord(v)) return false;
  return (
    isString(v.attemptId) &&
    isChatMessageArray(v.messages) &&
    isNumber(v.startedAt) &&
    (v.finishedAt === null || isNumber(v.finishedAt)) &&
    isAttemptStatus(v.status) &&
    (v.output === null || isString(v.output)) &&
    (v.tokensIn === null || isNumber(v.tokensIn)) &&
    (v.tokensOut === null || isNumber(v.tokensOut)) &&
    (v.error === null || isPersistedError(v.error))
  );
}

function isJudgeAttemptRecord(v: unknown): v is JudgeAttemptRecord {
  if (!isRecord(v)) return false;
  return (
    isString(v.attemptId) &&
    isString(v.providerId) &&
    isString(v.model) &&
    isString(v.instruction) &&
    isChatMessageArray(v.messages) &&
    isStringRecord(v.blindLabelToCandidateId) &&
    isStringRecord(v.candidateAttemptIdsByCandidateId) &&
    isNumber(v.startedAt) &&
    (v.finishedAt === null || isNumber(v.finishedAt)) &&
    isAttemptStatus(v.status) &&
    (v.error === null || isPersistedError(v.error)) &&
    (v.report === null || isJudgeReport(v.report)) &&
    (v.consensus === null || isConsensusBreakdown(v.consensus))
  );
}

function isFusionAttemptRecord(v: unknown): v is FusionAttemptRecord {
  if (!isRecord(v)) return false;
  return (
    isString(v.attemptId) &&
    isString(v.providerId) &&
    isString(v.model) &&
    isChatMessageArray(v.messages) &&
    isString(v.sourceJudgeAttemptId) &&
    isStringRecord(v.candidateAttemptIdsByCandidateId) &&
    isNumber(v.startedAt) &&
    (v.finishedAt === null || isNumber(v.finishedAt)) &&
    isAttemptStatus(v.status) &&
    (v.error === null || isPersistedError(v.error)) &&
    (v.result === null || isString(v.result))
  );
}

// --- Candidate ---------------------------------------------------------------

export function isPersistedCandidate(v: unknown): v is PersistedCandidate {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.candidateId) &&
    isNonEmptyString(v.slotId) &&
    isNonEmptyString(v.modelKey) &&
    isString(v.providerId) &&
    isString(v.model) &&
    isString(v.slug) &&
    (v.acceptedAttemptId === null || isString(v.acceptedAttemptId)) &&
    Array.isArray(v.attempts) &&
    v.attempts.every(isCandidateAttemptRecord) &&
    !hasProhibitedKeys(v)
  );
}

// --- Summaries ----------------------------------------------------------------

/** Fields a legacy summary must never fabricate. */
const LEGACY_FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "status",
  "mode",
  "judgeModelKey",
  "source",
  "evaluationProfileId",
  "evaluationProfileVersion",
]);

export function isFullRunSummaryV2(v: unknown): v is FullRunSummaryV2 {
  if (!isRecord(v)) return false;
  if (v.kind !== "full") return false;
  if (v.schemaVersion !== 2) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (v.completedAt !== null && !isNumber(v.completedAt)) return false;
  if (!isRunStatus(v.status)) return false;
  if (v.mode !== "rank" && v.mode !== "fuse") return false;
  if (!isRunSource(v.source)) return false;
  if (!isString(v.taskTitle)) return false;
  if (!isString(v.taskExcerpt)) return false;
  if (!isStringArray(v.modelKeys)) return false;
  if (!isStringArray(v.winnerKeys)) return false;
  if (!isNumberRecord(v.scoresByModelKey)) return false;
  if (v.judgeModelKey !== null && !isString(v.judgeModelKey)) return false;
  if (v.evaluationProfileId !== null && !isString(v.evaluationProfileId)) return false;
  if (v.evaluationProfileVersion !== null && !isNumber(v.evaluationProfileVersion)) return false;
  if (v.detailAvailable !== true) return false;
  if (!isString(v.searchText)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isLegacyRunSummary(v: unknown): v is LegacyRunSummary {
  if (!isRecord(v)) return false;
  if (v.kind !== "legacy") return false;
  if (v.schemaVersion !== "1-import") return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isString(v.taskExcerpt)) return false;
  if (!isStringArray(v.modelKeys)) return false;
  if (!isStringArray(v.winnerKeys)) return false;
  if (!isNumberRecord(v.scoresByModelKey)) return false;
  if (v.detailAvailable !== false) return false;
  if (!isString(v.searchText)) return false;
  // Legacy summaries cannot carry fabricated status/mode/Judge/source/evaluation.
  for (const key of Object.keys(v)) {
    if (LEGACY_FORBIDDEN_KEYS.has(key)) return false;
  }
  if (hasProhibitedKeys(v)) return false;
  return true;
}

export function isRunSummary(v: unknown): v is RunSummary {
  if (!isRecord(v)) return false;
  if (v.kind === "full") return isFullRunSummaryV2(v);
  if (v.kind === "legacy") return isLegacyRunSummary(v);
  return false;
}

// --- Run record ---------------------------------------------------------------

export function isRunRecordV2(v: unknown): v is RunRecordV2 {
  if (!isRecord(v)) return false;
  if (v.schemaVersion !== 2) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isNumber(v.revision)) return false;
  if (!isExecutionFence(v.execution)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.completedAt !== null && !isNumber(v.completedAt)) return false;
  if (!isRunStatus(v.status)) return false;
  if (v.mode !== "rank" && v.mode !== "fuse") return false;
  if (!isRunSource(v.source)) return false;

  const task = v.task;
  if (
    !isRecord(task) ||
    !isString(task.title) ||
    !isString(task.prompt) ||
    !isString(task.systemPrompt) ||
    !isNumber(task.temperature)
  ) {
    return false;
  }

  const evaluation = v.evaluation;
  if (
    !isRecord(evaluation) ||
    !isChatMessageArray(evaluation.candidateMessages) ||
    (evaluation.profile !== null && !isEvaluationProfile(evaluation.profile))
  ) {
    return false;
  }

  if (!Array.isArray(v.candidates) || !v.candidates.every(isPersistedCandidate)) {
    return false;
  }

  const judge = v.judge;
  if (
    !isRecord(judge) ||
    !isStageStatus(judge.status) ||
    (judge.acceptedAttemptId !== null && !isString(judge.acceptedAttemptId)) ||
    (judge.report !== null && !isJudgeReport(judge.report)) ||
    (judge.consensus !== null && !isConsensusBreakdown(judge.consensus)) ||
    !Array.isArray(judge.attempts) ||
    !judge.attempts.every(isJudgeAttemptRecord)
  ) {
    return false;
  }

  const fusion = v.fusion;
  if (
    !isRecord(fusion) ||
    !isStageStatus(fusion.status) ||
    (fusion.acceptedAttemptId !== null && !isString(fusion.acceptedAttemptId)) ||
    // Empty Fusion-attempt history is accepted.
    !Array.isArray(fusion.attempts) ||
    !fusion.attempts.every(isFusionAttemptRecord)
  ) {
    return false;
  }

  // Winner arrays preserve zero, one, or multiple tied winners.
  if (!isStringArray(v.winnerKeys)) return false;

  if (hasProhibitedKeys(v)) return false;
  return true;
}

// --- Archive ------------------------------------------------------------------

export function isRunArchiveV1(v: unknown): v is RunArchiveV1 {
  if (!isRecord(v)) return false;
  if (v.schemaVersion !== 1) return false;
  if (!isNumber(v.exportedAt)) return false;
  if (!Array.isArray(v.runs) || !v.runs.every(isRunRecordV2)) return false;
  if (!Array.isArray(v.summaries) || !v.summaries.every(isRunSummary)) return false;
  if (hasProhibitedKeys(v)) return false;
  return true;
}
