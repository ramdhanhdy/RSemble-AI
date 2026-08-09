# RSemble AI — Runs IA HTML Prototype Exploration: Final Report

**Status: Exploratory — non-authoritative.**
**Repository:** `/opt/data/projects/RSemble-AI` · master @ `0b01e69`
**Date:** 2026-08-09

---

## Kanban completion summary

| # | Card | Model | Status |
|---|---|---|---|
| 1 | Current UI/product reconnaissance | DeepSeek V4 Flash | ✅ Done |
| 2 | Shared prototype data definition | GLM-5.2 (main agent) | ✅ Done |
| 3 | Prototype design-system extraction | DeepSeek V4 Flash | ✅ Done |
| 4 | Baseline prototype | GLM-5.2 (main agent) | ✅ Done |
| 5 | Candidate A — First-Class Runs | GLM-5.2 (delegated) | ✅ Done |
| 6 | Candidate B — Secondary Records | GLM-5.2 (delegated) | ✅ Done |
| 7 | Candidate D — Corpus Views | GLM-5.2 (delegated) | ✅ Done |
| 8 | DeepSeek adversarial review | DeepSeek V4 Flash | ✅ Done |
| 9 | Executive Engineer visual review | Qwen 3.8 Max + main agent vision | ✅ Done |
| 10 | GLM repair cycle | GLM-5.2 (delegated) | ✅ Done |
| 11 | Cross-candidate fairness review | Main agent (vision) | ✅ Done |
| 12 | Prototype launcher / index | GLM-5.2 (main agent) | ✅ Done |
| 13 | README / evaluation guide | GLM-5.2 (main agent) | ✅ Done |
| 14 | Final Executive Engineer gate | Main agent (vision) | ✅ Done |
| 15 | Final report | GLM-5.2 (main agent) | ✅ This document |

## Files created

| File | Size | Content |
|---|---|---|
| `prototypes/shared.css` | 12.6KB | RSemble design system (dark theme, cyan accent, all component patterns) |
| `prototypes/shared.js` | 19.5KB | Synthetic dataset: 11 runs (ad-hoc, experiment, legacy, failed, partial, interrupted, retry) + 1 experiment |
| `prototypes/baseline.html` | ~18KB | Fair Baseline: 3 nav, flat list + source grouping, URL filters, Open-in-Compare preload, copy-link round-trip |
| `prototypes/first-class-runs.html` | ~31KB | Candidate A: 3 nav, grouped-by-source, experiment containers, attention chips, status timeline, URL-persistent filters |
| `prototypes/secondary-records.html` | ~27KB | Candidate B: 2 nav (Compare | Evaluations), Records drawer, no badge, attention chips in drawer, full-page Run Detail |
| `prototypes/corpus-views.html` | ~23KB | Candidate D: 3 nav, 4 segmented tabs (Recent/From Compare/From Evaluations/Needs Attention), URL state, deep links |
| `prototypes/index.html` | 6.7KB | Prototype launcher with scenario list |
| `prototypes/README.md` | 3.9KB | How to open, purpose, scenarios, feedback template |
| `prototypes/exploration-notes.md` | 30.7KB | DeepSeek divergent exploration (10+ ideas per candidate, failure modes, edge cases) |

## Model-role allocation used

| Role | Model | Tasks |
|---|---|---|
| Builder (GLM 5.2) | Main agent (`syn:large:vision`) + delegated GLM | shared.css, shared.js, baseline.html, index.html, README.md, repair cycle |
| Divergent exploration (DeepSeek) | `cline-pass/deepseek-v4-flash` | Exploration notes, adversarial flow review |
| Visual reviewer (Qwen 3.8 Max) | `cline-pass/qwen3.8-max` (config switched) | Rendered visual review + re-check of baseline + Candidate A |
| Visual reviewer (main agent) | `syn:large:vision` (Kimi-K3) | Candidate B + D visual verification, cross-candidate fairness |

**Note:** Delegation model switching was done via Python YAML edit of `/opt/data/config.yaml` `delegation.model` field. Qwen 3.8 Max was configured before the visual review delegation, then switched back to DeepSeek V4 Flash afterward.

## Scenarios implemented

All 7 canonical scenarios are testable across all 4 prototypes:

1. ✅ Compare → completed result → persisted Run Detail (View record)
2. ✅ Run Detail → Open in Compare (configuration preload, no fabricated result)
3. ✅ Evaluation → task/result → exact underlying Run evidence
4. ✅ Find older ad-hoc run with partial memory (search by task/model/id)
5. ✅ Inspect failed run (status, error, judge failure)
6. ✅ Browse several records (corpus list, grouping, segments)
7. ✅ Return to app and locate recent/unfinished work (status filter, attention indicators)

## Important design decisions

1. **Open-in-Compare preload (not fabrication):** After CC-1 fix, "Open in Compare" loads the frozen configuration (task, mode, model slots, system prompt) into Compare's editable state with a "Configuration loaded from run X" notice. No fabricated results, no lineage. Legacy runs disable the button.

2. **B badge removal:** The proactive attention badge on the Records button was removed per fairness-boundary §3 (parked N-class item #10). Row-level attention chips inside the drawer are kept (reactive, not proactive).

3. **Attention supersede rule:** Interrupted runs with a completed retry child (via `reusedFrom`) are excluded from attention counts. This prevents the monotonic-attention failure mode.

4. **Dataset timestamp normalization:** All `completedAt` values regenerated as `createdAt + duration` to fix inverted timestamps.

5. **URL state across all prototypes:** All 4 prototypes parse `#/runs/<runId>?q=&status=&source=` on load and hydrate filters/selection. Copy-link URLs round-trip.

## DeepSeek findings and disposition

| Finding | Severity | Disposition |
|---|---|---|
| CC-1: Open in Compare fabricates result | CRITICAL | ✅ Fixed — preload config state |
| CC-2: Inverted timestamps | MINOR | ✅ Fixed — normalized at load |
| CC-3: Fusion status not rendered | MINOR | ✅ Fixed — "No consensus" shown |
| CC-4: Pending=running styling | MINOR | ✅ Fixed — uses interrupted class |
| CC-5: Copy-link no clipboard | MINOR | ✅ Fixed — navigator.clipboard + "Copied!" |
| CC-6: Attention includes retried runs | MINOR | ✅ Fixed — isSuperseded() exclusion |
| CC-7: No zero-corpus teaching state | MINOR | Accepted — prototype limitation |
| CC-8: No running/aborted states | MINOR | Accepted — prototype limitation |
| BL-1: Baseline missing 2/5 fairness items | CRITICAL | ✅ Fixed — URL filters + grouping added |
| BL-2: Copy-link dead URLs | CRITICAL | ✅ Fixed — hash routing added |
| BL-3: Blank filter results | MINOR | ✅ Fixed — empty state added |
| A-1: Stale compareState | CRITICAL | ✅ Fixed — reset on nav |
| A-2: Invalid deep link no not-found | MINOR | Accepted — prototype scope |
| A-3: URL history spam | MINOR | Accepted — prototype scope |
| B-1: Proactive badge | CRITICAL | ✅ Fixed — badge removed |
| B-5: No palette in prototype | MINOR | Accepted — copy note only |
| D-1: No URL state | CRITICAL | ✅ Fixed — hash routing added |
| D-4: Default view contradicts hypothesis | CONCEPTUAL | Noted as evidence — not a defect |

## Executive Engineer visual findings and repairs

**Qwen 3.8 Max rendered review (baseline + Candidate A):**
- Baseline: PASS — source grouping, URL filters, Open-in-Compare preload, copy-link feedback all verified
- Candidate A: PASS — experiment containers collapse/expand, attention chips, stale compareState fix verified
- Minor nits: source dropdown truncation (112px), snake_case status badge on Evaluations

**Main agent vision review (Candidate B + D):**
- Candidate B: PASS — 2 nav items only, no badge, drawer with search/filters/attention chips/escape hatch note
- Candidate D: PASS — 4 segmented tabs with counts (Recent 11, From Compare 6, From Evaluations 4, Needs Attention 2), deep links work

## Cross-candidate fairness findings

1. **Polish parity:** All 4 prototypes use the same shared.css design system. No candidate has visually superior treatment.
2. **Feature parity:** All 4 have working Open-in-Compare preload, copy-link round-trip, and URL-persistent filters. No candidate has an unfair feature advantage.
3. **B badge removal resolved the one unfair advantage** — B no longer has a proactive push mechanism that A lacks.
4. **D's segmented views are the candidate's hypothesis**, not an unfair advantage — they test the compression diagnosis.
5. **Attention treatment is consistent:** A uses row chips, B uses row chips in drawer, D uses a segment + row chips. None use nav badges.

## Final Executive Engineer gate

| Criterion | Verdict |
|---|---|
| Fidelity — recognizable as RSemble | ✅ Dark theme, cyan accent, 3-zone header, nav structure, status dots, source labels |
| Fairness — A and B equivalent effort | ✅ Both fully implemented, repaired, and visually verified |
| Semantic honesty — no unapproved lineage/lifecycle/retention/analytics | ✅ No rebasedFrom, no delete/archive, no analytics, no new lifecycle states |
| Scenario completeness — important scenarios testable | ✅ All 7 canonical scenarios work across all 4 prototypes |
| Visual readiness — all passed rendered visual inspection | ✅ Baseline + A (Qwen), B + D (main agent vision) |
| Distinction — models remain meaningfully different | ✅ A=first-class workspace, B=drawer+2-nav, D=segmented views, Baseline=flat+connected |
| Kanban completeness — all cards completed the loop | ✅ DeepSeek explore → GLM implement → Qwen/main visual review → DeepSeek attack → GLM repair → visual re-check |

**Gate verdict: PASS.** The prototype exploration is complete. No candidate is selected as a winner. The Product Owner should open `index.html` and try the prototypes.

## Semantic constraints discovered

1. **Open-in-Compare is S-class only without lineage:** The preload bridge works purely as navigation — no `rebasedFrom`, no record mutation. Adding lineage would make it P-class and require product authority.
2. **Attention supersede is a presentation rule, not a lifecycle rule:** Excluding retried interrupted runs from attention counts is query-view logic, not a lifecycle state change.
3. **B's drawer must not become a worse Runs:** The deferring boundary (list + filter + handoff only, no detail in drawer) is what keeps B from collapsing into A-with-smaller-box.
4. **D's segments are query views, not record partitions:** A run legitimately appears in multiple segments. Counts are query results, not folder sizes.
