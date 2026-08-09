# Runs Workspace - Accessibility Review

Generated: 2026-08-09. Task: t_416739f3 (Accessibility review).
Driver: `scripts/cdp-runs-a11y-qa.mjs` (Chrome headless over CDP, fixtures seeded
directly into IndexedDB; no provider calls). Full probe data in `results.json`,
screenshots `01`-`06` in this directory.

## Scope

Verify focus rings (visible keyboard indicator on every stop), keyboard
navigation (real Tab-key walk, every control reachable), screen reader labels
(accessible names, no skipped headings, selected state exposed, decorative
separators hidden), 44px touch targets, and deep-link focus behavior
(`/runs/:id?candidate=&attempt=`).

## Verdict

PASS after four fixes applied during review (all verified after fix).

| Area | Result |
| --- | --- |
| Focus rings | PASS (1 fix) |
| Keyboard nav | PASS (1 fix) |
| Screen reader labels | PASS (2 fixes) |
| 44px targets | PASS |
| Deep-link focus | PASS |

## Verified behaviors

- Desktop list: Tab reaches header nav, connection status, command palette,
  shortcuts, search input, filters toggle, every run row, Load more, Export,
  Import, and the detail-pane actions - all with a visible focus indicator.
- Desktop detail: candidate selector rows are Tab-reachable (both candidates),
  plus Open in Compare, Copy link, experiment breadcrumbs, and the
  Task & Configuration disclosure.
- Accessible names present on all interactive controls; none inside
  aria-hidden subtrees; heading levels 2-3-3-3-3-4 with no skips.
- All Runs-region interactive controls are >= 44px tall (the only sub-44
  control in the shell is the hidden Import file input, height 1px, expected).
- Deep link `#/runs/run-exp-2?candidate=cand-s2&attempt=judge-att-2` lands
  keyboard focus on the linked candidate row (aria-pressed=true, visible ring,
  scrolled into view), highlights the linked judge attempt panel, shows
  "Selected attempt" and "Label: B", and marks the selected row in the list.
- Degraded deep link (`?candidate=does-not-exist`) shows the
  "Linked candidate not found" notice and still renders the overview; nothing
  throws.
- Phone (390px): Back to Runs is the first detail control, candidate rows are
  Tab-reachable, the filter sheet opens with keyboard-only Enter, all sheet
  controls are Tab-reachable and >= 44px.
- No uncaught exceptions or console errors across all probes.

## Findings and fixes

1. FIXED - Candidate selector rows removed from the keyboard tab order. The
   candidate buttons in `src/workspaces/runs/RunDetail.tsx` carried
   `tabIndex={-1}` (a leftover of the deep-link focus work, which only needs
   programmatic focus). Keyboard users could not select a candidate at all.
   Fix: removed `tabIndex={-1}`; the rows are now Tab-reachable on desktop and
   phone while programmatic deep-link focus still works. Probes
   `a11y-03-detail-tab-order` and `a11y-12-phone-detail-tab-order`.
2. FIXED - Search input had no visible keyboard focus indicator. The search
   field in `src/workspaces/runs/RunFilters.tsx` only tinted its border on
   focus (border-color change is not a detectable ring). Fix: added
   `focus-visible:ring-2 focus-visible:ring-accent`. Probe
   `a11y-04-focus-indicators`.
3. FIXED - Selected run row not exposed to assistive tech. The selected row
   rendered an sr-only "Selected" span, but the row link itself carried no
   `aria-current`, so a screen reader could not tell which row is selected
   while moving through the list. Fix: additive optional `ariaCurrent` prop on
   the shared `RecordRow` (no behavior change for existing consumers) and
   `aria-current="true"` on the selected row in `RunList.tsx` (`"true"` is the
   in-a-set selected state; `"page"` remains reserved for route-level nav per
   the existing unit test). Probe `a11y-09-selected-row-sr`; unit test added
   in `RunList.test.tsx`.
4. FIXED - Legacy detail read a literal "middot" to screen readers. The
   decorative `·` separator in `src/workspaces/runs/LegacyRunDetail.tsx` was
   announced as "middot". Fix: `aria-hidden="true"` on the separator span.
   Probe `a11y-11-legacy-detail`.

## QA driver notes

- The CDP key-event path in headless Chrome does not run button activation for
  Enter unless the keydown carries a text payload; `pressKey` now passes
  `text: "\r"` for Enter (Space activates via keyup without it). Without this
  the keyboard-only filter-sheet probe timed out even though the toggle was
  focused (probes `a11y-13`/`a11y-14`).
- Seed before mounting the runs view: the desktop list reads IndexedDB once on
  mount, so the driver seeds at the root route before navigating to `#/runs`.

## Validation after fix

- QA script: 15/15 probes PASS (desktop list/detail, focus indicators,
  accessible names, 44px targets, deep-link focus + degraded path, selected
  row, heading order, legacy detail, phone detail + keyboard filter sheet,
  no uncaught exceptions).
- Responsive QA (`scripts/cdp-runs-responsive-qa.mjs`): 18/18 probes PASS
  after the same source changes (no responsive regression).
- `npm test`: 149 files / 2321 tests PASS (includes the new aria-current
  test).
- `npm run lint`: clean. `npx prettier --check`: clean.
  `npm run typecheck:web`: clean.

## Artifacts

- `scripts/cdp-runs-a11y-qa.mjs` - repeatable QA driver (`node scripts/cdp-runs-a11y-qa.mjs`, CHROME_PATH / QA_BASE_URL env overrides).
- `docs/qa/runs-accessibility/results.json` - full probe output.
- `docs/qa/runs-accessibility/*.png` - screenshots: desktop list, deep-link
  focus, desktop detail, legacy detail, phone detail, phone filter sheet.
