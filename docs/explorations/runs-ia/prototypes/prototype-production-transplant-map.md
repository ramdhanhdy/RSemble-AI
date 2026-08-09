# Prototype-to-Production Transplant Map

**Branch:** `feat/runs-fairness-baseline` (from master @ `0f42267`)
**Date:** 2026-08-09
**Status:** Pre-implementation gate -- requires review before any production edits

---

## Executive Summary

The HTML prototypes were built using the production design token system (verified: `tailwind.config.js` and `shared.css` match exactly). The visual improvement the Product Owner responds to comes from **composition, density, hierarchy, and surface treatment** -- not a new visual identity.

The production React application is **richer** than the prototypes in behavior: real routing, deep-linkable candidate/judge focus, experiment provenance, revision-CAS persistence, responsive split, filter semantics, and accessibility. The prototypes use synthetic data, fake routing, and direct-DOM interaction.

**The transplant goal:** bring the prototype's compositional refinement into the production components without discarding any production behavior.

---

## Section A: Design System (shared.css)

### A1. Color tokens, typography, radii, spacing rhythm

| Property | Prototype (shared.css) | Production (tailwind.config.js) | Classification |
|---|---|---|---|
| Canvas/shell `#0a0a0a` | `--canvas: #0a0a0a` | `canvas: "#0a0a0a"` | **KEEP** -- identical |
| Panel `#121212` | `--panel: #121212` | `panel: "#121212"` | **KEEP** -- identical |
| Card hover `#1a1a1a` | `--card-hover: #1a1a1a` | `card.hover: "#1a1a1a"` | **KEEP** -- identical |
| Raised `#181818` | `--raised: #181818` | `raised: "#181818"` | **KEEP** -- identical |
| Edge `#262626` / bright `#3a3a3a` | `--edge` / `--edge-bright` | `edge` / `edge.bright` | **KEEP** -- identical |
| Accent `#00e5ff` / deep `#00a9bd` | `--accent` / `--accent-deep` | `accent` / `accent.deep` | **KEEP** -- identical |
| Success `#00ff9d`, warning `#ffb300`, error `#ff4d4d` | present | present | **KEEP** -- identical |
| Geist / Geist Mono font stack | present | present | **KEEP** -- identical |
| Radii: 4px / 6px / 8px | `--radius-sm/md/lg` | `borderRadius.sm/md/lg` | **KEEP** -- identical |
| Spacing: 4/8/12/16/24/32px rhythm | CSS custom properties | Tailwind default scale | **KEEP** -- identical |
| Glow shadow | `--shadow-glow` | `boxShadow.glow` | **KEEP** -- identical |

**Verdict:** Zero design-token changes needed. The entire shared.css system already exists in production.

---

## Section B: Application Shell and Header

### B1. Three-zone 56px header

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| 56px header height | `Header.tsx` | Already 56px, three-zone layout | **KEEP** | None | Header only | `WorkspaceNav.test.tsx` |
| Centered workspace navigation | `WorkspaceNav.tsx` | Already centered with cyan active state | **KEEP** | None | Nav only | `WorkspaceNav.test.tsx` |
| Right-side connection/status controls | `Header.tsx` | Already has connection states, running timer, command palette, help | **KEEP** | None | Header only | N/A |
| Mobile command drawer | `MobileWorkspaceNav.tsx` | Already implemented with responsive compaction | **KEEP** | None | Mobile nav | N/A |

**Verdict:** Header is NOT a redesign target. Production already implements the prototype's composition and adds production-only behavior (connection states, timer, command palette). Do not rewrite Header or WorkspaceNav.

---

## Section C: Runs Workspace Shell

### C1. List/detail split layout

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| 380px desktop list pane | `RunsWorkspace.tsx` | Already 380px split with `useResizableSplit` | **KEEP** | None | RunsWorkspace | `RunsWorkspace.test.tsx` (5 tests) |
| Route-based mobile detail | `RunsWorkspace.tsx` | Already route-based: `/runs` list, `/runs/:runId` detail | **KEEP** | None | RunsWorkspace | `RunsWorkspace.test.tsx` |
| Deep-link handling (`?candidate=`, `?attempt=`) | `RunsWorkspace.tsx` | Already parses search params for candidate/judge focus | **KEEP** | None | RunsWorkspace + RunDetail | `RunDetail.test.tsx` (30 tests) |
| List pane padded card feeling | `RunsWorkspace.tsx` | Uses `p-3` padding wrapper around RunList | **RESTYLE** | Low -- cosmetic padding | RunsWorkspace only | `RunsWorkspace.test.tsx` |
| Integrated workspace feel (borders, not gaps) | `RunsWorkspace.tsx` | Uses `border-r border-edge` for split; list has `gap-2` between rows | **RESTYLE** | Low -- border treatment | RunsWorkspace + RunList | `RunsWorkspace.test.tsx` |
| DataArchiveActions footer | `RunsWorkspace.tsx` | Already present at bottom of list pane | **KEEP** | None | RunsWorkspace | N/A |

**Verdict:** Shell architecture is KEEP. Slice 1 targets only the padding/border treatment to reduce "cards floating in cards" feeling. No routing changes.

**Slice 1 scope:** Adjust `RunsWorkspace.tsx` pane padding and border treatment to feel more integrated. Preserve the 380px split, responsive routing, and DataArchiveActions.

---

## Section D: Run List Visual Grammar

### D1. Row presentation

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| Compact two-line rows (title + meta line) | `RecordRow.tsx` (list variant) | Already two-line: title+status, then meta with summary/modelCount/source/time | **KEEP** | None | RecordRow (shared!) | `RecordRow.test.tsx` (10 tests) |
| Source identity chips | `RecordRow.tsx` (source prop) | Renders source as uppercase text in meta line | **RESTYLE** | Medium -- if RecordRow is changed, affects Compare recent runs, experiment history, task-attempt rows | RecordRow (shared) | `RecordRow.test.tsx` |
| Selected-row left-edge accent | `RunList.tsx` (wraps RecordRow in `div[data-selected]`) | `data-selected={isSelected}` attribute is set but no visual style is applied | **RESTYLE** | Low -- add CSS for `[data-selected="true"]` | RunList only (data attribute is Runs-specific) | `RunList.test.tsx` (10 tests) |
| Stronger status treatment | `StatusMark.tsx` | Already renders colored dot per status | **KEEP** | None | StatusMark (shared) | `StatusMark.test.tsx` (16 tests) |
| Hover state (border brighten) | `RecordRow.tsx` | Already `hover:border-edge-bright` | **KEEP** | None | RecordRow (shared) | `RecordRow.test.tsx` |
| Row density / gap reduction | `RunList.tsx` | Uses `gap-1.5` between rows; rows have `py-2` | **RESTYLE** | Low -- gap/padding tuning in RunList | RunList only | `RunList.test.tsx` |
| Timestamp/model/status readability | `RecordRow.tsx` | Meta line uses `text-sm text-text-muted tabular-nums` | **RESTYLE** | Medium -- if RecordRow is changed | RecordRow (shared) | `RecordRow.test.tsx` |

### D2. Source grouping (Candidate A specific)

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| Sticky source group headers (Ad hoc / Experiment / Legacy) | `RunList.tsx` | Currently flat list, no grouping | **DEFER** | IA-specific -- makes a product statement about Runs being a first-class corpus workspace. Needs product approval. | RunList | `RunList.test.tsx` |
| Experiment containers (nested under experiment group) | `RunList.tsx` | No grouping or nesting | **DEFER** | IA-specific -- introduces grouped corpus framing. Real experiment provenance is in RunDetail, not list grouping. | RunList | `RunList.test.tsx` |
| Corpus counts ("X runs, Y experiments") | `RunList.tsx` | No count header | **DEFER** | IA-specific -- "corpus" framing is Candidate A's product thesis, not a visual improvement | RunList | `RunList.test.tsx` |
| Attention chips | `RunList.tsx` | No attention/proactive badges | **DEFER** | Requires unapproved "Needs Attention" semantics | RunList | `RunList.test.tsx` |

**IA flag:** Source grouping, experiment containers, corpus counts, and attention chips are **Candidate A information architecture**, not general visual improvement. They make a product statement about Runs being a first-class corpus workspace. They are DEFERRED until the Product Owner explicitly approves Candidate A's IA, separate from approving the prototype's visual quality.

### D3. Experiment vs ad-hoc vs legacy distinction

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| Visual distinction between ad-hoc, experiment, legacy | `RunList.tsx` + `RecordRow.tsx` (source prop) | Source is shown as uppercase text in meta line; `run-view-model.ts` formats `sourceLabel` | **RESTYLE** | Low -- enhance source visual treatment in RunList composition (not RecordRow global) | RunList only | `RunList.test.tsx` |
| Legacy run degradation | `LegacyRunDetail.tsx` | Already handles legacy records with simpler detail view | **KEEP** | None | LegacyRunDetail | N/A |

**Verdict:** RecordRow is shared -- prefer Runs-specific composition over RecordRow changes. The selected-row accent is the safest, highest-impact RESTYLE (add visual style to the existing `data-selected` attribute). Source identity can be enhanced in RunList's composition layer without touching RecordRow's global rendering.

**Verified blast radius (investigator report):** RecordRow is consumed by **8 production files**: `RunList` (runs rows), `OutputPane`/`RecentRuns` (Compare recent runs), `SuiteList`, `SuiteExperimentHistory`, `ProfileList`, `ProfileDetail` (experiment/task-attempt rows); `formatRelativeTime` is re-imported by `ExperimentTaskLedger` and `SuiteList`. Its props signature + `data-record-row`/`data-record-row-surface` hooks are contractual. **Do NOT change RecordRow props or visual grammar without inspecting all 8 consumers.**

**Slice 2 scope:** (1) Add selected-row left-edge accent via `data-selected` styling (Runs-scoped CSS). (2) Tune row density/gap in RunList. (3) Enhance source identity in RunList composition (not RecordRow). (4) If RecordRow changes are needed, scope them carefully and inspect all 8 consumers.

---

## Section E: Filter Composition

### E1. Filter presentation

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| Always-visible desktop filter controls | `RunFilters.tsx` | Search always visible; model/status/mode/source collapse into a sheet with applied-count badge | **RESTYLE** | Medium -- must preserve all filter semantics and mobile collapse | RunFilters only | `RunList.test.tsx` (search/clear tests) |
| Search integrated into pane header | `RunFilters.tsx` | Search is a standalone input at top of RunList | **RESTYLE** | Low -- positional change within RunList | RunFilters + RunList | `RunList.test.tsx` |
| Status/source chips inline | `RunFilters.tsx` | Filters are dropdown selects in a collapsible sheet | **RESTYLE** | Medium -- different control type, must preserve query semantics | RunFilters only | `RunList.test.tsx` |
| Applied-filter count badge | `RunFilters.tsx` | Already implemented | **KEEP** | None | RunFilters | `RunList.test.tsx` |
| Clear filters | `RunFilters.tsx` | Already implemented | **KEEP** | None | RunFilters | `RunList.test.tsx` |
| Mobile filter sheet | `RunFilters.tsx` | Already collapses to sheet with toggle button | **KEEP** | None | RunFilters | `RunList.test.tsx` |

**Verdict:** Filter semantics are KEEP. The RESTYLE is about desktop presentation: making filters more visible/compact on desktop while preserving the mobile sheet collapse. Do not simplify functionality.

**Slice 3 scope:** Adjust RunFilters desktop presentation to be more compact/visible. Preserve all filter semantics (text, model, status, mode, source). Preserve mobile collapse behavior. Consider responsive approach: desktop shows inline controls, narrow layouts retain sheet.

---

## Section F: Run Detail Visual Hierarchy

### F1. Detail header and sections

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| Stronger header grouping | `RunDetail.tsx` (HeaderSection) | Header section with title, timestamp, status, source | **RESTYLE** | Low -- presentational only | RunDetail only | `RunDetail.test.tsx` (30 tests) |
| Section separators (border-driven) | `RunDetail.tsx` | Uses `gap-4` between sections, no explicit separators | **RESTYLE** | Low -- add border separators | RunDetail only | `RunDetail.test.tsx` |
| Cost cards | `RunDetail.tsx` (CostBreakdownSection) | Already renders cost breakdown data | **RESTYLE** | Low -- visual presentation of existing data | RunDetail only | `RunDetail.test.tsx` |
| Lifecycle/timeline visualization | `RunDetail.tsx` | Shows timestamps as text; no visual timeline | **RESTYLE** | Low -- presentational, using existing timestamp data | RunDetail only | `RunDetail.test.tsx` |
| Contextual actions near header | `RunDetail.tsx` | No actions in header area currently | **ADD** (conditional) | Medium -- must not fabricate data or introduce new semantics | RunDetail only | `RunDetail.test.tsx` |
| Stronger selected-candidate presentation | `RunDetail.tsx` (CandidatesSection) | Candidate selector with compact rows; deep-link focus | **RESTYLE** | Medium -- must preserve deep-link focus behavior, candidate selection, blind-label mapping | RunDetail only | `RunDetail.test.tsx` |
| Improved vertical rhythm | `RunDetail.tsx` | Uses `gap-4` and `p-4` | **RESTYLE** | Low -- spacing tuning | RunDetail only | `RunDetail.test.tsx` |
| Provenance trail | `RunDetail.tsx` (ProvenanceSection) | Already renders experiment provenance links | **KEEP** | None | RunDetail | `RunDetail.test.tsx` |
| Candidate attempts / Judge evidence | `RunDetail.tsx` | Full evidence: attempts, blind labels, judge rationale | **KEEP** | None | RunDetail | `RunDetail.test.tsx` |
| Fusion evidence | `RunDetail.tsx` | Already renders when present | **KEEP** | None | RunDetail | `RunDetail.test.tsx` |
| Task/configuration (collapsed) | `RunDetail.tsx` | Already collapsed by default | **KEEP** | None | RunDetail | `RunDetail.test.tsx` |
| Deep-link focus (candidate/judge) | `RunDetail.tsx` | Already supports `?candidate=` and `?attempt=` | **KEEP** -- critical | None | RunDetail | `RunDetail.test.tsx` |
| Accessibility/focus behavior | `RunDetail.tsx` | Uses `useEffect` + `useRef` for scroll/focus on deep-link | **KEEP** -- critical | None | RunDetail | `RunDetail.test.tsx` |

**Verdict:** RunDetail is richer than the prototype. Use the prototype for hierarchy and rhythm, not data reduction. Every evidence field, deep-link, and accessibility behavior must survive.

**Slice 4 scope:** (1) Add section separators. (2) Improve header grouping. (3) Restyle cost breakdown as visual cards using existing data. (4) Improve vertical rhythm. (5) Enhance selected-candidate presentation. (6) Optionally add timeline-like lifecycle visualization using existing timestamps. Preserve all evidence, deep-links, and accessibility.

---

## Section G: Contextual Continuity (Slice 5 -- requires explicit verification)

**VERIFIED feasibility findings (investigator report, 2026-08-09):**

### G1. Compare -> View record

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| "View record" link from Compare result to Runs | `OutputPane.tsx` | Empty state shows Recent Runs and "View all runs" via RecordRow; live completed result does NOT directly expose its persisted record | **ADD -- requires small controller change** | Medium | OutputPane + rsemble.tsx + run-controller.ts | `OutputPane.test.tsx` (34 tests) |
| Recent runs list in empty state | `OutputPane.tsx` | Already shows recent runs via RecordRow with links to `/runs/:runId` | **KEEP** | None | OutputPane | `OutputPane.test.tsx` |

**Verified evidence (from `subagent-summary-2`):**
- `StudioState` has **no runId field** (0 matches in `studio-engine.ts`)
- `createRunController` returns only `runFanout/abortRun/retryCandidate/retryJudge/triggerFusion` -- **no runId getter**; `runIdRef` is closure-private
- `compareRunIdRef` in `rsemble.tsx` mints a **DIFFERENT id** (`cmp-<ts>-<rand6>` for execution-owner lease) than the persisted runId (`run-<ts>-<rand6>` minted inside the controller closure)
- **Clean fix:** expose last-runId from the controller (dispatch into StudioState or return from `runFanout`) -- do NOT fabricate an ID
- **Zero-controller-change fallback (rejected):** query newest run via `useRunList(repo, {limit:3})` -- risk of matching the wrong run on rapid consecutive runs
- Persisted runId format: `run-${now()}-${random().toString(36).slice(2,8)}` (ad-hoc); `run-${crypto.randomUUID()}` (suite experiments)

**Verdict:** ADD, but only after the controller exposes the persisted runId. This is a behavior-bearing change (controller/state), not pure presentation -- must be its own verification step.

### G2. Run Detail -> Open in Compare

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| "Open in Compare" from Run Detail | `RunDetail.tsx` | No such action exists; RunDetail is read-only evidence | **ADD (conditional)** | High | RunDetail + rsemble.tsx (restore-to-state mechanism) | `RunDetail.test.tsx` (30 tests) |

**Verified evidence:**
- RunRecordV2 stores everything needed for a faithful restore: task, evaluation profile, slots, critic
- `resolveEvaluationProfile` round-trips the persisted profile
- No existing "Open in Compare" anywhere in production
- Prototype pattern (verified across all 4 candidates, after fairness fix CC-1): preload frozen task/configuration ONLY, show "Configuration loaded from run X" notice + model-slot tags, explicitly NO fabricated result; legacy runs get disabled button with tooltip

**Constraints (from prototype final-report, semantic constraint #1):** Open-in-Compare stays **S-class only without lineage** -- adding `rebasedFrom` or record mutation would make it P-class requiring product authority.

**Verdict:** ADD but deferred within Slice 5 -- requires a new restore-to-state mechanism verified against provider-availability checks, legacy degradation, and no-persisted-lineage. Prototype parity already confirmed for the honest-preload pattern (not fabrication).

### G3. Copy link

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| "Copy link" from Run Detail | `RunDetail.tsx` | No such action exists | **ADD** | Low | RunDetail only | `RunDetail.test.tsx` |

**Verified evidence:** HashRouter URL (`#/runs/:runId?candidate=&attempt=`) is the real shareable URL; deep-link query params are already parsed by RunsWorkspace. Clipboard API + "Copied!" feedback + textarea fallback pattern verified in prototype. **Verdict:** safe ADD, lowest risk of Slice 5.

---

## Section H: Responsive and Mobile

### H1. Responsive behavior

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| Desktop split layout | `RunsWorkspace.tsx` | 380px list + flex-1 detail, `useResizableSplit` | **KEEP** | None | RunsWorkspace | `RunsWorkspace.test.tsx` |
| Route-based mobile detail | `RunsWorkspace.tsx` | `/runs` -> list, `/runs/:runId` -> detail with Back button | **KEEP** -- critical | None | RunsWorkspace | `RunsWorkspace.test.tsx` |
| Filter sheet on mobile | `RunFilters.tsx` | Collapsible sheet with toggle | **KEEP** | None | RunFilters | `RunList.test.tsx` |
| Header responsive compaction | `Header.tsx` + `MobileWorkspaceNav.tsx` | Already implemented | **KEEP** | None | Header | N/A |

**Verdict:** Responsive architecture is KEEP. All RESTYLE changes must be verified at wide desktop, ~1024px transition, tablet, and phone widths.

---

## Section I: Evaluation Provenance

### I1. Evaluation -> Run continuity

| Prototype Feature | Production Component | Current Production Behavior | Classification | Risk | Blast Radius | Tests |
|---|---|---|---|---|---|---|
| ResultMatrix links to `/runs/:runId` | `ResultMatrix.tsx` | Already links individual results to run records | **KEEP** | None | ResultMatrix | `ResultMatrix.test.tsx` |
| SuiteExperimentHistory uses RecordRow | `SuiteExperimentHistory.tsx` | Uses RecordRow list variant with links to runs | **KEEP** -- RecordRow blast radius if changed | None | SuiteExperimentHistory | `SuiteExperimentHistory.test.tsx` |

**Verdict:** Evaluation provenance is KEEP. Any RecordRow changes must be verified against ResultMatrix and SuiteExperimentHistory.

---

## Section J: Candidate A IA Separation

The following prototype features from `first-class-runs.html` are **IA-specific** (Candidate A's product thesis), not general visual improvement:

| Feature | Why it's IA-specific | Classification |
|---|---|---|
| "Run corpus" framing | Makes a statement that Runs is a first-class corpus workspace | **DEFER** |
| Grouped source sections (sticky headers) | Introduces corpus grouping as a product concept | **DEFER** |
| Experiment containers (nested) | Introduces experiment-as-container as a product concept | **DEFER** |
| Corpus counts ("X runs, Y experiments") | Introduces corpus-level metrics | **DEFER** |
| Attention chips / Needs Attention | Requires unapproved lifecycle semantics | **DEFER** |
| Status timeline | Could be visual-only or IA-specific (depends on implementation) | **RESTYLE** (visual version only) |
| Proactive navigation badges | Requires unapproved navigation semantics | **DEFER** |
| Archive/delete/retention | Requires unapproved lifecycle semantics | **DEFER** |
| rebasedFrom | Requires unapproved data model semantics | **DEFER** |

**Rule:** For every Candidate A feature, ask: "Is this part of the visual language we want regardless of Runs placement, or does it make a product statement about Runs being a first-class corpus workspace?" If IA-specific, flag it and DEFER.

---

## Implementation Slice Order

| Slice | Target | Classification Focus | Risk Level | Dependencies |
|---|---|---|---|---|
| 1 | `RunsWorkspace.tsx` -- shell/pane composition | RESTYLE (padding/border) | Low | None |
| 2 | `RunList.tsx` -- row visual grammar | RESTYLE (selected accent, density, source identity) | Low-Medium | Slice 1 |
| 3 | `RunFilters.tsx` -- filter composition | RESTYLE (desktop visibility) | Medium | Slice 2 |
| 4 | `RunDetail.tsx` -- detail hierarchy | RESTYLE (separators, rhythm, cost cards, header) | Low-Medium | None (parallel to 2-3) |
| 5 | `OutputPane.tsx` + `RunDetail.tsx` -- contextual continuity | ADD (conditional on verification) | Medium-High | Slices 2-4 |

---

## Regression Traps

| Trap | Affected Components | Mitigation |
|---|---|---|
| RecordRow blast radius | RecordRow is used by Compare recent runs, experiment history, task-attempt rows | Prefer RunList-specific composition over RecordRow changes. If RecordRow must change, inspect all consumers visually. |
| Filter regression | RunFilters has 5 real filters + mobile sheet + applied count + clear | Preserve all filter semantics. Test at all viewport widths. |
| RunDetail evidence loss | 30 tests cover candidate selector, judge evidence, fusion, deep-links, provenance | Run full `RunDetail.test.tsx` after every change. Verify deep-link focus manually. |
| Compare state corruption | `compareRunIdRef` in rsemble.tsx, StudioState | Do not overwrite StudioState with prototype-style compareState. |
| Routing | HashRouter, `/runs`, `/runs/:runId`, deep-link query params | Do not change routes. Test deep-links after every slice. |
| Mobile | Route-based detail, filter sheet | Test at phone width after every slice. |
| Legacy runs | `LegacyRunDetail.tsx`, legacy import summaries | Do not assume frozen configuration exists. Test with legacy fixtures. |
| Experiment provenance | ProvenanceSection in RunDetail, ResultMatrix links | Do not collapse real provenance into visual grouping. |

---

## Visual Success Criteria

After implementation, the Runs workspace should feel:
- [x] Less "cards floating inside cards" (verified 2026-08-09, final visual parity review)
- [x] Clearer pane hierarchy (border-driven, not gap-driven) (verified 2026-08-09)
- [x] Denser but still readable run scanning (verified 2026-08-09)
- [x] Source and status understood at a glance (verified 2026-08-09)
- [x] Stronger selected-record state (left-edge accent) (verified 2026-08-09)
- [x] Cleaner detail header with deliberate metadata hierarchy (verified 2026-08-09)
- [x] More polished spacing rhythm in detail (verified 2026-08-09)
- [x] Stronger continuity between list and detail (verified 2026-08-09)
- [x] Cyan accent used selectively, not everywhere (verified 2026-08-09)

Verification evidence: docs/qa/runs-visual-parity/REPORT.md (18/18 numeric
probes, screenshots, vision pass). Residuals: per-row RecordRow card outline
(deliberate shared-component scope, see O2 in report); tab-lease banner
truncation (out of Runs-UI scope, see O1).

## Behavioral Success Criteria

After implementation, these must NOT regress:
- [ ] Compare execution (Rank, Fuse, candidate retries, Judge retry)
- [ ] Run persistence
- [ ] Run search/filtering (all 5 filters)
- [ ] Pagination (load more)
- [ ] Runs deep links (`/runs/:runId`)
- [ ] Candidate deep links (`?candidate=`)
- [ ] Judge-attempt deep links (`?attempt=`)
- [ ] Experiment provenance
- [ ] Evaluation evidence links
- [ ] Legacy run handling
- [ ] Accessibility/focus
- [ ] Responsive navigation (desktop split, mobile route-based)

---

## Test Baseline (verified before implementation)

```
Test Files  10 passed (10)
     Tests  150 passed (150)
  Duration  1.64s

Components tested:
  StatusMark.test.tsx (16 tests)
  useRunList.test.tsx (8 tests)
  RecordRow.test.tsx (10 tests)
  run-view-model.test.ts (23 tests)
  RunsWorkspace.test.tsx (5 tests)
  OutputPane.test.tsx (34 tests)
  useRunDetail.test.tsx (6 tests)
  CompactModelLabel.test.tsx (8 tests)
  RunDetail.test.tsx (30 tests)
  RunList.test.tsx (10 tests)
```

---

## Authorization Gate

This transplant map is the **first deliverable**. No production edits are authorized until this map has been reviewed and the implementation slices are approved.

**Key constraints for the implementing agent (GLM):**
1. Preserve production component behavior and data model
2. Adopt specific visual/compositional properties from the prototype
3. Report: behavior preserved, behavior changed, prototype ideas ported, prototype ideas omitted, files changed, tests run
4. Do NOT convert HTML to React -- transplant visual intent into existing components
5. Do NOT port prototype routing, state machine, synthetic data, or direct-DOM interaction
