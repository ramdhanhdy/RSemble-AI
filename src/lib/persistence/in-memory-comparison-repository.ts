// =============================================================================
// RSemble AI — In-memory Comparison Result repository (parity)
//
// Child 05 (Contextual Compare Results) Milestone A — Task 2.
//
// In-memory ComparisonRepository with identical validation, CAS, and
// conflict semantics to the Dexie implementation in
// `./comparison-repository.ts`. Used by unit tests and non-persisted
// orchestration. No Dexie, no I/O.
//
// Parity notes:
//  - identical drift/mismatch semantics via the shared helpers
//    (`comparisonIndexDrifted`, `comparisonMismatchWarning`,
//    `assertValidComparison`, `buildComparisonIndex`);
//  - identical CAS: stale revisions and missing rows abort with
//    StorageError('conflict'); duplicate creates abort before any write;
//  - the model join reads the injected InMemoryRunRepository (unpaginated);
//  - inputs and outputs are deep-cloned so callers cannot mutate stored
//    state by reference (mirrors the InMemoryRunRepository discipline);
//  - storage failures do not exist in memory — tests skip those cases.
// =============================================================================

import { StorageError } from "./database";
import type { InMemoryRunRepository } from "./run-repository";
import { isRunRecordV2, type RunRecordV2 } from "./run-types";
import {
  validateComparisonLineage,
  validateComparisonResultIndex,
  validateComparisonTaskBinding,
} from "../compare/comparison-result-validation";
import type {
  ComparisonLineage,
  ComparisonResultIndex,
  ComparisonTaskBinding,
} from "../compare/comparison-result-types";
import {
  assertValidComparison,
  buildComparisonIndex,
  comparisonIndexDrifted,
  comparisonMismatchWarning,
  type ComparisonListQuery,
  type ComparisonRepository,
  type ComparisonRepositoryOptions,
  type ComparisonResultEnvelope,
  type CreateComparisonEnvelopeOptions,
} from "./comparison-repository";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryComparisonRepository implements ComparisonRepository {
  private indexes = new Map<string, ComparisonResultIndex>();
  private listeners = new Set<() => void>();
  private readonly runRepository: InMemoryRunRepository;
  private readonly now: () => number;

  constructor(runRepository: InMemoryRunRepository, options: ComparisonRepositoryOptions = {}) {
    this.runRepository = runRepository;
    this.now = options.now ?? (() => Date.now());
  }

  private notify() {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* listener errors must not break the repository */
      }
    }
  }

  async listComparisonResults(query: ComparisonListQuery): Promise<ComparisonResultIndex[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const text = query.text?.trim().toLowerCase();

    let modelRunIds: Set<string> | null = null;
    if (query.modelKey) {
      const matches = await this.runRepository.list({
        modelKey: query.modelKey,
        limit: Number.MAX_SAFE_INTEGER,
      });
      modelRunIds = new Set(matches.map((s) => s.id));
    }

    const filtered = [...this.indexes.values()]
      .filter((row) => {
        if (text && !row.title.toLowerCase().includes(text)) return false;
        if (query.status && row.status !== query.status) return false;
        if (query.mode && row.mode !== query.mode) return false;
        if (query.bindingKind && row.taskBinding.kind !== query.bindingKind) return false;
        if (
          query.taskId &&
          (row.taskBinding.kind !== "canonical" || row.taskBinding.taskId !== query.taskId)
        )
          return false;
        if (modelRunIds && !modelRunIds.has(row.id)) return false;
        if (query.createdFrom !== undefined && row.createdAt < query.createdFrom) return false;
        if (query.createdTo !== undefined && row.createdAt > query.createdTo) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return filtered.slice(offset, offset + limit).map(clone);
  }

  async getComparisonResult(id: string): Promise<ComparisonResultEnvelope | null> {
    const stored = this.indexes.get(id);
    if (!stored) return null;
    const index = clone(stored);
    const record = await this.runRepository.get(id);
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
  }

  async createComparisonEnvelope(
    record: RunRecordV2,
    taskBinding: ComparisonTaskBinding,
    options: CreateComparisonEnvelopeOptions = {},
  ): Promise<ComparisonResultIndex> {
    if (!isRunRecordV2(record)) throw new StorageError("validation", "Invalid run record");
    const binding = assertValidComparison(
      validateComparisonTaskBinding(taskBinding),
      "Invalid task binding",
    );
    const index = assertValidComparison(
      validateComparisonResultIndex(buildComparisonIndex(record, binding, options)),
      "Invalid comparison index",
    );
    if (this.indexes.has(index.id)) {
      throw new StorageError("conflict", `Comparison result ${index.id} already indexed`);
    }
    // Deep-clone on write: Dexie structured-clones at the storage boundary and
    // this test double must mirror that isolation (see InMemoryRunRepository).
    this.indexes.set(index.id, clone(index));
    this.notify();
    return clone(index);
  }

  async bindComparisonToTask(
    comparisonId: string,
    taskBinding: ComparisonTaskBinding,
    taskInstanceId: string | null,
    expectedRevision: number,
  ): Promise<ComparisonResultIndex> {
    const binding = assertValidComparison(
      validateComparisonTaskBinding(taskBinding),
      "Invalid task binding",
    );
    const existing = this.indexes.get(comparisonId);
    if (!existing) {
      throw new StorageError("conflict", `Comparison result ${comparisonId} not found`);
    }
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const next = assertValidComparison(
      validateComparisonResultIndex({
        ...clone(existing),
        taskBinding: binding,
        taskInstanceId,
        updatedAt: this.now(),
        revision: expectedRevision + 1,
      }),
      "Invalid comparison index",
    );
    this.indexes.set(comparisonId, clone(next));
    this.notify();
    return clone(next);
  }

  async recordComparisonLineage(
    comparisonId: string,
    lineage: ComparisonLineage,
    expectedRevision: number,
  ): Promise<ComparisonResultIndex> {
    const checkedLineage = assertValidComparison(
      validateComparisonLineage(lineage),
      "Invalid comparison lineage",
    );
    const existing = this.indexes.get(comparisonId);
    if (!existing) {
      throw new StorageError("conflict", `Comparison result ${comparisonId} not found`);
    }
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const next = assertValidComparison(
      validateComparisonResultIndex({
        ...clone(existing),
        lineage: checkedLineage,
        updatedAt: this.now(),
        revision: expectedRevision + 1,
      }),
      "Invalid comparison index",
    );
    this.indexes.set(comparisonId, clone(next));
    this.notify();
    return clone(next);
  }

  async rebuildComparisonIndex(runId: string): Promise<ComparisonResultIndex | null> {
    const record = await this.runRepository.get(runId);
    if (!record) return null; // nothing to index
    const existing = this.indexes.get(runId);
    if (!existing) return null; // nothing to rebuild
    const index = clone(existing);
    if (!comparisonIndexDrifted(index, record)) return index; // idempotent no-op
    const next: ComparisonResultIndex = {
      ...index,
      status: record.status,
      mode: record.mode,
      title: record.task.title,
      updatedAt: record.updatedAt,
      revision: index.revision + 1,
    };
    this.indexes.set(runId, clone(next));
    this.notify();
    return clone(next);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
