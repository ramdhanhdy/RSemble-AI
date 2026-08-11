# Workbench Shell and Secondary Records Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, `design-system-refinement-planning`, and `subagent-driven-development` before execution.

**Goal:** Ship Compare · Evaluations · Models as the only primary navigation and preserve exact operational history through a typed secondary Records utility with legacy route compatibility.

**Architecture:** Characterize and refactor existing Runs list/filter/detail components into typed Records views. Add an owning-context resolver over child result indexes. Switch navigation only after all three primary destinations are functional. Keep paid/recovery actions exclusively in owners.

**Tech stack:** TypeScript, React, React Router, cmdk, Dexie/read models, Vitest/happy-dom, browser CDP QA.

**Specification:** [`workbench-shell-and-records-spec.md`](./workbench-shell-and-records-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Typed Record refs/owner resolution | Pure tests green |
| B | Records full utility + compatibility | Current Runs behavior preserved |
| C | Drawer/final navigation | No inert destination; route tests green |
| D | Responsive/a11y/authority gate | Full browser/check green |

## Task 0: Dependency, drift, and behavior inventory

Verify children 03/05/06 complete and functional. Record state/hashes. Run all current Runs, routes, nav, command palette, copy-link, preload, archive, Compare/Evaluation/Models tests. Inventory every user action and exact route.

**STOP:** Any primary target inert, current Runs baseline failure, unresolved owning-context schema conflict, or overlapping dirty files.

## Task 1: Characterize current Runs behavior

**Files:** Existing `RunList`, `RunFilters`, `RunDetail`, `RunsWorkspace`, hooks/repository tests.

Add characterization tests before refactor for complete-set filter-before-pagination, search/model/status/mode/source, split/mobile layouts, exact timeline/attempts/evidence/cost/errors, copy link, export, preload honesty, loading/error/legacy states.

Commit: `test(records): characterize exact run ledger`.

## Task 2: Define typed Record references

**Files:**
- Create `src/lib/records/record-reference.ts` + validation tests
- Create `src/lib/records/record-owner.ts` + table tests

**RED:** Comparison/Evaluation/Fusion Study/Task execution/Observation/Legacy refs; correct owners; unresolved crosswalk; no type coercion; safe labels/IDs; prohibited fields.

**GREEN:** Implement pure union/owner resolution over child indexes.

Commit: `feat(records): define typed audit references`.

## Task 3: Build Records query/read model

**Files:**
- Create `src/lib/records/records-query.ts` + tests
- Add repository composition adapter.

**RED:** Merge typed summaries deterministically; filters/type/source/status/model/date/exact ID; complete-set pagination; source revision repair; no mutation/execute methods; idempotent indexes if persisted.

**GREEN:** Compose repositories and load type detail lazily. Avoid copying exact evidence.

Commit: `feat(records): query typed audit history`.

## Task 4: Refactor full Runs workspace into Records

**Files:**
- Move `src/workspaces/RunsWorkspace.tsx` → `RecordsWorkspace.tsx`
- Move/adapt Run list/filter/detail components to records names where semantically appropriate
- Preserve RunRecord detail component as exact typed renderer
- Move/update tests.

**RED:** Port characterization tests before implementation; add typed Evaluation/Fusion Study/Observation/Legacy details and owner links.

**GREEN:** Refactor without deleting behavior. Keep current list/detail responsive patterns.

Commit: `refactor(records): generalize the exact ledger`.

## Task 5: Add canonical and legacy routes

**Files:**
- Modify `src/app-router.tsx` and route tests.

**RED:** `/records`, typed detail, `/runs` query redirect/alias, `/runs/:id` exact unchanged, current and canonical Fusion Study deep links, direct load/refresh/back-forward/hash, unknown ID, owner round-trip.

**GREEN:** Implement explicit aliases. Keep old copied URL valid and device-local copy label.

Commit: `feat(records): preserve legacy run routes`.

## Task 6: Build quick Records drawer

**Files:**
- Create `src/ui/RecordsDrawer.tsx` + happy-dom tests
- Modify `Header.tsx`.

**RED:** open/close/Escape/focus trap/return, recent typed groups, safe search, select semantic owner versus exact record, View all, loading/error/empty, mobile fallback, no execution controls.

**GREEN:** Implement bounded drawer; do not duplicate full filters.

Commit: `feat(records): add secondary quick access`.

## Task 7: Switch desktop/mobile primary navigation

**Files:**
- Modify `WorkspaceNav.tsx`, `MobileWorkspaceNav.tsx`, Header layout, tests.

**RED:** exactly Compare/Evaluations/Models, correct active matching, 44px mobile targets, Rank/Fuse Compare-only, secondary Records present, no Runs primary copy.

**GREEN:** Switch only now. Ensure all destination routes functional.

Commit: `feat(shell): adopt task-first primary navigation`.

## Task 8: Global execution and handoff boundaries

**Files:**
- Modify `GlobalExecutionStrip.tsx`, command palette, Record actions and tests.

**RED:** active Compare/Evaluation strips link exact owner; Record Open in Compare configuration-only; no Records retry/rejudge/refuse/repair/resume/add model; no controller calls from drawer/full utility.

**GREEN:** Implement navigation-only handoffs.

Commit: `fix(shell): keep execution in owning workspaces`.

## Task 9: Archive/settings and legacy behavior

Ensure current DataArchiveActions remain reachable and truthful until child 09. Test all legacy localStorage imports and summary-only records. Do not add delete/retention. Fix only failures with RED tests.

## Task 10: Responsive/accessibility/browser gate

Run:

```bash
npx vitest run src/lib/records src/ui src/workspaces src/lib/persistence
npm run qa:design-motion
npm run typecheck:web
npm run check
```

Browser matrix: primary nav, drawer, full Records, legacy exact run/Fusion links, typed owner round-trip, config preload, execution strip, mobile utility, 1440/1024/768/390, 200%, keyboard, reduced motion, long rows, per-element overflow, secrets.

Update authority docs/source comments only after green.

**STOP:** lost exact detail/filter behavior, Runs still primary, inert Models, Records executes, route 404, evaluation coerced into RunRecord, or local link misrepresented as shareable.

## Done definition

Final primary topology is real; Records is secondary/typed/complete; all old run links and ledger capabilities work; ownership/actions are correct; full gate/browser evidence green; no push.
