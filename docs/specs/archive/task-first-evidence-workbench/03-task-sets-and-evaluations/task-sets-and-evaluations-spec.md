# Task Sets and Context-Owned Evaluation Results Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 03
**Dependencies:** Child 01 Rubrics; Child 02 Canonical Tasks

---

## 1. User outcome

A user builds a reusable **Task Set** by selecting exact canonical Task Versions, a Rubric/protocol, and a model roster. Every edit creates a versioned workload manifest. The Task Set owns its ordinary Evaluation Execution history, live progress, result matrix, recovery, roster extensions, and existing Fusion Studies. Exact task execution Records remain drillable without making the raw ledger the organizer.

## 2. Current foundation

Current production already ships:

- Evaluation Suites with embedded tasks, model slots, judge and evaluation defaults;
- suite version numbers and immutable ExperimentRecord snapshots;
- task-by-model execution, progress, result matrix, aggregation, coverage-aware standings;
- exact run links per task attempt;
- missing-cell repair, full retry, interruption/recovery, execution lease/fencing;
- append-only roster-extension history, reusable-output seeding, fresh blind re-judging, and suite-sync choice;
- suite-owned experiment history;
- production Fusion Studies scoped by `suiteId`/`suiteVersion`, with versioned recipes and pool manifests, trials, attempts, experimental observations, playbooks, exploration/confirmation claim levels, and `/evaluations/:suiteId/fusion/:studyId` deep links.

This child recomposes and renames those foundations. It must not rewrite the controller or weaken current reliability semantics.

## 3. Canonical entities

### 3.1 TaskSetRecord

```ts
interface TaskSetRecord {
  id: string;
  latestVersion: number;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
  origin: "authored" | "legacy-suite" | "imported";
}
```

### 3.2 TaskSetVersion / WorkloadManifest

```ts
interface TaskSetVersion {
  taskSetId: string;
  version: number;
  members: TaskSetMember[];
  defaultRubricRef: VersionRef;
  defaultModelSlots: ModelSlot[];
  defaultJudge: JudgeSnapshot;
  repeatPolicy: RepeatPolicy;
  missingnessPolicy: MissingnessPolicy;
  protocolDefaults: ProtocolDefaults;
  createdAt: number;
}

interface TaskSetMember {
  id: string;
  taskVersionRef: { taskId: string; version: number };
  order: number;
  role: "organic" | "anchor" | "calibration" | "holdout";
  stratum: string | null;
  weight: number;
  rubricOverrideRef: VersionRef | null;
  executionOverrides: TaskExecutionOverrides | null;
}
```

The manifest is immutable. Membership points to exact Task Versions; it never embeds mutable catalog definitions as canonical identity.

### 3.3 EvaluationExecution

Current `ExperimentRecord` remains the compatibility foundation. Canonical adapters expose:

```ts
interface EvaluationExecutionIdentity {
  id: string;
  taskSetId: string;
  taskSetVersion: number;
  workloadSnapshot: MaterializedWorkloadSnapshot;
  protocolFingerprint: string;
}
```

Every execution materializes candidate-visible Task Version and Task Instance snapshots needed for exact replay/audit, even though identity points to the catalog.

## 4. Rename and routes

User-facing **Suite** becomes **Task Set**. Canonical routes:

```text
/evaluations
/evaluations/sets
/evaluations/sets/new
/evaluations/sets/:taskSetId
/evaluations/sets/:taskSetId/versions/:version
/evaluations/sets/:taskSetId/fusion/:studyId
/evaluations/results/:evaluationExecutionId
```

Compatibility:

- current `/evaluations/:suiteId` redirects to the Task Set entity;
- current `/evaluations/:suiteId/fusion/:studyId` redirects to `/evaluations/sets/:taskSetId/fusion/:studyId` only after the exact Suite→Task Set/version crosswalk resolves;
- `/experiments/:experimentId` redirects to the Evaluation Result;
- direct loads, hash links, refresh, and back/forward preserve entity and version;
- frozen `suiteId`, `suiteVersion`, and `ExperimentRecord` fields remain readable through adapters.

Evaluations secondary navigation is **Task sets · Rubrics**. Tasks remain canonical global entities reached through selectors and contextual links rather than another primary workspace.

## 5. Task Set editing behavior

### 5.1 Selection, not embedding

- Add Task opens a searchable canonical Task/Version selector.
- Default selection is latest Task Version, but the pinned version is visible before save.
- A user may intentionally choose an older version.
- Editing a canonical Task from the set opens Task detail; it does not mutate the manifest silently.
- Updating a member to a newer Task Version creates a new Task Set Version.

### 5.2 Versioning

- Create commits Task Set + version 1 atomically.
- Save on latest creates version N+1 after conflict check.
- Historical versions are read-only and show exact memberships/protocol defaults.
- Running with unsaved changes requires an explicit choice: save a new version and run it, or discard draft changes. No execution receives an ambiguous dirty manifest.

### 5.3 Membership semantics

- order is deterministic and keyboard-operable;
- weight is retained for Task Set result semantics only and never becomes global profile weighting;
- roles and strata are visible in provenance;
- Task Set validation requires at least one Task Version, one enabled candidate, a ready judge when judged evaluation is selected, and a valid Rubric/protocol;
- archived Tasks/Versions remain executable only from an existing frozen version; new selection warns and requires explicit confirmation.

## 6. Evaluation ownership and results

### 6.1 Owned history

The Task Set detail owns all Evaluation Executions for that set, newest first, including completed, completed-with-failures, aborted, and interrupted states. Each row shows version, roster, status, coverage, timestamp, and cost without masquerading as a leaf run.

### 6.2 Live progress

Preserve the current execution owner, lease, Worker heartbeat, storage fencing, idempotent unit-of-work, pause/resume/abort, current-task ledger, elapsed time, and cross-workspace execution strip.

The progress surface is labeled as an Evaluation Execution and links back to the owning Task Set/version.

### 6.3 Results

Evaluation Result owns:

- identity, Task Set/version, protocol, Rubric, judge, roster, recency, and cost;
- task × model matrix with accepted assessment per cell;
- complete versus provisional standings;
- missing and failed cells;
- task-level details and exact Record links;
- recovery toolbar in the owning result;
- append-only roster-extension history;
- coverage and protocol disclosures.

The result never becomes one synthetic run. Each matrix/task cell opens its exact run/attempt evidence.

### 6.4 Existing Fusion Studies

Fusion Studies remain a distinct Task-Set-owned experimental surface rather than being renamed to Evaluation Results or deferred workflow benchmarks. Canonical identity pins the exact Task Set Version while compatibility adapters continue to read frozen `suiteId`/`suiteVersion` fields. Existing recipe, pool, trial, attempt, experimental `FusionObservation`, playbook, claim-level, retry/regeneration, and artifact-reference semantics remain unchanged. Fusion Study observations do not become canonical Task Observations in this child.

## 7. Roster extension compatibility

Existing roster extension behavior remains mandatory:

1. extension is allowed only from a valid terminal execution and available model slot;
2. duplicate model keys are rejected before paid calls;
3. reusable accepted candidate outputs are referenced, not regenerated;
4. exactly the new model executes where the compound path is valid;
5. a fresh blind judge assesses the reconstructed roster;
6. the proven full-roster fallback remains available when reuse is unsafe;
7. prior fingerprint, added slot, timestamp, original attempts, and prior judge evidence remain inspectable;
8. rotating the snapshot and queuing attempts remain one CAS/fenced operation;
9. optional synchronization to a new Task Set Version remains separate from extension success;
10. the latest matrix may show the extended state, but prior evidence is never overwritten.

Child 04 defines how reused outputs and multiple assessments count in longitudinal evidence.

## 8. Migration from suites

### 8.1 Task Set records and versions

For each existing suite:

- create one Task Set with origin `legacy-suite`;
- reconstruct versions from current suite and historical ExperimentRecord snapshots;
- map each embedded task through child 02’s crosswalk;
- preserve order, model slots, judge, Rubric/Profile refs, verifier overrides, and protocol defaults;
- create a version only when the workload manifest digest changes;
- map each ExperimentRecord to the exact reconstructed Task Set Version;
- map every Fusion Study’s exact `suiteId`/`suiteVersion` to that same crosswalk and preserve recipes, pools, trials, attempts, experimental observations, playbooks, claim levels, and artifact references unchanged;
- never alter the original snapshot.

### 8.2 Partial and ambiguous states

If a legacy task cannot map to a canonical Task Version, the migration records an unresolved member and blocks new paid execution for that Task Set version while preserving read-only result access. It never substitutes the latest task or drops the member. A Fusion Study whose Suite/version crosswalk is unresolved remains readable at its legacy route with an explicit unresolved-owner warning; its records are not reparented by guess.

### 8.3 Compatibility adapters

During rollout, `EvaluationSuite` may remain a deprecated serialized/input adapter. New editors, repositories, and routes use Task Set names and references. Frozen source fields retain their original names.

## 9. Repository changes

Canonical Task Set repository APIs cover record/version CRUD, list/filter, materialize manifest, create execution, list executions, legacy crosswalk resolution, and exact Fusion Study owner resolution. Existing `FusionStudyRepository` remains authoritative for Fusion entities; adapters change Suite ownership coordinates without duplicating study payloads.

Experiment creation must resolve all Task and Rubric refs and write the materialized workload/protocol snapshot atomically before any provider call.

Existing task-attempt atomic operations, CAS revision checks, and terminal-state guards remain unchanged unless an adapter is required.

## 10. Archive compatibility

This child extends archive v2 with Task Set records/versions, workload manifests, legacy Suite crosswalks, canonical Experiment-to-Task-Set links, and canonical owner crosswalks for every Fusion Study. All Fusion collections introduced into v2 by child 02 remain separately typed and round-trip without semantic conversion. V1 remains importable. Existing v2 exports without these optional collections remain readable. Non-identical collisions still abort before writes until child 09 adds full remapping.

## 11. Non-goals

- observation derivation or model profiles;
- changing score math, winner eligibility, repair semantics, or roster-extension execution;
- automatic Task merging;
- global study/experiment containers or changes to existing Task-Set-scoped Fusion Study experimental semantics;
- IRT, universal rankings, or workflow benchmarking;
- Records or Attention execution controls;
- final cross-entity archive collision remapping and large-import hardening beyond extending the existing v2 envelope with Task Set entities/crosswalks.

## 12. Implementation sequence

1. Add Task Set canonical types, validators, and deprecated Suite adapters.
2. Add repository record/version/materialization APIs and in-memory parity.
3. Implement deterministic suite/snapshot/Fusion-owner-to-Task-Set migration using child 02 crosswalks.
4. Convert editor/list routes and copy to Task Sets with canonical Task selectors.
5. Convert execution creation to resolve and freeze Task Set Version refs.
6. Adapt progress/results/history and existing Fusion Study owner routes to canonical identity while preserving controllers and study semantics.
7. Verify recovery, incomplete standings, task drilldown, and roster extension unchanged.
8. Add legacy route redirects and source/authority reconciliation.
9. Run full repository, execution, route, responsive, and browser gates.

## 13. Validation plan

### Domain/repository

- immutable Task Set versions and contiguous append;
- manifest validation and deterministic digest;
- exact Task/Rubric ref resolution;
- atomic materialization before paid calls;
- stale CAS and unresolved member behavior;
- current in-memory and Dexie repository parity.

### Migration

Fixtures cover unchanged/changed suites, identical tasks in different suites, historical experiments, latest unsaved-to-history version, roster extensions, incomplete/interrupted executions, every Fusion Study store and claim level, unresolved Fusion owner coordinates, legacy Profile refs, partial migration, and repeat startup. Crosswalks must be deterministic and idempotent.

### Execution regression

Run current tests for:

- experiment unit-of-work and engine;
- execution lease/heartbeat/recovery;
- incomplete task retry and missing-cell repair;
- full-roster fallback;
- roster extension/reuse/fresh judge/suite sync;
- aggregation, ranking, matrix, mobile results;
- exact run links and protocol fingerprints;
- existing Fusion Study validation/repository/controller/orchestration/view tests, with unchanged recipes, pools, trial/attempt lineage, claim levels, and playbooks.

### Component/route

- Task selector pins exact version;
- editing canonical Task never mutates a saved Task Set;
- dirty manifest cannot run ambiguously;
- historical Task Set versions are read-only;
- execution history stays under owning set;
- `/evaluations/:suiteId`, `/evaluations/:suiteId/fusion/:studyId`, and `/experiments/:id` preserve identity;
- all Suite/Profile scoring copy is gone except compatibility allowlists.

### Browser

Create/edit/version/run/recover/extend model/drill into exact cell at desktop, tablet, 390px, 200% zoom, keyboard-only, reduced motion, long Task Set names, large task counts, partial results, and unknown archived refs. Check real-table accessibility and per-element overflow.

### Commands

```bash
npx vitest run src/lib/evaluations src/lib/persistence src/workspaces/evaluations
npm run qa:suite-reliability
npm run qa:evaluations-identity
npm run typecheck:web
npm run check
```

## 14. Completion criteria

- every new Evaluation Set concept is consistently named Task Set;
- every saved Task Set Version references exact canonical Task Versions and Rubric versions;
- every Evaluation Execution freezes a materialized workload/protocol snapshot;
- Task Set owns execution history, results, recovery, and roster extension;
- exact task records, missingness, provisional standings, retries, interruption, and costs remain visible;
- legacy suite/experiment/Fusion Study data and routes remain valid;
- Fusion Study observations remain separately typed and excluded from canonical Task Observation derivation;
- child-02 archive v2 remains readable and is extended with Task Set records/versions, manifests, crosswalks, canonical Experiment links, and exact Fusion Study owner crosswalks;
- no execution controller reliability regression exists;
- all migration, automated, responsive, accessibility, and browser gates pass.

## 15. Assumptions and unresolved implementation discoveries

**Locked assumptions:** current ExperimentRecord snapshots are sufficient authority to reconstruct historical workload manifests; existing roster-extension append history plus retained attempts preserves prior meaning; current Fusion Study `suiteId`/`suiteVersion` plus its pinned pool/recipe refs are sufficient to resolve or explicitly reject canonical Task Set ownership without rewriting study evidence.

**No product decision remains unresolved.** If a historical execution cannot map exactly to a Task Set Version, it remains a readable legacy Evaluation Result with an explicit unresolved-manifest warning and is excluded from new execution or evidence claims.
