// =============================================================================
// RSemble AI — Task Set repository (Dexie-backed)
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 3.
//
// Implements TaskSetRepository over RSembleEvaluationDB schema v5. Reuses the
// confirmed repository idioms (probe-P1): db.assertWritable() before every
// mutation, db.transaction('rw', ...) for atomic multi-table writes, revision
// CAS with StorageError('conflict') on stale/missing, rethrow StorageError
// as-is else classifyStorageError. Every persistence input is runtime-validated
// (probe-P2); credentials/auth material are rejected without echoing the
// value. Versions are immutable and append-only. No delete API is exposed.
// Materialization is a read-time resolve of a frozen TaskSetVersion through
// the landed Task 2 helper — it never writes suites/experiments/tasks.
// =============================================================================

import {
  type RSembleEvaluationDB,
  StorageError,
  classifyStorageError,
} from "./database";
import {
  ArchivedTaskExecutionError,
  DirtyDraftExecutionError,
  UnresolvedWorkloadRefError,
  materializeWorkloadManifest,
  type MaterializeWorkloadOptions,
  type MaterializedWorkloadSnapshot,
  type WorkloadCatalogResolvers,
} from "../evaluations/workload-manifest";
import {
  isTaskSetRecord,
  isTaskSetVersion,
  validateTaskSetRecord,
  validateTaskSetVersion,
  type TaskSetOrigin,
  type TaskSetRecord,
  type TaskSetVersion,
} from "../evaluations/task-set-types";
import { validateContiguousAppend } from "../tasks/task-versioning";

// --- query types -------------------------------------------------------------

export interface TaskSetListQuery {
  /** Case-insensitive substring match over the Task Set name or description.
   *  Empty/whitespace means no filter. */
  search?: string;
  /** Filter by origin. */
  origin?: TaskSetOrigin;
  /** Include archived Task Sets (default: false). `archiveState` takes
   *  precedence when both are supplied. */
  includeArchived?: boolean;
  /** Archive-state filter: "active" (default), "archived" only, or "all".
   *  Overrides `includeArchived` when set. */
  archiveState?: "active" | "archived" | "all";
  /** Page size (default 50). */
  limit?: number;
  /** Page offset (default 0). */
  offset?: number;
}

// --- repository interface ----------------------------------------------------

export interface TaskSetRepository {
  createTaskSet(record: TaskSetRecord, version: TaskSetVersion): Promise<void>;
  appendTaskSetVersion(
    record: TaskSetRecord,
    version: TaskSetVersion,
    expectedRevision: number,
  ): Promise<number>;
  archiveTaskSet(id: string, expectedRevision: number): Promise<number>;
  restoreTaskSet(id: string, expectedRevision: number): Promise<number>;
  getTaskSetRecord(id: string): Promise<TaskSetRecord | null>;
  getTaskSetVersion(taskSetId: string, version: number): Promise<TaskSetVersion | null>;
  listTaskSets(query: TaskSetListQuery): Promise<TaskSetRecord[]>;
  listTaskSetVersions(taskSetId: string): Promise<TaskSetVersion[]>;
  materializeTaskSetVersion(
    taskSetId: string,
    version: number,
    resolvers: WorkloadCatalogResolvers,
    options?: MaterializeWorkloadOptions,
  ): Promise<MaterializedWorkloadSnapshot>;
}

/** Run a {valid, errors} validator and throw the first error as a StorageError
 *  validation. Validator messages name the failing field and the prohibited-
 *  key violation, so callers see "prohibited credential/transport keys" rather
 *  than a generic "invalid" message. */
function assertValid(
  result: { valid: boolean; errors: Array<{ field: string; message: string }> },
  fallback: string,
): void {
  if (!result.valid) {
    const first = result.errors[0];
    throw new StorageError("validation", first ? first.message : fallback);
  }
}

function rethrowMaterialize(err: unknown): never {
  if (err instanceof StorageError) throw err;
  if (err instanceof UnresolvedWorkloadRefError) throw err;
  if (err instanceof DirtyDraftExecutionError) throw err;
  if (err instanceof ArchivedTaskExecutionError) throw err;
  throw classifyStorageError(err);
}

// --- Dexie implementation ----------------------------------------------------

export function createTaskSetRepository(db: RSembleEvaluationDB): TaskSetRepository {
  async function createTaskSet(record: TaskSetRecord, version: TaskSetVersion): Promise<void> {
    assertValid(validateTaskSetRecord(record), "Invalid task set record");
    assertValid(validateTaskSetVersion(version), "Invalid task set version");
    if (record.id !== version.taskSetId) {
      throw new StorageError("validation", "Task Set record/version ID mismatch");
    }
    if (version.version !== 1) {
      throw new StorageError("validation", "First version must be 1");
    }
    if (record.latestVersion !== 1) {
      throw new StorageError("validation", "Initial task set latestVersion must be 1");
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.taskSets, db.taskSetVersions, async () => {
        const existing = await db.taskSets.get(record.id);
        if (existing) {
          throw new StorageError("conflict", `Task Set ${record.id} already exists`);
        }
        await db.taskSets.put({
          id: record.id,
          record,
          latestVersion: record.latestVersion,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          archivedAt: record.archivedAt,
          origin: record.origin,
          revision: record.revision,
        });
        await db.taskSetVersions.put({
          taskSetId: version.taskSetId,
          version: version.version,
          version_: version,
          createdAt: version.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function appendTaskSetVersion(
    record: TaskSetRecord,
    version: TaskSetVersion,
    expectedRevision: number,
  ): Promise<number> {
    assertValid(validateTaskSetRecord(record), "Invalid task set record");
    assertValid(validateTaskSetVersion(version), "Invalid task set version");
    if (record.id !== version.taskSetId) {
      throw new StorageError("validation", "Task Set record/version ID mismatch");
    }
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskSets, db.taskSetVersions, async () => {
        const existing = await db.taskSets.get(record.id);
        if (!existing) throw new StorageError("conflict", `Task Set ${record.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const appendCheck = validateContiguousAppend(
          { latestVersion: existing.latestVersion },
          { version: version.version },
        );
        if (!appendCheck.ok) {
          throw new StorageError("conflict", appendCheck.reason ?? "Non-contiguous version");
        }
        const existingVersion = await db.taskSetVersions.get([version.taskSetId, version.version]);
        if (existingVersion) {
          throw new StorageError(
            "conflict",
            `Task Set version ${version.taskSetId}@${version.version} already exists — versions are immutable.`,
          );
        }
        const newLatest = version.version;
        const updatedRecord: TaskSetRecord = {
          ...record,
          revision: newRevision,
          latestVersion: newLatest,
          updatedAt: Date.now(),
        };
        await db.taskSets.put({
          id: record.id,
          record: updatedRecord,
          latestVersion: newLatest,
          createdAt: existing.createdAt,
          updatedAt: updatedRecord.updatedAt,
          archivedAt: existing.archivedAt,
          origin: existing.origin,
          revision: newRevision,
        });
        await db.taskSetVersions.put({
          taskSetId: version.taskSetId,
          version: version.version,
          version_: version,
          createdAt: version.createdAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function archiveTaskSet(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskSets, async () => {
        const existing = await db.taskSets.get(id);
        if (!existing) throw new StorageError("conflict", `Task Set ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const record = isTaskSetRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid task set record");
        const now = Date.now();
        const updated: TaskSetRecord = {
          ...record,
          revision: newRevision,
          archivedAt: now,
          updatedAt: now,
        };
        await db.taskSets.put({
          ...existing,
          record: updated,
          revision: newRevision,
          archivedAt: now,
          updatedAt: now,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function restoreTaskSet(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskSets, async () => {
        const existing = await db.taskSets.get(id);
        if (!existing) throw new StorageError("conflict", `Task Set ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const record = isTaskSetRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid task set record");
        const now = Date.now();
        const updated: TaskSetRecord = {
          ...record,
          revision: newRevision,
          archivedAt: null,
          updatedAt: now,
        };
        await db.taskSets.put({
          ...existing,
          record: updated,
          revision: newRevision,
          archivedAt: null,
          updatedAt: now,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getTaskSetRecord(id: string): Promise<TaskSetRecord | null> {
    try {
      const row = await db.taskSets.get(id);
      if (!row) return null;
      return isTaskSetRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getTaskSetVersion(
    taskSetId: string,
    version: number,
  ): Promise<TaskSetVersion | null> {
    try {
      const row = await db.taskSetVersions.get([taskSetId, version]);
      if (!row) return null;
      return isTaskSetVersion(row.version_) ? row.version_ : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTaskSetVersions(taskSetId: string): Promise<TaskSetVersion[]> {
    try {
      const rows = await db.taskSetVersions.where("taskSetId").equals(taskSetId).sortBy("version");
      return rows
        .map((row) => row.version_)
        .filter((version): version is TaskSetVersion => isTaskSetVersion(version));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTaskSets(query: TaskSetListQuery): Promise<TaskSetRecord[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const needle = query.search?.trim().toLowerCase() ?? "";
    try {
      const archiveState: "active" | "archived" | "all" =
        query.archiveState ?? (query.includeArchived ? "all" : "active");
      const rows = await db.taskSets.toArray();
      const records: TaskSetRecord[] = [];
      for (const row of rows) {
        if (query.origin && row.origin !== query.origin) continue;
        if (archiveState === "active" && row.archivedAt !== null) continue;
        if (archiveState === "archived" && row.archivedAt === null) continue;
        if (!isTaskSetRecord(row.record)) continue;
        if (needle !== "") {
          const name = row.record.name.toLowerCase();
          const description = row.record.description.toLowerCase();
          if (!name.includes(needle) && !description.includes(needle)) continue;
        }
        records.push(row.record);
      }
      records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      return records.slice(offset, offset + limit);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function materializeTaskSetVersion(
    taskSetId: string,
    version: number,
    resolvers: WorkloadCatalogResolvers,
    options?: MaterializeWorkloadOptions,
  ): Promise<MaterializedWorkloadSnapshot> {
    try {
      const stored = await getTaskSetVersion(taskSetId, version);
      if (!stored) {
        throw new StorageError("conflict", `Task Set version ${taskSetId}@${version} not found`);
      }
      return materializeWorkloadManifest(stored, resolvers, options);
    } catch (err) {
      rethrowMaterialize(err);
    }
  }

  return {
    createTaskSet,
    appendTaskSetVersion,
    archiveTaskSet,
    restoreTaskSet,
    getTaskSetRecord,
    getTaskSetVersion,
    listTaskSets,
    listTaskSetVersions,
    materializeTaskSetVersion,
  };
}
