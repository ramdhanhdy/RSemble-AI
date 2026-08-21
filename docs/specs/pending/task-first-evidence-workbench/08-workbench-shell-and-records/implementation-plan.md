# Workbench Shell and Records — Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load
> `rsemble-ai-development`, `test-driven-development`,
> `design-system-refinement-planning`, and `subagent-driven-development` before execution.

**Goal:** Ship **Compare · Evaluations · Lab · Models** as the only primary navigation and
preserve exact operational history through a typed secondary Records utility with legacy route
compatibility.

**Normative authority:** [`workbench-shell-and-records-spec.md`](./workbench-shell-and-records-spec.md)
— the single product/behavioral/interaction/visual/responsive/accessibility authority for this
child. This plan contains **HOW and WHEN only**: sequencing, tests, gates, STOP conditions. It
makes no product or design decisions; where this plan and the canonical spec appear to conflict,
the spec wins and this plan is stale — fix the plan.

**Canonical visual reference:**
`docs/explorations/future-task-first-ui/child08-canonical-states.html` (illustrates the spec;
never overrides it).

**Architecture:** Characterize and refactor existing Runs list/filter/detail components into
typed Records views. Add an owning-context resolver over child result indexes. Switch navigation
only after all four primary destinations are functional. Keep paid/recovery actions exclusively
in owners.

**Tech stack:** TypeScript, React, React Router, cmdk, Dexie/read models, Vitest/happy-dom,
browser CDP QA.

**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Existing Runs behavior characterized | Characterization tests green at baseline |
| B | Typed Record refs + owner resolution | Pure tests green |
| C | Records query/read model | Repository tests green |
| D | Route compatibility | Route/direct-load tests green |
| E | Shell/navigation switch | Nav/palette/strip tests green; no inert destination |
| F | Records drawer | Focus/a11y behavior tests green |
| G | Full Records utility | Migrated characterization tests pass on Records |
| H | Typed details + actions boundary | Typed detail + forbidden-verb sweep green |
| I | Migration/responsive/accessibility/browser closure | Full gate + browser matrix green |

## Task 0: Dependency, drift, and behavior inventory

Verify children 03/05/06/07 complete and functional: `/compare`, `/evaluations` (Task Sets,
executions, rubrics), `/lab` (`/lab`, `/lab/recipes`, `/lab/model-pools`, `/lab/studies/:id`),
`/models` (list, profile, drilldown, rollups). Record state/hashes. Run all current Runs, routes,
nav, command palette, copy-link, preload, archive, Compare/Evaluation/Lab/Models tests. Inventory
every user action and exact route. Re-grep `honesty-note` usages and confirm the class carries no
size/color styling (spec §G.3 verification duty).

**STOP:** Any primary target inert, current Runs baseline failure, unresolved owning-context
schema conflict, or overlapping dirty files.

## Task 1: Characterize current Runs behavior — Milestone A

**Files:** Existing `RunList`, `RunFilters`, `RunDetail`, `LegacyRunDetail`, `RunsWorkspace`,
hooks/repository tests.

Add characterization tests before refactor for: complete-set filter-before-pagination,
search/model/status/mode/source (exactly the five shipped controls; no date filter exists),
200ms debounce, `PAGE_SIZE = 50` + Load more + preload multiplier, split/mobile layouts, exact
timeline/attempts/evidence/cost/errors, copy link ("Copy link — this device"), export, preload
honesty, loading/error/legacy states, `/runs` and `/runs/:runId` direct-load/refresh/back-forward.

Commit: `test(records): characterize exact run ledger`.

## Task 2: Define typed Record references — Milestone B

**Files:**
- Create `src/lib/records/record-reference.ts` + validation tests
- Create `src/lib/records/record-owner.ts` + table tests

**RED:** Comparison/Evaluation/Policy Study/Task execution/Observation/Legacy refs per spec §E;
correct owners (Policy Study → `/lab/studies/:studyId` — never a retired Fusion route);
unresolved crosswalk; no type coercion; safe labels/IDs; prohibited fields absent.

**GREEN:** Implement pure union/owner resolution over child indexes.

Commit: `feat(records): define typed audit references`.

## Task 3: Build Records query/read model — Milestone C

**Files:**
- Create `src/lib/records/records-query.ts` + tests
- Add repository composition adapter.

**RED:** Merge typed summaries deterministically (newest-first, stable ID tiebreak);
filters type/source/status/model/search/exact ID; complete-set pagination; source revision
repair; no mutation/execute methods; idempotent indexes if persisted; interleaved semantic+exact
stream per spec §E.2.

**GREEN:** Compose repositories and load type detail lazily. Avoid copying exact evidence.

Commit: `feat(records): query typed audit history`.

## Task 4: Add canonical and legacy routes — Milestone D

**Files:** Modify `src/app-router.tsx` and route tests.

**RED:** `/records`, `/records/:recordType/:recordId` (six types), `/runs` query-filter redirect,
`/runs/:id` exact rendering at the unchanged URL, `/records/task-execution/:id` canonical with
copy-link canonicalization, typed not-found with recovery options, owner round-trips (Compare /
Evaluation / Task Set / Lab study / Model), direct load/refresh/back-forward/hash-router, focus
moves to detail heading.

**GREEN:** Implement explicit aliases. Keep old copied URLs valid and device-local copy wording.

Commit: `feat(records): preserve legacy run routes`.

## Task 5: Switch shell navigation — Milestone E

**Files:** Modify `src/ui/WorkspaceNav.tsx`, `src/ui/MobileWorkspaceNav.tsx`, `src/ui/Header.tsx`
(Records utility button), `src/ui/CommandPalette.tsx`, `src/ui/KindEyebrow.tsx` (study glyph per
spec §G.5), tests.

**RED:** exactly `Compare, Evaluations, Lab, Models` in order on desktop and mobile; static 2px
accent bar on active (bottom desktop / top mobile); `aria-current`; 44px targets; Records button
present in the utility cluster at **all widths** (drawer trigger ≥1024, `/records` link below);
palette Navigate group per spec §G.7 (including "Go to Records" keywords and "Find record by
ID…"); Lab/Policy Study identity `TestTubes`, Models identity `Cpu`; no Runs label/link anywhere
in current UI; Rank/Fuse remains Compare-only.

**GREEN:** Switch only now — all four destinations verified functional at Task 0.

Commit: `feat(shell): adopt task-first primary navigation`.

## Task 6: Build quick Records drawer — Milestone F

**Files:**
- Create `src/ui/RecordsDrawer.tsx` + `DrawerSurface` variant + happy-dom tests
- Modify `Header.tsx` wiring; add `.drawer-panel` to `src/index.css` per spec §G.3.

**RED:** open/close/Escape/focus trap/return; five workspace groups (non-empty only); 5-per-group
cap; safe search with EXACT MATCH section; semantic owner vs exact record selection; View all;
loading skeleton (opacity-only)/error/empty states; below-1024 substitution (button navigates, no
drawer mounts); no execution controls; drawer adds no global live region.

**GREEN:** Implement bounded drawer; do not duplicate full filters.

Commit: `feat(records): add secondary quick access`.

## Task 7: Refactor full Runs workspace into Records — Milestone G

**Files:**
- Move `src/workspaces/RunsWorkspace.tsx` → `RecordsWorkspace.tsx`
- Create `src/ui/RecordTypeRow.tsx` (sibling of shared `RecordRow`; spec §J) +
  `RecordTypeEyebrow`; remove the tinted source-chip treatment
- Move/adapt `RunList`/`RunFilters` to Records names; preserve `RunDetail` as the exact
  task-execution renderer
- Move/update tests. Characterization tests from Task 1 must pass unchanged against Records
  components.

**RED:** Port characterization tests before implementation; Type filter added (spec §I.2 — the
only new filter); list-pane identity band (eyebrow/title/filtered count); DataArchiveActions
remains in the list-pane footer.

**GREEN:** Refactor without deleting behavior. Keep current list/detail responsive patterns.

Commit: `refactor(records): generalize the exact ledger`.

## Task 8: Typed details and actions boundary — Milestone H

**Files:** New typed detail shells (comparison/evaluation/policy-study/observation/legacy),
`OwnerCard` + `ConfidenceChip`, `HonestyNote` + `src/ui/honesty-copy.ts`, `RecordsIndexErrorPanel`,
typed `RecordNotFound`; normalize `RunDetail`'s actions bar; `GlobalExecutionStrip` remains
awareness-only (owner links already ship).

**RED:** Semantic details render owner card + confidence chip + typed summary + Beneath list
(Policy Study capped at 20 children + aggregate counts per spec §K.2) and never reproduce owner
evidence UI; observation detail eligibility panel + exact source links + policy-evidence marker;
legacy detail preserves known-fields-only honesty; actions row fixed order with only spec §L
actions; sweep finds zero retry/resume/re-judge/re-fuse/repair/add-model/delete/retention verbs
in Records components; Open in Compare remains configuration-only with its honesty token; no
controller calls from drawer or full utility.

**GREEN:** Implement navigation-only handoffs and typed shells.

Commit: `feat(records): typed details with navigation-only actions`.

## Task 9: Migration pointer, archive/settings, legacy behavior — Milestone I (part 1)

**Files:** `RecordsMovePointer` (spec §O.1), in-app copy sweep.

**RED:** Pointer renders at most once (localStorage `records-move-pointer-dismissed`), only when
≥1 run record exists, non-modal/`role="status"`, keyboard-dismissible, never traps focus,
dismisses on navigation/drawer-open; all ordinary-history "Runs" labels re-worded per spec §O.2;
legacy localStorage imports render as Legacy records; DataArchiveActions truthful and reachable;
no delete/retention added.

**GREEN:** Implement pointer + copy sweep. Fix only failures with RED tests.

Commit: `feat(shell): records migration pointer and copy sweep`.

## Task 10: Responsive/accessibility/browser gate — Milestone I (part 2)

Run:

```bash
npx vitest run src/lib/records src/ui src/workspaces src/lib/persistence
npm run qa:design-motion
npm run typecheck:web
npm run check
```

Browser matrix (spec §N + §R): four-item primary nav desktop/mobile; drawer open/search/select/
focus-return; below-1024 substitution; full Records filter/pagination/detail; legacy exact run
deep link; typed owner round-trips incl. `/lab/studies/:id`; config-only preload; execution
strip; semantic-vs-exact distinguishability check (spec §R.13); mobile utility; 1440/1024/768/390;
200% zoom (effective-width ladder, no zoom-specific behavior); keyboard-only flows; reduced
motion; long records/IDs; per-element overflow; secrets probe.

Update authority docs/source comments only after green.

**STOP:** lost exact detail/filter behavior; Runs still primary; any inert primary destination;
Records executes or offers forbidden verbs; route 404; evaluation coerced into RunRecord; local
link misrepresented as shareable; Child 09 surface present.

## Done definition

Final primary topology is real (Compare · Evaluations · Lab · Models, desktop and mobile);
Records is secondary/typed/complete; all old run links and ledger capabilities work; ownership
and actions boundaries hold; semantic/exact distinction is visible in the default stream; all
automated, route, responsive, accessibility, browser, and full gates pass; no push.
