# RSemble AI Task-First Evidence Workbench — Governing Product Specification

**Status:** Pending · authoritative target-state contract for this program
**Version:** 1.0.0
**Production baseline:** `feat/runs-fairness-baseline` at `309130e`
**Program index:** [`README.md`](./README.md)

---

## 1. Purpose

RSemble AI should make a repeated ordinary workflow trustworthy:

> Give models a task. Compare what they did. Preserve why the result is trustworthy. Repeat until the evidence supports an honest understanding of each model.

The product is not a generic chat application, a raw execution-log browser, or a universal model leaderboard. It is a local-first comparison and evaluation workbench that starts with real tasks, preserves exact evidence, and accumulates only qualified observations into conditional model evidence.

This specification governs all cross-child decisions required to evolve the current product coherently. It prevents separate implementation sessions from inventing incompatible identity, ownership, migration, counting, or claim semantics.

---

## 2. Authority and amendment rules

### 2.1 Target state versus shipped state

1. This document is authoritative for the **target state** and for implementation decisions inside this program.
2. Shipped code, `PRODUCT.md`, and `DECISIONS.md` remain authoritative for the **current state** until the relevant child passes all completion gates.
3. No child may present a planned concept as shipped before its persistence, behavior, recovery, and validation are complete.
4. Each completed child updates current-state authority documents and the program completion matrix in the same workstream.

### 2.2 Conflict handling

If code discovery or validation contradicts a locked rule:

1. stop implementation at the conflicting boundary;
2. record the observed contradiction and affected children;
3. amend this parent with a version bump and decision-ledger entry;
4. update every affected child reference;
5. resume only after the contract is coherent again.

A child may refine local UI copy, file placement, or repository APIs. It may not redefine canonical IDs, immutable history, evidence units, eligibility, profile respondents, migration identity, route compatibility, or owning contexts.

### 2.3 Baseline authority superseded by this target

For this program, the future target explicitly supersedes these current assumptions:

- primary navigation is permanently limited to Compare · Runs · Evaluations;
- Runs is a first-class destination for ordinary history browsing;
- a scoring Profile and a model evidence profile may share the word “Profile”;
- embedded suite tasks are sufficient long-term task identity;
- experiment-level means may be treated as timeless model capability.

The supersession becomes current product authority only as the corresponding children complete.

---

## 3. Product outcomes

A complete implementation lets a user:

1. compare several model configurations on one ordinary task without designing a benchmark first;
2. see the recommendation or fused answer together with why the result is or is not trustworthy;
3. preserve the exact task input, candidate attempts, accepted attempts, judge/verifier evidence, protocol, costs, failures, and recovery history;
4. promote or link useful ad hoc work to a canonical task without silent content-based merging;
5. reuse immutable task versions across multiple Task Sets;
6. run repeatable evaluations whose Task Set owns execution history and task-level outcomes;
7. add a model to a finished evaluation without regenerating reusable accepted candidates or erasing prior judge evidence;
8. inspect cumulative evidence for an exact model configuration by task family, coverage, protocol cohort, uncertainty, and recency;
9. reach every claim through exact supporting observations and execution records;
10. find tasks, Task Sets, evaluation results, model evidence, comparisons, and exact records without making a raw ledger the product’s primary mental model;
11. recover interrupted or incomplete work from the workspace that owns the operation;
12. continue using existing archives and `/runs/:runId` links after migration.

---

## 4. Product topology and ownership

### 4.1 Primary topology

The final primary navigation is:

```text
Compare · Evaluations · Models
```

Secondary global utilities are:

```text
Search · Attention · Records · Connections
```

### 4.2 Ownership table

| Object or action | Owning context | Not owned by |
|---|---|---|
| Comparison result, retry, re-judge, re-fuse, task promotion | Compare | Records |
| Task Set definition, ordinary Evaluation Execution history/matrix/recovery/roster extension, and scoped Fusion Studies | Evaluations / owning Task Set | Records or Models |
| Canonical task version and task observation history | Task context reached from Compare/Evaluations/Search | A universal Runs page |
| Qualified longitudinal claims and coverage | Models / exact model configuration profile | Task Sets or Runs |
| Exact attempts, logs, provenance, copy link, export lookup | Records | Primary navigation |
| Cross-workspace recovery reminder | Attention, as a handoff only | A new execution controller |

Meaningful results remain in the context where the user made the decision. Records are typed audit references to those results and their leaf evidence; Records do not become a renamed universal result object.

### 4.3 Route contract

Required target routes:

```text
/compare
/compare/results/:comparisonId
/evaluations
/evaluations/sets/:taskSetId
/evaluations/sets/:taskSetId/versions/:version
/evaluations/sets/:taskSetId/fusion/:studyId
/evaluations/results/:evaluationExecutionId
/evaluations/rubrics
/evaluations/rubrics/:rubricId
/models
/models/rollups/:rollupId/versions/:version
/models/:modelConfigurationId
/models/:modelConfigurationId/evidence/:observationId
/tasks/:taskId/versions/:version
/records
/records/diagnostics
/records/:recordType/:recordId
```

Compatibility contract:

- `/runs` remains a supported alias to the full Records utility or a compatibility redirect preserving query state.
- `/runs/:runId` continues to resolve the exact run record. Existing copied links must not 404 or silently open a summary.
- Current `/evaluations/:suiteId`, `/evaluations/:suiteId/fusion/:studyId`, `/evaluations/profiles`, `/evaluations/profiles/:profileId`, and `/experiments/:experimentId` links receive explicit redirect/adapter tests before canonical routes replace them.
- Hash-router behavior remains supported.
- Copy links remain explicitly device-local until cross-device storage is separately authorized.

---

## 5. Canonical terminology

These terms are reserved. Children must use them in UI and new domain code unless a compatibility adapter explicitly reads a legacy name.

| Term | Meaning |
|---|---|
| **Task** | Stable semantic identity for one concrete objective. Administrative metadata may change; executable historical meaning may not. |
| **Task Version** | Immutable executable definition of candidate-visible instructions, context contract, response contract, task-defining verifier binding, and source metadata. |
| **Task Instance** | Immutable concrete input/context snapshot executed under one Task Version. Exact repeats may share an instance only when their complete normalized input digest matches. |
| **Task Artifact** | Immutable locally preserved text/blob input referenced by a Task Version or Instance through an opaque ID, content digest, media type, and byte count. Metadata-only legacy attachments are disclosed as incomplete. |
| **Task Family** | Explicit grouping of related tasks used to represent domain clusters and prevent variants from masquerading as unrelated coverage. It is not a capability score. |
| **Task Facet** | Versioned, provenance-bearing annotation about task demand, setting, interaction, modality, constraint, or evaluation type. |
| **Task Set** | Versioned workload selection over exact Task Versions plus membership metadata and protocol defaults. It is not a universal evidence owner. |
| **Workload Manifest** | Technical snapshot of a Task Set Version: memberships, order, strata, weights, roles, and execution defaults. |
| **Rubric** | Versioned scoring criteria, anchors, judge instruction, requirement groups, and optional criterion-to-facet mappings. Replaces the scoring use of “Profile.” |
| **Comparison Result** | One durable Compare outcome and its recovery lineage. Initially maps one-to-one to a current full run record. |
| **Evaluation Execution** | One frozen Task Set Version × roster × protocol execution. Current persisted ExperimentRecord is its compatibility foundation. |
| **Evaluation Result** | The aggregate view owned by an Evaluation Execution; it owns task outcomes and coverage but does not replace leaf run records. |
| **Fusion Study** | Existing Task-Set-scoped experimental decision engine over pinned workload, pool, recipes, trials, attempts, observations, and playbook. It remains distinct from an ordinary Evaluation Result, canonical Task Observation, and deferred workflow benchmarking. |
| **Candidate Attempt** | One model generation attempt for one task execution. |
| **Judge Attempt** | One assessment attempt over a declared candidate roster and blind-label mapping. |
| **Retry** | An operational continuation after missing, failed, rejected, or interrupted work. It is not an independent replicate by default. |
| **Replicate** | A deliberately planned independent stochastic repetition declared by protocol before execution. |
| **Observation** | Immutable evaluated reference to a selected candidate attempt, its assessment/verifier evidence, canonical task instance, model configuration, and protocol provenance. |
| **Evidence Class** | `exploratory`, `comparable`, `verified`, or `benchmark_anchor`. Class describes evidence conditions, not whether every possible claim is allowed. |
| **Eligibility Decision** | Versioned deterministic decision describing which uses an observation supports and why. |
| **Model Configuration** | Provider/model/version identity plus behavior-changing reasoning, tool, scaffold, and runtime settings. It—not a marketing name—is the default profile respondent. |
| **Model Evidence Profile** | Reproducible derived view over qualified observations for one exact model configuration, or a stratified collection of such views for one pinned explicit Model Rollup Version, plus a declared evidence window. |
| **Model Rollup** | Versioned named analytical view over disclosed exact Model Configurations; opt-in, heterogeneous by construction, and never a replacement identity. |
| **Record** | Exact typed audit/provenance envelope. Current RunRecordV2 is a leaf Record type, not the only kind of meaningful historical object. |
| **Attention Item** | Derived, bounded handoff to an actionable recovery context. It is not durable lifecycle state. |

Avoid unqualified **run**, **experiment**, **trial**, **history**, **profile**, and **score** in new user-facing copy when the exact term above is available.

---

## 6. Canonical object graph

```text
Task
 ├─ immutable Task Versions
 │   ├─ immutable Task Instances
 │   │   └─ immutable Task Artifact references
 │   └─ versioned Task Facet annotations
 └─ explicit Task Family membership

Task Set
 └─ immutable Task Set Versions / Workload Manifests
     ├─ members reference exact Task Versions
     └─ scoped Fusion Studies
         └─ recipes / pools / trials / attempts / experimental observations / playbooks

Comparison Result ─┐
                   ├─ Task execution Records
Evaluation Execution┘   ├─ Candidate Attempts
                         ├─ Judge / verifier Attempts
                         └─ selected attempts
                                  │
                                  └─ immutable Observations
                                       ├─ Eligibility Decisions
                                       └─ exact Model Configuration
                                                ├─ optional versioned Model Rollup membership
                                                └─ derived Model Evidence Profile
```

The graph is additive over existing exact evidence. No migration may rewrite accepted outputs, judge mappings, attempt IDs, timestamps, costs, or failure payloads merely to fit the new vocabulary.

---

## 7. Canonical identity and versioning

### 7.1 ID rules

- IDs are opaque stable strings generated through the project’s ID utility.
- Content digests are integrity/deduplication aids, never semantic IDs.
- No automatic content-based merge may claim that two prompts are the same Task.
- Import collision handling remaps IDs through an explicit crosswalk and rewrites references atomically; it never overwrites an unrelated local entity.

### 7.2 Task identity

A Task owns stable administrative metadata:

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

A Task Version is immutable after commit:

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

Changing candidate-visible instructions, task-defining context, response contract, or correctness contract creates a new Task Version. Changing tags, archive state, or a later annotation does not mutate an old version.

### 7.3 Task instances and artifacts

A Task Artifact is an immutable local input object with opaque ID, content digest, media type, byte count, and storage reference. Digest matches are verified against byte equality before artifact reuse; digests are never semantic Task identity. Credentials and provider-auth material are prohibited.

A Task Instance stores the concrete normalized candidate-visible input plus a context manifest whose entries resolve to durable Task Artifacts or an explicit external provenance reference. Repeated executions may share a Task Instance only when the complete normalized input, artifact digests, and context manifest match under the same Task Version. Exact provider-formatted messages remain in candidate attempts.

If historical input content cannot be reconstructed beyond filename/size/type metadata, the instance is marked `metadata_only` or `incomplete`; migration must not fabricate artifact bytes, and profile eligibility is limited by `instance_input_incomplete`.

Ad hoc Compare work always receives an immutable result input snapshot, but it is not silently promoted to a canonical Task. It becomes profile-eligible only after explicit creation/linking of a Task Version and successful reconstruction of a complete Task Instance.

### 7.4 Task families and facets

- Family assignment is explicit and reviewable; similarity may be suggested but never silently accepted.
- One Task may have one primary family and typed relations to other families.
- Facets are orthogonal fields, not one universal skill tree.
- Every facet assignment records taxonomy version, source, author kind, confidence, and timestamp.
- Task-demand annotations must remain distinct from observed model traces and inferred model capability.

### 7.5 Task Sets

A Task Set Version is immutable and references exact Task Versions. Membership carries order, optional stratum, role (`organic`, `anchor`, `calibration`, `holdout`), and weight. Editing membership, rubric default, roster default, repeat policy, or missingness policy creates a new Task Set Version.

Every Evaluation Execution materializes a frozen Workload Manifest and protocol snapshot. Later Task, Task Set, Rubric, provider, or model changes cannot alter that execution’s meaning.

Existing Fusion Studies remain scoped to an exact Task Set Version (through a Suite compatibility adapter during migration). Their versioned recipes, pool manifests, trials, attempts, experimental `FusionObservation` records, and playbooks retain their current semantics and provenance. They are not renamed to Evaluation Results and are not silently ingested as canonical Task Observations.

### 7.6 Rubrics

- User-visible and new domain terminology is **Rubric**.
- Current physical stores or frozen v1/v2 serialized fields named `profile*` may remain compatibility implementation details.
- Deprecated aliases are confined to import, migration, and adapter modules.
- New archive schema writes `rubrics`; import reads both `rubrics` and legacy `profiles`.
- A criterion-to-facet mapping is optional, versioned, and authored. Unmapped criteria remain visible and cannot silently power facet-level claims.

### 7.7 Model configuration identity

The default respondent key includes:

```text
provider id
requested model slug
resolved model id/version when reported
reasoning policy requested and effective
behavior-changing tool/scaffold signature
other behavior-changing runtime settings
```

If a provider exposes only a rolling alias, the profile must say the resolved version is unknown and display the observation window. Observations under unresolved or materially changed identities are never represented as one timeless stable model.

User-authored rollups may group exact configurations, but must disclose members and heterogeneity. They are not the default statistical respondent.

---

## 8. Records, results, and immutable history

### 8.1 Existing run records

`RunRecordV2` remains the source of truth for exact candidate attempts, selected attempts, judge attempts and blind-label mappings, fusion attempts, messages, costs, status, errors, execution source, and timestamps.

Future indexes reference it; they do not copy its raw outputs into competing truth stores.

### 8.2 Comparison results

For current and migrated full Compare runs:

```text
comparisonId == runId
```

A Comparison Result index may add owning-context references, task linkage, evidence receipt, and search fields. The exact result payload remains the run record.

### 8.3 Evaluation results

An Evaluation Result is a projection of the Evaluation Execution and its selected task attempts. Current `ExperimentRecord` and task-attempt ledger remain the foundation. The Evaluation Result does not become a synthetic `RunRecord`.

### 8.4 Fusion Studies

Current Fusion Studies remain Task-Set-scoped experimental contexts. `FusionRecipeVersion`, `PoolManifestVersion`, `FusionStudy`, `FusionTrial`, `FusionAttempt`, experimental `FusionObservation`, and `FusionPlaybook` records remain exact current evidence with their existing exploration/confirmation claim levels. Suite coordinates migrate through an exact Task Set/version crosswalk; no study, trial, attempt, observation, playbook, or artifact reference is rewritten into an ordinary Evaluation Execution or canonical Task Observation.

### 8.5 Roster extension

Roster extension remains an append-only event inside an Evaluation Execution:

- accepted reusable candidate outputs are not regenerated;
- the added model executes only required cells unless the proven full-roster fallback is needed;
- a fresh blind judge evaluates the reconstructed roster;
- the prior fingerprint, extension event, prior attempts, and prior judge evidence remain inspectable;
- the current matrix may represent the latest accepted extension state;
- reused candidate attempts do not become new independent observations for existing models;
- multiple assessments of one candidate attempt remain audit evidence, with exactly one active assessment selected per execution lineage and task/model cell for default profiling.

### 8.6 Retry, recovery, and interruption

- Retrying appends linked attempts; it never overwrites failed or interrupted attempts.
- Existing execution lease, fencing, idempotent unit-of-work, recovery, missing-cell repair, and terminal-state contracts remain mandatory.
- Search, Records, and Attention navigate to the owning recovery surface; they do not invoke paid execution directly.

---

## 9. Observation and evidence contract

### 9.1 Observation is a reference, not a copy

An Observation records:

```ts
interface Observation {
  id: string;
  source: {
    kind: "comparison" | "evaluation";
    resultId: string;
    executionLineageId: string;
    runId: string;
  };
  taskId: string;
  taskVersion: number;
  taskInstanceId: string;
  taskFamilyId: string | null;
  modelConfigurationId: string;
  candidateAttemptId: string;
  assessmentRef: AssessmentRef;
  protocolFingerprint: string;
  rubricRef: VersionRef | null;
  evaluatorSnapshot: EvaluatorSnapshot;
  verifierSnapshot: VerifierSnapshot | null;
  outcome: ObservationOutcome;
  observedAt: number;
  observationSchemaVersion: number;
}
```

It references exact evidence by ID. It does not duplicate candidate output, judge rationale, or task input.

### 9.2 Idempotency

Observation derivation has a rule-independent unique source key:

```text
source kind + source result + task cell + model configuration
+ selected candidate attempt + selected assessment
```

Reindexing produces no duplicate. A changed eligibility rule creates a new Eligibility Decision for the same Observation. An Observation schema change requires an explicit migration/rebuild that preserves source-key uniqueness and never leaves two active rows for one source key.
### 9.3 Counting semantics

1. An operational retry is not a new replicate.
2. Only the selected accepted candidate attempt supplies the default observation for one result/task/model cell.
3. Failed, superseded, and rejected attempts remain audit evidence but do not increase profile sample size.
4. Multiple judge assessments of one reused candidate output do not increase task coverage or independent response count.
5. Repeated Evaluation Executions or declared protocol replicates may create repeated observations, but profiles report task concepts, task versions, task instances, observations, and declared replicates separately.
6. Repeating the same Task Instance informs within-task variability; it does not increase Task coverage.
7. Family coverage counts unique Task identities first, then versions and instances.
8. Roster extension selects one active assessment per execution lineage/task/model cell for default aggregation. Prior assessments remain drillable.
9. No migration may infer independence from attempt count.

### 9.4 Evidence classes

- **Exploratory:** durable exact record but missing canonical identity or controlled comparability requirements.
- **Comparable:** canonical task instance, resolved configuration snapshot, valid rubric/evaluator/protocol provenance, and an accepted outcome suitable for declared comparisons.
- **Verified:** Comparable plus a passing deterministic verifier or separately authorized human verification that validates the task correctness contract. Model-judge scoring alone does not confer Verified status.
- **Benchmark anchor:** explicitly designated controlled anchor evidence with frozen workload/protocol, declared sampling role, and required coverage. It is never inferred automatically.

### 9.5 Eligibility decisions and allowed uses

Eligibility is deterministic, versioned, and separate from class:

```ts
type EvidenceUse =
  | "task_descriptive"
  | "within_model_profile"
  | "paired_model_comparison"
  | "task_set_standing"
  | "benchmark_anchor_analysis";

type EligibilityStatus = "eligible" | "provisional" | "excluded";
```

Every decision includes machine-readable reason codes and human-readable “Why it counts / does not count” copy.

Minimum requirements for any profile use:

- canonical Task Version and reconstructable Task Instance;
- accepted completed candidate attempt;
- exact model configuration snapshot, including unknown-version disclosure where applicable;
- protocol fingerprint and evaluator/rubric provenance;
- valid selected outcome and no unresolved corruption;
- derivation version and source references.

A completed model cell may support a qualified within-model task description even when another roster cell is missing, provided missingness is disclosed. It cannot support a complete head-to-head, Task Set standing, or full-coverage claim unless all required paired cells and assessments are present.

### 9.6 Comparability

Observations are pooled only inside an explicit comparability cohort. Cohort identity includes task/version/instance relation, rubric/version or verifier contract, protocol fingerprint, evaluator kind/version, response mode, and material model/runtime configuration.

Protocol, rubric, judge, tool/scaffold, reasoning policy, provider route, task contract, or material model-version changes split or stratify cohorts. The UI may offer adjacent cohorts but may not silently average them.

---

## 10. Model evidence and statistical honesty

### 10.1 Profiles are reproducible views

A Model Evidence Profile is a query over:

```text
exact model configuration
+ evidence window
+ task-family/facet filters
+ evidence classes
+ comparability cohorts
+ eligibility-rule version
+ aggregation-rule version
```

The profile stores or exposes its query fingerprint and generated-at time. It is not a mutable score field on a model row.

### 10.2 First-release evidence products

Profiles may ship:

- unique Task, Task Version, Task Instance, Observation, and replicate counts;
- evidence-class and eligibility breakdowns;
- recency and resolved/unknown model-version disclosure;
- deterministic verified pass rates;
- normalized judged-quality estimates only within declared commensurate rubric cohorts;
- paired win/tie/loss and score-delta views only over shared eligible tasks;
- task-family and facet coverage;
- strongest supported, weakest supported, mixed, and missing evidence areas using deterministic thresholds;
- exact supporting and contradicting observation drilldown;
- protocol, rubric, evaluator, provider, reasoning, and tool/scaffold filters.

### 10.3 Equal-weighting and uncertainty

Default aggregation unit is the Task identity, not the attempt:

1. select the active eligible observation per execution lineage/task/model cell;
2. average declared replicates within the same Task Instance;
3. average instances within the same Task Version;
4. average versions only when the query explicitly requests a Task-level rollup;
5. weight unique Tasks equally inside a family unless a frozen Task Set declares an alternative for that result only.

For family estimates, a versioned uncertainty-unit resolver chooses the resampling unit from the declared protocol/generalization question and known Task relations, source/repository groups, and Task clusters. The Task is the explicit fallback assumption only when no higher-order dependency is encoded, and that assumption is displayed. Deterministic seeded cluster bootstrap intervals resample the resolved independent units while preserving nested Tasks/versions/instances/replicates. Fewer than five resolved units yields point evidence plus **insufficient independent coverage for an interval**, not pseudo-precision. The receipt pins the resolver/rule version, resolved unit count, assignment digest, and any fallback assumption.

Paired model differences use only shared eligible Tasks and paired Task-level deltas. They never substitute each model’s unrelated task mix.

### 10.4 Prohibited claims

The first profile release must not show:

- a universal overall model score or evidence index;
- a global model leaderboard;
- unqualified “best model” language;
- pooled scores across incompatible rubric/protocol cohorts;
- attempt count presented as independent sample size;
- task annotations presented as learned capability;
- model-judge narrative presented as new independent evidence;
- hidden missing cells, failures, unknown versions, or coverage gaps.

Any later overall index or latent capability estimate requires a separate authorized specification and validation program.

---

## 11. Migration and compatibility

### 11.1 Migration principles

- Migrations are additive, deterministic, resumable, idempotent, and transaction-bounded.
- Existing exact records and experiment snapshots remain byte-for-byte semantically intact.
- New indexes may be rebuilt from source records.
- A migration marker is written only after all entities and crosswalks for that step commit.
- Partial migrations resume safely; they never duplicate Tasks, versions, instances, or observations.
- Runtime validators reject malformed imported entities before any paid execution can use them.

### 11.2 Embedded Task Set tasks

Existing suites and experiment snapshots provide enough scoped identity to migrate embedded tasks conservatively:

1. create a namespaced canonical Task for each legacy suite task identity;
2. reconstruct immutable versions from latest suite content and historical experiment snapshots;
3. reuse a version only when the complete executable definition digest matches within that namespaced task;
4. create Task Set versions and crosswalk old suite/task/version coordinates to canonical Task Versions;
5. never merge similar tasks across different suites automatically;
6. preserve each historical ExperimentRecord snapshot and reference it through the crosswalk;
7. map each existing Fusion Study’s exact `suiteId`/`suiteVersion` to the corresponding Task Set Version while leaving recipes, pool manifests, trials, attempts, experimental observations, playbooks, claim levels, and artifact references semantically intact; unresolved coordinates remain readable and explicitly unresolved rather than being guessed.

### 11.3 Legacy Compare history

Existing Compare records remain complete Records. They are not automatically merged into canonical Tasks because prompt equality cannot prove semantic identity.

- They receive Comparison Result indexes where safely derivable.
- Their evidence class remains Exploratory with `unresolved_task_identity` until explicitly linked/promoted.
- Missing historical input artifacts or unresolved model versions remain disclosed and may permanently limit eligibility.

### 11.4 Rubric compatibility

- Legacy `ProfileRecord`, `ProfileVersion`, `evaluationProfileId`, and archive `profiles` fields remain readable.
- New domain APIs expose Rubric names.
- Frozen run/experiment payloads retain legacy field names where renaming would corrupt compatibility.
- Export schema v2 writes a terminology manifest and canonical rubric entities; importer accepts v1 and v2.

### 11.5 Archive progression

A child that introduces canonical persisted data must extend the canonical archive export/import round trip in the same child; no user-facing child may depend on child 09 to make its data recoverable.

- Child 01 keeps archive v1 readable while Rubric names remain adapters.
- Child 02 introduces the extensible archive v2 envelope and round-trips current exact Run/Experiment/Fusion Study evidence—including recipes, pool manifests, studies, trials, attempts, experimental observations, and playbooks—plus canonical Rubrics, Tasks, Task Versions, Task Artifacts, Task Instances, families/facets, and migration crosswalks.
- Children 03–06 extend the same major format with Task Set/Evaluation links, Observations/eligibility/model identities, Comparison Result indexes, and versioned Model Rollup definitions before their own completion gates.
- Any later child that adds canonical persisted preferences/entities must do the same; disposable caches and search indexes are omitted and rebuilt.
- Child 09 completes full-corpus collision remapping, resumable large import, diagnostics, security/performance hardening, and final manifest verification. Earlier v2 exports remain readable.

Before child 09, a non-identical ID collision may be rejected during preview before writes; it may never overwrite or partially import. Child 09 must implement full cross-reference remapping.

### 11.6 Route compatibility

Every legacy route receives automated direct-load, refresh, and back/forward tests. Redirects must preserve the entity and return path. Exact `/runs/:runId` links continue to render exact records even after Runs leaves primary navigation.

---

## 12. Search, Records, and Attention boundaries

### 12.1 Search

Search is local and typed. It spans Tasks, Task Sets, Rubrics, Evaluation Results, Fusion Studies, Comparison Results, Model Configurations, Model Rollups, Observations, and Records. Each hit identifies its type and opens the owning context or exact evidence.

No embedding or remote semantic index is part of this program. Search indexes must not contain credentials or unsanitized secret-bearing failure payloads.

### 12.2 Records

Records support:

- exact ID lookup;
- type/source/status/model/time filtering;
- typed grouping by Compare, Evaluation, and legacy origin;
- exact detail, provenance, local copy link, export, and return-to-owner actions.

Records do not own retries, evaluation repair, model addition, re-judge, re-fuse, deletion policy, or retention policy.

### 12.3 Attention

Attention is a bounded derived query, not a persisted state machine. Initial membership is limited to:

- interrupted or recoverable Compare results;
- incomplete/interrupted Evaluation Executions with a valid owning recovery action;
- storage failures that block preservation and have a concrete recovery route.

An item disappears when the source no longer satisfies the query, is superseded by a newer recovered lineage, or becomes non-actionable. Attention never mutates execution state or makes paid calls.

---

## 13. Responsive, accessibility, and local-first requirements

Every child with UI must verify:

- desktop, tablet, `390px` mobile, and `200%` zoom;
- no horizontal page or element-level overflow;
- keyboard-only creation, navigation, filtering, dialogs, recovery, and drilldown;
- visible focus, correct `aria-current`, dialog focus return, real tables for matrices, and non-color-only states;
- minimum 44px touch targets where applicable;
- reduced-motion behavior;
- stable loading, empty, error, partial, interrupted, and unknown-version states;
- no inert controls or rows disguised as buttons;
- secrets never appear in page text, exports, indexes, logs, or screenshots;
- all copied links describe device-local scope honestly.

The final prototype is an interaction reference, not a data-authority shortcut. Illustrative provider/model names and unsupported evidence-index numbers are not requirements.

---

## 14. Validation strategy

### 14.1 Per-child gates

Each child plan must use vertical RED → GREEN → REFACTOR cycles and include:

1. pure domain/runtime-validation tests;
2. repository and migration tests against clean, legacy, partial, collision, and corrupted states;
3. React behavior tests using the project’s existing happy-dom harness;
4. route/direct-load/back-forward compatibility tests;
5. execution/recovery regression tests where paid-call orchestration is touched;
6. archive round-trip and secret-leak tests for persisted/exported changes;
7. targeted browser QA across viewport/accessibility states;
8. `npm run typecheck:web` during work and `npm run check` at the child gate.

No test may make a real paid provider call. Browser QA uses deterministic mocks that derive the blind-label roster dynamically.

### 14.2 Cross-child invariant suite

Child 09 must create or consolidate executable invariant tests proving:

- historical exact Run, Experiment, and Fusion Study records are unchanged and reachable;
- all current Fusion Study entities archive round-trip and Suite→Task Set route/reference adapters preserve study ownership;
- migrations/reindexing are idempotent;
- retries and roster extension do not inflate observation counts;
- incomplete coverage cannot produce complete standings or paired claims;
- unknown model version and incompatible protocol cohorts remain disclosed;
- every profile headline drills to support and limitations;
- Records and Attention cannot execute;
- legacy archives and routes still work;
- primary navigation has no Runs destination;
- no universal model score is emitted.

---

## 15. Child dependency and completion gates

| Child | Entry gate | Completion gate | Status |
|---|---|---|---|
| 01 Rubrics | Parent accepted | All user/domain terminology migrated; legacy data/routes/archive read; no model profiles introduced | ✅ Shipped (2026-08-12) |
| 02 Tasks | 01 complete | Canonical schema, immutability, task UI, legacy scoped migration, archive v2 base round-trip, and version/artifact/instance tests pass | Pending |
| 03 Task Sets/Evaluations | 01 + 02 complete | Set versions reference canonical Task Versions; ordinary executions and Fusion Studies preserve exact snapshots/results/recovery/extension and route/archive compatibility | Pending |
| 04 Observations/Evidence | 01–03 complete | Idempotent derivation, eligibility reason codes, counting and comparability invariants pass | Pending |
| 05 Compare Results | 02 + 04 complete | Compare owns durable history, promotion/linking, evidence receipts, retry/recovery, exact record links | Pending |
| 06 Model Profiles | 04 + 05 complete | Qualified evidence views, coverage, uncertainty, cohort filtering, drilldown, prohibited-claim tests pass | Pending |
| 07 Shell/Records | 03 + 05 + 06 complete | Final topology ships without inert destinations; Records and all legacy deep links work | Pending |
| 08 Attention | 03 + 05 + 07 complete | Membership/supersession/handoff semantics pass; no execution lives in Attention | Pending |
| 09 Hardening | 01–08 complete | Search, archive v2 completion/collision hardening, migration repair, performance, responsive/a11y QA, and authority reconciliation pass | Pending |

Children may not be marked complete with placeholder controls, hidden compatibility debt, or a later child required to make their core outcome truthful.

---

## 16. Deferred boundaries

Explicitly deferred pending evidence maturity or separate authorization:

- IRT, Rasch, latent ability, difficulty/discrimination fitting, or universal intelligence scales;
- a universal evidence index or global model leaderboard;
- workflow/agent configurations as benchmark respondents;
- workflow import, controlled runners, visual builders, discovery, or optimization;
- automatic taxonomy inference treated as truth;
- automatic benchmark generation;
- an independent “judge of the dossier” that creates new evidence;
- cross-device synchronization or portable sharing;
- retention, deletion, or archival lifecycle beyond current safe export/import;
- embedding-based or remote semantic search;
- autonomous Attention actions;
- new providers, provider bridges, or model catalog scope merely because the prototype uses illustrative names;
- calendar estimates.

Deferred concepts receive no inert navigation, placeholder dashboards, or schema fields without a current child use.

---

## 17. Locked decision ledger

| ID | Decision |
|---|---|
| P01 | Task-level evidence is the durable analytical foundation; Task Set totals are contextual summaries. |
| P02 | Tasks have explicit stable identity, immutable executable versions, and concrete instances. Prompt hashes do not define semantic identity. |
| P03 | Primary navigation becomes Compare · Evaluations · Models; Records is secondary. |
| P04 | Exact RunRecordV2, ExperimentRecord, and existing Fusion Study evidence is preserved and indexed, not rewritten into a universal replacement object. |
| P05 | Comparison Results belong to Compare; Evaluation Results belong to their Task Set; observations belong to task/model evidence; attempts stay subordinate. |
| P06 | Existing scoring Profiles become Rubrics before model evidence profiles ship. |
| P07 | Ad hoc Compare work is always durable but requires explicit Task promotion/linking before profile eligibility. |
| P08 | Eligibility is computed automatically after identity exists; user action controls semantic promotion, not evidence-rule outcomes. |
| P09 | Retry attempts, reused roster-extension outputs, and repeated judge assessments never inflate independent sample or coverage counts. |
| P10 | A complete model cell may support a qualified within-model description despite unrelated missing cells; incomplete rosters cannot support complete paired or standing claims. |
| P11 | Exact model configuration is the default respondent; unresolved rolling versions are windowed/disclosed, and explicit pinned Model Rollup versions may group configurations only as stratified member views in this program. |
| P12 | Profiles are reproducible derived views with task-weighted aggregation and versioned, disclosed dependency-aware cluster uncertainty, not mutable universal scores. |
| P13 | No overall evidence index ships in this program. |
| P14 | IRT remains deferred pending evidence maturity; its prerequisites are preserved without placeholder UI. |
| P15 | Workflow benchmarking remains a later respondent-type possibility over the same Task/Observation foundation. |
| P16 | Attention is a bounded derived handoff and Records is an audit utility; neither executes paid operations. |
| P17 | Migration never auto-merges similar Tasks across contexts or fabricates unknown model/version/input provenance. |
| P18 | Implementation plans are ordered by dependency and validation evidence, never calendar estimates. |
| P19 | Existing Fusion Studies remain Task-Set-scoped experimental contexts; their `FusionObservation` records are not canonical Task Observations and cannot enter Model Evidence Profiles without a separately authorized eligibility adapter. |

---

## 18. Parent completion criteria

This governing specification is fulfilled only when all nine children are archived and:

- the final topology and vocabulary are consistent across UI, routes, code, exports, and authority documents;
- every meaningful result and profile claim has an exact evidence path;
- canonical Tasks and observations can be reconstructed without altering historical evidence;
- migration and archive restoration are safe across supported historical states;
- retries, recovery, interruption, roster extension, Fusion Study semantics, protocol fingerprints, and exact provenance remain correct;
- model evidence exposes coverage, uncertainty, sample structure, configuration/version, evaluator/rubric/protocol, recency, supporting observations, and limitations;
- the product makes no universal-score, silent-pooling, hidden-missingness, or fabricated-lineage claims;
- the complete automated and browser validation matrix is green.
