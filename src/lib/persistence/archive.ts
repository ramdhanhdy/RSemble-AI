// =============================================================================
// RSemble AI — Workbench archive (plan 8.1, spec §13/§18/§20)
//
// Whole-workbench export/import across run summaries/details, profiles,
// suites, and experiments. Export is allowlisted by construction — only
// guard-passing domain records leave the database. Import validates every
// centralized v1 limit (bytes, counts, string size, depth, safe IDs) plus
// every record guard BEFORE any mutation, then writes inside one Dexie
// transaction: canonically identical records are skipped, same-ID different
// content is reported as conflicting and never written, and any thrown error
// rolls the whole import back.
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
  isRunSummary,
  type FullRunSummaryV2,
  type LegacyRunSummary,
  type RunRecordV2,
  type RunSummary,
} from "./run-types";
import {
  isEvaluationProfile,
  isEvaluationSuite,
  isExperimentRecord,
  isProfileRecord,
  type EvaluationProfile,
  type EvaluationSuite,
  type ExperimentRecord,
  type ProfileRecord,
} from "../evaluations/evaluation-types";
import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import { REDACTED } from "./error-redaction";

// --- Archive shape -------------------------------------------------------------

export interface WorkbenchArchiveV1 {
  schemaVersion: 1;
  exportedAt: number;
  runs: { summaries: RunSummary[]; details: RunRecordV2[] };
  profiles: { identities: ProfileRecord[]; versions: EvaluationProfile[] };
  suites: EvaluationSuite[];
  experiments: ExperimentRecord[];
}

/** Centralized v1 import limits (spec §18). */
export const IMPORT_LIMITS = {
  ARCHIVE_BYTES: 268435456,
  RUN_SUMMARIES: 25000,
  RUN_DETAILS: 25000,
  PROFILE_IDENTITIES: 5000,
  PROFILE_REVISIONS: 10000,
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
    if (isRecord(entry) && typeof entry.id === "string" && !IMPORT_LIMITS.ID_PATTERN.test(entry.id)) {
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
  const identitiesRaw = isRecord(profiles) && Array.isArray(profiles.identities) ? profiles.identities : null;
  const versionsRaw = isRecord(profiles) && Array.isArray(profiles.versions) ? profiles.versions : null;
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
    ["profiles.identities", lists.identities.length, IMPORT_LIMITS.PROFILE_IDENTITIES],
    ["profiles.versions", lists.versions.length, IMPORT_LIMITS.PROFILE_REVISIONS],
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
    if (isRunRecordV2(entry)) details.push(entry);
    else errors.push(guardError("runs.details", i, entry));
  });
  const identities: ProfileRecord[] = [];
  lists.identities.forEach((entry, i) => {
    if (isProfileRecord(entry)) identities.push(entry);
    else errors.push(guardError("profiles.identities", i, entry));
  });
  const versions: EvaluationProfile[] = [];
  lists.versions.forEach((entry, i) => {
    if (isEvaluationProfile(entry)) versions.push(entry);
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
  const identities: ProfileRecord[] = [];
  const versions: EvaluationProfile[] = [];
  const suites: EvaluationSuite[] = [];
  const experiments: ExperimentRecord[] = [];
  try {
    await db.runSummaries.orderBy("createdAt").each((row) => {
      if (isRunSummary(row.summary)) summaries.push(row.summary);
    });
    await db.runDetails.orderBy("createdAt").each((row) => {
      if (isRunRecordV2(row.record)) details.push(row.record);
    });
    await db.profiles.orderBy("updatedAt").each((row) => {
      if (isProfileRecord(row.record)) identities.push(row.record);
    });
    await db.profileVersions.orderBy("updatedAt").each((row) => {
      if (isEvaluationProfile(row.profile)) versions.push(row.profile);
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
    revision: 1,
    createdAt: summary.createdAt,
    completedAt: full ? full.completedAt : null,
    status: full ? full.status : null,
    mode: full ? full.mode : null,
    sourceKind: full?.source.kind ?? "adhoc",
    sourceProtocolFingerprint: full?.source.kind === "experiment" ? full.source.protocolFingerprint : null,
    sourceExperimentTaskAttemptId: full?.source.kind === "experiment" ? full.source.experimentTaskAttemptId : null,
    modelKeys: summary.modelKeys,
  };
}

function detailRowFor(record: RunRecordV2): RunDetailRow {
  return {
    id: record.id,
    record,
    revision: 1,
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
 * written), absent records are created with row revision 1. Any thrown error
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
          const existingSummary = incomingSummary ? await db.runSummaries.get(record.id) : undefined;
          const detailSame = existingDetail !== undefined && canon(existingDetail.record) === canon(record);
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

        // Profile identities.
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

        // Profile versions — conflict/skip at the [id+version] composite key.
        for (const profile of a.profiles.versions) {
          const key = `${profile.id}@${profile.version}`;
          const existing = await db.profileVersions.get([profile.id, profile.version]);
          if (existing) {
            if (canon(existing.profile) === canon(profile)) skipped.push(key);
            else conflicting.push(key);
            continue;
          }
          await db.profileVersions.put({
            id: profile.id,
            version: profile.version,
            profile,
            updatedAt: profile.updatedAt,
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
    const attempt =
      candidate.attempts.find((a) => a.attemptId === candidate.acceptedAttemptId) ??
      candidate.attempts[candidate.attempts.length - 1];
    lines.push(`### ${mdSafe(candidate.model)} (${mdSafe(candidate.providerId)}:${mdSafe(candidate.slug)})`, ``);
    if (attempt && typeof attempt.output === "string") {
      lines.push(attempt.output, ``);
    } else if (attempt && attempt.error !== null) {
      lines.push(`_Failed: ${mdSafe(attempt.error.message)}_`, ``);
    } else {
      lines.push(`_No output._`, ``);
    }
  }

  const report = record.judge.report;
  if (report) {
    lines.push(`## Score Explanations`, ``);
    for (const { label, candidateId } of report.labelMap) {
      const evaluation = report.evaluationsById[candidateId];
      if (!evaluation) continue;
      const candidate = record.candidates.find((c) => c.candidateId === candidateId);
      const name = candidate ? mdSafe(candidate.model) : candidateId;
      lines.push(`### ${name} (Candidate ${label}) — ${evaluation.overallScore.toFixed(1)}/5`, ``);
      lines.push(`Position: ${mdSafe(evaluation.position)}`, ``);
      lines.push(`Why this score: ${mdSafe(evaluation.rationale)}`, ``);
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
        lines.push(
          `Criterion scores:`,
          ...evaluation.criterionScores.map(
            (cs) => `- ${mdSafe(cs.label)}: ${cs.score.toFixed(1)}/5 — ${mdSafe(cs.rationale)}`,
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
      lines.push(`**Contradictions:**`, ...consensus.contradictions.map((t) => `- ${mdSafe(t)}`), ``);
    }
  }

  const fusionAttempt =
    record.fusion.attempts.find((a) => a.attemptId === record.fusion.acceptedAttemptId) ??
    record.fusion.attempts[record.fusion.attempts.length - 1];
  if (fusionAttempt && typeof fusionAttempt.result === "string") {
    lines.push(`## Fused Answer`, ``, fusionAttempt.result, ``);
  }

  if (record.winnerKeys.length > 0) {
    lines.push(`## Winners`, ``, ...record.winnerKeys.map((k) => `- ${mdSafe(k)}`), ``);
  }

  return lines.join("\n");
}
