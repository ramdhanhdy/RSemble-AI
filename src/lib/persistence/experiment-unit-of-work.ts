// =============================================================================
// RSemble AI — Experiment unit of work (spec §5.6, §11.3)
//
// Fence-verified, idempotent, atomic experiment task lifecycle writes:
//
//  - beginTask atomically creates the run (detail + summary) and links one
//    immutable experiment task attempt before any fanout;
//  - commitTaskTerminal atomically finalizes the run and the same attempt,
//    recomputing selectedAttemptId under the documented selector;
//  - when a fence is supplied, the current unexpired lease must carry exactly
//    that { ownerId, fence } — verified inside the same transaction as the
//    write, so a superseded tab can never commit;
//  - repeating either operation with identical IDs and payload is a no-op that
//    returns the current revisions; conflicting reuse of an attempt ID or run
//    ID is rejected;
//  - a failure anywhere in the unit rolls back every write in the unit.
//
// The core logic runs against an ExperimentTxStore so the Dexie-backed app
// path and the in-memory test path share one implementation. The evaluation
// repository delegates its begin/commit operations here.
// =============================================================================

import type { RSembleEvaluationDB } from "./database";
import { StorageError } from "./database";
import { LEASE_KEY, type LeaseInfo } from "../execution-lease";
import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import { mapRunStatusToAttemptStatus, selectAttemptId } from "../evaluations/experiment-engine";
import {
  isExperimentRecord,
  type BeginExperimentTaskInput,
  type CommitExperimentTaskTerminalInput,
  type ExperimentRecord,
  type ExperimentTaskAttempt,
  type ExperimentTaskState,
} from "../evaluations/evaluation-types";
import {
  isFullRunSummaryV2,
  isRunRecordV2,
  type FullRunSummaryV2,
  type RunRecordV2,
  type RunSummary,
} from "./run-types";

// --- Transaction facade ---------------------------------------------------------

export interface ExperimentTx {
  getExperiment(id: string): Promise<ExperimentRecord | null>;
  putExperiment(record: ExperimentRecord): Promise<void>;
  getRunDetail(id: string): Promise<RunRecordV2 | null>;
  putRunDetail(record: RunRecordV2): Promise<void>;
  putRunSummary(summary: FullRunSummaryV2): Promise<void>;
  getLease(): Promise<LeaseInfo | null>;
}

export interface ExperimentTxStore {
  /** Runs fn atomically: any throw rolls back every write made inside fn. */
  runInTransaction<T>(fn: (tx: ExperimentTx) => Promise<T>): Promise<T>;
}

// --- Unit-of-work interface ------------------------------------------------------

export interface UnitOfWorkDeps {
  now?: () => number;
}

export interface ExperimentUnitOfWork {
  beginTask(
    input: BeginExperimentTaskInput,
  ): Promise<{ runRevision: number; experimentRevision: number }>;
  commitTaskTerminal(
    input: CommitExperimentTaskTerminalInput,
  ): Promise<{ runRevision: number; experimentRevision: number }>;
}

// --- Shared helpers -----------------------------------------------------------------

/** Top-level revision stripped for idempotent payload comparison. */
function stripRevision<T extends { revision: number }>(value: T): Omit<T, "revision"> {
  const { revision: _revision, ...rest } = value;
  return rest;
}

function samePayload<T extends { revision: number }>(a: T, b: T): boolean {
  return canonicalJsonString(stripRevision(a)) === canonicalJsonString(stripRevision(b));
}

async function verifyFence(
  tx: ExperimentTx,
  fence: { ownerId: string; fence: number },
  now: number,
): Promise<void> {
  const lease = await tx.getLease();
  if (!lease) {
    throw new StorageError("conflict", "Execution lease not held");
  }
  if (lease.ownerId !== fence.ownerId || lease.fence !== fence.fence) {
    throw new StorageError(
      "conflict",
      "Execution fence mismatch: another execution owner has taken over",
    );
  }
  if (lease.expiresAt <= now) {
    throw new StorageError("conflict", "Execution lease expired");
  }
}

function findTask(experiment: ExperimentRecord, taskId: string): ExperimentTaskState {
  const task = experiment.tasks.find((t) => t.taskId === taskId);
  if (!task) throw new StorageError("validation", `Task ${taskId} not found`);
  return task;
}

// --- Core operations ------------------------------------------------------------------

export async function beginExperimentTaskCore(
  tx: ExperimentTx,
  input: BeginExperimentTaskInput,
  deps: Required<UnitOfWorkDeps>,
): Promise<{ runRevision: number; experimentRevision: number }> {
  if (!isRunRecordV2(input.run)) throw new StorageError("validation", "Invalid run record");
  if (!isFullRunSummaryV2(input.summary)) throw new StorageError("validation", "Invalid summary");
  if (input.fence) await verifyFence(tx, input.fence, deps.now());

  const experiment = await tx.getExperiment(input.experimentId);
  if (!experiment) throw new StorageError("conflict", `Experiment ${input.experimentId} not found`);
  if (!isExperimentRecord(experiment))
    throw new StorageError("validation", "Invalid experiment data");

  const existingRun = await tx.getRunDetail(input.run.id);
  if (existingRun) {
    // Idempotent replay: identical run payload AND the attempt is already
    // linked to this run → no-op returning current revisions (spec §11.3).
    if (samePayload(existingRun, input.run)) {
      const task = experiment.tasks.find((t) => t.taskId === input.taskId);
      const attempt = task?.attempts.find((a) => a.id === input.attemptId);
      if (task && attempt && attempt.runId === input.run.id && attempt.status === "running") {
        return { runRevision: existingRun.revision, experimentRevision: experiment.revision };
      }
      throw new StorageError(
        "conflict",
        `Run ${input.run.id} already exists but attempt ${input.attemptId} is not linked to it`,
      );
    }
    throw new StorageError("conflict", `Run ${input.run.id} already exists with different content`);
  }

  if (experiment.revision !== input.expectedExperimentRevision) {
    throw new StorageError(
      "conflict",
      `Stale revision: expected ${input.expectedExperimentRevision}, got ${experiment.revision}`,
    );
  }

  const task = findTask(experiment, input.taskId);
  const existingAttempt = task.attempts.find((a) => a.id === input.attemptId);
  if (existingAttempt && existingAttempt.runId !== null) {
    throw new StorageError("conflict", `Attempt ${input.attemptId} already has a run`);
  }

  const now = deps.now();
  const newAttempt: ExperimentTaskAttempt = {
    id: input.attemptId,
    runId: input.run.id,
    trial: existingAttempt?.trial ?? task.attempts.length,
    status: "running",
    startedAt: now,
    finishedAt: null,
    error: null,
  };
  const updatedTask: ExperimentTaskState = {
    ...task,
    attempts: existingAttempt
      ? task.attempts.map((a) => (a.id === input.attemptId ? newAttempt : a))
      : [...task.attempts, newAttempt],
  };
  const newRevision = experiment.revision + 1;
  const updatedExperiment: ExperimentRecord = {
    ...experiment,
    tasks: experiment.tasks.map((t) => (t.taskId === input.taskId ? updatedTask : t)),
    revision: newRevision,
    updatedAt: now,
  };

  // Write order matters: the run records land first, then the experiment.
  await tx.putRunDetail(input.run);
  await tx.putRunSummary(input.summary);
  await tx.putExperiment(updatedExperiment);
  return { runRevision: input.run.revision, experimentRevision: newRevision };
}

const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "partial",
  "failed",
  "aborted",
  "interrupted",
]);

export async function commitExperimentTaskTerminalCore(
  tx: ExperimentTx,
  input: CommitExperimentTaskTerminalInput,
  deps: Required<UnitOfWorkDeps>,
): Promise<{ runRevision: number; experimentRevision: number }> {
  if (!isRunRecordV2(input.run)) throw new StorageError("validation", "Invalid run record");
  if (!isFullRunSummaryV2(input.summary)) throw new StorageError("validation", "Invalid summary");
  if (input.fence) await verifyFence(tx, input.fence, deps.now());

  const experiment = await tx.getExperiment(input.experimentId);
  if (!experiment) throw new StorageError("conflict", `Experiment ${input.experimentId} not found`);
  if (!isExperimentRecord(experiment))
    throw new StorageError("validation", "Invalid experiment data");

  const task = findTask(experiment, input.taskId);
  const attempt = task.attempts.find((a) => a.id === input.attemptId);
  if (!attempt) throw new StorageError("validation", `Attempt ${input.attemptId} not found`);

  const existingRun = await tx.getRunDetail(input.run.id);
  if (!existingRun) throw new StorageError("conflict", `Run ${input.run.id} not found`);

  if (TERMINAL_ATTEMPT_STATUSES.has(attempt.status)) {
    // Idempotent replay: the attempt is terminal with the same outcome, the
    // same run link, and the same stored run payload → no-op (spec §11.3).
    const sameOutcome = attempt.status === mapRunStatusToAttemptStatus(input.run.status);
    if (attempt.runId === input.run.id && sameOutcome && samePayload(existingRun, input.run)) {
      return { runRevision: existingRun.revision, experimentRevision: experiment.revision };
    }
    throw new StorageError(
      "conflict",
      `Attempt ${input.attemptId} is already terminal with a different outcome`,
    );
  }

  if (existingRun.revision !== input.expectedRunRevision) {
    throw new StorageError(
      "conflict",
      `Stale revision: expected ${input.expectedRunRevision}, got ${existingRun.revision}`,
    );
  }
  if (experiment.revision !== input.expectedExperimentRevision) {
    throw new StorageError(
      "conflict",
      `Stale revision: expected ${input.expectedExperimentRevision}, got ${experiment.revision}`,
    );
  }

  const now = deps.now();
  const newRunRevision = input.expectedRunRevision + 1;
  const updatedRun: RunRecordV2 = { ...input.run, revision: newRunRevision };
  const updatedSummary: FullRunSummaryV2 = { ...input.summary, revision: newRunRevision };

  const finalized: ExperimentTaskAttempt = {
    ...attempt,
    status: mapRunStatusToAttemptStatus(input.run.status),
    finishedAt: now,
    error: null,
    ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
    ...(input.repair !== undefined ? { repair: input.repair } : {}),
  };
  const updatedTask: ExperimentTaskState = {
    ...task,
    attempts: task.attempts.map((a) => (a.id === input.attemptId ? finalized : a)),
  };
  updatedTask.selectedAttemptId = selectAttemptId(updatedTask);

  const newExperimentRevision = experiment.revision + 1;
  const updatedExperiment: ExperimentRecord = {
    ...experiment,
    tasks: experiment.tasks.map((t) => (t.taskId === input.taskId ? updatedTask : t)),
    revision: newExperimentRevision,
    updatedAt: now,
  };

  await tx.putRunDetail(updatedRun);
  await tx.putRunSummary(updatedSummary);
  await tx.putExperiment(updatedExperiment);
  return { runRevision: newRunRevision, experimentRevision: newExperimentRevision };
}

// --- Factory over any store -------------------------------------------------------------

export function createExperimentUnitOfWork(
  store: ExperimentTxStore,
  deps: UnitOfWorkDeps = {},
): ExperimentUnitOfWork {
  const resolved: Required<UnitOfWorkDeps> = { now: deps.now ?? (() => Date.now()) };
  return {
    beginTask: (input) =>
      store.runInTransaction((tx) => beginExperimentTaskCore(tx, input, resolved)),
    commitTaskTerminal: (input) =>
      store.runInTransaction((tx) => commitExperimentTaskTerminalCore(tx, input, resolved)),
  };
}

// =============================================================================
// Dexie-backed store
// =============================================================================

export class DexieExperimentStore implements ExperimentTxStore {
  constructor(private readonly db: RSembleEvaluationDB) {}

  runInTransaction<T>(fn: (tx: ExperimentTx) => Promise<T>): Promise<T> {
    this.db.assertWritable();
    const db = this.db;
    return db.transaction(
      "rw",
      [db.experiments, db.runSummaries, db.runDetails, db.storageMeta],
      async () => {
        const tx: ExperimentTx = {
          async getExperiment(id) {
            const row = await db.experiments.get(id);
            return row ? (row.experiment as ExperimentRecord) : null;
          },
          async putExperiment(record) {
            await db.experiments.put({
              id: record.id,
              experiment: record,
              revision: record.revision,
              suiteId: record.suiteId,
              suiteVersion: record.suiteVersion,
              protocolFingerprint: record.protocolFingerprint,
              createdAt: record.createdAt,
              status: record.status,
            });
          },
          async getRunDetail(id) {
            const row = await db.runDetails.get(id);
            return row ? (row.record as RunRecordV2) : null;
          },
          async putRunDetail(record) {
            await db.runDetails.put({
              id: record.id,
              record,
              revision: record.revision,
              createdAt: record.createdAt,
              status: record.status,
            });
          },
          async putRunSummary(summary) {
            await db.runSummaries.put({
              kind: "full",
              summary,
              id: summary.id,
              revision: summary.revision,
              createdAt: summary.createdAt,
              completedAt: summary.completedAt,
              status: summary.status,
              mode: summary.mode,
              sourceKind: summary.source.kind,
              sourceProtocolFingerprint:
                summary.source.kind === "experiment" ? summary.source.protocolFingerprint : null,
              sourceExperimentTaskAttemptId:
                summary.source.kind === "experiment"
                  ? summary.source.experimentTaskAttemptId
                  : null,
              modelKeys: summary.modelKeys,
            });
          },
          async getLease() {
            const row = await db.storageMeta.get(LEASE_KEY);
            return row ? (row.value as LeaseInfo) : null;
          },
        };
        return fn(tx);
      },
    );
  }
}

// =============================================================================
// In-memory store (tests + rollback semantics)
// =============================================================================

export class InMemoryExperimentStore implements ExperimentTxStore {
  readonly experiments: Map<string, ExperimentRecord>;
  readonly runDetails: Map<string, RunRecordV2>;
  /** Summaries share the run repository's union type so a test harness can
   *  back both stores with one map (the production path shares one Dexie DB). */
  readonly runSummaries: Map<string, RunSummary>;
  /** Shared lease store — when provided, `getLease` reads from the same store
   *  as `InMemoryExecutionLease`, mirroring the Dexie path's shared
   *  `storageMeta` table. Falls back to the local `lease` property. */
  private readonly leaseStore: { lease: LeaseInfo | null; fence: number } | null;
  lease: LeaseInfo | null = null;

  /** Failure injection: the (failAfterWrites + 1)-th write in the next
   *  transaction throws. null disables injection. */
  failAfterWrites: number | null = null;

  constructor(shared?: {
    experiments?: Map<string, ExperimentRecord>;
    runDetails?: Map<string, RunRecordV2>;
    runSummaries?: Map<string, RunSummary>;
    leaseStore?: { lease: LeaseInfo | null; fence: number };
  }) {
    this.experiments = shared?.experiments ?? new Map<string, ExperimentRecord>();
    this.runDetails = shared?.runDetails ?? new Map<string, RunRecordV2>();
    this.runSummaries = shared?.runSummaries ?? new Map<string, RunSummary>();
    this.leaseStore = shared?.leaseStore ?? null;
  }

  async runInTransaction<T>(fn: (tx: ExperimentTx) => Promise<T>): Promise<T> {
    // Snapshot for rollback. Stored values are treated as immutable — every
    // put replaces an entry wholesale — so shallow map snapshots restore
    // pre-transaction state exactly.
    const expSnapshot = new Map(this.experiments);
    const detailSnapshot = new Map(this.runDetails);
    const summarySnapshot = new Map(this.runSummaries);

    let writes = 0;
    const countWrite = () => {
      if (this.failAfterWrites !== null && writes >= this.failAfterWrites) {
        throw new StorageError("unavailable", "Injected storage failure");
      }
      writes += 1;
    };

    const tx: ExperimentTx = {
      getExperiment: async (id) => this.experiments.get(id) ?? null,
      putExperiment: async (record) => {
        countWrite();
        this.experiments.set(record.id, record);
      },
      getRunDetail: async (id) => this.runDetails.get(id) ?? null,
      putRunDetail: async (record) => {
        countWrite();
        this.runDetails.set(record.id, record);
      },
      putRunSummary: async (summary) => {
        countWrite();
        this.runSummaries.set(summary.id, summary);
      },
      getLease: async () => this.leaseStore?.lease ?? this.lease,
    };

    try {
      return await fn(tx);
    } catch (err) {
      // Roll back every write in the unit.
      this.experiments.clear();
      for (const [k, v] of expSnapshot) this.experiments.set(k, v);
      this.runDetails.clear();
      for (const [k, v] of detailSnapshot) this.runDetails.set(k, v);
      this.runSummaries.clear();
      for (const [k, v] of summarySnapshot) this.runSummaries.set(k, v);
      throw err;
    }
  }
}
