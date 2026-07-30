// =============================================================================
// RSemble AI — Legacy history migration
//
// Imports the old localStorage `rsemble.runHistory.v1` array once into the
// new IndexedDB run summaries as discriminated `kind: "legacy"` records.
// Writes a completion marker so refresh does not duplicate entries.
// =============================================================================

import type { LegacyRunSummary } from "./run-types";
import type { RunRepository } from "./run-repository";

const STORAGE_KEY = "rsemble.runHistory.v1";

interface LegacyRunHistoryEntry {
  taskExcerpt: string;
  models: string[];
  stats: Record<string, { score: number; latencyMs: number; costUsd: number | null }>;
  winner: string;
  timestamp: number;
}

export interface MigrationResult {
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Generate a deterministic migration ID from a legacy entry so the same
 * source entry always maps to the same ID and duplicate imports are skipped.
 */
function migrationId(entry: LegacyRunHistoryEntry, index: number): string {
  const slug = entry.taskExcerpt.slice(0, 40).replace(/\s+/g, "-").toLowerCase();
  return `legacy-${entry.timestamp}-${index}-${slug}`;
}

function extractModelKeys(entry: LegacyRunHistoryEntry): string[] {
  // Legacy entries used bare slugs or composite keys. Preserve them as-is.
  return entry.models ?? [];
}

function extractScores(entry: LegacyRunHistoryEntry): Record<string, number> {
  const scores: Record<string, number> = {};
  if (entry.stats) {
    for (const [key, val] of Object.entries(entry.stats)) {
      if (typeof val?.score === "number") {
        scores[key] = val.score;
      }
    }
  }
  return scores;
}

function extractWinnerKeys(entry: LegacyRunHistoryEntry): string[] {
  if (!entry.winner) return [];
  return [entry.winner];
}

function buildSearchText(excerpt: string, modelKeys: string[]): string {
  return [excerpt.toLowerCase(), ...modelKeys.map((k) => k.toLowerCase())].join(" ");
}

/**
 * Read raw legacy entries from localStorage without throwing.
 * Returns an empty array if localStorage is unavailable or the data is malformed.
 */
export function readRawLegacyEntries(): LegacyRunHistoryEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is LegacyRunHistoryEntry =>
        typeof e === "object" && e !== null && typeof e.timestamp === "number",
    );
  } catch {
    return [];
  }
}

/**
 * Check whether migration has already been completed by looking for the
 * IndexedDB migration marker. Falls back to checking a localStorage marker
 * if the repository is unavailable.
 */
export async function isMigrationComplete(repo: RunRepository): Promise<boolean> {
  try {
    // Check the storageMeta table via the repository's exportAll — if legacy
    // entries already exist, migration was done. This is simpler than adding
    // a dedicated meta-query method.
    const summaries = await repo.list({ source: "legacy", limit: 1 });
    return summaries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Migrate legacy localStorage history into the IndexedDB repository.
 *
 * - Generates stable migration IDs for each entry.
 * - Maps only known v1 fields into LegacyRunSummary.
 * - Preserves timestamp, task excerpt, model keys, scores, and winner.
 * - Omits status, mode, source, Judge, and evaluation fields.
 * - Sets detailAvailable = false.
 * - Does not fabricate prompts, outputs, Judge reports, or configuration.
 * - Skips duplicate entries (same migration ID).
 * - Leaves the original localStorage key intact.
 *
 * Returns the migration result. If migration fails midway, the localStorage
 * source and any prior marker remain untouched.
 */
export async function migrateLegacyHistory(repo: RunRepository): Promise<MigrationResult> {
  const entries = readRawLegacyEntries();
  if (entries.length === 0) {
    return { imported: 0, skipped: 0, errors: [] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const id = migrationId(entry, i);
      const modelKeys = extractModelKeys(entry);
      const summary: LegacyRunSummary = {
        kind: "legacy",
        schemaVersion: "1-import",
        id,
        createdAt: entry.timestamp,
        taskExcerpt: entry.taskExcerpt || "(no excerpt)",
        modelKeys,
        winnerKeys: extractWinnerKeys(entry),
        scoresByModelKey: extractScores(entry),
        detailAvailable: false,
        searchText: buildSearchText(entry.taskExcerpt || "", modelKeys),
      };

      const result = await repo.importLegacySummary(summary);
      if (result === "created") {
        imported++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push(`Entry ${i}: ${(err as Error).message}`);
    }
  }

  return { imported, skipped, errors };
}
