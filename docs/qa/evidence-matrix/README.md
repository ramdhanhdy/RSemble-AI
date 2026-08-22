# Evidence Matrix CDP Browser QA Report

Generated: 2026-08-17T18:19:05.086Z
Base URL: http://127.0.0.1:5186/

## Summary
- **Total Probes:** 16
- **Passed:** 16
- **Failed:** 0
- **Provider Calls:** 0 (Zero egress confirmed)

## Probes
- **determinism-double-run**: PASS — Deterministic fixture seeded twice produces 100% identical observation IDs, sourceKeys, decisions, and index jobs.
- **matrix-table-semantics-1440**: PASS — ResultMatrix renders real table, sticky headers, winner crown, mean/coverage footer, and receipts without overflow at 1440px.
- **evidence-receipt-eligible-disclosure**: PASS — EvidenceReceipt popover displays eligibility status, reason codes, allowed uses, model configuration, and exact run link.
- **evidence-receipt-keyboard-escape**: PASS — Escape key closes the EvidenceReceipt popover.
- **evidence-receipt-verified-state**: PASS — EvidenceReceipt displays Verified evidence class with verifier provenance.
- **matrix-missing-cell-states**: PASS — Missing matrix cells display explicit text (Not run, No score, Evidence unavailable) with StatusMarks, never bare dashes.
- **task-observations-view-and-invariants**: PASS — TaskObservations view displays honest counts, filter controls, and NEVER lists FusionObservation records.
- **exact-record-deep-link**: PASS — Deep link to exact run record focuses candidate and displays output and judge scores.
- **secret-token-leakage-probe**: PASS — Secret tokens stored in database snapshots/decisions are never leaked or surfaced in the rendered DOM.
- **mobile-390-adaptation**: PASS — Mobile 390px adaptation switches to native model select, renders one task row per model, and prevents horizontal overflow.
- **tablet-768-boundary**: PASS — Tablet 768px boundary maintains desktop table matrix layout without horizontal page overflow.
- **zoom-200-percent-1440**: PASS — 200% zoom scaling preserves matrix layout integrity and accessibility.
- **reduced-motion-emulation**: PASS — Reduced motion preference is active and respected across animations/disclosures.
- **matrix-pagination-50-rows**: PASS — 55-task matrix renders exactly 50 rows on page 1 with pagination controls.
- **matrix-pagination-page-2**: PASS — Navigating to page 2 displays the remaining 5 tasks (51–55) accurately.
- **zero-provider-egress**: PASS — Harness completed with zero external provider calls (100% intercepted and local).

## Screenshots
- `qa-matrix-desktop-1440.png`
- `qa-receipt-eligible-popover.png`
- `qa-task-observations-detail.png`
- `qa-exact-record-deeplink.png`
- `qa-mobile-390-results.png`
- `qa-tablet-768-matrix.png`
- `qa-zoom-200-scale2.png`
- `qa-reduced-motion-matrix.png`
- `qa-large-matrix-page-1.png`
- `qa-large-matrix-page-2.png`
