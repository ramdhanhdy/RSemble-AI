// =============================================================================
// RSemble AI — Dexie persistence database
//
// Single IndexedDB database hosting the run, evaluation rubric, suite,
// experiment, storage-meta, Fusion Study, canonical Task, and Task Set
// tables. Owns the storage lifecycle: classified StorageError for
// quota/unavailable/blocked states and a StorageState surface so React
// providers can react when the database is blocked by another tab or
// upgraded out from under it.
//
// Schema versions:
//   v1 — run/evaluation/suite/experiment/storage-meta (7 tables).
//   v2 — additive Fusion Study tables (7 tables).
//   v3 — additive canonical Task tables (8 tables): tasks, taskVersions,
//        taskArtifacts, taskInstances, taskFamilies, taskFamilyAssignments,
//        taskFacetAnnotations, taskMigrationCrosswalk.
//   v4 — additive typed cross-family relations (1 table): taskFamilyRelations.
//   v5 — additive Task Set record/version tables (2 tables): taskSets,
//        taskSetVersions. The legacy Suite table is unchanged.
//   v6 — additive legacy ownership crosswalk (1 table):
//        taskSetOwnershipCrosswalk (child 03 Task 4). Maps reconstructed
//        Suite/Experiment/Fusion-owner coordinates to exact Task Set Versions.
//   v7 — additive immutable Task Set execution materializations (1 table):
//        taskSetMaterializations.

import Dexie, { type Table } from "dexie";
import { migrateEmbeddedLegacyTasks } from "./canonical-task-migration";

// Indexed row shapes — a search/summary row is the stored summary plus the
// indexes Dexie needs to filter and paginate without loading detail records.
export interface RunSummaryRow {
  /** "full" | "legacy" — the summary discriminator, duplicated as an index. */
  kind: "full" | "legacy";
  summary: unknown;
  id: string;
  revision: number;
  createdAt: number;
  completedAt: number | null;
  status: string | null;
  mode: string | null;
  sourceKind: string;
  sourceProtocolFingerprint: string | null;
  sourceExperimentTaskAttemptId: string | null;
  modelKeys: string[];
}

export interface RunDetailRow {
  id: string;
  record: unknown;
  revision: number;
  createdAt: number;
  status: string;
}

export interface ProfileRow {
  id: string;
  record: unknown;
  revision: number;
  latestVersion: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface ProfileVersionRow {
  id: string;
  version: number;
  profile: unknown;
  updatedAt: number;
}

export interface SuiteRow {
  id: string;
  suite: unknown;
  revision: number;
  version: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface ExperimentRow {
  id: string;
  experiment: unknown;
  revision: number;
  suiteId: string;
  suiteVersion: number;
  protocolFingerprint: string;
  createdAt: number;
  status: string;
}

// --- Fusion Study rows (schema v2) --------------------------------------------

export interface FusionRecipeRow {
  id: string;
  version: number;
  recipe: unknown;
  createdAt: number;
}

export interface PoolManifestRow {
  id: string;
  version: number;
  manifest: unknown;
  createdAt: number;
}

export interface FusionStudyRow {
  id: string;
  study: unknown;
  revision: number;
  suiteId: string;
  suiteVersion: number;
  status: string;
  updatedAt: number;
}

export interface FusionTrialRow {
  id: string;
  trial: unknown;
  revision: number;
  studyId: string;
  stage: string;
  status: string;
  createdAt: number;
}

export interface FusionAttemptRow {
  id: string;
  attempt: unknown;
  studyId: string;
  createdAt: number;
}

export interface FusionObservationRow {
  id: string;
  observation: unknown;
  trialId: string;
  createdAt: number;
}

export interface FusionPlaybookRow {
  id: string;
  playbook: unknown;
  studyId: string;
  createdAt: number;
}

export interface StorageMetaRow {
  key: string;
  value: unknown;
}

// --- Canonical Task rows (schema v3) ------------------------------------------
//
// Artifact bytes live OUTSIDE indexed rows via `storageRef` indirection (spec
// §3.3, §8). No Dexie Blob/ArrayBuffer columns; the `taskArtifactBytes` table
// holds opaque byte payloads keyed by artifact id, kept separate from the
// indexable `taskArtifacts` summary rows. Heavy bytes are never indexed.

/** Canonical Task record row (spec §3.1). Mutable metadata only via CAS. */
export interface TaskRecordRow {
  id: string;
  record: unknown;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  origin: string;
  revision: number;
}

/** Immutable Task Version row (spec §3.2). Compound [taskId+version] key. */
export interface TaskVersionRow {
  taskId: string;
  version: number;
  version_: unknown;
  createdAt: number;
}

/** Immutable Task Artifact summary row (spec §3.3). Bytes live separately. */
export interface TaskArtifactRow {
  id: string;
  contentDigest: string;
  mediaType: string;
  byteCount: number;
  storageRef: string;
  createdAt: number;
}

/** Opaque artifact byte payload, kept out of indexed summary rows. */
export interface TaskArtifactBytesRow {
  id: string;
  bytes: Uint8Array;
}

/** Concrete Task Instance row (spec §3.4). */
export interface TaskInstanceRow {
  id: string;
  instance: unknown;
  taskId: string;
  taskVersion: number;
  inputDigest: string;
  inputCompleteness: string;
  createdAt: number;
}

/** Task Family row (spec §3.5). Mutable metadata only via CAS. */
export interface TaskFamilyRow {
  id: string;
  family: unknown;
  parentFamilyId: string | null;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
}

/** Versioned family assignment row (spec §3.5). */
export interface TaskFamilyAssignmentRow {
  id: string;
  assignment: unknown;
  taskId: string;
  taskVersion: number;
  familyId: string;
  isPrimary: number; // 0 | 1 — Dexie indexes booleans poorly; store as int.
  createdAt: number;
  revision: number;
  archivedAt: number | null;
}

/** Versioned facet annotation row (spec §3.6). */
export interface TaskFacetAnnotationRow {
  id: string;
  annotation: unknown;
  taskId: string;
  taskVersion: number | null;
  facetId: string;
  valueId: string;
  createdAt: number;
}

/** Typed cross-family relation row (spec §3.5, schema v4 additive). */
export interface TaskFamilyRelationRow {
  id: string;
  relation: unknown;
  fromFamilyId: string;
  toFamilyId: string;
  kind: string;
  createdAt: number;
}

/** Legacy → canonical migration crosswalk row (spec §6.2). */
export interface TaskMigrationCrosswalkRow {
  legacyScopeKey: string;
  taskId: string;
  taskVersion: number;
}

// --- Task Set rows (schema v5) ------------------------------------------------
//
// Mutable Task Set records plus immutable versions. Mirrors the Task/Rubric
// record+version pattern — never the Suite overwrite model. The legacy
// `suites` table remains untouched.

/** Canonical Task Set record row (spec §3.1). Mutable metadata only via CAS. */
export interface TaskSetRecordRow {
  id: string;
  record: unknown;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  origin: string;
  revision: number;
}

/** Immutable Task Set Version row (spec §3.2). Compound [taskSetId+version] key. */
export interface TaskSetVersionRow {
  taskSetId: string;
  version: number;
  version_: unknown;
  createdAt: number;
}

/** Legacy Suite/Experiment/Fusion-owner → Task Set Version crosswalk row
 *  (schema v6, child 03 Task 4). Discriminated by `kind`; one row per
 *  deterministic owner coordinate. `version` is null and `status` is
 *  "unresolved" when the owner could not be pinned to an exact reconstructed
 *  Task Set Version. The migration writes these additively; legacy entity
 *  payloads are never modified. */
export interface TaskSetOwnershipCrosswalkRow {
  key: string;
  kind: "suite-manifest" | "experiment-owner" | "fusion-owner";
  taskSetId: string;
  version: number | null;
  /** Migration workload digest (`sha256:<hex>`) for suite-manifest/experiment
   *  rows; null for unresolved fusion-owner rows. */
  digest: string | null;
  status: "resolved" | "unresolved";
  /** Member ids that remained unresolved on the mapped version. */
  unresolvedMemberIds?: string[];
  /** Full frozen suiteRef for fusion-owner rows. */
  suiteRef?: { suiteId: string; suiteVersion: number; protocolFingerprint: string };
  /** Experiment id for experiment-owner rows. */
  experimentId?: string;
  /** Optional human-readable note for unresolved rows. */
  note?: string | null;
  updatedAt: number;
}

/** Immutable materialized execution input persisted before controller start
 *  (schema v7, child 03 Task 7). The snapshot is stored in full in the row;
 *  identity fields are duplicated only for exact indexed lookup. */
export interface TaskSetMaterializationRow {
  id: string;
  taskSetId: string;
  taskSetVersion: number;
  protocolFingerprint: string;
  snapshot: unknown;
  createdAt: number;
}

/** Lifecycle state surfaced to React. */
export type StorageState = "ready" | "blocked" | "versionchange" | "unavailable";

/** Classified storage failure surfaced to callers and UI. */
export type StorageErrorKind =
  "quota" | "unavailable" | "validation" | "conflict" | "blocked" | "versionchange";

export class StorageError extends Error {
  readonly kind: StorageErrorKind;
  readonly cause?: unknown;
  constructor(kind: StorageErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "StorageError";
    this.kind = kind;
    this.cause = cause;
  }
}

/** Classify a raw IndexedDB/Dexie error into a StorageError. */
export function classifyStorageError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = (err as { message?: string } | null)?.message ?? "storage error";
  if (name === "QuotaExceededError" || /quota/i.test(message)) {
    return new StorageError("quota", message, err);
  }
  if (name === "DataError" || /data error/i.test(message)) {
    return new StorageError("validation", message, err);
  }
  if (
    name === "NotFoundError" ||
    name === "ConnectionError" ||
    /indexeddb/i.test(message) ||
    /connection/i.test(message)
  ) {
    return new StorageError("unavailable", message, err);
  }
  return new StorageError("unavailable", message, err);
}

type StateListener = (state: StorageState) => void;

/**
 * RSemble Dexie database. Tables are public so repositories can run
 * multi-table transactions. Lifecycle state lives on the DB itself so
 * repositories can assert writability before every mutation.
 */
export class RSembleEvaluationDB extends Dexie {
  runSummaries!: Table<RunSummaryRow, string>;
  runDetails!: Table<RunDetailRow, string>;
  profiles!: Table<ProfileRow, string>;
  profileVersions!: Table<ProfileVersionRow, [string, number]>;
  suites!: Table<SuiteRow, string>;
  experiments!: Table<ExperimentRow, string>;
  storageMeta!: Table<StorageMetaRow, string>;
  // Fusion Study tables (schema v2)
  fusionRecipes!: Table<FusionRecipeRow, [string, number]>;
  poolManifests!: Table<PoolManifestRow, [string, number]>;
  fusionStudies!: Table<FusionStudyRow, string>;
  fusionTrials!: Table<FusionTrialRow, string>;
  fusionAttempts!: Table<FusionAttemptRow, string>;
  fusionObservations!: Table<FusionObservationRow, string>;
  fusionPlaybooks!: Table<FusionPlaybookRow, string>;
  // Canonical Task tables (schema v3)
  tasks!: Table<TaskRecordRow, string>;
  taskVersions!: Table<TaskVersionRow, [string, number]>;
  taskArtifacts!: Table<TaskArtifactRow, string>;
  taskArtifactBytes!: Table<TaskArtifactBytesRow, string>;
  taskInstances!: Table<TaskInstanceRow, string>;
  taskFamilies!: Table<TaskFamilyRow, string>;
  taskFamilyAssignments!: Table<TaskFamilyAssignmentRow, string>;
  taskFacetAnnotations!: Table<TaskFacetAnnotationRow, string>;
  taskMigrationCrosswalk!: Table<TaskMigrationCrosswalkRow, string>;
  taskFamilyRelations!: Table<TaskFamilyRelationRow, string>;
  // Task Set tables (schema v5)
  taskSets!: Table<TaskSetRecordRow, string>;
  taskSetVersions!: Table<TaskSetVersionRow, [string, number]>;
  // Legacy ownership crosswalk (schema v6, child 03 Task 4)
  taskSetOwnershipCrosswalk!: Table<TaskSetOwnershipCrosswalkRow, string>;
  // Immutable execution materializations (schema v7, child 03 Task 7)
  taskSetMaterializations!: Table<TaskSetMaterializationRow, string>;
  /** Current storage lifecycle state. */
  private _storageState: StorageState = "ready";
  private stateListeners = new Set<StateListener>();
  /** Guards against auto-reopen after versionchange forced a close. */
  private closed = false;

  constructor(name = "rsemble-evaluation") {
    super(name);
    this.version(1).stores({
      runSummaries:
        "id, kind, revision, createdAt, completedAt, status, mode, sourceKind, sourceProtocolFingerprint, sourceExperimentTaskAttemptId, *modelKeys",
      runDetails: "id, revision, createdAt, status",
      profiles: "id, revision, latestVersion, updatedAt, archivedAt",
      profileVersions: "[id+version], id, version, updatedAt",
      suites: "id, revision, version, updatedAt, archivedAt",
      experiments: "id, revision, suiteId, suiteVersion, protocolFingerprint, createdAt, status",
      storageMeta: "key",
    });

    // v2: additive Fusion Study tables (immutable recipes/manifests/playbooks,
    // sealable trials, attempt lineage, holdout observations).
    this.version(2).stores({
      fusionRecipes: "[id+version], id, version",
      poolManifests: "[id+version], id, version",
      fusionStudies: "id, revision, suiteId, suiteVersion, status, updatedAt",
      fusionTrials: "id, revision, studyId, stage, status, createdAt",
      fusionAttempts: "id, studyId, createdAt",
      fusionObservations: "id, trialId, createdAt",
      fusionPlaybooks: "id, studyId, createdAt",
    });

    // v3: additive canonical Task tables (spec §5). No existing v1/v2 table is
    // redefined — this block only adds new stores. Artifact bytes live in a
    // separate `taskArtifactBytes` table (no indexed heavy bytes); the
    // `taskArtifacts` summary row carries only digest/mediaType/byteCount/
    // storageRef. `isPrimary` is stored as 0|1 because Dexie does not index
    // boolean values reliably.
    this.version(3).stores({
      tasks: "id, updatedAt, archivedAt, origin",
      taskVersions: "[taskId+version], taskId, createdAt",
      taskArtifacts: "id, contentDigest, mediaType, byteCount, createdAt",
      taskArtifactBytes: "id",
      taskInstances: "id, [taskId+taskVersion], inputDigest, inputCompleteness, createdAt",
      taskFamilies: "id, parentFamilyId, updatedAt, archivedAt",
      taskFamilyAssignments: "id, taskId, taskVersion, familyId, isPrimary, createdAt, archivedAt",
      taskFacetAnnotations: "id, taskId, [taskId+taskVersion], facetId, valueId, createdAt",
      taskMigrationCrosswalk: "legacyScopeKey, taskId, taskVersion",
    });

    // v4: additive typed cross-family relations (spec §3.5). No existing
    // v1/v2/v3 table is redefined — this block only adds the new
    // `taskFamilyRelations` store. Relations are explicit and typed; they do
    // not imply a universal family tree.
    this.version(4).stores({
      taskFamilyRelations: "id, fromFamilyId, toFamilyId, kind, createdAt",
    });

    // v5: additive Task Set record/version tables (spec §3.1–3.2, §5.2).
    // No existing v1–v4 table is redefined — this block only adds the new
    // stores. The legacy Suite table stays a single mutable row.
    this.version(5).stores({
      taskSets: "id, updatedAt, archivedAt, origin",
      taskSetVersions: "[taskSetId+version], taskSetId, createdAt",
    });

    // v6: additive legacy ownership crosswalk (child 03 Task 4, spec §8.1/§8.2,
    // §10). One discriminated store maps reconstructed Suite-manifest,
    // Experiment, and Fusion-owner coordinates to exact Task Set Versions
    // (or explicit unresolved states). No existing table is redefined.
    this.version(6).stores({
      taskSetOwnershipCrosswalk: "key, kind, taskSetId",
    });

    // v7: additive immutable Task Set materializations (child 03 Task 7).
    // Each execution input is a new row; no Suite or prior materialization is
    // overwritten. Controller consumption of this identity is Task 8.
    this.version(7).stores({
      taskSetMaterializations:
        "id, taskSetId, [taskSetId+taskSetVersion], protocolFingerprint, createdAt",
    });

    this.on("blocked", () => {
      this.setState("blocked");
    });
    this.on("versionchange", () => {
      this.closed = true;
      try {
        super.close();
      } catch {
        // best-effort close during upgrade
      }
      this.setState("versionchange");
    });
  }

  get state(): StorageState {
    return this._storageState;
  }

  /** Subscribe to lifecycle state changes. Returns unsubscribe. */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setState(next: StorageState): void {
    this._storageState = next;
    for (const l of this.stateListeners) {
      try {
        l(next);
      } catch {
        // listener errors must not break the DB
      }
    }
  }

  /**
   * Assert that the database is writable. Call before every mutation.
   * Throws a classified StorageError if blocked, versionchanged, or unavailable.
   */
  assertWritable(): void {
    if (this.closed || this._storageState === "versionchange") {
      throw new StorageError(
        "versionchange",
        "Database is unavailable due to a version change. Reload the page.",
      );
    }
    if (this._storageState === "blocked") {
      throw new StorageError(
        "blocked",
        "Database upgrade is blocked. Close other RSemble tabs to continue.",
      );
    }
    if (this._storageState === "unavailable") {
      throw new StorageError("unavailable", "Database is unavailable.");
    }
  }
}

export interface DatabaseHandle {
  db: RSembleEvaluationDB;
  state: StorageState;
  /** Non-fatal failure that leaves existing Compare storage operational while
   *  preventing the canonical Task repository from being published. */
  taskMigrationError: StorageError | null;
  /** Resolves when the database is open and Task migration has settled. Rejects
   *  only when the underlying database itself cannot be opened. */
  ready: Promise<void>;
}

/**
 * Create and open the database, wiring the `blocked` / `versionchange` events
 * so the React layer can degrade gracefully. State transitions are surfaced
 * through both the returned handle and the DB's onStateChange listeners.
 *
 * Initialization is observable via `handle.ready`. If IndexedDB open fails,
 * the DB state transitions to `unavailable` and the promise rejects with a
 * classified StorageError so the provider can surface Retry storage.
 */
export function createDatabase(name?: string): DatabaseHandle {
  const db = new RSembleEvaluationDB(name);
  const handle: DatabaseHandle = {
    db,
    state: db.state,
    taskMigrationError: null,
    ready: Promise.resolve(),
  };

  db.onStateChange((s) => {
    handle.state = s;
  });

  handle.ready = db
    .open()
    .then(async () => {
      try {
        await migrateEmbeddedLegacyTasks(db);
      } catch (err) {
        // Canonical Task migration is additive. Its failure must not turn the
        // established Run/Evaluation/Compare stores into an unavailable DB.
        handle.taskMigrationError = classifyStorageError(err);
      }
    })
    .then(
      () => undefined,
      (err: unknown) => {
        db.setState("unavailable");
        throw classifyStorageError(err);
      },
    );

  return handle;
}
