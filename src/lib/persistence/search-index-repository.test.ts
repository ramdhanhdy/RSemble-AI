// =============================================================================
// RSemble AI — Search index repository tests (Dexie-backed + in-memory parity)
// =============================================================================

import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInMemorySearchIndexRepository,
  createSearchIndexRepository,
  type SearchIndexRepository,
} from "./search-index-repository";
import { RSembleEvaluationDB, StorageError } from "./database";
import type { SearchDocument } from "../search/search-types";

function createValidDoc(id: string, overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    type: "task",
    id,
    revision: 1,
    title: `Task ${id}`,
    subtitle: "Canonical task description",
    ownerHref: `/tasks/${id}`,
    tokens: ["task", id.toLowerCase()],
    updatedAt: 1000,
    indexSchemaVersion: 1,
    ...overrides,
  };
}

describe.each([
  {
    name: "Dexie-backed",
    setup: () => {
      const db = new RSembleEvaluationDB(`test-search-repo-${Math.random().toString(36).slice(2)}`);
      const repo = createSearchIndexRepository(db);
      return { repo, db };
    },
    teardown: async (ctx: { db: RSembleEvaluationDB }) => {
      try {
        await ctx.db.delete();
      } catch {
        // best effort
      }
    },
  },
  {
    name: "In-memory",
    setup: () => {
      const repo = createInMemorySearchIndexRepository();
      return { repo, db: null };
    },
    teardown: async () => {},
  },
])("SearchIndexRepository ($name)", ({ setup, teardown }) => {
  let repo: SearchIndexRepository;
  let db: RSembleEvaluationDB | null;

  afterEach(async () => {
    if (db) await teardown({ db });
  });

  it("stores and retrieves safe search documents", async () => {
    ({ repo, db } = setup());
    const doc1 = createValidDoc("t1", { type: "task", title: "First task" });
    const doc2 = createValidDoc("s1", { type: "task_set", title: "Task Set 1" });

    await repo.putDocument(doc1);
    await repo.putDocument(doc2);

    const fetched1 = await repo.getDocument("task", "t1");
    const fetched2 = await repo.getDocument("task_set", "s1");
    const missing = await repo.getDocument("task", "non-existent");

    expect(fetched1).toEqual(doc1);
    expect(fetched2).toEqual(doc2);
    expect(missing).toBeNull();
  });

  it("rejects unsafe or credential-bearing search documents", async () => {
    ({ repo, db } = setup());
    const unsafeSecret = createValidDoc("t1", { title: "sk-secret123456" });
    await expect(repo.putDocument(unsafeSecret)).rejects.toThrow(/secret/i);

    const unsafeField = {
      ...createValidDoc("t2"),
      output: "raw output should fail",
    } as unknown as SearchDocument;
    await expect(repo.putDocument(unsafeField)).rejects.toThrow(/unsafe/i);
  });

  it("supports batch putDocuments and deleteDocuments", async () => {
    ({ repo, db } = setup());
    const docs = [
      createValidDoc("d1", { type: "task" }),
      createValidDoc("d2", { type: "task" }),
      createValidDoc("d3", { type: "evaluation" }),
    ];

    await repo.putDocuments(docs);
    expect(await repo.countDocuments()).toBe(3);
    expect(await repo.countDocuments({ type: "task" })).toBe(2);
    expect(await repo.countDocuments({ type: "evaluation" })).toBe(1);

    await repo.deleteDocuments([
      { type: "task", id: "d1" },
      { type: "evaluation", id: "d3" },
    ]);

    expect(await repo.countDocuments()).toBe(1);
    expect(await repo.getDocument("task", "d1")).toBeNull();
    expect(await repo.getDocument("task", "d2")).toEqual(docs[1]);
    expect(await repo.getDocument("evaluation", "d3")).toBeNull();
  });

  it("lists documents with pagination and type filtering", async () => {
    ({ repo, db } = setup());
    const docs = [
      createValidDoc("a", { type: "task", updatedAt: 100 }),
      createValidDoc("b", { type: "task", updatedAt: 200 }),
      createValidDoc("c", { type: "rubric", updatedAt: 300 }),
    ];
    await repo.putDocuments(docs);

    const tasks = await repo.listDocuments({ type: "task" });
    expect(tasks.map((d) => d.id)).toEqual(["a", "b"]);

    const paged = await repo.listDocuments({ limit: 2, offset: 1 });
    expect(paged.length).toBe(2);
  });

  it("clears disposable search documents without touching other stores", async () => {
    ({ repo, db } = setup());
    await repo.putDocument(createValidDoc("t1"));
    expect(await repo.countDocuments()).toBe(1);

    await repo.clear();
    expect(await repo.countDocuments()).toBe(0);
    expect(await repo.getDocument("task", "t1")).toBeNull();
  });

  it("builds an in-memory SearchIndex and performs querySearchIndex search", async () => {
    ({ repo, db } = setup());
    await repo.putDocuments([
      createValidDoc("alpha", { type: "task", title: "Alpha brief" }),
      createValidDoc("beta", { type: "task", title: "Beta analysis", tokens: ["beta"] }),
      createValidDoc("gamma", { type: "evaluation", title: "Gamma run", tokens: ["brief"] }),
    ]);

    const page = await repo.search({ text: "brief" });
    expect(page.items.length).toBe(2);
    expect(page.items[0].document.id).toBe("alpha");
    expect(page.items[1].document.id).toBe("gamma");

    const filtered = await repo.search({ text: "brief", type: "task" });
    expect(filtered.items.length).toBe(1);
    expect(filtered.items[0].document.id).toBe("alpha");
  });

  it("notifies subscribers on document mutations", async () => {
    ({ repo, db } = setup());
    const listener = vi.fn();
    const unsub = repo.subscribe(listener);

    await repo.putDocument(createValidDoc("t1"));
    expect(listener).toHaveBeenCalledTimes(1);

    await repo.putDocuments([createValidDoc("t2"), createValidDoc("t3")]);
    expect(listener).toHaveBeenCalledTimes(2);

    await repo.deleteDocument("task", "t1");
    expect(listener).toHaveBeenCalledTimes(3);

    await repo.clear();
    expect(listener).toHaveBeenCalledTimes(4);

    unsub();
    await repo.putDocument(createValidDoc("t4"));
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe("SearchIndexRepository error classification", () => {
  it("rejects mutations when Dexie database state is not writable", async () => {
    const db = new RSembleEvaluationDB(`test-search-unwritable-${Math.random().toString(36).slice(2)}`);
    const repo = createSearchIndexRepository(db);
    db.setState("blocked");

    await expect(repo.putDocument(createValidDoc("t1"))).rejects.toThrow(StorageError);
    await expect(repo.deleteDocument("task", "t1")).rejects.toThrow(StorageError);
    await expect(repo.clear()).rejects.toThrow(StorageError);

    try {
      await db.delete();
    } catch {
      // best effort
    }
  });
});
