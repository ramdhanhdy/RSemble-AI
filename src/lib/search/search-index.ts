import { parseSearchDocument, type SearchDocument } from "./search-types";

export interface SearchIndex {
  documents: SearchDocument[];
}

export function createSearchIndex(documents: readonly SearchDocument[]): SearchIndex {
  return { documents: documents.map((document) => parseSearchDocument(document)) };
}
