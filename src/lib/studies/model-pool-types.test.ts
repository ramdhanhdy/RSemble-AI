// =============================================================================
// RSemble AI — Model Pool type tests (spec §6.2)
//
// RED: specifies the stable ModelPoolRecord plus immutable ModelPoolVersion.
// A version preserves exact configuration members, core/challenger roles,
// diversity checklist, rationale, supersession, canonical serialized payload,
// and digest. No Model Pool aggregation or synthetic respondent semantics are
// accepted. Prohibited credential fields are rejected at any depth.
// =============================================================================

import { describe, expect, it } from "vitest";
import {
  MODEL_POOL_PROHIBITED_KEYS,
  MODEL_POOL_VERSION_SCHEMA_VERSION,
  canonicalPoolPayload,
  hasProhibitedPoolKeys,
  isModelPoolRecord,
  isModelPoolVersion,
  poolDigest,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "./model-pool-types";
import type { ModelSlot } from "../../studio-data";

function slot(id: string, slug: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled: true };
}

const S1 = slot("s1", "a/m1");
const S2 = slot("s2", "b/m2");
const S3 = slot("s3", "c/m3");
const S4 = slot("s4", "d/m4");
const S5 = slot("s5", "e/m5");
const S6 = slot("s6", "f/m6");
const CH = slot("ch1", "g/m7");

function makeRecord(overrides: Partial<ModelPoolRecord> = {}): ModelPoolRecord {
  return {
    id: "pool-1",
    name: "Diversity pool A",
    purpose: "Stage B pair screening with failure-mode diversity.",
    latestVersion: 1,
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<ModelPoolVersion> = {}): ModelPoolVersion {
  const base = {
    poolId: "pool-1",
    version: 1,
    core: [S1, S2, S3, S4, S5, S6],
    challengers: [CH],
    diversityChecklist: ["independent families", "no shared provider"],
    rationale: "Chosen for failure-mode diversity.",
    supersedesVersion: null as number | null,
  };
  const canonicalPayload = canonicalPoolPayload(base);
  const digest = poolDigest(base);
  return { ...base, canonicalPayload, digest, createdAt: 1000, ...overrides };
}

// --- ModelPoolRecord ----------------------------------------------------------

describe("isModelPoolRecord", () => {
  it("accepts a valid record", () => {
    expect(isModelPoolRecord(makeRecord())).toBe(true);
  });

  it("accepts an archived record", () => {
    expect(isModelPoolRecord(makeRecord({ archivedAt: 5000, updatedAt: 5000 }))).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isModelPoolRecord(null)).toBe(false);
    expect(isModelPoolRecord("string")).toBe(false);
    expect(isModelPoolRecord(42)).toBe(false);
    expect(isModelPoolRecord([])).toBe(false);
  });

  it("rejects empty id", () => {
    expect(isModelPoolRecord(makeRecord({ id: "" }))).toBe(false);
  });

  it("rejects blank name", () => {
    expect(isModelPoolRecord(makeRecord({ name: "" }))).toBe(false);
    expect(isModelPoolRecord(makeRecord({ name: "  " }))).toBe(false);
  });

  it("rejects blank purpose", () => {
    expect(isModelPoolRecord(makeRecord({ purpose: "" }))).toBe(false);
  });

  it("rejects latestVersion < 1", () => {
    expect(isModelPoolRecord(makeRecord({ latestVersion: 0 }))).toBe(false);
  });

  it("rejects negative revision", () => {
    expect(isModelPoolRecord(makeRecord({ revision: -1 }))).toBe(false);
  });

  it("rejects updatedAt < createdAt", () => {
    expect(isModelPoolRecord(makeRecord({ createdAt: 2000, updatedAt: 1000 }))).toBe(false);
  });

  it("rejects prohibited credential keys", () => {
    expect(isModelPoolRecord({ ...makeRecord(), apiKey: "x" })).toBe(false);
    expect(isModelPoolRecord({ ...makeRecord(), meta: { secret: "x" } })).toBe(false);
  });
});

// --- ModelPoolVersion ---------------------------------------------------------

describe("isModelPoolVersion", () => {
  it("accepts a valid version", () => {
    expect(isModelPoolVersion(makeVersion())).toBe(true);
  });

  it("preserves core/challenger roles, diversity, rationale, supersession", () => {
    const v = makeVersion({
      core: [S1, S2, S3, S4, S5, S6, slot("s7", "h/m8")],
      challengers: [CH, slot("ch2", "i/m9")],
      diversityChecklist: ["independent families", "no shared provider", "mixed reasoning"],
      rationale: "Expanded core for confirmation.",
      supersedesVersion: 1,
      version: 2,
    });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(true);
    expect(v.core).toHaveLength(7);
    expect(v.challengers).toHaveLength(2);
    expect(v.diversityChecklist).toHaveLength(3);
    expect(v.supersedesVersion).toBe(1);
  });

  it("accepts empty challengers", () => {
    const v = makeVersion({ challengers: [] });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(true);
  });

  it("accepts null supersedesVersion (first version)", () => {
    expect(isModelPoolVersion(makeVersion({ supersedesVersion: null }))).toBe(true);
  });

  it("rejects version < 1", () => {
    expect(isModelPoolVersion(makeVersion({ version: 0 }))).toBe(false);
  });

  it("rejects non-integer version", () => {
    expect(isModelPoolVersion(makeVersion({ version: 1.5 }))).toBe(false);
  });

  it("rejects empty core", () => {
    const v = makeVersion({ core: [] });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects invalid model slots in core", () => {
    const v = makeVersion({ core: [{ ...S1, providerId: "" }] });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects invalid model slots in challengers", () => {
    const v = makeVersion({ challengers: [{ ...CH, model: "" }] });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects non-string diversityChecklist entries", () => {
    const v = makeVersion({ diversityChecklist: ["ok", 42 as unknown as string] });
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects empty diversityChecklist", () => {
    const v = makeVersion({ diversityChecklist: [] });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects blank rationale", () => {
    const v = makeVersion({ rationale: "" });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects negative supersedesVersion", () => {
    const v = makeVersion({ supersedesVersion: -1 });
    v.canonicalPayload = canonicalPoolPayload(v);
    v.digest = poolDigest(v);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects digest that does not match canonical payload", () => {
    const v = makeVersion();
    v.digest = "sha256:" + "0".repeat(64);
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects canonicalPayload that does not match material fields", () => {
    const v = makeVersion();
    v.canonicalPayload = canonicalPoolPayload({ ...v, rationale: "tampered" });
    v.digest = poolDigest({ ...v, rationale: "tampered" });
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isModelPoolVersion(null)).toBe(false);
    expect(isModelPoolVersion("string")).toBe(false);
    expect(isModelPoolVersion(42)).toBe(false);
  });
});

// --- No aggregation / synthetic respondent semantics -------------------------

describe("No Model Pool aggregation or synthetic respondent semantics", () => {
  it("MODEL_POOL_PROHIBITED_KEYS includes aggregation/synthetic fields", () => {
    expect(MODEL_POOL_PROHIBITED_KEYS.has("aggregatedScore")).toBe(true);
    expect(MODEL_POOL_PROHIBITED_KEYS.has("syntheticRespondent")).toBe(true);
    expect(MODEL_POOL_PROHIBITED_KEYS.has("mergedEvidence")).toBe(true);
    expect(MODEL_POOL_PROHIBITED_KEYS.has("collectiveScore")).toBe(true);
    expect(MODEL_POOL_PROHIBITED_KEYS.has("aggregatedEvidence")).toBe(true);
    expect(MODEL_POOL_PROHIBITED_KEYS.has("syntheticAnswer")).toBe(true);
  });

  it("rejects a version with an aggregation field", () => {
    const v = { ...makeVersion(), aggregatedScore: 0.87 };
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects a version with a syntheticRespondent field", () => {
    const v = { ...makeVersion(), syntheticRespondent: { model: "x" } };
    expect(isModelPoolVersion(v)).toBe(false);
  });

  it("rejects a record with a mergedEvidence field", () => {
    const r = { ...makeRecord(), mergedEvidence: [] };
    expect(isModelPoolRecord(r)).toBe(false);
  });

  it("rejects aggregation keys at nested depth", () => {
    const v = { ...makeVersion(), rationale: "ok", meta: { collectiveScore: 1.0 } };
    expect(isModelPoolVersion(v)).toBe(false);
  });
});

// --- Canonical payload / digest ----------------------------------------------

describe("canonicalPoolPayload / poolDigest", () => {
  it("produces stable canonical JSON under key permutation", () => {
    const content = {
      core: [S1, S2],
      challengers: [CH],
      diversityChecklist: ["x"],
      rationale: "test",
      supersedesVersion: null,
    };
    const a = canonicalPoolPayload(content);
    const b = canonicalPoolPayload({
      rationale: "test",
      supersedesVersion: null,
      diversityChecklist: ["x"],
      challengers: [CH],
      core: [S1, S2],
    });
    expect(a).toBe(b);
  });

  it("changes digest when any material field changes", () => {
    const base = {
      core: [S1, S2, S3, S4, S5, S6],
      challengers: [CH],
      diversityChecklist: ["x"],
      rationale: "test",
      supersedesVersion: null as number | null,
    };
    const d0 = poolDigest(base);
    expect(poolDigest({ ...base, rationale: "different" })).not.toBe(d0);
    expect(poolDigest({ ...base, challengers: [] })).not.toBe(d0);
    expect(poolDigest({ ...base, diversityChecklist: ["y"] })).not.toBe(d0);
    expect(poolDigest({ ...base, supersedesVersion: 1 })).not.toBe(d0);
    expect(poolDigest({ ...base, core: [...base.core, slot("s7", "z/m")] })).not.toBe(d0);
  });

  it("digest shape is sha256:<64 lowercase hex>", () => {
    const d = poolDigest({
      core: [S1],
      challengers: [],
      diversityChecklist: ["x"],
      rationale: "t",
      supersedesVersion: null,
    });
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// --- Prohibited keys ----------------------------------------------------------

describe("hasProhibitedPoolKeys", () => {
  it("rejects credential keys at any depth", () => {
    expect(hasProhibitedPoolKeys({ a: { token: "x" } })).toBe(true);
    expect(hasProhibitedPoolKeys([{ password: "x" }])).toBe(true);
  });

  it("rejects aggregation keys at any depth", () => {
    expect(hasProhibitedPoolKeys({ a: { aggregatedScore: 1 } })).toBe(true);
    expect(hasProhibitedPoolKeys({ syntheticRespondent: "x" })).toBe(true);
  });

  it("passes clean values", () => {
    expect(hasProhibitedPoolKeys({ ok: "value" })).toBe(false);
    expect(hasProhibitedPoolKeys(null)).toBe(false);
  });
});

// --- Schema version -----------------------------------------------------------

describe("MODEL_POOL_VERSION_SCHEMA_VERSION", () => {
  it("is a positive integer", () => {
    expect(MODEL_POOL_VERSION_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(MODEL_POOL_VERSION_SCHEMA_VERSION)).toBe(true);
  });
});
