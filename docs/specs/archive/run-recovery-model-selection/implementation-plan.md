# Run Recovery and Model Selection Usability Implementation Plan

> **For OMP Agent:** Execute this plan phase-by-phase with TDD. Use the worker for
> implementation and an advisor for spec-compliance and code-quality review after each
> milestone. Do not push without explicit user permission.

**Goal:** Let a failed Judge retry against retained candidate outputs, and repair model
selection across provider switching, narrow layouts, and Gemini's live catalog.

**Architecture:** Extend the existing run controller with a Judge-only recovery entry point
that reuses `runJudge` and retained current-run context. Consolidate provider-tab rendering
for the candidate and Judge selectors, make query clearing explicit, and order/filter Gemini
models in its adapter before the shared catalog reaches the UI. Keep `pipeline.ts`
provider-agnostic and preserve strict blind-judge validation.

**Tech stack:** React 18, TypeScript, Vite 8, Vitest 4, happy-dom, existing reducer/controller
architecture, Tailwind CSS. No new runtime dependency.

**Companion spec:**
`docs/specs/archive/run-recovery-model-selection/run-recovery-model-selection-spec.md`

---

## Repository and concurrency guard

At plan creation:

```text
branch: master
relation: ahead of origin/master by 16 commits
uncommitted:
  server/codex-bridge/responses.ts
  server/tests/responses.test.ts
```

Those two server files contain the existing Codex inactivity-timeout fix and regression.
They are outside this feature's write set.

Before every phase:

```bash
git status --short --branch
git diff -- server/codex-bridge/responses.ts server/tests/responses.test.ts
git diff --check
```

Rules:

- Never reset, restore, overwrite, stage, or amend the two server files.
- Re-read any target file that changes during OMP execution before editing it.
- Stage explicit paths only. Never use `git add .` or `git add -A`.
- Do not modify `src/lib/pipeline.ts` for provider or retry routing.
- Preserve existing 9Router, blind judging, score explanations, export, and partial-failure
  behavior.
- Use placeholder credentials only. Never print environment or local-storage keys.
- No push, merge, rebase, or destructive cleanup without user approval.

## Milestone map

| Phase | Deliverable | Main gate |
|---|---|---|
| 0 | Authority and test baseline confirmed | current targeted tests |
| 1 | Current-run context and Judge-only retry | controller + reducer tests |
| 2 | Actionable Judge error UI | OutputPane component tests |
| 3 | Shared responsive provider chooser | component tests + 390px QA |
| 4 | Correct provider-switch and X behavior | interactive component tests |
| 5 | Current Gemini catalog ordering and full scrolling | provider + selector tests |
| 6 | Authority docs and complete verification | `npm run check` + browser QA |

---

## Phase 0: Lock the baseline and write authority deltas

### Task 0.1: Confirm current behavior and concurrent changes

**Objective:** Establish the exact starting state without touching existing work.

**Files:** Read only.

**Steps:**

1. Run the concurrency-guard commands above.
2. Run existing focused suites:

```bash
npm test -- src/lib/run-controller.test.ts src/studio-engine.test.ts src/ui/OutputPane.test.tsx src/ui/JudgeConfig.test.tsx src/lib/provider-probes.test.ts
```

3. Record the count and any pre-existing failure before adding tests.
4. Inspect the current implementations of:

```text
src/lib/run-controller.ts
src/studio-engine.ts
src/rsemble.tsx
src/ui/OutputPane.tsx
src/ui/ModelList.tsx
src/ui/JudgeConfig.tsx
src/lib/providers/gemini.ts
```

**Expected:** Existing focused tests pass. Only the two protected server files appear as
uncommitted before plan implementation.

### Task 0.2: Update interaction and provider authority

**Objective:** Align authority docs before behavior ships.

**Files:**

- Modify: `UI.md`
- Modify: `PROVIDERS.md`

**Steps:**

1. Add Judge-only retry behavior to the Output error-state section in `UI.md`.
2. State that completed candidates are retained and the full fanout is not repeated.
3. Add provider-switch clearing, context-sensitive X, responsive provider tabs, and
   complete scrollable catalogs to `UI.md` §3.2.
4. Update Gemini discovery in `PROVIDERS.md` with generation-method filtering,
   deterministic recency order, exact-ID preservation, and fallback models.
5. Do not alter the Rank/Fuse product spine or scoring contract.

**Verification:** Read both updated sections and compare them to companion-spec §§5–8.

**Commit after Phase 0:**

```bash
git add UI.md PROVIDERS.md \
  docs/specs/archive/run-recovery-model-selection/run-recovery-model-selection-spec.md \
  docs/specs/archive/run-recovery-model-selection/implementation-plan.md
git commit -m "docs: specify run recovery and model selection fixes"
```

If the user wants OMP to leave all work uncommitted, skip commits but still use explicit
path staging for any later requested commit.

---

## Phase 1: Add retained run context and Judge-only retry

### Task 1.1: Add failing reducer tests for retry-stage state

**Objective:** Prove Judge retry can enter a coherent running state outside normal fanout.

**Files:**

- Test: `src/studio-engine.test.ts`
- Later modify: `src/studio-engine.ts`

**Failing tests:**

1. `FANOUT_START` stores a deep-copied current-run evaluation context.
2. Mutating the command rubric after fanout does not mutate the stored run rubric.
3. `JUDGE_START` sets `running: true` when the previous state is a Judge error.
4. `JUDGE_START` clears `judgeError`, stale report, consensus, and insufficient state.
5. In Fuse mode, retry start clears stale Fusion error and result.
6. `RESET_SESSION` clears the retained run context.
7. A new fanout replaces the previous context.

Add a state type close to:

```ts
export interface RunEvaluationContext {
  prompt: string;
  rubric: RubricCriterion[];
}
```

The `FANOUT_START` action should carry the captured context. Do not store provider secrets or
candidate outputs inside the context.

**Run red:**

```bash
npm test -- src/studio-engine.test.ts
```

**Expected:** New assertions fail because no context exists and `JUDGE_START` does not set
`running` or clear all stale state.

### Task 1.2: Implement the minimal state changes

**Objective:** Make the new reducer tests pass without changing score or provider contracts.

**Files:**

- Modify: `src/studio-engine.ts`
- Modify: `src/lib/run-controller.ts` only where `FANOUT_START` is dispatched

**Implementation requirements:**

- Add `runContext: RunEvaluationContext | null` to `StudioState` and `initialState`.
- Capture `prompt` and a cloned rubric at fanout start.
- Use a real object/array clone so later command edits cannot mutate the snapshot.
- Make `JUDGE_START` usable as a standalone active-stage transition.
- Preserve normal fanout → Judge behavior.
- Clear context on reset; replace it on every new fanout.

**Run green:**

```bash
npm test -- src/studio-engine.test.ts src/lib/run-controller.test.ts
npm run typecheck:web
```

**Expected:** Tests pass; existing fanout behavior remains green.

### Task 1.3: Add failing controller tests for `retryJudge`

**Objective:** Define recovery behavior before adding the controller entry point.

**Files:**

- Test: `src/lib/run-controller.test.ts`
- Later modify: `src/lib/run-controller.ts`

**Test setup:** Start from a state with:

- `running = false`;
- `judgeStatus = "error"`;
- at least two usable completed candidates;
- a retained `runContext`;
- a current critic that differs from the critic used before failure.

**Failing tests:**

1. `retryJudge` calls `chatCompletion` once and `chatCompletionStream` zero times.
2. The Judge prompt uses retained task/rubric context rather than edited command values.
3. The Judge call uses the current critic model/provider.
4. Candidate segments, summaries, timestamps, tokens, provider IDs, and slugs are unchanged.
5. A valid Rank result dispatches `JUDGE_START` then `JUDGE_RESULT`.
6. A valid Judge retry writes one run-history entry, not zero or two.
7. Invalid Judge output dispatches `JUDGE_FAILED`, preserves candidates, and allows another
   call to `retryJudge`.
8. Fuse mode invokes Fusion after valid Judge retry and passes new scores.
9. Fewer than two usable candidates dispatches `INSUFFICIENT_CANDIDATES` and makes no
   Judge call.
10. Missing run context makes no Judge call and surfaces a truthful current-run recovery
    error rather than judging against edited inputs.
11. Abort during Judge retry prevents late `JUDGE_RESULT` and `FUSION_START`.
12. `retryJudge` is a no-op while another stage is running.

Update the test dispatch emulator so `JUDGE_START` mirrors the real reducer's new
`running: true` behavior and retains run context.

**Run red:**

```bash
npm test -- src/lib/run-controller.test.ts
```

**Expected:** New tests fail because `retryJudge` does not exist.

### Task 1.4: Implement `retryJudge` through the existing Judge path

**Objective:** Resume from completed candidates without duplicating orchestration logic.

**Files:**

- Modify: `src/lib/run-controller.ts`

**Required shape:**

```ts
const retryJudge = async (): Promise<void> => {
  const current = stateRef.current;
  // guard running, aborted, context, and candidate eligibility
  // increment epoch
  // compose a Judge seed from frozen prompt/rubric plus current critic/instruction/mode
  // call existing runJudge
  // continue to runFusion in Fuse mode after success
};
```

**Rules:**

- Reuse `isUsableCandidate`, `runJudge`, and `runFusion`.
- Do not call `runFanout`, `retryCandidate`, or any stream provider.
- Do not duplicate blind-label or parse logic.
- Use frozen `prompt`/`rubric`; use current `critic`, `judgeInstruction`, and `mode`.
- Increment the run epoch and use the shared abort-controller set.
- Missing context must dispatch a specific Judge failure message explaining that a full
  rerun is required; do not silently fall back to current command inputs.
- Return `retryJudge` from `createRunController`.

**Run green:**

```bash
npm test -- src/lib/run-controller.test.ts src/studio-engine.test.ts
npm run typecheck:web
```

**Expected:** All new recovery tests pass with zero candidate stream calls.

**Commit after Phase 1:**

```bash
git add src/studio-engine.ts src/studio-engine.test.ts \
  src/lib/run-controller.ts src/lib/run-controller.test.ts
git commit -m "feat: retry failed judge with retained candidates"
```

---

## Phase 2: Add the actionable Judge error UI

### Task 2.1: Add failing OutputPane tests

**Objective:** Ensure the user can discover and invoke Judge-only recovery.

**Files:**

- Test: `src/ui/OutputPane.test.tsx`
- Later modify: `src/ui/OutputPane.tsx`
- Later modify: `src/rsemble.tsx`

**Failing tests:**

1. Judge error plus two usable candidates renders `Retry Judge`.
2. Helper text says completed candidates are reused.
3. The button has `aria-label="Retry Judge using completed candidates"` and a 44px target.
4. The button invokes `onRetryJudge` once.
5. Candidate-generation retry buttons are not presented for successful candidates.
6. Fewer than two usable candidates does not offer Judge retry.
7. A Fusion-only error does not mislabel the action as Judge retry.
8. Running/aborted states do not offer the action.

Use the repository's existing `react-dom/client` and `act` patterns. Do not add a testing
library dependency solely for these interactions.

**Run red:**

```bash
npm test -- src/ui/OutputPane.test.tsx
```

### Task 2.2: Wire the recovery action

**Objective:** Connect the error-state button to the controller.

**Files:**

- Modify: `src/ui/OutputPane.tsx`
- Modify: `src/rsemble.tsx`

**Steps:**

1. Add `onRetryJudge?: () => void` to `OutputPane`.
2. Pass Judge eligibility and callback into `ErrorState`.
3. Render the primary action and helper copy only for Judge failures with at least two
   usable candidates.
4. Keep existing candidate error details and per-candidate retry behavior intact.
5. Destructure `retryJudge` from the run controller in `rsemble.tsx` and pass a safe callback
   to `OutputPane`.
6. Do not make the normal command-pane run button call Judge-only retry.

**Run green:**

```bash
npm test -- src/ui/OutputPane.test.tsx src/ui/usable-candidate.test.tsx src/lib/run-controller.test.ts
npm run typecheck:web
```

**Commit after Phase 2:**

```bash
git add src/ui/OutputPane.tsx src/ui/OutputPane.test.tsx src/rsemble.tsx
git commit -m "feat: expose judge-only retry in output errors"
```

---

## Phase 3: Consolidate and repair responsive provider tabs

### Task 3.1: Add failing shared-provider-tab tests

**Objective:** Define one responsive provider source for both selectors.

**Files:**

- Create: `src/ui/ProviderTabs.test.tsx`
- Later create: `src/ui/ProviderTabs.tsx`
- Later modify: `src/ui/ModelList.tsx`
- Later modify: `src/ui/JudgeConfig.tsx`

**Failing tests:**

1. The shared provider list contains all registered provider IDs exactly once.
2. 9Router is present and accessible.
3. Each button is at least 44px high.
4. Active state is exposed with `aria-selected`, `aria-pressed`, or the appropriate tab
   semantics.
5. The container uses a wrapping grid/flex contract rather than one non-wrapping flex row.
6. Candidate and Judge selectors both render the shared component instead of private arrays.

Recommended API:

```ts
export const MODEL_PICKER_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter" },
  // ...
] as const;

export function ProviderTabs(props: {
  value: ProviderId;
  onChange: (providerId: ProviderId) => void;
  ariaLabel: string;
}): JSX.Element;
```

The exact semantic role may be `tablist`/`tab` if keyboard behavior is fully implemented,
or a labelled group of pressed buttons. Do not claim tab semantics without the associated
keyboard behavior.

**Run red:**

```bash
npm test -- src/ui/ProviderTabs.test.tsx src/ui/JudgeConfig.test.tsx
```

### Task 3.2: Implement the shared responsive provider chooser

**Objective:** Keep all providers inside the panel without duplicating metadata.

**Files:**

- Create: `src/ui/ProviderTabs.tsx`
- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/JudgeConfig.tsx`

**Implementation guidance:**

- Prefer a wrapping CSS grid such as an auto-fit/minmax layout.
- Preserve 44px height and readable labels.
- Replace both inline provider arrays and label maps where practical.
- Keep provider display labels in one UI source; do not modify `ProviderId` or registry
  behavior.
- Ensure focus styling is visible on all rows.

**Run green:**

```bash
npm test -- src/ui/ProviderTabs.test.tsx src/ui/JudgeConfig.test.tsx
npm run typecheck:web
```

### Task 3.3: Browser-check narrow layouts

**Objective:** Verify real layout behavior that happy-dom cannot measure.

**Steps:**

1. Start `npm run dev` without terminating unrelated processes.
2. Open the candidate selector at 390px viewport width.
3. Confirm all providers, including 9Router, are inside the panel.
4. Open the Judge selector and repeat.
5. At desktop width, drag the command pane to its minimum and repeat.
6. Tab through every provider; verify focus remains visible and no page-level horizontal
   scrollbar appears.
7. Save screenshots or exact observations for OMP review.

**Commit after Phase 3:**

```bash
git add src/ui/ProviderTabs.tsx src/ui/ProviderTabs.test.tsx \
  src/ui/ModelList.tsx src/ui/JudgeConfig.tsx src/ui/JudgeConfig.test.tsx
git commit -m "fix: keep provider selectors responsive"
```

---

## Phase 4: Fix provider switching and clear-X semantics

### Task 4.1: Add interactive selector regression tests

**Objective:** Reproduce the user's cross-provider stale-input workflow.

**Files:**

- Create: `src/ui/ModelList.test.tsx`
- Modify: `src/ui/JudgeConfig.test.tsx`

**Candidate-selector tests:**

1. Open Add Model.
2. Enter an OpenRouter slug.
3. Click Gemini.
4. Assert the input is empty and focused.
5. Enter a Gemini ID and click X.
6. Assert the input clears while the selector remains open.
7. Click X again and assert the selector closes.
8. Verify no slot is added during clear/cancel.

**Judge-selector tests:**

1. A Gemini critic opens with Gemini active, not OpenRouter.
2. Switching to another provider clears the current query and focuses the input.
3. X clears a non-empty query without dispatching `SET_CRITIC` or closing.
4. X on an empty query closes the editor.
5. Committing a catalog/manual model dispatches exactly one `SET_CRITIC` with the selected
   provider and exact slug.

**Run red:**

```bash
npm test -- src/ui/ModelList.test.tsx src/ui/JudgeConfig.test.tsx
```

### Task 4.2: Implement query and clear behavior

**Objective:** Make provider switching feel intentional and avoid manual backspacing.

**Files:**

- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/JudgeConfig.tsx`

**Implementation requirements:**

- Add one provider-change handler per selector that clears `query`, changes provider, and
  focuses on the next animation frame.
- Pass `critic.providerId` into the Judge combobox as its initial provider.
- Add one clear-or-cancel handler per selector.
- Use context-sensitive `aria-label` values from companion-spec §6.2.
- Keep Escape behavior unchanged unless a failing accessibility test requires alignment.
- Do not persist uncommitted query drafts in preferences.

**Run green:**

```bash
npm test -- src/ui/ModelList.test.tsx src/ui/JudgeConfig.test.tsx src/ui/ProviderTabs.test.tsx
npm run typecheck:web
```

**Commit after Phase 4:**

```bash
git add src/ui/ModelList.tsx src/ui/ModelList.test.tsx \
  src/ui/JudgeConfig.tsx src/ui/JudgeConfig.test.tsx
git commit -m "fix: clear model input across providers"
```

---

## Phase 5: Modernize Gemini discovery and remove catalog truncation

### Task 5.1: Add failing Gemini catalog tests

**Objective:** Reproduce old-first and non-generation catalog behavior.

**Files:**

- Create: `src/lib/providers/gemini.test.ts`
- Later modify: `src/lib/providers/gemini.ts`

**Fixture:** Mock a successful `ListModels` response containing an intentionally mixed
order:

```text
gemini-2.0-flash
gemini-3.1-pro-preview
text-embedding-004
gemini-flash-latest
gemini-2.5-pro
gemini-3.6-flash
```

Include `supportedGenerationMethods` values that distinguish `generateContent` from
embedding-only records.

**Failing tests:**

1. `gemini-flash-latest` sorts before explicit versions.
2. Gemini 3.6 and 3.1 sort before Gemini 2.5 and 2.0.
3. Non-generation records are excluded.
4. Exact IDs are preserved without `models/` prefix.
5. Duplicate IDs are rendered once.
6. Tie ordering is deterministic.
7. No-key, empty-list, and recoverable failure paths return the same current fallback
   ordering.
8. Abort behavior remains distinguishable from an ordinary catalog failure.

Use placeholder fixture keys only and assert that no key is logged.

**Run red:**

```bash
npm test -- src/lib/providers/gemini.test.ts
```

### Task 5.2: Implement Gemini normalization and ordering

**Objective:** Put current chat models first without hiding older valid models.

**Files:**

- Modify: `src/lib/providers/gemini.ts`

**Suggested helpers:**

```ts
const GEMINI_FALLBACK_MODELS: CatalogModel[] = [/* current Gemini 3 entries */];

function supportsGenerateContent(item: GeminiModelRecord): boolean;
function compareGeminiModelIds(a: string, b: string): number;
function normalizeGeminiCatalog(items: unknown[]): CatalogModel[];
```

**Rules:**

- Normalize `models/<id>` to `<id>` exactly once.
- Filter by Gemini ID and generation capability.
- Deduplicate exact IDs; first metadata occurrence may supply the display name.
- Sort aliases, then numeric version descending, then deterministic ID.
- Return cloned fallback arrays so callers cannot mutate the module constant.
- Preserve normal abort semantics rather than swallowing abort into fallback if current
  provider conventions require propagation.

**Run green:**

```bash
npm test -- src/lib/providers/gemini.test.ts src/lib/provider-probes.test.ts
npm run typecheck:web
```

### Task 5.3: Add failing selector tests for complete catalogs

**Objective:** Prove the UI no longer creates a false eight-model limit.

**Files:**

- Modify: `src/ui/ModelList.test.tsx`
- Modify: `src/ui/JudgeConfig.test.tsx`

**Tests:**

1. Supply at least 12 Gemini catalog entries.
2. Open Gemini with an empty query.
3. Assert the first item is the newest ordered entry supplied by the adapter.
4. Assert item 9 and item 12 exist in the scrollable list.
5. Search for a model near the bottom and assert it remains selectable.
6. Confirm the list keeps its bounded-height overflow class.
7. Confirm a nonmatching manual slug can still be committed exactly.

**Run red:**

```bash
npm test -- src/ui/ModelList.test.tsx src/ui/JudgeConfig.test.tsx
```

### Task 5.4: Remove the artificial result cap

**Objective:** Make the bounded list actually scroll through the complete provider catalog.

**Files:**

- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/JudgeConfig.tsx`

**Implementation requirements:**

- Remove `.slice(0, 8)` from empty and filtered result paths.
- Retain provider-scoped filtering and `max-h-48 overflow-y-auto`.
- Do not add a silent replacement cap.
- Keep exact-slug manual entry and duplicate-slot protection.

**Run green:**

```bash
npm test -- src/lib/providers/gemini.test.ts src/ui/ModelList.test.tsx src/ui/JudgeConfig.test.tsx
npm run typecheck:web
```

**Commit after Phase 5:**

```bash
git add src/lib/providers/gemini.ts src/lib/providers/gemini.test.ts \
  src/ui/ModelList.tsx src/ui/ModelList.test.tsx \
  src/ui/JudgeConfig.tsx src/ui/JudgeConfig.test.tsx
git commit -m "fix: surface current gemini catalog models"
```

---

## Phase 6: Full verification and OMP review

### Task 6.1: Run focused regression gate

```bash
npm test -- \
  src/lib/run-controller.test.ts \
  src/studio-engine.test.ts \
  src/ui/OutputPane.test.tsx \
  src/ui/ModelList.test.tsx \
  src/ui/JudgeConfig.test.tsx \
  src/ui/ProviderTabs.test.tsx \
  src/lib/providers/gemini.test.ts \
  src/lib/provider-probes.test.ts
```

Expected: all focused tests pass.

### Task 6.2: Run complete project gate

```bash
npm run check
git diff --check
git status --short --branch
```

Expected:

- web typecheck passes;
- server typecheck passes;
- complete Vitest suite passes;
- production build passes;
- no whitespace errors;
- protected Codex timeout files still show only their pre-existing changes unless the user
  separately asks to commit them.

### Task 6.3: Perform real browser QA

Test both candidate and Judge selectors at:

- 390px mobile viewport;
- tablet stacked layout;
- desktop with command pane dragged to minimum;
- normal wide desktop.

Manual scenarios:

1. Type an OpenRouter slug, switch to Gemini, and confirm immediate clearing/focus.
2. Type a Gemini slug, click X, and confirm clear-not-close; click X again to close.
3. Verify 9Router remains inside both provider panels at narrow widths.
4. With a live Gemini catalog, verify current Gemini 3 entries appear before 2.x and that
   more than eight models are scrollable.
5. Induce or mock a Judge failure after successful fanout, change Judge model, click Retry
   Judge, and verify candidate transcripts do not restart or change.
6. In Fuse mode, verify successful Judge retry proceeds to Fusion.
7. Abort a retry and verify no late result appears.

Capture screenshots or exact browser observations in the OMP completion report. Do not
include keys or request Authorization values.

### Task 6.4: Advisor review

The OMP advisor must review, in this order:

1. **Spec compliance**
   - every acceptance criterion in companion-spec §10;
   - no candidate regeneration on Judge retry;
   - original prompt/rubric context retained;
   - current critic and instruction allowed on retry;
   - strict blind parsing unchanged;
   - no provider tab overflow;
   - no eight-item catalog limit;
   - current Gemini entries ordered before legacy entries.

2. **Code quality**
   - no duplicate Judge pipeline;
   - no duplicate provider arrays;
   - no unnecessary runtime dependency;
   - no state mutation or stale closure hazard;
   - abort and epoch handling is correct;
   - tests verify behavior rather than implementation trivia;
   - exact provider IDs remain opaque.

3. **Concurrent-change safety**
   - inspect the protected server-file diff;
   - inspect staged paths explicitly;
   - ensure no existing 9Router or judge-explainability behavior regressed.

Any failed review item returns to the worker with a focused remediation request and a new
red/green test where appropriate.

### Task 6.5: Final commit, only if requested

If commits were made per phase, no squash is required. If the user requests one final docs or
cleanup commit, stage explicit feature paths only.

Never run:

```bash
git add .
git add -A
git push
```

without a separate explicit instruction for the push.

## OMP handoff summary

Implement four user-observed failures as one cohesive reliability/usability change:

1. Judge-only retry over retained candidates.
2. Provider-switch query reset and clear-first X behavior.
3. Shared responsive provider tabs that keep 9Router in bounds.
4. Current, complete, generation-capable Gemini catalog discovery.

Follow TDD phase-by-phase, preserve the two uncommitted Codex timeout files, keep
`pipeline.ts` provider-agnostic, and return test plus browser evidence rather than a prose-only
completion claim.
