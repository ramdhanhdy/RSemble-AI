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

import type {
  ChatMessage,
  CostRecord,
  InputUsageEstimate,
  ReasoningEffort,
  RunReasoningProvenance,
  UsageBreakdown,
} from "../providers/types";
import type {
  CandidateEvaluation,
  ConsensusBreakdown,
  JudgeComparison,
  JudgeCriterionScore,
  JudgeDeduction,
  JudgeReport,
} from "../../studio-data";
import type { StageStatus } from "../../studio-engine";
import {
  isEvaluationRubric,
  isExperimentTaskExecutionPlan,
  type RubricSnapshot,
  type ExperimentTaskExecutionPlan,
} from "../evaluations/evaluation-types";

// --- Status enums -------------------------------------------------------------

export type RunStatus = "running" | "completed" | "partial" | "failed" | "aborted" | "interrupted";

export type AttemptStatus = "running" | "completed" | "failed" | "aborted" | "interrupted";

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
  /** Exact acquisition token for fenced paid Compare writes; absent on legacy records. */
  leaseId?: string;
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
  /** Deadline classification/provenance, when this was a timeout. */
  timeoutKind?: "connect_timeout" | "stream_inactivity_timeout" | "overall_timeout";
  configuredDurationMs?: number;
  elapsedMs?: number;
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
      /** Compound-repair metadata on the experiment branch (spec §11.4);
       *  widened to the roster-extension discriminant (roster spec §6.4). The
       *  property name is legacy persisted schema; branch on `kind`. */
      repair?: ExperimentTaskExecutionPlan;
    };

// --- Run summaries ------------------------------------------------------------

/**
 * Attachment metadata persisted on a run record (spec §9, plan 7.7.2).
 * Metadata ONLY — bytes and extracted text never leave the tab's memory.
 */
export interface TaskAttachmentMeta {
  name: string;
  kind: "image" | "pdf" | "text" | "doc";
  bytes: number;
}

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
  /** Score domain for display (spec §16.3): "compliance" when the run used a
   *  compliance-only rubric (winner score = C in [0,1]). */
  scoreDomain?: "rank" | "compliance";
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
  /** Provider-reported or estimated token usage; absent on old records. */
  usage?: UsageBreakdown;
  /** Additive input estimate provenance; absent on old records. */
  inputEstimate?: InputUsageEstimate;
  /** Reported / estimated / unknown cost provenance; absent on old records. */
  cost?: CostRecord;
  error: PersistedError | null;
  /** Compound-repair provenance: this attempt's output was copied from an
   *  earlier immutable run's accepted candidate (spec §11.4). */
  reusedFrom?: {
    sourceRunId: string;
    sourceCandidateId: string;
    sourceAttemptId: string;
  };
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
  usage?: UsageBreakdown;
  inputEstimate?: InputUsageEstimate;
  cost?: CostRecord;
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
  usage?: UsageBreakdown;
  inputEstimate?: InputUsageEstimate;
  cost?: CostRecord;
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
  /** Attachment metadata for the run's task — absent for older records. */
  attachments?: TaskAttachmentMeta[];
  evaluation: { profile: RubricSnapshot | null; candidateMessages: ChatMessage[] };
  /** Requested/effective effort snapshot; absent on pre-policy schema-v2 runs. */
  reasoning?: RunReasoningProvenance;
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

const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = [
  "provider-default",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function isReasoningSetting(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    typeof v.requested === "string" &&
    REASONING_EFFORT_VALUES.includes(v.requested as ReasoningEffort) &&
    typeof v.effective === "string" &&
    REASONING_EFFORT_VALUES.includes(v.effective as ReasoningEffort) &&
    (v.source === "catalog" || v.source === "provider-docs" || v.source === "unknown")
  );
}

function isReasoningProvenance(v: unknown): v is RunReasoningProvenance {
  if (!isRecord(v) || !isRecord(v.candidates) || !isReasoningSetting(v.judge)) return false;
  return Object.values(v.candidates).every(isReasoningSetting);
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
    (v.role === "system" || v.role === "user" || v.role === "assistant") && isString(v.content)
  );
}

function isChatMessageArray(v: unknown): v is ChatMessage[] {
  return Array.isArray(v) && v.every(isChatMessage);
}

function isJudgeDeduction(v: unknown): v is JudgeDeduction {
  if (!isRecord(v)) return false;
  if (v.severity !== "minor" && v.severity !== "major") return false;
  return isString(v.reason);
}

const JUDGE_CRITERION_KINDS: ReadonlySet<string> = new Set(["graded", "binary"]);

function isJudgeCriterionScore(v: unknown): v is JudgeCriterionScore {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.criterionId)) return false;
  if (!isString(v.label)) return false;
  if (v.score !== undefined && !isNumber(v.score)) return false;
  if (v.value !== undefined && typeof v.value !== "boolean") return false;
  if (v.kind !== undefined && (typeof v.kind !== "string" || !JUDGE_CRITERION_KINDS.has(v.kind))) {
    return false;
  }
  return isString(v.rationale);
}

function isCandidateEvaluation(v: unknown): v is CandidateEvaluation {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.candidateId)) return false;
  if (!isString(v.blindLabel)) return false;
  if (!isNumber(v.overallScore)) return false;
  if (!isString(v.position)) return false;
  if (!isString(v.rationale)) return false;
  if (!isStringArray(v.strengths)) return false;
  if (!Array.isArray(v.deductions) || !v.deductions.every(isJudgeDeduction)) return false;
  if (!isStringArray(v.missedRequirements)) return false;
  if (!Array.isArray(v.criterionScores) || !v.criterionScores.every(isJudgeCriterionScore)) {
    return false;
  }
  return true;
}

function isStringPair(v: unknown): v is [string, string] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "string";
}

function isJudgeComparison(v: unknown): v is JudgeComparison {
  if (!isRecord(v)) return false;
  if (!isStringPair(v.candidateIds)) return false;
  if (!isStringPair(v.blindLabels)) return false;
  return isString(v.reason);
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
  for (const key of Object.keys(v.evaluationsById)) {
    if (!isCandidateEvaluation(v.evaluationsById[key])) return false;
  }
  if (!Array.isArray(v.comparisons) || !v.comparisons.every(isJudgeComparison)) return false;
  return true;
}

function isConsensusBreakdown(v: unknown): v is ConsensusBreakdown {
  if (!isRecord(v)) return false;
  if (!isStringArray(v.consensus)) return false;
  if (!isStringArray(v.contradictions)) return false;
  if (!Array.isArray(v.uniqueInsights)) return false;
  for (const insight of v.uniqueInsights) {
    if (!isRecord(insight) || !isString(insight.source) || !isString(insight.insight)) {
      return false;
    }
  }
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
  if (
    v.timeoutKind !== undefined &&
    !["connect_timeout", "stream_inactivity_timeout", "overall_timeout"].includes(
      v.timeoutKind as string,
    )
  )
    return false;
  if (v.configuredDurationMs !== undefined && !isNumber(v.configuredDurationMs)) return false;
  if (v.elapsedMs !== undefined && !isNumber(v.elapsedMs)) return false;
  return true;
}

export function isExecutionFence(v: unknown): v is ExecutionFence {
  return (
    isRecord(v) &&
    isString(v.ownerId) &&
    isNumber(v.fence) &&
    (v.leaseId === undefined || isNonEmptyString(v.leaseId))
  );
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
      isNumber(v.trial) &&
      (v.repair === undefined || isExperimentTaskExecutionPlan(v.repair))
    );
  }
  return false;
}

// --- Attempt records ----------------------------------------------------------

function isReusedFrom(v: unknown): boolean {
  if (!isRecord(v)) return false;
  const { sourceRunId, sourceCandidateId, sourceAttemptId } = v;
  if (!isNonEmptyString(sourceRunId) || /^(sk-|AIza|Bearer\s)/i.test(sourceRunId)) return false;
  if (!isNonEmptyString(sourceCandidateId) || /^(sk-|AIza|Bearer\s)/i.test(sourceCandidateId))
    return false;
  if (!isNonEmptyString(sourceAttemptId) || /^(sk-|AIza|Bearer\s)/i.test(sourceAttemptId))
    return false;
  return true;
}

function isFiniteNonNegativeNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isTokenField(value: unknown): boolean {
  return value === null || isFiniteNonNegativeNumber(value);
}

export function isUsageBreakdown(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return (
    isTokenField(v.inputTokens) &&
    isTokenField(v.outputTokens) &&
    isTokenField(v.reasoningTokens) &&
    isTokenField(v.cacheReadTokens) &&
    isTokenField(v.cacheWriteTokens)
  );
}

function isInputUsageEstimate(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (!(v.totalTokens === null || isFiniteNonNegativeNumber(v.totalTokens))) return false;
  if (!(v.textTokens === null || isFiniteNonNegativeNumber(v.textTokens))) return false;
  if (
    !["provider-reported", "text-heuristic", "provider-specific", "unknown"].includes(
      v.method as string,
    )
  )
    return false;
  if (typeof v.partial !== "boolean") return false;
  return v.note === undefined || isString(v.note);
}

export function isCostRecord(v: unknown): boolean {
  if (!isRecord(v)) return false;
  if (!(v.usd === null || isFiniteNonNegativeNumber(v.usd))) return false;
  return (
    v.source === "provider-reported" || v.source === "catalog-estimate" || v.source === "unknown"
  );
}

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
    (v.error === null || isPersistedError(v.error)) &&
    (v.reusedFrom === undefined || isReusedFrom(v.reusedFrom)) &&
    (v.usage === undefined || isUsageBreakdown(v.usage)) &&
    (v.inputEstimate === undefined || isInputUsageEstimate(v.inputEstimate)) &&
    (v.cost === undefined || isCostRecord(v.cost))
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
    (v.consensus === null || isConsensusBreakdown(v.consensus)) &&
    (v.usage === undefined || isUsageBreakdown(v.usage)) &&
    (v.inputEstimate === undefined || isInputUsageEstimate(v.inputEstimate)) &&
    (v.cost === undefined || isCostRecord(v.cost))
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
    (v.result === null || isString(v.result)) &&
    (v.usage === undefined || isUsageBreakdown(v.usage)) &&
    (v.inputEstimate === undefined || isInputUsageEstimate(v.inputEstimate)) &&
    (v.cost === undefined || isCostRecord(v.cost))
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

// --- Run record cross-reference validation -----------------------------------
//
// Protects imported/stored records against stale-evidence corruption: an
// accepted pointer must resolve to a completed accepted attempt, and the
// accepted Judge/Fusion candidate maps must match the current accepted
// candidate attempt set. A Fusion source Judge must match the current
// accepted Judge. These guards reject malformed nested judge/fusion reports
// before any UI/export dereferences them (spec §5.6, §11.3, archive import).

/** An accepted candidate pointer must resolve to a completed attempt with a
 * non-null output. A null acceptedAttemptId is valid (candidate not yet
 * accepted or failed). */
function acceptedCandidateAttemptIsValid(candidate: PersistedCandidate): boolean {
  if (candidate.acceptedAttemptId === null) return true;
  const attempt = candidate.attempts.find((a) => a.attemptId === candidate.acceptedAttemptId);
  return (
    attempt !== undefined &&
    attempt.status === "completed" &&
    attempt.output !== null &&
    attempt.output !== undefined
  );
}

/** Build the current accepted candidate-id → attempt-id map from the
 * record's candidates. Only candidates with a non-null acceptedAttemptId
 * are included. This is the authoritative set the accepted Judge and
 * Fusion candidate maps must match exactly (both directions). */
function currentAcceptedCandidateMap(record: RunRecordV2): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of record.candidates) {
    if (c.acceptedAttemptId !== null) {
      map[c.candidateId] = c.acceptedAttemptId;
    }
  }
  return map;
}

/** Exact structural equality between two candidate-id → attempt-id maps:
 * same keys, same values, no extra entries on either side. */
function candidateMapsExactlyEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/** An accepted Judge pointer must resolve to a completed attempt with a
 * non-null report, AND its candidateAttemptIdsByCandidateId must be exactly
 * equal to the current accepted candidate-id → attempt-id map (both
 * directions). This rejects stale extra entries (e.g. a candidate whose
 * accepted attempt was invalidated but whose score lingers in the Judge
 * map/report) as well as missing entries. A null acceptedAttemptId is
 * valid (Judge not yet accepted or failed). */
function acceptedJudgeCrossReferencesValid(record: RunRecordV2): boolean {
  const { judge } = record;
  if (judge.acceptedAttemptId === null) return true;
  const attempt = judge.attempts.find((a) => a.attemptId === judge.acceptedAttemptId);
  if (attempt === undefined || attempt.status !== "completed" || judge.report === null) {
    return false;
  }
  return candidateMapsExactlyEqual(
    attempt.candidateAttemptIdsByCandidateId,
    currentAcceptedCandidateMap(record),
  );
}

/** An accepted Fusion pointer must resolve to a completed attempt with a
 * non-null result, its sourceJudgeAttemptId must match the current accepted
 * Judge, AND its candidateAttemptIdsByCandidateId must be exactly equal to
 * the current accepted candidate-id → attempt-id map (both directions) —
 * which must also match the source accepted Judge's candidate map. A null
 * acceptedAttemptId is valid (Fusion not yet accepted, failed, or never
 * requested). */
function acceptedFusionCrossReferencesValid(record: RunRecordV2): boolean {
  const { fusion } = record;
  if (fusion.acceptedAttemptId === null) return true;
  const attempt = fusion.attempts.find((a) => a.attemptId === fusion.acceptedAttemptId);
  if (attempt === undefined || attempt.status !== "completed" || attempt.result === null) {
    return false;
  }
  // The accepted Fusion's source Judge must match the current accepted Judge.
  // When the Judge has been invalidated (null acceptedAttemptId), a leftover
  // accepted Fusion is stale evidence.
  if (
    record.judge.acceptedAttemptId === null ||
    attempt.sourceJudgeAttemptId !== record.judge.acceptedAttemptId
  ) {
    return false;
  }
  const currentMap = currentAcceptedCandidateMap(record);
  // Fusion candidate map must exactly match the current accepted set.
  if (!candidateMapsExactlyEqual(attempt.candidateAttemptIdsByCandidateId, currentMap)) {
    return false;
  }
  // Fusion candidate map must also exactly match its source accepted Judge's
  // candidate map — a Fusion that judges a different candidate set than its
  // source Judge is stale evidence.
  const sourceJudgeAttempt = record.judge.attempts.find(
    (a) => a.attemptId === attempt.sourceJudgeAttemptId,
  );
  if (sourceJudgeAttempt === undefined) return false;
  return candidateMapsExactlyEqual(
    attempt.candidateAttemptIdsByCandidateId,
    sourceJudgeAttempt.candidateAttemptIdsByCandidateId,
  );
}
// --- Run record ---------------------------------------------------------------

/**
 * Repair records written before the accepted-evidence cross-reference guard
 * existed. The attempts themselves are immutable history; only pointers and
 * values derived from now-invalid pointers are cleared. A null result means
 * the record was not structurally close enough to repair safely.
 */
export function repairRunRecordForCompatibility(v: unknown): RunRecordV2 | null {
  if (!isRecord(v) || v.schemaVersion !== 2) return null;
  if (!Array.isArray(v.candidates) || !isRecord(v.judge) || !isRecord(v.fusion)) return null;
  if (!Array.isArray(v.judge.attempts) || !Array.isArray(v.fusion.attempts)) return null;
  if (!v.candidates.every(isPersistedCandidate)) return null;
  if (!v.judge.attempts.every(isJudgeAttemptRecord)) return null;
  if (!v.fusion.attempts.every(isFusionAttemptRecord)) return null;
  if (v.judge.report !== null && !isJudgeReport(v.judge.report)) return null;
  if (v.judge.consensus !== null && !isConsensusBreakdown(v.judge.consensus)) return null;

  const repaired = structuredClone(v) as Record<string, any>;
  const candidates = repaired.candidates as Array<Record<string, any>>;
  const invalidCandidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Array.isArray(candidate.attempts)) return null;
    if (candidate.acceptedAttemptId === null) continue;
    const accepted = candidate.attempts.find(
      (attempt) =>
        isRecord(attempt) &&
        attempt.attemptId === candidate.acceptedAttemptId &&
        attempt.status === "completed" &&
        attempt.output !== null &&
        attempt.output !== undefined,
    );
    if (!accepted) {
      invalidCandidateIds.add(String(candidate.candidateId));
      candidate.acceptedAttemptId = null;
    }
  }

  const acceptedMap: Record<string, string> = {};
  for (const candidate of candidates) {
    if (
      typeof candidate.candidateId === "string" &&
      typeof candidate.acceptedAttemptId === "string"
    ) {
      acceptedMap[candidate.candidateId] = candidate.acceptedAttemptId;
    }
  }
  const sameMap = (a: unknown): boolean => {
    if (!isRecord(a)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(acceptedMap).length &&
      keys.every((key) => a[key] === acceptedMap[key])
    );
  };

  const judge = repaired.judge as Record<string, any>;
  if (judge.acceptedAttemptId !== null) {
    const accepted = judge.attempts.find(
      (attempt: unknown) =>
        isRecord(attempt) &&
        attempt.attemptId === judge.acceptedAttemptId &&
        attempt.status === "completed" &&
        attempt.report !== null &&
        sameMap(attempt.candidateAttemptIdsByCandidateId),
    );
    if (!accepted) {
      judge.acceptedAttemptId = null;
      judge.report = null;
      judge.consensus = null;
    }
  }

  const fusion = repaired.fusion as Record<string, any>;
  if (fusion.acceptedAttemptId !== null) {
    const accepted = fusion.attempts.find(
      (attempt: unknown) =>
        isRecord(attempt) &&
        attempt.attemptId === fusion.acceptedAttemptId &&
        attempt.status === "completed" &&
        attempt.result !== null &&
        attempt.sourceJudgeAttemptId === judge.acceptedAttemptId &&
        sameMap(attempt.candidateAttemptIdsByCandidateId),
    );
    if (!accepted) fusion.acceptedAttemptId = null;
  }

  if (Array.isArray(repaired.winnerKeys)) {
    const invalidModels = new Set(
      candidates
        .filter((candidate) => invalidCandidateIds.has(String(candidate.candidateId)))
        .map((candidate) => candidate.modelKey),
    );
    repaired.winnerKeys = repaired.winnerKeys.filter((key: unknown) => !invalidModels.has(key));
  }

  return isRunRecordV2(repaired) ? repaired : null;
}

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
    (evaluation.profile !== null && !isEvaluationRubric(evaluation.profile))
  ) {
    return false;
  }
  if (v.reasoning !== undefined && !isReasoningProvenance(v.reasoning)) return false;

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

  // Cross-reference validation: accepted pointers must resolve to completed
  // accepted attempts, and accepted Judge/Fusion candidate maps must match
  // the current accepted candidate attempt set. Protects imported/stored
  // records against stale-evidence corruption (spec §5.6, §11.3).
  const record = v as unknown as RunRecordV2;
  if (!record.candidates.every(acceptedCandidateAttemptIsValid)) return false;
  if (!acceptedJudgeCrossReferencesValid(record)) return false;
  if (!acceptedFusionCrossReferencesValid(record)) return false;

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
