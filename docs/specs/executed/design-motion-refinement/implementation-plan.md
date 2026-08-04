# RSemble Design and Motion Refinement Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make RSemble feel like a coherent, responsive technical instrument by reconciling visual tokens, simplifying motion, adopting mature command/dialog primitives, and verifying the result across keyboard, touch, reduced motion, zoom, and responsive layouts.

**Architecture:** Preserve the existing React/Vite/Tailwind component tree and all product logic. Add small shared CSS motion primitives, migrate the command menu to `cmdk`, migrate modal behavior to Base UI Dialog, then apply targeted changes to the header, primary actions, pipeline, and fixed-geometry state transitions. Predetermined motion remains CSS-only; no general animation runtime is added.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS 3, Vitest, happy-dom, `cmdk`, `@base-ui/react`, Chrome DevTools Protocol QA

**Authority:** `docs/specs/executed/design-motion-refinement/design-motion-refinement-spec.md`, `DESIGN.md`, `UI.md`, `PRODUCT.md`

**Worktree guard:** At plan-writing time, the worktree already contained untracked `docs/research/task-first-evaluation-taxonomy.md` and `.docx`. Do not stage, modify, delete, or include those files in any refinement commit.

---

## Milestone map

| Milestone | Outcome | Tasks |
| --- | --- | --- |
| A. Contract | Design/motion rules become testable | 1–2 |
| B. Primitives | Tokens, press feedback, command menu, and dialogs are coherent | 3–6 |
| C. Product polish | Header, actions, pipeline, and stable state transitions use the new system | 7–10 |
| D. Verification | Responsive, reduced-motion, accessibility, bundle, and visual evidence pass | 11–12 |

## Out of scope

- Product logic or data-model changes
- New workspace/navigation destination
- Animated list sorting/filtering or score counting
- Motion/Framer Motion
- Gesture physics, drag-to-dismiss, parallax, view transitions, or celebratory motion
- Sonner, NumberFlow, Recharts, Virtuoso, dnd-kit, or Zustand
- Production deployment or external publication

---

### Task 1: Add a static motion-contract test

**Objective:** Turn the most important design-engineering rules into a failing test before changing styles.

**Files:**
- Create: `src/ui/motion-contract.test.ts`
- Read: `src/index.css`
- Read: `src/**/*.tsx`

**Step 1: Write the failing test**

Create a source-level test that scans production UI files and reports exact offenders:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const productionUi = filesUnder(SRC).filter(
  (path) => /\.(css|tsx)$/.test(path) && !path.endsWith(".test.tsx"),
);

function offenders(pattern: RegExp): string[] {
  return productionUi.flatMap((path) =>
    readFileSync(path, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        pattern.test(line)
          ? [`${relative(process.cwd(), path)}:${index + 1} ${line.trim()}`]
          : [],
      ),
  );
}

describe("motion contract", () => {
  it("does not use transition-all, UI ease-in, or scale(0) entrances", () => {
    expect(offenders(/transition-all|\bease-in\b(?!-out)|scale\(0\)/)).toEqual([]);
  });

  it("does not animate the keyboard-first command palette", () => {
    const source = readFileSync(join(SRC, "ui", "CommandPalette.tsx"), "utf8");
    expect(source).not.toMatch(/animate-cmd-pop|data-entering|data-exiting/);
  });

  it("uses linear timing for infinite rotation", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toMatch(/\.animate-spin[^}]*animation:[^;]*linear[^;]*infinite/s);
  });
});
```

If the negative-lookahead regex proves brittle, split the first assertion into three explicit patterns. Do not weaken the test to permit existing violations.

**Step 2: Run the test to verify failure**

Run:

```bash
npx vitest run src/ui/motion-contract.test.ts
```

Expected: FAIL because `CommandPalette.tsx` uses `animate-cmd-pop` and `index.css` uses `ease-out` for infinite spinner rotation.

**Step 3: Commit the red test**

```bash
git add src/ui/motion-contract.test.ts
git commit -m "test(ui): codify motion quality contract"
```

---

### Task 2: Add a token-alignment test

**Objective:** Prevent `DESIGN.md` and Tailwind's implemented visual tokens from drifting apart again.

**Files:**
- Create: `src/ui/design-token-contract.test.ts`
- Modify later: `tailwind.config.js`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config.js";

const extend = config.theme?.extend;

describe("design tokens", () => {
  it("matches the approved industrial surface palette", () => {
    expect(extend?.colors).toMatchObject({
      canvas: "#0a0a0a",
      panel: "#121212",
      card: { DEFAULT: "#121212", hover: "#1a1a1a" },
      edge: { DEFAULT: "#262626" },
      accent: { DEFAULT: "#00e5ff" },
      text: { DEFAULT: "#ededed", secondary: "#a1a1a1" },
      success: "#00ff9d",
      warning: "#ffb300",
      error: "#ff4d4d",
    });
  });

  it("uses the documented compact radius scale", () => {
    expect(extend?.borderRadius).toEqual({ sm: "4px", md: "6px", lg: "8px" });
  });
});
```

If TypeScript cannot import the JS config cleanly, rename the test to `.test.ts` and add a narrow `// @ts-expect-error` on the import only. Do not duplicate config values into a second runtime token file merely to satisfy the test.

**Step 2: Run the test to verify failure**

```bash
npx vitest run src/ui/design-token-contract.test.ts
```

Expected: FAIL with current navy colors and 6/10/14px radii.

**Step 3: Commit the red test**

```bash
git add src/ui/design-token-contract.test.ts
git commit -m "test(ui): lock approved design tokens"
```

---

### Task 3: Reconcile visual and motion tokens

**Objective:** Make the implementation match the approved industrial design system and establish shared motion primitives.

**Files:**
- Modify: `tailwind.config.js:6-29`
- Modify: `src/index.css:5-138`
- Modify: `DESIGN.md:39-55,88-92,189-192` only if wording must be clarified, not to preserve old code values

**Step 1: Update Tailwind tokens**

Use this target shape:

```js
colors: {
  canvas: "#0a0a0a",
  shell: "#0a0a0a",
  panel: "#121212",
  card: { DEFAULT: "#121212", hover: "#1a1a1a" },
  raised: "#181818",
  edge: { DEFAULT: "#262626", bright: "#3a3a3a" },
  accent: { DEFAULT: "#00e5ff", deep: "#00a9bd" },
  "on-accent": "#001719",
  text: { DEFAULT: "#ededed", secondary: "#a1a1a1", muted: "#777777" },
  success: "#00ff9d",
  warning: "#ffb300",
  error: "#ff4d4d",
},
borderRadius: { sm: "4px", md: "6px", lg: "8px" },
```

Use a solid neutral `raised` color. Do not introduce gradients into the surface tokens.

**Step 2: Add motion variables and shared classes**

Add to `src/index.css`:

```css
:root {
  font-optical-sizing: auto;
  --motion-fast: 100ms;
  --motion-short: 150ms;
  --motion-medium: 200ms;
  --ease-out-ui: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out-ui: cubic-bezier(0.77, 0, 0.175, 1);
}

.pressable {
  transition:
    transform var(--motion-fast) var(--ease-out-ui),
    background-color var(--motion-short) var(--ease-out-ui),
    border-color var(--motion-short) var(--ease-out-ui),
    color var(--motion-short) var(--ease-out-ui),
    box-shadow var(--motion-short) var(--ease-out-ui);
}

.pressable:active:not(:disabled) {
  transform: scale(0.97);
}

@media (hover: hover) and (pointer: fine) {
  .hover-lift:hover {
    transform: translateY(-1px);
  }
}
```

**Step 3: Fix loop timing and remove obsolete command animation**

- Change the spinner to linear rotation.
- Delete `@keyframes cmd-pop` and `.animate-cmd-pop`.
- Keep connector marching linear.
- Remove comments claiming ease-out is appropriate for constant rotation.

```css
.animate-spin-ease {
  animation: spin-ease 600ms linear infinite;
}
```

Keep the class name temporarily to avoid a broad rename; rename it to `animate-spin-linear` in a separate mechanical commit only if all call sites and tests are updated together.

**Step 4: Replace the blanket reduced-motion override**

Use targeted equivalents:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-dash-march,
  .animate-spin-ease,
  .animate-pulse-ease,
  .animate-pulse,
  .hover-lift {
    animation: none !important;
    transform: none !important;
  }

  .pressable,
  .motion-state,
  .rsemble-divider::before {
    transition-duration: 0ms !important;
  }
}
```

Do not apply `0.01ms` globally to every element.

**Step 5: Run targeted tests**

```bash
npx vitest run src/ui/design-token-contract.test.ts src/ui/motion-contract.test.ts
```

Expected: token assertions pass; command-palette assertion may remain red until Task 5, but spinner assertion passes.

**Step 6: Run typecheck and build**

```bash
npm run typecheck:web && npm run build
```

Expected: PASS.

**Step 7: Commit**

```bash
git add tailwind.config.js src/index.css DESIGN.md
git commit -m "style(ui): reconcile industrial tokens and motion primitives"
```

---

### Task 4: Add curated UI dependencies

**Objective:** Add only the libraries selected for command-menu and dialog behavior.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: Install dependencies**

```bash
npm install cmdk @base-ui/react
```

Expected: `cmdk` and `@base-ui/react` appear under `dependencies`; lockfile updates cleanly.

**Step 2: Verify dependency resolution**

```bash
node -e "Promise.all([import('cmdk'), import('@base-ui/react/dialog')]).then(() => console.log('ui primitives resolved'))"
```

Expected: `ui primitives resolved`.

**Step 3: Run current tests before migration**

```bash
npm run test
```

Expected: existing suite passes.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(ui): add cmdk and Base UI primitives"
```

---

### Task 5: Migrate CommandPalette to cmdk with zero entrance motion

**Objective:** Replace bespoke filtering/navigation/listbox logic while preserving RSemble commands and making the keyboard-first palette instant.

**Files:**
- Modify: `src/ui/CommandPalette.tsx`
- Modify: `src/ui/CommandPalette.test.tsx`
- Modify: `src/index.css`

**Step 1: Add failing behavioral tests**

Add/retain tests for:

```ts
it("opens without an entrance animation", () => {
  const html = renderPalette({ open: true });
  expect(html).not.toContain("animate-cmd-pop");
  expect(html).not.toContain("data-entering");
});

it("filters commands and selects the active command with Enter", async () => {
  // Mount with cmdk, type "runs", press Enter, assert onNavigate('/runs').
});

it("does not execute disabled commands", async () => {
  // Render canRun=false, select Run pipeline, assert onRun not called.
});
```

Use the project's existing test harness style rather than inventing another renderer.

**Step 2: Run tests to verify failure**

```bash
npx vitest run src/ui/CommandPalette.test.tsx src/ui/motion-contract.test.ts
```

Expected: FAIL on animation and/or cmdk behavior not yet implemented.

**Step 3: Replace bespoke menu internals**

Use `cmdk` primitives while preserving the existing command array:

```tsx
import { Command } from "cmdk";

<Command.Dialog
  open={open}
  onOpenChange={(next) => {
    if (!next) onClose();
  }}
  label="Command palette"
  loop
  overlayClassName="fixed inset-0 z-[60] bg-black/70"
  contentClassName="fixed left-1/2 top-[12vh] z-[61] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border border-edge-bright bg-raised shadow-popover"
>
  <Command.Input
    value={query}
    onValueChange={setQuery}
    aria-label="Search commands"
    className="min-h-[44px] flex-1 bg-transparent font-mono text-sm text-text outline-none"
  />
  <Command.List className="max-h-[50vh] overflow-y-auto p-2 scroll-thin">
    <Command.Empty>No matching commands</Command.Empty>
    {groups.map(([group, items]) => (
      <Command.Group key={group} heading={group}>
        {items.map((cmd) => (
          <Command.Item
            key={cmd.id}
            value={`${cmd.label} ${cmd.group}`}
            disabled={cmd.disabled}
            onSelect={() => execute(cmd)}
          >
            {/* existing icon, label, and hint markup */}
          </Command.Item>
        ))}
      </Command.Group>
    ))}
  </Command.List>
</Command.Dialog>
```

Remove:

- manual fuzzy filtering
- manual active index
- manual ArrowUp/ArrowDown handling
- manual `scrollIntoView`
- manual focus trap
- `animate-cmd-pop`

Keep the global `⌘K` toggle in `rsemble.tsx` as the sole shortcut owner.

**Step 4: Preserve disabled styling using value selectors**

`cmdk` sets `aria-disabled="true|false"`, so style exact values rather than attribute presence.

**Step 5: Run targeted tests**

```bash
npx vitest run src/ui/CommandPalette.test.tsx src/ui/motion-contract.test.ts
```

Expected: PASS.

**Step 6: Run typecheck**

```bash
npm run typecheck:web
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/ui/CommandPalette.tsx src/ui/CommandPalette.test.tsx src/index.css
git commit -m "refactor(ui): migrate command palette to cmdk"
```

---

### Task 6: Migrate modal surfaces to Base UI Dialog

**Objective:** Delegate focus trap, Escape, outside dismissal, and restoration to one mature primitive.

**Files:**
- Create: `src/ui/DialogSurface.tsx`
- Create: `src/ui/DialogSurface.test.tsx`
- Modify: `src/ui/ConnectionsModal.tsx`
- Modify: `src/ui/ConnectionsModal.test.tsx`
- Modify: `src/ui/ShortcutCheatsheet.tsx`
- Modify: `src/rsemble.tsx`
- Delete after all callers migrate: `src/ui/useDialogA11y.ts`

**Step 1: Write failing shared-dialog tests**

Test the four-part contract:

1. open moves focus inside
2. repeated Tab stays inside
3. Escape closes
4. close restores focus to trigger

Also test outside-pointer dismissal and `prefers-reduced-motion` class behavior.

**Step 2: Run tests to verify failure**

```bash
npx vitest run src/ui/DialogSurface.test.tsx src/ui/ConnectionsModal.test.tsx
```

Expected: FAIL because `DialogSurface` does not exist.

**Step 3: Build the controlled Base UI wrapper**

```tsx
import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

export function DialogSurface({
  open,
  onOpenChange,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup
            className={`motion-state max-h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-lg border border-edge-bright bg-raised shadow-popover ${className}`}
          >
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

Use `Dialog.Title` visibly in components that already have a heading rather than duplicating a screen-reader-only title. Keep centered modal origin.

**Step 4: Migrate Connections and Cheatsheet**

- Preserve all existing provider Test-before-Save behavior.
- Replace outer modal/role/focus code only.
- Remove duplicated Escape and Tab listeners.
- Cheatsheet may use pointer-opened 150ms opacity/scale treatment, but if the `?` shortcut is the dominant path, prefer instant presentation.

**Step 5: Migrate the mobile command drawer**

Replace `useDialogA11y` in `rsemble.tsx` with Base UI Dialog composition. Preserve:

- output-first mobile layout
- full command-pane scroll reachability
- same-edge enter/exit only for pointer-opened drawer
- no movement under reduced motion

Do not move `CommandPane` state or pipeline logic into the dialog primitive.

**Step 6: Delete the old hook only after no imports remain**

Verify:

```bash
rg "useDialogA11y" src
```

Expected: no output. If the environment disallows `rg`, use the repository search tool.

**Step 7: Run targeted tests**

```bash
npx vitest run src/ui/DialogSurface.test.tsx src/ui/ConnectionsModal.test.tsx src/rsemble-shell.test.tsx
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/ui/DialogSurface.tsx src/ui/DialogSurface.test.tsx src/ui/ConnectionsModal.tsx src/ui/ConnectionsModal.test.tsx src/ui/ShortcutCheatsheet.tsx src/rsemble.tsx
git rm src/ui/useDialogA11y.ts
git commit -m "refactor(ui): consolidate modal behavior on Base UI"
```

---

### Task 7: Simplify shell and primary-action motion

**Objective:** Remove redundant ambient motion and add immediate, touch-safe feedback to physical controls.

**Files:**
- Modify: `src/ui/Header.tsx`
- Modify: `src/ui/RunButton.tsx`
- Modify: `src/rsemble.tsx` (`FocusStrip`, `ResetButton`)
- Modify: corresponding existing tests or create `src/ui/primary-action-motion.test.tsx`

**Step 1: Write failing tests**

Assert:

- Header does not render the moving bottom gradient.
- Run control uses `pressable` and a solid accent style.
- Run hover lift is gated through the shared `hover-lift` class.
- Disabled Run has no hover/press transform.
- Reset keeps a stable minimum width in armed and unarmed states.

**Step 2: Run tests to verify failure**

```bash
npx vitest run src/ui/primary-action-motion.test.tsx src/rsemble-shell.test.tsx
```

Expected: FAIL on current header gradient and button classes.

**Step 3: Remove the header moving strip**

Delete `Header.tsx:164-168`. The connection/running pill remains the compact status surface.

**Step 4: Refine RunButton**

Replace the teal gradient and ungated Tailwind hover transform:

```tsx
const look = running
  ? "bg-error/15 text-error"
  : canRun
    ? "bg-accent text-on-accent hover-lift"
    : "cursor-not-allowed border border-edge bg-card text-text-secondary opacity-70";

className={`pressable mt-auto flex min-h-[64px] w-full items-center gap-3 rounded-md px-4 text-left ${look}`}
```

For the large Run control, `scale(0.98)` may be used instead of the shared `0.97` if visual QA shows 0.97 is too pronounced.

**Step 5: Stabilize ResetButton geometry**

Reserve enough width for the armed state or render a fixed-width label region. Do not animate width.

**Step 6: Apply the same primary-control rules to FocusStrip**

Use `pressable hover-lift`; no ungated `hover:-translate-y-*`.

**Step 7: Run tests and typecheck**

```bash
npx vitest run src/ui/primary-action-motion.test.tsx src/rsemble-shell.test.tsx
npm run typecheck:web
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/ui/Header.tsx src/ui/RunButton.tsx src/rsemble.tsx src/ui/primary-action-motion.test.tsx
git commit -m "style(ui): simplify shell motion and sharpen primary feedback"
```

---

### Task 8: Refine pipeline continuity and loop budget

**Objective:** Make execution progress legible through stable stage transitions and one active-flow cue.

**Files:**
- Modify: `src/ui/PipelineRail.tsx`
- Modify: `src/ui/PipelineRail.test.tsx` or create it if absent
- Modify: `src/ui/GlobalExecutionStrip.tsx`
- Modify: `src/ui/GlobalExecutionStrip.test.tsx`
- Modify: `src/ui/StatusMark.tsx`
- Modify: `src/ui/StatusMark.test.tsx`
- Modify: `src/index.css`

**Step 1: Write failing tests**

Assert:

```ts
it("animates only the connector feeding the active stage", () => {
  // Render stages [done, active, pending, pending].
  // Expect exactly one .animate-dash-march connector.
});

it("does not pulse the off-route running status", () => {
  // Render GlobalExecutionStrip in running state.
  // Expect no animate-pulse class and visible running text.
});

it("keeps status geometry stable", () => {
  // StatusMark has a fixed icon box and visible label for every state.
});
```

**Step 2: Run tests to verify failure**

```bash
npx vitest run src/ui/PipelineRail.test.tsx src/ui/GlobalExecutionStrip.test.tsx src/ui/StatusMark.test.tsx
```

Expected: at least the pulse assertion fails.

**Step 3: Implement fixed-geometry status transitions**

- Add a fixed-size icon container.
- Use `motion-state` for 150ms opacity/color/border transitions.
- Do not keyframe status swaps.
- Keep card dimensions unchanged.

**Step 4: Enforce one dominant loop**

- Active connector: linear march.
- Active stage: spinner allowed.
- Stage card: no pulse.
- Global execution strip: static status icon/text plus elapsed time; no pulse.

**Step 5: Verify reduced motion**

In reduced motion, connector and spinner stop, while visible text still says `Running` and names the stage.

**Step 6: Run targeted tests**

```bash
npx vitest run src/ui/PipelineRail.test.tsx src/ui/GlobalExecutionStrip.test.tsx src/ui/StatusMark.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/ui/PipelineRail.tsx src/ui/PipelineRail.test.tsx src/ui/GlobalExecutionStrip.tsx src/ui/GlobalExecutionStrip.test.tsx src/ui/StatusMark.tsx src/ui/StatusMark.test.tsx src/index.css
git commit -m "style(ui): clarify pipeline continuity and active flow"
```

---

### Task 9: Standardize press feedback without animating data surfaces

**Objective:** Apply the shared press response to physical controls and explicitly exclude links, rows, dividers, and keyboard menu items.

**Files:**
- Modify: `src/ui/ModeToggle.tsx`
- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/EvaluationDisclosure.tsx`
- Modify: `src/ui/TaskInput.tsx`
- Modify: `src/ui/ConnectionsModal.tsx`
- Modify: `src/workspaces/evaluations/ExperimentProgress.tsx`
- Modify: selected editor action components only where controls are true buttons
- Do not modify press geometry in: `RecordRow.tsx`, `ResultMatrix.tsx`, workspace nav links

**Step 1: Add a focused class-contract test**

```ts
it("uses press feedback on physical buttons but not record rows", () => {
  expect(read("src/ui/RunButton.tsx")).toContain("pressable");
  expect(read("src/ui/ModeToggle.tsx")).toContain("pressable");
  expect(read("src/ui/RecordRow.tsx")).not.toContain("pressable");
  expect(read("src/workspaces/evaluations/ResultMatrix.tsx")).not.toContain("pressable");
});
```

Use component behavior tests where practical; use source contract only for the explicit exclusion boundary.

**Step 2: Run test to verify failure**

```bash
npx vitest run src/ui/press-feedback-contract.test.ts
```

Expected: FAIL before classes are applied.

**Step 3: Apply `pressable` selectively**

Good candidates:

- Run/Stop
- icon buttons
- model enable checkbox/button
- disclosure triggers
- Save/Test/Done buttons
- Pause/Resume/Abort/Retry
- segmented controls

Excluded:

- text links
- `RecordRow`
- matrix links/cells
- splitter
- command-menu items
- disabled controls

**Step 4: Keep hover movement fine-pointer-only**

Only primary CTA controls may use `hover-lift`. Other buttons use color/border feedback.

**Step 5: Run targeted and contract tests**

```bash
npx vitest run src/ui/press-feedback-contract.test.ts src/ui/ModelList.test.tsx src/ui/EvaluationDisclosure.test.tsx
```

Run the existing nearest component test where one exists; do not create empty coverage merely to satisfy a filename.

**Step 6: Commit**

```bash
git add src/ui src/workspaces/evaluations/ExperimentProgress.tsx
git commit -m "style(ui): standardize press feedback on physical controls"
```

Before committing, inspect `git diff --cached --name-only` and unstage any unrelated UI file accidentally swept in by `git add src/ui`.

---

### Task 10: Preserve geometry across compact state changes

**Objective:** Remove small but cumulative layout jumps in reset, status, loading, and editor disclosure states.

**Files:**
- Modify: `src/rsemble.tsx` (`ResetButton`)
- Modify: `src/ui/StatusMark.tsx`
- Modify: `src/ui/RunButton.tsx`
- Modify: `src/ui/EvaluationDisclosure.tsx`
- Modify: `src/ui/EvaluationProfileEditor.tsx`
- Modify: `src/workspaces/evaluations/SuiteEditor.tsx`
- Modify tests beside each component

**Step 1: Add failing geometry/state tests**

Assert stable wrapper classes/structure across:

- Reset idle → armed
- Run → Stop
- Status queued → running → completed
- disclosure closed → open

Tests should compare the stable outer wrapper, not pixel dimensions in happy-dom.

**Step 2: Run tests to verify failure**

```bash
npx vitest run src/rsemble-shell.test.tsx src/ui/StatusMark.test.tsx src/ui/EvaluationDisclosure.test.tsx src/ui/EvaluationProfileEditor.test.tsx src/workspaces/evaluations/SuiteEditor.test.tsx
```

Expected: at least Reset geometry assertion fails.

**Step 3: Implement fixed geometry**

- Reserve icon boxes with `size-* shrink-0`.
- Keep button width/min-width stable.
- Swap labels inside a fixed flex region.
- Keep disclosure panel insertion instant; only rotate chevrons over 150ms ease-out.
- Never animate height or grid rows.

**Step 4: Run tests**

Use the command from Step 2.

Expected: PASS.

**Step 5: Commit**

```bash
git add src/rsemble.tsx src/ui/StatusMark.tsx src/ui/RunButton.tsx src/ui/EvaluationDisclosure.tsx src/ui/EvaluationProfileEditor.tsx src/workspaces/evaluations/SuiteEditor.tsx
git commit -m "style(ui): preserve geometry across state changes"
```

---

### Task 11: Extend CDP QA for motion, reduced motion, zoom, and touch

**Objective:** Produce browser evidence for every acceptance viewport and input/motion mode.

**Files:**
- Create: `scripts/cdp-design-motion-qa.mjs`
- Create at runtime: `docs/qa/design-motion-refinement/*.png`
- Create at runtime: `docs/qa/design-motion-refinement/results.json`
- Modify: `package.json` to add `qa:design-motion`

**Step 1: Write the QA script from the existing harness**

Reuse the CDP plumbing in `scripts/cdp-qa.mjs`, but add:

- viewports 1440×1000, 1024×768, 768×1024, 390×844
- `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce`
- 200% page scale or equivalent CSS-pixel/zoom validation
- touch/mobile emulation
- computed-style assertions
- command-palette open latency and animation-name assertion
- dialog focus contract
- document overflow probes

Core probe:

```js
const motionProbe = await evalJs(`JSON.stringify((() => {
  const palette = document.querySelector('[cmdk-dialog]');
  const spinner = document.querySelector('.animate-spin-ease');
  return {
    paletteAnimation: palette ? getComputedStyle(palette).animationName : null,
    spinnerTiming: spinner ? getComputedStyle(spinner).animationTimingFunction : null,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    activeTag: document.activeElement?.tagName ?? null,
  };
})())`);
```

Expected in normal mode: palette animation `none`; spinner timing `linear` when present; no overflow.

In reduced motion: movement animation names are `none` while visible status text remains.

**Step 2: Add package script**

```json
"qa:design-motion": "node scripts/cdp-design-motion-qa.mjs"
```

**Step 3: Start the app**

```bash
npm run dev:web -- --port 5176
```

Run as a tracked background process if using Hermes; wait for the Vite ready signal before QA.

**Step 4: Run browser QA**

```bash
npm run qa:design-motion
```

Expected:

- exit code 0
- screenshots at all four viewports
- normal and reduced-motion captures
- no overflow assertions
- focus contract passes
- `results.json` records all probes

**Step 5: Inspect screenshots**

Check:

- header fit
- surface/radius consistency
- solid Run CTA
- dialog fit and hierarchy
- mobile drawer reachability
- pipeline stage clarity
- focus rings
- no clipped model identities or matrix content

Do not call screenshots “verified” without opening them.

**Step 6: Commit**

```bash
git add scripts/cdp-design-motion-qa.mjs package.json docs/qa/design-motion-refinement
git commit -m "test(ui): add design and motion browser QA"
```

---

### Task 12: Final integrated verification and documentation

**Objective:** Prove the refinement is correct, accessible, performant, and isolated from product behavior.

**Files:**
- Create: `docs/qa/design-motion-refinement/qa-report.md`
- Modify: `docs/specs/executed/design-motion-refinement/design-motion-refinement-spec.md` only to mark accepted deviations with evidence
- Modify: `DESIGN.md` only if final verified values need clarification

**Step 1: Run the complete quality gate**

```bash
npm run check
git diff --check
git status --short
```

Expected:

- web typecheck PASS
- server typecheck PASS
- full Vitest suite PASS
- production build PASS
- no whitespace errors
- only intended refinement files plus the pre-existing untracked research files

**Step 2: Measure bundle impact**

Record generated JS/CSS sizes from `npm run build`. Compare with the previous evidence in `docs/final-qa-report.md` while acknowledging that the application has grown since that report; do not claim an apples-to-apples regression without a pre-change build from the same commit.

**Step 3: Run the CDP gate again from a clean production preview**

```bash
npm run preview -- --port 5176
npm run qa:design-motion
```

Expected: PASS against the production build, not only Vite dev mode.

**Step 4: Review motion in slow mode**

Use Chrome DevTools animation tooling or temporarily apply a local-only 4× slowdown. Check:

- status glyph crossfades align
- connector begins/ends without a jump
- modal surface does not scale from zero
- no content swaps reveal overlapping text
- press feedback returns cleanly when interrupted

Do not commit slowdown code.

**Step 5: Write the QA report**

Include:

- commit/range reviewed
- commands and real outputs
- test totals
- viewport matrix
- reduced-motion matrix
- focus and overflow results
- screenshot paths
- bundle sizes
- any accepted deviation with rationale
- residual risks

**Step 6: Run a final motion review**

Use the `review-animations` skill on the final diff. Required decision: **Approve**. If it returns **Block**, fix each blocker and repeat the targeted test plus browser check before finalizing.

**Step 7: Commit final evidence**

```bash
git add docs/qa/design-motion-refinement/qa-report.md docs/specs/executed/design-motion-refinement/design-motion-refinement-spec.md DESIGN.md
git commit -m "docs(ui): record design and motion refinement evidence"
```

Do not stage `docs/research/task-first-evaluation-taxonomy.*`.

---

## Final acceptance checklist

- [ ] `tailwind.config.js` matches the approved palette and radius scale.
- [ ] No `transition-all`, UI `ease-in`, or `scale(0)` entrances.
- [ ] Infinite rotation uses linear timing.
- [ ] Command palette uses `cmdk` and has no entrance/exit motion.
- [ ] Connections, Cheatsheet, and mobile command sheet use Base UI Dialog behavior.
- [ ] Old hand-rolled focus-trap hook and duplicated focus logic are removed.
- [ ] Header moving gradient is removed.
- [ ] Only one dominant looping progress cue appears per region.
- [ ] Physical buttons have press feedback; rows, links, dividers, and command items do not scale.
- [ ] Hover movement is fine-pointer-only.
- [ ] Reduced motion removes movement but preserves visible status feedback.
- [ ] No animated list sorting/filtering or score counting.
- [ ] No horizontal overflow at 1440, 1024, 768 portrait, 390 mobile, or 200% zoom.
- [ ] Dialog focus entry, trap, Escape, outside dismissal, and restoration pass.
- [ ] Full tests, both typechecks, production build, and `git diff --check` pass.
- [ ] Browser screenshots and machine-readable probe results exist.
- [ ] Final `review-animations` verdict is Approve.
- [ ] Pre-existing untracked research documents remain untouched and unstaged.

## Execution handoff

Plan complete. Execute with `subagent-driven-development` task-by-task, using a fresh implementation subagent for each task and two reviews after every task: specification compliance first, then code quality. Do not proceed to the next task until both reviews pass.
