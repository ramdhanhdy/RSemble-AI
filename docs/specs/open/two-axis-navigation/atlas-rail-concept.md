# Atlas — Collapsible Rail Concept

> **Status: PROPOSAL — not a spec amendment.** Written 2026-08-24 in
> response to user review of Concept Meridian (`design-concept.html`):
> the floating capsule feels cramped and disturbs visibility, and the
> Single/Suite toggle repeating on every surface makes the whole two-axis
> concept feel confusing. This document formalizes those findings,
> states what survives from `two-axis-navigation-spec.md`, and proposes
> the replacement chrome. Validate with the same first-click protocol
> (§N of the spec) before any amendment is authored.

---

## A. The two review findings

### A.1 The floating cluster competes with working surfaces

- Compare is a split-pane instrument (command pane + output pane) and
  Benchmark is a 760px-min matrix. Both want full-bleed canvas. A sticky
  floating capsule permanently occupies the top-center — the highest-value
  region — and visually overlays content while scrolling.
- The information architecture is genuinely two levels deep (subjects →
  cells; Strategies → Studies/Recipes/Model Pools; Benchmark →
  Task Sets/Rubrics). A one-row capsule structurally cannot display
  depth; a rail can.
- Navigation density: wordmark + two dials + four utilities + live pill
  in 58px is 8+ interactive elements in one row. It wraps below 780px in
  the concept. Vertical chrome has room to breathe; horizontal chrome
  does not.

### A.2 Two segmented controls as primary navigation force computed navigation

- Users navigate by **recognizing a goal** ("test these models on this
  task"), not by **computing coordinates** (subject × scope). The dials
  are the designer's ontology rendered as widgets. Recognition beats
  recall; a coordinate system is pure recall plus arithmetic.
- A segmented control that renders *state* invites *state-flipping* —
  "what does Single/Suite do on this page?" — when it is actually a
  navigation link. The same control appearing on every surface reads as
  a per-page setting, which is exactly the confusion the review
  reported.
- The matrix implies users flip axes freely and uniformly. In practice
  the real cross-cell transitions are few and contextual (spec §F):
  Compare → Benchmark, Compare → Calibrate, Calibrate → Policy Study,
  Benchmark → Policy Study. These are workflow escalations, and they
  already have carry semantics. They belong on the surfaces as actions,
  not in global chrome as axis flips.

---

## B. The verdict

> **Axes organize; links navigate; surfaces escalate.**

- **Keep the ontology.** The subject × scope taxonomy fixed the
  Lab/Evaluations category overlap and gave Calibrate a home. The
  renames alone (Benchmark, Policy Study, Calibrate) carry most of the
  first-click win the spec was after (§B.1, §A.4).
- **Drop the mechanism.** No global subject or scope controls anywhere.
  Every destination is a named, one-click link, grouped so the axis
  structure is *visible* without being *operated*.
- **Escalate in context.** Cross-cell movement happens through the
  contextual actions the surfaces already specify (§F2–F5, §G.3.4):
  "Create a Task Set from this task", "Calibrate this pool",
  "Test across a Task Set", "Policy Study on this set".

---

## C. The concept — the Atlas rail

A collapsible left rail replaces the AxisBar (spec §E) and the floating
capsule. All Meridian material/motion language carries over; only the
chrome geometry changes.

```
┌──────────────────────────────────────────────────────────────┐
│ strip: live-run pill · search · attention · palette          │  44px, not floating
├──────────────┬───────────────────────────────────────────────┤
│ ◧ RSemble  ⏴ │                                               │
│              │   surface (full canvas, no floating chrome)   │
│ TESTING      │                                               │
│            One task  Task set                                │
│ Models   ┌─────────┬─────────┐                               │
│          │ Compare │Benchmark│  ← current cell highlighted   │
│          ├─────────┼─────────┤                               │
│ Strategies│Calibrate│ Studies│                               │
│          └─────────┴─────────┘                               │
│              │                                               │
│ LIBRARY      │                                               │
│ Observatory  │                                               │
│ Records      │                                               │
├──────────────┤                                               │
│ ⚙ settings   │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

### C.1 The matrix map (replaces both dials)

- The 2×2 is rendered as a **clickable map**: four named cells under
  row headers *Models / Strategies* and column headers
  *One task / Task set*. The taxonomy is spatial and self-teaching —
  the structure explains itself; nothing is computed, nothing flips.
- **One click to any cell.** The current cell highlights (existing
  static accent treatment, non-hue-only, per Child 08 law — no
  animation).
- Compare sits top-left: home position, matching the `/` → `/compare`
  default. Reading order matches frequency of use.
- Column headers use plain language ("One task", "Task set"), not the
  internal `single | suite` vocabulary — descriptors over jargon.
- **Fallback if first-click testing shows friction:** a grouped list
  (MODELS: Compare, Benchmark · STRATEGIES: Calibrate, Studies) with
  one-line descriptors ("one task, many models" / "task set, finish
  policies"). The descriptors encode the axes in prose; the win is the
  same. The map is preferred because it teaches the rule spatially.

### C.2 Rail mechanics

- **Expanded** (~248px): default at ≥1200px viewports. Wordmark,
  collapse control, matrix map, library group, settings at the foot.
- **Icon mode** (~56px): automatic at 768–1199px and user-collapsible
  at any width. Cells become four icon buttons with tooltips and
  accessible names carrying the full descriptor ("Benchmark — models
  across a task set"). One keystroke or button toggles collapse; state
  persists per session.
- **Drawer** (<768px): the rail becomes a drawer from a leading-edge
  trigger, plus a compact bottom bar carrying the four testing cells
  (thumb zone). See amendments (§F).
- Width math: at 1440px with the rail expanded, surfaces keep ~1192px —
  more than Meridian's 1180px stage. In icon mode the rail costs 56px —
  strictly cheaper than any top cluster. Benchmark's 760px matrix fits
  in both modes at ≥1024px.

### C.3 The top strip

- Slim (~44px), edge-anchored, **not floating**: global execution
  awareness (live pill, Child 08 §C.4 and spec §F7), Search, Attention,
  palette, settings. No navigation lives here. The strip never grows;
  orientation lives in the rail.

### C.4 Surface chrome

- The Meridian eyebrow survives as wayfinding ("Models · One task —
  Compare"), so the axis of the current surface is stated on the
  surface itself.
- Escalation actions render in surface headers and rows (§F2–F5,
  §G.3.4) — these are the only sanctioned cross-cell transitions.
- Rank/Fuse `ModeToggle` stays Compare-interior only (spec §C.2b —
  unchanged).

---

## D. What stands from `two-axis-navigation-spec.md`

| Spec section | Status under Atlas |
| --- | --- |
| §C.1–C.2 axis definitions, independence correction, pool visibility | **Stands** — as grouping, labels, and headers, not controls |
| §C.3 vocabulary and renames (Benchmark, Policy Study, Calibrate, Observatory) | **Stands** verbatim |
| §C.4 cell map | **Stands** — the matrix map renders it literally |
| §D route map, redirects, Records crosswalk | **Stands** — URL is still the state (§E2.5 re-expressed: the map reflects the URL; no stored axis state) |
| §F state carry F1–F7 | **Stands** — F2–F5 become visible surface actions |
| §G four surfaces, incl. all of Calibrate's honesty laws | **Stands** in full |
| §H strategy assets as in-surface sub-nav | **Stands** — assets stay one level inside their subject's surfaces |
| §I non-testing surfaces, scent rules | **Stands** |
| §K accessibility | **Stands**; radiogroup semantics replaced by standard nav-link semantics (`aria-current="page"`), which is simpler and more conventional |
| §N first-click validation | **Stands** — same protocol, run against the rail |

## E. What Atlas replaces or amends

1. **§E AxisBar (two segmented controls) → deleted.** Replaced by the
   rail + matrix map. `WorkspaceNav`/`MobileWorkspaceNav`/`AxisBar`
   are all superseded by one `AtlasRail` component.
2. **§J responsive rules → re-specified** per C.2 (rail breakpoints,
   drawer + bottom bar on mobile).
3. **Child 08 §C.2 (Records is never primary nav) → amended, openly:**
   Records earns a LIBRARY slot in the rail, grouped subordinate to
   Testing, while the quick drawer stays for speed. Rationale: with a
   rail, hiding Records while showing Observatory is an inconsistency;
   a grouped, subordinate slot preserves the "utility, not destination"
   spirit. If this amendment is unacceptable, Records stays
   drawer-only and nothing else in Atlas changes.
4. **§J mobile bottom nav → reinstated** in compact form (four testing
   cells only), reversing the two-axis retirement. Reason: a drawer
   needs a persistent trigger, and the four cells are the whole mobile
   nav job.

## F. Open questions (decide before amendment)

1. Matrix map vs grouped list (§C.1) — settle with the first-click
   protocol, not taste.
2. Records rail slot (§E.3) — yes/no.
3. Whether "Suite" retiree vocabulary is purged from all chrome in
   favor of "Task set" (Atlas headers already do).

## G. Next steps

1. React to this concept; adjust or reject.
2. ~~Build a Meridian-grade interactive HTML concept of the rail~~ — done:
   [`atlas-rail-concept.html`](./atlas-rail-concept.html) (rail + matrix map,
   icon mode, escalation links, mobile drawer + bottom bar, annotation sheet).
3. Author the amendment against `two-axis-navigation-spec.md` §E/§J
   and the flagged Child 08 laws; then the standard authorization cycle.
