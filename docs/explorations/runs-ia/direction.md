«Status: Exploratory — non-authoritative. Requires explicit Product Owner approval before any modification of PRODUCT.md, DECISIONS.md, routes, navigation, implementation plans, or application code.»

# Runs Information Architecture — Exploratory Direction

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Method:** 7-phase recursive adversarial exploration (evidence → jobs → blind derivation → candidates → scenario trials → adversarial review → repair + counterfactual → executive gate)
**Executive verdict:** Condition 2 — Empirical boundary reached
**Labeling:** `[RF]` Repository fact · `[DSI]` Derived structural inference · `[SJ]` Scenario-based design judgment · `[EU]` Empirical unknown

---

## 1. Question investigated

Does the Runs workspace deserve its current first-class navigation position, and what information architecture should follow from the jobs the durable run corpus serves?

The exploration was explicitly forbidden from beginning with a conclusion ("Remove Runs from navigation") or a framing ("RSemble has two modes"). The central research question was: *Which session-level jobs require the user to operate on the run corpus itself, rather than on one individual run or its parent Compare/Evaluation context?*

## 2. Repository-grounded findings

### Lifecycle (`[RF]`)
- 6 run states: `running`, `completed`, `partial`, `failed`, `aborted`, `interrupted` — same schema, same tables for ALL runs (ad-hoc + experiment child), discriminated only by `source.kind`
- `interrupted` is producible only on the experiment branch; ad-hoc lease-lost runs become in-memory `aborted` with no persistence write
- Stale `running` ad-hoc records are never reconciled on reload — orphaned rows persist indefinitely `[DSI]`
- Lease TTL 10s vs heartbeat 3s — any >10s gap (laptop sleep, tab throttling) orphans a live run `[DSI]`

### Provenance (`[RF]`)
- Bidirectional experiment↔run links, atomic writes
- `reusedFrom` lineage exists only on the experiment repair path; ad-hoc relaunches create unrelated records
- No link from live Compare result to its persisted record
- No Run Detail → Compare backtracking (ad-hoc source carries zero origin fields)
- Fusion-study run-reference fields are schema-defined but never populated (null placeholders)

### Entry points (`[RF]`)
- 5 ways to reach Runs collection (nav, mobile nav, palette, Compare empty-state, direct URL)
- 8 ways to reach Run Detail (list, RecentRuns, evaluation deep links, matrix cells, source-run links, direct URL)
- No share/copy-link UI (links work but there's no UI to produce them)
- Filters are component state, not URL params (lost on reload)
- No grouping or count badges in the Runs list

### Record grain (`[RF]`)
- One shared pair of tables (`runSummaries` + `runDetails`) for ALL runs
- 10 tasks × 5 models = 1 experiment + 10 runs (not 50); all 5 models embedded per run
- Runs list is a flat ungrouped chronological feed mixing 3 grains (ad-hoc, experiment, legacy) with only a source filter
- Keyword search over `taskTitle + taskExcerpt (first 200 chars) + modelKeys` already ships `[RF — code verification]`
- Model filter and pagination (PAGE_SIZE=50) already ship `[RF — code verification]`
- Provider filter, URL-param persistence, grouping/counts, virtualization, and full-prompt search are absent

### Corpus-level jobs (`[RF]`/`[DSI]`)
- 19 distinct jobs identified; 3 fully served (J1 chronological recall, J2 provenance inspection, J9 immutable audit evidence) — all share one contract: read-only, searchable, chronologically ordered evidence
- 7 partially served; 9 unserved
- No `deleteRun` API exists; no retention/pruning policy anywhere — corpus grows unbounded
- No per-run operations in RunDetail (no export, rename, star, or delete)

### Evidence-chain corrections (from adversarial code verification)
4 Phase 1/2 `[DSI]` overstatements were corrected: keyword search, model filter, and pagination already ship. The honest serving delta is: URL-param persistence, grouping/counts, provider filter, full-prompt search, virtualization, retention.

## 3. Key reframings

The exploration changed the problem definition in two ways:

**Reframing 1 — "The evidence's gaps are serving gaps, not placement gaps."** `[DSI]` The hypothesis-blind model (Candidate F) independently arrived at three destinations but with different *serving*. The 7 gap fixes work identically under any navigation placement. This means the navigation question (keep or demote Runs) is downstream of the serving question (what should Runs *do*).

**Reframing 2 — "The Runs problem may be a Compare problem."** `[SJ]` The sharpest gap cluster (gap 2: no live-result→record link, gap 4: no record→Compare backtracking, C.5: ad-hoc runs carry zero origin fields) is cross-surface at production time. The single highest-leverage change — "View record" on live result + "Open in Compare" from Run Detail — is in every candidate's shared minimum. This suggests Runs-IA may be optimizing the wrong surface.

Neither reframing dissolves the A/B/D placement question; both narrow it.

## 4. Candidate models considered

Seven candidates were developed to equal depth:

| Candidate | Nav | Runs position | Core thesis |
|---|---|---|---|
| A | 3 | First-class, rebuilt | Gaps are serving, not placement |
| B | 2 + drawer | Demoted | Corpus browsing is low-frequency |
| C | 3 (unchanged) | Reweighted | Origin-routed discovery beats one corpus |
| D | 3 + segments | Decomposed | Collection conflates incompatible jobs |
| E | 3 (inverted) | Home | Corpus is core asset |
| F | 3 (blind) | Redesigned serving | Independently confirms A |
| G | 3 (reframed) | Journal | Continuity is the organizing principle |

## 5. Survivors

After adversarial review, repair, and counterfactual rounds: **4 retired (C, E, F, G → all converge into A's serving), 3 survive.**

### Candidate A — First-class Runs, rebuilt as corpus workspace
**Strongest case:** Serving is placement-independent (the 7 changes work under any placement — proven by Reviewer 3's own counterfactual). All per-candidate failures are reparable: double recovery UI → single parameterized component with source-kind precedence; same-task diff identity → frozen-config fingerprint; lineage → record-level `rebasedFrom`; archive conflicts → archive-only-for-children (protects E.3 immutability). Lowest authority cost (amendments, not reversals). `[DSI]`

**Strongest case against:** A's placement argument is as speculative as B's — "the slot was earned by authority fiat" (Reviewer 3). The thesis "gaps are serving, not placement" is unfalsifiable from repository evidence; it survives as a serving implementation, not as a diagnosis. If corpus browsing is rare, A furnishes a room users rarely enter. `[SJ]`

**Unresolved assumption:** Corpus-browsing frequency is high enough to justify a dedicated destination. `[EU]`

### Candidate B — Two workflows + secondary "Records" drawer (conditional)
**Strongest case:** If corpus browsing is genuinely low-frequency, B declutters the nav that generates everything. The push-badge is the only proactive recovery mechanism (all others require the user to visit). Zero URL breakage. `[SJ]`

**Strongest case against:** The run record is the **only durable output** of both workflows — Compare is ephemeral. Demoting the only durable artifact while promoting ephemeral generators is structurally inverted. B's "identical coverage to A" was unsubstantiated until repaired. Requires reversing PRODUCT.md §1 + DECISIONS #7 + CLAUDE.md principle 7 on a frequency bet with zero evidence. `[DSI]`

**Unresolved assumption:** Corpus-browsing frequency is low enough to demote. `[EU]`

### Candidate D — Decompose Runs into segmented views (weakened)
**Strongest case:** Structural separation (History/Evidence/Attention/From-evaluations) replaces per-row label reading — grain discrimination becomes a surface choice, not a reading task. No single surface renders 10k mixed rows. The compression diagnosis is partially confirmed: the *UI's flatness* is the accident, not the storage. `[SJ]`

**Strongest case against:** Internal contradiction (S15/S20 claimed served while J10 deferred). Segments are query views, not record partitions — a run legitimately appears in History, Evidence, and Attention simultaneously. Breaks J1 (splits timeline across segments). The uniform-contract storage design is deliberate, not accidental. If the compression diagnosis is wrong, D adds hops for no fidelity gain. `[DSI]`

**Unresolved assumption:** The flat UI compresses incompatible jobs that users would rather separate. `[EU]`

## 6. Recommended exploratory direction

**Ship the shared minimum first; adopt A's serving as provisional direction; park placement and segmentation pending measurement.**

The shared minimum is candidate-independent — all 7 candidates require it:

| Gap | Fix | Authority needed |
|---|---|---|
| 1 | Boot reconciliation (liveness-checked, sleep-tolerant TTL, fence-rebound not abort) | New lifecycle behavior |
| 2 | "View record" link from live Compare result | None (UI gap) |
| 4 | "Open in Compare" from Run Detail (record-level `rebasedFrom` lineage) | New lineage field |
| 5 | Copy-link UI (honestly labeled "this device") | None (UI gap) |
| 6 | URL-param filters | None (UI gap) |
| 7 | Grouping by source + per-group counts | None (UI gap) |
| 3 | Retention: archive (hide, reversible, links intact) + delete (zero internal inbound refs, children archive-only) | **New authority** |

**Honest serving delta** (beyond shipped features): URL persistence, grouping/counts, provider filter, full-prompt search, virtualization, retention.

**Why A provisionally:** A's serving is placement-independent — it survives even if B's placement later wins. B requires authority reversal on an unmeasured frequency bet. D's segments are absorbable into A as views if the compression diagnosis validates. A has the lowest authority cost and the most reparable defects.

**Why not finalize:** The placement question (A's three-nav vs B's two-nav+drawer) depends on corpus-browsing frequency, which is `[EU]` — zero telemetry exists. Further design cycles would only re-argue the same three bets.

## 7. Strongest alternative

**Candidate B** — the only survivor that disagrees at the nav/authority level. If measurement shows corpus browsing is rare, B's demotion (two workflows + global Records action with push-badge) becomes the correct call. B's deciding unknown is also the cheapest to measure. D is the strongest alternative on serving-internal design (structural grain separation) and is absorbable into A as internal views.

## 8. Rejected models

| Candidate | Structural reason for rejection |
|---|---|
| **C** | Origin is unrecoverable for the majority of records (ad-hoc runs carry zero origin fields). Origin-routing degenerates to RecentRuns, which fails at scale. C is the only candidate that can fail by doing nothing. |
| **E** | The compounding asset is the suite layer (versioned profiles, immutable experiment snapshots), not the leaf-evidence corpus. S6 proves the deepest audit path exists with zero prominence change. Root redirect adds a hop to every work session. |
| **F** | Pseudo-independence — same evidence + same pipeline = expected convergence (overfitting), not corroboration. F is A's duplicate; keeping it live would manufacture consensus. |
| **G** | Brokenness ≠ frequency — J5 is proven broken, never proven frequent. The only existing ad-hoc recovery path is relaunch, not resume. Collapse-by-lineage is vacuous for ad-hoc (retries already append to same record). Collapses to status quo + rename at reversal-level cost. |

## 9. Dissent / minority report

**Dissent 1:** A's placement argument is as speculative as B's. Reviewer 3's counterfactual ("slot earned by authority fiat; serving works under any placement") cuts both ways — it confirms A's serving is placement-agnostic but also means A's placement claim has no evidentiary support. A survives on serving robustness + lower authority cost, not on a demonstrated diagnosis.

**Dissent 2:** The counterfactual insight — "the Runs problem may be a Compare problem" — is the strongest minority finding. The sharpest gap cluster (gaps 2, 4, C.5) is cross-surface at production time. If resources are scarce, fixing the Compare↔Runs handoff + reconciliation may deliver more value than any navigation change. No candidate makes this handoff *primary*.

**Dissent 3:** Implementation constraints on the shared minimum are non-trivial and under-specified: L1 (two status systems disagree), L2 (reconciliation can kill live runs via fence takeover — 10s TTL makes this common), L3 (recovery loops never terminate — attention set is monotonic), L4 (badge flicker), R4 (copy-link is same-browser-only — data mobility is the real constraint), R5 (ad-hoc lineage unimplementable as per-candidate-attempt — must be record-level).

## 10. Empirical questions

Repository evidence and design reasoning cannot answer these. Each has a proposed cheapest evidence-gathering mechanism:

| Question | Decides between | Cheapest mechanism |
|---|---|---|
| **Corpus-browsing frequency** | A vs B | Local-only route-visit + run-detail-open event log (localStorage/IndexedDB, no server), surfaced in debug panel, reviewed after N weeks |
| **Compression-diagnosis correctness** | D vs A | Same event log instrumenting filter/segment usage + failed-search behavior |
| **Origin-memory reliability** | A's grouping design | Referrer tracking on same log — measure provenance-link access (matrix/ledger → run) vs list-route access |
| **Recovery vs relaunch frequency** | A/B serving depth | Click-counts on retryJudge/retryCandidate/relaunch affordances |
| **Corpus-as-core-asset** | E-derived (deferred) | Only matters if frequency data shows high browsing |

All mechanisms are local-only (CLAUDE.md principle 4 compliant), trivial to implement, and produce no server-side data.

## 11. Product-authority implications

Current authority **remains in force**. This exploration is non-authoritative and authorizes no implementation.

If the Product Owner accepts the direction:

| Authority | What happens |
|---|---|
| PRODUCT.md §1 / DECISIONS #7 / CLAUDE.md principle 7 | **Unchanged** under A's provisional direction. B's reversal would require explicit amendment — must NOT be authorized without frequency data. |
| DECISIONS #10.4 (route-invariant header) | **Amendment needed** for A's nav badge (state-varying) or B's action-zone button |
| E.5 scope fence (no analytics dashboards) | A's same-task pairwise diff sits at the fence — needs explicit scope reading before shipping |
| E.6 (Rank/Fuse sole Compare-only finish switch) | **Unchanged** in all surviving candidates |
| Retention/deletion policy (gap 3) | **New authority required** — currently a vacuum (no `deleteRun` exists, no retention policy anywhere) |
| `interrupted` lifecycle state | **Extension** — currently experiment-only; A's reconciliation extends it to ad-hoc |
| `rebasedFrom` lineage | **New field** — record-level lineage for ad-hoc relaunches (currently `reusedFrom` is per-CandidateAttempt and experiment-only) |

## 12. Next design question

*"What is the minimal local-only telemetry spec (events, storage, debug surfacing) that disambiguates corpus-browsing frequency, recovery-vs-relaunch, provenance-route vs list-route access, and filter/segment usage within N weeks — and what shared-minimum slice ships in parallel regardless of the measurement outcome?"*

The next phase is **instrument-then-decide** (measurement + shared-minimum implementation plan), not another candidate cycle.

## 13. Explicit non-actions

- Do NOT implement any IA candidate's navigation change without Product Owner approval
- Do NOT modify PRODUCT.md, DECISIONS.md, CLAUDE.md, or any authoritative document
- Do NOT reverse the three-workspace decision without frequency data
- Do NOT implement E/G root-redirect changes (reversal-level cost, refuted by S6)
- Do NOT build analytics dashboards, cross-run aggregation, embeddings, or semantic search (scope fence)
- Do NOT implement retention without provenance guards (archive-only for experiment children; delete = zero internal inbound refs)
- Do NOT ship reconciliation without liveness-check + sleep-tolerant TTL (L2: naive reconciliation kills live runs)
- Do NOT ship copy-link without honest "this device" labeling (R4: HashRouter + IndexedDB = same-browser-only)
- Do NOT conflate the shared minimum with a placement decision — they are independent

---

## Exploration artifacts

| File | Phase | Content |
|---|---|---|
| `evidence.md` | 1 | Neutral repository reconstruction (lifecycle, provenance, entry points, grain, authority) |
| `jobs-and-scenarios.md` | 2 | 19 jobs + 21 scenarios with baseline traces |
| `models.md` | 4 | 7 IA candidates developed to equal depth |
| `reviews.md` | 5-6 | Scenario trial matrix + adversarial review (3 lenses) + decision frame |
| `direction.md` | 8-9 | This document — exploratory synthesis |

**Process summary:** 7 phases · 3 parallel evidence investigators → executive gate A (send-back → patched) → 2 parallel jobs/scenario investigators → 1 blind IA designer → 3 parallel candidate developers → 2 parallel trial/review investigators → 2 parallel repair/counterfactual investigators → executive gate B (condition 2: empirical boundary)

All documents carry the non-authoritative status label. No application code was modified. No authoritative documents were changed.
