# Bounded Attention and Recovery Handoffs Implementation Plan

> **For Hermes:** Implement task-by-task with strict RED → GREEN → REFACTOR. Load `rsemble-ai-development`, `test-driven-development`, and `subagent-driven-development` before execution.

**Goal:** Add a deterministic, bounded global Attention query that navigates actionable interrupted/incomplete work to its owning recovery surface and never executes.

**Architecture:** Compose pure membership/supersession/ordering functions over existing Comparison, Evaluation, and storage summaries. Refresh from repository/controller/cross-tab events. Render a five-item popover and full route with navigation-only links; persist no Attention lifecycle state.

**Tech stack:** TypeScript, React, React Router, existing repositories/controller events/BroadcastChannel, Vitest/happy-dom.

**Specification:** [`attention-and-recovery-spec.md`](./attention-and-recovery-spec.md)
**Execution authorization:** Explicit approval required; local commits only; no push.

---

## Milestone map

| Milestone | Result | Gate |
|---|---|---|
| A | Membership/supersession contract | Exhaustive state table green |
| B | Event-driven query service | Multi-tab/stale tests green |
| C | Popover/full route/owner handoff | No execution call invariant green |
| D | Browser/full gate | Recovery disappearance proven |

## Task 0: Dependency/drift and recovery action audit

Verify children 03/05/07 complete. Record state/hashes. Inventory exact current Compare/Evaluation recoverability helpers, controller action gates, storage status, summaries, execution owner/lease events, multi-tab messaging. Run all recovery/lease tests.

Produce a state→concrete-owner-action table. **STOP** if a proposed item lacks a reliable current action predicate/route.

## Task 1: Define controlled Attention domain

**Files:**
- Create `src/lib/attention/attention-types.ts`
- Create validation tests.

**RED:** item kinds/reasons/severity/source/owner/supersession, safe copy fields, prohibited unknown reason and secret text.

**GREEN:** Implement exact controlled unions; no status/dismiss/action callback.

Commit: `feat(attention): define recovery handoff domain`.

## Task 2: Implement Comparison membership

**Files:**
- Create `src/lib/attention/comparison-attention.ts` + table tests.

**RED:** every run/result status, candidate/judge/fusion failure, retries available/unavailable, interrupted/aborted/recovered, newer lineage, active execution, exploratory-only evidence.

**GREEN:** Include only concrete recoverable owner states.

Commit: `feat(attention): derive comparison recovery items`.

## Task 3: Implement Evaluation membership

**Files:**
- Create `src/lib/attention/evaluation-attention.ts` + table tests.

**RED:** queued/running/paused/interrupted/aborted/completed-with-failures, repairable versus fallback cells/tasks, declared partial workload, roster extension in progress/resolved, superseding recovery, invalid refs.

**GREEN:** Reuse existing pure recovery planners/action gates; do not reimplement eligibility.

Commit: `feat(attention): derive evaluation recovery items`.

## Task 4: Implement storage membership, merge, order, cap

**Files:**
- Create `storage-attention.ts`, `attention-query.ts`, tests.

**RED:** classified errors only, concrete route, sanitized copy; priority order; stable tie; dedupe supersession; full count; first five; `9+`; zero absent.

**GREEN:** Pure merge/sort/cap.

Commit: `feat(attention): prioritize bounded handoffs`.

## Task 5: Build event-driven query service

**Files:**
- Create `src/lib/attention/attention-service.ts` + tests
- Integrate repository/controller/storage/cross-tab events.

**RED:** initial load, source commit update, duplicate events, visibility return, other-tab recovery, stale revision, hidden-tab throttling fixture, no polling/provider call, disposal.

**GREEN:** Debounced deterministic recompute; source status remains authority.

Commit: `feat(attention): refresh from source events`.

## Task 6: Build header counter/popover

**Files:**
- Create `src/ui/AttentionPopover.tsx` + happy-dom tests
- Modify `Header.tsx`.

**RED:** zero absent; counts/cap; five items/View all; keyboard/escape/focus return; labels/reasons/ages; click navigates; no mutation/controller/provider method called; mobile behavior.

**GREEN:** Implement accessible secondary utility.

Commit: `feat(attention): add global recovery indicator`.

## Task 7: Build full Attention route

**Files:**
- Create `src/workspaces/attention/AttentionWorkspace.tsx` + tests
- Modify `src/app-router.tsx`.

**RED:** grouping, same order/set as service, exact Records link, empty/loading/error, direct route, no actions besides navigation.

**GREEN:** Implement `/attention` secondary route.

Commit: `feat(attention): list all recovery handoffs`.

## Task 8: Add owner focus/highlight and stale resolution

**Files:** Modify Compare/Evaluation owner route recovery sections and tests.

**RED:** route state/hash focuses recovery, revalidates action; already-resolved link says no longer needs attention; focus accessible; no re-created item.

**GREEN:** Navigation handoff only.

Commit: `feat(attention): focus owning recovery context`.

## Task 9: End-to-end invariant and QA gate

Automated spy/architecture test proves Attention modules do not import paid controller execute methods or expose mutation callbacks. Then run:

```bash
npx vitest run src/lib/attention src/ui src/workspaces
npm run typecheck:web
npm run check
```

Browser fixtures: interrupted Compare and incomplete Evaluation → item → owner → recover → source commit → item disappears; multi-tab; stale link; storage failure; 1440/1024/768/390, 200%, keyboard, reduced motion, overflow, secrets.

**STOP:** item without action, manual lifecycle state, Attention paid call, hidden-tab false positive, resolved item remains, or counter/popover/route disagree.

## Done definition

Membership is deterministic/actionable/bounded; all actions navigate only; recovery removes items from source truth; multi-tab/a11y/browser/full gates green; no push.
