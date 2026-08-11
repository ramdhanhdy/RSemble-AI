# Observations, Eligibility, and Evidence Provenance Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 04
**Dependencies:** 01 Rubrics; 02 Canonical Tasks; 03 Task Sets and Evaluations

---

## 1. User outcome

Every eligible completed model/task cell can explain **why it counts, what it can support, and what limits it**. The system derives immutable task Observations from selected accepted attempts without copying raw evidence or inflating counts through retries, repeated judging, missing-cell repair, or roster-extension reuse.

A user can inspect observations from a canonical Task and from an Evaluation Result before model profiles exist.

## 2. Principles

1. Exact run and experiment records remain evidence authority.
2. Observation is an immutable reference/index over that evidence.
3. Evidence class and profile eligibility are different decisions.
4. Eligibility is automatic and deterministic after semantic identity exists.
5. User action controls Task promotion/linking, not whether a qualifying linked observation passes a rule.
6. Every decision carries machine reason codes and plain-language explanation.
7. Rebuild/reindex is idempotent.
8. Operational retry and reused output are never counted as independent samples.

## 3. Canonical entities

### 3.1 ModelConfigurationSnapshot

```ts
interface ModelConfigurationSnapshot {
  id: string;
  providerId: string;
  requestedModel: string;
  resolvedModel: string | null;
  resolvedVersion: string | null;
  reasoningRequested: string | null;
  reasoningEffective: string | null;
  toolScaffoldSignature: string | null;
  runtimeSettings: Record<string, JsonScalar>;
  observedFrom: number;
  observedTo: number;
  identityCompleteness: "exact" | "rolling_alias" | "partial";
}
```

Credentials, headers, provider tokens, and raw secret-bearing config never enter this snapshot.

The ID is derived through a canonical serializer and collision-checked content fingerprint, but the fingerprint is not presented as provider truth. Unknown resolved versions remain unknown.

### 3.2 Observation

```ts
interface Observation {
  id: string;
  sourceKind: "comparison" | "evaluation";
  sourceResultId: string;
  executionLineageId: string;
  runId: string;
  sourceTaskCellId: string;
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

`ObservationOutcome` contains normalized assessment values and verifier outcomes required for analysis, plus references to original criterion values/rationale. It does not duplicate candidate text or full judge rationale. Eligibility-rule versions are deliberately absent from Observation identity.
### 3.3 EligibilityDecision

```ts
type EvidenceUse =
  | "task_descriptive"
  | "within_model_profile"
  | "paired_model_comparison"
  | "task_set_standing"
  | "benchmark_anchor_analysis";

interface EligibilityDecision {
  observationId: string;
  ruleVersion: number;
  status: "eligible" | "provisional" | "excluded";
  evidenceClass: "exploratory" | "comparable" | "verified" | "benchmark_anchor";
  allowedUses: EvidenceUse[];
  reasonCodes: EvidenceReasonCode[];
  comparabilityCohortId: string;
  decidedAt: number;
}
```

Decision revisions are append-only or reproducibly replaceable derived indexes; historical rule version remains inspectable.

### 3.4 Assessment selection

An assessment reference identifies the accepted judge attempt, verifier result, blind label mapping, rubric/version, and selected task attempt. Multiple assessment events may reference the same candidate output. One active assessment is selected per execution lineage/task/model cell for default analysis.

## 4. Derivation pipeline

```text
exact result becomes terminal
→ resolve canonical Task Version and Task Instance
→ resolve selected accepted candidate attempt
→ resolve active accepted assessment/verifier evidence
→ canonicalize model configuration snapshot
→ create/get idempotent Observation
→ evaluate class + allowed uses + reason codes
→ update derived Task/evaluation evidence indexes
```

Derivation runs after the source transaction commits. A derivation failure never rolls back or corrupts the exact result; it creates a recoverable indexing error with source reference. Reindex may repair it later without provider calls.

The existing `FusionObservation` in `src/lib/evaluations/fusion-study-types.ts` is a distinct study-owned experimental entity and is not an input to this derivation pipeline. This child neither converts nor counts Fusion Study observations as canonical Task Observations. Any future eligibility adapter requires separate authorization, explicit identity/comparability rules, and non-inflation tests.

## 5. Idempotency and source key

Unique observation source key:

```text
sourceKind
+ sourceResultId
+ sourceTaskCellId
+ modelConfigurationId
+ selectedCandidateAttemptId
+ selectedAssessmentIdentity
```

Repository insertion is idempotent under that rule-independent key. A duplicate with non-identical canonical content is a corruption error, not “last write wins.” Eligibility-rule changes append/recompute `EligibilityDecision` rows for the same Observation and therefore cannot increase Observation counts. An Observation schema migration must preserve one active row per source key.
## 6. Counting and selection rules

### 6.1 Attempts and retries

- failed/rejected/superseded attempts: audit only;
- selected accepted candidate attempt: one default observation;
- operational retry that becomes selected replaces the active source selection but does not erase prior observation provenance;
- attempt count is reported separately and never used as independent sample size.

### 6.2 Missing-cell repair

- repaired selected cells may become observations;
- unrepaired missing cells remain explicit coverage gaps;
- a successful cell can support `task_descriptive` or qualified `within_model_profile` while unrelated roster cells are missing;
- `paired_model_comparison` and complete Task Set standing require all declared paired cells and accepted assessment evidence.

### 6.3 Roster extension

- reused candidate outputs retain the original candidateAttemptId;
- fresh judge assessments are additional assessment events, not new independent candidate responses;
- default profiling selects the latest eligible active assessment in that execution lineage;
- prior assessments remain drillable and may support evaluator-variability analysis later;
- added-model candidate attempts are new observations;
- Task coverage and response sample count for reused existing models do not increase.

### 6.4 Repeated executions

- a declared replicate is recorded only when the frozen protocol planned it before execution;
- undeclared repeated executions remain repeated observations, not automatically independent replicates;
- same Task Instance repeats inform within-instance variability;
- unique Task coverage counts Task identity once regardless of versions/instances/attempts.

## 7. Evidence classification

### 7.1 Exploratory

Default when a durable source lacks one or more controlled foundations, including unresolved canonical Task identity, unreconstructable Task Instance, incomplete protocol, or unsupported imported provenance.

Exploratory evidence is visible and drillable but excluded from default model profiles.

### 7.2 Comparable

Requires:

- canonical Task Version and concrete Task Instance;
- accepted completed candidate output;
- valid assessment/verifier outcome for the declared use;
- exact provider/model/configuration snapshot with unknown-version disclosure when necessary;
- valid protocol fingerprint, Rubric/version where applicable, evaluator snapshot, blind mapping, and source references;
- no unresolved corruption.

### 7.3 Verified

Requires Comparable plus:

- passing deterministic task verifier under a frozen verifier version; or
- separately authorized human verification with identity/protocol provenance.

A model judge score, even with rationale and blind mapping, does not by itself produce Verified status.

### 7.4 Benchmark anchor

Requires explicit Task Set member role `anchor`, a frozen controlled protocol, required coverage, and an authorized anchor designation. It is never inferred from sample size or a high score.

## 8. Eligibility rules and reason codes

Initial reason-code vocabulary includes:

```text
canonical_task_resolved
canonical_task_unresolved
instance_reconstructed
instance_input_incomplete
candidate_selected_completed
candidate_missing_or_failed
assessment_selected_completed
assessment_missing_or_failed
verifier_passed
verifier_failed
verifier_not_declared
rubric_resolved
rubric_unresolved
protocol_complete
protocol_incomplete
model_configuration_exact
model_version_unreported
model_configuration_incomplete
full_pair_coverage
paired_cell_missing
full_task_set_coverage
incomplete_task_set_coverage
reused_candidate_assessment
undeclared_repeat
source_corrupt
source_legacy_limited
anchor_designated
```

Rules:

- unknown resolved model version is a disclosure and cohort splitter, not automatic exclusion from all within-model description;
- incomplete unrelated roster coverage can remain eligible for within-model description;
- missing paired cells remove paired and standing uses;
- verifier failure remains valid negative evidence for verified-performance analysis when source/protocol are otherwise sound;
- unreconstructable candidate input excludes profile use;
- legacy evidence never receives invented provenance.

## 9. Comparability cohorts

Cohort identity is a canonical fingerprint over:

```text
task relation (exact version/instance for direct comparison)
rubric/version or verifier contract
protocol fingerprint and response mode
evaluator kind/model/version/configuration
tool/scaffold and reasoning policy
material provider/model-version identity
```

The cohort builder returns both fingerprint and human-readable split reasons. Incompatible cohorts may appear adjacent with disclosure but are never silently pooled.

## 10. Persistence and repository

Add stores:

```text
modelConfigurations: id, providerId, requestedModel, resolvedVersion, observedTo
observations: id, sourceResultId, taskId, taskInstanceId, modelConfigurationId, observedAt
evidenceDecisions: [observationId+ruleVersion], status, evidenceClass, comparabilityCohortId
evidenceIndexJobs: sourceResultId, status, ruleVersion, updatedAt
```

Repository APIs provide source reindex, task/model/result queries, active assessment resolution, decision explanation, and paginated evidence listing.

No repository method accepts raw candidate output as Observation payload; it must accept validated source references and resolve evidence from existing repositories.

## 11. Backfill and migration

### 11.1 Evaluation executions

Backfill canonicalized Evaluation Executions first because child 03 provides scoped Task and protocol identity. Each terminal task/model cell is derived under current rules. Interrupted/incomplete sources produce observations only for valid completed cells and explicit gaps for the rest.

### 11.2 Compare history

Existing Compare records receive source inventory entries but remain Exploratory with `canonical_task_unresolved` until child 05 links/promotes them. No automatic cross-run merging occurs.

### 11.3 Rebuild

- a resumable cursor processes sources in deterministic order;
- rule version and source revision are stored;
- repeated rebuild produces identical keys/counts;
- source changes caused by legitimate recovery/roster extension trigger only the affected lineage;
- corruption is reported without deleting exact evidence.

## 12. UI behavior

### 12.1 Evidence receipt

Evaluation task/cell detail and Task observation detail show:

- Evidence class and eligibility status;
- allowed uses;
- “Why it counts / does not count” reasons;
- Task/Version/Instance;
- model configuration/version status;
- Rubric/protocol/evaluator/verifier;
- missing coverage and reuse/retry disclosures;
- exact Record link.

No single badge substitutes for the explanation.

### 12.2 Task observations

Task detail gains an Observations section grouped by Task Version and Instance. Filters cover model configuration, evidence class, eligibility, protocol cohort, source, date, and status. Counts distinguish Tasks, instances, observations, selected attempts, and all attempts.

### 12.3 Evaluation result integration

Matrix and task detail may show compact evidence status. Incomplete standings remain governed by existing aggregation behavior. No model profile or universal score appears.

## 13. Recovery and failure invariants

- indexing never initiates provider calls;
- an indexing error does not change result completion state;
- reindex is safe across tabs and uses a local ownership/lease appropriate to storage work, separate from paid execution;
- storage quota/unavailable errors are classified and routed to owning evidence status;
- source deletion/retention is not introduced;
- secrets are rejected/sanitized before indexed explanation or export fields.

## 14. Non-goals

- Compare promotion UI and contextual history;
- Models workspace and profile aggregation;
- universal scoring or IRT;
- human verification workflow beyond representing authorized evidence;
- automatic taxonomy inference;
- changing candidate/judge execution;
- final cross-entity archive collision remapping/large-import hardening or global search. This child must still extend the existing archive v2 round trip with canonical Observation, eligibility, model-configuration, and reindex-rule entities.

## 15. Implementation sequence

1. Define canonical model-configuration, Observation, assessment, decision, and reason-code schemas.
2. Implement pure source selection and active-assessment rules with roster/retry fixtures.
3. Implement evidence classification, allowed-use, cohort, and explanation functions.
4. Add stores/repositories and idempotent insertion.
5. Integrate post-commit derivation for Evaluation Executions.
6. Add resumable backfill/reindex and Compare exploratory inventory.
7. Add Task/evaluation evidence receipt and observation query UI.
8. Add recovery/corruption/storage states and telemetry.
9. Run counting, migration, component, responsive, accessibility, and full gates.

## 16. Archive compatibility

Before this child completes, archive v2 includes immutable Observations, Eligibility Decisions, exact Model Configuration snapshots, evidence rule/version metadata, and required crosswalks. It excludes rebuildable indexes/caches and never duplicates source output/rationale. Earlier v2 and v1 imports remain readable; non-identical collisions abort before writes until child 09.

## 17. Validation plan

### Pure rules

Table-driven tests cover completed, failed, interrupted, repaired, roster-extended, verifier-pass/fail, judge-only, unknown-version, mixed-protocol, missing-pair, full-coverage, undeclared-repeat, and benchmark-anchor cases. Every case asserts class, status, uses, cohort, and reason codes.

### Counting invariants

- ten retries with one selected success: one active observation, one Task coverage;
- roster extension reusing three outputs plus one new model: three reused assessment events, one new candidate observation, no existing-model response inflation;
- same instance repeated: observation count rises, Task/Instance coverage does not;
- two versions of one Task: Task coverage one, version coverage two;
- missing roster cell: within-model descriptive may remain, paired/standing use absent;
- reindex N times: identical IDs and counts.

### Repository/backfill

Clean/legacy/partial/corrupt sources, interrupted job resume, source revision change, collision mismatch, storage failure, and multi-tab serialization.

### UI

Evidence receipt wording, all reason combinations, exact links, filters, unknown provenance, long IDs, no badge-only meaning, keyboard and screen-reader semantics.

### Commands

```bash
npx vitest run src/lib/evidence src/lib/persistence src/workspaces/tasks src/workspaces/evaluations
npm run typecheck:web
npm run check
```

## 18. Completion criteria

- every derivable Evaluation cell has an idempotent Observation or explicit indexed limitation;
- retries, reuse, multiple assessments, and repeats obey counting rules;
- eligibility/class/allowed uses are deterministic, versioned, explainable, and cohort-aware;
- exact source evidence remains unchanged and one click away;
- incomplete coverage cannot produce complete comparative claims;
- existing Compare history is preserved as exploratory, not fabricated into canonical evidence;
- archive v2 extends with Observation/eligibility/model-configuration/rule entities while v1/earlier-v2 remain readable and source payloads are not duplicated;
- all domain, repository, backfill, UI, responsive, accessibility, and full gates pass.

## 19. Assumptions and unresolved implementation discoveries

**Locked assumptions:** selected attempts and retained attempt histories provide sufficient source identity; roster-extension events and source fingerprints distinguish assessment lineage.

**No product decision remains unresolved.** A source that lacks required provenance is classified conservatively and displayed; implementation must not infer missing identity or protocol.
