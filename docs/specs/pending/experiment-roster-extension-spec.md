# Experiment Roster Extension Specification

**Status:** Ready for implementation
**Date:** 2026-08-04
**Product:** RSemble AI
**Scope:** Add a new candidate model to a finished experiment and execute only that model across every suite task — from the terminal results view — with optional one-click persistence to the source suite

## 1. Summary

A user finishes a suite run and then wants to try one more model against the
same evidence. Today there is no supported path: the repair machinery only
targets models already in the immutable snapshot roster, and full task retry
always re-executes the entire roster.

Roster extension adds a first-class **Add model** action to the terminal
experiment results view. The user picks a provider and slug (live catalog
autocomplete or raw slug), sees an exact cost preview, and confirms. RSemble
then:

1. Extends the experiment's immutable snapshot roster with the one new slot.
2. Queues one compound attempt per task — the same mechanism as targeted
   missing-cell repair — that reuses every accepted candidate output from the
   task's selected attempt, generates only the new model, and runs one fresh
   blind Judge pass over the reconstructed candidate set.
3. Optionally saves the model into the source suite as a new persisted
   version (default on), so the next fresh run includes it.

Adding a model is an intentional extension of the evidence base. It is not a
recovery action and must never be labeled, grouped, or phrased as a repair.

## 2. Authority and evidence

This specification is subordinate to:

- `PRODUCT.md`
- `DESIGN.md`
- `UI.md`
- `docs/specs/archive/suite-execution-reliability/suite-execution-reliability-spec.md`
- `docs/specs/archive/evaluation-workspaces/evaluation-workspaces-spec.md`

Current-state facts this design builds on:

| Observation | Evidence | Product implication |
| --- | --- | --- |
| Repair executes only missing model keys against a selected partial attempt | `experiment-repair.ts`, `experiment-controller.ts` (`repairMissingCells`, `executeRepairTask`) | The compound-attempt pipeline already does exactly the right per-task work; roster extension drives it differently |
| Repair rejects models outside the snapshot roster | `experiment-repair.ts` ("Model … is not in the experiment snapshot roster") | The roster must be extended *before* queueing, not the check weakened |
| Roster and columns derive from `snapshot.modelSlots` | `experiment-aggregation.ts` (`aggregateExperiment`), `ResultMatrix.tsx`, `MobileExperimentResults.tsx` | Appending one slot to the snapshot gives a new matrix column with missing cells — no aggregation or matrix changes needed |
| Snapshot validity is protected by the protocol fingerprint | `protocol-fingerprint.ts` | Roster changes must rotate the fingerprint, and *only* the roster may change; repair validity is keyed to the fingerprint of the attempt's own base run |
| Run sources carry a `repair` metadata discriminant | `run-types.ts` (`RunSource.experiment.repair`) | Extension attempts need their own kind for honest provenance |
| Recovery dialogs show exact planner cost counts | `ExperimentRecoveryDialog.tsx` | The add-model confirmation reuses the same honest call-count pattern (candidate calls, Judge calls, reused outputs) |
| The add-model pick interaction already exists | `ModelList.tsx` (`AddModelCombobox`) | Reuse the combobox inside a dialog rather than inventing a new picker |
| Terminal results own their recovery actions through the controller prop | `ExperimentResults.tsx` | Roster extension lives on the same surface and obeys the same lease-ownership rules |

## 3. Product character

This feature follows the reliability-program character (industrial
workbench, instrumentation tone):

- explicit call counts, never currency estimates;
- visible provenance on reused evidence;
- no celebratory motion on completion;
- one confirmation surface, no multi-step wizard;
- the action is physically obvious on the results view but never competes
  with the winner callout.

## 4. Goals

1. Let a user add one candidate model to a finished experiment and execute
   only that model across every task.
2. Never re-execute or re-judge a model that already has accepted evidence
   in the selected attempt of each task.
3. Keep every prior run and attempt immutable; extension appends attempts
   and rotates the snapshot fingerprint.
4. Let the user persist the model to the source suite in the same flow, as
   an explicit opt-out choice, without making two trips.
5. Preserve lease, fence, abort, pause-at-boundary, restart-recovery, and
   persistence-failure invariants exactly as repair does.
6. Keep the add-model UX visually and verbally distinct from recovery.

## 5. Non-goals

- Adding multiple models in one pass (repeat the flow per model).
- Removing or replacing models on a finished experiment.
- Cross-suite roster extension (adding a model to an experiment run against
  a different suite id).
- Re-judging old outputs against new rubric criteria — profiles are pinned;
  extension never changes evaluation content.
- A standing "compare against experiment" ad-hoc mode.
- Changing winner semantics: a newly added model starts with zero scored
  cells and is winner-ineligible until it reaches complete coverage.

## 6. The model: extension as snapshot rotation plus per-task compound attempts

### 6.1 Snapshot rotation

Roster extension mutates exactly one thing in the persisted experiment:
`snapshot.modelSlots` gains one appended, enabled slot. Everything else in
the snapshot — tasks, profiles, judge, default evaluation, createdAt — is
byte-identical.

Because the roster is fingerprinted content (`buildFingerprintInput`
includes `modelSlots`), the extension recomputes
`snapshot.protocolFingerprint` over the rotated snapshot and copies it to
`record.protocolFingerprint`. The pre-extension fingerprint is preserved for
provenance (§6.5).

Only the roster changes. If any other snapshot field differs, the operation
aborts before any paid call — extension is never a backdoor for editing
suite content on a finished run.

Suite identity fields `record.suiteId` and `record.suiteVersion` do **not**
change. The extension record remains an experiment over the original suite
version; the optional suite save (§8) is a separate, later write to the
suite entity itself.

### 6.2 Per-task compound attempts

For every task in the snapshot, extension queues one attempt built exactly
like a targeted missing-cell repair against that task's selected attempt:

- the fresh run reuses accepted candidate outputs from the base run with
  `reusedFrom` provenance (existing `buildRepairRunSeed` behavior);
- exactly one candidate executes: the added model;
- one fresh blind Judge pass covers the complete reconstructed candidate
  set (reused outputs plus the new model);
- old Judge scores are never copied.

Per-task handling by selected-attempt state:

| Selected attempt state | Behavior |
| --- | --- |
| Terminal attempt with a loadable run that has ≥1 accepted candidate output | Compound extension attempt (reuse + one fresh candidate + fresh Judge) |
| No accepted attempt, or run record unavailable | Full-roster attempt for that task (same shape as `retryIncomplete` for that task) — the new model must not silently skip a task |
| No attempts at all | Full-roster attempt for that task |

The second and third rows are the deliberate escape hatch: extension never
leaves a task permanently missing the new model because the old evidence is
gone. Tasks that fall back to a full-roster attempt are called out in the
confirmation cost preview (§7.3) — the user sees the real call count before
confirming.

### 6.3 Attempt status and selection

Extension attempts persist terminal status through the existing
`commitTaskTerminal` path with `coverage` metadata, so the coverage-aware
selector (§11.5 of the reliability spec) works unchanged:

- a completed extension attempt (new model scored, all reused outputs
  judged) has full coverage and becomes selected;
- a failed or partial extension attempt never displaces the prior selected
  attempt — the old evidence stays authoritative;
- the aggregation then shows the new model's cells as scored where the
  Judge accepted it, missing (`no-score`) otherwise.

### 6.4 Provenance

Every extension attempt records its provenance in the run source:

```ts
interface ExperimentRosterExtensionSource {
  kind: "roster-extension";
  /** Model key `providerId:slug` of the added model. */
  addedModelKey: string;
  /** Selected attempt run that supplied the reused outputs for this task,
   *  when the compound path was taken. Absent on full-roster fallback. */
  baseRunId?: string;
}
```

This rides on the existing `RunSource.experiment` discriminated branch as a
new optional field or a widened `repair` union — an implementation detail,
but the persisted record must answer, for every extension attempt: *which
model was added, and which base run (if any) supplied the reused evidence*.

The run detail UI labels reused candidates exactly as repair does
(**Reused from prior attempt**). The new model's candidate needs no special
label — it is ordinary fresh evidence.

### 6.5 Experiment-level extension record

The experiment gains an append-only extension history so the roster's
evolution stays auditable:

```ts
interface ExperimentRosterExtension {
  addedModelKey: string;
  addedSlot: ModelSlot;          // the exact appended slot (stable id)
  priorFingerprint: string;      // snapshot fingerprint before this extension
  extendedAt: number;            // epoch ms
}
```

Persisted on the experiment record (new optional field
`rosterExtensions?: ExperimentRosterExtension[]`). This is how the UI
answers "which models were added later" and how validation prevents adding
the same model twice (§7.1).

## 7. User experience

### 7.1 Entry point

The terminal results view gains one action: **Add model**.

Placement: in the header action row of `ExperimentResults`, next to **Back
to suite** — visually a peer of navigation, not inside the recovery toolbar
and never adjacent to "Repair all missing results" / "Retry all incomplete
tasks". When the recovery toolbar is also visible, Add model stays in the
header; the two regions never share a surface.

The action is present when:

- the experiment is terminal (`completed`, `completed_with_failures`,
  `aborted`, `interrupted`);
- this surface owns the execution lease (same rule as recovery actions:
  absent while another execution owns the lease — the existing
  `recoveryEnabled` gate generalizes to an `executionActionsEnabled` gate);
- at least one provider is available to pick a model from.

The action is disabled with explanatory text when every eligible provider
model key is already in the roster (nothing left to add).

### 7.2 The add-model dialog

One dialog (`DialogSurface`), titled **Add model to results**. Contents, in
order:

1. **Model picker** — the existing `AddModelCombobox` (provider tabs, live
   catalog autocomplete, raw-slug entry), driven by the same `models`
   catalog prop the suite editor receives. `takenKeys` is the current
   roster (snapshot slots plus any key in `rosterExtensions`), so an
   already-present model cannot be picked.
2. **Suite sync choice** — a checked-by-default checkbox:

   > Also add to suite *\<suite name\>* — saves a new suite version so
   > future runs include this model.

   Unchecked, the model is added to this experiment's results only.
3. **Cost preview** — exact call counts, computed from the same per-task
   planning the controller will execute (§6.2):

   > Adding **\<model\>** runs **N candidate calls + N Judge calls** across
   > **N tasks**. **R** accepted candidate outputs will be reused.
   > **F** task(s) lack reusable evidence and will run the full roster
   > (**M** candidates each).

   The final sentence appears only when F > 0. The preview states the paid
   truth; it never invents a currency amount.
4. **Result message region** (`role="alert"`) for errors or the success
   handoff message.
5. **Actions** — Cancel and **Add and run** (busy: "Starting…").

Dialog behavior follows the existing recovery dialog contract: initial
focus into the picker, focus trap, Escape closes (unless busy), focus
restored on close.

### 7.3 Confirmation and handoff

On confirm:

1. The suite-sync write (if checked) executes **first** and independently
   (§8); its failure is reported in the message region and does not block
   the experiment extension, which proceeds — the two writes have different
   blast radii and must not share one all-or-nothing transaction.
2. The controller extends the snapshot, persists, and queues the per-task
   attempts (§6). The dialog closes.
3. A success message appears on the results surface: "Add-model run
   started — navigate to the progress view to watch it." (Same handoff
   pattern as repair.)
4. The experiment record is non-terminal (`running`) while the extension
   executes; the existing `ExperimentRoute` switch renders the progress
   surface on next load, and the progress surface's task rows show the
   queued extension attempts like any other work.

While the extension runs, the Add model action is absent (execution owns
the lease). On completion the user returns to results, where the new column
shows scored or missing cells per task.

### 7.4 Matrix presentation

No matrix code changes: the rotated snapshot roster flows through
`aggregateExperiment`, `ResultMatrix`, and `MobileExperimentResults` as a
new column with ordinary scored/missing cells. Coverage transparency does
the honest work — the new model displays its coverage (e.g. `3/3 tasks`
after success, or partial) and is winner-eligible only at complete
coverage, same as every other model.

The new model's matrix column and standings row carry no "recently added"
badge. Provenance lives in the attempt history and run detail, not as
permanent chrome on the results surface.

## 8. Suite sync

When the checkbox is checked, confirming also saves the model into the
source suite:

- load the current persisted suite;
- reject (report, skip suite write, still extend the experiment) when the
  suite is archived or already contains the key — never duplicate;
- append one enabled slot (`providerId`, `slug`, display `model`, stable
  fresh slot id — the *same* slot object appended to the experiment
  snapshot, so suite and experiment agree on identity);
- save with `version: persisted.version + 1` through the normal
  `saveSuite` CAS, so the suite editor's next "Run vN" snapshots the
  extended roster.

The suite write and the experiment extension are independent. A conflict on
the suite (another tab edited it) reports "Suite was modified elsewhere —
the model was added to these results only" and never blocks the paid
experiment work the user already confirmed.

The suite write never rewrites tasks, judge, or evaluation pins. It appends
one slot and nothing else.

## 9. Controller and engine changes

### 9.1 New controller method

```ts
addModelAndRun(
  experimentId: string,
  input: { slot: ModelSlot },
): Promise<StartResult>  // { ok, experimentId } | { ok: false, error }
```

Orchestration, reusing the repair pathway:

1. Load the experiment; require terminal status.
2. Acquire lease and in-tab owner exactly as `repairMissingCells` does.
3. Validate: key not already in roster or `rosterExtensions`; snapshot
   otherwise untouched.
4. Rotate the snapshot: append the slot, recompute the fingerprint, append
   the `rosterExtensions` entry, persist via CAS (§6.1, §6.5). The in-memory
   engine is rebuilt from the rotated record.
5. Plan per task (§6.2): compound attempt where reuse is possible,
   full-roster attempt otherwise.
6. Queue all tasks and start the run loop; extension attempts execute one
   task at a time with the same pause-at-boundary, abort, heartbeat, and
   fence semantics as repair. The queued attempt carries a discriminant
   (`repair: { kind: "roster-extension", addedModelKey, baseRunId? }` or a
   sibling field on the queued attempt) so the run loop routes it to the
   compound executor path.

### 9.2 Engine

The queue transition accepts the rotated record and per-task queued
attempts. `queueRepairs` already queues attempts carrying a repair plan and
sets the record running; roster extension generalizes the same transition
(plan union gains a `roster-extension` member, or the field is renamed to a
neutral `plan`). No change to `beginTask`, `commitTaskTerminal`, abort,
pause, or selection policy.

### 9.3 Executor and run-seed builder

The compound execution path (`executeRepairTask` in the controller,
`buildRepairRunSeed` in the builder, and the `candidateExecution` branch of
`RunExecutor.executeTask`) is reused with two deltas:

- the seed's `slots` is the **rotated** roster (old slots plus the new
  one), so the new model gets a persisted candidate and the Judge pass
  covers it;
- `requestedModelKeys` is exactly `[addedModelKey]`; reuse eligibility is
  unchanged (accepted outputs on the base run, minus the requested set).

`buildRepairRunSeed` must tolerate the requested key having no base-run
candidate (it never ran before — there is nothing to reuse *for it*) while
still requiring ≥1 reusable output from *other* candidates, mirroring the
existing repair safety rule.

The full-roster fallback path (§6.2 rows 2–3) executes the rotated roster
with no seeding — identical to the existing `executeTask` path.

### 9.4 What must NOT change

- `planMissingCellRepair`'s roster-membership and fingerprint guards stay
  as-is — repair validity remains anchored to the base run's own
  fingerprint (repair against pre-extension evidence keeps working because
  that evidence shares its fingerprint; repair against a post-extension
  base run uses the new fingerprint).
- Aggregation, ranking, and matrix code: no changes (§7.4).
- Winner semantics: unchanged.

## 10. Accessibility

1. The Add model button has a text label; no icon-only trigger.
2. The dialog traps focus, closes on Escape when not busy, restores focus
   to the button.
3. The picker is the existing accessible combobox (searchbox role, labeled
   provider tabs, 44px targets).
4. The cost preview is plain visible text — never a tooltip.
5. The suite-sync checkbox has an explicit accessible name including the
   suite name.
6. Busy state is text ("Starting…"), never motion alone.

## 11. Security and privacy

- No credential, prompt, or output content is persisted beyond what the
  existing run records already hold; reused outputs keep their
  `reusedFrom` references to immutable local run IDs.
- The suite-sync write goes through the same CAS + validation as the suite
  editor; prohibited-key validation applies unchanged.
- No external network action occurs until the explicit **Add and run**
  confirmation.

## 12. Acceptance criteria

1. From a terminal experiment's results view, the user can open **Add
   model**, pick a catalog or raw-slug model, see the exact candidate /
   Judge / reuse / full-roster-fallback counts, and confirm.
2. Confirming queues one attempt per task: compound reuse + one fresh
   candidate + fresh Judge where the selected attempt supports it,
   full-roster for that task otherwise.
3. The added model never re-executes models with accepted evidence in a
   task's selected attempt; old Judge scores are never copied.
4. After a successful extension, the new model's cells are scored; a
   failed extension leaves the prior selected attempt authoritative and
   the new model's cells missing.
5. The snapshot fingerprint rotates on extension and only the roster
   changes; the extension history records the added key, slot, prior
   fingerprint, and timestamp.
6. With suite sync checked (default), the suite persists a new version
   containing the appended slot; unchecked, the suite is untouched. A
   suite-write conflict is reported and never blocks the experiment
   extension.
7. Adding the same model twice is impossible (picker excludes roster and
   previously extended keys; controller re-validates).
8. The action is absent while another execution owns the lease and while
   the experiment is non-terminal.
9. Pause, abort, lease loss, and restart recovery behave exactly as they
   do for repair runs.
10. The feature never appears inside, next to, or worded like the
    recovery toolbar.
11. Lease, fence, persistence-failure, and repair regression tests remain
    green.

## 13. Verification gates

```bash
npm test
npm run typecheck:web
npm run build
npm run check

git diff --check
```

Required browser scenarios:

1. Add a catalog model to a finished experiment with suite sync on; watch
   progress; confirm the new column is scored and the suite version
   incremented.
2. Add a raw-slug model with suite sync off; confirm results show the new
   column and the suite is unchanged.
3. Add a model where one task has no accepted attempt; confirm the dialog
   preview calls out the full-roster fallback count and that task runs the
   full roster.
4. Attempt to add a model already in the roster; confirm the picker
   excludes it.
5. Abort an extension mid-run; confirm restart recovery adopts committed
   terminal runs and never repays.
