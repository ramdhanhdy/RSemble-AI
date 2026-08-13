// =============================================================================
// RSemble AI — Canonical Task runtime validators
//
// Child 02 (Canonical Tasks) Milestone A — Task 1.
//
// Reuses the project's confirmed validation idioms (probe-P1-task-domain-
// patterns): the canonical PROHIBITED_KEYS 6-key set + CREDENTIAL_LIKE_VALUE
// regex, deep `hasProhibitedKeys` scan on every persisted record, boolean `is*`
// guards for persistence-boundary checks, and `{valid, errors}` validators for
// field-specific diagnostics. No unchecked casts at the persistence boundary.
// =============================================================================

import type {
  ContextManifestEntry,
  FacetTaxonomyValue,
  NormalizedTaskInput,
  ResponseContract,
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFacetDimension,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskInstance,
  TaskInstanceSourceRef,
  TaskInputCompleteness,
  TaskRecord,
  TaskSource,
  TaskVersion,
  VersionRef,
} from "./task-types";

/** Keys that must never appear in a persisted Task record. Same canonical
 *  6-key set as evaluation-types/run-types/archive. */
export const PROHIBITED_KEYS: ReadonlySet<string> = new Set([
  "apiKey",
  "authorization",
  "token",
  "secret",
  "password",
  "env",
]);

/** Auth/credential-shape pattern for authored identifiers and indexed metadata.
 *  Matches the canonical guard from `evaluation-types.ts`. */
export const CREDENTIAL_LIKE_VALUE = /^(sk-|AIza|Bearer\s)/i;

/** Opaque ID pattern (archive `IMPORT_LIMITS.ID_PATTERN`). */
export const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Content/input digest pattern: `sha256:<lowercase hex>`. */
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export const TASK_FACET_DIMENSIONS: readonly TaskFacetDimension[] = [
  "domain",
  "task-form",
  "transformation",
  "constraint",
  "interaction-mode",
  "modality",
  "evaluation-type",
  "setting",
];

export const TASK_INPUT_COMPLETENESS_VALUES: readonly TaskInputCompleteness[] = [
  "complete",
  "metadata_only",
  "incomplete",
];

// --- Facet taxonomy allowlist seam (spec §3.6) -----------------------------
//
// A stable, read-only allowlist over the eight specification dimensions and
// the taxonomy versions needed by Task 8 UI. This is a query seam only: it
// does not invent automatic classification, does not own a mutable global
// taxonomy, and does not infer a universal capability tree. Task 8 UI reads
// the allowlist to render facet choices; annotations still record their own
// `taxonomyVersion` and `facetId`/`valueId` identity.

/** Taxonomy versions shipped by this child. Additive only — a new version
 *  never rewrites an older value's identity. */
export const FACET_TAXONOMY_VERSIONS: readonly number[] = Object.freeze([1]);

/** A single allowlisted taxonomy value. */
interface FacetTaxonomySeedValue {
  facetId: string;
  valueId: string;
  label: string;
  taxonomyVersion: number;
}

/** The full allowlisted facet taxonomy across all shipped versions. Frozen so
 *  callers cannot mutate global taxonomy ownership through the seam. */
export const FACET_TAXONOMY_VALUES: readonly FacetTaxonomyValue[] = Object.freeze(
  ((): FacetTaxonomySeedValue[] => {
    const v1: FacetTaxonomySeedValue[] = [
      // domain
      { facetId: "domain", valueId: "nlp", label: "Natural language", taxonomyVersion: 1 },
      { facetId: "domain", valueId: "code", label: "Code & software", taxonomyVersion: 1 },
      { facetId: "domain", valueId: "math", label: "Mathematics & reasoning", taxonomyVersion: 1 },
      { facetId: "domain", valueId: "multimodal", label: "Multimodal", taxonomyVersion: 1 },
      { facetId: "domain", valueId: "knowledge-retrieval", label: "Knowledge & retrieval", taxonomyVersion: 1 },
      // task-form
      { facetId: "task-form", valueId: "generation", label: "Generation", taxonomyVersion: 1 },
      { facetId: "task-form", valueId: "summarization", label: "Summarization", taxonomyVersion: 1 },
      { facetId: "task-form", valueId: "classification", label: "Classification", taxonomyVersion: 1 },
      { facetId: "task-form", valueId: "extraction", label: "Extraction", taxonomyVersion: 1 },
      { facetId: "task-form", valueId: "translation", label: "Translation", taxonomyVersion: 1 },
      { facetId: "task-form", valueId: "rewriting", label: "Rewriting", taxonomyVersion: 1 },
      { facetId: "task-form", valueId: "open-ended-q-a", label: "Open-ended Q&A", taxonomyVersion: 1 },
      // transformation
      { facetId: "transformation", valueId: "none", label: "None (direct answer)", taxonomyVersion: 1 },
      { facetId: "transformation", valueId: "reformat", label: "Reformat", taxonomyVersion: 1 },
      { facetId: "transformation", valueId: "compress", label: "Compress", taxonomyVersion: 1 },
      { facetId: "transformation", valueId: "expand", label: "Expand", taxonomyVersion: 1 },
      { facetId: "transformation", valueId: "reorder", label: "Reorder", taxonomyVersion: 1 },
      // constraint
      { facetId: "constraint", valueId: "none", label: "None", taxonomyVersion: 1 },
      { facetId: "constraint", valueId: "length", label: "Length bound", taxonomyVersion: 1 },
      { facetId: "constraint", valueId: "format", label: "Format bound", taxonomyVersion: 1 },
      { facetId: "constraint", valueId: "style", label: "Style bound", taxonomyVersion: 1 },
      { facetId: "constraint", valueId: "safety", label: "Safety bound", taxonomyVersion: 1 },
      // interaction-mode
      { facetId: "interaction-mode", valueId: "single-turn", label: "Single-turn", taxonomyVersion: 1 },
      { facetId: "interaction-mode", valueId: "multi-turn", label: "Multi-turn", taxonomyVersion: 1 },
      { facetId: "interaction-mode", valueId: "tool-use", label: "Tool use", taxonomyVersion: 1 },
      { facetId: "interaction-mode", valueId: "agentic", label: "Agentic", taxonomyVersion: 1 },
      // modality
      { facetId: "modality", valueId: "text-in-text-out", label: "Text → Text", taxonomyVersion: 1 },
      { facetId: "modality", valueId: "image-in-text-out", label: "Image → Text", taxonomyVersion: 1 },
      { facetId: "modality", valueId: "text-in-image-out", label: "Text → Image", taxonomyVersion: 1 },
      { facetId: "modality", valueId: "audio-in-text-out", label: "Audio → Text", taxonomyVersion: 1 },
      { facetId: "modality", valueId: "multimodal", label: "Multimodal", taxonomyVersion: 1 },
      // evaluation-type
      { facetId: "evaluation-type", valueId: "human-judgment", label: "Human judgment", taxonomyVersion: 1 },
      { facetId: "evaluation-type", valueId: "rubric-scored", label: "Rubric-scored", taxonomyVersion: 1 },
      { facetId: "evaluation-type", valueId: "reference-match", label: "Reference match", taxonomyVersion: 1 },
      { facetId: "evaluation-type", valueId: "programmatic", label: "Programmatic / verifier", taxonomyVersion: 1 },
      { facetId: "evaluation-type", valueId: "preference-pair", label: "Preference pair", taxonomyVersion: 1 },
      // setting
      { facetId: "setting", valueId: "research", label: "Research", taxonomyVersion: 1 },
      { facetId: "setting", valueId: "production", label: "Production", taxonomyVersion: 1 },
      { facetId: "setting", valueId: "evaluation-benchmark", label: "Evaluation benchmark", taxonomyVersion: 1 },
      { facetId: "setting", valueId: "safety-audit", label: "Safety audit", taxonomyVersion: 1 },
    ];
    return v1;
  })(),
);

/** Read-only query: return the allowlisted taxonomy values for a version.
 *  Returns `[]` for an unknown version — the seam never infers values for a
 *  version it does not ship. */
export function getFacetTaxonomyValues(taxonomyVersion: number): readonly FacetTaxonomyValue[] {
  if (!Number.isInteger(taxonomyVersion) || taxonomyVersion <= 0) return [];
  return FACET_TAXONOMY_VALUES.filter((v) => v.taxonomyVersion === taxonomyVersion);
}

export interface TaskValidationError {
  field: string;
  message: string;
}

export interface TaskValidationResult {
  valid: boolean;
  errors: TaskValidationError[];
}

function result(errors: TaskValidationError[]): TaskValidationResult {
  return { valid: errors.length === 0, errors };
}

// --- primitive guards -------------------------------------------------------

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isNumber(v: unknown): v is number {
  return typeof v === "number" && !Number.isNaN(v);
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Deep recursive scan for prohibited credential/transport keys (arrays +
 *  records). Mirrors `evaluation-types.ts` `hasProhibitedKeys`. */
export function hasProhibitedKeys(v: unknown): boolean {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (hasProhibitedKeys(item)) return true;
    }
    return false;
  }
  if (isRecord(v)) {
    for (const key of Object.keys(v)) {
      if (PROHIBITED_KEYS.has(key)) return true;
      if (hasProhibitedKeys(v[key])) return true;
    }
  }
  return false;
}

/** Reject credential-shaped values on an authored identifier / indexed field. */
function isSafeIdentifier(v: unknown): v is string {
  return isNonEmptyString(v) && !CREDENTIAL_LIKE_VALUE.test(v);
}

function isId(v: unknown): v is string {
  return isString(v) && ID_PATTERN.test(v);
}

function isDigest(v: unknown): v is string {
  return isString(v) && DIGEST_PATTERN.test(v);
}

function isPositiveInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v > 0;
}

function isNonNegativeInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v) && v >= 0;
}

// --- supporting type guards -------------------------------------------------

export function isVersionRef(v: unknown): v is VersionRef {
  return (
    isRecord(v) &&
    isId(v.id) &&
    isPositiveInteger(v.version) &&
    !hasProhibitedKeys(v)
  );
}

export function isTaskSource(v: unknown): v is TaskSource {
  if (!isRecord(v)) return false;
  if (v.kind !== "authored" && v.kind !== "legacy-task-set" && v.kind !== "imported") {
    return false;
  }
  if (v.legacyScopeKey !== null && !isString(v.legacyScopeKey)) return false;
  if (v.note !== null && !isString(v.note)) return false;
  return !hasProhibitedKeys(v);
}

export function isContextManifestEntry(v: unknown): v is ContextManifestEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.role)) return false;
  if (v.artifactId !== null && !isId(v.artifactId)) return false;
  if (v.externalRef !== null && !isNonEmptyString(v.externalRef)) return false;
  if (v.metadataDigest !== null && !isDigest(v.metadataDigest)) return false;
  if (v.mediaType !== null && !isNonEmptyString(v.mediaType)) return false;
  if (v.byteCount !== null && !isNonNegativeInteger(v.byteCount)) return false;
  // An entry must resolve to a local artifact or an external provenance ref.
  if (v.artifactId === null && v.externalRef === null) return false;
  return !hasProhibitedKeys(v);
}

export function isResponseContract(v: unknown): v is ResponseContract {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.format)) return false;
  if (!isStringArray(v.constraints)) return false;
  if (v.maxLength !== null && !isPositiveInteger(v.maxLength)) return false;
  return !hasProhibitedKeys(v);
}

export function isNormalizedTaskInput(v: unknown): v is NormalizedTaskInput {
  if (!isRecord(v)) return false;
  if (!isString(v.text)) return false;
  if (!Array.isArray(v.artifactIds)) return false;
  for (const a of v.artifactIds) {
    if (!isId(a)) return false;
  }
  if (!isRecord(v.metadata)) return false;
  for (const val of Object.values(v.metadata)) {
    if (typeof val !== "string") return false;
  }
  return !hasProhibitedKeys(v);
}

export function isTaskInstanceSourceRef(v: unknown): v is TaskInstanceSourceRef {
  if (!isRecord(v)) return false;
  if (
    v.kind !== "authored" &&
    v.kind !== "legacy-task-set" &&
    v.kind !== "comparison" &&
    v.kind !== "imported"
  ) {
    return false;
  }
  if (v.legacyScopeKey !== null && !isString(v.legacyScopeKey)) return false;
  if (v.originId !== null && !isId(v.originId)) return false;
  return !hasProhibitedKeys(v);
}

export function isFacetTaxonomyValue(v: unknown): v is FacetTaxonomyValue {
  if (!isRecord(v)) return false;
  if (!isSafeIdentifier(v.facetId)) return false;
  if (!isSafeIdentifier(v.valueId)) return false;
  if (!isNonEmptyString(v.label)) return false;
  if (!isPositiveInteger(v.taxonomyVersion)) return false;
  return !hasProhibitedKeys(v);
}

// --- canonical entity guards ------------------------------------------------

export function isTaskRecord(v: unknown): v is TaskRecord {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isPositiveInteger(v.latestVersion)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;
  if (
    v.origin !== "authored" &&
    v.origin !== "legacy-task-set" &&
    v.origin !== "promoted-comparison" &&
    v.origin !== "imported"
  ) {
    return false;
  }
  if (!isNonNegativeInteger(v.revision)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskVersion(v: unknown): v is TaskVersion {
  if (!isRecord(v)) return false;
  if (!isId(v.taskId)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isNonEmptyString(v.title)) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isString(v.candidateInstruction)) return false;
  if (!Array.isArray(v.defaultContextManifest)) return false;
  for (const e of v.defaultContextManifest) {
    if (!isContextManifestEntry(e)) return false;
  }
  if (v.responseContract !== null && !isResponseContract(v.responseContract)) return false;
  if (v.taskVerifierRef !== null && !isVersionRef(v.taskVerifierRef)) return false;
  if (!isTaskSource(v.source)) return false;
  if (!isNumber(v.createdAt)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskArtifact(v: unknown): v is TaskArtifact {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isDigest(v.contentDigest)) return false;
  if (!isNonEmptyString(v.mediaType)) return false;
  if (!isNonNegativeInteger(v.byteCount)) return false;
  // Secret-shape check on the indexed storage ref.
  if (!isSafeIdentifier(v.storageRef)) return false;
  if (!isNumber(v.createdAt)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskInstance(v: unknown): v is TaskInstance {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isId(v.taskId)) return false;
  if (!isPositiveInteger(v.taskVersion)) return false;
  if (!isNormalizedTaskInput(v.normalizedInput)) return false;
  if (!Array.isArray(v.contextManifest)) return false;
  for (const e of v.contextManifest) {
    if (!isContextManifestEntry(e)) return false;
  }
  if (!isDigest(v.inputDigest)) return false;
  if (
    v.inputCompleteness !== "complete" &&
    v.inputCompleteness !== "metadata_only" &&
    v.inputCompleteness !== "incomplete"
  ) {
    return false;
  }
  if (!isNumber(v.createdAt)) return false;
  if (!isTaskInstanceSourceRef(v.sourceRef)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskFamily(v: unknown): v is TaskFamily {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (!isString(v.description)) return false;
  if (v.parentFamilyId !== null && !isId(v.parentFamilyId)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNumber(v.updatedAt)) return false;
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;
  if (!isNonNegativeInteger(v.revision)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskFamilyRelation(v: unknown): v is TaskFamilyRelation {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isId(v.fromFamilyId)) return false;
  if (!isId(v.toFamilyId)) return false;
  if (v.kind !== "overlap" && v.kind !== "parent" && v.kind !== "derivative") return false;
  if (v.fromFamilyId === v.toFamilyId) return false; // no self-relation
  if (!isNumber(v.createdAt)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskFamilyAssignment(v: unknown): v is TaskFamilyAssignment {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isId(v.taskId)) return false;
  if (!isPositiveInteger(v.taskVersion)) return false;
  if (!isId(v.familyId)) return false;
  if (!isBoolean(v.isPrimary)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (!isNonNegativeInteger(v.revision)) return false;
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) return false;
  return !hasProhibitedKeys(v);
}

export function isTaskFacetAnnotation(v: unknown): v is TaskFacetAnnotation {
  if (!isRecord(v)) return false;
  if (!isId(v.id)) return false;
  if (!isId(v.taskId)) return false;
  if (v.taskVersion !== null && !isPositiveInteger(v.taskVersion)) return false;
  // Secret-shape checks on indexed facet/value identifiers.
  if (!isSafeIdentifier(v.facetId)) return false;
  if (!isSafeIdentifier(v.valueId)) return false;
  if (v.source !== "authored" && v.source !== "imported" && v.source !== "suggested") return false;
  if (v.authorKind !== "user" && v.authorKind !== "migration" && v.authorKind !== "system") {
    return false;
  }
  if (v.confidence !== null) {
    if (!isNumber(v.confidence) || v.confidence < 0 || v.confidence > 1) return false;
  }
  if (!isPositiveInteger(v.taxonomyVersion)) return false;
  if (!isNumber(v.createdAt)) return false;
  if (v.supersedesId !== null && !isId(v.supersedesId)) return false;
  return !hasProhibitedKeys(v);
}

// --- {valid, errors} validators --------------------------------------------

export function validateTaskRecord(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskRecord must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isPositiveInteger(v.latestVersion)) {
    errors.push({ field: "latestVersion", message: "latestVersion must be a positive integer." });
  }
  if (!isNumber(v.createdAt)) errors.push({ field: "createdAt", message: "createdAt must be a number." });
  if (!isNumber(v.updatedAt)) errors.push({ field: "updatedAt", message: "updatedAt must be a number." });
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) {
    errors.push({ field: "archivedAt", message: "archivedAt must be a number or null." });
  }
  if (
    v.origin !== "authored" &&
    v.origin !== "legacy-task-set" &&
    v.origin !== "promoted-comparison" &&
    v.origin !== "imported"
  ) {
    errors.push({ field: "origin", message: "origin has an invalid value." });
  }
  if (!isNonNegativeInteger(v.revision)) {
    errors.push({ field: "revision", message: "revision must be a non-negative integer." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskRecord carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskVersion(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskVersion must be an object." }]);
  }
  if (!isId(v.taskId)) errors.push({ field: "taskId", message: "taskId must match the opaque ID pattern." });
  if (!isPositiveInteger(v.version)) {
    errors.push({ field: "version", message: "version must be a positive integer." });
  }
  if (!isNonEmptyString(v.title)) errors.push({ field: "title", message: "title is required." });
  if (!isNonEmptyString(v.objective)) errors.push({ field: "objective", message: "objective is required." });
  if (!isString(v.candidateInstruction)) {
    errors.push({ field: "candidateInstruction", message: "candidateInstruction must be a string." });
  }
  if (!Array.isArray(v.defaultContextManifest)) {
    errors.push({ field: "defaultContextManifest", message: "defaultContextManifest must be an array." });
  } else {
    v.defaultContextManifest.forEach((e, i) => {
      if (!isContextManifestEntry(e)) {
        errors.push({
          field: `defaultContextManifest[${i}]`,
          message: "context manifest entry is malformed.",
        });
      }
    });
  }
  if (v.responseContract !== null && !isResponseContract(v.responseContract)) {
    errors.push({ field: "responseContract", message: "responseContract is malformed." });
  }
  if (v.taskVerifierRef !== null && !isVersionRef(v.taskVerifierRef)) {
    errors.push({ field: "taskVerifierRef", message: "taskVerifierRef must be a VersionRef or null." });
  }
  if (!isTaskSource(v.source)) {
    errors.push({ field: "source", message: "source is malformed." });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskVersion carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskArtifact(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskArtifact must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isDigest(v.contentDigest)) {
    errors.push({ field: "contentDigest", message: "contentDigest must be 'sha256:<64 hex>'." });
  }
  if (!isNonEmptyString(v.mediaType)) {
    errors.push({ field: "mediaType", message: "mediaType is required." });
  }
  if (!isNonNegativeInteger(v.byteCount)) {
    errors.push({ field: "byteCount", message: "byteCount must be a non-negative integer." });
  }
  if (!isSafeIdentifier(v.storageRef)) {
    errors.push({ field: "storageRef", message: "storageRef is required and must not be credential-shaped." });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskArtifact carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskInstance(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskInstance must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isId(v.taskId)) errors.push({ field: "taskId", message: "taskId must match the opaque ID pattern." });
  if (!isPositiveInteger(v.taskVersion)) {
    errors.push({ field: "taskVersion", message: "taskVersion must be a positive integer." });
  }
  if (!isNormalizedTaskInput(v.normalizedInput)) {
    errors.push({ field: "normalizedInput", message: "normalizedInput is malformed." });
  }
  if (!Array.isArray(v.contextManifest)) {
    errors.push({ field: "contextManifest", message: "contextManifest must be an array." });
  } else {
    v.contextManifest.forEach((e, i) => {
      if (!isContextManifestEntry(e)) {
        errors.push({
          field: `contextManifest[${i}]`,
          message: "context manifest entry is malformed.",
        });
      }
    });
  }
  if (!isDigest(v.inputDigest)) {
    errors.push({ field: "inputDigest", message: "inputDigest must be 'sha256:<64 hex>'." });
  }
  if (
    v.inputCompleteness !== "complete" &&
    v.inputCompleteness !== "metadata_only" &&
    v.inputCompleteness !== "incomplete"
  ) {
    errors.push({ field: "inputCompleteness", message: "inputCompleteness has an invalid value." });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (!isTaskInstanceSourceRef(v.sourceRef)) {
    errors.push({ field: "sourceRef", message: "sourceRef is malformed." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskInstance carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskFamily(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskFamily must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isNonEmptyString(v.name)) errors.push({ field: "name", message: "name is required." });
  if (!isString(v.description)) errors.push({ field: "description", message: "description must be a string." });
  if (v.parentFamilyId !== null && !isId(v.parentFamilyId)) {
    errors.push({ field: "parentFamilyId", message: "parentFamilyId must match the ID pattern or be null." });
  }
  if (!isNumber(v.createdAt)) errors.push({ field: "createdAt", message: "createdAt must be a number." });
  if (!isNumber(v.updatedAt)) errors.push({ field: "updatedAt", message: "updatedAt must be a number." });
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) {
    errors.push({ field: "archivedAt", message: "archivedAt must be a number or null." });
  }
  if (!isNonNegativeInteger(v.revision)) {
    errors.push({ field: "revision", message: "revision must be a non-negative integer." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskFamily carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskFamilyAssignment(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskFamilyAssignment must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isId(v.taskId)) errors.push({ field: "taskId", message: "taskId must match the opaque ID pattern." });
  if (!isPositiveInteger(v.taskVersion)) {
    errors.push({ field: "taskVersion", message: "taskVersion must be a positive integer." });
  }
  if (!isId(v.familyId)) errors.push({ field: "familyId", message: "familyId must match the opaque ID pattern." });
  if (!isBoolean(v.isPrimary)) errors.push({ field: "isPrimary", message: "isPrimary must be a boolean." });
  if (!isNumber(v.createdAt)) errors.push({ field: "createdAt", message: "createdAt must be a number." });
  if (!isNonNegativeInteger(v.revision)) {
    errors.push({ field: "revision", message: "revision must be a non-negative integer." });
  }
  if (v.archivedAt !== null && !isNumber(v.archivedAt)) {
    errors.push({ field: "archivedAt", message: "archivedAt must be a number or null." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskFamilyAssignment carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskFacetAnnotation(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskFacetAnnotation must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isId(v.taskId)) errors.push({ field: "taskId", message: "taskId must match the opaque ID pattern." });
  if (v.taskVersion !== null && !isPositiveInteger(v.taskVersion)) {
    errors.push({ field: "taskVersion", message: "taskVersion must be a positive integer or null." });
  }
  if (!isSafeIdentifier(v.facetId)) {
    errors.push({ field: "facetId", message: "facetId is required and must not be credential-shaped." });
  }
  if (!isSafeIdentifier(v.valueId)) {
    errors.push({ field: "valueId", message: "valueId is required and must not be credential-shaped." });
  }
  if (v.source !== "authored" && v.source !== "imported" && v.source !== "suggested") {
    errors.push({ field: "source", message: "source has an invalid value." });
  }
  if (v.authorKind !== "user" && v.authorKind !== "migration" && v.authorKind !== "system") {
    errors.push({ field: "authorKind", message: "authorKind has an invalid value." });
  }
  if (v.confidence !== null) {
    if (!isNumber(v.confidence) || v.confidence < 0 || v.confidence > 1) {
      errors.push({ field: "confidence", message: "confidence must be in [0,1] or null." });
    }
  }
  if (!isPositiveInteger(v.taxonomyVersion)) {
    errors.push({ field: "taxonomyVersion", message: "taxonomyVersion must be a positive integer." });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (v.supersedesId !== null && !isId(v.supersedesId)) {
    errors.push({ field: "supersedesId", message: "supersedesId must match the ID pattern or be null." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskFacetAnnotation carries prohibited credential/transport keys." });
  }
  return result(errors);
}

export function validateTaskFamilyRelation(v: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(v)) {
    return result([{ field: "", message: "TaskFamilyRelation must be an object." }]);
  }
  if (!isId(v.id)) errors.push({ field: "id", message: "id must match the opaque ID pattern." });
  if (!isId(v.fromFamilyId)) {
    errors.push({ field: "fromFamilyId", message: "fromFamilyId must match the opaque ID pattern." });
  }
  if (!isId(v.toFamilyId)) {
    errors.push({ field: "toFamilyId", message: "toFamilyId must match the opaque ID pattern." });
  }
  if (v.kind !== "overlap" && v.kind !== "parent" && v.kind !== "derivative") {
    errors.push({ field: "kind", message: "kind must be 'overlap' | 'parent' | 'derivative'." });
  }
  if (isId(v.fromFamilyId) && isId(v.toFamilyId) && v.fromFamilyId === v.toFamilyId) {
    errors.push({
      field: "fromFamilyId",
      message: "A family relation cannot reference itself (no self-relation).",
    });
  }
  if (!isNumber(v.createdAt)) {
    errors.push({ field: "createdAt", message: "createdAt must be a number." });
  }
  if (hasProhibitedKeys(v)) {
    errors.push({ field: "", message: "TaskFamilyRelation carries prohibited credential/transport keys." });
  }
  return result(errors);
}

// --- import payload validation ----------------------------------------------

/** Validate a Task import payload as a whole: structural validity of every
 *  entity, no duplicate IDs within a collection, no prohibited keys, and
 *  internal referential integrity (versions → tasks, instances → task+version,
 *  assignments → tasks+versions+families, annotations → tasks, supersession
 *  → annotations, artifact refs → artifacts). Version histories must be the
 *  contiguous range 1..TaskRecord.latestVersion. Non-identical ID collision
 *  remapping is child 09; this child only validates structure and internal
 *  references. */
export function validateTaskImport(payload: unknown): TaskValidationResult {
  const errors: TaskValidationError[] = [];
  if (!isRecord(payload)) {
    return result([{ field: "", message: "Task import payload must be an object." }]);
  }
  for (const key of [
    "tasks",
    "taskVersions",
    "taskArtifacts",
    "taskInstances",
    "taskFamilies",
    "taskFamilyAssignments",
    "taskFamilyRelations",
    "taskFacetAnnotations",
  ] as const) {
    if (!Array.isArray(payload[key])) {
      errors.push({ field: key, message: `${key} must be an array.` });
    }
  }
  if (errors.length > 0) return result(errors);

  const tasks = payload.tasks as unknown[];
  const versions = payload.taskVersions as unknown[];
  const artifacts = payload.taskArtifacts as unknown[];
  const instances = payload.taskInstances as unknown[];
  const families = payload.taskFamilies as unknown[];
  const assignments = payload.taskFamilyAssignments as unknown[];
  const relations = payload.taskFamilyRelations as unknown[];
  const annotations = payload.taskFacetAnnotations as unknown[];

  const taskIds = new Set<string>();
  const taskLatest = new Map<string, number>();
  const taskIndex = new Map<string, number>();
  tasks.forEach((t, i) => {
    const r = validateTaskRecord(t);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `tasks[${i}].${e.field}`, message: e.message });
    } else {
      const rec = t as TaskRecord;
      if (taskIds.has(rec.id)) {
        errors.push({ field: `tasks[${i}].id`, message: `duplicate task id ${rec.id}.` });
      } else {
        taskIds.add(rec.id);
        taskLatest.set(rec.id, rec.latestVersion);
        taskIndex.set(rec.id, i);
      }
    }
  });

  const versionKeys = new Set<string>();
  const validVersions: Array<{ i: number; v: TaskVersion }> = [];
  versions.forEach((ver, i) => {
    const r = validateTaskVersion(ver);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskVersions[${i}].${e.field}`, message: e.message });
    } else {
      const v = ver as TaskVersion;
      const key = `${v.taskId}@${v.version}`;
      if (versionKeys.has(key)) {
        errors.push({ field: `taskVersions[${i}]`, message: `duplicate version ${key}.` });
      } else {
        versionKeys.add(key);
        validVersions.push({ i, v });
      }
      if (!taskIds.has(v.taskId)) {
        errors.push({
          field: `taskVersions[${i}].taskId`,
          message: `version references unknown task ${v.taskId}.`,
        });
      }
    }
  });

  for (const [taskId, latest] of taskLatest) {
    const i = taskIndex.get(taskId) ?? 0;
    for (let n = 1; n <= latest; n++) {
      if (!versionKeys.has(`${taskId}@${n}`)) {
        errors.push({
          field: `tasks[${i}]`,
          message: `task ${taskId} is missing version ${n}.`,
        });
      }
    }
  }
  for (const { i, v } of validVersions) {
    const latest = taskLatest.get(v.taskId);
    if (latest !== undefined && v.version > latest) {
      errors.push({
        field: `taskVersions[${i}]`,
        message: `version ${v.taskId}@${v.version} exceeds latestVersion ${latest}.`,
      });
    }
  }

  const artifactIds = new Set<string>();
  artifacts.forEach((a, i) => {
    const r = validateTaskArtifact(a);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskArtifacts[${i}].${e.field}`, message: e.message });
    } else {
      const id = (a as TaskArtifact).id;
      if (artifactIds.has(id)) {
        errors.push({ field: `taskArtifacts[${i}].id`, message: `duplicate artifact id ${id}.` });
      } else {
        artifactIds.add(id);
      }
    }
  });

  for (const { i, v } of validVersions) {
    v.defaultContextManifest.forEach((entry, j) => {
      if (entry.artifactId !== null && !artifactIds.has(entry.artifactId)) {
        errors.push({
          field: `taskVersions[${i}].defaultContextManifest[${j}].artifactId`,
          message: `version references unknown artifact ${entry.artifactId}.`,
        });
      }
    });
  }

  const instanceIds = new Set<string>();
  instances.forEach((inst, i) => {
    const r = validateTaskInstance(inst);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskInstances[${i}].${e.field}`, message: e.message });
    } else {
      const x = inst as TaskInstance;
      if (instanceIds.has(x.id)) {
        errors.push({ field: `taskInstances[${i}].id`, message: `duplicate instance id ${x.id}.` });
      } else {
        instanceIds.add(x.id);
      }
      if (!taskIds.has(x.taskId)) {
        errors.push({
          field: `taskInstances[${i}].taskId`,
          message: `instance references unknown task ${x.taskId}.`,
        });
      }
      if (!versionKeys.has(`${x.taskId}@${x.taskVersion}`)) {
        errors.push({
          field: `taskInstances[${i}].taskVersion`,
          message: `instance references unknown version ${x.taskId}@${x.taskVersion}.`,
        });
      }
      x.normalizedInput.artifactIds.forEach((id, j) => {
        if (!artifactIds.has(id)) {
          errors.push({
            field: `taskInstances[${i}].normalizedInput.artifactIds[${j}]`,
            message: `instance references unknown artifact ${id}.`,
          });
        }
      });
      x.contextManifest.forEach((entry, j) => {
        if (entry.artifactId !== null && !artifactIds.has(entry.artifactId)) {
          errors.push({
            field: `taskInstances[${i}].contextManifest[${j}].artifactId`,
            message: `instance references unknown artifact ${entry.artifactId}.`,
          });
        }
      });
    }
  });

  const familyIds = new Set<string>();
  families.forEach((f, i) => {
    const r = validateTaskFamily(f);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskFamilies[${i}].${e.field}`, message: e.message });
    } else {
      const id = (f as TaskFamily).id;
      if (familyIds.has(id)) {
        errors.push({ field: `taskFamilies[${i}].id`, message: `duplicate family id ${id}.` });
      } else {
        familyIds.add(id);
      }
    }
  });
  families.forEach((f, i) => {
    if (isTaskFamily(f)) {
      const fam = f as TaskFamily;
      if (fam.parentFamilyId !== null) {
        if (fam.parentFamilyId === fam.id) {
          errors.push({ field: `taskFamilies[${i}].parentFamilyId`, message: "family cannot be its own parent." });
        } else if (!familyIds.has(fam.parentFamilyId)) {
          errors.push({
            field: `taskFamilies[${i}].parentFamilyId`,
            message: `family references unknown parent ${fam.parentFamilyId}.`,
          });
        }
      }
    }
  });

  assignments.forEach((a, i) => {
    const r = validateTaskFamilyAssignment(a);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskFamilyAssignments[${i}].${e.field}`, message: e.message });
    } else {
      const x = a as TaskFamilyAssignment;
      if (!taskIds.has(x.taskId)) {
        errors.push({
          field: `taskFamilyAssignments[${i}].taskId`,
          message: `assignment references unknown task ${x.taskId}.`,
        });
      }
      if (!versionKeys.has(`${x.taskId}@${x.taskVersion}`)) {
        errors.push({
          field: `taskFamilyAssignments[${i}].taskVersion`,
          message: `assignment references unknown version ${x.taskId}@${x.taskVersion}.`,
        });
      }
      if (!familyIds.has(x.familyId)) {
        errors.push({
          field: `taskFamilyAssignments[${i}].familyId`,
          message: `assignment references unknown family ${x.familyId}.`,
        });
      }
    }
  });

  const relationIds = new Set<string>();
  relations.forEach((rel, i) => {
    const r = validateTaskFamilyRelation(rel);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskFamilyRelations[${i}].${e.field}`, message: e.message });
    } else {
      const x = rel as TaskFamilyRelation;
      if (relationIds.has(x.id)) {
        errors.push({ field: `taskFamilyRelations[${i}].id`, message: `duplicate relation id ${x.id}.` });
      } else {
        relationIds.add(x.id);
      }
      if (!familyIds.has(x.fromFamilyId)) {
        errors.push({
          field: `taskFamilyRelations[${i}].fromFamilyId`,
          message: `relation references unknown family ${x.fromFamilyId}.`,
        });
      }
      if (!familyIds.has(x.toFamilyId)) {
        errors.push({
          field: `taskFamilyRelations[${i}].toFamilyId`,
          message: `relation references unknown family ${x.toFamilyId}.`,
        });
      }
      if (x.fromFamilyId === x.toFamilyId) {
        errors.push({
          field: `taskFamilyRelations[${i}].fromFamilyId`,
          message: "relation cannot reference the same family on both ends (self-relation).",
        });
      }
    }
  });

  const annotationIds = new Set<string>();
  const validAnnotations: Array<{ i: number; x: TaskFacetAnnotation }> = [];
  annotations.forEach((a, i) => {
    const r = validateTaskFacetAnnotation(a);
    if (!r.valid) {
      for (const e of r.errors) errors.push({ field: `taskFacetAnnotations[${i}].${e.field}`, message: e.message });
    } else {
      const x = a as TaskFacetAnnotation;
      if (annotationIds.has(x.id)) {
        errors.push({ field: `taskFacetAnnotations[${i}].id`, message: `duplicate annotation id ${x.id}.` });
      } else {
        annotationIds.add(x.id);
        validAnnotations.push({ i, x });
      }
      if (!taskIds.has(x.taskId)) {
        errors.push({
          field: `taskFacetAnnotations[${i}].taskId`,
          message: `annotation references unknown task ${x.taskId}.`,
        });
      }
      if (x.taskVersion !== null && !versionKeys.has(`${x.taskId}@${x.taskVersion}`)) {
        errors.push({
          field: `taskFacetAnnotations[${i}].taskVersion`,
          message: `annotation references unknown version ${x.taskId}@${x.taskVersion}.`,
        });
      }
    }
  });
  for (const { i, x } of validAnnotations) {
    if (x.supersedesId !== null && !annotationIds.has(x.supersedesId)) {
      errors.push({
        field: `taskFacetAnnotations[${i}].supersedesId`,
        message: `annotation supersedes unknown annotation ${x.supersedesId}.`,
      });
    }
  }

  return result(errors);
}
