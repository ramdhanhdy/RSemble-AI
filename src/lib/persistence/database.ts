// =============================================================================
// RSemble AI — Dexie persistence database
//
// Single IndexedDB database hosting the run, evaluation rubric, suite,
// experiment, storage-meta, Fusion Study, and canonical Task tables. Owns the
// storage lifecycle: classified StorageError for quota/unavailable/blocked
// states and a StorageState surface so React providers can react when the
// database is blocked by another tab or upgraded out from under it.
//
// Schema versions:
//   v1 — run/evaluation/suite/experiment/storage-meta (7 tables).
//   v2 — additive Fusion Study tables (7 tables).
//   v3 — additive canonical Task tables (8 tables): tasks, taskVersions,
//        taskArtifacts, taskInstances, taskFamilies, taskFamilyAssignments,
//        taskFacetAnnotations, taskMigrationCrosswalk.
// =============================================================================

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

/** Legacy → canonical migration crosswalk row (spec §6.2). */
export interface TaskMigrationCrosswalkRow {
  legacyScopeKey: string;
  taskId: string;
  taskVersion: number;
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
  /** Resolves when the database is open, or rejects with a StorageError. */
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
  const handle: DatabaseHandle = { db, state: db.state, ready: Promise.resolve() };

  db.onStateChange((s) => {
    handle.state = s;
  });

  handle.ready = db.open()
    .then(() => migrateEmbeddedLegacyTasks(db))
    .then(
      () => undefined,
      (err: unknown) => {
        db.setState("unavailable");
        throw classifyStorageError(err);
      },
    );

  return handle;
}
