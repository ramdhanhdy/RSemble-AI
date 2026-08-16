// =============================================================================
// RSemble AI — Resumable evidence backfill/reindex (spec §11, §13)
//
// Deterministic, resumable backfill over run summaries:
//
//  - sources are enumerated in deterministic order (sourceResultId asc) and
//    each source carries a per-source marker (evidenceIndexJobs row) with its
//    observed source revision — the resumable cursor. A marker is written
//    only AFTER the derivation writes verified (marker-after-verify): an
//    interrupted run simply resumes, skipping nothing that did not complete;
//  - repeated runs are identical: completed sources at the same revision are
//    skipped, and derivation itself is idempotent under the six-part key;
//  - a source revision bump (roster extension / recovery / repair) re-triggers
//    exactly that source; unchanged sources keep their markers;
//  - Compare history receives exploratory source inventory entries
//    (canonical_task_unresolved) and is never merged or fabricated into
//    canonical observations; legacy summary-only sources carry the
//    source_legacy_limited disclosure;
//  - evaluation sources with unresolved canonical Task identity produce
//    explicit indexed limitations, never observations;
//  - the child-02 Fusion Study stores/entities are never touched;
//  - storage quota/unavailable failures are classified onto the owning job
//    row and never delete exact evidence;
//  - cross-tab safety uses a local storage-work lease (separate from paid
//    execution): any unexpired lease blocks acquisition, active passes renew
//    per source (fail-closed on ownership loss), and release is owner-checked
//    so a lapsed owner never deletes a successor's lease.
//
// This module never mutates source records and never invokes a provider.
// =============================================================================

import { classifyStorageError, type RSembleEvaluationDB } from "./database";
import { createEvidenceRepository, type EvidenceRepository } from "./evidence-repository";
import { EVIDENCE_RULE_VERSION } from "../evidence/evidence-eligibility";
import {
  createDerivationQueue,
  createRepositoryVerifierResolver,
  deriveObservationsForSource,
  type DerivationQueue,
  type DerivationQueueOptions,
  type DerivationSourceRef,
  type EvaluationSourceResolver,
  type ModelConfigurationResolver,
  type TaskIdentityResolver,
  type VerifierOutcomeResolver,
} from "../evidence/derive-observations";
import type { RunStatus, RunSummary } from "./run-types";
import type { ObservationSourceKind } from "../evidence/evidence-types";

export interface ReindexSource {
  sourceKind: ObservationSourceKind;
  sourceResultId: string;
  sourceRevision: number;
  runStatus: RunStatus | null;
  /** Only a legacy summary exists (no detail record). */
  legacy: boolean;
  modelKeys: string[];
}

export interface ReindexSourceEnumerator {
  listSources(): Promise<ReindexSource[]>;
}

/** Dexie-backed enumerator over the runSummaries table (deterministic). */
export function createDexieReindexEnumerator(db: RSembleEvaluationDB): ReindexSourceEnumerator {
  return {
    async listSources(): Promise<ReindexSource[]> {
      const rows = await db.runSummaries.toArray();
      const sources: ReindexSource[] = [];
      for (const row of rows) {
        const summary = row.summary as RunSummary;
        if (summary.kind === "legacy") {
          sources.push({
            sourceKind: "comparison",
            sourceResultId: summary.id,
            sourceRevision: 0,
            runStatus: null,
            legacy: true,
            modelKeys: summary.modelKeys,
          });
        } else {
          sources.push({
            sourceKind: summary.source.kind === "experiment" ? "evaluation" : "comparison",
            sourceResultId: summary.id,
            sourceRevision: summary.revision,
            runStatus: summary.status,
            legacy: false,
            modelKeys: summary.modelKeys,
          });
        }
      }
      sources.sort((a, b) => a.sourceResultId.localeCompare(b.sourceResultId));
      return sources;
    },
  };
}

// --- Storage-work meta store + owner lease ----------------------------------------

export interface ReindexMetaStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /**
   * Atomically acquire the storage-work lease: read the current value and
   * write the new lease inside one storage transaction. Returns
   * "foreign-held" when ANY unexpired lease exists at check time — including
   * one recorded under the same owner id, so two runtimes sharing an owner
   * id can never both run the pass; otherwise writes `{ ownerId, expiresAt }`
   * and returns "acquired".
   */
  tryAcquireLease(
    key: string,
    ownerId: string,
    expiresAt: number,
    now: number,
  ): Promise<"acquired" | "foreign-held">;
  /**
   * Owner-checked renewal inside one storage transaction: extends the lease
   * only when the stored record still belongs to `ownerId`. Fail-closed —
   * a missing, foreign, or non-lease record returns "lost" and the caller
   * must stop working.
   */
  renewLease(key: string, ownerId: string, expiresAt: number): Promise<"renewed" | "lost">;
  /**
   * Owner-checked release inside one storage transaction: deletes the lease
   * only when the stored record still belongs to `ownerId`, so an owner
   * whose lease lapsed never deletes a successor's lease.
   */
  releaseLease(key: string, ownerId: string): Promise<"released" | "not-owned">;
}

export const REINDEX_LEASE_KEY = "evidenceReindexLease";

/** Dexie-backed meta store over the storageMeta table. */
export function createDexieReindexMetaStore(db: RSembleEvaluationDB): ReindexMetaStore {
  return {
    async get(key: string): Promise<unknown> {
      const row = await db.storageMeta.get(key);
      return row?.value ?? null;
    },
    async put(key: string, value: unknown): Promise<void> {
      await db.storageMeta.put({ key, value });
    },
    async delete(key: string): Promise<void> {
      await db.storageMeta.delete(key);
    },
    async tryAcquireLease(
      key: string,
      ownerId: string,
      expiresAt: number,
      now: number,
    ): Promise<"acquired" | "foreign-held"> {
      return db.transaction("rw", db.storageMeta, async () => {
        const row = await db.storageMeta.get(key);
        const held = row?.value ?? null;
        if (isLeaseRecord(held) && held.expiresAt > now) {
          // Any unexpired lease blocks acquisition — even the same owner id.
          // Renewal is the only path for an existing owner to extend it.
          return "foreign-held";
        }
        await db.storageMeta.put({ key, value: { ownerId, expiresAt } });
        return "acquired";
      });
    },
    async renewLease(key: string, ownerId: string, expiresAt: number): Promise<"renewed" | "lost"> {
      return db.transaction("rw", db.storageMeta, async () => {
        const row = await db.storageMeta.get(key);
        const held = row?.value ?? null;
        if (!isLeaseRecord(held) || held.ownerId !== ownerId) return "lost";
        await db.storageMeta.put({ key, value: { ownerId, expiresAt } });
        return "renewed";
      });
    },
    async releaseLease(key: string, ownerId: string): Promise<"released" | "not-owned"> {
      return db.transaction("rw", db.storageMeta, async () => {
        const row = await db.storageMeta.get(key);
        const held = row?.value ?? null;
        if (!isLeaseRecord(held) || held.ownerId !== ownerId) return "not-owned";
        await db.storageMeta.delete(key);
        return "released";
      });
    },
  };
}

// --- Reindex -----------------------------------------------------------------------

export interface ReindexDeps {
  evidenceRepo: EvidenceRepository;
  enumerator: ReindexSourceEnumerator;
  resolver: EvaluationSourceResolver;
  meta: ReindexMetaStore;
  identity?: TaskIdentityResolver;
  /** Persisted verifier-outcome resolution for each source lineage (local
   *  read; never executes a verifier or calls a provider). */
  resolveVerifierOutcomes?: VerifierOutcomeResolver;
  /** Executed model identity facts; defaults to unknown (never inferred). */
  resolveModelConfiguration?: ModelConfigurationResolver;
  now?: () => number;
  leaseTtlMs?: number;
  ownerId?: string;
}
export type ReindexRunResult =
  | { skipped: true; reason: "lease-held" | "lease-lost" }
  | {
      skipped: false;
      sourcesProcessed: number;
      sourcesSkipped: number;
      sourcesFailed: number;
      observations: number;
      limitations: number;
      errors: string[];
    };
interface LeaseRecord {
  ownerId: string;
  expiresAt: number;
}

export function isLeaseRecord(v: unknown): v is LeaseRecord {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as LeaseRecord).ownerId === "string" &&
    typeof (v as LeaseRecord).expiresAt === "number"
  );
}

/** Inventory one Compare source: exploratory entries only, never observations. */
async function inventoryComparisonSource(deps: ReindexDeps, source: ReindexSource): Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const limitations = source.modelKeys.map((key) => `model:${key}:canonical_task_unresolved`);
  if (source.legacy) limitations.push("source:legacy_limited");
  await deps.evidenceRepo.putIndexJob({
    sourceResultId: source.sourceResultId,
    sourceKind: "comparison",
    status: "complete",
    ruleVersion: EVIDENCE_RULE_VERSION,
    sourceRevision: source.sourceRevision,
    updatedAt: now(),
    errorKind: null,
    errorMessage: null,
    summary: {
      observationCount: 0,
      gapCount: 0,
      limitationCount: limitations.length,
      integrityIssues: [],
    },
  });
}

/**
 * Run one deterministic backfill/reindex pass. Sources are processed in
 * sourceResultId order; a source is skipped only when its marker is complete
 * at the current revision (marker-after-verify). The pass renews its
 * owner-checked storage-work lease before every source and stops with
 * `{ skipped: true, reason: "lease-lost" }` the moment ownership is lost;
 * release is owner-checked too. Never mutates source records and never
 * invokes a provider.
 */
export async function reindexEvidence(deps: ReindexDeps): Promise<ReindexRunResult> {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.leaseTtlMs ?? 5 * 60_000;
  const ownerId = deps.ownerId ?? uniqueOwnerId();

  // Local storage-work ownership, separate from paid execution. The
  // check-and-acquire runs inside one storage transaction over the meta
  // store so two tabs cannot both take the lease (spec §13).
  const acquired = await deps.meta.tryAcquireLease(
    REINDEX_LEASE_KEY,
    ownerId,
    now() + ttlMs,
    now(),
  );
  if (acquired === "foreign-held") {
    return { skipped: true, reason: "lease-held" };
  }

  const result = {
    skipped: false as const,
    sourcesProcessed: 0,
    sourcesSkipped: 0,
    sourcesFailed: 0,
    observations: 0,
    limitations: 0,
    errors: [] as string[],
  };

  try {
    const sources = await deps.enumerator.listSources();

    for (const source of sources) {
      // Owner-checked renewal before every source: a pass that outlives its
      // TTL stays exclusive, and one whose lease was lost (expired + taken
      // by a successor) fails closed instead of overlapping the successor.
      const renewed = await deps.meta.renewLease(REINDEX_LEASE_KEY, ownerId, now() + ttlMs);
      if (renewed === "lost") {
        return { skipped: true, reason: "lease-lost" };
      }
      // Non-terminal runs are not yet sources of completed evidence.
      if (source.runStatus === "running") continue;

      const job = await deps.evidenceRepo.getIndexJob(source.sourceResultId);
      if (job && job.status === "complete" && job.sourceRevision === source.sourceRevision) {
        result.sourcesSkipped += 1;
        continue;
      }

      // Attempted from here on: success and failure both count as processed.
      result.sourcesProcessed += 1;

      try {
        if (source.sourceKind === "comparison") {
          await inventoryComparisonSource(deps, source);
          result.limitations += source.modelKeys.length + (source.legacy ? 1 : 0);
          continue;
        }

        const ref: DerivationSourceRef = {
          sourceKind: "evaluation",
          sourceResultId: source.sourceResultId,
          sourceRevision: source.sourceRevision,
        };
        const derivation = await deriveObservationsForSource(
          {
            evidenceRepo: deps.evidenceRepo,
            resolver: deps.resolver,
            identity: deps.identity,
            resolveVerifierOutcomes: deps.resolveVerifierOutcomes,
            resolveModelConfiguration: deps.resolveModelConfiguration,
            now: deps.now,
          },
          ref,
        );
        if (derivation.status !== "complete") {
          await deps.evidenceRepo.putIndexJob({
            sourceResultId: source.sourceResultId,
            sourceKind: "evaluation",
            status: "error",
            ruleVersion: EVIDENCE_RULE_VERSION,
            sourceRevision: source.sourceRevision,
            updatedAt: now(),
            errorKind: derivation.errorKind ?? "indexing-failed",
            errorMessage: derivation.errorMessage ?? "Derivation failed.",
            summary: null,
          });
          result.sourcesFailed += 1;
          result.errors.push(
            `${source.sourceResultId}: ${derivation.errorKind ?? "indexing-failed"}`,
          );
          continue;
        }

        // Marker-after-verify: only a verified write count marks the source
        // complete. Re-read the indexed rows and confirm they match.
        const indexed = await deps.evidenceRepo.listObservationsBySource(
          "evaluation",
          source.sourceResultId,
        );
        if (indexed.length !== derivation.observationCount) {
          await deps.evidenceRepo.putIndexJob({
            sourceResultId: source.sourceResultId,
            sourceKind: "evaluation",
            status: "error",
            ruleVersion: EVIDENCE_RULE_VERSION,
            sourceRevision: source.sourceRevision,
            updatedAt: now(),
            errorKind: "verification-failed",
            errorMessage: `Indexed ${indexed.length} rows but derived ${derivation.observationCount}.`,
            summary: null,
          });
          result.sourcesFailed += 1;
          result.errors.push(`${source.sourceResultId}: verification-failed`);
          continue;
        }

        await deps.evidenceRepo.putIndexJob({
          sourceResultId: source.sourceResultId,
          sourceKind: "evaluation",
          status: "complete",
          ruleVersion: EVIDENCE_RULE_VERSION,
          sourceRevision: source.sourceRevision,
          updatedAt: now(),
          errorKind: null,
          errorMessage: null,
          summary: {
            observationCount: derivation.observationCount,
            gapCount: derivation.gapCount,
            limitationCount: derivation.limitationCount,
            integrityIssues: derivation.integrityIssues,
          },
        });
        result.observations += derivation.observationCount;
        result.limitations += derivation.limitationCount;
      } catch (err) {
        const classified = classifyStorageError(err);
        try {
          await deps.evidenceRepo.putIndexJob({
            sourceResultId: source.sourceResultId,
            sourceKind: source.sourceKind,
            status: "error",
            ruleVersion: EVIDENCE_RULE_VERSION,
            sourceRevision: source.sourceRevision,
            updatedAt: now(),
            errorKind: classified.kind,
            errorMessage: classified.message,
            summary: null,
          });
        } catch {
          // Even the error marker failed — the next run retries this source.
        }
        result.sourcesFailed += 1;
        result.errors.push(`${source.sourceResultId}: ${classified.kind}`);
      }
    }

    return result;
  } finally {
    // Owner-checked release: a pass whose lease lapsed and was taken over
    // by a successor must never delete the successor's lease.
    await deps.meta.releaseLease(REINDEX_LEASE_KEY, ownerId);
  }
}

// --- Production indexing runtime ---------------------------------------------------

/** The composed local evidence-indexing runtime for one database handle:
 *  post-commit derivation queue plus the bounded, lease-guarded reindex pass.
 *  Both resolve persisted verifier outcomes from the same repository-backed
 *  seam and never execute a verifier or call a provider. */
export interface EvidenceIndexingRuntime {
  evidenceRepo: EvidenceRepository;
  derivationQueue: DerivationQueue;
  /** Bounded, deterministic backfill/reindex over current sources. Silent
   *  when no work exists; failures land on the owning index-job rows. */
  reindex: () => Promise<ReindexRunResult>;
}

/**
 * Compose the production evidence-indexing seams (Wave A). The derivation
 * queue covers post-commit sources; `reindex` is the local startup/background
 * migration with the storage-work lease, deterministic cursor, and resume
 * behavior. When `reindexOwnerId` is omitted, a genuinely unique owner id is
 * minted per runtime (per tab/provider instance) and shared by the reindex
 * lease and the queue claims; pass an explicit id for deterministic tests.
 */
export function createEvidenceIndexingRuntime(input: {
  db: RSembleEvaluationDB;
  resolver: EvaluationSourceResolver;
  identity?: TaskIdentityResolver;
  resolveVerifierOutcomes?: VerifierOutcomeResolver;
  resolveModelConfiguration?: ModelConfigurationResolver;
  now?: () => number;
  queueOptions?: DerivationQueueOptions;
  reindexOwnerId?: string;
}): EvidenceIndexingRuntime {
  const evidenceRepo = createEvidenceRepository(input.db);
  const resolveVerifierOutcomes =
    input.resolveVerifierOutcomes ?? createRepositoryVerifierResolver(evidenceRepo);
  const ownerId = input.reindexOwnerId ?? uniqueOwnerId();
  const derivationQueue = createDerivationQueue(
    {
      evidenceRepo,
      resolver: input.resolver,
      identity: input.identity,
      resolveVerifierOutcomes,
      resolveModelConfiguration: input.resolveModelConfiguration,
      now: input.now,
    },
    { ...input.queueOptions, ownerId: input.queueOptions?.ownerId ?? ownerId },
  );
  const reindex = () =>
    reindexEvidence({
      evidenceRepo,
      enumerator: createDexieReindexEnumerator(input.db),
      resolver: input.resolver,
      meta: createDexieReindexMetaStore(input.db),
      identity: input.identity,
      resolveVerifierOutcomes,
      resolveModelConfiguration: input.resolveModelConfiguration,
      now: input.now,
      ownerId,
    });
  return { evidenceRepo, derivationQueue, reindex };
}

/** A genuinely unique owner identity per runtime/tab. Injectable via
 *  `reindexOwnerId` for deterministic tests. */
function uniqueOwnerId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `evidence-owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
