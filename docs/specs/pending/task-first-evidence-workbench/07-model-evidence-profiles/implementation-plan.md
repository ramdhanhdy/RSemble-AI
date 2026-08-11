# Qualified Model Evidence Profiles Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, `statistical-data-visualization`, and `subagent-driven-development` before execution.

**Goal:** Build Models list/detail evidence views for exact configurations using task-weighted, cohort-qualified metrics and deterministic uncertainty, with no universal score.

**Architecture:** Keep profiles as pure reproducible queries over child-04 Observations. Implement selection, cohorting, hierarchical aggregation, task-cluster bootstrap, paired shared-task comparison, and deterministic narrative as testable pure modules. Add cache only after a measured need.

**Tech stack:** TypeScript, React, React Router, Vitest/property tests, happy-dom, optional Web Worker for measured heavy local computation.

**Specification:** [`model-evidence-profiles-spec.md`](./model-evidence-profiles-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Query/identity/coverage | Golden fixtures green |
| B | Honest metrics/uncertainty | Property/permutation tests green |
| C | Models UI/drilldown | Claim/link/accessibility tests green |
| D | Performance/browser/full gate | Budgets measured and full gate green |

## Task 0: Dependency/drift and statistical fixture gate

Verify children 04/05 complete. Record state/hashes. Read observation/model config schemas, current aggregation/ranking, Rubric normalization, Task families/facets, query patterns, design components.

Create a reviewed golden corpus spanning retries, unequal attempts, versions, instances, missing cells, mixed cohorts, verified outcomes, unknown versions, declared dependency clusters, and no-cluster-metadata Task fallback. **STOP** if current normalized outcomes cannot support the specification’s within-cohort semantics or Task relations/protocol provenance cannot produce a reproducible disclosed uncertainty assignment.

## Task 1: Define profile query and canonical fingerprint

**Files:**
- Create `src/lib/model-profiles/model-evidence-query.ts` + tests

**RED:** Discriminated exact-configuration/pinned-rollup respondent union with no nullable ambiguity; rollup version resolves immutable member manifest and `stratified_only` policy; full filter schema, canonical order/permutation, default evidence uses/classes, date windows, unknown-version flag, eligibility/aggregation/uncertainty rule versions, prohibited fields.

**GREEN:** Implement validator/serializer/fingerprint, immutable rollup-manifest resolver, and URL-state adapter.

Commit: `feat(models): define reproducible evidence queries`.

## Task 2: Build exact configuration catalog summaries

**Files:**
- Create `src/lib/model-profiles/model-configuration-query.ts` + tests

**RED:** exact/rolling/partial identities, changed reasoning/tools/provider route, observation windows, explicit rollup members, deterministic sort, no implicit merge.

**GREEN:** Query child-04 repository and produce safe list summaries.

Commit: `feat(models): query exact model configurations`.

## Task 3: Implement active observation selection and coverage

**Files:**
- Create `src/lib/model-profiles/profile-observation-selection.ts` + tests
- Create `coverage-summary.ts` + tests

**RED:** one active assessment per lineage cell, eligibility/use filters, retry/reuse behavior, declared/undeclared repeats, separate Task/version/instance/observation/replicate/attempt counts, recency/cohort/Rubric/evaluator counts.

**GREEN:** Implement pure selectors; never mutate source.

Commit: `feat(models): summarize profile coverage honestly`.

## Task 4: Implement hierarchical aggregation

**Files:**
- Create `src/lib/model-profiles/family-aggregation.ts` + property tests

**RED:** replicates→instance→version→Task hierarchy; equal Task weights; versions separate by default; Task Set weights ignored; verifier outcomes only compatible; judged scores only commensurate cohort; deterministic ordering/ties.

**GREEN:** Implement pure per-cohort aggregates and explicit non-aggregatable states.

Commit: `feat(models): aggregate evidence by task`.

## Task 5: Resolve uncertainty units and implement deterministic cluster bootstrap

**Files:**
- Create `src/lib/model-profiles/uncertainty-unit-resolver.ts` + table/golden tests.
- Create `src/lib/model-profiles/cluster-bootstrap.ts` + property/golden tests.

**RED:** Declared protocol cluster, repository/source group, typed Task relation, no-higher-order-metadata Task fallback with disclosure, assignment digest/rule version, conflicting/missing metadata, fewer than five resolved units, deterministic seed, permutation invariance, nested values, constant/extreme/empty data, stable 95% bounds.

**GREEN:** Implement pure versioned assignment and PRNG/resampling APIs. Resample resolved units, never attempts. Persist no mutable score or assignment; pin rule/digest in the result receipt. Avoid blocking the main thread in tests/production integration.

Commit: `feat(models): estimate task-cluster uncertainty`.

## Task 6: Implement paired shared-task comparisons

**Files:**
- Create `src/lib/model-profiles/paired-comparison.ts` + tests

**RED:** intersection only, compatible cohorts only, wins/ties/losses, epsilon/tie rule, paired Task deltas, missing cells, no shared Tasks, dependency-aware bootstrap assignment, changed task versions, known-related Tasks not treated as independent.

**GREEN:** Implement pure paired analysis; disclose shared coverage.

Commit: `feat(models): compare configurations on shared tasks`.

## Task 7: Implement deterministic labels and narrative

**Files:**
- Create `src/lib/model-profiles/profile-claims.ts` + snapshot/forbidden-copy tests

**RED:** strongest/weakest/mixed/descriptive-only/missing thresholds by resolved independent units; exact pre-existing verifier/Rubric semantic boundary refs; raw 0–100 without boundary; reject post-hoc/data-derived threshold; small-n, cohort disagreement, verified failures, support/limitation refs. Assert forbidden universal phrases/scalars never occur and every sentence has a source metric key.

**GREEN:** Fixed templates only; no model call.

Commit: `feat(models): generate evidence-grounded summaries`.

## Task 8: Add optional cache after benchmark

First benchmark uncached query over required fixture sizes. If within budget, do not add persistent cache. If not:

- create versioned disposable cache keyed query fingerprint + source revision + aggregation rule;
- add invalidation/idempotency tests;
- use Worker for compute if main-thread budget exceeded.

Commit only if measured: `perf(models): cache evidence profile queries`.

## Task 9: Build Models list route

**Files:**
- Create `src/workspaces/models/ModelsWorkspace.tsx`, `ModelList.tsx`, filters, tests
- Modify `src/app-router.tsx` (route only; primary nav waits child 07).

**RED:** list identity/version window/coverage/families/gaps/latest, filters/pagination/empty/exploratory-only/error/direct route, no score/rank.

**GREEN:** Implement functional `/models` without primary-nav exposure until child 07.

Commit: `feat(models): browse evidence configurations`.

## Task 10: Build profile/evidence routes

**Files:**
- Create `ModelEvidenceProfile.tsx`, family cards, coverage/provenance sections, evidence table, observation route adapters, tests.

**RED:** all required sections/states, metric click filters evidence, supporting/contradicting drilldown, mixed cohorts separate, comparator selection, unknown version, query URL state, exact Task/Record links.

**GREEN:** Accessible textual first; charts only with equivalent tables/labels.

Commit: `feat(models): inspect qualified evidence profiles`.

## Task 11: Persist versioned rollups and extend archive v2

**Files:**
- Add `modelRollups` and `modelRollupVersions` stores using the next Dexie version.
- Create `src/lib/persistence/model-rollup-repository.ts` plus contract/in-memory parity tests.
- Extend archive v2 validators/export/import.
- Add Models UI create/edit/archive/member-disclosure flows, canonical `/models/rollups/:rollupId/versions/:version` routing, direct-load/refresh tests, and exact-vs-rollup visual distinction tests.

**RED:** Create+v1, `stratified_only` as sole accepted policy, reject pooled/synthetic policy, CAS revision, exact member validation, archive/restore, historical query pins member revision/policy, changed/unknown member, canonical rollup-route precedence over dynamic exact-configuration route, direct load/refresh/back-forward, clean/earlier-v2/v1 round trip, cache omission, collision abort before writes, prohibited content.

**GREEN:** Persist only rollup definitions/revisions; profile results and caches stay derived. Commit: `feat(models): persist explicit evidence rollups`.

## Task 12: Statistical review and invariant audit

Run golden/property tests under multiple input permutations. Independently review:

- task weighting and nested repeats;
- cohort split keys;
- resampling unit selection, dependency assignments, and Task fallback disclosure;
- bootstrap unit/seed/rule/assignment digest;
- paired intersection;
- claim thresholds/copy;
- unknown-version handling;
- absence of global score/index.

Fix only with failing tests and bump aggregation rule version for semantic changes.

## Task 13: Full performance/browser/authority gate

Run:

```bash
npx vitest run src/lib/evidence src/lib/model-profiles src/workspaces/models
npm run typecheck:web
npm run check
```

Measure required corpus sizes and record environment/results. Browser-test exact/rolling/small-n/mixed/verified/paired/large states at all viewports, 200%, keyboard, reduced motion; validate chart alternatives, focus, overflow, secrets, and no universal claim.

Update authority docs to describe Models as implemented but do not switch primary nav until child 07.

**STOP:** attempt-weighted interval, known-dependent Tasks resampled independently, undisclosed Task-level fallback, incompatible pooling, pooled Model Rollup respondent, unrelated-task comparison, universal score/rank, model-generated evidence, invented version, or unmeasured blocking computation.

## Done definition

Exact configuration profiles are reproducible, cohort-qualified, dependency-aware and uncertainty-aware, drillable, performant, and free of prohibited claims; Model Rollups remain stratified member views; all gates green; no push.
