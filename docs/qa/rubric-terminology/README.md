# Rubric Terminology — Browser QA Evidence (Child 01, Task 8)

**Date:** 2026-08-12
**Branch:** `feat/task-first-evidence-workbench`
**HEAD:** `7335830` (+ formatter/lint recovery + authority docs)
**Spec:** `docs/specs/pending/task-first-evidence-workbench/01-rubric-terminology/rubric-terminology-spec.md` §10 Browser

## Flows verified

### Rubric list (`/evaluations/rubrics`)
- Heading and actions use Rubric language: "New rubric", "Show archived".
- Empty state copy: "No rubrics yet. Rubrics define how candidate work is assessed."
- Seeded rubric row appears with canonical `/evaluations/rubrics/:id` href.
- Secondary nav labels: "Rubrics — rubrics that score".

### Rubric create
- "New rubric" opens editor at canonical route `/evaluations/rubrics/:id`.
- Editor fields: Name ("Untitled rubric"), Description, Judge instruction.
- Criteria section: "Add graded" / "Add binary" buttons; weight display.
- Evidence metadata (optional facet mapping seam) present: criterion select, direct/supporting kind, facet ID input.
- Save creates rubric and navigates to canonical detail route.

### Rubric edit / version
- Editing description + adding criterion + filling required criterion descriptions → Save creates v2.
- Version selector shows "v1" and "v2 (latest)".
- Historical version (v1) is read-only: description field `readOnly`, no save action.
- Latest version (v2) is editable.
- Version switching via `<select>` updates the form.

### Rubric archive / restore
- Archive button archives the rubric; "This rubric is archived. Restore it to use in new suites." shown.
- Restore button restores the rubric; archive state cleared, Archive button returns.

### Legacy redirects
- `/evaluations/rubrics` → `/evaluations/rubrics` (canonical list, preserves search/state).
- `/evaluations/rubrics/:id?returnTo=/compare` → `/evaluations/rubrics/:id?returnTo=/compare` (canonical detail, preserves entity + search).
- `/evaluations/profiles/:id` → Not found (was never a real baseline route; no invented alias).
- `/rubrics/foo` → Not found (no invented `/rubrics/*` alias per spec §4).

## Viewport / zoom / keyboard / reduced-motion matrix

| Condition | Viewport | Overflow | Renders | Notes |
|---|---|---|---|---|
| Desktop | 1440×900 | None | ✅ | Rubric list + detail |
| Tablet | 1024×768 | None | ✅ | Rubric list |
| Tablet portrait | 768×1024 | None | ✅ | Rubric list |
| Mobile | 390×844 | None | ✅ | Rubric list + detail |
| 200% zoom | 1440×900 @2x DSF | None | ✅ | Rubric list |
| Keyboard-only | 1440×900 | — | ✅ | Tab navigation reaches Suites, Rubrics nav, New rubric, Show archived; focus-visible outline present on all |
| Reduced motion | 1440×900 | None | ✅ | `prefers-reduced-motion: reduce` active; UI renders correctly |

## Per-element overflow and credential-shaped text probe

- **Overflow:** No horizontal overflow at any tested viewport (scrollWidth ≤ clientWidth).
- **Credential-shaped text:** No `sk-*`, `AIza*`, or `Bearer *` patterns found in page text at any viewport.

## Screenshots

- `qa-desktop-1440.webp` — desktop 1440×900
- `qa-tablet-1024.png` — tablet 1024×768
- `qa-mobile-390.png` — mobile 390×844
- `qa-zoom-200.webp` — 200% zoom (1440×900 @2x DSF)

## Gates

| Gate | Command | Result |
|---|---|---|
| Targeted vitest | `npx vitest run src/lib/evaluations src/lib/persistence src/workspaces/evaluations src/ui` | 93 files, 1446 tests passed |
| Typecheck web | `npm run typecheck:web` | Exit 0 |
| Full check | `npm run check` | Exit 0 (format, lint, typecheck, test, build all green) |
| Terminology guard | `npx vitest run src/lib/evaluations/rubric-terminology.test.ts` | 1 test passed (zero violations) |
