# Two-axis navigation — OPEN, not implemented

> **Do not implement from this folder.** Nothing here is authorized, shipped,
> or fixed. The live app is still Child 08 chrome:
> **Compare · Evaluations · Lab · Models** in the top header
> (`src/ui/WorkspaceNav.tsx`). There is no AxisBar, no Atlas rail, no
> `/calibrate`, no `/benchmark`, no `/strategies`.

This folder is a workshop. Several agents are still writing into it. Add new
concept files here. **Do not edit a file another agent is mid-draft on.**

Canonical path: `docs/specs/open/two-axis-navigation/`
Old path (empty on purpose): `docs/specs/pending/two-axis-navigation/` — that
location meant “waiting to execute.” This work is not there yet.

---

## What is actually in the product today

| Surface | Route | Role |
| --- | --- | --- |
| Compare | `/compare` | One task, several models, Rank/Fuse |
| Evaluations | `/evaluations` | Task Sets + Rubrics, model × suite matrix |
| Lab | `/lab` | Policy Studies + Recipes + Model Pools |
| Models | `/models` | Read-only observatory |
| Records | `/records` | Secondary ledger, not primary nav |

No two-axis chrome. No Calibrate surface. No route renames.

---

## Files in this folder (do not treat as a stack to execute)

Listed in the order they appeared on 2026-08-24. None of these is authority
until the user accepts one direction and authorizes a cycle.

| File | What it is | What it is not |
| --- | --- | --- |
| [`two-axis-navigation-spec.md`](./two-axis-navigation-spec.md) | First written contract: subject × scope, AxisBar of two dials, four cells (Compare · Benchmark · Calibrate · Policy Study), new Calibrate surface, `/evaluations`→`/benchmark` and `/lab`→`/strategies` redirects. Status line inside the file already says PENDING — not executed. | Not accepted. Not a ship order. The AxisBar / dual-toggle chrome is the thing under review. |
| [`design-concept.html`](./design-concept.html) | Interactive “Concept Meridian” — floating capsule, two dials (Models\|Strategies × Single\|Suite). Companion to the spec above. | Not a production surface. Review of this mockup is what opened the chrome question. |
| [`atlas-rail-concept.md`](./atlas-rail-concept.md) | Proposal only (its own header says so). Keeps the 2×2 ontology, drops the dials, puts a clickable matrix map in a collapsible left rail. Does not amend the spec. | Not a spec. Not implemented. Open questions still listed in its §F. |
| [`jobs-not-dials.html`](./jobs-not-dials.html) | Interactive concept: named jobs in a collapsible sidebar, no Single/Suite control, Calibrate nested under Strategies. Same review, different chrome stance than Atlas. | Not a spec. Not implemented. Not authority. |

Two later files argue with the first spec’s **chrome**, not with the
existence of Compare / Benchmark / Calibrate / Policy Study as jobs. They
disagree with each other on how loud the 2×2 should be (Atlas: visible
matrix map; jobs-not-dials: grouping only). That disagreement is why this
folder is `open/`, not `pending/`.

---

## What is still unsettled

- Primary chrome: floating dials, rail + matrix map, or named-job sidebar
- Whether Single/Suite (or One task/Task set) is a control, a map, or only a verb
- Whether Calibrate is a top-level peer or a child of Strategies
- Whether Records belongs in a rail
- All route renames and the Calibrate surface — blocked until chrome is chosen

---

## Rules for agents working here

1. **Do not implement.** No `src/` changes, no route moves, no nav component
   rewrites, no “just wire the rail.”
2. **Do not edit the files in the table above** unless the user names that
   file. They are mid-iteration by different authors.
3. **New takes go in new files** in this folder (`*-concept.md` or
   `*-concept.html`). Date them. Mark the first line as proposal / concept /
   not a spec amendment.
4. Promotion out of `open/` happens only when the user accepts one direction
   and authorizes a cycle. Then a single contract moves to `pending/` and
   everything else stays here as provenance.
