// =============================================================================
// RSemble AI — Search index repository (Dexie-backed + in-memory parity)
//
// Implements the SearchIndexRepository over the schema v15 searchDocuments
// table (spec §2):
//
//  - stores disposable SearchDocument rows keyed by compound [type+id];
//  - validates every write via parseSearchDocument (no credentials, raw output,
//    rationale, or attachments);
//  - provides local lexical search via querySearchIndex over the rebuildable
//    index;
//  - notifies subscribers on every committed index mutation;
//  - classifies storage errors and asserts database writability before writes.
// =============================================================================

import { classifyStorageError, StorageError, type RSembleEvaluationDB } from "./database";
import {
  parseSearchDocument,
  type SearchDocument,
  type SearchDocumentType,
} from "../search/search-types";
import { createSearchIndex, type SearchIndex } from "../search/search-index";
import { querySearchIndex, type SearchPage, type SearchQuery } from "../search/search-query";

export interface SearchIndexListQuery {
  type?: SearchDocumentType;
  limit?: number;
  offset?: number;
}

export interface SearchIndexRepository {
  putDocument(document: SearchDocument): Promise<void>;
  putDocuments(documents: readonly SearchDocument[]): Promise<void>;
  getDocument(type: SearchDocumentType, id: string): Promise<SearchDocument | null>;
  deleteDocument(type: SearchDocumentType, id: string): Promise<void>;
  deleteDocuments(refs: readonly { type: SearchDocumentType; id: string }[]): Promise<void>;
  listDocuments(query?: SearchIndexListQuery): Promise<SearchDocument[]>;
  countDocuments(query?: { type?: SearchDocumentType }): Promise<number>;
  clear(): Promise<void>;
  buildIndex(): Promise<SearchIndex>;
  search(query?: SearchQuery): Promise<SearchPage>;
  subscribe(listener: () => void): () => void;
}

// --- Dexie-backed implementation ---------------------------------------------

export function createSearchIndexRepository(db: RSembleEvaluationDB): SearchIndexRepository {
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // subscriber errors must not break repository operations
      }
    }
  }

  async function putDocument(document: SearchDocument): Promise<void> {
    const validated = parseSearchDocument(document);
    db.assertWritable();
    try {
      await db.searchDocuments.put(validated);
      notify();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function putDocuments(documents: readonly SearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    const validated = documents.map((doc) => parseSearchDocument(doc));
    db.assertWritable();
    try {
      await db.searchDocuments.bulkPut(validated);
      notify();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function getDocument(type: SearchDocumentType, id: string): Promise<SearchDocument | null> {
    try {
      const doc = await db.searchDocuments.get([type, id]);
      return doc ? parseSearchDocument(doc) : null;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function deleteDocument(type: SearchDocumentType, id: string): Promise<void> {
    db.assertWritable();
    try {
      await db.searchDocuments.delete([type, id]);
      notify();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function deleteDocuments(
    refs: readonly { type: SearchDocumentType; id: string }[],
  ): Promise<void> {
    if (refs.length === 0) return;
    db.assertWritable();
    try {
      await db.transaction("rw", db.searchDocuments, async () => {
        for (const ref of refs) {
          await db.searchDocuments.delete([ref.type, ref.id]);
        }
      });
      notify();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function listDocuments(query: SearchIndexListQuery = {}): Promise<SearchDocument[]> {
    try {
      let collection = db.searchDocuments.toCollection();
      if (query.type) {
        collection = db.searchDocuments.where("type").equals(query.type);
      }
      if (query.offset && query.offset > 0) {
        collection = collection.offset(query.offset);
      }
      if (query.limit !== undefined && query.limit >= 0) {
        collection = collection.limit(query.limit);
      }
      const docs = await collection.toArray();
      return docs.map((d) => parseSearchDocument(d));
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function countDocuments(query: { type?: SearchDocumentType } = {}): Promise<number> {
    try {
      if (query.type) {
        return await db.searchDocuments.where("type").equals(query.type).count();
      }
      return await db.searchDocuments.count();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function clear(): Promise<void> {
    db.assertWritable();
    try {
      await db.searchDocuments.clear();
      notify();
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw classifyStorageError(err);
    }
  }

  async function buildIndex(): Promise<SearchIndex> {
    const docs = await listDocuments();
    return createSearchIndex(docs);
  }

  async function search(query: SearchQuery = {}): Promise<SearchPage> {
    const index = await buildIndex();
    return querySearchIndex(index, query);
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    putDocument,
    putDocuments,
    getDocument,
    deleteDocument,
    deleteDocuments,
    listDocuments,
    countDocuments,
    clear,
    buildIndex,
    search,
    subscribe,
  };
}

// --- In-memory implementation ------------------------------------------------

export class InMemorySearchIndexRepository implements SearchIndexRepository {
  private documentsByKey = new Map<string, SearchDocument>();
  private listeners = new Set<() => void>();

  constructor(initial: readonly SearchDocument[] = []) {
    for (const doc of initial) {
      const validated = parseSearchDocument(doc);
      this.documentsByKey.set(`${validated.type}:${validated.id}`, structuredClone(validated));
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // subscriber errors must not break repository operations
      }
    }
  }

  async putDocument(document: SearchDocument): Promise<void> {
    const validated = parseSearchDocument(document);
    this.documentsByKey.set(`${validated.type}:${validated.id}`, structuredClone(validated));
    this.notify();
  }

  async putDocuments(documents: readonly SearchDocument[]): Promise<void> {
    if (documents.length === 0) return;
    for (const doc of documents) {
      const validated = parseSearchDocument(doc);
      this.documentsByKey.set(`${validated.type}:${validated.id}`, structuredClone(validated));
    }
    this.notify();
  }

  async getDocument(type: SearchDocumentType, id: string): Promise<SearchDocument | null> {
    const doc = this.documentsByKey.get(`${type}:${id}`);
    return doc ? structuredClone(doc) : null;
  }

  async deleteDocument(type: SearchDocumentType, id: string): Promise<void> {
    const deleted = this.documentsByKey.delete(`${type}:${id}`);
    if (deleted) this.notify();
  }

  async deleteDocuments(refs: readonly { type: SearchDocumentType; id: string }[]): Promise<void> {
    if (refs.length === 0) return;
    let anyDeleted = false;
    for (const ref of refs) {
      if (this.documentsByKey.delete(`${ref.type}:${ref.id}`)) {
        anyDeleted = true;
      }
    }
    if (anyDeleted) this.notify();
  }

  async listDocuments(query: SearchIndexListQuery = {}): Promise<SearchDocument[]> {
    let docs = [...this.documentsByKey.values()];
    if (query.type) {
      docs = docs.filter((d) => d.type === query.type);
    }
    const offset = query.offset ?? 0;
    const limit = query.limit !== undefined && query.limit >= 0 ? query.limit : docs.length;
    return docs.slice(offset, offset + limit).map((d) => structuredClone(d));
  }

  async countDocuments(query: { type?: SearchDocumentType } = {}): Promise<number> {
    if (query.type) {
      return [...this.documentsByKey.values()].filter((d) => d.type === query.type).length;
    }
    return this.documentsByKey.size;
  }

  async clear(): Promise<void> {
    if (this.documentsByKey.size > 0) {
      this.documentsByKey.clear();
      this.notify();
    }
  }

  async buildIndex(): Promise<SearchIndex> {
    const docs = await this.listDocuments();
    return createSearchIndex(docs);
  }

  async search(query: SearchQuery = {}): Promise<SearchPage> {
    const index = await this.buildIndex();
    return querySearchIndex(index, query);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function createInMemorySearchIndexRepository(
  initial: readonly SearchDocument[] = [],
): SearchIndexRepository {
  return new InMemorySearchIndexRepository(initial);
}
