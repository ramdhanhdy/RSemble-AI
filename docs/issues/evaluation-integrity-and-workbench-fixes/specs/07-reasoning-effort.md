# Fix spec 07: configurable, auditable reasoning effort

## Outcome

Compare and Evaluation suites can request reasoning effort for candidate models
and the Judge. Every run records requested and effective settings, and an
experiment fingerprint changes when its reasoning policy changes.

## Normalized policy

Use an explicit shared enum broad enough for current provider contracts:

```ts
type ReasoningEffort =
  | "provider-default"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

interface ReasoningPolicy {
  candidates: ReasoningEffort;
  judge: ReasoningEffort;
}
```

`provider-default` means no effort field is sent and must be displayed as such.
It is not equivalent to `medium`.

## Required behavior

1. Extend `ChatOptions` with normalized reasoning effort and add an adapter
   capability/resolution contract that returns supported levels and the
   effective level for a provider/model.
2. No silent dropping or remapping. If DeepSeek maps low/medium to high, the UI
   and persisted effective value must say `high`; if strict suite parity was
   requested, preflight must reject that mismatch.
3. OpenRouter capability comes from exact model catalog metadata when present.
   Gemini resolution must distinguish model families/levels. Direct provider
   adapters use their documented native shape. Unknown Umans/9Router-style
   gateways support only `provider-default` until their contract proves more.
4. Compare exposes candidate and Judge controls in its configuration surface.
   Suite Settings exposes a shared candidate effort and Judge effort.
5. Suite preflight computes the intersection of effective supported candidate
   levels. An explicit strict effort unavailable on any enabled model blocks
   execution with model-specific guidance. “Provider default” remains allowed
   but is labeled as not compute-equivalent across providers.
6. Add policy fields to `EvaluationSuite`, immutable `ExperimentSnapshot`, and
   run generation provenance. Older records default to `provider-default` in
   validators/migration helpers.
7. Include reasoning policy in `protocol-fingerprint.ts`. Changing effort creates
   a different protocol; it cannot mutate an already-running experiment.
8. Forward resolved effort to candidate, Judge, retry, missing-cell repair,
   roster extension, and Fusion calls. A recovery must use the immutable
   experiment snapshot, not current Compare preferences.
9. Run detail and Markdown/archive output show requested and effective values
   for candidates and Judge.
10. Fairness copy must be precise: equal named effort is a controlled request,
    not proof that different model families spend equal compute or tokens.

## Acceptance criteria

- An explicit supported effort reaches each adapter’s request body.
- Unsupported strict effort blocks before paid requests start and names the
  incompatible model.
- A repair uses the original experiment policy.
- Changing suite candidate or Judge effort changes the protocol fingerprint.
- Run detail can distinguish requested `medium`, effective `high`, and
  `provider-default`.
- Existing imported records remain valid and display `provider-default`.

## Tests

Add provider request-body tests, capability-intersection/preflight tests,
protocol fingerprint tests, snapshot/validator/archive tests, controller repair
tests, and Compare/Suite/RunDetail accessibility tests.

## Non-goals

- No claim that provider effort levels are scientifically identical.
- No display or persistence of private chain-of-thought.
- No per-task arbitrary tuning in v1; suite candidate policy is shared for
  comparability.

