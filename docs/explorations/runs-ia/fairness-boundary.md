«Status: Exploratory — non-authoritative. Does not authorize application changes or modify current product authority.»

# Runs IA — Fairness Boundary

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Basis:** Previous exploration artifacts + code verification at HEAD `0b01e69`
**Labeling:** `[RF]` Repository fact · `[DSI]` Derived structural inference · `[SJ]` Scenario-based design judgment · `[EU]` Empirical unknown

---

## 1. S/P/N/X Classification of Proposed Changes

**Bright-line rule for P:** If a future product specification would describe the behavior as a durable product rule rather than a presentation/navigation rule, classify it as P.

| # | Item | Class | Needed under | Baseline contamination? | Reasoning |
|---|---|---|---|---|---|
| 1 | Compare → View persisted Run | **S** | both | **No** | `runIdRef` holds persisted `run-*` id but never surfaces to UI. Fix = expose runId to live result + link. Pure connective tissue. `[RF]` |
| 2 | Evaluation → child Run access | **X** | neither | No | Already adequate: ResultMatrix cells deep-link `/runs/:runId?candidate=&attempt=`, ledger "View run", coverage-issue links. Nothing to add. `[RF]` |
| 3 | Run Detail → Compare (reconstruct config) | **S** | both | **No** (without lineage) | Record freezes everything needed: task, mode, evaluation profile snapshot, candidates, judge, reasoning. Reducer actions exist for every field. Only gap: dispatch wiring from RunsWorkspace → RSemble-level reducer. `[RF]` |
| 4 | Copy-link affordance | **S** | both | **No** | No share/copy-link UI exists. HashRouter makes deep links copyable. Fix = UI button with honest "this device" label. `[RF]` |
| 5 | URL-persistent filters | **S** | both | **No** | Filters are `useState` component state (RunList.tsx:30), not URL params. Fix = serialize to URL. Presentation only. `[RF]` |
| 6 | Grouping/counts | **S** | both | **No** | Flat ungrouped `<ul>` (RunList.tsx:120-153). No grouping/counts. Fix = query-view presentation. `[RF]` |
| 7 | Provider filter | **S** | both | **No** | Zero provider references in RunFilters. Feasible: provider derivable from modelKey prefix. No schema change. `[RF]` |
| 8 | Full-prompt search | **S** | both | **No** | `taskExcerpt = prompt.slice(0, 200)` (run-record-builder.ts:781). Full prompt persisted but never indexed. Fix = extend derived search index. No record-semantic change. `[RF]` |
| 9 | Virtualization | **S** | both | **No** | Pagination ships (PAGE_SIZE=50); no virtualization. Rendering optimization only. `[RF]` |
| 10 | Badges / attention surfaces | **N** | both (different designs) | **Yes** | Any badge design depends on placement (A's nav badge vs B's action-zone button). Proactive attention inflates the measured variable (Runs-visit frequency) — would confound the experiment. Park until placement decision. `[DSI]` |
| 11 | Segmented views | **N** | A only (parked) | No | D's proposal, absorbable into A as views. Direction parks segmentation pending compression-diagnosis measurement. Not needed under B. `[DSI]` |
| 12 | Reconciliation (boot-time) | **X** | neither | No | **Already ships at HEAD.** `ExperimentControllerProvider` runs `recoverInterruptedRuns` at startup → `sweepInterrupted` (execution-lease.ts:192-245): liveness-checked, ad-hoc-only, fenced CAS update. Previous exploration's gap #1 is stale. `[RF]` |
| 13 | Lineage (ad-hoc `rebasedFrom`/`reusedFrom`) | **P** | both | **Yes** | `reusedFrom` exists only per-CandidateAttempt on experiment path. Adding record-level lineage = new persisted field + validators + summary schema → changes durable-record meaning. `[RF]` |
| 14 | Archive/delete/retention | **P** | both | **Yes** | No `deleteRun`/`removeRun` exists. Archive/delete destroys/re-hides durable records = new authority. `[RF]` |
| 15 | Run Detail → Compare WITHOUT new lineage | **S** | both | **No** | A contextual bridge exists: dispatch frozen config from record into Compare reducer, navigate to `/compare`. Old record untouched, no lineage written. New run created on execute (`source:{kind:"adhoc"}`). Fidelity caveats: attachments not restorable (metadata-only by design), unavailable providers render as unavailable slots. `[RF]` |

### Classification summary
- **S (serving/connective tissue):** 9 items — #1, 3, 4, 5, 6, 7, 8, 9, 15
- **P (product-semantic):** 3 items — #13 (lineage), #14 (retention), lineage-half of #4
- **N (navigation/candidate-dependent):** 2 items — #10 (badges), #11 (segments)
- **X (not justified):** 2 items — #2 (already adequate), #12 (already ships)

### Evidence correction: Gap 1 (reconciliation) is closed at HEAD
`[RF]` `ExperimentControllerProvider` (wraps whole app, main.tsx:16) runs startup recovery on mount → `lease.recoverInterruptedRuns(repo)` (experiment-controller-context.tsx:59-76) → `sweepInterrupted` (execution-lease.ts:192-245): acquires a short lease, sweeps stale ad-hoc `running` records → `interrupted` via fenced CAS update; liveness-checked (skips runs owned by current lease holder under exact current fence), ad-hoc-only (skips experiment runs), idempotent. The previous exploration's gap #1, L2 risk, and "interrupted is experiment-only" are all stale.

---

## 2. Minimum Fairness Baseline

**Purpose:** A user should not be forced to visit the Runs collection merely to inspect a record whose context they already possess.

The minimum fairness changes are the S-class items that remove forced navigation through Runs:

| # | Change | What it fixes | Why it's fair |
|---|---|---|---|
| 1 | Compare → "View record" link on live result | User must hunt in Runs for the run they just watched | Removes forced Runs visit for the most common post-execution job |
| 15 | Run Detail → "Open in Compare" (no lineage) | User must manually reconstruct config to relaunch | Removes forced manual transcription; no persisted semantics change |
| 4 | Copy-link UI ("this device") | User must hand-copy URL from address bar | Removes friction for same-device deep-linking |
| 5 | URL-persistent filters | Filter state lost on navigation/reload | Removes forced re-filtering on every revisit |
| 6 | Grouping by source + counts | Mixed grains in flat feed | Makes corpus composition legible without improving the destination itself |

**Items NOT in the minimum fairness baseline:**
- #7 (provider filter), #8 (full-prompt search), #9 (virtualization): serving improvements, not fairness fixes — they improve the Runs *destination*, which is frozen (see §3)
- #10 (badges), #11 (segments): navigation-dependent — parked
- #13 (lineage), #14 (retention): product-semantic — deferred

**Run Detail → Compare deep-dive (item 15):**

The record already provides everything needed `[RF]`:
- `record.task {title, prompt, systemPrompt, temperature}` — complete task
- `record.mode: "rank"|"fuse"` — preserved
- `record.evaluation.profile: EvaluationProfileSnapshot | null` — self-contained (criteria, weights, judgeInstruction, complianceInfluence)
- `candidates[]{modelKey, providerId, model, slug}` → ModelSlot reconstruction
- `judge.attempts[0]{providerId, model, instruction}` → CriticRef
- `record.reasoning` → SET_REASONING_POLICY

What it takes (wiring only, no schema change):
1. "Open in Compare" action in RunDetail
2. Dispatch channel from RunsWorkspace → RSemble-level reducer (context or custom event — plumbing, not a record field)
3. Preload sequence dispatching SET_* actions + slot swaps + `navigate("/compare")`
4. On execute, `runFanout` creates a **new** run (`source:{kind:"adhoc"}`); old record untouched, no lineage written

Fidelity caveats (presentation-level, not semantic):
- Attachments cannot be restored (metadata-only persisted by design, CLAUDE.md P4) — drop with a notice
- "Profile" vs "custom" origin is ambiguous from the record (cosmetic)
- Providers no longer configured render as unavailable slots (preflight gates the run — existing behavior)

Why this is S, not P: a future product spec would describe this as "Open a run's configuration in Compare" — a navigation/presentation rule, not a durable product rule. The record, its lifecycle, and lineage semantics are untouched.

---

## 3. Runs Destination Freeze

> **No Destination Enhancement rule:** Until the navigation decision is made, do not improve the Runs destination merely because improvements are useful in isolation.

**Frozen changes:**
- New segmentation or smart views
- Advanced filtering beyond current shipped features
- New browsing modes
- Dashboard-like counts
- "Needs Attention" redesigns
- Corpus-management tools
- Major grouping architecture (grouping in the fairness baseline is list-level query-view presentation, not destination redesign)
- Destination-specific badges
- Renaming/repositioning

**Reason:** Improving the Runs destination during the experiment would progressively implement Candidate A and contaminate the comparison.

### A-by-accretion test

> "Does the union of supposedly neutral changes amount to a redesigned first-class Runs workspace?"

| Fairness-baseline item | Is it A-by-accretion? |
|---|---|
| Compare → View record | No — lives in Compare, not Runs |
| Run Detail → Open in Compare | No — lives in Run Detail, not the Runs list |
| Copy-link UI | No — single button, not destination redesign |
| URL-persistent filters | No — filter persistence, not new filters |
| Grouping by source + counts | **Borderline** — makes the list grouped vs flat. Test: does this make Runs *more* of a destination? It makes composition legible, which is fairness (user can see what's there). It does NOT add new capabilities, segments, or browsing modes. |

**Verdict:** The fairness baseline does NOT amount to A-by-accretion. Grouping is the closest call; it's included because mixed grains in a flat feed is an existing deficiency that forces Runs visits (user can't tell what they're looking at), not a new destination enhancement. If the Executive Engineer disagrees, grouping can be dropped from the fairness baseline without affecting the other items.

**What WOULD be A-by-accretion (and is frozen):**
- Provider filter, full-prompt search, virtualization (#7, #8, #9) — these improve the destination's capability
- Badges/attention surfaces (#10) — new proactive mechanism
- Segmented views (#11) — new internal navigation
- Recovery desk, same-task diff, retention (#13, #14) — new product semantics

---

## 4. Candidate D Split

### D-Presentation (compatible with both A and B)
- Segmented views as **query views, not record partitions** — a run legitimately appears in multiple segments simultaneously `[DSI]`
- Grain discrimination as a surface choice, not per-row label reading `[SJ]`
- Segment routes additive within `/runs`; no nav/authority reversal `[SJ]`
- "D's segments are absorbable into A as views if the compression diagnosis validates" (direction.md §6) — and nothing prevents a drawer context (B) `[DSI]`

### D-Semantics (product rules — belong in P, deferred)
- The diagnosis that the collection is an accidental compression of incompatible jobs — contested by Reviewer 3: the one-collection design is deliberate uniform-contract engineering (single schema, one fence/lease, one ID scheme, one table pair). "The UI's flatness is the accident, not the storage." `[DSI]`
- What counts as "Needs Attention" — product semantics `[SJ]`
- When interrupted work is abandoned — lifecycle behavior `[SJ]`
- Whether records are archived — retention policy `[SJ]`
- Record partitioning / storage changes — none proposed survive; D survives only weakened, as views `[DSI]`

**Decision:** Do not implement either D category during this task unless required for the fairness baseline. D-Presentation may eventually exist inside either A or B. D-Semantics are product decisions that require explicit authority.

---

## 5. Special Scrutiny: Run Detail → Compare

The previous exploration associated "Open in Compare" with new lineage semantics (`rebasedFrom`). This follow-up explicitly separates them:

| Component | Classification | Status |
|---|---|---|
| Contextual bridge (load frozen config into Compare, no lineage) | **S** | In fairness baseline |
| `rebasedFrom` record-level lineage | **P** | Deferred — not in fairness baseline |

The bridge does NOT:
- Alter the old Run (no mutation, no new field)
- Introduce new persisted lineage semantics (no `rebasedFrom`, no `reusedFrom`)
- Claim the new execution is a continuation (new run gets `source:{kind:"adhoc"}` — same as any fresh Compare run)
- Change product semantics (it's a navigation/presentation rule)

If a future product decision authorizes ad-hoc lineage, that is a separate P-class change requiring explicit authority.
