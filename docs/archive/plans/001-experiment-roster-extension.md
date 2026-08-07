# Plan 001: Extend a finished experiment with one model and run only its new evidence

> **Executor instructions**: Follow this plan in order. Run every verification
> command and confirm the expected result before continuing. If a STOP condition
> occurs, stop and report it; do not improvise. When complete, update this plan's
> status in `plans/README.md` unless a reviewer owns the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 8606fd3..HEAD -- \
>   src/app-router.tsx \
>   src/rsemble.tsx \
>   src/lib/evaluations \
>   src/lib/persistence \
>   src/workspaces/evaluations \
>   src/ui/ModelList.tsx \
>   package.json \
>   scripts
> git status --short -- docs/specs/pending/experiment-roster-extension-spec.md
> sha256sum docs/specs/pending/experiment-roster-extension-spec.md
> ```
>
> The specification was untracked when this plan was written. Its expected
> SHA-256 is
> `99d1dcb7e961541458eba63bb3b86f5d3ccd2b961158e8509fdab144bd87e637`.
> If an in-scope file changed after commit `8606fd3`, reconcile the excerpts and
> contracts below against live code. If the specification hash differs, treat it
> as a STOP condition and obtain a refreshed plan.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `8606fd3`, 2026-08-04
- **Source specification**: `docs/specs/pending/experiment-roster-extension-spec.md`

## Why this matters

A finished experiment currently cannot add one new candidate without rerunning
its whole immutable roster. The existing compound-repair path already supports
reusing accepted candidate outputs, executing selected model keys, and running a
fresh blind Judge pass. This change must expose that capability as an intentional
roster extension while preserving immutable prior runs, exact paid-call counts,
fingerprint integrity, lease/fence/CAS behavior, and distinct non-recovery UX.

The highest risks are paying twice after a crash or persistence failure, silently
changing snapshot content other than the roster, letting a failed extension
replace better selected evidence, and presenting extension provenance as repair.
The implementation therefore starts with persisted contracts and pure planning,
then reuses the existing queue and compound executor under a distinct
`"roster-extension"` discriminant.

## Current state

### Domain and persistence

- `src/lib/evaluations/evaluation-types.ts:133-203` defines task attempts,
  missing-cell repair metadata, snapshots, and experiment records. There is no
  extension history or extension execution plan:

  ```ts
  export interface ExperimentTaskAttempt {
    // ...
    coverage?: ExperimentAttemptCoverage;
    repair?: ExperimentRepairPlan;
  }

  export interface ExperimentRepairPlan {
    kind: "missing-cells";
    baseRunId: string;
    requestedModelKeys: string[];
  }

  export interface ExperimentRecord {
    // ...
    protocolFingerprint: string;
    snapshot: ExperimentSnapshot;
    tasks: ExperimentTaskState[];
  }
  ```

- `src/lib/evaluations/evaluation-types.ts:449-527` runtime-validates persisted
  attempts and experiment records. New optional fields must have equivalent
  guards; imported JSON cannot be trusted through TypeScript casts.
- `src/lib/persistence/run-types.ts:96-113` stores repair metadata only on the
  experiment branch of `RunSource`. `isRunSource` at lines 409-430 validates it.
- `src/lib/persistence/experiment-unit-of-work.ts:195-252` atomically commits a
  run and task attempt and copies optional `coverage` and `repair` metadata onto
  the terminal attempt. Preserve this atomic boundary.
- IndexedDB stores experiments and runs as object blobs. No Dexie index or
  database-version change is needed for optional extension fields.

### Fingerprints and snapshot execution

- `src/lib/evaluations/protocol-fingerprint.ts:36-85` includes semantic
  `modelSlots` in the canonical SHA-256 fingerprint input. Slot `id` and display
  provider are intentionally excluded; `providerId`, `slug`, `model`, and
  `enabled` are included.
- `src/lib/evaluations/experiment-controller.ts:114-142` rebuilds execution
  suites from immutable snapshots, not the live suite. Extension must execute
  against the rotated snapshot in the same way.
- The extension must change only `snapshot.modelSlots` and
  `snapshot.protocolFingerprint`; all task, profile, Judge, evaluation,
  `createdAt`, suite identity, and experiment identity fields remain unchanged.
  `record.protocolFingerprint` must equal the rotated snapshot fingerprint.

### Existing compound execution

- `src/lib/persistence/run-record-builder.ts:207-287` already builds a fresh
  seeded run. For each rotated slot it reuses an accepted base attempt when the
  key is not requested and leaves requested or non-reusable candidates
  unstarted. It already tolerates a requested key that did not exist in the base
  run; add a regression test rather than a second seed builder.
- `src/lib/evaluations/experiment-controller.ts:985-1148` executes compound
  repair attempts: load base run, seed fresh candidates with `reusedFrom`, call
  the executor with `candidateExecution.executeModelKeys`, derive fresh Judge
  coverage, and atomically commit the run plus attempt.
- `src/lib/evaluations/experiment-controller.ts:478-543` routes queued attempts
  with `queuedAttempt.repair` through that compound path. The loop owns pause at
  boundaries, abort, heartbeat, error stopping, and execution release.
- `src/lib/evaluations/experiment-engine.ts:476-519` queues repair attempts only
  on terminal records, appends one attempt per task, and sets the record to
  `running` with the active fence.
- `src/lib/evaluations/experiment-repair.ts` rejects requested models outside
  the current snapshot and guards the base run fingerprint. Those guards are
  correct and must not be weakened for roster extension.

### Suite persistence

- `src/lib/persistence/evaluation-repository.ts:37-56` exposes `getSuite` and
  `saveSuite`.
- `saveSuite` at lines 88-111 validates the complete suite and performs a CAS on
  `revision`, returning the next revision. A suite-sync write must load the
  latest suite, append the exact extension slot, increment `version`, set
  `updatedAt`, and call `saveSuite(updated, prior.revision)`.
- `StorageError.kind === "conflict"` is the existing stale-write signal
  (`src/lib/persistence/database.ts:145-163`).

### Results UI and model picker

- `src/workspaces/evaluations/ExperimentResults.tsx:435-456` renders the terminal
  header and **Back to suite** action. Recovery controls are separately rendered
  at lines 661 onward. **Add model** belongs in the header action row, never in
  the recovery toolbar.
- `ExperimentResults.tsx:163-171` currently derives `recoveryEnabled` from
  controller presence and status. Generalize this to an
  `executionActionsEnabled` prop derived from the reactive in-tab execution
  owner. Cross-tab races remain protected by lease acquisition in the
  controller.
- `src/lib/execution-owner-context.tsx:13-44` provides the reactive active owner.
  `SuiteEditor.tsx:71-79` is the existing test-seam pattern: use context by
  default, but accept an explicit prop in component tests.
- `src/rsemble.tsx:148-190` owns both the provider `readinessMap` and merged
  `CatalogModel[]`; `src/rsemble.tsx:433-469` currently passes only `models` to
  `AppRoutes`. Provider readiness and catalog population are distinct: a ready
  provider can have an empty/unavailable catalog, while raw-slug entry must
  remain usable.
- `src/app-router.tsx:61-83` passes `models` to suite routes but not to
  `ExperimentRoute`. Extend the existing route props with the ready provider IDs
  derived in `rsemble.tsx`; do not introduce a second probe or catalog store.
- `src/ui/ModelList.tsx:267-439` exports `AddModelCombobox`, which already
  supports provider tabs, live catalog entries, raw slugs even when the catalog
  is empty (lines 303-324 and 417-429), taken keys, initial focus, Escape, and
  44px controls. Reuse it unchanged unless a failing behavior test proves an
  accessibility defect.
- `src/ui/DialogSurface.tsx` provides the Base UI focus trap, Escape handling,
  and focus restoration contract.
- `src/workspaces/runs/RunDetail.tsx:244-276` already displays candidate-level
  **Reused from prior attempt** provenance and links to the source run. Do not
  duplicate this label.

### Product and design constraints

- Preserve the product spine: task → candidates → blind Judge → Rank. Do not
  branch or edit `src/lib/pipeline.ts`.
- This is an audit-surface action. Use compact industrial/instrument copy,
  exact call counts, no currency estimate, no celebration, no entrance motion,
  and no permanent “recently added” badge.
- Interactive targets are at least 44×44px and use `focus-visible`; standard UI
  text is at least `text-sm`. Do not add `zinc-*`, `text-[10px]`, Framer Motion,
  or interactive `text-text-muted`.
- Use named `lucide-react` imports only if an icon is necessary. The **Add
  model** trigger must have visible text and cannot be icon-only.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Domain tests | `npm test -- src/lib/evaluations/experiment-roster-extension.test.ts src/lib/evaluations/protocol-fingerprint.test.ts src/lib/evaluations/experiment-engine.test.ts src/lib/persistence/run-types.test.ts src/lib/persistence/run-record-builder.test.ts src/lib/persistence/experiment-unit-of-work.test.ts` | all selected Vitest files pass |
| Controller tests | `npm test -- src/lib/evaluations/experiment-controller.test.ts src/lib/evaluations/experiment-repair.test.ts src/lib/run-executor.test.ts` | extension tests and repair/executor regressions pass |
| UI tests | `npm test -- src/workspaces/evaluations/ExperimentAddModelDialog.test.tsx src/workspaces/evaluations/ExperimentResults.test.tsx src/workspaces/evaluations/ExperimentRoute.test.tsx src/ui/ModelList.test.tsx src/workspaces/runs/RunDetail.test.tsx` | all selected component tests pass |
| Web typecheck | `npm run typecheck:web` | exit 0, no diagnostics |
| Full verification | `npm run check` | web/server types, tests, and build all pass |
| Browser QA | `npm run qa:roster-extension` | exits 0 and records all required deterministic scenarios |
| Whitespace | `git diff --check` | no output, exit 0 |

## Scope

**In scope** — modify only when required by the ordered steps:

- `src/lib/evaluations/evaluation-types.ts`
- `src/lib/evaluations/experiment-roster-extension.ts` (create)
- `src/lib/evaluations/experiment-roster-extension.test.ts` (create)
- `src/lib/evaluations/protocol-fingerprint.ts`
- `src/lib/evaluations/protocol-fingerprint.test.ts` (create)
- `src/lib/evaluations/experiment-engine.ts`
- `src/lib/evaluations/experiment-engine.test.ts`
- `src/lib/evaluations/experiment-controller.ts`
- `src/lib/evaluations/experiment-controller.test.ts`
- `src/lib/persistence/run-types.ts`
- `src/lib/persistence/run-types.test.ts`
- `src/lib/persistence/run-record-builder.ts` only for neutral naming/comments if
  needed; its reuse algorithm should not be rewritten
- `src/lib/persistence/run-record-builder.test.ts`
- `src/lib/persistence/experiment-unit-of-work.ts`
- `src/lib/persistence/experiment-unit-of-work.test.ts`
- `src/lib/evaluations/suite-roster-extension.ts` (create)
- `src/lib/evaluations/suite-roster-extension.test.ts` (create)
- `src/workspaces/evaluations/ExperimentAddModelDialog.tsx` (create)
- `src/workspaces/evaluations/ExperimentAddModelDialog.test.tsx` (create)
- `src/workspaces/evaluations/ExperimentResults.tsx`
- `src/workspaces/evaluations/ExperimentResults.test.tsx`
- `src/workspaces/evaluations/ExperimentRoute.tsx`
- `src/workspaces/evaluations/ExperimentRoute.test.tsx`
- `src/rsemble.tsx`
- `src/app-router.tsx`
- `scripts/cdp-experiment-roster-extension-qa.mjs` (create)
- `package.json` for `qa:roster-extension`
- `docs/qa/experiment-roster-extension/*` generated deterministic QA evidence
- `plans/README.md` status only

**Out of scope — do not touch even if related**:

- `src/lib/pipeline.ts`, `src/lib/run-executor.ts`, and their behavior. The
  existing selected-candidate execution path is sufficient.
- `src/lib/evaluations/experiment-repair.ts`; its snapshot-membership and
  fingerprint guards stay unchanged.
- `src/lib/evaluations/experiment-aggregation.ts`, ranking helpers,
  `ResultMatrix.tsx`, and `MobileExperimentResults.tsx`. The rotated roster must
  flow through them without special cases.
- `src/studio-engine.ts`, `src/studio-data.ts` seeds, and
  `src/lib/providers/**`.
- Database indexes/schema version, archive schema version, and migration of old
  records. New fields are optional and existing records remain readable.
- Multiple-model addition, removal/replacement, evaluation/profile changes,
  winner-rule changes, currency estimates, or a recovery-toolbar entry.
- Any provider call in browser QA. QA must use deterministic in-page mocks.

## Git workflow

- Suggested branch: `feat/experiment-roster-extension`.
- Use conventional commits matching repository history, for example:
  `feat: orchestrate experiment roster extension`.
- Commit by logical workstream; do not push or open a PR unless instructed.
- Never commit unrelated working-tree files. In particular, preserve the
  pre-existing research and evaluation files reported by `git status`.

## Workstream A — Persist honest extension provenance

### A1. Add domain types and runtime guards first

In `evaluation-types.ts`, add:

```ts
export interface ExperimentRosterExtensionPlan {
  kind: "roster-extension";
  addedModelKey: string;
  /** Present for compound reuse; absent for full-roster fallback. */
  baseRunId?: string;
}

export type ExperimentTaskExecutionPlan =
  | ExperimentRepairPlan
  | ExperimentRosterExtensionPlan;

export interface ExperimentRosterExtension {
  addedModelKey: string;
  addedSlot: ModelSlot;
  priorFingerprint: string;
  extendedAt: number;
}
```

Widen the existing optional persisted attempt field to
`repair?: ExperimentTaskExecutionPlan` instead of adding a second ambiguous
field. The property name is legacy persisted schema; the `kind` discriminant is
load-bearing. Never derive user-visible “repair” wording from the property name.
Add `rosterExtensions?: ExperimentRosterExtension[]` to `ExperimentRecord`.
Keep both fields optional so existing IndexedDB and archive records remain valid.

Update `CommitExperimentTaskTerminalInput.repair` and the engine/UoW input types
to accept the union. Add guards that enforce:

- non-empty `addedModelKey` and `priorFingerprint`;
- a valid enabled `addedSlot` whose key equals `addedModelKey`;
- finite non-negative `extendedAt`;
- optional non-empty `baseRunId`;
- unique extension keys and unique added slot IDs across history;
- no duplicate requested keys in missing-cell plans;
- prohibited credential-shaped keys remain rejected.

In `run-types.ts`, widen only the experiment source's optional `repair` value to
the same two discriminants and update `isRunSource`. Preserve old missing-cell
sources byte-for-byte.

**Tests**:

1. Existing records with no extension fields still validate.
2. Existing `missing-cells` attempts and run sources still validate.
3. Compound and full-fallback `roster-extension` plans validate.
4. Blank model/base IDs, mismatched `addedModelKey`/slot, duplicate history
   keys/slot IDs, invalid timestamps, and prohibited credential-shaped fields
   fail validation.
5. The UoW copies the exact roster-extension plan to a committed attempt and is
   still idempotent for an identical terminal payload.

**Verify RED before implementation**:

```bash
npm test -- src/lib/persistence/run-types.test.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts
```

Expected: only the newly added extension assertions fail for missing types or
behavior; existing tests remain green.

**Verify GREEN after implementation**: run the same command. Expected: all pass.

### A2. Preserve candidate-level reuse behavior

Add a `run-record-builder.test.ts` case whose rotated roster contains all old
slots plus a requested new slot absent from `baseRun.candidates`. Assert:

- accepted old candidates receive fresh candidate/attempt IDs and exact
  `reusedFrom` links;
- the new slot is persisted with no accepted attempt and no attempts;
- Judge/fusion evidence and winners are empty;
- the base run remains deeply equal to a pre-call copy.

Do not fork `buildRepairRunSeed`. Rename its input/comment to neutral “compound
run seed” terminology only if that can be done without a persisted-format
migration; otherwise keep the internal function name and reuse it.

**Verify**:

```bash
npm test -- src/lib/persistence/run-record-builder.test.ts
```

Expected: all builder tests pass, including the absent-new-key case.

## Workstream B — Build a pure roster-extension planner and rotator

Create `experiment-roster-extension.ts` with no repository, provider, or React
imports. Use dependency injection for synchronous run resolution, matching
`planMissingCellRepair`.

### B1. Define the planner contract

Use an explicit result union:

```ts
export interface RosterExtensionTaskPlan {
  taskId: string;
  executionPlan: ExperimentRosterExtensionPlan;
  mode: "compound" | "full-roster";
  candidateCalls: number;
  judgeCalls: 1;
  reusedModelKeys: string[];
}

export interface RosterExtensionPlan {
  addedModelKey: string;
  addedSlot: ModelSlot;
  taskPlans: RosterExtensionTaskPlan[];
  taskCount: number;
  candidateCalls: number;
  judgeCalls: number;
  reusedOutputCount: number;
  fullRosterFallbackCount: number;
  fullRosterCandidateCount: number;
}

export type RosterExtensionPlanResult =
  | { ok: true; plan: RosterExtensionPlan }
  | { ok: false; reason: string };
```

Export:

```ts
planRosterExtension({ experiment, slot, resolveRunRecord }): RosterExtensionPlanResult
rotateExperimentRoster({ experiment, slot, extendedAt }):
  | { ok: true; record: ExperimentRecord; historyEntry: ExperimentRosterExtension }
  | { ok: false; reason: string }
```

### B2. Implement exact per-task planning

The planner must:

1. Require a terminal experiment status: `completed`,
   `completed_with_failures`, `aborted`, or `interrupted`.
2. Require an enabled, structurally valid slot and reject its
   `providerId:slug` if already present in `snapshot.modelSlots` or extension
   history.
3. Iterate every snapshot task in snapshot order and emit exactly one task plan.
4. Choose `compound` only when the selected attempt is terminal, has a loadable
   run, and that run contains at least one accepted candidate whose accepted
   attempt exists and is completed.
5. Before allowing compound reuse, validate that the base run source is the same
   experiment, suite/version, task, selected attempt, and current pre-extension
   protocol fingerprint. Identity mismatch must use full-roster fallback, not
   cross-task/cross-protocol reuse.
6. For compound tasks, set `baseRunId`, request only `addedModelKey`, count one
   candidate call and one Judge call, and list every reusable accepted old key.
7. For fallback tasks, omit `baseRunId`, count every enabled slot in the rotated
   roster as candidate calls, count one Judge call, and reuse zero outputs.
8. Sum totals from task plans; never estimate currency.
9. Return fresh arrays/objects and never mutate the record, slot, or runs.

Cost identity must hold:

```text
candidateCalls = compoundTaskCount
               + fullRosterFallbackCount * fullRosterCandidateCount
judgeCalls = taskCount
reusedOutputCount = sum(compound reusedModelKeys.length)
```

### B3. Rotate only fingerprinted roster content

Refactor `protocol-fingerprint.ts` just enough to expose a snapshot-based
fingerprint helper without duplicating canonical input rules. Both suite-based
and snapshot-based computation must call one internal semantic-input builder.
The rotator must:

1. Append a cloned enabled slot to `snapshot.modelSlots`.
2. Compute the new fingerprint from the rotated snapshot semantics and pinned
   profiles.
3. Set both `snapshot.protocolFingerprint` and
   `record.protocolFingerprint` to the new value.
4. Append one history entry with the exact slot identity, old fingerprint, and
   supplied timestamp.
5. Leave suite ID/version, tasks, profiles, Judge, evaluation, snapshot
   `createdAt`, experiment task states, and existing history unchanged.

Do not set the record to `running` here; the engine queue transition owns status,
fence, and queued attempts.

### B4. Planner and rotator tests

Cover at minimum:

- all tasks compound;
- mixed compound/fallback planning;
- no attempts, unavailable run, no accepted candidate, and mismatched run source
  each use full-roster fallback;
- exact counts with three tasks, one fallback, and a rotated roster;
- duplicate key in current roster and history rejects;
- same slug under a different provider remains distinct;
- disabled slot rejects;
- new fingerprint differs from the prior one and has the canonical SHA-256
  shape;
- fingerprint changes if provider/model/enabled roster semantics change;
- deep equality of every snapshot field except `modelSlots` and
  `protocolFingerprint`;
- original experiment, slot, and run fixtures are unmodified.

**Verify**:

```bash
npm test -- src/lib/evaluations/experiment-roster-extension.test.ts \
  src/lib/evaluations/protocol-fingerprint.test.ts \
  src/lib/evaluations/experiment-repair.test.ts
```

Expected: planner/rotation tests pass and repair guards remain green.

## Workstream C — Queue the rotated record without weakening engine invariants

### C1. Generalize the queue transition by discriminant

Rename `queueRepairs` to a neutral internal engine method such as
`queuePlannedAttempts`; migrate every caller and test in the same commit. It
accepts task IDs paired with `ExperimentTaskExecutionPlan` and retains all
current pre-mutation validation:

- record must be terminal;
- input cannot be empty;
- every task must exist;
- no task may be queued twice;
- every plan must pass its discriminant-specific invariants.

For each item, append exactly one queued attempt with `runId: null`, the next
trial number, and the supplied plan in the persisted optional `repair` field.
Set the record to `running`, attach the supplied fence, preserve all prior
attempts, and queue tasks in snapshot order.

Do not overload `retryIncomplete`; extension always queues every task, including
tasks that previously had complete evidence.

### C2. Keep rotation plus queue one CAS-visible state change

The controller will create the engine from the in-memory rotated record, call the
neutral queue transition, and persist `engine.record` once against the original
experiment revision. Test this engine sequence directly:

1. Start from a terminal record.
2. Rotate it with Workstream B.
3. Create an engine from the rotated record.
4. Queue one extension plan per snapshot task.
5. Assert the resulting record simultaneously contains the new fingerprint,
   extension history, queued attempts, `running` status, and fence.

There must be no persisted intermediate state where the roster is rotated but
no attempts are queued; otherwise a failure would make retry impossible because
the model already appears present.

### C3. Regression coverage

Extend engine tests for:

- compound and full-roster extension plans in one queue;
- one queued attempt per task and stable task order;
- pause before the first task leaves attempts queued;
- abort clears execution without deleting extension history or queued/terminal
  attempts;
- failed/partial extension attempts do not displace the prior selected attempt;
- completed full-coverage extension attempts become selected through the
  existing coverage selector;
- existing missing-cell repair and `retryIncomplete` behavior remains unchanged.

**Verify**:

```bash
npm test -- src/lib/evaluations/experiment-engine.test.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts
```

Expected: all engine and UoW tests pass.

## Workstream D — Orchestrate extension through the existing controller loop

### D1. Add the public method

Add to `ExperimentController` and the returned controller object:

```ts
addModelAndRun(
  experimentId: string,
  input: { slot: ModelSlot },
): Promise<StartResult>;
```

Update all controller test doubles in the repository in the same workstream.
Use the exact ownership pattern from `repairMissingCells`: load, acquire lease,
acquire in-tab owner, set `transferredToRunLoop = false`, and release lease,
owner, engine, experiment ID, and suite in `finally` on every pre-transfer exit.

### D2. Re-plan after ownership acquisition

After lease and owner acquisition, but before any provider call:

1. Load every selected attempt run into a cache.
2. Run `planRosterExtension` against the freshly loaded experiment.
3. Reject duplicates, non-terminal records, and invalid slots before rotation.
4. Rotate in memory using one `extendedAt = now()` value.
5. Rebuild the pinned suite from the rotated snapshot.
6. Create the engine from the rotated record.
7. Queue all task plans through the neutral engine transition.
8. Persist the queued rotated record in one CAS against the original revision.
9. Start heartbeat, transfer ownership to the loop, and return
   `{ ok: true, experimentId }`.

A stale experiment CAS must release ownership and return an error without a paid
call. Never weaken duplicate validation merely because the picker filtered the
key.

### D3. Generalize task execution, not pipeline behavior

Rename `executeRepairTask` to a neutral compound executor if useful. Route by
plan kind:

- `missing-cells` → current compound behavior unchanged;
- `roster-extension` with `baseRunId` → compound seed over the rotated roster,
  with `requestedModelKeys` exactly `[addedModelKey]`;
- `roster-extension` without `baseRunId` → normal full-roster execution over the
  rotated pinned suite, but carry the roster-extension plan in `RunSource` and
  terminal attempt metadata;
- no plan → current initial/retry execution.

For both extension modes:

- `RunSource.protocolFingerprint` is the rotated fingerprint;
- source plan contains the added key and optional base run;
- compound reuse may come from a run whose source carries the prior fingerprint;
  this exception is authorized only by the extension plan created before
  rotation;
- old Judge reports/scores/winners are never seeded;
- coverage totals use the rotated enabled roster;
- terminal commit includes the exact plan through engine and UoW.

Do not change `RunExecutor` or `pipeline.ts`. The current
`candidateExecution.executeModelKeys` and seeded-candidate input already produce
one fresh candidate plus one fresh blind Judge pass.

### D4. Controller behavior tests

Use the existing in-memory harness and fake executor. Add tests for:

1. One compound attempt per task calls only the added model and reuses old
   accepted outputs.
2. One task without reusable evidence executes the full rotated roster while
   other tasks stay compound.
3. The fake executor receives one request per task in snapshot order and one
   Judge pass per request.
4. New run sources and terminal attempts persist the correct discriminant,
   model key, base run ID presence/absence, and rotated fingerprint.
5. A completed extension becomes selected; a failed/partial extension preserves
   the prior selected attempt and leaves the new cell missing.
6. Duplicate model, non-terminal status, malformed slot, lease conflict, owner
   conflict, and stale CAS reject before the executor sees a request.
7. Pause between tasks stops at the boundary; resume continues without
   re-executing committed tasks.
8. Abort marks the active run/attempt terminal and stops later tasks.
9. Persistence failure after a task stops before the next paid task.
10. Startup recovery adopts an already committed terminal extension run and
    never sends another provider request.
11. Existing repair ownership, fence, abort, recovery, and fingerprint tests
    remain unchanged and green.

**Verify**:

```bash
npm test -- src/lib/evaluations/experiment-controller.test.ts \
  src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-repair.test.ts \
  src/lib/run-executor.test.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts
```

Expected: all selected tests pass; no change to executor or pipeline source.

## Workstream E — Save the slot to the source suite independently

Create `suite-roster-extension.ts` as a small repository service. Do not put the
suite write inside `addModelAndRun`; the two writes have different blast radii
and the specification requires suite sync first but independently.

### E1. Define a typed result

```ts
export type SuiteRosterExtensionResult =
  | { ok: true; suiteVersion: number }
  | {
      ok: false;
      code: "not-found" | "archived" | "duplicate" | "conflict" | "storage";
      message: string;
    };

export async function appendModelToSuite(
  repo: EvaluationRepository,
  input: { suiteId: string; slot: ModelSlot; now: number },
): Promise<SuiteRosterExtensionResult>;
```

### E2. Enforce append-only CAS semantics

The service must load the current persisted suite immediately before saving.
Return a typed non-throwing failure when missing, archived, or already containing
the model key. Otherwise save:

```ts
{
  ...suite,
  modelSlots: [...suite.modelSlots, input.slot],
  version: suite.version + 1,
  updatedAt: input.now,
}
```

Call `saveSuite(updated, suite.revision)`. Map `StorageError("conflict")` to the
exact user-facing message:

> Suite was modified elsewhere — the model was added to these results only.

Use equivalent specific “results only” copy for archived, duplicate, missing,
and generic storage failures. Never rewrite tasks, Judge, evaluation pins,
description, creation time, or archive state. Preserve the slot's exact stable
ID and semantic fields; do not generate a second slot.

### E3. Suite-sync tests

Cover success, unchecked behavior at the UI layer, archived suite, duplicate
key, stale CAS, missing suite, generic storage failure, version/revision
increments, exact stable slot identity, and deep equality of every unrelated
suite field.

**Verify**:

```bash
npm test -- src/lib/evaluations/suite-roster-extension.test.ts \
  src/lib/persistence/evaluation-repository.test.ts
```

Expected: all tests pass.

## Workstream F — Add the distinct terminal-results interaction

### F1. Wire catalog and owner state to the route

- In `rsemble.tsx`, derive `availableProviderIds: ProviderId[]` from the current
  `readinessMap` booleans and pass it to `AppRoutes` with `models`. Preserve the
  registry's stable provider order rather than relying on object-key order.
- Change `AppRoutes` so `ExperimentRoute` receives the same `models` array used
  by `SuiteEditor` plus `availableProviderIds`; do not fetch readiness or
  catalogs inside the results route.
- In `ExperimentRoute`, read `useExecutionOwner().owner` and pass
  `executionActionsEnabled={controller !== null && owner === null}` to
  `ExperimentResults` together with `models` and `availableProviderIds`.
- Keep test seams explicit so component tests need not mount global provider or
  owner contexts.
- Rename the local recovery gate to use this generalized execution-action gate.
  Recovery and add-model actions are absent when another in-tab execution owns
  the registry. Cross-tab acquisition can still fail on confirm and must render
  the controller error.

### F2. Build `ExperimentAddModelDialog`

Use `DialogSurface` and the existing `AddModelCombobox`. Props should be data and
callbacks only: open state, catalog, available provider IDs, taken keys, suite
name, selected slot, planner preview, busy state, suite-sync default, message,
and confirm/cancel. Keep orchestration in `ExperimentResults`. Initialize the
picker on the first available provider so an empty catalog still permits raw
slug entry through the ready provider.

Dialog order and copy:

1. Title: **Add model to results**.
2. Model picker. Commit a catalog or raw slug to one selected `ModelSlot`; offer
   a 44px **Change model** action without generating another slot on confirm.
3. Checked-by-default checkbox with accessible name containing the suite name:
   **Also add to suite _<suite name>_**.
4. Exact preview from `planRosterExtension`:
   **X candidate calls + Y Judge calls across Z tasks. R accepted candidate
   outputs will be reused.**
5. When fallback count is non-zero, add:
   **F task(s) lack reusable evidence and will run the full roster (M candidates
   each).**
6. One `role="alert"` message region.
7. **Cancel** and **Add and run**; busy copy is **Starting…**.

Disable confirm until a slot is selected and planning succeeds. Escape/cancel is
disabled while busy. The picker receives initial focus; Base UI traps focus and
restores it to the **Add model** trigger.

### F3. Add the header action and history disclosure

In `ExperimentResults`:

- Place visible-text **Add model** beside **Back to suite** in the header action
  row. It is never rendered inside or adjacent to the recovery toolbar.
- Render it when execution actions are enabled and at least one provider is
  ready, even when `models` is empty. Build `takenKeys` from snapshot slots plus
  extension history.
- Do not treat catalog exhaustion as “nothing left to add”: every currently
  registered picker provider supports raw-slug entry, so a ready provider still
  has an eligible model namespace after all known catalog entries are taken.
  The specification's disabled state is therefore unreachable with the current
  picker contract. If raw-slug support later becomes provider-restricted, add a
  capability-backed `nothingToAdd` predicate and its explanatory text then;
  never infer it from catalog length.
- Do not add any matrix/standings badge or special column style.
- Add a compact **Roster extensions (N)** audit disclosure outside standings and
  recovery. List added model identity and extension timestamp in append order;
  link task/run provenance through existing attempt/run links rather than
  duplicating candidate evidence.
- Render add-model handoff/warning messages under the header, not inside the
  recovery toolbar.

### F4. Confirm in the required order

On confirm:

1. Freeze the selected `slot` object for the operation.
2. If suite sync is checked, await `appendModelToSuite` first.
3. Regardless of suite-sync success/failure, call
   `controller.addModelAndRun(experiment.id, { slot })`.
4. If the controller fails, keep the dialog open and report whether the suite
   was already updated so the user is not misled.
5. If the controller succeeds, close the dialog and render on the results
   surface:
   **Add-model run started — navigate to the progress view to watch it.**
6. If suite sync failed, append its specific “results only” warning to that
   handoff message. The warning must remain visible after the dialog closes.

The controller event/poll path then reloads the now-running experiment and
`ExperimentRoute` switches to `ExperimentProgress`. Do not navigate manually or
create a second progress route.

### F5. UI tests

Add component tests for:

- action placement in the header and absence from the Recovery section;
- absence when non-terminal (route renders progress), owner active, controller
  unavailable, or no provider is ready;
- catalog-empty but provider-ready state still opens the picker and accepts a
  raw slug;
- all known catalog entries taken still leaves raw-slug entry available;
- taken keys exclude current/history duplicates in catalog and raw entry;
- catalog selection and raw-slug selection;
- checked-by-default suite sync and unchecked no-write path;
- exact compound/fallback/reuse cost copy;
- suite save resolves before controller call begins;
- every suite-sync failure still calls the controller once;
- conflict warning plus successful run appears on the results surface;
- controller failure keeps dialog open and reports prior suite-save outcome;
- busy copy, Escape suppression while busy, focus trap, and focus restoration;
- action absent after the record becomes running;
- extension history is auditable but the matrix/standings carry no recently
  added badge;
- all existing recovery controls and copy remain unchanged.

**Verify**:

```bash
npm test -- src/workspaces/evaluations/ExperimentAddModelDialog.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ExperimentRoute.test.tsx \
  src/ui/ModelList.test.tsx \
  src/workspaces/runs/RunDetail.test.tsx
npm run typecheck:web
```

Expected: all tests pass and typecheck emits no diagnostics.

## Workstream G — Integrated regression and browser proof

### G1. Run the focused automated gate

```bash
npm test -- src/lib/evaluations/experiment-roster-extension.test.ts \
  src/lib/evaluations/protocol-fingerprint.test.ts \
  src/lib/evaluations/experiment-engine.test.ts \
  src/lib/evaluations/experiment-controller.test.ts \
  src/lib/evaluations/experiment-repair.test.ts \
  src/lib/evaluations/suite-roster-extension.test.ts \
  src/lib/persistence/run-types.test.ts \
  src/lib/persistence/run-record-builder.test.ts \
  src/lib/persistence/experiment-unit-of-work.test.ts \
  src/lib/run-executor.test.ts \
  src/workspaces/evaluations/ExperimentAddModelDialog.test.tsx \
  src/workspaces/evaluations/ExperimentResults.test.tsx \
  src/workspaces/evaluations/ExperimentRoute.test.tsx \
  src/workspaces/runs/RunDetail.test.tsx
```

Expected: all selected suites pass. Fix the source of any repair, lease, fence,
selection, or persistence regression; do not weaken old assertions.

### G2. Add deterministic production-preview QA

Create `scripts/cdp-experiment-roster-extension-qa.mjs` following the isolated
Chrome/CDP pattern in `scripts/cdp-suite-reliability-qa.mjs`. Add
`qa:roster-extension` to `package.json`. Use in-page mocked provider responses
and seeded IndexedDB only; never send a paid call or print credentials.

The script must fail nonzero on the first unmet assertion and record bounded
JSON/screenshots under `docs/qa/experiment-roster-extension/`. Exercise:

1. Catalog model + suite sync on: exact preview, progress handoff, only new model
   provider calls on reusable tasks, fresh Judge calls, scored new column, suite
   version increment, and stable slot ID in suite plus experiment.
2. Raw slug + suite sync off with a ready provider and an empty catalog: new
   result column and unchanged suite.
3. One task with no reusable accepted run: fallback sentence and counts, that
   task executes the full rotated roster, other tasks execute only the new model.
4. Existing roster/history model: excluded/disabled in picker and rejected by a
   direct controller attempt before network.
5. Abort during extension, reload/recovery, and verify committed terminal task
   runs are adopted without another provider request.
6. Keyboard-only open/select/confirm/cancel, Escape, focus restoration, 390px
   viewport, 200% zoom, and reduced-motion status text.
7. Visual separation: header action exists while the recovery toolbar, when
   present, contains recovery actions only.

If the script embeds JavaScript fixture source as a string, validate the
extracted body with `new Function(body)` and ensure delimiter/parenthesis balance
before running browser QA.

**Verify**:

```bash
npm run build
```

Start the production preview on the QA script's configured local port, then run:

```bash
npm run qa:roster-extension
```

Expected: build exits 0; QA exits 0; every required scenario is present in the
JSON evidence; no real provider endpoint is contacted.

### G3. Run the repository-wide gate last

```bash
npm run check
git diff --check
git status --short
```

Expected:

- `npm run check` exits 0 (web/server typechecks, all tests, build).
- `git diff --check` has no output.
- `git status --short` contains only this plan's implementation/evidence files
  plus the user's pre-existing unrelated modifications.

## Test plan summary

The permanent contract requires all of the following test layers:

- **Pure planner/rotator**: exact call math, fallback selection, identity and
  fingerprint guards, immutability, duplicate prevention.
- **Persistence schemas**: optional backward-compatible history/plan fields,
  run-source provenance, prohibited-key rejection, UoW atomicity/idempotence.
- **Engine/controller**: one queued attempt per task, compound vs full fallback,
  selection behavior, lease/fence/CAS, pause/abort, persistence stopping, crash
  recovery without repayment.
- **Suite sync**: append-only versioned CAS, same slot identity, independent
  failure semantics.
- **React interaction**: action gating/placement, accessible dialog, exact
  preview, ordered independent writes, handoff/error copy, no recovery wording.
- **Browser**: end-to-end catalog/raw flows, fallback, duplicate, abort/recovery,
  responsive/accessibility, and visual separation with deterministic mocks.

Tests must assert observable behavior and paid-call counts, not source text or
incidental implementation names.

## Done criteria

All must hold:

- [ ] A terminal experiment can add one catalog or raw-slug model.
- [ ] Snapshot and record fingerprints rotate; only snapshot roster and
      fingerprint fields change, with append-only extension history.
- [ ] Exactly one attempt is queued per snapshot task.
- [ ] Reusable tasks execute only the new model and one fresh blind Judge pass.
- [ ] Non-reusable tasks execute the full rotated roster and one fresh Judge
      pass, with exact preview counts shown before confirmation.
- [ ] Old Judge evidence is never copied; reused candidate attempts carry
      `reusedFrom` links.
- [ ] Failed/partial extension attempts do not displace better prior evidence;
      full-coverage successes become selected through existing logic.
- [ ] Suite sync defaults on, writes the same stable slot into a new suite
      version, and remains independent from experiment execution.
- [ ] Suite conflict/archived/duplicate/storage failures are visible and never
      block the confirmed experiment extension.
- [ ] Duplicate extension is prevented in picker and controller.
- [ ] **Add model** is in the header, absent during another execution, and never
      appears in or uses wording from recovery.
- [ ] Matrix, aggregation, ranking, winner semantics, repair planner, executor,
      pipeline, providers, and studio seeds are unchanged.
- [ ] Pause, abort, lease, fence, CAS, persistence failure, and startup recovery
      tests pass without repayment.
- [ ] `npm run typecheck:web`, `npm run check`, `npm run qa:roster-extension`,
      and `git diff --check` exit 0.
- [ ] Browser evidence covers all seven scenarios in Workstream G.
- [ ] `plans/README.md` marks Plan 001 DONE with no unresolved blocker.

## STOP conditions

Stop and report; do not improvise if:

- The source specification hash differs from the baseline at the top of this
  plan.
- Current code no longer has the repair seed, queue transition, selected-attempt
  coverage policy, or CAS boundaries described above.
- The extension appears to require changing `pipeline.ts`, `RunExecutor`,
  aggregation, ranking, matrix components, or provider adapters.
- A correct full-roster fallback would execute fewer than two candidates, making
  a fresh blind Judge pass invalid. Report the exact fixture/roster instead of
  silently skipping Judge.
- Snapshot rotation cannot be persisted atomically with queued attempts in one
  experiment CAS.
- Reusing a selected base run requires weakening cross-experiment, cross-task,
  cross-suite, or prior-fingerprint identity checks.
- Suite sync appears to require a transaction shared with the experiment write.
- A new model slot cannot retain one stable ID across suite and experiment.
- A step's verification fails twice after a reasonable source-level correction.
- Implementation would modify unrelated pre-existing working-tree files.

## Maintenance notes

- The persisted property name `repair` remains for backward compatibility, but
  its discriminated value can now represent roster extension. Reviewers must
  check that user-visible copy branches on `kind` and never labels extension as
  repair.
- Future multi-model extension would change preview math, queue inputs, duplicate
  validation, and suite CAS behavior. It is explicitly not supported by this
  plan.
- Future snapshot semantic fields must be added to the shared fingerprint-input
  builder so suite and snapshot fingerprint helpers cannot diverge.
- Review the single-CAS rotation-plus-queue boundary carefully. A terminal
  rotated record with no queued attempts is a stranded paid-work state.
- Preserve candidate reuse provenance and new Judge evidence independently:
  copied outputs are acceptable; copied Judge reports, scores, and winners are
  not.
- Cross-tab UI cannot know a remote lease synchronously. The UI gates the in-tab
  owner; controller lease acquisition remains the authoritative cross-tab guard
  and must produce a visible error.
