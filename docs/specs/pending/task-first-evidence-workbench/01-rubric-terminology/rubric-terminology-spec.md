# Rubric Terminology and Compatibility Specification

**Status:** Shipped (2026-08-12)
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 01
**Dependencies:** Parent only

---

## 1. User outcome

The scoring objects currently called **Profiles** become **Rubrics** everywhere a user sees or creates them and everywhere new domain code reasons about them. Existing databases, run records, experiment snapshots, archives, and deep links remain readable.

This child deliberately lands before model evidence profiles so **profile** has one future product meaning: a model evidence profile.

## 2. Current foundation

The current application already provides:

- immutable scoring-profile versions in `src/lib/evaluations/evaluation-types.ts`;
- repository CRUD/versioning in `src/lib/persistence/evaluation-repository.ts`;
- `ProfileList.tsx`, `ProfileDetail.tsx`, `ProfileRefChip.tsx`, and evaluation routes;
- suites pinned to exact profile versions;
- profile snapshots in run and experiment provenance;
- runtime guards, archives, tests, and archived UX specs.

The implementation is a terminology/domain migration, not a rewrite of criteria math or judge behavior.

## 3. Scope

### 3.1 User-facing rename

Replace scoring uses of:

```text
Profile / Profiles / profile version
```

with:

```text
Rubric / Rubrics / rubric version
```

Affected surfaces include:

- Evaluations secondary navigation;
- list/detail/create/duplicate/archive/restore flows;
- Task Set settings and selected-rubric references;
- Compare rubric selection and persisted-result labels;
- evaluation result headers and provenance;
- Records detail/filter copy;
- command palette actions;
- validation/errors, empty states, tooltips, export descriptions, and tests.

### 3.2 Canonical domain names

Introduce canonical names:

```ts
EvaluationRubric
RubricRecord
RubricVersionRef
RubricSnapshot
RubricRepository
```

New feature code imports canonical names. Legacy names may exist only in explicit compatibility modules or deprecated type aliases with removal notes.

### 3.3 Physical and frozen compatibility

The following may keep legacy field/store names because changing them would create avoidable migration risk:

- IndexedDB stores `profiles` and `profileVersions`;
- frozen `RunRecordV2` and historical `ExperimentRecord` fields such as `evaluationProfileId`;
- v1 archive payload fields named `profiles`;
- historical spec and decision text quoted for provenance.

Adapters expose canonical Rubric language above those boundaries. Comments must say why the legacy identifier remains.

## 4. Routes

Canonical routes:

```text
/evaluations/rubrics
/evaluations/rubrics/:rubricId
/evaluations/rubrics/:rubricId/versions/:version
```

Compatibility:

- Existing `/evaluations/profiles` and `/evaluations/profiles/:profileId` links redirect to canonical Rubric routes without losing the entity or return location.
- Historical version state already encoded in route/query/location state is preserved through the redirect adapter.
- No new `/profiles/*` alias is invented, because it is not present in the production baseline.
- Direct load, refresh, browser back/forward, and hash-router URLs are covered by tests.

## 5. Repository and schema behavior

### 5.1 Repository surface

Canonical repository methods are:

```ts
listRubrics
getRubricRecord
getRubricVersion
createRubric
appendRubricVersion
archiveRubric
restoreRubric
duplicateRubric
```

They retain current compare-and-swap, immutable-version, criteria validation, and archive-state behavior.

A temporary adapter may implement these over current `EvaluationRepository` storage. New consumers must not call `createProfile` or `appendProfileVersion` directly.

### 5.2 Validation

All existing invariants remain:

- first version is exactly `1`;
- at least one criterion has positive weight;
- graded criteria retain 1/3/5 anchors;
- binary requirement groups resolve and satisfy existing weighting constraints;
- old and new runtime forms load safely;
- rubric version references are immutable after an execution begins.

### 5.3 Criterion-to-facet mapping seam

Add only the optional, versioned seam required by the parent:

```ts
interface CriterionFacetMapping {
  criterionId: string;
  facetId: string;
  mappingKind: "direct" | "supporting";
  source: "authored" | "imported";
}
```

This field may remain empty. It does not infer mappings, change score math, or authorize model-profile aggregation. Child 06 decides how authored mappings are consumed.

## 6. UI behavior

### 6.1 Rubric list

- Heading and actions use Rubric language.
- Rows preserve name, latest version, criterion count, updated time, and archive state.
- Duplicate/Archive/Restore remain real controls with current confirmation and focus behavior.
- Empty copy explains that Rubrics define how candidate work is assessed.

### 6.2 Rubric detail

- Latest version remains editable only through creating a new immutable version.
- Historical versions remain read-only and labeled clearly.
- Dirty/saved state remains distinct.
- Save validation remains test-before-save where provider testing is relevant; this child does not change provider behavior.
- Optional facet mapping is disclosed as evidence metadata, not required scoring configuration.

### 6.3 References

Every reference chip or provenance row says `Rubric vN`. A missing legacy object displays a bounded compatibility warning and preserves the stored ID rather than showing an invented name.

## 7. Migration and compatibility

- No destructive IndexedDB table migration is required in this child.
- Existing objects load through canonical adapters without data copies.
- Legacy imports remain accepted.
- Existing exports retain their current schema in this child; child 02 introduces the extensible archive v2 envelope with canonical `rubrics` entities, and import continues to read v1 `profiles`.
- Current run and experiment payloads are never rewritten.
- A read-time adapter can derive `RubricVersionRef` from frozen `evaluationProfile*` fields.

## 8. Non-goals

- model evidence profiles or Models navigation;
- scoring-math changes;
- automatic criterion-to-facet inference;
- archive schema v2;
- Task Set or canonical Task migration;
- provider/model changes;
- deletion or retention policy.

## 9. Implementation sequence

1. Add canonical Rubric types and compatibility aliases.
2. Add canonical repository adapter/API with characterization tests.
3. Rename domain modules and pure helpers where no frozen identifier requires compatibility.
4. Rename routes with explicit legacy redirects.
5. Rename list/detail/reference UI and accessible copy.
6. Update Compare, Evaluations, Results, Records, and command-palette references.
7. Add optional criterion-facet mapping validation without consuming it analytically.
8. Reconcile source comments and current-state authority documentation.
9. Run targeted, full, and browser gates.

## 10. Validation plan

### Unit/domain

- canonical validators accept every current valid scoring object;
- invalid criteria/anchors/groups still fail with equivalent semantics;
- facet mappings reject missing criteria, missing facet IDs, duplicates, and prohibited secret-shaped values;
- deprecated aliases serialize identically at frozen boundaries.

### Repository/migration

- existing IndexedDB profile rows list as Rubrics;
- create/version/archive/restore/duplicate behavior is unchanged;
- stale revisions still fail;
- old archives import;
- no data is copied or duplicated on repeated startup.

### Component/route

- all visible scoring-object copy uses Rubric language;
- `/evaluations/profiles/:id` preserves entity and any existing version/return state; no unsupported `/profiles/*` alias is introduced;
- historical versions are read-only;
- dirty/saved state and validation are unchanged;
- no scoring use of `Profile` remains outside compatibility/provenance allowlists.

### Browser

Verify list/detail/create/edit/archive/restore/redirect flows at desktop, tablet, 390px, 200% zoom, keyboard-only, and reduced motion. Confirm no overflow and no credential-shaped text.

### Commands

```bash
npx vitest run src/lib/evaluations src/lib/persistence src/workspaces/evaluations src/ui
npm run typecheck:web
npm run check
```

## 11. Completion criteria

- every user-facing scoring object is a Rubric;
- all new domain/repository consumers use canonical Rubric names;
- legacy stores, payloads, archives, and routes remain readable;
- no Models workspace or model profile terminology ships early;
- score math, recovery, and exact provenance are unchanged;
- targeted and full gates pass;
- authority docs describe Rubrics as shipped while preserving historical decisions.

## 12. Assumptions and unresolved implementation discoveries

**Locked assumption:** physical legacy store and frozen field names remain implementation details until a future archive/storage migration proves a benefit.

**No product decision remains unresolved.** If a dynamic user-facing Profile string cannot be classified as scoring versus model evidence, implementation stops and updates the terminology inventory rather than guessing.
