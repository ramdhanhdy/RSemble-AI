# Canonical Tasks Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, and `subagent-driven-development` before execution.

**Goal:** Add global canonical Tasks with immutable versions, concrete instances, explicit families/facets, and conservative legacy-suite migration.

**Architecture:** Add runtime-validated Task domain modules and a Dexie repository beside existing run/evaluation storage. Migrate embedded suite tasks through deterministic namespaced crosswalks without modifying source snapshots. Expose a secondary Task catalog/detail route, not a primary workspace.

**Tech stack:** TypeScript, React, React Router, Dexie, Vitest, happy-dom, Web Crypto digest helpers already approved by the repo.

**Specification:** [`canonical-tasks-spec.md`](./canonical-tasks-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Domain identity/versioning | Property/runtime tests green |
| B | Durable repository/instances | Clean/legacy DB tests green |
| C | Conservative migration | Idempotency/crosswalk fixtures green |
| D | Functional Task UI/routes | Responsive/a11y/browser gates green |

## Task 0: Drift, baseline, and schema gate

1. Verify child 01 is complete/archived and canonical Rubric adapters plus its green gate are present.
2. Record branch/HEAD/worktree and parent/spec hashes.
3. Read current `database.ts`, repository providers, Suite/Experiment types, migration tests, ID/digest utilities, archive code, and current Task-related components.
4. Run current persistence/evaluation tests and `npm run typecheck:web`.
5. Determine the next Dexie version from live code; do not hardcode a stale number.
6. **STOP** on dirty overlap, baseline failures not proven pre-existing, parent drift, or already-landed canonical Task schema.

## Task 1: Define Task domain and runtime validators

**Files:**
- Create `src/lib/tasks/task-types.ts`
- Create `src/lib/tasks/task-validation.ts`
- Create `src/lib/tasks/task-validation.test.ts`

**RED:** Tests cover TaskRecord, immutable TaskVersion, TaskArtifact, TaskInstance completeness, TaskFamily, family assignment, facet taxonomy/annotation, version refs, prohibited keys, secret-shaped indexed/artifact metadata, and malformed imports.

**GREEN:** Implement exact specification interfaces/guards. Reuse project validation idioms; no unchecked casts at persistence boundary.

Commit: `feat(tasks): define canonical task domain`.

## Task 2: Implement pure versioning and instance identity rules

**Files:**
- Create `src/lib/tasks/task-versioning.ts`
- Create `src/lib/tasks/task-versioning.test.ts`
- Create `src/lib/tasks/task-instance.ts`
- Create `src/lib/tasks/task-instance.test.ts`

**RED:** Table/property tests for task-defining versus metadata changes, contiguous append, exact normalized digest reuse, digest-collision deep equality, duplicate-as-new-identity, archive semantics, and no attempt-based versions.

**GREEN:** Implement pure normalizers/comparators/builders. Digests are integrity aids only.

Commit: `feat(tasks): enforce immutable versions and instances`.

## Task 3: Add Dexie stores and Task repository

**Files:**
- Modify `src/lib/persistence/database.ts`
- Create `src/lib/persistence/task-repository.ts`
- Create `src/lib/persistence/task-repository.test.ts`
- Add in-memory repository parity file/tests.
- Modify repository context/provider composition.

**RED:** Contract tests for atomic Task+v1, append CAS, archive/restore, immutable artifact put/get, digest-collision byte equality, metadata-only rejection for complete instances, get-or-create instance, family/facet assignment, paginated queries, deterministic order, storage errors, collision mismatch, and referenced-version protection seam.

**GREEN:** Add next Dexie schema version and repository. Store artifact bytes outside summary rows; reject credentials/auth material; keep heavy data out of indexes. Make initialization failures bounded and preserve current Compare fallback behavior.

Commit: `feat(storage): persist canonical tasks`.

## Task 4: Inventory legacy task definitions

**Files:**
- Create `src/lib/tasks/legacy-task-inventory.ts`
- Create `src/lib/tasks/legacy-task-inventory.test.ts`

**RED:** Fixtures combine current suites and historical ExperimentRecord snapshots with changed/unchanged definitions, verifier differences, latest unexecuted edits, duplicate text across suites, missing/corrupt definitions.

**GREEN:** Produce a deterministic sorted inventory keyed by `(suiteId, taskId)` and complete executable-definition digest. No writes yet.

Commit: `feat(tasks): inventory legacy suite task history`.

## Task 5: Implement resumable namespaced migration

**Files:**
- Create `src/lib/persistence/canonical-task-migration.ts`
- Create `src/lib/persistence/canonical-task-migration.test.ts`
- Modify storage initialization/migration registry seam.

**RED:** Clean, partial, repeated-startup, corrupted crosswalk, multi-suite identical prompt, metadata-only historical attachments, missing artifact bytes, and unresolved-definition fixtures. Assert no source mutation, no fabricated artifact, incomplete eligibility disclosure, and byte/semantic equality of RunRecordV2/ExperimentRecord before/after.

**GREEN:** Create Tasks/Versions/crosswalks transactionally, marker after verification, resume by crosswalk. Unresolved definitions stay explicit.

Commit: `feat(storage): migrate embedded tasks conservatively`.

## Task 6: Build Task catalog query and route shell

**Files:**
- Create `src/workspaces/tasks/TaskCatalog.tsx` + test
- Create `src/workspaces/tasks/TaskRoute.tsx` + test
- Modify `src/app-router.tsx`
- Modify `src/ui/CommandPalette.tsx` + test

**RED:** Route/list tests for loading/empty/error/archive/search/filter/pagination/direct load/unknown ID. Command action must navigate and be keyboard-operable.

**GREEN:** Implement functional `/tasks`, `/tasks/new`, and detail/version routes. Do not add primary nav.

Commit: `feat(tasks): add task catalog routes`.

## Task 7: Build Task create/detail/version flows

**Files:**
- Create Task form/detail/version components and happy-dom tests under `src/workspaces/tasks/`.

**RED:** Create atomic v1, draft latest, explicit Create vN+1, historical read-only, duplicate new identity, archive/restore, referenced delete absent, stale revision, long fields.

**GREEN:** Implement vertical flows with distinct dirty/saved state and confirmation boundaries.

Commit: `feat(tasks): manage immutable task versions`.

## Task 8: Build families and facets UI

**Files:**
- Add family/facet components and tests under `src/workspaces/tasks/`.
- Reuse accessible combobox/dialog primitives.

**RED:** Create/edit/archive family, explicit primary assignment, typed relation, authored/suggested facet state, confirmation, provenance, keyboard/focus, invalid/cycle cases.

**GREEN:** Implement only specification dimensions; no inference or universal capability tree.

Commit: `feat(tasks): add explicit families and facets`.

## Task 9: Reference counts and migration disclosure

**Files:**
- Create `src/lib/tasks/task-references.ts` + test
- Integrate Task detail sections.

**RED:** Reference counts resolve current suite/experiment crosswalks, archived versions, unresolved migrations, and do not pick latest versions.

**GREEN:** Show scoped references/origin; future Compare/Observation sections remain absent until their children, not placeholders.

Commit: `feat(tasks): disclose historical references`.

## Task 10: Introduce archive v2 base and preserve v1

**Files:**
- Extend/refactor `src/lib/persistence/archive.ts` behind explicit v1/v2 adapters.
- Create/extend `src/lib/persistence/archive-v2-types.ts`, validators, and tests in child 02.

**RED:** Comprehensive current Run+Experiment+Fusion Study corpus (all seven Fusion stores and references) plus Rubric+Task+artifact data; v1 import; v2 clean round trip; missing artifact/digest failure; prohibited credential/auth bytes; repeated import; non-identical ID collision preview; cancellation before commit. Assert caches are omitted, Fusion claim levels/artifact refs survive, and source evidence is semantically unchanged.

**GREEN:** Introduce the extensible v2 envelope and round-trip all canonical stores available through this child. Before child 09, reject a non-identical ID collision before any write; never overwrite or partially import. Keep v1 readable and make backup copy honest.

Commit: `feat(archive): introduce task-first v2 envelope`.

## Task 11: Final gates and QA

Run:

```bash
npx vitest run src/lib/tasks src/lib/persistence src/workspaces/tasks src/ui/CommandPalette.test.tsx
npm run typecheck:web
npm run check
```

Browser matrix: create/version/archive/restore/duplicate/family/facet/migration origin/direct routes at 1440/1024/768/390, 200%, keyboard, reduced motion. Probe row/card overflow and secret-shaped text.

Verify migration idempotency by opening the same seeded legacy DB across repeated startup/reload and comparing counts/crosswalks. Update authority docs/program matrix only after green.

**STOP conditions:** auto-merge across suite scopes, mutable old version, source snapshot rewrite, Task primary nav, unrecoverable partial migration, or incomplete archive presented as complete.

## Done definition

All spec completion criteria and migration fixtures pass; Tasks are independently usable; existing evidence is untouched; full gate/browser evidence green; no push.
