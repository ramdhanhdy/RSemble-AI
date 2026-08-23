// =============================================================================
// RSemble AI — Migration registry (Child 10 Task 8, spec §4)
//
// Single orchestration point for every child migration. Each migration is
// wrapped — never rewritten — as a MigrationStep with a uniform
// inspect/apply/verify lifecycle, and the registry drives them in dependency
// order behind one multi-tab owner lease:
//
//  - startup runs a lightweight inspection, then executes blocking steps in
//    topological order; background steps defer until runBackground();
//  - an interrupted step resumes from a persisted cursor, never from scratch;
//  - the per-step completion record is written only after verify() passes —
//    a failed verify leaves no marker so the next startup retries honestly;
//  - concurrent tabs coordinate through a storageMeta owner lease: the
//    non-owner tab sees read-only progress and never applies concurrently;
//  - the startup inspection budget is measured and reported.
// =============================================================================

import { classifyStorageError, type RSembleEvaluationDB } from "./database";
import { createRunRepository } from "./run-repository";
import {
  isMigrationComplete,
  migrateLegacyHistory,
  readRawLegacyEntries,
} from "./legacy-history-migration";
import {
  canonicalTaskMigrationMarkerKey,
  migrateEmbeddedLegacyTasks,
} from "./canonical-task-migration";
import { migrateSuitesToTaskSets, taskSetMigrationMarkerKey } from "./task-set-migration";
import {
  comparisonResultMigrationMarkerKey,
  migrateComparisonResults,
} from "./comparison-result-migration";
import {
  ensureFusionToResearchLabMigration,
  getFusionToResearchLabReceipt,
} from "../migrations/fusion-to-research-lab";
import { isFusionToResearchLabReceipt } from "../migrations/fusion-to-research-lab-receipt";
import { createSearchIndexRepository } from "./search-index-repository";
import {
  createDexieSearchReindexMetaStore,
  createDexieSearchSourceResolver,
  rebuildSearchIndexWithLease,
} from "../search/search-reindex";

// --- Lifecycle contracts ------------------------------------------------------

/** Opaque resume position persisted between interrupted apply passes. */
export interface MigrationCursor {
  position: string | null;
}

/** Lightweight startup check: does this step have pending work? */
export interface MigrationInspection {
  needed: boolean;
  blocking?: boolean;
  detail?: string;
}

/** Result of one apply pass. done:false must carry a resumable cursor. */
export interface MigrationProgress {
  done: boolean;
  processed?: number;
  cursor?: MigrationCursor | null;
  detail?: string;
}

/** Post-apply confirmation. The completion marker follows only ok:true. */
export interface MigrationVerification {
  ok: boolean;
  detail?: string;
}

export interface MigrationStep {
  id: string;
  version: number;
  dependencies: string[];
  /** Blocking steps gate registry readiness; background steps defer. */
  blocking: boolean;
  inspect(): Promise<MigrationInspection>;
  apply(cursor: MigrationCursor): Promise<MigrationProgress>;
  verify(): Promise<MigrationVerification>;
}

// --- Reports ------------------------------------------------------------------

export type MigrationStepStatus =
  | "pending"
  | "complete"
  | "failed"
  | "deferred"
  | "blocked-dependency"
  | "skipped-owner";

export interface MigrationStepState {
  id: string;
  blocking: boolean;
  status: MigrationStepStatus;
  detail?: string;
  progress?: MigrationProgress;
}

export interface MigrationRunReport {
  /** True when this tab owned the migration lease for the run. */
  owner: boolean;
  /** True when every blocking step is verified complete. */
  ready: boolean;
  steps: MigrationStepState[];
  errors: string[];
  /** Measured startup planning/inspection budget. */
  inspectionMs: number;
}

export interface MigrationInspectionEntry {
  id: string;
  blocking: boolean;
  needed: boolean;
  complete: boolean;
  detail?: string;
}

export interface MigrationInspectionReport {
  steps: MigrationInspectionEntry[];
  errors: string[];
  inspectionMs: number;
}

export interface MigrationVerifyStepReport {
  id: string;
  needed: boolean;
  verified: boolean;
  detail?: string;
}

export interface MigrationVerifyReport {
  ok: boolean;
  steps: MigrationVerifyStepReport[];
}

// --- Registry storage keys ----------------------------------------------------

export const MIGRATION_OWNER_LEASE_KEY = "migration-registry:owner-lease";

export function migrationCompletionKey(stepId: string): string {
  return `migration-registry:complete:${stepId}`;
}

export function migrationCursorKey(stepId: string): string {
  return `migration-registry:cursor:${stepId}`;
}

interface CompletionRecord {
  id: string;
  version: number;
  completedAt: number;
}

function isCompletionRecord(value: unknown): value is CompletionRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.version === "number";
}

function isCursorRecord(value: unknown): value is { position: string | null } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.position === "string" || v.position === null;
}

// --- Dependency planning --------------------------------------------------------

export class MigrationRegistryError extends Error {
  readonly kind: "missing-dependency" | "cycle";
  constructor(kind: "missing-dependency" | "cycle", message: string) {
    super(message);
    this.name = "MigrationRegistryError";
    this.kind = kind;
  }
}

/**
 * Deterministic topological order (Kahn's algorithm, input-order tie-break).
 * A dependency id with no registered step, or a dependency cycle, is a hard
 * error — never a silent skip.
 */
export function planMigrationSteps(steps: readonly MigrationStep[]): MigrationStep[] {
  const byId: Record<string, MigrationStep> = {};
  for (const step of steps) {
    byId[step.id] = step;
  }
  for (const step of steps) {
    for (const dep of step.dependencies) {
      if (!(dep in byId)) {
        throw new MigrationRegistryError(
          "missing-dependency",
          `Migration step "${step.id}" depends on missing step "${dep}"`,
        );
      }
    }
  }

  const planned: MigrationStep[] = [];
  const satisfied: Record<string, true> = {};
  const remaining = [...steps];
  while (remaining.length > 0) {
    const index = remaining.findIndex((step) =>
      step.dependencies.every((dep) => satisfied[dep] === true),
    );
    if (index === -1) {
      const stuck = remaining.map((s) => s.id).join(", ");
      throw new MigrationRegistryError(
        "cycle",
        `Migration dependency cycle detected among: ${stuck}`,
      );
    }
    const [next] = remaining.splice(index, 1);
    planned.push(next);
    satisfied[next.id] = true;
  }
  return planned;
}

// --- Registry -------------------------------------------------------------------

export interface MigrationRegistryOptions {
  db: RSembleEvaluationDB;
  /** Step override for tests; defaults to the production child migrations. */
  steps?: MigrationStep[];
  ownerId?: string;
  now?: () => number;
  leaseTtlMs?: number;
}

export interface MigrationRunOptions {
  onProgress?: (state: MigrationStepState) => void;
}

export interface MigrationRegistry {
  inspect(): Promise<MigrationInspectionReport>;
  /** Execute every blocking step in dependency order. Background steps defer. */
  run(options?: MigrationRunOptions): Promise<MigrationRunReport>;
  /** Execute deferred background steps, reporting per-step progress. */
  runBackground(options?: MigrationRunOptions): Promise<MigrationRunReport>;
  /** Read-only verify of every step: no apply, no marker writes. */
  verify(): Promise<MigrationVerifyReport>;
}

export function createMigrationRegistry(options: MigrationRegistryOptions): MigrationRegistry {
  const { db } = options;
  const steps = options.steps ?? createDefaultMigrationSteps(db);
  const meta = createDexieSearchReindexMetaStore(db);
  const now = options.now ?? (() => Date.now());
  const leaseTtlMs = options.leaseTtlMs ?? 30_000;
  const ownerId =
    options.ownerId ??
    `migration-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  async function readCompletion(stepId: string): Promise<CompletionRecord | null> {
    const row = await db.storageMeta.get(migrationCompletionKey(stepId));
    return row && isCompletionRecord(row.value) ? row.value : null;
  }

  async function writeCompletion(step: MigrationStep): Promise<void> {
    await db.storageMeta.put({
      key: migrationCompletionKey(step.id),
      value: { id: step.id, version: step.version, completedAt: now() },
    });
  }

  async function readCursor(stepId: string): Promise<MigrationCursor> {
    const row = await db.storageMeta.get(migrationCursorKey(stepId));
    if (row && isCursorRecord(row.value)) return { position: row.value.position };
    return { position: null };
  }

  async function writeCursor(stepId: string, cursor: MigrationCursor): Promise<void> {
    await db.storageMeta.put({ key: migrationCursorKey(stepId), value: { position: cursor.position } });
  }

  async function clearCursor(stepId: string): Promise<void> {
    await db.storageMeta.delete(migrationCursorKey(stepId));
  }

  function failureDetail(err: unknown): string {
    return classifyStorageError(err).message;
  }

  /**
   * One step lifecycle: skip when the completion record matches the step
   * version; otherwise inspect, adopt already-applied state via verify, or
   * apply from the persisted cursor and mark completion only after verify.
   */
  async function runStep(step: MigrationStep): Promise<MigrationStepState> {
    const base = { id: step.id, blocking: step.blocking };
    const completion = await readCompletion(step.id);
    if (completion && completion.version === step.version) {
      return { ...base, status: "complete", detail: "already complete" };
    }

    let inspection: MigrationInspection;
    try {
      inspection = await step.inspect();
    } catch (err) {
      return { ...base, status: "failed", detail: failureDetail(err) };
    }

    if (!inspection.needed) {
      try {
        const verification = await step.verify();
        if (verification.ok) {
          await writeCompletion(step);
          await clearCursor(step.id);
          return { ...base, status: "complete", detail: inspection.detail };
        }
        // Inspect said idle but verify disagrees: fall through to apply so the
        // step repairs itself instead of being marked complete on trust.
      } catch (err) {
        return { ...base, status: "failed", detail: failureDetail(err) };
      }
    }

    const cursor = await readCursor(step.id);
    let progress: MigrationProgress;
    try {
      progress = await step.apply(cursor);
    } catch (err) {
      return { ...base, status: "failed", detail: failureDetail(err) };
    }

    if (!progress.done) {
      await writeCursor(step.id, progress.cursor ?? { position: null });
      return { ...base, status: "pending", progress, detail: progress.detail };
    }

    try {
      const verification = await step.verify();
      if (!verification.ok) {
        // Marker timing: no completion record without a passing verify.
        return {
          ...base,
          status: "failed",
          progress,
          detail: verification.detail ?? "verification failed",
        };
      }
    } catch (err) {
      return { ...base, status: "failed", progress, detail: failureDetail(err) };
    }

    await writeCompletion(step);
    await clearCursor(step.id);
    return { ...base, status: "complete", progress, detail: progress.detail };
  }

  /** Read-only per-step states for a tab that does not own the lease. */
  async function readOnlyStates(planned: MigrationStep[]): Promise<MigrationStepState[]> {
    const states: MigrationStepState[] = [];
    for (const step of planned) {
      const completion = await readCompletion(step.id);
      if (completion && completion.version === step.version) {
        states.push({ id: step.id, blocking: step.blocking, status: "complete" });
      } else {
        states.push({
          id: step.id,
          blocking: step.blocking,
          status: "skipped-owner",
          detail: "migration owned by another tab",
        });
      }
    }
    return states;
  }

  function allBlockingComplete(planned: MigrationStep[], states: MigrationStepState[]): boolean {
    return planned
      .filter((step) => step.blocking)
      .every((step) => states.find((s) => s.id === step.id)?.status === "complete");
  }

  async function execute(
    planned: MigrationStep[],
    phase: "blocking" | "background",
    runOptions: MigrationRunOptions | undefined,
    startedAt: number,
  ): Promise<MigrationRunReport> {
    const acquired = await meta.tryAcquireLease(
      MIGRATION_OWNER_LEASE_KEY,
      ownerId,
      now() + leaseTtlMs,
      now(),
    );
    if (acquired === "foreign-held") {
      const states = await readOnlyStates(planned);
      return {
        owner: false,
        ready: allBlockingComplete(planned, states),
        steps: states,
        errors: [],
        inspectionMs: now() - startedAt,
      };
    }

    try {
      const states: MigrationStepState[] = [];
      const unsatisfied: Record<string, true> = {};
      for (const step of planned) {
        const inPhase = phase === "background" ? !step.blocking : step.blocking;
        if (!inPhase) {
          if (phase === "blocking") {
            states.push({ id: step.id, blocking: step.blocking, status: "deferred" });
          }
          continue;
        }
        const blocked = step.dependencies.some((dep) => unsatisfied[dep] === true);
        if (blocked) {
          states.push({
            id: step.id,
            blocking: step.blocking,
            status: "blocked-dependency",
            detail: "a dependency did not complete",
          });
          unsatisfied[step.id] = true;
          continue;
        }
        const state = await runStep(step);
        states.push(state);
        runOptions?.onProgress?.(state);
        if (state.status !== "complete") {
          unsatisfied[step.id] = true;
        }
      }
      const errors = states
        .filter((s) => s.status === "failed")
        .map((s) => `${s.id}: ${s.detail ?? "failed"}`);
      return {
        owner: true,
        ready:
          phase === "blocking"
            ? allBlockingComplete(planned, states)
            : errors.length === 0 &&
              states.every((s) => s.status === "complete" || s.status === "deferred"),
        steps: states,
        errors,
        inspectionMs: now() - startedAt,
      };
    } finally {
      try {
        await meta.releaseLease(MIGRATION_OWNER_LEASE_KEY, ownerId);
      } catch {
        // best-effort lease release
      }
    }
  }

  function planOrReport(startedAt: number): MigrationStep[] | MigrationRunReport {
    try {
      return planMigrationSteps(steps);
    } catch (err) {
      return {
        owner: false,
        ready: false,
        steps: [],
        errors: [err instanceof Error ? err.message : String(err)],
        inspectionMs: now() - startedAt,
      };
    }
  }

  return {
    async inspect(): Promise<MigrationInspectionReport> {
      const startedAt = now();
      let planned: MigrationStep[];
      try {
        planned = planMigrationSteps(steps);
      } catch (err) {
        return {
          steps: [],
          errors: [err instanceof Error ? err.message : String(err)],
          inspectionMs: now() - startedAt,
        };
      }
      const entries: MigrationInspectionEntry[] = [];
      const errors: string[] = [];
      for (const step of planned) {
        const completion = await readCompletion(step.id);
        if (completion && completion.version === step.version) {
          entries.push({ id: step.id, blocking: step.blocking, needed: false, complete: true });
          continue;
        }
        try {
          const inspection = await step.inspect();
          entries.push({
            id: step.id,
            blocking: step.blocking,
            needed: inspection.needed,
            complete: false,
            detail: inspection.detail,
          });
        } catch (err) {
          errors.push(`${step.id}: ${failureDetail(err)}`);
          entries.push({ id: step.id, blocking: step.blocking, needed: true, complete: false });
        }
      }
      return { steps: entries, errors, inspectionMs: now() - startedAt };
    },

    async run(runOptions?: MigrationRunOptions): Promise<MigrationRunReport> {
      const startedAt = now();
      const planned = planOrReport(startedAt);
      if (!Array.isArray(planned)) return planned;
      return execute(planned, "blocking", runOptions, startedAt);
    },

    async runBackground(runOptions?: MigrationRunOptions): Promise<MigrationRunReport> {
      const startedAt = now();
      const planned = planOrReport(startedAt);
      if (!Array.isArray(planned)) return planned;
      return execute(planned, "background", runOptions, startedAt);
    },

    async verify(): Promise<MigrationVerifyReport> {
      const planned = planMigrationSteps(steps);
      const reports: MigrationVerifyStepReport[] = [];
      for (const step of planned) {
        try {
          const inspection = await step.inspect();
          const verification = await step.verify();
          reports.push({
            id: step.id,
            needed: inspection.needed,
            verified: verification.ok,
            detail: verification.detail ?? inspection.detail,
          });
        } catch (err) {
          reports.push({ id: step.id, needed: true, verified: false, detail: failureDetail(err) });
        }
      }
      return {
        ok: reports.every((r) => r.verified && !r.needed),
        steps: reports,
      };
    },
  };
}

// --- Production step adapters ---------------------------------------------------
//
// Thin MigrationStep adapters over the proven child migrations. No migration
// internals are rewritten here; each adapter defers to the existing entry
// point and treats that migration's own durable marker as the verify source.

async function readMetaValue(db: RSembleEvaluationDB, key: string): Promise<unknown> {
  const row = await db.storageMeta.get(key);
  return row ? row.value : null;
}

function isMarkerValue(value: unknown, kind: string, version: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kind === kind && v.version === version;
}

export function createDefaultMigrationSteps(db: RSembleEvaluationDB): MigrationStep[] {
  const legacyHistory: MigrationStep = {
    id: "legacy-history",
    version: 1,
    dependencies: [],
    blocking: true,
    inspect: async () => {
      const raw = readRawLegacyEntries();
      if (raw.length === 0) return { needed: false, detail: "no legacy history" };
      const complete = await isMigrationComplete(createRunRepository(db));
      return {
        needed: !complete,
        detail: complete ? "legacy history imported" : `${raw.length} legacy entries pending`,
      };
    },
    apply: async () => {
      const result = await migrateLegacyHistory(createRunRepository(db));
      return {
        done: result.errors.length === 0,
        processed: result.imported + result.skipped,
        detail:
          result.errors.length > 0 ? `${result.errors.length} entries failed` : undefined,
      };
    },
    verify: async () => {
      const raw = readRawLegacyEntries();
      if (raw.length === 0) return { ok: true };
      const complete = await isMigrationComplete(createRunRepository(db));
      return { ok: complete, detail: complete ? undefined : "legacy entries not fully imported" };
    },
  };

  const canonicalTasks: MigrationStep = {
    id: "canonical-tasks",
    version: 1,
    dependencies: [],
    blocking: true,
    inspect: async () => ({
      needed: !isMarkerValue(
        await readMetaValue(db, canonicalTaskMigrationMarkerKey),
        "canonical-task-migration",
        1,
      ),
    }),
    apply: async () => {
      const result = await migrateEmbeddedLegacyTasks(db);
      return {
        done: result.complete,
        processed: result.createdVersions + result.crosswalksWritten,
      };
    },
    verify: async () => ({
      ok: isMarkerValue(
        await readMetaValue(db, canonicalTaskMigrationMarkerKey),
        "canonical-task-migration",
        1,
      ),
    }),
  };

  const fusionToResearchLab: MigrationStep = {
    id: "fusion-to-research-lab",
    version: 1,
    dependencies: ["canonical-tasks"],
    blocking: true,
    inspect: async () => ({ needed: (await getFusionToResearchLabReceipt(db)) === null }),
    apply: async () => {
      const receipt = await ensureFusionToResearchLabMigration(db);
      return { done: receipt !== null };
    },
    verify: async () => {
      const receipt = await getFusionToResearchLabReceipt(db);
      return { ok: receipt !== null && isFusionToResearchLabReceipt(receipt) };
    },
  };

  const taskSets: MigrationStep = {
    id: "task-sets",
    version: 1,
    dependencies: ["canonical-tasks"],
    blocking: true,
    inspect: async () => ({
      needed: !isMarkerValue(await readMetaValue(db, taskSetMigrationMarkerKey), "task-set-migration", 1),
    }),
    apply: async () => {
      const result = await migrateSuitesToTaskSets(db);
      return {
        done: result.complete,
        processed: result.createdVersions + result.crosswalksWritten,
      };
    },
    verify: async () => ({
      ok: isMarkerValue(await readMetaValue(db, taskSetMigrationMarkerKey), "task-set-migration", 1),
    }),
  };

  const comparisonResults: MigrationStep = {
    id: "comparison-results",
    version: 1,
    dependencies: ["task-sets"],
    blocking: true,
    inspect: async () => ({
      needed: !isMarkerValue(
        await readMetaValue(db, comparisonResultMigrationMarkerKey),
        "comparison-result-migration",
        1,
      ),
    }),
    apply: async () => {
      const result = await migrateComparisonResults(db);
      return { done: result.complete, processed: result.indexed + result.repaired };
    },
    verify: async () => ({
      ok: isMarkerValue(
        await readMetaValue(db, comparisonResultMigrationMarkerKey),
        "comparison-result-migration",
        1,
      ),
    }),
  };

  // Attention owns no data step: a blocking inspection-only placeholder so the
  // registry's dependency graph covers the Attention surface (spec §4).
  const attention: MigrationStep = {
    id: "attention",
    version: 1,
    dependencies: ["comparison-results"],
    blocking: true,
    inspect: async () => ({ needed: false, detail: "no data step" }),
    apply: async () => ({ done: true }),
    verify: async () => ({ ok: true }),
  };

  const searchIndex: MigrationStep = {
    id: "search-index",
    version: 1,
    dependencies: [
      "legacy-history",
      "canonical-tasks",
      "fusion-to-research-lab",
      "task-sets",
      "comparison-results",
    ],
    blocking: false,
    inspect: async () => {
      const count = await db.searchDocuments.count();
      return { needed: count === 0, detail: `${count} documents indexed` };
    },
    apply: async () => {
      const result = await rebuildSearchIndexWithLease({
        searchRepo: createSearchIndexRepository(db),
        resolver: createDexieSearchSourceResolver(db),
        meta: createDexieSearchReindexMetaStore(db),
      });
      if (result.skipped) {
        return { done: false, detail: `rebuild skipped: ${result.reason}` };
      }
      return {
        done: result.errors.length === 0,
        processed: result.indexedCount,
        detail: result.errors[0],
      };
    },
    verify: async () => {
      const resolver = createDexieSearchSourceResolver(db);
      const sources = resolver.listAllSources ? await resolver.listAllSources() : [];
      const count = await db.searchDocuments.count();
      return {
        ok: sources.length === 0 ? count === 0 : count > 0,
        detail: `${count}/${sources.length} documents indexed`,
      };
    },
  };

  return [
    legacyHistory,
    canonicalTasks,
    fusionToResearchLab,
    taskSets,
    comparisonResults,
    attention,
    searchIndex,
  ];
}

// --- Convenience entry points (diagnostics / resume) -----------------------------

/** Run every blocking step of the production registry (resume from cursors). */
export async function runMigrationRegistry(
  db: RSembleEvaluationDB,
  options?: MigrationRunOptions,
): Promise<MigrationRunReport> {
  return createMigrationRegistry({ db }).run(options);
}

/** Read-only verification of every production migration step. */
export async function verifyMigrationState(db: RSembleEvaluationDB): Promise<MigrationVerifyReport> {
  return createMigrationRegistry({ db }).verify();
}
