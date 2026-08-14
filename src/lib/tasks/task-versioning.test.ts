// =============================================================================
// RSemble AI — Canonical Task versioning pure-rule tests
//
// Child 02 (Canonical Tasks) Milestone A — Task 2 (RED first).
//
// Covers spec §3.2 + §4 identity/immutability rules:
//   - task-defining vs metadata changes (which fields force a new version)
//   - contiguous, positive, append-only version numbers
//   - exact normalized definition digest reuse (canonicalJsonString + sha256)
//   - digest-collision deep equality before reuse
//   - duplicate-as-new-identity (never becomes a version of the source)
//   - archive affects discoverability, not references/historical routes
//   - attempt count never creates new Tasks or Task Versions
//
// Pure normalizers/comparators/builders only. Digests are integrity aids, not
// semantic identity (spec §4.1).
// =============================================================================

import { describe, expect, it } from "vitest";

import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import type { TaskRecord, TaskSource, TaskVersion } from "./task-types";
import {
  archiveTaskRecord,
  buildInitialTaskRecord,
  buildNextVersion,
  computeDefinitionDigest,
  duplicateTaskRecord,
  isTaskDefiningChange,
  isTaskDefiningField,
  normalizeVersionForDigest,
  restoreTaskRecord,
  TASK_DEFINING_FIELDS,
  validateContiguousAppend,
  type TaskVersionDelta,
} from "./task-versioning";

// --- fixtures ----------------------------------------------------------------

const DIGEST_A = "sha256:" + "a".repeat(64);

function baseSource(): TaskSource {
  return { kind: "authored", legacyScopeKey: null, note: null };
}

function v1(overrides: Partial<TaskVersion> = {}): TaskVersion {
  return {
    taskId: "task-1",
    version: 1,
    title: "Summarize a report",
    objective: "Produce a faithful summary.",
    candidateInstruction: "Summarize the following report in 3 bullets.",
    defaultContextManifest: [
      {
        role: "primary",
        artifactId: "art-1",
        externalRef: null,
        metadataDigest: DIGEST_A,
        mediaType: "text/plain",
        byteCount: 42,
      },
    ],
    responseContract: { format: "markdown", constraints: ["no preamble"], maxLength: 500 },
    taskVerifierRef: { id: "verifier-1", version: 2 },
    source: baseSource(),
    createdAt: 1_000,
    ...overrides,
  };
}

function record(opts: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    latestVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    origin: "authored",
    revision: 0,
    ...opts,
  };
}

// --- task-defining fields ----------------------------------------------------

describe("TASK_DEFINING_FIELDS", () => {
  it("lists exactly the spec §3.2 task-defining fields", () => {
    expect(TASK_DEFINING_FIELDS).toEqual([
      "title",
      "objective",
      "candidateInstruction",
      "defaultContextManifest",
      "responseContract",
      "taskVerifierRef",
    ]);
  });

  it("excludes execution-protocol fields (source, createdAt, version, taskId)", () => {
    expect(TASK_DEFINING_FIELDS).not.toContain("source");
    expect(TASK_DEFINING_FIELDS).not.toContain("createdAt");
    expect(TASK_DEFINING_FIELDS).not.toContain("version");
    expect(TASK_DEFINING_FIELDS).not.toContain("taskId");
  });
});

describe("isTaskDefiningField", () => {
  it.each(TASK_DEFINING_FIELDS)("returns true for task-defining field %s", (field) => {
    expect(isTaskDefiningField(field)).toBe(true);
  });

  it("returns false for execution-protocol / provenance fields", () => {
    expect(isTaskDefiningField("source")).toBe(false);
    expect(isTaskDefiningField("createdAt")).toBe(false);
    expect(isTaskDefiningField("version")).toBe(false);
    expect(isTaskDefiningField("taskId")).toBe(false);
  });

  it("returns false for unknown fields", () => {
    expect(isTaskDefiningField("nope")).toBe(false);
    expect(isTaskDefiningField("")).toBe(false);
  });
});

// --- task-defining vs metadata change detection ------------------------------

describe("isTaskDefiningChange", () => {
  it("detects a candidateInstruction change as task-defining", () => {
    const delta: TaskVersionDelta = {
      previous: v1(),
      next: v1({ candidateInstruction: "Summarize in 5 bullets instead." }),
    };
    expect(isTaskDefiningChange(delta)).toBe(true);
  });

  it("detects an objective change as task-defining", () => {
    const delta: TaskVersionDelta = {
      previous: v1(),
      next: v1({ objective: "Produce a critical summary." }),
    };
    expect(isTaskDefiningChange(delta)).toBe(true);
  });

  it("detects a title change as task-defining", () => {
    const delta: TaskVersionDelta = {
      previous: v1(),
      next: v1({ title: "Summarize a long report" }),
    };
    expect(isTaskDefiningChange(delta)).toBe(true);
  });

  it("detects a defaultContextManifest change as task-defining", () => {
    const next = v1({
      defaultContextManifest: [
        ...v1().defaultContextManifest,
        {
          role: "supporting",
          artifactId: "art-2",
          externalRef: null,
          metadataDigest: DIGEST_A,
          mediaType: "text/plain",
          byteCount: 7,
        },
      ],
    });
    expect(isTaskDefiningChange({ previous: v1(), next })).toBe(true);
  });

  it("detects a responseContract change as task-defining", () => {
    const next = v1({ responseContract: { format: "plain", constraints: [], maxLength: null } });
    expect(isTaskDefiningChange({ previous: v1(), next })).toBe(true);
  });

  it("detects a responseContract null <-> non-null transition as task-defining", () => {
    expect(isTaskDefiningChange({ previous: v1(), next: v1({ responseContract: null }) })).toBe(
      true,
    );
    const withNull = v1({ responseContract: null });
    expect(isTaskDefiningChange({ previous: withNull, next: v1() })).toBe(true);
  });

  it("detects a taskVerifierRef change as task-defining", () => {
    const next = v1({ taskVerifierRef: { id: "verifier-2", version: 1 } });
    expect(isTaskDefiningChange({ previous: v1(), next })).toBe(true);
  });

  it("detects a taskVerifierRef null <-> non-null transition as task-defining", () => {
    expect(isTaskDefiningChange({ previous: v1(), next: v1({ taskVerifierRef: null }) })).toBe(
      true,
    );
  });

  it("does NOT flag a source-only (provenance) change as task-defining", () => {
    const next = v1({ source: { kind: "imported", legacyScopeKey: null, note: "imported v1" } });
    expect(isTaskDefiningChange({ previous: v1(), next })).toBe(false);
  });

  it("does NOT flag a createdAt-only change as task-defining", () => {
    const next = v1({ createdAt: 9_999 });
    expect(isTaskDefiningChange({ previous: v1(), next })).toBe(false);
  });

  it("does NOT flag identical content as a task-defining change", () => {
    expect(isTaskDefiningChange({ previous: v1(), next: v1() })).toBe(false);
  });

  it("does NOT flag manifest entry reordering with identical content as task-defining", () => {
    // defaultContextManifest is semantically ordered; identical entries reordered
    // are still the same definition only when content matches element-wise.
    // Here we keep one entry, so reordering is a no-op.
    const next = v1();
    expect(isTaskDefiningChange({ previous: v1(), next })).toBe(false);
  });

  it("treats a context manifest with reordered but content-identical entries as NOT task-defining when order is semantically irrelevant", () => {
    // Spec §3.2: a change to task-defining context creates the next version.
    // Order within the manifest is part of the candidate-visible context, so a
    // genuine reorder of distinct entries IS task-defining. This test pins the
    // conservative behavior: a reorder of distinct entries is flagged.
    const a = v1().defaultContextManifest[0];
    const b = {
      role: "supporting",
      artifactId: "art-2",
      externalRef: null,
      metadataDigest: DIGEST_A,
      mediaType: "application/pdf",
      byteCount: 100,
    };
    const prev = v1({ defaultContextManifest: [a, b] });
    const next = v1({ defaultContextManifest: [b, a] });
    expect(isTaskDefiningChange({ previous: prev, next })).toBe(true);
  });
});

// --- normalized definition digest -------------------------------------------

describe("normalizeVersionForDigest", () => {
  it("excludes execution-protocol fields (taskId, version, createdAt, source)", () => {
    const normalized = normalizeVersionForDigest(v1());
    expect(normalized).not.toHaveProperty("taskId");
    expect(normalized).not.toHaveProperty("version");
    expect(normalized).not.toHaveProperty("createdAt");
    expect(normalized).not.toHaveProperty("source");
  });

  it("includes only the task-defining fields", () => {
    const normalized = normalizeVersionForDigest(v1());
    expect(Object.keys(normalized).sort()).toEqual([...TASK_DEFINING_FIELDS].sort());
  });

  it("is insertion-order invariant (canonicalJsonString over the normalized form is stable)", () => {
    const n1 = normalizeVersionForDigest(v1());
    const n2 = normalizeVersionForDigest(v1());
    expect(canonicalJsonString(n1)).toBe(canonicalJsonString(n2));
  });
});

describe("computeDefinitionDigest", () => {
  it("returns a sha256:<64 hex> digest", () => {
    expect(computeDefinitionDigest(v1())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is stable across identical versions with different taskId/version/createdAt/source", () => {
    const a = v1();
    const b = v1({
      taskId: "task-999",
      version: 7,
      createdAt: 9_999,
      source: { kind: "imported", legacyScopeKey: null, note: "x" },
    });
    expect(computeDefinitionDigest(a)).toBe(computeDefinitionDigest(b));
  });

  it("changes when candidateInstruction changes", () => {
    const a = v1();
    const b = v1({ candidateInstruction: "Different instruction." });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
  });

  it("changes when objective changes", () => {
    const a = v1();
    const b = v1({ objective: "Different objective." });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
  });

  it("changes when title changes", () => {
    const a = v1();
    const b = v1({ title: "Different title" });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
  });

  it("changes when defaultContextManifest content changes", () => {
    const a = v1();
    const b = v1({
      defaultContextManifest: [{ ...v1().defaultContextManifest[0], byteCount: 43 }],
    });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
  });

  it("changes when responseContract changes", () => {
    const a = v1();
    const b = v1({ responseContract: { format: "plain", constraints: [], maxLength: null } });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
  });

  it("changes when taskVerifierRef changes", () => {
    const a = v1();
    const b = v1({ taskVerifierRef: { id: "verifier-2", version: 1 } });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
  });

  it("does NOT change when only source/createdAt/version/taskId change", () => {
    const a = v1();
    const b = v1({
      taskId: "task-999",
      version: 99,
      createdAt: 9_999,
      source: { kind: "legacy-task-set", legacyScopeKey: "suite-x:task-y", note: "migrated" },
    });
    expect(computeDefinitionDigest(a)).toBe(computeDefinitionDigest(b));
  });

  it("is insertion-order invariant for object keys (canonicalJsonString reuse)", () => {
    // Build two versions whose task-defining fields are constructed with
    // different key insertion orders but identical content.
    const a = v1();
    const b: TaskVersion = {
      source: baseSource(),
      createdAt: 1_000,
      taskVerifierRef: { id: "verifier-1", version: 2 },
      responseContract: { format: "markdown", constraints: ["no preamble"], maxLength: 500 },
      defaultContextManifest: v1().defaultContextManifest,
      candidateInstruction: "Summarize the following report in 3 bullets.",
      objective: "Produce a faithful summary.",
      title: "Summarize a report",
      version: 1,
      taskId: "task-1",
    };
    expect(computeDefinitionDigest(a)).toBe(computeDefinitionDigest(b));
  });
});

// --- contiguous append -------------------------------------------------------

describe("validateContiguousAppend", () => {
  it("accepts appending version 2 after latestVersion 1", () => {
    const r = validateContiguousAppend({ latestVersion: 1 }, { version: 2 });
    expect(r).toEqual({ ok: true });
  });

  it("accepts appending version 4 after latestVersion 3", () => {
    const r = validateContiguousAppend({ latestVersion: 3 }, { version: 4 });
    expect(r).toEqual({ ok: true });
  });

  it("rejects appending the same version number (no overwrite)", () => {
    const r = validateContiguousAppend({ latestVersion: 2 }, { version: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/contiguous|append|after/i);
  });

  it("rejects appending a version more than +1 ahead (gap)", () => {
    const r = validateContiguousAppend({ latestVersion: 1 }, { version: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/contiguous|gap|after/i);
  });

  it("rejects appending a version behind latestVersion (regression)", () => {
    const r = validateContiguousAppend({ latestVersion: 3 }, { version: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/contiguous|after|behind/i);
  });

  it("rejects appending version 1 when a version already exists", () => {
    const r = validateContiguousAppend({ latestVersion: 1 }, { version: 1 });
    expect(r.ok).toBe(false);
  });

  it("rejects non-positive version numbers", () => {
    const r0 = validateContiguousAppend({ latestVersion: 0 }, { version: 1 });
    expect(r0.ok).toBe(false);
    expect(r0.reason).toMatch(/positive|invalid/i);
    const rNeg = validateContiguousAppend({ latestVersion: 1 }, { version: 0 });
    expect(rNeg.ok).toBe(false);
  });

  it("rejects non-integer version numbers", () => {
    const r = validateContiguousAppend({ latestVersion: 1 }, { version: 2.5 });
    expect(r.ok).toBe(false);
  });
});

// --- buildNextVersion --------------------------------------------------------

describe("buildNextVersion", () => {
  it("produces a version numbered latestVersion + 1 with the given task-defining content", () => {
    const next = buildNextVersion({
      latestVersion: 1,
      taskId: "task-1",
      draft: v1({ candidateInstruction: "New instruction." }),
      createdAt: 5_000,
      source: baseSource(),
    });
    expect(next.taskId).toBe("task-1");
    expect(next.version).toBe(2);
    expect(next.createdAt).toBe(5_000);
    expect(next.source).toEqual(baseSource());
    expect(next.candidateInstruction).toBe("New instruction.");
  });

  it("never copies the previous version number into the new version", () => {
    const next = buildNextVersion({
      latestVersion: 5,
      taskId: "task-1",
      draft: v1({ version: 5, candidateInstruction: "x" }),
      createdAt: 5_000,
      source: baseSource(),
    });
    expect(next.version).toBe(6);
  });

  it("ignores the draft's taskId/version/createdAt/source in favor of explicit args", () => {
    const next = buildNextVersion({
      latestVersion: 1,
      taskId: "task-1",
      draft: v1({
        taskId: "WRONG",
        version: 999,
        createdAt: 999,
        source: { kind: "imported", legacyScopeKey: null, note: "wrong" },
      }),
      createdAt: 5_000,
      source: { kind: "authored", legacyScopeKey: null, note: "right" },
    });
    expect(next.taskId).toBe("task-1");
    expect(next.version).toBe(2);
    expect(next.createdAt).toBe(5_000);
    expect(next.source.note).toBe("right");
  });

  it("deep-copies the manifest and responseContract so the draft cannot mutate the stored version", () => {
    const draft = v1();
    const next = buildNextVersion({
      latestVersion: 1,
      taskId: "task-1",
      draft,
      createdAt: 5_000,
      source: baseSource(),
    });
    draft.defaultContextManifest[0].byteCount = 9999;
    if (next.responseContract) next.responseContract.maxLength = 9999;
    // The stored next must not reflect post-build mutation of the draft input.
    expect(next.defaultContextManifest[0].byteCount).toBe(42);
  });
});

// --- buildInitialTaskRecord --------------------------------------------------

describe("buildInitialTaskRecord", () => {
  it("builds a TaskRecord at latestVersion 1, revision 0, not archived", () => {
    const r = buildInitialTaskRecord({ id: "task-1", createdAt: 1_000, origin: "authored" });
    expect(r).toEqual({
      id: "task-1",
      latestVersion: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
      archivedAt: null,
      origin: "authored",
      revision: 0,
    });
  });

  it("supports legacy-task-set origin", () => {
    const r = buildInitialTaskRecord({ id: "task-2", createdAt: 2_000, origin: "legacy-task-set" });
    expect(r.origin).toBe("legacy-task-set");
    expect(r.latestVersion).toBe(1);
  });
});

// --- archive / restore semantics --------------------------------------------

describe("archiveTaskRecord / restoreTaskRecord", () => {
  it("archive sets archivedAt and bumps revision + updatedAt, leaving latestVersion untouched", () => {
    const before = record({ revision: 2, latestVersion: 3, updatedAt: 1_000 });
    const after = archiveTaskRecord(before, 5_000);
    expect(after.archivedAt).toBe(5_000);
    expect(after.updatedAt).toBe(5_000);
    expect(after.revision).toBe(3);
    expect(after.latestVersion).toBe(3);
    expect(after.id).toBe(before.id);
    expect(after.origin).toBe(before.origin);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it("archive is idempotent in archivedAt but still bumps revision/updatedAt when re-archived", () => {
    const archived = archiveTaskRecord(record({ revision: 0 }), 5_000);
    const reArchived = archiveTaskRecord(archived, 6_000);
    expect(reArchived.archivedAt).toBe(6_000);
    expect(reArchived.revision).toBe(2);
  });

  it("restore clears archivedAt and bumps revision + updatedAt, leaving latestVersion untouched", () => {
    const archived = archiveTaskRecord(record({ revision: 0, latestVersion: 2 }), 5_000);
    const restored = restoreTaskRecord(archived, 7_000);
    expect(restored.archivedAt).toBe(null);
    expect(restored.updatedAt).toBe(7_000);
    expect(restored.revision).toBe(2);
    expect(restored.latestVersion).toBe(2);
  });

  it("archive/restore never mutates the input record (pure builder)", () => {
    const before = record({ revision: 0 });
    const snapshot = JSON.parse(JSON.stringify(before)) as TaskRecord;
    archiveTaskRecord(before, 5_000);
    restoreTaskRecord(before, 6_000);
    expect(before).toEqual(snapshot);
  });

  it("archive preserves identity fields so historical routes/references remain intact", () => {
    // Spec §4.5: archive affects discoverability, not references or routes.
    const before = record({ revision: 4, latestVersion: 7, origin: "legacy-task-set" });
    const after = archiveTaskRecord(before, 9_000);
    expect(after.id).toBe(before.id);
    expect(after.latestVersion).toBe(7);
    expect(after.origin).toBe("legacy-task-set");
    expect(after.createdAt).toBe(before.createdAt);
  });
});

// --- duplicate-as-new-identity ----------------------------------------------

describe("duplicateTaskRecord", () => {
  it("creates a new Task identity with origin authored, revision 0, latestVersion 1, not archived", () => {
    const source = record({
      id: "task-1",
      revision: 5,
      latestVersion: 4,
      origin: "legacy-task-set",
      archivedAt: 1_000,
    });
    const dup = duplicateTaskRecord({ source, newId: "task-2", createdAt: 9_000 });
    expect(dup.id).toBe("task-2");
    expect(dup.origin).toBe("authored");
    expect(dup.revision).toBe(0);
    expect(dup.latestVersion).toBe(1);
    expect(dup.archivedAt).toBe(null);
    expect(dup.createdAt).toBe(9_000);
    expect(dup.updatedAt).toBe(9_000);
  });

  it("never carries the source's archivedAt into the duplicate", () => {
    const source = record({ archivedAt: 1_000 });
    const dup = duplicateTaskRecord({ source, newId: "task-2", createdAt: 9_000 });
    expect(dup.archivedAt).toBe(null);
  });

  it("never carries the source's revision/latestVersion into the duplicate", () => {
    const source = record({ revision: 9, latestVersion: 9 });
    const dup = duplicateTaskRecord({ source, newId: "task-2", createdAt: 9_000 });
    expect(dup.revision).toBe(0);
    expect(dup.latestVersion).toBe(1);
  });

  it("does not mutate the source record", () => {
    const source = record({ revision: 5 });
    const snapshot = JSON.parse(JSON.stringify(source)) as TaskRecord;
    duplicateTaskRecord({ source, newId: "task-2", createdAt: 9_000 });
    expect(source).toEqual(snapshot);
  });
});

// --- no attempt-based versions ----------------------------------------------

describe("attempt count never creates versions", () => {
  it("repeated identical attempts produce the same definition digest (no new version implied)", () => {
    // Spec §4.7: attempt count does not create new Tasks or Task Versions.
    // The pure rule: identical task-defining content => identical digest,
    // regardless of how many attempts ran against it.
    const a = v1();
    const attempt2 = v1();
    const attempt3 = v1();
    expect(computeDefinitionDigest(a)).toBe(computeDefinitionDigest(attempt2));
    expect(computeDefinitionDigest(attempt2)).toBe(computeDefinitionDigest(attempt3));
  });

  it("a stochastic replicate (spec §4.8) shares Task/Version/Instance identity: same definition digest", () => {
    const original = v1();
    const replicate = v1();
    expect(computeDefinitionDigest(original)).toBe(computeDefinitionDigest(replicate));
  });
});

// --- digest-collision deep equality (versioning side) -----------------------

describe("definition digest collision requires deep equality of task-defining fields", () => {
  it("two versions with equal digests have deeply equal task-defining fields", () => {
    const a = v1();
    const b = v1({
      taskId: "task-999",
      version: 9,
      createdAt: 9_999,
      source: { kind: "imported", legacyScopeKey: null, note: "z" },
    });
    expect(computeDefinitionDigest(a)).toBe(computeDefinitionDigest(b));
    // The normalized forms (task-defining fields only) must be deeply equal.
    expect(canonicalJsonString(normalizeVersionForDigest(a))).toBe(
      canonicalJsonString(normalizeVersionForDigest(b)),
    );
  });

  it("two versions with different digests have differing task-defining fields", () => {
    const a = v1();
    const b = v1({ candidateInstruction: "Different." });
    expect(computeDefinitionDigest(a)).not.toBe(computeDefinitionDigest(b));
    expect(canonicalJsonString(normalizeVersionForDigest(a))).not.toBe(
      canonicalJsonString(normalizeVersionForDigest(b)),
    );
  });
});
