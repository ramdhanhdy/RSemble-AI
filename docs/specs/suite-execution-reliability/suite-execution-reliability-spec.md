# Suite Execution Reliability and Recovery Specification

**Status:** Ready for implementation
**Date:** 2026-08-02
**Product:** RSemble AI
**Scope:** Model preflight, 9Router stream compatibility, experiment recovery, result semantics, and large-suite task surfaces

## 1. Summary

RSemble must make an evaluation run trustworthy before, during, and after execution.

The current provider connection check can report a provider as reachable even when a selected model route is unusable. A real PulseFit experiment demonstrated the gap: five 9Router routes returned HTTP 200 and streamed content, but omitted the OpenAI `[DONE]` sentinel. RSemble rejected every response as incomplete. One 9Router route emitted `[DONE]` and worked.

The same experiment exposed three recovery and presentation problems:

1. The terminal results page crowned the complete-coverage winner while the Standings list labeled a higher incomplete mean as `#1`.
2. Retry support existed only on the progress surface and operated at whole-task granularity.
3. The progress list used content-sized rows and rendered every attempt inline, which produced uneven widths and would become unwieldy for large suites.

This specification resolves those problems as one reliability program:

- Preserve cheap provider-level connection checks.
- Add opt-in model-level live preflight using the exact selected model route.
- Normalize clean 9Router stream endings at the 9Router bridge boundary only.
- Distinguish complete-coverage winners from provisional score leaders.
- Add recovery actions to terminal results.
- Support missing-cell repair without repaying successful candidate calls.
- Replace unbounded attempt rows with a scalable task ledger and bounded matrix pages.

## 2. Authority and evidence

This specification is subordinate to:

- `PRODUCT.md`
- `DESIGN.md`
- `UI.md`
- `docs/specs/evaluation-workspaces/evaluation-workspaces-spec.md`
- `docs/specs/design-motion-refinement/design-motion-refinement-spec.md`

Evidence behind the work:

| Observation | Verified evidence | Product implication |
| --- | --- | --- |
| Provider connectivity did not predict route compatibility | Five selected 9Router models returned HTTP 200 and content but no `[DONE]`; OCG DeepSeek returned `[DONE]` | Test exact model routes before expensive suites |
| Five models failed all 15 tasks | Persisted experiment attempts reported `no [DONE] sentinel` | Normalize 9Router clean EOF without weakening every provider |
| OCG had a higher mean but 14/15 coverage | Persisted aggregation and screenshot | Keep complete-coverage eligibility, explain it honestly |
| Umans won at 15/15 | Aggregation code and regression test | Winner calculation is correct by current policy |
| Standings labeled OCG `#1` | `ExperimentResults.tsx` sorts all models by mean | Remove contradictory rank semantics |
| Retry existed but was not available in terminal results | `ExperimentProgress.tsx` and `ExperimentResults.tsx` | Put recovery where the user discovers missing evidence |
| Progress bars had unequal widths | `RecordRow` visual surface lacked a width/flex contract | Make ledger rows full width with stable columns |
| Every task and attempt rendered expanded | `ExperimentProgress.tsx` nested maps | Show one current row per task and disclose history |

## 3. Product character

RSemble is an industrial evaluation workbench, not a decorative dashboard.

Reliability information should feel like instrumentation:

- explicit state text;
- stable columns;
- compact tabular numerals;
- direct evidence links;
- restrained semantic color;
- no score heatmaps;
- no celebratory motion;
- no animated sorting, filtering, ranking, or result repair.

Actions must remain physically obvious. Status must never depend on color alone.

## 4. Goals

1. Detect model-route failures before a user launches a large paid suite.
2. Accept valid 9Router streams that end cleanly without `[DONE]` while preserving strict truncation detection elsewhere.
3. Make winner eligibility and score ordering non-contradictory.
4. Let users recover missing experiment evidence from terminal results.
5. Avoid rerunning successful candidate calls when only selected model-task cells are missing.
6. Preserve immutable run evidence and fresh blind judging during repair.
7. Keep task progress and results usable at 100 to 500 tasks and multiple attempts per task.
8. Maintain existing accessibility, execution lease, persistence, and protocol-fingerprint invariants.

## 5. Non-goals

- Changing the complete-coverage winner rule.
- Treating missing scores as zero.
- Splicing old Judge scores across attempts.
- Hiding provider or model failures.
- Automatically testing every model while the user types.
- Automatically removing failed models from a suite roster.
- Persisting credentials or raw authorization headers.
- Adding Framer Motion or another animation runtime.
- Adding score-magnitude color.
- Replacing the result matrix with KPI cards.
- Introducing a distributed job queue or cloud execution service.
- Retrying across a different suite version, task prompt, judge, profile, or protocol fingerprint.

## 6. Current-state diagnosis

### 6.1 Provider readiness is broader than model readiness

`ConnectionsModal` calls each provider's `readiness()` and optional `testConnection()`. These checks validate credentials, bridge availability, or model catalog access. They do not execute the exact selected model route.

A green provider badge means the transport boundary is reachable. It does not mean every catalog entry or raw slug can complete a streamed generation.

### 6.2 Shared SSE strictness conflicts with 9Router upstream diversity

`readSseChatStream` requires `[DONE]`. That is a useful integrity guarantee for normal OpenAI-compatible providers because an unexplained EOF may be truncation.

The 9Router bridge forwards bytes unchanged. Several 9Router backends produce valid content and then close their SSE response cleanly without the sentinel. The browser parser cannot distinguish that valid route convention from a truncated response and rejects it.

The correct boundary is the 9Router bridge. It knows the response arrived through a heterogeneous local router and can normalize only a clean, output-bearing EOF. Output-bearing includes final content and reasoning deltas; reasoning-only completion still surfaces as empty output to the client rather than as a misleading protocol failure.

### 6.3 Winner and standings use different semantics

Aggregation correctly computes:

- mean over available scores;
- complete coverage separately;
- winner eligibility only for complete models.

The results UI then sorts every model by mean and prints positional numbers. This makes an incomplete provisional leader appear as `#1` while a complete model receives the winner banner and another `#1` label.

### 6.4 Retry is hidden and too coarse

`retryIncomplete` can requeue incomplete tasks after execution stops. The terminal results screen does not expose it. The existing operation also reruns the full candidate roster for each eligible task.

A single missing candidate-task cell should not require repeating seven successful candidate calls.

### 6.5 Progress is attempt-first rather than task-first

The progress surface renders every attempt as a primary `RecordRow`. Old failures remain visually equal to the selected current attempt. Controls sit after the full list. At large task counts, users lose current execution context and must scroll to find pause, abort, or retry.

## 7. Design direction

| Before | After | Why |
| --- | --- | --- |
| Provider-level connection test only | Provider readiness plus explicit live test per selected model | A provider can be healthy while a route is unavailable or protocol-incompatible |
| Strict `[DONE]` requirement applied after the 9Router bridge passes bytes unchanged | 9Router bridge appends `[DONE]` only after a clean, output-bearing EOF | Restore compatibility without weakening other providers |
| Incomplete highest mean shown as Standings `#1` | Complete-coverage ranking plus separately labeled provisional leader | Winner and rank labels must not contradict each other |
| Retry action only during progress | Recovery toolbar on terminal results | Put the action next to the missing evidence |
| Whole-task retry only | Whole-task fallback plus targeted missing-cell repair | Avoid repeat cost while retaining a safe fallback |
| Newest partial attempt automatically selected | Highest score coverage selected, newest only as tie-breaker | A failed repair must not replace better accepted evidence |
| Every attempt shown as a full primary row | One full-width row per task with disclosed attempt history | Current state stays legible while evidence remains inspectable |
| Controls below an unbounded list | Sticky instrument header and bounded task pages | Critical controls remain reachable |
| Result matrix mounts every task | Page the matrix at a fixed task count and keep both headers sticky | Large suites remain responsive and retain context |

## 8. Model-level live preflight

### 8.1 User entry points

Model testing belongs where a model is selected:

1. Compare model roster in `ModelList`.
2. Evaluation suite candidate roster in `SuiteSettings`.
3. Suite default Judge selector.

Each selected row receives a text action named **Test model**. Do not use an unlabeled icon as the sole action.

A roster-level **Test selected models** action runs enabled candidates and the configured Judge with bounded concurrency. It must not test disabled slots.

### 8.2 Test behavior

A live model test must use the provider adapter and model slug used by actual execution.

Request contract:

- one short user message asking for the exact token `OK`;
- `temperature: 0`;
- `maxTokens: 128`, so reasoning routes have enough budget to reach final content;
- streaming path when the provider uses streaming during real runs;
- 20-second timeout by default;
- user-initiated only;
- no automatic retry;
- no Judge or fusion stage.

The interface must state:

> Live model tests send a small generation request and may incur provider cost.

### 8.3 Structured outcomes

```ts
type ModelProbeState =
  | { kind: "untested" }
  | { kind: "testing"; startedAt: number }
  | { kind: "ready"; latencyMs: number; testedAt: number }
  | {
      kind: "failed";
      category:
        | "unauthorized"
        | "unavailable"
        | "rate-limited"
        | "timeout"
        | "empty-stream"
        | "protocol-incompatible"
        | "network"
        | "unknown";
      message: string;
      testedAt: number;
    };
```

Messages must be sanitized. They may include provider name, model slug, HTTP status, and normalized failure category. They must not include API keys, authorization headers, raw request bodies, or full prompts.

### 8.4 State and invalidation

Probe state is ephemeral session state. It is not suite evidence and is not exported.

A result is invalidated when:

- the slot provider changes;
- the slot slug changes;
- the provider credential is saved or cleared;
- the bridge endpoint configuration changes during the session;
- ten minutes elapse.

Saved and tested state remain distinct. Testing an unsaved credential in Connections does not silently change the credential used by suite execution.

### 8.5 Run confirmation

Starting a suite must summarize preflight without silently changing the roster:

- `Ready`: tested and passed within TTL.
- `Failed`: tested and failed.
- `Untested`: no current result.

If any enabled candidate or Judge has failed, the start confirmation shows the failures and requires an explicit **Run anyway** action. The primary action remains **Review model tests**.

Untested models do not hard-block execution. RSemble should recommend **Test selected models**, but expert users may proceed.

RSemble must never silently run only the ready subset because that would change the benchmark roster.

## 9. 9Router SSE normalization

### 9.1 Scope boundary

Normalization applies only to:

- `POST /9router/v1/chat/completions`;
- responses whose media type is `text/event-stream`;
- requests with `stream: true`;
- a normally completed upstream body iteration.

It does not apply to Umans, OpenRouter, DeepSeek, Gemini, ChatGPT Codex, CommandCode, or ClinePass.

### 9.2 Normalization rule

The 9Router proxy incrementally inspects SSE event boundaries while preserving streamed bytes and backpressure.

At upstream EOF:

1. If `[DONE]` was observed, end unchanged.
2. If at least one valid content or reasoning OpenAI delta was observed and iteration ended normally, append exactly:

```text
data: [DONE]\n\n
```

3. If no usable content was observed, end unchanged so the browser reports an empty stream.
4. If reading threw, the client disconnected, or the upstream was aborted, do not append `[DONE]`.
5. Never append a duplicate sentinel.

The proxy must handle an SSE line or JSON event split across arbitrary byte chunks.

### 9.3 Integrity and observability

The bridge may emit one structured development log event containing:

- provider `9router`;
- model slug if safely parsed from the request body;
- normalization applied `true`;
- byte count and elapsed time.

It must not log credentials, prompts, generated content, or raw request bodies.

Normalization is compatibility handling, not silent recovery from transport failure.

## 10. Winner and ranking semantics

### 10.1 Calculation remains unchanged

- Missing scores remain missing.
- Means use available scores.
- Only complete-coverage models are winner-eligible.
- Complete winners use raw unrounded means and current tie tolerance.

### 10.2 Display language

The winner callout title becomes **Complete-coverage winner**.

When an incomplete model has a higher available-task mean than the eligible winner, render a separate restrained line:

> **Provisional score leader** · 4.54 mean over 14/15 tasks · not winner-eligible

The provisional line receives no crown and no numeric rank.

### 10.3 Standings order

Standings use two groups:

1. **Eligible standings**: complete models sorted by raw mean and numbered `#1`, `#2`, and so on.
2. **Provisional results**: incomplete models sorted by raw mean with no positional number.

Every incomplete row must state coverage and **Incomplete**.

If no model has complete coverage, show:

> No complete-coverage winner. Complete missing results to determine the winner.

### 10.4 Matrix labels

The matrix footer retains separate Mean score and Coverage rows.

Incomplete columns show **Provisional** beside coverage. Winner styling applies only to complete winner columns.

## 11. Recovery model

### 11.1 Recovery actions

Terminal results provide:

- **Repair all missing results** for all repairable `no-score` cells.
- **Complete missing result** on one missing matrix cell.
- **Retry incomplete task** on one task when targeted repair is not safe.
- **Retry all incomplete tasks** as the existing full-roster fallback.

Actions are absent while another execution owns the lease.

### 11.2 Repairability

A missing cell is target-repairable only when:

- the task has a selected partial attempt;
- its selected run record is available;
- that run has accepted outputs for at least one other candidate;
- the cell reason is `no-score`;
- the experiment snapshot and protocol fingerprint are unchanged;
- the target model remains in the immutable snapshot roster.

`no-attempt`, `no-accepted-attempt`, and `evidence-missing` require a full task retry.

### 11.3 Compound repair attempt

A targeted repair creates a new immutable task attempt. It does not mutate the prior run.

The new attempt contains:

1. Reused accepted candidate outputs copied from the selected base run with explicit provenance.
2. Fresh candidate attempts only for targeted missing model keys.
3. A fresh blind-label map.
4. A fresh Judge attempt over the complete reconstructed candidate set.
5. Fresh canonical scores and winner evidence for that task.

Old Judge scores are never copied into the repair attempt.

### 11.4 Provenance

Each reused candidate attempt records:

```ts
interface ReusedCandidateProvenance {
  sourceRunId: string;
  sourceCandidateId: string;
  sourceAttemptId: string;
}
```

The new run source records:

```ts
interface ExperimentRepairSource {
  kind: "missing-cells";
  baseRunId: string;
  requestedModelKeys: string[];
  reusedModelKeys: string[];
}
```

The run detail UI labels reused candidates **Reused from prior attempt** and links to the source run.

### 11.5 Selection policy

Task attempt selection changes from “newest partial wins” to:

1. Newest completed full-coverage attempt.
2. Otherwise, partial attempt with the highest scored-model coverage.
3. Newest attempt only as the tie-breaker.
4. Otherwise none.

A failed or lower-coverage repair must not displace better accepted evidence.

Existing records without stored score coverage use current behavior as a migration fallback until a new attempt supplies coverage metadata.

### 11.6 Execution ownership

Repair uses the existing execution lease, owner registry, fence checks, heartbeat, atomic begin/commit unit of work, pause-at-task-boundary behavior, abort path, and startup recovery.

Only one task repair executes at a time. Candidate calls inside that task may remain parallel when more than one cell is targeted.

### 11.7 Cost preview

Before repair starts, show:

- number of candidate calls;
- number of tasks affected;
- number of fresh Judge calls;
- number of candidate outputs reused.

Example:

> 1 candidate call + 1 Judge call across 1 task. Seven candidate outputs will be reused.

## 12. Task ledger and large-suite behavior

### 12.1 Shared task-ledger grammar

Suite editing, live progress, and result recovery use the same information hierarchy:

- task index;
- task title;
- current status;
- candidate coverage;
- trial count;
- elapsed time or finished time;
- one primary action;
- attempt history disclosure.

The exact controls may differ by surface, but column order and status vocabulary remain stable.

### 12.2 Full-width row contract

Every visual task row occupies the available ledger width regardless of title length.

Required layout behavior:

- row surface `w-full` or `flex-1`;
- title cell `min-w-0` and truncates in compact mode;
- status and numeric cells use stable widths;
- no width animation;
- no title-length-dependent painted bars.

### 12.3 Live progress layout

The progress route contains:

1. Sticky instrument header with current task, completed/partial/failed/queued counts, elapsed time, Pause/Resume, and Abort.
2. Search and filters: `All`, `Active`, `Issues`, `Queued`, `Complete`.
3. One primary row per task based on selected/current state.
4. Attempt history behind a native or accessible disclosure.
5. Fixed pages of 50 task rows.

Completed evidence remains available but is not expanded by default.

### 12.4 Terminal results layout

The terminal page contains:

1. Identity and status.
2. Complete-coverage winner and optional provisional leader.
3. Eligible standings and provisional results.
4. Recovery toolbar with missing-cell counts and actions.
5. Result matrix.
6. Coverage issues view.
7. Attempt history view.

Historical failed attempts do not appear as current coverage issues after a later repair succeeds. They remain under Attempt history.

### 12.5 Matrix scaling

At 50 or fewer tasks, render all rows.

Above 50 tasks:

- paginate in stable suite order with 50 tasks per page;
- preserve page and filters in URL search parameters;
- keep column headers sticky;
- keep the first task column sticky during horizontal scrolling;
- keep horizontal scrolling local and keyboard-focusable;
- do not mount hidden pages;
- mobile uses the same page boundary rather than mounting all cards.

No new virtualization dependency is required.

### 12.6 Filtering and ordering

Filtering never mutates canonical suite order.

Reordering in the suite editor is available only in the unfiltered canonical-order view. If the editor is filtered, reorder controls are disabled with explanatory text.

### 12.7 Motion

- Filtering, paging, sorting, ranking, and retry state changes are instant.
- No stagger, layout animation, expanding height animation, or score reveal.
- Disclosure chevrons may rotate using the existing short ease-out token.
- Loading uses one existing spinner or textual status per region.
- Reduced motion retains the same information and interaction order.

## 13. Accessibility

1. Model test actions have accessible names containing provider and model.
2. Probe results use visible text and `role="status"`; failures use `role="alert"` only when immediate attention is required.
3. Testing state is not represented by motion alone.
4. Recovery confirmation receives initial focus, traps focus, closes on Escape, and restores focus through Base UI Dialog.
5. Matrix missing-cell actions are keyboard reachable and do not nest interactive elements.
6. Sticky controls do not cover focused rows at 200% zoom.
7. Task filters expose current state through `aria-pressed` or tab semantics.
8. Pagination announces page and task range.
9. Attempt history uses an accessible disclosure and keeps links to immutable evidence.
10. Touch targets remain at least 44 by 44 CSS pixels.
11. The page has no horizontal overflow at 390px; only the matrix region may scroll horizontally.

## 14. Performance

- Model probes use bounded concurrency of three.
- Probe timeouts clean up timers and abort controllers.
- The 9Router normalizer processes chunks incrementally and does not buffer the full completion.
- Progress and results mount at most 50 primary task rows per page.
- Attempt details mount only when disclosed.
- Result records for the current matrix page may load first; aggregate loading may remain background work if calculation requires all selected runs.
- No polling interval is added for terminal results.

## 15. Security and privacy

- Never persist or export API keys, authorization headers, environment values, or probe request bodies.
- Probe errors are sanitized through the existing persisted-error vocabulary where possible.
- Bridge logs never include prompts or generated content.
- 9Router upstream remains server-configured and cannot be overridden by the browser.
- Repair is limited to the immutable experiment snapshot and protocol fingerprint.
- Reused output provenance references immutable local run IDs only.
- No external network action occurs without the explicit model test, run, or repair action.

## 16. Acceptance criteria

### 16.1 9Router

- A content-bearing 9Router SSE stream with `[DONE]` passes through unchanged.
- A content-bearing 9Router SSE stream that ends normally without `[DONE]` receives exactly one sentinel.
- An empty stream remains an error.
- An aborted or throwing stream never receives a synthetic sentinel.
- Split UTF-8, split `data:` lines, and split JSON events are handled.
- Other providers retain strict shared-parser behavior.

### 16.2 Model preflight

- A selected model can be tested from Compare and Suite Settings.
- A selected Judge can be tested.
- A test exercises the exact provider and slug through the real streaming adapter.
- Ready, unauthorized, unavailable, rate-limited, timeout, empty-stream, protocol-incompatible, network, and unknown outcomes render visibly.
- Credential changes invalidate affected results.
- Failed preflight produces an explicit run warning but never silently changes the roster.

### 16.3 Winner clarity

- A complete 4.38 model is the complete-coverage winner over an incomplete 4.54 model.
- The incomplete model is labeled provisional and receives no numeric `#1`.
- Eligible standings rank only complete models.
- No complete model yields no winner plus a direct recovery instruction.

### 16.4 Repair

- One missing cell can be repaired with one target candidate call plus one fresh Judge call.
- Successful prior candidate outputs are not called again.
- Reused outputs carry source provenance.
- Old Judge scores are not reused.
- A failed repair leaves the higher-coverage prior attempt selected.
- A successful full-coverage repair becomes selected and updates aggregation.
- Lease, fence, abort, restart recovery, and persistence-failure tests remain green.
- Full-task retry remains available when targeted repair is unsafe.

### 16.5 Large suites

- Short and long task titles paint equal-width rows.
- A 250-task, eight-model, three-attempt fixture mounts at most 50 primary task rows.
- Current context and Pause/Abort controls remain reachable without scrolling to the end.
- Attempt history is discoverable but collapsed.
- Current issues exclude superseded failures.
- Matrix headers and first task column remain visible while scrolling.
- Mobile has no page-level horizontal overflow.
- Filtering cannot reorder or mutate the suite.

## 17. Verification gates

Required automated gates:

```bash
npm test
npm run typecheck:web
npm run typecheck:server
npm run build
npm run check
npm run qa:design-motion

git diff --check
```

Required browser scenarios:

1. Model preflight passes and fails with sanitized status.
2. Suite start with failed, ready, and untested models.
3. 9Router content stream without `[DONE]` completes successfully through the bridge.
4. Winner and provisional leader scenario at 15/15 versus 14/15.
5. Single-cell repair success and failure.
6. Whole-task fallback retry.
7. 250-task progress ledger at desktop, tablet, mobile, reduced motion, and 200% zoom.
8. Result matrix paging and sticky first column.
9. Keyboard-only probe, recovery, filter, disclosure, and pagination flow.

## 18. Rollout order

1. Lock current failure evidence in regression tests.
2. Normalize 9Router clean EOF.
3. Add the model-probe service and selected-model UI.
4. Clarify winner and provisional semantics.
5. Expose existing full-task recovery in terminal results.
6. Add compound missing-cell repair and provenance.
7. Replace progress attempts with the task ledger.
8. Page and harden large result surfaces.
9. Run integrated browser and accessibility QA.

## 19. Resolved decisions

- Complete coverage remains mandatory for winner eligibility.
- Missing scores remain missing.
- Incomplete higher means are provisional, not silently demoted or crowned.
- Provider readiness and model readiness are separate concepts.
- Model tests are explicit and may incur a small cost.
- Failed preflight warns but does not silently alter the suite roster.
- 9Router normalization lives at the 9Router bridge boundary only.
- Clean EOF is accepted only after usable content and normal upstream completion.
- Targeted repair reuses candidate outputs, never prior Judge scores.
- A repaired task is represented by a new immutable compound attempt.
- Attempt selection prefers coverage before recency.
- Full-task retry remains the safe fallback.
- Task pages use 50 rows and no new virtualization dependency.
- The industrial visual system and motion constraints remain unchanged.
