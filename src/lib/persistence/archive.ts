// =============================================================================
// RSemble AI — Workbench archive (plan 8.1, spec §13/§18/§20; Child 02 §8.5)
//
// Whole-workbench export/import behind two explicit adapters that share the
// core Run/Rubric/Suite/Experiment reads:
//
//  - v1 (`exportWorkbenchArchive` / `parseWorkbenchArchive` /
//    `importWorkbenchArchive`): the established schemaVersion-1 shape. Export
//    is allowlisted by construction — only guard-passing domain records leave
//    the database. Import validates every centralized v1 limit (bytes, counts,
//    string size, depth, safe IDs) plus every record guard BEFORE any
//    mutation, then writes inside one Dexie transaction: canonically identical
//    records are skipped, same-ID different content is reported as conflicting
//    and never written, and any thrown error rolls the whole import back.
//
//  - v2 (`exportWorkbenchArchiveV2`, Child 02 Task 10B; extended by Child 03
//    Task 11): the task-first envelope (`WorkbenchArchiveV2`). Exports every
//    canonical Child 02 collection — exact Runs/Experiments, Rubrics, all
//    seven Fusion stores, Tasks/versions/artifacts+bytes/instances/families/
//    assignments/relations/facet annotations/crosswalks — plus the Child 03
//    Task Set collections (records, versions, materializations, ownership
//    crosswalks) as an optional top-level `taskSets` payload, in deterministic
//    order with exact counts and an integrity digest. Before delivery it scans
//    structured fields and artifact bytes for prohibited credential/auth
//    material and blocks safely with entity/type diagnostics, never echoing a
//    matched value. Disposable caches/indexes and unrestricted `storageMeta`
//    are never read. Supports progress reporting and cancellation before
//    final delivery.
//
//  - v2 import (`previewWorkbenchArchive` + `commitPreviewWorkbenchArchiveV2`):
//    the validated preview classifies every entity as create/reuse/collision/
//    invalid; the commit re-checks every CREATE destination inside one Dexie
//    transaction and aborts BEFORE any write on a non-identical same-key
//    collision. The seven Fusion stores stay separately typed and unconverted;
//    Task Set ownership crosswalks reference Fusion studies without altering
//    their payloads.
// =============================================================================

import {
  RSembleEvaluationDB,
  StorageError,
  classifyStorageError,
  type RunDetailRow,
  type RunSummaryRow,
  type TaskSetOwnershipCrosswalkRow,
} from "./database";
import {
  isFullRunSummaryV2,
  isLegacyRunSummary,
  isRunRecordV2,
  repairRunRecordForCompatibility,
  isRunSummary,
  type FullRunSummaryV2,
  type LegacyRunSummary,
  type RunRecordV2,
  type RunSummary,
} from "./run-types";
import {
  isEvaluationRubric,
  isEvaluationSuite,
  isExperimentRecord,
  isRubricRecord,
  type EvaluationRubric,
  type EvaluationSuite,
  type ExperimentRecord,
  type RubricRecord,
} from "../evaluations/evaluation-types";
import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import {
  rankValueFromResults,
  formatRankValueDisplay,
  qualityScore,
  complianceScore,
  getComplianceInfluence,
  rankScoreOf,
  isFloored,
} from "../evaluations/evaluation-rubric";
import { REDACTED } from "./error-redaction";
import { inputUsageLabel } from "../cost";
import { computeArtifactDigest } from "../tasks/task-instance";
import {
  ARCHIVE_V2_FORMAT_VERSION,
  ARCHIVE_V2_STORAGE_VERSION,
  computeArchiveV2PayloadDigest,
  isWorkbenchArchiveV2,
  validateArchiveV2,
  type ArchiveV2TaskArtifactBytes,
  type WorkbenchArchiveV2,
} from "./archive-v2-types";
import {
  isEvaluationObservation,
  isFusionAttempt,
  isFusionPlaybook,
  isFusionRecipeVersion,
  isFusionStudy,
  isFusionTrial,
  isPoolManifestVersion,
  type EvaluationObservation,
  type FusionAttempt,
  type FusionPlaybook,
  type FusionRecipeVersion,
  type FusionStudy,
  type FusionTrial,
  type PoolManifestVersion,
} from "../evaluations/fusion-study-types";
import {
  isTaskArtifact,
  isTaskFacetAnnotation,
  isTaskFamily,
  isTaskFamilyAssignment,
  isTaskInstance,
  isTaskRecord,
  isTaskVersion,
} from "../tasks/task-validation";
import type {
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "../tasks/task-types";
import type { TaskMigrationCrosswalk } from "../tasks/task-references";
import {
  isTaskSetRecord,
  isTaskSetVersion,
  type TaskSetRecord,
  type TaskSetVersion,
} from "../evaluations/task-set-types";
import type { TaskSetMaterializationRecord } from "./evaluation-repository";

// --- Archive shape -------------------------------------------------------------

export interface WorkbenchArchiveV1 {
  schemaVersion: 1;
  exportedAt: number;
  runs: { summaries: RunSummary[]; details: RunRecordV2[] };
  profiles: { identities: RubricRecord[]; versions: EvaluationRubric[] };
  suites: EvaluationSuite[];
  experiments: ExperimentRecord[];
}

/** Centralized v1 import limits (spec §18). */
export const IMPORT_LIMITS = {
  ARCHIVE_BYTES: 268435456,
  RUN_SUMMARIES: 25000,
  RUN_DETAILS: 25000,
  RUBRIC_IDENTITIES: 5000,
  RUBRIC_REVISIONS: 10000,
  SUITES: 5000,
  EXPERIMENTS: 25000,
  STRING_BYTES: 8388608,
  DEPTH: 32,
  ID_PATTERN: /^[A-Za-z0-9._:-]{1,128}$/,
} as const;

export interface ArchiveImportResult {
  created: string[];
  skipped: string[];
  conflicting: string[];
}

/** Credential/transport keys that must never cross the archive boundary. */
const PROHIBITED_KEY_NAMES: ReadonlySet<string> = new Set([
  "apiKey",
  "authorization",
  "token",
  "secret",
  "password",
  "env",
]);

// --- Validation helpers ----------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++; // low half of the surrogate pair
    } else bytes += 3;
  }
  return bytes;
}

interface WalkFrame {
  value: unknown;
  depth: number;
  path: string;
}

/** Iterative depth/string walk with an explicit budget — returns the first violation. */
function walkLimits(value: unknown): string | null {
  const stack: WalkFrame[] = [{ value, depth: 0, path: "archive" }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const v = frame.value;
    if (typeof v === "string") {
      if (utf8ByteLength(v) > IMPORT_LIMITS.STRING_BYTES) {
        return `String at ${frame.path} exceeds the 8 MiB UTF-8 limit`;
      }
      continue;
    }
    if (Array.isArray(v)) {
      if (frame.depth + 1 > IMPORT_LIMITS.DEPTH) {
        return `Nesting at ${frame.path} exceeds the depth limit of ${IMPORT_LIMITS.DEPTH}`;
      }
      for (let i = 0; i < v.length; i++) {
        stack.push({ value: v[i], depth: frame.depth + 1, path: `${frame.path}[${i}]` });
      }
      continue;
    }
    if (isRecord(v)) {
      if (frame.depth + 1 > IMPORT_LIMITS.DEPTH) {
        return `Nesting at ${frame.path} exceeds the depth limit of ${IMPORT_LIMITS.DEPTH}`;
      }
      for (const key of Object.keys(v)) {
        stack.push({ value: v[key], depth: frame.depth + 1, path: `${frame.path}.${key}` });
      }
    }
  }
  return null;
}

/** Deep-scan for a prohibited credential/transport key; returns the key name only. */
function findProhibitedKey(value: unknown): string | null {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
      continue;
    }
    if (isRecord(v)) {
      for (const key of Object.keys(v)) {
        if (PROHIBITED_KEY_NAMES.has(key)) return key;
        stack.push(v[key]);
      }
    }
  }
  return null;
}

/**
 * Error strings name the failing path and, when a prohibited key is the cause,
 * the key NAME — record content is never included.
 */
function guardError(path: string, index: number, entry: unknown): string {
  const key = findProhibitedKey(entry);
  if (key !== null) {
    return `${path}[${index}] contains prohibited key "${key}" (value ${REDACTED})`;
  }
  return `${path}[${index}] failed archive validation`;
}

function checkIds(list: unknown[], path: string, errors: string[]): void {
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (
      isRecord(entry) &&
      typeof entry.id === "string" &&
      !IMPORT_LIMITS.ID_PATTERN.test(entry.id)
    ) {
      errors.push(`${path}[${i}].id is not a safe archive ID (1–128 chars of A–Z a–z 0–9 . _ : -)`);
    }
  }
}

// --- Byte / parse validation -----------------------------------------------------

/** Validate the raw byte count before decoding — error message or null. */
export function validateArchiveBytes(byteLength: number): string | null {
  if (byteLength > IMPORT_LIMITS.ARCHIVE_BYTES) {
    return `Archive is too large — the limit is 256 MiB (${IMPORT_LIMITS.ARCHIVE_BYTES} bytes).`;
  }
  return null;
}

/**
 * Validate EVERYTHING before any mutation: schema version, structure, array
 * counts, string sizes, nesting depth, safe IDs, and every record guard.
 */
export function parseWorkbenchArchive(
  value: unknown,
): { ok: true; archive: WorkbenchArchiveV1 } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["Archive must be a JSON object"] };
  }
  if (value.schemaVersion !== 1) {
    errors.push("Archive schema version must be 1");
  }
  if (typeof value.exportedAt !== "number") {
    errors.push("Archive exportedAt must be a number");
  }

  const runs = value.runs;
  const profiles = value.profiles;
  const summariesRaw = isRecord(runs) && Array.isArray(runs.summaries) ? runs.summaries : null;
  const detailsRaw = isRecord(runs) && Array.isArray(runs.details) ? runs.details : null;
  const identitiesRaw =
    isRecord(profiles) && Array.isArray(profiles.identities) ? profiles.identities : null;
  const versionsRaw =
    isRecord(profiles) && Array.isArray(profiles.versions) ? profiles.versions : null;
  const suitesRaw = Array.isArray(value.suites) ? value.suites : null;
  const experimentsRaw = Array.isArray(value.experiments) ? value.experiments : null;

  if (summariesRaw === null) errors.push("runs.summaries must be an array");
  if (detailsRaw === null) errors.push("runs.details must be an array");
  if (identitiesRaw === null) errors.push("profiles.identities must be an array");
  if (versionsRaw === null) errors.push("profiles.versions must be an array");
  if (suitesRaw === null) errors.push("suites must be an array");
  if (experimentsRaw === null) errors.push("experiments must be an array");
  if (errors.length > 0) return { ok: false, errors };

  const lists = {
    summaries: summariesRaw!,
    details: detailsRaw!,
    identities: identitiesRaw!,
    versions: versionsRaw!,
    suites: suitesRaw!,
    experiments: experimentsRaw!,
  };

  // Array counts vs centralized limits.
  const countChecks: Array<[string, number, number]> = [
    ["runs.summaries", lists.summaries.length, IMPORT_LIMITS.RUN_SUMMARIES],
    ["runs.details", lists.details.length, IMPORT_LIMITS.RUN_DETAILS],
    ["profiles.identities", lists.identities.length, IMPORT_LIMITS.RUBRIC_IDENTITIES],
    ["profiles.versions", lists.versions.length, IMPORT_LIMITS.RUBRIC_REVISIONS],
    ["suites", lists.suites.length, IMPORT_LIMITS.SUITES],
    ["experiments", lists.experiments.length, IMPORT_LIMITS.EXPERIMENTS],
  ];
  for (const [path, count, limit] of countChecks) {
    if (count > limit) errors.push(`${path} has ${count} records — the limit is ${limit}`);
  }
  if (errors.length > 0) return { ok: false, errors };

  // String sizes and nesting depth across the whole parsed value.
  const walkViolation = walkLimits(value);
  if (walkViolation !== null) return { ok: false, errors: [walkViolation] };

  // Safe record IDs.
  checkIds(lists.summaries, "runs.summaries", errors);
  checkIds(lists.details, "runs.details", errors);
  checkIds(lists.identities, "profiles.identities", errors);
  checkIds(lists.versions, "profiles.versions", errors);
  checkIds(lists.suites, "suites", errors);
  checkIds(lists.experiments, "experiments", errors);
  if (errors.length > 0) return { ok: false, errors };

  // Record guards — prohibited-key rejection flows through these guards.
  const summaries: RunSummary[] = [];
  lists.summaries.forEach((entry, i) => {
    if (isRunSummary(entry)) summaries.push(entry);
    else errors.push(guardError("runs.summaries", i, entry));
  });
  const details: RunRecordV2[] = [];
  lists.details.forEach((entry, i) => {
    const compatible =
      repairRunRecordForCompatibility(entry) ?? (isRunRecordV2(entry) ? entry : null);
    if (compatible) details.push(compatible);
    else errors.push(guardError("runs.details", i, entry));
  });
  const identities: RubricRecord[] = [];
  lists.identities.forEach((entry, i) => {
    if (isRubricRecord(entry)) identities.push(entry);
    else errors.push(guardError("profiles.identities", i, entry));
  });
  const versions: EvaluationRubric[] = [];
  lists.versions.forEach((entry, i) => {
    if (isEvaluationRubric(entry)) versions.push(entry);
    else errors.push(guardError("profiles.versions", i, entry));
  });
  const suites: EvaluationSuite[] = [];
  lists.suites.forEach((entry, i) => {
    if (isEvaluationSuite(entry)) suites.push(entry);
    else errors.push(guardError("suites", i, entry));
  });
  const experiments: ExperimentRecord[] = [];
  lists.experiments.forEach((entry, i) => {
    if (isExperimentRecord(entry)) experiments.push(entry);
    else errors.push(guardError("experiments", i, entry));
  });
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    archive: {
      schemaVersion: 1,
      exportedAt: value.exportedAt as number,
      runs: { summaries, details },
      profiles: { identities, versions },
      suites,
      experiments,
    },
  };
}

// --- Export ------------------------------------------------------------------------

/**
 * Read every table and keep only guard-passing domain records — allowlisted by
 * construction, with no credential scan of ordinary prompt/output prose.
 */
export async function exportWorkbenchArchive(db: RSembleEvaluationDB): Promise<WorkbenchArchiveV1> {
  const summaries: RunSummary[] = [];
  const details: RunRecordV2[] = [];
  const identities: RubricRecord[] = [];
  const versions: EvaluationRubric[] = [];
  const suites: EvaluationSuite[] = [];
  const experiments: ExperimentRecord[] = [];
  try {
    await db.runSummaries.orderBy("createdAt").each((row) => {
      if (isRunSummary(row.summary)) summaries.push(row.summary);
    });
    await db.runDetails.orderBy("createdAt").each((row) => {
      const compatible =
        repairRunRecordForCompatibility(row.record) ??
        (isRunRecordV2(row.record) ? row.record : null);
      if (compatible) details.push(compatible);
    });
    await db.profiles.orderBy("updatedAt").each((row) => {
      if (isRubricRecord(row.record)) identities.push(row.record);
    });
    await db.profileVersions.orderBy("updatedAt").each((row) => {
      if (isEvaluationRubric(row.profile)) versions.push(row.profile);
    });
    await db.suites.orderBy("updatedAt").each((row) => {
      if (isEvaluationSuite(row.suite)) suites.push(row.suite);
    });
    await db.experiments.orderBy("createdAt").each((row) => {
      if (isExperimentRecord(row.experiment)) experiments.push(row.experiment);
    });
  } catch (err) {
    throw classifyStorageError(err);
  }
  return {
    schemaVersion: 1,
    exportedAt: Date.now(),
    runs: { summaries, details },
    profiles: { identities, versions },
    suites,
    experiments,
  };
}

// --- Import ------------------------------------------------------------------------

/** Row mapping mirrors the run repository; the domain object is stored as-is. */
function summaryRowFor(summary: RunSummary): RunSummaryRow {
  const full = summary.kind === "full" ? (summary as FullRunSummaryV2) : null;
  return {
    kind: summary.kind,
    summary,
    id: summary.id,
    revision: full ? full.revision : 0,
    createdAt: summary.createdAt,
    completedAt: full ? full.completedAt : null,
    status: full ? full.status : null,
    mode: full ? full.mode : null,
    sourceKind: full?.source.kind ?? "adhoc",
    sourceProtocolFingerprint:
      full?.source.kind === "experiment" ? full.source.protocolFingerprint : null,
    sourceExperimentTaskAttemptId:
      full?.source.kind === "experiment" ? full.source.experimentTaskAttemptId : null,
    modelKeys: summary.modelKeys,
  };
}

function detailRowFor(record: RunRecordV2): RunDetailRow {
  return {
    id: record.id,
    record,
    revision: record.revision,
    createdAt: record.createdAt,
    status: record.status,
  };
}

function canon(value: unknown): string {
  return canonicalJsonString(value);
}

/**
 * Import a validated archive in ONE Dexie transaction. Canonically identical
 * records are skipped, same-ID different content is conflicting (never
 * written), absent records are created preserving the domain record/summary
 * revision so subsequent repository CAS updates succeed. Any thrown error
 * aborts the transaction — nothing is written.
 */
export async function importWorkbenchArchive(
  db: RSembleEvaluationDB,
  archive: WorkbenchArchiveV1,
): Promise<ArchiveImportResult> {
  const check = parseWorkbenchArchive(archive);
  if (!check.ok) {
    throw new StorageError("validation", `Invalid archive: ${check.errors[0] ?? "unknown"}`);
  }
  const a = check.archive;
  db.assertWritable();

  const created: string[] = [];
  const skipped: string[] = [];
  const conflicting: string[] = [];

  const fullSummariesById = new Map<string, FullRunSummaryV2>();
  const legacySummaries: LegacyRunSummary[] = [];
  for (const s of a.runs.summaries) {
    if (isFullRunSummaryV2(s)) fullSummariesById.set(s.id, s);
    else if (isLegacyRunSummary(s)) legacySummaries.push(s);
  }

  try {
    await db.transaction(
      "rw",
      [db.runSummaries, db.runDetails, db.profiles, db.profileVersions, db.suites, db.experiments],
      async () => {
        // Run details paired with their same-ID full summaries.
        for (const record of a.runs.details) {
          const incomingSummary = fullSummariesById.get(record.id);
          const existingDetail = await db.runDetails.get(record.id);
          const existingSummary = incomingSummary
            ? await db.runSummaries.get(record.id)
            : undefined;
          const detailSame =
            existingDetail !== undefined && canon(existingDetail.record) === canon(record);
          const summarySame =
            existingSummary === undefined
              ? incomingSummary === undefined
              : canon(existingSummary.summary) === canon(incomingSummary);
          if ((existingDetail !== undefined && !detailSame) || !summarySame) {
            if (existingDetail !== undefined || existingSummary !== undefined) {
              conflicting.push(record.id);
              continue;
            }
          }
          if (existingDetail !== undefined && detailSame && summarySame) {
            skipped.push(record.id);
            continue;
          }
          if (incomingSummary) await db.runSummaries.put(summaryRowFor(incomingSummary));
          if (existingDetail === undefined) await db.runDetails.put(detailRowFor(record));
          created.push(record.id);
        }

        // Legacy summaries import standalone.
        for (const legacy of legacySummaries) {
          const existing = await db.runSummaries.get(legacy.id);
          if (existing) {
            if (canon(existing.summary) === canon(legacy)) skipped.push(legacy.id);
            else conflicting.push(legacy.id);
            continue;
          }
          await db.runSummaries.put(summaryRowFor(legacy));
          created.push(legacy.id);
        }

        // Rubric identities.
        for (const record of a.profiles.identities) {
          const existing = await db.profiles.get(record.id);
          if (existing) {
            if (canon(existing.record) === canon(record)) skipped.push(record.id);
            else conflicting.push(record.id);
            continue;
          }
          await db.profiles.put({
            id: record.id,
            record,
            revision: 1,
            latestVersion: record.latestVersion,
            updatedAt: record.updatedAt,
            archivedAt: record.archivedAt,
          });
          created.push(record.id);
        }

        // Rubric versions — conflict/skip at the [id+version] composite key.
        for (const rubric of a.profiles.versions) {
          const key = `${rubric.id}@${rubric.version}`;
          const existing = await db.profileVersions.get([rubric.id, rubric.version]);
          if (existing) {
            if (canon(existing.profile) === canon(rubric)) skipped.push(key);
            else conflicting.push(key);
            continue;
          }
          await db.profileVersions.put({
            id: rubric.id,
            version: rubric.version,
            profile: rubric,
            updatedAt: rubric.updatedAt,
          });
          created.push(key);
        }

        // Suites.
        for (const suite of a.suites) {
          const existing = await db.suites.get(suite.id);
          if (existing) {
            if (canon(existing.suite) === canon(suite)) skipped.push(suite.id);
            else conflicting.push(suite.id);
            continue;
          }
          await db.suites.put({
            id: suite.id,
            suite,
            revision: 1,
            version: suite.version,
            updatedAt: suite.updatedAt,
            archivedAt: suite.archivedAt,
          });
          created.push(suite.id);
        }

        // Experiments.
        for (const experiment of a.experiments) {
          const existing = await db.experiments.get(experiment.id);
          if (existing) {
            if (canon(existing.experiment) === canon(experiment)) skipped.push(experiment.id);
            else conflicting.push(experiment.id);
            continue;
          }
          await db.experiments.put({
            id: experiment.id,
            experiment,
            revision: 1,
            suiteId: experiment.suiteId,
            suiteVersion: experiment.suiteVersion,
            protocolFingerprint: experiment.protocolFingerprint,
            createdAt: experiment.createdAt,
            status: experiment.status,
          });
          created.push(experiment.id);
        }
      },
    );
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw classifyStorageError(err);
  }

  return { created, skipped, conflicting };
}

// --- Failure guidance ---------------------------------------------------------------

/** Classified recovery guidance for archive failures (spec §20). */
export function archiveFailureGuidance(err: unknown): string {
  if (err instanceof ArchiveExportCancelledError) {
    return "Export was cancelled — no archive was delivered.";
  }
  if (err instanceof ArchiveImportCancelledError) {
    return "Import was cancelled — nothing was imported.";
  }
  if (err instanceof StorageError) {
    switch (err.kind) {
      case "quota":
        return "Storage is full — free space and retry the import.";
      case "blocked":
      case "versionchange":
        return "Close other RSemble tabs to finish the storage upgrade, then retry.";
      case "unavailable":
        return "Storage is unavailable — retry; your existing data was not modified.";
      case "validation":
        return "The archive is invalid — nothing was imported.";
      case "conflict":
        return "Import conflicted with existing data — review the conflicting IDs.";
    }
  }
  return "Import failed — nothing was imported.";
}

// --- Run Markdown export ------------------------------------------------------------

/**
 * Escape leading heading markers so persisted free text cannot inject document
 * structure into the export (the export is auditable but not executable).
 */
function mdSafe(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(#{1,6})\s/, "\\$1 "))
    .join("\n");
}

/**
 * Build a Markdown export of one run from the PERSISTED RECORD only — task,
 * configuration, candidates, judge scores/rationale, fusion result, winners.
 * Never reads ambient Compare state (plan 8.1 item 7).
 */
export function buildRunExportMarkdown(record: RunRecordV2): string {
  const lines: string[] = [
    `# RSemble AI — Run Export`,
    ``,
    `## Task`,
    ``,
    mdSafe(record.task.title),
    ``,
    record.task.prompt,
    ``,
  ];

  if (record.task.systemPrompt.trim().length > 0) {
    lines.push(`## System Prompt`, ``, record.task.systemPrompt, ``);
  }

  lines.push(
    `## Configuration`,
    ``,
    `- Mode: ${record.mode}`,
    `- Temperature: ${record.task.temperature}`,
    `- Status: ${record.status}`,
    ``,
  );

  lines.push(`## Candidates`, ``);
  for (const candidate of record.candidates) {
    const attempt = candidate.acceptedAttemptId
      ? candidate.attempts.find((a) => a.attemptId === candidate.acceptedAttemptId)
      : undefined;
    lines.push(
      `### ${mdSafe(candidate.model)} (${mdSafe(candidate.providerId)}:${mdSafe(candidate.slug)})`,
      ``,
    );
    if (attempt) {
      lines.push(`- ${inputUsageLabel(attempt.inputEstimate, attempt.tokensIn)}`, ``);
    }
    if (attempt && typeof attempt.output === "string") {
      lines.push(attempt.output, ``);
    } else if (attempt && attempt.error !== null) {
      lines.push(`_Failed: ${mdSafe(attempt.error.message)}_`, ``);
    } else {
      lines.push(`_No output._`, ``);
    }
  }

  const report = record.judge.report;
  const acceptedJudgeAttempt = record.judge.acceptedAttemptId
    ? record.judge.attempts.find((a) => a.attemptId === record.judge.acceptedAttemptId)
    : undefined;
  if (acceptedJudgeAttempt) {
    lines.push(
      `## Judge Usage`,
      ``,
      `- ${inputUsageLabel(acceptedJudgeAttempt.inputEstimate, acceptedJudgeAttempt.usage?.inputTokens)}`,
      ``,
    );
  }
  if (report) {
    lines.push(`## Score Explanations`, ``);
    for (const { label, candidateId } of report.labelMap) {
      const evaluation = report.evaluationsById[candidateId];
      if (!evaluation) continue;
      const candidate = record.candidates.find((c) => c.candidateId === candidateId);
      const name = candidate ? mdSafe(candidate.model) : candidateId;
      const rubric = record.evaluation.profile;
      const rv = rubric ? rankValueFromResults(evaluation.criterionScores, rubric) : null;
      // Domain-aware headline: compliance-only profiles render C as a percentage
      // (no /5, no floor); graded/legacy/holistic keep the 1–5 /5 suffix.
      const headline =
        rv !== null
          ? formatRankValueDisplay(rv, rubric)
          : `${evaluation.overallScore.toFixed(1)}/5`;
      lines.push(`### ${name} (Candidate ${label}) — ${headline}`, ``);
      lines.push(`Position: ${mdSafe(evaluation.position)}`, ``);
      lines.push(`Why this score: ${mdSafe(evaluation.rationale)}`, ``);

      // Scoring derivation (spec §18): Q, C, λ, rankValue, rankScore, floor marker.
      if (rubric && rv !== null) {
        const numericScores: Record<string, number> = {};
        const booleanResults: Record<string, boolean> = {};
        for (const cs of evaluation.criterionScores) {
          if (cs.kind === "binary" && cs.value !== undefined) {
            booleanResults[cs.criterionId] = cs.value;
          } else if (cs.score !== undefined) {
            numericScores[cs.criterionId] = cs.score;
          }
        }
        const Q = qualityScore(numericScores, rubric);
        const comp = complianceScore(booleanResults, rubric);
        const lambda = getComplianceInfluence(rubric);
        const C = comp?.C ?? null;
        const rs = rankScoreOf(rv);
        const floored = isFloored(rv);

        const qStr = Q !== null ? Q.toFixed(3) : "—";
        const cStr =
          C !== null
            ? `${C.toFixed(3)}${comp && comp.groupsPresent > 0 ? ` (${comp.groupsPresent} group${comp.groupsPresent > 1 ? "s" : ""})` : ""}`
            : "1.000 (no binary checks)";
        const derivParts: string[] = [];
        if (Q !== null && C !== null) {
          derivParts.push(
            `rankValue = Q − λ·(1 − C) = ${Q.toFixed(3)} − ${lambda.toFixed(2)}·(1 − ${C.toFixed(3)}) = ${rv.toFixed(3)}`,
          );
        } else if (Q !== null) {
          derivParts.push(`rankValue = Q = ${Q.toFixed(3)} (no binary checks, C := 1)`);
        } else if (C !== null) {
          derivParts.push(`rankValue = C̄ = ${C.toFixed(3)} (compliance-only, §16.3)`);
        }
        // Compliance-only profiles (no graded criteria) have no rankScore and no
        // 1–5 display floor (spec §16.3): C is the ranking quantity in the
        // 0–1 domain and must never be presented as a floored 1.0* rank score.
        const complianceOnly = Q === null && C !== null;
        if (!complianceOnly) {
          derivParts.push(`rankScore = max(1, rankValue) = ${rs !== null ? rs.toFixed(3) : "—"}`);
          if (floored) {
            derivParts.push(
              `⏶ Floor applied: raw rankValue ${rv.toFixed(3)} < 1 → rankScore ${rs!.toFixed(1)}*`,
            );
          }
        }

        lines.push(
          `**Scoring:**`,
          `- Quality (Q): ${qStr}`,
          `- Compliance (C): ${cStr}`,
          `- Compliance influence (λ): ${lambda.toFixed(2)}`,
          ...(complianceOnly
            ? [`- Compliance: ${(C! * 100).toFixed(0)}% (compliance-only rubric, §16.3)`]
            : [
                `- Rank Value: ${rv.toFixed(3)}${floored ? " (floored)" : ""}`,
                `- Rank Score: ${rs !== null ? rs.toFixed(1) : "—"}${floored ? "*" : ""}`,
              ]),
          ...derivParts.map((d) => `- ${d}`),
          ``,
        );
      }

      if (evaluation.strengths.length > 0) {
        lines.push(`Strengths:`, ...evaluation.strengths.map((s) => `- ${mdSafe(s)}`), ``);
      }
      if (evaluation.deductions.length > 0) {
        lines.push(
          `Deductions:`,
          ...evaluation.deductions.map(
            (d) => `- ${d.severity === "major" ? "Major" : "Minor"}: ${mdSafe(d.reason)}`,
          ),
          ``,
        );
      }
      if (evaluation.missedRequirements.length > 0) {
        lines.push(
          `Missed requirements:`,
          ...evaluation.missedRequirements.map((m) => `- ${mdSafe(m)}`),
          ``,
        );
      }
      if (evaluation.criterionScores.length > 0) {
        // Build a lookup of group membership for binary criteria context.
        const groupLookup = new Map<string, string>();
        if (rubric?.requirementGroups) {
          for (const g of rubric.requirementGroups) {
            for (const checkId of g.checkIds) {
              groupLookup.set(checkId, g.name);
            }
          }
        }
        lines.push(
          `Criterion scores:`,
          ...evaluation.criterionScores.map((cs) =>
            cs.kind === "binary"
              ? `- ${mdSafe(cs.label)}: ${
                  cs.value === undefined ? "UNKNOWN" : cs.value ? "PASS" : "FAIL"
                }${groupLookup.has(cs.criterionId) ? ` (Group: ${mdSafe(groupLookup.get(cs.criterionId)!)})` : ""} — ${mdSafe(cs.rationale)}`
              : `- ${mdSafe(cs.label)}: ${cs.score?.toFixed(1) ?? "N/A"}/5 — ${mdSafe(cs.rationale)}`,
          ),
          ``,
        );
      }
    }
    if (report.comparisons.length > 0) {
      lines.push(`## Same-Conclusion Comparisons`, ``);
      for (const cmp of report.comparisons) {
        lines.push(
          `- Candidate ${cmp.blindLabels[0]} vs Candidate ${cmp.blindLabels[1]}: ${mdSafe(cmp.reason)}`,
        );
      }
      lines.push(``);
    }
  }

  const consensus = record.judge.consensus;
  if (consensus) {
    lines.push(`## Judge Consensus`, ``);
    if (consensus.consensus.length > 0) {
      lines.push(`**Agreement:**`, ...consensus.consensus.map((t) => `- ${mdSafe(t)}`), ``);
    }
    if (consensus.contradictions.length > 0) {
      lines.push(
        `**Contradictions:**`,
        ...consensus.contradictions.map((t) => `- ${mdSafe(t)}`),
        ``,
      );
    }
  }
  const fusionAttempt = record.fusion.acceptedAttemptId
    ? record.fusion.attempts.find((a) => a.attemptId === record.fusion.acceptedAttemptId)
    : undefined;
  if (fusionAttempt && typeof fusionAttempt.result === "string") {
    lines.push(
      `## Fusion Usage`,
      ``,
      `- ${inputUsageLabel(fusionAttempt.inputEstimate, fusionAttempt.usage?.inputTokens)}`,
      ``,
    );
    lines.push(`## Fused Answer`, ``, fusionAttempt.result, ``);
  }

  if (record.winnerKeys.length > 0) {
    lines.push(`## Winners`, ``, ...record.winnerKeys.map((k) => `- ${mdSafe(k)}`), ``);
  }

  return lines.join("\n");
}

// =============================================================================
// Archive v2 export adapter (Child 02 Task 10B)
//
// The task-first, deterministic, secret-safe export. Shares the guard-passing
// read shape with the v1 adapter, adds the seven Fusion stores and every
// canonical Task collection, sorts each collection by its deterministic key,
// attaches artifact bytes, scans structured fields and bytes for prohibited
// credential/auth material BEFORE delivery, and supports progress reporting
// and cancellation with an AbortSignal.
// =============================================================================

/** A stage of the v2 export pipeline. Stages run in declaration order:
 *  collection reads first, artifact byte encoding, the pre-delivery secret
 *  scan, then finalize. */
export type ArchiveExportStage =
  | "runs"
  | "rubrics"
  | "suites"
  | "experiments"
  | "fusion"
  | "tasks"
  | "task-sets"
  | "artifact-bytes"
  | "scan"
  | "finalize";

/** One progress observation for the v2 export. `done`/`total` count collections
 *  completed; both are monotonic non-decreasing and `done === total` only when
 *  the finalize stage completes (the archive is ready to deliver). */
export interface ArchiveExportProgress {
  /** One of `ArchiveExportStage`; widened to string so observers can compare
   *  stages and build stage sets over plain string literals. */
  stage: string;
  done: number;
  total: number;
}

/** Rejection raised when an export is cancelled before delivery. Distinct from
 *  StorageError so callers can classify it (see `archiveFailureGuidance`). */
export class ArchiveExportCancelledError extends Error {
  constructor() {
    super("Export was cancelled — no archive was delivered.");
    this.name = "ArchiveExportCancelledError";
  }
}

/** Options for `exportWorkbenchArchiveV2`. */
export interface ArchiveExportV2Options {
  /** Deterministic clock for tests; defaults to Date.now. */
  now?: () => number;
  /** Receives monotonic per-stage progress before the archive resolves. */
  onProgress?: (progress: ArchiveExportProgress) => void;
  /** Abort before or during the export to reject without delivering. */
  signal?: AbortSignal;
}

/** Ordered export stage list — `total` counts these stages. */
const ARCHIVE_V2_STAGES: ArchiveExportStage[] = [
  "runs",
  "rubrics",
  "suites",
  "experiments",
  "fusion",
  "tasks",
  "task-sets",
  "artifact-bytes",
  "scan",
  "finalize",
];

const ARCHIVE_V2_DISCLOSURE_NOTES = "Local workbench export. No remote transport metadata.";

function v2OrderingKeyString(a: unknown, b: unknown): number {
  const ka = typeof a === "string" ? a : "";
  const kb = typeof b === "string" ? b : "";
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function v2SortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => v2OrderingKeyString(a.id, b.id));
}

function v2SortByIdVersion<T extends { id: string; version: number }>(items: T[]): T[] {
  const key = (t: T) => `${t.id} ${t.version.toString().padStart(10, "0")}`;
  return [...items].sort((a, b) => v2OrderingKeyString(key(a), key(b)));
}

function v2SortByTaskIdVersion<T extends { taskId: string; version: number }>(items: T[]): T[] {
  const key = (t: T) => `${t.taskId} ${t.version.toString().padStart(10, "0")}`;
  return [...items].sort((a, b) => v2OrderingKeyString(key(a), key(b)));
}

function v2SortByLegacyScopeKey<T extends { legacyScopeKey: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => v2OrderingKeyString(a.legacyScopeKey, b.legacyScopeKey));
}

function v2SortByTaskSetIdVersion<T extends { taskSetId: string; version: number }>(
  items: T[],
): T[] {
  const key = (t: T) => `${t.taskSetId}\u0000${t.version.toString().padStart(10, "0")}`;
  return [...items].sort((a, b) => v2OrderingKeyString(key(a), key(b)));
}

function v2SortByKey<T extends { key: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => v2OrderingKeyString(a.key, b.key));
}

/** Collects export guard-failing rows so the export can abort with redacted
 *  diagnostics. Dexie's `Collection.each()` does not propagate a synchronous
 *  throw from its callback; the violation is recorded here and a single
 *  StorageError is thrown after all reads complete. The diagnostic names the
 *  entity/collection + deterministic ID (when extractable) and never echoes a
 *  matched secret-shaped value. */
function recordGuardFailure(
  label: string,
  id: string,
  collection: string,
  violations: string[],
): void {
  const where = id === "" ? `${label}` : `${label}[${id}]`;
  violations.push(
    `Export blocked: ${where} (collection ${collection}) failed its record guard and could not be safely archived. No archive was delivered.`,
  );
}

/**
 * Archive-boundary allowlist guard for task family relations, shared by the
 * v2 export and the v2 import preview/commit. This is deliberately NOT the
 * canonical authoring guard (`isTaskFamilyRelation`): the domain
 * no-self-relation rule constrains what may be AUTHORED, not what may be
 * reported or restored. Persisted legacy self-relations are real entities and
 * must round-trip through the archive faithfully — only structurally unsafe
 * rows (bad identifiers, unknown kind, prohibited credential/transport keys)
 * are excluded, mirroring the v1 allowlist construction.
 */
function isExportableTaskFamilyRelation(v: unknown): v is TaskFamilyRelation {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || !IMPORT_LIMITS.ID_PATTERN.test(v.id)) return false;
  if (typeof v.fromFamilyId !== "string" || !IMPORT_LIMITS.ID_PATTERN.test(v.fromFamilyId)) {
    return false;
  }
  if (typeof v.toFamilyId !== "string" || !IMPORT_LIMITS.ID_PATTERN.test(v.toFamilyId)) {
    return false;
  }
  if (v.kind !== "overlap" && v.kind !== "parent" && v.kind !== "derivative") return false;
  if (typeof v.createdAt !== "number") return false;
  return findProhibitedKey(v) === null;
}

/** Archive-boundary guard for a Task Set ownership crosswalk row. Structural
 *  safety only (identity fields + prohibited-key scan); the domain migration
 *  owns the richer authoring rules. */
function isTaskSetOwnershipCrosswalkRow(v: unknown): v is TaskSetOwnershipCrosswalkRow {
  if (!isRecord(v)) return false;
  if (typeof v.key !== "string" || v.key.length === 0) return false;
  if (v.kind !== "suite-manifest" && v.kind !== "experiment-owner" && v.kind !== "fusion-owner") {
    return false;
  }
  if (typeof v.taskSetId !== "string" || v.taskSetId.length === 0) return false;
  if (
    v.version !== null &&
    (typeof v.version !== "number" || !Number.isInteger(v.version) || v.version <= 0)
  ) {
    return false;
  }
  if (v.digest !== null && v.digest !== undefined && typeof v.digest !== "string") return false;
  if (v.status !== "resolved" && v.status !== "unresolved") return false;
  if (typeof v.updatedAt !== "number") return false;
  return findProhibitedKey(v) === null;
}

/** Archive-boundary guard for an immutable Task Set materialization record.
 *  Structural safety only (identity fields + prohibited-key scan). */
function isTaskSetMaterializationRecord(v: unknown): v is TaskSetMaterializationRecord {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.taskSetId !== "string" || v.taskSetId.length === 0) return false;
  if (
    typeof v.taskSetVersion !== "number" ||
    !Number.isInteger(v.taskSetVersion) ||
    v.taskSetVersion <= 0
  ) {
    return false;
  }
  if (typeof v.protocolFingerprint !== "string" || v.protocolFingerprint.length === 0) return false;
  if (typeof v.createdAt !== "number") return false;
  if (!isRecord(v.snapshot)) return false;
  return findProhibitedKey(v) === null;
}

/** Local, deterministic base64 encoder — matches the fixture wire encoding
 *  byte-for-byte (no runtime or Buffer dependency). */
function v2BytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Credential-like VALUE pattern applied to every string field and to decoded
 *  artifact bytes. Matches `CREDENTIAL_LIKE_VALUE` in task-validation
 *  (key-like prefixes), extended to fire mid-string only at a token boundary —
 *  auth material must be caught inside prose ("prefix sk-… suffix"), while
 *  ordinary words containing key-shaped character runs ("legacy-task-set")
 *  are not credentials. */
const CREDENTIAL_LIKE_INLINE =
  /(?:^|[^A-Za-z0-9])(?:sk-[A-Za-z0-9]|AIza[0-9A-Za-z_-]{10,}|Bearer\s+\S)/;

/**
 * Deep-scan a structured entity for credential-like VALUES. Self-referential
 * identity strings (`id`, `taskId`, `studyId`, `trialId`, `legacyScopeKey`,
 * `supersedesId`, `originId`) are skipped — a record's own ID legitimately
 * appears verbatim inside test-seeded collections like `legacy:task-1` and
 * must never be mistaken for secret material.
 */
function v2ScanForCredentialValue(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === "string") {
      if (CREDENTIAL_LIKE_INLINE.test(v)) return true;
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
      continue;
    }
    if (isRecord(v)) {
      for (const [key, field] of Object.entries(v)) {
        if (
          key === "id" ||
          key === "taskId" ||
          key === "studyId" ||
          key === "trialId" ||
          key === "legacyScopeKey" ||
          key === "supersedesId" ||
          key === "originId"
        ) {
          continue;
        }
        stack.push(field);
      }
    }
  }
  return false;
}

/**
 * Export the complete canonical workbench as a v2 envelope.
 *
 * Behavior contract (fixed by the RED tests):
 *  - Reads every Child 02 canonical collection and requires EVERY persisted
 *    canonical row to pass its guard. A guard-failing or corrupt row ABORTS
 *    the export with a redacted validation diagnostic (never silently
 *    dropped, never a partial/omitted archive presented as complete).
 *  - Deterministic: explicit ascending sort per collection, exact 23-key
 *    counts, recomputable payload digest.
 *  - Secret-safe: scans structured fields AND decoded artifact bytes for
 *    prohibited keys/credential-like values BEFORE delivery; blocks with a
 *    validation StorageError naming entity/collection + ID, never echoing a
 *    matched value.
 *  - Cancel-safe: an already-aborted signal rejects immediately without any
 *    progress callback; abort during `scan` (or any stage) rejects with
 *    ArchiveExportCancelledError and delivers no archive.
 */
export async function exportWorkbenchArchiveV2(
  db: RSembleEvaluationDB,
  options: ArchiveExportV2Options = {},
): Promise<WorkbenchArchiveV2> {
  const now = options.now ?? (() => Date.now());
  const onProgress = options.onProgress;
  const signal = options.signal;

  // Already-aborted: reject before any read or progress callback.
  if (signal?.aborted) throw new ArchiveExportCancelledError();

  const total = ARCHIVE_V2_STAGES.length;
  let done = 0;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new ArchiveExportCancelledError();
  };
  const emit = (stage: ArchiveExportStage) => {
    if (onProgress) onProgress({ stage, done, total });
  };
  const completeStage = (stage: ArchiveExportStage) => {
    done += 1;
    emit(stage);
    throwIfAborted();
  };

  try {
    // Guard violations from read stages; a single validation StorageError is
    // thrown after reads so exact store coverage is guaranteed.
    const guardViolations: string[] = [];
    // --- runs ---
    emit("runs");
    throwIfAborted();
    const summaries: RunSummary[] = [];
    await db.runSummaries.orderBy("id").each((row) => {
      if (isRunSummary(row.summary)) summaries.push(row.summary);
      else recordGuardFailure("runs.summaries", row.id, "runSummaries", guardViolations);
    });
    const details: RunRecordV2[] = [];
    await db.runDetails.orderBy("id").each((row) => {
      const compatible =
        repairRunRecordForCompatibility(row.record) ??
        (isRunRecordV2(row.record) ? row.record : null);
      if (compatible) details.push(compatible);
      else recordGuardFailure("runs.details", row.id, "runDetails", guardViolations);
    });
    completeStage("runs");

    // --- rubrics ---
    emit("rubrics");
    throwIfAborted();
    const identities: RubricRecord[] = [];
    await db.profiles.orderBy("id").each((row) => {
      if (isRubricRecord(row.record)) identities.push(row.record);
      else recordGuardFailure("rubrics.identities", row.id, "profiles", guardViolations);
    });
    const versions: EvaluationRubric[] = [];
    await db.profileVersions.orderBy("id").each((row) => {
      if (isEvaluationRubric(row.profile)) versions.push(row.profile);
      else recordGuardFailure("rubrics.versions", row.id, "profileVersions", guardViolations);
    });
    completeStage("rubrics");

    // --- suites ---
    emit("suites");
    throwIfAborted();
    const suites: EvaluationSuite[] = [];
    await db.suites.orderBy("id").each((row) => {
      if (isEvaluationSuite(row.suite)) suites.push(row.suite);
      else recordGuardFailure("suites", row.id, "suites", guardViolations);
    });
    completeStage("suites");

    // --- experiments ---
    emit("experiments");
    throwIfAborted();
    const experiments: ExperimentRecord[] = [];
    await db.experiments.orderBy("id").each((row) => {
      if (isExperimentRecord(row.experiment)) experiments.push(row.experiment);
      else recordGuardFailure("experiments", row.id, "experiments", guardViolations);
    });
    completeStage("experiments");

    // --- fusion (seven stores) ---
    emit("fusion");
    throwIfAborted();
    const recipes: FusionRecipeVersion[] = [];
    await db.fusionRecipes.orderBy("id").each((row) => {
      if (isFusionRecipeVersion(row.recipe)) recipes.push(row.recipe);
      else recordGuardFailure("fusion.recipes", row.id, "fusionRecipes", guardViolations);
    });
    const poolManifests: PoolManifestVersion[] = [];
    await db.poolManifests.orderBy("id").each((row) => {
      if (isPoolManifestVersion(row.manifest)) poolManifests.push(row.manifest);
      else recordGuardFailure("fusion.poolManifests", row.id, "poolManifests", guardViolations);
    });
    const studies: FusionStudy[] = [];
    await db.fusionStudies.orderBy("id").each((row) => {
      if (isFusionStudy(row.study)) studies.push(row.study);
      else recordGuardFailure("fusion.studies", row.id, "fusionStudies", guardViolations);
    });
    const trials: FusionTrial[] = [];
    await db.fusionTrials.orderBy("id").each((row) => {
      if (isFusionTrial(row.trial)) trials.push(row.trial);
      else recordGuardFailure("fusion.trials", row.id, "fusionTrials", guardViolations);
    });
    const attempts: FusionAttempt[] = [];
    await db.fusionAttempts.orderBy("id").each((row) => {
      if (isFusionAttempt(row.attempt)) attempts.push(row.attempt);
      else recordGuardFailure("fusion.attempts", row.id, "fusionAttempts", guardViolations);
    });
    const observations: EvaluationObservation[] = [];
    await db.fusionObservations.orderBy("id").each((row) => {
      if (isEvaluationObservation(row.observation)) observations.push(row.observation);
      else recordGuardFailure("fusion.observations", row.id, "fusionObservations", guardViolations);
    });
    const playbooks: FusionPlaybook[] = [];
    await db.fusionPlaybooks.orderBy("id").each((row) => {
      if (isFusionPlaybook(row.playbook)) playbooks.push(row.playbook);
      else recordGuardFailure("fusion.playbooks", row.id, "fusionPlaybooks", guardViolations);
    });
    completeStage("fusion");

    // --- tasks (every canonical collection) ---
    emit("tasks");
    throwIfAborted();
    const taskRecords: TaskRecord[] = [];
    await db.tasks.orderBy("id").each((row) => {
      if (isTaskRecord(row.record)) taskRecords.push(row.record);
      else recordGuardFailure("tasks.tasks", row.id, "tasks", guardViolations);
    });
    const taskVersions: TaskVersion[] = [];
    await db.taskVersions.orderBy("taskId").each((row) => {
      if (isTaskVersion(row.version_)) taskVersions.push(row.version_);
      else
        recordGuardFailure(
          "tasks.taskVersions",
          `${row.taskId}@${row.version}`,
          "taskVersions",
          guardViolations,
        );
    });
    const taskArtifacts: TaskArtifact[] = [];
    const artifactIdsValid = new Set<string>();
    await db.taskArtifacts.orderBy("id").each((row) => {
      const artifact: unknown = row;
      if (isTaskArtifact(artifact)) {
        taskArtifacts.push(artifact);
        artifactIdsValid.add(artifact.id);
      } else {
        recordGuardFailure(
          "tasks.taskArtifacts",
          (row as { id?: string }).id ?? "",
          "taskArtifacts",
          guardViolations,
        );
      }
    });
    const taskInstances: TaskInstance[] = [];
    await db.taskInstances.orderBy("id").each((row) => {
      if (isTaskInstance(row.instance)) taskInstances.push(row.instance);
      else recordGuardFailure("tasks.taskInstances", row.id, "taskInstances", guardViolations);
    });
    const taskFamilies: TaskFamily[] = [];
    await db.taskFamilies.orderBy("id").each((row) => {
      if (isTaskFamily(row.family)) taskFamilies.push(row.family);
      else recordGuardFailure("tasks.taskFamilies", row.id, "taskFamilies", guardViolations);
    });
    const taskFamilyAssignments: TaskFamilyAssignment[] = [];
    await db.taskFamilyAssignments.orderBy("id").each((row) => {
      if (isTaskFamilyAssignment(row.assignment)) taskFamilyAssignments.push(row.assignment);
      else
        recordGuardFailure(
          "tasks.taskFamilyAssignments",
          row.id,
          "taskFamilyAssignments",
          guardViolations,
        );
    });
    const taskFamilyRelations: TaskFamilyRelation[] = [];
    await db.taskFamilyRelations.orderBy("id").each((row) => {
      if (isExportableTaskFamilyRelation(row.relation)) taskFamilyRelations.push(row.relation);
      else
        recordGuardFailure(
          "tasks.taskFamilyRelations",
          row.id,
          "taskFamilyRelations",
          guardViolations,
        );
    });
    const taskFacetAnnotations: TaskFacetAnnotation[] = [];
    await db.taskFacetAnnotations.orderBy("id").each((row) => {
      if (isTaskFacetAnnotation(row.annotation)) taskFacetAnnotations.push(row.annotation);
      else
        recordGuardFailure(
          "tasks.taskFacetAnnotations",
          row.id,
          "taskFacetAnnotations",
          guardViolations,
        );
    });
    const taskRecordsById = new Map(taskRecords.map((t) => [t.id, t]));
    const taskMigrationCrosswalks: TaskMigrationCrosswalk[] = [];
    await db.taskMigrationCrosswalk.orderBy("legacyScopeKey").each((row) => {
      const cw: TaskMigrationCrosswalk = {
        legacyScopeKey: row.legacyScopeKey,
        taskId: row.taskId,
        taskVersion: row.taskVersion,
      };
      // Keep only crosswalks that reference a guard-passing canonical
      // task/version — a dangling crosswalk is a disposable index, not a
      // canonical entity (its removal is a reference-integrity filter, not the
      // silent dropping of a guard-failing row).
      const record = taskRecordsById.get(cw.taskId);
      if (record !== undefined && cw.taskVersion <= record.latestVersion) {
        taskMigrationCrosswalks.push(cw);
      }
    });
    completeStage("tasks");

    // --- task sets (records/versions/materializations/ownership crosswalks) ---
    emit("task-sets");
    throwIfAborted();
    const taskSetRecords: TaskSetRecord[] = [];
    await db.taskSets.orderBy("id").each((row) => {
      if (isTaskSetRecord(row.record)) taskSetRecords.push(row.record);
      else recordGuardFailure("taskSets.records", row.id, "taskSets", guardViolations);
    });
    const taskSetVersions: TaskSetVersion[] = [];
    await db.taskSetVersions.orderBy("taskSetId").each((row) => {
      if (isTaskSetVersion(row.version_)) taskSetVersions.push(row.version_);
      else
        recordGuardFailure(
          "taskSets.versions",
          `${row.taskSetId}@${row.version}`,
          "taskSetVersions",
          guardViolations,
        );
    });
    const taskSetMaterializations: TaskSetMaterializationRecord[] = [];
    await db.taskSetMaterializations.orderBy("id").each((row) => {
      if (isTaskSetMaterializationRecord(row)) taskSetMaterializations.push(row);
      else
        recordGuardFailure(
          "taskSets.materializations",
          row.id,
          "taskSetMaterializations",
          guardViolations,
        );
    });
    const taskSetOwnershipCrosswalks: TaskSetOwnershipCrosswalkRow[] = [];
    await db.taskSetOwnershipCrosswalk.orderBy("key").each((row) => {
      const key = (row as TaskSetOwnershipCrosswalkRow).key;
      if (isTaskSetOwnershipCrosswalkRow(row)) taskSetOwnershipCrosswalks.push(row);
      else
        recordGuardFailure(
          "taskSets.ownershipCrosswalks",
          key ?? "",
          "taskSetOwnershipCrosswalk",
          guardViolations,
        );
    });
    completeStage("task-sets");

    // Exact store coverage: any persisted canononical row that fails its
    // record guard blocks the whole export. Dexie `.each()` swallows a
    // synchronous callback throw, so violations are collected during reads and
    // converted to a single redacted validation StorageError here, before any
    // artifact-bytes encoding. No archive is delivered.
    if (guardViolations.length > 0) {
      throw new StorageError("validation", guardViolations.join("; "));
    }

    // --- artifact bytes (encoded alongside the canonical task payload) ---
    emit("artifact-bytes");
    throwIfAborted();
    const artifactRows = await db.taskArtifactBytes.toArray();
    const artifactRowById = new Map(artifactRows.map((row) => [row.id, row]));
    const taskArtifactBytes: ArchiveV2TaskArtifactBytes[] = [];
    const blockedBytes: string[] = [];
    for (const artifact of taskArtifacts) {
      const row = artifactRowById.get(artifact.id);
      if (row === undefined) {
        throw new StorageError(
          "validation",
          `tasks.taskArtifacts[${artifact.id}] is missing bytes payload.`,
        );
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(row.bytes);
      if (CREDENTIAL_LIKE_INLINE.test(text)) {
        blockedBytes.push(
          `tasks.taskArtifactBytes[${artifact.id}] carries credential-like material (value ${REDACTED})`,
        );
        continue;
      }
      taskArtifactBytes.push({ id: artifact.id, bytesBase64: v2BytesToBase64(row.bytes) });
    }
    completeStage("artifact-bytes");

    // --- scan (structured fields, BEFORE finalizing counts/digest) ---
    emit("scan");
    throwIfAborted();

    const violations: string[] = [...blockedBytes];
    // Guard-passing entities already carry no prohibited KEY names; the
    // pre-delivery safety net is a deep credential-VALUE scan of every
    // structured record. Identity-key fields are skipped (they legitimately
    // repeat entity ids). Diagnostics name entity/collection + id, never the
    // matched value or its content.
    const scanStructured = (label: string, id: string, entity: unknown) => {
      if (v2ScanForCredentialValue(entity)) {
        violations.push(`${label}[${id}] contains credential-like material (value ${REDACTED})`);
      }
    };
    for (const s of summaries) scanStructured("runs.summaries", s.id, s);
    for (const d of details) scanStructured("runs.details", d.id, d);
    for (const r of identities) scanStructured("rubrics.identities", r.id, r);
    for (const r of versions) scanStructured("rubrics.versions", `${r.id}@${r.version}`, r);
    for (const s of suites) scanStructured("suites", s.id, s);
    for (const e of experiments) scanStructured("experiments", e.id, e);
    for (const r of recipes) scanStructured("fusion.recipes", `${r.id}@${r.version}`, r);
    for (const p of poolManifests)
      scanStructured("fusion.poolManifests", `${p.id}@${p.version}`, p);
    for (const s of studies) scanStructured("fusion.studies", s.id, s);
    for (const t of trials) scanStructured("fusion.trials", t.id, t);
    for (const a of attempts) scanStructured("fusion.attempts", a.id, a);
    for (const o of observations) scanStructured("fusion.observations", o.id, o);
    for (const p of playbooks) scanStructured("fusion.playbooks", p.id, p);
    for (const t of taskRecords) scanStructured("tasks.tasks", t.id, t);
    for (const v of taskVersions)
      scanStructured("tasks.taskVersions", `${v.taskId}@${v.version}`, v);
    for (const a of taskArtifacts) scanStructured("tasks.taskArtifacts", a.id, a);
    for (const i of taskInstances) scanStructured("tasks.taskInstances", i.id, i);
    for (const f of taskFamilies) scanStructured("tasks.taskFamilies", f.id, f);
    for (const a of taskFamilyAssignments) scanStructured("tasks.taskFamilyAssignments", a.id, a);
    for (const r of taskFamilyRelations) scanStructured("tasks.taskFamilyRelations", r.id, r);
    for (const a of taskFacetAnnotations) scanStructured("tasks.taskFacetAnnotations", a.id, a);
    for (const c of taskMigrationCrosswalks)
      scanStructured("tasks.taskMigrationCrosswalks", c.legacyScopeKey, c);
    for (const r of taskSetRecords) scanStructured("taskSets.records", r.id, r);
    for (const v of taskSetVersions)
      scanStructured("taskSets.versions", `${v.taskSetId}@${v.version}`, v);
    for (const m of taskSetMaterializations) scanStructured("taskSets.materializations", m.id, m);
    for (const c of taskSetOwnershipCrosswalks)
      scanStructured("taskSets.ownershipCrosswalks", c.key, c);

    completeStage("scan");

    if (violations.length > 0) {
      throw new StorageError(
        "validation",
        `Export blocked: prohibited credential/auth material found. ${violations.join("; ")}`,
      );
    }

    // --- finalize ---
    emit("finalize");

    const archive: WorkbenchArchiveV2 = {
      manifest: {
        formatVersion: ARCHIVE_V2_FORMAT_VERSION,
        storageVersion: ARCHIVE_V2_STORAGE_VERSION,
        exportedAt: now(),
        producer: "rsemble-ai",
        counts: {
          runSummaries: summaries.length,
          runDetails: details.length,
          rubricIdentities: identities.length,
          rubricVersions: versions.length,
          suites: suites.length,
          experiments: experiments.length,
          fusionRecipes: recipes.length,
          poolManifests: poolManifests.length,
          fusionStudies: studies.length,
          fusionTrials: trials.length,
          fusionAttempts: attempts.length,
          fusionObservations: observations.length,
          fusionPlaybooks: playbooks.length,
          tasks: taskRecords.length,
          taskVersions: taskVersions.length,
          taskArtifacts: taskArtifacts.length,
          taskArtifactBytes: taskArtifactBytes.length,
          taskInstances: taskInstances.length,
          taskFamilies: taskFamilies.length,
          taskFamilyAssignments: taskFamilyAssignments.length,
          taskFamilyRelations: taskFamilyRelations.length,
          taskFacetAnnotations: taskFacetAnnotations.length,
          taskMigrationCrosswalks: taskMigrationCrosswalks.length,
          taskSets: taskSetRecords.length,
          taskSetVersions: taskSetVersions.length,
          taskSetMaterializations: taskSetMaterializations.length,
          taskSetOwnershipCrosswalks: taskSetOwnershipCrosswalks.length,
        },
        payloadDigest: "",
        disclosure: { scope: "local", notes: ARCHIVE_V2_DISCLOSURE_NOTES },
      },
      runs: {
        summaries: v2SortById(summaries),
        details: v2SortById(details),
      },
      rubrics: {
        identities: v2SortById(identities),
        versions: v2SortByIdVersion(versions),
      },
      suites: v2SortById(suites),
      experiments: v2SortById(experiments),
      fusion: {
        recipes: v2SortByIdVersion(recipes),
        poolManifests: v2SortByIdVersion(poolManifests),
        studies: v2SortById(studies),
        trials: v2SortById(trials),
        attempts: v2SortById(attempts),
        observations: v2SortById(observations),
        playbooks: v2SortById(playbooks),
      },
      tasks: {
        tasks: v2SortById(taskRecords),
        taskVersions: v2SortByTaskIdVersion(taskVersions),
        taskArtifacts: v2SortById(taskArtifacts),
        taskArtifactBytes: v2SortById(taskArtifactBytes),
        taskInstances: v2SortById(taskInstances),
        taskFamilies: v2SortById(taskFamilies),
        taskFamilyAssignments: v2SortById(taskFamilyAssignments),
        taskFamilyRelations: v2SortById(taskFamilyRelations),
        taskFacetAnnotations: v2SortById(taskFacetAnnotations),
        taskMigrationCrosswalks: v2SortByLegacyScopeKey(taskMigrationCrosswalks),
      },
      taskSets: {
        records: v2SortById(taskSetRecords),
        versions: v2SortByTaskSetIdVersion(taskSetVersions),
        materializations: v2SortById(taskSetMaterializations),
        ownershipCrosswalks: v2SortByKey(taskSetOwnershipCrosswalks),
      },
    };
    // Digest is computed over the final payload (collections only — the
    // manifest carries the digest itself).
    archive.manifest.payloadDigest = computeArchiveV2PayloadDigest(archive);

    completeStage("finalize");
    return archive;
  } catch (err) {
    if (err instanceof ArchiveExportCancelledError) throw err;
    if (err instanceof StorageError) throw err;
    throw classifyStorageError(err);
  }
}

// =============================================================================
// Archive v2 import adapter (Child 02 Task 10C)
//
// Preview-first, collision-safe, cancellation-safe, atomic import for both
// archive formats:
//
//  - `previewWorkbenchArchive` classifies EVERY importable entity
//    (create/reuse/collision/invalid) against the current database with
//    deterministic, sorted output. It never writes. Validation runs over the
//    complete v2 payload — manifest counts, payload digest, references,
//    prohibited content, and artifact bytes — before the preview classifies
//    anything. Corrupt/guard-failing entities and digest-mismatched artifact
//    bytes are reported as `invalid` preview rows (never committed) instead of
//    aborting the read-only preview. Artifact bytes are decoded once during
//    preview and carried into the commit so and digest re-verification happens
//    against the exact bytes that were previewed.
//
//  - `commitPreviewWorkbenchArchiveV2` commit a v2 preview meter-by-meter in
//    ONE Dexie transaction spanning every touched store. Canonically identical
//    records are reused; ANY non-identical ID collision aborts the commit
//    BEFORE the transaction opens (no remap, no overwrite before Child 09);
//    any injected failure/quota/cancellation rolls the whole commit back —
//    source and target stay unchanged. Artifact bytes are re-hashed at commit
//    and written only for newly created artifacts; reused artifact IDs assert
//    byte-identical existing payloads (byte equality guards reuse per §3.3).
//
//  - `importWorkbenchArchiveAuto` dispatches a decoded JSON value through the
//    v1 adapter (preserved verbatim) or the v2 adapter behind the complete
//    payload validator. This is the single-shot path used by legacy callers;
//    interactive UI composes preview + confirm explicitly.
// =============================================================================

/** Stable identity of one previewed entity across both formats. */
export interface ArchivePreviewEntity {
  /** Top-level collection label (e.g. "suites", "runs.details",
   *  "tasks.taskVersions") or the schemaVersion-1 label for the legacy shape:
   *  v1 "profiles" groups are surfaced as their v2 names. */
  collection: string;
  /** Deterministic per-collection key (id, or id@version composite). */
  key: string;
}

/** A non-identical same-ID record reported during preview. */
export interface ArchivePreviewCollision extends ArchivePreviewEntity {
  /** Explanatory classification only — record CONTENT is never echoed. */
  reason: "content-differs" | "artifact-bytes-differ";
}

/** An entity that failed its record guard, or artifact bytes whose decoded
 *  digest no longer matches their summary. Never committed. */
export interface ArchivePreviewInvalid extends ArchivePreviewEntity {
  reason: "guard" | "artifact-digest" | "artifact-missing-bytes" | "prohibited-content";
}

/** Deterministic per-collection preview counts, sorted by collection name. */
export interface ArchivePreviewCollectionCount {
  collection: string;
  total: number;
  create: number;
  reuse: number;
  collision: number;
  invalid: number;
}

/** Decoded artifact bytes materialized during preview; commit re-verifies the
 *  digest against the artifact summary before writing. */
export interface ArchivePreviewArtifactBytes {
  id: string;
  bytes: Uint8Array;
}

/** The complete, write-free import preview consumed by confirmation UI and
 *  the atomic commit. */
export interface ArchiveImportPreview {
  format: "v1" | "v2";
  /** Human-facing source label (file name or adapter tag); sanitized — never
   *  archive content. */
  sourceLabel: string;
  totalEntities: number;
  counts: ArchivePreviewCollectionCount[];
  create: ArchivePreviewEntity[];
  reuse: ArchivePreviewEntity[];
  collisions: ArchivePreviewCollision[];
  invalid: ArchivePreviewInvalid[];
  artifactBytes: ArchivePreviewArtifactBytes[];
  /** The validated, decoded payload the commit consumes. Internal: not part of
   *  the observable preview counts and never rendered. */
  payload: unknown;
}

/** Options for the preview stage. */
export interface ArchiveImportPreviewOptions {
  /** Label reported back on the preview (file name, adapter tag). */
  sourceLabel?: string;
  /** Abort during the preview scan; the preview is read-only so cancellation
   *  is naturally immediate. */
  signal?: AbortSignal;
}

/** Outcome of an atomic v2 commit. `created`/`reused` carry preview keys;
 *  `skipped` reports commit-pass no-ops (a record re-seeded to the same value
 *  by a racing writer). */
export interface ArchiveImportCommitResult {
  created: string[];
  reused: string[];
  skipped: string[];
  collisions: string[];
}

/** Options for the commit stage. */
export interface ArchiveImportCommitOptions {
  signal?: AbortSignal;
}

/** Single-shot auto-dispatch outcome. */
export type ImportAutoResult =
  { format: "v1"; v1: ArchiveImportResult } | { format: "v2"; v2: ArchiveImportCommitResult };

/** Rejection raised when an import is cancelled before its commit begins.
 *  Distinct from StorageError so callers can classify cancellation. */
export class ArchiveImportCancelledError extends Error {
  constructor() {
    super("Import was cancelled — nothing was imported.");
    this.name = "ArchiveImportCancelledError";
  }
}

/** Label an entity key for counting/reporting. Entity CONTENT never crosses
 *  this boundary — only the collection name and the deterministic key. */
function previewKey(collection: string, key: string): ArchivePreviewEntity {
  return { collection, key };
}

function byCollectionThenKey(
  a: { collection: string; key: string },
  b: { collection: string; key: string },
): number {
  if (a.collection !== b.collection) return a.collection < b.collection ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function versionKey(id: string, version: number): string {
  return `${id}@${version}`;
}

/** Canonical byte equality over logical ranges (mirrors task artifact reuse). */
function bytesMatch(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function decodeBase64Bytes(encoded: string): Uint8Array | null {
  try {
    const raw = atob(encoded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

interface PreviewBucketState {
  create: ArchivePreviewEntity[];
  reuse: ArchivePreviewEntity[];
  collisions: ArchivePreviewCollision[];
  invalid: ArchivePreviewInvalid[];
  artifactBytes: ArchivePreviewArtifactBytes[];
}

function emptyPreviewBuckets(): PreviewBucketState {
  return { create: [], reuse: [], collisions: [], invalid: [], artifactBytes: [] };
}

/**
 * Preview one collection of same-key records against a getter that resolves
 * the existing persisted domain value. Returns nothing — pushes into buckets.
 * `guarded` is pre-filtered to guard-passing records; the collection label is
 * the v2 reporting name.
 */
async function previewSameKeyCollection<T>(
  collection: string,
  guarded: T[],
  keyOf: (value: T) => string,
  getExisting: (key: string) => Promise<unknown | undefined>,
  extractExisting: (existing: unknown) => unknown,
  buckets: PreviewBucketState,
): Promise<void> {
  for (const incoming of guarded) {
    const key = keyOf(incoming);
    const existing = await getExisting(key);
    if (existing === undefined) {
      buckets.create.push(previewKey(collection, key));
    } else if (canon(extractExisting(existing)) === canon(incoming)) {
      buckets.reuse.push(previewKey(collection, key));
    } else {
      buckets.collisions.push({ collection, key, reason: "content-differs" });
    }
  }
}

/** Sort every preview bucket and derive the deterministic per-collection
 *  counts (alphabetical). */
function finalizePreview(
  format: "v1" | "v2",
  sourceLabel: string,
  payload: unknown,
  buckets: PreviewBucketState,
): ArchiveImportPreview {
  buckets.create.sort(byCollectionThenKey);
  buckets.reuse.sort(byCollectionThenKey);
  buckets.collisions.sort(byCollectionThenKey);
  buckets.invalid.sort(byCollectionThenKey);
  buckets.artifactBytes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byCollection = new Map<string, ArchivePreviewCollectionCount>();
  const tally = (
    list: ReadonlyArray<{ collection: string }>,
    field: "create" | "reuse" | "collision" | "invalid",
  ) => {
    for (const entry of list) {
      let row = byCollection.get(entry.collection);
      if (row === undefined) {
        row = {
          collection: entry.collection,
          total: 0,
          create: 0,
          reuse: 0,
          collision: 0,
          invalid: 0,
        };
        byCollection.set(entry.collection, row);
      }
      row.total += 1;
      row[field] += 1;
    }
  };
  tally(buckets.create, "create");
  tally(buckets.reuse, "reuse");
  tally(buckets.collisions, "collision");
  tally(buckets.invalid, "invalid");
  const counts = [...byCollection.values()].sort((a, b) =>
    a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0,
  );

  return {
    format,
    sourceLabel,
    totalEntities:
      buckets.create.length +
      buckets.reuse.length +
      buckets.collisions.length +
      buckets.invalid.length,
    counts,
    create: buckets.create,
    reuse: buckets.reuse,
    collisions: buckets.collisions,
    invalid: buckets.invalid,
    artifactBytes: buckets.artifactBytes,
    payload,
  };
}

// --- v2 collection grouping --------------------------------------------------

/** Guard a record list into (guard-passing records, invalid preview keys). */
function partitionGuarded<T>(
  collection: string,
  records: readonly T[],
  keyOf: (value: T) => string,
  guard: (value: unknown) => boolean,
): { guarded: T[]; invalid: ArchivePreviewInvalid[] } {
  const guarded: T[] = [];
  const invalid: ArchivePreviewInvalid[] = [];
  for (const record of records) {
    if (guard(record)) {
      guarded.push(record);
      continue;
    }
    // Corrupt entities may lack the fields a key extractor reads; a failed or
    // empty extraction still surfaces the entity as invalid (never crashes).
    let key = "";
    try {
      const extracted: unknown = keyOf(record);
      if (typeof extracted === "string") key = extracted;
    } catch {
      key = "";
    }
    invalid.push({ collection, key, reason: "guard" });
  }
  return { guarded, invalid };
}

async function previewV2(
  db: RSembleEvaluationDB,
  archive: WorkbenchArchiveV2,
  options: ArchiveImportPreviewOptions,
): Promise<ArchiveImportPreview> {
  const buckets = emptyPreviewBuckets();
  const signal = options.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) throw new ArchiveImportCancelledError();
  };
  throwIfAborted();

  // --- runs.summaries / runs.details -----------------------------------------
  // Full summaries are committed together with their same-ID detail so a run
  // pair appears once in the preview: they are classified inside runs.details.
  // Only legacy summaries are classified standalone here.
  {
    const part = partitionGuarded(
      "runs.summaries",
      archive.runs.summaries,
      (s) => s.id,
      (v) => isRunSummary(v),
    );
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    const legacy: LegacyRunSummary[] = [];
    for (const s of part.guarded) {
      if (isLegacyRunSummary(s)) legacy.push(s);
    }
    await previewSameKeyCollection(
      "runs.summaries",
      legacy,
      (s) => s.id,
      (k) => db.runSummaries.get(k).then((r) => (r === undefined ? undefined : r.summary)),
      (v) => v,
      buckets,
    );
  }
  {
    const part = partitionGuarded(
      "runs.details",
      archive.runs.details,
      (d) => d.id,
      (v) => {
        return repairRunRecordForCompatibility(v) !== null || isRunRecordV2(v);
      },
    );
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    const fullById = new Map<string, FullRunSummaryV2>();
    for (const s of archive.runs.summaries) if (isFullRunSummaryV2(s)) fullById.set(s.id, s);
    for (const record of part.guarded) {
      const compatible =
        repairRunRecordForCompatibility(record) ?? (isRunRecordV2(record) ? record : null);
      if (compatible === null) continue;
      const incomingSummary = fullById.get(record.id);
      const existingDetail = await db.runDetails.get(record.id);
      const existingSummary =
        incomingSummary !== undefined ? await db.runSummaries.get(record.id) : undefined;
      // The stored row may predate the compatibility repair; compare the
      // incoming canonical form against the stored row's repaired form so a
      // re-imported legacy pair is reused rather than reported conflicting.
      const existingCompatible =
        existingDetail === undefined
          ? null
          : (repairRunRecordForCompatibility(existingDetail.record) ??
            (isRunRecordV2(existingDetail.record) ? (existingDetail.record as RunRecordV2) : null));
      const detailSame =
        existingCompatible !== null && canon(existingCompatible) === canon(compatible);
      const summarySame =
        existingSummary === undefined
          ? incomingSummary === undefined
          : incomingSummary !== undefined &&
            isFullRunSummaryV2(existingSummary.summary) &&
            canon(existingSummary.summary) === canon(incomingSummary);
      if (existingDetail === undefined && existingSummary === undefined) {
        buckets.create.push(previewKey("runs.details", record.id));
      } else if (detailSame && summarySame) {
        buckets.reuse.push(previewKey("runs.details", record.id));
      } else {
        buckets.collisions.push({
          collection: "runs.details",
          key: record.id,
          reason: "content-differs",
        });
      }
    }
  }

  // --- rubrics ---------------------------------------------------------------
  {
    const part = partitionGuarded(
      "rubrics.identities",
      archive.rubrics.identities,
      (r) => r.id,
      (v) => isRubricRecord(v),
    );
    buckets.invalid.push(...part.invalid);
    await previewSameKeyCollection(
      "rubrics.identities",
      part.guarded,
      (r) => r.id,
      (k) => db.profiles.get(k).then((r) => (r === undefined ? undefined : r.record)),
      (v) => v,
      buckets,
    );
  }
  {
    const part = partitionGuarded(
      "rubrics.versions",
      archive.rubrics.versions,
      (r) => versionKey(r.id, r.version),
      (v) => isEvaluationRubric(v),
    );
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    await previewSameKeyCollection(
      "rubrics.versions",
      part.guarded,
      (r) => versionKey(r.id, r.version),
      (k) => {
        const [id, v] = splitVersionKey(k);
        return db.profileVersions
          .get([id, v])
          .then((r) => (r === undefined ? undefined : r.profile));
      },
      (v) => v,
      buckets,
    );
  }

  // --- suites / experiments --------------------------------------------------
  {
    const part = partitionGuarded(
      "suites",
      archive.suites,
      (s) => s.id,
      (v) => isEvaluationSuite(v),
    );
    buckets.invalid.push(...part.invalid);
    await previewSameKeyCollection(
      "suites",
      part.guarded,
      (s) => s.id,
      (k) => db.suites.get(k).then((r) => (r === undefined ? undefined : r.suite)),
      (v) => v,
      buckets,
    );
  }
  {
    const part = partitionGuarded(
      "experiments",
      archive.experiments,
      (e) => e.id,
      (v) => isExperimentRecord(v),
    );
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    await previewSameKeyCollection(
      "experiments",
      part.guarded,
      (e) => e.id,
      (k) => db.experiments.get(k).then((r) => (r === undefined ? undefined : r.experiment)),
      (v) => v,
      buckets,
    );
  }

  // --- fusion (seven stores) ---------------------------------------------------
  const fusion = archive.fusion;
  const fusionSpecs: Array<
    [
      string,
      readonly unknown[],
      (v: unknown) => boolean,
      (v: never) => string,
      (key: string) => Promise<unknown | undefined>,
    ]
  > = [
    [
      "fusion.recipes",
      fusion.recipes,
      isFusionRecipeVersion,
      (r: FusionRecipeVersion) => versionKey(r.id, r.version),
      async (k) => {
        const [id, v] = splitVersionKey(k);
        const row = await db.fusionRecipes.get([id, v]);
        return row === undefined ? undefined : row.recipe;
      },
    ],
    [
      "fusion.poolManifests",
      fusion.poolManifests,
      isPoolManifestVersion,
      (p: PoolManifestVersion) => versionKey(p.id, p.version),
      async (k) => {
        const [id, v] = splitVersionKey(k);
        const row = await db.poolManifests.get([id, v]);
        return row === undefined ? undefined : row.manifest;
      },
    ],
    [
      "fusion.studies",
      fusion.studies,
      isFusionStudy,
      (s: FusionStudy) => s.id,
      async (k) => {
        const row = await db.fusionStudies.get(k);
        return row === undefined ? undefined : row.study;
      },
    ],
    [
      "fusion.trials",
      fusion.trials,
      isFusionTrial,
      (t: FusionTrial) => t.id,
      async (k) => {
        const row = await db.fusionTrials.get(k);
        return row === undefined ? undefined : row.trial;
      },
    ],
    [
      "fusion.attempts",
      fusion.attempts,
      isFusionAttempt,
      (a: FusionAttempt) => a.id,
      async (k) => {
        const row = await db.fusionAttempts.get(k);
        return row === undefined ? undefined : row.attempt;
      },
    ],
    [
      "fusion.observations",
      fusion.observations,
      isEvaluationObservation,
      (o: EvaluationObservation) => o.id,
      async (k) => {
        const row = await db.fusionObservations.get(k);
        return row === undefined ? undefined : row.observation;
      },
    ],
    [
      "fusion.playbooks",
      fusion.playbooks,
      isFusionPlaybook,
      (p: FusionPlaybook) => p.id,
      async (k) => {
        const row = await db.fusionPlaybooks.get(k);
        return row === undefined ? undefined : row.playbook;
      },
    ],
  ];
  for (const [collection, records, guard, keyOf, getter] of fusionSpecs) {
    const part = partitionGuarded(collection, records, keyOf as (v: unknown) => string, guard);
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    await previewSameKeyCollection(
      collection,
      part.guarded as unknown[],
      keyOf as (v: unknown) => string,
      getter,
      (v) => v,
      buckets,
    );
  }

  // --- tasks (every canonical collection) --------------------------------------
  const tasks = archive.tasks;
  const taskSpecs: Array<
    [string, readonly unknown[], (v: unknown) => boolean, (v: never) => string]
  > = [
    ["tasks.tasks", tasks.tasks, isTaskRecord, (t: TaskRecord) => t.id],
    [
      "tasks.taskVersions",
      tasks.taskVersions,
      isTaskVersion,
      (v: TaskVersion) => versionKey(v.taskId, v.version),
    ],
    ["tasks.taskInstances", tasks.taskInstances, isTaskInstance, (i: TaskInstance) => i.id],
    ["tasks.taskFamilies", tasks.taskFamilies, isTaskFamily, (f: TaskFamily) => f.id],
    [
      "tasks.taskFamilyAssignments",
      tasks.taskFamilyAssignments,
      isTaskFamilyAssignment,
      (a: TaskFamilyAssignment) => a.id,
    ],
    [
      "tasks.taskFamilyRelations",
      tasks.taskFamilyRelations,
      isExportableTaskFamilyRelation,
      (r: TaskFamilyRelation) => r.id,
    ],
    [
      "tasks.taskFacetAnnotations",
      tasks.taskFacetAnnotations,
      isTaskFacetAnnotation,
      (a: TaskFacetAnnotation) => a.id,
    ],
  ];
  for (const [collection, records, guard, keyOf] of taskSpecs) {
    const part = partitionGuarded(collection, records, keyOf as (v: unknown) => string, guard);
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    const getter =
      collection === "tasks.taskVersions"
        ? async (k: string) => {
            const [id, v] = splitVersionKey(k);
            const row = await db.taskVersions.get([id, v]);
            return row === undefined ? undefined : row.version_;
          }
        : collection === "tasks.tasks"
          ? async (k: string) => (await db.tasks.get(k))?.record
          : collection === "tasks.taskInstances"
            ? async (k: string) => (await db.taskInstances.get(k))?.instance
            : collection === "tasks.taskFamilies"
              ? async (k: string) => (await db.taskFamilies.get(k))?.family
              : collection === "tasks.taskFamilyAssignments"
                ? async (k: string) => (await db.taskFamilyAssignments.get(k))?.assignment
                : collection === "tasks.taskFamilyRelations"
                  ? async (k: string) => (await db.taskFamilyRelations.get(k))?.relation
                  : async (k: string) => (await db.taskFacetAnnotations.get(k))?.annotation;
    await previewSameKeyCollection(
      collection,
      part.guarded as unknown[],
      keyOf as (v: unknown) => string,
      getter,
      (v) => (v === undefined ? undefined : v),
      buckets,
    );
  }

  // --- tasks.taskArtifacts + bytes ---------------------------------------------
  {
    const part = partitionGuarded(
      "tasks.taskArtifacts",
      tasks.taskArtifacts,
      (a) => a.id,
      (v) => isTaskArtifact(v),
    );
    buckets.invalid.push(...part.invalid);
    throwIfAborted();
    const bytesById = new Map<string, ArchiveV2TaskArtifactBytes>();
    for (const entry of tasks.taskArtifactBytes) bytesById.set(entry.id, entry);
    for (const artifact of part.guarded) {
      const byteEntry = bytesById.get(artifact.id);
      let invalidReason: ArchivePreviewInvalid["reason"] | null = null;
      let decoded: Uint8Array | null = null;
      if (byteEntry === undefined) {
        invalidReason = "artifact-missing-bytes";
      } else {
        decoded = decodeBase64Bytes(byteEntry.bytesBase64);
        if (decoded === null) {
          invalidReason = "artifact-digest";
        } else {
          const recomputed = computeArtifactDigest(decoded);
          if (decoded.length !== artifact.byteCount || recomputed !== artifact.contentDigest) {
            invalidReason = "artifact-digest";
            decoded = null;
          }
        }
      }
      if (invalidReason !== null) {
        buckets.invalid.push({
          collection: "tasks.taskArtifacts",
          key: artifact.id,
          reason: invalidReason,
        });
        continue;
      }
      buckets.artifactBytes.push({ id: artifact.id, bytes: decoded! });
      const existing = await db.taskArtifacts.get(artifact.id);
      if (existing === undefined) {
        buckets.create.push(previewKey("tasks.taskArtifacts", artifact.id));
        continue;
      }
      const summarySame = canon(existing) === canon(artifact);
      if (!summarySame) {
        buckets.collisions.push({
          collection: "tasks.taskArtifacts",
          key: artifact.id,
          reason: "content-differs",
        });
        continue;
      }
      const existingBytesRow = await db.taskArtifactBytes.get(artifact.id);
      const byteSame =
        existingBytesRow !== undefined && bytesMatch(existingBytesRow.bytes, decoded!);
      if (byteSame) {
        buckets.reuse.push(previewKey("tasks.taskArtifacts", artifact.id));
      } else {
        buckets.collisions.push({
          collection: "tasks.taskArtifacts",
          key: artifact.id,
          reason: "artifact-bytes-differ",
        });
      }
    }
  }

  // --- tasks.taskMigrationCrosswalks ---------------------------------------------
  {
    for (const cw of tasks.taskMigrationCrosswalks) {
      throwIfAborted();
      const key = cw.legacyScopeKey;
      const existing = await db.taskMigrationCrosswalk.get(key);
      if (existing === undefined) {
        buckets.create.push(previewKey("tasks.taskMigrationCrosswalks", key));
      } else if (existing.taskId === cw.taskId && existing.taskVersion === cw.taskVersion) {
        buckets.reuse.push(previewKey("tasks.taskMigrationCrosswalks", key));
      } else {
        buckets.collisions.push({
          collection: "tasks.taskMigrationCrosswalks",
          key,
          reason: "content-differs",
        });
      }
    }
  }

  // --- taskSets (records/versions/materializations/ownership crosswalks) -----
  const taskSets = archive.taskSets;
  if (taskSets !== undefined) {
    {
      const part = partitionGuarded(
        "taskSets.records",
        taskSets.records,
        (r) => r.id,
        (v) => isTaskSetRecord(v),
      );
      buckets.invalid.push(...part.invalid);
      throwIfAborted();
      await previewSameKeyCollection(
        "taskSets.records",
        part.guarded,
        (r) => r.id,
        (k) => db.taskSets.get(k).then((r) => (r === undefined ? undefined : r.record)),
        (v) => v,
        buckets,
      );
    }
    {
      const part = partitionGuarded(
        "taskSets.versions",
        taskSets.versions,
        (v) => versionKey(v.taskSetId, v.version),
        (v) => isTaskSetVersion(v),
      );
      buckets.invalid.push(...part.invalid);
      throwIfAborted();
      await previewSameKeyCollection(
        "taskSets.versions",
        part.guarded,
        (v) => versionKey(v.taskSetId, v.version),
        (k) => {
          const [id, v] = splitVersionKey(k);
          return db.taskSetVersions
            .get([id, v])
            .then((r) => (r === undefined ? undefined : r.version_));
        },
        (v) => v,
        buckets,
      );
    }
    {
      const part = partitionGuarded(
        "taskSets.materializations",
        taskSets.materializations,
        (m) => m.id,
        (v) => isTaskSetMaterializationRecord(v),
      );
      buckets.invalid.push(...part.invalid);
      throwIfAborted();
      await previewSameKeyCollection(
        "taskSets.materializations",
        part.guarded,
        (m) => m.id,
        (k) => db.taskSetMaterializations.get(k),
        (v) => v,
        buckets,
      );
    }
    {
      const part = partitionGuarded(
        "taskSets.ownershipCrosswalks",
        taskSets.ownershipCrosswalks,
        (c) => c.key,
        (v) => isTaskSetOwnershipCrosswalkRow(v),
      );
      buckets.invalid.push(...part.invalid);
      throwIfAborted();
      await previewSameKeyCollection(
        "taskSets.ownershipCrosswalks",
        part.guarded,
        (c) => c.key,
        (k) => db.taskSetOwnershipCrosswalk.get(k),
        (v) => v,
        buckets,
      );
    }
  }

  throwIfAborted();
  return finalizePreview("v2", options.sourceLabel ?? "archive", archive, buckets);
}

/** Split a `<id>@<version>` composite key produced by versionKey. The ID
 *  pattern never contains "@" so the first "@" is the separator. */
function splitVersionKey(key: string): [string, number] {
  const at = key.indexOf("@");
  return [key.slice(0, at), Number(key.slice(at + 1))];
}

// --- Row mappings for the v2 commit (mirror the repository writers) -------------

function taskRowFor(record: TaskRecord) {
  return {
    id: record.id,
    record,
    latestVersion: record.latestVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
    origin: record.origin,
    revision: record.revision,
  };
}

function taskVersionRowFor(version: TaskVersion) {
  return {
    taskId: version.taskId,
    version: version.version,
    version_: version,
    createdAt: version.createdAt,
  };
}

function taskInstanceRowFor(instance: TaskInstance) {
  return {
    id: instance.id,
    instance,
    taskId: instance.taskId,
    taskVersion: instance.taskVersion,
    inputDigest: instance.inputDigest,
    inputCompleteness: instance.inputCompleteness,
    createdAt: instance.createdAt,
  };
}

function familyRowFor(family: TaskFamily) {
  return {
    id: family.id,
    family,
    parentFamilyId: family.parentFamilyId,
    updatedAt: family.updatedAt,
    archivedAt: family.archivedAt,
    revision: family.revision,
  };
}

function assignmentRowFor(assignment: TaskFamilyAssignment) {
  return {
    id: assignment.id,
    assignment,
    taskId: assignment.taskId,
    taskVersion: assignment.taskVersion,
    familyId: assignment.familyId,
    isPrimary: assignment.isPrimary ? 1 : 0,
    createdAt: assignment.createdAt,
    revision: assignment.revision,
    archivedAt: assignment.archivedAt,
  };
}

function relationRowFor(relation: TaskFamilyRelation) {
  return {
    id: relation.id,
    relation,
    fromFamilyId: relation.fromFamilyId,
    toFamilyId: relation.toFamilyId,
    kind: relation.kind,
    createdAt: relation.createdAt,
  };
}

function annotationRowFor(annotation: TaskFacetAnnotation) {
  return {
    id: annotation.id,
    annotation,
    taskId: annotation.taskId,
    taskVersion: annotation.taskVersion,
    facetId: annotation.facetId,
    valueId: annotation.valueId,
    createdAt: annotation.createdAt,
  };
}

function taskSetRecordRowFor(record: TaskSetRecord) {
  return {
    id: record.id,
    record,
    latestVersion: record.latestVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
    origin: record.origin,
    revision: record.revision,
  };
}

function taskSetVersionRowFor(version: TaskSetVersion) {
  return {
    taskSetId: version.taskSetId,
    version: version.version,
    version_: version,
    createdAt: version.createdAt,
  };
}

/**
 * Preview an import before any write. Both formats route through here: the v1
 * preview classifies identities deterministically and defers the final
 * skip/conflict decision to the preserved v1 adapter (its conflict-tolerant
 * semantics are unchanged); the v2 preview is the commit contract — a v2
 * commit NEVER tolerates collisions, never remaps, never overwrites.
 */
export async function previewWorkbenchArchive(
  db: RSembleEvaluationDB,
  payload: unknown,
  options: ArchiveImportPreviewOptions = {},
): Promise<ArchiveImportPreview> {
  const sourceLabel = options.sourceLabel ?? "archive";
  if (isWorkbenchArchiveV2(payload)) {
    const check = validateArchiveV2(payload);
    if (!check.valid) {
      const first = check.errors[0];
      throw new StorageError(
        "validation",
        `The archive is invalid — nothing was imported. ${first ? `${first.field}: ${first.message}` : ""}`.trim(),
      );
    }
    return previewV2(db, payload, options);
  }
  const v1 = parseWorkbenchArchive(payload);
  if (!v1.ok) {
    throw new StorageError(
      "validation",
      `The archive is invalid — nothing was imported. ${v1.errors[0] ?? ""}`.trim(),
    );
  }
  return previewV1(db, v1.archive, sourceLabel, options.signal);
}

async function previewV1(
  db: RSembleEvaluationDB,
  archive: WorkbenchArchiveV1,
  sourceLabel: string,
  signal?: AbortSignal,
): Promise<ArchiveImportPreview> {
  const buckets = emptyPreviewBuckets();
  const throwIfAborted = () => {
    if (signal?.aborted) throw new ArchiveImportCancelledError();
  };
  throwIfAborted();

  const fullById = new Map<string, FullRunSummaryV2>();
  const legacy: LegacyRunSummary[] = [];
  for (const s of archive.runs.summaries) {
    if (isFullRunSummaryV2(s)) fullById.set(s.id, s);
    else if (isLegacyRunSummary(s)) legacy.push(s);
  }
  for (const record of archive.runs.details) {
    throwIfAborted();
    const compatible =
      repairRunRecordForCompatibility(record) ?? (isRunRecordV2(record) ? record : null);
    if (compatible === null) {
      buckets.invalid.push({ collection: "runs.details", key: record.id, reason: "guard" });
      continue;
    }
    const existingDetail = await db.runDetails.get(record.id);
    const incomingSummary = fullById.get(record.id);
    const existingSummary =
      incomingSummary !== undefined ? await db.runSummaries.get(record.id) : undefined;
    const existingCompatible =
      existingDetail === undefined
        ? null
        : (repairRunRecordForCompatibility(existingDetail.record) ??
          (isRunRecordV2(existingDetail.record) ? (existingDetail.record as RunRecordV2) : null));
    const detailSame =
      existingCompatible !== null && canon(existingCompatible) === canon(compatible);
    const summarySame =
      existingSummary === undefined
        ? incomingSummary === undefined
        : incomingSummary !== undefined &&
          isFullRunSummaryV2(existingSummary.summary) &&
          canon(existingSummary.summary) === canon(incomingSummary);
    if (existingDetail === undefined && existingSummary === undefined) {
      buckets.create.push(previewKey("runs.details", record.id));
    } else if (detailSame && summarySame) {
      buckets.reuse.push(previewKey("runs.details", record.id));
    } else {
      buckets.collisions.push({
        collection: "runs.details",
        key: record.id,
        reason: "content-differs",
      });
    }
  }
  for (const s of legacy) {
    throwIfAborted();
    const existing = await db.runSummaries.get(s.id);
    if (existing === undefined) {
      buckets.create.push(previewKey("runs.summaries", s.id));
    } else if (canon(existing.summary) === canon(s)) {
      buckets.reuse.push(previewKey("runs.summaries", s.id));
    } else {
      buckets.collisions.push({
        collection: "runs.summaries",
        key: s.id,
        reason: "content-differs",
      });
    }
  }
  for (const r of archive.profiles.identities) {
    throwIfAborted();
    const existing = await db.profiles.get(r.id);
    if (existing === undefined) buckets.create.push(previewKey("rubrics.identities", r.id));
    else if (canon(existing.record) === canon(r))
      buckets.reuse.push(previewKey("rubrics.identities", r.id));
    else
      buckets.collisions.push({
        collection: "rubrics.identities",
        key: r.id,
        reason: "content-differs",
      });
  }
  for (const v of archive.profiles.versions) {
    throwIfAborted();
    const key = versionKey(v.id, v.version);
    const existing = await db.profileVersions.get([v.id, v.version]);
    if (existing === undefined) buckets.create.push(previewKey("rubrics.versions", key));
    else if (canon(existing.profile) === canon(v))
      buckets.reuse.push(previewKey("rubrics.versions", key));
    else
      buckets.collisions.push({ collection: "rubrics.versions", key, reason: "content-differs" });
  }
  for (const suite of archive.suites) {
    throwIfAborted();
    const existing = await db.suites.get(suite.id);
    if (existing === undefined) buckets.create.push(previewKey("suites", suite.id));
    else if (canon(existing.suite) === canon(suite))
      buckets.reuse.push(previewKey("suites", suite.id));
    else
      buckets.collisions.push({ collection: "suites", key: suite.id, reason: "content-differs" });
  }
  for (const experiment of archive.experiments) {
    throwIfAborted();
    const existing = await db.experiments.get(experiment.id);
    if (existing === undefined) buckets.create.push(previewKey("experiments", experiment.id));
    else if (canon(existing.experiment) === canon(experiment))
      buckets.reuse.push(previewKey("experiments", experiment.id));
    else
      buckets.collisions.push({
        collection: "experiments",
        key: experiment.id,
        reason: "content-differs",
      });
  }
  throwIfAborted();
  const preview = finalizePreview("v1", sourceLabel, archive, buckets);
  // The v1 preview payload carries the validated archive for the preserved
  // adapter — commit is not performed here.
  return { ...preview, payload: archive };
}

/**
 * Commit a v2 preview atomically: ONE Dexie transaction spanning every touched
 * store. Identical records are reused; ANY collision aborts before writes;
 * injected failure/quota/cancellation rolls the whole commit back.
 */
export async function commitPreviewWorkbenchArchiveV2(
  db: RSembleEvaluationDB,
  preview: ArchiveImportPreview,
  options: ArchiveImportCommitOptions = {},
): Promise<ArchiveImportCommitResult> {
  if (preview.format !== "v2") {
    throw new StorageError(
      "validation",
      "commitPreviewWorkbenchArchiveV2 requires a v2 preview — v1 commits use importWorkbenchArchive.",
    );
  }
  if (options.signal?.aborted) throw new ArchiveImportCancelledError();
  if (preview.collisions.length > 0) {
    throw new StorageError(
      "conflict",
      `Import aborted: ${preview.collisions.length} collision${preview.collisions.length === 1 ? "" : "s"} — colliding records were left unchanged.`,
    );
  }
  if (preview.invalid.length > 0) {
    throw new StorageError(
      "validation",
      `The archive is invalid — nothing was imported. ${preview.invalid.length} invalid ${preview.invalid.length === 1 ? "entity" : "entities"}.`,
    );
  }
  db.assertWritable();
  const archive = preview.payload as WorkbenchArchiveV2;
  const artifactBytesById = new Map(preview.artifactBytes.map((b) => [b.id, b.bytes]));
  // Re-validate the COMPLETE payload immediately before the transaction. A
  // valid v2 preview may be mutated after preview (stale/colliding/invalid
  // classifications), so the commit re-runs the full envelope validation —
  // manifest counts, payload digest (recomputed over the canonical payload),
  // reference graph, prohibited content, and artifact bytes — exactly like
  // `previewWorkbenchArchive`. The deep clone mirrors the serialization
  // boundary (a real commit receives a JSON-decoded value) and means a
  // mutation after preview can never be written under a stale digest.
  const revalidated = validateArchiveV2(JSON.parse(JSON.stringify(archive)));
  if (!revalidated.valid) {
    const first = revalidated.errors[0];
    throw new StorageError(
      "validation",
      `The archive changed after preview — nothing was imported. ${first ? `${first.field}: ${first.message}` : "validation failed"}`.trim(),
    );
  }
  // Re-hash the preview-materialized bytes exactly once at commit so the
  // bytes that hit the database are the bytes that passed preview validation.
  for (const artifact of archive.tasks.taskArtifacts) {
    const bytes = artifactBytesById.get(artifact.id);
    if (bytes === undefined) continue; // artifact not preview-materialized (e.g. reuse-only)
    const digest = computeArtifactDigest(bytes);
    if (bytes.length !== artifact.byteCount || digest !== artifact.contentDigest) {
      throw new StorageError(
        "validation",
        `tasks.taskArtifacts[${artifact.id}] digest no longer matches the previewed bytes.`,
      );
    }
  }

  const createByCollection = new Map<string, Set<string>>();
  for (const entry of preview.create) {
    let set = createByCollection.get(entry.collection);
    if (set === undefined) {
      set = new Set();
      createByCollection.set(entry.collection, set);
    }
    set.add(entry.key);
  }
  const isCreated = (collection: string, key: string) =>
    createByCollection.get(collection)?.has(key) === true;

  const created: string[] = [];
  const reused: string[] = [];
  const skipped: string[] = [];
  if (options.signal?.aborted) throw new ArchiveImportCancelledError();

  const fullById = new Map<string, FullRunSummaryV2>();
  for (const s of archive.runs.summaries) if (isFullRunSummaryV2(s)) fullById.set(s.id, s);

  try {
    await db.transaction(
      "rw",
      [
        db.runSummaries,
        db.runDetails,
        db.profiles,
        db.profileVersions,
        db.suites,
        db.experiments,
        db.fusionRecipes,
        db.poolManifests,
        db.fusionStudies,
        db.fusionTrials,
        db.fusionAttempts,
        db.fusionObservations,
        db.fusionPlaybooks,
        db.tasks,
        db.taskVersions,
        db.taskArtifacts,
        db.taskArtifactBytes,
        db.taskInstances,
        db.taskFamilies,
        db.taskFamilyAssignments,
        db.taskFamilyRelations,
        db.taskFacetAnnotations,
        db.taskMigrationCrosswalk,
        db.taskSets,
        db.taskSetVersions,
        db.taskSetMaterializations,
        db.taskSetOwnershipCrosswalk,
      ],
      async () => {
        if (options.signal?.aborted) throw new ArchiveImportCancelledError();

        // --- F1: re-check every CREATE destination inside the transaction ---
        // The preview's create/reuse classification is stale by the time the
        // commit runs: a racing writer may have inserted (or replaced) a row
        // under a key this commit plans to create. Before ANY put, re-read
        // every destination key this commit will write and, if a row exists,
        // canonically compare it to the incoming payload. An identical race is
        // reused (no write); any non-identical race aborts the whole commit
        // BEFORE a write — preserving the no-overwrite/no-partial-mutation
        // contract. Reads inside the transaction see the committed state, so
        // this closes the TOCTOU hole.
        const canonical = (v: unknown) => canonicalJsonString(v);
        const conflict = (collection: string, key: string) => {
          throw new StorageError(
            "conflict",
            `Import aborted: ${collection}[${key}] was changed after the preview — colliding records were left unchanged.`,
          );
        };

        // runs.details (paired summaries): reuse iff the stored detail+summary
        // are identical to the incoming pair.
        const fullById2 = new Map<string, FullRunSummaryV2>();
        for (const s of archive.runs.summaries) if (isFullRunSummaryV2(s)) fullById2.set(s.id, s);
        for (const record of archive.runs.details) {
          if (!isCreated("runs.details", record.id)) continue;
          const compatible =
            repairRunRecordForCompatibility(record) ?? (isRunRecordV2(record) ? record : null);
          if (compatible === null) continue;
          const existingDetail = await db.runDetails.get(record.id);
          const incomingSummary = fullById2.get(record.id);
          if (existingDetail !== undefined) {
            const existingCompatible =
              repairRunRecordForCompatibility(existingDetail.record) ??
              (isRunRecordV2(existingDetail.record)
                ? (existingDetail.record as RunRecordV2)
                : null);
            const detailSame =
              existingCompatible !== null &&
              canonical(existingCompatible) === canonical(compatible);
            const summarySame =
              incomingSummary === undefined ||
              ((await db.runSummaries.get(record.id))?.summary !== undefined &&
                canonical((await db.runSummaries.get(record.id))!.summary) ===
                  canonical(incomingSummary));
            if (!detailSame || !summarySame) conflict("runs.details", record.id);
          } else if (incomingSummary !== undefined) {
            const existingSummary = await db.runSummaries.get(record.id);
            if (
              existingSummary !== undefined &&
              canonical(existingSummary.summary) !== canonical(incomingSummary)
            ) {
              conflict("runs.summaries", record.id);
            }
          }
        }
        // Standalone (legacy) summaries.
        for (const s of archive.runs.summaries) {
          if (isFullRunSummaryV2(s)) continue;
          if (!isLegacyRunSummary(s)) continue;
          if (!isCreated("runs.summaries", s.id)) continue;
          const existing = await db.runSummaries.get(s.id);
          if (existing !== undefined && canonical(existing.summary) !== canonical(s)) {
            conflict("runs.summaries", s.id);
          }
        }
        // rubrics.identities / rubrics.versions.
        for (const r of archive.rubrics.identities) {
          if (!isCreated("rubrics.identities", r.id)) continue;
          const existing = await db.profiles.get(r.id);
          if (existing !== undefined && canonical(existing.record) !== canonical(r)) {
            conflict("rubrics.identities", r.id);
          }
        }
        for (const v of archive.rubrics.versions) {
          const key = versionKey(v.id, v.version);
          if (!isCreated("rubrics.versions", key)) continue;
          const existing = await db.profileVersions.get([v.id, v.version]);
          if (existing !== undefined && canonical(existing.profile) !== canonical(v)) {
            conflict("rubrics.versions", key);
          }
        }
        // suites.
        for (const suite of archive.suites) {
          if (!isCreated("suites", suite.id)) continue;
          const existing = await db.suites.get(suite.id);
          if (existing !== undefined && canonical(existing.suite) !== canonical(suite)) {
            conflict("suites", suite.id);
          }
        }
        // experiments.
        for (const experiment of archive.experiments) {
          if (!isCreated("experiments", experiment.id)) continue;
          const existing = await db.experiments.get(experiment.id);
          if (existing !== undefined && canonical(existing.experiment) !== canonical(experiment)) {
            conflict("experiments", experiment.id);
          }
        }
        // fusion (seven stores).
        for (const r of archive.fusion.recipes) {
          const key = versionKey(r.id, r.version);
          if (!isCreated("fusion.recipes", key)) continue;
          const existing = await db.fusionRecipes.get([r.id, r.version]);
          if (existing !== undefined && canonical(existing.recipe) !== canonical(r)) {
            conflict("fusion.recipes", key);
          }
        }
        for (const p of archive.fusion.poolManifests) {
          const key = versionKey(p.id, p.version);
          if (!isCreated("fusion.poolManifests", key)) continue;
          const existing = await db.poolManifests.get([p.id, p.version]);
          if (existing !== undefined && canonical(existing.manifest) !== canonical(p)) {
            conflict("fusion.poolManifests", key);
          }
        }
        for (const s of archive.fusion.studies) {
          if (!isCreated("fusion.studies", s.id)) continue;
          const existing = await db.fusionStudies.get(s.id);
          if (existing !== undefined && canonical(existing.study) !== canonical(s)) {
            conflict("fusion.studies", s.id);
          }
        }
        for (const t of archive.fusion.trials) {
          if (!isCreated("fusion.trials", t.id)) continue;
          const existing = await db.fusionTrials.get(t.id);
          if (existing !== undefined && canonical(existing.trial) !== canonical(t)) {
            conflict("fusion.trials", t.id);
          }
        }
        for (const a of archive.fusion.attempts) {
          if (!isCreated("fusion.attempts", a.id)) continue;
          const existing = await db.fusionAttempts.get(a.id);
          if (existing !== undefined && canonical(existing.attempt) !== canonical(a)) {
            conflict("fusion.attempts", a.id);
          }
        }
        for (const o of archive.fusion.observations) {
          if (!isCreated("fusion.observations", o.id)) continue;
          const existing = await db.fusionObservations.get(o.id);
          if (existing !== undefined && canonical(existing.observation) !== canonical(o)) {
            conflict("fusion.observations", o.id);
          }
        }
        for (const p of archive.fusion.playbooks) {
          if (!isCreated("fusion.playbooks", p.id)) continue;
          const existing = await db.fusionPlaybooks.get(p.id);
          if (existing !== undefined && canonical(existing.playbook) !== canonical(p)) {
            conflict("fusion.playbooks", p.id);
          }
        }
        // tasks.
        for (const t of archive.tasks.tasks) {
          if (!isCreated("tasks.tasks", t.id)) continue;
          const existing = await db.tasks.get(t.id);
          if (existing !== undefined && canonical(existing.record) !== canonical(t)) {
            conflict("tasks.tasks", t.id);
          }
        }
        for (const v of archive.tasks.taskVersions) {
          const key = versionKey(v.taskId, v.version);
          if (!isCreated("tasks.taskVersions", key)) continue;
          const existing = await db.taskVersions.get([v.taskId, v.version]);
          if (existing !== undefined && canonical(existing.version_) !== canonical(v)) {
            conflict("tasks.taskVersions", key);
          }
        }
        for (const artifact of archive.tasks.taskArtifacts) {
          if (!isCreated("tasks.taskArtifacts", artifact.id)) continue;
          const existing = await db.taskArtifacts.get(artifact.id);
          if (existing !== undefined && canonical(existing) !== canonical(artifact)) {
            conflict("tasks.taskArtifacts", artifact.id);
          }
        }
        for (const i of archive.tasks.taskInstances) {
          if (!isCreated("tasks.taskInstances", i.id)) continue;
          const existing = await db.taskInstances.get(i.id);
          if (existing !== undefined && canonical(existing.instance) !== canonical(i)) {
            conflict("tasks.taskInstances", i.id);
          }
        }
        for (const f of archive.tasks.taskFamilies) {
          if (!isCreated("tasks.taskFamilies", f.id)) continue;
          const existing = await db.taskFamilies.get(f.id);
          if (existing !== undefined && canonical(existing.family) !== canonical(f)) {
            conflict("tasks.taskFamilies", f.id);
          }
        }
        for (const a of archive.tasks.taskFamilyAssignments) {
          if (!isCreated("tasks.taskFamilyAssignments", a.id)) continue;
          const existing = await db.taskFamilyAssignments.get(a.id);
          if (existing !== undefined && canonical(existing.assignment) !== canonical(a)) {
            conflict("tasks.taskFamilyAssignments", a.id);
          }
        }
        for (const r of archive.tasks.taskFamilyRelations) {
          if (!isCreated("tasks.taskFamilyRelations", r.id)) continue;
          const existing = await db.taskFamilyRelations.get(r.id);
          if (existing !== undefined && canonical(existing.relation) !== canonical(r)) {
            conflict("tasks.taskFamilyRelations", r.id);
          }
        }
        for (const a of archive.tasks.taskFacetAnnotations) {
          if (!isCreated("tasks.taskFacetAnnotations", a.id)) continue;
          const existing = await db.taskFacetAnnotations.get(a.id);
          if (existing !== undefined && canonical(existing.annotation) !== canonical(a)) {
            conflict("tasks.taskFacetAnnotations", a.id);
          }
        }
        for (const cw of archive.tasks.taskMigrationCrosswalks) {
          if (!isCreated("tasks.taskMigrationCrosswalks", cw.legacyScopeKey)) continue;
          const existing = await db.taskMigrationCrosswalk.get(cw.legacyScopeKey);
          if (
            existing !== undefined &&
            (existing.taskId !== cw.taskId || existing.taskVersion !== cw.taskVersion)
          ) {
            conflict("tasks.taskMigrationCrosswalks", cw.legacyScopeKey);
          }
        }
        // --- taskSets (optional envelope) -------------------------------------
        if (archive.taskSets !== undefined) {
          for (const r of archive.taskSets.records) {
            if (!isCreated("taskSets.records", r.id)) continue;
            const existing = await db.taskSets.get(r.id);
            if (existing !== undefined && canonical(existing.record) !== canonical(r)) {
              conflict("taskSets.records", r.id);
            }
          }
          for (const v of archive.taskSets.versions) {
            const key = versionKey(v.taskSetId, v.version);
            if (!isCreated("taskSets.versions", key)) continue;
            const existing = await db.taskSetVersions.get([v.taskSetId, v.version]);
            if (existing !== undefined && canonical(existing.version_) !== canonical(v)) {
              conflict("taskSets.versions", key);
            }
          }
          for (const m of archive.taskSets.materializations) {
            if (!isCreated("taskSets.materializations", m.id)) continue;
            const existing = await db.taskSetMaterializations.get(m.id);
            if (existing !== undefined && canonical(existing) !== canonical(m)) {
              conflict("taskSets.materializations", m.id);
            }
          }
          for (const cw of archive.taskSets.ownershipCrosswalks) {
            if (!isCreated("taskSets.ownershipCrosswalks", cw.key)) continue;
            const existing = await db.taskSetOwnershipCrosswalk.get(cw.key);
            if (existing !== undefined && canonical(existing) !== canonical(cw)) {
              conflict("taskSets.ownershipCrosswalks", cw.key);
            }
          }
        }

        // --- runs.details (paired full summaries committed first) -------------

        for (const record of archive.runs.details) {
          const key = record.id;
          const compatible =
            repairRunRecordForCompatibility(record) ?? (isRunRecordV2(record) ? record : null);
          if (compatible === null) continue; // invalid → excluded from commit set
          const incomingSummary = fullById.get(record.id);
          if (isCreated("runs.details", key)) {
            if (incomingSummary !== undefined) {
              await db.runSummaries.put(summaryRowFor(incomingSummary));
            }
            await db.runDetails.put(detailRowFor(compatible));
            created.push(key);
          } else {
            reused.push(key);
          }
        }
        // Standalone full summaries with a detail count as part of their run
        // pair (committed above). Remaining summaries are legacy-only.
        for (const s of archive.runs.summaries) {
          if (isFullRunSummaryV2(s)) continue; // handled with details
          if (!isLegacyRunSummary(s)) continue; // invalid → excluded
          const key = s.id;
          if (isCreated("runs.summaries", key)) {
            await db.runSummaries.put(summaryRowFor(s));
            created.push(key);
          } else {
            reused.push(key);
          }
        }

        // --- rubrics / suites / experiments -----------------------------------
        for (const r of archive.rubrics.identities) {
          if (!isRubricRecord(r)) continue;
          if (isCreated("rubrics.identities", r.id)) {
            await db.profiles.put({
              id: r.id,
              record: r,
              revision: 1,
              latestVersion: r.latestVersion,
              updatedAt: r.updatedAt,
              archivedAt: r.archivedAt,
            });
            created.push(r.id);
          } else reused.push(r.id);
        }
        for (const v of archive.rubrics.versions) {
          if (!isEvaluationRubric(v)) continue;
          const key = versionKey(v.id, v.version);
          if (isCreated("rubrics.versions", key)) {
            await db.profileVersions.put({
              id: v.id,
              version: v.version,
              profile: v,
              updatedAt: v.updatedAt,
            });
            created.push(key);
          } else reused.push(key);
        }
        for (const suite of archive.suites) {
          if (!isEvaluationSuite(suite)) continue;
          if (isCreated("suites", suite.id)) {
            await db.suites.put({
              id: suite.id,
              suite,
              revision: 1,
              version: suite.version,
              updatedAt: suite.updatedAt,
              archivedAt: suite.archivedAt,
            });
            created.push(suite.id);
          } else reused.push(suite.id);
        }
        for (const experiment of archive.experiments) {
          if (!isExperimentRecord(experiment)) continue;
          if (isCreated("experiments", experiment.id)) {
            await db.experiments.put({
              id: experiment.id,
              experiment,
              revision: 1,
              suiteId: experiment.suiteId,
              suiteVersion: experiment.suiteVersion,
              protocolFingerprint: experiment.protocolFingerprint,
              createdAt: experiment.createdAt,
              status: experiment.status,
            });
            created.push(experiment.id);
          } else reused.push(experiment.id);
        }
        if (options.signal?.aborted) throw new ArchiveImportCancelledError();

        // --- fusion (seven stores) ---------------------------------------------
        for (const r of archive.fusion.recipes) {
          if (!isFusionRecipeVersion(r)) continue;
          const key = versionKey(r.id, r.version);
          if (isCreated("fusion.recipes", key)) {
            await db.fusionRecipes.put({
              id: r.id,
              version: r.version,
              recipe: r,
              createdAt: 0,
            });
            created.push(key);
          } else reused.push(key);
        }
        for (const p of archive.fusion.poolManifests) {
          if (!isPoolManifestVersion(p)) continue;
          const key = versionKey(p.id, p.version);
          if (isCreated("fusion.poolManifests", key)) {
            await db.poolManifests.put({
              id: p.id,
              version: p.version,
              manifest: p,
              createdAt: p.createdAt,
            });
            created.push(key);
          } else reused.push(key);
        }
        for (const s of archive.fusion.studies) {
          if (!isFusionStudy(s)) continue;
          if (isCreated("fusion.studies", s.id)) {
            await db.fusionStudies.put({
              id: s.id,
              study: s,
              revision: s.revision,
              suiteId: s.suiteRef.suiteId,
              suiteVersion: s.suiteRef.suiteVersion,
              status: s.status,
              updatedAt: s.updatedAt,
            });
            created.push(s.id);
          } else reused.push(s.id);
        }
        for (const t of archive.fusion.trials) {
          if (!isFusionTrial(t)) continue;
          if (isCreated("fusion.trials", t.id)) {
            await db.fusionTrials.put({
              id: t.id,
              trial: t,
              revision: t.revision,
              studyId: t.studyId,
              stage: t.stage,
              status: t.status,
              createdAt: t.createdAt,
            });
            created.push(t.id);
          } else reused.push(t.id);
        }
        for (const a of archive.fusion.attempts) {
          if (!isFusionAttempt(a)) continue;
          if (isCreated("fusion.attempts", a.id)) {
            await db.fusionAttempts.put({
              id: a.id,
              attempt: a,
              studyId: a.studyId,
              createdAt: a.createdAt,
            });
            created.push(a.id);
          } else reused.push(a.id);
        }
        for (const o of archive.fusion.observations) {
          if (!isEvaluationObservation(o)) continue;
          if (isCreated("fusion.observations", o.id)) {
            await db.fusionObservations.put({
              id: o.id,
              observation: o,
              trialId: o.trialId,
              createdAt: o.finishedAt,
            });
            created.push(o.id);
          } else reused.push(o.id);
        }
        for (const p of archive.fusion.playbooks) {
          if (!isFusionPlaybook(p)) continue;
          if (isCreated("fusion.playbooks", p.id)) {
            await db.fusionPlaybooks.put({
              id: p.id,
              playbook: p,
              studyId: p.studyId,
              createdAt: p.createdAt,
            });
            created.push(p.id);
          } else reused.push(p.id);
        }
        if (options.signal?.aborted) throw new ArchiveImportCancelledError();

        // --- tasks -----------------------------------------------------------------
        for (const t of archive.tasks.tasks) {
          if (!isTaskRecord(t)) continue;
          if (isCreated("tasks.tasks", t.id)) {
            await db.tasks.put(taskRowFor(t));
            created.push(t.id);
          } else reused.push(t.id);
        }
        for (const v of archive.tasks.taskVersions) {
          if (!isTaskVersion(v)) continue;
          const key = versionKey(v.taskId, v.version);
          if (isCreated("tasks.taskVersions", key)) {
            await db.taskVersions.put(taskVersionRowFor(v));
            created.push(key);
          } else reused.push(key);
        }
        for (const artifact of archive.tasks.taskArtifacts) {
          if (!isTaskArtifact(artifact)) continue;
          if (isCreated("tasks.taskArtifacts", artifact.id)) {
            const bytes = artifactBytesById.get(artifact.id);
            if (bytes === undefined) {
              throw new StorageError(
                "validation",
                `tasks.taskArtifacts[${artifact.id}] is missing bytes payload.`,
              );
            }
            await db.taskArtifacts.put({
              id: artifact.id,
              contentDigest: artifact.contentDigest,
              mediaType: artifact.mediaType,
              byteCount: artifact.byteCount,
              storageRef: artifact.storageRef,
              createdAt: artifact.createdAt,
            });
            await db.taskArtifactBytes.put({ id: artifact.id, bytes });
            created.push(artifact.id);
          } else reused.push(artifact.id);
        }
        for (const i of archive.tasks.taskInstances) {
          if (!isTaskInstance(i)) continue;
          if (isCreated("tasks.taskInstances", i.id)) {
            await db.taskInstances.put(taskInstanceRowFor(i));
            created.push(i.id);
          } else reused.push(i.id);
        }
        for (const f of archive.tasks.taskFamilies) {
          if (!isTaskFamily(f)) continue;
          if (isCreated("tasks.taskFamilies", f.id)) {
            await db.taskFamilies.put(familyRowFor(f));
            created.push(f.id);
          } else reused.push(f.id);
        }
        for (const a of archive.tasks.taskFamilyAssignments) {
          if (!isTaskFamilyAssignment(a)) continue;
          if (isCreated("tasks.taskFamilyAssignments", a.id)) {
            await db.taskFamilyAssignments.put(assignmentRowFor(a));
            created.push(a.id);
          } else reused.push(a.id);
        }
        for (const r of archive.tasks.taskFamilyRelations) {
          if (!isExportableTaskFamilyRelation(r)) continue;
          if (isCreated("tasks.taskFamilyRelations", r.id)) {
            await db.taskFamilyRelations.put(relationRowFor(r));
            created.push(r.id);
          } else reused.push(r.id);
        }
        for (const a of archive.tasks.taskFacetAnnotations) {
          if (!isTaskFacetAnnotation(a)) continue;
          if (isCreated("tasks.taskFacetAnnotations", a.id)) {
            await db.taskFacetAnnotations.put(annotationRowFor(a));
            created.push(a.id);
          } else reused.push(a.id);
        }
        for (const cw of archive.tasks.taskMigrationCrosswalks) {
          if (isCreated("tasks.taskMigrationCrosswalks", cw.legacyScopeKey)) {
            await db.taskMigrationCrosswalk.put({
              legacyScopeKey: cw.legacyScopeKey,
              taskId: cw.taskId,
              taskVersion: cw.taskVersion,
            });
            created.push(cw.legacyScopeKey);
          } else reused.push(cw.legacyScopeKey);
        }
        // --- taskSets (optional envelope) -------------------------------------
        if (archive.taskSets !== undefined) {
          for (const r of archive.taskSets.records) {
            if (!isTaskSetRecord(r)) continue;
            if (isCreated("taskSets.records", r.id)) {
              await db.taskSets.put(taskSetRecordRowFor(r));
              created.push(r.id);
            } else reused.push(r.id);
          }
          for (const v of archive.taskSets.versions) {
            if (!isTaskSetVersion(v)) continue;
            const key = versionKey(v.taskSetId, v.version);
            if (isCreated("taskSets.versions", key)) {
              await db.taskSetVersions.put(taskSetVersionRowFor(v));
              created.push(key);
            } else reused.push(key);
          }
          for (const m of archive.taskSets.materializations) {
            if (!isTaskSetMaterializationRecord(m)) continue;
            if (isCreated("taskSets.materializations", m.id)) {
              await db.taskSetMaterializations.put(m);
              created.push(m.id);
            } else reused.push(m.id);
          }
          for (const cw of archive.taskSets.ownershipCrosswalks) {
            if (!isTaskSetOwnershipCrosswalkRow(cw)) continue;
            if (isCreated("taskSets.ownershipCrosswalks", cw.key)) {
              await db.taskSetOwnershipCrosswalk.put(cw);
              created.push(cw.key);
            } else reused.push(cw.key);
          }
        }
        // `skipped` is a commit-pass no-op channel — currently empty by design
        // (preview classifies every persisted state; a racing same-value write
        // is indistinguishable from reuse and stays `reused`).
        void skipped;
      },
    );
  } catch (err) {
    if (err instanceof ArchiveImportCancelledError) throw err;
    if (err instanceof StorageError) throw err;
    throw classifyStorageError(err);
  }

  return {
    created,
    reused,
    skipped,
    collisions: preview.collisions.map((c) => c.key),
  };
}

/**
 * Single-shot import dispatch: decode/validate the payload, route v1 through
 * the preserved adapter and v2 through preview + atomic commit. Used by
 * legacy callers; interactive UI composes `previewWorkbenchArchive` +
 * `commitPreviewWorkbenchArchiveV2` explicitly behind a confirmation.
 */
export async function importWorkbenchArchiveAuto(
  db: RSembleEvaluationDB,
  payload: unknown,
  options: { signal?: AbortSignal; sourceLabel?: string } = {},
): Promise<ImportAutoResult> {
  if (isWorkbenchArchiveV2(payload)) {
    const preview = await previewWorkbenchArchive(db, payload, options);
    return { format: "v2", v2: await commitPreviewWorkbenchArchiveV2(db, preview) };
  }
  const check = parseWorkbenchArchive(payload);
  if (!check.ok) {
    throw new StorageError(
      "validation",
      `The archive is invalid — nothing was imported. ${check.errors[0] ?? ""}`.trim(),
    );
  }
  return { format: "v1", v1: await importWorkbenchArchive(db, check.archive) };
}
