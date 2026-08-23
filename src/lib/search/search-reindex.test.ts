// =============================================================================
// RSemble AI — Search reindex & rebuild tests (spec §2.4)
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SEARCH_REINDEX_LEASE_KEY,
  createSearchReindexQueue,
  rebuildSearchIndex,
  rebuildSearchIndexChunk,
  rebuildSearchIndexWithLease,
  verifyAndRepairHit,
  taskToSearchDocument,
  taskSetToSearchDocument,
  rubricToSearchDocument,
  comparisonToSearchDocument,
  evaluationToSearchDocument,
  fusionStudyToSearchDocument,
  modelConfigurationToSearchDocument,
  modelRollupToSearchDocument,
  observationToSearchDocument,
  recordToSearchDocument,
  type SearchSourceResolver,
  type SearchReindexMetaStore,
} from "./search-reindex";
import {
  createInMemorySearchIndexRepository,
  createSearchIndexRepository,
  type SearchIndexRepository,
} from "../persistence/search-index-repository";
import { RSembleEvaluationDB } from "../persistence/database";
import type { SearchDocument, SearchDocumentType } from "./search-types";

describe("Search entity extractors", () => {
  it("extracts safe search documents for every searchable entity type", () => {
    // 1. Task
    const taskDoc = taskToSearchDocument(
      {
        id: "task-101",
        revision: 2,
        name: "Evaluate SQL Generation",
        description: "Standard benchmark for text-to-sql",
        updatedAt: 1000,
        archivedAt: null,
        origin: "first-party",
      },
      {
        taskId: "task-101",
        version: 2,
        title: "Evaluate SQL Generation v2",
        rubricId: "rubric-sql",
        rubricVersion: 1,
        createdAt: 1000,
      },
    );
    expect(taskDoc.type).toBe("task");
    expect(taskDoc.id).toBe("task-101");
    expect(taskDoc.revision).toBe(2);
    expect(taskDoc.title).toBe("Evaluate SQL Generation");
    expect(taskDoc.ownerHref).toBe("/tasks/task-101");

    // 2. Task Set
    const setDoc = taskSetToSearchDocument(
      {
        id: "set-201",
        revision: 1,
        name: "Core Reasoning Suite",
        description: "Benchmark reasoning suite",
        updatedAt: 2000,
        archivedAt: null,
        origin: "first-party",
      },
      null,
    );
    expect(setDoc.type).toBe("task_set");
    expect(setDoc.id).toBe("set-201");
    expect(setDoc.ownerHref).toBe("/task-sets/set-201");

    // 3. Rubric
    const rubricDoc = rubricToSearchDocument({
      id: "rubric-1",
      revision: 3,
      name: "Accuracy Rubric",
      updatedAt: 3000,
      archivedAt: null,
    });
    expect(rubricDoc.type).toBe("rubric");
    expect(rubricDoc.id).toBe("rubric-1");

    // 4. Comparison
    const compDoc = comparisonToSearchDocument({
      id: "cmp-401",
      runId: "run-401",
      status: "completed",
      mode: "head-to-head",
      createdAt: 4000,
      updatedAt: 4500,
      revision: 1,
      name: "GPT-4o vs Claude 3.5 Sonnet",
    });
    expect(compDoc.type).toBe("comparison");
    expect(compDoc.id).toBe("cmp-401");
    expect(compDoc.ownerHref).toBe("/compare/cmp-401");

    // 5. Evaluation
    const evalDoc = evaluationToSearchDocument({
      id: "exp-501",
      revision: 1,
      suiteId: "suite-1",
      suiteVersion: 1,
      protocolFingerprint: "fp-501",
      createdAt: 5000,
      status: "completed",
      name: "Prompt Optimization Sweep",
    });
    expect(evalDoc.type).toBe("evaluation");
    expect(evalDoc.id).toBe("exp-501");

    // 6. Fusion Study
    const studyDoc = fusionStudyToSearchDocument({
      id: "study-601",
      kind: "fusion",
      status: "completed",
      claimLevel: "exploratory",
      confirmationOf: null,
      updatedAt: 6000,
      archivedAt: null,
      name: "Iterative Fusion Trial 1",
    });
    expect(studyDoc.type).toBe("fusion_study");
    expect(studyDoc.id).toBe("study-601");

    // 7. Model Configuration
    const configDoc = modelConfigurationToSearchDocument({
      id: "cfg-701",
      providerId: "anthropic",
      requestedModel: "claude-3-5-sonnet",
      resolvedVersion: "20241022",
      observedTo: 7000,
    });
    expect(configDoc.type).toBe("model_configuration");
    expect(configDoc.id).toBe("cfg-701");
    expect(configDoc.title).toBe("anthropic/claude-3-5-sonnet");

    // 8. Model Rollup
    const rollupDoc = modelRollupToSearchDocument({
      id: "rollup-801",
      name: "Sonnet Family Rollup",
      latestVersion: 1,
      revision: 1,
      updatedAt: 8000,
      archivedAt: null,
    });
    expect(rollupDoc.type).toBe("model_rollup");
    expect(rollupDoc.id).toBe("rollup-801");

    // 9. Observation
    const obsDoc = observationToSearchDocument({
      id: "obs-901",
      sourceKind: "evaluation",
      sourceResultId: "run-901",
      taskId: "task-101",
      taskInstanceId: "inst-101",
      modelConfigurationId: "cfg-701",
      observedAt: 9000,
    });
    expect(obsDoc.type).toBe("observation");
    expect(obsDoc.id).toBe("obs-901");

    // 10. Record
    const recordDoc = recordToSearchDocument({
      id: "run-1001",
      kind: "evaluation",
      revision: 1,
      createdAt: 10000,
      completedAt: 10500,
      status: "completed",
      mode: "eval",
      modelKeys: ["anthropic:claude-3-5-sonnet"],
      name: "SQL Generation Benchmark Run",
    });
    expect(recordDoc.type).toBe("record");
    expect(recordDoc.id).toBe("run-1001");
  });

  it("sanitizes text and rejects secret patterns in extractors", () => {
    expect(() =>
      taskToSearchDocument({
        id: "task-bad",
        revision: 1,
        name: "Task with sk-secret123456",
        description: "Bad",
        updatedAt: 1000,
        archivedAt: null,
        origin: "first-party",
      }),
    ).toThrow(/secret/i);
  });
});

describe("SearchReindexQueue (incremental indexing)", () => {
  it("processes enqueued source commits into the search repository", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const sourceStore = new Map<string, SearchDocument>();

    const resolver: SearchSourceResolver = {
      async resolveDocument({ type, id }) {
        return sourceStore.get(`${type}:${id}`) ?? null;
      },
    };

    const queue = createSearchReindexQueue({ searchRepo, resolver });

    // Seed source
    const doc1: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 1,
      title: "Task One",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task", "one"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
    sourceStore.set("task:t1", doc1);

    queue.enqueue({ type: "task", id: "t1", revision: 1 });
    expect(queue.pendingCount).toBe(1);

    const processed = await queue.processQueue();
    expect(processed).toBe(1);
    expect(queue.pendingCount).toBe(0);

    const indexed = await searchRepo.getDocument("task", "t1");
    expect(indexed).toEqual(doc1);
  });

  it("removes document from search index when enqueued source is deleted", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const sourceStore = new Map<string, SearchDocument>();

    const resolver: SearchSourceResolver = {
      async resolveDocument({ type, id }) {
        return sourceStore.get(`${type}:${id}`) ?? null;
      },
    };

    const doc1: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 1,
      title: "Task One",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task", "one"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
    await searchRepo.putDocument(doc1);

    const queue = createSearchReindexQueue({ searchRepo, resolver });

    // Source is not in sourceStore (deleted)
    queue.enqueue({ type: "task", id: "t1" });
    await queue.drain();

    expect(await searchRepo.getDocument("task", "t1")).toBeNull();
  });
});

describe("Stale hit repair and removal (without source deletion)", () => {
  it("returns fresh status when search document matches source revision", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const doc: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 1,
      title: "Task One",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task", "one"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
    await searchRepo.putDocument(doc);

    const resolver: SearchSourceResolver = {
      async resolveDocument({ type, id }) {
        if (type === "task" && id === "t1") return doc;
        return null;
      },
    };

    const result = await verifyAndRepairHit({ type: "task", id: "t1", revision: 1 }, { searchRepo, resolver });
    expect(result.status).toBe("fresh");
    expect(result.document).toEqual(doc);
  });

  it("repairs stale hit when source revision changed, without deleting source", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const oldDoc: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 1,
      title: "Task One Old Title",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task", "old"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
    await searchRepo.putDocument(oldDoc);

    const updatedSourceDoc: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 2,
      title: "Task One Updated Title",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task", "updated"],
      updatedAt: 2000,
      indexSchemaVersion: 1,
    };

    let sourceQueried = false;
    const resolver: SearchSourceResolver = {
      async resolveDocument({ type, id }) {
        if (type === "task" && id === "t1") {
          sourceQueried = true;
          return updatedSourceDoc;
        }
        return null;
      },
    };

    const result = await verifyAndRepairHit({ type: "task", id: "t1", revision: 1 }, { searchRepo, resolver });
    expect(sourceQueried).toBe(true);
    expect(result.status).toBe("repaired");
    expect(result.document).toEqual(updatedSourceDoc);

    const storedInIndex = await searchRepo.getDocument("task", "t1");
    expect(storedInIndex).toEqual(updatedSourceDoc);
  });

  it("removes document from search index when source is deleted, without modifying source stores", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const doc: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 1,
      title: "Task One",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
    await searchRepo.putDocument(doc);

    const resolver: SearchSourceResolver = {
      async resolveDocument() {
        return null; // source deleted
      },
    };

    const result = await verifyAndRepairHit({ type: "task", id: "t1", revision: 1 }, { searchRepo, resolver });
    expect(result.status).toBe("removed");
    expect(result.document).toBeNull();

    expect(await searchRepo.getDocument("task", "t1")).toBeNull();
  });
});

describe("Resumable full rebuild & idempotency", () => {
  function makeSources(count: number): SearchDocument[] {
    const docs: SearchDocument[] = [];
    for (let i = 0; i < count; i++) {
      const type: SearchDocumentType = i % 2 === 0 ? "task" : "evaluation";
      docs.push({
        type,
        id: `id-${i}`,
        revision: 1,
        title: `Entity ${i} title`,
        subtitle: `Subtitle ${i}`,
        ownerHref: `/${type}s/id-${i}`,
        tokens: [`entity${i}`, "shared"],
        updatedAt: 1000 + i,
        indexSchemaVersion: 1,
      });
    }
    return docs;
  }

  it("rebuilds all documents deterministically and produces identical index across N runs", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const sources = makeSources(10);

    const resolver: SearchSourceResolver = {
      async resolveDocument({ type, id }) {
        return sources.find((s) => s.type === type && s.id === id) ?? null;
      },
      async listAllSources() {
        return sources;
      },
    };

    // Run 1
    const res1 = await rebuildSearchIndex({ searchRepo, resolver });
    expect(res1.indexedCount).toBe(10);
    expect(await searchRepo.countDocuments()).toBe(10);
    const docs1 = await searchRepo.listDocuments();

    // Run 2 (repeated identical rebuild)
    const res2 = await rebuildSearchIndex({ searchRepo, resolver });
    expect(res2.indexedCount).toBe(10);
    const docs2 = await searchRepo.listDocuments();

    expect(docs1).toEqual(docs2);

    // Run 3 after clear
    await searchRepo.clear();
    const res3 = await rebuildSearchIndex({ searchRepo, resolver });
    expect(res3.indexedCount).toBe(10);
    const docs3 = await searchRepo.listDocuments();

    expect(docs1).toEqual(docs3);
  });

  it("supports resumable chunked rebuild with cursor", async () => {
    const searchRepo = createInMemorySearchIndexRepository();
    const sources = makeSources(15);

    const resolver: SearchSourceResolver = {
      async resolveDocument({ type, id }) {
        return sources.find((s) => s.type === type && s.id === id) ?? null;
      },
      async listAllSources() {
        return sources;
      },
    };

    // Step 1: chunk of 5
    const chunk1 = await rebuildSearchIndexChunk({
      searchRepo,
      resolver,
      cursor: null,
      batchSize: 5,
    });
    expect(chunk1.processed).toBe(5);
    expect(chunk1.done).toBe(false);
    expect(chunk1.nextCursor).toBe("5");
    expect(await searchRepo.countDocuments()).toBe(5);

    // Step 2: chunk of 5
    const chunk2 = await rebuildSearchIndexChunk({
      searchRepo,
      resolver,
      cursor: chunk1.nextCursor,
      batchSize: 5,
    });
    expect(chunk2.processed).toBe(5);
    expect(chunk2.done).toBe(false);
    expect(chunk2.nextCursor).toBe("10");
    expect(await searchRepo.countDocuments()).toBe(10);

    // Step 3: remaining 5
    const chunk3 = await rebuildSearchIndexChunk({
      searchRepo,
      resolver,
      cursor: chunk2.nextCursor,
      batchSize: 5,
    });
    expect(chunk3.processed).toBe(5);
    expect(chunk3.done).toBe(true);
    expect(chunk3.nextCursor).toBeNull();
    expect(await searchRepo.countDocuments()).toBe(15);
  });
});

describe("Multi-tab lease coordination", () => {
  interface LeaseData {
    ownerId: string;
    expiresAt: number;
  }

  function isLeaseData(val: unknown): val is LeaseData {
    return typeof val === "object" && val !== null && "ownerId" in val && "expiresAt" in val;
  }

  function createInMemoryMetaStore(): SearchReindexMetaStore {
    const store = new Map<string, { value: unknown; expiresAt: number }>();
    return {
      async get(key: string) {
        const entry = store.get(key);
        if (!entry) return null;
        if (entry.expiresAt < Date.now()) {
          store.delete(key);
          return null;
        }
        return entry.value;
      },
      async tryAcquireLease(key, ownerId, expiresAt, now) {
        const entry = store.get(key);
        if (entry && entry.expiresAt > now && isLeaseData(entry.value) && entry.value.ownerId !== ownerId) {
          return "foreign-held";
        }
        store.set(key, { value: { ownerId, expiresAt }, expiresAt });
        return "acquired";
      },
      async renewLease(key, ownerId, expiresAt) {
        const entry = store.get(key);
        if (!entry || !isLeaseData(entry.value) || entry.value.ownerId !== ownerId) {
          return "lost";
        }
        entry.expiresAt = expiresAt;
        entry.value = { ownerId, expiresAt };
        return "renewed";
      },
      async releaseLease(key, ownerId) {
        const entry = store.get(key);
        if (entry && isLeaseData(entry.value) && entry.value.ownerId === ownerId) {
          store.delete(key);
          return true;
        }
        return false;
      },
    };
  }

  it("skips rebuild if foreign lease is held", async () => {
    const meta = createInMemoryMetaStore();
    const searchRepo = createInMemorySearchIndexRepository();
    const resolver: SearchSourceResolver = {
      async resolveDocument() {
        return null;
      },
      async listAllSources() {
        return [];
      },
    };

    // Tab 1 holds lease
    await meta.tryAcquireLease(SEARCH_REINDEX_LEASE_KEY, "tab-1", Date.now() + 60000, Date.now());

    // Tab 2 attempts rebuild
    const result = await rebuildSearchIndexWithLease({
      searchRepo,
      resolver,
      meta,
      ownerId: "tab-2",
    });

    expect(result).toEqual({ skipped: true, reason: "lease-held" });
  });

  it("acquires lease, executes rebuild, and releases lease on completion", async () => {
    const meta = createInMemoryMetaStore();
    const searchRepo = createInMemorySearchIndexRepository();
    const doc: SearchDocument = {
      type: "task",
      id: "t1",
      revision: 1,
      title: "Task 1",
      subtitle: "First",
      ownerHref: "/tasks/t1",
      tokens: ["task"],
      updatedAt: 1000,
      indexSchemaVersion: 1,
    };
    const resolver: SearchSourceResolver = {
      async resolveDocument() {
        return doc;
      },
      async listAllSources() {
        return [doc];
      },
    };

    const result = await rebuildSearchIndexWithLease({
      searchRepo,
      resolver,
      meta,
      ownerId: "tab-1",
    });

    expect(result).toEqual({ skipped: false, indexedCount: 1, errors: [] });
    expect(await searchRepo.countDocuments()).toBe(1);

    // Lease should be released
    const afterLease = await meta.get(SEARCH_REINDEX_LEASE_KEY);
    expect(afterLease).toBeNull();
  });
});
