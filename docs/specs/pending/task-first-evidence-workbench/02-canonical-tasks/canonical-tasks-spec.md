# Canonical Tasks, Versions, Instances, Families, and Facets Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 02
**Dependencies:** Parent contract and child 01 (canonical Rubric adapters/terminology)

---

## 1. User outcome

A user can create, inspect, version, archive, and reuse a Task independently of any one comparison or Task Set. Historical executions remain bound to the exact Task Version and concrete Task Instance that they used. Related variants are grouped deliberately so repeated attempts and near-duplicate prompts do not masquerade as broad task coverage.

## 2. Current foundation and gap

Current Evaluation Suite tasks have stable IDs only inside an embedded suite document. Experiment snapshots preserve those task definitions, and run records preserve exact messages and attempts, but there is no global Task identity, immutable Task Version repository, concrete Task Instance repository, family registry, or versioned facet annotation.

This child adds those concepts without rewriting existing run or experiment evidence and without yet converting Suite/Task Set ownership. Child 03 performs that conversion.

## 3. Canonical entities

### 3.1 TaskRecord

```ts
interface TaskRecord {
  id: string;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  origin: "authored" | "legacy-task-set" | "promoted-comparison" | "imported";
  revision: number;
}
```

Only administrative metadata and lifecycle state are mutable through compare-and-swap.

### 3.2 TaskVersion

```ts
interface TaskVersion {
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
```

A committed version is immutable. A change to candidate-visible instruction, task-defining context, expected response contract, or correctness contract creates the next version.

Rubric, judge, model roster, provider, and replicate policy are execution protocol, not Task identity, unless they alter the candidate-visible objective itself.

### 3.3 TaskArtifact

```ts
interface TaskArtifact {
  id: string;
  contentDigest: string;
  mediaType: string;
  byteCount: number;
  storageRef: string;
  createdAt: number;
}
```

Artifacts preserve candidate-visible text/blob/file inputs locally without placing bytes in Task, Observation, or search summary rows. IDs are opaque. Digest matches require byte equality before reuse. Credentials and provider-auth material are rejected.

### 3.4 TaskInstance

```ts
interface TaskInstance {
  id: string;
  taskId: string;
  taskVersion: number;
  normalizedInput: NormalizedTaskInput;
  contextManifest: ContextManifestEntry[];
  inputDigest: string;
  inputCompleteness: "complete" | "metadata_only" | "incomplete";
  createdAt: number;
  sourceRef: TaskInstanceSourceRef;
}
```

An instance captures concrete inputs. Reuse is allowed only under the same Task Version and exact complete normalized input/context/artifact digest, with equality verification. Exact provider-formatted messages remain in attempt records. Metadata-only historical attachments are never upgraded to complete without real bytes.

### 3.5 TaskFamily

```ts
interface TaskFamily {
  id: string;
  name: string;
  description: string;
  parentFamilyId: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
}
```

A Task has at most one primary family at a time through a versioned assignment. Typed cross-family relations may express overlap without a universal tree.

### 3.6 Facet taxonomy and annotations

Facets are orthogonal dimensions:

```text
domain · task form · transformation · constraint
interaction mode · modality · evaluation type · setting
```

Each value has stable identity and taxonomy version. Each Task annotation records:

```ts
interface TaskFacetAnnotation {
  id: string;
  taskId: string;
  taskVersion: number | null;
  facetId: string;
  valueId: string;
  source: "authored" | "imported" | "suggested";
  authorKind: "user" | "migration" | "system";
  confidence: number | null;
  taxonomyVersion: number;
  createdAt: number;
  supersedesId: string | null;
}
```

Suggestions never become accepted annotations without explicit user confirmation.

## 4. Identity and immutability rules

1. IDs are opaque; digests do not define semantic identity.
2. Similar text across suites or imports is never auto-merged.
3. Version numbers are positive, contiguous per Task, and append-only.
4. A Task Version delete is prohibited while any Task Set, execution, result, instance, or observation references it.
5. Archive affects discoverability, not references or historical routes.
6. A family/facet edit never mutates an old execution snapshot.
7. Attempt count does not create new Tasks or Task Versions.
8. A new stochastic replicate of one instance shares Task/Version/Instance and is declared by protocol later.

## 5. Storage and repository

Add Dexie stores with indexes required for local retrieval:

```text
tasks: id, updatedAt, archivedAt, origin
taskVersions: [taskId+version], taskId, createdAt
taskArtifacts: id, contentDigest, mediaType, byteCount, createdAt
taskInstances: id, [taskId+taskVersion], inputDigest, inputCompleteness, createdAt
taskFamilies: id, parentFamilyId, updatedAt, archivedAt
taskFamilyAssignments: id, taskId, taskVersion, familyId, createdAt
taskFacetAnnotations: id, taskId, [taskId+taskVersion], facetId, valueId, createdAt
taskMigrationCrosswalk: legacyScopeKey, taskId, taskVersion
```

The Task repository exposes atomic create+v1, append-version, archive/restore, family/facet assignment, immutable artifact put/get, instance get-or-create, and paginated query APIs. All writes use runtime validation, secret-pattern rejection where free text is indexed/exported, and CAS for mutable records.

`putTaskArtifact` verifies digest matches against byte equality before reuse and never stores provider credentials/auth headers. `getOrCreateTaskInstance` deduplicates only inside one exact Task Version by complete normalized input plus artifact digests, validates equality before reuse, and preserves `metadata_only`/`incomplete` states.

## 6. Conservative legacy migration

### 6.1 Inputs

Migration inspects:

- latest embedded suite tasks;
- immutable historical ExperimentRecord snapshots;
- stable suite/task IDs and suite versions;
- verifier/evaluation task definitions required to reconstruct executable meaning.

### 6.2 Namespacing and version reconstruction

For each legacy suite task identity:

1. define a deterministic migration scope `(legacySuiteId, legacyTaskId)`;
2. create one canonical Task with origin `legacy-task-set`;
3. sort historical definitions by execution/suite chronology;
4. append a new Task Version only when the complete executable-definition digest changes;
5. write a crosswalk from every historical `(suiteId, suiteVersion, taskId, definitionDigest)` to the canonical Task Version;
6. include the latest suite definition even when no execution exists;
7. never merge across different legacy suite scopes automatically.

Repeated startup must produce no duplicates. A partial migration resumes from committed crosswalk entries.

### 6.3 Existing Compare records

This child does not auto-create Tasks from historical Compare records. They remain unlinked Records until child 05 offers explicit promotion/linking.

### 6.4 No evidence rewriting

- Migration does not modify RunRecordV2, ExperimentRecord snapshots, selected attempt IDs, protocol fingerprints, costs, judge evidence, or failures.
- Historical attachment metadata is cross-referenced where possible, but absent bytes remain `metadata_only`/`incomplete`; migration never fabricates a Task Artifact or marks such an instance complete.

## 7. Routes and UI

Canonical routes:

```text
/tasks
/tasks/new
/tasks/:taskId
/tasks/:taskId/versions/:version
```

Tasks are not a primary workspace. Before global search ships, `/tasks` is reachable through a functional command-palette action and contextual links where safe.

### 7.1 Task catalog

- search by title/objective and filter by family/facet/archive state;
- rows show Task name, latest version, family, key facets, update time, and references count;
- actions: Create, Duplicate as new Task, Archive/Restore;
- no delete action for referenced Tasks;
- legacy-migrated Tasks display origin without implying identity across suites.

### 7.2 Task detail

- stable Task identity header;
- version selector and read-only historical versions;
- latest version editing creates a draft and an explicit **Create version N+1** action;
- family and facets are edited separately with provenance;
- references disclose Task Sets, comparisons, evaluations, and observations as those children become available;
- Task Instance list shows input digest abbreviation, source, timestamp, and use count without exposing secrets.

### 7.3 Creation and duplication

Create commits Task + version 1 atomically. Duplicate creates a new Task identity with origin `authored`; it never becomes a version of the source by implication.

## 8. Compatibility considerations

- Existing Suite editors continue reading embedded tasks until child 03 switches them to Task Version references.
- New Task stores coexist with current database version and repository providers.
- Storage initialization failure preserves current Compare operational behavior and presents a bounded Task-catalog error.
- Imported Task ID collision remapping is completed in child 09; this child’s v2 preview must reject non-identical collisions before writes, and repository APIs must support later ID remapping through a crosswalk.
- Context manifests store sanitized metadata/digests, not secret-bearing raw provider headers or credentials.

### 8.5 Archive v2 base

This child introduces the extensible archive v2 envelope required by the parent. It round-trips current exact Run and Experiment evidence; all existing Fusion Study stores (`fusionRecipes`, `poolManifests`, `fusionStudies`, `fusionTrials`, `fusionAttempts`, `fusionObservations`, and `fusionPlaybooks`); and canonical Rubrics, Tasks, Task Versions, Task Artifacts, Task Instances, families/facets, annotations, and migration crosswalks. Disposable indexes are omitted.

Archive v1 remains importable. V2 import validates the complete payload and referenced artifacts before writes. Until child 09 adds full collision remapping, a non-identical ID collision is reported during preview and aborts without mutation; it never overwrites.

### 8.6 Compatibility with current archives

Existing v1 exports remain valid and current Run/Evaluation source records remain semantically unchanged. Artifact bytes are scanned for prohibited credential/auth content before export; an unsafe export is blocked without echoing the value.

## 9. Non-goals

- Task Set editor migration;
- comparison task promotion;
- observation derivation or evidence eligibility;
- automatic semantic deduplication or taxonomy inference;
- universal capability taxonomy;
- model evidence profiles;
- vector/embedding search;
- deleting referenced historical Tasks.

## 10. Implementation sequence

1. Define runtime-validated Task/family/facet schemas and pure identity rules.
2. Add database stores and repository interfaces/in-memory implementation.
3. Implement atomic create/version/archive/instance operations with TDD.
4. Implement deterministic legacy suite/snapshot inventory and crosswalk migration.
5. Build catalog and detail/version/family/facet surfaces.
6. Add route and command-palette entry without primary-navigation changes.
7. Add reference-count adapters over current suite/experiment data.
8. Add responsive/accessibility/browser QA and migration fixtures.
9. Update authority docs only for concepts actually shipped.

## 11. Validation plan

### Domain

- immutable versions reject update/overwrite;
- contiguous version append and stale CAS behavior;
- digest collision verifies full normalized equality before instance reuse;
- task-defining changes require a new version;
- metadata/facet changes do not mutate versions;
- archived Tasks remain routable and referenceable;
- archive v2 base export/import round-trips exact current Run, Experiment, and all seven Fusion Study stores plus Rubrics, canonical Task entities/artifacts/crosswalks; rejects unsafe content; imports v1; and aborts non-identical collisions before writes;
- facet provenance and supersession are valid.

### Migration

Fixtures cover clean DB, one suite, changed suite task, repeated identical definitions, multiple suites with identical text, historical snapshots, latest unexecuted edits, partial marker, corrupted crosswalk, and repeated startup. Expected behavior is deterministic and idempotent with no cross-suite auto-merge.

### Repository

- atomic Task+v1 creation;
- CAS failure leaves no partial version;
- referenced-version deletion is impossible;
- query/filter/pagination order is deterministic;
- storage errors are classified.

### UI/routes

- create/edit/version/archive/restore flows;
- historical version is read-only;
- duplicate creates new identity;
- family/facet keyboard operation and provenance;
- `/tasks/:id/versions/:version` direct load and unknown IDs;
- command-palette action is functional.

### Browser

Desktop/tablet/390px/200% zoom, keyboard-only, reduced motion, long titles/facet values, empty/archived/migration-error states, per-element overflow, and secret-leak probe.

### Commands

```bash
npx vitest run src/lib/tasks src/lib/persistence src/workspaces/tasks src/ui/CommandPalette.test.tsx
npm run typecheck:web
npm run check
```

## 12. Completion criteria

- global Task identities and immutable versions are persisted and navigable;
- Task Instances, families, and versioned facet annotations obey the parent contract;
- legacy suite/snapshot migration is conservative, idempotent, and crosswalked;
- existing evidence is unchanged;
- Tasks are usable without an inert primary-nav destination;
- no prompt-hash or similarity-based semantic merge exists;
- all domain, repository, migration, route, responsive, and accessibility gates pass.

## 13. Assumptions and unresolved implementation discoveries

**Locked assumptions:** current suite/task IDs are stable enough to define a conservative namespaced migration scope; historical experiment snapshots remain the authority for executed definitions.

**No product decision remains unresolved.** If a historical snapshot cannot reconstruct the executable Task definition, migration preserves it as an unresolved legacy reference and reports the limitation; it must not fabricate content.
