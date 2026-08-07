# Architecture: Current Responsibility Map (Plan 007 / Workstream A)

Status: `IN PROGRESS` — snapshot taken at Plan 007 start on branch
`refactor/controlled-maintainability` from `master` (post-Plan-006 merge `83afb53`).

Baseline gate: 142 files / 2068 tests / coverage stmts 79.17 / branch 72.07 /
funcs 80.85 / lines 83.29.

## Purpose

This note records the *current* module responsibilities and import graph before
any Plan 007 extraction, so each workstream can prove behavioral equivalence
against a frozen contract. It is a living document updated as workstreams land.

## Pipeline spine (unchanged invariant)

`Task → parallel candidates → blind Judge → Rank/Fuse`. One provider-neutral
pipeline domain module (`src/lib/pipeline.ts`) owns prompt construction,
blind-set construction, Judge parsing/validation; transport and persistence stay
outside it.

## Module responsibility map (Plan 007 targets)

### `src/lib/run-executor.ts` (1777 lines) — provider-agnostic task engine

- **Public surface** (`RunExecutor`, from `createRunExecutor(deps)`):
  - `executeTask(request, events, signal)` — fanout → Judge → optional Fusion
  - `retryCandidate(...)` — one candidate re-run → re-Judge → optional re-Fuse
  - `retryJudge(...)` — re-Judge frozen candidates (no candidate calls)
  - `executeFusionAttempt(...)` — Fusion/re-Fuse from frozen accepted evidence
- **Internal stage closures** (currently nested in the factory):
  - `runCandidateStream` (L363) — one candidate request/stream, usage, cost,
    terminal result; shared by executeTask+retryCandidate
  - `runJudge` (L552) — blind-set construction, Judge request, parse/validation
  - `runFusion` (L810) — synthesis and re-Fuse execution
  - `estimateFallbackCost` (L313) — reported/estimated/unknown cost resolution
  - `sanitizeError` (L334), `isAborted` (L327), `sourceFields` (L352)
- **Dependency injection surface** (`RunExecutorDeps`): `random?` (blind shuffle),
  `generateId?`, `now?`, `deadlines?`, `deadlineDeps?`.
- **No-op methods**: none present (plan-suggested `runJudge: async()=>{}` and
  `runFusion: async()=>{}` do not exist in the live code).
- **Domain helpers reused from `pipeline.ts`**: `createBlindCandidateSet`,
  `judgeMessages`, `fusionMessages`, `draftMessages`, `splitSegments`, `summarize`,
  `parseJudge`, `buildFanoutJobs`, `isUsableCandidate`.
- **Target split (plan)**: candidate-executor / judge-executor / fusion-executor /
  execution-cost / run-executor (orchestration only). To be validated against the
  live closure-coupling evidence before moving code.

### `src/lib/run-controller.ts` (912 lines) — Compare controller

- **Public surface** (`createRunController(deps)` returns):
  `runFanout`, `abortRun`, `retryCandidate`, `retryJudge`, `triggerFusion`.
- **Internal responsibilities** (in one factory): `runFanout` (snapshot/frozen
  context construction + lease + preflight/eligibility + execute), `makeEvents`
  (event→reducer adapter + recorder persistence adapter), `retryCandidate`,
  `retryJudge`, `triggerFusion`, `abortRun`, stream-buffer wiring, lease
  acquire/release.
- Depends on: `run-executor`, `compare-preflight`, `execution-lease`,
  `execution-heartbeat`, `persistence/run-recorder`, `run-types`, `stream-buffer`,
  `studio-engine`, `studio-data`.
- **Target split (plan)**: request snapshot construction; event-to-reducer
  adapter; recorder/persistence adapter; retry request construction; thin public
  facade. No silent no-op APIs remain.

### `src/rsemble.tsx` (941 lines) — application root

- Owns provider-probe lifecycle (`useProviderReadiness`/`ModelProbeContext`),
  Compare preflight/ownership/lease (`useCompareExecution`), event wiring to
  run-controller and recorder, and large render blocks (toolbar/split panes/
  dialogs/palette).
- **Target split (plan)**: `useProviderReadiness`, `useCompareExecution`,
  `CompareWorkspace` for render; root becomes shell composition. No global state
  framework.

### `src/lib/evaluations/experiment-controller.ts` (1523 lines)

- One factory `createExperimentController(deps)`. Public: `ExperimentController`,
  `StartResult`, `SimpleResult`, `ExperimentControllerEvent`.
- Responsibilities to characterize: queue planning, lease/fence lifecycle, task
  attempt execution, compound reuse/repair/roster-extension, atomic terminal
  commit, public facade.

### `src/lib/evaluations/fusion-study-stages.ts` (1192 lines)

- Exports stage drivers: `runStageA` (baseline/single-model), `runStageB`
  (pair screening), `runStageC` (recipe elimination + holdout), `evaluatePairBlocked`,
  pure helpers (`eliminateFamilies`, `bestFixedModelKey`, `sumCosts`, ...).
- Judge/reuse provenance, dev/holdout separation, fingerprints live here.

### `src/lib/evaluations/fusion-live-executor.ts` (186 lines)

- `createLiveFusionExecutor` — live single fusion attempt for Fusion Study UI;
  reuses pipeline helpers + cost/registry; small distinct candidate-request
  duplication (`chatOnce`, `candidateFromOutput`).

## Existing characterization test files (frozen contracts)

- `src/lib/run-executor.test.ts` (1230 lines, 47 tests) — provider call counts,
  stage ordering (Rank never Fuse; Fuse only after valid Judge; no Judge <2
  usable; no downstream calls on failure), abort suppression, exact rendered
  blind messages, attempt IDs, cost provenance (Unknown when no native usage),
  sanitization/redaction, deadline classification, candidateExecution (Task 10).
- `src/lib/run-controller.test.ts`, `experiment-controller.test.ts`,
  `fusion-study-controller.test.ts`, `execution-lease/-deadline/-heartbeat.test.ts`,
  Fusion Study integration tests.

## Dependency-cycle scan (pre-extraction)

No product-level cycles observed in the target modules at snapshot time; they are
single-direction fans from the controller/root into pipeline + providers +
persistence. Re-verified after each workstream.

## Frozen invariants to preserve (from plans/README.md)

Provider call counts; stage ordering; blind Judge; prompts/fingerprints;
retry/re-Fuse; timeout classification; lease/fence; persistence ordering;
accepted-attempt refs; usage/cost provenance; experiment repair/roster-extension;
atomic terminal commits; Fusion Study dev/holdout separation; schemas/scoring/
prompts unchanged.


## Workstream D detail — rsemble.tsx decomposition constraints (authoritative, READ-ONLY analysis)

`RSemble` (default export, lines 66–637) is the app shell that mounts **above**
`AppRoutes` and never unmounts across navigation. The reducer, run-controller,
probe coordinator, stream buffer, recorder, lease, and modal state all live in
`RSemble`, and Compare content is passed INTO the router as a `compareOutlet`
prop reconstructed each render. **Compare state is kept alive by this root-level
mounting, not by routing.** Any decomposition that moves orchestration into
route components would break cross-navigation Compare state. Conclusion:
orchestration hooks must remain at root/mount level above the router.

### Defined locally in rsemble.tsx (pure/child components safe to extract):
- `CloseIcon` (639), `Divider` (655, ARIA separator, resizer), `FocusStrip` (691),
  `CommandPane` (740, calls useAttachments + RESET_SESSION), `ResetButton` (826,
  local armed+4s timer), `PaneLabel` (881), `NoKeyBanner` (912), `useMediaQuery`
  (928, SSR-guarded).

### Stateful orchestration (NOT safe to move below the router):
- reducer spine + `stateRef`; StreamDeltaBuffer; createRunController + event
  destructuring; probe coordinator/readiness/catalog + poller; preflight/canRun
  + compare owner + `requestRun`; mode/fusion handlers; action shortcuts; export;
  keyboard shortcuts; compare toolbar + split panes + compareOutlet render.

### Imported hooks already extracted elsewhere:
- `useResizableSplit`, `useExecutionOwner` (ownerRegistry/owner), `useExecutionLease`
  (crossTabLease), `useExperimentController` (experimentActive), `useModelProbe`
  (ModelProbeProvider).

### Decomposition recommendation:
Extract only the pure/self-contained render blocks and the local child
components into a `CompareWorkspace`/workspace component set that receives the
props it needs, while keeping the orchestration hooks at root level. Do NOT move
the reducer/controller/probe state below the router. Candidate safe extractions:
`useMediaQuery` hook, presentational `Header`-adjacent components, and a
`CompareWorkspace` that owns the toolbar/split-panes/compareOutlet render given
props. Larger orchestration extraction requires the root-mounted boundary to be
preserved (a `useCompareExecution` hook can remain mounted in `RSemble`).


## Workstream C detail — run-controller.ts decomposition (authoritative, READ-ONLY analysis)

Public API returned by `createRunController(deps)` (no named interface; inferred):
`{ runFanout(), abortRun():void, retryCandidate(candidate), retryJudge(), triggerFusion(force=false) }`.
- Callers: all inside rsemble.tsx except `abortRun` (also `ui/useActionShortcuts.ts:19,43`).
- Return shape must stay byte-equivalent (no named type exists; the split must not change names/signatures).

### Internals (line ranges) and coupling:
- `makeEvents` (221–486, ~265 lines) — THE event→reducer+recorder adapter: 10 handlers, closure tightly coupled
  to {dispatch, recorder, streamBuffer, stateRef, runEpochRef, lease, leaseLostRef} + per-run capture bundle.
- `acquireSharedLease` (79–168), `releaseSharedLease` (170–203), `assertCurrentLease` (205–210), `freshAbort` (212–217).
- Entrypoints `runFanout` (488), `abortRun` (595), `retryCandidate` (624), `retryJudge` (721), `triggerFusion` (806).
- Dependency cycles: NONE (all imports outward-only; run-executor only mentions run-controller in a comment).

### Dead / duplication findings:
- **DEAD**: `currentAbortRef` (L67, written at 214) is never read anywhere in src — write-only leftover; safe to delete.
- Duplicated 3×: `rebindExecution` preamble (659-666/762-769/843-850); "load real accepted attempt IDs" (678-688/772-782/852-871);
  `assertCurrentLease` each side of recorder writes (intentional race-fencing — preserve).
- Duplicated 4×: lease-availability FANOUT_BLOCKED reason blocks (547-556/644-653/748-757/829-838); fence/token shape reconstruction.

### Recommended split (ownership-improving), preserving the 5-method facade:
A. events adapter → `createRunEvents(deps, execution)`: move makeEvents wholesale.
B. lease lifecycle → `createLeaseLifecycle(deps)`: acquire/release/assertCurrentLease/freshAbort + their refs.
C. pure helpers (least risk, first): snapshot builder, placeholder builder, fenceFromToken, loadAttemptIds, ≥2-candidates gate.
D. shared retry-stage preamble (`beginRetryStage`) collapsing the 3× copies.
E. thin public facade (the 5 methods compose A–D, keep gating + executor calls).
Dead cleanup after split: delete `currentAbortRef`.
Order: C → B → A → D → E. Keep the `deps.lease === undefined` seam and null-fail-closed semantics. Do NOT alter
dispatch action shapes, recorder method names/order, fence fields, or the `persistedFence ?? deps.executionFence?.() ??
{ownerId:"tab-1",fence:epoch}` fallback — those are provenance-critical.


### rsemble.tsx — dependencies, cycles, recommended decomposition (part 2)
Topology: main.tsx = StrictMode > HashRouter > RepositoryProvider > ExecutionOwnerProvider >
ExperimentControllerProvider > RSemble; RSemble renders ModelProbeProvider wrapping its JSX. Context order
resolves correctly; ExperimentControllerProvider supplies useExecutionLease + useExperimentController above RSemble.
No hard import cycle (nothing re-imports rsemble.tsx). Coupling flags:
1. preflight responsibility is split across the component (RSemble) and run-controller — keep the comparePreflightRef seam.
2. useActionShortcuts/useMediaQuery are leaf UI hooks (low-risk relocate).
3. useMediaQuery + useResizableSplit jointly drive focusActive/isLg and split geometry — MUST stay mounted at/above the route boundary.
Recommended decomposition (provenance-preserving, no global state framework):
- `useCompareEngine()` hook (root-mounted): absorb reducer spine, stream buffer, recorder, run-controller, preflight gating,
  requestRun, Compare-owner release, mode/fusion handlers. Keep invoked from root-mounted RSemble so nav-alive Compare state persists.
- `useProviderReadiness()` hook: readiness map/reasons/catalog/probeCoordinator/poller/connectionState.
- `CompareWorkspace` component (ui/): move compareOutlet JSX verbatim (copy exact class strings, ARIA, data-compare-toolbar,
  role=separator, tabIndex); fed props.
- `CommandDrawer` (mobile dialog) presentational.
- Relocate local helpers to src/ui/: CloseIcon, SplitDivider, CompareFocusStrip, CompareCommandPane, ResetButton, PaneLabel,
  NoKeyBanner, useMediaQuery (SSR guard intact).
- Routes (AppRoutes compareOutlet prop contract) unchanged; no lazy HOC churn on Compare path.


## Workstream E detail — experiment-controller.ts decomposition (authoritative, READ-ONLY analysis)

Public API (`createExperimentController`): start, requestPause, resume, abort, retryIncomplete,
repairMissingCells, addModelAndRun, recoverOnStartup, subscribe, whenIdle.
Created once in `experiment-controller-context.tsx:39`, recoverOnStartup on mount. All consumers go through
useExperimentController/useExecutionLease hooks.

### Internals & single-authority facts
- EXACTLY ONE `runLoop` (555–646) but FIVE launch sites (start/resume/retryIncomplete/repairMissingCells/
  addModelAndRun); single-owner exclusion via owner.tryAcquire; recoverOnStartup never launches a loop.
- ONE atomic terminal commit boundary: `uow.commitTaskTerminal`, invoked at TWO sites (executeTask 519,
  executeCompoundTask 1460); `uow.beginTask` single (424/1339). Other paths use best-effort finalize+abort,
  NOT a terminal commit.
- Provenance: fresh (no plan) stamps experimentTaskAttemptId/trial/protocolFingerprint; repair → executeCompoundTask
  rebuilds runSource from record.protocolFingerprint, seeds via builder.buildRepairRunSeed, rides in source.repair;
  roster-extension rotates roster, RECOMPUTES protocolFingerprint+history, pinned frozen suite (revision:-1) +
  taskEvaluationConfig pinned profiles. Execution always against immutable snapshot, never live suite.

### Dead / duplication
- `abort` = pass-through to abortInternal. Parallel `isTerminal` (648) vs `isTerminalRunStatus` (1009).
- ~90-line duplicated begin→execute→commit pipeline between executeTask and executeCompoundTask (cleanest seam).
- Lease/owner/fence acquisition copy-pasted ~5×; transferredToRunLoop duplicated; profile-resolution loop in start
  duplicates taskEvaluationConfig. No recursive cycle.

### Recommended split (Workstream E)
1. experiment-task-runner.ts — shared core for executeTask+executeCompoundTask parameterized by seeding/plan,
   centralizing begin/commit/sync/emit (single commit invoker + single loop body).
2. experiment-queue-runner.ts — runLoop stays THE scheduler + finalizeActiveRunRecord/abortInternal + launchLoop(fence).
3. experiment-ownership.ts — withExperimentOwnership(expId, fn) collapsing the 5× lease/tryAcquire/fence.
4. experiment-recovery.ts — recoverOnStartup + isTerminalRunStatus.
5. experiment-retry/repair/roster-extension.ts — thin public entrypoints validate→plan→launchLoop.
6. experiment-controller.ts — deps wiring + assembly.


## Workstream F detail — fusion-study-stages.ts modularization (authoritative, READ-ONLY analysis)

### Stage representation
NO single typed stage contract. Three heterogeneous drivers: `runStageA`(270)/StageADriverInput(176),
`runStageB`(477)/StageBDriverInput(459), `runStageC`(1074)/StageCDriverInput(1058). Common tags only:
`FusionStage="A"|"B"|"C"`, `FUSION_STAGES`, `FusionStageResults{stageA|stageB|stageC}`. NO shared
discriminated union / StageDriver<TIn,TOut>. Baselines: bestFixedModelKey(638), Rank via deriveRankWinner,
refine-the-winner control (renderRefineWinnerMessages). Pair screening = full ScreenedPairRow[] table.
Recipe elimination = eliminateFamilies(202)+sequential elimination in runStageB. Holdout = runHoldout(judge2).
Playbook/confirmation live OUTSIDE: fusion-playbook.ts (buildPlaybook, recommendPolicy, playbookConclusion) and
fusion-confirmation.ts (runConfirmationStudy), consuming shared evaluatePairBlocked(789).

### Dev/holdout separation + fingerprints
- Separation by construction/naming, not a runtime guard: study freezes judge1(dev)+judge2(holdout); controllers
  copy BOTH onto each FusionTrial; stages pass study.judge1 to screening/evidence, study.judge2 to runHoldout +
  recordObservation (stamps judge2).
- Fingerprints: synthesis artifacts content-addressed via artifactFor→hashArtifactContent({text,synthesizer,
  promptVersion}); recipes persisted by ensureRecipesPersisted pre-stage. Confirmation enforces FRESH suite via
  confirmation.suiteRef.suiteVersion AND protocolFingerprint vs source.

### Pre-paid prerequisites
- No centralized per-stage validator; orchestration (runFusionStudy) checks study/pool/recipe exist before any
  provider call; runConfirmationStudy has explicit guards. Within stages validation is throw-based/step-wise.

### Screened-pair tables + playbook claims
- runStageB builds ALL pairs (losers included) with headroom+costMultiplier:4, marks shortlisted; returns whole
  table. Claim levels: buildPlaybook copies study.claimLevel; recommendPolicy fuses only if clears +MPID vs both
  Rank+Refine, else best MPID-clearing baseline, else do_not_fuse. Confirmation promotes (confirmed) only when
  preselected recommendation holds on fresh tasks without re-selection.

### Recommended modularization (Workstream F)
1. Add StageDriver<TIn,TOut> + discriminated input union + single runStage(deps,input) dispatch; results already
   implement {completedAt:number}.
2. Split per stage: fusion-stage-a.ts (runStageA, eliminateFamilies, meanFamilyScores, StratifiedPair);
   fusion-stage-b.ts (runStageB, bestFixedModelKey, runPoolAdequacyProbe); fusion-stage-pair.ts
   (evaluatePairBlocked, PairEvalOutcome/PairEvaluationInput, resolvePairSlots, policyForKey, finishTrial);
   fusion-stage-c.ts (runStageC).
3. Extract fusion-stage-common.ts with ONE sealTrial helper — the createTrial→attachChildren→writeTrialCost→
   recordObservation→seal sequence repeats inline (runStageA 336–367/371–403) and 3× via finishTrial.
   Move writeTrialCost/evidenceCosts/recordObservation/artifactFor there.
4. Hoist activePoolSlots/modelKeyOf (copy-pasted in fusion-study-orchestration). Shared module.
5. Keep pure decision cells (eliminateFamilies, bestFixedModelKey, probePoolAdequacy use, computeHeadroom) as
   pure exported testable functions above paid-call drivers.

Cross-cutting E&F: hide thin-wrappers; extract shared inner runner/finisher first, then split by responsibility,
keeping ONE authority (one runLoop; one commit invoker; one StageDriver dispatch; one sealTrial).
