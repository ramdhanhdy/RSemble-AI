// =============================================================================
// RSemble AI — Canonical Task versioning pure rules
//
// Child 02 (Canonical Tasks) Milestone A — Task 2.
//
// Pure normalizers / comparators / builders for immutable Task Versions and
// the mutable TaskRecord lifecycle (spec §3.1, §3.2, §4). No Dexie, no
// provider calls, no I/O. Digests are integrity aids only — semantic identity
// is defined by the task-defining fields, not by digests (spec §4.1).
//
// Reuses the confirmed P2 primitives from protocol-fingerprint.ts:
//   - canonicalJsonString (recursively key-sorted JSON) for order-invariant
//     normalization;
//   - hashArtifactContent (synchronous pure-JS SHA-256, `sha256:<hex>`) for
//     the definition digest.
// The plan's "Web Crypto digest helpers" note is resolved per the preflight
// conflict: shipped code is pure-JS sync SHA-256, not crypto.subtle.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type {
  TaskOrigin,
  TaskRecord,
  TaskSource,
  TaskVersion,
} from "./task-types";

// --- task-defining fields (spec §3.2) ---------------------------------------

/**
 * Fields whose mutation creates the next Task Version (spec §3.2):
 * candidate-visible instruction (`candidateInstruction`), task-defining
 * context (`defaultContextManifest`), expected response contract
 * (`responseContract`), correctness contract (`taskVerifierRef`), plus the
 * candidate-visible `title` and `objective`.
 *
 * Execution-protocol fields (`source`, `createdAt`, `version`, `taskId`) are
 * NOT task-defining: rubric/judge/model roster/provider/replicate policy are
 * protocol, not identity, unless they alter the candidate-visible objective.
 */
export const TASK_DEFINING_FIELDS = [
  "title",
  "objective",
  "candidateInstruction",
  "defaultContextManifest",
  "responseContract",
  "taskVerifierRef",
] as const;

export type TaskDefiningField = (typeof TASK_DEFINING_FIELDS)[number];

const TASK_DEFINING_FIELD_SET: ReadonlySet<TaskDefiningField> = new Set(TASK_DEFINING_FIELDS);

/** True if a TaskVersion field name is task-defining (forces a new version). */
export function isTaskDefiningField(field: string): boolean {
  return (TASK_DEFINING_FIELD_SET as Set<string>).has(field);
}

// --- normalized form for digest ---------------------------------------------

/**
 * The task-defining slice of a TaskVersion, with execution-protocol fields
 * (`taskId`, `version`, `createdAt`, `source`) stripped. Deep-equality of two
 * normalized forms is the authoritative "same definition" test; the digest is
 * only an integrity aid (spec §4.1).
 */
export type NormalizedTaskVersion = Pick<
  TaskVersion,
  | "title"
  | "objective"
  | "candidateInstruction"
  | "defaultContextManifest"
  | "responseContract"
  | "taskVerifierRef"
>;

/** Strip execution-protocol fields, keeping only the task-defining slice. */
export function normalizeVersionForDigest(version: TaskVersion): NormalizedTaskVersion {
  return {
    title: version.title,
    objective: version.objective,
    candidateInstruction: version.candidateInstruction,
    defaultContextManifest: version.defaultContextManifest,
    responseContract: version.responseContract,
    taskVerifierRef: version.taskVerifierRef,
  };
}

/**
 * Definition digest: `sha256:<hex>` over canonical JSON of the task-defining
 * slice. Stable across identical definitions regardless of `taskId`,
 * `version`, `createdAt`, or `source`. Used to decide whether a historical
 * definition appends a new version (spec §6.2 step 4) and as an integrity aid.
 */
export function computeDefinitionDigest(version: TaskVersion): string {
  return hashArtifactContent(canonicalJsonString(normalizeVersionForDigest(version)));
}

// --- task-defining change detection -----------------------------------------

/** A previous/next TaskVersion pair to compare for a task-defining change. */
export interface TaskVersionDelta {
  previous: TaskVersion;
  next: TaskVersion;
}

/**
 * Deep equality over the task-defining slice. Returns true when `previous`
 * and `next` differ in any task-defining field (spec §3.2), false when only
 * execution-protocol / provenance fields differ.
 *
 * Order matters for `defaultContextManifest` (semantically ordered context)
 * and for `responseContract.constraints`; object key insertion order does
 * not (canonical JSON comparison).
 */
export function isTaskDefiningChange(delta: TaskVersionDelta): boolean {
  return (
    canonicalJsonString(normalizeVersionForDigest(delta.previous)) !==
    canonicalJsonString(normalizeVersionForDigest(delta.next))
  );
}

// --- contiguous append (spec §4.3) ------------------------------------------

/** Result of {@link validateContiguousAppend}. */
export interface ContiguousAppendResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate that `candidate` is the next contiguous, positive, append-only
 * version after `latest` (spec §4.3: version numbers are positive, contiguous
 * per Task, and append-only). Append only happens after version 1 exists (the
 * first version is created atomically via {@link buildInitialTaskRecord}), so
 * `latest.latestVersion` must be a positive integer.
 *
 * @param latest    the current latest version state (`latestVersion` of the
 *                  TaskRecord).
 * @param candidate the proposed next version.
 */
export function validateContiguousAppend(
  latest: { latestVersion: number },
  candidate: { version: number },
): ContiguousAppendResult {
  const latestVersion = latest.latestVersion;
  const candidateVersion = candidate.version;
  if (!Number.isInteger(latestVersion) || latestVersion < 1) {
    return { ok: false, reason: `Invalid latest version: ${latestVersion}` };
  }
  if (!Number.isInteger(candidateVersion) || candidateVersion <= 0) {
    return { ok: false, reason: `Version must be a positive integer: ${candidateVersion}` };
  }
  if (candidateVersion !== latestVersion + 1) {
    return {
      ok: false,
      reason: `Version must be contiguous after ${latestVersion}: got ${candidateVersion}`,
    };
  }
  return { ok: true };
}

// --- version / record builders ---------------------------------------------

/** Inputs to {@link buildNextVersion}. */
export interface BuildNextVersionInput {
  /** Current `latestVersion` of the TaskRecord (the new version is +1). */
  latestVersion: number;
  /** Task ID the new version belongs to. */
  taskId: string;
  /** Draft carrying the task-defining content. Its `taskId`/`version`/
   *  `createdAt`/`source` are ignored in favor of the explicit args. */
  draft: TaskVersion;
  /** Creation timestamp for the immutable version row. */
  createdAt: number;
  /** Provenance for the new version. */
  source: TaskSource;
}

/**
 * Build the next immutable TaskVersion. The version number is always
 * `latestVersion + 1` (contiguous append); the draft's `taskId`, `version`,
 * `createdAt`, and `source` are replaced by the explicit arguments so a
 * caller cannot smuggle in a stale version number. Task-defining fields are
 * deep-copied so the caller's draft cannot later mutate the stored version.
 */
export function buildNextVersion(input: BuildNextVersionInput): TaskVersion {
  const nextVersion = input.latestVersion + 1;
  return {
    taskId: input.taskId,
    version: nextVersion,
    title: input.draft.title,
    objective: input.draft.objective,
    candidateInstruction: input.draft.candidateInstruction,
    defaultContextManifest: input.draft.defaultContextManifest.map((entry) => ({ ...entry })),
    responseContract: input.draft.responseContract
      ? {
          format: input.draft.responseContract.format,
          constraints: [...input.draft.responseContract.constraints],
          maxLength: input.draft.responseContract.maxLength,
        }
      : null,
    taskVerifierRef: input.draft.taskVerifierRef
      ? { id: input.draft.taskVerifierRef.id, version: input.draft.taskVerifierRef.version }
      : null,
    source: { ...input.source },
    createdAt: input.createdAt,
  };
}

/** Inputs to {@link buildInitialTaskRecord}. */
export interface BuildInitialTaskRecordInput {
  id: string;
  createdAt: number;
  origin: TaskOrigin;
}

/**
 * Build the initial TaskRecord for a brand-new Task: `latestVersion` 1,
 * `revision` 0, not archived, `updatedAt` == `createdAt` (spec §3.1, §7.3).
 */
export function buildInitialTaskRecord(input: BuildInitialTaskRecordInput): TaskRecord {
  return {
    id: input.id,
    latestVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    archivedAt: null,
    origin: input.origin,
    revision: 0,
  };
}

// --- archive / restore (spec §4.5) ------------------------------------------

/**
 * Archive a TaskRecord: set `archivedAt`, bump `revision` and `updatedAt`.
 * `latestVersion`, `id`, `origin`, and `createdAt` are preserved so historical
 * routes and references remain intact (spec §4.5: archive affects
 * discoverability, not references or historical routes). Pure — does not
 * mutate the input.
 */
export function archiveTaskRecord(record: TaskRecord, archivedAt: number): TaskRecord {
  return {
    ...record,
    archivedAt,
    updatedAt: archivedAt,
    revision: record.revision + 1,
  };
}

/**
 * Restore an archived TaskRecord: clear `archivedAt`, bump `revision` and
 * `updatedAt`. Pure — does not mutate the input.
 */
export function restoreTaskRecord(record: TaskRecord, restoredAt: number): TaskRecord {
  return {
    ...record,
    archivedAt: null,
    updatedAt: restoredAt,
    revision: record.revision + 1,
  };
}

// --- duplicate as new identity (spec §7.3) ----------------------------------

/** Inputs to {@link duplicateTaskRecord}. */
export interface DuplicateTaskRecordInput {
  /** The source TaskRecord to duplicate from. */
  source: TaskRecord;
  /** Opaque ID for the new Task. */
  newId: string;
  /** Creation timestamp for the new Task. */
  createdAt: number;
}

/**
 * Build a new Task identity from a source (spec §7.3: Duplicate creates a new
 * Task identity with origin `authored`; it never becomes a version of the
 * source by implication). The duplicate starts at `latestVersion` 1,
 * `revision` 0, not archived, regardless of the source's lifecycle state.
 * Pure — does not mutate the source.
 */
export function duplicateTaskRecord(input: DuplicateTaskRecordInput): TaskRecord {
  return {
    id: input.newId,
    latestVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
}
