# Issue analysis

## Reported runtime evidence

The report showed these facts for the same experiment task:

- The UI said: `Roster extension in progress: running umans:umans-glm-5.2 only.`
- `experiment.task.created` and `experiment.task.execution.started` both used
  stage `missing-cells`.
- `provider.request.started` used model key
  `deepseek:deepseek-v4-flash`.

The provider log is emitted immediately around the actual adapter call in
`src/lib/run-executor.ts:280-294`. It is stronger evidence of the paid target
than the banner. The banner is stale; DeepSeek is actually running.

## Findings

### ISSUE-01 — Derive operation scope from the active plan, not extension history

- **Evidence:** `src/workspaces/evaluations/ExperimentProgress.tsx:77-83`
  selects the final entry of append-only `experiment.rosterExtensions` whenever
  the experiment is running or paused.
- **Evidence:** `ExperimentProgress.tsx:96-104` always renders that historical
  entry as “Roster extension in progress.”
- **Evidence:** `src/lib/evaluations/evaluation-types.ts:133-181` already stores
  the actual plan on every task attempt. A `missing-cells` plan carries
  `requestedModelKeys`; a `roster-extension` plan carries `addedModelKey`.
- **Evidence:** `src/lib/evaluations/experiment-task-ledger.ts:95-108` already
  has the correct current-attempt selection rule: prefer a live running attempt
  over previously selected evidence.
- **Impact:** A truthful DeepSeek execution is presented as an Umans execution.
  This undermines trust, makes abort decisions unsafe, and can be mistaken for
  paid misrouting.
- **Effort / risk / confidence:** S / low / high.
- **Root cause:** `rosterExtensions` is history, not active execution state.

Rejected explanation: provider routing is not selecting Umans. The actual
provider request log identifies DeepSeek and the attempt stage is
`missing-cells`, not `roster-extension`.

### ISSUE-02 — Remove numbered experiment attempts from the product language

- **Evidence:** `src/workspaces/evaluations/ExperimentTaskLedger.tsx:68-70`
  converts the internal zero-based `trial` into `Attempt N`.
- **Evidence:** `ExperimentTaskLedger.tsx:226-264` dedicates a primary column and
  an `Attempts (N)` disclosure to this internal history.
- **Evidence:** `src/workspaces/evaluations/ExperimentResults.tsx:795-824`
  renders a second “Attempt history” surface with the same numbering.
- **Evidence:** `src/lib/evaluations/protocol-fingerprint.ts:78-80` explicitly
  fixes `trialsPerTask: 1`; multiple statistical trials are out of scope in
  `PRODUCT.md` and `DECISIONS.md`.
- **Impact:** Retry/repair bookkeeping is presented as if the product performs
  repeated experimental trials. “Attempt 3” does not tell the user whether the
  work was an initial run, full retry, roster extension, or missing-cell repair.
- **Effort / risk / confidence:** S–M / medium / high.
- **Boundary:** Persisted attempt arrays, IDs, and selection logic must remain.
  Removing those records would destroy provenance and recovery semantics.

### ISSUE-03 — Treat lifecycle cancellation as cancellation of the whole probe cycle

- **Evidence:** `src/rsemble.tsx:207-212` clears the error and aborts the probe
  coordinator when Compare or an experiment becomes active.
- **Evidence:** `src/rsemble.tsx:166-192` resumes after the awaited cycle and
  ignores it only when *every* provider result says `Provider probe aborted`.
- **Evidence:** `src/lib/provider-probes.ts:89-112` preserves a successful
  readiness result while attaching an aborted catalog-stage error. Other
  providers in the same cycle may already have completed successfully.
- **Impact:** A mixed result set (some complete, OpenRouter aborted) fails the
  `every(...)` guard, then paints `Catalog probe issue: openrouter: Provider
  probe aborted` over a healthy, paid execution.
- **Effort / risk / confidence:** S / low / high.
- **Root cause:** cancellation is encoded only per provider result; the caller
  has no authoritative cycle-level `cancelled` outcome.

Rejected explanation: this warning does not mean the active candidate request
was aborted. Catalog probes use their own coordinator and controllers.

### ISSUE-04 — Keep global-header geometry route-invariant

- **Evidence:** `src/ui/Header.tsx:95-184` uses three flex regions with
  `justify-between`; the right region changes width when children are present.
- **Evidence:** `src/rsemble.tsx:409-423` injects `ModeToggle` only on Compare.
- **Evidence:** the centered `WorkspaceNav` at `Header.tsx:113-118` is therefore
  centered only within changing leftover flex space, not at a fixed viewport
  coordinate.
- **Impact:** Compare/Runs/Evaluations visibly shift horizontally between
  routes. A Compare-only control destabilizes global navigation.
- **Effort / risk / confidence:** M / medium / high.
- **Design conflict:** `PRODUCT.md:58`, `DESIGN.md:87-124`, `UI.md:17-41`, and
  `DECISIONS.md:11` currently prescribe a header toggle. The requested product
  change must deliberately supersede those statements rather than silently
  drifting from them.

### ISSUE-05 — Distinguish run start time from completion time

- **Evidence:** `src/workspaces/runs/run-view-model.ts:117-124` formats only
  `record.createdAt`, both as the exact timestamp and relative time.
- **Evidence:** `src/workspaces/runs/RunDetail.tsx:103-120` renders only that one
  timestamp despite `RunRecordV2.completedAt` being persisted.
- **Impact:** A long-running or recovered run cannot answer “when did this
  finish?” The relative label can also be read as completion age even though it
  is based on creation.
- **Effort / risk / confidence:** S / low / high.

### ISSUE-06 — Replace heuristic pricing with auditable usage accounting

- **Evidence:** `src/lib/cost.ts:6-19` contains only five substring-matched
  pricing entries. Provider identity is not part of the lookup, and most
  catalog models return no price.
- **Evidence:** `src/lib/providers/types.ts:32-36` drops pricing and supported
  parameter metadata from `CatalogModel` even when upstream catalogs provide it.
- **Evidence:** `src/lib/run-executor.ts:302-303` estimates tokens as roughly one
  token per four characters. This is not native tokenizer usage.
- **Evidence:** `src/lib/persistence/run-types.ts:184-216` stores candidate token
  estimates but stores no Judge or Fusion tokens or costs.
- **Evidence:** `src/ui/RunButton.tsx:31-41` forecasts candidate cost only; it
  does not price the Judge or optional Fusion pass.
- **Impact:** Most models show no price, run totals cannot include every paid
  stage, reasoning/cache/request charges are invisible, and historical costs
  cannot be audited against the price effective at execution time.
- **Effort / risk / confidence:** L / medium-high / high.
- **External contract evidence:** OpenRouter’s official Models API exposes
  per-token prompt, completion, reasoning, cache, image, and request pricing,
  while its final streaming event includes native usage and cost. See
  [OpenRouter Models](https://openrouter.ai/docs/guides/overview/models) and
  [Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).

### ISSUE-07 — Make reasoning effort an explicit evaluation parameter

- **Evidence:** `src/lib/providers/types.ts:23-29` exposes temperature and max
  tokens only; there is no reasoning setting in `ChatOptions`.
- **Evidence:** every current adapter forwards only those shared fields (for
  example `src/lib/providers/openrouter.ts:128-137` and
  `src/lib/providers/gemini.ts:257-266`).
- **Evidence:** experiment execution hard-codes candidate temperature `0.7` in
  `src/lib/evaluations/experiment-controller.ts:347,484,1274,1359`.
- **Evidence:** `src/lib/evaluations/protocol-fingerprint.ts:45-80` fingerprints
  roster, tasks, Judge, profiles, and fixed trial policy, but no generation or
  reasoning policy.
- **Impact:** models may run at materially different provider defaults; the UI
  cannot request a common effort; historical results cannot prove what was
  requested or effectively applied. This weakens fair-evaluation claims.
- **Effort / risk / confidence:** L / high / high.
- **External contract evidence:** supported levels and transport shape vary by
  provider and model. OpenRouter catalogs supported reasoning parameters and
  normalizes effort; Gemini maps named levels differently across model families;
  OpenAI and DeepSeek expose their own supported effort sets. See
  [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
  [Gemini thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking),
  [OpenAI reasoning API](https://platform.openai.com/docs/api-reference/responses-streaming/response/refusal/delta?lang=curl),
  and [DeepSeek Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion).

## Cross-cutting conclusions

1. Operation copy must come from persisted active attempt plans; history must
   never masquerade as live state.
2. Cancellation must be a first-class outcome, not an error string that callers
   infer after partial completion.
3. Evaluation fairness and cost tracking both require immutable request/usage
   provenance. UI-only controls or current-price lookups are insufficient.
4. “Attempt” remains a valid internal persistence term but should not be the
   experiment UI’s organizing concept.

## Not audited

This was a focused audit of the seven reported issues and their direct data,
provider, persistence, and UI dependencies. It did not audit unrelated security,
performance, dependencies, Fusion Study statistics, attachments, or provider
credential management.

