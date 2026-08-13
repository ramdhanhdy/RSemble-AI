// =============================================================================
// RSemble AI — In-memory Canonical Task repository (parity)
//
// Child 02 (Canonical Tasks) Milestone B — Task 3.
//
// In-memory TaskRepository with identical validation and conflict semantics
// to the Dexie implementation in `./task-repository.ts`. Used by unit tests
// and non-persisted orchestration. No Dexie, no I/O. The same public contract
// is exercised by the shared `repositorySuite` in `task-repository.test.ts`.
// =============================================================================

import { StorageError } from "./database";
import {
  artifactsByteEqual,
  computeInstanceInputDigest,
  instancesReuseEqual,
  isArtifactDigestMatch,
  resolveInstanceCompleteness,
} from "../tasks/task-instance";
import { validateContiguousAppend } from "../tasks/task-versioning";
import {
  isTaskArtifact,
  isTaskFamily,
  isTaskFamilyRelation,
  isTaskInstance,
  validateTaskArtifact,
  validateTaskFacetAnnotation,
  validateTaskFamily,
  validateTaskFamilyAssignment,
  validateTaskFamilyRelation,
  validateTaskInstance,
  validateTaskRecord,
  validateTaskVersion,
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
import type {
  GetOrCreateInstanceResult,
  TaskFamilyRelationRepository,
  TaskListQuery,
  TaskRepository,
} from "./task-repository";
import type { TaskMigrationCrosswalk } from "../tasks/task-references";


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

export class InMemoryTaskRepository implements TaskRepository, TaskFamilyRelationRepository {
  private tasks = new Map<string, TaskRecord>();
  private versions = new Map<string, Map<number, TaskVersion>>();
  private artifacts = new Map<string, TaskArtifact>();
  private artifactBytes = new Map<string, Uint8Array>();
  private instances = new Map<string, TaskInstance>();
  private families = new Map<string, TaskFamily>();
  private assignments = new Map<string, TaskFamilyAssignment>();
  private annotations = new Map<string, TaskFacetAnnotation>();
  private relations = new Map<string, TaskFamilyRelation>();

  // --- Task + version lifecycle ---------------------------------------------

  async createTask(record: TaskRecord, version: TaskVersion): Promise<void> {
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
    if (this.tasks.has(record.id)) {
      throw new StorageError("conflict", `Task ${record.id} already exists`);
    }
    this.tasks.set(record.id, record);
    const versionMap = new Map<number, TaskVersion>();
    versionMap.set(version.version, version);
    this.versions.set(record.id, versionMap);
  }

  async appendTaskVersion(
    record: TaskRecord,
    version: TaskVersion,
    expectedRevision: number,
  ): Promise<number> {
    assertValid(validateTaskRecord(record), "Invalid task record");
    assertValid(validateTaskVersion(version), "Invalid task version");
    if (record.id !== version.taskId) {
      throw new StorageError("validation", "Task record/version ID mismatch");
    }
    const existing = this.tasks.get(record.id);
    if (!existing) throw new StorageError("conflict", `Task ${record.id} not found`);
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
        `Task version ${version.taskId}@${version.version} already exists — versions are immutable.`,
      );
    }
    const newRevision = expectedRevision + 1;
    const newLatest = version.version;
    const updated: TaskRecord = {
      ...record,
      revision: newRevision,
      latestVersion: newLatest,
      updatedAt: Date.now(),
    };
    this.tasks.set(record.id, updated);
    versionMap?.set(version.version, version);
    return newRevision;
  }

  async archiveTask(id: string, expectedRevision: number): Promise<number> {
    const existing = this.tasks.get(id);
    if (!existing) throw new StorageError("conflict", `Task ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.tasks.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: now,
      updatedAt: now,
    });
    return newRevision;
  }

  async restoreTask(id: string, expectedRevision: number): Promise<number> {
    const existing = this.tasks.get(id);
    if (!existing) throw new StorageError("conflict", `Task ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.tasks.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: null,
      updatedAt: now,
    });
    return newRevision;
  }

  async getTaskRecord(id: string): Promise<TaskRecord | null> {
    return this.tasks.get(id) ?? null;
  }

  async getTaskVersion(taskId: string, version: number): Promise<TaskVersion | null> {
    return this.versions.get(taskId)?.get(version) ?? null;
  }

  async listTaskVersions(taskId: string): Promise<TaskVersion[]> {
    const versions = this.versions.get(taskId);
    if (!versions) return [];
    return [...versions.values()].sort((a, b) => a.version - b.version);
  }

  async listTaskMigrationCrosswalks(taskId: string): Promise<TaskMigrationCrosswalk[]> {
    void taskId;
    return [];
  }


  async listTasks(query: TaskListQuery): Promise<TaskRecord[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const needle = query.search?.trim().toLowerCase() ?? "";
    // Family filter: taskIds with an active primary assignment (parity with the
    // Dexie implementation — identical semantics, no I/O).
    let familyFilter: Set<string> | null = null;
    if (query.familyId !== undefined) {
      familyFilter = new Set<string>();
      for (const a of this.assignments.values()) {
        if (a.familyId === query.familyId && a.isPrimary && a.archivedAt === null) {
          familyFilter.add(a.taskId);
        }
      }
    }
    // Facet filter (Task 8B, spec §7.1): taskIds carrying an annotation with
    // the requested dimension+value pair (parity with the Dexie walk).
    let facetFilter: Set<string> | null = null;
    if (query.facetId !== undefined && query.facetValueId !== undefined) {
      facetFilter = new Set<string>();
      for (const ann of this.annotations.values()) {
        if (ann.facetId === query.facetId && ann.valueId === query.facetValueId) {
          facetFilter.add(ann.taskId);
        }
      }
    }
    const archiveState: "active" | "archived" | "all" =
      query.archiveState ?? (query.includeArchived === true ? "all" : "active");
    return [...this.tasks.values()]
      .filter((t) => query.origin === undefined || t.origin === query.origin)
      .filter((t) => archiveState === "all" || (archiveState === "active" ? t.archivedAt === null : t.archivedAt !== null))
      .filter((t) => familyFilter === null || familyFilter.has(t.id))
      .filter((t) => facetFilter === null || facetFilter.has(t.id))
      .filter((t) => {
        if (needle === "") return true;
        const version = this.versions.get(t.id)?.get(t.latestVersion) ?? null;
        const title = version?.title.toLowerCase() ?? "";
        const objective = version?.objective.toLowerCase() ?? "";
        return title.includes(needle) || objective.includes(needle);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .slice(offset, offset + limit);
  }

  // --- immutable artifacts (bytes outside rows) -----------------------------

  async putTaskArtifact(artifact: TaskArtifact, bytes: Uint8Array): Promise<void> {
    assertValid(validateTaskArtifact(artifact), "Invalid task artifact");
    if (bytes.byteLength === 0) {
      throw new StorageError("validation", "TaskArtifact requires non-empty bytes");
    }
    if (!isArtifactDigestMatch(artifact.contentDigest, bytes)) {
      throw new StorageError(
        "validation",
        "Artifact contentDigest does not match the supplied bytes",
      );
    }
    if (artifact.byteCount !== bytes.byteLength) {
      throw new StorageError("validation", "Artifact byteCount does not match the supplied bytes");
    }
    const existing = this.artifacts.get(artifact.id);
    if (existing) {
      if (existing.contentDigest === artifact.contentDigest) {
        const existingBytes = this.artifactBytes.get(artifact.id);
        if (existingBytes && artifactsByteEqual(existingBytes, bytes)) {
          return; // identical — no-op (idempotent)
        }
      }
      throw new StorageError(
        "conflict",
        `Artifact ${artifact.id} already exists with different content (digest collision)`,
      );
    }
    // Digest collision across different ids: same digest, different bytes.
    for (const [otherId, other] of this.artifacts) {
      if (otherId === artifact.id) continue;
      if (other.contentDigest === artifact.contentDigest) {
        const otherBytes = this.artifactBytes.get(otherId);
        if (otherBytes && !artifactsByteEqual(otherBytes, bytes)) {
          throw new StorageError(
            "conflict",
            `Digest collision: ${artifact.contentDigest} maps to different bytes (byte equality failed)`,
          );
        }
      }
    }
    this.artifacts.set(artifact.id, artifact);
    this.artifactBytes.set(artifact.id, bytes);
  }

  async getTaskArtifact(id: string): Promise<TaskArtifact | null> {
    const a = this.artifacts.get(id);
    if (!a) return null;
    return isTaskArtifact(a) ? a : null;
  }

  async getTaskArtifactBytes(id: string): Promise<Uint8Array | null> {
    return this.artifactBytes.get(id) ?? null;
  }

  // --- instances (get-or-create with byte equality) -------------------------

  async getOrCreateTaskInstance(
    candidate: TaskInstance,
    availableArtifactBytes: Map<string, Uint8Array>,
  ): Promise<GetOrCreateInstanceResult> {
    assertValid(validateTaskInstance(candidate), "Invalid task instance");
    // The Task and Version must exist.
    if (!this.tasks.has(candidate.taskId)) {
      throw new StorageError("conflict", `Task ${candidate.taskId} not found`);
    }
    if (!this.versions.get(candidate.taskId)?.has(candidate.taskVersion)) {
      throw new StorageError(
        "conflict",
        `Task version ${candidate.taskId}@${candidate.taskVersion} not found`,
      );
    }
    // Every referenced artifact must exist and have stored bytes (referential
    // integrity). When the caller supplies available bytes for an artifact,
    // they must be non-empty, byte-equal the stored bytes, and digest-match
    // the artifact row — this prevents empty/wrong map bytes from fabricating
    // a "complete" instance (spec §3.4, §8). Absent available bytes are
    // allowed; completeness resolves to incomplete/metadata_only via
    // resolveInstanceCompleteness.
    for (const artId of candidate.normalizedInput.artifactIds) {
      const art = this.artifacts.get(artId);
      if (!art) {
        throw new StorageError("conflict", `Artifact ${artId} referenced by instance not found`);
      }
      const storedBytes = this.artifactBytes.get(artId);
      if (!storedBytes) {
        throw new StorageError("conflict", `Artifact ${artId} bytes not found`);
      }
      if (availableArtifactBytes.has(artId)) {
        const available = availableArtifactBytes.get(artId)!;
        if (available.byteLength === 0) {
          throw new StorageError("conflict", `Artifact ${artId} available bytes are empty`);
        }
        if (!artifactsByteEqual(available, storedBytes)) {
          throw new StorageError(
            "conflict",
            `Artifact ${artId} available bytes do not match stored bytes`,
          );
        }
        if (!isArtifactDigestMatch(art.contentDigest, available)) {
          throw new StorageError(
            "conflict",
            `Artifact ${artId} available bytes do not match stored digest`,
          );
        }
      }
    }
    // Recompute the input digest from the candidate input (do not trust the
    // caller-supplied inputDigest).
    const recomputedDigest = computeInstanceInputDigest(candidate);
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
      for (const existing of this.instances.values()) {
        if (existing.taskId !== candidate.taskId) continue;
        if (existing.taskVersion !== candidate.taskVersion) continue;
        if (existing.inputDigest !== recomputedDigest) continue;
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
    this.instances.set(newInstance.id, newInstance);
    return { instance: newInstance, reused: false };
  }

  async getTaskInstance(id: string): Promise<TaskInstance | null> {
    const inst = this.instances.get(id);
    if (!inst) return null;
    return isTaskInstance(inst) ? inst : null;
  }

  async listTaskInstances(taskId: string, taskVersion?: number): Promise<TaskInstance[]> {
    return [...this.instances.values()]
      .filter((i) => i.taskId === taskId)
      .filter((i) => taskVersion === undefined || i.taskVersion === taskVersion)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  // --- families -------------------------------------------------------------

  async createTaskFamily(family: TaskFamily): Promise<void> {
    assertValid(validateTaskFamily(family), "Invalid task family");
    if (this.families.has(family.id)) {
      throw new StorageError("conflict", `Task family ${family.id} already exists`);
    }
    this.assertParentChainValid(family.id, family.parentFamilyId);
    this.families.set(family.id, family);
  }

  /** Task 8B (spec §3.5): explicit parent validity — the parent must exist
   *  (invalid-parent) and the parent chain must not reach the family itself
   *  (cycle). No hierarchy is inferred beyond the explicit parent link. */
  private assertParentChainValid(familyId: string, parentFamilyId: string | null): void {
    if (parentFamilyId === null) return;
    if (parentFamilyId === familyId) {
      throw new StorageError(
        "conflict",
        `Task family ${familyId} cannot be its own parent (cycle).`,
      );
    }
    let cursor: string | null = parentFamilyId;
    for (let hops = 0; cursor !== null; hops++) {
      if (hops > 1000) {
        throw new StorageError("conflict", "Family parent chain is too deep to validate.");
      }
      const parent = this.families.get(cursor);
      if (!parent) {
        throw new StorageError("conflict", `Task family ${cursor} not found`);
      }
      if (parent.id === familyId) {
        throw new StorageError(
          "conflict",
          `Setting parent ${parentFamilyId} would create a family cycle through ${cursor}.`,
        );
      }
      cursor = parent.parentFamilyId;
    }
  }

  async updateTaskFamily(family: TaskFamily, expectedRevision: number): Promise<number> {
    assertValid(validateTaskFamily(family), "Invalid task family");
    const existing = this.families.get(family.id);
    if (!existing) throw new StorageError("conflict", `Task family ${family.id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    this.assertParentChainValid(family.id, family.parentFamilyId);
    const newRevision = expectedRevision + 1;
    this.families.set(family.id, { ...family, revision: newRevision });
    return newRevision;
  }

  async archiveTaskFamily(id: string, expectedRevision: number): Promise<number> {
    const existing = this.families.get(id);
    if (!existing) throw new StorageError("conflict", `Task family ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.families.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: now,
      updatedAt: now,
    });
    return newRevision;
  }

  async restoreTaskFamily(id: string, expectedRevision: number): Promise<number> {
    const existing = this.families.get(id);
    if (!existing) throw new StorageError("conflict", `Task family ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.families.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: null,
      updatedAt: now,
    });
    return newRevision;
  }

  async getTaskFamily(id: string): Promise<TaskFamily | null> {
    const f = this.families.get(id);
    if (!f) return null;
    return isTaskFamily(f) ? f : null;
  }

  async listTaskFamilies(includeArchived = false): Promise<TaskFamily[]> {
    return [...this.families.values()]
      .filter((f) => includeArchived || f.archivedAt === null)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }

  // --- family assignments (at most one primary per Task) -------------------

  async assignTaskFamily(assignment: TaskFamilyAssignment): Promise<void> {
    assertValid(validateTaskFamilyAssignment(assignment), "Invalid task family assignment");
    // Referential integrity: Task, Version, and Family must exist.
    if (!this.tasks.has(assignment.taskId)) {
      throw new StorageError("conflict", `Task ${assignment.taskId} not found`);
    }
    if (!this.versions.get(assignment.taskId)?.has(assignment.taskVersion)) {
      throw new StorageError(
        "conflict",
        `Task version ${assignment.taskId}@${assignment.taskVersion} not found`,
      );
    }
    if (!this.families.has(assignment.familyId)) {
      throw new StorageError("conflict", `Task family ${assignment.familyId} not found`);
    }
    // Enforce at most one primary per Task: demote existing primaries.
    if (assignment.isPrimary) {
      for (const [id, existing] of this.assignments) {
        if (existing.taskId !== assignment.taskId) continue;
        if (!existing.isPrimary) continue;
        if (existing.archivedAt !== null) continue;
        this.assignments.set(id, {
          ...existing,
          isPrimary: false,
          revision: existing.revision + 1,
        });
      }
    }
    this.assignments.set(assignment.id, assignment);
  }

  async archiveTaskFamilyAssignment(id: string, expectedRevision: number): Promise<number> {
    const existing = this.assignments.get(id);
    if (!existing) {
      throw new StorageError("conflict", `Task family assignment ${id} not found`);
    }
    if (existing.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
      );
    }
    const newRevision = expectedRevision + 1;
    const now = Date.now();
    this.assignments.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: now,
    });
    return newRevision;
  }

  async listTaskFamilyAssignments(taskId: string): Promise<TaskFamilyAssignment[]> {
    return [...this.assignments.values()]
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  // --- facet annotations ---------------------------------------------------

  async annotateTaskFacet(annotation: TaskFacetAnnotation): Promise<void> {
    assertValid(validateTaskFacetAnnotation(annotation), "Invalid task facet annotation");
    // Referential integrity: Task must exist; Version if specified.
    if (!this.tasks.has(annotation.taskId)) {
      throw new StorageError("conflict", `Task ${annotation.taskId} not found`);
    }
    if (annotation.taskVersion !== null) {
      if (!this.versions.get(annotation.taskId)?.has(annotation.taskVersion)) {
        throw new StorageError(
          "conflict",
          `Task version ${annotation.taskId}@${annotation.taskVersion} not found`,
        );
      }
    }
    // Task 8B (spec §3.6): supersession provenance must reference an existing
    // annotation of the SAME Task — supersession appends, never crosses Tasks
    // or points at nothing.
    if (annotation.supersedesId !== null) {
      const superseded = this.annotations.get(annotation.supersedesId);
      if (!superseded) {
        throw new StorageError(
          "conflict",
          `Facet annotation ${annotation.supersedesId} not found`,
        );
      }
      if (superseded.taskId !== annotation.taskId) {
        throw new StorageError(
          "conflict",
          `Supersession must target an annotation of the same task: ${annotation.supersedesId} belongs to ${superseded.taskId}`,
        );
      }
    }
    // Annotations are append-only by id; a duplicate id is a conflict.
    if (this.annotations.has(annotation.id)) {
      throw new StorageError("conflict", `Facet annotation ${annotation.id} already exists`);
    }
    this.annotations.set(annotation.id, annotation);
  }

  async listTaskFacetAnnotations(taskId: string): Promise<TaskFacetAnnotation[]> {
    return [...this.annotations.values()]
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  // --- typed family relations (spec §3.5, Task 8A) -----------------------

  async createTaskFamilyRelation(relation: TaskFamilyRelation): Promise<void> {
    assertValid(validateTaskFamilyRelation(relation), "Invalid task family relation");
    // Referential integrity: both endpoint families must exist.
    if (!this.families.has(relation.fromFamilyId)) {
      throw new StorageError(
        "conflict",
        `Task family ${relation.fromFamilyId} not found`,
      );
    }
    if (!this.families.has(relation.toFamilyId)) {
      throw new StorageError(
        "conflict",
        `Task family ${relation.toFamilyId} not found`,
      );
    }
    // Self-relation is rejected by the validator; defend at the boundary too.
    if (relation.fromFamilyId === relation.toFamilyId) {
      throw new StorageError(
        "validation",
        "A family relation cannot reference itself (no self-relation).",
      );
    }
    // Duplicate id is a conflict — no silent overwrite.
    if (this.relations.has(relation.id)) {
      throw new StorageError(
        "conflict",
        `Task family relation ${relation.id} already exists`,
      );
    }
    this.relations.set(relation.id, relation);
  }

  async listTaskFamilyRelations(): Promise<TaskFamilyRelation[]> {
    return [...this.relations.values()]
      .filter((r): r is TaskFamilyRelation => isTaskFamilyRelation(r))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
}
