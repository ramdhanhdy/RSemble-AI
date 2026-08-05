# Fix spec 03: lifecycle-safe provider probe cancellation

## Outcome

Starting Compare or experiment execution cancels catalog/readiness polling
without changing provider health, catalog data, or the error banner. Timeouts
and genuine failures outside an active run remain visible.

## Required behavior

1. Make `ProviderProbeCoordinator.run` return a cycle-level discriminated
   result, for example:

   ```ts
   type ProbeCycleResult =
     | { status: "completed"; results: ProviderProbeResult[] }
     | { status: "cancelled" };
   ```

2. `coordinator.abort()` must settle the in-flight call as `cancelled` even if
   some provider stages completed before cancellation.
3. `checkAllReadiness` must return immediately on `cancelled` and perform no
   `setReadinessMap`, `SET_MODELS`, `setReadinessSettled`, or `setCatalogError`.
4. Keep deadline expiry distinct from lifecycle cancellation. A probe timeout
   while idle is a completed cycle containing a timeout error and remains
   diagnosable.
5. A stale cycle must not commit after a newer cycle starts. Preserve the
   coordinator’s single-flight contract or add a monotonic cycle ID.
6. Active model execution controllers remain independent; cancelling a probe
   must never abort a candidate, Judge, or Fusion request.

## Acceptance criteria

- Mixed cycle (Gemini complete, OpenRouter catalog pending) + execution start
  produces no catalog banner and no readiness/catalog mutation.
- An idle OpenRouter timeout still renders a timeout issue.
- A genuine idle authentication/readiness failure still updates connection state.
- Starting and completing a run resumes a fresh probe cycle afterward.

## Tests

- Extend `provider-probes.test.ts` with mixed partial-completion cancellation.
- Add an RSemble shell/component test proving a cancelled cycle cannot render
  `Catalog probe issue` after `experimentActive` becomes true.
- Keep independent AbortSignal assertions for provider probes and execution.

