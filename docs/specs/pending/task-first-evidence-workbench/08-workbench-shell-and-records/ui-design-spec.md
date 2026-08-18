# Workbench Shell and Records UI Design Specification

**Version:** 1.0.0
**Date:** 2026-08-17
**Status:** Design authority for the final workbench shell, the secondary Records utility, and the
quick Records drawer, alongside the behavioral contract
[`workbench-shell-and-records-spec.md`](./workbench-shell-and-records-spec.md). Where the two
appear to conflict, the behavioral spec wins on *what exists and what it means*; this document
wins on *how it looks, reads, moves, and responds*.
**Supersedes:** the shell chrome depicted in
`docs/explorations/future-task-first-ui/rsemble-future-workbench.html` and
`rsemble-future-workbench-phase-c.html`. Those prototypes remain provenance for topology
arguments; their 38–42px controls, color-only ledger dots, JavaScript-populated empty drawers, and
interactive-`div` rows are rejected here (see §15).

**Reconciliation notes (binding):**

1. The behavioral spec's §3.1 text predates the ratified four-destination topology. Final primary
   navigation is **Compare · Evaluations · Lab · Models** — child 06's contract explicitly defers
   adding **Lab** to primary navigation to this child, and the Models workspace ships per child 06
   (Model Evidence Profiles). All four destinations must be functional at release; the entry gate
   ("no inert primary destination") applies to all four.
2. The behavioral spec's §4.1 Fusion Study owner route
   (`/evaluations/sets/:taskSetId/fusion/:studyId`) was retired by the Research Lab child. The
   corresponding Record type is the **Policy Study reference**, owner `/lab/studies/:studyId`,
   with trials/attempts/study observations/playbook beneath it. Records must also carry Lab asset
   versions only insofar as studies reference them; recipes/pools are not Record types.

---

## 1. Scope

This document specifies:

- The final header, primary navigation (desktop and mobile), and secondary utility cluster
- The quick Records drawer (≥1024px) and its narrow-viewport substitution
- The full Records utility at `/records` and `/records/:recordType/:recordId`
- Typed record rows, typed detail surfaces, owner backlinks, and the honesty-token grammar
- Legacy `/runs` route behavior and the navigation-switch migration UX
- Shell binding rules: z-order, execution strip interplay, command palette changes, densification
  caps, responsive and accessibility behavior

It does not respecify the interiors of Compare, Evaluations, Lab, or Models — only how the shell
reaches them and how Records points back at them.

---

## 2. Design principles

1. **The shell is a directory, not a workspace.** Chrome answers exactly two questions — "where am
   I?" and "where is the thing I need?" — and then gets out of the way. Nothing in the header,
   nav, drawer, or Records ever executes, retries, or spends money. Every execution affordance
   lives one navigation away, in its owner.
2. **Meaning up, ledger down.** The four primary destinations organize work by meaning (a
   comparison, a workload, a study, a model). Records organizes the same events by exactness (what
   ran, when, at what cost, with what evidence). The two orderings coexist; neither is hidden.
   Records is deliberately styled one register quieter than the primaries — utility, not
   destination — but it is never more than one interaction from anywhere.
3. **Honesty is adjacent, not centralized.** Every claim-limiting statement — device-local links,
   configuration-only handoffs, unresolved origins, policy-evidence markers, eligibility notices —
   renders at the point of the affordance it qualifies, in a fixed token grammar (§10). This
   deliberately rejects the "one honesty channel per surface" hypothesis: a single banner forces
   users to cross-reference; an adjacent token is read exactly when it matters. Density is
   controlled by caps (§13), not by centralization.
4. **Types are visible identities.** A comparison, an evaluation execution, a policy study, a task
   execution, an observation, and a legacy import are six different things. Every Records surface
   says which one it is showing — eyebrow, icon, and route — and never coerces one into another's
   clothing.
5. **Nothing is removed; everything is re-addressed.** Old URLs keep working, old copy stays
   findable, old muscle memory (⌘K, "runs") lands somewhere correct. The migration UX (§11) is a
   pointer, not an apology, and it appears exactly once.
6. **Honest surfaces only.** No inert destinations, no placeholder utilities (Attention is absent
   until its child ships — no reserved icon, no disabled button), no empty-by-default drawers, no
   interactive `div`s, no color-only status, no control under 44×44.

---

## 3. Information architecture

### 3.1 Layering

| Layer | Content | Surface |
|---|---|---|
| **Default** (always visible) | Primary nav (Compare · Evaluations · Lab · Models); connection readiness; current execution awareness (strip, when active) | Header + GlobalExecutionStrip + mobile bottom nav |
| **Secondary** (one interaction away) | Records drawer / `/records`; command palette; keyboard cheatsheet; connections detail | Header utility cluster |
| **On demand** (behind navigation or disclosure) | Full Records filtering and typed detail; exact evidence sections; archive export/import; legacy deep links | `/records` routes, detail disclosures |

### 3.2 Route map (this child)

```
/records                              full utility — typed list (+ split detail ≥1024)
/records/:recordType/:recordId        typed detail (canonical exact-record routes)
  recordType ∈ comparison | evaluation | policy-study | task-execution | observation | legacy
/runs                                 redirects to /records, preserving supported query filters
/runs/:runId                          continues rendering exact task-execution detail at the old
                                      URL (no redirect) — copied links stay byte-identical
```

Owner routes (owned by other children, linked from Records): `/compare/results/:id`,
`/evaluations/results/:id`, `/evaluations/sets/:taskSetId`, `/lab/studies/:studyId`,
`/models/:modelKey` (per child 06's Models contract), plus Task routes.

### 3.3 Record type → identity mapping (normative)

| Type | Eyebrow label | Icon (lucide) | Default open target | Exact target |
|---|---|---|---|---|
| Comparison | `COMPARISON` | `GitCompare` | `/compare/results/:id` (owner) | leaf task execution(s) beneath |
| Evaluation execution | `EVALUATION` | `FlaskConical` | `/evaluations/results/:id` (owner) | task executions beneath |
| Policy Study | `POLICY STUDY` | `FlaskConical`-variant used by Lab (`TestTubes` if Lab shipped it; must match Lab's KindEyebrow) | `/lab/studies/:id` (owner) | trials/observations beneath |
| Task execution | `TASK EXECUTION` | `Terminal` | `/records/task-execution/:id` (exact detail IS the target) | — |
| Observation | `OBSERVATION` | `Eye` | `/records/observation/:id` typed detail | exact source links within |
| Legacy | `LEGACY` | `Archive` | `/records/legacy/:id` typed detail | preserved payload within |

Semantic types (comparison, evaluation, policy study) open their **owner** by default; exact types
(task execution, observation, legacy) open their **record detail** by default. This split is the
single behavioral rule of every record row everywhere (drawer, list, palette).

---

## 4. Tokens

### 4.1 Existing tokens, used as-is

The full palette, radii, shadows, fonts, and motion variables from `tailwind.config.js` and
`src/index.css` apply unchanged: canvas/shell `#0a0a0a`, panel/card `#121212`, card-hover
`#1a1a1a`, raised `#181818`, edge `#262626`, edge-bright `#3a3a3a`, accent `#00e5ff`,
success `#00ff9d`, warning `#ffb300`, error `#ff4d4d`, text `#ededed`/`#a1a1a1`/`#777777`;
radii `4/6/8px`; `shadow-popover`; Geist / Geist Mono; `--motion-fast` 100ms, `--motion-short`
150ms, `--motion-medium` 200ms; `--ease-out-ui cubic-bezier(0.23,1,0.32,1)`.

Semantic roles this child commits to: **exact/unresolved-honesty text ⇒ muted/secondary text
roles, never warning** (an exact record is not a hazard); **unresolved owner ⇒ warning role**
(icon+word); **migration/index errors ⇒ error role**; **active nav/current execution ⇒ accent**.

### 4.2 Type and spacing (existing conventions, restated as shell law)

- Header height `h-14`; execution strip `h-9`; both retained exactly.
- Eyebrows `font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted`; section headers
  `font-mono text-xs font-semibold uppercase tracking-wider text-text-muted`; body `text-sm`;
  metadata `text-xs`; identifiers/costs/timestamps `font-mono tabular-nums`.
- Interactive minimum `min-h-[44px] min-w-[44px]` — this now includes every header utility (the
  prototypes' 38–42px buttons are rejected); interactive siblings ≥ `gap-2`.
- Row/card padding `px-3 py-2`; drawer body `p-3`; dialog body `p-6`.

### 4.3 New tokens and utilities (exact additions to `src/index.css`)

```css
/* Records drawer: slides from the right edge. Transform/opacity only. */
.drawer-panel {
  transition:
    transform var(--motion-medium) var(--ease-out-ui),
    opacity var(--motion-short) var(--ease-out-ui);
}
.drawer-panel[data-entering] { transform: translateX(16px); opacity: 0; }

/* Honesty token: the single fixed style for claim-limiting microcopy. */
.honesty-note {
  font-size: 11px;
  line-height: 1.4;
  color: #a1a1a1;              /* text-secondary — must stay ≥4.5:1 */
}
```

Append `.drawer-panel` to the existing `prefers-reduced-motion` block's
`transition-duration: 0ms` group (the drawer then appears/disappears instantly; the 16px offset
never renders because the transition is zero-length and the attribute clears on mount).

No new colors, keyframes, radii, shadows, or easing curves. The motion contract
(`src/ui/motion-contract.test.ts`) applies unchanged: no `transition-all`, no bare `ease-in`, no
`scale(0)`, no hover-transforms on record rows, no animation on the command palette.

---

## 5. Header and primary navigation

### 5.1 Header composition (final)

The shipped `Header.tsx` grid (`h-14`, `grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`,
`border-b border-edge bg-shell`, `px-2 sm:px-4`) is retained. Final contents:

```
LEFT    [mobile menu button (md:hidden)] [HexCubeLogo 22px accent] [RSemble AI (hidden <sm)]
CENTER  [WorkspaceNav — hidden <md]
RIGHT   [⌘K palette trigger] [Records] [Connections pill] [Help ?]
```

- **Utility order is fixed**: palette, Records, Connections, Help — most-used to least, with
  Connections kept adjacent to Help so the readiness pill never moves when Attention is later
  inserted (its future slot is between Records and Connections; nothing renders there now — no
  spacer, no hidden element).
- **Records utility button**: `min-h-[44px]` bordered button matching the palette trigger's
  grammar — lucide `History` icon (deliberate continuity with the old Runs identity) + label
  "Records" at `lg:`, icon-only `h-11 w-11` from `md` to `lg`, with `aria-label="Records"` always.
  At ≥1024px it opens the drawer (`aria-haspopup="dialog"`, `aria-expanded`); below 1024px it
  navigates to `/records` directly (no drawer; §8.2). It is visually identical in weight to the
  palette trigger — secondary chrome, never accent-filled.
- **Connections pill**: unchanged (rounded-full, dot + text, `aria-live="polite"`), except the dot
  gains a paired word at `lg:` and an `aria-label` that always carries the status word — readiness
  must not be color-only, which the current dot-only `<lg` rendering violates; fix in this child.
- The header never scrolls away; the execution strip (unchanged `h-9`) renders beneath it and
  above content, cross-workspace awareness only — its "View progress" link remains the only
  interactive element and navigates to the owning execution.

### 5.2 Desktop primary nav (`WorkspaceNav.tsx`)

Items, in order, exactly:

| Route | Label | Icon (≥lg) |
|---|---|---|
| `/compare` | Compare | `GitCompare` |
| `/evaluations` | Evaluations | `FlaskConical` |
| `/lab` | Lab | `TestTubes` (match Lab's KindEyebrow icon) |
| `/models` | Models | `Boxes` (match Models workspace identity) |

Existing link classes retained (`min-h-[44px] px-3 text-sm font-medium`, active `text-accent`,
`aria-current="page"`), with one addition: the active item also renders a 2px bottom accent bar
(`shadow-[inset_0_-2px_0_0_#00e5ff]` or an absolutely-positioned bar) so the current destination
has a non-hue-only signal alongside `aria-current`. **Runs is removed from this nav.** No Records
entry appears here — Records lives only in the utility cluster.

`/tasks` remains a secondary workspace reachable via palette, unchanged.

### 5.3 Mobile bottom nav (`MobileWorkspaceNav.tsx`)

Exactly the same four items, same order, `flex-1` columns, icon 18px above `text-xs` label,
`min-h-[44px]` plus safe-area padding — all shipped behavior retained. Four items at 390px yields
≈97px columns; labels fit without truncation ("Evaluations" is the longest at ~11 characters in
`text-xs`; verified against the current 3-across layout which already renders it). **Records is
not a bottom-nav item** at any width; on mobile it is reached via the header Records button (which
navigates) and via deep links. The active item keeps `text-accent` plus a 2px top accent bar
(mirror of desktop's bottom bar, since the nav sits at the screen bottom).

### 5.4 Command palette changes

- Navigate group becomes: "Go to Compare", "Go to Evaluations", "Go to Lab", "Go to Models",
  "Go to Records", "Go to Tasks" — in that order.
- "Go to Records" carries the `History` icon and the search keywords `runs`, `history`, `ledger`,
  `audit` so typing "runs" still lands correctly. There is no "Go to Runs" item.
- A new palette command "Find record by ID…" focuses the Records search: it opens the drawer with
  the search input focused (≥1024) or navigates to `/records` with the filter input focused
  (<1024). This satisfies "the drawer is not the only way to reach an exact deep link" even before
  child 09's global search.
- No other palette changes; the palette remains unanimated per the motion contract.

### 5.5 Shell z-order (normative)

`z-30` mobile bottom nav → `z-40` header (raise from current if lower) → `z-50` dialogs, palette,
and drawer backdrop/panel. The drawer never renders beneath the execution strip; the strip remains
visible behind the drawer's backdrop (awareness is not blocked, and the drawer's Escape/close
restores it untouched).

---

## 6. Quick Records drawer (≥1024px)

### 6.1 Surface

A right-anchored panel built on the same Base UI dialog primitive as `DialogSurface` (focus trap,
inert background, Escape, focus restore are inherited, not reimplemented), rendered as a new
`DrawerSurface` variant:

- Backdrop: `fixed inset-0 z-50 bg-black/70`.
- Panel: `fixed inset-y-0 right-0 z-50 w-[400px] max-w-[calc(100vw-3rem)] border-l
  border-edge-bright bg-raised shadow-popover flex flex-col drawer-panel`.
- Motion: enter/exit via `.drawer-panel` (16px slide + fade, 200ms/`--ease-out-ui`); reduced
  motion: instant (§4.3). The backdrop fades with `--motion-short`.

### 6.2 Anatomy

```
Header (px-3, h-14, border-b border-edge):
  eyebrow RECORDS · title "Records" · close button (h-11 w-11, X icon, aria-label "Close records")
Search (p-3, border-b border-edge):
  input: placeholder "Search exact ID or safe metadata…"
  (min-h-[44px], full width, font-mono for entered IDs; 200ms debounce, matching RunList)
Body (flex-1, overflow-y-auto, scroll-thin, p-3, aria-label "Recent records"):
  grouped sections, each with a section header:
    FROM COMPARE            (comparison + ad hoc task executions)
    FROM EVALUATIONS        (evaluation executions + experiment task executions)
    FROM THE LAB            (policy studies + study-linked records)
    OBSERVATIONS            (evidence references)
    LEGACY & IMPORTED       (legacy references)
  Groups with zero items do not render — no empty group headers.
  Each group shows its 5 most recent records (cap, §13) as record rows (§7.2, compact variant).
Footer (p-3, border-t border-edge):
  [View all records →]  — full-width bordered link button to /records, min-h-[44px]
  honesty-note: "Records preserve exact execution provenance. Meaningful results live in
  Compare, Evaluations, Lab, and Models."
```

- With a search query active, grouping is preserved but each group shows all matches (scroll
  handles depth); an exact-ID hit renders first under an `EXACT MATCH` section header.
- Row selection follows §3.3: semantic rows navigate to owners; exact rows to record detail. The
  drawer closes on navigation; focus moves to the destination page heading; reopening the drawer
  later restores focus normally (trigger-based, inherited from the dialog primitive).
- The drawer performs **no** execution, export, or archive actions — rows and links only.

### 6.3 Drawer states

| State | Rendering |
|---|---|
| No records at all | Body: `History` icon (muted), "No records yet.", honesty-note: "Every comparison, evaluation, and study leaves an exact record here automatically." Footer unchanged (View all still works — the full page shows its own empty state). |
| No search matches | "No records match `query`." + "Clear search" button. |
| Index loading | Single skeleton group (≤3 shimmerless placeholder rows using `.animate-pulse-ease` on opacity only); never an empty flash. |
| Index/migration error | Error-role block: `AlertCircle` + "Records index unavailable." + one-line reason + "Retry" button + link "Open full Records" (the full page shows richer diagnostics, §9.6). |

### 6.4 Keyboard behavior

Focus order: close → search → rows (each row one stop; trailing exact-link is a second stop) →
View all. `Escape` closes and restores focus to the header Records button. `↓/↑` inside the search
input move into/through rows (roving tabindex within the list), `Enter` activates. The drawer
traps focus; background is inert.

---

## 7. Full Records utility (`/records`)

### 7.1 Layout

The shipped Runs split layout is retained under refactor, not redesigned: ≥1024px, `380px` list
pane (`bg-panel`, `border-r border-edge`) + detail pane (`min-w-[600px]`, shell background);
below 1024px, route-based list/detail with a back button on detail. This layout is a
characterized production strength; Records inherits it.

Page header (list pane top): eyebrow `RECORDS`, title "Records", record count
(`font-mono text-xs text-text-muted`), and the `DataArchiveActions` entry point ("Export data" /
"Import data" — existing wording, unchanged) as quiet secondary buttons.

### 7.2 Record row (shared component, drawer + list)

Built on `RecordRow` (list variant), preserving its shipped surface
(`min-h-[44px] rounded-md border border-edge bg-panel px-3 py-2 hover:border-edge-bright`; no
hover-transforms). Anatomy:

```
[KindEyebrow: type icon + TYPE LABEL]   [StatusMark icon+word]   [timestamp, mono]
Title (text-sm, truncates; full title wraps in detail)
Meta line (font-mono text-xs text-text-muted):
  model/roster summary · mode · cost (when known)
Owner hint line (text-xs text-text-secondary):
  "in Frontend Reliability · Task Set v6"   ← owning-context hint, from the resolver
Trailing (semantic rows only): [Exact ↗] link — a separate sibling anchor, 44×44 hit area,
  aria-label "Open exact record", navigating to the exact record detail
```

- The row itself is **one real anchor** (`<a>`), never a `div` with `tabindex`; the trailing exact
  link is a sibling anchor inside the same flex row — no nested anchors, no row/button ambiguity.
- Status is always `StatusMark` (icon + word). Type is always eyebrow icon + word. Neither is ever
  a bare dot — the prototypes' 7px color dots are rejected.
- Legacy rows use the muted `LEGACY` eyebrow and their owner hint reads exactly
  "Origin unresolved — preserved as imported" when the resolver returns `unresolved`.
- Drawer compact variant: identical anatomy minus the meta line (title + eyebrow + status + owner
  hint), keeping drawer rows to 3 lines.

### 7.3 Filters

All current `RunFilters` strengths retained, plus a type filter:

| Filter | Control | Options |
|---|---|---|
| Search | text input, 200ms debounce | free text + exact-ID match |
| Type | select | All types · Comparison · Evaluation · Policy Study · Task execution · Observation · Legacy |
| Model | select | existing model-key list |
| Status | select | existing status list (Running · Completed · Partial · Failed · Aborted · Interrupted …) |
| Mode | select | All · Rank · Fuse |
| Source | select | All · Ad hoc · Experiment · Legacy |
| Date | existing date bounds |

Desktop (≥lg): always-visible 2-column grid, as today. Mobile: collapsible sheet with toggle +
applied-count badge, as today. Complete-set filtering before pagination, deterministic sort
(newest first, stable tiebreak on ID), `PAGE_SIZE = 50` with the existing "Load more" button and
preload multiplier — all preserved and covered by the migrated characterization tests.

### 7.4 Typed detail surfaces

Route `/records/:recordType/:recordId` (and `/runs/:runId` for task executions).

**Task execution** — the existing `RunDetail` composition preserved in full: source/status/mode
chips, title, timestamps + timezone, status timeline (Created → Candidates → Judge → Result),
provenance trail, outcome, cost breakdown, candidate selector + output, judge evidence, fusion
evidence, collapsed task/configuration. Its actions bar is normalized to the Records action
grammar (§7.5). Nothing else about it changes; its tests migrate wholesale.

**Comparison / Evaluation / Policy Study (semantic references)** — these details exist for the
rare case a user lands on the reference itself (e.g. from an exact link). Anatomy: identity header
(eyebrow, StatusMark, title, mono ID + timestamps), a prominent **owner card** —

```
[owner icon]  This record's home
"Comparison result in Compare"           (ownerLabel)
[Open in Compare →]                       (primary; ownerHref)
confidence chip (§7.6)
```

— followed by a typed summary (roster, mode, counts, cost) and a **Beneath this record** list of
child records (leaf task executions; trials/observations for studies) as record rows. No evidence
duplication: the owner renders the meaning; this page renders the reference and the links. The
summary explicitly states this: honesty-note "This is the reference record. Judged results,
rationale, and evidence live in the owning context."

**Observation** — identity header + eligibility panel (classification, rules passed — rendered as
icon+word list), exact source links (Run, attempt, assessment — mono link chips), owner backlink
to the Task/Model context, and the policy-evidence marker when the observation is study-linked.

**Legacy** — preserved summary fields (whatever was imported, rendered as read-only rows), import
provenance (when/how imported), the unresolved-owner block (§7.6), and raw payload behind a
disclosure ("Preserved payload", `font-mono text-xs`, contained scroll `max-h-96`). Never an
attempt to re-parse into richer semantics.

**Unknown ID** — typed not-found, never an empty shell:

```
Eyebrow: NOT FOUND
"No task-execution record with ID run-9b41… exists in this database."
Recovery options: [Search Records for similar IDs]  [Open Records]  [Import data]
honesty-note: "Records are device-local. A link copied from another device will not resolve here."
```

The recovery options are the tested "typed not-found/recovery options" of behavioral §6.

### 7.5 Actions grammar (every Records detail)

A single actions row, fixed order, rendered identically on every typed detail:

1. **Open owning context** — primary bordered button, label resolves from `ownerLabel` ("Open in
   Compare", "Open evaluation", "Open study", "Open Task Set"). Absent (not disabled) when
   `ownerHref` is null; the unresolved block (§7.6) explains why.
2. **Open in Compare** (task executions and comparisons only) — retains existing wording, with the
   honesty token beneath: "Loads configuration only — no outputs, no execution, no lineage."
3. **Copy link — this device** — existing `CopyLinkButton` verbatim: label
   `Copy link — this device`, copied state `Copied!`, SR announcement
   "Link copied to this run on this device" (generalized to "…to this record…" for non-run types).
4. **Export** — existing safe archive actions via `DataArchiveActions`, unchanged wording.

Forbidden actions (retry, re-judge, re-fuse, repair, resume, add model, delete, retention) do not
render in any state — not disabled, not hidden-behind-flags; they are structurally absent from
Records components, and the acceptance sweep (§14) asserts their absence.

### 7.6 Owner backlink and confidence

The resolver's confidence renders as a fixed chip vocabulary (icon + word, never color-only):

| Confidence | Chip | Treatment |
|---|---|---|
| `exact` | `Link` icon + "Exact owner" | `text-text-secondary border-edge` — quiet; exactness is normal |
| `crosswalk` | `Route` icon + "Mapped owner" | `text-text-secondary`; a `title`/`aria-label` carries the resolver's `reason` ("Mapped via Suite → Task Set crosswalk") |
| `unresolved` | `AlertTriangle` + "Origin unresolved" | warning role; block form adds the reason line and: honesty-note "This record's historical owner is unknown. RSemble never guesses an owner — exact evidence below remains fully inspectable." |

The resolver never substitutes a latest version for an unknown historical owner; the UI mirrors
that by never rendering a guessed link.

---

## 8. Responsive behavior

### 8.1 Breakpoint matrix

| Width | Shell | Records |
|---|---|---|
| **1440** | Full header: nav labels + icons, palette trigger with ⌘K kbd, Records icon+label, connections dot+word, help | Drawer 400px; `/records` split 380px + detail |
| **1024** | Nav labels without icons (existing `lg` behavior); Records icon+label; connections dot+word at lg exactly | Drawer available at ≥1024 only; split view at ≥1024 only |
| **768** | Desktop nav hidden; bottom nav (4 items) appears; header keeps logo + palette icon + Records icon + connections dot (with aria status word) | Records button navigates to `/records`; list/detail are separate routes |
| **390** | Bottom nav 4-across (~97px columns); header `px-2`; utilities all icon-only 44×44 | Full-width list; filters in collapsible sheet; detail full-screen with back button |

### 8.2 Drawer substitution rule

Below 1024px the drawer does not exist. The Records header button becomes a plain link to
`/records` (same element, different behavior — implementation may render `<a>` vs `<button>`
conditionally, but the accessible name "Records" and hit area are constant). Rationale: at tablet
widths a 400px trap over a ~760px canvas crowds without saving a navigation, and the full page is
strictly more capable. This implements behavioral §10's "route/full-screen panel if drawer would
crowd" with a hard, testable cutoff.

### 8.3 200% zoom

At 200% zoom (effective ≈720/512/384/195px):

- The header collapses along its existing breakpoint ladder; the **connections pill and the
  palette/Records utilities never disappear** — they reduce to 44×44 icon buttons. The brand text
  and nav labels may hide; primary navigation transfers to the bottom nav exactly as at native
  narrow widths.
- The execution strip truncates its caption (`truncate` already shipped) but keeps StatusMark and
  "View progress" visible at all effective widths — current execution awareness is never hidden.
- No document-level horizontal overflow anywhere in shell or Records; long IDs/titles/model names
  wrap or middle-ellipsize inside their cards (`min-w-0` on all flex children; `break-all` on mono
  IDs in detail surfaces); per-row rects stay inside cards.

---

## 9. States (shell and Records)

| State | Surface and rendering |
|---|---|
| **Empty (no records)** | `/records` list pane: `History` icon, "No records yet.", explanation ("Run a comparison or an evaluation — its exact record appears here automatically."), links to Compare and Evaluations. Detail pane (≥1024) shows the same message centered; never a blank pane. |
| **No filter matches** | "No records match the current filters." + "Clear filters" button (existing grammar). |
| **Loading** | List: existing skeleton/placeholder behavior from RunList; detail: heading renders immediately from route params (type + ID), body sections stream in; no full-page spinner. |
| **Error (query failure)** | `AlertCircle` + "Failed to load records." + message + Retry (existing grammar). |
| **Interrupted record** | Not a Records state — an interrupted execution renders its StatusMark `interrupted` (icon+word) in rows and detail timeline; the only affordance is **Open owning context**, where resume lives. Records never offers resume. |
| **Migration/index error** | `/records` renders a blocking panel in the list pane: error role, "The records index could not be built.", exact diagnostics list (entity type / ID / reason code, `font-mono text-xs`, contained scroll, no payload echo), counts, actions: Retry rebuild · Copy diagnostics. Underlying source data is explicitly stated untouched: "Your runs and results are unaffected — this index is derived and rebuildable." Rebuild is idempotent, so Retry is always safe to offer. |
| **Unknown ID** | Typed not-found with recovery options (§7.4). |
| **Legacy** | Typed legacy detail (§7.4) with unresolved-owner honesty (§7.6). |

---

## 10. Honesty-token grammar

One fixed microcopy system, class `.honesty-note` (§4.3), used verbatim across surfaces:

| Token | Canonical wording | Attaches to |
|---|---|---|
| Device-local link | "Copy link — this device" (button) / "Records are device-local…" (not-found) | copy-link button; unknown-ID recovery |
| Configuration-only handoff | "Loads configuration only — no outputs, no execution, no lineage." | Open in Compare, everywhere it appears |
| Reference vs meaning | "This is the reference record. Judged results, rationale, and evidence live in the owning context." | semantic record details |
| Unresolved origin | "This record's historical owner is unknown. RSemble never guesses an owner — exact evidence below remains fully inspectable." | legacy/unresolved details |
| Ledger scope | "Records preserve exact execution provenance. Meaningful results live in Compare, Evaluations, Lab, and Models." | drawer footer; `/records` empty state |
| Policy evidence | (child 06's marker, reused verbatim) | study-linked observations/records |
| Eligibility notice | (child 04/06 wording, reused verbatim) | observation details |

Rules: a token renders **adjacent to its affordance** (within the same visual block, below or
beside it); tokens are never stacked more than **two per visual block** and never total more than
**four per route surface** (drawer counts as one surface). Tokens are plain text — never toasts,
never dialogs, never dismissible. Wording is centralized in one module
(`src/ui/honesty-copy.ts`) so tests can assert exact strings and surfaces can't fork the copy.

---

## 11. Navigation-switch migration UX

### 11.1 The pointer (one-time)

On the first app open after the nav switch ships, if (and only if) the local database contains at
least one run record, the header Records button renders a one-time anchored popover
(non-modal, `role="status"`, not focus-trapping):

```
"Runs moved."
"Exact execution records now live here — same history, same links, new address."
[Got it]                                   (min-h-[44px]; dismisses forever)
```

Dismissal persists in localStorage (`records-move-pointer-dismissed`). The popover also dismisses
on any navigation or on opening the drawer. It never re-renders afterward, never appears for fresh
databases (nothing moved for them), and is fully keyboard reachable (it takes focus order after
the Records button without trapping). Reduced motion: appears without transition.

### 11.2 Legacy routes

- `/runs` → client redirect to `/records`, translating supported query filters 1:1 (text, model,
  status, mode, source). Unknown params drop silently.
- `/runs/:runId` → renders the exact task-execution detail **at the old URL**, unchanged — copied
  links must remain byte-identical and functional forever (Decision D3). The page is the same
  component as `/records/task-execution/:runId`; the canonical route is the new one; copy-link on
  a page loaded at `/runs/:runId` copies the canonical `/records/...` form (forward-compatible)
  while tests keep `/runs/:runId` resolving.
- Old Fusion Study deep links are governed by the Lab child's retirement panel (no redirect);
  Records renders Policy Study references with `/lab/studies/:id` owners.
- Direct load, refresh, hash-router, back/forward, and focus restoration are tested on all of
  `/runs`, `/runs/:runId`, `/records`, and `/records/:type/:id`. On route change into a detail,
  focus moves to the detail heading (`tabindex="-1"`); back restores list scroll position.

### 11.3 In-app copy sweep

All ordinary-history links and labels that said "Runs" are re-worded to their new owner ("Previous
comparisons" in Compare, execution history in Task Sets) or to "Records" where the exact ledger is
truly meant. The word "Runs" survives only in preserved URLs and in domain terms like
`RunRecordV2`. Palette keywords keep `runs` as a synonym (§5.4) so the muscle memory lands.

---

## 12. Accessibility

- **Keyboard flows.** Header: logo → nav links (or mobile menu) → palette → Records → connections
  → help; visual order equals DOM order at every width. Bottom nav is last in the page tab order.
  Drawer: §6.4. Records list: filters → rows (row anchor, then trailing exact link) → load more.
  Detail: heading → actions row → sections in reading order; disclosures are `aria-expanded`
  buttons.
- **Focus management.** Drawer and all dialogs trap focus, make the background inert, close on
  Escape, and restore focus to their trigger (inherited from the Base UI dialog primitive — no
  bespoke traps). Route-change focus lands on the destination heading.
- **ARIA.** Nav: `aria-label="Primary"`, `aria-current="page"`. Records button:
  `aria-haspopup="dialog"` + `aria-expanded` (≥1024). Drawer: `role="dialog"`,
  `aria-label="Records"`. Groups: `role="group"` with labelled headers. Rows: real anchors with
  accessible names composed of type + title + status. Status words are text, icons `aria-hidden`.
  Connections pill always exposes the status word in its accessible name.
- **Live regions.** Unchanged budget: the execution strip's polite caption + assertive alert
  remain the app's only global live regions; the drawer adds none (search results update is
  announced via a single `role="status"` result count, reusing the existing pagination-info
  pattern, capped at one per surface).
- **Reduced motion.** Drawer slide collapses to instant (§4.3); all other shell motion already
  routes through `.pressable`/`.motion-state`/existing classes neutralized by the shipped
  `prefers-reduced-motion` block. No new animated classes beyond `.drawer-panel`.
- **Contrast.** All roles inherit the compliant palette; `.honesty-note` uses `#a1a1a1`
  (≥4.5:1 on `#121212`/`#181818`), never `#777777`.

---

## 13. Densification caps (assertable)

1. Primary nav: exactly 4 items, desktop and mobile; identical order.
2. Header utility cluster: ≤4 interactive elements this child (palette, Records, connections,
   help); ≤5 ever (Attention insertion); zero non-functional elements at all times.
3. Global live regions: exactly the strip's two; ≤1 additional `role="status"` per Records
   surface.
4. Drawer: ≤5 rows per group pre-search; ≤5 groups; drawer rows ≤3 text lines.
5. Record row: exactly 1 title line, ≤1 meta line, ≤1 owner-hint line; ≤2 anchors per row (row +
   trailing exact link); ≤3 identity elements (eyebrow, StatusMark, timestamp).
6. Records list: pagination at 50; filters ≤7 controls.
7. Honesty tokens: ≤2 per visual block, ≤4 per route surface; all strings from
   `honesty-copy.ts`.
8. Actions row on any Records detail: ≤4 actions, fixed order (§7.5); zero execution verbs.
9. One-time pointer: renders at most once per database lifetime; ≤2 sentences + 1 button.
10. Typed detail: owner card renders exactly one primary link; confidence chip exactly one.

---

## 14. Acceptance criteria

Tokens and motion:

1. No new colors, radii, shadows, fonts, or easing values; `design-token-contract.test.ts` passes
   unchanged; grep of new shell/Records files finds no raw hex outside values already in
   `src/index.css`/`tailwind.config.js`.
2. `.drawer-panel` and `.honesty-note` exist in `src/index.css` with §4.3 values; `.drawer-panel`
   is listed in the `prefers-reduced-motion` zero-duration group.
3. Motion contract scan passes: no `transition-all`, bare `ease-in`, `scale(0)`, palette
   animation, or record-row hover-transforms in any new file.

Navigation composition:

4. Desktop and mobile primary nav each contain exactly `Compare, Evaluations, Lab, Models` in
   order, as `NavLink`s with `aria-current="page"` on the active item plus the 2px accent bar
   (computable via computed style); no "Runs" label or link exists in any current UI surface
   (assert by full-DOM text sweep on each primary route).
5. All four primary destinations render functional content on direct load (no inert destination:
   each route renders its workspace's list/home with real data or its designed empty state —
   assert absence of placeholder strings and of routes rendering `null`).
6. Records appears exactly once in the header utility cluster and nowhere in primary nav or bottom
   nav; every header utility measures ≥44×44 at every width.
7. The connections readiness state is exposed as text in the pill's accessible name at all widths
   (never dot-only).

Drawer:

8. At ≥1024px the Records button opens the drawer: focus is trapped (Tab cycles inside),
   background is inert, Escape closes, and focus returns to the Records button (assert
   `document.activeElement`).
9. Drawer groups render only when non-empty; rows are real `<a>` elements; semantic rows navigate
   to owner routes and exact rows to record detail; "View all records" navigates to `/records`.
10. At <1024px the Records button navigates to `/records` and no drawer mounts.

Records utility:

11. `/records` preserves characterized Runs behavior: complete-set filtering before pagination,
    deterministic order, page size 50, load-more preload, 200ms debounce — the migrated Runs
    tests pass against the Records components (no test deleted to make the rename pass).
12. `/records/:recordType/:recordId` renders the six typed details of §7.4; an evaluation
    reference is never rendered through the RunRecordV2 detail component (type-level assertion).
13. Every detail's actions row contains only the §7.5 actions; a sweep of Records components finds
    zero occurrences of retry/resume/re-judge/re-fuse/repair/add-model verbs as interactive
    elements.
14. Copy-link renders `Copy link — this device` verbatim; Open in Compare renders its
    configuration-only honesty token verbatim; all honesty strings resolve from
    `honesty-copy.ts` (no duplicated literals elsewhere — grep assertion).
15. Owner backlinks render `exact`/`crosswalk`/`unresolved` chips as icon+word; unresolved never
    renders an owner link; crosswalk chips expose the resolver reason in their accessible name.

Legacy routes and migration:

16. `/runs?status=failed` lands on `/records?status=failed`; `/runs/:runId` renders the exact
    detail with the URL bar unchanged; both survive direct load, refresh, and back/forward.
17. Unknown IDs at `/records/:type/:id` and `/runs/:id` render the typed not-found with all three
    recovery options; no empty shell.
18. The migration pointer renders at most once (localStorage-gated), only when prior run records
    exist, is keyboard-dismissible, and never traps focus.
19. Index rebuild failure renders the §9 diagnostics panel with Retry; repeated rebuild after
    success produces no duplicate rows (idempotence, asserted at repository level and by row
    count in UI).

Responsive and zoom:

20. At 1440/1024/768/390 and 200% zoom: no document-level horizontal overflow on any shell or
    Records route; header utilities and execution-strip essentials remain visible; bottom nav
    labels do not truncate at 390.
21. All interactive targets ≥44×44 CSS px, siblings ≥8px apart, including drawer rows' trailing
    exact links.

Caps:

22. All ten densification caps in §13 hold (each countable in the DOM).

---

## 15. Explorations — considered and rejected

### 15.1 Records as a fifth primary destination
Rejected. The behavioral contract makes Records semantically secondary, and the four-meaning
topology is the product's core statement. A fifth primary would re-teach the old Runs habit the
redesign exists to retire. The drawer + utility button keeps the ledger one interaction away
without promoting it.

### 15.2 Hamburger consolidation of utilities on desktop
Rejected. Folding palette/Records/connections into an overflow menu at desktop widths hides
readiness state (a safety signal) and adds a step to the two most-used utilities. Overflow
behavior is reserved for genuinely constrained widths, where the ladder in §8 already collapses
labels before hiding anything.

### 15.3 "One honesty channel per surface"
Rejected as a principle (kept only as a density cap). Centralizing all claim-limiting copy into
one banner divorces the caveat from the control it qualifies — the configuration-only warning is
useless anywhere except under "Open in Compare". Adjacency with hard caps (§10, §13.7) preserves
both honesty and calm. The prior hypothesis optimized for visual quiet at the cost of the honesty
actually functioning.

### 15.4 Bottom-sheet Records on mobile
Considered: a swipe-up sheet mirroring the desktop drawer. Rejected: it duplicates the full
`/records` page at small widths, competes with the bottom nav for the same edge, and adds a
gesture surface the app otherwise never uses. A plain route is more capable and cheaper.

### 15.5 Command-palette-only Records access
Considered seriously (maximal chrome quiet: no header button; palette command + routes only).
Rejected because the ledger must be findable by users who never learn ⌘K, and because the
one-time migration pointer needs a stable visible anchor. On record as the most chrome-minimal
alternative.

### 15.6 Unified "everything" list without type grouping in the drawer
Rejected. A flat recency list interleaves six types and forces per-row type parsing; grouping by
source (Compare / Evaluations / Lab / Observations / Legacy) matches the owner topology users
already navigate and makes the "meaning up, ledger down" relationship visible in the drawer
itself.

### 15.7 Animated nav-active indicator (sliding underline between items)
Rejected. A shared-element slide between nav items is decorative motion on the most-used chrome;
the motion contract's spirit (motion conveys state continuity, not ornament) and the
reduced-motion budget argue for a static per-item bar. State change is communicated by color +
bar + `aria-current`, transitioned only via the existing `.motion-state` color transition.

---

## 16. Decision points and recommended defaults

| # | Decision | Options | Recommended default |
|---|---|---|---|
| D1 | Records button placement | Utility cluster vs inside palette only vs header-left | **Utility cluster, second position** — stable anchor for the migration pointer; palette-only rejected in §15.5. |
| D2 | Drawer width | 360 / 400 / 480px | **400px** — fits 3-line compact rows with owner hints; 480 crowds 1024px canvases (would cover >45%). |
| D3 | `/runs/:runId` fate | Redirect to canonical vs render at old URL | **Render at old URL** — copied links stay byte-identical; canonical route used for all new copy-link output. |
| D4 | Canonical exact-record route | `/records/task-execution/:runId` vs keep `/runs/:runId` canonical | **`/records/task-execution/:runId` canonical** — one route grammar for all six types; legacy alias preserved forever. |
| D5 | Migration pointer mechanism | Anchored popover vs first-visit banner vs none | **Anchored popover on the Records button** — spatially teaches the new location; banners nag whole surfaces; "none" abandons existing users' muscle memory. |
| D6 | Drawer recency scope | 5 per group vs global 15 mixed | **5 per group** — preserves grouping value (§15.6) and caps drawer height predictably. |
| D7 | Type filter UI | Select vs segmented chips | **Select** — seven filters already ship as selects; chips would exceed the filter-row budget at 390px. |
| D8 | Exact-link affordance on semantic rows | Trailing link vs long-press/context menu vs detail-only | **Trailing 44×44 "Exact ↗" link** — context menus hide capability; detail-only adds a hop to the ledger's core promise. |
| D9 | Nav icon set | Keep icons ≥lg only (current) vs always show icons | **Keep current ≥lg behavior** — unchanged characterized behavior; icons at 768–1024 crowd the four-item center column. |

---

## 17. Component inventory (build list)

New: `DrawerSurface` (right-anchored Base UI dialog variant), `RecordsDrawer`,
`RecordTypeEyebrow` (extends `KindEyebrow` with the six record kinds), `OwnerCard` +
`ConfidenceChip` (§7.6), `HonestyNote` + `src/ui/honesty-copy.ts` (§10), `RecordsMovePointer`
(§11.1), typed detail shells for comparison/evaluation/policy-study/observation/legacy references,
`RecordsIndexErrorPanel`, typed `RecordNotFound`.
Refactored (behavior-preserving, characterization-tested first): `RunsWorkspace` →
`RecordsWorkspace`, `RunList`/`RunFilters`/`RunDetail` → typed Records list/filters/task-execution
detail; `WorkspaceNav`/`MobileWorkspaceNav` (four items); `Header` (utility cluster);
`CommandPalette` (§5.4).
Reused unchanged: `RecordRow`, `StatusMark`, `CopyLinkButton`, `DataArchiveActions`,
`GlobalExecutionStrip`, `Pagination`, `DialogSurface`, `ConnectionsModal`.
