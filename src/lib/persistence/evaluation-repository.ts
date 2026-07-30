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
  isEvaluationProfile,
  isEvaluationSuite,
  isProfileRecord,
  isExperimentRecord,
  type EvaluationProfile,
  type EvaluationSuite,
  type ProfileRecord,
  type ExperimentRecord,
  type ExperimentTaskState,
  type ExperimentTaskAttempt,
  type BeginExperimentTaskInput,
  type CommitExperimentTaskTerminalInput,
} from "../evaluations/evaluation-types";
import {
  isRunRecordV2,
  isFullRunSummaryV2,
  type RunRecordV2,
} from "./run-types";

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

function recomputeSelectedAttemptId(taskState: ExperimentTaskState): string | null {
  const terminal = taskState.attempts.filter(
    (a) => a.status === "completed" || a.status === "partial",
  );
  if (terminal.length === 0) return null;
  const completed = terminal.filter((a) => a.status === "completed");
  const pool = completed.length > 0 ? completed : terminal;
  return pool[pool.length - 1].id;
}

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

  async function beginExperimentTask(
    input: BeginExperimentTaskInput,
  ): Promise<{ runRevision: number; experimentRevision: number }> {
    if (!isRunRecordV2(input.run)) throw new StorageError("validation", "Invalid run record");
    if (!isFullRunSummaryV2(input.summary)) throw new StorageError("validation", "Invalid summary");
    db.assertWritable();

    let expRev = input.expectedExperimentRevision;
    try {
      await db.transaction("rw", db.experiments, db.runSummaries, db.runDetails, async () => {
        const existingRun = await db.runSummaries.get(input.run.id);
        if (existingRun) throw new StorageError("conflict", `Run ${input.run.id} already exists`);
        await db.runSummaries.put({
          kind: "full",
          summary: input.summary,
          id: input.summary.id,
          revision: input.summary.revision,
          createdAt: input.summary.createdAt,
          completedAt: input.summary.completedAt,
          status: input.summary.status,
          mode: input.summary.mode,
          sourceKind: input.summary.source.kind,
          sourceProtocolFingerprint: input.summary.source.kind === "experiment" ? input.summary.source.protocolFingerprint : null,
          sourceExperimentTaskAttemptId: input.summary.source.kind === "experiment" ? input.summary.source.experimentTaskAttemptId : null,
          modelKeys: input.summary.modelKeys,
        });
        await db.runDetails.put({
          id: input.run.id,
          record: input.run,
          revision: input.run.revision,
          createdAt: input.run.createdAt,
          status: input.run.status,
        });

        const expRow = await db.experiments.get(input.experimentId);
        if (!expRow) throw new StorageError("conflict", `Experiment ${input.experimentId} not found`);
        if (expRow.revision !== input.expectedExperimentRevision) {
          throw new StorageError("conflict", `Stale experiment revision`);
        }
        const experiment = expRow.experiment;
        if (!isExperimentRecord(experiment)) throw new StorageError("validation", "Invalid experiment data");

        const taskState = experiment.tasks.find((t) => t.taskId === input.taskId);
        if (!taskState) throw new StorageError("validation", `Task ${input.taskId} not found`);

        const existingAttempt = taskState.attempts.find((a) => a.id === input.attemptId);
        if (existingAttempt && existingAttempt.runId !== null) {
          throw new StorageError("conflict", `Attempt ${input.attemptId} already has a run`);
        }

        const newAttempt: ExperimentTaskAttempt = {
          id: input.attemptId,
          runId: input.run.id,
          trial: existingAttempt?.trial ?? taskState.attempts.length,
          status: "running",
          startedAt: Date.now(),
          finishedAt: null,
          error: null,
        };

        const updatedTaskState: ExperimentTaskState = {
          ...taskState,
          attempts: existingAttempt
            ? taskState.attempts.map((a) => (a.id === input.attemptId ? newAttempt : a))
            : [...taskState.attempts, newAttempt],
        };

        expRev = expRow.revision + 1;
        const updatedExperiment: ExperimentRecord = {
          ...experiment,
          tasks: experiment.tasks.map((t) => (t.taskId === input.taskId ? updatedTaskState : t)),
          revision: expRev,
          updatedAt: Date.now(),
        };

        await db.experiments.put({
          id: experiment.id,
          experiment: updatedExperiment,
          revision: expRev,
          suiteId: experiment.suiteId,
          suiteVersion: experiment.suiteVersion,
          protocolFingerprint: experiment.protocolFingerprint,
          createdAt: experiment.createdAt,
          status: experiment.status,
        });
      });
      return { runRevision: input.run.revision, experimentRevision: expRev };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function commitExperimentTaskTerminal(
    input: CommitExperimentTaskTerminalInput,
  ): Promise<{ runRevision: number; experimentRevision: number }> {
    if (!isRunRecordV2(input.run)) throw new StorageError("validation", "Invalid run record");
    if (!isFullRunSummaryV2(input.summary)) throw new StorageError("validation", "Invalid summary");
    db.assertWritable();

    const newRunRevision = input.expectedRunRevision + 1;
    let expRev = input.expectedExperimentRevision;

    try {
      await db.transaction("rw", db.experiments, db.runSummaries, db.runDetails, async () => {
        const existingDetail = await db.runDetails.get(input.run.id);
        if (!existingDetail) throw new StorageError("conflict", `Run ${input.run.id} not found`);
        if (existingDetail.revision !== input.expectedRunRevision) {
          throw new StorageError("conflict", `Stale run revision`);
        }
        const updatedRun: RunRecordV2 = { ...input.run, revision: newRunRevision };
        await db.runDetails.put({
          id: input.run.id,
          record: updatedRun,
          revision: newRunRevision,
          createdAt: input.run.createdAt,
          status: input.run.status,
        });
        await db.runSummaries.put({
          kind: "full",
          summary: { ...input.summary, revision: newRunRevision },
          id: input.summary.id,
          revision: newRunRevision,
          createdAt: input.summary.createdAt,
          completedAt: input.summary.completedAt,
          status: input.summary.status,
          mode: input.summary.mode,
          sourceKind: input.summary.source.kind,
          sourceProtocolFingerprint: input.summary.source.kind === "experiment" ? input.summary.source.protocolFingerprint : null,
          sourceExperimentTaskAttemptId: input.summary.source.kind === "experiment" ? input.summary.source.experimentTaskAttemptId : null,
          modelKeys: input.summary.modelKeys,
        });

        const expRow = await db.experiments.get(input.experimentId);
        if (!expRow) throw new StorageError("conflict", `Experiment ${input.experimentId} not found`);
        if (expRow.revision !== input.expectedExperimentRevision) {
          throw new StorageError("conflict", `Stale experiment revision`);
        }
        const experiment = expRow.experiment;
        if (!isExperimentRecord(experiment)) throw new StorageError("validation", "Invalid experiment data");

        const taskState = experiment.tasks.find((t) => t.taskId === input.taskId);
        if (!taskState) throw new StorageError("validation", `Task ${input.taskId} not found`);

        const attempt = taskState.attempts.find((a) => a.id === input.attemptId);
        if (!attempt) throw new StorageError("validation", `Attempt ${input.attemptId} not found`);
        if (["completed", "failed", "aborted"].includes(attempt.status)) {
          throw new StorageError("conflict", `Attempt ${input.attemptId} is already terminal`);
        }

        const finalized: ExperimentTaskAttempt = {
          ...attempt,
          status: input.run.status === "completed" ? "completed" : input.run.status === "partial" ? "partial" : input.run.status === "aborted" ? "aborted" : input.run.status === "interrupted" ? "interrupted" : "failed",
          finishedAt: Date.now(),
        };

        const updatedTaskState: ExperimentTaskState = {
          ...taskState,
          attempts: taskState.attempts.map((a) => (a.id === input.attemptId ? finalized : a)),
        };
        updatedTaskState.selectedAttemptId = recomputeSelectedAttemptId(updatedTaskState);

        expRev = expRow.revision + 1;
        const updatedExperiment: ExperimentRecord = {
          ...experiment,
          tasks: experiment.tasks.map((t) => (t.taskId === input.taskId ? updatedTaskState : t)),
          revision: expRev,
          updatedAt: Date.now(),
        };

        await db.experiments.put({
          id: experiment.id,
          experiment: updatedExperiment,
          revision: expRev,
          suiteId: experiment.suiteId,
          suiteVersion: experiment.suiteVersion,
          protocolFingerprint: experiment.protocolFingerprint,
          createdAt: experiment.createdAt,
          status: experiment.status,
        });
      });
      return { runRevision: newRunRevision, experimentRevision: expRev };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
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
  private experiments = new Map<string, ExperimentRecord>();

  async listSuites(includeArchived = false): Promise<EvaluationSuite[]> {
    return [...this.suites.values()]
      .filter((s) => includeArchived || !s.archivedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async getSuite(id: string): Promise<EvaluationSuite | null> {
    return this.suites.get(id) ?? null;
  }
  async saveSuite(suite: EvaluationSuite, expectedRevision: number): Promise<number> {
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
    if (this.profileRecords.has(record.id)) throw new StorageError("conflict", "Profile exists");
    this.profileRecords.set(record.id, record);
    const versions = new Map<number, EvaluationProfile>();
    versions.set(profile.version, profile);
    this.profileVersions.set(record.id, versions);
  }
  async appendProfileVersion(record: ProfileRecord, profile: EvaluationProfile, expectedRevision: number): Promise<number> {
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
    const experiment = this.experiments.get(input.experimentId);
    if (!experiment) throw new StorageError("conflict", "Experiment not found");
    if (experiment.revision !== input.expectedExperimentRevision) throw new StorageError("conflict", "Stale revision");
    const taskState = experiment.tasks.find((t) => t.taskId === input.taskId);
    if (!taskState) throw new StorageError("validation", "Task not found");
    const existing = taskState.attempts.find((a) => a.id === input.attemptId);
    if (existing && existing.runId !== null) throw new StorageError("conflict", "Attempt already has a run");
    const newAttempt: ExperimentTaskAttempt = {
      id: input.attemptId, runId: input.run.id, trial: existing?.trial ?? taskState.attempts.length,
      status: "running", startedAt: Date.now(), finishedAt: null, error: null,
    };
    const updatedTaskState: ExperimentTaskState = {
      ...taskState,
      attempts: existing ? taskState.attempts.map((a) => (a.id === input.attemptId ? newAttempt : a)) : [...taskState.attempts, newAttempt],
    };
    const newRevision = input.expectedExperimentRevision + 1;
    this.experiments.set(input.experimentId, {
      ...experiment,
      tasks: experiment.tasks.map((t) => (t.taskId === input.taskId ? updatedTaskState : t)),
      revision: newRevision, updatedAt: Date.now(),
    });
    return { runRevision: input.run.revision, experimentRevision: newRevision };
  }
  async commitExperimentTaskTerminal(input: CommitExperimentTaskTerminalInput): Promise<{ runRevision: number; experimentRevision: number }> {
    const experiment = this.experiments.get(input.experimentId);
    if (!experiment) throw new StorageError("conflict", "Experiment not found");
    if (experiment.revision !== input.expectedExperimentRevision) throw new StorageError("conflict", "Stale revision");
    const taskState = experiment.tasks.find((t) => t.taskId === input.taskId);
    if (!taskState) throw new StorageError("validation", "Task not found");
    const attempt = taskState.attempts.find((a) => a.id === input.attemptId);
    if (!attempt) throw new StorageError("validation", "Attempt not found");
    if (["completed", "failed", "aborted"].includes(attempt.status)) throw new StorageError("conflict", "Attempt already terminal");
    const finalized: ExperimentTaskAttempt = {
      ...attempt,
      status: input.run.status === "completed" ? "completed" : input.run.status === "partial" ? "partial" : input.run.status === "aborted" ? "aborted" : "failed",
      finishedAt: Date.now(),
    };
    const updatedTaskState: ExperimentTaskState = {
      ...taskState,
      attempts: taskState.attempts.map((a) => (a.id === input.attemptId ? finalized : a)),
    };
    updatedTaskState.selectedAttemptId = recomputeSelectedAttemptId(updatedTaskState);
    const newExpRev = input.expectedExperimentRevision + 1;
    this.experiments.set(input.experimentId, {
      ...experiment,
      tasks: experiment.tasks.map((t) => (t.taskId === input.taskId ? updatedTaskState : t)),
      revision: newExpRev, updatedAt: Date.now(),
    });
    return { runRevision: input.expectedRunRevision + 1, experimentRevision: newExpRev };
  }
}
