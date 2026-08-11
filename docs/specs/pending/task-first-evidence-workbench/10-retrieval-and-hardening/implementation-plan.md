# Retrieval, Archive, Migration, and Authority Hardening Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, `spec-lifecycle-management`, `browser-guided-artifact-workflow`, and `subagent-driven-development` before execution.

**Goal:** Complete the task-first program with typed local search, safe full-corpus archive v2, resumable migration/repair, cross-child invariant fixtures, measured performance, browser/accessibility evidence, and reconciled authority docs.

**Architecture:** Index only safe bounded metadata in a rebuildable local search store. Consolidate the archive v2 envelope already introduced and incrementally extended by earlier children, and treat migration crosswalks as canonical durable state while caches/search documents are disposable. Complete collision-safe import, ordered migration orchestration, and non-destructive diagnostics. Finish with one cross-child deterministic corpus and status/authority migration.

**Tech stack:** TypeScript, React, React Router/cmdk, Dexie, Web Workers as measured, Vitest/happy-dom, Node QA scripts, CDP browser QA.

**Specification:** [`retrieval-and-hardening-spec.md`](./retrieval-and-hardening-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Typed safe Search | Ranking/security/performance tests green |
| B | Archive v2 round trip | v1/v2/collision/secret tests green |
| C | Migration registry/diagnostics | Fresh/legacy/partial/multi-tab tests green |
| D | Cross-child invariant/performance/browser matrix | Full evidence green |
| E | Authority/spec lifecycle reconciliation | Zero stale refs; archived correctly |

## Task 0: Program-wide drift and dependency gate

1. Verify children 01–08 are complete and their QA evidence exists.
2. Record branch/HEAD/worktree and hashes for parent/all child specs.
3. Run `npm run check` and every existing child QA command.
4. Inventory all Dexie versions/stores, child migrations/crosswalks, archives, indexes/caches, routes, source comments, authority docs.
5. **STOP** on any failed child gate, status mismatch, unresolved schema conflict, or overlapping dirty work.

## Task 1: Define typed safe search documents

**Files:**
- Create `src/lib/search/search-types.ts`
- Create `search-document.ts` and security/validation tests.

**RED:** Every type fields/owner route/revision; prohibited raw output/rationale/attachments/errors/credentials; secret patterns; malformed/prototype-polluting values.

**GREEN:** Safe bounded canonical documents and sanitizers.

Commit: `feat(search): define typed local documents`.

## Task 2: Implement deterministic lexical ranking/query

**Files:**
- Create `src/lib/search/search-index.ts`, `search-query.ts`, property/golden tests.

**RED:** exact ID first, title prefix, token ranking, type groups, stable tie/order, filters, no coercion, empty/Unicode/long query, pagination. Benchmark 10,000 fixtures.

**GREEN:** Local index/query; no embeddings/remote calls. Choose token map/Dexie indexes based measured evidence.

Commit: `feat(search): rank cross-entity results locally`.

## Task 3: Add incremental/rebuild indexing

**Files:**
- Add next Dexie schema version if persistence is required.
- Create `src/lib/persistence/search-index-repository.ts` and `search-reindex.ts` with tests.

**RED:** source commit/revision, stale hit repair/removal, full rebuild cursor, repeated N rebuilds, partial restart, multi-tab owner, no source deletion.

**GREEN:** Disposable versioned documents; deterministic rebuild.

Commit: `feat(storage): maintain rebuildable search index`.

## Task 4: Build command overlay and full Search route

**Files:**
- Modify `CommandPalette.tsx`
- Create `src/workspaces/search/SearchWorkspace.tsx` + tests
- Modify router.

**RED:** grouped async hits, keyboard/ARIA, query/filter URL, View all, owner/evidence navigation, loading/error/stale, no secrets, max rendered rows/virtualization.

**GREEN:** Integrate typed search without breaking command actions.

Commit: `feat(search): find every workbench entity`.

## Task 5: Consolidate and finalize archive v2 schema/manifest/digests

**Files:**
- Consolidate/extend `src/lib/persistence/archive-v2-types.ts`, validators, and tests created by earlier children.
- Refactor `archive.ts` only behind version adapters; do not replace proven v1/earlier-v2 readers.

**RED:** every canonical entity and all exact current Fusion Study collections, counts/observation/aggregation/uncertainty-rule versions/storage schema/local notice, canonical digests, missing/corrupt/prohibited/future version, disposable cache omission, and separate type identity for experimental `FusionObservation` versus canonical Task Observation.

**GREEN:** V2 canonical serializer/validator. Digests verify integrity only.

Commit: `feat(archive): define complete v2 format`.

## Task 6: Implement secret-safe v2 export

**Files:**
- Create/modify archive export service and tests.

**RED:** comprehensive corpus including all Fusion Study stores/owner crosswalks/claim levels, known secret patterns in every free-text/config/error location, credentials stores omitted, blocked export reports entity/type without echo, deterministic counts/digests, progress/cancel boundary.

**GREEN:** Stream/chunk if needed; never silently omit canonical source while claiming complete backup.

Commit: `feat(archive): export full corpus safely`.

## Task 7: Implement v1/v2 preview and collision-safe import

**Files:**
- Create `archive-import-v2.ts`, import journal/crosswalk, tests.

**RED:** v1 adapter, v2 clean round trip, identical reuse, nonidentical ID collision remap/all refs, partial/large, phase rollback/resume, quota/unavailable, malformed keys/digests, no provider call, count/ref verification.

**GREEN:** Preview then bounded atomic phases; journal/marker after verify; rebuild disposables post-commit.

Commit: `feat(archive): restore versioned corpus atomically`.

## Task 8: Consolidate migration registry

**Files:**
- Create `src/lib/persistence/migration-registry.ts` + tests
- Adapt child migration entry points; do not rewrite proven internals without tests.

**RED:** dependency topological order, missing/cycle, inspect/apply/verify, lightweight current DB, blocking versus background step, cursor resume, marker timing, multi-tab owner loss, repeated startup.

**GREEN:** One orchestration surface; current DB startup budget measured.

Commit: `refactor(storage): orchestrate task-first migrations`.

## Task 9: Build non-destructive diagnostics/repair

**Files:**
- Create `src/workspaces/records/DataDiagnostics.tsx` + tests.
- Add `/records/diagnostics` to `src/app-router.tsx` and Records/archive utility links.
- Add pure verification/report APIs.

**RED:** schema/version/counts/orphans/unresolved/rebuild status; Verify/Resume/Rebuild derived only; no casual delete/reset; safe errors; storage blocked; keyboard/focus.

**GREEN:** Functional local diagnostics. Exact evidence protected.

Commit: `feat(storage): verify and repair derived state`.

## Task 10: Build cross-child deterministic corpus/harness

**Files:**
- Create fixtures under `test/fixtures/task-first-evidence/`
- Create `test/task-first-invariants.test.ts` and helpers.

**RED:** Encode all specification corpus cases and eleven invariant assertions—including Fusion Study preservation, route ownership, archive round trip, and exclusion from canonical Observation counts—before integration fixes.

**GREEN:** Wire real repositories/rules/routes where feasible, minimal mocks, no paid calls. Fix cross-child defects with individual failing tests and commits.

Commit: `test(task-first): enforce program invariants`.

## Task 11: Enforce measured performance budgets

**Files:**
- Create `scripts/qa-task-first-performance.mjs`.
- Add `npm run qa:task-first-performance`.

Measure Search/Records/Attention/Models/startup/archive on declared corpus sizes and record OS/CPU/runtime. Add Worker/chunking/virtualization only where measurements require. Keep deterministic output and generous CI variance handling without deleting budgets.

Commit: `perf(task-first): enforce local corpus budgets`.

## Task 12: Full browser/accessibility/security matrix

**Files:**
- Create `scripts/qa-task-first-workbench.mjs` and its deterministic fixtures.
- Add `npm run qa:task-first-workbench` to `package.json`.
- Store captured evidence under a dedicated `docs/qa/task-first-evidence-workbench/` directory.

Cover every primary/secondary/current-Fusion/canonical-Fusion route and new/legacy/migration/error state at 1440/1024/768/390, 200%, reduced motion, keyboard. Check focus, landmarks/tables, touch targets, per-element overflow, console/network, no inert controls, no real provider calls, secret probes, local-link wording.

Commit: `test(task-first): add workbench browser matrix`.

## Task 13: Authority and spec lifecycle reconciliation

Only after all green:

1. Update `PRODUCT.md`, `DECISIONS.md`, `CLAUDE.md`, provider/docs/source comments.
2. Add QA/index evidence pointers.
3. Update program README completion matrix.
4. Move the whole parent folder from `docs/specs/pending/` to `docs/specs/archive/` with `git mv`.
5. Sweep all Markdown/TS/TSX/HTML references from old pending path to archive path.
6. Verify zero stale references and `docs/specs/README.md` lists shipped outcome/evidence.
7. Run `npm run check` again after moves/comment edits.

Commit: `docs: archive task-first evidence workbench program`.

## Task 14: Final release gate

Run:

```bash
npx vitest run
npm run typecheck:web
npm run qa:suite-reliability
npm run qa:design-motion
npm run qa:evaluations-identity
npm run qa:task-first-performance
npm run qa:task-first-workbench
npm run check
```

Repeat archive export→fresh DB import→verify→rebuild→search/profile/legacy link flow. Compare source evidence semantic digests before/after.

**STOP conditions:** any secret in bytes/UI, source evidence mutation, non-idempotent migration, broken v1 archive/legacy route, Search owner mismatch, performance hiding behavior, stale authority, universal score/IRT/workflow scope, or destructive repair.

## Done definition

Every spec criterion is executable and green; Search/archive/migrations/diagnostics work; budgets and browser matrix recorded; authority is current; full program archived with zero stale refs; no push unless separately requested.
