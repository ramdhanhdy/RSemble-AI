# Runs workspace - edge-state review

Task t_8cc78e90. Browser-level QA (Chrome headless via CDP) of Runs workspace
edge states, driven by `scripts/cdp-runs-edge-qa.mjs` against the dev server
with deterministic IndexedDB fixtures (`scripts/_debug-seed.mjs`). No provider
calls.

## Coverage

| Area | Probes |
| --- | --- |
| A. Row states | every RunStatus (running, completed, partial, failed, aborted, interrupted), legacy rows, selected-row treatment, winner/score summaries, source chips |
| B. Detail evidence | header/status/mode/timestamps, status timeline per state, outcome, cost breakdown, candidate selector + selected output, judge evidence (accepted/historical/evaluations), fusion result, experiment provenance, reused-output provenance, task/config disclosure |
| C. Deep links | /runs/:id desktop + mobile, ?candidate= focus, ?attempt= accepted/historical, invalid candidate/attempt notices, unknown run id, legacy detail |
| D. Zero results | empty DB, search no-match + clear recovery, filter no-match + clear recovery, no-history leak guard |
| E. No-run state | desktop no-selection placeholder, unknown-id not-found (desktop + mobile) |

## Findings fixed in this review

- Zero-match queries collapsed into the no-history empty state (BL-3): added a
  distinct "No matching runs." state with one-click "Clear search and filters"
  reset (`RunList.tsx`).
- The no-match state now keeps the search/filter bar interactive with the
  applied-count badge visible, so users can refine instead of only resetting.
- Detail page: added the status timeline section (header -> timeline ->
  outcome) with per-status lifecycle labels; aborted runs read "aborted by
  user" (never "pending"), and an idle judge on a terminal run reads "not run"
  (`RunDetail.tsx`, `run-view-model.ts`).

## Result

32/32 probes pass, 16 screenshots, zero console errors. Latest run:
`results.json` in this directory.
