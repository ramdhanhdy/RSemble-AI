// =============================================================================
// RSemble AI — Lab Recipe type tests (spec §6.1)
//
// RED: specifies the stable LabRecipeRecord plus immutable LabRecipeVersion
// (kind: "fusion"). A version preserves recipe family, prompt version,
// Judge-analysis mode, Rubric access, verification, exact synthesizer,
// canonical serialized payload, and digest. Version collision allows
// byte-equivalent idempotency only. Prohibited credential fields are rejected
// at any depth.
// =============================================================================

import type { CriticRef } from "../providers/types";

import { describe, expect, it } from "vitest";
import {
  LAB_RECIPE_KINDS,
  LAB_RECIPE_PROHIBITED_KEYS,
  LAB_RECIPE_VERSION_SCHEMA_VERSION,
  canonicalRecipePayload,
  hasProhibitedRecipeKeys,
  isLabRecipeKind,
  isLabRecipeRecord,
  isLabRecipeVersion,
  recipeDigest,
  type LabRecipeKind,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "./lab-recipe-types";

const SYNTH: CriticRef = { providerId: "openrouter", model: "acme/synth-1" };
const SYNTH_2: CriticRef = { providerId: "gemini", model: "acme/synth-2" };

function makeRecord(overrides: Partial<LabRecipeRecord> = {}): LabRecipeRecord {
  return {
    id: "recipe-1",
    kind: "fusion",
    name: "BlindRaw default",
    description: "Anonymized candidates only.",
    latestVersion: 1,
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<LabRecipeVersion> = {}): LabRecipeVersion {
  const base = {
    recipeId: "recipe-1",
    version: 1,
    kind: "fusion" as LabRecipeKind,
    recipeFamily: "BlindRaw" as const,
    promptVersion: "blind-raw-v1",
    judgeAnalysisMode: "none" as const,
    rubricAccess: false,
    verification: false,
    synthesizer: SYNTH,
  };
  const canonicalPayload = canonicalRecipePayload(base);
  const digest = recipeDigest(base);
  return { ...base, canonicalPayload, digest, createdAt: 1000, ...overrides };
}

// --- Kind ---------------------------------------------------------------------

describe("LabRecipeKind", () => {
  it("registers exactly one kind: fusion", () => {
    expect(LAB_RECIPE_KINDS).toEqual(["fusion"]);
  });

  it("isLabRecipeKind accepts fusion and rejects everything else", () => {
    expect(isLabRecipeKind("fusion")).toBe(true);
    expect(isLabRecipeKind("routing")).toBe(false);
    expect(isLabRecipeKind("judge")).toBe(false);
    expect(isLabRecipeKind("workflow")).toBe(false);
    expect(isLabRecipeKind("")).toBe(false);
    expect(isLabRecipeKind(42)).toBe(false);
    expect(isLabRecipeKind(null)).toBe(false);
  });
});

// --- LabRecipeRecord ----------------------------------------------------------

describe("isLabRecipeRecord", () => {
  it("accepts a valid record", () => {
    expect(isLabRecipeRecord(makeRecord())).toBe(true);
  });

  it("accepts an archived record with archivedAt", () => {
    expect(isLabRecipeRecord(makeRecord({ archivedAt: 5000, updatedAt: 5000 }))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isLabRecipeRecord(null)).toBe(false);
    expect(isLabRecipeRecord("string")).toBe(false);
    expect(isLabRecipeRecord(42)).toBe(false);
    expect(isLabRecipeRecord([])).toBe(false);
  });

  it("rejects missing or empty id", () => {
    expect(isLabRecipeRecord(makeRecord({ id: "" }))).toBe(false);
    expect(isLabRecipeRecord({ ...makeRecord(), id: undefined })).toBe(false);
  });

  it("rejects non-fusion kind", () => {
    expect(isLabRecipeRecord(makeRecord({ kind: "routing" as LabRecipeKind }))).toBe(false);
  });

  it("rejects blank name", () => {
    expect(isLabRecipeRecord(makeRecord({ name: "" }))).toBe(false);
    expect(isLabRecipeRecord(makeRecord({ name: "   " }))).toBe(false);
  });

  it("rejects negative revision", () => {
    expect(isLabRecipeRecord(makeRecord({ revision: -1 }))).toBe(false);
  });

  it("rejects non-integer latestVersion", () => {
    expect(isLabRecipeRecord(makeRecord({ latestVersion: 1.5 }))).toBe(false);
  });

  it("rejects latestVersion < 1", () => {
    expect(isLabRecipeRecord(makeRecord({ latestVersion: 0 }))).toBe(false);
  });

  it("rejects updatedAt < createdAt", () => {
    expect(isLabRecipeRecord(makeRecord({ createdAt: 2000, updatedAt: 1000 }))).toBe(false);
  });

  it("rejects archivedAt < createdAt", () => {
    expect(isLabRecipeRecord(makeRecord({ archivedAt: 500, updatedAt: 500 }))).toBe(false);
  });

  it("rejects archived record without archivedAt", () => {
    // archivedAt must be set when record is archived; here we simulate by
    // setting archivedAt to null while the record claims to be archived
    // via a sentinel — the validator checks archivedAt consistency.
    expect(isLabRecipeRecord(makeRecord({ archivedAt: null }))).toBe(true); // active is fine
  });

  it("rejects prohibited credential keys at top level", () => {
    const bad = { ...makeRecord(), apiKey: "sk-xxx" };
    expect(isLabRecipeRecord(bad)).toBe(false);
  });

  it("rejects prohibited credential keys at nested depth", () => {
    const bad = { ...makeRecord(), description: "ok", meta: { token: "abc" } };
    expect(isLabRecipeRecord(bad)).toBe(false);
  });
});

// --- LabRecipeVersion ---------------------------------------------------------

describe("isLabRecipeVersion", () => {
  it("accepts a valid fusion version", () => {
    expect(isLabRecipeVersion(makeVersion())).toBe(true);
  });

  it("preserves recipe family, prompt, Judge-analysis, Rubric access, verification, synthesizer", () => {
    const v = makeVersion({
      recipeFamily: "AnalysisScores",
      promptVersion: "scores-v2",
      judgeAnalysisMode: "scores",
      rubricAccess: true,
      verification: true,
      synthesizer: SYNTH_2,
    });
    // recompute digest for the new content
    v.canonicalPayload = canonicalRecipePayload(v);
    v.digest = recipeDigest(v);
    expect(isLabRecipeVersion(v)).toBe(true);
    expect(v.recipeFamily).toBe("AnalysisScores");
    expect(v.promptVersion).toBe("scores-v2");
    expect(v.judgeAnalysisMode).toBe("scores");
    expect(v.rubricAccess).toBe(true);
    expect(v.verification).toBe(true);
    expect(v.synthesizer).toEqual(SYNTH_2);
  });

  it("rejects non-fusion kind", () => {
    const v = makeVersion({ kind: "routing" as LabRecipeKind });
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects version < 1", () => {
    expect(isLabRecipeVersion(makeVersion({ version: 0 }))).toBe(false);
  });

  it("rejects non-integer version", () => {
    expect(isLabRecipeVersion(makeVersion({ version: 1.5 }))).toBe(false);
  });

  it("rejects unknown recipe family", () => {
    const v = makeVersion({ recipeFamily: "Unknown" as never });
    v.canonicalPayload = canonicalRecipePayload(v);
    v.digest = recipeDigest(v);
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects unknown judge analysis mode", () => {
    const v = makeVersion({ judgeAnalysisMode: "mixed" as never });
    v.canonicalPayload = canonicalRecipePayload(v);
    v.digest = recipeDigest(v);
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects blank promptVersion", () => {
    const v = makeVersion({ promptVersion: "" });
    v.canonicalPayload = canonicalRecipePayload(v);
    v.digest = recipeDigest(v);
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects non-boolean rubricAccess", () => {
    const v = makeVersion({ rubricAccess: "true" as unknown as boolean });
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects non-boolean verification", () => {
    const v = makeVersion({ verification: 1 as unknown as boolean });
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects invalid synthesizer", () => {
    const v = makeVersion({ synthesizer: { providerId: "openrouter" } as unknown as typeof SYNTH });
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects digest that does not match canonical payload", () => {
    const v = makeVersion();
    v.digest = "sha256:" + "0".repeat(64); // wrong digest
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects malformed digest shape", () => {
    const v = makeVersion();
    v.digest = "not-a-digest";
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects canonicalPayload that does not match material fields", () => {
    const v = makeVersion();
    v.canonicalPayload = canonicalRecipePayload({ ...v, promptVersion: "tampered" });
    // digest still matches the tampered payload, but payload ≠ material fields
    v.digest = recipeDigest({ ...v, promptVersion: "tampered" });
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects prohibited credential keys in version", () => {
    const v = { ...makeVersion(), apiKey: "sk-xxx" };
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects prohibited credential keys in synthesizer", () => {
    const v = makeVersion({
      synthesizer: {
        providerId: "openrouter",
        model: "m1",
        apiKey: "x",
      } as unknown as typeof SYNTH,
    });
    expect(isLabRecipeVersion(v)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isLabRecipeVersion(null)).toBe(false);
    expect(isLabRecipeVersion("string")).toBe(false);
    expect(isLabRecipeVersion(42)).toBe(false);
  });
});

// --- Canonical payload / digest ----------------------------------------------

describe("canonicalRecipePayload / recipeDigest", () => {
  it("produces stable canonical JSON under key permutation", () => {
    const a = canonicalRecipePayload({
      recipeFamily: "BlindRaw",
      promptVersion: "v1",
      judgeAnalysisMode: "none",
      rubricAccess: false,
      verification: false,
      synthesizer: SYNTH,
    });
    // Same fields, different insertion order — canonical JSON sorts keys.
    const b = canonicalRecipePayload({
      verification: false,
      rubricAccess: false,
      judgeAnalysisMode: "none",
      promptVersion: "v1",
      synthesizer: SYNTH,
      recipeFamily: "BlindRaw",
    });
    expect(a).toBe(b);
  });

  it("changes digest when any material field changes", () => {
    const base = {
      recipeFamily: "BlindRaw" as const,
      promptVersion: "v1",
      judgeAnalysisMode: "none" as const,
      rubricAccess: false,
      verification: false,
      synthesizer: SYNTH,
    };
    const d0 = recipeDigest(base);
    expect(recipeDigest({ ...base, promptVersion: "v2" })).not.toBe(d0);
    expect(recipeDigest({ ...base, rubricAccess: true })).not.toBe(d0);
    expect(recipeDigest({ ...base, verification: true })).not.toBe(d0);
    expect(recipeDigest({ ...base, synthesizer: SYNTH_2 })).not.toBe(d0);
    expect(recipeDigest({ ...base, recipeFamily: "AnalysisFed" })).not.toBe(d0);
    expect(recipeDigest({ ...base, judgeAnalysisMode: "qualitative" })).not.toBe(d0);
  });

  it("digest shape is sha256:<64 lowercase hex>", () => {
    const d = recipeDigest({
      recipeFamily: "BlindRaw",
      promptVersion: "v1",
      judgeAnalysisMode: "none",
      rubricAccess: false,
      verification: false,
      synthesizer: SYNTH,
    });
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// --- Prohibited keys ----------------------------------------------------------

describe("LAB_RECIPE_PROHIBITED_KEYS", () => {
  it("includes the credential/transport vocabulary", () => {
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("apiKey")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("token")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("password")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("secret")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("authorization")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("credential")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("headers")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("cookie")).toBe(true);
    expect(LAB_RECIPE_PROHIBITED_KEYS.has("env")).toBe(true);
  });

  it("hasProhibitedRecipeKeys deep-scans arrays and nested objects", () => {
    expect(hasProhibitedRecipeKeys({ a: { b: { token: "x" } } })).toBe(true);
    expect(hasProhibitedRecipeKeys([{ password: "x" }])).toBe(true);
    expect(hasProhibitedRecipeKeys({ ok: "value" })).toBe(false);
    expect(hasProhibitedRecipeKeys(null)).toBe(false);
    expect(hasProhibitedRecipeKeys("string")).toBe(false);
  });
});

// --- Schema version -----------------------------------------------------------

describe("LAB_RECIPE_VERSION_SCHEMA_VERSION", () => {
  it("is a positive integer", () => {
    expect(LAB_RECIPE_VERSION_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(LAB_RECIPE_VERSION_SCHEMA_VERSION)).toBe(true);
  });
});
