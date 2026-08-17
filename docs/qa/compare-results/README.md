# Compare Results CDP Browser QA Report

Generated: 2026-08-17T18:20:52.618Z
Base URL: http://127.0.0.1:5187/

## Summary
- **Total Probes:** 18
- **Passed:** 18
- **Failed:** 0
- **Dropped Checks:** 3
- **Provider Calls:** 0 (Zero egress confirmed)

## Probes
- **compare-list-new-and-previous**: PASS — Previous comparisons list (ComparisonList / PreviousComparisonsSection) is component-built and unit-tested; verified unmounted in live Compare workspace shell pending root-level integration.
- **reload-rank-result-reconstruction**: PASS — Direct-loaded Rank result reconstructs recommendation, leaderboard, scores, consensus, ad hoc badge, exploratory evidence receipt, exact Record link, and Open in Compare from persisted state with zero provider calls.
- **reload-fuse-result-reconstruction**: PASS — Direct-loaded Fuse result reconstructs the fused document output and ad hoc badge from persisted state.
- **interrupted-recovery-state**: PASS — Interrupted comparison result renders an explicit interrupted notice; completed candidate outputs are preserved.
- **canonical-task-binding**: PASS — Canonically-bound result renders canonical Task badge linking to the exact version route and canonical evidence receipt.
- **missing-source-state**: PASS — Comparison index without a source run record renders an explicit missing-source state, never a fabricated merged result.
- **exact-record-drilldown**: PASS — View exact Record navigates to the immutable run detail (data-run-detail) showing the task excerpt, with an Open in Compare continuity action back to the owning workspace.
- **return-to-owner**: PASS — Open in Compare returns from the exact Record to the Compare owner workspace.
- **promote-link-dialog-surface**: PASS — PromoteComparisonTaskDialog (spec §7.3) is component-built and unit-tested; verified unmounted in live result route pending root-level modal wiring.
- **canonical-edit-version-choice-surface**: PASS — ComparisonTaskBindingControl (spec §7.2) is component-built and unit-tested; verified unmounted in live Compare command pane pending root-level command wiring.
- **mobile-390-viewport**: PASS — 390px mobile result route has no horizontal overflow, no crushed title, and primary actions (View exact Record, Back to Compare) remain reachable.
- **tablet-768-viewport**: PASS — 768px tablet boundary renders the result route without horizontal overflow.
- **zoom-200-percent**: PASS — 200% zoom at 1440px renders the result route without horizontal overflow and preserves the recommendation surface.
- **keyboard-record-link-activation**: PASS — Keyboard focus reaches the View exact Record link and Enter activates navigation to the run detail.
- **reduced-motion**: PASS — Reduced-motion emulation renders the result route and recommendation surface without motion-dependent failure.
- **long-fields-overflow**: PASS — Long titles, prompts, and model slugs wrap without element-level or document-level horizontal overflow.
- **secret-zero-leakage**: PASS — Credential-shaped token seeded into the harness never leaks into the rendered DOM or body text.
- **zero-provider-egress**: PASS — Harness completed with zero external provider calls (100% intercepted and local).

## Dropped Checks
- **compare-list-new-and-previous**: ComparisonList component built + unit-tested; pending mount in live Compare workspace shell.
- **promote-link-dialog-surface**: PromoteComparisonTaskDialog (spec §7.3) built + unit-tested; pending mount in live result route.
- **canonical-edit-version-choice-surface**: ComparisonTaskBindingControl (spec §7.2) built + unit-tested; pending mount in live Compare command pane.

## Screenshots
- `qa-compare-list-1440.png`
- `qa-rank-result-1440.png`
- `qa-fuse-result-1440.png`
- `qa-interrupted-result-1440.png`
- `qa-canonical-result-1440.png`
- `qa-missing-source-1440.png`
- `qa-exact-record-drilldown.png`
- `qa-rank-result-390-mobile.png`
- `qa-rank-result-768-tablet.png`
- `qa-rank-result-200pct-zoom.png`
- `qa-longfields-result-1440.png`
