import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelConfigurationSnapshot } from "../evidence/evidence-types";
import {
  createModelRollupVersion,
  type ModelRollupRecord,
  type ModelRollupVersion,
} from "../model-rollups/model-rollup-types";
import { RSembleEvaluationDB, StorageError } from "./database";
import { createEvidenceRepository } from "./evidence-repository";
import { InMemoryModelRollupRepository } from "./in-memory-model-rollup-repository";
import {
  createModelRollupRepository,
  type ModelRollupRepository,
} from "./model-rollup-repository";

const MEMBER_A = `mc:sha256:${"a".repeat(64)}`;
const MEMBER_B = `mc:sha256:${"b".repeat(64)}`;
const MISSING = `mc:sha256:${"f".repeat(64)}`;
const NOW = 1_000;

function snapshot(id: string): ModelConfigurationSnapshot {
  return {
    id,
    providerId: "openrouter",
    requestedModel: id === MEMBER_A ? "vendor/a" : "vendor/b",
    resolvedVersion: id === MEMBER_A ? "2026-08-a" : "2026-08-b",
    reasoningSignature: null,
    toolScaffoldSignature: null,
    contextWindow: null,
    identityCompleteness: "exact",
    observedFrom: NOW,
    observedTo: NOW,
    sourceModelKeys: [id],
  };
}

function record(overrides: Partial<ModelRollupRecord> = {}): ModelRollupRecord {
  return {
    id: "rollup:alpha",
    name: "Alpha shelf",
    latestVersion: 1,
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function version(overrides: Partial<ModelRollupVersion> = {}): ModelRollupVersion {
  return createModelRollupVersion({
    rollupId: "rollup:alpha",
    version: 1,
    name: "Alpha shelf",
    memberConfigurationIds: [MEMBER_A, MEMBER_B],
    aggregationPolicy: "stratified_only",
    createdAt: NOW,
    ...overrides,
  });
}

type Factory = () => Promise<{ repo: ModelRollupRepository; close: () => void }>;

export function modelRollupRepositoryContract(name: string, factory: Factory): void {
  describe(name, () => {
    it("creates the stable record and immutable v1 atomically", async () => {
      const { repo, close } = await factory();
      await repo.createModelRollup(record(), version());
      expect(await repo.getModelRollupRecord("rollup:alpha")).toEqual(record());
      expect(await repo.getModelRollupVersion("rollup:alpha", 1)).toEqual(version());
      close();
    });

    it("appends contiguously under revision CAS and preserves historical identity", async () => {
      const { repo, close } = await factory();
      const v1 = version();
      await repo.createModelRollup(record(), v1);
      const v2 = version({
        version: 2,
        name: "Renamed shelf",
        memberConfigurationIds: [MEMBER_B],
        createdAt: NOW + 1,
      });
      const revision = await repo.appendModelRollupVersion(
        record({ name: "Renamed shelf", latestVersion: 2, updatedAt: NOW + 1 }),
        v2,
        0,
      );
      expect(revision).toBe(1);
      expect(await repo.getModelRollupVersion("rollup:alpha", 1)).toEqual(v1);
      expect(await repo.getModelRollupVersion("rollup:alpha", 2)).toEqual(v2);
      await expect(
        repo.appendModelRollupVersion(
          record({ name: "Third", latestVersion: 3, updatedAt: NOW + 2 }),
          version({ version: 3, name: "Third", createdAt: NOW + 2 }),
          0,
        ),
      ).rejects.toMatchObject({ kind: "conflict" });
      close();
    });

    it("validates exact member IDs by identity and never repairs a missing member", async () => {
      const { repo, close } = await factory();
      await expect(
        repo.createModelRollup(record(), version({ memberConfigurationIds: [MISSING] })),
      ).rejects.toMatchObject({ kind: "validation" });
      expect(await repo.getModelRollupRecord("rollup:alpha")).toBeNull();
      close();
    });

    it("archives and restores through CAS without changing pinned versions", async () => {
      const { repo, close } = await factory();
      const v1 = version();
      await repo.createModelRollup(record(), v1);
      expect(await repo.archiveModelRollup("rollup:alpha", 0, NOW + 2)).toBe(1);
      expect((await repo.getModelRollupRecord("rollup:alpha"))?.archivedAt).toBe(NOW + 2);
      expect(await repo.listModelRollups()).toEqual([]);
      expect((await repo.listModelRollups({ archiveState: "archived" }))[0]?.id).toBe(
        "rollup:alpha",
      );
      expect(await repo.restoreModelRollup("rollup:alpha", 1, NOW + 3)).toBe(2);
      expect(await repo.getModelRollupVersion("rollup:alpha", 1)).toEqual(v1);
      close();
    });

    it("lists records and versions deterministically", async () => {
      const { repo, close } = await factory();
      await repo.createModelRollup(record({ id: "rollup:z", name: "Zulu" }), version({ rollupId: "rollup:z", name: "Zulu" }));
      await repo.createModelRollup(record({ id: "rollup:a", name: "Alpha" }), version({ rollupId: "rollup:a", name: "Alpha" }));
      expect((await repo.listModelRollups({ archiveState: "all" })).map((r) => r.id)).toEqual([
        "rollup:a",
        "rollup:z",
      ]);
      close();
    });
  });
}

const opened: RSembleEvaluationDB[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) db.close();
  await Dexie.delete("model-rollup-contract");
});

modelRollupRepositoryContract("Dexie ModelRollupRepository", async () => {
  await Dexie.delete("model-rollup-contract");
  const db = new RSembleEvaluationDB("model-rollup-contract");
  await db.open();
  opened.push(db);
  const evidence = createEvidenceRepository(db);
  await evidence.putModelConfiguration(snapshot(MEMBER_A));
  await evidence.putModelConfiguration(snapshot(MEMBER_B));
  return { repo: createModelRollupRepository(db), close: () => db.close() };
});

modelRollupRepositoryContract("In-memory ModelRollupRepository parity", async () => ({
  repo: new InMemoryModelRollupRepository([MEMBER_A, MEMBER_B]),
  close: () => undefined,
}));

describe("ModelRollupRepository strict policy", () => {
  it("rejects a runtime-forged pooled policy before writing", async () => {
    const repo = new InMemoryModelRollupRepository([MEMBER_A]);
    const forged = { ...version({ memberConfigurationIds: [MEMBER_A] }), aggregationPolicy: "pooled" };
    await expect(repo.createModelRollup(record(), forged as ModelRollupVersion)).rejects.toBeInstanceOf(
      StorageError,
    );
    expect(await repo.listModelRollups({ archiveState: "all" })).toEqual([]);
  });
});
