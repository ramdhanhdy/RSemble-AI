// =============================================================================
// RSemble AI — Model evidence query contract (Child 07 spec §3, plan Task 1)
//
// Discriminated ModelEvidenceQuery with:
//  - runtime validation of the discriminated respondent (exact model
//    configuration OR pinned Model Rollup version with `stratified_only`);
//  - canonical ordering of set-like filters and deterministic canonical
//    serialization;
//  - deterministic query fingerprint (sha256 over canonical serialization);
//  - resolved-respondent receipt/manifest (rollup version resolves to its
//    immutable exact member list via an injected resolver — this module
//    defines/consumes the Rollup query contract only, it does NOT create the
//    persistent Rollup repository);
//  - deterministic URL-state codec.
//
// Invariants enforced:
//  - No nullable model/rollup ambiguity: the respondent is exactly one of the
//    two discriminated kinds, with no cross-kind fields.
//  - No unversioned rollup respondent: `version` is a positive integer.
//  - Required rule/version pins: eligibility / aggregation / uncertainty rule
//    versions are required positive integers pinned to a supported set;
//    unsupported/unknown versions fail safe.
//  - No credential/auth/environment material: prohibited keys are rejected
//    anywhere in the query payload.
//  - No implicit exact-configuration merging: a query carries exactly one
//    respondent; equivalent permutations fingerprint identically and
//    materially different semantic queries fingerprint differently.
//
// This module is pure and side-effect free. It does not implement catalog,
// selection, coverage, aggregation, or UI.
// =============================================================================

import { canonicalJsonString, hashArtifactContent } from "../evaluations/protocol-fingerprint";
import {
  EVIDENCE_CLASSES,
  EVIDENCE_USES,
  OBSERVATION_SOURCE_KINDS,
  type EvidenceClass,
  type EvidenceUse,
  type EvaluatorKind,
  type ObservationSourceKind,
} from "../evidence/evidence-types";
import { EVIDENCE_RULE_VERSION } from "../evidence/evidence-eligibility";
import {
  EVIDENCE_PROHIBITED_KEYS,
  collectProhibitedFieldPaths,
  isCohortFingerprint,
  isVersionRef,
} from "../evidence/evidence-validation";
import { isNonBlankString, isRecord } from "../persistence/run-types";
import type { VersionRef } from "../tasks/task-types";

// --- Rule version pins ---------------------------------------------------------

/**
 * Supported eligibility rule version for the query contract. Mirrors the live
 * `EVIDENCE_RULE_VERSION` (Child 04). Bump only with a new authorized rule set.
 */
export const QUERY_ELIGIBILITY_RULE_VERSION = EVIDENCE_RULE_VERSION;

/** Supported aggregation rule version for the query contract. */
export const QUERY_AGGREGATION_RULE_VERSION = 1;

/** Supported uncertainty rule version for the query contract. */
export const QUERY_UNCERTAINTY_RULE_VERSION = 1;

/**
 * The only rule versions a query may pin. Unknown / future versions are
 * rejected at validation time so a query never silently executes under a rule
 * set the workbench cannot reproduce.
 */
export const SUPPORTED_QUERY_RULE_VERSIONS: {
  readonly eligibility: readonly number[];
  readonly aggregation: readonly number[];
  readonly uncertainty: readonly number[];
} = {
  eligibility: [QUERY_ELIGIBILITY_RULE_VERSION],
  aggregation: [QUERY_AGGREGATION_RULE_VERSION],
  uncertainty: [QUERY_UNCERTAINTY_RULE_VERSION],
} as const;

// --- Filter shapes (defined by this contract; spec §3 references them) --------

/**
 * Filter observations by a Task facet annotation. `valueIds` is the set of
 * facet values to include; an empty array means "any value of this facet is
 * present" (membership filter). Order is not significant.
 */
export interface FacetFilter {
  facetId: string;
  valueIds: string[];
}

/**
 * Filter observations by evaluator identity. A `null` field means "any" for
 * that dimension. Order is not significant across filters.
 */
export interface EvaluatorFilter {
  evaluatorKind: EvaluatorKind | null;
  providerId: string | null;
  model: string | null;
  instructionDigest: string | null;
}

// --- Respondent ----------------------------------------------------------------

/**
 * Discriminated profile respondent (spec §3). Exactly one of:
 *  - `model_configuration`: one exact `ModelConfigurationSnapshot` id.
 *  - `model_rollup`: a pinned, immutable Model Rollup version whose
 *    `aggregationPolicy` is locked to `stratified_only`.
 *
 * No nullable model/rollup pair is allowed and no cross-kind fields are
 * permitted on a given kind.
 */
export type ProfileRespondent =
  | { readonly kind: "model_configuration"; readonly modelConfigurationId: string }
  | {
      readonly kind: "model_rollup";
      readonly rollupId: string;
      readonly version: number;
      readonly aggregationPolicy: "stratified_only";
    };

// --- Query ---------------------------------------------------------------------

/**
 * Reproducible profile query (spec §3). All set-like filter arrays are
 * order-insensitive; the canonical serializer orders them deterministically.
 */
export interface ModelEvidenceQuery {
  respondent: ProfileRespondent;
  observedFrom: number | null;
  observedTo: number | null;
  taskFamilyIds: string[];
  facetFilters: FacetFilter[];
  evidenceClasses: EvidenceClass[];
  allowedUses: EvidenceUse[];
  comparabilityCohortIds: string[];
  sourceKinds: Array<ObservationSourceKind>;
  rubricRefs: VersionRef[];
  evaluatorFilters: EvaluatorFilter[];
  includeUnknownVersion: boolean;
  eligibilityRuleVersion: number;
  aggregationRuleVersion: number;
  uncertaintyRuleVersion: number;
}

// --- Resolved rollup manifest (query contract only; no persistence) -----------

/**
 * Immutable manifest for one pinned Model Rollup version. The canonical
 * serializer resolves a rollup respondent to this shape via an injected
 * {@link RollupVersionResolver}; this module does not store or create rollups.
 */
export interface ResolvedRollupManifest {
  rollupId: string;
  version: number;
  aggregationPolicy: "stratified_only";
  name: string;
  memberConfigurationIds: string[];
  createdAt: number;
}

/**
 * Resolver the serializer consumes to turn a `(rollupId, version)` pin into an
 * immutable {@link ResolvedRollupManifest}. Returns `null` when the version
 * does not resolve; the query then fails validation. The persistent Rollup
 * repository (Child 07 Task 11) will implement this — T1 only defines the
 * contract.
 */
export type RollupVersionResolver = (
  rollupId: string,
  version: number,
) => ResolvedRollupManifest | null;

/**
 * Resolved respondent carried in the query receipt. For an exact configuration
 * it is the configuration id; for a rollup it is the immutable member manifest.
 */
export type ResolvedRespondentManifest =
  | { readonly kind: "model_configuration"; readonly modelConfigurationId: string }
  | { readonly kind: "model_rollup"; readonly manifest: ResolvedRollupManifest };

// --- Active-filter summary (receipt) ------------------------------------------

export interface ModelEvidenceQueryActiveFilters {
  observedFrom: number | null;
  observedTo: number | null;
  taskFamilyIds: string[];
  facetFilters: FacetFilter[];
  evidenceClasses: EvidenceClass[];
  allowedUses: EvidenceUse[];
  comparabilityCohortIds: string[];
  sourceKinds: ObservationSourceKind[];
  rubricRefs: VersionRef[];
  evaluatorFilters: EvaluatorFilter[];
  includeUnknownVersion: boolean;
}

// --- Receipt -------------------------------------------------------------------

export interface ModelEvidenceQueryReceipt {
  /** Deterministic query fingerprint (`sha256:<hex>` over canonical serialization). */
  fingerprint: string;
  /** Short fingerprint abbreviation (`sha256:<12 hex>`). */
  fingerprintAbbreviation: string;
  /** Canonical JSON serialization the fingerprint was computed over. */
  canonicalSerialization: string;
  /** Resolved respondent manifest (rollup member list or exact config id). */
  resolvedRespondent: ResolvedRespondentManifest;
  /** Wall-clock generation time. NOT part of the fingerprint (reproducible). */
  generatedAt: number;
  observedFrom: number | null;
  observedTo: number | null;
  activeFilters: ModelEvidenceQueryActiveFilters;
}

// --- Validation result --------------------------------------------------------

export interface ModelEvidenceQueryValidationError {
  ok: false;
  errors: string[];
}
export interface ModelEvidenceQueryValidationOk {
  ok: true;
  resolvedRespondent: ResolvedRespondentManifest;
}
export type ModelEvidenceQueryValidationResult =
  | ModelEvidenceQueryValidationError
  | ModelEvidenceQueryValidationOk;

// --- Small guards --------------------------------------------------------------

const MC_ID_RE = /^mc:sha256:[0-9a-f]{64}$/;
const EVALUATOR_KINDS: readonly EvaluatorKind[] = ["model_judge", "human_authorized"];

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isPositiveInteger(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v > 0;
}
function isNonNegativeFinite(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0;
}
function isNullishString(v: unknown): v is string | null {
  return v === null || isString(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => isString(x));
}

function hasOnlyKeys(v: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(v);
  return keys.length === allowed.length && keys.every((k) => allowed.includes(k));
}

// --- Respondent guard ----------------------------------------------------------

const MODEL_CONFIG_RESPONDENT_KEYS = ["kind", "modelConfigurationId"] as const;
const MODEL_ROLLUP_RESPONDENT_KEYS = ["kind", "rollupId", "version", "aggregationPolicy"] as const;

export function isProfileRespondent(v: unknown): v is ProfileRespondent {
  if (!isRecord(v)) return false;
  if (v.kind === "model_configuration") {
    if (!hasOnlyKeys(v, MODEL_CONFIG_RESPONDENT_KEYS)) return false;
    return isNonBlankString(v.modelConfigurationId) && MC_ID_RE.test(v.modelConfigurationId);
  }
  if (v.kind === "model_rollup") {
    if (!hasOnlyKeys(v, MODEL_ROLLUP_RESPONDENT_KEYS)) return false;
    return (
      isNonBlankString(v.rollupId) &&
      isPositiveInteger(v.version) &&
      v.aggregationPolicy === "stratified_only"
    );
  }
  return false;
}

// --- Structural query validation (no rollup resolution) -----------------------

function validateFacetFilter(v: unknown, errors: string[], path: string): v is FacetFilter {
  if (!isRecord(v)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  if (!isNonBlankString(v.facetId)) {
    errors.push(`${path}.facetId must be a non-blank string.`);
    return false;
  }
  if (!Array.isArray(v.valueIds) || !v.valueIds.every((x) => isNonBlankString(x))) {
    errors.push(`${path}.valueIds must be an array of non-blank strings.`);
    return false;
  }
  return true;
}

function validateEvaluatorFilter(v: unknown, errors: string[], path: string): v is EvaluatorFilter {
  if (!isRecord(v)) {
    errors.push(`${path} must be an object.`);
    return false;
  }
  if (
    v.evaluatorKind !== null &&
    !(isString(v.evaluatorKind) && (EVALUATOR_KINDS as readonly string[]).includes(v.evaluatorKind))
  ) {
    errors.push(`${path}.evaluatorKind must be a valid EvaluatorKind or null.`);
    return false;
  }
  if (!isNullishString(v.providerId)) {
    errors.push(`${path}.providerId must be a string or null.`);
    return false;
  }
  if (!isNullishString(v.model)) {
    errors.push(`${path}.model must be a string or null.`);
    return false;
  }
  if (!isNullishString(v.instructionDigest)) {
    errors.push(`${path}.instructionDigest must be a string or null.`);
    return false;
  }
  return true;
}

function isOfVocabulary<T extends string>(
  v: unknown,
  vocab: readonly T[],
): v is T {
  return isString(v) && (vocab as readonly string[]).includes(v);
}

function validateRuleVersion(
  v: unknown,
  supported: readonly number[],
  errors: string[],
  field: string,
): v is number {
  if (!isPositiveInteger(v)) {
    errors.push(`${field} must be a positive integer.`);
    return false;
  }
  if (!supported.includes(v)) {
    errors.push(`${field} ${v} is not a supported rule version (supported: ${supported.join(", ")}).`);
    return false;
  }
  return true;
}

/**
 * Structural validation shared by {@link isModelEvidenceQuery} and
 * {@link validateModelEvidenceQuery}. Does NOT resolve a rollup manifest.
 * Returns the list of errors (empty when valid).
 */
function structuralErrors(query: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(query)) {
    errors.push("query must be an object.");
    return errors;
  }

  // Prohibited credential/auth/environment material anywhere in the payload.
  const prohibited: string[] = [];
  collectProhibitedFieldPaths(query, "", prohibited);
  for (const p of prohibited) errors.push(p);

  if (!isProfileRespondent(query.respondent)) {
    errors.push("respondent must be a discriminated ProfileRespondent (exact configuration or pinned stratified_only rollup).");
  }

  if (query.observedFrom !== null && !isNonNegativeFinite(query.observedFrom)) {
    errors.push("observedFrom must be null or a non-negative finite number.");
  }
  if (query.observedTo !== null && !isNonNegativeFinite(query.observedTo)) {
    errors.push("observedTo must be null or a non-negative finite number.");
  }
  if (
    query.observedFrom !== null &&
    query.observedTo !== null &&
    isNonNegativeFinite(query.observedFrom) &&
    isNonNegativeFinite(query.observedTo) &&
    query.observedFrom > query.observedTo
  ) {
    errors.push("observedFrom must not be greater than observedTo.");
  }

  if (!isStringArray(query.taskFamilyIds)) {
    errors.push("taskFamilyIds must be an array of strings.");
  } else if (!query.taskFamilyIds.every((id) => isNonBlankString(id))) {
    errors.push("taskFamilyIds must be non-blank strings.");
  }

  if (!Array.isArray(query.facetFilters)) {
    errors.push("facetFilters must be an array.");
  } else {
    query.facetFilters.forEach((f, i) => validateFacetFilter(f, errors, `facetFilters[${i}]`));
  }

  if (!Array.isArray(query.evidenceClasses)) {
    errors.push("evidenceClasses must be an array.");
  } else if (!query.evidenceClasses.every((c) => isOfVocabulary(c, EVIDENCE_CLASSES))) {
    errors.push("evidenceClasses must be a subset of the canonical EvidenceClass vocabulary.");
  }

  if (!Array.isArray(query.allowedUses)) {
    errors.push("allowedUses must be an array.");
  } else if (!query.allowedUses.every((u) => isOfVocabulary(u, EVIDENCE_USES))) {
    errors.push("allowedUses must be a subset of the canonical EvidenceUse vocabulary.");
  }

  if (!isStringArray(query.comparabilityCohortIds)) {
    errors.push("comparabilityCohortIds must be an array of strings.");
  } else if (!query.comparabilityCohortIds.every((id) => isCohortFingerprint(id))) {
    errors.push("comparabilityCohortIds must be canonical sha256 cohort fingerprints.");
  }

  if (!Array.isArray(query.sourceKinds)) {
    errors.push("sourceKinds must be an array.");
  } else if (!query.sourceKinds.every((k) => isOfVocabulary(k, OBSERVATION_SOURCE_KINDS))) {
    errors.push("sourceKinds must be a subset of the canonical ObservationSourceKind vocabulary.");
  }

  if (!Array.isArray(query.rubricRefs)) {
    errors.push("rubricRefs must be an array.");
  } else if (!query.rubricRefs.every((r) => isVersionRef(r))) {
    errors.push("rubricRefs must be valid VersionRef entries (non-blank id, positive integer version).");
  }

  if (!Array.isArray(query.evaluatorFilters)) {
    errors.push("evaluatorFilters must be an array.");
  } else {
    query.evaluatorFilters.forEach((f, i) => validateEvaluatorFilter(f, errors, `evaluatorFilters[${i}]`));
  }

  if (!isBoolean(query.includeUnknownVersion)) {
    errors.push("includeUnknownVersion must be a boolean.");
  }

  validateRuleVersion(query.eligibilityRuleVersion, SUPPORTED_QUERY_RULE_VERSIONS.eligibility, errors, "eligibilityRuleVersion");
  validateRuleVersion(query.aggregationRuleVersion, SUPPORTED_QUERY_RULE_VERSIONS.aggregation, errors, "aggregationRuleVersion");
  validateRuleVersion(query.uncertaintyRuleVersion, SUPPORTED_QUERY_RULE_VERSIONS.uncertainty, errors, "uncertaintyRuleVersion");

  return errors;
}

export function isModelEvidenceQuery(v: unknown): v is ModelEvidenceQuery {
  return structuralErrors(v).length === 0;
}

// --- Canonical ordering --------------------------------------------------------

function dedupSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

/** Deduplicate preserving first-occurrence order (for authored member lists). */
function dedupPreserveOrder(arr: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of arr) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function canonicalFacetFilters(arr: FacetFilter[]): FacetFilter[] {
  const normalized = arr.map((f) => ({
    facetId: f.facetId,
    valueIds: dedupSorted(f.valueIds),
  }));
  normalized.sort((a, b) => {
    if (a.facetId !== b.facetId) return a.facetId.localeCompare(b.facetId);
    return a.valueIds.join(",").localeCompare(b.valueIds.join(","));
  });
  return normalized;
}

function canonicalEvaluatorFilters(arr: EvaluatorFilter[]): EvaluatorFilter[] {
  const normalized = arr.map((f) => ({
    evaluatorKind: f.evaluatorKind,
    providerId: f.providerId,
    model: f.model,
    instructionDigest: f.instructionDigest,
  }));
  normalized.sort((a, b) => {
    const ka = a.evaluatorKind ?? "";
    const kb = b.evaluatorKind ?? "";
    if (ka !== kb) return ka.localeCompare(kb);
    const pa = a.providerId ?? "";
    const pb = b.providerId ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    const ma = a.model ?? "";
    const mb = b.model ?? "";
    if (ma !== mb) return ma.localeCompare(mb);
    return (a.instructionDigest ?? "").localeCompare(b.instructionDigest ?? "");
  });
  return normalized;
}

function canonicalRubricRefs(arr: VersionRef[]): VersionRef[] {
  return arr
    .map((r) => ({ id: r.id, version: r.version }))
    .sort((a, b) => {
      if (a.id !== b.id) return a.id.localeCompare(b.id);
      return a.version - b.version;
    });
}

function canonicalVocabArray<T extends string>(arr: T[]): T[] {
  // Alphabetical canonical order (repo convention, e.g. EVIDENCE_REASON_CODES).
  // Vocabulary membership is checked at validation time; ordering is purely
  // deterministic and permutation-invariant.
  return Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
}

/**
 * Returns a canonical copy of the query with all set-like filter arrays
 * deduplicated and deterministically ordered. Uses structural validation only:
 * the rollup respondent pin `(rollupId, version, policy)` is the fingerprint
 * identity, so manifest resolution is NOT required to canonicalize. The
 * optional `resolver` is accepted for call-site symmetry with
 * {@link serializeModelEvidenceQuery} and is not used here. Throws on invalid
 * input.
 */
export function canonicalizeModelEvidenceQuery(
  query: ModelEvidenceQuery,
  _resolver?: RollupVersionResolver,
): ModelEvidenceQuery {
  const errors = structuralErrors(query);
  if (errors.length > 0) {
    throw new Error(`Invalid ModelEvidenceQuery: ${errors.join(" ")}`);
  }
  return canonicalQueryUnchecked(query);
}

function canonicalQueryUnchecked(query: ModelEvidenceQuery): ModelEvidenceQuery {
  return {
    respondent: query.respondent,
    observedFrom: query.observedFrom,
    observedTo: query.observedTo,
    taskFamilyIds: dedupSorted(query.taskFamilyIds),
    facetFilters: canonicalFacetFilters(query.facetFilters),
    evidenceClasses: canonicalVocabArray(query.evidenceClasses),
    allowedUses: canonicalVocabArray(query.allowedUses),
    comparabilityCohortIds: dedupSorted(query.comparabilityCohortIds),
    sourceKinds: canonicalVocabArray(query.sourceKinds),
    rubricRefs: canonicalRubricRefs(query.rubricRefs),
    evaluatorFilters: canonicalEvaluatorFilters(query.evaluatorFilters),
    includeUnknownVersion: query.includeUnknownVersion,
    eligibilityRuleVersion: query.eligibilityRuleVersion,
    aggregationRuleVersion: query.aggregationRuleVersion,
    uncertaintyRuleVersion: query.uncertaintyRuleVersion,
  };
}

// --- Canonical serialization & fingerprint -----------------------------------

/**
 * Canonical, deterministically ordered JSON serialization of the query. Object
 * keys are recursively sorted; set-like filter arrays are deduplicated and
 * canonically ordered. The resolved rollup manifest is NOT part of the
 * fingerprint input — the `(rollupId, version, policy)` pin already identifies
 * the immutable member list. Throws on invalid input.
 */
export function canonicalModelEvidenceQueryJson(
  query: ModelEvidenceQuery,
  resolver?: RollupVersionResolver,
): string {
  const canon = canonicalizeModelEvidenceQuery(query, resolver);
  return canonicalJsonString(canonicalSerializableObject(canon));
}

/** Bare canonical object (no methods, stable key set) fed to the serializer. */
function canonicalSerializableObject(query: ModelEvidenceQuery): Record<string, unknown> {
  return {
    respondent: query.respondent,
    observedFrom: query.observedFrom,
    observedTo: query.observedTo,
    taskFamilyIds: query.taskFamilyIds,
    facetFilters: query.facetFilters,
    evidenceClasses: query.evidenceClasses,
    allowedUses: query.allowedUses,
    comparabilityCohortIds: query.comparabilityCohortIds,
    sourceKinds: query.sourceKinds,
    rubricRefs: query.rubricRefs,
    evaluatorFilters: query.evaluatorFilters,
    includeUnknownVersion: query.includeUnknownVersion,
    eligibilityRuleVersion: query.eligibilityRuleVersion,
    aggregationRuleVersion: query.aggregationRuleVersion,
    uncertaintyRuleVersion: query.uncertaintyRuleVersion,
  };
}

/**
 * Deterministic query fingerprint: `sha256:<64 lowercase hex>` over the
 * canonical serialization. Reproducible across time and equivalent
 * permutations. Throws on invalid input.
 */
export function fingerprintModelEvidenceQuery(
  query: ModelEvidenceQuery,
  resolver?: RollupVersionResolver,
): string {
  return hashArtifactContent(canonicalModelEvidenceQueryJson(query, resolver));
}

// --- Full validation (with rollup resolution) ---------------------------------

export function validateModelEvidenceQuery(
  query: unknown,
  resolver?: RollupVersionResolver,
): ModelEvidenceQueryValidationResult {
  const errors = structuralErrors(query);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const q = query as ModelEvidenceQuery;
  let resolvedRespondent: ResolvedRespondentManifest;
  if (q.respondent.kind === "model_configuration") {
    resolvedRespondent = {
      kind: "model_configuration",
      modelConfigurationId: q.respondent.modelConfigurationId,
    };
  } else {
    if (!resolver) {
      return {
        ok: false,
        errors: ["A RollupVersionResolver is required to validate a model_rollup respondent."],
      };
    }
    const manifest = resolver(q.respondent.rollupId, q.respondent.version);
    if (!manifest) {
      return {
        ok: false,
        errors: [
          `Rollup ${q.respondent.rollupId} version ${q.respondent.version} did not resolve to an immutable manifest.`,
        ],
      };
    }
    const manifestErrors: string[] = [];
    if (!isNonBlankString(manifest.rollupId)) manifestErrors.push("manifest.rollupId must be a non-blank string.");
    if (!isPositiveInteger(manifest.version)) manifestErrors.push("manifest.version must be a positive integer.");
    if (manifest.aggregationPolicy !== "stratified_only") manifestErrors.push("manifest.aggregationPolicy must be stratified_only.");
    if (!isNonBlankString(manifest.name)) manifestErrors.push("manifest.name must be a non-blank string.");
    if (!isNonNegativeFinite(manifest.createdAt)) manifestErrors.push("manifest.createdAt must be a non-negative finite number.");
    if (!isStringArray(manifest.memberConfigurationIds) || !manifest.memberConfigurationIds.every((id) => MC_ID_RE.test(id))) {
      manifestErrors.push("manifest.memberConfigurationIds must be canonical model-configuration ids.");
    }
    if (manifestErrors.length > 0) {
      return { ok: false, errors: manifestErrors };
    }
    if (manifest.rollupId !== q.respondent.rollupId || manifest.version !== q.respondent.version) {
      return {
        ok: false,
        errors: ["Resolved manifest must match the queried rollupId and version."],
      };
    }
    resolvedRespondent = {
      kind: "model_rollup",
      manifest: {
        rollupId: manifest.rollupId,
        version: manifest.version,
        aggregationPolicy: manifest.aggregationPolicy,
        name: manifest.name,
        memberConfigurationIds: dedupPreserveOrder(manifest.memberConfigurationIds),
        createdAt: manifest.createdAt,
      },
    };
  }
  return { ok: true, resolvedRespondent };
}

// --- Receipt / serialization --------------------------------------------------

function fingerprintAbbreviation(fp: string): string {
  return fp.slice(0, "sha256:".length + 12);
}

/**
 * Validate, canonicalize, resolve the respondent, and produce a
 * {@link ModelEvidenceQueryReceipt} carrying the fingerprint, canonical
 * serialization, resolved manifest, and active-filter summary. `generatedAt`
 * is wall-clock time (default `Date.now()`) and is NOT part of the fingerprint.
 * Throws on invalid input or an unresolved rollup.
 */
export function serializeModelEvidenceQuery(
  query: ModelEvidenceQuery,
  resolver?: RollupVersionResolver,
  now: number = Date.now(),
): ModelEvidenceQueryReceipt {
  const result = validateModelEvidenceQuery(query, resolver);
  if (!result.ok) {
    throw new Error(`Invalid ModelEvidenceQuery: ${result.errors.join(" ")}`);
  }
  const canon = canonicalQueryUnchecked(query);
  const canonicalSerialization = canonicalJsonString(canonicalSerializableObject(canon));
  const fingerprint = hashArtifactContent(canonicalSerialization);
  return {
    fingerprint,
    fingerprintAbbreviation: fingerprintAbbreviation(fingerprint),
    canonicalSerialization,
    resolvedRespondent: result.resolvedRespondent,
    generatedAt: now,
    observedFrom: canon.observedFrom,
    observedTo: canon.observedTo,
    activeFilters: {
      observedFrom: canon.observedFrom,
      observedTo: canon.observedTo,
      taskFamilyIds: canon.taskFamilyIds,
      facetFilters: canon.facetFilters,
      evidenceClasses: canon.evidenceClasses,
      allowedUses: canon.allowedUses,
      comparabilityCohortIds: canon.comparabilityCohortIds,
      sourceKinds: canon.sourceKinds,
      rubricRefs: canon.rubricRefs,
      evaluatorFilters: canon.evaluatorFilters,
      includeUnknownVersion: canon.includeUnknownVersion,
    },
  };
}

// --- URL-state codec -----------------------------------------------------------

const URL_PARAM_KEYS = [
  "q.aggregationRuleVersion",
  "q.allowedUses",
  "q.comparabilityCohortIds",
  "q.eligibilityRuleVersion",
  "q.evaluatorFilters",
  "q.evidenceClasses",
  "q.facetFilters",
  "q.includeUnknownVersion",
  "q.observedFrom",
  "q.observedTo",
  "q.rubricRefs",
  "q.sourceKinds",
  "q.taskFamilyIds",
  "q.uncertaintyRuleVersion",
] as const;

function joinStrings(arr: readonly string[]): string {
  return arr.join(",");
}

function splitStrings(value: string): string[] {
  if (value === "") return [];
  return value.split(",");
}

function encodeRubricRefs(refs: readonly VersionRef[]): string {
  return refs.map((r) => `${r.id}@${r.version}`).join(",");
}

function decodeRubricRefs(value: string): VersionRef[] {
  if (value === "") return [];
  return value.split(",").map((pair) => {
    const at = pair.lastIndexOf("@");
    if (at <= 0) throw new Error(`Malformed rubric ref "${pair}".`);
    const id = pair.slice(0, at);
    const version = Number(pair.slice(at + 1));
    if (!isNonBlankString(id) || !isPositiveInteger(version)) {
      throw new Error(`Malformed rubric ref "${pair}".`);
    }
    return { id, version };
  });
}

/**
 * Encode a query into deterministic, sorted URL search params. Equivalent
 * permutations produce identical param strings. Throws on invalid input.
 */
export function encodeModelEvidenceQueryToUrl(query: ModelEvidenceQuery): URLSearchParams {
  // Structural validation only — URL state encodes the rollup pin, not the
  // resolved manifest (resolution is a separate, repository-backed concern).
  const errors = structuralErrors(query);
  if (errors.length > 0) {
    throw new Error(`Invalid ModelEvidenceQuery: ${errors.join(" ")}`);
  }
  const canon = canonicalQueryUnchecked(query);
  const params = new URLSearchParams();
  // Respondent params (inserted in sorted order among the rest by key name).
  params.set("q.respondent.kind", canon.respondent.kind);
  if (canon.respondent.kind === "model_configuration") {
    params.set("q.respondent.modelConfigurationId", canon.respondent.modelConfigurationId);
  } else {
    params.set("q.respondent.rollupId", canon.respondent.rollupId);
    params.set("q.respondent.version", String(canon.respondent.version));
    params.set("q.respondent.aggregationPolicy", canon.respondent.aggregationPolicy);
  }
  if (canon.observedFrom !== null) params.set("q.observedFrom", String(canon.observedFrom));
  if (canon.observedTo !== null) params.set("q.observedTo", String(canon.observedTo));
  if (canon.taskFamilyIds.length > 0) params.set("q.taskFamilyIds", joinStrings(canon.taskFamilyIds));
  if (canon.facetFilters.length > 0) params.set("q.facetFilters", JSON.stringify(canon.facetFilters));
  if (canon.evidenceClasses.length > 0) params.set("q.evidenceClasses", joinStrings(canon.evidenceClasses));
  if (canon.allowedUses.length > 0) params.set("q.allowedUses", joinStrings(canon.allowedUses));
  if (canon.comparabilityCohortIds.length > 0) {
    params.set("q.comparabilityCohortIds", joinStrings(canon.comparabilityCohortIds));
  }
  if (canon.sourceKinds.length > 0) params.set("q.sourceKinds", joinStrings(canon.sourceKinds));
  if (canon.rubricRefs.length > 0) params.set("q.rubricRefs", encodeRubricRefs(canon.rubricRefs));
  if (canon.evaluatorFilters.length > 0) {
    params.set("q.evaluatorFilters", JSON.stringify(canon.evaluatorFilters));
  }
  params.set("q.includeUnknownVersion", String(canon.includeUnknownVersion));
  params.set("q.eligibilityRuleVersion", String(canon.eligibilityRuleVersion));
  params.set("q.aggregationRuleVersion", String(canon.aggregationRuleVersion));
  params.set("q.uncertaintyRuleVersion", String(canon.uncertaintyRuleVersion));
  return sortParams(params);
}

function sortParams(params: URLSearchParams): URLSearchParams {
  const sorted = new URLSearchParams();
  const entries = Array.from(params.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [k, v] of entries) sorted.set(k, v);
  return sorted;
}

/**
 * Decode URL search params (or a record / URLSearchParams) back into a
 * canonical, validated {@link ModelEvidenceQuery}. Throws on malformed or
 * ambiguous input (including unsupported rule versions and ambiguous respondents).
 */
export function decodeModelEvidenceQueryFromUrl(
  source: URLSearchParams | Record<string, string>,
): ModelEvidenceQuery {
  const params: URLSearchParams =
    source instanceof URLSearchParams ? source : new URLSearchParams(source);
  const get = (key: string): string | null => {
    const v = params.get(key);
    return v === null ? null : v;
  };

  const kind = get("q.respondent.kind");
  if (kind !== "model_configuration" && kind !== "model_rollup") {
    throw new Error("q.respondent.kind must be 'model_configuration' or 'model_rollup'.");
  }

  const hasModelConfigId = get("q.respondent.modelConfigurationId") !== null;
  const hasRollupId = get("q.respondent.rollupId") !== null;
  const hasRollupVersion = get("q.respondent.version") !== null;
  const hasRollupPolicy = get("q.respondent.aggregationPolicy") !== null;

  let respondent: ProfileRespondent;
  if (kind === "model_configuration") {
    if (hasRollupId || hasRollupVersion || hasRollupPolicy) {
      throw new Error("Ambiguous respondent: model_configuration kind must not carry rollup fields.");
    }
    const id = get("q.respondent.modelConfigurationId");
    if (id === null) throw new Error("q.respondent.modelConfigurationId is required for model_configuration.");
    respondent = { kind: "model_configuration", modelConfigurationId: id };
  } else {
    if (hasModelConfigId) {
      throw new Error("Ambiguous respondent: model_rollup kind must not carry modelConfigurationId.");
    }
    const rollupId = get("q.respondent.rollupId");
    const versionRaw = get("q.respondent.version");
    const policy = get("q.respondent.aggregationPolicy");
    if (rollupId === null || versionRaw === null || policy === null) {
      throw new Error("q.respondent.rollupId, version, and aggregationPolicy are required for model_rollup.");
    }
    const version = Number(versionRaw);
    respondent = {
      kind: "model_rollup",
      rollupId,
      version,
      aggregationPolicy: policy as "stratified_only",
    };
  }

  const parseNumOrNull = (key: string): number | null => {
    const raw = get(key);
    if (raw === null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} must be a finite number.`);
    return n;
  };

  const observedFrom = parseNumOrNull("q.observedFrom");
  const observedTo = parseNumOrNull("q.observedTo");

  const taskFamilyIds = get("q.taskFamilyIds") !== null ? splitStrings(get("q.taskFamilyIds")!) : [];
  const evidenceClasses = get("q.evidenceClasses") !== null ? splitStrings(get("q.evidenceClasses")!) : [];
  const allowedUses = get("q.allowedUses") !== null ? splitStrings(get("q.allowedUses")!) : [];
  const comparabilityCohortIds =
    get("q.comparabilityCohortIds") !== null ? splitStrings(get("q.comparabilityCohortIds")!) : [];
  const sourceKinds = get("q.sourceKinds") !== null ? splitStrings(get("q.sourceKinds")!) : [];

  const rubricRefsRaw = get("q.rubricRefs");
  const rubricRefs = rubricRefsRaw !== null ? decodeRubricRefs(rubricRefsRaw) : [];

  const facetFiltersRaw = get("q.facetFilters");
  let facetFilters: FacetFilter[] = [];
  if (facetFiltersRaw !== null) {
    const parsed: unknown = JSON.parse(facetFiltersRaw);
    if (!Array.isArray(parsed)) throw new Error("q.facetFilters must be a JSON array.");
    facetFilters = parsed as FacetFilter[];
  }

  const evaluatorFiltersRaw = get("q.evaluatorFilters");
  let evaluatorFilters: EvaluatorFilter[] = [];
  if (evaluatorFiltersRaw !== null) {
    const parsed: unknown = JSON.parse(evaluatorFiltersRaw);
    if (!Array.isArray(parsed)) throw new Error("q.evaluatorFilters must be a JSON array.");
    evaluatorFilters = parsed as EvaluatorFilter[];
  }

  const includeUnknownVersionRaw = get("q.includeUnknownVersion");
  if (includeUnknownVersionRaw !== "true" && includeUnknownVersionRaw !== "false") {
    throw new Error("q.includeUnknownVersion must be 'true' or 'false'.");
  }
  const includeUnknownVersion = includeUnknownVersionRaw === "true";

  const eligibilityRuleVersionRaw = get("q.eligibilityRuleVersion");
  const aggregationRuleVersionRaw = get("q.aggregationRuleVersion");
  const uncertaintyRuleVersionRaw = get("q.uncertaintyRuleVersion");
  if (eligibilityRuleVersionRaw === null || aggregationRuleVersionRaw === null || uncertaintyRuleVersionRaw === null) {
    throw new Error("Rule version params are required.");
  }

  const query: ModelEvidenceQuery = {
    respondent,
    observedFrom,
    observedTo,
    taskFamilyIds,
    facetFilters,
    evidenceClasses: evidenceClasses as EvidenceClass[],
    allowedUses: allowedUses as EvidenceUse[],
    comparabilityCohortIds,
    sourceKinds: sourceKinds as ObservationSourceKind[],
    rubricRefs,
    evaluatorFilters,
    includeUnknownVersion,
    eligibilityRuleVersion: Number(eligibilityRuleVersionRaw),
    aggregationRuleVersion: Number(aggregationRuleVersionRaw),
    uncertaintyRuleVersion: Number(uncertaintyRuleVersionRaw),
  };

  // Validate + canonicalize (no resolver: manifest resolution is a separate
  // concern from URL state; the rollup pin is structurally checked here).
  const errors = structuralErrors(query);
  if (errors.length > 0) {
    throw new Error(`Invalid decoded ModelEvidenceQuery: ${errors.join(" ")}`);
  }
  return canonicalQueryUnchecked(query);
}

// Re-export for callers that want the prohibited-key vocabulary the query rejects.
export { EVIDENCE_PROHIBITED_KEYS, URL_PARAM_KEYS as MODEL_EVIDENCE_QUERY_URL_PARAM_KEYS };
