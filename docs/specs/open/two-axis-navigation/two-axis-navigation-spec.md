# Two-Axis Navigation — Compare · Benchmark · Calibrate · Policy Study

> **Status: PENDING — not executed.** Written 2026-08-24. This is navigation and
> information-architecture work only: chrome, routes, labels, and one new
> single-task surface. No execution logic changes. Adoption requires a new
> authorized cycle (Run 29 ended TERMINAL STOP pending user decision); this
> document is the design contract to evaluate before any implementation begins.

> **Interactive design concept:** [`design-concept.html`](./design-concept.html)
> — Concept Meridian demonstrates all four cells, the floating two-dial
> navigation, evidence-grade honesty, materials, and motion.

---

## A. Authority and status

### A.1 What this document is

The binding specification for reorganizing RSemble's primary navigation from
four peer destinations (`Compare · Evaluations · Lab · Models`) into a two-axis
model — **subject** (which factor varies: models or finish policies) ×
**scope** (single task or task suite) — and for adding the missing fourth cell:
a single-task strategy comparison surface (**Calibrate**).

### A.2 What this document amends

This spec amends exactly these decisions from the shipped Child 08 spec
(`docs/specs/archive/task-first-evidence-workbench/08-workbench-shell-and-records/workbench-shell-and-records-spec.md`):

| Amended decision | Change |
| --- | --- |
| §G.5 Desktop primary nav (four destinations) | Replaced by the AxisBar (§E). `/compare /evaluations /lab /models` stops being the primary nav model. |
| §G.6 Mobile bottom nav (four destinations) | Retired. Replaced by the compressed AxisBar subheader (§J). |
| §C.3 Rank/Fuse control placement | **Strengthened**, not changed: the Finish control renders only in the Models × Single surface. See §C.3 below. |

Everything else in Child 08 stands: §C.1 layering, §C.2 secondary utilities
(Records stays secondary chrome, never primary nav), §C.4 global execution
awareness, the Records utility, the quick Records drawer, route-map conventions
for legacy redirects, and all visual/accessibility law (44px targets,
non-hue-only active states, no `text-muted` on interactive elements, ≥11px
text floor).

### A.3 Explicitly not changed

- Execution logic. `src/lib/pipeline.ts`, `studio-engine.ts` logic,
  `studio-data.ts` seeds, and `src/lib/providers/` are untouched. Calibrate
  *reuses* existing, shipped machinery (§G.3); it does not modify it.
- Internal code identifiers. `EvaluationsWorkspace`, `experiment-controller`,
  `LeaseKind = "compare" | "experiment"`, persistence table names, and test
  harness names are **not** renamed. Chrome labels, routes, and the nav
  component change; internal vocabulary stays.
- The `mode` concept. Rank/Fuse finish choice stays a per-task execution
  parameter. It never becomes a navigation concept.
- Records, Attention, Search, and the Models Observatory. They are
  non-testing surfaces and remain reachable exactly as today (§I).

### A.4 Design thesis

The Lab/Evaluations confusion is a **categorization failure**, not an
information-density problem: the two labels share too many surface features
(both are multi-task, both produce results tables), so users retrieve the
wrong destination. The fix is to replace label memorization with a
**generative rule** — two orthogonal choices anyone can execute to compute
where a workflow lives, including workflows they have never seen before.

Honest framing of the win: four destinations and two binary switches carry
identical choice information (log₂4 = 2 bits). The redesign does **not** make
navigation faster; it makes destinations **predictable** and eliminates the
overlap between two categories. Success is measured as wrong-destination
errors, not click time (§N).

---

## B. Problem statement

B.1 **Category overlap.** `Lab` and `Evaluations` both read as "where tests
happen." The distinction (model benchmarking vs. policy studies) is invisible
in the chrome and must be memorized. First-click evidence: users seeking
"test these models across my task set" open Lab; users seeking "is fusion
worth it on tasks like mine" open Evaluations.

B.2 **The missing cell.** The product supports: models × single (Compare),
models × suite (Evaluations), policies × suite (Lab Policy Studies). Policies
× single has no surfaced home — despite the execution machinery for it
existing and being tested (`src/evaluations/policy-runner.ts`,
`planBlockedPolicies`: Rank/Fuse/Refine planned from *shared* candidate
generations and Judge-1 evidence, only the finish varies; spec test 7 in
`policy-runner.test.ts` asserts the blocking invariant).

B.3 **Structure is hidden.** The product's real organization (two independent
questions: *what varies* and *at what scale*) appears nowhere in the UI. This
spec makes the structure the navigation.

---

## C. The two-axis model

### C.1 Axis definitions (normative)

**Subject — which factor varies.**

| Subject | Independent variable | Held constant | Grounding |
| --- | --- | --- | --- |
| **Models** | Model identity across candidate slots | Finish policy (run-config `mode`) | `/compare`, experiment matrices |
| **Strategies** | Finish **policy**: `best_fixed \| rank \| fuse \| refine` (`FusionPolicyKind`, `src/evaluations/fusion-study-types.ts:426`) | Model pool | Policy studies, blocked policies |

**Scope — at what scale.**

| Scope | Task quantity | Artifact |
| --- | --- | --- |
| **Single** | One task, one run | A result |
| **Suite** | A pinned Task Set, run as a batch | An aggregate with per-task rows |

### C.2 The independence correction

"Models vs strategies" is **not** a pair of parallel subjects: every strategy
test is parameterized by a model pool (every study trial carries a `poolRef`).
The axes stay honest only under this rule:

> **In Models cells, the finish policy is a setting. In Strategies cells, the
> finish policy is the thing under test.**

Consequences:

- **C.2a — Pool visibility.** Every Strategies surface renders its pinned
  candidate pool as a labeled secondary parameter (subordinate to the policy
  treatments). A strategy screen with no visible pool is a defect.
- **C.2b — Mode trap.** The Rank/Fuse `ModeToggle` (`src/ui/ModeToggle.tsx`,
  `aria-label="Finish mode"`) renders **only** on the Models × Single
  surface. In the Strategies subject, policies appear as comparison rows in a
  table — never as a selector. The existing header guard test ("keeps Finish
  out of the global header", `WorkspaceNav.test.tsx:354`) is retained and its
  assertion scope extended to the AxisBar.
- **C.2c — Shortcut isolation.** The ⌘/ finish toggle
  (`src/ui/useActionShortcuts.ts:88`) keeps firing **only** on routes that own
  Compare execution. Strategies surfaces never bind a finish-mode shortcut
  (existing isolation precedent: `lab-qa-rev7-shortcut-isolation.test.tsx`).

### C.3 Vocabulary (normative)

Enforced in chrome copy. Internal code identifiers are exempt (§A.3).

| Term | Meaning | Rule |
| --- | --- | --- |
| **subject** | `models` \| `strategies` | Navigation concept |
| **scope** | `single` \| `suite` | Navigation concept |
| **mode** / **finish** | `rank` \| `fuse` | Execution concept. Compare-interior only. Never in nav, never in Strategies chrome. |
| **policy** | `best_fixed` \| `rank` \| `fuse` \| `refine` | The treatment under test in the Strategies subject |
| **Compare** | Models × Single | Cell name |
| **Benchmark** | Models × Suite | Cell name |
| **Calibrate** | Strategies × Single | Cell name |
| **Policy Study** | Strategies × Suite | Cell name |
| **Observatory** | Read-only model evidence (`/models`) | Evidence concept, not a testing surface |

**Banned in chrome:** "Lab" (retired; existing Records copy already says
"Policy Study" — `src/records/record-owner.ts:54` — so the rename aligns
chrome with shipped domain language), "Evaluations" as a destination label
(the word is saturated: the Judge output schema contains an `evaluations`
field, `src/lib/pipeline.ts:412`), "Quick" (a speed promise the product
cannot guarantee), "Experiment" (internal identifier only).

### C.4 Cell map

| | Single | Suite |
| --- | --- | --- |
| **Models** | **Compare** — candidate models on one task; Rank or Fuse finish chosen at run time | **Benchmark** — models across a pinned Task Set; execution matrix, aggregate results, missing-cell recovery |
| **Strategies** | **Calibrate** — finish policies blocked on one task over a pinned pool; snapshot evidence (**new**, §G.3) | **Policy Study** — policies across a pinned Task Set; staged protocol, MPID verdicts, playbook with `claimLevel` |

---

## D. Route map

Derived from the shipped route table (`src/app-router.tsx:141-243`). Redirect
convention follows the existing `LegacyRunsRedirect` / `LegacySuiteRedirect` /
`LegacyExperimentRedirect` / `RetiredFusionRoute` precedent: permanent
client-side redirects preserving path suffix, query, and state.

### D.1 Canonical routes

| Route | Surface | Status |
| --- | --- | --- |
| `/compare` | Compare (Models × Single) | **unchanged** |
| `/compare/results/:comparisonId` | Comparison result | unchanged |
| `/calibrate` | Calibrate (Strategies × Single) | **new** |
| `/calibrate/results/:calibrationId` | Calibration result | **new** |
| `/benchmark` | Benchmark (Models × Suite) | moved from `/evaluations` |
| `/benchmark/sets/*` | Task Sets | moved from `/evaluations/sets/*` (identity of editor/version/task routes preserved) |
| `/benchmark/rubrics/*` | Rubrics | moved from `/evaluations/rubrics/*` |
| `/benchmark/results/:evaluationExecutionId` | Benchmark execution results | moved from `/evaluations/results/*` |
| `/strategies` | Policy Study (Strategies × Suite) — studies index | moved from `/lab` |
| `/strategies/studies/:studyId` | Policy Study detail | moved from `/lab/studies/:studyId` |
| `/strategies/recipes*` | Fusion Recipes | moved from `/lab/recipes*` (`/versions/:version` preserved) |
| `/strategies/model-pools*` | Model Pools | moved from `/lab/model-pools*` (`/versions/:version` preserved) |
| `/models/*` | **Models Observatory** (read-only evidence) | **unchanged** |
| `/tasks*`, `/records*`, `/attention`, `/search`, `/runs*` (legacy), `/experiments/:experimentId` (legacy) | — | unchanged |

### D.2 Redirects (permanent)

| From | To | Notes |
| --- | --- | --- |
| `/evaluations` → `/benchmark` | suffix-preserving | `/evaluations/sets/s1` → `/benchmark/sets/s1`; query preserved (`LegacyExperimentRedirect` already demonstrates query preservation) |
| `/lab` → `/strategies` | suffix-preserving | `/lab/studies/x` → `/strategies/studies/x`; `/lab/recipes*` → `/strategies/recipes*`; `/lab/model-pools*` → `/strategies/model-pools*` |
| `/evaluations/profiles*` | existing rubric redirects | preserved verbatim, re-pointed at `/benchmark/rubrics/*` |
| `/evaluations/:suiteId/fusion/:studyId` | retired-route notice | `RetiredFusionRoute` behavior preserved under the moved path |
| `/evaluations/:suiteId` | legacy-suite redirect | `LegacySuiteRedirect` behavior preserved |

### D.3 Records owner crosswalk

`resolveRecordOwner` (`src/records/record-owner.ts`) currently emits
`ownerHref: /lab/studies/:id` and `ownerLabel: "Policy Study in the Lab"`.
Normative changes:

- Emitted hrefs move to `/strategies/studies/:id`; emitted label becomes
  "Policy Study" (no "in the Lab" suffix — the Lab no longer exists).
- Persisted legacy hrefs (`/lab/...`) inside stored run sources and
  crosswalks resolve through the §D.2 redirects — no data migration required.
- New `ownerKind: "calibration"` added to both unions in `record-owner.ts`
  and `record-reference.ts`, with `ownerHref: /calibrate/results/:id` and
  `ownerLabel: "Strategy Calibration"`.
- NotFound copy ("Return to Compare", asserted in `rsemble-shell.test.tsx:132`)
  remains valid.

---

## E. The AxisBar (primary navigation chrome)

New component `src/ui/AxisBar.tsx`, rendered in the header center
(`src/ui/Header.tsx:141-143` currently mounts `WorkspaceNav`). **Clean
cutover:** `WorkspaceNav.tsx` and `MobileWorkspaceNav.tsx` are deleted, not
re-skinned; their tests are rewritten against the AxisBar.

### E.1 Structure

Two segmented controls, fixed order and fixed position on every testing
surface:

```
[ Models | Strategies ]   [ Single | Suite ]
   subject control           scope control
```

- **Subject control**: segments carry icon + label. Icons: `Cpu` (Models),
  `TestTubes` (Strategies — inherited from the retired Lab item). Icons
  decorative (`aria-hidden`); labels are the accessible name.
- **Scope control**: text-only segments ("Single", "Suite").
- Active segment: `aria-current="page"` + the existing static 2px accent bar
  treatment (non-hue-only signal, per Child 08 law). No sliding indicator.
- Controls are visually grouped but hit-tested independently; a 12px gap
  separates them. Neither control ever reflows when the other is operated.

### E.2 Behavior invariants

- **E2.1 Independence.** Operating one control never changes the other
  control's state. Subject × scope fully determines the surface; every stored
  or linked URL sets both controls deterministically (D.1 table is the single
  mapping; no hidden state).
- **E2.2 Always operable.** Both controls work from every testing surface
  **and** from Strategies asset pages (`/strategies/recipes*`,
  `/strategies/model-pools*`): operating a control there navigates to the
  corresponding testing surface. On asset pages the subject reads Strategies;
  scope reflects the last-visited testing scope (default Single).
- **E2.3 Non-testing surfaces show no axis state.** On `/models/*`,
  `/records`, `/attention`, `/search`, the header center renders the surface
  title instead of the AxisBar. The Observatory is not a cell, and rendering
  an AxisBar there would falsely imply it is (see §I.2 for the Models/Models
  scent-collision rule).
- **E2.4 Default.** An empty/unknown navigation state resolves to
  Models × Single (`/compare`), matching the existing `/` → `/compare`
  redirect.
- **E2.5 URL is the state.** No persisted "last axis" storage beyond the
  asset-page scope memory (E2.2). Back/forward and deep links always work;
  no sessionStorage axis cache.

### E.3 Rendering rules inherited unchanged

`min-h-[44px]` targets; `:focus-visible` ring on every segment; hover fill
`bg-panel`; active text `text-accent`; inactive text `text-text-secondary`
(never `text-muted`); `aria-label="Primary"` on the landmark
(`<nav aria-label="Primary">`).

### E.4 Segmented-control semantics

Each control is a `role="radiogroup"` with an accessible name
("Testing subject", "Scope") and its segments are `role="radio"` links with
`aria-checked` mirroring `aria-current`. Full keyboard operation: roving
`tabindex`, Arrow keys move within the group, Enter/Space activates, Home/End
jump to first/last. (Controls are links that navigate; the radiogroup role
communicates mutual exclusion, matching how `ModeToggle` already models a
two-way choice.)

---

## F. State carry and transition rules

The dial metaphor survives only if switching is never destructive.

- **F1 — Same-cell re-entry.** Returning to a previously visited surface in
  the same session restores its in-memory draft exactly as left (existing
  per-workspace draft behavior is unaffected).
- **F2 — Single → Suite (Models).** From Compare with task text present,
  choosing Suite lands on `/benchmark` and offers "Create a Task Set from
  this task" — a prefill action, not an auto-apply. Declining loses nothing:
  the Compare draft remains.
- **F3 — Suite → Single.** Benchmark task rows and Task Set editors offer
  "Run this task in Compare" / "Calibrate this task" per-task actions. The
  set itself is never mutated by navigation.
- **F4 — Subject switch within Single.** Compare ↔ Calibrate: task text and
  candidate slots carry (Calibrate's pool defaults to Compare's enabled
  slots; judge and rubric carry). Nothing else migrates.
- **F5 — Subject switch within Suite.** Benchmark ↔ Policy Study: the pinned
  Task Set reference carries as the study draft's suite candidate. Model
  slots carry to the study's pool draft only as a suggestion.
- **F6 — Results never migrate.** Completed artifacts stay in their cell;
  cross-cell linkage happens through Records owner references (D.3), not by
  copying results.
- **F7 — Executions in flight are axis-independent.** Axis switching never
  aborts an execution. The header live pill and 2px global progress cue
  (Child 08 §C.4) persist across all surfaces, including non-testing ones.
  Attempting to start any execution while another holds the owner shows the
  existing conflict copy ("Another execution is active",
  `experiment-controller.ts`).

---

## G. The four surfaces

### G.1 Compare — Models × Single (position change only)

Functionality unchanged. PipelineRail, candidates, Judge, Rank/Fuse finish,
Fusion result, results routes, playbook-execution hooks — all stay. What
changes: its nav identity (subject = Models, scope = Single) and its
relationship visibility to Benchmark. The `ModeToggle` remains exactly where
Child 08 §C.3 put it.

### G.2 Benchmark — Models × Suite (rename + route move)

Today's Evaluations workspace, moved per §D. Chrome label changes
("Evaluations" → "Benchmark"); workspace internals (Task Sets, Rubrics,
execution matrices, missing-cell recovery, roster extension) are untouched.
Internal identifiers (`EvaluationsWorkspace`, `experiment-controller`,
`/benchmark/results/:evaluationExecutionId` param names) stay.

### G.3 Calibrate — Strategies × Single (**new surface**)

**Purpose.** "For this one task, which finish policy is worth it?" A blocked
comparison of `best_fixed`, `rank`, `fuse`, and `refine` over shared
candidate generations and shared Judge-1 evidence. A sanity check, not a
study.

**G.3.1 Inputs.**

| Input | Source | Required |
| --- | --- | --- |
| Task (prompt, system prompt, attachments) | carried from Compare (F4) or authored in place | yes |
| Candidate pool (≥2 models) | slots carried from Compare or picked in place | yes |
| Judge | existing judge config | yes |
| Rubric | optional; when pinned it drives `rankValue` (Q − λ(1−C)) for *all* policy outputs — the same contract as studies | no |
| Fusion recipe + synthesizer | recipe picker (Strategies assets) | when `fuse` is in the policy set |
| Reviser | model ref | when `refine` is in the policy set |
| Policy set | any subset of the four policies; default = all four | yes |

**G.3.2 Execution contract (reuse, don't rebuild).**

- Fanout + Judge-1 run through the **existing** pipeline. `pipeline.ts` is
  not edited.
- Policy planning via `planBlockedPolicies`
  (`src/evaluations/policy-runner.ts`): all policies share identical
  candidate generations and Judge-1 evidence; only the finishing step varies.
  The refine control inherits the fusion recipe's `rubricAccess` and
  `verification` flags (confound control, fusion-study spec §7.1) — this
  invariant is asserted, not eyeballed.
- `findBlindnessViolations` MUST return empty before any synthesizer-bound
  message is sent (existing orchestrator refusal rule, preserved).
- Rank derivation via `deriveRankWinner` with the pinned rubric profile — the
  blocked Rank baseline uses the same authoritative `rankValue` contract as
  fuse/refine (regression-tested in `policy-runner.test.ts:111`).
- New orchestrator `src/lib/evaluations/calibration-controller.ts` owns
  sequencing and persistence; it performs provider calls only through the
  executor interfaces the study stages already use.

**G.3.3 Evidence honesty (the actual design problem of this cell).**

One task cannot support a policy claim. The surface must make that
structurally unmistakable:

- Result header carries a permanent **snapshot label**: "Snapshot · one task
  · unconfirmed". Never styled like a conclusion.
- Output is a per-policy table: policy · configuration · score · cost
  multiplier · answer preview. **No** playbook, **no** MPID verdicts, **no**
  claim levels, **no** recommendation chrome, **no** confidence glyphs.
- Copy law: copy says "on this task", never "for tasks like this".
  (`recommendPolicy`'s conclusion phrasing is suite-scoped and must not be
  reused here.)
- Visual weight law: one screen, zero ceremony — no stages, no protocol
  steps, no pinned-plan disclosure. Study chrome communicates rigor;
  Calibrate chrome communicates speed. If a user cannot tell which surface
  they are on from chrome alone, the surface is defective.

**G.3.4 Escalation path.**

The result's single primary action: **"Test across a Task Set"** — creates a
Policy Study draft prefilled with the pool, policy set, recipe, and rubric
from the calibration. Navigation, not copy: the draft references the
calibration via Records owner reference; the calibration is never mutated.

**G.3.5 Persistence and evidence boundary.**

- New repository `src/lib/persistence/calibration-repository.ts` (Dexie
  table, following the `fusion-study-repository` precedent) persisting the
  typed **Strategy Calibration** artifact: task ref, pool ref, pinned rubric
  ref, policy rows, per-policy run lineage, snapshot label.
- Archive schema: new collection key added per archive-v3 conventions
  (`src/lib/persistence/archive-v3-types.ts`) with validators; migration
  follows the phased-repair precedent.
- Evidence boundary mirrors the shipped study boundary
  (`policy-study-candidate-adapter.ts` §9/F2): underlying candidate runs are
  eligible model observations; rank selections, fused/refined synthesis
  artifacts, and policy rows are policy evidence and **never** become model
  evidence profile inputs.
- Records: typed record + `ownerKind: "calibration"` per §D.3. Attention:
  calibration failures enter the attention feed with
  `source: { kind: "calibration", calibrationId }`, mirroring the
  `experiment` source shape in `evaluation-attention.test.ts`.

**G.3.6 Execution ownership.**

Calibrate acquires the in-tab owner and cross-tab lease with the **existing**
`"experiment"` kind (`ExecutionOwnerKind`/`LeaseKind` unchanged):
`tryAcquire({ kind: "experiment", id: calibrationId })` +
`lease.acquire({ kind: "experiment", executionId: calibrationId })`.
Rationale: a calibration runs syntheses like a study; the mutex semantics
(one execution at a time, app-wide) dominate. Adding a third lease kind
without new concurrency semantics would be weightless code.

### G.4 Policy Study — Strategies × Suite (rename + route move)

Today's Lab. Studies (`PolicyStudyList/Editor/Page/View/Execution`) moved per
§D; the staged protocol (A/B/C), MPID comparisons, playbook recommendations,
and `exploratory → confirmed` claim lifecycle are untouched. Chrome surfaces
the claim level it already computes — rigor is a visible property of this
cell, by design contrast with G.3.3.

**Naming note:** this rename is alignment, not invention — Records has called
these artifacts "Policy Study" since Child 08 (`record-owner.ts:54`), and
`planBlockedPolicies`/`PolicyRecommendation` vocabulary predates this spec.

---

## H. Strategy assets (Recipes, Model Pools)

- Assets remain second-level surfaces **inside the Strategies subject**:
  `/strategies/recipes*`, `/strategies/model-pools*` (moved from `/lab/*`).
- A persistent second-level sub-nav (Studies · Recipes · Model Pools) renders
  on all Strategies surfaces — single and suite alike — so assets are
  reachable from Calibrate without a context switch. It is never part of
  primary chrome.
- Recipes and pools are versioned assets; authoring flows
  (`LabRecipeForm`, `ModelPoolForm`, version pages) move unchanged except
  routes and breadcrumbs.

---

## I. Non-testing surfaces

### I.1 What stays

Models Observatory (`/models/*`), Records, Attention, Search: unchanged in
behavior and reachability. Records stays secondary chrome (Child 08 §C.2);
the quick Records drawer and its `≥1024px` substitution rule (§H.6) are
untouched.

### I.2 The Models/Models collision (scent rule)

The subject segment "Models" and the `/models` destination are different
things (testing vs. evidence). Rules:

- The AxisBar never renders on `/models/*` (E2.3) — the Observatory is not a
  cell.
- Chrome references to that destination use the label **"Observatory"** (or
  "Model evidence"), never bare "Models", wherever a label is needed
  (back-links, empty states, Records owner labels).
- Every model chip rendered on any testing surface links to that model's
  Observatory profile; Observatory profiles link out to "Compare this pool"
  (→ `/compare`, slots prefilled) and "Calibrate this pool" (→ `/calibrate`).
- Epistemic separation stays visual: the Observatory renders read-only
  chrome with no primary action buttons; testing surfaces always carry a
  primary action.

---

## J. Responsive behavior

- **≥768px (desktop/tablet):** AxisBar in the header center per §E.
- **<768px (mobile):** the four-item bottom nav (`MobileWorkspaceNav`,
  Child 08 §G.6) is **retired**. On testing surfaces, a sticky subheader row
  below the header carries the same two segmented controls, one row,
  horizontally non-scrolling (segments compress to min-content with the 44px
  height floor intact). Safe-area insets respected; the existing bottom
  padding adjustment (`pb-[calc(56px+env(safe-area-inset-bottom))]`) is
  removed with the nav it pads for.
- Records remains reachable at all widths via the header utility (its
  Child 08 all-widths rule stands). Attention and Search remain reachable via
  header utilities and the palette.
- The mobile drawer (hamburger) keeps command-pane access on `/compare`
  exactly as today.

---

## K. Accessibility

All Child 08 law stands. Additions specific to this spec:

- **K1.** Segmented controls: `radiogroup`/`radio` semantics per §E.4; full
  keyboard operation; focus never trapped; arrow-key movement does not
  navigate (activation does) — matching radio conventions and avoiding
  surprise navigation on key repeat.
- **K2.** Axis-switched navigation announces the surface change:
  `aria-live="polite"` region emitting "Compare — testing models, single
  task" style strings on landing (strings are copy-reviewed, never
  machine-concatenated axis names).
- **K3.** The snapshot label on Calibrate results is text, not a color chip
  (never hue-only meaning).
- **K4.** Reduced motion: surface transitions respect
  `prefers-reduced-motion`; the AxisBar itself has no sliding animation to
  disable (Child 08 banned the sliding indicator; this spec keeps the ban).
- **K5.** OAuth of existing floors: ≥44px targets, ≥11px text,
  `text-secondary` minimum on interactive text, `:focus-visible` everywhere,
  no `zinc-*` utilities.

---

## L. Components and touch list

### L.1 New

| File | Responsibility |
| --- | --- |
| `src/ui/AxisBar.tsx` | Subject + scope segmented controls (§E) |
| `src/workspaces/calibrate/CalibrateWorkspace.tsx` | Calibrate surface: form, result, escalation |
| `src/lib/evaluations/calibration-controller.ts` | Blocked-policy orchestration via existing executors (§G.3.2) |
| `src/lib/persistence/calibration-repository.ts` | Strategy Calibration persistence (§G.3.5) |
| `BenchmarkRedirect.tsx` / `LabRedirect.tsx` | §D.2 redirects (naming follows `LegacySuiteRedirect`) |

### L.2 Amended

| File | Change |
| --- | --- |
| `src/app-router.tsx` | §D.1/D.2 route table + redirects |
| `src/ui/Header.tsx` | Mount AxisBar / surface title per E2.3 |
| `src/records/record-owner.ts` | New hrefs, new label, `calibration` owner kind (D.3) |
| `src/records/record-reference.ts` | `calibration` in owner-kind union |
| `src/rsemble.tsx` | Remove `MobileWorkspaceNav` mount; bottom-padding rule removed; Compare-shortcut workspace derivation updated for `/calibrate` routes (shortcut stays Compare-only, §C.2c) |
| Attention/Records typing files | `calibration` source + record variants (G.3.5) |

### L.3 Deleted

`src/ui/WorkspaceNav.tsx`, `src/ui/MobileWorkspaceNav.tsx` (and their tests,
rewritten against AxisBar).

### L.4 Tests to update (known contracts that change)

- `src/ui/WorkspaceNav.test.tsx` — rewritten for AxisBar: two controls,
  canonical labels/order, `aria-current`, 44px targets, independence (E2.1),
  Finish-out-of-header assertion retained.
- `src/ui/Header.test.tsx` — header composition with AxisBar.
- `src/app-router.test.tsx` — route moves, redirects ("Research Lab",
  `/lab` link assertions), `/calibrate` routes.
- `src/rsemble-shell.test.tsx` — NotFound "Return to Compare" stays.
- Records owner/crosswalk tests — new labels and hrefs.

---

## M. Non-goals

- No execution-logic changes anywhere (pipeline, judge, fusion recipes,
  study stages, providers).
- No visual redesign of any surface — chrome, routes, labels only.
- No telemetry or analytics; validation is qualitative (§N).
- No collaboration/multi-user features.
- No rebuild of the Observatory, Records, Attention, or Search.
- No change to Compare, Benchmark, or Policy Study functionality — this spec
  repositions existing surfaces and adds exactly one new one.

---

## N. Success criteria and validation

### N.1 What we are fixing and how we will know

The defect is categorical navigation error (Lab/Evaluations confusion).
Validation is a **first-click protocol**, no telemetry:

- 5 users, think-aloud, before and after the change.
- Tasks: (1) "Test these four models across your saved task set."
  (2) "Find out whether fusing is worth it for this one prompt."
  (3) "See everything you know about this model."
- **Pass:** each user names/clicks the correct destination in ≤5 seconds on
  all three tasks; zero wrong-destination clicks on tasks (1) and (2).
  Failure of any participant on any task triggers a label review before
  ship, not after.

### N.2 Acceptance criteria (assertable)

1. AxisBar renders subject then scope, in that order, at identical geometry
   on `/compare`, `/calibrate`, `/benchmark`, `/strategies`, and
   `/strategies/recipes*`.
2. Operating either control preserves the other's state; every URL in §D.1
   sets both segments deterministically.
3. `ModeToggle` exists only on `/compare`; no route under `/strategies` or
   `/calibrate` renders a finish-mode control or binds ⌘/.
4. `/evaluations/**` and `/lab/**` redirect to their §D.2 targets with
   suffix and query preserved; no 404s from persisted legacy hrefs in
   Records.
5. Calibrate runs all four policies blocked: one fanout, one Judge-1 pass,
  `findBlindnessViolations` empty pre-send; blocked-evidence identity
   asserted in test (same test as `policy-runner.test.ts` test 7, wired
   through the calibration controller).
6. Calibrate result renders the snapshot label, the per-policy table, and
   "Test across a Task Set"; it renders no playbook, MPID, claim-level, or
   recommendation language.
7. "Test across a Task Set" produces a Policy Study draft carrying pool,
   policy set, recipe, and rubric references without mutating the
   calibration.
8. Calibrate executions hold the app-wide execution mutex: starting one
   while Compare/Benchmark/study execution is active fails with the
   existing conflict copy, and vice versa.
9. Strategies sub-nav (Studies · Recipes · Model Pools) renders on every
   Strategies surface including `/calibrate`.
10. AxisBar does not render on `/models/*`, `/records`, `/attention`,
    `/search`; surface titles render there instead.
11. Mobile: no bottom nav; sticky axis subheader on testing surfaces; all
    segments ≥44px; Records reachable at <768px via the header utility.
12. Keyboard: both segmented controls fully operable by keyboard;
    axis-switch announcements via the §K2 live region; no focus loss on
    navigation.
13. `npm run check`, `git diff --check`, typecheck, and the full test suite
    pass with the §L.4 contract updates — exact outputs recorded in the QA
    receipt.
