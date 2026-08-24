# Task Sets and Context-Owned Evaluation Results Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, and `subagent-driven-development` before execution.

**Goal:** Convert Suites into versioned Task Sets referencing canonical Task Versions while preserving all current ordinary evaluation execution, Fusion Study, recovery, result, route, and roster-extension behavior.

**Architecture:** Add canonical Task Set record/version adapters and migrate legacy Suite/snapshot definitions through child 02 crosswalks. Materialize every ordinary execution snapshot before provider calls. Reuse the current Experiment controller, unit-of-work, result matrix, repair, and extension foundations rather than rewriting them. Keep `FusionStudyRepository`, controller/orchestration, and entity payloads authoritative; adapt only exact Suite→Task Set ownership coordinates and routes.

**Tech stack:** TypeScript, React, React Router, Dexie, Vitest, happy-dom, current execution controller/lease/worker architecture.

**Specification:** [`task-sets-and-evaluations-spec.md`](./task-sets-and-evaluations-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Canonical Task Set domain/repository | Manifest/version tests green |
| B | Legacy migration/materialization | Source snapshots unchanged; idempotent |
| C | Editor/routes use Tasks/Rubrics | Direct-link and dirty-run tests green |
| D | Execution/results regression | Repair/recovery/extension/full gate green |

## Task 0: Dependency and drift gate

1. Verify children 01 and 02 are complete/archived and their completion gates green.
2. Record branch/HEAD/worktree and parent/spec hashes.
3. Read current suite types/repository/editor/list; ExperimentRecord/controller/engine/unit-of-work/results/matrix/progress/history; roster extension/repair; `fusion-study-types.ts`, `fusion-study-repository.ts`, Fusion controller/orchestration/panels/routes; and route tests.
4. Run current evaluation/reliability suites and `npm run typecheck:web`.
5. **STOP** if Rubric/Task canonical APIs differ from parent, current reliability tests fail, or dirty overlaps exist.

## Task 1: Define Task Set domain and compatibility adapters

**Files:**
- Create `src/lib/evaluations/task-set-types.ts`
- Create `src/lib/evaluations/task-set-validation.test.ts`
- Create `src/lib/evaluations/suite-compat.ts`

**RED:** Validate TaskSetRecord, immutable TaskSetVersion, members, roles/strata/weights, Rubric refs, roster/judge/repeat/missingness/protocol defaults, and malformed/unresolved refs. Assert legacy Suite adapters preserve current semantics.

**GREEN:** Implement canonical types/guards and isolated deprecated Suite adapter.

Commit: `feat(evaluations): define versioned task sets`.

## Task 2: Implement manifest materialization and fingerprints

**Files:**
- Create `src/lib/evaluations/workload-manifest.ts` + test
- Modify protocol fingerprint only through compatibility extension if required.

**RED:** Exact Task/Rubric resolution, deterministic member order, immutable snapshot, archived refs, unresolved refs, dirty draft rejection, fingerprint permutation/semantic tests.

**GREEN:** Materialize complete execution snapshot and protocol input without mutating catalog entities. Reuse existing canonical serializer/fingerprint conventions.

Commit: `feat(evaluations): materialize task set workloads`.

## Task 3: Add Task Set repository/versioning

**Files:**
- Modify `src/lib/persistence/database.ts` with next schema version
- Create `src/lib/persistence/task-set-repository.ts` + contract tests
- Add in-memory parity
- Wire repository contexts.

**RED:** Atomic create+v1, append CAS, archive/restore, list/query, materialize, version history, stale revisions, unresolved members, deterministic pagination.

**GREEN:** Implement stores/repository. Do not remove old suite tables before migration/compatibility proof.

Commit: `feat(storage): persist task set versions`.

## Task 4: Reconstruct legacy Task Set versions

**Files:**
- Create `src/lib/persistence/task-set-migration.ts` + tests

**RED:** Fixtures for changed/unchanged suites, historical Experiment snapshots, latest unexecuted edits, legacy Profile refs, identical manifests, roster extensions, incomplete/interrupted executions, all seven Fusion Study stores/claim levels, unresolved Fusion owner coordinates, partial migration, unresolved child-02 crosswalk.

**GREEN:** Create TaskSetRecord/versions and crosswalks; map every Experiment and Fusion Study to the exact version; preserve all source snapshots and Fusion entity payloads; marker only after verification.

Commit: `feat(storage): migrate suites to task sets`.

## Task 5: Rename list/editor/routes to Task Sets

**Files:**
- Move `SuiteList.tsx` → `TaskSetList.tsx` and tests
- Move `SuiteEditor.tsx` → `TaskSetEditor.tsx` and tests
- Rename subordinate Suite components where user/domain-facing
- Modify `EvaluationsWorkspace.tsx`, `src/app-router.tsx`, route tests.

**RED:** Task Set copy, canonical routes, old `/evaluations/:suiteId` and `/evaluations/:suiteId/fusion/:studyId` redirects, historical version read-only, create/duplicate/archive, direct-load/back-forward, unresolved Fusion owner fallback.

**GREEN:** Rename/refactor while preserving UI identity and current responsive layout.

Commit: `feat(evaluations): present suites as task sets`.

## Task 6: Replace embedded editing with canonical Task selectors

**Files:**
- Replace `SuiteTaskList`/task editor seams with TaskSet member list/selector components.
- Add tests under `src/workspaces/evaluations/`.

**RED:** Add latest/older Task Version, pin visible, reorder keyboard controls, role/stratum/weight/override, open Task detail, archived ref warning, no canonical Task mutation.

**GREEN:** Save refs only. Editing a Task navigates to Task owner. No drag-only operation.

Commit: `feat(evaluations): compose task sets from canonical tasks`.

## Task 7: Enforce save-versus-run boundary

**Files:**
- Modify TaskSetEditor/run command and tests.

**RED:** Dirty manifest Run prompts Save new version or Discard draft; cancellation makes no provider call; stale CAS blocks run; resolved snapshot persists before lease/provider call.

**GREEN:** Implement explicit flow and atomic preflight/materialization.

Commit: `fix(evaluations): pin workload before execution`.

## Task 8: Adapt Experiment creation/controller to Task Set snapshots

**Files:**
- Modify experiment creation/types/adapters/controller at exact current seams.
- Update all `ExperimentController` test doubles with full interface.

**RED:** Characterization tests prove task inputs, roster, judge/Rubric, fingerprint, source refs, unit-of-work, and snapshot-derived execution are unchanged.

**GREEN:** Resolve canonical manifest then feed current engine through adapter. Do not route stream bytes or mutate state outside existing owner.

Commit: `refactor(evaluations): execute frozen task set manifests`.

## Task 9: Recompose progress/results/history identity

**Files:**
- Rename/adapt `SuiteExperimentHistory`, `ExperimentRoute`, `ExperimentProgress`, `ExperimentResults`, result/mobile/matrix components and tests.
- Adapt `FusionStudyPanel.tsx`, `FusionStudyView.tsx`, `src/app-router.tsx`, and repository owner resolution without rewriting Fusion domain/controller payloads.

**RED:** Task Set/version/Rubric identity, owner backlinks, exact cell links, complete/provisional standings, partial/error states, history status/cost/coverage, old `/experiments/:id` redirects; plus Fusion canonical/legacy route parity, exact study owner/version, recipes/pools/trials/attempts/experimental observations/playbooks unchanged, and unresolved-owner read-only behavior.

**GREEN:** Change identity/copy/routes only; retain aggregation and matrix semantics.

Commit: `feat(evaluations): own results under task sets`.

## Task 10: Prove recovery and roster extension unchanged

Run/extend targeted RED characterization before any necessary adapter fix:

- missing-cell repair and full retry;
- interruption/startup recovery;
- cross-tab lease/Worker heartbeat;
- unit-of-work fencing/CAS;
- roster extension duplicate rejection;
- reusable output seeding + fresh judge;
- full-roster fallback;
- append-only extension history/prior fingerprint;
- optional sync creates a new Task Set Version independently.

Any implementation change requires a failing regression first. Commit bounded fixes only.

## Task 11: Extend archive v2 and update authority

Extend child-02 archive v2 validators/export/import with Task Set records/versions, workload manifests, Suite crosswalks, canonical Experiment links, and exact Fusion Study owner crosswalks. Preserve all seven separately typed Fusion collections from child 02. Add clean round-trip, earlier-v2-without-new-collections, v1 import, prohibited content, collision-abort-before-write, and semantic source-preservation tests.

Then update `PRODUCT.md`, `DECISIONS.md`, `CLAUDE.md`, and source comments only to shipped Task Set ownership.

## Task 12: Full QA gate

Run:

```bash
npx vitest run src/lib/evaluations src/lib/persistence src/workspaces/evaluations
npm run qa:suite-reliability
npm run qa:evaluations-identity
npm run typecheck:web
npm run check
```

Browser matrix: create/version/select tasks/run/progress/result/history/recover/repair/add model/Fusion Study canonical+legacy deep links/exact record at 1440/1024/768/390, 200%, keyboard, reduced motion, large task set, incomplete/migration/Fusion-owner error. Probe real table semantics and element overflow.

**STOP conditions:** snapshot mutation, latest-Task substitution, provider call before durable materialization, controller reliability regression, lost roster-extension provenance, suite migration auto-merge, changed Fusion entity semantics, broken Fusion deep links, or any conversion of experimental `FusionObservation` into canonical Task Observation.

## Done definition

Every Task Set references exact canonical versions; ordinary execution snapshots/results and existing Fusion Studies are exact and owner-contextual; all current reliability/extension/Fusion behavior passes; legacy routes/data work; no push.
