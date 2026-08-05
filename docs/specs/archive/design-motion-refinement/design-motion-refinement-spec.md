# RSemble Design and Motion Refinement Specification

**Status:** Proposed  
**Date:** 2026-08-02  
**Scope:** Visual-system reconciliation, interaction feedback, purposeful motion, and accessible UI primitives across Compare, Runs, and Evaluations  
**Authority:** `PRODUCT.md`, `DESIGN.md`, `UI.md`, and this specification, in that order for product scope and in this document for the refinement itself

---

## 1. Summary

RSemble already has a coherent product model, strong information architecture, compact shared components, and broad responsive/accessibility coverage. This refinement does not redesign the application or add another workspace. It makes the existing workbench feel more precise, responsive, and internally consistent.

The intended result is a **calm technical instrument**:

- immediate feedback without ornamental motion
- one visual language for surfaces, radii, borders, and status
- continuity where state changes would otherwise feel abrupt
- no animation on keyboard-first or high-frequency navigation
- accessible dialogs and command-menu behavior provided by mature primitives
- no dependence on a general animation library for predetermined UI motion

The work deliberately preserves RSemble's industrial, data-dense character. It does not turn the app into a glossy SaaS dashboard.

---

## 2. Goals

1. Reconcile implemented colors, radii, shadows, and motion values with `DESIGN.md`.
2. Replace hand-rolled command-menu and dialog mechanics with the curated libraries appropriate to those tasks.
3. Remove motion that slows high-frequency or keyboard-initiated actions.
4. Add press feedback and state continuity where they improve perceived responsiveness or explain change.
5. Make pipeline execution feel live through meaningful status transitions rather than ambient decoration.
6. Preserve stable geometry during streaming, scoring, filtering, and navigation.
7. Honor reduced-motion, touch, keyboard, zoom, and assistive-technology requirements.
8. Add deterministic tests and browser QA for the refined interaction contract.

## 3. Non-goals

- No new top-level workspace, dashboard, semantic search, or analytics surface.
- No changes to ranking, judging, fusion, evaluation, persistence, or provider behavior.
- No decorative gradients, glassmorphism, parallax, scroll reveals, idle floating, confetti, or full-page transitions.
- No animated sorting or filtering of Runs, result matrices, experiment history, or candidate rankings.
- No animation on command-palette open/close, command selection, keyboard workspace navigation, or Rank/Fuse keyboard shortcuts.
- No gesture physics, drag-to-dismiss, or spring library unless a later feature introduces a genuinely gesture-driven surface.
- No wholesale component-library migration.
- No visual change that reduces information density, 44px interaction targets, focus visibility, or text contrast.

---

## 4. Current-state findings

The audit reviewed `package.json`, `tailwind.config.js`, `src/index.css`, shared UI components, Compare, Runs, Evaluations, and existing QA evidence.

| Before | After | Why |
| --- | --- | --- |
| Implemented navy canvas/surfaces and 6/10/14px radii diverge from `DESIGN.md` charcoal surfaces and 4/6/8px radii | Reconcile Tailwind tokens to the documented industrial system, then update snapshots/screenshots | The code and source of truth currently describe different products; invisible inconsistency compounds across every surface |
| Keyboard-first command palette uses a `scale(0.98) + fade` entrance | Command palette appears and disappears instantly | Keyboard actions may occur hundreds of times per day; entrance motion makes them feel slower and violates the frequency rule |
| Infinite spinner uses `ease-out` | Spinner uses `linear` rotation at a stable cadence | Constant motion must be linear; easing every rotation visibly accelerates and stalls |
| Running state combines pulsing dots, marching connectors, a moving header gradient, and spinners | One status vocabulary: stable status mark, linear spinner only for indeterminate work, marching connector only where it explains active data flow | Layered ambient motion competes for attention and makes the instrument feel noisy rather than alive |
| Hover lift on primary run controls is not gated by pointer capability | Hover-only transforms live inside `@media (hover: hover) and (pointer: fine)`; press feedback remains available everywhere | Touch devices can retain false hover states; press feedback is the universal response mechanism |
| Most pressable controls change color only | Shared press treatment uses `scale(0.97)` for buttons that visually behave like physical controls | Response begins on pointer-down and confirms that the interface heard the user |
| Hand-rolled command-menu filtering, active-item navigation, and listbox semantics | `cmdk` owns command search, grouping, active option, and keyboard traversal | `cmdk` is the curated tool for command menus and removes bespoke behavior from a high-frequency surface |
| Hand-rolled dialog focus trapping and restoration in multiple components | Base UI Dialog owns modal semantics, focus trap, Escape, dismissal, and origin-independent modal structure | Base UI is the curated accessible primitive for dialogs; behavior should not be reimplemented per modal |
| Generic blanket reduced-motion rule forces all animation to `0.01ms` | Component-level reduced-motion equivalents keep useful opacity/color feedback and remove movement/looping | Reduced motion means gentler feedback, not globally broken timing or hidden state changes |
| Accordion panels snap open while only the chevron animates | Keep content geometry instant; retain a 150ms ease-out chevron rotation and optional short opacity reveal only for pointer-triggered expansion | Animating height causes layout work; a small directional cue explains state without slowing repeated editing |
| Reset control changes width when armed | Reserve the confirmation label's width or swap content within fixed geometry | State changes should preserve spatial consistency and avoid shifting neighboring controls |
| Pipeline stages primarily signal change through border color and several loop animations | Use a continuity transition for stage state: status glyph crossfade, border/color transition, stable card geometry, and a single active-flow cue | The pipeline is the strongest opportunity for purposeful motion because motion explains execution progress |

---

## 5. Design direction

### 5.1 Product character

RSemble should feel:

- **precise** rather than playful
- **responsive** rather than animated
- **dense** rather than cramped
- **technical** rather than cyberpunk
- **quiet while idle, legible while working**

The emotional target is confidence. Delight comes from immediate response, stable geometry, legible provenance, and clean state transitions, not spectacle.

### 5.2 Surface hierarchy

Use three surface levels only:

1. **Canvas** for the application background.
2. **Panel** for primary working/audit regions.
3. **Raised** for modal and floating surfaces.

Cards inside panels use a subtle border and minimal luminance delta. Do not stack translucent materials. Modal surfaces remain opaque or nearly opaque because RSemble is data-dense and text legibility is more important than atmospheric depth.

### 5.3 Token reconciliation

The implementation must match `DESIGN.md` unless this spec explicitly changes it.

- Canvas: `#0a0a0a`
- Panel: `#121212`
- Hover/selected neutral: `#1a1a1a`
- Border: `#262626`
- Main text: `#ededed`
- Muted text: `#a1a1a1`
- Accent: `#00e5ff`, reserved for selection, active flow, and primary action
- Success: `#00ff9d`
- Warning: `#ffb300`
- Error: `#ff4d4d`
- Radius small/medium/large: `4px / 6px / 8px`

No purple/blue surface gradients. The Run control uses a solid accent fill, not a teal gradient. Shadows are restrained and reserved for raised surfaces.

### 5.4 Typography

- Keep Geist / Geist Mono with system fallbacks.
- Use `font-optical-sizing: auto` where supported.
- Body text remains at least 13px/14px.
- Metadata-only 11px text keeps positive tracking.
- Headings use slightly negative tracking and tight leading.
- Data and timers use tabular numbers.
- Do not animate text character-by-character, scores, elapsed time, or token counters.

---

## 6. Motion system

### 6.1 Motion decision rule

Every animation must satisfy all of these:

1. It explains spatial relationship, state, progress, or direct feedback.
2. Its frequency justifies its duration.
3. It remains interruptible where rapid retriggering is possible.
4. It animates only compositor-friendly properties unless no alternative exists.
5. It has a reduced-motion equivalent.

If any answer is no, delete the animation.

### 6.2 Motion vocabulary used in RSemble

- **Press / Tap feedback** for physical response on pointer-down.
- **Crossfade** for replacing status glyphs or compact content in fixed geometry.
- **Continuity transition** for pipeline stages and Rank/Fuse output identity.
- **Origin-aware animation** only for trigger-anchored popovers added in the future.
- **Accordion / Collapse** as a state name, but panel geometry remains instant in this scope.
- **Skeleton / Shimmer** for initial layout placeholders only; no shimmer after content exists.
- **Linear** for spinners and active-flow loops.
- **Ease-out** for short entrances or exits that are not keyboard-initiated.
- **Reduced motion** as a first-class variant, not an afterthought.

Not used in this scope: bounce, pop-in, staggered page entrances, scroll reveal, parallax, marquee, typewriter, text morph, number ticker, layout animation, shared-element page transitions.

### 6.3 Tokens

```css
:root {
  --motion-fast: 100ms;
  --motion-short: 150ms;
  --motion-medium: 200ms;
  --ease-out-ui: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out-ui: cubic-bezier(0.77, 0, 0.175, 1);
}
```

Budgets:

- press feedback: 100ms
- hover/color/border feedback: 100–150ms
- chevrons and compact state changes: 150ms
- pointer-opened modal overlay/surface: 150–200ms
- UI movement: never over 250ms in this scope
- keyboard-opened command palette: 0ms
- spinner and connector loops: linear

### 6.4 Shared press behavior

Apply to enabled controls that visually read as buttons:

```css
.pressable {
  transition:
    transform var(--motion-fast) var(--ease-out-ui),
    background-color var(--motion-short) var(--ease-out-ui),
    border-color var(--motion-short) var(--ease-out-ui),
    color var(--motion-short) var(--ease-out-ui);
}

.pressable:active:not(:disabled) {
  transform: scale(0.97);
}
```

Do not apply scale feedback to:

- text links
- table rows
- draggable dividers
- keyboard-selected command items
- large panels
- controls whose geometry would collide when scaled

### 6.5 Looping motion budget

At most one looping cue should dominate a region.

- A spinner indicates indeterminate work.
- A marching connector indicates data moving between pipeline stages.
- A pulse is used only when neither of the above exists and the user benefits from a heartbeat cue.
- The header moving gradient is removed.
- Off-route execution uses a static status glyph plus elapsed time; it does not duplicate the full pipeline's motion.

### 6.6 Reduced motion

Under `prefers-reduced-motion: reduce`:

- remove transforms, marching connectors, pulses, and movement
- retain immediate state replacement and short opacity/color transitions up to 150ms
- keep spinner state legible through icon plus visible text; a non-rotating loader glyph is acceptable
- never hide progress solely because motion is disabled

Hover transforms must be gated:

```css
@media (hover: hover) and (pointer: fine) {
  .hover-lift:hover {
    transform: translateY(-1px);
  }
}
```

---

## 7. Library decisions

### 7.1 Command menu

Use **`cmdk`** for `CommandPalette`.

It owns:

- query filtering
- grouped results
- keyboard traversal
- active item state
- selection
- empty state

RSemble continues to own command definitions, routing, disabled rules, labels, shortcuts, and visual styling.

The palette opens and closes instantly because it is keyboard-first. No `cmd-pop` animation is applied.

### 7.2 Dialogs

Use **Base UI Dialog** from `@base-ui/react/dialog` for:

- Provider Connections
- Shortcut Cheatsheet
- mobile command pane where it behaves as a modal sheet

The command palette uses `Command.Dialog` from `cmdk` because its menu and modal semantics are integrated; do not wrap it in a second dialog primitive. Base UI owns focus trap, Escape, dismissal, focus restoration, and modal semantics for the other named surfaces. RSemble owns visuals and application state.

Dialogs opened by a pointer may use a 150–200ms opacity plus `scale(0.97 → 1)` surface transition. Modals retain centered transform origin. Keyboard-opened command palette remains instant.

### 7.3 Animation library

Do **not** add Motion/Framer Motion in this scope.

CSS transitions and keyframes are sufficient for all approved predetermined motion. Adding a general animation runtime would increase bundle and conceptual overhead without a gesture-driven requirement.

### 7.4 Other libraries

Do not add Sonner, NumberFlow, Recharts, Virtuoso, dnd-kit, or Zustand for this refinement. Existing tasks do not require them.

---

## 8. Interaction specifications by surface

### 8.1 Global shell and header

- Remove the moving running-gradient strip.
- Keep one compact running status with icon/text and elapsed time.
- Connection state changes update color/text without scale or positional motion.
- Workspace navigation remains instant under keyboard or pointer input.
- Header geometry must not shift as labels change.
- At tablet and 200% zoom, preserve the existing sacrifice order and no-overflow contract.

### 8.2 Compare command pane

- Run button becomes a solid accent control.
- Pointer hover may lift 1px on fine pointers only.
- Pointer-down uses `scale(0.98)` for the large Run control; release snaps within 100ms.
- Stop/Abort replacement occurs in fixed geometry with icon/label crossfade only when reduced motion permits.
- Disabled state never moves and does not show press feedback.
- Reset arming keeps a fixed control footprint; the label does not push adjacent content.
- Model selection retains the existing 100–150ms checkbox transform/color feedback.
- Evaluation disclosure keeps instant panel geometry and 150ms chevron rotation.

### 8.3 Pipeline and streaming output

- Stage cards keep fixed dimensions.
- On status change, glyphs crossfade within a fixed icon box and border/text colors transition over 150ms.
- Only the connector feeding the active stage marches, linearly.
- The active stage may retain one indeterminate spinner; do not also pulse the card.
- Candidate streaming text never animates per token.
- Existing `requestAnimationFrame` stream batching remains unchanged.
- Skeletons appear only before the first content; once streaming begins, stable text replaces them without recurring shimmer.

### 8.4 Rank and Fuse

- Rank/Fuse toggle selection uses color/background transition only. Keyboard switching has no positional motion.
- Switching to existing Rank/Fuse output preserves the pane and replaces content instantly or with a 100ms opacity crossfade when pointer-triggered.
- It must never delay rendering, start API work later, or obscure whether Fusion is still running.
- Scores, ranks, and result rows do not animate into sorted positions.
- Winner emphasis remains a stable ring/marker, not a celebratory entrance.

### 8.5 Runs

- Search and filters update rows without layout animation.
- Existing rows remain still while the query is debounced.
- Loading from an empty state uses a linear spinner plus text.
- Refreshes with existing data retain rows and use a compact inline busy status; no full-list skeleton replacement.
- Record rows use color/border feedback only; no scale because rows are data navigation surfaces.
- Selection/deep-link focus is immediate and visibly outlined.

### 8.6 Evaluations

- Suite/profile local route controls use color/background transitions only.
- Editor accordions use directional chevrons and instant geometry.
- Task reordering stays instant; no drag or FLIP animation.
- Experiment progress uses pipeline continuity rules.
- Result matrices never animate cells, heatmaps, scores, or winner discovery.
- Completion and error states appear in stable geometry with status icon/text crossfade where possible.

### 8.7 Dialogs and sheets

- Dialog overlay dims the background without moving it.
- Centered modals use centered transform origin.
- Mobile command pane enters from its physical edge only when pointer-opened and reduced motion is not requested; close exits along the same path.
- All dialog transitions are interruptible and never lock input.
- Focus is valid before the first visible frame.
- Escape, outside-pointer dismissal, focus restoration, and nested interactive content are delegated to Base UI.

---

## 9. Accessibility requirements

1. `prefers-reduced-motion` behavior is covered by automated tests and browser QA.
2. All status changes include visible text and non-color cues.
3. Motion never communicates unique information.
4. Command menu follows combobox/listbox semantics supplied by `cmdk`.
5. Dialogs follow Base UI modal semantics and restore focus to their trigger.
6. Focus rings remain visible over all reconciled surfaces.
7. Controls remain at least 44×44px at touch breakpoints.
8. Hover-only effects are gated to fine pointers.
9. No horizontal overflow at 390px or 768px portrait, including dialogs.
10. At 200% zoom, controls may reflow but cannot disappear.
11. Animated content must not flash or pulse rapidly.

---

## 10. Performance requirements

- Animate only `transform`, `opacity`, `color`, `background-color`, `border-color`, and `box-shadow`.
- Do not animate width, height, margin, padding, top, left, or grid tracks.
- Do not add per-frame React state updates for visual effects.
- Do not drive child transforms through an inherited CSS variable updated every frame.
- Keep runtime animation logic out of streaming and experiment-controller paths.
- Added libraries must be measured in the production bundle and justified in the final report.
- No regression to stream batching, synchronized scroll, or list query behavior.

---

## 11. Testing and acceptance criteria

### 11.1 Automated

- Existing unit and integration tests pass.
- Command palette tests cover query, grouping, ArrowUp/Down, Enter, Escape, disabled commands, focus restoration, and **absence of entrance animation**.
- Dialog tests cover focus entry, Tab containment, Escape, outside dismissal, focus restoration, and reduced motion.
- Motion contract tests assert:
  - no `transition-all`
  - no UI `ease-in`
  - no `scale(0)` entrances
  - no ungated hover transforms
  - spinners use linear timing
  - command palette has no animation class
  - movement has reduced-motion handling
- Token tests or assertions verify documented colors/radii match Tailwind configuration.
- Pipeline tests verify only the active connector receives the loop class.

### 11.2 Browser QA

Verify at:

- 1440×1000
- 1024×768
- 768×1024 portrait
- 390×844
- 200% zoom
- `prefers-reduced-motion: reduce`
- fine pointer and emulated touch pointer

Exercise:

- keyboard-open command palette repeatedly
- pointer-open/close Connections repeatedly and interrupt closing by reopening
- mobile command pane open/close
- Run → fanout → Judge → Rank → Fuse
- failed candidate and failed Judge recovery
- Runs search/filter/deep-link focus
- Evaluation editor accordions
- experiment progress to terminal results

Capture screenshots and, for motion, short recordings or DevTools animation traces for normal and reduced-motion modes.

### 11.3 Acceptance

The refinement passes when:

1. The visual tokens in code and `DESIGN.md` agree.
2. The command palette is instant and fully keyboard-operable.
3. Dialog behavior is delegated to Base UI and passes the four-part focus contract.
4. No frequent action feels delayed by motion.
5. The pipeline communicates progress with at most one dominant looping cue per region.
6. All movement has a reduced-motion equivalent.
7. No viewport or zoom target gains horizontal overflow.
8. `npm run check` and `git diff --check` pass.
9. Browser QA evidence is recorded under `docs/qa/design-motion-refinement/`.

---

## 12. Rollout and risk control

Implement in small vertical slices:

1. lock the design/motion contract with tests
2. reconcile tokens and shared press primitives
3. migrate command palette to `cmdk`
4. migrate dialogs/sheet to Base UI
5. simplify global running motion
6. refine pipeline/status continuity
7. apply targeted interaction polish
8. complete responsive, reduced-motion, and bundle QA

Do not combine product-logic changes with visual refinement commits. If a migration reveals a behavior bug, add a failing behavior test first and keep the fix separate from styling.

---

## 13. Open decisions resolved by this spec

- **General motion library?** No.
- **Command menu library?** `cmdk`.
- **Dialog primitive?** Base UI Dialog.
- **Animate command palette?** No.
- **Animate list sorting/filtering?** No.
- **Use springs?** No current gesture-driven requirement.
- **Keep header running gradient?** No.
- **Keep pipeline connector motion?** Yes, only for the connector feeding the active stage and only without reduced motion.
- **Use press feedback?** Yes on physical buttons, not links/rows/dividers.
- **Restyle the whole product?** No. Reconcile implementation to the already-approved industrial design system.
