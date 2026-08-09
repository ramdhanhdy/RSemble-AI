# Runs Workspace - Responsive / Mobile Review

Generated: 2026-08-09. Task: t_3b2cc789 (Responsive/mobile review).
Driver: `scripts/cdp-runs-responsive-qa.mjs` (Chrome headless over CDP, fixtures seeded
directly into IndexedDB; no provider calls). Full probe data in `results.json`,
screenshots `01`-`11` in this directory.

## Scope

Inspect the Runs workspace at wide desktop (1440x900), the 1024px transition,
tablet (768x1024), and phone (390x844). Verify route-based mobile detail and the
filter sheet.

## Verdict

PASS with two small fixes applied during review (both verified after fix).

| Viewport | Layout | Result |
| --- | --- | --- |
| 1440x900 wide desktop | Split: 380px list pane + detail pane | PASS |
| 1024x768 (boundary) | Desktop split retained (`min-width: 1024px`) | PASS |
| 768x1024 tablet | Route-based: list at `/runs`, detail at `/runs/:id` | PASS |
| 390x844 phone | Route-based detail + filter sheet | PASS (2 fixes) |

## Verified behaviors

- Desktop split: list pane is exactly 380px; selecting a run renders detail in the
  right pane; no Back button; no horizontal overflow.
- 1024px is the desktop side of the transition (split layout intact at exactly
  1024px; no overflow).
- Tablet/phone list-only route: no detail pane, no placeholder leak, no Back button.
- Route-based detail on tablet/phone: row tap navigates to `/runs/:id`; detail
  renders with "Back to Runs"; Back returns to `/runs`; direct deep links
  (`/runs/:id`) render detail with Back.
- Legacy summary detail renders on phone with the limitation notice.
- Filter sheet on phone: toggle button + search always visible; opening the sheet
  shows Model/Status/Mode/Source selects + Clear filters; applied-count badge
  increments (1 then 2); combined filters return the expected row; Clear restores
  all rows and clears the badge; second toggle closes the sheet.
- No horizontal overflow at any viewport (list and detail).
- No uncaught exceptions or console errors during any scenario.
- All interactive controls meet the 36px+ tap-target floor (0 small targets found).

## Findings and fixes

1. FIXED - Candidate rows clipped at 390px. In the CANDIDATES section the second
   candidate's attempt count ("1 attempt" / "0 attempts") was clipped at the row's
   right edge (`src/workspaces/runs/RunDetail.tsx`). The row button is a flex row
   without wrap; the long `deepseek/deepseek-v4-flash` label squeezed the
   `ml-auto` count below min-content. Fix: `flex-wrap` on the candidate row button.
   Regression probe `phone-390-candidate-rows-no-clip` added to the QA script;
   verified visually (11-phone-390-candidates-after-fix.png).
2. FIXED - Legacy detail metadata wrapped mid-word at 390px
   (`src/workspaces/runs/LegacyRunDetail.tsx`): "7/22/2023, 4:26:40 AM" split
   ("AM" alone on line 2) and "1115d ago" split ("ago" alone). Fix: `flex-wrap`
   on the metadata row so wrapping happens at item boundaries. Verified visually
   (10-phone-390-legacy-detail.png).
3. OBSERVED, non-issue - On phone the runs list is one scroll region (search +
   list + Export/Import footer scroll together); the footer sits in normal flow
   below the content and its bottom ~5px tuck under the fixed bottom tab nav at
   the rest position. This clears when scrolling; no content is unreachable. No
   change made.

## Validation after fix

- QA script: 18/18 probes PASS (includes the new no-clip regression probe).
- `npm test`: 149 files / 2320 tests PASS (includes RunDetail 34, RunList 10,
  RunsWorkspace 5).
- `npm run lint`: clean. `npx prettier --check`: clean. `npm run typecheck:web`: clean.

## Artifacts

- `scripts/cdp-runs-responsive-qa.mjs` - repeatable QA driver (`node scripts/cdp-runs-responsive-qa.mjs`, CHROME_PATH / QA_BASE_URL env overrides).
- `docs/qa/runs-responsive/results.json` - full probe output.
- `docs/qa/runs-responsive/*.png` - screenshots at every viewport state.
