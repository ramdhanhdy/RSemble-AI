// =============================================================================
// Run history persistence (localStorage-backed).
//
// Model identity is provider-scoped: stats and winner keys use the composite
// `${providerId}:${slug}` form so identical slugs from different providers
// (e.g. "z-ai/glm-5.2" on OpenRouter vs Umans) don't collide.
//
// Legacy entries (pre-provider-scoping) used bare slug keys. They are tolerated
// on read: bare keys are migrated to composite keys when the provider can be
// inferred, and unmatched bare keys are preserved without crashing.
// =============================================================================

const STORAGE_KEY = "rsemble.runHistory.v1";
const MAX_RUNS = 200;

export interface ModelRunStats {
  score: number;
  latencyMs: number;
  costUsd: number | null;
}

export interface RunHistoryEntry {
  taskExcerpt: string;
  models: string[];
  stats: Record<string, ModelRunStats>;
  winner: string;
  timestamp: number;
}

export interface ModelTelemetry {
  winRate: number;
  avgScore: number;
  runCount: number;
  avgLatencyMs: number;
  avgCostUsd: number | null;
}

/** Build a provider-scoped composite key from providerId and slug. */
export function modelKey(providerId: string, slug: string): string {
  return `${providerId}:${slug}`;
}

/**
 * Try to infer a providerId from a bare slug (legacy history entries).
 * Returns the providerId or null if it cannot be determined.
 */
function inferProviderFromSlug(slug: string): string | null {
  // OpenRouter slugs always contain "/"
  if (slug.includes("/")) return "openrouter";
  // Gemini model ids start with "gemini"
  if (slug.startsWith("gemini")) return "gemini";
  // GPT model ids suggest chatgpt-codex
  if (slug.startsWith("gpt")) return "chatgpt-codex";
  return null;
}

/**
 * Migrate a legacy entry's bare-slug keys to composite keys where possible.
 * Entries that can't be migrated are kept as-is (tolerated, not crashed on).
 */
function migrateEntry(entry: RunHistoryEntry): RunHistoryEntry {
  let needsMigration = false;
  for (const key of Object.keys(entry.stats)) {
    if (!key.includes(":")) {
      needsMigration = true;
      break;
    }
  }
  if (entry.winner && !entry.winner.includes(":")) needsMigration = true;

  if (!needsMigration) return entry;

  const newStats: Record<string, ModelRunStats> = {};
  for (const [key, val] of Object.entries(entry.stats)) {
    if (key.includes(":")) {
      newStats[key] = val;
    } else {
      const pid = inferProviderFromSlug(key);
      if (pid) {
        newStats[`${pid}:${key}`] = val;
      } else {
        // Can't infer — keep the bare key so data isn't lost
        newStats[key] = val;
      }
    }
  }

  let newWinner = entry.winner;
  if (entry.winner && !entry.winner.includes(":")) {
    const pid = inferProviderFromSlug(entry.winner);
    if (pid) newWinner = `${pid}:${entry.winner}`;
  }

  return { ...entry, stats: newStats, winner: newWinner };
}

function readRaw(): RunHistoryEntry[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as RunHistoryEntry[]).map(migrateEntry);
  } catch {
    return [];
  }
}

function writeRaw(runs: RunHistoryEntry[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {}
}

export function addRun(entry: RunHistoryEntry): void {
  const runs = readRaw();
  runs.push(entry);
  while (runs.length > MAX_RUNS) {
    runs.shift();
  }
  writeRaw(runs);
}

export function getRuns(limit?: number): RunHistoryEntry[] {
  const runs = readRaw();
  const sorted = [...runs].sort((a, b) => b.timestamp - a.timestamp);
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

/**
 * Get runs that include a specific provider-scoped model.
 * Accepts a composite key (`providerId:slug`) for accurate provider-scoped
 * lookup. Also tolerates a bare slug for backward compatibility (matches any
 * provider), though this is less precise.
 */
export function getRunsForModel(key: string): RunHistoryEntry[] {
  const runs = readRaw();
  const isComposite = key.includes(":");
  return runs
    .filter((r) => {
      if (isComposite) {
        // Composite key: check stats keys and models array
        return key in r.stats || r.models.includes(key);
      }
      // Bare slug (legacy caller): match any provider with this slug
      const slug = key;
      return (
        Object.keys(r.stats).some((k) => k.endsWith(`:${slug}`) || k === slug) ||
        r.models.some((m) => m === slug || m.endsWith(`:${slug}`))
      );
    })
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function clearHistory(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getRunCount(): number {
  return readRaw().length;
}

export function getScoreHistory(key: string, limit = 10): number[] {
  const runs = getRunsForModel(key);
  return runs
    .slice(0, limit)
    .map((r) => r.stats[key]?.score ?? 0)
    .filter((s) => s > 0);
}

export function getModelTelemetry(key: string): ModelTelemetry | null {
  const runs = getRunsForModel(key);
  if (runs.length === 0) return null;

  let wins = 0;
  let scoreSum = 0;
  let latencySum = 0;
  let costSum = 0;
  let costCount = 0;
  let scoredCount = 0;

  for (const run of runs) {
    if (run.winner === key) wins += 1;
    const s = run.stats[key];
    if (s) {
      scoreSum += s.score;
      latencySum += s.latencyMs;
      if (s.costUsd !== null) {
        costSum += s.costUsd;
        costCount += 1;
      }
      scoredCount += 1;
    }
  }

  const runCount = runs.length;
  const denom = scoredCount > 0 ? scoredCount : 1;

  return {
    winRate: wins / runCount,
    avgScore: scoreSum / denom,
    runCount,
    avgLatencyMs: latencySum / denom,
    avgCostUsd: costCount > 0 ? costSum / costCount : null,
  };
}
