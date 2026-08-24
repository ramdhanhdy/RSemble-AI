import type { SearchDocument, SearchDocumentType } from "./search-types";
import type { SearchIndex } from "./search-index";

export type SearchRank = "exact_id" | "title_prefix" | "token";

export interface SearchQuery {
  text?: string;
  type?: SearchDocumentType;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  document: SearchDocument;
  rank: SearchRank;
  matchingFields: string[];
}

export interface SearchGroup {
  type: SearchDocumentType;
  count: number;
}

export interface SearchPage {
  items: SearchHit[];
  total: number;
  offset: number;
  limit: number;
  groups: SearchGroup[];
}

const RANK_ORDER: Record<SearchRank, number> = {
  exact_id: 0,
  title_prefix: 1,
  token: 2,
};

const MAX_QUERY = 200;

export function foldSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function queryTokens(text: string): string[] {
  const clipped = text.length > MAX_QUERY ? text.slice(0, MAX_QUERY) : text;
  return foldSearchText(clipped)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function rankDocument(document: SearchDocument, raw: string, tokens: string[]): SearchHit | null {
  const foldedId = foldSearchText(document.id);
  const foldedQuery = foldSearchText(raw.trim());
  if (foldedQuery.length > 0 && foldedId === foldedQuery) {
    return { document, rank: "exact_id", matchingFields: ["id"] };
  }
  const foldedTitle = foldSearchText(document.title);
  if (foldedQuery.length > 0 && foldedTitle.startsWith(foldedQuery)) {
    return { document, rank: "title_prefix", matchingFields: ["title"] };
  }
  if (tokens.length === 0) return null;
  const haystack = new Set([
    foldedId,
    ...foldedTitle.split(/[^\p{L}\p{N}]+/u).filter(Boolean),
    ...foldSearchText(document.subtitle)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
    ...document.tokens.map((token) => foldSearchText(token)),
  ]);
  if (
    tokens.every(
      (token) => haystack.has(token) || [...haystack].some((part) => part.startsWith(token)),
    )
  ) {
    return { document, rank: "token", matchingFields: ["tokens"] };
  }
  return null;
}

function compareHits(a: SearchHit, b: SearchHit): number {
  const rank = RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  if (rank !== 0) return rank;
  if (a.document.updatedAt !== b.document.updatedAt)
    return b.document.updatedAt - a.document.updatedAt;
  return a.document.id < b.document.id ? -1 : a.document.id > b.document.id ? 1 : 0;
}

export function querySearchIndex(index: SearchIndex, query: SearchQuery = {}): SearchPage {
  const raw = query.text ?? "";
  const tokens = queryTokens(raw);
  const emptyText = raw.trim().length === 0;
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(0, query.limit ?? 50);

  if (emptyText || tokens.length === 0) {
    return { items: [], total: 0, offset, limit, groups: [] };
  }

  const hits: SearchHit[] = [];
  for (const document of index.documents) {
    if (query.type && document.type !== query.type) continue;
    const hit = rankDocument(document, raw, tokens);
    if (hit) hits.push(hit);
  }
  hits.sort(compareHits);

  const counts = new Map<SearchDocumentType, number>();
  for (const hit of hits) {
    counts.set(hit.document.type, (counts.get(hit.document.type) ?? 0) + 1);
  }
  const groups = [...counts.entries()].map(([type, count]) => ({ type, count }));

  return {
    items: hits.slice(offset, offset + limit),
    total: hits.length,
    offset,
    limit,
    groups,
  };
}
