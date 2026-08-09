«Status: Exploratory — non-authoritative. Does not modify current product authority or authorize implementation.»

# Runs IA — Phase 5 & 6: Scenario Trials + Adversarial Review

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Labeling:** `[RF]` · `[DSI]` · `[SJ]` · `[EU]`

---

## Part A — Evidence-Chain Corrections (from adversarial review)

The adversarial review re-verified load-bearing claims against the code and found **4 `[DSI]` overstatements** in the Phase 1/2 evidence that inflate candidate serving claims:

| # | Claim | Correction | Code evidence |
|---|---|---|---|
| C1 | S2/S3/S4: "no text/keyword search" | **FALSE.** Debounced keyword search over `taskTitle + taskExcerpt + modelKeys` ships today. Nuance: `taskExcerpt = prompt.slice(0, 200)` — only first 200 chars of prompt are searchable. | `RunFilters.tsx:60`, `run-repository.ts:317-318`, `RunList.tsx:32-46` |
| C2 | S10: "no provider/model filter at list level" | **FALSE on model half.** `modelKey` filter exists. Provider filter genuinely absent. | `RunFilters.tsx:14,90-96`, `run-repository.ts:323` |
| C3 | S3: "no pagination/virtualization documented" | **FALSE on pagination.** `PAGE_SIZE=50`, `visibleCount`, `hasMore` shipped. Virtualization absent. | `RunList.tsx:21,69` |
| C4 | D.4: "retry run" grain | Ad-hoc retries **append to same record**; only experiment queued retries mint new runIds. D.4's "retry run" is experiment-only. G's "Compare retry chain collapses" is vacuous. | `run-controller.ts:603-606` |

**Consequence:** A/F's "keyword search, index-backed filters, virtualized list" are partially rebuilding shipped features. The honest delta is: URL persistence, grouping/counts, provider filter, full-prompt search, virtualization. Gap 1 severity is **understated**: lease TTL 10s vs 3s heartbeat means any >10s heartbeat gap (laptop sleep, tab throttling) orphans a live run.

---

## Part B — Scenario Trial Matrix (snapshot)

| Scenario | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| S1 just-completed | 1c | 1c+btn | 1c+roundtrip | 1c | 1c (EV home) | 1c | 1c (entry) |
| S2 prompt fragment | +kw | +kw (drawer) | +fac+scan | +kw (Evid) | +kw+facet | +kw | time-scan |
| S3 500-1k | ok | ok | **deg** | ok | ok | ok | browse-ok |
| S4 ~10k | ok+retention | ok+retention | **brk** | ok (unbounded) | ok+retention | ok (decl.) | browse-ok |
| S5 many child runs | containers | containers | E-owned | From-eval seg | experiment facet | containers+E seg | collapse |
| S6 eval→judge | 1c | 1c | 1c | 1c | 1c | 1c | 1c |
| S7 deep-link origin | res | res | res | part | res | res (?reopen) | part |
| S8 forgotten origin | grp+counts | grp+counts | grp+fac (weaker) | Evidence seg | facet rail | grp+counts | badge only |
| S9 failed halfway | desk | desk | manual | Attention seg | manual | desk | strip |
| S10 provider failure | facet set | facet set | facet (decay) | facet set | facet set | facet set | **deg** |
| S11 relaunch w/ config | rel+lineage | rel+lineage | rel, **no lineage** | part | rel+lineage | rel+lineage+?reopen | part |
| S12 return after absence | attention desk | **push badge** | manual | Attention seg | manual facet | attention | **strip** |
| S13 never terminal | truth+rec | truth+rec | truth, rec-part | truth+rec | truth, rec-part | truth+rec | truth+strip |
| S14 cross-run | bounded diff | bounded diff | fenced | fenced | fenced | bounded diff | fenced |
| S15 remove w/o breaking | guard | guard | **blocked** | **blocked** | guard+curate | declared | guard unspec. |
| S16 fresh install | C-first | 2+drawer | C-first | C-first | EV home | C-first | J home |
| S17 Compare-primary | neutral | **best fit** | **best fit** | neutral | **worst fit** | neutral | moderate |
| S18 Evaluations-primary | ok | ok | **best fit** | struct (seg) | ok+cost | struct (E seg) | ok (collapse) |
| S19 fusion→run | dead | dead | dead | dead | **populates B7** | dead | dead |
| S20 legacy | legacy grp | legacy grp | residue owner | Evidence seg | legacy facet | legacy grp | badge |
| S21 copy link | fixed | fixed | fixed | fixed | fixed | fixed | fixed |

**Four sharpest splits:**
1. Keyword search: A/B/D/E/F vs C vs G
2. Retention: A/B/E/G(+F declared) vs C/D
3. Recovery push vs pull: A/B/D/F/G vs C/E
4. Ad-hoc relaunch lineage: A/B/E/F vs C/D/G

---

## Part C — Adversarial Findings by Reviewer Lens

### Reviewer 1 — Jobs / Operations / Lifecycle

**Shared-substrate failures (hit all candidates with reconciliation/recovery):**

- **L1. Two status systems, one event, two stories.** In-memory `StudioState` and persisted `RunStatus` can disagree; cross-tab lease syncs execution writes only, never UI reads. `[RF — A0 layered model]`
- **L2. Reconciliation kills live runs.** Boot reconciliation must take over the lease/fence to write `interrupted`; takeover increments the fence → surviving tab's next write fails → `LEASE_LOST` → in-memory abort of a merely-throttled run. With 10s TTL, this is common, not edge. `[RF — execution-lease.ts]`
- **L3. Recovery loops never terminate.** Handoff creates a new run with `reusedFrom`; no candidate specifies closing out the source record. Attention set is monotonic — "needs attention" flags stay forever. `[DSI]`
- **L4. Badge lies.** "Orphaned/live" computed from 10s TTL lease expiry flickers with heartbeat timing — reintroduces J5-corrupts-J16 pattern in badge form. `[DSI]`

**Per-candidate:**

| Candidate | Key failure |
|---|---|
| **A** | Double recovery UI (desk re-implements experiment dialog, no precedence); Delete's "zero inbound refs" can't see external hash URLs; archive conflicts with E.3 immutability; same-task diff relies on prompt-string equality (no task identity for ad-hoc) |
| **B** | "Identical coverage to A" asserted but unsubstantiated — no ad-hoc handoff target (Compare never reconstructs from record); drawer is wrong container for durable artifact |
| **C** | Ad-hoc origin-routing degenerates to RecentRuns (fails at scale); omits retention; omits recovery mechanism beyond "boot reconciliation" |
| **D** | Internal contradiction (S15/S20 claimed served while J10 deferred); segment membership is property of question not record; breaks J1 (splits timeline); Evidence becomes 10k-row surface |
| **E** | Misdiagnoses gap 3 (vacuum is policy not ownership); "nobody mutates records" boundary already false; root redirect adds hop to every session |
| **F** | Pseudo-independence (same evidence, same pipeline = overfitting not corroboration); inherits A's failures |
| **G** | Brokenness ≠ frequency (J5 proven broken, never proven frequent); relaunch > resume (only existing ad-hoc recovery); collapse hides distinct failures from audit |

### Reviewer 2 — Provenance / Scale / Grain

- **R1. Growth engine unaddressed at source.** All candidates build retention UX on unmeasured deletion demand; none questions the retry-run minting itself (experiment retries could append in-place like ad-hoc retries). `[DSI]`
- **R2. B's "source neutrality" is surface-deep.** Evaluation runs are bidirectionally linked + recoverable; ad-hoc runs have zero origin fields. A neutral drawer shows indistinguishable rows with divergent affordances. `[RF — C.5, B2]`
- **R3. Retry grain invisible in every list except G.** No candidate adds run→run sibling navigation from Run Detail — forcing detour through experiment ledger. `[DSI]`
- **R4. Copy-link ships a link that fails everywhere but this browser.** HashRouter + IndexedDB = same-browser-only; every candidate adds copy-link as if it were sharing. Real constraint is data mobility. `[RF — C.6, D.1]`
- **R5. Ad-hoc lineage is unimplementable as specified.** `reusedFrom` is per-`CandidateAttempt`; a fresh ad-hoc relaunch has no candidate attempts at creation time. Must be record-level or Compare must pre-seed. `[RF — run-types.ts:193-197]`
- **R6. Deep-link integrity vs retention.** Only A's archive-only-for-children protects S6's one-click cell→judge-attempt path; E/G/F retention unspecified against backlink web + immutable-snapshot promise. `[RF — E.3, C.3]`
- **R7. Scale claims overinflated.** Shipped search + filters + pagination make S2/S8 tractable at 500-1k; real missing pieces are URL persistence, counts/grouping, provider filter, virtualization, full-prompt search. `[RF — code verification]`

### Reviewer 3 — Product-Model Counterfactual

| Candidate | Assumption whose failure kills it | Strongest competing explanation |
|---|---|---|
| **A/F** | Corpus jobs deserve a nav destination; serving fixes earn the slot | The slot was earned by authority fiat (DECISIONS #7); four top-level route families already exist; the 7 changes work identically under any placement, undercutting "must earn it" |
| **B** | Corpus browsing is low-frequency; records are secondary | The run record is the **only durable output** of both workflows; Compare is ephemeral. Demoting the only durable artifact while promoting ephemeral generators is structurally inverted |
| **C** | Origin-known jobs dominate; origin-routing beats one corpus | Origin is **unrecoverable for the majority of records** (ad-hoc has zero origin fields); origin-routing degenerates to RecentRuns (fails at scale). C is the only candidate that can fail by doing nothing |
| **D** | The collection is an accidental compression of incompatible contracts | The one-collection design is **deliberate uniform-contract engineering** — single schema, one fence/lease, one ID scheme, one table pair. The UI's flatness is the accident, not the storage. If diagnosis is wrong, D adds hops for no gain |
| **E** | The corpus is the core compounding asset; prominence = audit quality | The compounding asset is the **suite layer** (versioned profiles, immutable experiment snapshots); runs are leaf evidence. S6 refutes prominence-as-quality (deepest audit path exists with zero prominence change) |
| **G** | Continuity/resumption is the organizing principle | Resumption is proven **broken**, never proven **frequent**. If users relaunch (the only existing ad-hoc recovery path), G is a diary of work never re-opened. Collapses to status quo + rename at reversal-level cost |
| **Cross-cutting** | Two-workflow hypothesis (B) vs one-pipeline reality | CLAUDE.md principle 1: **one** pipeline spine serves both; "two workflows" is surface-level; the corpus is shared memory; A-vs-B is a habit question `[EU]` |

---

## Part D — Predeclared Decision Frame

### Criteria (frozen before seeing candidate performance)

| # | Criterion | Type |
|---|---|---|
| 1 | Clarity of primary product purpose | Design judgment |
| 2 | Match to actual session-level jobs | Repository-factual + empirical |
| 3 | Source neutrality (Compare vs Evaluations) | Repository-factual |
| 4 | Run lifecycle correctness | Repository-factual |
| 5 | Provenance/auditability | Repository-factual |
| 6 | Recovery/debugging usefulness | Design judgment |
| 7 | Discoverability at moment of need | Design judgment |
| 8 | Scalability with large corpora | Repository-factual + empirical |
| 9 | Treatment of mixed record grains | Repository-factual |
| 10 | Deep-link coherence | Repository-factual |
| 11 | Conceptual honesty | Design judgment |
| 12 | Scope discipline | Repository-factual |
| 13 | Unnecessary persistent UI prominence | Design judgment + empirical |
| 14 | Extensibility without premature roadmap | Design judgment |

### Empirical unknowns that still decide between candidates

| Unknown | Distinguishes | Observable |
|---|---|---|
| Corpus-browsing frequency | A/F vs B | Navigation visit rate to /runs vs /compare |
| Origin-memory reliability | C vs all | Whether users remember if a run came from Compare or Evaluations |
| Recovery-session frequency | A/F vs B | How often users resume vs relaunch |
| Whether corpus is seen as core asset | E vs all | Whether users browse runs as primary activity |
| Resumption/continuity frequency | G vs all | How often users return to unfinished work vs start fresh |
