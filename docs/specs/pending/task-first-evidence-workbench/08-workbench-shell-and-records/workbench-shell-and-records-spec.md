# Workbench Shell and Records — Canonical Child 08 Specification

**Status:** Pending · single normative Child 08 authority
**Parent:** [`../task-first-evidence-workbench-spec.md`](../task-first-evidence-workbench-spec.md)
**Dependencies:** 03 Task Sets and Evaluations; 05 Contextual Compare Results; 06 Research Lab /
Policy Studies; 07 Model Evidence Profiles
**Canonical visual reference:** `docs/explorations/future-task-first-ui/child08-canonical-states.html`
(illustrates this spec; never overrides it — where the HTML and this document conflict, **this
document wins**). The older phase-A/B/C exploration HTML files in the same directory are
provenance only and are **non-authoritative**.

## A. Authority and status

This file is the **single normative Child 08 authority** for: product semantics, information
architecture, the Records domain, routes, ownership, interactions, visual execution, responsive
behavior, accessibility, and acceptance criteria.

The following former authorities have been reconciled into this document and retired from the
active spec directory:

- the former `ui-design-spec.md` (visual authority, 2026-08-17);
- the Child 08 design-authority package (2026-08-21 audit/consolidation);
- earlier Child 08 exploration HTML (provenance only).

`implementation-plan.md` carries execution sequencing, RED → GREEN tasks, checkpoints, STOP
conditions, and validation gates only. It contains no product or design authority.

**Superseded stale authority, resolved once here:**

| Stale source | Binding resolution |
|---|---|
| Older Child 08 text with primary navigation "Compare · Evaluations · Models" and a "three-item" bottom nav | Primary navigation is **Compare · Evaluations · Lab · Models**, desktop and mobile (parent P03). |
| Older Child 08 text with Fusion Study owner routes under `/evaluations/sets/:taskSetId/fusion/:studyId` | Retired. The Record type is the **Policy Study reference**, owner `/lab/studies/:studyId`. The shipped retirement panel (`RetiredFusionRoute`) stays as-is. |
| Older Child 08 text assigning Attention to "child 08" or archive hardening to "child 09" | Parent §15 is authority: Attention is Child 09, hardening is Child 10. |
| Older filter tables listing "existing date bounds" | No date filter exists in the shipped UI. Type is the only new filter (§I). |

## B. User outcome

The application presents one simple primary product:

```text
Compare · Evaluations · Lab · Models
```

Users revisit meaningful comparison results inside Compare, ordinary evaluation executions inside
their Task Set, policy research inside the Lab, and cumulative evidence inside Models. Exact
execution and study records remain easy to search and inspect through a secondary **Records**
utility, including every existing `/runs/:runId` deep link.

This is not a cosmetic Runs → Records rename. It changes ownership while preserving the
operational ledger: the four primary destinations organize work by **meaning** (a comparison, a
workload, a study, a model); Records organizes the same events by **exactness** (what ran, when,
at what cost, with what evidence). The two orderings coexist; neither is hidden. Records is
deliberately styled one register quieter than the primaries — utility, not destination — and is
never more than one interaction from anywhere.

### B.1 Entry gate

This child must not begin until:

- Compare has functional previous-result routes and recovery;
- Task Sets own functional ordinary evaluation history/results/recovery;
- Lab owns functional Policy Studies;
- Models has functional qualified evidence profiles;
- every old run/result can resolve its owning context or an explicit legacy state.

No inert primary destination may ship. At the design baseline (2026-08-21) all four destinations
exist as functional workspaces at their routes; this gate is verified again at implementation
Task 0.

## C. Final information architecture

### C.1 Layering

| Layer | Content | Surface |
|---|---|---|
| **Default** (always visible) | Primary nav (Compare · Evaluations · Lab · Models); connection readiness; current execution awareness (strip, when active) | Header + GlobalExecutionStrip + mobile bottom nav |
| **Secondary** (one interaction away) | Records drawer / `/records`; command palette; keyboard cheatsheet; connections detail | Header utility cluster |
| **On demand** (behind navigation or disclosure) | Full Records filtering and typed detail; exact evidence sections; archive export/import; legacy deep links | `/records` routes, detail disclosures |

### C.2 Secondary utilities

Header/global utilities contain exactly:

```text
Command palette trigger
Records
Connections / provider readiness
Help (keyboard cheatsheet)
```

in that fixed order — most-used to least, with Connections kept adjacent to Help so the readiness
pill never moves when Child 09 later inserts Attention between Records and Connections. **Nothing
renders in the future Attention slot now**: no spacer, no hidden element, no reserved icon, no
disabled button.

### C.3 Rank/Fuse control

Rank/Fuse remains Compare-specific. It never appears as a global workspace switch or in
Records/Evaluations/Lab/Models.

### C.4 Global execution awareness

The global execution strip remains cross-workspace awareness only, unchanged (`h-9`, dot +
StatusMark + mono caption + elapsed + "View progress"). Clicking it navigates to the owning
Compare/Evaluation execution. It does not make Records or Models an execution owner.

## D. Route map

Canonical routes added by this child:

```text
/records                              full utility — typed list (+ split detail ≥1024)
/records/:recordType/:recordId        typed detail (canonical exact-record routes)
  recordType ∈ comparison | evaluation | policy-study | task-execution | observation | legacy
```

Compatibility behavior:

- `/runs` → client redirect to `/records`, translating supported query filters 1:1 (text, model,
  status, mode, source). Unknown params drop silently.
- `/runs/:runId` continues rendering the exact task-execution detail **at the old URL** — no
  redirect; copied links stay byte-identical and functional forever. The page is the same
  component as `/records/task-execution/:runId`; the canonical route is the new one; copy-link on
  a page loaded at `/runs/:runId` emits the canonical `/records/...` form (forward-compatible)
  while tests keep `/runs/:runId` resolving.
- Unknown IDs at `/records/:type/:id` and `/runs/:id` render the typed not-found with recovery
  options (§K.7), never an empty shell.
- Hash-router behavior, direct load, refresh, back/forward, and focus restoration are tested on
  all of `/runs`, `/runs/:runId`, `/records`, and `/records/:type/:id`.

Owner routes (owned by other children, linked from Records): `/compare/results/:id`,
`/evaluations/results/:id`, `/evaluations/sets/:taskSetId`, `/lab/studies/:studyId`,
`/models/:modelConfigurationId`, plus Task routes. Retired Fusion Study owner routes are not
reintroduced.

## E. Typed Record domain

Records is a typed union/read model:

```ts
type RecordReference =
  | ComparisonRecordReference
  | EvaluationExecutionReference
  | PolicyStudyReference
  | TaskExecutionRecordReference
  | ObservationRecordReference
  | LegacyRecordReference;
```

The union allows one retrieval surface while preserving type-specific identity and routes. An
Evaluation Result is not coerced into `RunRecordV2`, an Observation is not a copied run, and no
universal result entity is introduced.

### E.1 Record type responsibilities

- **Comparison:** semantic result reference, owner `/compare/results/:id`, exact leaf task
  execution(s) beneath.
- **Evaluation execution:** aggregate execution reference, owner `/evaluations/results/:id`, task
  executions beneath it.
- **Policy Study:** exact study reference, owner `/lab/studies/:studyId`,
  trials/attempts/study observations/playbook beneath it. Records carries Lab asset versions only
  insofar as studies reference them; recipes/pools are not Record types.
- **Task execution:** exact `RunRecordV2`/provenance envelope.
- **Observation:** derived evidence reference with exact source links.
- **Legacy:** preserved summary/import that cannot safely resolve richer semantics.

Types are visible identities: every Records surface says which type it is showing — eyebrow, icon,
and route — and never coerces one type into another's clothing.

### E.2 Semantic vs. exact responsibility

Semantic types (comparison, evaluation, policy study) open their **owner** by default; exact
types (task execution, observation, legacy) open their **record detail** by default. This split is
the single behavioral rule of every record row everywhere (drawer, list, palette).

The default `/records` stream **interleaves** semantic references and exact task-execution records
(newest-first, deterministic). The same underlying event may therefore appear once as a semantic
reference and once as an exact leaf. This duplication is semantically intended — reference vs.
evidence — and must be visually understandable through: the explicit type eyebrow, the owner-hint
line, the semantic row's owner-open behavior, the exact-record affordance, and deterministic
sorting. Exact leaves are never hidden by default, and no grouped/pseudo-tree behavior is
introduced. The browser acceptance gate (§R) verifies users read the pair as reference/evidence,
not as accidental duplicates.

## F. Ownership resolution

A pure resolver maps a Record reference to:

```ts
interface OwningContextResolution {
  ownerKind: "compare" | "evaluation" | "task" | "model" | "lab" | "legacy";
  ownerHref: string | null;
  ownerLabel: string;
  confidence: "exact" | "crosswalk" | "unresolved";
  reason: string | null;
}
```

The resolver never chooses a latest Task Set/Task version when the historical owner is unknown;
unresolved origins remain labeled, and the UI never renders a guessed link.

The resolver's confidence renders as a fixed chip vocabulary (icon + word, never color-only):

| Confidence | Chip | Treatment |
|---|---|---|
| `exact` | `Link` icon + "Exact owner" | `text-text-secondary border-edge` — quiet; exactness is normal |
| `crosswalk` | `Route` icon + "Mapped owner" | `text-text-secondary`; the accessible name carries the resolver's `reason` (e.g. "Mapped via Suite → Task Set crosswalk") |
| `unresolved` | `AlertTriangle` + "Origin unresolved" | warning role; block form adds the reason line and the honesty token: "This record's historical owner is unknown. RSemble never guesses an owner — exact evidence below remains fully inspectable." |

Warning color is reserved for actual unresolved/error meaning, never for exactness itself: an
exact record is not a hazard.

## G. Shell visual contract

### G.1 Tokens (existing, used as-is)

The full palette, radii, shadows, fonts, and motion variables from `tailwind.config.js` and
`src/index.css` apply unchanged: canvas/shell `#0a0a0a`, panel/card `#121212`, card-hover
`#1a1a1a`, raised `#181818`, edge `#262626`, edge-bright `#3a3a3a`, accent `#00e5ff`, success
`#00ff9d`, warning `#ffb300`, error `#ff4d4d`, text `#ededed`/`#a1a1a1`/`#777777`; radii
`4/6/8px`; `shadow-popover`; Geist / Geist Mono; `--motion-fast` 100ms, `--motion-short` 150ms,
`--motion-medium` 200ms; `--ease-out-ui cubic-bezier(0.23,1,0.32,1)`.

Semantic roles this child commits to: **exact/unresolved-honesty text ⇒ muted/secondary text
roles, never warning**; **unresolved owner ⇒ warning role** (icon+word); **migration/index errors
⇒ error role**; **active nav/current execution ⇒ accent**.

### G.2 Type and spacing law (existing conventions, restated)

- Header height `h-14`; execution strip `h-9`; both retained exactly.
- Eyebrows `font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted`; section headers
  `font-mono text-xs font-semibold uppercase tracking-wider text-text-muted`; body `text-sm`;
  metadata `text-xs`; identifiers/costs/timestamps `font-mono tabular-nums`.
- Interactive minimum `min-h-[44px] min-w-[44px]` — including every header utility; interactive
  siblings ≥ `gap-2`.
- Row/card padding `px-3 py-2`; drawer body `p-3`; dialog body `p-6`.

### G.3 CSS additions (the only two)

```css
/* Records drawer: slides from the right edge. Transform/opacity only. */
.drawer-panel {
  transition:
    transform var(--motion-medium) var(--ease-out-ui),
    opacity var(--motion-short) var(--ease-out-ui);
}
.drawer-panel[data-entering] { transform: translateX(16px); opacity: 0; }

/* Honesty marker: semantic hook only. Size/color are utilities owned by the
   HonestyNote component, NOT this class (see note below). */
.honesty-note { line-height: 1.4; }
```

`.drawer-panel` is appended to the existing `prefers-reduced-motion` block's
`transition-duration: 0ms` group (the drawer then appears/disappears instantly; the 16px offset
never renders because the transition is zero-length).

**`.honesty-note` carries `line-height` only.** The class is already shipped across the Models
workspace (Child 07) as a semantic marker paired with utility classes (`text-xs text-text-muted`,
one `text-[10px]`, one `text-warning`) and has **no other CSS definition at baseline**. Defining
font-size/color on it would silently restyle those accepted Child 07 surfaces. Records' fixed
token rendering is `honesty-note text-[11px] text-text-secondary`, owned by the `HonestyNote`
component. Verification duty: before writing the CSS, re-grep `honesty-note` usages and confirm
the class remains size/color-neutral.

No new colors, keyframes, radii, shadows, or easing curves. The motion contract
(`src/ui/motion-contract.test.ts`) applies unchanged: no `transition-all`, no bare `ease-in`, no
`scale(0)`, no hover-transforms on record rows, no animation on the command palette. No decorative
sliding navigation indicator, shimmer animation, hover-lift rows, or gradients.

### G.4 Header composition (final)

The shipped `Header.tsx` grid (`h-14`,
`grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`, `border-b border-edge bg-shell`, `px-2 sm:px-4`)
is retained. Final contents:

```text
LEFT    [mobile menu button (md:hidden, Compare route only)] [HexCubeLogo 22px accent] [RSemble AI (hidden <sm)]
CENTER  [WorkspaceNav — hidden <md]
RIGHT   [⌘K palette trigger] [Records] [Connections pill] [Help ?]
```

- **Records utility button**: `min-h-[44px]` bordered button matching the palette trigger's
  grammar — lucide `History` icon (deliberate continuity with the old Runs identity) + label
  "Records" at `lg:`, icon-only 44×44 at other widths, `aria-label="Records"` always. At ≥1024px
  it opens the drawer (`aria-haspopup="dialog"`, `aria-expanded`); below 1024px it navigates to
  `/records` directly (§H.6). It renders at **all widths** — below `md` it is the only chrome
  route to the ledger. It is visually identical in weight to the palette trigger: secondary
  chrome, never accent-filled.
- **Connections pill**: unchanged (rounded-full, dot + text ≥`lg`, `aria-live="polite"`); its
  accessible name always carries the status word (already shipped). No change is required.
- **Palette and Help**: current visibility ladder unchanged — kbd trigger ≥`lg`, palette icon
  `md`–`lg`, help icon ≥`md`; both hidden below `md` (characterized behavior).

### G.5 Desktop primary nav (`WorkspaceNav.tsx`)

Items, in order, exactly:

| Route | Label | Icon (≥lg) |
|---|---|---|
| `/compare` | Compare | `GitCompare` |
| `/evaluations` | Evaluations | `FlaskConical` |
| `/lab` | Lab | `TestTubes` |
| `/models` | Models | `Cpu` |

Existing link classes retained (`min-h-[44px] px-3 text-sm font-medium rounded-md`, active
`text-accent`, `aria-current="page"`, icons `hidden lg:block` size 15), with one addition: the
active item also renders a **static 2px bottom accent bar**
(`shadow-[inset_0_-2px_0_0_#00e5ff]`) so the current destination has a non-hue-only signal
alongside `aria-current`. No sliding/animated indicator. **Runs is removed from this nav.** No
Records entry appears here — Records lives only in the utility cluster.

`/tasks` remains a secondary workspace reachable via palette, unchanged.

**Icon identity mapping (binding):** Compare → `GitCompare`, Evaluations → `FlaskConical`,
Lab / Policy Study → `TestTubes`, Models → `Cpu`. Where Child 08 touches the shared identity
grammar, the mapping is standardized on these glyphs: chrome nav (desktop + mobile), command
palette (`Beaker` → `TestTubes` for Lab), and the Records type eyebrows. The shared `KindEyebrow`
token's `study` kind moves from `FlaskConical` to `TestTubes` so a Policy Study never wears
Evaluation's clothing where the six record types interleave; the token's other kinds are
untouched, and no unrelated Lab visuals are redesigned. Rationale for `Cpu` over `Boxes`: `Boxes`
is the shipped Model Pool identity; `Cpu` is the shipped Models header eyebrow and the
`model-configuration` respondent identity.

### G.6 Mobile bottom nav (`MobileWorkspaceNav.tsx`)

Exactly the same four items, same order, same icons, `flex-1` columns, icon 18px above `text-xs`
label, `min-h-[44px]` plus safe-area padding — all shipped behavior retained. Four items at 390px
yields ≈97px columns; labels fit without truncation ("Evaluations" is the longest at ~11
characters in `text-xs`; verified against the current 3-across layout which already renders it).
**Records is not a bottom-nav item at any width**; on mobile it is reached via the header Records
button (which navigates) and via deep links. The active item keeps `text-accent` plus a static 2px
**top** accent bar (mirror of desktop's bottom bar, since the nav sits at the screen bottom).

### G.7 Command palette changes

- Navigate group becomes: "Go to Compare", "Go to Evaluations", "Go to Lab", "Go to Models",
  "Go to Records", "Go to Tasks" — in that order.
- "Go to Records" carries the `History` icon and search keywords `runs`, `history`, `ledger`,
  `audit` so typing "runs" still lands correctly. There is no "Go to Runs" item.
- A new palette command "Find record by ID…" focuses the Records search: it opens the drawer with
  the search input focused (≥1024) or navigates to `/records` with the filter input focused
  (<1024). This satisfies "the drawer is not the only way to reach an exact deep link" before
  Child 09's global search.
- No other palette changes; the palette remains unanimated per the motion contract.

### G.8 Shell z-order (normative)

`z-30` mobile bottom nav → header in flow (raise to `z-40` only if a stacking conflict is
observed) → `z-50` dialogs, palette, and drawer backdrop/panel. The drawer never renders beneath
the execution strip; the strip's state is untouched by drawer open/close (awareness is not
blocked, and Escape/close restores it unchanged).

### G.9 Utility emphasis

All header utilities share one grammar: bordered `bg-panel border-edge` button,
`hover:border-edge-bright`, 44px minimum, never accent-filled. The connections pill is the sole
rounded-full element and the sole `aria-live` chrome element.

## H. Records drawer (≥1024px)

### H.1 Surface

A right-anchored panel built on the same Base UI dialog primitive as `DialogSurface` (focus trap,
inert background, Escape, focus restore are inherited, not reimplemented), rendered as a new
`DrawerSurface` variant:

- Backdrop: `fixed inset-0 z-50 bg-black/70`.
- Panel: `fixed inset-y-0 right-0 z-50 w-[400px] max-w-[calc(100vw-3rem)] border-l
  border-edge-bright bg-raised shadow-popover flex flex-col drawer-panel`.
- Motion: enter/exit via `.drawer-panel` (16px slide + fade, 200/150ms `--ease-out-ui`); reduced
  motion: instant (§G.3).

### H.2 Anatomy

```text
Header (px-3, h-14, border-b border-edge):
  eyebrow RECORDS · title "Records" · close button (44×44, X icon, aria-label "Close records")
Search (p-3, border-b border-edge):
  input: placeholder "Search exact ID or safe metadata…"
  (min-h-[44px], full width, font-mono for entered IDs; 200ms debounce, matching the Runs list)
Body (flex-1, overflow-y-auto, scroll-thin, p-3, aria-label "Recent records"):
  grouped sections, each with a section header:
    FROM COMPARE            (comparison references + ad hoc task executions)
    FROM EVALUATIONS        (evaluation executions + experiment task executions)
    FROM THE LAB            (policy studies + study-linked records)
    OBSERVATIONS            (evidence references)
    LEGACY & IMPORTED       (legacy references)
  Groups with zero items do not render — no empty group headers.
  Groups are workspace groups, not type groups: rows inside one group may carry different
  type eyebrows; the eyebrow — not the group — carries type identity.
  Each group shows its 5 most recent records (cap, §Q.4) as compact record rows (§J).
Footer (p-3, border-t border-edge):
  [View all records →]  — full-width bordered link button to /records, min-h-[44px]
  honesty note: "Records preserve exact execution provenance. Meaningful results live in
  Compare, Evaluations, Lab, and Models."
```

- With a search query active, grouping is preserved but each group shows all matches (scroll
  handles depth); an exact-ID hit renders first under an `EXACT MATCH` section header.
- Row selection follows §E.2: semantic rows navigate to owners; exact rows to record detail. The
  drawer closes on navigation; focus moves to the destination page heading; reopening the drawer
  later restores focus normally (trigger-based, inherited from the dialog primitive).
- The drawer performs **no** execution, export, or archive actions — rows and links only.

### H.3 Drawer states

| State | Rendering |
|---|---|
| No records at all | Body: `History` icon (muted), "No records yet.", honesty note: "Every comparison, evaluation, and study leaves an exact record here automatically." Footer unchanged (View all still works). |
| No search matches | "No records match `query`." + "Clear search" button. |
| Index loading | Single skeleton group (≤3 shimmerless placeholder rows using `.animate-pulse-ease` on opacity only); never an empty flash, never a full-pane spinner. |
| Index/migration error | Error-role block: `AlertCircle` + "Records index unavailable." + one-line reason + "Retry" button + link "Open full Records" (the full page shows richer diagnostics, §K.5). |

### H.4 Keyboard behavior

Focus order: close → search → rows (each row one stop; trailing exact-link is a second stop) →
View all. `Escape` closes and restores focus to the header Records button. `↓/↑` inside the search
input move into/through rows (roving tabindex within the list), `Enter` activates. The drawer
traps focus; background is inert.

### H.5 Live regions

The drawer adds no live regions beyond a single `role="status"` result-count line for search
updates (reusing the existing pagination-info pattern, capped at one per surface). The execution
strip's two regions remain the app's only global live regions.

### H.6 Drawer substitution rule

Below 1024px the drawer does not exist. The Records header button becomes a plain link to
`/records` (same element, different behavior — implementation may render `<a>` vs `<button>`
conditionally, but the accessible name "Records" and hit area are constant). Rationale: at tablet
widths a 400px trap over a ~760px canvas crowds without saving a navigation, and the full page is
strictly more capable. No bottom-sheet variant is introduced.

## I. Full Records utility (`/records`)

### I.1 Layout

The shipped Runs split layout is retained under refactor, not redesigned: ≥1024px, `380px` list
pane (`bg-panel`, `border-r border-edge`) + detail pane (`min-w-[600px]`, shell background);
below 1024px, route-based list/detail with a "Back to Records" band on detail. This layout is a
characterized production strength; Records inherits it.

List-pane top gains one identity band: eyebrow `RECORDS`, title "Records", and the filtered-set
count (`font-mono text-xs text-text-muted`, e.g. "214 records"). **DataArchiveActions stays in the
existing list-pane footer** (bottom band, `border-t`) — the shipped, tested placement; no
top-level action band is added.

### I.2 Filters

All current `RunFilters` strengths retained, plus a Type filter — the only new filter:

| Filter | Control | Options |
|---|---|---|
| Search | text input, 200ms debounce | free text + exact-ID match |
| Type | select | All types · Comparison · Evaluation · Policy Study · Task execution · Observation · Legacy |
| Model | select | existing model-key list |
| Status | select | existing status list |
| Mode | select | All · Rank · Fuse |
| Source | select | All · Ad hoc · Experiment · Legacy |

There is **no date filter**: none exists in the shipped UI, and none is added by this child.
Desktop (≥lg): always-visible 2-column grid, as today. Mobile: collapsible sheet with toggle +
applied-count badge, as today. Complete-set filtering before pagination, deterministic sort
(newest first, stable tiebreak on ID), `PAGE_SIZE = 50` with the existing "Load more" button and
preload multiplier — all preserved and covered by the migrated characterization tests.

### I.3 Data behavior

- Current Run summaries/details are indexed as task execution Records without changing payloads.
- Child 05 Comparison indexes, child 03 Evaluation Executions, and Lab Policy Study owner
  crosswalks create semantic Record references; child 04 Observations create evidence references.
- Existing legacy localStorage imports remain Legacy Records.
- Repeated index rebuild is idempotent; source deletion is not added.
- Current DataArchiveActions remain accessible from the Records list-pane footer.

## J. Record rows

A new sibling component **`RecordTypeRow`** — not a deformation of shared `RecordRow` (whose fixed
two-line inner serves Compare recent-run rows, Task Set history rows, and rubric rows with a
tested contract; `ModelList` already establishes the mirror-don't-deform precedent). It reuses
RecordRow's exact class grammar: `min-h-[44px] rounded-md border border-edge bg-panel px-3 py-2
hover:border-edge-bright`; no hover-transforms.

Anatomy (list variant, 4 lines maximum):

```text
[RecordTypeEyebrow: type icon + TYPE LABEL]   [StatusMark icon+word]   [timestamp, mono, right]
Title (text-sm, truncates; full title wraps in detail)
Meta line (font-mono text-xs text-text-muted, tabular-nums):
  model/roster summary · mode · cost (when known)
Owner hint line (text-xs text-text-secondary):
  "in Frontend Reliability · Task Set v6"
Trailing (semantic rows only): [Exact ↗] link — a separate sibling anchor, 44×44 hit area,
  aria-label "Open exact record", navigating to the exact record detail
```

Rules:

- The row itself is **one real anchor** (`<a>`/`<Link>`), never a `div` with `tabindex`; the
  trailing exact link is a sibling anchor inside the same flex row — no nested anchors, no
  row/button ambiguity.
- Status is always `StatusMark` (icon + word). Type is always `RecordTypeEyebrow` (icon + word,
  muted grammar). Neither is ever a bare dot or a tinted chip: **no tinted source/type identity
  pills** (`bg-accent/10`-style) — muted eyebrow identity is the canonical grammar, and the
  current tinted `SourceChip` treatment is removed in favor of it. Source information remains
  available in the meta line and the Source filter.
- Legacy rows use the muted `LEGACY` eyebrow and their owner hint reads exactly "Origin
  unresolved — preserved as imported" when the resolver returns `unresolved`.
- Semantic/exact open-target behavior follows §E.2 everywhere (drawer, list, palette).
- Drawer compact variant: identical anatomy minus the meta line (title + eyebrow + status + owner
  hint), keeping drawer rows to 3 lines.
- Below `sm` the meta line wraps rather than clips; `min-w-0` on all flex children; per-row rects
  stay inside cards.

## K. Typed details

Route `/records/:recordType/:recordId` (and `/runs/:runId` for task executions).

### K.1 Task execution

The existing `RunDetail` composition preserved in full — it is a production strength, not a
redesign target: source/status/mode chips, title, timestamps + timezone, status timeline
(Created → Candidates → Judge → Result), provenance trail, outcome, cost breakdown, candidate
selector + output, judge evidence, fusion evidence, collapsed task/configuration, deep-link
`?candidate=`/`?attempt=` focus behavior. Its actions bar is normalized to the Records action
grammar (§L). Nothing else about it changes; its tests migrate wholesale.

### K.2 Comparison / Evaluation / Policy Study references

These details exist for the rare case a user lands on the reference itself (e.g. from an exact
link). Anatomy: identity header (eyebrow, StatusMark, title, mono ID + timestamps), a prominent
**owner card** —

```text
[owner icon]  This record's home
"Comparison result in Compare"           (ownerLabel)
[Open in Compare →]                       (primary; ownerHref)
confidence chip (§F)
```

— followed by a typed summary (roster, mode, counts, cost) and a **Beneath this record** list of
child records as record rows. No evidence duplication: the owner renders the meaning; this page
renders the reference and the links. **Semantic details must not reproduce their owner
workspace's evidence/results UI.** The summary states this with the honesty token: "This is the
reference record. Judged results, rationale, and evidence live in the owning context."

Policy Study detail child depth: at most the **20 most-recent child records** (trials/study
observations), plus aggregate child counts (e.g. "142 trials · 12 observations"), plus the single
"Open study" owner action. No child pagination inside Records; deeper study archaeology belongs
in Lab. Exact deep links into the study remain available.

### K.3 Observation

Identity header + eligibility panel (classification, rules passed — rendered as icon+word list) +
exact source links (run, attempt, assessment — mono link chips) + owner backlink to the
Task/Model context + the policy-evidence marker when the observation is study-linked (Child 06/07
wording, reused verbatim).

### K.4 Legacy

Preserved summary fields (whatever was imported, rendered as read-only rows), import provenance
(when/how imported), the unresolved-owner block (§F), and raw payload behind a disclosure
("Preserved payload", `font-mono text-xs`, contained scroll `max-h-96`). Never an attempt to
re-parse into richer semantics. The existing `LegacyRunDetail` honesty posture (known fields only,
no fabricated status/mode/source) is the foundation.

### K.5 Migration/index error state

`/records` renders a blocking panel in the list pane: error role, "The records index could not be
built.", exact diagnostics list (entity type / ID / reason code, `font-mono text-xs`, contained
scroll, no payload echo), counts, actions: Retry rebuild · Copy diagnostics. Underlying source
data is explicitly stated untouched: "Your runs and results are unaffected — this index is
derived and rebuildable." Rebuild is idempotent, so Retry is always safe to offer.

### K.6 Empty / no-match / loading / query-error states

- **Empty (no records):** `History` icon (muted, 28px — matching other workspaces' empty blocks),
  "No records yet.", explanation ("Run a comparison or an evaluation — its exact record appears
  here automatically."), links to Compare **and** Evaluations, and the ledger-scope honesty note.
  Detail pane (≥1024) shows the same message centered; never a blank pane.
- **No filter matches:** "No records match the current filters." + "Clear filters" button
  (existing grammar; the filter bar stays interactive).
- **Loading:** ≤3 shimmerless skeleton rows (`.animate-pulse-ease`, opacity only) in lists;
  detail headings render immediately from route params (type + ID), body sections stream in; no
  full-page spinner, no bare "Loading…" pane.
- **Query error:** `AlertCircle` + "Failed to load records." + message + Retry (existing grammar).

### K.7 Unknown ID

Typed not-found, never an empty shell:

```text
Eyebrow: NOT FOUND
"No task-execution record with ID run-9b41… exists in this database."
Recovery options: [Search Records for similar IDs]  [Open Records]  [Import data]
honesty note: "Records are device-local. A link copied from another device will not resolve here."
```

## L. Actions boundary

A single actions row, fixed order, rendered identically on every typed detail:

1. **Open owning context** — primary bordered button, label resolves from `ownerLabel` ("Open in
   Compare", "Open evaluation", "Open study", "Open Task Set"). Absent (not disabled) when
   `ownerHref` is null; the unresolved block (§F) explains why.
2. **Open in Compare** (task executions and comparisons only) — retains existing wording, with
   the honesty token beneath: "Loads configuration only — no outputs, no execution, no lineage."
3. **Copy link — this device** — existing `CopyLinkButton` verbatim: label
   `Copy link — this device`, copied state `Copied!`, SR announcement generalized to "…to this
   record on this device" for non-run types.
4. **Export** — existing safe archive actions via `DataArchiveActions`, unchanged wording.

Forbidden actions — retry, re-judge, re-fuse, repair, resume, add model, delete, retention — do
not render in any state: not disabled, not hidden behind flags; they are **structurally absent**
from Records components, and the acceptance sweep (§R) asserts their absence. Execution actions
live after navigation in the owning context.

## M. Visual execution contract

Rules over pixels; all tokens per §G.1–G.3. Nothing in this section creates a new design system.

1. **Hierarchy.** Three registers, descending: (1) destinations — primary nav items, page titles;
   (2) chrome and structure — eyebrows, section headers, body; (3) metadata and honesty —
   `text-xs`/`text-[11px]`, secondary/muted text, mono tabular identifiers. Records never rises
   above register 2 except its page title; the ledger is deliberately one register quieter than
   the primaries.
2. **Density.** Rows `px-3 py-2`, `gap-0.5` internal, `gap-2` between interactive siblings. The
   4-line record row is the densest permitted row; nothing denser ships.
3. **Whitespace.** Earned through section rhythm, not padding inflation: details use the shipped
   `divide-y divide-edge` document rhythm; the drawer uses `p-3` bands separated by hairlines. No
   marketing-style page centering on Records surfaces.
4. **Surfaces.** `bg-panel` = working surfaces (list pane, strip, footer bands); `bg-raised` =
   floating surfaces (dialogs, drawer, palette); `bg-canvas/shell` = void behind documents.
   Emphasis = surface step, never shadow stacks or gradients; `shadow-popover` only on floating
   surfaces.
5. **Borders.** `border-edge` default hairline; `border-edge-bright` for hover and
   floating-surface edges. Selection/active uses 2px inset accent bars (rows: left; desktop nav:
   bottom; mobile nav: top). No 1px accent borders on static content.
6. **Navigation emphasis.** Active destination = `text-accent` + static 2px bar +
   `aria-current="page"`; exactly one active bar per nav surface. Inactive =
   `text-text-secondary`, hover `bg-panel` + `text-text`.
7. **Typography.** Eyebrow → title → body → meta. Identifiers, timestamps, durations, costs are
   always `font-mono tabular-nums`. Prose is Geist; IDs are Geist Mono; never mixed in one inline
   run.
8. **Metadata density.** One meta line per list row (`·`-separated: roster summary · mode · cost
   when known); one owner-hint line. Trailing cluster hugs the right edge via `ml-auto`; below
   `sm` the meta line wraps rather than clips.
9. **Owner cues.** Every semantic record carries an owner hint ("in Frontend Reliability · Task
   Set v6") and a single primary owner action. Owner grammar: "in {owner} · {qualifier}", never a
   bare URL, never a guessed link.
10. **Exactness cues.** Exactness is quiet: muted mono IDs, exact timestamps with timezone,
    secondary-text confidence chips. Warning color is reserved for unresolved origin and real
    errors.
11. **Progressive disclosure.** Long payloads live behind `aria-expanded` disclosure buttons with
    contained scroll (`max-h-96`). Drawer shows ≤5 rows/group pre-search; the full page is the
    depth surface.
12. **Long content.** Titles truncate in rows and wrap in detail headers. Mono IDs `break-all` in
    detail surfaces. `min-w-0` on every flex child. No horizontal scroll anywhere in shell or
    Records.
13. **Loading/error/empty.** Skeleton rows (opacity-only pulse), never layout-shifting spinners;
    headings render immediately from route params. Errors are bounded blocks (icon + sentence +
    reason + retry), never full-page. Empty states teach ownership once (icon + one sentence +
    one or two exits).
14. **Interaction feedback.** Hover = border-bright + text step (`.motion-state` 150ms). Press =
    `.pressable` 0.97 scale at 100ms. Focus = the global 2px accent `:focus-visible` ring, never
    removed or replaced. No hover transforms on record rows.
15. **Motion restraint.** Only `.drawer-panel` is added; it joins the `prefers-reduced-motion`
    zero-duration group. No `transition-all`, no palette animation, no nav-indicator slide, no
    skeleton shimmer.
16. **Honesty copy.** One fixed microcopy system (below) rendered **adjacent to its affordance**
    within the same visual block; never toasts, dialogs, dismissible elements, or large global
    banners. Strings come only from `src/ui/honesty-copy.ts` so tests assert exact strings and
    surfaces can't fork the copy. Caps: ≤2 tokens per visual block, ≤4 per route surface (the
    drawer counts as one surface).

Honesty-token vocabulary (verbatim strings):

| Token | Canonical wording | Attaches to |
|---|---|---|
| Device-local link | "Copy link — this device" (button) / "Records are device-local…" (not-found) | copy-link button; unknown-ID recovery |
| Configuration-only handoff | "Loads configuration only — no outputs, no execution, no lineage." | Open in Compare, everywhere it appears |
| Reference vs meaning | "This is the reference record. Judged results, rationale, and evidence live in the owning context." | semantic record details |
| Unresolved origin | "This record's historical owner is unknown. RSemble never guesses an owner — exact evidence below remains fully inspectable." | legacy/unresolved details |
| Ledger scope | "Records preserve exact execution provenance. Meaningful results live in Compare, Evaluations, Lab, and Models." | drawer footer; `/records` empty state |
| Policy evidence | (Child 06/07 marker, reused verbatim) | study-linked observations/records |
| Eligibility notice | (Child 04/07 wording, reused verbatim) | observation details |

## N. Responsive behavior

One collapse ladder — label → icon → move-to-bottom-nav → route substitution — at the shipped
breakpoints (`sm` 640 / `md` 768 / `lg` 1024). The drawer is the only surface that substitutes;
everything else collapses. **Zoom follows the same ladder: at 200% zoom the effective width
drives the identical rules; no zoom-specific behavior exists.** Records remains accessible at all
widths; readiness and current-execution awareness never disappear; no document-level horizontal
overflow on any shell or Records route.

| Width | Shell | Records |
|---|---|---|
| **1440** | Full header: wordmark, nav labels + icons, ⌘K kbd trigger, Records icon+label, connections dot+word, help | Drawer 400px available; `/records` split 380px + detail |
| **1024** | Nav labels without icons (existing `lg` boundary); palette icon button; Records icon+label; connections dot+word at exactly `lg` | Drawer and split view begin at ≥1024 only |
| **768** | Desktop nav still visible (labels); palette/help icon buttons; Records icon-only 44×44; connections dot (word returns at `lg`; accessible name always carries status) | Records button navigates to `/records`; list/detail are separate routes |
| **390** | Bottom nav 4-across (~97px columns, icon 18px over `text-xs` label, top accent bar on active); header `px-2`: logo, hamburger (Compare route only), **Records icon 44×44**, connections dot. Palette and help are hidden below `md` (characterized). | Records button navigates; full-bleed list; filters in collapsible sheet with applied-count badge; detail full-screen with "Back to Records" band |
| **200% zoom** (effective ≈720/512/384/195px) | Same ladder as the matching native width: wordmark/nav labels collapse, utilities reduce to 44×44 icons, primary navigation transfers to the bottom nav exactly as at native narrow widths. Connections pill + palette (≥md) + Records never disappear. Strip caption truncates (shipped `truncate`) but StatusMark + "View progress" stay visible at all effective widths. | Same as the matching native width. Mono IDs `break-all` in details; `min-w-0` on all flex children; per-row rects stay inside cards |

## O. Migration behavior

### O.1 The pointer (one-time)

On the first app open after the nav switch ships, if (and only if) the local database contains at
least one run record, the header Records button renders a one-time anchored popover (non-modal,
`role="status"`, not focus-trapping):

```text
"Runs moved."
"Exact execution records now live here — same history, same links, new address."
[Got it]                                   (min-h-[44px]; dismisses forever)
```

Dismissal persists in localStorage (`records-move-pointer-dismissed`). The popover also dismisses
on any navigation or on opening the drawer. It never re-renders afterward, never appears for
fresh databases (nothing moved for them), and is fully keyboard reachable (it takes focus order
after the Records button without trapping). Reduced motion: appears without transition. It is a
pointer, not an apology, and it appears exactly once per database lifetime.

### O.2 Legacy routes and copy

- `/runs` and `/runs/:runId` behavior per §D. Direct load, refresh, hash-router, back/forward,
  and focus restoration are tested on all legacy and canonical routes. On route change into a
  detail, focus moves to the detail heading (`tabindex="-1"`); back restores list scroll
  position.
- All ordinary-history links and labels that said "Runs" are re-worded to their new owner
  ("Previous comparisons" in Compare, execution history in Task Sets) or to "Records" where the
  exact ledger is truly meant. The word "Runs" survives only in preserved URLs and in domain
  terms like `RunRecordV2`. Palette keywords keep `runs` as a synonym (§G.7) so muscle memory
  lands.
- All copied links remain explicitly device-local; no canonical historical record is deleted,
  rewritten, or re-parsed by this child.

## P. Accessibility

- **Keyboard flows.** Header: logo → nav links (or mobile menu) → palette → Records → connections
  → help; visual order equals DOM order at every width. Bottom nav is last in the page tab order.
  Drawer: §H.4. Records list: filters → rows (row anchor, then trailing exact link) → load more.
  Detail: heading → actions row → sections in reading order; disclosures are `aria-expanded`
  buttons.
- **Targets.** All interactive targets ≥44×44 CSS px, siblings ≥8px apart, including drawer rows'
  trailing exact links.
- **Focus management.** Drawer and all dialogs trap focus, make the background inert, close on
  Escape, and restore focus to their trigger (inherited from the Base UI dialog primitive — no
  bespoke traps). Route changes move focus to the destination heading.
- **ARIA.** Nav: `aria-label="Primary"`, `aria-current="page"`. Records button:
  `aria-haspopup="dialog"` + `aria-expanded` (≥1024). Drawer: `role="dialog"`,
  `aria-label="Records"`. Groups: labelled section headers. Rows: real anchors with accessible
  names composed of type + title + status. Status and type words are text, icons `aria-hidden`.
  The connections pill always exposes the status word in its accessible name. Status/type are
  never color-only.
- **Live regions.** The execution strip's polite caption + assertive alert remain the app's only
  global live regions; the drawer adds none beyond one `role="status"` result count per surface.
- **Reduced motion.** Drawer slide collapses to instant (§G.3); all other shell motion routes
  through the shipped `.pressable`/`.motion-state` classes neutralized by the existing
  `prefers-reduced-motion` block.
- **Contrast.** All roles inherit the compliant palette; Records honesty tokens use
  `text-text-secondary` (#a1a1a1, ≥4.5:1 on panel/raised), never #777777, for claim-limiting copy.
- **Long IDs** wrap/middle-ellipsize inside their cards (`break-all` on mono IDs in detail
  surfaces); per-row rects stay inside cards.

## Q. Densification caps (assertable)

1. Primary nav: exactly 4 items, desktop and mobile; identical order.
2. Header utility cluster: ≤4 interactive elements this child (palette, Records, connections,
   help); ≤5 ever (Child 09 Attention insertion); zero non-functional elements at all times.
3. Global live regions: exactly the strip's two; ≤1 additional `role="status"` per Records
   surface.
4. Drawer: ≤5 rows per group pre-search; ≤5 groups; drawer rows ≤3 text lines.
5. Record row: exactly 1 title line, ≤1 meta line, ≤1 owner-hint line; ≤2 anchors per row (row +
   trailing exact link); ≤3 identity elements (eyebrow, StatusMark, timestamp).
6. Records list: pagination at 50; filters ≤6 controls (search, type, model, status, mode,
   source).
7. Honesty tokens: ≤2 per visual block, ≤4 per route surface; all strings from
   `honesty-copy.ts`.
8. Actions row on any Records detail: ≤4 actions, fixed order (§L); zero execution verbs.
9. One-time pointer: renders at most once per database lifetime; ≤2 sentences + 1 button.
10. Typed detail: owner card renders exactly one primary link; confidence chip exactly one;
    Policy Study beneath-list ≤20 child rows + aggregate counts.

## R. Acceptance criteria

**Tokens and motion**

1. No new colors, radii, shadows, fonts, or easing values; `design-token-contract.test.ts` passes
   unchanged; grep of new shell/Records files finds no raw hex outside values already in
   `src/index.css`/`tailwind.config.js`.
2. `.drawer-panel` and `.honesty-note` exist in `src/index.css` with §G.3 values
   (`.honesty-note` = `line-height` only); `.drawer-panel` is listed in the
   `prefers-reduced-motion` zero-duration group; existing Child 07 `honesty-note` usages render
   unchanged (their size/color utilities remain the styling authority).
3. Motion contract scan passes: no `transition-all`, bare `ease-in`, `scale(0)`, palette
   animation, shimmer, hover-lift, or record-row hover-transforms in any new file.

**Navigation composition**

4. Desktop and mobile primary nav each contain exactly `Compare, Evaluations, Lab, Models` in
   order, as `NavLink`s with `aria-current="page"` on the active item plus the static 2px accent
   bar (computable via computed style); no "Runs" label or link exists in any current UI surface
   (full-DOM text sweep on each primary route).
5. All four primary destinations render functional content on direct load (each route renders its
   workspace's list/home with real data or its designed empty state — assert absence of
   placeholder strings and of routes rendering `null`), including Lab (`/lab`, `/lab/recipes`,
   `/lab/model-pools`) and Models (`/models`).
6. Records appears exactly once in the header utility cluster and nowhere in primary or bottom
   nav; every header utility measures ≥44×44 at every width.
7. The connections readiness state is exposed as text in the pill's accessible name at all widths
   (never dot-only to assistive tech).

**Drawer**

8. At ≥1024px the Records button opens the drawer: focus is trapped (Tab cycles inside),
   background is inert, Escape closes, and focus returns to the Records button
   (`document.activeElement` asserted).
9. Drawer groups render only when non-empty; rows are real `<a>` elements; semantic rows navigate
   to owner routes and exact rows to record detail; "View all records" navigates to `/records`;
   an exact-ID search renders the `EXACT MATCH` section first.
10. At <1024px the Records button navigates to `/records` and no drawer mounts.

**Records utility**

11. `/records` preserves characterized Runs behavior: complete-set filtering before pagination,
    deterministic newest-first order with stable ID tiebreak, page size 50, load-more preload,
    200ms debounce — the migrated Runs tests pass against the Records components (no test deleted
    to make the rename pass). The filter set is exactly §I.2 (six controls; no date filter).
12. `/records/:recordType/:recordId` renders the six typed details of §K; an evaluation reference
    is never rendered through the RunRecordV2 detail component (type-level assertion).
13. Semantic and exact records are distinguishable in the default interleaved stream — verified
    by type eyebrow + owner hint + open-target behavior in component tests, **and** by a browser
    acceptance check that a user reading the list does not perceive the semantic reference and
    its exact leaf as accidental duplicates (eyebrow/owner-hint/Exact-affordance triad visible
    without interaction).
14. Every detail's actions row contains only the §L actions; a sweep of Records components finds
    zero occurrences of retry/resume/re-judge/re-fuse/repair/add-model/delete/retention verbs as
    interactive elements (structurally absent, not disabled).
15. Copy-link renders `Copy link — this device` verbatim; Open in Compare renders its
    configuration-only honesty token verbatim; all honesty strings resolve from
    `honesty-copy.ts` (no duplicated literals elsewhere — grep assertion).
16. Owner backlinks render `exact`/`crosswalk`/`unresolved` chips as icon+word; unresolved never
    renders an owner link; crosswalk chips expose the resolver reason in their accessible name;
    Policy Study owner resolves to `/lab/studies/:studyId`, never to a retired Fusion route.
17. Policy Study reference detail renders ≤20 child rows + aggregate counts + a single owner
    action; no child pagination exists inside Records.

**Legacy routes and migration**

18. `/runs?status=failed` lands on `/records?status=failed`; `/runs/:runId` renders the exact
    detail with the URL bar unchanged; both survive direct load, refresh, and back/forward;
    copy-link on a `/runs/:runId` page emits the canonical `/records/...` form.
19. Unknown IDs at `/records/:type/:id` and `/runs/:id` render the typed not-found with all three
    recovery options; no empty shell.
20. The migration pointer renders at most once (localStorage-gated), only when prior run records
    exist, is keyboard-dismissible, and never traps focus.

**Index and data**

21. Index rebuild failure renders the §K.5 diagnostics panel with Retry; repeated rebuild after
    success produces no duplicate rows (idempotence asserted at repository level and by row
    count in UI).
22. No Records API exposes mutation/execute methods; no provider call originates from any Records
    surface; no retention/delete behavior is added.

**Responsive and zoom**

23. At 1440/1024/768/390 and 200% zoom (effective-width ladder per §N): no document-level
    horizontal overflow on any shell or Records route; header utilities and execution-strip
    essentials remain visible; the Records button renders at every width; bottom nav labels do
    not truncate at 390; 200% zoom behaves identically to the matching native width (no
    zoom-specific behavior).
24. All interactive targets ≥44×44 CSS px, siblings ≥8px apart, including drawer rows' trailing
    exact links; keyboard-only completion of every Records flow; reduced-motion render verified.

**Scope honesty**

25. No Attention, global search, or Child 09 functionality appears anywhere (no reserved slot,
    icon, disabled button, or route); no universal model score/leaderboard or pooled Model Rollup
    semantics leaks into the shell or Records.

**Caps**

26. All ten densification caps in §Q hold (each countable in the DOM).

## S. Non-goals

- Child 09 Attention behavior and global cross-entity retrieval;
- new execution/recovery logic; paid calls of any kind from Records;
- retention/delete/data-mobility policy;
- a new universal result entity; model evidence aggregation changes;
- new providers or prototype-only model rosters; embedding search;
- redesign of Compare/Evaluations/Lab/Models interiors;
- a Records bottom-sheet or any Records item in primary/bottom navigation;
- grouped/pseudo-tree record streams; date filtering; a sliding nav indicator.
