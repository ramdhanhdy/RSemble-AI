# Fix spec 05: explicit run completion time

## Outcome

Run detail distinguishes start and completion and shows both exact local times.
Relative text is explicitly anchored to the event it describes.

## Required behavior

1. Extend the run-detail header view model with `startedAt`, `completedAt`,
   formatted exact strings, and duration when both timestamps exist.
2. Terminal run copy:
   `Started <exact> · Completed <exact> (<relative>) · Duration <value>`.
3. Active run copy:
   `Started <exact> (<relative>) · Running for <duration>`.
4. Failed/aborted/interrupted records with `completedAt` use “Ended” if
   “Completed” would be semantically false.
5. Use `<time dateTime={...}>` elements and include the resolved timezone.
6. Do not change repository sort order in this fix. Run-list ordering remains a
   separate concern; only displayed event semantics change.

## Acceptance criteria

- A completed fixture renders both creation and completion clock times.
- Relative age is based on `completedAt` for terminal records.
- Duration equals `completedAt - createdAt` and handles sub-minute values.
- A running record never fabricates a completion time.
- Older records with `completedAt: null` degrade to start-only copy.

## Tests

Add deterministic clock tests to `run-view-model.test.ts` and
`RunDetail.test.tsx` for completed, failed, running, and legacy/null completion
cases.

