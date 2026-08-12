// =============================================================================
// RSemble AI — Evaluation repository (Dexie-backed)
//
// Implements the EvaluationRepository interface over RSembleEvaluationDB.
// Rubric versions are immutable; archive/restore mutates only RubricRecord.
// Suites pin exact rubric versions. Experiment task operations are atomic
// across experiments and runs.
//
// Canonical Rubric repository API (spec §5.1): listRubrics, getRubricRecord,
// getRubricVersion, createRubric, appendRubricVersion, archiveRubric,
// restoreRubric, duplicateRubric. These methods operate directly over the
// frozen physical `profiles` / `profileVersions` Dexie stores — no store
// renames, no data copies, no migration. The legacy `*Profile*` methods
// remain only as explicitly deprecated forwarding adapters so existing
// consumers compile during the staged terminology migration; new consumers
// MUST call the canonical methods.
// =============================================================================

import { type RSembleEvaluationDB, StorageError, classifyStorageError } from "./database";
import type { RunRepository } from "./run-repository";
import {
  createExperimentUnitOfWork,
  DexieExperimentStore,
  InMemoryExperimentStore,
  type ExperimentUnitOfWork,
} from "./experiment-unit-of-work";
import {
  isEvaluationRubric,
  isEvaluationSuite,
  isRubricRecord,
  isExperimentRecord,
  type EvaluationRubric,
  type EvaluationSuite,
  type RubricRecord,
  type ExperimentRecord,
  type BeginExperimentTaskInput,
  type CommitExperimentTaskTerminalInput,
  // Legacy type aliases — used only in the deprecated adapter method
  // signatures below. They are identical to the canonical types above
  // (EvaluationProfile = EvaluationRubric, ProfileRecord = RubricRecord).
  type EvaluationProfile,
  type ProfileRecord,
} from "../evaluations/evaluation-types";
import {
  importSuitePackage as persistSuitePackage,
  type SuitePackageImportResult,
} from "./suite-package-import";
import type { ImportedSuitePackage } from "../evaluations/suite-package";

export interface EvaluationRepository {
  listSuites(includeArchived?: boolean): Promise<EvaluationSuite[]>;
  getSuite(id: string): Promise<EvaluationSuite | null>;
  saveSuite(suite: EvaluationSuite, expectedRevision: number): Promise<number>;
  archiveSuite(id: string): Promise<void>;

  // --- Canonical Rubric repository API (spec §5.1) -------------------------
  // Operates over the frozen `profiles` / `profileVersions` physical stores.
  // New consumers MUST call these methods instead of the deprecated
  // `*Profile*` adapters below.
  listRubrics(includeArchived?: boolean): Promise<RubricRecord[]>;
  getRubricRecord(id: string): Promise<RubricRecord | null>;
  getRubricVersion(id: string, version: number): Promise<EvaluationRubric | null>;
  createRubric(record: RubricRecord, rubric: EvaluationRubric): Promise<void>;
  appendRubricVersion(
    record: RubricRecord,
    rubric: EvaluationRubric,
    expectedRevision: number,
  ): Promise<number>;
  archiveRubric(id: string, expectedRevision: number): Promise<number>;
  restoreRubric(id: string, expectedRevision: number): Promise<number>;
  duplicateRubric(sourceId: string, newId: string): Promise<void>;

  // --- Deprecated legacy Profile adapter surface ---------------------------
  // These methods forward to the canonical Rubric methods above. They remain
  // only so existing consumers compile during the staged terminology
  // migration (rubric-terminology spec §3.2/§7). New consumers MUST NOT call
  // them — import and use the canonical methods instead. Remove once every
  // consumer migrates.
  /** @deprecated Use `listRubrics`. */
  listProfiles(includeArchived?: boolean): Promise<ProfileRecord[]>;
  /** @deprecated Use `getRubricRecord`. */
  getProfileRecord(id: string): Promise<ProfileRecord | null>;
  /** @deprecated Use `getRubricVersion`. */
  getProfile(id: string, version: number): Promise<EvaluationProfile | null>;
  /** @deprecated Use `createRubric`. */
  createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void>;
  /** @deprecated Use `appendRubricVersion`. */
  appendProfileVersion(
    record: ProfileRecord,
    profile: EvaluationProfile,
    expectedRevision: number,
  ): Promise<number>;
  /** @deprecated Use `archiveRubric` / `restoreRubric`. */
  setProfileArchived(id: string, archived: boolean, expectedRevision: number): Promise<number>;

  createExperiment(experiment: ExperimentRecord): Promise<void>;
  updateExperiment(experiment: ExperimentRecord, expectedRevision: number): Promise<number>;
  getExperiment(id: string): Promise<ExperimentRecord | null>;
  listExperiments(suiteId?: string): Promise<ExperimentRecord[]>;
  beginExperimentTask(
    input: BeginExperimentTaskInput,
  ): Promise<{ runRevision: number; experimentRevision: number }>;
  commitExperimentTaskTerminal(
    input: CommitExperimentTaskTerminalInput,
  ): Promise<{ runRevision: number; experimentRevision: number }>;
  /** Import a normalized suite package — always creates new entities. */
  importSuitePackage(imported: ImportedSuitePackage): Promise<SuitePackageImportResult>;
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
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
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

  // --- Canonical Rubric repository API ---------------------------------------
  // Operates directly over the frozen `profiles` / `profileVersions` physical
  // Dexie stores. No store renames, no data copies.

  async function listRubrics(includeArchived = false): Promise<RubricRecord[]> {
    try {
      const rows = await db.profiles.toArray();
      return rows
        .filter((r) => includeArchived || r.archivedAt === null)
        .filter((r) => isRubricRecord(r.record))
        .map((r) => r.record as RubricRecord)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getRubricRecord(id: string): Promise<RubricRecord | null> {
    try {
      const row = await db.profiles.get(id);
      if (!row) return null;
      return isRubricRecord(row.record) ? row.record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getRubricVersion(id: string, version: number): Promise<EvaluationRubric | null> {
    try {
      const row = await db.profileVersions.get([id, version]);
      if (!row) return null;
      return isEvaluationRubric(row.profile) ? row.profile : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function createRubric(record: RubricRecord, rubric: EvaluationRubric): Promise<void> {
    if (!isRubricRecord(record)) throw new StorageError("validation", "Invalid rubric record");
    if (!isEvaluationRubric(rubric)) throw new StorageError("validation", "Invalid rubric");
    if (record.id !== rubric.id) throw new StorageError("validation", "Record/rubric ID mismatch");
    if (rubric.version !== 1) throw new StorageError("validation", "First version must be 1");
    db.assertWritable();
    try {
      await db.transaction("rw", db.profiles, db.profileVersions, async () => {
        const existing = await db.profiles.get(record.id);
        if (existing) throw new StorageError("conflict", `Rubric ${record.id} already exists`);
        await db.profiles.put({
          id: record.id,
          record,
          revision: record.revision,
          latestVersion: record.latestVersion,
          updatedAt: record.updatedAt,
          archivedAt: record.archivedAt,
        });
        await db.profileVersions.put({
          id: rubric.id,
          version: rubric.version,
          profile: rubric,
          updatedAt: rubric.updatedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function appendRubricVersion(
    record: RubricRecord,
    rubric: EvaluationRubric,
    expectedRevision: number,
  ): Promise<number> {
    if (!isRubricRecord(record)) throw new StorageError("validation", "Invalid rubric record");
    if (!isEvaluationRubric(rubric)) throw new StorageError("validation", "Invalid rubric");
    if (record.id !== rubric.id) throw new StorageError("validation", "Record/rubric ID mismatch");
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.profiles, db.profileVersions, async () => {
        const existing = await db.profiles.get(record.id);
        if (!existing) throw new StorageError("conflict", `Rubric ${record.id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const newVersion = existing.latestVersion + 1;
        const updatedRubric: EvaluationRubric = { ...rubric, version: newVersion };
        const updatedRecord: RubricRecord = {
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
          id: rubric.id,
          version: newVersion,
          profile: updatedRubric,
          updatedAt: updatedRecord.updatedAt,
        });
      });
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function archiveRubric(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.profiles, async () => {
        const existing = await db.profiles.get(id);
        if (!existing) throw new StorageError("conflict", `Rubric ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const record = isRubricRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid rubric record");
        const updated: RubricRecord = {
          ...record,
          revision: newRevision,
          archivedAt: Date.now(),
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

  async function restoreRubric(id: string, expectedRevision: number): Promise<number> {
    db.assertWritable();
    const newRevision = expectedRevision + 1;
    try {
      await db.transaction("rw", db.profiles, async () => {
        const existing = await db.profiles.get(id);
        if (!existing) throw new StorageError("conflict", `Rubric ${id} not found`);
        if (existing.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
        }
        const record = isRubricRecord(existing.record) ? existing.record : null;
        if (!record) throw new StorageError("validation", "Invalid rubric record");
        const updated: RubricRecord = {
          ...record,
          revision: newRevision,
          archivedAt: null,
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

  async function duplicateRubric(sourceId: string, newId: string): Promise<void> {
    db.assertWritable();
    try {
      await db.transaction("rw", db.profiles, db.profileVersions, async () => {
        const sourceRow = await db.profiles.get(sourceId);
        if (!sourceRow) throw new StorageError("conflict", `Rubric ${sourceId} not found`);
        const sourceRecord = isRubricRecord(sourceRow.record) ? sourceRow.record : null;
        if (!sourceRecord) throw new StorageError("validation", "Invalid rubric record");
        const sourceVersionRow = await db.profileVersions.get([sourceId, sourceRow.latestVersion]);
        if (!sourceVersionRow)
          throw new StorageError("validation", `Missing rubric version ${sourceRow.latestVersion}`);
        const sourceRubric = isEvaluationRubric(sourceVersionRow.profile)
          ? sourceVersionRow.profile
          : null;
        if (!sourceRubric) throw new StorageError("validation", "Invalid rubric version");
        const existing = await db.profiles.get(newId);
        if (existing) throw new StorageError("conflict", `Rubric ${newId} already exists`);
        const now = Date.now();
        const newRecord: RubricRecord = {
          id: newId,
          revision: 0,
          latestVersion: 1,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };
        const newRubric: EvaluationRubric = {
          ...sourceRubric,
          id: newId,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await db.profiles.put({
          id: newId,
          record: newRecord,
          revision: newRecord.revision,
          latestVersion: newRecord.latestVersion,
          updatedAt: newRecord.updatedAt,
          archivedAt: newRecord.archivedAt,
        });
        await db.profileVersions.put({
          id: newId,
          version: 1,
          profile: newRubric,
          updatedAt: newRubric.updatedAt,
        });
      });
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  // --- Deprecated legacy Profile adapter surface -----------------------------
  // Forward to the canonical Rubric methods. Remove once all consumers migrate.

  /** @deprecated Use `listRubrics`. */
  async function listProfiles(includeArchived = false): Promise<ProfileRecord[]> {
    return listRubrics(includeArchived);
  }
  /** @deprecated Use `getRubricRecord`. */
  async function getProfileRecord(id: string): Promise<ProfileRecord | null> {
    return getRubricRecord(id);
  }
  /** @deprecated Use `getRubricVersion`. */
  async function getProfile(id: string, version: number): Promise<EvaluationProfile | null> {
    return getRubricVersion(id, version);
  }
  /** @deprecated Use `createRubric`. */
  async function createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void> {
    return createRubric(record, profile);
  }
  /** @deprecated Use `appendRubricVersion`. */
  async function appendProfileVersion(
    record: ProfileRecord,
    profile: EvaluationProfile,
    expectedRevision: number,
  ): Promise<number> {
    return appendRubricVersion(record, profile, expectedRevision);
  }
  /** @deprecated Use `archiveRubric` / `restoreRubric`. */
  async function setProfileArchived(
    id: string,
    archived: boolean,
    expectedRevision: number,
  ): Promise<number> {
    return archived ? archiveRubric(id, expectedRevision) : restoreRubric(id, expectedRevision);
  }

  async function createExperiment(experiment: ExperimentRecord): Promise<void> {
    if (!isExperimentRecord(experiment)) throw new StorageError("validation", "Invalid experiment");
    db.assertWritable();
    try {
      await db.transaction("rw", db.experiments, async () => {
        const existing = await db.experiments.get(experiment.id);
        if (existing)
          throw new StorageError("conflict", `Experiment ${experiment.id} already exists`);
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
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existing.revision}`,
          );
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

  async function importSuitePackage(
    imported: ImportedSuitePackage,
  ): Promise<SuitePackageImportResult> {
    return persistSuitePackage(db, imported);
  }

  return {
    listSuites,
    getSuite,
    saveSuite,
    archiveSuite,
    listRubrics,
    getRubricRecord,
    getRubricVersion,
    createRubric,
    appendRubricVersion,
    archiveRubric,
    restoreRubric,
    duplicateRubric,
    // Deprecated legacy Profile adapter surface.
    listProfiles,
    getProfileRecord,
    getProfile,
    createProfile,
    appendProfileVersion,
    setProfileArchived,
    createExperiment,
    updateExperiment,
    getExperiment,
    listExperiments,
    beginExperimentTask,
    commitExperimentTaskTerminal,
    importSuitePackage,
  };
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private suites = new Map<string, EvaluationSuite>();
  private rubricRecords = new Map<string, RubricRecord>();
  private rubricVersions = new Map<string, Map<number, EvaluationRubric>>();
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
    if (existing && existing.revision !== expectedRevision)
      throw new StorageError("conflict", "Stale revision");
    const newRevision = expectedRevision + 1;
    this.suites.set(suite.id, { ...suite, revision: newRevision });
    return newRevision;
  }
  async archiveSuite(id: string): Promise<void> {
    const s = this.suites.get(id);
    if (!s) throw new StorageError("conflict", `Suite ${id} not found`);
    this.suites.set(id, { ...s, archivedAt: Date.now(), revision: s.revision + 1 });
  }

  // --- Canonical Rubric repository API ---------------------------------------

  async listRubrics(includeArchived = false): Promise<RubricRecord[]> {
    return [...this.rubricRecords.values()]
      .filter((r) => includeArchived || !r.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getRubricRecord(id: string): Promise<RubricRecord | null> {
    return this.rubricRecords.get(id) ?? null;
  }
  async getRubricVersion(id: string, version: number): Promise<EvaluationRubric | null> {
    return this.rubricVersions.get(id)?.get(version) ?? null;
  }
  async createRubric(record: RubricRecord, rubric: EvaluationRubric): Promise<void> {
    // Same contract as the Dexie store (validation + id/version checks).
    if (!isRubricRecord(record)) throw new StorageError("validation", "Invalid rubric record");
    if (!isEvaluationRubric(rubric)) throw new StorageError("validation", "Invalid rubric");
    if (record.id !== rubric.id) throw new StorageError("validation", "Record/rubric ID mismatch");
    if (rubric.version !== 1) throw new StorageError("validation", "First version must be 1");
    if (this.rubricRecords.has(record.id)) throw new StorageError("conflict", "Rubric exists");
    this.rubricRecords.set(record.id, record);
    const versions = new Map<number, EvaluationRubric>();
    versions.set(rubric.version, rubric);
    this.rubricVersions.set(record.id, versions);
  }
  async appendRubricVersion(
    record: RubricRecord,
    rubric: EvaluationRubric,
    expectedRevision: number,
  ): Promise<number> {
    if (!isRubricRecord(record)) throw new StorageError("validation", "Invalid rubric record");
    if (!isEvaluationRubric(rubric)) throw new StorageError("validation", "Invalid rubric");
    if (record.id !== rubric.id) throw new StorageError("validation", "Record/rubric ID mismatch");
    const existing = this.rubricRecords.get(record.id);
    if (!existing) throw new StorageError("conflict", "Rubric not found");
    if (existing.revision !== expectedRevision)
      throw new StorageError("conflict", "Stale revision");
    const newVersion = existing.latestVersion + 1;
    const newRevision = expectedRevision + 1;
    this.rubricRecords.set(record.id, {
      ...record,
      revision: newRevision,
      latestVersion: newVersion,
      updatedAt: Date.now(),
    });
    this.rubricVersions.get(record.id)?.set(newVersion, { ...rubric, version: newVersion });
    return newRevision;
  }
  async archiveRubric(id: string, expectedRevision: number): Promise<number> {
    const existing = this.rubricRecords.get(id);
    if (!existing) throw new StorageError("conflict", "Rubric not found");
    if (existing.revision !== expectedRevision)
      throw new StorageError("conflict", "Stale revision");
    const newRevision = expectedRevision + 1;
    this.rubricRecords.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return newRevision;
  }
  async restoreRubric(id: string, expectedRevision: number): Promise<number> {
    const existing = this.rubricRecords.get(id);
    if (!existing) throw new StorageError("conflict", "Rubric not found");
    if (existing.revision !== expectedRevision)
      throw new StorageError("conflict", "Stale revision");
    const newRevision = expectedRevision + 1;
    this.rubricRecords.set(id, {
      ...existing,
      revision: newRevision,
      archivedAt: null,
      updatedAt: Date.now(),
    });
    return newRevision;
  }
  async duplicateRubric(sourceId: string, newId: string): Promise<void> {
    const sourceRecord = this.rubricRecords.get(sourceId);
    if (!sourceRecord) throw new StorageError("conflict", `Rubric ${sourceId} not found`);
    const sourceVersion = this.rubricVersions.get(sourceId)?.get(sourceRecord.latestVersion);
    if (!sourceVersion) throw new StorageError("validation", "Missing rubric version");
    if (this.rubricRecords.has(newId))
      throw new StorageError("conflict", `Rubric ${newId} already exists`);
    const now = Date.now();
    const newRecord: RubricRecord = {
      id: newId,
      revision: 0,
      latestVersion: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    const newRubric: EvaluationRubric = {
      ...sourceVersion,
      id: newId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rubricRecords.set(newId, newRecord);
    this.rubricVersions.set(newId, new Map([[1, newRubric]]));
  }

  // --- Deprecated legacy Profile adapter surface -----------------------------
  // Forward to the canonical Rubric methods. Remove once all consumers migrate.

  /** @deprecated Use `listRubrics`. */
  async listProfiles(includeArchived = false): Promise<ProfileRecord[]> {
    return this.listRubrics(includeArchived);
  }
  /** @deprecated Use `getRubricRecord`. */
  async getProfileRecord(id: string): Promise<ProfileRecord | null> {
    return this.getRubricRecord(id);
  }
  /** @deprecated Use `getRubricVersion`. */
  async getProfile(id: string, version: number): Promise<EvaluationProfile | null> {
    return this.getRubricVersion(id, version);
  }
  /** @deprecated Use `createRubric`. */
  async createProfile(record: ProfileRecord, profile: EvaluationProfile): Promise<void> {
    return this.createRubric(record, profile);
  }
  /** @deprecated Use `appendRubricVersion`. */
  async appendProfileVersion(
    record: ProfileRecord,
    profile: EvaluationProfile,
    expectedRevision: number,
  ): Promise<number> {
    return this.appendRubricVersion(record, profile, expectedRevision);
  }
  /** @deprecated Use `archiveRubric` / `restoreRubric`. */
  async setProfileArchived(
    id: string,
    archived: boolean,
    expectedRevision: number,
  ): Promise<number> {
    return archived
      ? this.archiveRubric(id, expectedRevision)
      : this.restoreRubric(id, expectedRevision);
  }

  async createExperiment(experiment: ExperimentRecord): Promise<void> {
    if (this.experiments.has(experiment.id))
      throw new StorageError("conflict", "Experiment exists");
    this.experiments.set(experiment.id, experiment);
  }
  async updateExperiment(experiment: ExperimentRecord, expectedRevision: number): Promise<number> {
    const existing = this.experiments.get(experiment.id);
    if (!existing) throw new StorageError("conflict", "Experiment not found");
    if (existing.revision !== expectedRevision)
      throw new StorageError("conflict", "Stale revision");
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
  async beginExperimentTask(
    input: BeginExperimentTaskInput,
  ): Promise<{ runRevision: number; experimentRevision: number }> {
    return this.experimentUow.beginTask(input);
  }
  async commitExperimentTaskTerminal(
    input: CommitExperimentTaskTerminalInput,
  ): Promise<{ runRevision: number; experimentRevision: number }> {
    return this.experimentUow.commitTaskTerminal(input);
  }
  async importSuitePackage(imported: ImportedSuitePackage): Promise<SuitePackageImportResult> {
    // Same contract as the Dexie writer: never skips, conflicts are errors.
    const rubricIds: string[] = [];
    for (const { record, profile } of imported.profiles) {
      if (!isRubricRecord(record)) throw new StorageError("validation", "Invalid rubric record");
      if (!isEvaluationRubric(profile)) throw new StorageError("validation", "Invalid rubric");
      if (this.rubricRecords.has(record.id)) {
        throw new StorageError("conflict", `Rubric ${record.id} already exists`);
      }
      this.rubricRecords.set(record.id, record);
      this.rubricVersions.set(record.id, new Map([[profile.version, profile]]));
      rubricIds.push(record.id);
    }
    if (!isEvaluationSuite(imported.suite)) throw new StorageError("validation", "Invalid suite");
    if (this.suites.has(imported.suite.id)) {
      throw new StorageError("conflict", `Suite ${imported.suite.id} already exists`);
    }
    this.suites.set(imported.suite.id, imported.suite);
    return { suiteId: imported.suite.id, rubricIds };
  }
}
