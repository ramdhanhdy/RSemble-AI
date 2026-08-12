# Rubric Terminology and Compatibility Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, and `subagent-driven-development` before execution.

**Goal:** Replace scoring “Profiles” with canonical Rubrics across domain, routes, and UI without changing score behavior or breaking historical data.

**Architecture:** Introduce canonical Rubric names above frozen legacy storage/serialization boundaries. Preserve current repository/versioning behavior through adapters and explicit deprecated aliases. Rename UI/routes only after characterization tests pin compatibility.

**Tech stack:** TypeScript, React, React Router, Dexie, Vitest, happy-dom, Vite.

**Specification:** [`rubric-terminology-spec.md`](./rubric-terminology-spec.md)
**Parent:** [`../../pending/task-first-evidence-workbench/task-first-evidence-workbench-spec.md`](../../pending/task-first-evidence-workbench/task-first-evidence-workbench-spec.md)
**Execution authorization:** This plan does not authorize implementation, commits, or pushes. Obtain explicit user approval. Local commits only when approved; never push unless separately requested.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Drift/inventory and terminology contract | Characterization tests green; new guard test red |
| B | Canonical Rubric domain/repository API | Existing data round-trips unchanged |
| C | Routes and UI use Rubric language | Legacy direct links pass |
| D | Optional mapping seam, docs, browser QA | `npm run check` and viewport matrix green |

## Task 0: Drift and baseline gate

**Files:** Read parent/spec, `src/lib/evaluations/evaluation-types.ts`, `evaluation-profile.ts`, `src/lib/persistence/evaluation-repository.ts`, route/UI files, archive tests.

1. Run `git status --short --branch` and record HEAD.
2. Run `sha256sum` on parent and this specification; save values in the implementation session notes.
3. Verify children 02–09 have not already introduced conflicting Profile/Model Profile names.
4. Run current profile/evaluation tests and `npm run typecheck:web`.
5. **STOP** on parent/spec drift, unexplained baseline failure, or overlapping dirty files.

Expected baseline: existing tests pass or any pre-existing failure is proven on untouched HEAD and recorded.

## Task 1: Create a scoring-terminology inventory guard

**Objective:** Make ambiguous/new scoring `Profile` usage fail before renaming implementation.

**Files:**
- Create: `src/lib/evaluations/rubric-terminology.test.ts`
- Read: `src/**/*.ts`, `src/**/*.tsx`

**RED:** Add a test/script fixture that inventories user-facing scoring strings and new-domain identifiers, with an explicit allowlist for frozen fields (`evaluationProfileId`, physical stores, migration adapters). Assert zero non-allowlisted scoring Profile terms.

Run:

```bash
npx vitest run src/lib/evaluations/rubric-terminology.test.ts
```

Expected: FAIL listing current surfaces.

**GREEN:** No production rename yet; commit the failing guard as `test(evaluations): define rubric terminology boundary` when authorized.

## Task 2: Add canonical Rubric types and validators

**Files:**
- Modify: `src/lib/evaluations/evaluation-types.ts`
- Move/modify: `src/lib/evaluations/evaluation-profile.ts` → `src/lib/evaluations/evaluation-rubric.ts`
- Create: `src/lib/evaluations/rubric-compat.ts`
- Move/update sibling tests.

**RED:** Tests import `EvaluationRubric`, `RubricRecord`, `RubricVersionRef`, and canonical score helpers; assert frozen serialized objects remain deep-equal.

**GREEN:** Add canonical names, move pure scoring helpers, and confine deprecated aliases to `rubric-compat.ts`. Do not alter scoring formulas, winner epsilon, criteria validation, or serialized field names.

Run targeted tests and `npm run typecheck:web`.

Commit: `refactor(evaluations): introduce canonical rubric domain names`.

## Task 3: Add canonical repository API

**Files:**
- Modify: `src/lib/persistence/evaluation-repository.ts` (including its exported in-memory implementation and contract parity)
- Update repository tests.

**RED:** Port repository contract tests to `listRubrics`, `getRubricRecord`, `createRubric`, `appendRubricVersion`, archive/restore/duplicate. Assert first-version, CAS, immutable history, and old rows.

**GREEN:** Implement canonical methods over existing `profiles`/`profileVersions` tables. Keep deprecated old methods only in adapter surface and prevent new imports.

Run repository tests twice against clean and seeded legacy DB fixtures.

Commit: `refactor(storage): expose rubric repository API`.

## Task 4: Rename routes with compatibility redirects

**Files:**
- Modify: `src/app-router.tsx`
- Modify/create route tests near `src/app-router*.test.tsx`
- Rename route components as needed.

**RED:** Add direct-load/refresh/back-forward tests for canonical Rubric routes and redirects from the existing `/evaluations/profiles` and `/evaluations/profiles/:id` routes, preserving entity and any version/return state. Assert `/profiles/*` is not added as an invented legacy alias.

**GREEN:** Add canonical routes and compatibility redirects. Do not remove legacy route tests.

Run targeted router tests.

Commit: `feat(evaluations): route scoring rubrics canonically`.

## Task 5: Rename Rubric list/detail/reference components

**Files:**
- Move: `ProfileList.tsx` → `RubricList.tsx`
- Move: `ProfileDetail.tsx` → `RubricDetail.tsx`
- Move: `ProfileRefChip.tsx` → `RubricRefChip.tsx`
- Move/update corresponding tests.
- Modify: `EvaluationsWorkspace.tsx`.

**RED:** Update component tests first for Rubric headings/actions, historical read-only versions, dirty/saved state, archive flows, keyboard/focus, and missing legacy refs.

**GREEN:** Rename components and visible copy. Preserve existing harness and behavior. Avoid nested links in record rows.

Commit: `feat(evaluations): rename scoring profile surfaces to rubrics`.

## Task 6: Migrate cross-surface copy and imports

**Files:**
- Modify Compare Rubric selectors/output provenance.
- Modify Task Set/Suite editor and result components.
- Modify Run/Records detail, command palette, export labels, errors, and tests.

**RED:** Add focused tests for each cross-surface label/reference before changes.

**GREEN:** Replace scoring terminology and canonical imports. Keep historical/frozen field labels only where exposing exact serialized provenance is necessary; label them as legacy storage fields, not user concepts.

Run the terminology guard; expected failures should shrink to zero.

Commit in bounded groups if needed: `refactor(compare): use rubric terminology`, `refactor(evaluations): use rubric references`, `refactor(records): label rubric provenance`.

## Task 7: Add optional criterion-to-facet mapping seam

**Files:**
- Modify canonical Rubric types/validators/editor.
- Add unit/component tests.

**RED:** Test valid mappings and rejection of missing criterion/facet, duplicates, prohibited keys, and secret-shaped values. Test score output unchanged with/without mappings.

**GREEN:** Add optional metadata and a compact disclosed editor. No inference or profile aggregation.

Commit: `feat(rubrics): add authored facet mapping metadata`.

## Task 8: Authority, QA, and completion gate

**Files:**
- Modify `PRODUCT.md`, `DECISIONS.md`, `CLAUDE.md` only to describe shipped Rubric terminology.
- Add/update QA evidence directory chosen at execution time.

1. Re-run terminology guard with an allowlist review.
2. Run:

```bash
npx vitest run src/lib/evaluations src/lib/persistence src/workspaces/evaluations src/ui
npm run typecheck:web
npm run check
```

3. Browser-test create/edit/version/archive/restore and all legacy redirects at 1440/1024/768/390, 200% zoom, keyboard-only, reduced motion.
4. Probe per-element overflow and secret-shaped page text.
5. Update the program matrix only after all gates pass.
6. Commit docs/QA separately or with final implementation milestone according to approved workflow.

**STOP conditions:** score math diff, archive incompatibility, failed legacy route, user-visible scoring Profile outside allowlist, or model profile UI introduced early.

## Done definition

All child specification completion criteria pass; current data is unchanged; canonical Rubric API/UI/routes ship; full gate and browser evidence are green; no push occurs.
