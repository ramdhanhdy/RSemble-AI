// =============================================================================
// RSemble AI — Canonical Task runtime validator tests
//
// Child 02 (Canonical Tasks) Milestone A — Task 1.
//
// Covers: TaskRecord, immutable TaskVersion, TaskArtifact, TaskInstance
// completeness, TaskFamily, family assignment, facet taxonomy/annotation,
// version refs, prohibited keys, secret-shaped indexed/artifact metadata, and
// malformed imports. Reuses the project's deep-walk prohibited-key and
// credential-shape test idioms (run-types.test.ts, evaluation-rubric.test.ts).
// =============================================================================

import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_LIKE_VALUE,
  DIGEST_PATTERN,
  ID_PATTERN,
  PROHIBITED_KEYS,
  TASK_FACET_DIMENSIONS,
  TASK_INPUT_COMPLETENESS_VALUES,
  FACET_TAXONOMY_VERSIONS,
  FACET_TAXONOMY_VALUES,
  getFacetTaxonomyValues,
  hasProhibitedKeys,
  isContextManifestEntry,
  isFacetTaxonomyValue,
  isNormalizedTaskInput,
  isResponseContract,
  isTaskArtifact,
  isTaskFacetAnnotation,
  isTaskFamily,
  isTaskFamilyAssignment,
  isTaskFamilyRelation,
  isTaskInstance,
  isTaskInstanceSourceRef,
  isTaskRecord,
  isTaskSource,
  isTaskVersion,
  isVersionRef,
  validateTaskArtifact,
  validateTaskFamily,
  validateTaskFamilyAssignment,
  validateTaskFamilyRelation,
  validateTaskFacetAnnotation,
  validateTaskImport,
  validateTaskInstance,
  validateTaskRecord,
  validateTaskVersion,
} from "./task-validation";
import type {
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskImportPayload,
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "./task-types";

// --- fixtures ----------------------------------------------------------------

const VALID_DIGEST = "sha256:" + "a".repeat(64);
const VALID_DIGEST_B = "sha256:" + "b".repeat(64);

function validTaskRecord(): TaskRecord {
  return {
    id: "task-1",
    latestVersion: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    origin: "authored",
    revision: 0,
  };
}

function validTaskVersion(): TaskVersion {
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
        metadataDigest: VALID_DIGEST,
        mediaType: "text/plain",
        byteCount: 42,
      },
    ],
    responseContract: { format: "markdown", constraints: ["no preamble"], maxLength: 500 },
    taskVerifierRef: { id: "verifier-1", version: 2 },
    source: { kind: "authored", legacyScopeKey: null, note: null },
    createdAt: 1_000,
  };
}

function validTaskArtifact(): TaskArtifact {
  return {
    id: "art-1",
    contentDigest: VALID_DIGEST,
    mediaType: "text/plain",
    byteCount: 42,
    storageRef: "blob://art-1",
    createdAt: 1_000,
  };
}

function validTaskInstance(): TaskInstance {
  return {
    id: "inst-1",
    taskId: "task-1",
    taskVersion: 1,
    normalizedInput: {
      text: "Summarize this.",
      artifactIds: ["art-1"],
      metadata: { locale: "en" },
    },
    contextManifest: [
      {
        role: "primary",
        artifactId: "art-1",
        externalRef: null,
        metadataDigest: VALID_DIGEST,
        mediaType: "text/plain",
        byteCount: 42,
      },
    ],
    inputDigest: VALID_DIGEST,
    inputCompleteness: "complete",
    createdAt: 1_000,
    sourceRef: { kind: "authored", legacyScopeKey: null, originId: null },
  };
}

function validTaskFamily(): TaskFamily {
  return {
    id: "fam-1",
    name: "Summarization",
    description: "Tasks that summarize documents.",
    parentFamilyId: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    archivedAt: null,
    revision: 0,
  };
}

function validTaskFamilyAssignment(): TaskFamilyAssignment {
  return {
    id: "asg-1",
    taskId: "task-1",
    taskVersion: 1,
    familyId: "fam-1",
    isPrimary: true,
    createdAt: 1_000,
    revision: 0,
    archivedAt: null,
  };
}

function validTaskFamilyRelation(): TaskFamilyRelation {
  return {
    id: "rel-1",
    fromFamilyId: "fam-1",
    toFamilyId: "fam-2",
    kind: "overlap",
    createdAt: 1_000,
  };
}

function validTaskFacetAnnotation(): TaskFacetAnnotation {
  return {
    id: "ann-1",
    taskId: "task-1",
    taskVersion: 1,
    facetId: "domain",
    valueId: "nlp",
    source: "authored",
    authorKind: "user",
    confidence: 0.8,
    taxonomyVersion: 1,
    createdAt: 1_000,
    supersedesId: null,
  };
}

function validImportPayload(): TaskImportPayload {
  return {
    tasks: [validTaskRecord()],
    taskVersions: [validTaskVersion()],
    taskArtifacts: [validTaskArtifact()],
    taskInstances: [validTaskInstance()],
    taskFamilies: [validTaskFamily(), { ...validTaskFamily(), id: "fam-2", name: "Reasoning" }],
    taskFamilyAssignments: [validTaskFamilyAssignment()],
    taskFamilyRelations: [validTaskFamilyRelation()],
    taskFacetAnnotations: [validTaskFacetAnnotation()],
  };
}

// --- tests -------------------------------------------------------------------

describe("ID_PATTERN / DIGEST_PATTERN", () => {
  it("ID_PATTERN accepts canonical opaque ids and rejects bad ones", () => {
    expect(ID_PATTERN.test("abc-DEF_123.x:y")).toBe(true);
    expect(ID_PATTERN.test("task-1")).toBe(true);
    expect(ID_PATTERN.test("")).toBe(false);
    expect(ID_PATTERN.test("a".repeat(129))).toBe(false);
    expect(ID_PATTERN.test("bad id!")).toBe(false);
  });

  it("DIGEST_PATTERN accepts sha256+64 hex and rejects others", () => {
    expect(DIGEST_PATTERN.test(VALID_DIGEST)).toBe(true);
    expect(DIGEST_PATTERN.test("sha256:" + "A".repeat(64))).toBe(false); // uppercase
    expect(DIGEST_PATTERN.test("sha256:" + "a".repeat(63))).toBe(false);
    expect(DIGEST_PATTERN.test("md5:abc")).toBe(false);
  });
});

describe("PROHIBITED_KEYS / hasProhibitedKeys", () => {
  it("exposes the canonical 6-key set", () => {
    expect(PROHIBITED_KEYS.has("apiKey")).toBe(true);
    expect(PROHIBITED_KEYS.has("authorization")).toBe(true);
    expect(PROHIBITED_KEYS.has("token")).toBe(true);
    expect(PROHIBITED_KEYS.has("secret")).toBe(true);
    expect(PROHIBITED_KEYS.has("password")).toBe(true);
    expect(PROHIBITED_KEYS.has("env")).toBe(true);
    expect(PROHIBITED_KEYS.size).toBe(6);
  });

  it("CREDENTIAL_LIKE_VALUE matches the canonical auth prefixes", () => {
    expect(CREDENTIAL_LIKE_VALUE.test("sk-live123")).toBe(true);
    expect(CREDENTIAL_LIKE_VALUE.test("AIzaXYZ")).toBe(true);
    expect(CREDENTIAL_LIKE_VALUE.test("Bearer xyz")).toBe(true);
    expect(CREDENTIAL_LIKE_VALUE.test("plain-text")).toBe(false);
  });

  it("hasProhibitedKeys deep-scans arrays and nested records", () => {
    expect(hasProhibitedKeys({ a: [{ token: "leak" }] })).toBe(true);
    expect(hasProhibitedKeys({ a: { b: { secret: "x" } } })).toBe(true);
    expect(hasProhibitedKeys({ a: 1, b: "ok" })).toBe(false);
    expect(hasProhibitedKeys([{ ok: 1 }, { ok: 2 }])).toBe(false);
  });
});

describe("isVersionRef", () => {
  it("accepts a well-formed ref", () => {
    expect(isVersionRef({ id: "verifier-1", version: 2 })).toBe(true);
  });
  it("rejects missing version, bad id, and prohibited keys", () => {
    expect(isVersionRef({ id: "verifier-1" })).toBe(false);
    expect(isVersionRef({ id: "bad id!", version: 1 })).toBe(false);
    expect(isVersionRef({ id: "verifier-1", version: 0 })).toBe(false);
    expect(isVersionRef({ id: "verifier-1", version: 1, apiKey: "x" })).toBe(false);
  });
});

describe("isTaskSource", () => {
  it("accepts authored and legacy sources", () => {
    expect(isTaskSource({ kind: "authored", legacyScopeKey: null, note: null })).toBe(true);
    expect(isTaskSource({ kind: "legacy-task-set", legacyScopeKey: "s1:t1", note: "migrated" })).toBe(true);
  });
  it("rejects unknown kind and prohibited keys", () => {
    expect(isTaskSource({ kind: "promoted-comparison", legacyScopeKey: null, note: null })).toBe(false);
    expect(isTaskSource({ kind: "authored", legacyScopeKey: null, note: null, secret: "x" })).toBe(false);
  });
});

describe("isContextManifestEntry", () => {
  it("accepts an artifact-resolved entry and an external-ref entry", () => {
    expect(
      isContextManifestEntry({
        role: "primary",
        artifactId: "art-1",
        externalRef: null,
        metadataDigest: VALID_DIGEST,
        mediaType: "text/plain",
        byteCount: 42,
      }),
    ).toBe(true);
    expect(
      isContextManifestEntry({
        role: "ref",
        artifactId: null,
        externalRef: "https://example.com/x",
        metadataDigest: null,
        mediaType: null,
        byteCount: null,
      }),
    ).toBe(true);
  });
  it("rejects an entry that resolves to neither artifact nor external ref", () => {
    expect(
      isContextManifestEntry({
        role: "r",
        artifactId: null,
        externalRef: null,
        metadataDigest: null,
        mediaType: null,
        byteCount: null,
      }),
    ).toBe(false);
  });
  it("rejects a bad digest and prohibited keys", () => {
    expect(
      isContextManifestEntry({
        role: "r",
        artifactId: "art-1",
        externalRef: null,
        metadataDigest: "not-a-digest",
        mediaType: null,
        byteCount: null,
      }),
    ).toBe(false);
    expect(
      isContextManifestEntry({
        role: "r",
        artifactId: "art-1",
        externalRef: null,
        metadataDigest: null,
        mediaType: null,
        byteCount: null,
        token: "leak",
      }),
    ).toBe(false);
  });
});

describe("isResponseContract", () => {
  it("accepts a well-formed contract", () => {
    expect(isResponseContract({ format: "markdown", constraints: ["a"], maxLength: null })).toBe(true);
  });
  it("rejects non-string constraints and bad maxLength", () => {
    expect(isResponseContract({ format: "md", constraints: ["a", 1], maxLength: null })).toBe(false);
    expect(isResponseContract({ format: "md", constraints: [], maxLength: -1 })).toBe(false);
  });
});

describe("isNormalizedTaskInput", () => {
  it("accepts well-formed input", () => {
    expect(isNormalizedTaskInput({ text: "hi", artifactIds: ["art-1"], metadata: { k: "v" } })).toBe(true);
    expect(isNormalizedTaskInput({ text: "", artifactIds: [], metadata: {} })).toBe(true);
  });
  it("rejects non-string metadata values and bad artifact ids", () => {
    expect(isNormalizedTaskInput({ text: "hi", artifactIds: ["bad id!"], metadata: {} })).toBe(false);
    expect(isNormalizedTaskInput({ text: "hi", artifactIds: [], metadata: { k: 1 } })).toBe(false);
  });
});

describe("isTaskInstanceSourceRef", () => {
  it("accepts all valid kinds", () => {
    for (const kind of ["authored", "legacy-task-set", "comparison", "imported"] as const) {
      expect(isTaskInstanceSourceRef({ kind, legacyScopeKey: null, originId: null })).toBe(true);
    }
  });
  it("rejects unknown kind and bad origin id", () => {
    expect(isTaskInstanceSourceRef({ kind: "ad-hoc", legacyScopeKey: null, originId: null })).toBe(false);
    expect(isTaskInstanceSourceRef({ kind: "authored", legacyScopeKey: null, originId: "bad id!" })).toBe(false);
  });
});

describe("isFacetTaxonomyValue", () => {
  it("accepts a well-formed value", () => {
    expect(isFacetTaxonomyValue({ facetId: "domain", valueId: "nlp", label: "NLP", taxonomyVersion: 1 })).toBe(true);
  });
  it("rejects secret-shaped identifiers and bad taxonomy version", () => {
    expect(
      isFacetTaxonomyValue({ facetId: "sk-live123", valueId: "nlp", label: "NLP", taxonomyVersion: 1 }),
    ).toBe(false);
    expect(
      isFacetTaxonomyValue({ facetId: "domain", valueId: "Bearer x", label: "NLP", taxonomyVersion: 1 }),
    ).toBe(false);
    expect(
      isFacetTaxonomyValue({ facetId: "domain", valueId: "nlp", label: "NLP", taxonomyVersion: 0 }),
    ).toBe(false);
  });
});

describe("isTaskRecord", () => {
  it("accepts a valid record across all origins", () => {
    for (const origin of ["authored", "legacy-task-set", "promoted-comparison", "imported"] as const) {
      expect(isTaskRecord({ ...validTaskRecord(), origin })).toBe(true);
    }
    expect(isTaskRecord({ ...validTaskRecord(), archivedAt: 2_000 })).toBe(true);
  });
  it("rejects bad id, non-positive latestVersion, bad origin, negative revision", () => {
    expect(isTaskRecord({ ...validTaskRecord(), id: "bad id!" })).toBe(false);
    expect(isTaskRecord({ ...validTaskRecord(), latestVersion: 0 })).toBe(false);
    expect(isTaskRecord({ ...validTaskRecord(), origin: "ad-hoc" as never })).toBe(false);
    expect(isTaskRecord({ ...validTaskRecord(), revision: -1 })).toBe(false);
  });
  it("rejects a prohibited key at the top level", () => {
    const r = validTaskRecord() as unknown as Record<string, unknown>;
    r.apiKey = "leak";
    expect(isTaskRecord(r)).toBe(false);
  });
});

describe("isTaskVersion (immutable)", () => {
  it("accepts a valid version with null contract/verifier and empty manifest", () => {
    const v = {
      ...validTaskVersion(),
      defaultContextManifest: [],
      responseContract: null,
      taskVerifierRef: null,
    };
    expect(isTaskVersion(v)).toBe(true);
  });
  it("does not carry mutable lifecycle fields (immutable shape)", () => {
    const v = validTaskVersion();
    // A committed version has no revision/archivedAt/updatedAt/origin/latestVersion.
    expect("revision" in v).toBe(false);
    expect("archivedAt" in v).toBe(false);
    expect("updatedAt" in v).toBe(false);
    expect("origin" in v).toBe(false);
    expect("latestVersion" in v).toBe(false);
  });
  it("rejects bad taskId, non-positive version, empty title/objective, bad manifest entry", () => {
    expect(isTaskVersion({ ...validTaskVersion(), taskId: "bad id!" })).toBe(false);
    expect(isTaskVersion({ ...validTaskVersion(), version: 0 })).toBe(false);
    expect(isTaskVersion({ ...validTaskVersion(), title: "" })).toBe(false);
    expect(isTaskVersion({ ...validTaskVersion(), objective: "" })).toBe(false);
    expect(
      isTaskVersion({
        ...validTaskVersion(),
        defaultContextManifest: [
          { role: "r", artifactId: null, externalRef: null, metadataDigest: null, mediaType: null, byteCount: null },
        ],
      }),
    ).toBe(false);
  });
  it("rejects a prohibited key nested in the manifest", () => {
    const v = validTaskVersion();
    (v.defaultContextManifest[0] as unknown as Record<string, unknown>).secret = "leak";
    expect(isTaskVersion(v)).toBe(false);
  });
});

describe("isTaskArtifact", () => {
  it("accepts a valid artifact", () => {
    expect(isTaskArtifact(validTaskArtifact())).toBe(true);
    expect(isTaskArtifact({ ...validTaskArtifact(), byteCount: 0 })).toBe(true);
  });
  it("rejects a bad digest, empty mediaType, negative byteCount", () => {
    expect(isTaskArtifact({ ...validTaskArtifact(), contentDigest: "nope" })).toBe(false);
    expect(isTaskArtifact({ ...validTaskArtifact(), mediaType: "" })).toBe(false);
    expect(isTaskArtifact({ ...validTaskArtifact(), byteCount: -1 })).toBe(false);
  });
  it("rejects a secret-shaped storageRef (indexed metadata)", () => {
    expect(isTaskArtifact({ ...validTaskArtifact(), storageRef: "sk-live123" })).toBe(false);
    expect(isTaskArtifact({ ...validTaskArtifact(), storageRef: "Bearer xyz" })).toBe(false);
  });
  it("rejects a prohibited key nested in the artifact", () => {
    const a = validTaskArtifact() as unknown as Record<string, unknown>;
    a.authorization = "leak";
    expect(isTaskArtifact(a)).toBe(false);
  });
});

describe("isTaskInstance (completeness)", () => {
  it("accepts all three completeness states", () => {
    for (const c of TASK_INPUT_COMPLETENESS_VALUES) {
      expect(isTaskInstance({ ...validTaskInstance(), inputCompleteness: c })).toBe(true);
    }
  });
  it("rejects an unknown completeness value", () => {
    expect(isTaskInstance({ ...validTaskInstance(), inputCompleteness: "partial" as never })).toBe(false);
  });
  it("rejects a bad inputDigest and unknown task version ref shape", () => {
    expect(isTaskInstance({ ...validTaskInstance(), inputDigest: "nope" })).toBe(false);
    expect(isTaskInstance({ ...validTaskInstance(), sourceRef: { kind: "ad-hoc" } as never })).toBe(false);
  });
  it("rejects a prohibited key nested in normalizedInput.metadata", () => {
    const inst = validTaskInstance();
    inst.normalizedInput.metadata = { env: "leak" };
    expect(isTaskInstance(inst)).toBe(false);
  });
});

describe("isTaskFamily", () => {
  it("accepts a valid family with and without parent", () => {
    expect(isTaskFamily(validTaskFamily())).toBe(true);
    expect(isTaskFamily({ ...validTaskFamily(), parentFamilyId: "fam-0" })).toBe(true);
    expect(isTaskFamily({ ...validTaskFamily(), archivedAt: 2_000 })).toBe(true);
  });
  it("rejects empty name, bad parent id, negative revision", () => {
    expect(isTaskFamily({ ...validTaskFamily(), name: "" })).toBe(false);
    expect(isTaskFamily({ ...validTaskFamily(), parentFamilyId: "bad id!" })).toBe(false);
    expect(isTaskFamily({ ...validTaskFamily(), revision: -1 })).toBe(false);
  });
});

describe("isTaskFamilyRelation", () => {
  it("accepts a typed relation between distinct families", () => {
    expect(
      isTaskFamilyRelation({ id: "rel-1", fromFamilyId: "fam-1", toFamilyId: "fam-2", kind: "overlap", createdAt: 1 }),
    ).toBe(true);
  });
  it("rejects self-relations and unknown kinds", () => {
    expect(
      isTaskFamilyRelation({ id: "rel-1", fromFamilyId: "fam-1", toFamilyId: "fam-1", kind: "overlap", createdAt: 1 }),
    ).toBe(false);
    expect(
      isTaskFamilyRelation({ id: "rel-1", fromFamilyId: "fam-1", toFamilyId: "fam-2", kind: "subset" as never, createdAt: 1 }),
    ).toBe(false);
  });
});

describe("isTaskFamilyAssignment", () => {
  it("accepts primary and non-primary assignments", () => {
    expect(isTaskFamilyAssignment(validTaskFamilyAssignment())).toBe(true);
    expect(isTaskFamilyAssignment({ ...validTaskFamilyAssignment(), isPrimary: false })).toBe(true);
  });
  it("rejects a non-boolean isPrimary and unknown family", () => {
    expect(isTaskFamilyAssignment({ ...validTaskFamilyAssignment(), isPrimary: "yes" as never })).toBe(false);
    expect(isTaskFamilyAssignment({ ...validTaskFamilyAssignment(), familyId: "bad id!" })).toBe(false);
  });
});

describe("isTaskFacetAnnotation", () => {
  it("accepts authored, suggested, and imported annotations with null version", () => {
    for (const source of ["authored", "suggested", "imported"] as const) {
      expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), source })).toBe(true);
    }
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), taskVersion: null })).toBe(true);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), confidence: null })).toBe(true);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), supersedesId: "ann-0" })).toBe(true);
  });
  it("rejects secret-shaped facetId/valueId (indexed identifiers)", () => {
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), facetId: "sk-live123" })).toBe(false);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), valueId: "Bearer xyz" })).toBe(false);
  });
  it("rejects out-of-range confidence, bad taxonomy version, bad supersedesId", () => {
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), confidence: 1.5 })).toBe(false);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), confidence: -0.1 })).toBe(false);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), taxonomyVersion: 0 })).toBe(false);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), supersedesId: "bad id!" })).toBe(false);
  });
  it("rejects unknown source/authorKind", () => {
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), source: "auto" as never })).toBe(false);
    expect(isTaskFacetAnnotation({ ...validTaskFacetAnnotation(), authorKind: "agent" as never })).toBe(false);
  });
});

describe("facet taxonomy dimensions", () => {
  it("exposes the eight orthogonal dimensions from the spec", () => {
    expect(TASK_FACET_DIMENSIONS).toEqual([
      "domain",
      "task-form",
      "transformation",
      "constraint",
      "interaction-mode",
      "modality",
      "evaluation-type",
      "setting",
    ]);
    expect(TASK_FACET_DIMENSIONS.length).toBe(8);
  });
});

// --- {valid, errors} validators --------------------------------------------

describe("validateTaskRecord", () => {
  it("returns valid:true with no errors for a good record", () => {
    const r = validateTaskRecord(validTaskRecord());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it("collects field-specific errors", () => {
    const r = validateTaskRecord({ ...validTaskRecord(), id: "bad id!", latestVersion: 0, revision: -1 });
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["id", "latestVersion", "revision"]));
  });
  it("reports prohibited keys", () => {
    const rec = validTaskRecord() as unknown as Record<string, unknown>;
    rec.env = { X: "1" };
    const r = validateTaskRecord(rec);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("prohibited"))).toBe(true);
  });
});

describe("validateTaskVersion", () => {
  it("returns valid:true for a good version", () => {
    expect(validateTaskVersion(validTaskVersion()).valid).toBe(true);
  });
  it("reports malformed manifest entries with their index", () => {
    const v = validTaskVersion();
    v.defaultContextManifest[0] = {
      role: "r",
      artifactId: null,
      externalRef: null,
      metadataDigest: null,
      mediaType: null,
      byteCount: null,
    };
    const r = validateTaskVersion(v);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field.startsWith("defaultContextManifest[0]"))).toBe(true);
  });
});

describe("validateTaskArtifact", () => {
  it("returns valid:true for a good artifact", () => {
    expect(validateTaskArtifact(validTaskArtifact()).valid).toBe(true);
  });
  it("reports a secret-shaped storageRef", () => {
    const r = validateTaskArtifact({ ...validTaskArtifact(), storageRef: "sk-live123" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "storageRef")).toBe(true);
  });
});

describe("validateTaskInstance", () => {
  it("returns valid:true for a good instance", () => {
    expect(validateTaskInstance(validTaskInstance()).valid).toBe(true);
  });
  it("reports an invalid completeness value", () => {
    const r = validateTaskInstance({ ...validTaskInstance(), inputCompleteness: "partial" as never });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "inputCompleteness")).toBe(true);
  });
});

describe("validateTaskFamily / validateTaskFamilyAssignment / validateTaskFacetAnnotation", () => {
  it("validateTaskFamily returns valid:true for a good family", () => {
    expect(validateTaskFamily(validTaskFamily()).valid).toBe(true);
  });
  it("validateTaskFamilyAssignment returns valid:true for a good assignment", () => {
    expect(validateTaskFamilyAssignment(validTaskFamilyAssignment()).valid).toBe(true);
  });
  it("validateTaskFacetAnnotation reports secret-shaped facetId", () => {
    const r = validateTaskFacetAnnotation({ ...validTaskFacetAnnotation(), facetId: "sk-live123" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "facetId")).toBe(true);
  });
});

// --- import payload ---------------------------------------------------------

describe("validateTaskImport", () => {
  it("accepts a coherent payload", () => {
    const r = validateTaskImport(validImportPayload());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a non-object payload", () => {
    const r = validateTaskImport("nope");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("must be an object"))).toBe(true);
  });

  it("rejects a payload with a missing/non-array collection", () => {
    const p = validImportPayload() as unknown as Record<string, unknown>;
    delete p.taskVersions;
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskVersions")).toBe(true);
  });

  it("rejects a version that references an unknown task", () => {
    const p = validImportPayload();
    p.taskVersions[0].taskId = "no-such-task";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskVersions[0].taskId")).toBe(true);
  });

  it("rejects an instance that references an unknown version", () => {
    const p = validImportPayload();
    p.taskInstances[0].taskVersion = 99;
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskInstances[0].taskVersion")).toBe(true);
  });

  it("rejects a family assignment that references an unknown family", () => {
    const p = validImportPayload();
    p.taskFamilyAssignments[0].familyId = "no-such-family";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFamilyAssignments[0].familyId")).toBe(true);
  });

  it("rejects an annotation that supersedes an unknown annotation", () => {
    const p = validImportPayload();
    p.taskFacetAnnotations[0].supersedesId = "no-such-annotation";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFacetAnnotations[0].supersedesId")).toBe(true);
  });

  it("rejects a self-parenting family", () => {
    const p = validImportPayload();
    p.taskFamilies[0].parentFamilyId = p.taskFamilies[0].id;
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFamilies[0].parentFamilyId")).toBe(true);
  });

  it("rejects duplicate task ids", () => {
    const p = validImportPayload();
    p.tasks.push({ ...validTaskRecord() });
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate task id"))).toBe(true);
  });

  it("rejects a duplicate version (same taskId+version)", () => {
    const p = validImportPayload();
    p.taskVersions.push({ ...validTaskVersion() });
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate version"))).toBe(true);
  });

  it("rejects a prohibited key nested deep in any entity", () => {
    const p = validImportPayload();
    (p.taskArtifacts[0] as unknown as Record<string, unknown>).authorization = "leak";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field.startsWith("taskArtifacts[0]"))).toBe(true);
  });

  it("resolves a supersession chain when the predecessor is present", () => {
    const p = validImportPayload();
    const later: TaskFacetAnnotation = {
      ...validTaskFacetAnnotation(),
      id: "ann-2",
      supersedesId: "ann-1",
    };
    p.taskFacetAnnotations.push(later);
    expect(validateTaskImport(p).valid).toBe(true);
  });

  it("resolves a supersession reference when the predecessor appears later in the array", () => {
    const p = validImportPayload();
    const predecessor = validTaskFacetAnnotation();
    const later: TaskFacetAnnotation = {
      ...validTaskFacetAnnotation(),
      id: "ann-2",
      supersedesId: "ann-1",
    };
    p.taskFacetAnnotations = [later, predecessor];
    expect(validateTaskImport(p).valid).toBe(true);
  });

  it("rejects a dangling version-manifest artifactId", () => {
    const p = validImportPayload();
    p.taskVersions[0].defaultContextManifest[0].artifactId = "no-such-art";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(
      r.errors.some((e) => e.field === "taskVersions[0].defaultContextManifest[0].artifactId"),
    ).toBe(true);
  });

  it("rejects a dangling instance normalizedInput artifactId", () => {
    const p = validImportPayload();
    p.taskInstances[0].normalizedInput.artifactIds = ["no-such-art"];
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskInstances[0].normalizedInput.artifactIds[0]")).toBe(
      true,
    );
  });

  it("rejects a dangling instance contextManifest artifactId", () => {
    const p = validImportPayload();
    p.taskInstances[0].contextManifest[0].artifactId = "no-such-art";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskInstances[0].contextManifest[0].artifactId")).toBe(
      true,
    );
  });

  it("rejects a version history with a gap before latestVersion", () => {
    const p = validImportPayload();
    p.tasks[0].latestVersion = 3;
    p.taskVersions.push({ ...validTaskVersion(), version: 3, createdAt: 3_000 });
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("missing version 2"))).toBe(true);
  });

  it("rejects a version history missing v1", () => {
    const p = validImportPayload();
    p.tasks[0].latestVersion = 2;
    p.taskVersions[0].version = 2;
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("missing version 1"))).toBe(true);
  });

  it("rejects a stale latestVersion when a higher version is imported", () => {
    const p = validImportPayload();
    p.tasks[0].latestVersion = 1;
    p.taskVersions.push({ ...validTaskVersion(), version: 2, createdAt: 2_000 });
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("exceeds") && e.message.includes("latestVersion"))).toBe(
      true,
    );
  });

  it("accepts a contiguous 1..latestVersion history independent of array order", () => {
    const p = validImportPayload();
    p.tasks[0].latestVersion = 2;
    const v1 = validTaskVersion();
    const v2 = { ...validTaskVersion(), version: 2, createdAt: 2_000 };
    p.taskVersions = [v2, v1];
    expect(validateTaskImport(p).valid).toBe(true);
  });

  it("rejects duplicate instance ids", () => {
    const p = validImportPayload();
    p.taskInstances.push({ ...validTaskInstance() });
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate instance id"))).toBe(true);
  });

  it("uses two distinct digests without collision confusion", () => {
    const p = validImportPayload();
    p.taskArtifacts[0].contentDigest = VALID_DIGEST_B;
    p.taskInstances[0].inputDigest = VALID_DIGEST_B;
    expect(validateTaskImport(p).valid).toBe(true);
  });
});

// --- Task 8A: typed family relations, facet taxonomy seam ------------------

describe("validateTaskFamilyRelation", () => {
  it("returns valid:true for a well-formed relation between distinct families", () => {
    const r = validateTaskFamilyRelation(validTaskFamilyRelation());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects a self-relation (fromFamilyId === toFamilyId)", () => {
    const r = validateTaskFamilyRelation({
      ...validTaskFamilyRelation(),
      toFamilyId: validTaskFamilyRelation().fromFamilyId,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "fromFamilyId" || e.field === "toFamilyId")).toBe(true);
  });

  it("rejects an unknown relation kind", () => {
    const r = validateTaskFamilyRelation({
      ...validTaskFamilyRelation(),
      kind: "subset" as never,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "kind")).toBe(true);
  });

  it("rejects a malformed id and missing createdAt", () => {
    expect(
      validateTaskFamilyRelation({ ...validTaskFamilyRelation(), id: "bad id!" }).valid,
    ).toBe(false);
    expect(
      validateTaskFamilyRelation({ ...validTaskFamilyRelation(), createdAt: "x" as never }).valid,
    ).toBe(false);
  });

  it("rejects a prohibited key nested in the relation", () => {
    const rel = validTaskFamilyRelation() as unknown as Record<string, unknown>;
    rel.secret = "leak";
    expect(validateTaskFamilyRelation(rel).valid).toBe(false);
  });
});

describe("validateTaskImport — taskFamilyRelations collection", () => {
  it("accepts a payload that includes a coherent taskFamilyRelations collection", () => {
    expect(validateTaskImport(validImportPayload()).valid).toBe(true);
  });

  it("rejects a payload missing the taskFamilyRelations array", () => {
    const p = validImportPayload() as unknown as Record<string, unknown>;
    delete p.taskFamilyRelations;
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFamilyRelations")).toBe(true);
  });

  it("rejects duplicate relation ids", () => {
    const p = validImportPayload();
    p.taskFamilyRelations.push({ ...validTaskFamilyRelation() });
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("duplicate relation id"))).toBe(true);
  });

  it("rejects a relation whose fromFamilyId is unknown", () => {
    const p = validImportPayload();
    p.taskFamilyRelations[0].fromFamilyId = "no-such-family";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFamilyRelations[0].fromFamilyId")).toBe(true);
  });

  it("rejects a relation whose toFamilyId is unknown", () => {
    const p = validImportPayload();
    p.taskFamilyRelations[0].toFamilyId = "no-such-family";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFamilyRelations[0].toFamilyId")).toBe(true);
  });

  it("rejects a self-relation inside the import collection", () => {
    const p = validImportPayload();
    p.taskFamilies = [validTaskFamily()]; // single family
    p.taskFamilyRelations[0] = {
      ...validTaskFamilyRelation(),
      fromFamilyId: "fam-1",
      toFamilyId: "fam-1",
    };
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("self"))).toBe(true);
  });

  it("rejects a relation with an unknown kind inside the import collection", () => {
    const p = validImportPayload();
    p.taskFamilyRelations[0] = {
      ...validTaskFamilyRelation(),
      kind: "subset" as never,
    };
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === "taskFamilyRelations[0].kind")).toBe(true);
  });

  it("rejects a prohibited key nested in any relation", () => {
    const p = validImportPayload();
    (p.taskFamilyRelations[0] as unknown as Record<string, unknown>).authorization = "leak";
    const r = validateTaskImport(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field.startsWith("taskFamilyRelations[0]"))).toBe(true);
  });
});

describe("facet taxonomy allowlist seam", () => {
  it("exposes a stable taxonomy version set with at least one version", () => {
    expect(FACET_TAXONOMY_VERSIONS.length).toBeGreaterThan(0);
    // Versions are positive integers and sorted ascending.
    for (const v of FACET_TAXONOMY_VERSIONS) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    const sorted = [...FACET_TAXONOMY_VERSIONS].sort((a, b) => a - b);
    expect(FACET_TAXONOMY_VERSIONS).toEqual(sorted);
  });

  it("FACET_TAXONOMY_VALUES covers exactly the eight spec dimensions", () => {
    const dims = new Set(FACET_TAXONOMY_VALUES.map((v) => v.facetId));
    expect(dims).toEqual(new Set(TASK_FACET_DIMENSIONS));
  });

  it("every taxonomy value has a stable identity and positive taxonomy version", () => {
    for (const v of FACET_TAXONOMY_VALUES) {
      expect(isFacetTaxonomyValue(v)).toBe(true);
      expect(v.taxonomyVersion).toBeGreaterThan(0);
    }
  });

  it("getFacetTaxonomyValues returns the allowlist for a known version", () => {
    const v = FACET_TAXONOMY_VERSIONS[0];
    const values = getFacetTaxonomyValues(v);
    expect(values.length).toBeGreaterThan(0);
    for (const val of values) {
      expect(val.taxonomyVersion).toBe(v);
    }
  });

  it("getFacetTaxonomyValues returns [] for an unknown version (no inference)", () => {
    expect(getFacetTaxonomyValues(999_999)).toEqual([]);
  });

  it("does not invent automatic classification or mutable global taxonomy ownership", () => {
    // The seam is a read-only allowlist: no setter, no classifier, no mutation
    // surface. The exported shape is a frozen readonly list and a pure getter.
    expect(Object.isFrozen(FACET_TAXONOMY_VALUES)).toBe(true);
    expect(Object.isFrozen(FACET_TAXONOMY_VERSIONS)).toBe(true);
  });
});
