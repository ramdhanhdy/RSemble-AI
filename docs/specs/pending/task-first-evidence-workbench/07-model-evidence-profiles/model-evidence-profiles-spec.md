# Qualified Model Evidence Profiles Specification

**Status:** Implemented — pending independent closure review
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 06
**Dependencies:** 04 Observations and Evidence; 05 Contextual Compare Results
**Reconciliation:** The implemented candidate is direct-route Models (`/models`) with exact profile, evidence drilldown, and versioned Model Rollup routes; Child 08 still owns primary navigation. Exact configuration respondents remain identity/version-honest and cohort-separated. Rollups pin exact members under `stratified_only`, disclose heterogeneity, and never create a pooled respondent or universal score. Independent closure review remains pending.

---

## 1. User outcome

A user can open one exact model configuration and answer:

> What kinds of tasks has this configuration handled reliably, under what protocols, with how much and what kind of evidence, how uncertain is that evidence, and which exact observations support or contradict the summary?

The answer is conditional, coverage-aware, filterable, reproducible, and honest about missingness, version ambiguity, protocol changes, and small samples.

## 2. Product boundary

This child creates **Models** as a primary evidence workspace only after qualified observations exist. It does not create a global leaderboard, universal capability score, or IRT model.

A model marketing name is not the default respondent. The default respondent is the exact `ModelConfigurationSnapshot` defined by child 04.

## 3. Profile query contract

```ts
type ProfileRespondent =
  | { kind: "model_configuration"; modelConfigurationId: string }
  | {
      kind: "model_rollup";
      rollupId: string;
      version: number;
      aggregationPolicy: "stratified_only";
    };

interface ModelEvidenceQuery {
  respondent: ProfileRespondent;
  observedFrom: number | null;
  observedTo: number | null;
  taskFamilyIds: string[];
  facetFilters: FacetFilter[];
  evidenceClasses: EvidenceClass[];
  allowedUses: EvidenceUse[];
  comparabilityCohortIds: string[];
  sourceKinds: Array<"comparison" | "evaluation">;
  rubricRefs: VersionRef[];
  evaluatorFilters: EvaluatorFilter[];
  includeUnknownVersion: boolean;
  eligibilityRuleVersion: number;
  aggregationRuleVersion: number;
  uncertaintyRuleVersion: number;
}
```

The canonical serializer validates the discriminated respondent, resolves a rollup reference to its immutable exact member list, and produces a query fingerprint plus a receipt containing that resolved respondent manifest. No nullable model/rollup ID pair is allowed. The profile shows fingerprint abbreviation, generated time, observation window, and active filters.

## 4. Model identity and rollups

### 4.1 Exact configuration profile

Profile header discloses:

- provider and requested model slug;
- resolved model/version when reported;
- rolling-alias or partial-identity warning;
- reasoning policy requested/effective;
- behavior-changing tool/scaffold signature;
- observation date range;
- protocol/rubric/evaluator cohort count.

### 4.2 Rolling aliases

When resolved version is unknown:

- label the respondent as a provider alias observed during a date window;
- split windows when material configuration/protocol metadata changes;
- never use timeless version language;
- allow filtering/exclusion;
- keep exact source observations drillable.

### 4.3 User-defined rollups

A user may create a versioned named analytical rollup over exact configurations:

```ts
interface ModelRollupRecord {
  id: string;
  name: string;
  latestVersion: number;
  revision: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

interface ModelRollupVersion {
  rollupId: string;
  version: number;
  name: string;
  memberConfigurationIds: string[];
  aggregationPolicy: "stratified_only";
  createdAt: number;
}
```

Rollups disclose every member and heterogeneity and are off by default. In this program `aggregationPolicy` is locked to `stratified_only`: the rollup page presents pinned member profiles and coverage side by side and never pools member observations into a synthetic respondent or headline estimate. They never overwrite exact profiles or claim one stable model version. Member or name changes append an immutable version through CAS; historical profile queries pin the exact rollup version/member list/policy in their query manifest. Any future pooled rollup policy requires a separate authorized statistical specification.

## 5. Evidence products

### 5.1 Coverage summary

Always report separate counts:

```text
unique Tasks
Task Versions
Task Instances
active Observations
all accepted candidate responses
all attempts
planned replicates
resolved independent uncertainty units + unit kind/assumption
comparability cohorts
Rubric versions
evaluator configurations
earliest/latest observation
```

Attempt count never appears as sample size.

### 5.2 Evidence-class and provenance summary

Show Exploratory, Comparable, Verified, and Benchmark anchor counts, eligible/provisional/excluded decisions, source split, version completeness, missing input/protocol limitations, and recency.

### 5.3 Family and facet evidence cards

Each Task Family/facet card shows:

- unique Task coverage and instance/observation counts;
- evidence-class mix;
- protocol/rubric cohort split;
- verified pass rate where deterministic verifier evidence exists;
- judged-quality estimate only inside a commensurate Rubric cohort;
- paired outcome/delta only against explicitly selected configurations on shared eligible Tasks;
- uncertainty or insufficient-coverage state;
- supporting, contradicting, mixed, and missing evidence;
- exact observation drilldown.

A family with heterogeneous Rubrics displays separate cohorts; it does not average them into one number.

### 5.4 Strongest, weakest, mixed, and missing areas

These labels are deterministic summaries and are available only when the exact verifier contract or Rubric Version defines a semantic supported/unsupported boundary before observing these results:

- **Strongest supported:** minimum five resolved independent uncertainty units, eligible interval entirely inside the declared supported region, and no undisclosed missingness.
- **Weakest supported:** minimum five resolved independent uncertainty units and eligible interval entirely inside the declared unsupported region.
- **Mixed:** interval crosses the semantic boundary, cohort disagreement, or material failure/score heterogeneity.
- **Descriptive only:** a normalized score exists but no pre-existing semantic boundary is authoritative.
- **Missing:** fewer than the minimum resolved independent units or no eligible evidence.

The exact verifier/Rubric boundary reference and version are displayed and encoded in the aggregation receipt. A raw 0–100 scale is not itself a threshold. No threshold is inferred from observed data or supplied post hoc to manufacture a label. No LLM invents these labels.

### 5.5 Deterministic narrative

An optional short overview may be generated from fixed templates over displayed facts. Every sentence links to the metric/filter that produced it. It cannot add causality, hidden trait inference, or new evaluation.

## 6. Aggregation rules

### 6.1 Observation selection

For one profile query:

1. resolve only decisions eligible for `within_model_profile`;
2. choose the active assessment per execution lineage/task/model cell;
3. group declared replicates inside Task Instance;
4. keep undeclared repeats visible but not labeled independent replicates;
5. preserve protocol/Rubric/evaluator cohort boundaries.

### 6.2 Hierarchical equal weighting

Default within a commensurate cohort:

```text
replicates → mean within Task Instance
instances → mean within Task Version
versions → separate by default; explicit Task rollup may average versions
tasks → equal weight inside Task Family
```

A Task Set’s custom weights apply only to that Evaluation Result, never to the global model profile.

### 6.3 Metric compatibility

- deterministic pass/fail may aggregate only across compatible verifier outcome definitions;
- judged final scores may aggregate only within declared commensurate Rubric/version mappings;
- raw criterion values remain available and map to facets only through authored versioned mappings;
- paired comparisons use shared Tasks and the same compatible assessment cohort;
- incompatible cohorts are adjacent views, never silent pooled inputs.

### 6.4 Uncertainty

A versioned pure uncertainty-unit resolver receives the query’s declared analysis/generalization context and canonical Task relations, source/repository grouping, family information, and frozen protocol metadata. It returns a stable cluster assignment, split reasons, unit kind/count, assignment digest, and limitation disclosures. Known dependency groups are resampled as clusters. If no higher-order dependency is encoded, Task identity is the explicit fallback assumption and the UI says so.

For at least five resolved resampling units in one cohort:

- compute a deterministic seeded cluster bootstrap interval by resampling those units;
- preserve nested Tasks/versions/instances/replicates inside each unit;
- default interval level is 95%;
- seed derives from query fingerprint, aggregation rule version, uncertainty rule version, and assignment digest;
- the same query/data/assignment yields identical output.

Below five resolved units, show **Insufficient independent coverage for an interval**. Do not render `±0`, fake confidence, or attempt-level standard error. The receipt always exposes the resampling unit, count, resolver version, assignment digest, and fallback assumption.

### 6.5 Paired model comparison

Comparison mode requires selected configuration(s). It uses only shared observations eligible for `paired_model_comparison`, computes Task-level paired deltas, reports wins/ties/losses and shared-task coverage, and bootstraps paired deltas with the same disclosed dependency-aware resampling units. It never compares unrelated task mixes or treats known related Tasks as independent.

## 7. Models workspace

Canonical routes:

```text
/models
/models/rollups/:rollupId/versions/:version
/models/:modelConfigurationId
/models/:modelConfigurationId/evidence/:observationId
```

`/models` lists exact configurations first and a clearly separate Saved rollups section. A rollup page enumerates its pinned version, exact members, heterogeneity, and stratified-only policy before member-specific evidence; it never presents a pooled synthetic respondent or masquerades as an exact model.

### 7.1 Models list

Rows/cards show:

- exact configuration label and provider;
- version completeness/rolling alias status;
- observation window;
- unique Task and eligible evidence counts;
- top covered families and major gaps;
- latest activity;
- no universal rank or score.

Filters include provider, model, version status, reasoning/tool signature, evidence class, family/facet, source, and recency.

### 7.2 Profile detail

Sections:

1. identity and scope;
2. coverage/evidence quality;
3. Task Family/facet evidence;
4. verified outcomes;
5. selected paired comparison;
6. recent/supporting/contradicting observations;
7. protocols, Rubrics, evaluators, and limitations.

Every headline is interactive and narrows the evidence table. The URL or query state preserves filters where practical.

### 7.3 Observation detail

Opens canonical Task/Version/Instance, outcome, assessment/verifier, eligibility reasons, source result, and exact Record. It does not duplicate full raw output when the Record already owns it.

## 8. Repository and computation

Add pure aggregation modules, a versioned rollup repository, and query repositories rather than storing mutable model score fields:

```text
queryModelConfigurations
createModelRollup / appendModelRollupVersion / archiveModelRollup
queryEligibleObservations
buildCoverageSummary
groupComparabilityCohorts
aggregateFamilyEvidence
bootstrapTaskClusters
computePairedEvidence
buildDeterministicNarrative
```

Canonical stores are `modelRollups` and `modelRollupVersions`; repository operations use runtime guards, CAS, immutable version append, deterministic pagination, in-memory parity, and enforce the program’s only allowed `stratified_only` aggregation policy.

A cache may store query fingerprint, source-evidence revision, aggregation-rule version, uncertainty-rule version, uncertainty-assignment digest, generated time, and result payload. Cache invalidation is deterministic when source observations/decisions change. Cache is never evidence authority.

All sorting/tie behavior is deterministic and permutation-invariant.

## 9. Migration and backfill

- build profiles only from child 04 Observations;
- old run-level model keys become partial/rolling configuration identities when exact version/settings are unavailable;
- never invent resolved versions, reasoning settings, tool signatures, or Task identity;
- imported/model alias collisions remain separate exact configurations unless an explicit rollup groups them;
- a profile with only Exploratory evidence exists as an honest empty/limited state, not a fabricated score;
- cache/rebuild is idempotent.

## 10. Claim and copy rules

Allowed examples:

- “Verified on 8 of 10 code-transformation Tasks under verifier cohort X.”
- “Won 6, tied 2, lost 4 against configuration Y on 12 shared eligible Tasks.”
- “Evidence is mixed across two Rubric cohorts; values are not pooled.”
- “Provider version was not reported for 14 observations from May–August.”

Forbidden examples:

- “Overall score: 78.”
- “Best model.”
- “87% good at coding” without task distribution/protocol/coverage.
- “n=74” when 74 is attempt count.
- “Reliable” when fewer than five resolved independent units, interval/coverage is missing, or no pre-existing semantic verifier/Rubric boundary exists.
- causal claims from observed traces or one workflow.

## 11. Responsive/accessibility/performance

- 390px uses stacked identity, filters, cards, and evidence rows; no desktop matrix squeezed into mobile.
- 200% zoom preserves all filters/actions and no element-level overflow.
- charts have textual/table equivalents and never encode state only by color.
- keyboard users can open every metric’s evidence, change filters, select comparator, and return focus.
- long model slugs/config signatures wrap or disclose safely.
- computed views show loading/progress/cancel for large local corpora and do not block streaming execution.
- virtualize/paginate evidence lists; cache pure aggregates; set performance budgets in implementation plan.

## 12. Archive compatibility

This child extends archive v2 with versioned `ModelRollupRecord` and `ModelRollupVersion` entities—including the locked `stratified_only` policy—plus any canonical rollup crosswalks. Profile query results and caches are omitted because they are reproducible from archived Observations, model configurations, Tasks, rule versions, and rollup versions. Earlier v2/v1 imports remain readable; non-identical rollup collisions abort before writes until child 09.

## 13. Non-goals

- universal score/evidence index or global leaderboard;
- IRT/Rasch/latent trait models;
- automatic taxonomy or criterion mapping;
- independent narrative evaluator;
- workflow configurations as respondents;
- remote/community profiles or cross-device sync;
- silent configuration/model-version rollups;
- changing source observations or evaluation results.

## 14. Implementation sequence

1. Implement exact model-configuration query/identity display and collision tests.
2. Implement pure observation selection, cohorting, and coverage summaries.
3. Implement hierarchical aggregation, the versioned uncertainty-unit resolver, and deterministic dependency-aware cluster bootstrap.
4. Implement paired comparison over shared Tasks.
5. Implement deterministic labels/narrative and prohibited-claim tests.
6. Add query cache/invalidation and performance fixtures.
7. Build Models list and profile/evidence routes.
8. Add filters, drilldown, unknown-version/heterogeneous-cohort/missing states.
9. Run statistical, permutation, migration, responsive, accessibility, and browser gates.

## 15. Validation plan

### Statistical/property tests

- equal Task weighting despite unequal attempt/instance counts;
- no retry or reused-output inflation;
- deterministic seed/output;
- permutation invariance;
- dependency-aware nested resampling, not attempt resampling;
- explicit Task-level fallback assumption when no higher-order dependency is encoded;
- no interval below five resolved independent units;
- paired results use intersection only;
- incompatible cohorts never pool;
- missing/failed cells stay visible;
- Task Set weights do not leak into profiles.

### Identity/migration

Exact, rolling-alias, partial, changed reasoning, changed tools, changed provider route, unknown version, explicit rollup, and ID collision fixtures.

### Claim snapshot tests

Forbidden phrases/scalars never appear; every generated statement has support/filter link and limitation disclosure.

### Component/browser

List/detail/filter/comparator/drilldown/direct-load/back-forward, empty/exploratory-only/small-n/mixed-cohort/unknown-version/large-corpus states at desktop/tablet/390px/200% zoom/keyboard/reduced motion. Check charts’ text alternatives and per-element overflow.

### Commands

```bash
npx vitest run src/lib/evidence src/lib/model-profiles src/workspaces/models
npm run typecheck:web
npm run check
```

## 16. Completion criteria

- Models workspace is powered only by qualified child 04 Observations;
- exact configuration and version uncertainty are visible;
- counts distinguish Tasks, versions, instances, observations, replicates, and attempts;
- metrics obey cohort and equal-Task rules with deterministic, dependency-aware uncertainty whose unit/count/rule/assignment/fallback are disclosed;
- paired claims use shared Tasks only;
- every claim drills to supporting/contradicting evidence and limitations;
- versioned named rollups persist exact member lists and `stratified_only` policy, disclose heterogeneity, never pool a synthetic respondent, and archive round-trip while profile result caches remain disposable;
- no universal score, global rank, silent pooling, or fabricated capability exists;
- all statistical, property, migration, component, responsive, accessibility, performance, and full gates pass.

## 17. Assumptions and unresolved implementation discoveries

**Locked assumptions:** normalized assessment outputs already provide a stable 0–100 task outcome inside their original Rubric cohort; cross-cohort pooling is prohibited unless an authored mapping explicitly establishes commensurability.

**No product decision remains unresolved.** If a metric cannot satisfy cohort, coverage, and provenance rules, the UI shows the evidence without that metric.
