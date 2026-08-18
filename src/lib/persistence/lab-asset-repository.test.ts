// =============================================================================
// RSemble AI — Lab asset repository tests (spec §6)
//
// RED: specifies the LabAssetRepository contract — stable record plus immutable
// version for Lab Recipes and Model Pools. Exercises both the Dexie-backed and
// in-memory implementations through a shared parity suite.
//
// Required behavior:
//  - stable record + immutable version for each asset;
//  - editing appends a version (latestVersion pointer + CAS revision);
//  - referenced version immutable (no update/delete path);
//  - version collision allows byte-equivalent idempotency only;
//  - record archive does not break version refs;
//  - no Model Pool aggregation or synthetic respondent semantics;
//  - prohibited-field rejection at the repository boundary;
//  - contract parity Dexie vs in-memory.
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { RSembleEvaluationDB } from "./database";
import {
  createLabAssetRepository,
  InMemoryLabAssetRepository,
  type LabAssetRepository,
} from "./lab-asset-repository";
import {
  canonicalRecipePayload,
  recipeDigest,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "../studies/lab-recipe-types";
import {
  canonicalPoolPayload,
  poolDigest,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "../studies/model-pool-types";
import type { CriticRef } from "../providers/types";
import type { ModelSlot } from "../../studio-data";

// --- Fixtures -----------------------------------------------------------------

function slot(id: string, slug: string): ModelSlot {
  return { id, providerId: "openrouter", provider: "Test", model: id, slug, enabled: true };
}

const SYNTH: CriticRef = { providerId: "openrouter", model: "acme/synth-1" };
const SLOTS = Array.from({ length: 6 }, (_, i) => slot(`s${i + 1}`, `p/m${i + 1}`));
const CH = slot("ch1", "q/m7");

function recipeContent(overrides: Partial<LabRecipeVersion> = {}) {
  return {
    recipeFamily: "BlindRaw" as const,
    promptVersion: "blind-raw-v1",
    judgeAnalysisMode: "none" as const,
    rubricAccess: false,
    verification: false,
    synthesizer: SYNTH,
    ...overrides,
  };
}

function makeRecipeRecord(id = "recipe-1"): LabRecipeRecord {
  return {
    id,
    kind: "fusion",
    name: "BlindRaw default",
    description: "Anonymized candidates only.",
    latestVersion: 1,
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makeRecipeVersion(
  id = "recipe-1",
  version = 1,
  overrides: Partial<LabRecipeVersion> = {},
): LabRecipeVersion {
  const content = recipeContent(overrides);
  const canonicalPayload = canonicalRecipePayload(content);
  const digest = recipeDigest(content);
  return {
    recipeId: id,
    version,
    kind: "fusion",
    ...content,
    canonicalPayload,
    digest,
    createdAt: 1000 + version,
    ...overrides,
  };
}

function poolContent(overrides: Partial<ModelPoolVersion> = {}) {
  return {
    core: SLOTS,
    challengers: [CH],
    diversityChecklist: ["independent families"],
    rationale: "test pool",
    supersedesVersion: null as number | null,
    ...overrides,
  };
}

function makePoolRecord(id = "pool-1"): ModelPoolRecord {
  return {
    id,
    name: "Diversity pool A",
    purpose: "Stage B pair screening.",
    latestVersion: 1,
    revision: 0,
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  };
}

function makePoolVersion(
  id = "pool-1",
  version = 1,
  overrides: Partial<ModelPoolVersion> = {},
): ModelPoolVersion {
  const content = poolContent(overrides);
  const canonicalPayload = canonicalPoolPayload(content);
  const digest = poolDigest(content);
  return {
    poolId: id,
    version,
    ...content,
    canonicalPayload,
    digest,
    createdAt: 1000 + version,
    ...overrides,
  };
}

// --- Shared parity suite ------------------------------------------------------

function repositorySuite(name: string, makeRepo: () => LabAssetRepository & object) {
  describe(name, () => {
    // --- Lab Recipe records ---------------------------------------------------

    it("creates a recipe record with its first version atomically", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const record = await repo.getRecipeRecord("recipe-1");
      expect(record).toMatchObject({ id: "recipe-1", kind: "fusion", latestVersion: 1 });
      const v = await repo.getRecipeVersion("recipe-1", 1);
      expect(v).toMatchObject({ recipeId: "recipe-1", version: 1, recipeFamily: "BlindRaw" });
    });

    it("rejects creating a duplicate recipe record", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      await expect(repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion())).rejects.toThrow(
        /already exists/,
      );
    });

    it("rejects createRecipeRecord with mismatched record/version ids", async () => {
      const repo = makeRepo();
      await expect(
        repo.createRecipeRecord(makeRecipeRecord("a"), makeRecipeVersion("b")),
      ).rejects.toThrow(/mismatch/);
    });

    it("rejects createRecipeRecord when version is not 1", async () => {
      const repo = makeRepo();
      await expect(
        repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion("recipe-1", 2)),
      ).rejects.toThrow(/version.*1|first version/i);
    });

    it("lists recipe records (active only by default)", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord("r1"), makeRecipeVersion("r1"));
      await repo.createRecipeRecord(makeRecipeRecord("r2"), makeRecipeVersion("r2"));
      const active = await repo.listRecipeRecords();
      expect(active.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    });

    // --- Lab Recipe version append / immutability / idempotency ---------------

    it("appending a version updates latestVersion and increments revision", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const before = (await repo.getRecipeRecord("recipe-1"))!;
      const v2 = makeRecipeVersion("recipe-1", 2, { promptVersion: "v2" });
      const newRev = await repo.appendRecipeVersion(v2, before.revision);
      expect(newRev).toBe(before.revision + 1);
      const after = (await repo.getRecipeRecord("recipe-1"))!;
      expect(after.latestVersion).toBe(2);
      expect(after.revision).toBe(newRev);
    });

    it("rejects append with stale revision (CAS)", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const v2 = makeRecipeVersion("recipe-1", 2, { promptVersion: "v2" });
      await expect(repo.appendRecipeVersion(v2, 99)).rejects.toThrow(/Stale|revision/);
    });

    it("rejects non-contiguous version append", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const v3 = makeRecipeVersion("recipe-1", 3, { promptVersion: "v3" });
      await expect(repo.appendRecipeVersion(v3, 0)).rejects.toThrow(/contiguous|version/i);
    });

    it("referenced version is immutable — no update or delete path", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const v1 = await repo.getRecipeVersion("recipe-1", 1);
      expect(v1).not.toBeNull();
      // There is no updateRecipeVersion or deleteRecipeVersion method on the
      // interface — the type system enforces immutability. Re-creating the
      // same version with different content is a conflict (tested below).
    });

    it("version collision with byte-equivalent content is idempotent", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      // Re-append version 1 with identical content (same digest) — idempotent.
      const same = makeRecipeVersion("recipe-1", 1);
      const rev0 = await repo.appendRecipeVersion(same, 0);
      expect(rev0).toBe(0); // no revision change
      const record0 = (await repo.getRecipeRecord("recipe-1"))!;
      expect(record0.latestVersion).toBe(1); // unchanged
      // Now append v2, then retry the same append — idempotent.
      const v2 = makeRecipeVersion("recipe-1", 2, { promptVersion: "v2" });
      const rev1 = await repo.appendRecipeVersion(v2, 0);
      const rev2 = await repo.appendRecipeVersion(v2, 0);
      expect(rev2).toBe(rev1);
      const record = (await repo.getRecipeRecord("recipe-1"))!;
      expect(record.revision).toBe(rev1);
      expect(record.latestVersion).toBe(2);
    });

    it("version collision with different content is rejected", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const v2a = makeRecipeVersion("recipe-1", 2, { promptVersion: "v2a" });
      await repo.appendRecipeVersion(v2a, 0);
      // Same [recipe-1, 2] but different content (different digest).
      const v2b = makeRecipeVersion("recipe-1", 2, { promptVersion: "v2b" });
      await expect(repo.appendRecipeVersion(v2b, 1)).rejects.toThrow(/collision|digest|immutable/);
    });

    it("getLatestRecipeVersion returns the highest version", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      await repo.appendRecipeVersion(makeRecipeVersion("recipe-1", 2, { promptVersion: "v2" }), 0);
      await repo.appendRecipeVersion(makeRecipeVersion("recipe-1", 3, { promptVersion: "v3" }), 1);
      const latest = await repo.getLatestRecipeVersion("recipe-1");
      expect(latest?.version).toBe(3);
    });

    it("listRecipeVersions returns all versions sorted", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      await repo.appendRecipeVersion(makeRecipeVersion("recipe-1", 2, { promptVersion: "v2" }), 0);
      const versions = await repo.listRecipeVersions("recipe-1");
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
    });

    it("getRecipeVersion returns null for unknown id", async () => {
      const repo = makeRepo();
      expect(await repo.getRecipeVersion("nope", 1)).toBeNull();
    });

    // --- Lab Recipe archive ---------------------------------------------------

    it("archiving a recipe record sets archivedAt and does not break version refs", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      const record = (await repo.getRecipeRecord("recipe-1"))!;
      const newRev = await repo.archiveRecipeRecord("recipe-1", record.revision, 9000);
      expect(newRev).toBe(record.revision + 1);
      const archived = (await repo.getRecipeRecord("recipe-1"))!;
      expect(archived.archivedAt).toBe(9000);
      // Version still resolvable after archive.
      const v = await repo.getRecipeVersion("recipe-1", 1);
      expect(v).not.toBeNull();
      expect(v?.version).toBe(1);
    });

    it("archived records are excluded from active list but included with includeArchived", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord("r1"), makeRecipeVersion("r1"));
      await repo.archiveRecipeRecord("r1", 0, 9000);
      const active = await repo.listRecipeRecords();
      expect(active).toHaveLength(0);
      const all = await repo.listRecipeRecords(true);
      expect(all.map((r) => r.id)).toEqual(["r1"]);
    });

    it("rejects archive with stale revision", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      await expect(repo.archiveRecipeRecord("recipe-1", 99, 9000)).rejects.toThrow(/Stale|revision/);
    });

    it("rejects appending a version to an archived record", async () => {
      const repo = makeRepo();
      await repo.createRecipeRecord(makeRecipeRecord(), makeRecipeVersion());
      await repo.archiveRecipeRecord("recipe-1", 0, 9000);
      const v2 = makeRecipeVersion("recipe-1", 2, { promptVersion: "v2" });
      await expect(repo.appendRecipeVersion(v2, 1)).rejects.toThrow(/archived/);
    });

    // --- Model Pool records ---------------------------------------------------

    it("creates a pool record with its first version atomically", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const record = await repo.getPoolRecord("pool-1");
      expect(record).toMatchObject({ id: "pool-1", latestVersion: 1 });
      const v = await repo.getPoolVersion("pool-1", 1);
      expect(v).toMatchObject({ poolId: "pool-1", version: 1 });
    });

    it("rejects creating a duplicate pool record", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      await expect(repo.createPoolRecord(makePoolRecord(), makePoolVersion())).rejects.toThrow(
        /already exists/,
      );
    });

    it("rejects createPoolRecord with mismatched ids", async () => {
      const repo = makeRepo();
      await expect(
        repo.createPoolRecord(makePoolRecord("a"), makePoolVersion("b")),
      ).rejects.toThrow(/mismatch/);
    });

    // --- Model Pool version append / idempotency ------------------------------

    it("appending a pool version updates latestVersion", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const v2 = makePoolVersion("pool-1", 2, { rationale: "v2 rationale", supersedesVersion: 1 });
      const newRev = await repo.appendPoolVersion(v2, 0);
      expect(newRev).toBe(1);
      const after = (await repo.getPoolRecord("pool-1"))!;
      expect(after.latestVersion).toBe(2);
    });

    it("pool version collision with same content is idempotent", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const v2 = makePoolVersion("pool-1", 2, { rationale: "v2" });
      const rev1 = await repo.appendPoolVersion(v2, 0);
      const rev2 = await repo.appendPoolVersion(v2, 0);
      expect(rev2).toBe(rev1);
    });

    it("pool version collision with different content is rejected", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const v2a = makePoolVersion("pool-1", 2, { rationale: "a" });
      await repo.appendPoolVersion(v2a, 0);
      const v2b = makePoolVersion("pool-1", 2, { rationale: "b" });
      await expect(repo.appendPoolVersion(v2b, 1)).rejects.toThrow(/collision|digest|immutable/);
    });

    it("getLatestPoolVersion returns the highest version", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      await repo.appendPoolVersion(
        makePoolVersion("pool-1", 2, { rationale: "v2" }),
        0,
      );
      const latest = await repo.getLatestPoolVersion("pool-1");
      expect(latest?.version).toBe(2);
    });

    it("listPoolVersions returns all versions sorted", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      await repo.appendPoolVersion(makePoolVersion("pool-1", 2, { rationale: "v2" }), 0);
      const versions = await repo.listPoolVersions("pool-1");
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
    });

    // --- Model Pool archive ---------------------------------------------------

    it("archiving a pool record does not break version refs", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const newRev = await repo.archivePoolRecord("pool-1", 0, 9000);
      expect(newRev).toBe(1);
      const archived = (await repo.getPoolRecord("pool-1"))!;
      expect(archived.archivedAt).toBe(9000);
      const v = await repo.getPoolVersion("pool-1", 1);
      expect(v).not.toBeNull();
    });

    it("rejects appending to an archived pool", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      await repo.archivePoolRecord("pool-1", 0, 9000);
      const v2 = makePoolVersion("pool-1", 2, { rationale: "v2" });
      await expect(repo.appendPoolVersion(v2, 1)).rejects.toThrow(/archived/);
    });

    // --- Prohibited-field rejection at repository boundary --------------------

    it("rejects creating a recipe record with prohibited credential keys", async () => {
      const repo = makeRepo();
      const bad = { ...makeRecipeRecord(), apiKey: "sk-xxx" } as LabRecipeRecord;
      await expect(repo.createRecipeRecord(bad, makeRecipeVersion())).rejects.toThrow(/invalid/i);
    });

    it("rejects creating a pool version with aggregation semantics", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const bad = { ...makePoolVersion("pool-1", 2, { rationale: "v2" }), aggregatedScore: 0.9 } as ModelPoolVersion;
      await expect(repo.appendPoolVersion(bad, 0)).rejects.toThrow(/invalid/i);
    });

    it("rejects creating a pool version with synthetic respondent semantics", async () => {
      const repo = makeRepo();
      await repo.createPoolRecord(makePoolRecord(), makePoolVersion());
      const bad = {
        ...makePoolVersion("pool-1", 2, { rationale: "v2" }),
        syntheticRespondent: { model: "x" },
      } as ModelPoolVersion;
      await expect(repo.appendPoolVersion(bad, 0)).rejects.toThrow(/invalid/i);
    });
  });
}

// --- Run suites against both implementations ----------------------------------

repositorySuite("InMemoryLabAssetRepository", () => new InMemoryLabAssetRepository());

const dbs: RSembleEvaluationDB[] = [];
afterEach(async () => {
  while (dbs.length > 0) {
    const db = dbs.pop()!;
    db.close();
    await db.delete();
  }
});

repositorySuite("Dexie lab-asset repository", () => {
  const db = new RSembleEvaluationDB(`lab-asset-test-${crypto.randomUUID()}`);
  dbs.push(db);
  return createLabAssetRepository(db);
});
