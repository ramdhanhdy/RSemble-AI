# Run Recovery and Model Selection Usability Specification

> Feature area: recover a failed Judge stage without regenerating completed candidates,
> and make candidate/judge model selection usable across providers and narrow layouts.
> Authority: subordinate to `PRODUCT.md`, `PROVIDERS.md`, `UI.md`, and `DECISIONS.md`.
> Status: implementation-ready description for an OMP worker and advisor.

---

## 1. Problem statement

Four related usability failures interrupt the core RSemble workflow.

### 1.1 Judge failure discards expensive progress from the user's perspective

A run may successfully finish every candidate generation and then fail during the single
Judge call because of a provider error, invalid judge output, timeout, or temporary service
failure. Candidate outputs remain in state, but the UI offers no Judge-only retry. The user
must press the normal run action, causing all reference models to generate again before the
Judge gets another attempt.

This wastes time, tokens, provider quota, and completed work. It also changes the candidate
sample, so the resumed judgment is no longer evaluating the exact outputs that failed to be
judged.

### 1.2 Model-selector input leaks across provider tabs

The candidate and Judge selectors each keep one `query` string while the user switches
provider tabs. A slug typed under one provider therefore appears under the next provider,
even though provider-native IDs are different namespaces.

The input's X icon closes the entire editor instead of clearing the entered text. The user
must manually select and erase the old slug before entering the new provider's model ID.

### 1.3 Provider tabs overflow narrow containers

Both selectors render seven providers in one non-wrapping flex row. `9Router`, added last,
is the rightmost tab and can extend outside the command pane or mobile viewport when the
window or resizable command pane is narrow.

### 1.4 Gemini catalog discovery favors old entries and silently truncates the list

Gemini's live `ListModels` response is accepted in upstream order. The selectors display
only the first eight catalog entries. When Google's response starts with older Gemini 2.x
models, newer generation-capable models are below the artificial cutoff and cannot be
reached by scrolling.

The no-key/error fallback already contains newer models, but a successful live response can
produce a worse picker than the fallback because it is neither filtered nor ordered for
recency.

## 2. Goals

1. Add a visible **Retry Judge** action after a Judge failure.
2. Reuse the exact completed candidate outputs; do not call candidate providers again.
3. Permit the user to correct the selected Judge provider/model before retrying.
4. Preserve the original run's task and rubric context for Judge retry.
5. In Fuse mode, continue automatically to Fusion after a successful Judge retry.
6. Clear model-search text when switching provider tabs.
7. Make the input X clear text before it closes the selector.
8. Keep every registered provider tab inside the selector at narrow widths.
9. Show current, generation-capable Gemini models before legacy models.
10. Remove the invisible eight-result catalog cutoff while retaining bounded scrolling.
11. Apply the selector behavior consistently to candidate and Judge model selection.
12. Preserve manual provider-native slug entry, including opaque 9Router IDs.

## 3. Non-goals

| Out of scope | Reason |
|---|---|
| Persisting an interrupted run across browser reload or application restart | This phase recovers the current in-memory run only. |
| Retrying one malformed Judge response automatically in a loop | User-controlled retry avoids hidden spend and repeated bad calls. |
| Reusing partial Judge output | The strict Judge contract accepts a complete valid result or fails visibly. |
| Changing the Judge schema, score scale, rubric design, or blind-evaluation contract | Separate evaluation-research work remains outside the product for now. |
| Caching candidate outputs outside current run state | Existing state already retains completed candidates. |
| Reordering or normalizing opaque manual model IDs | Provider-native IDs must round-trip unchanged. |
| Adding a new top-level mode, settings panel, or provider-specific workflow | Rank/Fuse remains the product spine. |
| Automatically selecting a Gemini model for the user | Catalog ordering improves discovery; the user still commits the model. |
| Hiding legacy Gemini models | Older generation-capable models remain searchable and selectable. |
| Virtualizing model lists in this phase | The local catalog sizes do not justify a new dependency yet. |

## 4. Current implementation diagnosis

### 4.1 Judge recovery seam

- `src/lib/run-controller.ts` retains usable candidates after `JUDGE_FAILED` but has no
  current-run Judge-only trigger.
- `runJudge(done, seed, epoch)` already accepts completed candidates and does not require
  fanout, so recovery should reuse this path rather than duplicate Judge logic.
- `src/studio-engine.ts` makes `JUDGE_FAILED` terminal and correctly preserves candidates.
- `src/ui/OutputPane.tsx` renders `ErrorState` for Judge failures but only exposes
  per-candidate retry actions.
- `src/rsemble.tsx` wires `retryCandidate` and `triggerFusion`; no `retryJudge` callback is
  wired into the output pane.

### 4.2 Selector state seam

- `src/ui/ModelList.tsx::AddModelCombobox` stores one `query` and changes only
  `selectedProvider` on a provider-tab click.
- Its X button calls `onCancel` unconditionally.
- `src/ui/JudgeConfig.tsx::JudgeCombobox` has the same behavior and additionally initializes
  the selected provider to OpenRouter even when the current Judge uses another provider.

### 4.3 Responsive provider seam

- Both selectors duplicate the same seven-provider array and use one non-wrapping `flex`
  row with `flex-1` buttons.
- The duplicated arrays can drift as more providers are registered.

### 4.4 Gemini catalog seam

- `src/lib/providers/gemini.ts::listModels` maps every `gemini*` item in upstream order.
- `supportedGenerationMethods` is read but not used, so non-generation model records can
  enter the picker.
- `ModelList.tsx` and `JudgeConfig.tsx` both call `.slice(0, 8)` for empty and filtered
  searches, even though their list container has vertical overflow.

## 5. Judge-stage recovery behavior

### 5.1 Availability

Show **Retry Judge** only when all are true:

- `judgeStatus === "error"`;
- the current run is not already running;
- at least two candidates satisfy `isUsableCandidate`;
- the run was not explicitly aborted;
- the current in-memory run context is available.

A Judge failure does not mark successful candidates as failed.

If fewer than two candidates are usable, retain the existing insufficient-candidates flow
and per-candidate retry behavior instead of offering Judge retry.

### 5.2 Retained inputs

The normal fanout start must capture a current-run evaluation context containing a deep copy
of:

```ts
interface RunEvaluationContext {
  prompt: string;
  rubric: RubricCriterion[];
}
```

Judge retry uses:

- retained `prompt` and `rubric` from the run context;
- retained completed candidate texts from `state.candidates`;
- the **current** `state.critic`, so the user can fix or replace the failed Judge model;
- the **current** `state.judgeInstruction`, because it is Judge-stage configuration and
  changing it does not regenerate candidate answers;
- the **current** Rank/Fuse mode.

The snapshot prevents an edited command prompt or rubric from silently judging old answers
against new generation context. The context is current-session state only and is cleared on
reset or a new fanout.

### 5.3 Retry execution

The retry action performs:

```text
retained usable candidates
        ↓
new blind candidate set for this Judge attempt
        ↓
current Judge provider/model
        ↓
strict parseJudge validation
        ↓
Rank result OR Fusion continuation
```

It must not:

- call any `chatCompletionStream` candidate path;
- replace candidate text, timestamps, token counts, or provider identity;
- regenerate failed candidates;
- accept partial or malformed Judge output;
- reuse a partially parsed previous Judge report;
- record a run-history winner until a valid Judge result exists.

Each retry is a new blind Judge attempt. Its label mapping must remain stable within that
attempt and is revealed only after a valid result. No mapping from a failed partial response
is exposed.

### 5.4 State lifecycle

When Judge retry starts:

- `running = true`;
- `judgeStatus = "running"`;
- clear `judgeError`;
- clear stale `judgeReport` and consensus;
- clear `insufficient`;
- in Fuse mode, clear stale Fusion error/result before the new Judge attempt.

On retry success in Rank mode:

- store the valid Judge result and report;
- set `running = false`;
- render the Rank result;
- add exactly one successful run-history entry.

On retry success in Fuse mode:

- retain `running = true` through `JUDGE_RESULT`;
- automatically invoke Fusion with the retained usable candidates and new scores;
- terminate only after `FUSION_RESULT` or `FUSION_FAILED`.

On repeated Judge failure:

- retain candidate outputs again;
- show the new error;
- keep **Retry Judge** available;
- do not add run-history telemetry.

### 5.5 UI copy and controls

The Judge error state should say that candidate generation succeeded and the Judge failed.
It must not imply that all models need to run again.

Primary action:

```text
Retry Judge
```

Helper copy:

```text
Reuses the completed candidate outputs. You can change the Judge model first.
```

The normal command-pane **Re-run** action remains available as the deliberate full-pipeline
restart.

The button must:

- meet the existing 44px touch target;
- have `aria-label="Retry Judge using completed candidates"`;
- be disabled while any stage is active;
- show the existing running pipeline UI after activation.

## 6. Provider-switch and clear-input behavior

### 6.1 Provider switch

In both candidate and Judge selectors, choosing a different provider must:

1. update the active provider;
2. clear the query immediately;
3. focus the model input;
4. display the new provider's catalog from its first ordered item;
5. recompute manual-slug validity under the new provider rules.

Text typed for OpenRouter, Gemini, or any other provider must not carry into another
provider tab.

For Judge editing, the initial provider tab must match `critic.providerId`; it must not
always open on OpenRouter.

### 6.2 X button

The X button is context-sensitive:

- when `query` is non-empty, clear the text and retain the open selector;
- when `query` is empty, close/cancel the selector.

After clearing, focus returns to the input.

Accessible labels must reflect the action:

- non-empty: `Clear model search` or `Clear judge model search`;
- empty: `Cancel add model` or `Cancel judge edit`.

`Escape` may retain the existing close/cancel behavior. The X behavior must not be hidden
behind hover or pointer-only interaction.

### 6.3 Commit behavior

- Selecting a catalog item still commits immediately.
- Pressing Enter still commits a valid manual slug.
- Provider-specific validation remains unchanged except where the existing 9Router contract
  already accepts any opaque non-empty ID.
- Clearing or switching providers never mutates already registered model slots or the
  current Judge until a new model is committed.

## 7. Responsive provider chooser

Create one shared provider-tab component or shared provider metadata source used by both
selectors. It must include every registered provider exactly once in registry-approved
order.

Required behavior:

- all seven current tabs remain inside the chooser at 390px viewport width;
- tabs remain inside the resizable command pane at its minimum supported width;
- no page-level horizontal overflow;
- no label clipping that makes providers indistinguishable;
- every target remains at least 44px high;
- the active tab remains visually and programmatically identifiable;
- keyboard focus rings remain visible;
- adding a future provider does not require copying arrays into both selectors.

Preferred layout: a wrapping responsive grid with a sensible minimum button width. A
horizontal scrolling tab rail is acceptable only if browser QA shows every provider is
discoverable and focus-scrolling works. Compressing all providers into one unreadable row is
not acceptable.

## 8. Gemini catalog behavior

### 8.1 Generation-capable models only

A live Gemini model is selectable when:

- its normalized ID begins with `gemini`;
- and `supportedGenerationMethods` is absent or includes `generateContent`.

Embedding-only or other non-generation records must not appear in candidate or Judge
catalogs.

### 8.2 Deterministic recency ordering

Gemini catalog order must be deterministic and optimized for current chat-model discovery:

1. explicit `-latest` aliases;
2. explicit numeric Gemini generations in descending major/minor version order;
3. unversioned or legacy Gemini IDs;
4. deterministic case-insensitive ID tie-break.

Stability/capability suffixes such as `pro`, `flash`, `flash-lite`, `preview`, and
`experimental` may break ties but must not place Gemini 2.x ahead of Gemini 3.x.

The exact provider-native ID is preserved. Ordering must not rewrite model IDs.

### 8.3 Fallback catalog

Use one exported or module-level fallback constant for no-key, empty-response, and
recoverable catalog-failure paths. As of this specification it starts with current Gemini 3
models, including:

- `gemini-3.6-flash`;
- `gemini-3.1-pro-preview`;
- `gemini-3.1-flash-lite`.

The fallback is not a substitute for the live catalog when the live request succeeds.

### 8.4 Scrolling and result visibility

Remove the silent `.slice(0, 8)` truncation from both selectors.

- The existing bounded-height list remains vertically scrollable.
- An empty query displays the complete ordered catalog for the selected provider.
- A non-empty query displays every matching item from that provider.
- Manual raw-slug entry remains available even when no match exists.
- Duplicate exact provider/model IDs render once.

If later catalog size creates measured rendering problems, virtualization or explicit
pagination requires a separate change. Reintroducing an unexplained cutoff is not allowed.

## 9. Error handling and safety

- Judge retry uses the same provider adapter, abort propagation, and strict parser as the
  original Judge attempt.
- A user abort during Judge retry invalidates the epoch and prevents late result/fusion
  dispatches.
- Provider/model edits do not expose credentials or alter bridge routes.
- Gemini catalog tests and fixtures use placeholder keys only.
- No real API key, Authorization header, provider token, or environment secret may enter
  docs, tests, logs, snapshots, or commits.
- `src/lib/pipeline.ts` remains provider-agnostic.
- Existing 9Router route allowlisting, SSRF prevention, redirect rejection, origin checks,
  body limits, and safe logging remain unchanged.

## 10. Acceptance criteria

### Judge recovery

- [ ] A Judge failure after three successful candidates shows **Retry Judge**.
- [ ] Clicking it makes one Judge completion call and zero candidate stream calls.
- [ ] Candidate text and metadata are byte-for-byte unchanged by Judge retry.
- [ ] Changing the Judge provider/model before retry uses the new Judge.
- [ ] Original task/rubric context is used even if command inputs were edited afterward.
- [ ] Rank retry success renders the ranking and records one successful history entry.
- [ ] Fuse retry success automatically proceeds to Fusion.
- [ ] Repeated Judge failure preserves candidates and allows another retry.
- [ ] Abort during retry prevents late Judge and Fusion results.

### Selector behavior

- [ ] Switching providers clears the model query in both selectors.
- [ ] Judge editing opens on the current Judge provider.
- [ ] X clears a non-empty query without closing the selector.
- [ ] X closes the selector only when the query is already empty.
- [ ] Input focus returns after clear or provider switch.
- [ ] Existing committed slots and Judge settings remain unchanged until commit.

### Responsive provider panel

- [ ] All current providers are visible and usable at 390px.
- [ ] All remain within the minimum-width resizable command pane.
- [ ] 9Router no longer extends outside the viewport or pane.
- [ ] Candidate and Judge selectors share one provider-order source.

### Gemini catalog

- [ ] An unsorted live response places Gemini 3.x before Gemini 2.x.
- [ ] `-latest` aliases appear before explicit older versions.
- [ ] Non-generation Gemini records are filtered.
- [ ] All catalog items can be reached by scrolling; no eight-item cutoff remains.
- [ ] Search can return every matching item.
- [ ] Manual slugs are preserved exactly.
- [ ] No-key and failed-list fallbacks start with current Gemini 3 models.

## 11. Required tests

### Controller and state

- Judge-only retry uses retained candidates and never invokes fanout.
- Judge retry uses current critic but frozen prompt/rubric context.
- Rank and Fuse continuation behavior.
- repeated failure and abort safety.
- no history write before valid Judge output.
- `JUDGE_START` creates a coherent active-stage state when called outside fanout.
- reset/new fanout context lifecycle.

### UI

- Judge error renders the retry action only when eligible.
- retry callback receives no candidate-regeneration instruction.
- clear-X behavior for candidate and Judge selectors.
- provider switch clears and refocuses.
- current Judge provider is initially active.
- shared provider chooser renders all providers with responsive classes and accessibility.

### Gemini

- sorting across 2.x, 3.x, aliases, preview, and malformed IDs.
- generation-method filtering.
- exact ID preservation and deduplication.
- fallback behavior.
- abort behavior remains unchanged.

## 12. Authority-document updates

Before implementation is considered complete:

- Update `UI.md` §3.2 with provider-switch, clear-X, responsive tabs, and full-catalog
  scrolling behavior.
- Update `UI.md` around the Output error state with Judge-only retry and retained-candidate
  semantics.
- Update `PROVIDERS.md` Gemini catalog notes to describe generation-method filtering,
  deterministic recency ordering, and current fallback behavior.
- Do not update `PRODUCT.md` or add an architectural decision unless implementation reveals
  a conflict with the existing fanout → Judge → Rank/Fuse spine. This feature repairs that
  spine rather than changing it.

## 13. OMP completion evidence

The worker must leave:

- focused red/green test evidence for each behavior group;
- full `npm run check` output;
- `git diff --check` output;
- browser screenshots or recorded observations at 390px and minimum command-pane width;
- a statement that candidate providers were not called during Judge retry;
- a statement that the two pre-existing Codex timeout files were not overwritten or staged;
- no push without explicit user permission.
