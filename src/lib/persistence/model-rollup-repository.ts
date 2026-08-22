import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import {
  isModelRollupRecord,
  isModelRollupVersion,
  modelRollupVersionToResolvedManifest,
  type ModelRollupRecord,
  type ModelRollupVersion,
  type ResolvedModelRollupManifest,
} from "../model-rollups/model-rollup-types";
import { classifyStorageError, type RSembleEvaluationDB, StorageError } from "./database";

export interface ModelRollupListQuery {
  archiveState?: "active" | "archived" | "all";
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ModelRollupRepository {
  createModelRollup(record: ModelRollupRecord, version: ModelRollupVersion): Promise<void>;
  appendModelRollupVersion(
    record: ModelRollupRecord,
    version: ModelRollupVersion,
    expectedRevision: number,
  ): Promise<number>;
  archiveModelRollup(id: string, expectedRevision: number, archivedAt?: number): Promise<number>;
  restoreModelRollup(id: string, expectedRevision: number, updatedAt?: number): Promise<number>;
  getModelRollupRecord(id: string): Promise<ModelRollupRecord | null>;
  getModelRollupVersion(rollupId: string, version: number): Promise<ModelRollupVersion | null>;
  resolveModelRollupVersion(
    rollupId: string,
    version: number,
  ): Promise<ResolvedModelRollupManifest | null>;
  listModelRollups(query?: ModelRollupListQuery): Promise<ModelRollupRecord[]>;
  listModelRollupVersions(rollupId: string): Promise<ModelRollupVersion[]>;
}

export function assertValidModelRollupPair(
  record: ModelRollupRecord,
  version: ModelRollupVersion,
): void {
  if (!isModelRollupRecord(record)) {
    throw new StorageError("validation", "Invalid Model Rollup record");
  }
  if (!isModelRollupVersion(version)) {
    throw new StorageError(
      "validation",
      "Invalid Model Rollup version; aggregationPolicy must be stratified_only",
    );
  }
  if (record.id !== version.rollupId) {
    throw new StorageError("validation", "Model Rollup record/version ID mismatch");
  }
  if (record.name !== version.name || record.latestVersion !== version.version) {
    throw new StorageError(
      "validation",
      "Model Rollup record must identify the appended version name and number",
    );
  }
}

export async function assertExactModelRollupMembers(
  version: ModelRollupVersion,
  memberExists: (id: string) => Promise<boolean>,
): Promise<void> {
  for (const id of version.memberConfigurationIds) {
    if (!(await memberExists(id))) {
      throw new StorageError(
        "validation",
        `Model Rollup member ${id} is not an exact configuration in this database`,
      );
    }
  }
}

function recordFromRow(row: { record: unknown }): ModelRollupRecord {
  if (!isModelRollupRecord(row.record)) {
    throw new StorageError("validation", "Stored Model Rollup record is invalid");
  }
  return structuredClone(row.record);
}

function versionFromRow(row: { version_: unknown }): ModelRollupVersion {
  if (!isModelRollupVersion(row.version_)) {
    throw new StorageError("validation", "Stored Model Rollup version is invalid");
  }
  return structuredClone(row.version_);
}

export function applyModelRollupListQuery(
  records: ModelRollupRecord[],
  query: ModelRollupListQuery = {},
): ModelRollupRecord[] {
  const archiveState = query.archiveState ?? "active";
  const search = query.search?.trim().toLocaleLowerCase() ?? "";
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const limit = Math.max(0, Math.trunc(query.limit ?? 50));
  return records
    .filter((record) => {
      if (archiveState === "active" && record.archivedAt !== null) return false;
      if (archiveState === "archived" && record.archivedAt === null) return false;
      return search.length === 0 || record.name.toLocaleLowerCase().includes(search);
    })
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(offset, offset + limit)
    .map((record) => structuredClone(record));
}

export function createModelRollupRepository(db: RSembleEvaluationDB): ModelRollupRepository {
  const memberExists = async (id: string) => (await db.modelConfigurations.get(id)) !== undefined;

  async function createModelRollup(
    record: ModelRollupRecord,
    version: ModelRollupVersion,
  ): Promise<void> {
    assertValidModelRollupPair(record, version);
    if (record.latestVersion !== 1 || version.version !== 1 || record.revision !== 0) {
      throw new StorageError(
        "validation",
        "A new Model Rollup must start at version 1, revision 0",
      );
    }
    db.assertWritable();
    try {
      await db.transaction(
        "rw",
        db.modelRollups,
        db.modelRollupVersions,
        db.modelConfigurations,
        async () => {
          await assertExactModelRollupMembers(version, memberExists);
          if (await db.modelRollups.get(record.id)) {
            throw new StorageError("conflict", `Model Rollup ${record.id} already exists`);
          }
          await db.modelRollups.add({
            id: record.id,
            record: structuredClone(record),
            name: record.name,
            latestVersion: record.latestVersion,
            revision: record.revision,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            archivedAt: record.archivedAt,
          });
          await db.modelRollupVersions.add({
            rollupId: version.rollupId,
            version: version.version,
            version_: structuredClone(version),
            memberManifestDigest: version.memberManifestDigest,
            createdAt: version.createdAt,
          });
        },
      );
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw classifyStorageError(error);
    }
  }

  async function appendModelRollupVersion(
    record: ModelRollupRecord,
    version: ModelRollupVersion,
    expectedRevision: number,
  ): Promise<number> {
    assertValidModelRollupPair(record, version);
    db.assertWritable();
    try {
      return await db.transaction(
        "rw",
        db.modelRollups,
        db.modelRollupVersions,
        db.modelConfigurations,
        async () => {
          const row = await db.modelRollups.get(record.id);
          if (!row) throw new StorageError("conflict", `Model Rollup ${record.id} not found`);
          const existing = recordFromRow(row);
          if (existing.revision !== expectedRevision) {
            throw new StorageError(
              "conflict",
              `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
            );
          }
          if (existing.archivedAt !== null) {
            throw new StorageError("conflict", "Archived Model Rollups are read-only");
          }
          if (version.version !== existing.latestVersion + 1) {
            throw new StorageError("conflict", "Model Rollup versions must append contiguously");
          }
          if (record.createdAt !== existing.createdAt || record.archivedAt !== null) {
            throw new StorageError(
              "validation",
              "Model Rollup stable identity/lifecycle is immutable",
            );
          }
          await assertExactModelRollupMembers(version, memberExists);
          if (await db.modelRollupVersions.get([version.rollupId, version.version])) {
            throw new StorageError("conflict", "Model Rollup versions are immutable");
          }
          const revision = expectedRevision + 1;
          const next: ModelRollupRecord = { ...record, revision };
          await db.modelRollupVersions.add({
            rollupId: version.rollupId,
            version: version.version,
            version_: structuredClone(version),
            memberManifestDigest: version.memberManifestDigest,
            createdAt: version.createdAt,
          });
          await db.modelRollups.put({
            id: next.id,
            record: structuredClone(next),
            name: next.name,
            latestVersion: next.latestVersion,
            revision,
            createdAt: next.createdAt,
            updatedAt: next.updatedAt,
            archivedAt: next.archivedAt,
          });
          return revision;
        },
      );
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw classifyStorageError(error);
    }
  }

  async function setArchiveState(
    id: string,
    expectedRevision: number,
    archived: boolean,
    changedAt = Date.now(),
  ): Promise<number> {
    if (!Number.isFinite(changedAt) || changedAt < 0) {
      throw new StorageError("validation", "Lifecycle timestamp must be non-negative");
    }
    db.assertWritable();
    try {
      return await db.transaction("rw", db.modelRollups, async () => {
        const row = await db.modelRollups.get(id);
        if (!row) throw new StorageError("conflict", `Model Rollup ${id} not found`);
        const existing = recordFromRow(row);
        if (existing.revision !== expectedRevision) {
          throw new StorageError("conflict", "Stale Model Rollup revision");
        }
        if ((existing.archivedAt !== null) === archived) return expectedRevision;
        const revision = expectedRevision + 1;
        const next: ModelRollupRecord = {
          ...existing,
          archivedAt: archived ? changedAt : null,
          updatedAt: changedAt,
          revision,
        };
        await db.modelRollups.put({
          ...row,
          record: next,
          name: next.name,
          revision,
          updatedAt: changedAt,
          archivedAt: next.archivedAt,
        });
        return revision;
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw classifyStorageError(error);
    }
  }

  return {
    createModelRollup,
    appendModelRollupVersion,
    archiveModelRollup: (id, revision, at) => setArchiveState(id, revision, true, at),
    restoreModelRollup: (id, revision, at) => setArchiveState(id, revision, false, at),
    async getModelRollupRecord(id) {
      const row = await db.modelRollups.get(id);
      return row ? recordFromRow(row) : null;
    },
    async getModelRollupVersion(rollupId, version) {
      const row = await db.modelRollupVersions.get([rollupId, version]);
      return row ? versionFromRow(row) : null;
    },
    async resolveModelRollupVersion(rollupId, version) {
      const row = await db.modelRollupVersions.get([rollupId, version]);
      return row ? modelRollupVersionToResolvedManifest(versionFromRow(row)) : null;
    },
    async listModelRollups(query) {
      const rows = await db.modelRollups.toArray();
      return applyModelRollupListQuery(rows.map(recordFromRow), query);
    },
    async listModelRollupVersions(rollupId) {
      const rows = await db.modelRollupVersions
        .where("rollupId")
        .equals(rollupId)
        .sortBy("version");
      return rows.map(versionFromRow);
    },
  };
}

export function modelRollupDefinitionsEqual(a: unknown, b: unknown): boolean {
  return canonicalJsonString(a) === canonicalJsonString(b);
}
