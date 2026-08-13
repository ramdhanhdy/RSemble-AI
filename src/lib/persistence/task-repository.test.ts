// =============================================================================
// RSemble AI — Canonical Task repository contract tests (Dexie + in-memory)
//
// Child 02 (Canonical Tasks) Milestone B — Task 3 (RED first), extended in
// Task 6 with catalog query semantics (spec §7.1):
//   - `search` matches Task latest-version title OR objective
//     (case-insensitive substring), composed with origin/archive/pagination;
//   - `familyId` filters Tasks by their primary family assignment;
//   - combined search + family + pagination stays deterministic.
//
// The existing Task 3 coverage (atomic create, CAS append, archive/restore,
// artifact byte equality, instance reuse, classified errors, and the
// referenced-version protection seam) is preserved unchanged below.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";

import { RSembleEvaluationDB } from "./database";
import {
  createTaskRepository,
  type TaskRepository,
  type TaskFamilyRelationRepository,
  type TaskListQuery,
} from "./task-repository";
import { InMemoryTaskRepository } from "./in-memory-task-repository";

import {
  artifactsByteEqual,
  buildTaskArtifact,
  computeArtifactDigest,
  computeInstanceInputDigest,
} from "../tasks/task-instance";
import {
  buildInitialTaskRecord,
  buildNextVersion,
  duplicateTaskRecord,
} from "../tasks/task-versioning";
import type {
  ContextManifestEntry,
  NormalizedTaskInput,
  TaskArtifact,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
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

function instanceSourceRef(overrides: Partial<TaskInstanceSourceRef> = {}): TaskInstanceSourceRef {
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
  const base: TaskInstance = {
    id: "inst-1",
    taskId: "task-1",
    taskVersion: 1,
    normalizedInput: normalizedInput(),
    contextManifest: [manifestEntry()],
    inputDigest: DIGEST_A, // placeholder; recomputed below
    inputCompleteness: "complete",
    createdAt: NOW,
    sourceRef: instanceSourceRef(),
  };
  const merged = { ...base, ...overrides };
  // Recompute the real input digest so the repository's integrity check passes
  // (the repo recomputes from the input and rejects a mismatched caller digest).
  merged.inputDigest = overrides.inputDigest ?? computeInstanceInputDigest(merged);
  return merged;
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

function familyRelation(overrides: Partial<TaskFamilyRelation> = {}): TaskFamilyRelation {
  return {
    id: "rel-1",
    fromFamilyId: "family-1",
    toFamilyId: "family-2",
    kind: "overlap",
    createdAt: NOW,
    ...overrides,
  };
}

const TEXT_BYTES = new TextEncoder().encode("hello world");

// --- shared contract suite ---------------------------------------------------

export function repositorySuite(
  name: string,
  makeRepo: () => TaskRepository & TaskFamilyRelationRepository & object,
) {
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
      await expect(repo.createTask(taskRecord(), taskVersion({ version: 2 }))).rejects.toThrow(
        /version.*1/,
      );
    });

    it("rejects createTask with an invalid record (validation)", async () => {
      const repo = makeRepo();
      const err = (await repo
        .createTask({ ...taskRecord(), id: "" }, taskVersion())
        .catch((e) => e as { name: string; kind: string }))!;
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("validation");
    });

    it("rejects createTask carrying prohibited credential keys", async () => {
      const repo = makeRepo();
      const bad = { ...taskRecord(), apiKey: "sk-leak" } as unknown as TaskRecord;
      await expect(repo.createTask(bad, taskVersion())).rejects.toThrow(/prohibited|validation/i);
    });

    // --- Task 7: long fields survive intact through create -----------------

    it("persists very long title/objective/instruction fields without truncation", async () => {
      const repo = makeRepo();
      const longTitle = `Long ${"T".repeat(8000)}`;
      const longObjective = `Even longer ${"O".repeat(32000)}`;
      const longInstruction = `Instruction ${"I".repeat(16000)}`;
      await repo.createTask(
        taskRecord(),
        taskVersion({
          title: longTitle,
          objective: longObjective,
          candidateInstruction: longInstruction,
        }),
      );
      const got = await repo.getTaskVersion("task-1", 1);
      expect(got?.title).toBe(longTitle);
      expect(got?.objective).toBe(longObjective);
      expect(got?.candidateInstruction).toBe(longInstruction);
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
      await expect(repo.appendTaskVersion(record, nextDraft, 999)).rejects.toThrow(
        /Stale|conflict/i,
      );
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
      await expect(repo.appendTaskVersion(record, taskVersion({ version: 2 }), 0)).rejects.toThrow(
        /not found/,
      );
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
      const { instance: created, reused } = await repo.getOrCreateTaskInstance(
        candidate,
        available,
      );
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
      // The artifact exists (referential integrity) but no bytes are available
      // in this call → the instance is metadata_only and never reused.
      const artifact = buildTaskArtifact({
        id: "art-1",
        bytes: TEXT_BYTES,
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: NOW,
      });
      await repo.putTaskArtifact(artifact, TEXT_BYTES);
      const candidate = taskInstance({ inputCompleteness: "metadata_only" });
      const available = new Map<string, Uint8Array>(); // empty — no bytes available
      const { instance: created, reused } = await repo.getOrCreateTaskInstance(
        candidate,
        available,
      );
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
      await expect(repo.getOrCreateTaskInstance(candidate, available)).rejects.toThrow(/artifact/i);
    });

    it("getOrCreateTaskInstance rejects empty available bytes for a referenced artifact", async () => {
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
      // Caller supplies an empty Uint8Array for art-1 — must be rejected, not
      // silently treated as "complete".
      const emptyMap = new Map<string, Uint8Array>([["art-1", new Uint8Array(0)]]);
      await expect(repo.getOrCreateTaskInstance(candidate, emptyMap)).rejects.toThrow(
        /available bytes are empty/,
      );
    });

    it("getOrCreateTaskInstance rejects wrong available bytes for a referenced artifact", async () => {
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
      // Caller supplies wrong bytes (different content) — must be rejected.
      const wrongBytes = new TextEncoder().encode("totally different content");
      const wrongMap = new Map<string, Uint8Array>([["art-1", wrongBytes]]);
      await expect(repo.getOrCreateTaskInstance(candidate, wrongMap)).rejects.toThrow(
        /available bytes do not match/,
      );
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
      await expect(repo.updateTaskFamily({ ...fam, name: "x" }, 999)).rejects.toThrow(
        /Stale|conflict/i,
      );
    });

    it("assigns a family to a Task Version and enforces at most one primary", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.createTaskFamily(taskFamily());
      await repo.createTaskFamily(taskFamily({ id: "family-2", name: "Other" }));
      await repo.assignTaskFamily(
        familyAssignment({ id: "a1", familyId: "family-1", isPrimary: true }),
      );
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
      await expect(repo.assignTaskFamily(familyAssignment({ taskId: "nope" }))).rejects.toThrow(
        /not found/,
      );
      await repo.createTask(taskRecord(), taskVersion());
      await expect(repo.assignTaskFamily(familyAssignment({ familyId: "nope" }))).rejects.toThrow(
        /not found/,
      );
      await expect(repo.assignTaskFamily(familyAssignment({ taskVersion: 99 }))).rejects.toThrow(
        /not found/,
      );
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
      await expect(repo.annotateTaskFacet(facetAnnotation({ taskId: "nope" }))).rejects.toThrow(
        /not found/,
      );
      await repo.createTask(taskRecord(), taskVersion());
      await expect(repo.annotateTaskFacet(facetAnnotation({ taskVersion: 99 }))).rejects.toThrow(
        /not found/,
      );
    });

    // --- Task 8B: facet annotation provenance integrity (spec §3.6) ---------

    it("rejects a facet annotation whose supersedesId is unknown", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await expect(
        repo.annotateTaskFacet(facetAnnotation({ supersedesId: "missing-annotation" })),
      ).rejects.toThrow(/not found/i);
    });

    it("rejects a facet annotation superseding an annotation of a different Task", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.createTask(taskRecord({ id: "task-2" }), taskVersion({ taskId: "task-2" }));
      await repo.annotateTaskFacet(facetAnnotation({ id: "ann-other", taskId: "task-2" }));
      await expect(
        repo.annotateTaskFacet(facetAnnotation({ supersedesId: "ann-other" })),
      ).rejects.toThrow(/not found|same task/i);
    });

    it("accepts an annotation superseding an existing annotation of the same Task", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.annotateTaskFacet(facetAnnotation({ id: "ann-1" }));
      await repo.annotateTaskFacet(
        facetAnnotation({ id: "ann-2", valueId: "code", supersedesId: "ann-1" }),
      );
      const annotations = await repo.listTaskFacetAnnotations("task-1");
      expect(annotations.map((a) => a.id)).toEqual(["ann-1", "ann-2"]);
      expect(annotations[1].supersedesId).toBe("ann-1");
      // Supersession appends — the superseded annotation is not mutated.
      expect(annotations[0]).toMatchObject({ id: "ann-1", valueId: "nlp" });
    });

    // --- deterministic paginated queries ------------------------------------

    it("lists tasks deterministically by updatedAt desc with pagination", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t1", createdAt: 100 }),
        taskVersion({ taskId: "t1" }),
      );
      await repo.createTask(
        taskRecord({ id: "t2", createdAt: 200 }),
        taskVersion({ taskId: "t2" }),
      );
      await repo.createTask(
        taskRecord({ id: "t3", createdAt: 300 }),
        taskVersion({ taskId: "t3" }),
      );
      await repo.createTask(
        taskRecord({ id: "t4", createdAt: 400 }),
        taskVersion({ taskId: "t4" }),
      );
      const query: TaskListQuery = { limit: 2, offset: 0 };
      const page1 = await repo.listTasks(query);
      expect(page1.map((t) => t.id)).toEqual(["t4", "t3"]);
      const page2 = await repo.listTasks({ limit: 2, offset: 2 });
      expect(page2.map((t) => t.id)).toEqual(["t2", "t1"]);
    });

    it("listTasks excludes archived by default and includes them when requested", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t1", createdAt: 100 }),
        taskVersion({ taskId: "t1" }),
      );
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
      await repo.getOrCreateTaskInstance(taskInstance({ id: "inst-2", taskVersion: 2 }), available);
      const all = await repo.listTaskInstances("task-1");
      expect(all).toHaveLength(2);
      const v1Only = await repo.listTaskInstances("task-1", 1);
      expect(v1Only).toHaveLength(1);
      expect(v1Only[0].taskVersion).toBe(1);
    });

    it("lists every stored version for a Task in deterministic version order", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.appendTaskVersion(
        { ...taskRecord(), latestVersion: 2, revision: 0 },
        taskVersion({ version: 2, title: "Summarize a longer report" }),
        0,
      );
      const versions = await repo.listTaskVersions("task-1");
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      expect(versions[1].title).toBe("Summarize a longer report");
      expect(await repo.listTaskVersions("missing")).toEqual([]);
    });

    it("lists migration crosswalks for a Task in deterministic key order", async () => {
      const repo = makeRepo() as TaskRepository & {
        putTaskMigrationCrosswalk?(row: {
          legacyScopeKey: string;
          taskId: string;
          taskVersion: number;
        }): Promise<void>;
      };
      await repo.createTask(taskRecord(), taskVersion());
      expect(repo.putTaskMigrationCrosswalk).toEqual(expect.any(Function));
      const digestA = "sha256:" + "a".repeat(64);
      const digestB = "sha256:" + "b".repeat(64);
      const digestC = "sha256:" + "c".repeat(64);
      await repo.putTaskMigrationCrosswalk!({
        legacyScopeKey: `suite-b::v2::t1::${digestB}`,
        taskId: "task-1",
        taskVersion: 1,
      });
      await repo.putTaskMigrationCrosswalk!({
        legacyScopeKey: `suite-a::v1::t1::${digestA}`,
        taskId: "task-1",
        taskVersion: 1,
      });
      await repo.putTaskMigrationCrosswalk!({
        legacyScopeKey: `suite-c::v3::t9::${digestC}`,
        taskId: "task-other",
        taskVersion: 2,
      });
      const listed = await repo.listTaskMigrationCrosswalks("task-1");
      expect(listed.map((row) => row.legacyScopeKey)).toEqual([
        `suite-a::v1::t1::${digestA}`,
        `suite-b::v2::t1::${digestB}`,
      ]);
      expect(listed.every((row) => row.taskId === "task-1" && row.taskVersion === 1)).toBe(true);
      expect(await repo.listTaskMigrationCrosswalks("missing")).toEqual([]);
    });

    // --- catalog search + family filters (spec §7.1, Task 6) -----------------

    it("listTasks search matches the latest-version title (case-insensitive)", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-alpha", createdAt: 100 }),
        taskVersion({ taskId: "t-alpha", title: "Summarize a quarterly report" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-beta", createdAt: 200 }),
        taskVersion({ taskId: "t-beta", title: "Draft release notes" }),
      );
      const hits = await repo.listTasks({ search: "SUMMARIZE" });
      expect(hits.map((t) => t.id)).toEqual(["t-alpha"]);
    });

    it("listTasks search matches the latest-version objective and ignores candidate instruction", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-gamma", createdAt: 100 }),
        taskVersion({
          taskId: "t-gamma",
          title: "Email triage",
          objective: "Classify inbound customer emails by intent.",
          candidateInstruction: "You are an email classifier. Read the email body.",
        }),
      );
      await repo.createTask(
        taskRecord({ id: "t-delta", createdAt: 200 }),
        taskVersion({
          taskId: "t-delta",
          title: "Meeting notes",
          objective: "Condense a transcript into action items.",
          candidateInstruction: "Classify each action item by owner.",
        }),
      );
      // Objective match.
      const objectiveHits = await repo.listTasks({ search: "action items" });
      expect(objectiveHits.map((t) => t.id)).toEqual(["t-delta"]);
      // Candidate-instruction-only text is NOT part of the searchable surface —
      // search is over the candidate-visible objective/title identity fields.
      const instructionOnly = await repo.listTasks({ search: "email body" });
      expect(instructionOnly.map((t) => t.id)).toEqual([]);
    });

    it("listTasks search composes with archive state and pagination deterministically", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-a", createdAt: 100 }),
        taskVersion({ taskId: "t-a", title: "Report alpha" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-b", createdAt: 200 }),
        taskVersion({ taskId: "t-b", title: "Report beta" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-c", createdAt: 300 }),
        taskVersion({ taskId: "t-c", title: "Report gamma" }),
      );
      const first = (await repo.getTaskRecord("t-a"))!;
      await repo.archiveTask("t-a", first.revision);
      // Archived task excluded by default even though it matches the search.
      const page1 = await repo.listTasks({ search: "report", limit: 1, offset: 0 });
      expect(page1.map((t) => t.id)).toEqual(["t-c"]);
      const page2 = await repo.listTasks({ search: "report", limit: 1, offset: 1 });
      expect(page2.map((t) => t.id)).toEqual(["t-b"]);
      // includeArchived surfaces the archived match too. Archiving bumps
      // updatedAt, so the archived row sorts first under updatedAt desc.
      const all = await repo.listTasks({ search: "report", includeArchived: true });
      expect(all.map((t) => t.id)).toEqual(["t-a", "t-c", "t-b"]);
    });

    it("listTasks treats empty/whitespace search as no filter", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-one", createdAt: 100 }),
        taskVersion({ taskId: "t-one", title: "One" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-two", createdAt: 200 }),
        taskVersion({ taskId: "t-two", title: "Two" }),
      );
      const all = await repo.listTasks({ search: "   " });
      expect(all.map((t) => t.id)).toEqual(["t-two", "t-one"]);
    });

    it("listTasks filters by primary familyId assignment", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-1", createdAt: 100 }),
        taskVersion({ taskId: "t-1" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-2", createdAt: 200 }),
        taskVersion({ taskId: "t-2" }),
      );
      await repo.createTaskFamily(taskFamily({ id: "fam-summaries", name: "Summaries" }));
      await repo.assignTaskFamily(
        familyAssignment({ id: "asgn-1", taskId: "t-1", familyId: "fam-summaries" }),
      );
      const inFamily = await repo.listTasks({ familyId: "fam-summaries" });
      expect(inFamily.map((t) => t.id)).toEqual(["t-1"]);
      // An unknown family id yields nothing.
      const none = await repo.listTasks({ familyId: "fam-missing" });
      expect(none).toEqual([]);
    });

    it("listTasks combines search + familyId + pagination", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-1", createdAt: 100 }),
        taskVersion({ taskId: "t-1", title: "Summarize contracts" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-2", createdAt: 200 }),
        taskVersion({ taskId: "t-2", title: "Summarize reports" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-3", createdAt: 300 }),
        taskVersion({ taskId: "t-3", title: "Transcribe calls" }),
      );
      await repo.createTaskFamily(taskFamily({ id: "fam-x", name: "X" }));
      await repo.assignTaskFamily(
        familyAssignment({ id: "asg-1", taskId: "t-1", familyId: "fam-x" }),
      );
      await repo.assignTaskFamily(
        familyAssignment({ id: "asg-2", taskId: "t-2", familyId: "fam-x" }),
      );
      await repo.assignTaskFamily(
        familyAssignment({ id: "asg-3", taskId: "t-3", familyId: "fam-x" }),
      );
      // "summarize" matches t-1/t-2 (t-3 excluded by search); family keeps t-1/t-2/t-3;
      // combined → t-2, t-1 in updatedAt order; pagination slices after filtering.
      const page1 = await repo.listTasks({ search: "summarize", familyId: "fam-x", limit: 1 });
      expect(page1.map((t) => t.id)).toEqual(["t-2"]);
      const page2 = await repo.listTasks({
        search: "summarize",
        familyId: "fam-x",
        limit: 1,
        offset: 1,
      });
      expect(page2.map((t) => t.id)).toEqual(["t-1"]);
    });

    // --- Task 8B: archive-state and facet filters (spec §7.1) ---------------

    it("listTasks archiveState 'archived' returns only archived Tasks", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-live", createdAt: 100 }),
        taskVersion({ taskId: "t-live" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-archived", createdAt: 200 }),
        taskVersion({ taskId: "t-archived" }),
      );
      const rec = (await repo.getTaskRecord("t-archived"))!;
      await repo.archiveTask("t-archived", rec.revision);
      const archived = await repo.listTasks({ archiveState: "archived" });
      expect(archived.map((t) => t.id)).toEqual(["t-archived"]);
      const all = await repo.listTasks({ archiveState: "all" });
      expect(all.map((t) => t.id).sort()).toEqual(["t-archived", "t-live"]);
      const active = await repo.listTasks({ archiveState: "active" });
      expect(active.map((t) => t.id)).toEqual(["t-live"]);
    });

    it("listTasks filters by facet annotation (facetId + valueId)", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-nlp", createdAt: 100 }),
        taskVersion({ taskId: "t-nlp" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-code", createdAt: 200 }),
        taskVersion({ taskId: "t-code" }),
      );
      await repo.annotateTaskFacet(facetAnnotation({ taskId: "t-nlp" }));
      await repo.annotateTaskFacet(
        facetAnnotation({ id: "ann-code", taskId: "t-code", valueId: "code" }),
      );
      const nlp = await repo.listTasks({ facetId: "domain", facetValueId: "nlp" });
      expect(nlp.map((t) => t.id)).toEqual(["t-nlp"]);
      // A value with no annotation yields nothing — the filter is exact.
      const none = await repo.listTasks({ facetId: "domain", facetValueId: "multimodal" });
      expect(none).toEqual([]);
    });

    it("listTasks facet filter composes with search and archive state", async () => {
      const repo = makeRepo();
      await repo.createTask(
        taskRecord({ id: "t-a", createdAt: 100 }),
        taskVersion({ taskId: "t-a", title: "Summarize contracts" }),
      );
      await repo.createTask(
        taskRecord({ id: "t-b", createdAt: 200 }),
        taskVersion({ taskId: "t-b", title: "Summarize reports" }),
      );
      await repo.annotateTaskFacet(facetAnnotation({ taskId: "t-a" }));
      await repo.annotateTaskFacet(facetAnnotation({ id: "ann-b", taskId: "t-b" }));
      const recB = (await repo.getTaskRecord("t-b"))!;
      await repo.archiveTask("t-b", recB.revision);
      // Archived t-b is excluded by default even though it matches facet+search.
      const active = await repo.listTasks({
        search: "summarize",
        facetId: "domain",
        facetValueId: "nlp",
      });
      expect(active.map((t) => t.id)).toEqual(["t-a"]);
      // archiveState 'all' brings the archived match back.
      const all = await repo.listTasks({
        search: "summarize",
        facetId: "domain",
        facetValueId: "nlp",
        archiveState: "all",
      });
      expect(all.map((t) => t.id)).toEqual(["t-b", "t-a"]);
    });

    // --- classified storage failures ----------------------------------------

    it("rejects invalid inputs with StorageError validation kind", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTask(
          { ...taskRecord(), latestVersion: -1 } as unknown as TaskRecord,
          taskVersion(),
        ),
      ).rejects.toMatchObject({ name: "StorageError", kind: "validation" });
    });

    it("rejects conflicts with StorageError conflict kind", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const err = (await repo
        .createTask(taskRecord(), taskVersion())
        .catch((e) => e as { name: string; kind: string }))!;
      expect(err.name).toBe("StorageError");
      expect(err.kind).toBe("conflict");
    });

    // --- Task 7: duplicate as a new authored identity (spec §7.3) -----------
    //
    // Duplicate is a pure-repository concern: the always-auth builders
    // produce a brand-new TaskRecord + version 1, and createTask persists
    // them as an independent identity — never an implied version of the
    // source and never carrying the source's lineage.

    it("duplicates a Task as a new authored identity with its own version 1", async () => {
      const repo = makeRepo();
      // Source with two versions so "implied version of the source" is
      // distinguishable from a fresh lineage.
      await repo.createTask(taskRecord(), taskVersion());
      const record = (await repo.getTaskRecord("task-1"))!;
      const v1 = (await repo.getTaskVersion("task-1", 1))!;
      const v2 = buildNextVersion({
        latestVersion: 1,
        taskId: "task-1",
        draft: { ...v1, title: "Second cut" },
        createdAt: NOW + 1,
        source: source(),
      });
      await repo.appendTaskVersion(record, v2, record.revision);

      const sourceRecord = (await repo.getTaskRecord("task-1"))!; // revision advanced
      const now = NOW + 2;
      const copy = duplicateTaskRecord({
        source: sourceRecord,
        newId: "task-copy",
        createdAt: now,
      });
      // The duplicate version rebinds the latest source content to the new
      // identity at version 1, with explicit authored provenance (spec §7.3:
      // "never becomes a version of the source by implication").
      const copyV1: TaskVersion = {
        ...v2,
        taskId: "task-copy",
        version: 1,
        createdAt: now,
        defaultContextManifest: v2.defaultContextManifest.map((entry) => ({ ...entry })),
        responseContract: v2.responseContract
          ? { ...v2.responseContract, constraints: [...v2.responseContract.constraints] }
          : null,
        taskVerifierRef: v2.taskVerifierRef ? { ...v2.taskVerifierRef } : null,
        source: { kind: "authored", legacyScopeKey: null, note: "Duplicated from task-1" },
      };
      await repo.createTask(copy, copyV1);

      const gotRecord = (await repo.getTaskRecord("task-copy"))!;
      expect(gotRecord.origin).toBe("authored");
      expect(gotRecord.latestVersion).toBe(1);
      expect(gotRecord.revision).toBe(0);
      expect(gotRecord.archivedAt).toBeNull();
      const gotV1 = (await repo.getTaskVersion("task-copy", 1))!;
      expect(gotV1.title).toBe("Second cut");
      expect(gotV1.taskId).toBe("task-copy");
      expect(gotV1.source.kind).toBe("authored");
      // The copy's lineage ends at its own version 1: the source's version 2
      // is not addressable under the new identity.
      expect(await repo.getTaskVersion("task-copy", 2)).toBeNull();
      // And the source is untouched.
      expect((await repo.getTaskRecord("task-1"))!.latestVersion).toBe(2);
    });

    it("duplicateTaskRecord does not mutate the source record and origin stays authored", async () => {
      const original = { ...taskRecord({ id: "task-src" }), revision: 7, latestVersion: 3 };
      const copy = duplicateTaskRecord({ source: original, newId: "task-dup", createdAt: NOW });
      expect(copy.id).toBe("task-dup");
      expect(copy.latestVersion).toBe(1);
      expect(copy.revision).toBe(0);
      // Pure: the source record is unchanged.
      expect(original.revision).toBe(7);
      expect(original.latestVersion).toBe(3);
      expect(original.id).toBe("task-src");
    });

    it("committing a new version on the duplicate never touches the source lineage", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const sourceRecord = (await repo.getTaskRecord("task-1"))!;
      const copy = duplicateTaskRecord({
        source: sourceRecord,
        newId: "task-copy",
        createdAt: NOW + 5,
      });
      const sourceV1 = (await repo.getTaskVersion("task-1", 1))!;
      const copyV1: TaskVersion = {
        ...sourceV1,
        taskId: "task-copy",
        version: 1,
        createdAt: NOW + 5,
        defaultContextManifest: sourceV1.defaultContextManifest.map((entry) => ({ ...entry })),
        source: source(),
      };
      await repo.createTask(copy, copyV1);
      // The duplicate evolves independently: appending its own version 2 must
      // not leak into the source's history or versions.
      const appended = buildNextVersion({
        latestVersion: 1,
        taskId: "task-copy",
        draft: { ...copyV1, title: "copy v2" },
        createdAt: NOW + 6,
        source: source(),
      });
      await repo.appendTaskVersion(copy, appended, copy.revision);
      expect((await repo.getTaskRecord("task-copy"))!.latestVersion).toBe(2);
      expect((await repo.getTaskRecord("task-1"))!.latestVersion).toBe(1);
      expect((await repo.getTaskVersion("task-1", 1))!.title).toBe(sourceV1.title);
    });

    // --- Task 7: archive/restore revision CAS rounds -----------------------

    it("alternating archive/restore rounds keep revisions monotonic", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      const r1 = await repo.archiveTask("task-1", 0);
      expect(r1).toBe(1);
      const r2 = await repo.restoreTask("task-1", r1);
      expect(r2).toBe(2);
      const r3 = await repo.archiveTask("task-1", r2);
      expect(r3).toBe(3);
      const r4 = await repo.restoreTask("task-1", r3);
      expect(r4).toBe(4);
      const got = (await repo.getTaskRecord("task-1"))!;
      expect(got.archivedAt).toBeNull();
      expect(got.revision).toBe(4);
    });

    it("rejects a stale restore revision as a conflict", async () => {
      const repo = makeRepo();
      await repo.createTask(taskRecord(), taskVersion());
      await repo.archiveTask("task-1", 0);
      await expect(repo.restoreTask("task-1", 999)).rejects.toThrow(/Stale|conflict/i);
      // Nothing half-restored.
      const got = (await repo.getTaskRecord("task-1"))!;
      expect(got.archivedAt).not.toBeNull();
      expect(got.revision).toBe(1);
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

    // --- Task 8A: typed family relations (spec §3.5) -----------------------

    it("creates and lists a typed family relation with deterministic order", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-1" }));
      await repo.createTaskFamily(taskFamily({ id: "family-2" }));
      await repo.createTaskFamilyRelation(familyRelation({ id: "rel-1", createdAt: NOW + 1 }));
      await repo.createTaskFamilyRelation(familyRelation({ id: "rel-2", createdAt: NOW }));
      const relations = await repo.listTaskFamilyRelations();
      expect(relations).toHaveLength(2);
      // Deterministic order: createdAt asc, id tiebreak.
      expect(relations.map((r) => r.id)).toEqual(["rel-2", "rel-1"]);
    });

    it("rejects creating a relation with a duplicate id (no silent overwrite)", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-1" }));
      await repo.createTaskFamily(taskFamily({ id: "family-2" }));
      await repo.createTaskFamilyRelation(familyRelation({ id: "rel-1" }));
      await expect(repo.createTaskFamilyRelation(familyRelation({ id: "rel-1" }))).rejects.toThrow(
        /already exists|conflict/i,
      );
      // The original relation is untouched.
      const relations = await repo.listTaskFamilyRelations();
      expect(relations).toHaveLength(1);
    });

    it("rejects a relation referencing an unknown fromFamilyId", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-2" }));
      await expect(
        repo.createTaskFamilyRelation(familyRelation({ fromFamilyId: "no-such-family" })),
      ).rejects.toThrow(/not found/);
    });

    it("rejects a relation referencing an unknown toFamilyId", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-1" }));
      await expect(
        repo.createTaskFamilyRelation(familyRelation({ toFamilyId: "no-such-family" })),
      ).rejects.toThrow(/not found/);
    });

    it("rejects a self-relation (fromFamilyId === toFamilyId)", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-1" }));
      await expect(
        repo.createTaskFamilyRelation(
          familyRelation({ fromFamilyId: "family-1", toFamilyId: "family-1" }),
        ),
      ).rejects.toThrow(/self|validation/i);
    });

    it("rejects a relation with an unknown kind", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-1" }));
      await repo.createTaskFamily(taskFamily({ id: "family-2" }));
      await expect(
        repo.createTaskFamilyRelation(familyRelation({ kind: "subset" as never })),
      ).rejects.toThrow(/kind|validation/i);
    });

    it("rejects a relation carrying prohibited credential keys", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "family-1" }));
      await repo.createTaskFamily(taskFamily({ id: "family-2" }));
      const bad = { ...familyRelation(), apiKey: "sk-leak" } as unknown as TaskFamilyRelation;
      await expect(repo.createTaskFamilyRelation(bad)).rejects.toThrow(/prohibited|validation/i);
    });

    // --- Task 8B: family parent validity and cycles (spec §3.5) -------------

    it("rejects creating a family whose parentFamilyId is itself (direct self-cycle)", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTaskFamily(taskFamily({ id: "fam-self", parentFamilyId: "fam-self" })),
      ).rejects.toThrow(/cycle|itself/i);
      expect(await repo.getTaskFamily("fam-self")).toBeNull();
    });

    it("rejects creating a family whose parent does not exist (invalid parent)", async () => {
      const repo = makeRepo();
      await expect(
        repo.createTaskFamily(taskFamily({ id: "fam-orphan", parentFamilyId: "fam-missing" })),
      ).rejects.toThrow(/not found/i);
      expect(await repo.getTaskFamily("fam-orphan")).toBeNull();
    });

    it("rejects creating a family that would form a two-hop parent cycle", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "fam-a" }));
      await repo.createTaskFamily(taskFamily({ id: "fam-b", parentFamilyId: "fam-a" }));
      // fam-a → parent fam-b → parent fam-a would close the loop.
      const famA = (await repo.getTaskFamily("fam-a"))!;
      await expect(
        repo.updateTaskFamily({ ...famA, parentFamilyId: "fam-b" }, famA.revision),
      ).rejects.toThrow(/cycle/i);
      expect((await repo.getTaskFamily("fam-a"))!.parentFamilyId).toBeNull();
    });

    it("rejects updating a family's parent to itself", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "fam-a" }));
      const famA = (await repo.getTaskFamily("fam-a"))!;
      await expect(
        repo.updateTaskFamily({ ...famA, parentFamilyId: "fam-a" }, famA.revision),
      ).rejects.toThrow(/cycle|itself/i);
    });

    it("rejects updating a family's parent to a nonexistent family", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "fam-a" }));
      const famA = (await repo.getTaskFamily("fam-a"))!;
      await expect(
        repo.updateTaskFamily({ ...famA, parentFamilyId: "fam-ghost" }, famA.revision),
      ).rejects.toThrow(/not found/i);
    });

    it("rejects a multi-hop parent cycle introduced through an update", async () => {
      const repo = makeRepo();
      await repo.createTaskFamily(taskFamily({ id: "fam-a" }));
      await repo.createTaskFamily(taskFamily({ id: "fam-b", parentFamilyId: "fam-a" }));
      await repo.createTaskFamily(taskFamily({ id: "fam-c", parentFamilyId: "fam-b" }));
      // fam-a → fam-c → fam-b → fam-a would close a 3-hop loop.
      const famA = (await repo.getTaskFamily("fam-a"))!;
      await expect(
        repo.updateTaskFamily({ ...famA, parentFamilyId: "fam-c" }, famA.revision),
      ).rejects.toThrow(/cycle/i);
      // A legitimate re-parent that creates no cycle still succeeds.
      const famC = (await repo.getTaskFamily("fam-c"))!;
      const rev = await repo.updateTaskFamily({ ...famC, parentFamilyId: null }, famC.revision);
      expect((await repo.getTaskFamily("fam-c"))!.parentFamilyId).toBeNull();
      expect(rev).toBe(famC.revision + 1);
    });

    it("does not infer a universal tree from relations (no parent/child API)", () => {
      const repo = makeRepo();
      // The relation seam is explicit and typed only; there is no API that
      // walks a universal family tree or infers hierarchy from relations.
      expect((repo as unknown as Record<string, unknown>).listTaskFamilyTree).toBeUndefined();
      expect((repo as unknown as Record<string, unknown>).inferFamilyTree).toBeUndefined();
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
    expect(db.tables.some((t) => t.name === "taskFamilyRelations")).toBe(true);
    // v1/v2 stores still present.
    expect(db.tables.some((t) => t.name === "runSummaries")).toBe(true);
    expect(db.tables.some((t) => t.name === "fusionRecipes")).toBe(true);
  });

  it("upgrades a v1-seeded database to v3 additively without losing v1 rows", async () => {
    const dbName = `task-legacy-${crypto.randomUUID()}`;
    // Seed a v1-only database using a plain Dexie instance pinned to v1.
    const v1 = new Dexie(dbName);
    v1.version(1).stores({
      runSummaries:
        "id, kind, revision, createdAt, completedAt, status, mode, sourceKind, sourceProtocolFingerprint, sourceExperimentTaskAttemptId, *modelKeys",
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

  it("upgrades a v3-seeded database to v4 additively without losing v3 rows", async () => {
    const dbName = `task-v3-legacy-${crypto.randomUUID()}`;
    // Seed a v3-only database (no taskFamilyRelations store) using a plain
    // Dexie instance pinned to v3 with the v3 schema declaration.
    const v3 = new Dexie(dbName);
    v3.version(1).stores({
      runSummaries: "id",
      runDetails: "id",
      profiles: "id",
      profileVersions: "[id+version]",
      suites: "id",
      experiments: "id",
      storageMeta: "key",
    });
    v3.version(2).stores({
      fusionRecipes: "[id+version]",
      poolManifests: "[id+version]",
      fusionStudies: "id",
      fusionTrials: "id",
      fusionAttempts: "id",
      fusionObservations: "id",
      fusionPlaybooks: "id",
    });
    v3.version(3).stores({
      tasks: "id, updatedAt, archivedAt, origin",
      taskVersions: "[taskId+version], taskId, createdAt",
      taskArtifacts: "id, contentDigest, mediaType, byteCount, createdAt",
      taskArtifactBytes: "id",
      taskInstances: "id, [taskId+taskVersion], inputDigest, inputCompleteness, createdAt",
      taskFamilies: "id, parentFamilyId, updatedAt, archivedAt",
      taskFamilyAssignments: "id, taskId, taskVersion, familyId, isPrimary, createdAt, archivedAt",
      taskFacetAnnotations: "id, taskId, [taskId+taskVersion], facetId, valueId, createdAt",
      taskMigrationCrosswalk: "legacyScopeKey, taskId, taskVersion",
    });
    await v3.open();
    await v3.table("taskFamilies").put({
      id: "fam-legacy",
      family: {
        id: "fam-legacy",
        name: "Legacy",
        description: "",
        parentFamilyId: null,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
        revision: 0,
      },
      parentFamilyId: null,
      updatedAt: 1,
      archivedAt: null,
      revision: 0,
    });
    v3.close();

    // Reopen with the full RSembleEvaluationDB (declares v1..v4).
    const db = new RSembleEvaluationDB(dbName);
    dbs.push(db);
    await db.open();
    // v3 row survived the additive v4 upgrade.
    const row = await db.taskFamilies.get("fam-legacy");
    expect(row?.id).toBe("fam-legacy");
    // v4 Task relation store is now present.
    expect(db.tables.some((t) => t.name === "taskFamilyRelations")).toBe(true);
    // v1/v2/v3 stores still present.
    expect(db.tables.some((t) => t.name === "runSummaries")).toBe(true);
    expect(db.tables.some((t) => t.name === "fusionRecipes")).toBe(true);
    expect(db.tables.some((t) => t.name === "taskFamilies")).toBe(true);
  });
});
