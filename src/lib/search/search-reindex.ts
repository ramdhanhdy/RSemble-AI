// =============================================================================
// RSemble AI — Search reindex & rebuild orchestration (spec §2.4)
//
// Provides:
//  - safe document extractors for all 10 searchable entity types;
//  - incremental indexing queue following source commits;
//  - stale hit verification and repair (re-resolves live source and
//    updates/removes search documents without deleting source records);
//  - resumable full rebuild with cursor and idempotency;
//  - multi-tab lease coordination over storageMeta.
// =============================================================================

import {
  assertSafeString,
  parseSearchDocument,
  SEARCH_INDEX_SCHEMA_VERSION,
  type SearchDocument,
  type SearchDocumentType,
} from "./search-types";
import { foldSearchText } from "./search-query";
import type { SearchIndexRepository } from "../persistence/search-index-repository";
import type { RSembleEvaluationDB } from "../persistence/database";

// --- Tokenization helper -----------------------------------------------------

export function extractTokens(...inputs: (string | undefined | null | string[])[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const input of inputs) {
    if (!input) continue;
    const list = Array.isArray(input) ? input : [input];
    for (const item of list) {
      if (typeof item !== "string" || item.length === 0) continue;
      assertSafeString("input", item);
      const folded = foldSearchText(item);
      const words = folded.split(/[\s_\-./\\:,;!?'"()[\]{}#@&+=<>*^%$~`]+/);
      for (const word of words) {
        if (word.length >= 1 && !seen.has(word)) {
          seen.add(word);
          result.push(word);
          if (result.length >= 50) break;
        }
      }
      if (result.length >= 50) break;
    }
    if (result.length >= 50) break;
  }

  return result;
}

// --- Entity to SearchDocument extractors --------------------------------------

export interface TaskRecordInput {
  id: string;
  revision: number;
  name: string;
  description?: string | null;
  updatedAt: number;
  archivedAt?: number | null;
  origin?: string;
}

export interface TaskVersionInput {
  taskId: string;
  version: number;
  title: string;
  rubricId?: string | null;
  rubricVersion?: number | null;
  createdAt: number;
}

export function taskToSearchDocument(
  task: TaskRecordInput,
  version?: TaskVersionInput | null,
): SearchDocument {
  const title = task.name || version?.title || `Task ${task.id}`;
  const subtitle = task.description || "Canonical Task";
  const tokens = extractTokens(task.id, title, subtitle, task.origin);

  return parseSearchDocument({
    type: "task" as const,
    id: task.id,
    revision: task.revision,
    title,
    subtitle,
    ownerHref: `/tasks/${task.id}`,
    tokens,
    updatedAt: task.updatedAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface TaskSetRecordInput {
  id: string;
  revision: number;
  name: string;
  description?: string | null;
  updatedAt: number;
  archivedAt?: number | null;
  origin?: string;
}

export interface TaskSetVersionInput {
  taskSetId: string;
  version: number;
  name?: string;
  createdAt: number;
}

export function taskSetToSearchDocument(
  taskSet: TaskSetRecordInput,
  version?: TaskSetVersionInput | null,
): SearchDocument {
  const title = taskSet.name || version?.name || `Task Set ${taskSet.id}`;
  const subtitle = taskSet.description || "Task Set";
  const tokens = extractTokens(taskSet.id, title, subtitle, taskSet.origin);

  return parseSearchDocument({
    type: "task_set" as const,
    id: taskSet.id,
    revision: taskSet.revision,
    title,
    subtitle,
    ownerHref: `/task-sets/${taskSet.id}`,
    tokens,
    updatedAt: taskSet.updatedAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface RubricRecordInput {
  id: string;
  revision: number;
  name: string;
  updatedAt: number;
  archivedAt?: number | null;
}

export function rubricToSearchDocument(rubric: RubricRecordInput): SearchDocument {
  const title = rubric.name || `Rubric ${rubric.id}`;
  const subtitle = "Evaluation Rubric";
  const tokens = extractTokens(rubric.id, title, subtitle);

  return parseSearchDocument({
    type: "rubric" as const,
    id: rubric.id,
    revision: rubric.revision,
    title,
    subtitle,
    ownerHref: `/evaluations?rubric=${rubric.id}`,
    tokens,
    updatedAt: rubric.updatedAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface ComparisonRecordInput {
  id: string;
  runId: string;
  status: string;
  mode: string;
  createdAt: number;
  updatedAt?: number;
  revision: number;
  name?: string;
}

export function comparisonToSearchDocument(comparison: ComparisonRecordInput): SearchDocument {
  const title = comparison.name || `Comparison ${comparison.id}`;
  const subtitle = `${comparison.mode} • ${comparison.status}`;
  const tokens = extractTokens(
    comparison.id,
    comparison.runId,
    title,
    comparison.mode,
    comparison.status,
  );

  return parseSearchDocument({
    type: "comparison" as const,
    id: comparison.id,
    revision: comparison.revision,
    title,
    subtitle,
    ownerHref: `/compare/${comparison.id}`,
    tokens,
    updatedAt: comparison.updatedAt ?? comparison.createdAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface EvaluationRecordInput {
  id: string;
  revision: number;
  suiteId?: string;
  suiteVersion?: number;
  protocolFingerprint?: string;
  createdAt: number;
  updatedAt?: number;
  status: string;
  name?: string;
}

export function evaluationToSearchDocument(evaluation: EvaluationRecordInput): SearchDocument {
  const title = evaluation.name || `Evaluation ${evaluation.id}`;
  const subtitle = `Evaluation • ${evaluation.status}`;
  const tokens = extractTokens(evaluation.id, evaluation.suiteId, title, evaluation.status);

  return parseSearchDocument({
    type: "evaluation" as const,
    id: evaluation.id,
    revision: evaluation.revision,
    title,
    subtitle,
    ownerHref: `/evaluations/${evaluation.id}`,
    tokens,
    updatedAt: evaluation.updatedAt ?? evaluation.createdAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface FusionStudyRecordInput {
  id: string;
  kind: string;
  status: string;
  claimLevel: string;
  confirmationOf?: string | null;
  updatedAt: number;
  archivedAt?: number | null;
  name?: string;
  revision?: number;
}

export function fusionStudyToSearchDocument(study: FusionStudyRecordInput): SearchDocument {
  const title = study.name || `Study ${study.id}`;
  const subtitle = `${study.kind} • ${study.claimLevel} • ${study.status}`;
  const tokens = extractTokens(study.id, study.kind, study.claimLevel, study.status, title);

  return parseSearchDocument({
    type: "fusion_study" as const,
    id: study.id,
    revision: study.revision ?? 1,
    title,
    subtitle,
    ownerHref: `/lab/studies/${study.id}`,
    tokens,
    updatedAt: study.updatedAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface ModelConfigurationRecordInput {
  id: string;
  providerId: string;
  requestedModel: string;
  resolvedVersion?: string;
  observedTo: number;
}

export function modelConfigurationToSearchDocument(
  config: ModelConfigurationRecordInput,
): SearchDocument {
  const title = `${config.providerId}/${config.requestedModel}`;
  const subtitle = config.resolvedVersion
    ? `Resolved: ${config.resolvedVersion}`
    : "Model Configuration";
  const tokens = extractTokens(
    config.id,
    config.providerId,
    config.requestedModel,
    config.resolvedVersion,
    title,
  );

  return parseSearchDocument({
    type: "model_configuration" as const,
    id: config.id,
    revision: 1,
    title,
    subtitle,
    ownerHref: `/models/${config.id}`,
    tokens,
    updatedAt: config.observedTo,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface ModelRollupRecordInput {
  id: string;
  name: string;
  latestVersion: number;
  revision: number;
  updatedAt: number;
  archivedAt?: number | null;
}

export function modelRollupToSearchDocument(rollup: ModelRollupRecordInput): SearchDocument {
  const title = rollup.name || `Model Rollup ${rollup.id}`;
  const subtitle = `Model Rollup (v${rollup.latestVersion})`;
  const tokens = extractTokens(rollup.id, title, subtitle);

  return parseSearchDocument({
    type: "model_rollup" as const,
    id: rollup.id,
    revision: rollup.revision,
    title,
    subtitle,
    ownerHref: `/models/rollups/${rollup.id}`,
    tokens,
    updatedAt: rollup.updatedAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface ObservationRecordInput {
  id: string;
  sourceKind: string;
  sourceResultId: string;
  taskId?: string;
  taskInstanceId?: string;
  modelConfigurationId?: string;
  observedAt: number;
}

export function observationToSearchDocument(obs: ObservationRecordInput): SearchDocument {
  const title = `Observation ${obs.id}`;
  const subtitle = `${obs.sourceKind} • ${obs.sourceResultId}`;
  const tokens = extractTokens(
    obs.id,
    obs.sourceKind,
    obs.sourceResultId,
    obs.taskId,
    obs.taskInstanceId,
    obs.modelConfigurationId,
  );

  return parseSearchDocument({
    type: "observation" as const,
    id: obs.id,
    revision: 1,
    title,
    subtitle,
    ownerHref: `/records/observations/${obs.id}`,
    tokens,
    updatedAt: obs.observedAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

export interface RunRecordSummaryInput {
  id: string;
  kind: string;
  revision: number;
  createdAt: number;
  completedAt?: number | null;
  status: string;
  mode: string;
  modelKeys?: string[];
  name?: string;
}

export function recordToSearchDocument(run: RunRecordSummaryInput): SearchDocument {
  const title = run.name || `Run ${run.id}`;
  const subtitle = `${run.mode} • ${run.status}`;
  const tokens = extractTokens(
    run.id,
    run.kind,
    run.mode,
    run.status,
    title,
    ...(run.modelKeys ?? []),
  );

  return parseSearchDocument({
    type: "record" as const,
    id: run.id,
    revision: run.revision,
    title,
    subtitle,
    ownerHref: `/records/${run.id}`,
    tokens,
    updatedAt: run.completedAt ?? run.createdAt,
    indexSchemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
  });
}

// --- Source Resolver & Reindex Queue -----------------------------------------

export interface SearchSourceRef {
  type: SearchDocumentType;
  id: string;
  revision?: number;
}

export interface SearchSourceResolver {
  resolveDocument(ref: { type: SearchDocumentType; id: string }): Promise<SearchDocument | null>;
  listAllSources?(): Promise<SearchDocument[]>;
}

export interface SearchReindexQueue {
  pendingCount: number;
  enqueue(ref: SearchSourceRef): void;
  processQueue(): Promise<number>;
  drain(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function createSearchReindexQueue(deps: {
  searchRepo: SearchIndexRepository;
  resolver: SearchSourceResolver;
}): SearchReindexQueue {
  const pending = new Map<string, SearchSourceRef>();
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // ignore subscriber errors
      }
    }
  }

  function enqueue(ref: SearchSourceRef) {
    pending.set(`${ref.type}:${ref.id}`, ref);
    notify();
  }

  async function processQueue(): Promise<number> {
    if (pending.size === 0) return 0;
    const items = [...pending.values()];
    pending.clear();

    let processed = 0;
    for (const item of items) {
      try {
        const liveDoc = await deps.resolver.resolveDocument({
          type: item.type,
          id: item.id,
        });

        if (liveDoc === null) {
          // Source deleted -> remove from search index (source records stay)
          await deps.searchRepo.deleteDocument(item.type, item.id);
        } else {
          await deps.searchRepo.putDocument(liveDoc);
        }
        processed++;
      } catch {
        // Individual item failure does not crash the entire queue
      }
    }

    notify();
    return processed;
  }

  async function drain(): Promise<void> {
    while (pending.size > 0) {
      await processQueue();
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    get pendingCount() {
      return pending.size;
    },
    enqueue,
    processQueue,
    drain,
    subscribe,
  };
}

// --- Stale Hit Verification & Repair -----------------------------------------

export type StaleHitRepairResult =
  | { status: "fresh"; document: SearchDocument }
  | { status: "repaired"; document: SearchDocument; previousRevision: number }
  | { status: "removed"; document: null; reason: "source_deleted" | "source_unresolved" };

/**
 * Verifies a search result hit against live source records.
 * If fresh, returns the document.
 * If stale (revision mismatch or changed content), repairs the search document in the index and returns it.
 * If deleted/missing, removes the search document from the index and returns null.
 *
 * CRITICAL: Source records in primary repositories are NEVER modified or deleted by this repair.
 */
export async function verifyAndRepairHit(
  ref: SearchSourceRef,
  deps: {
    searchRepo: SearchIndexRepository;
    resolver: SearchSourceResolver;
  },
): Promise<StaleHitRepairResult> {
  const liveDoc = await deps.resolver.resolveDocument({
    type: ref.type,
    id: ref.id,
  });

  if (liveDoc === null) {
    await deps.searchRepo.deleteDocument(ref.type, ref.id);
    return {
      status: "removed",
      document: null,
      reason: "source_deleted",
    };
  }

  if (ref.revision !== undefined && liveDoc.revision === ref.revision) {
    return {
      status: "fresh",
      document: liveDoc,
    };
  }

  // Revision changed or unconfirmed -> update index
  await deps.searchRepo.putDocument(liveDoc);
  return {
    status: "repaired",
    document: liveDoc,
    previousRevision: ref.revision ?? 0,
  };
}

// --- Resumable Full Rebuild --------------------------------------------------

export interface SearchRebuildDeps {
  searchRepo: SearchIndexRepository;
  resolver: SearchSourceResolver;
}

export interface SearchRebuildResult {
  indexedCount: number;
  errors: string[];
}

export async function rebuildSearchIndex(deps: SearchRebuildDeps): Promise<SearchRebuildResult> {
  const errors: string[] = [];
  let sources: SearchDocument[] = [];

  if (deps.resolver.listAllSources) {
    try {
      sources = await deps.resolver.listAllSources();
    } catch (err) {
      // Source enumeration failed: surface the failure and leave the existing
      // index untouched. A partial rebuild must never be reported as success.
      const message = `Failed to list sources: ${err instanceof Error ? err.message : String(err)}`;
      return {
        indexedCount: 0,
        errors: [message],
      };
    }
  }

  const validated: SearchDocument[] = [];
  for (const source of sources) {
    try {
      validated.push(parseSearchDocument(source));
    } catch (err) {
      errors.push(
        `Invalid source ${source.type}:${source.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await deps.searchRepo.clear();
  if (validated.length > 0) {
    await deps.searchRepo.putDocuments(validated);
  }

  return {
    indexedCount: validated.length,
    errors,
  };
}

export interface SearchRebuildChunkDeps {
  searchRepo: SearchIndexRepository;
  resolver: SearchSourceResolver;
  cursor: string | null;
  batchSize: number;
}

export interface SearchRebuildChunkResult {
  processed: number;
  nextCursor: string | null;
  done: boolean;
}

export async function rebuildSearchIndexChunk(
  deps: SearchRebuildChunkDeps,
): Promise<SearchRebuildChunkResult> {
  const isFirstChunk = deps.cursor === null;
  const offset = deps.cursor ? Number.parseInt(deps.cursor, 10) || 0 : 0;
  let allSources: SearchDocument[] = [];

  if (deps.resolver.listAllSources) {
    allSources = await deps.resolver.listAllSources();
  }

  if (isFirstChunk) {
    await deps.searchRepo.clear();
  }

  const chunk = allSources.slice(offset, offset + deps.batchSize);
  const validated = chunk.map((d) => parseSearchDocument(d));

  if (validated.length > 0) {
    await deps.searchRepo.putDocuments(validated);
  }

  const nextOffset = offset + chunk.length;
  const done = nextOffset >= allSources.length;

  return {
    processed: chunk.length,
    nextCursor: done ? null : String(nextOffset),
    done,
  };
}

// --- Multi-tab Lease Coordination --------------------------------------------

export const SEARCH_REINDEX_LEASE_KEY = "searchIndexRebuildLease";

export interface SearchLeaseRecord {
  ownerId: string;
  expiresAt: number;
}

export function isSearchLeaseRecord(v: unknown): v is SearchLeaseRecord {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as SearchLeaseRecord).ownerId === "string" &&
    typeof (v as SearchLeaseRecord).expiresAt === "number"
  );
}

export interface SearchReindexMetaStore {
  get(key: string): Promise<unknown>;
  tryAcquireLease(
    key: string,
    ownerId: string,
    expiresAt: number,
    now: number,
  ): Promise<"acquired" | "foreign-held">;
  renewLease(key: string, ownerId: string, expiresAt: number): Promise<"renewed" | "lost">;
  releaseLease(key: string, ownerId: string): Promise<boolean>;
}

export function createDexieSearchReindexMetaStore(db: RSembleEvaluationDB): SearchReindexMetaStore {
  return {
    async get(key: string): Promise<unknown> {
      const row = await db.storageMeta.get(key);
      return row ? row.value : null;
    },
    async tryAcquireLease(key, ownerId, expiresAt, now): Promise<"acquired" | "foreign-held"> {
      return await db.transaction("rw", db.storageMeta, async () => {
        const existing = await db.storageMeta.get(key);
        if (existing && isSearchLeaseRecord(existing.value)) {
          if (existing.value.ownerId !== ownerId && existing.value.expiresAt > now) {
            return "foreign-held";
          }
        }
        await db.storageMeta.put({
          key,
          value: { ownerId, expiresAt },
        });
        return "acquired";
      });
    },
    async renewLease(key, ownerId, expiresAt): Promise<"renewed" | "lost"> {
      return await db.transaction("rw", db.storageMeta, async () => {
        const existing = await db.storageMeta.get(key);
        if (
          !existing ||
          !isSearchLeaseRecord(existing.value) ||
          existing.value.ownerId !== ownerId
        ) {
          return "lost";
        }
        await db.storageMeta.put({
          key,
          value: { ownerId, expiresAt },
        });
        return "renewed";
      });
    },
    async releaseLease(key, ownerId): Promise<boolean> {
      return await db.transaction("rw", db.storageMeta, async () => {
        const existing = await db.storageMeta.get(key);
        if (existing && isSearchLeaseRecord(existing.value) && existing.value.ownerId === ownerId) {
          await db.storageMeta.delete(key);
          return true;
        }
        return false;
      });
    },
  };
}

export type SearchRebuildLeaseResult =
  | ({ skipped: false } & SearchRebuildResult)
  | { skipped: true; reason: "lease-held" | "lease-lost" };

export async function rebuildSearchIndexWithLease(deps: {
  searchRepo: SearchIndexRepository;
  resolver: SearchSourceResolver;
  meta: SearchReindexMetaStore;
  ownerId?: string;
  leaseTtlMs?: number;
  now?: () => number;
}): Promise<SearchRebuildLeaseResult> {
  const getNow = deps.now ?? (() => Date.now());
  const ttlMs = deps.leaseTtlMs ?? 30_000;
  const ownerId =
    deps.ownerId ??
    `search-reindex-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const acquired = await deps.meta.tryAcquireLease(
    SEARCH_REINDEX_LEASE_KEY,
    ownerId,
    getNow() + ttlMs,
    getNow(),
  );

  if (acquired === "foreign-held") {
    return { skipped: true, reason: "lease-held" };
  }

  try {
    const renewed = await deps.meta.renewLease(SEARCH_REINDEX_LEASE_KEY, ownerId, getNow() + ttlMs);
    if (renewed === "lost") {
      return { skipped: true, reason: "lease-lost" };
    }

    const result = await rebuildSearchIndex({
      searchRepo: deps.searchRepo,
      resolver: deps.resolver,
    });

    return {
      skipped: false,
      ...result,
    };
  } finally {
    try {
      await deps.meta.releaseLease(SEARCH_REINDEX_LEASE_KEY, ownerId);
    } catch {
      // best-effort lease release
    }
  }
}

// --- Production Dexie Search Source Resolver (spec §2.4) -----------------------

function getFieldString(obj: unknown, key: string, fallback = ""): string {
  if (obj && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === "string") return val;
  }
  return fallback;
}

function getFieldOptionalString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === "string") return val;
  }
  return undefined;
}

function getFieldOptionalNumber(obj: unknown, key: string): number | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === "number" && Number.isFinite(val)) return val;
  }
  return undefined;
}

export function createDexieSearchSourceResolver(db: RSembleEvaluationDB): SearchSourceResolver {
  async function resolveDocument(ref: {
    type: SearchDocumentType;
    id: string;
  }): Promise<SearchDocument | null> {
    switch (ref.type) {
      case "task": {
        const task = await db.tasks.get(ref.id);
        if (!task) return null;
        const version = await db.taskVersions.get([ref.id, task.latestVersion]);
        const name = getFieldString(task.record, "name");
        const description = getFieldString(task.record, "description");
        const versionTitle = getFieldString(version?.version_, "title");
        return taskToSearchDocument(
          {
            id: task.id,
            revision: task.revision,
            name,
            description,
            updatedAt: task.updatedAt,
            archivedAt: task.archivedAt,
            origin: task.origin,
          },
          version
            ? {
                taskId: ref.id,
                version: version.version,
                title: versionTitle,
                rubricId: getFieldOptionalString(version.version_, "rubricId"),
                rubricVersion: getFieldOptionalNumber(version.version_, "rubricVersion"),
                createdAt: version.createdAt,
              }
            : null,
        );
      }

      case "task_set": {
        const set = await db.taskSets.get(ref.id);
        if (!set) return null;
        const version = await db.taskSetVersions.get([ref.id, set.latestVersion]);
        const name = getFieldString(set.record, "name");
        const description = getFieldString(set.record, "description");
        const versionName = getFieldString(version?.version_, "name");
        return taskSetToSearchDocument(
          {
            id: set.id,
            revision: set.revision,
            name,
            description,
            updatedAt: set.updatedAt,
            archivedAt: set.archivedAt,
            origin: set.origin,
          },
          version
            ? {
                taskSetId: ref.id,
                version: version.version,
                name: versionName,
                createdAt: version.createdAt,
              }
            : null,
        );
      }

      case "rubric": {
        const rubricRow = await db.profiles.get(ref.id);
        if (!rubricRow) return null;
        const name = getFieldString(
          rubricRow.record,
          "name",
          getFieldString(rubricRow.record, "title"),
        );
        return rubricToSearchDocument({
          id: rubricRow.id,
          revision: rubricRow.revision,
          name,
          updatedAt: rubricRow.updatedAt,
          archivedAt: rubricRow.archivedAt,
        });
      }

      case "comparison": {
        const comp = await db.comparisonResults.get(ref.id);
        if (comp) {
          const compName = getFieldString(comp, "name", comp.title);
          return comparisonToSearchDocument({
            id: comp.id,
            runId: comp.runId,
            status: comp.status,
            mode: comp.mode,
            createdAt: comp.createdAt,
            updatedAt: comp.updatedAt,
            revision: comp.revision ?? 1,
            name: compName,
          });
        }
        const run = await db.runSummaries.get(ref.id);
        if (run && (run.mode === "compare" || run.mode === "rank" || run.kind === "legacy")) {
          const runName = getFieldOptionalString(run.summary, "name");
          return comparisonToSearchDocument({
            id: run.id,
            runId: run.id,
            status: run.status ?? "completed",
            mode: run.mode ?? "compare",
            createdAt: run.createdAt,
            updatedAt: run.completedAt ?? run.createdAt,
            revision: run.revision,
            name: runName,
          });
        }
        return null;
      }

      case "evaluation": {
        const exp = await db.experiments.get(ref.id);
        if (exp) {
          return evaluationToSearchDocument({
            id: exp.id,
            revision: exp.revision,
            suiteId: exp.suiteId,
            suiteVersion: exp.suiteVersion,
            protocolFingerprint: exp.protocolFingerprint,
            createdAt: exp.createdAt,
            status: exp.status,
            name: getFieldOptionalString(exp.experiment, "name"),
          });
        }
        const suite = await db.suites.get(ref.id);
        if (suite) {
          return evaluationToSearchDocument({
            id: suite.id,
            revision: suite.revision,
            suiteId: suite.id,
            suiteVersion: suite.version,
            createdAt: suite.updatedAt,
            status: "ready",
            name: getFieldOptionalString(suite.suite, "name"),
          });
        }
        return null;
      }

      case "fusion_study": {
        const study = await db.studies.get(ref.id);
        if (!study) return null;
        const studyName = getFieldOptionalString(study, "name");
        const claimLevel = getFieldString(study, "claimLevel", "exploratory");
        const confirmationOf = getFieldOptionalString(study, "confirmationOf") ?? null;
        return fusionStudyToSearchDocument({
          id: study.id,
          kind: study.kind ?? "fusion",
          status: study.status ?? "draft",
          claimLevel,
          confirmationOf,
          updatedAt: study.updatedAt,
          archivedAt: study.archivedAt ?? null,
          name: studyName,
          revision: study.revision ?? 1,
        });
      }

      case "model_configuration": {
        const config = await db.modelConfigurations.get(ref.id);
        if (!config) return null;
        return modelConfigurationToSearchDocument({
          id: config.id,
          providerId: config.providerId,
          requestedModel: config.requestedModel,
          resolvedVersion: config.resolvedVersion ?? undefined,
          observedTo: config.observedTo,
        });
      }

      case "model_rollup": {
        const rollup = await db.modelRollups.get(ref.id);
        if (!rollup) return null;
        return modelRollupToSearchDocument({
          id: rollup.id,
          name: rollup.name ?? rollup.id,
          latestVersion: rollup.latestVersion,
          revision: rollup.revision,
          updatedAt: rollup.updatedAt,
          archivedAt: rollup.archivedAt ?? null,
        });
      }

      case "observation": {
        const obs = await db.observations.get(ref.id);
        if (!obs) return null;
        return observationToSearchDocument({
          id: obs.id,
          sourceKind: obs.sourceKind,
          sourceResultId: obs.sourceResultId,
          taskId: obs.taskId,
          taskInstanceId: obs.taskInstanceId,
          modelConfigurationId: obs.modelConfigurationId,
          observedAt: obs.observedAt,
        });
      }

      case "record": {
        const run = await db.runSummaries.get(ref.id);
        if (!run) return null;
        return recordToSearchDocument({
          id: run.id,
          kind: run.kind,
          revision: run.revision,
          createdAt: run.createdAt,
          completedAt: run.completedAt,
          status: run.status ?? "completed",
          mode: run.mode ?? "eval",
          modelKeys: run.modelKeys,
          name: getFieldOptionalString(run.summary, "name"),
        });
      }

      default:
        return null;
    }
  }

  async function listAllSources(): Promise<SearchDocument[]> {
    const results: SearchDocument[] = [];
    const failures: string[] = [];

    // Each searchable source table is enumerated independently so a single
    // table-read failure is reported with context rather than aborting the
    // remaining tables. Per-row extraction failures are likewise recorded
    // with their entity type and id. Any failure is fatal to the rebuild:
    // listAllSources rejects so the caller can leave the existing index
    // untouched instead of committing a partial rebuild as success.
    const tables: ReadonlyArray<{
      label: string;
      type: SearchDocumentType;
      read: () => Promise<ReadonlyArray<{ id: string }>>;
    }> = [
      { label: "tasks", type: "task", read: () => db.tasks.toArray() },
      { label: "taskSets", type: "task_set", read: () => db.taskSets.toArray() },
      // Durable Dexie table `db.profiles` is preserved (storage contract);
      // the searchable entity is the Rubric, so the failure label uses the
      // Rubric term rather than the storage table name.
      { label: "rubrics", type: "rubric", read: () => db.profiles.toArray() },
      {
        label: "comparisonResults",
        type: "comparison",
        read: () => db.comparisonResults.toArray(),
      },
      { label: "experiments", type: "evaluation", read: () => db.experiments.toArray() },
      { label: "studies", type: "fusion_study", read: () => db.studies.toArray() },
      {
        label: "modelConfigurations",
        type: "model_configuration",
        read: () => db.modelConfigurations.toArray(),
      },
      { label: "modelRollups", type: "model_rollup", read: () => db.modelRollups.toArray() },
      { label: "observations", type: "observation", read: () => db.observations.toArray() },
      { label: "runSummaries", type: "record", read: () => db.runSummaries.toArray() },
    ];

    for (const { label, type, read } of tables) {
      let rows: ReadonlyArray<{ id: string }>;
      try {
        rows = await read();
      } catch (err) {
        failures.push(
          `Failed to read ${label}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      for (const row of rows) {
        try {
          const doc = await resolveDocument({ type, id: row.id });
          if (doc) results.push(doc);
        } catch (err) {
          failures.push(
            `Failed to extract ${type}:${row.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `Search source enumeration failed (${failures.length} error${failures.length === 1 ? "" : "s"}): ${failures.join("; ")}`,
      );
    }

    return results;
  }

  return {
    resolveDocument,
    listAllSources,
  };
}
