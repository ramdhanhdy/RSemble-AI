// =============================================================================
// RSemble AI — Run repository (Dexie-backed)
//
// Implements the RunRepository interface over the RSembleEvaluationDB tables.
// Summary and detail are written atomically in one transaction. Updates use
// compare-and-swap on revision and reject illegal terminal-state regressions.
// Listing never loads detail records; filters are applied before pagination.
// =============================================================================

import type { RSembleEvaluationDB, RunSummaryRow, RunDetailRow } from "./database";
import { StorageError, classifyStorageError } from "./database";
import {
  isFullRunSummaryV2,
  isLegacyRunSummary,
  isRunRecordV2,
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

export interface RunRepository {
  create(record: RunRecordV2, summary: FullRunSummaryV2): Promise<void>;
  update(record: RunRecordV2, summary: FullRunSummaryV2, expectedRevision: number): Promise<number>;
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
    sourceProtocolFingerprint: full?.source.kind === "experiment" ? full.source.protocolFingerprint : null,
    sourceExperimentTaskAttemptId: full?.source.kind === "experiment" ? full.source.experimentTaskAttemptId : null,
    modelKeys: summary.modelKeys,
  };
}

export function createRunRepository(db: RSembleEvaluationDB): RunRepository {
  const listeners = new Set<() => void>();

  function notify() {
    for (const l of listeners) {
      try {
        l();
      } catch {
        // listener errors must not break the repository
      }
    }
  }

  async function create(record: RunRecordV2, summary: FullRunSummaryV2): Promise<void> {
    if (!isRunRecordV2(record)) throw new StorageError("validation", "Invalid run record");
    if (!isFullRunSummaryV2(summary)) throw new StorageError("validation", "Invalid summary");
    if (record.id !== summary.id) {
      throw new StorageError("validation", `Record ID "${record.id}" does not match summary ID "${summary.id}"`);
    }
    if (record.revision !== summary.revision) {
      throw new StorageError("validation", `Record revision ${record.revision} does not match summary revision ${summary.revision}`);
    }
    db.assertWritable();
    try {
      await db.transaction("rw", db.runSummaries, db.runDetails, async () => {
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
  ): Promise<number> {
    if (!isRunRecordV2(record)) throw new StorageError("validation", "Invalid run record");
    if (!isFullRunSummaryV2(summary)) throw new StorageError("validation", "Invalid summary");
    if (record.id !== summary.id) {
      throw new StorageError("validation", `Record ID "${record.id}" does not match summary ID "${summary.id}"`);
    }
    db.assertWritable();

    const newRevision = expectedRevision + 1;
    const updatedRecord: RunRecordV2 = { ...record, revision: newRevision };
    try {
      await db.transaction("rw", db.runSummaries, db.runDetails, async () => {
        const existingDetail = await db.runDetails.get(record.id);
        if (!existingDetail) throw new StorageError("conflict", `Run ${record.id} not found`);
        if (existingDetail.revision !== expectedRevision) {
          throw new StorageError("conflict", `Stale revision: expected ${expectedRevision}, got ${existingDetail.revision}`);
        }

        // Reject illegal terminal-state regressions to "running".
        if (
          TERMINAL_STATUSES.has(existingDetail.status) &&
          record.status === "running"
        ) {
          throw new StorageError(
            "validation",
            `Cannot regress terminal status "${existingDetail.status}" to "running"`,
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
          createdAt: record.createdAt,
          status: record.status,
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
    if (!isLegacyRunSummary(summary)) throw new StorageError("validation", "Invalid legacy summary");
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
      const record = row.record;
      return isRunRecordV2(record) ? record : null;
    } catch (err) {
      throw classifyStorageError(err);
    }
  }

  async function list(query: RunListQuery): Promise<RunSummary[]> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    try {
      let collection = db.runSummaries.orderBy("createdAt").reverse();

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
        const r = row.record;
        if (isRunRecordV2(r)) runs.push(r);
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
    if (!isRunArchiveV1(archive)) throw new StorageError("validation", "Invalid archive");
    db.assertWritable();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Pair detail records with their same-ID full summaries.
    const summariesById = new Map<string, FullRunSummaryV2>();
    const legacySummaries: LegacyRunSummary[] = [];

    for (const s of archive.summaries) {
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
      for (const record of archive.runs) {
        if (!isRunRecordV2(record)) {
          errors.push(`Invalid run record: ${typeof record === "object" && record !== null ? (record as { id?: unknown }).id ?? "unknown" : "unknown"}`);
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

  /** Optional shared maps let a test harness back an InMemoryRunRepository
   *  and an InMemoryExperimentStore with the same tables — mirroring the
   *  single-Dexie-DB production wiring. */
  constructor(shared?: {
    summaries?: Map<string, RunSummary>;
    details?: Map<string, RunRecordV2>;
  }) {
    this.summaries = shared?.summaries ?? new Map();
    this.details = shared?.details ?? new Map();
  }

  private notify() {
    for (const l of this.listeners) {
      try { l(); } catch { /* ignore */ }
    }
  }

  async create(record: RunRecordV2, summary: FullRunSummaryV2): Promise<void> {
    if (record.id !== summary.id) {
      throw new StorageError("validation", `Record ID "${record.id}" does not match summary ID "${summary.id}"`);
    }
    if (record.revision !== summary.revision) {
      throw new StorageError("validation", `Record revision ${record.revision} does not match summary revision ${summary.revision}`);
    }
    if (this.summaries.has(record.id)) throw new StorageError("conflict", `Run ${record.id} already exists`);
    this.summaries.set(record.id, { ...summary, searchText: normalizeSearchText(summary) });
    this.details.set(record.id, record);
    this.notify();
  }

  async update(record: RunRecordV2, summary: FullRunSummaryV2, expectedRevision: number): Promise<number> {
    if (record.id !== summary.id) {
      throw new StorageError("validation", `Record ID "${record.id}" does not match summary ID "${summary.id}"`);
    }
    const existing = this.details.get(record.id);
    if (!existing) throw new StorageError("conflict", `Run ${record.id} not found`);
    if (existing.revision !== expectedRevision) throw new StorageError("conflict", "Stale revision");
    if (TERMINAL_STATUSES.has(existing.status) && record.status === "running") {
      throw new StorageError("validation", "Cannot regress terminal status to running");
    }
    const newRevision = expectedRevision + 1;
    this.summaries.set(record.id, { ...summary, revision: newRevision, searchText: normalizeSearchText(summary) });
    this.details.set(record.id, { ...record, revision: newRevision });
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
    return this.details.get(id) ?? null;
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
          if (query.source === "adhoc" && (s.kind !== "full" || s.source.kind !== "adhoc")) return false;
          if (query.source === "experiment" && (s.kind !== "full" || s.source.kind !== "experiment")) return false;
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
      runs: [...this.details.values()],
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
      if (!isRunRecordV2(record)) { errors.push("Invalid run record"); continue; }
      const summary = summariesById.get(record.id);
      if (!summary) { errors.push(`No summary for run ${record.id}`); continue; }
      if (this.summaries.has(record.id)) { skipped++; continue; }
      this.summaries.set(record.id, { ...summary, searchText: normalizeSearchText(summary) });
      this.details.set(record.id, record);
      imported++;
    }

    for (const legacy of legacySummaries) {
      if (this.summaries.has(legacy.id)) { skipped++; continue; }
      this.summaries.set(legacy.id, legacy);
      imported++;
    }

    if (imported > 0) this.notify();
    return { imported, skipped, errors };
  }
}
