import {
  modelRollupVersionToResolvedManifest,
  type ModelRollupRecord,
  type ModelRollupVersion,
} from "../model-rollups/model-rollup-types";
import { StorageError } from "./database";
import {
  applyModelRollupListQuery,
  assertExactModelRollupMembers,
  assertValidModelRollupPair,
  type ModelRollupListQuery,
  type ModelRollupRepository,
} from "./model-rollup-repository";

export class InMemoryModelRollupRepository implements ModelRollupRepository {
  private readonly records = new Map<string, ModelRollupRecord>();
  private readonly versions = new Map<string, ModelRollupVersion>();
  private readonly exactMemberIds: Set<string>;

  constructor(exactMemberIds: Iterable<string> = []) {
    this.exactMemberIds = new Set(exactMemberIds);
  }

  registerExactMember(id: string): void {
    this.exactMemberIds.add(id);
  }

  async createModelRollup(record: ModelRollupRecord, version: ModelRollupVersion): Promise<void> {
    assertValidModelRollupPair(record, version);
    if (record.latestVersion !== 1 || version.version !== 1 || record.revision !== 0) {
      throw new StorageError("validation", "A new Model Rollup must start at version 1, revision 0");
    }
    await assertExactModelRollupMembers(version, async (id) => this.exactMemberIds.has(id));
    if (this.records.has(record.id)) {
      throw new StorageError("conflict", `Model Rollup ${record.id} already exists`);
    }
    const recordClone = structuredClone(record);
    const versionClone = structuredClone(version);
    this.records.set(record.id, recordClone);
    this.versions.set(`${version.rollupId}\u0000${version.version}`, versionClone);
  }

  async appendModelRollupVersion(
    record: ModelRollupRecord,
    version: ModelRollupVersion,
    expectedRevision: number,
  ): Promise<number> {
    assertValidModelRollupPair(record, version);
    const existing = this.records.get(record.id);
    if (!existing) throw new StorageError("conflict", `Model Rollup ${record.id} not found`);
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
      throw new StorageError("validation", "Model Rollup stable identity/lifecycle is immutable");
    }
    await assertExactModelRollupMembers(version, async (id) => this.exactMemberIds.has(id));
    const key = `${version.rollupId}\u0000${version.version}`;
    if (this.versions.has(key)) throw new StorageError("conflict", "Model Rollup versions are immutable");
    const revision = expectedRevision + 1;
    const next = structuredClone({ ...record, revision });
    const versionClone = structuredClone(version);
    this.versions.set(key, versionClone);
    this.records.set(record.id, next);
    return revision;
  }

  private setArchiveState(
    id: string,
    expectedRevision: number,
    archived: boolean,
    changedAt = Date.now(),
  ): number {
    const existing = this.records.get(id);
    if (!existing) throw new StorageError("conflict", `Model Rollup ${id} not found`);
    if (existing.revision !== expectedRevision) {
      throw new StorageError("conflict", "Stale Model Rollup revision");
    }
    if ((existing.archivedAt !== null) === archived) return expectedRevision;
    const revision = expectedRevision + 1;
    this.records.set(
      id,
      structuredClone({
        ...existing,
        archivedAt: archived ? changedAt : null,
        updatedAt: changedAt,
        revision,
      }),
    );
    return revision;
  }

  async archiveModelRollup(id: string, expectedRevision: number, archivedAt?: number): Promise<number> {
    return this.setArchiveState(id, expectedRevision, true, archivedAt);
  }

  async restoreModelRollup(id: string, expectedRevision: number, updatedAt?: number): Promise<number> {
    return this.setArchiveState(id, expectedRevision, false, updatedAt);
  }

  async getModelRollupRecord(id: string): Promise<ModelRollupRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async getModelRollupVersion(rollupId: string, version: number): Promise<ModelRollupVersion | null> {
    const value = this.versions.get(`${rollupId}\u0000${version}`);
    return value ? structuredClone(value) : null;
  }

  async resolveModelRollupVersion(rollupId: string, version: number) {
    const value = await this.getModelRollupVersion(rollupId, version);
    return value ? modelRollupVersionToResolvedManifest(value) : null;
  }

  async listModelRollups(query?: ModelRollupListQuery): Promise<ModelRollupRecord[]> {
    return applyModelRollupListQuery([...this.records.values()], query);
  }

  async listModelRollupVersions(rollupId: string): Promise<ModelRollupVersion[]> {
    return [...this.versions.values()]
      .filter((version) => version.rollupId === rollupId)
      .sort((a, b) => a.version - b.version)
      .map((version) => structuredClone(version));
  }
}
