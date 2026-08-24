# Contextual Compare Results Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, and `subagent-driven-development` before execution.

**Goal:** Make Compare own durable, reloadable result history, canonical Task binding/promotion, evidence receipts, and recovery while preserving exact RunRecordV2 behavior.

**Architecture:** Add a lightweight Comparison Result index keyed one-to-one by existing run ID. Persist input/task linkage before paid calls. Reconstruct historical Rank/Fuse result routes from exact records. Keep the current controller and configuration-only Open-in-Compare contract.

**Tech stack:** TypeScript, React, React Router, Dexie, Vitest/happy-dom, current Compare reducer/controller/RunRepository.

**Specification:** [`contextual-compare-results-spec.md`](./contextual-compare-results-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Result index/read model | Legacy indexing idempotent |
| B | Pre-call task/input linkage | Failure makes zero paid calls |
| C | Result history/routes/promotion | Reload and evidence tests green |
| D | Recovery/regression/QA | Full Compare and browser gates green |

## Task 0: Dependency/drift and reconstruction audit

Verify children 02/04 complete. Record state/hashes. Read `rsemble.tsx`, state engine, run controller/recorder/builder/types/repository, OutputPane/RankResult/FuseResult, attachment/context persistence, preload, route tests, history cache.

Build a fixture matrix of Rank/Fuse completed/partial/interrupted/retried/re-judged/re-fused records and prove what can be reconstructed. **STOP** if accepted historical output cannot be reconstructed without invention; amend route scope explicitly.

## Task 1: Define Comparison Result index and validators

**Files:**
- Create `src/lib/compare/comparison-result-types.ts`
- Create validators/tests.

**RED:** ID/run ID equality, ad-hoc/canonical binding, lineage, input snapshot ref, active observations, revisions, malformed/secret data.

**GREEN:** Implement safe summary-only index; no raw outputs/rationale.

Commit: `feat(compare): define contextual result index`.

## Task 2: Add Comparison repository/read model

**Files:**
- Modify `database.ts` next schema version
- Create `src/lib/persistence/comparison-repository.ts` + contract tests
- Add in-memory parity.

**RED:** Create/get/list/filter/pagination, bind CAS, lineage, source/index mismatch, idempotent rebuild, storage failure, missing exact run.

**GREEN:** Implement index and joins to RunRepository.

Commit: `feat(storage): index comparison results`.

## Task 3: Migrate current Compare runs

**Files:**
- Create `src/lib/persistence/comparison-result-migration.ts` + tests.

**RED:** Full Compare, evaluation-source run excluded as semantic comparison, legacy summary-only, completed/partial/interrupted, repeated startup, missing detail, corrupt source.

**GREEN:** One index per safe full Compare with `comparisonId == runId`; ad hoc binding; explicit limitations; no Task auto-creation.

Commit: `feat(storage): index historical comparisons`.

## Task 4: Persist envelope/input/task link before paid calls

**Files:**
- Modify current Compare start command/controller composition.
- Create pure preflight builder and tests.

**RED:** Atomic sequence tests prove validation → run/envelope → Task Instance/link → lease/provider. Inject failures at each boundary; assert zero call before durable success and recoverable state after later failure.

**GREEN:** Add pre-call transaction/compensation following current recorder ownership. Never move stream deltas into persistence control queue.

Commit: `feat(compare): persist result context before execution`.

## Task 5: Build previous-comparisons query/list

**Files:**
- Create `src/workspaces/compare/ComparisonList.tsx` + test
- Create `ComparisonFilters.tsx` + test
- Integrate Compare shell/route.

**RED:** New/history, status/title/model/mode/Task/date filters across complete set, stable pagination, empty/error/interrupted states, row links, mobile flow.

**GREEN:** Implement semantic result list; reuse list primitives without a raw Runs mental model.

Commit: `feat(compare): add previous comparison history`.

## Task 6: Build reloadable result route

**Files:**
- Create `src/workspaces/compare/ComparisonResultRoute.tsx` + tests
- Modify `src/app-router.tsx`
- Adapt OutputPane/RankResult/FuseResult to persisted view models where needed.

**RED:** Direct load completed Rank/Fuse, partial/interrupted, unknown ID, source/index repair, back/forward, exact Record link. Assert no provider calls on load.

**GREEN:** Reconstruct only stored facts; explicit unavailable state for any old optional UI state.

Commit: `feat(compare): restore persisted comparison results`.

## Task 7: Add canonical Task selection/version boundary

**Files:**
- Create `ComparisonTaskBindingControl.tsx` + tests
- Integrate command pane.

**RED:** Select latest/older version, clear to ad hoc, open Task, edit bound content → explicit Create vN+1 or Run ad hoc, cancel/no call, stale version conflict.

**GREEN:** Implement child-02 repository operations before Task Instance/pre-call persistence.

Commit: `feat(compare): bind comparisons to task versions`.

## Task 8: Add Save/Link Task promotion

**Files:**
- Create `PromoteComparisonTaskDialog.tsx` + tests
- Add pure exact-match/link validator.

**RED:** Create new Task, exact link existing, mismatch rejection, exact-match suggestion without auto-merge, conflict retry, missing input limitation, cancel/focus return, reindex trigger.

**GREEN:** CAS binding and Task Instance reconstruction; no semantic similarity merge.

Commit: `feat(compare): promote ad hoc work to tasks`.

## Task 9: Integrate Evidence receipt

**RED:** Ad hoc exploratory copy, canonical eligible/excluded model decisions, incomplete roster, unknown version, retry disclosure, exact Observation/Record links.

**GREEN:** Reuse child-04 `EvidenceReceipt`; do not fork rules/copy.

Commit: `feat(compare): disclose comparison evidence eligibility`.

## Task 10: Preserve recovery/rejudge/refuse/preload

Add/retain RED regression tests for:

- candidate retry, judge retry/re-judge, fusion retry/re-fuse, abort/interruption;
- result lineage and observation reindex after active attempt changes;
- deliberate Run again creates new linked result but not replicate;
- Open in Compare restores config only and never outputs/implicit lineage;
- exact Record backlink returns to owner;
- storage/lease failure recovery and dynamic blind-label mocks.

Implement only failing adapter changes. Commit bounded fixes.

## Task 11: Extend archive v2

Extend child-04 archive v2 validators/export/import with Comparison Result indexes, lineage, canonical/ad-hoc Task bindings, immutable input-snapshot metadata/artifact references, and migration limitations. Add earlier-v2/v1 fixtures, exact RunRecordV2 reference checks, no source payload duplication, prohibited-content checks, and collision-abort-before-write behavior.

Commit: `feat(archive): preserve contextual comparison indexes`.

## Task 12: Full QA and authority gate

Run:

```bash
npx vitest run src/lib/compare src/lib/persistence src/lib/evidence src/ui src/workspaces/compare
npm run typecheck:web
npm run check
```

Browser: ad hoc run → reload → promote/link → receipt → Record → owner; canonical edit version/ad hoc choice; interrupted recovery; Rank/Fuse; mobile/zoom/keyboard/reduced motion/long fields/overflow/secrets.

Update current authority docs to Compare-owned history only after green.

**STOP:** fabricated reconstruction, auto Task merge, provider call before linkage, result load executes, recovery/preload regression, or raw Runs required for ordinary history.

## Done definition

Every safe Compare run has one contextual result; routes reload; Task workflows are explicit; evidence/recovery exact; all gates green; no push.
