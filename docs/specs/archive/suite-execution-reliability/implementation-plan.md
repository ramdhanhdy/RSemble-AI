# Suite Execution Reliability and Recovery Implementation Plan

> **For Hermes:** Use the subagent-driven-development skill to implement this plan task by task.

**Goal:** Make suite execution preflightable, 9Router-compatible, honestly ranked, recoverable at missing-cell granularity, and usable at large task counts.

**Architecture:** Keep provider readiness separate from a new model-route probe service. Normalize missing 9Router SSE termination only in the 9Router bridge. Represent targeted recovery as a new compound task attempt that reuses accepted candidate output with provenance, executes only missing model keys, and performs a fresh blind Judge pass. Present experiments through complete versus provisional ranking semantics and bounded task-ledger and matrix pages.

**Tech stack:** React 18, TypeScript, Vitest, Dexie, Node bridge, Tailwind CSS, Base UI Dialog, existing provider adapters and execution controller. No new runtime dependency.

**Authority:**

- `docs/specs/archive/suite-execution-reliability/suite-execution-reliability-spec.md`
- `docs/specs/archive/evaluation-workspaces/evaluation-workspaces-spec.md`
- `docs/specs/archive/design-motion-refinement/design-motion-refinement-spec.md`
- `PRODUCT.md`
- `DESIGN.md`
- `UI.md`

---

## 0. Worktree and execution rules

Before every task:

```bash
git status --short
git diff --check
```

The following files were already dirty or untracked when this plan was written and must not be staged, edited, deleted, or reformatted unless the user separately asks:

- `tsconfig.tsbuildinfo`
- `docs/evaluations/pulsefit-business-analytics-upgraded.suite.json`
- `docs/research/task-first-evaluation-taxonomy.docx`
- `docs/research/task-first-evaluation-taxonomy.md`
- existing files under `docs/specs/archive/design-motion-refinement/`

Use explicit `git add <paths>` commands. Never use `git add .` or `git add -A`.

For every behavior change:

1. Write one focused failing test.
2. Run it and verify it fails for the intended missing behavior.
3. Write the smallest implementation.
4. Re-run the focused test.
5. Run the nearest related test files.
6. Refactor only while green.
7. Commit only task-owned files.

Do not push, deploy, rewrite history, or expose credentials.

## 1. Milestone map

| Milestone | Tasks | Gate |
| --- | --- | --- |
| A. Lock the failures | 1 | Regression tests fail for the documented reasons |
| B. Transport and preflight | 2 to 5 | 9Router normalization and model probes pass targeted tests |
| C. Result truthfulness | 6 to 7 | Winner and recovery semantics are non-contradictory |
| D. Targeted repair | 8 to 11 | One missing cell executes one candidate plus one fresh Judge |
| E. Large-suite interface | 12 to 14 | 250-task fixtures remain bounded and controls stay reachable |
| F. Integrated verification | 15 | Full checks and browser QA pass with evidence |

---

## Task 1: Add evidence-backed regression contracts

**Objective:** Lock the observed failures before changing production behavior.

**Files:**

- Create: `src/lib/providers/model-probe.test.ts`
- Modify: `server/tests/nine-router.test.ts`
- Modify: `src/lib/evaluations/experiment-aggregation.test.ts`
- Modify: `src/ui/RecordRow.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.test.tsx`

### Step 1: Add the 9Router clean-EOF regression

Add an upstream SSE fixture that emits a valid content delta and closes without `[DONE]`. Assert the proxied response currently lacks the sentinel.

The final assertion after Task 2 will be:

```ts
expect(body.match(/data: \[DONE\]/g)).toHaveLength(1);
```

Also add cases for:

- existing `[DONE]` is not duplicated;
- empty stream receives no synthetic sentinel;
- upstream iteration failure receives no synthetic sentinel;
- `data:` and JSON split across chunks.

### Step 2: Add ranking semantics regression

Use the exact shape:

```ts
const complete = { modelKey: "umans:model", mean: 4.38, scoredTasks: 15, totalTasks: 15, complete: true };
const provisional = { modelKey: "9router:model", mean: 4.54, scoredTasks: 14, totalTasks: 15, complete: false };
```

Assert the complete model remains winner-eligible and the result view never gives the provisional model numeric rank `#1`.

### Step 3: Add the row-width regression

Render `RecordRow` with a short and long title. Assert the painted inner row surface has a full-width contract, not only the wrapper.

Prefer a stable marker:

```tsx
<div data-record-row-surface="" ... />
```

Then assert the surface contains `w-full` or `flex-1` and `min-w-0`.

### Step 4: Add a model-probe contract test

Define the wished-for API:

```ts
await probeModelRoute({
  provider,
  providerId: "9router",
  model: "cmc/model",
  now: () => 100,
  timeoutMs: 20_000,
});
```

Assert it:

- uses the exact slug;
- requests `temperature: 0` and `maxTokens: 128` so reasoning routes can reach final content;
- consumes the streaming iterator;
- returns structured ready or failed state;
- sanitizes errors.

### Step 5: Verify RED

Run:

```bash
npm test -- server/tests/nine-router.test.ts \
  src/lib/providers/model-probe.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/ui/RecordRow.test.tsx
```

Expected: FAIL because model probing, 9Router normalization, ranking grouping, and the row-surface width contract do not exist.

### Step 6: Commit tests only

```bash
git add server/tests/nine-router.test.ts \
  src/lib/providers/model-probe.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/ui/RecordRow.test.tsx
git commit -m "test: lock suite reliability regressions"
```

---

## Task 2: Normalize clean 9Router SSE termination

**Objective:** Append one `[DONE]` sentinel only to a normally completed, output-bearing 9Router stream, including reasoning deltas.

Finalize a complete pending `data:` line at clean EOF and insert an SSE separator before the sentinel when the upstream omitted its final newline.

**Files:**

- Create: `server/codex-bridge/sse-termination.ts`
- Create: `server/tests/sse-termination.test.ts`
- Modify: `server/codex-bridge/umans.ts`
- Modify: `server/codex-bridge/nine-router.ts`
- Modify: `server/tests/nine-router.test.ts`

### Step 1: Write the pure normalizer tests

Define an incremental utility whose state survives arbitrary chunk boundaries:

```ts
export interface SseTerminationState {
  pending: string;
  sawDone: boolean;
  sawUsableContent: boolean;
}

export function inspectOpenAiSseChunk(
  state: SseTerminationState,
  chunk: Uint8Array,
): SseTerminationState;

export function shouldAppendDone(
  state: SseTerminationState,
  completedNormally: boolean,
): boolean;
```

Tests must cover:

- one complete content event;
- split UTF-8 and split JSON;
- `[DONE]` across chunks;
- comment/heartbeat events;
- empty delta;
- malformed JSON;
- thrown iteration and client abort.

### Step 2: Verify RED

```bash
npm test -- server/tests/sse-termination.test.ts server/tests/nine-router.test.ts
```

Expected: FAIL because the utility and proxy option do not exist.

### Step 3: Add a narrow proxy option

Extend the shared proxy dependency without changing default behavior:

```ts
export interface OpenAIProxyDeps extends UmansProxyDeps {
  upstream: string;
  routePrefix: string;
  providerLabel: string;
  normalizeCleanSseEof?: boolean;
}
```

In `handleOpenAICompatibleProxy`:

- stream chunks immediately;
- inspect only when the option is true and the response is SSE;
- track whether iteration completed normally;
- append `data: [DONE]\n\n` only when `shouldAppendDone(...)` returns true;
- preserve backpressure for the appended bytes;
- never write after client close.

### Step 4: Enable only for 9Router

```ts
return handleOpenAICompatibleProxy(req, res, pathWithQuery, {
  ...deps,
  upstream,
  routePrefix: "9router",
  providerLabel: "9Router",
  normalizeCleanSseEof: true,
});
```

Do not enable the option in `handleUmansProxy`.

### Step 5: Verify GREEN

```bash
npm test -- server/tests/sse-termination.test.ts \
  server/tests/nine-router.test.ts \
  server/tests/umans.test.ts \
  src/lib/providers/sse-stream.test.ts \
  src/lib/providers/nine-router.test.ts
npm run typecheck:server
```

Expected: PASS. Existing strict browser parser tests remain unchanged.

### Step 6: Commit

```bash
git add server/codex-bridge/sse-termination.ts \
  server/codex-bridge/umans.ts \
  server/codex-bridge/nine-router.ts \
  server/tests/sse-termination.test.ts \
  server/tests/nine-router.test.ts
git commit -m "fix: normalize clean 9router stream endings"
```

---

## Task 3: Build the model-route probe service

**Objective:** Test the exact provider and model slug through the real generation adapter with structured, sanitized outcomes.

**Files:**

- Create: `src/lib/providers/model-probe.ts`
- Modify: `src/lib/providers/model-probe.test.ts`
- Modify: `src/lib/providers/types.ts`
- Modify: `src/lib/providers/provider-error.ts` only if normalized categories are not already available

### Step 1: Complete the failing behavior tests

Test:

- ready with latency;
- unauthorized HTTP/provider error;
- unavailable model;
- rate limit;
- timeout and abort cleanup;
- empty stream;
- missing `[DONE]` protocol incompatibility;
- network failure;
- unknown sanitized failure;
- no raw prompt, key, authorization text, or provider response body in the returned message.

### Step 2: Implement the public types

```ts
export type ModelProbeFailureCategory =
  | "unauthorized"
  | "unavailable"
  | "rate-limited"
  | "timeout"
  | "empty-stream"
  | "protocol-incompatible"
  | "network"
  | "unknown";

export type ModelProbeState =
  | { kind: "untested" }
  | { kind: "testing"; startedAt: number }
  | { kind: "ready"; latencyMs: number; testedAt: number }
  | { kind: "failed"; category: ModelProbeFailureCategory; message: string; testedAt: number };
```

### Step 3: Implement `probeModelRoute`

The service must:

1. Create its own timeout controller.
2. Merge caller abort with timeout without leaking listeners.
3. Call `provider.chatCompletionStream` with the exact model.
4. Consume until completion.
5. Require nonblank output.
6. Classify known `ProviderError` and message signatures.
7. Return a sanitized result.
8. Clear the timeout in `finally`.

Do not call `readiness()` as a substitute.

### Step 4: Verify GREEN

```bash
npm test -- src/lib/providers/model-probe.test.ts \
  src/lib/providers/openai-compat.test.ts \
  src/lib/providers/sse-stream.test.ts
npm run typecheck:web
```

### Step 5: Commit

```bash
git add src/lib/providers/model-probe.ts \
  src/lib/providers/model-probe.test.ts \
  src/lib/providers/types.ts \
  src/lib/providers/provider-error.ts
git commit -m "feat: add exact model route probes"
```

Omit `provider-error.ts` from `git add` if it was not needed.

---

## Task 4: Add reusable model-test controls

**Objective:** Show model-level test actions and statuses without conflating tested and saved state.

**Files:**

- Create: `src/ui/ModelProbeControl.tsx`
- Create: `src/ui/ModelProbeControl.test.tsx`
- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/ModelList.test.tsx`
- Modify: `src/workspaces/evaluations/SuiteSettings.tsx`
- Modify: `src/workspaces/evaluations/SuiteEditor.test.tsx`
- Modify: `src/ui/ConnectionsModal.tsx`
- Modify: `src/ui/ConnectionsModal.test.tsx`

### Step 1: Write failing UI tests

Assert:

- each selected Compare model has **Test model**;
- each suite candidate and Judge has the action;
- accessible name includes provider and slug;
- testing disables only that model action;
- result text shows Ready plus latency or a failure category;
- the cost notice is visible;
- changing provider/slug resets to Untested;
- saving a provider credential invalidates statuses for that provider;
- testing never dispatches a slot change or saves a credential.

### Step 2: Verify RED

```bash
npm test -- src/ui/ModelProbeControl.test.tsx \
  src/ui/ModelList.test.tsx \
  src/workspaces/evaluations/SuiteEditor.test.tsx \
  src/ui/ConnectionsModal.test.tsx
```

### Step 3: Implement the control

`ModelProbeControl` owns only one slot's ephemeral state and calls the service. Accept an invalidation token from the parent so credential saves can reset related state.

Use visible copy, not icon-only status. The spinner may use the existing linear spinner class. Do not animate state entry.

### Step 4: Add bounded roster testing

In Suite Settings add **Test selected models** with concurrency three. Include the Judge once if it is not already an identical enabled candidate key.

Keep per-row results independent. Do not stop the batch after the first failure.

### Step 5: Preserve saved versus tested state

`ConnectionsModal` continues to test the unsaved text field and continues to require Save before execution uses it. On save, emit or increment a provider-specific invalidation token through the existing refresh path.

Do not persist probe results in local storage or IndexedDB.

### Step 6: Verify GREEN

```bash
npm test -- src/ui/ModelProbeControl.test.tsx \
  src/ui/ModelList.test.tsx \
  src/workspaces/evaluations/SuiteEditor.test.tsx \
  src/ui/ConnectionsModal.test.tsx
npm run typecheck:web
```

### Step 7: Commit

```bash
git add src/ui/ModelProbeControl.tsx \
  src/ui/ModelProbeControl.test.tsx \
  src/ui/ModelList.tsx \
  src/ui/ModelList.test.tsx \
  src/workspaces/evaluations/SuiteSettings.tsx \
  src/workspaces/evaluations/SuiteEditor.test.tsx \
  src/ui/ConnectionsModal.tsx \
  src/ui/ConnectionsModal.test.tsx
git commit -m "feat: test selected model routes"
```

---

## Task 5: Add suite preflight confirmation

**Objective:** Warn before a paid suite run when selected candidates or the Judge failed or remain untested, without silently changing the roster.

**Files:**

- Create: `src/workspaces/evaluations/SuitePreflightDialog.tsx`
- Create: `src/workspaces/evaluations/SuitePreflightDialog.test.tsx`
- Modify: `src/workspaces/evaluations/SuiteEditor.tsx`
- Modify: `src/workspaces/evaluations/SuiteEditor.test.tsx`
- Modify: `src/rsemble.tsx` only if probe state must be lifted to the route owner

### Step 1: Write failing tests

Cover:

- ready, failed, and untested counts;
- failed models listed with sanitized reasons;
- primary action **Review model tests** when failures exist;
- explicit secondary **Run anyway**;
- untested-only state recommends tests but permits execution;
- the exact immutable suite roster reaches `controller.start`;
- no **Run ready models only** behavior exists;
- focus entry, Tab trap, Escape, and focus restoration.

### Step 2: Verify RED

```bash
npm test -- src/workspaces/evaluations/SuitePreflightDialog.test.tsx \
  src/workspaces/evaluations/SuiteEditor.test.tsx
```

### Step 3: Implement with Base UI Dialog

Use the existing `DialogSurface`. Keep copy compact and explicit about small provider cost.

The dialog is a confirmation surface. It must not edit the suite snapshot or disable models.

### Step 4: Verify GREEN

```bash
npm test -- src/workspaces/evaluations/SuitePreflightDialog.test.tsx \
  src/workspaces/evaluations/SuiteEditor.test.tsx
npm run typecheck:web
```

### Step 5: Commit

```bash
git add src/workspaces/evaluations/SuitePreflightDialog.tsx \
  src/workspaces/evaluations/SuitePreflightDialog.test.tsx \
  src/workspaces/evaluations/SuiteEditor.tsx \
  src/workspaces/evaluations/SuiteEditor.test.tsx
git commit -m "feat: confirm suite model preflight"
```

Add `src/rsemble.tsx` only if changed.

---

## Task 6: Separate eligible standings from provisional results

**Objective:** Remove contradictory `#1` labels while preserving complete-coverage winner rules.

**Files:**

- Create: `src/lib/evaluations/experiment-ranking.ts`
- Create: `src/lib/evaluations/experiment-ranking.test.ts`
- Modify: `src/workspaces/evaluations/ExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.test.tsx`
- Modify: `src/workspaces/evaluations/ResultMatrix.tsx`
- Modify: `src/workspaces/evaluations/ResultMatrix.test.tsx`
- Modify: `src/workspaces/evaluations/MobileExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/MobileExperimentResults.test.tsx`

### Step 1: Write the ranking helper test

Use a pure helper:

```ts
export interface ExperimentDisplayRanking {
  eligible: ModelAggregate[];
  provisional: ModelAggregate[];
  provisionalLeader: ModelAggregate | null;
}
```

Rules:

- eligible means `complete === true`;
- both groups sort by raw mean descending;
- only eligible rows receive numeric ranks;
- provisional leader is returned only when its mean exceeds the highest eligible mean or when no complete model exists;
- equal means preserve snapshot roster order.

### Step 2: Verify RED

```bash
npm test -- src/lib/evaluations/experiment-ranking.test.ts \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx
```

### Step 3: Implement display changes

Use labels exactly:

- `Complete-coverage winner`
- `Eligible standings`
- `Provisional results`
- `Provisional score leader`
- `Incomplete · 14/15 tasks`

No crown or numeric rank for incomplete models.

Do not change `aggregateExperiment` winner math.

### Step 4: Verify GREEN

```bash
npm test -- src/lib/evaluations/experiment-ranking.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx
```

### Step 5: Commit

```bash
git add src/lib/evaluations/experiment-ranking.ts \
  src/lib/evaluations/experiment-ranking.test.ts \
  src/workspaces/evaluations/ExperimentResults.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx
git commit -m "fix: distinguish provisional experiment leaders"
```

---

## Task 7: Expose safe full-task recovery in terminal results

**Objective:** Make the existing retry path available where missing evidence is visible before adding cell-level repair.

**Files:**

- Modify: `src/workspaces/evaluations/ExperimentRoute.tsx`
- Modify: `src/workspaces/evaluations/ExperimentRoute.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.test.tsx`

### Step 1: Write failing tests

Assert:

- terminal results receive the controller;
- **Retry all incomplete tasks** appears only when retryable tasks exist and no execution is active;
- clicking calls `controller.retryIncomplete(experiment.id)`;
- operation errors render as visible alerts;
- successful start returns the route to live progress through repository/controller refresh;
- no action appears for a fully complete experiment.

### Step 2: Verify RED

```bash
npm test -- src/workspaces/evaluations/ExperimentRoute.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx
```

### Step 3: Implement the narrow handoff

Pass `controller` from `ExperimentRoute` to `ExperimentResults`. Reuse the existing operation. Do not duplicate lease or retry logic in React.

Put the action in a Recovery section above the matrix, not after the issue list.

### Step 4: Verify GREEN

```bash
npm test -- src/workspaces/evaluations/ExperimentRoute.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/lib/evaluations/experiment-controller.test.ts
```

### Step 5: Commit

```bash
git add src/workspaces/evaluations/ExperimentRoute.tsx \
  src/workspaces/evaluations/ExperimentRoute.test.tsx \
  src/workspaces/evaluations/ExperimentResults.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx
git commit -m "feat: retry incomplete tasks from results"
```

---

## Task 8: Add repair provenance and coverage-aware attempt selection

**Objective:** Extend persisted types so compound repairs are auditable and lower-coverage retries cannot displace better evidence.

**Files:**

- Modify: `src/lib/evaluations/evaluation-types.ts`
- Modify: `src/lib/evaluations/evaluation-types.test.ts`
- Modify: `src/lib/persistence/run-types.ts`
- Modify: `src/lib/persistence/run-types.test.ts`
- Modify: `src/lib/evaluations/experiment-engine.ts`
- Modify: `src/lib/evaluations/experiment-engine.test.ts`

### Step 1: Write failing schema tests

Add optional backward-compatible fields:

```ts
export interface ExperimentAttemptCoverage {
  scoredModelKeys: string[];
  totalModels: number;
}

export interface ExperimentRepairPlan {
  kind: "missing-cells";
  baseRunId: string;
  requestedModelKeys: string[];
}
```

`ExperimentTaskAttempt` gains:

```ts
coverage?: ExperimentAttemptCoverage;
repair?: ExperimentRepairPlan;
```

`CandidateAttemptRecord` gains:

```ts
reusedFrom?: {
  sourceRunId: string;
  sourceCandidateId: string;
  sourceAttemptId: string;
};
```

Experiment `RunSource` gains optional repair metadata only on the experiment branch.

Validators must reject blank IDs, duplicate model keys, impossible negative totals, and prohibited credential-shaped keys.

### Step 2: Add selection tests

Assert:

1. newest completed wins;
2. partial with 7/8 scores beats newer partial with 6/8;
3. newer partial wins when coverage ties;
4. existing records without coverage preserve current newest-partial fallback;
5. failed attempts never become selected.

### Step 3: Verify RED

```bash
npm test -- src/lib/evaluations/evaluation-types.test.ts \
  src/lib/persistence/run-types.test.ts \
  src/lib/evaluations/experiment-engine.test.ts
```

### Step 4: Implement schema and selector

Keep fields optional so current IndexedDB records remain readable. Do not rewrite old records in place.

Extend `CommitTerminalInput` with optional coverage and store it on the terminal attempt before calling `selectAttemptId`.

### Step 5: Verify GREEN

```bash
npm test -- src/lib/evaluations/evaluation-types.test.ts \
  src/lib/persistence/run-types.test.ts \
  src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts
npm run typecheck:web
```

### Step 6: Commit

```bash
git add src/lib/evaluations/evaluation-types.ts \
  src/lib/evaluations/evaluation-types.test.ts \
  src/lib/persistence/run-types.ts \
  src/lib/persistence/run-types.test.ts \
  src/lib/evaluations/experiment-engine.ts \
  src/lib/evaluations/experiment-engine.test.ts
git commit -m "feat: track experiment repair provenance"
```

---

## Task 9: Build a pure compound-repair planner

**Objective:** Derive safe repair targets and a fresh full-roster run seed without provider or persistence side effects.

**Files:**

- Create: `src/lib/evaluations/experiment-repair.ts`
- Create: `src/lib/evaluations/experiment-repair.test.ts`
- Modify: `src/lib/persistence/run-record-builder.ts`
- Modify: `src/lib/persistence/run-record-builder.test.ts`

### Step 1: Define the wished-for API

```ts
export interface RepairRequest {
  taskId: string;
  modelKeys: string[];
}

export interface CompoundRepairPlan {
  taskId: string;
  baseRunId: string;
  requestedModelKeys: string[];
  reusedModelKeys: string[];
  candidateCalls: number;
  judgeCalls: 1;
}

export function planMissingCellRepair(input: {
  experiment: ExperimentRecord;
  aggregation: ExperimentAggregation;
  request: RepairRequest;
  resolveRunRecord: (runId: string) => RunRecordV2 | null;
}): { ok: true; plan: CompoundRepairPlan } | { ok: false; reason: string };
```

### Step 2: Write failing planner tests

Cover:

- one `no-score` cell is repairable;
- several missing cells on the same task become one plan;
- duplicate requested keys are rejected or deduplicated deterministically;
- scored cells cannot be repaid through repair;
- no base selected run falls back with an explicit reason;
- evidence-missing is not repairable;
- model outside snapshot is rejected;
- cross-task and cross-protocol reuse is impossible;
- candidate-call and Judge-call cost preview is exact.

### Step 3: Write failing run-seed tests

Add a builder helper that creates a fresh run with:

- fresh run, candidate, and attempt IDs;
- copied accepted outputs and messages for reused candidates;
- explicit `reusedFrom` provenance;
- unstarted target candidates;
- empty Judge and fusion evidence;
- repair metadata in source;
- no copied winner or score report.

### Step 4: Verify RED

```bash
npm test -- src/lib/evaluations/experiment-repair.test.ts \
  src/lib/persistence/run-record-builder.test.ts
```

### Step 5: Implement minimal pure logic

Do not access repositories from the planner. Do not mutate the base run.

Every reused attempt must receive a fresh local attempt ID while recording the source attempt ID.

### Step 6: Verify GREEN

```bash
npm test -- src/lib/evaluations/experiment-repair.test.ts \
  src/lib/persistence/run-record-builder.test.ts \
  src/lib/persistence/run-types.test.ts
```

### Step 7: Commit

```bash
git add src/lib/evaluations/experiment-repair.ts \
  src/lib/evaluations/experiment-repair.test.ts \
  src/lib/persistence/run-record-builder.ts \
  src/lib/persistence/run-record-builder.test.ts
git commit -m "feat: plan compound experiment repairs"
```

---

## Task 10: Let the executor skip reused candidates and rejudge the full set

**Objective:** Execute only requested candidate model keys while feeding reused and fresh outputs into a new blind Judge pass.

**Files:**

- Modify: `src/lib/run-executor.ts`
- Modify: `src/lib/run-executor.test.ts`
- Modify: `src/lib/pipeline.ts` only if its fanout job type owns target selection
- Modify: `src/lib/pipeline.test.ts` only if `pipeline.ts` changes

### Step 1: Write failing executor tests

Create an input with eight slots, seven seeded accepted candidates, and one requested model key.

Assert:

- provider generation is called exactly once;
- reused models are never sent to providers;
- `onCandidateAttemptStart` fires only for requested models;
- Judge receives all eight candidate outputs;
- blind labels are freshly generated;
- Judge mappings reference the fresh compound-run candidate IDs;
- an unavailable target produces a partial compound run without deleting reused outputs;
- abort does not alter reused evidence.

### Step 2: Verify RED

```bash
npm test -- src/lib/run-executor.test.ts
```

### Step 3: Extend executor input narrowly

Prefer an optional execution selection:

```ts
candidateExecution?: {
  executeModelKeys: string[];
  seededCandidates: Candidate[];
};
```

Normal Compare and full experiment execution omit it and retain current behavior.

Validate that:

- every execute key belongs to `slots`;
- seeded and execute keys do not overlap;
- their union covers the intended Judge set;
- duplicate model keys are rejected.

### Step 4: Keep one fanout terminal set

The Judge receives a deterministic roster-order candidate array composed from seeded and newly completed candidates. Failed target candidates remain absent from Judge input exactly as current failed candidates do.

Do not reuse a prior Judge report.

### Step 5: Verify GREEN

```bash
npm test -- src/lib/run-executor.test.ts src/lib/pipeline.test.ts
npm run typecheck:web
```

### Step 6: Commit

```bash
git add src/lib/run-executor.ts src/lib/run-executor.test.ts
git commit -m "feat: execute targeted candidate repairs"
```

Add pipeline files only if changed.

---

## Task 11: Orchestrate targeted repairs through the experiment controller

**Objective:** Run compound repairs with the existing lease, fence, UoW, abort, recovery, and persistence guarantees.

**Files:**

- Modify: `src/lib/evaluations/experiment-engine.ts`
- Modify: `src/lib/evaluations/experiment-engine.test.ts`
- Modify: `src/lib/evaluations/experiment-controller.ts`
- Modify: `src/lib/evaluations/experiment-controller.test.ts`
- Modify: `src/lib/persistence/experiment-unit-of-work.ts` only if current begin/commit payloads cannot carry repair metadata
- Modify: `src/lib/persistence/experiment-unit-of-work.test.ts` when UoW changes

### Step 1: Write failing controller tests

Add `repairMissingCells(experimentId, request)` to the wished-for controller interface.

Test:

- lease and owner acquisition;
- planner rejection releases ownership;
- one missing cell executes one candidate and one Judge;
- base outputs are reused with provenance;
- terminal coverage comes from fresh canonical Judge scores;
- successful 8/8 repair becomes selected;
- failed 7/8 repair does not replace an existing 7/8 attempt unless it is newer at equal coverage;
- lower coverage never replaces better evidence;
- pause and abort behavior;
- persistence failure stops before another paid task;
- startup recovery adopts a committed terminal repair run and never repays it;
- protocol fingerprint mismatch rejects before execution.

### Step 2: Verify RED

```bash
npm test -- src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-controller.test.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts
```

### Step 3: Add an explicit engine transition

Add a transition that queues repair attempts with their repair plan. Do not overload `retryIncomplete` with ambiguous optional arguments.

```ts
queueRepairs(
  repairs: ExperimentRepairPlan[],
  generateId: () => string,
  fence: ExecutionFence,
  now: number,
): TransitionResult;
```

Keep one active task invariant.

### Step 4: Build and execute the repair run

In the controller:

1. Load experiment and selected base runs.
2. Validate through the pure planner.
3. Acquire lease and owner before any paid call.
4. Build the seeded fresh run.
5. Atomically persist begin.
6. Call executor with requested keys and seeded candidates.
7. Read the final run.
8. Derive `scoredModelKeys` from fresh canonical scores.
9. Commit terminal run and attempt atomically.
10. Recompute selection through coverage-aware policy.

### Step 5: Verify GREEN

```bash
npm test -- src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-controller.test.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts
npm run typecheck:web
```

### Step 6: Commit

```bash
git add src/lib/evaluations/experiment-engine.ts \
  src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-controller.ts \
  src/lib/evaluations/experiment-controller.test.ts \
  src/lib/persistence/experiment-unit-of-work.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts
git commit -m "feat: orchestrate missing cell repairs"
```

Omit unchanged UoW files.

---

## Task 12: Add recovery controls to the result matrix

**Objective:** Let users repair one cell, all repairable cells, or fall back to a full-task retry with an honest cost preview.

**Files:**

- Create: `src/workspaces/evaluations/ExperimentRecoveryDialog.tsx`
- Create: `src/workspaces/evaluations/ExperimentRecoveryDialog.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.test.tsx`
- Modify: `src/workspaces/evaluations/ResultMatrix.tsx`
- Modify: `src/workspaces/evaluations/ResultMatrix.test.tsx`
- Modify: `src/workspaces/evaluations/MobileExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/MobileExperimentResults.test.tsx`
- Modify: `src/workspaces/evaluations/RunDetail.tsx` and its test if this is the current run-detail component path

### Step 1: Write failing interaction tests

Assert:

- repairable missing cell has **Complete missing result**;
- nonrepairable missing cell has **Retry incomplete task**;
- global toolbar reports repairable and fallback counts;
- cost preview uses planner counts;
- confirmation calls `controller.repairMissingCells` with exact task and model keys;
- action disables while execution owns the lease;
- operation result appears visibly;
- focus returns to the triggering cell after cancel or start;
- reused candidates in Run Detail link to source evidence.

### Step 2: Verify RED

```bash
npm test -- src/workspaces/evaluations/ExperimentRecoveryDialog.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx
```

### Step 3: Implement the dialog and actions

Use `DialogSurface`. Render exact candidate and Judge call counts. Do not show an estimated currency value unless existing pricing data covers every involved model.

Missing matrix content must not become nested buttons or nested links. Use a compact cell container with one action control and one evidence link only where valid.

### Step 4: Separate current issues from attempt history

The default Coverage issues section derives from current aggregation cells. Historical failed attempts move into a collapsed Attempt history disclosure.

A repaired cell disappears from current issues after the selected attempt changes, while its old failure remains inspectable in history.

### Step 5: Verify GREEN

```bash
npm test -- src/workspaces/evaluations/ExperimentRecoveryDialog.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx
npm run typecheck:web
```

### Step 6: Commit

```bash
git add src/workspaces/evaluations/ExperimentRecoveryDialog.tsx \
  src/workspaces/evaluations/ExperimentRecoveryDialog.test.tsx \
  src/workspaces/evaluations/ExperimentResults.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ResultMatrix.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx
git commit -m "feat: repair missing experiment results"
```

Add Run Detail files only if changed.

---

## Task 13: Fix row geometry and build the scalable progress ledger

**Objective:** Show one full-width current row per task, keep controls sticky, disclose attempt history, and bound mounted rows.

**Files:**

- Modify: `src/ui/RecordRow.tsx`
- Modify: `src/ui/RecordRow.test.tsx`
- Create: `src/lib/evaluations/experiment-task-ledger.ts`
- Create: `src/lib/evaluations/experiment-task-ledger.test.ts`
- Create: `src/workspaces/evaluations/ExperimentTaskLedger.tsx`
- Create: `src/workspaces/evaluations/ExperimentTaskLedger.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentProgress.tsx`
- Modify: `src/workspaces/evaluations/ExperimentProgress.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentRoute.tsx`

### Step 1: Make the existing width test fail clearly

Add `data-record-row-surface` to the painted child, then verify it needs `w-full min-w-0` or `min-w-0 flex-1`.

### Step 2: Define a pure ledger view model

```ts
export type TaskLedgerFilter = "all" | "active" | "issues" | "queued" | "complete";

export interface TaskLedgerRow {
  taskId: string;
  order: number;
  title: string;
  status: string;
  scoredModels: number;
  totalModels: number;
  trialCount: number;
  currentAttemptId: string | null;
  history: ExperimentTaskAttempt[];
}
```

Test current selected/running state, issue filtering, canonical order, search, and page slicing.

### Step 3: Add the 250-task stress test

Render 250 tasks, eight models, and three attempts per task. Assert:

- at most 50 primary rows mount;
- attempt rows do not mount until disclosure opens;
- current task and Pause/Abort controls appear before the ledger;
- filtering does not mutate input order;
- page text announces `1–50 of 250`;
- short and long titles use the same row geometry.

### Step 4: Verify RED

```bash
npm test -- src/ui/RecordRow.test.tsx \
  src/lib/evaluations/experiment-task-ledger.test.ts \
  src/workspaces/evaluations/ExperimentTaskLedger.test.tsx \
  src/workspaces/evaluations/ExperimentProgress.test.tsx
```

### Step 5: Implement the ledger

- Sticky instrument header inside the route scroller.
- Counts: complete, partial, failed, queued.
- Search plus five status filters.
- One primary row per task.
- Stable columns for index, title, status, coverage, trial, time, action.
- Native `<details>` or existing accessible disclosure for history.
- 50 rows per page.
- No animation on filter or page changes.

Keep Pause/Resume and Abort in the sticky header. Keep retry/recovery actions visible nearby after work stops.

### Step 6: Verify GREEN

```bash
npm test -- src/ui/RecordRow.test.tsx \
  src/lib/evaluations/experiment-task-ledger.test.ts \
  src/workspaces/evaluations/ExperimentTaskLedger.test.tsx \
  src/workspaces/evaluations/ExperimentProgress.test.tsx \
  src/workspaces/evaluations/ExperimentRoute.test.tsx
npm run typecheck:web
```

### Step 7: Commit

```bash
git add src/ui/RecordRow.tsx \
  src/ui/RecordRow.test.tsx \
  src/lib/evaluations/experiment-task-ledger.ts \
  src/lib/evaluations/experiment-task-ledger.test.ts \
  src/workspaces/evaluations/ExperimentTaskLedger.tsx \
  src/workspaces/evaluations/ExperimentTaskLedger.test.tsx \
  src/workspaces/evaluations/ExperimentProgress.tsx \
  src/workspaces/evaluations/ExperimentProgress.test.tsx \
  src/workspaces/evaluations/ExperimentRoute.tsx
git commit -m "feat: scale experiment task progress"
```

---

## Task 14: Page and stabilize large result surfaces

**Objective:** Keep desktop and mobile results bounded while preserving matrix context and deep links.

**Files:**

- Create: `src/ui/Pagination.tsx`
- Create: `src/ui/Pagination.test.tsx`
- Modify: `src/workspaces/evaluations/ResultMatrix.tsx`
- Modify: `src/workspaces/evaluations/ResultMatrix.test.tsx`
- Modify: `src/workspaces/evaluations/MobileExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/MobileExperimentResults.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.test.tsx`

### Step 1: Write failing pagination and sticky-context tests

For 250 tasks assert:

- exactly 50 task rows/cards mount;
- URL search parameter stores the page;
- invalid/out-of-range page clamps safely;
- filter changes return to page one;
- first task column has `sticky left-0` and an opaque surface;
- column headers remain `sticky top-0`;
- horizontal scroll region stays keyboard-focusable;
- mobile mounts 50 cards or fewer;
- no page-level horizontal overflow class is introduced.

### Step 2: Verify RED

```bash
npm test -- src/ui/Pagination.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx
```

### Step 3: Implement shared pagination

Use `PAGE_SIZE = 50`. Render Previous/Next plus range text. Buttons remain 44px and expose disabled state.

Do not add a pagination library.

### Step 4: Make the first matrix column sticky

Apply `left-0` to:

- task header;
- every task row header;
- footer row labels.

Use correct z-index ordering where top and left sticky regions intersect. The sticky cells need an opaque `bg-panel` or `bg-card` so scores do not bleed through.

### Step 5: Verify GREEN

```bash
npm test -- src/ui/Pagination.test.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx
npm run typecheck:web
```

### Step 6: Commit

```bash
git add src/ui/Pagination.tsx \
  src/ui/Pagination.test.tsx \
  src/workspaces/evaluations/ResultMatrix.tsx \
  src/workspaces/evaluations/ResultMatrix.test.tsx \
  src/workspaces/evaluations/MobileExperimentResults.tsx \
  src/workspaces/evaluations/MobileExperimentResults.test.tsx \
  src/workspaces/evaluations/ExperimentResults.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx
git commit -m "feat: bound large experiment results"
```

---

## Task 15: Add integrated browser QA and final evidence

**Objective:** Verify transport, model testing, recovery, ranking, large-suite layout, accessibility, and motion constraints in a production preview.

**Files:**

- Create: `scripts/cdp-suite-reliability-qa.mjs`
- Modify: `package.json`
- Create: `docs/qa/suite-execution-reliability/README.md`
- Generated by QA: `docs/qa/suite-execution-reliability/results.json`
- Generated by QA: screenshots under `docs/qa/suite-execution-reliability/`
- Modify: `docs/specs/archive/suite-execution-reliability/suite-execution-reliability-spec.md` only for factual shipped-state corrections
- Modify: `docs/specs/archive/suite-execution-reliability/implementation-plan.md` only for factual command/path corrections

### Step 1: Add the script contract

Add:

```json
"qa:suite-reliability": "node scripts/cdp-suite-reliability-qa.mjs"
```

The script must fail nonzero on an unmet assertion and must not print credentials.

### Step 2: Test deterministic fixtures

Use local mock routes or existing provider test doubles for browser QA. Do not make paid provider calls in automated CI.

Scenarios:

1. ready, failed, and untested model preflight;
2. failed preflight confirmation with unchanged roster;
3. complete winner at 15/15 and provisional leader at 14/15;
4. one-cell repair cost preview and completion;
5. failed repair preserving better selected evidence;
6. 250-task progress at page one and page five;
7. attempt history collapsed and expanded;
8. 250-task matrix with sticky first column;
9. mobile pagination;
10. keyboard-only controls, Escape, and focus restoration;
11. 200% zoom;
12. reduced motion.

### Step 3: Run targeted transport verification

```bash
npm test -- server/tests/sse-termination.test.ts \
  server/tests/nine-router.test.ts \
  src/lib/providers/model-probe.test.ts
```

Expected: PASS.

### Step 4: Run the full automated gate

```bash
npm run check
git diff --check
```

Expected:

- web and server TypeScript pass;
- all Vitest files pass;
- production build passes;
- no whitespace errors.

Do not report counts from memory. Record the actual output in the QA README.

### Step 5: Run production-preview browser QA

Terminal A:

```bash
npm run build
npm run preview -- --host 127.0.0.1
```

Terminal B:

```bash
npm run qa:suite-reliability
npm run qa:design-motion
```

Expected: both scripts exit 0 and write inspectable evidence.

Open every generated screenshot. Verify there is no clipping, overlap, hidden focus, page-level mobile overflow, contradictory ranking label, or content-sized task bar.

### Step 6: Inspect security and worktree

```bash
git status --short
git diff --check
git diff -- server src scripts package.json docs/qa/suite-execution-reliability \
  docs/specs/archive/suite-execution-reliability
```

Search changed text for credential-shaped content without printing environment values.

### Step 7: Commit QA evidence

```bash
git add scripts/cdp-suite-reliability-qa.mjs \
  package.json \
  docs/qa/suite-execution-reliability \
  docs/specs/archive/suite-execution-reliability
git commit -m "test: verify suite execution reliability"
```

---

## 2. Final acceptance checklist

### Transport

- [ ] Only 9Router clean output-bearing EOF is normalized.
- [ ] Existing `[DONE]` is never duplicated.
- [ ] Empty, aborted, and throwing streams remain failures.
- [ ] Other providers retain current strict behavior.

### Preflight

- [ ] Exact candidate and Judge routes can be tested.
- [ ] Test and Save remain separate states.
- [ ] Probe state invalidates after slot or credential changes.
- [ ] Failed preflight warns without changing the roster.
- [ ] Probe failures are sanitized.

### Ranking

- [ ] Winner math remains complete-coverage-only.
- [ ] Incomplete higher means are provisional.
- [ ] Provisional models receive no numeric rank or crown.

### Recovery

- [ ] Terminal results expose full-task fallback retry.
- [ ] One missing cell can execute one candidate plus one fresh Judge.
- [ ] Reused candidate output carries immutable provenance.
- [ ] Prior Judge scores are never copied.
- [ ] Lower-coverage repair cannot displace better evidence.
- [ ] Lease, fence, abort, recovery, and persistence boundaries remain intact.

### Large suites

- [ ] Task rows are equal full width.
- [ ] One primary row appears per task.
- [ ] Attempt history is collapsed by default.
- [ ] Controls and current task remain sticky.
- [ ] No page mounts more than 50 primary tasks.
- [ ] Matrix headers and first task column remain sticky.
- [ ] Mobile has no page-level horizontal overflow.

### Verification

- [ ] `npm run check` passes with actual output recorded.
- [ ] `git diff --check` passes.
- [ ] Production-preview reliability QA passes.
- [ ] Existing design-motion QA passes.
- [ ] Screenshots were opened and inspected.
- [ ] No credentials or unrelated files entered any commit.

## 3. Expected commit sequence

1. `test: lock suite reliability regressions`
2. `fix: normalize clean 9router stream endings`
3. `feat: add exact model route probes`
4. `feat: test selected model routes`
5. `feat: confirm suite model preflight`
6. `fix: distinguish provisional experiment leaders`
7. `feat: retry incomplete tasks from results`
8. `feat: track experiment repair provenance`
9. `feat: plan compound experiment repairs`
10. `feat: execute targeted candidate repairs`
11. `feat: orchestrate missing cell repairs`
12. `feat: repair missing experiment results`
13. `feat: scale experiment task progress`
14. `feat: bound large experiment results`
15. `test: verify suite execution reliability`

Every commit must be independently green for its targeted tests. The final commit requires the full gate.
