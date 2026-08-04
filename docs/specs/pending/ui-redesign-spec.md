# UI Redesign Spec — "Command Deck" Look

> ⚠️ **STALE — DO NOT IMPLEMENT AS WRITTEN** (audit 2026-08-04).
> This spec predates 140 commits: the app is now a three-workspace shell, and
> most of this spec already shipped through other components (PipelineRail,
> useResizableSplit, run-history/cost, CommandPalette, provenance gutter, …).
> Its palette and icon-rail sections conflict with current DESIGN.md decisions.
> See `ui-redesign-grounding-audit.md` in this directory before touching it.

> Reference: target screenshot (dark blue-tinted shell, icon rail, numbered panels,
> gradient Run CTA, illustrated empty state).
> This spec describes the delta from the current Split Workspace (see `DESIGN.md`,
> `UI.md`) to the target look — **and where it deliberately goes further (§0).**
> Open conflicts with existing decisions are flagged in **§13**.

---

## 0. Design Thesis — Where We Beat the Reference

The screenshot is a strong *first-paint*. It is a weak *working screen*. Copying it
pixel-for-pixel would ship a UI that looks excellent in a portfolio shot and degrades
the moment a run starts. Nine deliberate departures:

| # | Reference weakness | Our upgrade |
|---|---|---|
| 1 | **Empty state is 60% of the viewport doing marketing work.** It teaches once, then wastes the best real estate forever. | The empty state is **productive**: recent runs, task presets, and a paste target. The teaching diagram *becomes* the live pipeline once you run — same pixels, real function. |
| 2 | **Static pipeline diagram.** Four decorative cards; step 4 is highlighted for no reason (nothing has run). | A **live pipeline rail** — the same four cards animate through Task → Models → Judge → Rank with per-stage timers and counts. It is the run's progress bar. |
| 3 | **Vanity model metadata.** `128K Context`, `MoE Architecture`, `Strong` — static marketing facts that never change and never inform a choice. | **Earned telemetry**: win rate over your last N runs, avg judge score, $/1M tokens, p50 latency. Data that actually decides which model to check. |
| 4 | **No cost or time signal before you spend.** You press Run blind. | Run button carries a **live estimate** — `~$0.04 · ~25s` — recomputed as models toggle. Budget is a first-class number in a tool that bills per token. |
| 5 | **Rank/Fuse toggle is marooned top-right,** far from both the Run button and the output it governs. | Toggle stays in the header (a11y/`DESIGN.md` contract) but gains a **mirrored inline control on the output header**, where the consequence lives, plus an inline `Fuse these N candidates` action after a rank. |
| 6 | **Copy promises "side-by-side comparison"** the layout has nowhere to put. | A real **Compare view**: 2–3 candidate columns, synchronized scroll, per-criterion score row, diff highlighting. |
| 7 | **Fixed panes.** 420px command / rest output, forever — wrong ratio while configuring *and* while reading a fused document. | **Resizable + collapsible split** with persisted ratio, plus a `⌘\` focus-mode that collapses the command pane to a strip once a run completes. |
| 8 | **Decorative chrome.** `⌘K`, `?`, theme sun, `Live` pill — none wired to anything. | Every affordance is **real or absent**. `⌘K` opens a working command palette; `Live` reflects actual provider/key health; the theme button ships only when a theme does. |
| 9 | **Contrast likely fails WCAG AA.** ~11px `#8b98ad` captions on `#0d1424`. | Every token is **contrast-audited** (§2.1) with measured ratios; interactive text ≥4.5:1, large/meta ≥3:1. |

**Design principle for this redesign:** *every pixel of chrome must either display live state
or accept input.* If a surface does neither, it is decoration and gets cut.

---

## 1. What Changes at a Glance

Section 1 is the *visual* delta only — the surface the reference defines. The functional
delta is §0 and §§5–9.

| Area | Current (DESIGN.md) | Target (screenshot) |
|---|---|---|
| Canvas tone | Neutral charcoal `#0a0a0a` (zinc-950) | Blue-tinted near-black (~`#060b16`, slate-950 family) |
| App chrome | Header + 2 panes | **Left icon rail** + header + 2 panels inside a framed canvas |
| Sections | Plain panel headers | **Numbered stages** — `01 COMMAND`, `02 OUTPUT` — with step captions |
| Primary CTA | Flat cyan button | **Gradient** cyan→teal button with icon, sub-caption, and `⌘ Enter` kbd hint |
| Active/selected states | Flat cyan fill | Cyan + **outer glow** (box-shadow halo) |
| Corner radius | 4–8px | Larger, ~10–14px (`rounded-xl`) on cards/panels |
| Model rows | Text chips | **Brand-colored square avatar** per model + metadata line + tag pill (we replace the reference's static chips with live telemetry — §4.2) |
| Empty state | Text CTA only | **4-step pipeline diagram** (icon cards + dotted connectors) + podium preview card + 3-up "what you'll get" row (we make it stateful — §5.2) |
| Extras | — | `Live` pill, `⌘K` palette button, help header button, counter on task input, dashed "add criterion" row (all wired for real — §0 #8) |

---

## 2. Design Tokens

### 2.1 Color (replace zinc palette with blue-tinted slate)

Five-step elevation ladder — each surface is a measurable step lighter than the one
beneath it, so depth reads without borders doing all the work.

| Token | Value | Elev. | Usage |
|---|---|---|---|
| `canvas` | `#05080f` | 0 | App background behind the framed shell |
| `shell` | `#0a0f1c` | 1 | Framed app surface, icon rail |
| `panel` | `#0d1424` | 2 | Command / Output panels |
| `card` | `#111a2e` | 3 | Model cards, step cards, inner inputs |
| `card-hover` | `#16213a` | 4 | Hover on cards/rows |
| `raised` | `#1b2740` | 5 | Popovers, command palette, dropdowns, tooltips |
| `edge` | `#1c2942` | — | Default hairline borders |
| `edge-bright` | `#2b3d5f` | — | Hover / focus borders |
| `accent` | `#22d3ee` | — | Selected states, active stage, links, glow source |
| `accent-deep` | `#0e7490` | — | Gradient end for CTA |
| `text` | `#e6edf7` | — | Primary text |
| `text-secondary` | `#a9b6c9` | — | Secondary body, descriptions |
| `text-muted` | `#7f8da3` | — | Eyebrow labels, placeholders (**non-interactive only**) |
| `success` | `#34d399` | — | Live pill, done, winner |
| `warning` | `#fbbf24` | — | Weak score, partial run, caution |
| `error` | `#fb7185` | — | Run error, failed candidate |

**Contrast audit** (against `panel #0d1424`, WCAG 2.1 AA):

| Pair | Ratio | Verdict |
|---|---|---|
| `text` on `panel` | ~14.6:1 | Pass AAA |
| `text-secondary` on `panel` | ~8.1:1 | Pass AAA |
| `text-muted` on `panel` | ~5.1:1 | Pass AA at any size |
| `accent` on `panel` | ~9.4:1 | Pass AAA |
| `success` / `warning` / `error` on `panel` | ≥7.5:1 | Pass AAA |
| *Reference's* `#8b98ad` on `#0d1424` | ~5.6:1 | Passes — **but only at the 11px sizes the reference uses, where it reads as haze.** We raise the floor to 12px for any muted text and reserve 11px for uppercase-tracked eyebrows. |

**Rule:** `text-muted` is banned on interactive elements. Buttons, links, checkboxes,
and form labels use `text-secondary` minimum. Disabled controls use `text-muted` +
`aria-disabled`, never color alone.

**Never encode meaning in color alone.** Every semantic state pairs color with a
glyph or text: winner = crown + `#1`, error = icon + message, `Strong` tag = colored
dot + word. Required for the ~8% of users with color-vision deficiency, and it makes
the cyan-heavy palette legible in grayscale.

Implementation: extend `tailwind.config.js` with these as named colors (e.g. `canvas`, `shell`, `panel`, `card`, `raised`, `edge`, `edgeBright`) rather than overriding `zinc`, so old utilities fail loudly instead of silently rendering the wrong tone.

### 2.2 Radius, shadow, glow
- `radius-sm: 6px` (chips, pills) · `radius-md: 10px` (cards, inputs) · `radius-lg: 14px` (panels, framed shell)
- **Nested-radius rule:** an inner element's radius = outer radius − padding. A 10px
  card with 6px padding takes 6px children. Prevents the "sticker on a card" look the
  reference has where equal radii nest.
- Glow (selected step card, active nav icon, Run button hover):
  `box-shadow: 0 0 0 1px rgba(34,211,238,.45), 0 0 24px rgba(34,211,238,.18)`
- Podium/active CTA shadow: `0 4px 20px rgba(34,211,238,.25)`
- **Glow budget:** at most **two** glowing elements on screen at once — the primary CTA
  and the single active stage. The reference glows three things simultaneously
  (nav item, step 4, Run), which flattens the hierarchy it is trying to create.
- Popover/palette shadow: `0 16px 48px -12px rgba(0,0,0,.7)` + 1px `edge-bright` border.

### 2.3 Typography
- Keep **Geist / Geist Mono** (already in use).
- Section eyebrows: `11px`, uppercase, `tracking-[0.14em]`, muted; the stage number (`01`, `02`) in cyan, mono.
- Model slugs & metadata chips: Geist Mono, 11–12px.
- **Exception to DESIGN.md's 13px floor:** the screenshot uses ~11px captions inside empty-state cards. Keep the 13px body floor for interactive UI; allow 12px *only* for non-interactive diagram captions, and 11px *only* for uppercase-tracked eyebrows (matches the existing `text-xs` metadata rule — no real conflict).
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every score, timer, cost, and token count. Non-tabular digits jitter as live values tick — the single cheapest upgrade to the "technical instrument" feel, and the reference's mono chips don't specify it.
- **Truncation policy:** model names truncate with a `title` tooltip; slugs never truncate mid-token (truncate the vendor prefix first). The reference's `minimax/minimax-m3` clipping is a bug to avoid.

---

## 3. App Shell

### 3.1 Framed canvas
Full-viewport `canvas` background; the app sits in an inset rounded frame (`shell`, 1px `border`, `radius-lg`, ~8px inset margin). No document scroll; panes scroll internally (unchanged).

**Beyond the reference — the split is live, not fixed.**
- Draggable divider between panes; 4px hit area widened to 12px invisibly, cursor
  `col-resize`, cyan on hover/drag.
- Clamped 320px ≤ command ≤ 560px. Ratio persisted to `localStorage`.
- Keyboard: divider is `role="separator"` with `aria-valuenow`, arrow keys move 16px,
  `Home`/`End` snap to min/max — a real a11y-compliant splitter, not a mouse-only handle.
- **Focus mode (`⌘\`)**: collapses the command pane to a 56px strip showing only the
  model avatars and a Re-run button. Auto-suggested (never auto-applied) after a run
  completes in Fuse mode, where the document is the whole point.
- Double-click the divider resets to default ratio.

### 3.2 Left icon rail (new, ~64px wide)
Vertical, icon-only nav: **Command, Runs, History, Models, Judges, Settings**, plus a collapse/terminal affordance at the bottom.
- Icon + 10px label underneath, stacked, muted.
- Active item: icon in a rounded square with cyan border + glow (see §2.2).
- This is navigation, not decoration: items route to views (Runs/History/Models/Judges/Settings exist as concepts in `PRODUCT.md`).

> ⚠️ **Conflict:** `DESIGN.md` §Layout explicitly retired the "left navigation sidebar" as out-of-scope platform chrome. Adopting the rail requires amending that decision (see §13).

**Beyond the reference:** rail items that don't route yet render **disabled with tooltips**
rather than as live-looking buttons. Active item also carries a left 2px cyan bar so the
active state survives grayscale. Persisted per-item badge: `Runs` shows a count when a
run is in flight.

### 3.3 Header (modify `src/ui/Header.tsx`)
- Left: cyan hex-cube logo mark (SVG), `RSemble AI` wordmark (semibold), status pill.
- Right cluster: `⌘ K` palette button (kbd chip in a bordered pill), help `?`, theme (sun) icon buttons, then the **Rank / Fuse** segmented control (active side = cyan-tinted fill), then a square `RS` avatar chip.
- Header height ~56px, hairline bottom border.

**Beyond the reference — the `Live` pill must mean something.** In the screenshot it is
a decorative green dot. Ours is a real connection indicator with four states, driven by
provider/key health (`ConnectionsModal.tsx` already owns this data):

| State | Dot | Label | Trigger |
|---|---|---|---|
| Ready | `success`, solid | `Live` | Key present, last request OK |
| Running | `accent`, slow pulse | `Running · 12s` | `state.running` — elapsed timer inline |
| Degraded | `warning` | `Degraded` | A provider returned 5xx/429 recently |
| Offline | `error` | `No key` | No API key configured — click opens `ConnectionsModal` |

The pill is a **button** in every state, opening connection settings. A status light
you cannot act on is decoration.

**Global run progress:** during a run, a 2px cyan indeterminate bar rides the header's
bottom border. Visible from anywhere, including behind modals — the reference has no
global progress affordance at all.

---

## 4. Command Panel (left, 320–560px resizable, default 420px)

Numbered header: `01 COMMAND` + one-line caption ("Define your task, select models, set the rubric, and choose a judge.").
Right of the header: a **reset** icon button (present in the reference) wired to
`RESET_SESSION`, with a confirm step when a run exists.

### 4.1 Task (`src/ui/TaskInput.tsx`)
- `TASK` eyebrow label.
- Textarea on `card` background, `radius-md`, placeholder: "Describe the task — e.g. write a 600-word article on…"
- Bottom-right char counter; manual resize handle.

**Beyond the reference:**
- **Auto-grow** 3–12 rows, then scroll. A fixed box that scrolls at line 4 is hostile to
  the long, structured prompts this tool exists to run.
- **Counter is a token estimate, not a character count**: `~410 tokens · ≈$0.002/model`.
  Characters are meaningless to an LLM operator; tokens and cost are not. Turns amber
  past 75% of the smallest selected model's context, red past 100% with the offending
  model named.
- **Draft persistence** to `localStorage`, restored on load — never lose a prompt to a refresh.
- **Paste-to-fill**: dropping a `.md`/`.txt` file onto the panel loads it as the task.
- `⌘Enter` submits from inside the textarea.

### 4.2 Models (`src/ui/ModelList.tsx`)
- Header row: `MODELS` eyebrow + cyan `3 selected` count; right-aligned `+ Add model` ghost button (dashed/bordered pill).
- **Model card** (per row, `card` bg, `radius-md`, hairline border; selected row gets cyan left-accent or border):
  - Cyan **checkbox** (custom, rounded, checked = cyan fill + dark check).
  - **Brand avatar**: 32px rounded square with the provider's mark on its brand color (GLM = violet, MiniMax = magenta, DeepSeek = blue). Needs an asset map `slug → {color, icon}` in `studio-data.ts`.
  - Name (semibold) over mono slug.
  - `…` overflow menu, right-aligned (Swap model, Duplicate, Solo-run, Remove).

**Beyond the reference — replace vanity chips with earned telemetry.**
The screenshot's `128K Context` / `MoE Architecture` / `Strong` chips are static
marketing facts. They never change, and they never help you decide what to check. The
second metadata line becomes live data instead:

```
GLM 5.2                                    [● Strong]  …
z-ai/glm-5.2
★ 62% win · 4.3 avg · $0.60/M · ~8s p50
```

| Field | Source | Why it earns the pixels |
|---|---|---|
| **Win rate** | % of your past runs where this model ranked #1 | The single most decision-relevant number in the app |
| **Avg score** | Mean `weightedScore` across past runs | Consistency, not just peaks |
| **$/M** | Provider catalog pricing (`CatalogModel`) | Cost is the real constraint |
| **p50 latency** | Rolling median from run history | Sets the wait expectation |

- Requires a small persisted **run-history store** (`localStorage`, capped ring buffer)
  — see §6. Until ≥3 runs exist, gracefully fall back to catalog facts (context length,
  pricing) and show `— no history yet` rather than fabricating stats.
- Keep the capability tag pill (`Strong` / `Balanced` / `Creative`) **only if it is
  derived** from history, not hand-authored. Otherwise cut it. Pair with a dot glyph so
  it survives grayscale.
- **Sparkline (optional, phase 3):** 24×8px inline trend of this model's last 10 scores,
  right-aligned. Real density, zero chrome.
- **Drag to reorder** slots via handle on the avatar; order determines column order in Compare view.
- **Sticky footer summary** at the list's end: `3 models · ~$0.04 · ~25s est.`
- Empty selection state: card list dims and the Run button becomes disabled with
  `Enable at least one model to run` (already a `DESIGN.md` requirement).

### 4.3 Rubric (`src/ui/RubricDisclosure.tsx`)
- `RUBRIC` eyebrow + muted criteria count + caption.
- **Dashed-border add row**: `⊕ Add a criterion (e.g., Accuracy, Depth, Clarity…)` — dashed `edge` color, `radius-md`, `text-secondary`; hover brightens border. Click converts to an input.

**Beyond the reference — a rubric of `0 criteria` is a broken default.**
The screenshot ships an empty rubric with no path forward but freeform typing. The
judge is the core of the product; it should not start empty.
- **One-tap preset chips** above the add row: `Accuracy` `Depth` `Clarity` `Concision`
  `Citations` `Code correctness`. Click to add. Seeded from `SEED_RUBRIC`.
- Each criterion row: drag handle · enabled checkbox · label (inline-editable) ·
  **weight slider or stepper** · remove. Weights already exist on `RubricCriterion`
  but have no UI — surface them.
- **Normalized weight bar**: a thin stacked bar showing each criterion's share of the
  total. Instantly answers "what is this judge actually optimizing for?"
- Collapsed summary when ≥3 criteria: `4 criteria · Accuracy 40% · Depth 30% · +2`.
- Empty state copy: "No criteria — the judge will score on overall quality." State the
  consequence, don't just report a zero.

### 4.4 Judge (`src/ui/JudgeConfig.tsx`)
- `JUDGE MODEL` eyebrow + caption.
- Select-styled button showing judge avatar + slug, chevron right; separate gear icon button adjacent for judge settings (temperature, system prompt — both already in state).

**Beyond the reference — warn about self-judging.**
If the selected judge is also one of the candidate models, show an inline amber note:
`⚠ z-ai/glm-5.2 is judging its own answer — scores may be biased toward it.`
Self-preference bias is well documented in LLM-as-judge setups; a serious evaluation
tool must surface it. Offer a one-click `Use a neutral judge` fix. The reference has no
concept of this.

### 4.5 Run CTA (`src/ui/RunButton.tsx`)
- Full-width, height ~64px, `radius-md`, sticky to the panel bottom so it never scrolls away.
- **Gradient**: `linear-gradient(135deg, #22d3ee → #14b8a6)` (cyan → teal), dark-navy text (`#04202b`), semibold.
- Left: play icon + `Run pipeline`; beneath the sub-caption line.
- Right: `⌘ Enter` kbd chip (translucent dark on the gradient).
- Hover: slight lift + glow (§2.2).

**Beyond the reference — the button carries the forecast and becomes the abort.**

| State | Label | Sub-caption | Visual |
|---|---|---|---|
| Ready | `Run pipeline` | `3 models · 1 judge · ~$0.04 · ~25s` | Gradient + glow on hover |
| Disabled (no task) | `Run pipeline` | `Enter a task to run` | Flat `card`, `text-muted`, `aria-disabled` |
| Disabled (no models) | `Run pipeline` | `Enable at least one model` | Same |
| **Running** | `Stop run` | `Generating · 2 of 3 done · 14s` | Gradient desaturates; a **progress fill** tracks completion behind the label |
| Complete | `Re-run` | `Last: 22s · $0.03 · GLM 5.2 won` | Gradient, softer glow |

- The cost/time estimate recomputes live from selected models × token estimate (§4.1)
  × catalog pricing. **Showing spend before it happens is the single biggest gap in the
  reference design.**
- The same button aborts — no separate stop control to hunt for. Requires an
  `AbortController` per request wired into `studio-engine.ts` (new `ABORT_RUN` action).
- Post-run it reports the actual cost and winner, closing the estimate→actual loop.

---

## 5. Output Panel (right, flexible)

Header: `02 OUTPUT` + caption. **Beyond the reference:** the header is stateful — it
carries the mirrored Rank/Fuse control (§0 #5) and, once a run exists, replaces the
caption with a **run receipt**: `3 candidates · judged in 22s · $0.031 · GLM 5.2 won`,
plus `Export` and `Copy` actions.

**The reference only designs one of four states.** `OutputPane.tsx` already routes five
(empty / running / insufficient / error / result). All are specified below.

### 5.1 The pipeline rail — one component, two lives

The reference's four-card diagram is decoration that never changes. Ours is the **same
four cards, promoted to the run's primary progress display**. This is the central idea
of the redesign: the thing that teaches you the pipeline *becomes* the thing that
reports it.

Cards: ~140×120px, `card` bg, `radius-md`; mono number, semibold title, 12px caption.
Connected by dotted lines with dot nodes.

| Stage | Icon | Idle caption | Live caption |
|---|---|---|---|
| 1 **Task** | file | "You describe what you need" | `~410 tokens` (from state) |
| 2 **Models** | hub | "Multiple models generate responses" | `2 of 3 done · 14s` |
| 3 **Judge** | shield | "Scores each response using your rubric" | `Scoring 3 candidates · 6s` |
| 4 **Rank / Fuse** | crown / merge | "Best response recommended" | `GLM 5.2 · 4.4` |

**Per-stage visual states** — four, all distinguishable without color:
- `pending`: `text-muted`, 60% opacity, hairline `edge` border, no glow.
- `active`: cyan border + glow, spinner in the number slot, **dotted connector animates**
  left-to-right (dash-offset), elapsed timer in caption.
- `done`: `success` check replacing the number, solid border, result summary in caption.
- `error`: `error` border + alert glyph, failure reason in caption, retry affordance.

**Fixes a reference bug:** the screenshot highlights step 4 (`Rank`) with a cyan glow
while the app is idle and nothing has run. Highlighting the *last* stage before the
first has started is meaningless. In idle, the rail shows **stage 1 as next-up** and the
rest neutral. Card 4's icon and label swap with the Rank/Fuse mode (crown / merge).

**Post-run**, the rail collapses to a 32px summary strip —
`✓ Task · ✓ 3 models 14s · ✓ Judge 6s · ✓ Rank` — freeing the viewport for results.
Click to re-expand. Same pixels, three different jobs.

### 5.2 Empty state — make it productive

The reference spends 60% of the viewport on a diagram + a 3-up marketing row that
teach exactly once. Keep the teaching for the first session; earn the space back after.

**First run ever (no history):** full teaching layout — pipeline rail (idle) +
leaderboard preview card + the 3-up "what you'll get" row. This is the screenshot, and
it is right for a first-time user.

**Every session after:** the 3-up row is replaced by things that save work —
- **Recent runs** (3 rows): task excerpt · winner avatar · score · relative time.
  Click to reload that configuration; ↩ to reload and re-run.
- **Task presets** the user has saved (chips).
- The pipeline rail stays — it is now a live component, not decoration.

Gate on `runHistory.length === 0`. **A tool's empty state should shrink as the user
grows.** The reference's never does.

#### 5.2a Leaderboard preview card (first-run only, top-right)
Small `card` panel: trophy icon, `LEADERBOARD PREVIEW` eyebrow, 2-line caption, and a
mini **podium graphic** (three ascending bars labeled 2-1-3, winner bar cyan). After
the first run this slot shows the **actual last leaderboard** instead of a mock.

#### 5.2b "What you'll get" row (first-run only, bottom)
Three columns: cyan outline icon (trophy / bar-chart / award), semibold title, 2-line
caption — Ranked leaderboard / Side-by-side comparison / Smart recommendation.

> ⚠️ **Conflict:** `DESIGN.md` anti-patterns ban "3-column feature grids with centered icons."
> Justified here as *first-run education inside an empty state* (empty states are explicitly
> "features" in DESIGN.md) **and it disappears permanently after run #1** — which is precisely
> what makes it not marketing chrome. Amend the clause to scope it to persistent layouts (§9).

### 5.3 Running state — the reference designs nothing here

This is where a multi-model tool actually lives, and the screenshot has no answer for
it. `OutputPane.tsx` already streams candidate deltas; the redesign gives that a home.

**Layout during a run:** pipeline rail (live, §5.1) on top; below it, a **candidate
grid** — one card per model, side by side at ≥1280px, stacked below.

Each live candidate card:
- Header: brand avatar · model name · status glyph · per-model elapsed timer · token count.
- Body: **live streaming text**, tail-anchored, with a blinking cyan cursor (already
  implemented — keep, restyle). Fixed max-height with a fade-out mask at the bottom edge
  so cards don't jitter as text arrives.
- `done`: collapses to summary + first-paragraph excerpt, `success` dot, final timing.
- `error`: `error` border, the actual provider message, and a **`Retry this model`**
  button — one model failing should not cost you the whole run.
- Cards **reorder by completion**, animated with FLIP, so finished work rises.

**Judging stage:** the existing `StageBanner` (timer + plain-language explanation) is
kept and restyled — it is genuinely good and has no analogue in the reference. Add
skeleton leaderboard rows beneath it so the layout doesn't jump when scores land.

**Perceived-performance rules:** never show an empty pane during a run; every stage
reports elapsed time; no spinner without an accompanying sentence about what is happening.

### 5.4 Rank result (`RankResult.tsx`)

Restyle to new tokens, plus:
- **Recommendation callout**: winner avatar, name, score, and — new — a one-line
  *why*: `Won on Accuracy (4.8) and Depth (4.5); lost Concision to MiniMax M3.`
  The per-criterion data already exists in `ConsensusBreakdown`; the reference's
  "Smart recommendation" promise is unfulfilled without it.
- **Leaderboard rows**: rank numeral, avatar, name, per-criterion micro-bars, weighted
  score, latency, cost. Winner row gets cyan border + glow (the one glow allowed here).
  **Score bars share a common max** so lengths are comparable at a glance.
- **Margin indicator**: when the top two are within 0.2, show
  `Close call · 0.1 apart` — honest about noise instead of implying false certainty.
- **Criterion matrix**: models × criteria heat grid, values in mono. Dense, scannable,
  and the most "instrument-like" surface in the app.
- Inline `Fuse these N candidates into one answer` action (already implemented — keep).
- `FailedCandidates` stays visible so partial runs stay honest.

### 5.5 Compare view (new — delivers the reference's unkept promise)

The screenshot advertises "Side-by-side comparison: read responses in parallel with
detailed scores," then provides no surface for it. Build it:
- Toggle in the output header: `Leaderboard | Compare`.
- 2–3 columns, each a full candidate answer, **synchronized scrolling** (toggleable).
- Sticky per-column header: avatar, name, score, cost, latency.
- Sticky per-criterion score strip beneath the headers.
- Optional **diff highlighting** against the winner — shared claims dimmed, unique
  content full-contrast. The fastest way to see what each model actually added.
- Column pinning; hide a column to focus on two.

### 5.6 Fuse result (`FuseResult.tsx`)

Restyle, plus:
- **Provenance gutter**: a thin colored tick beside each paragraph indicating which
  candidate(s) it drew from; hover reveals the source. Makes fusion auditable rather
  than a black box — arguably the highest-value idea in this redesign, and entirely
  absent from the reference.
- Reading-optimized measure (~72ch), generous line height; `Markdown.tsx` unchanged.
- Sticky action bar: `Copy` · `Export .md` · word count · `Re-fuse`.
- Auto-suggest focus mode (§3.1) on completion.

### 5.7 Failure states

- **Insufficient candidates** (already implemented): keep the amber treatment; add a
  primary `Retry failed models` action rather than only telling the user to check slugs.
- **Judge / fusion error**: error card with the provider message, a `Retry judge` button,
  and — critical — **the candidates are still rendered below**. The current flow hides
  all generated work when the judge fails, discarding successful paid generations.
  Never throw away work the user already paid for.
- **Aborted run**: neutral state, keeps partial candidates, offers `Resume` / `Discard`.

---

## 6. Keyboard & Command Palette — make `⌘K` real

The reference draws a `⌘K` chip attached to nothing. For a single-operator power tool,
keyboard control is not garnish; it is the primary interface after week one.

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘Enter` | Run / re-run pipeline |
| `Esc` | Abort run (with confirm) · close palette/modal |
| `⌘\` | Toggle focus mode (collapse command pane) |
| `⌘/` | Toggle Rank ↔ Fuse |
| `⌘1` … `⌘9` | Toggle model *n* |
| `⌘F` | Focus task input |
| `⌘C` (result focused) | Copy winner / fused answer |
| `[` `]` | Previous / next candidate in Compare |
| `?` | Shortcut cheatsheet overlay |

**Palette contents** (`raised` surface, fuzzy-filtered): run/abort, toggle mode, add or
swap a model, add a rubric criterion, load a recent run, change judge, open connections,
export result, toggle focus mode. Grouped, with a `Recent` section on top.

Every shortcut is discoverable — shown as a `kbd` chip on its own control (as the Run
button does with `⌘ Enter`) and listed in the `?` overlay. **Shortcuts that only exist
in documentation do not exist.**

---

## 7. Motion Spec

`DESIGN.md` mandates minimal-functional motion (50–150ms). The reference is a static
image and specifies none, which is where most implementations go wrong — they either
add nothing or add everything.

| Element | Motion | Duration / easing |
|---|---|---|
| Hover / focus states | Color + border | 100ms `ease-out` |
| Checkbox toggle | Scale 0.9→1 + fill | 120ms `ease-out` |
| Panel / stage state change | Opacity + 4px translate | 150ms `ease-out` |
| Stage connector (active) | Dash-offset march | 1.2s linear, loop |
| Candidate cards reordering | FLIP transform | 200ms `ease-out` |
| Streaming cursor | Opacity blink | 1s step |
| Result reveal | Stagger rows 30ms apart, fade + 6px rise | 180ms `ease-out` |
| Run button progress fill | Width | 300ms `ease-out` |
| Palette open | Scale 0.98→1 + fade | 120ms `ease-out` |

**Rules:** never animate `width`/`height`/`top`/`left` — only `transform` and `opacity`.
No entrance animation on initial paint (the app should appear instantly). All of the
above collapse to instant under `prefers-reduced-motion`, which `src/index.css` already
enforces globally — extend the guard to cover the dash-march and FLIP transitions.

---

## 8. Responsive Behavior

The reference is a single 1024px-wide desktop composition. Define the rest.

| Breakpoint | Layout |
|---|---|
| `≥1536px` | Both panes; candidate grid up to 3 columns; Compare view 3 columns |
| `1280–1535px` | Both panes; candidate grid 2 columns |
| `1024–1279px` | Both panes; candidate cards stack; rail icons lose text labels |
| `768–1023px` | Panes stack vertically (command on top); rail becomes a top tab strip |
| `<768px` | Output is full-screen primary; command opens as a bottom sheet; Run button becomes a fixed bottom bar |

Ultra-wide (`≥1920px`): cap the output content measure at ~1100px and center it — do not
let a fused document stretch to 1800px of unreadable line length.

---

## 9. Performance Budget

Streaming multiple models into a React tree is the real performance risk, and no visual
spec survives a janky run.

- **Streaming re-renders:** `CANDIDATE_DELTA` fires per token per model. Batch deltas on
  a ~60ms rAF tick before dispatch, or the redesign's heavier cards will drop frames at
  3+ concurrent streams.
- Memoize candidate cards on `(id, status, streamingText.length)`; a token arriving for
  model A must not re-render models B and C.
- Virtualize the Compare view and any answer list beyond ~20 items.
- Keep total shipped icons tree-shaken (named `lucide-react` imports only).
- Targets: **60fps during streaming**, first paint <1s, interaction latency <100ms,
  no layout shift when scores land (reserve skeleton space).

---

## 10. Assets & Dependencies

- **Icons:** `lucide-react` (already a dependency — used in `OutputPane`/`FuseResult`) for file/network/shield/crown/trophy/bar-chart/award/play/plus/ellipsis/settings/help icons. Named imports only.
- **Logo mark + provider avatars:** small inline SVG set, new file `src/ui/brand-icons.tsx` (hex-cube logo; GLM, MiniMax, DeepSeek marks as monochrome glyphs on colored squares).
- **Fonts:** Geist + Geist Mono already in use — no change.
- **Tailwind:** extend theme (colors, radii, boxShadow `glow`, keyframes for dash-march).
- **CSS:** add `.glow-accent`, connector, and fade-mask utilities to `src/index.css`; extend the existing `prefers-reduced-motion` guard.
- **New state/storage (the only real data work):**
  - `src/lib/run-history.ts` — capped `localStorage` ring buffer of past runs
    (task excerpt, models, per-model score/latency/cost, winner, timestamp). Feeds model
    telemetry (§4.2), recent runs (§5.2), and the History rail item.
  - `src/lib/cost.ts` — token estimate + price lookup from `CatalogModel` for the
    Run-button forecast (§4.5).
  - `studio-engine.ts` — add `ABORT_RUN`, per-candidate `startedAt`/`finishedAt`/
    `tokensIn`/`tokensOut`, and an `AbortController` per request.
  - `src/studio-data.ts` — per-model `brandColor` + icon key.
- **No new UI framework.** Everything above is achievable with the current React +
  Tailwind + lucide stack. Add a headless primitive library only if the palette and
  dropdowns prove fiddly — do not pull in a component kit for styling reasons.

---

## 11. Implementation Plan — Phased

Ordered so that **every phase ships a coherent UI**. Phase 1 alone already matches the
reference; phases 2–4 are what surpass it.

### Phase 1 — Visual foundation (matches the reference)
1. **Tokens** — `tailwind.config.js`: palette/radii/shadows; `src/index.css`: glow, connectors, blue-tinted scrollbars.
2. **Shell** — `src/rsemble.tsx`: framed canvas + `rail | main` grid; new `src/ui/IconRail.tsx`.
3. **Header** — `src/ui/Header.tsx`: logo, status pill, palette/help buttons, `ModeToggle`, avatar.
4. **Command panel restyle** — `TaskInput`, `ModelList` (checkbox + brand avatar), `RubricDisclosure` (dashed add-row), `JudgeConfig`, `RunButton` (gradient + kbd chip).
5. **Output empty state** — `PipelineRail` (idle) + preview card + 3-up row.
6. **Sweep** — remove every `zinc-*` utility.

*Exit:* screenshot parity. No behavior change, no engine change.

### Phase 2 — Make the chrome real
7. Live `PipelineRail` during runs; restyled candidate stream with per-model timers.
8. Resizable/persisted split + focus mode (`⌘\`).
9. Real `Live` status pill wired to provider health; header progress bar.
10. Working command palette + full shortcut map (§6); `?` cheatsheet.
11. `AbortController` + Run-button stop/abort state.

*Exit:* nothing on screen is decorative.

### Phase 3 — Make it informative
12. `run-history.ts` + `cost.ts`; Run-button cost/time forecast; token counter.
13. Model-card telemetry (win rate, avg score, $/M, p50) with the no-history fallback.
14. Productive empty state (recent runs, presets).
15. Rank result upgrades: *why it won*, margin indicator, criterion matrix.
16. Rubric weights UI + preset chips + self-judge warning.

*Exit:* the UI tells you things you did not already know.

### Phase 4 — Differentiators
17. Compare view with synced scroll + diff highlighting.
18. Fusion provenance gutter.
19. Score sparklines; export (`.md` / `.json`).

*Exit:* delivers what the reference only advertises.

---

## 12. Acceptance Criteria

**Visual**
- Parity with the reference at ≥1440px for shell, both panels, and first-run empty state.
- Every layout in §8 renders without overflow or overlap at 375 / 768 / 1024 / 1440 / 1920px.
- No `zinc-*` classes remain. No text below 11px, and 11px only for uppercase eyebrows.
- At most two glowing elements on screen simultaneously (§2.2).

**Functional**
- All four output states (empty / running / result / failure) are implemented and reachable.
- Every affordance drawn is wired: `⌘K` opens the palette, the status pill opens connections, the Run button aborts, `Retry this model` retries.
- A run can be aborted mid-flight and leaves partial results intact.
- Judge failure still renders the successfully generated candidates.
- Cost/time estimate appears before the run and reconciles to actuals after.

**Accessibility**
- All interactive text ≥4.5:1; verified with an automated contrast pass, not by eye.
- 44×44px minimum targets; visible `:focus-visible` on every control.
- Rank/Fuse toggle is a real radiogroup; the splitter is a real `role="separator"`.
- Full keyboard path: configure → run → read → copy, with no mouse.
- Screen-reader run announcements via `aria-live="polite"` on stage transitions.
- No state communicated by color alone.
- Passes axe with zero critical/serious violations.

**Performance**
- 60fps with 3 models streaming concurrently (verify with a React Profiler trace).
- No layout shift when judge scores land.
- Reduced-motion disables dash-march, FLIP, blink, and stagger.

**Verification commands** (run locally — I cannot execute these for you):
```bash
npm run build          # type + build must pass clean
npx playwright test    # if/when e2e exists: state-by-state screenshots
npx @axe-core/cli http://localhost:5173
```
Suggested regression coverage: one Playwright screenshot per output state (empty-first-run,
empty-returning, running, rank result, compare, fuse, judge-error, aborted) at 1440px.

---

## 13. Decisions Needed Before Coding

| # | Question | Recommendation |
|---|---|---|
| 1 | Reinstate the left icon rail, contradicting DESIGN.md §Layout? | Yes — but only if Runs/History/Models/Judges/Settings are real or planned. Run history (§10) makes History and Models genuinely useful, which is the strongest argument for the rail. Update the DESIGN.md decisions log. |
| 2 | Gradient CTA vs "no decorative gradients"? | Allow one *functional* gradient on the single primary action; keep the ban on background/decorative gradients. |
| 3 | 3-up "what you'll get" grid vs the feature-grid anti-pattern? | Keep, **gated to first run only**. Its impermanence is what makes it education rather than marketing. Amend the clause to scope it to persistent layouts. |
| 4 | Do the rail items navigate anywhere in Phase 1? | No. Render them disabled with tooltips; enable as each view lands. Never fake navigation. |
| 5 | Theme (sun) button — light mode? | Cut it. DESIGN.md is dark-native; a button that toggles nothing violates the §0 principle. Re-add with an actual theme. |
| 6 | Run history in `localStorage` — acceptable? | Yes for a single-user local tool. Cap at ~200 runs, store excerpts not full answers, and expose a clear-history control in Settings. |
| 7 | How much of Phase 3/4 is in scope now? | Phases 1–2 are the redesign proper. Treat 3–4 as separately scheduled — but build Phase 1 components against the §10 data shapes so they don't need rewriting. |
| 8 | Keep the `Strong`/`Balanced`/`Creative` tags? | Only once derived from history (Phase 3). In Phase 1 either omit them or mark them clearly as catalog metadata. Hand-authored personality labels are the exact vanity data this spec removes. |

---

## 14. Summary — What Makes This Better Than the Screenshot

1. **The pipeline diagram becomes the progress bar** — decoration promoted to instrumentation.
2. **The empty state shrinks as you grow** — teaching first, then recent runs and presets.
3. **Cost and time are shown before you spend them.**
4. **Model cards show earned telemetry**, not marketing specs.
5. **All four run states are designed**, not just the idle one.
6. **Compare view and fusion provenance** deliver the promises the reference only prints.
7. **Every affordance is wired** — no fake `⌘K`, no fake status light.
8. **Contrast, keyboard, and motion are specified and testable**, not left to the implementer.
