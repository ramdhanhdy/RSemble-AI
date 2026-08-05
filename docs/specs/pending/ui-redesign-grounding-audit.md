# Grounding Audit — ui-redesign-spec.md ("Command Deck")

> **Verdict: DO NOT implement this spec as written.** It is ungrounded from the
> current codebase. This audit maps every spec section to what actually exists
> today, so the spec can be retired or reduced to its remaining gaps.

## Why the spec is ungrounded

| Fact | Evidence |
| --- | --- |
| Spec age | Created `1953fef` (2026-07-29). **140 commits** have landed since. |
| Architecture changed | Spec targets a single split-pane studio. The app is now a **three-workspace shell** (Compare / Runs / Evaluations) with hash routing, lazy workspaces, an evaluation-experiment system, fusion studies, and attachments. |
| Named file no longer exists | Spec's `src/ui/RubricDisclosure.tsx` is gone — replaced by `EvaluationDisclosure` + `EvaluationProfileEditor` (weight UI, normalized shares, presets all shipped there). |
| Palette diverged | Spec wants blue-tinted slate (`#05080f`/`#0d1424`). Codebase kept neutral charcoal (`canvas #0a0a0a`, `panel #121212`), matching `DESIGN.md`. The visual foundation was superseded, not deferred. |
| Icon rail conflicts | Spec §3.2 wants a left icon rail. The shell now uses `WorkspaceNav` + `MobileWorkspaceNav`, and `DESIGN.md` still records the sidebar as retired platform chrome. |

## Section-by-section status

### Already shipped (via other commits — do not rebuild)

| Spec item | Current implementation |
| --- | --- |
| §5.1 Pipeline rail, 4 live states | `src/ui/PipelineRail.tsx` — `pending/active/done/error` exactly as specified |
| §3.1 Resizable split, 320–560 clamp, persisted ratio | `src/ui/useResizableSplit.ts` (stores ratio, spec §3.1 comment in code) |
| §4.5 Run button: Stop/abort state + cost & time forecast | `src/ui/RunButton.tsx` + `src/lib/cost.ts` (`estimateRunCost`, `estimateRunTime`) |
| §4.2 Model telemetry (win rate, avg score) + §10 run history | `src/lib/run-history.ts`, `src/lib/history-cache.ts`, telemetry rendered in `ModelList.tsx` |
| §6 Command palette + shortcut map + cheatsheet | `CommandPalette.tsx`, `useActionShortcuts.ts` (⌘Enter, ⌘/, ⌘1–9, ⌘F, ⌘C), `ShortcutCheatsheet.tsx` |
| §5.2 Productive empty state (recent runs vs first-run teaching) | `OutputPane.tsx`: `hasHistory ? <RecentRuns/> : <WhatYouGetRow/>` |
| §5.5 Compare view with synchronized scroll | `CompareView.tsx` (sync toggle, feedback-loop guard) |
| §5.6 Fusion provenance gutter | `FuseResult.tsx` (`provenanceIndex`, `matchProvenance`, 72ch measure) |
| §3.3 Live status pill (button, opens connections) | `Header.tsx` |
| §10 brand icons, sparkline, abort infra | `brand-icons.tsx`, `Sparkline.tsx`, `AbortController` in `experiment-controller.ts` |
| §3.3 Global progress | evolved into `GlobalExecutionStrip.tsx` |
| §4.3 Rubric weights, presets, normalized weight bar | `EvaluationDisclosure.tsx`, `EvaluationProfileEditor.tsx` |

### Still missing (genuinely unshipped)

| Spec item | Notes |
| --- | --- |
| Gradient CTA (§4.5) | RunButton is flat today; index.css has no gradient CTA |
| Focus mode `⌘\` (§3.1) | not present in `useResizableSplit` or shortcuts |
| Self-judging warning (§4.4) | no "judging its own answer" guard anywhere |
| Diff highlighting in Compare (§5.5) | sync exists; diff-vs-winner does not |
| FLIP reordering of candidate cards (§5.3) | unverified/absent |
| Numbered panel headers `01 COMMAND`/`02 OUTPUT` (§4, §5) | absent |
| Blue-slate palette + glow tokens (§2) | absent by design — see conflicts |

### Conflicts with current decisions (would require amending, not coding)

| Spec item | Conflict |
| --- | --- |
| Left icon rail (§3.2) | `DESIGN.md` retired the sidebar; shell now routes via workspace nav. A rail would be a fourth navigation system. |
| Blue-tinted palette (§2.1) | `DESIGN.md` + `design-token-contract.test.ts` lock the neutral ladder. A palette swap rewrites tokens under 1,700+ tests and all committed QA evidence. |
| 3-up first-run grid (§5.2b) | Already shipped as `WhatYouGetRow` — the §13 amendment question is moot. |

## Recommendation

1. **Retire** `ui-redesign-spec.md`: move it under `docs/archive/` (or leave in
   `pending/` marked superseded) and record this audit as the reason.
2. If any of the missing items are still wanted, **write a fresh, small spec** for
   exactly those items (gradient CTA, focus mode, self-judge warning, compare
   diff) grounded in the three-workspace architecture — not a revival of the
   Command Deck plan.
3. Do not attempt the palette swap or icon rail without an explicit DESIGN.md
   decision first.
