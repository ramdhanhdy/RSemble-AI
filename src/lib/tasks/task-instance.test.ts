// =============================================================================
// RSemble AI — Canonical Task instance identity pure-rule tests
//
// Child 02 (Canonical Tasks) Milestone A — Task 2 (RED first).
//
// Covers spec §3.3, §3.4, §4 identity/immutability rules for instances and
// artifacts:
//   - byte-level artifact digest + byte equality (P2 conflict: string-hash
//     reuse is insufficient; spec §3.3 requires byte equality before reuse)
//   - exact normalized input/context/artifact digest reuse
//   - digest-collision deep equality before instance reuse (spec §3.4)
//   - metadata-only / incomplete instances are never upgraded to complete
//     without real bytes (spec §3.4, §6.4)
//   - instance reuse only under the same Task Version (spec §3.4)
//   - digests are integrity aids only; IDs are opaque (spec §4.1)
//
// Pure normalizers/comparators/builders only. No Dexie, no provider calls.
// =============================================================================

import { describe, expect, it } from "vitest";

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import type {
  ContextManifestEntry,
  NormalizedTaskInput,
  TaskInstance,
  TaskInstanceSourceRef,
} from "./task-types";
import {
  artifactsByteEqual,
  buildInstanceReuseKey,
  buildTaskArtifact,
  computeArtifactDigest,
  computeInstanceInputDigest,
  instancesReuseEqual,
  isArtifactDigestMatch,
  normalizeNormalizedInputForDigest,
  resolveInstanceCompleteness,
  type InstanceReuseKey,
} from "./task-instance";

// --- fixtures ----------------------------------------------------------------

const DIGEST_A = "sha256:" + "a".repeat(64);

function manifestEntry(overrides: Partial<ContextManifestEntry> = {}): ContextManifestEntry {
  return {
    role: "primary",
    artifactId: "art-1",
    externalRef: null,
    metadataDigest: DIGEST_A,
    mediaType: "text/plain",
    byteCount: 42,
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

function sourceRef(overrides: Partial<TaskInstanceSourceRef> = {}): TaskInstanceSourceRef {
  return { kind: "authored", legacyScopeKey: null, originId: null, ...overrides };
}

function instance(overrides: Partial<TaskInstance> = {}): TaskInstance {
  return {
    id: "inst-1",
    taskId: "task-1",
    taskVersion: 1,
    normalizedInput: normalizedInput(),
    contextManifest: [manifestEntry()],
    inputDigest: DIGEST_A,
    inputCompleteness: "complete",
    createdAt: 1_000,
    sourceRef: sourceRef(),
    ...overrides,
  };
}

// --- byte-level artifact digest ---------------------------------------------

describe("computeArtifactDigest", () => {
  it("returns a sha256:<64 hex> digest", () => {
    expect(computeArtifactDigest(new Uint8Array([1, 2, 3]))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is deterministic for identical bytes", () => {
    const a = computeArtifactDigest(new Uint8Array([72, 101, 108, 108, 111]));
    const b = computeArtifactDigest(new Uint8Array([72, 101, 108, 108, 111]));
    expect(a).toBe(b);
  });

  it("differs for different bytes", () => {
    const a = computeArtifactDigest(new Uint8Array([1, 2, 3]));
    const b = computeArtifactDigest(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it("is consistent for identical UTF-8 text bytes", () => {
    const enc = new TextEncoder();
    expect(computeArtifactDigest(enc.encode("café"))).toBe(computeArtifactDigest(enc.encode("café")));
  });

  it("for a pure-text artifact equals the shipped string hashArtifactContent of that text", () => {
    const text = "Hello, world.";
    const enc = new TextEncoder();
    const byteDigest = computeArtifactDigest(enc.encode(text));
    expect(byteDigest).toBe(hashArtifactContent(text));
  });
});

// --- byte equality ----------------------------------------------------------

describe("artifactsByteEqual", () => {
  it("returns true for identical byte content", () => {
    expect(artifactsByteEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("returns false for different byte content", () => {
    expect(artifactsByteEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(artifactsByteEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });

  it("returns true for two empty byte arrays", () => {
    expect(artifactsByteEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it("treats a view over a larger buffer by its own length, not the backing buffer", () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    const view = backing.subarray(2, 5); // [1,2,3]
    expect(artifactsByteEqual(view, new Uint8Array([1, 2, 3]))).toBe(true);
  });
});

// --- artifact digest match (byte equality before reuse) ---------------------

describe("isArtifactDigestMatch", () => {
  it("returns true when the stored digest equals the digest of the new bytes", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = computeArtifactDigest(bytes);
    expect(isArtifactDigestMatch(digest, bytes)).toBe(true);
  });

  it("returns false when the stored digest differs from the digest of the new bytes", () => {
    const digest = computeArtifactDigest(new Uint8Array([1, 2, 3]));
    expect(isArtifactDigestMatch(digest, new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it("returns false for a malformed stored digest", () => {
    expect(isArtifactDigestMatch("not-a-digest", new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("returns false when a digest matches one byte set but the bytes differ (collision guard)", () => {
    const real = computeArtifactDigest(new Uint8Array([1, 2, 3]));
    const fakeBytes = new Uint8Array([9, 9, 9]);
    expect(isArtifactDigestMatch(real, fakeBytes)).toBe(false);
  });
});

describe("buildTaskArtifact", () => {
  it("builds an artifact with a byte-derived digest and byteCount", () => {
    const bytes = new TextEncoder().encode("hello");
    const a = buildTaskArtifact({
      id: "art-1",
      bytes,
      mediaType: "text/plain",
      storageRef: "blob://art-1",
      createdAt: 1_000,
    });
    expect(a.id).toBe("art-1");
    expect(a.contentDigest).toBe(computeArtifactDigest(bytes));
    expect(a.byteCount).toBe(bytes.byteLength);
    expect(a.mediaType).toBe("text/plain");
    expect(a.storageRef).toBe("blob://art-1");
    expect(a.createdAt).toBe(1_000);
  });

  it("rejects empty byte content (an artifact must carry real bytes)", () => {
    expect(() =>
      buildTaskArtifact({
        id: "art-1",
        bytes: new Uint8Array(0),
        mediaType: "text/plain",
        storageRef: "blob://art-1",
        createdAt: 1_000,
      }),
    ).toThrow(/empty|bytes/i);
  });
});

// --- normalized input digest ------------------------------------------------

describe("normalizeNormalizedInputForDigest", () => {
  it("includes text, artifactIds, and metadata only", () => {
    const n = normalizeNormalizedInputForDigest(normalizedInput());
    expect(n).toHaveProperty("text");
    expect(n).toHaveProperty("artifactIds");
    expect(n).toHaveProperty("metadata");
    expect(Object.keys(n).sort()).toEqual(["artifactIds", "metadata", "text"]);
  });

  it("is insertion-order invariant for metadata keys", () => {
    const a = normalizedInput({ metadata: { a: "1", b: "2" } });
    const b = normalizedInput({ metadata: { b: "2", a: "1" } });
    expect(canonicalJsonString(normalizeNormalizedInputForDigest(a))).toBe(
      canonicalJsonString(normalizeNormalizedInputForDigest(b)),
    );
  });

  it("treats artifactIds order as significant (semantically ordered)", () => {
    const a = normalizedInput({ artifactIds: ["art-1", "art-2"] });
    const b = normalizedInput({ artifactIds: ["art-2", "art-1"] });
    expect(canonicalJsonString(normalizeNormalizedInputForDigest(a))).not.toBe(
      canonicalJsonString(normalizeNormalizedInputForDigest(b)),
    );
  });
});

describe("computeInstanceInputDigest", () => {
  it("returns a sha256:<64 hex> digest", () => {
    expect(computeInstanceInputDigest(instance())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is stable across instances with different id/taskId/taskVersion/createdAt/sourceRef but identical inputs", () => {
    const a = instance();
    const b = instance({
      id: "inst-999",
      taskId: "task-999",
      taskVersion: 999,
      createdAt: 9_999,
      sourceRef: sourceRef({ kind: "comparison", originId: "run-1" }),
    });
    expect(computeInstanceInputDigest(a)).toBe(computeInstanceInputDigest(b));
  });

  it("changes when normalizedInput.text changes", () => {
    const a = instance();
    const b = instance({ normalizedInput: normalizedInput({ text: "Different." }) });
    expect(computeInstanceInputDigest(a)).not.toBe(computeInstanceInputDigest(b));
  });

  it("changes when normalizedInput.artifactIds content changes", () => {
    const a = instance();
    const b = instance({ normalizedInput: normalizedInput({ artifactIds: ["art-2"] }) });
    expect(computeInstanceInputDigest(a)).not.toBe(computeInstanceInputDigest(b));
  });

  it("changes when normalizedInput.artifactIds order changes", () => {
    const a = instance({ normalizedInput: normalizedInput({ artifactIds: ["art-1", "art-2"] }) });
    const b = instance({ normalizedInput: normalizedInput({ artifactIds: ["art-2", "art-1"] }) });
    expect(computeInstanceInputDigest(a)).not.toBe(computeInstanceInputDigest(b));
  });

  it("changes when normalizedInput.metadata changes", () => {
    const a = instance();
    const b = instance({ normalizedInput: normalizedInput({ metadata: { locale: "fr" } }) });
    expect(computeInstanceInputDigest(a)).not.toBe(computeInstanceInputDigest(b));
  });

  it("changes when contextManifest content changes", () => {
    const a = instance();
    const b = instance({
      contextManifest: [manifestEntry({ byteCount: 43 })],
    });
    expect(computeInstanceInputDigest(a)).not.toBe(computeInstanceInputDigest(b));
  });

  it("does NOT change when only id/taskId/taskVersion/createdAt/sourceRef change", () => {
    const a = instance();
    const b = instance({
      id: "inst-2",
      taskId: "task-2",
      taskVersion: 2,
      createdAt: 2_000,
      sourceRef: sourceRef({ kind: "imported", originId: "exp-1" }),
    });
    expect(computeInstanceInputDigest(a)).toBe(computeInstanceInputDigest(b));
  });
});

// --- instance reuse equality ------------------------------------------------

describe("normalizeInstanceForDigest / instancesReuseEqual", () => {
  it("two complete instances under the same taskVersion with identical inputs+context are reuse-equal", () => {
    const a = instance();
    const b = instance({ id: "inst-2", createdAt: 2_000 });
    expect(instancesReuseEqual(a, b)).toBe(true);
  });

  it("two instances under different taskVersions are NOT reuse-equal (spec §3.4: same Task Version only)", () => {
    const a = instance({ taskVersion: 1 });
    const b = instance({ taskVersion: 2 });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("two instances under different taskIds are NOT reuse-equal", () => {
    const a = instance({ taskId: "task-1" });
    const b = instance({ taskId: "task-2" });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("a complete instance is NOT reuse-equal to a metadata_only instance even with identical digests", () => {
    // Spec §3.4: metadata-only historical attachments are never upgraded to
    // complete without real bytes. Reuse equality must respect completeness.
    const a = instance({ inputCompleteness: "complete" });
    const b = instance({ inputCompleteness: "metadata_only" });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("a complete instance is NOT reuse-equal to an incomplete instance", () => {
    const a = instance({ inputCompleteness: "complete" });
    const b = instance({ inputCompleteness: "incomplete" });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("two metadata_only instances with identical inputs are NOT reuse-equal", () => {
    const a = instance({ inputCompleteness: "metadata_only" });
    const b = instance({ inputCompleteness: "metadata_only", id: "inst-2" });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("two incomplete instances with identical inputs are NOT reuse-equal", () => {
    const a = instance({ inputCompleteness: "incomplete" });
    const b = instance({ inputCompleteness: "incomplete", id: "inst-2" });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("two instances with identical digests but different normalizedInput text are NOT reuse-equal (deep equality, not just digest)", () => {
    // Spec §3.4: digest collision verifies full normalized equality before reuse.
    const a = instance();
    const b = instance({
      normalizedInput: normalizedInput({ text: "Different text." }),
      // Force a colliding inputDigest to prove deep equality is the guard.
      inputDigest: a.inputDigest,
    });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("two instances with identical digests but different contextManifest are NOT reuse-equal", () => {
    const a = instance();
    const b = instance({
      contextManifest: [manifestEntry({ byteCount: 999 })],
      inputDigest: a.inputDigest,
    });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });

  it("reuse equality is unaffected by id/createdAt/sourceRef differences", () => {
    const a = instance();
    const b = instance({
      id: "inst-999",
      createdAt: 9_999,
      sourceRef: sourceRef({ kind: "comparison", originId: "run-1" }),
    });
    expect(instancesReuseEqual(a, b)).toBe(true);
  });

  it("reuse equality treats artifactIds order as significant", () => {
    const a = instance({ normalizedInput: normalizedInput({ artifactIds: ["art-1", "art-2"] }) });
    const b = instance({ normalizedInput: normalizedInput({ artifactIds: ["art-2", "art-1"] }) });
    expect(instancesReuseEqual(a, b)).toBe(false);
  });
});

// --- completeness resolution -----------------------------------------------

describe("resolveInstanceCompleteness", () => {
  it("returns complete when all artifactIds have real bytes provided", () => {
    const result = resolveInstanceCompleteness({
      normalizedInput: normalizedInput({ artifactIds: ["art-1", "art-2"] }),
      availableArtifactBytes: new Map([
        ["art-1", new Uint8Array([1])],
        ["art-2", new Uint8Array([2])],
      ]),
    });
    expect(result).toBe("complete");
  });

  it("returns complete when there are no artifactIds (text-only input)", () => {
    const result = resolveInstanceCompleteness({
      normalizedInput: normalizedInput({ artifactIds: [] }),
      availableArtifactBytes: new Map(),
    });
    expect(result).toBe("complete");
  });

  it("returns incomplete when some artifactIds have no bytes at all", () => {
    const result = resolveInstanceCompleteness({
      normalizedInput: normalizedInput({ artifactIds: ["art-1", "art-2"] }),
      availableArtifactBytes: new Map([["art-1", new Uint8Array([1])]]),
    });
    expect(result).toBe("incomplete");
  });

  it("returns metadata_only when no artifactIds have bytes but metadata is present", () => {
    const result = resolveInstanceCompleteness({
      normalizedInput: normalizedInput({ artifactIds: ["art-1", "art-2"] }),
      availableArtifactBytes: new Map(),
    });
    expect(result).toBe("metadata_only");
  });

  it("returns metadata_only when artifactIds is empty but metadata is present and there is no text", () => {
    const result = resolveInstanceCompleteness({
      normalizedInput: { text: "", artifactIds: [], metadata: { locale: "en" } },
      availableArtifactBytes: new Map(),
    });
    expect(result).toBe("metadata_only");
  });

  it("never upgrades a metadata_only input to complete without real bytes for every artifactId", () => {
    // Spec §3.4 / §6.4: absent bytes remain metadata_only/incomplete.
    const result = resolveInstanceCompleteness({
      normalizedInput: normalizedInput({ artifactIds: ["art-1"] }),
      availableArtifactBytes: new Map(),
    });
    expect(result).not.toBe("complete");
  });
});

// --- InstanceReuseKey (deduplication scope) --------------------------------

describe("InstanceReuseKey", () => {
  it("is scoped by taskId + taskVersion + inputDigest (spec §3.4: same Task Version only)", () => {
    const a = instance();
    const key = buildInstanceReuseKey(a) as InstanceReuseKey;
    expect(key.taskId).toBe("task-1");
    expect(key.taskVersion).toBe(1);
    expect(key.inputDigest).toBe(computeInstanceInputDigest(a));
  });

  it("two reuse-equal instances produce equal keys", () => {
    const a = instance();
    const b = instance({ id: "inst-2", createdAt: 2_000 });
    expect(buildInstanceReuseKey(a)).toEqual(buildInstanceReuseKey(b));
  });

  it("two instances under different taskVersions produce different keys", () => {
    const a = instance({ taskVersion: 1 });
    const b = instance({ taskVersion: 2 });
    expect(buildInstanceReuseKey(a)).not.toEqual(buildInstanceReuseKey(b));
  });
});
