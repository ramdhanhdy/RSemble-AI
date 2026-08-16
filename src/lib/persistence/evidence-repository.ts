// =============================================================================
// RSemble AI — Evidence repository (Dexie-backed + in-memory parity)
//
// Implements the EvidenceRepository over the schema v8 evidence stores
// (spec §10):
//
//  - modelConfigurations: canonical configuration snapshots with identity
//    collision abort and observed-window extension;
//  - observations: idempotent insertion under the six-part observation source
//    key (spec §5); a duplicate key with non-identical canonical content is a
//    corruption error, never last-write-wins;
//  - evidenceDecisions: eligibility decisions keyed by
//    [observationId+ruleVersion]; rule revisions append without ever changing
//    observation counts; the active decision is the highest rule version;
//  - evidenceIndexJobs: per-source indexing markers with compare-and-swap
//    source-revision behavior — complete markers never regress at a fixed
//    revision, revision bumps re-trigger indexing, and error rows stay
//    retryable.
//
// Every write validates its payload first: prohibited keys, secret-shaped
// values, raw candidate output, and full judge rationale are rejected before
// anything is stored (spec §13). No repository method accepts raw candidate
// output as an Observation payload — observations are validated references
// resolved from existing repositories.
//
// Storage failures are classified via the shared StorageError machinery.
// =============================================================================

import {
  type RSembleEvaluationDB,
  type EvidenceIndexJobStatus,
  type EvidenceIndexJobRow,
  type VerifierOutcomeRow,
  StorageError,
  classifyStorageError,
} from "./database";
import {
  canonicalObservationJson,
  collectProhibitedFieldPaths,
  isEligibilityDecision,
  isExecutedVerifierOutcome,
  isModelConfigurationSnapshot,
  observationSourceKey,
  validateObservation,
} from "../evidence/evidence-validation";
import { configurationsCollide, extendConfigurationWindow } from "../evidence/model-configuration";
import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import type {
  EligibilityDecision,
  ExecutedVerifierOutcome,
  ModelConfigurationSnapshot,
  Observation,
  ObservationSourceKind,
} from "../evidence/evidence-types";

// --- Domain types --------------------------------------------------------------

/** Safe, sanitized per-source derivation summary (no raw content, spec §13). */
export interface EvidenceIndexJobSummary {
  observationCount: number;
  gapCount: number;
  limitationCount: number;
  integrityIssues: string[];
}

/** Per-source evidence indexing marker (spec §10, §11.3). */
export interface EvidenceIndexJob {
  sourceResultId: string;
  sourceKind: ObservationSourceKind;
  status: EvidenceIndexJobStatus;
  ruleVersion: number;
  sourceRevision: number;
  updatedAt: number;
  errorKind: string | null;
  errorMessage: string | null;
  summary: EvidenceIndexJobSummary | null;
}

export type PutIndexJobResult = "created" | "updated" | "unchanged";

/**
 * Corruption error: a duplicate identity key with non-identical canonical
 * content. Aborts before any write — never last-write-wins (spec §5).
 */
export class EvidenceCorruptionError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super("conflict", message, cause);
    this.name = "EvidenceCorruptionError";
  }
}

export interface EvidenceListQuery {
  sourceKind?: ObservationSourceKind;
  sourceResultId?: string;
  taskId?: string;
  modelConfigurationId?: string;
  limit?: number;
  offset?: number;
}

export interface EvidencePage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface ActiveDecisionsQuery {
  /** When set, only decisions for observations of this source result. */
  sourceResultId?: string;
}

// --- Repository interface ------------------------------------------------------

export interface EvidenceRepository {
  // --- Model configurations ----------------------------------------------------
  /** Idempotent insert: same identity extends the observed window; a
   *  non-identical collision aborts. */
  putModelConfiguration(
    snapshot: ModelConfigurationSnapshot,
  ): Promise<"created" | "extended" | "unchanged">;
  getModelConfiguration(id: string): Promise<ModelConfigurationSnapshot | null>;
  listModelConfigurations(): Promise<ModelConfigurationSnapshot[]>;

  // --- Observations ------------------------------------------------------------
  /** Idempotent insert under the six-part source key. A duplicate key with
   *  non-identical canonical content is a corruption error. */
  putObservation(observation: Observation): Promise<"created" | "existing">;
  getObservation(id: string): Promise<Observation | null>;
  findObservationBySourceKey(sourceKey: string): Promise<Observation | null>;
  listObservationsBySource(
    sourceKind: ObservationSourceKind,
    sourceResultId: string,
  ): Promise<Observation[]>;
  listObservationsByTask(taskId: string): Promise<Observation[]>;
  listObservationsByModelConfiguration(modelConfigurationId: string): Promise<Observation[]>;
  listObservations(query?: EvidenceListQuery): Promise<EvidencePage<Observation>>;
  countObservations(): Promise<number>;

  // --- Eligibility decisions ---------------------------------------------------
  /** Append a decision revision. Identical re-puts are no-ops; conflicting
   *  content at one [observationId+ruleVersion] is corruption. */
  putDecision(decision: EligibilityDecision): Promise<void>;
  getDecision(observationId: string, ruleVersion: number): Promise<EligibilityDecision | null>;
  listDecisionRevisions(observationId: string): Promise<EligibilityDecision[]>;
  /** The active decision: highest rule version for the observation. */
  getActiveDecision(observationId: string): Promise<EligibilityDecision | null>;
  listActiveDecisions(query?: ActiveDecisionsQuery): Promise<EligibilityDecision[]>;

  // --- Evidence index jobs -----------------------------------------------------
  /** CAS semantics on sourceRevision (see applyJobCas). */
  putIndexJob(job: EvidenceIndexJob): Promise<PutIndexJobResult>;
  getIndexJob(sourceResultId: string): Promise<EvidenceIndexJob | null>;
  listIndexJobs(filter?: {
    status?: EvidenceIndexJobStatus;
    sourceKind?: ObservationSourceKind;
  }): Promise<EvidenceIndexJob[]>;
  /**
   * Deterministic stale-running recovery: re-queues jobs stranded in
   * "running" whose marker is at or past the stale boundary
   * (updatedAt + staleTimeoutMs <= now). Runs inside one storage transaction
   * so concurrent recoveries serialize and each stranded job is recovered
   * exactly once per occurrence; fresh markers (active owners) are never
   * stolen. Returns recovered sourceResultIds in deterministic order.
   */
  recoverStaleIndexJobs(opts: {
    staleTimeoutMs: number;
    now: number;
  }): Promise<string[]>;
  // --- Executed verifier outcomes ----------------------------------------------
  /** Persist one executed verifier outcome, idempotent under the composite
   *  [runId+taskId+modelKey+executedAt] id. A non-identical outcome at the
   *  same id is corruption, never last-write-wins. */
  putVerifierOutcome(outcome: ExecutedVerifierOutcome): Promise<"created" | "existing">;
  /** List persisted outcomes, optionally scoped by task, model, and exact
   *  lineage run ids. Deterministic order: executedAt, runId, taskId, modelKey. */
  listVerifierOutcomes(query?: {
    taskId?: string;
    modelKey?: string;
    runIds?: string[];
  }): Promise<ExecutedVerifierOutcome[]>;
}

// --- Row codecs ------------------------------------------------------------------

function toJobRow(job: EvidenceIndexJob): EvidenceIndexJobRow {
  return { ...job, summary: job.summary };
}

function fromJobRow(row: EvidenceIndexJobRow): EvidenceIndexJob {
  return {
    sourceResultId: row.sourceResultId,
    sourceKind: row.sourceKind,
    status: row.status,
    ruleVersion: row.ruleVersion,
    sourceRevision: row.sourceRevision,
    updatedAt: row.updatedAt,
    errorKind: row.errorKind,
    errorMessage: row.errorMessage,
    summary: row.summary as EvidenceIndexJobSummary | null,
  };
}

/** Composite, deterministic row id: identical outcomes re-put to the same id
 *  (idempotent); non-identical content at one id is corruption. */
function verifierOutcomeId(outcome: ExecutedVerifierOutcome): string {
  return `${outcome.runId}::${outcome.taskId}::${outcome.modelKey}::${outcome.executedAt}`;
}

function toVerifierRow(outcome: ExecutedVerifierOutcome): VerifierOutcomeRow {
  return { id: verifierOutcomeId(outcome), ...outcome };
}

function fromVerifierRow(row: VerifierOutcomeRow): ExecutedVerifierOutcome {
  return {
    taskId: row.taskId,
    modelKey: row.modelKey,
    runId: row.runId,
    kind: row.kind,
    configurationDigest: row.configurationDigest,
    verifierRef: row.verifierRef,
    passed: row.passed,
    executedAt: row.executedAt,
  };
}

function jobEquals(a: EvidenceIndexJob, b: EvidenceIndexJob): boolean {
  return canonicalJsonString(a) === canonicalJsonString(b);
}

const JOB_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "complete", "error"]);

function validateJob(job: EvidenceIndexJob): void {
  if (typeof job !== "object" || job === null) {
    throw new StorageError("validation", "Index job is required.");
  }
  if (typeof job.sourceResultId !== "string" || job.sourceResultId.trim().length === 0) {
    throw new StorageError("validation", "sourceResultId must be a non-blank string.");
  }
  if (job.sourceKind !== "comparison" && job.sourceKind !== "evaluation") {
    throw new StorageError("validation", "sourceKind must be comparison|evaluation.");
  }
  if (!JOB_STATUSES.has(job.status)) {
    throw new StorageError("validation", `Unknown index job status ${String(job.status)}.`);
  }
  if (!Number.isInteger(job.ruleVersion) || job.ruleVersion < 1) {
    throw new StorageError("validation", "ruleVersion must be a positive integer.");
  }
  if (!Number.isInteger(job.sourceRevision) || job.sourceRevision < 0) {
    throw new StorageError("validation", "sourceRevision must be a non-negative integer.");
  }
  if (!Number.isFinite(job.updatedAt) || job.updatedAt < 0) {
    throw new StorageError("validation", "updatedAt must be a non-negative epoch ms.");
  }
  if (job.errorKind !== null && typeof job.errorKind !== "string") {
    throw new StorageError("validation", "errorKind must be a string or null.");
  }
  if (job.errorMessage !== null && typeof job.errorMessage !== "string") {
    throw new StorageError("validation", "errorMessage must be a string or null.");
  }
  const summary = job.summary as Record<string, unknown> | null;
  if (summary !== null) {
    if (typeof summary !== "object" || Array.isArray(summary)) {
      throw new StorageError("validation", "summary must be an EvidenceIndexJobSummary or null.");
    }
    for (const field of ["observationCount", "gapCount", "limitationCount"]) {
      const value = summary[field];
      if (!Number.isInteger(value) || (value as number) < 0) {
        throw new StorageError("validation", `summary.${field} must be a non-negative integer.`);
      }
    }
    if (
      !Array.isArray(summary.integrityIssues) ||
      !summary.integrityIssues.every((issue) => typeof issue === "string")
    ) {
      throw new StorageError("validation", "summary.integrityIssues must be an array of strings.");
    }
  }
  const prohibited: string[] = [];
  collectProhibitedFieldPaths(job, "", prohibited);
  if (prohibited.length > 0) {
    throw new StorageError("validation", `Index job carries prohibited content: ${prohibited[0]}`);
  }
}

/**
 * CAS rules for putIndexJob (spec §11.3):
 *  - a stale sourceRevision (below the stored marker) is rejected;
 *  - a revision bump replaces the marker and re-triggers indexing;
 *  - at the same revision, a `complete` marker never regresses (duplicate
 *    events stay no-ops) while `error`/`running` rows remain retryable.
 */
function applyJobCas(existing: EvidenceIndexJob, incoming: EvidenceIndexJob): PutIndexJobResult {
  if (incoming.sourceRevision < existing.sourceRevision) {
    throw new EvidenceCorruptionError(
      `Stale index job revision ${incoming.sourceRevision} for source ` +
        `${incoming.sourceResultId} (stored ${existing.sourceRevision}).`,
    );
  }
  if (incoming.sourceRevision > existing.sourceRevision) return "updated";
  if (jobEquals(existing, incoming)) return "unchanged";
  if (existing.status === "complete" && incoming.status !== "complete") {
    // Duplicate event at a fixed revision: the source is already indexed.
    return "unchanged";
  }
  return "updated";
}

// --- Dexie-backed implementation -------------------------------------------------

export function createEvidenceRepository(db: RSembleEvaluationDB): EvidenceRepository {
  async function putModelConfiguration(
    snapshot: ModelConfigurationSnapshot,
  ): Promise<"created" | "extended" | "unchanged"> {
    try {
      db.assertWritable();
      if (!isModelConfigurationSnapshot(snapshot)) {
        throw new StorageError("validation", "Invalid ModelConfigurationSnapshot.");
      }
      const prohibited: string[] = [];
      collectProhibitedFieldPaths(snapshot, "", prohibited);
      if (prohibited.length > 0) {
        throw new StorageError(
          "validation",
          `Invalid ModelConfigurationSnapshot: ${prohibited[0]}`,
        );
      }
      return await db.transaction("rw", db.modelConfigurations, async () => {
        const existing = await db.modelConfigurations.get(snapshot.id);
        if (!existing) {
          await db.modelConfigurations.put({
            id: snapshot.id,
            snapshot,
            providerId: snapshot.providerId,
            requestedModel: snapshot.requestedModel,
            resolvedVersion: snapshot.resolvedVersion,
            observedTo: snapshot.observedTo,
          });
          return "created";
        }
        const prev = existing.snapshot as ModelConfigurationSnapshot;
        if (configurationsCollide(prev, snapshot)) {
          throw new EvidenceCorruptionError(
            `Model configuration ${snapshot.id} already exists with non-identical ` +
              `identity content — corruption, not last-write-wins.`,
          );
        }
        if (snapshot.observedTo < prev.observedFrom) {
          throw new StorageError(
            "validation",
            `Out-of-order observation ${snapshot.observedTo} precedes the window start ` +
              `${prev.observedFrom}.`,
          );
        }
        const extended = extendConfigurationWindow(prev, snapshot.observedTo);
        if (extended.observedTo === prev.observedTo) return "unchanged";
        await db.modelConfigurations.put({
          ...existing,
          snapshot: extended,
          observedTo: extended.observedTo,
        });
        return "extended";
      });
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getModelConfiguration(id: string): Promise<ModelConfigurationSnapshot | null> {
    try {
      const row = await db.modelConfigurations.get(id);
      return (row?.snapshot as ModelConfigurationSnapshot | undefined) ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listModelConfigurations(): Promise<ModelConfigurationSnapshot[]> {
    try {
      const rows = await db.modelConfigurations.toArray();
      return rows
        .map((r) => r.snapshot as ModelConfigurationSnapshot)
        .filter((s): s is ModelConfigurationSnapshot => isModelConfigurationSnapshot(s))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function putObservation(observation: Observation): Promise<"created" | "existing"> {
    try {
      db.assertWritable();
      const validation = validateObservation(observation);
      if (!validation.ok) {
        throw new StorageError("validation", `Invalid Observation: ${validation.errors[0]}`);
      }
      const sourceKey = observationSourceKey(observation);
      return await db.transaction("rw", db.observations, async () => {
        const existing = await db.observations.where("sourceKey").equals(sourceKey).first();
        if (existing) {
          const prev = existing.observation as Observation;
          if (canonicalObservationJson(prev) === canonicalObservationJson(observation)) {
            return "existing";
          }
          throw new EvidenceCorruptionError(
            `Observation source key ${sourceKey} already exists with non-identical ` +
              `canonical content — corruption, not last-write-wins.`,
          );
        }
        await db.observations.put({
          id: observation.id,
          sourceKey,
          sourceKind: observation.sourceKind,
          sourceResultId: observation.sourceResultId,
          sourceTaskCellId: observation.sourceTaskCellId,
          taskId: observation.taskId,
          taskInstanceId: observation.taskInstanceId,
          modelConfigurationId: observation.modelConfigurationId,
          observedAt: observation.observedAt,
          observation,
        });
        return "created";
      });
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getObservation(id: string): Promise<Observation | null> {
    try {
      const row = await db.observations.get(id);
      return (row?.observation as Observation | undefined) ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function findObservationBySourceKey(sourceKey: string): Promise<Observation | null> {
    try {
      const row = await db.observations.where("sourceKey").equals(sourceKey).first();
      return (row?.observation as Observation | undefined) ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  function toObservations(rows: { observation: unknown }[]): Observation[] {
    return rows.map((r) => r.observation as Observation).filter((o) => validateObservation(o).ok);
  }

  async function listObservationsBySource(
    sourceKind: ObservationSourceKind,
    sourceResultId: string,
  ): Promise<Observation[]> {
    try {
      const rows = await db.observations.where("sourceResultId").equals(sourceResultId).toArray();
      return toObservations(rows).filter((o) => o.sourceKind === sourceKind);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listObservationsByTask(taskId: string): Promise<Observation[]> {
    try {
      const rows = await db.observations.where("taskId").equals(taskId).toArray();
      return toObservations(rows);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listObservationsByModelConfiguration(
    modelConfigurationId: string,
  ): Promise<Observation[]> {
    try {
      const rows = await db.observations
        .where("modelConfigurationId")
        .equals(modelConfigurationId)
        .toArray();
      return toObservations(rows);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listObservations(
    query: EvidenceListQuery = {},
  ): Promise<EvidencePage<Observation>> {
    try {
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      let rows = await db.observations.toArray();
      if (query.sourceKind !== undefined) {
        rows = rows.filter((r) => r.sourceKind === query.sourceKind);
      }
      if (query.sourceResultId !== undefined) {
        rows = rows.filter((r) => r.sourceResultId === query.sourceResultId);
      }
      if (query.taskId !== undefined) {
        rows = rows.filter((r) => r.taskId === query.taskId);
      }
      if (query.modelConfigurationId !== undefined) {
        rows = rows.filter((r) => r.modelConfigurationId === query.modelConfigurationId);
      }
      rows.sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id));
      const items = toObservations(rows.slice(offset, offset + limit));
      return { items, total: rows.length, offset, limit };
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function countObservations(): Promise<number> {
    try {
      return await db.observations.count();
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function putDecision(decision: EligibilityDecision): Promise<void> {
    try {
      db.assertWritable();
      if (!isEligibilityDecision(decision)) {
        throw new StorageError("validation", "Invalid EligibilityDecision.");
      }
      await db.transaction("rw", db.evidenceDecisions, async () => {
        const id = `${decision.observationId}#${decision.ruleVersion}`;
        const existing = await db.evidenceDecisions.get(id);
        if (existing) {
          if (canonicalJsonString(existing.decision) === canonicalJsonString(decision)) return;
          throw new EvidenceCorruptionError(
            `Decision ${id} already exists with different content at the same rule version.`,
          );
        }
        await db.evidenceDecisions.put({
          id,
          observationId: decision.observationId,
          ruleVersion: decision.ruleVersion,
          status: decision.status,
          evidenceClass: decision.evidenceClass,
          comparabilityCohortId: decision.comparabilityCohortId,
          decidedAt: decision.decidedAt,
          decision,
        });
      });
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getDecision(
    observationId: string,
    ruleVersion: number,
  ): Promise<EligibilityDecision | null> {
    try {
      const row = await db.evidenceDecisions.get(`${observationId}#${ruleVersion}`);
      return (row?.decision as EligibilityDecision | undefined) ?? null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listDecisionRevisions(observationId: string): Promise<EligibilityDecision[]> {
    try {
      const rows = await db.evidenceDecisions
        .where("observationId")
        .equals(observationId)
        .toArray();
      return rows
        .map((r) => r.decision as EligibilityDecision)
        .sort((a, b) => a.ruleVersion - b.ruleVersion);
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getActiveDecision(observationId: string): Promise<EligibilityDecision | null> {
    const revisions = await listDecisionRevisions(observationId);
    return revisions.length === 0 ? null : revisions[revisions.length - 1];
  }

  async function listActiveDecisions(
    query: ActiveDecisionsQuery = {},
  ): Promise<EligibilityDecision[]> {
    try {
      let rows = await db.observations.toArray();
      if (query.sourceResultId !== undefined) {
        rows = rows.filter((r) => r.sourceResultId === query.sourceResultId);
      }
      const decisions: EligibilityDecision[] = [];
      for (const row of rows) {
        const active = await getActiveDecision(row.id);
        if (active) decisions.push(active);
      }
      decisions.sort(
        (a, b) => a.observationId.localeCompare(b.observationId) || a.ruleVersion - b.ruleVersion,
      );
      return decisions;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function putIndexJob(job: EvidenceIndexJob): Promise<PutIndexJobResult> {
    try {
      db.assertWritable();
      validateJob(job);
      return await db.transaction("rw", db.evidenceIndexJobs, async () => {
        const existingRow = await db.evidenceIndexJobs.get(job.sourceResultId);
        if (!existingRow) {
          await db.evidenceIndexJobs.put(toJobRow(job));
          return "created";
        }
        const result = applyJobCas(fromJobRow(existingRow), job);
        if (result === "unchanged") return result;
        await db.evidenceIndexJobs.put(toJobRow(job));
        return result;
      });
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function getIndexJob(sourceResultId: string): Promise<EvidenceIndexJob | null> {
    try {
      const row = await db.evidenceIndexJobs.get(sourceResultId);
      return row ? fromJobRow(row) : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listIndexJobs(filter?: {
    status?: EvidenceIndexJobStatus;
    sourceKind?: ObservationSourceKind;
  }): Promise<EvidenceIndexJob[]> {
    try {
      let rows = await db.evidenceIndexJobs.toArray();
      if (filter?.status !== undefined) rows = rows.filter((r) => r.status === filter.status);
      if (filter?.sourceKind !== undefined) {
        rows = rows.filter((r) => r.sourceKind === filter.sourceKind);
      }
      return rows
        .map(fromJobRow)
        .sort(
          (a, b) => a.updatedAt - b.updatedAt || a.sourceResultId.localeCompare(b.sourceResultId),
        );
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function recoverStaleIndexJobs(opts: {
    staleTimeoutMs: number;
    now: number;
  }): Promise<string[]> {
    try {
      db.assertWritable();
      if (!Number.isFinite(opts.staleTimeoutMs) || opts.staleTimeoutMs < 0) {
        throw new StorageError("validation", "staleTimeoutMs must be a non-negative number.");
      }
      if (!Number.isFinite(opts.now)) {
        throw new StorageError("validation", "now must be a finite number.");
      }
      return await db.transaction("rw", db.evidenceIndexJobs, async () => {
        const rows = await db.evidenceIndexJobs.toArray();
        const recovered: string[] = [];
        for (const row of rows) {
          if (row.status !== "running") continue;
          if (row.updatedAt + opts.staleTimeoutMs > opts.now) continue;
          await db.evidenceIndexJobs.put({ ...row, status: "queued" });
          recovered.push(row.sourceResultId);
        }
        return recovered.sort((a, b) => a.localeCompare(b));
      });
    } catch (err) {
      throw classifyStorageError(err);
    }
  }


  async function putVerifierOutcome(
    outcome: ExecutedVerifierOutcome,
  ): Promise<"created" | "existing"> {
    try {
      db.assertWritable();
      if (!isExecutedVerifierOutcome(outcome)) {
        throw new StorageError("validation", "Invalid ExecutedVerifierOutcome.");
      }
      const prohibited: string[] = [];
      collectProhibitedFieldPaths(outcome, "", prohibited);
      if (prohibited.length > 0) {
        throw new StorageError(
          "validation",
          `Invalid ExecutedVerifierOutcome: ${prohibited[0]}`,
        );
      }
      const row = toVerifierRow(outcome);
      return await db.transaction("rw", db.verifierOutcomes, async () => {
        const existing = await db.verifierOutcomes.get(row.id);
        if (!existing) {
          await db.verifierOutcomes.put(row);
          return "created";
        }
        if (canonicalJsonString(existing) === canonicalJsonString(row)) return "existing";
        throw new EvidenceCorruptionError(
          `Executed verifier outcome ${row.id} already exists with non-identical ` +
            `content — corruption, not last-write-wins.`,
        );
      });
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function listVerifierOutcomes(
    query: { taskId?: string; modelKey?: string; runIds?: string[] } = {},
  ): Promise<ExecutedVerifierOutcome[]> {
    try {
      let rows = await db.verifierOutcomes.toArray();
      if (query.taskId !== undefined) rows = rows.filter((r) => r.taskId === query.taskId);
      if (query.modelKey !== undefined) rows = rows.filter((r) => r.modelKey === query.modelKey);
      if (query.runIds !== undefined) {
        const runIds = new Set(query.runIds);
        rows = rows.filter((r) => runIds.has(r.runId));
      }
      return rows
        .map(fromVerifierRow)
        .filter((o): o is ExecutedVerifierOutcome => isExecutedVerifierOutcome(o))
        .sort(
          (a, b) =>
            a.executedAt - b.executedAt ||
            a.runId.localeCompare(b.runId) ||
            a.taskId.localeCompare(b.taskId) ||
            a.modelKey.localeCompare(b.modelKey),
        );
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  return {
    putModelConfiguration,
    getModelConfiguration,
    listModelConfigurations,
    putObservation,
    getObservation,
    findObservationBySourceKey,
    listObservationsBySource,
    listObservationsByTask,
    listObservationsByModelConfiguration,
    listObservations,
    countObservations,
    putDecision,
    getDecision,
    listDecisionRevisions,
    getActiveDecision,
    listActiveDecisions,
    putIndexJob,
    getIndexJob,
    listIndexJobs,
    recoverStaleIndexJobs,
    putVerifierOutcome,
    listVerifierOutcomes,
  };
}

// --- In-memory parity implementation ---------------------------------------------

/**
 * In-memory parity for tests and future non-Dexie contexts. Identical
 * contract, identical corruption/conflict semantics, no storage failures.
 */
export class InMemoryEvidenceRepository implements EvidenceRepository {
  private readonly modelConfigurations = new Map<string, ModelConfigurationSnapshot>();
  private readonly observationsByKey = new Map<string, Observation>();
  private readonly observationsById = new Map<string, Observation>();
  private readonly decisions = new Map<string, EligibilityDecision>();
  private readonly jobs = new Map<string, EvidenceIndexJob>();
  private readonly verifierOutcomes = new Map<string, ExecutedVerifierOutcome>();

  async putModelConfiguration(
    snapshot: ModelConfigurationSnapshot,
  ): Promise<"created" | "extended" | "unchanged"> {
    if (!isModelConfigurationSnapshot(snapshot)) {
      throw new StorageError("validation", "Invalid ModelConfigurationSnapshot.");
    }
    const prohibited: string[] = [];
    collectProhibitedFieldPaths(snapshot, "", prohibited);
    if (prohibited.length > 0) {
      throw new StorageError("validation", `Invalid ModelConfigurationSnapshot: ${prohibited[0]}`);
    }
    const existing = this.modelConfigurations.get(snapshot.id);
    if (!existing) {
      this.modelConfigurations.set(snapshot.id, { ...snapshot });
      return "created";
    }
    if (configurationsCollide(existing, snapshot)) {
      throw new EvidenceCorruptionError(
        `Model configuration ${snapshot.id} already exists with non-identical ` +
          `identity content — corruption, not last-write-wins.`,
      );
    }
    if (snapshot.observedTo < existing.observedFrom) {
      throw new StorageError(
        "validation",
        `Out-of-order observation ${snapshot.observedTo} precedes the window start ` +
          `${existing.observedFrom}.`,
      );
    }
    const extended = extendConfigurationWindow(existing, snapshot.observedTo);
    if (extended.observedTo === existing.observedTo) return "unchanged";
    this.modelConfigurations.set(snapshot.id, extended);
    return "extended";
  }
  async getModelConfiguration(id: string): Promise<ModelConfigurationSnapshot | null> {
    const existing = this.modelConfigurations.get(id);
    return existing ? { ...existing } : null;
  }

  async listModelConfigurations(): Promise<ModelConfigurationSnapshot[]> {
    return [...this.modelConfigurations.values()]
      .map((s) => ({ ...s }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async putObservation(observation: Observation): Promise<"created" | "existing"> {
    const validation = validateObservation(observation);
    if (!validation.ok) {
      throw new StorageError("validation", `Invalid Observation: ${validation.errors[0]}`);
    }
    const sourceKey = observationSourceKey(observation);
    const existing = this.observationsByKey.get(sourceKey);
    if (existing) {
      if (canonicalObservationJson(existing) === canonicalObservationJson(observation)) {
        return "existing";
      }
      throw new EvidenceCorruptionError(
        `Observation source key ${sourceKey} already exists with non-identical ` +
          `canonical content — corruption, not last-write-wins.`,
      );
    }
    const copy = JSON.parse(JSON.stringify(observation)) as Observation;
    this.observationsByKey.set(sourceKey, copy);
    this.observationsById.set(observation.id, copy);
    return "created";
  }

  async getObservation(id: string): Promise<Observation | null> {
    const existing = this.observationsById.get(id);
    return existing ? JSON.parse(JSON.stringify(existing)) : null;
  }

  async findObservationBySourceKey(sourceKey: string): Promise<Observation | null> {
    const existing = this.observationsByKey.get(sourceKey);
    return existing ? JSON.parse(JSON.stringify(existing)) : null;
  }

  async listObservationsBySource(
    sourceKind: ObservationSourceKind,
    sourceResultId: string,
  ): Promise<Observation[]> {
    return [...this.observationsByKey.values()]
      .filter((o) => o.sourceKind === sourceKind && o.sourceResultId === sourceResultId)
      .map((o) => JSON.parse(JSON.stringify(o)));
  }

  async listObservationsByTask(taskId: string): Promise<Observation[]> {
    return [...this.observationsByKey.values()]
      .filter((o) => o.taskId === taskId)
      .map((o) => JSON.parse(JSON.stringify(o)));
  }

  async listObservationsByModelConfiguration(modelConfigurationId: string): Promise<Observation[]> {
    return [...this.observationsByKey.values()]
      .filter((o) => o.modelConfigurationId === modelConfigurationId)
      .map((o) => JSON.parse(JSON.stringify(o)));
  }

  async listObservations(query: EvidenceListQuery = {}): Promise<EvidencePage<Observation>> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    let rows = [...this.observationsByKey.values()];
    if (query.sourceKind !== undefined) {
      rows = rows.filter((o) => o.sourceKind === query.sourceKind);
    }
    if (query.sourceResultId !== undefined) {
      rows = rows.filter((o) => o.sourceResultId === query.sourceResultId);
    }
    if (query.taskId !== undefined) rows = rows.filter((o) => o.taskId === query.taskId);
    if (query.modelConfigurationId !== undefined) {
      rows = rows.filter((o) => o.modelConfigurationId === query.modelConfigurationId);
    }
    rows.sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id));
    return {
      items: rows.slice(offset, offset + limit).map((o) => JSON.parse(JSON.stringify(o))),
      total: rows.length,
      offset,
      limit,
    };
  }

  async countObservations(): Promise<number> {
    return this.observationsByKey.size;
  }

  async putDecision(decision: EligibilityDecision): Promise<void> {
    if (!isEligibilityDecision(decision)) {
      throw new StorageError("validation", "Invalid EligibilityDecision.");
    }
    const id = `${decision.observationId}#${decision.ruleVersion}`;
    const existing = this.decisions.get(id);
    if (existing) {
      if (canonicalJsonString(existing) === canonicalJsonString(decision)) return;
      throw new EvidenceCorruptionError(
        `Decision ${id} already exists with different content at the same rule version.`,
      );
    }
    this.decisions.set(id, JSON.parse(JSON.stringify(decision)));
  }

  async getDecision(
    observationId: string,
    ruleVersion: number,
  ): Promise<EligibilityDecision | null> {
    const existing = this.decisions.get(`${observationId}#${ruleVersion}`);
    return existing ? JSON.parse(JSON.stringify(existing)) : null;
  }

  async listDecisionRevisions(observationId: string): Promise<EligibilityDecision[]> {
    return [...this.decisions.values()]
      .filter((d) => d.observationId === observationId)
      .map((d) => JSON.parse(JSON.stringify(d)))
      .sort((a, b) => a.ruleVersion - b.ruleVersion);
  }

  async getActiveDecision(observationId: string): Promise<EligibilityDecision | null> {
    const revisions = await this.listDecisionRevisions(observationId);
    return revisions.length === 0 ? null : revisions[revisions.length - 1];
  }

  async listActiveDecisions(query: ActiveDecisionsQuery = {}): Promise<EligibilityDecision[]> {
    let ids = [...this.observationsByKey.values()].map((o) => o.id);
    if (query.sourceResultId !== undefined) {
      ids = [...this.observationsByKey.values()]
        .filter((o) => o.sourceResultId === query.sourceResultId)
        .map((o) => o.id);
    }
    const decisions: EligibilityDecision[] = [];
    for (const id of ids) {
      const active = await this.getActiveDecision(id);
      if (active) decisions.push(active);
    }
    decisions.sort(
      (a, b) => a.observationId.localeCompare(b.observationId) || a.ruleVersion - b.ruleVersion,
    );
    return decisions;
  }

  async putVerifierOutcome(
    outcome: ExecutedVerifierOutcome,
  ): Promise<"created" | "existing"> {
    if (!isExecutedVerifierOutcome(outcome)) {
      throw new StorageError("validation", "Invalid ExecutedVerifierOutcome.");
    }
    const prohibited: string[] = [];
    collectProhibitedFieldPaths(outcome, "", prohibited);
    if (prohibited.length > 0) {
      throw new StorageError("validation", `Invalid ExecutedVerifierOutcome: ${prohibited[0]}`);
    }
    const id = verifierOutcomeId(outcome);
    const existing = this.verifierOutcomes.get(id);
    if (existing) {
      if (canonicalJsonString(existing) === canonicalJsonString(outcome)) return "existing";
      throw new EvidenceCorruptionError(
        `Executed verifier outcome ${id} already exists with non-identical ` +
          `content — corruption, not last-write-wins.`,
      );
    }
    this.verifierOutcomes.set(id, JSON.parse(JSON.stringify(outcome)));
    return "created";
  }

  async listVerifierOutcomes(
    query: { taskId?: string; modelKey?: string; runIds?: string[] } = {},
  ): Promise<ExecutedVerifierOutcome[]> {
    let rows = [...this.verifierOutcomes.values()];
    if (query.taskId !== undefined) rows = rows.filter((r) => r.taskId === query.taskId);
    if (query.modelKey !== undefined) rows = rows.filter((r) => r.modelKey === query.modelKey);
    if (query.runIds !== undefined) {
      const runIds = new Set(query.runIds);
      rows = rows.filter((r) => runIds.has(r.runId));
    }
    return rows
      .map((r) => JSON.parse(JSON.stringify(r)))
      .sort(
        (a, b) =>
          a.executedAt - b.executedAt ||
          a.runId.localeCompare(b.runId) ||
          a.taskId.localeCompare(b.taskId) ||
          a.modelKey.localeCompare(b.modelKey),
      );
  }

  async putIndexJob(job: EvidenceIndexJob): Promise<PutIndexJobResult> {
    validateJob(job);
    const existing = this.jobs.get(job.sourceResultId);
    if (!existing) {
      this.jobs.set(job.sourceResultId, JSON.parse(JSON.stringify(job)));
      return "created";
    }
    const result = applyJobCas(existing, job);
    if (result === "unchanged") return result;
    this.jobs.set(job.sourceResultId, JSON.parse(JSON.stringify(job)));
    return result;
  }

  async getIndexJob(sourceResultId: string): Promise<EvidenceIndexJob | null> {
    const existing = this.jobs.get(sourceResultId);
    return existing ? JSON.parse(JSON.stringify(existing)) : null;
  }

  async listIndexJobs(filter?: {
    status?: EvidenceIndexJobStatus;
    sourceKind?: ObservationSourceKind;
  }): Promise<EvidenceIndexJob[]> {
    let rows = [...this.jobs.values()];
    if (filter?.status !== undefined) rows = rows.filter((r) => r.status === filter.status);
    if (filter?.sourceKind !== undefined) {
      rows = rows.filter((r) => r.sourceKind === filter.sourceKind);
    }
    return rows
      .map((r) => JSON.parse(JSON.stringify(r)))
      .sort(
        (a, b) => a.updatedAt - b.updatedAt || a.sourceResultId.localeCompare(b.sourceResultId),
      );
  }

  async recoverStaleIndexJobs(opts: {
    staleTimeoutMs: number;
    now: number;
  }): Promise<string[]> {
    if (!Number.isFinite(opts.staleTimeoutMs) || opts.staleTimeoutMs < 0) {
      throw new StorageError("validation", "staleTimeoutMs must be a non-negative number.");
    }
    if (!Number.isFinite(opts.now)) {
      throw new StorageError("validation", "now must be a finite number.");
    }
    const recovered: string[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== "running") continue;
      if (job.updatedAt + opts.staleTimeoutMs > opts.now) continue;
      job.status = "queued";
      recovered.push(job.sourceResultId);
    }
    return recovered.sort((a, b) => a.localeCompare(b));
  }
}
