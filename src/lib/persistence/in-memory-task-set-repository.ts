// =============================================================================
// RSemble AI — In-memory Task Set repository (parity)
//
// Child 03 (Task Sets and Context-Owned Evaluation Results) Milestone A —
// Task 3.
//
// In-memory TaskSetRepository with identical validation and conflict semantics
// to the Dexie implementation in `./task-set-repository.ts`. Used by unit tests
// and non-persisted orchestration. No Dexie, no I/O. Inputs and outputs are
// cloned so callers cannot mutate stored state by reference.
// =============================================================================

import { StorageError } from "./database";
import {
  materializeWorkloadManifest,
  type MaterializeWorkloadOptions,
  type MaterializedWorkloadSnapshot,
  type WorkloadCatalogResolvers,
} from "../evaluations/workload-manifest";
import {
  validateTaskSetRecord,
  validateTaskSetVersion,
  type TaskSetRecord,
  type TaskSetVersion,
} from "../evaluations/task-set-types";
import { validateContiguousAppend } from "../tasks/task-versioning";
import type { TaskSetListQuery, TaskSetRepository } from "./task-set-repository";

/** Run a {valid, errors} validator and throw the first error as a StorageError
 *  validation. Mirrors the Dexie implementation so both report the same
 *  prohibited-key / field messages. */
function assertValid(
  result: { valid: boolean; errors: Array<{ field: string; message: string }> },
  fallback: string,
): void {
  if (!result.valid) {
    const first = result.errors[0];
    throw new StorageError("validation", first ? first.message : fallback);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryTaskSetRepository implements TaskSetRepository {
  private records = new Map<string, TaskSetRecord>();
  private versions = new Map<string, Map<number, TaskSetVersion>>();

  async createTaskSet(record: TaskSetRecord, version: TaskSetVersion): Promise<void> {
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
    if (this.records.has(record.id)) {
      throw new StorageError("conflict", `Task Set ${record.id} already exists`);
    }
    this.records.set(record.id, clone(record));
    const versionMap = new Map<number, TaskSetVersion>();
    versionMap.set(version.version, clone(version));
    this.versions.set(record.id, versionMap);
  }

  async appendTaskSetVersion(
    record: TaskSetRecord,
    version: TaskSetVersion,
    expectedRevision: number,
  ): Promise<number> {
    assertValid(validateTaskSetRecord(record), "Invalid task set record");
    assertValid(validateTaskSetVersion(version), "Invalid task set version");
    if (record.id !== version.taskSetId) {
      throw new StorageError("validation", "Task Set record/version ID mismatch");
    }
    const existing = this.records.get(record.id);
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
    const versionMap = this.versions.get(record.id);
    if (versionMap?.has(version.version)) {
      throw new StorageError(
        "conflict",
        `Task Set version ${version.taskSetId}@${version.version} already exists — versions are immutable.`,
      );
    }
    const newRevision = expectedRevision + 1;
    const newLatest = version.version;
    const updated: TaskSetRecord = {
      ...clone(record),
      revision: newRevision,
      latestVersion: newLatest,
      updatedAt: Date.now(),
    };
    this.records.set(record.id, updated);
    if (versionMap) {
      versionMap.set(version.version, clone(version));
    } else {
      const created = new Map<number, TaskSetVersion>();
      created.set(version.version, clone(version));
      this.versions.set(record.id, created);
    }
    return newRevision;
  }

  async archiveTaskSet(id: string, expectedRevision: number): Promise<number> {
    const existing = this.records.get(id);
    if (!existing) throw new StorageError("conflict", `Task Set ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.records.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: now,
      updatedAt: now,
    });
    return newRevision;
  }

  async restoreTaskSet(id: string, expectedRevision: number): Promise<number> {
    const existing = this.records.get(id);
    if (!existing) throw new StorageError("conflict", `Task Set ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.records.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: null,
      updatedAt: now,
    });
    return newRevision;
  }

  async getTaskSetRecord(id: string): Promise<TaskSetRecord | null> {
    const record = this.records.get(id);
    return record ? clone(record) : null;
  }

  async getTaskSetVersion(taskSetId: string, version: number): Promise<TaskSetVersion | null> {
    const stored = this.versions.get(taskSetId)?.get(version);
    return stored ? clone(stored) : null;
  }

  async listTaskSetVersions(taskSetId: string): Promise<TaskSetVersion[]> {
    const versions = this.versions.get(taskSetId);
    if (!versions) return [];
    return [...versions.values()]
      .sort((a, b) => a.version - b.version)
      .map((version) => clone(version));
  }

  async listTaskSets(query: TaskSetListQuery): Promise<TaskSetRecord[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const needle = query.search?.trim().toLowerCase() ?? "";
    const archiveState: "active" | "archived" | "all" =
      query.archiveState ?? (query.includeArchived ? "all" : "active");
    return [...this.records.values()]
      .filter((t) => query.origin === undefined || t.origin === query.origin)
      .filter(
        (t) =>
          archiveState === "all" ||
          (archiveState === "active" ? t.archivedAt === null : t.archivedAt !== null),
      )
      .filter((t) => {
        if (needle === "") return true;
        return (
          t.name.toLowerCase().includes(needle) || t.description.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
      .map((record) => clone(record));
  }

  async materializeTaskSetVersion(
    taskSetId: string,
    version: number,
    resolvers: WorkloadCatalogResolvers,
    options?: MaterializeWorkloadOptions,
  ): Promise<MaterializedWorkloadSnapshot> {
    const stored = await this.getTaskSetVersion(taskSetId, version);
    if (!stored) {
      throw new StorageError("conflict", `Task Set version ${taskSetId}@${version} not found`);
    }
    return materializeWorkloadManifest(stored, resolvers, options);
  }
}
