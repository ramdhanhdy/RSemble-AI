«Status: Exploratory — non-authoritative. Does not modify current product authority or authorize implementation.»

# Runs IA — Phase 4: Competing Information-Architecture Models

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Basis:** Phase 1 evidence + Phase 2 jobs/scenarios + Phase 3 blind model
**Labeling:** `[RF]` · `[DSI]` · `[SJ]` · `[EU]`

---

## Candidate Summary

| Candidate | Nav | Runs position | Core thesis | Authority cost |
|---|---|---|---|---|
| **A** | Compare \| Runs \| Evaluations | First-class, rebuilt | Gaps are serving gaps; rebuild Runs as corpus workspace | Amendments |
| **B** | Compare \| Evaluations + Records drawer | Demoted to secondary | Corpus is low-frequency; two workflows + global utility | Reversal of #7 |
| **C** | Compare \| Runs \| Evaluations | Unchanged, reweighted | Origin-routed discovery; Runs as fallback | Minimal |
| **D** | Compare \| Runs \| Evaluations | One destination, 4 segments | Collection is accidental compression of incompatible jobs | Amendments |
| **E** | Evidence \| Compare \| Evaluations | Home (renamed) | Corpus is core asset; Compare/Evaluations are instruments | Reversal of root redirect + amendments |
| **F** | Compare \| Runs \| Evaluations | First-class, redesigned serving | Blind-derived: gaps are serving, not placement | Amendments |
| **G** | Compare \| Runs (Journal) \| Evaluations | Home (reframed as Journal) | Activity/continuity is the organizing principle | Reversal of root redirect + amendments |

---

## Candidate A — First-class Runs, rebuilt as Corpus Workspace

**Thesis:** `[SJ]` The evidence's gaps are serving gaps, not placement gaps. Runs keeps its top-level position but must earn it through 7 concrete changes.

### Navigation
Keep Compare | Runs | Evaluations. Runs item gains a nav badge when needs-attention count > 0.

### The 7 changes
1. **Corpus, not feed** — grouped-by-source default (ad hoc · experiment containers · legacy), per-group counts
2. **Query bar with URL-param persistence** — source/status/date/provider/model/keyword filters in URL params
3. **Truthful lifecycle** — boot reconciliation marks orphaned `running` as `interrupted(session-closed)`; extends `interrupted` to ad-hoc
4. **Recovery desk with handoff** — "Needs attention" section; "Recover" opens Compare with frozen config loaded + retry target; writes `reusedFrom` for ad-hoc
5. **Bounded cross-run analysis** — same-task pairwise diff (config delta, outcome delta); no aggregates/leaderboards
6. **Retention with link integrity** — Archive (hide, reversible) + Delete (only when zero inbound references); evaluation child runs are archive-only
7. **Corpus-scale machinery** — virtualized list, time-bucketed browsing, index-backed filters, keyword search

### Job serving: 15/19 fully served, 3 partial (J6 fenced, J8 per-record only, J18 data absent), 1 contract-only (J19)

### Authority deltas: amendments to audit-surface doctrine (add handoff); new retention authority; `interrupted` extended to ad-hoc; `reusedFrom` for ad-hoc

### Risk: kitchen-sink complexity; mitigated by handoff pattern (Runs proposes, Compare disposes)

---

## Candidate B — Two primary workflows + secondary "Records" drawer

**Thesis:** `[SJ]` Corpus browsing is low-frequency `[EU]`; two workflows + global utility is cleaner nav.

### Navigation
Compare | Evaluations + global "Records" button in header action zone → slide-over drawer. Route-invariant (same button every route, no Rank/Fuse). Mobile: 2 items + Records action.

### What "secondary" means
1. Non-destinational (opens over any workspace, never takes over)
2. Deferring (list + filter + handoff only; full inspection navigates to durable `/runs/:runId` route)
3. Push-capable (badge: live leases + recoverable + orphaned count)

### Naming: "Records" (not "History" — browser collision; not "Archive" — wrong for recoverable; not "Evidence" — collides with Run Detail)

### Source neutrality: the drawer is the only cross-surface corpus view; neither workflow owns it

### Job serving: identical coverage to A; mechanisms re-phrased for drawer context

### Authority deltas: **reversal of PRODUCT.md §1 / DECISIONS #7 / CLAUDE.md principle 7** (three workspaces → two + global action); #10.4 amendment (one button in action zone)

### Risk: utility bloat (needs nearly everything A's Runs has); discovery decay if users ignore the button; **entire case rests on corpus-browsing frequency being low** `[EU]`

---

## Candidate C — Context-owned evidence

**Thesis:** `[DSI]` Discovery is routed by *origin*, not by one corpus. Evaluation runs through Evaluation provenance; Compare runs through Compare-adjacent recency. A global list survives as deliberate fallback for forgotten-origin and corpus-level jobs.

### Navigation
Unchanged. All change is inside surfaces — no routes, no nav, no schema changes.

### Workspace boundaries
- Compare owns its output: live result gains "View record" link (gap 2); Run Detail gains "Open in Compare" (gap 4)
- Evaluations owns its children: matrix/ledger stay primary path; one-click evidence cells already work `[RF]`
- Runs owns the residue: legacy rows, forgotten-origin retrieval (S8), corpus-level set queries (S10), immutable audit identity (J9)

### Stress tests
- S8 (forgotten origin): global list with grouping + counts + facets answers it; weaker than structural separation but wins on more frequent origin-known jobs `[SJ]`
- S10 (provider failure): unified corpus view retained, facet-equipped, demoted in emphasis not deleted

### Job serving: J1/J2/J9 served; J3/J7/J11/J12/J13/J15/J16 improved; J5 fixed (reconciliation); J6/J8/J10 fenced; J19 unchanged

### Authority deltas: minimal — boot reconciliation (new behavior); "Open in Compare" (gap 4 fix); copy-link/URL filters (UI gaps)

### Risk: fallback atrophy; S8/S10 users pay tax; **entire bet rests on origin-known jobs being more frequent** `[EU]`

---

## Candidate D — Decompose Runs by job

**Thesis:** `[DSI]` Today's Runs collection is an accidental compression of at least four incompatible contracts into one flat feed. Evidence: container loss (S5), status lies (S13), dead-end rows (S20), scale asymmetry (S3/S4), serving asymmetry (3 served / 7 partial / 9 unserved).

### Navigation
Unchanged 3-item header. Runs stays one destination with internal segmented nav (mirroring `/evaluations` segmented pattern).

### Segments
| Segment | Contract | Jobs |
|---|---|---|
| **History** | Chronological recall | J1, S1, S2-entry, S11-entry, S17 |
| **Evidence** | Immutable audit + identity lookup + cross-run search | J2, J9, S6, S15, S20 |
| **Attention** | Recovery + status | J3, J5, J16, S9, S12, S13 |
| **From evaluations** | Provenance container | S5, S7, S18 |

Storage management (J10) explicitly deferred — authority gap.

### Grain handling: structural separation replaces per-row label reading. History = ad-hoc-first; From-evaluations = experiment-only; Evidence = all-grain with source facet

### Scale: no single surface renders 10k mixed rows; each segment has bounded contract

### Job serving: J1/J2/J3/J5/J9/J12/J13/J14/J16/J17 fully served; J4/J7/J15/J18 partial; J6/J8/J10 fenced

### Authority deltas: amendments; segment routes additive within `/runs`; boot reconciliation

### Risk: extra hop on cross-contract journeys; segment sprawl; **is the compression diagnosis correct?** `[EU]`

---

## Candidate E — Corpus-first / audit-first

**Thesis:** `[SJ]` The durable evidence corpus is RSemble's core compounding asset. Compare and Evaluations are instruments that feed it. Evidence (renamed Runs) becomes home.

### Navigation
Evidence · Compare · Evaluations. Root redirect changes `/` → `/evidence` (today `/` → `/compare`). Evidence = collection browser (facet rail, list pane, "New Compare" primary action).

### Boundary rule: execution writes; Evidence reads and (newly) curates; nobody else mutates records. Resolves the "who owns the corpus" vacuum (gap 3).

### Job serving: 15/19 fully served (from 3 today), 3 partial, 1 unserved (J6 fenced)

### Key elevations: per-run cost visibility, reload-in-Compare with `reusedFrom` lineage, retention with provenance guard, fusion-study tracing (populate B7 slots)

### Authority deltas: amend PRODUCT.md §1 (Runs→Evidence reframe/home), DECISIONS #7 (prominence), #10.4 (nav order/label); NEW authority for retention, boot reconciliation, ad-hoc lineage

### Risk: inverts the product's center of gravity from production to audit; `[EU]` whether users see the corpus as a core asset or a byproduct

---

## Candidate F — Hypothesis-blind model (frozen from Phase 3)

**Thesis:** `[DSI]` Independently derived three destinations from jobs/grains/lifecycle/provenance — no knowledge of "demote Runs" hypothesis. Converged on three destinations but with different *serving*.

### Navigation
Compare · Runs · Evaluations (same count as current authority, different serving).

### Key serving changes (same as A but framed differently)
- Runs = evidence & recovery corpus: grouped-by-source list with counts, substring search, URL filters, boot reconciliation, per-record cost, copy-link, "Reopen in Compare" (J15), recovery launch
- Compare = "View record" link from live result (gap 2); `?reopen=<runId>` landing
- Evaluations = Experiments segment added to segmented nav

### Convergence note: `[DSI]` "the evidence's gaps are serving gaps, not placement gaps" — independently confirms A's thesis from a blind starting point

### Authority deltas: same as A (amendments, not reversals)

---

## Candidate G — Journal-first / activity-continuity

**Thesis:** `[DSI]` The evidence's sharpest cluster is *continuity*, not retrieval or audit: J5 corrupts J16, three of seven gaps are continuity gaps, J1 is fully served, RecentRuns bridge exists, S12/S13 are "returned after absence" scenarios. No A-E candidate makes activity/time the organizing principle.

### Navigation
Compare | Runs (Journal) | Evaluations. Home = Journal (Runs reframed). Root redirect `/` → journal. Day-grouped timeline + "Continue where you left off" strip.

### Organizing principle: "where was I, and what was I doing?" — corpus browsed as a diary of experiments

### Mixed grains: collapse-by-lineage — experiment's task attempts + retries collapse into one expandable entry; Compare retry chain collapses under original entry. Grain = badge + filter; time is primary, lineage secondary.

### Job serving: 14/19 fully served; J5 is headline job; 4 partial; 1 unserved (J6 fenced)

### Authority deltas: PRODUCT.md §1 (Runs→Journal/home), DECISIONS #7 (prominence), #10.4 (nav weight); NEW authority for reconciliation, retention, ad-hoc lineage

### Risk: `[EU]` shares chronological surface with today's Runs feed; if resumption frequency is low, G collapses toward status quo

---

## Cross-Candidate Comparison

### Shared minimum (candidate-independent gap fixes)
All 7 candidates require: boot reconciliation (gap 1), live-result → record link (gap 2), copy-link UI (gap 5), URL-param filters (gap 6), grouping + counts (gap 7). Retention (gap 3) is new authority in all. `reusedFrom` for ad-hoc is new in all. J19 needs controller work outside IA scope in all.

### Decisive differentiators

| Question | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| Nav count | 3 | 2+drawer | 3 | 3+segments | 3 (reordered) | 3 | 3 (reframed) |
| Runs position | First-class | Demoted | Unchanged | Segmented | Home | First-class | Home (Journal) |
| Root redirect | /compare | /compare | /compare | /compare | /evidence | /compare | /journal |
| Authority cost | Amendments | **Reversal** | Minimal | Amendments | **Reversal** | Amendments | **Reversal** |
| Underlying bet | Corpus jobs deserve a destination `[EU]` | Corpus jobs are rare `[EU]` | Origin-known jobs dominate `[EU]` | Compression diagnosis is correct `[EU]` | Corpus is core asset `[EU]` | (blind) Gaps are serving `[DSI]` | Continuity is the core job `[EU]` |

### The three structural bets
1. **A/F:** Keep three nav, fix serving — gaps are serving gaps, not placement
2. **B:** Two nav, demote corpus — corpus browsing is low-frequency
3. **C:** Three nav, reweight discovery — origin-routed is better than one flat feed
4. **D:** Three nav, decompose — the collection conflates incompatible jobs
5. **E:** Three nav, invert — the corpus is the product's core asset
6. **G:** Three nav, reframe — continuity/activity is the organizing principle

### Empirical unknowns that decide between candidates
| Unknown | Distinguishes |
|---|---|
| Corpus-browsing frequency | A/F vs B |
| Origin-memory reliability | C vs all others |
| Compression diagnosis | D vs A/F |
| Whether corpus is seen as core asset | E vs all |
| Resumption/continuity frequency | G vs all |
| Recovery-session frequency | A/F vs B |
