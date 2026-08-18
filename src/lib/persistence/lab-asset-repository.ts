// =============================================================================
// RSemble AI — Lab asset repository (Dexie-backed + in-memory)
//
// Stores for the reusable Lab assets (spec §6): versioned Lab Recipes
// (kind: "fusion") and Model Pools. Each asset is a stable record plus
// immutable versions. Old Fusion readers (fusionRecipes, poolManifests) are
// NOT switched off — they remain the live authority until the one-time
// migration in Task 5.
//
// Invariants:
//  - stable record + immutable version for each asset;
//  - editing appends a version (latestVersion pointer + CAS revision);
//  - referenced version immutable — no update or delete path;
//  - version collision allows byte-equivalent idempotency only (same key +
//    same digest → no-op; same key + different digest → conflict);
//  - record archive does not break version refs — versions remain resolvable;
//  - no Model Pool aggregation or synthetic respondent semantics (enforced by
//    the type validators);
//  - prohibited-field rejection at the repository boundary;
//  - contract parity: Dexie and in-memory implementations share one suite.
// =============================================================================

import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";
import {
  isLabRecipeRecord,
  isLabRecipeVersion,
  type LabRecipeRecord,
  type LabRecipeVersion,
} from "../studies/lab-recipe-types";
import {
  isModelPoolRecord,
  isModelPoolVersion,
  type ModelPoolRecord,
  type ModelPoolVersion,
} from "../studies/model-pool-types";

// --- Repository interface -----------------------------------------------------

export interface LabAssetRepository {
  // Lab Recipe records — stable, mutable metadata (CAS revision).
  createRecipeRecord(record: LabRecipeRecord, firstVersion: LabRecipeVersion): Promise<void>;
  getRecipeRecord(id: string): Promise<LabRecipeRecord | null>;
  listRecipeRecords(includeArchived?: boolean): Promise<LabRecipeRecord[]>;
  archiveRecipeRecord(id: string, expectedRevision: number, archivedAt: number): Promise<number>;

  // Lab Recipe versions — immutable, append-only with byte-equivalent idempotency.
  appendRecipeVersion(version: LabRecipeVersion, expectedRevision: number): Promise<number>;
  getRecipeVersion(recipeId: string, version: number): Promise<LabRecipeVersion | null>;
  getLatestRecipeVersion(recipeId: string): Promise<LabRecipeVersion | null>;
  listRecipeVersions(recipeId: string): Promise<LabRecipeVersion[]>;

  // Model Pool records — stable, mutable metadata (CAS revision).
  createPoolRecord(record: ModelPoolRecord, firstVersion: ModelPoolVersion): Promise<void>;
  getPoolRecord(id: string): Promise<ModelPoolRecord | null>;
  listPoolRecords(includeArchived?: boolean): Promise<ModelPoolRecord[]>;
  archivePoolRecord(id: string, expectedRevision: number, archivedAt: number): Promise<number>;

  // Model Pool versions — immutable, append-only with byte-equivalent idempotency.
  appendPoolVersion(version: ModelPoolVersion, expectedRevision: number): Promise<number>;
  getPoolVersion(poolId: string, version: number): Promise<ModelPoolVersion | null>;
  getLatestPoolVersion(poolId: string): Promise<ModelPoolVersion | null>;
  listPoolVersions(poolId: string): Promise<ModelPoolVersion[]>;
}

// --- Dexie implementation -----------------------------------------------------

export function createLabAssetRepository(db: RSembleEvaluationDB): LabAssetRepository {
  // --- Lab Recipe records ---------------------------------------------------

  async function createRecipeRecord(
    record: LabRecipeRecord,
    firstVersion: LabRecipeVersion,
  ): Promise<void> {
    if (!isLabRecipeRecord(record)) {
      throw new StorageError("validation", "Invalid lab recipe record");
    }
    if (!isLabRecipeVersion(firstVersion)) {
      throw new StorageError("validation", "Invalid lab recipe version");
    }
    if (record.id !== firstVersion.recipeId) {
      throw new StorageError("validation", "Recipe record/version id mismatch");
    }
    if (firstVersion.version !== 1) {
      throw new StorageError("validation", "First recipe version must be 1");
    }
    if (record.latestVersion !== 1) {
      throw new StorageError("validation", "Initial recipe latestVersion must be 1");
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.labRecipeRecords, db.labRecipeVersions, async () => {
        const existing = await db.labRecipeRecords.get(record.id);
        if (existing) {
          throw new StorageError("conflict", `Recipe ${record.id} already exists`);
        }
        await db.labRecipeRecords.put({
          id: record.id,
          record,
          kind: record.kind,
          latestVersion: record.latestVersion,
          archivedAt: record.archivedAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
        });
        await db.labRecipeVersions.put({
          recipeId: firstVersion.recipeId,
          version: firstVersion.version,
          version_: firstVersion,
          digest: firstVersion.digest,
          createdAt: firstVersion.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getRecipeRecord(id: string): Promise<LabRecipeRecord | null> {
    try {
      const row = await db.labRecipeRecords.get(id);
      if (!row) return null;
      return isLabRecipeRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listRecipeRecords(includeArchived = false): Promise<LabRecipeRecord[]> {
    try {
      const rows = await db.labRecipeRecords.toArray();
      return rows
        .map((r) => r.record)
        .filter((r): r is LabRecipeRecord => isLabRecipeRecord(r))
        .filter((r) => includeArchived || r.archivedAt === null)
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function archiveRecipeRecord(
    id: string,
    expectedRevision: number,
    archivedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.labRecipeRecords, async () => {
        const row = await db.labRecipeRecords.get(id);
        if (!row) throw new StorageError("conflict", `Recipe ${id} not found`);
        const record = isLabRecipeRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Recipe ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.archivedAt !== null) {
          throw new StorageError("conflict", `Recipe ${id} is already archived`);
        }
        const updated: LabRecipeRecord = {
          ...record,
          revision: newRevision,
          archivedAt,
          updatedAt: archivedAt,
        };
        await db.labRecipeRecords.put({
          id: row.id,
          record: updated,
          kind: row.kind,
          latestVersion: row.latestVersion,
          archivedAt,
          createdAt: row.createdAt,
          updatedAt: archivedAt,
          revision: newRevision,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  // --- Lab Recipe versions --------------------------------------------------

  async function appendRecipeVersion(
    version: LabRecipeVersion,
    expectedRevision: number,
  ): Promise<number> {
    if (!isLabRecipeVersion(version)) {
      throw new StorageError("validation", "Invalid lab recipe version");
    }
    db.assertWritable();
    try {
      let resultRevision = expectedRevision;
      await db.transaction("rw", db.labRecipeRecords, db.labRecipeVersions, async () => {
        const existingVersion = await db.labRecipeVersions.get([
          version.recipeId,
          version.version,
        ]);
        if (existingVersion) {
          // Byte-equivalent idempotency: same key + same digest → no-op.
          if (existingVersion.digest === version.digest) {
            resultRevision = (await db.labRecipeRecords.get(version.recipeId))?.revision ?? expectedRevision;
            return;
          }
          throw new StorageError(
            "conflict",
            `Recipe version ${version.recipeId}@${version.version} already exists with different content — versions are immutable.`,
          );
        }
        const row = await db.labRecipeRecords.get(version.recipeId);
        if (!row) throw new StorageError("conflict", `Recipe ${version.recipeId} not found`);
        const record = isLabRecipeRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Recipe ${version.recipeId} record corrupted`);
        if (record.archivedAt !== null) {
          throw new StorageError("conflict", `Recipe ${version.recipeId} is archived — cannot append`);
        }
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (version.version !== record.latestVersion + 1) {
          throw new StorageError(
            "conflict",
            `Non-contiguous version: expected ${record.latestVersion + 1}, got ${version.version}`,
          );
        }
        const newRevision = expectedRevision + 1;
        const updated: LabRecipeRecord = {
          ...record,
          revision: newRevision,
          latestVersion: version.version,
          updatedAt: version.createdAt,
        };
        await db.labRecipeRecords.put({
          id: row.id,
          record: updated,
          kind: row.kind,
          latestVersion: version.version,
          archivedAt: row.archivedAt,
          createdAt: row.createdAt,
          updatedAt: version.createdAt,
          revision: newRevision,
        });
        await db.labRecipeVersions.put({
          recipeId: version.recipeId,
          version: version.version,
          version_: version,
          digest: version.digest,
          createdAt: version.createdAt,
        });
        resultRevision = newRevision;
      });
      return resultRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getRecipeVersion(
    recipeId: string,
    version: number,
  ): Promise<LabRecipeVersion | null> {
    try {
      const row = await db.labRecipeVersions.get([recipeId, version]);
      if (!row) return null;
      return isLabRecipeVersion(row.version_) ? row.version_ : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getLatestRecipeVersion(recipeId: string): Promise<LabRecipeVersion | null> {
    try {
      const rows = await db.labRecipeVersions.where("recipeId").equals(recipeId).toArray();
      const versions = rows
        .map((r) => r.version_)
        .filter((v): v is LabRecipeVersion => isLabRecipeVersion(v));
      versions.sort((a, b) => b.version - a.version);
      return versions[0] ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listRecipeVersions(recipeId: string): Promise<LabRecipeVersion[]> {
    try {
      const rows = await db.labRecipeVersions.where("recipeId").equals(recipeId).toArray();
      return rows
        .map((r) => r.version_)
        .filter((v): v is LabRecipeVersion => isLabRecipeVersion(v))
        .sort((a, b) => a.version - b.version);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // --- Model Pool records ---------------------------------------------------

  async function createPoolRecord(
    record: ModelPoolRecord,
    firstVersion: ModelPoolVersion,
  ): Promise<void> {
    if (!isModelPoolRecord(record)) {
      throw new StorageError("validation", "Invalid model pool record");
    }
    if (!isModelPoolVersion(firstVersion)) {
      throw new StorageError("validation", "Invalid model pool version");
    }
    if (record.id !== firstVersion.poolId) {
      throw new StorageError("validation", "Pool record/version id mismatch");
    }
    if (firstVersion.version !== 1) {
      throw new StorageError("validation", "First pool version must be 1");
    }
    if (record.latestVersion !== 1) {
      throw new StorageError("validation", "Initial pool latestVersion must be 1");
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.modelPoolRecords, db.modelPoolVersions, async () => {
        const existing = await db.modelPoolRecords.get(record.id);
        if (existing) {
          throw new StorageError("conflict", `Pool ${record.id} already exists`);
        }
        await db.modelPoolRecords.put({
          id: record.id,
          record,
          latestVersion: record.latestVersion,
          archivedAt: record.archivedAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          revision: record.revision,
        });
        await db.modelPoolVersions.put({
          poolId: firstVersion.poolId,
          version: firstVersion.version,
          version_: firstVersion,
          digest: firstVersion.digest,
          createdAt: firstVersion.createdAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getPoolRecord(id: string): Promise<ModelPoolRecord | null> {
    try {
      const row = await db.modelPoolRecords.get(id);
      if (!row) return null;
      return isModelPoolRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listPoolRecords(includeArchived = false): Promise<ModelPoolRecord[]> {
    try {
      const rows = await db.modelPoolRecords.toArray();
      return rows
        .map((r) => r.record)
        .filter((r): r is ModelPoolRecord => isModelPoolRecord(r))
        .filter((r) => includeArchived || r.archivedAt === null)
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function archivePoolRecord(
    id: string,
    expectedRevision: number,
    archivedAt: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.modelPoolRecords, async () => {
        const row = await db.modelPoolRecords.get(id);
        if (!row) throw new StorageError("conflict", `Pool ${id} not found`);
        const record = isModelPoolRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Pool ${id} record corrupted`);
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (record.archivedAt !== null) {
          throw new StorageError("conflict", `Pool ${id} is already archived`);
        }
        const updated: ModelPoolRecord = {
          ...record,
          revision: newRevision,
          archivedAt,
          updatedAt: archivedAt,
        };
        await db.modelPoolRecords.put({
          id: row.id,
          record: updated,
          latestVersion: row.latestVersion,
          archivedAt,
          createdAt: row.createdAt,
          updatedAt: archivedAt,
          revision: newRevision,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  // --- Model Pool versions --------------------------------------------------

  async function appendPoolVersion(
    version: ModelPoolVersion,
    expectedRevision: number,
  ): Promise<number> {
    if (!isModelPoolVersion(version)) {
      throw new StorageError("validation", "Invalid model pool version");
    }
    db.assertWritable();
    try {
      let resultRevision = expectedRevision;
      await db.transaction("rw", db.modelPoolRecords, db.modelPoolVersions, async () => {
        const existingVersion = await db.modelPoolVersions.get([version.poolId, version.version]);
        if (existingVersion) {
          if (existingVersion.digest === version.digest) {
            resultRevision = (await db.modelPoolRecords.get(version.poolId))?.revision ?? expectedRevision;
            return;
          }
          throw new StorageError(
            "conflict",
            `Pool version ${version.poolId}@${version.version} already exists with different content — versions are immutable.`,
          );
        }
        const row = await db.modelPoolRecords.get(version.poolId);
        if (!row) throw new StorageError("conflict", `Pool ${version.poolId} not found`);
        const record = isModelPoolRecord(row.record) ? row.record : null;
        if (!record) throw new StorageError("validation", `Pool ${version.poolId} record corrupted`);
        if (record.archivedAt !== null) {
          throw new StorageError("conflict", `Pool ${version.poolId} is archived — cannot append`);
        }
        if (row.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${row.revision}`,
          );
        }
        if (version.version !== record.latestVersion + 1) {
          throw new StorageError(
            "conflict",
            `Non-contiguous version: expected ${record.latestVersion + 1}, got ${version.version}`,
          );
        }
        const newRevision = expectedRevision + 1;
        const updated: ModelPoolRecord = {
          ...record,
          revision: newRevision,
          latestVersion: version.version,
          updatedAt: version.createdAt,
        };
        await db.modelPoolRecords.put({
          id: row.id,
          record: updated,
          latestVersion: version.version,
          archivedAt: row.archivedAt,
          createdAt: row.createdAt,
          updatedAt: version.createdAt,
          revision: newRevision,
        });
        await db.modelPoolVersions.put({
          poolId: version.poolId,
          version: version.version,
          version_: version,
          digest: version.digest,
          createdAt: version.createdAt,
        });
        resultRevision = newRevision;
      });
      return resultRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getPoolVersion(
    poolId: string,
    version: number,
  ): Promise<ModelPoolVersion | null> {
    try {
      const row = await db.modelPoolVersions.get([poolId, version]);
      if (!row) return null;
      return isModelPoolVersion(row.version_) ? row.version_ : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getLatestPoolVersion(poolId: string): Promise<ModelPoolVersion | null> {
    try {
      const rows = await db.modelPoolVersions.where("poolId").equals(poolId).toArray();
      const versions = rows
        .map((r) => r.version_)
        .filter((v): v is ModelPoolVersion => isModelPoolVersion(v));
      versions.sort((a, b) => b.version - a.version);
      return versions[0] ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listPoolVersions(poolId: string): Promise<ModelPoolVersion[]> {
    try {
      const rows = await db.modelPoolVersions.where("poolId").equals(poolId).toArray();
      return rows
        .map((r) => r.version_)
        .filter((v): v is ModelPoolVersion => isModelPoolVersion(v))
        .sort((a, b) => a.version - b.version);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  return {
    createRecipeRecord,
    getRecipeRecord,
    listRecipeRecords,
    archiveRecipeRecord,
    appendRecipeVersion,
    getRecipeVersion,
    getLatestRecipeVersion,
    listRecipeVersions,
    createPoolRecord,
    getPoolRecord,
    listPoolRecords,
    archivePoolRecord,
    appendPoolVersion,
    getPoolVersion,
    getLatestPoolVersion,
    listPoolVersions,
  };
}

// --- In-memory implementation -------------------------------------------------

/**
 * In-memory LabAssetRepository with identical validation and conflict
 * semantics to the Dexie implementation. Used by unit tests and non-persisted
 * orchestration.
 */
export class InMemoryLabAssetRepository implements LabAssetRepository {
  private recipeRecords = new Map<string, LabRecipeRecord>();
  private recipeVersions = new Map<string, LabRecipeVersion>();
  private poolRecords = new Map<string, ModelPoolRecord>();
  private poolVersions = new Map<string, ModelPoolVersion>();

  private static key(id: string, version: number): string {
    return `${id}@${version}`;
  }

  // --- Lab Recipe records ---------------------------------------------------

  async createRecipeRecord(
    record: LabRecipeRecord,
    firstVersion: LabRecipeVersion,
  ): Promise<void> {
    if (!isLabRecipeRecord(record)) {
      throw new StorageError("validation", "Invalid lab recipe record");
    }
    if (!isLabRecipeVersion(firstVersion)) {
      throw new StorageError("validation", "Invalid lab recipe version");
    }
    if (record.id !== firstVersion.recipeId) {
      throw new StorageError("validation", "Recipe record/version id mismatch");
    }
    if (firstVersion.version !== 1) {
      throw new StorageError("validation", "First recipe version must be 1");
    }
    if (record.latestVersion !== 1) {
      throw new StorageError("validation", "Initial recipe latestVersion must be 1");
    }
    if (this.recipeRecords.has(record.id)) {
      throw new StorageError("conflict", `Recipe ${record.id} already exists`);
    }
    this.recipeRecords.set(record.id, record);
    this.recipeVersions.set(
      InMemoryLabAssetRepository.key(firstVersion.recipeId, firstVersion.version),
      firstVersion,
    );
  }

  async getRecipeRecord(id: string): Promise<LabRecipeRecord | null> {
    return this.recipeRecords.get(id) ?? null;
  }

  async listRecipeRecords(includeArchived = false): Promise<LabRecipeRecord[]> {
    return [...this.recipeRecords.values()]
      .filter((r) => includeArchived || r.archivedAt === null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async archiveRecipeRecord(
    id: string,
    expectedRevision: number,
    archivedAt: number,
  ): Promise<number> {
    const record = this.recipeRecords.get(id);
    if (!record) throw new StorageError("conflict", `Recipe ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.archivedAt !== null) {
      throw new StorageError("conflict", `Recipe ${id} is already archived`);
    }
    const newRevision = expectedRevision + 1;
    this.recipeRecords.set(id, {
      ...record,
      revision: newRevision,
      archivedAt,
      updatedAt: archivedAt,
    });
    return newRevision;
  }

  // --- Lab Recipe versions --------------------------------------------------

  async appendRecipeVersion(
    version: LabRecipeVersion,
    expectedRevision: number,
  ): Promise<number> {
    if (!isLabRecipeVersion(version)) {
      throw new StorageError("validation", "Invalid lab recipe version");
    }
    const key = InMemoryLabAssetRepository.key(version.recipeId, version.version);
    const existing = this.recipeVersions.get(key);
    if (existing) {
      if (existing.digest === version.digest) {
        return this.recipeRecords.get(version.recipeId)?.revision ?? expectedRevision;
      }
      throw new StorageError(
        "conflict",
        `Recipe version ${version.recipeId}@${version.version} already exists with different content — versions are immutable.`,
      );
    }
    const record = this.recipeRecords.get(version.recipeId);
    if (!record) throw new StorageError("conflict", `Recipe ${version.recipeId} not found`);
    if (record.archivedAt !== null) {
      throw new StorageError("conflict", `Recipe ${version.recipeId} is archived — cannot append`);
    }
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (version.version !== record.latestVersion + 1) {
      throw new StorageError(
        "conflict",
        `Non-contiguous version: expected ${record.latestVersion + 1}, got ${version.version}`,
      );
    }
    const newRevision = expectedRevision + 1;
    this.recipeRecords.set(version.recipeId, {
      ...record,
      revision: newRevision,
      latestVersion: version.version,
      updatedAt: version.createdAt,
    });
    this.recipeVersions.set(key, version);
    return newRevision;
  }

  async getRecipeVersion(recipeId: string, version: number): Promise<LabRecipeVersion | null> {
    return (
      this.recipeVersions.get(InMemoryLabAssetRepository.key(recipeId, version)) ?? null
    );
  }

  async getLatestRecipeVersion(recipeId: string): Promise<LabRecipeVersion | null> {
    const matches = [...this.recipeVersions.values()].filter((v) => v.recipeId === recipeId);
    matches.sort((a, b) => b.version - a.version);
    return matches[0] ?? null;
  }

  async listRecipeVersions(recipeId: string): Promise<LabRecipeVersion[]> {
    return [...this.recipeVersions.values()]
      .filter((v) => v.recipeId === recipeId)
      .sort((a, b) => a.version - b.version);
  }

  // --- Model Pool records ---------------------------------------------------

  async createPoolRecord(
    record: ModelPoolRecord,
    firstVersion: ModelPoolVersion,
  ): Promise<void> {
    if (!isModelPoolRecord(record)) {
      throw new StorageError("validation", "Invalid model pool record");
    }
    if (!isModelPoolVersion(firstVersion)) {
      throw new StorageError("validation", "Invalid model pool version");
    }
    if (record.id !== firstVersion.poolId) {
      throw new StorageError("validation", "Pool record/version id mismatch");
    }
    if (firstVersion.version !== 1) {
      throw new StorageError("validation", "First pool version must be 1");
    }
    if (record.latestVersion !== 1) {
      throw new StorageError("validation", "Initial pool latestVersion must be 1");
    }
    if (this.poolRecords.has(record.id)) {
      throw new StorageError("conflict", `Pool ${record.id} already exists`);
    }
    this.poolRecords.set(record.id, record);
    this.poolVersions.set(
      InMemoryLabAssetRepository.key(firstVersion.poolId, firstVersion.version),
      firstVersion,
    );
  }

  async getPoolRecord(id: string): Promise<ModelPoolRecord | null> {
    return this.poolRecords.get(id) ?? null;
  }

  async listPoolRecords(includeArchived = false): Promise<ModelPoolRecord[]> {
    return [...this.poolRecords.values()]
      .filter((r) => includeArchived || r.archivedAt === null)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async archivePoolRecord(
    id: string,
    expectedRevision: number,
    archivedAt: number,
  ): Promise<number> {
    const record = this.poolRecords.get(id);
    if (!record) throw new StorageError("conflict", `Pool ${id} not found`);
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (record.archivedAt !== null) {
      throw new StorageError("conflict", `Pool ${id} is already archived`);
    }
    const newRevision = expectedRevision + 1;
    this.poolRecords.set(id, {
      ...record,
      revision: newRevision,
      archivedAt,
      updatedAt: archivedAt,
    });
    return newRevision;
  }

  // --- Model Pool versions --------------------------------------------------

  async appendPoolVersion(
    version: ModelPoolVersion,
    expectedRevision: number,
  ): Promise<number> {
    if (!isModelPoolVersion(version)) {
      throw new StorageError("validation", "Invalid model pool version");
    }
    const key = InMemoryLabAssetRepository.key(version.poolId, version.version);
    const existing = this.poolVersions.get(key);
    if (existing) {
      if (existing.digest === version.digest) {
        return this.poolRecords.get(version.poolId)?.revision ?? expectedRevision;
      }
      throw new StorageError(
        "conflict",
        `Pool version ${version.poolId}@${version.version} already exists with different content — versions are immutable.`,
      );
    }
    const record = this.poolRecords.get(version.poolId);
    if (!record) throw new StorageError("conflict", `Pool ${version.poolId} not found`);
    if (record.archivedAt !== null) {
      throw new StorageError("conflict", `Pool ${version.poolId} is archived — cannot append`);
    }
    if (record.revision !== expectedRevision) {
      throw new StorageError(
        "conflict",
        `Stale revision: expected ${expectedRevision}, got ${record.revision}`,
      );
    }
    if (version.version !== record.latestVersion + 1) {
      throw new StorageError(
        "conflict",
        `Non-contiguous version: expected ${record.latestVersion + 1}, got ${version.version}`,
      );
    }
    const newRevision = expectedRevision + 1;
    this.poolRecords.set(version.poolId, {
      ...record,
      revision: newRevision,
      latestVersion: version.version,
      updatedAt: version.createdAt,
    });
    this.poolVersions.set(key, version);
    return newRevision;
  }

  async getPoolVersion(poolId: string, version: number): Promise<ModelPoolVersion | null> {
    return this.poolVersions.get(InMemoryLabAssetRepository.key(poolId, version)) ?? null;
  }

  async getLatestPoolVersion(poolId: string): Promise<ModelPoolVersion | null> {
    const matches = [...this.poolVersions.values()].filter((v) => v.poolId === poolId);
    matches.sort((a, b) => b.version - a.version);
    return matches[0] ?? null;
  }

  async listPoolVersions(poolId: string): Promise<ModelPoolVersion[]> {
    return [...this.poolVersions.values()]
      .filter((v) => v.poolId === poolId)
      .sort((a, b) => a.version - b.version);
  }
}
