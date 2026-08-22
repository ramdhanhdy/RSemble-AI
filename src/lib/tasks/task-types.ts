// =============================================================================
// RSemble AI — Canonical Task domain types
//
// Child 02 (Canonical Tasks) Milestone A — Task 1.
//
// Defines the canonical Task entities and their supporting types per the
// canonical-tasks specification (§3): TaskRecord, immutable TaskVersion,
// TaskArtifact, TaskInstance, TaskFamily, family assignment, and versioned
// facet annotations. Only administrative/lifecycle metadata on TaskRecord and
// TaskFamily is mutable (through compare-and-swap); a committed TaskVersion is
// immutable.
//
// Runtime validators live in `./task-validation.ts`. This module is types only.
// =============================================================================

/** Generic reference to an immutable versioned entity (Rubric, Verifier, etc.).
 *  Same shape as `RubricVersionRef` but named for cross-entity reuse across the
 *  task-first evidence workbench children. */
export interface VersionRef {
  id: string;
  version: number;
}

/** Origin of a Task record (spec §3.1). Mutable only as administrative state. */
export type TaskOrigin = "authored" | "legacy-task-set" | "promoted-comparison" | "imported";

/** Provenance of a single Task Version. Records how the version came to exist;
 *  `legacyScopeKey` carries the deterministic migration scope
 *  `(legacySuiteId, legacyTaskId)` for legacy-task-set origins. Never carries
 *  credentials or auth material. */
export interface TaskSource {
  kind: "authored" | "legacy-task-set" | "imported";
  legacyScopeKey: string | null;
  /** Sanitized provenance note; never credentials or auth material. */
  note: string | null;
}

/** A single entry in a context manifest. Entries resolve to a durable Task
 *  Artifact (`artifactId`) or an explicit external provenance reference
 *  (`externalRef`). Manifests store sanitized metadata/digests, never raw
 *  provider headers or credentials (spec §7.3, §8). */
export interface ContextManifestEntry {
  role: string;
  artifactId: string | null;
  externalRef: string | null;
  /** Sanitized metadata digest (`sha256:<hex>`); never raw secret-bearing bytes. */
  metadataDigest: string | null;
  mediaType: string | null;
  byteCount: number | null;
}

/** Expected response contract for a Task Version. A change to it creates the
 *  next Task Version (spec §3.2). */
export interface ResponseContract {
  format: string;
  constraints: string[];
  maxLength: number | null;
}

/** Concrete normalized candidate-visible input for a Task Instance. Exact
 *  provider-formatted messages remain in attempt records, not here. */
export interface NormalizedTaskInput {
  text: string;
  /** Ordered opaque Task Artifact IDs materialized for this instance. */
  artifactIds: string[];
  /** Sanitized structured input metadata (string values only, no secrets). */
  metadata: Record<string, string>;
}

/** Provenance of a Task Instance. */
export interface TaskInstanceSourceRef {
  kind: "authored" | "legacy-task-set" | "comparison" | "imported";
  legacyScopeKey: string | null;
  /** Stable reference to the originating record (e.g. runId/experimentId). */
  originId: string | null;
}

/** Instance input completeness (spec §3.4). Metadata-only/incomplete instances
 *  are never upgraded to complete without real bytes. */
export type TaskInputCompleteness = "complete" | "metadata_only" | "incomplete";

// --- Canonical entities (spec §3) -------------------------------------------

/** Canonical persisted Task record. Only administrative metadata and lifecycle
 *  state are mutable through compare-and-swap (`revision`, `latestVersion`,
 *  `updatedAt`, `archivedAt`). Immutable Task Versions live separately. */
export interface TaskRecord {
  id: string;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  origin: TaskOrigin;
  revision: number;
}

/** A committed Task Version is immutable (spec §3.2). A change to
 *  candidate-visible instruction, task-defining context, expected response
 *  contract, or correctness contract creates the next version. */
export interface TaskVersion {
  taskId: string;
  version: number;
  title: string;
  objective: string;
  candidateInstruction: string;
  defaultContextManifest: ContextManifestEntry[];
  responseContract: ResponseContract | null;
  taskVerifierRef: VersionRef | null;
  source: TaskSource;
  createdAt: number;
}

/** Immutable local candidate-visible input blob/file (spec §3.3). IDs are
 *  opaque. Digest matches require byte equality before reuse. Credentials and
 *  provider-auth material are rejected. Bytes live outside summary rows. */
export interface TaskArtifact {
  id: string;
  contentDigest: string;
  mediaType: string;
  byteCount: number;
  storageRef: string;
  createdAt: number;
}

/** Concrete Task Instance (spec §3.4). Reuse is allowed only under the same
 *  Task Version and exact complete normalized input/context/artifact digest,
 *  with equality verification. */
export interface TaskInstance {
  id: string;
  taskId: string;
  taskVersion: number;
  normalizedInput: NormalizedTaskInput;
  contextManifest: ContextManifestEntry[];
  inputDigest: string;
  inputCompleteness: TaskInputCompleteness;
  createdAt: number;
  sourceRef: TaskInstanceSourceRef;
}

/** A deliberate grouping of related Task variants (spec §3.5). A Task has at
 *  most one primary family at a time through a versioned assignment. */
export interface TaskFamily {
  id: string;
  name: string;
  description: string;
  parentFamilyId: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
}

/** Typed cross-family relation kind (spec §3.5). Expresses overlap without a
 *  universal tree. */
export type TaskFamilyRelationKind = "overlap" | "parent" | "derivative";

/** Typed cross-family relation. */
export interface TaskFamilyRelation {
  id: string;
  fromFamilyId: string;
  toFamilyId: string;
  kind: TaskFamilyRelationKind;
  createdAt: number;
}

/** Versioned family assignment. At most one assignment per Task may carry
 *  `isPrimary: true` at a time; enforced by the repository (Task 3). */
export interface TaskFamilyAssignment {
  id: string;
  taskId: string;
  taskVersion: number;
  familyId: string;
  isPrimary: boolean;
  createdAt: number;
  revision: number;
  archivedAt: number | null;
}

/** Orthogonal facet dimensions (spec §3.6). */
export type TaskFacetDimension =
  | "domain"
  | "task-form"
  | "transformation"
  | "constraint"
  | "interaction-mode"
  | "modality"
  | "evaluation-type"
  | "setting";

/** A stable taxonomy value: dimension (`facetId`) + value (`valueId`) + label
 *  + taxonomy version. */
export interface FacetTaxonomyValue {
  facetId: string;
  valueId: string;
  label: string;
  taxonomyVersion: number;
}

export type TaskFacetAnnotationSource = "authored" | "imported" | "suggested";
export type TaskFacetAnnotationAuthorKind = "user" | "migration" | "system";

/** Versioned facet annotation (spec §3.6). Suggestions never become accepted
 *  annotations without explicit user confirmation. */
export interface TaskFacetAnnotation {
  id: string;
  taskId: string;
  /** `null` annotates the Task as a whole; a number annotates a specific version. */
  taskVersion: number | null;
  facetId: string;
  valueId: string;
  source: TaskFacetAnnotationSource;
  authorKind: TaskFacetAnnotationAuthorKind;
  /** Confidence in `[0,1]`; `null` when not applicable. */
  confidence: number | null;
  taxonomyVersion: number;
  createdAt: number;
  supersedesId: string | null;
}

/** Payload for importing canonical Task entities. Validated as a whole before
 *  any write. Non-identical ID collisions are rejected in child 09; this child
 *  only validates structure and internal referential integrity. */
export interface TaskImportPayload {
  tasks: TaskRecord[];
  taskVersions: TaskVersion[];
  taskArtifacts: TaskArtifact[];
  taskInstances: TaskInstance[];
  taskFamilies: TaskFamily[];
  taskFamilyAssignments: TaskFamilyAssignment[];
  /** Typed cross-family relations (spec §3.5). Task 10 consumes this
   *  collection in archive v2; this child validates it referentially. */
  taskFamilyRelations: TaskFamilyRelation[];
  taskFacetAnnotations: TaskFacetAnnotation[];
}
