# Bounded Attention and Recovery Handoffs Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 08
**Dependencies:** 03 Task Sets and Evaluations; 05 Contextual Compare Results; 07 Workbench Shell and Records

---

## 1. User outcome

A user sees a small, truthful global indicator when unfinished work needs action. Opening it explains what happened and takes the user to the exact Compare or Evaluation recovery surface. Attention never becomes another inbox, dashboard, lifecycle state, or execution engine.

## 2. Domain boundary

Attention is a deterministic query over existing source state:

```ts
interface AttentionItem {
  key: string;
  kind: "comparison_recovery" | "evaluation_recovery" | "storage_preservation";
  sourceId: string;
  ownerHref: string;
  title: string;
  summary: string;
  reasonCode: AttentionReasonCode;
  severity: "blocking" | "actionable";
  occurredAt: number;
  supersessionKey: string;
}
```

`AttentionItem` is a read model, not a persisted source-of-truth record. It has no status transition API and no execution callback.

## 3. Membership rules

### 3.1 Comparison recovery

Include when all are true:

- Comparison Result exists;
- source status is interrupted, aborted with reusable work, or completed with a recoverable missing candidate/judge/fusion stage;
- Compare exposes a concrete valid recovery/retry action;
- no newer lineage has successfully superseded it;
- another active execution does not make the item misleading.

Do not include completed results merely because evidence is exploratory or a model lost.

### 3.2 Evaluation recovery

Include when all are true:

- Evaluation Execution is interrupted, aborted with recoverable state, or terminal with incomplete repairable tasks/cells;
- owning Evaluation Result exposes a valid recovery/repair action;
- the execution has not been superseded by successful recovery or a newer accepted lineage;
- source refs and lease state are readable.

Do not include ordinary provisional standings caused by a declared partial workload unless a recovery action exists.

### 3.3 Storage preservation

Include when a classified storage failure prevents preserving current Compare/Evaluation evidence and a concrete diagnostics/retry owner exists. Never include raw unsanitized error payloads.

Provider-not-connected states do not appear merely because a provider is optional; connection readiness remains in Connections and execution preflight.

## 4. Reason codes

Initial controlled vocabulary:

```text
comparison_interrupted
comparison_candidate_recoverable
comparison_judge_recoverable
comparison_fusion_recoverable
evaluation_interrupted
evaluation_tasks_incomplete
evaluation_cells_repairable
storage_write_failed
storage_quota_blocked
storage_unavailable
```

Every reason has fixed user copy and a tested owner route. Unknown statuses do not become Attention items by guess.

## 5. Supersession and disappearance

An item disappears when:

- source recovers and no longer matches membership;
- a newer accepted attempt resolves the stage/cell;
- an Evaluation Execution reaches complete required coverage;
- a newer lineage explicitly supersedes the source;
- recovery becomes impossible or source corrupt—in which case exact evidence remains in Records with a limitation, not an eternal Attention item;
- storage preservation succeeds.

Attention is not manually “completed.” No dismiss/snooze state ships initially. Boundedness comes from query semantics and presentation limit, not hiding unresolved work.

## 6. Ordering and bounded presentation

Ordering:

1. blocking storage preservation;
2. active recoverable execution interruption;
3. incomplete evaluation repair;
4. newest occurrence within equal priority;
5. stable source ID tie-break.

The header counter reports the full deduplicated actionable count, capped visually as `9+`. The popover shows at most five items plus **View all attention** when more exist.

Deduplicate by `supersessionKey`; show the newest actionable representative with a disclosure when multiple affected cells/tasks are summarized.

## 7. Routes and UI

```text
/attention
```

Attention remains secondary; it is not primary navigation.

### 7.1 Header popover

- counter absent when zero;
- button label includes count for assistive technology;
- item shows owner kind, concise reason, age, and one action label such as **Recover comparison** or **Repair evaluation**;
- selecting navigates only;
- popover does not contain Retry/Resume/Add model or any paid action;
- View all opens `/attention`.

### 7.2 Full Attention route

- grouped by Compare, Evaluations, and Storage;
- same deterministic membership and order as counter/popover;
- explanatory empty state;
- source/owner links and exact Record link where useful;
- no mutation controls.

### 7.3 Owning handoff

Owner route focuses or highlights the recovery section and revalidates action availability against current state. A stale Attention link that is already resolved shows **This item no longer needs attention** and the current result; it does not recreate the item.

## 8. Refresh and multi-tab semantics

- derive initially from repositories after initialization;
- update after source repository commits, execution-controller events, storage status changes, visibility/focus return, and cross-tab BroadcastChannel/storage notifications;
- debounce/recompute deterministically;
- never use a polling loop that competes with paid execution;
- hidden-tab throttling must not create false interrupted items; source lease/recovery status remains authority;
- stale caches are invalidated by source revisions.

## 9. Repository/query API

A pure query service composes existing repositories:

```text
queryComparisonAttention
queryEvaluationAttention
queryStorageAttention
mergeDeduplicateAndSortAttention
```

No `saveAttention`, `dismissAttention`, or `executeAttention` method exists.

The query reads summary/index fields and loads detail only when needed, with a fixture performance budget in child 09.

## 10. Compatibility and migration

No durable migration is required. Existing interrupted/recoverable Compare and Evaluation states become visible when the query ships. Legacy summary-only records without valid owners are excluded from Attention and remain in Records.

Source state and recovery semantics are never rewritten to fit Attention.

## 11. Responsive/accessibility

- popover has dialog/menu semantics appropriate to its interaction pattern, focus trap/roving behavior, Escape close, and focus return;
- counter meaning is not color-only;
- mobile uses a full-width sheet or `/attention` route without covering primary navigation;
- 390px and 200% zoom preserve title/reason/action;
- timestamps have accessible exact values;
- items are real links or buttons, not nested interactive rows;
- reduced motion respected;
- live count updates do not create disruptive repeated announcements.

## 12. Non-goals

- executing retry/resume/repair/add-model actions;
- new execution lifecycle states;
- manual dismiss, snooze, assignment, due dates, notifications, or inbox workflow;
- provider-readiness reminders without an active failed operation;
- evidence-quality warnings that have no recovery action;
- background cloud notifications;
- retention/deletion prompts;
- workflow-agent task queue.

## 13. Implementation sequence

1. Define reason codes, item contract, and pure membership/supersession/ordering functions.
2. Add repository summary queries with characterization fixtures for current recovery states.
3. Compose deduplicated query service and source-revision invalidation.
4. Add cross-tab/event-driven refresh without execution control.
5. Build header counter/popover and `/attention` route.
6. Add owner-route focus/highlight and stale-item handling.
7. Add empty/error/storage states and telemetry.
8. Run membership, multi-tab, route, responsive, accessibility, and browser gates.

## 14. Validation plan

### Membership tables

Cover every current Compare/Evaluation terminal and nonterminal status, candidate/judge/fusion failure, missing-cell repairability, full-roster fallback, roster extension in progress, storage errors, stale lease, superseded attempts, and resolved recoveries. Assert include/exclude, reason, owner, priority, and supersession.

### Invariants

- zero action means zero Attention item;
- clicking never invokes controller/provider/repository mutation;
- successful recovery removes item after source commit;
- false hidden-tab lease timing does not create item without source recovery status;
- duplicate cell/task problems collapse predictably;
- unresolved legacy record stays Records-only;
- counter/popover/full route share identical source set.

### Component/route

Keyboard/focus/escape/return, zero/one/five/more-than-five counts, stale link, owner highlight, mobile sheet/route, storage item, error state, and no nested interactive controls.

### Browser

Create deterministic interrupted Compare and incomplete Evaluation fixtures, observe Attention, navigate to owner, recover using owner controls, verify disappearance, verify no paid call from Attention. Repeat across desktop/tablet/390px/200% zoom/reduced motion and multi-tab fixture.

### Commands

```bash
npx vitest run src/lib/attention src/ui src/workspaces
npm run typecheck:web
npm run check
```

## 15. Completion criteria

- Attention contains only actionable, owner-routable source states;
- membership, supersession, ordering, cap, and refresh are deterministic;
- counter/popover/full route agree;
- resolved items disappear from source change without manual lifecycle state;
- no Attention control can execute or mutate work;
- stale/multi-tab/hidden-tab behavior is truthful;
- all automated, route, responsive, accessibility, browser, and full gates pass.

## 16. Assumptions and unresolved implementation discoveries

**Locked assumption:** existing source summaries plus detail repositories expose enough state to determine whether a concrete recovery action exists; when uncertain, exclude rather than guess.

**No product decision remains unresolved.** New Attention categories require a parent amendment or later specification, not ad hoc additions.
