# Models Workspace UI Design Specification

**Version:** 1.0.0
**Date:** 2026-08-20
**Status:** Design authority for the Models workspace, alongside the behavioral contract
[`model-evidence-profiles-spec.md`](./model-evidence-profiles-spec.md). Where the two appear to
conflict, the behavioral spec wins on *what exists and what it means*; this document wins on *how
it looks, reads, moves, and responds*.
**Sits beside:** the Research Lab spec
(`../06-research-lab-policy-studies/ui-design-spec.md`) and the canonical shell spec
(`../08-workbench-shell-and-records/workbench-shell-and-records-spec.md`), whose grammar (claim
frames, honesty tokens, Records backlinks) this document reuses rather than forks.
**Reconciliation note:** the behavioral spec is numbered "Order: 06" in its header but lives in
`07-model-evidence-profiles/`; this document follows the folder and program ordering (Child 07).
No other product decision is open.

---

## 1. Scope

This document specifies:

- `/models` — the Models list: exact configurations, filters, and the Saved rollups section
- `/models/:modelConfigurationId` — the exact configuration profile, seven sections
- `/models/:modelConfigurationId/evidence/:observationId` — observation drilldown
- `/models/rollups/:rollupId/versions/:version` — **visual language only** (forward-looking;
  the rollup repository ships later; the presentation grammar is settled now so the list page's
  Saved rollups rows have a defined destination)
- The shared evidence grammar: honest quantities, cohort blocks, uncertainty states, claim marks,
  deterministic narrative, paired comparison, evidence table

It does not respecify Tasks, Rubrics, Records, or the Lab. It assumes the shell spec's
four-destination navigation and honesty-token system.

---

## 2. Design principles

1. **The exact configuration is the only respondent.** Headlines, titles, and rows name provider +
   requested slug + resolved version (or the alias window when none was reported). A marketing
   name never headlines, never groups, never aggregates. Where the version is unknown, the UI
   says *when* it was observed instead of pretending to know *what* it was.
2. **Unavailable is designed; zero is data.** Every quantity the backend emits is a three-state
   `HonestQuantity` (`available` / `limited` / `unavailable`). The UI renders all three as
   distinct, word-bearing states and never collapses `unavailable` into `0`, `—`, or an empty
   cell. Missingness is content, styled with the same care as numbers.
3. **Cohorts never average away.** A metric exists only inside its verifier or Rubric cohort.
   Heterogeneous cohorts render as adjacent blocks — never one pooled number, never a dropdown
   that hides one. If a metric cannot satisfy the cohort rules, the evidence renders without the
   metric and says why.
4. **Small samples look small.** Below five resolved independent units there is no interval, no
   `±0`, no substitute precision — one designed insufficient-coverage state with the unit count
   and the requirement stated. Uncertainty always travels with its unit kind, assumption, rule
   versions, and assignment digest.
5. **Every claim is a link.** Deterministic claim sentences and narrative lines are each bound to
   the metric/filter that produced them; clicking narrows the evidence table. The workspace
   contains no sentence that cannot be drilled, and no drilldown that cannot be returned from.
6. **No rank, no score, no leaderboard — by shape, not by restraint.** There is no global ordering
   control, no sortable "score" column, no cross-model summary anywhere in the workspace. The
   prohibited vocabulary of behavioral §10 is enforced by tests (§16), not by reviewer vigilance.
7. **Attempts are not samples.** Attempt counts render only inside provenance contexts (attempt
   ledgers, retry lineage), never adjacent to statistical language, never as `n`.
8. **Same grammar as the workbench.** `RecordRow`, `KindEyebrow`, `StatusMark`,
   `CompactModelLabel`, `DialogSurface`, contained-scroll regions, pagination-at-50, the Lab's
   claim-frame and the shell's honesty-token systems are reused. Models adds a small named set of
   primitives (§5) and no new colors, easing curves, or keyframes.

---

## 3. Information architecture

### 3.1 Layering

| Layer | Content | Where |
|---|---|---|
| **Default** | Exact configuration rows with identity, version status, window, coverage counts, top families/gaps, latest activity | `/models` |
| **Secondary** | Saved rollups (clearly separate section); profile sections 1–2 (identity, coverage) | `/models` lower section; profile top |
| **On demand** | Family cohort blocks, claims, paired comparison, evidence table, protocols/limitations, observation drilldown, rollup shelves | Profile sections 3–7, drilldown route, rollup route |

### 3.2 Routes

```text
/models                                              list (exact configurations + Saved rollups)
/models/:modelConfigurationId                        profile (seven sections)
/models/:modelConfigurationId/evidence/:observationId  observation drilldown
/models/rollups/:rollupId/versions/:version          rollup presentation (visual contract now)
```

Filter state lives in the URL query string (`?provider=…&family=…&class=…`) wherever practical,
so a narrowed view is linkable, refreshable, and back/forward-stable. The profile's active
narrowing (§7.4) is likewise reflected in the query string. Direct load, refresh, and focus
restoration follow the shell spec's rules: route-change focus lands on the page heading
(`tabindex="-1"`).

### 3.3 Naming

- Product noun: **Model Configuration** (eyebrow `MODEL CONFIGURATION`); running copy may say
  "configuration". Never "model profile of GPT-…" without the exact identity alongside.
- Evidence classes, verbatim: **Exploratory**, **Comparable**, **Verified**, **Benchmark anchor**.
- Eligibility, verbatim: **eligible** / **provisional** / **excluded** (+ reason code).
- Version status, verbatim: **Exact version** / **Rolling alias** / **Partial identity**.
- The rollup policy, verbatim: **Stratified only**.

---

## 4. Tokens

### 4.1 Existing tokens, unchanged

The full shipped system applies: canvas/shell `#0a0a0a`, panel/card `#121212`, card-hover
`#1a1a1a`, raised `#181818`, edge `#262626`, edge-bright `#3a3a3a`, accent `#00e5ff`, success
`#00ff9d`, warning `#ffb300`, error `#ff4d4d`, text `#ededed` / `#a1a1a1` / `#777777`; radii
`4/6/8px`; `shadow-popover`; Geist / Geist Mono; `--motion-fast/short/medium` (100/150/200ms);
`--ease-out-ui`. Program-level additions already ratified and reused here: the Lab's
`.claim-frame-*` / `.boundary-rule` grammar and the shell's `.honesty-note` microcopy class and
`honesty-copy.ts` module.

### 4.2 Semantic role assignments (binding)

| Meaning | Role | Redundant non-color channel (mandatory) |
|---|---|---|
| Evidence class: Exploratory | `warning` | word + dashed border on the chip |
| Evidence class: Comparable | `accent` | word |
| Evidence class: Verified | `success` | word + solid border on the chip |
| Evidence class: Benchmark anchor | `text-text-secondary` | word + `Anchor` icon |
| Eligibility: eligible | `success` | `Check` icon + word |
| Eligibility: provisional | `warning` | `CircleDashed` icon + word + reason code |
| Eligibility: excluded | `text-text-muted` | `XCircle` icon + word + reason code |
| Claim: strongest supported | `success` | `ShieldCheck` icon + word + source link |
| Claim: weakest supported | `error` | `ShieldAlert` icon + word + source link |
| Claim: mixed | `warning` | `Split` icon + word + source link |
| Claim: descriptive only | `text-text-secondary` | `FileText` icon + word + source link |
| Claim: missing | `text-text-muted` | `Minus` icon + word |
| Version status: exact | `text-text-secondary` | word ("Exact version") |
| Version status: rolling alias | `warning` | `Repeat` icon + word + observed window |
| Version status: partial identity | `warning` | `CircleAlert` icon + word |
| Insufficient coverage / unavailable | `text-text-muted` | word + icon; never a number |
| Paired outcomes: win / tie / loss | `success` / `text-text-secondary` / `error` | letters W / T / L inside each glyph |

Weakest-supported uses the error role deliberately: it is a *verified negative* (interval wholly
inside the pre-declared unsupported region), not a stylistic red. No new hues are introduced.

### 4.3 New CSS

**None.** Every pattern in this document composes existing utilities (`.pressable`,
`.motion-state`, `.scroll-thin`, `.honesty-note`, `.boundary-rule`, `.claim-frame-*`) and Tailwind
classes. The motion contract (`src/ui/motion-contract.test.ts`) passes unchanged: no
`transition-all`, no bare `ease-in`, no `scale(0)`, no hover-transforms on record rows, no new
keyframes. Any future chart addition must pass this document's chart rule (§7.7) before it is
permitted a token.

---

## 5. Grammar extensions (shared primitives for this workspace)

### 5.1 `HonestValue` — the workspace's atom

Renders one `HonestQuantity`. Fixed presentation:

- `available` → value in `font-mono tabular-nums text-text`.
- `limited` → value in mono + inline suffix `limited` (`text-[10px] font-mono uppercase
  text-warning border border-dashed border-warning/40 rounded-sm px-1`) + the reason as
  `title`/`aria-describedby` text; the unresolved count renders in parentheses:
  `312 (14 unresolved)`.
- `unavailable` → the word **Unavailable** in `text-text-muted`, with the reason in an
  `honesty-note` line directly beneath the label (never a tooltip-only disclosure).

Rules: the three states never share a rendering; `unavailable` never renders a numeral; `limited`
never hides its unresolved count. Labels are static text (`text-xs text-text-secondary`), values
never truncate — they wrap.

### 5.2 `VersionStatusChip`

`inline-flex min-h-[24px] items-center gap-1 rounded-sm px-2 text-xs font-semibold`, per §4.2.
Rolling alias always carries its window: `Rolling alias · May–Aug 2026`. Partial identity carries
the missing dimension: `Partial identity · no resolved version`. The chip never renders icon-only.

### 5.3 `EvidenceMixChips`

A row of up to four count chips, one per evidence class, in fixed order (Exploratory, Comparable,
Verified, Benchmark anchor), each `font-mono text-xs` with the class word: `12 exploratory ·
8 comparable · 5 verified · 2 benchmark`. Zero-count classes render dimmed (`opacity-50`) rather
than disappearing — absence of a class is itself legible.

### 5.4 `CohortBlock`

One metric inside one commensurate cohort. Fixed anatomy:

```
[cohort ref chip: Rubric v3 · rub-eval@2  or  verifier cohort X · ver-code@4]
value          → 71.2            (font-mono text-lg tabular-nums)
                 or HonestValue non_aggregatable / unavailable state with its reason
interval       → 95% · 64.1–77.8 · 6 task-cluster units     (font-mono text-xs)
                 or the insufficient-coverage state (§5.5)
coverage line  → 8 of 10 tasks · 14 instances · 23 observations   (text-xs text-text-secondary)
```

Heterogeneous cohorts render as **adjacent `CohortBlock`s** — `grid grid-cols-1 lg:grid-cols-2
gap-2` inside the family card — with a one-line divider between groups:
`honesty-note` "Rubric cohorts are not commensurate; values are not pooled." Averaging controls do
not exist.

### 5.5 `InsufficientState`

The single designed state for `unitCount < 5`:

```
[CircleDashed muted icon]  Insufficient independent coverage for an interval
4 resolved task-cluster units · 5 required · resolver v1 · digest 9a2f…
```

Muted text role, static, no animation. It occupies the same slot an interval would occupy — the
layout never reflows when coverage crosses the threshold. The same component renders the
`non_aggregatable` states with their reason sentence ("Verifier definitions are incompatible;
pass rates are not pooled.").

### 5.6 `ClaimMark`

One deterministic claim: icon + word label (§4.2) + the claim sentence as a link button. Clicking
applies the claim's source filter to the evidence table (§7.6) and moves focus to the table's
heading. Each mark carries a `title`/accessible description of its boundary reference:
"Boundary declared by rubric rub-eval@2 before these results." Missing-label marks are not links.

### 5.7 `PairedGlyphStrip`

Wins/ties/losses as a lettered strip: one `size-6 rounded-sm border` glyph per comparable shared
task, containing `W`, `T`, or `L` (`font-mono text-xs`), ordered by canonical task id, with a
legend line: "W won · T tied · L lost — per shared task, task order fixed". Color is supplementary
(§4.2); the letter is the signal. The strip is a `role="list"` of `role="listitem"` glyphs whose
accessible names are full sentences ("Won on task code-transform-03").

### 5.8 `DeterministicNarrative`

A bordered-left block (`border-l-2 border-edge pl-3`), ≤5 sentences (cap, §12), each a button:
sentence text + trailing source chip (`font-mono text-[10px] text-text-muted`, the
`sourceMetricKey`). Clicking narrows the evidence table exactly as a `ClaimMark` does. The block
header reads `OVERVIEW — TEMPLATE-GENERATED`; its footer is an honesty-note: "Every sentence is
generated from fixed templates over the facts below. It adds no judgment."

---

## 6. `/models` — Models list

### 6.1 Header

Eyebrow `MODELS`, title "Models", count (`font-mono text-xs text-text-muted`, "14
configurations"), and the standing subtitle (`text-xs text-text-secondary`):

> "Exact model configurations with qualified evidence. No scores, no ranks — coverage, cohorts,
> and drilldown."

No primary action button: profiles are derived, not created. (Rollup creation arrives with the
rollup repository; the Saved rollups section header reserves its slot — the button renders only
when creation is implemented. Until then the slot stays empty; no disabled placeholder.)

### 6.2 Filters

Exactly eight filters (cap, §12), in this order, all standard selects except the text search:

| # | Filter | Options source |
|---|---|---|
| 1 | Search | text input, 200ms debounce (IDs, slugs, providers) |
| 2 | Provider | distinct `providerId` values |
| 3 | Model | distinct `requestedModel` values |
| 4 | Version status | Exact version / Rolling alias / Partial identity |
| 5 | Reasoning/tool signature | distinct effective-signature values |
| 6 | Evidence class | the four classes (configurations having ≥1 observation in class) |
| 7 | Family/facet | distinct covered families |
| 8 | Recency | Active last 7 / 30 / 90 days / any |

Desktop (≥lg): always-visible 2-column grid in a `border border-edge rounded-md bg-panel p-3`
region, mirroring `RunFilters`. Mobile: collapsible sheet with applied-count badge. Complete-set
filtering before pagination, deterministic sort (canonical identity sort from the catalog module:
provider → requested model → resolved identity → id), one optional non-score toggle: "Latest
activity" ordering. No other sort controls exist.

### 6.3 Exact configuration row

`RecordRow` list variant, whole row is the link to the profile. Anatomy (cap: 3 text lines + 3
identity elements):

```
[KindEyebrow: Cpu icon + MODEL CONFIGURATION]   [VersionStatusChip]   [latest activity, mono]
Title: CompactModelLabel (provider · requested slug · resolved version if known)
Line 2: window + coverage — "May–Aug 2026 · 38 tasks · 112 eligible observations"
        (both as HonestValue semantics; when coverage is unavailable: "coverage unavailable")
Line 3: families + gaps — "Top: code-transformation, summarization · No evidence: 6 families"
```

- "Top covered families" lists at most two names (cap); "major gaps" names at most one gap count.
  Everything else lives on the profile.
- Rows with **zero qualified observations** still render (a configuration that ran but produced
  nothing eligible is real): line 2 reads "0 eligible observations · exploratory only" or the
  unavailable state. They sort normally; filters may exclude them.
- Long slugs/signatures: `CompactModelLabel` middle-ellipsis in rows; full identity wraps on the
  profile.

### 6.4 Saved rollups section

Physically separate: a full-width `.boundary-rule` divider with the label
`SAVED ROLLUPS — STRATIFIED ONLY`, then a normal section (heading, count, subtitle honesty-note):
"A rollup is a pinned list of exact configurations viewed side by side. It is not a model and
never pools evidence."

Rows: `RecordRow` variant with eyebrow `ROLLUP` (`Layers` icon), name + `v2` (`font-mono`), meta
line `4 members · stratified only · created Aug 12`, linking to the rollup route (§9). Archived
rollups behind a "Show archived (n)" toggle, matching the Lab's studies list.

Empty: "No saved rollups." + one-line purpose sentence. No create affordance until implemented
(§6.1).

### 6.5 List states

| State | Rendering |
|---|---|
| **First use (no qualified observations)** | Centered block: `Boxes` icon muted, "No qualified model evidence yet.", body: "Models appears once canonical Observations pass eligibility. Run an Evaluation or Compare first.", links to Evaluations and Compare. The Saved rollups section does not render. |
| **Configurations exist, none eligible** | List renders with per-row honest lines; a top `honesty-note`: "All current evidence is exploratory or excluded — profiles show coverage without claims." |
| **Filters, zero matches** | "No matching configurations." + "Clear filters" button. |
| **Load error** | `AlertCircle` + "Failed to load configurations." + message + Retry (existing grammar). |

---

## 7. `/models/:modelConfigurationId` — Profile detail

A routed dossier (same composition law as the Lab study detail): one scrollable document with an
anchor section nav (sticky right rail `w-[200px]` at ≥1280px; horizontal contained-scroll anchor
row below the identity header at <1280px). No tabs, no overlay. Sections render only when they
have content; section 6 (evidence table) always renders.

### 7.1 Identity header and Section 1: identity and scope

```
Breadcrumb: Models
[KindEyebrow MODEL CONFIGURATION]  [VersionStatusChip]
Title: provider · requested slug (CompactModelLabel, full-wrap here, never ellipsis)
Resolved identity line (font-mono text-xs text-text-secondary):
  resolved: gpt-x-2026-05-14 · reasoning: high (effective) · tools: t-7f2c
Observation window · cohort counts (font-mono text-xs):
  observed May 4 – Aug 18 · 3 rubric versions · 2 evaluator configurations · 2 comparability cohorts
Receipt line (font-mono text-[11px] text-text-muted):
  query 8c1f… · generated 14:31:08 · aggregation v2 · uncertainty v1 · eligibility v1
```

- **Rolling alias**: the VersionStatusChip plus a disclosure line under the title:
  "Provider alias without a reported version. This profile covers observations from May 4 – Aug
  18 only; a later alias window is a separate configuration." Window splits render as separate
  sibling chips linking to the sibling profile.
- **Partial identity**: chip + line naming the missing dimensions
  ("no resolved version · reasoning settings not reported").
- The receipt line is always present — the profile's fingerprint, generated time, and rule
  versions are part of its identity, not metadata behind a disclosure.

### 7.2 Section 2: coverage and evidence quality

A definition grid (`grid grid-cols-2 md:grid-cols-4 gap-px bg-edge`, cells `bg-panel p-3`) of the
fifteen `HonestQuantity` fields, in fixed order (cap §12): unique Tasks · Task Versions · Task
Instances · active Observations · accepted candidate responses · planned replicates · resolved
independent units (+ unit kind/assumption as sub-line) · comparability cohorts · Rubric versions ·
evaluator configurations · earliest/latest observation (paired cell) · missing cells · attempts.

- The **attempts** cell is styled deliberately quieter (`text-text-muted` value) and labeled
  "attempts — provenance only, not a sample size" via an `honesty-note` suffix in the cell.
- Below the grid: three split rows — `EvidenceMixChips` (in-metrics split), eligibility split
  (`14 eligible · 3 provisional · 6 excluded` with a disclosure listing reason codes and counts),
  source split (`comparison 61 · evaluation 51`) — each a button that narrows the evidence table
  to that subset.
- Limitation reasons render as an icon+word list at the section foot
  ("Provider version not reported — 14 observations", each `text-xs text-text-secondary` with a
  `CircleAlert` icon), each narrowing the table to the affected observations.

### 7.3 Section 3: Task Family / facet evidence cards

One card per family (`rounded-md border border-edge bg-panel`), header row: family name
(`text-sm font-semibold`), task/instance/observation counts (`font-mono text-xs`), and
`EvidenceMixChips`. Body: judged-score cohorts first, then pass-rate cohorts, as `CohortBlock`
grids (§5.4). Card footer: supporting/contradicting/mixed/missing counts as four narrowing
buttons (`12 supporting · 2 contradicting · 1 mixed · 3 missing`).

- A family with heterogeneous Rubrics renders adjacent cohort blocks with the non-pooling divider
  line — never one number, never a cohort picker.
- Facet values render only through authored versioned mappings: a facet row inside the card shows
  facet name, mapped value per cohort, and mapping version chip; unmapped criteria surface in
  section 7's limitations, not here.
- The whole card header is a narrowing button for the evidence table (interactive headline rule).

### 7.4 Section 4: verified outcomes

Renders only when deterministic verifier evidence exists. A table (contained-scroll region,
`aria-label="Verified outcomes — scrollable"`, sticky first column) of verifier cohorts: columns
Cohort (verifier ref chip) · Verified tasks (`8 of 10`) · Pass rate (`AggregatedValue` via
`HonestValue`) · Interval or `InsufficientState` · Failures (count + narrowing button). A missing
verifier outcome renders the `non_aggregatable` reason, not a zero.

### 7.5 Section 5: selected paired comparison

Three states, in rendering order:

1. **No comparator selected** — the section shows a bordered empty block: "Pair this configuration
   against one you select. Pairing uses shared eligible tasks only." + a **Select comparator**
   button (`min-h-[44px]`) opening a `DialogSurface` picker: a searchable list of configurations
   ranked by shared-task count (the only ranking in the workspace — it ranks *coverage overlap*,
   never quality), each row showing shared eligible task count. Escape/close restores focus to the
   button.
2. **Comparator selected, empty intersection** — `empty`/`emptyReason` rendered plainly:
   "No shared eligible tasks with {comparator}. Pairing never compares unrelated task mixes." +
   the comparator chip with a remove (×) button.
3. **Results** — header: comparator chip (`CompactModelLabel` + remove), metric cohort line;
   then, top to bottom:
   - Coverage line: `12 shared tasks · 10 comparable · 2 incompatible cohorts · 1 missing here ·
     1 missing there` (all counts from `PairedComparisonCoverage`, incompatible/missing always
     visible).
   - `PairedGlyphStrip` (§5.7) + count line "Won 6 · tied 2 · lost 4".
   - Mean delta: `HonestValue`-style mono value with its bootstrap interval or
     `InsufficientState`, unit kind/count, assignment digest chip.
   - Disclosures list (the emitted `disclosures` strings, `honesty-note` style).
   - Per-task delta table (contained scroll): Task · value A · value B · Δ · outcome (icon+word
     W/T/L or the state word: `incompatible cohort` / `missing here` / `missing there`) ·
     versions (with a `versions differ` marker when `changedTaskVersion`) · drilldown links.
     Missing/incompatible rows render fully — the table never drops them.

### 7.6 Section 6: observations — recent, supporting, contradicting

The evidence table; always present. A contained-scroll, paginated (50/page, shared `Pagination`)
table with sticky header. Columns: Observation (mono id link) · Task (`Task · v2 · instance i-3`,
link chips) · Family · Outcome (verifier pass/fail icon+word or judged score mono) · Evidence
class chip · Eligibility (icon+word + reason code) · Observed (date) · Source
(`comparison`/`evaluation` word chip linking to the source result).

- **Narrowing model:** every interactive headline in sections 2–5 (claims, narrative sentences,
  family headers, eligibility splits, limitation lines, paired rows) applies a filter to this
  table. Active narrowings render as removable chips in a bar directly above the table
  ("Family: code-transformation × · Class: verified ×"), with a "Clear all" button, and are
  mirrored in the URL query string. Applying a narrowing moves focus to the table heading
  (`tabindex="-1"`); clearing returns focus to the originating headline.
- Supporting/contradicting/mixed/missing segmentation is the bucket vocabulary from family
  aggregation; the table's own quick-tabs are exactly: All · Supporting · Contradicting · Recent
  (aria-pressed segmented control, never color-only).
- Row click → drilldown route. Rows are real anchors; no nested interactive elements.

### 7.7 Section 7: protocols, Rubrics, evaluators, limitations

Three definition groups plus a limits list:

- **Protocol/Rubric cohorts** — one row per cohort: ref chip, task coverage count, "commensurate
  with" group id when an authored mapping exists.
- **Evaluator configurations** — one row per evaluator snapshot: kind, model ref, instruction
  digest short, observation count.
- **Uncertainty receipt** — unit kind, resolved count, fallback assumption sentence ("No
  higher-order dependency is encoded; Task identity is the resampling unit."), resolver/aggregation
  rule versions, seed, assignment digest, resamples — all mono, all verbatim from
  `BootstrapResult`/`UncertaintyUnitResolution`.
- **Limitations** — the complete reason-code list (missing inputs, protocol changes, unmapped
  criteria, undisclosed-missingness flags) as icon+word lines. This list is exhaustive by
  contract: anything that constrained a number anywhere above is readable here.

### 7.8 Charts

None in this child. Intervals, deltas, and pass rates are text and tables only. If a later child
proposes a chart, it enters with a textual/table equivalent rendered alongside, never
color-encoded state, and a reduced-motion static form — and that proposal amends this spec first.

### 7.9 Profile-level states

| State | Rendering |
|---|---|
| **Exploratory-only profile** | All sections render; claims strip shows only `descriptive only`/`missing` marks; a top `honesty-note`: "All evidence for this configuration is exploratory — coverage is real, claims are not yet supported." |
| **Unknown version** | Rolling-alias identity treatment (§7.1); every cohort block is unaffected (cohorting does not depend on provider versions); the limitation line carries the exact sentence pattern "Provider version was not reported for 14 observations from May–August." |
| **Insufficient everywhere** | `InsufficientState` in every interval slot; layout identical to the sufficient case. |
| **Unknown ID** | Standard not-found panel: "No model configuration with id `mc-9x…` exists in this database." + [Open Models] [Open Records] + device-local honesty note. |
| **Computing (large corpus)** | A determinate progress line in the dossier header area: `role="status" aria-live="polite"`, text "Aggregating 4,120 observations · family evidence 3 of 7", with a **Cancel** button (44×44). Computation never blocks the execution strip; cancel returns to the list with scroll preserved. |

---

## 8. `/models/:modelConfigurationId/evidence/:observationId` — Observation drilldown

A focused record page (not a dialog): breadcrumb `Models / {configuration} / Observation`.

Sections, top to bottom:

1. **Identity** — eyebrow `OBSERVATION`, mono id, observed timestamp, evidence-class chip,
   eligibility mark (icon+word + reason codes as a list).
2. **Canonical target** — Task / Version / Instance as link chips to their canonical routes, with
   family chip.
3. **Outcome** — verifier outcome (icon+word pass/fail with verifier ref + definition digest) or
   judged score (mono, with Rubric ref + cohort id); replicate group membership when declared
   ("replicate 2 of 3 within instance i-3"), undeclared repeats noted as such, never labeled
   replicates.
4. **Assessment & provenance** — evaluator snapshot row (kind, model, instruction digest), active
   vs superseded assessment lineage, eligibility decision reasons in full.
5. **Source result** — link to the owning comparison or evaluation execution (owner backlink
   grammar from the shell spec, including the confidence chip).
6. **Exact record** — Records deep link (`/records/observation/:id` or task-execution record) +
   `Copy link — this device` + the reference-vs-meaning honesty note ("Raw output lives on the
   exact Record; it is not duplicated here.").

Unknown observation ID renders the typed not-found with recovery options. If the observation is
excluded, the page renders fully — exclusion is information, not absence — with the exclusion
reasons in section 1.

---

## 9. Rollup page — visual language (forward-looking)

Route: `/models/rollups/:rollupId/versions/:version`. Presentation contract only; the repository
ships later. When it ships, it must render exactly this grammar:

1. **Banner first, always** — a full-width panel *above* all member content:
   eyebrow `SAVED ROLLUP`, name + `v2` (mono), and the policy block:

   > **Stratified only.** This rollup is a pinned list of exact configurations shown side by
   > side. It is not a model, not a pooled respondent, and never produces a merged estimate.
   > Members: 4 exact configurations · version pinned Aug 12 2026 · member manifest digest 4c9d….

2. **Heterogeneity table second** — members × identity dimensions (provider, requested slug,
   resolved version, reasoning, tools, window): identical values render normally; values that
   differ across members carry `border-b-2 border-warning` and a `differs` marker word — so
   heterogeneity is disclosed structurally before any evidence appears.
3. **Member shelves** — one column per member at ≥1280px (`grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3`,
   stacking below), each shelf rendering that member's condensed profile: identity header,
   coverage grid, family cards — all using the unmodified primitives from §5/§7. Shelves align by
   section so cohorts can be scanned across members. No shelf ever shows a cross-member number;
   there is no "rollup total" row, and no DOM position exists for one.
4. **Immutability** — the version rail (chip list v1 v2 v3, current `aria-current="page"`) and
   the line "Member or name changes create a new version; this version is pinned forever."
5. States: archived rollup (read-only banner, links intact), unknown rollup/version (typed
   not-found), member configuration deleted from local data (shelf renders a tombstone: "Member
   `mc-4f…` is not present in this database" — the manifest is immutable, the absence is shown,
   never silently dropped).

---

## 10. Copy rules (enforced)

Allowed patterns are the behavioral spec's own sentences; the workspace's string table
(`src/workspaces/models/copy.ts`) contains them verbatim:

- "Verified on 8 of 10 code-transformation Tasks under verifier cohort X."
- "Won 6, tied 2, lost 4 against configuration Y on 12 shared eligible Tasks."
- "Evidence is mixed across two Rubric cohorts; values are not pooled."
- "Provider version was not reported for 14 observations from May–August."
- "Insufficient independent coverage for an interval — 4 resolved task-cluster units, 5 required."

Forbidden in any UI string, narrative sentence, or tooltip (asserted by test against
`FORBIDDEN_CLAIM_PHRASES` plus UI-literal sweep): "Overall score", "Best model", "good at",
`n=<number>` anywhere, "reliable" in any case as a claim adjective, causal verbs ("causes",
"because the model"), and any bare cross-cohort scalar. Attempt counts never appear within the
same visual block as interval or claim language (structural cap, §12).

---

## 11. Responsive, motion, and accessibility

### 11.1 Breakpoints

| Width | Behavior |
|---|---|
| **1440** | List: single column `max-w-[960px]`. Profile: dossier 880px + sticky section nav. Coverage grid 4 columns. Cohort blocks 2-up. Rollup shelves multi-column. |
| **1024** | Profile loses sticky nav (anchor row). Coverage grid 4→3 columns. Rollup shelves `auto-fit` 2-up. Paired delta table enters contained scroll. |
| **768** | Filters collapse to sheet. Coverage grid 2 columns. Cohort blocks stack. Family cards full-width. Evidence table contained-scroll with sticky Task column. |
| **390** | Stacked identity, cards, and evidence rows — no desktop table squeezed in: the evidence table transforms to stacked observation cards (`role="list"`, same narrowing chips above); the paired delta table stays a contained-scroll table (pairwise scanning would be destroyed by row cards). All targets ≥44×44. |

**200% zoom:** next-narrower behavior per breakpoint ladder; no document-level overflow; long
slugs/signatures/digests wrap or middle-ellipsize; every filter, comparator picker, narrowing
chip, and drilldown remains reachable and operable.

### 11.2 Motion

No new motion. Existing classes only: `.pressable` on buttons, `.motion-state` on chip/state
swaps, `.disclosure-chevron` on disclosures, `scroll-thin` on scroll regions. Reduced motion
needs no new rules — there is nothing beyond the already-neutralized set (no streaming, no chart
animation, no count-up effects; numbers never animate).

### 11.3 Accessibility

- **Keyboard:** every headline narrowing is a real button (`aria-pressed` reflects active
  narrowing); comparator picker is a trapped `DialogSurface` with Escape close and focus restore
  to **Select comparator**; narrowing application moves focus to the table heading; clearing
  returns focus to the originating control; drilldown is a plain link; back returns focus and
  scroll.
- **ARIA:** cohort blocks and glyph strips are lists with full-sentence accessible names; tables
  have captions and scoped headers; the computing state is one polite live region; the paired
  strip's legend is visible text, not a tooltip; `HonestValue` unavailable/limited reasons are
  rendered text or `aria-describedby` targets, never title-only.
- **Contrast:** all roles per §4.2 on the shipped palette meet 4.5:1; muted text
  (`#777777`) is used only for non-essential receipt/digest lines; required state words
  (insufficient, unavailable, excluded reasons) use `text-text-secondary` minimum.
- **Status:** no state is color-only anywhere in the workspace — every chip, claim, outcome, and
  gap carries its word, and most carry an icon.

---

## 12. Densification caps (assertable)

1. List row: ≤3 text lines, ≤3 identity elements (eyebrow, version chip, activity stamp); ≤2 top
   families named; ≤1 gap count.
2. Filters: exactly 8; no more may be added without amending this spec.
3. Coverage grid: exactly the fifteen emitted quantities in fixed order; nothing else may enter
   the grid.
4. Narrative block: ≤5 sentences; each sentence exactly one source chip.
5. Claims strip: ≤4 `ClaimMark`s visible; overflow behind one disclosure.
6. Family card: ≤4 cohort blocks before the card's body scrolls (`max-h-96 scroll-thin`).
7. Evidence table: page size 50; ≤8 columns; narrowing chips ≤6 visible before "…and n more".
8. Paired comparison: exactly 1 comparator; glyph strip ≤60 glyphs before wrapping into a
   contained-scroll row.
9. Live regions: ≤1 polite per route (the computing state); zero assertive (failures are inline
   panels).
10. Attempt-count placement: attempts may not share a visual block with any interval, claim, or
    pass rate (DOM-distance assertion: no common ancestor below section level).
11. Rollup: 0 pooled numbers — no element on the rollup route may contain a cross-member
    aggregate (string sweep for `Σ`, "total", "average" outside the policy-disclosure sentence).

---

## 13. States inventory (all designed)

First use · configurations-without-eligible-evidence · filters-no-match · load error ·
exploratory-only profile · rolling alias (single window) · rolling alias (split windows) ·
partial identity · insufficient coverage (per-slot and everywhere) · non-aggregatable (per reason
code) · heterogeneous cohorts · undisclosed missingness flag · no-comparator · empty-intersection
paired · comparator with version-differing tasks · computing/cancel · unknown configuration id ·
unknown observation id · excluded observation drilldown · rollup archived · rollup unknown ·
rollup tombstone member.

Every state above has a named rendering in §6–§9; none is an empty shell, a skeleton, or a bare
dash.

---

## 14. Acceptance criteria

Honesty and grammar:

1. Grep of `src/workspaces/models/**` and its string table finds zero matches for the forbidden
   patterns in §10 (including the regex `\bn\s*=\s*\d`); the `FORBIDDEN_CLAIM_PHRASES` test suite
   passes against rendered claims.
2. Every `HonestValue` rendering matches its state exactly: `unavailable` renders the word
   "Unavailable" plus reason text and no numeral; `limited` shows value + unresolved count +
   "limited" marker; assert all three in component tests.
3. Below five resolved units, every interval slot renders the §5.5 `InsufficientState` text; no
   `±`, no interval digits, no substitute error bar appears anywhere in the DOM.
4. Heterogeneous Rubric cohorts render as ≥2 `CohortBlock`s plus the non-pooling divider line; no
   element contains a cross-cohort average (string sweep + fixture test with a two-cohort family).
5. Every claim sentence and narrative line is a button that applies its source narrowing to the
   evidence table; the narrowing chip bar, URL query, and table contents update together; focus
   moves to the table heading.

Routes and composition:

6. The four routes render on direct load, refresh, and back/forward; unknown IDs render their
   typed not-found with recovery options; focus lands on the page heading on route change.
7. `/models` renders exact configurations first and Saved rollups below a labeled divider; no
   score/rank control exists anywhere in the workspace DOM (sweep for `aria-sort`, sort selects
   other than identity/latest-activity).
8. The comparator picker is a `DialogSurface`: focus trapped, background inert, Escape closes,
   focus returns to the invoking button.
9. Paired results render incompatible and missing tasks as full rows with state words; wins/ties/
   losses render as the lettered strip plus a count line; the empty-intersection state renders the
   §7.5 copy verbatim.
10. The drilldown page renders canonical Task/Version/Instance links, eligibility reasons, source
    result backlink with confidence chip, the exact Record link, `Copy link — this device`
    verbatim, and never embeds raw candidate output.

Responsive, zoom, motion:

11. At 1440/1024/768/390 and 200% zoom: no document-level horizontal overflow; at ≤390 the
    evidence table is the card list; all interactive targets ≥44×44; filters all operable.
12. Motion-contract scan passes unchanged (no new animated classes, no `transition-all`, no
    hover-transforms on rows); reduced-motion snapshots render statically.
13. The computing state exposes one polite live region whose text updates at stage granularity,
    and a working Cancel that returns to `/models` with scroll restored.

Caps:

14. All eleven densification caps in §12 hold (each is countable in the DOM or by string sweep).

Rollup (forward contract):

15. When the rollup route ships: the policy banner precedes all member content in DOM order; the
    heterogeneity table marks every differing cell; no pooled aggregate element exists (cap
    §12.11); archived and tombstone states render as specified.

---

## 15. Explorations — considered and rejected

### 15.1 Capability radar / spider charts
Rejected at the philosophy level. A radar chart is a latent-trait portrait with the axes renamed:
it implies a stable cross-family capability vector that the evidence contract explicitly refuses
to define, and it invites exactly the "87% good at coding" reading that is forbidden in copy. The
family-card grid carries the same scanning value while keeping cohort boundaries physical.

### 15.2 A "health" or coverage score per configuration
Rejected. Any single scalar — even an honest "coverage 0–100" — becomes the sort key users sort
by and the number screenshots quote. Coverage is fifteen separate quantities by contract; the UI
keeps them separate by shape (a grid, not a gauge).

### 15.3 Grouping configurations under marketing-model headers
Considered: collapsible "GPT-x ▸ 4 configurations" groups. Rejected as the default organization.
The marketing name is not the respondent; grouping by it re-creates the synthetic respondent one
level up and makes alias/partial configurations visually subordinate to a name they may not
deserve. The flat canonical-sort list keeps every identity at equal rank; the Model filter
provides the same narrowing without the implied hierarchy.

### 15.4 Interval bars or violin/strip plots for uncertainty
Considered seriously (a minimal range bar per cohort). Rejected for this child: with no chart
infrastructure shipped, any custom SVG invites color-encoded state and animation pressure, for
what is usually one or two intervals per family. Text ranges plus the glyph strip carry the
information accessibly. A future visualization child must satisfy §7.8's gate first. On record as
the strongest visual upgrade path.

### 15.5 All-pairs comparison matrix
Rejected. A matrix invites reading across non-shared task mixes — the exact inference the paired
contract prohibits. One explicitly selected comparator with visible intersection accounting is the
only pairing surface.

### 15.6 Traffic-light claim coloring (green/amber/red as the primary signal)
Rejected. Claims communicate *epistemic status*, not performance alerts; making red/green the
carrier would both violate the no-color-only rule in spirit and dramatize findings the labels
already state in words. Icons + words + restrained roles keep "weakest supported" a fact, not an
alarm.

### 15.7 Hiding excluded observations behind an "advanced" toggle
Rejected. Exclusion reasons are half the product's honesty surface; the eligibility split is a
first-class narrowing row in section 2 and excluded rows remain in the evidence table under All.

---

## 16. Decision points and recommended defaults

| # | Decision | Options | Recommended default |
|---|---|---|---|
| D1 | List default sort | Canonical identity vs latest activity | **Canonical identity** (catalog module's sort); latest activity as the single optional toggle — no other sorts exist. |
| D2 | Narrative placement | Below identity header vs section 2.5 | **Immediately below the identity header** — the template summary frames the page; its header marks it generated. |
| D3 | Wins/ties/losses display | Glyph strip + table vs table only | **Glyph strip + table** — the strip gives shape at a glance with letters as the carrier; the table gives exactness. |
| D4 | Rollup shelf layout | Side-by-side columns vs member tabs | **Columns** — tabs hide heterogeneity, which the contract requires be disclosed before evidence. |
| D5 | Weakest-supported role | error vs warning | **error** — a verified negative inside a pre-declared unsupported region; warning is reserved for *uncertain* states (provisional, mixed, rolling alias). |
| D6 | Coverage grid order | As emitted vs grouped (coverage/quality/meta) | **As emitted, fixed order** — the fifteen quantities are one contract; grouping invites future "summary" cells. |
| D7 | Comparator picker ordering | Alphabetical vs shared-task count | **Shared-task count** — the only ranking in the workspace, and it ranks overlap, never quality (labeled as such in the dialog). |
| D8 | Evidence table quick-tabs | All/Supporting/Contradicting/Recent vs none | **Include the four** — they mirror the emitted buckets and cost one segmented control. |
| D9 | `limited` marker style | Warning role vs muted | **Warning role, dashed border** — a quantity with unresolved members is degraded, and degradation should be findable by scanning. |

---

## 17. Component inventory (build list)

New workspace primitives (`src/workspaces/models/`): `HonestValue`, `VersionStatusChip`,
`EvidenceMixChips`, `CohortBlock`, `InsufficientState`, `ClaimMark`, `PairedGlyphStrip`,
`DeterministicNarrative`, `ComparatorPicker` (DialogSurface), `NarrowingChipBar`,
`ObservationCard` (mobile transformation), `RollupBanner` + `HeterogeneityTable` + `MemberShelf`
(rollup, forward contract), `copy.ts` string table.
Extended: `KindEyebrow` (+`model-configuration`, `observation`, `rollup` kinds).
Reused unchanged: `RecordRow`, `StatusMark`, `CompactModelLabel`, `Pagination`, `DialogSurface`,
`CopyLinkButton`, contained-scroll region pattern, `honesty-note`/`honesty-copy.ts` (shell),
`.claim-frame-*`/`.boundary-rule` (Lab).
Backend surfaces designed against (read-only consumers): `model-configuration-query`,
`coverage-summary`, `family-aggregation`, `profile-claims`, `paired-comparison`,
`cluster-bootstrap`, `uncertainty-unit-resolver`, `profile-observation-selection` — the UI renders
their emitted shapes verbatim and computes nothing of its own.
