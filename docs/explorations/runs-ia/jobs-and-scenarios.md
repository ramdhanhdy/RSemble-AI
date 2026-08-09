«Status: Exploratory — non-authoritative. Does not modify current product authority or authorize implementation.»

# Runs IA — Phase 2: Jobs and Scenarios

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Basis:** Phase 1 evidence (`evidence.md`), read in full by both investigators.
**Labeling:** `[RF]` Repository fact · `[DSI]` Derived structural inference · `[SDJ]` Scenario-based design judgment · `[EU]` Empirical unknown

---

## Part 1 — Jobs Inventory

19 distinct jobs identified. All frequencies are `[EU]` — no analytics/telemetry exist in the repository.

### Served jobs (3)

| Job | Description | Runs surface serves it? | Evidence |
|---|---|---|---|
| J1 Chronological recall | Find past work by recency | **Yes** — flat chronological feed | `[RF — D.3]` |
| J2 Provenance inspection | Trace output to source: which model, what protocol, what failed | **Yes** at record level — RunDetail read-only evidence surface, deep links | `[RF — B3-B6, C.6]` |
| J9 Immutable audit evidence | Durable, searchable record "this is what happened" | **Yes** — core design intent | `[RF — E.1, E.2, E.7]` |

These three share one contract: a read-only, searchable, chronologically ordered evidence corpus.

### Partially served jobs (7)

| Job | Description | Served? | Gap |
|---|---|---|---|
| J3 Operational recovery | Salvage a failed/partial run | **Discovery only** — status filter finds recoverable runs; action lives in Compare/Experiment | `[RF — E.7]` RunDetail read-only |
| J4 Failure triage | Why did this fail, is it fixable? | **Partially** — single-run triage works; cross-run patterns unsupported | `[RF — A1.4]` |
| J7 Configuration debugging | What config was frozen, why did it behave this way? | **Partially** — frozen config readable; no reproduce, no cross-run diff | `[RF — B5, C.5]` |
| J11 Recent-run continuity | Find the record of the run I just finished | **Partially** — RecentRuns rows bridge the gap | `[RF — C.2#4, gap 2]` |
| J14 Grain discrimination | Separate ad-hoc / experiment / legacy / retry runs | **Partially** — source filter + labels; no grouping/counts | `[RF — D.3, gap 7]` |
| J16 Status awareness | Is it still running? | **Partially**, degraded by stale `running` rows | `[RF — gap 1]` |
| J18 Legacy inspection | View imported v1 runs | **Partially** — listed but no detail/evidence | `[RF — D.3, D.4]` |

### Unserved jobs (9)

| Job | Description | Why unserved | Authority fence? |
|---|---|---|---|
| J5 Resumption | Pick up unfinished work | **Misleadingly served** — stale `running` rows never reconciled; ad-hoc orphans unrecoverable | `[DSI — gap 1]` |
| J6 Cross-run analysis | Compare run N to run M | Flat feed, no grouping; no cross-run query surface | `[RF — E.5]` global analytics OUT of scope |
| J8 Cost/usage investigation | What did this cost? | Data stored per record; no cost presentation at any grain | `[RF — E.5]` analytics dashboard OUT |
| J10 Retention management | Remove/archive old records | No `deleteRun` API; no retention policy; corpus grows unbounded | `[DSI — gap 3]` authority gap |
| J12 Sharing/deep-linking | Copy a shareable URL | Links work (HashRouter) but no share/copy-link UI | `[RF — gap 5]` |
| J13 Filter persistence | Re-find a filtered view | Filters are component state, not URL params | `[RF — gap 6]` |
| J15 Reproduce-a-run | Open old config in Compare | No "Open in Compare" affordance; config captured but never reconstructed | `[RF — C.5, gap 4]` |
| J17 Whole-corpus backup | Archive export/import | Served but outside Runs (workbench-level) | `[RF — E.7]` |
| J19 Fusion-study tracing | Trace fusion artifact to run evidence | Schema fields exist but never populated; no `/runs/` links in fusion UI | `[RF — B7]` |

### Combination assessment

`[DSI]` The Runs surface successfully combines J1, J2, J9 because they share one contract: read-only, searchable, chronologically ordered evidence. It partially serves 7 jobs and does not serve 9. The unserved jobs fall into three categories:
1. **Corpus-aggregate** (J6, J8, J10) — authority fences in E.5 may block even with redesign
2. **Cross-surface action** (J3, J5, J15) — action lives in Compare/Experiment, not Runs
3. **Persistence affordances** (J12, J13) — UI gaps, not structural

`[SJ]` The one job whose unavailability actively *corrupts* another: J5's stale `running` rows corrupt J16's status answers.

---

## Part 2 — Scenario Suite (21 scenarios)

18 required + 3 evidence-exposed additions (S19-S21).

### S1. Just completed an ad-hoc Compare; wants to inspect it again
- **Transitions:** Compare → Runs list → Run Detail. **No direct link** from live result to persisted record. `[RF — gap 2]`
- **Ambiguity:** Two disjoint ID namespaces (`cmp-*` ephemeral vs `run-*` durable). `[RF — B1]`
- **Discovery burden:** Low at small corpus (RecentRuns); rises once run falls off RecentRuns window. `[SDJ]`
- **Corpus-scale:** At 500+, just-completed run only reachable by remembering it (degrades into S2). `[SDJ]`

### S2. Wants a Compare run from two weeks ago; remembers part of the prompt, not the date
- **Transitions:** `/runs` → filter → scan → detail. No text/keyword search documented. `[DSI]`
- **Discovery burden:** HIGH — chronological scanning is the only mechanism; filter state lost on reload. `[RF — gap 6]`
- **Corpus-scale:** Core "searchability" job; at 500-1,000 runs, date-agnostic scanning is impractical. `[SDJ]`

### S3. Corpus contains 500-1,000 runs
- **Object:** Corpus as navigable collection.
- **Ambiguity:** Mixed grains in ungrouped feed; legacy rows open to dead-end detail. `[RF — D.3]`
- **Discovery burden:** HIGH — flat feed, no pagination/virtualization documented. `[DSI]`

### S4. Corpus contains ~10,000 durable run records
- **Ambiguity:** S3's ambiguities compound; stale `running` rows add false "in-flight" signals. `[DSI — gap 1]`
- **Discovery burden:** Infeasible by scanning; indexes exist at data layer but no UI consumes them. `[DSI]`
- **Corpus-scale:** No retention/pruning/deletion policy; growth is unbounded. `[DSI — gap 3]`

### S5. Evaluation execution generates many child runs
- **Transitions:** `/evaluations/:suiteId` → experiment → matrix/ledger → `/runs/:runId`. `[RF — C.3#3-6]`
- **Ambiguity:** Child runs in flat feed indistinguishable from ad-hoc except source label; no experiment container concept. `[RF — gap 7]`
- **Provenance:** STRONGEST link — atomic writes, bidirectional. `[RF — B2]`
- **Corpus-scale:** Evaluations are primary corpus-growth engine; retries amplify. `[SDJ]`

### S6. Opens Evaluation result; needs exact underlying Judge evidence
- **Transitions:** ResultMatrix cell → `/runs/:runId?candidate=…&attempt=…`. `[RF — C.3#6]`
- **Discovery burden:** Low — one click. `[RF]`
- **Provenance:** Exact — judge attempts carry full evidence. `[RF — B3]`

### S7. Enters Run Detail via deep link; needs originating context
- **Ambiguity:** Ad-hoc runs carry zero origin reference. `[RF — C.5]`
- **Provenance:** Experiment runs link back to `/experiments/` and `/evaluations/`; ad-hoc runs offer nothing. `[RF — B2, C.5]`

### S8. Doesn't remember whether old run came from Compare or Evaluations
- **Discovery:** Low — source filter exists. `[RF — D.3]`
- **Corpus-scale:** Without per-source counts, user can't gauge corpus composition. `[RF — gap 7]`

### S9. Run failed halfway; needs failure evidence
- **Transitions:** Status filter "Failed" → detail. `[RF — A1.4]`
- **Ambiguity:** `failed` collapses two causes (judge failure vs <2 usable candidates). `[RF — A1.4]`
- **Recovery:** retryJudge / retryCandidate / relaunch; retries append to same record. `[RF — B6]`

### S10. One provider/config failure affects many runs; must identify affected set
- **Discovery burden:** HIGH — manual per-run inspection; no provider/model filter at list level. `[DSI]`
- **Recovery:** Per-run retry only; no batch rerun. `[DSI]`
- **Corpus-scale:** At 500+, manually identifying affected set is impractical. `[SDJ]`

### S11. Relaunch old Compare with one model/config changed
- **Transitions:** `/runs` → detail → **Compare transition does not exist**. `[RF — C.5, gap 4]`
- **Ambiguity:** Config fully readable but not loadable; manual reconstruction with drift risk. `[SDJ]`
- **Provenance:** Manual relaunch creates unrelated record; `reusedFrom` lineage only on experiment path. `[DSI]`

### S12. Returns after extended absence; wants unfinished/recent work
- **Ambiguity:** Stale `running` rows never reconciled; can't distinguish live vs orphaned. `[DSI — gap 1]`
- **Recovery:** Experiments: recovery dialog; Compare: no session resume. `[RF — A1.5, A1.6]`

### S13. Run started but never reached expected terminal outcome
- **Ambiguity:** "Running" may be stale — no boot reconciliation; user can't distinguish live vs orphaned. `[DSI — gap 1]`
- **Recovery:** Ad-hoc: none without live session; experiment: `interrupted` → new attempt per task. `[RF — A1.5, A1.6]`

### S14. Investigate whether Judge/config change correlates with outcomes across runs
- **Discovery burden:** VERY HIGH — no cross-run comparison surface; open each run. `[DSI]`
- **Authority:** Cross-run aggregation explicitly out of scope. `[RF — E.5]`

### S15. Remove/archive old records without destroying Evaluation provenance
- **Transitions:** **None exist.** No `deleteRun` API, no per-run operations. `[RF — E.7, gap 3]`
- **Provenance danger:** Deleting child runs breaks ResultMatrix evidence links, ledger "View run", RunDetail backlinks. `[DSI]`

### S16. Brand-new installation with zero runs
- **Transitions:** `/` → `/compare`; `/runs` shows no-history state with "Go to Compare" link. `[RF — A0.2]`

### S17. Primarily uses Compare; almost never browses run corpus
- **Discovery burden:** Low — RecentRuns rows cover recent history. `[RF — C.2#4]`
- **Corpus-scale:** This user type generates runs and never manages them; corpus grows silently. `[SDJ]`

### S18. Primarily uses Evaluations; sees runs as provenance/debug evidence
- **Discovery:** From evaluation surfaces: low (direct links); from Runs: high (mixed feed). `[RF — C.3#3-6, D.3]`
- **Corpus-scale:** Each evaluation injects N child runs into shared feed; flatness penalizes corpus excursions. `[SDJ]`

### S19. (Added) Fusion study → underlying run evidence (dead end)
- **Transitions:** **Do not exist.** No `/runs/` links in fusion UI. `[RF — B7]`
- **Ambiguity:** Schema promises provenance slots that are never populated. `[DSI — B7]`

### S20. (Added) Legacy/imported v1 records in corpus
- **Transitions:** `/runs` → legacy row → detail component **with no evidence**. `[RF — D.3, D.4]`

### S21. (Added) Sharing/copying a run record
- **Transitions:** User must hand-copy hash URL from address bar; no share/copy-link UI. `[RF — gap 5]`

---

## Coverage Map

| Scenario | Primary evidence | Gaps triggered |
|---|---|---|
| S1 | A1-2, B1, C.2#4, C.5, D.3 | Gap 2 |
| S2 | D.3, C.6, B5, E.2 | Gap 6 |
| S3 | D.1-D.3, C.1-C.2, E.7 | Gaps 6, 7 |
| S4 | D.1, A0.1, E.2, E.7 | Gaps 3, 6, 7 |
| S5 | B2, D.2, D.3, A1-6, B6 | Gap 7 |
| S6 | B3, C.3#6, A1-6 | — |
| S7 | C.5, C.1, B2, D.3 | Gap 4 |
| S8 | D.3, D.1, C.5 | Gap 7 |
| S9 | A1-4, A1-7, B3-B4, B6 | — |
| S10 | B3-B5, D.3, E.5, E.7 | — |
| S11 | B5, C.5, B6 | Gap 4 |
| S12 | D.3, A0, A1-5/6, C.2#3, C.4 | Gap 1 |
| S13 | A1-1, A1-3/5/6, B6 | Gap 1 |
| S14 | B3, B5, D.3, E.5, E.7 | — |
| S15 | E.7, B2, C.3#3-6 | Gap 3 |
| S16 | A0.2, C.1, A0.1, C.2#4 | — |
| S17 | E.1, E.6, C.2, C.5, A0.1 | — |
| S18 | B2, C.3#3-6, D.3, A1-6 | Gap 7 |
| S19 | B7 | — |
| S20 | D.3, D.4, E.7 | — |
| S21 | C.6, E.7, C.5 | Gap 5 |

---

## Key Findings for Downstream Phases

1. **The Runs surface serves 3 jobs well** (J1, J2, J9) — all share the read-only searchable evidence corpus contract.
2. **7 jobs are partially served** — gaps are mostly discoverability, not data loss.
3. **9 jobs are unserved** — 3 blocked by authority fences (J6, J8, J10), 3 are cross-surface actions (J3, J5, J15), 3 are UI gaps (J12, J13, J19).
4. **One job actively corrupts another** — J5's stale `running` rows make J16's status answers unreliable.
5. **The corpus grows monotonically** with no retention policy — evaluations are the primary growth engine.
6. **The most important empirical unknowns** are: actual corpus-browsing frequency, how often recovery sessions occur, whether users treat run records as valuable assets, and whether users reliably remember origin context.
