// =============================================================================
// RSemble AI — Evaluation repository (Dexie-backed)
//
// Implements the EvaluationRepository interface over RSembleEvaluationDB.
// Profile versions are immutable; archive/restore mutates only ProfileRecord.
// Suites pin exact profile versions. Experiment task operations are atomic
// across experiments and runs.
// =============================================================================

import type { RSembleEvaluationDB } from "./database";
import { StorageError, classifyStorageError } from "./database";
import type { RunRepository } from "./run-repository";
import {
  createExperimentUnitOfWork,
  DexieExperimentStore,
  InMemoryExperimentStore,
  type ExperimentUnitOfWork,
} from "./experiment-unit-of-work";
import {
  isEvaluationProfile,
  isEvaluationSuite,
  isProfileRecord,
  isExperimentRecord,
  type EvaluationProfile,
  type EvaluationSuite,
  type ProfileRecord,
  type ExperimentRecord,
  type BeginExperimentTaskInput,
  type CommitExperimentTaskTerminalInput,
} from "../evaluations/evaluation-types";

export interface EvaluationRepository {
  listSuites(includeArchived?: boolean): Promise<EvaluationSuite[]>;
  getSuite(id: string): Promise<EvaluationSuite | null>;
  saveSuite(suite: EvaluationSuite, expectedRevision: number): Promise<number>;
  archiveSuite(id: string): Promise<void>;
  listProfiles(includeArchived?: boolean): Promise<ProfileRecord[]>;
  getProfileRecord(id: string): Promise<ProfileRecord | null>;
  getProfile(id: string, version: number): Promise<EvaluationProfile | null>;
  createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void>;
  appendProfileVersion(record: ProfileRecord, profile: EvaluationProfile, expectedRevision: number): Promise<number>;
  setProfileArchived(id: string, archived: boolean, expectedRevision: number): Promise<number>;
  createExperiment(experiment: ExperimentRecord): Promise<void>;
  updateExperiment(experiment: ExperimentRecord, expectedRevision: number): Promise<number>;
  getExperiment(id: string): Promise<ExperimentRecord | null>;
  listExperiments(suiteId?: string): Promise<ExperimentRecord[]>;
  beginExperimentTask(input: BeginExperimentTaskInput): Promise<{ runRevision: number; experimentRevision: number }>;
  commitExperimentTaskTerminal(input: CommitExperimentTaskTerminalInput): Promise<{ runRevision: number; experimentRevision: number }>;
}

// selectedAttemptId recomposition lives in experiment-engine.ts (selectAttemptId)
// and is applied by the shared experiment unit of work.

export function createEvaluationRepository(
  db: RSembleEvaluationDB,
  _runRepo: RunRepository,
): EvaluationRepository {
  async function listSuites(includeArchived = false): Promise<EvaluationSuite[]> {
    try {
      const rows = await db.suites.toArray();
      return rows
        .filter((r) => includeArchived || !(r.suite as EvaluationSuite).archivedAt)
        .map((r) => r.suite)
        .filter((s): s is EvaluationSuite => isEvaluationSuite(s))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getSuite(id: string): Promise<EvaluationSuite | null> {
    try {
      const row = await db.suites.get(id);
      if (!row) return null;
      return isEvaluationSuite(row.suite) ? row.suite : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function saveSuite(suite: EvaluationSuite, expectedRevision: number): Promise<number> {
    if (!isEvaluationSuite(suite)) throw new StorageError("validation", "Invalid suite");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.suites, async () => {
        const existing = await db.suites.get(suite.id);
        if (existing && existing.revision !== expectedRevision) {
          throw new StorageError("conflict", `Stale revision: expected ${expectedRevision}, got ${existing.revision}`);
        }
        await db.suites.put({
          id: suite.id,
          suite: { ...suite, revision: newRevision },
          revision: newRevision,
          version: suite.version,
          updatedAt: suite.updatedAt,
          archivedAt: suite.archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function archiveSuite(id: string): Promise<void> {
    db.assertWritable();
    try {
      await db.transaction("rw", db.suites, async () => {
        const row = await db.suites.get(id);
        if (!row) throw new StorageError("conflict", `Suite ${id} not found`);
        const suite = row.suite;
        if (!isEvaluationSuite(suite)) throw new StorageError("validation", "Invalid suite data");
        await db.suites.put({
          ...row,
          suite: { ...suite, archivedAt: Date.now() },
          revision: row.revision + 1,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listProfiles(includeArchived = false): Promise<ProfileRecord[]> {
    try {
      const rows = await db.profiles.toArray();
      return rows
        .filter((r) => includeArchived || r.archivedAt === null)
        .filter((r) => isProfileRecord(r.record))
        .map((r) => r.record as ProfileRecord)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getProfileRecord(id: string): Promise<ProfileRecord | null> {
    try {
      const row = await db.profiles.get(id);
      if (!row) return null;
      return isProfileRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getProfile(id: string, version: number): Promise<EvaluationProfile | null> {
    try {
      const row = await db.profileVersions.get([id, version]);
      if (!row) return null;
      return isEvaluationProfile(row.profile) ? row.profile : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void> {
    if (!isProfileRecord(record)) throw new StorageError("validation", "Invalid profile record");
    if (!isEvaluationProfile(profile)) throw new StorageError("validation", "Invalid profile");
    if (record.id !== profile.id) throw new StorageError("validation", "Record/profile ID mismatch");
    if (profile.version !== 1) throw new StorageError("validation", "First version must be 1");
    db.assertWritable();
    try {
      await db.transaction("rw", db.profiles, db.profileVersions, async () => {
        const existing = await db.profiles.get(record.id);
        if (existing) throw new StorageError("conflict", `Profile ${record.id} already exists`);
        await db.profiles.put({
          id: record.id,
          record,
          revision: record.revision,
          latestVersion: record.latestVersion,
          updatedAt: record.updatedAt,
          archivedAt: record.archivedAt,
        });
        await db.profileVersions.put({
          id: profile.id,
          version: profile.version,
          profile,
          updatedAt: profile.updatedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function appendProfileVersion(
    record: ProfileRecord,
    profile: EvaluationProfile,
    expectedRevision: number,
  ): Promise<number> {
    if (!isProfileRecord(record)) throw new StorageError("validation", "Invalid profile record");
    if (!isEvaluationProfile(profile)) throw new StorageError("validation", "Invalid profile");
    if (record.id !== profile.id) throw new StorageError("validation", "Record/profile ID mismatch");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.profiles, db.profileVersions, async () => {
        const existing = await db.profiles.get(record.id);
        if (!existing) throw new StorageError("conflict", `Profile ${record.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError("conflict", `Stale revision: expected ${expectedRevision}, got ${existing.revision}`);
        }
        const newVersion = existing.latestVersion + 1;
        const updatedProfile: EvaluationProfile = { ...profile, version: newVersion };
        const updatedRecord: ProfileRecord = {
          ...record,
          revision: newRevision,
          latestVersion: newVersion,
          updatedAt: Date.now(),
        };
        await db.profiles.put({
          id: record.id,
          record: updatedRecord,
          revision: newRevision,
          latestVersion: newVersion,
          updatedAt: updatedRecord.updatedAt,
          archivedAt: record.archivedAt,
        });
        await db.profileVersions.put({
          id: profile.id,
          version: newVersion,
          profile: updatedProfile,
          updatedAt: updatedRecord.updatedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function setProfileArchived(
    id: string,
    archived: boolean,
    expectedRevision: number,
  ): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.profiles, async () => {
        const existing = await db.profiles.get(id);
        if (!existing) throw new StorageError("conflict", `Profile ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError("conflict", `Stale revision: expected ${expectedRevision}, got ${existing.revision}`);
        }
        const record = isProfileRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid profile record");
        const updated: ProfileRecord = {
          ...record,
          revision: newRevision,
          archivedAt: archived ? Date.now() : null,
          updatedAt: Date.now(),
        };
        await db.profiles.put({
          ...existing,
          record: updated,
          revision: newRevision,
          latestVersion: existing.latestVersion,
          updatedAt: updated.updatedAt,
          archivedAt: updated.archivedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function createExperiment(experiment: ExperimentRecord): Promise<void> {
    if (!isExperimentRecord(experiment)) throw new StorageError("validation", "Invalid experiment");
    db.assertWritable();
    try {
      await db.transaction("rw", db.experiments, async () => {
        const existing = await db.experiments.get(experiment.id);
        if (existing) throw new StorageError("conflict", `Experiment ${experiment.id} already exists`);
        await db.experiments.put({
          id: experiment.id,
          experiment,
          revision: experiment.revision,
          suiteId: experiment.suiteId,
          suiteVersion: experiment.suiteVersion,
          protocolFingerprint: experiment.protocolFingerprint,
          createdAt: experiment.createdAt,
          status: experiment.status,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function updateExperiment(
    experiment: ExperimentRecord,
    expectedRevision: number,
  ): Promise<number> {
    if (!isExperimentRecord(experiment)) throw new StorageError("validation", "Invalid experiment");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.experiments, async () => {
        const existing = await db.experiments.get(experiment.id);
        if (!existing) throw new StorageError("conflict", `Experiment ${experiment.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError("conflict", `Stale revision: expected ${expectedRevision}, got ${existing.revision}`);
        }
        const updated: ExperimentRecord = { ...experiment, revision: newRevision };
        await db.experiments.put({
          id: experiment.id,
          experiment: updated,
          revision: newRevision,
          suiteId: experiment.suiteId,
          suiteVersion: experiment.suiteVersion,
          protocolFingerprint: experiment.protocolFingerprint,
          createdAt: experiment.createdAt,
          status: experiment.status,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getExperiment(id: string): Promise<ExperimentRecord | null> {
    try {
      const row = await db.experiments.get(id);
      if (!row) return null;
      return isExperimentRecord(row.experiment) ? row.experiment : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listExperiments(suiteId?: string): Promise<ExperimentRecord[]> {
    try {
      const rows = suiteId
        ? await db.experiments.where("suiteId").equals(suiteId).reverse().toArray()
        : await db.experiments.orderBy("createdAt").reverse().toArray();
      return rows
        .map((r) => r.experiment)
        .filter((e): e is ExperimentRecord => isExperimentRecord(e));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  // begin/commit delegate to the shared experiment unit of work (Task 6.2):
  // fence-verified when supplied, idempotent for identical IDs/payload, and
  // atomic across experiments + run tables.
  const experimentUow = createExperimentUnitOfWork(new DexieExperimentStore(db));

  async function beginExperimentTask(
    input: BeginExperimentTaskInput,
  ): Promise<{ runRevision: number; experimentRevision: number }> {
    return experimentUow.beginTask(input);
  }

  async function commitExperimentTaskTerminal(
    input: CommitExperimentTaskTerminalInput,
  ): Promise<{ runRevision: number; experimentRevision: number }> {
    return experimentUow.commitTaskTerminal(input);
  }

  return {
    listSuites, getSuite, saveSuite, archiveSuite,
    listProfiles, getProfileRecord, getProfile, createProfile, appendProfileVersion, setProfileArchived,
    createExperiment, updateExperiment, getExperiment, listExperiments,
    beginExperimentTask, commitExperimentTaskTerminal,
  };
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private suites = new Map<string, EvaluationSuite>();
  private profileRecords = new Map<string, ProfileRecord>();
  private profileVersions = new Map<string, Map<number, EvaluationProfile>>();
  private experiments: Map<string, ExperimentRecord>;
  private readonly experimentUow: ExperimentUnitOfWork;

  /** Optional shared experiments map lets a test harness back this repository
   *  and an external InMemoryExperimentStore with one table — mirroring the
   *  single-Dexie-DB production wiring. */
  constructor(shared?: { experiments?: Map<string, ExperimentRecord> }) {
    this.experiments = shared?.experiments ?? new Map<string, ExperimentRecord>();
    this.experimentUow = createExperimentUnitOfWork(
      new InMemoryExperimentStore({ experiments: this.experiments }),
    );
  }

  async listSuites(includeArchived = false): Promise<EvaluationSuite[]> {
    return [...this.suites.values()]
      .filter((s) => includeArchived || !s.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getSuite(id: string): Promise<EvaluationSuite | null> {
    return this.suites.get(id) ?? null;
  }
  async saveSuite(suite: EvaluationSuite, expectedRevision: number): Promise<number> {
    // Same contract as the Dexie store — a test double that silently accepts
    // records the real store rejects lets invalid drafts ship.
    if (!isEvaluationSuite(suite)) throw new StorageError("validation", "Invalid suite");
    const existing = this.suites.get(suite.id);
    if (existing && existing.revision !== expectedRevision) throw new StorageError("conflict", "Stale revision");
    const newRevision = expectedRevision + 1;
    this.suites.set(suite.id, { ...suite, revision: newRevision });
    return newRevision;
  }
  async archiveSuite(id: string): Promise<void> {
    const s = this.suites.get(id);
    if (!s) throw new StorageError("conflict", `Suite ${id} not found`);
    this.suites.set(id, { ...s, archivedAt: Date.now(), revision: s.revision + 1 });
  }
  async listProfiles(includeArchived = false): Promise<ProfileRecord[]> {
    return [...this.profileRecords.values()]
      .filter((r) => includeArchived || !r.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getProfileRecord(id: string): Promise<ProfileRecord | null> {
    return this.profileRecords.get(id) ?? null;
  }
  async getProfile(id: string, version: number): Promise<EvaluationProfile | null> {
    return this.profileVersions.get(id)?.get(version) ?? null;
  }
  async createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void> {
    // Same contract as the Dexie store (validation + id/version checks).
    if (!isProfileRecord(record)) throw new StorageError("validation", "Invalid profile record");
    if (!isEvaluationProfile(profile)) throw new StorageError("validation", "Invalid profile");
    if (record.id !== profile.id) throw new StorageError("validation", "Record/profile ID mismatch");
    if (profile.version !== 1) throw new StorageError("validation", "First version must be 1");
    if (this.profileRecords.has(record.id)) throw new StorageError("conflict", "Profile exists");
    this.profileRecords.set(record.id, record);
    const versions = new Map<number, EvaluationProfile>();
    versions.set(profile.version, profile);
    this.profileVersions.set(record.id, versions);
  }
  async appendProfileVersion(record: ProfileRecord, profile: EvaluationProfile, expectedRevision: number): Promise<number> {
    if (!isProfileRecord(record)) throw new StorageError("validation", "Invalid profile record");
    if (!isEvaluationProfile(profile)) throw new StorageError("validation", "Invalid profile");
    if (record.id !== profile.id) throw new StorageError("validation", "Record/profile ID mismatch");
    const existing = this.profileRecords.get(record.id);
    if (!existing) throw new StorageError("conflict", "Profile not found");
    if (existing.revision !== expectedRevision) throw new StorageError("conflict", "Stale revision");
    const newVersion = existing.latestVersion + 1;
    const newRevision = expectedRevision + 1;
    this.profileRecords.set(record.id, { ...record, revision: newRevision, latestVersion: newVersion, updatedAt: Date.now() });
    this.profileVersions.get(record.id)?.set(newVersion, { ...profile, version: newVersion });
    return newRevision;
  }
  async setProfileArchived(id: string, archived: boolean, expectedRevision: number): Promise<number> {
    const existing = this.profileRecords.get(id);
    if (!existing) throw new StorageError("conflict", "Profile not found");
    if (existing.revision !== expectedRevision) throw new StorageError("conflict", "Stale revision");
    const newRevision = expectedRevision + 1;
    this.profileRecords.set(id, { ...existing, revision: newRevision, archivedAt: archived ? Date.now() : null, updatedAt: Date.now() });
    return newRevision;
  }
  async createExperiment(experiment: ExperimentRecord): Promise<void> {
    if (this.experiments.has(experiment.id)) throw new StorageError("conflict", "Experiment exists");
    this.experiments.set(experiment.id, experiment);
  }
  async updateExperiment(experiment: ExperimentRecord, expectedRevision: number): Promise<number> {
    const existing = this.experiments.get(experiment.id);
    if (!existing) throw new StorageError("conflict", "Experiment not found");
    if (existing.revision !== expectedRevision) throw new StorageError("conflict", "Stale revision");
    const newRevision = expectedRevision + 1;
    this.experiments.set(experiment.id, { ...experiment, revision: newRevision });
    return newRevision;
  }
  async getExperiment(id: string): Promise<ExperimentRecord | null> {
    return this.experiments.get(id) ?? null;
  }
  async listExperiments(suiteId?: string): Promise<ExperimentRecord[]> {
    return [...this.experiments.values()]
      .filter((e) => !suiteId || e.suiteId === suiteId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async beginExperimentTask(input: BeginExperimentTaskInput): Promise<{ runRevision: number; experimentRevision: number }> {
    return this.experimentUow.beginTask(input);
  }
  async commitExperimentTaskTerminal(input: CommitExperimentTaskTerminalInput): Promise<{ runRevision: number; experimentRevision: number }> {
    return this.experimentUow.commitTaskTerminal(input);
  }
}
