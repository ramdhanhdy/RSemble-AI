// =============================================================================
// RSemble AI — Archive v3 contract: envelope, collections, validators
//
// Child 06 (Research Lab & Policy Studies) Milestone E / Task 11.
//
// Defines the canonical archive v3 envelope (`WorkbenchArchiveV3`).
// Proves that post-v13 persistence and the archive model describe the same
// canonical state (REV-1):
//   - Surviving Child 01–05 entities (Runs, Rubrics, Suites, Experiments,
//     Canonical Tasks, Task Sets, Referenced Exact Evidence, Comparisons);
//   - Canonical Child 06 Lab entities (Lab Recipes, Model Pools, Policy Studies,
//     Study Trials, Study Attempts, Study Observations, Policy Playbooks);
//   - REV-2: The seven deleted Fusion stores never appear in v3 manifests,
//     payloads, or routes;
//   - REV-3: Legacy Fusion-shaped archive collections are rejected
//     deterministically before any write with a receipt describing what was
//     rejected and why;
//   - Pure validation runs BEFORE any write and covers unknown versions,
//     duplicate IDs, missing references/artifacts, byte count/digest mismatch,
//     prohibited credential/auth content, deterministic ordering, and complete
//     reference-graph validity.
// =============================================================================

import { canonicalJsonString } from "../evaluations/protocol-fingerprint";
import { computeArtifactDigest } from "../tasks/task-instance";
import { type RunRecordV2, type RunSummary, isRecord } from "./run-types";
import type {
  EvaluationRubric,
  EvaluationSuite,
  ExperimentRecord,
  RubricRecord,
} from "../evaluations/evaluation-types";
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
import type { TaskSetRecord, TaskSetVersion } from "../evaluations/task-set-types";
import type { TaskSetMaterializationRecord } from "./evaluation-repository";
import type { TaskSetOwnershipCrosswalkRow } from "./database";
import type {
  ModelConfigurationSnapshot,
  Observation,
  EligibilityDecision,
  ExecutedVerifierOutcome,
} from "../evidence/evidence-types";
import type { EvidenceIndexJob } from "./evidence-repository";
import type { ComparisonResultIndex } from "../compare/comparison-result-types";
import type { ComparisonMigrationLimitation } from "./comparison-result-migration";
import {
  type LabRecipeRecord,
  type LabRecipeVersion,
  isLabRecipeRecord,
  isLabRecipeVersion,
} from "../studies/lab-recipe-types";
import {
  type ModelPoolRecord,
  type ModelPoolVersion,
  isModelPoolRecord,
  isModelPoolVersion,
} from "../studies/model-pool-types";
import {
  type PolicyReportPayload,
  type PolicyStudyObservation,
  type PolicyStudyRecord,
  type PolicyStudyTrial,
  isPolicyReportPayload,
  isPolicyStudyObservation,
  isPolicyStudyRecord,
  isPolicyStudyTrial,
} from "../studies/policy/policy-study-types";
import { type StudyAttempt, isStudyAttempt } from "../studies/study-types";
import {
  isFusionToResearchLabReceipt,
  type FusionToResearchLabReceipt,
} from "../migrations/fusion-to-research-lab-receipt";

// --- Versions ----------------------------------------------------------------

/** Envelope format version. Bumped to 3 for the canonical Research Lab cutover. */
export const ARCHIVE_V3_FORMAT_VERSION = 3;

/** Storage schema version captured by this envelope (the Dexie schema version
 *  the producer wrote against). Validators reject an unknown storage version. */
export const ARCHIVE_V3_STORAGE_VERSION = 1;

// --- Manifest / disclosure ---------------------------------------------------

export interface ArchiveV3Disclosure {
  scope: "local";
  notes: string | null;
}

/** Deterministic per-collection entity counts. Every collection key in
 *  `WorkbenchArchiveV3` has a matching count; validators reject a mismatch. */
export interface ArchiveV3EntityCounts {
  // runs
  runSummaries: number;
  runDetails: number;
  // rubrics
  rubricIdentities: number;
  rubricVersions: number;
  // suites
  suites: number;
  // experiments
  experiments: number;
  // tasks
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
  // taskSets
  taskSetRecords: number;
  taskSetVersions: number;
  taskSetMaterializations: number;
  taskSetOwnershipCrosswalks: number;
  // evidence
  modelConfigurations: number;
  evidenceObservations: number;
  evidenceDecisions: number;
  evidenceIndexJobs: number;
  verifierOutcomes: number;
  // comparisons
  comparisonIndexes: number;
  comparisonInputSnapshots: number;
  comparisonLimitations: number;
  // lab (Child 06 canonical collections — REV-1 / REV-2)
  labRecipeRecords: number;
  labRecipeVersions: number;
  modelPoolRecords: number;
  modelPoolVersions: number;
  studies: number;
  studyTrials: number;
  studyAttempts: number;
  studyObservations: number;
  policyPlaybooks: number;
  /** Canonical v13 Fusion→Research Lab cutover/discard receipt (exactly one). */
  fusionToResearchLabReceipts: number;
}

export interface ArchiveV3Manifest {
  formatVersion: number;
  storageVersion: number;
  exportedAt: number;
  producer: string;
  counts: ArchiveV3EntityCounts;
  /** Integrity digest (`sha256:<hex>`) over the canonical JSON of the data
   *  payload (all collections except the manifest itself). */
  payloadDigest: string;
  disclosure: ArchiveV3Disclosure;
}

// --- Artifact bytes ----------------------------------------------------------

export interface ArchiveV3TaskArtifactBytes {
  id: string;
  bytesBase64: string;
}

// --- Envelope payloads -------------------------------------------------------

export interface ArchiveV3TaskPayload {
  tasks: TaskRecord[];
  taskVersions: TaskVersion[];
  taskArtifacts: TaskArtifact[];
  taskArtifactBytes: ArchiveV3TaskArtifactBytes[];
  taskInstances: TaskInstance[];
  taskFamilies: TaskFamily[];
  taskFamilyAssignments: TaskFamilyAssignment[];
  taskFamilyRelations: TaskFamilyRelation[];
  taskFacetAnnotations: TaskFacetAnnotation[];
  taskMigrationCrosswalks: TaskMigrationCrosswalk[];
}

export interface ArchiveV3TaskSetPayload {
  records: TaskSetRecord[];
  versions: TaskSetVersion[];
  materializations: TaskSetMaterializationRecord[];
  ownershipCrosswalks: TaskSetOwnershipCrosswalkRow[];
}

export interface ArchiveV3EvidencePayload {
  modelConfigurations: ModelConfigurationSnapshot[];
  observations: Observation[];
  evidenceDecisions: EligibilityDecision[];
  evidenceIndexJobs: EvidenceIndexJob[];
  verifierOutcomes: ExecutedVerifierOutcome[];
}

export interface ArchiveV3ComparisonInputSnapshot {
  runId: string;
  snapshotKind: "input_snapshot" | "task_instance" | "task_version";
  snapshotRef: string;
  taskId: string | null;
  taskVersion: number | null;
  taskInstanceId: string | null;
  completeness: "exact" | "partial" | "synthesized";
  capturedAt: number;
}

export interface ArchiveV3ComparisonPayload {
  indexes: ComparisonResultIndex[];
  inputSnapshots: ArchiveV3ComparisonInputSnapshot[];
  limitations: ComparisonMigrationLimitation[];
}

export interface ArchiveV3PolicyPlaybook {
  /** Persisted immutable policyPlaybooks primary-key identity. */
  id: string;
  playbook: PolicyReportPayload;
}

export interface ArchiveV3LabPayload {
  recipeRecords: LabRecipeRecord[];
  recipeVersions: LabRecipeVersion[];
  poolRecords: ModelPoolRecord[];
  poolVersions: ModelPoolVersion[];
  studies: PolicyStudyRecord[];
  trials: PolicyStudyTrial[];
  attempts: StudyAttempt[];
  observations: PolicyStudyObservation[];
  /** Row identities stay distinct from the playbook's owner study ID. */
  playbooks: ArchiveV3PolicyPlaybook[];
  /** The one canonical v13 cutover/discard receipt from storageMeta. */
  cutoverReceipt: FusionToResearchLabReceipt;
}

/** The complete, task-first archive v3 envelope. Survives all Child 01–06
 *  canonical states without legacy Fusion collections (REV-1 / REV-2). */
export interface WorkbenchArchiveV3 {
  manifest: ArchiveV3Manifest;
  runs: { summaries: RunSummary[]; details: RunRecordV2[] };
  rubrics: { identities: RubricRecord[]; versions: EvaluationRubric[] };
  suites: EvaluationSuite[];
  experiments: ExperimentRecord[];
  tasks: ArchiveV3TaskPayload;
  taskSets: ArchiveV3TaskSetPayload;
  evidence: ArchiveV3EvidencePayload;
  comparisons: ArchiveV3ComparisonPayload;
  lab: ArchiveV3LabPayload;
}

/** Top-level collection keys, in deterministic declaration order. */
export const ARCHIVE_V3_COLLECTION_KEYS = [
  "manifest",
  "runs",
  "rubrics",
  "suites",
  "experiments",
  "tasks",
  "taskSets",
  "evidence",
  "comparisons",
  "lab",
] as const;

// --- Legacy Fusion Receipt (REV-3) -------------------------------------------

export interface ArchiveUnsupportedFusionReceipt {
  format: "unsupported_fusion_archive_shape";
  rejectedAt: number;
  sourceLabel: string;
  rejectedCollections: string[];
  reason: string;
}

/** Detect if an input payload contains legacy Fusion collections and produce a receipt. */
export function detectLegacyFusionArchive(
  value: unknown,
  sourceLabel = "archive",
): ArchiveUnsupportedFusionReceipt | null {
  if (!isRecord(value)) return null;

  const rejectedCollections: string[] = [];
  const fusion = value.fusion;
  if (isRecord(fusion)) {
    if (Array.isArray(fusion.recipes) && fusion.recipes.length > 0)
      rejectedCollections.push("fusionRecipes");
    if (Array.isArray(fusion.poolManifests) && fusion.poolManifests.length > 0)
      rejectedCollections.push("poolManifests");
    if (Array.isArray(fusion.studies) && fusion.studies.length > 0)
      rejectedCollections.push("fusionStudies");
    if (Array.isArray(fusion.trials) && fusion.trials.length > 0)
      rejectedCollections.push("fusionTrials");
    if (Array.isArray(fusion.attempts) && fusion.attempts.length > 0)
      rejectedCollections.push("fusionAttempts");
    if (Array.isArray(fusion.observations) && fusion.observations.length > 0)
      rejectedCollections.push("fusionObservations");
    if (Array.isArray(fusion.playbooks) && fusion.playbooks.length > 0)
      rejectedCollections.push("fusionPlaybooks");
  }

  const manifest = value.manifest;
  if (isRecord(manifest) && isRecord(manifest.counts)) {
    const c = manifest.counts;
    const checkCount = (key: string, label: string) => {
      if (typeof c[key] === "number" && c[key] > 0 && !rejectedCollections.includes(label)) {
        rejectedCollections.push(label);
      }
    };
    checkCount("fusionRecipes", "fusionRecipes");
    checkCount("fusionPoolManifests", "poolManifests");
    checkCount("poolManifests", "poolManifests");
    checkCount("fusionStudies", "fusionStudies");
    checkCount("fusionTrials", "fusionTrials");
    checkCount("fusionAttempts", "fusionAttempts");
    checkCount("fusionObservations", "fusionObservations");
    checkCount("fusionPlaybooks", "fusionPlaybooks");
  }

  if (rejectedCollections.length > 0) {
    return {
      format: "unsupported_fusion_archive_shape",
      rejectedAt: Date.now(),
      sourceLabel,
      rejectedCollections,
      reason: `This archive contains retired Fusion Study collections (${rejectedCollections.join(", ")}) and cannot be imported. Export a new archive from an upgraded RSemble instead.`,
    };
  }

  return null;
}

// --- Validation result -------------------------------------------------------

export interface ArchiveV3ValidationError {
  field: string;
  message: string;
}

export interface ArchiveV3ValidationResult {
  valid: boolean;
  errors: ArchiveV3ValidationError[];
}

function fail(errors: ArchiveV3ValidationError[]): ArchiveV3ValidationResult {
  return { valid: false, errors };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// --- Payload digest ----------------------------------------------------------

function payloadForDigest(archive: WorkbenchArchiveV3): Record<string, unknown> {
  return {
    runs: archive.runs,
    rubrics: archive.rubrics,
    suites: archive.suites,
    experiments: archive.experiments,
    tasks: archive.tasks,
    taskSets: archive.taskSets,
    evidence: archive.evidence,
    comparisons: archive.comparisons,
    lab: archive.lab,
  };
}

export function computeArchiveV3PayloadDigest(archive: WorkbenchArchiveV3): string {
  const canonical = canonicalJsonString(payloadForDigest(archive));
  const bytes = new TextEncoder().encode(canonical);
  return computeArtifactDigest(bytes);
}

// --- Type guard --------------------------------------------------------------

export function isWorkbenchArchiveV3(value: unknown): value is WorkbenchArchiveV3 {
  if (!isRecord(value)) return false;
  const manifest = value.manifest;
  if (!isRecord(manifest)) return false;
  if (manifest.formatVersion !== ARCHIVE_V3_FORMAT_VERSION) return false;
  return (
    isRecord(value.runs) &&
    isRecord(value.rubrics) &&
    Array.isArray(value.suites) &&
    Array.isArray(value.experiments) &&
    isRecord(value.tasks) &&
    isRecord(value.taskSets) &&
    isRecord(value.evidence) &&
    isRecord(value.comparisons) &&
    isRecord(value.lab)
  );
}

// --- Prohibited content scan -------------------------------------------------

function hasProhibitedContent(value: unknown): boolean {
  if (typeof value === "string") {
    if (value.startsWith("sk-") || value.startsWith("AIza") || value.startsWith("Bearer ")) {
      return true;
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(hasProhibitedContent);
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      const lower = key.toLowerCase();
      if (
        lower === "apikey" ||
        lower === "authorization" ||
        lower === "token" ||
        lower === "secret" ||
        lower === "password" ||
        lower === "cookie" ||
        lower === "cookies" ||
        lower === "proxyurl"
      ) {
        return true;
      }
      if (hasProhibitedContent(value[key])) return true;
    }
  }
  return false;
}

function scanProhibitedContent(archive: WorkbenchArchiveV3): string | null {
  for (const s of archive.runs.summaries)
    if (hasProhibitedContent(s)) return `runs.summaries[${s.id}]`;
  for (const d of archive.runs.details) if (hasProhibitedContent(d)) return `runs.details[${d.id}]`;
  for (const r of archive.rubrics.identities)
    if (hasProhibitedContent(r)) return `rubrics.identities[${r.id}]`;
  for (const v of archive.rubrics.versions)
    if (hasProhibitedContent(v)) return `rubrics.versions[${v.id}@${v.version}]`;
  for (const s of archive.suites) if (hasProhibitedContent(s)) return `suites[${s.id}]`;
  for (const e of archive.experiments) if (hasProhibitedContent(e)) return `experiments[${e.id}]`;

  for (const t of archive.tasks.tasks) if (hasProhibitedContent(t)) return `tasks.tasks[${t.id}]`;
  for (const v of archive.tasks.taskVersions)
    if (hasProhibitedContent(v)) return `tasks.taskVersions[${v.taskId}@${v.version}]`;
  for (const a of archive.tasks.taskArtifacts)
    if (hasProhibitedContent(a)) return `tasks.taskArtifacts[${a.id}]`;
  for (const i of archive.tasks.taskInstances)
    if (hasProhibitedContent(i)) return `tasks.taskInstances[${i.id}]`;
  for (const f of archive.tasks.taskFamilies)
    if (hasProhibitedContent(f)) return `tasks.taskFamilies[${f.id}]`;
  for (const a of archive.tasks.taskFamilyAssignments)
    if (hasProhibitedContent(a)) return `tasks.taskFamilyAssignments[${a.id}]`;
  for (const r of archive.tasks.taskFamilyRelations)
    if (hasProhibitedContent(r)) return `tasks.taskFamilyRelations[${r.id}]`;
  for (const a of archive.tasks.taskFacetAnnotations)
    if (hasProhibitedContent(a)) return `tasks.taskFacetAnnotations[${a.id}]`;

  for (const r of archive.taskSets.records)
    if (hasProhibitedContent(r)) return `taskSets.records[${r.id}]`;
  for (const v of archive.taskSets.versions)
    if (hasProhibitedContent(v)) return `taskSets.versions[${v.taskSetId}@${v.version}]`;
  for (const m of archive.taskSets.materializations)
    if (hasProhibitedContent(m)) return `taskSets.materializations[${m.id}]`;
  for (const c of archive.taskSets.ownershipCrosswalks)
    if (hasProhibitedContent(c)) return `taskSets.ownershipCrosswalks[${c.key}]`;

  for (const mc of archive.evidence.modelConfigurations)
    if (hasProhibitedContent(mc)) return `evidence.modelConfigurations[${mc.id}]`;
  for (const o of archive.evidence.observations)
    if (hasProhibitedContent(o)) return `evidence.observations[${o.id}]`;
  for (const d of archive.evidence.evidenceDecisions)
    if (hasProhibitedContent(d))
      return `evidence.evidenceDecisions[${d.observationId}#${d.ruleVersion}]`;
  for (const j of archive.evidence.evidenceIndexJobs)
    if (hasProhibitedContent(j)) return `evidence.evidenceIndexJobs[${j.sourceResultId}]`;
  for (const vo of archive.evidence.verifierOutcomes)
    if (hasProhibitedContent(vo)) return `evidence.verifierOutcomes[${vo.taskId}]`;

  for (const i of archive.comparisons.indexes)
    if (hasProhibitedContent(i)) return `comparisons.indexes[${i.id}]`;

  for (const rr of archive.lab.recipeRecords)
    if (hasProhibitedContent(rr)) return `lab.recipeRecords[${rr.id}]`;
  for (const rv of archive.lab.recipeVersions)
    if (hasProhibitedContent(rv)) return `lab.recipeVersions[${rv.recipeId}@${rv.version}]`;
  for (const pr of archive.lab.poolRecords)
    if (hasProhibitedContent(pr)) return `lab.poolRecords[${pr.id}]`;
  for (const pv of archive.lab.poolVersions)
    if (hasProhibitedContent(pv)) return `lab.poolVersions[${pv.poolId}@${pv.version}]`;
  for (const st of archive.lab.studies)
    if (hasProhibitedContent(st)) return `lab.studies[${st.id}]`;
  for (const tr of archive.lab.trials) if (hasProhibitedContent(tr)) return `lab.trials[${tr.id}]`;
  for (const at of archive.lab.attempts)
    if (hasProhibitedContent(at)) return `lab.attempts[${at.id}]`;
  for (const ob of archive.lab.observations)
    if (hasProhibitedContent(ob)) return `lab.observations[${ob.id}]`;
  for (const pb of archive.lab.playbooks)
    if (hasProhibitedContent(pb)) return `lab.playbooks[${pb.id}]`;
  if (hasProhibitedContent(archive.lab.cutoverReceipt)) return "lab.cutoverReceipt";

  return null;
}

// --- Key extractors ----------------------------------------------------------

function byId(item: { id: string }): string {
  return item.id;
}

function byIdVersion(item: { id: string; version: number }): string {
  return `${item.id}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byTaskIdVersion(item: { taskId: string; version: number }): string {
  return `${item.taskId}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byTaskSetIdVersion(item: { taskSetId: string; version: number }): string {
  return `${item.taskSetId}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byRecipeIdVersion(item: { recipeId: string; version: number }): string {
  return `${item.recipeId}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byPoolIdVersion(item: { poolId: string; version: number }): string {
  return `${item.poolId}\u0000${item.version.toString().padStart(10, "0")}`;
}

function byLegacyScopeKey(item: { legacyScopeKey: string }): string {
  return item.legacyScopeKey;
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
  taskId: string;
  modelKey: string;
  runId: string;
  executedAt: number;
}): string {
  return `${item.runId}::${item.taskId}::${item.modelKey}::${item.executedAt}`;
}

function byRunId(item: { runId: string }): string {
  return item.runId;
}

// --- Ordering & Duplicate helpers --------------------------------------------

function checkDuplicates<T>(
  field: string,
  items: T[],
  key: (item: T) => string,
  errors: ArchiveV3ValidationError[],
): void {
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const k = key(items[i]);
    if (seen.has(k)) {
      errors.push({ field: `${field}[${i}]`, message: `duplicate key: ${k}` });
    }
    seen.add(k);
  }
}

function checkOrdering<T>(
  field: string,
  items: T[],
  key: (item: T) => string,
  errors: ArchiveV3ValidationError[],
): void {
  for (let i = 1; i < items.length; i++) {
    const prev = key(items[i - 1]);
    const curr = key(items[i]);
    if (prev >= curr) {
      errors.push({
        field: `${field}[${i}]`,
        message: `collection is not sorted ascending by deterministic key (${prev} >= ${curr}).`,
      });
      break;
    }
  }
}

// --- Validator ---------------------------------------------------------------

export function validateArchiveV3(value: unknown): ArchiveV3ValidationResult {
  if (!isRecord(value)) {
    return fail([{ field: "", message: "archive v3 must be an object." }]);
  }

  const errors: ArchiveV3ValidationError[] = [];

  // REV-2: deleted stores stay deleted — no top-level fusion key allowed
  if ("fusion" in value) {
    errors.push({
      field: "fusion",
      message: "legacy fusion collections must not appear in archive v3 (REV-2).",
    });
  }

  // Structural checks
  const manifest = value.manifest;
  if (!isRecord(manifest)) {
    errors.push({ field: "manifest", message: "manifest must be an object." });
    return fail(errors);
  }

  if (manifest.formatVersion !== ARCHIVE_V3_FORMAT_VERSION) {
    errors.push({
      field: "manifest.formatVersion",
      message: `formatVersion must be ${ARCHIVE_V3_FORMAT_VERSION}, got ${String(manifest.formatVersion)}.`,
    });
  }
  if (manifest.storageVersion !== ARCHIVE_V3_STORAGE_VERSION) {
    errors.push({
      field: "manifest.storageVersion",
      message: `storageVersion must be ${ARCHIVE_V3_STORAGE_VERSION}, got ${String(manifest.storageVersion)}.`,
    });
  }
  if (!isFiniteNumber(manifest.exportedAt)) {
    errors.push({
      field: "manifest.exportedAt",
      message: "exportedAt must be a finite timestamp.",
    });
  }
  if (!isNonEmptyString(manifest.producer)) {
    errors.push({ field: "manifest.producer", message: "producer must be a non-empty string." });
  }
  if (!isNonEmptyString(manifest.payloadDigest)) {
    errors.push({
      field: "manifest.payloadDigest",
      message: "payloadDigest must be a non-empty string.",
    });
  }

  const runs = value.runs;
  const rubrics = value.rubrics;
  const suites = value.suites;
  const experiments = value.experiments;
  const tasks = value.tasks;
  const taskSets = value.taskSets;
  const evidence = value.evidence;
  const comparisons = value.comparisons;
  const lab = value.lab;

  if (!isRecord(runs) || !Array.isArray(runs.summaries) || !Array.isArray(runs.details)) {
    errors.push({ field: "runs", message: "runs.summaries and runs.details must be arrays." });
  }
  if (
    !isRecord(rubrics) ||
    !Array.isArray(rubrics.identities) ||
    !Array.isArray(rubrics.versions)
  ) {
    errors.push({
      field: "rubrics",
      message: "rubrics.identities and rubrics.versions must be arrays.",
    });
  }
  if (!Array.isArray(suites)) errors.push({ field: "suites", message: "suites must be an array." });
  if (!Array.isArray(experiments))
    errors.push({ field: "experiments", message: "experiments must be an array." });

  if (
    !isRecord(tasks) ||
    !Array.isArray(tasks.tasks) ||
    !Array.isArray(tasks.taskVersions) ||
    !Array.isArray(tasks.taskArtifacts) ||
    !Array.isArray(tasks.taskArtifactBytes) ||
    !Array.isArray(tasks.taskInstances) ||
    !Array.isArray(tasks.taskFamilies) ||
    !Array.isArray(tasks.taskFamilyAssignments) ||
    !Array.isArray(tasks.taskFamilyRelations) ||
    !Array.isArray(tasks.taskFacetAnnotations) ||
    !Array.isArray(tasks.taskMigrationCrosswalks)
  ) {
    errors.push({ field: "tasks", message: "tasks collection arrays must be present." });
  }

  if (
    !isRecord(taskSets) ||
    !Array.isArray(taskSets.records) ||
    !Array.isArray(taskSets.versions) ||
    !Array.isArray(taskSets.materializations) ||
    !Array.isArray(taskSets.ownershipCrosswalks)
  ) {
    errors.push({ field: "taskSets", message: "taskSets collection arrays must be present." });
  }

  if (
    !isRecord(evidence) ||
    !Array.isArray(evidence.modelConfigurations) ||
    !Array.isArray(evidence.observations) ||
    !Array.isArray(evidence.evidenceDecisions) ||
    !Array.isArray(evidence.evidenceIndexJobs) ||
    !Array.isArray(evidence.verifierOutcomes)
  ) {
    errors.push({ field: "evidence", message: "evidence collection arrays must be present." });
  }

  if (
    !isRecord(comparisons) ||
    !Array.isArray(comparisons.indexes) ||
    !Array.isArray(comparisons.inputSnapshots) ||
    !Array.isArray(comparisons.limitations)
  ) {
    errors.push({
      field: "comparisons",
      message: "comparisons collection arrays must be present.",
    });
  }

  if (
    !isRecord(lab) ||
    !Array.isArray(lab.recipeRecords) ||
    !Array.isArray(lab.recipeVersions) ||
    !Array.isArray(lab.poolRecords) ||
    !Array.isArray(lab.poolVersions) ||
    !Array.isArray(lab.studies) ||
    !Array.isArray(lab.trials) ||
    !Array.isArray(lab.attempts) ||
    !Array.isArray(lab.observations) ||
    !Array.isArray(lab.playbooks) ||
    !isFusionToResearchLabReceipt(lab.cutoverReceipt)
  ) {
    errors.push({
      field: "lab",
      message: "lab collection arrays and canonical cutover receipt must be present.",
    });
  }

  if (errors.length > 0) return fail(errors);

  const archive = value as unknown as WorkbenchArchiveV3;

  // Manifest counts check
  const counts = archive.manifest.counts;
  if (!isRecord(counts)) {
    errors.push({ field: "manifest.counts", message: "manifest.counts must be an object." });
    return fail(errors);
  }

  const checkCount = (name: keyof ArchiveV3EntityCounts, actual: number) => {
    if (counts[name] !== actual) {
      errors.push({
        field: `manifest.counts.${name}`,
        message: `count mismatch: declared ${String(counts[name])}, actual ${actual}.`,
      });
    }
  };

  checkCount("runSummaries", archive.runs.summaries.length);
  checkCount("runDetails", archive.runs.details.length);
  checkCount("rubricIdentities", archive.rubrics.identities.length);
  checkCount("rubricVersions", archive.rubrics.versions.length);
  checkCount("suites", archive.suites.length);
  checkCount("experiments", archive.experiments.length);
  checkCount("tasks", archive.tasks.tasks.length);
  checkCount("taskVersions", archive.tasks.taskVersions.length);
  checkCount("taskArtifacts", archive.tasks.taskArtifacts.length);
  checkCount("taskArtifactBytes", archive.tasks.taskArtifactBytes.length);
  checkCount("taskInstances", archive.tasks.taskInstances.length);
  checkCount("taskFamilies", archive.tasks.taskFamilies.length);
  checkCount("taskFamilyAssignments", archive.tasks.taskFamilyAssignments.length);
  checkCount("taskFamilyRelations", archive.tasks.taskFamilyRelations.length);
  checkCount("taskFacetAnnotations", archive.tasks.taskFacetAnnotations.length);
  checkCount("taskMigrationCrosswalks", archive.tasks.taskMigrationCrosswalks.length);
  checkCount("taskSetRecords", archive.taskSets.records.length);
  checkCount("taskSetVersions", archive.taskSets.versions.length);
  checkCount("taskSetMaterializations", archive.taskSets.materializations.length);
  checkCount("taskSetOwnershipCrosswalks", archive.taskSets.ownershipCrosswalks.length);
  checkCount("modelConfigurations", archive.evidence.modelConfigurations.length);
  checkCount("evidenceObservations", archive.evidence.observations.length);
  checkCount("evidenceDecisions", archive.evidence.evidenceDecisions.length);
  checkCount("evidenceIndexJobs", archive.evidence.evidenceIndexJobs.length);
  checkCount("verifierOutcomes", archive.evidence.verifierOutcomes.length);
  checkCount("comparisonIndexes", archive.comparisons.indexes.length);
  checkCount("comparisonInputSnapshots", archive.comparisons.inputSnapshots.length);
  checkCount("comparisonLimitations", archive.comparisons.limitations.length);
  checkCount("labRecipeRecords", archive.lab.recipeRecords.length);
  checkCount("labRecipeVersions", archive.lab.recipeVersions.length);
  checkCount("modelPoolRecords", archive.lab.poolRecords.length);
  checkCount("modelPoolVersions", archive.lab.poolVersions.length);
  checkCount("studies", archive.lab.studies.length);
  checkCount("studyTrials", archive.lab.trials.length);
  checkCount("studyAttempts", archive.lab.attempts.length);
  checkCount("studyObservations", archive.lab.observations.length);
  checkCount("policyPlaybooks", archive.lab.playbooks.length);
  checkCount("fusionToResearchLabReceipts", 1);

  // Payload digest integrity check
  const recomputedDigest = computeArchiveV3PayloadDigest(archive);
  if (archive.manifest.payloadDigest !== recomputedDigest) {
    errors.push({
      field: "manifest.payloadDigest",
      message: `payload digest mismatch: declared ${archive.manifest.payloadDigest}, recomputed ${recomputedDigest}.`,
    });
  }

  // Prohibited content scan
  const prohibitedViolation = scanProhibitedContent(archive);
  if (prohibitedViolation !== null) {
    errors.push({
      field: prohibitedViolation,
      message: "prohibited credential or auth content detected in archive.",
    });
  }

  // Ordering & duplicates
  checkOrdering("runs.summaries", archive.runs.summaries, byId, errors);
  checkDuplicates("runs.summaries", archive.runs.summaries, byId, errors);

  checkOrdering("runs.details", archive.runs.details, byId, errors);
  checkDuplicates("runs.details", archive.runs.details, byId, errors);

  checkOrdering("rubrics.identities", archive.rubrics.identities, byId, errors);
  checkDuplicates("rubrics.identities", archive.rubrics.identities, byId, errors);

  checkOrdering("rubrics.versions", archive.rubrics.versions, byIdVersion, errors);
  checkDuplicates("rubrics.versions", archive.rubrics.versions, byIdVersion, errors);

  checkOrdering("suites", archive.suites, byId, errors);
  checkDuplicates("suites", archive.suites, byId, errors);

  checkOrdering("experiments", archive.experiments, byId, errors);
  checkDuplicates("experiments", archive.experiments, byId, errors);

  checkOrdering("tasks.tasks", archive.tasks.tasks, byId, errors);
  checkDuplicates("tasks.tasks", archive.tasks.tasks, byId, errors);

  checkOrdering("tasks.taskVersions", archive.tasks.taskVersions, byTaskIdVersion, errors);
  checkDuplicates("tasks.taskVersions", archive.tasks.taskVersions, byTaskIdVersion, errors);

  checkOrdering("tasks.taskArtifacts", archive.tasks.taskArtifacts, byId, errors);
  checkDuplicates("tasks.taskArtifacts", archive.tasks.taskArtifacts, byId, errors);

  checkOrdering("tasks.taskArtifactBytes", archive.tasks.taskArtifactBytes, byId, errors);
  checkDuplicates("tasks.taskArtifactBytes", archive.tasks.taskArtifactBytes, byId, errors);

  checkOrdering("tasks.taskInstances", archive.tasks.taskInstances, byId, errors);
  checkDuplicates("tasks.taskInstances", archive.tasks.taskInstances, byId, errors);

  checkOrdering("tasks.taskFamilies", archive.tasks.taskFamilies, byId, errors);
  checkDuplicates("tasks.taskFamilies", archive.tasks.taskFamilies, byId, errors);

  checkOrdering("tasks.taskFamilyAssignments", archive.tasks.taskFamilyAssignments, byId, errors);
  checkDuplicates("tasks.taskFamilyAssignments", archive.tasks.taskFamilyAssignments, byId, errors);

  checkOrdering("tasks.taskFamilyRelations", archive.tasks.taskFamilyRelations, byId, errors);
  checkDuplicates("tasks.taskFamilyRelations", archive.tasks.taskFamilyRelations, byId, errors);

  checkOrdering("tasks.taskFacetAnnotations", archive.tasks.taskFacetAnnotations, byId, errors);
  checkDuplicates("tasks.taskFacetAnnotations", archive.tasks.taskFacetAnnotations, byId, errors);

  checkOrdering(
    "tasks.taskMigrationCrosswalks",
    archive.tasks.taskMigrationCrosswalks,
    byLegacyScopeKey,
    errors,
  );
  checkDuplicates(
    "tasks.taskMigrationCrosswalks",
    archive.tasks.taskMigrationCrosswalks,
    byLegacyScopeKey,
    errors,
  );

  checkOrdering("taskSets.records", archive.taskSets.records, byId, errors);
  checkDuplicates("taskSets.records", archive.taskSets.records, byId, errors);

  checkOrdering("taskSets.versions", archive.taskSets.versions, byTaskSetIdVersion, errors);
  checkDuplicates("taskSets.versions", archive.taskSets.versions, byTaskSetIdVersion, errors);

  checkOrdering("taskSets.materializations", archive.taskSets.materializations, byId, errors);
  checkDuplicates("taskSets.materializations", archive.taskSets.materializations, byId, errors);

  checkOrdering(
    "taskSets.ownershipCrosswalks",
    archive.taskSets.ownershipCrosswalks,
    byKey,
    errors,
  );
  checkDuplicates(
    "taskSets.ownershipCrosswalks",
    archive.taskSets.ownershipCrosswalks,
    byKey,
    errors,
  );

  checkOrdering("evidence.modelConfigurations", archive.evidence.modelConfigurations, byId, errors);
  checkDuplicates(
    "evidence.modelConfigurations",
    archive.evidence.modelConfigurations,
    byId,
    errors,
  );

  checkOrdering("evidence.observations", archive.evidence.observations, byId, errors);
  checkDuplicates("evidence.observations", archive.evidence.observations, byId, errors);

  checkOrdering(
    "evidence.evidenceDecisions",
    archive.evidence.evidenceDecisions,
    byObservationIdRuleVersion,
    errors,
  );
  checkDuplicates(
    "evidence.evidenceDecisions",
    archive.evidence.evidenceDecisions,
    byObservationIdRuleVersion,
    errors,
  );

  checkOrdering(
    "evidence.evidenceIndexJobs",
    archive.evidence.evidenceIndexJobs,
    bySourceResultId,
    errors,
  );
  checkDuplicates(
    "evidence.evidenceIndexJobs",
    archive.evidence.evidenceIndexJobs,
    bySourceResultId,
    errors,
  );

  checkOrdering(
    "evidence.verifierOutcomes",
    archive.evidence.verifierOutcomes,
    byVerifierOutcomeKey,
    errors,
  );
  checkDuplicates(
    "evidence.verifierOutcomes",
    archive.evidence.verifierOutcomes,
    byVerifierOutcomeKey,
    errors,
  );

  checkOrdering("comparisons.indexes", archive.comparisons.indexes, byId, errors);
  checkDuplicates("comparisons.indexes", archive.comparisons.indexes, byId, errors);

  checkOrdering("comparisons.inputSnapshots", archive.comparisons.inputSnapshots, byRunId, errors);
  checkDuplicates(
    "comparisons.inputSnapshots",
    archive.comparisons.inputSnapshots,
    byRunId,
    errors,
  );

  checkOrdering("comparisons.limitations", archive.comparisons.limitations, byRunId, errors);
  checkDuplicates("comparisons.limitations", archive.comparisons.limitations, byRunId, errors);

  // Lab collections ordering & duplicates
  checkOrdering("lab.recipeRecords", archive.lab.recipeRecords, byId, errors);
  checkDuplicates("lab.recipeRecords", archive.lab.recipeRecords, byId, errors);

  checkOrdering("lab.recipeVersions", archive.lab.recipeVersions, byRecipeIdVersion, errors);
  checkDuplicates("lab.recipeVersions", archive.lab.recipeVersions, byRecipeIdVersion, errors);

  checkOrdering("lab.poolRecords", archive.lab.poolRecords, byId, errors);
  checkDuplicates("lab.poolRecords", archive.lab.poolRecords, byId, errors);

  checkOrdering("lab.poolVersions", archive.lab.poolVersions, byPoolIdVersion, errors);
  checkDuplicates("lab.poolVersions", archive.lab.poolVersions, byPoolIdVersion, errors);

  checkOrdering("lab.studies", archive.lab.studies, byId, errors);
  checkDuplicates("lab.studies", archive.lab.studies, byId, errors);

  checkOrdering("lab.trials", archive.lab.trials, byId, errors);
  checkDuplicates("lab.trials", archive.lab.trials, byId, errors);

  checkOrdering("lab.attempts", archive.lab.attempts, byId, errors);
  checkDuplicates("lab.attempts", archive.lab.attempts, byId, errors);

  checkOrdering("lab.observations", archive.lab.observations, byId, errors);
  checkDuplicates("lab.observations", archive.lab.observations, byId, errors);

  checkOrdering("lab.playbooks", archive.lab.playbooks, byId, errors);
  checkDuplicates("lab.playbooks", archive.lab.playbooks, byId, errors);

  // Reference graph validation
  const recipeRecordsById = new Set(archive.lab.recipeRecords.map((r) => r.id));
  const recipeVersionsByKey = new Set(
    archive.lab.recipeVersions.map((v) => `${v.recipeId}@${v.version}`),
  );
  const poolRecordsById = new Set(archive.lab.poolRecords.map((p) => p.id));
  const poolVersionsByKey = new Set(
    archive.lab.poolVersions.map((v) => `${v.poolId}@${v.version}`),
  );
  const studiesById = new Map(archive.lab.studies.map((s) => [s.id, s]));
  const trialsById = new Map(archive.lab.trials.map((t) => [t.id, t]));
  const playbooksById = new Map(archive.lab.playbooks.map((p) => [p.id, p]));

  // Lab recipe validation
  for (let i = 0; i < archive.lab.recipeRecords.length; i++) {
    const r = archive.lab.recipeRecords[i];
    if (!isLabRecipeRecord(r)) {
      errors.push({ field: `lab.recipeRecords[${i}]`, message: "invalid LabRecipeRecord" });
    }
  }

  for (let i = 0; i < archive.lab.recipeVersions.length; i++) {
    const v = archive.lab.recipeVersions[i];
    if (!isLabRecipeVersion(v)) {
      errors.push({
        field: `lab.recipeVersions[${i}]`,
        message: "invalid LabRecipeVersion or digest mismatch",
      });
    }
    if (!recipeRecordsById.has(v.recipeId)) {
      errors.push({
        field: `lab.recipeVersions[${i}]`,
        message: `recipeId ${v.recipeId} not found in lab.recipeRecords`,
      });
    }
  }

  // Lab pool validation
  for (let i = 0; i < archive.lab.poolRecords.length; i++) {
    const p = archive.lab.poolRecords[i];
    if (!isModelPoolRecord(p)) {
      errors.push({ field: `lab.poolRecords[${i}]`, message: "invalid ModelPoolRecord" });
    }
  }

  for (let i = 0; i < archive.lab.poolVersions.length; i++) {
    const v = archive.lab.poolVersions[i];
    if (!isModelPoolVersion(v)) {
      errors.push({
        field: `lab.poolVersions[${i}]`,
        message: "invalid ModelPoolVersion or digest mismatch",
      });
    }
    if (!poolRecordsById.has(v.poolId)) {
      errors.push({
        field: `lab.poolVersions[${i}]`,
        message: `poolId ${v.poolId} not found in lab.poolRecords`,
      });
    }
  }

  // Study validation
  for (let i = 0; i < archive.lab.studies.length; i++) {
    const s = archive.lab.studies[i];
    if (!isPolicyStudyRecord(s)) {
      errors.push({ field: `lab.studies[${i}]`, message: "invalid PolicyStudyRecord" });
      continue;
    }
    const poolKey = `${s.definition.modelPool.poolId}@${s.definition.modelPool.version}`;
    if (!poolVersionsByKey.has(poolKey)) {
      errors.push({
        field: `lab.studies[${i}].definition.modelPool`,
        message: `model pool ${poolKey} not found in lab.poolVersions`,
      });
    }
    for (const r of s.definition.fusionRecipes) {
      const recKey = `${r.recipeId}@${r.version}`;
      if (!recipeVersionsByKey.has(recKey)) {
        errors.push({
          field: `lab.studies[${i}].definition.fusionRecipes`,
          message: `recipe ${recKey} not found in lab.recipeVersions`,
        });
      }
    }
    if (s.status === "completed" && s.reportRef === null) {
      errors.push({
        field: `lab.studies[${i}].reportRef`,
        message: "completed study reportRef must identify a persisted same-study policy playbook.",
      });
    } else if (s.reportRef !== null) {
      const playbook = playbooksById.get(s.reportRef);
      if (!playbook || playbook.playbook.studyId !== s.id) {
        errors.push({
          field: `lab.studies[${i}].reportRef`,
          message: "non-null reportRef must identify a persisted same-study policy playbook.",
        });
      }
    }
  }

  // Trial validation
  for (let i = 0; i < archive.lab.trials.length; i++) {
    const t = archive.lab.trials[i];
    if (!isPolicyStudyTrial(t)) {
      errors.push({ field: `lab.trials[${i}]`, message: "invalid PolicyStudyTrial" });
      continue;
    }
    if (!studiesById.has(t.studyId)) {
      errors.push({
        field: `lab.trials[${i}].studyId`,
        message: `studyId ${t.studyId} not found in lab.studies`,
      });
    }
  }

  // Attempt validation
  for (let i = 0; i < archive.lab.attempts.length; i++) {
    const a = archive.lab.attempts[i];
    if (!isStudyAttempt(a)) {
      errors.push({ field: `lab.attempts[${i}]`, message: "invalid StudyAttempt" });
      continue;
    }
    if (!studiesById.has(a.studyId)) {
      errors.push({
        field: `lab.attempts[${i}].studyId`,
        message: `studyId ${a.studyId} not found in lab.studies`,
      });
    }
    if (a.fromTrialId === a.toTrialId) {
      errors.push({
        field: `lab.attempts[${i}]`,
        message: "fromTrialId and toTrialId must not be identical.",
      });
    }
    const fromTrial = trialsById.get(a.fromTrialId);
    const toTrial = trialsById.get(a.toTrialId);
    if (!fromTrial || !toTrial) {
      errors.push({
        field: `lab.attempts[${i}]`,
        message: "fromTrialId or toTrialId not found in lab.trials",
      });
    } else if (fromTrial.studyId !== a.studyId || toTrial.studyId !== a.studyId) {
      errors.push({
        field: `lab.attempts[${i}]`,
        message: "attempt studyId must match both source and successor trial studyId.",
      });
    }
  }

  // Observation validation
  for (let i = 0; i < archive.lab.observations.length; i++) {
    const o = archive.lab.observations[i];
    if (!isPolicyStudyObservation(o)) {
      errors.push({ field: `lab.observations[${i}]`, message: "invalid PolicyStudyObservation" });
      continue;
    }
    if (!studiesById.has(o.studyId)) {
      errors.push({
        field: `lab.observations[${i}].studyId`,
        message: `studyId ${o.studyId} not found in lab.studies`,
      });
    }
    const trial = trialsById.get(o.trialId);
    if (!trial) {
      errors.push({
        field: `lab.observations[${i}].trialId`,
        message: `trialId ${o.trialId} not found in lab.trials`,
      });
    } else if (trial.studyId !== o.studyId) {
      errors.push({
        field: `lab.observations[${i}]`,
        message: "observation studyId must match its referenced trial studyId.",
      });
    }
  }

  // Playbook validation
  for (let i = 0; i < archive.lab.playbooks.length; i++) {
    const row = archive.lab.playbooks[i];
    if (!isNonEmptyString(row.id) || !isPolicyReportPayload(row.playbook)) {
      errors.push({
        field: `lab.playbooks[${i}]`,
        message: "invalid persisted policy playbook row",
      });
      continue;
    }
    if (!studiesById.has(row.playbook.studyId)) {
      errors.push({
        field: `lab.playbooks[${i}].playbook.studyId`,
        message: `studyId ${row.playbook.studyId} not found in lab.studies`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
