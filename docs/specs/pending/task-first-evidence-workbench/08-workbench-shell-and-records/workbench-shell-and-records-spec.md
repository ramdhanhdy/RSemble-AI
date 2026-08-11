# Future Workbench Shell and Secondary Records Specification

**Status:** Pending
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Order:** 07
**Dependencies:** 03 Task Sets and Evaluations; 05 Contextual Compare Results; 06 Model Evidence Profiles

---

## 1. User outcome

The application presents one simple primary product:

```text
Compare · Evaluations · Models
```

Users revisit meaningful comparison results inside Compare, ordinary evaluation executions and existing Fusion Studies inside their Task Set, and cumulative evidence inside Models. Exact execution and study records remain easy to search and inspect through a secondary **Records** utility, including every existing `/runs/:runId` and Fusion Study deep link.

This is not a cosmetic Runs → Records rename. It changes ownership while preserving the operational ledger.

## 2. Entry gate

This child must not begin until:

- Compare has functional previous-result routes and recovery;
- Task Sets own functional ordinary evaluation history/results/recovery and existing Fusion Studies;
- Models has functional qualified evidence profiles;
- every old run/result can resolve its owning context or an explicit legacy state.

No inert primary destination may ship.

## 3. Final shell

### 3.1 Primary navigation

Desktop and mobile primary navigation contains exactly:

```text
Compare
Evaluations
Models
```

`aria-current`, route matching, focus behavior, safe-area spacing, and 44px touch targets remain correct.

### 3.2 Secondary utilities

Header/global utilities contain:

```text
Search
Attention (added by child 08; absent until then)
Records
Connections / provider readiness
```

Records is visually and semantically secondary. On constrained mobile, secondary utilities live in an accessible menu or dedicated routes rather than a fourth primary bottom-nav item.

### 3.3 Rank/Fuse control

Rank/Fuse remains Compare-specific. It never appears as a global workspace switch or in Records/Evaluations/Models.

### 3.4 Global execution awareness

The current global execution strip remains cross-workspace awareness only. Clicking it navigates to the owning Compare/Evaluation execution. It does not make Records or Models an execution owner.

## 4. Records domain

Records is a typed union/read model:

```ts
type RecordReference =
  | ComparisonRecordReference
  | EvaluationExecutionReference
  | FusionStudyReference
  | TaskExecutionRecordReference
  | ObservationRecordReference
  | LegacyRecordReference;
```

The union allows one retrieval surface while preserving type-specific identity and routes. An Evaluation Result is not coerced into RunRecordV2, and an Observation is not a copied run.

### 4.1 Record type responsibilities

- **Comparison:** semantic result reference, owner `/compare/results/:id`, exact leaf run available.
- **Evaluation:** aggregate execution reference, owner `/evaluations/results/:id`, task executions beneath it.
- **Fusion Study:** exact study reference, owner `/evaluations/sets/:taskSetId/fusion/:studyId`, recipes/pools/trials/attempts/experimental observations/playbook beneath it.
- **Task execution:** exact RunRecordV2/provenance envelope.
- **Observation:** derived evidence reference with exact source links.
- **Legacy:** preserved summary/import that cannot safely resolve richer semantics.

## 5. Records surfaces

### 5.1 Quick drawer

Desktop header Records opens a bounded drawer for recent and searched records:

- grouped by Compare, Evaluations, and Legacy/other typed sources;
- type, status, title, model/roster, time, and owning-context hint;
- search by exact ID and indexed safe metadata;
- **View all records** opens `/records`;
- selecting a semantic result opens its owning context by default;
- selecting an exact task execution opens exact record detail.

The drawer is not the only way to reach an exact deep link.

### 5.2 Full Records utility

Canonical routes:

```text
/records
/records/:recordType/:recordId
```

The full utility preserves current Runs strengths:

- complete-set filtering before pagination;
- search, model, status, mode, source/type, date, and exact-ID filters;
- deterministic sorting and stable pagination;
- responsive list/detail layout;
- exact status timeline, attempts, messages, judge/fusion/verifier evidence, costs, errors, source, and timestamps for RunRecordV2;
- typed detail for Evaluation, Observation, and Legacy references;
- local copy link and export actions;
- backlink to owning context.

### 5.3 Actions boundary

Allowed:

- Open owning Compare/Evaluation/Task/Model context;
- Open exact evidence;
- Copy device-local link;
- Export exact record or current safe archive action;
- Load configuration in Compare as an explicit handoff that does not execute or fabricate outputs.

Forbidden:

- Retry, re-judge, re-fuse, repair, resume, add model, or make paid calls;
- define retention, deletion, or archive lifecycle;
- mutate Task, Task Set, Rubric, Observation, or model profile state.

Execution actions live after navigation in the owning context.

## 6. Route compatibility

- `/runs` aliases or redirects to `/records` while preserving supported query filters.
- `/runs/:runId` continues rendering the exact RunRecordV2 detail and may keep the old URL unchanged to preserve copied links.
- `/records/task-execution/:runId` may be the canonical new exact-record route, but copy-link compatibility tests keep `/runs/:runId` valid.
- unknown IDs show typed not-found/recovery options, not an empty shell.
- direct load, refresh, hash-router, back/forward, and focus restoration are tested.

## 7. Ownership/backlink resolution

A pure resolver maps a Record reference to:

```ts
interface OwningContextResolution {
  ownerKind: "compare" | "evaluation" | "task" | "model" | "legacy";
  ownerHref: string | null;
  ownerLabel: string;
  confidence: "exact" | "crosswalk" | "unresolved";
  reason: string | null;
}
```

Unresolved legacy origins remain labeled. The resolver never chooses a latest Task Set/Task version when the historical owner is unknown.

## 8. Migration and data behavior

- current Run summaries/details are indexed as task execution Records without changing payloads;
- child 05 Comparison indexes, child 03 Evaluation Executions, and child 03 Fusion Study owner crosswalks create semantic Record references;
- child 04 Observations create evidence references;
- existing legacy localStorage imports remain Legacy Records;
- repeated index rebuild is idempotent;
- source deletion is not added;
- current DataArchiveActions remain accessible from Records/settings; child 09 completes and hardens the archive v2 format already extended by schema-owning children.

## 9. UI composition and current files

Expected seams include:

- `src/app-router.tsx`;
- `src/ui/WorkspaceNav.tsx`;
- `src/ui/MobileWorkspaceNav.tsx`;
- `src/ui/Header.tsx`;
- `src/ui/CommandPalette.tsx`;
- `src/ui/GlobalExecutionStrip.tsx`;
- `src/workspaces/RunsWorkspace.tsx` and Run list/detail/filter components, refactored into Records rather than discarded;
- Compare/Evaluation/Model owning routes from children 03/05/06.

Existing Runs list/filter/detail logic is a production foundation. Rename/refactor only after characterization tests preserve behavior.

## 10. Responsive/accessibility behavior

- Desktop: primary nav, secondary utilities, optional Records drawer, full Records split view.
- Tablet: primary nav remains clear; Records uses route/full-screen panel if drawer would crowd.
- Mobile: three-item bottom nav; Records reachable through top/overflow utility and full-screen route; exact deep links remain usable.
- 200% zoom: utilities wrap/collapse without hiding current execution or primary nav.
- Drawer/dialog focus is trapped and restored; Escape closes; background is inert.
- Record rows are real links; no nested anchors or row/button ambiguity.
- Type/status is not color-only.
- Long IDs/model names/titles wrap; per-row rects stay inside cards.

## 11. Non-goals

- global cross-entity search implementation (child 09);
- Attention behavior (child 08);
- new execution/recovery logic;
- retention/delete/data mobility policy;
- new universal result entity;
- model evidence aggregation changes;
- new providers or prototype-only model roster;
- embedding search.

## 12. Implementation sequence

1. Characterize current Runs query, filter, pagination, detail, copy-link, export, and preload behavior.
2. Define typed Record references and pure owning-context resolver.
3. Build Records repository/read model over existing indexes.
4. Refactor Runs components into typed Records list/detail without route breakage.
5. Add quick drawer and full `/records` utility.
6. Switch primary desktop/mobile navigation to Compare · Evaluations · Models.
7. Add secondary Records utility and execution-strip owner links.
8. Add `/runs` aliases and exact deep-link compatibility.
9. Remove ordinary-history links to Runs and reconcile current authority docs/comments.
10. Run full route, responsive, accessibility, and browser gates.

## 13. Validation plan

### Pure/repository

- every source type resolves correct owner or explicit unresolved state;
- evaluation aggregate is never parsed as RunRecordV2;
- exact ID/type filters and complete-set pagination remain deterministic;
- repeated index rebuild produces no duplicates;
- no Records API exposes mutation/execute methods.

### Component/route

- primary nav exactly Compare/Evaluations/Models;
- no Runs primary link or label in current UI;
- drawer open/search/group/select/view-all/focus-return;
- full Records current filter/detail behavior preserved;
- owner backlinks exact;
- `/runs`, `/runs/:id`, `/records/...` direct-load/refresh/back-forward;
- Open in Compare remains configuration-only;
- local copy-link wording preserved.

### Regression

All current Runs tests are migrated/retained, not deleted to make the rename pass. Exact status timelines, retries/attempts, evidence sections, errors, costs, and archive actions remain covered.

### Browser

Compare/Evaluations/Models navigation; Records drawer and full utility; exact legacy deep link; owner round-trip; mobile menu; 390px; tablet; desktop; 200% zoom; keyboard; reduced motion; long records; empty/error/loading; element overflow; secret probe.

### Commands

```bash
npx vitest run src/ui src/workspaces src/lib/persistence
npm run qa:design-motion
npm run typecheck:web
npm run check
```

## 14. Completion criteria

- primary nav is Compare · Evaluations · Models on desktop/mobile;
- every destination is functional at release time;
- Records is secondary and typed, not a renamed universal Runs workspace;
- existing Runs search/filter/pagination/detail/export/preload strengths remain;
- `/runs/:runId` and imported legacy records remain reachable;
- all retry/recovery/paid actions live only in owners;
- no data retention/deletion scope sneaks in;
- all automated, route, responsive, accessibility, browser, and full gates pass.

## 15. Assumptions and unresolved implementation discoveries

**Locked assumption:** existing Run list/detail components can be behavior-preservingly extracted into typed Records surfaces; if not, their characterization tests remain the contract during replacement.

**No product decision remains unresolved.** An unresolved historical owner stays explicitly Legacy/Unresolved and opens exact evidence; it is never guessed.
