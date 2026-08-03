# Evaluations Identity and UX Upgrade — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Suites and Profiles unmistakably different kinds of things, surface their relationship in both directions, correct the status vocabulary, and preserve the existing motion discipline.

**Architecture:** Additive tokens and derived joins only. Two new `StatusMark` tokens, one new pure derivation module (`profile-usage.ts`), one shared chip component (`ProfileRefChip`), optional `kind` slot on `RecordRow`, and targeted list/detail updates. No storage changes, no new dependencies, no new routes.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind, vitest, existing `RecordRow`/`StatusMark` primitives, `lucide-react`.

**Spec:** `docs/specs/evaluations-identity-ux/evaluations-identity-ux-spec.md`

**Baseline commit:** Implementation starts only after the current in-flight worktree changes (`src/rsemble.tsx`, `src/ui/Header.tsx`, `src/ui/RecordRow.tsx`) are committed or stashed. Record the baseline with `git rev-parse --short HEAD` and stamp it below before Task 1.

Baseline commit: `__________`

---

## Milestone map

| Milestone | Tasks | Deliverable |
| --- | --- | --- |
| M0 Ground rules | 0–1 | Contract tests that fail until the tokens exist |
| M1 Vocabulary | 2–3 | `ready`/`reusable` status tokens live + documented |
| M2 Derivation | 4–5 | Tested `profile-usage.ts` joins |
| M3 Identity surfaces | 6–9 | Kind eyebrows, chips, upgraded rows in both lists |
| M4 Detail + nav | 10–12 | ProfileDetail refactor, editor chip, segmented sublabels, empty-state cross-links |
| M5 Motion + geometry | 13 | Nav color continuity, archive-confirm stable width |
| M6 Evidence | 14 | Full gate, CDP QA, browser matrix, QA report |

## Out of scope

- Task-first taxonomy, storage migrations, route changes, Compare/Runs behavior, fusion study, new dependencies, any animation library, entrance/stagger/layout animation on lists.

---

### Task 0: Record baseline and confirm clean start

**Objective:** Ensure the branch starts from committed in-flight work, not a dirty tree.

**Files:** none (git only)

**Step 1: Verify pre-existing worktree state**

Run: `git status --porcelain`
Expected: the known in-flight files (`src/rsemble.tsx`, `src/ui/Header.tsx`, `src/ui/RecordRow.tsx`) are either already committed or explicitly stashed. If they are still modified, stop and ask the owner of that work to commit or stash before proceeding. Untracked docs (`docs/research/*`, `docs/evaluations/*.suite.json`) stay untracked.

**Step 2: Stamp baseline**

Run: `git rev-parse --short HEAD`
Write the output into this plan's "Baseline commit" field.

**Step 3: Verify green baseline**

Run: `npm run check`
Expected: PASS (typecheck + tests + build). Do not proceed on a red baseline.

No commit for this task.

---

### Task 1: Add failing contract tests for the new identity primitives

**Objective:** Lock the target behavior in tests before any implementation exists.

**Files:**
- Modify: `src/ui/StatusMark.test.tsx`
- Create: `src/lib/evaluations/profile-usage.test.ts`

**Step 1: Write failing StatusMark tests**

Append to `src/ui/StatusMark.test.tsx`:

```tsx
it("renders the ready token for runnable workloads", () => {
  const { getByText } = render(<StatusMark status="ready" />);
  expect(getByText("Ready")).toBeTruthy();
});

it("renders the reusable token for live rubrics", () => {
  const { getByText } = render(<StatusMark status="reusable" />);
  expect(getByText("Reusable")).toBeTruthy();
});
```

Match the file's existing render/harness imports; do not add new test dependencies.

**Step 2: Write failing profile-usage tests**

Create `src/lib/evaluations/profile-usage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EvaluationSuite } from "./evaluation-types";
import { suitesUsingProfile } from "./profile-usage";

function suite(over: Partial<EvaluationSuite>): EvaluationSuite {
  return {
    id: "s1", revision: 1, version: 1, name: "S", description: "",
    tasks: [], modelSlots: [],
    defaultJudge: { providerId: "openrouter", slug: "x/y" } as never,
    defaultEvaluation: { kind: "holistic" },
    createdAt: 0, updatedAt: 0, archivedAt: null,
    ...over,
  } as EvaluationSuite;
}

const PIN = { id: "p1", version: 2 };

describe("suitesUsingProfile", () => {
  it("matches suites whose default evaluation pins the profile", () => {
    const s = suite({ defaultEvaluation: { kind: "profile", profile: PIN } });
    expect(suitesUsingProfile([s], "p1")).toEqual([
      { suite: s, versions: [2], levels: ["default"] },
    ]);
  });

  it("matches task-level pins and enumerates versions", () => {
    const s = suite({
      tasks: [{
        id: "t1", title: "T", prompt: "", systemPrompt: "",
        evaluation: { kind: "profile", profile: PIN },
        judgeInstructionOverride: "", order: 0,
      }],
    });
    expect(suitesUsingProfile([s], "p1")[0].versions).toEqual([2]);
    expect(suitesUsingProfile([s], "p1")[0].levels).toContain("task");
  });

  it("excludes archived suites and holistic suites", () => {
    const archived = suite({ id: "s2", archivedAt: 1, defaultEvaluation: { kind: "profile", profile: PIN } });
    const holistic = suite({ id: "s3" });
    expect(suitesUsingProfile([archived, holistic], "p1")).toEqual([]);
  });

  it("does not match other profile ids", () => {
    const s = suite({ defaultEvaluation: { kind: "profile", profile: { id: "p9", version: 1 } } });
    expect(suitesUsingProfile([s], "p1")).toEqual([]);
  });
});
```

**Step 3: Run tests to verify failure**

Run: `npx vitest run src/ui/StatusMark.test.tsx src/lib/evaluations/profile-usage.test.ts`
Expected: FAIL — `ready`/`reusable` are not assignable status values; `profile-usage` module does not exist.

**Step 4: Commit**

```bash
git add src/ui/StatusMark.test.tsx src/lib/evaluations/profile-usage.test.ts
git commit -m "test: contract tests for evaluations identity tokens and profile usage"
```

---

### Task 2: Implement ready/reusable status tokens

**Objective:** Add the two tokens to `StatusMark` and make Task 1's StatusMark tests pass.

**Files:**
- Modify: `src/ui/StatusMark.tsx`
- Modify: `DESIGN.md` (status token table)

**Step 1: Extend the status type and map**

In `src/ui/StatusMark.tsx`, add `"ready" | "reusable"` to `StatusMarkStatus`, import `CirclePlay` and `BadgeCheck` from `lucide-react`, and add to `STATUS_MAP`:

```ts
ready:    { label: "Ready",    icon: CirclePlay,  color: "text-accent",     spin: false },
reusable: { label: "Reusable", icon: BadgeCheck,  color: "text-text-muted", spin: false },
```

**Step 2: Document the tokens**

In `DESIGN.md`, insert into the status-token table after the `interrupted` row:

```markdown
| ready | cyan | `CirclePlay` |
| reusable | zinc neutral | `BadgeCheck` |
```

Append one sentence below the table: `Ready marks runnable workloads (suites); Reusable marks live pinnable rubrics (profiles). Neither is a run-lifecycle state.`

**Step 3: Run tests to verify pass**

Run: `npx vitest run src/ui/StatusMark.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/ui/StatusMark.tsx DESIGN.md
git commit -m "feat: add ready and reusable status tokens"
```

---

### Task 3: Implement profile-usage derivation module

**Objective:** Extract and generalize ProfileDetail's inline predicate into a tested shared module.

**Files:**
- Create: `src/lib/evaluations/profile-usage.ts`

**Step 1: Implement the module**

```ts
import type { EvaluationSuite } from "./evaluation-types";

export interface ProfileUsage {
  suite: EvaluationSuite;
  /** Distinct pinned versions of this profile, ascending. */
  versions: number[];
  /** Where the pins occur: suite default and/or task level. */
  levels: ("default" | "task")[];
}

/**
 * Derive which suites pin a profile, by scanning existing records.
 * Pure function over listSuites(true) output; no storage access.
 * Archived suites are excluded. (Spec: evaluations-identity-ux §5.3.)
 */
export function suitesUsingProfile(
  suites: EvaluationSuite[],
  profileId: string,
): ProfileUsage[] {
  const out: ProfileUsage[] = [];
  for (const suite of suites) {
    if (suite.archivedAt != null) continue;
    const versions = new Set<number>();
    const levels = new Set<"default" | "task">();
    if (suite.defaultEvaluation.kind === "profile" && suite.defaultEvaluation.profile.id === profileId) {
      versions.add(suite.defaultEvaluation.profile.version);
      levels.add("default");
    }
    for (const task of suite.tasks) {
      if (task.evaluation.kind === "profile" && task.evaluation.profile.id === profileId) {
        versions.add(task.evaluation.profile.version);
        levels.add("task");
      }
    }
    if (versions.size > 0) {
      out.push({ suite, versions: [...versions].sort((a, b) => a - b), levels: [...levels] });
    }
  }
  return out;
}
```

**Step 2: Run tests to verify pass**

Run: `npx vitest run src/lib/evaluations/profile-usage.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/lib/evaluations/profile-usage.ts
git commit -m "feat: derive profile usage from suite records"
```

---

### Task 4: Create shared identity primitives (KindEyebrow + ProfileRefChip)

**Objective:** One component pair that every surface uses for entity identity and profile references.

**Files:**
- Create: `src/ui/KindEyebrow.tsx`
- Create: `src/ui/ProfileRefChip.tsx`
- Create: `src/ui/ProfileRefChip.test.tsx`

**Step 1: Write the failing chip test**

`src/ui/ProfileRefChip.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { ProfileRefChip } from "./ProfileRefChip";

describe("ProfileRefChip", () => {
  it("renders name and version as a link to the profile", () => {
    render(
      <MemoryRouter>
        <ProfileRefChip name="Clarity rubric" profileId="p1" version={3} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /Clarity rubric v3/ });
    expect(link.getAttribute("href")).toBe("/evaluations/profiles/p1");
  });

  it("renders holistic judging as a non-link muted chip", () => {
    render(
      <MemoryRouter>
        <ProfileRefChip holistic />
      </MemoryRouter>,
    );
    expect(screen.getByText("Holistic judging")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
```

If the repo's existing UI tests use `happy-dom` + a different import style, match that style instead of introducing `@testing-library/react` unless it is already a dependency (check `package.json` devDependencies first; existing tests in `src/ui/*.test.tsx` are the pattern to copy).

**Step 2: Run to verify failure**

Run: `npx vitest run src/ui/ProfileRefChip.test.tsx`
Expected: FAIL — module missing.

**Step 3: Implement**

`src/ui/KindEyebrow.tsx`:

```tsx
import { ListChecks, Scale, type LucideIcon } from "lucide-react";

const KINDS = {
  suite: { word: "Workload", icon: ListChecks, def: "A versioned set of tasks, models, and a judge. You run it." },
  profile: { word: "Rubric", icon: Scale, def: "Scoring criteria with 1/3/5 anchors. It judges, it does not run." },
} as const;

export type EntityKind = keyof typeof KINDS;

export function KindEyebrow({ kind }: { kind: EntityKind }) {
  const k = KINDS[kind];
  const Icon: LucideIcon = k.icon;
  return (
    <span
      className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted"
      title={k.def}
    >
      <Icon size={11} aria-hidden="true" />
      {k.word}
    </span>
  );
}
```

`src/ui/ProfileRefChip.tsx`:

```tsx
import { Link } from "react-router-dom";
import { Scale } from "lucide-react";

interface Props {
  holistic?: boolean;
  name?: string;
  profileId?: string;
  version?: number;
}

export function ProfileRefChip({ holistic, name, profileId, version }: Props) {
  if (holistic) {
    return (
      <span className="rounded-sm border border-edge bg-panel px-1.5 py-0.5 text-xs text-text-muted">
        Holistic judging
      </span>
    );
  }
  return (
    <Link
      to={`/evaluations/profiles/${profileId}`}
      onClick={(e) => e.stopPropagation()}
      className="flex min-w-0 items-center gap-1 rounded-sm border border-edge bg-panel px-1.5 py-0.5 text-xs text-text-secondary transition-colors duration-150 hover:border-edge-bright hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`Rubric ${name} v${version}`}
    >
      <Scale size={11} aria-hidden="true" />
      <span className="truncate">{name} v{version}</span>
    </Link>
  );
}
```

**Step 4: Run to verify pass**

Run: `npx vitest run src/ui/ProfileRefChip.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ui/KindEyebrow.tsx src/ui/ProfileRefChip.tsx src/ui/ProfileRefChip.test.tsx
git commit -m "feat: add entity kind eyebrow and profile reference chip"
```

---

### Task 5: Upgrade SuiteList rows

**Objective:** Suite rows show kind, evaluation chip, model count, and latest experiment state.

**Files:**
- Modify: `src/workspaces/evaluations/SuiteList.tsx`
- Modify: `src/workspaces/evaluations/SuiteList.test.tsx`

**Step 1: Write failing test**

In `SuiteList.test.tsx`, add a test that seeds a suite with a profile-pinned default evaluation and an archived profile name, and asserts:

```tsx
it("shows the workload kind eyebrow and the pinned rubric chip", async () => {
  // seed repo with one suite pinning profile p1 v1 named "Clarity"
  // render <SuiteList repo={repo} /> wrapped in MemoryRouter
  expect(await screen.findByText("Workload")).toBeTruthy();
  expect(await screen.findByRole("link", { name: /Clarity v1/ })).toBeTruthy();
});
```

Follow the file's existing seeding harness exactly (it already builds a fake repo via `fake-indexeddb`).

**Step 2: Run to verify failure**

Run: `npx vitest run src/workspaces/evaluations/SuiteList.test.tsx`
Expected: FAIL — chip and eyebrow absent.

**Step 3: Implement**

In `SuiteList.tsx`:
1. Load profiles once alongside suites inside `load()` (add `repo.listProfiles(true)` to the `Promise.all`) and build an `id -> ProfileRecord` map plus a name lookup via `repo.getProfile(id, latestVersion)` only for records that are actually referenced (avoid N+1 by collecting referenced ids first).
2. Change the row status: `status={isArchived ? "aborted" : "ready"}`.
3. Add `kind={<KindEyebrow kind="suite" />}` via RecordRow's slot (Task 6 adds the slot; if implementing strictly in order, do Task 6 step 1 first or land both in one commit).
4. Extend `summary` to `${tasks} task(s) · ${enabledModelCount} models`.
5. Render the evaluation chip after the summary: `<ProfileRefChip holistic />` when `suite.defaultEvaluation.kind === "holistic"`, else the resolved name/version chip; when the pinned profile id no longer exists, render a muted chip `Rubric missing`.

**Step 4: Run to verify pass**

Run: `npx vitest run src/workspaces/evaluations/SuiteList.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/workspaces/evaluations/SuiteList.tsx src/workspaces/evaluations/SuiteList.test.tsx
git commit -m "feat: suite rows show workload identity, rubric pin, and model count"
```

---

### Task 6: Add the optional kind slot to RecordRow

**Objective:** Give the shared row family a backward-compatible identity slot.

**Files:**
- Modify: `src/ui/RecordRow.tsx`

**Step 1: Implement**

Add `kind?: ReactNode` to `RecordRowProps`. In the `Inner` layout, render it as the first element of the title row (before `StatusMark`), wrapped in `<span className="shrink-0">`. All existing callers remain unchanged because the prop is optional.

Respect the in-flight two-line layout: place `kind` in the first line only.

**Step 2: Verify existing tests still pass**

Run: `npx vitest run src/ui src/workspaces/evaluations/SuiteList.test.tsx`
Expected: PASS

**Step 3: Commit**

```bash
git add src/ui/RecordRow.tsx
git commit -m "feat: add optional kind slot to RecordRow"
```

---

### Task 7: Upgrade ProfileList rows

**Objective:** Profile rows show kind, correct status, and a criteria preview.

**Files:**
- Modify: `src/workspaces/evaluations/ProfileList.tsx`
- Modify: `src/workspaces/evaluations/ProfileList.test.tsx`

**Step 1: Write failing test**

```tsx
it("shows the rubric kind eyebrow, reusable status, and criteria preview", async () => {
  // seed one profile with criteria ["Clarity", "Depth"]
  // render ProfileList
  expect(await screen.findByText("Rubric")).toBeTruthy();
  expect(await screen.findByText(/Clarity \+1 more/)).toBeTruthy();
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/workspaces/evaluations/ProfileList.test.tsx`
Expected: FAIL

**Step 3: Implement**

1. Status: `status={archived ? "aborted" : "reusable"}`.
2. Add `kind={<KindEyebrow kind="profile" />}`.
3. Summary: `${n} criteria · ${firstName}` when one criterion; `${n} criteria · ${firstName} +${n - 1} more` when more; plain `${n} criteria` when names are empty placeholders is acceptable.

**Step 4: Run to verify pass**

Run: `npx vitest run src/workspaces/evaluations/ProfileList.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/workspaces/evaluations/ProfileList.tsx src/workspaces/evaluations/ProfileList.test.tsx
git commit -m "feat: profile rows show rubric identity and criteria preview"
```

---

### Task 8: Refactor ProfileDetail to profile-usage

**Objective:** Replace the inline `suiteReferencesProfile` predicate with the shared module and improve the backlink section.

**Files:**
- Modify: `src/workspaces/evaluations/ProfileDetail.tsx`
- Modify: `src/workspaces/evaluations/ProfileDetail.test.tsx` (add coverage if the file exists; otherwise the module tests from Task 3 suffice)

**Step 1: Refactor**

1. Delete the local `suiteReferencesProfile` function (currently around lines 50-65).
2. Replace the pinned-suites computation with `suitesUsingProfile(suites, profileId)` filtered to entries whose `versions` include `selectedVersion` — preserving today's version-scoped behavior.
3. Add below it a second line listing entries pinned at *other* versions: `Also pinned at v1 by: <suite links>` (muted, small). This closes the gap where a user viewing v2 could not see a suite still pinning v1.
4. Backlink rows: use `status={suite.archivedAt != null ? "aborted" : "ready"}` (fixes the `draft`/`completed` misuse at the current line ~477).
5. Keep the section header and empty-state copy; update the empty state to: "No suite pins this rubric at this version." plus a `<Link to="/evaluations">` "Browse suites".

**Step 2: Verify**

Run: `npx vitest run src/workspaces/evaluations`
Expected: PASS

**Step 3: Commit**

```bash
git add src/workspaces/evaluations/ProfileDetail.tsx
git commit -m "refactor: profile backlinks use shared profile-usage derivation"
```

---

### Task 9: Suite editor header chip

**Objective:** The suite editor names its pinned evaluation profile where the user configures it.

**Files:**
- Modify: `src/workspaces/evaluations/SuiteEditor.tsx`

**Step 1: Implement**

In the page header next to the suite name/version block, render `<ProfileRefChip>` for `persisted.defaultEvaluation` using the already-loaded `profileRecords` and `resolveProfileLabel` helpers (SuiteEditor.tsx:164-171 already resolves labels; reuse that resolution and split it into name + version for the chip, or extend it minimally).

No test changes required beyond typecheck if the header is not covered by existing tests; if `SuiteEditor.test.tsx` renders the header, assert the chip's accessible name.

**Step 2: Verify**

Run: `npm run typecheck:web && npx vitest run src/workspaces/evaluations/SuiteEditor.test.tsx`
Expected: PASS

**Step 3: Commit**

```bash
git add src/workspaces/evaluations/SuiteEditor.tsx
git commit -m "feat: suite editor header shows pinned rubric chip"
```

---

### Task 10: Segmented nav sublabels + motion-state

**Objective:** The Suites/Profiles switch teaches the distinction on the active item.

**Files:**
- Modify: `src/workspaces/EvaluationsWorkspace.tsx`
- Modify: `src/workspaces/EvaluationsWorkspace.test.tsx` if it exists

**Step 1: Implement**

Extend `SEG_NAV` entries with `sublabel: "workloads you run"` and `sublabel: "rubrics that score"`. Render the sublabel only under the active item:

```tsx
<span className="flex flex-col items-center leading-tight">
  <span>{label}</span>
  {isActive && (
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
      {sublabel}
    </span>
  )}
</span>
```

Add the `motion-state` class to each NavLink so the active color swap transitions at 150ms (color only — no layout animation, no sliding indicator).

**Step 2: Verify**

Run: `npm run typecheck:web && npx vitest run src/workspaces`
Expected: PASS

**Step 3: Commit**

```bash
git add src/workspaces/EvaluationsWorkspace.tsx
git commit -m "feat: segmented nav teaches suite and profile distinction"
```

---

### Task 11: Empty-state cross-links

**Objective:** First-run users learn the split from both sides.

**Files:**
- Modify: `src/workspaces/evaluations/SuiteList.tsx` (empty state block)
- Modify: `src/workspaces/evaluations/ProfileList.tsx` (empty state block)

**Step 1: Implement**

Suite list empty state, after the existing description paragraph:

```tsx
<p className="max-w-md text-sm text-text-muted">
  Judging rules live in{" "}
  <Link to="/evaluations/profiles" className="text-text-secondary underline decoration-edge-bright underline-offset-2 hover:text-text">Profiles</Link>
  ; suites pin them.
</p>
```

Profile list empty state, mirror:

```tsx
<p className="text-sm text-text-muted">
  <Link to="/evaluations" className="text-text-secondary underline decoration-edge-bright underline-offset-2 hover:text-text">Suites</Link>{" "}
  pin profiles to score their tasks.
</p>
```

**Step 2: Verify**

Run: `npx vitest run src/workspaces/evaluations`
Expected: PASS

**Step 3: Commit**

```bash
git add src/workspaces/evaluations/SuiteList.tsx src/workspaces/evaluations/ProfileList.tsx
git commit -m "feat: evaluation empty states cross-link suites and profiles"
```

---

### Task 12: Archive-confirm stable geometry

**Objective:** The arm-to-confirm swap in suite rows must not shift row width.

**Files:**
- Modify: `src/workspaces/evaluations/SuiteList.tsx`
- Modify: `src/ui/geometry-state-contract.test.ts` (extend)

**Step 1: Implement**

Give the trailing action cluster a fixed min-width that fits the armed pair (measure from the widest armed state: archive-confirm + cancel). Apply `min-w-[92px] justify-end` to the action container so armed and unarmed states occupy identical width. Keep both buttons at their current 44px heights.

**Step 2: Extend the geometry contract test**

Add a source-level assertion to `src/ui/geometry-state-contract.test.ts` that the suite action cluster carries a fixed-width class, following that file's existing static-analysis style.

**Step 3: Verify**

Run: `npx vitest run src/ui/geometry-state-contract.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/workspaces/evaluations/SuiteList.tsx src/ui/geometry-state-contract.test.ts
git commit -m "fix: stable action-cluster width across archive confirm states"
```

---

### Task 13: Extend the motion contract

**Objective:** Guard everything this plan added against motion regressions.

**Files:**
- Modify: `src/ui/motion-contract.test.ts`

**Step 1: Add assertions**

```ts
it("record-row list surfaces do not hover-transform", () => {
  for (const file of ["src/workspaces/evaluations/SuiteList.tsx", "src/workspaces/evaluations/ProfileList.tsx"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/hover:-translate|hover:scale/);
  }
});

it("new identity components use no ease-in, transition-all, or scale(0)", () => {
  for (const file of ["src/ui/KindEyebrow.tsx", "src/ui/ProfileRefChip.tsx"]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).not.toMatch(/transition-all|\bease-in\b(?!-out)|scale\(0\)/);
  }
});
```

**Step 2: Verify**

Run: `npx vitest run src/ui/motion-contract.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/ui/motion-contract.test.ts
git commit -m "test: extend motion contract for identity surfaces"
```

---

### Task 14: Integrated verification and QA evidence

**Objective:** Full gate plus browser evidence across the required matrix.

**Files:**
- Create: `docs/qa/evaluations-identity-ux/README.md`

**Step 1: Full automated gate**

Run: `npm run check`
Expected: PASS (typecheck web + server, all tests, production build)

**Step 2: CDP QA**

Run: `npm run qa:suite-reliability` (with the dev server up per its existing harness contract)
Expected: PASS — no regression in suite surfaces.

Run: `npm run qa:design-motion`
Expected: PASS

**Step 3: Browser matrix**

Capture screenshots or manual verification notes at 1440x1000, 1024x768, 768x1024, 390x844, 200% zoom, and reduced motion. Verify: kind eyebrows legible, chips never overflow, backlinks keyboard-reachable, segmented sublabels wrap gracefully at 390px, archive confirm width stable.

**Step 4: Write the QA report**

`docs/qa/evaluations-identity-ux/README.md`: date, commit, gate results, matrix results, evidence links/paths, and any deviations.

**Step 5: Commit**

```bash
git add docs/qa/evaluations-identity-ux/
git commit -m "docs: evaluations identity UX QA evidence"
```

---

## Final acceptance checklist

- [ ] Suite rows: kind eyebrow, `ready` token, tasks · models summary, rubric chip or holistic chip
- [ ] Profile rows: kind eyebrow, `reusable` token, criteria preview
- [ ] ProfileDetail backlinks via `suitesUsingProfile`, other-version pins surfaced, correct tokens
- [ ] Suite editor header shows pinned rubric chip
- [ ] Segmented nav sublabels on active item with 150ms color-only transition
- [ ] Empty states cross-link both directions
- [ ] Archive-confirm width stable; motion contract extended and green
- [ ] DESIGN.md status table documents `ready` and `reusable`
- [ ] `npm run check` green; both CDP QA scripts green; browser matrix verified

## Execution handoff

Execute task-by-task with a fresh subagent per task; spec-compliance review after each, code-quality review after spec passes. Do not begin before Task 0's baseline is recorded and the in-flight worktree changes are committed.
