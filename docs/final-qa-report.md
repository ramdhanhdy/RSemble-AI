# Final Integrated QA & Remediation Evidence

Task: t_0b810caa — review: final integrated QA and remediation
Date: 2026-07-29
Worker: rsemble-worker

## 1. Scope

Adversarial review of all parent-card changes (t_85868334, t_e6c8cdbd, t_d5f3905a, t_f8b0e89f) against product docs and original findings. Fix any remaining reproducible blockers.

## 2. Commands Run

| Command | Outcome |
|---|---|
| `npm run check` | PASS — web typecheck, server typecheck, 83/83 tests across 12 files, production build |
| `npx tsx server/codex-bridge/index.ts` + curl | PASS — `/health` 200, `/auth/status` ok, `/v1/models` catalog, `/umans/v1/models` proxy returns live Umans catalog, unauthenticated chat completions correctly 401 |
| `node scripts/cdp-qa.mjs` | PASS — desktop 1440x1000 and true mobile 390x844 screenshots, zero document overflow, all dialog a11y assertions pass |

## 3. Bundle Sizes (post-fix)

- JS: 296.39 kB / 85.09 kB gzip
- CSS: 30.55 kB / 6.59 kB gzip

## 4. Behavior Verification

| Check | Result | Evidence |
|---|---|---|
| Truncated streams error | PASS | `src/lib/providers/sse-stream.ts` throws ProviderError on EOF without `[DONE]` and on empty stream; 8 unit tests |
| Fuse judge failures terminate | PASS | `run-controller.ts` dispatches `JUDGE_FAILED` / `FUSION_FAILED` on error; abort propagates correctly |
| History scores/winner correct | PASS | `run-history.ts` uses composite `providerId:slug` keys; `addRun` writes score, latencyMs, costUsd; winner = max score |
| Duplicate slugs coexist | PASS | `modelKey(providerId, slug)` scopes stats; legacy bare keys migrated/tolerated |
| Retry matches its label | PASS | `retryCandidate` finds slot by `slug + providerId`; retry result triggers re-judge and re-fuse when ≥2 done |
| No per-token root dispatch | PASS | `StreamDeltaBuffer` batches deltas into one `CANDIDATE_DELTA` dispatch per `requestAnimationFrame` |
| No repeated localStorage parsing | PASS | `history-cache.ts` memoizes `getRuns`, `getRunCount`, `getModelTelemetry`; invalidated on `addRun` / `clearHistory` |
| No serialized provider checks | PASS | `probeAllProviders` uses `Promise.allSettled` with per-provider 5 s timeout |
| No scroll feedback loop | PASS | `CompareView` syncs scroll only when `|el.scrollTop - targetTop| > 1`; no listener on the target element |

## 5. Visual & Accessibility Evidence

| Viewport | Screenshot | Result |
|---|---|---|
| Desktop 1440x1000 | `docs/screenshots/qa-desktop-1440x1000.png` | Clean split workspace; no overflow; header fits |
| Desktop Connections | `docs/screenshots/qa-desktop-connections.png` | Modal fits; focus trap verified; Escape closes; focus restored |
| Desktop Palette | `docs/screenshots/qa-desktop-palette.png` | Palette opens via Ctrl+K; readable |
| Mobile 390x844 | `docs/screenshots/qa-mobile-390x844.png` | No horizontal overflow; output pane primary |
| Mobile drawer | `docs/screenshots/qa-mobile-drawer.png` | Drawer opens; all controls reachable after scroll (sh=886, ch=775, st=111) |
| Mobile drawer filled | `docs/screenshots/qa-mobile-drawer-filled.png` | Task input accepts text; run button enables |
| Mobile Connections | `docs/screenshots/qa-mobile-connections.png` | Modal fits 390 px; no overflow |

Dialog a11y (4-assert pattern) passed for both Connections modal and mobile command drawer:
1. Open → focus moves into `[role=dialog]`
2. 30 synthesized Tabs → focus never leaves dialog
3. Escape → dialog removed from DOM
4. Focus restored to stashed trigger element

## 6. Issues Found & Fixed

### 6.1 Contrast: status badges and tinted alert backgrounds

**Finding:** "Not connected" / "Connected" badges and several alert banners used low-opacity tinted backgrounds (`bg-error/10`, `bg-error/[0.06]`, `bg-warning/[0.04]`, etc.) that made the status text hard to read, especially on mobile.

**Root cause:** Tailwind opacity modifiers below ~15% on dark panel backgrounds produce insufficient contrast for status colors.

**Fix:** Raised background opacity and added matching borders to restore WCAG-readable contrast while preserving the tinted aesthetic.

| File | Change |
|---|---|
| `src/ui/ConnectionsModal.tsx` | `StatusBadge` error: `bg-error/10` → `border border-error/40 bg-error/15`; success: `bg-success/10` → `border border-success/40 bg-success/15`; saved message: `bg-success/10` → `border border-success/30 bg-success/15` |
| `src/rsemble.tsx` | catalog error banner: `border-error/30 bg-error/[0.06]` → `border-error/40 bg-error/10`; no-key banner: `border-warning/30 bg-warning/[0.06]` → `border-warning/40 bg-warning/10` |
| `src/ui/OutputPane.tsx` | error panel: `border-error/30 bg-error/[0.04]` → `border-error/40 bg-error/[0.08]`; warning panel: `border-warning/30 bg-warning/[0.04]` → `border-warning/40 bg-warning/[0.08]` |
| `src/ui/FailedCandidates.tsx` | container: `border-error/25 bg-error/[0.03]` → `border-error/40 bg-error/[0.08]` |
| `src/ui/RankResult.tsx` | winner banner: `border-success/40 bg-success/[0.06]` → `border-success/50 bg-success/[0.10]` |
| `src/ui/RubricDisclosure.tsx` | bias warning: `border-warning/40 bg-warning/[0.08]` → `border-warning/50 bg-warning/[0.12]`; neutral-judge button: `border-warning/50 bg-warning/[0.12]` → `border-warning/60 bg-warning/[0.16]` |

**Verification:** `npm run check` re-run (83/83 tests pass, build passes); CDP screenshots re-captured and visually inspected.

## 7. Residual Risks

1. **Geist font loading** — The design specifies Geist / Geist Mono. In headless QA the browser fell back to system sans; this is environment-dependent and not a code bug.
2. **Provider catalog freshness** — The Umans catalog is fetched live through the bridge proxy. If `api.code.umans.ai` changes shape, the proxy will surface a 502; the UI already shows diagnosable catalog errors.
3. **Legacy history entries** — Bare-slug keys from pre-provider-scoping builds are tolerated but not perfectly migrated when the provider cannot be inferred. Data is preserved, not lost.
4. **Scroll sync edge case** — `CompareView` scroll sync is one-way (source → target). If the user scrolls the target pane directly, no sync occurs. This is intentional to prevent feedback loops.

## 8. Changed Files

- `src/ui/ConnectionsModal.tsx`
- `src/rsemble.tsx`
- `src/ui/OutputPane.tsx`
- `src/ui/FailedCandidates.tsx`
- `src/ui/RankResult.tsx`
- `src/ui/RubricDisclosure.tsx`
- `scripts/cdp-qa.mjs` (QA harness)
- `scripts/cdp-debug-conn.mjs` (overflow debugger)
- `docs/final-qa-report.md` (this report)
- `docs/screenshots/qa-*.png` (7 evidence screenshots)

## 9. Test Totals

- Test files: 12
- Tests: 83 passed / 83 total
- New tests introduced by parent cards: 30 (t_f8b0e89f) + 13 (t_d5f3905a) = 43
- Build: PASS
- Typecheck (web + server): PASS
