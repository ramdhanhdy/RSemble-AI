# Fix spec 02: remove numbered experiment attempts from the UI

## Outcome

Experiment Progress and Results no longer show `Attempt 1`, `Attempt 2`,
`Attempt 3`, an Attempt column, or an `Attempts (N)` disclosure. The UI is
organized around tasks, status, coverage, elapsed/completion time, and run
evidence.

## Required behavior

1. Remove the Attempt column and numbered label from
   `ExperimentTaskLedger.tsx`.
2. Remove the per-task `Attempts (N)` disclosure and its historical rows.
3. When the current task state has a `runId`, provide a compact `View run` link
   instead. When there is no run but the current task has an error, show the
   bounded error text in the task row or an accessible disclosure named
   `Error details`—never as `Attempt N`.
4. Remove the `Attempt history` block from terminal `ExperimentResults.tsx`.
   Current coverage issues and their evidence links remain.
5. Remove `trialCount` from the task-ledger view model if no remaining UI uses
   it. Preserve `ExperimentTaskAttempt[]`, `trial`, IDs, `selectedAttemptId`, and
   run-source provenance in domain and persistence types.
6. Do not change the Runs workspace’s immutable candidate/Judge request evidence
   in this issue. That is technical run provenance, not the misleading
   experiment-level ordinal shown in the reported screenshot.

## Acceptance criteria

- Experiment Progress and Results contain no user-visible text matching
  `Attempt [0-9]+` or `Attempts (`.
- Task status, coverage, time, current error, and a `View run` link remain
  available where applicable.
- Retry, repair, selection, recovery, archive import/export, and aggregation
  tests continue to use the persisted attempt model unchanged.
- A task repaired three times still renders as one task row, not four trials.

## Tests

Update `ExperimentTaskLedger.test.tsx`, `ExperimentProgress.test.tsx`, and
`ExperimentResults.test.tsx`. Retain engine/type/repository tests for internal
attempt history; they are not obsolete.

## Non-goals

- No persistence migration.
- No deletion of failed evidence.
- No introduction of statistical repeated trials.

