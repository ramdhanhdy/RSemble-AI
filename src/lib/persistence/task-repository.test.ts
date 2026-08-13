// =============================================================================
// RSemble AI — Canonical Task repository contract tests (Dexie + in-memory)
//
// Child 02 (Canonical Tasks) Milestone B — Task 3 (RED first).
//
// Exercises the public TaskRepository contract against both the Dexie-backed
// implementation and the in-memory parity implementation through a shared
// `repositorySuite`. Covers spec §5 repository contracts and §11 validation:
//   - atomic Task + version 1 creation (no partial on conflict)
//   - contiguous append version with revision CAS
//   - archive / restore with revision CAS
//   - complete-instance byte availability + metadata-only rejection
//   - exact get-or-create instance reuse under same Task Version
//   - family / facet assignment
//   - deterministic paginated queries
//   - classified storage failures (validation / conflict)
//   - collision mismatch (digest equal, bytes differ) rejected
//   - referenced-version protection seam (no delete API exposed)
//
// The Dexie suite also exercises clean and legacy database opening/upgrading:
// a fresh v3 DB opens cleanly, and a DB seeded at v1 then reopened at v3
// upgrades additively without losing v1 rows.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";

import { RSembleEvaluationDB } from "./database";
import {
  createTaskRepository,
  type TaskRepository,
  type TaskListQuery,
} from "./task-repository";
import { InMemoryTaskRepository } from "./in-memory-task-repository";

import {
  artifactsByteEqual,
  buildTaskArtifact,
  computeArtifactDigest,
  computeInstanceInputDigest,
  resolveInstanceCompleteness,
} from "../tasks/task-instance";
import {
  archiveTaskRecord,
  buildInitialTaskRecord,
  buildNextVersion,
  restoreTaskRecord,
} from "../tasks/task-versioning";
import type {
  ContextManifestEntry,
  NormalizedTaskInput,
  TaskArtifact,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFacetAnnotation,
  TaskInstance,
  TaskInstanceSourceRef,
  TaskRecord,
  TaskSource,
  TaskVersion,
} from "../tasks/task-types";

// --- fixtures ----------------------------------------------------------------

const DIGEST_A = "sha256:" + "a".repeat(64);
const NOW = 1_000;

function manifestEntry(overrides: Partial<ContextManifestEntry> = {}): ContextManifestEntry {
  return {
    role: "primary",
    artifactId: "art-1",
    externalRef: null,
    metadataDigest: DIGEST_A,
    mediaType: "text/plain",
    byteCount: 5,
    ...overrides,
  };
}

function source(overrides: Partial<TaskSource> = {}): TaskSource {
  return { kind: "authored", legacyScopeKey: null, note: null, ...overrides };
}

function instanceSourceRef(
  overrides: Partial<TaskInstanceSourceRef> = {},
): TaskInstanceSourceRef {
  return { kind: "authored", legacyScopeKey: null, originId: null, ...overrides };
}

function taskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return buildInitialTaskRecord({
    id: "task-1",
    createdAt: NOW,
    origin: "authored",
    ...overrides,
  });
}

function taskVersion(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "task-1",
    version: 1,
    title: "Summarize a report",
    objective: "Produce a faithful summary.",
    candidateInstruction: "Summarize the following report in 3 bullets.",
    defaultContextManifest: [manifestEntry()],
    responseContract: { format: "markdown", constraints: ["no preamble"], maxLength: 500 },
    taskVerifierRef: { id: "verifier-1", version: 2 },
    source: source(),
    createdAt: NOW,
    ...overrides,
  };
}

function normalizedInput(overrides: Partial<NormalizedTaskInput> = {}): NormalizedTaskInput {
  return {
    text: "Summarize this.",
    artifactIds: ["art-1"],
    metadata: { locale: "en" },
    ...overrides,
  };
}

function taskInstance(overrides: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id: "inst-1",
    taskId: "task-1",
    taskVersion: 1,
    normalizedInput: normalizedInput(),
    contextManifest: [manifestEntry()],
    inputDigest: DIGEST_A,
    inputCompleteness: "complete",
    createdAt: NOW,
    sourceRef: instanceSourceRef(),
    ...overrides,
  };
}

function taskFamily(overrides: Partial<TaskFamily> = {}): TaskFamily {
  return {
    id: "family-1",
    name: "Summarization",
    description: "Tasks that summarize content.",
    parentFamilyId: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    revision: 0,
    ...overrides,
  };
}

function familyAssignment(overrides: Partial<TaskFamilyAssignment> = {}): TaskFamilyAssignment {
  return {
    id: "assign-1",
    taskId: "task-1",
    taskVersion: 1,
    familyId: "family-1",
    isPrimary: true,
    createdAt: NOW,
    revision: 0,
    archivedAt: null,
    ...overrides,
  };
}

function facetAnnotation(overrides: Partial<TaskFacetAnnotation> = {}): TaskFacetAnnotation {
  return {
    id: "facet-1",
    taskId: "task-1",
    taskVersion: 1,
    facetId: "domain",
    valueId: "nlp",
    source: "authored",
    authorKind: "user",
    confidence: 0.9,
    taxonomyVersion: 1,
    createdAt: NOW,
    supersedesId: null,
    ...overrides,
  };
}

const TEXT_BYTES = new TextEncoder().encode("hello world");

// --- shared contract suite ---------------------------------------------------

export function repositorySuite(name: string, makeRepo: () => TaskRepository & object) {
  describe(name, () => {
    // --- atomic Task + v1 creation -------------------------------------------

    it("creates Task + version 1 atomically and reads them back", async () => {
      const repo = makeRepo();
      const record = taskRecord();
      const version = taskVersion();
      await repo.createTask(record, version);
      const got = await repo.getTaskRecord("task-1");
      expect(got).toMatchObject({ id: "task-1", latestVersion: 1, revision: 0 });
      const v1 = await repo.getTaskVersion("task-1", 1);
      expect(v1).toMatchObject({ taskId: "task-1", version: 1, title: "Summarize a report" });
    });

    it("rejects creating a Task whose id already exists (no partial overwrite)", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await expect(repo.createTask(taskRecord(), taskVersion())).rejects.toThrow(/already exists/);
      // The original record is untouched.
      const got = await repo.getTaskRecord("task-1");
      expect(got?.revision).toBe(0);
    });

    it("rejects createTask when record.id !== version.taskId", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTask(taskRecord({ id: "task-1" }), taskVersion({ taskId: "task-2" })),
      ).rejects.toThrow(/mismatch/);
    });

    it("rejects createTask when version.version !== 1", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTask(taskRecord(), taskVersion({ version: 2 })),
      ).rejects.toThrow(/version.*1/);
    });

    it("rejects createTask with an invalid record (validation)", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTask({ ...taskRecord(), id: "" }, taskVersion()),
      ).rejects.toThrow(/validation/i);
    });

    it("rejects createTask carrying prohibited credential keys", async () => {
      const repo = makeRepo();
      const bad = { ...taskRecord(), apiKey: "sk-leak" } as unknown as TaskRecord;
      await expect(repo.createTask(bad, taskVersion())).rejects.toThrow(/prohibited|validation/i);
    });

    // --- contiguous append with CAS -----------------------------------------

    it("appends the next contiguous version under revision CAS", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      const nextDraft = buildNextVersion({
        latestVersion: record.latestVersion,
        taskId: "task-1",
        draft: { ...taskVersion(), title: "Summarize v2" },
        createdAt: 2_000,
        source: source(),
      });
      const rev = await repo.appendTaskVersion(record, nextDraft, record.revision);
      expect(rev).toBe(1);
      const updated = (await repo.getTaskRecord("task-1"))!;
      expect(updated.latestVersion).toBe(2);
      expect(updated.revision).toBe(1);
      const v2 = await repo.getTaskVersion("task-1", 2);
      expect(v2?.title).toBe("Summarize v2");
      // v1 is still immutable and present.
      expect(await repo.getTaskVersion("task-1", 1)).toMatchObject({ version: 1 });
    });

    it("rejects append with a stale revision (CAS conflict)", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      const nextDraft = buildNextVersion({
        latestVersion: record.latestVersion,
        taskId: "task-1",
        draft: { ...taskVersion(), title: "v2" },
        createdAt: 2_000,
        source: source(),
      });
      await expect(repo.appendTaskVersion(record, nextDraft, 999)).rejects.toThrow(/Stale|conflict/i);
      // No partial version written.
      expect(await repo.getTaskVersion("task-1", 2)).toBeNull();
      expect((await repo.getTaskRecord("task-1"))!.latestVersion).toBe(1);
    });

    it("rejects append with a non-contiguous version number", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      // Caller tries to write version 3 directly, skipping 2.
      const skipped = { ...taskVersion(), version: 3, title: "skip" };
      await expect(repo.appendTaskVersion(record, skipped, record.revision)).rejects.toThrow(
        /contiguous|version/i,
      );
    });

    it("rejects append when the Task is missing", async () => {
      const repo = makeRepo();
      const record = taskRecord();
      await expect(
        repo.appendTaskVersion(record, taskVersion({ version: 2 }), 0),
      ).rejects.toThrow(/not found/);
    });

    // --- archive / restore with CAS -----------------------------------------

    it("archives and restores a Task under revision CAS", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      const archivedRev = await repo.archiveTask("task-1", record.revision);
      expect(archivedRev).toBe(1);
      const archived = (await repo.getTaskRecord("task-1"))!;
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.revision).toBe(1);
      const restoredRev = await repo.restoreTask("task-1", archived.revision);
      expect(restoredRev).toBe(2);
      const restored = (await repo.getTaskRecord("task-1"))!;
      expect(restored.archivedAt).toBeNull();
      expect(restored.revision).toBe(2);
    });

    it("rejects archive with a stale revision", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await expect(repo.archiveTask("task-1", 999)).rejects.toThrow(/Stale|conflict/i);
    });

    it("rejects archive of a missing Task", async () => {
      const repo = makeRepo();
      await expect(repo.archiveTask("nope", 0)).rejects.toThrow(/not found/);
    });

    it("archived Tasks remain referenceable (versions intact)", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      await repo.archiveTask("task-1", record.revision);
      // Versions survive archive.
      expect(await repo.getTaskVersion("task-1", 1)).toMatchObject({ version: 1 });
    });

    // --- immutable artifact put/get with digest-collision byte equality -----

    it("puts and gets an artifact by id; bytes round-trip", async () => {
      const repo = makeRepo();
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const got = await repo.getTaskArtifact("art-1");
      expect(got?.id).toBe("art-1");
      expect(got?.contentDigest).toBe(artifact.contentDigest);
      const bytes = await repo.getTaskArtifactBytes("art-1");
      expect(bytes).not.toBeNull();
      expect(artifactsByteEqual(bytes!, TEXT_BYTES)).toBe(true);
    });

    it("rejects putting an artifact whose digest does not match the bytes", async () => {
      const repo = makeRepo();
      const mismatched: TaskArtifact = {
        id: "art-1",
        contentDigest: DIGEST_A, // wrong digest for TEXT_BYTES
        mediaType: "text/plain",
        byteCount: TEXT_BYTES.byteLength,
        storageRef: "blob://art-1",
        createdAt: NOW,
      };
      await expect(repo.putTaskArtifact(mismatched, TEXT_BYTES)).rejects.toThrow(/digest/i);
      expect(await repo.getTaskArtifact("art-1")).toBeNull();
    });

    it("rejects digest collision: same digest, different bytes (byte equality before reuse)", async () => {
      const repo = makeRepo();
      const bytesA = new TextEncoder().encode("hello world");
      const bytesB = new TextEncoder().encode("hello world!"); // different bytes
      // Force the same digest on both artifacts to simulate a digest collision.
      const artA: TaskArtifact = {
        id: "art-a",
        contentDigest: computeArtifactDigest(bytesA),
        mediaType: "text/plain",
        byteCount: bytesA.byteLength,
        storageRef: "blob://art-a",
        createdAt: NOW,
      };
      await repo.putTaskArtifact(artA, bytesA);
      const artB: TaskArtifact = {
        id: "art-b",
        contentDigest: artA.contentDigest, // same digest
        mediaType: "text/plain",
        byteCount: bytesB.byteLength,
        storageRef: "blob://art-b",
        createdAt: NOW,
      };
      // Different bytes under the same digest must be rejected (collision mismatch).
      await expect(repo.putTaskArtifact(artB, bytesB)).rejects.toThrow(/collision|digest/i);
    });

    it("rejects putting an artifact with prohibited credential keys in metadata", async () => {
      const repo = makeRepo();
      const bad = {
        id: "art-1",
        contentDigest: computeArtifactDigest(TEXT_BYTES),
        mediaType: "text/plain",
        byteCount: TEXT_BYTES.byteLength,
        storageRef: "blob://art-1",
        createdAt: NOW,
        apiKey: "sk-leak",
      } as unknown as TaskArtifact;
      await expect(repo.putTaskArtifact(bad, TEXT_BYTES)).rejects.toThrow(/prohibited|validation/i);
    });

    it("rejects putting an artifact with empty bytes", async () => {
      const repo = makeRepo();
      const empty: TaskArtifact = {
        id: "art-1",
        contentDigest: computeArtifactDigest(new Uint8Array(0)),
        mediaType: "text/plain",
        byteCount: 0,
        storageRef: "blob://art-1",
        createdAt: NOW,
      };
      await expect(repo.putTaskArtifact(empty, new Uint8Array(0))).rejects.toThrow(/empty|bytes/i);
    });

    it("idempotently re-puts an identical artifact (same id, same bytes)", async () => {
      const repo = makeRepo();
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      // Re-putting the exact same artifact+bytes is a no-op (idempotent).
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const bytes = await repo.getTaskArtifactBytes("art-1");
      expect(artifactsByteEqual(bytes!, TEXT_BYTES)).toBe(true);
    });

    // --- complete-instance byte availability + metadata-only rejection ------

    it("getOrCreateTaskInstance reuses an existing complete instance under the same Task Version", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const candidate = taskInstance();
      const available = new Map([["art-1", TEXT_BYTES]]);
      const { instance: created, reused } = await repo.getOrCreateTaskInstance(candidate, available);
      expect(reused).toBe(false);
      expect(created.id).toBe("inst-1");
      // Second call with identical input reuses.
      const { instance: reusedInst, reused: reused2 } = await repo.getOrCreateTaskInstance(
        { ...candidate, id: "inst-2" },
        available,
      );
      expect(reused2).toBe(true);
      expect(reusedInst.id).toBe("inst-1");
    });

    it("getOrCreateTaskInstance does not reuse across different Task Versions", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      const v2 = buildNextVersion({
        latestVersion: record.latestVersion,
        taskId: "task-1",
        draft: { ...taskVersion(), title: "v2" },
        createdAt: 2_000,
        source: source(),
      });
      await repo.appendTaskVersion(record, v2, record.revision);
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const available = new Map([["art-1", TEXT_BYTES]]);
      const v1Inst = taskInstance({ taskVersion: 1 });
      const { instance: created1 } = await repo.getOrCreateTaskInstance(v1Inst, available);
      expect(created1.taskVersion).toBe(1);
      const v2Inst = taskInstance({ id: "inst-2", taskVersion: 2 });
      const { instance: created2, reused } = await repo.getOrCreateTaskInstance(v2Inst, available);
      expect(reused).toBe(false);
      expect(created2.id).toBe("inst-2");
      expect(created2.taskVersion).toBe(2);
    });

    it("getOrCreateTaskInstance rejects metadata_only input as not reusable (no complete upgrade)", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      // No artifact bytes available → metadata_only.
      const candidate = taskInstance({ inputCompleteness: "metadata_only" });
      const available = new Map<string, Uint8Array>(); // empty
      const { instance: created, reused } = await repo.getOrCreateTaskInstance(candidate, available);
      expect(reused).toBe(false);
      expect(created.inputCompleteness).toBe("metadata_only");
      // A second metadata_only call does NOT reuse (metadata_only never establishes identity).
      const { instance: created2, reused: reused2 } = await repo.getOrCreateTaskInstance(
        { ...candidate, id: "inst-2" },
        available,
      );
      expect(reused2).toBe(false);
      expect(created2.id).toBe("inst-2");
    });

    it("getOrCreateTaskInstance rejects an instance referencing a missing Task or Version", async () => {
      const repo = makeRepo();
      const candidate = taskInstance({ taskId: "nope" });
      const available = new Map([["art-1", TEXT_BYTES]]);
      await expect(repo.getOrCreateTaskInstance(candidate, available)).rejects.toThrow(/not found/);
    });

    it("getOrCreateTaskInstance rejects an instance referencing a missing artifact", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const candidate = taskInstance();
      const available = new Map<string, Uint8Array>(); // missing art-1 bytes
      await expect(repo.getOrCreateTaskInstance(candidate, available)).rejects.toThrow(/artifact/);
    });

    it("getOrCreateTaskInstance rejects a digest collision (same inputDigest, different input)", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const available = new Map([["art-1", TEXT_BYTES]]);
      const candidate = taskInstance();
      await repo.getOrCreateTaskInstance(candidate, available);
      // A second instance with the same id-scoped inputDigest but different
      // normalizedInput text must NOT be silently reused; the repository must
      // detect the mismatch. We simulate by forcing the same inputDigest on a
      // different input and expecting a collision error or a new instance
      // (never a false reuse).
      const differentInput: TaskInstance = {
        ...candidate,
        id: "inst-2",
        normalizedInput: { ...candidate.normalizedInput, text: "Different text entirely." },
        // Force the same digest to simulate a collision attack.
        inputDigest: candidate.inputDigest,
      };
      // The repository recomputes the digest from the input; a forced mismatch
      // must be rejected, not silently reused.
      await expect(repo.getOrCreateTaskInstance(differentInput, available)).rejects.toThrow(
        /digest|collision/i,
      );
    });

    // --- family / facet assignment ------------------------------------------

    it("creates and lists families; updates under CAS; archives/restores", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily());
      const fam = (await repo.getTaskFamily("family-1"))!;
      expect(fam.name).toBe("Summarization");
      const rev = await repo.updateTaskFamily({ ...fam, name: "Summaries" }, fam.revision);
      expect(rev).toBe(1);
      expect((await repo.getTaskFamily("family-1"))!.name).toBe("Summaries");
      await repo.archiveTaskFamily("family-1", rev);
      expect((await repo.getTaskFamily("family-1"))!.archivedAt).not.toBeNull();
      const restoredRev = await repo.restoreTaskFamily("family-1", rev + 1);
      expect((await repo.getTaskFamily("family-1"))!.archivedAt).toBeNull();
      expect(restoredRev).toBe(rev + 2);
    });

    it("rejects family update with a stale revision", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily());
      const fam = (await repo.getTaskFamily("family-1"))!;
      await expect(repo.updateTaskFamily({ ...fam, name: "x" }, 999)).rejects.toThrow(/Stale|conflict/i);
    });

    it("assigns a family to a Task Version and enforces at most one primary", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.createTaskFamily(taskFamily());
      await repo.createTaskFamily(taskFamily({ id: "family-2", name: "Other" }));
      await repo.assignTaskFamily(familyAssignment({ id: "a1", familyId: "family-1", isPrimary: true }));
      // A second primary assignment for the same Task must demote the first.
      await repo.assignTaskFamily(
        familyAssignment({ id: "a2", familyId: "family-2", isPrimary: true }),
      );
      const assignments = await repo.listTaskFamilyAssignments("task-1");
      const primaries = assignments.filter((a) => a.isPrimary && a.archivedAt === null);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].familyId).toBe("family-2");
    });

    it("rejects family assignment referencing a missing Task, Version, or Family", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily());
      await expect(
        repo.assignTaskFamily(familyAssignment({ taskId: "nope" })),
      ).rejects.toThrow(/not found/);
      await repo.createTask(taskRecord(), taskVersion());
      await expect(
        repo.assignTaskFamily(familyAssignment({ familyId: "nope" })),
      ).rejects.toThrow(/not found/);
      await expect(
        repo.assignTaskFamily(familyAssignment({ taskVersion: 99 })),
      ).rejects.toThrow(/not found/);
    });

    it("annotates and lists task facets", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.annotateTaskFacet(facetAnnotation());
      const annotations = await repo.listTaskFacetAnnotations("task-1");
      expect(annotations).toHaveLength(1);
      expect(annotations[0].facetId).toBe("domain");
    });

    it("rejects facet annotation referencing a missing Task or Version", async () => {
      const repo = makeRepo();
      await expect(
        repo.annotateTaskFacet(facetAnnotation({ taskId: "nope" })),
      ).rejects.toThrow(/not found/);
      await repo.createTask(taskRecord(), taskVersion());
      await expect(
        repo.annotateTaskFacet(facetAnnotation({ taskVersion: 99 })),
      ).rejects.toThrow(/not found/);
    });

    // --- deterministic paginated queries ------------------------------------

    it("lists tasks deterministically by updatedAt desc with pagination", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord({ id: "t1", createdAt: 100 }), taskVersion({ taskId: "t1" }));
      await repo.createTask(
        taskRecord({ id: "t2", createdAt: 200 }),
        taskVersion({ taskId: "t2" }),
      );
      await repo.createTask(
        taskRecord({ id: "t3", createdAt: 300 }),
        taskVersion({ taskId: "t3" }),
      );
      const query: TaskListQuery = { limit: 2, offset: 0 };
      const page1 = await repo.listTasks(query);
      expect(page1.map((t) => t.id)).toEqual(["t3", "t2"]);
      const page2 = await repo.listTasks({ limit: 2, offset: 2 });
      expect(page2.map((t) => t.id)).toEqual(["t1"]);
    });

    it("listTasks excludes archived by default and includes them when requested", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord({ id: "t1", createdAt: 100 }), taskVersion({ taskId: "t1" }));
      await repo.createTask(
        taskRecord({ id: "t2", createdAt: 200 }),
        taskVersion({ taskId: "t2" }),
      );
      const t1 = (await repo.getTaskRecord("t1"))!;
      await repo.archiveTask("t1", t1.revision);
      const active = await repo.listTasks({});
      expect(active.map((t) => t.id)).toEqual(["t2"]);
      const all = await repo.listTasks({ includeArchived: true });
      expect(all.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    });

    it("listTasks filters by origin", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t1", origin: "authored" }),
        taskVersion({ taskId: "t1" }),
      );
      await repo.createTask(
        taskRecord({ id: "t2", origin: "legacy-task-set" }),
        taskVersion({ taskId: "t2" }),
      );
      const legacy = await repo.listTasks({ origin: "legacy-task-set" });
      expect(legacy.map((t) => t.id)).toEqual(["t2"]);
    });

    it("lists task instances for a Task, optionally scoped to a version", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      const v2 = buildNextVersion({
        latestVersion: record.latestVersion,
        taskId: "task-1",
        draft: { ...taskVersion(), title: "v2" },
        createdAt: 2_000,
        source: source(),
      });
      await repo.appendTaskVersion(record, v2, record.revision);
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const available = new Map([["art-1", TEXT_BYTES]]);
      await repo.getOrCreateTaskInstance(taskInstance({ taskVersion: 1 }), available);
      await repo.getOrCreateTaskInstance(
        taskInstance({ id: "inst-2", taskVersion: 2 }),
        available,
      );
      const all = await repo.listTaskInstances("task-1");
      expect(all).toHaveLength(2);
      const v1Only = await repo.listTaskInstances("task-1", 1);
      expect(v1Only).toHaveLength(1);
      expect(v1Only[0].taskVersion).toBe(1);
    });

    // --- classified storage failures ----------------------------------------

    it("rejects invalid inputs with StorageError validation kind", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTask({ ...taskRecord(), latestVersion: -1 } as unknown as TaskRecord, taskVersion()),
      ).rejects.toMatchObject({ name: "StorageError", kind: "validation" });
    });

    it("rejects conflicts with StorageError conflict kind", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const err = await repo
        .createTask(taskRecord(), taskVersion())
        .catch((e) => e as { name: string; kind: string });
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
    });

    // --- referenced-version protection seam ---------------------------------

    it("does not expose a deleteTaskVersion API (referenced versions are protected)", () => {
      const repo = makeRepo();
      // The repository interface must not expose a deleteTaskVersion method:
      // spec §4.4 prohibits deleting a referenced version, and the contract
      // seam is the absence of the API.
      expect((repo as unknown as Record<string, unknown>).deleteTaskVersion).toBeUndefined();
      expect((repo as unknown as Record<string, unknown>).deleteTask).toBeUndefined();
    });
  });
}

repositorySuite("InMemoryTaskRepository", () => new InMemoryTaskRepository());

// --- Dexie suite with clean + legacy open/upgrade coverage -------------------

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    try {
      db.close();
    } catch {
      // best-effort
    }
    try {
      await db.delete();
    } catch {
      // best-effort
    }
  }
});

repositorySuite("Dexie task repository", () => {
  const db = new RSembleEvaluationDB(`task-test-${crypto.randomUUID()}`);
  dbs.push(db);
  return createTaskRepository(db);
});

// --- clean + legacy database open/upgrade coverage (Dexie-only) --------------

describe("Dexie task repository schema upgrade", () => {
  it("opens a fresh v3 database cleanly with all Task stores present", async () => {
    const db = new RSembleEvaluationDB(`task-clean-${crypto.randomUUID()}`);
    dbs.push(db);
    await db.open();
    // All v1, v2, and v3 stores exist.
    expect(db.tables.some((t) => t.name === "tasks")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskVersions")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskArtifacts")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskInstances")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskFamilies")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskFamilyAssignments")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskFacetAnnotations")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskMigrationCrosswalk")).toBe(true);
    // v1/v2 stores still present.
    expect(db.tables.some((t) => t.name === "runSummaries")).toBe(true);
    expect(db.tables.some((t) => t.name === "fusionRecipes")).toBe(true);
  });

  it("upgrades a v1-seeded database to v3 additively without losing v1 rows", async () => {
    const dbName = `task-legacy-${crypto.randomUUID()}`;
    // Seed a v1-only database using a plain Dexie instance pinned to v1.
    const v1 = new Dexie(dbName);
    v1.version(1).stores({
      runSummaries: "id, kind, revision, createdAt, completedAt, status, mode, sourceKind, sourceProtocolFingerprint, sourceExperimentTaskAttemptId, *modelKeys",
      runDetails: "id, revision, createdAt, status",
      profiles: "id, revision, latestVersion, updatedAt, archivedAt",
      profileVersions: "[id+version], id, version, updatedAt",
      suites: "id, revision, version, updatedAt, archivedAt",
      experiments: "id, revision, suiteId, suiteVersion, protocolFingerprint, createdAt, status",
      storageMeta: "key",
    });
    await v1.open();
    await v1.table("runSummaries").put({
      kind: "full",
      summary: { id: "run-legacy", searchText: "legacy" },
      id: "run-legacy",
      revision: 0,
      createdAt: 1,
      completedAt: null,
      status: "completed",
      mode: "compare",
      sourceKind: "adhoc",
      sourceProtocolFingerprint: null,
      sourceExperimentTaskAttemptId: null,
      modelKeys: ["m1"],
    });
    v1.close();

    // Reopen with the full RSembleEvaluationDB (declares v1, v2, v3).
    const db = new RSembleEvaluationDB(dbName);
    dbs.push(db);
    await db.open();
    // v1 row survived the additive upgrade.
    const row = await db.runSummaries.get("run-legacy");
    expect(row?.id).toBe("run-legacy");
    // v3 Task stores are now present.
    expect(db.tables.some((t) => t.name === "tasks")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskMigrationCrosswalk")).toBe(true);
  });
});
