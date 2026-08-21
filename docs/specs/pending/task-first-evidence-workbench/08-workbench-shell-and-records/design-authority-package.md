# Child 08 Design Authority Package

**Status:** Pre-implementation design authority (no production code authorized by this document)
**Baseline audited:** `feat/task-first-evidence-workbench` @ `5230f7e62d8a75da218859ca1d2ac667cb400cf8` (2026-08-21, post-Run-28 closure-repair commits)
**Authority audited against:** `workbench-shell-and-records-spec.md` (behavioral), `ui-design-spec.md` v1.0.0 (visual), `implementation-plan.md`, and the shipped production surfaces.
**Companion artifact:** `docs/explorations/future-task-first-ui/child08-canonical-states.html` — runnable canonical reference states (§D).

This document does not add requirements. It reconciles authority conflicts, audits the actual
shipped UI, and fixes the remaining interpretation points so implementation agents execute
instead of deciding.

---

## Authority conflict reconciliation (read first)

The older Child 08 documents contain stale authority. Resolved here, once:

| Conflict | Stale source | Binding resolution |
|---|---|---|
| Primary navigation | Behavioral spec §1, §3.1, §10 ("Compare · Evaluations · Models", "three-item bottom nav"); implementation plan Goal + Task 7 RED ("exactly Compare/Evaluations/Models") | **Compare · Evaluations · Lab · Models** (program spec P03; ui-design-spec reconciliation note 1). All four must be functional; the entry gate applies to Lab and Models — verified functional at baseline (`/lab/*`, `/models/*` ship real workspaces). |
| Fusion Study ownership | Behavioral spec §4.1 owner `/evaluations/sets/:taskSetId/fusion/:studyId`; implementation plan Task 5 "canonical Fusion Study deep links" | Retired. The Record type is **Policy Study reference**, owner `/lab/studies/:studyId` (ui-design-spec note 2; shipped `RetiredFusionRoute` in `app-router.tsx`). Records never renders Fusion-Study deep links as resolvable eval routes. |
| Drawer groups naming | Behavioral spec §5.1 ("Compare, Evaluations, and Legacy/other") | ui-design-spec §6.2 five-group grammar (Compare / Evaluations / Lab / Observations / Legacy). The Lab group exists because Policy Studies are Lab's. |
| Child numbering in behavioral spec §11 | "Attention behavior (child 08)", "child 09 completes archive v2" | Program spec §15 is authority: Attention = Child 09, hardening = Child 10. No behavior change; citation only. |
| Mobile utility visibility | ui-design-spec §5.1 (palette/help hidden `<md` by class) vs §8.1 390px row ("utilities all icon-only 44×44") | See B/REFINE-2: palette and help stay hidden below `md` (characterized); the **Records button renders at all widths** as a 44×44 icon button below `md` — it is the only mobile chrome route to the ledger. |

---

## A. Current-state design audit

Baseline state: primary nav is Compare · **Runs** · Evaluations (both desktop and mobile);
Lab and Models exist as functional workspaces at direct routes but are not in navigation;
header utilities are connections pill + palette (kbd ≥lg, icon md–lg, hidden <md) + help
(hidden <md); hamburger renders `<md` **only on the Compare route** (`onOpenCommand` prop is
compare-only in `rsemble.tsx:544`). No Records surface exists. `/records` does not exist.

### A.1 Shell / header (`src/ui/Header.tsx`)

| Decision | Reason |
|---|---|
| **Preserve** the `h-14` grid (`grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`), `border-b border-edge bg-shell`, `px-2 sm:px-4`, 22px `HexCubeLogo`, "RSemble AI" wordmark hidden `<sm` | Correct tool-chrome grammar: fixed height, three-column balance, no sticky behavior needed (body is scroll-locked; the header is in flow). |
| **Modify** — add the Records utility button in second position (palette · Records · connections · help), icon `History`, label ≥`lg`, 44×44 icon-only from `md`–`lg`, **and below `md`** where it is the only chrome route to Records | Utility order most-used → least; connections stays adjacent to help so the future Attention slot sits between Records and connections without moving the readiness pill. |
| **Preserve** the connections pill exactly as shipped (dot + word ≥`lg`, `aria-label` always carries the status word, `aria-live="polite"`) | The ui-design-spec §5.1 claim that this "violates" non-color-only readiness is partially stale: the accessible name always carries the word and the visible word ships at ≥`lg`. The dot-only visual at `md`–`lg` matches the collapse ladder; acceptable. No change. |
| **Preserve** the `md:hidden` hamburger — and note it is Compare-only today | Records drawer/full utility must not depend on it. No new mobile menu for Records. |

### A.2 Desktop primary navigation (`src/ui/WorkspaceNav.tsx`)

| Decision | Reason |
|---|---|
| **Modify** — item list becomes Compare · Evaluations · Lab · Models; remove Runs | Locked topology. |
| **Preserve** link grammar: `min-h-[44px] px-3 text-sm font-medium rounded-md`, active `text-accent`, `aria-current="page"`, icons `hidden lg:block` size 15 | Characterized, compliant, calm. |
| **Modify** — active item gains a static 2px bottom accent bar (`shadow-[inset_0_-2px_0_0_#00e5ff]`) | Active state is currently hue-only (`text-accent` on `#0a0a0a` — cyan hue + value change, but the bar gives a non-hue positional signal). No animation (ui-design-spec §15.7 correctly rejects a sliding indicator). |
| **Icons** (overrides ui-design-spec §5.2 where noted): Compare `GitCompare` · Evaluations `FlaskConical` · Lab `TestTubes` · Models `Cpu` | See B/OVERRIDE-1: spec's `Boxes` collides with Lab's Model Pool identity; Lab's own study eyebrow is `FlaskConical` which collides with Evaluations. `Cpu` matches `ModelsWorkspace.tsx:283` header eyebrow and the `model-configuration` KindEyebrow — the respondent identity. `TestTubes` is unused anywhere in the codebase. |

### A.3 Mobile navigation (`src/ui/MobileWorkspaceNav.tsx`)

| Decision | Reason |
|---|---|
| **Modify** — same four items, same order, `flex-1` columns, icon 18px over `text-xs` label, `min-h-[44px]` + safe-area padding | At 390px, 4 columns ≈ 97px each; "Evaluations" (~11 chars at `text-xs`) fits — the current 3-across layout already renders it at ~130px columns. |
| **Modify** — active item gains a static 2px **top** accent bar (mirror of desktop; nav sits at the screen bottom) | Non-hue active signal at phone width. |
| **Preserve** — Records never enters the bottom nav | Locked. Four primary meanings only. |

### A.4 Command palette (`src/ui/CommandPalette.tsx`)

| Decision | Reason |
|---|---|
| **Preserve** the dialog grammar (cmdk, `z-[60/61]`, mono input, kbd footer, group headings, 44px items, no animation) | Characterized; motion contract compliant. |
| **Modify** — Navigate group order: Compare, Evaluations, Lab, Models, Records, Tasks. Remove "Go to Runs". "Go to Records" uses `History` + keywords `runs`, `history`, `ledger`, `audit` | Muscle memory ("runs") must land somewhere correct. cmdk already supports `keywords` — currently only the group name is passed; extending the keywords array is a one-line change per command. |
| **Modify** — add "Find record by ID…" → opens drawer with search focused (≥1024) or navigates to `/records` with filter input focused (<1024) | The drawer is not the only path to an exact deep link, pre-Child-09. |
| **Modify** — palette Lab icon `Beaker` → `TestTubes` to converge chrome icons | One glyph per destination. |

### A.5 Global execution strip (`src/ui/GlobalExecutionStrip.tsx`)

| Decision | Reason |
|---|---|
| **Preserve entirely** — `h-9`, dot + `StatusMark` + mono caption + elapsed + "View progress" owner link; polite/assertive live regions; suppression on the owning route except storage failure | Strongest existing awareness pattern. It already navigates to the owner and executes nothing. Records must never duplicate it. Drawer backdrop (z-50) covers it; the strip's state is untouched on drawer close. |

### A.6 Records entry point

Does not exist. **New** per C/E. Grammar: identical visual weight to the palette trigger (bordered `bg-panel border-edge` button, never accent-filled) — secondary chrome.

### A.7 Records drawer

Does not exist. **New** per ui-design-spec §6, built as a right-anchored `DrawerSurface` variant of the shipped `DialogSurface` (Base UI dialog — inherits focus trap, inert background, Escape, focus restore; nothing bespoke). 400px, `max-w-[calc(100vw-3rem)]`, ≥1024px only.

### A.8 Full `/records` utility (refactor of `RunsWorkspace` + `runs/` components)

| Decision | Reason |
|---|---|
| **Preserve** the split layout: ≥1024px `380px` list pane (`bg-panel border-r border-edge`) + detail pane (`min-w-[600px]`, shell bg); route-based list/detail below | This layout is the characterized production strength. Do not redesign it. |
| **Preserve** complete-set filter-before-pagination, 200ms debounce, `PAGE_SIZE = 50` + "Load more", deterministic newest-first sort, mobile collapsible filter sheet with applied-count badge | `RunList`/`RunFilters` carry these; tests migrate wholesale. |
| **Preserve** `DataArchiveActions` in the list-pane footer (bottom band, `border-t`) | **Overrides ui-design-spec §7.1**'s "(list pane top)" placement (B/REFINE-4): the footer placement is shipped and tested; a top header band already carries eyebrow/title/count, and a second top action band doubles chrome. |
| **Modify** — list-pane top gains: `RECORDS` eyebrow + "Records" title + filtered-set count (`font-mono text-xs text-text-muted`, e.g. "214 records") | One identity band; count reflects the filtered complete set, not the current page. |
| **Modify** — filters gain a **Type** select (All types · Comparison · Evaluation · Policy Study · Task execution · Observation · Legacy) | Only filter added. Note B/REFINE-5: **no date filter ships today** — §7.3's "existing date bounds" row is stale authority. |
| **Remove** — "Back to Runs" labels and `/runs` destinations in the detail chrome | Replaced by "Records" wording and `/records` routes. The word "Runs" survives only in preserved URLs and `RunRecordV2`. |

### A.9 Records list rows

| Decision | Reason |
|---|---|
| **Remove** the tinted `SourceChip` (`bg-accent/10`, `bg-warning/10`) from the row's identity slot | Visually mediocre-but-compliant: three tint colors repeat on every row of a 380px column, and no other surface uses tinted chips for identity — every identity surface in the app uses the muted `KindEyebrow` grammar. Source information remains in the meta line and the Source filter. |
| **Modify** — new sibling component `RecordTypeRow` (see B/REFINE-6): 4-line list anatomy / 3-line drawer anatomy, muted `RecordTypeEyebrow` (icon+word), `StatusMark`, mono tabular timestamp, title `text-sm` truncate, meta `font-mono text-xs text-text-muted`, owner hint `text-xs text-text-secondary` | Do not deform `RecordRow`'s tested two-line `Inner`; `ModelList` already establishes the mirror-don't-deform precedent. |
| **Preserve** selected treatment: `bg-raised` + `shadow-[inset_2px_0_0_0_#00e5ff]` wrapper; rows are real `<Link>` anchors; trailing "Exact ↗" is a sibling anchor (44×44), never nested | No row/button ambiguity; per-row rects stay inside cards. |

### A.10 Task-execution exact detail (`RunDetail`)

| Decision | Reason |
|---|---|
| **Preserve wholesale** — divide-y section rhythm (header → timeline → provenance → outcome → cost → candidates → judge → fusion → collapsed task/config), mono timestamps + timezone, deep-link `?candidate=`/`?attempt=` focus behavior | The strongest exact-evidence surface in the product. Tests migrate unchanged. |
| **Modify** — actions row normalized to §7.5 order: Open owning context (primary) → Open in Compare (+ honesty token beneath) → Copy link — this device → Export | One fixed grammar on every typed detail. |
| **Modify** — "Run not found / Back to Runs" becomes typed not-found + Records recovery options (§7.4) | Current state is a dead end with one link; unknown IDs must render recovery. |

### A.11 Semantic record detail (comparison / evaluation / policy-study reference)

Does not exist. **New** per §7.4: identity header → owner card (single primary link) + confidence chip → typed summary → "Beneath this record" child rows → honesty token ("reference vs meaning"). No evidence duplication.

### A.12 Observation detail

Does not exist in Records. **New** per §7.4: eligibility panel (icon+word list), exact source link chips (run, attempt, assessment — mono), owner backlink to Task/Model context, policy-evidence marker when study-linked (reuse Child 06/07 wording verbatim).

### A.13 Legacy detail

| Decision | Reason |
|---|---|
| **Preserve** `LegacyRunDetail`'s honesty posture (known fields only, warning-tinted limitation notice, no fabricated fields) and **generalize** it into the typed Legacy detail with import provenance + "Preserved payload" disclosure + unresolved-owner block | The existing component is already the correct honesty model; it becomes the Legacy record detail rather than a special case of runs. |

### A.14 Empty / loading / error / not-found states

| Decision | Reason |
|---|---|
| **Preserve** RunList's state grammar: distinct empty-DB vs zero-match states, one-click "Clear search and filters", error block with retry | Correct and tested. |
| **Modify** — empty state gains the muted `History` icon (28px, matching `ModelList`/`ModelPoolList` empty blocks) and the ledger-scope honesty line; links to Compare **and** Evaluations | Icon consistency across workspaces; the empty ledger should teach the ownership story once. |
| **Modify** — loading replaces bare "Loading…"/spinner text with ≤3 shimmerless skeleton rows (`.animate-pulse-ease`, opacity only); detail headings render immediately from route params | Bare text and full-pane spinners are the compliant-but-mediocre pattern; skeletons preserve layout stability. |
| **New** — typed not-found (eyebrow `NOT FOUND`, exact-ID sentence, three recovery options, device-local honesty note) and the `/records` index-error panel (error role, diagnostics list, Retry rebuild · Copy diagnostics, "index is derived and rebuildable") | Dead ends are unacceptable on a retrieval surface. |

### A.15 Migration pointer

Does not exist. **New** per §11.1: one-time anchored popover on the Records button ("Runs moved."), `role="status"`, non-trapping, keyboard reachable, localStorage-gated (`records-move-pointer-dismissed`), only when the local DB contains ≥1 run record, dismissed on navigation/drawer-open. A pointer, not an apology; appears exactly once per database lifetime.

### A.16 Responsive behavior

| Decision | Reason |
|---|---|
| **Preserve** the breakpoint ladder (`sm` 640 / `md` 768 / `lg` 1024) and each surface's characterized collapse order | Predictability comes from using the same ladder everywhere. |
| **New** — hard drawer cutoff at 1024 (below: the Records button becomes a plain link to `/records`) | A 400px trap over a ~760px canvas crowds without saving a navigation. |
| **Modify** — Records button renders at **all** widths (icon-only 44×44 below `md`) | It is the only mobile chrome route to the ledger; "never more than one interaction away" is violated otherwise. Corrects §8.1's 390px row (B/REFINE-2). |

### A.17 200% zoom behavior

| Decision | Reason |
|---|---|
| **Preserve** the collapse ladder — at 200% (effective ≈720/512/384/195px) the header sheds wordmark/nav/labels exactly as at native narrow widths; utilities reduce to 44×44 icons; the bottom nav takes over primary navigation | No new zoom-specific behavior; zoom inherits the ladder. |
| **Preserve** strip truncation (`truncate` shipped); StatusMark + "View progress" never hide | Execution awareness is never hidden. |
| **Assert** — no document-level horizontal overflow; mono IDs `break-all` in details; `min-w-0` on all flex children; per-row rects inside cards | Acceptance #20, made a visual rule rather than a test-only concern. |

---

## B. Existing UI spec audit (`ui-design-spec.md` v1.0.0)

### KEEP (unchanged, binding)

- §2 principles (all six) — correctly reject centralizing honesty copy and decorative polish.
- §3.1 layering; §3.2 route map; §3.3 type→identity mapping and the **semantic-rows-open-owner / exact-rows-open-record** split (the single behavioral rule of every row).
- §4.1 token reuse + semantic role assignments (exact/unresolved ⇒ muted/secondary, never warning; unresolved owner ⇒ warning; migration errors ⇒ error; active nav/current execution ⇒ accent).
- §4.2 shell-law restatements (heights, eyebrow/type scale, 44px, paddings).
- §5.1 header composition and utility order; §5.5 z-order (with the note that the header is in-flow — z only matters relative to drawer/dialog backdrops, which sit at z-50 above everything).
- §5.3 mobile bottom nav.
- §5.4 palette changes (with icon convergence per OVERRIDE-1).
- §6 drawer surface/anatomy/states/keyboard; §6.3 loading uses shimmerless skeletons.
- §7.4 typed detail anatomies; §7.5 actions grammar and structurally-absent forbidden verbs; §7.6 confidence chip vocabulary.
- §8.2 drawer substitution rule (hard 1024 cutoff); §8.3 zoom rules.
- §9 states table; §10 honesty-token grammar, adjacency rule, caps, `honesty-copy.ts` centralization.
- §11 migration pointer + `/runs/:runId` byte-identical rendering at the old URL (D3) + copy-link canonicalization.
- §12 accessibility budget (live-region cap, focus management, roving tabindex in drawer).
- §13 densification caps 1–10 (after REFINE-5 adjusts cap 6's implication).
- §14 acceptance criteria (with the corrections below applied).
- §15 rejection ledger — all seven rejections stand.

### REFINE

**REFINE-1 — §4.3 `.honesty-note` definition is unsafe as written.**
Problem: `.honesty-note` is already shipped as a *semantic marker class* across the Models workspace (Child 07) — 18 usages in `ModelList`, `ModelEvidenceProfile`, `HonestValue`, `RollupBanner`, `CoverageGrid`, `DeterministicNarrative`, `FamilyEvidenceCard`, `MemberShelf`, `ObservationDrilldown`, `PairedComparisonSection`, `ModelsWorkspace` — with **no CSS definition anywhere** (grep-confirmed at baseline). Every usage pairs it with utilities (`text-xs text-text-muted`, one `text-[10px]`, one `text-warning`). Defining `.honesty-note { font-size: 11px; color: #a1a1a1; }` at the end of `index.css` silently overrides those utilities (equal specificity, later cascade wins) and restyles accepted Child 07 surfaces without a single test catching it (tests assert class presence, not computed style).
Replacement: `.honesty-note` carries **only** `line-height: 1.4`. Size and color remain utilities owned by the `HonestyNote` component: Records tokens render as `honesty-note text-[11px] text-text-secondary`; Models' usages render unchanged (12px muted, their accepted design). Acceptance #2 changes to "`.honesty-note` exists in `src/index.css` with `line-height: 1.4` only; `HonestyNote` owns the token size/color."
Tradeoff: styling authority is split (marker class + component-owned utilities); mitigated by `honesty-copy.ts` + `HonestyNote` being the only Records producer, and the class staying grep-able as the semantic hook tests already rely on.

**REFINE-2 — §5.1/§8.1 mobile utility contradiction.**
Problem: §8.1's 390px row ("utilities all icon-only 44×44") contradicts §5.1 and shipped behavior (palette/help are `hidden` below `md`; the hamburger is Compare-only). "All utilities" at 390px cannot literally mean palette+help appear.
Replacement: at <`md`, the header renders hamburger (Compare only) · logo · **Records (44×44 icon button, `aria-label="Records"`)** · connections pill (dot, accessible name carries the status word). Palette and help remain hidden below `md` — characterized behavior, and the palette loses its Compare command context off-route anyway. §8.1's 390 row is amended accordingly.
Tradeoff: no palette access from mobile Records routes; accepted — navigation needs are served by the bottom nav, and record search is served by the Records surface itself.

**REFINE-3 — §7.1 page-header composition vs shipped archive placement.**
(See A.8.) Replacement: page-header band carries eyebrow/title/count only; `DataArchiveActions` stays in the list-pane footer. Amends §7.1's "(list pane top)" parenthetical.
Tradeoff: export/import is one scroll-depth lower in the pane; the pane top keeps a single calm identity band.

**REFINE-4 — §7.3 "Date | existing date bounds" is stale authority.**
Problem: `RunFilters` ships five controls — text, model, status, mode, source (`EMPTY_FILTERS` has no date field). No date filter exists to "retain."
Replacement: the filter table is six controls (search, type, model, status, mode, source); §13 cap 6 reads "filters ≤6 controls." A date filter is out of scope for Child 08; if ever added, it is a new characterized control with its own acceptance line.
Tradeoff: large ledgers rely on search/status/model narrowing; accepted — pagination is complete-set and deterministic.

**REFINE-5 — §7.2 "Built on RecordRow" → sibling component.**
Problem: `RecordRow`'s `Inner` is a fixed two-line structure; it cannot express the 4-line typed anatomy (eyebrow line / title / meta / owner hint), a ReactNode title isn't accepted, and deforming it would touch Compare recent-run rows, Task Set history rows, and rubric rows that share it. `ModelList.tsx:5-7` documents exactly this decision and mirrors instead.
Replacement: new `RecordTypeRow` sibling reusing RecordRow's exact class grammar (`min-h-[44px] rounded-md border border-edge bg-panel px-3 py-2 hover:border-edge-bright`, real `<Link>`, sibling trailing anchor). `RecordRow` is untouched.
Tradeoff: two row implementations; bounded, and each has a single anatomy to defend.

**REFINE-6 — §6.2 drawer group "FROM COMPARE (comparison + ad hoc task executions)".**
Keep the grouping, but make the mixed-type rule explicit: a group's rows may carry different `RecordTypeEyebrow`s (a COMPARISON ref and its leaf TASK EXECUTION rows both live under FROM COMPARE); the eyebrow — not the group — carries type identity. Semantic/exact open-target behavior (§3.3) applies per row regardless of group.
Tradeoff: none; this is what the spec already implies, now stated so an agent doesn't "fix" it into type-homogeneous groups.

**REFINE-7 — §14 acceptance #5 must cite all four destinations** (editorial): "All four primary destinations render functional content on direct load," including Lab (`/lab`, `/lab/recipes`, `/lab/model-pools`) and Models (`/models`).

### OVERRIDE

**OVERRIDE-1 — §5.2 icon set.**
`Models | Boxes` → **`Cpu`**; Lab = **`TestTubes`** (not "match Lab's KindEyebrow icon," which is `FlaskConical` — colliding with Evaluations' nav icon). `Boxes` is Lab's **Model Pool** identity (`KindEyebrow` pool + `ModelPoolList` empty state + `ModelList` first-use block); using it for the Models destination reuses another entity's clothing and reads as "pools," not "model evidence." `Cpu` is the shipped Models header eyebrow (`ModelsWorkspace.tsx:283`) and the `model-configuration` KindEyebrow — the exact respondent. Chrome icons converge: nav, mobile nav, palette (`Beaker` → `TestTubes` for Lab), and `RecordTypeEyebrow` (policy-study → `TestTubes`, evaluation → `FlaskConical`).
Tradeoff: `Cpu` is slightly more abstract than `Boxes`; offset by identity consistency. Whether Lab's *internal* study KindEyebrow also moves to `TestTubes` is a human decision (F/UI08-PENDING-01).

**OVERRIDE-2 — behavioral spec §3.1/§10 "three-item" mobile nav and "Compare · Evaluations · Models."**
Resolved by the authority table above: four items, both surfaces. The behavioral spec's stale sentences are superseded by ui-design-spec note 1 and program spec P03; implementation plan Task 7's RED text is amended to the four-item list.

**OVERRIDE-3 — §8.1 390px row** (covered by REFINE-2): replace "utilities all icon-only 44×44" with the REFINE-2 composition.

### AMBIGUOUS / HUMAN DECISION REQUIRED

Only genuinely material items — see §F (UI08-PENDING-01..03).

---

## C. Visual execution contract

Rules over pixels. All tokens from `tailwind.config.js` + `src/index.css`; nothing new beyond
§4.3's two additions (as amended by REFINE-1).

1. **Hierarchy.** Three registers, in descending weight: (1) *destinations* — primary nav items, page titles (`text-base`/`text-lg font-semibold`); (2) *chrome and structure* — section headers, eyebrows (`font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted`), body (`text-sm`); (3) *metadata and honesty* — `text-xs`/`text-[11px]`, `text-text-secondary`/`text-text-muted`, mono+tabular for identifiers, costs, timestamps. Records never rises above register 2 except its page title; the ledger is deliberately one register quieter than the primaries.
2. **Density.** Rows: `px-3 py-2`, `gap-0.5` internal, `gap-2` between interactive siblings. List pane packs rows edge-to-edge (`divide`-free, `gap` via wrapper `py-0.5`, as shipped). The 4-line record row is the densest permitted row; nothing denser ships.
3. **Whitespace.** Earned through section rhythm, not padding inflation: detail surfaces use the shipped `divide-y divide-edge` document rhythm; the drawer uses `p-3` bands separated by hairlines. No page-level max-width centering on Records surfaces (workbench, not marketing page) — detail panes fill available width; text blocks wrap naturally.
4. **Panel emphasis.** `bg-panel` (#121212) = working surfaces (list pane, strip, footer bands); `bg-raised` (#181818) = floating surfaces (dialogs, drawer, palette); `bg-canvas/shell` (#0a0a0a) = void behind documents. Emphasis = surface step, never shadow stacks or gradients. `shadow-popover` only on floating surfaces.
5. **Border usage.** `border-edge` (#262626) is the default hairline; `border-edge-bright` (#3a3a3a) marks hover and floating-surface edges. Selection/active use 2px inset accent bars (rows: left; desktop nav: bottom; mobile nav: top). No 1px accent borders on static content.
6. **Navigation emphasis.** Active destination = `text-accent` + 2px bar + `aria-current="page"`. Exactly one active bar visible per nav surface. Inactive = `text-text-secondary`, hover `bg-panel` + `text-text`.
7. **Utility emphasis.** All header utilities share one grammar: bordered `bg-panel border-edge` button, `hover:border-edge-bright`, 44px minimum, never accent-filled. The connections pill is the sole rounded-full element and the sole `aria-live` chrome element. The Records button is visually indistinguishable in weight from the palette trigger — secondary chrome by construction.
8. **Typographic hierarchy.** Eyebrow → title → body → meta. Identifiers (`run-…`, `cmp-…`, `obs-…`, digests), timestamps, durations, and costs are always `font-mono tabular-nums`. Prose is Geist; IDs are Geist Mono; never mixed within a single inline run.
9. **Metadata density.** One meta line per list row (`font-mono text-xs text-text-muted`, `·`-separated: roster summary · mode · cost when known); one owner-hint line (`text-xs text-text-secondary`). Trailing cluster (`N models` · time) hugs the right edge via `ml-auto`; below `sm` the meta line wraps rather than clips (shipped behavior, retained).
10. **Information grouping.** Group headers are mono uppercase muted; groups with zero items do not render. Within details: header → owner → summary → children → evidence → disclosures, always in that order.
11. **Owner/context cues.** Every semantic record carries an owner hint ("in Frontend Reliability · Task Set v6") and a single primary owner action. Owner grammar: "in {owner} · {qualifier}", never a bare URL, never a guessed link.
12. **Exactness/provenance cues.** Exactness is quiet: muted mono IDs, exact timestamps with timezone, `Exact owner`/`Mapped owner` chips in secondary text. Warning color is reserved for `Origin unresolved` and real errors — an exact record is not a hazard.
13. **Progressive disclosure.** Long payloads ("Preserved payload", task/configuration) live behind `aria-expanded` disclosure buttons with contained scroll (`max-h-96`). Drawer shows ≤5 rows/group pre-search; the full page is the depth surface.
14. **Responsive transformation.** One ladder: label → icon → move-to-bottom-nav → route-substitution, in that order, at the shipped breakpoints. The drawer is the only surface that *substitutes* (→ `/records` route below 1024); everything else collapses.
15. **Long-content behavior.** Titles truncate in rows and wrap in detail headers. Mono IDs `break-all` in detail surfaces. `min-w-0` on every flex child. Meta lines wrap below `sm`. No horizontal scroll anywhere in shell or Records.
16. **Mobile composition.** Bottom nav owns primary wayfinding; the header owns identity + Records + readiness. Records list is full-bleed `bg-panel`; detail is a full-screen route with a `Back to Records` header band (`min-h-[44px]`). Filters collapse into the shipped sheet with applied-count badge.
17. **Loading/error/empty.** Skeleton rows (opacity-only pulse), never layout-shifting spinners; headings render immediately from route params. Errors are bounded blocks (icon + sentence + reason + retry), never full-page. Empty states teach ownership once (icon + one sentence + one or two exits).
18. **Interaction feedback.** Hover = border-bright step + text step (`.motion-state` 150ms). Press = `.pressable` 0.97 scale at 100ms. Focus = the global 2px accent `:focus-visible` ring, never removed, never replaced. No hover transforms on record rows.
19. **Motion restraint.** Only `.drawer-panel` is added (16px slide + fade, 200/150ms `--ease-out-ui`), and it joins the `prefers-reduced-motion` zero-duration group. No `transition-all`, no palette animation, no nav-indicator slide, no skeleton shimmer.
20. **Focus/accessibility-visible treatment.** Focus ring is the single global treatment; route changes move focus to the destination heading (`tabindex="-1"`); drawer/dialog traps come from the Base UI primitive only; status/type/unresolved are icon+word everywhere; `.honesty-note` text is `text-text-secondary` (#a1a1a1, ≥4.5:1 on panel/raised) — never `#777777` for claim-limiting copy.

---

## D. Canonical reference states

Runnable artifact: **`docs/explorations/future-task-first-ui/child08-canonical-states.html`**
(plain HTML/CSS/JS, no build; open in a browser; state switcher top-left). It implements all
eight required states with realistic RSemble content:

1. **1440 shell, Records closed** — full header (nav icons+labels, ⌘K kbd trigger, Records icon+label, connections dot+word, help), active-nav accent bar on Evaluations, execution strip visible.
2. **1440 shell, Records drawer open** — 400px right drawer over backdrop: five groups (non-empty only), 3-line compact rows, EXACT MATCH example under search, footer View-all + ledger-scope honesty note.
3. **`/records` split list + detail** — 380px list pane (RECORDS eyebrow, count, six filters, 4-line typed rows incl. semantic row with trailing Exact ↗, selected treatment) + task-execution detail.
4. **Semantic record reference detail** — comparison reference: owner card ("Comparison result in Compare", `Exact owner` chip), typed summary, Beneath-this-record rows, reference-vs-meaning honesty note.
5. **Exact task-execution detail** — header chips, timeline, outcome, cost breakdown, candidate rows, judge evidence summary, actions row with configuration-only token.
6. **Empty / error / not-found** — three representative states in one frame: empty ledger, query error with retry, typed not-found with three recovery options + device-local note.
7. **390px Records list/detail** — two phone frames: full-bleed list (collapsible filter toggle with badge, 4-across bottom nav) and full-screen detail with Back band; Records icon visible in the header at 390px.
8. **200% zoom stress** — the 1440 composition rendered at 2× inside a clipped ~720px viewport: utilities reduced to 44px icons, bottom nav present, no horizontal document overflow.

These are reference compositions, not production implementation. Prototype content is
illustrative only (program spec §13) — IDs, models, and costs are sample shapes.

---

## E. Responsive matrix

| Width | Remains visible | Collapses | Moves / changes pattern | Never disappears | Never overflows |
|---|---|---|---|---|---|
| **1440** | Full header: wordmark, nav icons+labels, ⌘K kbd trigger, Records icon+label, connections dot+word, help. `/records` split 380+fluid; drawer 400px available. | — | — | All four nav labels; execution strip essentials | Drawer ≤400px + `max-w-[calc(100vw-3rem)]`; detail `min-w-[600px]` inside a scrolling flex, not the document |
| **1024** | Nav labels (icons hide at <`lg`, shipped); palette icon button; Records icon+label; connections dot+word at exactly `lg` | Nav icons; ⌘K kbd → icon | Drawer and split view begin here | Same | Same |
| **768** | Logo, nav labels (no icons), palette icon, Records icon, connections dot (word hidden until `lg`), help icon | Connections word; wordmark hidden <`sm` | Desktop nav persists until `md`; bottom nav appears below `md` | Records button; strip StatusMark + View progress | Utility cluster `gap-2` with 44px buttons; nav column `min-w-0` |
| **390** | Logo, hamburger (Compare only), **Records icon 44×44**, connections dot; bottom nav 4-across (~97px columns, icon 18px over `text-xs`) | Palette, help, wordmark, desktop nav | Records button navigates (no drawer); list/detail become routes; filters collapse into sheet with badge | Records button; bottom nav; strip essentials | Rows `min-w-0`; mono IDs `break-all`; meta wraps; `px-2` header |
| **200% zoom** (eff. ≈720/512/384/195px) | Same ladder as native widths — zoom inherits it; nothing is zoom-specific | Wordmark, nav labels, connections word | Primary nav transfers to bottom nav exactly as at native narrow widths | Connections pill + palette/Records as 44px icons; strip caption truncates but StatusMark + View progress stay | No document-level horizontal overflow on any shell or Records route; per-row rects inside cards |

---

## F. Human decision ledger

**UI08-PENDING-01 — Policy Study glyph identity across surfaces.**
- *Decision:* does Lab's internal `KindEyebrow` `study` icon (`FlaskConical`) move to `TestTubes`, or stay?
- *Recommended:* move it to `TestTubes` — one glyph per type everywhere (nav, palette, Records eyebrows, Lab internals). A POLICY STUDY record row carrying `FlaskConical` shares clothing with EVALUATION rows, violating the spec's own "types are visible identities" principle at exactly the surface (Records) where six types interleave. The change is one token in `KindEyebrow.tsx` with ~6 Lab callsites inheriting automatically.
- *Alternative:* leave Lab internals at `FlaskConical` (context disambiguates inside the Lab rail; only chrome + Records use `TestTubes`).
- *Consequence:* if left, two type glyphs exist for Policy Study forever, and the Records eyebrow grammar has a permanent documented exception.

**UI08-PENDING-02 — Semantic references and their leaf task executions interleave in the `/records` list.**
- *Decision:* a completed comparison appears as both a COMPARISON reference row and one TASK EXECUTION row (same event, two entries). Accept the interleaving, or default-hide duplicates?
- *Recommended:* accept the interleaving (spec default: single list, newest-first, type eyebrow disambiguates; the owner hint makes the relationship visible; the trailing Exact ↗ connects them). This is the "meaning up, ledger down" duality rendered honestly — hiding leaf rows behind their semantic refs would make the exact ledger incomplete under default filters.
- *Alternative:* default the Type filter to exclude semantic refs (exact-ledger-first view). Rejected as default because it inverts the spec's typed-union premise; a user who wants it sets the Type filter.
- *Consequence:* the list shows the same event twice; mitigated by type eyebrows + owner hints, and worth one usability check in the Child 08 browser gate (do testers read the two rows as duplicates or as reference/evidence pairs?).

**UI08-PENDING-03 — "Beneath this record" depth on Policy Study reference details.**
- *Decision:* studies can have hundreds of trials/attempts; how much renders in Records?
- *Recommended:* cap the list at 20 most-recent child rows + a count line ("142 trials · 12 observations") + the single owner action ("Open study"). Records renders the reference and the links; the owner renders the meaning — full pagination inside Records would duplicate Lab's surface.
- *Alternative:* full pagination of child records inside Records (complete, but rebuilds the owner's surface inside the ledger).
- *Consequence:* deep study archaeology requires one navigation to the Lab; exact deep links still resolve directly.

---

## G. Handoff summary

### G.1 The ten most important implementation truths

1. **Four destinations, both navs, same order:** Compare · Evaluations · Lab · Models. Runs is gone from navigation; "Runs" survives only in preserved URLs and `RunRecordV2`. The behavioral spec's three-item text and the implementation plan's Task 7 RED are stale — program spec P03 + ui-design-spec note 1 are authority.
2. **Records is chrome-secondary, route-primary.** One header button (drawer ≥1024, route <1024), never in either primary nav, never accent-filled, always one interaction away — including at 390px, where it is the *only* chrome route to the ledger and therefore renders at all widths.
3. **One row rule:** semantic rows (comparison/evaluation/policy-study) open their owner; exact rows (task-execution/observation/legacy) open their record detail. Everywhere: drawer, list, palette. The trailing Exact ↗ sibling anchor bridges semantic rows to the ledger.
4. **`.honesty-note` is already shipped as a marker class in the Models workspace with zero CSS.** Define it as `line-height` only (REFINE-1) or you will silently restyle accepted Child 07 surfaces.
5. **Do not deform `RecordRow`.** Build `RecordTypeRow` as a sibling reusing its class grammar; `RecordRow` serves four other surfaces with a tested two-line contract. Precedent: `ModelList`.
6. **No date filter exists.** §7.3's "existing date bounds" is stale; the filter set is six controls and cap 6 becomes ≤6.
7. **Forbidden verbs are structurally absent, not disabled.** Retry/re-judge/re-fuse/repair/resume/add-model/delete never render in any Records state; acceptance sweeps assert absence.
8. **The drawer is a `DialogSurface` variant, not a new primitive.** Focus trap, inert background, Escape, focus restore are inherited from the Base UI dialog; the only new CSS is `.drawer-panel` + the reduced-motion entry.
9. **`/runs/:runId` renders at the old URL forever (no redirect); copy-link emits the canonical `/records/...` form.** Old copied links stay byte-identical; new links are forward-canonical. Both are tested on direct load, refresh, back/forward, hash router.
10. **Characterization before refactor.** Every Runs behavior (complete-set filtering, debounce, page size, preload, split layout, detail sections, copy-link, legacy states) gets a passing test against current code *before* any file moves; those tests migrate wholesale and none are deleted to make the rename pass.

### G.2 The five easiest ways to satisfy the spec and still produce a bad UI

1. **Drawer or detail panes that duplicate owner surfaces** — e.g. rendering a full evaluation matrix inside a Records detail "for completeness." Technically typed; actually turns the ledger into a second Evaluations workspace and violates "no evidence duplication" in spirit. The owner card + Beneath list + one navigation is the whole design.
2. **Tinted identity chips** — keeping `SourceChip`-style `bg-accent/10` / `bg-warning/10` pills for record types. Compliant with "type is visible" but chroma-noisy and off-grammar; every identity surface in the app is a muted eyebrow.
3. **A "helpful" owner guess** — resolving an unknown historical owner to the latest Task Set/version "so the button isn't missing." The chip vocabulary exists precisely to make `unresolved` a first-class, inspectable state; guessing silently corrupts provenance while looking complete.
4. **Honesty copy as banners or toasts** — centralizing tokens into a dismissible banner, or sprinkling more than two per block / four per surface. Each is technically "present" and both destroy the adjacency contract that makes the honesty readable. Strings come only from `honesty-copy.ts`.
5. **Decorative compliance** — sliding nav indicators, shimmer skeletons, hover-lift rows, drawer spring physics, or an animated palette. Each passes "has motion" intuition and violates the motion contract's actual rule: motion conveys state continuity, never ornament. Static bars, opacity-only pulse, 16px ease-out slide, done.

### G.3 Canonical artifacts for the next agent

1. **This package** (`design-authority-package.md`) — audit, reconciliation, contract, matrix, ledger.
2. **`ui-design-spec.md`** — the visual authority, **as amended by §B here** (REFINE-1..7, OVERRIDE-1..3 govern where they conflict).
3. **`workbench-shell-and-records-spec.md`** — behavioral authority for what exists and what it means, **minus** the stale items in the reconciliation table.
4. **`child08-canonical-states.html`** — the eight reference compositions (§D).
5. **Shipped production strengths** (the refactor substrate): `src/workspaces/RunsWorkspace.tsx`, `src/workspaces/runs/{RunList,RunFilters,RunDetail,LegacyRunDetail,CopyLinkButton}.tsx`, `src/ui/{RecordRow,StatusMark,KindEyebrow,DialogSurface,DataArchiveActions,GlobalExecutionStrip}.tsx`, `src/index.css`, `tailwind.config.js`.
6. **Not authority:** the phase-A/B/C HTML explorations under `docs/explorations/future-task-first-ui/` (provenance only; their chrome is rejected by ui-design-spec §15).
