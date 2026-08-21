import type { RunStatus } from "../persistence/run-types";
import type { StatusMarkStatus } from "../../ui/StatusMark";

export const RECORD_TYPES = [
  "comparison",
  "evaluation",
  "policy-study",
  "task-execution",
  "observation",
  "legacy",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
export type RecordMode = "rank" | "fuse" | null;
export type RecordSource = "adhoc" | "experiment" | "legacy" | null;
export type RecordDisplayStatus = StatusMarkStatus | null;

export interface HistoricalOwnerCrosswalk {
  ownerKind: "compare" | "evaluation" | "task" | "model" | "lab";
  ownerHref: string;
  ownerLabel: string;
  reason: string;
}

interface RecordReferenceBase<T extends RecordType> {
  recordType: T;
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  status: RecordDisplayStatus;
  mode: RecordMode;
  source: RecordSource;
  modelKeys: string[];
  searchText: string;
  ownerHint: string;
  ownerCrosswalk?: HistoricalOwnerCrosswalk | null;
}

export interface ComparisonRecordReference extends RecordReferenceBase<"comparison"> {
  status: RunStatus;
  mode: Exclude<RecordMode, null>;
  source: "adhoc";
  runId: string;
  taskBinding:
    | { kind: "ad_hoc"; inputSnapshotRef: string }
    | { kind: "canonical"; taskId: string; taskVersion: number };
}

export interface EvaluationExecutionReference extends RecordReferenceBase<"evaluation"> {
  source: "experiment";
  taskSetId: string;
  taskSetVersion: number;
  childRunIds: string[];
}

export interface PolicyStudyReference extends RecordReferenceBase<"policy-study"> {
  source: null;
  claimLevel: "exploratory" | "confirmed";
}

export type TaskExecutionSource =
  | { kind: "adhoc"; comparisonId: string | null }
  | { kind: "experiment"; evaluationExecutionId: string; taskSetId: string }
  | { kind: "policy-study"; studyId: string };

export interface TaskExecutionRecordReference extends RecordReferenceBase<"task-execution"> {
  status: RunStatus;
  mode: Exclude<RecordMode, null>;
  source: "adhoc" | "experiment";
  runSource: TaskExecutionSource;
}

export interface ObservationRecordReference extends RecordReferenceBase<"observation"> {
  status: "completed";
  source: "adhoc" | "experiment";
  sourceKind: "comparison" | "evaluation";
  sourceResultId: string;
  runId: string;
  taskId: string;
  modelConfigurationId: string;
}

export interface LegacyRecordReference extends RecordReferenceBase<"legacy"> {
  status: null;
  mode: null;
  source: "legacy";
  ownerCrosswalk: HistoricalOwnerCrosswalk | null;
}

export type RecordReference =
  | ComparisonRecordReference
  | EvaluationExecutionReference
  | PolicyStudyReference
  | TaskExecutionRecordReference
  | ObservationRecordReference
  | LegacyRecordReference;

const FORBIDDEN_KEYS: Record<string, true> = {
  apiKey: true,
  authorization: true,
  bearer: true,
  cookie: true,
  cookies: true,
  credential: true,
  credentials: true,
  env: true,
  headers: true,
  password: true,
  proxyUrl: true,
  secret: true,
  token: true,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) => FORBIDDEN_KEYS[key] === true || hasForbiddenKey(nested),
  );
}

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonBlank);
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const DISPLAY_STATUSES: Record<Exclude<StatusMarkStatus, never>, true> = {
  draft: true,
  queued: true,
  running: true,
  paused: true,
  completed: true,
  completed_with_failures: true,
  partial: true,
  failed: true,
  aborted: true,
  interrupted: true,
  archived: true,
  ready: true,
  reusable: true,
};

function isCrosswalk(value: unknown): value is HistoricalOwnerCrosswalk {
  if (!isObject(value)) return false;
  return (
    ["compare", "evaluation", "task", "model", "lab"].includes(String(value.ownerKind)) &&
    isNonBlank(value.ownerHref) &&
    value.ownerHref.startsWith("/") &&
    isNonBlank(value.ownerLabel) &&
    isNonBlank(value.reason)
  );
}

function hasValidBase(value: Record<string, unknown>): boolean {
  return (
    (RECORD_TYPES as readonly unknown[]).includes(value.recordType) &&
    isNonBlank(value.id) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    isNonBlank(value.title) &&
    (value.status === null ||
      (typeof value.status === "string" &&
        DISPLAY_STATUSES[value.status as StatusMarkStatus] === true)) &&
    (value.mode === null || value.mode === "rank" || value.mode === "fuse") &&
    (value.source === null ||
      value.source === "adhoc" ||
      value.source === "experiment" ||
      value.source === "legacy") &&
    isStringArray(value.modelKeys) &&
    typeof value.searchText === "string" &&
    isNonBlank(value.ownerHint) &&
    (value.ownerCrosswalk === undefined ||
      value.ownerCrosswalk === null ||
      isCrosswalk(value.ownerCrosswalk))
  );
}

function isTaskBinding(value: unknown): value is ComparisonRecordReference["taskBinding"] {
  if (!isObject(value)) return false;
  if (value.kind === "ad_hoc") return isNonBlank(value.inputSnapshotRef);
  return (
    value.kind === "canonical" &&
    isNonBlank(value.taskId) &&
    Number.isInteger(value.taskVersion) &&
    Number(value.taskVersion) > 0
  );
}

function isTaskExecutionSource(value: unknown): value is TaskExecutionSource {
  if (!isObject(value)) return false;
  if (value.kind === "adhoc") return value.comparisonId === null || isNonBlank(value.comparisonId);
  if (value.kind === "experiment") {
    return isNonBlank(value.evaluationExecutionId) && isNonBlank(value.taskSetId);
  }
  return value.kind === "policy-study" && isNonBlank(value.studyId);
}

export function isRecordReference(value: unknown): value is RecordReference {
  if (!isObject(value) || hasForbiddenKey(value) || !hasValidBase(value)) return false;

  switch (value.recordType) {
    case "comparison":
      return (
        isNonBlank(value.runId) &&
        isTaskBinding(value.taskBinding) &&
        value.status !== null &&
        value.mode !== null &&
        value.source === "adhoc"
      );
    case "evaluation":
      return (
        isNonBlank(value.taskSetId) &&
        Number.isInteger(value.taskSetVersion) &&
        Number(value.taskSetVersion) > 0 &&
        isStringArray(value.childRunIds) &&
        value.source === "experiment"
      );
    case "policy-study":
      return (
        (value.claimLevel === "exploratory" || value.claimLevel === "confirmed") &&
        value.source === null
      );
    case "task-execution":
      return (
        value.status !== null &&
        value.mode !== null &&
        (value.source === "adhoc" || value.source === "experiment") &&
        isTaskExecutionSource(value.runSource)
      );
    case "observation":
      return (
        value.status === "completed" &&
        (value.source === "adhoc" || value.source === "experiment") &&
        (value.sourceKind === "comparison" || value.sourceKind === "evaluation") &&
        isNonBlank(value.sourceResultId) &&
        isNonBlank(value.runId) &&
        isNonBlank(value.taskId) &&
        isNonBlank(value.modelConfigurationId)
      );
    case "legacy":
      return (
        value.status === null &&
        value.mode === null &&
        value.source === "legacy" &&
        (value.ownerCrosswalk === null || isCrosswalk(value.ownerCrosswalk))
      );
    default:
      return false;
  }
}

export function isRecordType(value: string | undefined): value is RecordType {
  return typeof value === "string" && (RECORD_TYPES as readonly string[]).includes(value);
}
