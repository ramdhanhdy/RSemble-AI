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
//    execution): an unexpired foreign lease skips the run.
//
// This module never mutates source records and never invokes a provider.
// =============================================================================

import { type RSembleEvaluationDB } from "./database";
import { type EvidenceRepository } from "./evidence-repository";
import { EVIDENCE_RULE_VERSION } from "../evidence/evidence-eligibility";
import {
  deriveObservationsForSource,
  type DerivationSourceRef,
  type EvaluationSourceResolver,
  type TaskIdentityResolver,
} from "../evidence/derive-observations";
import type { VerifierOutcome } from "../evaluations/fusion-study-types";
import type { ObservationSourceKind } from "../evidence/evidence-types";
import type { RunStatus, RunSummary } from "./run-types";
import { classifyStorageError } from "./database";

// --- Source enumeration ----------------------------------------------------------

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
   * "foreign-held" when an unexpired lease owned by another owner exists at
   * check time; otherwise writes `{ ownerId, expiresAt }` and returns
   * "acquired".
   */
  tryAcquireLease(
    key: string,
    ownerId: string,
    expiresAt: number,
    now: number,
  ): Promise<"acquired" | "foreign-held">;
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
        if (isLeaseRecord(held) && held.expiresAt > now && held.ownerId !== ownerId) {
          return "foreign-held";
        }
        await db.storageMeta.put({ key, value: { ownerId, expiresAt } });
        return "acquired";
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
  verifierOutcomes?: VerifierOutcome[];
  now?: () => number;
  leaseTtlMs?: number;
  ownerId?: string;
}

export type ReindexRunResult =
  | { skipped: true; reason: string }
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
async function inventoryComparisonSource(
  deps: ReindexDeps,
  source: ReindexSource,
): Promise<void> {
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
 * at the current revision (marker-after-verify). Never mutates source records
 * and never invokes a provider.
 */
export async function reindexEvidence(deps: ReindexDeps): Promise<ReindexRunResult> {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.leaseTtlMs ?? 5 * 60_000;
  const ownerId = deps.ownerId ?? "reindex-owner";

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
            verifierOutcomes: deps.verifierOutcomes,
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
    await deps.meta.delete(REINDEX_LEASE_KEY);
  }
}
