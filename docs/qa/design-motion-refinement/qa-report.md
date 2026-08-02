# Design and Motion Refinement QA Report

**Reviewed range:** `a3afb05..79368f1`  
**Date:** 2026-08-02  
**Scope:** Token alignment, CSS motion primitives, cmdk command palette, Base UI dialogs, press feedback, pipeline/status continuity, compact-state geometry, and browser QA.

## Quality gate

| Command | Result |
| --- | --- |
| `npm run check` | PASS — web typecheck, server typecheck, 107 Vitest files / 1,473 tests, production build |
| `git diff --check` | PASS — no whitespace diagnostics |
| `npm run qa:design-motion` against `npm run preview -- --port 5176` | PASS — machine-readable probes and screenshots refreshed from production preview |

The test command emitted Node warnings about `--localstorage-file` without a valid path; Vitest still exited successfully with all 1,473 tests passing.

## Bundle evidence

The final production build emitted:

- Main application JS: `dist/assets/index-DBurkFlK.js` — 497.95 kB / 149.75 kB gzip.
- Shared library JS: `dist/assets/lib-BFODWNBl.js` — 497.25 kB / 125.48 kB gzip.
- Main CSS: `dist/assets/index-BPljetA_.css` — 34.87 kB / 7.44 kB gzip.

`docs/final-qa-report.md` recorded 296.39 kB JS / 85.09 kB gzip and 30.55 kB CSS / 6.59 kB gzip on 2026-07-29. This is not an apples-to-apples regression claim: the application and chunk topology changed between commits, and no same-baseline pre-refinement build exists.

## Browser QA matrix

Source: [`results.json`](./results.json), regenerated from the production preview.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Desktop 1440×1000 | PASS — no document horizontal overflow; linear spinner style | `qa-desktop-1440x1000.png` |
| Desktop Run action | PASS — visible action has no gradient image | `qa-desktop-run-action.png` |
| Active desktop pipeline | PASS — exactly one real rail connector (`bg-march`) and one real stage spinner (`spin-ease`, linear) | `qa-desktop-active-pipeline.png` |
| Tablet 1024×768 | PASS — no document horizontal overflow; Connections focus, Escape restoration, and dialog fit pass | `qa-tablet-1024x768.png`, `qa-connections-tablet-1024-dialog.png` |
| Tablet touch 768×1024 | PASS — touch emulation; no document horizontal overflow; Connections focus, Escape restoration, and dialog fit pass | `qa-tablet-768x1024.png`, `qa-connections-tablet-768-dialog.png` |
| Mobile touch 390×844 | PASS — no document horizontal overflow; Connections focus, Escape restoration, and dialog fit pass | `qa-mobile-390x844.png`, `qa-connections-mobile-390-dialog.png` |
| Mobile command drawer | PASS — focus enters; drawer scroll reaches its end; no horizontal overflow | `qa-mobile-drawer.png`, `qa-mobile-drawer-scrolled.png` |
| Reduced motion, desktop | PASS — pressable and disclosure transitions `0s`; real active connector and spinner have computed animation `none`; status remains visible | `qa-desktop-reduced-motion.png`, `qa-desktop-reduced-active-pipeline.png` |
| Effective 200% CSS zoom | PASS — 720×500 CSS viewport with no horizontal overflow | `qa-desktop-200-percent-css-zoom.png` |

## Keyboard and dialog behavior

- Command palette opened in 22 ms, had computed `animation-name: none`, and focused within its cmdk dialog.
- Connections dialogs at 1440, 1024, 768, and 390 px moved focus inside on open, had no horizontal overflow, closed on Escape, and restored focus to their triggers.
- Unit coverage verifies Base UI dialog focus guards, Escape, backdrop dismissal, and detached-trigger focus restoration.

## Motion review

- Shared `.pressable` feedback is transform-only on active press; hover lift is limited to fine-hover pointers.
- Infinite spinner timing is linear; the command palette has no entrance/exit animation.
- Reduced motion removes loops plus pressable and disclosure-chevron transitions while preserving visible status feedback.
- A deterministic isolated-browser OpenRouter stream exercised the real active rail: one connector and one stage spinner animate normally, and both compute to `none` under reduced motion.
- Compact controls reserve their run shortcut, reset, suite-action, status-icon, and disclosure-trigger geometry. Disclosure bodies insert instantly; chevrons only rotate over 150 ms ease-out outside reduced motion.

## Visual inspection

The production screenshots were opened and inspected. Confirmed: desktop header fit, clear command/output hierarchy, active Models-stage clarity, responsive tablet stacking, mobile drawer containment and lower-control reachability, mobile Connections dialog fit, and no visible horizontal-overflow indicators. A direct mobile-browser probe scrolled the Gemini Save action into view and confirmed it sat fully inside the dialog scroller above the fixed Done footer. Intentional text ellipses occur for constrained model metadata. The initial Run-action capture is disabled when no task is supplied; active rail verification uses the isolated browser-only mock described below.

## Accepted deviations

None.

## Final review-animations-style audit

**Verdict: Approve.** The final read-only motion review found no release-blocking motion, focus, overflow, or evidence defect. It specifically rechecked the three remediated areas: zero-duration reduced-motion disclosure chevrons, real active-pipeline probes in normal and reduced motion, and Connections dialog focus/Escape/overflow probes at 1024, 768, and 390 px.

## Residual risks

1. Active-pipeline QA supplies a dummy OpenRouter key and mock SSE response in its temporary Chrome profile. It validates the real UI state machine and computed styles, not external-provider behavior.
2. The zoom check uses an effective 720×500 CSS viewport to represent 200% zoom. It validates responsive layout and overflow at that effective viewport, but is not a separate operating-system accessibility-zoom test.
3. Screen captures cannot show temporal qualities alone; motion behavior is additionally asserted by computed-style probes and focused unit contracts.
