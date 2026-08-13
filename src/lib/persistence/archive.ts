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
//  - v2 (`exportWorkbenchArchiveV2`, Child 02 Task 10B): the task-first
//    envelope (`WorkbenchArchiveV2`). Exports every canonical Child 02
//    collection — exact Runs/Experiments, Rubrics, all seven Fusion stores,
//    Tasks/versions/artifacts+bytes/instances/families/assignments/relations/
//    facet annotations/crosswalks — in deterministic order with exact counts
//    and an integrity digest. Before delivery it scans structured fields and
//    artifact bytes for prohibited credential/auth material and blocks safely
//    with entity/type diagnostics, never echoing a matched value. Disposable
//    caches/indexes and unrestricted `storageMeta` are never read. Supports
//    progress reporting and cancellation before final delivery. V2 import is
//    deliberately not implemented in this slice.
// =============================================================================

import {
  RSembleEvaluationDB,
  StorageError,
  classifyStorageError,
  type RunDetailRow,
  type RunSummaryRow,
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
import {
  ARCHIVE_V2_FORMAT_VERSION,
  ARCHIVE_V2_STORAGE_VERSION,
  computeArchiveV2PayloadDigest,
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

/**
 * Export-time allowlist guard for task family relations. This is deliberately
 * NOT the canonical write guard (`isTaskFamilyRelation`): the domain
 * no-self-relation rule constrains what may be CREATED, not what may be
 * reported. Persisted legacy self-relations are real entities and must
 * round-trip through the archive faithfully — export omits only
 * structurally unsafe rows (bad identifiers, unknown kind, prohibited
 * credential/transport keys), mirroring the v1 allowlist construction.
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
 *  - Reads every Child 02 canonical collection; keeps ONLY guard-passing
 *    domain records (allowlisted by construction — never silently drops a
 *    valid entity, never reads `storageMeta`).
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
    // --- runs ---
    emit("runs");
    throwIfAborted();
    const summaries: RunSummary[] = [];
    await db.runSummaries.orderBy("id").each((row) => {
      if (isRunSummary(row.summary)) summaries.push(row.summary);
    });
    const details: RunRecordV2[] = [];
    await db.runDetails.orderBy("id").each((row) => {
      const compatible =
        repairRunRecordForCompatibility(row.record) ??
        (isRunRecordV2(row.record) ? row.record : null);
      if (compatible) details.push(compatible);
    });
    completeStage("runs");

    // --- rubrics ---
    emit("rubrics");
    throwIfAborted();
    const identities: RubricRecord[] = [];
    await db.profiles.orderBy("id").each((row) => {
      if (isRubricRecord(row.record)) identities.push(row.record);
    });
    const versions: EvaluationRubric[] = [];
    await db.profileVersions.orderBy("id").each((row) => {
      if (isEvaluationRubric(row.profile)) versions.push(row.profile);
    });
    completeStage("rubrics");

    // --- suites ---
    emit("suites");
    throwIfAborted();
    const suites: EvaluationSuite[] = [];
    await db.suites.orderBy("id").each((row) => {
      if (isEvaluationSuite(row.suite)) suites.push(row.suite);
    });
    completeStage("suites");

    // --- experiments ---
    emit("experiments");
    throwIfAborted();
    const experiments: ExperimentRecord[] = [];
    await db.experiments.orderBy("id").each((row) => {
      if (isExperimentRecord(row.experiment)) experiments.push(row.experiment);
    });
    completeStage("experiments");

    // --- fusion (seven stores) ---
    emit("fusion");
    throwIfAborted();
    const recipes: FusionRecipeVersion[] = [];
    await db.fusionRecipes.orderBy("id").each((row) => {
      if (isFusionRecipeVersion(row.recipe)) recipes.push(row.recipe);
    });
    const poolManifests: PoolManifestVersion[] = [];
    await db.poolManifests.orderBy("id").each((row) => {
      if (isPoolManifestVersion(row.manifest)) poolManifests.push(row.manifest);
    });
    const studies: FusionStudy[] = [];
    await db.fusionStudies.orderBy("id").each((row) => {
      if (isFusionStudy(row.study)) studies.push(row.study);
    });
    const trials: FusionTrial[] = [];
    await db.fusionTrials.orderBy("id").each((row) => {
      if (isFusionTrial(row.trial)) trials.push(row.trial);
    });
    const attempts: FusionAttempt[] = [];
    await db.fusionAttempts.orderBy("id").each((row) => {
      if (isFusionAttempt(row.attempt)) attempts.push(row.attempt);
    });
    const observations: EvaluationObservation[] = [];
    await db.fusionObservations.orderBy("id").each((row) => {
      if (isEvaluationObservation(row.observation)) observations.push(row.observation);
    });
    const playbooks: FusionPlaybook[] = [];
    await db.fusionPlaybooks.orderBy("id").each((row) => {
      if (isFusionPlaybook(row.playbook)) playbooks.push(row.playbook);
    });
    completeStage("fusion");

    // --- tasks (every canonical collection) ---
    emit("tasks");
    throwIfAborted();
    const taskRecords: TaskRecord[] = [];
    await db.tasks.orderBy("id").each((row) => {
      if (isTaskRecord(row.record)) taskRecords.push(row.record);
    });
    const taskVersions: TaskVersion[] = [];
    await db.taskVersions.orderBy("taskId").each((row) => {
      if (isTaskVersion(row.version_)) taskVersions.push(row.version_);
    });
    const taskArtifacts: TaskArtifact[] = [];
    const artifactIdsValid = new Set<string>();
    await db.taskArtifacts.orderBy("id").each((row) => {
      if (isTaskArtifact(row)) {
        taskArtifacts.push(row);
        artifactIdsValid.add(row.id);
      }
    });
    const taskInstances: TaskInstance[] = [];
    await db.taskInstances.orderBy("id").each((row) => {
      if (isTaskInstance(row.instance)) taskInstances.push(row.instance);
    });
    const taskFamilies: TaskFamily[] = [];
    await db.taskFamilies.orderBy("id").each((row) => {
      if (isTaskFamily(row.family)) taskFamilies.push(row.family);
    });
    const taskFamilyAssignments: TaskFamilyAssignment[] = [];
    await db.taskFamilyAssignments.orderBy("id").each((row) => {
      if (isTaskFamilyAssignment(row.assignment)) taskFamilyAssignments.push(row.assignment);
    });
    const taskFamilyRelations: TaskFamilyRelation[] = [];
    await db.taskFamilyRelations.orderBy("id").each((row) => {
      if (isExportableTaskFamilyRelation(row.relation)) taskFamilyRelations.push(row.relation);
    });
    const taskFacetAnnotations: TaskFacetAnnotation[] = [];
    await db.taskFacetAnnotations.orderBy("id").each((row) => {
      if (isTaskFacetAnnotation(row.annotation)) taskFacetAnnotations.push(row.annotation);
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
      // canonical entity.
      const record = taskRecordsById.get(cw.taskId);
      if (record !== undefined && cw.taskVersion <= record.latestVersion) {
        taskMigrationCrosswalks.push(cw);
      }
    });
    completeStage("tasks");

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
    for (const r of versions)
      scanStructured("rubrics.versions", `${r.id}@${r.version}`, r);
    for (const s of suites) scanStructured("suites", s.id, s);
    for (const e of experiments) scanStructured("experiments", e.id, e);
    for (const r of recipes)
      scanStructured("fusion.recipes", `${r.id}@${r.version}`, r);
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
    for (const a of taskFamilyAssignments)
      scanStructured("tasks.taskFamilyAssignments", a.id, a);
    for (const r of taskFamilyRelations)
      scanStructured("tasks.taskFamilyRelations", r.id, r);
    for (const a of taskFacetAnnotations)
      scanStructured("tasks.taskFacetAnnotations", a.id, a);
    for (const c of taskMigrationCrosswalks)
      scanStructured("tasks.taskMigrationCrosswalks", c.legacyScopeKey, c);

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
