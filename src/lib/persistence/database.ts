// =============================================================================
// RSemble AI — Dexie persistence database
//
// Single IndexedDB database hosting the run, evaluation profile, suite,
// experiment, and storage-meta tables. Version 1 schema. Owns the storage
// lifecycle: classified StorageError for quota/unavailable/blocked states and a
// StorageState surface so React providers can react when the database is
// blocked by another tab or upgraded out from under it.
// =============================================================================

import Dexie from "dexie";
import type { Table } from "dexie";

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

export interface StorageMetaRow {
  key: string;
  value: unknown;
}

/** Lifecycle state surfaced to React. */
export type StorageState =
  | "ready"
  | "blocked"
  | "versionchange"
  | "unavailable";

/** Classified storage failure surfaced to callers and UI. */
export type StorageErrorKind =
  | "quota"
  | "unavailable"
  | "validation"
  | "conflict"
  | "blocked"
  | "versionchange";

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
  const message =
    (err as { message?: string } | null)?.message ?? "storage error";
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
      experiments:
        "id, revision, suiteId, suiteVersion, protocolFingerprint, createdAt, status",
      storageMeta: "key",
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
      throw new StorageError("versionchange", "Database is unavailable due to a version change. Reload the page.");
    }
    if (this._storageState === "blocked") {
      throw new StorageError("blocked", "Database upgrade is blocked. Close other RSemble tabs to continue.");
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

  handle.ready = db.open().then(
    () => undefined,
    (err: unknown) => {
      db.setState("unavailable");
      throw classifyStorageError(err);
    },
  );

  return handle;
}
