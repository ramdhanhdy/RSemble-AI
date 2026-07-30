# Evaluation Workspaces Implementation Plan

> **For Hermes:** Use `subagent-driven-development` to execute this plan task-by-task. Apply TDD for every behavioral change and obtain spec-compliance plus code-quality review after each phase. Do not push without explicit user permission.

**Goal:** Add separate Compare, Runs, and Evaluations workspaces; persist auditable run history; replace the generic rubric with anchored evaluation profiles; and execute small multi-task evaluation suites with transparent result aggregation.

**Architecture:** Keep the existing provider-agnostic fanout → blind Judge → Rank/Fuse pipeline as the per-task engine. Add a routed app shell, IndexedDB repositories behind interfaces, and full run snapshots keyed by one stable run ID. Implement suites as sequential orchestration of the same task engine, with experiment snapshots and a model-by-task result matrix. Do not add semantic search, multiple trials, multiple Judges, or advanced ranking statistics.

**Tech stack:** React 18, TypeScript, Vite 8, Vitest 4, happy-dom, Tailwind CSS, React Router, Dexie, fake-indexeddb for tests, existing reducer/controller and provider adapters.

**Companion spec:**
`docs/specs/evaluation-workspaces/evaluation-workspaces-spec.md`

**Roadmap:**
`docs/roadmaps/evaluation-workbench-roadmap.md`

---

## Repository and execution guard

At plan creation:

```text
branch: master
relation: synchronized with origin/master
tracked modifications: none
untracked documentation:
  docs/roadmaps/evaluation-workbench-roadmap.md
  docs/specs/evaluation-workspaces/evaluation-workspaces-spec.md
  docs/specs/evaluation-workspaces/implementation-plan.md
```

Before every phase:

```bash
git status --short --branch
git diff --check
```

Rules:

- Re-read a target file if it changed after this plan was written.
- Stage explicit paths only. Do not use `git add .` or `git add -A`.
- Keep `src/lib/pipeline.ts` provider-agnostic.
- Preserve provider-specific model-ID validation and opaque IDs.
- Preserve strict Judge parsing, blind labels, Judge explanations, abort epochs, stage-local retry, and partial-candidate behavior.
- Never persist or print credentials, authorization headers, environment dumps, or Codex auth contents.
- Never silently resume paid model calls after reload.
- Keep Compare operational at the end of every phase.
- Phase commits are integration checkpoints, not independently shippable releases; do not push or deploy the temporary workspace placeholders.
- Remove every placeholder before the final quality gate, and never present a placeholder control as functional.
- Do not implement embeddings, clustering, multiple Judges, multiple trials, arbitrary task weights, confidence intervals, or pairwise ranking in this plan.
- No push, merge, rebase, destructive cleanup, or schema-data deletion without user approval.
- Numbered failing-test lists are acceptance envelopes, not one giant red step: implement them in 1–3 closely related assertions per RED → GREEN → REFACTOR cycle.

## Milestone map

| Phase | Deliverable | Main gate |
|---|---|---|
| 0 | Authority docs and routed three-workspace shell | shell tests + 390px nav QA |
| 1 | IndexedDB repositories and legacy-summary migration | repository/migration tests |
| 2 | Shared task executor and complete one-ID lifecycle persistence | executor + lifecycle tests |
| 3 | Searchable Runs workspace and run detail | Runs component + browser tests |
| 4 | Anchored evaluation profiles and Compare migration | pipeline/parser + editor tests |
| 5 | Suite/profile persistence and suite editor | repository + suite UI tests |
| 6 | Sequential experiment execution | executor/controller state-machine tests |
| 7 | Experiment progress, result matrix, and aggregation | matrix/aggregate + browser tests |
| 8 | Export/import, accessibility, docs, and full QA | `npm run check` + audit + visual QA |

---

## Phase 0: Amend authority and establish the routed shell

### Task 0.1: Capture the clean baseline

**Objective:** Record current behavior before changing product scope or shell structure.

**Files:** Read only.

**Steps:**

1. Run:

```bash
npm test -- src/rsemble-shell.test.tsx src/ui/OutputPane.test.tsx src/ui/ModelList.test.tsx
npm run typecheck:web
```

2. Record exact pass counts.
3. Inspect:

```text
src/main.tsx
src/rsemble.tsx
src/ui/Header.tsx
src/rsemble-shell.test.tsx
```

4. Confirm `src/rsemble-shell.test.tsx` currently forbids primary navigation. Treat that assertion as superseded behavior, not a regression to preserve.

**Expected:** Existing shell tests and web typecheck pass before changes.

### Task 0.2: Update product authority

**Objective:** Make the approved workspace direction authoritative before feature code ships.

**Files:**

- Modify: `PRODUCT.md`
- Modify locally (intentionally Git-ignored): `UI.md`
- Modify locally (intentionally Git-ignored): `DESIGN.md`
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md`
- Add: `docs/roadmaps/evaluation-workbench-roadmap.md`
- Add: `docs/specs/evaluation-workspaces/evaluation-workspaces-spec.md`
- Add: `docs/specs/evaluation-workspaces/implementation-plan.md`

**Steps:**

1. Add Compare, Runs, and Evaluations to `PRODUCT.md` in-scope capabilities.
2. Replace the blanket datasets/benchmarks exclusion with the constrained local evaluation-suite contract, including Evaluations-local Suites/Profiles navigation and experiment history.
3. Preserve Rank/Fuse as the per-task finish and the provider-agnostic pipeline.
4. Add primary workspace navigation, routes, Runs behavior, Evaluations behavior, Evaluation disclosure, and the working-surface versus audit-surface rule to `UI.md`.
5. Add the breakpoint-specific header budget, 32–36px cross-workspace strip, status tokens, compact provider/model labels, shared record rows, shared split behavior, monochrome matrix, task editor, and responsive patterns to `DESIGN.md`.
6. Record the product expansion as the next numbered decision in `DECISIONS.md`.
7. Update `CLAUDE.md` so agents cannot use the old scope fence to reject approved workspaces.
8. Ensure all authority documents distinguish committed structured workspaces from exploratory semantic history intelligence.

**Verification:**

```bash
git diff --check
```

Read the modified scope sections side by side. No document may still say that all datasets, benchmarks, primary navigation, or result workspaces are forbidden. `UI.md` and `DESIGN.md` remain local ignored authority; do not force-add them or change `.gitignore`. The tracked evaluation spec repeats their required constraints so the implementation contract remains shareable.

### Task 0.3: Install mature routing dependency

**Objective:** Use maintained routing instead of a custom URL-state implementation.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

**Steps:**

1. Check the current stable package version and compatibility with React 18 and TypeScript 5.6.
2. Install:

```bash
npm install react-router-dom
```

3. Run:

```bash
npm audit --audit-level=high
npm run typecheck:web
```

**Expected:** Zero high-severity audit findings and no typecheck regression.

### Task 0.4: Write failing route and navigation tests

**Objective:** Define the three-workspace shell before implementation.

**Files:**

- Modify: `src/rsemble-shell.test.tsx`
- Create: `src/ui/WorkspaceNav.test.tsx`
- Later create: `src/app-router.tsx`
- Later create: `src/ui/WorkspaceNav.tsx`

**Failing tests:**

1. `/compare`, `/runs`, and `/evaluations` render distinct workspace headings.
2. root redirects to `/compare`.
3. unknown route renders a Return to Compare link.
4. desktop primary nav has `aria-label="Primary"`.
5. exactly one link has `aria-current="page"`.
6. Rank/Fuse appears on Compare and not on Runs/Evaluations.
7. mobile navigation exposes three visible labels and 44px targets.
8. browser navigation does not reset the Compare reducer state.
9. workspace links remain enabled while a run is active.
10. the old “no primary navigation” assertion is absent;
11. at a 768 CSS-pixel viewport the header remains one row and preserves identity, three workspace labels, execution status, and Compare-only Rank/Fuse; at 200% zoom it may reflow to the specified mobile shell without losing controls;
12. tablet palette/help controls become icon-only before connection text compacts, with accessible names retained.

**Run red:**

```bash
npm test -- src/rsemble-shell.test.tsx src/ui/WorkspaceNav.test.tsx
```

**Expected:** New tests fail because no router or workspace navigation exists.

### Task 0.5: Extract shell navigation with minimal Compare movement

**Objective:** Add routed workspaces without rewriting the Compare engine.

**Files:**

- Create: `src/app-router.tsx`
- Create: `src/ui/WorkspaceNav.tsx`
- Create: `src/ui/MobileWorkspaceNav.tsx`
- Create: `src/workspaces/RunsWorkspace.tsx` as honest empty placeholder
- Create: `src/workspaces/EvaluationsWorkspace.tsx` as honest empty placeholder
- Modify: `src/main.tsx`
- Modify: `src/rsemble.tsx`
- Modify: `src/ui/Header.tsx`
- Modify: `src/index.css` only for safe-area utility if needed

**Implementation requirements:**

- Use `HashRouter` for refresh-safe local routes.
- Tests render the route tree with `MemoryRouter`.
- Keep provider probes, controller refs, state reducer, and modals mounted above routed workspace content.
- Extract the current Compare body into a private component or `src/workspaces/CompareWorkspace.tsx` only when that reduces complexity; do not duplicate controller ownership.
- Header receives generic execution state rather than requiring Runs/Evaluations to fabricate a `StudioState`.
- Render desktop `WorkspaceNav` at `md` and above.
- Render `MobileWorkspaceNav` below `md`.
- Add bottom padding to mobile workspace content for navigation and safe-area inset.
- Keep command drawer affordance Compare-only.
- Keep global connection status visible; compact its visible text only at `768–1023px` after palette/help labels collapse.
- Encode the fixed header sacrifice order from the spec; do not rely on arbitrary flex shrink or hide primary destinations.
- Do not add an inert Runs or Evaluations action. Placeholder workspaces must clearly say the feature is not yet implemented and provide no fake controls.

**Run green:**

```bash
npm test -- src/rsemble-shell.test.tsx src/ui/WorkspaceNav.test.tsx
npm run typecheck:web
```

**Browser verification:**

- 1440×900: header links fit without displacing status/actions.
- 1024×768: primary nav remains visible.
- 768×1024 portrait: header stays one row with no clipping/wrapping and the specified icon-only/compact states.
- 390×844: bottom nav has no clipping or page-level horizontal overflow.
- keyboard: tab order reaches all three destinations, icon-only actions retain accessible names/tooltips, and active state is announced.

**Commit after Phase 0:**

```bash
git add PRODUCT.md DECISIONS.md CLAUDE.md \
  docs/roadmaps/evaluation-workbench-roadmap.md \
  docs/specs/evaluation-workspaces/evaluation-workspaces-spec.md \
  docs/specs/evaluation-workspaces/implementation-plan.md \
  package.json package-lock.json \
  src/main.tsx src/rsemble.tsx src/index.css \
  src/app-router.tsx src/ui/Header.tsx src/ui/WorkspaceNav.tsx \
  src/ui/MobileWorkspaceNav.tsx src/ui/WorkspaceNav.test.tsx \
  src/workspaces/RunsWorkspace.tsx src/workspaces/EvaluationsWorkspace.tsx \
  src/rsemble-shell.test.tsx
if test -f src/workspaces/CompareWorkspace.tsx; then git add src/workspaces/CompareWorkspace.tsx; fi
git commit -m "feat: establish evaluation workspace shell"
```

---

## Phase 1: Add durable repositories and legacy migration

### Task 1.0: Install persistence dependencies

**Objective:** Add maintained IndexedDB access and a deterministic test implementation only when persistence work begins.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`

**Steps:**

1. Check current stable versions and Dexie compatibility with the project toolchain.
2. Install:

```bash
npm install dexie
npm install --save-dev fake-indexeddb
```

3. Verify:

```bash
npm audit --audit-level=high
npm run typecheck:web
```

### Task 1.1: Define run, profile, suite, and experiment types

**Objective:** Establish serializable domain contracts independent of Dexie and React.

**Files:**

- Create: `src/lib/persistence/run-types.ts`
- Create: `src/lib/evaluations/evaluation-types.ts`
- Create: `src/lib/persistence/run-types.test.ts`

**Required types:**

- `RunStatus`
- `AttemptStatus`
- `ExecutionFence`
- `FullRunSummaryV2`
- `LegacyRunSummary`
- discriminated `RunSummary`
- `RunRecordV2`
- `RunSource`
- `PersistedCandidate`
- `CandidateAttemptRecord`
- `JudgeAttemptRecord`
- `FusionAttemptRecord`
- `RunArchiveV1`
- `RunListQuery`
- `EvaluationCriterion`
- `EvaluationProfile`
- `ProfileRecord`
- `EvaluationProfileSnapshot`
- `EvaluationProfileRef`
- `EvaluationSelection`
- `TaskEvaluationSelection`
- `EvaluationTask`
- `EvaluationSuite`
- `ExperimentRecord`
- `ExperimentTaskAttempt`

**Failing tests:**

1. runtime validators reject unknown schema versions;
2. validators reject records with missing IDs, prohibited transport/credential fields, or invalid status values;
3. provider-scoped model keys remain opaque strings, and every full candidate has immutable `candidateId`, `slotId`, and `modelKey`;
4. profile validation requires 1/3/5 anchors and at least one positive weight when non-holistic;
5. task evaluation validation distinguishes inherit, holistic, and pinned-profile selections without nullable inference;
6. suite validation requires non-empty name, valid tasks, at least two enabled models, and unique enabled `providerId:modelSlug` keys before execution;
7. validation accepts empty Fusion-attempt history and discriminated legacy summary-only records;
8. legacy summaries cannot carry fabricated status, mode, Judge, source, or evaluation fields;
9. winner arrays preserve zero, one, or multiple tied winners;
10. experiment run sources require immutable `experimentTaskAttemptId`;
11. profile archive state validates only on mutable `ProfileRecord`, never on immutable `EvaluationProfile` versions.

Use explicit type guards. Do not trust imported JSON via TypeScript casts.

**Run red:**

```bash
npm test -- src/lib/persistence/run-types.test.ts
```

### Task 1.2: Create the Dexie database and repository interfaces

**Objective:** Centralize storage and keep UI/controller code independent of Dexie.

**Files:**

- Create: `src/lib/persistence/database.ts`
- Create: `src/lib/persistence/run-repository.ts`
- Create: `src/lib/persistence/evaluation-repository.ts`
- Create: `src/lib/persistence/repository-context.tsx`
- Create: `src/lib/persistence/run-repository.test.ts`
- Create: `src/lib/persistence/evaluation-repository.test.ts`
- Modify: `src/app-router.tsx` or app root to provide repositories

**Dexie schema:**

```text
runSummaries: id, kind, revision, createdAt, completedAt, status, mode, source.kind, source.protocolFingerprint, source.experimentTaskAttemptId, *modelKeys
runDetails: id, revision, createdAt, status
profiles: id, revision, latestVersion, updatedAt, archivedAt
profileVersions: [id+version], id, version, updatedAt
suites: id, revision, version, updatedAt, archivedAt
experiments: id, revision, suiteId, suiteVersion, protocolFingerprint, createdAt, status
storageMeta: key
```

**Database contract:** `RSembleEvaluationDB`, Dexie schema version `1`. Add explicit upgrade, `blocked`, and `versionchange` handling before any paid execution is wired.

**Failing tests using `fake-indexeddb/auto`:**

1. creating a run writes summary and detail atomically;
2. repository returns summaries newest first;
3. listing does not require loading detail records;
4. combined model/status/mode/source filters work;
5. text query matches normalized title/excerpt/model search text;
6. update requires `expectedRevision`, increments revision atomically, and rejects stale or illegal terminal-state regressions;
7. atomic `importLegacySummary` writes only a discriminated summary and never requires detail;
8. same-ID create is rejected rather than silently overwritten;
9. suite/profile-identity/profile-version/experiment CRUD round-trips with revision checks;
10. archiving hides a suite or profile identity by default, preserves every immutable profile version, and creates no semantic profile version;
11. transaction failure writes neither summary nor detail;
12. filtering is applied before pagination, so a match outside the first 50 records is returned;
13. repository subscriptions notify once after a committed mutation and never after rollback;
14. blocked/version-change states stop writes and expose a retryable classified error;
15. initialization failure leaves Compare mounted with Retry storage plus a confirmed ephemeral-run capability while Runs/Evaluations remain unavailable.

**Run red:**

```bash
npm test -- src/lib/persistence/run-repository.test.ts src/lib/persistence/evaluation-repository.test.ts
```

**Implementation rules:**

- export interfaces separately from Dexie classes;
- tests can inject an in-memory repository without IndexedDB;
- UI imports interfaces/hooks, not the database singleton;
- profile versions are immutable and earlier versions remain retrievable; archive/restore mutates only revisioned `ProfileRecord` metadata;
- suites pin `{ id, version }` profile references and do not follow “latest” silently;
- suite/task evaluation choices use tagged unions rather than nullable inference;
- normalize searchable summary text once on write;
- paginate query results at 50 only after all requested filters are applied;
- catch and classify quota, unavailable, validation, and conflict errors.

**Run green:**

```bash
npm test -- src/lib/persistence/run-repository.test.ts src/lib/persistence/evaluation-repository.test.ts
npm run typecheck:web
```

### Task 1.3: Migrate localStorage history once

**Objective:** Preserve existing summaries without fabricating unavailable detail.

**Files:**

- Create: `src/lib/persistence/legacy-history-migration.ts`
- Create: `src/lib/persistence/legacy-history-migration.test.ts`
- Modify: `src/lib/run-history.ts` only to expose a safe raw legacy reader if needed
- Modify: app startup provider

**Failing tests:**

1. v1 entries import through `importLegacySummary` with `kind: "legacy"` and `detailAvailable: false`;
2. task excerpt, timestamp, scores, model keys, and winner survive;
3. migration ID is deterministic for the same source entry;
4. repeated startup does not duplicate imports;
5. malformed entries are skipped and reported;
6. migration failure leaves the localStorage source and marker untouched;
7. successful migration leaves the source key intact but writes a completion marker;
8. no status, mode, source, Judge identity, evaluation metadata, candidate output, report, or configuration is invented.

**Run red:**

```bash
npm test -- src/lib/persistence/legacy-history-migration.test.ts
```

**Run green:**

```bash
npm test -- src/lib/persistence/legacy-history-migration.test.ts src/lib/run-history.test.ts
```

### Task 1.4: Add a cross-tab execution lease and safe startup recovery

**Objective:** Make stale paid-work state honest after reload without one tab interrupting work owned by another.

**Files:**

- Create: `src/lib/execution-lease.ts`
- Create: `src/lib/execution-lease.test.ts`
- Modify: `src/lib/persistence/run-repository.ts`
- Test: `src/lib/persistence/run-repository.test.ts`
- Modify: app startup provider

**Failing tests:**

1. first tab acquires a random owner-ID lease through an atomic IndexedDB `storageMeta` transaction, heartbeats by revisioned transaction, and broadcasts status notifications;
2. a live second tab cannot acquire execution ownership and exposes read-only execution controls;
3. expired lease can be acquired, but never silently resumes paid work;
4. only the lease owner converts stale `running` summaries/details with expired ownership to `interrupted`;
5. completed/failed/aborted records are unchanged;
6. recovery is idempotent;
7. blocked/version-change storage prevents lease-backed execution start;
8. fake timers cover heartbeat, expiry, and crash takeover; a deferred two-tab transaction test proves simultaneous acquisition has exactly one winner;
9. BroadcastChannel loss/delay does not permit a second owner because IndexedDB remains authoritative;
10. takeover increments a monotonic fence, and a delayed write carrying the old owner/fence is rejected transactionally;
11. every durable initial Run, candidate retry, Judge retry, Rank→Fuse, Re-fuse, experiment start, Resume, and Retry incomplete tasks verifies the active owner/fence immediately before its provider call;
12. losing the lease between stages prevents the next paid stage and rejects later durable writes;
13. post-run candidate retry, Judge retry, Rank→Fuse, and Re-fuse reacquire ownership, persist the new fence at attempt start, preserve any accepted overall status while active, and release only after terminal persistence.

**Run green:**

```bash
npm test -- src/lib/execution-lease.test.ts src/lib/persistence/run-repository.test.ts
npm run typecheck:web
```

**Commit after Phase 1:**

```bash
git add src/lib/persistence src/lib/evaluations/evaluation-types.ts \
  src/lib/execution-lease.ts src/lib/execution-lease.test.ts src/app-router.tsx src/lib/run-history.ts package.json package-lock.json
git commit -m "feat: add durable evaluation repositories"
```

---

## Phase 2: Extract shared execution and persist the complete run lifecycle

### Task 2.1: Characterize current controller history behavior

**Objective:** Protect existing pipeline invariants while replacing summary-only writes.

**Files:**

- Modify: `src/lib/run-controller.test.ts`
- Later modify: `src/lib/run-controller.ts`

**Add characterization tests:**

1. Rank success currently reaches one history write point.
2. Fuse success reaches its history write point.
3. Rank→Fuse uses the same candidates and Judge report.
4. Judge retry makes no candidate stream calls.
5. abort and stale epochs suppress late results.
6. partial candidate success can still reach Judge with at least two usable candidates;
7. candidate providers execute concurrently and stream through the existing buffer boundary;
8. strict blind Judge parsing, optional Fusion, retry, and epoch suppression retain their current event order.

Run these before changing implementation.

### Task 2.2: Extract a provider-agnostic run executor

**Objective:** Reuse one task engine from Compare and experiments without a fake React reducer.

**Files:**

- Create: `src/lib/run-executor.ts`
- Create: `src/lib/run-executor.test.ts`
- Modify: `src/lib/run-controller.ts`
- Modify: `src/lib/run-controller.test.ts`

**Required shape:**

```ts
interface CandidateTaskSnapshot {
  prompt: string;
  systemPrompt: string;
  temperature: number;
}

interface FrozenEvaluationInput {
  legacyRubric: RubricCriterion[];
}

interface RunRequest {
  source: RunSource;
  mode: "rank" | "fuse";
  task: CandidateTaskSnapshot;
  evaluation: FrozenEvaluationInput;
  slots: ModelSlot[];
  critic: CriticRef;
  judgeInstruction: string;
}

interface RunExecutorEvents {
  onFanoutStart(...): Promise<void>;
  onCandidateDelta(...): void;
  onCandidateTerminal(...): void;
  onFanoutTerminal(...): Promise<void>;
  onCandidateAttemptStart(...): Promise<void>;
  onCandidateAttemptTerminal(...): Promise<void>;
  onJudgeStart(...): Promise<void>;
  onJudgeTerminal(...): Promise<void>;
  onFusionStart(...): Promise<void>;
  onFusionTerminal(...): Promise<void>;
}

interface RunExecutor {
  executeTask(request: RunRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
  retryCandidate(request: FrozenCandidateRetryRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
  retryJudge(request: FrozenJudgeRetryRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
  executeFusionAttempt(request: FrozenFusionRequest, events: RunExecutorEvents, signal: AbortSignal): Promise<void>;
}
```

`FrozenCandidateRetryRequest` contains that candidate’s frozen task/model snapshot plus the frozen peer candidates, evaluation, Judge, and mode required for the existing retry → re-Judge → optional re-Fuse chain. `FrozenJudgeRetryRequest` is built only from persisted/frozen candidate and evaluation snapshots. `FrozenFusionRequest` is built only from accepted candidates, accepted Judge evidence, and the frozen evaluation snapshot. Neither command reads mutable React state.

**Failing tests:**

1. executor runs candidate providers in parallel;
2. duplicate enabled opaque provider/model keys fail validation before any provider call; Rank request never calls Fusion;
3. Fuse request calls Fusion only after valid Judge;
4. abort suppresses stale events and queue completion;
5. rejected fanout-start makes zero provider calls; rejected fanout-terminal stops before Judge; rejected Judge-start makes zero Judge calls; rejected Judge-terminal stops before Fusion; rejected Fusion-start makes zero Fusion calls;
6. exact rendered messages and the frozen current evaluation input are emitted;
7. provider transport remains behind registry adapters;
8. Compare adapter emits the same reducer action sequence as before extraction;
9. candidate retry resolves immutable `slotId`; failure makes no downstream calls, while success opens/runs a new Judge and, only after Judge success in Fuse mode, a new Fusion attempt from frozen inputs;
10. Judge retry makes zero candidate and Fusion calls and uses only its frozen request;
11. Fusion/Re-fuse makes zero candidate/Judge calls and uses only its frozen request;
12. candidate-retry, Judge, and Fusion start/terminal persistence events are awaited exactly once while stream deltas are never persisted;
13. every durable paid executor command verifies the current execution fence immediately before the provider adapter call; the sole exception is a separately tested, explicitly confirmed ephemeral Compare command when storage initialization is unavailable.

**Implementation rules:**

- move orchestration, not provider adapters, into executor;
- `executeTask`, `retryCandidate`, `retryJudge`, and `executeFusionAttempt` are the only paid-stage entry points;
- keep the existing stream buffer at the Compare adapter boundary or make event buffering explicit;
- retain `run-controller.ts` as the Compare UI adapter, including stage-local retry;
- `FrozenEvaluationInput` preserves the current rubric snapshot during extraction; Phase 4 removes this bounded transitional type and replaces it with `EvaluationProfileSnapshot | null`;
- no prompt, scoring, or retry behavior rewrite is hidden inside extraction;
- run all existing controller tests after each extraction step.

### Task 2.3: Create pure run-record builders

**Objective:** Convert controller state/events into serializable records without storage side effects.

**Files:**

- Create: `src/lib/persistence/run-record-builder.ts`
- Create: `src/lib/persistence/run-record-builder.test.ts`

**Failing tests:**

1. fanout start creates one stable run ID plus one `running` candidate attempt per enabled slot in the summary/detail;
2. the executor `IdFactory` generates run, candidate, candidate-attempt, Judge-attempt, and Fusion-attempt IDs through `crypto.randomUUID` with deterministic test injection before start events; persistence never invents identity;
3. each candidate retains immutable `candidateId`, snapshot `slotId`, opaque `modelKey`, accepted-attempt pointer, and append-only attempts with rendered messages, output/tokens when available, timings, and bounded redacted errors;
4. candidate retry appends a running attempt before its call; success moves the accepted pointer and failure preserves prior accepted output;
5. Judge success retains report, consensus, pipeline-supplied scores, explicit `winnerKeys`, and an accepted-attempt pointer; Phase 4 makes profile scoring canonical;
6. every Judge attempt is first built as `running` with immutable attempt ID, provider/model, instruction, exact rendered messages, `blindLabelToCandidateId`, `candidateAttemptIdsByCandidateId`, and start timestamp, then finalized in place; candidate IDs never change across Judge retries;
7. candidate retry may start a new Judge attempt after earlier acceptance; its failure preserves the prior accepted Judge and exact candidate-attempt references, while direct Judge-only recovery remains available only until one attempt is accepted;
8. Fusion/Re-fuse likewise append a durable `running` attempt with source Judge and candidate-attempt IDs before the provider call, finalize that same attempt, and move the accepted pointer only on success;
9. summary search text contains task title/excerpt and model IDs;
10. no prohibited transport/credential fields are accepted or serialized;
11. source metadata distinguishes ad hoc and experiment task runs and carries the experiment protocol fingerprint;
12. status derivation covers complete, partial candidate, insufficient candidate, Judge failure, Fusion failure, failed Re-fuse with prior accepted result, abort, and interruption;
13. equal top canonical scores produce multiple `winnerKeys` rather than stable-sort winner credit.

**Run red:**

```bash
npm test -- src/lib/persistence/run-record-builder.test.ts
```

### Task 2.4: Add a run recorder abstraction

**Objective:** Persist stage boundaries transactionally and expose failures to orchestration.

**Files:**

- Create: `src/lib/persistence/run-recorder.ts`
- Create: `src/lib/persistence/run-recorder.test.ts`

**Required interface:**

```ts
interface RunRecorder {
  begin(input: BeginRunInput): Promise<string>;
  saveFanout(runId: string, input: FanoutTerminalInput): Promise<void>;
  beginCandidateAttempt(runId: string, candidateId: string, attemptId: string, input: CandidateAttemptStartInput): Promise<void>;
  finishCandidateAttempt(runId: string, candidateId: string, attemptId: string, input: CandidateTerminalInput): Promise<void>;
  beginJudgeAttempt(runId: string, attemptId: string, input: JudgeAttemptStartInput): Promise<void>;
  finishJudgeAttempt(runId: string, attemptId: string, input: JudgeTerminalInput): Promise<void>;
  beginFusionAttempt(runId: string, attemptId: string, input: FusionAttemptStartInput): Promise<void>;
  finishFusionAttempt(runId: string, attemptId: string, input: FusionTerminalInput): Promise<void>;
  markAborted(runId: string): Promise<void>;
}
```

**Failing tests:**

- stage updates preserve immutable accepted candidate/Judge data; candidate retry durably appends/finalizes one attempt and never overwrites a prior accepted attempt;
- Judge start persists `running` before the call; terminal success/failure/abort finalizes that same ID, and recovery appends a new attempt without rewriting prior failures;
- Fusion/Re-fuse start persists `running` before the call; terminal completion finalizes the same ID, and failed Re-fuse preserves the prior accepted Fusion;
- recorder serializes writes per run ID and rejects an unknown run ID;
- repository error is propagated with stage context;
- no method writes streamed deltas;
- stage status and summary status remain consistent;
- every update uses `expectedRevision` plus the active execution fence, and illegal terminal-state regressions fail inside the repository transaction;
- delayed fanout/Judge/Fusion saves cannot overwrite a later abort; startup recovery changes persisted running attempts to interrupted;
- abort during `begin` results in a durable aborted record, finalizes every running candidate/Judge/Fusion attempt as aborted, and makes zero provider calls;
- deferred experiment-style updates demonstrate the same compare-and-swap invariant.

### Task 2.5: Inject persistence into the run controller

**Objective:** Replace both `addRun` calls with one lifecycle record.

**Files:**

- Modify: `src/lib/run-controller.ts`
- Modify: `src/lib/run-controller.test.ts`
- Modify: `src/studio-engine.ts`
- Modify: `src/studio-engine.test.ts`
- Modify: `src/rsemble.tsx`
- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/ModelList.test.tsx`
- Modify or retire: `src/lib/history-cache.ts`

**Failing controller tests:**

1. recorder begins before the first provider call;
2. begin failure or duplicate enabled model identity makes zero provider calls and surfaces a field/persistence error respectively;
3. fanout terminal results are saved before Judge starts;
4. fanout save failure stops before Judge;
5. Judge attempt is durably opened before its provider call and success finalizes the same attempt/run ID;
6. Judge start-write failure makes zero Judge calls, while terminal failure persists candidates and attempt metadata;
7. Rank→Fuse/Re-fuse verifies the lease, durably opens a Fusion attempt before the provider call, and updates the same run without another summary;
8. explicit abort marks the active run aborted even when a stage write is deferred;
9. stale completion fails its revision, epoch, or execution-fence guard and does not mutate persistence;
10. candidate retry and Judge retry each reverify the lease; Judge retry durably appends an attempt and preserves candidates;
11. retry after profile/prompt edits uses the frozen run snapshot;
12. provider secrets are absent from recorder calls;
13. uninitialized storage requires explicit Run without history confirmation for every Compare command; this is the sole unfenced paid path, uses an in-memory event sink, and creates no lease or repository record;
14. confirmation warns that history, crash recovery, and cross-tab exclusion are unavailable; an ephemeral mounted result remains exportable but is never auto-backfilled after recovery;
15. ephemeral execution is unavailable to experiments and to any command on a run that began durably; each later command on an in-memory ephemeral run requires fresh confirmation;
16. mid-run persistence failure preserves mounted output and prevents the next paid stage.

**Implementation requirements:**

- add `runId: string | null` to frozen current-run context;
- keep provider orchestration in `RunExecutor`; inject `RunRecorder` and adapt executor events through `RunControllerDeps`;
- remove direct `addRun` and cache invalidation from controller;
- persist exact candidate and Judge messages already rendered for provider calls;
- save only terminal candidate text, not every delta;
- add truthful reducer state/action for persistence failure;
- keep Compare operational if storage initialization is unavailable: expose Retry storage plus **Run without history**, require confirmation for every ephemeral run, keep its evidence in memory only, and permit existing human-readable export while mounted;
- never auto-backfill ephemeral evidence after storage recovery, never offer ephemeral experiments, and warn that cross-tab ownership cannot be coordinated in degraded mode;
- if persistence fails after a normal run begins, preserve mounted outputs but stop before the next paid stage and offer human-readable export.

**Run green:**

```bash
npm test -- src/lib/run-controller.test.ts src/studio-engine.test.ts \
  src/lib/persistence/run-recorder.test.ts src/lib/persistence/run-record-builder.test.ts
npm run typecheck:web
```

### Task 2.6: Verify no duplicate Rank/Fuse history

**Objective:** Close the original duplication risk with an integration regression.

**Files:**

- Create or modify: `src/run-history-integration.test.tsx`

**Test flow:**

1. execute a successful Rank run;
2. assert one summary ID;
3. switch to Fuse;
4. complete Fusion;
5. assert the same summary ID, one detail record, and one accepted Fusion attempt;
6. Re-fuse successfully and assert a second immutable attempt plus a moved accepted pointer;
7. fail a later Re-fuse and assert the accepted pointer/result remain unchanged;
8. assert accepted candidate and Judge snapshots are byte-equivalent before/after every Fusion attempt.

**Run:**

```bash
npm test -- src/run-history-integration.test.tsx
```

**Commit after Phase 2:**

```bash
git add src/lib/run-executor.ts src/lib/run-executor.test.ts \
  src/lib/run-controller.ts src/lib/run-controller.test.ts \
  src/studio-engine.ts src/studio-engine.test.ts src/rsemble.tsx \
  src/ui/ModelList.tsx src/ui/ModelList.test.tsx \
  src/lib/history-cache.ts src/lib/persistence/run-record-builder.ts \
  src/lib/persistence/run-record-builder.test.ts src/lib/persistence/run-recorder.ts \
  src/lib/persistence/run-recorder.test.ts src/run-history-integration.test.tsx
git commit -m "feat: persist complete run lifecycle"
```

---

## Phase 3: Build the Runs workspace

### Task 3.0: Build shared audit-surface primitives

**Objective:** Make status, model identity, and compact record scanning consistent before building multiple history surfaces.

**Files:**

- Create: `src/ui/StatusMark.tsx`
- Create: `src/ui/StatusMark.test.tsx`
- Create: `src/ui/CompactModelLabel.tsx`
- Create: `src/ui/CompactModelLabel.test.tsx`
- Create: `src/ui/RecordRow.tsx`
- Create: `src/ui/RecordRow.test.tsx`

**Failing tests:**

1. `draft`, `queued`, `running`, `paused`, `completed`, `completed_with_failures`, `partial`, `failed`, `aborted`, and `interrupted` use the exact shared color plus icon/shape contract;
2. status always includes visible or programmatic text and remains distinguishable without color;
3. reduced motion disables the running rotation;
4. compact model labels render provider chip plus bounded middle-ellipsis slug that preserves the tail;
5. full opaque provider/model identity is available through accessible text and a focusable/clickable detail path, not only hover `title`;
6. `RecordRow` list-density and table-cell variants expose status, title, timestamp, summary, model count, provenance, and action slots without changing semantic link/table structure;
7. the primitives use 13px minimum body text, 44px interactive targets, and visible focus styles.

**Run red/green:**

```bash
npm test -- src/ui/StatusMark.test.tsx src/ui/CompactModelLabel.test.tsx src/ui/RecordRow.test.tsx
```

### Task 3.1: Add query hooks and view-model formatting

**Objective:** Keep asynchronous repository state out of presentational components.

**Files:**

- Create: `src/workspaces/runs/useRunList.ts`
- Create: `src/workspaces/runs/useRunDetail.ts`
- Create: `src/workspaces/runs/run-view-model.ts`
- Create: `src/workspaces/runs/run-view-model.test.ts`

**Failing tests:**

1. summary row formats task, status, relative date, every persisted tied winner, score, model count, and source;
2. legacy row reports detail unavailable;
3. rows display only persisted `winnerKeys`; failed/partial/interrupted rows without an accepted Judge never infer a winner from scores;
4. selected detail exposes sections only when data exists;
5. stale async response cannot replace a newer selection;
6. repository error, loading, empty, and no-match states are distinct.

### Task 3.2: Build the run list and filters

**Objective:** Make history discoverable with compact, accessible controls.

**Files:**

- Create: `src/workspaces/runs/RunList.tsx`
- Create: `src/workspaces/runs/RunFilters.tsx`
- Create: `src/workspaces/runs/RunList.test.tsx`
- Modify: `src/workspaces/RunsWorkspace.tsx`
- Reuse: `src/ui/RecordRow.tsx`, `src/ui/StatusMark.tsx`, `src/ui/CompactModelLabel.tsx`

**Failing tests:**

1. rows are links to `/runs/:runId`;
2. current row has selected state without replacing `aria-current` route semantics;
3. search debounces and updates the repository query before pagination;
4. model, status, mode, and source filters combine across the complete result set; legacy rows match text/model/legacy-source filters but are excluded by status or mode filters;
5. Clear filters resets every filter;
6. loading, no history, no matches, and error copy are different;
7. load-more requests the next 50 already-filtered summaries;
8. at 390px search remains visible and one Filters sheet exposes secondary filters plus an applied-count badge;
9. all controls meet accessible-name and target-size contracts;
10. zero-history is a compact one- or two-line state with a real **Go to Compare** link and no fake local Run action;
11. filtering/sorting uses no positional row animation and honors reduced motion;
12. a tie row exposes every persisted winner label/marker rather than selecting the first.

**Run red/green:**

```bash
npm test -- src/workspaces/runs/RunList.test.tsx src/workspaces/runs/run-view-model.test.ts
```

### Task 3.3: Build full and legacy run detail

**Objective:** Make every retained score auditable.

**Files:**

- Create: `src/workspaces/runs/RunDetail.tsx`
- Create: `src/workspaces/runs/LegacyRunDetail.tsx`
- Create: `src/workspaces/runs/RunDetail.test.tsx`
- Reuse: `src/ui/RankResult.tsx`, `src/ui/Markdown.tsx`, `src/ui/brand-icons.tsx` where contracts fit

**Failing tests:**

1. full records assert the exact semantic DOM section order: header → linked provenance when present → Outcome with every tied winner → candidate selector and selected candidate output → Judge evidence → Fusion evidence when present → collapsed task/configuration;
2. experiment-sourced runs show a compact linked provenance trail with experiment, suite version, task, and attempt;
3. compact candidate rows use the accepted Judge’s score/blind label by default, or clearly label a query-selected historical Judge attempt, with one output expanded at a time;
4. each candidate exposes append-only attempt history and an accepted pointer; retry failures never replace prior accepted output;
5. Judge evidence maps blind labels to stable candidate IDs and exact candidate-attempt outputs;
6. criteria anchors/profile snapshot and every Judge/Fusion attempt instruction/message render with accepted pointers and source attempt references;
7. Fuse result renders only when present;
8. failed attempt metadata renders without malformed partial Judge output;
9. legacy detail renders only known summary fields and an explicit limitation message;
10. Markdown remains escaped/safe under existing renderer contract;
11. exact localized timestamp with timezone renders, with relative time secondary;
12. `?candidate=&attempt=` uses `URLSearchParams`, survives encoded refresh/deep-linking, expands the exact candidate output referenced by that Judge attempt, focuses matching evidence, and gives invalid targets a non-blocking fallback notice;
13. browser Back restores list scroll and focus to the activating row;
14. blind-label mapping appears both in the selected candidate panel and Judge evidence;
15. missing ID renders not-found state and list link.

### Task 3.4: Implement responsive list/detail routing

**Objective:** Provide efficient desktop inspection and coherent mobile navigation.

**Files:**

- Modify: `src/workspaces/RunsWorkspace.tsx`
- Create: `src/workspaces/runs/RunsWorkspace.test.tsx`
- Modify: `src/app-router.tsx`

**Requirements:**

- split layout renders only at `>=1024px` and a workspace container `>=960px`, with panes at least 320px/600px; reuse existing `useResizableSplit` plus its divider semantics or ship fixed width, never a second drag implementation;
- desktop `/runs` shows list with honest select-a-run detail state;
- desktop `/runs/:id` shows list plus selected detail;
- every `<1024px` layout uses route-based detail;
- mobile `/runs` shows list only;
- mobile `/runs/:id` shows detail with Back to Runs;
- no duplicate headings or nested document landmarks;
- detail panel scrolls independently on desktop;
- no page-level horizontal overflow.

### Task 3.5: Make recent runs actionable

**Objective:** Turn the Compare empty-state hint into a real history gateway.

**Files:**

- Modify: `src/ui/OutputPane.tsx`
- Modify: `src/ui/OutputPane.test.tsx`
- Create or reuse: async recent-runs hook

**Failing tests:**

1. View all runs links to `/runs`;
2. each row links to `/runs/:id`;
3. legacy row links to summary detail;
4. no comment/copy claims rows are intentionally non-clickable;
5. new completed run invalidates recent summaries without reload;
6. recent rows reuse `RecordRow` and the shared status/model primitives.

### Task 3.6: Migrate and scope model telemetry

**Objective:** Prevent ModelList from freezing on the retired localStorage writer or presenting experiment evidence as unscoped history.

**Files:**

- Modify or replace: `src/lib/history-cache.ts`
- Modify: `src/lib/history-cache.test.ts`
- Modify: `src/ui/ModelList.tsx`
- Modify: `src/ui/ModelList.test.tsx`
- Modify: run-summary view models as needed

**Failing tests:**

1. new IndexedDB-backed ad hoc runs update ModelList telemetry without reload;
2. ad hoc telemetry excludes experiment runs by default;
3. suite telemetry requires suite ID, suite version, and the protocol fingerprint persisted on every experiment-sourced run summary;
4. same model ID across providers remains separate;
5. visible labels say `All ad hoc history`;
6. no cross-suite global “best model” is rendered;
7. legacy summaries contribute only to explicitly labeled legacy/ad hoc views and never acquire inferred status/mode/source metadata;
8. async telemetry cannot display a stale response after a model selection changes.

**Phase verification:**

```bash
npm test -- src/workspaces/runs src/ui/OutputPane.test.tsx src/ui/ModelList.test.tsx \
  src/lib/history-cache.test.ts src/lib/persistence/run-repository.test.ts
npm run typecheck:web
```

**Browser QA:**

- desktop split with 0, 1, and 50 records;
- 390px list → detail → back flow;
- keyboard selection, route-change focus, browser-Back focus/scroll restoration, and 200% zoom;
- long prompt, 35-character opaque model slug, failed/aborted/interrupted/partial run, tied winners, and legacy run;
- captured screenshots for empty, populated, long-content, partial/error, and 390px states;
- no clipping, blank pane, inert control, or unsafe Markdown.

**Commit after Phase 3:**

```bash
git add src/workspaces/RunsWorkspace.tsx src/workspaces/runs \
  src/app-router.tsx src/ui/StatusMark.tsx src/ui/StatusMark.test.tsx \
  src/ui/CompactModelLabel.tsx src/ui/CompactModelLabel.test.tsx \
  src/ui/RecordRow.tsx src/ui/RecordRow.test.tsx \
  src/ui/OutputPane.tsx src/ui/OutputPane.test.tsx \
  src/ui/ModelList.tsx src/ui/ModelList.test.tsx \
  src/lib/history-cache.ts src/lib/history-cache.test.ts
git commit -m "feat: add inspectable run history workspace"
```

---

## Phase 4: Replace rubric scaffolding with evaluation profiles

### Task 4.1: Characterize pipeline text and strict parsing

**Objective:** Freeze current candidate, Judge, Fusion, and parser behavior before separating evaluation guidance.

**Files:**

- Modify: `src/lib/pipeline.test.ts`
- Modify: `src/lib/judge-explainability.integration.test.ts` if needed

**Characterization tests:**

- candidate prompt currently includes rubric text;
- Judge prompt uses stable criterion IDs;
- parser rejects missing criterion results;
- Fusion receives existing quality guidance;
- no criteria invokes holistic judgment.

Run and record the baseline before replacing intended assertions.

### Task 4.2: Add failing anchored-profile formatting tests

**Objective:** Define evaluator-only criteria and anchored prompts.

**Files:**

- Create: `src/lib/evaluations/evaluation-profile.ts`
- Create: `src/lib/evaluations/evaluation-profile.test.ts`
- Modify later: `src/lib/pipeline.ts`

**Failing tests:**

1. criteria render stable IDs, descriptions, normalized weights, and 1/3/5 anchors;
2. candidate draft messages contain no criterion names, weights, anchors, or Judge instruction;
3. Judge messages contain the frozen profile snapshot and `RunRequest` no longer accepts transitional `FrozenEvaluationInput`;
4. holistic mode sends no fabricated criteria;
5. Fusion may receive criterion quality targets but never Judge-only procedural instructions;
6. duplicate criterion names remain distinct by ID;
7. zero-total weights are invalid before provider calls;
8. canonical scored-profile result is the deterministic weighted mean of the complete criterion vector;
9. missing/out-of-range criteria reject the Judge response rather than falling back to reported overall score;
10. Judge-reported overall score is retained only as diagnostic provenance;
11. all models within `1e-9` of the maximum appear in `winnerKeys`.

### Task 4.3: Replace rubric types and reducer actions

**Objective:** Remove `goal | metric | gap` from active product state.

**Files:**

- Modify: `src/studio-data.ts`
- Modify: `src/studio-engine.ts`
- Modify: `src/studio-engine.test.ts`
- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/run-controller.ts`
- Modify all affected pipeline/controller tests

**Required state shape:**

```ts
type AdHocEvaluationConfig =
  | { kind: "holistic" }
  | {
      kind: "profile";
      ref: EvaluationProfileRef;
      profile: EvaluationProfileSnapshot;
    }
  | { kind: "custom"; profile: EvaluationProfileSnapshot };
```

**Failing reducer/controller tests:**

1. current-run context deep-copies evaluation snapshot;
2. editing current criteria after fanout does not affect Judge retry;
3. Judge retry uses frozen profile plus current Judge model only where spec allows;
4. candidate calls never receive evaluation-only criteria;
5. accepted criterion scores map by stable IDs and feed the shared canonical-score function;
6. old rubric actions and `RubricKind` are no longer part of the public action/type contract.

**Implementation rules:**

- update pipeline function signatures coherently; do not add an adapter that keeps old kinds indefinitely;
- preserve score scale and strict explainability schema;
- preserve provider independence;
- ensure Fusion receives only quality-relevant criteria, not Judge procedural text;
- update export to render profile snapshot and anchors.

### Task 4.4: Build the Evaluation disclosure and profile editor

**Objective:** Replace preset-driven rubric editing with deliberate scoring definitions.

**Files:**

- Create: `src/ui/EvaluationDisclosure.tsx`
- Create: `src/ui/EvaluationProfileEditor.tsx`
- Create: `src/ui/EvaluationDisclosure.test.tsx`
- Create: `src/ui/EvaluationProfileEditor.test.tsx`
- Remove after replacement: `src/ui/RubricDisclosure.tsx`
- Update affected command-palette actions and tests
- Modify: `src/rsemble.tsx`

**Failing tests:**

1. holistic judgment is the default;
2. a saved profile pins an exact version and does not follow a newer version silently;
3. custom mode requires one valid criterion;
4. editor exposes name, description, 1/3/5 anchors, and secondary weight control;
5. field-level errors identify missing anchors and zero weights;
6. Move up/down works without drag-and-drop;
7. only one criterion accordion is open at a time; collapsed headers show name, raw weight, and live normalized share, while a sticky/in-flow page summary keeps total weight visible;
8. anchor/weight validation runs on blur and again on Save without erasing draft input; normalized previews are accurate;
9. no `goal`, `metric`, `gap`, Accuracy, Depth, Clarity, or other preset chips render;
10. disclosure summary truthfully reports holistic, saved profile/version, or custom criterion count;
11. Save as profile is separate from editing one-off criteria;
12. every field has an associated label and error description;
13. mobile layout has no horizontal overflow.

**Run green:**

```bash
npm test -- src/lib/evaluations src/lib/pipeline.test.ts \
  src/studio-engine.test.ts src/lib/run-controller.test.ts \
  src/ui/EvaluationDisclosure.test.tsx src/ui/EvaluationProfileEditor.test.tsx
npm run typecheck:web
```

**Browser QA before commit:**

- exercise holistic, saved-profile, one-off custom, and Save as profile flows;
- verify keyboard labels/errors/reordering and 200% zoom;
- capture 1440px and 390px screenshots for default, populated, one-open accordion, validation-error, long-anchor, total-weight summary, and storage-error states;
- confirm the software keyboard does not obscure focused criteria fields.

**Commit after Phase 4:**

```bash
git add src/studio-data.ts src/studio-engine.ts src/studio-engine.test.ts \
  src/lib/pipeline.ts src/lib/pipeline.test.ts src/lib/run-controller.ts \
  src/lib/run-controller.test.ts src/lib/evaluations src/ui/EvaluationDisclosure.tsx \
  src/ui/EvaluationDisclosure.test.tsx src/ui/EvaluationProfileEditor.tsx \
  src/ui/EvaluationProfileEditor.test.tsx src/rsemble.tsx src/lib/export-markdown.ts
git rm src/ui/RubricDisclosure.tsx
git commit -m "feat: add anchored evaluation profiles"
```

---

## Phase 5: Build suite/profile persistence and authoring

### Task 5.1: Finish profile and suite repository behavior

**Objective:** Persist versioned authoring data and immutable experiment inputs.

**Files:**

- Modify: `src/lib/persistence/evaluation-repository.ts`
- Modify: `src/lib/persistence/evaluation-repository.test.ts`
- Create: `src/lib/evaluations/suite-validation.ts`
- Create: `src/lib/evaluations/suite-validation.test.ts`

**Failing tests:**

1. saving a semantic profile edit atomically appends an immutable version and advances revisioned `ProfileRecord.latestVersion`, leaving the prior version retrievable;
2. archive/restore changes only `ProfileRecord.archivedAt` and concurrency revision, creating and mutating no profile version;
3. suites remain pinned to `{ id, version }` until the user explicitly adopts a newer profile;
4. adopting a newer profile version increments suite version;
5. other suite edits increment suite version only on explicit save when semantic content changed;
6. task order persists;
7. duplicate creates new IDs and resets experiment history linkage;
8. archived suites are recoverable;
9. run validation requires two enabled unique provider/model keys, one task, title/prompt, ready Judge, and resolved profile/holistic choice; duplicates block before provider calls;
10. suite save allows an incomplete draft while run validation blocks execution;
11. experiment snapshot deep-copies suite, pinned profile versions, roster, and Judge;
12. canonical JSON recursively sorts object keys, preserves semantic array order, and produces `sha256:<lowercase hex>`;
13. equivalent snapshots with different insertion order share a fingerprint, while included task/profile/Judge/aggregation edits change it;
14. IDs, timestamps, statuses, outputs, and display-only metadata do not affect the fingerprint;
15. suite/experiment saves use expected concurrency revisions, separate from semantic versions, and reject stale drafts.

### Task 5.2: Build the profile library

**Objective:** Make reusable profile versions discoverable without creating a fourth top-level workspace.

**Files:**

- Create: `src/workspaces/evaluations/ProfileList.tsx`
- Create: `src/workspaces/evaluations/ProfileDetail.tsx`
- Create: `src/workspaces/evaluations/ProfileLibrary.test.tsx`
- Modify: `src/workspaces/EvaluationsWorkspace.tsx`
- Modify: `src/app-router.tsx`
- Modify: Compare **Save as profile** action

**Failing tests:**

1. Evaluations local navigation exposes Suites and Profiles as a compact, visually subordinate segmented route control with real links and `aria-current`, never as a second global nav;
2. `/evaluations/profiles` lists latest revisions with archived filtering;
3. `/evaluations/profiles/:profileId` exposes immutable version history and pinned-suite usage; non-latest versions show **vN · latest vM · read-only** plus **Edit as new version** and no silently editable fields;
4. Edit as new version preserves every prior revision;
5. Duplicate creates a new profile identity;
6. Archive removes a profile from new-selection menus but preserves historical and pinned access;
7. Restore makes the latest revision selectable again;
8. Compare one-off criteria stay run-local until explicit Save as profile;
9. Save as profile creates a named draft without mutating the active Compare snapshot;
10. storage failure never claims a profile/version was saved;
11. dirty profile edits guard browser Back, workspace/profile navigation, and reload/close with Save/Discard/Stay;
12. archived profiles remain resolvable by already-pinned suites but unavailable to new selections;
13. the 390px profile form preserves visible Save/validation controls above the software keyboard;
14. profile criteria reuse the one-open accordion, blur validation, normalized-header preview, and total-weight summary.

### Task 5.3: Build the suite list

**Objective:** Create, discover, duplicate, and archive suites without dashboard bloat.

**Files:**

- Modify: `src/workspaces/EvaluationsWorkspace.tsx`
- Create: `src/workspaces/evaluations/SuiteList.tsx`
- Create: `src/workspaces/evaluations/SuiteList.test.tsx`
- Modify: `src/app-router.tsx`

**Failing tests:**

- empty state explains what a suite is and offers Create suite;
- suite rows reuse `RecordRow` and show name, version, task count, model count, and latest experiment;
- rows route to `/evaluations/:suiteId`;
- duplicate creates a distinct draft;
- archive requires confirmation and removes row from default list;
- archived filter restores discoverability;
- storage error does not claim a suite was saved.

### Task 5.4: Build the suite settings editor

**Objective:** Edit suite identity, model roster, default Judge, and default profile.

**Files:**

- Create: `src/workspaces/evaluations/SuiteEditor.tsx`
- Create: `src/workspaces/evaluations/SuiteSettings.tsx`
- Create: `src/workspaces/evaluations/SuiteEditor.test.tsx`
- Reuse provider selector components from Compare

**Failing tests:**

1. name and description save with tested/saved state separated;
2. model roster reuses provider-scoped selector behavior and shows a field error for duplicate opaque provider/model keys;
3. default Judge reuses the existing Judge selector and provider semantics;
4. default evaluation is an explicit holistic or pinned-profile selection;
5. validation errors do not erase draft input;
6. Save and Run evaluation are distinct controls;
7. dirty state displays the exact next version and disables Run with **Save this suite before running**;
8. Save creates one semantic version, then Run names and snapshots that exact persisted version;
9. Run never auto-saves a draft;
10. run action remains disabled until the persisted suite passes execution validation.

### Task 5.5: Build task list and task editor

**Objective:** Let each task define candidate instructions and its own evaluation profile.

**Files:**

- Create: `src/workspaces/evaluations/SuiteTaskList.tsx`
- Create: `src/workspaces/evaluations/SuiteTaskEditor.tsx`
- Create: `src/workspaces/evaluations/SuiteTaskEditor.test.tsx`

**Failing tests:**

1. add task creates a selected draft with stable ID;
2. title, prompt, and system prompt edit independently;
3. task uses an explicit tagged choice to inherit the suite default, choose holistic judgment, or pin another profile version;
4. task Judge instruction override is visibly separate from candidate instructions;
5. Move up/down changes stable order;
6. deleting a task requires confirmation when it has content;
7. dirty task/suite edits checkpoint on task switching, deletion, browser Back, workspace links, bottom navigation, suite switching, and reload/close;
8. Save/Discard/Stay restores or persists the correct version without losing draft input;
9. `/evaluations/:suiteId/tasks/:taskId` deep-links on every `<1024px` layout;
10. Back restores task-list scroll and focus;
11. 390px software keyboard never covers focused fields, validation, Save/Run, or bottom navigation;
12. desktop list/editor and mobile route states preserve the same draft;
13. no permanent third pane appears.

**Phase verification:**

```bash
npm test -- src/lib/evaluations src/lib/persistence/evaluation-repository.test.ts \
  src/workspaces/evaluations
npm run typecheck:web
```

**Browser QA:**

- create a six-task Business Decision-Making suite;
- use different evaluation profiles on at least two tasks;
- verify 1440px, 1024px, 768px, and 390px layouts plus 200% zoom and software-keyboard simulation;
- keyboard-only add, reorder, edit, save, duplicate, archive, and restore;
- capture empty, populated, dirty, validation-error, long-content, and 390px screenshots before the phase commit.

**Commit after Phase 5:**

```bash
git add src/lib/evaluations src/lib/persistence/evaluation-repository.ts \
  src/lib/persistence/evaluation-repository.test.ts src/workspaces/EvaluationsWorkspace.tsx \
  src/workspaces/evaluations src/app-router.tsx
git commit -m "feat: add evaluation suite authoring"
```

---

## Phase 6: Run evaluation experiments through the shared executor

### Task 6.1: Define experiment state transitions and aggregates separately

**Objective:** Create a deterministic state machine before provider orchestration.

**Files:**

- Create: `src/lib/evaluations/experiment-engine.ts`
- Create: `src/lib/evaluations/experiment-engine.test.ts`
- Create: `src/lib/evaluations/experiment-aggregation.ts`
- Create: `src/lib/evaluations/experiment-aggregation.test.ts`

**State transitions:**

```text
draft → queued → running ↔ paused → completed | completed_with_failures | aborted | interrupted
```

Task attempts:

```text
queued → running → completed | partial | failed | aborted | interrupted
```

**Failing engine tests:**

1. start selects the first queued task;
2. terminal task advances exactly once;
3. failed task is retained and queue continues;
4. pause requested during a task takes effect only after that task persists and before the next task starts;
5. resume explicitly advances from the paused queue;
6. abort stops advancement;
7. stale task epoch cannot complete a newer task;
8. reload recovery marks active attempt interrupted;
9. Retry incomplete tasks queues failed, partial, interrupted, or aborted tasks only;
10. retry creates a new full-task run ID and never splices per-model evidence across attempts;
11. `selectedAttemptId` chooses newest full-coverage accepted attempt, otherwise newest accepted partial attempt, otherwise none;
12. prior attempts remain inspectable after selection changes;
13. snapshot cannot mutate after start;
14. run-status mapping deterministically produces experiment-attempt status.

**Failing aggregation tests:**

1. each task contributes scores from exactly one `selectedAttemptId`;
2. mean is calculated from available canonical task scores per model;
3. coverage is scored tasks / total tasks;
4. missing scores are not zero;
5. only complete-coverage models are winner-eligible;
6. no complete model yields no winner;
7. task order does not change aggregate;
8. ranking uses raw values, task cells display one decimal, and aggregate means display two decimals;
9. values within a `1e-9` epsilon remain tied; values that merely look similar after rounding do not;
10. per-model values from different attempts are never merged into one task row.

### Task 6.2: Implement the sequential experiment controller

**Objective:** Execute suite tasks one at a time through `RunExecutor`.

**Files:**

- Create: `src/lib/evaluations/experiment-controller.ts`
- Create: `src/lib/evaluations/experiment-controller.test.ts`
- Create: `src/lib/persistence/experiment-unit-of-work.ts`
- Create: `src/lib/persistence/experiment-unit-of-work.test.ts`
- Modify: `src/lib/persistence/database.ts`
- Modify: global execution-owner state/context in app shell

**Failing tests:**

1. lease/fence and immutable snapshot are verified before every paid entry point; `beginExperimentTask` atomically creates the run and starts/links one immutable `experimentTaskAttemptId` before fanout;
2. tasks execute in stable suite order;
3. candidate calls are parallel only within active task;
4. `commitExperimentTaskTerminal` atomically finalizes the run and linked experiment attempt, recomputes `selectedAttemptId`, and commits both before the next task starts;
5. one task failure does not discard completed task IDs;
6. persistence failure stops queue before another paid task;
7. pause never aborts the active executor and prevents the next task after persistence;
8. resume starts the next queued task only after explicit user action;
9. abort reaches the active executor, wins against delayed writes, and prevents advancement;
10. retry queues failed, partial, interrupted, or aborted tasks and creates whole-task attempts;
11. Compare start is blocked while experiment owns the cross-tab lease, including paused queued work;
12. experiment start is blocked while Compare active;
13. navigating workspaces does not abort controller;
14. reload never silently resumes;
15. a live secondary tab cannot start, resume, retry, recover, interrupt, or commit running-state writes;
16. expired-owner takeover marks active work interrupted before offering explicit continuation;
17. injected failure after the run write but before experiment write rolls back both records;
18. repeating begin/terminal with identical IDs and payload is idempotent, while conflicting attempt-ID reuse is rejected;
19. recovery finds a committed terminal run by `experimentTaskAttemptId` and never repays for it;
20. every retry creates a new attempt ID and run ID linked in both records.

**Run green:**

```bash
npm test -- src/lib/run-executor.test.ts src/lib/run-controller.test.ts \
  src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-aggregation.test.ts \
  src/lib/evaluations/experiment-controller.test.ts
npm run typecheck:web
```

**Commit after Phase 6:**

```bash
git add src/lib/evaluations/experiment-engine.ts src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-aggregation.ts \
  src/lib/evaluations/experiment-aggregation.test.ts \
  src/lib/evaluations/experiment-controller.ts \
  src/lib/evaluations/experiment-controller.test.ts \
  src/lib/persistence/experiment-unit-of-work.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts src/rsemble.tsx
git commit -m "feat: execute evaluation suites sequentially"
```

---

## Phase 7: Build experiment progress and results

### Task 7.1: Build live experiment progress

**Objective:** Make queued, active, completed, and failed work understandable without logs.

**Files:**

- Create: `src/ui/GlobalExecutionStrip.tsx`
- Create: `src/ui/GlobalExecutionStrip.test.tsx`
- Create: `src/workspaces/evaluations/ExperimentProgress.tsx`
- Create: `src/workspaces/evaluations/ExperimentProgress.test.tsx`
- Modify: `src/app-router.tsx`
- Modify: `src/workspaces/EvaluationsWorkspace.tsx`
- Reuse: `src/ui/StatusMark.tsx`, `src/ui/RecordRow.tsx`

**Failing tests:**

1. progress shows completed/total count and current task;
2. every task uses the shared status text/color/icon treatment, and task-attempt rows use `RecordRow`;
3. active task shows candidate completion and elapsed time;
4. Pause after current task and Resume communicate their boundary behavior;
5. Abort experiment has an explicit accessible name and active target;
6. Retry incomplete tasks appears only for failed/partial/interrupted/aborted attempts and no active task;
7. navigation away and back retains progress;
8. persistence error stops progress and presents retry/export guidance;
9. the strip appears only off the exact owning progress route; Compare with visible `PipelineRail` and the active experiment progress route suppress it without hiding errors;
10. strip height stays 32–36px, one line, and reuses PipelineRail status-dot/mono-caption grammar with elapsed time and View progress;
11. mobile strip stays in normal layout above content and never overlays keyboard/bottom navigation;
12. polite announcements batch meaningful stage transitions only, while abort/storage failure announces assertively once;
13. another-tab ownership disables execution controls with a truthful message.

### Task 7.2: Build the accessible desktop result matrix

**Objective:** Present per-task evidence and aggregate scores without opaque KPI cards.

**Files:**

- Create: `src/workspaces/evaluations/ExperimentResults.tsx`
- Create: `src/workspaces/evaluations/ResultMatrix.tsx`
- Create: `src/workspaces/evaluations/ResultMatrix.test.tsx`
- Reuse: `src/ui/StatusMark.tsx`, `src/ui/CompactModelLabel.tsx`

**Failing tests:**

1. matrix uses table/caption/row/column headers;
2. tasks are rows and provider-scoped models are columns;
3. cells show score or explicit missing/error status;
4. cell links to `/runs/:runId?candidate=:candidateId&attempt=:judgeAttemptId`; candidate ID is immutable and the attempt supplies its blind-label mapping;
5. footer shows mean and coverage;
6. winner appears only with complete coverage;
7. no-complete-coverage copy is truthful;
8. sticky headers do not remove semantic associations;
9. provider chip plus bounded middle-ellipsis slug keeps columns compact and preserves model tails; full opaque identity is available without hover;
10. cells use neutral tabular numerals with no score heatmap or magnitude color; missing/error uses explicit status text plus icon, never bare `—`;
11. every eligible tied-winner column receives the restrained winner marker;
12. tablet matrix scroll is local, keyboard-focusable, visibly outlined, and never creates page-level horizontal overflow;
13. failed task summary links to attempts.

### Task 7.3: Build the mobile result adaptation

**Objective:** Avoid an unusable wide matrix at 390px.

**Files:**

- Create: `src/workspaces/evaluations/MobileExperimentResults.tsx`
- Create: `src/workspaces/evaluations/MobileExperimentResults.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.tsx`

**Failing tests:**

1. model selector exposes all models and provider scope;
2. selected model shows task rows, score/status, mean, and coverage;
3. switching models does not lose route/experiment state;
4. every task row links to evidence;
5. no horizontal overflow at 390px;
6. bottom navigation and sticky result controls do not overlap.

### Task 7.4: Link Runs and Evaluations bidirectionally

**Objective:** Preserve provenance across aggregate and evidence views.

**Files:**

- Modify: `src/workspaces/runs/RunDetail.tsx`
- Modify: `src/workspaces/runs/RunDetail.test.tsx`
- Modify: `src/workspaces/evaluations/ExperimentResults.tsx`

**Failing tests:**

- experiment-sourced run shows a compact **Experiment · Suite vN · Task · Attempt** provenance trail plus Back to experiment;
- result cell opens, expands, scrolls to, and focuses the immutable candidate ID, exact candidate-attempt output referenced by the named Judge attempt, and that Judge attempt, revealing its blind label through persisted mappings;
- copied deep links survive refresh; missing candidate/attempt query values show a non-blocking run-overview fallback;
- run detail does not recompute or relabel blind identities;
- deleted/archived suite does not break historical experiment links because snapshot identity remains.

### Task 7.5: Make every suite experiment discoverable

**Objective:** Reopen all prior suite experiments without introducing a global analytics dashboard.

**Files:**

- Create: `src/workspaces/evaluations/SuiteExperimentHistory.tsx`
- Create: `src/workspaces/evaluations/SuiteExperimentHistory.test.tsx`
- Modify: `src/workspaces/evaluations/SuiteEditor.tsx`
- Reuse: `src/ui/RecordRow.tsx`, `src/ui/StatusMark.tsx`, `src/ui/CompactModelLabel.tsx`

**Failing tests:**

1. suite detail lists all experiments newest first, not only the latest;
2. rows show exact localized start time with explicit timezone, status, suite version, task coverage, and model count;
3. completed, completed-with-failures, aborted, and interrupted experiments remain discoverable;
4. View results links to `/experiments/:experimentId`;
5. pagination begins after 20 rows and applies after suite filtering;
6. archived suites retain historical experiment links;
7. at 390px secondary row actions move to overflow while open/create remain visible;
8. history rows use the shared `RecordRow` status/model/timestamp grammar.

**Phase verification:**

```bash
npm test -- src/workspaces/evaluations src/workspaces/runs \
  src/lib/evaluations/experiment-aggregation.test.ts
npm run typecheck:web
```

**Browser QA:**

1. Run a three-task, three-model test suite with stubbed providers.
2. Confirm live sequential progress.
3. Force one candidate partial result and one task Judge failure.
4. Confirm successful task evidence remains.
5. Retry only incomplete tasks and verify one whole selected attempt per task;
6. Inspect desktop matrix and 390px model-selected result view.
7. Follow cell → run detail → back to experiment.
8. Confirm the global strip and software keyboard never overlap content or mobile navigation.
9. Capture progress, pause, partial/error, matrix, evidence-deep-link, experiment-history, and 390px result screenshots.
10. Confirm no opaque average, hidden missing score, clipped model ID, score heatmap, bare missing dash, single-winner collapse on ties, or page-level overflow.

**Commit after Phase 7:**

```bash
git add src/workspaces/evaluations src/workspaces/runs \
  src/ui/GlobalExecutionStrip.tsx src/ui/GlobalExecutionStrip.test.tsx src/app-router.tsx
git commit -m "feat: add evaluation experiment results"
```

---

## Phase 8: Export, accessibility, and final verification

### Task 8.1: Add archive export/import validation

**Objective:** Make local data portable without making imported text executable.

**Files:**

- Create: `src/lib/persistence/archive.ts`
- Create: `src/lib/persistence/archive.test.ts`
- Create: `src/ui/DataArchiveActions.tsx`
- Create: `src/ui/DataArchiveActions.test.tsx`
- Modify: Runs/Evaluations workspace actions

**Failing tests:**

1. export includes schema version, summaries, details, profiles, suites, and experiments;
2. export is constructed from an allowlisted schema and excludes credential/transport material without rejecting ordinary prompt prose;
3. import validates centralized limits before transaction: 256 MiB file, 25k run summaries/details, 5k profile identities, 10k profile revisions, 5k suites, 25k experiments, 8 MiB strings, depth 32, and 1–128 character safe IDs;
4. identical IDs/content are skipped;
5. conflicting same-ID content is rejected and reported;
6. failed import writes nothing;
7. Markdown export of one run uses persisted snapshot rather than current Compare state;
8. imported Markdown renders through safe existing renderer;
9. provider errors persist only allowlisted category/stage/model/time plus a 4 KiB message redacted against authorization fragments and configured credential values;
10. blocked/quota/version-change failures produce classified recovery guidance.

### Task 8.2: Update command palette and shortcuts

**Objective:** Make global commands workspace-aware.

**Files:**

- Modify: `src/ui/CommandPalette.tsx`
- Create: `src/ui/CommandPalette.test.tsx`
- Modify: `src/ui/useActionShortcuts.ts`
- Modify associated shortcut tests and cheatsheet

**Requirements:**

- add Navigate to Compare/Runs/Evaluations;
- Compare-only actions are absent or disabled with reason outside Compare;
- hidden Run/Add model/Add criterion shortcuts never fire in Runs/Evaluations;
- help text reflects Evaluation rather than Rubric;
- active experiment exposes View experiment and Abort experiment where safe.

### Task 8.3: Run the accessibility and responsive audit

**Objective:** Verify actual rendered behavior, not only class-name intent.

**Checks:**

- semantic landmarks and one primary nav;
- `aria-current` on active workspace;
- bottom navigation labels and safe area;
- focus order and route-change focus;
- dialogs trap and restore focus;
- task reorder works without drag;
- table headers announce correctly;
- status uses the exact shared text/color/icon contract, including neutral aborted and dashed/icon-distinct interrupted;
- 44px targets;
- reduced motion;
- 390px no page-level overflow;
- 200% zoom remains usable;
- one-row 768px header budget; 32–36px off-route execution strip with owning-route suppression;
- compact empty states and Runs → Compare zero-state action;
- no layout animation during list filtering;
- long prompts, long slugs, tied winners, 50 run rows, six tasks, and seven providers;
- focus-visible tablet matrix scroll and full model identity without hover.

Add regressions for every discovered defect before fixing it.

### Task 8.4: Documentation and stale-language cleanup

**Objective:** Remove obsolete product language and implementation comments.

**Files:**

- Review: `PRODUCT.md`, `UI.md`, `DESIGN.md`, `DECISIONS.md`, `CLAUDE.md`
- Review all touched source comments and tests
- Modify documentation where implementation differs from approved spec only after explicit product review

**Search for stale concepts:**

```text
sole switch in the whole product
no primary navigation
standalone scorecard dashboard
Datasets, benchmarks
RubricDisclosure
goal | metric | gap
Accuracy / Depth / Clarity preset references
read-only recent runs
```

Keep “Rank/Fuse is the sole per-task finish switch.” Remove claims that no workspace navigation or evaluation surface may exist.

### Task 8.5: Complete quality gate

**Run focused suites:**

```bash
npm test -- src/lib/persistence src/lib/evaluations src/lib/run-executor.test.ts \
  src/lib/run-controller.test.ts src/studio-engine.test.ts \
  src/workspaces/runs src/workspaces/evaluations \
  src/ui/WorkspaceNav.test.tsx src/rsemble-shell.test.tsx
```

**Run full gate:**

```bash
npm run check
npm audit --audit-level=high
git diff --check
git status --short --branch
```

Restore generated `tsconfig.tsbuildinfo` if the repository tracks it and the build changes it unintentionally.

**Security scan:**

Scan only added lines for:

```text
api key
authorization
bearer
token
password
secret
console.log
.env
localStorage
innerHTML
```

Review every match manually. Expected legitimate matches are validation comments or explicit secret-exclusion tests, not credential values.

**Final browser matrix:**

| View | 1440×900 | 1024×768 | 768×1024 | 390×844 |
|---|---:|---:|---:|---:|
| Compare idle/running/done | ✓ | ✓ | ✓ | ✓ |
| Runs empty/list/detail/legacy | ✓ | ✓ | ✓ | ✓ |
| Profiles and suite list/editor | ✓ | ✓ | ✓ | ✓ |
| Experiment strip/progress/history/results/failure | ✓ | ✓ | ✓ | ✓ |
| Keyboard-only navigation | ✓ | ✓ | ✓ | ✓ |

**Independent review focus:**

- revisioned persistence transaction integrity and delayed-write/abort races;
- no duplicate Rank/Fuse run;
- provider calls stop on storage failure;
- cross-tab lease acquisition, expiry, and recovery ownership;
- abort/epoch races;
- blind Judge invariants;
- candidate/evaluator prompt separation;
- snapshot immutability;
- canonical weighted scoring, tied winners, selected whole-task attempts, and missing-score aggregation;
- route persistence during active execution;
- credentials absent from IndexedDB/export;
- profile/suite version pinning and protocol fingerprints;
- 390px workspace navigation, execution strip, software keyboard, and result usability;
- 768px one-row header sacrifice order and owning-route strip suppression;
- shared status/model-label/RecordRow use, neutral aborted treatment, and tie-safe winner rendering;
- Outcome-first run detail, repeated blind mapping, and linked experiment provenance;
- one-open profile criteria accordion, blur validation, immutable-version read-only banner, and visible weight summary;
- monochrome matrix cells, explicit missing/error states, bounded model headers, and focus-visible tablet scroll.

**Commit after Phase 8:**

```bash
git add [explicit reviewed paths only]
git commit -m "feat: complete local evaluation workbench"
```

Do not push until the user approves the verified commit range.

---

## Required test fixtures

Create reusable fixtures rather than duplicating large records across tests:

```text
src/test/fixtures/run-records.ts
src/test/fixtures/evaluation-profiles.ts
src/test/fixtures/evaluation-suites.ts
src/test/fixtures/experiments.ts
src/test/in-memory-run-repository.ts
src/test/in-memory-evaluation-repository.ts
src/test/provider-stubs.ts
```

Fixtures must use realistic but non-sensitive prompts and model IDs. Include:

- complete Rank run;
- Rank run with later Fusion attachment;
- partial candidate run;
- Judge failure followed by successful retry;
- aborted and interrupted run;
- legacy summary-only run;
- suite with two different evaluation profiles;
- experiment with complete coverage;
- experiment with missing candidate score;
- experiment with failed task and successful retry;
- identical model slug under two providers.

## Commit and review discipline

After each phase:

1. Run its focused tests.
2. Run `npm run typecheck:web`.
3. Run `git diff --check`.
4. Inspect the complete staged diff.
5. Run spec-compliance review.
6. Fix blockers and rerun.
7. Run code-quality/security review.
8. Commit explicit paths.
9. Do not begin the next phase until the phase is green.

After Phases 2, 4, 6, and 7, also run the full test suite because those phases change shared state or orchestration.

## Stop conditions

Stop and return to product discussion if implementation discovers that it requires:

- a hosted backend or SQLite service;
- concurrent ad hoc and suite execution;
- changes to provider-specific opaque model-ID semantics;
- removal of blind judging;
- acceptance of partial/malformed Judge output;
- silently resumed paid requests after reload;
- hidden cross-suite score normalization;
- embedding or clustering to make v1 usable;
- a permanent three-panel inspector or left product-navigation rail;
- an unexplained overall score without evidence links.
