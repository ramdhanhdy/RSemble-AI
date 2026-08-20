// =============================================================================
// RSemble AI — Models list URL-state codec (Child 07 Task 9, C2).
//
// Deterministic, sorted URL search-param codec for the `/models` browse state:
// the eight spec-ordered filters (Fable §6.2), the D1 sort toggle, and the
// 1-based page. Mirrors the codec discipline of
// `encodeModelEvidenceQueryToUrl` / `decodeModelEvidenceQueryFromUrl` in the
// C1 profile-query contract: equivalent states encode identically, only
// non-default values are emitted, and params are sorted by key.
//
// The codec is pure and side-effect free. It knows nothing about the catalog
// or repository — ModelsWorkspace maps a decoded state onto catalog filters
// and post-filters. Page is clamped to >= 1 on decode.
// =============================================================================

/** Version-status filter vocabulary (Fable §6.2 #4). Mirrors IdentityCompleteness
 *  values but uses the rolling_alias / partial identity labels from §6.2. */
export type ModelVersionStatusFilter = "" | "exact" | "rolling_alias" | "partial";

/** Recency filter vocabulary (Fable §6.2 #8): active last N days, or any. */
export type ModelRecencyFilter = "" | "7" | "30" | "90";

/** Sort toggle (D1): canonical identity (catalog default) or latest activity. */
export type ModelListSort = "canonical" | "latest";

/** The eight filters + sort + page, in spec order (§6.2). */
export interface ModelListUrlState {
  /** #1 Search — free text (IDs, slugs, providers). */
  search: string;
  /** #2 Provider — a providerId or "". */
  provider: string;
  /** #3 Model — a requestedModel slug or "". */
  model: string;
  /** #4 Version status. */
  versionStatus: ModelVersionStatusFilter;
  /** #5 Reasoning/tool signature — an effective-signature value or "". */
  signature: string;
  /** #6 Evidence class — an EvidenceClass or "". */
  evidenceClass: string;
  /** #7 Family/facet — a familyId or "". */
  family: string;
  /** #8 Recency — active last N days, or any. */
  recency: ModelRecencyFilter;
  /** D1 sort. Defaults to "canonical". */
  sort: ModelListSort;
  /** 1-based page. Defaults to 1. */
  page: number;
}

/** The default (empty) browse state. */
export const DEFAULT_MODEL_LIST_URL_STATE: ModelListUrlState = {
  search: "",
  provider: "",
  model: "",
  versionStatus: "",
  signature: "",
  evidenceClass: "",
  family: "",
  recency: "",
  sort: "canonical",
  page: 1,
};

const VERSION_STATUS_VALUES: readonly ModelVersionStatusFilter[] = [
  "",
  "exact",
  "rolling_alias",
  "partial",
];
const RECENCY_VALUES: readonly ModelRecencyFilter[] = ["", "7", "30", "90"];
const SORT_VALUES: readonly ModelListSort[] = ["canonical", "latest"];

const PARAM_KEYS = [
  "m.evidenceClass",
  "m.family",
  "m.model",
  "m.page",
  "m.provider",
  "m.recency",
  "m.search",
  "m.signature",
  "m.sort",
  "m.versionStatus",
] as const;

function isOneOf<T extends string>(v: unknown, vocab: readonly T[]): v is T {
  return typeof v === "string" && (vocab as readonly string[]).includes(v);
}

/** Encode a browse state into deterministic, sorted URL search params. Only
 *  non-default values are emitted, so the default state encodes to an empty
 *  param string. Equivalent states produce identical param strings. */
export function encodeModelListUrlState(state: ModelListUrlState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set("m.search", state.search);
  if (state.provider) params.set("m.provider", state.provider);
  if (state.model) params.set("m.model", state.model);
  if (state.versionStatus) params.set("m.versionStatus", state.versionStatus);
  if (state.signature) params.set("m.signature", state.signature);
  if (state.evidenceClass) params.set("m.evidenceClass", state.evidenceClass);
  if (state.family) params.set("m.family", state.family);
  if (state.recency) params.set("m.recency", state.recency);
  if (state.sort === "latest") params.set("m.sort", "latest");
  if (state.page > 1) params.set("m.page", String(state.page));
  const sorted = new URLSearchParams();
  for (const [k, v] of Array.from(params.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    sorted.set(k, v);
  }
  return sorted;
}

/** Decode URL search params (or a record / URLSearchParams) back into a
 *  validated {@link ModelListUrlState}. Unknown / malformed values fall back
 *  to their defaults rather than throwing — a browse URL never breaks the
 *  list. Page is clamped to >= 1. */
export function decodeModelListUrlState(
  source: URLSearchParams | Record<string, string>,
): ModelListUrlState {
  const params =
    source instanceof URLSearchParams ? source : new URLSearchParams(source);
  const get = (key: string): string => params.get(key) ?? "";

  const versionStatus = get("m.versionStatus");
  const recency = get("m.recency");
  const sort = get("m.sort");
  const pageRaw = get("m.page");
  const pageParsed = Number(pageRaw);
  const page =
    pageRaw !== "" && Number.isFinite(pageParsed) && Number.isInteger(pageParsed)
      ? Math.max(1, pageParsed)
      : 1;

  return {
    search: get("m.search"),
    provider: get("m.provider"),
    model: get("m.model"),
    versionStatus: isOneOf(versionStatus, VERSION_STATUS_VALUES) ? versionStatus : "",
    signature: get("m.signature"),
    evidenceClass: get("m.evidenceClass"),
    family: get("m.family"),
    recency: isOneOf(recency, RECENCY_VALUES) ? recency : "",
    sort: isOneOf(sort, SORT_VALUES) ? sort : "canonical",
    page,
  };
}

/** Count how many of the eight filters are actively set (search counts only
 *  when non-empty). Used by the mobile sheet applied-count badge. Sort and
 *  page are not filters. */
export function countAppliedModelFilters(state: ModelListUrlState): number {
  let n = 0;
  if (state.search.trim()) n++;
  if (state.provider) n++;
  if (state.model) n++;
  if (state.versionStatus) n++;
  if (state.signature) n++;
  if (state.evidenceClass) n++;
  if (state.family) n++;
  if (state.recency) n++;
  return n;
}

/** Re-exported for tests / param-key sweeps. */
export const MODEL_LIST_URL_PARAM_KEYS = PARAM_KEYS;
