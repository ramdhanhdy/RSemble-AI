// =============================================================================
// RSemble AI — Archive v2 contract: envelope, collections, validators
//
// Child 02 (Canonical Tasks) Task 10A, extended by Child 03 (Task Sets)
// Task 11, Child 04 (Evidence) Task 12, and Child 05 (Contextual Compare
// Results) Task 11.
//
// Defines the extensible, task-first archive v2 envelope that round-trips the
// exact current Run and Experiment evidence, all seven Fusion Study stores
// (`fusionRecipes`, `poolManifests`, `fusionStudies`, `fusionTrials`,
// `fusionAttempts`, `fusionObservations`, `fusionPlaybooks`), canonical
// Rubrics, and every canonical Task collection available in this child —
// including artifact bytes and legacy migration crosswalks.
//
// Child 03 (Task Sets) Task 11 adds an OPTIONAL top-level `taskSets` payload
// carrying four collections: `records` (TaskSetRecord), `versions` (immutable
// TaskSetVersion / WorkloadManifest), `materializations` (immutable
// TaskSetMaterializationRecord execution snapshots), and
// `ownershipCrosswalks` (TaskSetOwnershipCrosswalkRow — suite-manifest,
// experiment-owner, fusion-owner). When the key is present all four arrays are
// fully validated (array shape, counts, ordering, duplicates, reference
// graph); when absent (earlier-v2 envelope) the four counts must be zero.
// The optional payload joins the integrity digest only when present, so
// earlier-v2 digests remain stable.
//
// Child 05 (Contextual Compare Results) Task 11 adds an OPTIONAL top-level
// `comparisons` payload carrying three collections: `indexes` (summary-only
// ComparisonResultIndex rows — lineage and canonical/ad-hoc Task bindings
// live on each index), `inputSnapshots` (immutable input-snapshot
// metadata/artifact references), and `limitations` (explicit migration
// limitations). Candidate outputs and judge rationale never enter this
// payload; exact RunRecordV2 records stay the source payload. When the key is
// present all three arrays are fully validated (array shape, counts,
// ordering, duplicates, reference graph, binding/snapshot consistency); when
// absent (earlier-v2 envelope) the three counts must be zero. The optional
// payload joins the integrity digest only when present, so earlier-v2 digests
// remain stable.
//
// V1 (`WorkbenchArchiveV1` in `./archive.ts`) remains a distinct, readable
// shape. V2 is deterministic and integrity-checked: an explicit manifest
// carries format/storage versions, per-collection entity counts, a payload
// digest over canonical JSON, and a local-scope disclosure. Pure validation
// runs BEFORE any write and covers unknown versions, duplicate IDs, missing
// references/artifacts, byte count/digest mismatch, prohibited credential/auth
// content, deterministic ordering, and complete reference-graph validity.
//
// This module is types + pure validators only. No database mutation, no schema
// migration, no UI, no provider calls. Disposable caches/indexes and
// unrestricted `storageMeta` are intentionally omitted.
// =============================================================================

import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import { computeArtifactDigest } from "../tasks/task-instance";
import {
  CREDENTIAL_LIKE_VALUE,
  hasProhibitedKeys,
  PROHIBITED_KEYS,
} from "../tasks/task-validation";
import type {
  TaskArtifact,
  TaskFacetAnnotation,
  TaskFamily,
  TaskFamilyAssignment,
  TaskFamilyRelation,
  TaskInstance,
  TaskRecord,
  TaskVersion,
} from "../tasks/task-types";
import type { TaskMigrationCrosswalk } from "../tasks/task-references";
import type {
  EvaluationRubric,
  EvaluationSuite,
  ExperimentRecord,
  RubricRecord,
} from "../evaluations/evaluation-types";
import type {
  EvaluationObservation,
  FusionAttempt,
  FusionPlaybook,
  FusionRecipeVersion,
  FusionStudy,
  FusionTrial,
  PoolManifestVersion,
} from "../evaluations/fusion-study-types";
import { isRecord, type RunRecordV2, type RunSummary } from "./run-types";
import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import { isComparisonResultIndex } from "../compare/comparison-result-validation";
import type {
  ComparisonMigrationLimitation,
  ComparisonMigrationLimitationReason,
} from "./comparison-result-migration";
import type { TaskSetRecord, TaskSetVersion } from "../evaluations/task-set-types";
import type { TaskSetMaterializationRecord } from "./evaluation-repository";
import type { TaskSetOwnershipCrosswalkRow } from "./database";
import type {
  EligibilityDecision,
  ExecutedVerifierOutcome,
  ModelConfigurationSnapshot,
  Observation,
} from "../evidence/evidence-types";
import {
  collectProhibitedFieldPaths,
  isEligibilityDecision,
  isExecutedVerifierOutcome,
  isModelConfigurationSnapshot,
  validateObservation,
} from "../evidence/evidence-validation";
import type { EvidenceIndexJob } from "./evidence-repository";

// --- Versions ----------------------------------------------------------------

/** Envelope format version. Bumped only when the envelope structure changes in
 *  a way older readers cannot parse. Distinct from v1's `schemaVersion: 1`. */
export const ARCHIVE_V2_FORMAT_VERSION = 2;

/** Storage schema version captured by this envelope (the Dexie schema version
 *  the producer wrote against). Validators reject an unknown storage version so
 *  a future schema cannot be silently partially imported. */
export const ARCHIVE_V2_STORAGE_VERSION = 1;

// --- Manifest / disclosure ---------------------------------------------------

/** Local-scope disclosure. Archives are local-only artifacts; they never carry
 *  remote/cloud transport metadata or credentials. */
export interface ArchiveV2Disclosure {
  scope: "local";
  /** Sanitized, human-readable note. Never credentials or auth material. */
  notes: string | null;
}

/** Deterministic per-collection entity counts. Every collection key in
 *  `WorkbenchArchiveV2` has a matching count; validators reject a mismatch so a
 *  truncated/padded payload cannot masquerade as complete. */
export interface ArchiveV2EntityCounts {
  runSummaries: number;
  runDetails: number;
  rubricIdentities: number;
  rubricVersions: number;
  suites: number;
  experiments: number;
  fusionRecipes: number;
  poolManifests: number;
  fusionStudies: number;
  fusionTrials: number;
  fusionAttempts: number;
  fusionObservations: number;
  fusionPlaybooks: number;
  tasks: number;
  taskVersions: number;
  taskArtifacts: number;
  taskArtifactBytes: number;
  taskInstances: number;
  taskFamilies: number;
  taskFamilyAssignments: number;
  taskFamilyRelations: number;
  taskFacetAnnotations: number;
  taskMigrationCrosswalks: number;
  taskSets: number;
  taskSetVersions: number;
  taskSetMaterializations: number;
  taskSetOwnershipCrosswalks: number;
  modelConfigurations: number;
  observations: number;
  evidenceDecisions: number;
  evidenceIndexJobs: number;
  verifierOutcomes: number;
  comparisonIndexes: number;
  comparisonInputSnapshots: number;
  comparisonLimitations: number;
}
/** Extensible v2 manifest. Future additive fields must keep older validators
 *  functional; `formatVersion` is the break-glass discriminator. */
export interface ArchiveV2Manifest {
  formatVersion: number;
  storageVersion: number;
  exportedAt: number;
  producer: string;
  counts: ArchiveV2EntityCounts;
  /** Integrity digest (`sha256:<hex>`) over the canonical JSON of the data
   *  payload (every collection except this manifest). */
  payloadDigest: string;
  disclosure: ArchiveV2Disclosure;
}

// --- Artifact bytes ----------------------------------------------------------

/** Opaque artifact byte payload, carried alongside the artifact summary so a v2
 *  archive is self-contained. Bytes are base64-encoded so the envelope is
 *  JSON-serializable; validators decode and verify byte count + digest. */
export interface ArchiveV2TaskArtifactBytes {
  id: string;
  bytesBase64: string;
}

// --- Envelope ----------------------------------------------------------------

/** All seven Fusion Study stores (spec §8.5). */
export interface ArchiveV2FusionPayload {
  recipes: FusionRecipeVersion[];
  poolManifests: PoolManifestVersion[];
  studies: FusionStudy[];
  trials: FusionTrial[];
  attempts: FusionAttempt[];
  observations: EvaluationObservation[];
  playbooks: FusionPlaybook[];
}

/** Every canonical Task collection available in Child 02, including artifact
 *  bytes and legacy migration crosswalks. Disposable caches/indexes are
 *  omitted. */
export interface ArchiveV2TaskPayload {
  tasks: TaskRecord[];
  taskVersions: TaskVersion[];
  taskArtifacts: TaskArtifact[];
  taskArtifactBytes: ArchiveV2TaskArtifactBytes[];
  taskInstances: TaskInstance[];
  taskFamilies: TaskFamily[];
  taskFamilyAssignments: TaskFamilyAssignment[];
  taskFamilyRelations: TaskFamilyRelation[];
  taskFacetAnnotations: TaskFacetAnnotation[];
  taskMigrationCrosswalks: TaskMigrationCrosswalk[];
}

/** Task Set identity collections (Child 03 Task 11, spec §10). Carries Task
 *  Set records/versions (each version embeds its immutable workload manifest),
 *  immutable execution materializations, and the single ownership-crosswalk
 *  collection (suite-manifest / experiment-owner / fusion-owner). This key is
 *  OPTIONAL: earlier v2 envelopes without it remain readable, and its absence
 *  means all four counts are zero. */
export interface ArchiveV2TaskSetPayload {
  records: TaskSetRecord[];
  versions: TaskSetVersion[];
  materializations: TaskSetMaterializationRecord[];
  ownershipCrosswalks: TaskSetOwnershipCrosswalkRow[];
}

/** Evidence collections (Child 04 Task 12, spec §3, §10). Carries canonical
 *  Model Configuration snapshots, Task Observations, Eligibility Decisions,
 *  indexing job markers, and executed verifier outcomes. This key is
 *  OPTIONAL: earlier v2 envelopes without it remain readable, and its absence
 *  means all five counts are zero. */
export interface ArchiveV2EvidencePayload {
  modelConfigurations: ModelConfigurationSnapshot[];
  observations: Observation[];
  evidenceDecisions: EligibilityDecision[];
  evidenceIndexJobs: EvidenceIndexJob[];
  verifierOutcomes: ExecutedVerifierOutcome[];
}

/** Immutable input-snapshot metadata/artifact reference (Child 05 Task 11,
 *  spec §5, §13). Metadata only: the snapshot's normalized content is never
 *  duplicated — the exact RunRecordV2 stays the source payload. */
export interface ArchiveV2ComparisonInputSnapshot {
  runId: string;
  /**
   * - `input_snapshot`: ad-hoc binding's content-addressed ref
   *   (`snap:sha256:<hex>` or a non-resolving migration-era `migrated:` ref);
   * - `task_instance`: canonical binding's durable Task Instance id;
   * - `task_version`: canonical binding without an instance — the version key.
   */
  kind: "input_snapshot" | "task_instance" | "task_version";
  inputRef: string;
  /** `sha256:<hex>` content digest for resolving snapshot refs; null otherwise. */
  inputDigest: string | null;
  /** Canonical artifact ids referenced by the immutable input (task-instance
   *  inputs only — ad-hoc attachments are sanitized metadata and reference
   *  nothing). */
  artifactRefs: string[];
  /** Explicit limitation for non-resolving inputs; null otherwise. */
  limitation: ComparisonMigrationLimitationReason | null;
}

/** Comparison Result payload (Child 05 Task 11, spec §3, §9, §10, §13).
 *  Carries the summary-only Comparison Result indexes (lineage and canonical/
 *  ad-hoc Task bindings live on each index), the immutable input-snapshot
 *  metadata/artifact references, and the explicit migration limitations.
 *  Candidate outputs and judge rationale never enter this payload. This key
 *  is OPTIONAL: earlier v2 envelopes without it remain readable, and its
 *  absence means all three counts are zero. */
export interface ArchiveV2ComparisonPayload {
  indexes: ComparisonResultIndex[];
  inputSnapshots: ArchiveV2ComparisonInputSnapshot[];
  limitations: ComparisonMigrationLimitation[];
}

/** The complete, task-first archive v2 envelope. Structurally distinct from
 *  `WorkbenchArchiveV1`: a manifest with format/storage versions, integrity
 *  digest, and local-scope disclosure; Fusion and Task collections are
 *  first-class; artifact bytes travel with the archive. */
export interface WorkbenchArchiveV2 {
  manifest: ArchiveV2Manifest;
  runs: { summaries: RunSummary[]; details: RunRecordV2[] };
  rubrics: { identities: RubricRecord[]; versions: EvaluationRubric[] };
  suites: EvaluationSuite[];
  experiments: ExperimentRecord[];
  fusion: ArchiveV2FusionPayload;
  tasks: ArchiveV2TaskPayload;
  /** Optional Task Set identity payload (Child 03). Absent => empty. */
  taskSets?: ArchiveV2TaskSetPayload;
  /** Optional Evidence payload (Child 04). Absent => empty. */
  evidence?: ArchiveV2EvidencePayload;
  /** Optional Comparison Result payload (Child 05). Absent => empty. */
  comparisons?: ArchiveV2ComparisonPayload;
}

/** Top-level collection keys, in deterministic declaration order. Used by
 *  fixtures and tests; validators check each is present and array-typed. */
export const ARCHIVE_V2_COLLECTION_KEYS = [
  "manifest",
  "runs",
  "rubrics",
  "suites",
  "experiments",
  "fusion",
  "tasks",
] as const;

// --- Validation result -------------------------------------------------------

export interface ArchiveV2ValidationError {
  field: string;
  message: string;
}

export interface ArchiveV2ValidationResult {
  valid: boolean;
  errors: ArchiveV2ValidationError[];
}

function fail(errors: ArchiveV2ValidationError[]): ArchiveV2ValidationResult {
  return { valid: false, errors };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// --- Payload digest ----------------------------------------------------------

/** The data payload over which the integrity digest is computed — every
 *  collection except the manifest (which carries the digest itself). Key order
 *  is deterministic so the digest is stable. */
function payloadForDigest(archive: WorkbenchArchiveV2): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    runs: archive.runs,
    rubrics: archive.rubrics,
    suites: archive.suites,
    experiments: archive.experiments,
    fusion: archive.fusion,
    tasks: archive.tasks,
  };
  // Optional Task Set identity payload participates in the digest only when
  // present, so earlier-v2 envelopes (no taskSets key) keep their original
  // digest and remain readable.
  if (archive.taskSets !== undefined) payload.taskSets = archive.taskSets;
  if (archive.evidence !== undefined) payload.evidence = archive.evidence;
  if (archive.comparisons !== undefined) payload.comparisons = archive.comparisons;
  return payload;
}

/** Recompute the integrity digest (`sha256:<hex>`) over the canonical JSON of
 *  the data payload. Deterministic: recursive key sort, stable collection key
 *  order, base64 artifact bytes. */
export function computeArchiveV2PayloadDigest(archive: WorkbenchArchiveV2): string {
  const canonical = canonicalJsonString(payloadForDigest(archive));
  const bytes = new TextEncoder().encode(canonical);
  return computeArtifactDigest(bytes);
}

// --- Type guard --------------------------------------------------------------

/** Lightweight structural guard: an object with a v2 manifest and every
 *  top-level collection key. Full validation is `validateArchiveV2`. */
export function isWorkbenchArchiveV2(value: unknown): value is WorkbenchArchiveV2 {
  if (!isRecord(value)) return false;
  const manifest = value.manifest;
  if (!isRecord(manifest)) return false;
  if (manifest.formatVersion !== ARCHIVE_V2_FORMAT_VERSION) return false;
  for (const key of ARCHIVE_V2_COLLECTION_KEYS) {
    if (!(key in value)) return false;
  }
  return true;
}

// --- Prohibited content scan -------------------------------------------------

/** Deep-scan a value for a credential-like string (`sk-`, `AIza`, `Bearer ` at
 *  start) or a prohibited credential/transport key. Returns true on the first
 *  hit. Never echoes the offending value. */
function hasProhibitedContent(value: unknown): boolean {
  if (typeof value === "string") return CREDENTIAL_LIKE_VALUE.test(value);
  if (Array.isArray(value)) {
    for (const item of value) if (hasProhibitedContent(item)) return true;
    return false;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (PROHIBITED_KEYS.has(key)) return true;
      if (hasProhibitedContent(value[key])) return true;
    }
    return false;
  }
  return false;
}

/** Scan every collection for prohibited credential/auth content. Returns the
 *  first human-readable violation label, or null. */
function scanProhibitedContent(archive: WorkbenchArchiveV2): string | null {
  const collections: Array<[string, unknown]> = [
    ["runs", archive.runs],
    ["rubrics", archive.rubrics],
    ["suites", archive.suites],
    ["experiments", archive.experiments],
    ["fusion", archive.fusion],
    ["tasks", archive.tasks],
  ];
  if (archive.taskSets !== undefined) collections.push(["taskSets", archive.taskSets]);
  if (archive.evidence !== undefined) collections.push(["evidence", archive.evidence]);
  if (archive.comparisons !== undefined) collections.push(["comparisons", archive.comparisons]);
  for (const [label, value] of collections) {
    if (hasProhibitedKeys(value)) return `prohibited credential/transport key in ${label}`;
    if (hasProhibitedContent(value)) return `credential-like value in ${label}`;
  }
  if (archive.evidence !== undefined) {
    const prohibitedPaths: string[] = [];
    for (let i = 0; i < archive.evidence.observations.length; i++) {
      collectProhibitedFieldPaths(
        archive.evidence.observations[i],
        `evidence.observations[${i}]`,
        prohibitedPaths,
      );
    }
    for (let i = 0; i < archive.evidence.modelConfigurations.length; i++) {
      collectProhibitedFieldPaths(
        archive.evidence.modelConfigurations[i],
        `evidence.modelConfigurations[${i}]`,
        prohibitedPaths,
      );
    }
    for (let i = 0; i < archive.evidence.evidenceDecisions.length; i++) {
      collectProhibitedFieldPaths(
        archive.evidence.evidenceDecisions[i],
        `evidence.evidenceDecisions[${i}]`,
        prohibitedPaths,
      );
    }
    for (let i = 0; i < archive.evidence.evidenceIndexJobs.length; i++) {
      collectProhibitedFieldPaths(
        archive.evidence.evidenceIndexJobs[i],
        `evidence.evidenceIndexJobs[${i}]`,
        prohibitedPaths,
      );
    }
    for (let i = 0; i < archive.evidence.verifierOutcomes.length; i++) {
      collectProhibitedFieldPaths(
        archive.evidence.verifierOutcomes[i],
        `evidence.verifierOutcomes[${i}]`,
        prohibitedPaths,
      );
    }
    if (prohibitedPaths.length > 0) {
      return `prohibited content in evidence: ${prohibitedPaths[0]}`;
    }
  }
  return null;
}

// --- Ordering + duplicate key extractors -------------------------------------

function byId(item: { id: string }): string {
  return item.id;
}

function byIdVersion(item: { id: string; version: number }): string {
  return `${item.id}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byTaskIdVersion(item: { taskId: string; version: number }): string {
  return `${item.taskId}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byLegacyScopeKey(item: { legacyScopeKey: string }): string {
  return item.legacyScopeKey;
}

function byTaskSetIdVersion(item: { taskSetId: string; version: number }): string {
  return `${item.taskSetId}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byKey(item: { key: string }): string {
  return item.key;
}

function byObservationIdRuleVersion(item: { observationId: string; ruleVersion: number }): string {
  return `${item.observationId}\u0000${item.ruleVersion.toString().padStart(10, "0")}`;
}

function bySourceResultId(item: { sourceResultId: string }): string {
  return item.sourceResultId;
}

function byVerifierOutcomeKey(item: {
  runId: string;
  taskId: string;
  modelKey: string;
  executedAt: number;
}): string {
  return `${item.runId}::${item.taskId}::${item.modelKey}::${item.executedAt}`;
}

function byRunId(item: { runId: string }): string {
  return item.runId;
}

interface OrderingSpec<T> {
  field: string;
  items: T[];
  key: (item: T) => string;
}

/** Verify a collection is sorted ascending by its deterministic key. */
function checkOrdering<T>(spec: OrderingSpec<T>, errors: ArchiveV2ValidationError[]): void {
  const { field, items, key } = spec;
  for (let i = 1; i < items.length; i++) {
    if (key(items[i - 1]) > key(items[i])) {
      errors.push({
        field,
        message: `${field} is not in deterministic order at index ${i}.`,
      });
      return;
    }
  }
}

/** Record duplicate-key errors for a collection. */
function checkDuplicates<T>(
  field: string,
  items: T[],
  key: (item: T) => string,
  errors: ArchiveV2ValidationError[],
): void {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const k = key(item);
    if (seen.has(k)) {
      errors.push({ field: `${field}[${i}]`, message: `duplicate ${field} key ${k}.` });
    } else {
      seen.add(k);
    }
  });
}

// --- Structural validators ---------------------------------------------------

function requireArrays(archive: WorkbenchArchiveV2, errors: ArchiveV2ValidationError[]): void {
  // Container collections (`runs`, `rubrics`, `fusion`, `tasks`) must be objects
  // before their inner arrays can be read; a missing/malformed container is
  // reported once and the inner arrays are skipped so validation never crashes.
  const checks: Array<[string, unknown]> = [
    ["suites", archive.suites],
    ["experiments", archive.experiments],
  ];
  const runs = archive.runs;
  if (isRecord(runs)) {
    checks.push(["runs.summaries", runs.summaries], ["runs.details", runs.details]);
  } else {
    errors.push({ field: "runs", message: "runs must be an object." });
  }
  const rubrics = archive.rubrics;
  if (isRecord(rubrics)) {
    checks.push(["rubrics.identities", rubrics.identities], ["rubrics.versions", rubrics.versions]);
  } else {
    errors.push({ field: "rubrics", message: "rubrics must be an object." });
  }
  const fusion = archive.fusion;
  if (isRecord(fusion)) {
    checks.push(
      ["fusion.recipes", fusion.recipes],
      ["fusion.poolManifests", fusion.poolManifests],
      ["fusion.studies", fusion.studies],
      ["fusion.trials", fusion.trials],
      ["fusion.attempts", fusion.attempts],
      ["fusion.observations", fusion.observations],
      ["fusion.playbooks", fusion.playbooks],
    );
  } else {
    errors.push({ field: "fusion", message: "fusion must be an object." });
  }
  const tasks = archive.tasks;
  if (isRecord(tasks)) {
    checks.push(
      ["tasks.tasks", tasks.tasks],
      ["tasks.taskVersions", tasks.taskVersions],
      ["tasks.taskArtifacts", tasks.taskArtifacts],
      ["tasks.taskArtifactBytes", tasks.taskArtifactBytes],
      ["tasks.taskInstances", tasks.taskInstances],
      ["tasks.taskFamilies", tasks.taskFamilies],
      ["tasks.taskFamilyAssignments", tasks.taskFamilyAssignments],
      ["tasks.taskFamilyRelations", tasks.taskFamilyRelations],
      ["tasks.taskFacetAnnotations", tasks.taskFacetAnnotations],
      ["tasks.taskMigrationCrosswalks", tasks.taskMigrationCrosswalks],
    );
  } else {
    errors.push({ field: "tasks", message: "tasks must be an object." });
  }
  // Optional Task Set identity payload: validated only when present. Absence is
  // legal (earlier-v2 envelope) and means all four counts are zero.
  const taskSets = archive.taskSets;
  if (taskSets !== undefined) {
    if (isRecord(taskSets)) {
      checks.push(
        ["taskSets.records", taskSets.records],
        ["taskSets.versions", taskSets.versions],
        ["taskSets.materializations", taskSets.materializations],
        ["taskSets.ownershipCrosswalks", taskSets.ownershipCrosswalks],
      );
    } else {
      errors.push({ field: "taskSets", message: "taskSets must be an object." });
    }
  }
  // Optional Evidence payload: validated only when present. Absence is
  // legal (earlier-v2 envelope) and means all five counts are zero.
  const evidence = archive.evidence;
  if (evidence !== undefined) {
    if (isRecord(evidence)) {
      checks.push(
        ["evidence.modelConfigurations", evidence.modelConfigurations],
        ["evidence.observations", evidence.observations],
        ["evidence.evidenceDecisions", evidence.evidenceDecisions],
        ["evidence.evidenceIndexJobs", evidence.evidenceIndexJobs],
        ["evidence.verifierOutcomes", evidence.verifierOutcomes],
      );
    } else {
      errors.push({ field: "evidence", message: "evidence must be an object." });
    }
  }
  // Optional Comparison payload: validated only when present. Absence is
  // legal (earlier-v2 envelope) and means all three counts are zero.
  const comparisons = archive.comparisons;
  if (comparisons !== undefined) {
    if (isRecord(comparisons)) {
      checks.push(
        ["comparisons.indexes", comparisons.indexes],
        ["comparisons.inputSnapshots", comparisons.inputSnapshots],
        ["comparisons.limitations", comparisons.limitations],
      );
    } else {
      errors.push({ field: "comparisons", message: "comparisons must be an object." });
    }
  }
  for (const [field, value] of checks) {
    if (!Array.isArray(value)) {
      errors.push({ field, message: `${field} must be an array.` });
    }
  }
}

function validateManifest(archive: WorkbenchArchiveV2, errors: ArchiveV2ValidationError[]): void {
  const m = archive.manifest;
  if (!isRecord(m)) {
    errors.push({ field: "manifest", message: "manifest must be an object." });
    return;
  }
  if (m.formatVersion !== ARCHIVE_V2_FORMAT_VERSION) {
    errors.push({
      field: "manifest.formatVersion",
      message: `unknown formatVersion ${String(m.formatVersion)}; expected ${ARCHIVE_V2_FORMAT_VERSION}.`,
    });
  }
  if (!isFiniteNumber(m.storageVersion) || m.storageVersion !== ARCHIVE_V2_STORAGE_VERSION) {
    errors.push({
      field: "manifest.storageVersion",
      message: `unknown storageVersion ${String(m.storageVersion)}; expected ${ARCHIVE_V2_STORAGE_VERSION}.`,
    });
  }
  if (!isRecord(m.disclosure) || m.disclosure.scope !== "local") {
    errors.push({
      field: "manifest.disclosure.scope",
      message: "disclosure.scope must be 'local'.",
    });
  }
  if (!isNonEmptyString(m.payloadDigest) || !/^sha256:[0-9a-f]{64}$/.test(m.payloadDigest)) {
    errors.push({
      field: "manifest.payloadDigest",
      message: "payloadDigest must be a sha256:<hex> digest.",
    });
  }
  const c = m.counts;
  if (!isRecord(c)) {
    errors.push({ field: "manifest.counts", message: "manifest.counts must be an object." });
    return;
  }
  const expected: Array<[keyof ArchiveV2EntityCounts, number]> = [
    ["runSummaries", archive.runs.summaries.length],
    ["runDetails", archive.runs.details.length],
    ["rubricIdentities", archive.rubrics.identities.length],
    ["rubricVersions", archive.rubrics.versions.length],
    ["suites", archive.suites.length],
    ["experiments", archive.experiments.length],
    ["fusionRecipes", archive.fusion.recipes.length],
    ["poolManifests", archive.fusion.poolManifests.length],
    ["fusionStudies", archive.fusion.studies.length],
    ["fusionTrials", archive.fusion.trials.length],
    ["fusionAttempts", archive.fusion.attempts.length],
    ["fusionObservations", archive.fusion.observations.length],
    ["fusionPlaybooks", archive.fusion.playbooks.length],
    ["tasks", archive.tasks.tasks.length],
    ["taskVersions", archive.tasks.taskVersions.length],
    ["taskArtifacts", archive.tasks.taskArtifacts.length],
    ["taskArtifactBytes", archive.tasks.taskArtifactBytes.length],
    ["taskInstances", archive.tasks.taskInstances.length],
    ["taskFamilies", archive.tasks.taskFamilies.length],
    ["taskFamilyAssignments", archive.tasks.taskFamilyAssignments.length],
    ["taskFamilyRelations", archive.tasks.taskFamilyRelations.length],
    ["taskFacetAnnotations", archive.tasks.taskFacetAnnotations.length],
    ["taskMigrationCrosswalks", archive.tasks.taskMigrationCrosswalks.length],
  ];
  for (const [key, actual] of expected) {
    if (!isFiniteNumber(c[key]) || (c[key] as number) !== actual) {
      errors.push({
        field: `manifest.counts.${key}`,
        message: `count mismatch for ${key}: manifest ${String(c[key])} vs actual ${actual}.`,
      });
    }
  }
  // Optional Task Set counts: when the taskSets key is present the count must
  // equal the collection length; when absent (earlier-v2) the count must be 0
  // (or omitted, which is treated as 0).
  const ts = archive.taskSets;
  const optionalCounts: Array<[keyof ArchiveV2EntityCounts, number]> = [
    ["taskSets", ts?.records.length ?? 0],
    ["taskSetVersions", ts?.versions.length ?? 0],
    ["taskSetMaterializations", ts?.materializations.length ?? 0],
    ["taskSetOwnershipCrosswalks", ts?.ownershipCrosswalks.length ?? 0],
    ["modelConfigurations", archive.evidence?.modelConfigurations.length ?? 0],
    ["observations", archive.evidence?.observations.length ?? 0],
    ["evidenceDecisions", archive.evidence?.evidenceDecisions.length ?? 0],
    ["evidenceIndexJobs", archive.evidence?.evidenceIndexJobs.length ?? 0],
    ["verifierOutcomes", archive.evidence?.verifierOutcomes.length ?? 0],
    ["comparisonIndexes", archive.comparisons?.indexes.length ?? 0],
    ["comparisonInputSnapshots", archive.comparisons?.inputSnapshots.length ?? 0],
    ["comparisonLimitations", archive.comparisons?.limitations.length ?? 0],
  ];
  for (const [key, actual] of optionalCounts) {
    const declared = c[key];
    const declaredValue = declared === undefined ? 0 : declared;
    if (!isFiniteNumber(declaredValue) || declaredValue !== actual) {
      errors.push({
        field: `manifest.counts.${key}`,
        message: `count mismatch for ${key}: manifest ${String(declaredValue)} vs actual ${actual}.`,
      });
    }
  }
  if (isNonEmptyString(m.payloadDigest) && /^sha256:[0-9a-f]{64}$/.test(m.payloadDigest)) {
    const recomputed = computeArchiveV2PayloadDigest(archive);
    if (recomputed !== m.payloadDigest) {
      errors.push({
        field: "manifest.payloadDigest",
        message: "payload digest does not match the recomputed integrity digest.",
      });
    }
  }
}

function validateReferenceGraph(
  archive: WorkbenchArchiveV2,
  errors: ArchiveV2ValidationError[],
): void {
  const rubricIds = new Set(archive.rubrics.identities.map((r) => r.id));
  archive.rubrics.versions.forEach((v, i) => {
    if (!rubricIds.has(v.id)) {
      errors.push({
        field: `rubrics.versions[${i}].id`,
        message: `rubric version references unknown rubric identity ${v.id}.`,
      });
    }
  });

  const taskIds = new Set(archive.tasks.tasks.map((t) => t.id));
  const taskLatest = new Map<string, number>();
  archive.tasks.tasks.forEach((t) => taskLatest.set(t.id, t.latestVersion));
  const versionKeys = new Set<string>();
  archive.tasks.taskVersions.forEach((v, i) => {
    versionKeys.add(`${v.taskId}@${v.version}`);
    if (!taskIds.has(v.taskId)) {
      errors.push({
        field: `tasks.taskVersions[${i}].taskId`,
        message: `version references unknown task ${v.taskId}.`,
      });
    }
    const latest = taskLatest.get(v.taskId);
    if (latest !== undefined && v.version > latest) {
      errors.push({
        field: `tasks.taskVersions[${i}].version`,
        message: `version ${v.version} exceeds latestVersion ${latest} for task ${v.taskId}.`,
      });
    }
  });
  for (const [taskId, latest] of taskLatest) {
    for (let n = 1; n <= latest; n++) {
      if (!versionKeys.has(`${taskId}@${n}`)) {
        errors.push({
          field: "tasks.taskVersions",
          message: `task ${taskId} is missing version ${n}.`,
        });
      }
    }
  }

  const artifactIds = new Set(archive.tasks.taskArtifacts.map((a) => a.id));
  archive.tasks.taskInstances.forEach((inst, i) => {
    if (!versionKeys.has(`${inst.taskId}@${inst.taskVersion}`)) {
      errors.push({
        field: `tasks.taskInstances[${i}]`,
        message: `instance references unknown task version ${inst.taskId}@${inst.taskVersion}.`,
      });
    }
    for (const aid of inst.normalizedInput.artifactIds) {
      if (!artifactIds.has(aid)) {
        errors.push({
          field: `tasks.taskInstances[${i}].normalizedInput.artifactIds`,
          message: `instance references unknown artifact ${aid}.`,
        });
      }
    }
    for (const entry of inst.contextManifest) {
      if (entry.artifactId !== null && !artifactIds.has(entry.artifactId)) {
        errors.push({
          field: `tasks.taskInstances[${i}].contextManifest`,
          message: `instance context manifest references unknown artifact ${entry.artifactId}.`,
        });
      }
    }
  });

  archive.tasks.taskVersions.forEach((v, i) => {
    for (const entry of v.defaultContextManifest) {
      if (entry.artifactId !== null && !artifactIds.has(entry.artifactId)) {
        errors.push({
          field: `tasks.taskVersions[${i}].defaultContextManifest`,
          message: `context manifest references unknown artifact ${entry.artifactId}.`,
        });
      }
    }
  });

  const familyIds = new Set(archive.tasks.taskFamilies.map((f) => f.id));
  archive.tasks.taskFamilyAssignments.forEach((a, i) => {
    if (!versionKeys.has(`${a.taskId}@${a.taskVersion}`)) {
      errors.push({
        field: `tasks.taskFamilyAssignments[${i}]`,
        message: `assignment references unknown task version ${a.taskId}@${a.taskVersion}.`,
      });
    }
    if (!familyIds.has(a.familyId)) {
      errors.push({
        field: `tasks.taskFamilyAssignments[${i}].familyId`,
        message: `assignment references unknown family ${a.familyId}.`,
      });
    }
  });

  archive.tasks.taskFamilyRelations.forEach((r, i) => {
    if (!familyIds.has(r.fromFamilyId)) {
      errors.push({
        field: `tasks.taskFamilyRelations[${i}].fromFamilyId`,
        message: `relation references unknown family ${r.fromFamilyId}.`,
      });
    }
    if (!familyIds.has(r.toFamilyId)) {
      errors.push({
        field: `tasks.taskFamilyRelations[${i}].toFamilyId`,
        message: `relation references unknown family ${r.toFamilyId}.`,
      });
    }
  });

  const annotationIds = new Set(archive.tasks.taskFacetAnnotations.map((a) => a.id));
  archive.tasks.taskFacetAnnotations.forEach((a, i) => {
    if (!taskIds.has(a.taskId)) {
      errors.push({
        field: `tasks.taskFacetAnnotations[${i}].taskId`,
        message: `annotation references unknown task ${a.taskId}.`,
      });
    }
    if (a.taskVersion !== null && !versionKeys.has(`${a.taskId}@${a.taskVersion}`)) {
      errors.push({
        field: `tasks.taskFacetAnnotations[${i}].taskVersion`,
        message: `annotation references unknown task version ${a.taskId}@${a.taskVersion}.`,
      });
    }
    if (a.supersedesId !== null && !annotationIds.has(a.supersedesId)) {
      errors.push({
        field: `tasks.taskFacetAnnotations[${i}].supersedesId`,
        message: `annotation supersedes unknown annotation ${a.supersedesId}.`,
      });
    }
  });

  archive.tasks.taskMigrationCrosswalks.forEach((cw, i) => {
    if (!versionKeys.has(`${cw.taskId}@${cw.taskVersion}`)) {
      errors.push({
        field: `tasks.taskMigrationCrosswalks[${i}]`,
        message: `crosswalk references unknown task version ${cw.taskId}@${cw.taskVersion}.`,
      });
    }
  });

  const studyIds = new Set(archive.fusion.studies.map((s) => s.id));
  const trialIds = new Set(archive.fusion.trials.map((t) => t.id));
  const recipeVersionKeys = new Set(archive.fusion.recipes.map((r) => `${r.id}@${r.version}`));
  const poolVersionKeys = new Set(archive.fusion.poolManifests.map((p) => `${p.id}@${p.version}`));
  const observationIds = new Set(archive.fusion.observations.map((o) => o.id));
  const playbookIds = new Set(archive.fusion.playbooks.map((p) => p.id));

  const requireRecipeVersion = (ref: { id: string; version: number }, path: string) => {
    if (!recipeVersionKeys.has(`${ref.id}@${ref.version}`)) {
      errors.push({
        field: path,
        message: `reference references unknown recipe ${ref.id}@${ref.version}.`,
      });
    }
  };
  const requirePoolVersion = (ref: { id: string; version: number }, path: string) => {
    if (!poolVersionKeys.has(`${ref.id}@${ref.version}`)) {
      errors.push({
        field: path,
        message: `reference references unknown pool ${ref.id}@${ref.version}.`,
      });
    }
  };
  archive.fusion.studies.forEach((s, i) => {
    if (s.poolRef) requirePoolVersion(s.poolRef, `fusion.studies[${i}].poolRef`);
    s.recipeRefs.forEach((r, j) =>
      requireRecipeVersion(r, `fusion.studies[${i}].recipeRefs[${j}]`),
    );
    if (s.playbookRef !== null && !playbookIds.has(s.playbookRef)) {
      errors.push({
        field: `fusion.studies[${i}].playbookRef`,
        message: `study references unknown playbook ${s.playbookRef}.`,
      });
    }
    if (s.confirmationOf !== null && !studyIds.has(s.confirmationOf)) {
      errors.push({
        field: `fusion.studies[${i}].confirmationOf`,
        message: `study references unknown study ${s.confirmationOf}.`,
      });
    }
  });
  archive.fusion.trials.forEach((t, i) => {
    if (!studyIds.has(t.studyId)) {
      errors.push({
        field: `fusion.trials[${i}].studyId`,
        message: `trial references unknown study ${t.studyId}.`,
      });
    }
    if (t.poolRef) requirePoolVersion(t.poolRef, `fusion.trials[${i}].poolRef`);
    if (t.recipe !== null) requireRecipeVersion(t.recipe, `fusion.trials[${i}].recipe`);
    t.observationIds.forEach((oid, j) => {
      if (!observationIds.has(oid)) {
        errors.push({
          field: `fusion.trials[${i}].observationIds[${j}]`,
          message: `trial references unknown observation ${oid}.`,
        });
      }
    });
  });
  archive.fusion.attempts.forEach((a, i) => {
    if (!studyIds.has(a.studyId)) {
      errors.push({
        field: `fusion.attempts[${i}].studyId`,
        message: `attempt references unknown study ${a.studyId}.`,
      });
    }
    if (!trialIds.has(a.fromTrialId)) {
      errors.push({
        field: `fusion.attempts[${i}].fromTrialId`,
        message: `attempt fromTrialId references unknown trial ${a.fromTrialId}.`,
      });
    }
    if (!trialIds.has(a.toTrialId)) {
      errors.push({
        field: `fusion.attempts[${i}].toTrialId`,
        message: `attempt toTrialId references unknown trial ${a.toTrialId}.`,
      });
    }
  });
  archive.fusion.observations.forEach((o, i) => {
    if (!trialIds.has(o.trialId)) {
      errors.push({
        field: `fusion.observations[${i}].trialId`,
        message: `observation references unknown trial ${o.trialId}.`,
      });
    }
  });
  archive.fusion.playbooks.forEach((p, i) => {
    if (!studyIds.has(p.studyId)) {
      errors.push({
        field: `fusion.playbooks[${i}].studyId`,
        message: `playbook references unknown study ${p.studyId}.`,
      });
    }
  });

  // --- Task Set identity (optional) ------------------------------------------
  const taskSets = archive.taskSets;
  if (taskSets !== undefined) {
    const taskSetIds = new Set(taskSets.records.map((r) => r.id));
    const taskSetLatest = new Map<string, number>();
    taskSets.records.forEach((r) => taskSetLatest.set(r.id, r.latestVersion));
    const taskSetVersionKeys = new Set<string>();
    taskSets.versions.forEach((v, i) => {
      taskSetVersionKeys.add(`${v.taskSetId}@${v.version}`);
      if (!taskSetIds.has(v.taskSetId)) {
        errors.push({
          field: `taskSets.versions[${i}].taskSetId`,
          message: `version references unknown task set ${v.taskSetId}.`,
        });
      }
      const latest = taskSetLatest.get(v.taskSetId);
      if (latest !== undefined && v.version > latest) {
        errors.push({
          field: `taskSets.versions[${i}].version`,
          message: `version ${v.version} exceeds latestVersion ${latest} for task set ${v.taskSetId}.`,
        });
      }
      v.members.forEach((m, j) => {
        if (m.unresolved !== null && m.unresolved !== undefined) return;
        if (!versionKeys.has(`${m.taskVersionRef.taskId}@${m.taskVersionRef.version}`)) {
          errors.push({
            field: `taskSets.versions[${i}].members[${j}].taskVersionRef`,
            message: `member references unknown task version ${m.taskVersionRef.taskId}@${m.taskVersionRef.version}.`,
          });
        }
      });
    });
    for (const [taskSetId, latest] of taskSetLatest) {
      for (let n = 1; n <= latest; n++) {
        if (!taskSetVersionKeys.has(`${taskSetId}@${n}`)) {
          errors.push({
            field: "taskSets.versions",
            message: `task set ${taskSetId} is missing version ${n}.`,
          });
        }
      }
    }
    taskSets.materializations.forEach((m, i) => {
      if (!taskSetVersionKeys.has(`${m.taskSetId}@${m.taskSetVersion}`)) {
        errors.push({
          field: `taskSets.materializations[${i}]`,
          message: `materialization references unknown task set version ${m.taskSetId}@${m.taskSetVersion}.`,
        });
      }
    });
    const suiteIds = new Set(archive.suites.map((s) => s.id));
    const experimentIds = new Set(archive.experiments.map((e) => e.id));
    taskSets.ownershipCrosswalks.forEach((cw, i) => {
      if (!taskSetIds.has(cw.taskSetId)) {
        errors.push({
          field: `taskSets.ownershipCrosswalks[${i}].taskSetId`,
          message: `crosswalk references unknown task set ${cw.taskSetId}.`,
        });
      }
      if (cw.kind === "suite-manifest") {
        if (!suiteIds.has(cw.taskSetId)) {
          errors.push({
            field: `taskSets.ownershipCrosswalks[${i}]`,
            message: `suite-manifest crosswalk references unknown suite ${cw.taskSetId}.`,
          });
        }
      } else if (cw.kind === "experiment-owner") {
        if (cw.experimentId !== undefined && !experimentIds.has(cw.experimentId)) {
          errors.push({
            field: `taskSets.ownershipCrosswalks[${i}].experimentId`,
            message: `experiment-owner crosswalk references unknown experiment ${cw.experimentId}.`,
          });
        }
      } else if (cw.kind === "fusion-owner") {
        const studyId = cw.key.startsWith("ts-xwalk:fusion:")
          ? cw.key.slice("ts-xwalk:fusion:".length)
          : "";
        if (!studyIds.has(studyId)) {
          errors.push({
            field: `taskSets.ownershipCrosswalks[${i}]`,
            message: `fusion-owner crosswalk references unknown study ${studyId}.`,
          });
        }
      }
    });
  }

  // --- Evidence payload (optional) -------------------------------------------
  const evidencePayload = archive.evidence;
  if (evidencePayload !== undefined) {
    const modelConfigIds = new Set(evidencePayload.modelConfigurations.map((m) => m.id));
    const observationIds = new Set(evidencePayload.observations.map((o) => o.id));
    const runIds = new Set([
      ...archive.runs.details.map((r) => r.id),
      ...archive.runs.summaries.map((s) => s.id),
    ]);
    const rubricVersionKeys = new Set(archive.rubrics.versions.map((r) => `${r.id}@${r.version}`));

    evidencePayload.modelConfigurations.forEach((mc, i) => {
      const mcId = (mc as { id?: string }).id ?? "";
      if (!isModelConfigurationSnapshot(mc)) {
        errors.push({
          field: `evidence.modelConfigurations[${i}]`,
          message: `invalid model configuration ${mcId}.`,
        });
      }
    });

    evidencePayload.observations.forEach((obs, i) => {
      const vRes = validateObservation(obs);
      if (!vRes.ok) {
        errors.push({
          field: `evidence.observations[${i}]`,
          message: `invalid observation ${obs.id}: ${vRes.errors.join("; ")}`,
        });
      }
      if (!taskIds.has(obs.taskId)) {
        errors.push({
          field: `evidence.observations[${i}].taskId`,
          message: `observation references unknown task ${obs.taskId}.`,
        });
      }
      if (!versionKeys.has(`${obs.taskId}@${obs.taskVersion}`)) {
        errors.push({
          field: `evidence.observations[${i}].taskVersion`,
          message: `observation references unknown task version ${obs.taskId}@${obs.taskVersion}.`,
        });
      }
      if (!modelConfigIds.has(obs.modelConfigurationId)) {
        errors.push({
          field: `evidence.observations[${i}].modelConfigurationId`,
          message: `observation references unknown model configuration ${obs.modelConfigurationId}.`,
        });
      }
      if (
        obs.rubricRef !== null &&
        !rubricVersionKeys.has(`${obs.rubricRef.id}@${obs.rubricRef.version}`)
      ) {
        errors.push({
          field: `evidence.observations[${i}].rubricRef`,
          message: `observation references unknown rubric ${obs.rubricRef.id}@${obs.rubricRef.version}.`,
        });
      }
      if (!runIds.has(obs.sourceResultId)) {
        errors.push({
          field: `evidence.observations[${i}].sourceResultId`,
          message: `observation references unknown run ${obs.sourceResultId}.`,
        });
      }
    });

    evidencePayload.evidenceDecisions.forEach((dec, i) => {
      const obsId = (dec as { observationId?: string }).observationId ?? "";
      if (!isEligibilityDecision(dec)) {
        errors.push({
          field: `evidence.evidenceDecisions[${i}]`,
          message: `invalid eligibility decision for observation ${obsId}.`,
        });
      }
      if (!observationIds.has(dec.observationId)) {
        errors.push({
          field: `evidence.evidenceDecisions[${i}].observationId`,
          message: `decision references unknown observation ${dec.observationId}.`,
        });
      }
    });

    evidencePayload.verifierOutcomes.forEach((vo, i) => {
      const taskId = (vo as { taskId?: string }).taskId ?? "";
      if (!isExecutedVerifierOutcome(vo)) {
        errors.push({
          field: `evidence.verifierOutcomes[${i}]`,
          message: `invalid verifier outcome for task ${taskId}.`,
        });
      }
      if (!runIds.has(vo.runId)) {
        errors.push({
          field: `evidence.verifierOutcomes[${i}].runId`,
          message: `verifier outcome references unknown run ${vo.runId}.`,
        });
      }
      if (!taskIds.has(vo.taskId)) {
        errors.push({
          field: `evidence.verifierOutcomes[${i}].taskId`,
          message: `verifier outcome references unknown task ${vo.taskId}.`,
        });
      }
    });
  }
}

// --- Comparison payload validator (Child 05 Task 11) --------------------------

const COMPARISON_SNAP_REF_PATTERN = /^snap:sha256:([0-9a-f]{64})$/;
const COMPARISON_MIGRATED_REF_PATTERN = /^migrated:sha256:[0-9a-f]{64}$/;
/** Static membership tables (codebase idiom: readonly string lists, like the
 *  comparison-result-validation constants). */
const COMPARISON_SNAPSHOT_KINDS = ["input_snapshot", "task_instance", "task_version"] as const;
const COMPARISON_LIMITATION_REASONS = [
  "missing_detail",
  "corrupt_source",
  "instance_input_incomplete",
] as const;

/** Validate the optional Comparison Result payload: summary-only indexes with
 *  exact RunRecordV2 references, lineage links, canonical/ad-hoc bindings,
 *  immutable input-snapshot metadata/artifact references, and migration
 *  limitations (spec §3, §5, §9, §10, §13). */
function validateComparisonPayload(
  archive: WorkbenchArchiveV2,
  errors: ArchiveV2ValidationError[],
): void {
  const payload = archive.comparisons;
  if (payload === undefined) return;

  const exactRunIds = new Set(archive.runs.details.map((d) => d.id));
  const taskVersionKeys = new Set(
    archive.tasks.taskVersions.map((v) => `${v.taskId}@${v.version}`),
  );
  const instanceById = new Map(archive.tasks.taskInstances.map((i) => [i.id, i]));
  const artifactIds = new Set(archive.tasks.taskArtifacts.map((a) => a.id));
  const observationIds =
    archive.evidence !== undefined ? new Set(archive.evidence.observations.map((o) => o.id)) : null;

  // --- indexes: guards, exact run references, bindings, lineage ---------------
  const indexById = new Map<string, ComparisonResultIndex>();
  payload.indexes.forEach((index, i) => {
    if (!isComparisonResultIndex(index)) {
      errors.push({
        field: `comparisons.indexes[${i}]`,
        message: `invalid comparison index ${(index as { id?: string }).id ?? ""}.`,
      });
      return;
    }
    indexById.set(index.id, index);
    // Exact RunRecordV2 reference: the source run must be an exact record —
    // the index references the payload, it never copies it (spec §3, §13).
    if (!exactRunIds.has(index.runId)) {
      errors.push({
        field: `comparisons.indexes[${i}].runId`,
        message: `comparison index references unknown exact run ${index.runId}.`,
      });
    }
    if (index.taskBinding.kind === "canonical") {
      const versionKey = `${index.taskBinding.taskId}@${index.taskBinding.taskVersion}`;
      if (!taskVersionKeys.has(versionKey)) {
        errors.push({
          field: `comparisons.indexes[${i}].taskBinding`,
          message: `canonical binding references unknown task version ${versionKey}.`,
        });
      }
      if (index.taskInstanceId !== null && !instanceById.has(index.taskInstanceId)) {
        errors.push({
          field: `comparisons.indexes[${i}].taskInstanceId`,
          message: `canonical binding references unknown task instance ${index.taskInstanceId}.`,
        });
      }
    }
    if (observationIds !== null) {
      index.activeObservationIds.forEach((oid, j) => {
        if (!observationIds.has(oid)) {
          errors.push({
            field: `comparisons.indexes[${i}].activeObservationIds[${j}]`,
            message: `comparison index references unknown observation ${oid}.`,
          });
        }
      });
    }
  });
  payload.indexes.forEach((index, i) => {
    const rawIndex = index as Partial<ComparisonResultIndex> | null;
    const repeatedFrom = rawIndex?.lineage?.repeatedFrom ?? null;
    if (repeatedFrom !== null && !indexById.has(repeatedFrom)) {
      errors.push({
        field: `comparisons.indexes[${i}].lineage.repeatedFrom`,
        message: `lineage references unknown comparison ${repeatedFrom}.`,
      });
    }
  });

  // --- input snapshots: structure, 1:1 index coverage, binding consistency ----
  const snapshotByRunId = new Map<string, ArchiveV2ComparisonInputSnapshot>();
  payload.inputSnapshots.forEach((snap, i) => {
    const field = `comparisons.inputSnapshots[${i}]`;
    const raw = snap as unknown as Record<string, unknown>;
    if (!isNonEmptyString(raw.runId)) {
      errors.push({
        field: `${field}.runId`,
        message: "input snapshot runId must be a non-empty string.",
      });
      return;
    }
    const runId = raw.runId;
    if (!(COMPARISON_SNAPSHOT_KINDS as readonly string[]).includes(raw.kind as string)) {
      errors.push({
        field: `${field}.kind`,
        message: `unknown input snapshot kind ${String(raw.kind)}.`,
      });
      return;
    }
    if (!isNonEmptyString(raw.inputRef)) {
      errors.push({ field: `${field}.inputRef`, message: "inputRef must be a non-empty string." });
      return;
    }
    if (raw.inputDigest !== null && !isNonEmptyString(raw.inputDigest)) {
      errors.push({
        field: `${field}.inputDigest`,
        message: "inputDigest must be a string or null.",
      });
      return;
    }
    if (!Array.isArray(raw.artifactRefs) || raw.artifactRefs.some((r) => !isNonEmptyString(r))) {
      errors.push({
        field: `${field}.artifactRefs`,
        message: "artifactRefs must be an array of strings.",
      });
      return;
    }
    if (
      raw.limitation !== null &&
      !(COMPARISON_LIMITATION_REASONS as readonly string[]).includes(raw.limitation as string)
    ) {
      errors.push({
        field: `${field}.limitation`,
        message: `unknown limitation reason ${String(raw.limitation)}.`,
      });
      return;
    }
    const index = indexById.get(runId);
    if (index === undefined) {
      errors.push({
        field: `${field}.runId`,
        message: `input snapshot references unknown comparison ${runId}.`,
      });
      return;
    }
    const binding = index.taskBinding;
    if (raw.kind === "input_snapshot") {
      if (binding.kind !== "ad_hoc") {
        errors.push({
          field: `${field}.kind`,
          message: `input snapshot record for ${runId} must match the ad-hoc binding.`,
        });
        return;
      }
      if (raw.inputRef !== binding.inputSnapshotRef) {
        errors.push({
          field: `${field}.inputRef`,
          message: "input ref does not match the binding's inputSnapshotRef.",
        });
        return;
      }
      const snapMatch = COMPARISON_SNAP_REF_PATTERN.exec(raw.inputRef);
      const migratedMatch = COMPARISON_MIGRATED_REF_PATTERN.test(raw.inputRef);
      if (snapMatch) {
        if (raw.inputDigest !== `sha256:${snapMatch[1]}`) {
          errors.push({
            field: `${field}.inputDigest`,
            message: "inputDigest must equal the digest embedded in the snapshot ref.",
          });
        }
        if (raw.limitation !== null) {
          errors.push({
            field: `${field}.limitation`,
            message: "resolving snapshot refs record no limitation.",
          });
        }
        if ((raw.artifactRefs as string[]).length > 0) {
          errors.push({
            field: `${field}.artifactRefs`,
            message: "ad-hoc snapshot records carry no artifact references.",
          });
        }
      } else if (migratedMatch) {
        if (raw.inputDigest !== null) {
          errors.push({
            field: `${field}.inputDigest`,
            message: "non-resolving migrated refs carry no input digest.",
          });
        }
        if (raw.limitation !== "instance_input_incomplete") {
          errors.push({
            field: `${field}.limitation`,
            message: 'migrated refs require the "instance_input_incomplete" limitation.',
          });
        }
        if ((raw.artifactRefs as string[]).length > 0) {
          errors.push({
            field: `${field}.artifactRefs`,
            message: "ad-hoc snapshot records carry no artifact references.",
          });
        }
      } else {
        errors.push({
          field: `${field}.inputRef`,
          message: "unsupported snapshot ref shape.",
        });
      }
    } else if (raw.kind === "task_instance") {
      if (binding.kind !== "canonical" || index.taskInstanceId === null) {
        errors.push({
          field: `${field}.kind`,
          message:
            "task_instance snapshot records require a canonical binding with a task instance.",
        });
        return;
      }
      if (raw.inputRef !== index.taskInstanceId) {
        errors.push({
          field: `${field}.inputRef`,
          message: "input ref must equal the canonical binding's taskInstanceId.",
        });
        return;
      }
      const instance = instanceById.get(raw.inputRef);
      if (instance === undefined) {
        errors.push({
          field: `${field}.inputRef`,
          message: `input ref references unknown task instance ${String(raw.inputRef)}.`,
        });
        return;
      }
      const expected = [...instance.normalizedInput.artifactIds].sort();
      const actual = [...(raw.artifactRefs as string[])].sort();
      if (expected.join("\u0000") !== actual.join("\u0000")) {
        errors.push({
          field: `${field}.artifactRefs`,
          message: "artifactRefs must match the task instance's input artifacts.",
        });
      }
      if (raw.inputDigest !== null) {
        errors.push({
          field: `${field}.inputDigest`,
          message: "task-instance refs carry no input digest.",
        });
      }
      if (raw.limitation !== null) {
        errors.push({
          field: `${field}.limitation`,
          message: "task-instance refs record no limitation.",
        });
      }
    } else {
      // task_version
      if (binding.kind !== "canonical" || index.taskInstanceId !== null) {
        errors.push({
          field: `${field}.kind`,
          message:
            "task_version snapshot records require a canonical binding without a task instance.",
        });
        return;
      }
      const versionKey = `${binding.taskId}@${binding.taskVersion}`;
      if (raw.inputRef !== versionKey) {
        errors.push({
          field: `${field}.inputRef`,
          message: "input ref must equal the canonical binding's task version key.",
        });
      }
      if (
        raw.inputDigest !== null ||
        (raw.artifactRefs as string[]).length > 0 ||
        raw.limitation !== null
      ) {
        errors.push({
          field: `${field}.limitation`,
          message: "task_version snapshot records carry no digest, artifacts, or limitation.",
        });
      }
    }
    for (const aid of raw.artifactRefs as string[]) {
      if (!artifactIds.has(aid)) {
        errors.push({
          field: `${field}.artifactRefs`,
          message: `input snapshot references unknown artifact ${aid}.`,
        });
      }
    }
    snapshotByRunId.set(runId, snap);
  });

  // 1:1: every index carries exactly one snapshot record.
  payload.indexes.forEach((index) => {
    const indexId = (index as Partial<ComparisonResultIndex> | null)?.id ?? "";
    if (indexId !== "" && indexById.has(indexId) && !snapshotByRunId.has(indexId)) {
      errors.push({
        field: "comparisons.inputSnapshots",
        message: `missing input snapshot record for comparison ${indexId}.`,
      });
    }
  });

  // --- limitations: 1:1 with non-resolving snapshot records -------------------
  const limitationByRunId = new Map<string, ComparisonMigrationLimitation>();
  payload.limitations.forEach((lim, i) => {
    const field = `comparisons.limitations[${i}]`;
    const raw = lim as unknown as Record<string, unknown>;
    if (!isNonEmptyString(raw.runId)) {
      errors.push({
        field: `${field}.runId`,
        message: "limitation runId must be a non-empty string.",
      });
      return;
    }
    const runId = raw.runId;
    const index = indexById.get(runId);
    if (index === undefined) {
      errors.push({
        field: `${field}.runId`,
        message: `limitation references unknown comparison ${runId}.`,
      });
      return;
    }
    limitationByRunId.set(runId, lim);
    const expectedReason = snapshotByRunId.get(runId)?.limitation ?? null;
    if (expectedReason === null) {
      errors.push({
        field: `${field}.reason`,
        message: `comparison ${runId} has no limitation to record.`,
      });
    } else if (raw.reason !== expectedReason) {
      errors.push({
        field: `${field}.reason`,
        message: "limitation reason does not match the snapshot record.",
      });
    }
  });
  for (const snap of snapshotByRunId.values()) {
    if (snap.limitation !== null && !limitationByRunId.has(snap.runId)) {
      errors.push({
        field: "comparisons.limitations",
        message: `missing limitation record for comparison ${snap.runId}.`,
      });
    }
  }
}

function validateArtifactBytes(
  archive: WorkbenchArchiveV2,
  errors: ArchiveV2ValidationError[],
): void {
  const summaryIds = new Set(archive.tasks.taskArtifacts.map((a) => a.id));
  const bytesById = new Map<string, ArchiveV2TaskArtifactBytes>();
  archive.tasks.taskArtifactBytes.forEach((b, i) => {
    if (!summaryIds.has(b.id)) {
      errors.push({
        field: `tasks.taskArtifactBytes[${i}].id`,
        message: `orphan artifact bytes ${b.id} with no matching artifact summary.`,
      });
    } else {
      bytesById.set(b.id, b);
    }
  });
  archive.tasks.taskArtifacts.forEach((a, i) => {
    const bytes = bytesById.get(a.id);
    if (!bytes) {
      errors.push({
        field: `tasks.taskArtifacts[${i}].id`,
        message: `artifact ${a.id} is missing bytes payload.`,
      });
      return;
    }
    let decoded: Uint8Array;
    try {
      const raw = atob(bytes.bytesBase64);
      decoded = new Uint8Array(raw.length);
      for (let j = 0; j < raw.length; j++) decoded[j] = raw.charCodeAt(j);
    } catch {
      errors.push({
        field: `tasks.taskArtifactBytes`,
        message: `artifact ${a.id} bytes are not valid base64.`,
      });
      return;
    }
    if (decoded.length !== a.byteCount) {
      errors.push({
        field: `tasks.taskArtifacts[${i}].byteCount`,
        message: `byte count mismatch for ${a.id}: summary ${a.byteCount} vs bytes ${decoded.length}.`,
      });
    }
    const digest = computeArtifactDigest(decoded);
    if (digest !== a.contentDigest) {
      errors.push({
        field: `tasks.taskArtifacts[${i}].contentDigest`,
        message: `content digest mismatch for ${a.id}: summary ${a.contentDigest} vs computed ${digest}.`,
      });
    }
  });
}

function validateOrdering(archive: WorkbenchArchiveV2, errors: ArchiveV2ValidationError[]): void {
  checkOrdering({ field: "runs.summaries", items: archive.runs.summaries, key: byId }, errors);
  checkOrdering({ field: "runs.details", items: archive.runs.details, key: byId }, errors);
  checkOrdering(
    { field: "rubrics.identities", items: archive.rubrics.identities, key: byId },
    errors,
  );
  checkOrdering(
    { field: "rubrics.versions", items: archive.rubrics.versions, key: byIdVersion },
    errors,
  );
  checkOrdering({ field: "suites", items: archive.suites, key: byId }, errors);
  checkOrdering({ field: "experiments", items: archive.experiments, key: byId }, errors);
  checkOrdering(
    { field: "fusion.recipes", items: archive.fusion.recipes, key: byIdVersion },
    errors,
  );
  checkOrdering(
    { field: "fusion.poolManifests", items: archive.fusion.poolManifests, key: byIdVersion },
    errors,
  );
  checkOrdering({ field: "fusion.studies", items: archive.fusion.studies, key: byId }, errors);
  checkOrdering({ field: "fusion.trials", items: archive.fusion.trials, key: byId }, errors);
  checkOrdering({ field: "fusion.attempts", items: archive.fusion.attempts, key: byId }, errors);
  checkOrdering(
    { field: "fusion.observations", items: archive.fusion.observations, key: byId },
    errors,
  );
  checkOrdering({ field: "fusion.playbooks", items: archive.fusion.playbooks, key: byId }, errors);
  checkOrdering({ field: "tasks.tasks", items: archive.tasks.tasks, key: byId }, errors);
  checkOrdering(
    { field: "tasks.taskVersions", items: archive.tasks.taskVersions, key: byTaskIdVersion },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskArtifacts", items: archive.tasks.taskArtifacts, key: byId },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskArtifactBytes", items: archive.tasks.taskArtifactBytes, key: byId },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskInstances", items: archive.tasks.taskInstances, key: byId },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskFamilies", items: archive.tasks.taskFamilies, key: byId },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskFamilyAssignments", items: archive.tasks.taskFamilyAssignments, key: byId },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskFamilyRelations", items: archive.tasks.taskFamilyRelations, key: byId },
    errors,
  );
  checkOrdering(
    { field: "tasks.taskFacetAnnotations", items: archive.tasks.taskFacetAnnotations, key: byId },
    errors,
  );
  checkOrdering(
    {
      field: "tasks.taskMigrationCrosswalks",
      items: archive.tasks.taskMigrationCrosswalks,
      key: byLegacyScopeKey,
    },
    errors,
  );
  const taskSets = archive.taskSets;
  if (taskSets !== undefined) {
    checkOrdering({ field: "taskSets.records", items: taskSets.records, key: byId }, errors);
    checkOrdering(
      { field: "taskSets.versions", items: taskSets.versions, key: byTaskSetIdVersion },
      errors,
    );
    checkOrdering(
      { field: "taskSets.materializations", items: taskSets.materializations, key: byId },
      errors,
    );
    checkOrdering(
      { field: "taskSets.ownershipCrosswalks", items: taskSets.ownershipCrosswalks, key: byKey },
      errors,
    );
  }
  const ev = archive.evidence;
  if (ev !== undefined) {
    checkOrdering(
      { field: "evidence.modelConfigurations", items: ev.modelConfigurations, key: byId },
      errors,
    );
    checkOrdering({ field: "evidence.observations", items: ev.observations, key: byId }, errors);
    checkOrdering(
      {
        field: "evidence.evidenceDecisions",
        items: ev.evidenceDecisions,
        key: byObservationIdRuleVersion,
      },
      errors,
    );
    checkOrdering(
      { field: "evidence.evidenceIndexJobs", items: ev.evidenceIndexJobs, key: bySourceResultId },
      errors,
    );
    checkOrdering(
      { field: "evidence.verifierOutcomes", items: ev.verifierOutcomes, key: byVerifierOutcomeKey },
      errors,
    );
  }
  const cmp = archive.comparisons;
  if (cmp !== undefined) {
    checkOrdering({ field: "comparisons.indexes", items: cmp.indexes, key: byId }, errors);
    checkOrdering(
      { field: "comparisons.inputSnapshots", items: cmp.inputSnapshots, key: byRunId },
      errors,
    );
    checkOrdering(
      { field: "comparisons.limitations", items: cmp.limitations, key: byRunId },
      errors,
    );
  }
}

function validateDuplicates(archive: WorkbenchArchiveV2, errors: ArchiveV2ValidationError[]): void {
  checkDuplicates("runs.summaries", archive.runs.summaries, byId, errors);
  checkDuplicates("runs.details", archive.runs.details, byId, errors);
  checkDuplicates("rubrics.identities", archive.rubrics.identities, byId, errors);
  checkDuplicates("rubrics.versions", archive.rubrics.versions, byIdVersion, errors);
  checkDuplicates("suites", archive.suites, byId, errors);
  checkDuplicates("experiments", archive.experiments, byId, errors);
  checkDuplicates("fusion.recipes", archive.fusion.recipes, byIdVersion, errors);
  checkDuplicates("fusion.poolManifests", archive.fusion.poolManifests, byIdVersion, errors);
  checkDuplicates("fusion.studies", archive.fusion.studies, byId, errors);
  checkDuplicates("fusion.trials", archive.fusion.trials, byId, errors);
  checkDuplicates("fusion.attempts", archive.fusion.attempts, byId, errors);
  checkDuplicates("fusion.observations", archive.fusion.observations, byId, errors);
  checkDuplicates("fusion.playbooks", archive.fusion.playbooks, byId, errors);
  checkDuplicates("tasks.tasks", archive.tasks.tasks, byId, errors);
  checkDuplicates("tasks.taskVersions", archive.tasks.taskVersions, byTaskIdVersion, errors);
  checkDuplicates("tasks.taskArtifacts", archive.tasks.taskArtifacts, byId, errors);
  checkDuplicates("tasks.taskArtifactBytes", archive.tasks.taskArtifactBytes, byId, errors);
  checkDuplicates("tasks.taskInstances", archive.tasks.taskInstances, byId, errors);
  checkDuplicates("tasks.taskFamilies", archive.tasks.taskFamilies, byId, errors);
  checkDuplicates("tasks.taskFamilyAssignments", archive.tasks.taskFamilyAssignments, byId, errors);
  checkDuplicates("tasks.taskFamilyRelations", archive.tasks.taskFamilyRelations, byId, errors);
  checkDuplicates("tasks.taskFacetAnnotations", archive.tasks.taskFacetAnnotations, byId, errors);
  checkDuplicates(
    "tasks.taskMigrationCrosswalks",
    archive.tasks.taskMigrationCrosswalks,
    byLegacyScopeKey,
    errors,
  );
  const taskSets = archive.taskSets;
  if (taskSets !== undefined) {
    checkDuplicates("taskSets.records", taskSets.records, byId, errors);
    checkDuplicates("taskSets.versions", taskSets.versions, byTaskSetIdVersion, errors);
    checkDuplicates("taskSets.materializations", taskSets.materializations, byId, errors);
    checkDuplicates("taskSets.ownershipCrosswalks", taskSets.ownershipCrosswalks, byKey, errors);
  }
  const evDup = archive.evidence;
  if (evDup !== undefined) {
    checkDuplicates("evidence.modelConfigurations", evDup.modelConfigurations, byId, errors);
    checkDuplicates("evidence.observations", evDup.observations, byId, errors);
    checkDuplicates(
      "evidence.evidenceDecisions",
      evDup.evidenceDecisions,
      byObservationIdRuleVersion,
      errors,
    );
    checkDuplicates(
      "evidence.evidenceIndexJobs",
      evDup.evidenceIndexJobs,
      bySourceResultId,
      errors,
    );
    checkDuplicates(
      "evidence.verifierOutcomes",
      evDup.verifierOutcomes,
      byVerifierOutcomeKey,
      errors,
    );
  }
  const cmpDup = archive.comparisons;
  if (cmpDup !== undefined) {
    checkDuplicates("comparisons.indexes", cmpDup.indexes, byId, errors);
    checkDuplicates("comparisons.inputSnapshots", cmpDup.inputSnapshots, byRunId, errors);
    checkDuplicates("comparisons.limitations", cmpDup.limitations, byRunId, errors);
  }
}

// --- Public validator --------------------------------------------------------

/** Validate a complete archive v2 envelope BEFORE any write. Pure: no side
 *  effects, no database. Covers unknown versions, missing collections,
 *  duplicate IDs, missing references/artifacts, byte count/digest mismatch,
 *  prohibited credential/auth content, deterministic ordering, manifest count
 *  and payload-digest integrity, and complete reference-graph validity. */
export function validateArchiveV2(value: unknown): ArchiveV2ValidationResult {
  if (!isRecord(value)) {
    return fail([{ field: "", message: "archive v2 must be an object." }]);
  }
  // Boundary assertion: isRecord proved object shape; assert the named envelope
  // type once at the validation boundary (rule-sanctioned), not per field.
  const archive = value as unknown as WorkbenchArchiveV2;
  const errors: ArchiveV2ValidationError[] = [];

  for (const key of ARCHIVE_V2_COLLECTION_KEYS) {
    if (!(key in archive)) {
      errors.push({ field: key, message: `archive v2 is missing top-level collection ${key}.` });
    }
  }
  if (!isRecord(archive.manifest)) {
    errors.push({ field: "manifest", message: "manifest must be an object." });
  }
  requireArrays(archive, errors);
  // Stop early if structure is broken so downstream validators do not crash.
  if (errors.length > 0) return fail(errors);

  validateManifest(archive, errors);
  validateDuplicates(archive, errors);
  validateOrdering(archive, errors);
  validateReferenceGraph(archive, errors);
  validateComparisonPayload(archive, errors);
  validateArtifactBytes(archive, errors);

  const prohibited = scanProhibitedContent(archive);
  if (prohibited !== null) {
    errors.push({ field: "payload", message: prohibited });
  }

  return errors.length === 0 ? { valid: true, errors: [] } : fail(errors);
}
