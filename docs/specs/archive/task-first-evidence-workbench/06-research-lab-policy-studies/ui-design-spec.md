# Research Lab UI Design Specification

**Version:** 1.0.0
**Date:** 2026-08-17
**Status:** Design authority for the Research Lab, alongside the behavioral contract
[`research-lab-policy-studies-spec.md`](./research-lab-policy-studies-spec.md). Where this document
and the behavioral spec appear to conflict, the behavioral spec wins on *what exists and what it
means*; this document wins on *how it looks, reads, moves, and responds*.
**Supersedes:** all Lab surfaces depicted in
`docs/explorations/future-task-first-ui/rsemble-future-workbench-phase-c.html` and the illustrative
layouts in `rsemble-research-lab-positioning.html`. Those artifacts remain provenance for
positioning arguments only; their visual language, overlay-based study detail, tabbed dossier, and
color-only status dots are explicitly rejected here (see §14).

---

## 1. Scope

This document specifies the production UI for:

- `/lab` — Lab home, led by Policy Studies
- `/lab/studies/:studyId` — Policy Study detail (draft editor through completed dossier)
- `/lab/recipes` and `/lab/recipes/:recipeId/versions/:version` — Fusion Recipes
- `/lab/model-pools` and `/lab/model-pools/:poolId/versions/:version` — Model Pools
- The New Policy Study flow, the Task Set contextual handoff, the retired-legacy-route
  experience, and the migration-blocked state

It does not specify Compare's "Run with playbook" internals beyond the playbook picker surface
(child 05 owns Compare); it does specify the Playbook presentation that the picker reuses.

---

## 2. Design principles

1. **The finding is the product.** A Policy Study exists to produce one inspectable claim. Every
   surface leads with the claim sentence and its claim level, then makes the evidence that earned
   it one scroll or one link away. Lists show findings, not topology.
2. **Verdicts never float.** No score, recommendation, or "Recommended" marker appears anywhere
   without its uncertainty verdict and its cost on the same visual row or in the same block.
   Quality and policy cost are deliberately **not** separated — a playbook recommendation is a
   quality-at-cost judgment, and splitting the two invites cost-blind reading. (This reverses an
   earlier hypothesis; see §14.3.)
3. **Claim level is a rendering mode, not a badge.** Exploration and confirmation differ in badge,
   frame, and copy simultaneously, so the distinction survives colorblindness, grayscale printing,
   and skimming.
4. **The evidence boundary is a place.** The boundary between policy evidence and model evidence
   is a structural section with a two-sided ledger, plus an inline marker grammar wherever a model
   name appears inside a study. It is legible, not merely asserted.
5. **Honest surfaces only.** Every rendered control works. No tabs over empty panels, no
   placeholder study kinds, no "coming soon" cards, no disabled buttons whose enablement condition
   is invisible. Negative results (`do_not_fuse`, eliminated families, screened-out pairs, failed
   trials, retries) are first-class content, styled with the same care as positive ones.
6. **Same grammar as the rest of the workbench.** The Lab reuses `RecordRow`, `KindEyebrow`,
   `StatusMark`, `DialogSurface`, the contained-scroll region pattern from `ResultMatrix`, and the
   shipped industrial palette. It introduces a small, named set of extensions (§4.3) and nothing
   else. A user who knows Evaluations already knows how to read the Lab.
7. **Immutability reads as immutability.** Sealed inputs, sealed trials, and playbooks are
   presented as records — mono identifiers, digests, timestamps — never as editable-looking form
   fields. Draft state is the only state that looks like a form.

---

## 3. Information architecture

### 3.1 Layering

| Layer | Content | Where |
|---|---|---|
| **Default** (first paint of `/lab`) | Policy Studies list with finding sentences and claim badges; summary strip (Active / Findings / Confirmed); `New Policy Study` action | `/lab` main column |
| **Secondary** (visible, subordinate) | Fusion Recipes and Model Pools section entries with counts; section switcher | `/lab` section rail (desktop) / section header row (narrow) |
| **On demand** (behind a link or disclosure) | Study dossier sections below the verdict; full screened-pair tables; elimination logs; per-trial provenance; version payload details; exact Record links; archived items | Study detail, version routes, disclosures |

Nothing execution-critical hides behind hover. Disclosures are keyboard buttons, never
hover-reveals.

### 3.2 Routes and shell composition

All six canonical routes render inside the standard app shell (Header + workspace area). Until
child 08 adds **Lab** to primary navigation, the routes are reachable via direct URL, the command
palette (`Navigate → Lab`), and Task Set backlinks. The Lab must render correctly with no primary
nav entry pointing at it — no self-referential "you can't get here" copy.

```
/lab
├── section rail: Policy Studies (default) · Fusion Recipes · Model Pools
├── main column renders the active section
└── section state is URL-driven: /lab (studies), /lab/recipes, /lab/model-pools
```

`/lab` **is** the studies list — there is no separate `/lab/studies` index route. The section rail
is real navigation (`NavLink` with `aria-current="page"`), not local tab state, so refresh,
back/forward, and deep links behave.

Study identity owns its route: `/lab/studies/:studyId`. No route contains `suiteId`, `taskSetId`,
or "fusion study" naming. The legacy `/evaluations/:suiteId/fusion/:studyId` route is removed
without redirect (§11).

### 3.3 Naming

- Nav label (when added): **Lab**. Page heading: **Research Lab**.
- Entities: **Policy Study**, **Policy Playbook**, **Fusion Recipe**, **Model Pool** — Title Case
  as product nouns; lowercase generic ("this study", "the playbook") in running copy.
- "Fusion" appears only where synthesis actually occurs: Fusion Recipe, Fuse policy row, Fusion
  Result references. Never "Fusion Study", never "Fusion Lab".
- Claim levels in copy: **Exploratory** and **Confirmed** (adjective form in badges),
  "exploration" / "confirmation" (noun form when naming the claim plan).

---

## 4. Tokens

### 4.1 Existing tokens (used as-is; no palette additions)

| Role | Token | Value |
|---|---|---|
| Canvas / shell | `bg-canvas`, `bg-shell` | `#0a0a0a` |
| Panel / card | `bg-panel`, `bg-card` | `#121212` |
| Card hover | `bg-card-hover` | `#1a1a1a` |
| Raised (dialogs, popovers) | `bg-raised` | `#181818` |
| Border default / hover | `border-edge` / `border-edge-bright` | `#262626` / `#3a3a3a` |
| Accent (focus, active, recommended) | `accent` | `#00e5ff` |
| Text primary / secondary / muted | `text-text` / `text-text-secondary` / `text-text-muted` | `#ededed` / `#a1a1a1` / `#777777` |
| Success = **Confirmed** claim role | `success` | `#00ff9d` |
| Warning = **Exploratory** claim role | `warning` | `#ffb300` |
| Error = failure / blocked role | `error` | `#ff4d4d` |
| Radii | `rounded-sm/md/lg` | `4px / 6px / 8px` |
| Shadows | `shadow-popover` | `0 16px 48px -12px rgba(0,0,0,.7)` |
| Fonts | `font-sans` (Geist), `font-mono` (Geist Mono) | — |
| Motion durations | `--motion-fast/short/medium` | `100ms / 150ms / 200ms` |
| Motion easing | `--ease-out-ui` | `cubic-bezier(0.23, 1, 0.32, 1)` |

Semantic assignment the Lab commits to (assertable in copy and class names):
**Exploratory ⇒ `warning` family; Confirmed ⇒ `success` family; blocked/failed ⇒ `error` family;
recommended/active ⇒ `accent` family.** No new hues. The Lab must not introduce the teal/violet
palette from the exploration HTML artifacts.

### 4.2 Type and spacing scale (existing conventions, restated as Lab law)

- Eyebrows: `font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted`
- Section headers: `font-mono text-xs font-semibold uppercase tracking-wider text-text-muted`
- Body / rows / tables: `text-sm`; metadata and chips: `text-xs`
- Page headings: `text-lg font-semibold`; the study title may use `text-xl` at ≥1024px only
- All identifiers, versions, digests, scores, costs, and counts: `font-mono tabular-nums`
- Row/card padding `px-3 py-2`; card body `p-3`; dialog body `p-6`; gaps `gap-1.5 / gap-2 / gap-3`
- Interactive minimum `min-h-[44px]` and `min-w-[44px]`; interactive siblings ≥ `gap-2` (8px)

### 4.3 New tokens and utilities (exact additions)

Add to `src/index.css` (values final; names assertable by contract tests):

```css
/* Claim-level frames. Border style is the redundant (non-color) channel:
   exploratory = dashed, confirmed = solid. */
.claim-frame-exploratory {
  border: 1px dashed rgba(255, 179, 0, 0.5);      /* warning @ 50% */
  background-color: rgba(255, 179, 0, 0.05);
}
.claim-frame-confirmed {
  border: 1px solid rgba(0, 255, 157, 0.5);       /* success @ 50% */
  background-color: rgba(0, 255, 157, 0.05);
}

/* Evidence boundary rule: a labeled dashed divider that separates
   policy-evidence content from model-evidence eligibility content. */
.boundary-rule {
  border-top: 1px dashed #3a3a3a;
}
```

No new keyframes, no new Tailwind theme extensions, no new easing curves. All Lab transitions use
the existing `--motion-*` durations and `--ease-out-ui`; anything animated must already be covered
by the `prefers-reduced-motion` block in `src/index.css` (the two classes above animate nothing).
The motion contract (`src/ui/motion-contract.test.ts`) applies unchanged: no `transition-all`, no
`ease-in`, no `scale(0)` entrances, no hover-transform on record rows.

---

## 5. Lab home (`/lab`)

### 5.1 Layout

**≥1024px:** two columns. Left: section rail, `w-[220px]`, `border-r border-edge`. Right: main
column, `max-w-[960px]`, `px-6 py-4`.
**768px:** section rail becomes a horizontal segmented nav (same pattern as Evaluations'
"Task sets | Rubrics") above the main column.
**390px:** identical to 768 with `px-3`.

Section rail entries (top to bottom): **Policy Studies**, **Fusion Recipes**, **Model Pools**.
Each is a `NavLink`, `min-h-[44px]`, `rounded-md px-3`, with a `font-mono tabular-nums text-xs
text-text-muted` count on the right. Active: `bg-accent/10 text-accent` plus `aria-current="page"`
(never color alone — active state also renders a 2px left accent bar via `border-l-2
border-accent` and the `aria-current` attribute is the assertable signal). Exactly three entries.
Rendering a fourth entry of any kind is a contract violation.

### 5.2 Policy Studies section (default)

Anatomy, top to bottom:

1. **Header row:** eyebrow `RESEARCH LAB`, heading "Policy Studies", count
   (`font-mono text-xs text-text-muted`, e.g. `6 studies`), and primary button
   **New Policy Study** (`min-h-[44px]`, accent-filled: `bg-accent text-on-accent`).
2. **Summary strip:** exactly three metrics in a `grid grid-cols-3` panel
   (`border border-edge rounded-md divide-x divide-edge`):
   - **Active** — draft + in-progress + interrupted count
   - **Findings** — completed studies with a playbook (any claim level)
   - **Confirmed** — confirmed-claim playbooks
   Each cell: `p-3`, value `font-mono text-lg tabular-nums`, label `text-xs text-text-secondary`.
   Cells are not clickable in v1 (no inert-looking links); the strip is informational. Cap: three
   cells, never more (§13).
3. **Filter row (only when >8 studies exist):** text search + status select + claim-level select,
   mirroring `RunFilters` composition. Below 8 studies the row is omitted entirely — not disabled.
4. **Study list:** `RecordRow` (list variant) per study, ordered by `updatedAt` descending.

**Study row anatomy** (all within the shared `RecordRow` surface —
`min-h-[44px] rounded-md border border-edge bg-panel px-3 py-2 hover:border-edge-bright`, whole
row is the link to `/lab/studies/:studyId`):

```
[KindEyebrow: flask icon + POLICY STUDY]  [ClaimBadge]            [StatusMark]
Title (text-sm text-text, truncate)
Finding sentence (text-xs text-text-secondary, 1 line, truncate)   ← from playbook
Meta line (font-mono text-xs text-text-muted):
  Task Set v6 · Pool v4 · policy cost 2.6× · exp. $62.40 · Aug 10
```

- `KindEyebrow` gains a new `study` kind: lucide `FlaskConical` icon + label "Policy Study"
  (icon-only below `sm`, matching existing behavior).
- **Finding sentence** renders only when a report exists; for draft/in-progress/interrupted/failed
  rows the second line is the honest state instead: "Draft — inputs not sealed",
  "Stage B running — 14 of 24 holdout tasks", "Interrupted — resumable", "Failed at Stage B —
  see diagnostics". Never blank, never lorem.
- Meta line always carries **both** costs when known (policy cost multiplier and experimental
  dollars) — cost visibility is a product invariant, and it starts at the list.
- Archived studies are hidden by default behind a "Show archived (n)" toggle (same pattern as
  `TaskSetList`); archived rows render at 60% text opacity with an explicit `Archived` `StatusMark`
  (opacity alone is not the signal).

**Densification caps for the row (assertable):** exactly 1 title line, 1 finding/state line,
1 meta line; at most 3 leading identity elements (eyebrow, claim badge, status); no additional
chips. Anything more belongs in the detail.

**Empty states:**

- *First use (no studies, no assets):* centered block, max-w `28rem`: `FlaskConical` icon
  (`text-text-muted`), heading "No policy studies yet", body copy:
  > "A Policy Study pins an exact Task Set Version, Model Pool, and Fusion Recipes, then compares
  > best-single, Rank, Fuse, and Refine policies on held-out tasks. It ends in a Policy Playbook —
  > including the finding that fusing is not worth it."
  Primary button **New Policy Study**; secondary link "Open Evaluations to build a Task Set first"
  when no Task Set Versions exist (the New flow requires one).
- *Filters active, zero matches:* "No matching studies." + "Clear search and filters" button.
- *Load failure:* `AlertCircle` + "Failed to load studies." + error message + Retry button
  (identical grammar to `ComparisonList`).

### 5.3 Fusion Recipes and Model Pools sections

Same header grammar ("Fusion Recipes" / "Model Pools", count, **New Recipe** / **New Model Pool**
buttons). One line of scope copy under each heading, `text-xs text-text-secondary`:

- Recipes: "Fusion is a method term — a recipe describes how synthesis is performed. Versions are
  immutable; referenced versions stay resolvable after archive."
- Pools: "A pool is an experimental selection manifest of exact model configurations. Pools never
  merge model evidence or act as a synthetic respondent."

Rows are `RecordRow` list rows linking to the **latest version route**:

- Recipe row: eyebrow `FUSION RECIPE` (lucide `Combine`), name, second line
  `v3 · blind raw candidates · rubric hidden` (latest-version summary), meta line
  `latest v3 · referenced by 4 studies · digest 3f9c…`, trailing `Archived` mark when archived.
- Pool row: eyebrow `MODEL POOL` (lucide `Boxes`), name, second line
  `v4 · 3 core · 2 challenger configurations`, meta line
  `latest v4 · referenced by 2 studies · digest a1d2…`.

Empty states name the entity's purpose and offer the create action; error and no-match states
mirror §5.2.

---

## 6. Policy Study detail (`/lab/studies/:studyId`)

The detail is a **routed dossier**: one scrollable document with an in-page section nav. It is not
an overlay, not a context sheet, and not a tab set. Tabs hide evidence and invite inert panels
(the phase-c prototype shipped four empty ones); a dossier keeps the verdict physically adjacent
to the evidence that earned it and gives browser find-in-page the whole record. (§14.1.)

### 6.1 Page composition (completed/confirmed study, the richest case)

```
Breadcrumb: Lab / Policy Studies                      (links; text-xs)
────────────────────────────────────────────────────────────────────
Identity header
Verdict banner                                        (#verdict)
Sealed inputs                                         (#inputs)
Stage A — Recipe-family elimination                   (#stage-a)
Stage B — Pair screening & holdout comparison         (#stage-b)
Stage C — Sensitivity & cross-checks                  (#stage-c)
Policy Playbook                                       (#playbook)
Evidence boundary                                     (#boundary)
Records                                               (#records)
```

**≥1280px:** dossier column `max-w-[880px]`; a sticky section nav (`w-[200px]`, `top-16`,
`text-xs`) sits to its right listing the anchors above, with the in-view section marked by a 2px
accent left bar and `aria-current="location"`. **1024px and below:** the section nav renders as a
horizontal, contained-scroll anchor row directly under the identity header; sticky nav is removed.

Each dossier section is a panel: `rounded-md border border-edge bg-panel`, header bar
`px-3 py-2 border-b border-edge` with a section-header-style title and the section's own
`StatusMark` where lifecycle applies.

### 6.2 Identity header

```
[KindEyebrow POLICY STUDY]  [ClaimBadge]  [StatusMark]
Reliability policy across Frontend Reliability            (text-lg/xl, wraps)
study-policy-02 · definition 8c1f2a94 · schema v1          (font-mono text-xs text-text-muted)
[Confirmation-of chip, when confirmationOf ≠ null]
Actions: [Archive] (completed/failed) · [Delete draft] (untouched draft only)
         [Resume] (interrupted) · [Open Task Set backlink]
```

- **ClaimBadge** (new shared component, `src/ui/ClaimBadge.tsx`):
  `inline-flex min-h-[24px] items-center gap-1 rounded-sm px-2 text-xs font-semibold`.
  - Exploratory: `text-warning bg-warning/10 border border-dashed border-warning/50`, lucide
    `TestTubeDiagonal` icon, label **Exploratory**.
  - Confirmed: `text-success bg-success/10 border border-solid border-success/50`, lucide
    `ShieldCheck` icon, label **Confirmed**.
  Three redundant channels: hue, border style (dashed vs solid), icon+word. The badge never
  renders icon-only.
- **Confirmation-of chip:** `font-mono text-xs`, "Confirms study-policy-01 →" linking to the
  exploratory predecessor; the predecessor shows the inverse chip "Confirmed by study-policy-02 →".
- Study `StatusMark` maps: draft, in-progress (spinner), interrupted (warning), failed (error),
  completed (success), archived (muted). "Confirmed" is a **claim**, not a status — it appears in
  the ClaimBadge, never in the StatusMark, and the two are never merged into one pill.

### 6.3 Verdict banner (`#verdict`)

Rendered **only** when a report/playbook exists. A full-width panel carrying the claim frame:
`claim-frame-exploratory` or `claim-frame-confirmed` per claim level, `rounded-md p-3`.

```
[ClaimBadge]  RECOMMENDATION eyebrow
"Adopt Refine"  /  "Do not fuse"                       (text-lg font-semibold)
One-sentence rationale (text-sm text-text-secondary):
  "Refine exceeds the predeclared MPID on holdout tasks at 2.6× policy cost;
   Fuse remains within uncertainty and is not justified."
Footer row (font-mono text-xs): policy cost 2.6× · exp. cost $62.40 ·
  pool adequacy: met · [Jump to playbook ↓]
```

- `do_not_fuse` renders with the same visual weight as any adoption verdict — same panel, same
  type scale. It is a finding, not a failure; it must never use the `error` role.
- Exploratory verdicts prepend a mandatory copy line inside the banner:
  "Exploratory finding — confirm on a fresh Task Set Version before adopting." Confirmed verdicts
  instead carry: "Confirmed on Task Set v7 (fresh holdout) — scope: this pinned configuration and
  workload only."
- The banner always includes both costs and the pool-adequacy qualifier (principle 2).

In-progress/draft/failed studies render **no** verdict banner and no skeleton for one. Absence is
the honest state.

### 6.4 Sealed inputs (`#inputs`)

A definition grid, 3 columns at ≥1024 (`grid gap-px bg-edge` cells `bg-panel p-3`), 1 column at
≤768:

| Cell | Content |
|---|---|
| Workload | link chip → Task Set Version route: `Frontend Reliability · Task Set v6 · 48 tasks`, digest short `3f9c…` |
| Model Pool | link chip → `/lab/model-pools/:poolId/versions/:v`: `Reliability challengers · Pool v4 · 5 configs` |
| Fusion Recipes | one link chip per pinned recipe version (≤3 per row, wrap): `Blind Raw v3`, `Analysis Scores v2` |
| Judges | Judge 1 / Judge 2 as `CompactModelLabel` rows, marked `blind` |
| Rubric | `RubricRefChip` → rubric route, `Rubric v3` |
| Protocol | `font-mono` chips: `protocol p-17` · `MPID 3.0 (predeclared)` · `stage protocol v2` · `claim plan: exploration` |

All chips reuse the `RubricRefChip` visual grammar (bordered `rounded-sm px-1 py-0.5 text-xs`
link chips). While the study is a **draft**, this section is the editor (§10); from seal onward it
renders read-only with a header note: `Sealed at 2026-08-10 14:02 · fingerprint 8c1f2a94` and no
form affordances of any kind.

Every pinned ref that resolves is a working link. A ref to an **archived** asset stays a working
link and gains a muted `archived` suffix chip. A ref that cannot resolve renders as a non-link
with an `error`-role inline note: "pool-77 v4 — not found in this database" (possible after a
partial import); it never renders as a dead link.

### 6.5 Stage sections (`#stage-a`, `#stage-b`, `#stage-c`)

Each stage panel header: stage name, purpose subtitle (`text-xs text-text-secondary`), stage
`StatusMark` (pending → not yet rendered, running, interrupted, failed, completed), and the
stage's experimental cost to date (`font-mono text-xs`, e.g. `exp. $18.20 · 412k tokens`).
Stages that have not started **do not render** — the dossier grows as the study runs. A study
in Stage B shows Stage A (complete) and Stage B (running), nothing for Stage C.

**Stage A — Recipe-family elimination.** Subtitle: "Eliminates recipe families. No winner is
crowned here." Content:

- Family results table (contained-scroll region, §8): columns Family, Recipe versions, Blocked
  outcome mean, Verdict (`survives` / `eliminated` — icon+word: `ArrowRight`/`XCircle` with text),
  Trials, Failures.
- Eliminated families remain permanently visible with their elimination reason
  (`text-xs text-text-secondary` under the row via a disclosure).
- A closing line, mandatory copy: "Stage A output: N surviving families. Stage A never selects a
  winning policy."

**Stage B — Pair screening & holdout comparison.** The evidentiary core; three blocks in order:

1. **Screened pairs** — the **full** pair table including losers, in a labeled contained-scroll
   region (`aria-label="Screened pairs — scrollable"`). Columns: Pair (two `CompactModelLabel`s),
   Selection headroom, Synthesis headroom, Screen verdict (`shortlisted` / `screened out`,
   icon+word), Retries, Failures. Shortlisted rows get `bg-accent/5` **plus** the verdict cell —
   background alone is never the signal. A count line above the table: "24 pairs screened · 3
   shortlisted · 21 screened out" so the losers are numerically present even before scrolling.
   **Pool adequacy** renders as a one-line qualifier directly under this table
   (`met` in success role / `limited: <reason>` in warning role, icon+word), because adequacy is
   a property of what was screened.
2. **Holdout policy comparison** — the policy table (§6.6).
3. **Uncertainty & MPID** — verdict block (§6.7).

**Stage C — Sensitivity & cross-checks.** Two tables in the same grammar: recipe-sensitivity
(rows = recipe versions, columns = outcome delta, verdict `robust`/`sensitive` icon+word) and
synthesizer cross-check (rows = synthesizer swaps, outcome delta, verdict). A closing sensitivity
summary sentence feeds the playbook.

**Blind labels:** while any stage is unjudged, candidate identities in stage tables render as
blind tokens: `font-mono text-text-muted`, e.g. `candidate-A`, with a header note "Blind — labels
resolve after judging." After judging resolves, real `CompactModelLabel`s replace tokens. There is
no UI to peek early.

### 6.6 Policy comparison table

One table, always all four policies, rows in fixed order: `Best fixed`, `Rank`, `Fuse`, `Refine`.
Columns (7 — the cap, §13):

| # | Column | Format |
|---|---|---|
| 1 | Policy | `text-sm font-semibold`; recommended row prefixed with lucide `BadgeCheck` + the word **Recommended** (`text-accent`, icon+word) |
| 2 | Configuration | `font-mono text-xs` (e.g. `Blind Raw v3 · pair A×C`) |
| 3 | Mean outcome | `font-mono tabular-nums`, blocked-holdout mean |
| 4 | Δ vs best fixed | `font-mono tabular-nums`, signed (`+0.42` / `−0.13`); `—` on the best-fixed row |
| 5 | MPID verdict | icon+word: `exceeds MPID` (success), `within uncertainty` (muted), `below` (muted). Never a bare checkmark. |
| 6 | Policy cost | `font-mono`, multiplier vs best fixed (`1.0×`, `2.6×`) |
| 7 | Trials / failures | `font-mono text-xs`, e.g. `6 · 1 failed` |

- The recommended row also carries `bg-accent/5`; background is supplementary to the
  icon+word marker in column 1.
- A `do_not_fuse` playbook shows **no** recommended marker on the Fuse row and marks
  `Best fixed` as recommended (or none, if the report abstains); the table never manufactures a
  winner the report didn't declare.
- Table caption (visually rendered above, `text-xs text-text-secondary`): "Blocked holdout tasks
  only · Task Set v6 holdout block · MPID 3.0 predeclared."
- At ≤768px this table transforms to stacked policy cards (§8.3) rather than shrinking below
  legibility.

### 6.7 Uncertainty & MPID block

A compact definition panel, not a chart:

```
UNCERTAINTY eyebrow
MPID (predeclared): 3.0                                (font-mono)
Paired verdicts:
  Refine vs Best fixed   +3.4   exceeds MPID           (icon+word, success)
  Fuse vs Best fixed     +1.1   within uncertainty      (icon+word, muted)
  Rank vs Best fixed     +0.4   within uncertainty      (icon+word, muted)
Method note (text-xs text-text-secondary): paired on identical holdout
  tasks; dependency-aware; retries never add samples.
```

"Within uncertainty" always uses the muted text role, never warning — inconclusiveness is normal
science, not a hazard.

### 6.8 Costs

Costs live in two places by design: inline (verdict banner, stage headers, policy table column 6)
and one consolidating **Costs** row inside the Playbook section, a 2-cell definition grid with
explicit definitions as visible copy:

- **Policy cost** — "what running the recommended policy costs per task, relative to best fixed":
  multiplier + absolute per-task token estimate.
- **Experimental cost** — "what this study cost to run": total dollars + tokens, with a per-stage
  breakdown disclosure (Stage A / B / C rows).

The two are never summed and never displayed in one figure.

### 6.9 Policy Playbook section (`#playbook`)

The playbook renders as an immutable record card inside the dossier, carrying the claim frame
(`claim-frame-*`) like the verdict banner:

1. Header: eyebrow `POLICY PLAYBOOK`, ClaimBadge, `font-mono text-xs` identity line
   (`playbook-7d3e · report schema v1 · created Aug 10 2026 14:31`).
2. **Scope statement**, mandatory copy, `text-sm`:
   > "This playbook describes evidence for one pinned policy configuration and workload scope. It
   > is not a global rule and never applies itself automatically."
3. Recommendation restated (same content as verdict banner; the banner links here).
4. Policy table (§6.6, same component instance may be reused via anchor rather than duplicated —
   implementation's choice; visually the playbook section must contain or immediately abut it).
5. Qualifiers: pool adequacy line; recipe-sensitivity finding sentence.
6. Costs grid (§6.8).
7. Supporting evidence: link list of exact Trial / Observation / Record refs (`font-mono text-xs`
   link chips, grouped by stage, contained-scroll list capped at `max-h-64` with `scroll-thin`).
8. Footer action (exploratory only): **Start confirmation study** — creates a confirmation-plan
   draft prefilled with this study's policy/configuration and requiring a *fresh* Task Set
   Version pick (the only unpinned field, per behavioral spec §5).

This section, addressed by `#playbook`, is also the presentation Compare's "Run with playbook"
picker opens read-only in a `DialogSurface` when the user inspects a candidate playbook. There is
no separate playbook route.

### 6.10 Evidence boundary section (`#boundary`)

A structural section, present on **every** study detail from seal onward. Top border uses
`.boundary-rule` across the full dossier width — the labeled dashed line *is* the boundary made
visible. Content: a two-sided ledger, `grid grid-cols-2` (stacking at ≤768):

| Stays in the Lab — policy evidence | May leave the Lab — via ordinary eligibility |
|---|---|
| Study observations, policy rows, playbook scores | Single-model candidate responses underlying trials |
| Rank selections, Fusion Results, Refined Results | — only through child-04 canonical Observation eligibility |
| Recipe comparisons, study conclusions | — reuse, never duplicate: same source identity = one Observation |
| *Never attributed — wholly, fractionally, or collectively — to any participating model.* | Link: "N candidate responses from this study qualified as canonical Observations →" (real count; renders `0 qualified` honestly when zero) |

Inline marker grammar, used **everywhere a model name appears inside stage tables and the policy
table**: model labels in policy-evidence contexts carry a trailing muted suffix chip
`policy evidence` (`text-[10px] font-mono uppercase text-text-muted border border-edge rounded-sm
px-1`). The chip has a `title`/`aria-label` of "This result is policy evidence about the
configuration, not evidence about this model." The boundary is thus legible at the point of every
model mention, not only in this section.

### 6.11 Records section (`#records`)

Exact secondary retrieval: a contained-scroll list (`max-h-96`) of `RecordRow` (table-cell or
list variant) entries for every Trial, Attempt lineage, Observation, and underlying Run this study
references, each linking to its Records destination. Grouped by stage; failed and retried entries
included with their `StatusMark`. Count line: "38 records · 3 failed · 2 treatment-changing
retries."

### 6.12 Study lifecycle states (detail-level)

| State | Rendering |
|---|---|
| **Draft** | Editor mode (§10). Eyebrow suffix `· Draft`. No verdict, stages, boundary, or records sections. |
| **In-progress** | Sealed inputs read-only; completed stages render; the running stage shows a progress line (`Stage B · 14 / 24 holdout tasks · $12.10 so far`) with a single `role="status" aria-live="polite"` region (§9.4). Global execution strip reflects the run as elsewhere in the app. |
| **Interrupted** | Warning-role banner directly under identity header: `StatusMark interrupted` + "Interrupted at Stage B — sealed work is preserved. Resume continues from the last sealed trial." + **Resume** button (`min-h-[44px]`). Completed evidence stays fully readable. |
| **Failed** | Error-role banner: exact failure ("Stage B failed — judge evaluator returned 429 after 4 retries"), with disclosure to the failing trial's record link. Actions: **Retry measurement** (measurement-only retry, creates a new observation) where applicable, and **Archive**. Completed stages remain readable — a failed study is still evidence. |
| **Completed (exploratory)** | Full dossier; exploratory claim frames; playbook footer offers **Start confirmation study**. |
| **Confirmed** | Full dossier; confirmed claim frames; confirmation-of lineage chips both directions. |
| **Archived** | Read-only; muted identity header with explicit `Archived` StatusMark + archive date; a slim banner "Archived — read-only. All links remain resolvable." No unarchive in v1 (Decision D5). |
| **Unknown ID** | Standard route-level not-found panel: eyebrow `NOT FOUND`, "No policy study with id `study-x9…` exists in this database.", links to `/lab` and to Records search. Never an empty dossier skeleton. |

---

## 7. Recipes and Model Pools

### 7.1 Version route anatomy (`/lab/recipes/:recipeId/versions/:version`, pools analogous)

Both are immutable record pages sharing one layout:

1. **Breadcrumb:** Lab / Fusion Recipes / Blind Raw.
2. **Identity header:** eyebrow (`FUSION RECIPE` / `MODEL POOL`), name + `v3`
   (`font-mono`), digest short with copy button, created timestamp, `Archived` StatusMark when the
   parent record is archived.
3. **Version rail:** horizontal chip list of all versions (`v1 v2 v3`), current one
   `aria-current="page"`; superseded versions carry a muted `superseded` suffix. Every chip is a
   working link — archived records' versions included.
4. **Payload panel** (recipe): family, prompt version, judge-analysis mode, rubric access,
   verification instructions (rendered as text, never HTML), exact synthesizer as
   `CompactModelLabel`, canonical payload digest. Fields are read-only record rows, not inputs.
   **Payload panel** (pool): member table — columns Configuration (`CompactModelLabel`), Role
   (`core` / `challenger`, icon+word: `Anchor`/`Swords`), Provider, Exact settings digest;
   below it the diversity checklist (checked items as icon+word list) and rationale text.
   Mandatory pool copy, `text-xs text-text-secondary`: "A pool is a selection manifest. It never
   merges model evidence or implies comparability."
5. **Referenced-by:** list of studies pinning this exact version (RecordRows). If none:
   "Not referenced by any study yet." (text, not an empty card).
6. **Actions:** **New version from this** (opens the version editor prefilled — editing always
   creates a new version; there is no Edit action on any version), **Archive record** /
   none if already archived. A referenced version's page states: "This exact version is referenced
   by 4 studies and can never be changed or deleted."

**Archived-asset state:** the page renders fully with the archived banner; links from studies keep
working (behavioral spec §6.1). **Unknown version:** not-found panel naming the id and version,
linking to the record's latest version if the record exists.

### 7.2 New Recipe / New Model Pool version editors

A `DialogSurface` for pools (member picker + roles + checklist) and a routed form page for recipes
(long-form instructions need room): `.../recipes/:recipeId/versions/new` is **not** a canonical
route and must not be — use a draft dialog or in-page editor without route change (Decision D4
recommends `DialogSurface` for both, full-height on mobile). Save action reads
**Create version vN** — never "Save changes", reinforcing immutability.

---

## 8. Tables, containment, and responsive behavior

### 8.1 Contained-scroll region (the only wide-table mechanism)

Every table that can exceed its container reuses the shipped `ResultMatrix` wrapper verbatim:

```html
<div role="region" aria-label="<Table name> — scrollable" tabindex="0"
     class="scroll-thin max-w-full overflow-x-auto rounded-md border border-edge
            focus:outline-none focus:ring-2 focus:ring-accent">
```

plus a visible label row above (`text-xs text-text-muted`): the table name and, when horizontally
scrollable, the suffix "· scrolls sideways". Sticky first column
(`sticky left-0 z-10 bg-panel`) for pair and family tables. Row pagination at 50 via the shared
`Pagination` component when a table exceeds 50 rows (screened pairs can).

### 8.2 Breakpoint behavior

| Width | Behavior |
|---|---|
| **1440** | Lab home: rail 220px + main 960px, centered. Study detail: dossier 880px + sticky section nav 200px. All tables typically fit; scroll regions activate only when content demands. |
| **1024** | Same two-column Lab home. Study detail loses the sticky nav (horizontal anchor row instead). Screened-pair table enters contained scroll. |
| **768** | Section rail → horizontal segmented nav. Sealed-inputs grid → 1 column. Boundary ledger stacks. Policy table still tabular inside contained scroll. |
| **390** | Policy table transforms to stacked cards (§8.3). Pair table remains a contained-scroll table (row transformation would destroy pairwise scanning); its sticky first column keeps pair identity visible. Summary strip stays 3-across with `text-base` values (it fits; verified against 3 mono metrics at 390/3 ≈ 130px cells). All touch targets ≥44×44. |

**200% zoom** (≈ half effective viewport): layouts must resolve to their next-narrower breakpoint
behavior with no document-level horizontal overflow; the only permitted horizontal scrolling is
inside labeled regions. `body { overflow: hidden }` app shell rules already prevent document
scroll; every Lab panel must use `min-w-0` on flex/grid children to avoid element-level overflow.

### 8.3 Policy-card transformation (≤768 for the policy table)

Each policy becomes a card (`rounded-md border border-edge bg-card p-3`, recommended card gets the
icon+word marker and `bg-accent/5`):

```
Fuse                                    [Recommended ✓ badge if so]
Blind Raw v3 · pair A×C                 (font-mono text-xs)
outcome 0.81 · Δ +1.1 · within uncertainty
policy cost 2.4× · 6 trials · 1 failed
```

Fixed order preserved; the four cards are a `role="list"`.

---

## 9. Accessibility

### 9.1 Keyboard flows (normative)

- **Lab home:** Tab order = header actions → section rail (or segmented nav) → summary strip is
  skipped (non-interactive) → filter row → study rows (each row one tab stop, Enter opens) →
  pagination. Visual order equals DOM order at every breakpoint.
- **Study detail:** breadcrumb → header actions → section nav links (jump links move focus to the
  target section's heading, which carries `tabindex="-1"`) → per-section interactive elements in
  reading order → table scroll regions are tab stops (`tabindex="0"`) and scroll with arrow keys.
- **Disclosures** (elimination reasons, cost breakdown, trial provenance): `<button
  aria-expanded>` with the shared `.disclosure-chevron`; Enter/Space toggle.
- **Dialogs** (seal confirmation, version editors, archive confirm, playbook inspect): all via
  `DialogSurface` (Base UI) — focus trap, background inert, Escape closes, focus returns to the
  invoking trigger. The seal-and-start dialog initially focuses its Cancel button, not the paid
  action.

### 9.2 Focus and navigation state

Direct load, refresh, and back/forward restore scroll position and move focus to the page heading
(`tabindex="-1"`) — matching existing route behavior. Anchor navigation within the dossier updates
the URL hash so refresh lands on the same section.

### 9.3 ARIA and semantics

- Tables are real `<table>` with `<caption class="sr-only">` mirroring the visible label, `scope`
  on headers. The policy-card transformation uses `role="list"`/`role="listitem"`.
- StatusMark/ClaimBadge always icon+text; icons `aria-hidden`, text is the accessible name.
- The `policy evidence` suffix chip exposes its full sentence via `aria-label`.
- Counts and verdict words are text content, never pseudo-element content.

### 9.4 Live regions (restrained)

Exactly one `role="status" aria-live="polite"` region per running study detail, announcing stage
transitions and coarse progress (per completed holdout block, not per token or per task). One
`aria-live="assertive"` region app-wide (the existing `GlobalExecutionStrip`) for
failure/interruption. No other Lab live regions. Progress percentages update visually without
announcement spam (the live region text changes at most once per stage-internal milestone).

### 9.5 Reduced motion

All Lab motion uses classes already neutralized by the `prefers-reduced-motion` block
(`.pressable`, `.motion-state`, `.animate-spin-ease`, `.disclosure-chevron`). The Lab adds no new
animated classes; therefore reduced motion needs no new rules. Spinners fall back to the static
icon + "Running" text (StatusMark already text-bearing).

### 9.6 Contrast

All text roles on `#121212`/`#0a0a0a` meet 4.5:1 (existing palette is compliant:
`#a1a1a1` on `#121212` ≈ 7.4:1; `#777777` is used only at ≥11px mono for non-essential metadata
and meets 3.9:1 — where muted text conveys required information (verdict words, status words),
use `text-text-secondary` minimum, never `text-text-muted`. Claim-frame tints at 5% opacity are
decorative; the badge text carries the information.

---

## 10. New Policy Study flow

**Entry points:** `New Policy Study` on `/lab`; **Start Policy Study** on a Task Set Version page
(§12); **Start confirmation study** on an exploratory playbook.

**Mechanism:** the button creates a draft `StudyRecord` immediately and routes to
`/lab/studies/:studyId` in draft-editor mode. No wizard dialog: pinning six kinds of versioned
inputs deserves a page, survives refresh via CAS draft revisions, and keeps one canonical route.
(§14.4.)

**Draft editor composition** — the dossier skeleton with only Identity + a six-part **Define
inputs** form replacing the Sealed inputs section:

1. **Title & question** — text inputs (the only free text).
2. **Workload** — Task Set Version picker (exact version required; shows manifest digest).
   Prefilled and locked-in-place (but re-pickable) when arriving via Task Set handoff.
3. **Model Pool** — pool version picker + inline "New Model Pool" affordance (§7.2 dialog).
4. **Fusion Recipes** — multi-select of recipe versions.
5. **Judges & Rubric** — two exact model configuration pickers (marked blind) + rubric version.
6. **Protocol & claim plan** — policies (all four preselected, read-only in v1 — the staged
   protocol compares all four; Decision D2), MPID display (predeclared by protocol fingerprint),
   and the **claim plan** choice rendered as two large radio cards (not a toggle):
   - **Exploration** — warning-role card, dashed border: "Find whether a policy is worth
     confirming. Findings will be marked Exploratory."
   - **Confirmation** — success-role card, solid border, enabled only with a `confirmationOf`
     source; requires a *fresh* Task Set Version (validated: must differ from the source study's
     workload version) and shows the inherited, non-editable policy/configuration.
   The claim-level visual language thus starts at creation.

Footer bar (sticky at ≤768): draft save state (`Saved · revision 4`, CAS-backed, `role="status"`),
**Delete draft** (untouched drafts only — the button is absent, not disabled, once any input has
been pinned and saved), and the primary **Seal inputs & start study**.

**Seal confirmation dialog** (`DialogSurface`): restates every pinned ref with digests, the claim
plan (with ClaimBadge), an estimated experimental cost line marked *estimate*, and the mandatory
sentence "Sealing is permanent. Treatment changes after this point create new trials — the
definition can never be edited." Confirm button reads **Seal & start** and is the paid-execution
boundary. Zero provider calls occur before this confirmation.

Validation errors render inline per field (`text-error text-xs` + `AlertTriangle`, error text
adjacent to the field), and the seal button lists unmet requirements in plain text above itself
when pressed while invalid — never a silent disabled state.

---

## 11. Legacy route removal and migration UX

### 11.1 Retired route (`/evaluations/:suiteId/fusion/:studyId`)

No redirect. The app's not-found handler special-cases the retired *shape* to render an honest
retirement panel (a 404-class view, not a route):

```
Eyebrow: ROUTE RETIRED
"Fusion Study pages no longer exist."
"Policy research moved to the Research Lab. Studies now live at their own
 addresses under /lab/studies. Old links, including this one, were retired
 in the Lab migration and do not forward."
Actions: [Open the Lab] → /lab      [Open Records] → records search
```

The panel must not fetch, resolve, or guess the study id — it links to `/lab`, where the migrated
study is findable by title. This is a static explanation with links, which is not a redirect.

### 11.2 Migration-blocked state

When migration preflight fails, all `/lab*` routes render a full-column blocking panel (the rest
of the app remains usable; the source database is untouched — say so):

```
[AlertTriangle error-role]  MIGRATION BLOCKED eyebrow
"The Lab migration could not complete. No data was changed."
Diagnostics (contained-scroll list, max-h-96, font-mono text-xs):
  fusionStudies / study-7f2e — unmappable Task Set Version (suite crosswalk missing)
  fusionTrials  / trial-a91c — corrupt artifact ref
  … (exact entity type / id / reason code per behavioral spec §14; never echoes payload content)
Counts: 2 blocking records of 214 scanned.
Actions: [Retry preflight]  [Copy diagnostics]  [What this means →] (docs)
```

Reason codes render as stable `font-mono` identifiers plus a one-line human sentence. This state
is terminal until resolved — no "continue anyway", no partial Lab.

### 11.3 Unsupported v2 archive import

The existing `DataArchiveActions` preview flow gains one rejection rendering: format
`unsupported_fusion_archive_shape`, copy "This archive contains retired Fusion Study collections
(`fusionStudies`, `fusionPlaybooks`) and cannot be imported. Export a new archive from an upgraded
RSemble instead." Collection type names only; no content echo. Single action: Close.

---

## 12. Task Set contextual handoff

On a Task Set Version page (Evaluations workspace), an optional block renders **only when the Lab
is functional and migration is unblocked**:

- **Start Policy Study** button (`min-h-[44px]`, secondary style: `border border-edge bg-panel
  hover:border-edge-bright`) with subtitle `text-xs text-text-muted`: "Pins Task Set v6 exactly.
  The study lives in the Lab." Clicking creates the draft with workload prefilled (§10) and
  routes to `/lab/studies/:studyId`.
- **Referencing studies** list: RecordRows of studies pinning any version of this Task Set, each
  showing the pinned version chip. Empty: the block shows only the button (no "no studies" card).

The block is a backlink surface — no study lifecycle controls, no playbook rendering, no
study-status management ever appears inside Evaluations.

---

## 13. Densification caps (assertable)

1. Lab section rail: exactly 3 entries.
2. Summary strip: exactly 3 metrics.
3. Study list row: ≤3 identity elements (eyebrow, ClaimBadge, StatusMark), exactly 1 title line,
   1 finding/state line, 1 meta line; 0 additional chips.
4. Policy comparison table: ≤7 columns; any Lab table exceeding 7 columns must instead split or
   move columns behind a row disclosure.
5. Any Lab table wider than its container: must sit in the labeled contained-scroll region;
   >50 rows: must paginate at 50.
6. Study dossier: ≤9 top-level sections (the eight in §6.1 plus at most one lifecycle banner);
   section nav shows all sections, no nesting beyond one level.
7. Pinned-input cells: ≤3 chips per row before wrapping.
8. Live regions per Lab route: ≤1 polite (plus the app-global assertive strip).
9. Claim frames (`claim-frame-*`): at most 2 instances per study detail (verdict banner +
   playbook card). The frame stays rare so it stays meaningful.
10. Dossier reading measure: content column `max-w-[880px]`; body copy blocks `max-w-[65ch]`.

---

## 14. Explorations — considered and rejected

### 14.1 Tabbed study detail (prototype's Claim / Table / Stages / Limits / Records)
Rejected. Tabs sever the verdict from its evidence, defeat find-in-page and printing, and — as the
phase-c prototype itself demonstrated by shipping four contentless panels — structurally invite
inert surfaces. The dossier makes "no placeholder panels" true by construction: sections that have
no content do not render.

### 14.2 Overlay/context-sheet study detail
Rejected. The prototype opened studies in a scrim overlay. A Policy Study is the Lab's primary
record with a canonical route contract (direct load, refresh, back/forward, focus/scroll
restoration). Overlays fight all of that. Only sub-tasks (seal confirmation, version editors,
playbook inspection from Compare) use dialogs.

### 14.3 "Policy quality and policy cost shown separately"
Rejected as a display principle (kept only as a *bookkeeping* separation between policy cost and
experimental cost, which are genuinely different quantities). The prior pass separated quality
tables from cost panels; that produces the classic benchmark-reading failure where a +1.1 lift is
adopted without registering its 2.6× cost. Cost is a column of the policy table and a line of the
verdict banner — always in the same glance as quality.

### 14.4 Wizard-dialog study creation
Rejected in favor of the routed draft editor. Six versioned pickers in a modal either scroll
miserably at 390px or fragment into steps that hide earlier choices; a CAS-revisioned draft page
survives refresh, is linkable, and makes "delete only untouched drafts" straightforwardly
renderable.

### 14.5 A dedicated "Findings" feed as the Lab home
Seriously considered: `/lab` as a reverse-chronological feed of playbook verdict cards, with
studies as the secondary list. Rejected for v1 because it duplicates each finding surface
(feed card + dossier verdict + playbook card = three renderings to keep honest), and the study
list's finding sentence already gives the home page a findings-first read at lower cost. Worth
revisiting if study counts grow past dozens. On record as the strongest rejected alternative.

### 14.6 Uncertainty visualization (interval bars / forest plots)
Rejected for v1. Plots of paired deltas with MPID reference lines are attractive but demand a
charting dependency, careful reduced-motion/contrast work, and non-color encodings — for exactly
three paired comparisons. The textual verdict grammar (`exceeds MPID` / `within uncertainty`) is
more honest at this n. Revisit when Stage B produces per-block distributions worth showing.

### 14.7 Claim level as watermark/background tinting of the whole page
Rejected. Page-wide tinting degrades contrast, breaks the "claim frames are rare" rule, and turns
a precise epistemic marker into ambience. The dashed/solid frame + badge + mandatory copy triad is
narrower and testable.

### 14.8 Reusing the `error` role for `do_not_fuse`
Rejected explicitly (it appeared in earlier internal sketches as red styling). `do_not_fuse` is a
successful study outcome and renders in the verdict's normal claim framing.

---

## 15. Decision points and recommended defaults

| # | Decision | Options | Recommended default |
|---|---|---|---|
| D1 | Study list default sort | `updatedAt` desc vs status-grouped (active first) | **`updatedAt` desc** — matches Runs/Compare; the summary strip already surfaces active counts. |
| D2 | Policy subset selection at creation | Allow deselecting policies vs fixed all-four | **Fixed all-four, read-only display** — the staged protocol's comparisons assume the full set; expose subsetting only if the behavioral spec later permits it. |
| D3 | Blind-label reveal | Automatic on judging completion vs explicit "Reveal labels" action | **Automatic** — resolution timing is a protocol fact, not a user choice; an explicit action implies discretion that doesn't exist. |
| D4 | Recipe/pool version editors | Dialog vs routed page | **`DialogSurface` for both** (full-height sheet at ≤768) — keeps canonical routes exactly as contracted; recipe instructions get a `max-h` scrollable textarea. |
| D5 | Unarchive | Support unarchive for studies/records | **No unarchive in v1** — archive is presented as terminal; adding unarchive later is additive. |
| D6 | Section nav highlight mechanism | IntersectionObserver scroll-spy vs hash-only | **Scroll-spy with hash fallback** — `aria-current="location"` updates on scroll; reduced-motion unaffected (no smooth-scroll; jumps are instant when `prefers-reduced-motion`). |
| D7 | Playbook inspection from Compare | Dialog rendering §6.9 vs navigating to the study | **Dialog (read-only §6.9 rendering)** with a "Open full study" link — keeps the Compare configuration flow intact. |
| D8 | Cost currency display | Dollars only vs dollars + tokens everywhere | **Dollars primary, tokens in disclosure** except stage headers which show both inline — dollars decide, tokens audit. |

---

## 16. Acceptance criteria

Token and class assertions:

1. Lab components introduce no colors outside the tailwind palette in
   `design-token-contract.test.ts`; grep for raw hex in `src/workspaces/lab/**` returns only
   values already present in `src/index.css`/`tailwind.config.js` (ideally none).
2. `.claim-frame-exploratory`, `.claim-frame-confirmed`, and `.boundary-rule` exist in
   `src/index.css` with exactly the values in §4.3.
3. No Lab file matches `transition-all`, `\bease-in\b(?!-out)`, or `scale(0)` (existing motion
   contract scan passes unchanged); no `hover:-translate` or `hover:scale` on Lab record rows.
4. All Lab durations reference `--motion-fast/short/medium` and `--ease-out-ui`; no new keyframes.

Route and composition assertions:

5. Exactly the six canonical routes render Lab content; `/lab` renders the studies list; no route
   or link contains `suiteId`, `taskSetId`, or the string "fusion study" (case-insensitive) in
   paths.
6. `/evaluations/:suiteId/fusion/:studyId` renders the retirement panel (§11.1) with HTTP-style
   not-found semantics and performs no navigation side effect; asserting `window.location` after
   load shows the original URL.
7. Section rail has exactly 3 entries with `aria-current="page"` on the active one; no
   Routing/Judge/Workflow entry, control, enum string, or route exists anywhere in Lab UI code.
8. Study detail renders as one document: zero `role="tab"` elements on the route; every section
   in §6.1 that has data renders, and no section renders without data (no empty panels, no
   skeletons for absent verdicts).

State honesty:

9. Each required state — first-use, draft, in-progress, interrupted, failed, completed
   (exploratory), confirmed, archived, migration-blocked, unknown-ID, archived-asset,
   unresolvable-ref — has a distinct rendering matching §5.2/§6.12/§7.1/§11.2, verifiable by
   text content (state words are real DOM text, not color).
10. A `do_not_fuse` playbook renders the verdict banner with claim framing (not error role) and
    no `Recommended` marker on the Fuse row.
11. Stage tables show eliminated families, screened-out pairs, retries, and failures with real
    counts; the screened-pairs count line matches row totals.
12. The evidence boundary section exists on every sealed study; every model label inside policy
    tables carries the `policy evidence` suffix chip with its aria-label; the "qualified as
    canonical Observations" link shows a real count including `0`.
13. Exploratory and confirmed studies differ simultaneously in badge text, icon, border-style
    (dashed vs solid, computable from `border-style`), and mandatory copy sentence — assert all
    four channels.

Focus, keyboard, ARIA:

14. Every dialog is `DialogSurface`-based: focus trapped, backdrop present, Escape closes, focus
    returns to the trigger (assert `document.activeElement`).
15. Table scroll regions have `role="region"`, an `aria-label` ending in "— scrollable",
    `tabindex="0"`, and a visible focus ring; tables have captions and header scopes.
16. Tab order equals visual order on `/lab` and study detail at all four widths; section-nav
    jumps move focus to headings with `tabindex="-1"`.
17. At most one polite live region per Lab route; stage progress announcements change text at
    milestone granularity only.

Responsive and touch:

18. At 1440/1024/768/390 and at 200% zoom: `document.scrollingElement.scrollWidth <=
    clientWidth`, and no element outside labeled scroll regions overflows horizontally.
19. All interactive elements measure ≥44×44 CSS px (including `.button`-styled links, disclosure
    buttons, version chips); interactive siblings ≥8px apart.
20. At ≤768 the policy table renders as the card list (`role="list"` with 4 items in fixed
    order); at 390 the screened-pair table remains a contained-scroll table with a sticky first
    column.

Caps:

21. All ten densification caps in §13 hold (each is countable in the DOM).

No inert surfaces:

22. Every rendered button/link has a working handler or href; automated sweep finds zero
    `disabled` controls without adjacent visible explanation text, zero empty cards, and zero
    "coming soon"/placeholder strings in Lab routes.

---

## 17. Component inventory (build list)

New shared primitives: `ClaimBadge` (§6.2), `PolicyEvidenceChip` (§6.10), `VerdictBanner` (§6.3),
`PinnedRefChip` (generalizing `RubricRefChip`'s grammar to task set / pool / recipe / judge refs,
including archived and unresolvable states), `StageSection` shell (§6.5), `PolicyTable` with its
card transformation (§6.6, §8.3), `BoundaryLedger` (§6.10), `MigrationBlockedPanel` (§11.2),
`RouteRetiredPanel` (§11.1). Extended: `KindEyebrow` (+`study`, `recipe`, `pool` kinds),
`StatusMark` (+`archived` if absent). Reused unchanged: `RecordRow`, `DialogSurface`,
`CompactModelLabel`, `Pagination`, `EvidenceReceipt`, contained-scroll wrapper pattern,
`GlobalExecutionStrip`.
