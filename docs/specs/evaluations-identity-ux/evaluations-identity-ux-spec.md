# Evaluations Identity and UX Upgrade Specification

**Status:** Proposed
**Date:** 2026-08-03
**Scope:** Information architecture, semantic identity, relationship surfacing, and restrained motion for the Evaluations workspace (Suites and Profiles)
**Authority:** `PRODUCT.md`, `DESIGN.md`, `UI.md`, `docs/specs/design-motion-refinement/design-motion-refinement-spec.md`, and this specification, in that order for product scope; this document governs the upgrade itself
**Method:** Grounded in emil-design-eng, pick-ui-library, animation-vocabulary, improve-animations, and find-animation-opportunities; applied through the design-system-refinement-planning workflow

---

## 1. Summary

RSemble's Evaluations workspace works correctly and looks consistent. It does not read. Suites and Profiles are different kinds of things, a runnable workload and a scoring rubric, but the UI presents them with the same row anatomy, the same status vocabulary, and no visible connection between them. A user opening each page sees similar furniture arranged slightly differently, which is exactly the confusion that motivated this work.

This upgrade makes the two entity kinds unmistakable and makes their relationship explicit. It does not redesign the shell, add navigation, or change routes. It also deliberately restrains motion: the existing motion discipline is already strong, and the audit conclusion is that the highest-leverage improvement here is identity, not animation.

The intended result: within two seconds of looking at any Evaluations surface, the user knows what kind of thing they are looking at, what state it is in, and how it connects to the rest of their evaluation work.

## 2. Problem statement (grounded in current code)

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | Suite and Profile lists render the identical `RecordRow` anatomy: status mark, mono title, provenance version, timestamp, duplicate and archive actions | `src/workspaces/evaluations/SuiteList.tsx:417-498`, `src/workspaces/evaluations/ProfileList.tsx:284-334` |
| 2 | Status tokens are reused with misleading semantics: every non-archived profile renders as `completed` (emerald check) and every suite renders as `draft` (muted FilePenLine), regardless of actual state | `ProfileList.tsx:298`, `SuiteList.tsx:426` |
| 3 | The suite-to-profile relationship is half-built and invisible where it matters most. ProfileDetail already lists suites pinned to the selected version via an inline, untested `suiteReferencesProfile` predicate (`ProfileDetail.tsx:50-65,459-486`), but no suite surface names its pinned evaluation profile, and the predicate is not reusable or unit-tested | `src/lib/evaluations/evaluation-types.ts:68-74,116-129`, `src/workspaces/evaluations/ProfileDetail.tsx:50-65` |
| 4 | The segmented nav (Suites / Profiles) carries no explanation of what either entity is, and the two list pages' empty states teach independently with no cross-reference | `src/workspaces/EvaluationsWorkspace.tsx:25-58` |
| 5 | Suite rows do not surface whether a suite has ever been run or what its latest experiment outcome was, even though `listExperiments(suiteId)` exists | `src/lib/persistence/evaluation-repository.ts:51`, `SuiteExperimentHistory.tsx:48` |

## 3. Goals

1. Distinct entity identity. A suite reads as "an experiment you run" and a profile reads as "a rubric that scores", at the list level, the detail level, and inside any surface that references them.
2. Correct status vocabulary. Stop borrowing run-lifecycle tokens (`completed`, `draft`) for states they do not describe. Add tokens for "reusable rubric" and "ready-to-run workload".
3. Visible relationships. A suite shows its pinned evaluation profile. A profile shows which suites pin it (and which version).
4. Information that earns its rows. Suite rows carry latest-experiment state. Profile rows carry a criteria preview.
5. Empty states that teach the distinction and cross-link, so first-run users never meet Suites and Profiles as interchangeable lists.
6. Preserve and extend the existing motion discipline. Use the established tokens; add continuity where state swaps are jarring; animate nothing that is keyboard-first or high-frequency.

## 4. Non-goals (scope fence)

- No new top-level workspace, no route changes, no restructure of the `/evaluations` segmented nav beyond labels and sublabels.
- No adoption of the task-first taxonomy from `docs/research/task-first-evaluation-taxonomy.md`. That remains research; this spec does not change storage schemas.
- No persistence migration. Backlinks are derived by scanning existing records.
- No new animation runtime, gesture system, or general motion library. No entrance stagger on list rows. No layout animation on filter or sort.
- No changes to Compare or Runs except where shared primitives (`RecordRow`, `StatusMark`) gain optional, backward-compatible slots.
- No fusion-study, experiment-engine, judge, or provider changes.
- Nothing in UI.md §7's scope fence is reopened: no routing profiles, no task-preset library, no strategy variants.

## 5. Design direction

### 5.1 Entity grammar

Every surface adopts one consistent grammar:

| Concept | Kind word | Glyph | One-line definition shown on first contact |
| --- | --- | --- | --- |
| Suite | **Workload** | `ListChecks` | "A versioned set of tasks, models, and a judge. You run it." |
| Profile | **Rubric** | `Scale` | "Scoring criteria with 1/3/5 anchors. It judges, it does not run." |

The kind word appears as an 11px uppercase-tracked eyebrow (`text-xs`, mono-capable) wherever the entity appears as a record: list rows, detail headers, reference chips, backlinks. The glyph is never the only cue; the word always accompanies it (DESIGN.md: never encode meaning in color or shape alone).

Glyphs are `lucide-react` icons already in the dependency set. No new dependency.

### 5.2 Status vocabulary corrections

Extend `StatusMark` with two tokens; keep all existing ones:

| New status | Color | Non-color cue | Meaning |
| --- | --- | --- | --- |
| `ready` | cyan | `CirclePlay` | A runnable workload (non-archived suite) |
| `reusable` | neutral zinc | `BadgeCheck` | A live, pinnable rubric (non-archived profile) |

Mapping changes:

| Before | After | Why |
| --- | --- | --- |
| Suite row: `draft` for every suite | `ready` (non-archived), `aborted` retained for archived | `draft` implies unfinished; suites are runnable artifacts. `ready` matches "you run it" |
| Profile row: `completed` for every profile | `reusable` (non-archived), `aborted` retained for archived | A rubric is never "completed" like a run; emerald check implies a finished result, which misleads |

`DESIGN.md`'s status-token table gains these two rows in the same pass. All other status usage is untouched.

### 5.3 Relationship surfacing

Two derived, read-only joins. No new storage:

1. **Suite → profile.** On suite list rows and the suite editor header: when `defaultEvaluation.kind === "profile"`, render a compact chip `Scale <name> vN` linking to `/evaluations/profiles/:id`. When holistic, render a muted text chip `Holistic judging`. Task-level overrides keep their existing treatment inside the task editor; the chip reflects the suite default only.
2. **Profile → suites (backlinks).** On `ProfileDetail`, a section "Used by" listing every non-archived suite whose `defaultEvaluation` pins this profile id at any version, plus suites with at least one task-level pin. Each entry links to the suite editor and shows which version(s) are pinned. Empty state: "No suite pins this rubric yet." plus a link to the suite list. The derivation is a pure function over `listSuites(true)` results, exported from a new `profile-usage.ts` module and unit-tested.

Both directions reuse one shared `ProfileRefChip` component so suite rows, suite settings, and backlinks never diverge.

### 5.4 Row content upgrades

| Surface | Before | After |
| --- | --- | --- |
| Suite row summary | `N tasks` | `N tasks · M models · <evaluation chip>`; plus latest-experiment `StatusMark` + relative time when experiments exist |
| Profile row summary | `N criteria` | `N criteria · <first criterion name> +k more` (preview of what the rubric actually measures) |
| Segmented nav labels | `Suites` / `Profiles` | Labels keep the entity names (navigation stability) and gain an 11px sublabel under the active item only: `workloads you run` / `rubrics that score` |

Row anatomy stays one `RecordRow` family. The list variant gains one optional slot, `kind?: ReactNode`, rendered before the status mark. No existing caller is required to change; the in-flight two-line `RecordRow` restructure in the worktree takes precedence and this spec adapts to whichever layout lands.

### 5.5 Empty states that teach the split

- Suite list empty state: keep the existing description, add one line naming the counterpart: "Judging rules live in Profiles; suites pin them." with a link.
- Profile list empty state: keep the existing description, add: "Suites pin profiles to score their tasks." with a link.
- Both keep their single primary action and never grow into illustrated heroes (DESIGN.md).

### 5.6 Motion decisions (improve-animations + find-animation-opportunities gates applied)

Audit result first: a full sweep of `src/` found no `transition: all`, no UI `ease-in`, no `scale(0)` entrances; the motion-contract test already enforces this. The existing tokens in `src/index.css` (`--motion-fast/short/medium`, `--ease-out-ui`, `.pressable`, `.motion-state`, linear `animate-spin-ease`) are the only motion vocabulary this work may use.

Surviving opportunities, each gated on frequency, purpose, speed, function:

| # | Location | Today | Purpose | Frequency | Decision |
| --- | --- | --- | --- | --- | --- |
| 1 | Segmented nav active item | Instant color swap | State indication, orientation | Tens per day at most | Keep instant. Add `.motion-state` color transition (150ms) only. No moving indicator, no layout animation |
| 2 | Profile "Used by" disclosure | New surface | Preventing a jarring change | Occasional | Native `<details>` plus `.motion-state` opacity on open; no height animation (stable geometry) |
| 3 | Archive confirm swap in rows | Width-shifts today (arm → confirm pair) | Stable geometry | Occasional | Reserve fixed width for the action cluster while armed, per the geometry-state contract already in `src/ui/geometry-state-contract.test.ts` |
| 4 | Row hover | Color only | Feedback | High frequency | Keep color-only. No transform, no lift, ever, on record rows |

Explicitly rejected candidates:

- Row entrance stagger on list load. Rejected: list rendering is high-frequency (every navigation, every reload) and rows are data the user reads.
- Animated indicator sliding between segmented items. Rejected: tens-per-day navigation; color state is sufficient and cheaper.
- FLIP reorder on filter toggle. Rejected: DESIGN.md forbids animating filtering and sorting positions.
- Kind-glyph morph between suite and profile. Rejected: decorative, no purpose.

### 5.7 Library decisions

- No new dependencies. `lucide-react`, `@base-ui/react`, and `cmdk` are already installed and cover every primitive this spec needs (icons, disclosures, dialogs).
- `pick-ui-library` consulted: no task in this spec maps to a missing library. No command menu, chart, virtualization, or gesture requirement is introduced.

## 6. Accessibility and performance requirements

1. Kind eyebrows and status tokens always pair glyph with text. Grayscale-safe.
2. Backlink lists and reference chips are real links, keyboard-reachable, with focus-visible rings (the global `:focus-visible` in `src/index.css` covers them).
3. Touch targets for all new controls remain at least 44x44px.
4. No new animation may run during streaming, judging, or experiment execution. Row geometry stays stable while data refreshes.
5. `prefers-reduced-motion`: every added transition is color/opacity only and remains meaningful when motion is disabled. The existing reduced-motion guard in `src/index.css` is extended if any new keyframe is introduced (none are planned).
6. Backlink derivation must not block rendering: load suites once per profile detail mount, derive synchronously, show "checking references" text until resolved.

## 7. Acceptance criteria

Automated:

1. New status tokens render with the correct icon and label in `StatusMark.test.tsx`.
2. `profile-usage.ts` unit tests cover: default-pin match, task-level pin match, version enumeration, archived-suite exclusion, holistic suites excluded.
3. SuiteList renders the evaluation chip and latest-experiment mark for seeded fixtures; ProfileList renders the criteria preview. Existing list tests updated, not deleted.
4. Motion contract test extended: record-row list surfaces contain no hover transform; the new tokens introduce no `ease-in`, `transition: all`, or `scale(0)`.
5. Full gate: `npm run check` (typecheck plus tests), production build, and the existing CDP suite-reliability QA pass.

Browser (existing harness matrix):

6. At 1440x1000, 1024x768, 768x1024, and 390x844: kind eyebrows, chips, and backlinks remain legible; no horizontal overflow; segmented sublabels do not wrap awkwardly.
7. Reduced-motion and 200% zoom checks pass with no lost controls.

## 8. Resolved decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Keep entity names "Suites" and "Profiles" in navigation; add kind words as eyebrows and sublabels | Renaming would break muscle memory and existing docs; the confusion is semantic, not nominal |
| 2 | Derive backlinks by scan instead of a persisted index | Personal single-user scale; avoids a storage migration and keeps the taxonomy research out of scope |
| 3 | Two new status tokens rather than repurposing existing ones | Repurposing `completed` or `draft` would silently change Runs semantics; additive tokens are safe |
| 4 | No motion library, no entrance animations | The motion audit found the current discipline correct; the leverage is identity, not animation |
| 5 | Spec adapts to the in-flight `RecordRow` two-line restructure rather than racing it | Worktree contains uncommitted `RecordRow.tsx`/`Header.tsx`/`rsemble.tsx` changes; implementation starts from a branch taken after those land |

## 9. Coordination with in-flight work

The worktree currently holds uncommitted changes in `src/rsemble.tsx`, `src/ui/Header.tsx` (readiness "checking" state), and `src/ui/RecordRow.tsx` (two-line row layout), plus untracked research docs. None of it is touched by this planning pass. Implementation begins only after those changes are committed or explicitly stashed, and the implementation plan branches from that commit. Untracked research files remain untracked.
