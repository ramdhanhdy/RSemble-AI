export const SEARCH_DOCUMENT_TYPES = [
  "task",
  "task_set",
  "rubric",
  "comparison",
  "evaluation",
  "fusion_study",
  "model_configuration",
  "model_rollup",
  "observation",
  "record",
] as const;

export type SearchDocumentType = (typeof SEARCH_DOCUMENT_TYPES)[number];

export const SEARCH_INDEX_SCHEMA_VERSION = 1;

export interface SearchDocument {
  type: SearchDocumentType;
  id: string;
  revision: number;
  title: string;
  subtitle: string;
  ownerHref: string;
  tokens: string[];
  updatedAt: number;
  indexSchemaVersion: number;
}

const CREDENTIAL_LIKE = /sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{10,}|Bearer\s+\S+/i;
const ALLOWED = new Set([
  "type",
  "id",
  "revision",
  "title",
  "subtitle",
  "ownerHref",
  "tokens",
  "updatedAt",
  "indexSchemaVersion",
  "matchingFields",
]);
const UNSAFE = new Set([
  "output",
  "rationale",
  "attachment",
  "error",
  "credential",
  "raw",
  "candidateOutput",
  "judgeRationale",
  "messages",
  "__proto__",
  "prototype",
  "constructor",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isType(v: unknown): v is SearchDocumentType {
  return typeof v === "string" && (SEARCH_DOCUMENT_TYPES as readonly string[]).includes(v);
}

function assertSafeString(label: string, value: string): void {
  if (CREDENTIAL_LIKE.test(value)) {
    throw new Error(`Search ${label} must not contain secret text`);
  }
}

export function parseSearchDocument(input: unknown): SearchDocument {
  if (!isRecord(input)) {
    throw new Error("Search document must be an object");
  }
  for (const key of Object.keys(input)) {
    if (UNSAFE.has(key) || !ALLOWED.has(key)) {
      throw new Error(`Search document has unsafe field ${key}`);
    }
  }
  if (!isType(input.type)) {
    throw new Error("Unknown search type");
  }
  const id = input.id;
  const title = input.title;
  const subtitle = input.subtitle;
  const ownerHref = input.ownerHref;
  if (typeof id !== "string" || id.length === 0) throw new Error("Search id must be a non-empty string");
  if (typeof title !== "string" || title.length === 0) throw new Error("Search title must be a non-empty string");
  if (typeof subtitle !== "string" || subtitle.length === 0) throw new Error("Search subtitle must be a non-empty string");
  if (typeof ownerHref !== "string" || ownerHref.length === 0) throw new Error("Search ownerHref must be a non-empty string");
  assertSafeString("id", id);
  assertSafeString("title", title);
  assertSafeString("subtitle", subtitle);
  assertSafeString("ownerHref", ownerHref);
  if (!Array.isArray(input.tokens)) {
    throw new Error("Search tokens must be strings");
  }
  const tokens: string[] = [];
  for (const token of input.tokens) {
    if (typeof token !== "string") throw new Error("Search tokens must be strings");
    assertSafeString("token", token);
    tokens.push(token);
  }
  if (typeof input.revision !== "number" || !Number.isFinite(input.revision)) {
    throw new Error("Search revision must be a finite number");
  }
  if (typeof input.updatedAt !== "number" || !Number.isFinite(input.updatedAt)) {
    throw new Error("Search updatedAt must be a finite number");
  }
  if (typeof input.indexSchemaVersion !== "number" || !Number.isFinite(input.indexSchemaVersion)) {
    throw new Error("Search indexSchemaVersion must be a finite number");
  }
  return {
    type: input.type,
    id,
    revision: input.revision,
    title,
    subtitle,
    ownerHref,
    tokens,
    updatedAt: input.updatedAt,
    indexSchemaVersion: input.indexSchemaVersion,
  };
}
