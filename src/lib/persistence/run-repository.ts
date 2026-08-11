// =============================================================================
// RSemble AI — Run repository (Dexie-backed)
//
// Implements the RunRepository interface over the RSembleEvaluationDB tables.
// Summary and detail are written atomically in one transaction. Updates use
// compare-and-swap on revision and reject illegal terminal-state regressions.
// Listing never loads detail records; filters are applied before pagination.
// =============================================================================

import {
  type RSembleEvaluationDB,
  type RunSummaryRow,
  type RunDetailRow,
  StorageError,
  classifyStorageError,
} from "./database";
import { LEASE_KEY, type LeaseInfo } from "../execution-lease";
import {
  type ExecutionFence,
  isFullRunSummaryV2,
  isLegacyRunSummary,
  isRunRecordV2,
  repairRunRecordForCompatibility,
  isRunArchiveV1,
  type FullRunSummaryV2,
  type LegacyRunSummary,
  type RunArchiveV1,
  type RunImportResult,
  type RunListQuery,
  type RunRecordV2,
  type RunSummary,
} from "./run-types";

// --- Terminal states that may never regress to "running" ----------------------
const TERMINAL_STATUSES = new Set(["completed", "partial", "failed", "aborted", "interrupted"]);

/**
 * Check a lease fence while the caller's run write transaction is open. This
 * is intentionally owner+monotonic-fence based: a takeover always increments
 * the fence, so an old controller cannot commit even if it shares an ownerId.
 */
function assertLeaseFence(
  lease: LeaseInfo | null,
  expected: ExpectedExecutionFence,
  now: number,
): void {
  if (!lease) throw new StorageError("conflict", "Execution lease not held");
  if (
    lease.ownerId !== expected.ownerId ||
    lease.fence !== expected.fence ||
    (expected.leaseId !== undefined && lease.leaseId !== expected.leaseId)
  ) {
    throw new StorageError(
      "conflict",
      "Execution lease token mismatch: another execution owner has taken over",
    );
  }
  // Exact paid execution tokens include leaseId and must also be live at
  // commit time. Recovery may supply a deterministic checkedAt clock.
  if (expected.leaseId !== undefined && lease.expiresAt <= (expected.checkedAt ?? now)) {
    throw new StorageError("conflict", "Execution lease expired");
  }
}

/** Internal clock sample supplied by recovery/controller callers that inject a
 * deterministic clock. It is never persisted as part of the run fence. */
export type ExpectedExecutionFence = ExecutionFence & { checkedAt?: number };

export interface RunRepository {
  /**
   * Create atomically. expectedFence is optional for import/maintenance paths;
   * Compare passes it so the active lease is verified in the same transaction.
   */
  create(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedFence?: ExpectedExecutionFence,
  ): Promise<void>;
  /** Update atomically with revision CAS and (when supplied) lease fencing. */
  update(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedRevision: number,
    expectedFence?: ExpectedExecutionFence,
  ): Promise<number>;
  importLegacySummary(summary: LegacyRunSummary): Promise<"created" | "skipped">;
  get(id: string): Promise<RunRecordV2 | null>;
  list(query: RunListQuery): Promise<RunSummary[]>;
  subscribe(listener: () => void): () => void;
  exportAll(): Promise<RunArchiveV1>;
  importArchive(archive: RunArchiveV1): Promise<RunImportResult>;
}

function normalizeSearchText(summary: FullRunSummaryV2 | LegacyRunSummary): string {
  const parts: string[] = [];
  if ("taskTitle" in summary) parts.push(summary.taskTitle.toLowerCase());
  parts.push(summary.taskExcerpt.toLowerCase());
  parts.push(...summary.modelKeys.map((k) => k.toLowerCase()));
  return parts.join(" ");
}

function summaryToRow(summary: FullRunSummaryV2 | LegacyRunSummary): RunSummaryRow {
  const isFull = summary.kind === "full";
  const full = isFull ? (summary as FullRunSummaryV2) : null;
  return {
    kind: summary.kind,
    summary,
    id: summary.id,
    revision: isFull ? (summary as FullRunSummaryV2).revision : 0,
    createdAt: summary.createdAt,
    completedAt: isFull ? (summary as FullRunSummaryV2).completedAt : null,
    status: isFull ? (summary as FullRunSummaryV2).status : null,
    mode: isFull ? (summary as FullRunSummaryV2).mode : null,
    sourceKind: full?.source.kind ?? "adhoc",
    sourceProtocolFingerprint:
      full?.source.kind === "experiment" ? full.source.protocolFingerprint : null,
    sourceExperimentTaskAttemptId:
      full?.source.kind === "experiment" ? full.source.experimentTaskAttemptId : null,
    modelKeys: summary.modelKeys,
  };
}

function compatibleRecord(record: unknown): RunRecordV2 | null {
  return isRunRecordV2(record) ? record : repairRunRecordForCompatibility(record);
}

export interface RunRepositoryOptions {
  /** Injected clock for deterministic lease-expiry tests. */
  now?: () => number;
}

export function createRunRepository(
  db: RSembleEvaluationDB,
  options: RunRepositoryOptions = {},
): RunRepository {
  const listeners = new Set<() => void>();
  const now = options.now ?? (() => Date.now());

  function notify() {
    for (const l of listeners) {
      try {
        l();
      } catch {
        // listener errors must not break the repository
      }
    }
  }

  async function create(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedFence?: ExpectedExecutionFence,
  ): Promise<void> {
    if (!isRunRecordV2(record)) throw new StorageError("validation", "Invalid run record");
    if (!isFullRunSummaryV2(summary)) throw new StorageError("validation", "Invalid summary");
    if (record.id !== summary.id) {
      throw new StorageError(
        "validation",
        `Record ID "${record.id}" does not match summary ID "${summary.id}"`,
      );
    }
    if (record.revision !== summary.revision) {
      throw new StorageError(
        "validation",
        `Record revision ${record.revision} does not match summary revision ${summary.revision}`,
      );
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.runSummaries, db.runDetails, db.storageMeta, async () => {
        if (expectedFence) {
          const leaseRow = await db.storageMeta.get(LEASE_KEY);
          assertLeaseFence(
            (leaseRow?.value as LeaseInfo | undefined) ?? null,
            expectedFence,
            now(),
          );
        }
        const existing = await db.runSummaries.get(record.id);
        if (existing) throw new StorageError("conflict", `Run ${record.id} already exists`);

        const summaryWithSearch: FullRunSummaryV2 = {
          ...summary,
          searchText: normalizeSearchText(summary),
        };
        await db.runSummaries.put(summaryToRow(summaryWithSearch));

        const detailRow: RunDetailRow = {
          id: record.id,
          record,
          revision: record.revision,
          createdAt: record.createdAt,
          status: record.status,
        };
        await db.runDetails.put(detailRow);
      });
      notify();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function update(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedRevision: number,
    expectedFence?: ExpectedExecutionFence,
  ): Promise<number> {
    const compatible = compatibleRecord(record);
    if (!compatible) throw new StorageError("validation", "Invalid run record");
    if (!isFullRunSummaryV2(summary)) throw new StorageError("validation", "Invalid summary");
    if (compatible.id !== summary.id) {
      throw new StorageError(
        "validation",
        `Record ID "${record.id}" does not match summary ID "${summary.id}"`,
      );
    }
    db.assertWritable();

    const newRevision = expectedRevision + 1;
    const updatedRecord: RunRecordV2 = { ...compatible, revision: newRevision };
    try {
      await db.transaction("rw", db.runSummaries, db.runDetails, db.storageMeta, async () => {
        if (expectedFence) {
          const leaseRow = await db.storageMeta.get(LEASE_KEY);
          assertLeaseFence(
            (leaseRow?.value as LeaseInfo | undefined) ?? null,
            expectedFence,
            now(),
          );
        }
        const existingDetail = await db.runDetails.get(compatible.id);
        if (!existingDetail) throw new StorageError("conflict", `Run ${compatible.id} not found`);
        if (existingDetail.revision !== expectedRevision) {
          throw new StorageError(
            "conflict",
            `Stale revision: expected ${expectedRevision}, got ${existingDetail.revision}`,
          );
        }

        // Reject illegal terminal-state regressions to "running".
        if (TERMINAL_STATUSES.has(existingDetail.status) && compatible.status === "running") {
          throw new StorageError(
            "validation",
            `Cannot regress terminal status "${existingDetail.status}" to "running" (run ${compatible.id})`,
          );
        }

        const summaryWithSearch: FullRunSummaryV2 = {
          ...summary,
          revision: newRevision,
          searchText: normalizeSearchText(summary),
        };
        await db.runSummaries.put(summaryToRow(summaryWithSearch));

        const detailRow: RunDetailRow = {
          id: record.id,
          record: updatedRecord,
          revision: newRevision,
          createdAt: compatible.createdAt,
          status: compatible.status,
        };
        await db.runDetails.put(detailRow);
      });
      notify();
      return newRevision;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function importLegacySummary(summary: LegacyRunSummary): Promise<"created" | "skipped"> {
    if (!isLegacyRunSummary(summary))
      throw new StorageError("validation", "Invalid legacy summary");
    db.assertWritable();
    try {
      let result: "created" | "skipped" = "created";
      await db.transaction("rw", db.runSummaries, async () => {
        const existing = await db.runSummaries.get(summary.id);
        if (existing) {
          result = "skipped";
          return;
        }
        await db.runSummaries.put(summaryToRow(summary));
      });
      if (result === "created") notify();
      return result;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function get(id: string): Promise<RunRecordV2 | null> {
    try {
      const row = await db.runDetails.get(id);
      if (!row) return null;
      const record = compatibleRecord(row.record);
      return record;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function list(query: RunListQuery): Promise<RunSummary[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    try {
      const collection = db.runSummaries.orderBy("createdAt").reverse();

      // Apply filters BEFORE pagination.
      const filtered: RunSummary[] = [];
      let skipped = 0;
      await collection.each((row) => {
        const summary = row.summary;
        if (!isFullRunSummaryV2(summary) && !isLegacyRunSummary(summary)) return;

        // Text filter
        if (query.text) {
          const q = query.text.toLowerCase();
          if (!("searchText" in summary) || !summary.searchText?.toLowerCase().includes(q)) return;
        }

        // Model filter
        if (query.modelKey) {
          if (!summary.modelKeys.includes(query.modelKey)) return;
        }

        // Source filter
        if (query.source) {
          if (query.source === "legacy") {
            if (summary.kind !== "legacy") return;
          } else if (query.source === "adhoc") {
            if (summary.kind !== "full" || summary.source.kind !== "adhoc") return;
          } else if (query.source === "experiment") {
            if (summary.kind !== "full" || summary.source.kind !== "experiment") return;
          }
        }

        // Status filter — excludes legacy (no status)
        if (query.status) {
          if (summary.kind !== "full" || summary.status !== query.status) return;
        }

        // Mode filter — excludes legacy (no mode)
        if (query.mode) {
          if (summary.kind !== "full" || summary.mode !== query.mode) return;
        }

        // Pagination
        if (skipped < offset) {
          skipped++;
          return;
        }
        if (filtered.length >= limit) return;
        filtered.push(summary);
      });

      return filtered;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function exportAll(): Promise<RunArchiveV1> {
    try {
      const summaries: RunSummary[] = [];
      const runs: RunRecordV2[] = [];

      await db.runSummaries.orderBy("createdAt").each((row) => {
        const s = row.summary;
        if (isFullRunSummaryV2(s) || isLegacyRunSummary(s)) summaries.push(s);
      });

      await db.runDetails.orderBy("createdAt").each((row) => {
        const r = compatibleRecord(row.record);
        if (r) runs.push(r);
      });

      return {
        schemaVersion: 1,
        exportedAt: Date.now(),
        runs,
        summaries,
      };
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function importArchive(archive: RunArchiveV1): Promise<RunImportResult> {
    const compatibleArchive: RunArchiveV1 = {
      ...archive,
      runs: archive.runs.map((record) => compatibleRecord(record) ?? record),
    };
    if (!isRunArchiveV1(compatibleArchive)) throw new StorageError("validation", "Invalid archive");
    db.assertWritable();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Pair detail records with their same-ID full summaries.
    const summariesById = new Map<string, FullRunSummaryV2>();
    const legacySummaries: LegacyRunSummary[] = [];

    for (const s of compatibleArchive.summaries) {
      if (isFullRunSummaryV2(s)) {
        summariesById.set(s.id, s);
      } else if (isLegacyRunSummary(s)) {
        legacySummaries.push(s);
      } else {
        errors.push(`Invalid summary in archive: ${JSON.stringify(s).slice(0, 100)}`);
      }
    }

    try {
      // Import full runs (detail + summary paired).
      for (const record of compatibleArchive.runs) {
        if (!isRunRecordV2(record)) {
          errors.push(
            `Invalid run record: ${typeof record === "object" && record !== null ? ((record as { id?: unknown }).id ?? "unknown") : "unknown"}`,
          );
          continue;
        }
        const summary = summariesById.get(record.id);
        if (!summary) {
          errors.push(`No matching summary for run ${record.id}`);
          continue;
        }

        await db.transaction("rw", db.runSummaries, db.runDetails, async () => {
          const existing = await db.runSummaries.get(record.id);
          if (existing) {
            skipped++;
            return;
          }
          const summaryWithSearch: FullRunSummaryV2 = {
            ...summary,
            searchText: normalizeSearchText(summary),
          };
          await db.runSummaries.put(summaryToRow(summaryWithSearch));
          await db.runDetails.put({
            id: record.id,
            record,
            revision: record.revision,
            createdAt: record.createdAt,
            status: record.status,
          });
          imported++;
        });
      }

      // Import legacy summaries.
      for (const legacy of legacySummaries) {
        await db.transaction("rw", db.runSummaries, async () => {
          const existing = await db.runSummaries.get(legacy.id);
          if (existing) {
            skipped++;
            return;
          }
          await db.runSummaries.put(summaryToRow(legacy));
          imported++;
        });
      }

      if (imported > 0) notify();
      return { imported, skipped, errors };
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  return { create, update, importLegacySummary, get, list, subscribe, exportAll, importArchive };
}

// =============================================================================
// In-memory repository for test injection (no Dexie dependency)
// =============================================================================

export class InMemoryRunRepository implements RunRepository {
  private summaries: Map<string, RunSummary>;
  private details: Map<string, RunRecordV2>;
  private listeners = new Set<() => void>();
  private readonly leaseStore: { lease: LeaseInfo | null; fence: number } | null;
  private readonly now: () => number;

  /** Optional shared maps let a test harness back an InMemoryRunRepository
   *  and an InMemoryExperimentStore with the same tables — mirroring the
   *  single-Dexie-DB production wiring. leaseStore enables the same fenced
   *  write contract as IndexedDB without requiring a browser database. */
  constructor(shared?: {
    summaries?: Map<string, RunSummary>;
    details?: Map<string, RunRecordV2>;
    leaseStore?: { lease: LeaseInfo | null; fence: number };
    now?: () => number;
  }) {
    this.summaries = shared?.summaries ?? new Map();
    this.details = shared?.details ?? new Map();
    this.leaseStore = shared?.leaseStore ?? null;
    this.now = shared?.now ?? (() => Date.now());
  }

  private notify() {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  private verifyFence(expectedFence?: ExpectedExecutionFence): void {
    // Plain in-memory repositories are also used for unit tests that exercise
    // persistence without a lease. When a shared lease store is injected, the
    // check is strict and mirrors the Dexie transaction contract.
    if (!expectedFence || !this.leaseStore) return;
    assertLeaseFence(this.leaseStore.lease, expectedFence, this.now());
  }

  async create(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedFence?: ExpectedExecutionFence,
  ): Promise<void> {
    if (record.id !== summary.id) {
      throw new StorageError(
        "validation",
        `Record ID "${record.id}" does not match summary ID "${summary.id}"`,
      );
    }
    if (record.revision !== summary.revision) {
      throw new StorageError(
        "validation",
        `Record revision ${record.revision} does not match summary revision ${summary.revision}`,
      );
    }
    this.verifyFence(expectedFence);
    if (this.summaries.has(record.id))
      throw new StorageError("conflict", `Run ${record.id} already exists`);
    // Deep-clone on write: Dexie structured-clones at the storage boundary,
    // and this test double must mirror that isolation. Storing the caller's
    // object by reference lets later in-memory mutations (e.g. the record
    // builder's revision bump) leak into "stored" state and masks CAS bugs
    // that fail against the real repository.
    this.summaries.set(
      record.id,
      structuredClone({ ...summary, searchText: normalizeSearchText(summary) }),
    );
    this.details.set(record.id, structuredClone(record));
    this.notify();
  }

  async update(
    record: RunRecordV2,
    summary: FullRunSummaryV2,
    expectedRevision: number,
    expectedFence?: ExpectedExecutionFence,
  ): Promise<number> {
    const compatible = compatibleRecord(record);
    if (!compatible) throw new StorageError("validation", "Invalid run record");
    if (record.id !== summary.id) {
      throw new StorageError(
        "validation",
        `Record ID "${record.id}" does not match summary ID "${summary.id}"`,
      );
    }
    this.verifyFence(expectedFence);
    const existing = this.details.get(record.id);
    if (!existing) throw new StorageError("conflict", `Run ${record.id} not found`);
    if (existing.revision !== expectedRevision)
      throw new StorageError("conflict", "Stale revision");
    if (TERMINAL_STATUSES.has(existing.status) && compatible.status === "running") {
      throw new StorageError(
        "validation",
        `Cannot regress terminal status "${existing.status}" to "running" (run ${record.id})`,
      );
    }
    const newRevision = expectedRevision + 1;
    this.summaries.set(
      record.id,
      structuredClone({
        ...summary,
        revision: newRevision,
        searchText: normalizeSearchText(summary),
      }),
    );
    this.details.set(compatible.id, structuredClone({ ...compatible, revision: newRevision }));
    this.notify();
    return newRevision;
  }

  async importLegacySummary(summary: LegacyRunSummary): Promise<"created" | "skipped"> {
    if (this.summaries.has(summary.id)) return "skipped";
    this.summaries.set(summary.id, summary);
    this.notify();
    return "created";
  }

  async get(id: string): Promise<RunRecordV2 | null> {
    const record = compatibleRecord(this.details.get(id));
    // Deep-clone on read so callers cannot mutate stored state through the
    // returned reference (mirrors Dexie structured-clone reads).
    return record ? structuredClone(record) : null;
  }

  async list(query: RunListQuery): Promise<RunSummary[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const all = [...this.summaries.values()]
      .filter((s) => {
        if (query.text) {
          const q = query.text.toLowerCase();
          const st = "searchText" in s ? s.searchText : "";
          if (!st.toLowerCase().includes(q)) return false;
        }
        if (query.modelKey && !s.modelKeys.includes(query.modelKey)) return false;
        if (query.source) {
          if (query.source === "legacy" && s.kind !== "legacy") return false;
          if (query.source === "adhoc" && (s.kind !== "full" || s.source.kind !== "adhoc"))
            return false;
          if (
            query.source === "experiment" &&
            (s.kind !== "full" || s.source.kind !== "experiment")
          )
            return false;
        }
        if (query.status && (s.kind !== "full" || s.status !== query.status)) return false;
        if (query.mode && (s.kind !== "full" || s.mode !== query.mode)) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return all.slice(offset, offset + limit);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async exportAll(): Promise<RunArchiveV1> {
    return {
      schemaVersion: 1,
      exportedAt: Date.now(),
      runs: [...this.details.values()]
        .map((record) => compatibleRecord(record))
        .filter((record): record is RunRecordV2 => record !== null),
      summaries: [...this.summaries.values()],
    };
  }

  async importArchive(archive: RunArchiveV1): Promise<RunImportResult> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    const summariesById = new Map<string, FullRunSummaryV2>();
    const legacySummaries: LegacyRunSummary[] = [];

    for (const s of archive.summaries) {
      if (isFullRunSummaryV2(s)) summariesById.set(s.id, s);
      else if (isLegacyRunSummary(s)) legacySummaries.push(s);
      else errors.push("Invalid summary");
    }

    for (const record of archive.runs) {
      if (!isRunRecordV2(record)) {
        errors.push("Invalid run record");
        continue;
      }
      const summary = summariesById.get(record.id);
      if (!summary) {
        errors.push(`No summary for run ${record.id}`);
        continue;
      }
      if (this.summaries.has(record.id)) {
        skipped++;
        continue;
      }
      this.summaries.set(record.id, { ...summary, searchText: normalizeSearchText(summary) });
      this.details.set(record.id, record);
      imported++;
    }

    for (const legacy of legacySummaries) {
      if (this.summaries.has(legacy.id)) {
        skipped++;
        continue;
      }
      this.summaries.set(legacy.id, legacy);
      imported++;
    }

    if (imported > 0) this.notify();
    return { imported, skipped, errors };
  }
}
