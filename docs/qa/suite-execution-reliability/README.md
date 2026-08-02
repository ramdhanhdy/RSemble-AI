# Suite Execution Reliability — QA Evidence

Automated + browser verification for `docs/specs/suite-execution-reliability/`.

## Gates

```bash
npm run check
git diff --check
```

## Browser QA

```bash
npm run build
npm run preview -- --host 127.0.0.1
npm run qa:suite-reliability   # deterministic fixtures only — no paid provider calls
npm run qa:design-motion
```

`qa:suite-reliability` drives Chrome headless over CDP against the production
preview. Provider fetches are mocked in-page; suite/experiment/run records are
seeded into IndexedDB with the exact persisted shapes the app's runtime
validators accept. The script fails nonzero on the first unmet assertion and
never prints credentials.

## Scenarios covered

1. Compare exposes exact-model test actions and the request-cost notice; a mocked
   streaming route reaches `Ready`.
2. A mocked unauthorized probe renders sanitized failure copy without leaking
   credential-shaped values. Failed suite preflight lists the failures, requires
   explicit `Run anyway`, offers `Review tests`, and never silently runs a
   ready-only subset.
3. The complete-coverage winner is `4.38 · 15/15`; the higher raw-mean
   `4.54 · 14/15` route is shown as provisional and receives no numeric rank.
4. Cell recovery previews exact candidate/Judge call counts and explains output
   reuse. Confirming the repair creates freshly judged evidence and clears only
   the missing `t1` cell.
5. A forced Judge failure creates a terminal repair attempt but keeps the better
   prior `t2` attempt selected, leaves the cell unscored, and keeps recovery
   available.
6. A 250-task running ledger mounts 50 primary rows, keeps controls before the
   ledger, and leaves attempt history collapsed initially.
7. Ledger pagination reaches `201–250 of 250`; expanding one disclosure mounts
   its current and historical failed attempts.
8. A 250-task results matrix mounts 50 rows, keeps its first column and headers
   sticky, and provides a keyboard-focusable scroll region.
9. Mobile results mount 50 cards, paginate to `51–100 of 250`, and introduce no
   page-level horizontal overflow.
10. Dialog focus enters on open; Escape closes the dialog and restores focus to
    its trigger.
11. Effective 200% CSS zoom introduces no page-level horizontal overflow.
12. Reduced-motion mode removes spinner rotation while preserving visible
    status.

The corresponding unit/contract suites cover exact-route preflight, strict
shared SSE handling with 9Router clean-EOF normalization at the bridge boundary,
ranking, recovery compatibility, selected-attempt policy, pagination, lease
ownership, geometry, focus, and reduced motion.

## Evidence

- `results.json` — probe results with timestamps and pass/fail per scenario.
- Screenshots under this directory — one per scenario.
- All generated reliability and design-motion screenshots were opened and
  inspected. Evidence was recaptured after correcting stale repair, matrix, and
  attempt-history framing; no clipping, contradictory ranking, page-level mobile
  overflow, or content-sized task rows remain in the accepted captures.
- Reduced-motion acceptance is grounded in the computed-style probe
  (`spinnerAnimation: "none"`); its static screenshot verifies the resulting
  layout rather than motion over time.

## Actual gate output (recorded 2026-08-02)

- Focused reliability transport gate — PASS: 3 files, 41 tests.
- `npm run check` — PASS: web and server typechecks, 120 Vitest files / 1,673
  tests, and production build.
- `git diff --check` — clean.
- `npm run qa:suite-reliability` — exit 0; 18 structured probes passed and 16
  screenshots generated against the production preview.
- `npm run qa:design-motion` — exit 0; 20 structured probes passed and 15
  regression screenshots generated.
