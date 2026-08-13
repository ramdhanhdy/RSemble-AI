// =============================================================================
// RSemble AI — Canonical Task repository (Dexie-backed)
//
// Child 02 (Canonical Tasks) Milestone B — Task 3.
//
// Implements the TaskRepository interface over RSembleEvaluationDB schema v3.
// Reuses the confirmed repository idioms (probe-P1): db.assertWritable() before
// every mutation, db.transaction('rw', ...) for atomic multi-table writes,
// revision CAS with StorageError('conflict') on stale/missing, rethrow
// StorageError as-is else classifyStorageError. Artifact bytes live outside
// indexed summary rows (spec §3.3, §8). Every persistence input is runtime-
// validated (probe-P2); credentials/auth material are rejected without echoing
// the value. Instance reuse verifies byte equality before deduplication
// (spec §3.4). No delete API is exposed for referenced versions (spec §4.4).
// =============================================================================

import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";
import {
  artifactsByteEqual,
  computeInstanceInputDigest,
  isArtifactDigestMatch,
  instancesReuseEqual,
  resolveInstanceCompleteness,
} from "../tasks/task-instance";
import { validateContiguousAppend } from "../tasks/task-versioning";
import {
  isTaskArtifact,
  isTaskFacetAnnotation,
  isTaskFamily,
  isTaskFamilyAssignment,
  isTaskInstance,
  isTaskRecord,
  isTaskVersion,
  validateTaskArtifact,
  validateTaskFacetAnnotation,
  validateTaskFamily,
  validateTaskFamilyAssignment,
  validateTaskInstance,
  validateTaskRecord,
  validateTaskVersion,
} from "../tasks/task-validation";
import type {
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskInstance,
  TaskOrigin,
  TaskRecord,
  TaskVersion,
} from "../tasks/task-types";

// --- query types -------------------------------------------------------------

export interface TaskListQuery {
  /** Case-insensitive substring match over the Task's latest-version title or
   *  objective (canonical-tasks spec §7.1). Empty/whitespace means no filter. */
  search?: string;
  /** Filter to Tasks whose *current* primary family assignment names this
   *  family (spec §7.1). */
  familyId?: string;
  /** Filter by origin. */
  origin?: TaskOrigin;
  /** Include archived Tasks (default: false). */
  includeArchived?: boolean;
  /** Page size (default 50). */
  limit?: number;
  /** Page offset (default 0). */
  offset?: number;
}

export interface GetOrCreateInstanceResult {
  instance: TaskInstance;
  /** True when an existing reusable instance was found. */
  reused: boolean;
}

// --- repository interface ----------------------------------------------------

export interface TaskRepository {
  // --- Task + version lifecycle --------------------------------------------
  createTask(record: TaskRecord, version: TaskVersion): Promise<void>;
  appendTaskVersion(
    record: TaskRecord,
    version: TaskVersion,
    expectedRevision: number,
  ): Promise<number>;
  archiveTask(id: string, expectedRevision: number): Promise<number>;
  restoreTask(id: string, expectedRevision: number): Promise<number>;
  getTaskRecord(id: string): Promise<TaskRecord | null>;
  getTaskVersion(taskId: string, version: number): Promise<TaskVersion | null>;
  listTasks(query: TaskListQuery): Promise<TaskRecord[]>;

  // --- immutable artifacts (bytes outside rows) ----------------------------
  putTaskArtifact(artifact: TaskArtifact, bytes: Uint8Array): Promise<void>;
  getTaskArtifact(id: string): Promise<TaskArtifact | null>;
  getTaskArtifactBytes(id: string): Promise<Uint8Array | null>;

  // --- instances (get-or-create with byte equality) ------------------------
  getOrCreateTaskInstance(
    candidate: TaskInstance,
    availableArtifactBytes: Map<string, Uint8Array>,
  ): Promise<GetOrCreateInstanceResult>;
  getTaskInstance(id: string): Promise<TaskInstance | null>;
  listTaskInstances(taskId: string, taskVersion?: number): Promise<TaskInstance[]>;

  // --- families -------------------------------------------------------------
  createTaskFamily(family: TaskFamily): Promise<void>;
  updateTaskFamily(family: TaskFamily, expectedRevision: number): Promise<number>;
  archiveTaskFamily(id: string, expectedRevision: number): Promise<number>;
  restoreTaskFamily(id: string, expectedRevision: number): Promise<number>;
  getTaskFamily(id: string): Promise<TaskFamily | null>;
  listTaskFamilies(includeArchived?: boolean): Promise<TaskFamily[]>;

  // --- family assignments (at most one primary per Task) -------------------
  assignTaskFamily(assignment: TaskFamilyAssignment): Promise<void>;
  archiveTaskFamilyAssignment(id: string, expectedRevision: number): Promise<number>;
  listTaskFamilyAssignments(taskId: string): Promise<TaskFamilyAssignment[]>;

  // --- facet annotations ---------------------------------------------------
  annotateTaskFacet(annotation: TaskFacetAnnotation): Promise<void>;
  listTaskFacetAnnotations(taskId: string): Promise<TaskFacetAnnotation[]>;
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

// --- Dexie implementation ----------------------------------------------------

export function createTaskRepository(db: RSembleEvaluationDB): TaskRepository {
  // --- Task + version lifecycle ---------------------------------------------

  async function createTask(record: TaskRecord, version: TaskVersion): Promise<void> {
    assertValid(validateTaskRecord(record), "Invalid task record");
    assertValid(validateTaskVersion(version), "Invalid task version");
    if (record.id !== version.taskId) {
      throw new StorageError("validation", "Task record/version ID mismatch");
    }
    if (version.version !== 1) {
      throw new StorageError("validation", "First version must be 1");
    }
    if (record.latestVersion !== 1) {
      throw new StorageError("validation", "Initial task latestVersion must be 1");
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.tasks, db.taskVersions, async () => {
        const existing = await db.tasks.get(record.id);
        if (existing) {
          throw new StorageError("conflict", `Task ${record.id} already exists`);
        }
        await db.tasks.put({
          id: record.id,
          record,
          latestVersion: record.latestVersion,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          archivedAt: record.archivedAt,
          origin: record.origin,
          revision: record.revision,
        });
        await db.taskVersions.put({
          taskId: version.taskId,
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

  async function appendTaskVersion(
    record: TaskRecord,
    version: TaskVersion,
    expectedRevision: number,
  ): Promise<number> {
    assertValid(validateTaskRecord(record), "Invalid task record");
    assertValid(validateTaskVersion(version), "Invalid task version");
    if (record.id !== version.taskId) {
      throw new StorageError("validation", "Task record/version ID mismatch");
    }
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.tasks, db.taskVersions, async () => {
        const existing = await db.tasks.get(record.id);
        if (!existing) throw new StorageError("conflict", `Task ${record.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        // Contiguous append: the new version must be latestVersion + 1.
        const appendCheck = validateContiguousAppend(
          { latestVersion: existing.latestVersion },
          { version: version.version },
        );
        if (!appendCheck.ok) {
          throw new StorageError("conflict", appendCheck.reason ?? "Non-contiguous version");
        }
        // The version row must not already exist (immutability).
        const existingVersion = await db.taskVersions.get([version.taskId, version.version]);
        if (existingVersion) {
          throw new StorageError(
            "conflict",
            `Task version ${version.taskId}@${version.version} already exists — versions are immutable.`,
          );
        }
        const newLatest = version.version;
        const updatedRecord: TaskRecord = {
          ...record,
          revision: newRevision,
          latestVersion: newLatest,
          updatedAt: Date.now(),
        };
        await db.tasks.put({
          id: record.id,
          record: updatedRecord,
          latestVersion: newLatest,
          createdAt: existing.createdAt,
          updatedAt: updatedRecord.updatedAt,
          archivedAt: existing.archivedAt,
          origin: existing.origin,
          revision: newRevision,
        });
        await db.taskVersions.put({
          taskId: version.taskId,
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

  async function archiveTask(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.tasks, async () => {
        const existing = await db.tasks.get(id);
        if (!existing) throw new StorageError("conflict", `Task ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const record = isTaskRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid task record");
        const now = Date.now();
        const updated: TaskRecord = {
          ...record,
          revision: newRevision,
          archivedAt: now,
          updatedAt: now,
        };
        await db.tasks.put({
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

  async function restoreTask(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.tasks, async () => {
        const existing = await db.tasks.get(id);
        if (!existing) throw new StorageError("conflict", `Task ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const record = isTaskRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid task record");
        const now = Date.now();
        const updated: TaskRecord = {
          ...record,
          revision: newRevision,
          archivedAt: null,
          updatedAt: now,
        };
        await db.tasks.put({
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

  async function getTaskRecord(id: string): Promise<TaskRecord | null> {
    try {
      const row = await db.tasks.get(id);
      if (!row) return null;
      return isTaskRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getTaskVersion(taskId: string, version: number): Promise<TaskVersion | null> {
    try {
      const row = await db.taskVersions.get([taskId, version]);
      if (!row) return null;
      return isTaskVersion(row.version_) ? row.version_ : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTasks(query: TaskListQuery): Promise<TaskRecord[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const needle = query.search?.trim().toLowerCase() ?? "";
    try {
      // Family filter: taskIds holding an active primary assignment to the
      // requested family. Resolved up front so the walk below stays a single
      // deterministic pass (spec §7.1).
      let familyFilter: Set<string> | null = null;
      if (query.familyId !== undefined) {
        familyFilter = new Set<string>();
        const assignments = await db.taskFamilyAssignments
          .where("familyId")
          .equals(query.familyId)
          .toArray();
        for (const row of assignments) {
          if (row.isPrimary === 1 && row.archivedAt === null) familyFilter.add(row.taskId);
        }
      }
      // Sort deterministically in memory: fresh `updatedAt` values move rows
      // between pages and the id tiebreak keeps equal timestamps stable —
      // deterministic pagination is a spec contract (§11 "Repository").
      const rows = await db.tasks.toArray();
      const records: TaskRecord[] = [];
      for (const row of rows) {
        if (query.origin && row.origin !== query.origin) continue;
        if (!query.includeArchived && row.archivedAt !== null) continue;
        if (familyFilter && !familyFilter.has(row.id)) continue;
        if (!isTaskRecord(row.record)) continue;
        if (needle !== "") {
          const latest = await db.taskVersions.get([row.id, row.latestVersion]);
          const version = latest && isTaskVersion(latest.version_) ? latest.version_ : null;
          const title = version?.title.toLowerCase() ?? "";
          const objective = version?.objective.toLowerCase() ?? "";
          if (!title.includes(needle) && !objective.includes(needle)) continue;
        }
        records.push(row.record);
      }
      records.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
      return records.slice(offset, offset + limit);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- immutable artifacts (bytes outside rows) -----------------------------

  async function putTaskArtifact(artifact: TaskArtifact, bytes: Uint8Array): Promise<void> {
    assertValid(validateTaskArtifact(artifact), "Invalid task artifact");
    if (bytes.byteLength === 0) {
      throw new StorageError("validation", "TaskArtifact requires non-empty bytes");
    }
    // Digest must match the bytes (spec §3.3).
    if (!isArtifactDigestMatch(artifact.contentDigest, bytes)) {
      throw new StorageError(
        "validation",
        "Artifact contentDigest does not match the supplied bytes",
      );
    }
    if (artifact.byteCount !== bytes.byteLength) {
      throw new StorageError("validation", "Artifact byteCount does not match the supplied bytes");
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.taskArtifacts, db.taskArtifactBytes, async () => {
        const existing = await db.taskArtifacts.get(artifact.id);
        if (existing) {
          // Idempotent re-put: same id, same digest, same bytes.
          if (existing.contentDigest === artifact.contentDigest) {
            const existingBytes = await db.taskArtifactBytes.get(artifact.id);
            if (existingBytes && artifactsByteEqual(existingBytes.bytes, bytes)) {
              return; // identical — no-op
            }
          }
          // Same id, different content — collision mismatch.
          throw new StorageError(
            "conflict",
            `Artifact ${artifact.id} already exists with different content (digest collision)`,
          );
        }
        // Digest collision across different ids: same digest, different bytes.
        const sameDigest = await db.taskArtifacts
          .where("contentDigest")
          .equals(artifact.contentDigest)
          .toArray();
        for (const row of sameDigest) {
          if (row.id === artifact.id) continue;
          const otherBytes = await db.taskArtifactBytes.get(row.id);
          if (otherBytes && !artifactsByteEqual(otherBytes.bytes, bytes)) {
            throw new StorageError(
              "conflict",
              `Digest collision: ${artifact.contentDigest} maps to different bytes (byte equality failed)`,
            );
          }
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
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getTaskArtifact(id: string): Promise<TaskArtifact | null> {
    try {
      const row = await db.taskArtifacts.get(id);
      if (!row) return null;
      const artifact: TaskArtifact = {
        id: row.id,
        contentDigest: row.contentDigest,
        mediaType: row.mediaType,
        byteCount: row.byteCount,
        storageRef: row.storageRef,
        createdAt: row.createdAt,
      };
      return isTaskArtifact(artifact) ? artifact : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getTaskArtifactBytes(id: string): Promise<Uint8Array | null> {
    try {
      const row = await db.taskArtifactBytes.get(id);
      return row ? row.bytes : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- instances (get-or-create with byte equality) -------------------------

  async function getOrCreateTaskInstance(
    candidate: TaskInstance,
    availableArtifactBytes: Map<string, Uint8Array>,
  ): Promise<GetOrCreateInstanceResult> {
    assertValid(validateTaskInstance(candidate), "Invalid task instance");
    db.assertWritable();
    try {
      const result = await db.transaction(
        "rw",
        db.tasks,
        db.taskVersions,
        db.taskArtifacts,
        db.taskArtifactBytes,
        db.taskInstances,
        async () => {
          // The Task and Version must exist.
          const taskRow = await db.tasks.get(candidate.taskId);
          if (!taskRow) throw new StorageError("conflict", `Task ${candidate.taskId} not found`);
          const versionRow = await db.taskVersions.get([candidate.taskId, candidate.taskVersion]);
          if (!versionRow) {
            throw new StorageError(
              "conflict",
              `Task version ${candidate.taskId}@${candidate.taskVersion} not found`,
            );
          }
          // Every referenced artifact must exist and have stored bytes
          // (referential integrity). When the caller supplies available
          // bytes for an artifact, they must be non-empty, byte-equal the
          // stored bytes, and digest-match the artifact row — this prevents
          // empty/wrong map bytes from fabricating a "complete" instance
          // (spec §3.4, §8). Absent available bytes are allowed; completeness
          // resolves to incomplete/metadata_only via resolveInstanceCompleteness.
          for (const artId of candidate.normalizedInput.artifactIds) {
            const artRow = await db.taskArtifacts.get(artId);
            if (!artRow) {
              throw new StorageError(
                "conflict",
                `Artifact ${artId} referenced by instance not found`,
              );
            }
            const bytesRow = await db.taskArtifactBytes.get(artId);
            if (!bytesRow) {
              throw new StorageError("conflict", `Artifact ${artId} bytes not found`);
            }
            if (availableArtifactBytes.has(artId)) {
              const available = availableArtifactBytes.get(artId)!;
              if (available.byteLength === 0) {
                throw new StorageError("conflict", `Artifact ${artId} available bytes are empty`);
              }
              if (!artifactsByteEqual(available, bytesRow.bytes)) {
                throw new StorageError(
                  "conflict",
                  `Artifact ${artId} available bytes do not match stored bytes`,
                );
              }
              if (!isArtifactDigestMatch(artRow.contentDigest, available)) {
                throw new StorageError(
                  "conflict",
                  `Artifact ${artId} available bytes do not match stored digest`,
                );
              }
            }
          }
          // Recompute the input digest from the candidate input (do not trust
          // the caller-supplied inputDigest).
          const recomputedDigest = computeInstanceInputDigest(candidate);
          // Reject a digest collision: caller-supplied inputDigest must match
          // the recomputed digest (spec §3.4 — digests are integrity aids).
          if (candidate.inputDigest !== recomputedDigest) {
            throw new StorageError(
              "conflict",
              `Instance inputDigest collision: supplied digest does not match recomputed digest`,
            );
          }
          // Resolve completeness from the bytes actually available.
          const completeness = resolveInstanceCompleteness({
            normalizedInput: candidate.normalizedInput,
            availableArtifactBytes,
          });
          // Only complete instances are eligible for reuse (spec §3.4).
          if (completeness === "complete") {
            // Look for an existing instance under the same Task Version with
            // the same inputDigest, then verify deep equality before reuse.
            const candidates = await db.taskInstances
              .where("[taskId+taskVersion]")
              .equals([candidate.taskId, candidate.taskVersion])
              .toArray();
            for (const row of candidates) {
              if (row.inputDigest !== recomputedDigest) continue;
              const existing = isTaskInstance(row.instance) ? row.instance : null;
              if (!existing) continue;
              if (existing.inputCompleteness !== "complete") continue;
              if (instancesReuseEqual(existing, { ...candidate, inputCompleteness: "complete" })) {
                return { instance: existing, reused: true };
              }
              // Same digest but not reuse-equal → collision mismatch.
              throw new StorageError(
                "conflict",
                `Instance inputDigest collision: ${recomputedDigest} maps to a non-equal instance`,
              );
            }
          }
          // No reuse — create a new instance with the resolved completeness.
          const newInstance: TaskInstance = {
            ...candidate,
            inputDigest: recomputedDigest,
            inputCompleteness: completeness,
          };
          await db.taskInstances.put({
            id: newInstance.id,
            instance: newInstance,
            taskId: newInstance.taskId,
            taskVersion: newInstance.taskVersion,
            inputDigest: newInstance.inputDigest,
            inputCompleteness: newInstance.inputCompleteness,
            createdAt: newInstance.createdAt,
          });
          return { instance: newInstance, reused: false };
        },
      );
      return result;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getTaskInstance(id: string): Promise<TaskInstance | null> {
    try {
      const row = await db.taskInstances.get(id);
      if (!row) return null;
      return isTaskInstance(row.instance) ? row.instance : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTaskInstances(taskId: string, taskVersion?: number): Promise<TaskInstance[]> {
    try {
      let rows;
      if (taskVersion !== undefined) {
        rows = await db.taskInstances
          .where("[taskId+taskVersion]")
          .equals([taskId, taskVersion])
          .toArray();
      } else {
        rows = await db.taskInstances.where("taskId").equals(taskId).toArray();
      }
      return rows
        .map((r) => r.instance)
        .filter((i): i is TaskInstance => isTaskInstance(i))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- families -------------------------------------------------------------

  async function createTaskFamily(family: TaskFamily): Promise<void> {
    assertValid(validateTaskFamily(family), "Invalid task family");
    db.assertWritable();
    try {
      await db.transaction("rw", db.taskFamilies, async () => {
        const existing = await db.taskFamilies.get(family.id);
        if (existing) {
          throw new StorageError("conflict", `Task family ${family.id} already exists`);
        }
        await db.taskFamilies.put({
          id: family.id,
          family,
          parentFamilyId: family.parentFamilyId,
          updatedAt: family.updatedAt,
          archivedAt: family.archivedAt,
          revision: family.revision,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function updateTaskFamily(family: TaskFamily, expectedRevision: number): Promise<number> {
    assertValid(validateTaskFamily(family), "Invalid task family");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskFamilies, async () => {
        const existing = await db.taskFamilies.get(family.id);
        if (!existing) throw new StorageError("conflict", `Task family ${family.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const updated: TaskFamily = { ...family, revision: newRevision };
        await db.taskFamilies.put({
          id: family.id,
          family: updated,
          parentFamilyId: updated.parentFamilyId,
          updatedAt: updated.updatedAt,
          archivedAt: updated.archivedAt,
          revision: newRevision,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function archiveTaskFamily(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskFamilies, async () => {
        const existing = await db.taskFamilies.get(id);
        if (!existing) throw new StorageError("conflict", `Task family ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const family = isTaskFamily(existing.family) ? existing.family : null;
        if (!family) throw new StorageError("validation", "Invalid task family");
        const now = Date.now();
        const updated: TaskFamily = {
          ...family,
          revision: newRevision,
          archivedAt: now,
          updatedAt: now,
        };
        await db.taskFamilies.put({
          ...existing,
          family: updated,
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

  async function restoreTaskFamily(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskFamilies, async () => {
        const existing = await db.taskFamilies.get(id);
        if (!existing) throw new StorageError("conflict", `Task family ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const family = isTaskFamily(existing.family) ? existing.family : null;
        if (!family) throw new StorageError("validation", "Invalid task family");
        const now = Date.now();
        const updated: TaskFamily = {
          ...family,
          revision: newRevision,
          archivedAt: null,
          updatedAt: now,
        };
        await db.taskFamilies.put({
          ...existing,
          family: updated,
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

  async function getTaskFamily(id: string): Promise<TaskFamily | null> {
    try {
      const row = await db.taskFamilies.get(id);
      if (!row) return null;
      return isTaskFamily(row.family) ? row.family : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listTaskFamilies(includeArchived = false): Promise<TaskFamily[]> {
    try {
      const rows = await db.taskFamilies.toArray();
      return rows
        .filter((r) => includeArchived || r.archivedAt === null)
        .map((r) => r.family)
        .filter((f): f is TaskFamily => isTaskFamily(f))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- family assignments (at most one primary per Task) -------------------

  async function assignTaskFamily(assignment: TaskFamilyAssignment): Promise<void> {
    assertValid(validateTaskFamilyAssignment(assignment), "Invalid task family assignment");
    db.assertWritable();
    try {
      await db.transaction(
        "rw",
        db.tasks,
        db.taskVersions,
        db.taskFamilies,
        db.taskFamilyAssignments,
        async () => {
          // Referential integrity: Task, Version, and Family must exist.
          const taskRow = await db.tasks.get(assignment.taskId);
          if (!taskRow) {
            throw new StorageError("conflict", `Task ${assignment.taskId} not found`);
          }
          const versionRow = await db.taskVersions.get([assignment.taskId, assignment.taskVersion]);
          if (!versionRow) {
            throw new StorageError(
              "conflict",
              `Task version ${assignment.taskId}@${assignment.taskVersion} not found`,
            );
          }
          const familyRow = await db.taskFamilies.get(assignment.familyId);
          if (!familyRow) {
            throw new StorageError("conflict", `Task family ${assignment.familyId} not found`);
          }
          // Enforce at most one primary per Task: demote existing primaries.
          if (assignment.isPrimary) {
            const existingPrimaries = await db.taskFamilyAssignments
              .where("taskId")
              .equals(assignment.taskId)
              .and((r) => r.isPrimary === 1 && r.archivedAt === null)
              .toArray();
            for (const row of existingPrimaries) {
              const existing = isTaskFamilyAssignment(row.assignment) ? row.assignment : null;
              if (!existing) continue;
              const demoted: TaskFamilyAssignment = {
                ...existing,
                isPrimary: false,
                revision: existing.revision + 1,
              };
              await db.taskFamilyAssignments.put({
                ...row,
                assignment: demoted,
                isPrimary: 0,
                revision: demoted.revision,
              });
            }
          }
          await db.taskFamilyAssignments.put({
            id: assignment.id,
            assignment,
            taskId: assignment.taskId,
            taskVersion: assignment.taskVersion,
            familyId: assignment.familyId,
            isPrimary: assignment.isPrimary ? 1 : 0,
            createdAt: assignment.createdAt,
            revision: assignment.revision,
            archivedAt: assignment.archivedAt,
          });
        },
      );
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function archiveTaskFamilyAssignment(
    id: string,
    expectedRevision: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.taskFamilyAssignments, async () => {
        const existing = await db.taskFamilyAssignments.get(id);
        if (!existing) {
          throw new StorageError("conflict", `Task family assignment ${id} not found`);
        }
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const assignment = isTaskFamilyAssignment(existing.assignment) ? existing.assignment : null;
        if (!assignment) throw new StorageError("validation", "Invalid task family assignment");
        const now = Date.now();
        const updated: TaskFamilyAssignment = {
          ...assignment,
          revision: newRevision,
          archivedAt: now,
        };
        await db.taskFamilyAssignments.put({
          ...existing,
          assignment: updated,
          revision: newRevision,
          archivedAt: now,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listTaskFamilyAssignments(taskId: string): Promise<TaskFamilyAssignment[]> {
    try {
      const rows = await db.taskFamilyAssignments.where("taskId").equals(taskId).toArray();
      return rows
        .map((r) => r.assignment)
        .filter((a): a is TaskFamilyAssignment => isTaskFamilyAssignment(a))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- facet annotations ---------------------------------------------------

  async function annotateTaskFacet(annotation: TaskFacetAnnotation): Promise<void> {
    assertValid(validateTaskFacetAnnotation(annotation), "Invalid task facet annotation");
    db.assertWritable();
    try {
      await db.transaction("rw", db.tasks, db.taskVersions, db.taskFacetAnnotations, async () => {
        // Referential integrity: Task must exist; Version if specified.
        const taskRow = await db.tasks.get(annotation.taskId);
        if (!taskRow) {
          throw new StorageError("conflict", `Task ${annotation.taskId} not found`);
        }
        if (annotation.taskVersion !== null) {
          const versionRow = await db.taskVersions.get([annotation.taskId, annotation.taskVersion]);
          if (!versionRow) {
            throw new StorageError(
              "conflict",
              `Task version ${annotation.taskId}@${annotation.taskVersion} not found`,
            );
          }
        }
        // Annotations are append-only by id; a duplicate id is a conflict.
        const existing = await db.taskFacetAnnotations.get(annotation.id);
        if (existing) {
          throw new StorageError("conflict", `Facet annotation ${annotation.id} already exists`);
        }
        await db.taskFacetAnnotations.put({
          id: annotation.id,
          annotation,
          taskId: annotation.taskId,
          taskVersion: annotation.taskVersion,
          facetId: annotation.facetId,
          valueId: annotation.valueId,
          createdAt: annotation.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listTaskFacetAnnotations(taskId: string): Promise<TaskFacetAnnotation[]> {
    try {
      const rows = await db.taskFacetAnnotations.where("taskId").equals(taskId).toArray();
      return rows
        .map((r) => r.annotation)
        .filter((a): a is TaskFacetAnnotation => isTaskFacetAnnotation(a))
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  return {
    createTask,
    appendTaskVersion,
    archiveTask,
    restoreTask,
    getTaskRecord,
    getTaskVersion,
    listTasks,
    putTaskArtifact,
    getTaskArtifact,
    getTaskArtifactBytes,
    getOrCreateTaskInstance,
    getTaskInstance,
    listTaskInstances,
    createTaskFamily,
    updateTaskFamily,
    archiveTaskFamily,
    restoreTaskFamily,
    getTaskFamily,
    listTaskFamilies,
    assignTaskFamily,
    archiveTaskFamilyAssignment,
    listTaskFamilyAssignments,
    annotateTaskFacet,
    listTaskFacetAnnotations,
  };
}
