# Runs UI - Final Visual Parity Review

Task: t_f95b93e6 (Final visual parity review)
Date: 2026-08-10 (refreshed after Slice 3)
Branch: feat/runs-fairness-baseline, post-Slice-3 checkpoint (base d0b62a1)
Reference: docs/explorations/runs-ia/prototypes/prototype-production-transplant-map.md (Visual Success Criteria)

## Method

- Driver: scripts/cdp-runs-visual-parity.mjs - 18 computed-style probes against the
  production app (vite dev server, seeded deterministic 11-run corpus) and the
  baseline HTML prototype (baseline-standalone.html on a local static server).
- Evidence: results.json (numeric computed styles) + 6 screenshots in this directory.
- Visual pass: screenshots inspected via vision model, targeted at each criterion.
- Regression guardrail: full repository check passes, including 149 test files /
  2327 tests, lint, web/server typechecks, and production build.

## Verdict

PASS. All 9 prototype visual success criteria are met (2 with documented,
non-blocking residuals noted below). 18/18 numeric probes pass; console clean
(0 errors).

## Visual Success Criteria

1. Less "cards floating inside cards" - PASS (residual O2)
   prod.list.surface: pane is a solid panel surface (bg rgb(18,18,18)) with a
   1px edge border-right split; no padded card-in-card wrapper remains. Zoom
   inspection confirms rows are flush-stacked with zero flex gap (listGap
   normal/normal), so the pane no longer reads as cards inside cards.

2. Clearer pane hierarchy (border-driven, not gap-driven) - PASS
   Split is a single 1px solid rgb(38,38,38) border-right; list rows stack
   flush with no inter-row gap (ul flex-col, no gap), matching the prototype's
   border-driven composition.
   The desktop pane now keeps search plus Model, Status, Mode, and Source visibly
   integrated above the list; the mobile filter toggle is hidden at desktop.

3. Denser but still readable run scanning - PASS
   prod.list.density: 11 rows, heights 64-86px, mean 74px vs prototype baseline
   84px - inside the +-25% tolerance band. Two-line rows (title + meta) remain
   readable; vision pass confirms compact scanning without crowding.

4. Source and status understood at a glance - PASS
   Consistent left-aligned chip + status column: SourceChip (ad hoc = cyan,
   experiment = amber, legacy = muted) + StatusMark colored dot/label. Vision
   pass confirms both are scannable without reading titles.

5. Stronger selected-record state (left-edge accent) - PASS
   prod.detail.selectedRow: raised bg rgb(24,24,24) + inset 2px #00e5ff accent
   via box-shadow, text rgb(237,237,237). Matches the prototype treatment
   (raised bg + 2px accent left border). Visible in 04-prod-list-selected.png.

6. Cleaner detail header with deliberate metadata hierarchy - PASS
   prod.detail.sections: 4 meta lines; vision pass confirms reading order
   badges -> title -> meta line -> action buttons. Slice 5 toolbar (Open in
   Compare, Copy link) present.

7. More polished spacing rhythm in detail - PASS
   prod.detail.timeline / costCards: uniform uppercase section headers, aligned
   card grids, consistent vertical rhythm; vision pass reports no overlap or
   misalignment in the detail panel.

8. Stronger continuity between list and detail - PASS
   prod.continuity.split: desktop split keeps the list visible with the
   selected accent while detail renders; both panes share one surface separated
   by the hairline split. Visible in 04-prod-list-selected.png.

9. Cyan accent used selectively, not everywhere - PASS
   prod.list.cyanSelective: 27 cyan elements vs prototype's own 19 (within the
   1.75x tolerance); prod.detail.cyanSelective: 32 vs 23. Samples show cyan
   only on source chips, status (running), selection accent, and active nav -
   never body text, borders, or metadata.

## Numeric probe results (fresh run, current HEAD)

18/18 PASS: proto.list.surface, proto.list.density, proto.list.cyanSelective,
proto.detail.selectedRow, proto.detail.hierarchy, proto.detail.cyanSelective,
prod.list.surface, prod.list.density, prod.list.filtersVisible,
prod.list.cyanSelective, prod.detail.selectedRow, prod.detail.sections,
prod.detail.toolbar, prod.detail.costCards, prod.detail.timeline,
prod.detail.cyanSelective, prod.continuity.split, prod.console.clean.
Console errors: 0. Screenshots: 6 (01-06 in this directory).
`prod.list.filtersVisible` now verifies the search input and all four visible
desktop selects (`model`, `status`, `mode`, `source`), not search alone.

## Observations (non-blocking)

- O1 (out of scope): the global tab-lease banner's right-hand message truncates
  with ellipsis on narrow widths (visible in 05/06). It is a global system
  surface, not part of the Runs prototype or any slice; flag for a future
  global-UI pass.
- O2 (deliberate residual): production rows keep RecordRow's per-row rounded
  card outline (rounded-md + border-edge + bg-panel) vs the prototype's square,
  hairline-separated rows. Deliberate scope: RecordRow is shared with Compare
  and experiment surfaces (medium blast radius, independently regression-
  reviewed in task t_254d8ab9), and Slice 2 scoped the selected accent to the
  RunList wrapper with RecordRow itself unchanged. The inter-row gap was
  removed (flush stacking), so the remaining outline reads as cell separators,
  not floating cards. If row-level outlines are still undesirable, that is a
  separate shared-component restyle decision for the product owner.

## Regression guardrails

- Full vitest suite at HEAD: 149 files / 2327 tests pass (transplant map
  baseline was 10 files / 150 tests; suite grew with slice work).
- Prior review tasks on this branch cover responsive (commit 19cf11a),
  accessibility (2105a8d), and edge states (80d9712); their drivers still pass
  at current HEAD.

## Artifacts

- scripts/cdp-runs-visual-parity.mjs (reusable parity driver)
- results.json (numeric evidence)
- 01-proto-list.png, 02-proto-detail-selected.png, 03-prod-list.png,
  04-prod-list-selected.png, 05-prod-detail-completed.png, 06-prod-detail-fuse.png
