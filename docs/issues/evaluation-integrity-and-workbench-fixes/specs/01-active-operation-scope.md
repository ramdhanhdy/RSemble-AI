# Fix spec 01: truthful active-operation scope

## Outcome

The experiment progress banner describes the execution plan attached to the
currently running task attempt. Historical roster-extension entries never
determine live copy.

## Required behavior

1. Add a pure view-model helper, preferably in
   `src/lib/evaluations/experiment-task-ledger.ts`, that derives the active
   operation from attempts with status `running` (or queued attempts while the
   experiment is paused and no attempt is running).
2. Reuse `currentAttemptOf` selection semantics. Do not independently invent a
   second “current attempt” algorithm in the component.
3. Render by the attempt’s `repair.kind`:
   - `missing-cells`: “Completing missing results: running `<requested keys>`;
     other accepted evidence is reused; one fresh Judge pass per task.”
   - `roster-extension`: “Roster extension in progress: running
     `<addedModelKey>`; other accepted evidence is reused; one fresh Judge pass
     per task.”
   - no plan: no targeted-operation banner.
4. If active attempts contain inconsistent kinds or target sets, render a
   neutral “Targeted completion in progress” message and emit a development log
   warning. Never choose the newest history entry as a fallback.
5. `experiment.rosterExtensions` remains append-only history and may continue
   to render on the terminal Results page.

## Acceptance criteria

- A running `missing-cells` attempt targeting DeepSeek displays DeepSeek even
  when the most recent extension history entry is Umans.
- The copy says “Completing missing results,” not “Roster extension.”
- A genuine `roster-extension` attempt still shows the roster-extension copy.
- A normal full run shows no targeted-operation banner.
- Paused targeted work retains truthful scope from queued plans.

## Tests

Add characterization cases to `ExperimentProgress.test.tsx` for all four
acceptance cases. The DeepSeek/Umans regression fixture must contain both model
keys and assert that the banner excludes `umans:umans-glm-5.2`.

## Non-goals

- No provider-routing changes.
- No new persisted “active model” field; the attempt plan is already canonical.
- No mutation or deletion of roster-extension history.

