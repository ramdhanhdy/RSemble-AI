# QA Report — Evaluations Identity & UX Upgrade

Generated against commit at or after `636af31` + mobile fix (see commits below).
Spec: `docs/specs/archive/evaluations-identity-ux/evaluations-identity-ux-spec.md`
Plan: `docs/specs/archive/evaluations-identity-ux/implementation-plan.md`

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck + tests + build | `npm run check` | ✅ pass |
| Unit suite | `npx vitest run` | ✅ 123 files, 1,706 tests |
| Suite-reliability CDP | `npm run qa:suite-reliability` | ✅ 3 consecutive passes |
| Design-motion CDP | `npm run qa:design-motion` | ✅ pass |
| Identity matrix CDP | `npm run qa:evaluations-identity` | ✅ 7/7 probes |

Evidence: `results.json` + screenshots in this directory.

## Browser matrix (`cdp-evaluations-identity-qa.mjs`)

Deterministic seed: one rubric ("Clarity", 1 criterion), one workload pinned to it
("Matrix Suite", with a completed experiment driving the latest-run line), one
holistic workload ("Holistic Suite"). No provider calls — nothing runs.

| Probe | Viewport | Result | Key assertions |
| --- | --- | --- | --- |
| desktop-1440 | 1440×1000 | ✅ | no overflow; Workload eyebrow; `Rubric Clarity v1` chip → `#/evaluations/profiles/prof-matrix`; Holistic chip; latest-run line; 2 nav sublabels (active visible); archive slot `min-width: 136px` |
| tablet-1024 | 1024×768 | ✅ | same grammar holds |
| tablet-portrait-768 | 768×1024 | ✅ | same grammar holds |
| mobile-390 | 390×844 (2× DPR, touch) | ✅ | icon-only chips/eyebrow keep the title column legible; no overflow |
| profiles-1440 | 1440×1000 | ✅ | Rubric eyebrow, Reusable status, criteria preview |
| zoom-200-percent | 720 CSS px | ✅ | identity grammar legible, no overflow |
| reduced-motion | prefers-reduced-motion | ✅ | spinner rotation removed (`animation-name: none`), no overflow |

Screenshots: `qa-desktop-1440.png`, `qa-tablet-1024.png`,
`qa-tablet-portrait-768.png`, `qa-mobile-390.png`, `qa-profiles-1440.png`,
`qa-zoom-200.png`, `qa-reduced-motion.png`. Visual review confirmed: titles
visible in all rows, chips and eyebrows legible, no clipped text or inner
scrollbars, desktop alignment stable.

## Findings fixed during QA (root-caused, not waived)

1. **Mobile title crushed to 0px at 390px.** The trailing action cluster
   (rubric chip 79px + copy 44px + archive slot 136px ≈ 259px) left the row's
   content card too narrow for eyebrow + status + title. Fix:
   - `KindEyebrow` renders icon-only below `sm` (tooltip still teaches the kind);
   - `ProfileRefChip` renders icon-only below `sm` (aria-label/title carry meaning);
   - archive slot's `min-w-[136px]` floor became `sm:min-w-[136px]` (geometry
     contract test updated with a comment). Desktop/tablet geometry unchanged.

2. **Mobile meta-line overshoot (141px past the card edge).** Task 5's
   `afterSummary` cluster and the `ml-auto` models/time cluster are both
   `shrink-0`; at phone widths they cannot share one line, so the right cluster
   spilled outside the card (clipped "993d ag…", inner scrollbar). Fix: meta
   line now carries `flex-wrap` + `gap-y-0.5`, dropping the time cluster to a
   second meta line on narrow widths. Desktop layout unchanged where content fits.

3. **Suite-reliability scenario 10 flake.** One run reported
   `dialog-keyboard-focus: tabTrapped=false` (connection-status dialog focus
   trap). Bisect: a focused diagnostic replayed scenario 10's steps 3× against
   the current build, the pre-identity baseline `4c07d88`, and the QA-era
   `5eeebf7` — the trap held 9/9 rounds on all three, in isolation. The dialog
   is Header/Base UI territory untouched by this upgrade, and 3 consecutive
   full-harness runs passed. Classified as a timing flake under accumulated
   harness state, not a regression.

## Known non-issues

- `993d ago` timestamps and "1 models" grammar are seed-data artifacts of the
  deterministic fixtures, not layout defects.
- Chip/eyebrow text asserts on `aria-label`/`title` attributes below `sm`
  because the words are intentionally hidden there (innerText excludes them).
