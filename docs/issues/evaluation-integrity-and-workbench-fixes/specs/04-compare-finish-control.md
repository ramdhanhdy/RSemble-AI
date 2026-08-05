# Fix spec 04: move Rank/Fuse into Compare

## Outcome

The global header has route-invariant geometry. Rank/Fuse remains the sole
per-task finish switch but is rendered inside the Compare workspace, where it
is relevant.

## Required behavior

1. Remove `showToggle`, header children used for `ModeToggle`, and Compare route
   branching from `Header.tsx`.
2. Make the desktop header a stable three-zone grid (identity, centered primary
   navigation, global actions) so the center navigation has the same coordinate
   on Compare, Runs, and Evaluations.
3. Add a compact Compare-only toolbar immediately above the Compare split pane.
   Render a labeled `Finish` group and the existing accessible `ModeToggle` in
   that toolbar. Reuse the component and its radiogroup keyboard behavior.
4. Preserve existing mode semantics, shortcut behavior, disabled-during-run
   behavior, and Rank-to-Fuse paid-call behavior.
5. On mobile, keep the control within the Compare working surface; it must not
   collide with the fixed workspace navigation or require opening global chrome.
6. Supersede the old header-placement statements in `PRODUCT.md`, `UI.md`, and
   `DESIGN.md`. Append a new decision to `DECISIONS.md`; do not rewrite old
   decisions as if they never existed.

## Acceptance criteria

- Bounding-box QA shows Compare/Runs/Evaluations nav links at the same x
  coordinates on all desktop routes.
- The global header contains no Rank/Fuse control.
- Compare contains exactly one `Finish mode` radiogroup; other workspaces
  contain none.
- Keyboard and screen-reader semantics of `ModeToggle` are unchanged.
- 390px, 768px, 1024px, and 1440px layouts do not clip or overlap.

## Tests

Update `rsemble-shell.test.tsx`, `WorkspaceNav.test.tsx`, and relevant design QA
scripts/screenshots. Add a route-invariant structure assertion rather than only
checking toggle presence.

