«Status: Exploratory — non-authoritative. Does not authorize application changes or modify current product authority.»

# Runs IA — Divergent Exploration Notes for Prototype Candidates

**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09
**Basis:** models.md (candidate summaries) + fairness-boundary.md (S/P/N/X + baseline) + next-step.md (experiment readiness)
**Purpose:** Breadth-first idea generation for HTML prototypes of Candidate A, Candidate B, Candidate D (as views), and the Fairness Baseline. Deliberately non-convergent — alternatives are listed with tradeoffs, not verdicts.

---

## 0. Cross-cutting prototype constraints

- Theme: `#0a0a0a` background, cyan `#00e5ff` accent, dark theme. Shared `shared.js` / `shared.css` exist in this directory — prototypes should reuse them and only add candidate-specific overrides.
- Nav: three-item header (Compare | Runs | Evaluations) for A/D/Baseline; two-item + Records action for B. Mobile treatment differs per candidate.
- Local-first: HashRouter, IndexedDB persistence, "this device" honesty in any copy-link affordance.
- **Runs destination freeze is in force** — the Baseline prototype must NOT drift into destination redesign (A-by-accretion test, fairness-boundary §3). Only the 5 fairness items + their presentation variations.
- Per-record fidelity facts (from fairness-boundary §2): attachments are metadata-only and NOT restorable; providers no longer configured render as unavailable slots; judge rebuilds from `judge.attempts[0]`; boot reconciliation (`recoverInterruptedRuns`) ALREADY ships at HEAD.
- Status vocabulary: `running` · `completed` · `interrupted` (session-closed vs provider-error distinction is a presentation question, not a schema one).
- CommandPalette already ships with "Go to Runs" (CommandPalette.tsx:91-95) — it is a live escape hatch for B-lite.

---

## CANDIDATE A — First-Class Runs (Compare | Runs | Evaluations)

**Prototype questions:** How should a rebuilt Runs corpus workspace *feel*? What grouping/scale/search treatment makes corpus browsing coherent at 10k records? How do experiment child runs appear? What single interaction earns the workspace its position?

### Interaction ideas (alternatives, not a combined design)

1. **Grouped-by-source landing with collapsible sections.** Three groups (Ad hoc · Experiment containers · Legacy) with live counts, sticky group headers, per-group date range. Variants: (a) groups expanded by default, (b) collapsed with counts only, (c) expand-state persisted per browser. Tension: grouping helps legibility but hides recency — fresh ad-hoc runs can bury under experiment containers. Counter-idea: a slim "Recent" strip pinned above groups (last 5 runs regardless of source).
2. **Query bar with URL-param persistence.** Filter chips row (source/status/date/provider/model/keyword). Every filter is a removable chip; URL encodes the full view (`?source=adhoc&status=interrupted&provider=openai`). Variants: (a) single-line chip bar, (b) popover filter panel with applied-chip summary, (c) two-tier bar (persistent chips + expandable "More filters"). Back/forward must work. History-spam risk → debounce or `replaceState`.
3. **Time-bucketed browsing as the scale answer.** Instead of one virtualized river of 10k rows: day/week/month buckets with a thin year rail or scrubber. Variants: (a) calendar-style month grid, (b) chronological sections with "load more" per bucket, (c) continuous virtualized list with sticky bucket headers. The rail variant is the most novel; the sticky-header variant is the safest. Bucket granularity should adapt to density (recent = days, old = months).
4. **Recovery desk with handoff.** "Needs attention" section listing interrupted/orphaned rows; each row: "Recover" → opens Compare with frozen config loaded + retry target. Variants of the retry target: (a) re-run all candidates, (b) re-run only failed candidates, (c) choose at recovery time (radio in the preload sheet). Every recovery row should surface *why* it failed (provider error vs session-closed) and what won't carry over (attachments). **Runs proposes, Compare disposes** — Runs must never execute, only hand off.
5. **Same-task pairwise diff (bounded cross-run analysis).** Select two runs sharing a task → diff panel: config delta (temperature, candidates, judge) + outcome delta (rank order, which model moved, judge verdict change). Variants: (a) side-by-side columns, (b) unified delta list, (c) highlight-only overlay on a merged view. Explicitly NO aggregates/leaderboards (bounded by design).
6. **Experiment child runs.** Experiment container = expandable card; children = nested attempt rows. Variants: (a) inline accordion expansion, (b) drill-in to a container detail sub-view, (c) children flattened into the feed with container-breadcrumb chips. Children are archive-only (no delete, no recovery — experiment-owned). Container row should show aggregate state ("3/5 attempts · 1 interrupted") without rendering all children.
7. **Selection + batch affordance.** Checkbox column enabling batch ops — but only archive (reversible), never delete, and only where zero inbound references. Variants: (a) persistent checkbox column, (b) selection mode toggled from a toolbar, (c) no selection at all (each row acts alone). Selection implies mutability — if retention isn't in scope, selection is a promise the prototype shouldn't make.
8. **Keyboard-first corpus navigation.** `/` focuses query bar; arrows move a selection cursor; `Enter` opens detail; `r` recovers selected; `d` enters diff mode. Variants: (a) full keyboard model, (b) only `/` + Esc (search escape), (c) none (mouse-first). Local-first power users may love (a); casual users may be confused by focus rings.
9. **Empty states as teachers.** No runs yet → "Run your first Compare"; filter with no results → suggestion chips to relax (drop provider, widen date). Variants: illustration vs text-only vs action-button-led. Empty states are the cheapest way to make the workspace feel intentional.
10. **Row anatomy variants.** Per-row: title excerpt, model-count chips, status pill, timestamp, provider dots, copy-link icon, cost (per-run cost visibility is an A/E elevation). Variants: (a) dense single-line rows, (b) two-line rows (title + meta), (c) card rows. Dense wins at scale; cards win at <100 records.

### Edge cases

- **10k-record scale:** virtualization + index-backed filters are mandatory; keyword search over full prompts needs a derived index (baseline #8 is frozen, but A may propose it). Group counts must stay correct while only a page is rendered.
- **Title collisions:** two runs with same task title but different prompts — diff grouping must key on task identity, not title string.
- **Interrupted taxonomy:** distinguish `interrupted(session-closed)` (tab died — recover freely) from `interrupted(provider-error)` (recover may fail again — show the error). Boot reconciliation already marks the former at HEAD.
- **Still-running rows:** a `running` row in the list — show live spinner? poll? freeze? (Lease semantics: another tab may own it.)
- **Legacy rows with missing fields:** must render tolerantly; "legacy" grain badge; they appear in no Attention view (can't be recovered) — or can they?
- **Multi-tab staleness:** local-first means two tabs can hold divergent lists; needs refresh-on-focus or `storage` event listener; badge counts must recompute on visibility change.
- **Unavailable providers on Recover:** preflight gates; preload sheet must show which slots will be unavailable before the user commits.
- **URL filter state with zero matches:** empty state must offer one-click reset, not a dead end.

### Failure modes

1. **Kitchen-sink:** the 7 changes render as a dashboard — grouping + desk + diff + badges + search all compete; the user can't find the one row they came for. Guard: handoff pattern (Runs proposes, Compare disposes) must be the spine of every interaction; anything that executes belongs in Compare.
2. **Badge lies:** nav badge counts needs-attention but goes stale (another tab reconciled, provider outage inflated it, user already recovered via drawer). Stale/lying badges train users to ignore them — worse than no badge. Guard: cheap index-backed counts, refresh on focus, and a "mark seen" semantics question.
3. **Recovery loops:** Recover → Compare → execute → fails again → new interrupted run → repeat. Without a "why did it fail last time" hint and a retry-target choice, the desk becomes a loop generator. Guard: surface prior error + distinguish re-run-all vs re-run-failed.
4. **Grouping hides recency:** grouped-by-source default pushes fresh ad-hoc runs below experiment containers; user can't find what they just ran → the exact gap A claims to fix reappears. Guard: recency strip or sort-within-group.
5. **Perf cliff:** search feels broken at scale → the corpus workspace is judged useless precisely where it must shine. Guard: index-backed search, debounce, virtualization from day one.
6. **Count/rendered mismatch:** "showing 3 of 47" per group under pagination breeds distrust. Guard: honest count language or load-more-per-group.

---

## CANDIDATE B — Secondary Records (Compare | Evaluations + secondary access)

**Prototype questions:** Which secondary mechanism (header action button / slide-over drawer / command palette / menu)? How does the user reach old records without top-level Runs? What's the push mechanism for needs-attention? How does B-lite differ from full B?

### Secondary-access mechanism alternatives

1. **Header action button → slide-over drawer (full B).** A "Records" button in the header action zone, route-invariant (identical on Compare and Evaluations), opens a right slide-over. Variants: (a) button with badge count, (b) bare icon (document stack) with badge, (c) button without badge (push handled elsewhere). The drawer must be non-destinational: it opens *over* any workspace, never replaces it.
2. **Command palette (B-lite / deprivation trial).** Already ships ("Go to Runs" → routes to Runs). B-lite = flag hides the Runs nav item entirely; only palette + URLs remain. Palette is for *navigation*, not browsing — it can't be full B's browsing surface, only its door. Smoke-test discoverability before the trial (next-step.md readiness item).
3. **Header menu (dropdown).** A "Records" item inside an existing overflow/kebab menu. Cheapest, but one extra hop and the least discoverable — effectively B-lite with a labeled door.
4. **Contextual links only (no global affordance).** "View record" on Compare results + "Open in Compare" on Run Detail cover the origin-known jobs; a global corpus view survives only at a URL. This is really Candidate C's posture — worth prototyping as the *control* condition, not as B.

### Drawer interaction ideas

5. **Three-zone drawer anatomy:** (a) "Needs attention" (recoverable/interrupted, with Recover → Compare handoff), (b) "Recent" (last N runs), (c) "Browse" (search + filters + grouped list). Zones stack vertically; Browse expands. Variants: zones as tabs vs stacked sections vs one list with filter chips.
6. **Deferring, not hosting:** the drawer does list + filter + handoff only; full inspection navigates to the durable `/runs/:runId` route (drawer closes, route takes over). This is the load-bearing boundary that keeps the drawer from becoming a worse Runs.
7. **Push mechanism variants:** (a) badge on the Records button (live leases + recoverable + orphaned count), (b) no badge, but the drawer opens pre-filtered to Attention when opened, (c) badge with "mark seen" dismiss. Variants (a)+(c) pair well; (b) alone is the quiet option. Badge must refresh on window focus, post-execution, and cross-tab storage events — or it lies (see failure modes).
8. **Inline row actions on hover:** each drawer row offers Open in Compare (fairness #15 bridge), Copy link, View detail. Hover-reveal variants: (a) icon cluster on hover, (b) always-visible ghost buttons on the first rows only, (c) kebab per row.
9. **Drawer search with instant results:** the Browse zone has its own search box + chips so quick retrieval never requires leaving context. Bounded: results are rows, not full records.
10. **Keyboard:** a Records shortcut (e.g., `r` or `Ctrl+Shift+R` — must check CommandPalette collisions); `Esc` closes drawer; focus trap inside drawer.
11. **Mobile:** bottom sheet vs right slide-over; the same Records button in a condensed header; drawer becomes full-screen sheet with the same three zones.
12. **State memory:** drawer remembers last zone + scroll within the session; never persists across sessions (URL is the persistence mechanism for full views). Keep the drawer OUT of the URL (transient overlay) — or deliberately in it (`?panel=records`) for deep-linkability; pick one and be consistent.

### B-lite vs full B (prototype must show both)

- **B-lite:** Runs nav item hidden (feature flag); palette + direct URLs only; Runs route stays functional. Strictly *more* deprivation than real B — friction observed in B-lite overstates real-B friction; evidence review must discount the missing visible affordance vs the missing prominence (next-step.md caveat).
- **Full B:** visible Records button + drawer; palette remains as redundancy. Full B is what would ship if B wins; B-lite is the experiment's instrument.
- Prototype implication: the flag mechanism must be reversible and the escape hatch smoke-tested — the prototype should demonstrate the palette path working, not just the drawer.

### Edge cases

- **Drawer over a running Compare:** opening Records mid-execution — rows show live status; recovering a run while another executes → lease conflict; drawer must respect the fence and show "already running" rather than queueing.
- **Route change with drawer open:** navigating to `/runs/:runId` from the drawer must close it cleanly; back button should not resurrect it unexpectedly.
- **Badge cost at 10k records:** counting every render is fatal; badge must come from a mutation-updated index, not a live scan.
- **Naming collisions:** "Records" (not History/Archive/Evidence) — prototype should include the rationale in a tooltip or footer note so reviewers don't relitigate naming.
- **Drawer + deep link:** a shared `/runs/:runId` link opened fresh — no drawer involved; drawer must not interfere with direct-route rendering.
- **Cross-tab:** two tabs open; tab A recovers a run; tab B's drawer badge must update via storage events or it lies.
- **B-lite flag edge:** user with the flag on clicks a shared Runs URL — route must still render (escape hatch), flag only hides nav.

### Failure modes

1. **Discovery decay:** users forget the Records button exists; if corpus jobs are rarer than believed, the drawer atrophies and old records become invisible → **stranding** (the S8 forgotten-origin job with no home). Guard: contextual links (View record / Open in Compare) keep records reachable from context even if the drawer is ignored.
2. **Utility bloat:** the drawer needs nearly everything A's Runs has (list, filter, search, recover, grouping) — at which point it's Runs in a smaller box, strictly worse. Guard: the deferring boundary (no full inspection in the drawer) must be visible in the prototype as a hard rule.
3. **Badge fatigue:** a noisy attention badge (stale counts, provider-outage inflation) trains users to ignore it — the push mechanism dies exactly when it matters. Guard: mark-seen semantics + honest refresh.
4. **Route-invariance break:** if the button isn't present on every route (mobile overflow, a future surface), the "same button everywhere" guarantee collapses and users in Compare can't reach records without leaving context.
5. **The frequency bet fails:** the entire case rests on corpus-browsing frequency being low [EU]. If wrong, B is strictly worse than A with no recovery short of re-adding nav — the prototype can't prove the bet, but it can make the friction of the drawer (vs the nav) measurable.
6. **Reversal cost:** B reverses PRODUCT.md §1 / DECISIONS #7 / CLAUDE.md principle 7 — authority cost is the highest of all candidates; a prototype that doesn't clearly demonstrate the two-workflow story fails on its own terms.

---

## CANDIDATE D — Corpus Views (internal views; NOT a nav candidate)

**Prototype questions:** Which views make sense (recent / by-source / by-status / from-evaluations)? How do views differ from segments? Should views be tabs, filters, or modes? What's the failure mode (segment sprawl, extra hops, question-property not record-property)?

### View-set alternatives

1. **The four-view set (D's segments as views):** Recent · By source · Needs attention · From evaluations. This is the canonical D-Presentation package (fairness-boundary §4): query views, not record partitions — a run legitimately appears in multiple views simultaneously.
2. **Two-view minimal set:** Recent + Needs attention. Justifies itself on the two sharpest jobs (J1 chronology, J3/J5 recovery) and avoids sprawl. By-source becomes a filter chip, not a view; From-evaluations stays inside Evaluations' own surface.
3. **Job-shaped set:** History · Evidence · Attention · From evaluations (D's original segment contracts, J1/J9/J3/J5). More semantically loaded — "Evidence" implies immutability/audit, which implies curation affordances the prototype may not want to promise.
4. **Time-shaped set:** Today · This week · Earlier · Interrupted. Chronology-first; closest to the current feed's honest reframe (G's territory bleeding in). Risks duplicating what Recent already does.

### Tabs vs filters vs modes (the core structural question)

- **Tabs** = exclusive partitions. Wrong for D: a run in Attention is also in Recent. Tabs imply "where is this record?" confusion the compression diagnosis warns about. *Reject as default; may work if views are mutually exclusive by construction (e.g., Attention = NOT in Recent? — no, that's absurd).*
- **Filters/chips** = the same list re-queried. Correct mental model (question-property, not record-property), but filters alone can't change row *treatment* — Attention rows need Recover actions, From-evaluations rows need container cards. Filters can't reshape rows.
- **Modes** = different interaction model per view (Attention = action-first rows with big Recover; Recent = dense passive rows; From-evaluations = container cards). Modes can reshape rows but risk feeling like four different apps.
- **Hybrid (most promising to prototype):** view switcher selects a *job-shaped default query + row treatment*; chips refine within the view; URL encodes both (`/runs?view=attention&status=interrupted`). Views are presets, not folders. Prototype should show at least two of these framings side by side so reviewers can feel the difference.

### Interaction ideas

5. **Segmented control mirroring `/evaluations`:** reuse the exact segmented-nav pattern Evaluations already ships (muscle memory, one less pattern to learn). Placement: inside Runs header, below the workspace header.
6. **View counts on the switcher:** each segment shows a live count (Attention 3 · From evaluations 12). Powerful, but count staleness = badge-lies failure again; counts must be index-backed.
7. **View + query composition:** chips persist *across* view switches (or reset? — decide: reset is simpler and less surprising; persist is faster for power users). URL is the source of truth either way.
8. **Per-view empty states:** Attention with nothing to recover → "All clear" (rare in this app, worth celebrating); From-evaluations with no experiment runs → pointer to Evaluations; Recent with no runs → "Run your first Compare".
9. **Cross-view deep links:** a link from an Evaluations matrix cell can land in From-evaluations with the container highlighted (`?view=from-evaluations&container=<id>`); a link from the nav badge can land in Attention. Views must be deep-linkable, not just clickable.
10. **Row-density variants per view:** Recent = dense one-liners; Attention = two-line action rows (error reason + Recover); From-evaluations = container cards with child counts. Same record, three renderings — this is what modes buy.
11. **Default view question:** Recent as landing (continuity) vs By-source as landing (composition, fairness #6 grouping promoted) vs Attention as landing (push). The default view IS the product's stance on what Runs is for — prototype should not hide this choice.

### Edge cases

- **A run in multiple views:** an interrupted ad-hoc run is in Recent AND Attention AND By-source. Views-as-queries makes this natural; views-as-folders makes it a bug. The prototype must demonstrate the same row appearing in two views without confusing labeling.
- **Legacy rows:** which views include them? Recent yes, Attention never (can they be recovered? semantics question), By-source has a Legacy group, From-evaluations no. Document the decision visibly.
- **Container child runs:** archive-only, no recovery, no delete — From-evaluations must not offer Recover on children, or it violates experiment ownership. A child row in Recent must not offer Recover either (treatment follows the record's ownership, not the view).
- **Scale asymmetry:** Recent must handle 10k rows (virtualized); Attention is naturally bounded (few); From-evaluations bounded by container count. Each view has a different scale ceiling — the prototype should be honest about which views degrade.
- **View + filter URL conflicts:** `?view=attention&status=completed` — a filter that contradicts the view preset. Options: (a) allow (query wins, view is just a default), (b) disable conflicting chips, (c) silently drop. (a) is the most honest.

### Failure modes

1. **Segment sprawl:** 4 views become 8 (by provider, by model, by date, by cost…) — the segmentation problem D was meant to solve reappears inside its own solution. Guard: hard cap on views, or a deliberate view-authoring gate (views are product decisions, not user features).
2. **Extra hops on cross-contract journeys:** find run → recover → compare now requires switching views mid-journey; if switching resets scroll/filter, every hop loses context. Guard: view-switch state preservation + cross-view deep links.
3. **Question-property dressed as record-property:** rendering "recent" or "by-source" as structural segments implies records *belong* to one segment — the compression diagnosis error, recreated. Guard: query-view semantics visible in UI copy ("Showing: runs matching this view"), not folder language.
4. **View/label dissonance:** user believes From-evaluations is a folder, remembers a run, can't find it (it's in Recent) → trust loss. Guard: consistent cross-view visibility (same record appears in all matching views) + tooltip explaining views are queries.
5. **Attention view creeping into a dashboard:** counts, sparklines, recovery-rate stats — kitchen-sink again. Guard: freeze Attention at list + actions.
6. **Duplicate with filters:** if views are just saved filters, why have both? Guard: the crisp rule — view = job-shaped default + distinct row treatment; chip = refinement within a view. Prototype must make the division legible or reviewers will rightly call redundancy.

---

## BASELINE — Fair Connections Only

**Prototype questions:** What is the minimum that makes the current model fair? How does "View record" appear on the Compare result? How does "Open in Compare" work from Run Detail? What should copy-link look like? (Scope: exactly the 5 fairness items — #1, #15, #4, #5, #6 from fairness-boundary §2. Nothing else.)

### Item 1 — Compare → "View record" on live result (placement alternatives)

1. **Result-header ghost button:** "View record ↗" (or document icon) top-right of the Rank/Fuse output card. Appears only once `runIdRef` is populated (i.e., the run is persisted). Low ceremony, always present, never competes with primary actions.
2. **Result footer line:** "Saved as record · View · Copy link" beneath the output. Reads as a receipt; slightly more passive than a button.
3. **Post-execution toast:** transient "Run saved — View record" toast after Rank/Fuse completes. Captures the exact moment of need, but is ephemeral — must be backed by a persistent link for later.
4. **Per-candidate attempt links:** on rank results, each candidate row links to its attempt record (mirroring Evaluations' matrix cells). Fairness #2 says Evaluations cells already deep-link; the question is whether Compare's output wants the same per-candidate affordance.
5. **Icon-only vs labeled:** document icon vs text vs icon+text. Icon-only is cleaner on a busy result card; text is more discoverable. Prototype both.

### Item 15 — Run Detail → "Open in Compare" (no lineage)

6. **Primary button in Run Detail header:** "Open in Compare" / "Rerun in Compare" as the header's primary action. Dispatch frozen config (task, mode, profile snapshot, candidates, judge, reasoning) → Compare reducer → navigate `/compare`. Old record untouched; new run gets `source:{kind:"adhoc"}`.
7. **Honest preload sheet:** before landing in Compare, a sheet/notice lists what will NOT carry over: attachments (metadata-only by design — dropped with a notice), unavailable providers (render as unavailable slots, preflight gates), profile-vs-custom origin ambiguity (cosmetic).
8. **Button state honesty:** if record providers are no longer configured, button shows "2 providers unavailable" warning state *before* preflight; if the judge config can't be rebuilt, disabled with a reason tooltip.
9. **Secondary placement:** button in header vs row action in the list vs both. The list-level variant makes recovery desk-like flows possible later, but the baseline freeze says list stays neutral — header-only is the safer scope.

### Item 4 — Copy-link UI ("this device")

10. **Button + honest label:** "Copy link" in Run Detail header + per-row icon in Runs list. Copies the full hash URL; feedback = checkmark + "Copied — works on this device" (tooltip or inline). The local-first honesty is load-bearing: this must never imply cross-device shareability.
11. **Feedback variants:** (a) inline label swap, (b) tooltip, (c) toast. Toast is fastest to build and least intrusive; inline swap is most discoverable. Copy-link on the Runs row should also exist (fairness #4 says Run Detail + Runs list).

### Item 5 — URL-persistent filters

12. **Chip bar → URL round-trip:** Runs filter chips serialize to URL params on change; on load, chips hydrate from URL; back/forward and reload preserve the view. History-spam guard: debounce writes or use `replaceState` for rapid chip edits.
13. **Copyable filter view:** "Share this view" / copy-link copies the filtered URL — this is where copy-link and URL filters compose. Must stay list-level (no new filters — provider filter and full-prompt search remain frozen as destination improvements).

### Item 6 — Grouping by source + counts

14. **List-level group headers:** "Ad hoc (34) · Experiment (12) · Legacy (5)" as simple section headers in the flat list; groups collapsible; counts live. This is the closest call to A-by-accretion (fairness-boundary §3) — the prototype must keep it visually modest: group headers, not nested architecture, no new capabilities, no per-group search.
15. **Grain pill on rows:** tiny "ad hoc" / "experiment" / "legacy" tag per row as the *alternative* to grouping — cheaper, but loses the composition-at-a-glance that motivates #6. Prototype both: grouping vs pills.

### Edge cases

- **View-record link while run still executing:** record may be partially persisted; Run Detail shows live status instead of a frozen one.
- **Persistence failure (IndexedDB full):** link absent or disabled with reason — never a dead link.
- **Open-in-Compare with removed judge/provider:** rebuild with placeholder + notice; preflight gates the run (existing behavior).
- **Copy-link label honesty:** same-device only; a copied URL opened on another device breaks — the label is the mitigation, so the label must be unmissable.
- **Filter URL with zero results:** empty state with one-click "clear filters" — never a dead end.
- **Grouping counts vs pagination:** counts must reflect the full corpus while the list shows a page — "Ad hoc (34)" with 20 rendered; the count language must not imply the list is complete.

### Failure modes

1. **Scope creep into A (A-by-accretion):** the baseline prototype must be auditable against exactly the 5 items; adding badges, views, recovery desk, or dashboard counts contaminates the experiment. The prototype should carry a visible scope checklist in its footer.
2. **Silent fairness failure:** if View-record is buried or Run Detail is slow, users still hunt through Runs — the fix exists but doesn't fix. Dogfooding protocol is the safety net; the prototype should make the link impossible to miss *at the moment of completion*.
3. **Fidelity-gap blame:** user reruns via Open-in-Compare and gets different results (attachments missing, provider changed) → blames the tool. The preload notice is the whole mitigation; if it's skippable-by-default, it fails.
4. **Copy-link without honest labeling:** user shares across devices → broken → trust loss. The "this device" label is not cosmetic.
5. **Grouping drifting into redesign:** nested groups, per-group actions, group-level search = A-by-accretion. Keep grouping list-level or the baseline stops being neutral.

---

## Cross-candidate prototype notes (what to probe, not decide)

- **A vs B friction comparison:** A's prototype should let a reviewer feel corpus browsing as a *destination* (grouping + desk + diff); B's should let them feel *retrieval without a destination* (drawer + push). The prototypes are instruments for the [EU] bets (corpus-browsing frequency, origin-memory reliability) — design them to make friction observable, not to win.
- **D is compatible with A and B** (D-Presentation as views inside A's Runs, or as views inside B's drawer Browse zone). Prototype D at least once *inside* a B drawer to test the drawer's capacity.
- **Baseline is the control:** it should be visually quieter than all candidates; its job is to be fair, not impressive.
- **Shared assets:** all prototypes reuse `shared.js`/`shared.css`; candidate-specific chrome should be isolated so diffs between prototypes are legible.
- **Every prototype should include the status label** «Status: Exploratory — non-authoritative» per project convention.
