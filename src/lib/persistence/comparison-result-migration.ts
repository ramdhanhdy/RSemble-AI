// =============================================================================
// RSemble AI — Comparison Result legacy migration (spec §10)
//
// Child 05 (Contextual Compare Results) Milestone A — Task 3.
//
// One-time, idempotent legacy indexing: every current full Compare
// RunRecordV2 becomes exactly one summary-only Comparison Result index with
// `comparisonId == runId`. It runs at startup and is safe to re-run:
//
//  - sources are enumerated in deterministic order (source run id asc) and
//    each run's existing index row is the resumable crosswalk: a valid row is
//    skipped, a corrupt row is repaired from the exact source record, and a
//    missing row is created once — repeated startup never produces duplicate
//    indexes;
//  - the completion marker is written only AFTER every created/repaired
//    index is re-read and verified to match what was written
//    (marker-after-verify): an interrupted pass resumes on the next startup
//    without losing or duplicating work, and a failing pass never marks
//    completion;
//  - evaluation-source (experiment) runs are excluded — they are not
//    semantic comparisons; legacy summary-only records stay Records-only
//    because no full result can be reconstructed from them;
//  - every migrated binding is ad hoc unless an explicit trustworthy link
//    already exists (a pre-existing valid index — e.g. a real pre-call input
//    snapshot or a canonical promotion — is never overwritten or relabelled).
//    Historical input content was never persisted as an immutable snapshot,
//    so migrated indexes reference a deterministic non-resolving snapshot ref
//    and record an explicit `instance_input_incomplete` limitation;
//  - no Task is ever auto-created (by prompt hash or any other signal) and
//    similar runs are never semantically merged;
//  - missing detail rows and corrupt sources are explicit limitations, never
//    crashes and never indexes;
//  - RunRecordV2 source records/summaries are read-only here: no run table
//    is ever included in a write transaction.
// =============================================================================

import { hashArtifactContent } from "../evaluations/protocol-fingerprint";
import { validateComparisonResultIndex } from "../compare/comparison-result-validation";
import { assertValidComparison, buildComparisonIndex } from "./comparison-repository";
import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";
import {
  isRunRecordV2,
  isRunSummary,
  repairRunRecordForCompatibility,
  type RunRecordV2,
} from "./run-types";

/** Storage-meta key of the one-time legacy migration completion marker. */
export const comparisonResultMigrationMarkerKey = "comparison-result-migration:v1";

/** Explicit limitation reasons recorded by the migration (spec §7.3, §10). */
export type ComparisonMigrationLimitationReason =
  | "missing_detail"
  | "corrupt_source"
  | "instance_input_incomplete";

export interface ComparisonMigrationLimitation {
  runId: string;
  reason: ComparisonMigrationLimitationReason;
}

export interface ComparisonMigrationResult {
  /** Indexes created this pass. */
  indexed: number;
  /** Invalid existing index rows repaired from their exact source records. */
  repaired: number;
  /** Valid existing index rows skipped (resume-by-crosswalk). */
  skippedExisting: number;
  /** Evaluation-source runs excluded: not semantic comparisons. */
  excludedEvaluation: number;
  /** Legacy summary-only records kept as Records-only. */
  legacyRecordsOnly: number;
  /** Explicit limitations in deterministic source-id order. */
  limitations: ComparisonMigrationLimitation[];
  complete: boolean;
}

/** Durable completion marker (marker-after-verify). */
export interface ComparisonMigrationMarker {
  kind: "comparison-result-migration";
  version: 1;
  completedAt: number;
  limitations: ComparisonMigrationLimitation[];
}

export interface ComparisonMigrationOptions {
  /** Injected clock for deterministic marker tests. */
  now?: () => number;
}

/**
 * Deterministic, safe, deliberately non-resolving ad-hoc snapshot reference
 * for migrated runs: historical input content was never persisted as an
 * immutable pre-call snapshot, and this ref never claims one exists
 * (`instance_input_incomplete` records that limitation explicitly).
 */
export function migratedInputSnapshotRef(runId: string): string {
  return `migrated:${hashArtifactContent(runId)}`;
}

/** Accept the record as-is or repair pre-cross-reference-guard shapes. */
function compatibleRecord(record: unknown): RunRecordV2 | null {
  return isRunRecordV2(record) ? record : repairRunRecordForCompatibility(record);
}

/**
 * Run one deterministic, idempotent legacy indexing pass over every current
 * full Compare RunRecordV2. Never mutates source run records and never
 * creates Tasks.
 */
export async function migrateComparisonResults(
  db: RSembleEvaluationDB,
  options: ComparisonMigrationOptions = {},
): Promise<ComparisonMigrationResult> {
  const now = options.now ?? (() => Date.now());
  db.assertWritable();
  try {
    const rows = await db.runSummaries.toArray();
    rows.sort((a, b) => a.id.localeCompare(b.id));

    const result: ComparisonMigrationResult = {
      indexed: 0,
      repaired: 0,
      skippedExisting: 0,
      excludedEvaluation: 0,
      legacyRecordsOnly: 0,
      limitations: [],
      complete: false,
    };

    for (const row of rows) {
      const runId = row.id;

      const summary = row.summary as unknown;
      if (!isRunSummary(summary)) {
        result.limitations.push({ runId, reason: "corrupt_source" });
        continue;
      }
      if (summary.kind === "legacy") {
        // Records-only: no full result can be reconstructed (spec §10).
        result.legacyRecordsOnly += 1;
        continue;
      }
      if (summary.source.kind === "experiment") {
        // Evaluation-source runs are not semantic comparisons.
        result.excludedEvaluation += 1;
        continue;
      }
      if (summary.id !== runId) {
        result.limitations.push({ runId, reason: "corrupt_source" });
        continue;
      }

      const detail = await db.runDetails.get(runId);
      if (!detail) {
        result.limitations.push({ runId, reason: "missing_detail" });
        continue;
      }
      const record = compatibleRecord(detail.record);
      if (!record || record.id !== runId || record.source.kind !== "adhoc") {
        result.limitations.push({ runId, reason: "corrupt_source" });
        continue;
      }

      // Resume-by-crosswalk: the existing index row (if any) decides.
      const existing = await db.comparisonResults.get(runId);
      if (existing && validateComparisonResultIndex(existing).ok) {
        result.skippedExisting += 1;
        // Only migrated rows carry the non-resolving ref; a real snapshot or
        // canonical binding is a trustworthy link with complete input.
        if (
          existing.taskBinding.kind === "ad_hoc" &&
          existing.taskBinding.inputSnapshotRef === migratedInputSnapshotRef(runId)
        ) {
          result.limitations.push({ runId, reason: "instance_input_incomplete" });
        }
        continue;
      }

      // Ad hoc binding: no historical record carries an explicit trustworthy
      // Task link, and no Task is ever invented (spec §10).
      const index = assertValidComparison(
        validateComparisonResultIndex(
          buildComparisonIndex(
            record,
            { kind: "ad_hoc", inputSnapshotRef: migratedInputSnapshotRef(runId) },
            {},
          ),
        ),
        "Invalid comparison index",
      );

      // Source run tables are never part of the write transaction: only the
      // index store is written, one row per run.
      await db.transaction("rw", db.comparisonResults, async () => {
        await db.comparisonResults.put(index);
      });
      if (existing) {
        result.repaired += 1;
      } else {
        result.indexed += 1;
      }

      // Marker-after-verify: the write only counts once re-read and equal.
      const stored = await db.comparisonResults.get(runId);
      if (!stored || JSON.stringify(stored) !== JSON.stringify(index)) {
        throw new StorageError(
          "validation",
          `Comparison migration verification failed for run ${runId}`,
        );
      }
      result.limitations.push({ runId, reason: "instance_input_incomplete" });
    }

    // Marker-after-verify: the completion marker follows only after every
    // created/repaired index above has been verified.
    const marker: ComparisonMigrationMarker = {
      kind: "comparison-result-migration",
      version: 1,
      completedAt: now(),
      limitations: result.limitations,
    };
    await db.storageMeta.put({ key: comparisonResultMigrationMarkerKey, value: marker });

    result.complete = true;
    return result;
  } catch (err) {
    if (err instanceof StorageError) throw err;
    throw classifyStorageError(err);
  }
}
