// =============================================================================
// RSemble AI — Comparison Result repository (Dexie-backed)
//
// Child 05 (Contextual Compare Results) Milestone A — Task 2.
//
// Read-model repository over the RunRepository plus the summary-only
// Comparison Result index store (schema v11, spec §11). Reuses the confirmed
// repository idioms (probe-P1): db.assertWritable() before every mutation,
// db.transaction('rw', ...) for atomic writes, revision CAS with
// StorageError('conflict') on stale/missing, classifyStorageError for raw
// storage failures. Every index payload is runtime-validated before it is
// written (probe-P2) — the index never carries candidate outputs or judge
// rationale; RunRecordV2 remains the exact result authority.
//
// Contract highlights (spec §11):
//  - listComparisonResults applies every filter — including the model join
//    over the source run summaries — to the COMPLETE result set before
//    pagination;
//  - getComparisonResult returns the index plus the exact source record;
//    lifecycle drift between them yields a repairable warning, never a
//    fabricated merged state; a missing exact run is an explicit state;
//  - bindComparisonToTask / recordComparisonLineage are atomic CAS updates;
//  - rebuildComparisonIndex is idempotent: it refreshes derived summary
//    fields from the source record and never creates duplicate indexes.
// =============================================================================
import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";
import type { RunRepository } from "./run-repository";
import { isRunRecordV2, type RunRecordV2, type RunStatus } from "./run-types";
import {
  validateComparisonLineage,
  validateComparisonResultIndex,
  validateComparisonTaskBinding,
  isComparisonResultIndex,
  type ComparisonValidationResult,
} from "../compare/comparison-result-validation";
import type {
  ComparisonLineage,
  ComparisonMode,
  ComparisonResultIndex,
  ComparisonTaskBinding,
  PolicyPlaybookAttachment,
} from "../compare/comparison-result-types";

// --- query and result types --------------------------------------------------

export interface ComparisonListQuery {
  /** Case-insensitive substring match over the index title. */
  text?: string;
  /** Filter to comparisons whose source run roster includes this model key
   *  (joined from the source run summaries — the index itself never stores
   *  model keys). */
  modelKey?: string;
  status?: RunStatus;
  mode?: ComparisonMode;
  /** Task-binding filter. */
  bindingKind?: "ad_hoc" | "canonical";
  /** Canonical task id (canonical bindings only). */
  taskId?: string;
  /** Inclusive lower bound on index createdAt. */
  createdFrom?: number;
  /** Inclusive upper bound on index createdAt. */
  createdTo?: number;
  /** Page size (default 50). */
  limit?: number;
  /** Page offset (default 0). */
  offset?: number;
}

/** Lifecycle-derived summary fields the index mirrors from its source run. */
export interface ComparisonDerivedSummary {
  status: RunStatus;
  mode: ComparisonMode;
  title: string;
  updatedAt: number;
}

/**
 * Explicit source/index states (spec §11): drift between the stored index
 * and its exact source record is reported as a repairable warning, never as
 * a fabricated merged state. A missing exact run is its own state.
 */
export type ComparisonSourceMismatch =
  | {
      kind: "source_index_revision_mismatch";
      /** Exact repair action: re-run rebuildComparisonIndex(runId). */
      repair: "rebuildComparisonIndex";
      message: string;
      index: ComparisonDerivedSummary;
      source: ComparisonDerivedSummary;
    }
  | {
      kind: "missing_source_record";
      message: string;
    };

/** getComparisonResult payload: the index plus the exact source record. */
export interface ComparisonResultEnvelope {
  index: ComparisonResultIndex;
  /** Exact source RunRecordV2; null when the run detail row is missing. */
  record: RunRecordV2 | null;
  warning: ComparisonSourceMismatch | null;
}

// --- repository interface ----------------------------------------------------

export interface CreateComparisonEnvelopeOptions {
  /** The run's Task Instance — canonical bindings only (null for ad hoc). */
  taskInstanceId?: string | null;
  /** Deliberate "Run again as new comparison" source comparison id (spec §9). */
  repeatedFrom?: string | null;
  activeObservationIds?: string[];
  evidenceReceiptRevision?: number;
  policyPlaybook?: PolicyPlaybookAttachment | null;
}
export interface ComparisonRepositoryOptions {
  /** Injected clock for deterministic CAS-update tests. */
  now?: () => number;
}

export interface ComparisonRepository {
  /** Filters run over the complete result set BEFORE pagination (spec §11). */
  listComparisonResults(query: ComparisonListQuery): Promise<ComparisonResultIndex[]>;
  /** Index + exact source record; null when no index exists for the id. */
  getComparisonResult(id: string): Promise<ComparisonResultEnvelope | null>;
  /** Create the summary-only index for a source run (comparisonId == runId).
   *  Collision with an existing index aborts before any write. */
  createComparisonEnvelope(
    record: RunRecordV2,
    taskBinding: ComparisonTaskBinding,
    options?: CreateComparisonEnvelopeOptions,
  ): Promise<ComparisonResultIndex>;
  /** Atomic binding CAS update (spec §7.3): stale revisions abort. */
  bindComparisonToTask(
    comparisonId: string,
    taskBinding: ComparisonTaskBinding,
    taskInstanceId: string | null,
    expectedRevision: number,
  ): Promise<ComparisonResultIndex>;
  /** Atomic lineage CAS update (spec §9): stale revisions abort. */
  recordComparisonLineage(
    comparisonId: string,
    lineage: ComparisonLineage,
    expectedRevision: number,
  ): Promise<ComparisonResultIndex>;
  /** Idempotently refresh derived summary fields from the source run. Returns
   *  null when the run or its index is missing (nothing to rebuild). */
  rebuildComparisonIndex(runId: string): Promise<ComparisonResultIndex | null>;
  subscribe(listener: () => void): () => void;
}

// --- shared helpers (in-memory parity reuses these exactly) ------------------

/** Run a {ok, errors} validator and throw the first error as a StorageError
 *  validation, mirroring the Task Set repository idiom. */
export function assertValidComparison<T>(
  result: ComparisonValidationResult<T>,
  fallback: string,
): T {
  if (!result.ok) {
    const first = result.errors[0];
    throw new StorageError("validation", first ? first.message : fallback);
  }
  return result.value;
}

/**
 * Build the summary-only index from a validated source record. The index
 * copies identity and lifecycle fields only — never candidate outputs or
 * judge rationale.
 */
export function buildComparisonIndex(
  record: RunRecordV2,
  taskBinding: ComparisonTaskBinding,
  options: CreateComparisonEnvelopeOptions,
): ComparisonResultIndex {
  return {
    id: record.id,
    runId: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    mode: record.mode,
    title: record.task.title,
    taskBinding,
    taskInstanceId: options.taskInstanceId ?? null,
    activeObservationIds: options.activeObservationIds ?? [],
    evidenceReceiptRevision: options.evidenceReceiptRevision ?? 0,
    lineage: { repeatedFrom: options.repeatedFrom ?? null },
    policyPlaybook: options.policyPlaybook ?? null,
    revision: 0,
  };
}

function derivedFromIndex(index: ComparisonResultIndex): ComparisonDerivedSummary {
  return {
    status: index.status,
    mode: index.mode,
    title: index.title,
    updatedAt: index.updatedAt,
  };
}

function derivedFromRecord(record: RunRecordV2): ComparisonDerivedSummary {
  return {
    status: record.status,
    mode: record.mode,
    title: record.task.title,
    updatedAt: record.updatedAt,
  };
}

/**
 * Drift between the stored index and its source record. `updatedAt` is an
 * index-mutation timestamp (binding/lineage updates bump it) and therefore
 * does not trigger drift — the lifecycle-derived summary fields do.
 */
export function comparisonIndexDrifted(index: ComparisonResultIndex, record: RunRecordV2): boolean {
  return (
    index.status !== record.status ||
    index.mode !== record.mode ||
    index.title !== record.task.title
  );
}

export function comparisonMismatchWarning(
  index: ComparisonResultIndex,
  record: RunRecordV2,
): ComparisonSourceMismatch | null {
  if (!comparisonIndexDrifted(index, record)) return null;
  return {
    kind: "source_index_revision_mismatch",
    repair: "rebuildComparisonIndex",
    message: `Comparison index for run ${index.id} is stale relative to its source record; rebuild the index to repair.`,
    index: derivedFromIndex(index),
    source: derivedFromRecord(record),
  };
}

// --- Dexie implementation ----------------------------------------------------

export function createComparisonRepository(
  db: RSembleEvaluationDB,
  runRepository: RunRepository,
  options: ComparisonRepositoryOptions = {},
): ComparisonRepository {
  const listeners = new Set<() => void>();
  const now = options.now ?? (() => Date.now());

  function notify() {
    for (const l of listeners) {
      try {
        l();
      } catch {
        // listener errors must not break the repository
      }
    }
  }

  async function listComparisonResults(
    query: ComparisonListQuery,
  ): Promise<ComparisonResultIndex[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const text = query.text?.trim().toLowerCase();

    let modelRunIds: Set<string> | null = null;
    if (query.modelKey) {
      // Join over the source run summaries (unpaginated) so the model filter
      // covers the complete result set exactly like every other filter.
      const matches = await runRepository.list({
        modelKey: query.modelKey,
        limit: Number.MAX_SAFE_INTEGER,
      });
      modelRunIds = new Set(matches.map((s) => s.id));
    }

    try {
      const filtered: ComparisonResultIndex[] = [];
      let skipped = 0;
      await db.comparisonResults
        .orderBy("createdAt")
        .reverse()
        .each((row) => {
          // Corrupt rows are skipped, mirroring RunRepository.list.
          if (!isComparisonResultIndex(row)) return;
          if (text && !row.title.toLowerCase().includes(text)) return;
          if (query.status && row.status !== query.status) return;
          if (query.mode && row.mode !== query.mode) return;
          if (query.bindingKind && row.taskBinding.kind !== query.bindingKind) return;
          if (
            query.taskId &&
            (row.taskBinding.kind !== "canonical" || row.taskBinding.taskId !== query.taskId)
          )
            return;
          if (modelRunIds && !modelRunIds.has(row.id)) return;
          if (query.createdFrom !== undefined && row.createdAt < query.createdFrom) return;
          if (query.createdTo !== undefined && row.createdAt > query.createdTo) return;
          // Filters run over the complete set BEFORE pagination (spec §11).
          if (skipped < offset) {
            skipped++;
            return;
          }
          if (filtered.length >= limit) return;
          filtered.push(row);
        });
      return filtered;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getComparisonResult(id: string): Promise<ComparisonResultEnvelope | null> {
    try {
      const row = await db.comparisonResults.get(id);
      if (!row) return null;
      const index = assertValidComparison(
        validateComparisonResultIndex(row),
        "Stored comparison index is invalid",
      );
      const record = await runRepository.get(id);
      if (!record) {
        return {
          index,
          record: null,
          warning: {
            kind: "missing_source_record",
            message: `Source run ${id} is missing; the index cannot be verified against it.`,
          },
        };
      }
      return { index, record, warning: comparisonMismatchWarning(index, record) };
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createComparisonEnvelope(
    record: RunRecordV2,
    taskBinding: ComparisonTaskBinding,
    createOptions: CreateComparisonEnvelopeOptions = {},
  ): Promise<ComparisonResultIndex> {
    if (!isRunRecordV2(record)) throw new StorageError("validation", "Invalid run record");
    const binding = assertValidComparison(
      validateComparisonTaskBinding(taskBinding),
      "Invalid task binding",
    );
    const index = assertValidComparison(
      validateComparisonResultIndex(buildComparisonIndex(record, binding, createOptions)),
      "Invalid comparison index",
    );
    db.assertWritable();
    try {
      await db.transaction("rw", db.comparisonResults, async () => {
        const existing = await db.comparisonResults.get(index.id);
        if (existing) {
          throw new StorageError("conflict", `Comparison result ${index.id} already indexed`);
        }
        await db.comparisonResults.put(index);
      });
      notify();
      return index;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function bindComparisonToTask(
    comparisonId: string,
    taskBinding: ComparisonTaskBinding,
    taskInstanceId: string | null,
    expectedRevision: number,
  ): Promise<ComparisonResultIndex> {
    const binding = assertValidComparison(
      validateComparisonTaskBinding(taskBinding),
      "Invalid task binding",
    );
    db.assertWritable();
    try {
      const updated = await db.transaction("rw", db.comparisonResults, async () => {
        const existing = await db.comparisonResults.get(comparisonId);
        if (!existing) {
          throw new StorageError("conflict", `Comparison result ${comparisonId} not found`);
        }
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const next: ComparisonResultIndex = {
          ...existing,
          taskBinding: binding,
          taskInstanceId,
          updatedAt: now(),
          revision: expectedRevision + 1,
        };
        const checked = assertValidComparison(
          validateComparisonResultIndex(next),
          "Invalid comparison index",
        );
        await db.comparisonResults.put(checked);
        return checked;
      });
      notify();
      return updated;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function recordComparisonLineage(
    comparisonId: string,
    lineage: ComparisonLineage,
    expectedRevision: number,
  ): Promise<ComparisonResultIndex> {
    const checkedLineage = assertValidComparison(
      validateComparisonLineage(lineage),
      "Invalid comparison lineage",
    );
    db.assertWritable();
    try {
      const updated = await db.transaction("rw", db.comparisonResults, async () => {
        const existing = await db.comparisonResults.get(comparisonId);
        if (!existing) {
          throw new StorageError("conflict", `Comparison result ${comparisonId} not found`);
        }
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const next: ComparisonResultIndex = {
          ...existing,
          lineage: checkedLineage,
          updatedAt: now(),
          revision: expectedRevision + 1,
        };
        const checked = assertValidComparison(
          validateComparisonResultIndex(next),
          "Invalid comparison index",
        );
        await db.comparisonResults.put(checked);
        return checked;
      });
      notify();
      return updated;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function rebuildComparisonIndex(runId: string): Promise<ComparisonResultIndex | null> {
    db.assertWritable();
    try {
      const record = await runRepository.get(runId);
      if (!record) return null; // nothing to index
      const existing = await db.comparisonResults.get(runId);
      if (!existing) return null; // nothing to rebuild
      const index = assertValidComparison(
        validateComparisonResultIndex(existing),
        "Stored comparison index is invalid",
      );
      if (!comparisonIndexDrifted(index, record)) return index; // idempotent no-op
      const next: ComparisonResultIndex = {
        ...index,
        status: record.status,
        mode: record.mode,
        title: record.task.title,
        updatedAt: record.updatedAt,
        revision: index.revision + 1,
      };
      await db.transaction("rw", db.comparisonResults, async () => {
        const current = await db.comparisonResults.get(runId);
        if (!current || current.revision !== index.revision) {
          throw new StorageError(
            "conflict",
            `Comparison index ${runId} changed concurrently; rebuild aborted`,
          );
        }
        await db.comparisonResults.put(next);
      });
      notify();
      return next;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    listComparisonResults,
    getComparisonResult,
    createComparisonEnvelope,
    bindComparisonToTask,
    recordComparisonLineage,
    rebuildComparisonIndex,
    subscribe,
  };
}
